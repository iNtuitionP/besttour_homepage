/**
 * 예약확인 `/reservation/check` 계약 테스트 — T2-5(사장님 요청 1 · 결정 5 B안, 2026-10-10)로 대부분 다시 썼다.
 * 원래 계약: P6-3a · ADR-3 · ADR-4 · CLAUDE.md §3 서비스 롤 서버 전용.
 *
 * 조회 키가 "접수번호 + 휴대폰 뒷 4자리" 에서 **"휴대폰 번호 + 예약자 이름"** 으로 바뀌었다. 단언하는 것:
 *   1. zod — 휴대폰은 접수와 같은 정규화(contactPhone · '+820' 저장값 보정), 이름은 trim·1~30자. formData 계약
 *   2. 순서 — zod → 허니팟 → Turnstile(action "check") → rateLimit. 앞 단계 실패는 뒤 단계(네트워크·카운터)를 쓰지 않는다.
 *      접수용 "reserve" 토큰은 조회에 쓰이지 못한다(siteverify 응답의 action 대조). 전화번호 단위 한도는 없다(결정 5)
 *   3. 조회 — SQL 조건은 전화번호 하나, 이름 비교는 서버 코드(상수 시간 — timingSafeEqual 을 행마다 · 부재면 더미 1회),
 *      결과 범위는 운행일이 오늘(KST) 이후이고 취소가 아닌 건. 여러 건이면 목록(출발 순)
 *   4. select 화이트리스트 — public_code·email·message·admin_memo 를 읽지 않는다. `in(phone)` 외 조건 0
 *   5. 액션 — 없음·이름 불일치·지난/취소 건만·허니팟·형식 실패는 **같은 not_found 하나**(모양·로그·응답 시간 바닥까지)
 *   6. lib/guard/deps.ts — checkGuardDeps 에 Turnstile(action "check") · 접수는 그대로 "reserve" · 관리자 로그인은 그대로
 *   7. 카탈로그 — 접수번호·뒷자리 안내가 손님 화면에서 사라졌다(옛 문자 안내 한 줄만)
 *   8. 컴포넌트·페이지 정적 — 사이트 키·action 전달, 여러 건 카드, 클라이언트 사전 검증 = zod
 *   (손님 문자·알림톡 — 접수번호 줄이 없고 조회 안내는 "휴대폰 번호와 예약자 이름으로" — 은 tests/notify-templates.test.ts 의 T2-5 블록이 잠근다)
 *
 * `'use server'` 파일을 vitest 에서 부르기 위해 next/headers·lib/guard/deps·lib/supabase/server·lib/reservation-check/db·lib/log 을 vi.mock 한다.
 * **runCheckGuards·lookupReservation 은 진짜다** — limiter·siteverify fetch·DB 포트만 주입 mock 이라 순서·결과가 실제 코드에서 나온다. 원격 DB 접근 0.
 * tests/ 아래라 세 게이트의 검사 대상이다 — 금지어·임시값 마커 리터럴은 이스케이프로 조립한다.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { CF, CG } from "@/components/reservation-check/fields";
import { PREVIEW_RESULT_MODES, parsePreviewResult, previewCheckResult } from "@/components/reservation-check/preview-result";
import { validateCheckForm } from "@/components/reservation-check/validate";
import { locationLabelKo } from "@/lib/codes";
import { HONEYPOT_FIELD, RATE_LIMITS, TURNSTILE_ACTION, TURNSTILE_CHECK_ACTION, type RateLimiterSet } from "@/lib/guard";
import { COMPANY, VERBATIM } from "@/lib/legal/disclosures";
import { LEGACY_MENU } from "@/lib/legacy-menu-map";
import { CHECK_FORM_FIELDS, CHECK_GUARD_FORM_FIELDS, checkGuardContext, formDataToCheckRaw } from "@/lib/reservation-check/formData";
import { CheckInput, runCheckGuards, type CheckGuardDeps } from "@/lib/reservation-check/guards";
import {
  CHECK_MAX_ROWS,
  RESERVATION_CHECK_COLUMNS,
  RESERVATION_CHECK_SELECT,
  isUpcoming,
  lookupReservation,
  namesMatch,
  normalizeName,
  type ReservationCheckDb,
  type ReservationCheckRow,
} from "@/lib/reservation-check/lookup";
import { checkPhoneE164, storedPhoneCandidates } from "@/lib/reservation-check/phone";
import { CHECK_ERROR_KEYS, CHECK_FIELD_ERROR_KEYS, checkFailureResult, guardFailureToCheckResult, notFoundResult, type CheckResult } from "@/lib/reservation-check/result";
import { CHECK_RESPONSE_FLOOR_MS } from "@/lib/reservation-check/timing";
import { RESERVATION_STATUSES, RESERVATION_VIEW_KEYS, kstWallClock, toReservationView, type ReservationView } from "@/lib/reservation-check/view";
import { GUARD_FORM_FIELDS } from "@/lib/reservations/formData";

// server-only 는 vitest(node) 에서 import 즉시 throw 한다 — 빈 모듈로 바꿔치기(guard.test.ts·reservation-action.test.ts 선례).
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/guard/deps", () => ({ checkGuardDeps: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn(() => ({ kind: "fake-service-client" })) }));
vi.mock("@/lib/reservation-check/db", () => ({ supabaseReservationCheckDb: vi.fn() }));
vi.mock("@/lib/log", () => ({ structuredLog: vi.fn() }));
// 응답 시간 바닥(T2-5) — 액션 테스트가 실제로 기다리지 않게 바꿔치기한다. 함수 자체는 §5 끝에서 importActual 로 따로 본다.
vi.mock("@/lib/reservation-check/timing", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/reservation-check/timing")>();
  return { ...mod, holdResponseFloor: vi.fn(async () => {}) };
});
// 허니팟 단계가 "불렸는가" 를 세기 위해 원본을 spy 로 감싼다(동작은 그대로).
vi.mock("@/lib/guard/honeypot", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/guard/honeypot")>();
  return { ...mod, checkHoneypot: vi.fn(mod.checkHoneypot) };
});
// 이름 비교가 상수 시간 비교(timingSafeEqual)를 **행마다** 쓰는지 세기 위해 원본을 spy 로 감싼다(동작은 그대로).
vi.mock("node:crypto", async (importOriginal) => {
  const mod = await importOriginal<typeof import("node:crypto")>();
  return { ...mod, timingSafeEqual: vi.fn(mod.timingSafeEqual) };
});

import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { checkGuardDeps } from "@/lib/guard/deps";
import { checkHoneypot } from "@/lib/guard/honeypot";
import { structuredLog } from "@/lib/log";
import { supabaseReservationCheckDb } from "@/lib/reservation-check/db";
import { holdResponseFloor } from "@/lib/reservation-check/timing";
import { createServiceClient } from "@/lib/supabase/server";
import { checkReservation } from "@/actions/reservation-check";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");

const ACTION = "actions/reservation-check.ts";
const PAGE = "app/[locale]/(site)/reservation/check/page.tsx";
const COMPONENT_DIR = "components/reservation-check";
const FORM = `${COMPONENT_DIR}/CheckForm.tsx`;
const CARD = `${COMPONENT_DIR}/ReservationCard.tsx`;
const PREVIEW = `${COMPONENT_DIR}/preview-result.ts`;
const LIB_DIR = "lib/reservation-check";

/** 주석을 걷어낸 코드. 제거기는 저장소에 하나뿐이다(`tests/helpers/strip-comments.ts` · P6-7/P6-8 · D7). */
const codeOf = (rel: string) => stripComments(read(rel), rel);

function ledgerImports(src: string): string[] {
  const names: string[] = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/legal\/disclosures["']/g)) {
    for (const raw of m[1].split(",")) {
      const n = raw.trim().split(/\s+as\s+/)[0].trim();
      if (n) names.push(n);
    }
  }
  return names;
}

function walk(absDir: string): string[] {
  return readdirSync(absDir).flatMap((n) => {
    const p = path.join(absDir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
// 게이트(check-legal-disclosures)가 tests/ 도 grep 하므로 금지어를 이어 붙여 만든다.
const FORBIDDEN = ["면" + "허", "전세버스" + "하나", "나가는 " + "버스", "태우고 " + "나가", "공" + "차", "회" + "송"];
const PRICE_MARKS = [/priceFrom/, /₩/, /만\s*원/, /\bKRW\b/, /\d\s*원(?![가-힣])/, /Intl\.NumberFormat/, /toLocaleString\(/];
const UNPROVEN = ["연중무휴", "24시간", "누적", "대 보유", "운행 13년"];

// =============================================================================
// 픽스처
// =============================================================================
const SECRET = "unit-test-guard-secret-0123456789abcdef0123456789abcdef";
/** KST 2026-09-13 12:00 — "오늘(KST)" 은 9월 13일이다. */
const NOW = new Date("2026-09-13T03:00:00.000Z");
const IP = "10.9.8.7";
const TOKEN = "unit-test-turnstile-token-check";
const RAW_NAME = "홍길동";
const RAW_PHONE_E164 = "+821012345678";
/** 손님이 칸에 치는 모양(접수 모달과 같은 자동 하이픈). */
const INPUT_PHONE = "010-1234-5678";
const RAW_PHONE_FORMS = [RAW_PHONE_E164, "821012345678", "01012345678", "010-1234-5678", "1012345678"];
/** '+820' 저장값 보정까지 — SQL 의 `in(phone, …)` 에 들어가는 후보. */
const CANDIDATES = ["+821012345678", "+8201012345678"];

const ROW: ReservationCheckRow = {
  name: RAW_NAME,
  phone: RAW_PHONE_E164,
  status: "confirmed",
  intake: "wizard",
  trip_type: "round",
  depart_at: "2026-09-30T23:30:00.000Z", // KST 2026-10-01 08:30 — UTC 날짜와 다르다
  return_at: "2026-10-01T09:00:00.000Z", // KST 2026-10-01 18:00
  vehicle_slug: "bus45",
  origin_code: "SEL",
  destination_code: "BSN",
  bus_count: 2,
  passengers: 40,
  created_at: "2026-09-13T05:04:00.000Z", // KST 2026-09-13 14:04
};
const VEHICLE_NAME = "45인승 관광버스";
/** P7-4: 차량 이름은 ko·en 한 쌍으로 읽는다(영문 화면은 name_en). */
const VEHICLE_NAMES = { ko: VEHICLE_NAME, en: "45-seat Coach" };

type FakeDb = ReservationCheckDb & { find: ReturnType<typeof vi.fn>; veh: ReturnType<typeof vi.fn> };
/** SQL `where phone in (…)` 를 흉내 낸다 — 후보에 든 번호의 행만 돌려준다(이름·상태·날짜 조건은 SQL 에 없다). */
function fakeDb(rows: ReservationCheckRow[], vehicleNames: { ko: string; en: string } | null = VEHICLE_NAMES): FakeDb {
  const find = vi.fn(async (phones: readonly string[]) => rows.filter((r) => phones.includes(r.phone)));
  const veh = vi.fn(async () => vehicleNames);
  return { findByPhones: find, vehicleNames: veh, find, veh };
}

function limiterSet(success = true): RateLimiterSet {
  const mk = () => ({ limit: vi.fn(async () => ({ success })) });
  return { known: { short: mk(), long: mk() }, unknown: { short: mk(), long: mk() } };
}
const limitCalls = (set: RateLimiterSet) =>
  (["known", "unknown"] as const)
    .flatMap((b) => (["short", "long"] as const).map((w) => vi.mocked(set[b][w].limit).mock.calls.length))
    .reduce((a, b) => a + b, 0);

/** Cloudflare siteverify 응답 흉내. 기본은 조회 위젯(action "check")에서 나온 정상 토큰. */
function siteverify(body: Record<string, unknown> = {}) {
  return vi.fn<(input: string, init: RequestInit) => Promise<Response>>(async () =>
    new Response(JSON.stringify({ success: true, hostname: "localhost", action: TURNSTILE_CHECK_ACTION, "error-codes": [], ...body }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

type Deps = CheckGuardDeps & { limiters: RateLimiterSet; fetch: ReturnType<typeof siteverify> };
function fakeDeps(o: { limiters?: RateLimiterSet; fetch?: ReturnType<typeof siteverify> } = {}): Deps {
  const limiters = o.limiters ?? limiterSet();
  const fetch = o.fetch ?? siteverify();
  return {
    now: () => NOW,
    secret: SECRET,
    turnstile: { fetch, secret: "unit-test-turnstile-secret", allowedHosts: ["localhost"], action: TURNSTILE_CHECK_ACTION, timeoutMs: 1_000 },
    rateLimit: { limiters, timeoutMs: 1_000 },
    limiters,
    fetch,
  };
}

type FormValue = string | null;
function form(overrides: Record<string, FormValue> = {}): FormData {
  const base: Record<string, FormValue> = { phone: INPUT_PHONE, name: RAW_NAME, "cf-turnstile-response": TOKEN };
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v === null) continue;
    fd.append(k, v);
  }
  return fd;
}

const ctx = (o: { ip?: string | null; website?: string; token?: string | null } = {}) =>
  checkGuardContext(new Headers(o.ip === null ? {} : { "x-forwarded-for": o.ip ?? IP, host: "localhost" }), {
    website: o.website,
    turnstileToken: o.token === null ? undefined : (o.token ?? TOKEN),
  });

const VALID_RAW = { phone: INPUT_PHONE, name: RAW_NAME };

type RequestHeaders = Awaited<ReturnType<typeof headers>>;
const requestHeaders = (init: Record<string, string>) => new Headers(init) as unknown as RequestHeaders;

const digitRuns = (s: string, min = 4): string[] => s.match(new RegExp(`\\d{${min},}`, "g")) ?? [];

let db: FakeDb;
let deps: Deps;
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  db = fakeDb([ROW]);
  deps = fakeDeps();
  vi.mocked(headers).mockResolvedValue(requestHeaders({ "x-forwarded-for": IP, host: "localhost" }));
  vi.mocked(checkGuardDeps).mockImplementation(() => deps);
  vi.mocked(supabaseReservationCheckDb).mockImplementation(() => db);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
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
// 1. zod — CheckInput · 휴대폰 정규화 · formData
// =============================================================================
describe("1. zod CheckInput — 휴대폰은 접수와 같은 정규화, 이름은 trim·1~30자", () => {
  const parse = (phone: unknown, name: unknown = RAW_NAME) => CheckInput.safeParse({ phone, name });

  test("국내 휴대폰 — 하이픈 유무·양끝 공백과 무관하게 +82 E.164 로 정규화된다(contactPhone 과 같은 결과)", () => {
    for (const raw of ["010-1234-5678", "01012345678", " 010-1234-5678 ", "010-1234-5678\t"]) {
      const r = parse(raw);
      expect(r.success, JSON.stringify(raw)).toBe(true);
      if (r.success) expect(r.data).toEqual({ phone: RAW_PHONE_E164, name: RAW_NAME });
    }
    expect(checkPhoneE164("011-123-4567")).toBe("+82111234567");
  });

  test("해외 번호 — `+` 로 시작하면 숫자만 남겨 E.164 · '+82…' 는 국내 번호로 같은 값 · '+820…' 은 0 을 떼어 보정", () => {
    expect(checkPhoneE164("+15551234567")).toBe("+15551234567");
    expect(checkPhoneE164("+1 (555) 123-4567")).toBe("+15551234567");
    expect(checkPhoneE164("+82 10-1234-5678")).toBe(RAW_PHONE_E164);
    // 해외 칸에 국내 번호를 0 째로 적은 경우 — lib/reservations/phone.ts 가 그대로 저장해 온 모양이다(계획 위험 '+820')
    expect(checkPhoneE164("+82010-1234-5678")).toBe(RAW_PHONE_E164);
    expect(checkPhoneE164("+8201012345678")).toBe(RAW_PHONE_E164);
  });

  test("형식 밖 → 실패: 빈 칸·유선·짧은 번호·글자·국가번호 0·`+` 만", () => {
    for (const bad of ["", "   ", "02-123-4567", "010-12-34", "1234", "abcd", "010-1234-567a", "+0123456789", "+", "+12", "１０１２３４５６７８"]) {
      expect(parse(bad).success, JSON.stringify(bad)).toBe(false);
      expect(checkPhoneE164(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  test("이름 — trim · 빈 이름/공백만 실패 · 30자 통과 · 31자 실패 · 띄어쓰기는 그대로 받는다(비교에서 지운다)", () => {
    const r = parse(INPUT_PHONE, "  홍 길동 ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("홍 길동");
    for (const bad of ["", "   ", "가".repeat(31)]) expect(parse(INPUT_PHONE, bad).success, JSON.stringify(bad)).toBe(false);
    expect(parse(INPUT_PHONE, "가".repeat(30)).success).toBe(true);
  });

  test("누락·비문자열·이상한 모양 → 실패, throw 없음", () => {
    for (const raw of [{}, { phone: INPUT_PHONE }, { name: RAW_NAME }, { phone: 1012345678, name: RAW_NAME }, null, "x", []]) {
      expect(CheckInput.safeParse(raw).success, JSON.stringify(raw)).toBe(false);
    }
  });

  test("storedPhoneCandidates — 국내 번호는 정규형과 '+820' 옛 저장형 둘, 해외 번호는 하나", () => {
    expect(storedPhoneCandidates(RAW_PHONE_E164)).toEqual(CANDIDATES);
    expect(storedPhoneCandidates("+15551234567")).toEqual(["+15551234567"]);
  });

  test("formDataToCheckRaw — 계약 키 2개(phone·name)만 trim 해서 읽고, website·Turnstile 토큰은 raw 밖·guardFields 안(원문 그대로)", () => {
    expect(CHECK_FORM_FIELDS).toEqual({ phone: "phone", name: "name" });
    expect(CHECK_GUARD_FORM_FIELDS).toEqual({ website: HONEYPOT_FIELD, turnstile: "cf-turnstile-response" });
    // Turnstile 위젯이 넣는 표준 이름 — 접수 폼과 같은 상수를 쓴다(이름을 두 군데에 적지 않는다)
    expect(CHECK_GUARD_FORM_FIELDS.turnstile).toBe(GUARD_FORM_FIELDS.turnstile);
    const { raw, guardFields } = formDataToCheckRaw(form({ name: "  홍길동 ", website: " http://spam " }));
    expect(raw).toEqual({ phone: INPUT_PHONE, name: "홍길동" });
    expect(guardFields).toEqual({ website: " http://spam ", turnstileToken: TOKEN });
    expect(HONEYPOT_FIELD in raw).toBe(false);
    const fd = form();
    fd.append("status", "confirmed");
    fd.append("publicCode", "A2B3C4D5");
    fd.append("phoneLast4", "5678");
    expect(Object.keys(formDataToCheckRaw(fd).raw).sort()).toEqual(["name", "phone"]);
    expect(formDataToCheckRaw(form({ name: "" })).raw.name).toBeUndefined();
    const empty = formDataToCheckRaw(new FormData());
    expect(empty).toEqual({ raw: { phone: undefined, name: undefined }, guardFields: { website: undefined, turnstileToken: undefined } });
    for (const notForm of [null, undefined, {}, { ok: false }, "crafted", 42]) expect(formDataToCheckRaw(notForm as never)).toEqual(empty);
  });
});

// =============================================================================
// 2. 순서 — zod → 허니팟 → Turnstile("check") → rateLimit
// =============================================================================
describe("2. runCheckGuards — zod → 허니팟 → Turnstile(action \"check\") → rateLimit", () => {
  test("형식 실패 → 허니팟 0 · siteverify 0 · limit 0 · reason validation", async () => {
    const d = fakeDeps();
    const out = await runCheckGuards({ phone: "1234", name: RAW_NAME }, ctx({ website: "filled" }), d);
    expect(out).toMatchObject({ ok: false, reason: "validation" });
    expect(checkHoneypot).toHaveBeenCalledTimes(0);
    expect(d.fetch).toHaveBeenCalledTimes(0);
    expect(limitCalls(d.limiters)).toBe(0);
  });

  test("허니팟 채워짐 → { ok:true, silent:true } · siteverify 0 · limit 0 (봇은 네트워크도 슬롯도 쓰지 않는다)", async () => {
    const d = fakeDeps();
    const out = await runCheckGuards(VALID_RAW, ctx({ website: "http://spam" }), d);
    expect(out).toEqual({ ok: true, silent: true });
    expect(checkHoneypot).toHaveBeenCalledTimes(1);
    expect(d.fetch).toHaveBeenCalledTimes(0);
    expect(limitCalls(d.limiters)).toBe(0);
  });

  test("Turnstile 토큰 없음 → reason turnstile · siteverify 0(네트워크 없이 거부) · limit 0", async () => {
    const d = fakeDeps();
    const out = await runCheckGuards(VALID_RAW, ctx({ token: null }), d);
    expect(out).toMatchObject({ ok: false, reason: "turnstile" });
    expect(d.fetch).toHaveBeenCalledTimes(0);
    expect(limitCalls(d.limiters)).toBe(0);
  });

  test("🔴 접수 위젯(action \"reserve\") 토큰은 조회에 쓰이지 못한다 — siteverify 는 통과했어도 action 대조로 거부 · limit 0", async () => {
    expect(TURNSTILE_CHECK_ACTION).toBe("check");
    expect(TURNSTILE_ACTION).toBe("reserve");
    const d = fakeDeps({ fetch: siteverify({ action: TURNSTILE_ACTION }) });
    const out = await runCheckGuards(VALID_RAW, ctx(), d);
    expect(out).toMatchObject({ ok: false, reason: "turnstile", detail: { code: "action-mismatch" } });
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(limitCalls(d.limiters)).toBe(0);
    // action 이 없는 응답(Cloudflare 더미 키 모양)도 운영 deps 에서는 통과하지 못한다
    const noAction = fakeDeps({ fetch: siteverify({ action: undefined }) });
    expect(await runCheckGuards(VALID_RAW, ctx(), noAction)).toMatchObject({ ok: false, reason: "turnstile" });
  });

  test("siteverify 실패(success:false) → turnstile · 네트워크 오류 → infra (fail-closed)", async () => {
    expect(await runCheckGuards(VALID_RAW, ctx(), fakeDeps({ fetch: siteverify({ success: false, "error-codes": ["invalid-input-response"] }) }))).toMatchObject({
      ok: false,
      reason: "turnstile",
    });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const d = fakeDeps({ fetch: down as never });
    expect(await runCheckGuards(VALID_RAW, ctx(), d)).toMatchObject({ ok: false, reason: "infra" });
    expect(limitCalls(d.limiters)).toBe(0);
  });

  test("siteverify 에는 토큰과 시크릿을 보내고, 결과·detail 에는 IP·토큰을 싣지 않는다", async () => {
    const d = fakeDeps({ fetch: siteverify({ success: false }) });
    const out = await runCheckGuards(VALID_RAW, ctx(), d);
    const body = JSON.parse(String((d.fetch.mock.calls[0][1] as RequestInit).body)) as Record<string, string>;
    expect(body.response).toBe(TOKEN);
    expect(body.secret).toBe("unit-test-turnstile-secret");
    expect(JSON.stringify(out)).not.toContain(IP);
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  test("rateLimit 거부 → reason ratelimit · short 창 1회(known)", async () => {
    const d = fakeDeps({ limiters: limiterSet(false) });
    const out = await runCheckGuards(VALID_RAW, ctx(), d);
    expect(out).toMatchObject({ ok: false, reason: "ratelimit" });
    expect(vi.mocked(d.limiters.known.short.limit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.limiters.known.long.limit)).toHaveBeenCalledTimes(0);
  });

  test("rateLimit throw → infra (fail-closed)", async () => {
    const throwing = { limit: vi.fn(async () => { throw new Error("redis down"); }) };
    const d = fakeDeps({ limiters: { known: { short: throwing, long: throwing }, unknown: { short: throwing, long: throwing } } });
    expect(await runCheckGuards(VALID_RAW, ctx(), d)).toMatchObject({ ok: false, reason: "infra" });
  });

  test("통과 → { ok, silent:false, input(정규화된 E.164·trim 된 이름), now } · siteverify 1 · known 버킷 short→long 2회", async () => {
    const d = fakeDeps();
    const out = await runCheckGuards({ phone: "01012345678", name: " 홍길동 " }, ctx(), d);
    expect(out).toEqual({ ok: true, silent: false, input: { phone: RAW_PHONE_E164, name: RAW_NAME }, now: NOW });
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(limitCalls(d.limiters)).toBe(2);
  });

  test("IP 헤더 없음 → unknown 버킷 · limit 키에 IP 원문 없음(해시 16자)", async () => {
    const d = fakeDeps();
    await runCheckGuards(VALID_RAW, ctx({ ip: null }), d);
    expect(vi.mocked(d.limiters.unknown.short.limit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.limiters.known.short.limit)).toHaveBeenCalledTimes(0);
    const withIp = fakeDeps();
    await runCheckGuards(VALID_RAW, ctx(), withIp);
    const key = vi.mocked(withIp.limiters.known.short.limit).mock.calls[0][0];
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(key).not.toContain(IP);
  });

  test("전화번호 단위 한도는 없다(결정 5) — 한도 키는 IP 해시 하나라 번호가 달라도 같은 키 · 키에 번호 숫자가 없다", async () => {
    const a = fakeDeps();
    await runCheckGuards(VALID_RAW, ctx(), a);
    const b = fakeDeps();
    await runCheckGuards({ phone: "010-9876-5432", name: RAW_NAME }, ctx(), b);
    const keyA = vi.mocked(a.limiters.known.short.limit).mock.calls[0][0];
    const keyB = vi.mocked(b.limiters.known.short.limit).mock.calls[0][0];
    expect(keyA).toBe(keyB);
    expect(keyA).not.toMatch(/1234|5678|9876|5432/);
    const src = codeOf(`${LIB_DIR}/guards.ts`);
    expect(src.match(/checkRateLimit\(/g) ?? []).toHaveLength(1);
    expect(src).toMatch(/clientIpKey\(ctx\.headers,\s*deps\.secret\)/);
  });

  test("한도는 접수와 같은 RATE_LIMITS(known 10분 5·1시간 15)를 쓴다 — 별도 상수를 만들지 않았다", () => {
    expect(RATE_LIMITS.known.short).toEqual({ max: 5, window: "10 m" });
    expect(RATE_LIMITS.known.long).toEqual({ max: 15, window: "1 h" });
    expect(read(`${LIB_DIR}/guards.ts`)).not.toMatch(/max:\s*\d/);
  });
});

// =============================================================================
// 3. 조회 — SQL 은 전화번호 하나 · 이름은 서버에서 상수 시간 · 범위는 오늘(KST) 이후 미취소
// =============================================================================
describe("3. lookupReservation — 없음 = 이름 불일치 = 범위 밖, 일치는 마스킹 뷰 목록", () => {
  const input = { phone: RAW_PHONE_E164, name: RAW_NAME };
  const run = (rows: ReservationCheckRow[], o: { name?: string; now?: Date; locale?: string } = {}) => {
    const d = fakeDb(rows);
    return { d, out: lookupReservation({ ...input, name: o.name ?? RAW_NAME }, { db: d, now: o.now ?? NOW, locale: o.locale }) };
  };

  test("(a) 없음 → { found:false } · findByPhones 1회(후보 = 정규형 + '+820' 옛 저장형) · vehicleNames 0", async () => {
    const { d, out } = run([]);
    expect(await out).toEqual({ found: false });
    expect(d.find).toHaveBeenCalledTimes(1);
    expect(d.find).toHaveBeenCalledWith(CANDIDATES);
    expect(d.veh).toHaveBeenCalledTimes(0);
  });

  test("(b) 번호는 있고 이름이 다르다 → (a) 와 toEqual + JSON 바이트 동일 · vehicleNames 0", async () => {
    const absent = await run([]).out;
    const { d, out } = run([ROW], { name: "김철수" });
    const mismatch = await out;
    expect(mismatch).toEqual(absent);
    expect(JSON.stringify(mismatch)).toBe(JSON.stringify(absent));
    expect(d.veh).toHaveBeenCalledTimes(0);
  });

  test("(b') 이름까지 맞아도 지난 운행·취소 건뿐이면 → (a) 와 같은 결과 (기본 범위: 운행일이 오늘 이후 · 취소 아님)", async () => {
    const absent = await run([]).out;
    const past: ReservationCheckRow = { ...ROW, depart_at: "2026-09-01T00:00:00.000Z", return_at: "2026-09-01T09:00:00.000Z" };
    const cancelled: ReservationCheckRow = { ...ROW, status: "cancelled" };
    for (const rows of [[past], [cancelled], [past, cancelled]]) {
      const got = await run(rows).out;
      expect(got).toEqual(absent);
      expect(JSON.stringify(got)).toBe(JSON.stringify(absent));
    }
  });

  test("이름 정규화 — NFC · 공백 전부 제거 · 소문자 (양쪽 모두)", async () => {
    expect(normalizeName(" 홍 길동 ")).toBe("홍길동");
    expect(normalizeName("Hong Gil-Dong")).toBe("honggil-dong");
    const nfd = RAW_NAME.normalize("NFD");
    expect(nfd).not.toBe(RAW_NAME);
    expect(normalizeName(nfd)).toBe(RAW_NAME);
    for (const [stored, typed] of [
      ["홍 길동", "홍길동"],
      ["홍길동", " 홍 길 동 "],
      [nfd, RAW_NAME],
      [RAW_NAME, nfd],
      ["Hong Gildong", "hong gildong"],
      ["JOHN SMITH", "john\tsmith"],
    ]) {
      expect(namesMatch(stored, typed), `${stored} / ${typed}`).toBe(true);
      expect((await run([{ ...ROW, name: stored }], { name: typed }).out).found, `${stored} / ${typed}`).toBe(true);
    }
    for (const [stored, typed] of [
      ["홍길동", "홍길순"],
      ["홍길동", "홍길"],
      ["홍길동", "홍길동동"],
      ["John Smith", "Jon Smith"],
    ]) {
      expect(namesMatch(stored, typed), `${stored} / ${typed}`).toBe(false);
    }
    // 부재(null)는 더미 비교를 하되 결과는 언제나 false
    expect(namesMatch(null, RAW_NAME)).toBe(false);
    expect(namesMatch(null, "")).toBe(false);
  });

  test("🔴 상수 시간 비교 — 이름 비교는 timingSafeEqual 로, 행마다 한 번(이름이 먼저 맞아도 끝까지) · 행이 없으면 더미 1회", async () => {
    const t = vi.mocked(timingSafeEqual);
    t.mockClear();
    await run([]).out;
    expect(t).toHaveBeenCalledTimes(1);
    t.mockClear();
    await run([ROW], { name: "김철수" }).out;
    expect(t).toHaveBeenCalledTimes(1);
    t.mockClear();
    const other = { ...ROW, name: "김철수" };
    const past = { ...ROW, depart_at: "2026-09-01T00:00:00.000Z", return_at: null };
    await run([ROW, other, past, { ...ROW, status: "cancelled" }]).out;
    expect(t).toHaveBeenCalledTimes(4);
    // 비교 함수는 길이가 다른 이름도 같은 길이(해시)로 맞춰 비교한다 — 이른 return·=== 비교가 없다
    const src = codeOf(`${LIB_DIR}/lookup.ts`);
    expect(src).toMatch(/import \{[^}]*timingSafeEqual[^}]*\} from "node:crypto"/);
    expect(src).toMatch(/createHash\("sha256"\)/);
    expect(src).not.toMatch(/normalizeName\([^)]*\)\s*===|===\s*normalizeName\(/);
  });

  test("🔴 SQL 조건은 전화번호 하나 — 포트 호출 인자는 후보 번호뿐(이름이 DB 로 가지 않는다)", async () => {
    const { d, out } = run([ROW]);
    await out;
    expect(d.find.mock.calls).toEqual([[CANDIDATES]]);
    expect(JSON.stringify(d.find.mock.calls)).not.toContain(RAW_NAME);
  });

  test("'+820' 으로 저장된 옛 행도 국내 번호 입력으로 찾는다", async () => {
    const legacy = { ...ROW, phone: "+8201012345678" };
    const out = await run([legacy]).out;
    expect(out.found).toBe(true);
  });

  test("범위 경계(KST) — 오늘 출발은 보이고 어제 하루 운행은 안 보인다 · 어제 출발해 내일 돌아오는 운행 중 건은 보인다", async () => {
    const todayStart = { ...ROW, depart_at: "2026-09-12T15:00:00.000Z", return_at: null }; // KST 9/13 00:00
    const yesterdayEnd = { ...ROW, depart_at: "2026-09-12T14:59:00.000Z", return_at: null }; // KST 9/12 23:59
    const ongoing = { ...ROW, depart_at: "2026-09-12T00:00:00.000Z", return_at: "2026-09-14T09:00:00.000Z" }; // KST 9/12 → 9/14
    expect(isUpcoming(todayStart, "2026-09-13")).toBe(true);
    expect(isUpcoming(yesterdayEnd, "2026-09-13")).toBe(false);
    expect(isUpcoming(ongoing, "2026-09-13")).toBe(true);
    expect(isUpcoming({ ...todayStart, status: "cancelled" }, "2026-09-13")).toBe(false);
    for (const status of ["new", "confirmed", "done"]) expect(isUpcoming({ ...todayStart, status }, "2026-09-13"), status).toBe(true);
    // "오늘" 은 KST 달력 날짜다 — UTC 로는 아직 9/12 인 KST 9/13 00:30 에도 9/12 23:59 운행은 지난 것이다
    const justAfterMidnightKst = new Date("2026-09-12T15:30:00.000Z");
    expect((await run([yesterdayEnd], { now: justAfterMidnightKst }).out).found).toBe(false);
    expect((await run([todayStart], { now: justAfterMidnightKst }).out).found).toBe(true);
  });

  test("여러 건 → 목록(출발 순) · 이름이 다른 행·지난 행·취소 행은 빠진다 · 차량 이름은 slug 마다 한 번만 읽는다", async () => {
    const later: ReservationCheckRow = { ...ROW, depart_at: "2026-11-01T00:00:00.000Z", return_at: null, status: "new" };
    const sooner: ReservationCheckRow = { ...ROW, depart_at: "2026-09-20T00:00:00.000Z", return_at: null };
    const otherName = { ...ROW, name: "김철수", depart_at: "2026-10-05T00:00:00.000Z" };
    const past = { ...ROW, depart_at: "2026-08-01T00:00:00.000Z", return_at: null };
    const cancelled = { ...ROW, status: "cancelled", depart_at: "2026-10-10T00:00:00.000Z" };
    const { d, out } = run([later, otherName, past, sooner, cancelled]);
    const got = await out;
    expect(got.found).toBe(true);
    if (!got.found) throw new Error("unreachable");
    expect(got.views.map((v) => v.departAtKst)).toEqual(["2026-09-20 09:00", "2026-11-01 09:00"]);
    expect(got.views.map((v) => v.status)).toEqual(["confirmed", "new"]);
    expect(d.veh).toHaveBeenCalledTimes(1);
    expect(d.veh).toHaveBeenCalledWith("bus45");
  });

  test("(c) 일치 → view: 키 집합 = RESERVATION_VIEW_KEYS(접수번호 없음) · 원문 name·phone(5가지 표기)·email·message·admin_memo 0 · 마스킹·라벨 규칙", async () => {
    const leaky = { ...ROW, public_code: "A2B3C4D5", email: "hong@example.com", message: "비밀 메모입니다", admin_memo: "관리자 메모" } as ReservationCheckRow;
    const got = await run([leaky]).out;
    expect(got.found).toBe(true);
    if (!got.found) throw new Error("unreachable");
    expect(got.views).toHaveLength(1);
    const view = got.views[0];
    expect(Object.keys(view).sort()).toEqual([...RESERVATION_VIEW_KEYS].sort());
    const json = JSON.stringify(got);
    for (const needle of [RAW_NAME, ...RAW_PHONE_FORMS, "A2B3C4D5", "publicCode", "public_code", "hong@", "example.com", "비밀 메모", "관리자 메모", "email", "message", "admin_memo", "adminMemo"]) {
      expect(json.includes(needle), needle).toBe(false);
    }
    expect(view).toEqual({
      status: "confirmed",
      statusKey: "reservationCheck.status.confirmed",
      tripType: "round",
      tripTypeKey: "reservationCheck.tripType.round",
      intake: "wizard",
      departAtKst: "2026-10-01 08:30",
      returnAtKst: "2026-10-01 18:00",
      vehicleLabel: VEHICLE_NAME,
      originLabel: locationLabelKo("SEL"),
      destinationLabel: locationLabelKo("BSN"),
      busCount: 2,
      passengers: 40,
      maskedName: "홍**",
      maskedPhone: "010-****-5678",
      createdAtKst: "2026-09-13 14:04",
    });
  });

  test("(c') 간편 접수 → 날짜만 · vehicleLabel·busCount null · vehicles 조회 0", async () => {
    const quick: ReservationCheckRow = {
      ...ROW,
      intake: "quick",
      trip_type: null,
      vehicle_slug: null,
      bus_count: null,
      passengers: 30,
      depart_at: "2026-09-30T15:00:00.000Z", // KST 2026-10-01 00:00
      return_at: "2026-10-02T15:00:00.000Z", // KST 2026-10-03 00:00
    };
    const { d, out } = run([quick]);
    const got = await out;
    if (!got.found) throw new Error("unreachable");
    expect(got.views[0]).toMatchObject({ intake: "quick", tripType: null, tripTypeKey: null, departAtKst: "2026-10-01", returnAtKst: "2026-10-03", vehicleLabel: null, busCount: null, passengers: 30 });
    expect(d.veh).not.toHaveBeenCalled();
  });

  test("(c) 4자리 이상 숫자열은 날짜·대수·인원·마스킹 뒷자리 외 0 · 5자리 이상 숫자열 0 (전화 원문이 어떤 형식으로도 없다)", async () => {
    const got = await run([ROW]).out;
    if (!got.found) throw new Error("unreachable");
    const v = got.views[0];
    const allowed = new Set([...digitRuns(v.departAtKst), ...digitRuns(v.returnAtKst ?? ""), ...digitRuns(v.createdAtKst), String(v.busCount), String(v.passengers ?? ""), v.maskedPhone.slice(-4)]);
    const runs = digitRuns(JSON.stringify(v));
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) expect(allowed.has(r), r).toBe(true);
    expect(digitRuns(JSON.stringify(v), 5)).toEqual([]);
    expect(v.maskedPhone).toMatch(/^\d{3}-\*{4}-\d{4}$/);
    expect(v.maskedName).toMatch(/^.\*{1,2}$/);
  });

  test("(c) 해외 번호 행도 view 에 원문 숫자열 0 · maskedPhone '***'", async () => {
    for (const phone of ["+15551234567", "+6581234567", "+447911123456"]) {
      const d = fakeDb([{ ...ROW, phone }]);
      const got = await lookupReservation({ phone, name: RAW_NAME }, { db: d, now: NOW });
      expect(got.found, phone).toBe(true);
      if (!got.found) throw new Error("unreachable");
      const json = JSON.stringify(got.views);
      expect(got.views[0].maskedPhone, phone).toBe("***");
      expect(digitRuns(json, 5), phone).toEqual([]);
      for (const needle of [phone, phone.slice(1), phone.slice(-7), phone.slice(-4)]) expect(json.includes(needle), `${phone}: ${needle}`).toBe(false);
    }
  });

  test("KST — depart_at UTC 23:30 → 다음날 08:30 벽시계. 서버 TZ 가 America/New_York 이든 Asia/Seoul 이든 같다", () => {
    const original = process.env.TZ;
    const results: string[] = [];
    try {
      for (const tz of ["America/New_York", "Asia/Seoul", "UTC"]) {
        process.env.TZ = tz;
        results.push(kstWallClock(ROW.depart_at), kstWallClock(ROW.return_at as string), kstWallClock("2026-12-31T15:00:00.000Z"));
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
    expect(results).toEqual(Array(3).fill(["2026-10-01 08:30", "2026-10-01 18:00", "2027-01-01 00:00"]).flat());
    expect(() => kstWallClock("not-a-date")).toThrow();
  });

  test("편도(return_at null)·인원 미입력 → null, 알 수 없는 trip_type → null 라벨 키 · vehicles 에 없는 slug → slug 폴백 · 모르는 status → throw", async () => {
    const d = fakeDb([{ ...ROW, trip_type: "oneway", return_at: null, passengers: null }], null);
    const got = await lookupReservation(input, { db: d, now: NOW });
    if (!got.found) throw new Error("unreachable");
    expect(got.views[0]).toMatchObject({ tripType: "oneway", tripTypeKey: "reservationCheck.tripType.oneway", returnAtKst: null, passengers: null, vehicleLabel: "bus45" });
    const weird = toReservationView({ ...ROW, trip_type: null }, VEHICLE_NAMES);
    expect(weird.tripTypeKey).toBeNull();
    expect(() => toReservationView({ ...ROW, status: "weird" }, VEHICLE_NAMES)).toThrow();
  });

  test("마스킹 — +82 휴대전화만 010-****-NNNN, 그 밖은 정확히 '***' (리뷰 M-1, fail-closed)", () => {
    const masked = (phone: string) => toReservationView({ ...ROW, phone }, VEHICLE_NAMES).maskedPhone;
    expect(masked("+821012345678")).toBe("010-****-5678");
    expect(masked("+82101234567")).toBe("010-***-4567");
    for (const other of ["+15551234567", "+6581234567", "+82212345678", "+82", "garbage", "", "010-1234-5678"]) expect(masked(other), JSON.stringify(other)).toBe("***");
  });

  test("뷰 모델 키 목록 — 15개(T2-5 에서 publicCode 를 뺐다), 원문·내부 식별자 키 없음", () => {
    expect([...RESERVATION_VIEW_KEYS].sort()).toEqual(
      ["status", "statusKey", "tripType", "tripTypeKey", "intake", "departAtKst", "returnAtKst", "vehicleLabel", "originLabel", "destinationLabel", "busCount", "passengers", "maskedName", "maskedPhone", "createdAtKst"].sort(),
    );
    for (const k of ["name", "phone", "email", "message", "adminMemo", "admin_memo", "id", "publicCode", "public_code"]) {
      expect(RESERVATION_VIEW_KEYS as readonly string[], k).not.toContain(k);
    }
    expect(read(`${LIB_DIR}/view.ts`)).toMatch(/keyof ReservationView/);
  });
});

// =============================================================================
// 4. select 화이트리스트 — 실제 어댑터에 가짜 클라이언트를 물려 질의를 본다
// =============================================================================
describe("4. supabaseReservationCheckDb — select 화이트리스트 · 조건은 phone 하나", () => {
  type Call = { table: string; select?: string; filters: [string, string, unknown][]; order?: [string, unknown]; limit?: number; maybeSingle?: boolean };
  type Resp = { data: unknown; error: { code: string; message: string; details?: string } | null };
  function fakeClient(res: { reservation?: Resp; vehicle?: Resp } = {}) {
    const calls: Call[] = [];
    const client = {
      calls,
      from(table: string) {
        const c: Call = { table, filters: [] };
        calls.push(c);
        const resp = () => (table === "reservations" ? (res.reservation ?? { data: [], error: null }) : (res.vehicle ?? { data: null, error: null }));
        const q = {
          select(s: string) {
            c.select = s;
            return q;
          },
          eq(k: string, v: unknown) {
            c.filters.push(["eq", k, v]);
            return q;
          },
          in(k: string, v: unknown) {
            c.filters.push(["in", k, v]);
            return q;
          },
          order(k: string, o: unknown) {
            c.order = [k, o];
            return q;
          },
          limit(n: number) {
            c.limit = n;
            return Promise.resolve(resp());
          },
          async maybeSingle(): Promise<Resp> {
            c.maybeSingle = true;
            return resp();
          },
        };
        return q;
      },
    };
    return client;
  }
  let real: typeof import("@/lib/reservation-check/db");
  beforeAll(async () => {
    real = await vi.importActual<typeof import("@/lib/reservation-check/db")>("@/lib/reservation-check/db");
  });

  test("reservations — select 는 화이트리스트 13열(public_code 없음) · `phone in (후보)` 하나 · 출발 늦은 순 · 상한", async () => {
    const client = fakeClient({ reservation: { data: [ROW], error: null } });
    const port = real.supabaseReservationCheckDb(client as never);
    expect(await port.findByPhones(CANDIDATES)).toEqual([ROW]);
    expect(client.calls).toHaveLength(1);
    const [c] = client.calls;
    expect(c.table).toBe("reservations");
    expect(c.select).toBe(RESERVATION_CHECK_SELECT);
    expect(c.select).toBe(RESERVATION_CHECK_COLUMNS.join(","));
    const cols = (c.select ?? "").split(",");
    expect([...cols].sort()).toEqual(
      ["name", "phone", "status", "intake", "trip_type", "depart_at", "return_at", "vehicle_slug", "origin_code", "destination_code", "bus_count", "passengers", "created_at"].sort(),
    );
    for (const banned of ["public_code", "email", "message", "admin_memo", "id", "*", "waypoint_codes", "confirmed_at"]) expect(cols, banned).not.toContain(banned);
    // SQL 조건은 전화번호 하나 — 이름·상태·날짜 조건을 SQL 에 넣지 않는다(부재·불일치·범위 밖이 같은 경로를 탄다)
    expect(c.filters).toEqual([["in", "phone", CANDIDATES]]);
    expect(c.order).toEqual(["depart_at", { ascending: false }]);
    expect(c.limit).toBe(CHECK_MAX_ROWS);
    expect(CHECK_MAX_ROWS).toBeGreaterThanOrEqual(20);
  });

  test("reservations — 행 없음 → [] (throw 아님) · data null → [] · PostgREST error → throw, message 에 code 만(details 미포함)", async () => {
    expect(await real.supabaseReservationCheckDb(fakeClient() as never).findByPhones(CANDIDATES)).toEqual([]);
    expect(await real.supabaseReservationCheckDb(fakeClient({ reservation: { data: null, error: null } }) as never).findByPhones(CANDIDATES)).toEqual([]);
    const client = fakeClient({ reservation: { data: null, error: { code: "42501", message: "permission denied", details: `Failing row contains (${RAW_NAME}, ${RAW_PHONE_E164})` } } });
    await expect(real.supabaseReservationCheckDb(client as never).findByPhones(CANDIDATES)).rejects.toThrow(/42501/);
    await expect(real.supabaseReservationCheckDb(client as never).findByPhones(CANDIDATES)).rejects.not.toThrow(new RegExp(RAW_NAME));
  });

  test("vehicles — select name_ko,name_en 만 · where slug · 없음 → null · name_en 이 문자열이 아니면 빈 문자열", async () => {
    const client = fakeClient({ vehicle: { data: { name_ko: VEHICLE_NAME, name_en: "45-seat Coach" }, error: null } });
    expect(await real.supabaseReservationCheckDb(client as never).vehicleNames("bus45")).toEqual(VEHICLE_NAMES);
    const [c] = client.calls;
    expect(c.table).toBe("vehicles");
    expect(c.select).toBe("name_ko,name_en");
    expect(c.filters).toEqual([["eq", "slug", "bus45"]]);
    expect(await real.supabaseReservationCheckDb(fakeClient() as never).vehicleNames("bus45")).toBeNull();
    const noEn = fakeClient({ vehicle: { data: { name_ko: VEHICLE_NAME, name_en: null }, error: null } });
    expect(await real.supabaseReservationCheckDb(noEn as never).vehicleNames("bus45")).toEqual({ ko: VEHICLE_NAME, en: "" });
  });

  test("정적 — db.ts 는 server-only · 화이트리스트 상수를 lookup.ts 에서 import · 이름·상태·날짜 조건 0 · 비교 로직 0", () => {
    const src = read(`${LIB_DIR}/db.ts`);
    expect(src).toMatch(/^import\s+["']server-only["'];?$/m);
    expect(src).toMatch(/RESERVATION_CHECK_SELECT/);
    const code = codeOf(`${LIB_DIR}/db.ts`);
    expect(code).not.toMatch(/\.(eq|ilike|like|neq|gte|lte|gt|lt|textSearch)\(\s*["'](name|status|depart_at|return_at|public_code)["']/);
    expect(code).not.toMatch(/normalizeName|namesMatch|timingSafeEqual|isUpcoming/);
  });
});

// =============================================================================
// 5. 액션 — 얇은 래퍼 · 존재 비노출(같은 응답 하나) · 응답 시간 바닥 · 정적
// =============================================================================
describe("5. checkReservation — 얇은 래퍼 · not_found 단일화", () => {
  const NOT_FOUND = { ok: false, code: "not_found", messageKey: "reservationCheck.errors.not_found" };

  test("🔴 존재 비노출 — 없음·이름 불일치·지난 건만·취소 건만·허니팟·형식 실패(번호·이름) 응답이 전부 같은 객체·같은 JSON · 로그 0", async () => {
    const results: CheckResult[] = [];
    db = fakeDb([]);
    results.push(await checkReservation(form()));
    db = fakeDb([ROW]);
    results.push(await checkReservation(form({ name: "김철수" })));
    db = fakeDb([{ ...ROW, depart_at: "2026-09-01T00:00:00.000Z", return_at: null }]);
    results.push(await checkReservation(form()));
    db = fakeDb([{ ...ROW, status: "cancelled" }]);
    results.push(await checkReservation(form()));
    db = fakeDb([ROW]);
    results.push(await checkReservation(form({ website: "http://spam" })));
    results.push(await checkReservation(form({ phone: "1234" })));
    results.push(await checkReservation(form({ name: "" })));
    results.push(await checkReservation(form({ phone: null, name: null })));
    for (const r of results) {
      expect(r).toEqual(NOT_FOUND);
      expect(JSON.stringify(r)).toBe(JSON.stringify(results[0]));
      expect(Object.keys(r)).toEqual(["ok", "code", "messageKey"]);
    }
    expect(notFoundResult()).toEqual(NOT_FOUND);
    expect(structuredLog).toHaveBeenCalledTimes(0);
  });

  test("🔴 응답 시간 바닥 — 성공·not_found·거부·예외 모든 경로가 holdResponseFloor 를 정확히 한 번, 요청 시작 시각으로 부른다", async () => {
    const paths: Array<() => Promise<CheckResult>> = [
      () => checkReservation(form()),
      () => checkReservation(form({ name: "김철수" })),
      () => checkReservation(form({ website: "x" })),
      () => checkReservation(form({ phone: "x" })),
      () => {
        deps = fakeDeps({ fetch: siteverify({ action: TURNSTILE_ACTION }) });
        return checkReservation(form());
      },
      () => {
        deps = fakeDeps({ limiters: limiterSet(false) });
        return checkReservation(form());
      },
      () => {
        vi.mocked(checkGuardDeps).mockImplementationOnce(() => {
          throw new Error("env missing");
        });
        return checkReservation(form());
      },
      () => {
        db.find.mockRejectedValueOnce(new Error("db down"));
        return checkReservation(form());
      },
    ];
    for (const [i, p] of paths.entries()) {
      vi.mocked(holdResponseFloor).mockClear();
      deps = fakeDeps();
      db = fakeDb([ROW]);
      const before = Date.now();
      await p();
      expect(vi.mocked(holdResponseFloor), `경로 ${i}`).toHaveBeenCalledTimes(1);
      const [startedAt] = vi.mocked(holdResponseFloor).mock.calls[0];
      expect(typeof startedAt, `경로 ${i}`).toBe("number");
      expect(startedAt, `경로 ${i}`).toBeGreaterThanOrEqual(before);
    }
  });

  test("holdResponseFloor(진짜) — 바닥까지 남은 만큼만 기다리고, 이미 넘었으면 기다리지 않는다", async () => {
    const real = await vi.importActual<typeof import("@/lib/reservation-check/timing")>("@/lib/reservation-check/timing");
    expect(CHECK_RESPONSE_FLOOR_MS).toBeGreaterThanOrEqual(300);
    expect(CHECK_RESPONSE_FLOOR_MS).toBeLessThanOrEqual(2_000);
    const sleep = vi.fn(async () => {});
    await real.holdResponseFloor(1_000, () => 1_100, sleep);
    expect(sleep).toHaveBeenCalledWith(CHECK_RESPONSE_FLOOR_MS - 100);
    sleep.mockClear();
    await real.holdResponseFloor(1_000, () => 1_000 + CHECK_RESPONSE_FLOOR_MS + 5, sleep);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("형식 실패·허니팟 → not_found · db 0 · createServiceClient 0 · siteverify 0 · limit 0", async () => {
    for (const fd of [form({ phone: "02-123-4567" }), form({ website: "https://spam.example" })]) {
      deps = fakeDeps();
      expect(await checkReservation(fd)).toEqual(NOT_FOUND);
      expect(deps.fetch).toHaveBeenCalledTimes(0);
      expect(limitCalls(deps.limiters)).toBe(0);
    }
    expect(db.find).toHaveBeenCalledTimes(0);
    expect(createServiceClient).toHaveBeenCalledTimes(0);
  });

  test("Turnstile 실패(토큰 없음·접수용 토큰) → { code:'turnstile' } · db 0 · limit 0 — 존재 여부와 무관한 단계라 따로 알린다(위젯을 다시 풀게)", async () => {
    expect(await checkReservation(form({ "cf-turnstile-response": null }))).toEqual({ ok: false, code: "turnstile", messageKey: "reservationCheck.errors.turnstile" });
    deps = fakeDeps({ fetch: siteverify({ action: TURNSTILE_ACTION }) });
    expect(await checkReservation(form())).toEqual({ ok: false, code: "turnstile", messageKey: "reservationCheck.errors.turnstile" });
    expect(limitCalls(deps.limiters)).toBe(0);
    expect(db.find).toHaveBeenCalledTimes(0);
  });

  test("ratelimit → { ok:false, code:'ratelimit' } · db 0", async () => {
    deps = fakeDeps({ limiters: limiterSet(false) });
    expect(await checkReservation(form())).toEqual({ ok: false, code: "ratelimit", messageKey: "reservationCheck.errors.ratelimit" });
    expect(db.find).toHaveBeenCalledTimes(0);
    expect(createServiceClient).toHaveBeenCalledTimes(0);
  });

  test("checkGuardDeps throw(env 누락) → infra + structuredLog(guard_setup_failed) 1회 · throw 가 밖으로 나가지 않는다", async () => {
    vi.mocked(checkGuardDeps).mockImplementation(() => {
      throw new Error("checkGuardDeps: TURNSTILE_SECRET_KEY 가 설정되지 않았다");
    });
    await expect(checkReservation(form())).resolves.toEqual({ ok: false, code: "infra", messageKey: "reservationCheck.errors.infra" });
    expect(structuredLog).toHaveBeenCalledTimes(1);
    expect(structuredLog).toHaveBeenCalledWith(expect.objectContaining({ level: "error", event: "reservation_check.guard_setup_failed" }));
    expect(db.find).toHaveBeenCalledTimes(0);
  });

  test("headers() reject → infra (첫 try 안)", async () => {
    vi.mocked(headers).mockRejectedValue(new Error("`headers` was called outside a request scope"));
    await expect(checkReservation(form())).resolves.toEqual(checkFailureResult("infra"));
    expect(structuredLog).toHaveBeenCalledWith(expect.objectContaining({ event: "reservation_check.guard_setup_failed" }));
  });

  test("DB throw → { ok:false, code:'server' } + structuredLog(lookup_failed, name·message·stack 만)", async () => {
    db.find.mockRejectedValue(new Error("reservations select 실패: [57014] statement timeout"));
    await expect(checkReservation(form())).resolves.toEqual({ ok: false, code: "server", messageKey: "reservationCheck.errors.server" });
    expect(structuredLog).toHaveBeenCalledTimes(1);
    const [entry] = vi.mocked(structuredLog).mock.calls[0];
    expect(Object.keys(entry).sort()).toEqual(["event", "level", "message", "name", "stack"]);
    expect(entry).toMatchObject({ level: "error", event: "reservation_check.lookup_failed", name: "Error" });
  });

  test("일치 → { ok:true, views } · createServiceClient 1 · 포트에는 후보 번호만 · 결과에 원문·접수번호 0", async () => {
    const result = await checkReservation(form({ phone: "01012345678", name: " 홍 길동 " }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.views).toHaveLength(1);
    expect(result.views[0].maskedName).toBe("홍**");
    expect(Object.keys(result)).toEqual(["ok", "views"]);
    expect(createServiceClient).toHaveBeenCalledTimes(1);
    expect(supabaseReservationCheckDb).toHaveBeenCalledWith({ kind: "fake-service-client" });
    expect(db.find).toHaveBeenCalledWith(CANDIDATES);
    const json = JSON.stringify(result);
    for (const needle of [RAW_NAME, ...RAW_PHONE_FORMS, "publicCode"]) expect(json.includes(needle), needle).toBe(false);
  });

  test("FormData 가 아닌 인자(null·undefined·{}·useActionState prevState·문자열) → not_found · reject 아님 · db 0 · limit 0", async () => {
    const prev: CheckResult = { ok: false, code: "turnstile", messageKey: "reservationCheck.errors.turnstile" };
    for (const arg of [null, undefined, {}, prev, "crafted"]) {
      deps = fakeDeps();
      const result = await checkReservation(arg as never);
      expect(result, String(arg)).toEqual(NOT_FOUND);
      expect(limitCalls(deps.limiters)).toBe(0);
    }
    expect(db.find).toHaveBeenCalledTimes(0);
    expect(structuredLog).toHaveBeenCalledTimes(0);
  });

  test.each([
    ["일치", async () => checkReservation(form())],
    ["없음", async () => {
      db = fakeDb([]);
      return checkReservation(form());
    }],
    ["이름 불일치", async () => checkReservation(form({ name: "김철수" }))],
    ["형식 실패", async () => checkReservation(form({ phone: "x" }))],
    ["허니팟", async () => checkReservation(form({ website: "x" }))],
    ["turnstile", async () => checkReservation(form({ "cf-turnstile-response": null }))],
    ["ratelimit", async () => {
      deps = fakeDeps({ limiters: limiterSet(false) });
      return checkReservation(form());
    }],
    ["deps throw", async () => {
      vi.mocked(checkGuardDeps).mockImplementation(() => {
        throw new Error("env missing");
      });
      return checkReservation(form());
    }],
    ["db throw", async () => {
      db.find.mockRejectedValue(new Error("db down"));
      return checkReservation(form());
    }],
  ])("IP·토큰·원문 비노출 · detail 0 — %s 경로", async (_label, runIt) => {
    const result = await runIt();
    const json = JSON.stringify(result);
    expect(json).not.toContain(IP);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toMatch(/"detail"/);
    expect(json).not.toMatch(/"fieldErrors"/);
    const logged = everythingLogged();
    for (const needle of [IP, TOKEN, RAW_NAME, RAW_PHONE_E164, INPUT_PHONE]) expect(logged).not.toContain(needle);
  });

  describe("result.ts (순수)", () => {
    test("guardFailureToCheckResult — validation 은 not_found 와 같은 객체 · turnstile·ratelimit·infra 는 각자 키 · detail 미포함", () => {
      const v = guardFailureToCheckResult({ ok: false, reason: "validation", detail: [{ path: "phone", code: "custom", message: "should-not-leak" }] });
      expect(v).toEqual(notFoundResult());
      expect(JSON.stringify(v)).not.toContain("should-not-leak");
      for (const reason of ["turnstile", "ratelimit", "infra"] as const) {
        expect(guardFailureToCheckResult({ ok: false, reason, detail: { secretish: "leak" } })).toEqual({ ok: false, code: reason, messageKey: CHECK_ERROR_KEYS[reason] });
      }
    });

    test("CHECK_ERROR_KEYS — 5 코드(not_found·turnstile·ratelimit·infra·server) · validation 코드는 없다 · 필드 키는 클라이언트 사전 검증용 둘", () => {
      expect(Object.keys(CHECK_ERROR_KEYS).sort()).toEqual(["infra", "not_found", "ratelimit", "server", "turnstile"]);
      for (const [code, key] of Object.entries(CHECK_ERROR_KEYS)) expect(key).toBe(`reservationCheck.errors.${code}`);
      expect(CHECK_FIELD_ERROR_KEYS).toEqual({ phone: "reservationCheck.form.phoneError", name: "reservationCheck.form.nameError" });
      expect(Object.keys(notFoundResult())).toEqual(["ok", "code", "messageKey"]);
    });
  });

  describe("정적 — ADR-3 · ADR-4", () => {
    const action = read(ACTION);

    test("'use server' 첫 줄 · export 는 `export async function checkReservation` 하나", () => {
      expect(action.split("\n")[0]).toMatch(/^["']use server["'];$/);
      const exportLines = action.split("\n").filter((l) => /^\s*export\b/.test(l));
      expect(exportLines).toHaveLength(1);
      expect(exportLines[0]).toMatch(/^export async function checkReservation\(formData: FormData\): Promise<CheckResult>/);
    });

    test("process.env 0 · console 0 · headers.get 0 · zod 직접 호출 0 · next/cache·next/server 0 · try 정확히 2개", () => {
      expect(action).not.toMatch(/process\.env/);
      const code = codeOf(ACTION);
      expect(code).not.toMatch(/console\./);
      expect(code).not.toMatch(/\.get\(/);
      expect(code).not.toMatch(/safeParse|\.parse\(/);
      expect(code).not.toMatch(/from\s+["']next\/(cache|server)["']/);
      expect(action).toMatch(/from\s+["']next\/headers["']/);
      expect((code.match(/^\s*try \{\s*$/gm) ?? []).length).toBe(2);
      expect(code).not.toMatch(/\bif \(.*(name|phone|status)\b/);
    });

    test("부품을 import 만 한다 — Turnstile 검증은 guard 가 한다(액션이 siteverify 를 직접 부르지 않는다) · defaultGuardDeps 0", () => {
      for (const sym of ["checkGuardDeps", "createServiceClient", "supabaseReservationCheckDb", "structuredLog", "formDataToCheckRaw", "checkGuardContext", "runCheckGuards", "lookupReservation", "notFoundResult", "checkFailureResult", "guardFailureToCheckResult", "lookupToResult", "holdResponseFloor"]) {
        expect(action, sym).toContain(sym);
      }
      expect(codeOf(ACTION)).not.toMatch(/defaultGuardDeps|runGuards\(|verifyTurnstile/);
    });

    test("요청 시작 시각을 맨 처음 재고, 바닥은 결과를 돌려주기 직전 한 곳에서만 기다린다", () => {
      const code = codeOf(ACTION);
      const body = code.slice(code.indexOf("export async function checkReservation"));
      const first = body.split("\n").slice(1).find((l) => l.trim().length > 0) ?? "";
      expect(first).toMatch(/const startedAt = Date\.now\(\);/);
      expect(code.match(/holdResponseFloor\(/g) ?? []).toHaveLength(1);
      expect(code).toMatch(/await holdResponseFloor\(startedAt\);\s*return result;/);
    });

    test("`await headers()`·`formDataToCheckRaw(`·`runCheckGuards(` 가 첫 try 안, `lookupReservation(`·`createServiceClient()` 가 둘째 try 안 · 조회 시각은 guard 의 now", () => {
      const lines = codeOf(ACTION).split("\n");
      const tries = lines.map((l, i) => (/^\s*try \{\s*$/.test(l) ? i : -1)).filter((i) => i >= 0);
      const catches = lines.map((l, i) => (/^\s*\} catch \(/.test(l) ? i : -1)).filter((i) => i >= 0);
      expect(tries).toHaveLength(2);
      expect(catches).toHaveLength(2);
      const idx = (re: RegExp) => lines.findIndex((l) => re.test(l) && !/^import/.test(l));
      const inBlock = (i: number, n: 0 | 1) => i > tries[n] && i < catches[n];
      expect(inBlock(idx(/await headers\(\)/), 0)).toBe(true);
      expect(inBlock(idx(/formDataToCheckRaw\(/), 0)).toBe(true);
      expect(inBlock(idx(/runCheckGuards\(/), 0)).toBe(true);
      expect(inBlock(idx(/lookupReservation\(/), 1)).toBe(true);
      expect(inBlock(idx(/createServiceClient\(\)/), 1)).toBe(true);
      expect(codeOf(ACTION)).toMatch(/now: outcome\.now/);
    });

    test("lib/reservation-check/{guards,lookup,view,result,formData,phone,timing}.ts 는 순수 — 'use server' 0 · next 0 · server-only 0 · supabase 0 · process.env 0", () => {
      for (const f of ["guards", "lookup", "view", "result", "formData", "phone", "timing"]) {
        const src = read(`${LIB_DIR}/${f}.ts`);
        expect(src, f).not.toMatch(/["']use server["']/);
        expect(src, f).not.toMatch(/from\s+["']next(\/|["'])/);
        expect(src, f).not.toMatch(/["']server-only["']/);
        expect(src, f).not.toMatch(/supabase/i);
        expect(src, f).not.toMatch(/process\.env/);
      }
      expect(read(`${LIB_DIR}/db.ts`)).not.toMatch(/process\.env/);
    });

    test("정규화는 접수와 같은 함수를 쓴다 — contactPhone(lib/reservations/phone) · 패턴은 lib/types 원본 · guardHeaders 재사용", () => {
      const phone = read(`${LIB_DIR}/phone.ts`);
      expect(phone).toMatch(/from\s+["']\.\.\/reservations\/phone["']/);
      expect(phone).toMatch(/contactPhone\(/);
      expect(phone).toMatch(/PHONE_KR_PATTERN/);
      expect(phone).toMatch(/PHONE_INTL_PATTERN/);
      expect(read(`${LIB_DIR}/formData.ts`)).toMatch(/guardHeaders/);
    });
  });
});

// =============================================================================
// 6. lib/guard/deps.ts — checkGuardDeps 에 Turnstile("check")
// =============================================================================
describe("6. lib/guard/deps.ts — checkGuardDeps() 는 Turnstile(action \"check\")까지 · 접수·관리자 로그인은 그대로", () => {
  type DepsModule = typeof import("@/lib/guard/deps");
  let real: DepsModule;
  const KEYS = ["GUARD_SECRET", "GUARD_ALLOWED_HOSTS", "TURNSTILE_SECRET_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "VERCEL_ENV"] as const;
  let saved: Record<string, string | undefined> = {};
  const URL = "https://unit-test-p63a.upstash.io";
  const TOKEN_ENV = "unit-test-token-p63a";
  const prefixOf = (l: unknown) => (l as { prefix?: unknown }).prefix;

  beforeAll(async () => {
    real = await vi.importActual<DepsModule>("@/lib/guard/deps");
  });
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    process.env.GUARD_SECRET = SECRET;
    process.env.GUARD_ALLOWED_HOSTS = " Localhost, bestour.co.kr ";
    process.env.TURNSTILE_SECRET_KEY = "real-looking-secret";
    process.env.UPSTASH_REDIS_REST_URL = URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = TOKEN_ENV;
    delete process.env.VERCEL_ENV;
  });
  afterAll(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("scope 별 prefix — reserve / check 4개 창 전부 분리 · 캐시는 (url, token, scope) 단위", () => {
    const reserve = real.limitersFor(URL, TOKEN_ENV, "reserve");
    const check = real.limitersFor(URL, TOKEN_ENV, "check");
    for (const b of ["known", "unknown"] as const) {
      for (const w of ["short", "long"] as const) {
        expect(prefixOf(reserve[b][w])).toBe(`guard:reserve:${b}:${w}`);
        expect(prefixOf(check[b][w])).toBe(`guard:check:${b}:${w}`);
        expect(check[b][w]).not.toBe(reserve[b][w]);
      }
    }
    expect(real.limitersFor(URL, TOKEN_ENV, "check")).toBe(real.limitersFor(URL, TOKEN_ENV, "check"));
  });

  test("checkGuardDeps() — turnstile.action 'check' · 시크릿·허용 호스트(trim·소문자) · 5초 · prefix guard:check:*", () => {
    const d = real.checkGuardDeps();
    expect(Object.keys(d).sort()).toEqual(["now", "rateLimit", "secret", "turnstile"]);
    expect(d.turnstile.action).toBe(TURNSTILE_CHECK_ACTION);
    expect(d.turnstile.action).not.toBe(TURNSTILE_ACTION);
    expect(d.turnstile.secret).toBe("real-looking-secret");
    expect(d.turnstile.allowedHosts).toEqual(["localhost", "bestour.co.kr"]);
    expect(d.turnstile.timeoutMs).toBe(5_000);
    expect(typeof d.turnstile.fetch).toBe("function");
    expect(d.secret).toBe(SECRET);
    for (const b of ["known", "unknown"] as const) {
      for (const w of ["short", "long"] as const) expect(prefixOf(d.rateLimit.limiters[b][w])).toBe(`guard:check:${b}:${w}`);
    }
  });

  test.each([
    ["TURNSTILE_SECRET_KEY", /TURNSTILE_SECRET_KEY/],
    ["GUARD_ALLOWED_HOSTS", /GUARD_ALLOWED_HOSTS/],
    ["UPSTASH_REDIS_REST_URL", /UPSTASH_REDIS_REST_URL/],
    ["UPSTASH_REDIS_REST_TOKEN", /UPSTASH_REDIS_REST_TOKEN/],
    ["GUARD_SECRET", /GUARD_SECRET/],
  ])("checkGuardDeps() — %s 누락 → throw (fail-closed, 액션은 infra)", (key, re) => {
    delete process.env[key];
    expect(() => real.checkGuardDeps()).toThrow(re);
  });

  test("checkGuardDeps() — 운영(VERCEL_ENV=production)에서 Cloudflare 더미 secret 은 거부한다(접수와 같은 규칙)", () => {
    process.env.VERCEL_ENV = "production";
    process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
    expect(() => real.checkGuardDeps()).toThrow(/TURNSTILE_SECRET_KEY/);
    delete process.env.VERCEL_ENV;
    expect(() => real.checkGuardDeps()).not.toThrow();
  });

  test("접수(defaultGuardDeps)는 그대로 'reserve' · 관리자 로그인(adminGuardDeps)은 그대로 Turnstile 없음(Turnstile env 없이도 동작)", () => {
    expect(real.defaultGuardDeps().turnstile.action).toBe(TURNSTILE_ACTION);
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.GUARD_ALLOWED_HOSTS;
    const admin = real.adminGuardDeps();
    expect(Object.keys(admin).sort()).toEqual(["now", "rateLimit", "secret"]);
    expect("turnstile" in admin).toBe(false);
  });

  test("정적 — 두 deps 가 action 상수를 각자 박는다 · 새 env 이름 없음 · 우회 스위치 없음", () => {
    const src = read("lib/guard/deps.ts");
    expect(src).toMatch(/action:\s*TURNSTILE_ACTION\b/);
    expect(src).toMatch(/action:\s*TURNSTILE_CHECK_ACTION\b/);
    const names = [...new Set([...src.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]))].sort();
    expect(names).toEqual(["GUARD_ALLOWED_HOSTS", "GUARD_SECRET", "TURNSTILE_SECRET_KEY", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_URL", "VERCEL_ENV"]);
    expect(src).not.toMatch(/GUARD_(DISABLE|BYPASS|SKIP|MOCK)|(DISABLE|BYPASS|SKIP)_GUARD/);
    expect(read("lib/guard/turnstile.ts")).toMatch(/export const TURNSTILE_CHECK_ACTION = "check";/);
  });
});

// =============================================================================
// 7. 카탈로그 — reservationCheck.* · quote.modal.done (ko·en)
// =============================================================================
describe("7. 카탈로그 — 휴대폰 번호 + 예약자 이름, 접수번호 안내 0", () => {
  const ko = JSON.parse(read("messages/ko.json")) as Record<string, unknown>;
  const en = JSON.parse(read("messages/en.json")) as Record<string, unknown>;
  const at = (root: Record<string, unknown>, key: string) =>
    key.split(".").reduce<unknown>((acc, seg) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[seg] : undefined), root);
  const leaves = (node: unknown, prefix = ""): Array<[string, string]> =>
    typeof node === "string"
      ? [[prefix, node]]
      : node && typeof node === "object"
        ? Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
        : [];

  test("quote 뒤에 있고 기존 최상위 키 순서는 그대로", () => {
    expect(Object.keys(ko).slice(0, 7)).toEqual(["common", "layout", "errors", "home", "reservation", "quote", "reservationCheck"]);
  });

  test("오류 5종(not_found·turnstile·ratelimit·infra·server) — ko·en 모두 · validation 문구는 없다(서버는 형식 실패를 not_found 로 답한다)", () => {
    for (const root of [ko, en]) {
      const errors = at(root, "reservationCheck.errors") as Record<string, string>;
      expect(Object.keys(errors).sort()).toEqual(["infra", "not_found", "ratelimit", "server", "turnstile"]);
      for (const [k, v] of Object.entries(errors)) expect(typeof v === "string" && v.trim().length > 0, k).toBe(true);
      for (const k of ["not_found", "ratelimit", "infra", "server"]) {
        expect(errors[k], k).toContain("{tel}");
        expect(errors[k], k).not.toContain(COMPANY.consultTel);
      }
      expect(errors.server).toBe(errors.infra);
    }
  });

  test("not_found 문구 — 원문 고정 · 존재/불일치를 구분하는 표현 없음 · 지난·취소 건이 안 보인다는 사실을 알린다", () => {
    const k = at(ko, "reservationCheck.errors.not_found") as string;
    expect(k).toBe(
      "입력하신 휴대폰 번호와 예약자 이름으로 확인되는 예정된 예약이 없습니다. 견적 신청 때 적으신 번호와 성함을 다시 확인해 주세요. 지난 일정과 취소된 예약은 여기에 보이지 않습니다. 궁금하신 점은 {tel} 로 전화 주세요.",
    );
    for (const w of ["존재", "일치하지", "틀렸", "없는 번호", "등록되지"]) expect(k.includes(w), w).toBe(false);
    const e = at(en, "reservationCheck.errors.not_found") as string;
    expect(e).toMatch(/mobile number and name/);
    expect(e).toMatch(/[Pp]ast trips and cancelled bookings/);
    for (const w of ["exist", "does not match", "wrong", "not registered"]) expect(e.toLowerCase().includes(w), w).toBe(false);
  });

  test("🔴 손님 화면에서 접수번호·뒷 4자리 안내가 사라졌다 — 남은 것은 '예전 문자의 접수번호는 필요 없다' 한 줄뿐", () => {
    for (const [root, codeWord, last4] of [
      [ko, /접수번호/, /뒷\s*4|뒷자리/],
      [en, /request number/i, /last 4|last four|last digits/i],
    ] as const) {
      const rc = leaves(at(root, "reservationCheck"), "reservationCheck");
      expect(rc.filter(([, v]) => codeWord.test(v)).map(([p]) => p)).toEqual(["reservationCheck.form.legacyCodeNote"]);
      expect(rc.filter(([, v]) => last4.test(v)).map(([p]) => p)).toEqual([]);
      const done = leaves(at(root, "quote.modal.done"), "quote.modal.done");
      expect(done.filter(([, v]) => codeWord.test(v) || last4.test(v)).map(([p]) => p)).toEqual([]);
      for (const gone of ["form.codeLabel", "form.codeHint", "form.codePlaceholder", "form.phoneLast4Label", "form.phoneLast4Hint", "form.codeError", "form.phoneLast4Error", "card.code", "errors.validation"]) {
        expect(at(root, `reservationCheck.${gone}`), gone).toBeUndefined();
      }
      for (const gone of ["codeLabel", "codeHint", "noCode"]) expect(at(root, `quote.modal.done.${gone}`), gone).toBeUndefined();
    }
    expect(at(ko, "reservationCheck.form.legacyCodeNote")).toBe("예전 문자에 적힌 접수번호는 이제 입력하지 않으셔도 됩니다.");
    expect(at(en, "reservationCheck.form.legacyCodeNote")).toBe("You no longer need the request number from earlier text messages.");
  });

  test("완료 화면 — 접수번호 대신 '예약 확인에서 휴대폰 번호와 이름으로' 안내(ko·en)", () => {
    expect(at(ko, "quote.modal.done.checkHint")).toBe("접수 내용은 예약 확인에서 휴대폰 번호와 예약자 이름으로 확인하실 수 있습니다.");
    expect(at(en, "quote.modal.done.checkHint")).toBe("You can see your request in Check Booking with your mobile number and name.");
  });

  test("상태 라벨 4종 · 운행 구분 3종 (그대로)", () => {
    expect(at(ko, "reservationCheck.status")).toEqual({ new: "접수", confirmed: "확정", cancelled: "취소", done: "완료" });
    expect(Object.keys((at(ko, "reservationCheck.tripType") ?? {}) as object).sort()).toEqual(["oneway", "oneway_oneway", "round"]);
  });

  test("코드가 쓰는 키가 ko·en 모두 풀린다 — CHECK_ERROR_KEYS · CHECK_FIELD_ERROR_KEYS · status · tripType · meta · form · card", () => {
    for (const root of [ko, en]) {
      for (const key of [...Object.values(CHECK_ERROR_KEYS), ...Object.values(CHECK_FIELD_ERROR_KEYS)]) expect(typeof at(root, key), key).toBe("string");
      for (const s of RESERVATION_STATUSES) expect(typeof at(root, `reservationCheck.status.${s}`), s).toBe("string");
      expect(at(root, "reservationCheck.meta.title")).toContain("{brand}");
      for (const k of ["title", "sub", "eyebrow"]) expect(typeof at(root, `reservationCheck.${k}`), k).toBe("string");
      for (const k of ["required", "nameLabel", "nameHint", "phoneLabel", "phoneHint", "submit", "submitting", "errorSummary", "nameError", "phoneError", "help", "legacyCodeNote", "security", "notReadyTitle", "notReadyBody"]) {
        expect(typeof at(root, `reservationCheck.form.${k}`), k).toBe("string");
      }
      for (const k of ["title", "count", "status", "name", "phone", "vehicle", "route", "tripType", "departAt", "returnAt", "busCount", "passengers", "createdAt", "again", "call", "help"]) {
        expect(typeof at(root, `reservationCheck.card.${k}`), k).toBe("string");
      }
    }
    expect(at(ko, "reservationCheck.card.count")).toContain("{n}");
    expect(at(ko, "reservationCheck.form.notReadyBody")).toContain("{tel}");
  });

  test("금지어·가격 표기·실증 불가 문구·원장 verbatim 리터럴 0", () => {
    const nsText = JSON.stringify(at(ko, "reservationCheck") ?? {});
    for (const w of FORBIDDEN) expect(nsText.includes(w), w).toBe(false);
    for (const re of PRICE_MARKS) expect(re.test(nsText), String(re)).toBe(false);
    for (const w of UNPROVEN) expect(nsText.includes(w), w).toBe(false);
    expect(nsText.includes(VERBATIM.bookingNotice)).toBe(false);
  });

  test("기존 네임스페이스는 그대로 — reservation.errors 6키", () => {
    expect(Object.keys((ko.reservation as { errors: object }).errors).sort()).toEqual(["bot", "infra", "ratelimit", "server", "turnstile", "validation"]);
  });
});

// =============================================================================
// 8. 컴포넌트·페이지 정적 + 렌더
// =============================================================================
describe("8. 컴포넌트·페이지", () => {
  const componentFiles = walk(path.join(ROOT, COMPONENT_DIR))
    .map((p) => path.relative(ROOT, p).split(path.sep).join("/"))
    .sort();
  const codeFiles = componentFiles.filter((f) => /\.(ts|tsx)$/.test(f));
  const sources = [...codeFiles, PAGE].map((file) => ({ file, text: read(file), code: codeOf(file) }));
  const ko = JSON.parse(read("messages/ko.json")) as Record<string, unknown>;

  async function renderWithIntl(element: unknown): Promise<string> {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { NextIntlClientProvider } = await import("next-intl");
    const providerProps = { locale: "ko", messages: ko, timeZone: "Asia/Seoul" } as unknown as Parameters<typeof NextIntlClientProvider>[0];
    return renderToStaticMarkup(createElement(NextIntlClientProvider, providerProps, element as never));
  }

  test("산출물이 있다 — page · CheckForm · ReservationCard · fields · validate · preview-result · css · lib 8개 · 액션", () => {
    for (const f of [PAGE, FORM, CARD, PREVIEW, `${COMPONENT_DIR}/fields.ts`, `${COMPONENT_DIR}/validate.ts`, `${COMPONENT_DIR}/check.module.css`, ACTION]) {
      expect(existsSync(path.join(ROOT, f)), f).toBe(true);
    }
    for (const f of ["guards", "lookup", "db", "view", "result", "formData", "phone", "timing"]) expect(existsSync(path.join(ROOT, LIB_DIR, `${f}.ts`)), f).toBe(true);
  });

  test("서버 페이지 — 사이트 키(NEXT_PUBLIC_TURNSTILE_SITE_KEY)와 조회 전용 action 을 내린다 · 원장 verbatim·전화 · 정적 렌더 유지", () => {
    const src = codeOf(PAGE);
    expect(/^\s*["']use client["']/m.test(src)).toBe(false);
    expect(src).toMatch(/turnstileSiteKey=\{process\.env\.NEXT_PUBLIC_TURNSTILE_SITE_KEY \?\? ""\}/);
    expect(src).toMatch(/turnstileAction=\{TURNSTILE_CHECK_ACTION\}/);
    expect(src).not.toMatch(/turnstileAction=\{TURNSTILE_ACTION\}/);
    expect(ledgerImports(read(PAGE))).toEqual(expect.arrayContaining(["VERBATIM"]));
    expect(src).toMatch(/bookingNotice=\{localizeVerbatim\(locale,\s*VERBATIM\.bookingNotice\)\}/);
    expect(src).toMatch(/tel=\{consultPhone\(locale\)\}/);
    expect(src).not.toMatch(/force-dynamic/);
    expect(src).toMatch(/namespace:\s*["']reservationCheck\.meta["']/);
    expect(src).toMatch(/ledgerUi\(locale\)\.brand\b/);
    expect(src).not.toMatch(/createServiceClient|checkReservation\(|lib\/reservation-check\/(db|lookup)/);
  });

  test("폼 — name 은 CF/CG 상수만 · phone·name 두 칸 · 허니팟 · Turnstile 위젯(서버가 준 action·사이트 키·리셋 키) · 사이트 키가 없으면 준비 중 안내 + 제출 닫힘", () => {
    const src = codeOf(FORM);
    expect(src).not.toMatch(/name="/);
    expect(src).toMatch(/name=\{CF\.phone\}/);
    expect(src).toMatch(/name=\{CF\.name\}/);
    expect(src).not.toMatch(/publicCode|phoneLast4|last4/);
    const hp = src.match(/<input[^>]*name=\{CG\.website\}[^>]*\/>/)?.[0] ?? "";
    expect(hp, "허니팟 input 이 있어야 한다").not.toBe("");
    expect(hp).toMatch(/tabIndex=\{-1\}/);
    expect(hp).toMatch(/autoComplete="off"/);
    expect(hp).toMatch(/aria-hidden/);
    expect(src).toMatch(/<TurnstileWidget siteKey=\{turnstileSiteKey\} action=\{turnstileAction\} resetKey=\{turnstileResetKey\} \/>/);
    expect(src).toMatch(/from\s+["']@\/components\/quote\/TurnstileWidget["']/);
    expect(src).toMatch(/data-testid="reservation-check-not-ready"/);
    expect(src).toMatch(/disabled=\{[^}]*pending/);
    expect(src).toMatch(/disabled=\{[^}]*notReady/);
    // 숨은 칸은 화면 로케일 하나뿐(Turnstile 의 hidden input 은 위젯이 스스로 넣는다)
    expect(src.match(/type="hidden"/g) ?? []).toHaveLength(1);
    expect(src).toMatch(/<input type="hidden" name=\{CL\} value=\{locale === "en" \? "en" : "ko"\} \/>/);
    // 입력 정리는 접수 모달과 같은 함수(자동 하이픈 · `+` 로 시작하면 해외)
    expect(src).toMatch(/formatPhoneInput\(/);
    expect(src).toMatch(/autoComplete="tel"/);
    expect(src).toMatch(/autoComplete="name"/);
    expect(src).toMatch(/data-testid="reservation-check-legacy-note"/);
    expect(CF).toEqual(CHECK_FORM_FIELDS);
    expect(CG).toEqual(CHECK_GUARD_FORM_FIELDS);
  });

  test("서버 응답이 오면(성공 아님) 위젯을 새 토큰으로 리셋하고 요약으로 포커스 · 성공하면 결과 묶음으로 포커스", () => {
    const src = codeOf(FORM);
    const effect = src.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[result\]\);/)?.[0] ?? "";
    expect(effect, "result 를 보는 useEffect 가 있어야 한다").not.toBe("");
    expect(effect).toMatch(/liveRef\.current\?\.focus\(\)/);
    expect(effect).toMatch(/setTurnstileResetKey\(/);
    expect(effect).toMatch(/resultsRef\.current\?\.focus\(\)/);
    expect(src.indexOf("useEffect(() =>")).toBeLessThan(src.indexOf("if (result?.ok)"));
    expect(src).toMatch(/tRoot\(\s*result\.messageKey\s*,\s*\{\s*tel:\s*tel\.display\s*\}\s*\)/);
  });

  test("폼 렌더 — 사이트 키가 있으면 조회 전용 위젯(data-action=check) · 없으면 준비 중 안내 + 제출 닫힘 · 프리뷰는 위젯 없음 · 접수번호 칸 0", async () => {
    const { createElement } = await import("react");
    const { CheckForm } = await import("@/components/reservation-check/CheckForm");
    const { consultPhone } = await import("@/lib/contact-phone");
    const base = { bookingNotice: VERBATIM.bookingNotice, tel: consultPhone("ko"), turnstileAction: TURNSTILE_CHECK_ACTION, previewResult: null };
    const withKey = await renderWithIntl(createElement(CheckForm, { ...base, turnstileSiteKey: "1x00000000000000000000AA" }));
    expect(withKey).toContain('data-action="check"');
    expect(withKey).not.toContain('data-testid="reservation-check-not-ready"');
    expect(withKey).toMatch(/<button[^>]*type="submit"(?![^>]*disabled)[^>]*>/);
    expect(withKey).toContain('name="phone"');
    expect(withKey).toContain('name="name"');
    expect(withKey).not.toMatch(/name="(publicCode|phoneLast4)"/);
    expect(withKey).toContain("예전 문자에 적힌 접수번호는 이제 입력하지 않으셔도 됩니다.");
    const noKey = await renderWithIntl(createElement(CheckForm, { ...base, turnstileSiteKey: "" }));
    expect(noKey).toContain('data-testid="reservation-check-not-ready"');
    expect(noKey).not.toContain('data-testid="turnstile"');
    expect(noKey).toMatch(/<button[^>]*type="submit"[^>]*disabled[^>]*>/);
    const preview = await renderWithIntl(createElement(CheckForm, { ...base, turnstileSiteKey: "", previewResult: "ok" }));
    expect(preview).not.toContain('data-testid="reservation-check-security"');
    expect(preview).toMatch(/<button[^>]*type="submit"(?![^>]*disabled)[^>]*>/);
  });

  test("토큰 없이 누르면 서버까지 가지 않고 보안 확인 안내(같은 문구 키)를 보인다 — 프리뷰는 예외", () => {
    const src = codeOf(FORM);
    expect(src).toMatch(/\.get\(CG\.turnstile\)/);
    expect(src).toMatch(/CHECK_ERROR_KEYS\.turnstile/);
  });

  test("useActionState — checkReservation 을 직접 넘기지 않고 (_prev, fd) 래퍼로 감싼다", () => {
    const src = codeOf(FORM);
    expect(src).toMatch(/^\s*["']use client["'];?/m);
    expect(src).not.toMatch(/useActionState(<[^>]*>)?\(\s*checkReservation/);
    expect(src).toMatch(/checkReservation\(\s*fd\s*\)/);
  });

  test("클라이언트 컴포넌트는 원장·서버 모듈을 import 하지 않는다 · 'use client' 는 CheckForm 하나", () => {
    for (const f of codeFiles) {
      const src = read(f);
      expect(ledgerImports(src), f).toEqual([]);
      expect(/lib\/supabase|lib\/guard|server-only|lib\/reservation-check\/(db|guards|lookup|phone|timing)["']/.test(src), f).toBe(false);
      expect(/from\s+["']zod["']/.test(src), f).toBe(false);
      expect(/from\s+["']next\/link["']/.test(src), f).toBe(false);
    }
    expect(codeFiles.filter((f) => /^\s*["']use client["']/m.test(read(f)))).toEqual([FORM]);
  });

  test("카드 — 접수번호를 보이지 않는다 · data-legal booking-notice · tel 링크 · 가린 값만", () => {
    const src = codeOf(CARD);
    expect(src).not.toMatch(/publicCode|card\.code|reservation-code/);
    expect(src).toMatch(/data-legal="booking-notice"/);
    expect(src).toMatch(/href=\{tel\.href\}/);
    for (const k of ["maskedName", "maskedPhone", "vehicleLabel", "originLabel", "destinationLabel", "departAtKst", "createdAtKst"]) expect(src, k).toContain(k);
    expect(src).not.toMatch(/view\.(name|phone|email)\b/);
  });

  test("여러 건 결과 — 카드 n장 · 건수 · 전화·다른 조회 버튼은 한 번만 · 카드 제목 id 가 겹치지 않는다", async () => {
    const { createElement } = await import("react");
    const { ReservationResults } = await import("@/components/reservation-check/ReservationCard");
    const { consultPhone } = await import("@/lib/contact-phone");
    const a = toReservationView(ROW, VEHICLE_NAMES);
    const b = toReservationView({ ...ROW, status: "new", depart_at: "2026-11-01T00:00:00.000Z", return_at: null }, VEHICLE_NAMES);
    const html = await renderWithIntl(createElement(ReservationResults, { views: [a, b], bookingNotice: VERBATIM.bookingNotice, tel: consultPhone("ko"), onAgain: () => {} }));
    expect(html.match(/data-testid="reservation-card"/g) ?? []).toHaveLength(2);
    expect(html.match(/data-testid="reservation-call"/g) ?? []).toHaveLength(1);
    expect(html.match(/data-testid="reservation-again"/g) ?? []).toHaveLength(1);
    expect(html).toContain("예정된 예약 2건");
    const ids = [...html.matchAll(/id="(reservation-check-result-title-[^"]*)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
    // verbatim 은 접수(new) 상태 카드에만 — 확정 카드에는 없다(결정 3-2)
    expect(html.match(/data-legal="booking-notice"/g) ?? []).toHaveLength(1);
    expect(html).not.toContain("A2B3C4D5");
  });

  test("단일 카드(기존 호출 모양) — 전화·다른 조회 버튼을 그대로 갖는다(다른 테스트·화면 호환)", async () => {
    const { createElement } = await import("react");
    const { ReservationCard } = await import("@/components/reservation-check/ReservationCard");
    const { consultPhone } = await import("@/lib/contact-phone");
    const html = await renderWithIntl(createElement(ReservationCard, { view: toReservationView(ROW, VEHICLE_NAMES), bookingNotice: VERBATIM.bookingNotice, tel: consultPhone("ko"), onAgain: () => {} }));
    expect(html).toContain('data-testid="reservation-call"');
    expect(html).toContain('data-testid="reservation-again"');
    expect(html).not.toContain('data-testid="reservation-code"');
  });

  test("개발 프리뷰(?previewResult=) — NODE_ENV 가드 뒤에서만 searchParams · 모드 5종(ok·quick·multi·not_found·ratelimit)", () => {
    const page = codeOf(PAGE);
    const guard = page.indexOf('process.env.NODE_ENV !== "production"');
    const sp = page.indexOf("await searchParams");
    expect(guard).toBeGreaterThan(-1);
    expect(sp).toBeGreaterThan(guard);
    expect(page).toMatch(/previewResult=\{/);
    expect([...PREVIEW_RESULT_MODES]).toEqual(["ok", "quick", "multi", "not_found", "ratelimit"]);
    expect(parsePreviewResult("1")).toBe("ok");
    expect(parsePreviewResult("multi")).toBe("multi");
    for (const bad of [undefined, "", "infra", ["ok"], "OK"]) expect(parsePreviewResult(bad as never), String(bad)).toBeNull();
  });

  test("프리뷰 결과 — not_found 는 notFoundResult 와 동일 · ok 는 1건 · multi 는 2건 · 뷰는 RESERVATION_VIEW_KEYS 와 같고 원문 모양 0", () => {
    expect(previewCheckResult("not_found")).toEqual(notFoundResult());
    expect(previewCheckResult("ratelimit")).toEqual({ ok: false, code: "ratelimit", messageKey: CHECK_ERROR_KEYS.ratelimit });
    for (const [mode, n] of [["ok", 1], ["quick", 1], ["multi", 2]] as const) {
      const r = previewCheckResult(mode);
      if (!r.ok) throw new Error("unreachable");
      expect(r.views, mode).toHaveLength(n);
      for (const v of r.views as ReservationView[]) {
        expect(Object.keys(v).sort()).toEqual([...RESERVATION_VIEW_KEYS].sort());
        expect(v.maskedName).toMatch(/^.\*{1,2}$/);
        expect(digitRuns(JSON.stringify(v), 5)).toEqual([]);
      }
    }
    const src = codeOf(PREVIEW);
    expect(src).not.toMatch(/name:\s*["']|phone:\s*["']|email|publicCode/);
  });

  test("한글 리터럴 0 (프리뷰 픽스처 제외) — 문구는 messages 의 reservationCheck.* 에서만", () => {
    for (const { file, code } of sources) {
      if (file === PREVIEW) continue;
      const hits = code
        .split("\n")
        .map((l, i) => [i + 1, l] as const)
        .filter(([, l]) => HANGUL.test(l));
      expect(hits, `${file} 에 한글 리터럴`).toEqual([]);
    }
  });

  test("금지어 0 · 가격 표기 0 · 실증 불가 문구 0 · localStorage/sessionStorage 0", () => {
    for (const { file, code } of sources) {
      for (const w of FORBIDDEN) expect(code.includes(w), `${file}: ${w}`).toBe(false);
      for (const re of PRICE_MARKS) expect(re.test(code), `${file}: ${re}`).toBe(false);
      for (const w of UNPROVEN) expect(code.includes(w), `${file}: ${w}`).toBe(false);
      expect(/localStorage|sessionStorage/.test(code), file).toBe(false);
    }
    for (const f of ["guards", "lookup", "db", "view", "result", "formData", "phone", "timing"]) {
      const code = codeOf(`${LIB_DIR}/${f}.ts`);
      for (const re of PRICE_MARKS) expect(re.test(code), `${f}: ${re}`).toBe(false);
    }
  });

  test("CSS — 역할 토큰만(HEX·rgba 0) · 폼 클래스 복제 0 · 접수번호 표시 클래스는 지웠다", () => {
    expect(read(FORM)).toMatch(/from\s+["']@\/components\/quote\/quote\.module\.css["']/);
    const css = codeOf(`${COMPONENT_DIR}/check.module.css`);
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(/\b(rgba?|hsla?)\(/.test(css)).toBe(false);
    expect(css).not.toMatch(/\.control\s*\{|\.btn\s*\{|\.field\s*\{/);
    expect(css).not.toMatch(/\.codeLabel\s*\{|\.code\s*\{|\.codeInput\s*\{/);
  });

  test("클라이언트 사전 검증 validateCheckForm 은 zod CheckInput 과 같은 판정을 낸다(표본) · 필드별 키", () => {
    const samples: Array<{ phone: string; name: string }> = [
      { phone: INPUT_PHONE, name: RAW_NAME },
      { phone: "01012345678", name: " 홍 길동 " },
      { phone: "+15551234567", name: "John Smith" },
      { phone: "+82010-1234-5678", name: RAW_NAME },
      { phone: "+1 555 123 4567", name: RAW_NAME },
      { phone: "02-123-4567", name: RAW_NAME },
      { phone: "010-12-34", name: RAW_NAME },
      { phone: "+0123", name: RAW_NAME },
      { phone: "", name: RAW_NAME },
      { phone: INPUT_PHONE, name: "" },
      { phone: INPUT_PHONE, name: "   " },
      { phone: INPUT_PHONE, name: "가".repeat(30) },
      { phone: INPUT_PHONE, name: "가".repeat(31) },
      { phone: "abc", name: "" },
    ];
    for (const s of samples) {
      const errs = validateCheckForm(s);
      const zod = CheckInput.safeParse(s);
      expect(Object.keys(errs).length === 0, JSON.stringify(s)).toBe(zod.success);
      if (errs.phone) expect(errs.phone).toBe(CHECK_FIELD_ERROR_KEYS.phone);
      if (errs.name) expect(errs.name).toBe(CHECK_FIELD_ERROR_KEYS.name);
    }
    expect(validateCheckForm({ phone: "x", name: "" })).toEqual({ phone: CHECK_FIELD_ERROR_KEYS.phone, name: CHECK_FIELD_ERROR_KEYS.name });
  });

  test("legacy-menu — 예약확인 ready:true · 나머지 항목은 그대로", () => {
    const item = LEGACY_MENU.find((m) => m.key === "reservationCheck");
    expect(item?.ready).toBe(true);
    expect(item?.href).toBe("/reservation/check");
    expect(LEGACY_MENU.filter((m) => m.ready).map((m) => m.key).sort()).toEqual(["about", "fleet", "gallery", "guide", "notices", "quote", "reservationCheck"]);
  });
});
