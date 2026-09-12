/**
 * 폼 필드명 — lib/reservations/formData 의 계약표를 클라이언트 번들용으로 옮긴 사본 (P3-4).
 *
 * 왜 사본인가: formData.ts 는 ../guard(index) 를 런타임 import 하고, 그 그래프에 node:crypto(timetrap·ipKey)와 zod(types)가 있다.
 * 클라이언트 컴포넌트가 그 모듈을 import 하면 브라우저 번들에 node 내장 모듈이 들어가 빌드가 깨지거나 zod 가 실려 간다.
 * 그래서 값은 여기 다시 적되 **타입은 `typeof RESERVATION_FORM_FIELDS`(type-only import)로 잠근다** — 키가 빠지거나 값이 다르면
 * tsc 가 막고, tests/quote-wizard.test.ts 가 런타임 toEqual 로 한 번 더 대조한다. 계약표가 바뀌면 여기가 컴파일에서 먼저 깨진다.
 *
 * 위저드의 모든 `name=` 은 F.* / G.* 만 쓴다(문자열 리터럴 name 0건 — 테스트가 grep 으로 잠근다).
 */
import type { GUARD_FORM_FIELDS, RESERVATION_FORM_FIELDS } from "@/lib/reservations/formData";

export const F: typeof RESERVATION_FORM_FIELDS = {
  name: "name",
  phone: "phone",
  phoneIntl: "phoneIntl",
  email: "email",
  vehicleSlug: "vehicleSlug",
  purposeCode: "purposeCode",
  originCode: "originCode",
  destinationCode: "destinationCode",
  waypointCodes: "waypointCodes",
  tripType: "tripType",
  departAtLocal: "departAtLocal",
  returnAtLocal: "returnAtLocal",
  busCount: "busCount",
  passengers: "passengers",
  contactMethod: "contactMethod",
  paymentMethod: "paymentMethod",
  parkingIncluded: "parkingIncluded",
  vatIncluded: "vatIncluded",
  message: "message",
  locale: "locale",
  privacyConsent: "privacyConsent",
  marketingConsent: "marketingConsent",
};

/** guard 필드 중 위저드가 직접 렌더하는 둘. cf-turnstile-response 는 Turnstile 위젯이 스스로 넣는다. */
export const G: Pick<typeof GUARD_FORM_FIELDS, "website" | "formToken"> = {
  website: "website",
  formToken: "formToken",
};

export type FormFieldKey = keyof typeof F;
