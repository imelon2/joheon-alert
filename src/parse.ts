import * as cheerio from 'cheerio';
import type { IpoRow } from './types.js';

const TABLE_SELECTOR = 'table[summary="공모주 청약일정"]';
const BASE_URL = 'http://www.38.co.kr';

/** 원문 '2026.08.25~08.26' — 끝 날짜에 연도가 없다. */
const DATE_RANGE = /(\d{4})\.(\d{2})\.(\d{2})\s*~\s*(\d{2})\.(\d{2})/;

export class ParseError extends Error {}

export function parseList(html: string): IpoRow[] {
  const $ = cheerio.load(html);
  const table = $(TABLE_SELECTOR);
  if (table.length === 0) {
    throw new ParseError(
      `일정 테이블(${TABLE_SELECTOR})을 찾지 못했습니다. 사이트 구조가 바뀌었을 수 있습니다.`,
    );
  }

  const rows: IpoRow[] = [];
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 7) return; // 구분선/스페이서 행

    const link = $(cells[0]).find('a').first();
    const no = new URL(link.attr('href') ?? '', BASE_URL).searchParams.get('no');
    const name = text($(cells[0]));
    if (!no || !name) return;

    const schedule = parseDateRange(text($(cells[1])));
    if (!schedule) return; // 일정 미정 종목은 알림 대상이 아니다

    rows.push({
      no,
      name,
      subStart: schedule.start,
      subEnd: schedule.end,
      finalPrice: nullIfUnset(text($(cells[2]))),
      hopePrice: nullIfUnset(text($(cells[3]))),
      ratio: nullIfUnset(text($(cells[4]))),
      underwriter: nullIfUnset(text($(cells[5]))),
      url: `${BASE_URL}/html/fund/?o=v&no=${no}`,
      listingDate: null, // 목록 페이지엔 없다. 상세 페이지에서 별도로 채운다.
    });
  });

  return rows;
}

/**
 * '2026.08.25~08.26' → { start: '2026-08-25', end: '2026-08-26' }
 * 끝 날짜에 연도가 없으므로 연말 걸침('2026.12.30~01.02')은 연도를 +1 한다.
 */
export function parseDateRange(
  raw: string,
): { start: string; end: string } | null {
  const m = DATE_RANGE.exec(raw);
  if (!m) return null;
  const [, y, sm, sd, em, ed] = m as unknown as string[];
  const endYear = Number(em) < Number(sm) ? Number(y) + 1 : Number(y);
  return { start: `${y}-${sm}-${sd}`, end: `${endYear}-${em}-${ed}` };
}

/** 확정공모가 미정은 '-', 경쟁률 미집계는 '' — 둘 다 null로 정규화. */
function nullIfUnset(value: string): string | null {
  return value === '' || value === '-' ? null : value;
}

function text(el: cheerio.Cheerio<any>): string {
  return el.text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}
