import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeEucKr } from '../src/fetch.js';
import { detailUrl, parseListingDate } from '../src/detail.js';

function fixture(name: string): string {
  const buf = readFileSync(`tests/fixtures/${name}`);
  return decodeEucKr(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
}

describe('parseListingDate', () => {
  it('상장일이 확정된 종목에서 날짜를 뽑는다', () => {
    // 에이치엘지노믹스 — 원문 '2026.07.24'
    expect(parseListingDate(fixture('detail-2301.euckr.html'))).toBe('2026-07-24');
  });

  it('상장일이 아직 비어 있으면 null', () => {
    // 인제니아테라퓨틱스 — 청약 전이라 상장일 칸이 공란
    expect(parseListingDate(fixture('detail-2298.euckr.html'))).toBeNull();
  });

  it('다른 날짜(수요예측일·납입일)를 상장일로 착각하지 않는다', () => {
    // 같은 표에 2026.07.20~24(수요예측), 2026.08.04(납입) 등이 함께 있다
    const html = fixture('detail-2301.euckr.html');
    expect(html).toContain('납입일');
    expect(parseListingDate(html)).toBe('2026-07-24');
  });

  it('구조가 바뀌어 표를 못 찾으면 던지지 않고 null', () => {
    // 상장일은 부가 정보다. 여기서 던지면 알림 전체가 죽는다.
    expect(parseListingDate('<html><body>개편</body></html>')).toBeNull();
  });
});

describe('detailUrl', () => {
  it('종목 번호로 상세 URL을 만든다', () => {
    expect(detailUrl('2298')).toBe('http://www.38.co.kr/html/fund/?o=v&no=2298');
  });
});
