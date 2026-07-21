import * as cheerio from 'cheerio';
import { fetchHtml } from './fetch.js';

const TABLE_SELECTOR = 'table[summary="공모청약일정"]';
const BASE_URL = 'http://www.38.co.kr';

/** 원문 '2026.07.24'. 미정이면 빈 칸. */
const SINGLE_DATE = /(\d{4})\.(\d{2})\.(\d{2})/;

export const detailUrl = (no: string): string =>
  `${BASE_URL}/html/fund/?o=v&no=${no}`;

/**
 * 상세 페이지에서 상장일을 뽑는다.
 *
 * 목록 페이지에는 상장일이 없어서 종목별 상세 페이지를 따로 받아야 한다.
 * 미정이면 null (청약 전 종목은 대개 비어 있다).
 */
export function parseListingDate(html: string): string | null {
  const $ = cheerio.load(html);
  const table = $(TABLE_SELECTOR);
  if (table.length === 0) return null;

  let listingDate: string | null = null;
  table.find('tr').each((_, tr) => {
    const cells = $(tr).find('td');
    const labelIndex = cells
      .toArray()
      .findIndex((td) => $(td).text().replace(/\s/g, '') === '상장일');
    if (labelIndex === -1) return;

    const raw = $(cells[labelIndex + 1]).text();
    const m = SINGLE_DATE.exec(raw);
    if (m) listingDate = `${m[1]}-${m[2]}-${m[3]}`;
    return false; // 찾았으면 순회 중단
  });

  return listingDate;
}

export async function fetchListingDate(no: string): Promise<string | null> {
  return parseListingDate(await fetchHtml(detailUrl(no)));
}
