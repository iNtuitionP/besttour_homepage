import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { loadMessages } from "./messages";
import { routing } from "./routing";

/**
 * 요청 단위 i18n 설정.
 * - 지원하지 않는 로케일은 defaultLocale(ko)로 폴백한다.
 * - 메시지 병합(폴백) 순서는 i18n/messages.ts의 loadMessages 주석 참고: { ...ko, ...요청 로케일 }
 * - timeZone은 Asia/Seoul 고정 — 운행 일시는 KST 벽시계로 다룬다(CLAUDE.md §3).
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: loadMessages(locale),
    timeZone: "Asia/Seoul",
  };
});
