/**
 * 관리자 상태 전이 결과 — 순수 매퍼 (플랜 v4 P5-3 · ADR-4).
 *
 * 0010 의 네 함수는 전부 `(outcome text, public_code text, enqueued int)` 한 행을 돌려준다. 이 파일이 그 행을
 * **화면이 쓸 수 있는 최소**로 줄인다. DB·Next·env 없음 — 서버액션(actions/admin/reservation.ts)이 이것을 부르고,
 * 분기는 여기서만 테스트된다(액션에는 로직이 없다).
 *
 * 결과 타입에 개인정보가 없다: 이름·전화·메일·메시지는 물론 `public_code` 도 싣지 않는다. 화면은 이미 그 예약을
 * 보고 있고(상세 페이지), 결과 객체는 서버액션 응답으로 브라우저까지 나가는 값이다 — 필요 없는 것을 태우지 않는다.
 * 아래 `ADMIN_ACTION_RESULT_HAS_NO_RAW_PII` 가 keyof 로 잠근다: 원문 키를 하나라도 추가하면 컴파일이 깨진다.
 *
 * `noop` 은 오류가 아니다. 두 번째 클릭·이미 취소된 예약이 그것이고, 사장님에게는 "이미 처리된 예약입니다" 라고
 * 알려 주는 편이 맞다. 다만 **바뀐 것이 없으므로 캐시 무효화도 하지 않는다** — `changed` 가 그 판정을 담는다.
 */

/** 화면이 부를 수 있는 전이 4가지. 역방향 전이(done → new 등)는 0010 에 함수 자체가 없다. */
export const ADMIN_ACTIONS = ["confirm", "cancel", "complete", "memo"] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/** 0010 함수 이름 — RPC 이름 문자열을 코드에 흩뿌리지 않는다. */
export const ADMIN_RPC = {
  confirm: "admin_confirm_reservation",
  cancel: "admin_cancel_reservation",
  complete: "admin_complete_reservation",
  memo: "admin_update_memo",
} as const satisfies Record<AdminAction, string>;

/** 0010 이 돌려주는 outcome 문자열 ↔ 전이. 이 표 밖의 값은 전부 실패로 본다(모르는 응답을 성공으로 읽지 않는다). */
const OUTCOME_BY_ACTION = {
  confirm: "confirmed",
  cancel: "cancelled",
  complete: "completed",
  memo: "memo_updated",
} as const satisfies Record<AdminAction, string>;

/** 화면 문구 키 — messages/ko.json `admin.detail.result.*`. 문구 자체는 여기 두지 않는다. */
export type AdminActionCode = "confirmed" | "cancelled" | "completed" | "memoUpdated" | "alreadyHandled" | "failed";

const CODE_BY_ACTION = {
  confirm: "confirmed",
  cancel: "cancelled",
  complete: "completed",
  memo: "memoUpdated",
} as const satisfies Record<AdminAction, AdminActionCode>;

export interface AdminActionResult {
  /** 사장님에게 빨간 오류를 보일 것인가 — noop 은 ok 다. */
  ok: boolean;
  /** DB 가 실제로 바뀌었는가. 캐시 무효화·화면 갱신은 이것이 true 일 때만. */
  changed: boolean;
  code: AdminActionCode;
}

type RawPiiKey = "name" | "phone" | "email" | "message" | "memo" | "adminMemo" | "admin_memo" | "publicCode" | "public_code";
/** keyof 잠금 — 결과 객체에 원문 키가 없다(추가하면 컴파일 실패). lib/reservation-check/view.ts 와 같은 방식. */
export const ADMIN_ACTION_RESULT_HAS_NO_RAW_PII: Extract<keyof AdminActionResult, RawPiiKey> extends never ? true : never = true;

export const FAILED_RESULT: AdminActionResult = { ok: false, changed: false, code: "failed" };
export const ALREADY_HANDLED_RESULT: AdminActionResult = { ok: true, changed: false, code: "alreadyHandled" };

/** 관리자 화면 전체를 다시 그리게 하는 경로. 세그먼트 하위(목록·상세)까지 함께 무효화한다. */
export const ADMIN_REVALIDATE_PATH = "/admin";

/** PostgREST 는 table 반환 함수의 결과를 배열로 준다. 드라이버·버전 차이를 여기서 흡수한다(단일 객체도 받는다). */
function firstRow(rows: unknown): Record<string, unknown> | null {
  const row = Array.isArray(rows) ? rows[0] : rows;
  return typeof row === "object" && row !== null ? (row as Record<string, unknown>) : null;
}

/**
 * rpc 응답 → 결과. 입력 행의 다른 키(개인정보가 섞여 와도)는 옮기지 않는다 — 필드 3개를 새로 만든다.
 * outcome 을 읽지 못하거나 이 전이의 것이 아니면 실패다.
 */
export function toActionResult(action: AdminAction, rows: unknown): AdminActionResult {
  const row = firstRow(rows);
  const outcome = row === null ? null : row.outcome;
  if (typeof outcome !== "string") return FAILED_RESULT;
  if (outcome === "noop") return ALREADY_HANDLED_RESULT;
  if (outcome !== OUTCOME_BY_ACTION[action]) return FAILED_RESULT;
  return { ok: true, changed: true, code: CODE_BY_ACTION[action] };
}
