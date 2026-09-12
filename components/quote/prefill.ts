/**
 * 홈 → /quote 프리필 쿼리 파싱 — 순수 (P3-4). 만드는 쪽은 components/home/quote-href.ts(quoteHref).
 *
 *   ?origin=SEL&dest=TYG&date=2026-09-20[T08:00]&pax=30&vehicle=bus45
 *
 * 규칙: 첫 진입에서 한 번만 읽고 URL 에서 지운다(stripPrefillParams — step 등 다른 파라미터는 남긴다).
 * 검증은 여기서 다시 한다(quoteHref 가 걸렀더라도 URL 은 누구나 만들 수 있다) — 모르는 코드·형식은 조용히 무시.
 * date 는 홈 위젯 형식(YYYY-MM-DD)과 벽시계 형식(YYYY-MM-DDTHH:mm) 둘 다 받는다. 값은 문자열 그대로(변환 없음).
 */
import { isLocationCode } from "@/lib/codes";

import { splitLocal } from "./datetime";

export const PREFILL_PARAMS = ["origin", "dest", "date", "pax", "vehicle"] as const;

export interface Prefill {
  originCode?: string;
  destinationCode?: string;
  departDate?: string;
  departTime?: string;
  passengers?: string;
  vehicleSlug?: string;
}

const SLUG_PATTERN = /^[a-z0-9-]+$/;
const PAX_PATTERN = /^\d{1,3}$/;
const PAX_MAX = 900;

export function parsePrefill(params: URLSearchParams): Prefill {
  const out: Prefill = {};
  const origin = params.get("origin");
  if (origin && isLocationCode(origin)) out.originCode = origin;
  const dest = params.get("dest");
  if (dest && isLocationCode(dest)) out.destinationCode = dest;
  const date = params.get("date");
  if (date) {
    const parts = splitLocal(date);
    if (parts) {
      out.departDate = parts.date;
      if (parts.time) out.departTime = parts.time;
    }
  }
  const pax = params.get("pax");
  if (pax && PAX_PATTERN.test(pax)) {
    const n = Number(pax);
    if (n >= 1 && n <= PAX_MAX) out.passengers = String(n);
  }
  const vehicle = params.get("vehicle");
  if (vehicle && SLUG_PATTERN.test(vehicle)) out.vehicleSlug = vehicle;
  return out;
}

export function hasPrefill(params: URLSearchParams): boolean {
  return PREFILL_PARAMS.some((k) => params.has(k));
}

/** 프리필 파라미터만 지운 search 문자열("?step=3" 또는 ""). */
export function stripPrefillParams(search: string): string {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const k of PREFILL_PARAMS) q.delete(k);
  const s = q.toString();
  return s ? `?${s}` : "";
}
