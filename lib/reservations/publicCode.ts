/**
 * 예약 공개 코드 생성 — 순수 (플랜 v4 P3-2).
 *
 * 왜 비순차인가: reservations.id(uuid)와 별개로 방문자에게 보여 주는 코드다. 순차 번호(예: 20260913-0001)는
 * 열거 공격에 뚫린다 — 예약확인(P6-3a)이 `public_code + 휴대폰 뒷4자리` 로 조회하므로 코드는 추측 불가여야 한다.
 *
 * 알파벳 31자 = 숫자 2~9 + 대문자에서 혼동 문자(0·O·1·I·L) 제외. 전화로 불러 주고 받아 적는 상황을 가정한다.
 * 길이 8 → 31^8 ≈ 8.5×10^11 공간. DB unique 충돌은 통계적으로 0회지만 create.ts 가 3회까지 재생성한다.
 *
 * 난수는 주입받는다(`randomBytes`) — 테스트는 고정 바이트로 결정성을, 서버는 node:crypto 를 넘긴다.
 * 바이트→기호는 `byte % 31`. 256 = 8·31 + 8 이라 기호 8개(2~9)가 9/256, 나머지가 8/256 로 미세하게 치우친다 —
 * 문자당 엔트로피 손실 ≈ 0.002 bit(4.954 → 4.952) 로 추측 저항에 의미 있는 차이가 없어 거부 표본추출을 넣지 않았다.
 */

/** 0·O·1·I·L 제외 31자. 순서는 기호 값 0..30 과 1:1. */
export const PUBLIC_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const PUBLIC_CODE_LENGTH = 8;
/** 저장·조회 시 형식 검사용(P6-3a 예약확인 입력값 등). */
export const PUBLIC_CODE_PATTERN: RegExp = new RegExp(`^[${PUBLIC_CODE_ALPHABET}]{${PUBLIC_CODE_LENGTH}}$`);

/** 암호학적 난수 소스. 서버는 `(n) => crypto.randomBytes(n)`(Buffer 는 Uint8Array 다). */
export type RandomBytes = (n: number) => Uint8Array;

/** 8바이트를 받아 8자 코드를 만든다. 바이트가 모자라면 짧은 코드를 만들지 않고 throw. */
export function generatePublicCode(randomBytes: RandomBytes): string {
  const bytes = randomBytes(PUBLIC_CODE_LENGTH);
  if (!(bytes instanceof Uint8Array) || bytes.length < PUBLIC_CODE_LENGTH) {
    throw new Error(
      `generatePublicCode: randomBytes(${PUBLIC_CODE_LENGTH}) 가 Uint8Array ${PUBLIC_CODE_LENGTH}바이트를 돌려주지 않았다`,
    );
  }
  let code = "";
  for (let i = 0; i < PUBLIC_CODE_LENGTH; i++) {
    code += PUBLIC_CODE_ALPHABET[bytes[i] % PUBLIC_CODE_ALPHABET.length];
  }
  return code;
}
