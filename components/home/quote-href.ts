/**
 * 홈 견적 위젯 → /quote 프리필 URL (순수 함수). 접수하지 않는다 — 접수 경로는 위저드 하나다(플랜 P3-4).
 *
 * 규칙
 *   - 빈 값은 생략한다. 아무것도 없으면 "/quote".
 *   - 장소는 LOCATION_CODES 의 canonical code 만 싣는다(번역 문자열·미지 코드는 버린다 — CLAUDE.md §3).
 *   - date 는 "YYYY-MM-DD", pax 는 양의 정수, vehicle 은 slug 문자([a-z0-9-])만. 검증은 위저드가 다시 한다.
 *   - 직렬화는 URLSearchParams — 인코딩·인젝션은 브라우저 규칙에 맡긴다.
 */
import { isLocationCode } from "@/lib/codes";

export interface QuoteHrefParams {
  origin?: string;
  dest?: string;
  date?: string;
  pax?: number | string;
  vehicle?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9-]+$/;

export function quoteHref(params: QuoteHrefParams = {}): string {
  const q = new URLSearchParams();
  if (params.origin && isLocationCode(params.origin)) q.set("origin", params.origin);
  if (params.dest && isLocationCode(params.dest)) q.set("dest", params.dest);
  if (params.date && ISO_DATE.test(params.date)) q.set("date", params.date);
  const pax = typeof params.pax === "string" ? (params.pax.trim() === "" ? NaN : Number(params.pax)) : params.pax;
  if (pax !== undefined && Number.isInteger(pax) && pax > 0) q.set("pax", String(pax));
  if (params.vehicle && SLUG.test(params.vehicle)) q.set("vehicle", params.vehicle);
  const qs = q.toString();
  return qs ? `/quote?${qs}` : "/quote";
}
