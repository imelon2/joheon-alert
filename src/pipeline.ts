import { TelegramError, renderMessages } from './notify.js';
import {
  checkHealth,
  detectEvents,
  filterUnsent,
  notifyKey,
  pruneNotified,
  toSnapshot,
} from './rules.js';
import type { IpoEvent, IpoRow, NotifiedLog, Snapshot } from './types.js';

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

/**
 * 발송 대상 이벤트에만 상장일을 채운다.
 *
 * 전체 30건이 아니라 실제로 알릴 종목(보통 1~3건)만 상세 페이지를 받는다.
 * 같은 종목이 여러 이벤트를 가질 수 있으므로 종목당 한 번만 조회한다.
 *
 * 상장일은 부가 정보다. 조회가 실패해도 알림 자체를 죽이지 않고 '-'로 둔다 —
 * 이걸 던지면 '오늘 청약 마감' 같은 본질적인 알림이 통째로 유실된다.
 */
async function enrichWithListingDate(
  events: IpoEvent[],
  fetchListingDate: Deps['fetchListingDate'],
  log: (message: string) => void,
): Promise<IpoEvent[]> {
  if (!fetchListingDate || events.length === 0) return events;

  const byNo = new Map<string, string | null>();
  for (const no of new Set(events.map((e) => e.row.no))) {
    try {
      byNo.set(no, await fetchListingDate(no)); // 사이트 부하를 줄이려 순차 조회
    } catch (err) {
      log(`[warn] 상장일 조회 실패 (no=${no}) — '-'로 표시합니다: ${String(err)}`);
      byNo.set(no, null);
    }
  }
  return events.map((e) => ({ ...e, listingDate: byNo.get(e.row.no) ?? null }));
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
      (isFirstRun ? ' | 최초 실행: 베이스라인 생성' : ''),
  );

  const pending = await enrichWithListingDate(
    filterUnsent(detectEvents(prevSnapshot.items, rows, today), notified, today),
    deps.fetchListingDate,
    log,
  );
  const messages = renderMessages(pending, today);

  const base: RunResult = {
    rowCount: rows.length,
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
  await deps.writeSnapshot(toSnapshot(rows, now));
  await deps.writeNotified(pruneNotified(notified, today));
  base.statePersisted = true;

  if (sendFailure) throw sendFailure;
  return base;
}
