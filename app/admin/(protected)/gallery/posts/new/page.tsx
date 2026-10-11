import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AlbumPostForm } from "@/components/admin/AlbumPostForm";
import { getAlbumPostFormLabels } from "@/components/admin/albumPostFormLabels";
import { routing } from "@/i18n/routing";
import { ADMIN_GALLERY_PATH } from "@/lib/admin/gallery";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { toKstDateString } from "@/lib/kst";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/gallery/posts/new — 새 글 쓰기 (OWNER-FEEDBACK T4-2 · 0025). 본문 첫 문장 requireAdmin()(scripts/check-admin-gate).
 * 날짜는 오늘(KST)로 채운다. 주소(slug)는 DB 가 짓는다 — 입력란이 없다. 저장하면 갤러리 화면으로 돌아간다(사진을 올릴 곳).
 */
export default async function AdminGalleryPostNewPage() {
  await requireAdmin();

  const [t, labels] = await Promise.all([getTranslations({ locale: routing.defaultLocale, namespace: "admin.gallery" }), getAlbumPostFormLabels()]);

  return (
    <main className={q.main} data-testid="admin-album-new-page">
      <div className={q.wrap}>
        <Link className={a.backLink} href={ADMIN_GALLERY_PATH}>
          {t("albumBack")}
        </Link>
        <header className={q.pageHead}>
          <h1 className={q.title}>{t("albumNewTitle")}</h1>
          <p className={q.sub}>{t("albumLead")}</p>
        </header>
        <section className={a.section} aria-label={t("albumNewTitle")}>
          <AlbumPostForm
            mode="create"
            initial={{ title: "", body: "", publishedAt: toKstDateString(new Date()), active: true }}
            labels={labels}
            listHref={ADMIN_GALLERY_PATH}
          />
        </section>
      </div>
    </main>
  );
}
