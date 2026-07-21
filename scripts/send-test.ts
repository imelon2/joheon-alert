/**
 * 발송 경로 일회성 점검.
 *
 * 운영 파이프라인(`src/main.ts`)은 건드리지 않는다. state를 읽지도 쓰지도 않고,
 * `--date` 같은 안전장치를 우회하지도 않는다. 오직 "토큰과 chat_id로 실제로
 * 메시지가 도착하는가"만 확인한다.
 *
 *   pnpm test:send            점검만 (실제 발송까지)
 *   pnpm test:send --check    발송 없이 토큰/권한 확인만
 */
import '../src/net.js'; // Happy Eyeballs 폴백 시간 조정 (최우선 로드)
import { requireEnv } from '../src/env.js';
import { buildBrokerKeyboard, renderMessages } from '../src/notify.js';
import type { IpoEvent } from '../src/types.js';

const API = 'https://api.telegram.org';

async function call(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!json.ok) throw new Error(`${method} 실패 (HTTP ${res.status}): ${json.description}`);
  return json.result as Record<string, unknown>;
}

function hint(message: string): string {
  if (message.includes('not enough rights') || message.includes('CHAT_WRITE_FORBIDDEN')) {
    return '봇이 채널 관리자이지만 [게시물 게시(Post Messages)] 권한이 꺼져 있습니다.';
  }
  if (message.includes('chat not found')) {
    return '채널을 못 찾았습니다. 공개 채널이면 @ 를 붙였는지, 비공개면 -100 접두사가 있는지, 그리고 봇을 관리자로 추가했는지 확인하세요.';
  }
  if (message.includes('Unauthorized')) {
    return '토큰이 잘못되었습니다. BotFather에서 발급값을 다시 확인하세요.';
  }
  return '';
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes('--check');
  const token = requireEnv('TELEGRAM_BOT_TOKEN');
  const chatId = requireEnv('TELEGRAM_CHAT_ID');

  // 1) 토큰이 유효한가
  const me = await call(token, 'getMe');
  console.log(`✓ 토큰 유효 — 봇 @${me['username']} (${me['first_name']})`);

  // 2) 대상 채팅에 접근 가능한가
  const chat = await call(token, 'getChat', { chat_id: chatId });
  console.log(`✓ 대상 확인 — ${chat['title'] ?? chat['username']} (type=${chat['type']}, id=${chat['id']})`);

  if (checkOnly) {
    console.log('\n(--check 이므로 발송하지 않고 종료합니다)');
    return;
  }

  // 3) 실제 알림과 동일한 렌더링으로 발송
  const sample: IpoEvent[] = [
    {
      type: 'D_DAY',
      row: {
        no: '0',
        name: '[발송 테스트] 예시종목',
        subStart: '2026-07-21',
        subEnd: '2026-07-22',
        finalPrice: '19,500',
        hopePrice: '16,500~19,500',
        ratio: null,
        underwriter: '미래에셋증권,삼성증권',
        url: 'http://www.38.co.kr/html/fund/?o=k',
      },
    },
  ];
  const [message] = renderMessages(sample, '2026-07-21');

  await call(token, 'sendMessage', {
    chat_id: chatId,
    text: `${message!.text}\n\n※ 발송 경로 점검용 테스트 메시지입니다.`,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: buildBrokerKeyboard(message!.brokers),
  });
  console.log('✓ 발송 완료 — 채널에 메시지가 도착했는지 확인하세요.');
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n✗ ${message}`);
  const h = hint(message);
  if (h) console.error(`  → ${h}`);
  process.exitCode = 1;
});
