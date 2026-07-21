import { describe, expect, it } from 'vitest';
import { run, type Deps } from '../src/pipeline.js';
import { TelegramError } from '../src/notify.js';
import type { IpoRow, NotifiedLog, Snapshot } from '../src/types.js';

function row(over: Partial<IpoRow> = {}): IpoRow {
  return {
    no: '2307',
    name: '브릴스',
    subStart: '2026-08-25',
    subEnd: '2026-08-26',
    finalPrice: null,
    hopePrice: '16,500~19,500',
    ratio: null,
    underwriter: 'IBK투자증권',
    url: 'http://www.38.co.kr/html/fund/?o=v&no=2307',
    ...over,
  };
}

type Harness = { deps: Deps; writes: { snapshot: Snapshot[]; notified: NotifiedLog[] }; sends: string[] };

function harness(over: Partial<Deps> = {}, prev: IpoRow[] = [row()]): Harness {
  const writes = { snapshot: [] as Snapshot[], notified: [] as NotifiedLog[] };
  const sends: string[] = [];
  const deps: Deps = {
    fetchRows: async () => [row()],
    send: async (text) => {
      sends.push(text);
    },
    readSnapshot: async () => ({
      updatedAt: '2026-08-01T00:00:00Z',
      items: Object.fromEntries(prev.map((r) => [r.no, r])),
    }),
    readNotified: async () => ({ sent: [] }),
    writeSnapshot: async (v) => {
      writes.snapshot.push(v);
    },
    writeNotified: async (v) => {
      writes.notified.push(v);
    },
    fetchListingDate: async () => '2026-09-10',
    now: () => '2026-08-25T00:00:00Z',
    ...over,
  };
  return { deps, writes, sends };
}

const TODAY = '2026-08-25'; // row()의 청약 시작일 → D_DAY 발생

describe('run — 발송 성공 경로', () => {
  it('발송하고 state를 갱신한다', async () => {
    const h = harness();
    const result = await run(h.deps, TODAY, { dryRun: false });

    expect(result.sent).toBe(true);
    expect(result.statePersisted).toBe(true);
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0]).toContain('오늘 청약 시작');
    expect(h.writes.snapshot).toHaveLength(1);
    expect(h.writes.notified[0]?.sent).toEqual(['2307:D_DAY:2026-08-25']);
  });

  it('이벤트가 없으면 발송하지 않되 스냅샷은 갱신한다', async () => {
    const h = harness();
    const result = await run(h.deps, '2026-08-20', { dryRun: false });

    expect(h.sends).toHaveLength(0);
    expect(result.sent).toBe(false);
    expect(h.writes.snapshot).toHaveLength(1);
  });
});

describe('run — 핵심 불변식: 발송 실패 시 state를 쓰지 않는다', () => {
  it('네트워크 실패는 state를 남기지 않고 던진다 (다음 실행에서 재시도)', async () => {
    const h = harness({
      send: async () => {
        throw new Error('ECONNRESET');
      },
    });

    await expect(run(h.deps, TODAY, { dryRun: false })).rejects.toThrow('ECONNRESET');
    expect(h.writes.snapshot).toHaveLength(0);
    expect(h.writes.notified).toHaveLength(0);
  });

  it('5xx도 state를 남기지 않는다', async () => {
    const h = harness({
      send: async () => {
        throw new TelegramError('HTTP 503', 503, true);
      },
    });

    await expect(run(h.deps, TODAY, { dryRun: false })).rejects.toThrow();
    expect(h.writes.snapshot).toHaveLength(0);
  });

  it('분할 발송 중간에 실패하면 state를 남기지 않는다', async () => {
    let calls = 0;
    // 분할이 실제로 일어날 만큼 충분히 크게 (D_DAY 40건은 3400자로 안 나뉜다)
    const many = Array.from({ length: 100 }, (_, i) =>
      row({ no: String(i), name: `종목${i}`, subStart: TODAY, subEnd: '2026-08-26' }),
    );
    const h = harness(
      {
        fetchRows: async () => many,
        send: async () => {
          if (++calls === 2) throw new Error('중간 실패');
        },
      },
      many,
    );

    await expect(run(h.deps, TODAY, { dryRun: false })).rejects.toThrow('중간 실패');
    expect(calls).toBe(2); // 전제: 실제로 2통 이상으로 분할되었다
    expect(h.writes.snapshot).toHaveLength(0);
    expect(h.writes.notified).toHaveLength(0);
  });
});

describe('run — 재시도 불가한 실패는 전진해서 무한 루프를 막는다', () => {
  it('4xx는 state를 전진시키되 실패를 던진다', async () => {
    const h = harness({
      send: async () => {
        throw new TelegramError('HTTP 400 message is too long', 400, false);
      },
    });

    await expect(run(h.deps, TODAY, { dryRun: false })).rejects.toThrow('400');
    // 전진하지 않으면 매일 같은 payload로 실패하며 모든 알림이 영구히 죽는다
    expect(h.writes.snapshot).toHaveLength(1);
    expect(h.writes.notified[0]?.sent).toEqual(['2307:D_DAY:2026-08-25']);
  });
});

describe('run — dry-run', () => {
  it('메시지를 만들지만 발송도 저장도 하지 않는다', async () => {
    const h = harness();
    const result = await run(h.deps, TODAY, { dryRun: true });

    expect(result.messages[0]).toContain('오늘 청약 시작');
    expect(result.statePersisted).toBe(false);
    expect(h.sends).toHaveLength(0);
    expect(h.writes.snapshot).toHaveLength(0);
    expect(h.writes.notified).toHaveLength(0);
  });
});

describe('run — 건전성 검사', () => {
  it('0건이면 발송도 저장도 하지 않고 실패한다', async () => {
    const h = harness({ fetchRows: async () => [] });

    await expect(run(h.deps, TODAY, { dryRun: false })).rejects.toThrow('0건');
    expect(h.sends).toHaveLength(0);
    expect(h.writes.snapshot).toHaveLength(0);
  });
});

describe('run — 멱등성', () => {
  it('이미 보낸 이벤트는 재발송하지 않는다', async () => {
    const h = harness({ readNotified: async () => ({ sent: ['2307:D_DAY:2026-08-25'] }) });
    const result = await run(h.deps, TODAY, { dryRun: false });

    expect(h.sends).toHaveLength(0);
    expect(result.pendingCount).toBe(0);
  });

  it('멱등성 키는 실행일이 아니라 사건일에 고정된다', async () => {
    // 8/25에 놓친 D_DAY를 8/26에 복구 실행해도 키는 그대로여야 한다
    const h = harness({ readNotified: async () => ({ sent: ['2307:D_DAY:2026-08-25'] }) });
    const late = await run(h.deps, '2026-08-26', { dryRun: false });

    const types = late.messages.join('');
    expect(types).not.toContain('오늘 청약 시작');
  });
});

describe('run — 상장일 보강', () => {
  it('발송 대상 종목의 상장일을 메시지에 넣는다', async () => {
    const h = harness();
    const result = await run(h.deps, TODAY, { dryRun: true });

    expect(result.messages[0]).toContain('상장일  2026-09-10');
  });

  it('같은 종목에 이벤트가 여러 개여도 상세 페이지는 한 번만 받는다', async () => {
    const calls: string[] = [];
    // 시작=마감 → D_DAY와 LAST_DAY가 동시에 발생하는 종목
    const oneDay = row({ subStart: TODAY, subEnd: TODAY });
    const h = harness(
      {
        fetchRows: async () => [oneDay],
        fetchListingDate: async (no) => {
          calls.push(no);
          return '2026-09-10';
        },
      },
      [oneDay],
    );

    const result = await run(h.deps, TODAY, { dryRun: true });
    expect(result.pendingCount).toBe(2);
    expect(calls).toEqual(['2307']);
  });

  it('상장일 조회가 실패해도 알림은 그대로 발송된다', async () => {
    // 부가 정보 때문에 '오늘 청약 마감' 같은 본질적 알림이 죽으면 안 된다
    const h = harness({
      fetchListingDate: async () => {
        throw new Error('상세 페이지 500');
      },
    });

    const result = await run(h.deps, TODAY, { dryRun: false });
    expect(result.sent).toBe(true);
    expect(h.sends[0]).toContain('상장일  -');
  });

  it('상장일이 미정이면 - 로 표시한다', async () => {
    const h = harness({ fetchListingDate: async () => null });
    const result = await run(h.deps, TODAY, { dryRun: true });

    expect(result.messages[0]).toContain('상장일  -');
  });
});
