import { describe, expect, it } from 'vitest';
import {
  addDays,
  checkHealth,
  detectEvents,
  filterUnsent,
  notifyKey,
  pruneNotified,
  todayKst,
} from '../src/rules.js';
import type { IpoRow, Snapshot } from '../src/types.js';

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

function snapshot(...rows: IpoRow[]): Snapshot['items'] {
  return Object.fromEntries(rows.map((r) => [r.no, r]));
}

const TODAY = '2026-08-25';

describe('detectEvents — 날짜 기반', () => {
  it('청약 시작일이 오늘이면 D_DAY', () => {
    const events = detectEvents(snapshot(row()), [row()], TODAY);
    expect(events.map((e) => e.type)).toContain('D_DAY');
  });

  it('청약 시작일이 내일이면 D_MINUS_1', () => {
    const events = detectEvents(snapshot(row()), [row()], '2026-08-24');
    expect(events.map((e) => e.type)).toEqual(['D_MINUS_1']);
  });

  it('마감일이 오늘이면 LAST_DAY', () => {
    const events = detectEvents(snapshot(row()), [row()], '2026-08-26');
    expect(events.map((e) => e.type)).toEqual(['LAST_DAY']);
  });

  it('일정과 무관한 날에는 아무 이벤트도 없다', () => {
    expect(detectEvents(snapshot(row()), [row()], '2026-08-20')).toEqual([]);
  });

  it('1일 청약(시작=마감)은 D_DAY와 LAST_DAY가 함께 난다', () => {
    const one = row({ subStart: TODAY, subEnd: TODAY });
    const types = detectEvents(snapshot(one), [one], TODAY).map((e) => e.type);
    expect(types).toEqual(['D_DAY', 'LAST_DAY']);
  });
});

describe('detectEvents — diff 기반', () => {
  it('신규 종목이 등장해도 알리지 않는다', () => {
    // 신규 등록 알림은 의도적으로 뺐다. 해당 종목은 D-1에 어차피 알림이 간다.
    const events = detectEvents(
      snapshot(row({ no: '1' })),
      [row({ no: '1' }), row({ no: '2' })],
      '2026-08-20',
    );
    expect(events).toEqual([]);
  });

  it('최초 실행(이전 스냅샷 없음)에도 쏟아내지 않는다', () => {
    const events = detectEvents({}, [row({ no: '1' }), row({ no: '2' })], '2026-08-20');
    expect(events).toEqual([]);
  });

  it('최초 실행이어도 오늘 청약인 종목은 알린다', () => {
    const events = detectEvents({}, [row()], TODAY);
    expect(events.map((e) => e.type)).toEqual(['D_DAY']);
  });

  it('확정공모가가 정해져도 그 자체로는 알리지 않는다', () => {
    // 공모가 확정 알림도 뺐다. D-1 알림의 '확정가' 줄에 값이 실려 나간다.
    const after = row({ finalPrice: '19,500' });
    expect(detectEvents(snapshot(row()), [after], '2026-08-20')).toEqual([]);
  });

  it('확정가가 정정되어도 그 자체로는 알리지 않는다', () => {
    const before = row({ finalPrice: '19,500' });
    const after = row({ finalPrice: '21,000' });
    expect(detectEvents(snapshot(before), [after], '2026-08-20')).toEqual([]);
  });

  it('일정이 바뀌면 SCHEDULE_CHANGED', () => {
    const moved = row({ subStart: '2026-09-01', subEnd: '2026-09-02' });
    const events = detectEvents(snapshot(row()), [moved], '2026-08-20');
    expect(events[0]?.type).toBe('SCHEDULE_CHANGED');
    expect(events[0]?.detail).toBe('2026-08-25~2026-08-26 → 2026-09-01~2026-09-02');
  });
});

describe('filterUnsent — 멱등성', () => {
  it('이미 보낸 이벤트는 제외한다', () => {
    const events = detectEvents(snapshot(row()), [row()], TODAY);
    const log = { sent: [notifyKey(events[0]!, TODAY)] };
    expect(filterUnsent(events, log, TODAY)).toEqual([]);
  });

  it('같은 종목이라도 타입이 다르면 각각 발송된다', () => {
    const log = { sent: [`2307:D_MINUS_1:2026-08-24`] };
    const events = detectEvents(snapshot(row()), [row()], TODAY);
    expect(filterUnsent(events, log, TODAY).map((e) => e.type)).toEqual(['D_DAY']);
  });

  it('날짜가 다르면 같은 타입도 다시 발송된다', () => {
    const log = { sent: [`2307:D_DAY:2026-08-24`] };
    const events = detectEvents(snapshot(row()), [row()], TODAY);
    expect(filterUnsent(events, log, TODAY).map((e) => e.type)).toEqual(['D_DAY']);
  });
});

describe('pruneNotified', () => {
  it('보관 기간이 지난 이력만 지운다', () => {
    const log = { sent: ['1:D_DAY:2026-01-01', '2:D_DAY:2026-08-20'] };
    expect(pruneNotified(log, TODAY, 90).sent).toEqual(['2:D_DAY:2026-08-20']);
  });

  it('기본 보관 기간은 90일이다', () => {
    const log = { sent: [`1:D_DAY:${addDays(TODAY, -91)}`, `2:D_DAY:${addDays(TODAY, -89)}`] };
    expect(pruneNotified(log, TODAY).sent).toEqual([`2:D_DAY:${addDays(TODAY, -89)}`]);
  });

  it('경계일(정확히 cutoff)은 보존한다', () => {
    const log = { sent: [`1:D_DAY:${addDays(TODAY, -90)}`] };
    expect(pruneNotified(log, TODAY, 90).sent).toHaveLength(1);
  });

  it('날짜를 못 읽는 키는 지우지 않고 보존한다', () => {
    // 파싱 실패를 '만료'로 처리하면 멱등성이 깨져 중복 발송이 된다
    const log = { sent: ['badkey', 'no:type', '1:D_DAY:2026-08-20'] };
    expect(pruneNotified(log, TODAY, 90).sent).toEqual(['badkey', 'no:type', '1:D_DAY:2026-08-20']);
  });
});

describe('checkHealth', () => {
  it('0건은 치명적 실패로 처리한다', () => {
    const result = checkHealth([], snapshot(row()), TODAY);
    expect(result.ok).toBe(false);
    expect(result.fatal).toBeTruthy();
  });

  it('진행 예정 종목이 절반 이하로 급감하면 경고하되 진행한다', () => {
    const prev = snapshot(
      ...Array.from({ length: 10 }, (_, i) => row({ no: String(i), subEnd: '2026-09-30' })),
    );
    const result = checkHealth([row()], prev, TODAY);
    expect(result.ok).toBe(true);
    expect(result.warning).toContain('급감');
  });

  it('이미 끝난 공모가 목록에서 빠지는 것은 경고하지 않는다', () => {
    // 스냅샷의 다수는 종료된 공모다. 전체 건수로 비교하면 자연 이탈에 오경보가 난다.
    const prev = snapshot(
      ...Array.from({ length: 20 }, (_, i) =>
        row({ no: `old${i}`, subStart: '2026-01-01', subEnd: '2026-01-02' }),
      ),
      row(),
    );
    expect(checkHealth([row()], prev, TODAY)).toEqual({ ok: true });
  });

  it('정상 범위면 조용하다', () => {
    expect(checkHealth([row()], snapshot(row()), TODAY)).toEqual({ ok: true });
  });
});

describe('eventDate / notifyKey', () => {
  it('날짜 기반 이벤트는 실행일이 아니라 사건일에 고정된다', () => {
    const e = { type: 'D_DAY' as const, row: row() };
    // 하루 늦게 복구 실행해도 키가 같아야 중복 발송이 안 된다
    expect(notifyKey(e, TODAY)).toBe(notifyKey(e, '2026-08-26'));
    expect(notifyKey(e, TODAY)).toBe('2307:D_DAY:2026-08-25');
  });

  it('LAST_DAY는 마감일에 고정된다', () => {
    expect(notifyKey({ type: 'LAST_DAY', row: row() }, TODAY)).toBe('2307:LAST_DAY:2026-08-26');
  });

  it('diff 기반 이벤트는 발견한 날에 고정된다', () => {
    expect(notifyKey({ type: 'SCHEDULE_CHANGED', row: row() }, TODAY)).toBe(
      '2307:SCHEDULE_CHANGED:2026-08-25',
    );
  });
});

describe('날짜 유틸', () => {
  it('addDays는 월·연 경계를 넘는다', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  // KST 자정 경계는 15:00Z다. 이 경계를 집지 않으면 +8h/+10h 오프셋 버그도
  // 통과해버려서 테스트가 지키려는 요구사항을 실제로 지키지 못한다.
  it('todayKst는 KST 자정 경계(15:00Z)에서 날짜가 넘어간다', () => {
    expect(todayKst(new Date('2026-07-21T14:59:59Z'))).toBe('2026-07-21');
    expect(todayKst(new Date('2026-07-21T15:00:00Z'))).toBe('2026-07-22');
  });

  it('UTC 날짜와 다른 날을 준다', () => {
    // 2026-07-21T23:00Z 는 UTC로는 7/21, KST로는 7/22
    expect(todayKst(new Date('2026-07-21T23:00:00Z'))).toBe('2026-07-22');
  });
});
