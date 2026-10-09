/**
 * 청약철회 제한 고지의 문단 구성 — 순수 함수 (P1-7 R2 [P1-1]).
 *
 * 영어 손님이 읽지 못하는 문장에 동의하게 하면 동의의 효력이 약해진다. 그래서 이 고지만은 영문 화면에 **번역본**(원장 WITHDRAWAL.noticeEn —
 * "한국어가 법적 원문" 이라는 문장이 그 안에 있다)을 먼저 싣고, 한국어 원문을 그 아래 `lang="ko"` 로 함께 둔다. 한국어 화면은 원문 한 문단.
 * 문구는 인자로만 받는다(원장을 import 하지 않는다) — 위저드·이용안내·약관이 각자 원장에서 읽어 넘기고, 셋이 같은 구성을 쓴다.
 */
export interface WithdrawalParagraph {
  /** `data-legal` 값 — 한국어 원문은 언제나 `withdrawal-restriction`(테스트·browse 가 존재의 증거로 잠근다). */
  legal: "withdrawal-restriction" | "withdrawal-restriction-en";
  /** 한국어 화면의 원문은 undefined(속성 없음 — ko 마크업 불변), 영문 화면은 "en"/"ko". */
  lang: "en" | "ko" | undefined;
  text: string;
}

export function withdrawalParagraphs(locale: string, notice: string, noticeEn: string): WithdrawalParagraph[] {
  if (locale !== "en") return [{ legal: "withdrawal-restriction", lang: undefined, text: notice }];
  return [
    { legal: "withdrawal-restriction-en", lang: "en", text: noticeEn },
    { legal: "withdrawal-restriction", lang: "ko", text: notice },
  ];
}
