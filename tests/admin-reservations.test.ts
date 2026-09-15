/**
 * P5-3 — 관리자 예약 현황·상세 + 확정/취소/메모 (플랜 v4 P5-3 · ADR-2·ADR-3·ADR-4·ADR-7 · CLAUDE.md §3·§7).
 *
 * 이 태스크가 지키는 것 두 가지:
 *   1. **확정은 한 문장이다.** 액션이 "읽고 → 판단하고 → 쓰고 → 큐에 넣기" 를 하면 두 번 클릭에 고객 문자가 두 번 쌓인다.
 *      0010 의 `update … where id = p_id and status = 'new'` 가 경합 방어선이고, `found` 가 false 면 큐에 아무것도 넣지 않는다.
 *   2. **definer 함수는 스스로 권한을 확인한다.** security definer 는 RLS 를 우회한다 — 첫 줄의 `is_admin()` 가드가 빠지면
 *      로그인한 아무나 남의 예약을 확정한다.
 *
 * 브리프 §검증 1~7 을 그대로 단언한다:
 *   1. 0010 SQL 텍스트 — 네 함수의 가드·definer·search_path·revoke/grant · `and status='new'` · 역방향 전이 부재 ·
 *      `reservations_admin_update` 제거 · 롤백(가드·정책 복원·재실행 안전)
 *   2. 목록/상세 쿼리 — select 화이트리스트, limit+1 hasMore, status 필터, 잘못된 입력 거부(DB 호출 0)
 *   3. 액션 — requireAdmin 먼저 → rpc → 성공(변경 있음) 시에만 revalidate. noop 은 오류가 아니다
 *   4. 개인정보 0 — 결과 객체·로그에 이름·전화·이메일·메시지 0
 *   5. 정적 — 서비스 롤 0 · 'use server' export 4 · unstable_cache 0 · 한글 리터럴 0 · 게이트 구조 검사(리뷰 F1·F2)
 *   6. DB 실증 — 로컬 스택 가드 뒤에서만(원격에는 어떤 쓰기도 하지 않는다). CI db-test 에서 돈다
 *
 * tests/ 아래라 게이트 3종의 검사 대상이다 — 금지어·임시값 마커 리터럴을 그대로 쓰지 않는다.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";

// server-only 는 vitest(node) 에서 import 즉시 throw 한다 — 빈 모듈로 바꿔치기(tests/admin-auth.test.ts 선례).
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/supabase/ssr", () => ({ createSsrClient: vi.fn() }));
vi.mock("@/lib/auth/requireAdmin", () => ({
  requireAdmin: vi.fn(async () => ({ userId: "admin-uuid", email: "owner@example.test" })),
}));
vi.mock("@/lib/ports/after", () => ({ runAfter: vi.fn((task: () => unknown) => void task()) }));
vi.mock("@/lib/ports/revalidate", () => ({ revalidate: vi.fn() }));
vi.mock("@/lib/log", () => ({ structuredLog: vi.fn() }));

import { revalidatePath } from "next/cache";

import {
  cancelReservation,
  completeReservation,
  confirmReservation,
  saveReservationMemo,
} from "@/actions/admin/reservation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { structuredLog } from "@/lib/log";
import { revalidate } from "@/lib/ports/revalidate";
import { createSsrClient } from "@/lib/supabase/ssr";
import {
  ADMIN_REVALIDATE_PATH,
  ADMIN_RPC,
  FAILED_RESULT,
  toActionResult,
  type AdminActionResult,
} from "@/lib/admin/result";
import {
  DEFAULT_ADMIN_PAGE_SIZE,
  MAX_ADMIN_PAGE_SIZE,
  RESERVATION_DETAIL_COLUMNS,
  RESERVATION_DETAIL_SELECT,
  RESERVATION_LIST_COLUMNS,
  RESERVATION_LIST_SELECT,
  STATUS_FILTERS,
  getReservation,
  isUuid,
  listReservations,
  parseCursor,
  parseStatusFilter,
} from "@/lib/admin/reservations";
import { QUERY_TAGS } from "@/lib/queries/tags";

// =============================================================================
// 공통 헬퍼 (tests/admin-auth.test.ts 와 같은 구현)
// =============================================================================
const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const exists = (rel: string) => existsSync(path.join(ROOT, rel));

const UP_SQL = "supabase/migrations/0010_admin_reservation_actions.sql";
const DOWN_SQL = "supabase/rollbacks/0010_admin_reservation_actions.down.sql";
const LIB_READ = "lib/admin/reservations.ts";
const LIB_RESULT = "lib/admin/result.ts";
const ACTION = "actions/admin/reservation.ts";
const LIST_PAGE = "app/admin/(protected)/reservations/page.tsx";
const DETAIL_PAGE = "app/admin/(protected)/reservations/[id]/page.tsx";
const PROTECTED_LAYOUT = "app/admin/(protected)/layout.tsx";
const TABS_DEF = "components/admin/tabs.ts";
const TABS_UI = "components/admin/AdminTabs.tsx";
const ACTIONS_UI = "components/admin/ReservationActions.tsx";
const ADMIN_CSS = "components/admin/admin.module.css";

const stripSqlComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const compact = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const sqlCode = (rel: string) => compact(stripSqlComments(read(rel)));

/** 주석(`//` 줄 끝, 블록)을 걷어낸 코드만 — tests/admin-auth.test.ts 와 같은 구현. */
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

function walk(absDir: string): string[] {
  if (!existsSync(absDir)) return [];
  return readdirSync(absDir).flatMap((n) => {
    const p = path.join(absDir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

/** 0010 안에서 함수 하나의 본문만 — 다음 `create or replace function` 또는 `revoke` 앞까지. */
function fnBody(name: string): string {
  const code = sqlCode(UP_SQL);
  const start = code.indexOf(`create or replace function ${name}`);
  expect(start, `${name} 함수가 없다`).toBeGreaterThanOrEqual(0);
  const rest = code.slice(start + 1);
  const nextFn = rest.indexOf("create or replace function");
  const nextRevoke = rest.indexOf("revoke all on function");
  const ends = [nextFn, nextRevoke].filter((i) => i >= 0);
  const end = ends.length > 0 ? Math.min(...ends) : rest.length;
  return rest.slice(0, end);
}

const FN_NAMES = ["admin_confirm_reservation", "admin_cancel_reservation", "admin_complete_reservation", "admin_update_memo"] as const;

// =============================================================================
// 1. supabase/migrations/0010_admin_reservation_actions.sql — 텍스트
// =============================================================================
describe("1. 0010_admin_reservation_actions.sql", () => {
  test("존재하고, 0010 번호는 이 파일 하나뿐이다. migrations/ 안에 롤백이 섞여 있지 않다", () => {
    expect(exists(UP_SQL)).toBe(true);
    expect(exists(DOWN_SQL)).toBe(true);
    const files = readdirSync(path.join(ROOT, "supabase", "migrations"));
    expect(files.filter((f) => f.startsWith("0010"))).toEqual(["0010_admin_reservation_actions.sql"]);
    expect(files.filter((f) => f.includes(".down."))).toEqual([]);
  });

  test("네 함수 전부 — security definer · search_path = public, pg_temp (pg_temp 를 끝에)", () => {
    for (const fn of FN_NAMES) {
      const body = fnBody(fn);
      expect(body, fn).toMatch(/language plpgsql/);
      expect(body, fn).toMatch(/security definer/);
      expect(body, fn).toMatch(/set search_path = public, pg_temp/);
    }
  });

  test("네 함수 전부 — 첫 문장이 is_admin() 가드다 (definer 는 RLS 를 우회한다)", () => {
    for (const fn of FN_NAMES) {
      const body = fnBody(fn);
      expect(body, fn).toMatch(/if not is_admin\(\) then raise exception/);
      // 가드가 첫 문장인가 — begin 과 raise 사이에 update/insert/select 가 없다
      const begin = body.indexOf("begin");
      const guard = body.indexOf("if not is_admin()");
      expect(guard, `${fn}: is_admin() 가드가 begin 뒤에 없다`).toBeGreaterThan(begin);
      const before = body.slice(begin, guard);
      expect(before, `${fn}: 가드보다 먼저 도는 문장이 있다`).not.toMatch(/\b(update|insert|delete)\b/);
    }
  });

  test("확정 — `and status = 'new'` 가 경합 방어선이고, found 가 false 면 noop 이다", () => {
    const body = fnBody("admin_confirm_reservation");
    expect(body).toMatch(/update reservations set status = 'confirmed', confirmed_at = now\(\)/);
    expect(body).toMatch(/admin_memo = coalesce\(p_memo, admin_memo\)/);
    expect(body).toMatch(/where id = p_id and status = 'new'/);
    expect(body).toMatch(/if not found then/);
    expect(body).toMatch(/'noop'/);
  });

  test("확정 성공에서만 통지를 넣는다 — insert 가 not found 분기 뒤에 있고, 넣은 건수를 enqueued 로 돌려준다", () => {
    const body = fnBody("admin_confirm_reservation");
    const notFound = body.indexOf("if not found then");
    const insert = body.indexOf("insert into notifications_log");
    expect(insert, "통지 insert 가 없다").toBeGreaterThan(0);
    expect(insert, "통지 insert 가 not found 분기보다 먼저다 — noop 인데도 큐에 쌓인다").toBeGreaterThan(notFound);
    expect(body).toMatch(/get diagnostics/);
    expect(body).toMatch(/'confirmed\.customer\.sms'/);
    expect(body).toMatch(/'pending'/);
    // 중복 방지 사전 확인 — 0005 의 부분 유니크가 마지막 층이고 여기가 첫 층
    expect(body).toMatch(/not exists/);
  });

  test("취소 — new·confirmed 만 cancelled 로. 통지는 넣지 않는다 (문안 미승인)", () => {
    const body = fnBody("admin_cancel_reservation");
    expect(body).toMatch(/update reservations set status = 'cancelled'/);
    expect(body).toMatch(/where id = p_id and status in \('new', 'confirmed'\)/);
    expect(body, "취소가 통지를 큐에 넣고 있다 — 문안이 승인되지 않았다").not.toMatch(/insert into notifications_log/);
  });

  /**
   * 리뷰 M1 — 목록에는 '완료' 필터가 있는데 0010 에는 done 으로 가는 길이 없었다(영원히 비는 필터).
   * 완료는 confirmed 에서만 간다: 확정하지 않은 운행이 끝났다는 기록은 통지 이력과 어긋난다.
   */
  test("완료 — confirmed 만 done 으로. 통지는 넣지 않는다 (M1)", () => {
    const body = fnBody("admin_complete_reservation");
    expect(body).toMatch(/update reservations set status = 'done'/);
    expect(body).toMatch(/where id = p_id and status = 'confirmed'/);
    expect(body, "new 에서 곧바로 done 으로 건너뛰는 경로를 열었다").not.toMatch(/status in \('new'/);
    expect(body, "완료가 통지를 큐에 넣고 있다").not.toMatch(/insert into notifications_log/);
    expect(body).toMatch(/'completed'/);
    expect(body).toMatch(/'noop'/);
  });

  test("메모 — admin_memo 만 바꾼다 (리뷰 N5 에 대한 답)", () => {
    const body = fnBody("admin_update_memo");
    expect(body).toMatch(/update reservations set admin_memo = p_memo/);
    expect(body, "메모 함수가 status 를 건드린다").not.toMatch(/set[^;]*\bstatus\b/);
    expect(body).not.toMatch(/insert into notifications_log/);
  });

  test("전이는 앞으로만 간다 — new→confirmed→done · new·confirmed→cancelled 뿐이고 역방향은 없다", () => {
    const expected: Record<string, { to: string; from: string[] }> = {
      admin_confirm_reservation: { to: "confirmed", from: ["new"] },
      admin_cancel_reservation: { to: "cancelled", from: ["new", "confirmed"] },
      admin_complete_reservation: { to: "done", from: ["confirmed"] },
    };
    for (const [fn, want] of Object.entries(expected)) {
      const body = fnBody(fn);
      expect([...body.matchAll(/set status = '(\w+)'/g)].map((m) => m[1]), `${fn}: 바꾸는 상태`).toEqual([want.to]);
      const where = body.match(/where id = p_id and status (?:= '(\w+)'|in \(([^)]*)\))/);
      expect(where, `${fn}: status 조건 없는 update — 경합 방어선이 없다`).not.toBeNull();
      const from = where![1] ? [where![1]] : (where![2] ?? "").split(",").map((x) => x.trim().replace(/'/g, ""));
      expect(from, `${fn}: 출발 상태`).toEqual(want.from);
    }
    const code = sqlCode(UP_SQL);
    expect(code, "new 로 되돌리는 경로가 있다").not.toMatch(/set status = 'new'/);
    expect(code, "done 에서 출발하는 전이가 있다").not.toMatch(/and status = 'done'/);
    expect(code, "cancelled 에서 출발하는 전이가 있다").not.toMatch(/and status = 'cancelled'/);
    expect(fnBody("admin_update_memo"), "메모 함수가 상태를 바꾼다").not.toMatch(/set status/);
  });

  /**
   * 리뷰 M2 — 이 테스트는 이름만 "서비스 롤에 주지 않는다" 였고 실제로는 그것을 단언하지 않았다.
   * 고른 답: **회수 목록에 service_role 을 추가**하고 여기서 단언한다(이름을 낮추지 않았다).
   * 이유는 0010 헤더가 이미 "배치가 예약을 확정하는 경로는 없다" 고 선언했기 때문이다 — 선언과 코드가 갈리면 코드를 맞춘다.
   * Supabase 의 public 스키마 기본권한은 새 함수의 execute 를 service_role 에도 주므로, 회수하지 않으면 그 선언은 사실이 아니었다.
   */
  test("실행 권한 — public·anon·service_role 에서 회수하고 authenticated 에게만 준다 (M2)", () => {
    const code = sqlCode(UP_SQL);
    for (const fn of FN_NAMES) {
      expect(code, fn).toMatch(new RegExp(`revoke all on function ${fn}\\([^)]*\\) from public, anon, service_role`));
      expect(code, fn).toMatch(new RegExp(`grant execute on function ${fn}\\([^)]*\\) to authenticated`));
    }
    expect(code).not.toMatch(/grant execute on function admin_[a-z_]+\([^)]*\) to (anon|public|service_role)/);
  });

  test("0009 의 reservations_admin_update 정책을 제거한다 — 쓰기는 네 함수로만 (리뷰 N5)", () => {
    const code = sqlCode(UP_SQL);
    expect(code).toMatch(/drop policy if exists reservations_admin_update on reservations/);
    expect(code, "정책을 지우면서 다시 만들면 의미가 없다").not.toMatch(/create policy reservations_admin_update/);
    // GRANT 층에서도 같은 뜻을 못박는다 — RLS 는 "어느 행", GRANT 는 "어느 동작"
    expect(code).toMatch(/revoke update on table reservations from authenticated/);
    expect(code, "select 까지 회수하면 관리자 화면이 통째로 죽는다").not.toMatch(/revoke select[^;]*on table reservations/);
  });

  test("0001~0009 를 수정하지 않는다 — 0010 은 파일 하나를 더할 뿐이다", () => {
    // 0009 의 select 정책은 그대로 살아 있어야 한다(목록·상세가 그것으로 읽는다)
    const nine = sqlCode("supabase/migrations/0009_admin_rls.sql");
    expect(nine).toMatch(/create policy reservations_admin_select on reservations for select to authenticated using \(is_admin\(\)\)/);
    expect(nine).toMatch(/create policy reservations_admin_update on reservations/);
  });
});

// =============================================================================
// 2. 롤백
// =============================================================================
describe("2. 0010 롤백", () => {
  test("rollbacks/ 에 있고 트랜잭션 안에서 돈다 + 수동 실행·repair 안내 주석", () => {
    const raw = read(DOWN_SQL);
    const code = sqlCode(DOWN_SQL);
    expect(code.startsWith("begin;")).toBe(true);
    expect(code.trimEnd().endsWith("commit;")).toBe(true);
    expect(raw).toMatch(/migration repair --status reverted 0010/);
  });

  test("행이 있으면 raise 로 멈춘다 — 열린 update 정책을 되살리는 것은 사람이 판단한다", () => {
    const code = sqlCode(DOWN_SQL);
    expect(code).toMatch(/from reservations/);
    expect(code).toMatch(/raise exception/);
    expect(code, "롤백이 데이터를 지우면 안 된다").not.toMatch(/delete from|truncate/);
  });

  test("정책과 권한을 0009 상태로 복원한다", () => {
    const code = sqlCode(DOWN_SQL);
    expect(code).toMatch(/create policy reservations_admin_update on reservations for update to authenticated using \(is_admin\(\)\) with check \(is_admin\(\)\)/);
    expect(code).toMatch(/grant update on table reservations to authenticated/);
    for (const fn of FN_NAMES) {
      expect(code, fn).toMatch(new RegExp(`drop function if exists ${fn}`));
    }
  });

  test("재실행 안전 — 없는 것을 지우거나 있는 것을 두 번 만들어도 죽지 않는다", () => {
    const code = sqlCode(DOWN_SQL);
    expect(code).toMatch(/drop policy if exists reservations_admin_update on reservations/);
    expect((code.match(/drop function if exists/g) ?? []).length).toBe(FN_NAMES.length);
  });
});

// =============================================================================
// 3. lib/admin/reservations.ts — 읽기 (mock 클라이언트, 네트워크 없음)
// =============================================================================
type Call = { method: string; args: unknown[] };

/** 모든 메서드가 자기 자신을 돌려주는 체인 + thenable (tests/gallery-albums.test.ts 와 같은 구현). */
function fakeClient(result: { data: unknown; error: { code?: string; message: string } | null }): {
  client: never;
  calls: Call[];
} {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "select", "eq", "in", "order", "limit", "range", "maybeSingle", "single", "overrideTypes"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return { client: chain as never, calls };
}

const LIST_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  public_code: "BT123456",
  status: "new",
  name: "한지원",
  phone: "010-1234-5678",
  vehicle_slug: "bus45",
  origin_code: "ICN",
  destination_code: "SEL",
  trip_type: "oneway",
  depart_at: "2026-10-01T00:00:00+00:00",
  return_at: null,
  bus_count: 1,
  passengers: 40,
  created_at: "2026-09-14T01:00:00+00:00",
  confirmed_at: null,
};

const selectCols = (calls: Call[]) =>
  String(calls.find((c) => c.method === "select")?.args[0] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

describe("3. lib/admin/reservations.ts — 목록·상세 쿼리", () => {
  test("목록 select 는 화이트리스트다 — `*` 없음, 민감 컬럼(메일·메시지·메모·동의)은 목록에 없다", async () => {
    const { client, calls } = fakeClient({ data: [LIST_ROW], error: null });
    await listReservations({}, client);
    const cols = selectCols(calls);
    expect(cols).toEqual([...RESERVATION_LIST_COLUMNS]);
    expect(RESERVATION_LIST_SELECT).not.toContain("*");
    for (const forbidden of ["email", "message", "admin_memo", "privacy_consent_at", "marketing_consent_at", "retention_until", "purpose_code"]) {
      expect(cols, `목록에 ${forbidden} 이 있다`).not.toContain(forbidden);
    }
  });

  test("상세 select 는 목록 + 나머지다 — 파기 예정 시각·동의 시각을 사장님에게 보여 준다", () => {
    const cols = [...RESERVATION_DETAIL_COLUMNS];
    for (const c of RESERVATION_LIST_COLUMNS) expect(cols).toContain(c);
    for (const c of ["email", "purpose_code", "waypoint_codes", "contact_method", "payment_method", "parking_included", "vat_included", "message", "admin_memo", "privacy_consent_at", "marketing_consent_at", "retention_until"]) {
      expect(cols, c).toContain(c);
    }
    expect(new Set(cols).size, "중복 컬럼이 있다").toBe(cols.length);
    expect(RESERVATION_DETAIL_SELECT).not.toContain("*");
  });

  test("limit + 1 로 hasMore 를 판정한다 — count 쿼리 0 (RLS 표의 count 는 보여 줄 데도 없다)", async () => {
    const rows = Array.from({ length: DEFAULT_ADMIN_PAGE_SIZE + 1 }, (_, i) => ({ ...LIST_ROW, public_code: `BT00000${i}` }));
    const { client, calls } = fakeClient({ data: rows, error: null });
    const page = await listReservations({}, client);
    expect(page.items.length).toBe(DEFAULT_ADMIN_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(DEFAULT_ADMIN_PAGE_SIZE);
    const range = calls.find((c) => c.method === "range");
    expect(range?.args).toEqual([0, DEFAULT_ADMIN_PAGE_SIZE]);
    expect(calls.some((c) => c.method === "select" && /count/i.test(String(c.args[1] ?? "")))).toBe(false);
  });

  test("마지막 페이지 — hasMore false, nextCursor null", async () => {
    const { client } = fakeClient({ data: [LIST_ROW], error: null });
    const page = await listReservations({ cursor: 20 }, client);
    expect(page.items.length).toBe(1);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  test("status 필터 — all 이면 eq 없음, 나머지는 eq('status', …) 하나", async () => {
    const all = fakeClient({ data: [], error: null });
    await listReservations({ status: "all" }, all.client);
    expect(all.calls.filter((c) => c.method === "eq")).toEqual([]);

    for (const s of ["new", "confirmed", "done", "cancelled"] as const) {
      const one = fakeClient({ data: [], error: null });
      await listReservations({ status: s }, one.client);
      expect(one.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([["status", s]]);
    }
  });

  test("최신순 정렬 — created_at 내림차순 + id 로 동률 고정(offset 페이지네이션의 흔들림 방지)", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await listReservations({}, client);
    const orders = calls.filter((c) => c.method === "order").map((c) => c.args);
    expect(orders[0]).toEqual(["created_at", { ascending: false }]);
    expect(orders[1]).toEqual(["id", { ascending: false }]);
  });

  test("잘못된 입력은 DB 를 부르지 않고 거부한다 — status·cursor·limit", async () => {
    for (const bad of ["bogus", "NEW", "'; drop table reservations; --", 1, null]) {
      const { client, calls } = fakeClient({ data: [], error: null });
      await expect(listReservations({ status: bad as never }, client)).rejects.toThrow();
      expect(calls, `status=${String(bad)} 로 DB 를 불렀다`).toEqual([]);
    }
    for (const bad of [-1, 1.5, Number.NaN]) {
      const { client, calls } = fakeClient({ data: [], error: null });
      await expect(listReservations({ cursor: bad }, client)).rejects.toThrow();
      expect(calls, `cursor=${bad} 로 DB 를 불렀다`).toEqual([]);
    }
    for (const bad of [0, -5, MAX_ADMIN_PAGE_SIZE + 1]) {
      const { client, calls } = fakeClient({ data: [], error: null });
      await expect(listReservations({ limit: bad }, client)).rejects.toThrow();
      expect(calls, `limit=${bad} 로 DB 를 불렀다`).toEqual([]);
    }
  });

  test("상세 — uuid 가 아니면 DB 를 부르지 않고 거부한다", async () => {
    for (const bad of ["", "1", "../../etc", "11111111-1111-4111-8111-11111111111", "%27"]) {
      const { client, calls } = fakeClient({ data: null, error: null });
      await expect(getReservation(bad, client)).rejects.toThrow();
      expect(calls, `id=${bad} 로 DB 를 불렀다`).toEqual([]);
    }
    expect(isUuid(LIST_ROW.id)).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
  });

  test("상세 — 행이 없으면 null (관리자에게 다른 사람 예약의 존재 여부를 알려주지 않는다)", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    expect(await getReservation(LIST_ROW.id, client)).toBeNull();
    expect(calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([["id", LIST_ROW.id]]);
    expect(calls.some((c) => c.method === "maybeSingle")).toBe(true);
  });

  test("DB 오류는 삼키지 않고 throw 한다 — 관리자 화면이 조용히 빈 목록을 보여주면 안 된다", async () => {
    const { client } = fakeClient({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(listReservations({}, client)).rejects.toThrow();
  });

  test("파서는 관대하고 쿼리는 엄격하다 — URL 의 쓰레기값은 기본값으로 떨어진다", () => {
    expect(parseStatusFilter("new")).toBe("new");
    expect(parseStatusFilter("bogus")).toBe("all");
    expect(parseStatusFilter(undefined)).toBe("all");
    expect(parseStatusFilter(["new", "done"])).toBe("all");
    expect(parseCursor("40")).toBe(40);
    expect(parseCursor("-1")).toBe(0);
    expect(parseCursor("abc")).toBe(0);
    expect(parseCursor(undefined)).toBe(0);
    expect(STATUS_FILTERS).toEqual(["all", "new", "confirmed", "done", "cancelled"]);
  });
});

// =============================================================================
// 4. actions/admin/reservation.ts — 얇은 래퍼
// =============================================================================
const RES_ID = LIST_ROW.id;

function rpcClient(result: { data: unknown; error: { code?: string; message: string } | null } | Error): {
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { rpc };
}

function order(): string[] {
  return [
    ...vi.mocked(requireAdmin).mock.invocationCallOrder.map(() => "requireAdmin"),
  ];
}

describe("4. actions/admin/reservation.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ userId: "admin-uuid", email: "owner@example.test" });
  });

  test("확정 — requireAdmin 이 rpc 보다 먼저 돈다", async () => {
    const client = rpcClient({ data: [{ outcome: "confirmed", public_code: "BT123456", enqueued: 1 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    await confirmReservation(RES_ID);
    expect(vi.mocked(requireAdmin).mock.invocationCallOrder[0]).toBeLessThan(client.rpc.mock.invocationCallOrder[0]);
    expect(order()).toEqual(["requireAdmin"]);
  });

  test("확정 — rpc 이름과 인자, 결과 매핑, 태그 2종 + 경로 무효화", async () => {
    const client = rpcClient({ data: [{ outcome: "confirmed", public_code: "BT123456", enqueued: 1 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    const result = await confirmReservation(RES_ID, "  전화로 확인함  ");
    expect(client.rpc).toHaveBeenCalledWith(ADMIN_RPC.confirm, { p_id: RES_ID, p_memo: "전화로 확인함" });
    expect(result).toEqual<AdminActionResult>({ ok: true, changed: true, code: "confirmed" });

    const tags = vi.mocked(revalidate).mock.calls.map((c) => c[0]);
    expect(tags).toEqual([QUERY_TAGS.recent, QUERY_TAGS.reservations]);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(ADMIN_REVALIDATE_PATH, "layout");
  });

  test("두 번째 클릭 — outcome noop 은 오류가 아니라 '이미 처리됨' 이고, 무효화하지 않는다", async () => {
    const client = rpcClient({ data: [{ outcome: "noop", public_code: null, enqueued: 0 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    const result = await confirmReservation(RES_ID);
    expect(result).toEqual<AdminActionResult>({ ok: true, changed: false, code: "alreadyHandled" });
    expect(vi.mocked(revalidate)).not.toHaveBeenCalled();
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  test("취소 — 자기 rpc 를 부르고 cancelled 로 매핑된다", async () => {
    const client = rpcClient({ data: [{ outcome: "cancelled", public_code: "BT123456", enqueued: 0 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    const result = await cancelReservation(RES_ID);
    expect(client.rpc).toHaveBeenCalledWith(ADMIN_RPC.cancel, { p_id: RES_ID, p_memo: null });
    expect(result).toEqual<AdminActionResult>({ ok: true, changed: true, code: "cancelled" });
  });

  test("완료 — 자기 rpc 를 부르고 completed 로 매핑된다 (M1)", async () => {
    const client = rpcClient({ data: [{ outcome: "completed", public_code: "BT123456", enqueued: 0 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    const result = await completeReservation(RES_ID);
    expect(client.rpc).toHaveBeenCalledWith(ADMIN_RPC.complete, { p_id: RES_ID, p_memo: null });
    expect(result).toEqual<AdminActionResult>({ ok: true, changed: true, code: "completed" });
    expect(vi.mocked(revalidate).mock.calls.map((c) => c[0])).toEqual([QUERY_TAGS.recent, QUERY_TAGS.reservations]);
  });

  test("전이마다 자기 rpc 를 부른다 — 이름이 섞이지 않는다", async () => {
    const calls: [string, () => Promise<AdminActionResult>][] = [
      [ADMIN_RPC.confirm, () => confirmReservation(RES_ID)],
      [ADMIN_RPC.cancel, () => cancelReservation(RES_ID)],
      [ADMIN_RPC.complete, () => completeReservation(RES_ID)],
      [ADMIN_RPC.memo, () => saveReservationMemo(RES_ID, "x")],
    ];
    expect(new Set(calls.map(([name]) => name)).size, "rpc 이름이 중복이다").toBe(4);
    for (const [name, call] of calls) {
      vi.clearAllMocks();
      const client = rpcClient({ data: [{ outcome: "noop", public_code: null, enqueued: 0 }], error: null });
      vi.mocked(createSsrClient).mockReturnValue(client as never);
      await call();
      expect(client.rpc.mock.calls[0][0], name).toBe(name);
    }
  });

  test("메모 — 빈 문자열은 null 로 내려가 메모를 지운다", async () => {
    const client = rpcClient({ data: [{ outcome: "memo_updated", public_code: "BT123456", enqueued: 0 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    const result = await saveReservationMemo(RES_ID, "   ");
    expect(client.rpc).toHaveBeenCalledWith(ADMIN_RPC.memo, { p_id: RES_ID, p_memo: null });
    expect(result).toEqual<AdminActionResult>({ ok: true, changed: true, code: "memoUpdated" });
  });

  test("rpc 오류·예외·알 수 없는 outcome — 사용자에게는 실패 안내, 밖으로 throw 하지 않는다", async () => {
    for (const outcome of [
      { data: null, error: { code: "42501", message: "permission denied for function admin_confirm_reservation" } },
      new Error("network down"),
      { data: [{ outcome: "surprise", public_code: null, enqueued: 0 }], error: null },
      { data: [], error: null },
    ]) {
      vi.clearAllMocks();
      const client = rpcClient(outcome as never);
      vi.mocked(createSsrClient).mockReturnValue(client as never);
      const result = await confirmReservation(RES_ID);
      expect(result).toEqual(FAILED_RESULT);
      expect(vi.mocked(revalidate)).not.toHaveBeenCalled();
    }
  });

  test("uuid 가 아닌 id — rpc 를 부르지 않는다 (서버액션 인자는 사용자가 고를 수 있다)", async () => {
    const client = rpcClient({ data: [], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    for (const bad of ["", "1 or 1=1", "../admin"]) {
      const result = await confirmReservation(bad);
      expect(result).toEqual(FAILED_RESULT);
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  test("requireAdmin 이 리다이렉트(throw)하면 rpc 는 돌지 않는다", async () => {
    const client = rpcClient({ data: [], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    vi.mocked(requireAdmin).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(confirmReservation(RES_ID)).rejects.toThrow();
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 5. 개인정보 0 — 결과 객체·로그
// =============================================================================
const PII = ["한지원", "010-1234-5678", "01012345678", "customer@example.test", "성수기라 급합니다"];

describe("5. 개인정보 0", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ userId: "admin-uuid", email: "owner@example.test" });
  });

  test("rpc 가 개인정보를 덧붙여 돌려줘도 결과 객체·로그에 한 조각도 남지 않는다", async () => {
    const client = rpcClient({
      data: [
        {
          outcome: "confirmed",
          public_code: "BT123456",
          enqueued: 1,
          name: PII[0],
          phone: PII[1],
          email: PII[3],
          message: PII[4],
        },
      ],
      error: null,
    });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    const result = await confirmReservation(RES_ID, PII[4]);
    const dump = JSON.stringify(result);
    for (const secret of PII) expect(dump, `결과 객체에 ${secret}`).not.toContain(secret);
    expect(Object.keys(result).sort()).toEqual(["changed", "code", "ok"]);

    const logs = vi.mocked(structuredLog).mock.calls.map((c) => JSON.stringify(c[0]));
    expect(logs.length, "액션이 아무것도 남기지 않았다").toBeGreaterThan(0);
    for (const line of logs) {
      for (const secret of PII) expect(line, `로그에 ${secret}`).not.toContain(secret);
      const entry = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(entry).sort(), "로그 필드는 level·event·id·outcome 뿐이다").toEqual(["event", "id", "level", "outcome"]);
      expect(entry.id).toBe(RES_ID);
    }
  });

  test("실패 로그도 오류 원문을 싣지 않는다 (Postgres 오류 메시지에 행 내용이 섞여 올 수 있다)", async () => {
    const client = rpcClient({ data: null, error: { code: "23505", message: `duplicate key … (${PII[1]})` } });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    await confirmReservation(RES_ID);
    const logs = vi.mocked(structuredLog).mock.calls.map((c) => JSON.stringify(c[0]));
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) for (const secret of PII) expect(line).not.toContain(secret);
  });

  test("toActionResult 는 순수하다 — 같은 입력에 같은 출력, 입력 객체의 다른 키를 옮기지 않는다", () => {
    const row = { outcome: "confirmed", public_code: "BT1", enqueued: 1, name: PII[0] };
    expect(toActionResult("confirm", [row])).toEqual(toActionResult("confirm", [row]));
    expect(JSON.stringify(toActionResult("confirm", [row]))).not.toContain(PII[0]);
    expect(toActionResult("confirm", null)).toEqual(FAILED_RESULT);
    expect(toActionResult("confirm", [{ outcome: "noop" }])).toEqual({ ok: true, changed: false, code: "alreadyHandled" });
    // 함수가 단일 객체를 돌려주는 드라이버 차이도 흡수한다
    expect(toActionResult("cancel", { outcome: "cancelled" })).toEqual({ ok: true, changed: true, code: "cancelled" });
  });
});

// =============================================================================
// 6. 정적 규약
// =============================================================================
describe("6. 정적 규약", () => {
  const TS_TARGETS = [LIB_READ, LIB_RESULT, ACTION, LIST_PAGE, DETAIL_PAGE, PROTECTED_LAYOUT, TABS_DEF, TABS_UI, ACTIONS_UI];

  test("산출물 파일이 전부 있다", () => {
    for (const rel of [UP_SQL, DOWN_SQL, ...TS_TARGETS, ADMIN_CSS]) expect(exists(rel), rel).toBe(true);
  });

  test("서비스 롤 심볼 0건 — app/admin · actions/admin · lib/admin · components/admin (ADR-2)", () => {
    const files = [
      ...walk(path.join(ROOT, "app", "admin")),
      ...walk(path.join(ROOT, "actions", "admin")),
      ...walk(path.join(ROOT, "lib", "admin")),
      ...walk(path.join(ROOT, "components", "admin")),
    ];
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const f of files) {
      expect(readFileSync(f, "utf-8"), f).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE_KEY|supabase\/server/);
    }
  });

  test("액션 파일 — 'use server' 첫 줄 · export 4개 · 전부 async", () => {
    const src = read(ACTION);
    expect(src.split("\n")[0].trim()).toMatch(/^["']use server["'];?$/);
    const exports = [...stripComments(src).matchAll(/^export\s+.*$/gm)].map((m) => m[0]);
    expect(exports.length, "'use server' 파일의 export 는 전부 공개 POST 엔드포인트가 된다 (ADR-3)").toBe(4);
    for (const e of exports) expect(e, e).toMatch(/^export async function/);
    expect(src).toMatch(/export async function confirmReservation/);
    expect(src).toMatch(/export async function cancelReservation/);
    expect(src).toMatch(/export async function completeReservation/);
    expect(src).toMatch(/export async function saveReservationMemo/);
  });

  test("관리자 화면은 캐시하지 않는다 — unstable_cache 0건 (주석의 설명은 제외)", () => {
    for (const f of [...walk(path.join(ROOT, "app", "admin")), ...walk(path.join(ROOT, "lib", "admin"))]) {
      expect(stripComments(readFileSync(f, "utf-8")), f).not.toMatch(/unstable_cache/);
    }
  });

  test("읽기는 세션 클라이언트 하나로만 — createSsrClient 외의 경로가 없다", () => {
    const src = stripComments(read(LIB_READ));
    expect(src).toMatch(/createSsrClient/);
    expect(src).toMatch(/^import "server-only";$/m);
  });

  /**
   * 화면에 나오는 문구는 전부 카탈로그에서 온다. 제외 1건:
   *   - lib/admin/reservations.ts — 개발자용 예외 메시지(화면에 나오지 않는다). lib/queries/* 선례.
   */
  test("한글 리터럴 0 — 문구는 messages/ko.json admin.* 에서만 온다", () => {
    for (const rel of TS_TARGETS.filter((f) => f !== LIB_READ)) {
      const offenders = stripComments(read(rel))
        .split("\n")
        .map((l, i) => [i + 1, l] as const)
        .filter(([, l]) => HANGUL.test(l));
      expect(offenders, rel).toEqual([]);
    }
  });

  test("금액·가격 0 — 관리자 화면에도 가격 계산은 없다 (CLAUDE.md §3)", () => {
    // 금지 심볼을 문자열 결합으로 조립한다 — 이 파일 자체가 check:pricing 의 검사 대상이다.
    const forbidden = new RegExp(["est" + "_price", "price" + "_state", "route" + "_prices", "estim" + "ate\\(", "PRICE" + "_DISPLAY_MODE"].join("|"));
    for (const rel of [...TS_TARGETS, ADMIN_CSS]) {
      expect(read(rel), rel).not.toMatch(forbidden);
    }
  });

  // P5-4 가 팝업 탭을, P5-5·P5-6 이 공지·대표 노선 탭을, P6-2 가 갤러리 탭을, P5-8 이 발송 내역 탭을 켰다
  // (tests/admin-popups.test.ts · admin-notices.test.ts · admin-routes.test.ts · admin-gallery.test.ts ·
  //  admin-notifications.test.ts 가 각 탭의 화면·액션을 단언한다).
  // 이제 자리만 지키는 탭은 없다 — aria-disabled 분기는 그대로 두되(다음 탭이 생길 자리) 켜진 목록이 전부여야 한다.
  test("탭 — 여섯 탭이 전부 켜져 있다", async () => {
    const { ADMIN_TABS } = await import("@/components/admin/tabs");
    expect(ADMIN_TABS.map((t) => t.key)).toEqual(["reservations", "popups", "notices", "gallery", "routes", "notifications"]);
    expect(ADMIN_TABS.filter((t) => t.ready).map((t) => t.href)).toEqual([
      "/admin/reservations",
      "/admin/popups",
      "/admin/notices",
      "/admin/gallery",
      "/admin/routes",
      "/admin/notifications",
    ]);
    expect(ADMIN_TABS.filter((t) => !t.ready).map((t) => t.key)).toEqual([]);
    const ui = stripComments(read(TABS_UI));
    expect(ui.split("\n")[0].trim()).toMatch(/^["']use client["'];?$/);
    expect(ui).toMatch(/aria-disabled/);
    expect(ui).toMatch(/aria-current/);
    // 레이아웃이 탭을 렌더한다
    expect(stripComments(read(PROTECTED_LAYOUT))).toMatch(/AdminTabs/);
    expect(stripComments(read(PROTECTED_LAYOUT))).toMatch(/await\s+requireAdmin\(\)/);
  });

  test("확정 버튼은 status='new' 일 때만 — 존재하지 않는 전이를 화면이 만들지 않는다", () => {
    const src = stripComments(read(ACTIONS_UI));
    expect(src.split("\n")[0].trim()).toMatch(/^["']use client["'];?$/);
    expect(src).toMatch(/status === "new"/);
    expect(src, "완료 버튼은 confirmed 에서만 보인다 (M1)").toMatch(/status === "confirmed"/);
    expect(src).toMatch(/role="status"/);
    expect(src).toMatch(/disabled=\{/);
  });

  /**
   * ─── 게이트 구조 검사 (P5-3 독립 리뷰 F1·F2) ─────────────────────────────────────────────
   *
   * 왜 파일 목록이 아니라 구조인가: 이 자리에 있던 검사는 **손으로 적은 3개 파일 목록**을 돌았고,
   * 그래서 `app/admin/(protected)/page.tsx` 가 게이트를 전혀 부르지 않는다는 사실(F2)을 보지 못했다.
   * 이제 `(protected)` 아래를 **전수 조회**한다 — 새 화면이 생겨도 자동으로 검사 대상이다.
   *
   * 무엇을 막는가(F1): 개발용 우회 스위치가 `if (…) await requireAdmin()` 으로 게이트를 감쌌고, 그 분기가
   * production 번들에 그대로 남아 환경변수 두 개로 고객 이름·전화번호가 열렸다. 조건부 게이트는 게이트가 아니다.
   */
  const PROTECTED_DIR = path.join(ROOT, "app", "admin", "(protected)");
  /** 허용되는 유일한 형태: 문(statement) 하나가 통째로 `await requireAdmin();` (대입은 허용). */
  const UNCONDITIONAL_CALL = /^\s*(?:const\s+\w+\s*=\s*)?await\s+requireAdmin\(\)\s*;\s*$/;

  test("(protected) 아래의 requireAdmin 호출은 하나도 빠짐없이 무조건이다 (F1)", () => {
    const files = walk(PROTECTED_DIR).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
    expect(files.length, "검사 대상이 비면 이 테스트는 아무것도 지키지 않는다").toBeGreaterThanOrEqual(4);

    const offenders: string[] = [];
    let calls = 0;
    for (const f of files) {
      const rel = path.relative(ROOT, f);
      for (const [i, line] of stripComments(readFileSync(f, "utf-8")).split("\n").entries()) {
        if (!/\brequireAdmin\s*\(/.test(line)) continue; // import 줄은 `(` 가 없어 걸리지 않는다
        calls += 1;
        if (!UNCONDITIONAL_CALL.test(line)) offenders.push(`${rel}:${i + 1} ${line.trim()}`);
      }
    }
    expect(offenders, `조건이 붙은 게이트 호출:\n${offenders.join("\n")}`).toEqual([]);
    expect(calls, "(protected) 아래에서 requireAdmin 호출을 하나도 찾지 못했다").toBeGreaterThanOrEqual(4);
  });

  test("(protected) 아래의 모든 page·layout 이 자기 자리에서 게이트를 부른다 (F2)", () => {
    const entries = walk(PROTECTED_DIR).filter((f) => /[\\/](page|layout)\.tsx$/.test(f));
    expect(entries.length).toBeGreaterThanOrEqual(4);
    for (const f of entries) {
      const lines = stripComments(readFileSync(f, "utf-8")).split("\n");
      const hit = lines.some((l) => UNCONDITIONAL_CALL.test(l));
      expect(hit, `${path.relative(ROOT, f)} 가 requireAdmin() 을 무조건 부르지 않는다`).toBe(true);
    }
  });

  test("관리자 경로 어디에도 개발용 우회(preview) 심볼이 없다 (F1)", () => {
    const files = [
      ...walk(path.join(ROOT, "app", "admin")),
      ...walk(path.join(ROOT, "actions", "admin")),
      ...walk(path.join(ROOT, "lib", "admin")),
      ...walk(path.join(ROOT, "components", "admin")),
    ];
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const f of files) {
      // 주석까지 포함해 검사한다 — 되살릴 수 있는 코드 조각을 주석으로 남겨 두지 않는다
      expect(readFileSync(f, "utf-8"), path.relative(ROOT, f)).not.toMatch(/preview/i);
    }
    for (const gone of ["lib/admin/preview.ts", "components/admin/reservations-preview.ts"]) {
      expect(exists(gone), `${gone} 이 되살아났다`).toBe(false);
    }
  });

  test("QUERY_TAGS.reservations 가 추가됐고 기존 태그는 그대로다", () => {
    expect(QUERY_TAGS.reservations).toBe("reservations");
    for (const t of ["showcase", "places", "vehicles", "notices", "popups", "gallery", "albums", "recent"]) {
      expect(QUERY_TAGS[t as keyof typeof QUERY_TAGS], t).toBe(t);
    }
  });

  test("messages/ko.json — admin 네임스페이스가 끝이고 기존 키는 그대로다", () => {
    const ko = JSON.parse(read("messages/ko.json")) as Record<string, Record<string, Record<string, unknown>>>;
    const keys = Object.keys(ko);
    expect(keys[keys.length - 1]).toBe("admin");
    // P5-1 이 넣은 키가 살아 있다
    for (const k of ["title", "sub", "emailLabel", "submit", "sent", "closed", "unavailable", "invalid", "ratelimit", "infra", "callbackFailed"]) {
      expect(ko.admin.login[k], k).toBeTruthy();
    }
    expect(ko.admin.home.title).toBeTruthy();
    // P5-3 이 더한 것
    const tabs = ko.admin.tabs as Record<string, string>;
    for (const k of ["reservations", "popups", "notices", "gallery", "routes", "comingSoon", "navLabel"]) {
      expect(tabs[k], `admin.tabs.${k}`).toBeTruthy();
    }
    const list = ko.admin.reservations as Record<string, unknown>;
    for (const k of ["title", "sub", "empty", "filterLabel", "prev", "next", "detail", "status", "col", "filter"]) {
      expect(list[k], `admin.reservations.${k}`).toBeTruthy();
    }
    for (const s of ["new", "confirmed", "done", "cancelled"]) {
      expect((list.status as Record<string, string>)[s], `status.${s}`).toBeTruthy();
    }
    const detail = ko.admin.detail as Record<string, unknown>;
    for (const k of ["title", "back", "confirm", "cancel", "complete", "memoLabel", "memoSave", "processing", "result", "notFound"]) {
      expect(detail[k], `admin.detail.${k}`).toBeTruthy();
    }
    const result = detail.result as Record<string, string>;
    for (const k of ["confirmed", "cancelled", "completed", "memoUpdated", "alreadyHandled", "failed"]) {
      expect(result[k], `admin.detail.result.${k}`).toBeTruthy();
    }
    expect(JSON.parse(read("messages/en.json"))).toEqual({});
  });

  test("CSS — 색은 역할 토큰만(HEX·rgb 0). 간격 px 리터럴 0 (tests/layout.test.ts §4 와 같은 규약)", () => {
    const css = read(ADMIN_CSS).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(/\b(rgba?|hsla?)\(/.test(css)).toBe(false);
    const spacing = /^(margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$/;
    for (const block of css.matchAll(/\{([^{}]*)\}/g)) {
      for (const m of block[1].matchAll(/([-a-z]+)\s*:\s*([^;]+)/g)) {
        if (spacing.test(m[1].trim()) && /\d(\.\d+)?px/.test(m[2])) {
          expect.fail(`${ADMIN_CSS} — ${m[1]}: ${m[2]} (역할 토큰을 쓰세요)`);
        }
      }
    }
  });
});

// =============================================================================
// 7. DB 실증 — 로컬 스택 + REQUIRE_DB_TESTS=1 에서만. 원격에는 어떤 쓰기도 하지 않는다
// =============================================================================
const gate = dbWriteGate();
const dbEnv = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[admin-reservations.test] DB 실증 블록 skip — ${gate.reason}`);
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

describe.skipIf(!gate.allowed || !dbEnv.hasServiceRole)(
  "7. DB — 0010 원자적 상태 전이 실증 (로컬 스택 + REQUIRE_DB_TESTS=1)",
  { timeout: 90_000 },
  () => {
    const baseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
    const serviceHeaders = {
      apikey: dbEnv.serviceRoleKey,
      Authorization: `Bearer ${dbEnv.serviceRoleKey}`,
      "Content-Type": "application/json",
    };
    const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
    const PASSWORD = `p53-${randomUUID()}`;
    const emailFor = (who: string) => `p53-${RUN}-${who}@example.test`;

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
      call(method, `${dbEnv.restRoot}${pathAndQuery}`, serviceHeaders, json, prefer);

    const asUser = (token: string, method: string, pathAndQuery: string, json?: unknown) =>
      call(method, `${dbEnv.restRoot}${pathAndQuery}`, {
        apikey: dbEnv.anonKey as string,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      }, json);

    const asAnon = (method: string, pathAndQuery: string, json?: unknown) =>
      call(method, `${dbEnv.restRoot}${pathAndQuery}`, {
        apikey: dbEnv.anonKey as string,
        "Content-Type": "application/json",
      }, json);

    async function createUser(email: string): Promise<string> {
      const r = await call("POST", `${baseUrl()}/auth/v1/admin/users`, serviceHeaders, { email, password: PASSWORD, email_confirm: true });
      expect(r.status, `사용자 생성 실패: ${JSON.stringify(r.body).slice(0, 300)}`).toBeLessThan(300);
      return (r.body as { id: string }).id;
    }

    async function signIn(email: string): Promise<string> {
      const r = await call("POST", `${baseUrl()}/auth/v1/token?grant_type=password`, { apikey: dbEnv.anonKey as string, "Content-Type": "application/json" }, { email, password: PASSWORD });
      expect(r.status, `로그인 실패: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(200);
      return (r.body as { access_token: string }).access_token;
    }

    let adminId = "";
    let adminToken = "";
    let plainToken = "";
    const made: string[] = [];

    async function seed(status: "new" | "confirmed" | "done" | "cancelled", tag: string): Promise<string> {
      const now = new Date();
      const later = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
      const ins = await rest(
        "POST",
        "/reservations",
        {
          public_code: `P53${tag}`.slice(0, 12),
          status,
          name: "P53",
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
      const id = (ins.body as { id: string }[])[0].id;
      made.push(id);
      return id;
    }

    const confirmed = (token: string, id: string, memo: string | null = null) =>
      asUser(token, "POST", "/rpc/admin_confirm_reservation", { p_id: id, p_memo: memo });

    async function notifyCount(id: string): Promise<number> {
      const r = await rest("GET", `/notifications_log?select=id,event,status&reservation_id=eq.${id}&event=eq.confirmed`);
      return (r.body as unknown[]).length;
    }

    test("준비 — 관리자 1명 · 일반 1명 · 예약 4건 (전부 로컬 스택)", async () => {
      const probe = await rest("GET", "/reservations?select=id&limit=1");
      expect(probe.status, "이전 마이그레이션이 적용되지 않았다").toBe(200);

      adminId = await createUser(emailFor("admin"));
      await createUser(emailFor("plain"));
      adminToken = await signIn(emailFor("admin"));
      plainToken = await signIn(emailFor("plain"));
      const add = await rest("POST", "/admin_users", { user_id: adminId, email: emailFor("admin"), note: "P5-3 test" });
      expect(add.status, JSON.stringify(add.body).slice(0, 300)).toBeLessThan(300);
    });

    test("비관리자 세션은 확정할 수 없다 — definer 함수가 스스로 막는다", async () => {
      const id = await seed("new", `A${RUN.slice(0, 4).toUpperCase()}`);
      const r = await confirmed(plainToken, id);
      expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBeGreaterThanOrEqual(400);
      const row = await rest("GET", `/reservations?select=status&id=eq.${id}`);
      expect((row.body as { status: string }[])[0].status).toBe("new");
      expect(await notifyCount(id)).toBe(0);
    });

    test("anon 은 함수를 실행조차 할 수 없다", async () => {
      const id = made[0];
      const r = await asAnon("POST", "/rpc/admin_confirm_reservation", { p_id: id, p_memo: null });
      expect(r.status).toBeGreaterThanOrEqual(400);
    });

    test("관리자 확정 — status·confirmed_at·메모가 바뀌고 통지 1건이 큐에 쌓인다", async () => {
      const id = await seed("new", `B${RUN.slice(0, 4).toUpperCase()}`);
      const r = await confirmed(adminToken, id, "P53 memo");
      expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
      const rows = r.body as { outcome: string; public_code: string | null; enqueued: number }[];
      expect(rows[0].outcome).toBe("confirmed");
      expect(rows[0].enqueued).toBe(1);

      const row = await rest("GET", `/reservations?select=status,confirmed_at,admin_memo&id=eq.${id}`);
      const got = (row.body as { status: string; confirmed_at: string | null; admin_memo: string | null }[])[0];
      expect(got.status).toBe("confirmed");
      expect(got.confirmed_at).not.toBeNull();
      expect(got.admin_memo).toBe("P53 memo");

      const log = await rest("GET", `/notifications_log?select=event,channel,template,status,to_phone&reservation_id=eq.${id}`);
      const logs = log.body as { event: string; channel: string; template: string; status: string }[];
      expect(logs.length).toBe(1);
      expect(logs[0]).toMatchObject({ event: "confirmed", channel: "sms", template: "confirmed.customer.sms", status: "pending" });
    });

    test("두 번 클릭해도 통지는 한 건이다 — 두 번째는 noop (경합 방어선)", async () => {
      const id = await seed("new", `C${RUN.slice(0, 4).toUpperCase()}`);
      const [first, second] = await Promise.all([confirmed(adminToken, id), confirmed(adminToken, id)]);
      const outcomes = [first, second].map((r) => (r.body as { outcome: string }[])[0].outcome).sort();
      expect(outcomes).toEqual(["confirmed", "noop"]);
      const enqueuedTotal = [first, second].reduce((n, r) => n + (r.body as { enqueued: number }[])[0].enqueued, 0);
      expect(enqueuedTotal, "두 호출이 합쳐 두 건을 큐에 넣었다").toBe(1);
      expect(await notifyCount(id)).toBe(1);
    });

    test("done·cancelled 행에 확정하면 noop — 역방향 전이는 존재하지 않는다", async () => {
      const done = await seed("done", `D${RUN.slice(0, 4).toUpperCase()}`);
      const rDone = await confirmed(adminToken, done);
      expect((rDone.body as { outcome: string }[])[0].outcome).toBe("noop");
      expect(await notifyCount(done)).toBe(0);

      const fresh = await seed("new", `E${RUN.slice(0, 4).toUpperCase()}`);
      const cancel = await asUser(adminToken, "POST", "/rpc/admin_cancel_reservation", { p_id: fresh, p_memo: null });
      expect((cancel.body as { outcome: string }[])[0].outcome).toBe("cancelled");
      expect(await notifyCount(fresh), "취소가 통지를 큐에 넣었다 — 문안이 승인되지 않았다").toBe(0);

      const after = await confirmed(adminToken, fresh);
      expect((after.body as { outcome: string }[])[0].outcome).toBe("noop");
      expect(await notifyCount(fresh)).toBe(0);
    });

    test("완료 — confirmed 에서만 done 으로 간다 (M1)", async () => {
      const fresh = await seed("new", `G${RUN.slice(0, 4).toUpperCase()}`);
      // new 에 완료를 걸면 아무 일도 없어야 한다
      const early = await asUser(adminToken, "POST", "/rpc/admin_complete_reservation", { p_id: fresh, p_memo: null });
      expect((early.body as { outcome: string }[])[0].outcome).toBe("noop");
      expect((await rest("GET", `/reservations?select=status&id=eq.${fresh}`)).body).toEqual([{ status: "new" }]);

      // 확정 → 완료
      expect((await confirmed(adminToken, fresh)).status).toBe(200);
      const done = await asUser(adminToken, "POST", "/rpc/admin_complete_reservation", { p_id: fresh, p_memo: "운행 종료" });
      const row = done.body as { outcome: string; public_code: string | null; enqueued: number }[];
      expect(row[0].outcome).toBe("completed");
      expect(row[0].enqueued, "완료가 통지를 큐에 넣었다").toBe(0);
      const after = await rest("GET", `/reservations?select=status,admin_memo&id=eq.${fresh}`);
      expect((after.body as { status: string; admin_memo: string }[])[0]).toMatchObject({ status: "done", admin_memo: "운행 종료" });
      // 확정 통지 1건(확정 단계에서 쌓인 것)뿐 — 완료가 더하지 않았다
      expect(await notifyCount(fresh)).toBe(1);

      // 두 번째 완료는 noop
      const again = await asUser(adminToken, "POST", "/rpc/admin_complete_reservation", { p_id: fresh, p_memo: null });
      expect((again.body as { outcome: string }[])[0].outcome).toBe("noop");
    });

    test("비관리자·anon 은 완료도 부를 수 없다 (M1)", async () => {
      const id = made[made.length - 1];
      const plain = await asUser(plainToken, "POST", "/rpc/admin_complete_reservation", { p_id: id, p_memo: null });
      expect(plain.status).toBeGreaterThanOrEqual(400);
      const anon = await asAnon("POST", "/rpc/admin_complete_reservation", { p_id: id, p_memo: null });
      expect(anon.status).toBeGreaterThanOrEqual(400);
    });

    test("메모는 상태를 건드리지 않는다", async () => {
      const id = await seed("new", `F${RUN.slice(0, 4).toUpperCase()}`);
      const r = await asUser(adminToken, "POST", "/rpc/admin_update_memo", { p_id: id, p_memo: "just a note" });
      expect((r.body as { outcome: string }[])[0].outcome).toBe("memo_updated");
      const row = await rest("GET", `/reservations?select=status,admin_memo,confirmed_at&id=eq.${id}`);
      const got = (row.body as { status: string; admin_memo: string; confirmed_at: string | null }[])[0];
      expect(got).toMatchObject({ status: "new", admin_memo: "just a note", confirmed_at: null });
    });

    test("관리자도 이제 reservations 를 직접 UPDATE 할 수 없다 — 쓰기는 네 함수뿐이다 (리뷰 N5)", async () => {
      const id = made[made.length - 1];
      const patch = await asUser(adminToken, "PATCH", `/reservations?id=eq.${id}`, { retention_until: "2099-01-01T00:00:00Z" });
      expect(patch.status, `직접 UPDATE 가 통과했다: ${JSON.stringify(patch.body).slice(0, 200)}`).toBeGreaterThanOrEqual(400);
      const row = await rest("GET", `/reservations?select=retention_until&id=eq.${id}`);
      expect(String((row.body as { retention_until: string }[])[0].retention_until)).not.toContain("2099");
    });

    test("관리자는 여전히 읽을 수 있다 — select 정책은 그대로다", async () => {
      const r = await asUser(adminToken, "GET", `/reservations?select=id,public_code,status&id=eq.${made[0]}`);
      expect(r.status).toBe(200);
      expect((r.body as unknown[]).length).toBe(1);
    });

    test("정리 — 만든 것을 전부 지운다", async () => {
      for (const id of made) {
        await rest("DELETE", `/notifications_log?reservation_id=eq.${id}`);
        await rest("DELETE", `/reservations?id=eq.${id}`);
      }
      await rest("DELETE", `/admin_users?user_id=eq.${adminId}`);
      for (const who of ["admin", "plain"]) {
        const list = await call("GET", `${baseUrl()}/auth/v1/admin/users?page=1&per_page=200`, serviceHeaders);
        const users = (list.body as { users?: { id: string; email: string }[] }).users ?? [];
        const found = users.find((u) => u.email === emailFor(who));
        if (found) await call("DELETE", `${baseUrl()}/auth/v1/admin/users/${found.id}`, serviceHeaders);
      }
      const left = await rest("GET", `/reservations?select=id&id=in.(${made.join(",")})`);
      expect((left.body as unknown[]).length).toBe(0);
    });
  },
);
