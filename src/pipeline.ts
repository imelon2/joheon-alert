import { TelegramError, renderMessages } from './notify.js';
import {
  addDays,
  checkHealth,
  detectEvents,
  filterUnsent,
  notifyKey,
  pruneNotified,
  toSnapshot,
} from './rules.js';
import type { IpoRow, NotifiedLog, Snapshot } from './types.js';

export type Deps = {
  fetchRows: () => Promise<IpoRow[]>;
  send: (text: string) => Promise<void>;
  readSnapshot: () => Promise<Snapshot>;
  readNotified: () => Promise<NotifiedLog>;
  writeSnapshot: (value: Snapshot) => Promise<void>;
  writeNotified: (value: NotifiedLog) => Promise<void>;
  /** 종목별 상장일 조회. 목록 페이지엔 없어서 상세 페이지를 따로 받아야 한다. */
  fetchListingDate?: (no: string) => Promise<string | null>;
  log?: (message: string) => void;
  /** 스냅샷 타임스탬프. 테스트에서 고정하기 위해 주입 가능. */
  now?: () => string;
};

export type RunResult = {
  rowCount: number;
  pendingCount: number;
  messages: string[];
  sent: boolean;
  statePersisted: boolean;
  warning?: string;
};

/** 상장일을 다시 조회할 대상의 기간 상한. 이보다 오래 끝난 공모는 포기한다. */
const LISTING_LOOKBACK_DAYS = 60;
/** 한 실행에서 받을 상세 페이지 수 상한. 첫 실행에 몰리는 것을 막는다. */
const LISTING_FETCH_CAP = 20;

/**
 * 모든 행에 상장일을 채운다. 스냅샷에 저장되므로 Mini App 같은 소비자도 쓸 수 있다.
 *
 * 조회 비용을 아끼는 규칙:
 *   - 이전 스냅샷에 값이 있으면 그대로 이어받는다 (확정된 상장일은 바뀌지 않는다)
 *   - 아직 모르는(null) 행만, 그것도 최근 60일 이내 종목만 상세 페이지를 받는다
 * 그래서 첫 실행에 몰렸다가 날이 갈수록 조회 수가 줄어든다.
 *
 * 상장일은 부가 정보다. 조회가 실패해도 알림 자체를 죽이지 않고 null로 둔다 —
 * 이걸 던지면 '오늘 청약 마감' 같은 본질적인 알림이 통째로 유실된다.
 */
async function enrichListingDates(
  rows: IpoRow[],
  prev: Snapshot['items'],
  fetchListingDate: Deps['fetchListingDate'],
  today: string,
  log: (message: string) => void,
): Promise<IpoRow[]> {
  // 1) 이미 아는 값 이어받기
  const carried = rows.map((row) => ({
    ...row,
    listingDate: row.listingDate ?? prev[row.no]?.listingDate ?? null,
  }));
  if (!fetchListingDate) return carried;

  // 2) 아직 모르는 것 중 최근 종목만 조회 대상
  const cutoff = addDays(today, -LISTING_LOOKBACK_DAYS);
  const targets = carried.filter((r) => r.listingDate === null && r.subEnd >= cutoff);
  const picked = targets.slice(0, LISTING_FETCH_CAP);
  if (targets.length > picked.length) {
    // 조용한 상한은 '전부 처리했다'로 오해되기 쉽다. 남은 수를 남긴다.
    log(`[info] 상장일 조회 상한 ${LISTING_FETCH_CAP}건 — ${targets.length - picked.length}건은 다음 실행으로 미룸`);
  }
  if (picked.length === 0) return carried;

  const found = new Map<string, string | null>();
  for (const row of picked) {
    try {
      found.set(row.no, await fetchListingDate(row.no)); // 사이트 부하를 줄이려 순차 조회
    } catch (err) {
      log(`[warn] 상장일 조회 실패 (no=${row.no}) — null로 둡니다: ${String(err)}`);
    }
  }
  const filled = [...found.values()].filter(Boolean).length;
  log(`[info] 상장일 조회 ${picked.length}건 → ${filled}건 확인, ${picked.length - filled}건 미정`);

  return carried.map((row) =>
    found.has(row.no) ? { ...row, listingDate: found.get(row.no) ?? null } : row,
  );
}

/**
 * ①~⑦ 오케스트레이션. 의존성을 주입받아 발송 실패 시 state를 쓰지 않는다는
 * 핵심 불변식을 테스트할 수 있게 한다.
 *
 * @param today KST 'YYYY-MM-DD'
 */
export async function run(
  deps: Deps,
  today: string,
  opts: { dryRun: boolean },
): Promise<RunResult> {
  const log = deps.log ?? (() => {});

  const prevSnapshot = await deps.readSnapshot();
  const notified = await deps.readNotified();
  const rows = await deps.fetchRows();

  const health = checkHealth(rows, prevSnapshot.items, today);
  if (health.warning) log(`[warn] ${health.warning}`);
  if (!health.ok) throw new Error(health.fatal);

  const isFirstRun = Object.keys(prevSnapshot.items).length === 0;
  log(
    `[info] ${rows.length}건 수집 | 기준일 ${today} (KST)` +
      (isFirstRun ? ' | 최초 실행: 일정 변경 비교용 베이스라인 생성' : ''),
  );

  // 이벤트 판정과 스냅샷 저장 모두 상장일이 채워진 행을 써야 한다.
  const enriched = await enrichListingDates(
    rows,
    prevSnapshot.items,
    deps.fetchListingDate,
    today,
    log,
  );

  const pending = filterUnsent(
    detectEvents(prevSnapshot.items, enriched, today),
    notified,
    today,
  );
  const messages = renderMessages(pending, today);

  const base: RunResult = {
    rowCount: enriched.length,
    pendingCount: pending.length,
    messages,
    sent: false,
    statePersisted: false,
    ...(health.warning ? { warning: health.warning } : {}),
  };

  // dry-run은 state를 절대 건드리지 않는다. 검증이 실제 발송 이력을 오염시키면 안 된다.
  if (opts.dryRun) return base;

  let sendFailure: unknown;
  if (messages.length > 0) {
    try {
      for (const message of messages) await deps.send(message);
      base.sent = true;
      log(`[info] ${pending.length}건 발송 완료 (메시지 ${messages.length}통).`);
    } catch (err) {
      // 4xx는 재시도해도 실패한다. state를 붙들고 있으면 매일 같은 payload로
      // 실패하는 무한 루프가 되어 이후 모든 알림이 죽는다. 한 배치를 포기하고
      // 전진하되, 종료 코드로 실패를 알린다.
      if (err instanceof TelegramError && !err.retryable) {
        log(`[error] 재시도 불가한 발송 실패 — 이 배치를 건너뛰고 전진합니다: ${err.message}`);
        sendFailure = err;
      } else {
        // 그 외(네트워크/5xx)는 state를 남기지 않아 다음 실행에서 재시도된다.
        throw err;
      }
    }
  } else {
    log('[info] 발송할 이벤트 없음.');
  }

  // ⑦ 저장은 발송 뒤에만. 순서가 반대면 발송 실패 시 이벤트가 영구 유실된다.
  for (const event of pending) notified.sent.push(notifyKey(event, today));
  const now = deps.now?.() ?? new Date().toISOString();
  await deps.writeSnapshot(toSnapshot(enriched, now));
  await deps.writeNotified(pruneNotified(notified, today));
  base.statePersisted = true;

  if (sendFailure) throw sendFailure;
  return base;
}
