import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { formatAdminDate } from "@/components/admin/admin-date";
import { getAdminDateLabels } from "@/components/admin/adminDateLabels";
import { AdminBanner } from "@/components/admin/AdminBanner";
import {
  homeLede,
  monthWindow,
  newSplit,
  overdueCutoff,
  sendBanner,
  sendCard,
  tripDatesLine,
  tripDays,
  upcomingWindow,
} from "@/components/admin/dashboard";
import { hubLineValues, noticesLine, popupsLine, routesLine, type HubLine } from "@/components/admin/hub";
import { NavBadgeReport } from "@/components/admin/NavBadgeReport";
import { kstParts, listHref } from "@/components/admin/reservation-list";
import { fillTemplate, relativeDayText, reservationRow, tripRow, type ReservationRowContext } from "@/components/admin/reservationRow";
import { getReservationRowLabels } from "@/components/admin/reservationRowLabels";
import { dashUnits, segments, splitSegments } from "@/components/admin/segments";
import { getStatusBadgeLabels } from "@/components/admin/statusBadgeLabels";
import { navBadge } from "@/components/admin/tabs";
import { routing } from "@/i18n/routing";
import { listAdminNotices } from "@/lib/admin/notices";
import { HOME_ALERT_LIST_HREF, HOME_ALERT_WINDOW_DAYS, HOME_WAITING_LIST_HREF, getHomeSendAlerts } from "@/lib/admin/notifications";
import { listAdminPopups, popupState } from "@/lib/admin/popups";
import {
  countConfirmedDeparting,
  countCreatedBetween,
  countNewByIntake,
  countNewReservations,
  countOverdueNew,
  listConfirmedDepartDates,
  listConfirmedDeparting,
  listReservations,
} from "@/lib/admin/reservations";
import { listAdminRoutes } from "@/lib/admin/routes";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getVehicles } from "@/lib/queries";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin — 관리 홈 대시보드 (P5-21 · 시안 docs/handoff/2026-09-27-admin-ux #home · 제안서 ⑤-1 · ⑦ 1-1 · ④ 원칙 1 "오늘 할 일이 첫 화면이다").
 * 로그인하면 매번 도착하는 첫 화면이다(lib/auth/adminLogin.ts · 콜백).
 *
 * 위에서 아래로: 날짜(KST) + 한 줄 요약 · (넓은 화면) [새 접수 확인하기] → 최근 7일 고객 문자 실패가 있으면 배너 하나(role=alert) →
 * 할 일 카드 4장(카드 전체가 링크) → 새 접수 미리보기(목록과 같은 행 · 오래 기다린 순 최대 5건) · 다가오는 운행 7일 · 홈페이지 점검 · 이번 달 접수·확정.
 * 값 정의는 components/admin/dashboard.ts 헤더와 tests/admin-dashboard.test.ts 가 잠근다:
 *   새 접수 = 메뉴 배지와 **같은 함수**(countNewReservations — 요청 범위 memo 라 레이아웃과 한 요청이면 같은 값) ·
 *   답이 늦은 접수 = 새 접수 중 72시간이 **넘은** 것(배지·0022 와 같은 경계) ·
 *   문자 발송 = **최근 7일 고객 문자 실패**(getHomeSendAlerts — 수정 라운드 · 컨트롤러 결정 P1-2. 사장님 쪽 알림 실패는 카드의 작은 줄로만 ·
 *   배너는 고객 문자 실패로만 뜬다 · 기간을 문장에 적는다 · 누르면 발송 기록의 '실패 · 7일' 목록) · 실패가 없어도 오래 대기 중인 고객 문자가 있으면
 *   "대기 중 n건 · 문자 발송이 아직 켜지지 않았을 수 있어요"(P5-22 — 데이터로 판단 · env 를 읽지 않는다 · 배너 없음 · 누르면 '대기 · 7일' 목록 —
 *   수정 라운드 리뷰 P2-1) · 세 집계는 서로를 끌어내리지 않는다(리뷰 P2-2 — 부가 집계를 모르면 그 칸만 모름, 실패 배너는 산다) ·
 *   이번 주 운행 = 확정 중 출발이 KST 오늘 00:00 ~ 7일 뒤 00:00(날짜 줄은 창 안의 **모든** 출발에서 — 리뷰 P2-2) ·
 *   이번 달 = 통계 화면 '이번 달' 과 같은 기간(무거운 0022 집계를 부르지 않는다).
 * 숫자는 전부 DB 가 지금 센 값이다(실증 문제 없음 — CLAUDE.md §3). 가격은 계산하지 않는다(대표 노선은 금액이 비어 있는지만 센다).
 *
 * (protected) 그룹 안이라 레이아웃이 이미 게이트를 걸었지만 **여기서도 본문 첫 문장으로 무조건 다시 부른다** (P5-3 리뷰 F2 ·
 * scripts/check-admin-gate.mjs 규칙 2·4). 조회는 그 **뒤에** 서로 기다리지 않고 한 번에(Promise.allSettled) 나간다(P5-18).
 * 하나가 실패하면 **그 카드(줄)만** "지금은 불러오지 못했어요" — 모르는 것을 "0건"·"이상 없음" 이라 하지 않는다(P5-20 허브와 같은 규칙).
 * 조회는 전부 세션 클라이언트 + 0009 RLS 다(서비스 롤 금지 · 캐시하지 않는다). 이 폴더의 loading 은 (protected)/loading.tsx 가 맡는다(규칙 7·8).
 *
 * 개인정보(미리보기·다가오는 운행의 이름·번호)는 **서버가 그린다** — 행은 함수(reservationRow · tripRow)로 그리고 어떤 부품의 props 에도 싣지 않는다.
 * 클라이언트 부품은 배너(문구·주소)와 배지 보고(숫자·문장)뿐이다. 새 접수 수는 메뉴 배지에 보고한다(리뷰 P2-10 — 두 숫자 금지).
 *
 * 0건 문장은 거짓이 없어야 한다 — "들어오면 문자로 알려 드려요" 는 쓰지 않았다: 사장님 알림 번호(OWNER_PHONE)가 아직 없어 지금은 알림이 가지 않는다
 * (docs/ops/admin-manual.md "지금 아직 안 되는 것"). 대신 "새로 들어오면 여기에 보여요" — 이 화면이 늘 세는 것은 사실이다.
 */

/** 새 접수 줄(목록과 같은 행)의 최대 건수. */
const QUEUE_LIMIT = 5;
const TRIPS_LIMIT = 20;

/** 표시용 차량 라벨 — 접수 목록과 같은 규약(읽지 못하면 빈 표 → slug 로 떨어진다). */
async function vehicleLabels(): Promise<Map<string, string>> {
  try {
    const vehicles = await getVehicles();
    return new Map(vehicles.map((v): [string, string] => [v.slug, v.nameKo]));
  } catch {
    return new Map();
  }
}

const ICON = {
  chevron: "M9 5l7 7-7 7",
  alert: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5v5.5M12 16.5v.3",
  check: "M5 12.5l4.5 4.5L19 7.5",
  popups: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M8 8h8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z",
  notices: "M4 9v6h3l7 4V5L7 9z M17.5 9.5a3.5 3.5 0 0 1 0 5",
  routes: "M8.5 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M20.5 6a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5",
} as const;

function Icon({ name, className }: { name: keyof typeof ICON; className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICON[name]} />
    </svg>
  );
}

export default async function AdminHomePage() {
  await requireAdmin();

  const now = new Date();
  const today = kstParts(now);
  const upcoming = upcomingWindow(now);
  const month = monthWindow(now);

  const [t, tTabs, tHub, badgeLabels, rowLabels, dateLabels] = await Promise.all([
    getTranslations({ locale: routing.defaultLocale, namespace: "admin" }),
    getTranslations({ locale: routing.defaultLocale, namespace: "admin.tabs" }),
    getTranslations({ locale: routing.defaultLocale, namespace: "admin.hub" }),
    getStatusBadgeLabels(),
    getReservationRowLabels(),
    getAdminDateLabels(),
  ]);

  const [newCount, split, overdue, alerts, tripCount, trips, tripDates, queue, popups, notices, routes, monthCounts, vehicles] = await Promise.allSettled([
    countNewReservations(),
    countNewByIntake(),
    countOverdueNew(overdueCutoff(now)),
    getHomeSendAlerts(),
    countConfirmedDeparting(upcoming),
    listConfirmedDeparting(upcoming, TRIPS_LIMIT),
    listConfirmedDepartDates(upcoming),
    listReservations({ status: "new", limit: QUEUE_LIMIT }),
    listAdminPopups(),
    listAdminNotices(),
    listAdminRoutes(),
    countCreatedBetween(month),
    vehicleLabels(),
  ]);

  const ctx: ReservationRowContext = {
    now,
    labels: rowLabels,
    badgeLabels,
    vehicles: vehicles.status === "fulfilled" ? vehicles.value : new Map(),
  };
  const unknown = t("home.unknown");
  const weekday = (i: number) => rowLabels.weekdays[i] ?? "";
  const shortDate = (d: { month: number; day: number; weekday: number }) => fillTemplate(rowLabels.dateShort, { month: d.month, day: d.day, weekday: weekday(d.weekday) });

  // 한 줄 요약
  const lede = homeLede(newCount, overdue);
  const ledeText =
    lede.kind === "unknown"
      ? t("home.lede.unknown")
      : lede.kind === "none"
        ? t("home.lede.none")
        : lede.kind === "waiting"
          ? t("home.lede.waiting", { n: lede.n })
          : t("home.lede.overdue", { n: lede.n, m: lede.m });

  // 배너 — 최근 7일 고객 문자 실패만(사장님 쪽 알림 실패·모름은 배너가 아니다). 기간을 문장에 적는다
  const bannerCount = sendBanner(alerts);
  const bannerText = bannerCount === null ? null : t("home.banner", { days: HOME_ALERT_WINDOW_DAYS, n: bannerCount });

  // 카드
  const splitValue = newSplit(newCount, split);
  const notify = sendCard(alerts);
  const days = trips.status === "fulfilled" ? tripDays(trips.value, now) : [];
  // 이번 주 운행 카드의 날짜 줄 — 패널의 앞 20건이 아니라 창 안의 **모든** 출발에서(리뷰 P2-2). 상한을 넘으면(모자라면) 그리지 않는다
  const dateDays =
    tripDates.status === "fulfilled" && !tripDates.value.capped ? tripDays(tripDates.value.departAts.map((depart_at) => ({ depart_at })), now) : null;
  const dates = dateDays === null ? null : tripDatesLine(dateDays, 3);
  // 대기 중(P5-22)은 새 접수와 같은 톤 — 실패(급함)도 이상 없음도 아니다
  const notifyTone = notify.kind === "ok" ? "ok" : notify.kind === "problems" ? "urgent" : notify.kind === "waiting" ? "attention" : "plain";
  // 카드가 이어지는 목록 = 카드가 말한 것(수정 라운드 · 리뷰 P2-1) — 대기 중은 '대기 · 7일', 그 밖(확인 필요 · 이상 없음 · 모름)은 '실패 · 7일'
  const notifyHref = notify.kind === "waiting" ? HOME_WAITING_LIST_HREF : HOME_ALERT_LIST_HREF;

  // 홈페이지 점검 — 허브(/admin/site)와 같은 조회 · 같은 말(components/admin/hub.ts)
  const todayKey = today?.dateKey ?? "";
  const popupLine = popupsLine(popups, (row) => popupState(row, todayKey) === "live");
  const noticeLine = noticesLine(notices);
  const routeLine = routesLine(routes);
  // 날짜는 관리자 날짜 틀("마지막 게시일 9월 27일 (일)" — P5-23 라운드 2 A-3) · 줄은 조각 사이에서만 꺾인다(C-14)
  const hubText = (line: HubLine) => segments(splitSegments(tHub(line.key, hubLineValues(line, (d) => formatAdminDate(d, now, dateLabels, { keep: true })))));

  return (
    <main className={q.main} data-testid="admin">
      <div className={a.pageWrap}>
        <header className={a.homeHead}>
          <div className={a.homeHeadText}>
            {today !== null ? <p className={a.eyebrow}>{t("dates.full", { month: today.month, day: today.day, weekday: weekday(today.weekday) })}</p> : null}
            <h1 className={q.title}>{t("home.title")}</h1>
            <p className={a.lede}>{ledeText}</p>
          </div>
          <Link className={`${a.btnPrimary} ${a.btnLink} ${a.desktopOnly}`} href={listHref("new")}>
            {t("home.reservationsLink")}
          </Link>
        </header>
        {newCount.status === "fulfilled" ? <NavBadgeReport badge={navBadge(newCount.value, (n) => tTabs("newCount", { n }))} at={now.getTime()} /> : null}

        <AdminBanner text={bannerText} action={{ href: HOME_ALERT_LIST_HREF, label: t("home.bannerLink") }} testId="admin-home-banner" />

        <ul className={a.todoGrid} aria-label={t("home.cardsLabel")}>
          <li>
            <Link className={a.todo} href={listHref("new")} data-card="new" data-tone={newCount.status === "fulfilled" && newCount.value > 0 ? "attention" : "plain"}>
              <span className={a.todoLabel}>
                <span className={a.todoDot} aria-hidden="true" />
                {t("home.card.new")}
              </span>
              {newCount.status === "fulfilled" ? <span className={a.todoValue}>{t("home.count", { n: newCount.value })}</span> : <span className={a.todoUnknown}>{unknown}</span>}
              {splitValue !== null && newCount.status === "fulfilled" && newCount.value > 0 ? (
                <span className={a.todoSub}>{t("home.card.newSplit", { quick: splitValue.quick, wizard: splitValue.wizard })}</span>
              ) : newCount.status === "fulfilled" && newCount.value === 0 ? (
                <span className={a.todoSub}>{t("home.card.newNone")}</span>
              ) : null}
              <Icon name="chevron" className={a.todoArrow} />
            </Link>
          </li>
          <li>
            <Link className={a.todo} href={listHref("new")} data-card="overdue" data-tone={overdue.status === "fulfilled" && overdue.value > 0 ? "urgent" : "plain"}>
              {/* 카드 이름은 360px 이상에서 한 줄(화살표는 이름 폭을 가져가지 않는다 · 좁은 카드는 글자를 조금 줄인다 — P5-23 라운드 3).
                  더 좁아 꺾여야 하면 앞에서부터 채워 "답이 늦은 / 접수"(admin.module.css .todoLabel — text-wrap: wrap) */}
              <span className={a.todoLabel}>
                <Icon name="alert" className={a.todoIcon} />
                {t("home.card.overdue")}
              </span>
              {overdue.status === "fulfilled" ? (
                <>
                  <span className={a.todoValue}>{t("home.count", { n: overdue.value })}</span>
                  <span className={a.todoSub}>{overdue.value > 0 ? t("home.card.overdueSub") : t("home.card.overdueNone")}</span>
                </>
              ) : (
                <span className={a.todoUnknown}>{unknown}</span>
              )}
              <Icon name="chevron" className={a.todoArrow} />
            </Link>
          </li>
          <li>
            <Link className={a.todo} href={notifyHref} data-card="notify" data-tone={notifyTone}>
              <span className={a.todoLabel}>{t("home.card.notify")}</span>
              {notify.kind === "ok" ? (
                <>
                  <span className={a.todoValue} data-kind="ok">
                    <Icon name="check" className={a.todoOkIcon} />
                    {t("home.card.notifyOk")}
                  </span>
                  <span className={a.todoSub}>{t("home.card.notifyOkSub", { days: HOME_ALERT_WINDOW_DAYS })}</span>
                </>
              ) : notify.kind === "problems" ? (
                <>
                  <span className={a.todoValue} data-kind="problem">
                    {t("home.card.notifyProblem")}
                  </span>
                  <span className={a.todoSub}>{t("home.card.notifyProblemSub", { days: HOME_ALERT_WINDOW_DAYS, n: notify.customer })}</span>
                </>
              ) : notify.kind === "waiting" ? (
                <>
                  <span className={a.todoValue} data-kind="waiting">
                    {t("home.card.notifyWaiting", { n: notify.waiting })}
                  </span>
                  {/* 덧말은 원인에 따라(P5-23 리뷰 P1-1) — 한 번도 못 보낸 것이 있으면 발송이 꺼졌을 수 있다 · 시도는 했으면 다음 발송 때 다시 보낸다 */}
                  <span className={a.todoSub}>{notify.cause === "neverTried" ? t("home.card.notifyWaitingSub") : t("home.card.notifyOverdueSub")}</span>
                </>
              ) : (
                <span className={a.todoUnknown}>{unknown}</span>
              )}
              {notify.kind === "problems" && notify.waiting !== null && notify.waiting > 0 ? (
                <span className={a.todoMinor}>{t("home.card.notifyWaitingMinor", { n: notify.waiting })}</span>
              ) : null}
              {/* 사장님 쪽 실패 수 — 모르면 0 이라 하지 않고 그렇다고 적는다(수정 라운드 · 리뷰 P2-2) */}
              {notify.kind !== "unknown" && notify.owner === null ? <span className={a.todoMinor}>{t("home.card.notifyOwnerUnknown")}</span> : null}
              {notify.kind !== "unknown" && notify.owner !== null && notify.owner > 0 ? (
                // 줄표 앞뒤가 한 덩어리씩 — "…1건 — / 발송 기록에서 확인"(줄표가 줄 머리에 서거나 "발송 / 기록" 으로 갈라지지 않는다 · 라운드 3)
                <span className={a.todoMinor}>{dashUnits(t("home.card.notifyOwner", { n: notify.owner }))}</span>
              ) : null}
              <Icon name="chevron" className={a.todoArrow} />
            </Link>
          </li>
          <li>
            <Link className={a.todo} href={listHref("confirmed")} data-card="trips" data-tone="plain">
              <span className={a.todoLabel}>{t("home.card.trips")}</span>
              {tripCount.status === "fulfilled" ? (
                <>
                  <span className={a.todoValue}>{t("home.count", { n: tripCount.value })}</span>
                  {tripCount.value === 0 ? (
                    <span className={a.todoSub}>{t("home.card.tripsNone")}</span>
                  ) : dates !== null && dates.shown.length > 0 ? (
                    <span className={a.todoSub}>
                      {/* 날짜 하나가 한 조각(구분점은 같은 줄의 두 날짜 사이에만 — C-14 · 라운드 3) · "외 N일" 은 마지막 날짜와 한 덩어리 */}
                      {segments(
                        dates.shown.map((d, i) =>
                          i === dates.shown.length - 1 && dates.more > 0 ? `${shortDate(d)} ${t("home.card.tripsMore", { n: dates.more })}` : shortDate(d),
                        ),
                      )}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className={a.todoUnknown}>{unknown}</span>
              )}
              <Icon name="chevron" className={a.todoArrow} />
            </Link>
          </li>
        </ul>

        <div className={a.homeCols}>
          <div className={a.homeCol}>
            <section className={a.homeSec} aria-labelledby="admin-home-queue-title" data-testid="admin-home-queue">
              <div className={a.secHead}>
                <h2 id="admin-home-queue-title" className={a.secTitle}>
                  {t("home.queue.title")}
                  {newCount.status === "fulfilled" ? <span className={a.secCount}> {newCount.value}</span> : null}
                </h2>
                <Link className={a.secLink} href={listHref("new")}>
                  {t("home.queue.all")}
                  <Icon name="chevron" className={a.secLinkIcon} />
                </Link>
              </div>
              {queue.status !== "fulfilled" ? (
                <div className={a.panel}>
                  <p className={a.panelNote}>{unknown}</p>
                </div>
              ) : queue.value.items.length === 0 ? (
                <div className={a.panel}>
                  <p className={a.panelNote}>{t("home.queue.none")}</p>
                </div>
              ) : (
                <ul className={a.inqList} aria-label={t("home.queue.title")}>
                  {queue.value.items.map((row, i) => reservationRow(row, i, ctx))}
                </ul>
              )}
            </section>
          </div>

          <div className={a.homeCol}>
            <section className={a.homeSec} aria-labelledby="admin-home-trips-title" data-testid="admin-home-trips">
              <div className={a.secHead}>
                <h2 id="admin-home-trips-title" className={a.secTitle}>
                  {t("home.trips.title")} <span className={a.secMuted}>{t("home.trips.range")}</span>
                </h2>
              </div>
              <div className={a.panel}>
                {trips.status !== "fulfilled" ? (
                  <p className={a.panelNote}>{unknown}</p>
                ) : days.length === 0 ? (
                  <p className={a.panelNote}>{t("home.trips.none")}</p>
                ) : (
                  days.map((d) => (
                    <div className={a.tripDay} key={d.dateKey}>
                      <h3 className={a.tripDayHead}>
                        {fillTemplate(rowLabels.dayHead, { month: d.month, day: d.day, weekday: weekday(d.weekday) })}{" "}
                        <span className={a.secMuted}>{relativeDayText(d.diff, rowLabels)}</span>
                      </h3>
                      <ul className={a.tripList}>{d.items.map((row) => tripRow(row, ctx))}</ul>
                    </div>
                  ))
                )}
                {trips.status === "fulfilled" && tripCount.status === "fulfilled" && tripCount.value > trips.value.length ? (
                  <p className={a.panelNote}>
                    {t("home.trips.more", { n: tripCount.value, shown: trips.value.length })}{" "}
                    <Link className={a.inlineLink} href={listHref("confirmed")}>
                      {t("home.trips.all")}
                    </Link>
                  </p>
                ) : null}
              </div>
            </section>

            <section className={a.homeSec} aria-labelledby="admin-home-check-title" data-testid="admin-home-check">
              <div className={a.secHead}>
                <h2 id="admin-home-check-title" className={a.secTitle}>
                  {t("home.check.title")}
                </h2>
              </div>
              <ul className={a.panel}>
                <li className={a.checkItem} data-check="popups">
                  <Icon name="popups" className={a.checkIcon} />
                  <p className={a.checkText}>
                    <span className={a.checkName}>{t("home.check.popups")}</span>
                    <span className={a.checkStatus}>{hubText(popupLine)}</span>
                  </p>
                  {popupLine.key === "popups.noneLive" ? (
                    <Link className={a.checkLink} href="/admin/popups#popup-title">
                      {t("home.check.popupsMake")}
                    </Link>
                  ) : (
                    <Link className={a.checkLink} href="/admin/popups">
                      {t("home.check.popupsView")}
                    </Link>
                  )}
                </li>
                <li className={a.checkItem} data-check="notices">
                  <Icon name="notices" className={a.checkIcon} />
                  <p className={a.checkText}>
                    <span className={a.checkName}>{t("home.check.notices")}</span>
                    <span className={a.checkStatus}>{hubText(noticeLine)}</span>
                  </p>
                  <Link className={a.checkLink} href="/admin/notices#notice-title">
                    {t("home.check.noticesWrite")}
                  </Link>
                </li>
                <li className={a.checkItem} data-check="routes" data-warn={routeLine.key === "routes.noPrice" ? "true" : undefined}>
                  <Icon name="routes" className={a.checkIcon} />
                  <p className={a.checkText}>
                    <span className={a.checkName}>{t("home.check.routes")}</span>
                    <span className={a.checkStatus}>{hubText(routeLine)}</span>
                  </p>
                  <Link className={a.checkLink} href="/admin/routes">
                    {routeLine.key === "routes.noPrice" ? t("home.check.routesCheck") : t("home.check.routesView")}
                  </Link>
                </li>
              </ul>
            </section>

            <Link className={a.miniStat} href="/admin/stats" data-testid="admin-home-month">
              <span>
                {monthCounts.status === "fulfilled"
                  ? t("home.month.line", { intake: monthCounts.value.total, confirmed: monthCounts.value.confirmed })
                  : t("home.month.unknown")}
              </span>
              <span className={a.secLink}>
                {t("home.month.link")}
                <Icon name="chevron" className={a.secLinkIcon} />
              </span>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
