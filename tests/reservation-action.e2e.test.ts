/**
 * P3-3 E2E — 서버액션 `submitReservation` 을 **진짜 runGuards + 진짜 createReservation + 로컬 Supabase insert** 로 관통한다.
 *
 * 실행 조건: tests/helpers/load-env-local.ts `dbWriteGate()` — NEXT_PUBLIC_SUPABASE_URL 이 로컬 스택(127.0.0.1/localhost/kong) **그리고** REQUIRE_DB_TESTS=1.
 * 원격(.env.local 의 라이브 프로젝트)이면 REQUIRE_DB_TESTS=1 이어도 닫힌다 — reservations 는 고객 개인정보 테이블이다. CI db-test 잡이 이 조건을 만든다.
 * 닫혀 있으면 "가드가 닫혀 있다"는 것을 단언하는 테스트 1건만 돈다(outbox.test.ts·purge.test.ts 와 같은 패턴).
 *
 * 무엇이 진짜이고 무엇이 대체인가
 *   진짜: lib/guard runGuards(zod·허니팟·타임트랩·Turnstile 응답 판정·rate limit 판정), lib/guard/turnstile.ts verifyTurnstile, lib/reservations/create.ts,
 *        lib/reservations/db.ts(서비스 롤 → 로컬 스택), lib/notify/outbox.ts enqueue, lib/log.ts
 *   대체: next/headers(요청 스코프 밖), lib/guard/deps(env 대신 주입 — Turnstile 은 siteverify 응답 stub(실제 네트워크는 tests/guard.test.ts 라이브 스모크가 담당),
 *        Upstash 는 in-memory 카운터), lib/ports/*(after()·revalidateTag() 는 요청 스코프 밖에서 throw)
 *
 * siteverify 응답 stub(P3-3-FIX M2): CI db-test 잡이 Cloudflare 네트워크에 기대지 않게 한다 — 기대면 코드 변경 없이 잡이 빨개지고, 실패가 `infra` 로 나와
 * DB 쪽을 의심하게 만든다. stub 모양은 더미 키의 실제 응답(P3-1 보고서 §5 · tests/guard.test.ts:678-679 DUMMY_HOSTNAME, :692-732 라이브 스모크 실측):
 * 통과키 1x…AA → { success:true, hostname:'example.com' } (action 필드 없음) · 실패키 2x…AA → { success:false, 'error-codes':['invalid-input-response'] }.
 * → allowedHosts ['example.com'] · action null. 운영 deps(defaultGuardDeps)는 action 을 'reserve' 로 고정하고 운영에서 더미 secret 을 거부한다 — 그쪽은 tests/guard.test.ts 가 잠근다.
 * stub 이 실제 응답과 어긋나면 GUARD_LIVE_TESTS=1 라이브 스모크가 잡는다(같은 hostname·action 부재를 단언한다).
 *
 * 만든 행은 테스트 안에서 즉시 지운다(notifications_log → reservations 순, FK). afterAll 이 이름 마커로 한 번 더 쓸어 담는다.
 * 주의: tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, test, vi } from "vitest";

import { PURPOSES } from "@/lib/codes";
import {
  RATE_LIMITS,
  RATE_LIMIT_TIMEOUT_MS,
  TURNSTILE_ACTION,
  TURNSTILE_SITEVERIFY_URL,
  TURNSTILE_TIMEOUT_MS,
  issueFormToken,
  verifyTurnstile,
  type FetchLike,
  type GuardDeps,
  type RateLimiterLike,
  type RateLimiterSet,
} from "@/lib/guard";
import { TEMPLATE_KEYS } from "@/lib/notify/outbox";
import { QUERY_TAGS } from "@/lib/queries/tags";
import { withNotificationsLock } from "./helpers/db-lock";
import { dbSmokeEnv, dbWriteGate, isLocalStackUrl } from "./helpers/load-env-local";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/guard/deps", () => ({ defaultGuardDeps: vi.fn() }));
vi.mock("@/lib/ports/after", () => ({
  runAfter: vi.fn((task: () => void | Promise<void>) => {
    void task();
  }),
}));
vi.mock("@/lib/ports/revalidate", () => ({ revalidate: vi.fn() }));

import { headers } from "next/headers";
import { defaultGuardDeps } from "@/lib/guard/deps";
import { revalidate } from "@/lib/ports/revalidate";
import { submitReservation } from "@/actions/reservation";

// =============================================================================
// 가드
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[reservation-action.e2e] E2E skip — ${gate.reason}`);
}

test("DB 쓰기 가드 — 원격 URL 이면 REQUIRE_DB_TESTS=1 을 강제해도 닫힌다", () => {
  const forced = dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, REQUIRE_DB_TESTS: "1" });
  if (!isLocalStackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    expect(forced.allowed).toBe(false);
    expect(gate.allowed).toBe(false);
  } else {
    expect(forced.allowed).toBe(true);
  }
});

// =============================================================================
// 주입 deps — Turnstile siteverify 응답 stub(더미 키 응답 모양, 네트워크 0) + in-memory rate limit
// =============================================================================
/** Cloudflare 문서 공개 테스트 secret — 비밀이 아니다. 항상 통과 / 항상 실패. stub 은 요청 본문의 secret 으로 응답을 고른다. */
const TURNSTILE_PASS_SECRET = "1x0000000000000000000000000000000AA";
const TURNSTILE_FAIL_SECRET = "2x0000000000000000000000000000000AA";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const DUMMY_HOSTNAME = "example.com";
const SECRET = randomBytes(32).toString("hex");
const CLIENT_IP = "203.0.113.10"; // TEST-NET-3 — 실제 주소가 아니다

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/**
 * siteverify 응답 stub — lib/guard/turnstile.ts 가 읽는 필드(success·hostname·action·error-codes)만 담는다.
 * siteverify URL 이 아니거나 모르는 secret 이면 throw — 예상 밖 네트워크 호출을 잡는다(verifyTurnstile 은 그 throw 를 infra 로 바꾼다 → "정상 접수" 가 빨개진다).
 */
const siteverifyStub: FetchLike = async (input, init) => {
  if (input !== TURNSTILE_SITEVERIFY_URL) throw new Error(`[reservation-action.e2e] 예상 밖 네트워크 호출: ${input}`);
  const { secret } = JSON.parse(String(init.body)) as { secret?: unknown };
  if (secret === TURNSTILE_PASS_SECRET) return jsonResponse({ success: true, hostname: DUMMY_HOSTNAME });
  if (secret === TURNSTILE_FAIL_SECRET) return jsonResponse({ success: false, "error-codes": ["invalid-input-response"] });
  throw new Error("[reservation-action.e2e] siteverify stub: 더미 키가 아닌 secret");
};
/** liveDeps 가 넘기는 fetch — 호출 수를 센다(허니팟 경로가 네트워크에 가지 않음을 직접 단언). */
const siteverifyFetch = vi.fn(siteverifyStub);

test("siteverify stub — 진짜 verifyTurnstile 이 통과키 → ok · 실패키 → turnstile/verify-failed · action 'reserve' 요구 → action-mismatch(라이브 스모크와 같은 결과) · 다른 URL → throw", async () => {
  const deps = (secret: string, action: string | null = null) => ({
    fetch: siteverifyStub,
    secret,
    allowedHosts: [DUMMY_HOSTNAME],
    action,
    timeoutMs: TURNSTILE_TIMEOUT_MS,
  });
  expect(await verifyTurnstile(DUMMY_TOKEN, null, deps(TURNSTILE_PASS_SECRET))).toEqual({ ok: true });
  expect(await verifyTurnstile(DUMMY_TOKEN, null, deps(TURNSTILE_FAIL_SECRET))).toMatchObject({
    ok: false,
    reason: "turnstile",
    detail: { code: "verify-failed", errorCodes: ["invalid-input-response"] },
  });
  // 더미 응답에는 action 이 없다 — 운영처럼 'reserve' 를 요구하면 action-mismatch (tests/guard.test.ts:700 라이브 스모크와 동일)
  expect(await verifyTurnstile(DUMMY_TOKEN, null, deps(TURNSTILE_PASS_SECRET, TURNSTILE_ACTION))).toMatchObject({
    ok: false,
    reason: "turnstile",
    detail: { code: "action-mismatch" },
  });
  expect(await verifyTurnstile(DUMMY_TOKEN, null, { ...deps(TURNSTILE_PASS_SECRET), allowedHosts: ["localhost"] })).toMatchObject({
    ok: false,
    reason: "turnstile",
    detail: { code: "hostname-mismatch", hostname: DUMMY_HOSTNAME },
  });
  await expect(siteverifyStub("https://example.com/elsewhere", { method: "POST", body: "{}" })).rejects.toThrow(/예상 밖 네트워크 호출/);
});

function memoryLimiter(max: number): RateLimiterLike {
  const counts = new Map<string, number>();
  return {
    async limit(identifier: string) {
      const n = (counts.get(identifier) ?? 0) + 1;
      counts.set(identifier, n);
      return { success: n <= max, limit: max, remaining: Math.max(0, max - n) };
    },
  };
}

function memoryLimiters(): RateLimiterSet {
  return {
    known: { short: memoryLimiter(RATE_LIMITS.known.short.max), long: memoryLimiter(RATE_LIMITS.known.long.max) },
    unknown: { short: memoryLimiter(RATE_LIMITS.unknown.short.max), long: memoryLimiter(RATE_LIMITS.unknown.long.max) },
  };
}

function liveDeps(turnstileSecret: string, limiters: RateLimiterSet): GuardDeps {
  return {
    now: () => new Date(),
    secret: SECRET,
    turnstile: {
      fetch: siteverifyFetch as unknown as FetchLike,
      secret: turnstileSecret,
      allowedHosts: [DUMMY_HOSTNAME],
      action: null,
      timeoutMs: TURNSTILE_TIMEOUT_MS,
    },
    rateLimit: { limiters, timeoutMs: RATE_LIMIT_TIMEOUT_MS },
  };
}

// =============================================================================
// 폼
// =============================================================================
const MARK = `p33e2e-${randomUUID().slice(0, 8)}`;
const CUSTOMER_PHONE_FORM = "010-1234-5678";
const CUSTOMER_PHONE_E164 = "+821012345678";

type FormValue = string | string[] | null;
function form(overrides: Record<string, FormValue> = {}): FormData {
  const base: Record<string, FormValue> = {
    name: MARK,
    phone: CUSTOMER_PHONE_FORM,
    vehicleSlug: "bus45",
    purposeCode: PURPOSES[0],
    originCode: "SEL",
    destinationCode: "ICN",
    tripType: "round",
    departAtLocal: "2026-10-01T08:00",
    returnAtLocal: "2026-10-01T18:00",
    busCount: "1",
    passengers: "30",
    locale: "ko",
    privacyConsent: "on",
    // 타임트랩: 렌더 4초 전에 발급된 토큰(최소 3초)
    formToken: issueFormToken(new Date(Date.now() - 4_000), SECRET),
    "cf-turnstile-response": DUMMY_TOKEN,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v === null) continue;
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  }
  return fd;
}

type RequestHeaders = Awaited<ReturnType<typeof headers>>;
const requestHeaders = () => new Headers({ "x-forwarded-for": CLIENT_IP, host: "localhost" }) as unknown as RequestHeaders;

// =============================================================================
// E2E
// =============================================================================
describe.skipIf(!gate.allowed || !env.hasServiceRole)("E2E — 진짜 guards + 진짜 createReservation + 로컬 스택 insert (dbWriteGate)", () => {
  // 진짜 접수는 notifications_log 에 pending 을 넣는다(테스트 안에서 곧 지우지만 그 사이가 창이다).
  // 그 행은 0005 claim 의 사정권 안이라 outbox 계열 파일과 겹치면 서로를 깨뜨린다 (tests/helpers/db-lock.ts).
  withNotificationsLock();

  const restHeaders = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  async function rest<T = unknown>(method: string, pathAndQuery: string): Promise<{ status: number; body: T }> {
    const res = await fetch(`${env.restRoot}${pathAndQuery}`, { method, headers: restHeaders });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // 본문이 JSON 이 아니면 문자열 그대로
    }
    return { status: res.status, body: body as T };
  }

  interface ReservationRow {
    id: string;
    public_code: string;
    name: string;
    phone: string;
    status: string;
    trip_type: string;
    nights: number;
    privacy_consent_at: string | null;
    retention_until: string | null;
  }
  interface LogRow {
    id: number;
    channel: string;
    template: string;
    status: string;
    to_phone: string;
  }

  const reservationsByName = () =>
    rest<ReservationRow[]>("GET", `/reservations?name=eq.${encodeURIComponent(MARK)}&select=id,public_code,name,phone,status,trip_type,nights,privacy_consent_at,retention_until`);

  async function purgeByMark(): Promise<void> {
    const rows = await reservationsByName();
    const ids = Array.isArray(rows.body) ? rows.body.map((r) => r.id) : [];
    if (ids.length === 0) return;
    await rest("DELETE", `/notifications_log?reservation_id=in.(${ids.join(",")})`);
    await rest("DELETE", `/reservations?name=eq.${encodeURIComponent(MARK)}`);
  }

  afterAll(async () => {
    await purgeByMark();
  });

  test("전제 — 서비스 롤 클라이언트가 볼 URL 이 로컬 스택이다 (createServiceClient 는 같은 env 를 읽는다)", () => {
    expect(isLocalStackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)).toBe(true);
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  });

  test("정상 접수 — reservations 1행 · notifications_log 1~2행(고객 SMS 필수) · revalidate('recent') · 즉시 삭제", async () => {
    vi.mocked(headers).mockResolvedValue(requestHeaders());
    vi.mocked(defaultGuardDeps).mockReturnValue(liveDeps(TURNSTILE_PASS_SECRET, memoryLimiters()));
    vi.mocked(revalidate).mockClear();

    const result = await submitReservation(form());
    expect(result.ok).toBe(true);
    if (!result.ok || result.publicCode === null) throw new Error(`접수 실패: ${JSON.stringify(result)}`);
    expect(result.publicCode).toHaveLength(8);
    expect(result.notifyQueued).toBe(true);
    expect(revalidate).toHaveBeenCalledWith(QUERY_TAGS.recent);

    const rows = await rest<ReservationRow[]>(
      "GET",
      `/reservations?public_code=eq.${result.publicCode}&select=id,public_code,name,phone,status,trip_type,nights,privacy_consent_at,retention_until`,
    );
    expect(rows.status).toBe(200);
    expect(rows.body).toHaveLength(1);
    const row = rows.body[0];
    expect(row.name).toBe(MARK);
    expect(row.phone).toBe(CUSTOMER_PHONE_E164);
    expect(row.status).toBe("new");
    expect(row.trip_type).toBe("round");
    expect(row.nights).toBe(0);
    expect(row.privacy_consent_at).toBeTruthy();
    expect(row.retention_until).toBeTruthy();

    const logs = await rest<LogRow[]>("GET", `/notifications_log?reservation_id=eq.${row.id}&select=id,channel,template,status,to_phone&order=id.asc`);
    expect(logs.status).toBe(200);
    expect(logs.body.length).toBeGreaterThanOrEqual(1);
    expect(logs.body.length).toBeLessThanOrEqual(2);
    for (const l of logs.body) {
      expect(l.status).toBe("pending");
      expect(TEMPLATE_KEYS).toContain(l.template);
    }
    const customer = logs.body.find((l) => l.template === "created.customer.sms");
    expect(customer?.to_phone).toBe(CUSTOMER_PHONE_E164);
    // 사장님 건은 OWNER_PHONE/OWNER_EMAIL env 가 있을 때만 — 있으면 2행이고 첫 행이 사장님 건(FIFO)
    const ownerConfigured = Boolean(process.env.OWNER_PHONE || process.env.OWNER_EMAIL);
    expect(logs.body.length).toBe(ownerConfigured ? 2 : 1);

    // 즉시 삭제 — 자식(notifications_log) → 부모(reservations)
    const delLogs = await rest("DELETE", `/notifications_log?reservation_id=eq.${row.id}`);
    expect([200, 204]).toContain(delLogs.status);
    const delRow = await rest("DELETE", `/reservations?id=eq.${row.id}`);
    expect([200, 204]).toContain(delRow.status);
    const after = await rest<ReservationRow[]>("GET", `/reservations?id=eq.${row.id}&select=id`);
    expect(after.body).toEqual([]);
  });

  test("허니팟 — 가짜 성공(publicCode:null), reservations 행 0, Turnstile 에 가지 않는다(stub 호출 0)", async () => {
    vi.mocked(headers).mockResolvedValue(requestHeaders());
    // 실패키를 주입해 둔다 — 허니팟이 먼저 끊으므로 stub 에 갔다면 turnstile 로 거부됐을 것이다. 호출 수 0 도 직접 센다.
    vi.mocked(defaultGuardDeps).mockReturnValue(liveDeps(TURNSTILE_FAIL_SECRET, memoryLimiters()));
    siteverifyFetch.mockClear();

    const result = await submitReservation(form({ website: "https://spam.example" }));
    expect(result).toEqual({ ok: true, publicCode: null });
    expect(siteverifyFetch).toHaveBeenCalledTimes(0);
    const rows = await reservationsByName();
    expect(rows.body).toEqual([]);
  });

  test("validation — privacyConsent 없음 → fieldErrors.privacyConsent, 행 0", async () => {
    vi.mocked(headers).mockResolvedValue(requestHeaders());
    vi.mocked(defaultGuardDeps).mockReturnValue(liveDeps(TURNSTILE_PASS_SECRET, memoryLimiters()));

    const result = await submitReservation(form({ privacyConsent: null }));
    expect(result).toMatchObject({ ok: false, code: "validation", messageKey: "reservation.errors.validation" });
    if (result.ok) throw new Error("unreachable");
    expect(result.fieldErrors).toHaveProperty("privacyConsent");
    expect(JSON.stringify(result)).not.toMatch(/"detail"/);
    const rows = await reservationsByName();
    expect(rows.body).toEqual([]);
  });

  test("turnstile — 항상실패 secret(siteverify 응답 stub: success:false) → code turnstile, 행 0, stub 호출 1", async () => {
    vi.mocked(headers).mockResolvedValue(requestHeaders());
    vi.mocked(defaultGuardDeps).mockReturnValue(liveDeps(TURNSTILE_FAIL_SECRET, memoryLimiters()));
    siteverifyFetch.mockClear();

    const result = await submitReservation(form());
    expect(result).toEqual({ ok: false, code: "turnstile", messageKey: "reservation.errors.turnstile" });
    expect(siteverifyFetch).toHaveBeenCalledTimes(1);
    const rows = await reservationsByName();
    expect(rows.body).toEqual([]);
  });

  test("ratelimit — in-memory 한도가 0 이면 검증된 요청도 ratelimit 으로 거부, 행 0 (슬롯 소비는 Turnstile 뒤)", async () => {
    vi.mocked(headers).mockResolvedValue(requestHeaders());
    const exhausted: RateLimiterSet = {
      known: { short: memoryLimiter(0), long: memoryLimiter(0) },
      unknown: { short: memoryLimiter(0), long: memoryLimiter(0) },
    };
    vi.mocked(defaultGuardDeps).mockReturnValue(liveDeps(TURNSTILE_PASS_SECRET, exhausted));

    const result = await submitReservation(form());
    expect(result).toEqual({ ok: false, code: "ratelimit", messageKey: "reservation.errors.ratelimit" });
    const rows = await reservationsByName();
    expect(rows.body).toEqual([]);
  });
});
