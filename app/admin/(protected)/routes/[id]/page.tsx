import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { RouteForm } from "@/components/admin/RouteForm";
import { formatPriceKrw } from "@/components/KrMap/format";
import { routing } from "@/i18n/routing";
import { ROUTE_PLACE_CODES, parseRouteId, routePlaceLabel } from "@/lib/admin/routeInput";
import { ADMIN_ROUTES_PATH, getAdminRoute } from "@/lib/admin/routes";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { VERBATIM } from "@/lib/legal/disclosures";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/routes/[id] — 대표 노선 한 줄 수정 (P5-6). **삭제는 없다.**
 *
 * 목록과 같은 이유로 여기서도 **본문 첫 문장이** requireAdmin() 이다(조건·try 금지 — scripts/check-admin-gate.mjs).
 * 경로의 id 가 양의 정수가 아니면 DB 를 부르지 않고 "찾을 수 없음" 으로 끝낸다.
 *
 * **"홈에서 이렇게 보입니다" 를 같은 화면에 둔다.** 사장님이 빈 값의 뜻을 알아야 하기 때문이다 —
 * 가격을 비우면 홈은 금액 라벨만 감추고 노선·핀은 그대로 그린다(P2-2 폴백). 노출을 끄면 그 노선이 지도에서 통째로 빠진다.
 * 미리보기 문자열은 홈이 쓰는 `formatPriceKrw` 가 만든다 — 관리자 전용 포맷을 만들지 않는다(CLAUDE.md §3).
 * 고지 문구는 lib/legal/disclosures.ts 원장에서 온다(다시 타이핑 금지).
 */
type Params = Promise<{ id: string }>;

export default async function AdminRouteEditPage({ params }: { params: Params }) {
  await requireAdmin();

  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.routes" });
  const { id } = await params;
  const routeId = parseRouteId(id);
  const row = routeId === null ? null : await getAdminRoute(routeId);

  if (row === null) {
    return (
      <main className={q.main} data-testid="admin-route-edit">
        <div className={q.wrap}>
          <Link className={a.backLink} href={ADMIN_ROUTES_PATH}>
            {t("back")}
          </Link>
          <p className={a.empty}>{t("notFound")}</p>
        </div>
      </main>
    );
  }

  const places = ROUTE_PLACE_CODES.map((code) => ({ code, label: routePlaceLabel(code) }));
  const amount = formatPriceKrw(row.price_from);
  const routeLabel = t("routeValue", {
    origin: routePlaceLabel(row.origin_code),
    destination: routePlaceLabel(row.destination_code),
  });

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
    <main className={q.main} data-testid="admin-route-edit">
      <div className={q.wrap}>
        <Link className={a.backLink} href={ADMIN_ROUTES_PATH}>
          {t("back")}
        </Link>

        <header className={q.pageHead}>
          <h1 className={q.title}>{t("edit")}</h1>
          <p className={q.sub}>{routeLabel}</p>
        </header>

        <section className={a.section}>
          <h2 className={a.sectionTitle}>{t("edit")}</h2>
          <RouteForm
            id={row.id}
            places={places}
            initial={{
              originCode: row.origin_code,
              destinationCode: row.destination_code,
              priceFrom: row.price_from === null ? "" : String(row.price_from),
              sort: row.sort === null ? "" : String(row.sort),
              active: row.active,
            }}
            labels={{
              field: {
                originCode: t("field.originCode"),
                destinationCode: t("field.destinationCode"),
                priceFrom: t("field.priceFrom"),
                sort: t("field.sort"),
                active: t("field.active"),
              },
              hint: {
                originCode: t("hint.originCode"),
                destinationCode: t("hint.destinationCode"),
                priceFrom: t("hint.priceFrom"),
                sort: t("hint.sort"),
                active: t("hint.active"),
              },
              submit: t("save"),
              processing: t("processing"),
              results,
            }}
          />
        </section>

        <section className={a.section} data-testid="admin-route-on-home">
          <h2 className={a.sectionTitle}>{t("homeLookLabel")}</h2>
          <p className={a.hint}>{t("homeLookNote")}</p>
          <dl className={a.dl}>
            <div className={a.row}>
              <dt className={a.dt}>{t("col.route")}</dt>
              <dd className={a.dd}>{routeLabel}</dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("col.price")}</dt>
              <dd className={a.dd}>{amount === "" ? t("homeLookNoPrice") : amount}</dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("col.state")}</dt>
              <dd className={a.dd}>{row.active ? t("homeLookOn") : t("homeLookOff")}</dd>
            </div>
          </dl>
          <p className={a.hint} data-testid="admin-route-verbatim">
            {VERBATIM.showcaseNotice}
          </p>
        </section>
      </div>
    </main>
  );
}
