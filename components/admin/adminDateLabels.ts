/**
 * 관리자 날짜 틀(admin.dates.*) — 서버 화면이 한 번 풀어 components/admin/admin-date.ts 에 넘긴다 (P5-23 라운드 2 · 컨트롤러 A-3).
 * reservationRowLabels.ts 와 같은 모양: 원문 틀(t.raw)로 내리고 채우기는 순수 모듈이 한다. 관리자 영역은 로케일 밖이라 한국어 고정.
 */
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";

import type { AdminDateLabels } from "./admin-date";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export async function getAdminDateLabels(): Promise<AdminDateLabels> {
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.dates" });
  const weekdays = t.raw("weekdays");
  return {
    weekdays: Array.isArray(weekdays) ? weekdays.map(str) : [],
    day: str(t.raw("day")),
    dayYear: str(t.raw("dayYear")),
    md: str(t.raw("md")),
    mdYear: str(t.raw("mdYear")),
    month: str(t.raw("month")),
    monthYear: str(t.raw("monthYear")),
    time: str(t.raw("time")),
    dateTime: str(t.raw("dateTime")),
    period: str(t.raw("period")),
  };
}
