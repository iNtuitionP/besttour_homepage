/**
 * P3-1 — 공개 뮤테이션 방어 4종 lib/guard/* 계약 테스트 (플랜 v4 · CLAUDE.md §3 "전부 통과 후").
 *
 * 브리프 §검증 1~9 를 그대로 단언한다:
 *   1. 순서 — zod → honeypot → timetrap → turnstile → rateLimit. 앞 단계가 막으면 뒤 단계는 호출 0 (fetch·limit 카운트로 잠금)
 *   2. 허니팟 — 채워짐 → ok:true·silent:true·input 없음(저장 안 함). 비어 있음 → 통과
 *   3. 타임트랩 — 2.9초 bot / 3.0초 통과 / 변조 bot / 만료(>1h) bot / secret 다르면 bot
 *   4. IP 키 — 같은 IP 같은 키, 다른 IP 다른 키, 원문 IP 가 결과·키·로그 어디에도 없음, XFF 첫 항목, 헤더 없음 → unknown
 *   5. Turnstile — success:false / hostname 불일치 / action 불일치 → turnstile · 네트워크 throw / 타임아웃 / 5xx → infra
 *   6. 실제 Cloudflare 테스트 키 스모크 — GUARD_LIVE_TESTS=1 일 때만(ci.yml test 잡)
 *   7. RateLimit — success:false → ratelimit · throw / 타임아웃 / Upstash 자체 timeout(fail-open 응답) → infra · 상수 5·15 / 2·7
 *   8. 정적 — 'use server' 0, process.env 는 deps.ts 한 곳, 우회 스위치 없음, .env.example·ci.yml 배선
 *   9. defaultGuardDeps — env 누락·짧은 secret·운영에서 더미 Turnstile 키 → throw
 *
 * 이 파일에는 서버 액션도 DB 도 없다(P3-2·P3-3). 네트워크·시계는 전부 주입한 mock 이고, 6 만 실제 네트워크를 친다.
 * 주의: tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { LOCATION_CODES, PURPOSES } from "@/lib/codes";
import {
  FORM_MAX_AGE_MS,
  FORM_MIN_MS,
  HONEYPOT_FIELD,
  RATE_LIMITS,
  TURNSTILE_ACTION,
  TURNSTILE_SITEVERIFY_URL,
  checkHoneypot,
  checkRateLimit,
  clientIp,
  clientIpKey,
  issueFormToken,
  runGuards,
  verifyFormToken,
  verifyTurnstile,
  type FetchLike,
  type GuardContext,
  type GuardDeps,
  type GuardOutcome,
  type RateLimiterLike,
  type RateLimiterSet,
} from "@/lib/guard";

// server-only 는 vitest(node) 에서 import 즉시 throw 한다 — deps.ts 를 테스트하려면 빈 모듈로 바꿔치기한다(purge.test.ts 선례).
vi.mock("server-only", () => ({}));
import { GUARD_SECRET_MIN_LENGTH, defaultGuardDeps } from "@/lib/guard/deps";

const ROOT = path.resolve(import.meta.dirname, "..");
const GUARD_DIR = path.join(ROOT, "lib", "guard");
const read = (p: string) => readFileSync(p, "utf-8");

// =============================================================================
// 픽스처
// =============================================================================
const SECRET = "test-guard-secret-0123456789abcdef0123456789abcdef";
const OTHER_SECRET = "other-guard-secret-fedcba9876543210fedcba9876543210";
const NOW = new Date("2026-09-13T03:00:00.000Z");
/** 사설 대역 — 결과 어디에도 이 부분문자열이 없어야 한다. */
const IP = "192.168.77.5";
const IP_PROXY = "10.0.0.9";
const TURNSTILE_SECRET = "unit-test-turnstile-secret";

const VALID_RAW = {
  name: "홍길동",
  phone: "010-1234-5678",
  vehicleSlug: "bus45",
  purposeCode: PURPOSES[0],
  originCode: LOCATION_CODES[0],
  destinationCode: LOCATION_CODES[1],
  tripType: "round",
  departAtLocal: "2026-10-01T08:00",
  returnAtLocal: "2026-10-01T18:00",
  turnstileToken: "tok-valid",
  privacyConsent: true,
  withdrawalConsent: true, // P1-7 — 청약철회 제한 확인(필수)
} as const;

interface SiteverifyBody {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
}

function siteverifyResponse(body: SiteverifyBody, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** 기본 mock fetch — 통과 응답. 요청 본문을 기록해 remoteip 가 어디로 가는지 단언할 수 있게 한다. */
function fetchOk(body: SiteverifyBody = {}) {
  const fn = vi.fn(async () =>
    siteverifyResponse({ success: true, hostname: "localhost", action: TURNSTILE_ACTION, "error-codes": [], ...body }),
  );
  return fn as unknown as FetchLike & typeof fn;
}

function fetchThrowing() {
  const fn = vi.fn(async (): Promise<Response> => {
    throw new TypeError("fetch failed");
  });
  return fn as unknown as FetchLike & typeof fn;
}

/** abort 될 때까지 영원히 안 끝나는 fetch — 타임아웃 경로 전용. */
function fetchHanging() {
  const fn = vi.fn(
    (_input: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
  );
  return fn as unknown as FetchLike & typeof fn;
}

type LimitResult = Awaited<ReturnType<RateLimiterLike["limit"]>>;

function limiterOk(): RateLimiterLike & { limit: ReturnType<typeof vi.fn> } {
  const limit = vi.fn(async (): Promise<LimitResult> => ({ success: true, limit: 5, remaining: 4, reset: NOW.getTime() + 600_000 }));
  return { limit };
}
function limiterDeny(): RateLimiterLike & { limit: ReturnType<typeof vi.fn> } {
  const limit = vi.fn(async (): Promise<LimitResult> => ({ success: false, limit: 5, remaining: 0, reset: NOW.getTime() + 600_000 }));
  return { limit };
}
function limiterThrowing(): RateLimiterLike & { limit: ReturnType<typeof vi.fn> } {
  const limit = vi.fn(async (): Promise<LimitResult> => {
    throw new Error("upstash unreachable");
  });
  return { limit };
}
function limiterHanging(): RateLimiterLike & { limit: ReturnType<typeof vi.fn> } {
  const limit = vi.fn(() => new Promise<LimitResult>(() => {}));
  return { limit };
}
/** Upstash 자체 timeout 응답 — success:true 인데 reason:'timeout' (fail-open). 우리는 이것을 infra 로 뒤집어야 한다. */
function limiterUpstreamTimeout(): RateLimiterLike & { limit: ReturnType<typeof vi.fn> } {
  const limit = vi.fn(async (): Promise<LimitResult> => ({ success: true, reason: "timeout", limit: 5, remaining: 5, reset: 0 }));
  return { limit };
}

function sameLimiterEverywhere(l: RateLimiterLike): RateLimiterSet {
  return { known: { short: l, long: l }, unknown: { short: l, long: l } };
}

function totalLimitCalls(set: RateLimiterSet): number {
  const fns = new Set<RateLimiterLike["limit"]>();
  for (const b of ["known", "unknown"] as const) for (const w of ["short", "long"] as const) fns.add(set[b][w].limit);
  let n = 0;
  for (const f of fns) n += (f as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
  return n;
}

interface DepsOverrides {
  fetch?: FetchLike;
  limiters?: RateLimiterSet;
  allowedHosts?: readonly string[];
  action?: string | null;
  turnstileTimeoutMs?: number;
  rateLimitTimeoutMs?: number;
  now?: Date;
}

function makeDeps(o: DepsOverrides = {}): GuardDeps {
  return {
    now: () => o.now ?? NOW,
    secret: SECRET,
    turnstile: {
      fetch: o.fetch ?? fetchOk(),
      secret: TURNSTILE_SECRET,
      allowedHosts: o.allowedHosts ?? ["localhost"],
      action: o.action === undefined ? TURNSTILE_ACTION : o.action,
      timeoutMs: o.turnstileTimeoutMs ?? 5000,
    },
    rateLimit: {
      limiters: o.limiters ?? sameLimiterEverywhere(limiterOk()),
      timeoutMs: o.rateLimitTimeoutMs ?? 5000,
    },
  };
}

function headersOf(init: Record<string, string> = { "x-forwarded-for": `${IP}, ${IP_PROXY}` }) {
  return new Headers(init);
}

function makeCtx(o: Partial<GuardContext> = {}): GuardContext {
  return {
    headers: o.headers ?? headersOf(),
    formToken: o.formToken === undefined ? issueFormToken(new Date(NOW.getTime() - 10_000), SECRET) : o.formToken,
    turnstileToken: o.turnstileToken === undefined ? "tok-valid" : o.turnstileToken,
    honeypot: o.honeypot ?? { [HONEYPOT_FIELD]: "" },
  };
}

function failReason(outcome: GuardOutcome): string | null {
  return outcome.ok ? null : outcome.reason;
}

// =============================================================================
// 1. 순서 — 각 단계가 막을 때 그 뒤 단계의 호출 카운트
// =============================================================================
describe("runGuards 순서: zod → honeypot → timetrap → turnstile → rateLimit", () => {
  test("zod 실패 → validation. fetch 0 · limit 0", async () => {
    const fetch = fetchOk();
    const limiters = sameLimiterEverywhere(limiterOk());
    const out = await runGuards({ ...VALID_RAW, name: "" }, makeCtx(), makeDeps({ fetch, limiters }));
    expect(failReason(out)).toBe("validation");
    expect(fetch).toHaveBeenCalledTimes(0);
    expect(totalLimitCalls(limiters)).toBe(0);
  });

  test("zod 실패의 detail 은 path·code·message 뿐 — 입력값을 되돌려주지 않는다", async () => {
    const out = await runGuards({ ...VALID_RAW, phone: "02-123-4567" }, makeCtx(), makeDeps());
    expect(out.ok).toBe(false);
    if (out.ok) return;
    const issues = out.detail as Array<Record<string, unknown>>;
    expect(Array.isArray(issues)).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) expect(Object.keys(i).sort()).toEqual(["code", "message", "path"]);
    expect(JSON.stringify(out)).not.toContain("02-123-4567");
  });

  test("허니팟 채워짐 → ok:true·silent:true. fetch 0 · limit 0 · input 없음", async () => {
    const fetch = fetchOk();
    const limiters = sameLimiterEverywhere(limiterOk());
    const out = await runGuards(VALID_RAW, makeCtx({ honeypot: { [HONEYPOT_FIELD]: "http://spam.example" } }), makeDeps({ fetch, limiters }));
    expect(out).toEqual({ ok: true, silent: true });
    expect("input" in out).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(0);
    expect(totalLimitCalls(limiters)).toBe(0);
  });

  test("타임트랩 실패(2.9초) → bot. fetch 0 · limit 0", async () => {
    const fetch = fetchOk();
    const limiters = sameLimiterEverywhere(limiterOk());
    const token = issueFormToken(new Date(NOW.getTime() - 2_900), SECRET);
    const out = await runGuards(VALID_RAW, makeCtx({ formToken: token }), makeDeps({ fetch, limiters }));
    expect(failReason(out)).toBe("bot");
    expect(fetch).toHaveBeenCalledTimes(0);
    expect(totalLimitCalls(limiters)).toBe(0);
  });

  test("formToken 없음 → bot. fetch 0 · limit 0", async () => {
    const fetch = fetchOk();
    const limiters = sameLimiterEverywhere(limiterOk());
    const out = await runGuards(VALID_RAW, makeCtx({ formToken: null }), makeDeps({ fetch, limiters }));
    expect(failReason(out)).toBe("bot");
    expect(fetch).toHaveBeenCalledTimes(0);
    expect(totalLimitCalls(limiters)).toBe(0);
  });

  test("Turnstile 실패(success:false) → turnstile. fetch 1 · limit 0 ← 봇이 Upstash 슬롯을 태우지 못한다", async () => {
    const fetch = fetchOk({ success: false, "error-codes": ["invalid-input-response"] });
    const limiters = sameLimiterEverywhere(limiterOk());
    const out = await runGuards(VALID_RAW, makeCtx(), makeDeps({ fetch, limiters }));
    expect(failReason(out)).toBe("turnstile");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(totalLimitCalls(limiters)).toBe(0);
  });

  test("Turnstile 토큰 없음 → turnstile. fetch 0 · limit 0 (네트워크도 안 쓴다)", async () => {
    const fetch = fetchOk();
    const limiters = sameLimiterEverywhere(limiterOk());
    const out = await runGuards(VALID_RAW, makeCtx({ turnstileToken: "" }), makeDeps({ fetch, limiters }));
    expect(failReason(out)).toBe("turnstile");
    expect(fetch).toHaveBeenCalledTimes(0);
    expect(totalLimitCalls(limiters)).toBe(0);
  });

  test("Turnstile 네트워크 오류 → infra. fetch 1 · limit 0", async () => {
    const fetch = fetchThrowing();
    const limiters = sameLimiterEverywhere(limiterOk());
    const out = await runGuards(VALID_RAW, makeCtx(), makeDeps({ fetch, limiters }));
    expect(failReason(out)).toBe("infra");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(totalLimitCalls(limiters)).toBe(0);
  });

  test("RateLimit 초과 → ratelimit. fetch 1 · limit ≥ 1", async () => {
    const fetch = fetchOk();
    const limiters = sameLimiterEverywhere(limiterDeny());
    const out = await runGuards(VALID_RAW, makeCtx(), makeDeps({ fetch, limiters }));
    expect(failReason(out)).toBe("ratelimit");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(totalLimitCalls(limiters)).toBeGreaterThanOrEqual(1);
  });

  test("RateLimit 인프라 오류 → infra. fetch 1 · limit 1", async () => {
    const fetch = fetchOk();
    const limiters = sameLimiterEverywhere(limiterThrowing());
    const out = await runGuards(VALID_RAW, makeCtx(), makeDeps({ fetch, limiters }));
    expect(failReason(out)).toBe("infra");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(totalLimitCalls(limiters)).toBe(1);
  });

  test("전부 통과 → ok:true·silent:false·파싱된 ReservationInput(기본값 적용). fetch 1 · limit 2(10분·1시간 창)", async () => {
    const fetch = fetchOk();
    const limiters = sameLimiterEverywhere(limiterOk());
    const out = await runGuards(VALID_RAW, makeCtx(), makeDeps({ fetch, limiters }));
    expect(out.ok).toBe(true);
    if (!out.ok || out.silent) throw new Error("expected non-silent success");
    expect(out.input.name).toBe("홍길동");
    expect(out.input.waypointCodes).toEqual([]);
    expect(out.input.busCount).toBe(1);
    expect(out.input.locale).toBe("ko");
    expect(out.input.marketingConsent).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(totalLimitCalls(limiters)).toBe(2);
  });

  test("short 창이 막으면 long 창은 호출하지 않는다 (막힌 요청은 시간당 카운트를 소비하지 않는다)", async () => {
    const short = limiterDeny();
    const long = limiterOk();
    const limiters: RateLimiterSet = { known: { short, long }, unknown: { short, long } };
    const out = await runGuards(VALID_RAW, makeCtx(), makeDeps({ limiters }));
    expect(failReason(out)).toBe("ratelimit");
    expect(short.limit).toHaveBeenCalledTimes(1);
    expect(long.limit).toHaveBeenCalledTimes(0);
  });
});

// =============================================================================
// 2. 허니팟
// =============================================================================
describe("checkHoneypot", () => {
  test("비어 있음(''·undefined·null) → 통과", () => {
    expect(checkHoneypot({ [HONEYPOT_FIELD]: "" })).toEqual({ ok: true });
    expect(checkHoneypot({ [HONEYPOT_FIELD]: undefined })).toEqual({ ok: true });
    expect(checkHoneypot({ [HONEYPOT_FIELD]: null })).toEqual({ ok: true });
    expect(checkHoneypot({})).toEqual({ ok: true });
  });

  test("채워짐(문자열·공백·비문자열) → bot + silent:true", () => {
    for (const v of ["x", " ", "http://spam.example", 1, true, ["a"], { a: 1 }]) {
      const r = checkHoneypot({ [HONEYPOT_FIELD]: v });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.reason).toBe("bot");
      expect(r.silent).toBe(true);
    }
  });

  test("숨은 필드가 여러 개면 하나라도 채워지면 bot", () => {
    const r = checkHoneypot({ [HONEYPOT_FIELD]: "", company_url: "spam" });
    expect(r.ok).toBe(false);
  });

  test("runGuards: raw 안에 website 가 채워져 와도(호출자가 분리하지 않아도) validation 이 아니라 조용한 성공이다", async () => {
    const out = await runGuards({ ...VALID_RAW, [HONEYPOT_FIELD]: "spam" }, makeCtx({ honeypot: {} }), makeDeps());
    expect(out).toEqual({ ok: true, silent: true });
  });

  test("runGuards: raw 의 website 가 빈 문자열이면 zod 에 걸리지 않고 통과한다", async () => {
    const out = await runGuards({ ...VALID_RAW, [HONEYPOT_FIELD]: "" }, makeCtx({ honeypot: {} }), makeDeps());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.silent).toBe(false);
  });
});

// =============================================================================
// 3. 타임트랩 — HMAC 서명 토큰. 서버 시계만 믿는다
// =============================================================================
describe("timetrap: issueFormToken / verifyFormToken", () => {
  const issued = NOW;
  const at = (ms: number) => new Date(issued.getTime() + ms);

  test("상수: 최소 3초, 최대 1시간", () => {
    expect(FORM_MIN_MS).toBe(3_000);
    expect(FORM_MAX_AGE_MS).toBe(60 * 60 * 1_000);
  });

  test("2.9초 → bot / 3.0초 → 통과 / 3.1초 → 통과", () => {
    const token = issueFormToken(issued, SECRET);
    expect(verifyFormToken(token, at(2_900), SECRET)).toMatchObject({ ok: false, reason: "bot" });
    expect(verifyFormToken(token, at(3_000), SECRET)).toEqual({ ok: true });
    expect(verifyFormToken(token, at(3_100), SECRET)).toEqual({ ok: true });
  });

  test("만료: 1시간 이내 통과, 1시간 초과 → bot", () => {
    const token = issueFormToken(issued, SECRET);
    expect(verifyFormToken(token, at(FORM_MAX_AGE_MS), SECRET)).toEqual({ ok: true });
    expect(verifyFormToken(token, at(FORM_MAX_AGE_MS + 1), SECRET)).toMatchObject({ ok: false, reason: "bot" });
  });

  test("발급 시각보다 앞선 now(음수 경과) → bot — 클라이언트가 미래 시각을 꾸밀 수 없다", () => {
    const token = issueFormToken(issued, SECRET);
    expect(verifyFormToken(token, at(-1), SECRET)).toMatchObject({ ok: false, reason: "bot" });
  });

  test("변조 토큰 → bot: 시각 조작·서명 한 글자 변경·형식 붕괴·빈 값·비문자열", () => {
    const token = issueFormToken(issued, SECRET);
    const [ts, sig] = token.split(".");
    const olderTs = String(Number(ts) - 10_000);
    const flipped = sig[0] === "a" ? "b" : "a";
    const cases: unknown[] = [
      `${olderTs}.${sig}`,
      `${ts}.${flipped}${sig.slice(1)}`,
      `${ts}.${sig.slice(0, -1)}`,
      `${ts}`,
      "",
      null,
      undefined,
      12345,
      `${ts}.${sig}.extra`,
    ];
    for (const c of cases) {
      expect(verifyFormToken(c, at(10_000), SECRET), `case=${String(c)}`).toMatchObject({ ok: false, reason: "bot" });
    }
  });

  test("secret 이 다르면 검증 실패 (bot)", () => {
    const token = issueFormToken(issued, SECRET);
    expect(verifyFormToken(token, at(10_000), OTHER_SECRET)).toMatchObject({ ok: false, reason: "bot" });
  });

  test("토큰에는 발급 시각(ms)과 hex 서명만 있다 — secret 도 IP 도 없다", () => {
    const token = issueFormToken(issued, SECRET);
    expect(token).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(token).not.toContain(SECRET);
    expect(Number(token.split(".")[0])).toBe(issued.getTime());
  });

  test("빈 secret 으로는 발급도 검증도 하지 않는다 (throw — 설정 오류를 조용히 지나치지 않는다)", () => {
    expect(() => issueFormToken(issued, "")).toThrow();
    expect(() => verifyFormToken(issueFormToken(issued, SECRET), at(10_000), "")).toThrow();
  });
});

// =============================================================================
// 4. IP 키 — 원문 저장 금지
// =============================================================================
describe("ipKey: clientIp / clientIpKey", () => {
  test("x-forwarded-for 'a, b' → a (첫 항목, 공백 제거)", () => {
    expect(clientIp(headersOf({ "x-forwarded-for": ` ${IP} , ${IP_PROXY}` }))).toBe(IP);
  });

  test("x-forwarded-for 없으면 x-real-ip", () => {
    expect(clientIp(headersOf({ "x-real-ip": IP }))).toBe(IP);
  });

  test("둘 다 없으면 null → unknown 버킷", () => {
    expect(clientIp(headersOf({}))).toBeNull();
    const k = clientIpKey(headersOf({}), SECRET);
    expect(k.bucket).toBe("unknown");
    expect(k.key).toMatch(/^[0-9a-f]{16}$/);
  });

  test("x-forwarded-for 가 빈 문자열/쉼표뿐이면 unknown", () => {
    expect(clientIp(headersOf({ "x-forwarded-for": "" }))).toBeNull();
    expect(clientIp(headersOf({ "x-forwarded-for": " , " }))).toBeNull();
  });

  test("같은 IP → 같은 키, 다른 IP → 다른 키, known 버킷", () => {
    const a = clientIpKey(headersOf({ "x-forwarded-for": IP }), SECRET);
    const b = clientIpKey(headersOf({ "x-real-ip": IP }), SECRET);
    const c = clientIpKey(headersOf({ "x-forwarded-for": "203.0.113.9" }), SECRET);
    expect(a.bucket).toBe("known");
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
  });

  test("키 = sha256(GUARD_SECRET + ip) 앞 16자 (브리프 그대로). secret 이 다르면 키도 다르다", () => {
    const expected = createHash("sha256").update(SECRET + IP).digest("hex").slice(0, 16);
    expect(clientIpKey(headersOf({ "x-forwarded-for": IP }), SECRET).key).toBe(expected);
    expect(clientIpKey(headersOf({ "x-forwarded-for": IP }), OTHER_SECRET).key).not.toBe(expected);
  });

  test("키 문자열에 IP 원문 부분문자열이 없다", () => {
    const k = clientIpKey(headersOf({ "x-forwarded-for": IP }), SECRET);
    expect(JSON.stringify(k)).not.toContain("192.168");
    expect(JSON.stringify(k)).not.toContain("77.5");
  });

  test("빈 secret → throw", () => {
    expect(() => clientIpKey(headersOf({ "x-forwarded-for": IP }), "")).toThrow();
  });
});

describe("IP 비노출 — runGuards 결과·limiter 식별자·콘솔 어디에도 원문 IP 가 없다", () => {
  const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeEach(() => {
    for (const m of ["log", "info", "warn", "error", "debug"] as const) {
      consoleSpies.push(vi.spyOn(console, m).mockImplementation(() => {}));
    }
  });
  afterEach(() => {
    for (const s of consoleSpies) s.mockRestore();
    consoleSpies.length = 0;
  });

  const scenarios: Array<{ name: string; raw: unknown; ctx: Partial<GuardContext>; deps: DepsOverrides }> = [
    { name: "validation", raw: { ...VALID_RAW, name: "" }, ctx: {}, deps: {} },
    { name: "honeypot", raw: VALID_RAW, ctx: { honeypot: { [HONEYPOT_FIELD]: "x" } }, deps: {} },
    { name: "timetrap", raw: VALID_RAW, ctx: { formToken: "0.bad" }, deps: {} },
    { name: "turnstile", raw: VALID_RAW, ctx: {}, deps: { fetch: fetchOk({ success: false, "error-codes": ["invalid-input-response"] }) } },
    { name: "turnstile-infra", raw: VALID_RAW, ctx: {}, deps: { fetch: fetchThrowing() } },
    { name: "ratelimit", raw: VALID_RAW, ctx: {}, deps: { limiters: sameLimiterEverywhere(limiterDeny()) } },
    { name: "ratelimit-infra", raw: VALID_RAW, ctx: {}, deps: { limiters: sameLimiterEverywhere(limiterThrowing()) } },
    { name: "ok", raw: VALID_RAW, ctx: {}, deps: {} },
  ];

  for (const s of scenarios) {
    test(`${s.name}: JSON.stringify(outcome)·limit() 식별자·console 에 '192.168'·'10.0.0' 없음`, async () => {
      const limiters = s.deps.limiters ?? sameLimiterEverywhere(limiterOk());
      const out = await runGuards(s.raw, makeCtx(s.ctx), makeDeps({ ...s.deps, limiters }));
      const text = JSON.stringify(out);
      expect(text).not.toContain("192.168");
      expect(text).not.toContain("10.0.0");
      expect(text).not.toContain(IP);
      for (const b of ["known", "unknown"] as const)
        for (const w of ["short", "long"] as const) {
          const calls = (limiters[b][w].limit as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
          for (const c of calls) {
            expect(String(c[0])).toMatch(/^[0-9a-f]{16}$/);
            expect(String(c[0])).not.toContain("192.168");
          }
        }
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    });
  }

  test("remoteip 는 siteverify 요청 본문에만 간다 (Cloudflare 는 국외이전 고지에 있는 수탁사) — 결과에는 없다", async () => {
    const fetch = fetchOk();
    const out = await runGuards(VALID_RAW, makeCtx(), makeDeps({ fetch }));
    expect(out.ok).toBe(true);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.remoteip).toBe(IP);
    expect(body.secret).toBe(TURNSTILE_SECRET);
    expect(body.response).toBe("tok-valid");
    expect(JSON.stringify(out)).not.toContain(IP);
  });

  test("IP 를 모르면 remoteip 를 보내지 않고 unknown 버킷 limiter 를 쓴다", async () => {
    const fetch = fetchOk();
    const known = limiterOk();
    const unknown = limiterOk();
    const limiters: RateLimiterSet = { known: { short: known, long: known }, unknown: { short: unknown, long: unknown } };
    const out = await runGuards(VALID_RAW, makeCtx({ headers: headersOf({}) }), makeDeps({ fetch, limiters }));
    expect(out.ok).toBe(true);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect("remoteip" in body).toBe(false);
    expect(known.limit).toHaveBeenCalledTimes(0);
    expect(unknown.limit).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// 5. Turnstile — mock fetch
// =============================================================================
describe("verifyTurnstile (mock fetch)", () => {
  const tdeps = (fetch: FetchLike, o: Partial<{ allowedHosts: readonly string[]; action: string | null; timeoutMs: number }> = {}) => ({
    fetch,
    secret: TURNSTILE_SECRET,
    allowedHosts: o.allowedHosts ?? ["localhost"],
    action: o.action === undefined ? TURNSTILE_ACTION : o.action,
    timeoutMs: o.timeoutMs ?? 5000,
  });

  test("상수: action 'reserve', siteverify URL", () => {
    expect(TURNSTILE_ACTION).toBe("reserve");
    expect(TURNSTILE_SITEVERIFY_URL).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
  });

  test("success:true + hostname 허용 + action 일치 → ok", async () => {
    expect(await verifyTurnstile("tok", IP, tdeps(fetchOk()))).toEqual({ ok: true });
  });

  test("hostname 비교는 대소문자를 가리지 않는다", async () => {
    expect(await verifyTurnstile("tok", IP, tdeps(fetchOk({ hostname: "LocalHost" })))).toEqual({ ok: true });
  });

  test("success:false → turnstile (error-codes 는 detail 에)", async () => {
    const r = await verifyTurnstile("tok", IP, tdeps(fetchOk({ success: false, "error-codes": ["invalid-input-response"] })));
    expect(r).toMatchObject({ ok: false, reason: "turnstile", detail: { code: "verify-failed", errorCodes: ["invalid-input-response"] } });
  });

  test("success:false + error-codes internal-error → infra (Cloudflare 쪽 장애 — 봇 판정이 아니다)", async () => {
    const r = await verifyTurnstile("tok", IP, tdeps(fetchOk({ success: false, "error-codes": ["internal-error"] })));
    expect(r).toMatchObject({ ok: false, reason: "infra" });
  });

  test("hostname 불일치 → turnstile", async () => {
    const r = await verifyTurnstile("tok", IP, tdeps(fetchOk({ hostname: "evil.example" })));
    expect(r).toMatchObject({ ok: false, reason: "turnstile", detail: { code: "hostname-mismatch" } });
  });

  test("hostname 누락 → turnstile", async () => {
    const r = await verifyTurnstile("tok", IP, tdeps(fetchOk({ hostname: undefined })));
    expect(r).toMatchObject({ ok: false, reason: "turnstile", detail: { code: "hostname-mismatch" } });
  });

  test("action 불일치 → turnstile / action 누락 → turnstile", async () => {
    expect(await verifyTurnstile("tok", IP, tdeps(fetchOk({ action: "login" })))).toMatchObject({
      ok: false,
      reason: "turnstile",
      detail: { code: "action-mismatch" },
    });
    expect(await verifyTurnstile("tok", IP, tdeps(fetchOk({ action: undefined })))).toMatchObject({
      ok: false,
      reason: "turnstile",
      detail: { code: "action-mismatch" },
    });
  });

  test("action:null 이면 action 비교를 생략한다 (Cloudflare 더미 키 응답에는 action 이 없다 — 라이브 스모크 전용)", async () => {
    expect(await verifyTurnstile("tok", IP, tdeps(fetchOk({ action: undefined }), { action: null }))).toEqual({ ok: true });
  });

  test("네트워크 throw → infra", async () => {
    const r = await verifyTurnstile("tok", IP, tdeps(fetchThrowing()));
    expect(r).toMatchObject({ ok: false, reason: "infra", detail: { code: "network" } });
  });

  test("타임아웃 → infra (AbortController 로 요청을 끊는다)", async () => {
    const fetch = fetchHanging();
    const r = await verifyTurnstile("tok", IP, tdeps(fetch, { timeoutMs: 20 }));
    expect(r).toMatchObject({ ok: false, reason: "infra", detail: { code: "timeout" } });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal?.aborted).toBe(true);
  });

  test("HTTP 5xx → infra / JSON 아님 → infra", async () => {
    const f500 = vi.fn(async () => siteverifyResponse({ success: true }, 503)) as unknown as FetchLike;
    expect(await verifyTurnstile("tok", IP, tdeps(f500))).toMatchObject({ ok: false, reason: "infra", detail: { code: "http", status: 503 } });
    const fHtml = vi.fn(async () => new Response("<html>oops</html>", { status: 200 })) as unknown as FetchLike;
    expect(await verifyTurnstile("tok", IP, tdeps(fHtml))).toMatchObject({ ok: false, reason: "infra", detail: { code: "bad-json" } });
  });

  test("토큰 없음·비문자열·2048자 초과 → turnstile, fetch 호출 0", async () => {
    const fetch = fetchOk();
    for (const t of ["", null, undefined, 42, "x".repeat(2049)]) {
      expect(await verifyTurnstile(t, IP, tdeps(fetch))).toMatchObject({ ok: false, reason: "turnstile" });
    }
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  test("요청은 POST JSON 이고 secret·response·remoteip 를 담는다; remoteIp null 이면 remoteip 생략", async () => {
    const fetch = fetchOk();
    await verifyTurnstile("tok", IP, tdeps(fetch));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ secret: TURNSTILE_SECRET, response: "tok", remoteip: IP });

    const fetch2 = fetchOk();
    await verifyTurnstile("tok", null, tdeps(fetch2));
    const [, init2] = fetch2.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init2.body))).toEqual({ secret: TURNSTILE_SECRET, response: "tok" });
  });

  test("실패 결과 어디에도 remoteIp 가 없다", async () => {
    const results = await Promise.all([
      verifyTurnstile("tok", IP, tdeps(fetchOk({ success: false, "error-codes": ["bad"] }))),
      verifyTurnstile("tok", IP, tdeps(fetchOk({ hostname: "evil.example" }))),
      verifyTurnstile("tok", IP, tdeps(fetchThrowing())),
      verifyTurnstile("tok", IP, tdeps(fetchHanging(), { timeoutMs: 10 })),
    ]);
    for (const r of results) expect(JSON.stringify(r)).not.toContain("192.168");
  });

  test("빈 Turnstile secret → throw (설정 오류)", async () => {
    await expect(verifyTurnstile("tok", IP, { ...tdeps(fetchOk()), secret: "" })).rejects.toThrow();
  });
});

// =============================================================================
// 6. 실제 Cloudflare 테스트 키 스모크 — GUARD_LIVE_TESTS=1 일 때만
// =============================================================================
const ALWAYS_PASS_SECRET = "1x0000000000000000000000000000000AA";
const ALWAYS_FAIL_SECRET = "2x0000000000000000000000000000000AA";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
/** 더미 키 응답의 hostname (2026-09-13 실측). action 필드는 오지 않는다. */
const DUMMY_HOSTNAME = "example.com";
const LIVE_TIMEOUT_MS = 20_000;

describe.skipIf(!process.env.GUARD_LIVE_TESTS)("Cloudflare 공식 테스트 키 — 실제 siteverify", () => {
  const live = (secret: string, o: Partial<{ allowedHosts: readonly string[]; action: string | null }> = {}) => ({
    fetch: globalThis.fetch as FetchLike,
    secret,
    allowedHosts: o.allowedHosts ?? [DUMMY_HOSTNAME],
    action: o.action === undefined ? null : o.action,
    timeoutMs: 10_000,
  });

  test(
    "항상통과 키 → ok (hostname example.com 허용, action 비교 생략)",
    async () => {
      expect(await verifyTurnstile(DUMMY_TOKEN, null, live(ALWAYS_PASS_SECRET))).toEqual({ ok: true });
    },
    LIVE_TIMEOUT_MS,
  );

  test(
    "항상통과 키라도 action 'reserve' 를 요구하면 turnstile/action-mismatch — 실제 응답에 action 이 없기 때문",
    async () => {
      expect(await verifyTurnstile(DUMMY_TOKEN, null, live(ALWAYS_PASS_SECRET, { action: TURNSTILE_ACTION }))).toMatchObject({
        ok: false,
        reason: "turnstile",
        detail: { code: "action-mismatch" },
      });
    },
    LIVE_TIMEOUT_MS,
  );

  test(
    "항상통과 키라도 허용 호스트가 localhost 뿐이면 turnstile/hostname-mismatch",
    async () => {
      expect(await verifyTurnstile(DUMMY_TOKEN, null, live(ALWAYS_PASS_SECRET, { allowedHosts: ["localhost"] }))).toMatchObject({
        ok: false,
        reason: "turnstile",
        detail: { code: "hostname-mismatch", hostname: DUMMY_HOSTNAME },
      });
    },
    LIVE_TIMEOUT_MS,
  );

  test(
    "항상실패 키 → turnstile/verify-failed, error-codes 에 invalid-input-response",
    async () => {
      const r = await verifyTurnstile(DUMMY_TOKEN, null, live(ALWAYS_FAIL_SECRET));
      expect(r).toMatchObject({ ok: false, reason: "turnstile", detail: { code: "verify-failed" } });
      if (r.ok) return;
      expect((r.detail as { errorCodes: string[] }).errorCodes).toContain("invalid-input-response");
    },
    LIVE_TIMEOUT_MS,
  );

  test(
    "runGuards 전체 경로 + 실제 siteverify(통과 키) + mock limiter → ok. limit 2회",
    async () => {
      const limiters = sameLimiterEverywhere(limiterOk());
      const deps = makeDeps({ fetch: globalThis.fetch as FetchLike, limiters, allowedHosts: [DUMMY_HOSTNAME], action: null });
      deps.turnstile.secret = ALWAYS_PASS_SECRET;
      const out = await runGuards(VALID_RAW, makeCtx({ turnstileToken: DUMMY_TOKEN }), deps);
      expect(out.ok).toBe(true);
      expect(totalLimitCalls(limiters)).toBe(2);
    },
    LIVE_TIMEOUT_MS,
  );
});

// =============================================================================
// 7. RateLimit — mock limiter
// =============================================================================
describe("checkRateLimit (mock limiter)", () => {
  const rdeps = (l: RateLimiterLike | RateLimiterSet, timeoutMs = 5000) => ({
    limiters: "limit" in l ? sameLimiterEverywhere(l as RateLimiterLike) : (l as RateLimiterSet),
    timeoutMs,
  });

  test("상수: known 10분 5 · 1시간 15, unknown 10분 2 · 1시간 7", () => {
    expect(RATE_LIMITS.known.short).toEqual({ max: 5, window: "10 m" });
    expect(RATE_LIMITS.known.long).toEqual({ max: 15, window: "1 h" });
    expect(RATE_LIMITS.unknown.short).toEqual({ max: 2, window: "10 m" });
    expect(RATE_LIMITS.unknown.long).toEqual({ max: 7, window: "1 h" });
  });

  test("두 창 모두 success → ok, limit 2회, 식별자는 key 그대로", async () => {
    const l = limiterOk();
    expect(await checkRateLimit("abcdef0123456789", "known", rdeps(l))).toEqual({ ok: true });
    expect(l.limit).toHaveBeenCalledTimes(2);
    expect(l.limit.mock.calls.map((c: unknown[]) => c[0])).toEqual(["abcdef0123456789", "abcdef0123456789"]);
  });

  test("success:false → ratelimit (detail: window·resetAt, key 없음)", async () => {
    const r = await checkRateLimit("abcdef0123456789", "known", rdeps(limiterDeny()));
    expect(r).toMatchObject({ ok: false, reason: "ratelimit", detail: { window: "short" } });
    expect(JSON.stringify(r)).not.toContain("abcdef0123456789");
  });

  test("long 창만 막히면 ratelimit/window:long", async () => {
    const set: RateLimiterSet = { known: { short: limiterOk(), long: limiterDeny() }, unknown: { short: limiterOk(), long: limiterOk() } };
    expect(await checkRateLimit("k", "known", rdeps(set))).toMatchObject({ ok: false, reason: "ratelimit", detail: { window: "long" } });
  });

  test("bucket 에 맞는 limiter 만 쓴다", async () => {
    const known = limiterOk();
    const unknown = limiterOk();
    const set: RateLimiterSet = { known: { short: known, long: known }, unknown: { short: unknown, long: unknown } };
    await checkRateLimit("k", "unknown", rdeps(set));
    expect(known.limit).toHaveBeenCalledTimes(0);
    expect(unknown.limit).toHaveBeenCalledTimes(2);
  });

  test("throw → infra", async () => {
    expect(await checkRateLimit("k", "known", rdeps(limiterThrowing()))).toMatchObject({ ok: false, reason: "infra", detail: { code: "network" } });
  });

  test("응답 없음(타임아웃) → infra", async () => {
    expect(await checkRateLimit("k", "known", rdeps(limiterHanging(), 20))).toMatchObject({ ok: false, reason: "infra", detail: { code: "timeout" } });
  });

  test("Upstash 자체 timeout 응답(success:true·reason:'timeout' = fail-open) → infra 로 뒤집는다", async () => {
    expect(await checkRateLimit("k", "known", rdeps(limiterUpstreamTimeout()))).toMatchObject({
      ok: false,
      reason: "infra",
      detail: { code: "upstream-timeout" },
    });
  });
});

// =============================================================================
// 8. 정적 — lib/guard/** 규약
// =============================================================================
describe("lib/guard/** 정적 규약", () => {
  const files = readdirSync(GUARD_DIR).filter((f) => f.endsWith(".ts"));
  const sources = Object.fromEntries(files.map((f) => [f, read(path.join(GUARD_DIR, f))]));

  test("브리프의 파일 7개 + deps.ts 가 있다", () => {
    for (const f of ["types.ts", "honeypot.ts", "timetrap.ts", "ipKey.ts", "turnstile.ts", "rateLimit.ts", "index.ts", "deps.ts"]) {
      expect(files, f).toContain(f);
    }
  });

  test("'use server' 가 한 파일에도 없다 (lib 순수 모듈 — 서버 액션은 P3-3)", () => {
    for (const [f, src] of Object.entries(sources)) expect(src, f).not.toMatch(/['"]use server['"]/);
  });

  test("process.env 직접 참조는 deps.ts 한 곳뿐", () => {
    for (const [f, src] of Object.entries(sources)) {
      if (f === "deps.ts") expect(src).toMatch(/process\.env\./);
      else expect(src, f).not.toMatch(/process\.env/);
    }
  });

  test("deps.ts 가 읽는 env 는 허용 목록뿐이고, 우회 스위치(DISABLE·BYPASS·SKIP·MOCK)는 없다", () => {
    const names = [...sources["deps.ts"].matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    const allowed = new Set([
      "GUARD_SECRET",
      "GUARD_ALLOWED_HOSTS",
      "TURNSTILE_SECRET_KEY",
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "VERCEL_ENV",
    ]);
    for (const n of names) expect(allowed.has(n), n).toBe(true);
    for (const src of Object.values(sources)) expect(src).not.toMatch(/GUARD_(DISABLE|BYPASS|SKIP|MOCK)|(DISABLE|BYPASS|SKIP)_GUARD/);
  });

  test("deps.ts 만 server-only 를 import 하고, index.ts 는 deps.ts 를 re-export 하지 않는다 (테스트·순수 호출자가 index 를 안전하게 import)", () => {
    expect(sources["deps.ts"]).toMatch(/^import\s+["']server-only["'];?$/m);
    for (const [f, src] of Object.entries(sources)) {
      if (f !== "deps.ts") expect(src, f).not.toMatch(/["']server-only["']/);
    }
    expect(sources["index.ts"]).not.toMatch(/from\s+["']\.\/deps["']/);
  });

  test("defaultGuardDeps 는 action 을 TURNSTILE_ACTION('reserve') 으로 고정한다", () => {
    expect(sources["deps.ts"]).toMatch(/action:\s*TURNSTILE_ACTION/);
  });

  test("Upstash Ratelimit 을 analytics:false·명시적 timeout 으로 만들고, 4개 창(known/unknown × 10m/1h) 프리픽스를 나눈다", () => {
    const src = sources["deps.ts"];
    expect(src).toMatch(/analytics:\s*false/);
    expect(src).toMatch(/timeout:\s*RATE_LIMIT_TIMEOUT_MS/);
    expect(src).toMatch(/Ratelimit\.slidingWindow\(/);
    expect(src).toMatch(/prefix:/);
  });

  test("lib/guard 는 lib/reservations·lib/ports·components·app 을 import 하지 않는다 (동시 진행 태스크 경계)", () => {
    for (const [f, src] of Object.entries(sources)) {
      expect(src, f).not.toMatch(/from\s+["'](\.\.\/|@\/lib\/)(reservations|ports)\//);
      expect(src, f).not.toMatch(/from\s+["']@\/(components|app)\//);
    }
  });

  test(".env.example 끝에 GUARD_SECRET·GUARD_ALLOWED_HOSTS 가 공란으로 추가됐고 기존 키는 그대로", () => {
    const env = read(path.join(ROOT, ".env.example"));
    expect(env).toMatch(/^GUARD_SECRET=$/m);
    expect(env).toMatch(/^GUARD_ALLOWED_HOSTS=$/m);
    for (const k of ["TURNSTILE_SECRET_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "CRON_SECRET"]) {
      expect(env).toMatch(new RegExp(`^${k}=$`, "m"));
    }
    expect(env.indexOf("GUARD_SECRET=")).toBeGreaterThan(env.indexOf("CRON_SECRET="));
  });

  test("ci.yml test 잡의 Test 스텝에 GUARD_LIVE_TESTS 가 있다 (라이브 스모크가 CI 에서 skip 되지 않는다)", () => {
    const ci = read(path.join(ROOT, ".github", "workflows", "ci.yml"));
    const testJob = ci.slice(ci.indexOf("\n  test:\n"), ci.indexOf("\n  pricing-regression-gate:"));
    expect(testJob).toMatch(/GUARD_LIVE_TESTS:\s*["']?1["']?/);
  });
});

// =============================================================================
// 9. defaultGuardDeps — env 배선 (server-only 는 위에서 mock)
// =============================================================================
describe("defaultGuardDeps", () => {
  const KEYS = ["GUARD_SECRET", "GUARD_ALLOWED_HOSTS", "TURNSTILE_SECRET_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "VERCEL_ENV"] as const;
  let saved: Record<string, string | undefined>;
  const good = () => {
    process.env.GUARD_SECRET = SECRET;
    process.env.GUARD_ALLOWED_HOSTS = " Localhost, bestour.co.kr ,,www.bestour.co.kr ";
    process.env.TURNSTILE_SECRET_KEY = "real-looking-secret";
    process.env.UPSTASH_REDIS_REST_URL = "https://unit-test.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "unit-test-token";
    delete process.env.VERCEL_ENV;
  };

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    good();
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("env 가 갖춰지면 deps 를 만든다 — action 'reserve', 호스트 trim·소문자·빈 항목 제거, limiter 4개, 5초 타임아웃", () => {
    const d = defaultGuardDeps();
    expect(d.secret).toBe(SECRET);
    expect(d.turnstile.action).toBe("reserve");
    expect(d.turnstile.secret).toBe("real-looking-secret");
    expect(d.turnstile.allowedHosts).toEqual(["localhost", "bestour.co.kr", "www.bestour.co.kr"]);
    expect(d.turnstile.timeoutMs).toBe(5000);
    expect(d.rateLimit.timeoutMs).toBe(5000);
    for (const b of ["known", "unknown"] as const)
      for (const w of ["short", "long"] as const) expect(typeof d.rateLimit.limiters[b][w].limit).toBe("function");
    expect(d.now()).toBeInstanceOf(Date);
  });

  test("GUARD_SECRET 누락 또는 32자 미만 → throw", () => {
    expect(GUARD_SECRET_MIN_LENGTH).toBe(32);
    delete process.env.GUARD_SECRET;
    expect(() => defaultGuardDeps()).toThrow(/GUARD_SECRET/);
    process.env.GUARD_SECRET = "short";
    expect(() => defaultGuardDeps()).toThrow(/GUARD_SECRET/);
  });

  test("GUARD_ALLOWED_HOSTS 누락·공란 → throw", () => {
    delete process.env.GUARD_ALLOWED_HOSTS;
    expect(() => defaultGuardDeps()).toThrow(/GUARD_ALLOWED_HOSTS/);
    process.env.GUARD_ALLOWED_HOSTS = " , ";
    expect(() => defaultGuardDeps()).toThrow(/GUARD_ALLOWED_HOSTS/);
  });

  test("TURNSTILE_SECRET_KEY·UPSTASH_* 누락 → throw", () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(() => defaultGuardDeps()).toThrow(/TURNSTILE_SECRET_KEY/);
    good();
    delete process.env.UPSTASH_REDIS_REST_URL;
    expect(() => defaultGuardDeps()).toThrow(/UPSTASH_REDIS_REST_URL/);
    good();
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(() => defaultGuardDeps()).toThrow(/UPSTASH_REDIS_REST_TOKEN/);
  });

  test("VERCEL_ENV=production 에서 Cloudflare 더미 secret(1x/2x/3x…AA) → throw. 프리뷰·개발은 허용", () => {
    for (const s of [ALWAYS_PASS_SECRET, ALWAYS_FAIL_SECRET, "3x0000000000000000000000000000000AA"]) {
      process.env.TURNSTILE_SECRET_KEY = s;
      process.env.VERCEL_ENV = "production";
      expect(() => defaultGuardDeps(), s).toThrow(/TURNSTILE_SECRET_KEY/);
      process.env.VERCEL_ENV = "preview";
      expect(() => defaultGuardDeps(), s).not.toThrow();
      delete process.env.VERCEL_ENV;
      expect(() => defaultGuardDeps(), s).not.toThrow();
    }
  });

  test("같은 Upstash 접속정보면 limiter 세트를 재사용한다 (모듈 스코프 캐시 — ephemeral cache 유지)", () => {
    const a = defaultGuardDeps();
    const b = defaultGuardDeps();
    expect(a.rateLimit.limiters).toBe(b.rateLimit.limiters);
    process.env.UPSTASH_REDIS_REST_TOKEN = "another-token";
    const c = defaultGuardDeps();
    expect(c.rateLimit.limiters).not.toBe(a.rateLimit.limiters);
  });
});
