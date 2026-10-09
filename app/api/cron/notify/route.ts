/**
 * GET /api/cron/notify — 통지 아웃박스 발송기의 **하루 1회 재시도·회수** 진입점 (플랜 v4 P4-1 · P4-7 · ADR-7 · 리뷰 M3).
 *
 * 호출자: Vercel Cron (vercel.json crons). 스케줄 "0 23 * * *"(UTC) = 매일 08시대 KST. vercel.json 은 주석을 못 쓰므로 근거를 여기 둔다.
 *   - **왜 하루 1회인가 (P4-7).** Vercel 무료(Hobby) 요금제는 하루 1회보다 잦은 크론이 든 vercel.json 을 **빌드 전에 거부**한다.
 *     P4-1 의 5분 크론 때문에 2026-09-13 부터 모든 커밋이 배포되지 않았다(컨트롤러 실험으로 확정 — docs/ops/environments.md).
 *     tests/notify-inline.test.ts §6 이 "모든 크론의 분·시 필드가 고정 정수" 를 잠근다 — 잦은 크론이 다시 들어오면 CI 가 빨개진다.
 *   - **첫 시도는 여기가 아니다.** 접수·확정 액션이 응답 뒤에 같은 발송기를 작은 배치로 한 번 부른다(lib/notify/inline.ts,
 *     스위치 NOTIFY_INLINE). 이 크론의 몫은 그 뒤다 — ① 백오프가 지난 **재시도** ② 5회째 claim 뒤 죽은 행의 **회수(reap)**와
 *     사장님 실패 알림(P4-4) ③ 즉시 발송이 꺼져 있었거나 실패해 남은 pending 의 **쓸어 담기**.
 *   - **왜 08시대 KST 인가.** 재시도는 손님에게 가는 문자다 — 새벽에 보내지 않는다. 사장님 실패 알림도 하루 업무 시작에 닿는다.
 *     파기 크론(0 19 * * * = 04시 KST)과 시간대가 겹치지 않는다. Hobby 크론은 **지정한 시(hour) 안의 아무 때나** 불리므로
 *     실제 실행은 08:00~08:59 KST 사이다 — 분 단위 정확성에 기대는 로직은 없다.
 *   - **대가.** 즉시 발송의 첫 시도와 짧은 재시도가 모두 실패한 통지는 다음 시도가 최대 하루 뒤다(다른 접수·확정이 오면 그때 당겨진다).
 *     5회를 다 태우기까지 며칠이 걸릴 수 있고, 그만큼 사장님 실패 알림도 늦다. P4-7 보고서 §2 가 이 선택의 근거다.
 *
 * 인증: purge 라우트와 같다 — `Authorization: Bearer ${CRON_SECRET}`, 없거나 틀리면 401, CRON_SECRET 미설정이면 모두 401(fail-closed),
 * 비교는 timingSafeEqual.
 *
 * dry-run 이 기본값: 쿼리 `?dry=0` 일 때만 reap·claim·send 를 한다. 그 외(없음·1·true·빈값)는 전부 보고만 한다(DB 변경 0).
 * 실운영 전환 = vercel.json path 를 "/api/cron/notify?dry=0" 으로 바꾸는 것 — 오픈 게이트 항목(컨트롤러가 등록).
 * **즉시 발송 스위치(NOTIFY_INLINE=1)와는 따로 켠다.** 즉시 발송만 켜고 이 크론이 dry 로 남으면 재시도·회수가 접수·확정이
 * 있을 때만 돈다(그때 워커가 함께 훑는다). 이 크론만 켜고 즉시 발송이 꺼져 있으면 첫 문자가 최대 하루 늦다.
 *
 * sender 선택·서비스 롤 클라이언트·OWNER_EMAIL 은 lib/notify/deps.ts `notifyWorkerDeps()` 가 만든다(P4-7 에서 이 파일에서 옮겼다 —
 * 즉시 발송과 한 벌을 쓰려고). 이 파일이 읽는 env 는 CRON_SECRET 하나다.
 *
 * 응답: WorkerReport JSON — 행 id·카운트·시각뿐. 수신처(전화·메일)·이름·문안은 담기지 않는다. 캐시 금지.
 * middleware.ts matcher 가 /api 를 제외하므로 이 경로는 로케일 리다이렉트를 받지 않는다.
 * 이 파일은 Route Handler 라 서버에서만 실행된다.
 */
import { timingSafeEqual } from "node:crypto";

import { structuredLog, type StructuredLogEntry } from "@/lib/log";
import { notifyWorkerDeps } from "@/lib/notify/deps";
import { runNotificationWorker } from "@/lib/notify/worker";

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
    // 크론 1회의 claim 상한은 워커 기본값(DEFAULT_WORKER_LIMIT)이다 — 즉시 발송(5)보다 크다. 적체를 쓸어 담는 쪽이 이 크론이다.
    const report = await runNotificationWorker({ dryRun }, notifyWorkerDeps());
    return json(report, 200);
  } catch (err) {
    // 개인정보가 섞일 수 있는 원문 대신 메시지만(outbox.* 오류는 코드·메시지뿐이다). 실패는 크론 로그로 확인한다.
    const entry: WorkerErrorLogEntry = { level: "error", event: "notify.worker_error", message: err instanceof Error ? err.message : String(err) };
    structuredLog(entry);
    return json({ error: "notify_failed" }, 500);
  }
}
