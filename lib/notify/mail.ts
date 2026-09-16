/**
 * Resend 트랜잭션 메일 어댑터 (플랜 v4 P4-5 · ADR-7).
 *
 * `lib/notify/sender.ts` 의 `NotificationSender` 구현 하나다. 구조는 `lib/notify/solapi.ts` 를 그대로 따랐다 —
 * 이 저장소의 어댑터 규범이 그 파일이다: 키·발신주소·fetch·로그·문안 변수까지 전부 주입받고, 환경변수는
 * `app/api/cron/notify/route.ts` 의 `selectSender()` 에서만 읽는다(P4-1 이 세운 경계). 새 패키지는 쓰지 않는다(raw fetch).
 *
 * ## 무엇을 보내는가 — 사장님 접수 알림 한 종류다
 * 아웃박스에서 `channel = 'email'` 인 행은 지금 하나뿐이다: 사장님 번호(OWNER_PHONE)가 없을 때 만들어지는
 * `created.owner.email`(outbox.ts `planNotifications`). 문안은 P4-3 에서 확정됐고 제목도 거기서 온다
 * (`renderTemplate(...).subject`). **이 파일은 문장을 짓지 않는다.**
 *
 * ## 무엇을 보내지 않는가
 * - **HTML 을 만들지 않는다.** 본문은 `renderTemplate` 의 평문 그대로다. 메일 클라이언트마다 다르게 깨지는 표·인라인 CSS 를
 *   만들 이유가 없고, 만들면 문안이 두 벌이 되어 한쪽만 고쳐진다.
 * - **광고를 보내지 않는다.** `(광고)` 표기·수신거부 안내를 만들지 않는다 — 우리가 보내는 것은 접수 사실을 알리는
 *   거래 관계 메일뿐이다(templates.ts 헤더와 같은 규약).
 * - **문자·알림톡을 보내지 않는다.** `channel !== 'email'` 은 명시적으로 거부한다. 0014 의 채널 필터가 claim 단계에서
 *   이미 가려 주므로 도달하면 안 되지만, 방어로 남긴다(조용히 다른 채널로 바꾸는 일은 없다).
 *
 * ## 개인정보
 * 수신처·이름·문안은 **제공자 요청 본문에만** 있다. 반환값(`SendOutcome.error`)과 로그에 남는 것은 `id`·템플릿 키·
 * 짧은 코드·HTTP 상태뿐이다. 제공자가 돌려준 사람이 읽는 문구는 통째로 버린다 — 거기에 수신 주소가 섞여 온다.
 * 코드조차 형태 검사(CODE_SHAPE)를 통과한 것만 싣는다. CODE_SHAPE 는 `@`·공백을 허용하지 않으므로 메일 주소는 통과하지 못한다.
 *
 * ## 근거로 삼은 것 — 그리고 **확인하지 못한 것**
 * 이 저장소에는 Resend SDK 가 없고(새 패키지 금지) 네트워크로 문서를 확인할 수단도 없었다. 그래서:
 *   - 엔드포인트·인증 형태(`POST /emails`, `Authorization: Bearer <key>`, JSON `{from,to,subject,text}`)는 **가정이다.**
 *     실키 스모크(게이트 ②)에서 첫 요청으로 확인해야 하는 값이며, 틀렸다면 4xx 가 와서 `provider_4xx:…` 로 드러난다.
 *   - **제공자 오류코드 표를 지어내지 않았다.** 분류는 HTTP 계층으로만 하고(`classifyHttpStatus` — RFC 9110 근거는
 *     solapi.ts 에 적어 두었다), 제공자가 준 코드 문자열은 그대로 실어 `last_error` 로 흘린다. P4-2 가 솔라피에서 한 것과 같다.
 *   - 성공 응답의 식별자 필드도 확인하지 못했다. `id` 로 보이는 문자열이 있으면 싣고, 없으면 `null` 로 둔다 —
 *     **2xx 를 실패로 되돌리지 않는다**(이미 접수된 메일을 다시 보내는 것이 더 나쁘다).
 */
import type { NotifyChannel } from "../types";
import type { TemplateKey } from "./outbox";
import type { NotificationSender, SendOutcome, SendRequest } from "./sender";
import { TEMPLATE_AUDIENCE, classifyHttpStatus, type TemplateVarsPort } from "./solapi";
import { renderTemplate, type CustomerVars, type OwnerVars, type RenderedMessage } from "./templates";

// =============================================================================
// 상수
// =============================================================================

/** 보고서·로그에 찍히는 이름(WorkerReport.sender). */
export const RESEND_SENDER_NAME = "resend";

/** 발송 엔드포인트. 실키 스모크 전까지는 가정값이다(§근거). */
export const RESEND_SEND_URL = "https://api.resend.com/emails";

/** 제공자 호출 1건의 상한. solapi 와 같은 값·같은 방식 — lease 5분 · 1회 claim 20건 안에 끝난다. */
export const RESEND_TIMEOUT_MS = 10_000;

/** 이 어댑터가 보낼 수 있는 채널. 메일 하나뿐이다(sender.ts `NotificationSender.channels`). */
export const RESEND_CHANNELS = ["email"] as const satisfies readonly NotifyChannel[];

/** 제목이 없는 문안 키로 메일을 보내려 한 경우. 문자 키를 메일 채널에 넣었다는 뜻이라 사람이 고쳐야 한다. */
export const MISSING_SUBJECT_CODE = "missing_subject";

/** 결과·로그에 실어도 되는 제공자 코드의 형태(solapi.ts 와 같다). `@`·공백이 없으므로 메일 주소는 통과하지 못한다. */
const CODE_SHAPE = /^[A-Za-z0-9_.-]{1,40}$/;

/**
 * 오류 본문에서 코드로 쓸 수 있는 후보 키. **제공자 문서를 확인하지 못했으므로**(§근거) 한 키에 걸지 않고
 * 흔한 이름을 순서대로 본다. 무엇을 찾든 CODE_SHAPE 를 통과한 것만 싣고, 없으면 `http_<status>` 로 갈음한다.
 */
const ERROR_CODE_KEYS = ["name", "code", "error", "type"] as const;

/** 수신처 형태 검사 — 국내/국외를 가르지 않는다(메일에는 국가번호 문제가 없다). 최소한의 모양만 본다. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// =============================================================================
// 포트
// =============================================================================

/** 런타임의 전역 fetch 가 그대로 들어간다. 테스트는 mock 을 준다(solapi.ts SolapiFetch 와 같은 형태). */
export type ResendFetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * 로그 항목 — lib/log.ts StructuredLogEntry 의 부분형이라 structuredLog 를 그대로 넘길 수 있다.
 * **수신처·본문·제공자 문구는 없다.** 남는 것은 행 id·템플릿 키·짧은 코드·HTTP 상태뿐이다.
 */
export interface ResendLogEntry {
  level: "warn";
  event: "notify.resend_failed";
  id: number;
  template: string;
  code: string;
  retryable: boolean;
  httpStatus?: number;
}

export interface ResendDeps {
  /** RESEND_API_KEY. 헤더에만 쓰고 반환값·로그에 싣지 않는다. */
  apiKey: string;
  /** MAIL_FROM — 인증된 발신 도메인의 주소. 발신 도메인은 `send.` 서브도메인으로 분리한다(플랜 §P4-5 · .env.example 주석). */
  from: string;
  fetch: ResendFetch;
  log: (entry: ResendLogEntry) => void;
  /**
   * 문안 변수 조회(P4-2b, lib/notify/vars.ts). 없으면 `configured=false` 라 worker 가 claim 하지 않는다 —
   * 문안을 만들 수 없는 발송기도 보낼 수 없는 발송기다(solapi.ts 와 같은 규약).
   */
  vars?: TemplateVarsPort;
  /** 기본 RESEND_TIMEOUT_MS. 상한을 넘겨 주면 상한으로 깎는다(lease 를 넘길 수 없다). */
  timeoutMs?: number;
}

export interface ResendSender extends NotificationSender {
  /** 비어 있는 구성 항목 이름 — configured 가 false 인 이유를 사람이 바로 본다. */
  readonly missing: readonly string[];
  /** 실제로 적용된 타임아웃(ms). */
  readonly timeoutMs: number;
}

// =============================================================================
// 순수
// =============================================================================

const nonEmpty = (v: string | undefined): v is string => typeof v === "string" && v.trim().length > 0;

/** 메일 주소 형태인가. 앞뒤 공백은 잘라 본다(env 에서 오는 값이다). */
export function isEmailAddress(raw: string | undefined): boolean {
  return typeof raw === "string" && EMAIL_SHAPE.test(raw.trim());
}

/** 결과·로그에 실어도 되는 코드만 통과시킨다. 그 밖은 'unknown' — 제공자 문구가 코드 자리로 새는 것을 막는다. */
function safeCode(raw: unknown): string {
  if (typeof raw !== "string") return "unknown";
  const trimmed = raw.trim();
  return CODE_SHAPE.test(trimmed) ? trimmed : "unknown";
}

/** 예외에서 이름만 꺼낸다. message 는 버린다 — 제공자 예외 문구에는 요청 본문(수신처)이 섞인다. */
function exceptionName(err: unknown): string {
  if (typeof err === "object" && err !== null && typeof (err as { name?: unknown }).name === "string") {
    return safeCode((err as { name: string }).name);
  }
  return typeof err;
}

const asRecord = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {});
const asString = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** 오류 본문 → 짧은 코드. 후보 키를 순서대로 보고, 형태 검사를 통과한 첫 값만 쓴다. */
function errorCode(body: unknown, status: number): string {
  const record = asRecord(body);
  for (const key of ERROR_CODE_KEYS) {
    const code = safeCode(record[key]);
    if (code !== "unknown") return code;
  }
  return `http_${status}`;
}

/** 사장님 문안인가(solapi.ts TEMPLATE_AUDIENCE 와 같은 표를 본다 — 표를 두 벌 두지 않는다). */
function isOwnerTemplate(key: TemplateKey): key is "created.owner.sms" | "created.owner.email" {
  return TEMPLATE_AUDIENCE[key] === "owner";
}

// =============================================================================
// 어댑터
// =============================================================================

export function resendSender(deps: ResendDeps): ResendSender {
  const missing: string[] = [];
  if (!nonEmpty(deps.apiKey)) missing.push("apiKey");
  if (!isEmailAddress(deps.from)) missing.push("from");
  if (deps.vars === undefined) missing.push("vars");

  const from = (deps.from ?? "").trim();
  const timeoutMs = Math.min(Math.max(1, deps.timeoutMs ?? RESEND_TIMEOUT_MS), RESEND_TIMEOUT_MS);

  return {
    name: RESEND_SENDER_NAME,
    configured: missing.length === 0,
    channels: RESEND_CHANNELS,
    missing,
    timeoutMs,

    async send(req: SendRequest): Promise<SendOutcome> {
      if (missing.length > 0) {
        // worker·라우터는 configured 를 보고 멈춰야 한다 — 여기 왔다면 그쪽 버그다(sender.ts 와 같은 규약).
        throw new Error(
          `resendSender.send: 미구성 sender 로 send 가 호출됐다 (id=${req.id}, 빈 항목=${missing.join(",")}) — configured 를 먼저 확인해야 한다`,
        );
      }

      const fail = (code: string, retryable: boolean, httpStatus?: number): SendOutcome => {
        deps.log({
          level: "warn",
          event: "notify.resend_failed",
          id: req.id,
          template: req.template,
          code,
          retryable,
          ...(httpStatus === undefined ? {} : { httpStatus }),
        });
        return { ok: false, error: code, retryable };
      };

      // ── 채널 ────────────────────────────────────────────────────────────
      // 0014 의 claim 채널 필터가 이미 가려 준다. 여기 온 행은 큐·배선이 어긋났다는 뜻이므로 조용히 보내지 않는다.
      if (req.channel !== "email") {
        return fail(`unsupported_channel:${safeCode(req.channel)}`, false);
      }

      const to = (req.to ?? "").trim();
      if (!isEmailAddress(to)) return fail("unsupported_recipient", false);

      // ── 문안 ────────────────────────────────────────────────────────────
      let rendered: RenderedMessage;
      if (isOwnerTemplate(req.template)) {
        let vars: OwnerVars | null;
        try {
          vars = await (deps.vars as TemplateVarsPort).ownerVars(req.reservationId);
        } catch {
          return fail("vars_load_failed", true);
        }
        if (vars === null) return fail("reservation_not_found", false);
        try {
          rendered = renderTemplate(req.template, vars);
        } catch {
          return fail("template_render_failed", false);
        }
      } else {
        let vars: CustomerVars | null;
        try {
          vars = await (deps.vars as TemplateVarsPort).customerVars(req.reservationId);
        } catch {
          return fail("vars_load_failed", true);
        }
        if (vars === null) return fail("reservation_not_found", false);
        try {
          rendered = renderTemplate(req.template, vars);
        } catch {
          return fail("template_render_failed", false);
        }
      }

      // 제목은 메일 키에만 있다(templates.ts). 없다는 것은 문자 문안을 메일 채널로 보내려 했다는 뜻이다 —
      // 제목을 지어내지 않고 멈춘다. 다시 시도해도 같은 결과이므로 재시도하지 않는다.
      const subject = rendered.subject;
      if (!nonEmpty(subject)) return fail(MISSING_SUBJECT_CODE, false);

      // ── 요청 ────────────────────────────────────────────────────────────
      // 한 건씩 보낸다(SendRequest 가 한 건이다). 본문은 평문 네 항목뿐 — html 을 만들지 않는다.
      let res: Response;
      try {
        res = await deps.fetch(RESEND_SEND_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${deps.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ from, to, subject, text: rendered.text }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const name = exceptionName(err);
        return name === "TimeoutError" ? fail("provider_timeout", true) : fail(`provider_network:${name}`, true);
      }

      // ── 응답 ────────────────────────────────────────────────────────────
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }

      if (!res.ok) {
        return fail(`provider_${res.status}:${errorCode(body, res.status)}`, classifyHttpStatus(res.status), res.status);
      }

      // 2xx 는 접수된 것으로 본다. 식별자를 못 읽어도 실패로 되돌리지 않는다 — 다시 보내면 사장님이 두 통을 받는다.
      return { ok: true, providerMessageId: asString(asRecord(body).id) };
    },
  };
}
