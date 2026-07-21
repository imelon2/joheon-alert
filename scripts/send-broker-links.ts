/**
 * 증권사 버튼 16곳 전수 점검 메시지를 채널로 보낸다.
 *
 * 실제 알림과 동일한 buildBrokerKeyboard 를 쓰므로, 여기서 되면 알림에서도 된다.
 * 기기에서 눌러봐야만 알 수 있는 것 — 실제로 스토어가 열리는지 — 을 확인하는 용도다.
 *
 *   pnpm send:links
 */
import '../src/net.js';
import { requireEnv } from '../src/env.js';
import { BROKER_APP_URLS } from '../src/brokers.js';
import { buildBrokerKeyboard } from '../src/notify.js';

const names = Object.keys(BROKER_APP_URLS);
const keyboard = buildBrokerKeyboard(names);
if (!keyboard) throw new Error('만들 버튼이 없습니다.');

const text = [
  `🔗 증권사 버튼 전수 점검 (${names.length}곳)`,
  '',
  '아래 버튼을 하나씩 눌러 각 증권사 앱스토어로 가는지 확인해주세요.',
  '안 되는 곳이 있으면 그 이름을 알려주시면 됩니다.',
].join('\n');

const res = await fetch(
  `https://api.telegram.org/bot${requireEnv('TELEGRAM_BOT_TOKEN')}/sendMessage`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: requireEnv('TELEGRAM_CHAT_ID'),
      text,
      disable_web_page_preview: true,
      reply_markup: keyboard,
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
    `✓ ${names.length}곳 버튼 발송 (message_id=${json.result!.message_id}, ` +
      `${keyboard.inline_keyboard.length}줄)`,
  );
}
