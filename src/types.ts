/** 38.co.kr 공모주 청약일정 한 행. */
export type IpoRow = {
  /** 38.co.kr 고유번호. 상세 링크의 `no` 파라미터. 종목의 안정적 PK. */
  no: string;
  name: string;
  /** ISO 'YYYY-MM-DD' */
  subStart: string;
  /** ISO 'YYYY-MM-DD' */
  subEnd: string;
  /** 확정공모가. 원문 '-'(미확정)은 null. */
  finalPrice: string | null;
  hopePrice: string | null;
  /**
   * 청약경쟁률. 원문 ''(미집계)은 null.
   *
   * 원문에서 미정 표기는 컬럼마다 다르다(공모가는 '-', 경쟁률은 ''). 파서는 둘 다
   * null로 정규화하며, 어느 표기였는지는 보존하지 않는다. 현재 어떤 판정도 그
   * 구분에 의존하지 않으므로 무해하다. 구분이 필요해지면 파서에서 별도 필드로
   * 승격해야 한다.
   */
  ratio: string | null;
  underwriter: string | null;
  url: string;
  /**
   * 상장일 'YYYY-MM-DD'. 목록 페이지에 없어서 종목별 상세 페이지를 따로 받아 채운다.
   *
   * null은 '미정' 또는 '아직 조회 안 함' 둘 다를 뜻한다. 조회 비용을 아끼려고
   * 한 번 확정된 값은 다시 받지 않고 스냅샷에서 이어받으므로, 둘을 구분할
   * 실익이 없다(어느 쪽이든 화면에는 '-'로 나간다).
   */
  listingDate: string | null;
};

export type Snapshot = {
  updatedAt: string;
  /** key = IpoRow.no */
  items: Record<string, IpoRow>;
};

/**
 * 발송 트리거 4종.
 *
 * 신규 등록·공모가 확정은 의도적으로 제외했다. 해당 종목은 어차피 D-1에
 * 알림이 나가고 그때 확정가/희망가가 함께 표시되므로, 별도 알림은 소음이 된다.
 */
export type EventType =
  | 'D_MINUS_1'
  | 'D_DAY'
  | 'LAST_DAY'
  | 'SCHEDULE_CHANGED';

export type IpoEvent = {
  type: EventType;
  row: IpoRow;
  /** SCHEDULE_CHANGED 등 변경 이벤트의 이전 값 설명. */
  detail?: string;
};

export type NotifiedLog = {
  /** 멱등성 키: `${no}:${type}:${eventDate}` */
  sent: string[];
};
