import { defineRouting } from "next-intl/routing";

/**
 * 라우트 URL 골격 — 한 번 발송된 문자 본문의 링크를 죽이지 않기 위해 먼저 굳힌다.
 *
 * - locales: ko(기본), en
 * - localePrefix: "as-needed" → ko는 프리픽스 없음(`/`, `/guide`), en만 `/en/...`
 *   법정 문서 URL이 ko 기준으로 프리픽스 없이 고정된다.
 */
export const routing = defineRouting({
  locales: ["ko", "en"],
  defaultLocale: "ko",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
