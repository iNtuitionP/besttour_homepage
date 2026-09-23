/**
 * 위저드 상태 — 리듀서·검증·폼 값 투영. 순수(React 없음, DOM 없음, env 없음) — tests/quote-wizard.test.ts 가 직접 돌린다 (P3-4).
 *
 * 설계
 *   - 6단계는 브리프 표 순서: 1 여행 구분 · 2 차량 · 3 경로 · 4 일정 · 5 조건 · 6 연락처·동의·제출.
 *   - 단계마다 서버를 부르지 않는다. 제출은 6단계에서 한 번(actions/reservation.ts submitReservation).
 *   - 검증은 서버 zod(ReservationInput)의 규칙을 사람에게 먼저 보여 주는 **사전 검사**다. 서버가 최종이다(P3-3 인계).
 *   - 날짜·시각은 KST 벽시계 문자열 그대로 두고 이어 붙이기만 한다(변환 금지). 귀가 ≤ 출발 비교도 문자열(같은 자릿수 형식).
 *   - 귀가 규칙(0006): round 필수 · oneway_oneway 선택 · oneway 숨김(보내지 않음). oneway 로 바꾸면 귀가 날짜를 비운다.
 *   - 경유지 최대 5(zod max(5)). 추가만 하고 고르지 않은 칸("")은 검증에서 걸린다(서버는 빈 항목을 버리지만, 사람에게는 의도를 묻는다).
 *   - 연락처는 phone(국내) XOR phoneIntl(해외) — phoneKind 로 어느 칸이 살아 있는지 정하고 toFormValues 가 나머지를 "" 로 낸다.
 *   - 동의 3종(개인정보 필수 · 광고 선택 · 청약철회 제한 확인 필수 — P1-7)은 상태에 있지만 초안(draft.ts)에는 직렬화되지 않고,
 *     init 도 절대 켜지 않는다(사전 선택 금지 — ADR-6).
 */
import { isLocationCode, PURPOSES } from "@/lib/codes";

import { isCalendarDate, isClockTime, localStamp } from "./datetime";
import type { FormFieldKey } from "./fields";
import { PHONE_INTL_INPUT_PATTERN, PHONE_KR_INPUT_PATTERN } from "./options";
import type { Prefill } from "./prefill";

export const STEP_COUNT = 6 as const;
export const STEP_KEYS = ["purpose", "vehicle", "route", "schedule", "options", "contact"] as const;
export type StepKey = (typeof STEP_KEYS)[number];
export type Step = 1 | 2 | 3 | 4 | 5 | 6;

export const MAX_WAYPOINTS = 5;
export const BUS_COUNT_RANGE = { min: 1, max: 20 } as const;
export const PASSENGERS_RANGE = { min: 1, max: 900 } as const;
export const NAME_MAX_LENGTH = 30;
export const MESSAGE_MAX_LENGTH = 1000;

export type TripType = "round" | "oneway" | "oneway_oneway";
export const TRIP_TYPES: readonly TripType[] = ["round", "oneway", "oneway_oneway"];
export type PhoneKind = "kr" | "intl";
export type ReturnMode = "required" | "optional" | "hidden";

export interface WizardState {
  step: Step;
  purposeCode: string;
  vehicleSlug: string;
  originCode: string;
  destinationCode: string;
  /** 추가된 경유지 칸. 아직 고르지 않은 칸은 "". */
  waypointCodes: string[];
  tripType: "" | TripType;
  departDate: string;
  departTime: string;
  returnDate: string;
  returnTime: string;
  busCount: string;
  passengers: string;
  contactMethod: string;
  paymentMethod: string;
  parkingIncluded: boolean;
  vatIncluded: boolean;
  message: string;
  name: string;
  phoneKind: PhoneKind;
  phone: string;
  phoneIntl: string;
  email: string;
  privacyConsent: boolean;
  marketingConsent: boolean;
  /** 청약철회 제한 확인(필수 — P1-7). 서버 zod 도 literal(true) 로 거부한다. */
  withdrawalConsent: boolean;
}

export type TextField =
  | "purposeCode"
  | "vehicleSlug"
  | "originCode"
  | "destinationCode"
  | "departDate"
  | "departTime"
  | "returnDate"
  | "returnTime"
  | "busCount"
  | "passengers"
  | "contactMethod"
  | "paymentMethod"
  | "message"
  | "name"
  | "phone"
  | "phoneIntl"
  | "email";
export type BoolField = "parkingIncluded" | "vatIncluded" | "privacyConsent" | "marketingConsent" | "withdrawalConsent";
/** 초안에 들어가는 필드 — 단계·동의 제외. */
export type DraftFields = Omit<WizardState, "step" | "privacyConsent" | "marketingConsent" | "withdrawalConsent">;

/** 목업 기본값: 출발 08:00 · 상행 18:00 · 1대 · 견적 확인 핸드폰 · 계산 현금. 인원은 비워 둔다(기본 숫자를 접수 데이터로 보내지 않는다). */
export const INITIAL_STATE: WizardState = {
  step: 1,
  purposeCode: "",
  vehicleSlug: "",
  originCode: "",
  destinationCode: "",
  waypointCodes: [],
  tripType: "",
  departDate: "",
  departTime: "08:00",
  returnDate: "",
  returnTime: "18:00",
  busCount: "1",
  passengers: "",
  contactMethod: "mobile",
  paymentMethod: "cash",
  parkingIncluded: false,
  vatIncluded: false,
  message: "",
  name: "",
  phoneKind: "kr",
  phone: "",
  phoneIntl: "",
  email: "",
  privacyConsent: false,
  marketingConsent: false,
  withdrawalConsent: false,
};

export type WizardAction =
  | { type: "set"; field: TextField; value: string }
  | { type: "toggle"; field: BoolField; value: boolean }
  | { type: "setPhoneKind"; value: PhoneKind }
  | { type: "setTripType"; value: TripType }
  | { type: "addWaypoint" }
  | { type: "setWaypoint"; index: number; value: string }
  | { type: "removeWaypoint"; index: number }
  | { type: "next" }
  | { type: "prev" }
  | { type: "goto"; step: number }
  /** 마운트 직후 한 번 — 초안(sessionStorage) 위에 프리필(URL)을 덮고, 단계를 도달 가능한 곳까지 자른다. 동의는 절대 켜지 않는다. */
  | { type: "init"; draft: Partial<DraftFields> | null; prefill: Prefill }
  | { type: "reset" };

export function clampStep(n: unknown): Step {
  const v = typeof n === "number" ? n : typeof n === "string" && /^\d+$/.test(n) ? Number(n) : NaN;
  if (!Number.isInteger(v)) return 1;
  return Math.min(STEP_COUNT, Math.max(1, v)) as Step;
}

/** 귀가(상행) 입력란 규칙 — round 필수 · oneway_oneway 선택 · oneway/미선택 숨김. */
export function returnMode(tripType: WizardState["tripType"]): ReturnMode {
  if (tripType === "round") return "required";
  if (tripType === "oneway_oneway") return "optional";
  return "hidden";
}

export function departAtLocal(s: Pick<WizardState, "departDate" | "departTime">): string {
  return localStamp(s.departDate, s.departTime);
}

/** oneway(그리고 미선택)면 상태에 값이 남아 있어도 보내지 않는다 — 0006 CHECK(oneway 의 return_at 은 null). */
export function returnAtLocal(s: Pick<WizardState, "tripType" | "returnDate" | "returnTime">): string {
  if (returnMode(s.tripType) === "hidden") return "";
  return localStamp(s.returnDate, s.returnTime);
}

function prefillToState(p: Prefill): Partial<DraftFields> {
  const out: Partial<DraftFields> = {};
  if (p.originCode) out.originCode = p.originCode;
  if (p.destinationCode) out.destinationCode = p.destinationCode;
  if (p.departDate) out.departDate = p.departDate;
  if (p.departTime) out.departTime = p.departTime;
  if (p.passengers) out.passengers = p.passengers;
  if (p.vehicleSlug) out.vehicleSlug = p.vehicleSlug;
  return out;
}

/** 초안·프리필에서 단계·동의 키가 섞여 들어와도 버린다(draft.ts 가 이미 거르지만 리듀서도 스스로 지킨다). */
function withoutGuardedKeys<T extends object>(o: T | null | undefined): Partial<DraftFields> {
  if (!o) return {};
  const { step: _s, privacyConsent: _p, marketingConsent: _m, withdrawalConsent: _w, ...rest } = o as Record<string, unknown>;
  void _s;
  void _p;
  void _m;
  void _w;
  return rest as Partial<DraftFields>;
}

export function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "set":
      return { ...state, [action.field]: action.value };
    case "toggle":
      return { ...state, [action.field]: action.value };
    case "setPhoneKind":
      return { ...state, phoneKind: action.value };
    case "setTripType":
      return action.value === "oneway" ? { ...state, tripType: action.value, returnDate: "" } : { ...state, tripType: action.value };
    case "addWaypoint":
      return state.waypointCodes.length >= MAX_WAYPOINTS ? state : { ...state, waypointCodes: [...state.waypointCodes, ""] };
    case "setWaypoint": {
      if (action.index < 0 || action.index >= state.waypointCodes.length) return state;
      const next = [...state.waypointCodes];
      next[action.index] = action.value;
      return { ...state, waypointCodes: next };
    }
    case "removeWaypoint": {
      if (action.index < 0 || action.index >= state.waypointCodes.length) return state;
      return { ...state, waypointCodes: state.waypointCodes.filter((_, i) => i !== action.index) };
    }
    case "next":
      return { ...state, step: clampStep(state.step + 1) };
    case "prev":
      return { ...state, step: clampStep(state.step - 1) };
    case "goto":
      return { ...state, step: clampStep(action.step) };
    case "init": {
      const merged: WizardState = {
        ...state,
        ...withoutGuardedKeys(action.draft),
        ...prefillToState(action.prefill),
        privacyConsent: false,
        marketingConsent: false,
        withdrawalConsent: false,
      };
      return { ...merged, step: Math.min(state.step, firstInvalidStep(merged)) as Step };
    }
    case "reset":
      return INITIAL_STATE;
  }
}

// =============================================================================
// 검증 — 서버 zod 규칙의 사전 검사. messageKey 는 messages/ko.json quote.* 상대 키.
// =============================================================================

export interface FieldError {
  /** FormData 키(= 서버 fieldErrors 키). 단계 이동·포커스에 쓴다. */
  field: string;
  messageKey: string;
}

const SLUG_PATTERN = /^[a-z0-9-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PURPOSE_SET = new Set<string>(PURPOSES);

function isIntIn(s: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(s)) return false;
  const n = Number(s);
  return n >= min && n <= max;
}

export function validateStep(s: WizardState, step: Step): FieldError[] {
  const errors: FieldError[] = [];
  const push = (field: string, messageKey: string) => errors.push({ field, messageKey });

  switch (step) {
    case 1:
      if (!PURPOSE_SET.has(s.purposeCode)) push("purposeCode", "steps.purpose.error");
      break;
    case 2:
      if (!SLUG_PATTERN.test(s.vehicleSlug)) push("vehicleSlug", "steps.vehicle.error");
      break;
    case 3:
      if (!isLocationCode(s.originCode)) push("originCode", "steps.route.error");
      if (!isLocationCode(s.destinationCode)) push("destinationCode", "steps.route.error");
      if (s.waypointCodes.length > MAX_WAYPOINTS || s.waypointCodes.some((c) => !isLocationCode(c))) {
        push("waypointCodes", "steps.route.errorWaypoint");
      }
      break;
    case 4: {
      if (!TRIP_TYPES.includes(s.tripType as TripType)) push("tripType", "steps.schedule.errorTrip");
      const dep = departAtLocal(s);
      if (dep === "") push("departAtLocal", "steps.schedule.errorDepart");
      const mode = returnMode(s.tripType);
      // required: 언제나 검사. optional(oneway_oneway): 날짜를 적기 시작했을 때만 — 적었으면 완전해야 하고 출발보다 뒤여야 한다.
      if (mode === "required" || (mode === "optional" && s.returnDate !== "")) {
        const ret = localStamp(s.returnDate, s.returnTime);
        const incomplete = !isCalendarDate(s.returnDate) || !isClockTime(s.returnTime);
        if (incomplete || (dep !== "" && ret <= dep)) push("returnAtLocal", "steps.schedule.errorReturn");
      }
      if (!isIntIn(s.busCount, BUS_COUNT_RANGE.min, BUS_COUNT_RANGE.max)) push("busCount", "steps.schedule.errorBus");
      if (!isIntIn(s.passengers, PASSENGERS_RANGE.min, PASSENGERS_RANGE.max)) push("passengers", "steps.schedule.errorPax");
      break;
    }
    case 5:
      if (s.message.length > MESSAGE_MAX_LENGTH) push("message", "steps.options.errorMessage");
      break;
    case 6: {
      const name = s.name.trim();
      if (name.length === 0 || name.length > NAME_MAX_LENGTH) push("name", "steps.contact.errorName");
      if (s.phoneKind === "intl") {
        if (!PHONE_INTL_INPUT_PATTERN.test(s.phoneIntl.trim())) push("phoneIntl", "steps.contact.errorPhoneIntl");
      } else if (!PHONE_KR_INPUT_PATTERN.test(s.phone.trim())) {
        push("phone", "steps.contact.errorPhone");
      }
      const email = s.email.trim();
      if (email !== "" && !EMAIL_PATTERN.test(email)) push("email", "steps.contact.errorEmail");
      if (!s.privacyConsent) push("privacyConsent", "steps.contact.consentRequired");
      if (!s.withdrawalConsent) push("withdrawalConsent", "steps.contact.consentRequired");
      break;
    }
  }
  return errors;
}

export function validateAll(s: WizardState): FieldError[] {
  const all: FieldError[] = [];
  for (let step = 1 as Step; step <= STEP_COUNT; step++) all.push(...validateStep(s, step as Step));
  return all;
}

/** 1~5 중 처음으로 검증에 걸리는 단계, 없으면 6. 새로고침·직접 진입 시 갈 수 있는 최대 단계다. */
export function firstInvalidStep(s: WizardState): Step {
  for (let step = 1; step < STEP_COUNT; step++) {
    if (validateStep(s, step as Step).length > 0) return step as Step;
  }
  return STEP_COUNT;
}

const FIELD_STEP: Readonly<Record<string, Step>> = {
  purposeCode: 1,
  vehicleSlug: 2,
  originCode: 3,
  destinationCode: 3,
  waypointCodes: 3,
  tripType: 4,
  departAtLocal: 4,
  returnAtLocal: 4,
  busCount: 4,
  passengers: 4,
  contactMethod: 5,
  paymentMethod: 5,
  parkingIncluded: 5,
  vatIncluded: 5,
  message: 5,
};

/** 서버 fieldErrors 키(= FormData 키)가 속한 단계. 모르는 키·연락처·동의·guard 필드는 6(제출 단계). */
export function stepForField(field: string): Step {
  return FIELD_STEP[field] ?? 6;
}

// =============================================================================
// 폼 값 투영 — 계약표(RESERVATION_FORM_FIELDS)의 키 전부. 파생 필드(departAtLocal·returnAtLocal·phone·phoneIntl·locale)는
// 위저드가 이것으로 hidden input 을 렌더하고, 나머지는 같은 이름의 네이티브 컨트롤이 낸다.
// =============================================================================

export type FormValues = Record<FormFieldKey, string | string[] | boolean>;

export function toFormValues(s: WizardState, locale: string = "ko"): FormValues {
  return {
    name: s.name.trim(),
    phone: s.phoneKind === "kr" ? s.phone.trim() : "",
    phoneIntl: s.phoneKind === "intl" ? s.phoneIntl.trim() : "",
    email: s.email.trim(),
    vehicleSlug: s.vehicleSlug,
    purposeCode: s.purposeCode,
    originCode: s.originCode,
    destinationCode: s.destinationCode,
    waypointCodes: s.waypointCodes.filter((c) => c !== ""),
    tripType: s.tripType,
    departAtLocal: departAtLocal(s),
    returnAtLocal: returnAtLocal(s),
    busCount: s.busCount,
    passengers: s.passengers,
    contactMethod: s.contactMethod,
    paymentMethod: s.paymentMethod,
    parkingIncluded: s.parkingIncluded,
    vatIncluded: s.vatIncluded,
    message: s.message.trim(),
    locale,
    privacyConsent: s.privacyConsent,
    marketingConsent: s.marketingConsent,
    withdrawalConsent: s.withdrawalConsent,
  };
}
