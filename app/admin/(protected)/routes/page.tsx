import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { RouteOrder } from "@/components/admin/RouteOrder";
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
 * /admin/routes — 홈 대표 노선 목록 (P5-6 · OF3-R2 한 목록).
 *
 * (protected) 그룹 안이라 레이아웃이 이미 게이트를 걸었지만 **여기서 다시, 본문 첫 문장으로** requireAdmin() 을 부른다.
 * 조건도 try 도 붙이지 않는다 — scripts/check-admin-gate.mjs 가 그 형태를 구조로 강제한다.
 *
 * **추가·삭제가 없다.** 16개는 스펙 §13.2 가 고정하고 0002 가 지도 핀과 FK 로 묶은 집합이라 값만 고친다
 * (근거는 lib/admin/routes.ts 헤더). 목록에서 할 수 있는 것은 수정으로 들어가기·노출 중지/재개·순서 바꾸기뿐이다.
 *
 * **목록은 하나다**(OF3-R2). 예전에는 위에 표(수정·켜기/끄기), 아래에 따로 «순서 바꾸기» 목록이 있어 같은 노선이 두 번 나왔다.
 * 이제 공용 SortableList 한 줄이 손잡이·↑↓·노선 이름·금액·상태·[수정]·[켜기/끄기]를 모두 담는다. 순서가 바뀌어 저장 전인 동안
 * 목록 위에 «순서 저장 / 처음 순서로» 막대가 나타나고 줄 끝 단추는 잠긴다(components/admin/SortableList.tsx).
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
    reordered: t("result.reordered"),
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

        <section className={a.section} aria-labelledby="route-list-title" data-testid="admin-routes-list">
          <h2 className={a.sectionTitle} id="route-list-title">
            {t("listLabel")}
          </h2>
          {rows.length === 0 ? (
            <p className={a.empty}>{t("empty")}</p>
          ) : (
            <>
              {/* 항목이 하나뿐이면 옮길 곳이 없다 — 순서 안내도, 줄의 손잡이·↑↓ 도 없다(SortableList 가 count ≤ 1 이면 그리지 않는다) */}
              {rows.length > 1 ? <p className={a.hint}>{t("order.hint")}</p> : null}
              <RouteOrder
                items={rows.map((row) => {
                  const amount = formatPriceKrw(row.price_from);
                  return {
                    id: row.id,
                    label: t("routeValue", { origin: routePlaceLabel(row.origin_code), destination: routePlaceLabel(row.destination_code) }),
                    meta: amount === "" ? t("noPrice") : amount,
                    status: { text: row.active ? t("state.live") : t("state.off"), live: row.active },
                    end: (
                      <>
                        <Link className={a.rowLink} href={`${ADMIN_ROUTES_PATH}/${row.id}`}>
                          {t("editLink")}
                        </Link>
                        <RouteToggle
                          id={row.id}
                          active={row.active}
                          labels={{ turnOn: t("turnOn"), turnOff: t("turnOff"), processing: t("processing"), results }}
                        />
                      </>
                    ),
                  };
                })}
                labels={{
                  save: t("order.save"),
                  reset: t("order.reset"),
                  processing: t("processing"),
                  up: t.raw("order.up") as string,
                  down: t.raw("order.down") as string,
                  handle: t.raw("order.handle") as string,
                  moved: t.raw("order.moved") as string,
                  picked: t.raw("order.picked") as string,
                  canceled: t("order.canceled"),
                  instructions: t("order.instructions"),
                  locked: t("order.locked"),
                }}
                saved={t("order.saved")}
                failed={t("order.failed")}
              />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
