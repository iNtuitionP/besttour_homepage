import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { formatAdminDate } from "@/components/admin/admin-date";
import { getAdminDateLabels } from "@/components/admin/adminDateLabels";
import { ReservationActions } from "@/components/admin/ReservationActions";
import { ReservationProcess } from "@/components/admin/ReservationProcess";
import { SheetTrigger } from "@/components/admin/SheetTrigger";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { dayParts, detailPhoneText, receivedAt, smsHref, splitNameTemplate, type DayParts } from "@/components/admin/reservation-detail";
import { backToListHref, elapsedSince, stayNights, telHref } from "@/components/admin/reservation-list";
import { PROCESS_REGION_ATTR } from "@/components/admin/reservation-panel";
import { CUSTOMER_NAME_ELEMENT_ID, fillTemplate, type ReservationSummary } from "@/components/admin/reservation-sheet";
import { getReservationActionLabels } from "@/components/admin/reservationActionLabels";
import { getReservationRowLabels } from "@/components/admin/reservationRowLabels";
import { reservationBadge } from "@/components/admin/status-badge";
import { segments } from "@/components/admin/segments";
import { getStatusBadgeLabels } from "@/components/admin/statusBadgeLabels";
import { routing } from "@/i18n/routing";
import { LEGACY_CONTACT_METHODS, LEGACY_PAYMENT_METHODS, getReservation, isUuid, type ReservationDetailRow } from "@/lib/admin/reservations";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { PURPOSES, isLocationCode, locationLabelKo } from "@/lib/codes";
import { getVehicles } from "@/lib/queries";
import { TRIP_TYPES } from "@/lib/reservation-check/view";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/reservations/[id] — 접수 상세 (P5-3 → P5-19 확인 시트 → P5-22 재배치 · 시안 docs/handoff/2026-09-27-admin-ux #detail · 제안서 ⑤-3 · ⑦ 1-2).
 *
 * 경로에는 uuid 만 들어간다(URL 에 개인정보 금지) — 쿼리에는 들어온 목록의 탭·쪽만(`?from=` · `&page=` · P5-22 B-2 — "← 접수 목록" 이 그리로 돌아간다).
 * 목록과 같은 이유로 여기서도 **무조건** requireAdmin() 을 다시 부르고(리뷰 F1 — 조건부 게이트는 게이트가 아니다), 읽기는 세션 클라이언트 +
 * 0009 RLS 다(서비스 롤 금지 — ADR-2). 캐시하지 않는다.
 *
 * 배치(P5-22 · 시안 #detail)
 *   머리  배지 줄(상태 + 간편이면 "간편 접수 · 전화 확인 필요") · 제목 "{이름} 님" · 한 줄 메타 "{접수 시각} 접수 ({경과}) · {홈 간편 견적/상세 접수} · 접수번호 {코드}".
 *   DOM 순서는 **연락·처리 → 본문**이다 — 휴대폰 한 열에서는 연락 카드가 맨 위다. ≥1024px 에서는 본문 2/3 + 오른쪽 1/3 고정 열(sticky)로,
 *   오른쪽 열(연락 · 처리 카드)이 격자의 둘째 칸에 선다(admin.module.css `.detailCols`).
 *   본문: 운행 카드(큰 구간 · 가는 날 · 오는 날 · 기간 · 인원 · 출발 시각 · 차량 · 왕복·편도 · 여행 구분 — 간편 접수의 미정 칸은 "전화로 확인") ·
 *   (옛 상세 접수) 접수 조건 · 요청 사항(있으면 메모 위에 따로) · 처리 영역(ReservationActions — "전화로 확인할 것" 체크리스트 · 메모 카드 · 시트 · 토스트) ·
 *   접수 기록(동의 · 보관 — <details> 접힘, 라벨은 기존 admin.detail.field.* 그대로) · 휴대폰 맨 아래 취소(확정 버튼과 멀리).
 *   <1024px: 셸의 위 제목줄·아래 탭 바를 숨기고(`.shell:has(.detailPage)`) 이 화면의 위 제목줄(← · 접수 상세 · ⋯ 취소)과
 *   아래 고정 행동 바([전화] [확정하기] · 확정 뒤 [전화] [문자 보내기])를 둔다. 스크롤 여백은 행동 바 높이(포커스·배너가 바 뒤로 숨지 않게).
 *
 * 개인정보(이름 · 번호 · 메일 · 요청 사항)는 **이 파일 안에서 그린다** — 어떤 부품의 props 에도 싣지 않는다(P3-5 리뷰 N-2: dev 는 서버 컴포넌트
 * props 를 HTML 에 싣는다). 그래서 이 파일에는 행을 받는 지역 부품이 없고(함수로 풀어 그린다), 클라이언트 섬은 셋뿐이다:
 *   - ReservationActions — uuid · 상태 · 사장님 메모 · 운행 요약(구간·날짜·인원) · 카탈로그 라벨(P5-19 그대로)
 *   - SheetTrigger(진입 버튼 — 처리 카드 · 행동 바의 [확정하기] · 위 제목줄 ⋯ · 맨 아래) — uuid · 시트 종류 · 문구 · 모양 · testid
 *   - ReservationProcess 는 서버 부품이다(uuid · 상태 · 라벨) — 안에 진입 버튼을 둔다.
 * 전화·문자 링크와 번호, 행동 바의 [전화]는 서버가 그린다(브리프 규칙 — 행동 바는 서버 렌더 + 확정 버튼만 클라이언트 섬).
 * 확인 시트 제목의 **고객 이름**(P5-19)은 props 로 내리지 않는다: 제목의 이름 부분에 `CUSTOMER_NAME_ELEMENT_ID` 를 달아 두면 시트가 열릴 때
 * 그 글자를 읽는다(tests/admin-confirm-sheet-page.test.ts · tests/admin-detail.test.ts 가 잠근다).
 *
 * 상세는 **전화를 거는 화면**이라 번호를 가리지 않는다(목록·관리 홈은 가린다 — 매뉴얼 3장). 국내 휴대전화는 읽기 좋은 국내 표기로 보인다.
 * `privacy_consent_at`·`retention_until`(언제 동의했고 언제 파기되는지 — 파기 배치 P1-5 가 그 시각을 본다) ·
 * `withdrawal_consent_at`(청약철회 제한 확인 — 0021 · P1-7: 분쟁 때 증거)은 접수 기록에 있다. 0021 적용 순간에 있던 접수는
 * `withdrawal_consent_legacy = true` 이고 값이 없다 — "기록 없음(동의 기록 도입 전 접수)"(날짜를 박지 않는다 — P1-7 R2).
 * legacy 가 아니면서 값이 없는 행은 0021 의 CHECK 가 만들지 못한다 — 만약 보이면 "—" 로 둔다(지어내지 않는다).
 *
 * 간편 접수(P3-8 · 0023 intake='quick'): 가는 날·오는 날은 **날짜만**(저장된 00:00 은 자리값) · 출발 시각·차량·왕복·편도·여행 구분은
 * "전화로 확인"(전화로 확인할 칸이 그 줄들이다) — 손님이 고르지 않은 값을 지어내 보이지 않는다. 도착일이 출발일과 같으면 저장값은 null 이다(오는 날 = 가는 날).
 * 여러 날 운행의 기간("1박 2일")은 P5-21 목록과 같은 규칙이다(reservation-list.ts stayNights — 여러 날일 때만).
 * 값 라벨(여행 구분·연락/결제 방법)은 옛 위저드가 쓰던 문구를 그대로 admin.labels.* 로 옮긴 것이다(P3-8). 운행 구분은 예약확인과 같은 reservationCheck.tripType.* 다.
 *
 * 개발용 우회 경로는 없다(목록 화면 헤더 참조 — P5-3 독립 리뷰에서 제거).
 */
type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const isPurpose = (c: string): boolean => (PURPOSES as readonly string[]).includes(c);
const isTripType = (c: string): boolean => (TRIP_TYPES as readonly string[]).includes(c);
const isContact = (c: string): boolean => (LEGACY_CONTACT_METHODS as readonly string[]).includes(c);
const isPayment = (c: string): boolean => (LEGACY_PAYMENT_METHODS as readonly string[]).includes(c);
const placeLabel = (code: string): string => (isLocationCode(code) ? locationLabelKo(code) : code);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** jsonb 경유지 — 문자열 배열이 아니면 빈 목록으로 본다(표시 계층은 DB 모양을 신뢰하지 않는다). */
function waypointLabels(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").map(placeLabel) : [];
}

/** 차량 slug → 표시 이름. 읽지 못하면 빈 표 — 화면은 slug 로 떨어진다(목록 화면과 같은 규약). */
async function vehicleNames(): Promise<Map<string, string>> {
  try {
    const vehicles = await getVehicles();
    return new Map(vehicles.map((v): [string, string] => [v.slug, v.nameKo]));
  } catch {
    return new Map();
  }
}

/** 운행 날짜 — "10월 10일 (토)"(해가 다르면 연도까지 · admin.dates.day / dayYear). */
function dayLabel(p: DayParts, tpl: { day: string; dayYear: string; weekdays: readonly string[] }): string {
  const weekday = tpl.weekdays[p.weekday] ?? "";
  return p.withYear
    ? fillTemplate(tpl.dayYear, { year: p.year, month: p.month, day: p.day, weekday })
    : fillTemplate(tpl.day, { month: p.month, day: p.day, weekday });
}

/** 선 아이콘(24 격자) — 글자가 늘 함께 붙는 장식(aria-hidden). 시안의 아이콘과 같은 모양. */
const ICON = {
  left: "M15 5l-7 7 7 7",
  user: "M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M4 21a8 8 0 0 1 16 0",
  phone: "M6.6 3.5h2.6l1.5 4-2 1.3a11 11 0 0 0 6.5 6.5l1.3-2 4 1.5v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z",
  msg: "M4 5h16v11H9l-5 4z",
  bus: "M6 3h12a2 2 0 0 1 2 2v13H4V5a2 2 0 0 1 2-2z M4 11h16 M7 21v-3 M17 21v-3 M7.5 14.5h.01 M16.5 14.5h.01",
  note: "M4 5h16v11H9l-5 4z M8 10h8",
  chevron: "M6 9l6 6 6-6",
} as const;

function icon(name: keyof typeof ICON, className: string) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICON[name]} />
    </svg>
  );
}

/**
 * 함수 시간 한도(P4-7 수정 라운드 3 · 리뷰 P2-3). 이 화면의 확정 버튼(서버액션)이 응답 뒤에 즉시 발송(lib/notify/inline.ts)을 돌린다 —
 * 한도가 즉시 발송 마감(40초)보다 짧으면 send 와 markSent 사이에서 잘려 행이 다시 집히고 **손님이 두 번 받는다.**
 * 60초 = Vercel 문서(2026-08-24 판)상 Hobby 가 Fluid compute 에서 받는 값(기본·최대 300초)이자 Fluid 가 아닌 Hobby 의 최대치(60초) —
 * 어느 설정이든 받아들여지는 가장 큰 공통값이다. tests/notify-inline.test.ts §7 이 잠근다.
 */
export const maxDuration = 60;

export default async function AdminReservationDetailPage({ params, searchParams }: { params: Params; searchParams?: SearchParams }) {
  await requireAdmin();

  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.detail" });
  const tRoot = await getTranslations({ locale: routing.defaultLocale });
  const { id } = await params;
  // "← 접수 목록" — 들어온 탭·쪽으로(B-2). 주소의 from·page 는 목록 파서(관대)로 읽는다 — 모르는 값은 기본 탭 첫 쪽
  const backHref = backToListHref(searchParams === undefined ? undefined : await searchParams);

  // uuid 가 아닌 경로 값은 DB 를 부르지 않고 "찾을 수 없음" 으로 (getReservation 은 그런 값에 throw 한다).
  // 예약 한 건과 차량 이름표는 서로 기다릴 이유가 없어 동시에 읽는다(P5-18 — 게이트를 통과한 뒤에만). 간편 접수(차종 미정)면
  // 이름표를 쓰지 않지만, 그것을 알려면 예약을 먼저 받아야 해서 기다리는 쪽이 더 비싸다(작은 공개 표 한 번 · anon + RLS).
  const [row, vehicles]: [ReservationDetailRow | null, Map<string, string>] = isUuid(id)
    ? await Promise.all([getReservation(id), vehicleNames()])
    : [null, new Map()];

  if (row === null) {
    return (
      <main className={q.main} data-testid="admin-reservation-detail">
        <div className={q.wrap}>
          <Link className={a.backLink} href={backHref}>
            {t("back")}
          </Link>
          <p className={a.empty}>{t("notFound")}</p>
        </div>
      </main>
    );
  }

  const now = new Date();
  const none = t("value.none");
  const quick = row.intake === "quick";
  const canConfirm = row.status === "new";
  const canCancel = row.status === "new" || row.status === "confirmed";
  const [actionLabels, badgeLabels, rowLabels, dateLabels] = await Promise.all([
    getReservationActionLabels(),
    getStatusBadgeLabels(),
    getReservationRowLabels(),
    getAdminDateLabels(),
  ]);
  // 접수 기록의 시각 — 관리자 날짜 틀("9월 28일 (월) 20:02" · 올해가 아니면 연도까지 — P5-23 라운드 2 A-3). 읽지 못하면 "—".
  const stamp = (iso: string): string => formatAdminDate(iso, now, dateLabels, { time: true }) ?? none;
  const routeText = tRoot("admin.reservations.routeValue", {
    origin: placeLabel(row.origin_code),
    destination: placeLabel(row.destination_code),
  });

  // ── 머리 ─────────────────────────────────────────────────────────────
  const name = splitNameTemplate(t.raw("titleName"));
  const clock = (hour: string, minute: string) => fillTemplate(rowLabels.time, { hour, minute });
  const received = receivedAt(row.created_at, now);
  const when =
    received === null
      ? stamp(row.created_at)
      : received.kind === "today"
        ? t("meta.today", { time: clock(received.hour, received.minute) })
        : received.kind === "date"
          ? t("meta.date", { month: received.month, day: received.day, time: clock(received.hour, received.minute) })
          : t("meta.year", { year: received.year, month: received.month, day: received.day, time: clock(received.hour, received.minute) });
  const elapsed = elapsedSince(row.created_at, now);
  const ago = elapsed === null ? "" : elapsed.unit === "justNow" ? rowLabels.elapsed.justNow : fillTemplate(rowLabels.elapsed[elapsed.unit], { n: elapsed.n });

  // ── 연락 ─────────────────────────────────────────────────────────────
  const tel = telHref(row.phone);
  const sms = smsHref(row.phone);

  // ── 운행 ─────────────────────────────────────────────────────────────
  const dayTpl = { day: rowLabels.dayHead, dayYear: str(tRoot.raw("admin.dates.dayYear")), weekdays: rowLabels.weekdays };
  const go = dayParts(row.depart_at, now);
  // 간편 접수는 도착일이 출발일과 같으면 저장값이 null 이다 — 오는 날 = 가는 날(P3-8). 상세 접수의 null 은 돌아오는 날 없음(편도).
  const back = row.return_at === null ? (quick ? go : null) : dayParts(row.return_at, now);
  const goText = go === null ? none : dayLabel(go, dayTpl);
  const backText = back === null ? none : quick ? dayLabel(back, dayTpl) : `${dayLabel(back, dayTpl)} ${clock(back.hour, back.minute)}`;
  // 확인 시트의 요약 상자 — 구간 · 날짜 · 인원. 이름·전화·메일은 넣지 않는다(P5-19 그대로). 날짜는 **이 화면과 같은 표기**다
  // ("10월 10일 (토)" · 해가 다르면 연도까지 — P5-22 수정 라운드 · 컨트롤러 결정): 간편 접수는 날짜만(00:00 은 자리값), 상세 접수는 출발 시각까지.
  const summary: ReservationSummary = {
    parts: [
      routeText,
      quick || go === null ? goText : `${goText} ${clock(go.hour, go.minute)}`,
      ...(row.passengers === null ? [] : [tRoot("reservationCheck.card.passengersValue", { n: row.passengers })]),
    ],
    quick,
  };
  const nights = stayNights(row.depart_at, row.return_at);
  const vehicleName = row.vehicle_slug === null ? null : (vehicles.get(row.vehicle_slug) ?? row.vehicle_slug);
  const waypoints = waypointLabels(row.waypoint_codes);
  const undecided = () => (
    <dd className={a.undecided} data-undecided="true">
      {icon("phone", a.undecidedIcon)}
      {t("trip.undecided")}
    </dd>
  );
  const boolLabel = (v: boolean): string => (v ? t("value.included") : t("value.excluded"));
  const hasOptions = row.contact_method !== null || row.payment_method !== null || row.parking_included !== null || row.vat_included !== null;
  const message = row.message !== null && row.message.trim() !== "" ? row.message : null;
  const region = { [PROCESS_REGION_ATTR]: "" };

  return (
    <main className={a.detailPage} data-testid="admin-reservation-detail">
      <header className={a.detailTop} data-testid="admin-detail-topbar">
        <Link className={a.detailIconBtn} href={backHref} aria-label={t("backAria")} data-testid="admin-detail-back-mobile">
          {icon("left", a.detailIcon)}
        </Link>
        <p className={a.detailTopTitle}>{t("title")}</p>
        {canCancel ? <SheetTrigger id={row.id} kind="cancel" label={actionLabels.moreCancel} variant="icon" testId="admin-more-cancel" /> : null}
      </header>

      <div className={a.pageWrap}>
        <Link className={`${a.backLink} ${a.detailBackDesktop}`} href={backHref} data-testid="admin-detail-back">
          {t("back")}
        </Link>

        <header className={a.detailHead}>
          <p className={a.badgeRow} data-testid="admin-detail-badges">
            <StatusBadge badge={reservationBadge(row.status, row.created_at, now)} labels={badgeLabels} />
            {quick ? <StatusBadge badge={{ kind: "quick" }} labels={{ ...badgeLabels, quick: t("value.intakeQuick") }} /> : null}
          </p>
          <h1 className={a.detailTitle}>
            {name.before}
            <span id={CUSTOMER_NAME_ELEMENT_ID}>{row.name}</span>
            {name.after}
          </h1>
          {/* 한 줄 메타 — 조각마다 한 덩어리(P5-23 라운드 2 C-14): "접수번호 P523N001" 이 둘로 갈리거나 줄 끝에 '·' 가 남지 않는다 */}
          <p className={a.detailMeta} data-testid="admin-detail-meta">
            {segments([
              t("meta.received", { when, ago }),
              <span key="intake" data-testid="admin-intake">
                {quick ? t("meta.intakeQuick") : t("value.intakeWizard")}
              </span>,
              t("meta.code", { code: row.public_code }),
            ])}
          </p>
        </header>

        <div className={a.detailCols}>
          <div className={a.detailSide} data-testid="admin-detail-side">
            <section className={a.detailCard} aria-labelledby="admin-contact-title" data-testid="admin-contact">
              <h2 id="admin-contact-title" className={a.detailCardTitle}>
                {icon("user", a.detailCardIcon)}
                {t("contact.title")}
              </h2>
              <p className={a.contactNum}>{detailPhoneText(row.phone)}</p>
              {tel !== null && sms !== null ? (
                <div className={a.contactBtns}>
                  <a className={`${a.btnSecondary} ${a.btnLink}`} href={tel} data-testid="admin-call">
                    {icon("phone", a.btnIcon)}
                    {t("contact.call")}
                  </a>
                  <a className={`${a.btnSecondary} ${a.btnLink}`} href={sms} data-testid="admin-sms">
                    {icon("msg", a.btnIcon)}
                    {t("contact.sms")}
                  </a>
                </div>
              ) : null}
              {row.email !== null && row.email !== "" ? (
                <p className={a.contactMail}>
                  <span className={a.contactMailLabel}>{t("field.email")}</span> <span>{row.email}</span>
                </p>
              ) : null}
            </section>
            <ReservationProcess id={row.id} status={row.status} labels={actionLabels} layout="card" />
          </div>

          <div className={a.detailMain} data-testid="admin-detail-main">
            <section className={a.detailCard} aria-labelledby="admin-trip-title" data-testid="admin-trip">
              <h2 id="admin-trip-title" className={a.detailCardTitle}>
                {icon("bus", a.detailCardIcon)}
                {t("sectionTrip")}
              </h2>
              <p className={a.routeBig} data-testid="admin-trip-route">
                {routeText}
              </p>
              <dl className={a.kv}>
                <dt>{t("trip.go")}</dt>
                <dd data-testid="admin-depart">{goText}</dd>
                <dt>{t("trip.back")}</dt>
                <dd>{backText}</dd>
                {nights !== null ? (
                  <>
                    <dt>{t("trip.stay")}</dt>
                    <dd>{fillTemplate(rowLabels.stay, { nights, days: nights + 1 })}</dd>
                  </>
                ) : null}
                <dt>{t("trip.pax")}</dt>
                <dd>{row.passengers === null ? none : fillTemplate(rowLabels.paxValue, { n: row.passengers })}</dd>
                <dt>{t("trip.time")}</dt>
                {quick || go === null ? undecided() : <dd>{clock(go.hour, go.minute)}</dd>}
                <dt>{t("field.vehicle")}</dt>
                {quick || vehicleName === null ? (
                  undecided()
                ) : (
                  <dd>
                    <span>{vehicleName}</span>
                    {row.bus_count !== null ? (
                      <>
                        {" "}
                        <span>{tRoot("reservationCheck.card.busCountValue", { n: row.bus_count })}</span>
                      </>
                    ) : null}
                  </dd>
                )}
                <dt>{t("trip.tripType")}</dt>
                {row.trip_type !== null && isTripType(row.trip_type) ? (
                  <dd>{tRoot(`reservationCheck.tripType.${row.trip_type}`)}</dd>
                ) : quick ? (
                  undecided()
                ) : (
                  <dd>{row.trip_type ?? none}</dd>
                )}
                <dt>{t("field.purpose")}</dt>
                {row.purpose_code !== null ? (
                  <dd>{isPurpose(row.purpose_code) ? tRoot(`admin.labels.purpose.${row.purpose_code}`) : row.purpose_code}</dd>
                ) : quick ? (
                  undecided()
                ) : (
                  <dd>{none}</dd>
                )}
                {waypoints.length > 0 ? (
                  <>
                    <dt>{t("field.waypoints")}</dt>
                    <dd>{waypoints.join(" · ")}</dd>
                  </>
                ) : null}
              </dl>
            </section>

            {hasOptions ? (
              <section className={a.detailCard} aria-labelledby="admin-options-title" data-testid="admin-options">
                <h2 id="admin-options-title" className={a.detailCardTitle}>
                  {t("sectionOptions")}
                </h2>
                <dl className={a.kv}>
                  {row.contact_method !== null ? (
                    <>
                      <dt>{t("field.contactMethod")}</dt>
                      <dd>{isContact(row.contact_method) ? tRoot(`admin.labels.contact.${row.contact_method}`) : row.contact_method}</dd>
                    </>
                  ) : null}
                  {row.payment_method !== null ? (
                    <>
                      <dt>{t("field.paymentMethod")}</dt>
                      <dd>{isPayment(row.payment_method) ? tRoot(`admin.labels.payment.${row.payment_method}`) : row.payment_method}</dd>
                    </>
                  ) : null}
                  {row.parking_included !== null ? (
                    <>
                      <dt>{t("field.parking")}</dt>
                      <dd>{boolLabel(row.parking_included)}</dd>
                    </>
                  ) : null}
                  {row.vat_included !== null ? (
                    <>
                      <dt>{t("field.vat")}</dt>
                      <dd>{boolLabel(row.vat_included)}</dd>
                    </>
                  ) : null}
                </dl>
              </section>
            ) : null}

            {message !== null ? (
              <section className={a.detailCard} aria-labelledby="admin-request-title" data-testid="admin-request">
                <h2 id="admin-request-title" className={a.detailCardTitle}>
                  {icon("note", a.detailCardIcon)}
                  {t("field.message")}
                </h2>
                <p className={a.requestText}>{message}</p>
              </section>
            ) : null}

            {/* key — 다른 접수로 옮겨 가면 처리 영역을 새로 만든다(체크리스트 체크·메모 편집이 앞 접수에서 넘어오지 않게) */}
            <ReservationActions key={row.id} id={row.id} status={row.status} initialMemo={row.admin_memo ?? ""} summary={summary} labels={actionLabels} />

            <details className={`${a.detailCard} ${a.records}`} data-testid="admin-records">
              <summary className={a.recordsSummary}>
                <span>{t("records")}</span>
                {icon("chevron", a.recordsChevron)}
              </summary>
              <dl className={a.recordsKv}>
                <dt>{t("field.createdAt")}</dt>
                <dd>{stamp(row.created_at)}</dd>
                <dt>{t("field.confirmedAt")}</dt>
                <dd>{row.confirmed_at === null ? none : stamp(row.confirmed_at)}</dd>
                <dt>{t("field.privacyConsentAt")}</dt>
                <dd>{stamp(row.privacy_consent_at)}</dd>
                <dt>{t("field.withdrawalConsentAt")}</dt>
                <dd data-testid="admin-withdrawal-consent">
                  {row.withdrawal_consent_at !== null
                    ? stamp(row.withdrawal_consent_at)
                    : row.withdrawal_consent_legacy
                      ? t("value.noWithdrawalRecord")
                      : none}
                </dd>
                <dt>{t("field.marketingConsentAt")}</dt>
                <dd>{row.marketing_consent_at === null ? t("value.notConsented") : stamp(row.marketing_consent_at)}</dd>
                <dt>{t("field.retentionUntil")}</dt>
                <dd>{stamp(row.retention_until)}</dd>
              </dl>
            </details>

            <ReservationProcess id={row.id} status={row.status} labels={actionLabels} layout="mobile" />
          </div>
        </div>
      </div>

      <div className={a.actionBar} role="group" aria-label={t("bar.label")} tabIndex={-1} {...region} data-testid="admin-actionbar">
        {tel !== null ? (
          <a className={`${a.btnSecondary} ${a.btnLink}`} href={tel}>
            {icon("phone", a.btnIcon)}
            {t("bar.call")}
          </a>
        ) : null}
        {canConfirm ? (
          <SheetTrigger id={row.id} kind="confirm" label={actionLabels.confirm} variant="primary" testId="admin-bar-confirm" />
        ) : sms !== null ? (
          <a className={`${a.btnSecondary} ${a.btnLink}`} href={sms}>
            {icon("msg", a.btnIcon)}
            {t("bar.sms")}
          </a>
        ) : null}
      </div>
      <div className={a.actionBarSpacer} aria-hidden="true" />
    </main>
  );
}
