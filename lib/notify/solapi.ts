/**
 * Solapi 발송 어댑터 (플랜 v4 P4-2 · ADR-7).
 *
 * `lib/notify/sender.ts` 의 `NotificationSender` 구현 하나다. worker 는 이 파일을 모르고, 이 파일은 worker 를 모른다.
 * **키가 아직 없다** — 그래서 이 파일은 키가 오든 안 오든 구조가 같도록 짰다: 키·발신번호·시계·난수·fetch·로그·문안 변수까지
 * 전부 주입받고, 환경변수는 `app/api/cron/notify/route.ts` 의 `selectSender()` 에서만 읽는다(P4-1 이 세운 경계).
 *
 * 가장 중요한 규칙 — **하나라도 비면 `configured = false`.** worker 는 그때 claim 조차 하지 않는다(worker.ts 헤더).
 * claim 은 attempts 를 +1 하고 lease 를 건다. "보낼 준비가 된 척" 하는 sender 는 큐에 쌓인 모든 행의 5회를 조용히 태워
 * 키가 온 뒤에도 영영 보낼 수 없게 만든다. 그래서 `configured` 는 **키 3종뿐 아니라 문안 변수 포트까지** 본다 —
 * 문안을 만들 수 없는 sender 도 보낼 수 없는 sender 이기 때문이다(§ 아래 "아직 없는 것").
 *
 * 무엇을 보내지 않는가
 * ---------------------------------------------------------------------------
 * - **알림톡을 보내지 않는다.** 카카오 비즈니스 채널 인증과 템플릿 심사(P4-0)가 사장님 대기다. 심사받지 않은 템플릿으로
 *   알림톡을 보내면 제공자가 거부한다. 그렇다고 조용히 문자로 바꾸지도 않는다 — 사장님은 "카카오톡으로 나갔다" 고 믿게 되고,
 *   실제로 나간 것은 다른 채널이다. `channel = 'alimtalk'` 은 **명시적으로 거부**한다(ALIMTALK_REFUSED_CODE).
 *   P4-0 이 끝난 뒤 열 자리는 send() 안 "★ P4-0 이 끝난 뒤 열 자리 ★" 주석에 조건과 함께 표시해 두었다.
 * - **메일을 보내지 않는다.** `channel = 'email'`(사장님 번호가 없을 때의 폴백)은 P4-5 트랜잭션 메일의 몫이다.
 * - **국외 번호를 보내지 않는다.** 아웃박스의 수신처는 E.164 다(lib/reservations/phone.ts). `+82` 만 국내 표기로 바꿔 보내고
 *   그 밖의 국가번호는 거부한다 — 국가번호를 쪼개는 표를 지어내지 않는다.
 *
 * 개인정보
 * ---------------------------------------------------------------------------
 * 수신처·이름·문안은 **제공자 요청 본문에만** 있다. 반환값(`SendOutcome.error`)과 로그에 남는 것은 `id`·`template`·
 * 짧은 코드·HTTP 상태뿐이다. 제공자가 돌려준 사람이 읽는 문구(`errorMessage`)는 통째로 버린다 — 거기에 수신번호가 섞여 온다.
 * 코드조차 형태 검사를 통과한 것만 싣는다(CODE_SHAPE).
 *
 * 근거로 삼은 것 (네트워크 접근 없이 확인 가능한 출처)
 * ---------------------------------------------------------------------------
 * 공식 SDK `solapi@6.0.1` 이 이미 이 저장소의 node_modules 에 있다. 이 파일은 그것을 **쓰지 않고**(브리프: 새 패키지 0,
 * HTTP 는 주입된 fetch 로만) 형태만 대조했다:
 *   - 서명 헤더 문자열      node_modules/solapi/dist/index.js:1261
 *   - salt 길이 32자        같은 파일 :1255
 *   - 엔드포인트            같은 파일 :2516 (`messages/v4/send-many/detail`), base :1539
 *   - 요청 필드             같은 파일 :972 (messageSchema) · :2504 (messages/allowDuplicates/showMessageList)
 *   - 응답 필드             같은 파일 :2717 (failedMessageSchema) · :2735 (detailGroupMessageResponseSchema) · :1077 (groupInfo)
 *   - 오류 본문 {errorCode, errorMessage}  같은 파일 :104 · :1295
 * **개별 오류 코드 문자열의 의미는 오프라인에서 확인할 수 없었다.** 그래서 코드 문자열에 의존하는 분류표를 지어내지 않고
 * HTTP 계층으로 판정하고, 제공자 코드는 그대로 실어 로그에 남긴다(PROVIDER_CODE_RETRYABLE 은 실키 스모크 뒤 채운다).
 */
import { createHmac } from "node:crypto";

import type { TemplateKey } from "./outbox";
import type { NotificationSender, SendOutcome, SendRequest } from "./sender";
import { renderTemplate, type CustomerVars, type OwnerVars, type RenderedMessage } from "./templates";

// =============================================================================
// 상수
// =============================================================================

/** 보고서·로그에 찍히는 이름(WorkerReport.sender). */
export const SOLAPI_SENDER_NAME = "solapi";

/** 그룹 발송 엔드포인트. 한 건씩 보내지만(브리프) 제공자가 노출하는 접수 API 가 이것이다 — SDK :1539 + :2516. */
export const SOLAPI_SEND_URL = "https://api.solapi.com/messages/v4/send-many/detail";

/**
 * 제공자 호출 1건의 상한. P4-1 §7-10: lease 5분 · 1회 claim 20건이므로 10초 × 20 = 200초로 lease 안에 끝난다.
 * 넘으면 `{ ok:false, retryable:true }` — 다음 크론이 다시 잡는다.
 */
export const SOLAPI_TIMEOUT_MS = 10_000;

/** salt 바이트 수. hex 로 32자가 되어 SDK(:1255)의 salt 길이와 같다. */
export const SOLAPI_SALT_BYTES = 16;

/** 알림톡 거부 사유 코드. P4-0(채널 인증·템플릿 심사) 완료 전까지 이 어댑터는 알림톡을 보내지 않는다. */
export const ALIMTALK_REFUSED_CODE = "alimtalk_not_enabled";

/**
 * 이 어댑터가 보낼 수 있는 채널(P4-5 · sender.ts `NotificationSender.channels`). **문자 하나뿐이다.**
 * 알림톡은 P4-0 대기라 아래 send 가 명시적으로 거부하므로 여기 넣지 않는다 — 넣으면 worker 가 알림톡 행을 claim 해
 * 보낼 수도 없는 행의 attempts 를 태운다. 메일은 lib/notify/mail.ts 의 몫이다.
 * (타입 대조는 아래 solapiSender 의 반환 타입이 한다 — 이 파일은 `../types` 를 import 하지 않는다.)
 */
export const SOLAPI_CHANNELS = ["sms"] as const;

/** 결과·로그에 실어도 되는 제공자 코드의 형태. 통과하지 못하면 'unknown' 으로 갈음한다(사람이 읽는 문구 유입 차단). */
const CODE_SHAPE = /^[A-Za-z0-9_.-]{1,40}$/;

/** 템플릿 키 → 수신자. 고객 문안은 개인정보를 요구하지 않으므로 조회 경로 자체를 나눈다. */
export const TEMPLATE_AUDIENCE: Record<TemplateKey, "owner" | "customer"> = {
  "created.owner.sms": "owner",
  "created.owner.email": "owner",
  "created.customer.sms": "customer",
  "confirmed.customer.sms": "customer",
  // 발송 실패 알림(P4-4)은 **사장님께 가지만 값은 'customer'** 다. 이 표가 가르는 것은 수신자가 아니라
  // **어느 변수 집합을 싣는가**이고(아래 isOwnerTemplate → ownerVars / customerVars), 실패 알림에 고객 이름·전화를
  // 다시 실을 이유가 없다. `CustomerVars` 에는 그 필드가 타입에 없어 구조적으로 샐 수 없다(templates.ts TemplateVarsByKey).
  "created.owner.failure.email": "customer",
  "confirmed.owner.failure.email": "customer",
};

/**
 * 제공자 코드별 재시도 판정 예외표. **비어 있는 것이 지금의 정직한 상태다** — 실키가 없어 코드 문자열의 의미를
 * 확인할 방법이 없었고, 확인하지 않은 코드를 지어 넣으면 그것이 그대로 운영 판정이 된다.
 * 여기 없는 코드는 전부 `retryable: true`(보수적 기본값, 브리프). 실키 스모크에서 실제 코드를 모아 채운다.
 */
export const PROVIDER_CODE_RETRYABLE: Readonly<Record<string, boolean>> = {};

// =============================================================================
// 포트
// =============================================================================

/** 런타임의 전역 fetch 함수가 그대로 들어간다. 테스트는 mock 을 준다(lib/guard/types.ts FetchLike 와 같은 형태). */
export type SolapiFetch = (input: string, init: RequestInit) => Promise<Response>;

/** 암호학적 난수 — 서버는 `(n) => randomBytes(n)`(node:crypto). 테스트는 고정 바이트로 서명을 못 박는다. */
export type SolapiRandomBytes = (n: number) => Uint8Array;

/**
 * 로그 항목 — lib/log.ts StructuredLogEntry 의 부분형이라 structuredLog 를 그대로 넘길 수 있다.
 * **수신처·본문·제공자 문구는 없다.** 남는 것은 행 id·템플릿 키·짧은 코드·HTTP 상태뿐이다.
 */
export interface SolapiLogEntry {
  level: "warn";
  event: "notify.solapi_failed";
  id: number;
  template: string;
  code: string;
  retryable: boolean;
  httpStatus?: number;
}

/**
 * 예약 → 문안 변수. 문안은 lib/notify/templates.ts 가 만들고(P4-3), 이 어댑터는 문장을 짓지 않는다.
 *
 * 왜 두 함수인가: 고객 문안(`CustomerVars`)에는 이름·전화가 **타입에 없다**(templates.ts 헤더 4번). 조회 경로를
 * 나눠 두면 고객 문자를 보내면서 개인정보를 읽어 오는 일이 구조적으로 생기지 않는다.
 * `null` = 그 예약이 없다(영구 실패). DB 순단 등은 throw 하면 된다 — 어댑터가 일시 실패로 처리한다.
 */
export interface TemplateVarsPort {
  ownerVars(reservationId: string): Promise<OwnerVars | null>;
  customerVars(reservationId: string): Promise<CustomerVars | null>;
}

export interface SolapiDeps {
  /** SOLAPI_API_KEY. */
  apiKey: string;
  /** SOLAPI_API_SECRET. 서명에만 쓰고 어디에도 싣지 않는다. */
  apiSecret: string;
  /** SMS_SENDER — 제공자에 **사전등록된** 발신번호(P0-7). 형식만 검사할 수 있고 등록 여부는 실패 코드로만 안다. */
  from: string;
  fetch: SolapiFetch;
  now: () => Date;
  randomBytes: SolapiRandomBytes;
  log: (entry: SolapiLogEntry) => void;
  /**
   * 문안 변수 조회. **아직 구현이 없다** — 없으면 `configured = false` 라 worker 가 claim 하지 않는다.
   * 보고서 §"아직 없는 것" 참조: 키와 나란히 놓인 두 번째 선행조건이다.
   */
  vars?: TemplateVarsPort;
  /** 기본 SOLAPI_TIMEOUT_MS. 상한을 넘겨 주면 상한으로 깎는다(lease 를 넘길 수 없다). */
  timeoutMs?: number;
}

export interface SolapiSender extends NotificationSender {
  /** 비어 있는 구성 항목 이름 — 진단용. configured 가 false 인 이유를 사람이 바로 본다. */
  readonly missing: readonly string[];
  /** 실제로 적용된 타임아웃(ms). */
  readonly timeoutMs: number;
}

// =============================================================================
// 순수 — 서명 · 번호 · 분류
// =============================================================================

const nonEmpty = (v: string | undefined): v is string => typeof v === "string" && v.trim().length > 0;

/** 난수 → hex salt. 매 요청 새로 만든다(같은 시각이어도 서명이 달라진다). */
export function solapiSalt(randomBytes: SolapiRandomBytes): string {
  const bytes = randomBytes(SOLAPI_SALT_BYTES);
  if (bytes.length !== SOLAPI_SALT_BYTES) {
    throw new Error(`solapiSalt: randomBytes(${SOLAPI_SALT_BYTES}) 가 ${SOLAPI_SALT_BYTES}바이트를 돌려주지 않았다`);
  }
  return Buffer.from(bytes).toString("hex");
}

/**
 * `Authorization: HMAC-SHA256 apiKey=…, date=…, salt=…, signature=…`
 * 서명 = HMAC-SHA256(date + salt, apiSecret) 의 hex. 형태는 SDK :1261 과 바이트 단위로 같다.
 * 시크릿은 서명 안에만 들어가고 헤더에 평문으로 나오지 않는다.
 */
export function authorizationHeader(apiKey: string, apiSecret: string, date: string, salt: string): string {
  const signature = createHmac("sha256", apiSecret).update(date + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

/**
 * 국내 표기로 정규화. 아웃박스의 고객 번호는 E.164(`+8210…`), 사장님 번호는 env 원문(`010…`·`1566-…`)이다.
 * 국외 번호는 null — 국가번호를 쪼개는 표를 지어내지 않는다(보고서 §판단이 갈린 지점).
 */
export function normalizeKrNumber(raw: string): string | null {
  const compact = (raw ?? "").trim().replace(/[\s()-]/g, "");
  let national: string;
  if (compact.startsWith("+82")) national = `0${compact.slice(3)}`;
  else if (compact.startsWith("+")) return null;
  else national = compact;
  if (!/^\d+$/.test(national)) return null;
  // 0으로 시작하는 9~11자리(휴대전화·지역번호) 또는 8자리 대표번호(15xx·16xx·18xx).
  return /^0\d{8,10}$/.test(national) || /^1\d{7}$/.test(national) ? national : null;
}

/**
 * HTTP 상태 → 재시도 가능 여부.
 *   408·429  다시 하라는 뜻이다(RFC 9110 §15.5.9 · §15.5.30).
 *   5xx      제공자 쪽 문제 — SDK 도 503 을 재시도 대상으로 본다(:1394).
 *   그 밖 4xx 같은 바이트를 다시 보내도 같은 답이다(RFC 9110 §15.5 "the client seems to have erred").
 *            잔액 부족·발신번호 미등록·수신거부·서명 오류·형식 오류가 전부 여기로 온다.
 */
export function classifyHttpStatus(status: number): boolean {
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  if (status >= 400) return false;
  return true;
}

/** 제공자 코드 → 재시도 가능 여부. **표에 없으면 true**(보수적 기본값). */
export function classifyProviderCode(code: string, table: Readonly<Record<string, boolean>> = PROVIDER_CODE_RETRYABLE): boolean {
  const known = table[code];
  return typeof known === "boolean" ? known : true;
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

/** 사장님 문안인가. TEMPLATE_AUDIENCE 와 짝을 이룬다(키 4개는 outbox.ts TEMPLATE_KEYS 가 고정). */
function isOwnerTemplate(key: TemplateKey): key is "created.owner.sms" | "created.owner.email" {
  return TEMPLATE_AUDIENCE[key] === "owner";
}

// =============================================================================
// 어댑터
// =============================================================================

export function solapiSender(deps: SolapiDeps): SolapiSender {
  const missing: string[] = [];
  if (!nonEmpty(deps.apiKey)) missing.push("apiKey");
  if (!nonEmpty(deps.apiSecret)) missing.push("apiSecret");
  if (normalizeKrNumber(deps.from ?? "") === null) missing.push("from");
  if (deps.vars === undefined) missing.push("vars");

  const from = normalizeKrNumber(deps.from ?? "") ?? "";
  const timeoutMs = Math.min(Math.max(1, deps.timeoutMs ?? SOLAPI_TIMEOUT_MS), SOLAPI_TIMEOUT_MS);

  return {
    name: SOLAPI_SENDER_NAME,
    configured: missing.length === 0,
    // 문자뿐이다(P4-5). 알림톡·메일 행을 worker 가 claim 하지 않게 하는 값이며, 아래 send 의 거부 분기와 짝을 이룬다.
    channels: SOLAPI_CHANNELS,
    missing,
    timeoutMs,

    async send(req: SendRequest): Promise<SendOutcome> {
      if (missing.length > 0) {
        // worker 는 configured 를 보고 claim 전에 멈춰야 한다 — 여기 왔다면 worker 의 버그다(sender.ts 와 같은 규약).
        throw new Error(
          `solapiSender.send: 미구성 sender 로 send 가 호출됐다 (id=${req.id}, 빈 항목=${missing.join(",")}) — configured 를 먼저 확인해야 한다`,
        );
      }

      const fail = (code: string, retryable: boolean, httpStatus?: number): SendOutcome => {
        deps.log({
          level: "warn",
          event: "notify.solapi_failed",
          id: req.id,
          template: req.template,
          code,
          retryable,
          ...(httpStatus === undefined ? {} : { httpStatus }),
        });
        return { ok: false, error: code, retryable };
      };

      // ── 채널 ────────────────────────────────────────────────────────────
      // 알림톡(ATA)은 여기서 끝난다. **문자로 바꾸지 않는다** — 사장님이 카카오톡으로 나갔다고 믿게 되기 때문이다.
      //
      // ★ P4-0 이 끝난 뒤 열 자리 ★
      //   선행조건 3가지가 전부 충족돼야 한다:
      //     ① 카카오 비즈니스 채널 인증 완료(P0-8) ② Solapi 발신프로필(pfId) 등록 ③ 템플릿 2종 심사 통과(templateId 발급)
      //   그때 이 분기를 지우고, 아래 sendMessage 에서 type 을 알림톡용으로 바꾸고 pfId·templateId·변수와
      //   실패 시 문자 대체(disableSms=false)를 담은 카카오 옵션을 message 에 붙인다. 문안은
      //   lib/notify/templates.ts ALIMTALK_TEMPLATES 의 심사 제출본과 **글자 그대로** 같아야 한다.
      //   버튼도 그 초안의 `buttons`(웹링크 — 예약확인 · 이용안내)를 그대로 등록·전송한다(R3 [P2-H]).
      //   pfId·templateId 는 제공자 콘솔에서 발급받는 값이라 여기서 지어내지 않는다 — env 로 주입한다.
      if (req.channel === "alimtalk") {
        return fail(ALIMTALK_REFUSED_CODE, false);
      }
      if (req.channel !== "sms") {
        // 사장님 번호가 없을 때의 메일 폴백(outbox.ts planNotifications). 발송은 P4-5 트랜잭션 메일의 몫이다.
        return fail(`unsupported_channel:${safeCode(req.channel)}`, false);
      }

      const to = normalizeKrNumber(req.to);
      if (to === null) return fail("unsupported_recipient", false);

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

      // ── 요청 ────────────────────────────────────────────────────────────
      // 한 건씩 보낸다(SendRequest 가 한 건이다). 묶음 최적화를 하면 부분 성공을 행 단위로 되돌릴 수 없다.
      // autoTypeDetect 는 끈다 — 길이 판정은 P4-3(templates.ts)이 이미 했고, 제공자가 조용히 바꾸면 요금과 문안이 어긋난다.
      const payload = {
        messages: [{ to, from, text: rendered.text, type: rendered.format.toUpperCase(), autoTypeDetect: false }],
        allowDuplicates: false,
        showMessageList: true,
      };
      const date = deps.now().toISOString();
      const headers = {
        Authorization: authorizationHeader(deps.apiKey, deps.apiSecret, date, solapiSalt(deps.randomBytes)),
        "Content-Type": "application/json",
      };

      let res: Response;
      try {
        res = await deps.fetch(SOLAPI_SEND_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
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
        const code = safeCode(asRecord(body).errorCode);
        const shown = code === "unknown" ? `http_${res.status}` : code;
        return fail(`provider_${res.status}:${shown}`, classifyHttpStatus(res.status), res.status);
      }
      if (body === null) return fail("provider_bad_json", true);

      const root = asRecord(body);
      const failedList = Array.isArray(root.failedMessageList) ? root.failedMessageList : [];
      if (failedList.length > 0) {
        // 접수 단계에서 거절된 건. 코드의 의미를 아직 확인하지 못했으므로 표에 없으면 보수적으로 재시도 가능으로 둔다.
        const code = safeCode(asRecord(failedList[0]).statusCode);
        return fail(`provider_rejected:${code}`, classifyProviderCode(code));
      }

      const groupInfo = asRecord(root.groupInfo);
      const count = asRecord(groupInfo.count);
      const registered = typeof count.registeredSuccess === "number" ? count.registeredSuccess : 0;
      if (registered < 1) return fail("provider_no_accepted", true);

      const messageList = Array.isArray(root.messageList) ? root.messageList : [];
      const providerMessageId = asString(asRecord(messageList[0]).messageId) ?? asString(groupInfo.groupId);
      return { ok: true, providerMessageId };
    },
  };
}
