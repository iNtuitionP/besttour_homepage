/**
 * 관리자 쓰기 → **공개 화면 즉시 반영** (플랜 v4 P5-5·P5-6 후속, 2026-09-15 실측).
 *
 * 문제: 공개 화면은 전부 SSG + ISR(`export const revalidate = 600`)이다 —
 * 홈(`app/[locale]/(site)/page.tsx`) · `/fares` · `/notices`. 사장님이 오타를 고쳐도 방문자는 최대 10분 동안
 * 옛 글을 본다. "저장이 안 됐나?" 하고 다섯 번 더 누르게 만드는 종류의 지연이다.
 *
 * **태그는 이 문제를 풀지 못한다.** `revalidateTag` 는 Data Cache 를 지운다. 그런데 이 화면들의 읽기는
 * `fetch()` 도 `unstable_cache` 도 아닌 supabase-js 직접 호출이라 Data Cache 항목 자체가 없다 —
 * 지울 것이 없으니 태그를 아무리 불러도 Full Route Cache(정적 HTML)는 그대로다.
 * 그래서 남는 수단은 `revalidatePath` 하나뿐이다.
 *
 * **그런데 경로를 어떻게 적느냐가 전부다.** next-intl 의 `localePrefix: "as-needed"` 아래에서
 * 실제 캐시 항목은 `/ko/notices`·`/en/notices` 이고 라우트 파일은 `app/[locale]/(site)/notices/page.tsx` 다.
 * Next 15.5.24 + next-intl 로 라우트 모양을 그대로 재현한 프로브(`next build` → `next start`)에서 실측한 결과:
 *
 *   revalidatePath("/[locale]/notices", "page")   → 아무 일도 없음 (스탬프 불변)
 *   revalidatePath("/notices",          "page")   → 아무 일도 없음
 *   revalidatePath("/ko/notices",       "page")   → 아무 일도 없음
 *   revalidatePath("/[locale]/notices", "layout") → 아무 일도 없음
 *   revalidatePath("/notices",          "layout") → 아무 일도 없음
 *   revalidatePath("/[locale]",         "page")   → 아무 일도 없음
 *   revalidatePath("/[locale]",         "layout") → 네 화면 전부 재생성 ✅
 *   revalidatePath("/",                 "layout") → 네 화면 전부 재생성 ✅  ← 이것을 쓴다
 *
 * `after()` 안에서 불러도(= 저장소의 `runAfter`) 동일하게 동작하는 것까지 확인했다.
 * **경로별 정밀 무효화는 조용히 실패한다** — 되는 것처럼 보이고 되지 않는 호출을 남기지 않기 위해 루트 형태를 쓴다.
 *
 * 대가: 관리자가 한 번 저장할 때마다 공개 페이지 전체(법정 문서 포함)의 캐시가 함께 비워지고, 다음 방문자 한 명이
 * 재생성 비용을 문다. 사장님의 저장 빈도(주 몇 번)와 페이지 수(십여 장)를 생각하면 무시할 수 있는 비용이고,
 * "정확하지만 가끔 느린 것" 이 "빠르지만 10분 동안 틀린 것" 보다 낫다.
 *
 * 범위 밖이지만 알아 둘 것: `/notices/[id]` 상세는 `generateStaticParams` 가 없어 **애초에 캐시되지 않는다**
 * (실측 응답 헤더 `Cache-Control: private, no-cache, no-store`). 즉 상세는 언제나 최신이고, 그 파일의
 * `export const revalidate = 600` 은 현재 아무 효과가 없다(P6-3 소유 — 이 태스크는 건드리지 않았다).
 */

/** `revalidatePath` 의 첫 인자. 루트 하나로 공개 화면 전체를 덮는다(위 실측 표). */
export const PUBLIC_CACHE_PATH = "/";

/**
 * `revalidatePath` 의 둘째 인자. **"page" 로 바꾸면 조용히 아무 일도 하지 않는다** —
 * 로케일 세그먼트 아래의 항목까지 닿으려면 "layout" 이어야 한다(위 실측 표).
 */
export const PUBLIC_CACHE_SCOPE = "layout" as const;
