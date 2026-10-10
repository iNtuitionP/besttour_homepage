/**
 * 취소·환불 개정 예고 상자 (OF-T2-3 · 사장님 요청 16 · 결정 4 B안) — /guide 취소·환불 절 · /terms 제7조 아래가 함께 쓴다.
 * 시행일 전에만 렌더된다(부르는 쪽이 lib/i18n/refund-change.ts refundChangeTexts 가 null 이 아닐 때만 넘긴다).
 *
 * 법정 페이지 본문은 원장 한국어(lang="ko" — 영문 화면은 부모가 단다)라 예고도 한국어 한 줄이 기본이다. 영문 화면은 청약철회 고지
 * (withdrawal-text.ts)와 같은 구성으로 영문 번역(lang="en")을 먼저 싣고 한국어를 그 아래에 둔다.
 * 문구는 props 로만 받는다 — 이 파일에는 한글 리터럴이 없다.
 */
import styles from "./legal.module.css";

export function RefundPolicyChangeNotice({ notice, noticeEn }: { notice: string; noticeEn: string | null }) {
  return (
    <div className={styles.notice} data-legal="refund-policy-change">
      {noticeEn ? (
        <p lang="en" data-legal="refund-policy-change-en">
          {noticeEn}
        </p>
      ) : null}
      <p>{notice}</p>
    </div>
  );
}
