# 공모주 알림 — AI 작업 문서


## 개요

38.co.kr 공모주 청약일정을 매일 수집해, **놓치면 안 되는 시점에만** 텔레그램 채널로 알린다.

- 상시 서버 없음. **GitHub Actions cron**이 스케줄러, **리포 커밋**이 DB다.
- 실행 시각: `cron: '30 23 * * 0-4'` (UTC) = **평일 08:30 KST**
- 알림 본문 아래 **증권사 버튼** → GitHub Pages 리다이렉트 페이지 → 각 OS 앱스토어
- TypeScript / pnpm / Node 20+ / vitest. 빌드 없음(`tsx`로 직접 실행).

## 파일 지도

| 파일 | 역할 | 고칠 때 주의 |
|---|---|---|
| `src/main.ts` | CLI 진입점. 플래그 해석 → `run()` 호출 | `--date`는 `--dry-run` 전용 (불변식 3) |
| `src/pipeline.ts` | **오케스트레이션의 전부.** 의존성 주입(`Deps`) 구조 | 발송→저장 순서 (불변식 1) |
| `src/rules.ts` | 순수 함수. 이벤트 판정·멱등성 키·헬스체크·날짜 | 부수효과 넣지 말 것 |
| `src/parse.ts` | 목록 페이지 HTML → `IpoRow[]` | 사이트 개편 시 여기부터 깨진다 |
| `src/detail.ts` | 종목 상세 페이지 → 상장일 | 실패해도 throw 금지, null 반환 |
| `src/fetch.ts` | HTTP + euc-kr 디코딩 + 재시도 | 4xx는 즉시 실패 |
| `src/notify.ts` | 메시지 렌더링·분할·버튼·텔레그램 발송 | 삽입값은 전부 `escapeHtml` (불변식 2) |
| `src/brokers.ts` | 증권사 16곳 앱 링크 + slug | 고치면 `pnpm gen:brokers` (불변식 4) |
| `src/store.ts` | state JSON 읽기/쓰기 | — |
| `src/env.ts` | dotenv 로드, `requireEnv`, `envSource` | 토큰 값 로깅 금지 |
| `src/net.ts` | Happy Eyeballs 타임아웃 조정 | **최우선 import** 되어야 함 |
| `src/types.ts` | 데이터 모델 | — |
| `index.html` | 사이트 루트 = 증권사 리다이렉트 페이지 | 고치면 `REDIRECT_VERSION` ↑ (불변식 5) |
| `state/ipo.json` | 최신 스냅샷. diff 기준 + 외부 소비자 데이터 | 손으로 고치지 말 것 |
| `state/notified.json` | 발송 이력(90일). 중복 차단 | 손으로 고치지 말 것 |
| `state/brokers.json` | `src/brokers.ts`의 생성물. 웹페이지가 읽음 | 직접 편집 금지 — 생성물이다 |
| `.github/workflows/ipo-notify.yml` | cron + state 커밋 | `if: always()` 유지 (불변식 6) |

테스트 118개: `tests/{parse,rules,notify,pipeline,brokers,detail}.test.ts`.
픽스처는 **실제 응답을 euc-kr 그대로** 저장한 것(`tests/fixtures/*.euckr.html`).

## 데이터 흐름

```
fetchListHtml()          목록 HTML (euc-kr, http)
  → parseList()          IpoRow[] (30건 내외)
  → checkHealth()        0건이면 치명적 실패 — 발송도 저장도 안 함
  → enrichListingDates() 상세 페이지로 상장일 채움 (이전 스냅샷에서 이어받음)
  → detectEvents()       이전 스냅샷과 비교 + 오늘 날짜로 트리거 판정
  → filterUnsent()       notified.json 의 멱등성 키로 중복 제거
  → renderMessages()     HTML 메시지 (4096자 상한에 맞춰 분할)
  → send()               텔레그램 sendMessage + 증권사 인라인 버튼
  → writeSnapshot/Notified   ★ 발송 성공 뒤에만
```

### 발송 트리거 5종

| 트리거 | 조건 | 메시지 순서 |
|---|---|---|
| `SCHEDULE_CHANGED` | 이전 스냅샷 대비 일정 변경 | 1 (맨 위) |
| `LISTING_DAY` | **상장일 == 오늘** | 2 |
| `LAST_DAY` | 청약 마감일 == 오늘 | 3 |
| `D_DAY` | 청약 시작일 == 오늘 | 4 |
| `D_MINUS_1` | 청약 시작일 == 내일 | 5 |

**`SCHEDULE_CHANGED`가 맨 위인 이유:** 나머지는 '오늘/내일'이라 예상 가능하지만, 일정 변경은 사용자가 알고 있던 계획 자체를 뒤집는 정보라 먼저 봐야 한다.

**`LISTING_DAY`가 그다음인 이유:** 상장일 = 매도 가능일이다. 청약은 놓쳐도 다음 기회가 있지만 상장일을 놓치면 실제 손익이 갈린다. 08:30 발송이라 장 시작(09:00) 30분 전에 도착한다.

`listingDate`가 `null`(미정 또는 미조회)이면 조용히 넘어간다 — 없는 날짜로 알릴 수는 없다. 그래서 **상장일 조회 우선순위가 곧 이 알림의 신뢰도**다(아래 「상태 파일」 참고).

신규 등록·공모가 확정은 **의도적으로 제외**했다. 그 종목은 어차피 D-1에 알림이 나가고 그때 확정가·희망가가 함께 표시되므로 별도 알림은 소음이다. **되살리자는 제안을 받으면 이 결정을 먼저 언급할 것.**

멱등성 키: `` `${no}:${type}:${eventDate}` `` — **실행일이 아니라 사건일** 기준이다. 그래서 같은 날 수동 재실행으로 복구해도 중복 발송되지 않는다.

## 불변식 (깨면 조용히 망가진다)

### 1. 발송 → 저장 순서
`pipeline.ts`는 send가 성공한 **뒤에** state를 쓴다. 반대로 하면 발송 실패 시 이벤트가 영구 유실된다.
**지키는 것:** `tests/pipeline.test.ts` — 순서를 뒤집으면 5개가 깨진다.

예외가 하나 있다: **텔레그램 4xx는 state를 전진시킨다.** 4xx는 재시도해도 실패하므로, state를 붙들면 매일 같은 payload로 실패하는 무한 루프가 되어 이후 **모든** 알림이 죽는다. 한 배치를 포기하고 종료 코드로 실패를 알린다.

### 2. HTML 모드 — 삽입값은 전부 이스케이프
주간사 링크 때문에 `parse_mode: 'HTML'`을 쓴다. 종목명에 `&` 하나만 들어와도 이스케이프를 빠뜨리면 400(can't parse entities)이 나고, 4xx라 재시도도 안 되어 그날 배치가 통째로 유실된다. 새 필드를 추가하면 **반드시** `escapeHtml()`을 통과시킬 것.

### 3. `--date`로 실제 발송하지 않기
`main.ts`의 `--date`는 `--dry-run` 전용이고, 이 제약을 풀면 안 된다. 가짜 날짜로 발송하면 그 **사건일** 키가 `notified.json`에 박혀, 정작 그날 자동 실행이 "이미 보냈다"고 판단해 건너뛴다. 조용히 죽는 종류의 실패다.
특정 날짜 알림을 실제로 받아보려면 **`pnpm send:preview --date=...`** 를 쓴다 — state를 전혀 쓰지 않는 별도 경로다.

### 4. `state/brokers.json`은 생성물
`src/brokers.ts`를 고쳤으면 `pnpm gen:brokers`. 어긋난 채 커밋하면 웹페이지가 옛 링크를 쓴다.
**지키는 것:** `tests/brokers.test.ts`가 CI에서 잡는다.

### 5. `index.html`을 고치면 `REDIRECT_VERSION`을 올린다
버튼 URL의 `v` 파라미터가 바뀌어야 캐시된 옛 페이지 대신 새 페이지가 열린다. 이걸 빠뜨려 수정이 반영되지 않는 문제를 **실제로 겪었다.**

### 6. 워크플로 state 커밋 스텝의 `if: always()`
4xx일 때 파이프라인은 state를 전진시키고 실패로 끝난다. 여기서 커밋을 건너뛰면 불변식 1의 무한 루프가 그대로 재현된다.
같은 이유로 `concurrency: cancel-in-progress: false`, 그리고 두 state 파일은 **한 커밋에** 넣는다(커밋이 곧 영속화 경계).

## 명령어

```bash
pnpm install
pnpm test                              # 118개. 커밋 전 항상
pnpm typecheck
pnpm dry-run                           # 실제 크롤 → 발송 예정 메시지 콘솔 출력 (토큰 불필요)
pnpm tsx src/main.ts --dry-run --date=2026-07-30   # 특정 날짜 기준 확인
pnpm send:preview --date=2026-07-30    # 그 날짜 알림을 실제 발송 (state 미갱신, 재발송 가능)
pnpm send:links                        # 증권사 버튼 16곳 전수 점검 메시지
pnpm gen:brokers                       # src/brokers.ts → state/brokers.json
pnpm start                             # 실전 실행. state를 갱신한다
```

`send:preview`는 지정 날짜면 본문 맨 위에 `🧪 미리보기` 배너가 붙고, 발송 이력을 빈 값으로 읽어 **같은 날짜로 몇 번이든** 다시 보낼 수 있다.

## 함정 (전부 실측으로 확인된 것)

### 대상 사이트
- 응답 인코딩이 **euc-kr**. `TextDecoder('euc-kr')`는 full-ICU 빌드가 필요하다 — 워크플로가 Node 24 공식 배포판을 쓰는 이유다.
- **HTTPS 불가.** 서버 DH 파라미터가 약해 Node/OpenSSL3이 `ERR_SSL_DH_KEY_TOO_SMALL`로 거절한다. 자격증명을 보내지 않는 공개 GET이라 `http://`를 쓴다. **"보안상 https로 바꾸자"는 제안은 여기서 막힌다.**
- 일정 원문 `2026.08.25~08.26`은 **끝 날짜에 연도가 없다.** 연말 걸침은 +1년 처리.
- 미정 표기가 컬럼마다 다르다: 확정공모가는 `-`, 경쟁률은 `''`. 파서는 둘 다 null로 정규화한다.
- 파싱 0건은 정상이 아니라 **실패**로 처리한다(오알림 방지).

### 텔레그램
- 4096자 상한은 **태그를 뺀 보이는 텍스트** 기준이다. 실측: 원문 4689자 통과 / 보이는 텍스트 4200자 거부. 그래서 `visibleLength()`로 잰다.
- 채널에서는 **`web_app` 버튼이 막혀 있다**(`BUTTON_TYPE_INVALID`). `url` 버튼만 쓸 수 있고, 그래서 수신자 OS를 알 수 없다 → 리다이렉트 페이지가 필요한 이유.
- **커스텀 스킴(`samsungpop://` 등)은 링크로 렌더링되지 않는다.** 세 링크 모두 http(s)여야 한다.
- Telegram Mini App은 **페이지를 오래 캐시해** 코드 수정이 기기에 반영되지 않았다. 그래서 Mini App을 버리고 평범한 Pages + `userAgent` 판별로 갔다. **"Mini App으로 하자"는 제안을 받으면 이 이력을 먼저 언급할 것.**
- `window.open`은 클릭 핸들러 밖에서 팝업 차단된다. `location.replace`를 쓴다.

### Node
- `src/net.ts`가 **가장 먼저** import 되어야 한다. Happy Eyeballs 기본 attempt 타임아웃 250ms는 IPv6가 라우팅 불가일 때 너무 짧아 `fetch failed`가 난다 → 1000ms로 올렸다.

## 증권사 앱 연결

```
알림 버튼 → https://imelon2.github.io/joheon-alert/?b=<slug>&v=<ver>
          → userAgent 판별 → Play 스토어 / App Store
```

`landing` 직행이면 16곳 중 2곳만 스토어로 간다. 리다이렉트 페이지를 거쳐야 전부 간다.
배포는 GitHub Pages(Settings → Pages → `main` / `/ (root)`). 사이트 루트가 곧 이 페이지이고, 파라미터 없이 들어오면 안내 문구만 보여준다.

`src/brokers.ts`의 링크 32개(Play 패키지 16 + iOS 앱 ID 16)는 2026-07-21에 전수 검증했다 — iOS는 iTunes Lookup API로 **앱 이름까지** 확인. 삼성증권 `landing`은 `m.samsungpop.com/?h=mPOPNew`를 유지한다(다른 후보는 스토어로 보내지 않는 일반 웹페이지였다).

## 실패 처리

| 상황 | 동작 |
|---|---|
| 사이트 응답 없음 | 3회 백오프 재시도. 4xx는 즉시 실패 |
| 파싱 0건 | **치명적.** 발송도 저장도 안 함 |
| 진행 예정 종목 50%↓ | 경고만 하고 진행 |
| 상장일 조회 실패 | null로 두고 계속 — 부가 정보가 본질적 알림을 죽이면 안 된다 |
| 텔레그램 5xx·네트워크 | 3회 재시도(429는 `retry_after` 존중). 실패 시 **state 미갱신** → 다음 실행에서 재시도 |
| 텔레그램 4xx | 배치 포기, **state는 전진**, 종료 코드로 실패 통보 (불변식 1) |

**알려진 한계:** 하루치 실행이 통째로 실패하면 그날의 `LISTING_DAY`·`LAST_DAY`처럼 **그날에만 유효한** 알림은 복구되지 않는다. 같은 날 `workflow_dispatch` 수동 실행이 유일한 복구 경로다.

## 상태 파일

`state/ipo.json`의 `listingDate`는 목록에 없어 **상세 페이지를 따로 받아** 채운다. 비용을 아끼려고:
이전 스냅샷 값을 이어받고 → `null`인 행만 → 최근 **60일 이내** 종목만 → 한 실행당 최대 **20건**(초과분은 로그를 남기고 다음 실행으로).
실측: 19건 조회에 약 3초.

**조회 순서가 `LISTING_DAY` 알림의 신뢰도를 결정한다.** 상한에 걸려 잘릴 때 상장 임박 종목이 잘리면 그날 매도 알림을 통째로 놓친다. 상장은 청약 마감 1~2주 뒤이므로 **`subEnd`가 오늘에 가까운 순서**로 조회한다.
**지키는 것:** `tests/pipeline.test.ts`의 "조회 상한에 걸리면 상장이 임박한 종목부터 받는다" — 정렬을 지우면 깨진다.

상장일은 청약 시점에 미정인 경우가 많고(실측: 30건 중 19건이 `null`, 그중 11건만 확정) 나중에 공지된다. `null`인 행은 매 실행 다시 조회하므로 확정되는 즉시 채워진다.

**최초 실행은 베이스라인만 만든다** — 일정 변경을 비교할 기준이 없어서다. 단 날짜 기반 트리거는 최초 실행에도 동작한다.

## 설정

```bash
cp .env.example .env   # TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
```

우선순위는 **실제 환경변수 > `.env`** (dotenv `override` 기본값 `false`). 그래서 Actions에서는 Secrets가 이긴다. 실행 시 값은 찍지 않고 출처만 남긴다:

```
[info] 자격증명 출처: TELEGRAM_BOT_TOKEN=shell, TELEGRAM_CHAT_ID=dotenv
```

`.env`를 고쳤는데 안 먹으면 이 줄이 `shell`인지 보면 된다 — 셸에 export 되어 있다는 뜻이다.

`TELEGRAM_CHAT_ID`는 개인 대화(`987654321`) / 공개 채널(`@name`) / 비공개 채널(`-100...`) 세 형태를 그대로 넣는다. 채널은 **봇을 관리자로 추가하고 게시물 게시 권한**을 켜야 한다(안 켜면 403).

리포 설정 두 가지: Settings → Secrets에 위 두 개, Settings → Actions → Workflow permissions **Read and write**(state 커밋용).

### 보안 규칙
- 토큰은 `.env`(gitignored)와 리포 Secrets에만 존재한다. **로그·커밋·대화 어디에도 값을 남기지 않는다.**
- `.omc/`는 커밋하지 않는다(세션 ID 등이 공개 리포로 샌다).

## 스케줄을 바꿀 때

`cron`은 **항상 UTC**다. 현재 `'30 23 * * 0-4'`에서 요일이 하루 당겨진 것은 **의도된 것** — 23:30 UTC는 아직 전날이라 UTC 일~목 = KST 월~금이다.

**09:00 KST 이후로 옮기면 UTC가 당일로 넘어가므로 요일도 `1-5`로 바꿔야 한다.** 놓치면 월요일이 빠지고 토요일에 알림이 간다.

바꾼 뒤 **기본 브랜치에 푸시하면 그걸로 반영된다**(UI 조작 불필요). 실행은 수 분~수십 분 지연될 수 있다. 리포가 60일간 조용하면 스케줄이 자동 비활성화되지만, 이 워크플로는 매 실행마다 state를 커밋하므로 해당되지 않는다.

## 작업 체크리스트

**변경 전:** `pnpm test`로 기준선 확인.
**변경 후:** `pnpm test` + `pnpm typecheck` + `pnpm dry-run`(네트워크 경로까지 확인).

| 무엇을 고쳤나 | 추가로 할 일 |
|---|---|
| `src/brokers.ts` | `pnpm gen:brokers` |
| `index.html` | `REDIRECT_VERSION` ↑, 실기기/Chromium 확인 |
| 메시지 렌더링 | 새 삽입값이 `escapeHtml`을 통과하는지, `send:preview`로 실물 확인 |
| 파서 | 실제 응답으로 픽스처 갱신(euc-kr 원본 그대로) |
| 파이프라인 | 발송 실패 시 state 미갱신 테스트가 여전히 도는지 |
| cron | 요일 매핑 재계산 (위 절) |

**주의:** 이 프로젝트에서 "테스트가 통과한다"는 충분조건이 아니었다. 실제로 깨진 것들 — 커스텀 스킴 링크, 팝업 차단, Mini App 캐시 — 은 **전부 서버 응답이 200이었고 단위 테스트도 통과했다.** 사용자에게 보이는 경로를 바꿨다면 실물로 확인할 것.
