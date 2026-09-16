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
import { randomBytes, timingSafeEqual } from "node:crypto";

import { structuredLog, type StructuredLogEntry } from "@/lib/log";
import { resendSender } from "@/lib/notify/mail";
import { routingSender } from "@/lib/notify/router";
import { memorySender, unconfiguredSender, type NotificationSender } from "@/lib/notify/sender";
import { solapiSender, type TemplateVarsPort } from "@/lib/notify/solapi";
import { templateVars } from "@/lib/notify/vars";
import { runNotificationWorker, supabaseWorkerDb } from "@/lib/notify/worker";
import { siteOrigin } from "@/lib/site-url";
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
 * **우선순위: 명시적 지시(NOTIFY_SENDER) > 우연히 존재하는 설정(SOLAPI 키).**
 * P4-1 §6 인계는 SOLAPI 분기(P4-2)를 첫 줄에 두라고 했지만 컨트롤러가 2026-09-15 에 뒤집었다. 근거: 실키가 `.env.local` 에 남아 있는
 * 개발자가 `NOTIFY_SENDER=memory` 를 **일부러 켰는데도** 실제 문자가 실제 번호로 나간다 — 사람이 적은 지시를, 그저 존재할 뿐인
 * 설정이 조용히 덮는 형태다. 운영은 어차피 memory 를 거부하므로(아래) 이 순서 변경으로 약해지는 것은 없다.
 *
 * NOTIFY_SENDER="memory": 인메모리 sender(실제 발송 없이 sent 처리) — 로컬 스택 실증 전용. 운영에서 켜지면 고객이 문자를 못 받는데
 * 행은 sent 가 된다(ADR-7 이 막으려던 "조용히 사라짐"). 그래서 VERCEL_ENV=production 이면 **그 지시만 무시하고**(warn 한 줄)
 * 아래 선택을 계속한다 — 운영에서 memory 오설정이 발송 자체를 멈추게 하지는 않는다.
 *
 * SOLAPI 키 3종(키·시크릿·발신번호)이 전부 있으면 문자 어댑터를, RESEND 키 2종(API 키·발신주소)이 있으면 메일 어댑터를 만들고
 * **둘을 routingSender 로 묶는다**(P4-5). 하나도 없으면 unconfigured — 발송기는 claim 하지 않고 attempts 를 태우지 않는다.
 * 어댑터 자신도 같은 규칙을 한 겹 더 건다: 문안 변수 포트(solapi.ts TemplateVarsPort)가 비면 키가 다 있어도 `configured`=false 다.
 * **P4-2b 가 그 포트를 구현했으므로(lib/notify/vars.ts) 이제 남은 전제는 키뿐이다** — 키를 넣는 순간 나간다
 * (vercel.json 의 `?dry=0` 전환은 별개의 오픈 게이트 항목이다).
 *
 * **채널별로 따로 켜진다는 점이 P4-5 의 요점이다.** 문자 키만 있으면 라우터의 channels 는 ['sms'] 이고, 발송기는 claim 에
 * 그 목록을 넘긴다(0014). 메일 행은 **집히지 않은 채 큐에 남아** attempts 가 보존된다 — 메일 키가 온 날 그대로 나간다.
 * 예전에는 문자 어댑터가 메일 행까지 집어가 다섯 번 만에 죽였다.
 */
function selectSender(vars: TemplateVarsPort): NotificationSender {
  if (process.env.NOTIFY_SENDER === "memory") {
    if (process.env.VERCEL_ENV !== "production") return memorySender();
    // 운영에서는 이 지시를 무시하고 아래 선택을 계속한다(키가 있으면 제공자, 없으면 unconfigured).
    structuredLog({ level: "warn", event: "notify.memory_sender_refused" });
  }
  const { SOLAPI_API_KEY, SOLAPI_API_SECRET, SMS_SENDER, RESEND_API_KEY, MAIL_FROM } = process.env;

  const sms =
    SOLAPI_API_KEY && SOLAPI_API_SECRET && SMS_SENDER
      ? solapiSender({
          apiKey: SOLAPI_API_KEY,
          apiSecret: SOLAPI_API_SECRET,
          from: SMS_SENDER,
          fetch: globalThis.fetch,
          now: () => new Date(),
          randomBytes: (n) => randomBytes(n),
          log: structuredLog,
          // 문안 변수 조회 포트(P4-2b). 없으면 configured=false 라 claim 이 일어나지 않는다 — 이제는 있다.
          vars,
        })
      : undefined;

  const email =
    RESEND_API_KEY && MAIL_FROM
      ? resendSender({ apiKey: RESEND_API_KEY, from: MAIL_FROM, fetch: globalThis.fetch, log: structuredLog, vars })
      : undefined;

  // 아무 제공자도 없으면 라우터로 감싸지 않는다 — 보고서에 'unconfigured' 라는 기존 낱말을 그대로 남긴다(P4-1 의 계약).
  if (sms === undefined && email === undefined) return unconfiguredSender();
  return routingSender({ sms, email });
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
    // 서비스 롤 클라이언트는 한 번 만들어 큐 어댑터와 문안 변수 로더가 함께 쓴다. 원점(origin)도 env 를 보는 이 파일에서 정한다 —
    // lib/notify/** 는 env 를 읽지 않는다(P4-1 경계).
    const client = createServiceClient();
    const db = supabaseWorkerDb(client);
    const vars = templateVars({ client, origin: siteOrigin() });
    const report = await runNotificationWorker({ dryRun }, { db, sender: selectSender(vars), now: () => new Date(), log: structuredLog });
    return json(report, 200);
  } catch (err) {
    // 개인정보가 섞일 수 있는 원문 대신 메시지만(outbox.* 오류는 코드·메시지뿐이다). 실패는 크론 로그로 확인한다.
    const entry: WorkerErrorLogEntry = { level: "error", event: "notify.worker_error", message: err instanceof Error ? err.message : String(err) };
    structuredLog(entry);
    return json({ error: "notify_failed" }, 500);
  }
}
