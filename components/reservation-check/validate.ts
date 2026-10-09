/**
 * 예약확인 폼 클라이언트 사전 검증 — 순수 (P6-3a).
 *
 * 서버의 zod(lib/reservation-check/guards.ts CheckInput)가 진짜 관문이다. 여기는 왕복 없이 "8자리를 확인해 주세요" 를 바로 보여 주기 위한 거울이다.
 * guards.ts 는 ../guard 그래프(node:crypto·zod)를 끌고 와 클라이언트에서 import 할 수 없으므로 규칙을 다시 적는다 —
 * 코드 형식은 lib/reservations/publicCode.ts 의 PUBLIC_CODE_PATTERN(같은 상수), 뒷자리는 `^\d{4}$`.
 * tests/reservation-check.test.ts §8 이 표본 입력으로 zod 와 같은 판정을 내는지 대조한다.
 */
import { CHECK_FIELD_ERROR_KEYS, type CheckFieldErrors } from "@/lib/reservation-check/result";
import { PUBLIC_CODE_PATTERN } from "@/lib/reservations/publicCode";

/** guards.ts PHONE_LAST4_PATTERN 과 같은 규칙(숫자 4개). */
const PHONE_LAST4 = /^\d{4}$/;

/** zod 와 같은 정규화 — trim → 대문자. */
export function normalizePublicCode(value: string): string {
  return value.trim().toUpperCase();
}

export function validateCheckForm(values: { publicCode: string; phoneLast4: string }): CheckFieldErrors {
  const errors: CheckFieldErrors = {};
  if (!PUBLIC_CODE_PATTERN.test(normalizePublicCode(values.publicCode))) errors.publicCode = CHECK_FIELD_ERROR_KEYS.publicCode;
  if (!PHONE_LAST4.test(values.phoneLast4)) errors.phoneLast4 = CHECK_FIELD_ERROR_KEYS.phoneLast4;
  return errors;
}
