/**
 * 서버액션 결과·로그 변환 — 순수 (플랜 v4 P3-3 · ADR-4).
 *
 * actions/reservation.ts 는 분기하지 않고 여기 함수를 부르기만 한다. 규칙:
 *   - GuardFailure.detail 은 클라이언트로 내리지 않는다 — 진단용(에러코드·창 이름·zod 내부 문구)이라 봇에게 힌트가 된다.
 *     validation 만 detail(zod issues)의 path 에서 fieldErrors 를 뽑는다. 값은 전부 같은 키(reservation.errors.validation) —
 *     필드별 문구는 아직 없다(브리프 §문구 6개뿐). P3-4 가 필요하면 키를 늘린다.
 *   - 성공 결과에는 publicCode·notifyQueued 만. reservationId(uuid)·warnings 는 로그로 — 방문자에게 내부 식별자를 주지 않는다.
 *   - 로그 항목에 개인정보 없음 — 오류의 name·message·stack 과 식별자(publicCode·reservationId)뿐. Error.cause 는 싣지 않는다(무엇이든 들어갈 수 있다).
 *
 * messageKey 는 messages/ko.json 의 reservation.errors.* — UI 가 t(messageKey) 로 푼다. 전화번호는 그 문구의 `{tel}` 보간으로 원장에서 들어온다(tests/reservation-action.test.ts).
 */
import type { GuardFailure, GuardReason } from "../guard";
import type { StructuredLogEntry } from "../log";
import type { CreateReservationResult } from "../types";

export type SubmitErrorCode = GuardReason | "server";
export type ReservationErrorKey = `reservation.errors.${SubmitErrorCode}`;

export const RESERVATION_ERROR_KEYS: Readonly<Record<SubmitErrorCode, ReservationErrorKey>> = {
  validation: "reservation.errors.validation",
  bot: "reservation.errors.bot",
  turnstile: "reservation.errors.turnstile",
  ratelimit: "reservation.errors.ratelimit",
  infra: "reservation.errors.infra",
  server: "reservation.errors.server",
};

export type SubmitResult =
  | { ok: true; publicCode: string; notifyQueued: boolean }
  /**
   * 허니팟 가짜 성공 — 저장 없음. T2-5(결정 5)부터 완료 화면은 어느 쪽이든 접수번호를 보이지 않는다(같은 화면).
   * 결과 모양에는 publicCode 가 그대로 남아 있다 — 통합 테스트(reservation-action.e2e)가 이 값으로 저장 행을 찾는다. 모양 정리는 후속 판단.
   */
  | { ok: true; publicCode: null }
  | { ok: false; code: SubmitErrorCode; messageKey: ReservationErrorKey; fieldErrors?: Record<string, ReservationErrorKey> };

/** zod issues(runGuards 가 만든 `{ path, code, message }[]`) → { 첫 세그먼트: validation 키 }. 모양이 다르면 빈 객체 — throw 하지 않는다. */
function fieldErrorsOf(detail: unknown): Record<string, ReservationErrorKey> {
  const out: Record<string, ReservationErrorKey> = {};
  if (!Array.isArray(detail)) return out;
  for (const issue of detail) {
    if (issue === null || typeof issue !== "object") continue;
    const p = (issue as { path?: unknown }).path;
    if (typeof p !== "string") continue;
    const field = p.split(".")[0];
    if (field.length === 0) continue;
    out[field] = RESERVATION_ERROR_KEYS.validation;
  }
  return out;
}

export function guardFailureToResult(outcome: GuardFailure): SubmitResult {
  const code = outcome.reason;
  if (code === "validation") {
    return { ok: false, code, messageKey: RESERVATION_ERROR_KEYS.validation, fieldErrors: fieldErrorsOf(outcome.detail) };
  }
  return { ok: false, code, messageKey: RESERVATION_ERROR_KEYS[code] };
}

/** 허니팟 — 가짜 성공. */
export function silentResult(): SubmitResult {
  return { ok: true, publicCode: null };
}

/** 래퍼가 잡은 예외 → 사용자 결과. infra = guard 준비(env)·guard 실행이 던짐, server = createReservation 이 던짐. */
export function failureResult(code: "infra" | "server"): SubmitResult {
  return { ok: false, code, messageKey: RESERVATION_ERROR_KEYS[code] };
}

export function createdToResult(created: CreateReservationResult): SubmitResult {
  return { ok: true, publicCode: created.publicCode, notifyQueued: created.notifyQueued };
}

// =============================================================================
// 로그 항목 — 개인정보 없음
// =============================================================================

export type ThrownEvent = "reservation.guard_setup_failed" | "reservation.create_failed";

export interface ThrownLogEntry extends StructuredLogEntry {
  level: "error";
  event: ThrownEvent;
  name: string;
  message: string;
  stack: string | null;
}

/** 예외 → 로그 항목. name·message·stack 만. Error 가 아니면 typeof 와 String(). */
export function thrownToLog(event: ThrownEvent, err: unknown): ThrownLogEntry {
  if (err instanceof Error) {
    return { level: "error", event, name: err.name, message: err.message, stack: err.stack ?? null };
  }
  return { level: "error", event, name: typeof err, message: String(err), stack: null };
}

export interface CreateWarningLogEntry extends StructuredLogEntry {
  level: "warn";
  event: "reservation.create_warning";
  reservationId: string;
  publicCode: string;
  notifyQueued: boolean;
  warnings: string[];
}

/** createReservation 의 warnings(사장님 연락처 없음·enqueue 실패 등) → warn 로그 0~1건. 접수는 성공이므로 error 가 아니다. */
export function createdToLogs(created: CreateReservationResult): CreateWarningLogEntry[] {
  if (created.warnings.length === 0) return [];
  return [
    {
      level: "warn",
      event: "reservation.create_warning",
      reservationId: created.reservationId,
      publicCode: created.publicCode,
      notifyQueued: created.notifyQueued,
      warnings: [...created.warnings],
    },
  ];
}
