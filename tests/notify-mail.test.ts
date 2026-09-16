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
 *   8. 정적: env 는 route.ts 에만 · 새 패키지 0 · 전역 fetch 0
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
  resendSender,
  type ResendDeps,
  type ResendFetch,
  type ResendLogEntry,
} from "@/lib/notify/mail";
import type { SendRequest } from "@/lib/notify/sender";
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
// 8. 정적 — env 경계 · 새 패키지 0 · 광고 0
// =============================================================================
describe("8. 정적", () => {
  const src = readFileSync(path.join(ROOT, "lib", "notify", "mail.ts"), "utf-8");
  const route = readFileSync(path.join(ROOT, "app", "api", "cron", "notify", "route.ts"), "utf-8");
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

  test("route.ts — RESEND_API_KEY·MAIL_FROM 을 여기서만 읽고 resendSender·routingSender 로 넘긴다", () => {
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
  test("OWNER_EMAIL 은 라우트가 **수신처로만** 읽는다 — 어댑터는 모르고, 발신 주소로도 쓰지 않는다", () => {
    expect(route).toMatch(/ownerEmail:\s*process\.env\.OWNER_EMAIL/);
    expect(route).not.toMatch(/from:\s*\w*OWNER_EMAIL/);
    expect(src).not.toContain("OWNER_EMAIL");
  });
});
