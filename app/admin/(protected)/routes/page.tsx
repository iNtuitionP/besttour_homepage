import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { RouteToggle } from "@/components/admin/RouteToggle";
import { formatPriceKrw } from "@/components/KrMap/format";
import { routing } from "@/i18n/routing";
import { routePlaceLabel } from "@/lib/admin/routeInput";
import { ADMIN_ROUTES_PATH, listAdminRoutes } from "@/lib/admin/routes";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { VERBATIM } from "@/lib/legal/disclosures";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/routes — 홈 대표 노선 목록 (P5-6).
 *
 * (protected) 그룹 안이라 레이아웃이 이미 게이트를 걸었지만 **여기서 다시, 본문 첫 문장으로** requireAdmin() 을 부른다.
 * 조건도 try 도 붙이지 않는다 — scripts/check-admin-gate.mjs 가 그 형태를 구조로 강제한다.
 *
 * **추가·삭제가 없다.** 16개는 스펙 §13.2 가 고정하고 0002 가 지도 핀과 FK 로 묶은 집합이라 값만 고친다
 * (근거는 lib/admin/routes.ts 헤더). 목록에서 할 수 있는 것은 수정으로 들어가기와 노출 중지/재개뿐이다.
 *
 * **가격 표시는 홈과 같은 함수**(components/KrMap/format.ts `formatPriceKrw`)로 그린다 — 관리자가 두 번째 포맷을 만들면
 * 사장님이 보는 금액과 방문자가 보는 금액이 갈린다. 빈 문자열이 돌아오면 홈에서도 라벨이 숨는다는 뜻이라 그대로 알려 준다.
 *
 * 가격 옆의 고지는 lib/legal/disclosures.ts 의 **verbatim 원장**에서 온다 — 한 글자도 다시 타이핑하지 않는다(CLAUDE.md §3).
 */
export default async function AdminRoutesPage() {
  await requireAdmin();

  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.routes" });
  const rows = await listAdminRoutes();

  const results = {
    updated: t("result.updated"),
    activated: t("result.activated"),
    deactivated: t("result.deactivated"),
    notFound: t("result.notFound"),
    duplicate: t("result.duplicate"),
    validation: t("result.validation"),
    failed: t("result.failed"),
  };

  return (
    <main className={q.main} data-testid="admin-routes">
      <div className={a.pageWrap}>
        <header className={q.pageHead}>
          <h1 className={q.title}>{t("title")}</h1>
          <p className={q.sub}>{t("sub")}</p>
        </header>

        <section className={a.section}>
          <p className={a.hint} data-testid="admin-routes-verbatim">
            {VERBATIM.showcaseNotice}
          </p>
          <p className={a.hint}>{t("fixedNote")}</p>
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
                      {t("col.route")}
                    </th>
                    <th className={a.th} scope="col">
                      {t("col.price")}
                    </th>
                    <th className={a.th} scope="col">
                      {t("col.sort")}
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
                  {rows.map((row) => {
                    const amount = formatPriceKrw(row.price_from);
                    return (
                      <tr key={row.id}>
                        <td className={`${a.td} ${a.tdStrong}`}>
                          <Link className={a.rowLink} href={`${ADMIN_ROUTES_PATH}/${row.id}`}>
                            {t("routeValue", {
                              origin: routePlaceLabel(row.origin_code),
                              destination: routePlaceLabel(row.destination_code),
                            })}
                          </Link>
                        </td>
                        <td className={`${a.td} ${a.tdNowrap}`}>{amount === "" ? t("noPrice") : amount}</td>
                        <td className={`${a.td} ${a.tdNowrap}`}>{row.sort === null ? t("noSort") : row.sort}</td>
                        <td className={a.td}>
                          <span className={a.badge} data-state={row.active ? "live" : "off"}>
                            {row.active ? t("state.live") : t("state.off")}
                          </span>
                        </td>
                        <td className={a.td}>
                          <div className={a.rowActions}>
                            <Link className={a.rowLink} href={`${ADMIN_ROUTES_PATH}/${row.id}`}>
                              {t("editLink")}
                            </Link>
                            <RouteToggle
                              id={row.id}
                              active={row.active}
                              labels={{ turnOn: t("turnOn"), turnOff: t("turnOff"), processing: t("processing"), results }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
