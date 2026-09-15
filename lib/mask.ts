/**
 * 개인정보(이름·전화번호) 표시용 마스킹 유틸.
 * admin 화면 등에서 확정 전 목록 노출 시 사용한다. 순수 함수, 외부 의존 없음.
 */

/**
 * 이름의 첫 글자만 남기고 나머지를 '*'로 가린다.
 * 별표 개수는 첫 글자를 제외한 나머지 길이를 1~2개 범위로 clamp한다:
 *  - 1글자 이름도 최소 1개의 별표를 붙여 "가려졌다"는 사실 자체는 드러낸다.
 *  - 3글자 이상 이름은 별표를 2개로 고정해, 실제 이름 길이(4글자 이상 등)가
 *    노출되지 않도록 한다.
 * 예: "한지원" → "한**", "한" → "한*", "John" → "J**"
 */
export function maskName(name: string): string {
  const first = name.slice(0, 1);
  const starCount = Math.min(Math.max(name.length - 1, 1), 2);
  return first + "*".repeat(starCount);
}

const ELEVEN_DIGIT_PATTERN = /^\d{11}$/;
const TEN_DIGIT_PATTERN = /^\d{10}$/;

/**
 * 전화번호를 가운데 자리만 가려서 반환한다.
 * 하이픈 유무와 무관하게 숫자만 추출해 자릿수로 포맷을 판단한다:
 *  - 11자리(예: 010-1234-5678): 3-4-4 구성, 가운데 4자리 마스킹
 *  - 10자리(예: 010-123-4567): 3-3-4 구성, 가운데 3자리 마스킹
 * 형식을 알 수 없는 입력(자릿수가 10/11이 아니거나 숫자가 아닌 문자 포함)은
 * 원문을 절대 노출하지 않고 "***"만 반환한다(안전 우선 폴백).
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/-/g, "");

  if (ELEVEN_DIGIT_PATTERN.test(digits)) {
    return `${digits.slice(0, 3)}-****-${digits.slice(7, 11)}`;
  }

  if (TEN_DIGIT_PATTERN.test(digits)) {
    return `${digits.slice(0, 3)}-***-${digits.slice(6, 10)}`;
  }

  return "***";
}

// =============================================================================
// 저장형(E.164) 값 마스킹 — 표시 계층 공용 (P6-3a 리뷰 M-1 · P5-8)
//
// 이 두 함수는 원래 lib/reservation-check/view.ts 안에 있었고, P5-8 발송 내역이 같은 판정을 다시 써야 해서
// 여기로 올렸다. **사본을 두지 않는 것이 요점이다** — 개인정보 변환은 한쪽만 조여지면 다른 쪽이 계속 새는
// 종류의 코드다. 호출부는 lib/reservation-check/view.ts 와 lib/admin/notifications.ts 둘뿐이고, 둘 다 아래 구현을 그대로 쓴다.
// =============================================================================

/** 국내 휴대전화 국내 표기(01x + 8~9자리). maskPhone 은 10·11자리를 국내 3-3-4 / 3-4-4 로 가정하므로 이 형태만 넘긴다. */
const KR_MOBILE_DOMESTIC = /^01\d{8,9}$/;

/** 형식을 모르면 아무 숫자도 내보내지 않는다 — maskPhone 의 자체 폴백과 같은 값. */
const MASKED_FALLBACK = "***";

/**
 * 저장 형식(E.164, lib/reservations/phone.ts)의 전화번호를 가린다.
 *
 * `+82` **휴대전화일 때만** 국내 표기로 되돌려 가린다 — `+8210…` → `010…` → `010-****-5678`.
 * 그 밖은 **전부 `***`**(fail-closed, P6-3a 리뷰 M-1):
 *   - `+82` 가 아닌 해외 번호 — `+15551234567` 을 숫자열 그대로 maskPhone 에 넘기면 11자리 국내 번호로 오인해
 *     `155-****-4567` 을 만든다. 국가번호·지역번호가 새고 국내 번호처럼 오독된다.
 *   - `+82` 유선 번호(`+82212345678`), 형식을 알 수 없는 값, 빈 값.
 *   - **국내 표기 원문(`010-1234-5678`)도 `***` 다.** 저장값은 언제나 E.164 이므로 국내 표기가 들어왔다는 것은
 *     출처를 모른다는 뜻이고, 모르는 값을 짐작해 일부라도 내보내지 않는다.
 * 원문은 어떤 경우에도 나가지 않는다.
 */
export function maskStoredPhone(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed.startsWith("+82")) return MASKED_FALLBACK;
  const domestic = `0${trimmed.replace(/\D/g, "").slice(2)}`;
  return KR_MOBILE_DOMESTIC.test(domestic) ? maskPhone(domestic) : MASKED_FALLBACK;
}

/**
 * 메일 주소를 가린다 — 로컬 파트를 통째로 가리고 도메인만 남긴다(`bestour2013@naver.com` → `***@naver.com`).
 * `@` 가 없거나 로컬 파트가 비면(`@naver.com`) 도메인도 내보내지 않고 `***`.
 * 도메인을 남기는 이유: 어느 계정으로 나갔는지 사람이 알아볼 수 있어야 하는데, 그 판단에 로컬 파트는 필요 없다.
 */
export function maskEmailAddress(address: string): string {
  const trimmed = address.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return MASKED_FALLBACK;
  const domain = trimmed.slice(at + 1);
  return domain === "" ? MASKED_FALLBACK : `${MASKED_FALLBACK}@${domain}`;
}
