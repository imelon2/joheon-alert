/**
 * src/brokers.ts → state/brokers.json 생성.
 *
 * 웹페이지가 증권사 링크를 알아야 하는데, 손으로 복사해두면 반드시 어긋난다.
 * TS를 단일 출처로 두고 여기서 뽑는다. 어긋난 채 커밋되면
 * tests/brokers.test.ts 가 잡는다.
 *
 *   pnpm gen:brokers
 */
import { writeFileSync } from 'node:fs';
import { BROKER_APP_URLS } from '../src/brokers.js';

writeFileSync('state/brokers.json', `${JSON.stringify(BROKER_APP_URLS, null, 2)}\n`, 'utf8');
console.log(`state/brokers.json 생성 (${Object.keys(BROKER_APP_URLS).length}곳)`);
