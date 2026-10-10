/**
 * 예약확인 서버액션 결과·로그 변환 — 순수 (플랜 v4 P6-3a · T2-5 · ADR-4). lib/reservations/submitResult.ts(P3-3)와 같은 역할.
 *
 * actions/reservation-check.ts 는 분기하지 않고 여기 함수를 부르기만 한다. 규칙:
 *   - CheckGuardFailure.detail 은 클라이언트로 내리지 않는다.
 *   - **없음·이름 불일치·지난/취소 건뿐·허니팟·형식 실패는 전부 notFoundResult()** (T2-5 · 결정 5) — 같은 함수, 같은 객체 모양.
 *     존재 여부를 구분하는 필드·문구는 없다. 형식 실패도 not_found 다: 필드별 서버 오류를 주면 응답이 갈라지고, 사람에게 필요한
 *     형식 안내는 클라이언트 사전 검증(components/reservation-check/validate.ts — zod 와 같은 판정)이 제출 전에 이미 보여 준다.
 *   - turnstile·ratelimit·infra·server 는 각자 코드다 — 존재 여부와 무관한 단계(조회 전·조회 실패)라 갈라져도 새는 것이 없고,
 *     특히 turnstile 은 손님이 보안 확인을 다시 풀어야 하므로 알려야 한다.
 *   - 성공 결과는 뷰 모델(view.ts) 목록뿐 — 원문 개인정보·접수번호는 타입에 없다.
 *   - 로그 항목에 개인정보 없음 — 오류의 name·message·stack 뿐. Error.cause 는 싣지 않는다.
 *
 * messageKey 는 messages 의 reservationCheck.errors.* — UI 가 t(messageKey, { tel }) 로 푼다.
 * 이 파일은 클라이언트에서도 import 된다(components/reservation-check/*) — 값 import 는 없고 타입만 가져온다.
 */
import type { StructuredLogEntry } from "../log";
import type { CheckGuardFailure, CheckInput } from "./guards";
import type { LookupOutcome } from "./lookup";
import type { ReservationView } from "./view";

export type CheckErrorCode = "not_found" | "turnstile" | "ratelimit" | "infra" | "server";
export type CheckErrorKey = `reservationCheck.errors.${CheckErrorCode}`;

export const CHECK_ERROR_KEYS: Readonly<Record<CheckErrorCode, CheckErrorKey>> = {
  not_found: "reservationCheck.errors.not_found",
  turnstile: "reservationCheck.errors.turnstile",
  ratelimit: "reservationCheck.errors.ratelimit",
  infra: "reservationCheck.errors.infra",
  server: "reservationCheck.errors.server",
};

export type CheckField = keyof CheckInput;
export type CheckFieldErrorKey = `reservationCheck.form.${"phoneError" | "nameError"}`;

/** 필드별 문구 키 — **클라이언트 사전 검증 전용**(validate.ts). 서버 결과에는 필드 오류가 없다(형식 실패도 not_found). */
export const CHECK_FIELD_ERROR_KEYS: Readonly<Record<CheckField, CheckFieldErrorKey>> = {
  phone: "reservationCheck.form.phoneError",
  name: "reservationCheck.form.nameError",
};

export type CheckFieldErrors = Partial<Record<CheckField, CheckFieldErrorKey>>;

export type CheckResult = { ok: true; views: ReservationView[] } | { ok: false; code: CheckErrorCode; messageKey: CheckErrorKey };

/** 없음 = 이름 불일치 = 범위 밖 = 허니팟 = 형식 실패. 항상 같은 모양. */
export function notFoundResult(): CheckResult {
  return { ok: false, code: "not_found", messageKey: CHECK_ERROR_KEYS.not_found };
}

export function guardFailureToCheckResult(outcome: CheckGuardFailure): CheckResult {
  const code = outcome.reason;
  if (code === "validation") return notFoundResult();
  return { ok: false, code, messageKey: CHECK_ERROR_KEYS[code] };
}

/** 래퍼가 잡은 예외 → 사용자 결과. infra = guard 준비(env)·실행이 던짐, server = 조회가 던짐. */
export function checkFailureResult(code: "infra" | "server"): CheckResult {
  return { ok: false, code, messageKey: CHECK_ERROR_KEYS[code] };
}

export function lookupToResult(outcome: LookupOutcome): CheckResult {
  return outcome.found ? { ok: true, views: outcome.views } : notFoundResult();
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
