import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BROKER_APP_URLS, brokerUrl, splitBrokers } from '../src/brokers.js';

/** 실데이터(2026-07-21 스냅샷 30건)에 등장한 증권사 전부. */
const SEEN_IN_DATA = [
  'DB증권', 'IBK투자증권', 'KB증권', 'NH투자증권', '교보증권', '대신증권',
  '메리츠증권', '미래에셋증권', '삼성증권', '신한투자증권', '유안타증권',
  '유진투자증권', '키움증권', '하나증권', '한국투자증권', '현대차증권',
];

describe('splitBrokers', () => {
  it('콤마로 붙어 오는 복수 주간사를 나눈다', () => {
    expect(splitBrokers('미래에셋증권,삼성증권')).toEqual(['미래에셋증권', '삼성증권']);
  });

  it('공백이 섞여도 정리한다', () => {
    expect(splitBrokers('KB증권, IBK투자증권 ')).toEqual(['KB증권', 'IBK투자증권']);
  });

  it('단일 주간사는 그대로', () => {
    expect(splitBrokers('삼성증권')).toEqual(['삼성증권']);
  });
});

describe('BROKER_APP_URLS', () => {
  it('실데이터에 등장하는 16곳을 모두 담고 있다', () => {
    for (const name of SEEN_IN_DATA) expect(brokerUrl(name), name).toBeTruthy();
  });

  it('세 링크가 모두 http(s) 스킴이다', () => {
    // 커스텀 스킴(samsungpop:// 등)은 텔레그램이 링크로 만들지 않는다 — 실측 확인됨
    for (const [name, links] of Object.entries(BROKER_APP_URLS)) {
      expect(links.landing, `${name}.landing`).toMatch(/^https?:\/\//);
      expect(links.android, `${name}.android`).toMatch(/^https:\/\/play\.google\.com\//);
      expect(links.ios, `${name}.ios`).toMatch(/^https:\/\/apps\.apple\.com\//);
    }
  });

  it('Play 패키지와 iOS 앱 ID가 형식에 맞는다', () => {
    for (const [name, links] of Object.entries(BROKER_APP_URLS)) {
      expect(links.android, `${name}.android`).toMatch(/[?&]id=[\w.]+$/);
      expect(links.ios, `${name}.ios`).toMatch(/\/id\d+$/);
    }
  });

  it('링크 성격이 정해진 값 중 하나다', () => {
    for (const [name, links] of Object.entries(BROKER_APP_URLS)) {
      expect(['smart-link', 'download-page', 'official-page'], name).toContain(links.type);
    }
  });

  it('증권사마다 앱 식별자가 서로 겹치지 않는다', () => {
    // 복붙 실수로 두 증권사가 같은 앱을 가리키는 것을 막는다
    const ids = Object.values(BROKER_APP_URLS).map((l) => l.ios);
    const pkgs = Object.values(BROKER_APP_URLS).map((l) => l.android);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(pkgs).size).toBe(pkgs.length);
  });
});

describe('brokerUrl', () => {
  it('렌더링에는 landing을 쓴다', () => {
    // 메시지는 수신자 OS를 알 수 없어 android/ios를 골라 보낼 수 없다
    expect(brokerUrl('미래에셋증권')).toBe(BROKER_APP_URLS['미래에셋증권']!.landing);
    expect(brokerUrl('미래에셋증권')).toBe('https://onelink.to/m.stock');
  });

  it('모르는 증권사는 undefined — 깨진 링크를 만들지 않는다', () => {
    expect(brokerUrl('없는증권')).toBeUndefined();
  });
});

describe('state/brokers.json (웹페이지용 생성물)', () => {
  const committed = JSON.parse(readFileSync('state/brokers.json', 'utf8'));

  it('TS 원본과 정확히 일치한다', () => {
    // 어긋나면 웹페이지가 옛 링크를 쓴다. 조용히 틀리는 대신 여기서 깨진다.
    // 고치는 법: pnpm gen:brokers
    expect(committed).toEqual(BROKER_APP_URLS);
  });

  it('페이지가 필요로 하는 필드를 모두 담고 있다', () => {
    for (const name of SEEN_IN_DATA) {
      expect(committed[name], name).toMatchObject({
        landing: expect.any(String),
        android: expect.any(String),
        ios: expect.any(String),
        type: expect.any(String),
      });
    }
  });
});
