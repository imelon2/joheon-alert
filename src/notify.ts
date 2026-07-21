import { brokerUrl, splitBrokers } from './brokers.js';
import type { EventType, IpoEvent, IpoRow } from './types.js';

/** 발송 메시지에서의 표시 순서. 급한 것부터. */
const SECTIONS: Array<{ type: EventType; heading: string }> = [
  { type: 'LAST_DAY', heading: '⚠️ 오늘 청약 마감' },
  { type: 'D_DAY', heading: '🔔 오늘 청약 시작' },
  { type: 'D_MINUS_1', heading: '⏰ 내일 청약 시작' },
  { type: 'SCHEDULE_CHANGED', heading: '📅 일정 변경' },
];

/** 텔레그램 sendMessage의 text 하드 상한. */
export const TELEGRAM_LIMIT = 4096;
/** 분할 기준. (n/m) 꼬리표와 멀티바이트 여유를 남긴다. */
const CHUNK_TARGET = 3500;

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** 4xx는 재시도해도 같은 결과다. 재시도 대상이 아니다. */
    readonly retryable: boolean,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

/**
 * HTML 모드에서 텍스트로 넣는 모든 값은 반드시 이스케이프해야 한다.
 *
 * 안 하면 종목명에 '&' 하나만 들어와도 텔레그램이 400(can't parse entities)을
 * 내고, 4xx는 재시도 불가라 그날 알림 배치가 통째로 유실된다.
 * 텔레그램 HTML은 &, <, > 세 개만 이스케이프하면 된다.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 값 없음은 모두 '-'. 원문의 '-'(공모가 미확정)와 ''(경쟁률 미집계)를 구분하지 않는다. */
const show = (value: string | null): string => escapeHtml(value ?? '-');

/**
 * 주간사 이름에 모바일 웹 링크를 건다. 원문은 '미래에셋증권,삼성증권' 처럼
 * 2곳이 붙어 오므로 각각 링크한다. 매핑에 없는 증권사는 링크 없이 이름만 —
 * 깨진 링크보다 낫다.
 */
function renderBrokers(underwriter: string | null): string {
  if (!underwriter) return '-';
  return splitBrokers(underwriter)
    .map((name) => {
      const url = brokerUrl(name);
      return url
        ? `<a href="${escapeHtml(url)}">${escapeHtml(name)}</a>`
        : escapeHtml(name);
    })
    .join(', ');
}

/**
 * 청약 기간. 같은 해면 종료일은 월-일만 보여 짧게 유지하고,
 * 해가 넘어가면(12/30~1/2) 연도까지 보여 오해를 막는다.
 */
function formatPeriod(row: IpoRow): string {
  const sameYear = row.subStart.slice(0, 4) === row.subEnd.slice(0, 4);
  return `${row.subStart} ~ ${sameYear ? row.subEnd.slice(5) : row.subEnd}`;
}

function renderItem(event: IpoEvent): string[] {
  const { row } = event;
  return [
    `  · ${escapeHtml(row.name)}`,
    ...(event.detail ? [`    변경    ${escapeHtml(event.detail)}`] : []),
    `    일정    ${formatPeriod(row)}`,
    `    상장일  ${show(row.listingDate)}`,
    `    확정가  ${show(row.finalPrice)}`,
    `    희망가  ${show(row.hopePrice)}`,
    `    경쟁률  ${show(row.ratio)}`,
    `    주간사  ${renderBrokers(row.underwriter)}`,
  ];
}

/**
 * 여러 이벤트를 묶되 텔레그램 상한을 넘지 않게 분할한다.
 *
 * 실측: 30건 SCHEDULE_CHANGED + 30건 D_MINUS_1 = 7140자로 상한을 넘는다.
 * 분할하지 않으면 HTTP 400이 나고, 400은 재시도해도 실패하므로 스냅샷이 영영
 * 갱신되지 않아 매일 같은 payload로 실패하는 무한 루프에 빠진다.
 *
 * 주간사 링크 때문에 HTML 모드로 보낸다. 삽입되는 모든 값은 escapeHtml을
 * 거쳐야 하며, 길이는 태그를 뺀 visibleLength로 잰다.
 */
export function renderMessages(
  events: IpoEvent[],
  today: string,
  limit = CHUNK_TARGET,
): string[] {
  if (events.length === 0) return [];

  const header = `📊 공모주 알림 (${today})`;
  const chunks: string[] = [];
  let lines: string[] = [header];

  for (const { type, heading } of SECTIONS) {
    const matched = events.filter((e) => e.type === type);
    let headingWritten = false;

    for (const event of matched) {
      const item = renderItem(event);
      const prefix = headingWritten ? [] : ['', heading];
      const tooLong = visibleLength([...lines, ...prefix, ...item].join('\n')) > limit;

      if (tooLong && lines.length > 1) {
        chunks.push(lines.join('\n'));
        lines = [header, '', heading, ...item];
      } else {
        lines.push(...prefix, ...item);
      }
      headingWritten = true;
    }
  }
  chunks.push(lines.join('\n'));

  const total = chunks.length;
  return chunks.map((chunk, i) => {
    const labelled = total > 1 ? `${chunk}\n\n(${i + 1}/${total})` : chunk;
    // 한 항목이 통째로 상한을 넘는 병리적 경우의 최후 방어.
    // 태그 중간에서 자르면 파싱이 깨지므로 여기서는 자르지 않고 그대로 둔다;
    // 정상 경로에서는 위 분할이 limit(<상한)을 지키므로 도달하지 않는다.
    return labelled;
  });
}

export async function sendTelegram(
  text: string,
  token: string,
  chatId: string,
): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      // 주간사 링크를 위해 HTML 모드. renderMessages가 넣는 값은 전부
      // escapeHtml을 거치므로 태그로 오인될 문자가 남아 있으면 안 된다.
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.ok) return;

  const body = await res.text();
  // 429는 텔레그램의 레이트리밋으로, retry_after 만큼 기다리면 성공한다.
  const retryAfter = res.status === 429 ? parseRetryAfter(body) : undefined;
  throw new TelegramError(
    `Telegram 발송 실패: HTTP ${res.status} ${body}`,
    res.status,
    res.status === 429 || res.status >= 500,
    retryAfter,
  );
}

/**
 * 수집(fetchListHtml)은 3회 재시도하는데 발송은 1회뿐이면 비대칭이다.
 * 발송 실패는 날짜 기반 이벤트(오늘 마감 등)의 영구 유실로 이어지므로 더 중요하다.
 */
export async function sendWithRetry(
  text: string,
  token: string,
  chatId: string,
  attempts = 3,
  send = sendTelegram,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await send(text, token, chatId);
      return;
    } catch (err) {
      lastError = err;
      if (err instanceof TelegramError && !err.retryable) throw err;
      if (i === attempts - 1) break;
      const waitSec = (err as TelegramError).retryAfterSec ?? 2 ** i;
      await sleep(waitSec * 1000);
    }
  }
  throw lastError;
}

function parseRetryAfter(body: string): number | undefined {
  try {
    const parsed = JSON.parse(body) as { parameters?: { retry_after?: number } };
    return parsed.parameters?.retry_after;
  } catch {
    return undefined;
  }
}

/**
 * 텔레그램의 4096자 상한은 **태그를 제외한 보이는 텍스트** 기준이다.
 * 실측: 원문 4689자 / 보이는 텍스트 약 270자 → 통과.
 *       보이는 텍스트 4200자 → 'message is too long' 거부.
 * 원문 길이로 재면 URL이 붙은 만큼 불필요하게 잘게 쪼개진다.
 */
export function visibleLength(html: string): number {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;|&gt;/g, 'x')
    .replace(/&amp;/g, '&').length;
}
