/**
 * 예약확인 폼 클라이언트 사전 검증 — 순수 (P6-3a · T2-5).
 *
 * 서버의 zod(lib/reservation-check/guards.ts CheckInput)가 진짜 관문이다. 그리고 서버는 형식 실패를 **not_found 와 같은 응답**으로 돌려준다
 * (존재 여부가 응답 모양으로 갈라지지 않게 — lib/reservation-check/result.ts). 그래서 사람에게 필요한 형식 안내("010-0000-0000 형식으로")는
 * 이 사전 검증이 제출 전에 보여 주는 것이 전부다 — zod 와 **같은 판정**이어야 한다(tests/reservation-check.test.ts §8 이 표본으로 대조).
 *
 * guards.ts 는 ../guard 그래프(node:crypto·zod)를 끌고 와 클라이언트에서 import 할 수 없으므로 규칙은 견적 모달의 클라이언트 사본
 * (components/quote/quick-quote.ts — splitPhone · 휴대폰 패턴 · 이름 상한, 원본 lib/types 와의 동일성은 tests/quick-quote.test.ts 가 잠근다)을 쓴다.
 */
import { CHECK_FIELD_ERROR_KEYS, type CheckFieldErrors } from "@/lib/reservation-check/result";
import { NAME_MAX_LENGTH, PHONE_INTL_INPUT_PATTERN, PHONE_KR_INPUT_PATTERN, splitPhone } from "@/components/quote/quick-quote";

export function validateCheckForm(values: { phone: string; name: string }): CheckFieldErrors {
  const errors: CheckFieldErrors = {};
  const name = values.name.trim();
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) errors.name = CHECK_FIELD_ERROR_KEYS.name;
  const { phone, phoneIntl } = splitPhone(values.phone);
  const phoneOk = phoneIntl !== "" ? PHONE_INTL_INPUT_PATTERN.test(phoneIntl) : PHONE_KR_INPUT_PATTERN.test(phone);
  if (!phoneOk) errors.phone = CHECK_FIELD_ERROR_KEYS.phone;
  return errors;
}
