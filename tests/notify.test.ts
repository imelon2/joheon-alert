import { describe, expect, it, vi } from 'vitest';
import {
  TELEGRAM_LIMIT,
  TelegramError,
  renderMessages,
  sendWithRetry,
  visibleLength,
} from '../src/notify.js';
import { brokerUrl } from '../src/brokers.js';
import type { IpoEvent, IpoRow } from '../src/types.js';

function row(over: Partial<IpoRow> = {}): IpoRow {
  return {
    no: '2307',
    name: '브릴스',
    subStart: '2026-08-25',
    subEnd: '2026-08-26',
    finalPrice: null,
    hopePrice: '16,500~19,500',
    ratio: null,
    underwriter: 'IBK투자증권',
    url: 'http://www.38.co.kr/html/fund/?o=v&no=2307',
    ...over,
  };
}

const only = (events: IpoEvent[], today = '2026-08-25') => {
  const messages = renderMessages(events, today);
  expect(messages).toHaveLength(1);
  return messages[0]!;
};

describe('renderMessages — 내용', () => {
  it('이벤트가 없으면 메시지를 만들지 않는다', () => {
    expect(renderMessages([], '2026-08-25')).toEqual([]);
  });

  it('급한 것부터(마감 → 오늘 → 내일) 정렬한다', () => {
    // 종목명은 라벨(확정가/희망가 등)과 겹치지 않는 문자열이어야 indexOf가 정확하다
    const text = only([
      { type: 'NEW', row: row({ no: '1', name: 'ZETA' }) },
      { type: 'D_MINUS_1', row: row({ no: '2', name: 'YANKEE' }) },
      { type: 'LAST_DAY', row: row({ no: '3', name: 'XRAY' }) },
      { type: 'D_DAY', row: row({ no: '4', name: 'WHISKEY' }) },
    ]);
    const order = ['XRAY', 'WHISKEY', 'YANKEE', 'ZETA'].map((n) => text.indexOf(n));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('6개 필드를 모두 보여준다', () => {
    const text = only([
      { type: 'D_DAY', row: row({ finalPrice: '19,500', ratio: '666.78:1' }) },
    ]);
    expect(text).toContain('브릴스'); // 종목명
    expect(text).toContain('일정    2026-08-25 ~ 08-26'); // 공모주일정
    expect(text).toContain('확정가  19,500');
    expect(text).toContain('희망가  16,500~19,500');
    expect(text).toContain('경쟁률  666.78:1');
    expect(text).toContain('주간사  '); // 주간사는 링크로 감싸진다 (아래 링크 테스트 참고)
    expect(text).toContain('>IBK투자증권</a>');
  });

  it('값이 없는 필드는 줄을 없애지 않고 - 로 채운다', () => {
    // 줄 수가 항목마다 달라지면 훑기 어려워진다
    const text = only([
      { type: 'D_DAY', row: row({ finalPrice: null, ratio: null, hopePrice: null, underwriter: null }) },
    ]);
    expect(text).toContain('확정가  -');
    expect(text).toContain('희망가  -');
    expect(text).toContain('경쟁률  -');
    expect(text).toContain('주간사  -');
  });

  it('같은 해면 종료일은 월-일만 보여준다', () => {
    const text = only([{ type: 'D_DAY', row: row() }]);
    expect(text).toContain('2026-08-25 ~ 08-26');
  });

  it('해가 바뀌는 일정은 종료일에 연도를 붙여 오해를 막는다', () => {
    const text = only([
      { type: 'D_DAY', row: row({ subStart: '2026-12-30', subEnd: '2027-01-02' }) },
    ]);
    expect(text).toContain('2026-12-30 ~ 2027-01-02');
  });

  it('변경 이벤트는 detail을 함께 보여준다', () => {
    const text = only([
      { type: 'PRICE_FIXED', row: row(), detail: '희망 16,500~19,500 → 확정 19,500' },
    ]);
    expect(text).toContain('변경    희망 16,500~19,500 → 확정 19,500');
  });

  it('해당 없는 섹션 제목은 출력하지 않는다', () => {
    const text = only([{ type: 'D_DAY', row: row() }]);
    expect(text).toContain('오늘 청약 시작');
    expect(text).not.toContain('신규 등록');
    expect(text).not.toContain('마감');
  });
});

describe('renderMessages — 분할', () => {
  const many = (n: number, type: IpoEvent['type'] = 'NEW'): IpoEvent[] =>
    Array.from({ length: n }, (_, i) => ({ type, row: row({ no: String(i), name: `종목${i}` }) }));

  it('대량 이벤트도 텔레그램 상한을 넘지 않는다', () => {
    // 실측: 분할 없이 30 SCHEDULE_CHANGED + 30 D_MINUS_1 = 7140자로 상한 초과
    const events = [...many(30, 'SCHEDULE_CHANGED'), ...many(30, 'D_MINUS_1')];
    const messages = renderMessages(events, '2026-08-25');

    expect(messages.length).toBeGreaterThan(1);
    // 상한은 태그를 제외한 보이는 텍스트 기준이다 (실측 확인)
    for (const m of messages) expect(visibleLength(m)).toBeLessThanOrEqual(TELEGRAM_LIMIT);
  });

  it('분할해도 모든 종목이 하나도 빠지지 않는다', () => {
    const events = many(60);
    const joined = renderMessages(events, '2026-08-25').join('\n');
    for (let i = 0; i < 60; i++) expect(joined).toContain(`종목${i}`);
  });

  it('분할된 각 메시지에 날짜 헤더와 (n/m) 표시가 붙는다', () => {
    const messages = renderMessages(many(60), '2026-08-25');
    messages.forEach((m, i) => {
      expect(m).toContain('공모주 알림 (2026-08-25)');
      expect(m).toContain(`(${i + 1}/${messages.length})`);
    });
  });

  it('작은 묶음은 굳이 나누지 않는다', () => {
    expect(renderMessages(many(3), '2026-08-25')).toHaveLength(1);
  });
});

describe('sendWithRetry', () => {
  /** 백오프를 실제로 기다리지 않는다 — 테스트가 수 초씩 잠들지 않도록. */
  const noSleep = async () => {};

  it('일시적 실패 뒤 성공하면 재시도로 복구한다', async () => {
    let calls = 0;
    const send = vi.fn(async () => {
      if (++calls < 3) throw new TelegramError('HTTP 503', 503, true);
    });

    await sendWithRetry('hi', 't', 'c', 3, send, noSleep);
    expect(calls).toBe(3);
  });

  it('4xx는 재시도하지 않고 즉시 던진다', async () => {
    const send = vi.fn(async () => {
      throw new TelegramError('HTTP 400 too long', 400, false);
    });

    await expect(sendWithRetry('hi', 't', 'c', 3, send, noSleep)).rejects.toThrow('400');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('재시도를 모두 소진하면 마지막 오류를 던진다', async () => {
    const send = vi.fn(async () => {
      throw new TelegramError('HTTP 503', 503, true);
    });

    await expect(sendWithRetry('hi', 't', 'c', 2, send, noSleep)).rejects.toThrow('503');
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('HTML 이스케이프 / 주간사 링크', () => {
  it('알려진 주간사에 링크를 건다', () => {
    // URL을 하드코딩하면 매핑을 고칠 때마다 무관하게 깨진다. 매핑에서 가져온다.
    const text = only([{ type: 'D_DAY', row: row({ underwriter: '삼성증권' }) }]);
    expect(text).toContain(`<a href="${brokerUrl('삼성증권')}">삼성증권</a>`);
  });

  it('주간사가 2곳이면 각각 링크한다', () => {
    const text = only([{ type: 'D_DAY', row: row({ underwriter: '미래에셋증권,삼성증권' }) }]);
    expect(text).toContain('>미래에셋증권</a>');
    expect(text).toContain('>삼성증권</a>');
  });

  it('모르는 주간사는 링크 없이 이름만 남긴다', () => {
    const text = only([{ type: 'D_DAY', row: row({ underwriter: '없는증권' }) }]);
    expect(text).toContain('없는증권');
    expect(text).not.toContain('<a href="undefined"');
  });

  it('종목명의 & 를 이스케이프한다', () => {
    // 이스케이프를 빠뜨리면 400(can't parse entities)으로 그날 알림이 전부 유실된다
    const text = only([{ type: 'D_DAY', row: row({ name: 'A&B홀딩스' }) }]);
    expect(text).toContain('A&amp;B홀딩스');
    expect(text).not.toMatch(/A&B/);
  });

  it('종목명의 부등호를 이스케이프한다', () => {
    const text = only([{ type: 'D_DAY', row: row({ name: '<b>가짜태그</b>' }) }]);
    expect(text).toContain('&lt;b&gt;가짜태그&lt;/b&gt;');
  });

  it('모르는 주간사 이름의 특수문자도 이스케이프한다', () => {
    const text = only([{ type: 'D_DAY', row: row({ underwriter: 'A&B증권' }) }]);
    expect(text).toContain('A&amp;B증권');
  });

  it('생성한 링크 외에는 앵커 태그가 생기지 않는다', () => {
    const text = only([{ type: 'D_DAY', row: row({ name: '<a href="evil">x</a>', underwriter: null }) }]);
    expect(text.match(/<a /g)).toBeNull();
  });
});

describe('visibleLength', () => {
  it('태그를 길이에서 제외한다', () => {
    expect(visibleLength('<a href="http://very.long.url/path">삼성</a>')).toBe(2);
  });

  it('이스케이프된 문자는 한 글자로 센다', () => {
    expect(visibleLength('A&amp;B')).toBe(3);
    expect(visibleLength('&lt;b&gt;')).toBe(3);
  });

  it('분할이 태그가 아니라 보이는 텍스트 기준으로 일어난다', () => {
    // 링크가 붙어도 불필요하게 잘게 쪼개지면 안 된다
    const many = Array.from({ length: 12 }, (_, i) => ({
      type: 'NEW' as const,
      row: row({ no: String(i), name: `종목${i}`, underwriter: '미래에셋증권,삼성증권' }),
    }));
    const messages = renderMessages(many, '2026-08-25');
    for (const m of messages) expect(visibleLength(m)).toBeLessThanOrEqual(TELEGRAM_LIMIT);
    expect(messages).toHaveLength(1); // 보이는 텍스트 기준이면 한 통에 들어간다
  });
});
