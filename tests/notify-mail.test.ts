/**
 * P4-5 — Resend 트랜잭션 메일 어댑터 계약 테스트 (플랜 v4 §P4-5 · ADR-7).
 *
 * 브리프 §검증 5 를 그대로 단언한다:
 *   1. configured: apiKey·from·vars 중 하나라도 없으면 false → worker 가 claim 조차 하지 않는다 (missing 에 이름이 남는다)
 *   2. 요청 모양: POST https://api.resend.com/emails · Bearer · { from, to, subject, text } — **HTML 없음**
 *   3. 제목은 renderTemplate 의 subject 그대로. 없으면(문자 키) missing_subject — 지어내지 않는다
 *   4. 실패 분류: 4xx → 비재시도 · 408·429·5xx·네트워크·타임아웃 → 재시도
 *   5. 개인정보 0: 수신처·이름·문안·응답 본문은 로그·반환값에 0
 *   6. channel !== 'email' 거부 (claim 이 가려주지만 방어로 남긴다)
 *   7. 광고 0: (광고)·수신거부 문구를 만들지 않는다
 *   8. 정적: env 는 lib/notify/deps.ts 에만(P4-7 에서 route.ts 에서 옮김) · 새 패키지 0 · 전역 fetch 0
 *
 * **실제 네트워크·실제 발송 0** — fetch 는 전부 주입된 가짜다. 이 파일 어디에도 globalThis.fetch 를 쓰지 않는다.
 * 주의: tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  RESEND_CHANNELS,
  RESEND_SENDER_NAME,
  RESEND_SEND_URL,
  RESEND_TIMEOUT_MS,
  UNSAFE_ROW_ID_CODE,
  idempotencyKey,
  resendSender,
  type ResendDeps,
  type ResendFetch,
  type ResendLogEntry,
} from "@/lib/notify/mail";
import { CLAIM_LEASE_MS, MAX_ATTEMPTS, QUARANTINE_RETRY_AFTER_MS, retryPlanAfterFailure } from "@/lib/notify/outbox";
import { memorySender, type SendRequest } from "@/lib/notify/sender";
import { MARK_SENT_RETRY_DELAYS_MS, runNotificationWorker, type PendingStats, type WorkerDb, type WorkerLogEntry } from "@/lib/notify/worker";
import type { NewOutboxRow, OutboxRow } from "@/lib/types";
import type { TemplateVarsPort } from "@/lib/notify/solapi";
import { renderTemplate, type CustomerVars, type OwnerVars } from "@/lib/notify/templates";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");

// =============================================================================
// 고정값
// =============================================================================

const API_KEY = "re_TESTKEYMUSTNEVERAPPEAR0001";
/** 발신 도메인은 서브도메인 분리(플랜 §P4-5) — 실값은 사장님 대기라 테스트 전용 예시 도메인을 쓴다. */
const MAIL_FROM = "no-reply@send.example.test";
const TO = "owner@example.test";
const RID = "00000000-0000-4000-8000-000000000042";
const CUSTOMER_NAME = "홍길동";
const CUSTOMER_PHONE_IN_BODY = "010-1234-5678";

const CUSTOMER_VARS: CustomerVars = { publicCode: "ABCD2345", origin: "https://example.test" };
const OWNER_VARS: OwnerVars = {
  ...CUSTOMER_VARS,
  reservationId: RID,
  name: CUSTOMER_NAME,
  phone: CUSTOMER_PHONE_IN_BODY,
  vehicleLabel: "45인승 우등",
  departAtKst: "2026-10-01 08:00",
  originLabel: "서울",
  destinationLabel: "부산",
  busCount: 1,
  passengers: 40,
};

const varsPort: TemplateVarsPort = {
  async ownerVars() {
    return OWNER_VARS;
  },
  async customerVars() {
    return CUSTOMER_VARS;
  },
};

const req = (over: Partial<SendRequest> = {}): SendRequest => ({
  id: 51,
  channel: "email",
  to: TO,
  template: "created.owner.email",
  reservationId: RID,
  ...over,
});

interface Call {
  url: string;
  init: RequestInit;
}

function recordingFetch(respond: (call: Call) => Response | Promise<Response>): ResendFetch & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return respond({ url, init });
  };
  return Object.assign(fn, { calls });
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** 접수 성공 응답. 제공자 문서를 오프라인에서 확인할 수 없어 id 필드 하나만 가정하고, 없으면 null 로 떨어진다(§3). */
const acceptedBody = (id = "11111111-2222-3333-4444-555555555555") => ({ id });

const logSpy = (): ((e: ResendLogEntry) => void) & { entries: ResendLogEntry[] } => {
  const entries: ResendLogEntry[] = [];
  const fn = (e: ResendLogEntry) => {
    entries.push(e);
  };
  return Object.assign(fn, { entries });
};

function deps(over: Partial<ResendDeps> = {}): ResendDeps {
  return {
    apiKey: API_KEY,
    from: MAIL_FROM,
    fetch: recordingFetch(() => jsonResponse(acceptedBody())),
    log: logSpy(),
    vars: varsPort,
    ...over,
  };
}

const bodyOf = (call: Call) => JSON.parse(String(call.init.body)) as Record<string, unknown>;

// =============================================================================
// 1. configured — 하나라도 비면 false
// =============================================================================
describe("1. configured", () => {
  test("전부 있으면 true · 이름은 resend · 채널은 메일 하나뿐", () => {
    const s = resendSender(deps());
    expect(s.configured).toBe(true);
    expect(s.name).toBe(RESEND_SENDER_NAME);
    expect(s.missing).toEqual([]);
    expect(s.channels).toEqual(["email"]);
    expect(RESEND_CHANNELS).toEqual(["email"]);
  });

  test.each([
    ["apiKey", { apiKey: "" }],
    ["apiKey", { apiKey: "   " }],
    ["from", { from: "" }],
    ["from", { from: "발신자" }],
    ["vars", { vars: undefined }],
  ])("%s 가 없으면 configured=false 이고 missing 에 이름이 남는다", (name, over) => {
    const s = resendSender(deps(over as Partial<ResendDeps>));
    expect(s.configured).toBe(false);
    expect(s.missing).toContain(name);
  });

  test("미구성이어도 channels 는 ['email'] 그대로다 — 켜짐 여부는 configured 가 말한다(라우터가 거른다)", () => {
    expect(resendSender(deps({ apiKey: "" })).channels).toEqual(["email"]);
  });

  test("미구성 sender 의 send 는 호출되면 안 된다 — throw (worker·라우터 버그 신호) · 네트워크 0", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const s = resendSender(deps({ apiKey: "", fetch }));
    await expect(s.send(req())).rejects.toThrow(/configured/);
    expect(fetch.calls).toHaveLength(0);
  });
});

// =============================================================================
// 2. 요청 모양 — 평문 · HTML 없음
// =============================================================================
describe("2. 요청", () => {
  test("POST /emails · Bearer 인증 · JSON — 엔드포인트가 고정돼 있다", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    await resendSender(deps({ fetch })).send(req());
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0].url).toBe(RESEND_SEND_URL);
    expect(RESEND_SEND_URL).toBe("https://api.resend.com/emails");
    expect(fetch.calls[0].init.method).toBe("POST");
    const headers = fetch.calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers["content-type"]).toBe("application/json");
  });

  test("본문은 { from, to, subject, text } 네 항목뿐 — html 을 만들지 않는다", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    await resendSender(deps({ fetch })).send(req());
    const body = bodyOf(fetch.calls[0]);
    expect(Object.keys(body).sort()).toEqual(["from", "subject", "text", "to"]);
    expect(body.from).toBe(MAIL_FROM);
    expect(body.to).toBe(TO);
    expect(body).not.toHaveProperty("html");
    expect(String(fetch.calls[0].init.body)).not.toMatch(/<[a-z]+>/i);
  });

  test("문안·제목은 renderTemplate 이 준 것 그대로 — 어댑터가 문장을 짓지 않는다", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    await resendSender(deps({ fetch })).send(req());
    const rendered = renderTemplate("created.owner.email", OWNER_VARS);
    const body = bodyOf(fetch.calls[0]);
    expect(body.text).toBe(rendered.text);
    expect(body.subject).toBe(rendered.subject);
    expect(rendered.subject).toBeTruthy();
  });

  test("사장님 문안은 사장님 변수로 읽는다 (고객 경로는 개인정보를 읽지 않는다)", async () => {
    const seen: string[] = [];
    const port: TemplateVarsPort = {
      async ownerVars(id) {
        seen.push(`owner:${id}`);
        return OWNER_VARS;
      },
      async customerVars(id) {
        seen.push(`customer:${id}`);
        return CUSTOMER_VARS;
      },
    };
    await resendSender(deps({ vars: port })).send(req());
    expect(seen).toEqual([`owner:${RID}`]);
  });

  test("수신처 형태가 메일이 아니면 보내지 않는다 — 번호를 결과에 싣지 않는다", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const out = await resendSender(deps({ fetch })).send(req({ to: "01098765432" }));
    expect(out).toEqual({ ok: false, error: "unsupported_recipient", retryable: false });
    expect(JSON.stringify(out)).not.toContain("01098765432");
    expect(fetch.calls).toHaveLength(0);
  });
});

// =============================================================================
// 3. 제목 — 없으면 보내지 않는다
// =============================================================================
describe("3. 제목", () => {
  test("문자 키에는 subject 가 없다 → missing_subject · 비재시도 · 네트워크 0", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const out = await resendSender(deps({ fetch })).send(req({ template: "created.customer.sms" }));
    expect(out).toEqual({ ok: false, error: "missing_subject", retryable: false });
    expect(fetch.calls).toHaveLength(0);
  });

  test("문안 변수를 못 찾으면(예약 없음) 영구 실패 · 조회가 throw 하면 일시 실패", async () => {
    const none: TemplateVarsPort = {
      async ownerVars() {
        return null;
      },
      async customerVars() {
        return null;
      },
    };
    expect(await resendSender(deps({ vars: none })).send(req())).toEqual({
      ok: false,
      error: "reservation_not_found",
      retryable: false,
    });

    const down: TemplateVarsPort = {
      async ownerVars() {
        throw new Error(`db down ${TO}`);
      },
      async customerVars() {
        throw new Error(`db down ${TO}`);
      },
    };
    const out = await resendSender(deps({ vars: down })).send(req());
    expect(out).toEqual({ ok: false, error: "vars_load_failed", retryable: true });
  });
});

// =============================================================================
// 4. 실패 분류
// =============================================================================
describe("4. 실패 분류", () => {
  test.each([
    [400, false],
    [401, false],
    [403, false],
    [404, false],
    [422, false],
    [408, true],
    [429, true],
    [500, true],
    [502, true],
    [503, true],
  ])("HTTP %i → retryable=%s", async (status, retryable) => {
    const out = await resendSender(deps({ fetch: recordingFetch(() => jsonResponse({ name: "provider_code" }, status)) })).send(req());
    expect(out).toEqual({ ok: false, error: `provider_${status}:provider_code`, retryable });
  });

  test("제공자가 준 코드를 그대로 흘린다 — 우리가 표를 지어내지 않는다", async () => {
    const out = await resendSender(deps({ fetch: recordingFetch(() => jsonResponse({ name: "validation_error" }, 422)) })).send(req());
    expect(out).toEqual({ ok: false, error: "provider_422:validation_error", retryable: false });
  });

  test("코드를 못 읽으면 http_<status> 로 갈음한다 (본문이 JSON 이 아니어도)", async () => {
    const out = await resendSender(deps({ fetch: recordingFetch(() => new Response("<html>보낼 수 없습니다</html>", { status: 500 })) })).send(req());
    expect(out).toEqual({ ok: false, error: "provider_500:http_500", retryable: true });
  });

  test("네트워크 오류는 예외 이름만 남기고 재시도 가능", async () => {
    const out = await resendSender(
      deps({
        fetch: recordingFetch(() => {
          throw Object.assign(new Error(`connect ECONNREFUSED ${TO}`), { name: "TypeError" });
        }),
      }),
    ).send(req());
    expect(out).toEqual({ ok: false, error: "provider_network:TypeError", retryable: true });
  });

  test("응답이 오지 않으면 signal 이 끊고 재시도 가능 — 실제 대기 없음(5ms)", async () => {
    const hanging: ResendFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason as Error));
      });
    const out = await resendSender(deps({ fetch: hanging, timeoutMs: 5 })).send(req());
    expect(out).toEqual({ ok: false, error: "provider_timeout", retryable: true });
  });

  test("타임아웃 상한은 10초 이하이고 1회 claim(20건)이 lease(5분) 안에 끝난다", async () => {
    expect(RESEND_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(RESEND_TIMEOUT_MS * 20).toBeLessThan(5 * 60_000);
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const s = resendSender(deps({ fetch, timeoutMs: 60_000 }));
    expect(s.timeoutMs).toBe(RESEND_TIMEOUT_MS);
    await s.send(req());
    expect(fetch.calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });
});

// =============================================================================
// 5. 성공
// =============================================================================
describe("5. 성공", () => {
  test("2xx → { ok:true, providerMessageId } — 제공자 id 를 그대로 싣는다", async () => {
    const out = await resendSender(deps({ fetch: recordingFetch(() => jsonResponse(acceptedBody("mail-777"))) })).send(req());
    expect(out).toEqual({ ok: true, providerMessageId: "mail-777" });
  });

  test("id 를 못 읽어도 2xx 면 성공이다 — 접수된 메일을 다시 보내지 않는다", async () => {
    const out = await resendSender(deps({ fetch: recordingFetch(() => new Response("", { status: 202 })) })).send(req());
    expect(out).toEqual({ ok: true, providerMessageId: null });
  });
});

// =============================================================================
// 6. 채널 — 메일만
// =============================================================================
describe("6. 채널", () => {
  test.each([
    ["sms", "created.customer.sms"],
    ["alimtalk", "created.customer.sms"],
  ])("channel=%s 는 이 어댑터가 보내지 않는다 (claim 이 가려주지만 방어로 남긴다)", async (channel, template) => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const out = await resendSender(deps({ fetch })).send(
      req({ channel: channel as SendRequest["channel"], template: template as SendRequest["template"], to: "01098765432" }),
    );
    expect(out).toEqual({ ok: false, error: `unsupported_channel:${channel}`, retryable: false });
    expect(fetch.calls).toHaveLength(0);
  });

  test("채널 값이 이상해도 오류 문자열에 그대로 싣지 않는다", async () => {
    const out = await resendSender(deps()).send(req({ channel: "메일 01098765432" as SendRequest["channel"] }));
    expect(out).toEqual({ ok: false, error: "unsupported_channel:unknown", retryable: false });
  });
});

// =============================================================================
// 7. 개인정보 0
// =============================================================================
describe("7. 개인정보 0", () => {
  const secrets = [TO, CUSTOMER_NAME, CUSTOMER_PHONE_IN_BODY];

  test("성공 경로: 요청 본문에는 있고(보내야 하니까) 로그·반환값에는 0", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const log = logSpy();
    const out = await resendSender(deps({ fetch, log })).send(req());

    const sent = String(fetch.calls[0].init.body);
    expect(sent).toContain(TO);
    expect(sent).toContain(CUSTOMER_NAME);

    for (const s of secrets) {
      expect(JSON.stringify(out), s).not.toContain(s);
      expect(JSON.stringify(log.entries), s).not.toContain(s);
    }
    expect(log.entries).toHaveLength(0);
  });

  test("실패 경로: 로그에는 id·template·코드·HTTP 상태뿐 — 응답 본문·수신처·문안 0", async () => {
    const log = logSpy();
    const out = await resendSender(
      deps({ log, fetch: recordingFetch(() => jsonResponse({ name: "validation_error", message: `${TO} 로는 보낼 수 없습니다` }, 422)) }),
    ).send(req());

    expect(out).toEqual({ ok: false, error: "provider_422:validation_error", retryable: false });
    expect(log.entries).toEqual([
      { level: "warn", event: "notify.resend_failed", id: 51, template: "created.owner.email", code: "provider_422:validation_error", retryable: false, httpStatus: 422 },
    ]);
    const rendered = renderTemplate("created.owner.email", OWNER_VARS);
    for (const s of [...secrets, rendered.text.slice(0, 20), "보낼 수 없습니다"]) {
      expect(JSON.stringify(out), s).not.toContain(s);
      expect(JSON.stringify(log.entries), s).not.toContain(s);
    }
  });

  test("API 키는 헤더에만 있고 반환값·로그에는 없다", async () => {
    const log = logSpy();
    const out = await resendSender(deps({ log, fetch: recordingFetch(() => jsonResponse({ name: "unauthorized" }, 401)) })).send(req());
    expect(JSON.stringify(out)).not.toContain(API_KEY);
    expect(JSON.stringify(log.entries)).not.toContain(API_KEY);
  });

  test("제공자 코드가 길거나 이상해도 짧고 안전한 코드로만 싣는다", async () => {
    const out = await resendSender(deps({ fetch: recordingFetch(() => jsonResponse({ name: `${TO} ${"x".repeat(200)}` }, 400)) })).send(req());
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).not.toContain(TO);
    expect(out.error.length).toBeLessThanOrEqual(64);
  });
});

// =============================================================================
// 9. 멱등성 키 — 보냈는데 못 적은 "같은 행"이 키 보존 기간 안에 다시 나가면 한 통만 도착한다 (P4-6)
//    막는 것은 행이다. failed 뒤 새로 넣은 대체 행(새 id)은 막지 않는다.
// =============================================================================
describe("9. 멱등성 키", () => {
  /** fetch 헤더는 대소문자를 가리지 않는다 — Headers 로 읽어 이름 표기에 기대지 않는다. */
  const keyOf = (call: Call): string | null => new Headers(call.init.headers).get("Idempotency-Key");

  const KEY_SHAPE = /^notify\/[a-z]+(\.[a-z]+)+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9]+$/;

  test("같은 행을 두 번 보내면 같은 키가 나간다 — 재시도·다른 크론 호출(새 sender 인스턴스)에서도", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    await resendSender(deps({ fetch })).send(req());
    // 첫 요청이 실패로 보였던 경우(타임아웃 뒤 재시도)를 흉내 — 시간이 흘러도 값이 같아야 한다.
    await new Promise((r) => setTimeout(r, 5));
    await resendSender(deps({ fetch })).send(req());
    const again = resendSender(deps({ fetch }));
    await again.send(req());

    expect(fetch.calls).toHaveLength(3);
    const keys = fetch.calls.map(keyOf);
    expect(keys[0]).toBeTruthy();
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe(`notify/created.owner.email/${RID}/51`);
  });

  test("실패 응답 뒤 재시도도 같은 키다 (500 → 202)", async () => {
    let n = 0;
    const fetch = recordingFetch(() => (n++ === 0 ? jsonResponse({ name: "internal_server_error" }, 500) : jsonResponse(acceptedBody())));
    const s = resendSender(deps({ fetch }));
    expect((await s.send(req())).ok).toBe(false);
    expect((await s.send(req())).ok).toBe(true);
    expect(keyOf(fetch.calls[0])).toBe(keyOf(fetch.calls[1]));
  });

  /**
   * 예약이 다르면 id 가 같아도 갈린다 — **독립적으로 만든** 환경끼리의 충돌만 막는다.
   * 운영 DB 를 복제한 환경은 예약 id·행 id 가 둘 다 같아 키가 겹친다(운영 규칙으로 막는다: 프리뷰·로컬은 다른 Resend 키).
   */
  test("다른 행은 다른 키 — id 가 다르거나, 같은 id 라도 예약(독립 생성된 다른 환경의 같은 id)이 다르면", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const s = resendSender(deps({ fetch }));
    await s.send(req({ id: 51 }));
    await s.send(req({ id: 52 }));
    await s.send(req({ id: 51, reservationId: "00000000-0000-4000-8000-000000000043" }));
    await s.send(req({ id: 51, template: "created.owner.failure.email" }));
    await s.send(req({ id: 5, reservationId: "00000000-0000-4000-8000-000000000042" }));
    await s.send(req({ id: 15 }));
    const keys = fetch.calls.map(keyOf);
    expect(keys).toHaveLength(6);
    expect(new Set(keys).size).toBe(6);
  });

  test("형태: Resend 한도(1–256자) 안 · 허용한 네 마디뿐 — 행 id 가 커도", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    await resendSender(deps({ fetch })).send(req({ id: Number.MAX_SAFE_INTEGER }));
    const key = keyOf(fetch.calls[0]) ?? "";
    expect(key).toMatch(KEY_SHAPE);
    expect(key.length).toBeGreaterThanOrEqual(1);
    expect(key.length).toBeLessThanOrEqual(256);
  });

  test.each([
    ["2^53", 2 ** 53],
    ["2^53+2", 2 ** 53 + 2],
    ["음수", -1],
    ["소수", 51.5],
    ["NaN", Number.NaN],
  ])("행 id 가 안전 정수가 아니면(%s) 키를 뭉개지 않고 보내지 않는다 — unsafe_row_id · 비재시도 · 네트워크 0", async (_label, id) => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const log = logSpy();
    const out = await resendSender(deps({ fetch, log })).send(req({ id }));
    expect(out).toEqual({ ok: false, error: UNSAFE_ROW_ID_CODE, retryable: false });
    expect(fetch.calls).toHaveLength(0);
    expect(log.entries.map((e) => e.code)).toEqual([UNSAFE_ROW_ID_CODE]);
    expect(() => idempotencyKey({ id, template: "created.owner.email", reservationId: RID })).toThrow(RangeError);
  });

  test("원문 연락처 필드가 키에 없다 — 수신처·이름·전화·문안·제목·API 키 (예약 uuid 는 간접 식별자로 남는다)", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const log = logSpy();
    const s = resendSender(deps({ fetch, log }));
    const rendered = renderTemplate("created.owner.email", OWNER_VARS);
    const rows: SendRequest[] = [
      req(),
      req({ template: "created.owner.failure.email" }),
      // 예약 id 자리에 개인정보가 흘러든 비정상 행 — 문안 조회 mock 은 그래도 변수를 주므로 요청까지 간다.
      req({ id: 77, reservationId: TO }),
      req({ id: 78, reservationId: `${CUSTOMER_NAME} ${CUSTOMER_PHONE_IN_BODY}` }),
    ];
    for (const r of rows) await s.send(r);
    expect(fetch.calls).toHaveLength(rows.length);

    const banned = [
      TO,
      "owner@",
      "example.test",
      "@",
      CUSTOMER_NAME,
      CUSTOMER_PHONE_IN_BODY,
      "01012345678",
      API_KEY,
      MAIL_FROM,
      String(rendered.subject),
      rendered.text.slice(0, 12),
      OWNER_VARS.vehicleLabel,
      OWNER_VARS.originLabel,
      OWNER_VARS.destinationLabel,
      CUSTOMER_VARS.publicCode,
    ];
    for (const call of fetch.calls) {
      const key = keyOf(call) ?? "";
      // 실패 알림 키는 행 번호 마디가 없다(P4-7 수정 라운드 2 — (예약·사건·문안키) 기준). 나머지는 행 번호로 끝난다.
      expect(key).toMatch(/^notify\/[a-z.]+\/[0-9a-f-]+(\/[0-9]+)?$/);
      // 한글·공백이 한 글자도 없다 — 이름·문안은 형태만으로 들어올 수 없다.
      expect(key).toMatch(/^[\x21-\x7e]+$/);
      for (const b of banned) expect(key, b).not.toContain(b);
    }
    // 예약 id 가 UUID 모양이 아니면 그 마디는 고정값으로 대체된다 — 두 비정상 행도 id 로는 여전히 갈린다.
    expect(keyOf(fetch.calls[2])).toBe("notify/created.owner.email/00000000-0000-0000-0000-000000000000/77");
    expect(keyOf(fetch.calls[3])).toBe("notify/created.owner.email/00000000-0000-0000-0000-000000000000/78");
    // 키를 로그·반환값에 따로 싣지 않는다(성공 경로는 로그 0).
    expect(log.entries).toHaveLength(0);
  });

  test("기존 헤더는 그대로 — 인증·콘텐츠 타입에 키 하나만 더해졌다", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    await resendSender(deps({ fetch })).send(req());
    const headers = fetch.calls[0].init.headers as Record<string, string>;
    expect(Object.keys(headers).sort()).toEqual(["authorization", "content-type", "idempotency-key"]);
  });

  // (P4-7 수정 라운드 2) 여기 있던 "재시도 간격 합 < 24시간" 명제는 크론이 하루 1회가 되며 거짓이 됐다. 그 위험을 숫자로 고정하는
  // 대신 **위험 자체를 줄였다**: 보냈는데 못 적은 행은 발송이 아니라 **기록을** 다시 시도하고(§10 첫 테스트), 끝내 못 적으면
  // 그 행을 claim 밖으로 격리한다(tests/outbox-worker.test.ts). 키 보존 기간에 기대는 곳은 "DB 가 기록도 격리도 못 받는" 경우뿐이다.

  // ── 실패 알림의 키 (P4-7 수정 라운드 2 · 리뷰 P1-3) ─────────────────────
  test("실패 알림 키는 행 id 가 아니라 (예약 · 사건 · 문안키) 기준 — 서로 다른 행 id 두 개가 같은 키를 낸다", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const s = resendSender(deps({ fetch }));
    await s.send(req({ id: 7001, template: "created.owner.failure.email" }));
    await s.send(req({ id: 7002, template: "created.owner.failure.email" }));
    await s.send(req({ id: 7003, template: "confirmed.owner.failure.email" }));
    const keys = fetch.calls.map(keyOf);
    expect(keys[0]).toBe(`notify/created.owner.failure.email/${RID}`);
    expect(keys[1]).toBe(keys[0]);
    // 사건이 다르면(접수 실패 vs 확정 실패) 문안키가 달라 키도 다르다 — 두 번째 사고를 놓치지 않는다
    expect(keys[2]).toBe(`notify/confirmed.owner.failure.email/${RID}`);
    // 예약 통지 키는 그대로 행 id 를 싣는다
    expect(idempotencyKey({ id: 51, template: "created.owner.email", reservationId: RID })).toBe(`notify/created.owner.email/${RID}/51`);
  });

  test("🔴 동시 give-up — 두 워커가 같은 예약의 두 통지를 동시에 종착시켜 알림 행이 둘 생겨도, 발송 호출의 중복 방지 키는 같다", async () => {
    // enqueue 의 사전 확인(SELECT)과 INSERT 사이 경합(outbox.ts enqueue — 부분 유니크는 sent 에만 걸린다)을 재현한다:
    // 두 워커 모두 "아직 없다" 를 보고 넣는다. 마이그레이션 없이는 이 두 행을 막을 수 없다 — 대신 **두 행이 한 통으로 합쳐진다.**
    const inserted: { id: number; row: NewOutboxRow }[] = [];
    let nextId = 7000;
    const lease = new Date(Date.now() + CLAIM_LEASE_MS).toISOString();
    const dying = (id: number, template: OutboxRow["template"], channel: OutboxRow["channel"]): OutboxRow => ({
      id,
      reservation_id: RID,
      event: "created",
      channel,
      to: channel === "email" ? TO : "01012345678",
      template,
      status: "pending",
      attempts: MAX_ATTEMPTS,
      last_error: null,
      next_attempt_at: lease,
      updated_at: lease,
    });
    const racingDb = (row: OutboxRow): WorkerDb => {
      let claimed = false;
      return {
        reapStale: async () => [],
        claimPending: async () => (claimed ? [] : ((claimed = true), [row])),
        markSent: async () => true,
        markFailed: async () => {},
        quarantineSentUnmarked: async () => {},
        listQuarantined: async () => [],
        rowStatus: async () => "pending",
        async enqueueFailureNotice(r) {
          await new Promise((res) => setTimeout(res, 5)); // 두 워커가 겹치게
          nextId += 1;
          inserted.push({ id: nextId, row: r });
          return [nextId];
        },
        pendingStats: async () => ({ pending: 0, truncated: false, oldestCreatedAt: null, wouldReap: 0 }),
      };
    };
    const failing = memorySender(() => ({ ok: false, error: "provider_403", retryable: false }));
    const run = (row: OutboxRow) =>
      runNotificationWorker({ dryRun: false }, { db: racingDb(row), sender: failing, ownerEmail: "boss@example.test", now: () => new Date(), log: () => {}, sleep: async () => {} });

    await Promise.all([run(dying(51, "created.owner.email", "email")), run(dying(52, "created.customer.sms", "sms"))]);
    expect(inserted).toHaveLength(2);
    expect(inserted.map((i) => i.row.template)).toEqual(["created.owner.failure.email", "created.owner.failure.email"]);

    // 두 알림 행을 실제 메일 어댑터로 보낸다 — 키가 같다
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const s = resendSender(deps({ fetch }));
    for (const { id, row } of inserted) {
      await s.send({ id, channel: row.channel, to: row.to, template: row.template as SendRequest["template"], reservationId: row.reservation_id });
    }
    const keys = fetch.calls.map(keyOf);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    // 본문도 같다 — 같은 키·같은 본문이라 Resend 가 두 번째를 새로 보내지 않는다(문서화된 멱등성 의미)
    expect(String(fetch.calls[0].init.body)).toBe(String(fetch.calls[1].init.body));
  });

  // ── Retry-After (P4-7 수정 라운드 2 · 리뷰 P2-5) ─────────────────────────
  test("429 + Retry-After(초) → retryAfterMs 로 싣는다 · 없으면 키 자체가 없다", async () => {
    const limited = recordingFetch(() => new Response(JSON.stringify({ name: "rate_limit_exceeded" }), { status: 429, headers: { "content-type": "application/json", "retry-after": "30" } }));
    const out = await resendSender(deps({ fetch: limited })).send(req());
    expect(out).toMatchObject({ ok: false, retryable: true, retryAfterMs: 30_000 });
    const plain = recordingFetch(() => jsonResponse({ name: "internal_server_error" }, 500));
    const out2 = await resendSender(deps({ fetch: plain })).send(req());
    expect(out2).toEqual({ ok: false, error: "provider_500:internal_server_error", retryable: true });
  });

  test("보내지 않는 경로에서는 키도 만들지 않는다 — 네트워크 0", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const s = resendSender(deps({ fetch }));
    await s.send(req({ to: "01098765432" }));
    await s.send(req({ template: "created.customer.sms" }));
    expect(fetch.calls).toHaveLength(0);
  });
});

// =============================================================================
// 10. 워커와 함께 — 문서화한 거동을 시퀀스로 잠근다 (P4-6 · 외부 검증 P2-4)
//
// 가짜 Resend 는 **공개 문서의 멱등성 의미만** 흉내 낸다(보고서 P4-6 §1):
//   같은 키·같은 본문 → 원래 응답, 재발송 없음 / 같은 키·다른 본문 → 409 invalid_idempotent_request
// 409 오류 본문의 모양은 문서로 확인하지 못했다 — 어댑터가 읽는 `name` 에 넣었고, 단언은 `provider_409:` 접두어까지만 기댄다.
// 실제 네트워크 0 · 실제 DB 0 (WorkerDb 는 메모리 구현).
// =============================================================================
describe("10. 워커 시퀀스 — 수락 → markSent 실패 → 재claim", () => {
  const T0 = new Date("2026-10-01T00:00:00.000Z");
  const OWNER_EMAIL = "boss@example.test";

  function fakeResend() {
    const seen = new Map<string, { body: string; response: { id: string } }>();
    const delivered: string[] = [];
    const fetch = recordingFetch(({ init }) => {
      const key = new Headers(init.headers).get("Idempotency-Key") ?? "";
      const body = String(init.body);
      const prior = seen.get(key);
      if (prior === undefined) {
        const response = { id: `mail-${delivered.length + 1}` };
        seen.set(key, { body, response });
        delivered.push(key);
        return jsonResponse(response);
      }
      if (prior.body === body) return jsonResponse(prior.response); // 문서: 같은 응답, 재발송 없음
      return jsonResponse({ name: "invalid_idempotent_request" }, 409); // 문서: 본문이 바뀜
    });
    return { fetch, delivered };
  }

  /**
   * 0005/0014 의 claim·mark 규칙을 메모리로 옮긴 것 — 판정은 outbox.ts 의 함수·상수를 그대로 쓴다.
   * `dbDownCalls` = 앞으로 그만큼의 **기록 호출**(markSent · 격리)이 DB 오류로 throw 한다(P4-7 수정 라운드 2 — 기록 재시도·격리를 흉내).
   */
  function memoryDb(initial: OutboxRow, clock: { now: Date }, dbDownCalls: number) {
    const rows: OutboxRow[] = [{ ...initial }];
    const notices: NewOutboxRow[] = [];
    let sentFailuresLeft = dbDownCalls;
    const find = (id: number) => {
      const r = rows.find((x) => x.id === id);
      if (r === undefined) throw new Error(`row ${id} 없음`);
      return r;
    };
    const db: WorkerDb = {
      async reapStale() {
        return [];
      },
      async claimPending(limit, channels) {
        const due = rows.filter(
          (r) => r.status === "pending" && r.attempts < MAX_ATTEMPTS && channels.includes(r.channel) && new Date(r.next_attempt_at) <= clock.now,
        );
        return due.slice(0, limit).map((r) => {
          r.attempts += 1;
          r.next_attempt_at = new Date(clock.now.getTime() + CLAIM_LEASE_MS).toISOString();
          return { ...r };
        });
      },
      async markSent(id) {
        if (sentFailuresLeft > 0) {
          sentFailuresLeft -= 1;
          throw new Error("db down");
        }
        const r = find(id);
        r.status = "sent";
        return true;
      },
      async markFailed({ id, attempts }, error) {
        const r = find(id);
        const plan = retryPlanAfterFailure(Math.max(1, attempts));
        r.last_error = error;
        if (plan.giveUp) r.status = "failed";
        else r.next_attempt_at = new Date(clock.now.getTime() + plan.retryAfterMs).toISOString();
      },
      async quarantineSentUnmarked(id, note) {
        if (sentFailuresLeft > 0) {
          sentFailuresLeft -= 1;
          throw new Error("db down");
        }
        const r = find(id);
        r.last_error = note;
        r.next_attempt_at = new Date(clock.now.getTime() + QUARANTINE_RETRY_AFTER_MS).toISOString();
      },
      async listQuarantined() {
        return rows.filter((r) => r.status === "pending" && (r.last_error ?? "").startsWith("sent_unmarked:")).map((r) => ({ id: r.id, last_error: r.last_error }));
      },
      async rowStatus(id) {
        return find(id).status;
      },
      async enqueueFailureNotice(row) {
        notices.push(row);
        return [9000 + notices.length];
      },
      async pendingStats(): Promise<PendingStats> {
        return { pending: rows.filter((r) => r.status === "pending").length, truncated: false, oldestCreatedAt: null, wouldReap: 0 };
      },
    };
    return { db, rows, notices };
  }

  const ownerRow = (): OutboxRow => ({
    id: 51,
    reservation_id: RID,
    event: "created",
    channel: "email",
    to: TO,
    template: "created.owner.email",
    status: "pending",
    attempts: 0,
    last_error: null,
    next_attempt_at: T0.toISOString(),
    updated_at: T0.toISOString(),
  });

  /** 예약 수정을 흉내 내는 문안 변수 포트 — `edited` 가 참이 되면 이름이 바뀐다(본문이 달라진다). */
  function editableVars() {
    const state = { edited: false };
    const port: TemplateVarsPort = {
      async ownerVars() {
        return state.edited ? { ...OWNER_VARS, name: "홍길순" } : OWNER_VARS;
      },
      async customerVars() {
        return CUSTOMER_VARS;
      },
    };
    return { state, port };
  }

  async function runUntilSettled(db: WorkerDb, sender: ReturnType<typeof resendSender>, clock: { now: Date }, rows: OutboxRow[]) {
    const logs: WorkerLogEntry[] = [];
    const reports = [];
    // 상한 10회 — 행이 sent/failed 로 끝나면 멈춘다(무한 루프 방지용 상한일 뿐, 정상 경로는 5회 안에 끝난다).
    for (let i = 0; i < 10 && rows[0].status === "pending"; i += 1) {
      const report = await runNotificationWorker(
        { dryRun: false },
        { db, sender, ownerEmail: OWNER_EMAIL, now: () => clock.now, log: (e) => logs.push(e), sleep: async () => {} },
      );
      reports.push(report);
      // 다음 크론: 이 행의 next_attempt_at 바로 뒤(정상 처리량 — 적체 없음)
      clock.now = new Date(new Date(rows[0].next_attempt_at).getTime() + 1);
    }
    return { logs, reports };
  }

  /** 기록 재시도(3회)와 격리(1회)가 **전부** 실패하는 DB — 행이 pending 으로 남아 다시 claim 되는 마지막 잔여 경로. */
  const DB_FULLY_DOWN = MARK_SENT_RETRY_DELAYS_MS.length + 2;

  // ── P4-7 수정 라운드 2 · 리뷰 P1-2: 발송이 아니라 기록을 다시 한다 ───────
  test("markSent 가 한 번 실패해도 같은 호출 안에서 기록을 다시 해 sent — 제공자 호출 1회 · 도착 1통 · 다음 날 재발송 없음", async () => {
    const clock = { now: T0 };
    const { db, rows } = memoryDb(ownerRow(), clock, 1);
    const resend = fakeResend();
    const sender = resendSender(deps({ fetch: resend.fetch, vars: editableVars().port }));

    const report = await runNotificationWorker({ dryRun: false }, { db, sender, ownerEmail: OWNER_EMAIL, now: () => clock.now, log: () => {}, sleep: async () => {} });
    expect(report).toMatchObject({ sent: 1, sentUnmarked: 0, quarantined: 0 });
    expect(rows[0]).toMatchObject({ status: "sent", attempts: 1 });

    // 이틀 뒤(키 보존 기간 24시간을 넘긴 뒤) 크론이 돌아도 보낼 것이 없다
    clock.now = new Date(T0.getTime() + 2 * 24 * 60 * 60_000);
    await runNotificationWorker({ dryRun: false }, { db, sender, ownerEmail: OWNER_EMAIL, now: () => clock.now, log: () => {}, sleep: async () => {} });
    expect(resend.fetch.calls).toHaveLength(1);
    expect(resend.delivered).toHaveLength(1);
  });

  test("기록이 끝내 실패하면 그 행을 격리한다 — 이틀 뒤 크론이 돌아도 다시 claim 되지 않아 재발송 0 (키 보존 기간에 기대지 않는다)", async () => {
    const clock = { now: T0 };
    // markSent 3회 전부 실패 → 격리는 성공
    const { db, rows } = memoryDb(ownerRow(), clock, MARK_SENT_RETRY_DELAYS_MS.length + 1);
    const resend = fakeResend();
    const sender = resendSender(deps({ fetch: resend.fetch, vars: editableVars().port }));

    // 같은 회차 끝의 자가 복구(P4-7b — 발송 뒤에 돈다)도 DB 가 아직 불안정해 목록 조회가 실패한다고 둔다 — 격리 상태가 남는 경우를 본다.
    const healList = db.listQuarantined;
    db.listQuarantined = async () => {
      throw new Error("db down");
    };
    const first = await runNotificationWorker({ dryRun: false }, { db, sender, ownerEmail: OWNER_EMAIL, now: () => clock.now, log: () => {}, sleep: async () => {} });
    expect(first).toMatchObject({ sentUnmarked: 1, quarantined: 1, healed: 0 });
    expect(rows[0].status).toBe("pending");
    expect(rows[0].last_error).toMatch(/^sent_unmarked:/);
    db.listQuarantined = healList;

    clock.now = new Date(T0.getTime() + 2 * 24 * 60 * 60_000);
    const later = await runNotificationWorker({ dryRun: false }, { db, sender, ownerEmail: OWNER_EMAIL, now: () => clock.now, log: () => {}, sleep: async () => {} });
    expect(later.claimed).toBe(0);
    // 수정 라운드 3 — DB 가 회복된 뒤의 실행이 저장된 제공자 id 로 기록을 마친다(자가 복구). 발송은 다시 하지 않는다.
    expect(later.healed).toBe(1);
    expect(rows[0].status).toBe("sent");
    expect(resend.fetch.calls).toHaveLength(1);
    expect(resend.delivered).toHaveLength(1);
  });

  test("[잔여 경로 — DB 가 기록도 격리도 못 받을 때] 본문이 그대로면: 재claim 이 캐시된 2xx 를 받아 markSent 로 닫힌다 — 도착 1통", async () => {
    const clock = { now: T0 };
    const { db, rows, notices } = memoryDb(ownerRow(), clock, DB_FULLY_DOWN);
    const resend = fakeResend();
    const sender = resendSender(deps({ fetch: resend.fetch, vars: editableVars().port }));

    const { reports } = await runUntilSettled(db, sender, clock, rows);

    expect(reports[0].sentUnmarked).toBe(1);
    expect(reports[1].sent).toBe(1);
    expect(rows[0]).toMatchObject({ status: "sent", attempts: 2 });
    expect(resend.fetch.calls).toHaveLength(2);
    expect(resend.delivered).toHaveLength(1);
    expect(notices).toHaveLength(0);
  });

  /**
   * **문서화한 오경보 경로**(보고서 P4-6 §3 "새로 생긴 거동"): 발송 수락 → markSent 실패 → 예약 수정(본문 변경) → 409 ×4 → 소진 → failed → 실패 알림.
   * 409 는 어댑터가 `retryable:false` 로 분류하지만 **워커는 retryable 을 스케줄에 쓰지 않는다**(sender.ts: 기록용) —
   * attempts 로만 판정하므로 409 인데도 5회까지 다시 시도한다. 409 는 markSent 에 닿지 않으므로
   * 전달되지 않은 메일을 "전달됨"으로 만드는 경로는 아니다. 실제 도착은 1통인데 사장님은 "실패" 알림을 받는다 — 그 거동을 잠근다.
   */
  test("[잔여 경로] 본문이 바뀌면: 409 invalid_idempotent_request(retryable:false 로 분류돼도 워커는 attempts 로만 재시도) → 소진 → failed → 실패 알림 — 도착은 1통", async () => {
    const clock = { now: T0 };
    const { db, rows, notices } = memoryDb(ownerRow(), clock, DB_FULLY_DOWN);
    const resend = fakeResend();
    const vars = editableVars();
    const sender = resendSender(deps({ fetch: resend.fetch, vars: vars.port }));

    // 1회차: 수락됐지만 markSent 가 (재시도까지) throw 하고 격리도 못 했다
    const first = await runNotificationWorker(
      { dryRun: false },
      { db, sender, ownerEmail: OWNER_EMAIL, now: () => clock.now, log: () => {}, sleep: async () => {} },
    );
    expect(first.sentUnmarked).toBe(1);
    expect(resend.delivered).toHaveLength(1);

    // 관리자가 예약을 고친다 → 다음 시도의 본문이 달라진다
    vars.state.edited = true;
    clock.now = new Date(new Date(rows[0].next_attempt_at).getTime() + 1);
    const { reports } = await runUntilSettled(db, sender, clock, rows);

    // 2~5회차 전부 409 — markSent 에 닿지 않는다
    expect(resend.fetch.calls).toHaveLength(MAX_ATTEMPTS);
    for (const call of resend.fetch.calls.slice(1)) {
      expect(new Headers(call.init.headers).get("Idempotency-Key")).toBe(`notify/created.owner.email/${RID}/51`);
    }
    expect(reports.map((r) => r.sent)).toEqual([0, 0, 0, 0]);
    expect(reports.map((r) => r.failed)).toEqual([1, 1, 1, 1]);
    expect(reports.map((r) => r.gaveUp)).toEqual([0, 0, 0, 1]);
    // retryable:false 로 분류됐다는 사실 — 그래도 재시도가 계속됐다(위 failed 4회)
    const direct = await resendSender(deps({ fetch: resend.fetch, vars: vars.port })).send({
      id: 51,
      channel: "email",
      to: TO,
      template: "created.owner.email",
      reservationId: RID,
    });
    expect(direct).toMatchObject({ ok: false, retryable: false });
    expect(direct.ok === false && direct.error.startsWith("provider_409:")).toBe(true);

    expect(rows[0].status).toBe("failed");
    expect(rows[0].attempts).toBe(MAX_ATTEMPTS);
    expect(rows[0].last_error).toMatch(/^provider_409:/);
    // 실제 도착은 1통뿐
    expect(resend.delivered).toHaveLength(1);
    // 그런데 사장님께 실패 알림이 들어간다 (오경보)
    expect(notices).toEqual([
      { reservation_id: RID, event: "created", channel: "email", to: OWNER_EMAIL, template: "created.owner.failure.email" },
    ]);
    expect(reports[3].failureNotices.enqueued).toBe(1);
  });
});

// =============================================================================
// 8. 정적 — env 경계 · 새 패키지 0 · 광고 0
// =============================================================================
describe("8. 정적", () => {
  const src = readFileSync(path.join(ROOT, "lib", "notify", "mail.ts"), "utf-8");
  // P4-7: env 를 읽어 sender·수신처를 고르는 곳이 route.ts 에서 lib/notify/deps.ts 로 옮겨졌다(크론·즉시 발송이 한 벌을 쓴다).
  // 변수 이름은 route 로 두고 가리키는 파일만 바꿨다 — 아래 단언의 뜻("env 를 읽는 단 한 곳")은 그대로다.
  const route = readFileSync(path.join(ROOT, "lib", "notify", "deps.ts"), "utf-8");
  const envExample = readFileSync(path.join(ROOT, ".env.example"), "utf-8");

  test("mail.ts — process.env 0 · 'use server' 0 · server-only 0 · 전역 fetch 0", () => {
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/["']use server["']/);
    expect(src).not.toMatch(/import\s+["']server-only["']/);
    expect(src).not.toMatch(/globalThis\.fetch/);
    expect(src).not.toMatch(/(^|[^.\w])fetch\s*\(/m);
  });

  test("mail.ts — 새 패키지 0: import 는 같은 디렉터리 모듈뿐 (resend·nodemailer SDK 없음)", () => {
    const specifiers = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const s of specifiers) expect(s.startsWith("./") || s.startsWith("../"), s).toBe(true);
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf-8")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).not.toContain("resend");
    expect(Object.keys(pkg.dependencies)).not.toContain("nodemailer");
  });

  test("mail.ts — 광고를 보내지 않는다: (광고) 표기·수신거부 안내·HTML 본문을 만들지 않는다", () => {
    const code = stripComments(src, "lib/notify/mail.ts");
    for (const banned of ["(광고)", "수신거부", "무료수신거부", "<html", "<p>"]) {
      expect(code, banned).not.toContain(banned);
    }
  });

  test("deps.ts — RESEND_API_KEY·MAIL_FROM 을 여기서만 읽고 resendSender·routingSender 로 넘긴다", () => {
    expect(route).toContain("RESEND_API_KEY");
    expect(route).toContain("MAIL_FROM");
    expect(route).toContain("resendSender");
    expect(route).toContain("routingSender");
  });

  test(".env.example — RESEND_API_KEY·MAIL_FROM·OWNER_EMAIL 이 **빈 값**으로 있다 (실값을 채워 두지 않는다)", () => {
    for (const key of ["RESEND_API_KEY", "MAIL_FROM", "OWNER_EMAIL"]) {
      expect(envExample, key).toMatch(new RegExp(`^${key}=\\s*$`, "m"));
    }
  });

  /**
   * P4-5 는 이 값을 읽지 않고 자리만 만들었고, **P4-4 가 읽는다**(발송이 끝내 실패했을 때의 수신처).
   * 그래서 단언을 "읽지 않는다" 에서 "**수신처로만** 읽는다" 로 옮긴다 — 어댑터는 여전히 이 값을 모르고,
   * 발신(`from`)은 언제나 MAIL_FROM 이다(수신 전용 주소를 From 으로 쓰지 않는다).
   */
  test("OWNER_EMAIL 은 deps.ts 가 **수신처로만** 읽는다 — 어댑터는 모르고, 발신 주소로도 쓰지 않는다", () => {
    expect(route).toMatch(/ownerEmail:\s*process\.env\.OWNER_EMAIL/);
    expect(route).not.toMatch(/from:\s*\w*OWNER_EMAIL/);
    expect(src).not.toContain("OWNER_EMAIL");
  });
});
