/**
 * 관리자 방문자 통계 조회 (OF2-C · 0027 admin_site_stats) — 서버 전용.
 *
 * **관리자 세션 클라이언트로만 부른다 — 서비스 롤이 아니다**(ADR-2 · scripts/check-admin-no-service-role.sh 가 grep).
 * 함수는 definer 이고 첫 문장이 is_admin() 가드다 — 명단 밖 세션은 42501 가드 문구로 막힌다(null 을 돌려준다: 화면은 아무것도 그리지 않는다).
 * 호출하는 화면(app/admin/(protected)/stats/page.tsx)은 먼저 requireAdmin() 을 부른다. 캐시하지 않는다(세션 쿠키를 읽는다).
 */
import "server-only";

import { cookies } from "next/headers";

import { createSsrClient } from "../supabase/ssr";
import { isAdminGuardDenial } from "./adminRpc";
import { SITE_STATS_DAYS, SITE_STATS_RPC, assertSiteStatsShape, type SiteStats } from "./siteStats";

export type SiteStatsClient = ReturnType<typeof createSsrClient>;

export async function getSiteStats(days: number = SITE_STATS_DAYS, client?: SiteStatsClient): Promise<SiteStats | null> {
  const db = client ?? createSsrClient(await cookies());
  const { data, error } = await db.rpc(SITE_STATS_RPC, { p_days: days });
  if (error) {
    if (isAdminGuardDenial(error, SITE_STATS_RPC)) return null;
    // 오류 문구에는 code·message 만(행 내용 없음 — 이 함수는 행을 주지 않는다).
    throw new Error(`siteStats.get: [${error.code ?? "?"}] ${error.message}`);
  }
  return assertSiteStatsShape(data);
}
