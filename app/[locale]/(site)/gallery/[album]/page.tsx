/**
 * /gallery/[album] — 앨범 상세 (P6-3b). 서버 컴포넌트, 동적 세그먼트 + ISR(revalidate 600, dynamicParams true).
 *
 * generateStaticParams 는 쓰지 않는다 — 사장님이 관리자에서 앨범을 새로 만들면 다음 배포 전까지 404 가 된다.
 * 첫 요청에 렌더해 캐시하고 10분마다 재검증한다.
 *
 * slug 는 `parseAlbumSlug`(lib/queries/albums.ts)가 먼저 거른다. 그 함수가 0008 `gallery_albums_slug_ck` 와
 * 한 쌍이므로 여기서 정규식을 다시 쓰지 않는다 — 두 벌이 되면 언젠가 갈린다.
 * 없는 앨범·비활성 앨범(RLS 가 0행으로 만든다)은 `notFound()` 다. 리다이렉트로 피하지 않는다:
 * 없는 리소스에 404 를 주지 않는 것(soft-404)은 404 의 의미를 바꾸는 제품 결정이고, 같은 사이트 안에서
 * 공지(`/notices/[id]`)와 규칙이 갈리면 안 된다. 이 경로의 404 문서 껍데기는 `docs/ops/known-defects.md` D1 그대로다.
 *
 * 페이지네이션은 `?page=` 다. 공개 URL 이라 누구나 손으로 고치므로 범위 밖 값은 throw 하지 않고 첫 페이지로
 * 정규화한다(`normalizeAlbumPage`). `searchParams` 를 읽으므로 이 라우트만 요청마다 렌더된다 —
 * 조회는 anon + RLS 읽기 전용 두 번뿐이고, 개인정보는 지나가지 않는다.
 * generateMetadata 와 페이지가 같은 요청에서 앨범을 한 번만 조회하도록 React cache 로 감싼다(요청 내 dedupe).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { cache } from "react";

import { GalleryGrid, resolvePictures } from "@/components/home/GalleryGrid";
import { ALBUM_PAGE_SIZE, albumPageOffset, normalizeAlbumPage } from "@/components/pages/albums";
import { menuLabel } from "@/components/pages/menu-label";
import { PageHeader } from "@/components/pages/PageHeader";
import { Link } from "@/i18n/navigation";
import { COMPANY } from "@/lib/legal/disclosures";
import { getAlbumBySlug, getGalleryPage, parseAlbumSlug } from "@/lib/queries";
import { canonicalUrl } from "@/lib/site-url";

import h from "@/components/home/home.module.css";
import p from "@/components/pages/pages.module.css";

/** ISR 주기(초) — 색인·홈과 동일. */
export const revalidate = 600;
/** 빌드 시 알 수 없는 slug 도 요청 시 렌더한다(앨범은 관리자가 늘린다). 없는 slug 는 notFound(). */
export const dynamicParams = true;

type Params = Promise<{ locale: string; album: string }>;
type Query = Promise<Record<string, string | string[] | undefined>>;

/**
 * 같은 요청 안에서 generateMetadata 와 페이지가 조회를 한 번만 하도록 (요청 스코프 dedupe).
 * 형식이 틀린 slug 는 `parseAlbumSlug` 가 여기서 걸러 DB 에 가지 않는다 — 대문자·연속 하이픈·41자·`../` 는
 * 0008 `gallery_albums_slug_ck` 가 어차피 못 담는 값이라 조회할 이유가 없다.
 */
const getAlbumOnce = cache(async (raw: string) => {
  const slug = parseAlbumSlug(raw);
  return slug === null ? null : getAlbumBySlug(slug);
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, album: slug } = await params;
  const [album, t, tList] = await Promise.all([
    getAlbumOnce(slug),
    getTranslations({ locale, namespace: "pages.gallery.detail.meta" }),
    getTranslations({ locale, namespace: "pages.gallery.meta" }),
  ]);
  if (!album) {
    // 404 문서의 제목 — 갤러리 제목으로. 색인 금지.
    // canonical 은 내지 않는다: 색인하지 말라면서 정본을 알려 주는 것은 모순이고, 없는 문서에는 정본이 없다.
    return { title: tList("title", { brand: COMPANY.brandName }), robots: { index: false, follow: false } };
  }
  return {
    title: t("title", { title: album.title, brand: COMPANY.brandName }),
    // 사장님이 적은 설명이 있으면 그것이 이 문서의 요약이다. 없으면 갤러리 공통 문구로 — 지어내지 않는다.
    description: album.description ?? t("description"),
    // 정본은 조회한 행의 slug — 라우트 파라미터(대소문자·유입 쿼리)를 그대로 쓰지 않는다.
    alternates: { canonical: canonicalUrl(`/gallery/${album.slug}`) },
  };
}

export default async function AlbumDetailPage({ params, searchParams }: { params: Params; searchParams: Query }) {
  const [{ locale, album: slug }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);

  const album = await getAlbumOnce(slug);
  if (!album) notFound();

  const page = normalizeAlbumPage(query.page);
  const first = await getGalleryPage({
    albumId: album.id,
    limit: ALBUM_PAGE_SIZE,
    offset: albumPageOffset(page),
  });
  // 데이터 끝을 넘긴 page 는 빈 화면이 아니라 첫 페이지다. 몇 페이지가 있는지는 조회해 봐야 알 수 있으므로
  // (count 쿼리를 쓰지 않는다 — lib/queries/gallery.ts 주석) 빈 결과가 나온 뒤에 한 번 더 읽는다.
  const outOfRange = first.items.length === 0 && page > 1;
  const current = outOfRange ? 1 : page;
  const shown = outOfRange
    ? await getGalleryPage({ albumId: album.id, limit: ALBUM_PAGE_SIZE, offset: 0 })
    : first;

  const [t, tc] = await Promise.all([getTranslations("pages.gallery.detail"), getTranslations("pages.common")]);
  const pictures = resolvePictures(shown.items);
  const prevHref = current > 1 ? `/gallery/${album.slug}?page=${current - 1}` : null;
  const nextHref = shown.hasMore ? `/gallery/${album.slug}?page=${current + 1}` : null;

  return (
    <main className={h.main} data-testid="album-detail-page">
      <PageHeader
        navLabel={tc("breadcrumb")}
        homeLabel={tc("home")}
        crumbs={[{ href: "/gallery", label: menuLabel("gallery") }]}
        current={album.title}
        eyebrow={menuLabel("gallery")}
        title={album.title}
        desc={album.description ?? undefined}
      />

      <section className={`${h.section} ${h.toneLav}`} data-section="album-detail">
        <div className={h.wrap} data-album-slug={album.slug}>
          {pictures.length === 0 ? (
            <div className={p.empty} role="status" data-testid="album-empty">
              <p>{t("empty")}</p>
              <p className={p.emptyAction}>
                <Link className={h.btnGhost} href="/gallery">
                  {t("back")}
                </Link>
              </p>
            </div>
          ) : (
            <>
              <GalleryGrid pictures={pictures} testId="album-gallery-grid" />
              {prevHref !== null || nextHref !== null ? (
                <nav className={p.pager} aria-label={t("pager.label")} data-testid="album-pager">
                  {prevHref === null ? null : (
                    <Link className={h.btnGhost} href={prevHref} rel="prev">
                      {t("pager.prev")}
                    </Link>
                  )}
                  <p className={p.pagerLabel}>{t("pager.page", { page: current })}</p>
                  {nextHref === null ? null : (
                    <Link className={h.btnGhost} href={nextHref} rel="next">
                      {t("pager.next")}
                    </Link>
                  )}
                </nav>
              ) : null}
              <p className={p.emptyAction}>
                <Link className={h.btnGhost} href="/gallery">
                  {t("back")}
                </Link>
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
