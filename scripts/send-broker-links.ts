/**
 * 증권사 링크 점검용 메시지를 채널로 보낸다.
 *
 * 실제 매핑(BROKER_APP_URLS)에서 링크를 가져오므로, URL을 고친 뒤 다시 돌리면
 * 바뀐 링크가 그대로 나간다. 기기에서 탭해봐야만 알 수 있는 것 —
 * 앱/스토어로 가는지 브라우저로 가는지 — 을 확인하는 용도다.
 *
 *   pnpm send:links
 */
import '../src/net.js';
import { requireEnv } from '../src/env.js';
import { BROKER_APP_URLS, type BrokerAppLinks } from '../src/brokers.js';
import { escapeHtml, visibleLength } from '../src/notify.js';

const MARK: Record<BrokerAppLinks['type'], string> = {
  'smart-link': '🟢',
  'download-page': '🔵',
  'official-page': '⚪',
};

// 앱 연결 가능성이 높은 것부터
const ORDER: BrokerAppLinks['type'][] = ['smart-link', 'download-page', 'official-page'];

const entries = Object.entries(BROKER_APP_URLS).sort(
  (a, b) => ORDER.indexOf(a[1].type) - ORDER.indexOf(b[1].type),
);

const lines = [
  `🔗 증권사 링크 점검 (${entries.length}곳)`,
  '',
  '각 이름을 탭해서 어디로 가는지 확인해주세요.',
  '🟢 스마트링크  🔵 다운로드 페이지  ⚪ 공식 페이지',
  '',
  ...entries.map(
    ([name, links]) =>
      `${MARK[links.type]} <a href="${escapeHtml(links.landing)}">${escapeHtml(name)}</a>`,
  ),
];
const text = lines.join('\n');

const res = await fetch(
  `https://api.telegram.org/bot${requireEnv('TELEGRAM_BOT_TOKEN')}/sendMessage`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: requireEnv('TELEGRAM_CHAT_ID'),
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(20_000),
  },
);
const json = (await res.json()) as {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
};

if (!json.ok) {
  console.error(`✗ 발송 실패: ${json.description}`);
  process.exitCode = 1;
} else {
  console.log(
    `✓ ${entries.length}곳 발송 완료 (message_id=${json.result!.message_id}, ` +
      `보이는 길이 ${visibleLength(text)}자)`,
  );
}
