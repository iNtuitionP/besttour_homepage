import type { MetadataRoute } from "next";

import { routing } from "@/i18n/routing";
import { pageAlternates } from "@/lib/site-url";

/**
 * /sitemap.xml (P7-2 · P2-6) — **정적 공개 라우트만** 손으로 적는다. 로케일마다 한 줄씩(ko·en).
 *
 * 왜 DB 를 읽지 않는가
 *   공지 상세(`/notices/[id]`)·갤러리 상세를 넣으려면 빌드/요청 때 DB 를 읽어야 한다. 빌드가 DB 에
 *   의존하는 경로를 늘리지 않는다(홈 ISR 하나로 충분하다) — DB 가 잠깐 죽으면 sitemap 이 비거나
 *   빌드가 깨진다. 공지 상세는 목록 페이지에서 링크로 도달한다.
 *
 * 왜 파일시스템을 훑지 않고 손으로 적는가
 *   런타임에 `app/**` 을 뒤지는 코드는 번들 이후 동작을 보장할 수 없다. 대신
 *   `tests/redirects.test.ts` 가 이 배열을 **파일시스템의 page.tsx 집합과 1:1 로 대조**한다 —
 *   페이지를 만들고 여기에 안 넣으면 테스트가 빨간불이 된다.
 *
 * 로케일 (P2-6)
 *   `messages/en.json` 이 채워져 `/en/*` 이 독립 문서가 됐다(예전에는 같은 한국어를 렌더해 일부러 뺐다).
 *   URL·언어 대안은 페이지 메타데이터와 같은 헬퍼(`pageAlternates`)에서 나온다 — 페이지의 hreflang 과 여기가 갈라질 수 없다.
 *
 * 제외
 *   - `/quote/done`(접수 완료 화면, 페이지가 noindex) · `/notices/[id]`(동적 세그먼트) · `/admin`(로케일 밖·인증 영역)
 *
 * `lastModified` 는 넣지 않는다. 빌드 시각을 넣으면 배포마다 전 URL 의 갱신일이 바뀌어
 * 검색엔진에 거짓 신호를 준다(무의미한 노이즈). 실제 갱신일을 아는 경로가 생기면 그때 넣는다.
 */
const STATIC_ROUTES = [
  "/",
  "/about",
  "/fleet",
  "/fares",
  "/quote",
  "/reservation/check",
  "/notices",
  "/gallery",
  "/guide",
  "/terms",
  "/privacy",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return STATIC_ROUTES.flatMap((route) =>
    routing.locales.map((locale) => {
      const { canonical, languages } = pageAlternates(route, locale);
      return { url: canonical, alternates: { languages } };
    }),
  );
}
