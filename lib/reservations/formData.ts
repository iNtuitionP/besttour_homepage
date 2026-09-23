/**
 * FormData → runGuards 입력 (플랜 v4 P3-3 · ADR-4). 순수 — zod 없음, Next 없음, env 없음.
 *
 * §계약 — 폼 필드명. **P3-4 위저드가 이 이름을 쓴다. 바꾸면 양쪽 다 깨진다.**
 * tests/reservation-action.test.ts 가 같은 표를 리터럴 상수로 들고 아래 RESERVATION_FORM_FIELDS 와 대조한다. P3-4 는 lib 쪽 상수를 import 한다.
 *
 * | FormData 키                 | zod 필드            | 비고                                           |
 * |-----------------------------|---------------------|------------------------------------------------|
 * | name                        | name                |                                                |
 * | phone / phoneIntl           | phone / phoneIntl   | XOR (M6) — 둘 중 정확히 하나. 빈 칸은 보내지 않는다 |
 * | email                       | email               | optional                                       |
 * | vehicleSlug                 | vehicleSlug         | bus45 · bus35 · limo28 · bus25 · bus16         |
 * | purposeCode                 | purposeCode         | lib/codes.ts PURPOSES                          |
 * | originCode / destinationCode| 〃                  | lib/codes.ts LOCATION_CODES                    |
 * | waypointCodes (multi)       | waypointCodes[]     | getAll — 같은 이름으로 여러 개, 최대 5           |
 * | tripType                    | tripType            | round / oneway / oneway_oneway                 |
 * | departAtLocal / returnAtLocal | 〃                | `YYYY-MM-DDTHH:mm` KST 벽시계 (datetime-local 값 그대로) |
 * | busCount / passengers       | 〃                  | number                                         |
 * | contactMethod / paymentMethod | 〃                | optional                                       |
 * | parkingIncluded / vatIncluded | 〃                | checkbox                                       |
 * | message                     | message             | optional, 1000자                               |
 * | locale                      | locale              | ko / en                                        |
 * | privacyConsent              | privacyConsent      | checkbox — 없으면 zod 실패(필수 동의)            |
 * | marketingConsent            | marketingConsent    | checkbox                                       |
 * | withdrawalConsent           | withdrawalConsent   | checkbox — 없으면 zod 실패(청약철회 제한 확인 · P1-7) |
 * | website                     | (guard)             | 허니팟 — zod 밖. 사람에게 보이지 않는 필드         |
 * | formToken                   | (guard)             | 타임트랩 — issueFormToken 이 렌더 시 내려준 값     |
 * | cf-turnstile-response       | (guard)             | Turnstile 위젯이 넣는 표준 이름 — zod 밖          |
 *
 * 변환 규칙 — 모양만 바꾼다. 검증은 guard 의 zod(ReservationInput)가 한다. 여기서 zod 를 돌리지 않는다.
 *   - 문자열: trim. 빈 문자열 → undefined (zod optional 이 잡는다)
 *   - busCount·passengers: Number(). 숫자가 아니면 NaN 으로 남긴다 — zod 가 invalid_type 으로 거부한다(조용한 보정 없음)
 *   - checkbox 4종: "on"|"true"|"1" → true, 그 밖의 값 → false, 없음·빈 문자열 → undefined
 *   - waypointCodes: getAll — 빈 항목 제거, 없으면 []
 *   - File 값(문자열이 아닌 것) → undefined
 *   - 계약 밖 키는 읽지 않는다 — status·admin_memo 같은 컬럼을 폼으로 밀어 넣을 길이 없다
 *   - FormData 가 아닌 인자(null·plain object·useActionState 의 prevState 등) → 빈 폼과 동일하게 변환한다(throw 없음, 아래 asFormData)
 *   - website·formToken·cf-turnstile-response 는 guardFields 로 분리한다(trim 없이 원문 그대로).
 *     단 turnstileToken 은 raw 에도 복사한다 — ReservationInput.turnstileToken 이 z.string() 필수라서(P3-1 보고서 §7.8).
 *     토큰이 없으면 raw 에는 '' 을 넣어 zod 를 지나게 하고 turnstile 단계가 missing-token 으로 거부하게 한다 →
 *     사용자가 "보안 확인 실패 · 새로고침" 안내를 받는다(엉뚱한 "입력 확인" 이 아니라).
 *
 * 헤더: guard 에는 x-forwarded-for · x-real-ip · host 세 개만 보이는 게으른 뷰(guardHeaders)를 넘긴다.
 * IP 를 변수에 담지 않는다 — guard 가 필요할 때 get() 으로 읽고, Turnstile remoteip 와 해시 키로만 쓴다.
 */
import { HONEYPOT_FIELD, type GuardContext, type HeadersLike } from "../guard";
import type { ReservationInput } from "../types";

/** FormData 키 → zod 필드. 키와 값이 같지만, 표로 고정해 두는 것이 계약이다(둘이 갈라지면 여기서 바꾼다). */
export const RESERVATION_FORM_FIELDS = {
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
  withdrawalConsent: "withdrawalConsent",
} as const satisfies Record<string, keyof ReservationInput>;

/** guard 전용 필드 — zod 입력에 넣지 않는다(turnstile 은 위 규칙대로 raw 에 복사). */
export const GUARD_FORM_FIELDS = {
  website: HONEYPOT_FIELD,
  formToken: "formToken",
  turnstile: "cf-turnstile-response",
} as const;

export const NUMBER_FORM_FIELDS = ["busCount", "passengers"] as const;
export const BOOLEAN_FORM_FIELDS = ["privacyConsent", "marketingConsent", "parkingIncluded", "vatIncluded", "withdrawalConsent"] as const;
export const MULTI_FORM_FIELDS = ["waypointCodes"] as const;

/** guard 가 볼 수 있는 요청 헤더. 쿠키·인증 헤더는 guard 로 가지 않는다. */
export const GUARD_HEADER_NAMES = ["x-forwarded-for", "x-real-ip", "host"] as const;

export interface GuardFields {
  website?: string;
  formToken?: string;
  turnstileToken?: string;
}

const TRUE_VALUES: ReadonlySet<string> = new Set(["on", "true", "1"]);
const NUMBER_SET: ReadonlySet<string> = new Set(NUMBER_FORM_FIELDS);
const BOOLEAN_SET: ReadonlySet<string> = new Set(BOOLEAN_FORM_FIELDS);
const MULTI_SET: ReadonlySet<string> = new Set(MULTI_FORM_FIELDS);
const HEADER_SET: ReadonlySet<string> = new Set(GUARD_HEADER_NAMES);

/** 첫 값이 문자열이면 trim 한 값, 비었거나 문자열이 아니면 undefined. */
function text(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? undefined : t;
}

/** guard 필드용 — trim 하지 않는다(허니팟은 채워진 값 그대로, 토큰은 원문 그대로). */
function verbatim(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === "string" ? v : undefined;
}

function number(fd: FormData, key: string): number | undefined {
  const s = text(fd, key);
  return s === undefined ? undefined : Number(s);
}

function checkbox(fd: FormData, key: string): boolean | undefined {
  const s = text(fd, key);
  return s === undefined ? undefined : TRUE_VALUES.has(s.toLowerCase());
}

function multi(fd: FormData, key: string): string[] {
  return fd
    .getAll(key)
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * P3-3-FIX M3 — 입력 모양 방어. 서버액션은 공개 POST 엔드포인트라 인자 모양을 클라이언트가 정한다(`<form action>` 이 아니라 `Next-Action` 헤더로
 * 임의 본문을 보낼 수 있다). FormData 가 아닌 값(null·undefined·plain object·문자열)은 "빈 폼" 으로 본다 — 모든 필드 undefined, waypointCodes [],
 * turnstileToken '', guardFields 전부 undefined → zod 가 `validation` 으로 거부한다. TypeError → Next 500 이 아니라.
 * 특히 **`useActionState` 는 액션을 `(prevState, formData)` 로 부른다** — P3-4 는 `(_prev, fd) => submitReservation(fd)` 래퍼를 써야 하고,
 * 실수로 prevState 객체가 첫 인자로 들어와도 500 이 아니라 `validation` 이어야 한다. 시그니처는 그대로 `(fd: FormData)` — 타입은 계약, 런타임만 방어.
 */
function asFormData(fd: unknown): FormData {
  return fd instanceof FormData ? fd : new FormData();
}

export function formDataToRaw(fd: FormData): { raw: Record<string, unknown>; guardFields: GuardFields } {
  const source = asFormData(fd);
  const raw: Record<string, unknown> = {};
  for (const [formKey, zodField] of Object.entries(RESERVATION_FORM_FIELDS)) {
    if (NUMBER_SET.has(formKey)) raw[zodField] = number(source, formKey);
    else if (BOOLEAN_SET.has(formKey)) raw[zodField] = checkbox(source, formKey);
    else if (MULTI_SET.has(formKey)) raw[zodField] = multi(source, formKey);
    else raw[zodField] = text(source, formKey);
  }

  const guardFields: GuardFields = {
    website: verbatim(source, GUARD_FORM_FIELDS.website),
    formToken: verbatim(source, GUARD_FORM_FIELDS.formToken),
    turnstileToken: verbatim(source, GUARD_FORM_FIELDS.turnstile),
  };
  raw.turnstileToken = guardFields.turnstileToken ?? "";

  return { raw, guardFields };
}

/** 허용 헤더 3종만 통과시키는 게으른 뷰. 값을 미리 복사하지 않는다 — IP 는 guard 가 읽는 순간에만 존재한다. */
export function guardHeaders(source: HeadersLike): HeadersLike {
  return {
    get(name: string): string | null {
      return HEADER_SET.has(name.toLowerCase()) ? source.get(name) : null;
    },
  };
}

/** runGuards 의 ctx. 허니팟은 P3-1 인계 메모대로 `{ website }` 한 칸. */
export function guardContext(source: HeadersLike, fields: GuardFields): GuardContext {
  return {
    headers: guardHeaders(source),
    formToken: fields.formToken,
    turnstileToken: fields.turnstileToken,
    honeypot: { [HONEYPOT_FIELD]: fields.website },
  };
}
