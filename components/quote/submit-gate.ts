/**
 * 제출 버튼 게이트 — 순수 (P3-4, 렌더 전략·토큰 컨트롤러 결정).
 *
 * 우선순위: not-ready(폼 토큰 없음 또는 Turnstile 사이트키 없음 — 서버가 어차피 거부하니 UI 도 정직하게 닫는다)
 *          > consent(필수 동의 미체크 — 개인정보 수집·이용 · 청약철회 제한 확인(P1-7) 둘 다. 사전 선택 금지, 체크해야 열린다)
 *          > pending(제출 중 — 중복 제출 방지)
 *          > null(제출 가능).
 */
export type SubmitBlock = "not-ready" | "consent" | "pending" | null;

export interface SubmitGateInput {
  formToken: string | null;
  siteKey: string;
  privacyConsent: boolean;
  withdrawalConsent: boolean;
  pending: boolean;
}

export function isIntakeReady(formToken: string | null, siteKey: string): boolean {
  return typeof formToken === "string" && formToken.length > 0 && siteKey.length > 0;
}

export function submitBlock(i: SubmitGateInput): SubmitBlock {
  if (!isIntakeReady(i.formToken, i.siteKey)) return "not-ready";
  if (!i.privacyConsent || !i.withdrawalConsent) return "consent";
  if (i.pending) return "pending";
  return null;
}
