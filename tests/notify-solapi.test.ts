/**
 * P4-2 — Solapi 발송 어댑터 계약 테스트 (플랜 v4 · ADR-7).
 *
 * 브리프 §검증 1~9 를 그대로 단언한다:
 *   1. 서명: 고정 now·salt 로 Authorization 헤더가 바이트 일치. apiSecret 은 헤더·로그·반환값 어디에도 평문 0
 *   2. configured: 키·시크릿·발신번호·문안 변수 포트 중 하나라도 없으면 false → worker 가 claim 조차 하지 않는다
 *   3. 성공: 200 + 제공자 messageId → { ok:true, providerMessageId }
 *   4. 실패 분류: HTTP 계층 판정표 + 제공자 코드(모르는 코드 → retryable:true)
 *   5. 타임아웃: AbortSignal 이 걸리면 retryable:true — 실제 대기 없이(가짜 fetch 가 signal 을 듣고 즉시 reject)
 *   6. 개인정보 0: 수신처·이름·본문은 제공자 요청 본문에만 있고 로그·반환값에는 0
 *   7. 알림톡 거부: channel='alimtalk' 은 조용히 SMS 로 바꾸지 않고 명시적으로 거부(retryable:false)
 *   8. selectSender(): 키가 있으면 solapi, 없으면 unconfigured. 운영에서 memory 거부는 그대로
 *   9. 정적: process.env 는 route.ts 에만 · SDK import 0 · 전역 fetch 0
 *
 * **실제 네트워크 호출 0** — fetch 는 전부 주입된 가짜다. 이 파일 어디에도 globalThis.fetch 를 쓰지 않는다.
 * 주의: tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { structuredLog } from "@/lib/log";
import { TEMPLATE_KEYS } from "@/lib/notify/outbox";
import { UNCONFIGURED_SENDER_NAME } from "@/lib/notify/sender";
import type { SendOutcome, SendRequest } from "@/lib/notify/sender";
import {
  ALIMTALK_REFUSED_CODE,
  PROVIDER_CODE_RETRYABLE,
  SOLAPI_SEND_URL,
  SOLAPI_SENDER_NAME,
  SOLAPI_TIMEOUT_MS,
  TEMPLATE_AUDIENCE,
  authorizationHeader,
  classifyHttpStatus,
  classifyProviderCode,
  normalizeKrNumber,
  solapiSalt,
  solapiSender,
  type SolapiDeps,
  type SolapiFetch,
  type SolapiLogEntry,
  type TemplateVarsPort,
} from "@/lib/notify/solapi";
import { renderTemplate, type CustomerVars, type OwnerVars } from "@/lib/notify/templates";

const ROOT = path.resolve(import.meta.dirname, "..");

// =============================================================================
// 고정값 — 서명이 바이트 단위로 재현되도록 시각·난수를 못 박는다
// =============================================================================

const API_KEY = "NCSTESTAPIKEY0001";
/** 이 문자열이 헤더·로그·반환값 어디에도 나오면 안 된다 (§1). */
const API_SECRET = "SECRETVALUEMUSTNEVERAPPEAR0001";
const FROM = "15666188";
const NOW = new Date("2026-09-15T00:00:00.000Z");
const DATE_ISO = NOW.toISOString();
/** randomBytes(16) → 0x00..0x0f 고정 → hex 32자 (SDK 의 salt 길이와 같다). */
const FIXED_BYTES = (n: number) => Uint8Array.from({ length: n }, (_, i) => i);
const SALT = "000102030405060708090a0b0c0d0e0f";

const RID = "00000000-0000-4000-8000-000000000042";
/** 고객 수신처는 아웃박스에 E.164 로 저장된다(lib/reservations/phone.ts). */
const TO_E164 = "+821098765432";
const TO_NATIONAL = "01098765432";
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
  id: 41,
  channel: "sms",
  to: TO_E164,
  template: "created.customer.sms",
  reservationId: RID,
  ...over,
});

// =============================================================================
// 가짜 fetch — 실제 네트워크 0
// =============================================================================

interface Call {
  url: string;
  init: RequestInit;
}

function recordingFetch(respond: (call: Call) => Response | Promise<Response>): SolapiFetch & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return respond({ url, init });
  };
  return Object.assign(fn, { calls });
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** 접수 성공 응답 (SDK detailGroupMessageResponseSchema — node_modules/solapi/dist/index.js:2735). */
const acceptedBody = (messageId = "M4V20260915000000ABCDE", groupId = "G4V20260915000000ABCDE") => ({
  groupInfo: { groupId, count: { total: 1, registeredSuccess: 1, registeredFailed: 0 } },
  failedMessageList: [],
  messageList: [{ messageId, statusCode: "2000", statusMessage: "정상 접수" }],
});

const logSpy = (): ((e: SolapiLogEntry) => void) & { entries: SolapiLogEntry[] } => {
  const entries: SolapiLogEntry[] = [];
  const fn = (e: SolapiLogEntry) => {
    entries.push(e);
  };
  return Object.assign(fn, { entries });
};

function deps(over: Partial<SolapiDeps> = {}): SolapiDeps {
  return {
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    from: FROM,
    fetch: recordingFetch(() => jsonResponse(acceptedBody())),
    now: () => NOW,
    randomBytes: FIXED_BYTES,
    log: logSpy(),
    vars: varsPort,
    ...over,
  };
}

// =============================================================================
// 1. 서명 — 바이트 일치 · 시크릿 비노출
// =============================================================================
describe("1. HMAC-SHA256 서명", () => {
  const expectedSignature = createHmac("sha256", API_SECRET).update(DATE_ISO + SALT).digest("hex");
  const expectedHeader = `HMAC-SHA256 apiKey=${API_KEY}, date=${DATE_ISO}, salt=${SALT}, signature=${expectedSignature}`;

  test("authorizationHeader 가 SDK 와 같은 형태를 바이트 단위로 만든다", () => {
    expect(authorizationHeader(API_KEY, API_SECRET, DATE_ISO, SALT)).toBe(expectedHeader);
  });

  test("salt 는 주입된 난수의 hex 32자 (SDK 의 salt 길이와 같다)", () => {
    expect(solapiSalt(FIXED_BYTES)).toBe(SALT);
    expect(solapiSalt(FIXED_BYTES)).toHaveLength(32);
  });

  test("send 가 보내는 Authorization 헤더가 기대값과 바이트 일치", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    await solapiSender(deps({ fetch })).send(req());
    const headers = fetch.calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(expectedHeader);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  test("apiSecret 은 헤더·요청본문·로그·반환값 어디에도 평문으로 없다", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const log = logSpy();
    const sender = solapiSender(deps({ fetch, log }));
    const ok = await sender.send(req());
    const fail = await solapiSender(deps({ fetch: recordingFetch(() => jsonResponse({ errorCode: "X" }, 400)), log })).send(req());

    const header = (fetch.calls[0].init.headers as Record<string, string>).Authorization;
    expect(header).not.toContain(API_SECRET);
    expect(String(fetch.calls[0].init.body)).not.toContain(API_SECRET);
    expect(JSON.stringify(ok)).not.toContain(API_SECRET);
    expect(JSON.stringify(fail)).not.toContain(API_SECRET);
    expect(JSON.stringify(log.entries)).not.toContain(API_SECRET);
    // 서명만 남는다 — 서명에서 시크릿을 되돌릴 수 없다
    expect(header).toMatch(/signature=[0-9a-f]{64}$/);
  });

  test("같은 시각이어도 salt 가 다르면 서명이 다르다 (재사용 방지)", () => {
    const other = solapiSalt((n) => Uint8Array.from({ length: n }, () => 255));
    expect(other).not.toBe(SALT);
    expect(authorizationHeader(API_KEY, API_SECRET, DATE_ISO, other)).not.toBe(expectedHeader);
  });
});

// =============================================================================
// 2. configured — 하나라도 비면 false (worker 가 claim 을 하지 않는다)
// =============================================================================
describe("2. configured", () => {
  test("전부 있으면 true · 이름은 solapi", () => {
    const s = solapiSender(deps());
    expect(s.configured).toBe(true);
    expect(s.name).toBe(SOLAPI_SENDER_NAME);
    expect(s.missing).toEqual([]);
  });

  test.each([
    ["apiKey", { apiKey: "" }],
    ["apiKey", { apiKey: "   " }],
    ["apiSecret", { apiSecret: "" }],
    ["from", { from: "" }],
    ["from", { from: "not-a-number" }],
    ["vars", { vars: undefined }],
  ])("%s 가 없으면 configured=false", (name, over) => {
    const s = solapiSender(deps(over as Partial<SolapiDeps>));
    expect(s.configured).toBe(false);
    expect(s.missing).toContain(name);
  });

  test("미구성 sender 의 send 는 호출되면 안 된다 — throw (worker 버그 신호)", async () => {
    const s = solapiSender(deps({ apiKey: "" }));
    await expect(s.send(req())).rejects.toThrow(/configured/);
  });

  test("미구성이면 네트워크를 치지 않는다", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const s = solapiSender(deps({ apiKey: "", fetch }));
    await s.send(req()).catch(() => undefined);
    expect(fetch.calls).toHaveLength(0);
  });
});

// =============================================================================
// 3. 성공 — 200 + 제공자 messageId
// =============================================================================
describe("3. 성공", () => {
  test("접수되면 { ok:true, providerMessageId } — messageList 의 messageId 를 쓴다", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody("M-777")));
    const out = await solapiSender(deps({ fetch })).send(req());
    expect(out).toEqual({ ok: true, providerMessageId: "M-777" });
  });

  test("messageList 가 없으면 groupId 로 갈음한다", async () => {
    const body = { groupInfo: { groupId: "G-888", count: { total: 1, registeredSuccess: 1, registeredFailed: 0 } }, failedMessageList: [] };
    const out = await solapiSender(deps({ fetch: recordingFetch(() => jsonResponse(body)) })).send(req());
    expect(out).toEqual({ ok: true, providerMessageId: "G-888" });
  });

  test("요청은 한 건씩 — messages 배열 길이 1 · 묶음 없음", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    await solapiSender(deps({ fetch })).send(req());
    const body = JSON.parse(String(fetch.calls[0].init.body)) as { messages: unknown[] };
    expect(fetch.calls).toHaveLength(1);
    expect(body.messages).toHaveLength(1);
  });

  test("엔드포인트·메서드·타입 — P4-3 의 format 을 그대로 SMS/LMS 로 옮기고 autoTypeDetect 는 끈다", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    await solapiSender(deps({ fetch })).send(req());
    const rendered = renderTemplate("created.customer.sms", CUSTOMER_VARS);
    const body = JSON.parse(String(fetch.calls[0].init.body)) as {
      messages: { to: string; from: string; text: string; type: string; autoTypeDetect: boolean }[];
    };
    expect(fetch.calls[0].url).toBe(SOLAPI_SEND_URL);
    expect(fetch.calls[0].init.method).toBe("POST");
    expect(body.messages[0].type).toBe(rendered.format.toUpperCase());
    expect(body.messages[0].text).toBe(rendered.text);
    expect(body.messages[0].autoTypeDetect).toBe(false);
    expect(body.messages[0].from).toBe(FROM);
  });

  test("수신처는 국내 표기로 정규화해 보낸다 (+82… → 0…)", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    await solapiSender(deps({ fetch })).send(req());
    const body = JSON.parse(String(fetch.calls[0].init.body)) as { messages: { to: string }[] };
    expect(body.messages[0].to).toBe(TO_NATIONAL);
  });

  test("사장님 문안은 사장님 변수로, 고객 문안은 고객 변수로 렌더한다 (고객 경로는 개인정보를 읽지 않는다)", async () => {
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
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const sender = solapiSender(deps({ fetch, vars: port }));
    await sender.send(req({ template: "created.owner.sms", to: "01020488585" }));
    await sender.send(req({ template: "confirmed.customer.sms" }));
    expect(seen).toEqual([`owner:${RID}`, `customer:${RID}`]);

    const ownerBody = JSON.parse(String(fetch.calls[0].init.body)) as { messages: { text: string }[] };
    expect(ownerBody.messages[0].text).toBe(renderTemplate("created.owner.sms", OWNER_VARS).text);
  });

  test("TEMPLATE_AUDIENCE 는 TEMPLATE_KEYS 를 빠짐없이 덮는다", () => {
    expect(Object.keys(TEMPLATE_AUDIENCE).sort()).toEqual([...TEMPLATE_KEYS].sort());
  });
});

// =============================================================================
// 4. 실패 분류 — retryable 판정표
// =============================================================================
describe("4. 실패 분류", () => {
  const send = async (respond: (c: Call) => Response | Promise<Response>, log = logSpy()): Promise<{ out: SendOutcome; log: typeof log }> => {
    const out = await solapiSender(deps({ fetch: recordingFetch(respond), log })).send(req());
    return { out, log };
  };

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
    const { out } = await send(() => jsonResponse({ errorCode: "ProviderCode", errorMessage: "사람이 읽는 문구" }, status));
    expect(out).toEqual({ ok: false, error: `provider_${status}:ProviderCode`, retryable });
  });

  test("classifyHttpStatus 단독 — 408·429·5xx 만 재시도 가능", () => {
    for (const s of [408, 429, 500, 503, 599]) expect(classifyHttpStatus(s), String(s)).toBe(true);
    for (const s of [400, 401, 402, 403, 409, 422]) expect(classifyHttpStatus(s), String(s)).toBe(false);
  });

  test("오류 본문이 JSON 이 아니면 코드는 http_<status> 로 갈음 — 사람이 읽는 문구는 싣지 않는다", async () => {
    const { out } = await send(() => new Response("<html>수신번호 01098765432 오류</html>", { status: 500 }));
    expect(out).toEqual({ ok: false, error: "provider_500:http_500", retryable: true });
    expect(JSON.stringify(out)).not.toContain(TO_NATIONAL);
  });

  test("제공자 오류 문구(errorMessage)는 결과·로그에 실리지 않는다 — 수신처가 섞여 온다", async () => {
    const { out, log } = await send(() => jsonResponse({ errorCode: "ValidationError", errorMessage: `수신번호 ${TO_NATIONAL} 형식 오류` }, 400));
    expect(JSON.stringify(out)).not.toContain(TO_NATIONAL);
    expect(JSON.stringify(log.entries)).not.toContain(TO_NATIONAL);
  });

  test("코드에 이상한 문자가 섞여도 짧고 안전한 코드로 잘린다", async () => {
    const { out } = await send(() => jsonResponse({ errorCode: `Bad Code "${TO_NATIONAL}" ${"x".repeat(200)}` }, 400));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).not.toContain(TO_NATIONAL);
    expect(out.error.length).toBeLessThanOrEqual(64);
  });

  test("200 인데 접수 실패 목록이 있으면 실패 — 모르는 코드는 보수적으로 retryable:true", async () => {
    const body = {
      groupInfo: { groupId: "G-1", count: { total: 1, registeredSuccess: 0, registeredFailed: 1 } },
      failedMessageList: [{ to: TO_NATIONAL, from: FROM, type: "LMS", statusCode: "3011", statusMessage: "실패", country: "82", messageId: "M-1", accountId: "A" }],
    };
    const { out, log } = await send(() => jsonResponse(body));
    expect(out).toEqual({ ok: false, error: "provider_rejected:3011", retryable: true });
    expect(JSON.stringify(log.entries)).not.toContain(TO_NATIONAL);
  });

  test("classifyProviderCode — 표에 없으면 true, 표에 false 로 등록된 코드만 false", () => {
    expect(classifyProviderCode("무엇이든", PROVIDER_CODE_RETRYABLE)).toBe(true);
    expect(classifyProviderCode("KNOWN_PERMANENT", { KNOWN_PERMANENT: false })).toBe(false);
    expect(classifyProviderCode("KNOWN_TRANSIENT", { KNOWN_TRANSIENT: true })).toBe(true);
  });

  test("200 인데 접수 성공도 실패 목록도 없으면 모르는 상태 — retryable:true", async () => {
    const { out } = await send(() => jsonResponse({ groupInfo: { groupId: "G-2", count: { total: 1, registeredSuccess: 0, registeredFailed: 0 } }, failedMessageList: [] }));
    expect(out).toEqual({ ok: false, error: "provider_no_accepted", retryable: true });
  });

  test("200 인데 본문이 JSON 이 아니면 retryable:true (우리가 못 읽은 것일 수 있다)", async () => {
    const { out } = await send(() => new Response("not json", { status: 200 }));
    expect(out).toEqual({ ok: false, error: "provider_bad_json", retryable: true });
  });

  test("네트워크 오류는 예외 이름만 남기고 retryable:true", async () => {
    const { out } = await send(() => {
      throw Object.assign(new Error(`connect ECONNREFUSED ${TO_NATIONAL}`), { name: "TypeError" });
    });
    expect(out).toEqual({ ok: false, error: "provider_network:TypeError", retryable: true });
    if (out.ok) return;
    expect(out.error).not.toContain(TO_NATIONAL);
  });

  test("문안 변수를 못 찾으면(예약 없음) 영구 실패", async () => {
    const port: TemplateVarsPort = { async ownerVars() { return null; }, async customerVars() { return null; } };
    const out = await solapiSender(deps({ vars: port })).send(req());
    expect(out).toEqual({ ok: false, error: "reservation_not_found", retryable: false });
  });

  test("문안 변수 조회가 throw 하면 일시 실패 — 예외 문구는 버린다", async () => {
    const port: TemplateVarsPort = {
      async ownerVars() { throw new Error(`db down ${TO_NATIONAL}`); },
      async customerVars() { throw new Error(`db down ${TO_NATIONAL}`); },
    };
    const out = await solapiSender(deps({ vars: port })).send(req());
    expect(out).toEqual({ ok: false, error: "vars_load_failed", retryable: true });
  });

  test("국외 번호는 이 어댑터가 보내지 않는다 — 번호를 결과에 싣지 않는다", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const out = await solapiSender(deps({ fetch })).send(req({ to: "+15551234567" }));
    expect(out).toEqual({ ok: false, error: "unsupported_recipient", retryable: false });
    expect(fetch.calls).toHaveLength(0);
  });

  test("normalizeKrNumber — E.164·하이픈·대표번호를 국내 표기로, 그 밖은 null", () => {
    expect(normalizeKrNumber("+821098765432")).toBe("01098765432");
    expect(normalizeKrNumber("010-9876-5432")).toBe("01098765432");
    expect(normalizeKrNumber(" 02-123-4567 ")).toBe("021234567");
    expect(normalizeKrNumber("1566-6188")).toBe("15666188");
    expect(normalizeKrNumber("+15551234567")).toBeNull();
    expect(normalizeKrNumber("hello")).toBeNull();
    expect(normalizeKrNumber("")).toBeNull();
  });
});

// =============================================================================
// 5. 타임아웃 — 실제 대기 없이
// =============================================================================
describe("5. 타임아웃", () => {
  test("상한은 10초 이하 (P4-1 §7-10: lease 5분 · 1회 20건)", () => {
    expect(SOLAPI_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(SOLAPI_TIMEOUT_MS * 20).toBeLessThan(5 * 60_000);
  });

  test("AbortSignal 을 요청에 붙인다", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    await solapiSender(deps({ fetch })).send(req());
    const signal = fetch.calls[0].init.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect((signal as AbortSignal).aborted).toBe(false);
  });

  test("응답이 오지 않으면 signal 이 끊고 retryable:true — 실제 대기 없음(5ms)", async () => {
    const hanging: SolapiFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason as Error));
      });
    const out = await solapiSender(deps({ fetch: hanging, timeoutMs: 5 })).send(req());
    expect(out).toEqual({ ok: false, error: "provider_timeout", retryable: true });
  });

  test("주입된 timeoutMs 가 상한을 넘으면 상한으로 깎는다", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const s = solapiSender(deps({ fetch, timeoutMs: 60_000 }));
    expect(s.timeoutMs).toBe(SOLAPI_TIMEOUT_MS);
    await s.send(req());
    expect(fetch.calls).toHaveLength(1);
  });
});

// =============================================================================
// 6. 개인정보 0 — 로그·반환값
// =============================================================================
describe("6. 개인정보 0", () => {
  const secrets = [TO_E164, TO_NATIONAL, CUSTOMER_NAME, CUSTOMER_PHONE_IN_BODY];

  test("성공 경로: 요청 본문에는 있고(보내야 하니까) 로그·반환값에는 0", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const log = logSpy();
    const out = await solapiSender(deps({ fetch, log })).send(req({ template: "created.owner.sms", to: TO_E164 }));

    const sent = String(fetch.calls[0].init.body);
    expect(sent).toContain(TO_NATIONAL);
    expect(sent).toContain(CUSTOMER_NAME);

    expect(JSON.stringify(out)).toBe(JSON.stringify({ ok: true, providerMessageId: "M4V20260915000000ABCDE" }));
    for (const s of secrets) {
      expect(JSON.stringify(out), s).not.toContain(s);
      expect(JSON.stringify(log.entries), s).not.toContain(s);
    }
    expect(log.entries).toHaveLength(0);
  });

  test("실패 경로: 로그에는 id·template·코드뿐", async () => {
    const log = logSpy();
    const out = await solapiSender(deps({ log, fetch: recordingFetch(() => jsonResponse({ errorCode: "SomeCode" }, 400)) })).send(
      req({ template: "created.owner.sms" }),
    );
    expect(out).toEqual({ ok: false, error: "provider_400:SomeCode", retryable: false });
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toEqual({
      level: "warn",
      event: "notify.solapi_failed",
      id: 41,
      template: "created.owner.sms",
      code: "provider_400:SomeCode",
      httpStatus: 400,
      retryable: false,
    });
    for (const s of secrets) expect(JSON.stringify(log.entries), s).not.toContain(s);
  });

  test("본문(문안)은 로그에도 반환값에도 없다", async () => {
    const rendered = renderTemplate("created.customer.sms", CUSTOMER_VARS);
    const log = logSpy();
    const out = await solapiSender(deps({ log, fetch: recordingFetch(() => jsonResponse({ errorCode: "C" }, 400)) })).send(req());
    expect(JSON.stringify(out)).not.toContain(rendered.text.slice(0, 20));
    expect(JSON.stringify(log.entries)).not.toContain(rendered.text.slice(0, 20));
  });
});

// =============================================================================
// 7. 알림톡을 보내지 않는다 (P4-0 대기) · 메일도 이 어댑터가 아니다
// =============================================================================
describe("7. 알림톡 거부", () => {
  test("channel='alimtalk' → 명시적 거부 · 조용히 SMS 로 바꾸지 않는다", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const log = logSpy();
    const out = await solapiSender(deps({ fetch, log })).send(req({ channel: "alimtalk" }));
    expect(out).toEqual({ ok: false, error: ALIMTALK_REFUSED_CODE, retryable: false });
    expect(fetch.calls).toHaveLength(0);
    expect(log.entries[0]).toMatchObject({ event: "notify.solapi_failed", code: ALIMTALK_REFUSED_CODE, retryable: false });
  });

  test("알림톡 거부 코드는 사유를 담고, 문안 변수도 읽지 않는다", async () => {
    let read = 0;
    const port: TemplateVarsPort = {
      async ownerVars() { read += 1; return OWNER_VARS; },
      async customerVars() { read += 1; return CUSTOMER_VARS; },
    };
    await solapiSender(deps({ vars: port })).send(req({ channel: "alimtalk" }));
    expect(read).toBe(0);
    expect(ALIMTALK_REFUSED_CODE).toMatch(/alimtalk/);
  });

  test("channel='email' 도 이 어댑터가 보내지 않는다 (P4-5 트랜잭션 메일 몫)", async () => {
    const fetch = recordingFetch(() => jsonResponse(acceptedBody()));
    const out = await solapiSender(deps({ fetch })).send(req({ channel: "email", template: "created.owner.email", to: "owner@example.test" }));
    expect(out).toEqual({ ok: false, error: "unsupported_channel:email", retryable: false });
    expect(fetch.calls).toHaveLength(0);
  });

  test("소스에 알림톡 발송 타입(ATA)·kakaoOptions 가 들어 있지 않다 — 심사 전 발송은 실패한다", () => {
    const src = readFileSync(path.join(ROOT, "lib", "notify", "solapi.ts"), "utf-8");
    expect(src).not.toMatch(/"ATA"|'ATA'/);
    expect(src).not.toMatch(/kakaoOptions\s*:/);
    // P4-0 이 끝난 뒤 열 자리는 주석으로 남아 있어야 한다
    expect(src).toMatch(/P4-0/);
  });
});

// =============================================================================
// 8. selectSender() — 라우트만 env 를 본다
// =============================================================================
vi.mock("server-only", () => ({}));
vi.mock("@/lib/log", () => ({ structuredLog: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => routeSupabase() }));

const routeRpcs: string[] = [];
function routeSupabase() {
  return {
    rpc(fn: string) {
      routeRpcs.push(fn);
      if (fn === "reap_stale_notifications") return Promise.resolve({ data: [], error: null });
      if (fn === "claim_pending_notifications") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from() {
      const b: Record<string, unknown> = {};
      for (const op of ["select", "eq", "order", "limit"]) b[op] = () => b;
      b.then = (onOk: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(onOk);
      return b;
    },
  };
}

describe("8. selectSender() — 키가 있으면 solapi", () => {
  const SECRET = "test-cron-secret-0123456789";
  const AUTH = { Authorization: `Bearer ${SECRET}` };
  const SOLAPI_ENV = ["SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SMS_SENDER", "NOTIFY_SENDER", "VERCEL_ENV"] as const;

  afterEach(() => {
    routeRpcs.length = 0;
    for (const k of SOLAPI_ENV) delete process.env[k];
    vi.mocked(structuredLog).mockClear();
  });

  async function report(query = ""): Promise<{ sender: string; skipped?: string }> {
    process.env.CRON_SECRET = SECRET;
    const { GET } = await import("@/app/api/cron/notify/route");
    const res = await GET(new Request(`http://localhost/api/cron/notify${query}`, { headers: AUTH }));
    return (await res.json()) as { sender: string; skipped?: string };
  }

  test("키 3종이 있으면 sender 는 solapi", async () => {
    process.env.SOLAPI_API_KEY = API_KEY;
    process.env.SOLAPI_API_SECRET = API_SECRET;
    process.env.SMS_SENDER = FROM;
    expect((await report()).sender).toBe(SOLAPI_SENDER_NAME);
  });

  test("키가 없으면 unconfigured — 발송기는 claim 조차 하지 않는다", async () => {
    const r = await report("?dry=0");
    expect(r.sender).toBe(UNCONFIGURED_SENDER_NAME);
    expect(r.skipped).toBe("sender_not_configured");
    expect(routeRpcs).toEqual(["reap_stale_notifications"]);
  });

  test("키가 일부만 있으면 unconfigured (반쯤 채운 배포로 발송하지 않는다)", async () => {
    process.env.SOLAPI_API_KEY = API_KEY;
    expect((await report()).sender).toBe(UNCONFIGURED_SENDER_NAME);
  });

  // P4-2b 로 뒤집힌 단언이다. 전에는 "문안 변수 포트가 아직 없으므로 키가 있어도 claim 하지 않는다" 였다 —
  // 그 상태가 옳았던 이유(렌더 못 하는 발송기가 attempts 를 태운다)는 lib/notify/vars.ts 가 생기면서 사라졌다.
  // 이제 남은 전제는 키 3종뿐이고, 그것이 이 태스크가 만들려던 상태다.
  test("문안 변수 포트가 배선됐으므로 키 3종이 있으면 claim 까지 간다 (P4-2b — 이제 키만 넣으면 나간다)", async () => {
    process.env.SOLAPI_API_KEY = API_KEY;
    process.env.SOLAPI_API_SECRET = API_SECRET;
    process.env.SMS_SENDER = FROM;
    const r = await report("?dry=0");
    expect(r.sender).toBe(SOLAPI_SENDER_NAME);
    expect(r.skipped).toBeUndefined();
    expect(routeRpcs).toEqual(["reap_stale_notifications", "claim_pending_notifications"]);
  });

  test("운영에서 NOTIFY_SENDER=memory 는 여전히 거부된다 (P4-1 규칙 유지)", async () => {
    process.env.NOTIFY_SENDER = "memory";
    process.env.VERCEL_ENV = "production";
    const r = await report("?dry=0");
    expect(r.sender).toBe(UNCONFIGURED_SENDER_NAME);
    expect(vi.mocked(structuredLog).mock.calls.map((c) => c[0])).toContainEqual(
      expect.objectContaining({ level: "warn", event: "notify.memory_sender_refused" }),
    );
  });

  // ── 우선순위 (컨트롤러 2026-09-15 판정 — P4-1 §6 인계를 뒤집었다) ──────────
  // 사람이 적은 지시(NOTIFY_SENDER)가, 그저 남아 있을 뿐인 설정(실키)보다 강하다.
  test("실키가 있어도 NOTIFY_SENDER=memory 가 이긴다 — 로컬에 실키가 남아 있어도 실제 번호로 나가지 않는다", async () => {
    process.env.SOLAPI_API_KEY = API_KEY;
    process.env.SOLAPI_API_SECRET = API_SECRET;
    process.env.SMS_SENDER = FROM;
    process.env.NOTIFY_SENDER = "memory";
    const r = await report("?dry=0");
    expect(r.sender).toBe("memory");
    expect(r.skipped).toBeUndefined();
  });

  test("운영에서는 memory 지시만 무시하고 제공자로 간다 — 오설정이 발송 자체를 멈추지 않는다", async () => {
    process.env.SOLAPI_API_KEY = API_KEY;
    process.env.SOLAPI_API_SECRET = API_SECRET;
    process.env.SMS_SENDER = FROM;
    process.env.NOTIFY_SENDER = "memory";
    process.env.VERCEL_ENV = "production";
    const r = await report("?dry=0");
    expect(r.sender).toBe(SOLAPI_SENDER_NAME);
    expect(vi.mocked(structuredLog).mock.calls.map((c) => c[0])).toContainEqual(
      expect.objectContaining({ level: "warn", event: "notify.memory_sender_refused" }),
    );
  });

  test("route.ts 에서 NOTIFY_SENDER 판정이 SOLAPI 키 판정보다 먼저 나온다 (순서를 소스로 잠근다)", () => {
    const route = readFileSync(path.join(ROOT, "app", "api", "cron", "notify", "route.ts"), "utf-8");
    const select = route.slice(route.indexOf("function selectSender"));
    expect(select.indexOf("NOTIFY_SENDER")).toBeGreaterThan(-1);
    expect(select.indexOf("NOTIFY_SENDER")).toBeLessThan(select.indexOf("SOLAPI_API_KEY"));
  });
});

// =============================================================================
// 9. 정적 — env 경계 · SDK 미사용 · 전역 fetch 0
// =============================================================================
describe("9. 정적", () => {
  const src = readFileSync(path.join(ROOT, "lib", "notify", "solapi.ts"), "utf-8");
  const route = readFileSync(path.join(ROOT, "app", "api", "cron", "notify", "route.ts"), "utf-8");

  test("solapi.ts — process.env 0 · 'use server' 0 · server-only 0", () => {
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/["']use server["']/);
    expect(src).not.toMatch(/import\s+["']server-only["']/);
  });

  test("solapi.ts — 전역 fetch 0 (주입된 deps.fetch 만) · setTimeout 0", () => {
    expect(src).not.toMatch(/globalThis\.fetch/);
    expect(src).not.toMatch(/(^|[^.\w])fetch\s*\(/m);
  });

  test("solapi.ts — 새 패키지 0: import 는 node:crypto 와 같은 디렉터리 모듈뿐", () => {
    const specifiers = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const s of specifiers) {
      expect(s === "node:crypto" || s.startsWith("./"), s).toBe(true);
    }
    // 제공자 SDK 를 쓰지 않는다 — HMAC 은 node:crypto 로 직접 만든다
    expect(src).not.toMatch(/from\s+"solapi"/);
  });

  test("route.ts — SOLAPI 키 3종을 여기서만 읽고 solapiSender 로 넘긴다", () => {
    expect(route).toContain("SOLAPI_API_KEY");
    expect(route).toContain("SOLAPI_API_SECRET");
    expect(route).toContain("SMS_SENDER");
    expect(route).toContain("solapiSender");
    expect(route).toContain("NOTIFY_SENDER");
  });

  test(".env.example — SOLAPI 3키가 전부 있다", () => {
    const env = readFileSync(path.join(ROOT, ".env.example"), "utf-8");
    for (const key of ["SOLAPI_API_KEY=", "SOLAPI_API_SECRET=", "SMS_SENDER="]) {
      expect(env, key).toContain(key);
    }
  });
});
