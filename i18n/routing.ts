import { defineRouting } from "next-intl/routing";

/**
 * 라우트 URL 골격 — 한 번 발송된 문자 본문의 링크를 죽이지 않기 위해 먼저 굳힌다.
 *
 * - locales: ko(기본), en
 * - localePrefix: "as-needed" → ko는 프리픽스 없음(`/`, `/guide`), en만 `/en/...`
 *   법정 문서 URL이 ko 기준으로 프리픽스 없이 고정된다.
 * - localeDetection: false (P2-6b · 컨트롤러 결정) — **로케일은 경로만 정한다.** `/` 는 언제나 한국어, `/en` 은 언제나 영어.
 *   예전 기본값(true)에서는 `/en` 을 한 번 방문하면 NEXT_LOCALE 쿠키 때문에 `/` 가 `/en` 으로 리다이렉트됐고(영어 Accept-Language 인
 *   첫 방문도 같다), 헤더에 전환 수단이 없어 한국어로 돌아갈 수 없었다. 언어는 헤더의 전환 링크(LocaleSwitch)로 바꾼다.
 * - localeCookie: false — 감지를 끄면 쿠키는 읽히지 않는다. 읽지 않는 쿠키를 심지 않는다: 처리방침(원장
 *   PRIVACY_POLICY_SECTIONS.cookies)은 브라우저 저장소(localStorage)만 고지하고 있다.
 * tests/header-locale.test.ts §2 가 실제 미들웨어로 "쿠키·Accept-Language 가 있어도 리다이렉트 0 · 쿠키 0" 을 잠근다.
 */
export const routing = defineRouting({
  locales: ["ko", "en"],
  defaultLocale: "ko",
  localePrefix: "as-needed",
  localeDetection: false,
  localeCookie: false,
});

export type Locale = (typeof routing.locales)[number];
