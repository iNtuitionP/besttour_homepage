/**
 * 홈 접수 현황 숨기기(0026 admin_set_feed_hidden) — 결과 매핑 (OF2-B). 순수 모듈 — Next·Supabase·server-only 없음.
 *
 * rpc 가 돌려주는 것은 `[{ outcome }]` 한 줄이다: 'hidden' | 'shown' | 'noop'(없는 id).
 * 화면(components/admin/FeedHideToggle.tsx)이 쓰는 결과는 `{ ok, changed, code }` — 다른 관리자 액션(lib/admin/result.ts)과 같은 모양이라
 * 성공은 토스트, 실패는 배너로 가는 판정(components/admin/feedback.ts)을 그대로 쓴다. 개인정보·메모는 결과에 싣지 않는다.
 */
export type FeedHiddenCode = "hidden" | "shown" | "failed";

export interface FeedHiddenResult {
  ok: boolean;
  changed: boolean;
  code: FeedHiddenCode;
}

export const FEED_HIDDEN_FAILED: FeedHiddenResult = { ok: false, changed: false, code: "failed" };

/** rpc 응답 → 결과. 요청한 값과 같은 outcome 만 성공이다 — noop(없는 접수)·모르는 모양은 실패로 본다. */
export function toFeedHiddenResult(hidden: boolean, rows: unknown): FeedHiddenResult {
  const first = Array.isArray(rows) ? rows[0] : rows;
  const outcome = typeof first === "object" && first !== null ? (first as Record<string, unknown>).outcome : null;
  const expected = hidden ? "hidden" : "shown";
  if (outcome !== expected) return FEED_HIDDEN_FAILED;
  return { ok: true, changed: true, code: expected };
}
