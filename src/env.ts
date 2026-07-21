import { config } from 'dotenv';

/**
 * `.env` 를 process.env 로 로드한다.
 *
 * dotenv는 **이미 설정된 환경변수를 덮어쓰지 않는다**(override 기본값 false).
 * 이 프로젝트에서는 그게 정확히 원하는 동작이다 — GitHub Actions에서는 Secrets가
 * 실제 환경변수로 주입되므로, 리포에 `.env` 가 실수로 섞여도 Secrets가 이긴다.
 * 로컬에서는 실제 환경변수가 없으니 `.env` 값이 쓰인다.
 *
 * 이 모듈은 import 시점에 실행된다. `requireEnv` 는 호출 시점(= main 실행 중)에만
 * 값을 읽으므로 import 순서와 무관하게 항상 로드가 끝난 뒤에 동작한다.
 */
const shellKeys = new Set(Object.keys(process.env));
const fileKeys = new Set(Object.keys(config({ quiet: true }).parsed ?? {}));

export type EnvSource = 'shell' | 'dotenv' | 'missing';

/** 값이 어디서 왔는지. ".env를 고쳤는데 왜 안 먹지?" 를 즉시 판별하기 위한 진단용. */
export function envSource(name: string): EnvSource {
  if (!process.env[name]) return 'missing';
  if (shellKeys.has(name)) return 'shell'; // 셸/Actions Secrets가 우선한다
  return fileKeys.has(name) ? 'dotenv' : 'shell';
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `환경변수 ${name} 이(가) 설정되지 않았습니다. ` +
        `.env 파일에 넣거나(.env.example 참고) 셸에서 export 하세요.`,
    );
  }
  return value;
}
