import type { MetadataRoute } from "next";

import { siteOrigin } from "@/lib/site-url";

/**
 * /robots.txt (P7-2). 옛 사이트는 robots.txt·sitemap.xml 이 둘 다 404 였다.
 *
 * 운영(`VERCEL_ENV === "production"`)만 색인을 허용한다. 프리뷰·개발 배포는 전면 disallow —
 * ADR-10: 운영 DB 가 아닌 환경이 색인되면 안 된다(프리뷰 URL 이 검색결과에 뜨고, 접수 폼이
 * 크롤러에 노출되고, 중복 콘텐츠로 운영 도메인이 손해를 본다).
 *
 * `/admin` 만 disallow 한다. `/quote/done` 과 `/notices/[id]` 는 페이지 자체가
 * `robots: { index: false }` 메타를 내므로 여기서 막지 않는다 — robots.txt 로 크롤을 막으면
 * 크롤러가 그 noindex 메타를 읽지 못한다.
 *
 * 비운영에서는 sitemap 을 알리지 않는다. 색인하지 말라고 하면서 색인 목록을 주지 않는다.
 */
export default function robots(): MetadataRoute.Robots {
  if (process.env.VERCEL_ENV !== "production") {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
    };
  }

  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin"] }],
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
