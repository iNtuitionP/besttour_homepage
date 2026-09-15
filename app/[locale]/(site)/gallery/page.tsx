/**
 * /gallery — 갤러리 (P6-3). 서버 컴포넌트, SSG + ISR(revalidate 600 — admin 이 사진을 바꾸면 10분 안에 반영).
 *
 * getGallery(60): 활성 사진을 sort 순으로, 평면 그리드(앨범 P6-1·P6-2 는 아직 없다). 카드는 홈 GallerySection 과 같은 GalleryGrid
 * (next/image · resolveImageUrl · next.config.ts remotePatterns — Supabase Storage 공개 객체). alt 는 gallery.caption(없으면 빈 alt).
 * 0건이면 "준비 중" 문구 + 홈 링크 — 원격 gallery 가 지금 0행이라 이 상태가 정답이다. anon + RLS 읽기 전용 · 요청 시점 API 0.
 */
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { GalleryGrid, resolvePictures } from "@/components/home/GalleryGrid";
import { RICH } from "@/components/home/rich";
import { menuLabel } from "@/components/pages/menu-label";
import { PageHeader } from "@/components/pages/PageHeader";
import { Link } from "@/i18n/navigation";
import { COMPANY } from "@/lib/legal/disclosures";
import { getGallery } from "@/lib/queries";
import { canonicalUrl } from "@/lib/site-url";

import h from "@/components/home/home.module.css";
import p from "@/components/pages/pages.module.css";

/** ISR 주기(초) — 홈과 동일. */
export const revalidate = 600;

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.gallery.meta" });
  return {
    title: t("title", { brand: COMPANY.brandName }),
    description: t("description"),
    // 옛 게시판(`?bo_table=thema1`)의 301 목적지 — 정본은 쿼리 없는 `/gallery`.
    alternates: { canonical: canonicalUrl("/gallery") },
  };
}

export default async function GalleryPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // 평면 그리드 상한 60 — 앨범(P6-1·P6-2)이 생기면 앨범 단위로 나눈다.
  const [items, t, tc, tGallery, tErrors] = await Promise.all([
    getGallery(60),
    getTranslations("pages.gallery"),
    getTranslations("pages.common"),
    getTranslations("home.gallery"),
    getTranslations("errors"),
  ]);
  const pictures = resolvePictures(items);

  return (
    <main className={h.main} data-testid="gallery-page">
      <PageHeader
        navLabel={tc("breadcrumb")}
        homeLabel={tc("home")}
        current={menuLabel("gallery")}
        eyebrow={menuLabel("gallery")}
        title={tGallery.rich("title", RICH)}
      />

      <section className={`${h.section} ${h.toneLav}`} data-section="gallery">
        <div className={h.wrap}>
          {pictures.length === 0 ? (
            <div className={p.empty} role="status" data-testid="gallery-empty">
              <p>{t("empty")}</p>
              <p className={p.emptyAction}>
                <Link className={h.btnGhost} href="/">
                  {tErrors("home")}
                </Link>
              </p>
            </div>
          ) : (
            <GalleryGrid pictures={pictures} />
          )}
        </div>
      </section>
    </main>
  );
}
