import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { StatusBadge } from "@/components/admin/StatusBadge";
import { reservationBadge } from "@/components/admin/status-badge";
import { getStatusBadgeLabels } from "@/components/admin/statusBadgeLabels";
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
import { kstWallClock, tripDateText } from "@/lib/reservation-check/view";

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
 *
 * 간편 접수(P3-8 · 0023 intake='quick'): 접수번호 옆에 "간편 접수" 칩, 출발일은 **날짜만**(저장된 00:00 은 자리값),
 * 차량은 "미정(전화 확인)", 대수·인원 칸은 인원만. 손님이 고르지 않은 값을 지어내 보이지 않는다.
 *
 * 상태 칸은 P5-20 의 상태 배지(components/admin/StatusBadge.tsx)다 — 새 접수(골드 ●) · 72시간이 넘은 새 접수는 "N일째 대기"(가장 짙은 보라 !) ·
 * 확정(✓) · 운행 완료(실선) · 취소(점선 ×). 경과는 이 요청의 시각 하나(now)로 잰다. 목록의 전체 재설계(카드·탭 건수·정렬)는 P5-21 이다.
 * 상태 칸은 접수번호 바로 뒤다 — 사이드바(248px)가 본문 폭을 줄여 표(약 1212px)가 1280~1599px 에서 가로로 밀리는데,
 * 맨 끝에 두면 배지가 첫 화면에서 사라진다(P5-20 브라우저 실측). 배지 칸은 줄바꿈하지 않는다(tdNowrap).
 * 빈 상태: 걸러 본 상태가 비었으면 "이 상태의 접수가 없어요" + [전체 보기](필터 지우기), 아무 접수도 없으면 그 말을 한다.
 * 쪽(cursor)이 끝을 넘어 비었으면 둘 다 거짓이다 — "이 쪽에는 더 없어요" + [첫 쪽 보기](같은 상태의 첫 쪽 · 리뷰 P2-3).
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
  const tLabels = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.labels" });
  const status = parseStatusFilter(params.status);
  const cursor = parseCursor(params.cursor);

  // 차량 라벨은 공개 표(vehicles — anon + RLS)에서. 없으면 slug 로 떨어진다(라벨이 없다고 행을 숨기지 않는다).
  // 두 조회는 서로 기다릴 이유가 없어 동시에 보낸다(P5-18 — 게이트를 통과한 **뒤에만** 시작한다).
  const [{ items, hasMore, nextCursor }, vehicles] = await Promise.all([listReservations({ status, cursor }), vehicleLabels()]);
  const badgeLabels = await getStatusBadgeLabels();
  const now = new Date();

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
          cursor > 0 ? (
            // 끝을 넘은 쪽(예: 2쪽의 새 접수를 확정하고 돌아옴) — "접수가 없다" 가 아니라 "이 쪽에 더 없다"(리뷰 P2-3)
            <div className={a.empty}>
              <p>{t("emptyPage")}</p>
              <Link className={a.emptyAction} href={href(status, 0)}>
                {t("firstPage")}
              </Link>
            </div>
          ) : status === "all" ? (
            <p className={a.empty}>{t("emptyAll")}</p>
          ) : (
            <div className={a.empty}>
              <p>{t("empty")}</p>
              <Link className={a.emptyAction} href={href("all", 0)}>
                {t("clearFilter")}
              </Link>
            </div>
          )
        ) : (
          <div className={a.tableWrap}>
            <table className={a.table}>
              <caption className={a.srOnly}>{t("listLabel")}</caption>
              <thead>
                <tr>
                  <th className={a.th} scope="col">{t("col.createdAt")}</th>
                  <th className={a.th} scope="col">{t("col.code")}</th>
                  <th className={a.th} scope="col">{t("col.status")}</th>
                  <th className={a.th} scope="col">{t("col.name")}</th>
                  <th className={a.th} scope="col">{t("col.phone")}</th>
                  <th className={a.th} scope="col">{t("col.route")}</th>
                  <th className={a.th} scope="col">{t("col.departAt")}</th>
                  <th className={a.th} scope="col">{t("col.vehicle")}</th>
                  <th className={a.th} scope="col">{t("col.count")}</th>
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
                      {r.intake === "quick" ? (
                        <>
                          {" "}
                          <StatusBadge badge={{ kind: "quick" }} labels={badgeLabels} />
                        </>
                      ) : null}
                    </td>
                    <td className={`${a.td} ${a.tdNowrap}`}>
                      <StatusBadge badge={reservationBadge(r.status, r.created_at, now)} labels={badgeLabels} />
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
                    <td className={`${a.td} ${a.tdNowrap}`}>{tripDateText(r.depart_at, r.intake)}</td>
                    <td className={`${a.td} ${a.tdNowrap}`}>
                      {r.vehicle_slug === null ? tLabels("undecided") : (vehicles.get(r.vehicle_slug) ?? r.vehicle_slug)}
                    </td>
                    <td className={`${a.td} ${a.tdNowrap}`}>
                      {r.bus_count === null
                        ? r.passengers === null
                          ? tLabels("undecided")
                          : t("countPaxOnly", { passengers: r.passengers })
                        : r.passengers === null
                          ? t("countBusesOnly", { buses: r.bus_count })
                          : t("countValue", { buses: r.bus_count, passengers: r.passengers })}
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

