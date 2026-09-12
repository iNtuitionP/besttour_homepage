/**
 * 예약확인 폼 필드명 — lib/reservation-check/formData 의 계약표를 클라이언트 번들용으로 옮긴 사본 (P6-3a · P3-4 fields.ts 와 같은 이유).
 *
 * formData.ts 는 ../guard(index) 를 런타임 import 하고 그 그래프에 node:crypto 가 있어 클라이언트에서 import 할 수 없다.
 * 값은 여기 다시 적되 **타입은 `typeof`(type-only import)로 잠근다** — 키가 빠지거나 값이 다르면 tsc 가 막고,
 * tests/reservation-check.test.ts 가 런타임 toEqual 로 한 번 더 대조한다. 폼의 모든 `name=` 은 CF.* / CG.* 만 쓴다.
 */
import type { CHECK_FORM_FIELDS, CHECK_GUARD_FORM_FIELDS } from "@/lib/reservation-check/formData";

export const CF: typeof CHECK_FORM_FIELDS = {
  publicCode: "publicCode",
  phoneLast4: "phoneLast4",
};

export const CG: typeof CHECK_GUARD_FORM_FIELDS = {
  website: "website",
};
