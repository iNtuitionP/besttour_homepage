/**
 * 로케일의 자기 이름(endonym) — 언어 전환 링크의 글자 (P2-6b).
 *
 * 번역 문자열이 아니다. 전환 링크는 **가려는 언어로** 적는 것이 국제 관례다 — 한국어를 모르는 손님도 "English" 를,
 * 영어를 모르는 손님도 "한국어" 를 알아본다. 그래서 messages/*.json 이 아니라 여기 둔다(en.json 에 한글이 들어가지 않는다).
 * 링크는 `lang`·`hrefLang` 으로 대상 언어를 표시한다(components/layout/LocaleSwitch.tsx).
 */
import type { Locale } from "@/i18n/routing";

export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  ko: "한국어",
  en: "English",
};
