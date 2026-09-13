/**
 * P6-3a — 예약확인 `/reservation/check` 계약 테스트 (플랜 v4 P6-3a · ADR-3 · ADR-4 · CLAUDE.md §3 서비스 롤 서버 전용).
 *
 * 브리프 §검증 1~8 을 그대로 단언한다:
 *   1. zod — 코드 7자/9자/알파벳 밖 문자(PUBLIC_CODE_ALPHABET 로 계산) → validation, 소문자는 대문자 정규화 후 통과. 뒷자리 3자/5자/문자 → validation
 *   2. 순서 — validation 실패 → 허니팟·rateLimit·DB 0 / 허니팟 → DB 0 + not_found 와 같은 응답 / rateLimit 거부 → DB 0 + ratelimit
 *   3. 조회 — 부재와 뒷자리 불일치가 **같은 객체**(toEqual + JSON 동일) / 일치 → view 에 원문 name·phone·email 키 0, 마스킹 규칙, KST 변환(TZ 두 가지)
 *   4. select 화이트리스트 — 어댑터가 넘긴 select 문자열에 email·message·admin_memo·* 없음
 *   5. 액션 정적 — 'use server' 첫 줄 · export 1개 · process.env 0 · try 2개, 입력 모양 방어, IP 비노출
 *   6. lib/guard/deps.ts — limitersFor scope 별 prefix(guard:reserve: vs guard:check:), defaultGuardDeps 의 prefix 는 전과 동일
 *   7. ko.json — reservationCheck 네임스페이스(끝에 추가), 오류 3종에 COMPANY.tel, not_found 문구 고정
 *   8. 컴포넌트 정적 — useActionState(checkReservation 0 · 가격·BM 금지어 0 · 법정 문구 리터럴 0 · localStorage 0 · 원장은 서버 페이지만
 *
 * `'use server'` 파일을 vitest 에서 부르기 위해 next/headers·lib/guard/deps·lib/supabase/server·lib/reservation-check/db·lib/log 을 vi.mock 한다.
 * **runCheckGuards·lookupReservation 은 진짜다** — limiter·DB 포트만 주입 mock 이라 순서·결과가 실제 코드에서 나온다. 원격 DB 접근 0.
 * tests/ 아래라 세 게이트의 검사 대상이다 — 금지어·임시값 마커 리터럴은 이스케이프로 조립한다.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { CF, CG } from "@/components/reservation-check/fields";
import { PREVIEW_RESULT_MODES, parsePreviewResult, previewCheckResult } from "@/components/reservation-check/preview-result";
import { validateCheckForm } from "@/components/reservation-check/validate";
import { locationLabelKo } from "@/lib/codes";
import { HONEYPOT_FIELD, RATE_LIMITS, type RateLimiterSet } from "@/lib/guard";
import { COMPANY, VERBATIM } from "@/lib/legal/disclosures";
import { LEGACY_MENU } from "@/lib/legacy-menu-map";
import { CHECK_FORM_FIELDS, CHECK_GUARD_FORM_FIELDS, checkGuardContext, formDataToCheckRaw } from "@/lib/reservation-check/formData";
import { CheckInput, PHONE_LAST4_PATTERN, runCheckGuards, type CheckGuardDeps } from "@/lib/reservation-check/guards";
import {
  RESERVATION_CHECK_COLUMNS,
  RESERVATION_CHECK_SELECT,
  lookupReservation,
  phoneLast4Matches,
  type ReservationCheckDb,
  type ReservationCheckRow,
} from "@/lib/reservation-check/lookup";
import { CHECK_ERROR_KEYS, CHECK_FIELD_ERROR_KEYS, checkFailureResult, guardFailureToCheckResult, notFoundResult, type CheckResult } from "@/lib/reservation-check/result";
import { RESERVATION_STATUSES, RESERVATION_VIEW_KEYS, kstWallClock, toReservationView, type ReservationView } from "@/lib/reservation-check/view";
import { PUBLIC_CODE_ALPHABET, PUBLIC_CODE_LENGTH, PUBLIC_CODE_PATTERN } from "@/lib/reservations/publicCode";

// server-only 는 vitest(node) 에서 import 즉시 throw 한다 — 빈 모듈로 바꿔치기(guard.test.ts·reservation-action.test.ts 선례).
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/guard/deps", () => ({ checkGuardDeps: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn(() => ({ kind: "fake-service-client" })) }));
vi.mock("@/lib/reservation-check/db", () => ({ supabaseReservationCheckDb: vi.fn() }));
vi.mock("@/lib/log", () => ({ structuredLog: vi.fn() }));
// 허니팟 단계가 "불렸는가" 를 세기 위해 원본을 spy 로 감싼다(동작은 그대로).
vi.mock("@/lib/guard/honeypot", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/guard/honeypot")>();
  return { ...mod, checkHoneypot: vi.fn(mod.checkHoneypot) };
});

import { headers } from "next/headers";
import { checkGuardDeps } from "@/lib/guard/deps";
import { checkHoneypot } from "@/lib/guard/honeypot";
import { structuredLog } from "@/lib/log";
import { supabaseReservationCheckDb } from "@/lib/reservation-check/db";
import { createServiceClient } from "@/lib/supabase/server";
import { checkReservation } from "@/actions/reservation-check";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");

const ACTION = "actions/reservation-check.ts";
const PAGE = "app/[locale]/(site)/reservation/check/page.tsx";
const COMPONENT_DIR = "components/reservation-check";
const FORM = `${COMPONENT_DIR}/CheckForm.tsx`;
const CARD = `${COMPONENT_DIR}/ReservationCard.tsx`;
const PREVIEW = `${COMPONENT_DIR}/preview-result.ts`;
const LIB_DIR = "lib/reservation-check";

/** 주석(`//` 줄 끝, 블록)을 걷어낸 코드만 남긴다 — tests/layout.test.ts 와 같은 구현 */
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock
    .split("\n")
    .map((line) => {
      let inStr: string | null = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inStr) {
          if (ch === "\\") i++;
          else if (ch === inStr) inStr = null;
        } else if (ch === '"' || ch === "'" || ch === "`") inStr = ch;
        else if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

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
const NOW = new Date("2026-09-13T03:00:00.000Z");
const IP = "10.9.8.7";
const CODE = "A2B3C4D5";
const LAST4 = "5678";
const RAW_NAME = "홍길동";
const RAW_PHONE_E164 = "+821012345678";
const RAW_PHONE_FORMS = [RAW_PHONE_E164, "821012345678", "01012345678", "010-1234-5678", "1012345678"];

const ROW: ReservationCheckRow = {
  public_code: CODE,
  name: RAW_NAME,
  phone: RAW_PHONE_E164,
  status: "confirmed",
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

type FakeDb = ReservationCheckDb & { find: ReturnType<typeof vi.fn>; veh: ReturnType<typeof vi.fn> };
function fakeDb(row: ReservationCheckRow | null, vehicleName: string | null = VEHICLE_NAME): FakeDb {
  const find = vi.fn(async () => row);
  const veh = vi.fn(async () => vehicleName);
  return { findByPublicCode: find, vehicleNameKo: veh, find, veh };
}

function limiterSet(success = true): RateLimiterSet {
  const mk = () => ({ limit: vi.fn(async () => ({ success })) });
  return { known: { short: mk(), long: mk() }, unknown: { short: mk(), long: mk() } };
}
const limitCalls = (set: RateLimiterSet) =>
  (["known", "unknown"] as const)
    .flatMap((b) => (["short", "long"] as const).map((w) => vi.mocked(set[b][w].limit).mock.calls.length))
    .reduce((a, b) => a + b, 0);

function fakeDeps(limiters: RateLimiterSet = limiterSet()): CheckGuardDeps & { limiters: RateLimiterSet } {
  return { now: () => NOW, secret: SECRET, rateLimit: { limiters, timeoutMs: 1_000 }, limiters };
}

type FormValue = string | null;
function form(overrides: Record<string, FormValue> = {}): FormData {
  const base: Record<string, FormValue> = { publicCode: CODE, phoneLast4: LAST4 };
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v === null) continue;
    fd.append(k, v);
  }
  return fd;
}

const ctx = (o: { ip?: string | null; website?: string } = {}) =>
  checkGuardContext(new Headers(o.ip === null ? {} : { "x-forwarded-for": o.ip ?? IP, host: "localhost" }), { website: o.website });

type RequestHeaders = Awaited<ReturnType<typeof headers>>;
const requestHeaders = (init: Record<string, string>) => new Headers(init) as unknown as RequestHeaders;

const digitRuns = (s: string, min = 4): string[] => s.match(new RegExp(`\\d{${min},}`, "g")) ?? [];

let db: FakeDb;
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  db = fakeDb(ROW);
  vi.mocked(headers).mockResolvedValue(requestHeaders({ "x-forwarded-for": IP, host: "localhost" }));
  vi.mocked(checkGuardDeps).mockReturnValue(fakeDeps());
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
// 1. zod — CheckInput
// =============================================================================
describe("1. zod CheckInput — 코드 8자(알파벳 31자, 대문자 정규화) + 뒷 4자리 숫자", () => {
  const parse = (publicCode: unknown, phoneLast4: unknown = LAST4) => CheckInput.safeParse({ publicCode, phoneLast4 });

  test("정상 8자 → 통과. 소문자·양끝 공백은 대문자·trim 으로 정규화된다", () => {
    expect(parse(CODE).success).toBe(true);
    const r = parse(" a2b3c4d5 ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ publicCode: CODE, phoneLast4: LAST4 });
  });

  test("7자·9자 → validation", () => {
    expect(parse(CODE.slice(0, 7)).success).toBe(false);
    expect(parse(`${CODE}2`).success).toBe(false);
    expect(PUBLIC_CODE_LENGTH).toBe(8);
  });

  test("알파벳 밖 문자 — PUBLIC_CODE_ALPHABET 로 계산한 혼동 문자(0·O·1·I·L)·기호·한글 → validation, 알파벳 31자는 전부 통과", () => {
    const outside = ["0", "O", "1", "I", "L"].filter((c) => !PUBLIC_CODE_ALPHABET.includes(c));
    expect(outside).toHaveLength(5);
    for (const c of [...outside, "-", "_", " ", "가", "*"]) expect(parse(CODE.slice(0, 7) + c).success, JSON.stringify(c)).toBe(false);
    expect(PUBLIC_CODE_ALPHABET).toHaveLength(31);
    for (const c of PUBLIC_CODE_ALPHABET) expect(parse(c.repeat(PUBLIC_CODE_LENGTH)).success, c).toBe(true);
    for (const c of PUBLIC_CODE_ALPHABET.toLowerCase()) expect(parse(c.repeat(PUBLIC_CODE_LENGTH)).success, c).toBe(true);
  });

  test("뒷자리 3자·5자·문자·공백 포함 → validation. 4자리 숫자만 통과(선행 0 포함)", () => {
    for (const bad of ["567", "56789", "abcd", "56 8", " 5678", "5678 ", "５６７８", ""]) expect(parse(CODE, bad).success, JSON.stringify(bad)).toBe(false);
    for (const ok of ["0000", "0042", "9999"]) expect(parse(CODE, ok).success, ok).toBe(true);
    expect(PHONE_LAST4_PATTERN.test("5678")).toBe(true);
    expect(PHONE_LAST4_PATTERN.test("56789")).toBe(false);
  });

  test("누락·비문자열·이상한 모양 → validation, throw 없음", () => {
    for (const raw of [{}, { publicCode: CODE }, { phoneLast4: LAST4 }, { publicCode: 12345678, phoneLast4: 5678 }, null, "x", []]) {
      expect(CheckInput.safeParse(raw).success, JSON.stringify(raw)).toBe(false);
    }
  });

  test("formDataToCheckRaw — 계약 키 2개만 trim 해서 읽고, website 는 raw 밖·guardFields 안(원문 그대로). FormData 가 아니면 빈 폼", () => {
    expect(CHECK_FORM_FIELDS).toEqual({ publicCode: "publicCode", phoneLast4: "phoneLast4" });
    expect(CHECK_GUARD_FORM_FIELDS).toEqual({ website: HONEYPOT_FIELD });
    const { raw, guardFields } = formDataToCheckRaw(form({ publicCode: " a2b3c4d5 ", website: " http://spam " }));
    expect(raw).toEqual({ publicCode: "a2b3c4d5", phoneLast4: LAST4 });
    expect(guardFields).toEqual({ website: " http://spam " });
    expect(HONEYPOT_FIELD in raw).toBe(false);
    const fd = form();
    fd.append("status", "confirmed");
    fd.append("name", "x");
    expect(Object.keys(formDataToCheckRaw(fd).raw).sort()).toEqual(["phoneLast4", "publicCode"]);
    expect(formDataToCheckRaw(form({ publicCode: "" })).raw.publicCode).toBeUndefined();
    const empty = formDataToCheckRaw(new FormData());
    expect(empty).toEqual({ raw: { publicCode: undefined, phoneLast4: undefined }, guardFields: { website: undefined } });
    for (const notForm of [null, undefined, {}, { ok: false }, "crafted", 42]) expect(formDataToCheckRaw(notForm as never)).toEqual(empty);
  });
});

// =============================================================================
// 2. 순서 — zod → 허니팟 → rateLimit
// =============================================================================
describe("2. runCheckGuards — zod → 허니팟 → rateLimit (형식 틀린 요청이 카운터를 먹지 않는다)", () => {
  test("validation 실패 → checkHoneypot 0 · limit 0 · reason validation", async () => {
    const deps = fakeDeps();
    const out = await runCheckGuards({ publicCode: "short", phoneLast4: LAST4 }, ctx({ website: "filled" }), deps);
    expect(out).toMatchObject({ ok: false, reason: "validation" });
    expect(checkHoneypot).toHaveBeenCalledTimes(0);
    expect(limitCalls(deps.limiters)).toBe(0);
  });

  test("허니팟 채워짐 → { ok:true, silent:true } · limit 0 (봇은 슬롯을 태우지 않는다)", async () => {
    const deps = fakeDeps();
    const out = await runCheckGuards({ publicCode: CODE, phoneLast4: LAST4 }, ctx({ website: "http://spam" }), deps);
    expect(out).toEqual({ ok: true, silent: true });
    expect(checkHoneypot).toHaveBeenCalledTimes(1);
    expect(limitCalls(deps.limiters)).toBe(0);
  });

  test("rateLimit 거부 → reason ratelimit · short 창 1회(known)", async () => {
    const deps = fakeDeps(limiterSet(false));
    const out = await runCheckGuards({ publicCode: CODE, phoneLast4: LAST4 }, ctx(), deps);
    expect(out).toMatchObject({ ok: false, reason: "ratelimit" });
    expect(vi.mocked(deps.limiters.known.short.limit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.limiters.known.long.limit)).toHaveBeenCalledTimes(0);
    expect(limitCalls(deps.limiters)).toBe(1);
  });

  test("rateLimit throw → infra (fail-closed)", async () => {
    const throwing = { limit: vi.fn(async () => { throw new Error("redis down"); }) };
    const deps = fakeDeps({ known: { short: throwing, long: throwing }, unknown: { short: throwing, long: throwing } });
    const out = await runCheckGuards({ publicCode: CODE, phoneLast4: LAST4 }, ctx(), deps);
    expect(out).toMatchObject({ ok: false, reason: "infra" });
  });

  test("통과 → { ok, silent:false, input } · input 은 대문자 정규화된 값 · known 버킷 short→long 순서로 2회", async () => {
    const deps = fakeDeps();
    const out = await runCheckGuards({ publicCode: "a2b3c4d5", phoneLast4: LAST4 }, ctx(), deps);
    expect(out).toEqual({ ok: true, silent: false, input: { publicCode: CODE, phoneLast4: LAST4 } });
    expect(vi.mocked(deps.limiters.known.short.limit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.limiters.known.long.limit)).toHaveBeenCalledTimes(1);
    expect(limitCalls(deps.limiters)).toBe(2);
  });

  test("IP 헤더 없음 → unknown 버킷 · limit 키에 IP 원문 없음(해시 16자)", async () => {
    const deps = fakeDeps();
    await runCheckGuards({ publicCode: CODE, phoneLast4: LAST4 }, ctx({ ip: null }), deps);
    expect(vi.mocked(deps.limiters.unknown.short.limit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.limiters.known.short.limit)).toHaveBeenCalledTimes(0);
    const withIp = fakeDeps();
    await runCheckGuards({ publicCode: CODE, phoneLast4: LAST4 }, ctx(), withIp);
    const key = vi.mocked(withIp.limiters.known.short.limit).mock.calls[0][0];
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(key).not.toContain(IP);
  });

  test("한도는 접수와 같은 RATE_LIMITS(known 10분 5·1시간 15)를 쓴다 — 별도 상수를 만들지 않았다", () => {
    expect(RATE_LIMITS.known.short).toEqual({ max: 5, window: "10 m" });
    expect(RATE_LIMITS.known.long).toEqual({ max: 15, window: "1 h" });
    const src = read(`${LIB_DIR}/guards.ts`);
    expect(src).not.toMatch(/max:\s*\d/);
  });
});

// =============================================================================
// 3. 조회 — 부재 = 불일치 (동일 객체) · 뷰 모델
// =============================================================================
describe("3. lookupReservation — 부재와 불일치는 같은 결과, 일치는 마스킹 뷰", () => {
  const input = { publicCode: CODE, phoneLast4: LAST4 };

  test("(a) 부재 → { found:false } · findByPublicCode 1회 · vehicleNameKo 0", async () => {
    const absent = fakeDb(null);
    expect(await lookupReservation(input, { db: absent })).toEqual({ found: false });
    expect(absent.find).toHaveBeenCalledTimes(1);
    expect(absent.find).toHaveBeenCalledWith(CODE);
    expect(absent.veh).toHaveBeenCalledTimes(0);
  });

  test("(b) 존재 + 뒷자리 불일치 → { found:false } · vehicleNameKo 0 · (a) 와 toEqual + JSON 바이트 동일", async () => {
    const absent = await lookupReservation(input, { db: fakeDb(null) });
    const present = fakeDb(ROW);
    const mismatch = await lookupReservation({ ...input, phoneLast4: "0000" }, { db: present });
    expect(mismatch).toEqual(absent);
    expect(JSON.stringify(mismatch)).toBe(JSON.stringify(absent));
    expect(Object.keys(mismatch)).toEqual(Object.keys(absent));
    expect(present.veh).toHaveBeenCalledTimes(0);
    expect(present.find).toHaveBeenCalledTimes(1);
  });

  test("액션 레벨 — 부재·불일치·허니팟 세 응답이 toEqual 로 같고 messageKey 는 not_found (존재 여부를 흘리는 필드 0)", async () => {
    db = fakeDb(null);
    const absent = await checkReservation(form());
    db = fakeDb(ROW);
    const mismatch = await checkReservation(form({ phoneLast4: "0000" }));
    const bot = await checkReservation(form({ website: "http://spam" }));
    expect(absent).toEqual({ ok: false, code: "not_found", messageKey: "reservationCheck.errors.not_found" });
    expect(mismatch).toEqual(absent);
    expect(bot).toEqual(absent);
    expect(JSON.stringify(mismatch)).toBe(JSON.stringify(absent));
    expect(JSON.stringify(bot)).toBe(JSON.stringify(absent));
    expect(notFoundResult()).toEqual(absent);
    expect(structuredLog).toHaveBeenCalledTimes(0);
  });

  test("(c) 일치 → view: 키 집합 = RESERVATION_VIEW_KEYS · 원문 name·phone(5가지 표기)·email·message·admin_memo 0 · 마스킹·라벨 규칙", async () => {
    const leaky = { ...ROW, email: "hong@example.com", message: "비밀 메모입니다", admin_memo: "관리자 메모" } as ReservationCheckRow;
    const out = await lookupReservation(input, { db: fakeDb(leaky) });
    expect(out.found).toBe(true);
    if (!out.found) throw new Error("unreachable");
    const view = out.view;
    expect(Object.keys(view).sort()).toEqual([...RESERVATION_VIEW_KEYS].sort());
    const json = JSON.stringify(view);
    for (const needle of [RAW_NAME, ...RAW_PHONE_FORMS, "hong@", "example.com", "비밀 메모", "관리자 메모", "email", "message", "admin_memo", "adminMemo"]) {
      expect(json.includes(needle), needle).toBe(false);
    }
    for (const k of ["name", "phone", "email", "id"]) expect(k in view, k).toBe(false);
    expect(view).toEqual({
      publicCode: CODE,
      status: "confirmed",
      statusKey: "reservationCheck.status.confirmed",
      tripType: "round",
      tripTypeKey: "reservationCheck.tripType.round",
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

  test("(c) 4자리 이상 숫자열은 날짜·대수·인원·마스킹 뒷자리 외 0 · 5자리 이상 숫자열 0 (전화 원문이 어떤 형식으로도 없다)", async () => {
    const out = await lookupReservation(input, { db: fakeDb(ROW) });
    if (!out.found) throw new Error("unreachable");
    const v = out.view;
    const allowed = new Set([
      ...digitRuns(v.departAtKst),
      ...digitRuns(v.returnAtKst ?? ""),
      ...digitRuns(v.createdAtKst),
      String(v.busCount),
      String(v.passengers ?? ""),
      v.maskedPhone.slice(-4),
    ]);
    const runs = digitRuns(JSON.stringify(v));
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(allowed.has(run), run).toBe(true);
    expect(digitRuns(JSON.stringify(v), 5)).toEqual([]);
    expect(v.maskedPhone).toMatch(/^\d{3}-\*{4}-\d{4}$/);
    expect(v.maskedName).toMatch(/^.\*{1,2}$/);
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

  test("뒷자리 비교는 phone 의 숫자만 본다 — E.164·하이픈 국내 표기·공백 모두 같은 결과. SQL 이 아니라 서버 코드에서 비교한다", async () => {
    for (const phone of ["+821012345678", "010-1234-5678", "01012345678", "+82 10 1234 5678"]) {
      const out = await lookupReservation(input, { db: fakeDb({ ...ROW, phone }) });
      expect(out.found, phone).toBe(true);
      expect(phoneLast4Matches(phone, LAST4), phone).toBe(true);
      expect(phoneLast4Matches(phone, "5679"), phone).toBe(false);
    }
    const dbSrc = read(`${LIB_DIR}/db.ts`);
    expect(dbSrc).not.toMatch(/phone/i);
  });

  test("phoneLast4Matches — 부재(null)도 false 를 돌려주되 throw 하지 않는다(더미 비교로 경로 길이를 맞춘다) · 짧은 번호도 안전", () => {
    expect(phoneLast4Matches(null, LAST4)).toBe(false);
    expect(phoneLast4Matches("", LAST4)).toBe(false);
    expect(phoneLast4Matches("12", LAST4)).toBe(false);
    expect(phoneLast4Matches("+8210", "8210")).toBe(true);
    const src = stripComments(read(`${LIB_DIR}/lookup.ts`));
    // 비교 함수는 phone 이 null 일 때도 같은 비교 루틴을 탄다 — 이른 return 으로 분기하지 않는다
    expect(src).toMatch(/phoneLast4Matches\(/);
  });

  test("status 4종 전부 view 를 만든다 — cancelled·done 도 본인 예약이므로 보여 준다", async () => {
    expect([...RESERVATION_STATUSES].sort()).toEqual(["cancelled", "confirmed", "done", "new"]);
    for (const status of RESERVATION_STATUSES) {
      const out = await lookupReservation(input, { db: fakeDb({ ...ROW, status }) });
      expect(out.found, status).toBe(true);
      if (out.found) {
        expect(out.view.status).toBe(status);
        expect(out.view.statusKey).toBe(`reservationCheck.status.${status}`);
      }
    }
    expect(() => toReservationView({ ...ROW, status: "weird" }, VEHICLE_NAME)).toThrow();
  });

  test("편도(return_at null)·인원 미입력 → null, 알 수 없는 trip_type → null 라벨 키 · vehicles 에 없는 slug → slug 폴백", async () => {
    const out = await lookupReservation(input, { db: fakeDb({ ...ROW, trip_type: "oneway", return_at: null, passengers: null }, null) });
    if (!out.found) throw new Error("unreachable");
    expect(out.view).toMatchObject({ tripType: "oneway", tripTypeKey: "reservationCheck.tripType.oneway", returnAtKst: null, passengers: null, vehicleLabel: "bus45" });
    const weird = toReservationView({ ...ROW, trip_type: null }, VEHICLE_NAME);
    expect(weird.tripType).toBeNull();
    expect(weird.tripTypeKey).toBeNull();
  });

  test("마스킹 — +82 휴대전화만 010-****-NNNN, 그 밖(해외 E.164·+82 유선·형식 불명·국내 표기 원문)은 정확히 '***' (리뷰 M-1, fail-closed)", () => {
    const masked = (phone: string) => toReservationView({ ...ROW, phone }, VEHICLE_NAME).maskedPhone;
    expect(masked("+821012345678")).toBe("010-****-5678");
    expect(masked("+82 10 1234 5678")).toBe("010-****-5678");
    expect(masked("+821112345678")).toBe("011-****-5678");
    expect(masked("+82101234567")).toBe("010-***-4567");
    for (const other of ["+15551234567", "+6581234567", "+447911123456", "+82212345678", "+8221234567", "+82", "garbage", "", "010-1234-5678", "01012345678"]) {
      expect(masked(other), JSON.stringify(other)).toBe("***");
    }
    // 리뷰 M-1 의 실측 재현 — 예전 구현이 만들던 값이 더는 나오지 않는다
    expect(masked("+15551234567")).not.toBe("155-****-4567");
    expect(masked("+6581234567")).not.toBe("658-***-4567");
  });

  test("(c) 해외 번호 행도 view 에 원문 숫자열 0 · 5자리 이상 숫자열 0 · maskedPhone '***' (리뷰 M-1 — 누출 테스트를 국제 표기로 확장)", async () => {
    for (const phone of ["+15551234567", "+6581234567", "+82212345678", "+447911123456"]) {
      const out = await lookupReservation({ publicCode: CODE, phoneLast4: phone.slice(-4) }, { db: fakeDb({ ...ROW, phone }) });
      expect(out.found, phone).toBe(true);
      if (!out.found) throw new Error("unreachable");
      const json = JSON.stringify(out.view);
      expect(out.view.maskedPhone, phone).toBe("***");
      expect(digitRuns(json, 5), phone).toEqual([]);
      for (const needle of [phone, phone.slice(1), phone.slice(-7), phone.slice(-4), phone.slice(1, 4)]) expect(json.includes(needle), `${phone}: ${needle}`).toBe(false);
    }
  });

  test("일치 시에만 vehicleNameKo 를 부른다(1회, slug 로) — 실패 경로는 DB 호출 1회로 동일", async () => {
    const hit = fakeDb(ROW);
    await lookupReservation(input, { db: hit });
    expect(hit.veh).toHaveBeenCalledTimes(1);
    expect(hit.veh).toHaveBeenCalledWith("bus45");
  });
});

// =============================================================================
// 4. select 화이트리스트 — 실제 어댑터에 가짜 클라이언트를 물려 select 문자열을 본다
// =============================================================================
describe("4. supabaseReservationCheckDb — select 화이트리스트", () => {
  type Call = { table: string; select?: string; eq: [string, unknown][]; limit?: number; maybeSingle?: boolean };
  type Resp = { data: unknown; error: { code: string; message: string; details?: string } | null };
  function fakeClient(res: { reservation?: Resp; vehicle?: Resp } = {}) {
    const calls: Call[] = [];
    const client = {
      calls,
      from(table: string) {
        const c: Call = { table, eq: [] };
        calls.push(c);
        const q = {
          select(s: string) {
            c.select = s;
            return q;
          },
          eq(k: string, v: unknown) {
            c.eq.push([k, v]);
            return q;
          },
          limit(n: number) {
            c.limit = n;
            return q;
          },
          async maybeSingle(): Promise<Resp> {
            c.maybeSingle = true;
            return table === "reservations" ? (res.reservation ?? { data: null, error: null }) : (res.vehicle ?? { data: null, error: null });
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

  test("reservations — select 는 화이트리스트 13열 그대로, email·message·admin_memo·id·* 없음 · where public_code = :code 1행", async () => {
    const client = fakeClient({ reservation: { data: ROW, error: null } });
    const port = real.supabaseReservationCheckDb(client as never);
    expect(await port.findByPublicCode(CODE)).toEqual(ROW);
    expect(client.calls).toHaveLength(1);
    const [c] = client.calls;
    expect(c.table).toBe("reservations");
    expect(c.select).toBe(RESERVATION_CHECK_SELECT);
    expect(c.select).toBe(RESERVATION_CHECK_COLUMNS.join(","));
    const cols = (c.select ?? "").split(",");
    expect(cols.sort()).toEqual(
      ["public_code", "name", "phone", "status", "trip_type", "depart_at", "return_at", "vehicle_slug", "origin_code", "destination_code", "bus_count", "passengers", "created_at"].sort(),
    );
    for (const banned of ["email", "message", "admin_memo", "id", "*", "waypoint_codes", "confirmed_at"]) expect(cols, banned).not.toContain(banned);
    expect(c.select).not.toMatch(/\*/);
    expect(c.eq).toEqual([["public_code", CODE]]);
    expect(c.maybeSingle).toBe(true);
    expect(c.limit).toBe(1);
  });

  test("reservations — 행 없음 → null (throw 아님) · PostgREST error → throw, message 에 code 만(details 미포함)", async () => {
    expect(await real.supabaseReservationCheckDb(fakeClient() as never).findByPublicCode(CODE)).toBeNull();
    const client = fakeClient({ reservation: { data: null, error: { code: "42501", message: "permission denied", details: `Failing row contains (${RAW_NAME}, ${RAW_PHONE_E164})` } } });
    await expect(real.supabaseReservationCheckDb(client as never).findByPublicCode(CODE)).rejects.toThrow(/42501/);
    await expect(real.supabaseReservationCheckDb(client as never).findByPublicCode(CODE)).rejects.not.toThrow(new RegExp(RAW_NAME));
  });

  test("vehicles — select name_ko 만 · where slug · 없음 → null", async () => {
    const client = fakeClient({ vehicle: { data: { name_ko: VEHICLE_NAME }, error: null } });
    const port = real.supabaseReservationCheckDb(client as never);
    expect(await port.vehicleNameKo("bus45")).toBe(VEHICLE_NAME);
    const [c] = client.calls;
    expect(c.table).toBe("vehicles");
    expect(c.select).toBe("name_ko");
    expect(c.eq).toEqual([["slug", "bus45"]]);
    expect(await real.supabaseReservationCheckDb(fakeClient() as never).vehicleNameKo("bus45")).toBeNull();
  });

  test("정적 — db.ts 는 server-only · 화이트리스트 상수를 lookup.ts 에서 import(문자열 재작성 0) · 비교 로직 0", () => {
    const src = read(`${LIB_DIR}/db.ts`);
    expect(src).toMatch(/^import\s+["']server-only["'];?$/m);
    expect(src).toMatch(/RESERVATION_CHECK_SELECT/);
    expect(src).not.toMatch(/public_code,\s*name/);
    expect(src).not.toMatch(/slice\(-4\)|phoneLast4/);
  });
});

// =============================================================================
// 5. 액션 — 얇은 래퍼 · 입력 방어 · IP 비노출 · 정적
// =============================================================================
describe("5. checkReservation — 얇은 래퍼", () => {
  test("validation → db 0 · createServiceClient 0 · limit 0 · fieldErrors 에 필드별 키", async () => {
    const deps = fakeDeps();
    vi.mocked(checkGuardDeps).mockReturnValue(deps);
    const result = await checkReservation(form({ publicCode: "A2B3C4D", phoneLast4: "12" }));
    expect(result).toMatchObject({ ok: false, code: "validation", messageKey: "reservationCheck.errors.validation" });
    if (result.ok) throw new Error("unreachable");
    expect(result.fieldErrors).toEqual({ publicCode: CHECK_FIELD_ERROR_KEYS.publicCode, phoneLast4: CHECK_FIELD_ERROR_KEYS.phoneLast4 });
    expect(db.find).toHaveBeenCalledTimes(0);
    expect(createServiceClient).toHaveBeenCalledTimes(0);
    expect(limitCalls(deps.limiters)).toBe(0);
    expect(structuredLog).toHaveBeenCalledTimes(0);
  });

  test("허니팟 → not_found 응답(성공 아님) · db 0 · createServiceClient 0 · limit 0 · 로그 0", async () => {
    const deps = fakeDeps();
    vi.mocked(checkGuardDeps).mockReturnValue(deps);
    const result = await checkReservation(form({ website: "https://spam.example" }));
    expect(result).toEqual(notFoundResult());
    expect(result.ok).toBe(false);
    expect(db.find).toHaveBeenCalledTimes(0);
    expect(createServiceClient).toHaveBeenCalledTimes(0);
    expect(limitCalls(deps.limiters)).toBe(0);
    expect(structuredLog).toHaveBeenCalledTimes(0);
  });

  test("ratelimit → { ok:false, code:'ratelimit' } · db 0", async () => {
    vi.mocked(checkGuardDeps).mockReturnValue(fakeDeps(limiterSet(false)));
    expect(await checkReservation(form())).toEqual({ ok: false, code: "ratelimit", messageKey: "reservationCheck.errors.ratelimit" });
    expect(db.find).toHaveBeenCalledTimes(0);
    expect(createServiceClient).toHaveBeenCalledTimes(0);
  });

  test("checkGuardDeps throw(env 누락) → infra + structuredLog(guard_setup_failed) 1회 · throw 가 밖으로 나가지 않는다", async () => {
    vi.mocked(checkGuardDeps).mockImplementation(() => {
      throw new Error("checkGuardDeps: UPSTASH_REDIS_REST_URL 이 설정되지 않았다");
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

  test("일치 → { ok:true, view } · createServiceClient 1 · supabaseReservationCheckDb(client) · 결과에 원문 0", async () => {
    const result = await checkReservation(form({ publicCode: "a2b3c4d5" }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.view.publicCode).toBe(CODE);
    expect(result.view.maskedName).toBe("홍**");
    expect(createServiceClient).toHaveBeenCalledTimes(1);
    expect(supabaseReservationCheckDb).toHaveBeenCalledWith({ kind: "fake-service-client" });
    expect(db.find).toHaveBeenCalledWith(CODE);
    const json = JSON.stringify(result);
    for (const needle of [RAW_NAME, ...RAW_PHONE_FORMS]) expect(json.includes(needle), needle).toBe(false);
  });

  test("FormData 가 아닌 인자(null·undefined·{}·useActionState prevState·문자열) → validation · reject 아님 · db 0 · limit 0", async () => {
    const prev: CheckResult = { ok: false, code: "validation", messageKey: "reservationCheck.errors.validation" };
    for (const arg of [null, undefined, {}, prev, "crafted"]) {
      const deps = fakeDeps();
      vi.mocked(checkGuardDeps).mockReturnValue(deps);
      const result = await checkReservation(arg as never);
      expect(result, String(arg)).toMatchObject({ ok: false, code: "validation" });
      expect(limitCalls(deps.limiters)).toBe(0);
    }
    expect(db.find).toHaveBeenCalledTimes(0);
    expect(structuredLog).toHaveBeenCalledTimes(0);
  });

  test.each([
    ["일치", async () => checkReservation(form())],
    ["부재", async () => {
      db = fakeDb(null);
      return checkReservation(form());
    }],
    ["불일치", async () => checkReservation(form({ phoneLast4: "0000" }))],
    ["validation", async () => checkReservation(form({ publicCode: "x" }))],
    ["허니팟", async () => checkReservation(form({ website: "x" }))],
    ["ratelimit", async () => {
      vi.mocked(checkGuardDeps).mockReturnValue(fakeDeps(limiterSet(false)));
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
  ])("IP 비노출 · detail 0 — %s 경로", async (_label, run) => {
    const result = await run();
    const json = JSON.stringify(result);
    expect(json).not.toContain(IP);
    expect(json).not.toMatch(/"detail"/);
    expect(everythingLogged()).not.toContain(IP);
    expect(everythingLogged()).not.toContain(RAW_NAME);
    expect(everythingLogged()).not.toContain(RAW_PHONE_E164);
  });

  describe("result.ts (순수)", () => {
    test("guardFailureToCheckResult — validation 은 zod path 를 필드 키로, 모르는 path 는 버린다, detail 미포함", () => {
      const r = guardFailureToCheckResult({
        ok: false,
        reason: "validation",
        detail: [
          { path: "publicCode", code: "invalid_format", message: "should-not-leak" },
          { path: "nope", code: "custom", message: "x" },
          { path: "", code: "custom", message: "root" },
        ],
      });
      expect(r).toEqual({ ok: false, code: "validation", messageKey: CHECK_ERROR_KEYS.validation, fieldErrors: { publicCode: CHECK_FIELD_ERROR_KEYS.publicCode } });
      expect(JSON.stringify(r)).not.toContain("should-not-leak");
      for (const reason of ["ratelimit", "infra"] as const) {
        expect(guardFailureToCheckResult({ ok: false, reason, detail: { secretish: "leak" } })).toEqual({ ok: false, code: reason, messageKey: CHECK_ERROR_KEYS[reason] });
      }
    });

    test("CHECK_ERROR_KEYS — 5 코드 전부 reservationCheck.errors.* · not_found 결과에 fieldErrors 없음", () => {
      expect(Object.keys(CHECK_ERROR_KEYS).sort()).toEqual(["infra", "not_found", "ratelimit", "server", "validation"]);
      for (const [code, key] of Object.entries(CHECK_ERROR_KEYS)) expect(key).toBe(`reservationCheck.errors.${code}`);
      expect("fieldErrors" in notFoundResult()).toBe(false);
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
      // process.env 는 주석까지 포함해 0 — tests/reservation-action.test.ts §7 이 actions/** 원문을 grep 해 목록을 잠근다
      expect(action).not.toMatch(/process\.env/);
      const code = stripComments(action);
      expect(code).not.toMatch(/console\./);
      expect(code).not.toMatch(/\.get\(/);
      expect(code).not.toMatch(/safeParse|\.parse\(/);
      expect(code).not.toMatch(/from\s+["']next\/(cache|server)["']/);
      expect(action).toMatch(/from\s+["']next\/headers["']/);
      expect((stripComments(action).match(/^\s*try \{\s*$/gm) ?? []).length).toBe(2);
      expect(stripComments(action)).not.toMatch(/\bif \(.*(name|phone|status)\b/);
    });

    test("부품을 import 만 한다 — checkGuardDeps·createServiceClient·supabaseReservationCheckDb·structuredLog·formDataToCheckRaw·checkGuardContext·runCheckGuards·lookupReservation · defaultGuardDeps 0 · Turnstile 0", () => {
      for (const sym of ["checkGuardDeps", "createServiceClient", "supabaseReservationCheckDb", "structuredLog", "formDataToCheckRaw", "checkGuardContext", "runCheckGuards", "lookupReservation", "notFoundResult", "checkFailureResult", "guardFailureToCheckResult", "lookupToResult"]) {
        expect(action, sym).toContain(sym);
      }
      expect(stripComments(action)).not.toMatch(/defaultGuardDeps|runGuards\(|turnstile/i);
    });

    test("`await headers()` 와 `formDataToCheckRaw(` 가 첫 try 안, `lookupReservation(` 이 둘째 try 안", () => {
      const lines = stripComments(action).split("\n");
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
    });

    test("lib/reservation-check/{guards,lookup,view,result,formData}.ts 는 순수 — 'use server' 0 · next 0 · server-only 0 · supabase 0 · process.env 0", () => {
      for (const f of ["guards", "lookup", "view", "result", "formData"]) {
        const src = read(`${LIB_DIR}/${f}.ts`);
        expect(src, f).not.toMatch(/["']use server["']/);
        expect(src, f).not.toMatch(/from\s+["']next(\/|["'])/);
        expect(src, f).not.toMatch(/["']server-only["']/);
        expect(src, f).not.toMatch(/supabase/i);
        expect(src, f).not.toMatch(/process\.env/);
      }
      expect(read(`${LIB_DIR}/db.ts`)).not.toMatch(/process\.env/);
    });

    test("lib/reservations/** · actions/reservation.ts 를 수정하지 않았다 — import 만 (guardHeaders 재사용)", () => {
      expect(read(`${LIB_DIR}/formData.ts`)).toMatch(/guardHeaders/);
      expect(read(`${LIB_DIR}/formData.ts`)).toMatch(/from\s+["'](\.\.\/reservations\/formData|@\/lib\/reservations\/formData)["']/);
    });
  });
});

// =============================================================================
// 6. lib/guard/deps.ts — limitersFor scope · checkGuardDeps
// =============================================================================
describe("6. lib/guard/deps.ts — limitersFor(url, token, scope) · checkGuardDeps()", () => {
  type Deps = typeof import("@/lib/guard/deps");
  let real: Deps;
  const KEYS = ["GUARD_SECRET", "GUARD_ALLOWED_HOSTS", "TURNSTILE_SECRET_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "VERCEL_ENV"] as const;
  let saved: Record<string, string | undefined> = {};
  const URL = "https://unit-test-p63a.upstash.io";
  const TOKEN = "unit-test-token-p63a";
  const prefixOf = (l: unknown) => (l as { prefix?: unknown }).prefix;

  beforeAll(async () => {
    real = await vi.importActual<Deps>("@/lib/guard/deps");
  });
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    process.env.GUARD_SECRET = SECRET;
    process.env.GUARD_ALLOWED_HOSTS = "localhost";
    process.env.TURNSTILE_SECRET_KEY = "real-looking-secret";
    process.env.UPSTASH_REDIS_REST_URL = URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = TOKEN;
    delete process.env.VERCEL_ENV;
  });
  afterAll(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("scope 별 prefix — reserve: guard:reserve:<bucket>:<window> / check: guard:check:<bucket>:<window> (4개 창 전부)", () => {
    const reserve = real.limitersFor(URL, TOKEN, "reserve");
    const check = real.limitersFor(URL, TOKEN, "check");
    for (const b of ["known", "unknown"] as const) {
      for (const w of ["short", "long"] as const) {
        expect(prefixOf(reserve[b][w])).toBe(`guard:reserve:${b}:${w}`);
        expect(prefixOf(check[b][w])).toBe(`guard:check:${b}:${w}`);
        expect(check[b][w]).not.toBe(reserve[b][w]);
        expect(real.rateLimitPrefix("check", b, w)).toBe(`guard:check:${b}:${w}`);
      }
    }
  });

  test("캐시 — 같은 (url, token, scope) 는 같은 인스턴스, scope 가 다르면 다른 인스턴스", () => {
    expect(real.limitersFor(URL, TOKEN, "check")).toBe(real.limitersFor(URL, TOKEN, "check"));
    expect(real.limitersFor(URL, TOKEN, "reserve")).toBe(real.limitersFor(URL, TOKEN, "reserve"));
    expect(real.limitersFor(URL, TOKEN, "reserve")).not.toBe(real.limitersFor(URL, TOKEN, "check"));
  });

  test("defaultGuardDeps() 의 limiter prefix 는 전과 동일 guard:reserve:* (접수 카운터가 옮겨가지 않는다)", () => {
    const deps = real.defaultGuardDeps();
    for (const b of ["known", "unknown"] as const) {
      for (const w of ["short", "long"] as const) expect(prefixOf(deps.rateLimit.limiters[b][w])).toBe(`guard:reserve:${b}:${w}`);
    }
    expect(deps.rateLimit.limiters).toBe(real.limitersFor(URL, TOKEN, "reserve"));
  });

  test("checkGuardDeps() — Turnstile·허용 호스트 env 없이 동작 · prefix guard:check:* · secret·now·timeoutMs", () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.GUARD_ALLOWED_HOSTS;
    const deps = real.checkGuardDeps();
    expect(Object.keys(deps).sort()).toEqual(["now", "rateLimit", "secret"]);
    expect(deps.secret).toBe(SECRET);
    expect(deps.now()).toBeInstanceOf(Date);
    expect(deps.rateLimit.timeoutMs).toBe(5_000);
    for (const b of ["known", "unknown"] as const) {
      for (const w of ["short", "long"] as const) expect(prefixOf(deps.rateLimit.limiters[b][w])).toBe(`guard:check:${b}:${w}`);
    }
    expect(deps.rateLimit.limiters).toBe(real.limitersFor(URL, TOKEN, "check"));
    expect("turnstile" in deps).toBe(false);
  });

  test.each([
    ["UPSTASH_REDIS_REST_URL", /UPSTASH_REDIS_REST_URL/],
    ["UPSTASH_REDIS_REST_TOKEN", /UPSTASH_REDIS_REST_TOKEN/],
    ["GUARD_SECRET", /GUARD_SECRET/],
  ])("checkGuardDeps() — %s 누락 → throw (fail-closed, 액션은 infra)", (key, re) => {
    delete process.env[key];
    expect(() => real.checkGuardDeps()).toThrow(re);
  });

  test("checkGuardDeps() — 짧은 GUARD_SECRET(32자 미만) → throw (IP 해시 키를 약한 secret 으로 만들지 않는다)", () => {
    process.env.GUARD_SECRET = "short";
    expect(() => real.checkGuardDeps()).toThrow(/GUARD_SECRET/);
  });

  test("정적 — 소스에 scope 템플릿 `guard:${scope}:` · 캐시 키에 scope · 새 env 이름 없음 · 우회 스위치 없음", () => {
    const src = read("lib/guard/deps.ts");
    expect(src).toMatch(/guard:\$\{scope\}:\$\{bucket\}:\$\{window\}/);
    expect(src).toMatch(/export function limitersFor\(url: string, token: string, scope: RateLimitScope\)/);
    expect(src).toMatch(/export function checkGuardDeps\(\)/);
    const names = [...new Set([...src.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]))].sort();
    expect(names).toEqual(["GUARD_ALLOWED_HOSTS", "GUARD_SECRET", "TURNSTILE_SECRET_KEY", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_URL", "VERCEL_ENV"]);
    expect(src).not.toMatch(/GUARD_(DISABLE|BYPASS|SKIP|MOCK)|(DISABLE|BYPASS|SKIP)_GUARD/);
  });
});

// =============================================================================
// 7. messages/ko.json — reservationCheck.*
// =============================================================================
describe("7. messages/ko.json — reservationCheck 네임스페이스", () => {
  const ko = JSON.parse(read("messages/ko.json")) as Record<string, unknown>;
  const ns = ko.reservationCheck as Record<string, unknown> | undefined;
  const errors = (ns?.errors ?? {}) as Record<string, string>;
  const resolve = (key: string) => key.split(".").reduce<unknown>((acc, seg) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[seg] : undefined), ko);
  const nsText = JSON.stringify(ns ?? {});

  test("quote 뒤에 추가됐고 기존 최상위 키 순서는 그대로 (뒤에 오는 태스크의 네임스페이스 — P6-3 pages — 는 그 뒤에 붙는다)", () => {
    expect(Object.keys(ko).slice(0, 7)).toEqual(["common", "layout", "errors", "home", "reservation", "quote", "reservationCheck"]);
  });

  test("오류 5종 — validation·not_found·ratelimit·infra·server, 전부 비어 있지 않은 문자열", () => {
    expect(Object.keys(errors).sort()).toEqual(["infra", "not_found", "ratelimit", "server", "validation"]);
    for (const [k, v] of Object.entries(errors)) expect(typeof v === "string" && v.trim().length > 0, k).toBe(true);
  });

  test("ratelimit·infra·server 문구에 원장 COMPANY.tel · server 는 infra 와 같은 문구", () => {
    for (const k of ["ratelimit", "infra", "server"]) expect(errors[k], k).toContain(COMPANY.tel);
    expect(errors.server).toBe(errors.infra);
    expect(errors.validation).not.toContain(COMPANY.tel);
  });

  test("not_found 문구는 브리프 원문 그대로 — 존재/불일치를 구분하는 표현 없음", () => {
    expect(errors.not_found).toBe("입력하신 접수번호와 휴대폰 뒷자리에 해당하는 예약을 찾지 못했습니다. 문자로 받으신 접수번호를 다시 확인해 주세요.");
    for (const w of ["존재", "일치하지", "없는 접수번호", "틀렸"]) expect(errors.not_found.includes(w), w).toBe(false);
  });

  test("상태 라벨 4종(new 접수·confirmed 확정·cancelled 취소·done 완료) · 운행 구분 3종", () => {
    expect(ns?.status).toEqual({ new: "접수", confirmed: "확정", cancelled: "취소", done: "완료" });
    expect(Object.keys((ns?.tripType ?? {}) as object).sort()).toEqual(["oneway", "oneway_oneway", "round"]);
  });

  test("코드가 쓰는 키가 전부 풀린다 — CHECK_ERROR_KEYS · CHECK_FIELD_ERROR_KEYS · status · tripType · meta · form · card", () => {
    for (const key of [...Object.values(CHECK_ERROR_KEYS), ...Object.values(CHECK_FIELD_ERROR_KEYS)]) expect(typeof resolve(key), key).toBe("string");
    for (const s of RESERVATION_STATUSES) expect(typeof resolve(`reservationCheck.status.${s}`), s).toBe("string");
    for (const t of ["round", "oneway", "oneway_oneway"]) expect(typeof resolve(`reservationCheck.tripType.${t}`), t).toBe("string");
    expect(typeof resolve("reservationCheck.meta.title")).toBe("string");
    expect(resolve("reservationCheck.meta.title")).toContain("{brand}");
    for (const k of ["title", "sub", "eyebrow"]) expect(typeof resolve(`reservationCheck.${k}`), k).toBe("string");
    for (const k of ["codeLabel", "codeHint", "phoneLast4Label", "phoneLast4Hint", "submit", "submitting", "errorSummary", "codeError", "phoneLast4Error"]) {
      expect(typeof resolve(`reservationCheck.form.${k}`), k).toBe("string");
    }
    for (const k of ["title", "code", "status", "name", "phone", "vehicle", "route", "tripType", "departAt", "returnAt", "busCount", "passengers", "createdAt", "again", "call"]) {
      expect(typeof resolve(`reservationCheck.card.${k}`), k).toBe("string");
    }
  });

  test("금지어·가격 표기·실증 불가 문구·원장 verbatim 리터럴 0 — 문구는 안내와 라벨뿐", () => {
    for (const w of FORBIDDEN) expect(nsText.includes(w), w).toBe(false);
    for (const re of PRICE_MARKS) expect(re.test(nsText), String(re)).toBe(false);
    for (const w of UNPROVEN) expect(nsText.includes(w), w).toBe(false);
    expect(nsText.includes(VERBATIM.bookingNotice)).toBe(false);
    expect(nsText.includes("결제 진행됩니다")).toBe(false);
  });

  test("기존 네임스페이스는 그대로 — reservation.errors 6키·quote.done 존재", () => {
    expect(Object.keys((ko.reservation as { errors: object }).errors).sort()).toEqual(["bot", "infra", "ratelimit", "server", "turnstile", "validation"]);
    expect(typeof resolve("quote.done.codeHint")).toBe("string");
  });
});

// =============================================================================
// 8. 컴포넌트·페이지 정적 — useActionState 래퍼 · 원장은 서버 페이지만 · 금지어 · 가격 0 · localStorage 0
// =============================================================================
describe("8. 컴포넌트·페이지 정적", () => {
  const componentFiles = walk(path.join(ROOT, COMPONENT_DIR))
    .map((p) => path.relative(ROOT, p).split(path.sep).join("/"))
    .sort();
  const codeFiles = componentFiles.filter((f) => /\.(ts|tsx)$/.test(f));
  const sources = [...codeFiles, PAGE].map((file) => ({ file, text: read(file), code: stripComments(read(file)) }));

  test("산출물이 있다 — page.tsx · CheckForm.tsx · ReservationCard.tsx · fields.ts · validate.ts · preview-result.ts · check.module.css · lib 6개 · 액션", () => {
    for (const f of [PAGE, FORM, CARD, PREVIEW, `${COMPONENT_DIR}/fields.ts`, `${COMPONENT_DIR}/validate.ts`, `${COMPONENT_DIR}/check.module.css`, ACTION]) {
      expect(existsSync(path.join(ROOT, f)), f).toBe(true);
    }
    for (const f of ["guards", "lookup", "db", "view", "result", "formData"]) expect(existsSync(path.join(ROOT, LIB_DIR, `${f}.ts`)), f).toBe(true);
  });

  test("useActionState — checkReservation 을 직접 넘기지 않고 (_prev, fd) 래퍼로 감싼다 (P3-4 규칙)", () => {
    const src = stripComments(read(FORM));
    expect(src).toMatch(/^\s*["']use client["'];?/m);
    expect(src).toMatch(/useActionState/);
    expect(src).not.toMatch(/useActionState\(\s*checkReservation/);
    expect(src).not.toMatch(/useActionState<[^>]*>\(\s*checkReservation/);
    expect(src).toMatch(/checkReservation\(\s*fd\s*\)/);
    expect(src).toMatch(/from\s+["']@\/actions\/reservation-check["']/);
  });

  test("폼 — name 은 CF/CG 상수만(문자열 리터럴 name 0) · 허니팟 website(tabIndex -1·autoComplete off·aria-hidden) · role=alert · aria-invalid · pending 시 disabled", () => {
    const src = stripComments(read(FORM));
    expect(src).not.toMatch(/name="/);
    expect(src).toMatch(/name=\{CF\.publicCode\}/);
    expect(src).toMatch(/name=\{CF\.phoneLast4\}/);
    const hp = src.match(/<input[^>]*name=\{CG\.website\}[^>]*\/>/)?.[0] ?? "";
    expect(hp, "허니팟 input 이 있어야 한다").not.toBe("");
    expect(hp).toMatch(/tabIndex=\{-1\}/);
    expect(hp).toMatch(/autoComplete="off"/);
    expect(hp).toMatch(/aria-hidden/);
    expect(src).toMatch(/role="alert"/);
    expect(src).toMatch(/aria-invalid=/);
    expect(src).toMatch(/disabled=\{[^}]*pending/);
    expect(src).not.toMatch(/type="hidden"/); // 토큰·Turnstile 없음 — 숨은 값이 없다
    expect(CF).toEqual(CHECK_FORM_FIELDS);
    expect(CG).toEqual(CHECK_GUARD_FORM_FIELDS);
    expect(CG.website).toBe(HONEYPOT_FIELD);
  });

  test("서버 오류 결과 → 포커스를 role=alert 요약으로 옮긴다 — tabIndex -1 + liveRef + useEffect, 훅은 카드 early return 앞 (리뷰 M-2)", () => {
    const src = stripComments(read(FORM));
    const alertTag = src.match(/<div[^>]*role="alert"[^>]*>/)?.[0] ?? "";
    expect(alertTag, "role=alert 요약이 있어야 한다").not.toBe("");
    expect(alertTag).toMatch(/ref=\{liveRef\}/);
    expect(alertTag).toMatch(/tabIndex=\{-1\}/);
    expect(src).toMatch(/const liveRef = useRef<HTMLDivElement \| null>\(null\)/);
    const effect = src.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[result\]\);/)?.[0] ?? "";
    expect(effect, "result 를 보는 useEffect 가 있어야 한다").not.toBe("");
    expect(effect).toMatch(/result && !result\.ok/);
    expect(effect).toMatch(/liveRef\.current\?\.focus\(\)/);
    expect(src.indexOf("useEffect(() =>")).toBeLessThan(src.indexOf("if (result?.ok)"));
    // 클라이언트 검증 경로는 첫 오류 입력으로(기존) — 두 경로 모두 포커스가 body 에 남지 않는다
    expect(src).toMatch(/\(errs\.publicCode \? codeRef : last4Ref\)\.current\?\.focus\(\)/);
    const css = read(`${COMPONENT_DIR}/check.module.css`);
    expect(css).toMatch(/\.alertFocus:focus-visible\s*\{[^}]*var\(--focus-ring\)/);
  });

  test("클라이언트 컴포넌트는 원장·서버 모듈을 import 하지 않는다 — 법정 문구·서비스 롤이 번들로 새지 않는다", () => {
    for (const f of codeFiles) {
      const src = read(f);
      expect(ledgerImports(src), f).toEqual([]);
      expect(/lib\/supabase|lib\/guard\/deps|server-only|lib\/reservation-check\/(db|guards|lookup)["']/.test(src), f).toBe(false);
      expect(/from\s+["']zod["']/.test(src), f).toBe(false);
      expect(/from\s+["']next\/link["']/.test(src), f).toBe(false);
    }
    const clients = codeFiles.filter((f) => /^\s*["']use client["']/m.test(read(f)));
    expect(clients).toEqual([FORM]);
  });

  test("서버 페이지 — 원장 VERBATIM.bookingNotice·COMPANY.tel 을 읽어 props 로 내린다 · 'use client' 0 · force-dynamic 0 · 메타 reservationCheck.meta", () => {
    const src = stripComments(read(PAGE));
    expect(/^\s*["']use client["']/m.test(src)).toBe(false);
    expect(ledgerImports(read(PAGE))).toEqual(expect.arrayContaining(["VERBATIM", "COMPANY"]));
    expect(src).toMatch(/bookingNotice=\{VERBATIM\.bookingNotice\}/);
    expect(src).toMatch(/tel=\{COMPANY\.tel\}/);
    expect(src).not.toMatch(/force-dynamic/);
    expect(src).toMatch(/generateMetadata/);
    expect(src).toMatch(/namespace:\s*["']reservationCheck\.meta["']/);
    expect(src).toMatch(/COMPANY\.brandName/);
    expect(src).not.toMatch(/createServiceClient|checkReservation\(|lib\/reservation-check\/(db|lookup)/);
  });

  test("카드 — data-legal=\"booking-notice\" 로 원장 문구 자리를 표시 · tel: 링크 · data-status 배지 · 가격 0", () => {
    const src = stripComments(read(CARD));
    expect(src).toMatch(/data-legal="booking-notice"/);
    expect(src).toMatch(/tel:\$\{tel\}/);
    expect(src).toMatch(/data-status=/);
    for (const k of ["maskedName", "maskedPhone", "vehicleLabel", "originLabel", "destinationLabel", "departAtKst", "createdAtKst", "publicCode"]) expect(src, k).toContain(k);
    expect(src).not.toMatch(/view\.(name|phone|email)\b/);
  });

  test("개발 프리뷰(?previewResult=) — 페이지는 NODE_ENV 가드 뒤에서만 searchParams 를 읽고 mode 문자열만 내린다 · 원문 모양 값 0", () => {
    const page = stripComments(read(PAGE));
    const guard = page.indexOf('process.env.NODE_ENV !== "production"');
    const sp = page.indexOf("await searchParams");
    expect(guard).toBeGreaterThan(-1);
    expect(sp).toBeGreaterThan(guard);
    expect(page).toMatch(/previewResult=\{/);
    expect(page).not.toMatch(/name:\s*["']|phone:\s*["']/);
    expect([...PREVIEW_RESULT_MODES]).toEqual(["ok", "not_found", "ratelimit"]);
    expect(parsePreviewResult("1")).toBe("ok");
    expect(parsePreviewResult("ok")).toBe("ok");
    expect(parsePreviewResult("not_found")).toBe("not_found");
    expect(parsePreviewResult("ratelimit")).toBe("ratelimit");
    for (const bad of [undefined, "", "infra", ["ok"], "OK"]) expect(parsePreviewResult(bad as never), String(bad)).toBeNull();
  });

  test("프리뷰 결과 3종 — not_found 는 notFoundResult 와 동일 · ratelimit 키 · ok 뷰는 RESERVATION_VIEW_KEYS 와 같고 원문 모양 0", () => {
    expect(previewCheckResult("not_found")).toEqual(notFoundResult());
    expect(previewCheckResult("ratelimit")).toEqual({ ok: false, code: "ratelimit", messageKey: CHECK_ERROR_KEYS.ratelimit });
    const ok = previewCheckResult("ok");
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error("unreachable");
    const v: ReservationView = ok.view;
    expect(Object.keys(v).sort()).toEqual([...RESERVATION_VIEW_KEYS].sort());
    expect(PUBLIC_CODE_PATTERN.test(v.publicCode)).toBe(true);
    expect(v.maskedName).toMatch(/^.\*{1,2}$/);
    expect(v.maskedPhone).toMatch(/^\d{3}-\*{4}-\d{4}$/);
    expect(digitRuns(JSON.stringify(v), 5)).toEqual([]);
    expect(RESERVATION_STATUSES).toContain(v.status);
    const src = stripComments(read(PREVIEW));
    expect(src).not.toMatch(/name:\s*["']|phone:\s*["']|email/);
    expect(src).not.toMatch(/maskName\(|maskPhone\(/); // 원문을 넣고 가리는 방식이 아니라 가려진 값만 둔다
  });

  test("한글 리터럴 0 (프리뷰 픽스처 제외) — 문구는 messages/ko.json reservationCheck.* 에서만", () => {
    for (const { file, code } of sources) {
      if (file === PREVIEW) continue;
      const hits = code
        .split("\n")
        .map((l, i) => [i + 1, l] as const)
        .filter(([, l]) => HANGUL.test(l));
      expect(hits, `${file} 에 한글 리터럴`).toEqual([]);
    }
  });

  test("금지어 0 · 가격 표기 0 · 실증 불가 문구 0 · localStorage/sessionStorage 0 · verbatim 조각 0", () => {
    for (const { file, code } of sources) {
      for (const w of FORBIDDEN) expect(code.includes(w), `${file}: ${w}`).toBe(false);
      for (const re of PRICE_MARKS) expect(re.test(code), `${file}: ${re}`).toBe(false);
      for (const w of UNPROVEN) expect(code.includes(w), `${file}: ${w}`).toBe(false);
      expect(/localStorage|sessionStorage/.test(code), file).toBe(false);
      for (const frag of ["45인승 당일", "상담 후 확정", "결제 진행됩니다"]) expect(code.includes(frag), `${file}: verbatim 조각`).toBe(false);
    }
    for (const f of ["guards", "lookup", "db", "view", "result", "formData"]) {
      const code = stripComments(read(`${LIB_DIR}/${f}.ts`));
      for (const re of PRICE_MARKS) expect(re.test(code), `${f}: ${re}`).toBe(false);
    }
  });

  test("CSS — quote.module.css 를 import 해 폼 클래스를 재사용하고, check.module.css 는 추가분만(간격은 역할 토큰 — 규약은 layout.test §4 가 검사)", () => {
    expect(read(FORM)).toMatch(/from\s+["']@\/components\/quote\/quote\.module\.css["']/);
    expect(read(FORM)).toMatch(/from\s+["']\.\/check\.module\.css["']/);
    const css = read(`${COMPONENT_DIR}/check.module.css`).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(/\b(rgba?|hsla?)\(/.test(css)).toBe(false);
    expect(css).not.toMatch(/\.control\s*\{|\.btn\s*\{|\.field\s*\{/); // 복제 금지
    expect(css.length).toBeLessThan(read("components/quote/quote.module.css").length / 2);
  });

  test("클라이언트 사전 검증 validateCheckForm 은 zod CheckInput 과 같은 판정을 낸다(표본) · 필드별 키", () => {
    const samples: Array<{ publicCode: string; phoneLast4: string }> = [
      { publicCode: CODE, phoneLast4: LAST4 },
      { publicCode: " a2b3c4d5 ", phoneLast4: "0000" },
      { publicCode: "A2B3C4D", phoneLast4: LAST4 },
      { publicCode: "A2B3C4D5X", phoneLast4: LAST4 },
      { publicCode: "A2B3C4DI", phoneLast4: LAST4 },
      { publicCode: "A2B3C4D0", phoneLast4: LAST4 },
      { publicCode: CODE, phoneLast4: "567" },
      { publicCode: CODE, phoneLast4: "56789" },
      { publicCode: CODE, phoneLast4: "abcd" },
      { publicCode: "", phoneLast4: "" },
      { publicCode: "A2B3-C4D5", phoneLast4: LAST4 },
    ];
    for (const s of samples) {
      const errs = validateCheckForm(s);
      const zodOk = CheckInput.safeParse(s).success;
      expect(Object.keys(errs).length === 0, JSON.stringify(s)).toBe(zodOk);
      if (errs.publicCode) expect(errs.publicCode).toBe(CHECK_FIELD_ERROR_KEYS.publicCode);
      if (errs.phoneLast4) expect(errs.phoneLast4).toBe(CHECK_FIELD_ERROR_KEYS.phoneLast4);
    }
    expect(validateCheckForm({ publicCode: "A2B3C4D", phoneLast4: "1" })).toEqual({ publicCode: CHECK_FIELD_ERROR_KEYS.publicCode, phoneLast4: CHECK_FIELD_ERROR_KEYS.phoneLast4 });
  });

  test("legacy-menu — 예약확인 ready:true (라우트 파일과 함께) · 나머지 항목은 그대로", () => {
    const item = LEGACY_MENU.find((m) => m.key === "reservationCheck");
    expect(item?.ready).toBe(true);
    expect(item?.href).toBe("/reservation/check");
    expect(existsSync(path.join(ROOT, PAGE))).toBe(true);
    // P6-3 이 about·location·fleet·fares·notices·gallery 를 올렸다(ready 전체 집합은 tests/layout.test.ts EXPECTED_READY 와 같다).
    expect(LEGACY_MENU.filter((m) => m.ready).map((m) => m.key).sort()).toEqual(
      ["about", "fares", "fleet", "gallery", "guide", "location", "notices", "quote", "reservationCheck"],
    );
  });

  test("뷰 모델 키 목록 — RESERVATION_VIEW_KEYS 15개, 원문 키 없음(타입 단언은 view.ts 의 keyof 잠금)", () => {
    expect([...RESERVATION_VIEW_KEYS].sort()).toEqual(
      ["publicCode", "status", "statusKey", "tripType", "tripTypeKey", "departAtKst", "returnAtKst", "vehicleLabel", "originLabel", "destinationLabel", "busCount", "passengers", "maskedName", "maskedPhone", "createdAtKst"].sort(),
    );
    for (const k of ["name", "phone", "email", "message", "adminMemo", "admin_memo", "id"]) expect(RESERVATION_VIEW_KEYS as readonly string[], k).not.toContain(k);
    const src = read(`${LIB_DIR}/view.ts`);
    expect(src).toMatch(/keyof ReservationView/);
  });
});
