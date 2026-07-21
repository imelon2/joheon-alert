const LIST_URL = 'http://www.38.co.kr/html/fund/?o=k';

export class NonRetryableHttpError extends Error {}

/**
 * 38.co.kr은 euc-kr로 응답한다. 그리고 HTTPS는 서버 DH 파라미터가 약해서
 * Node/OpenSSL3이 ERR_SSL_DH_KEY_TOO_SMALL로 거절한다. 자격증명을 보내지 않는
 * 공개 페이지 단순 GET이므로 http로 간다.
 */
export async function fetchHtml(url: string, attempts = 3): Promise<string> {
  assertEucKrSupported();

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(2 ** i * 1000);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'stock-skills-ipo-notifier/0.1' },
        signal: AbortSignal.timeout(20_000),
      });
      // 4xx는 재시도해도 같은 결과다. 사이트 개편으로 404가 나면
      // 6초를 낭비하는 대신 즉시 실패해야 원인이 드러난다.
      if (res.status >= 400 && res.status < 500) {
        throw new NonRetryableHttpError(`HTTP ${res.status} (재시도 불가)`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return decodeEucKr(await res.arrayBuffer());
    } catch (err) {
      if (err instanceof NonRetryableHttpError) throw err;
      lastError = err;
    }
  }
  throw new Error(
    `${attempts}회 재시도 후에도 ${url} 수집 실패: ${String(lastError)}`,
  );
}

/** 공모주 청약일정 목록 페이지. */
export const fetchListHtml = (): Promise<string> => fetchHtml(LIST_URL);

export function decodeEucKr(buf: ArrayBuffer): string {
  return new TextDecoder('euc-kr').decode(buf);
}

/**
 * TextDecoder의 euc-kr 지원은 full-ICU 빌드에서만 보장된다. small-icu Node에서는
 * 조용히 깨진 한글을 뱉는 대신 여기서 즉시 실패시킨다.
 */
function assertEucKrSupported(): void {
  const probe = new TextDecoder('euc-kr');
  if (probe.encoding !== 'euc-kr') {
    throw new Error(
      `이 Node 빌드는 euc-kr 디코딩을 지원하지 않습니다 (encoding=${probe.encoding}). full-ICU 빌드가 필요합니다.`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
