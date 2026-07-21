import { describe, expect, it, vi } from 'vitest';
import {
  TELEGRAM_LIMIT,
  TelegramError,
  buildBrokerKeyboard,
  renderMessages,
  sendWithRetry,
  visibleLength,
} from '../src/notify.js';
import { BROKER_APP_URLS, brokerButtonUrl, brokerUrl } from '../src/brokers.js';
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
    listingDate: null,
    ...over,
  };
}

const only = (events: IpoEvent[], today = '2026-08-25') => {
  const messages = renderMessages(events, today);
  expect(messages).toHaveLength(1);
  return messages[0]!.text;
};

describe('renderMessages — 내용', () => {
  it('이벤트가 없으면 메시지를 만들지 않는다', () => {
    expect(renderMessages([], '2026-08-25')).toEqual([]);
  });

  it('급한 것부터(마감 → 오늘 → 내일) 정렬한다', () => {
    // 종목명은 라벨(확정가/희망가 등)과 겹치지 않는 문자열이어야 indexOf가 정확하다
    const text = only([
      { type: 'SCHEDULE_CHANGED', row: row({ no: '1', name: 'ZETA' }) },
      { type: 'D_MINUS_1', row: row({ no: '2', name: 'YANKEE' }) },
      { type: 'LAST_DAY', row: row({ no: '3', name: 'XRAY' }) },
      { type: 'D_DAY', row: row({ no: '4', name: 'WHISKEY' }) },
      { type: 'LISTING_DAY', row: row({ no: '5', name: 'VICTOR' }) },
    ]);
    // 상장일이 맨 위 — 매도 가능일이라 놓치면 실제 손익이 갈린다
    const order = ['VICTOR', 'XRAY', 'WHISKEY', 'YANKEE', 'ZETA'].map((n) => text.indexOf(n));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('상장일 알림은 매도 가능일임을 제목에 밝힌다', () => {
    const text = only([
      { type: 'LISTING_DAY', row: row({ listingDate: '2026-08-25', finalPrice: '19,500' }) },
    ]);
    expect(text).toContain('오늘 상장 (매도 가능)');
    expect(text).toContain('상장일  2026-08-25');
    expect(text).toContain('확정가  19,500'); // 매도 판단에 쓰인다
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
      {
        type: 'SCHEDULE_CHANGED',
        row: row(),
        detail: '2026-08-25~2026-08-26 → 2026-09-01~2026-09-02',
      },
    ]);
    expect(text).toContain('변경    2026-08-25~2026-08-26 → 2026-09-01~2026-09-02');
  });

  it('해당 없는 섹션 제목은 출력하지 않는다', () => {
    const text = only([{ type: 'D_DAY', row: row() }]);
    expect(text).toContain('오늘 청약 시작');
    expect(text).not.toContain('일정 변경');
    expect(text).not.toContain('마감');
  });
});

describe('renderMessages — 분할', () => {
  const many = (n: number, type: IpoEvent['type'] = 'D_MINUS_1'): IpoEvent[] =>
    Array.from({ length: n }, (_, i) => ({ type, row: row({ no: String(i), name: `종목${i}` }) }));

  it('대량 이벤트도 텔레그램 상한을 넘지 않는다', () => {
    // 실측: 분할 없이 30 SCHEDULE_CHANGED + 30 D_MINUS_1 = 7140자로 상한 초과
    const events = [...many(30, 'SCHEDULE_CHANGED'), ...many(30, 'D_MINUS_1')];
    const messages = renderMessages(events, '2026-08-25');

    expect(messages.length).toBeGreaterThan(1);
    // 상한은 태그를 제외한 보이는 텍스트 기준이다 (실측 확인)
    for (const m of messages) expect(visibleLength(m.text)).toBeLessThanOrEqual(TELEGRAM_LIMIT);
  });

  it('분할해도 모든 종목이 하나도 빠지지 않는다', () => {
    const events = many(60);
    const joined = renderMessages(events, '2026-08-25').map((m) => m.text).join('\n');
    for (let i = 0; i < 60; i++) expect(joined).toContain(`종목${i}`);
  });

  it('분할된 각 메시지에 날짜 헤더와 (n/m) 표시가 붙는다', () => {
    const messages = renderMessages(many(60), '2026-08-25');
    messages.forEach((m, i) => {
      expect(m.text).toContain('공모주 알림 (2026-08-25)');
      expect(m.text).toContain(`(${i + 1}/${messages.length})`);
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

    await sendWithRetry('hi', 't', 'c', undefined, 3, send, noSleep);
    expect(calls).toBe(3);
  });

  it('4xx는 재시도하지 않고 즉시 던진다', async () => {
    const send = vi.fn(async () => {
      throw new TelegramError('HTTP 400 too long', 400, false);
    });

    await expect(sendWithRetry('hi', 't', 'c', undefined, 3, send, noSleep)).rejects.toThrow('400');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('재시도를 모두 소진하면 마지막 오류를 던진다', async () => {
    const send = vi.fn(async () => {
      throw new TelegramError('HTTP 503', 503, true);
    });

    await expect(sendWithRetry('hi', 't', 'c', undefined, 2, send, noSleep)).rejects.toThrow('503');
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
      type: 'D_MINUS_1' as const,
      row: row({ no: String(i), name: `종목${i}`, underwriter: '미래에셋증권,삼성증권' }),
    }));
    const messages = renderMessages(many, '2026-08-25');
    for (const m of messages) expect(visibleLength(m.text)).toBeLessThanOrEqual(TELEGRAM_LIMIT);
    expect(messages).toHaveLength(1); // 보이는 텍스트 기준이면 한 통에 들어간다
  });
});

describe('buildBrokerKeyboard', () => {
  it('버튼은 리다이렉트 페이지를 경유한다', () => {
    // url 버튼만으로는 OS를 알 수 없다. 리다이렉트 페이지가 userAgent 로 판별해 보낸다.
    const kb = buildBrokerKeyboard(['삼성증권']);
    expect(kb?.inline_keyboard).toEqual([
      [{ text: '삼성증권', url: brokerButtonUrl('samsung') }],
    ]);
    expect(kb?.inline_keyboard[0]?.[0]?.url).toContain('joheon-alert/?b=samsung');
  });

  it('16곳 모두 리다이렉트 링크를 만들 수 있다', () => {
    for (const [name, links] of Object.entries(BROKER_APP_URLS)) {
      const kb = buildBrokerKeyboard([name]);
      expect(kb?.inline_keyboard[0]?.[0]?.url, name).toBe(brokerButtonUrl(links.slug));
    }
  });

  it('한 줄에 2개씩 배치한다', () => {
    const kb = buildBrokerKeyboard(['삼성증권', '미래에셋증권', 'KB증권']);
    expect(kb?.inline_keyboard.map((r) => r.length)).toEqual([2, 1]);
  });

  it('매핑에 없는 증권사는 버튼을 만들지 않는다', () => {
    // 눌러도 아무 일 없는 버튼보다 없는 게 낫다
    const kb = buildBrokerKeyboard(['없는증권', '삼성증권']);
    expect(kb?.inline_keyboard.flat().map((b) => b.text)).toEqual(['삼성증권']);
  });

  it('만들 버튼이 하나도 없으면 undefined', () => {
    // reply_markup 을 아예 안 붙여야 빈 키보드가 안 생긴다
    expect(buildBrokerKeyboard(['없는증권'])).toBeUndefined();
    expect(buildBrokerKeyboard([])).toBeUndefined();
  });
});

describe('renderMessages — 버튼용 증권사 수집', () => {
  it('본문에 등장한 증권사를 모아준다', () => {
    const [m] = renderMessages(
      [{ type: 'D_DAY', row: row({ underwriter: '미래에셋증권,삼성증권' }) }],
      '2026-08-25',
    );
    expect(m?.brokers).toEqual(['미래에셋증권', '삼성증권']);
  });

  it('여러 종목의 같은 증권사는 한 번만 담는다', () => {
    const [m] = renderMessages(
      [
        { type: 'D_DAY', row: row({ no: '1', underwriter: '삼성증권' }) },
        { type: 'D_MINUS_1', row: row({ no: '2', underwriter: '삼성증권' }) },
      ],
      '2026-08-25',
    );
    expect(m?.brokers).toEqual(['삼성증권']);
  });

  it('분할되면 각 조각이 자기 증권사만 갖는다', () => {
    // 버튼이 그 메시지에 없는 종목의 증권사를 가리키면 혼란스럽다
    const many = Array.from({ length: 60 }, (_, i) => ({
      type: 'D_MINUS_1' as const,
      row: row({
        no: String(i),
        name: `종목${i}`,
        underwriter: i < 30 ? '삼성증권' : 'KB증권',
      }),
    }));
    const messages = renderMessages(many, '2026-08-25');
    expect(messages.length).toBeGreaterThan(1);
    for (const m of messages) {
      for (const name of m.brokers) {
        expect(m.text).toContain(name);
      }
    }
  });
});
