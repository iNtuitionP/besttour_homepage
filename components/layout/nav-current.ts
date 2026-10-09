/**
 * 메뉴 "현재 위치" 판정 (P7-4 · 브리프 §6) — 헤더 · 모바일 패널 · 푸터의 Nav 가 이 함수 하나로 정한다.
 *
 * 규칙
 *   1. 해시가 있는 항목(`/about#location` · `/#quote`)은 **현재가 아니다** — 같은 페이지 안의 구역이라 페이지 자체를 가리키는 항목과
 *      둘 다 켜지면 "어디에 있는지" 가 흐려진다(UIUX 감사: /about 에서 '회사소개·인사말' 과 '찾아오시는 길' 이 둘 다 켜졌다).
 *   2. 경로가 같으면 `"page"`(aria-current="page").
 *   3. 하위 페이지(`/notices/12` · `/gallery/<앨범>`)에서는 상위 메뉴(`/notices` · `/gallery`)가 `"true"` — 지금 페이지 그 자체는 아니지만
 *      그 묶음 안에 있다는 표시다(WAI-ARIA: aria-current="true"). 화면 강조는 같다. 경로 조각 단위로만 본다(`/noticesx` 는 아니다).
 *
 * `pathname` 은 next-intl usePathname 의 값(로케일 접두사를 뗀 경로)이다. 순수 함수 — React·Next 없음(tests/uiux-polish.test.ts §6).
 */
export function navCurrent(pathname: string, href: string): "page" | "true" | undefined {
  if (href.includes("#")) return undefined;
  if (pathname === href) return "page";
  if (href !== "/" && pathname.startsWith(`${href}/`)) return "true";
  return undefined;
}
