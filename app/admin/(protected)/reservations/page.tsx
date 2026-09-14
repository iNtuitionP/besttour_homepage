import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import {
  DEFAULT_ADMIN_PAGE_SIZE,
  STATUS_FILTERS,
  listReservations,
  parseCursor,
  parseStatusFilter,
} from "@/lib/admin/reservations";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { isLocationCode, locationLabelKo } from "@/lib/codes";
import { getVehicles } from "@/lib/queries";
import { kstWallClock } from "@/lib/reservation-check/view";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/reservations — 예약 현황 목록 (P5-3).
 *
 * (protected) 그룹 안이라 레이아웃이 이미 게이트를 걸었지만 **여기서 다시, 무조건 requireAdmin() 을 부른다** —
 * 화면 하나하나가 스스로 잠기는 편이 안전하다(app/admin/(protected)/layout.tsx 헤더 규약).
 * 이 호출에는 어떤 분기도 붙이지 않는다(리뷰 F1: 조건부 게이트는 게이트가 아니다).
 *
 * 읽기는 lib/admin/reservations.ts 의 세션 클라이언트 + 0009 RLS 다(서비스 롤 금지 — ADR-2).
 * **캐시하지 않는다**: 고객 개인정보가 실린 응답을 태그 캐시에 올리면 무효화 실수 하나가 그대로 노출이 된다.
 * app/admin/layout.tsx 의 force-dynamic 이 이 화면에도 적용된다.
 *
 * 마스킹하지 않는다 — 사장님이 전화를 걸어야 한다. 대신 개인정보를 **서버 컴포넌트 props 로 내리지 않고**
 * 이 파일 안에서 바로 그린다(P3-5 리뷰 N-2: dev 는 서버 컴포넌트 props 를 HTML 에 debug 정보로 직렬화한다).
 * 클라이언트로 내려가는 것은 uuid·상태·라벨뿐이다(components/admin/ReservationActions.tsx).
 *
 * 개발용 우회 경로는 없다. 이 화면을 보려면 실제 관리자 세션이 있어야 한다 — 세션 없이 더미 행을 그리던 개발 분기는
 * P5-3 독립 리뷰에서 제거됐다(production 번들에 남아 환경변수 두 개로 열렸다).
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** 표시용 차량 라벨. 비활성 차량으로 접수된 건은 anon 정책에 걸려 안 나오므로 slug 로 떨어진다(라벨이 없다고 행을 숨기지 않는다). */
async function vehicleLabels(): Promise<Map<string, string>> {
  try {
    const vehicles = await getVehicles();
    return new Map(vehicles.map((v): [string, string] => [v.slug, v.nameKo]));
  } catch {
    return new Map();
  }
}

const label = (code: string): string => (isLocationCode(code) ? locationLabelKo(code) : code);
const telHref = (phone: string): string => `tel:${phone.replace(/[^0-9+]/g, "")}`;

export default async function AdminReservationsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();

  const params = await searchParams;
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.reservations" });
  const status = parseStatusFilter(params.status);
  const cursor = parseCursor(params.cursor);

  const { items, hasMore, nextCursor } = await listReservations({ status, cursor });
  // 차량 라벨은 공개 표(vehicles — anon + RLS)에서. 없으면 slug 로 떨어진다(라벨이 없다고 행을 숨기지 않는다).
  const vehicles = await vehicleLabels();

  const href = (nextStatus: string, nextCursorValue: number): string => {
    const qs = new URLSearchParams();
    if (nextStatus !== "all") qs.set("status", nextStatus);
    if (nextCursorValue > 0) qs.set("cursor", String(nextCursorValue));
    const s = qs.toString();
    return s ? `/admin/reservations?${s}` : "/admin/reservations";
  };

  return (
    <main className={q.main} data-testid="admin-reservations">
      <div className={a.pageWrap}>
        <header className={q.pageHead}>
          <h1 className={q.title}>{t("title")}</h1>
          <p className={q.sub}>{t("sub")}</p>
        </header>

        <nav className={a.filters} aria-label={t("filterLabel")}>
          <span className={a.filterLabel}>{t("filterLabel")}</span>
          {STATUS_FILTERS.map((f) => (
            <Link key={f} className={a.filter} href={href(f, 0)} aria-current={f === status ? "true" : undefined}>
              {t(`filter.${f}`)}
            </Link>
          ))}
        </nav>

        {items.length === 0 ? (
          <p className={a.empty}>{t("empty")}</p>
        ) : (
          <div className={a.tableWrap}>
            <table className={a.table}>
              <caption>{t("listLabel")}</caption>
              <thead>
                <tr>
                  <th className={a.th} scope="col">{t("col.createdAt")}</th>
                  <th className={a.th} scope="col">{t("col.code")}</th>
                  <th className={a.th} scope="col">{t("col.name")}</th>
                  <th className={a.th} scope="col">{t("col.phone")}</th>
                  <th className={a.th} scope="col">{t("col.route")}</th>
                  <th className={a.th} scope="col">{t("col.departAt")}</th>
                  <th className={a.th} scope="col">{t("col.vehicle")}</th>
                  <th className={a.th} scope="col">{t("col.count")}</th>
                  <th className={a.th} scope="col">{t("col.status")}</th>
                  <th className={a.th} scope="col">{t("col.detail")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td className={`${a.td} ${a.tdNowrap}`}>{kstWallClock(r.created_at)}</td>
                    <td className={`${a.td} ${a.tdNowrap}`}>
                      <Link className={a.rowLink} href={`/admin/reservations/${r.id}`}>
                        {r.public_code}
                      </Link>
                    </td>
                    <td className={`${a.td} ${a.tdStrong} ${a.tdNowrap}`}>{r.name}</td>
                    <td className={`${a.td} ${a.tdNowrap}`}>
                      <a className={a.telLink} href={telHref(r.phone)}>
                        {r.phone}
                      </a>
                    </td>
                    <td className={a.td}>
                      {t("routeValue", { origin: label(r.origin_code), destination: label(r.destination_code) })}
                    </td>
                    <td className={`${a.td} ${a.tdNowrap}`}>{kstWallClock(r.depart_at)}</td>
                    <td className={`${a.td} ${a.tdNowrap}`}>{vehicles.get(r.vehicle_slug) ?? r.vehicle_slug}</td>
                    <td className={`${a.td} ${a.tdNowrap}`}>
                      {r.passengers === null
                        ? t("countBusesOnly", { buses: r.bus_count })
                        : t("countValue", { buses: r.bus_count, passengers: r.passengers })}
                    </td>
                    <td className={a.td}>
                      <span className={a.badge} data-status={r.status}>
                        {t(`status.${r.status}`)}
                      </span>
                    </td>
                    <td className={`${a.td} ${a.tdNowrap}`}>
                      <Link className={a.rowLink} href={`/admin/reservations/${r.id}`}>
                        {t("detail")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {cursor > 0 || hasMore ? (
          <nav className={a.pager} aria-label={t("pageLabel")}>
            {cursor > 0 ? (
              <Link className={a.pagerLink} href={href(status, Math.max(0, cursor - DEFAULT_ADMIN_PAGE_SIZE))}>
                {t("prev")}
              </Link>
            ) : null}
            {hasMore && nextCursor !== null ? (
              <Link className={a.pagerLink} href={href(status, nextCursor)}>
                {t("next")}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </main>
  );
}

