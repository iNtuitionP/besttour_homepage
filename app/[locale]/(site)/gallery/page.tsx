/**
 * /gallery — 갤러리 (P6-3, 앨범 색인은 P6-3b). 서버 컴포넌트, SSG + ISR(revalidate 600 — admin 이 사진을 바꾸면 10분 안에 반영).
 *
 * 두 층이다.
 *   (1) 앨범 색인 — getAlbums() 가 활성 앨범을 sort 순으로 준다. 표지는 그 앨범의 첫 사진 한 장
 *       (getGalleryPage({ albumId, limit: 1 }))이고, 사진이 없는 앨범도 카드를 남긴다(감추면 사장님이 원인을 못 찾는다).
 *   (2) 전체 사진 — 기존 평면 그리드 그대로. getGallery(60), 홈 GallerySection 과 같은 GalleryGrid 카드.
 *
 * **앨범이 0개면 (1)과 "전체 사진" 머리를 아예 렌더하지 않는다** — 원격 gallery_albums 가 지금 0행이고,
 * 그 상태의 화면은 P6-3 이 만든 것에서 한 글자도 달라지지 않아야 한다(tests/gallery-albums-public.test.ts §1).
 * 0건이면 "준비 중" 문구 + 홈 링크. anon + RLS 읽기 전용 · 요청 시점 API 0.
 */
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { GalleryGrid, resolvePictures } from "@/components/home/GalleryGrid";
import { RICH } from "@/components/home/rich";
import { AlbumCards } from "@/components/pages/AlbumCards";
import { buildAlbumCards } from "@/components/pages/albums";
import { PageHeader } from "@/components/pages/PageHeader";
import { Link } from "@/i18n/navigation";
import { ledgerUi } from "@/lib/i18n/ledger-ui";
import { getAlbums, getGallery, getGalleryPage } from "@/lib/queries";
import { pageAlternates } from "@/lib/site-url";

import h from "@/components/home/home.module.css";
import p from "@/components/pages/pages.module.css";

/** ISR 주기(초) — 홈과 동일. */
export const revalidate = 600;

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.gallery.meta" });
  return {
    title: t("title", { brand: ledgerUi(locale).brand }),
    description: t("description"),
    // 옛 게시판(`?bo_table=thema1`)의 301 목적지 — 정본은 쿼리 없는 `/gallery`(en `/en/gallery`).
    alternates: pageAlternates("/gallery", locale),
  };
}

export default async function GalleryPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // 평면 그리드 상한 60 — 앨범을 나눠 담아도 "전체 사진"은 그대로 남는다(앨범에 넣지 않은 사진이 사라지면 안 된다).
  const [items, albums, t, tc, tGallery, tErrors, tMenu] = await Promise.all([
    getGallery(60),
    getAlbums(),
    getTranslations("pages.gallery"),
    getTranslations("pages.common"),
    getTranslations("home.gallery"),
    getTranslations("errors"),
    getTranslations("layout.menu"),
  ]);
  const pictures = resolvePictures(items);

  // 표지 = 앨범별 첫 사진 한 장. 앨범 수만큼 조회가 늘지만(사장님이 만드는 만큼이라 한 자릿수) 정확하다 —
  // 전체 60장에서 골라내면 정렬상 뒤로 밀린 앨범이 "사진 없음"으로 잘못 보인다. ISR 이라 10분에 한 번이다.
  const covers = await Promise.all(albums.map((a) => getGalleryPage({ albumId: a.id, limit: 1 })));
  const cards = buildAlbumCards(albums, covers.map((c) => c.items));

  return (
    <main className={h.main} data-testid="gallery-page">
      <PageHeader
        navLabel={tc("breadcrumb")}
        homeLabel={tc("home")}
        current={tMenu("gallery")}
        eyebrow={tMenu("gallery")}
        title={tGallery.rich("title", RICH)}
      />

      {albums.length > 0 ? (
        <section className={`${h.section} ${h.toneWhite}`} data-section="gallery-albums">
          <div className={h.wrap}>
            <div className={h.head}>
              <h2 className={h.title}>{t("albumsTitle")}</h2>
            </div>
            <AlbumCards albums={cards} label={t("albumsLabel")} pendingLabel={t("albumPending")} />
          </div>
        </section>
      ) : null}

      <section className={`${h.section} ${h.toneLav}`} data-section="gallery">
        <div className={h.wrap}>
          {albums.length > 0 ? (
            <div className={h.head}>
              <h2 className={h.title}>{t("allTitle")}</h2>
            </div>
          ) : null}
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
