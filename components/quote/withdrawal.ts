/**
 * 청약철회 제한 고지 문장 — 원장 TERMS 제8조에서 잘라 낸다 (P3-4 · 플랜 §11 M2).
 *
 * 약관 8조는 "회사는 이 사실을 견적 신청 화면과 예약 확정 통지에 고지합니다" 라고 약속했다. 전자상거래법 §17② 의 청약철회 제한은
 * 약관에만 있으면 부족하고 **신청 화면에 표시**돼야 성립한다. 문장은 원장에서 파생시킨다 — 여기 리터럴로 다시 쓰지 않는다.
 * 첫 문장("… 청약철회가 제한될 수 있으며, 그 경우 제7조의 취소·환불 규정이 적용됩니다.")만 쓰고, 둘째 문장(고지 약속 자체)은 뺀다.
 */
import { TERMS } from "@/lib/legal/disclosures";

/** TERMS.articles 의 0 기반 인덱스 — 제8조(청약철회). 테스트가 no === 8 을 단언한다. */
export const WITHDRAWAL_ARTICLE_INDEX = 7;

export function withdrawalArticle() {
  return TERMS.articles[WITHDRAWAL_ARTICLE_INDEX];
}

/** 제8조 본문의 첫 문장. 문장 경계는 마침표 뒤 공백. */
export function withdrawalSentence(): string {
  return withdrawalArticle().body.split(/(?<=\.)\s+/)[0];
}
