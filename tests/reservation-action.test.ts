/**
 * P3-3 — 서버액션 래퍼 `actions/reservation.ts` + 순수 보조 모듈(formData·submitResult) 계약 테스트 (플랜 v4 · ADR-3 · ADR-4).
 *
 * 브리프 §검증 1~7 을 그대로 단언한다:
 *   1. 순서 — guards 실패 → createReservation 0·revalidate 0 / guards silent → create 0·publicCode:null / guards ok → create 1 → runAfter 1 → revalidate('recent') 1
 *   2. 매핑 — reason 5종 → code·messageKey. zod 실패 → fieldErrors 에 path. 결과 객체에 `detail` 키 0
 *   3. create throw → { ok:false, code:'server' } + structuredLog 1회. throw 가 밖으로 나가지 않는다
 *   4. IP 비노출 — x-forwarded-for: 10.9.8.7 이 결과·로그 어디에도 없다 (Turnstile remoteip 로는 전달됐음을 함께 증명)
 *   5. formDataToRaw — 계약 표 전 필드 변환, checkbox "on" → true, 빈 문자열 → undefined, waypointCodes 배열, website 는 raw 밖·guardFields 안
 *   6. messages/ko.json reservation.errors 6키, ratelimit·infra 문구에 원장 COMPANY.tel
 *   7. 정적 — 'use server' 첫 줄, export 는 async function 1개, process.env 는 **검사 범위(actions/**·lib/guard·lib/reservations·lib/ports·lib/log.ts) 안에서**
 *      actions/reservation.ts·lib/guard/deps.ts 뿐(저장소 전체가 아니다 — supabase/*·app/* 등은 범위 밖, P3-3 리뷰 N1). headers()·formDataToRaw() 는 첫 try 안
 *   8. 입력 모양 방어(P3-3-FIX M3) — FormData 가 아닌 인자(null·{}·useActionState prevState)는 validation, headers() reject 는 infra. 어느 쪽도 throw 하지 않는다
 *
 * `'use server'` 파일을 vitest 에서 부르기 위해 next/headers·lib/guard/deps·lib/supabase/server·lib/ports/*·lib/reservations/{db,create}·lib/log 을
 * vi.mock 한다. **runGuards 는 진짜다** — fetch·limiter 만 주입 mock 이라 순서·reason 이 실제 guard 코드에서 나온다.
 * 원격 DB 쓰기 없음. tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { PURPOSES } from "@/lib/codes";
import { HONEYPOT_FIELD, TURNSTILE_ACTION, issueFormToken, type FetchLike, type GuardDeps, type GuardFailure, type RateLimiterSet } from "@/lib/guard";
import { COMPANY } from "@/lib/legal/disclosures";
import { QUERY_TAGS } from "@/lib/queries/tags";
import { ReservationInput } from "@/lib/types";
import {
  BOOLEAN_FORM_FIELDS,
  GUARD_FORM_FIELDS,
  GUARD_HEADER_NAMES,
  MULTI_FORM_FIELDS,
  NUMBER_FORM_FIELDS,
  RESERVATION_FORM_FIELDS,
  formDataToRaw,
  guardContext,
  guardHeaders,
} from "@/lib/reservations/formData";
import {
  RESERVATION_ERROR_KEYS,
  createdToLogs,
  createdToResult,
  guardFailureToResult,
  thrownToLog,
  type SubmitResult,
} from "@/lib/reservations/submitResult";

// server-only 는 vitest(node) 에서 import 즉시 throw 한다 — 빈 모듈로 바꿔치기(guard.test.ts·purge.test.ts 선례).
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/guard/deps", () => ({ defaultGuardDeps: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn(() => ({ kind: "fake-service-client" })) }));
vi.mock("@/lib/reservations/db", () => ({ supabaseReservationDb: vi.fn((client: unknown) => ({ kind: "fake-db", client })) }));
vi.mock("@/lib/reservations/create", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/reservations/create")>();
  return { ...mod, createReservation: vi.fn() };
});
vi.mock("@/lib/ports/after", () => ({
  runAfter: vi.fn((task: () => void | Promise<void>) => {
    void task();
  }),
}));
vi.mock("@/lib/ports/revalidate", () => ({ revalidate: vi.fn() }));
vi.mock("@/lib/log", () => ({ structuredLog: vi.fn() }));

import { headers } from "next/headers";
import { defaultGuardDeps } from "@/lib/guard/deps";
import { structuredLog } from "@/lib/log";
import { runAfter } from "@/lib/ports/after";
import { revalidate } from "@/lib/ports/revalidate";
import { createReservation } from "@/lib/reservations/create";
import { supabaseReservationDb } from "@/lib/reservations/db";
import { createServiceClient } from "@/lib/supabase/server";
import { submitReservation } from "@/actions/reservation";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (...rel: string[]) => readFileSync(path.join(ROOT, ...rel), "utf-8");

// =============================================================================
// §계약 — 폼 필드명 (브리프 표 그대로. lib/reservations/formData.ts 의 상수와 같아야 한다 — P3-4 는 lib 쪽을 import 한다)
// =============================================================================
const FORM_FIELD_CONTRACT = {
  name: "name",
  phone: "phone",
  phoneIntl: "phoneIntl",
  email: "email",
  vehicleSlug: "vehicleSlug",
  purposeCode: "purposeCode",
  originCode: "originCode",
  destinationCode: "destinationCode",
  waypointCodes: "waypointCodes",
  tripType: "tripType",
  departAtLocal: "departAtLocal",
  returnAtLocal: "returnAtLocal",
  busCount: "busCount",
  passengers: "passengers",
  contactMethod: "contactMethod",
  paymentMethod: "paymentMethod",
  parkingIncluded: "parkingIncluded",
  vatIncluded: "vatIncluded",
  message: "message",
  locale: "locale",
  privacyConsent: "privacyConsent",
  marketingConsent: "marketingConsent",
} as const;
const GUARD_FIELD_CONTRACT = { website: "website", formToken: "formToken", turnstile: "cf-turnstile-response" } as const;
const NUMBER_CONTRACT = ["busCount", "passengers"] as const;
const BOOLEAN_CONTRACT = ["privacyConsent", "marketingConsent", "parkingIncluded", "vatIncluded"] as const;
const MULTI_CONTRACT = ["waypointCodes"] as const;

// =============================================================================
// 픽스처
// =============================================================================
const SECRET = "unit-test-guard-secret-0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-09-13T03:00:00.000Z");
const IP = "10.9.8.7";
const RESERVATION_ID = "11111111-1111-4111-8111-111111111111";
const PUBLIC_CODE = "ABCDEFGH";

const validToken = () => issueFormToken(new Date(NOW.getTime() - 10_000), SECRET);

type FormValue = string | string[] | null;
function form(overrides: Record<string, FormValue> = {}): FormData {
  const base: Record<string, FormValue> = {
    name: "홍길동",
    phone: "010-1234-5678",
    email: "",
    vehicleSlug: "bus45",
    purposeCode: PURPOSES[0],
    originCode: "SEL",
    destinationCode: "ICN",
    waypointCodes: ["BSN"],
    tripType: "round",
    departAtLocal: "2026-10-01T08:00",
    returnAtLocal: "2026-10-01T18:00",
    busCount: "2",
    passengers: "40",
    contactMethod: "sms",
    paymentMethod: "",
    parkingIncluded: "on",
    vatIncluded: "",
    message: "",
    locale: "ko",
    privacyConsent: "on",
    marketingConsent: "",
    formToken: validToken(),
    "cf-turnstile-response": "unit-test-turnstile-token",
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v === null) continue; // null = 필드 자체를 보내지 않는다
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  }
  return fd;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function limiterSet(short = true): RateLimiterSet {
  const mk = (success: boolean) => ({ limit: vi.fn(async () => ({ success })) });
  return {
    known: { short: mk(short), long: mk(true) },
    unknown: { short: mk(short), long: mk(true) },
  };
}
const limitCalls = (set: RateLimiterSet) =>
  (["known", "unknown"] as const).flatMap((b) => (["short", "long"] as const).map((w) => vi.mocked(set[b][w].limit).mock.calls.length)).reduce((a, b) => a + b, 0);

interface FakeDepsOptions {
  fetch?: FetchLike;
  limiters?: RateLimiterSet;
}
function fakeDeps(opts: FakeDepsOptions = {}): GuardDeps & { fetchMock: ReturnType<typeof vi.fn>; limiters: RateLimiterSet } {
  const fetchMock = vi.fn(opts.fetch ?? (async () => jsonResponse({ success: true, hostname: "localhost", action: TURNSTILE_ACTION })));
  const limiters = opts.limiters ?? limiterSet();
  return {
    now: () => NOW,
    secret: SECRET,
    turnstile: { fetch: fetchMock as unknown as FetchLike, secret: "unit-turnstile-secret", allowedHosts: ["localhost"], action: TURNSTILE_ACTION, timeoutMs: 1_000 },
    rateLimit: { limiters, timeoutMs: 1_000 },
    fetchMock,
    limiters,
  };
}

type RequestHeaders = Awaited<ReturnType<typeof headers>>;
const requestHeaders = (init: Record<string, string>) => new Headers(init) as unknown as RequestHeaders;

const createdOk = () => ({ reservationId: RESERVATION_ID, publicCode: PUBLIC_CODE, notifyQueued: true, warnings: [] as string[] });

const ENV_KEYS = ["OWNER_PHONE", "OWNER_EMAIL"] as const;
let savedEnv: Record<string, string | undefined> = {};
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.OWNER_PHONE;
  delete process.env.OWNER_EMAIL;
  vi.mocked(headers).mockResolvedValue(requestHeaders({ "x-forwarded-for": IP, host: "localhost" }));
  vi.mocked(defaultGuardDeps).mockReturnValue(fakeDeps());
  vi.mocked(createReservation).mockResolvedValue(createdOk());
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

const everythingLogged = () =>
  [
    ...vi.mocked(structuredLog).mock.calls.map((c) => JSON.stringify(c)),
    ...consoleError.mock.calls.map((c: unknown[]) => JSON.stringify(c)),
    ...consoleWarn.mock.calls.map((c: unknown[]) => JSON.stringify(c)),
  ].join("\n");

// =============================================================================
// 1. 순서 — guards → create → runAfter → revalidate
// =============================================================================
describe("1. 순서 — runGuards → createReservation → runAfter(revalidate('recent'))", () => {
  test("guards 실패(zod) → createReservation 0 · createServiceClient 0 · runAfter 0 · revalidate 0 · Turnstile fetch 0 · limit 0", async () => {
    const deps = fakeDeps();
    vi.mocked(defaultGuardDeps).mockReturnValue(deps);

    const result = await submitReservation(form({ privacyConsent: null }));

    expect(result).toMatchObject({ ok: false, code: "validation" });
    expect(createReservation).toHaveBeenCalledTimes(0);
    expect(createServiceClient).toHaveBeenCalledTimes(0);
    expect(runAfter).toHaveBeenCalledTimes(0);
    expect(revalidate).toHaveBeenCalledTimes(0);
    expect(deps.fetchMock).toHaveBeenCalledTimes(0);
    expect(limitCalls(deps.limiters)).toBe(0);
  });

  test("guards silent(허니팟) → { ok:true, publicCode:null } · create 0 · DB 클라이언트 0 · revalidate 0 · 로그 0", async () => {
    const result = await submitReservation(form({ website: "https://spam.example" }));

    expect(result).toEqual({ ok: true, publicCode: null });
    expect(createReservation).toHaveBeenCalledTimes(0);
    expect(createServiceClient).toHaveBeenCalledTimes(0);
    expect(runAfter).toHaveBeenCalledTimes(0);
    expect(revalidate).toHaveBeenCalledTimes(0);
    expect(structuredLog).toHaveBeenCalledTimes(0);
    expect(consoleError).toHaveBeenCalledTimes(0);
    expect(consoleWarn).toHaveBeenCalledTimes(0);
  });

  test("guards ok → create 1 → runAfter 1 → revalidate('recent') 1, 그 순서대로 · 결과 { ok, publicCode, notifyQueued }", async () => {
    const result = await submitReservation(form());

    expect(result).toEqual({ ok: true, publicCode: PUBLIC_CODE, notifyQueued: true });
    expect(createReservation).toHaveBeenCalledTimes(1);
    expect(runAfter).toHaveBeenCalledTimes(1);
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate).toHaveBeenCalledWith(QUERY_TAGS.recent);
    expect(QUERY_TAGS.recent).toBe("recent");

    const order = [createReservation, runAfter, revalidate].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  test("createReservation 에 zod 가 파싱한 input(기본값 적용)과 deps(db·now·randomBytes·owner·log)가 그대로 간다", async () => {
    process.env.OWNER_PHONE = "01000000000";
    process.env.OWNER_EMAIL = "owner@example.com";
    const fd = form();
    await submitReservation(fd);

    const { raw } = formDataToRaw(fd);
    const [input, deps] = vi.mocked(createReservation).mock.calls[0];
    expect(input).toEqual(ReservationInput.parse(raw));
    expect(input.busCount).toBe(2);
    expect(input.waypointCodes).toEqual(["BSN"]);
    expect(input.marketingConsent).toBe(false);

    expect(createServiceClient).toHaveBeenCalledTimes(1);
    expect(supabaseReservationDb).toHaveBeenCalledWith({ kind: "fake-service-client" });
    expect(deps.db).toEqual({ kind: "fake-db", client: { kind: "fake-service-client" } });
    expect(deps.now()).toBeInstanceOf(Date);
    expect(deps.randomBytes(8)).toHaveLength(8);
    expect(deps.ownerPhone).toBe("01000000000");
    expect(deps.ownerEmail).toBe("owner@example.com");
    expect(deps.log).toBe(structuredLog);
  });

  test("OWNER_PHONE·OWNER_EMAIL 이 비어 있으면 undefined 로 간다(빈 문자열을 번호로 넘기지 않는다)", async () => {
    process.env.OWNER_PHONE = "";
    await submitReservation(form());
    const [, deps] = vi.mocked(createReservation).mock.calls[0];
    expect(deps.ownerPhone).toBeUndefined();
    expect(deps.ownerEmail).toBeUndefined();
  });

  test("notifyQueued:false 도 접수 성공이다 — 결과에 그대로 실리고 revalidate 는 돈다", async () => {
    vi.mocked(createReservation).mockResolvedValue({ ...createdOk(), notifyQueued: false, warnings: ["notification enqueue failed: boom"] });
    const result = await submitReservation(form());
    expect(result).toEqual({ ok: true, publicCode: PUBLIC_CODE, notifyQueued: false });
    expect(revalidate).toHaveBeenCalledWith(QUERY_TAGS.recent);
    // warnings 는 클라이언트가 아니라 로그로
    expect(structuredLog).toHaveBeenCalledTimes(1);
    expect(structuredLog).toHaveBeenCalledWith(expect.objectContaining({ level: "warn", publicCode: PUBLIC_CODE, warnings: ["notification enqueue failed: boom"] }));
  });

  test("성공 결과에 reservationId(uuid)·warnings 는 실리지 않는다", async () => {
    vi.mocked(createReservation).mockResolvedValue({ ...createdOk(), warnings: ["owner notification skipped"] });
    const result = await submitReservation(form());
    const json = JSON.stringify(result);
    expect(json).not.toContain(RESERVATION_ID);
    expect(json).not.toContain("warnings");
    expect(json).not.toContain("reservationId");
  });
});

// =============================================================================
// 2. 매핑 — reason → code · messageKey · fieldErrors · detail 없음
// =============================================================================
describe("2. 매핑 — GuardFailure.reason → SubmitResult", () => {
  test("validation — privacyConsent 누락 → code validation · fieldErrors.privacyConsent · detail 없음", async () => {
    const result = await submitReservation(form({ privacyConsent: null }));
    expect(result).toMatchObject({ ok: false, code: "validation", messageKey: "reservation.errors.validation" });
    if (result.ok) throw new Error("unreachable");
    expect(result.fieldErrors).toHaveProperty("privacyConsent", "reservation.errors.validation");
    expect(JSON.stringify(result)).not.toMatch(/"detail"/);
  });

  test("validation — phone·phoneIntl 둘 다 없음 → fieldErrors.phone (M6 XOR)", async () => {
    const result = await submitReservation(form({ phone: null }));
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("validation");
    expect(Object.keys(result.fieldErrors ?? {})).toContain("phone");
  });

  test("validation — round 인데 returnAtLocal 없음 → code validation · fieldErrors.returnAtLocal · create 0 · structuredLog 0 (P3-3-FIX M1: server 가 아니다)", async () => {
    const deps = fakeDeps();
    vi.mocked(defaultGuardDeps).mockReturnValue(deps);
    const result = await submitReservation(form({ returnAtLocal: null }));
    expect(result).toMatchObject({ ok: false, code: "validation", messageKey: "reservation.errors.validation" });
    if (result.ok) throw new Error("unreachable");
    expect(result.fieldErrors).toEqual({ returnAtLocal: "reservation.errors.validation" });
    expect(createReservation).toHaveBeenCalledTimes(0);
    expect(structuredLog).toHaveBeenCalledTimes(0);
    expect(deps.fetchMock).toHaveBeenCalledTimes(0);
  });

  test("validation — round 인데 귀가 ≤ 출발 → fieldErrors.returnAtLocal · create 0 · structuredLog 0 (P3-3-FIX M1)", async () => {
    const same = await submitReservation(form({ returnAtLocal: "2026-10-01T08:00" }));
    const before = await submitReservation(form({ returnAtLocal: "2026-09-30T18:00" }));
    for (const result of [same, before]) {
      expect(result).toMatchObject({ ok: false, code: "validation" });
      if (result.ok) throw new Error("unreachable");
      expect(result.fieldErrors).toEqual({ returnAtLocal: "reservation.errors.validation" });
    }
    expect(createReservation).toHaveBeenCalledTimes(0);
    expect(structuredLog).toHaveBeenCalledTimes(0);
  });

  test("validation — 달력에 없는 출발 일시(2026-02-30T08:00, 형식은 맞음) → fieldErrors.departAtLocal 만 · create 0 · structuredLog 0 (P3-3-FIX 규칙 0: server 가 아니다)", async () => {
    const deps = fakeDeps();
    vi.mocked(defaultGuardDeps).mockReturnValue(deps);
    const result = await submitReservation(form({ departAtLocal: "2026-02-30T08:00" }));
    expect(result).toMatchObject({ ok: false, code: "validation", messageKey: "reservation.errors.validation" });
    if (result.ok) throw new Error("unreachable");
    expect(result.fieldErrors).toEqual({ departAtLocal: "reservation.errors.validation" });
    expect(createReservation).toHaveBeenCalledTimes(0);
    expect(structuredLog).toHaveBeenCalledTimes(0);
    expect(deps.fetchMock).toHaveBeenCalledTimes(0);
  });

  test("bot — formToken 없음 → code bot · messageKey bot · fieldErrors 없음 · detail 없음", async () => {
    const result = await submitReservation(form({ formToken: null }));
    expect(result).toEqual({ ok: false, code: "bot", messageKey: "reservation.errors.bot" });
  });

  test("turnstile — siteverify success:false → code turnstile", async () => {
    vi.mocked(defaultGuardDeps).mockReturnValue(fakeDeps({ fetch: async () => jsonResponse({ success: false, "error-codes": ["invalid-input-response"] }) }));
    const result = await submitReservation(form());
    expect(result).toEqual({ ok: false, code: "turnstile", messageKey: "reservation.errors.turnstile" });
    expect(createReservation).toHaveBeenCalledTimes(0);
  });

  test("turnstile — 토큰이 폼에 없으면 zod 가 아니라 turnstile 단계가 거부한다(사용자 문구가 '새로고침' 이어야 한다)", async () => {
    const deps = fakeDeps();
    vi.mocked(defaultGuardDeps).mockReturnValue(deps);
    const result = await submitReservation(form({ "cf-turnstile-response": null }));
    expect(result).toEqual({ ok: false, code: "turnstile", messageKey: "reservation.errors.turnstile" });
    expect(deps.fetchMock).toHaveBeenCalledTimes(0);
  });

  test("ratelimit — limiter success:false → code ratelimit", async () => {
    vi.mocked(defaultGuardDeps).mockReturnValue(fakeDeps({ limiters: limiterSet(false) }));
    const result = await submitReservation(form());
    expect(result).toEqual({ ok: false, code: "ratelimit", messageKey: "reservation.errors.ratelimit" });
    expect(createReservation).toHaveBeenCalledTimes(0);
  });

  test("infra — siteverify 네트워크 throw → code infra (fail-closed)", async () => {
    vi.mocked(defaultGuardDeps).mockReturnValue(
      fakeDeps({
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    );
    const result = await submitReservation(form());
    expect(result).toEqual({ ok: false, code: "infra", messageKey: "reservation.errors.infra" });
  });

  test("infra — defaultGuardDeps 가 throw(env 누락) → code infra + structuredLog 1회, throw 가 밖으로 나가지 않는다", async () => {
    vi.mocked(defaultGuardDeps).mockImplementation(() => {
      throw new Error("defaultGuardDeps: GUARD_SECRET 이 없거나 32자 미만이다");
    });
    const result = await submitReservation(form());
    expect(result).toEqual({ ok: false, code: "infra", messageKey: "reservation.errors.infra" });
    expect(structuredLog).toHaveBeenCalledTimes(1);
    expect(structuredLog).toHaveBeenCalledWith(expect.objectContaining({ level: "error", event: "reservation.guard_setup_failed" }));
    expect(createReservation).toHaveBeenCalledTimes(0);
  });

  test("액션 실패 결과 5종 전부 — JSON 에 detail 키 0", async () => {
    const cases: Array<() => Promise<SubmitResult>> = [
      () => submitReservation(form({ privacyConsent: null })),
      () => submitReservation(form({ formToken: null })),
      async () => {
        vi.mocked(defaultGuardDeps).mockReturnValue(fakeDeps({ fetch: async () => jsonResponse({ success: false }) }));
        return submitReservation(form());
      },
      async () => {
        vi.mocked(defaultGuardDeps).mockReturnValue(fakeDeps({ limiters: limiterSet(false) }));
        return submitReservation(form());
      },
      async () => {
        vi.mocked(defaultGuardDeps).mockReturnValue(fakeDeps({ fetch: async () => jsonResponse({ oops: true }, 503) }));
        return submitReservation(form());
      },
    ];
    const codes: string[] = [];
    for (const run of cases) {
      const r = await run();
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      codes.push(r.code);
      expect("detail" in r).toBe(false);
      expect(JSON.stringify(r)).not.toMatch(/"detail"/);
    }
    expect(codes).toEqual(["validation", "bot", "turnstile", "ratelimit", "infra"]);
  });

  describe("guardFailureToResult (순수)", () => {
    const withDetail = (reason: GuardFailure["reason"], detail: unknown = { code: "x", secretish: "should-not-leak" }): GuardFailure => ({ ok: false, reason, detail });

    test.each([
      ["validation", "reservation.errors.validation"],
      ["bot", "reservation.errors.bot"],
      ["turnstile", "reservation.errors.turnstile"],
      ["ratelimit", "reservation.errors.ratelimit"],
      ["infra", "reservation.errors.infra"],
    ] as const)("%s → code 동일 · messageKey %s · detail 미포함", (reason, key) => {
      const r = guardFailureToResult(withDetail(reason));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe(reason);
      expect(r.messageKey).toBe(key);
      expect(RESERVATION_ERROR_KEYS[reason]).toBe(key);
      expect(JSON.stringify(r)).not.toContain("should-not-leak");
      expect("detail" in r).toBe(false);
      if (reason !== "validation") expect("fieldErrors" in r).toBe(false);
    });

    test("validation — zod issues 의 path 첫 세그먼트가 fieldErrors 키가 된다 (waypointCodes.2 → waypointCodes, 루트 이슈는 제외)", () => {
      const r = guardFailureToResult(
        withDetail("validation", [
          { path: "phone", code: "custom", message: "xor" },
          { path: "privacyConsent", code: "invalid_value", message: "literal" },
          { path: "waypointCodes.2", code: "invalid_value", message: "enum" },
          { path: "", code: "custom", message: "root" },
        ]),
      );
      if (r.ok) throw new Error("unreachable");
      expect(r.fieldErrors).toEqual({
        phone: "reservation.errors.validation",
        privacyConsent: "reservation.errors.validation",
        waypointCodes: "reservation.errors.validation",
      });
      // zod 의 message(내부 문구)는 클라이언트로 내려가지 않는다
      expect(JSON.stringify(r)).not.toContain("literal");
    });

    test("validation — detail 이 이상한 모양이면 fieldErrors 는 빈 객체 (throw 하지 않는다)", () => {
      for (const detail of [undefined, null, "str", 42, { code: "x" }, [{ nope: 1 }]]) {
        const r = guardFailureToResult(withDetail("validation", detail));
        if (r.ok) throw new Error("unreachable");
        expect(r.fieldErrors).toEqual({});
      }
    });

    test("RESERVATION_ERROR_KEYS — 6 코드 전부 reservation.errors.* 이고 server 는 별도 키", () => {
      expect(Object.keys(RESERVATION_ERROR_KEYS).sort()).toEqual(["bot", "infra", "ratelimit", "server", "turnstile", "validation"]);
      for (const [code, key] of Object.entries(RESERVATION_ERROR_KEYS)) expect(key).toBe(`reservation.errors.${code}`);
    });
  });

  test("createdToResult / createdToLogs (순수) — 결과에는 publicCode·notifyQueued 만, warnings 는 warn 로그 1건(없으면 0건)", () => {
    const created = { ...createdOk(), warnings: ["a", "b"] };
    expect(createdToResult(created)).toEqual({ ok: true, publicCode: PUBLIC_CODE, notifyQueued: true });
    const logs = createdToLogs(created);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: "warn", event: "reservation.create_warning", publicCode: PUBLIC_CODE, reservationId: RESERVATION_ID, warnings: ["a", "b"] });
    expect(createdToLogs(createdOk())).toEqual([]);
  });
});

// =============================================================================
// 3. createReservation throw → server
// =============================================================================
describe("3. createReservation throw", () => {
  test("→ { ok:false, code:'server' } + structuredLog 1회(스택 포함) · runAfter 0 · revalidate 0 · reject 아님", async () => {
    vi.mocked(createReservation).mockRejectedValue(new Error("reservations insert 실패: [23514] check violation"));
    await expect(submitReservation(form())).resolves.toEqual({ ok: false, code: "server", messageKey: "reservation.errors.server" });

    expect(structuredLog).toHaveBeenCalledTimes(1);
    const [entry] = vi.mocked(structuredLog).mock.calls[0];
    expect(entry).toMatchObject({ level: "error", event: "reservation.create_failed", name: "Error", message: "reservations insert 실패: [23514] check violation" });
    expect(typeof (entry as { stack?: unknown }).stack).toBe("string");
    expect(runAfter).toHaveBeenCalledTimes(0);
    expect(revalidate).toHaveBeenCalledTimes(0);
  });

  test("Error 가 아닌 값을 throw 해도 같은 결과 (name 은 typeof)", async () => {
    vi.mocked(createReservation).mockRejectedValue("string-rejection");
    const result = await submitReservation(form());
    expect(result).toEqual({ ok: false, code: "server", messageKey: "reservation.errors.server" });
    expect(structuredLog).toHaveBeenCalledWith(expect.objectContaining({ event: "reservation.create_failed", name: "string", message: "string-rejection" }));
  });

  test("thrownToLog (순수) — name·message·stack 만 싣고 cause 나 임의 필드는 싣지 않는다", () => {
    const err = Object.assign(new Error("boom"), { cause: { phone: "010-0000-0000" }, extra: "nope" });
    const entry = thrownToLog("reservation.create_failed", err);
    expect(Object.keys(entry).sort()).toEqual(["event", "level", "message", "name", "stack"]);
    expect(JSON.stringify(entry)).not.toContain("010-0000-0000");
  });
});

// =============================================================================
// 4. IP 비노출
// =============================================================================
describe("4. IP 비노출 — x-forwarded-for 값이 결과·로그 어디에도 없다", () => {
  test.each([
    ["성공", async () => submitReservation(form())],
    ["create throw", async () => {
      vi.mocked(createReservation).mockRejectedValue(new Error("db down"));
      return submitReservation(form());
    }],
    ["turnstile 거부", async () => {
      vi.mocked(defaultGuardDeps).mockReturnValue(fakeDeps({ fetch: async () => jsonResponse({ success: false }) }));
      return submitReservation(form());
    }],
    ["infra(fetch throw)", async () => {
      vi.mocked(defaultGuardDeps).mockReturnValue(
        fakeDeps({
          fetch: async () => {
            throw new Error(`connect ECONNREFUSED`);
          },
        }),
      );
      return submitReservation(form());
    }],
    ["deps throw", async () => {
      vi.mocked(defaultGuardDeps).mockImplementation(() => {
        throw new Error("env missing");
      });
      return submitReservation(form());
    }],
    ["validation", async () => submitReservation(form({ name: "" }))],
    ["허니팟", async () => submitReservation(form({ website: "x" }))],
  ])("%s 경로", async (_label, run) => {
    const result = await run();
    expect(JSON.stringify(result)).not.toContain(IP);
    expect(everythingLogged()).not.toContain(IP);
  });

  test("대조군 — 같은 IP 가 Turnstile siteverify 의 remoteip 로는 전달된다 (ctx 를 통해 흘렀다는 증거)", async () => {
    const deps = fakeDeps();
    vi.mocked(defaultGuardDeps).mockReturnValue(deps);
    await submitReservation(form());
    expect(deps.fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = deps.fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ remoteip: IP, response: "unit-test-turnstile-token" });
  });

  test("guardHeaders — 허용 헤더 3종만 통과시키고 나머지는 null (쿠키·인증 헤더가 guard 로 새지 않는다)", () => {
    const src = new Headers({ "x-forwarded-for": IP, "x-real-ip": "10.0.0.1", host: "bestour.co.kr", cookie: "sb=secret", authorization: "Bearer x" });
    const h = guardHeaders(src);
    expect(GUARD_HEADER_NAMES).toEqual(["x-forwarded-for", "x-real-ip", "host"]);
    expect(h.get("x-forwarded-for")).toBe(IP);
    expect(h.get("X-Real-IP")).toBe("10.0.0.1");
    expect(h.get("host")).toBe("bestour.co.kr");
    expect(h.get("cookie")).toBeNull();
    expect(h.get("authorization")).toBeNull();
    // 게으르다 — 원본에서 값을 미리 복사하지 않는다(키 목록만 갖는다)
    expect(Object.keys(h)).toEqual(["get"]);
  });

  test("guardContext — formToken·turnstileToken·honeypot[website] 배선", () => {
    const ctx = guardContext(new Headers({}), { website: "", formToken: "t.0", turnstileToken: "cf" });
    expect(ctx.formToken).toBe("t.0");
    expect(ctx.turnstileToken).toBe("cf");
    expect(ctx.honeypot).toEqual({ [HONEYPOT_FIELD]: "" });
    expect(ctx.headers.get("x-forwarded-for")).toBeNull();
  });
});

// =============================================================================
// 5. formDataToRaw
// =============================================================================
describe("5. formDataToRaw — 모양만 바꾼다(zod 는 guard 가 돌린다)", () => {
  test("계약 표 전 필드 변환 + guardFields 분리", () => {
    const fd = form({
      email: "a@b.co",
      paymentMethod: "transfer",
      vatIncluded: "true",
      message: " 안녕하세요 ",
      marketingConsent: "1",
      waypointCodes: ["BSN", "DGU", "TYG"],
      website: "",
    });
    const token = fd.get("formToken");
    const { raw, guardFields } = formDataToRaw(fd);

    expect(raw).toEqual({
      name: "홍길동",
      phone: "010-1234-5678",
      phoneIntl: undefined,
      email: "a@b.co",
      vehicleSlug: "bus45",
      purposeCode: PURPOSES[0],
      originCode: "SEL",
      destinationCode: "ICN",
      waypointCodes: ["BSN", "DGU", "TYG"],
      tripType: "round",
      departAtLocal: "2026-10-01T08:00",
      returnAtLocal: "2026-10-01T18:00",
      busCount: 2,
      passengers: 40,
      contactMethod: "sms",
      paymentMethod: "transfer",
      parkingIncluded: true,
      vatIncluded: true,
      message: "안녕하세요",
      locale: "ko",
      privacyConsent: true,
      marketingConsent: true,
      turnstileToken: "unit-test-turnstile-token",
    });
    expect(guardFields).toEqual({ website: "", formToken: token, turnstileToken: "unit-test-turnstile-token" });
    expect(HONEYPOT_FIELD in raw).toBe(false);
    expect("formToken" in raw).toBe(false);
    expect("cf-turnstile-response" in raw).toBe(false);
  });

  test("checkbox — 'on'·'true'·'1' → true, 그 밖의 값 → false, 없음·빈 문자열 → undefined", () => {
    for (const v of ["on", "true", "1"]) expect(formDataToRaw(form({ vatIncluded: v })).raw.vatIncluded).toBe(true);
    for (const v of ["off", "false", "0", "yes"]) expect(formDataToRaw(form({ vatIncluded: v })).raw.vatIncluded).toBe(false);
    expect(formDataToRaw(form({ vatIncluded: null })).raw.vatIncluded).toBeUndefined();
    expect(formDataToRaw(form({ vatIncluded: "" })).raw.vatIncluded).toBeUndefined();
    // privacyConsent 도 같은 규칙 — 없으면 undefined 라 zod literal(true) 가 잡는다
    expect(formDataToRaw(form({ privacyConsent: null })).raw.privacyConsent).toBeUndefined();
    expect(ReservationInput.safeParse(formDataToRaw(form({ privacyConsent: null })).raw).success).toBe(false);
  });

  test("빈 문자열·공백만 → undefined (optional 필드를 zod 가 optional 로 본다)", () => {
    const { raw } = formDataToRaw(form({ email: "", returnAtLocal: "   ", passengers: "", message: "", phoneIntl: "" }));
    expect(raw.email).toBeUndefined();
    expect(raw.returnAtLocal).toBeUndefined();
    expect(raw.passengers).toBeUndefined();
    expect(raw.message).toBeUndefined();
    expect(raw.phoneIntl).toBeUndefined();
  });

  test("숫자 — busCount·passengers 는 number. 숫자가 아니면 NaN 으로 남겨 zod 가 거부하게 한다(조용한 보정 없음)", () => {
    expect(formDataToRaw(form({ busCount: "3", passengers: "120" })).raw).toMatchObject({ busCount: 3, passengers: 120 });
    const bad = formDataToRaw(form({ busCount: "three" })).raw;
    expect(Number.isNaN(bad.busCount)).toBe(true);
    const parsed = ReservationInput.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  test("waypointCodes — getAll: 3개 → 배열 3, 빈 항목 제거, 없음 → []", () => {
    expect(formDataToRaw(form({ waypointCodes: ["BSN", "DGU", "TYG"] })).raw.waypointCodes).toEqual(["BSN", "DGU", "TYG"]);
    expect(formDataToRaw(form({ waypointCodes: ["BSN", "", "DGU"] })).raw.waypointCodes).toEqual(["BSN", "DGU"]);
    expect(formDataToRaw(form({ waypointCodes: null })).raw.waypointCodes).toEqual([]);
  });

  test("website(허니팟) — raw 에 없고 guardFields 에 있다. 채워진 값도 그대로 guardFields 로(trim 하지 않는다)", () => {
    const { raw, guardFields } = formDataToRaw(form({ website: "http://spam" }));
    expect(HONEYPOT_FIELD in raw).toBe(false);
    expect(guardFields.website).toBe("http://spam");
    expect(formDataToRaw(form({ website: null })).guardFields.website).toBeUndefined();
  });

  test("cf-turnstile-response — guardFields.turnstileToken 과 raw.turnstileToken 양쪽(P3-1 §7.8). 없으면 raw 는 '' 이고 guardFields 는 undefined", () => {
    const withToken = formDataToRaw(form());
    expect(withToken.guardFields.turnstileToken).toBe("unit-test-turnstile-token");
    expect(withToken.raw.turnstileToken).toBe("unit-test-turnstile-token");
    const without = formDataToRaw(form({ "cf-turnstile-response": null }));
    expect(without.guardFields.turnstileToken).toBeUndefined();
    expect(without.raw.turnstileToken).toBe("");
    // '' 은 zod z.string() 을 통과한다 → 거부는 turnstile 단계(missing-token)에서 난다
    expect(ReservationInput.safeParse(without.raw).success).toBe(true);
  });

  test("계약 밖 키는 무시된다 (status·adminMemo 같은 것을 폼으로 밀어 넣지 못한다) · File 값은 undefined", () => {
    const fd = form();
    fd.append("status", "confirmed");
    fd.append("adminMemo", "hack");
    fd.append("name", new Blob(["x"]), "x.txt");
    const { raw } = formDataToRaw(fd);
    expect("status" in raw).toBe(false);
    expect("adminMemo" in raw).toBe(false);
    // name 은 첫 값(문자열)을 쓴다 — FormData.get 은 첫 항목
    expect(raw.name).toBe("홍길동");
    const onlyFile = new FormData();
    onlyFile.append("name", new Blob(["x"]), "x.txt");
    expect(formDataToRaw(onlyFile).raw.name).toBeUndefined();
  });

  test("FormData 가 아닌 입력(null·undefined·{}·useActionState prevState·문자열·숫자) → 빈 폼과 동일: 필드 전부 undefined, waypointCodes [], turnstileToken '', guardFields 전부 undefined, throw 없음 (P3-3-FIX M3)", () => {
    const empty = formDataToRaw(new FormData());
    expect(empty.raw.waypointCodes).toEqual([]);
    expect(empty.raw.turnstileToken).toBe("");
    expect(empty.guardFields).toEqual({ website: undefined, formToken: undefined, turnstileToken: undefined });
    const rest = Object.entries(empty.raw).filter(([k]) => k !== "waypointCodes" && k !== "turnstileToken");
    expect(rest).toHaveLength(Object.keys(RESERVATION_FORM_FIELDS).length - 1);
    for (const [k, v] of rest) expect(v, k).toBeUndefined();

    const prevState: SubmitResult = { ok: false, code: "validation", messageKey: "reservation.errors.validation" };
    for (const notForm of [null, undefined, {}, prevState, "crafted", 42, [] as unknown[]]) {
      const out = formDataToRaw(notForm as never);
      expect(out, String(notForm)).toEqual(empty);
      expect(Object.keys(out.raw).sort()).toEqual(Object.keys(empty.raw).sort());
      // 빈 폼은 zod 를 통과하지 못한다 → 액션은 validation 을 돌려준다(500 이 아니라)
      expect(ReservationInput.safeParse(out.raw).success).toBe(false);
    }
  });

  test("계약 상수 — lib 의 RESERVATION_FORM_FIELDS·GUARD_FORM_FIELDS·종류 목록이 이 파일의 표와 같다 (P3-4 는 lib 을 import 한다)", () => {
    expect(RESERVATION_FORM_FIELDS).toEqual(FORM_FIELD_CONTRACT);
    expect(GUARD_FORM_FIELDS).toEqual(GUARD_FIELD_CONTRACT);
    expect([...NUMBER_FORM_FIELDS]).toEqual([...NUMBER_CONTRACT]);
    expect([...BOOLEAN_FORM_FIELDS]).toEqual([...BOOLEAN_CONTRACT]);
    expect([...MULTI_FORM_FIELDS]).toEqual([...MULTI_CONTRACT]);
  });

  test("계약 상수 — zod 스키마 키와 1:1 (website·turnstileToken 만 guard 쪽)", () => {
    const zodKeys = Object.keys(ReservationInput.shape).sort();
    const contractKeys = [...Object.values(RESERVATION_FORM_FIELDS), "turnstileToken", HONEYPOT_FIELD].sort();
    expect(contractKeys).toEqual(zodKeys);
  });
});

// =============================================================================
// 6. messages/ko.json reservation.errors
// =============================================================================
describe("6. messages/ko.json — reservation.errors", () => {
  const ko = JSON.parse(read("messages", "ko.json")) as Record<string, unknown>;
  const errors = (ko.reservation as { errors?: Record<string, string> } | undefined)?.errors;

  test("6키가 있고 전부 비어 있지 않은 문자열", () => {
    expect(errors).toBeDefined();
    expect(Object.keys(errors ?? {}).sort()).toEqual(["bot", "infra", "ratelimit", "server", "turnstile", "validation"]);
    for (const [k, v] of Object.entries(errors ?? {})) {
      expect(typeof v, k).toBe("string");
      expect(v.trim().length, k).toBeGreaterThan(0);
    }
  });

  // P6-6: 예전에는 이 두 문구에 대표전화가 **리터럴**로 박혀 있었고, 이 테스트가 그 리터럴이 원장과 같은지를 봤다.
  // 그래도 번호가 바뀌면 카탈로그를 손으로 고쳐야 했다(감사 R-6 — 이 네임스페이스는 어떤 카피 게이트도 보지 않았다).
  // 이제 카탈로그는 `{tel}` 보간만 두고 값은 렌더 시점에 원장에서 온다(QuoteWizard 가 tel prop 을 넘긴다).
  // 리터럴 0건은 tests/copy-rules.test.ts §4 가 messages/** 전체에 대해 단언한다.
  test("ratelimit·infra 문구는 리터럴이 아니라 원장 보간 {tel} 을 쓴다", () => {
    expect(errors?.ratelimit).toContain("{tel}");
    expect(errors?.infra).toContain("{tel}");
    expect(errors?.ratelimit).not.toContain(COMPANY.tel);
    expect(errors?.infra).not.toContain(COMPANY.tel);
  });

  test("server 는 infra 와 같은 문구, bot 은 validation 과 다른 문구(봇에게 이유를 알리지 않되 사람은 구분되게)", () => {
    expect(errors?.server).toBe(errors?.infra);
    expect(errors?.bot).not.toBe(errors?.validation);
    expect(errors?.bot).not.toContain("확인");
  });

  test("RESERVATION_ERROR_KEYS 의 모든 키가 ko.json 에서 풀린다", () => {
    for (const key of Object.values(RESERVATION_ERROR_KEYS)) {
      const value = key.split(".").reduce<unknown>((acc, seg) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[seg] : undefined), ko);
      expect(typeof value, key).toBe("string");
    }
  });

  test("기존 최상위 네임스페이스(common·layout·errors·home)는 그대로이고 reservation 이 뒤에 붙었다", () => {
    const keys = Object.keys(ko);
    expect(keys.slice(0, 4)).toEqual(["common", "layout", "errors", "home"]);
    expect(keys.indexOf("reservation")).toBeGreaterThan(keys.indexOf("home"));
  });
});

// =============================================================================
// 7. 정적 — ADR-3 · ADR-4 · process.env 경계
// =============================================================================
describe("7. 정적 규약", () => {
  const ACTION = "actions/reservation.ts";
  const action = read(ACTION);

  test("actions/reservation.ts — 첫 줄 'use server'", () => {
    expect(action.split(/\r?\n/)[0]).toMatch(/^["']use server["'];$/);
  });

  test("actions/reservation.ts — export 는 `export async function submitReservation` 하나뿐 (읽기 export 금지 — ADR-3)", () => {
    const exportLines = action.split(/\r?\n/).filter((l) => /^\s*export\b/.test(l));
    expect(exportLines).toHaveLength(1);
    expect(exportLines[0]).toMatch(/^export async function submitReservation\(/);
  });

  test("actions/reservation.ts — 얇다: console 0 · headers.get 0 · next/cache·next/server 직접 import 0 · 포트·guard·create 를 import", () => {
    expect(action).not.toMatch(/console\./);
    expect(action).not.toMatch(/\.get\(/);
    expect(action).not.toMatch(/from\s+["']next\/(cache|server)["']/);
    expect(action).toMatch(/from\s+["']next\/headers["']/);
    for (const sym of ["runGuards", "defaultGuardDeps", "createReservation", "supabaseReservationDb", "createServiceClient", "runAfter", "revalidate", "QUERY_TAGS", "structuredLog", "formDataToRaw", "guardContext"]) {
      expect(action, sym).toContain(sym);
    }
    // 가격·추정 없음은 check-no-pricing 이 잠근다. 여기서는 zod 를 직접 돌리지 않는지만 본다.
    expect(action).not.toMatch(/safeParse|ReservationInput\.parse/);
  });

  test("process.env — actions/** · lib/guard · lib/reservations · lib/ports · lib/log.ts 에서 actions/reservation.ts 와 lib/guard/deps.ts 뿐", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
      });
    const files = [
      ...walk(path.join(ROOT, "actions")),
      ...walk(path.join(ROOT, "lib", "guard")),
      ...walk(path.join(ROOT, "lib", "reservations")),
      ...walk(path.join(ROOT, "lib", "ports")),
      path.join(ROOT, "lib", "log.ts"),
    ].map((p) => path.relative(ROOT, p).split(path.sep).join("/"));
    const withEnv = files.filter((f) => /process\.env/.test(read(f))).sort();
    expect(withEnv).toEqual(["actions/reservation.ts", "lib/guard/deps.ts"]);

    const names = [...action.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]).sort();
    expect(names).toEqual(["OWNER_EMAIL", "OWNER_PHONE"]);
  });

  test.each(["lib/reservations/formData.ts", "lib/reservations/submitResult.ts"])("%s — 순수: 'use server' 0 · next import 0 · server-only 0 · supabase 0", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/["']use server["']/);
    expect(src).not.toMatch(/from\s+["']next(\/|["'])/);
    expect(src).not.toMatch(/["']server-only["']/);
    expect(src).not.toMatch(/supabase/);
  });

  test("lib/reservations/formData.ts — zod 를 돌리지 않는다(safeParse·parse 0). 계약 표가 상단 주석에 있다", () => {
    const src = read("lib/reservations/formData.ts");
    expect(src).not.toMatch(/safeParse|\.parse\(/);
    expect(src).toMatch(/cf-turnstile-response/);
    expect(src.slice(0, 4000)).toMatch(/formToken/);
  });

  test("lib/log.ts — structuredLog 하나, 'use server' 0", () => {
    const src = read("lib/log.ts");
    expect(src).toMatch(/export function structuredLog\(/);
    expect(src).not.toMatch(/["']use server["']/);
  });

  test("lib/queries/tags.ts — recent 태그가 있다 (P3-5 접수 현황 피드 무효화용)", () => {
    expect(read("lib/queries/tags.ts")).toMatch(/recent:\s*["']recent["']/);
  });

  test("actions/reservation.ts — `await headers()` 와 `formDataToRaw(` 가 첫 try 블록 안에 있다 (P3-3-FIX M3: 그 둘이 던져도 500 이 아니라 infra)", () => {
    const lines = action.split(/\r?\n/);
    const fnLine = lines.findIndex((l) => /^export async function submitReservation\(/.test(l));
    const firstTry = lines.findIndex((l, i) => i > fnLine && /^\s*try \{\s*$/.test(l));
    const firstCatch = lines.findIndex((l, i) => i > firstTry && /^\s*\} catch \(/.test(l));
    const headersLine = lines.findIndex((l) => /await headers\(\)/.test(l));
    const rawLine = lines.findIndex((l) => /formDataToRaw\(/.test(l) && !/^import/.test(l) && !/^\s*\*/.test(l));
    expect(fnLine).toBeGreaterThan(-1);
    expect(firstTry).toBeGreaterThan(fnLine);
    expect(firstCatch).toBeGreaterThan(firstTry);
    expect(headersLine).toBeGreaterThan(firstTry);
    expect(headersLine).toBeLessThan(firstCatch);
    expect(rawLine).toBeGreaterThan(firstTry);
    expect(rawLine).toBeLessThan(firstCatch);
    // 함수 시작 ~ 첫 try 사이에는 `let outcome` 선언 외의 문장이 없다(새 분기 금지 — try 범위 이동만)
    const between = lines.slice(fnLine + 1, firstTry).map((l) => l.trim()).filter((l) => l.length > 0);
    expect(between).toEqual(["let outcome: GuardOutcome;"]);
  });
});

// =============================================================================
// 8. 입력 모양 방어 (P3-3-FIX M3) — FormData 가 아닌 인자 · headers() 실패
// =============================================================================
describe("8. 입력 모양 방어 — 서버액션은 공개 POST 라 인자 모양을 클라이언트가 정한다", () => {
  const prevState: SubmitResult = { ok: false, code: "validation", messageKey: "reservation.errors.validation" };

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["빈 객체 {}", {}],
    ["useActionState prevState (P3-4 가 (prev, fd) 래퍼를 빠뜨린 경우)", prevState],
    ["문자열", "crafted"],
  ])("submitReservation(%s) → { ok:false, code:'validation' } · reject 아님 · create 0 · DB 클라이언트 0 · Turnstile fetch 0 · structuredLog 0", async (_label, arg) => {
    const deps = fakeDeps();
    vi.mocked(defaultGuardDeps).mockReturnValue(deps);

    const result = await submitReservation(arg as never);

    expect(result).toMatchObject({ ok: false, code: "validation", messageKey: "reservation.errors.validation" });
    if (result.ok) throw new Error("unreachable");
    expect(Object.keys(result.fieldErrors ?? {}).length).toBeGreaterThan(0);
    expect(createReservation).toHaveBeenCalledTimes(0);
    expect(createServiceClient).toHaveBeenCalledTimes(0);
    expect(deps.fetchMock).toHaveBeenCalledTimes(0);
    expect(structuredLog).toHaveBeenCalledTimes(0);
    expect(runAfter).toHaveBeenCalledTimes(0);
  });

  test("headers() 가 reject → { ok:false, code:'infra' } · structuredLog 1회(reservation.guard_setup_failed) · reject 아님 · create 0", async () => {
    vi.mocked(headers).mockRejectedValue(new Error("`headers` was called outside a request scope"));
    await expect(submitReservation(form())).resolves.toEqual({ ok: false, code: "infra", messageKey: "reservation.errors.infra" });
    expect(structuredLog).toHaveBeenCalledTimes(1);
    expect(structuredLog).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", event: "reservation.guard_setup_failed", name: "Error", message: "`headers` was called outside a request scope" }),
    );
    expect(createReservation).toHaveBeenCalledTimes(0);
    expect(createServiceClient).toHaveBeenCalledTimes(0);
  });

  test("headers() 가 동기 throw 해도 같다 (mockImplementation 으로 throw)", async () => {
    vi.mocked(headers).mockImplementation(() => {
      throw new Error("sync boom");
    });
    await expect(submitReservation(form())).resolves.toEqual({ ok: false, code: "infra", messageKey: "reservation.errors.infra" });
    expect(structuredLog).toHaveBeenCalledWith(expect.objectContaining({ event: "reservation.guard_setup_failed", message: "sync boom" }));
  });
});
