/**
 * 청약철회 제한 고지 문단 (P1-7 R2 [P1-1]) — 위저드 6단계 · 이용안내 취소·환불 절 · 약관 제8조 아래가 함께 쓴다.
 * 문구는 props 로만 받는다(원장 WITHDRAWAL.notice · noticeEn 을 부르는 쪽이 넘긴다). 구성은 withdrawal-text.ts(순수 함수)가 정한다:
 * 한국어 화면은 원문 한 문단, 영문 화면은 번역본(lang="en") 다음에 원문(lang="ko"). 이 파일에는 한글 리터럴이 없다.
 *
 * `beforeOriginal`(선택, P7-3 후속 2): 한국어 원문 문단 **바로 앞**에 끼울 노드. 간편 견적 모달의 영문 화면이 "자세히 보기" 안에서
 * 한국어 취소·환불 2단계 표와 적용 범위를 한국어 원문 바로 위에 두려고 쓴다 — 원문의 "위 취소·환불 규정" 이 가리킬 표가 원문과 붙어 있게.
 * 넘기지 않으면(이용안내 · 약관) 마크업은 이전과 같다.
 */
import { Fragment, type ReactNode } from "react";

import { withdrawalParagraphs } from "./withdrawal-text";

export function WithdrawalRestrictionText({
  locale,
  notice,
  noticeEn,
  className,
  beforeOriginal,
}: {
  locale: string;
  notice: string;
  noticeEn: string;
  className?: string;
  beforeOriginal?: ReactNode;
}) {
  return (
    <>
      {withdrawalParagraphs(locale, notice, noticeEn).map((p) => (
        <Fragment key={p.legal}>
          {p.legal === "withdrawal-restriction" ? beforeOriginal : null}
          <p className={className} data-legal={p.legal} lang={p.lang}>
            {p.text}
          </p>
        </Fragment>
      ))}
    </>
  );
}
