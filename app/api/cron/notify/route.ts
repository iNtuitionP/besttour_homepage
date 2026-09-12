/**
 * GET /api/cron/notify — 통지 아웃박스 발송기 진입점 (플랜 v4 P4-1 · ADR-7 · 리뷰 M3).
 *
 * 호출자: Vercel Cron (vercel.json crons). 스케줄 "*\/5 * * * *" = 5분 간격 — claim lease(0005, CLAIM_LEASE_MS = 5분)와 같다.
 * 더 짧으면 lease 안에 두 발송기가 겹치는 창이 커지고, 더 길면 접수 알림이 그만큼 늦는다. vercel.json 은 주석을 못 쓰므로 근거를 여기 둔다.
 *
 * 인증: purge 라우트와 같다 — `Authorization: Bearer ${CRON_SECRET}`, 없거나 틀리면 401, CRON_SECRET 미설정이면 모두 401(fail-closed),
 * 비교는 timingSafeEqual.
 *
 * dry-run 이 기본값: 쿼리 `?dry=0` 일 때만 reap·claim·send 를 한다. 그 외(없음·1·true·빈값)는 전부 보고만 한다(DB 변경 0).
 * 실운영 전환 = vercel.json path 를 "/api/cron/notify?dry=0" 으로 바꾸는 것 — purge 와 같은 오픈 게이트 항목(컨트롤러가 등록).
 *
 * sender 선택은 **이 파일에서만** env 를 본다(selectSender). 지금은 제공자 키가 없어 기본이 unconfigured — 발송기는 claim 조차 하지 않는다
 * (lib/notify/worker.ts 헤더의 규칙). NOTIFY_SENDER="memory" 는 로컬 실증용이며 운영(VERCEL_ENV=production)에서는 거부한다.
 *
 * 응답: WorkerReport JSON — 행 id·카운트·시각뿐. 수신처(전화·메일)·이름·문안은 담기지 않는다. 캐시 금지.
 * middleware.ts matcher 가 /api 를 제외하므로 이 경로는 로케일 리다이렉트를 받지 않는다.
 * 서비스 롤 클라이언트(lib/supabase/server.ts)는 서버 전용 — 이 파일은 Route Handler 라 서버에서만 실행된다.
 */
import { timingSafeEqual } from "node:crypto";

import { structuredLog, type StructuredLogEntry } from "@/lib/log";
import { memorySender, unconfiguredSender, type NotificationSender } from "@/lib/notify/sender";
import { runNotificationWorker, supabaseWorkerDb } from "@/lib/notify/worker";
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

/**
 * sender 선택 — env 를 보는 곳은 이 함수뿐이다.
 *
 * P4-2 인계: 제공자 어댑터(lib/notify/solapi.ts 예정)가 생기면 **이 함수 첫 줄에** 분기 하나를 추가한다:
 *   if (process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET) return solapiSender({ ... });
 * 키가 비어 있으면 아래로 떨어져 unconfigured 가 된다 — 발송기는 claim 하지 않고 attempts 를 태우지 않는다.
 *
 * NOTIFY_SENDER="memory": 인메모리 sender(실제 발송 없이 sent 처리) — 로컬 스택 실증 전용. 운영에서 켜지면 고객이 문자를 못 받는데
 * 행은 sent 가 된다(ADR-7 이 막으려던 "조용히 사라짐"). 그래서 VERCEL_ENV=production 이면 무시하고 warn 을 남긴다.
 */
function selectSender(): NotificationSender {
  if (process.env.NOTIFY_SENDER === "memory") {
    if (process.env.VERCEL_ENV === "production") {
      structuredLog({ level: "warn", event: "notify.memory_sender_refused" });
      return unconfiguredSender();
    }
    return memorySender();
  }
  return unconfiguredSender();
}

interface WorkerErrorLogEntry extends StructuredLogEntry {
  level: "error";
  event: "notify.worker_error";
  message: string;
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return json({ error: "unauthorized" }, 401);
  }
  const dryRun = new URL(request.url).searchParams.get("dry") !== "0";
  try {
    const db = supabaseWorkerDb(createServiceClient());
    const report = await runNotificationWorker({ dryRun }, { db, sender: selectSender(), now: () => new Date(), log: structuredLog });
    return json(report, 200);
  } catch (err) {
    // 개인정보가 섞일 수 있는 원문 대신 메시지만(outbox.* 오류는 코드·메시지뿐이다). 실패는 크론 로그로 확인한다.
    const entry: WorkerErrorLogEntry = { level: "error", event: "notify.worker_error", message: err instanceof Error ? err.message : String(err) };
    structuredLog(entry);
    return json({ error: "notify_failed" }, 500);
  }
}
