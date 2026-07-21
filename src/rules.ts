import type { IpoEvent, IpoRow, NotifiedLog, Snapshot } from './types.js';

/**
 * 발송 판정. 네트워크·시계에 의존하지 않는 순수 함수라 전 케이스를 단위 테스트할 수 있다.
 *
 * @param today KST 기준 'YYYY-MM-DD'
 */
export function detectEvents(
  prev: Snapshot['items'],
  curr: IpoRow[],
  today: string,
): IpoEvent[] {
  const events: IpoEvent[] = [];
  const tomorrow = addDays(today, 1);
  const isFirstRun = Object.keys(prev).length === 0;

  for (const row of curr) {
    const before = prev[row.no];

    // --- 스냅샷 diff 기반 ---
    if (!before) {
      // 최초 실행은 기존 목록 전체가 'NEW'가 되어 32건이 쏟아진다. 베이스라인만 잡는다.
      if (!isFirstRun) events.push({ type: 'NEW', row });
    } else {
      // null→값(확정)뿐 아니라 값→값(정정)도 잡는다. 수요예측 재실시로 공모가가
      // 정정되는 경우가 실제로 있고, 구독자가 가장 알아야 할 변화다.
      if (row.finalPrice !== null && before.finalPrice !== row.finalPrice) {
        events.push({
          type: 'PRICE_FIXED',
          row,
          detail:
            before.finalPrice === null
              ? `희망 ${before.hopePrice ?? '-'} → 확정 ${row.finalPrice}`
              : `확정가 정정 ${before.finalPrice} → ${row.finalPrice}`,
        });
      }
      if (before.subStart !== row.subStart || before.subEnd !== row.subEnd) {
        events.push({
          type: 'SCHEDULE_CHANGED',
          row,
          detail: `${before.subStart}~${before.subEnd} → ${row.subStart}~${row.subEnd}`,
        });
      }
    }

    // --- 날짜 기반 (최초 실행에도 유효: 오늘 청약인 종목은 알려야 한다) ---
    if (row.subStart === tomorrow) events.push({ type: 'D_MINUS_1', row });
    if (row.subStart === today) events.push({ type: 'D_DAY', row });
    if (row.subEnd === today) events.push({ type: 'LAST_DAY', row });
  }

  return events;
}

/**
 * 이벤트가 '언제 일어난 일'인가. 실행 날짜가 아니라 사건 자체의 날짜다.
 *
 * 날짜 기반 이벤트를 실행일이 아닌 사건일에 고정해야, 같은 날 재시도나 수동
 * workflow_dispatch로 복구할 때 이미 보낸 것을 다시 보내지 않는다.
 */
export function eventDate(event: IpoEvent, today: string): string {
  switch (event.type) {
    case 'D_MINUS_1':
    case 'D_DAY':
      return event.row.subStart;
    case 'LAST_DAY':
      return event.row.subEnd;
    default:
      return today; // diff 기반 이벤트는 '발견한 날'이 곧 사건일
  }
}

/** 멱등성 키. event_type이 들어가야 같은 종목의 D-1/D_DAY/LAST_DAY가 각각 발송된다. */
export function notifyKey(event: IpoEvent, today: string): string {
  return `${event.row.no}:${event.type}:${eventDate(event, today)}`;
}

export function filterUnsent(
  events: IpoEvent[],
  log: NotifiedLog,
  today: string,
): IpoEvent[] {
  const sent = new Set(log.sent);
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = notifyKey(e, today);
    if (sent.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 발송 이력 무한 증식 방지.
 *
 * 날짜를 못 읽는 키는 '만료'가 아니라 '보존'으로 처리한다. 파싱 실패를 삭제로
 * 취급하면 멱등성이 깨져 중복 발송으로 이어지기 때문이다.
 */
export function pruneNotified(log: NotifiedLog, today: string, keepDays = 90): NotifiedLog {
  const cutoff = addDays(today, -keepDays);
  return {
    sent: log.sent.filter((key) => {
      const tail = key.split(':').at(-1);
      if (tail === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(tail)) return true;
      return tail >= cutoff;
    }),
  };
}

/**
 * 파싱 결과 건전성 검사. 0건을 '전 종목 사라짐'으로 오판해 오알림을 내는 것을 막는다.
 */
export function checkHealth(
  rows: IpoRow[],
  prev: Snapshot['items'],
  today: string,
): { ok: boolean; warning?: string; fatal?: string } {
  if (rows.length === 0) {
    return { ok: false, fatal: '파싱 결과 0건 — 사이트 구조 변경이 의심됩니다.' };
  }
  // 전체 건수로 비교하면 이미 끝난 공모(스냅샷의 다수)의 자연 이탈에 묻힌다.
  // 알림 대상인 '아직 안 끝난' 종목만 센다.
  const upcoming = (r: IpoRow) => r.subEnd >= today;
  const prevCount = Object.values(prev).filter(upcoming).length;
  const currCount = rows.filter(upcoming).length;
  if (prevCount > 0 && currCount < prevCount * 0.5) {
    return {
      ok: true,
      warning: `진행 예정 종목 급감: ${prevCount}건 → ${currCount}건`,
    };
  }
  return { ok: true };
}

export function toSnapshot(rows: IpoRow[], now: string): Snapshot {
  const items: Record<string, IpoRow> = {};
  for (const row of rows) items[row.no] = row;
  return { updatedAt: now, items };
}

/** KST 기준 오늘 'YYYY-MM-DD'. Actions 러너는 UTC이므로 반드시 변환해야 한다. */
export function todayKst(base = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(base);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
