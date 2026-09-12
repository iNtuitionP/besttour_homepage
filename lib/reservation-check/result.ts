/**
 * 예약확인 서버액션 결과·로그 변환 — 순수 (플랜 v4 P6-3a · ADR-4). lib/reservations/submitResult.ts(P3-3)와 같은 역할.
 *
 * actions/reservation-check.ts 는 분기하지 않고 여기 함수를 부르기만 한다. 규칙:
 *   - CheckGuardFailure.detail 은 클라이언트로 내리지 않는다. validation 만 detail(zod issues)의 path 로 필드별 문구 키를 뽑는다.
 *   - **부재·불일치·허니팟은 전부 notFoundResult()** — 같은 함수, 같은 객체 모양. 존재 여부를 구분하는 필드·문구는 없다.
 *   - 성공 결과는 뷰 모델(view.ts)뿐 — 원문 개인정보는 타입에 없다.
 *   - 로그 항목에 개인정보 없음 — 오류의 name·message·stack 뿐. Error.cause 는 싣지 않는다.
 *
 * messageKey 는 messages/ko.json 의 reservationCheck.errors.* — UI 가 t(messageKey) 로 푼다(원장 전화번호는 그 문구 안에 있고 테스트가 COMPANY.tel 과 대조).
 * 이 파일은 클라이언트에서도 import 된다(components/reservation-check/*) — 값 import 는 없고 타입만 가져온다.
 */
import type { StructuredLogEntry } from "../log";
import type { CheckGuardFailure, CheckInput } from "./guards";
import type { LookupOutcome } from "./lookup";
import type { ReservationView } from "./view";

export type CheckErrorCode = "validation" | "not_found" | "ratelimit" | "infra" | "server";
export type CheckErrorKey = `reservationCheck.errors.${CheckErrorCode}`;

export const CHECK_ERROR_KEYS: Readonly<Record<CheckErrorCode, CheckErrorKey>> = {
  validation: "reservationCheck.errors.validation",
  not_found: "reservationCheck.errors.not_found",
  ratelimit: "reservationCheck.errors.ratelimit",
  infra: "reservationCheck.errors.infra",
  server: "reservationCheck.errors.server",
};

export type CheckField = keyof CheckInput;
export type CheckFieldErrorKey = `reservationCheck.form.${"codeError" | "phoneLast4Error"}`;

/** 필드별 문구 키 — 두 칸뿐이라 필드마다 고유 문구를 준다(P3-3 의 공통 validation 키와 다른 점). */
export const CHECK_FIELD_ERROR_KEYS: Readonly<Record<CheckField, CheckFieldErrorKey>> = {
  publicCode: "reservationCheck.form.codeError",
  phoneLast4: "reservationCheck.form.phoneLast4Error",
};

export type CheckFieldErrors = Partial<Record<CheckField, CheckFieldErrorKey>>;

export type CheckResult =
  | { ok: true; view: ReservationView }
  | { ok: false; code: CheckErrorCode; messageKey: CheckErrorKey; fieldErrors?: CheckFieldErrors };

const FIELD_SET: ReadonlySet<string> = new Set(Object.keys(CHECK_FIELD_ERROR_KEYS));

/** zod issues(`{ path, code, message }[]`) → { 필드: 문구 키 }. 모르는 path·루트 이슈는 버린다. 모양이 다르면 빈 객체 — throw 하지 않는다. */
function fieldErrorsOf(detail: unknown): CheckFieldErrors {
  const out: CheckFieldErrors = {};
  if (!Array.isArray(detail)) return out;
  for (const issue of detail) {
    if (issue === null || typeof issue !== "object") continue;
    const p = (issue as { path?: unknown }).path;
    if (typeof p !== "string") continue;
    const field = p.split(".")[0];
    if (!FIELD_SET.has(field)) continue;
    out[field as CheckField] = CHECK_FIELD_ERROR_KEYS[field as CheckField];
  }
  return out;
}

export function guardFailureToCheckResult(outcome: CheckGuardFailure): CheckResult {
  const code = outcome.reason;
  if (code === "validation") {
    return { ok: false, code, messageKey: CHECK_ERROR_KEYS.validation, fieldErrors: fieldErrorsOf(outcome.detail) };
  }
  return { ok: false, code, messageKey: CHECK_ERROR_KEYS[code] };
}

/** 부재 = 불일치 = 허니팟. 항상 같은 모양. */
export function notFoundResult(): CheckResult {
  return { ok: false, code: "not_found", messageKey: CHECK_ERROR_KEYS.not_found };
}

/** 래퍼가 잡은 예외 → 사용자 결과. infra = guard 준비(env)·실행이 던짐, server = 조회가 던짐. */
export function checkFailureResult(code: "infra" | "server"): CheckResult {
  return { ok: false, code, messageKey: CHECK_ERROR_KEYS[code] };
}

export function lookupToResult(outcome: LookupOutcome): CheckResult {
  return outcome.found ? { ok: true, view: outcome.view } : notFoundResult();
}

// =============================================================================
// 로그 항목 — 개인정보 없음
// =============================================================================

export type CheckThrownEvent = "reservation_check.guard_setup_failed" | "reservation_check.lookup_failed";

export interface CheckThrownLogEntry extends StructuredLogEntry {
  level: "error";
  event: CheckThrownEvent;
  name: string;
  message: string;
  stack: string | null;
}

/** 예외 → 로그 항목. name·message·stack 만. Error 가 아니면 typeof 와 String(). */
export function checkThrownToLog(event: CheckThrownEvent, err: unknown): CheckThrownLogEntry {
  if (err instanceof Error) {
    return { level: "error", event, name: err.name, message: err.message, stack: err.stack ?? null };
  }
  return { level: "error", event, name: typeof err, message: String(err), stack: null };
}
