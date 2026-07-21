/**
 * 주간사 → 앱 링크.
 *
 * 2026-07-21 전수 검증:
 *   - `landing` 16곳: iPhone UA로 요청해 200 + 실제 컨텐츠 확인
 *   - `android` 16곳: Play 스토어 페이지 200 확인
 *   - `ios` 16곳: iTunes Lookup API로 **앱 이름까지** 확인
 *     (ID가 실재하지만 다른 앱인 경우를 걸러내기 위함)
 *
 * 메시지 본문의 인라인 링크는 `landing`을 쓴다(OS를 알 수 없으므로).
 * 본문 아래 **버튼**은 Mini App을 경유해 `android`/`ios` 중 맞는 쪽으로 보낸다 —
 * Mini App 안에서는 WebApp.platform 으로 OS가 판별되기 때문이다.
 */
export interface BrokerAppLinks {
  /**
   * Mini App 버튼 URL에 실을 식별자.
   *
   * 텔레그램 startapp 파라미터는 영숫자·`_`·`-` 만 허용해서 한글 이름을 못 쓴다.
   * 한 번 정하면 바꾸지 말 것 — 과거 메시지의 버튼이 전부 깨진다.
   */
  slug: string;
  /** 실제 탭 대상. 공식 통합·안내 페이지 또는 스마트링크. */
  landing: string;
  /** Android Google Play (현재 렌더링에 미사용) */
  android: string;
  /** iPhone App Store (현재 렌더링에 미사용) */
  ios: string;
  /**
   * landing이 어떤 성격인지.
   * - `smart-link`: OS 감지해 스토어로 보냄 (앱 연결에 가장 가까움)
   * - `download-page`: 앱 다운로드 안내 페이지
   * - `official-page`: 일반 공식 페이지
   */
  type: 'smart-link' | 'download-page' | 'official-page';
}

export const BROKER_APP_URLS: Readonly<Record<string, BrokerAppLinks>> = {
  DB증권: {
    landing: 'https://www.dbsec.co.kr/main/main.do',
    android: 'https://play.google.com/store/apps/details?id=com.dbfi.xts',
    ios: 'https://apps.apple.com/kr/app/id1603371564', // DB증권 MTS(알파증권)
    slug: 'db',
    type: 'official-page',
  },
  IBK투자증권: {
    landing: 'https://m.ibks.com/ikd/IKD060101.do?cam_from=mw_main_top2',
    android: 'https://play.google.com/store/apps/details?id=com.ibks.ione.mts',
    ios: 'https://apps.apple.com/kr/app/id6612018102', // IBK투자증권 Wings
    slug: 'ibk',
    type: 'download-page',
  },
  KB증권: {
    landing: 'https://m.kbsec.com/lms/mobile_menu1.html',
    android: 'https://play.google.com/store/apps/details?id=com.kbsec.mts.iplustarngm2',
    ios: 'https://apps.apple.com/kr/app/id350742701', // KB M-able
    slug: 'kb',
    type: 'download-page',
  },
  NH투자증권: {
    landing: 'https://www.mynamuhbegin.com/',
    android: 'https://play.google.com/store/apps/details?id=com.wooriwm.txsmart',
    ios: 'https://apps.apple.com/kr/app/id486312400', // 나무증권
    slug: 'nh',
    type: 'official-page',
  },
  교보증권: {
    landing: 'https://www.iprovest.com/customhelp/channel/smartpro.htm',
    android: 'https://play.google.com/store/apps/details?id=kr.com.wink',
    ios: 'https://apps.apple.com/kr/app/id1282214166', // 교보증권 Win.K
    slug: 'kyobo',
    type: 'download-page',
  },
  대신증권: {
    landing: 'https://m.daishin.com/g.ds?m=3821&p=4141&v=3101',
    android: 'https://play.google.com/store/apps/details?id=com.daishin',
    ios: 'https://apps.apple.com/kr/app/id414850336', // 대신증권 CYBOS Touch
    slug: 'daishin',
    type: 'download-page',
  },
  메리츠증권: {
    landing: 'https://home.imeritz.com/mobile/sub/MblApp.html',
    android: 'https://play.google.com/store/apps/details?id=com.imeritz.smartmeritz',
    ios: 'https://apps.apple.com/kr/app/id1104272974', // 메리츠SMART
    slug: 'meritz',
    type: 'download-page',
  },
  미래에셋증권: {
    // OneLink 실측: Android → market://details?id=com.miraeasset.trade
    //               iOS     → itunes.apple.com/kr/app/id1248716281
    landing: 'https://onelink.to/m.stock',
    android: 'https://play.google.com/store/apps/details?id=com.miraeasset.trade',
    ios: 'https://apps.apple.com/kr/app/id1248716281', // 미래에셋증권 M-STOCK
    slug: 'mirae',
    type: 'smart-link',
  },
  삼성증권: {
    // www.samsungpop.com/mbw/start/start_main.pop 은 스토어로 안 보내는 일반
    // 웹페이지다(실측). 이쪽은 iPhone UA에서 App Store로 리다이렉트하므로 유지한다.
    landing: 'http://m.samsungpop.com/?h=mPOPNew',
    android: 'https://play.google.com/store/apps/details?id=com.samsungpop.android.mpop',
    ios: 'https://apps.apple.com/kr/app/id1150231646', // 삼성증권 mPOP
    slug: 'samsung',
    type: 'smart-link',
  },
  신한투자증권: {
    landing: 'https://www.shinhansec.com/siw/customer-center/channel/75060307/view.do',
    android: 'https://play.google.com/store/apps/details?id=com.shinhaninvest.nsmts',
    ios: 'https://apps.apple.com/kr/app/id1168512940', // 신한 SOL증권
    slug: 'shinhan',
    type: 'download-page',
  },
  유안타증권: {
    landing: 'https://www.tradar.co.kr/',
    android: 'https://play.google.com/store/apps/details?id=com.yuanta.tradars',
    ios: 'https://apps.apple.com/kr/app/id6482289992', // 유안타증권 티레이더M
    slug: 'yuanta',
    type: 'official-page',
  },
  유진투자증권: {
    landing: 'https://www.eugenefn.com/serv/svwc/getSvwc500p.do?svwcHeader=500&svwcLeft=520',
    android: 'https://play.google.com/store/apps/details?id=com.eugenefn.smartchampion2',
    ios: 'https://apps.apple.com/kr/app/id1080300592', // 유진투자증권
    slug: 'eugene',
    type: 'download-page',
  },
  키움증권: {
    landing: 'https://www.kiwoom.com/h/customer/download/VChannelHts4View',
    android: 'https://play.google.com/store/apps/details?id=com.kiwoom.heromts',
    ios: 'https://apps.apple.com/kr/app/id1570370057', // 키움증권 영웅문S#
    slug: 'kiwoom',
    type: 'download-page',
  },
  하나증권: {
    landing: 'https://www.hanaw.com/main/customer/event/CS_112405_P.cmd?tab=y',
    android: 'https://play.google.com/store/apps/details?id=com.hanasec.stock',
    ios: 'https://apps.apple.com/kr/app/id1506702407', // 하나증권 원큐프로
    slug: 'hana',
    type: 'official-page',
  },
  한국투자증권: {
    landing:
      'https://securities.koreainvestment.com/main/customer/systemdown/_static/TF04eb031400_2n.shtm',
    android: 'https://play.google.com/store/apps/details?id=com.truefriend.neosmartarenewal',
    ios: 'https://apps.apple.com/kr/app/id1621986905', // 한국투자증권 MTS
    slug: 'koreainvest',
    type: 'download-page',
  },
  현대차증권: {
    landing: 'https://www.hmsec.com/mobile/download.to',
    android: 'https://play.google.com/store/apps/details?id=com.hmsec.mts',
    ios: 'https://apps.apple.com/kr/app/id6444633082', // 현대차증권 내일
    slug: 'hyundai',
    type: 'download-page',
  },
};

/** 원문은 '미래에셋증권,삼성증권' 처럼 2곳 이상이 콤마로 붙어 온다(실데이터의 30%). */
export function splitBrokers(underwriter: string): string[] {
  return underwriter
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 메시지에 걸 링크. 매핑에 없는 증권사는 undefined —
 * 링크 없이 이름만 나가는 게 깨진 링크보다 낫다.
 */
export function brokerUrl(name: string): string | undefined {
  return BROKER_APP_URLS[name]?.landing;
}

/**
 * 버튼이 향하는 리다이렉트 페이지.
 *
 * Mini App(t.me/<봇>/<앱>)을 쓰지 않는다. 텔레그램이 Mini App 페이지를 오래
 * 캐시해 코드 수정이 반영되지 않는 문제를 겪었고, 인앱 브라우저에서는
 * userAgent 만으로 OS 판별이 충분하다.
 *
 * `v` 는 캐시 무력화용. 페이지 로직을 고치면 올린다.
 */
export const REDIRECT_BASE = 'https://imelon2.github.io/joheon-alert/';
const REDIRECT_VERSION = '3';

export function brokerButtonUrl(slug: string): string {
  return `${REDIRECT_BASE}?b=${slug}&v=${REDIRECT_VERSION}`;
}

/** slug → 증권사 이름 역인덱스. Mini App 페이지가 startapp 값을 풀 때 쓴다. */
export function brokerBySlug(slug: string): string | undefined {
  return Object.keys(BROKER_APP_URLS).find((n) => BROKER_APP_URLS[n]!.slug === slug);
}
