/**
 * 공유 미리보기 메타(Open Graph · Twitter) — 사이트 단위 값만 (P7-4 · 브리프 §12).
 *
 * 로케일 레이아웃(app/[locale]/layout.tsx)의 generateMetadata 가 이 결과를 펼친다. 여기서 정하는 것은
 *   - og:type website · og:site_name(ko "베스트투어" / en "Bestour" — 카탈로그 common.siteName)
 *   - og:locale ko_KR / en_US 와 대안 로케일(서로)
 *   - og:image · twitter:image = `/og.png`(app/og.png/route.tsx — 빌드 때 한 번 만드는 1200×630 PNG) · alt = 사이트 이름
 *   - twitter:card summary_large_image
 * 뿐이다. **제목·설명은 넣지 않는다** — Next 가 openGraph·twitter 에 제목·설명이 없으면 그 페이지의 title·description 을 물려준다
 * (next/dist/lib/metadata/resolve-metadata.js inheritFromMetadata · postProcessMetadata). 그래서 페이지별 메타가 그대로 공유 문구가 된다
 * (지금 openGraph 를 직접 쓰는 페이지는 없다 — 쓰면 이 객체를 통째로 덮으니 그때는 이 함수를 펼쳐 합칠 것).
 *
 * 이미지를 파일 규약(app/[locale]/opengraph-image.tsx)으로 두지 않는 이유: 기본 로케일(ko)의 이미지 주소가 `/ko/opengraph-image/…` 가
 * 되어 next-intl(as-needed)이 307 로 `/opengraph-image/…?hash=` 로 돌린다(실측 — 쿼리까지 바뀐다). 리다이렉트를 따라가지 않는 크롤러는
 * 미리보기를 비운다. 점이 든 주소는 미들웨어 matcher(`.*\..*` 제외) 밖이라 두 로케일 모두 바로 200 이다. 이미지에 글자가 없어 로케일 차이가 없다.
 * canonical·hreflang 은 여기 없다 — 페이지가 자기 것을 낸다(lib/site-url.ts pageAlternates).
 */
import type { Metadata } from "next";

/** next-intl 로케일 → Open Graph 로케일. 모르는 로케일은 기본 로케일(ko)로 본다. */
const OG_LOCALE: Readonly<Record<string, string>> = { ko: "ko_KR", en: "en_US" };

/** 공유 이미지 크기 — 이 값 하나를 메타(width·height)와 이미지 라우트(app/og.png/route.tsx)가 같이 쓴다. */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
/** 공유 이미지 주소 — 미들웨어 matcher 밖(점 포함) · 로케일 공용. */
export const OG_IMAGE_PATH = "/og.png";

export function shareMetadata(locale: string, siteName: string): Pick<Metadata, "openGraph" | "twitter"> {
  const og = OG_LOCALE[locale] ?? OG_LOCALE.ko;
  return {
    openGraph: {
      type: "website",
      siteName,
      locale: og,
      alternateLocale: Object.values(OG_LOCALE).filter((l) => l !== og),
      images: [{ url: OG_IMAGE_PATH, ...OG_IMAGE_SIZE, type: "image/png", alt: siteName }],
    },
    twitter: { card: "summary_large_image", images: [{ url: OG_IMAGE_PATH, alt: siteName }] },
  };
}
