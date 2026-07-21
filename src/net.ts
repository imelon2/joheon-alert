import net from 'node:net';

/**
 * Happy Eyeballs(RFC 8305)의 IPv6→IPv4 폴백 대기시간을 늘린다.
 *
 * Node는 `autoSelectFamily`가 기본 true지만 attempt timeout이 **250ms**다.
 * IPv6 경로가 없는 환경(WSL2 등 흔하다)에서 AAAA 레코드를 가진 원격 호스트에
 * 붙을 때, IPv4 핸드셰이크가 250ms 안에 안 끝나면 폴백이 완료되기 전에
 * ETIMEDOUT으로 죽는다.
 *
 * 실측(api.telegram.org, WSL2): 250ms → 3회 모두 ETIMEDOUT(~256ms).
 *                              500ms → 3회 모두 성공(~590ms).
 *
 * 이 값은 '연결이 이만큼 걸린다'가 아니라 '다음 주소로 넘어가기 전 대기'다.
 * 늘려도 정상 경로가 느려지지 않는다.
 */
net.setDefaultAutoSelectFamilyAttemptTimeout(1000);
