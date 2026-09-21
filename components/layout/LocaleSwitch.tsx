"use client";

/**
 * 언어 전환 링크 (P2-6b) — 한국어 화면에는 "English", 영문 화면에는 "한국어". **같은 경로의 다른 로케일**로 간다.
 *
 * 클라이언트인 이유는 하나뿐이다 — 현재 경로를 알아야 한다(usePathname). 헤더는 레이아웃이라 서버에서 경로를 모른다.
 * `usePathname` 은 로케일 접두사를 뗀 경로(`/en/fleet` → `/fleet`)를 주고, `getPathname` 이 as-needed 규칙대로 대상 로케일의
 * 경로를 만든다(`/fleet` ↔ `/en/fleet`, `/` ↔ `/en`). 쿼리·해시는 따라가지 않는다(위저드 단계·앨범 페이지는 첫 화면부터).
 *
 * 왜 next-intl `<Link locale=…>` 가 아닌가: 그 Link 는 locale 을 주면 **접두사를 강제**한다(createSharedNavigationFns forcePrefix) —
 * 영문 화면의 "한국어" 가 `/ko/fleet` 이 되고, 미들웨어가 `/fleet` 으로 한 번 더 리다이렉트한다. 그 강제는 로케일 쿠키를 갱신하려는
 * 장치인데 이 사이트는 쿠키를 쓰지 않는다(i18n/routing.ts localeCookie:false). 그래서 정본 경로를 직접 만들어 일반 링크로 건다 —
 * 언어가 바뀌면 `<html lang>` 까지 새로 그려야 하므로 전체 이동이 맞다.
 *
 * 글자는 가려는 언어의 자기 이름(lib/i18n/locale-names.ts) — `lang`·`hrefLang` 으로 그 언어를 표시한다.
 * 원장 import 없음 · 한글 리터럴 없음(tests/layout.test.ts §6 · tests/header-locale.test.ts §3).
 * 렌더 실측(EN_BASE_URL)은 tests/i18n-en.test.ts §8-b 가 화면마다(ko·en 각 4곳) href·hreflang·lang 을 대조한다.
 */
import { useLocale } from "next-intl";

import { getPathname, usePathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { LOCALE_NAMES } from "@/lib/i18n/locale-names";

export default function LocaleSwitch({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const current = useLocale();
  const pathname = usePathname();
  const target: Locale = routing.locales.find((l) => l !== current) ?? routing.defaultLocale;
  const href = getPathname({ href: pathname, locale: target });

  return (
    <a className={className} href={href} hrefLang={target} lang={target} onClick={onNavigate} data-locale-switch="">
      {LOCALE_NAMES[target]}
    </a>
  );
}
