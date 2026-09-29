import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { formatAdminPeriod } from "@/components/admin/admin-date";
import { getAdminDateLabels } from "@/components/admin/adminDateLabels";
import { getCopyWarningLabels } from "@/components/admin/copyWarningLabels";
import { PopupForm } from "@/components/admin/PopupForm";
import { PopupToggle } from "@/components/admin/PopupToggle";
import { routing } from "@/i18n/routing";
import { ADMIN_POPUPS_PATH, listAdminPopups, popupState } from "@/lib/admin/popups";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { toKstDateString } from "@/lib/kst";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/popups — 홈 팝업 목록 + 새 팝업 등록 (P5-4).
 *
 * (protected) 그룹 안이라 레이아웃이 이미 게이트를 걸었지만 **여기서 다시, 본문 첫 문장으로** requireAdmin() 을 부른다.
 * 조건도 try 도 붙이지 않는다 — scripts/check-admin-gate.sh 가 그 형태를 구조로 강제한다(P5-3 독립 리뷰 F1·§재-2).
 *
 * 읽기는 lib/admin/popups.ts 의 세션 클라이언트 + 0009 RLS 다(서비스 롤 금지 — ADR-2). 캐시하지 않는다
 * (app/admin/layout.tsx 의 force-dynamic). 비활성·기간이 지난 행도 보인다 — 관리자는 내린 팝업을 되살릴 수 있어야 한다.
 *
 * "오늘" 은 KST 달력 날짜다(CLAUDE.md §3). 상태 배지의 판정은 lib/queries/popups.ts 의 isActiveOn —
 * 방문자에게 보이는 규칙과 사장님이 보는 배지가 같은 함수에서 나온다.
 *
 * 처음 화면 구조는 mockups/admin.html 의 팝업 탭(왼쪽 등록 폼 · 오른쪽 패널)이었다. 오른쪽 패널은 목업의
 * "현재 팝업" 대신 **등록된 팝업 목록**이다 — 실제 표에는 여러 행이 쌓이고, 지난 팝업을 다시 쓰거나 지울 수 있어야 한다.
 * P5-23 라운드 2(컨트롤러 B-5): 두 칸이던 것을 **목록 먼저 · 모든 폭에서 한 칸**으로 바꿨다(1280 에서도 목록 칸이 좁아 제목이 낱말마다 꺾이고
 * '노출 끄기' 가 두 줄이 됐다). 새 팝업 만들기는 목록 아래 자기 카드다.
 */
export default async function AdminPopupsPage() {
  await requireAdmin();

  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.popups" });
  const copyWarning = await getCopyWarningLabels();
  const rows = await listAdminPopups();
  const dateLabels = await getAdminDateLabels();
  const now = new Date();
  const today = toKstDateString(now);

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
    <main className={q.main} data-testid="admin-popups">
      <div className={a.pageWrap}>
        <header className={q.pageHead}>
          <h1 className={q.title}>{t("title")}</h1>
          <p className={q.sub}>{t("sub")}</p>
        </header>

        {/* 목록이 먼저, 모든 폭에서 한 칸(P5-23 라운드 2 · 컨트롤러 B-5) — 새 팝업 만들기는 그 아래 자기 카드다.
            목록은 1024px 이상에서 표, 그보다 좁으면 행이 카드(제목 · 노출 기간 · 상태 · 버튼)가 된다(같은 마크업). */}
        <section className={a.section} aria-labelledby="popup-list-title">
          <h2 className={a.sectionTitle} id="popup-list-title">
            {t("listLabel")}
          </h2>
          {rows.length === 0 ? (
            // 빈 상태 — 방향이 아니라 다음 행동(팝업 만들기 → 같은 화면의 제목 칸)과 짝짓는다(P5-20)
            <div className={a.empty}>
              <p>{t("empty")}</p>
              <a className={a.emptyAction} href="#popup-title">
                {t("emptyAction")}
              </a>
            </div>
          ) : (
            <div className={`${a.tableWrap} ${a.contentWrap}`}>
              {/* 표 이름은 섹션 제목이 말한다 — 같은 말의 캡션을 또 적지 않는다(P5-20) */}
              <table className={`${a.tablePopups} ${a.contentTable} ${a.tableMiddle}`} aria-labelledby="popup-list-title" data-testid="admin-popups-table">
                <thead>
                  <tr>
                    <th className={a.th} scope="col">
                      {t("col.title")}
                    </th>
                    <th className={a.th} scope="col">
                      {t("col.period")}
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
                      <td className={`${a.td} ${a.tdStrong}`} data-cell="title">
                        <Link className={a.rowLink} href={`${ADMIN_POPUPS_PATH}/${row.id}`}>
                          {row.title}
                        </Link>
                      </td>
                      <td className={`${a.td} ${a.tdNowrap}`} data-cell="meta">
                        {formatAdminPeriod(row.starts_at, row.ends_at, now, dateLabels) ?? t("periodValue", { start: row.starts_at, end: row.ends_at })}
                      </td>
                      <td className={a.td} data-cell="meta">
                        <span className={a.badge} data-state={popupState(row, today)}>
                          {t(`state.${popupState(row, today)}`)}
                        </span>
                      </td>
                      <td className={a.td} data-cell="actions">
                        <div className={a.rowActions}>
                          <Link className={a.rowLink} href={`${ADMIN_POPUPS_PATH}/${row.id}`}>
                            {t("editLink")}
                          </Link>
                          <PopupToggle
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

        <section className={a.section} aria-labelledby="popup-new-title" data-testid="admin-popup-new">
          <h2 className={a.sectionTitle} id="popup-new-title">
            {t("new")}
          </h2>
          <PopupForm
            mode="create"
            listHref={ADMIN_POPUPS_PATH}
            initial={{ title: "", body: "", imagePath: "", startsAt: today, endsAt: today, active: true }}
            labels={{
              field: {
                title: t("field.title"),
                body: t("field.body"),
                imagePath: t("field.imagePath"),
                startsAt: t("field.startsAt"),
                endsAt: t("field.endsAt"),
                period: t("field.period"),
                active: t("field.active"),
              },
              hint: {
                title: t("hint.title"),
                body: t("hint.body"),
                imagePath: t("hint.imagePath"),
                period: t("hint.period"),
                active: t("hint.active"),
              },
              notice: t("notice"),
              submit: t("create"),
              processing: t("processing"),
              delete: t("delete"),
              deleteArm: t("deleteArm"),
              deleteConfirm: t("deleteConfirm"),
              results,
              copyWarning,
            }}
          />
        </section>
      </div>
    </main>
  );
}
