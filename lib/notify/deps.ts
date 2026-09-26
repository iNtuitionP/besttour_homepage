/**
 * 통지 발송기의 운영 deps — **lib/notify 에서 process.env 를 읽는 유일한 곳** (플랜 v4 P4-1 경계 · P4-7). 서버 전용.
 *
 * P4-1 부터 P4-6 까지 이 역할은 app/api/cron/notify/route.ts 안에 있었다. P4-7 이 두 번째 진입점(접수·확정 직후의 즉시 발송,
 * ./inline.ts)을 만들면서 sender 선택·수신처·클라이언트 조립을 **한 벌만** 두려고 여기로 옮겼다 — 두 진입점이 각자 조립하면
 * "운영에서 memory 거부" 같은 규칙이 한쪽에서만 바뀌는 날이 온다. lib/guard/deps.ts 와 같은 모양이다.
 * 크론 라우트는 이제 인증(CRON_SECRET)과 dry 판정만 하고 `notifyWorkerDeps()` 를 부른다.
 *
 * 나머지 lib/notify/** 는 여전히 env 를 읽지 않는다(worker·outbox·fallback·sender·router·solapi·mail·templates·vars·inline).
 *
 * 서비스 롤: 워커는 크론과 같은 서비스 롤 클라이언트를 쓴다(큐 claim·mark·reap 은 서비스 롤 전용 RPC 다). 관리자 확정 액션이
 * 이 모듈을 import 하지만, 관리자 경로 자신은 서비스 롤을 **쓰지 않는다** — 응답 뒤에 도는 서버 쪽 워커가 쓸 뿐이고,
 * 그 워커는 관리자가 준 값을 하나도 받지 않는다(트리거 이름뿐). 관리자 조회·전이는 여전히 세션 클라이언트 + is_admin() 이다(ADR-2).
 */
import "server-only";

import { randomBytes } from "node:crypto";

import { structuredLog } from "@/lib/log";
import { siteOrigin } from "@/lib/site-url";
import { createServiceClient } from "@/lib/supabase/server";

import { isInlineNotifyOn, scheduleInlineNotify, type InlineTrigger } from "./inline";
import { resendSender } from "./mail";
import { routingSender } from "./router";
import { memorySender, unconfiguredSender, type NotificationSender } from "./sender";
import { solapiSender, type TemplateVarsPort } from "./solapi";
import { templateVars } from "./vars";
import { runNotificationWorker, supabaseWorkerDb, type WorkerDeps } from "./worker";

/**
 * sender 선택 — 발송 제공자 env 를 보는 곳은 이 함수뿐이다. (P4-1~P4-6 동안 route.ts 에 있던 것을 그대로 옮겼다.)
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
 * (크론의 `?dry=0` 전환과 즉시 발송 스위치 NOTIFY_INLINE 은 각각 별개의 오픈 게이트 항목이다).
 *
 * **채널별로 따로 켜진다는 점이 P4-5 의 요점이다.** 문자 키만 있으면 라우터의 channels 는 ['sms'] 이고, 발송기는 claim 에
 * 그 목록을 넘긴다(0014). 메일 행은 **집히지 않은 채 큐에 남아** attempts 가 보존된다 — 메일 키가 온 날 그대로 나간다.
 * 예전에는 문자 어댑터가 메일 행까지 집어가 다섯 번 만에 죽였다.
 */
export function selectSender(vars: TemplateVarsPort): NotificationSender {
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
      ? resendSender({ apiKey: RESEND_API_KEY, from: MAIL_FROM, fetch: globalThis.fetch, log: structuredLog, vars, now: () => new Date() })
      : undefined;

  // 아무 제공자도 없으면 라우터로 감싸지 않는다 — 보고서에 'unconfigured' 라는 기존 낱말을 그대로 남긴다(P4-1 의 계약).
  if (sms === undefined && email === undefined) return unconfiguredSender();
  return routingSender({ sms, email });
}

/**
 * 발송기 한 번에 필요한 운영 deps. 크론 라우트와 즉시 발송이 **같은 것**을 쓴다.
 *
 * 서비스 롤 클라이언트는 한 번 만들어 큐 어댑터와 문안 변수 로더가 함께 쓴다. 원점(origin)도 여기서 정한다.
 * OWNER_EMAIL 은 발송이 끝내 실패했을 때 사장님이 그 사실을 받을 주소다(P4-4). 비어 있으면 발송기가 실패 알림을 **넣지 않고**
 * 보고서에 그 이유를 남긴다 — 주소를 지어내지 않는다. 발신 주소는 MAIL_FROM 하나뿐이고 이 값은 **수신처로만** 쓴다 —
 * 사장님의 포털 주소는 외부 발신이 금지돼 수신 전용이다(.env.example).
 */
export function notifyWorkerDeps(): WorkerDeps {
  const client = createServiceClient();
  const db = supabaseWorkerDb(client);
  const vars = templateVars({ client, origin: siteOrigin() });
  return { db, sender: selectSender(vars), ownerEmail: process.env.OWNER_EMAIL, now: () => new Date(), log: structuredLog };
}

/**
 * 테스트 opt-in 표식 (P4-7 수정 라운드 2 · 리뷰 P1-1). `Symbol.for` 라 테스트 헬퍼(tests/helpers/notify-env.ts)와 같은 값이다.
 * 앱 코드는 이 표식을 **세우지 않는다** — 읽기만 한다.
 */
const INLINE_TEST_OPT_IN = Symbol.for("bestour.notify.inlineInTests");

/**
 * 즉시 발송 스위치 — NOTIFY_INLINE 이 정확히 "1" 일 때만 켜진다. 프리뷰·로컬은 비워 둔다(.env.example).
 *
 * **테스트 프로세스(VITEST 또는 NODE_ENV=test — 아래 isTestProcess)에서는 명시적 opt-in 없이 켜지지 않는다.** 테스트 헬퍼가 `.env.local`(운영 접속 정보)로 env 빈칸을 채우고,
 * 여러 테스트가 `runAfter` 를 즉시 실행하도록 모의한다. 그 둘이 겹치면 평범한 단위 테스트가 운영 대기 행을 실제로 보낼 수 있다
 * (리뷰가 admin-reservations 의 확정 테스트로 짚었다). 테스트 쪽 전역 차단(setupFiles·loadDotEnvLocal)과 별개로 여기서 한 겹 더 막는다 —
 * 즉시 발송 배선을 시험하는 테스트만 `allowInlineNotifyInTests()` 로 표식을 세운다.
 * Next 는 빌드 때 NODE_ENV 를 "production"/"development" 로 박으므로 운영·dev 서버에서 이 분기는 절대 참이 되지 않는다.
 */
export function inlineNotifyEnabled(): boolean {
  if (!isInlineNotifyOn(process.env.NOTIFY_INLINE)) return false;
  if (isTestProcess() && (globalThis as Record<symbol, unknown>)[INLINE_TEST_OPT_IN] !== true) return false;
  return true;
}

/**
 * 테스트 프로세스인가 — `VITEST` **또는** `NODE_ENV === "test"` (수정 라운드 3 · 리뷰 P1-A).
 * NODE_ENV 하나만 보면 안 된다: vitest 는 셸의 NODE_ENV 를 **존중한다**(`process.env.NODE_ENV || "test"`) — 개발자 셸에
 * `NODE_ENV=development` 가 있으면 이 가드가 꺼졌다(리뷰어가 실제로 재현했다). `VITEST` 는 vitest 가 워커마다 항상 세운다.
 * 어느 하나라도 테스트라고 하면 끈다. 운영·dev 서버에는 VITEST 가 없고 NODE_ENV 는 production/development 다.
 */
function isTestProcess(): boolean {
  const v = process.env.VITEST;
  return (typeof v === "string" && v !== "" && v !== "false") || process.env.NODE_ENV === "test";
}

/**
 * 접수·확정 액션이 부르는 한 줄 — 응답 뒤에 발송기를 작은 배치로 한 번 돌린다(./inline.ts). 꺼져 있으면 아무것도 맡기지 않는다.
 * `runAfter` 는 호출자가 넘긴다(lib/ports/after.ts) — "응답 뒤" 라는 계약이 액션 코드에 보이게 하려고.
 * 반환값은 맡겼는지 여부뿐이다. 발송 결과는 호출자에게 돌아가지 않는다 — 접수·확정의 성공은 발송과 무관하다.
 */
export function notifyAfterResponse(trigger: InlineTrigger, runAfter: (task: () => Promise<void>) => void): boolean {
  return scheduleInlineNotify(trigger, {
    enabled: inlineNotifyEnabled(),
    runAfter,
    workerDeps: notifyWorkerDeps,
    run: runNotificationWorker,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
    log: structuredLog,
  });
}
