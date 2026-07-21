import './net.js'; // Happy Eyeballs 폴백 시간 조정 (최우선 로드)
import { envSource, requireEnv } from './env.js';
import { fetchListHtml } from './fetch.js';
import { fetchListingDate } from './detail.js';
import { parseList } from './parse.js';
import { sendWithRetry } from './notify.js';
import { run } from './pipeline.js';
import { todayKst } from './rules.js';
import {
  NOTIFIED_PATH,
  SNAPSHOT_PATH,
  readNotified,
  readSnapshot,
  writeJson,
} from './store.js';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  // --date=YYYY-MM-DD 는 dry-run 전용. 실제 발송 시 날짜를 속이면
  // 잘못된 날짜의 멱등성 키가 남아 진짜 알림이 영구히 억제된다.
  const dateOverride = readDateFlag();
  if (dateOverride && !dryRun) {
    throw new Error('--date 는 --dry-run 과 함께만 사용할 수 있습니다.');
  }
  const today = dateOverride ?? todayKst();

  // 발송 자격증명은 실제로 보낼 때만 요구한다 (dry-run은 토큰 없이 검증 가능).
  const credentials = dryRun
    ? null
    : { token: requireEnv('TELEGRAM_BOT_TOKEN'), chatId: requireEnv('TELEGRAM_CHAT_ID') };

  if (credentials) {
    // 토큰 값은 절대 찍지 않는다. 출처만 알려준다.
    console.log(
      `[info] 자격증명 출처: TELEGRAM_BOT_TOKEN=${envSource('TELEGRAM_BOT_TOKEN')}, ` +
        `TELEGRAM_CHAT_ID=${envSource('TELEGRAM_CHAT_ID')}`,
    );
  }

  const result = await run(
    {
      fetchRows: async () => parseList(await fetchListHtml()),
      fetchListingDate,
      send: (text) => sendWithRetry(text, credentials!.token, credentials!.chatId),
      readSnapshot: () => readSnapshot(),
      readNotified: () => readNotified(),
      writeSnapshot: (value) => writeJson(SNAPSHOT_PATH, value),
      writeNotified: (value) => writeJson(NOTIFIED_PATH, value),
      log: (message) => console.log(message),
    },
    today,
    { dryRun },
  );

  if (dryRun) {
    if (result.messages.length === 0) {
      console.log('[info] 발송할 이벤트 없음.');
      return;
    }
    console.log('\n--- DRY RUN: 아래 메시지가 발송됩니다 ---\n');
    console.log(result.messages.join('\n\n──────────\n\n'));
    console.log('\n--- (dry-run이므로 state를 갱신하지 않습니다) ---');
    return;
  }

  if (result.statePersisted) {
    console.log(`[info] state 갱신: ${SNAPSHOT_PATH}, ${NOTIFIED_PATH}`);
  }
}

function readDateFlag(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--date='));
  if (!arg) return null;
  const value = arg.slice('--date='.length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`--date 형식이 잘못되었습니다: ${value} (YYYY-MM-DD)`);
  }
  return value;
}

main().catch((err: unknown) => {
  console.error(`[error] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
