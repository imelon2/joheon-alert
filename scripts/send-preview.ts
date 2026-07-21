/**
 * 특정 날짜 기준 알림을 실제로 텔레그램에 보낸다. **state는 건드리지 않는다.**
 *
 *   pnpm send:preview --date=2026-07-30
 *   pnpm send:preview                     # 오늘(KST) 기준
 *
 * 왜 main.ts 의 --date 를 풀지 않았나:
 *   main.ts 는 발송 후 notified.json 에 `{no}:{type}:{eventDate}` 를 남긴다.
 *   가짜 날짜로 실제 발송하면 그 키가 이력에 박혀, 정작 그날이 왔을 때
 *   "이미 보냈다"고 판단해 **진짜 알림이 영구히 억제된다.**
 *   그래서 이 스크립트는 파이프라인을 dryRun 으로 돌려 state 쓰기를 원천 차단하고,
 *   렌더링된 메시지만 따로 발송한다. 중복 방지 이력에도 남지 않으므로
 *   같은 날짜로 몇 번이든 다시 보낼 수 있다.
 */
import '../src/net.js'; // Happy Eyeballs 폴백 시간 조정 (최우선 로드)
import { envSource, requireEnv } from '../src/env.js';
import { fetchListHtml } from '../src/fetch.js';
import { fetchListingDate } from '../src/detail.js';
import { parseList } from '../src/parse.js';
import { buildBrokerKeyboard, sendWithRetry } from '../src/notify.js';
import { run } from '../src/pipeline.js';
import { todayKst } from '../src/rules.js';
import { readSnapshot } from '../src/store.js';

function readDateFlag(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--date='));
  if (!arg) return null;
  const value = arg.slice('--date='.length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`--date 형식이 잘못되었습니다: ${value} (YYYY-MM-DD)`);
  }
  return value;
}

async function main(): Promise<void> {
  const dateOverride = readDateFlag();
  const today = dateOverride ?? todayKst();

  const token = requireEnv('TELEGRAM_BOT_TOKEN');
  const chatId = requireEnv('TELEGRAM_CHAT_ID');
  // 토큰 값은 절대 찍지 않는다. 출처만 알려준다.
  console.log(
    `[info] 자격증명 출처: TELEGRAM_BOT_TOKEN=${envSource('TELEGRAM_BOT_TOKEN')}, ` +
      `TELEGRAM_CHAT_ID=${envSource('TELEGRAM_CHAT_ID')}`,
  );
  console.log(`[info] 기준일 ${today}${dateOverride ? ' (지정)' : ' (오늘, KST)'}`);

  // dryRun: true — 발송 이력·스냅샷을 쓰지 않는다. write* 는 호출되지 않지만
  // 실수로 호출되면 즉시 터지도록 던지는 스텁을 넣는다(조용한 오염 방지).
  const result = await run(
    {
      fetchRows: async () => parseList(await fetchListHtml()),
      fetchListingDate,
      send: async () => {
        throw new Error('도달 불가: dryRun 에서는 파이프라인이 발송하지 않습니다.');
      },
      readSnapshot: () => readSnapshot(),
      // 빈 이력으로 돌린다. 실제 이력을 읽으면 "이미 보낸 날짜"를 미리보기할 때
      // 조용히 '이벤트 없음'이 되어버린다. 이 스크립트는 이력을 남기지도 않으므로
      // 중복 방지를 적용할 이유가 없다 — 몇 번이든 다시 볼 수 있어야 한다.
      readNotified: async () => ({ sent: [] }),
      writeSnapshot: async () => {
        throw new Error('send:preview 는 state를 쓰지 않아야 합니다.');
      },
      writeNotified: async () => {
        throw new Error('send:preview 는 state를 쓰지 않아야 합니다.');
      },
      log: (message) => console.log(message),
    },
    today,
    { dryRun: true },
  );

  if (result.messages.length === 0) {
    console.log('[info] 해당 날짜에 발송할 이벤트가 없습니다. 보내지 않았습니다.');
    return;
  }

  // 미래/과거 날짜의 알림이 오늘 도착하면 진짜 알림과 헷갈린다. 표시를 남긴다.
  const banner = dateOverride ? `🧪 미리보기 (기준일 ${dateOverride})\n\n` : '';

  for (const [i, message] of result.messages.entries()) {
    await sendWithRetry(
      banner + message.text,
      token,
      chatId,
      buildBrokerKeyboard(message.brokers),
    );
    console.log(`[info] ${i + 1}/${result.messages.length}통 발송`);
  }
  console.log(
    `✓ ${result.pendingCount}건 / 메시지 ${result.messages.length}통 발송 완료 ` +
      '(state 미갱신 — 중복 방지 이력에 남지 않습니다)',
  );
}

main().catch((err: unknown) => {
  console.error(`[error] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
