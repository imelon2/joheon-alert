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
    listingDate: null,
    ...over,
  };
}

type Harness = { deps: Deps; writes: { snapshot: Snapshot[]; notified: NotifiedLog[] }; sends: string[] };

function harness(over: Partial<Deps> = {}, prev: IpoRow[] = [row()]): Harness {
  const writes = { snapshot: [] as Snapshot[], notified: [] as NotifiedLog[] };
  const sends: string[] = [];
  const deps: Deps = {
    fetchRows: async () => [row()],
    send: async (message) => {
      sends.push(message.text);
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

    expect(result.messages[0]?.text).toContain('오늘 청약 시작');
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

    const types = late.messages.map((m) => m.text).join('');
    expect(types).not.toContain('오늘 청약 시작');
  });
});

describe('run — 상장일 (행 단위 + 캐싱)', () => {
  it('스냅샷에 저장되어 Mini App 같은 소비자가 읽을 수 있다', async () => {
    const h = harness();
    await run(h.deps, TODAY, { dryRun: false });

    expect(h.writes.snapshot[0]?.items['2307']?.listingDate).toBe('2026-09-10');
  });

  it('메시지에도 같은 값이 나간다', async () => {
    const h = harness();
    const result = await run(h.deps, TODAY, { dryRun: true });

    expect(result.messages[0]?.text).toContain('상장일  2026-09-10');
  });

  it('이미 아는 상장일은 다시 받지 않는다', async () => {
    // 확정된 상장일은 바뀌지 않는다. 매일 다시 받으면 요청만 낭비된다.
    const calls: string[] = [];
    const known = row({ listingDate: '2026-09-10' });
    const h = harness(
      {
        fetchRows: async () => [row()], // 목록 파싱 결과는 항상 null
        fetchListingDate: async (no) => {
          calls.push(no);
          return '2026-09-10';
        },
      },
      [known], // 이전 스냅샷에는 값이 있다
    );

    const result = await run(h.deps, TODAY, { dryRun: false });
    expect(calls).toEqual([]); // 조회 없음
    expect(h.writes.snapshot[0]?.items['2307']?.listingDate).toBe('2026-09-10'); // 이어받음
    expect(result.messages[0]?.text).toContain('상장일  2026-09-10');
  });

  it('아직 모르는 상장일은 받아서 채운다', async () => {
    const calls: string[] = [];
    const h = harness(
      {
        fetchListingDate: async (no) => {
          calls.push(no);
          return '2026-09-10';
        },
      },
      [row()], // 이전 스냅샷도 null
    );

    await run(h.deps, TODAY, { dryRun: false });
    expect(calls).toEqual(['2307']);
  });

  it('오래 끝난 공모는 조회하지 않는다', async () => {
    // 60일 넘게 지난 종목까지 매일 재조회하면 영원히 요청이 줄지 않는다
    const calls: string[] = [];
    const old = row({ no: '999', subStart: '2026-01-01', subEnd: '2026-01-02' });
    const h = harness(
      {
        fetchRows: async () => [old],
        fetchListingDate: async (no) => {
          calls.push(no);
          return '2026-01-10';
        },
      },
      [old],
    );

    await run(h.deps, TODAY, { dryRun: false });
    expect(calls).toEqual([]);
  });

  it('조회가 실패해도 알림은 그대로 발송된다', async () => {
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

    expect(result.messages[0]?.text).toContain('상장일  -');
  });

  it('조회 상한에 걸리면 상장이 임박한 종목부터 받는다', async () => {
    // 상한에 잘려 상장 임박 종목의 상장일을 못 받으면, 그날 LISTING_DAY
    // (매도 가능일) 알림을 통째로 놓친다. 무엇이 잘리는지가 중요하다.
    const rows = [
      // 청약이 한참 남은 종목들 — 상장은 더 나중이다
      ...Array.from({ length: 25 }, (_, i) =>
        row({ no: `far${i}`, subStart: '2026-10-01', subEnd: '2026-10-02' }),
      ),
      // 어제 청약이 끝났다 = 1~2주 뒤 상장. 가장 급하다
      row({ no: 'imminent', subStart: '2026-08-23', subEnd: '2026-08-24' }),
    ];
    const calls: string[] = [];
    const h = harness(
      {
        fetchRows: async () => rows,
        fetchListingDate: async (no) => {
          calls.push(no);
          return '2026-09-10';
        },
      },
      [],
    );

    await run(h.deps, TODAY, { dryRun: false });

    expect(calls).toHaveLength(20); // LISTING_FETCH_CAP
    expect(calls).toContain('imminent'); // 잘려나가지 않았다
  });
});
