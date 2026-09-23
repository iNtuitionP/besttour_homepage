/**
 * 청약철회 제한 고지 문단 (P1-7 R2 [P1-1]) — 위저드 6단계 · 이용안내 취소·환불 절 · 약관 제8조 아래가 함께 쓴다.
 * 문구는 props 로만 받는다(원장 WITHDRAWAL.notice · noticeEn 을 부르는 쪽이 넘긴다). 구성은 withdrawal-text.ts(순수 함수)가 정한다:
 * 한국어 화면은 원문 한 문단, 영문 화면은 번역본(lang="en") 다음에 원문(lang="ko"). 이 파일에는 한글 리터럴이 없다.
 */
import { withdrawalParagraphs } from "./withdrawal-text";

export function WithdrawalRestrictionText({
  locale,
  notice,
  noticeEn,
  className,
}: {
  locale: string;
  notice: string;
  noticeEn: string;
  className?: string;
}) {
  return (
    <>
      {withdrawalParagraphs(locale, notice, noticeEn).map((p) => (
        <p key={p.legal} className={className} data-legal={p.legal} lang={p.lang}>
          {p.text}
        </p>
      ))}
    </>
  );
}
