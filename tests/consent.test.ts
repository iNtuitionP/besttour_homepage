/**
 * P1-3 — 0003 동의 기록 컬럼 + zod + 순수 함수 계약 테스트 (플랜 v4 · ADR-6).
 *
 * 브리프 §검증 1~6 을 그대로 단언한다:
 *   1. 0003_consent.sql 텍스트 — 컬럼 4·제약 3·`default` 부재(주석 제외)·기존 행 가드
 *   2. 0003_consent.down.sql — 제약 3·컬럼 4 drop, migrations/ 밖
 *   3. zod — privacyConsent 는 literal(true), marketingConsent 기본 false
 *   4. retentionUntil — 원장(PRIVACY_NOTICE)의 보유기간과 일치. 하드코딩 비교 금지 — 원장을 바꾸면 따라 움직인다
 *   5. consentFields — marketingConsent:false → marketing_consent_at null
 *   6. DB — 로컬 스택 + REQUIRE_DB_TESTS=1 일 때만 insert 로 제약을 실증. 가드 자체를 먼저 테스트한다
 *
 * 원격(.env.local 의 https://….supabase.co)은 라이브 DB 이고 reservations 는 고객 개인정보 테이블이다.
 * DB 를 건드리는 블록은 dbWriteGate() 가 열렸을 때만 정의된다 — 원격 URL 이면 REQUIRE_DB_TESTS=1 이어도 닫힌다.
 * 주의: 이 파일은 tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

import { PRIVACY_NOTICE } from "@/lib/legal/disclosures";
import { PRIVACY_POLICY_VERSION, consentFields, retentionUntil } from "@/lib/reservations/consent";
import { ReservationInput } from "@/lib/types";
import { dbSmokeEnv, dbWriteGate, isLocalStack, isLocalStackUrl } from "./helpers/load-env-local";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const ROLLBACKS_DIR = path.join(ROOT, "supabase", "rollbacks");
const UP_SQL_PATH = path.join(MIGRATIONS_DIR, "0003_consent.sql");
const DOWN_SQL_PATH = path.join(ROLLBACKS_DIR, "0003_consent.down.sql");
const INIT_SQL_PATH = path.join(MIGRATIONS_DIR, "0001_init.sql");

const COLUMNS = ["privacy_consent_at", "privacy_policy_version", "marketing_consent_at", "retention_until"] as const;
const CONSTRAINTS = [
  "reservations_consent_before_created",
  "reservations_consent_not_stale",
  "reservations_retention_after_created",
] as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const readSql = (p: string) => readFileSync(p, "utf-8");
/*
 * 주석을 지운 코드는 `stripComments(sql, 경로)`(tests/helpers/strip-comments.ts · P6-11 문자 스캐너)로만 얻는다 —
 * 주석에 적힌 설명("default now() 를 쓰지 않는 이유")을 오탐하지 않기 위해. 제자리 정규식 제거기는 문자열·달러 인용 속
 * 주석 모양을 구분하지 못한다(known-defects D7).
 */
const compact = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

// =============================================================================
// 1. 0003_consent.sql 텍스트
// =============================================================================
describe("supabase/migrations/0003_consent.sql", () => {
  test("존재하고, 0003 번호는 이 파일 하나뿐이다 (번호 규약: 0003 = consent)", () => {
    expect(existsSync(UP_SQL_PATH)).toBe(true);
    const files0003 = readdirSync(MIGRATIONS_DIR).filter((f) => /^0003_/.test(f));
    expect(files0003).toEqual(["0003_consent.sql"]);
  });

  test("컬럼 4개 — privacy_consent_at·privacy_policy_version·retention_until 은 NOT NULL, marketing_consent_at 은 nullable", () => {
    const code = compact(stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH));
    expect(code).toMatch(/add column privacy_consent_at timestamptz not null/);
    expect(code).toMatch(/add column privacy_policy_version text not null/);
    expect(code).toMatch(/add column retention_until timestamptz not null/);
    // 선택 동의: null = 미동의. NOT NULL 이 붙으면 "미동의" 를 표현할 수 없다.
    expect(code).toMatch(/add column marketing_consent_at timestamptz\s*[,;]/);
    expect(code).not.toMatch(/add column marketing_consent_at timestamptz not null/);
  });

  test("코드 줄에 default 가 하나도 없다 — 특히 default now() (받은 적 없는 동의의 시각을 채우는 허위 기록)", () => {
    const code = stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH);
    expect(code).not.toMatch(/default\s+now\s*\(\s*\)/i);
    expect(code).not.toMatch(/\bdefault\b/i);
  });

  test("주석에 default now() 를 쓰지 않는 이유가 적혀 있다 (ADR-6 합성 초안 결함)", () => {
    const comments = readSql(UP_SQL_PATH)
      .split("\n")
      .filter((l) => /^\s*--/.test(l))
      .join("\n");
    expect(comments).toMatch(/default\s+now\s*\(\s*\)/i);
    expect(comments).toContain("허위");
  });

  test("제약 3개 — 이름과 식이 브리프와 같다", () => {
    const code = compact(stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH));
    expect(code).toContain(
      "add constraint reservations_consent_before_created check (privacy_consent_at <= created_at + interval '5 minutes')",
    );
    expect(code).toContain(
      "add constraint reservations_consent_not_stale check (privacy_consent_at >= created_at - interval '1 day')",
    );
    expect(code).toContain("add constraint reservations_retention_after_created check (retention_until > created_at)");
    for (const name of CONSTRAINTS) {
      expect(code.split(`add constraint ${name} `).length - 1, name).toBe(1);
    }
  });

  test("기존 행 가드 — reservations 에 행이 있으면 raise exception 으로 멈추고, 그 가드가 add column 보다 앞에 있다", () => {
    const code = stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH);
    const iGuard = code.search(/if\s+exists\s*\(\s*select\s+1\s+from\s+reservations\s*\)/i);
    const iRaise = code.search(/raise\s+exception/i);
    const iAlter = code.search(/alter\s+table\s+reservations\s+add\s+column/i);
    expect(iGuard).toBeGreaterThan(-1);
    expect(iRaise).toBeGreaterThan(-1);
    expect(iAlter).toBeGreaterThan(-1);
    expect(iGuard).toBeLessThan(iRaise);
    expect(iRaise).toBeLessThan(iAlter);
  });

  test("0001 은 소급 수정하지 않았다 — 동의 컬럼은 0003 에만 있다", () => {
    const init = readSql(INIT_SQL_PATH);
    for (const col of COLUMNS) expect(init, col).not.toContain(col);
  });
});

// =============================================================================
// 2. 0003_consent.down.sql
// =============================================================================
describe("supabase/rollbacks/0003_consent.down.sql", () => {
  test("migrations/ 안에는 CLI 패턴(<숫자>_<이름>.sql)에 걸리는 롤백 파일이 없다", () => {
    const stray = readdirSync(MIGRATIONS_DIR).filter(
      (f) => /^[0-9]+_.*\.sql$/.test(f) && /\.down\.sql$|rollback/i.test(f),
    );
    expect(stray).toEqual([]);
  });

  test("존재하고, 제약 3개 drop → 컬럼 4개 drop 순서로 되돌리며 begin/commit 으로 감싼다", () => {
    expect(existsSync(DOWN_SQL_PATH)).toBe(true);
    const sql = readSql(DOWN_SQL_PATH);
    const code = compact(stripComments(sql, DOWN_SQL_PATH));

    for (const name of CONSTRAINTS) expect(code, name).toContain(`drop constraint if exists ${name}`);
    for (const col of COLUMNS) expect(code, col).toContain(`drop column if exists ${col}`);

    const iLastConstraint = Math.max(...CONSTRAINTS.map((n) => code.indexOf(`drop constraint if exists ${n}`)));
    const iFirstColumn = Math.min(...COLUMNS.map((c) => code.indexOf(`drop column if exists ${c}`)));
    expect(iLastConstraint).toBeLessThan(iFirstColumn);

    expect(code).toMatch(/^begin;/);
    expect(code).toMatch(/commit;$/);
  });

  test("0002 롤백과 같은 형식 — rollbacks/ 에 두는 이유와 migration repair --status reverted 0003 안내가 주석에 있다", () => {
    const sql = readSql(DOWN_SQL_PATH);
    expect(sql).toContain("supabase migration repair --status reverted 0003");
    expect(sql).toMatch(/rollbacks\//);
  });
});

// =============================================================================
// 3. zod — ReservationInput 동의 필드
// =============================================================================
const validInput = {
  name: "홍길동",
  phone: "010-1234-5678",
  vehicleSlug: "bus45" as const,
  purposeCode: "family" as const,
  originCode: "SEL" as const,
  destinationCode: "BSN" as const,
  waypointCodes: [],
  tripType: "oneway" as const,
  departAtLocal: "2026-09-01T08:00",
  busCount: 1,
  locale: "ko" as const,
  turnstileToken: "test-turnstile-token",
  privacyConsent: true as const,
};

describe("ReservationInput — 동의 필드 (ADR-6)", () => {
  test("privacyConsent: true 면 성공하고 marketingConsent 는 기본 false", () => {
    const r = ReservationInput.safeParse(validInput);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.privacyConsent).toBe(true);
      expect(r.data.marketingConsent).toBe(false);
    }
  });

  test("privacyConsent: false 면 파싱 자체가 실패한다 (path = privacyConsent)", () => {
    const r = ReservationInput.safeParse({ ...validInput, privacyConsent: false });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path.join(".") === "privacyConsent")).toBe(true);
  });

  test("privacyConsent 누락이면 실패한다 — 사전 선택·묵시 동의 없음", () => {
    const { privacyConsent: _omit, ...withoutConsent } = validInput;
    void _omit;
    const r = ReservationInput.safeParse(withoutConsent);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path.join(".") === "privacyConsent")).toBe(true);
  });

  test("문자열 'true' 는 동의가 아니다 (강제 변환 없음)", () => {
    expect(ReservationInput.safeParse({ ...validInput, privacyConsent: "true" }).success).toBe(false);
    expect(ReservationInput.safeParse({ ...validInput, privacyConsent: 1 }).success).toBe(false);
  });

  test("marketingConsent: true 는 그대로 통과한다", () => {
    const r = ReservationInput.safeParse({ ...validInput, marketingConsent: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.marketingConsent).toBe(true);
  });

  test("marketingConsent 는 boolean 만 받는다", () => {
    expect(ReservationInput.safeParse({ ...validInput, marketingConsent: "yes" }).success).toBe(false);
  });
});

// =============================================================================
// 4. retentionUntil — 보유기간은 원장이 진실
// =============================================================================
describe("retentionUntil / PRIVACY_POLICY_VERSION", () => {
  test("원장 PRIVACY_NOTICE.retentionDays 는 양의 정수다 (숫자값의 단일 소스)", () => {
    expect(Number.isInteger(PRIVACY_NOTICE.retentionDays)).toBe(true);
    expect(PRIVACY_NOTICE.retentionDays).toBeGreaterThan(0);
  });

  test("원장의 문안(retention)과 숫자(retentionDays)가 어긋나지 않는다 — 한쪽만 바꾸면 여기서 잡힌다", () => {
    const years = /(\d+)\s*년/.exec(PRIVACY_NOTICE.retention);
    const days = /(\d+)\s*일/.exec(PRIVACY_NOTICE.retention);
    if (years) {
      expect(PRIVACY_NOTICE.retentionDays).toBe(Number(years[1]) * 365);
    } else if (days) {
      expect(PRIVACY_NOTICE.retentionDays).toBe(Number(days[1]));
    } else {
      throw new Error(
        `PRIVACY_NOTICE.retention="${PRIVACY_NOTICE.retention}" 의 형식을 이 테스트가 모른다 — ` +
          "'N년' / 'N일' 만 지원. 문안과 retentionDays 를 함께 바꾸고 이 분기를 확장할 것.",
      );
    }
    // 기산점은 접수일이다 — 배치(P1-5)는 created_at 기준으로 retention_until 을 읽는다.
    expect(PRIVACY_NOTICE.retention).toContain("접수일");
  });

  test("retentionUntil(createdAt) - createdAt === 원장 보유기간 (하드코딩 비교 아님)", () => {
    const createdAt = new Date("2026-09-11T03:04:05.678Z");
    const until = retentionUntil(createdAt);
    expect(until.getTime() - createdAt.getTime()).toBe(PRIVACY_NOTICE.retentionDays * MS_PER_DAY);
    expect(until.getTime()).toBeGreaterThan(createdAt.getTime());
  });

  test("입력 Date 를 변경하지 않는다 (순수 함수)", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const before = createdAt.getTime();
    retentionUntil(createdAt);
    expect(createdAt.getTime()).toBe(before);
  });

  test("유효하지 않은 Date 는 throw 한다 — NaN 시각으로 retention_until 을 만들지 않는다", () => {
    expect(() => retentionUntil(new Date("not a date"))).toThrow();
  });

  test("PRIVACY_POLICY_VERSION 은 'YYYY-MM-DD' 형식의 실존 날짜다", () => {
    expect(PRIVACY_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const d = new Date(`${PRIVACY_POLICY_VERSION}T00:00:00Z`);
    expect(d.toISOString().slice(0, 10)).toBe(PRIVACY_POLICY_VERSION);
  });
});

// =============================================================================
// 5. consentFields
// =============================================================================
describe("consentFields", () => {
  const now = new Date("2026-09-11T10:20:30.000Z");

  test("marketingConsent:false → marketing_consent_at null, 나머지 3필드는 now 기준", () => {
    const f = consentFields({ privacyConsent: true, marketingConsent: false }, now);
    expect(f).toEqual({
      privacy_consent_at: now.toISOString(),
      privacy_policy_version: PRIVACY_POLICY_VERSION,
      marketing_consent_at: null,
      retention_until: retentionUntil(now).toISOString(),
    });
  });

  test("marketingConsent:true → marketing_consent_at 은 필수 동의와 같은 인스턴트", () => {
    const f = consentFields({ privacyConsent: true, marketingConsent: true }, now);
    expect(f.marketing_consent_at).toBe(f.privacy_consent_at);
  });

  test("반환 키는 정확히 0003 의 컬럼 4개다", () => {
    const f = consentFields({ privacyConsent: true, marketingConsent: false }, now);
    expect(Object.keys(f).sort()).toEqual([...COLUMNS].sort());
  });

  test("timestamptz 값은 ISO 8601 UTC 인스턴트('Z')다 — KST 벽시계 문자열 규칙은 운행 일시 입력에만 해당한다", () => {
    const f = consentFields({ privacyConsent: true, marketingConsent: true }, now);
    for (const v of [f.privacy_consent_at, f.marketing_consent_at, f.retention_until]) {
      expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  test("zod 출력(parse 결과)을 그대로 넣을 수 있다", () => {
    const parsed = ReservationInput.parse(validInput);
    const f = consentFields(parsed, now);
    expect(f.privacy_consent_at).toBe(now.toISOString());
    expect(f.marketing_consent_at).toBeNull();
  });

  test("타입을 우회해 privacyConsent !== true 를 넣으면 throw — 동의 없이 동의 시각을 만들지 않는다", () => {
    const bypass = { privacyConsent: false, marketingConsent: false } as unknown as Parameters<typeof consentFields>[0];
    expect(() => consentFields(bypass, now)).toThrow(/privacyConsent/);
    const truthy = { privacyConsent: "true", marketingConsent: false } as unknown as Parameters<typeof consentFields>[0];
    expect(() => consentFields(truthy, now)).toThrow(/privacyConsent/);
  });

  test("유효하지 않은 now 는 throw 한다", () => {
    expect(() => consentFields({ privacyConsent: true, marketingConsent: false }, new Date(NaN))).toThrow();
  });
});

// =============================================================================
// 6-a. DB 쓰기 가드 — 가드 자체를 테스트한다 (항상 실행, 네트워크 없음)
// =============================================================================
describe("DB 쓰기 가드 — isLocalStackUrl / isLocalStack / dbWriteGate", () => {
  test.each([
    "http://127.0.0.1:54321",
    "http://localhost:54321",
    "http://kong:8000",
    "HTTP://LOCALHOST:54321",
    "http://127.0.0.1:54321/rest/v1",
  ])("로컬 스택 URL → true: %s", (url) => {
    expect(isLocalStackUrl(url)).toBe(true);
  });

  test.each([
    "https://expexkhcuogkavpacrem.supabase.co",
    "https://localhost.example.com",
    "https://x.supabase.co/?u=localhost",
    "https://x.supabase.co/#127.0.0.1",
    "https://x.supabase.co/kong",
    "127.0.0.1:54321",
    "not a url",
    "",
  ])("원격·위장·비정상 URL → false: %s", (url) => {
    expect(isLocalStackUrl(url)).toBe(false);
  });

  test("undefined → false (URL 이 없으면 로컬로 간주하지 않는다)", () => {
    expect(isLocalStackUrl(undefined)).toBe(false);
  });

  test("dbWriteGate — 로컬 URL 과 REQUIRE_DB_TESTS=1 이 둘 다 있어야 열린다", () => {
    const local = "http://127.0.0.1:54321";
    const remote = "https://expexkhcuogkavpacrem.supabase.co";
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: local, REQUIRE_DB_TESTS: "1" }).allowed).toBe(true);
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: local, REQUIRE_DB_TESTS: undefined }).allowed).toBe(false);
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: local, REQUIRE_DB_TESTS: "0" }).allowed).toBe(false);
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: local, REQUIRE_DB_TESTS: "true" }).allowed).toBe(false);
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: remote, REQUIRE_DB_TESTS: "1" }).allowed).toBe(false);
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: undefined, REQUIRE_DB_TESTS: "1" }).allowed).toBe(false);
  });

  test("닫힌 가드는 이유를 말한다 (skip 사유가 로그에 남도록)", () => {
    const remote = dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", REQUIRE_DB_TESTS: "1" });
    expect(remote.reason).toMatch(/원격|로컬 스택/);
    const noFlag = dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", REQUIRE_DB_TESTS: undefined });
    expect(noFlag.reason).toContain("REQUIRE_DB_TESTS");
  });

  test("현재 환경(.env.local) — 원격 URL 이면 REQUIRE_DB_TESTS=1 을 강제로 줘도 가드가 닫혀 있다", () => {
    const forced = dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, REQUIRE_DB_TESTS: "1" });
    expect(forced.allowed).toBe(isLocalStack());
    if (!isLocalStack()) {
      expect(dbWriteGate().allowed).toBe(false);
    }
  });
});

// =============================================================================
// 6-b. DB — 0003 제약 실증. 로컬 스택 + REQUIRE_DB_TESTS=1 일 때만 (원격 reservations 에는 어떤 쓰기도 하지 않는다)
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[consent.test] DB 제약 실증 블록 skip — ${gate.reason}`);
}

describe.skipIf(!gate.allowed || !env.hasServiceRole)("DB — 0003 제약 실증 (로컬 스택 + REQUIRE_DB_TESTS=1)", () => {
  const headers = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const TEST_PREFIX = "p13test-";
  const insertedIds: string[] = [];

  type RestResult = { status: number; body: unknown };
  async function rest(method: string, pathAndQuery: string, json?: unknown, prefer?: string): Promise<RestResult> {
    const res = await fetch(`${env.restRoot}${pathAndQuery}`, {
      method,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // 본문이 JSON 이 아니면 문자열 그대로 둔다
    }
    return { status: res.status, body };
  }

  function baseRow(overrides: Record<string, unknown> = {}) {
    const now = new Date();
    const row: Record<string, unknown> = {
      public_code: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
      name: "테스트",
      phone: "010-0000-0000",
      vehicle_slug: "bus45",
      purpose_code: "family",
      origin_code: "SEL",
      destination_code: "BSN",
      waypoint_codes: [],
      trip_type: "oneway",
      depart_at: new Date(now.getTime() + 7 * MS_PER_DAY).toISOString(),
      return_at: null,
      nights: 0,
      bus_count: 1,
      locale: "ko",
      ...consentFields({ privacyConsent: true, marketingConsent: false }, now),
    };
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete row[k];
      else row[k] = v;
    }
    return row;
  }

  async function insert(row: Record<string, unknown>): Promise<RestResult> {
    const r = await rest("POST", "/reservations", row, "return=representation");
    if (r.status === 201 && Array.isArray(r.body)) {
      for (const inserted of r.body as { id: string }[]) insertedIds.push(inserted.id);
    }
    return r;
  }

  function errorOf(r: RestResult): { code?: string; message?: string; details?: string } {
    return (r.body ?? {}) as { code?: string; message?: string; details?: string };
  }

  beforeAll(async () => {
    const probe = await rest("GET", "/reservations?select=privacy_consent_at&limit=0");
    if (probe.status !== 200) {
      throw new Error(
        `0003_consent.sql 이 이 DB(${process.env.NEXT_PUBLIC_SUPABASE_URL})에 적용되지 않은 것으로 보인다 — ` +
          `privacy_consent_at 조회 HTTP ${probe.status}: ${JSON.stringify(probe.body).slice(0, 200)}. ` +
          "CI(db-test)라면 supabase db reset 단계를 확인할 것.",
      );
    }
  });

  afterEach(async () => {
    while (insertedIds.length > 0) {
      const id = insertedIds.pop() as string;
      await rest("DELETE", `/reservations?id=eq.${id}`);
    }
  });

  afterAll(async () => {
    // 테스트 데이터 잔류 금지 — 접두사로 한 번 더 쓸어내고 0건임을 확인한다.
    await rest("DELETE", `/reservations?public_code=like.${TEST_PREFIX}*`);
    const left = await rest("GET", `/reservations?select=id&public_code=like.${TEST_PREFIX}*`);
    expect(left.status).toBe(200);
    expect(left.body).toEqual([]);
  });

  test.each([["privacy_consent_at"], ["privacy_policy_version"], ["retention_until"]] as const)(
    "%s 없는 insert → 400 · 23502 not-null 위반",
    async (col) => {
      const r = await insert(baseRow({ [col]: undefined }));
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(errorOf(r).code).toBe("23502");
      expect(errorOf(r).message).toContain(col);
    },
  );

  test("privacy_consent_at: null 도 막힌다 (NOT NULL)", async () => {
    const r = await insert(baseRow({ privacy_consent_at: null }));
    expect(r.status).toBe(400);
    expect(errorOf(r).code).toBe("23502");
  });

  test("retention_until <= created_at → 400 · 23514 reservations_retention_after_created", async () => {
    const r = await insert(baseRow({ retention_until: new Date(Date.now() - MS_PER_DAY).toISOString() }));
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(errorOf(r).code).toBe("23514");
    expect(errorOf(r).message).toContain("reservations_retention_after_created");
  });

  test("privacy_consent_at 이 접수보다 10분 미래 → 400 · 23514 reservations_consent_before_created (시계 조작 방어)", async () => {
    const r = await insert(baseRow({ privacy_consent_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }));
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(errorOf(r).code).toBe("23514");
    expect(errorOf(r).message).toContain("reservations_consent_before_created");
  });

  test("privacy_consent_at 이 접수보다 2일 과거 → 400 · 23514 reservations_consent_not_stale (재사용된 옛 동의 방어)", async () => {
    const r = await insert(baseRow({ privacy_consent_at: new Date(Date.now() - 2 * MS_PER_DAY).toISOString() }));
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(errorOf(r).code).toBe("23514");
    expect(errorOf(r).message).toContain("reservations_consent_not_stale");
  });

  test("consentFields() 로 만든 정상 insert → 201, 4컬럼이 저장되고, 즉시 delete 되어 잔류하지 않는다", async () => {
    const row = baseRow();
    const r = await insert(row);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const [saved] = r.body as Record<string, unknown>[];
    expect(saved.privacy_policy_version).toBe(PRIVACY_POLICY_VERSION);
    expect(saved.marketing_consent_at).toBeNull();
    expect(new Date(saved.privacy_consent_at as string).toISOString()).toBe(row.privacy_consent_at);
    expect(new Date(saved.retention_until as string).toISOString()).toBe(row.retention_until);

    const id = saved.id as string;
    const del = await rest("DELETE", `/reservations?id=eq.${id}`, undefined, "return=representation");
    expect(del.status).toBe(200);
    expect((del.body as unknown[]).length).toBe(1);
    insertedIds.splice(insertedIds.indexOf(id), 1);

    const gone = await rest("GET", `/reservations?select=id&id=eq.${id}`);
    expect(gone.body).toEqual([]);
  });

  test("marketingConsent:true 로 만든 insert → marketing_consent_at 이 저장된다", async () => {
    const row = baseRow({ ...consentFields({ privacyConsent: true, marketingConsent: true }, new Date()) });
    const r = await insert(row);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const [saved] = r.body as Record<string, unknown>[];
    expect(new Date(saved.marketing_consent_at as string).toISOString()).toBe(row.marketing_consent_at);
  });
});
