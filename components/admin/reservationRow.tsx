/**
 * 접수 행 — 한 벌의 마크업 (P5-21 · 시안 #list `.inq` · 제안서 ⑤-2 "행 = 한 벌의 마크업" · ④ 원칙 3·5·7).
 *
 * 접수 목록(/admin/reservations)과 관리 홈의 새 접수 미리보기가 **같은 행**을 쓴다. 휴대폰(<1024px)에서는 카드,
 * 넓은 목록(≥1024px · 목록 화면의 data-layout="table")에서는 표 모양 7칸이다 — 모양은 CSS(admin.module.css `.inq…`)가 바꾸고 마크업은 하나다.
 *   카드: 상태 배지 + 간편 칩 · 경과 / **이름** + 가운데 가린 번호 / 구간 / 날짜·시각(또는 "시각 미정") · 차량·대수(또는 "차량 미정") · 인원 / 오른쪽 전화
 *   표:   상태 · 고객 · 운행 구간 · 출발 · 차량·인원 · 접수 경과 · [전화]
 * 행 전체가 상세 링크(uuid 만 — URL 에 개인정보 0)이고, 전화 버튼은 **별개의 목표**다(행 안 누를 요소 둘 · 전화는 44px).
 *
 * 🔴 개인정보는 서버가 그린다 — 이것은 컴포넌트가 아니라 **함수**다(`reservationRow(row, …)` 로 부른다). 서버 컴포넌트로 만들어 행을 props 로 넘기면
 * dev 가 그 props 를 HTML 에 디버그 정보로 싣는다(P3-5 리뷰 N-2 · 메모리 "React 19.1 dev embeds server-component props in HTML").
 * 그래서 이름·전화는 여기서 곧바로 글자와 `tel:` 로 그려지고 어떤 부품의 props 에도 실리지 않는다(상태 배지는 상태·날수만 받는다).
 *
 * 간편 접수(0023 intake='quick' · 리뷰 P2-7): "간편" 칩 + 날짜만(저장된 00:00 은 자리값 — 시각을 보이면 "자정 출발" 로 읽힌다) +
 * "시각 미정" · "차량 미정" — 전화로 확인할 것이 무엇인지 목록에서 드러난다. 손님이 고르지 않은 값을 지어내지 않는다.
 * 목록의 번호는 가운데를 가린다(`010-****-0004` — reservation-list.ts listPhoneText). `tel:` 은 전체 번호다 — 숫자가 없으면 버튼을 그리지 않는다(리뷰 P2-9).
 *
 * P5-21 수정 라운드
 *   - 여러 날 운행(리뷰 P2-3): 돌아오는 날(return_at)이 출발일(KST 달력)보다 뒤면 날짜 칸에 "10/10(토)~10/11(일)", 구간 옆에 "1박 2일".
 *     배차 판단에 필요한 정보다. 당일 운행·돌아오는 날 없음은 그대로 둔다(기간을 지어내지 않는다 — reservation-list.ts stayNights).
 *   - 출발 칸(리뷰 P2-6): 넓은 목록에서 날짜 / "시각 · 남은 날" 두 줄 — 시각과 남은 날을 한 덩어리로 묶고 가운데점 앞은 줄바꿈 없는 공백이라
 *     가운데점이 줄 맨 앞에 혼자 서지 않는다.
 *   - `index` 가 null 이면 쪽 번호(data-row-index)를 달지 않는다 — 확정 탭 위의 '운행일이 지난 확정' 칸처럼 쪽으로 넘기지 않는 행이다
 *     ('더 보기' 뒤 포커스를 둘 자리와 섞이지 않는다).
 *   - 서버 전용(리뷰 P2-12): 클라이언트 부품이 이 파일을 가져오는 순간 빌드가 막힌다 — 이름·전화가 클라이언트 번들로 가는 길을 닫는다.
 */
import "server-only";

import Link from "next/link";
import type { ReactElement } from "react";

import type { ReservationListRow } from "@/lib/admin/reservations";
import { isLocationCode, locationLabelKo } from "@/lib/codes";

import { elapsedSince, kstDayDiff, kstParts, listPhoneText, stayNights, telHref } from "./reservation-list";
import type { ReservationRowLabels } from "./reservationRowLabels";
import { StatusBadge } from "./StatusBadge";
import { reservationBadge, type StatusBadgeLabels } from "./status-badge";

import s from "./admin.module.css";

export interface ReservationRowContext {
  /** 이 요청의 시각 하나 — 경과·N일째·남은 날을 모두 이것으로 잰다. */
  now: Date;
  labels: ReservationRowLabels;
  badgeLabels: StatusBadgeLabels;
  /** 차량 slug → 이름. 없으면 slug 로 떨어진다(목록·상세와 같은 규약). */
  vehicles: ReadonlyMap<string, string>;
  /** 확정 탭 — 출발까지 남은 날("2일 뒤")을 날짜 옆에. */
  departRelative?: boolean;
}

/** 원문 틀의 `{이름}` 자리를 채운다. 틀이 문자열이 아니면 빈 글자(지어내지 않는다). */
export function fillTemplate(tpl: unknown, values: Record<string, string | number>): string {
  return typeof tpl === "string" ? tpl.replace(/\{(\w+)\}/g, (_, k: string) => (k in values ? String(values[k]) : `{${k}}`)) : "";
}

const placeLabel = (code: string): string => (isLocationCode(code) ? locationLabelKo(code) : code);

const PHONE_PATH = "M6.6 3.5h2.6l1.5 4-2 1.3a11 11 0 0 0 6.5 6.5l1.3-2 4 1.5v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z";

/** 구간 — "서울 → 강릉" + 운행 구분(왕복·편도 — 간편 접수는 없다). */
function routeParts(row: ReservationListRow, ctx: ReservationRowContext): { route: string; tripType: string | null } {
  const route = fillTemplate(ctx.labels.routeValue, { origin: placeLabel(row.origin_code), destination: placeLabel(row.destination_code) });
  const tripType = row.trip_type !== null && row.trip_type in ctx.labels.tripType ? ctx.labels.tripType[row.trip_type as keyof ReservationRowLabels["tripType"]] : null;
  return { route, tripType: tripType === "" ? null : tripType };
}

/** 차량 — 간편 접수(또는 비어 있음)는 "차량 미정", 상세 접수는 "45인승 2대". */
function vehicleText(row: ReservationListRow, ctx: ReservationRowContext): { text: string; undecided: boolean } {
  if (row.intake === "quick" || row.vehicle_slug === null) return { text: ctx.labels.vehicleUndecided, undecided: true };
  const name = ctx.vehicles.get(row.vehicle_slug) ?? row.vehicle_slug;
  return { text: row.bus_count === null ? name : fillTemplate(ctx.labels.busValue, { vehicle: name, buses: row.bus_count }), undecided: false };
}

/** 출발 시각 — 간편 접수는 "시각 미정"(00:00 은 자리값). */
function timeText(row: ReservationListRow, ctx: ReservationRowContext): { text: string; undecided: boolean } {
  if (row.intake === "quick") return { text: ctx.labels.timeUndecided, undecided: true };
  const p = kstParts(row.depart_at);
  return p === null ? { text: "", undecided: false } : { text: fillTemplate(ctx.labels.time, { hour: p.hour, minute: p.minute }), undecided: false };
}

/** 날짜 — "10/5(월)". */
function dateText(iso: string, ctx: ReservationRowContext): string {
  const p = kstParts(iso);
  return p === null ? "" : fillTemplate(ctx.labels.dateShort, { month: p.month, day: p.day, weekday: ctx.labels.weekdays[p.weekday] ?? "" });
}

/** 여러 날 운행 — { 날짜 범위 "10/10(토)~10/11(일)", 기간 "1박 2일" }. 당일·돌아오는 날 없음은 null(리뷰 P2-3). */
function stayParts(row: ReservationListRow, ctx: ReservationRowContext): { range: string; nights: string } | null {
  const nights = stayNights(row.depart_at, row.return_at);
  if (nights === null || row.return_at === null) return null;
  return {
    range: fillTemplate(ctx.labels.dateRange, { from: dateText(row.depart_at, ctx), to: dateText(row.return_at, ctx) }),
    nights: fillTemplate(ctx.labels.stay, { nights, days: nights + 1 }),
  };
}

/** 구간 옆의 흐린 글자 — 운행 구분(왕복·편도)과 여러 날 운행의 기간을 가운데점으로. 둘 다 없으면 null. */
function tripAside(tripType: string | null, stay: { nights: string } | null): string | null {
  const parts = [tripType, stay?.nights ?? null].filter((p): p is string => p !== null && p !== "");
  return parts.length === 0 ? null : parts.join(" · ");
}

/** 남은 날 — 오늘 · 내일 · N일 뒤 · N일 지남(운행일이 지난 확정). */
export function relativeDayText(diff: number | null, labels: ReservationRowLabels): string {
  if (diff === null) return "";
  if (diff === 0) return labels.relative.today;
  if (diff === 1) return labels.relative.tomorrow;
  return diff > 1 ? fillTemplate(labels.relative.after, { n: diff }) : fillTemplate(labels.relative.before, { n: -diff });
}

/** 경과 — 방금 · N분 전 · N시간 전 · N일 전. */
function elapsedText(iso: string, ctx: ReservationRowContext): string {
  const e = elapsedSince(iso, ctx.now);
  if (e === null) return "";
  return e.unit === "justNow" ? ctx.labels.elapsed.justNow : fillTemplate(ctx.labels.elapsed[e.unit], { n: e.n });
}

/**
 * 접수 행 하나. `index` 는 읽어 온 목록에서의 자리(0 부터) — '더 보기' 뒤 포커스를 둘 자리를 찾는 데 쓴다.
 * 쪽으로 넘기지 않는 행(확정 탭 위의 지난 확정 칸)은 null — 쪽 번호를 달지 않는다.
 */
export function reservationRow(row: ReservationListRow, index: number | null, ctx: ReservationRowContext): ReactElement {
  const quick = row.intake === "quick";
  const badge = reservationBadge(row.status, row.created_at, ctx.now);
  const urgent = badge.kind === "waiting";
  const { route, tripType } = routeParts(row, ctx);
  const stay = stayParts(row, ctx);
  const aside = tripAside(tripType, stay);
  const time = timeText(row, ctx);
  const vehicle = vehicleText(row, ctx);
  const relative = ctx.departRelative ? relativeDayText(kstDayDiff(row.depart_at, ctx.now), ctx.labels) : "";
  const tel = telHref(row.phone);
  return (
    <li key={row.id} className={s.inq} data-row-id={row.id} data-urgent={urgent ? "true" : undefined}>
      <Link className={s.inqLink} href={`/admin/reservations/${row.id}`} data-row-index={index ?? undefined}>
        <span className={s.inqStatus}>
          <StatusBadge badge={badge} labels={ctx.badgeLabels} />
          {quick ? <StatusBadge badge={{ kind: "quick" }} labels={{ ...ctx.badgeLabels, quick: ctx.labels.quickChip }} /> : null}
        </span>
        <span className={s.inqWho}>
          <strong className={s.inqName}>{row.name}</strong>
          <span className={s.inqPhone}>{listPhoneText(row.phone)}</span>
        </span>
        <span className={s.inqTrip}>
          {route}
          {aside !== null ? <span className={s.inqMuted}> {aside}</span> : null}
        </span>
        <span className={s.inqMeta}>
          <span className={s.inqWhen}>
            <b className={s.inqDate}>{stay !== null ? stay.range : dateText(row.depart_at, ctx)}</b>{" "}
            <span className={s.inqTime}>
              <span className={time.undecided ? s.inqMuted : undefined}>{time.text}</span>
              {relative !== "" ? <span className={s.inqMuted}>{` · ${relative}`}</span> : null}
            </span>
          </span>
          <span className={s.inqSep} aria-hidden="true">
            {" · "}
          </span>
          <span className={s.inqBus}>
            <span className={vehicle.undecided ? s.inqMuted : undefined}>{vehicle.text}</span>
            {row.passengers !== null ? (
              <>
                <span className={s.inqSep} aria-hidden="true">
                  {" · "}
                </span>
                <span className={s.inqMuted}>{fillTemplate(ctx.labels.paxValue, { n: row.passengers })}</span>
              </>
            ) : null}
          </span>
        </span>
        <span className={s.inqAgo} data-late={urgent ? "true" : undefined}>
          {elapsedText(row.created_at, ctx)}
        </span>
      </Link>
      {tel !== null ? (
        <a className={s.call} href={tel} aria-label={fillTemplate(ctx.labels.callAria, { name: row.name })}>
          <span className={s.callCircle}>
            <svg className={s.callIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d={PHONE_PATH} />
            </svg>
          </span>
        </a>
      ) : null}
    </li>
  );
}

/**
 * 다가오는 운행 한 줄(관리 홈) — 시각 · 구간 · 고객 이름 · 차량·인원 · 확정 배지. 상세로 가는 링크(uuid). 함수인 이유는 위와 같다.
 * 여러 날 운행은 구간 옆에 기간("1박 2일"), 다음 줄에 날짜 범위("10/4(일)~10/5(월)") — 묶음 머리는 출발일이라 돌아오는 날은 여기서만 보인다.
 */
export function tripRow(row: ReservationListRow, ctx: ReservationRowContext): ReactElement {
  const { route, tripType } = routeParts(row, ctx);
  const stay = stayParts(row, ctx);
  const aside = tripAside(tripType, stay);
  const time = timeText(row, ctx);
  const vehicle = vehicleText(row, ctx);
  const pax = row.passengers !== null ? fillTemplate(ctx.labels.paxValue, { n: row.passengers }) : null;
  const meta = [row.name, stay?.range ?? null, vehicle.text, pax].filter((p): p is string => p !== null && p !== "").join(" · ");
  return (
    <li key={row.id} className={s.trip} data-trip-id={row.id}>
      <Link className={s.tripLink} href={`/admin/reservations/${row.id}`}>
        <span className={s.tripTime} data-undecided={time.undecided ? "true" : undefined}>
          {time.text}
        </span>
        <span className={s.tripBody}>
          <span className={s.tripRoute}>
            {route}
            {aside !== null ? <span className={s.inqMuted}> {aside}</span> : null}
          </span>
          <span className={s.tripMeta}>{meta}</span>
          <StatusBadge badge={{ kind: "confirmed" }} labels={ctx.badgeLabels} />
        </span>
      </Link>
    </li>
  );
}
