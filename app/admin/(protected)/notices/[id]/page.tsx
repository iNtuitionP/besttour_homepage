import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { getCopyWarningLabels } from "@/components/admin/copyWarningLabels";
import { NoticeForm } from "@/components/admin/NoticeForm";
import { routing } from "@/i18n/routing";
import { NOTICE_CATEGORIES, parseAdminNoticeId } from "@/lib/admin/noticeInput";
import { ADMIN_NOTICES_PATH, getAdminNotice } from "@/lib/admin/notices";
import { requireAdmin } from "@/lib/auth/requireAdmin";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/notices/[id] — 공지 수정 · 삭제 (P5-5).
 *
 * 목록과 같은 이유로 여기서도 **본문 첫 문장이** requireAdmin() 이다(조건·try 금지 — scripts/check-admin-gate.mjs).
 * 경로의 id 가 양의 정수가 아니면 DB 를 부르지 않고 "찾을 수 없음" 으로 끝낸다.
 *
 * 이 화면에만 삭제가 있고, 삭제는 두 단계다(무장 체크 → 다시 묻기). 공개 상세 URL(/notices/{id})이 문자로 나갔을 수 있어
 * **감추는 쪽이 먼저**다 — 노출을 끄면 같은 id 로 되살아나지만 삭제하면 그 링크는 영구히 죽는다.
 */
type Params = Promise<{ id: string }>;

export default async function AdminNoticeEditPage({ params }: { params: Params }) {
  await requireAdmin();

  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.notices" });
  const copyWarning = await getCopyWarningLabels();
  const tc = await getTranslations({ locale: routing.defaultLocale, namespace: "home.notice" });
  const { id } = await params;
  const noticeId = parseAdminNoticeId(id);
  const row = noticeId === null ? null : await getAdminNotice(noticeId);

  if (row === null) {
    return (
      <main className={q.main} data-testid="admin-notice-edit">
        <div className={q.wrap}>
          <Link className={a.backLink} href={ADMIN_NOTICES_PATH}>
            {t("back")}
          </Link>
          <p className={a.empty}>{t("notFound")}</p>
        </div>
      </main>
    );
  }

  const categoryLabels = tc.raw("category") as Record<string, string | undefined>;
  const categories = NOTICE_CATEGORIES.map((code) => ({ code, label: categoryLabels[code] ?? code }));

  const results = {
    created: t("result.created"),
    updated: t("result.updated"),
    deleted: t("result.deleted"),
    activated: t("result.activated"),
    deactivated: t("result.deactivated"),
    notFound: t("result.notFound"),
    validation: t("result.validation"),
    failed: t("result.failed"),
    copyWarning: t("result.copyWarning"),
  };

  return (
    <main className={q.main} data-testid="admin-notice-edit">
      <div className={q.wrap}>
        <Link className={a.backLink} href={ADMIN_NOTICES_PATH}>
          {t("back")}
        </Link>

        <header className={q.pageHead}>
          <h1 className={q.title}>{t("edit")}</h1>
          <p className={q.sub}>{t("publishedValue", { date: row.published_at })}</p>
        </header>

        <section className={a.section}>
          <h2 className={a.sectionTitle}>{t("edit")}</h2>
          <NoticeForm
            mode="edit"
            id={row.id}
            listHref={ADMIN_NOTICES_PATH}
            categories={categories}
            initial={{
              title: row.title,
              body: row.body,
              category: row.category,
              publishedAt: row.published_at,
              active: row.active,
            }}
            labels={{
              field: {
                title: t("field.title"),
                body: t("field.body"),
                category: t("field.category"),
                publishedAt: t("field.publishedAt"),
                active: t("field.active"),
              },
              hint: {
                title: t("hint.title"),
                body: t("hint.body"),
                category: t("hint.category"),
                publishedAt: t("hint.publishedAt"),
                active: t("hint.active"),
              },
              submit: t("save"),
              processing: t("processing"),
              delete: t("delete"),
              deleteArm: t("deleteArm"),
              deleteConfirm: t("deleteConfirm"),
              results,
              copyWarning,
            }}
          />
        </section>

        <section className={a.section}>
          <h2 className={a.sectionTitle}>{t("publicLinkLabel")}</h2>
          <p className={a.hint}>{t("publicLinkNote")}</p>
          <p className={a.hint} data-testid="admin-notice-public-path">
            {`/notices/${row.id}`}
          </p>
        </section>
      </div>
    </main>
  );
}
