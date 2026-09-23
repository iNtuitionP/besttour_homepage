/**
 * 원장 UI 문구의 로케일 해석 (P2-6) — 서버 컴포넌트 전용.
 *
 *   ko → LEDGER_UI_KO: 원장 상수 그대로(lib/i18n/ledger-ui-ko.ts). 한국어 화면의 글자는 한 글자도 바뀌지 않는다.
 *   en → messages/en.json 의 `legal` 네임스페이스(라벨·제목·안내·verbatim 영문) + 원장의 영문 필드(COMPANY.brandNameEn ·
 *        representativeEn — 사장님 확인값, 플랜 §10 E5). 상호·대표자 영문을 여기서 새로 짓지 않는다.
 *
 * 왜 next-intl 카탈로그로 ko 를 두지 않는가
 *   ko 의 원장 라벨을 messages/ko.json 에 옮기면 원장 문구가 두 벌이 된다(CLAUDE.md §3 "법정 문구는 원장 단일 출처").
 *   그래서 ko 는 원장에서 바로 읽고, en 만 카탈로그에서 읽는다. 두 쪽의 키 구조가 같다는 것은 tests/i18n-en.test.ts §4 가 잠근다.
 *
 * 법정 본문은 여기 없다 — `/en` 에서도 원장 한국어를 그대로 렌더한다(브리프 §3, 영문판은 컨트롤러가 따로 확정한다).
 * 그 블록은 koLang(locale) 로 `lang="ko"` 를 달고, 위에 <OfficialKoreanNotice notice={ledgerUi(locale).officialNotice} /> 를 둔다.
 */
import { routing } from "@/i18n/routing";
import { COMPANY, VERBATIM, WITHDRAWAL } from "@/lib/legal/disclosures";
import en from "@/messages/en.json";

import { LEDGER_UI_KO, type LedgerUi } from "./ledger-ui-ko";

export { LEDGER_UI_KO, type LedgerUi, type OfficialNotice } from "./ledger-ui-ko";

const LEDGER_UI_EN: LedgerUi = {
  ...en.legal,
  brand: COMPANY.brandNameEn,
  representative: COMPANY.representativeEn,
  // 청약철회 제한 동의 라벨의 영문은 원장의 확정 영문 필드다(P1-7 브리프 1-B — en.json 에 다시 적지 않는다).
  consent: { ...en.legal.consent, withdrawal: WITHDRAWAL.consentLabelEn },
};

/** 로케일별 원장 UI 문구. 지원하지 않는 로케일은 기본 로케일(ko) — i18n/messages.ts 의 폴백과 같다. */
export function ledgerUi(locale: string): LedgerUi {
  return locale === "en" ? LEDGER_UI_EN : LEDGER_UI_KO;
}

type VerbatimText = (typeof VERBATIM)["bookingNotice"] | (typeof VERBATIM)["showcaseNotice"];

/**
 * verbatim 두 문구의 로케일 표기. **ko 는 받은 원장 문자열을 그대로 돌려준다**(바이트 동일 — 가공 경로가 없다).
 * en 은 컨트롤러가 확정한 영문(브리프 §4). 호출부는 `localizeVerbatim(locale, VERBATIM.bookingNotice)` 처럼 원장 참조를 넘긴다 —
 * 소스에서 어느 원장 문구인지가 그대로 보이게 하려는 것이다.
 */
export function localizeVerbatim(locale: string, text: VerbatimText): string {
  if (locale !== "en") return text;
  return text === VERBATIM.bookingNotice ? LEDGER_UI_EN.verbatim.bookingNotice : LEDGER_UI_EN.verbatim.showcaseNotice;
}

/**
 * 한국어 원장 텍스트(또는 한국어 값)를 담은 요소의 `lang` 속성. ko 화면에서는 undefined(속성 자체를 내지 않는다 — ko 마크업 불변),
 * 그 밖의 로케일에서는 "ko" — 스크린리더가 한국어로 읽고, tests/i18n-en.test.ts §8 렌더 실측이 번역 누락과 구분한다.
 */
export function koLang(locale: string): "ko" | undefined {
  return locale === routing.defaultLocale ? undefined : "ko";
}
