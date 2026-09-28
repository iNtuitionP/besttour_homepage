import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { LoadMore } from "@/components/admin/LoadMore";
import { NavBadgeReport } from "@/components/admin/NavBadgeReport";
import {
  LIST_PAGE_SIZE,
  LIST_TABS,
  MAX_LIST_PAGES,
  PAST_CONFIRMED_SHOWN,
  groupListRows,
  kstTodayStart,
  listHref,
  listLimit,
  parseListPage,
  parseListTab,
  type ListTab,
} from "@/components/admin/reservation-list";
import { reservationRow, type ReservationRowContext } from "@/components/admin/reservationRow";
import { getReservationRowLabels } from "@/components/admin/reservationRowLabels";
import { getStatusBadgeLabels } from "@/components/admin/statusBadgeLabels";
import { TabIntoView } from "@/components/admin/TabIntoView";
import { navBadge } from "@/components/admin/tabs";
import { routing } from "@/i18n/routing";
import { countReservationsByStatus, listConfirmedPast, listReservations, type ReservationListRow } from "@/lib/admin/reservations";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getVehicles } from "@/lib/queries";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/reservations — 접수 목록 (P5-3 → P5-21 재설계 · 시안 docs/handoff/2026-09-27-admin-ux #list · 제안서 ⑤-2 · ⑦ 1-4).
 *
 * (protected) 그룹 안이라 레이아웃이 이미 게이트를 걸었지만 **여기서 다시, 무조건 requireAdmin() 을 부른다** —
 * 화면 하나하나가 스스로 잠기는 편이 안전하다(app/admin/(protected)/layout.tsx 헤더 규약). 이 호출에는 어떤 분기도 붙이지 않는다
 * (리뷰 F1: 조건부 게이트는 게이트가 아니다). 조회는 전부 그 **뒤에**, 서로 기다리지 않고 동시에 나간다(P5-18).
 *
 * 읽기는 lib/admin/reservations.ts 의 세션 클라이언트 + 0009 RLS 다(서비스 롤 금지 — ADR-2). **캐시하지 않는다**(고객 개인정보가 실린 응답).
 * app/admin/layout.tsx 의 force-dynamic 이 이 화면에도 적용된다. 개발용 우회 경로는 없다(P5-3 독립 리뷰에서 제거).
 *
 * 무엇을 그리나
 *   - **상태 탭 + 건수**: 새 접수(골드 알약 — 메뉴 배지와 같은 정의 countNewReservations) · 확정 · 운행 완료 · 취소(옅은 알약) · 전체(넷의 합).
 *     **기본 탭은 새 접수**다(쿼리 없는 주소). 건수를 세지 못하면 알약만 숨긴다(0 이라고 그리지 않는다 — 목록은 그대로 열린다).
 *     휴대폰에서는 탭 줄만 가로로 스크롤된다(페이지는 넘치지 않는다).
 *   - **정렬**(lib/admin/reservations.ts LIST_ORDER): 새 접수 = 오래 기다린 것부터(72시간 넘은 건은 "답이 늦은 접수" 묶음으로 맨 위) ·
 *     확정 = 출발이 가까운 것부터 · 운행 완료·취소·전체 = 최근 것부터.
 *   - **확정 탭**(수정 라운드 · 리뷰 P1-1): 쪽으로 넘기는 목록은 **다가오는 운행만**(출발 ≥ KST 오늘 00:00 — 관리 홈 '이번 주 운행' 과 같은 경계).
 *     운행일이 지난 확정은 그 위에 **따로 짧게** — "운행일이 지난 확정 N건" + 운행 완료 안내 + 최근 것부터 5건(쪽 번호 없음). 조회 둘(다가오는 · 지난)은
 *     게이트 뒤에 다른 조회와 함께 동시에 나간다. 지난 쪽을 못 읽으면 그 칸만 "불러오지 못했어요"(목록은 그대로 연다).
 *     전에는 한 쿼리라 지난 확정이 쌓이면 쪽 1 을 다 차지해 다가오는 운행이 사라졌고, 안내 "출발이 가까운 순서로" 도 거짓이 됐다.
 *   - 현재 탭은 `aria-current="true"`(리뷰 P2-14 — "page" 는 사이드바 하나) · 휴대폰에서는 탭 줄 안에서 보이는 자리로 민다(TabIntoView · 리뷰 P2-5).
 *   - **행 = 한 벌의 마크업**(components/admin/reservationRow.tsx): 휴대폰 카드 · ≥1024px 표 모양 7칸. 행 전체가 상세 링크(uuid 만),
 *     전화 버튼은 별개(tel: 전체 번호). 목록의 번호는 가운데를 가린다(010-****-0004). 옛 68rem 가로 스크롤 표는 없앴다.
 *   - **'20건 더 보기'**(components/admin/LoadMore.tsx): 주소의 쪽만 바꾸고, 이 화면은 첫 줄부터 쪽 × 20 건을 그린다 — 주소에는 상태·쪽만(개인정보 0).
 *   - **빈 상태 두 종류**: 데이터 없음(새 접수 탭 "새 접수가 없어요…" · 전체 탭 "아직 들어온 접수가 없어요.") · 걸러 본 결과 없음(그 밖의 탭 + [전체 보기]).
 *     목록은 늘 첫 줄부터라 뒤쪽 쪽 번호로 들어와도 문장이 거짓이 되지 않는다.
 *   - **메뉴 배지와 같은 숫자**(리뷰 P2-10): 새 접수 건수를 NavBadgeReport 로 메뉴에 보고한다(메뉴는 더 새로 센 쪽을 그린다).
 *
 * 개인정보는 **서버가 그린다** — 행은 컴포넌트 props 가 아니라 함수 호출(reservationRow(…))로 그려진다(P3-5 리뷰 N-2: dev 는 서버 컴포넌트 props 를
 * HTML 에 싣는다). 클라이언트 부품(LoadMore · NavBadgeReport)은 주소·문구·숫자만 받는다.
 * 검색(이름 · 번호 뒷자리 · 접수번호)은 2단계다 — 이번에 만들지 않았다.
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

/** 행 목록을 감싼 요소의 id — '더 보기' 뒤 새 첫 행을 이 안에서 찾는다(지난 확정 칸의 행은 쪽 번호가 없어 섞이지 않는다). */
const LIST_ID = "admin-reservation-list";
/** 상태 탭 줄의 id — TabIntoView 가 이 안에서 지금 탭을 찾는다. */
const TABS_ID = "admin-status-tabs";

const ALERT_PATH = "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5v5.5M12 16.5v.3";

/** 지난 확정 칸 — 확정 탭이 아니면 null(읽지 않는다) · 못 읽으면 ok:false. */
type PastConfirmed = null | { ok: false } | { ok: true; items: ReservationListRow[]; total: number };

export default async function AdminReservationsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();

  const params = await searchParams;
  const tab = parseListTab(params.status);
  const page = parseListPage(params.page);
  const now = new Date();
  // 확정 탭의 경계 — KST 오늘 00:00(관리 홈 '이번 주 운행' 창의 시작과 같은 값)
  const cutoff = tab === "confirmed" ? kstTodayStart(now) : null;

  const [t, tTabs, badgeLabels, rowLabels, { items, hasMore }, counts, vehicles, past] = await Promise.all([
    getTranslations({ locale: routing.defaultLocale, namespace: "admin.reservations" }),
    getTranslations({ locale: routing.defaultLocale, namespace: "admin.tabs" }),
    getStatusBadgeLabels(),
    getReservationRowLabels(),
    cutoff === null ? listReservations({ status: tab, limit: listLimit(page) }) : listReservations({ status: "confirmed", limit: listLimit(page), departFrom: cutoff }),
    // 건수를 모르면 알약만 숨긴다(0 으로 그리지 않는다) — 목록은 그대로 연다
    countReservationsByStatus().catch(() => null),
    vehicleLabels(),
    // 지난 확정 — 못 읽으면 그 칸만 모름(목록은 그대로 연다)
    cutoff === null
      ? Promise.resolve<PastConfirmed>(null)
      : listConfirmedPast(cutoff, PAST_CONFIRMED_SHOWN).then(
          (v): PastConfirmed => ({ ok: true, ...v }),
          (): PastConfirmed => ({ ok: false }),
        ),
  ]);

  const countOf = (k: ListTab): number | null =>
    counts === null ? null : k === "all" ? counts.new + counts.confirmed + counts.done + counts.cancelled : counts[k];
  const ctx: ReservationRowContext = { now, labels: rowLabels, badgeLabels, vehicles, departRelative: tab === "confirmed" };
  const groups = groupListRows(tab, items, now);
  const hint = tab === "new" ? t("hint.new") : tab === "confirmed" ? t("hint.confirmed") : t("hint.recent");
  const nextHref = hasMore && page < MAX_LIST_PAGES ? listHref(tab, page + 1) : null;
  // 지난 확정 칸을 그리는가 — 있으면(1건 이상) 또는 모르면(모름을 0 으로 숨기지 않는다)
  const showPast = past !== null && (!past.ok || past.total > 0);
  const pastRows = past !== null && past.ok ? past.items : [];
  const anyRows = items.length > 0 || pastRows.length > 0;

  return (
    <main className={q.main} data-testid="admin-reservations">
      <div className={a.pageWrap}>
        <header className={q.pageHead}>
          <h1 className={q.title}>{t("title")}</h1>
          <p className={q.sub}>{t("sub")}</p>
        </header>
        {counts !== null ? <NavBadgeReport badge={navBadge(counts.new, (n) => tTabs("newCount", { n }))} at={now.getTime()} /> : null}

        <nav className={a.statusTabs} aria-label={t("filterLabel")} id={TABS_ID}>
          <ul className={a.statusTabList}>
            {LIST_TABS.map((k) => {
              const n = countOf(k);
              return (
                <li key={k}>
                  <Link className={a.statusTab} href={listHref(k)} aria-current={k === tab ? "true" : undefined} data-tab={k}>
                    {t(`filter.${k}`)}
                    {n !== null ? (
                      <>
                        <span className={a.statusTabCount} data-tone={k === "new" ? "attention" : "plain"} aria-hidden="true" data-testid="admin-tab-count">
                          {n}
                        </span>
                        <span className={a.srOnly}>{t("tabCount", { n })}</span>
                      </>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <TabIntoView navId={TABS_ID} current={tab} />
        <p className={a.listHint}>{hint}</p>

        {items.length === 0 && !showPast ? (
          tab === "all" ? (
            <p className={a.empty}>{t("emptyAll")}</p>
          ) : (
            <div className={a.empty}>
              <p>{tab === "new" ? t("emptyNew") : t("empty")}</p>
              <Link className={a.emptyAction} href={listHref("all")}>
                {t("clearFilter")}
              </Link>
            </div>
          )
        ) : (
          <div className={a.inqTable} data-layout="table" id={LIST_ID}>
            <div className={a.inqHead} aria-hidden="true" data-testid="admin-list-head">
              <span className={a.inqHeadCells}>
                <span>{t("col.status")}</span>
                <span>{t("col.customer")}</span>
                <span>{t("col.route")}</span>
                <span>{t("col.depart")}</span>
                <span>{t("col.vehicle")}</span>
                <span>{t("col.received")}</span>
              </span>
              <span className={a.inqHeadCall}>{t("col.call")}</span>
            </div>
            {showPast && past !== null ? (
              <section className={a.inqGroup} aria-labelledby="admin-list-group-past" data-testid="admin-list-past">
                <h2 id="admin-list-group-past" className={a.groupHead} data-group="past">
                  {past.ok ? t("past.title", { n: past.total }) : t("past.unknown")}
                </h2>
                {past.ok ? (
                  <>
                    <p className={a.groupNote}>
                      {t("past.hint")}
                      {past.total > past.items.length ? ` ${t("past.recent", { n: past.items.length })}` : null}
                    </p>
                    <ul className={a.inqList}>{past.items.map((r) => reservationRow(r, null, ctx))}</ul>
                  </>
                ) : null}
              </section>
            ) : null}
            {showPast ? (
              <section className={a.inqGroup} aria-labelledby="admin-list-group-upcoming">
                <h2 id="admin-list-group-upcoming" className={a.groupHead} data-group="upcoming">
                  {t("group.upcoming")}
                </h2>
                {items.length === 0 ? (
                  <p className={a.groupNote}>{t("upcomingEmpty")}</p>
                ) : (
                  <ul className={a.inqList}>{items.map((row, i) => reservationRow(row, i, ctx))}</ul>
                )}
              </section>
            ) : (
              groups.map((g) =>
                g.kind === "plain" ? (
                  <ul key="plain" className={a.inqList} aria-label={t("listLabel")}>
                    {g.items.map((it) => reservationRow(it.row, it.index, ctx))}
                  </ul>
                ) : (
                  <section key={g.kind} className={a.inqGroup} aria-labelledby={`admin-list-group-${g.kind}`}>
                    <h2 id={`admin-list-group-${g.kind}`} className={a.groupHead} data-group={g.kind} data-tone={g.kind === "overdue" ? "urgent" : undefined}>
                      {g.kind === "overdue" ? (
                        <svg className={a.groupIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d={ALERT_PATH} />
                        </svg>
                      ) : null}
                      {t(`group.${g.kind}`)}
                    </h2>
                    <ul className={a.inqList}>{g.items.map((it) => reservationRow(it.row, it.index, ctx))}</ul>
                  </section>
                ),
              )
            )}
          </div>
        )}

        {anyRows ? (
          <div className={a.moreRow}>
            <LoadMore nextHref={nextHref} page={page} listId={LIST_ID} label={t("more", { n: LIST_PAGE_SIZE })} pendingLabel={t("moreLoading")} />
            {hasMore && nextHref === null ? <p className={a.listHint}>{t("limitNote", { n: LIST_PAGE_SIZE * MAX_LIST_PAGES })}</p> : null}
            <p className={a.privacyNote}>{t("privacyNote")}</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
