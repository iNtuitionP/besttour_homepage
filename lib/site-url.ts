/**
 * 사이트 원점(origin) 단일 출처 — robots·sitemap·canonical 이 같은 값을 쓰게 한다 (P7-2 · P7-2b).
 *
 * 왜 상수가 아니라 함수인가
 *   `NEXT_PUBLIC_SITE_URL` 은 환경마다 다르다(프리뷰 배포 URL / 운영 도메인). 모듈 로드 시점에
 *   고정하면 테스트가 환경을 바꿔도 반영되지 않고, 프리뷰에서 운영 URL 이 박힌 sitemap 이 나간다.
 *   호출 시점에 읽는다.
 *
 * 정규화 규칙
 *   - 끝 슬래시를 뗀다 — 호출부가 `${origin}/sitemap.xml` 처럼 붙여 쓰므로 `//` 가 생기면 안 된다.
 *   - `http(s)://` 로 시작하지 않는 값(공란 포함)은 무시하고 운영 도메인으로 폴백한다.
 *     env 를 반쯤 채운 배포에서 상대 URL 이 sitemap 에 들어가는 것보다 운영 도메인이 낫다.
 */
import type { Metadata } from "next";

import { routing } from "@/i18n/routing";

export const FALLBACK_SITE_ORIGIN = "https://bestour.co.kr";

export function siteOrigin(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  const candidate = /^https?:\/\/[^\s/]+/.test(raw) ? raw : FALLBACK_SITE_ORIGIN;
  return candidate.replace(/\/+$/, "");
}

/**
 * 로케일 prefix — `i18n/routing.ts` 의 `localePrefix: "as-needed"` 라 ko 는 prefix 가 없고 en 만 `/en/...` 이다.
 * 세그먼트 경계까지 봐야 한다(`/english` 를 `/glish` 로 깎으면 안 된다).
 */
const LOCALE_PREFIX = /^\/(?:ko|en)(?=\/|$)/;

/**
 * 정본(canonical) URL 을 만든다 (P7-2b).
 *
 * 왜 필요한가
 *   옛 사이트 URL 의 301 목적지에는 **옛 쿼리가 그대로 따라온다** — `/page/page.php?bo_page=greeting` 으로
 *   들어온 방문자는 `/about?bo_page=greeting` 에 머문다(Next `redirects()` 로는 뗄 수 없다, P7-1-2-report §7-3).
 *   검색엔진에는 `/about` 과 별개 URL 로 보인다. canonical 이 "정본은 `/about` 이다"라고 알려 준다.
 *
 * 규칙
 *   - **쿼리·해시를 뗀다.** 어떤 경우에도 canonical 에 들어가지 않는다.
 *   - **로케일 prefix 를 뗀다** — 이 함수가 돌려주는 것은 언제나 **한국어(기본 로케일) 경로**의 URL 이다.
 *     P2-6 에서 `messages/en.json` 에 실제 번역이 들어가 `/en/*` 이 독립 문서가 됐다 — 여기 적어 두었던 뒤집기 조건이 왔다.
 *     그래서 페이지는 이 함수를 직접 쓰지 않고 아래 `pageAlternates(pathname, locale)` 를 쓴다:
 *     ① 각 로케일이 자기 URL 을 canonical 로 내고 ② `alternates.languages`(hreflang)를 ko/en/x-default 로 선언하며
 *     ③ `app/sitemap.ts` 가 `/en/*` 을 포함한다 — 셋이 같은 헬퍼에서 나온다(tests/canonical.test.ts).
 *   - 끝 슬래시를 정규화한다(홈만 `/`). sitemap 의 표기와 문자 그대로 같아야 한다 — `tests/canonical.test.ts` 가 대조한다.
 *     단 **렌더 결과의 홈만 다르다**: Next 는 경로가 `/` 뿐인 canonical 을 origin 형태로 줄여 낸다
 *     (`resolve-url.js`: `result.pathname === '/' ? result.origin : result.href`) — 실측 `https://bestour.co.kr`.
 *     `https://bestour.co.kr/` 와 같은 URI 다(RFC 3986 §6.2.3). 이 함수는 sitemap 과 맞춰 `/` 를 붙인 값을 돌려준다.
 *
 * 왜 문자열을 돌려주는가(URL 인스턴스가 아니라)
 *   Next 의 메타데이터 해석기는 `alternates.canonical` 이 **URL 인스턴스면 그것을 base 로 보고 현재 요청의
 *   pathname 을 다시 붙이고 searchParams 를 복사한다**
 *   (`node_modules/next/dist/lib/metadata/resolvers/resolve-basics.js` 의 `resolveAlternateUrl`).
 *   즉 URL 인스턴스로 넘기면 이 태스크가 없애려는 바로 그 쿼리가 되살아난다. 완성된 절대 URL **문자열**은
 *   `resolveUrl()` 이 `new URL(url)` 로 파싱해 그대로 돌려주므로 요청과 무관하다.
 */
export function canonicalUrl(pathname: string): string {
  const withoutQuery = pathname.split("#")[0].split("?")[0];
  const rooted = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  const collapsed = rooted.replace(/\/{2,}/g, "/");
  const unlocalized = collapsed.replace(LOCALE_PREFIX, "");
  const trimmed = unlocalized.replace(/\/+$/, "");
  return `${siteOrigin()}${trimmed === "" ? "/" : trimmed}`;
}

/**
 * 로케일의 정본 URL (P2-6). `i18n/routing.ts` 의 `localePrefix: "as-needed"` 그대로 — 기본 로케일(ko)은 prefix 없음,
 * 그 밖의 로케일은 `/<locale>` 을 붙인다. 입력의 쿼리·해시·기존 로케일 prefix 는 canonicalUrl 이 먼저 뗀다.
 *   localizedUrl("/about", "en") → https://bestour.co.kr/en/about
 *   localizedUrl("/", "en")      → https://bestour.co.kr/en        (영문 홈 — 끝 슬래시 없음, Next trailingSlash 기본값)
 *   localizedUrl("/", "ko")      → https://bestour.co.kr/          (canonicalUrl 과 같다 — sitemap 관례)
 */
export function localizedUrl(pathname: string, locale: string): string {
  const base = canonicalUrl(pathname);
  if (locale === routing.defaultLocale) return base;
  const origin = siteOrigin();
  const rest = base.slice(origin.length);
  return `${origin}/${locale}${rest === "/" ? "" : rest}`;
}

/**
 * 페이지 메타데이터 `alternates` 값 (P2-6) — canonical 은 요청 로케일의 URL, languages 는 모든 로케일 + x-default(기본 로케일).
 * 전부 **문자열**이다(URL 인스턴스를 넘기면 Next 가 요청 경로·쿼리를 다시 붙인다 — 위 canonicalUrl 주석).
 * sitemap 도 같은 languages 를 싣는다 — 페이지의 hreflang 과 sitemap 의 대안이 갈라질 수 없다.
 */
export function pageAlternates(
  pathname: string,
  locale: string,
): { canonical: string; languages: Record<string, string> } {
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[l] = localizedUrl(pathname, l);
  languages["x-default"] = localizedUrl(pathname, routing.defaultLocale);
  return { canonical: localizedUrl(pathname, locale), languages };
}

/**
 * 검색엔진 소유확인 메타 (P7-2b) — 네이버 서치어드바이저 · 구글 서치콘솔.
 *
 * 값은 사장님이 각 콘솔에서 발급받아 env 에 넣는다. 우리는 자리만 만든다 — **지어내지 않는다.**
 * 값이 없으면 `undefined` 를 돌려주고 호출부가 `verification` 키 자체를 넣지 않는다:
 * 빈 `content=""` 태그는 콘솔이 "확인 실패" 로 읽는다(태그가 아예 없는 것보다 나쁘다).
 * 값이 없는 것은 **정상 상태**이므로 임시값 마커를 붙이지 않는다(허용목록만 늘어난다 — 브리프 §설계 결정).
 *
 * 네이버는 Next 의 전용 필드가 없어 `other` 로 `<meta name="naver-site-verification">` 를 낸다.
 */
export function siteVerification(): NonNullable<Metadata["verification"]> | undefined {
  const google = (process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ?? "").trim();
  const naver = (process.env.NEXT_PUBLIC_NAVER_SITE_VERIFICATION ?? "").trim();
  if (google === "" && naver === "") return undefined;
  return {
    ...(google === "" ? {} : { google }),
    ...(naver === "" ? {} : { other: { "naver-site-verification": naver } }),
  };
}
