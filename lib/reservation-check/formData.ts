/**
 * 예약확인 FormData → runCheckGuards 입력 (플랜 v4 P6-3a · ADR-4). 순수 — zod 없음, Next 없음, env 없음.
 * lib/reservations/formData.ts(P3-3)와 같은 규칙으로 **모양만 바꾼다**. 검증은 guards.ts 의 zod(CheckInput)가 한다.
 *
 * §계약 — 폼 필드명. components/reservation-check/fields.ts 가 같은 값을 `typeof` 로 잠근 사본을 클라이언트에서 쓴다.
 *
 * | FormData 키 | zod 필드   | 비고                                             |
 * |-------------|------------|--------------------------------------------------|
 * | publicCode  | publicCode | 8자 접수번호. trim 만 — 대문자 정규화는 zod 가 한다  |
 * | phoneLast4  | phoneLast4 | 휴대폰 뒷 4자리(숫자)                               |
 * | website     | (guard)    | 허니팟 — zod 밖. 사람에게 보이지 않는 필드            |
 *
 * 변환 규칙
 *   - 문자열: trim. 빈 문자열 → undefined. File 값(문자열이 아닌 것) → undefined
 *   - 계약 밖 키는 읽지 않는다
 *   - FormData 가 아닌 인자(null·plain object·useActionState 의 prevState 등) → 빈 폼과 동일(throw 없음, P3-3-FIX M3)
 *   - website 는 guardFields 로 분리한다(trim 없이 원문 그대로)
 *
 * 헤더: guard 에는 P3-3 의 guardHeaders(x-forwarded-for · x-real-ip · host 세 개만 보이는 게으른 뷰)를 그대로 재사용한다.
 * IP 를 변수에 담지 않는다 — guard 가 해시 키로만 쓴다.
 */
import { HONEYPOT_FIELD, type HeadersLike } from "../guard";
import { guardHeaders } from "../reservations/formData";
import type { CheckGuardContext } from "./guards";

export const CHECK_FORM_FIELDS = {
  publicCode: "publicCode",
  phoneLast4: "phoneLast4",
} as const;

export const CHECK_GUARD_FORM_FIELDS = {
  website: HONEYPOT_FIELD,
} as const;

export interface CheckGuardFields {
  website?: string;
}

function asFormData(fd: unknown): FormData {
  return fd instanceof FormData ? fd : new FormData();
}

/** 첫 값이 문자열이면 trim 한 값, 비었거나 문자열이 아니면 undefined. */
function text(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? undefined : t;
}

/** guard 필드용 — trim 하지 않는다(허니팟은 채워진 값 그대로). */
function verbatim(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === "string" ? v : undefined;
}

export function formDataToCheckRaw(fd: FormData): { raw: Record<string, unknown>; guardFields: CheckGuardFields } {
  const source = asFormData(fd);
  return {
    raw: {
      publicCode: text(source, CHECK_FORM_FIELDS.publicCode),
      phoneLast4: text(source, CHECK_FORM_FIELDS.phoneLast4),
    },
    guardFields: { website: verbatim(source, CHECK_GUARD_FORM_FIELDS.website) },
  };
}

/** runCheckGuards 의 ctx. 허니팟은 P3-1 인계 메모대로 `{ website }` 한 칸. */
export function checkGuardContext(source: HeadersLike, fields: CheckGuardFields): CheckGuardContext {
  return {
    headers: guardHeaders(source),
    honeypot: { [HONEYPOT_FIELD]: fields.website },
  };
}
