import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { NoticeForm } from "@/components/admin/NoticeForm";
import { NoticeToggle } from "@/components/admin/NoticeToggle";
import { routing } from "@/i18n/routing";
import { NOTICE_CATEGORIES } from "@/lib/admin/noticeInput";
import { ADMIN_NOTICES_PATH, listAdminNotices } from "@/lib/admin/notices";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { toKstDateString } from "@/lib/kst";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/notices — 공지 목록 + 새 공지 등록 (P5-5).
 *
 * (protected) 그룹 안이라 레이아웃이 이미 게이트를 걸었지만 **여기서 다시, 본문 첫 문장으로** requireAdmin() 을 부른다.
 * 조건도 try 도 붙이지 않는다 — scripts/check-admin-gate.mjs 가 그 형태를 구조로 강제한다.
 *
 * 읽기는 lib/admin/notices.ts 의 세션 클라이언트 + 0009 RLS 다(서비스 롤 금지 — ADR-2). 캐시하지 않는다
 * (app/admin/layout.tsx 의 force-dynamic). 비활성 행도 보인다 — 관리자는 내린 공지를 되살릴 수 있어야 한다.
 *
 * 카테고리 라벨은 방문자 화면과 **같은 카탈로그**(`home.notice.category`)에서 온다. 저장되는 것은 코드다(CLAUDE.md §3).
 * "오늘"(새 공지의 기본 게시일)은 KST 달력 날짜다 — 0004 가 DB default 를 Asia/Seoul 로 맞춰 둔 것과 기준이 같다.
 *
 * 목록에는 삭제가 없다. 기본 도구는 노출 중지(NoticeToggle)이고, 진짜 삭제는 수정 화면에서 두 단계를 거친다.
 */
export default async function AdminNoticesPage() {
  await requireAdmin();

  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.notices" });
  const tc = await getTranslations({ locale: routing.defaultLocale, namespace: "home.notice" });
  const rows = await listAdminNotices();
  const today = toKstDateString(new Date());

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
  };

  const labels = {
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
    processing: t("processing"),
    delete: t("delete"),
    deleteArm: t("deleteArm"),
    deleteConfirm: t("deleteConfirm"),
    results,
  };

  return (
    <main className={q.main} data-testid="admin-notices">
      <div className={a.pageWrap}>
        <header className={q.pageHead}>
          <h1 className={q.title}>{t("title")}</h1>
          <p className={q.sub}>{t("sub")}</p>
        </header>

        <div className={a.popupGrid}>
          <section className={a.section}>
            <h2 className={a.sectionTitle}>{t("new")}</h2>
            <NoticeForm
              mode="create"
              listHref={ADMIN_NOTICES_PATH}
              categories={categories}
              initial={{ title: "", body: "", category: NOTICE_CATEGORIES[0], publishedAt: today, active: true }}
              labels={{ ...labels, submit: t("create") }}
            />
          </section>

          <section className={a.section}>
            <h2 className={a.sectionTitle}>{t("listLabel")}</h2>
            {rows.length === 0 ? (
              <p className={a.empty}>{t("empty")}</p>
            ) : (
              <div className={a.tableWrap}>
                <table className={a.tablePopups}>
                  <caption>{t("listLabel")}</caption>
                  <thead>
                    <tr>
                      <th className={a.th} scope="col">
                        {t("col.title")}
                      </th>
                      <th className={a.th} scope="col">
                        {t("col.category")}
                      </th>
                      <th className={a.th} scope="col">
                        {t("col.publishedAt")}
                      </th>
                      <th className={a.th} scope="col">
                        {t("col.state")}
                      </th>
                      <th className={a.th} scope="col">
                        {t("col.actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className={`${a.td} ${a.tdStrong}`}>
                          <Link className={a.rowLink} href={`${ADMIN_NOTICES_PATH}/${row.id}`}>
                            {row.title}
                          </Link>
                        </td>
                        <td className={a.td}>{categoryLabels[row.category] ?? row.category}</td>
                        <td className={`${a.td} ${a.tdNowrap}`}>{row.published_at}</td>
                        <td className={a.td}>
                          <span className={a.badge} data-state={row.active ? "live" : "off"}>
                            {row.active ? t("state.live") : t("state.off")}
                          </span>
                        </td>
                        <td className={a.td}>
                          <div className={a.rowActions}>
                            <Link className={a.rowLink} href={`${ADMIN_NOTICES_PATH}/${row.id}`}>
                              {t("editLink")}
                            </Link>
                            <NoticeToggle
                              id={row.id}
                              active={row.active}
                              labels={{ turnOn: t("turnOn"), turnOff: t("turnOff"), processing: t("processing"), results }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
