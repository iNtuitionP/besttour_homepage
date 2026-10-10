/**
 * 관리자 접수 상세의 "이 예약의 취소·환불 규정" 한 줄 — 순수 함수 (OF-T2-3 후속 · 릴리스 C 리뷰 P1-3).
 *
 * 시행일(원장 REFUND_POLICY_EFFECTIVE_FROM) 뒤에도 그 전에 접수된 예약은 옛 규정(3일/2일)이 계약 내용이다. 사이트에는 더 이상
 * 옛 규정이 없으므로, 담당자가 환불을 판단할 때 그 예약의 판을 이 줄로 본다.
 *   판   = refundPolicyEditionAt(created_at) — 확정 문자가 고르는 판과 같은 함수·같은 기준(접수 시각의 KST 날짜).
 *   숫자 = 그 판의 원장 tiers 에서 "N일" 을 뽑는다(지어내지 않는다 — 원장을 바꾸면 이 줄도 따라 바뀐다).
 *   날짜 = 옛 판은 마지막 접수일(시행일 전날), 개정 판은 시행일 — `YYYY-MM-DD` 그대로.
 * 문구 틀은 카탈로그 admin.detail.refundPolicy.{current,next}(부르는 쪽이 넘긴다) — 이 파일에는 한글 리터럴이 없다.
 * 접수 시각을 읽지 못하면 null — 화면은 줄을 숨긴다(판을 짐작해 보여 주지 않는다).
 */
import {
  REFUND_POLICY_EFFECTIVE_DATE,
  REFUND_POLICY_LAST_CURRENT_DATE,
  refundPolicyEditionAt,
  refundPolicyFor,
  type RefundPolicyEdition,
} from "@/lib/refund-policy";

export interface RefundPolicyLineLabels {
  /** "… 종전({refund}/{noRefund}) — {date}까지 접수" */
  current: string;
  /** "… 개정({refund}/{noRefund}) — {date}부터 접수" */
  next: string;
}

/** "운행일 3일 전까지" → "3일". 원장 문구에서 첫 "N일" 을 그대로 뽑는다. */
function days(when: string): string {
  const m = /(\d+)일/.exec(when);
  if (m === null) throw new Error(`refundPolicyLine: 원장 tiers 에 "N일" 이 없다 (${when})`);
  return `${m[1]}일`;
}

const fill = (tpl: string, values: Record<string, string>): string => tpl.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);

export function refundPolicyLine(createdAt: string, labels: RefundPolicyLineLabels): { edition: RefundPolicyEdition; text: string } | null {
  let edition: RefundPolicyEdition;
  try {
    edition = refundPolicyEditionAt(createdAt);
  } catch {
    return null;
  }
  const [refund, noRefund] = refundPolicyFor(edition).cancellation.tiers;
  const date = edition === "current" ? REFUND_POLICY_LAST_CURRENT_DATE : REFUND_POLICY_EFFECTIVE_DATE;
  return { edition, text: fill(labels[edition], { refund: days(refund.when), noRefund: days(noRefund.when), date }) };
}
