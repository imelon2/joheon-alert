# 공모주 알림 (38.co.kr)

38.co.kr 공모주 청약일정을 수집해, **놓치면 안 되는 시점에만** 텔레그램으로 알립니다.
매일 목록을 덤프하지 않습니다.

## 발송 트리거

| 트리거 | 조건 |
|---|---|
| `D_MINUS_1` | 청약 시작일 == 내일 |
| `D_DAY` | 청약 시작일 == 오늘 |
| `LAST_DAY` | 청약 마감일 == 오늘 |
| `SCHEDULE_CHANGED` | 청약 일정 변경 |

신규 등록과 공모가 확정은 **의도적으로 트리거에서 뺐습니다.** 해당 종목은 어차피 D-1에 알림이 나가고 그때 확정가·희망가가 함께 표시되므로, 별도 알림은 소음이 됩니다.

멱등성 키는 `{no}:{type}:{date}`. 재실행·수동 실행에도 같은 알림이 두 번 가지 않습니다.

## 로컬 실행

```bash
pnpm install
pnpm test              # 파서·룰·렌더링 단위 테스트
pnpm dry-run           # 실제 크롤 후 발송 예정 메시지를 콘솔 출력 (토큰 불필요)

# 특정 날짜 기준으로 확인 (dry-run 전용)
pnpm tsx src/main.ts --dry-run --date=2026-07-30
```

## 설정 (.env)

```bash
cp .env.example .env
# .env 를 열어 TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID 채우기
pnpm start
```

`.env` 는 `.gitignore` 대상입니다. **토큰이 들어가므로 절대 커밋하지 마세요.**

### 받는 곳 (`TELEGRAM_CHAT_ID`)

세 가지 형태를 모두 그대로 넣을 수 있습니다. 값은 문자열로 전달되므로 코드 분기가 없습니다.

| 대상 | 값 | 비고 |
|---|---|---|
| 개인 대화 | `987654321` | 봇에게 `/start` 를 먼저 보내야 함 |
| 공개 채널 | `@my_ipo_alerts` | 가장 간단. 숫자 ID 불필요 |
| 비공개 채널 | `-1001234567890` | `-100` 접두사 포함 |

채널을 쓸 때는 **봇을 채널 관리자로 추가하고 `게시물 게시(Post Messages)` 권한을 켜야** 합니다. 안 켜면 403이 납니다.

ID 확인 (개인 대화는 `message`, 채널은 `channel_post` 로 오므로 둘 다 처리):

```bash
curl -s "https://api.telegram.org/bot<토큰>/getUpdates" | python3 -c "
import sys, json
for u in json.load(sys.stdin)['result']:
    c = (u.get('channel_post') or u.get('message') or {}).get('chat')
    if c: print(c['id'], c.get('type'), c.get('title') or c.get('username'))
"
```

우선순위는 **실제 환경변수 > `.env`** 입니다 (dotenv의 `override` 기본값 `false`).

| 실행 환경 | 값의 출처 |
|---|---|
| 로컬 | `.env` |
| GitHub Actions | Secrets가 실제 환경변수로 주입 → **`.env` 가 있어도 Secrets가 이김** |
| 일회성 오버라이드 | `TELEGRAM_CHAT_ID=123 pnpm start` — 해당 변수만 셸 값이 이김 |

우선순위는 변수 단위로 적용됩니다. 실행 시 값은 찍지 않고 출처만 로그에 남습니다:

```
[info] 자격증명 출처: TELEGRAM_BOT_TOKEN=shell, TELEGRAM_CHAT_ID=dotenv
```

`.env` 를 고쳤는데 안 먹는다면 이 줄이 `shell` 인지 보면 됩니다 — 셸에 같은 이름이 export 되어 있다는 뜻입니다.

## 상태 파일

| 파일 | 역할 |
|---|---|
| `state/ipo.json` | 최신 스냅샷. 다음 실행의 diff 기준이자 외부 소비자(Mini App)의 데이터 소스 |
| `state/notified.json` | 발송 이력 (90일 보관). 중복 발송 차단 |

`ipo.json`의 `listingDate`(상장일)는 목록 페이지에 없어서 **종목별 상세 페이지를 따로 받아** 채웁니다. 조회 비용을 아끼려고:

- 이전 스냅샷에 값이 있으면 그대로 이어받습니다 (확정된 상장일은 바뀌지 않음)
- 아직 `null`인 행만, 그것도 **최근 60일 이내** 종목만 조회합니다
- 한 실행당 최대 20건 (초과분은 로그에 남기고 다음 실행으로)

그래서 첫 실행에 몰렸다가 날이 갈수록 조회 수가 줄어듭니다. 실측: 17건 조회에 2.7초.

DB 인스턴스 없이 리포에 커밋해 보관합니다. `git log -p state/ipo.json` 이 그대로 변경 이력이 됩니다.

**최초 실행은 베이스라인만 만듭니다** — 일정 변경을 비교할 기준이 없어서입니다. 단 날짜 기반 트리거(D-1/D-DAY/마감)는 최초 실행에도 동작합니다.

## 증권사 앱 연결 (go.html)

알림 메시지 아래 증권사 버튼을 누르면 각 OS의 앱스토어로 보냅니다.

```
버튼 → go.html?b=<slug> → userAgent 판별 → Play 스토어 / App Store
```

**왜 리다이렉트 페이지를 두는가.** 채널에서는 `web_app` 버튼이 막혀 있어(실측:
`BUTTON_TYPE_INVALID`) `url` 버튼만 쓸 수 있는데, url 버튼만으로는 수신자 OS를
알 수 없습니다. `landing` 직행이면 16곳 중 2곳만 스토어로 갑니다.

Telegram Mini App(`t.me/<봇>/<앱>`)도 시도했지만 **텔레그램이 페이지를 오래 캐시해
코드 수정이 기기에 반영되지 않았습니다.** 인앱 브라우저에서는 `userAgent` 만으로
OS 판별이 충분해서 Mini App 없이 갑니다.

`state/brokers.json` 은 `src/brokers.ts` 에서 생성합니다:

```bash
pnpm gen:brokers   # src/brokers.ts 를 고쳤다면 반드시 실행
```

어긋난 채 커밋되면 `tests/brokers.test.ts` 가 CI에서 잡습니다.

### 페이지를 고칠 때

**`src/brokers.ts` 의 `REDIRECT_VERSION` 을 올리세요.** 버튼 URL의 `v` 파라미터가
바뀌어야 캐시된 옛 페이지 대신 새 페이지가 열립니다. 이걸 빠뜨려서 수정이
반영되지 않는 문제를 실제로 겪었습니다.

### 배포

GitHub Pages: Settings → Pages → Source `Deploy from a branch` → `main` / `/ (root)`

사이트 루트(`/`)에는 페이지가 없습니다. `go.html` 만 씁니다.

## 사이트 특성 (구현 시 유의)

- 응답 인코딩이 **euc-kr**. `TextDecoder('euc-kr')` 사용 (full-ICU 빌드 필요, 아니면 즉시 실패)
- **HTTPS 불가** — 서버 DH 파라미터가 약해 Node/OpenSSL3이 `ERR_SSL_DH_KEY_TOO_SMALL`로 거절. 자격증명을 보내지 않는 공개 GET이라 http 사용
- 일정 원문 `2026.08.25~08.26` 은 **끝 날짜에 연도가 없음**. 연말 걸침은 +1년 처리
- 확정공모가 미정은 `-`, 경쟁률 미집계는 `''` — **서로 다른 표기**
- 파싱 0건은 정상이 아니라 **실패**로 처리 (오알림 방지)

## 실패 처리

| 상황 | 동작 |
|---|---|
| 사이트 응답 없음 | 3회 백오프 재시도. 4xx는 즉시 실패 |
| 파싱 0건 | **치명적 실패.** 발송도 저장도 하지 않음 |
| 진행 예정 종목 50%↓ | 경고만 하고 진행 |
| 텔레그램 5xx·네트워크 | 3회 재시도(429는 `retry_after` 존중). 실패 시 **state 미갱신** → 다음 실행에서 재시도 |
| 텔레그램 4xx | 재시도해도 실패하므로 이 배치를 포기하고 **state는 전진**. 종료 코드로 실패 통보 |

마지막 줄이 중요합니다. 4xx에서 state를 붙들면 매일 같은 payload로 실패하는 무한 루프가 되어 이후 모든 알림이 죽습니다. 메시지는 텔레그램 상한(4096자)에 맞춰 자동 분할됩니다.

멱등성 키는 **실행일이 아니라 사건일**에 고정되어 있어, 같은 날 수동 재실행으로 복구해도 중복 발송되지 않습니다.

## 자동 실행 (GitHub Actions)

상시 서버 없이 무료 cron + 상태 보관을 동시에 해결합니다.

`.github/workflows/ipo-notify.yml` — `cron: '30 22 * * 0-4'` (UTC) = **평일 07:30 KST**.
cron은 항상 UTC라 요일도 하루 당겨 적어야 합니다(UTC 일~목 = KST 월~금). 실행은 수 분~수십 분 지연될 수 있습니다.

리포 설정 두 가지가 필요합니다:

1. Settings → Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
2. Settings → Actions → Workflow permissions: **Read and write** (state 커밋용)

### 설계상 중요한 지점

**발송 → 저장 순서.** 반대면 발송 실패 시 이벤트가 영구 유실됩니다. 이 불변식은 `tests/pipeline.test.ts`가 지킵니다 — 순서를 뒤집으면 5개 테스트가 깨집니다.

**state 커밋 스텝의 `if: always()`.** 텔레그램 4xx일 때 파이프라인은 state를 전진시키고 실패로 끝나는데, 여기서 커밋을 건너뛰면 다음 날도 같은 payload로 실패하는 무한 루프가 되어 이후 모든 알림이 죽습니다.

**`concurrency: cancel-in-progress: false`.** 진행 중 실행을 취소하면 발송은 됐는데 state가 커밋되지 않아 다음 날 중복 발송이 납니다.

**두 state 파일을 한 커밋에.** 커밋이 곧 영속화 경계라, 로컬 쓰기 도중 러너가 죽어도 절반만 남는 상황이 생기지 않습니다.

### 알려진 한계

하루치 실행이 통째로 실패하면 그날의 `LAST_DAY`(오늘 마감) 알림은 복구되지 않습니다. 같은 날 `workflow_dispatch` 수동 실행이 유일한 복구 경로입니다. 실패는 Actions 기본 알림 메일로 통보됩니다.
