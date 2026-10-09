/**
 * 접수 행(목록 · 관리 홈 미리보기 · 다가오는 운행)의 글자 — 서버 페이지가 한 번 푼다 (P5-21 · components/admin/statusBadgeLabels.ts 와 같은 모양).
 *
 * 채울 자리가 있는 문장(`{n}분 전` · `{month}/{day}({weekday})` …)은 **원문 틀**(t.raw)로 내린다 — 행 수십 개를 그리는 동안 번역 조회를
 * 한 번만 하고, 채우기는 행을 그리는 함수(components/admin/reservationRow.tsx)가 한다. 관리자 영역은 로케일 밖이라 한국어 고정.
 * 운행 구분(왕복·편도)은 예약확인·상세와 같은 `reservationCheck.tripType.*` 다(같은 말).
 */
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import { TRIP_TYPES, type TripType } from "@/lib/reservation-check/view";

export interface ReservationRowLabels {
  routeValue: string;
  dateShort: string;
  /** 여러 날 운행의 날짜 범위 틀 — `{from}~{to}`(리뷰 P2-3). */
  dateRange: string;
  /** 여러 날 운행의 기간 틀 — `{nights}박 {days}일`(돌아오는 날에서 센다). */
  stay: string;
  dayHead: string;
  time: string;
  /** 0 = 일요일 … 6 = 토요일. */
  weekdays: string[];
  timeUndecided: string;
  vehicleUndecided: string;
  busValue: string;
  paxValue: string;
  elapsed: { justNow: string; minutes: string; hours: string; days: string };
  relative: { today: string; tomorrow: string; after: string; before: string };
  callAria: string;
  quickChip: string;
  tripType: Record<TripType, string>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const record = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {});

export async function getReservationRowLabels(): Promise<ReservationRowLabels> {
  const [t, root] = await Promise.all([
    getTranslations({ locale: routing.defaultLocale, namespace: "admin" }),
    getTranslations({ locale: routing.defaultLocale, namespace: "reservationCheck" }),
  ]);
  const elapsed = record(t.raw("reservations.elapsed"));
  const relative = record(t.raw("reservations.relative"));
  const weekdays = t.raw("dates.weekdays");
  return {
    routeValue: str(t.raw("reservations.routeValue")),
    dateShort: str(t.raw("dates.short")),
    dateRange: str(t.raw("dates.range")),
    stay: str(t.raw("reservations.stay")),
    dayHead: str(t.raw("dates.day")),
    time: str(t.raw("dates.time")),
    weekdays: Array.isArray(weekdays) ? weekdays.map(str) : [],
    timeUndecided: str(t.raw("reservations.timeUndecided")),
    vehicleUndecided: str(t.raw("reservations.vehicleUndecided")),
    busValue: str(t.raw("reservations.busValue")),
    paxValue: str(t.raw("reservations.paxValue")),
    elapsed: { justNow: str(elapsed.justNow), minutes: str(elapsed.minutes), hours: str(elapsed.hours), days: str(elapsed.days) },
    relative: { today: str(relative.today), tomorrow: str(relative.tomorrow), after: str(relative.after), before: str(relative.before) },
    callAria: str(t.raw("reservations.callAria")),
    quickChip: str(t.raw("reservations.quickChip")),
    tripType: Object.fromEntries(TRIP_TYPES.map((k) => [k, str(root.raw(`tripType.${k}`))])) as Record<TripType, string>,
  };
}
