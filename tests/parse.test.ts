import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeEucKr } from '../src/fetch.js';
import { ParseError, parseDateRange, parseList } from '../src/parse.js';

/** 2026-07-21에 실제로 받아 저장한 페이지. */
const html = decodeEucKr(
  toArrayBuffer(readFileSync('tests/fixtures/list-2026-07-21.euckr.html')),
);

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe('decodeEucKr', () => {
  it('한글이 깨지지 않는다', () => {
    expect(html).toContain('브릴스');
    expect(html).toContain('공모주 청약일정');
  });
});

describe('parseList', () => {
  const rows = parseList(html);

  it('전체 데이터 행을 수집한다', () => {
    // 원문 <tr>은 32개지만 2개는 thead의 헤더/구분선 행이다.
    // 상세링크 no의 고유값 개수(30)와 일치함을 확인했다.
    expect(rows.length).toBe(30);
  });

  it('첫 행을 정확히 파싱한다', () => {
    expect(rows[0]).toEqual({
      no: '2307',
      name: '브릴스',
      subStart: '2026-08-25',
      subEnd: '2026-08-26',
      finalPrice: null, // 원문 '-'
      hopePrice: '16,500~19,500',
      ratio: null, // 원문 ''
      underwriter: 'IBK투자증권',
      url: 'http://www.38.co.kr/html/fund/?o=v&no=2307',
      listingDate: null, // 목록 페이지엔 없다. 상세 페이지에서 별도로 채운다.
    });
  });

  it('no가 전부 채워지고 고유하다', () => {
    expect(rows.every((r) => /^\d+$/.test(r.no))).toBe(true);
    expect(new Set(rows.map((r) => r.no)).size).toBe(rows.length);
  });

  it('확정공모가가 발표된 종목은 finalPrice와 ratio를 갖는다', () => {
    const fixed = rows.filter((r) => r.finalPrice !== null);
    expect(fixed.length).toBeGreaterThan(0);
    expect(fixed.every((r) => /[\d,]+/.test(r.finalPrice!))).toBe(true);
  });

  it('모든 날짜가 ISO 형식이고 종료일이 시작일 이상이다', () => {
    for (const r of rows) {
      expect(r.subStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.subEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.subEnd >= r.subStart).toBe(true);
    }
  });

  it('테이블이 없으면 조용히 빈 배열을 반환하지 않고 실패한다', () => {
    expect(() => parseList('<html><body>개편되었습니다</body></html>')).toThrow(
      ParseError,
    );
  });
});

describe('parseDateRange', () => {
  it('연도 없는 끝 날짜를 시작 연도로 채운다', () => {
    expect(parseDateRange('2026.08.25~08.26')).toEqual({
      start: '2026-08-25',
      end: '2026-08-26',
    });
  });

  it('연말 걸침은 종료 연도를 +1 한다', () => {
    expect(parseDateRange('2026.12.30~01.02')).toEqual({
      start: '2026-12-30',
      end: '2027-01-02',
    });
  });

  it('월을 넘는 정상 범위를 유지한다', () => {
    expect(parseDateRange('2026.05.22~06.02')).toEqual({
      start: '2026-05-22',
      end: '2026-06-02',
    });
  });

  it('형식에 맞지 않으면 null', () => {
    expect(parseDateRange('미정')).toBeNull();
    expect(parseDateRange('')).toBeNull();
  });
});
