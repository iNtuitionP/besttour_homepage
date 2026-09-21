/**
 * P5-1 · P5-2 — 관리자 인증 게이트 + `is_admin()` RLS 계약 테스트 (플랜 v4 P5-1·P5-2·ADR-2 · CLAUDE.md §3·§7).
 *
 * 이 태스크가 지키는 것: `reservations`·`notifications_log` 에는 고객 이름·전화번호·문자 본문이 있고 지금까지 서비스 롤만
 * 닿을 수 있었다. 여기서 사람이 들어올 두 번째 문을 연다 — 그래서 모든 판정이 "막히는 쪽"으로 기울어야 한다.
 *
 * 브리프 §검증 1~8 을 그대로 단언한다:
 *   1. 0009 SQL 텍스트 — admin_users 표 · is_admin()(stable·security definer·search_path) · revoke/grant · 표별 정책 ·
 *      reservations 에 insert/delete 정책 없음 · admin_users 정책 0개 · 공개 정책 무변경(0001 해시 고정)
 *   2. 롤백 텍스트 — begin/commit · 행 있으면 raise exception · delete 0 · 추가 정책만 drop
 *   3. 허용 목록 — 대소문자·공백 무시 · 목록 밖이면 Supabase 호출 0 · 빈 목록이면 로그인 닫힘
 *   4. signInWithOtp 인자에 shouldCreateUser:false (mock 인자 단언 — 실제 매직링크는 보내지 않는다)
 *   5. requireAdmin — 세션 없음/권한 없음/정상 3경로
 *   6. 정적 — admin 경로에 서비스 롤 0(게이트 스크립트 red/green 픽스처 포함) · 액션 export 1 · 한글 리터럴 0 · 배선
 *   7. DB 실증 — 로컬 스택 가드 뒤에서만(원격에는 어떤 쓰기도 하지 않는다). CI db-test 에서 돈다
 *
 * tests/ 아래라 게이트 3종의 검사 대상이다 — 금지어·임시값 마커 리터럴은 문자열 결합으로 조립한다.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

import { HONEYPOT_FIELD, type RateLimiterSet } from "@/lib/guard";
import {
  ADMIN_CALLBACK_PATH,
  ADMIN_EMAIL_FIELD,
  ADMIN_LOGIN_PATH,
  ADMIN_LOGIN_STATES,
  MIN_LOGIN_RESPONSE_MS,
  adminEmailAllowlist,
  isAdminEmailAllowed,
  parseAdminEmails,
  remainingPadMs,
  type AdminLoginResult,
} from "@/lib/auth/adminLogin";
import { withNotificationsLock } from "./helpers/db-lock";
import { expectFunctionPrivilegeDenied, expectRaisedDenied, expectRlsInsertDenied, expectTablePrivilegeDenied } from "./helpers/expect-denied";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";

// server-only 는 vitest(node) 에서 import 즉시 throw 한다 — 빈 모듈로 바꿔치기(guard.test.ts·reservation-check.test.ts 선례).
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new RedirectSignal(to);
  }),
}));
vi.mock("@/lib/supabase/ssr", () => ({ createSsrClient: vi.fn() }));
vi.mock("@/lib/guard/deps", () => ({ adminGuardDeps: vi.fn() }));
vi.mock("@/lib/log", () => ({ structuredLog: vi.fn() }));

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { adminGuardDeps } from "@/lib/guard/deps";
import { createSsrClient } from "@/lib/supabase/ssr";
import { requestAdminLoginLink } from "@/actions/admin/auth";
import { requireAdmin, resolveAdminSession } from "@/lib/auth/requireAdmin";

import { stripComments } from "./helpers/strip-comments";

/** next/navigation redirect() 는 실제로 throw 한다 — mock 도 같은 모양이어야 뒤 코드가 실행되지 않는다. */
class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
    this.name = "RedirectSignal";
  }
}

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const exists = (rel: string) => existsSync(path.join(ROOT, rel));

const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const UP_SQL = "supabase/migrations/0009_admin_rls.sql";
const DOWN_SQL = "supabase/rollbacks/0009_admin_rls.down.sql";
const INIT_SQL = "supabase/migrations/0001_init.sql";
const ACTION = "actions/admin/auth.ts";
const REQUIRE_ADMIN = "lib/auth/requireAdmin.ts";
const ADMIN_LOGIN_LIB = "lib/auth/adminLogin.ts";
const LOGIN_PAGE = "app/admin/login/page.tsx";
const CALLBACK_ROUTE = "app/admin/auth/callback/route.ts";
const ADMIN_SHELL_LAYOUT = "app/admin/layout.tsx";
const PROTECTED_LAYOUT = "app/admin/(protected)/layout.tsx";
const PROTECTED_PAGE = "app/admin/(protected)/page.tsx";
const LOGIN_FORM = "components/admin/AdminLoginForm.tsx";
const GATE_SCRIPT = "scripts/check-admin-no-service-role.sh";

/**
 * 0001_init.sql 의 정규화(CRLF→LF) sha256 — tests/gallery-albums.test.ts 와 같은 값. 0009 는 0001 을 한 글자도 바꾸지 않는다:
 * 공개 정책(`*_select_active`)은 그대로 살아 있어야 하고(Postgres 정책은 OR 결합), 원격에 이미 적용된 파일을 고치면 이력과 실제 스키마가 갈린다.
 */
const INIT_SQL_SHA256 = "8b107b04a5f147708a3865e241ce83d97df63eb3cf2e753513f8baa1e81188d6";

const compact = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const commentLines = (sql: string) => sql.split("\n").filter((l) => /^\s*--/.test(l)).join("\n");
const sqlCode = (rel: string) => compact(stripComments(read(rel), rel));

/** 주석을 걷어낸 코드. 제거기는 저장소에 하나뿐이다(`tests/helpers/strip-comments.ts` · P6-7/P6-8 · D7). */
const codeOf = (rel: string) => stripComments(read(rel), rel);

function walk(absDir: string): string[] {
  if (!existsSync(absDir)) return [];
  return readdirSync(absDir).flatMap((n) => {
    const p = path.join(absDir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
/** 공개 조회 정책 이름 — 0009 가 이름을 다시 쓰거나 지우면 공개 사이트가 조용히 죽는다. */
const PUBLIC_POLICIES = [
  "vehicles_select_active",
  "gallery_select_active",
  "showcase_routes_select_active",
  "popups_select_active",
  "notices_select_active",
  "gallery_albums_select_active",
];
/** 관리자에게 전체 CRUD 를 여는 콘텐츠 표 6개. */
const CONTENT_TABLES = ["notices", "popups", "gallery", "gallery_albums", "showcase_routes", "vehicles"];

// =============================================================================
// 1. supabase/migrations/0009_admin_rls.sql — 텍스트
// =============================================================================
describe("1. 0009_admin_rls.sql", () => {
  test("존재하고, 0009 번호는 이 파일 하나뿐이다. migrations/ 안에 롤백 파일이 섞여 있지 않다", () => {
    expect(exists(UP_SQL)).toBe(true);
    expect(readdirSync(MIGRATIONS_DIR).filter((f) => /^0009_/.test(f))).toEqual(["0009_admin_rls.sql"]);
    const stray = readdirSync(MIGRATIONS_DIR).filter((f) => /^[0-9]+_.*\.sql$/.test(f) && /\.down\.sql$|rollback/i.test(f));
    expect(stray).toEqual([]);
  });

  test("admin_users — user_id uuid pk references auth.users on delete cascade · email unique · note · created_at", () => {
    const code = sqlCode(UP_SQL);
    expect(code).toContain("create table if not exists admin_users");
    expect(code).toMatch(/user_id\s+uuid\s+primary key references auth\.users\s*\(\s*id\s*\) on delete cascade/);
    expect(code).toMatch(/email\s+text\s+not null unique/);
    expect(code).toMatch(/note\s+text/);
    expect(code).toMatch(/created_at\s+timestamptz\s+not null default now\(\)/);
  });

  test("admin_users 는 RLS enable + 정책 0개 — 관리자도 이 표를 읽지 못한다(권한 상승 경로 차단)", () => {
    const code = sqlCode(UP_SQL);
    expect(code).toContain("alter table admin_users enable row level security");
    expect(code).not.toMatch(/create policy [a-z0-9_]+ on admin_users/);
    expect(code).not.toMatch(/grant [a-z, ]*on table admin_users to [^;]*\b(anon|authenticated)\b/);
  });

  /**
   * 독립 리뷰 M1 — "GRANT 를 안 줬으니 못 읽는다" 는 틀렸다. Supabase 는 public 스키마 기본권한을 anon·authenticated 에
   * 넓게 깔아 두므로(lib/queries/* 가 GRANT 없이 읽히는 이유), RLS 를 빼면 이 표는 그대로 열린다. 명시적 회수가 두 번째 잠금이다.
   */
  test("admin_users 권한을 명시적으로 회수한다 — RLS 하나에만 기대지 않는다 (M1)", () => {
    const code = sqlCode(UP_SQL);
    expect(code).toMatch(/revoke all on table admin_users from [^;]*\banon\b/);
    expect(code).toMatch(/revoke all on table admin_users from [^;]*\bauthenticated\b/);
  });

  test("is_admin() — sql · stable · security definer · search_path 고정 · auth.uid() 로 표를 본다", () => {
    const code = sqlCode(UP_SQL);
    expect(code).toMatch(/create or replace function is_admin\(\)\s+returns boolean/);
    expect(code).toContain("language sql");
    expect(code).toContain("stable");
    expect(code).toContain("security definer");
    expect(code).toMatch(/select exists \(select 1 from admin_users where user_id = auth\.uid\(\)\)/);
  });

  /**
   * 독립 리뷰 M3 — `set search_path = public` 만 적으면 Postgres 가 pg_temp 를 암묵적으로 맨 앞에서 찾는다.
   * 임시 스키마에는 어떤 롤이든 객체를 만들 수 있다. 이 함수의 반환값이 곧 인가 판정이라 검색 순서를 끝까지 고정한다.
   */
  test("is_admin() 의 search_path 에 pg_temp 가 **끝에** 명시돼 있다 (M3)", () => {
    const code = sqlCode(UP_SQL);
    expect(code).toMatch(/set search_path = public, pg_temp/);
    expect(code).not.toMatch(/set search_path = pg_temp/);
  });

  test("실행 권한 — public 에서 회수하고 authenticated 에게만 준다. anon 에게 주지 않는다", () => {
    const code = sqlCode(UP_SQL);
    expect(code).toMatch(/revoke all on function is_admin\(\) from public/);
    expect(code).toMatch(/grant execute on function is_admin\(\) to authenticated/);
    expect(code).not.toMatch(/grant execute on function is_admin\(\) to [^;]*\banon\b/);
  });

  test("reservations — admin 은 select·update 만. insert·delete 정책은 만들지 않는다(접수는 서버액션, 파기는 크론)", () => {
    const code = sqlCode(UP_SQL);
    expect(code).toMatch(/create policy reservations_admin_select on reservations for select to authenticated using \(is_admin\(\)\)/);
    expect(code).toMatch(
      /create policy reservations_admin_update on reservations for update to authenticated using \(is_admin\(\)\) with check \(is_admin\(\)\)/,
    );
    expect(code).not.toMatch(/create policy [a-z0-9_]+ on reservations for insert/);
    expect(code).not.toMatch(/create policy [a-z0-9_]+ on reservations for delete/);
    expect(code).not.toMatch(/create policy [a-z0-9_]+ on reservations for all/);
  });

  test("notifications_log — select 정책 하나뿐. 상태 전이는 0005 SQL 함수 몫이라 쓰기 정책을 만들지 않는다", () => {
    const code = sqlCode(UP_SQL);
    expect(code).toMatch(/create policy notifications_log_admin_select on notifications_log for select to authenticated using \(is_admin\(\)\)/);
    for (const verb of ["insert", "update", "delete", "all"]) {
      expect(code, verb).not.toMatch(new RegExp(`create policy [a-z0-9_]+ on notifications_log for ${verb}`));
    }
  });

  test("콘텐츠 표 6개 — <table>_admin_all 로 전체 행 CRUD (using·with check 둘 다 is_admin())", () => {
    const code = sqlCode(UP_SQL);
    for (const t of CONTENT_TABLES) {
      expect(code, t).toMatch(
        new RegExp(`create policy ${t}_admin_all on ${t} for all to authenticated using \\(is_admin\\(\\)\\) with check \\(is_admin\\(\\)\\)`),
      );
    }
  });

  test("모든 admin 정책이 `to authenticated` 다 — anon 요청이 is_admin() 을 평가하면 권한 오류로 공개 사이트가 죽는다", () => {
    const code = sqlCode(UP_SQL);
    const policies = [...code.matchAll(/create policy ([a-z0-9_]+) on ([a-z0-9_]+) ([^;]*)/g)];
    expect(policies.length).toBeGreaterThanOrEqual(9);
    for (const [, name, , body] of policies) {
      expect(name, name).toMatch(/_admin_/);
      expect(body, name).toContain("to authenticated");
    }
  });

  test("공개 정책을 건드리지 않는다 — 이름 재사용·drop 0건 (Postgres 정책은 OR 결합이라 추가만 하면 된다)", () => {
    const code = sqlCode(UP_SQL);
    for (const p of PUBLIC_POLICIES) {
      expect(code, p).not.toContain(p);
    }
    expect(code).not.toMatch(/\bdrop policy\b(?![^;]*_admin_)/);
    expect(code).not.toMatch(/\bdrop table\b/);
    expect(code).not.toMatch(/\bdelete from\b/);
    expect(code).not.toMatch(/\btruncate\b/);
  });

  test("표 권한 — authenticated 에게 필요한 만큼만 준다(reservations 는 select·update, 삭제 없음)", () => {
    const code = sqlCode(UP_SQL);
    expect(code).toMatch(/grant select, update on table reservations to authenticated/);
    expect(code).toMatch(/grant select on table notifications_log to authenticated/);
    expect(code).not.toMatch(/grant [^;]*delete[^;]*on table reservations/);
    for (const t of CONTENT_TABLES) {
      expect(code, t).toMatch(new RegExp(`grant select, insert, update, delete on table [^;]*\\b${t}\\b`));
    }
  });

  test("JWT 클레임을 쓰지 않은 이유가 헤더 주석에 남아 있다 (회수 지연 · 감사 불가)", () => {
    const comments = commentLines(read(UP_SQL));
    expect(comments).toMatch(/클레임|app_metadata/);
    expect(comments).toMatch(/rollbacks\/0009_admin_rls\.down\.sql/);
    expect(comments).toMatch(/ADR-2/);
  });

  test("0001_init.sql 은 한 글자도 바뀌지 않았다 (정규화 sha256 고정)", () => {
    const hash = createHash("sha256").update(read(INIT_SQL)).digest("hex");
    expect(hash).toBe(INIT_SQL_SHA256);
  });
});

// =============================================================================
// 2. supabase/rollbacks/0009_admin_rls.down.sql
// =============================================================================
describe("2. 0009 롤백", () => {
  test("rollbacks/ 에 있고 트랜잭션 안에서 돈다 + 수동 실행·repair 안내 주석 (0007·0008 규약)", () => {
    expect(exists(DOWN_SQL)).toBe(true);
    const raw = read(DOWN_SQL);
    expect(raw).toMatch(/\bbegin;/);
    expect(raw).toMatch(/\bcommit;/);
    expect(commentLines(raw)).toMatch(/migration repair --status reverted 0009/);
  });

  test("admin_users 에 행이 있으면 raise exception 으로 멈춘다 — 관리자 명단을 조용히 지우지 않는다", () => {
    const code = sqlCode(DOWN_SQL);
    expect(code).toMatch(/select count\(\*\) into [a-z_]+ from admin_users/);
    expect(code).toMatch(/raise exception/);
    expect(code).not.toMatch(/\bdelete from\b/);
    expect(code).not.toMatch(/\btruncate\b/);
  });

  test("재실행 가능 — 표가 이미 없으면 가드를 건너뛴다 (0008 롤백과 같은 규약)", () => {
    const code = sqlCode(DOWN_SQL);
    expect(code).toMatch(/to_regclass\('public\.admin_users'\) is null/);
  });

  test("롤백이 admin_users 를 다시 열지 않는다 — GRANT 0건 (M1 대칭)", () => {
    const code = sqlCode(DOWN_SQL);
    expect(code).not.toMatch(/grant [^;]*on table admin_users/);
    expect(code).not.toMatch(/grant [^;]*admin_users[^;]*to [^;]*(anon|authenticated)/);
    // 표를 지우면 권한도 함께 사라진다는 근거를 주석에 남겼는가
    expect(commentLines(read(DOWN_SQL))).toMatch(/revoke all on table admin_users|권한도 함께 사라진다/);
  });

  test("0009 가 더한 정책만 지우고 공개 정책은 손대지 않는다 · 정책 → 함수 → 표 순서", () => {
    const code = sqlCode(DOWN_SQL);
    for (const t of [...CONTENT_TABLES, "reservations", "notifications_log"]) {
      expect(code, t).toMatch(new RegExp(`drop policy if exists [a-z0-9_]*_admin_[a-z]+ on ${t}`));
    }
    for (const p of PUBLIC_POLICIES) {
      expect(code, p).not.toContain(p);
    }
    expect(code).not.toMatch(/\bcreate policy\b/);
    const iPolicy = code.lastIndexOf("drop policy");
    const iFunc = code.indexOf("drop function if exists is_admin()");
    const iTable = code.indexOf("drop table if exists admin_users");
    expect(iFunc, "정책보다 먼저 함수를 지우면 의존성 때문에 실패한다").toBeGreaterThan(iPolicy);
    expect(iTable).toBeGreaterThan(iFunc);
  });
});

// =============================================================================
// 3. 허용 목록 — lib/auth/adminLogin.ts (순수)
// =============================================================================
describe("3. ADMIN_EMAILS 허용 목록", () => {
  test("쉼표 구분 · trim · 소문자 · 빈 항목 제거 · 중복 제거", () => {
    expect(parseAdminEmails(" Boss@Bestour.CO.KR , bestour2013@naver.com ,, bestour2013@NAVER.com ")).toEqual([
      "boss@bestour.co.kr",
      "bestour2013@naver.com",
    ]);
    expect(parseAdminEmails("")).toEqual([]);
    expect(parseAdminEmails("   ")).toEqual([]);
    expect(parseAdminEmails(undefined)).toEqual([]);
    expect(parseAdminEmails(",,,")).toEqual([]);
  });

  test("소속 판정도 대소문자·공백을 무시한다", () => {
    const allow = parseAdminEmails("boss@bestour.co.kr");
    expect(isAdminEmailAllowed("BOSS@Bestour.co.kr", allow)).toBe(true);
    expect(isAdminEmailAllowed("  boss@bestour.co.kr  ", allow)).toBe(true);
    expect(isAdminEmailAllowed("boss@bestour.co.kr.attacker.example", allow)).toBe(false);
    expect(isAdminEmailAllowed("", allow)).toBe(false);
    expect(isAdminEmailAllowed("boss@bestour.co.kr", [])).toBe(false);
  });

  test("adminEmailAllowlist() 가 ADMIN_EMAILS 를 읽는 유일한 곳이고, 비면 빈 배열이다", () => {
    const saved = process.env.ADMIN_EMAILS;
    try {
      process.env.ADMIN_EMAILS = " A@b.com ";
      expect(adminEmailAllowlist()).toEqual(["a@b.com"]);
      delete process.env.ADMIN_EMAILS;
      expect(adminEmailAllowlist()).toEqual([]);
    } finally {
      if (saved === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = saved;
    }
    // 이름을 주석에 적는 것은 괜찮다 — 금지되는 것은 여기 말고 다른 곳에서 env 를 **읽는** 것이다.
    for (const rel of [ACTION, LOGIN_PAGE, REQUIRE_ADMIN]) {
      expect(read(rel), rel).not.toMatch(/process\.env\.ADMIN_EMAILS/);
    }
    expect(read(ADMIN_LOGIN_LIB)).toContain("process.env.ADMIN_EMAILS");
  });
});

// =============================================================================
// 4. actions/admin/auth.ts — 로그인 요청 (실제 매직링크는 보내지 않는다: signInWithOtp 은 mock)
// =============================================================================
const ALLOWED = "boss@bestour.co.kr";
const OUTSIDE = "attacker@example.com";

function limiterSet(success: boolean): { limiters: RateLimiterSet; calls: string[] } {
  const calls: string[] = [];
  const make = (name: string) => ({
    limit: async (identifier: string) => {
      calls.push(`${name}:${identifier.slice(0, 4)}`);
      return { success, reset: 0 };
    },
  });
  return {
    limiters: {
      known: { short: make("known.short"), long: make("known.long") },
      unknown: { short: make("unknown.short"), long: make("unknown.long") },
    },
    calls,
  };
}

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";

function otpForm(email: string, honeypot?: string): FormData {
  const fd = new FormData();
  fd.set(ADMIN_EMAIL_FIELD, email);
  if (honeypot !== undefined) fd.set(HONEYPOT_FIELD, honeypot);
  return fd;
}

/** signInWithOtp 에 넘어간 인자 모양 — mock 단언용(실제 매직링크는 보내지 않는다). */
interface OtpArgs {
  email: string;
  options: { shouldCreateUser: boolean; emailRedirectTo: string };
}

/** signInWithOtp 호출을 기록만 하는 가짜 SSR 클라이언트 — 네트워크 0. */
function fakeSsr(error: { message: string } | null = null) {
  const signInWithOtp = vi.fn<(args: OtpArgs) => Promise<{ data: object; error: { message: string } | null }>>(async () => ({
    data: {},
    error,
  }));
  return { client: { auth: { signInWithOtp } }, signInWithOtp };
}

describe("4. requestAdminLoginLink", () => {
  const savedEmails = process.env.ADMIN_EMAILS;
  const savedSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  beforeEach(() => {
    vi.mocked(headers).mockResolvedValue({ get: () => null } as unknown as Awaited<ReturnType<typeof headers>>);
    vi.mocked(cookies).mockResolvedValue({ getAll: () => [], set: () => {} } as unknown as Awaited<ReturnType<typeof cookies>>);
    const { limiters } = limiterSet(true);
    vi.mocked(adminGuardDeps).mockReturnValue({ now: () => new Date(), secret: SECRET, rateLimit: { limiters, timeoutMs: 5_000 } });
    vi.mocked(createSsrClient).mockReset();
    process.env.ADMIN_EMAILS = ALLOWED;
    process.env.NEXT_PUBLIC_SITE_URL = "https://admin-test.example";
  });

  afterAll(() => {
    if (savedEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = savedEmails;
    if (savedSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = savedSiteUrl;
  });

  test("ADMIN_EMAILS 가 비면 로그인 자체가 닫힌다 — Supabase 도 rate limit 도 부르지 않는다", async () => {
    delete process.env.ADMIN_EMAILS;
    const { client, signInWithOtp } = fakeSsr();
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    expect(await requestAdminLoginLink(otpForm(ALLOWED))).toEqual<AdminLoginResult>({ state: "closed" });
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(createSsrClient).not.toHaveBeenCalled();
    expect(adminGuardDeps).not.toHaveBeenCalled();
  });

  test("형식이 틀린 주소는 invalid — 카운터도 Supabase 도 건드리지 않는다", async () => {
    const { client, signInWithOtp } = fakeSsr();
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    for (const bad of ["", "   ", "not-an-email", "a@", "@b.com", "a b@c.com", "a".repeat(250) + "@b.com"]) {
      expect(await requestAdminLoginLink(otpForm(bad)), bad).toEqual({ state: "invalid" });
    }
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(adminGuardDeps).not.toHaveBeenCalled();
  });

  test("허니팟이 채워지면 성공과 같은 응답을 주고 Supabase 는 부르지 않는다", async () => {
    const { client, signInWithOtp } = fakeSsr();
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    expect(await requestAdminLoginLink(otpForm(ALLOWED, "http://spam.example"))).toEqual({ state: "sent" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  test("rate limit 초과 → ratelimit · deps 가 throw(Upstash env 없음) → infra. 둘 다 Supabase 0", async () => {
    const { client, signInWithOtp } = fakeSsr();
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    const { limiters } = limiterSet(false);
    vi.mocked(adminGuardDeps).mockReturnValue({ now: () => new Date(), secret: SECRET, rateLimit: { limiters, timeoutMs: 5_000 } });
    expect(await requestAdminLoginLink(otpForm(ALLOWED))).toEqual({ state: "ratelimit" });

    vi.mocked(adminGuardDeps).mockImplementation(() => {
      throw new Error("UPSTASH_REDIS_REST_URL 이 설정되지 않았다");
    });
    expect(await requestAdminLoginLink(otpForm(ALLOWED))).toEqual({ state: "infra" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  test("허용 목록 밖 주소 — Supabase 호출 0, 응답은 목록 안 주소와 **구분 불가**", async () => {
    const { client, signInWithOtp } = fakeSsr();
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    const outside = await requestAdminLoginLink(otpForm(OUTSIDE));
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(createSsrClient).not.toHaveBeenCalled();

    const inside = await requestAdminLoginLink(otpForm(ALLOWED));
    expect(signInWithOtp).toHaveBeenCalledTimes(1);

    expect(outside).toEqual(inside);
    expect(JSON.stringify(outside)).toBe(JSON.stringify(inside));
    expect(outside).toEqual({ state: "sent" });
  });

  test("목록 밖 주소도 rate limit 슬롯을 소비한다 — 열거 시도가 공짜가 아니다", async () => {
    const { limiters, calls } = limiterSet(true);
    vi.mocked(adminGuardDeps).mockReturnValue({ now: () => new Date(), secret: SECRET, rateLimit: { limiters, timeoutMs: 5_000 } });
    const { client } = fakeSsr();
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    await requestAdminLoginLink(otpForm(OUTSIDE));
    expect(calls.length).toBeGreaterThan(0);
  });

  test("signInWithOtp 인자 — shouldCreateUser:false 가 반드시 있고, emailRedirectTo 는 콜백 경로다. 주소는 정규화돼 나간다", async () => {
    const { client, signInWithOtp } = fakeSsr();
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    await requestAdminLoginLink(otpForm("  BOSS@Bestour.CO.KR  "));
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    const arg: OtpArgs = signInWithOtp.mock.calls[0][0];
    expect(arg.email).toBe(ALLOWED);
    expect(arg.options.shouldCreateUser).toBe(false);
    expect(arg.options.emailRedirectTo).toBe(`https://admin-test.example${ADMIN_CALLBACK_PATH}`);
  });

  test("Supabase 가 오류를 내도(미등록 사용자·SMTP 실패) 응답은 sent 그대로 — 주소 존재 여부를 알려주지 않는다", async () => {
    const { client } = fakeSsr({ message: "Signups not allowed for otp" });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    expect(await requestAdminLoginLink(otpForm(ALLOWED))).toEqual({ state: "sent" });

    vi.mocked(createSsrClient).mockImplementation(() => {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL 이 설정되지 않았습니다.");
    });
    expect(await requestAdminLoginLink(otpForm(ALLOWED))).toEqual({ state: "sent" });
  });

  test("응답 상태는 5종뿐이고 다른 정보를 싣지 않는다", () => {
    expect([...ADMIN_LOGIN_STATES].sort()).toEqual(["closed", "infra", "invalid", "ratelimit", "sent"]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 독립 리뷰 M2 — 값이 같아도 **시간**이 다르면 구분된다.
  // 목록 밖은 네트워크 0(즉시), 목록 안은 Supabase 왕복. 그 차이를 재면 명단이 샌다.
  // ───────────────────────────────────────────────────────────────────────────
  test("remainingPadMs — 바닥까지 남은 시간. 넘겼으면 0, 이상한 경과값은 전액 대기 (M2)", () => {
    expect(MIN_LOGIN_RESPONSE_MS).toBe(300);
    expect(remainingPadMs(0)).toBe(MIN_LOGIN_RESPONSE_MS);
    expect(remainingPadMs(120)).toBe(MIN_LOGIN_RESPONSE_MS - 120);
    expect(remainingPadMs(MIN_LOGIN_RESPONSE_MS)).toBe(0);
    expect(remainingPadMs(5_000)).toBe(0);
    // 말이 안 되는 경과값(음수·NaN·Infinity)은 "덜 기다리는" 쪽이 아니라 전액 대기로 접는다 — 시간 누출도 fail-closed.
    for (const weird of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(remainingPadMs(weird), String(weird)).toBe(MIN_LOGIN_RESPONSE_MS);
    }
  });

  test("중립 응답 3갈래가 같은 시간 바닥을 지킨다 — 목록 밖·목록 안·허니팟 (M2)", async () => {
    const { client } = fakeSsr();
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    // 타이머 해상도(Windows 는 ~15ms) 때문에 정확히 300 에 못 미칠 수 있다 — 바닥이 있다는 것만 단언한다.
    const FLOOR = MIN_LOGIN_RESPONSE_MS - 20;

    const timed = async (email: string, honeypot?: string): Promise<{ ms: number; result: AdminLoginResult }> => {
      const t0 = Date.now();
      const result = await requestAdminLoginLink(otpForm(email, honeypot));
      return { ms: Date.now() - t0, result };
    };

    const outside = await timed(OUTSIDE);
    const inside = await timed(ALLOWED);
    const honeypot = await timed(ALLOWED, "http://spam.example");

    for (const [label, r] of [["목록 밖", outside], ["목록 안", inside], ["허니팟", honeypot]] as const) {
      expect(r.result, label).toEqual({ state: "sent" });
      expect(r.ms, `${label}: ${r.ms}ms`).toBeGreaterThanOrEqual(FLOOR);
    }
  });

  test("바닥은 천장이 아니다 — 느린 Supabase 응답을 잘라 내지 않는다 (M2)", async () => {
    const SLOW = MIN_LOGIN_RESPONSE_MS + 200;
    const signInWithOtp = vi.fn<(args: OtpArgs) => Promise<{ data: object; error: null }>>(async () => {
      await new Promise((r) => setTimeout(r, SLOW));
      return { data: {}, error: null };
    });
    vi.mocked(createSsrClient).mockReturnValue({ auth: { signInWithOtp } } as never);
    const t0 = Date.now();
    expect(await requestAdminLoginLink(otpForm(ALLOWED))).toEqual({ state: "sent" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(SLOW - 20);
  });

  test("바닥은 sent 에만 건다 — closed·invalid 는 즉시 돌아온다(주소 존재 여부와 무관한 상태) (M2)", async () => {
    delete process.env.ADMIN_EMAILS;
    let t0 = Date.now();
    expect(await requestAdminLoginLink(otpForm(ALLOWED))).toEqual({ state: "closed" });
    expect(Date.now() - t0).toBeLessThan(MIN_LOGIN_RESPONSE_MS);

    process.env.ADMIN_EMAILS = ALLOWED;
    t0 = Date.now();
    expect(await requestAdminLoginLink(otpForm("not-an-email"))).toEqual({ state: "invalid" });
    expect(Date.now() - t0).toBeLessThan(MIN_LOGIN_RESPONSE_MS);
  });
});

// =============================================================================
// 5. lib/auth/requireAdmin.ts — 세션 → is_admin() → 반환/로그아웃
// =============================================================================
function fakeSession(opts: {
  user?: { id: string; email?: string } | null;
  userError?: { message: string } | null;
  isAdmin?: unknown;
  rpcError?: { message: string } | null;
}) {
  const signOut = vi.fn(async () => ({ error: null }));
  const rpc = vi.fn(async () => ({ data: opts.isAdmin ?? null, error: opts.rpcError ?? null }));
  const getUser = vi.fn(async () => ({ data: { user: opts.user ?? null }, error: opts.userError ?? null }));
  return { client: { auth: { getUser, signOut }, rpc }, signOut, rpc, getUser };
}

describe("5. requireAdmin", () => {
  beforeEach(() => {
    vi.mocked(cookies).mockResolvedValue({ getAll: () => [], set: () => {} } as unknown as Awaited<ReturnType<typeof cookies>>);
    vi.mocked(createSsrClient).mockReset();
    vi.mocked(redirect).mockClear();
  });

  test("세션이 없으면 로그인 화면으로 보낸다 — is_admin() 은 부르지 않는다", async () => {
    const { client, rpc } = fakeSession({ user: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    await expect(requireAdmin()).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith(ADMIN_LOGIN_PATH);
    expect(rpc).not.toHaveBeenCalled();
  });

  test("세션은 있는데 is_admin() 이 false → 로그아웃시키고 로그인 화면 (권한 없는 세션을 남기지 않는다)", async () => {
    const { client, signOut } = fakeSession({ user: { id: "u1", email: "x@y.z" }, isAdmin: false });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    await expect(requireAdmin()).rejects.toBeInstanceOf(RedirectSignal);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith(ADMIN_LOGIN_PATH);
  });

  test("is_admin() 이 오류·null·문자열이어도 통과시키지 않는다 (true 만 통과)", async () => {
    for (const bad of [{ isAdmin: null }, { isAdmin: "true" }, { isAdmin: 1 }, { rpcError: { message: "permission denied" } }]) {
      const { client, signOut } = fakeSession({ user: { id: "u1", email: "x@y.z" }, ...bad });
      vi.mocked(createSsrClient).mockReturnValue(client as never);
      expect(await resolveAdminSession(), JSON.stringify(bad)).toBeNull();
      expect(signOut, JSON.stringify(bad)).toHaveBeenCalledTimes(1);
    }
  });

  test("is_admin() 이 true 면 { userId, email } 을 돌려준다", async () => {
    const { client, signOut } = fakeSession({ user: { id: "u-42", email: ALLOWED }, isAdmin: true });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    expect(await requireAdmin()).toEqual({ userId: "u-42", email: ALLOWED });
    expect(signOut).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  test("Supabase 설정이 없어 클라이언트를 못 만들면 500 이 아니라 로그인 화면이다 (fail-closed)", async () => {
    vi.mocked(createSsrClient).mockImplementation(() => {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL 이 설정되지 않았습니다.");
    });
    expect(await resolveAdminSession()).toBeNull();
    await expect(requireAdmin()).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith(ADMIN_LOGIN_PATH);
  });

  test("getUser 가 던져도 로그인 화면으로 떨어진다", async () => {
    const client = {
      auth: {
        getUser: vi.fn(async () => {
          throw new Error("network");
        }),
        signOut: vi.fn(),
      },
      rpc: vi.fn(),
    };
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    expect(await resolveAdminSession()).toBeNull();
  });
});

// =============================================================================
// 6. 정적 — 경계·배선
// =============================================================================
describe("6. 정적 규약", () => {
  test("산출물 파일이 전부 있다", () => {
    for (const rel of [
      UP_SQL,
      DOWN_SQL,
      ACTION,
      REQUIRE_ADMIN,
      ADMIN_LOGIN_LIB,
      LOGIN_PAGE,
      CALLBACK_ROUTE,
      PROTECTED_LAYOUT,
      PROTECTED_PAGE,
      LOGIN_FORM,
      GATE_SCRIPT,
    ]) {
      expect(exists(rel), rel).toBe(true);
    }
  });

  test("app/admin/** · actions/admin/** 에 서비스 롤 심볼 0건 (ADR-2 — 방어선이 함수 호출 하나가 되면 안 된다)", () => {
    const files = [...walk(path.join(ROOT, "app", "admin")), ...walk(path.join(ROOT, "actions", "admin"))];
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const src = readFileSync(f, "utf-8");
      expect(src, f).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE_KEY|supabase\/server/);
    }
  });

  test("액션 파일 — 'use server' 첫 줄 · export 1개 · async 함수", () => {
    const src = read(ACTION);
    expect(src.split("\n")[0].trim()).toMatch(/^["']use server["'];?$/);
    const exports = [...codeOf(ACTION).matchAll(/^export\s/gm)];
    expect(exports.length, "'use server' 파일의 export 는 전부 공개 POST 엔드포인트가 된다 (ADR-3)").toBe(1);
    expect(src).toMatch(/export async function requestAdminLoginLink/);
  });

  test("한글 리터럴 0 — 문구는 messages/ko.json admin.* 에서만 온다", () => {
    const targets = [
      ACTION,
      LOGIN_PAGE,
      CALLBACK_ROUTE,
      PROTECTED_LAYOUT,
      PROTECTED_PAGE,
      LOGIN_FORM,
      REQUIRE_ADMIN,
      ADMIN_LOGIN_LIB,
    ];
    for (const rel of targets) {
      const offenders = codeOf(rel)
        .split("\n")
        .map((l, i) => [i + 1, l] as const)
        .filter(([, l]) => HANGUL.test(l));
      expect(offenders, rel).toEqual([]);
    }
  });

  test("레이아웃 구조 — 인증 게이트는 (protected) 세그먼트에 있고 로그인 화면은 그 밖이다", () => {
    const shell = codeOf(ADMIN_SHELL_LAYOUT);
    expect(shell, "셸 레이아웃이 requireAdmin 을 부르면 로그인 화면이 자기 자신으로 무한 리다이렉트한다").not.toMatch(/requireAdmin/);
    expect(shell).toMatch(/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/);
    const protectedLayout = codeOf(PROTECTED_LAYOUT);
    expect(protectedLayout).toMatch(/await\s+requireAdmin\(\)/);
    expect(exists("app/admin/page.tsx"), "보호 대상 페이지는 (protected) 안으로 옮겨야 한다").toBe(false);
    expect(exists("app/admin/(protected)/login")).toBe(false);
  });

  test("미들웨어 — 세션 쿠키 갱신만 한다. 인가 판단(is_admin·requireAdmin·리다이렉트)은 없다", () => {
    const src = codeOf("middleware.ts");
    expect(src).toMatch(/startsWith\(\s*["'`]\/admin["'`]\s*\)/);
    expect(src).toMatch(/createSsrClient|createServerClient/);
    expect(src).toMatch(/getUser\(\)/);
    expect(src).not.toMatch(/is_admin|requireAdmin/);
    expect(src).not.toMatch(/redirect/i);
  });

  test("lib/guard/deps.ts — scope 'admin' 이 추가됐고 prefix 가 분리된다. 기존 scope 는 그대로", async () => {
    const deps = await vi.importActual<typeof import("@/lib/guard/deps")>("@/lib/guard/deps");
    expect(deps.rateLimitPrefix("admin", "known", "short")).toBe("guard:admin:known:short");
    expect(deps.rateLimitPrefix("reserve", "known", "short")).toBe("guard:reserve:known:short");
    expect(deps.rateLimitPrefix("check", "unknown", "long")).toBe("guard:check:unknown:long");
    expect(typeof deps.adminGuardDeps).toBe("function");
  });

  test(".env.example 에 ADMIN_EMAILS 가 공란으로 있고, 기존 키는 그대로다", () => {
    const env = read(".env.example");
    expect(env).toMatch(/^ADMIN_EMAILS=$/m);
    for (const k of ["GUARD_SECRET", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "NEXT_PUBLIC_SITE_URL"]) {
      expect(env, k).toMatch(new RegExp(`^${k}=$`, "m"));
    }
  });

  test("package.json 에 게이트 스크립트가 노출된다", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["check:admin"]).toBe("bash scripts/check-admin-no-service-role.sh");
    expect(pkg.scripts["check:pricing"]).toBe("bash scripts/check-no-pricing.sh");
  });

  test("messages/ko.json — admin 네임스페이스가 끝에 붙었고 필요한 키가 다 있다. en.json 은 그대로", () => {
    const ko = JSON.parse(read("messages/ko.json")) as Record<string, Record<string, Record<string, string>>>;
    const keys = Object.keys(ko);
    expect(keys[keys.length - 1]).toBe("admin");
    for (const k of ["title", "sub", "emailLabel", "submit", "submitting", "sent", "closed", "unavailable", "invalid", "ratelimit", "infra", "callbackFailed"]) {
      expect(ko.admin.login[k], k).toBeTruthy();
    }
    expect(ko.admin.home.title).toBeTruthy();
    expect(JSON.parse(read("messages/en.json"))).toEqual({});
  });
});

// =============================================================================
// 6-b. 게이트 스크립트 red/green — 픽스처로 exit code 를 실증한다 (tests/gates.test.ts 와 같은 방식)
// =============================================================================
function resolveBash(): { bin: string; env: NodeJS.ProcessEnv } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (process.env.BASH_PATH) return { bin: process.env.BASH_PATH, env };
  if (process.platform !== "win32") return { bin: "bash", env };
  const roots: string[] = [];
  try {
    const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
    roots.push(path.resolve(execPath, "..", "..", ".."));
  } catch {
    // git 이 PATH 에 없으면 아래 고정 후보로 넘어간다
  }
  roots.push("C:\\Program Files\\Git", "C:\\Program Files (x86)\\Git");
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, "Programs", "Git"));
  for (const root of roots) {
    const bin = path.join(root, "bin", "bash.exe");
    if (!existsSync(bin)) continue;
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    env[pathKey] = [path.join(root, "usr", "bin"), path.join(root, "mingw64", "bin"), env[pathKey] ?? ""].join(path.delimiter);
    return { bin, env };
  }
  return { bin: "bash", env };
}
const BASH = resolveBash();
const toPosix = (p: string) => p.split(path.sep).join("/");

function runGate(projectDir: string): Promise<{ status: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(BASH.bin, [toPosix(path.join(ROOT, GATE_SCRIPT))], {
      env: { ...BASH.env, CLAUDE_PROJECT_DIR: toPosix(projectDir) },
      windowsHide: true,
    });
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => {
      out += c;
    });
    child.stderr.setEncoding("utf8").on("data", (c: string) => {
      out += c;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, out }));
  });
}

describe("6-b. scripts/check-admin-no-service-role.sh", { timeout: 60_000 }, () => {
  const dirs: string[] = [];
  const fixture = (files: Record<string, string>): string => {
    const dir = mkdtempSync(path.join(tmpdir(), "p51-gate-"));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
      const p = path.join(dir, rel);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    return dir;
  };

  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  test("대상 디렉터리가 없으면 통과 (0P5 선례)", async () => {
    const r = await runGate(fixture({ "package.json": "{}\n" }));
    expect(r.out).toBeTruthy();
    expect(r.status).toBe(0);
  });

  test("깨끗한 admin 경로는 통과", async () => {
    const r = await runGate(
      fixture({
        "app/admin/page.tsx": "export default function P() { return null; }\n",
        "actions/admin/auth.ts": '"use server";\nimport { createSsrClient } from "@/lib/supabase/ssr";\n',
      }),
    );
    expect(r.status, r.out).toBe(0);
  });

  test.for([
    ["createServiceClient", 'import { createServiceClient } from "@/lib/x";\n'],
    ["SUPABASE_SERVICE_ROLE_KEY", "const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n"],
    ["supabase/server", 'import { c } from "@/lib/supabase/server";\n'],
  ] as const)("%s 가 admin 경로에 있으면 실패", async ([label, body]) => {
    const r = await runGate(fixture({ "app/admin/(protected)/page.tsx": body }));
    expect(r.status, `${label}: ${r.out}`).toBe(1);
    expect(r.out).toContain("admin");
  });

  test("admin 밖(app/api·lib/queries)의 서비스 롤은 잡지 않는다 — 이 게이트의 범위는 관리자 경로다", async () => {
    const r = await runGate(
      fixture({
        "app/api/cron/purge/route.ts": 'import { createServiceClient } from "@/lib/supabase/server";\n',
        "lib/queries/recent.ts": 'import { createServiceClient } from "../supabase/server";\n',
        "app/admin/page.tsx": "export default function P() { return null; }\n",
      }),
    );
    expect(r.status, r.out).toBe(0);
  });

  /**
   * P5-3 독립 리뷰 M4 — 게이트가 `app/admin`·`actions/admin` 만 보던 시절에는 **쿼리가 사는 lib/admin** 이 사각지대였다.
   * 화면이 깨끗해도 거기서 서비스 롤로 읽으면 RLS 를 우회한다. 대상에 추가했고, 여기서 red 로 실증한다.
   */
  test.for([
    ["lib/admin", "lib/admin/reservations.ts"],
    ["components/admin", "components/admin/Panel.tsx"],
  ] as const)("%s 의 서비스 롤도 잡는다 (M4)", async ([label, file]) => {
    const r = await runGate(
      fixture({
        "app/admin/page.tsx": "export default function P() { return null; }\n",
        [file]: 'import { createServiceClient } from "@/lib/supabase/server";\n',
      }),
    );
    expect(r.status, `${label}: ${r.out}`).toBe(1);
    expect(r.out).toContain("admin");
  });

  test("실제 저장소에서도 통과한다", async () => {
    const r = await runGate(ROOT);
    expect(r.status, r.out).toBe(0);
  });
});

// =============================================================================
// 7. DB 실증 — 로컬 스택 + REQUIRE_DB_TESTS=1 일 때만 (원격에는 어떤 쓰기도 하지 않는다)
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[admin-auth.test] DB 실증 블록 skip — ${gate.reason}`);
}

test("DB 쓰기 가드 — 원격 URL 이면 REQUIRE_DB_TESTS=1 을 강제해도 닫힌다", () => {
  const forced = dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, REQUIRE_DB_TESTS: "1" });
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|kong)(:|\/|$)/i.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) {
    expect(forced.allowed).toBe(false);
    expect(gate.allowed).toBe(false);
  } else {
    expect(forced.allowed).toBe(true);
  }
});

describe.skipIf(!gate.allowed || !env.hasServiceRole)("7. DB — is_admin() RLS 실증 (로컬 스택 + REQUIRE_DB_TESTS=1)", { timeout: 60_000 }, () => {
  // 이 블록은 pending 통지 1건을 만들어 블록이 끝날 때까지 들고 있는다 — 0005 claim 의 사정권 안이라
  // outbox 계열 파일의 claim/reap 단언과 겹치면 서로를 깨뜨린다 (tests/helpers/db-lock.ts).
  withNotificationsLock();

  const baseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceHeaders = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
  const PASSWORD = `p51-${randomUUID()}`;
  const emailFor = (who: string) => `p51-${RUN}-${who}@example.test`;

  type Res = { status: number; body: unknown };
  async function call(method: string, url: string, hdrs: Record<string, string>, json?: unknown, prefer?: string): Promise<Res> {
    const res = await fetch(url, {
      method,
      headers: prefer ? { ...hdrs, Prefer: prefer } : hdrs,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // JSON 이 아니면 문자열 그대로
    }
    return { status: res.status, body };
  }

  const rest = (method: string, pathAndQuery: string, json?: unknown, prefer?: string) =>
    call(method, `${env.restRoot}${pathAndQuery}`, serviceHeaders, json, prefer);

  const asUser = (token: string, method: string, pathAndQuery: string, json?: unknown) =>
    call(method, `${env.restRoot}${pathAndQuery}`, {
      apikey: env.anonKey as string,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }, json);

  async function createUser(email: string): Promise<string> {
    const r = await call("POST", `${baseUrl()}/auth/v1/admin/users`, serviceHeaders, {
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    expect(r.status, `사용자 생성 실패: ${JSON.stringify(r.body).slice(0, 300)}`).toBeLessThan(300);
    return (r.body as { id: string }).id;
  }

  async function signIn(email: string): Promise<string> {
    const r = await call("POST", `${baseUrl()}/auth/v1/token?grant_type=password`, {
      apikey: env.anonKey as string,
      "Content-Type": "application/json",
    }, { email, password: PASSWORD });
    expect(r.status, `로그인 실패: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(200);
    return (r.body as { access_token: string }).access_token;
  }

  let adminId = "";
  let plainId = "";
  let adminToken = "";
  let plainToken = "";
  let reservationId = "";

  beforeEach(() => {
    // 이 블록은 fetch 만 쓴다 — 위 vi.mock 들과 무관하다.
  });

  test("준비 — 사용자 2명 · 예약 1건 · 통지 1건 (전부 로컬 스택)", async () => {
    const probe = await rest("GET", "/reservations?select=id&limit=1");
    expect(probe.status, "0009 이전 마이그레이션이 적용되지 않았다").toBe(200);

    adminId = await createUser(emailFor("admin"));
    plainId = await createUser(emailFor("plain"));
    adminToken = await signIn(emailFor("admin"));
    plainToken = await signIn(emailFor("plain"));

    const now = new Date();
    const later = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const ins = await rest(
      "POST",
      "/reservations",
      {
        public_code: `P51${RUN.slice(0, 5).toUpperCase()}`,
        name: "P51",
        phone: "010-0000-0000",
        vehicle_slug: "bus45",
        purpose_code: "family",
        origin_code: "SEL",
        destination_code: "BSN",
        waypoint_codes: [],
        trip_type: "oneway",
        depart_at: later.toISOString(),
        return_at: null,
        nights: 0,
        bus_count: 1,
        locale: "ko",
        privacy_consent_at: now.toISOString(),
        privacy_policy_version: "2026-09-11",
        marketing_consent_at: null,
        retention_until: later.toISOString(),
      },
      "return=representation",
    );
    expect(ins.status, JSON.stringify(ins.body).slice(0, 300)).toBe(201);
    reservationId = (ins.body as { id: string }[])[0].id;

    const log = await rest(
      "POST",
      "/notifications_log",
      {
        reservation_id: reservationId,
        event: "created",
        channel: "sms",
        to_phone: "010-0000-0000",
        template: `p51.${RUN}`,
        status: "pending",
      },
      "return=representation",
    );
    expect(log.status, JSON.stringify(log.body).slice(0, 300)).toBe(201);
  });

  test("admin_users 행이 없는 세션은 reservations 를 한 줄도 못 읽는다", async () => {
    const r = await asUser(plainToken, "GET", "/reservations?select=id");
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    expect(r.body).toEqual([]);
    const n = await asUser(plainToken, "GET", "/notifications_log?select=id");
    expect(n.body).toEqual([]);
  });

  test("admin_users 에 행을 넣으면 그 세션만 reservations·notifications_log 를 읽는다", async () => {
    const add = await rest("POST", "/admin_users", { user_id: adminId, email: emailFor("admin"), note: "P5-1 test" });
    expect(add.status, JSON.stringify(add.body).slice(0, 300)).toBeLessThan(300);

    const mine = await asUser(adminToken, "GET", `/reservations?select=id,name&id=eq.${reservationId}`);
    expect(mine.status, JSON.stringify(mine.body).slice(0, 200)).toBe(200);
    expect((mine.body as unknown[]).length).toBe(1);

    const logs = await asUser(adminToken, "GET", `/notifications_log?select=id&template=eq.p51.${RUN}`);
    expect((logs.body as unknown[]).length).toBe(1);

    // 행이 없는 쪽은 여전히 0행 — 표가 곧 명단이다
    const other = await asUser(plainToken, "GET", "/reservations?select=id");
    expect(other.body).toEqual([]);
  });

  test("관리자도 reservations 를 지우거나 새로 넣을 수 없다 (insert·delete 정책이 없다)", async () => {
    const del = await asUser(adminToken, "DELETE", `/reservations?id=eq.${reservationId}`);
    const still = await rest("GET", `/reservations?select=id&id=eq.${reservationId}`);
    expect((still.body as unknown[]).length, `삭제가 통과했다 (HTTP ${del.status})`).toBe(1);

    const ins = await asUser(adminToken, "POST", "/reservations", {
      public_code: `P51X${RUN.slice(0, 4).toUpperCase()}`,
      name: "X",
      phone: "010-0000-0000",
      vehicle_slug: "bus45",
      purpose_code: "family",
      origin_code: "SEL",
      destination_code: "BSN",
      trip_type: "oneway",
      depart_at: new Date().toISOString(),
      privacy_consent_at: new Date().toISOString(),
      privacy_policy_version: "2026-09-11",
      retention_until: new Date().toISOString(),
    });
    // P6-13 실측: 403 · 42501 · "permission denied for table reservations" — 0012 가 authenticated 의 insert 를 회수했다(GRANT 층).
    expectTablePrivilegeDenied(ins, "reservations", "관리자 세션의 reservations INSERT");
  });

  /**
   * P5-3 개정 — 0009 의 `reservations_admin_update` 정책은 **0010 이 제거했다**(독립 리뷰 N5: 컬럼 제한이 없어
   * 관리자 세션이 retention_until·privacy_consent_at 까지 고칠 수 있었다). 이제 관리자의 쓰기는
   * 0010 의 함수 4개(admin_confirm_reservation·admin_cancel_reservation·admin_complete_reservation·admin_update_memo)뿐이고,
   * 직접 PATCH 는 RLS(정책 없음) + GRANT 회수 두 층에서 막힌다. 전이 자체의 실증은 tests/admin-reservations.test.ts §7.
   * 0009 파일의 정책 텍스트는 그대로다(위 §1 이 단언) — 0010 이 런타임 상태를 바꾼 것이다.
   */
  test("관리자도 reservations 를 직접 UPDATE 할 수 없다 — 0010 이 정책을 회수했다 (P5-3 · 리뷰 N5·M3)", async () => {
    const up = await asUser(adminToken, "PATCH", `/reservations?id=eq.${reservationId}`, { status: "confirmed" });
    // M3: "행이 안 바뀌었다" 만 보면 네트워크 오류로도 통과한다. 요청이 **표까지 도달해 거절당했는지**를 먼저 단언한다.
    // GRANT 회수 + 정책 부재라 PostgREST 는 권한 오류를 준다. P6-13 실측: 403 · 42501 · "permission denied for table reservations".
    // 5xx·2xx 는 물론 400(검증 실패)·404(표 이름 오타)도 이 단언을 깬다.
    expectTablePrivilegeDenied(up, "reservations", "관리자 세션의 reservations 직접 UPDATE");
    const row = await rest("GET", `/reservations?select=status&id=eq.${reservationId}`);
    expect((row.body as { status: string }[])[0].status, `직접 UPDATE 가 통과했다 (HTTP ${up.status})`).toBe("new");
  });

  /**
   * 독립 리뷰 M5 — 0009 는 콘텐츠 표 6개의 insert·update·delete 권한을 **모든 authenticated 롤**에 준다.
   * 막는 것은 `<table>_admin_all` 정책의 using·with check 뿐이다. 그 한 줄이 빠지면 로그인만 한 사람이 공지를 쓴다.
   * 그래서 명단에 없는 세션으로 실제 쓰기를 시도해 DB 가 거부하는지 본다(정책 텍스트가 아니라 거동으로).
   */
  /**
   * P5-16(0020) 개정 — 콘텐츠 여섯 표의 insert·update·delete 는 **이제 `authenticated` 에게 GRANT 가 없다**(known-defects D10).
   * 그래서 명단 밖 세션의 직접 쓰기는 정책까지 가지 않고 **GRANT 층**에서 막힌다: 셋 다 `permission denied for table <표>`.
   * 옛 판(0009 정책만)은 insert 만 명시적 거부였고 update·delete 는 "0행" 으로 조용히 지나갔다 — 이제 셋 다 명시적이다.
   * 관리자의 쓰기는 0020 의 definer 함수로 가고, 명단 밖 세션이 그 함수를 부르면 **함수 첫 문장의 `is_admin()` 가드**가
   * 42501 로 막는다(EXECUTE 는 있다 — 그래서 메시지로 판정한다). 대조군: 명단에 있는 세션은 같은 함수로 같은 행을 고친다.
   */
  test("명단에 없는 로그인 사용자는 콘텐츠 표에 쓰지 못한다 — notices·popups insert/update/delete (M5 · 0020 뒤 GRANT 층 + 함수 가드)", async () => {
    const seedNotice = await rest("POST", "/notices", { title: `P51 ${RUN}`, body: "seed", active: true }, "return=representation");
    expect(seedNotice.status, JSON.stringify(seedNotice.body).slice(0, 200)).toBe(201);
    const noticeId = (seedNotice.body as { id: number }[])[0].id;

    const today = new Date().toISOString().slice(0, 10);
    const seedPopup = await rest(
      "POST",
      "/popups",
      { title: `P51 ${RUN}`, body: "seed", starts_at: today, ends_at: today, active: true },
      "return=representation",
    );
    expect(seedPopup.status, JSON.stringify(seedPopup.body).slice(0, 200)).toBe(201);
    const popupId = (seedPopup.body as { id: number }[])[0].id;

    // ① 직접 쓰기 — insert·update·delete 셋 다 GRANT 층 거부(403 · 42501 · permission denied for table <표>).
    for (const [table, row, id] of [
      ["notices", { title: `P51 ${RUN} intruder`, body: "x" }, noticeId],
      ["popups", { title: `P51 ${RUN} intruder`, body: "x", starts_at: today, ends_at: today }, popupId],
    ] as const) {
      expectTablePrivilegeDenied(await asUser(plainToken, "POST", `/${table}`, row), table, `명단 밖 세션의 ${table} INSERT`);
      expectTablePrivilegeDenied(await asUser(plainToken, "PATCH", `/${table}?id=eq.${id}`, { title: "hijacked" }), table, `명단 밖 세션의 ${table} UPDATE`);
      expectTablePrivilegeDenied(await asUser(plainToken, "DELETE", `/${table}?id=eq.${id}`), table, `명단 밖 세션의 ${table} DELETE`);
    }

    // ② 관리자 경로(definer 함수) — 함수 가드가 42501 로 막는다. 메시지까지 맞춰야 "EXECUTE 는 있었고 가드가 막았다" 가 증명된다.
    const rpc = (token: string, fn: string, args: Record<string, unknown>) => asUser(token, "POST", `/rpc/${fn}`, args);
    const noticeArgs = { p_id: noticeId, p_title: "hijacked", p_body: "x", p_category: "info", p_published_at: today, p_active: true };
    for (const [fn, args] of [
      ["admin_create_notice", { p_title: `P51 ${RUN} intruder`, p_body: "x", p_category: "info", p_published_at: today, p_active: true }],
      ["admin_update_notice", noticeArgs],
      ["admin_delete_notice", { p_id: noticeId }],
      ["admin_update_popup", { p_id: popupId, p_title: "hijacked", p_body: "x", p_image_path: null, p_starts_at: today, p_ends_at: today, p_active: true }],
      ["admin_delete_popup", { p_id: popupId }],
    ] as const) {
      expectRaisedDenied(await rpc(plainToken, fn, args), `${fn}: 관리자 명단에 없는 호출자다`, `명단 밖 세션의 ${fn}`);
    }

    // 행이 그대로다 — 거부 응답만이 아니라 결과로도 본다.
    const notice = await rest("GET", `/notices?select=id,title&id=eq.${noticeId}`);
    expect((notice.body as { title: string }[]).map((n) => n.title)).toEqual([`P51 ${RUN}`]);
    const popup = await rest("GET", `/popups?select=id,title&id=eq.${popupId}`);
    expect((popup.body as { title: string }[]).map((p) => p.title)).toEqual([`P51 ${RUN}`]);
    const intruderRows = await rest("GET", `/notices?select=id&title=eq.${encodeURIComponent(`P51 ${RUN} intruder`)}`);
    expect(intruderRows.body, "명단 밖 세션이 공지를 만들었다").toEqual([]);

    // 대조군: 명단에 있는 세션은 **같은 함수**로 같은 행을 고친다(함수가 통째로 막는 것이 아니라 명단으로 갈린다)
    const asAdmin = await rpc(adminToken, "admin_update_notice", { ...noticeArgs, p_title: `P51 ${RUN} by admin`, p_body: "seed" });
    expect(asAdmin.status, JSON.stringify(asAdmin.body).slice(0, 200)).toBe(200);
    expect(asAdmin.body, "관리자 update 가 바뀐 행을 돌려주지 않았다").toEqual([{ id: noticeId }]);
    const after = await rest("GET", `/notices?select=title&id=eq.${noticeId}`);
    expect((after.body as { title: string }[])[0].title).toBe(`P51 ${RUN} by admin`);

    await rest("DELETE", `/notices?id=eq.${noticeId}`);
    await rest("DELETE", `/popups?id=eq.${popupId}`);
  });

  /**
   * 대조군 (P6-13 · P5-16 개정) — 같은 42501 이라도 **무엇이 막았는지**는 메시지로 갈리고, 부재는 아예 다른 응답이다.
   * GRANT 거부(`permission denied for table …`) · 함수 가드 거부(definer 의 `raise … 42501`) · EXECUTE 거부
   * (`permission denied for function …`) · 없는 표(404 PGRST205). 판정 헬퍼가 서로를 받아들이지 않는지 실제 응답으로 보인다.
   *
   * 옛 판은 둘째 자리에 **RLS with-check 거부**(명단 밖 세션의 notices insert)를 썼다. 0020 뒤로는 그 응답을
   * 실제 스키마에서 만들 수 없다 — `authenticated` 에게 insert 가 있는 표가 public 에 하나도 남지 않았다
   * (tests/db-privilege-gate.test.ts 의 AUTH_WRITE 가 비었다). 같은 요청이 이제 GRANT 거부로 온다는 것을 여기서 함께 단언한다.
   * RLS 판정 자체의 이빨은 합성 응답으로 tests/expect-denied.test.ts 가 계속 본다.
   */
  test("대조군 — GRANT 거부·함수 가드 거부·EXECUTE 거부·부재는 서로 다른 응답이고 판정이 섞이지 않는다", async () => {
    const grantDenied = await asUser(adminToken, "POST", "/reservations", { public_code: `P51Y${RUN.slice(0, 4).toUpperCase()}` });
    expectTablePrivilegeDenied(grantDenied, "reservations", "관리자 세션의 reservations INSERT");
    expect(() => expectRlsInsertDenied(grantDenied, "reservations", "대조"), "RLS 판정이 GRANT 거부를 받아들였다").toThrow();
    expect(() => expectRaisedDenied(grantDenied, "admin_create_notice: 관리자 명단에 없는 호출자다", "대조"), "가드 판정이 GRANT 거부를 받아들였다").toThrow();

    // 옛 RLS 거부 자리 — 0020 뒤로는 GRANT 층이 먼저 막는다(위 머리 주석).
    const formerRls = await asUser(plainToken, "POST", "/notices", { title: `P51 ${RUN} control`, body: "x" });
    expectTablePrivilegeDenied(formerRls, "notices", "명단 밖 세션의 notices INSERT (0020 뒤)");
    expect(() => expectRlsInsertDenied(formerRls, "notices", "대조"), "RLS 판정이 GRANT 거부를 받아들였다").toThrow();

    const today = new Date().toISOString().slice(0, 10);
    const args = { p_title: `P51 ${RUN} control`, p_body: "x", p_category: "info", p_published_at: today, p_active: false };
    const guardDenied = await asUser(plainToken, "POST", "/rpc/admin_create_notice", args);
    expectRaisedDenied(guardDenied, "admin_create_notice: 관리자 명단에 없는 호출자다", "명단 밖 세션의 admin_create_notice");
    expect(() => expectFunctionPrivilegeDenied(guardDenied, "admin_create_notice", "대조"), "EXECUTE 판정이 가드 거부를 받아들였다").toThrow();
    expect(() => expectTablePrivilegeDenied(guardDenied, "notices", "대조"), "GRANT 판정이 가드 거부를 받아들였다").toThrow();

    const execDenied = await call("POST", `${env.restRoot}/rpc/admin_create_notice`, {
      apikey: env.anonKey as string,
      Authorization: `Bearer ${env.anonKey}`,
      "Content-Type": "application/json",
    }, args);
    expectFunctionPrivilegeDenied(execDenied, "admin_create_notice", "anon 의 admin_create_notice");
    expect(() => expectRaisedDenied(execDenied, "admin_create_notice: 관리자 명단에 없는 호출자다", "대조"), "가드 판정이 EXECUTE 거부를 받아들였다").toThrow();

    const missing = await asUser(plainToken, "POST", "/p613_no_such_table", { x: 1 });
    expect(missing.status, JSON.stringify(missing.body).slice(0, 200)).toBe(404);
    expect((missing.body as { code?: string } | null)?.code).toBe("PGRST205");
    expect(() => expectRlsInsertDenied(missing, "p613_no_such_table", "대조"), "거부 판정이 '없는 표' 를 받아들였다").toThrow();
    expect(() => expectTablePrivilegeDenied(missing, "p613_no_such_table", "대조"), "GRANT 판정이 '없는 표' 를 받아들였다").toThrow();

    const left = await rest("GET", `/notices?select=id&title=eq.${encodeURIComponent(`P51 ${RUN} control`)}`);
    expect(left.body, "대조군 요청이 공지를 만들었다").toEqual([]);
  });

  test("관리자도 admin_users 는 못 읽는다 — 명단 자체가 권한 상승 경로다", async () => {
    const r = await asUser(adminToken, "GET", "/admin_users?select=user_id,email");
    // 0009 가 `revoke all on table admin_users from anon, authenticated` 를 했으므로 "200 + 빈 배열" 갈래는 더 이상 정답이 아니다
    // (그 갈래는 권한이 살아 있고 RLS 만 막는 상태도 통과시켰다). P6-13 실측: 403 · 42501 · "permission denied for table admin_users".
    expectTablePrivilegeDenied(r, "admin_users", "관리자 세션의 admin_users SELECT");
  });

  test("anon 은 is_admin() 을 실행조차 할 수 없다", async () => {
    const anon = await call("POST", `${baseUrl()}/rest/v1/rpc/is_admin`, {
      apikey: env.anonKey as string,
      Authorization: `Bearer ${env.anonKey}`,
      "Content-Type": "application/json",
    }, {});
    // P6-13 실측: 401 · 42501 · "permission denied for function is_admin" — 0009 가 anon 의 EXECUTE 를 회수했다.
    expectFunctionPrivilegeDenied(anon, "is_admin", "anon 의 is_admin() 호출");

    // 로그인한 사용자는 실행할 수 있고, 명단에 따라 답이 갈린다
    const yes = await call("POST", `${baseUrl()}/rest/v1/rpc/is_admin`, {
      apikey: env.anonKey as string,
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    }, {});
    expect(yes.status).toBe(200);
    expect(yes.body).toBe(true);

    const no = await call("POST", `${baseUrl()}/rest/v1/rpc/is_admin`, {
      apikey: env.anonKey as string,
      Authorization: `Bearer ${plainToken}`,
      "Content-Type": "application/json",
    }, {});
    expect(no.body).toBe(false);
  });

  test("공개 조회는 그대로다 — anon 은 활성 공지를 계속 읽는다 (정책 OR 결합, admin 정책은 to authenticated)", async () => {
    const r = await call("GET", `${env.restRoot}/notices?select=id&limit=1`, {
      apikey: env.anonKey as string,
      Authorization: `Bearer ${env.anonKey}`,
    });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
  });

  test("정리 — 만든 것을 전부 지운다", async () => {
    await rest("DELETE", `/notifications_log?template=eq.p51.${RUN}`);
    await rest("DELETE", `/reservations?id=eq.${reservationId}`);
    // M5 가 만든 콘텐츠 행 — 각 테스트가 스스로 지우지만, 중간에 실패했을 때를 대비해 접두사로 한 번 더 쓸어낸다.
    for (const table of ["notices", "popups"]) {
      await rest("DELETE", `/${table}?title=like.${encodeURIComponent(`*${RUN}*`)}`);
    }
    await rest("DELETE", `/admin_users?user_id=eq.${adminId}`);
    for (const id of [adminId, plainId]) {
      if (id) await call("DELETE", `${baseUrl()}/auth/v1/admin/users/${id}`, serviceHeaders);
    }
    const leftRes = await rest("GET", `/reservations?select=id&id=eq.${reservationId}`);
    const leftAdmins = await rest("GET", `/admin_users?select=user_id&user_id=eq.${adminId}`);
    expect(leftRes.body).toEqual([]);
    expect(leftAdmins.body).toEqual([]);
  });
});
