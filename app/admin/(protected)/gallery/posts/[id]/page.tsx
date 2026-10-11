import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AlbumPostForm } from "@/components/admin/AlbumPostForm";
import { getAlbumPostFormLabels } from "@/components/admin/albumPostFormLabels";
import { routing } from "@/i18n/routing";
import { ADMIN_GALLERY_PATH, getAdminAlbum } from "@/lib/admin/gallery";
import { requireAdmin } from "@/lib/auth/requireAdmin";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/gallery/posts/[id] — 글 고치기·지우기 (OWNER-FEEDBACK T4-2 · 0025). 본문 첫 문장 requireAdmin()(scripts/check-admin-gate).
 * 공개 주소(/gallery/<slug>)를 읽기 전용으로 보여 준다 — 고쳐도 바뀌지 않는다(0025 admin_update_album 은 slug 를 받지 않는다).
 * 이 글의 사진은 갤러리 화면의 글 필터(`?album=<id>`)에서 보고 올린다.
 */
type Params = Promise<{ id: string }>;

export default async function AdminGalleryPostEditPage({ params }: { params: Params }) {
  await requireAdmin();

  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.gallery" });
  const { id } = await params;
  const albumId = /^[1-9]\d{0,9}$/.test(id) ? Number(id) : null;
  const row = albumId === null ? null : await getAdminAlbum(albumId);

  if (row === null) {
    return (
      <main className={q.main} data-testid="admin-album-edit">
        <div className={q.wrap}>
          <Link className={a.backLink} href={ADMIN_GALLERY_PATH}>
            {t("albumBack")}
          </Link>
          <p className={a.empty}>{t("albumNotFound")}</p>
        </div>
      </main>
    );
  }

  const labels = await getAlbumPostFormLabels();

  return (
    <main className={q.main} data-testid="admin-album-edit">
      <div className={q.wrap}>
        <Link className={a.backLink} href={ADMIN_GALLERY_PATH}>
          {t("albumBack")}
        </Link>
        <header className={q.pageHead}>
          <h1 className={q.title}>{t("albumEdit")}</h1>
          <p className={q.sub} data-testid="admin-album-address">
            {t("albumAddress", { path: `/gallery/${row.slug}` })}
          </p>
        </header>
        <section className={a.section}>
          <Link className={a.rowLink} href={`${ADMIN_GALLERY_PATH}?album=${row.id}`} data-testid="admin-album-photos">
            {t("albumPhotos")}
          </Link>
        </section>
        <section className={a.section} aria-label={t("albumEdit")}>
          <AlbumPostForm
            mode="edit"
            id={row.id}
            initial={{ title: row.title, body: row.body ?? "", publishedAt: row.published_at, active: row.active }}
            labels={labels}
            listHref={ADMIN_GALLERY_PATH}
          />
        </section>
      </div>
    </main>
  );
}
