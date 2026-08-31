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
