/**
 * POST /api/stats/view — 자체 방문자 통계의 수집 진입점 (OF2-C · 마이그레이션 0027).
 *
 * 호출자: 공개 페이지의 브라우저(components/analytics/SiteAnalytics.tsx → navigator.sendBeacon). 방문 통계 거부(저장 표시·DNT·GPC)면 **보내지 않는다**.
 * 본체는 lib/stats/handler.ts — 봇·거부 헤더·관리자/api 경로 제외 → IP 한도(프로세스 메모리 한도) → vid(sha256(GUARD_SECRET + KST 날짜 + IP + UA) 앞 32자)
 * → 서비스 롤로 `record_site_view(p_vid)` 한 번. **IP·UA 원문은 저장·기록하지 않는다**(DB 로 가는 값은 vid 하나).
 * 응답은 언제나 204 — 실패를 방문자에게 드러내지 않는다.
 *
 * 서비스 롤 클라이언트는 서버 전용이고 이 파일은 Route Handler 라 서버에서만 실행된다. 표를 직접 만지지 않는다 — definer 함수 하나뿐(service_role 전용 EXECUTE).
 * middleware.ts matcher 가 /api 를 제외하므로 로케일 리다이렉트를 받지 않는다. 캐시 금지(POST).
 */
import { guardSecret } from "@/lib/guard/deps";
import { handleSiteView, type SiteViewDeps } from "@/lib/stats/handler";
import { createMemoryLimiter, STATS_MEMORY_LIMITS } from "@/lib/stats/memoryLimit";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 한도는 프로세스 메모리 안에서만 센다 — 해외 서버(Upstash)로 방문자 키를 보내지 않는다(처리방침 siteStats "국내 데이터베이스에만 저장").
const limiter = createMemoryLimiter(STATS_MEMORY_LIMITS);

const deps: SiteViewDeps = {
  now: () => new Date(),
  secret: () => guardSecret(),
  checkRate: limiter,
  record: async (vid) => {
    const { error } = await createServiceClient().rpc("record_site_view", { p_vid: vid });
    if (error) throw new Error(`record_site_view: [${error.code ?? "?"}]`);
  },
};

export async function POST(request: Request): Promise<Response> {
  return handleSiteView(request, deps);
}
