/**
 * GET /api/cron/purge — 개인정보 파기 배치 진입점 (플랜 v4 P1-5).
 *
 * 호출자: Vercel Cron (vercel.json crons). 스케줄 "0 19 * * *" 는 UTC 19:00 = KST 04:00 (KST = UTC+9, DST 없음) —
 * 접수·확정 트래픽이 가장 적은 새벽. vercel.json 은 주석을 못 쓰므로 시각 근거를 여기 둔다.
 *
 * 인증: Vercel 이 `Authorization: Bearer ${CRON_SECRET}` 를 붙여 부른다. 없거나 틀리면 401. CRON_SECRET 미설정이면
 * 모두 401(fail-closed). 비교는 timingSafeEqual.
 *
 * dry-run 이 기본값: 쿼리 `?dry=0` 일 때만 실제 삭제. 그 외(없음·1·true·빈값)는 전부 보고만 한다.
 * 실운영 전환 = vercel.json path 를 "/api/cron/purge?dry=0" 으로 바꾸는 것(오픈 게이트 항목, P1-5 보고서 참조).
 *
 * 응답: PurgeReport JSON — id·created_at·status·결정·사유만. 이름·전화 등 개인정보는 담기지 않는다. 캐시 금지.
 * middleware.ts matcher 가 /api 를 제외하므로 이 경로는 로케일 리다이렉트를 받지 않는다.
 * 서비스 롤 클라이언트(lib/supabase/server.ts)는 서버 전용 — 이 파일은 Route Handler 라 서버에서만 실행된다.
 */
import { timingSafeEqual } from "node:crypto";

import { purge, supabasePurgeClient } from "@/lib/retention/purge";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return json({ error: "unauthorized" }, 401);
  }
  const dryRun = new URL(request.url).searchParams.get("dry") !== "0";
  try {
    const client = supabasePurgeClient(createServiceClient());
    const report = await purge({ dryRun }, client);
    return json(report, 200);
  } catch (err) {
    // 개인정보가 섞일 수 있는 원문 대신 메시지만. 실패는 크론 로그로 확인한다.
    console.error(JSON.stringify({ event: "retention_purge_error", message: err instanceof Error ? err.message : String(err) }));
    return json({ error: "purge_failed" }, 500);
  }
}
