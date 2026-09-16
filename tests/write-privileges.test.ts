/**
 * P5-9 — `0012_write_privileges.sql`: 쓰기가 의도된 적 없는 두 표에서 write 권한을 회수한다.
 *
 * 왜 이 파일이 있나. Supabase 는 public 스키마의 표에 `anon`·`authenticated` 로 **기본 권한을 넓게** 깔아 둔다.
 * 마이그레이션이 명시적으로 회수하지 않으면 GRANT 층은 아무것도 막지 않고 **RLS 가 유일한 방어선**이 된다.
 * 그 상태에서 정책이 없는 동작(예: notifications_log 의 update)을 PostgREST 로 치면 0행이 매치되고,
 * PostgREST 는 그것을 **성공(204)** 으로 보고한다. 거부가 아니라 성공이다 — 이 미묘한 차이가 이 태스크의 출발점이다:
 *   tests/admin-notifications.test.ts 의 "관리자도 쓸 수는 없다" 가 204 를 받고 실패했다(CI db-test, 8bc3549 이후).
 *   테스트가 틀린 게 아니라 스키마가 틀렸다.
 *
 * 같은 뿌리에서 나온 세 번째 재발이다: P5-1/P5-2 리뷰 M1 이 `admin_users` 에서(→ 0009 `revoke all`),
 * 0010 이 `reservations` 의 UPDATE 에서, 그리고 0012 가 나머지를 닫는다.
 *
 * **범위를 좁게 잡는 것이 0012 의 핵심이었다.** 콘텐츠 표 6개(notices·popups·gallery·gallery_albums·
 * showcase_routes·vehicles)는 관리자가 `authenticated` + `is_admin()` 정책으로 **정말 쓴다**. 거기서 회수하면
 * 관리자 화면이 죽는다. 그래서 0012 의 회수 대상은 서비스 롤과 security definer 함수만 쓰는 두 표뿐이다.
 *
 * **그리고 `0013_anon_write_privileges.sql` 이 나머지 절반을 닫는다.** 위 규칙은 `authenticated` 에 대한 것이고
 * `anon` 에는 해당하지 않는다 — 공개 롤은 어떤 표에도 쓰지 않는다. 그런데 0012 뒤에도 `anon` 은 콘텐츠 6표 +
 * `places` 에 insert·update·delete·**truncate** 를 그대로 갖고 있었다(P5-9 독립 리뷰 M1). TRUNCATE 는
 * RLS 의 적용을 아예 받지 않으므로, 그 표들에서는 "RLS 가 막아 주고 있었다" 조차 사실이 아니었다.
 *
 * **그리고 `0016_privileges_rls_cannot_protect.sql` 이 RLS 가 애초에 막지 못하는 것을 닫는다** (P5-12).
 * 0012·0013 이 닫은 것은 **쓰기 네 동작**뿐이었다. 남은 `TRUNCATE`·`TRIGGER` 는 RLS 가 관여하는 종류의 권한이
 * 아니다 — TRUNCATE 는 행을 하나씩 보지 않으므로 정책 평가가 일어나지 않고, TRIGGER 는 `CREATE TRIGGER` 를
 * 허용한다(표의 TRIGGER 권한 + **이미 존재하는** 트리거 함수의 EXECUTE 면 충분하다 — 0012 헤더가 "스키마 CREATE 가
 * 없어 쓸 수 없다" 고 적은 것은 **틀렸다**). 이 DB 에는 `supabase_functions.http_request` 가 있고 두 공개 롤이
 * 그것을 실행할 수 있다 — 붙이면 행이 바뀔 때마다 외부로 HTTP 가 나간다.
 * `places` 는 한 겹 더 나쁘다: 관리자 쓰기 **정책이 아예 없는데**(0009 는 여섯 표에만 달았다) 전권을 갖고 있었다.
 *
 * 이 파일이 단언하는 것:
 *   1·2. 0012 SQL·롤백 — 회수 대상 2표만 · select 미회수 · 재실행 안전 · 데이터 미변경 ·
 *        롤백은 회수한 것만 되돌리고(0010 이 닫은 문은 되살리지 않는다) 승인 플래그를 **언제나** 요구한다
 *   3·4. 0013 SQL·롤백 — 7표 × 4동작을 `anon` 에서만 · `authenticated` 미접촉 · select 미회수 · 대칭 롤백
 *   5. DB 실증(로컬 스택) — 관리자·anon 세션의 쓰기가 4xx 로 **거부**된다(204 아님) · select 는 200 ·
 *      서비스 롤 경로(접수·enqueue·발송기·파기)와 0010 definer 함수 3종은 **그대로 동작한다** ·
 *      **0016 뒤에도 관리자가 콘텐츠 표에 실제로 쓰고 지운다**(행렬이 아니라 2xx 로) · `places` 쓰기는 거부된다
 *   6. 권한 행렬 실측 — 행동이 아니라 권한 상태 자체를 `has_table_privilege` 로 읽는다
 *   7·8. 0016 SQL·롤백 — 회수 목록이 정확히 TRUNCATE·TRIGGER·REFERENCES(+`places` 쓰기 셋)이고 select 는 살아 있으며,
 *        함수 셋은 `create or replace`(drop 금지)로 `pg_temp` 만 더하고, 롤백이 대칭이며 승인 플래그를 요구한다
 *   9. 0016 권한·함수 행렬 실측 — `anon` 은 select 만 · `authenticated` 에 truncate/trigger/references 0 ·
 *      함수 셋의 `proconfig` 에 `pg_temp` · EXECUTE 보유자는 `service_role`(+소유자) 뿐
 *   10·11. 0017 SQL·롤백 (P5-13) — **개인정보 두 표**에서 TRIGGER·REFERENCES 와 **`anon` 의 SELECT** 를 회수하고,
 *        `authenticated` 의 SELECT 는 살리며, 롤백이 대칭이고 승인 플래그를 조건 없이 요구한다
 *   12. 0017 권한 행렬 + **거동 실증** — 행렬 대조로 끝내지 않는다. 실제로 `CREATE TRIGGER` 를 시도해
 *        `anon`·`authenticated` 가 42501 로 거부되고 **`service_role` 은 성공**(대조군)하는지 본다
 *
 * **0017 이 왜 0016 보다 급했나**: 0016 은 콘텐츠 표를 다뤘지만 같은 구멍이 `reservations`(고객 성명·전화번호·
 * 이메일·문의내용)·`notifications_log`(수신처·문자 본문)에도 남아 있었다. 적용 전에 **실제로 붙여 봤더니 붙었다** —
 * `anon` 으로 `supabase_functions.http_request` 트리거를 두 표에 `CREATE TRIGGER` 하는 데 성공했다(2026-09-16 실측).
 * 즉 접수가 들어올 때마다 고객 개인정보가 외부 URL 로 나가는 경로가 권한 층에 열려 있었고, RLS 는 그것을 막지 못한다.
 *
 * **느슨한 단언을 조였다 (P4-5 리뷰 K3 · runbook 후속)**: 이 파일의 거부 단언은 `status >= 400` 이었다.
 * 그러면 500(서버 고장)·400(검증 실패)·404(표가 없다)까지 "보안 성공" 으로 읽힌다 — 어느 것도 "권한이 회수됐다" 를
 * 증명하지 않는다. `expectPermissionDenied()` 가 **PostgREST 상태코드(401·403) + PostgreSQL 코드 `42501`** 를
 * 함께 요구하고, 대조군(존재하지 않는 표 → 404 `PGRST205`)을 같은 블록에 둬 둘이 구분되는지 보인다.
 *
 * tests/ 아래라 게이트 3종의 검사 대상이다 — 금지어·임시값 마커 리터럴을 그대로 쓰지 않는다.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";

import { withGalleryLock, withNotificationsLock } from "./helpers/db-lock";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";
import { runLocalSql } from "./helpers/local-stack-sql";

// =============================================================================
// 공통 헬퍼 (tests/admin-reservations.test.ts 와 같은 구현)
// =============================================================================
const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const exists = (rel: string) => existsSync(path.join(ROOT, rel));

const UP_SQL = "supabase/migrations/0012_write_privileges.sql";
const DOWN_SQL = "supabase/rollbacks/0012_write_privileges.down.sql";
const UP13_SQL = "supabase/migrations/0013_anon_write_privileges.sql";
const DOWN13_SQL = "supabase/rollbacks/0013_anon_write_privileges.down.sql";
const UP16_SQL = "supabase/migrations/0016_privileges_rls_cannot_protect.sql";
const DOWN16_SQL = "supabase/rollbacks/0016_privileges_rls_cannot_protect.down.sql";
const UP17_SQL = "supabase/migrations/0017_pii_tables_trigger_references.sql";
const DOWN17_SQL = "supabase/rollbacks/0017_pii_tables_trigger_references.down.sql";

const stripSqlComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const compact = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const sqlCode = (rel: string) => compact(stripSqlComments(read(rel)));

/** 회수/부여 대상 두 표. 이 목록 밖의 표는 0012 가 손대지 않는다. */
const TARGET_TABLES = ["notifications_log", "reservations"] as const;

/** 관리자가 `authenticated` 로 정말 쓰는 표 — 여기서 회수하면 관리자 화면이 죽는다(P5-4~6·P6-2). */
const CONTENT_TABLES = ["notices", "popups", "gallery", "gallery_albums", "showcase_routes", "vehicles"] as const;

/** 0012 가 이름조차 꺼내면 안 되는 표. `admin_users` 는 0009 가 이미 `revoke all` 했고 `places` 는 0013 소관이다. */
const OUT_OF_SCOPE_TABLES = ["admin_users", "places"] as const;

/**
 * 0013 이 `anon` 에서 쓰기를 회수하는 7표 — 콘텐츠 6표 + 참조 데이터 `places`.
 * `authenticated` 는 건드리지 않는다(관리자가 그 롤로 쓴다). `anon` 은 이 7표 어디에도 쓰지 않는다.
 */
const ANON_REVOKE_TABLES = [...CONTENT_TABLES, "places"] as const;

/** 0013 이 손대면 안 되는 표. 두 개인정보 표는 0012 소관이고 `admin_users` 는 0009 가 `revoke all` 했다. */
const OUT_OF_SCOPE_FOR_13 = ["reservations", "notifications_log", "admin_users"] as const;

const WRITE_PRIVS = ["insert", "update", "delete", "truncate"] as const;

/**
 * 0016 이 `authenticated` 에게서 회수하는 것 — **RLS 가 막지 못하는 세 가지.**
 * TRUNCATE 는 정책 평가 자체가 일어나지 않고, TRIGGER 는 `CREATE TRIGGER` 를 허용하며(이미 있는 트리거 함수의
 * EXECUTE 만 더 있으면 된다 — 이 DB 에는 `supabase_functions.http_request` 가 있다), REFERENCES 는 오늘 실행
 * 경로가 없지만 "만들 수 없으니 괜찮다" 는 논증이 TRIGGER 에서 이미 한 번 틀렸으므로 함께 닫는다.
 */
const RLS_BLIND_PRIVS = ["truncate", "trigger", "references"] as const;

/** 0016 이 `anon` 에게서 회수하는 것. 네 동작은 0013 이 가져갔으므로 이 둘만 남았다. */
const ANON_RLS_BLIND_PRIVS = ["trigger", "references"] as const;

/** `places` 에서만 추가로 회수하는 쓰기 셋 — 관리자 쓰기 정책이 없고(0009 는 여섯 표) 코드 경로도 없다. */
const PLACES_WRITE_PRIVS = ["insert", "update", "delete"] as const;

/**
 * 0016 이 `search_path` 에 `pg_temp` 를 더하는 definer 함수 **셋**.
 *
 * 후속 목록(runbook)과 브리프는 `0005:96` 의 `claim_pending_notifications(int)` 를 포함해 넷으로 적었는데
 * **그 함수는 이미 존재하지 않는다** — 0014 가 `drop function if exists claim_pending_notifications(int)` 로
 * 지우고 2-인자 판을 만들었고, 그쪽은 처음부터 `public, pg_temp` 다. 1-인자 형태를 되살리면 두 함수가 공존해
 * `claim_pending_notifications(10)` 호출이 모호(42725)해지고 **발송기가 통째로 멈춘다**(0014 §4 ①).
 */
const PG_TEMP_FIXED_FNS = ["mark_notification_sent", "mark_notification_failed", "reap_stale_notifications"] as const;

/**
 * 0017 (P5-13) 의 대상 — **개인정보 두 표.** `reservations` 에는 고객 성명·전화번호·이메일·문의내용이,
 * `notifications_log` 에는 수신처와 문자 본문이 들어 있다. 0016 이 이 둘을 빼놓은 것은 브리프가 범위를
 * 콘텐츠 일곱 표로 못박았기 때문이고(0016 헤더 "회수하지 않는 것"), 0017 이 그 뒤를 잇는다.
 */
const PII_TABLES = ["reservations", "notifications_log"] as const;

/** 0017 이 **두 공개 롤 모두에서** 회수하는 것. 쓰기 네 동작은 0010·0012 가 이미 가져갔다. */
const PII_RLS_BLIND_PRIVS = ["trigger", "references"] as const;

/**
 * 0017 이 **`anon` 에서만** 추가로 회수하는 것.
 *
 * 0012 가 "select 는 회수하지 않는다" 고 한 근거는 **관리자 화면이 읽는다** 였고 그것은 `authenticated` 에만
 * 해당한다 — `anon` 에는 해당한 적이 없다. 두 표를 `anon` 으로 읽는 경로가 저장소에 하나도 없고(공개 경로는
 * 전부 서비스 롤: lib/queries/recent.ts · lib/reservation-check/db.ts · lib/notify/vars.ts · lib/retention/purge.ts),
 * 0009 의 세 정책은 전부 `to authenticated` 라 RLS 쪽에도 `anon` 용 정책이 없다.
 */
const PII_ANON_ONLY_PRIVS = ["select"] as const;

/** 0017 이 이름조차 꺼내면 안 되는 표 — 콘텐츠 7표는 0013·0016 소관, `admin_users` 는 0009 가 `revoke all` 했다. */
const OUT_OF_SCOPE_FOR_17 = [...CONTENT_TABLES, "places", "admin_users"] as const;

/** 0017 이 "건드리지 않았음" 을 확인하는 아웃박스 definer 함수 **넷**(0014 의 2-인자 claim 포함). */
const OUTBOX_DEFINER_FNS = [
  "claim_pending_notifications",
  "mark_notification_sent",
  "mark_notification_failed",
  "reap_stale_notifications",
] as const;

interface PrivStatement {
  verb: "revoke" | "grant";
  privs: string[];
  table: string;
  roles: string[];
  raw: string;
}

/**
 * `revoke a, b on table t from r1, r2` / `grant … to …` 를 (동사·권한·표·롤) 로 쪼갠다.
 *
 * 문장 단위로 자른 뒤 매칭한다. 롤백은 표 존재 확인(to_regclass) 때문에 do 블록 안에서 `execute 'grant …'` 로
 * 부여하므로, 그 껍데기를 벗겨 같은 규칙으로 읽는다 — 상·하행의 대칭을 문자열 눈대중이 아니라 삼중항 집합으로 비교하기 위해서다.
 */
function parsePrivStatements(rel: string): PrivStatement[] {
  const out: PrivStatement[] = [];
  // 종결자는 `;`(최상위 문장) 또는 `'`(do 블록 안의 execute 문자열) 둘 다.
  const re = /\b(revoke|grant)\s+([a-z, ]+?)\s+on\s+table\s+([a-z_, ]+?)\s+(?:from|to)\s+([a-z_, ]+?)\s*(?:;|')/g;
  const code = sqlCode(rel);
  for (const m of code.matchAll(re)) {
    const [raw, verb, privs, tables, roles] = m;
    const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
    for (const table of list(tables)) {
      out.push({ verb: verb as "revoke" | "grant", privs: list(privs), table, roles: list(roles), raw: raw.trim() });
    }
  }
  return out;
}

/** (롤, 표, 권한) 삼중항 집합 — 상·하행의 대칭을 비교하기 위한 정규형. */
function triples(stmts: PrivStatement[], verb: "revoke" | "grant"): Set<string> {
  const set = new Set<string>();
  for (const s of stmts.filter((x) => x.verb === verb)) {
    for (const role of s.roles) for (const priv of s.privs) set.add(`${role}|${s.table}|${priv}`);
  }
  return set;
}

// =============================================================================
// 1. supabase/migrations/0012_write_privileges.sql — 텍스트
// =============================================================================
describe("1. 0012_write_privileges.sql", () => {
  test("존재하고, 0012 번호는 이 파일 하나뿐이다. migrations/ 안에 롤백이 섞여 있지 않다", () => {
    expect(exists(UP_SQL), `${UP_SQL} 이 없다`).toBe(true);
    const files = readdirSync(path.join(ROOT, "supabase", "migrations"));
    expect(files.filter((f) => f.startsWith("0012"))).toEqual(["0012_write_privileges.sql"]);
    expect(files.filter((f) => f.endsWith(".down.sql")), "롤백이 migrations/ 안에 있으면 db reset 이 롤백까지 적용한다").toEqual([]);
  });

  test("notifications_log — insert·update·delete·truncate 를 anon·authenticated 양쪽에서 회수한다", () => {
    const revoked = triples(parsePrivStatements(UP_SQL), "revoke");
    for (const role of ["anon", "authenticated"]) {
      for (const priv of WRITE_PRIVS) {
        expect(revoked.has(`${role}|notifications_log|${priv}`), `${role} 의 notifications_log ${priv} 가 남는다`).toBe(true);
      }
    }
  });

  test("reservations — insert·delete·truncate 는 양쪽에서, update 는 anon 에서 회수한다 (authenticated update 는 0010 이 이미 닫았다)", () => {
    const revoked = triples(parsePrivStatements(UP_SQL), "revoke");
    for (const role of ["anon", "authenticated"]) {
      for (const priv of ["insert", "delete", "truncate"]) {
        expect(revoked.has(`${role}|reservations|${priv}`), `${role} 의 reservations ${priv} 가 남는다`).toBe(true);
      }
    }
    expect(revoked.has("anon|reservations|update"), "anon 의 reservations update 가 남으면 RLS 가 다시 유일한 방어선이다").toBe(true);
  });

  test("select 는 어디서도 회수하지 않는다 — 관리자 화면이 그것으로 읽는다(0009 정책)", () => {
    for (const s of parsePrivStatements(UP_SQL)) {
      expect(s.privs, `${s.raw} 가 select 를 건드린다`).not.toContain("select");
      expect(s.privs, `${s.raw} 가 all 로 뭉뚱그린다 — select 까지 사라진다`).not.toContain("all");
    }
    expect(sqlCode(UP_SQL)).not.toMatch(/revoke\s+all/);
  });

  test("콘텐츠 6표와 범위 밖 2표는 회수 대상이 아니다 — 회수하면 관리자 화면이 죽는다", () => {
    const stmts = parsePrivStatements(UP_SQL);
    expect(stmts.length, "권한 문장이 하나도 없다").toBeGreaterThan(0);
    for (const s of stmts) {
      expect(TARGET_TABLES as readonly string[], `${s.raw} 가 범위 밖 표를 건드린다`).toContain(s.table);
    }
    const code = sqlCode(UP_SQL);
    for (const t of OUT_OF_SCOPE_TABLES) {
      expect(code, `0012 가 ${t} 를 언급한다 — 이 태스크의 범위가 아니다`).not.toContain(t);
    }
    // 콘텐츠 6표는 "권한이 살아 있는지" 확인하는 검증 블록에서만 나온다. 회수 문장에는 없다.
    for (const s of stmts) {
      expect(CONTENT_TABLES as readonly string[], `${s.raw} 가 콘텐츠 표를 건드린다`).not.toContain(s.table);
    }
  });

  test("부여(grant)는 하나도 없다 — 이 마이그레이션은 닫기만 한다", () => {
    expect(parsePrivStatements(UP_SQL).filter((s) => s.verb === "grant")).toEqual([]);
    expect(sqlCode(UP_SQL)).not.toMatch(/grant\s+(select|insert|update|delete|truncate|all|usage)/);
  });

  test("데이터·스키마를 바꾸지 않는다 — 권한 문장과 검증 블록뿐", () => {
    const code = sqlCode(UP_SQL);
    for (const forbidden of ["create table", "alter table", "drop table", "create policy", "drop policy", "insert into", "delete from", "truncate table", "create or replace function"]) {
      expect(code, `0012 가 "${forbidden}" 을 한다 — 권한만 건드려야 한다`).not.toContain(forbidden);
    }
  });

  test("재실행 안전 — revoke 는 멱등이고 조건 분기(if not exists 류)가 필요 없다", () => {
    const code = sqlCode(UP_SQL);
    // revoke 는 없는 권한을 회수해도 오류가 아니다. 그래서 재실행 안전이 문장 자체의 성질로 성립한다.
    expect(code).toMatch(/revoke /);
    // 재실행하면 실패하는 문장이 섞여 있지 않은지(위 데이터·스키마 검사와 함께 이중으로 본다).
    expect(code).not.toMatch(/create (?!or replace)/);
  });

  test("스스로 검증한다 — 회수 후에도 권한이 남으면 마이그레이션이 실패한다", () => {
    const code = sqlCode(UP_SQL);
    expect(code, "has_table_privilege 로 결과를 확인하지 않는다").toContain("has_table_privilege");
    expect(code, "권한이 남아도 조용히 성공한다 — raise exception 이 없다").toContain("raise exception");
    // 검증 블록은 세 가지를 본다: 회수됐나 · select 는 살아 있나 · 콘텐츠 6표는 멀쩡한가
    for (const t of CONTENT_TABLES) {
      expect(code, `검증 블록이 ${t} 의 권한 생존을 확인하지 않는다`).toContain(t);
    }
  });

  test("0001~0011 을 수정하지 않는다 — 0012 는 파일 하나를 더할 뿐이다", () => {
    // 0009 §6 의 grant 문장과 0010 §6 의 revoke 문장이 그대로 남아 있어야 한다(0012 가 그것을 지우고 다시 쓰지 않았다).
    const nine = sqlCode("supabase/migrations/0009_admin_rls.sql");
    expect(nine).toContain("grant select on table notifications_log to authenticated");
    expect(nine).toContain("grant select, update on table reservations to authenticated");
    const ten = sqlCode("supabase/migrations/0010_admin_reservation_actions.sql");
    expect(ten).toContain("revoke update on table reservations from authenticated");
  });
});

// =============================================================================
// 2. supabase/rollbacks/0012_write_privileges.down.sql — 텍스트
// =============================================================================
describe("2. 0012 롤백", () => {
  test("rollbacks/ 에만 있고, 수동 실행 절차를 헤더에 적는다", () => {
    expect(exists(DOWN_SQL), `${DOWN_SQL} 이 없다`).toBe(true);
    const raw = read(DOWN_SQL);
    expect(raw).toMatch(/migration repair --status reverted 0012/);
    expect(raw).toMatch(/begin;/);
    expect(raw).toMatch(/commit;/);
  });

  test("승인 플래그를 **언제나** 요구한다 — 행 수를 조건으로 걸지 않는다 (독립 리뷰 M2)", () => {
    const raw = read(DOWN_SQL);
    expect(raw, "승인 플래그가 없다 (0003·0009·0010 롤백과 같은 규약)").toContain("bestour.rollback_0012_ack");
    const code = sqlCode(DOWN_SQL);
    expect(code).toContain("raise exception");
    // 처음에는 `if (n + m) > 0 and coalesce(current_setting(…))` 였다. 그러면 빈 DB(= 오픈 전인 지금)에서는
    // 롤백이 말없이 통과하고 TRUNCATE 를 포함한 15종이 조용히 복원된다. 행 0은 "위험 없음" 이 아니라 "아직 없음" 이다.
    expect(code, "행 수가 승인 조건에 섞여 있다 — 빈 DB 에서 조용히 복원된다").not.toMatch(/[>)]\s*0\s+and\s+coalesce\s*\(\s*current_setting/);
    expect(code, "승인 플래그 검사가 단독 조건이 아니다").toContain("if coalesce(current_setting('bestour.rollback_0012_ack', true), '') <> '1' then");
  });

  test("대칭 — 0012 가 회수한 것을 되돌린다. 단 0010 이 닫은 문(reservations update → authenticated)은 되살리지 않는다", () => {
    const revoked = triples(parsePrivStatements(UP_SQL), "revoke");
    const granted = triples(parsePrivStatements(DOWN_SQL), "grant");

    for (const t of revoked) {
      expect(granted.has(t), `0012 가 회수한 ${t} 를 롤백이 되돌리지 않는다`).toBe(true);
    }
    for (const t of granted) {
      expect(revoked.has(t), `롤백이 0012 가 회수하지 않은 ${t} 를 부여한다 — 이전 상태보다 넓어진다`).toBe(true);
    }
    // 0012 는 authenticated 의 reservations update 를 회수하지 않았다(0010 소관). 따라서 롤백도 주면 안 된다 —
    // 주는 순간 리뷰 N5 가 지적한 "관리자가 retention_until·privacy_consent_at 을 고칠 수 있는" 상태로 돌아간다.
    expect(revoked.has("authenticated|reservations|update"), "0012 가 0010 의 회수를 중복 실행하면 롤백이 그것을 되살리게 된다").toBe(false);
    expect(granted.has("authenticated|reservations|update"), "롤백이 0010 이 닫은 문을 되살린다").toBe(false);
  });

  test("데이터는 건드리지 않는다", () => {
    const code = sqlCode(DOWN_SQL);
    for (const forbidden of ["delete from", "truncate table", "drop table", "insert into"]) {
      expect(code, `롤백이 "${forbidden}" 을 한다`).not.toContain(forbidden);
    }
  });

  test("재실행 안전 — grant 는 멱등이고, 표가 없으면 건너뛴다", () => {
    const code = sqlCode(DOWN_SQL);
    expect(code, "표 존재 확인 없이 grant 하면 0001 롤백 뒤 재실행에서 죽는다").toContain("to_regclass");
  });
});

// =============================================================================
// 3. supabase/migrations/0013_anon_write_privileges.sql — 텍스트
//
//    0012 는 "관리자가 authenticated 로 정말 쓰는 표는 건드리지 않는다" 는 규칙으로 범위를 두 표에 한정했다.
//    그 규칙은 `authenticated` 에 대한 것이고 `anon` 에는 해당하지 않는다 — 공개 롤은 어떤 표에도 쓰지 않는다.
//    그래서 0012 뒤에도 `anon` 은 콘텐츠 6표 + `places` 에 insert·update·delete·truncate 를 그대로 갖고 있었다.
// =============================================================================
describe("3. 0013_anon_write_privileges.sql", () => {
  test("존재하고, 0013 번호는 이 파일 하나뿐이다. migrations/ 안에 롤백이 섞여 있지 않다", () => {
    expect(exists(UP13_SQL), `${UP13_SQL} 이 없다`).toBe(true);
    const files = readdirSync(path.join(ROOT, "supabase", "migrations"));
    expect(files.filter((f) => f.startsWith("0013"))).toEqual(["0013_anon_write_privileges.sql"]);
    expect(files.filter((f) => f.endsWith(".down.sql"))).toEqual([]);
  });

  test("7표 × 4동작을 `anon` 에서만 회수한다", () => {
    const revoked = triples(parsePrivStatements(UP13_SQL), "revoke");
    for (const table of ANON_REVOKE_TABLES) {
      for (const priv of WRITE_PRIVS) {
        expect(revoked.has(`anon|${table}|${priv}`), `anon 의 ${table} ${priv} 가 남는다`).toBe(true);
      }
    }
    expect(revoked.size, `회수 삼중항이 ${ANON_REVOKE_TABLES.length} × ${WRITE_PRIVS.length} 가 아니다: ${[...revoked].join(" ")}`).toBe(
      ANON_REVOKE_TABLES.length * WRITE_PRIVS.length,
    );
  });

  test("`authenticated` 는 한 칸도 건드리지 않는다 — 관리자 화면이 그 롤로 쓴다", () => {
    for (const s of parsePrivStatements(UP13_SQL)) {
      expect(s.roles, `${s.raw} 가 authenticated 를 건드린다 — 관리자 화면이 죽는다`).not.toContain("authenticated");
      expect(s.roles, `${s.raw} 가 service_role 을 건드린다`).not.toContain("service_role");
      expect(s.roles, `${s.raw} 가 public 롤을 건드린다 — 이 파일의 범위가 아니다`).not.toContain("public");
    }
  });

  test("select 는 회수하지 않는다 — 공개 사이트가 anon 키로 이 7표를 읽는다", () => {
    for (const s of parsePrivStatements(UP13_SQL)) {
      expect(s.privs, `${s.raw} 가 select 를 건드린다`).not.toContain("select");
      expect(s.privs, `${s.raw} 가 all 로 뭉뚱그린다`).not.toContain("all");
    }
    expect(sqlCode(UP13_SQL)).not.toMatch(/revoke\s+all/);
  });

  test("0012 가 이미 닫은 두 표와 admin_users 는 언급조차 하지 않는다", () => {
    const code = sqlCode(UP13_SQL);
    for (const t of OUT_OF_SCOPE_FOR_13) {
      // 헤더 주석에서는 설명하지만(주석은 stripSqlComments 가 걷어낸다) SQL 본문에는 나오면 안 된다.
      expect(code, `0013 의 SQL 본문이 ${t} 를 건드린다`).not.toContain(t);
    }
  });

  test("부여(grant)는 하나도 없고, 데이터·스키마를 바꾸지 않는다", () => {
    expect(parsePrivStatements(UP13_SQL).filter((s) => s.verb === "grant")).toEqual([]);
    const code = sqlCode(UP13_SQL);
    for (const forbidden of ["create table", "alter table", "drop table", "create policy", "drop policy", "insert into", "delete from", "truncate table", "create or replace function"]) {
      expect(code, `0013 이 "${forbidden}" 을 한다 — 권한만 건드려야 한다`).not.toContain(forbidden);
    }
    expect(code).not.toMatch(/grant\s+(select|insert|update|delete|truncate|all|usage)/);
  });

  test("스스로 검증한다 — 회수 후 상태가 어긋나면 마이그레이션이 실패한다 (0012 §3 과 같은 규약)", () => {
    const code = sqlCode(UP13_SQL);
    expect(code, "has_table_privilege 로 결과를 확인하지 않는다").toContain("has_table_privilege");
    expect(code, "권한이 남아도 조용히 성공한다 — raise exception 이 없다").toContain("raise exception");
    // ② anon select 생존 · ③ authenticated CRUD 생존 — 둘 다 "너무 많이 회수하는" 사고를 잡는 검사다.
    expect(code, "anon select 생존을 확인하지 않는다").toContain("'select'");
    expect(code, "authenticated 쪽 생존을 확인하지 않는다").toContain("authenticated");
  });

  test("TRUNCATE 가 왜 특별한지 파일에 적혀 있다 — RLS 는 TRUNCATE 에 관여하지 않는다", () => {
    // 나머지 세 동작은 공개 정책이 select 뿐이라 0행이 되지만, TRUNCATE 는 정책을 아예 통과하지 않는다.
    // 이 사실이 파일에 없으면 다음 사람이 "RLS 가 막아 주는데 왜 회수하나" 로 되돌린다.
    const raw = read(UP13_SQL);
    expect(raw).toMatch(/TRUNCATE/);
    expect(raw).toMatch(/RLS[^\n]*TRUNCATE|TRUNCATE[^\n]*RLS/);
  });

  test("0001~0012 를 수정하지 않는다 — 0013 은 파일 하나를 더할 뿐이다", () => {
    const twelve = sqlCode(UP_SQL);
    expect(twelve).toContain("revoke insert, update, delete, truncate on table notifications_log from anon, authenticated");
    const nine = sqlCode("supabase/migrations/0009_admin_rls.sql");
    expect(nine).toContain("grant select, insert, update, delete on table notices, popups, gallery, gallery_albums, showcase_routes, vehicles to authenticated");
  });
});

// =============================================================================
// 4. supabase/rollbacks/0013_anon_write_privileges.down.sql — 텍스트
// =============================================================================
describe("4. 0013 롤백", () => {
  test("rollbacks/ 에만 있고, 수동 실행 절차를 헤더에 적는다", () => {
    expect(exists(DOWN13_SQL), `${DOWN13_SQL} 이 없다`).toBe(true);
    const raw = read(DOWN13_SQL);
    expect(raw).toMatch(/migration repair --status reverted 0013/);
    expect(raw).toMatch(/begin;/);
    expect(raw).toMatch(/commit;/);
  });

  test("승인 플래그를 **언제나** 요구한다 — 행 수를 보지 않는다 (0012 롤백과 같은 규약)", () => {
    const raw = read(DOWN13_SQL);
    expect(raw).toContain("bestour.rollback_0013_ack");
    const code = sqlCode(DOWN13_SQL);
    expect(code).toContain("raise exception");
    expect(code, "행 수가 승인 조건에 섞여 있다").not.toMatch(/[>)]\s*0\s+and\s+coalesce\s*\(\s*current_setting/);
    expect(code).toContain("if coalesce(current_setting('bestour.rollback_0013_ack', true), '') <> '1' then");
  });

  test("대칭 — 0013 이 회수한 것을 정확히 되돌린다(더도 덜도 아니게)", () => {
    const revoked = triples(parsePrivStatements(UP13_SQL), "revoke");
    const granted = triples(parsePrivStatements(DOWN13_SQL), "grant");
    for (const t of revoked) expect(granted.has(t), `0013 이 회수한 ${t} 를 롤백이 되돌리지 않는다`).toBe(true);
    for (const t of granted) expect(revoked.has(t), `롤백이 0013 이 회수하지 않은 ${t} 를 부여한다`).toBe(true);
    expect(granted.size).toBe(revoked.size);
  });

  test("데이터는 건드리지 않고, 표가 없으면 건너뛴다", () => {
    const code = sqlCode(DOWN13_SQL);
    for (const forbidden of ["delete from", "truncate table", "drop table", "insert into"]) {
      expect(code, `롤백이 "${forbidden}" 을 한다`).not.toContain(forbidden);
    }
    expect(code, "표 존재 확인 없이 grant 하면 0001·0002·0008 롤백 뒤 재실행에서 죽는다").toContain("to_regclass");
  });
});

// =============================================================================
// 5. DB 실증 — 로컬 스택 + REQUIRE_DB_TESTS=1 에서만. 원격에는 어떤 쓰기도 하지 않는다
// =============================================================================
const gate = dbWriteGate();
const dbEnv = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[write-privileges.test] DB 실증 블록 skip — ${gate.reason}`);
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
  "5. DB — 0012·0013 권한 실증 (로컬 스택 + REQUIRE_DB_TESTS=1)",
  { timeout: 180_000 },
  () => {
    // 이 블록은 pending 통지를 만들고(직접 insert 1건 + definer 함수가 넣는 1건) 몇 개 테스트 동안 들고 있는다.
    // 그 행은 0005 claim 의 사정권 안이라 outbox.test.ts 의 claim 단언과 겹치면 서로를 깨뜨린다 — 같은 잠금으로 줄 세운다
    // (tests/helpers/db-lock.ts). definer 가 넣는 행은 next_attempt_at 을 우리가 정할 수 없어 삽입 순간부터 claim 대상이고,
    // 아래 pushOutOfClaimWindow 는 RPC 왕복이 끝난 뒤에야 민다 — 그 틈을 잠금이 닫는다(P5-9 독립 리뷰 M3).
    withNotificationsLock();
    // 같은 블록이 콘텐츠 표 6개(gallery · gallery_albums 포함)에 행을 넣었다 지운다 — 갤러리 표 전체를 단언하는
    // 블록(home 4-DB)과도 줄 세운다. **순서 고정**: notifications → gallery. 모두가 같은 순서로 잡아야
    // 순환 대기가 생기지 않는다(tests/helpers/db-lock.ts GALLERY_LOCK 주석, 게이트가 강제한다).
    withGalleryLock();

    const baseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
    const serviceHeaders = {
      apikey: dbEnv.serviceRoleKey,
      Authorization: `Bearer ${dbEnv.serviceRoleKey}`,
      "Content-Type": "application/json",
    };
    const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
    const PASSWORD = `p59-${randomUUID()}`;
    const emailFor = (who: string) => `p59-${RUN}-${who}@example.test`;

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

    const asUser = (token: string, method: string, pathAndQuery: string, json?: unknown, prefer?: string) =>
      call(
        method,
        `${dbEnv.restRoot}${pathAndQuery}`,
        { apikey: dbEnv.anonKey as string, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        json,
        prefer,
      );

    const asAnon = (method: string, pathAndQuery: string, json?: unknown) =>
      call(method, `${dbEnv.restRoot}${pathAndQuery}`, { apikey: dbEnv.anonKey as string, "Content-Type": "application/json" }, json);

    /**
     * **권한 거부를 명시적으로** 단언한다 (P4-5 리뷰 K3 · runbook 후속 · P5-13).
     *
     * 이 파일의 거부 단언은 원래 `expect(status).toBeGreaterThanOrEqual(400)` 이었다. 그러면 다음이 전부
     * "보안 성공" 으로 읽힌다: 500(서버가 고장 났다) · 400(입력 검증에서 걸렸다) · 404(표 이름을 잘못 썼다).
     * 셋 중 어느 것도 **"권한이 회수됐다"** 를 증명하지 않는다 — 특히 404 는 오타 하나로 언제든 나오고,
     * 그 상태에서는 권한이 그대로 남아 있어도 테스트가 green 이다.
     *
     * 그래서 둘을 함께 요구한다: PostgREST 의 **상태코드**(권한 거부는 401 또는 403)와 PostgreSQL 의
     * **SQLSTATE `42501`**(insufficient_privilege). 대조군은 아래 "거부와 부재는 구분된다" 테스트가 둔다.
     */
    function expectPermissionDenied(res: Res, what: string): void {
      const body = res.body as { code?: string } | null;
      const shown = JSON.stringify(res.body).slice(0, 300);
      expect([401, 403], `${what}: 권한 거부가 아니다 (status=${res.status} body=${shown})`).toContain(res.status);
      expect(body?.code, `${what}: PostgreSQL 권한 거부 코드(42501)가 아니다 (status=${res.status} body=${shown})`).toBe("42501");
    }

    async function createUser(email: string): Promise<string> {
      const r = await call("POST", `${baseUrl()}/auth/v1/admin/users`, serviceHeaders, { email, password: PASSWORD, email_confirm: true });
      expect(r.status, `사용자 생성 실패: ${JSON.stringify(r.body).slice(0, 300)}`).toBeLessThan(300);
      return (r.body as { id: string }).id;
    }

    async function signIn(email: string): Promise<string> {
      const r = await call(
        "POST",
        `${baseUrl()}/auth/v1/token?grant_type=password`,
        { apikey: dbEnv.anonKey as string, "Content-Type": "application/json" },
        { email, password: PASSWORD },
      );
      expect(r.status, `로그인 실패: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(200);
      return (r.body as { access_token: string }).access_token;
    }

    /** 공개 접수와 같은 경로 — 서비스 롤 insert (lib/reservations/db.ts). 열 목록은 tests/admin-reservations.test.ts 의 seed 와 같다. */
    async function seedReservation(tag: string): Promise<string> {
      const now = new Date();
      const later = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
      const ins = await rest(
        "POST",
        "/reservations",
        {
          public_code: `P59${tag}`.slice(0, 12),
          status: "new",
          name: "P59",
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
      expect(ins.status, `서비스 롤 접수 경로가 막혔다: ${JSON.stringify(ins.body).slice(0, 300)}`).toBe(201);
      return (ins.body as { id: string }[])[0].id;
    }

    /**
     * 이 파일이 만드는 통지 행은 **claim 대상이 되면 안 된다.**
     * 0005 의 `claim_pending_notifications` 는 표 전체에서 `status='pending' and next_attempt_at <= now()` 인 행을 집는다 —
     * 예약·파일을 가리지 않는다. vitest 는 테스트 파일을 병렬로 돌리므로, 이 파일이 pending 행을 살려 두는 동안
     * tests/outbox.test.ts 의 claim 테스트가 그것을 함께 집어 "2회 claim 에 겹치는 id 0" 단언이 깨진다(실측).
     * 그래서 여기서 만드는 pending 행은 전부 next_attempt_at 을 먼 미래로 밀어 claim 창 밖에 둔다.
     * (definer 함수가 넣는 행은 우리가 컬럼을 정할 수 없으므로 호출 직후 서비스 롤로 민다.)
     */
    const OUT_OF_CLAIM_WINDOW = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const pushOutOfClaimWindow = (reservationId: string) =>
      rest("PATCH", `/notifications_log?reservation_id=eq.${reservationId}`, { next_attempt_at: OUT_OF_CLAIM_WINDOW });

    let adminToken = "";
    let plainToken = "";
    let adminId = "";
    let plainId = "";
    let logId = 0;
    let resId = "";
    const madeReservations: string[] = [];
    const madeNotices: number[] = [];
    const madePopups: number[] = [];

    test("준비 — 관리자 1명 · 일반 로그인 1명 · 예약 1건 · pending 통지 1건 (전부 서비스 롤로 만든다)", async () => {
      const probe = await rest("GET", "/reservations?select=id&limit=1");
      expect(probe.status, "이전 마이그레이션이 적용되지 않았다").toBe(200);

      adminId = await createUser(emailFor("admin"));
      plainId = await createUser(emailFor("plain"));
      adminToken = await signIn(emailFor("admin"));
      plainToken = await signIn(emailFor("plain"));
      const add = await rest("POST", "/admin_users", { user_id: adminId, email: emailFor("admin"), note: "P5-9 test" });
      expect(add.status, JSON.stringify(add.body).slice(0, 300)).toBeLessThan(300);

      resId = await seedReservation(`A${RUN.slice(0, 4).toUpperCase()}`);
      madeReservations.push(resId);

      // 아웃박스 enqueue 와 같은 경로 — 서비스 롤 insert (lib/notify/outbox.ts).
      const ins = await rest(
        "POST",
        "/notifications_log",
        { reservation_id: resId, event: "created", channel: "sms", to_phone: "+821000000000", template: "created.customer.sms", status: "pending", next_attempt_at: OUT_OF_CLAIM_WINDOW },
        "return=representation",
      );
      expect(ins.status, `서비스 롤 enqueue 경로가 막혔다: ${JSON.stringify(ins.body).slice(0, 300)}`).toBe(201);
      logId = (ins.body as { id: number }[])[0].id;
    });

    // -------------------------------------------------------------------------
    // 3-1. 회수된 쪽 — 거부(4xx)여야 한다. 0012 이전에는 204/201 이었다.
    // -------------------------------------------------------------------------
    test("관리자 세션 · notifications_log — insert·update·delete 가 전부 권한 거부(42501) 다 (0012 이전엔 update 가 204 였다)", async () => {
      const up = await asUser(adminToken, "PATCH", `/notifications_log?id=eq.${logId}`, { status: "sent" });
      expectPermissionDenied(up, "관리자 세션의 notifications_log PATCH");

      const del = await asUser(adminToken, "DELETE", `/notifications_log?id=eq.${logId}`);
      expectPermissionDenied(del, "관리자 세션의 notifications_log DELETE");

      const post = await asUser(adminToken, "POST", "/notifications_log", {
        reservation_id: resId,
        event: "confirmed",
        channel: "sms",
        to_phone: "+821000000001",
        template: "confirmed.customer.sms",
        status: "sent",
      });
      expectPermissionDenied(post, "관리자 세션의 notifications_log INSERT");

      const still = await rest("GET", `/notifications_log?select=status&reservation_id=eq.${resId}`);
      const rows = still.body as { status: string }[];
      expect(rows.length, "관리자 세션이 통지를 새로 만들었다").toBe(1);
      expect(rows[0].status, "관리자 세션이 '보내지 않은 것을 보냈다' 고 적었다").toBe("pending");
    });

    test("관리자 세션 · reservations — insert·delete 가 권한 거부(42501) 다 (update 는 0010 이 이미 닫았다)", async () => {
      const post = await asUser(adminToken, "POST", "/reservations", { public_code: `P59X${RUN.slice(0, 3)}`, name: "X", phone: "010-0000-0000", vehicle_slug: "bus45", purpose_code: "family", origin_code: "SEL", destination_code: "BSN", trip_type: "oneway", depart_at: new Date(Date.now() + 864e5).toISOString() });
      expectPermissionDenied(post, "관리자 세션의 reservations INSERT");

      const del = await asUser(adminToken, "DELETE", `/reservations?id=eq.${resId}`);
      expectPermissionDenied(del, "관리자 세션의 reservations DELETE");

      const patch = await asUser(adminToken, "PATCH", `/reservations?id=eq.${resId}`, { retention_until: new Date(Date.now() + 9 * 864e5).toISOString() });
      expectPermissionDenied(patch, "관리자 세션의 reservations UPDATE (0010 이 닫았다)");

      const still = await rest("GET", `/reservations?select=id,status&id=eq.${resId}`);
      expect((still.body as unknown[]).length, "관리자 세션이 예약을 지웠다").toBe(1);
    });

    test("anon 세션도 같다 — 회수는 두 롤 모두에서 이뤄졌다", async () => {
      const up = await asAnon("PATCH", `/notifications_log?id=eq.${logId}`, { status: "sent" });
      expectPermissionDenied(up, "anon 의 notifications_log PATCH");
      const del = await asAnon("DELETE", `/reservations?id=eq.${resId}`);
      expectPermissionDenied(del, "anon 의 reservations DELETE");
    });

    /**
     * 0017 (P5-13) — **`anon` 은 두 개인정보 표를 읽지도 못한다.**
     *
     * 0017 이전에는 200 + `[]` 였다. 그 0행은 **RLS 정책이 없어서** 생기는 결과일 뿐이라,
     * 누군가 `anon` 용 select 정책을 한 줄 붙이는 순간 고객 표가 통째로 공개된다 — 권한 층이 비어 있었기 때문이다.
     * 회수 뒤에는 정책과 무관하게 **권한에서 먼저 막힌다**(401 · 42501). 방어선이 하나에서 둘로 늘었다.
     */
    test("0017 실행 증명 — anon 의 두 개인정보 표 select 가 권한 거부(42501) 다 (이전에는 200 + 빈 배열이었다)", async () => {
      for (const table of PII_TABLES) {
        const r = await asAnon("GET", `/${table}?select=id&limit=1`);
        expectPermissionDenied(r, `anon 의 ${table} SELECT`);
      }
    });

    /**
     * 대조군 — "거부" 와 "부재" 가 **다른 응답**임을 같은 블록에서 보인다 (리뷰 K3).
     * 이것이 없으면 `expectPermissionDenied` 가 무엇을 걸러 내는지 알 수 없다: 표 이름에 오타가 하나 나면
     * 404 가 오는데, `status >= 400` 만 보던 옛 단언은 그것도 "보안 성공" 으로 읽었다.
     */
    test("거부와 부재는 구분된다 — 없는 표는 404(PGRST205), 권한 없는 표는 401(42501)", async () => {
      const missing = await asAnon("GET", "/p513_no_such_table?select=id");
      expect(missing.status, `없는 표가 404 가 아니다: ${JSON.stringify(missing.body).slice(0, 300)}`).toBe(404);
      expect((missing.body as { code?: string } | null)?.code, "없는 표의 코드가 PGRST205 가 아니다").toBe("PGRST205");

      const denied = await asAnon("GET", "/reservations?select=id&limit=1");
      expect(denied.status, "권한 없는 표가 401/403 이 아니다").not.toBe(404);
      expectPermissionDenied(denied, "대조군 대비 — anon 의 reservations SELECT");
    });

    test("0017 실행 증명 — `authenticated`(관리자) 의 두 표 select 는 그대로 200 이다", async () => {
      const log = await asUser(adminToken, "GET", `/notifications_log?select=id,status&id=eq.${logId}`);
      expect(log.status, `관리자 발송 내역이 죽었다: ${JSON.stringify(log.body).slice(0, 300)}`).toBe(200);
      expect((log.body as unknown[]).length, "관리자가 발송 내역을 읽지 못한다").toBe(1);

      const res = await asUser(adminToken, "GET", `/reservations?select=id,status&id=eq.${resId}`);
      expect(res.status, `관리자 예약 목록이 죽었다: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
      expect((res.body as unknown[]).length, "관리자가 예약을 읽지 못한다").toBe(1);
    });

    // -------------------------------------------------------------------------
    // 3-2. 남겨야 하는 쪽 — 정상 경로가 하나도 막히지 않았다
    // -------------------------------------------------------------------------
    test("관리자 select 는 그대로 200 — 0009 의 두 정책이 살아 있다", async () => {
      const log = await asUser(adminToken, "GET", `/notifications_log?select=id,status&id=eq.${logId}`);
      expect(log.status, JSON.stringify(log.body).slice(0, 300)).toBe(200);
      expect((log.body as unknown[]).length).toBe(1);

      const res = await asUser(adminToken, "GET", `/reservations?select=id,status&id=eq.${resId}`);
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      expect((res.body as unknown[]).length).toBe(1);
    });

    test("명단에 없는 로그인 세션은 여전히 0행 — 권한 회수가 RLS 를 대신하지 않는다", async () => {
      const r = await asUser(plainToken, "GET", `/reservations?select=id&id=eq.${resId}`);
      expect(r.status).toBe(200);
      expect(r.body).toEqual([]);
    });

    test("서비스 롤 경로는 전부 그대로 — 접수 insert · enqueue insert · 발송기 update · 파기 delete", async () => {
      // 접수(lib/reservations/db.ts)
      const extra = await seedReservation(`B${RUN.slice(0, 4).toUpperCase()}`);
      madeReservations.push(extra);

      // enqueue(lib/notify/outbox.ts)
      const enq = await rest(
        "POST",
        "/notifications_log",
        { reservation_id: extra, event: "created", channel: "sms", to_phone: "+821000000002", template: "created.customer.sms", status: "pending", next_attempt_at: OUT_OF_CLAIM_WINDOW },
        "return=representation",
      );
      expect(enq.status, JSON.stringify(enq.body).slice(0, 300)).toBe(201);
      const extraLogId = (enq.body as { id: number }[])[0].id;

      // 발송기(lib/notify/worker.ts) — pending → sent
      const sent = await rest("PATCH", `/notifications_log?id=eq.${extraLogId}`, { status: "sent", provider_message_id: "p59-local" });
      expect(sent.status, `발송기의 update 가 막혔다: ${JSON.stringify(sent.body).slice(0, 300)}`).toBeLessThan(300);
      const after = await rest("GET", `/notifications_log?select=status&id=eq.${extraLogId}`);
      expect((after.body as { status: string }[])[0].status, "서비스 롤 update 가 0행을 고쳤다").toBe("sent");

      // 파기 크론(lib/retention/purge.ts) — notifications_log 먼저, reservations 다음
      const delLog = await rest("DELETE", `/notifications_log?reservation_id=eq.${extra}`);
      expect(delLog.status, JSON.stringify(delLog.body).slice(0, 300)).toBeLessThan(300);
      const delRes = await rest("DELETE", `/reservations?id=eq.${extra}`);
      expect(delRes.status, JSON.stringify(delRes.body).slice(0, 300)).toBeLessThan(300);
      const gone = await rest("GET", `/reservations?select=id&id=eq.${extra}`);
      expect(gone.body, "서비스 롤 delete 가 0행을 지웠다").toEqual([]);
      madeReservations.splice(madeReservations.indexOf(extra), 1);
    });

    test("0010 definer 함수 3종은 그대로 동작한다 — 권한 회수는 소유자 권한 실행을 막지 않는다", async () => {
      const id = await seedReservation(`C${RUN.slice(0, 4).toUpperCase()}`);
      madeReservations.push(id);

      // 확정: reservations update + notifications_log insert — 둘 다 authenticated 에게서 회수한 동작이다.
      const confirm = await asUser(adminToken, "POST", "/rpc/admin_confirm_reservation", { p_id: id, p_memo: "P59" });
      await pushOutOfClaimWindow(id); // 방금 큐에 쌓인 pending 행을 claim 창 밖으로 (위 주석)
      expect(confirm.status, `definer 확정이 막혔다: ${JSON.stringify(confirm.body).slice(0, 300)}`).toBe(200);
      const cRow = (confirm.body as { outcome: string; enqueued: number }[])[0];
      expect(cRow.outcome).toBe("confirmed");
      expect(cRow.enqueued, "definer 함수가 notifications_log 에 넣지 못했다").toBe(1);

      // 메모: reservations update 만
      const memo = await asUser(adminToken, "POST", "/rpc/admin_update_memo", { p_id: id, p_memo: "P59 memo" });
      expect(memo.status, JSON.stringify(memo.body).slice(0, 300)).toBe(200);
      expect((memo.body as { outcome: string }[])[0].outcome).toBe("memo_updated");

      // 완료: confirmed → done
      const done = await asUser(adminToken, "POST", "/rpc/admin_complete_reservation", { p_id: id, p_memo: null });
      expect(done.status, JSON.stringify(done.body).slice(0, 300)).toBe(200);
      expect((done.body as { outcome: string }[])[0].outcome).toBe("completed");

      const row = await rest("GET", `/reservations?select=status,admin_memo,confirmed_at&id=eq.${id}`);
      const got = (row.body as { status: string; admin_memo: string | null; confirmed_at: string | null }[])[0];
      expect(got.status).toBe("done");
      expect(got.admin_memo).toBe("P59 memo");
      expect(got.confirmed_at).not.toBeNull();
    });

    // -------------------------------------------------------------------------
    // 5-3. 0013 — anon 의 쓰기는 7표 전부에서 거부된다. authenticated 는 그대로.
    // -------------------------------------------------------------------------
    test("anon 세션 · 콘텐츠 6표 + places — update·delete 가 전부 4xx (0013 이전엔 204 였다)", async () => {
      // 필터는 어느 행에도 맞지 않는 값이다. 0013 이 적용됐으면 권한에서 먼저 막히고,
      // 만에 하나 적용되지 않았더라도 RLS(공개 정책은 select 뿐)가 0행을 낸다 — 어느 쪽이든 데이터는 안전하다.
      const NOWHERE: Record<string, string> = {
        notices: "id=eq.0",
        popups: "id=eq.0",
        gallery: "id=eq.0",
        gallery_albums: "id=eq.0",
        showcase_routes: "id=eq.0",
        vehicles: "id=eq.0",
        places: "code=eq.ZZZ",
      };
      for (const table of ANON_REVOKE_TABLES) {
        const filter = NOWHERE[table];
        const up = await asAnon("PATCH", `/${table}?${filter}`, { active: false });
        expectPermissionDenied(up, `anon 의 ${table} PATCH (204=0행 성공도 실패로 본다)`);
        const del = await asAnon("DELETE", `/${table}?${filter}`);
        expectPermissionDenied(del, `anon 의 ${table} DELETE`);
      }
    });

    test("콘텐츠 표는 관리자가 여전히 쓴다 — notices·popups insert·update·delete (0013 이 authenticated 를 건드리지 않았음을 실증)", async () => {
      // notices — 활성 행을 만들지 않는다(active:false). 다른 파일의 "anon 은 활성 행만 본다" 단언과 겹치지 않게.
      const ins = await asUser(adminToken, "POST", "/notices", { title: `P59-${RUN}`, body: "P5-9", active: false }, "return=representation");
      expect(ins.status, `관리자 화면이 죽었다 — notices insert: ${JSON.stringify(ins.body).slice(0, 300)}`).toBe(201);
      const noticeId = (ins.body as { id: number }[])[0].id;
      madeNotices.push(noticeId);

      const upd = await asUser(adminToken, "PATCH", `/notices?id=eq.${noticeId}`, { title: `P59-${RUN}-edit` });
      expect(upd.status, JSON.stringify(upd.body).slice(0, 300)).toBeLessThan(300);
      const check = await rest("GET", `/notices?select=title&id=eq.${noticeId}`);
      expect((check.body as { title: string }[])[0].title, "관리자 update 가 0행을 고쳤다").toBe(`P59-${RUN}-edit`);

      const del = await asUser(adminToken, "DELETE", `/notices?id=eq.${noticeId}`);
      expect(del.status, JSON.stringify(del.body).slice(0, 300)).toBeLessThan(300);
      const gone = await rest("GET", `/notices?select=id&id=eq.${noticeId}`);
      expect(gone.body, "관리자 delete 가 0행을 지웠다").toEqual([]);
      madeNotices.splice(madeNotices.indexOf(noticeId), 1);

      // popups — 표를 하나 더 확인한다(0009 §6 의 grant 는 6표를 한 문장으로 준다. 하나가 깨지면 보통 전부 깨진다).
      const pIns = await asUser(
        adminToken,
        "POST",
        "/popups",
        { title: `P59-${RUN}`, body: "P5-9", starts_at: "2000-01-01", ends_at: "2000-01-02", active: false },
        "return=representation",
      );
      expect(pIns.status, `관리자 화면이 죽었다 — popups insert: ${JSON.stringify(pIns.body).slice(0, 300)}`).toBe(201);
      const popupId = (pIns.body as { id: number }[])[0].id;
      madePopups.push(popupId);

      const pUpd = await asUser(adminToken, "PATCH", `/popups?id=eq.${popupId}`, { body: "P5-9 edit" });
      expect(pUpd.status, JSON.stringify(pUpd.body).slice(0, 300)).toBeLessThan(300);
      const pDel = await asUser(adminToken, "DELETE", `/popups?id=eq.${popupId}`);
      expect(pDel.status, JSON.stringify(pDel.body).slice(0, 300)).toBeLessThan(300);
      const pGone = await rest("GET", `/popups?select=id&id=eq.${popupId}`);
      expect(pGone.body, "관리자 delete 가 0행을 지웠다").toEqual([]);
      madePopups.splice(madePopups.indexOf(popupId), 1);
    });

    // -------------------------------------------------------------------------
    // 5-4. 0016 — **관리자 화면이 죽지 않는다는 실행 증명**.
    //
    //      행렬 대조(§6·§9)는 "권한이 있다" 까지만 말한다. 이 블록은 **관리자 세션으로 실제 쓰고 지워** 2xx 를 본다.
    //      0016 이 회수한 것 중 관리자 경로에 닿을 수 있는 둘을 특히 겨눈다:
    //        · REFERENCES 회수 → 외래키가 있는 표에 쓸 수 있는가 (`gallery.album_id` → `gallery_albums`)
    //        · TRIGGER   회수 → 트리거가 달린 표에서 지울 때 그 트리거가 발화하는가 (0015 의 before delete)
    //      둘 다 "권한은 만들 때만 검사된다" 는 성질에 기대는데, 그 성질을 문서가 아니라 실행으로 확인한다.
    // -------------------------------------------------------------------------
    test("0016 실행 증명 — 관리자 세션이 gallery_albums·gallery 에 쓰고 지운다 (REFERENCES·TRIGGER 회수 뒤에도)", async () => {
      // ① 앨범 insert — 비활성으로 만든다(다른 파일의 "공개는 활성만 본다" 단언과 겹치지 않게).
      const albumSlug = `p512-${RUN}`;
      const aIns = await asUser(
        adminToken,
        "POST",
        "/gallery_albums",
        { slug: albumSlug, title: `P5-12 ${RUN}`, sort: 910001, active: false },
        "return=representation",
      );
      expect(aIns.status, `관리자 화면이 죽었다 — gallery_albums insert: ${JSON.stringify(aIns.body).slice(0, 300)}`).toBe(201);
      const albumId = (aIns.body as { id: number }[])[0].id;

      const aUpd = await asUser(adminToken, "PATCH", `/gallery_albums?id=eq.${albumId}`, { title: `P5-12 ${RUN} edit` });
      expect(aUpd.status, `gallery_albums update: ${JSON.stringify(aUpd.body).slice(0, 300)}`).toBeLessThan(300);

      // ② 사진 insert — **album_id 로 외래키를 탄다.** REFERENCES 를 회수했어도 무결성 검사는 내부 RI 트리거가
      //    표 소유자 권한으로 돌므로 통과해야 한다. 여기가 4xx 면 0016 이 관리자 화면을 죽인 것이다.
      const photoPath = `p512/${RUN}.webp`;
      const gIns = await asUser(
        adminToken,
        "POST",
        "/gallery",
        { image_path: photoPath, original_path: `p512/${RUN}.orig`, sort: 910001, active: true, album_id: albumId },
        "return=representation",
      );
      expect(gIns.status, `외래키가 있는 표에 관리자가 쓰지 못한다 — gallery insert: ${JSON.stringify(gIns.body).slice(0, 300)}`).toBe(201);
      const photoId = (gIns.body as { id: number }[])[0].id;

      const gUpd = await asUser(adminToken, "PATCH", `/gallery?id=eq.${photoId}`, { caption: "P5-12" });
      expect(gUpd.status, `gallery update: ${JSON.stringify(gUpd.body).slice(0, 300)}`).toBeLessThan(300);

      // ③ 앨범 delete — 0015 의 `before delete` 트리거가 달린 표다. TRIGGER 권한을 회수했어도
      //    **발화에는 그 권한이 필요하지 않다**(CREATE TRIGGER 때만 검사된다). 발화했으면 비활성 앨범이었으므로
      //    그 안의 사진이 active=false 로 내려간다 — 그 결과로 "트리거가 돌았다" 를 확인한다.
      const aDel = await asUser(adminToken, "DELETE", `/gallery_albums?id=eq.${albumId}`);
      expect(aDel.status, `트리거가 달린 표에서 관리자가 지우지 못한다 — gallery_albums delete: ${JSON.stringify(aDel.body).slice(0, 300)}`).toBeLessThan(300);

      const after = await rest("GET", `/gallery?select=id,active,album_id&id=eq.${photoId}`);
      const photo = (after.body as { id: number; active: boolean; album_id: number | null }[])[0];
      expect(photo, "앨범을 지웠더니 사진 행까지 사라졌다 — Storage 고아 파일이 생긴다").toBeDefined();
      expect(photo.album_id, "외래키의 on delete set null 이 돌지 않았다").toBeNull();
      expect(photo.active, "0015 트리거가 발화하지 않았다 — TRIGGER 권한 회수가 발화까지 막았다면 숨긴 사진이 공개된다").toBe(false);

      // ④ 사진 delete — 뒷정리도 관리자 세션으로 한다(그것도 증명의 일부다).
      const gDel = await asUser(adminToken, "DELETE", `/gallery?id=eq.${photoId}`);
      expect(gDel.status, `gallery delete: ${JSON.stringify(gDel.body).slice(0, 300)}`).toBeLessThan(300);
      const gone = await rest("GET", `/gallery?select=id&id=eq.${photoId}`);
      expect(gone.body, "관리자 delete 가 0행을 지웠다").toEqual([]);
    });

    /**
     * `showcase_routes` · `vehicles` 는 **행을 늘리지 않는다.**
     * 다른 파일이 이 두 표의 **전체 행 수**를 단언하기 때문이다(tests/admin-routes.test.ts 는 16행을 두 번 세고
     * `rows[마지막]` 을 자기 대상으로 고른다 — 내가 행을 하나 넣으면 그 행이 남의 대상이 된다.
     * tests/schema.test.ts 는 vehicles 를 5행으로 센다). vitest 는 파일을 병렬로 돌리므로 임시 행 하나가
     * 남의 단언을 간헐적으로 깨뜨린다 — 간헐적 red 는 red 보다 나쁘다.
     * 그래서 **실제 관리자 경로 그대로** 확인한다: 노선 관리 화면은 `updateRouteRow`·`setRouteActive` 두 개의
     * **update** 뿐이고(lib/admin/routes.ts — 16행은 고정 집합이다), 차량은 관리 화면 자체가 없다.
     * DELETE 는 **행을 지우지 않는 필터**로 권한 층만 확인한다 — 회수됐다면 401/403 이 오고, 살아 있으면 204 다.
     */
    test("0016 실행 증명 — 관리자 세션이 showcase_routes·vehicles 를 실제로 고치고 되돌린다 (행 수는 그대로)", async () => {
      for (const [table, probe] of [
        ["showcase_routes", "origin_code=eq.ICN&destination_code=eq.SEL"],
        ["vehicles", "slug=eq.bus45"],
      ] as const) {
        const before = await rest("GET", `/${table}?select=id,sort&${probe}`);
        const row = (before.body as { id: number; sort: number | null }[])[0];
        expect(row, `${table} 의 시드 행을 찾지 못했다 — 이전 마이그레이션이 적용되지 않았다`).toBeDefined();
        const original = row.sort;

        const upd = await asUser(adminToken, "PATCH", `/${table}?id=eq.${row.id}`, { sort: 910002 });
        expect(upd.status, `관리자 화면이 죽었다 — ${table} update: ${JSON.stringify(upd.body).slice(0, 300)}`).toBeLessThan(300);
        const mid = await rest("GET", `/${table}?select=sort&id=eq.${row.id}`);
        expect((mid.body as { sort: number | null }[])[0].sort, `${table} update 가 0행을 고쳤다(204 는 성공처럼 보인다)`).toBe(910002);

        const back = await asUser(adminToken, "PATCH", `/${table}?id=eq.${row.id}`, { sort: original });
        expect(back.status, `${table} 되돌리기: ${JSON.stringify(back.body).slice(0, 300)}`).toBeLessThan(300);
        const end = await rest("GET", `/${table}?select=sort&id=eq.${row.id}`);
        expect((end.body as { sort: number | null }[])[0].sort, `${table} 를 원래 값으로 되돌리지 못했다`).toBe(original);

        // delete 권한 — 어느 행에도 맞지 않는 필터다. 권한이 없으면 401/403, 있으면 204.
        const del = await asUser(adminToken, "DELETE", `/${table}?id=eq.0`);
        expect(del.status, `${table} delete 권한이 사라졌다: ${JSON.stringify(del.body).slice(0, 300)}`).toBeLessThan(300);
      }
    });

    test("0016 실행 증명 — `places` 는 관리자 세션도 쓰지 못하고(4xx) 읽기는 200 이다", async () => {
      // places 에는 관리자 쓰기 정책이 아예 없다(0009 는 여섯 표에만 달았다). 0016 이전에는 권한이 있어
      // 문장이 실행되고 RLS 가 0행을 내 PostgREST 가 **204(성공)** 를 돌려줬다 — 거부가 아니라 성공이었다.
      const ins = await asUser(adminToken, "POST", "/places", {
        code: "ZZT", name_ko: "P5-12", name_en: "P5-12", kind: "city", region_code: "SEL",
        lat: 0, lng: 0, svg_x: 0, svg_y: 0, sort: 910003, active: false,
      });
      expectPermissionDenied(ins, "관리자 세션의 places INSERT");

      // 필터는 어느 시드 행에도 맞지 않는 값이다. 0016 이 적용됐으면 권한에서 먼저 막히고,
      // 만에 하나 이 단언이 깨지더라도 시드 데이터는 바뀌지 않는다(0013 의 anon 단언과 같은 안전장치).
      const upd = await asUser(adminToken, "PATCH", "/places?code=eq.ZZT", { sort: 910003 });
      expectPermissionDenied(upd, "관리자 세션의 places UPDATE (204=0행 성공도 실패로 본다)");

      const del = await asUser(adminToken, "DELETE", "/places?code=eq.ZZT");
      expectPermissionDenied(del, "관리자 세션의 places DELETE");

      // 시드 17행은 그대로다 — 위 셋 중 어느 것도 표를 건드리지 못했다.
      const rows = await rest("GET", "/places?select=code");
      expect((rows.body as unknown[]).length, "places 의 시드 행이 바뀌었다").toBe(17);

      // 읽기는 두 롤 모두 살아 있다 — 관리자 노선 편집 화면과 공개 지도 히어로가 이 표를 읽는다.
      const adminRead = await asUser(adminToken, "GET", "/places?select=code&active=eq.true");
      expect(adminRead.status, JSON.stringify(adminRead.body).slice(0, 300)).toBe(200);
      expect((adminRead.body as unknown[]).length, "관리자가 places 를 읽지 못한다 — 노선 편집 화면의 도시 목록이 빈다").toBeGreaterThan(0);
    });

    test("공개 사이트 읽기(anon)는 무영향 — 7표 전부 활성 행 조회가 그대로 200", async () => {
      const paths = [
        "/notices?select=id&active=eq.true",
        "/popups?select=id&active=eq.true",
        "/showcase_routes?select=id&active=eq.true",
        "/vehicles?select=id&active=eq.true",
        "/gallery?select=id&active=eq.true",
        "/gallery_albums?select=id&active=eq.true",
        "/places?select=code&active=eq.true",
      ];
      for (const p of paths) {
        const r = await asAnon("GET", p);
        expect(r.status, `${p} 가 ${r.status} 를 냈다: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
      }
      // 시드 데이터가 실제로 읽히는지도 본다 — 200 만으로는 "권한은 있는데 0행" 을 구분하지 못한다.
      const places = await asAnon("GET", "/places?select=code&active=eq.true");
      expect((places.body as unknown[]).length, "anon 이 places 를 읽지 못한다 — 지도 히어로가 빈다").toBeGreaterThan(0);
      const routes = await asAnon("GET", "/showcase_routes?select=id&active=eq.true");
      expect((routes.body as unknown[]).length, "anon 이 showcase_routes 를 읽지 못한다 — 홈의 대표 노선이 빈다").toBeGreaterThan(0);
    });

    test("정리 — 만든 것을 전부 지운다", async () => {
      for (const id of madeReservations) {
        await rest("DELETE", `/notifications_log?reservation_id=eq.${id}`);
        await rest("DELETE", `/reservations?id=eq.${id}`);
      }
      for (const id of madeNotices) await rest("DELETE", `/notices?id=eq.${id}`);
      for (const id of madePopups) await rest("DELETE", `/popups?id=eq.${id}`);
      await rest("DELETE", `/admin_users?user_id=eq.${adminId}`);
      for (const id of [adminId, plainId]) {
        if (id) await call("DELETE", `${baseUrl()}/auth/v1/admin/users/${id}`, serviceHeaders);
      }
      const left = await rest("GET", `/reservations?select=id&public_code=like.P59*`);
      expect(left.body, "정리되지 않은 예약이 남았다").toEqual([]);
    });
  },
);

// =============================================================================
// 6. 권한 실측 — pg_catalog 를 직접 본다 (PostgREST 로는 information_schema 를 읽을 수 없다)
//
//    §5 는 행동(PostgREST 응답 코드)을 보고 여기는 권한 상태 자체를 본다. 둘이 필요한 이유는 서로의 사각을 덮기 때문이다:
//    행동만 보면 "권한은 남았는데 RLS 가 막아 4xx" 를 구분하지 못하고, 상태만 보면 "권한은 없는데 다른 경로로 뚫린다" 를 놓친다.
// =============================================================================
describe.skipIf(!gate.allowed)("6. DB — 권한 행렬 실측 (로컬 스택)", { timeout: 300_000 }, () => {
  let verdict = "";

  beforeAll(() => {
    verdict = runLocalSql(
      [
        "select",
        // ① 0012 회수 대상: anon·authenticated 에게 두 개인정보 표의 쓰기 권한이 하나도 남으면 안 된다.
        "  coalesce((select 'PII_WRITE_LEAK ' || string_agg(format('%s/%s/%s', r.role, t.tbl, p.priv), ' ')",
        "     from (values ('anon'),('authenticated')) r(role)",
        "     cross join (values ('public.reservations'),('public.notifications_log')) t(tbl)",
        "     cross join (values ('insert'),('update'),('delete'),('truncate')) p(priv)",
        "    where has_table_privilege(r.role, t.tbl, p.priv)), 'PII_WRITE_NONE') as leaked,",
        // ② 0013 회수 대상: anon 에게 콘텐츠 6표 + places 의 쓰기 권한이 하나도 남으면 안 된다.
        "  coalesce((select 'ANON_WRITE_LEAK ' || string_agg(format('%s/%s', t.tbl, p.priv), ' ')",
        "     from (values ('public.notices'),('public.popups'),('public.gallery'),('public.gallery_albums'),('public.showcase_routes'),('public.vehicles'),('public.places')) t(tbl)",
        "     cross join (values ('insert'),('update'),('delete'),('truncate')) p(priv)",
        "    where has_table_privilege('anon', t.tbl, p.priv)), 'ANON_WRITE_NONE') as anon_leaked,",
        // ③ 남아야 하는 것: 관리자 select 2표 · 공개 select 7표 · 서비스 롤의 두 표 쓰기
        "  coalesce((select 'MISSING ' || string_agg(format('%s/%s/%s', r.role, r.tbl, r.priv), ' ')",
        "     from (values ('authenticated','public.reservations','select'),",
        "                  ('authenticated','public.notifications_log','select'),",
        "                  ('anon','public.notices','select'),",
        "                  ('anon','public.popups','select'),",
        "                  ('anon','public.gallery','select'),",
        "                  ('anon','public.gallery_albums','select'),",
        "                  ('anon','public.showcase_routes','select'),",
        "                  ('anon','public.vehicles','select'),",
        "                  ('anon','public.places','select'),",
        "                  ('service_role','public.reservations','insert'),",
        "                  ('service_role','public.reservations','delete'),",
        "                  ('service_role','public.notifications_log','insert'),",
        "                  ('service_role','public.notifications_log','update'),",
        "                  ('service_role','public.notifications_log','delete')) r(role, tbl, priv)",
        "    where not has_table_privilege(r.role, r.tbl, r.priv)), 'MISSING_NONE') as missing,",
        // ④ 관리자 화면: 콘텐츠 6표의 authenticated CRUD 는 0013 뒤에도 멀쩡해야 한다.
        "  coalesce((select 'CONTENT_BROKEN ' || string_agg(format('%s/%s', t.tbl, p.priv), ' ')",
        "     from (values ('public.notices'),('public.popups'),('public.gallery'),('public.gallery_albums'),('public.showcase_routes'),('public.vehicles')) t(tbl)",
        "     cross join (values ('select'),('insert'),('update'),('delete')) p(priv)",
        "    where not has_table_privilege('authenticated', t.tbl, p.priv)), 'CONTENT_OK') as content;",
      ].join("\n"),
    );
  }, 300_000);

  test("anon·authenticated 에게 reservations·notifications_log 의 쓰기 권한이 하나도 없다 (0012)", () => {
    expect(verdict, verdict).toContain("PII_WRITE_NONE");
  });

  test("anon 에게 콘텐츠 6표 + places 의 쓰기 권한이 하나도 없다 (0013)", () => {
    expect(verdict, verdict).toContain("ANON_WRITE_NONE");
  });

  test("남겨야 하는 권한은 전부 남아 있다 — 관리자 select · 공개 select 7표 · 서비스 롤 쓰기", () => {
    expect(verdict, verdict).toContain("MISSING_NONE");
  });

  test("콘텐츠 6표의 authenticated CRUD 는 멀쩡하다 — 관리자 화면이 살아 있다", () => {
    expect(verdict, verdict).toContain("CONTENT_OK");
  });
});

// =============================================================================
// 7. supabase/migrations/0016_privileges_rls_cannot_protect.sql — 텍스트 (P5-12)
//
//    0012·0013 은 **쓰기 네 동작**만 닫았다. 남은 TRUNCATE·TRIGGER 는 RLS 가 관여하는 종류의 권한이 아니라서,
//    그 둘에 대해서는 "RLS 가 유일한 방어선" 조차 아니고 **아무 방어선도 없었다.**
// =============================================================================
describe("7. 0016_privileges_rls_cannot_protect.sql", () => {
  test("존재하고, 0016 번호는 이 파일 하나뿐이다. migrations/ 안에 롤백이 섞여 있지 않다", () => {
    expect(exists(UP16_SQL), `${UP16_SQL} 이 없다`).toBe(true);
    const files = readdirSync(path.join(ROOT, "supabase", "migrations"));
    expect(files.filter((f) => f.startsWith("0016"))).toEqual(["0016_privileges_rls_cannot_protect.sql"]);
    expect(files.filter((f) => f.endsWith(".down.sql"))).toEqual([]);
  });

  test("일곱 표 × authenticated 에서 truncate·trigger·references 를 회수한다", () => {
    const revoked = triples(parsePrivStatements(UP16_SQL), "revoke");
    for (const table of ANON_REVOKE_TABLES) {
      for (const priv of RLS_BLIND_PRIVS) {
        expect(revoked.has(`authenticated|${table}|${priv}`), `authenticated 의 ${table} ${priv} 가 남는다`).toBe(true);
      }
    }
  });

  test("같은 일곱 표 × anon 에서 trigger·references 를 회수한다 — 0013 은 네 동작만 가져갔다", () => {
    const revoked = triples(parsePrivStatements(UP16_SQL), "revoke");
    for (const table of ANON_REVOKE_TABLES) {
      for (const priv of ANON_RLS_BLIND_PRIVS) {
        expect(revoked.has(`anon|${table}|${priv}`), `anon 의 ${table} ${priv} 가 남는다`).toBe(true);
      }
    }
    // anon 의 TRUNCATE 는 0013 소관이다. 여기서 다시 회수하면 **롤백이** 0013 이 닫은 문을 되살리게 된다
    // (0012 §2 가 reservations update 에서 같은 이유로 피한 함정).
    for (const table of ANON_REVOKE_TABLES) {
      expect(revoked.has(`anon|${table}|truncate`), `0016 이 0013 의 회수를 중복 실행한다 — 롤백이 그것을 되살린다`).toBe(false);
    }
  });

  test("`places` 에서만 authenticated 의 insert·update·delete 를 추가로 회수한다 (select 는 남긴다)", () => {
    const revoked = triples(parsePrivStatements(UP16_SQL), "revoke");
    for (const priv of PLACES_WRITE_PRIVS) {
      expect(revoked.has(`authenticated|places|${priv}`), `places 의 ${priv} 가 남는다 — 관리자 쓰기 정책도 코드 경로도 없다`).toBe(true);
    }
    for (const table of CONTENT_TABLES) {
      for (const priv of PLACES_WRITE_PRIVS) {
        expect(revoked.has(`authenticated|${table}|${priv}`), `${table} 의 ${priv} 를 회수한다 — 관리자 화면이 죽는다`).toBe(false);
      }
      expect(revoked.has(`authenticated|${table}|select`), `${table} 의 select 를 회수한다`).toBe(false);
    }
  });

  test("회수 목록이 정확히 그 셋이다 — 더도 덜도 아니다", () => {
    const revoked = triples(parsePrivStatements(UP16_SQL), "revoke");
    const expected = new Set<string>();
    for (const table of ANON_REVOKE_TABLES) {
      for (const priv of RLS_BLIND_PRIVS) expected.add(`authenticated|${table}|${priv}`);
      for (const priv of ANON_RLS_BLIND_PRIVS) expected.add(`anon|${table}|${priv}`);
    }
    for (const priv of PLACES_WRITE_PRIVS) expected.add(`authenticated|places|${priv}`);
    expect([...revoked].sort(), `회수 삼중항이 기대와 다르다`).toEqual([...expected].sort());
  });

  test("select 는 어디서도 회수하지 않고 `all` 로 뭉뚱그리지 않는다 · service_role 도 건드리지 않는다", () => {
    for (const s of parsePrivStatements(UP16_SQL)) {
      expect(s.privs, `${s.raw} 가 select 를 건드린다`).not.toContain("select");
      expect(s.privs, `${s.raw} 가 all 로 뭉뚱그린다`).not.toContain("all");
      expect(s.roles, `${s.raw} 가 service_role 을 건드린다 — 접수·enqueue·발송기·파기가 그것으로 돈다`).not.toContain("service_role");
      expect(s.roles, `${s.raw} 가 public 롤을 건드린다 — 이 파일의 범위가 아니다`).not.toContain("public");
    }
    expect(sqlCode(UP16_SQL)).not.toMatch(/revoke\s+all\s+on\s+table/);
  });

  test("부여(grant)는 하나도 없다 — 이 마이그레이션은 닫기만 한다", () => {
    expect(parsePrivStatements(UP16_SQL).filter((s) => s.verb === "grant")).toEqual([]);
    // **문장 머리에서만** 찾는다 — 이 파일의 `hint` 문자열들이 다른 마이그레이션의 grant 문(0009 §6 의 시퀀스 usage,
    // 0005 §6 의 service_role execute)을 인용해 "그것이 살아 있는지 확인할 것" 이라고 안내한다(실측).
    expect(sqlCode(UP16_SQL)).not.toMatch(/(?:^|;)\s*grant\s+/);
  });

  test("개인정보 두 표와 admin_users 는 SQL 본문에서 건드리지 않는다 (0012·0009 소관)", () => {
    const code = sqlCode(UP16_SQL);
    for (const t of OUT_OF_SCOPE_FOR_13) {
      expect(code, `0016 의 SQL 본문이 ${t} 를 건드린다`).not.toMatch(new RegExp(`on\\s+table\\s+[a-z_, ]*\\b${t}\\b`));
    }
  });

  test("definer 함수는 **셋**을 `create or replace` 로만 고친다 — `drop function` 금지", () => {
    const code = sqlCode(UP16_SQL);
    // drop 하면 ACL 이 초기화되고 이 DB 의 기본 권한이 공개 롤에 EXECUTE 를 다시 부여한다(CLAUDE.md §3 · 0014 헤더).
    // **문장 머리에서만** 찾는다 — 이 파일의 `hint` 문자열이 "drop function 이 섞여 들어갔다" 를 설명하고 있어서
    // 단순 부분 문자열로 보면 그 설명에 걸린다(실측). compact() 가 문장을 `;` 로 갈라 두므로 앞뒤를 못박을 수 있다.
    expect(code, "drop function 문장이 있다 — ACL 이 초기화돼 기본 권한이 공개 롤에 EXECUTE 를 다시 부여한다").not.toMatch(/(?:^|;)\s*drop\s+function\b/);
    const created = [...code.matchAll(/create or replace function ([a-z_]+)\s*\(/g)].map((m) => m[1]);
    expect(created.sort(), "고치는 함수 목록이 다르다").toEqual([...PG_TEMP_FIXED_FNS].sort());
  });

  test("claim_pending_notifications 는 건드리지 않는다 — 1-인자 판을 만들면 발송기가 42725 로 멈춘다", () => {
    const code = sqlCode(UP16_SQL);
    expect(code, "0016 이 claim 함수를 재정의한다 — 0014 가 2-인자로 바꿨고 이미 pg_temp 다").not.toMatch(
      /create or replace function claim_pending_notifications/,
    );
    // 대신 자기검증이 "1-인자 판이 되살아나지 않았다" 를 확인한다.
    expect(code).toContain("to_regprocedure('public.claim_pending_notifications(int)')");
  });

  test("고치는 것은 `search_path` 한 줄뿐이다 — 세 함수 전부 `public, pg_temp`", () => {
    const code = sqlCode(UP16_SQL);
    // 함수 **선언부**만 센다. `set search_path = public, pg_temp` 는 이 파일의 hint 문자열에도 나오므로
    // 부분 문자열로 세면 4가 된다(실측) — 선언부의 앞뒤(`security definer` … `as $$`)로 못박는다.
    expect(
      [...code.matchAll(/security definer set search_path = public, pg_temp as \$\$/g)].length,
      "세 함수 전부에 pg_temp 가 붙지 않았다",
    ).toBe(PG_TEMP_FIXED_FNS.length);
    expect(code, "pg_temp 없는 옛 형태가 남아 있다").not.toMatch(/set search_path = public as \$\$/);
    // 본문 로직은 0005·0007 원문 그대로여야 한다 — 상태 전이의 핵심 조건을 그대로 담고 있는지 본다.
    expect(code, "mark_notification_sent 의 where 조건이 바뀌었다").toContain("where id = p_id and status = 'pending'");
    expect(code, "reap 의 대상 조건이 바뀌었다").toContain("where status = 'pending' and attempts >= 5 and next_attempt_at <= now()");
    expect(code, "mark_notification_failed 의 백오프 계산이 바뀌었다").toContain("make_interval(secs => greatest(coalesce(p_retry_after_ms, 0), 0) / 1000.0)");
    for (const fn of PG_TEMP_FIXED_FNS) {
      expect(code, `${fn} 이 security definer 가 아니다`).toMatch(new RegExp(`${fn}\\s*\\([^)]*\\)[\\s\\S]{0,160}security definer`));
    }
  });

  test("데이터·스키마를 바꾸지 않는다 — 권한 문장 · 함수 재정의 · 검증 블록뿐", () => {
    const code = sqlCode(UP16_SQL);
    for (const forbidden of ["create table", "alter table", "drop table", "create policy", "drop policy", "insert into", "delete from", "truncate table", "create trigger", "drop trigger"]) {
      expect(code, `0016 이 "${forbidden}" 을 한다`).not.toContain(forbidden);
    }
  });

  test("재실행 안전 — revoke 와 create or replace 는 둘 다 멱등이다", () => {
    const code = sqlCode(UP16_SQL);
    expect(code).toMatch(/revoke /);
    expect(code, "or replace 없는 create 가 있다").not.toMatch(/create (?!or replace)/);
  });

  test("스스로 검증한다 — 다섯 항목을 실행 중에 못박고, 컬럼 단위 grant 까지 본다", () => {
    const code = sqlCode(UP16_SQL);
    expect(code, "has_table_privilege 로 표 권한을 확인하지 않는다").toContain("has_table_privilege");
    // 표 단위 revoke 는 따로 부여된 컬럼 grant 를 지우지 않는다 — has_table_privilege 는 그것을 못 본다(runbook ⚠️).
    expect(code, "컬럼 단위 grant 를 보지 않는다").toContain("has_any_column_privilege");
    expect(code, "함수 권한을 확인하지 않는다").toContain("has_function_privilege");
    expect(code, "시퀀스 권한을 확인하지 않는다 — insert 만 있고 nextval 이 막히면 관리자가 새 행을 못 만든다").toContain("has_sequence_privilege");
    expect(code, "PUBLIC 까지 보는 아클 전수 검사가 없다").toContain("aclexplode");
    expect(code, "proconfig 를 보지 않는다 — pg_temp 가 실제로 붙었는지 확인해야 한다").toContain("proconfig");
    expect(code, "어긋나도 조용히 성공한다 — raise exception 이 없다").toContain("raise exception");
    // 필터된 뷰를 증거로 쓰지 않는다 (CLAUDE.md §3 · runbook 의 ⚠️ 절).
    expect(code, "information_schema.role_table_grants 를 증거로 쓴다 — 필터된 뷰라 PUBLIC 상속을 놓친다").not.toContain(
      "from information_schema.role_table_grants",
    );
    // 관리자 화면 생존(⑤ 의 반대 방향 사고)을 확인하는지.
    for (const t of CONTENT_TABLES) {
      expect(code, `검증 블록이 ${t} 의 권한 생존을 확인하지 않는다`).toContain(t);
    }
  });

  test("TRUNCATE·TRIGGER 가 왜 특별한지 파일에 적혀 있다 — 다음 사람이 되돌리지 않도록", () => {
    const raw = read(UP16_SQL);
    expect(raw).toMatch(/RLS[^\n]*TRUNCATE|TRUNCATE[^\n]*RLS/);
    // TRIGGER 를 남겨 뒀던 **틀린 근거**와 그것이 왜 틀렸는지가 함께 적혀 있어야 한다.
    expect(raw).toMatch(/CREATE TRIGGER/);
    expect(raw).toContain("supabase_functions.http_request");
  });

  test("0001~0015 를 수정하지 않는다 — 0016 은 파일 하나를 더할 뿐이다", () => {
    const five = sqlCode("supabase/migrations/0005_outbox.sql");
    expect(five, "0005 의 EXECUTE 회수가 사라졌다").toContain("revoke all on function mark_notification_sent(bigint, text) from public, anon, authenticated");
    const seven = sqlCode("supabase/migrations/0007_outbox_reaper.sql");
    expect(seven, "0007 의 service_role grant 가 사라졌다").toContain("grant execute on function reap_stale_notifications() to service_role");
    const fourteen = sqlCode("supabase/migrations/0014_claim_by_channel.sql");
    expect(fourteen, "0014 의 1-인자 drop 이 사라졌다").toContain("drop function if exists claim_pending_notifications(int)");
    const nine = sqlCode("supabase/migrations/0009_admin_rls.sql");
    expect(nine).toContain("grant select, insert, update, delete on table notices, popups, gallery, gallery_albums, showcase_routes, vehicles to authenticated");
  });

  test("0012 헤더의 틀린 TRIGGER 근거가 **정정으로** 남아 있다 — 원문을 지우지 않는다", () => {
    const raw = read(UP_SQL);
    // 원문(왜 남겼는지)이 그대로 있어야 기록이 된다.
    expect(raw, "0012 의 원래 근거가 지워졌다 — 무엇이 틀렸는지 알 수 없게 된다").toContain("has_schema_privilege");
    // 그리고 그 아래에 정정이 붙어 있어야 한다.
    expect(raw, "0012 헤더에 정정이 없다").toMatch(/0016/);
    expect(raw).toContain("supabase_functions.http_request");
  });
});

// =============================================================================
// 8. supabase/rollbacks/0016_privileges_rls_cannot_protect.down.sql — 텍스트
// =============================================================================
describe("8. 0016 롤백", () => {
  test("rollbacks/ 에만 있고, 수동 실행 절차를 헤더에 적는다", () => {
    expect(exists(DOWN16_SQL), `${DOWN16_SQL} 이 없다`).toBe(true);
    const raw = read(DOWN16_SQL);
    expect(raw).toMatch(/migration repair --status reverted 0016/);
    expect(raw).toMatch(/begin;/);
    expect(raw).toMatch(/commit;/);
  });

  test("승인 플래그를 **언제나** 요구한다 — 행 수를 조건으로 걸지 않는다", () => {
    const raw = read(DOWN16_SQL);
    expect(raw, "승인 플래그가 없다").toContain("bestour.rollback_0016_ack");
    const code = sqlCode(DOWN16_SQL);
    expect(code).toContain("raise exception");
    expect(code, "행 수가 승인 조건에 섞여 있다 — 빈 DB 에서 조용히 복원된다").not.toMatch(/[>)]\s*0\s+and\s+coalesce\s*\(\s*current_setting/);
    expect(code, "승인 플래그 검사가 단독 조건이 아니다").toContain("if coalesce(current_setting('bestour.rollback_0016_ack', true), '') <> '1' then");
  });

  test("대칭 — 0016 이 회수한 것을 정확히 되돌린다(더도 덜도 아니게)", () => {
    const revoked = triples(parsePrivStatements(UP16_SQL), "revoke");
    const granted = triples(parsePrivStatements(DOWN16_SQL), "grant");
    for (const t of revoked) expect(granted.has(t), `0016 이 회수한 ${t} 를 롤백이 되돌리지 않는다`).toBe(true);
    for (const t of granted) expect(revoked.has(t), `롤백이 0016 이 회수하지 않은 ${t} 를 부여한다 — 이전 상태보다 넓어진다`).toBe(true);
    expect(granted.size).toBe(revoked.size);
  });

  test("`search_path` 를 옛 형태로 되돌린다 — 되돌리지 않으면 0016 재적용에서 검사가 눈이 먼다", () => {
    const code = sqlCode(DOWN16_SQL);
    expect(code, "롤백이 pg_temp 를 그대로 남긴다").not.toMatch(/security definer set search_path = public, pg_temp as \$\$/);
    expect(
      [...code.matchAll(/security definer set search_path = public as \$\$/g)].length,
      "세 함수 전부를 옛 형태로 되돌리지 않았다",
    ).toBe(PG_TEMP_FIXED_FNS.length);
  });

  test("`drop function` 을 쓰지 않는다 — 롤백이 상행보다 넓은 문을 열면 안 된다", () => {
    const code = sqlCode(DOWN16_SQL);
    // 문장 머리에서만 찾는다 — 롤백의 hint 문자열이 "drop function 이 섞였는지 확인할 것" 을 설명한다(위 §7 과 같은 이유).
    expect(code, "drop function 문장이 있다 — ACL 이 초기화돼 기본 권한이 공개 롤에 EXECUTE 를 다시 부여한다").not.toMatch(/(?:^|;)\s*drop\s+function\b/);
    const created = [...code.matchAll(/create or replace function ([a-z_]+)\s*\(/g)].map((m) => m[1]);
    expect(created.sort()).toEqual([...PG_TEMP_FIXED_FNS].sort());
  });

  test("롤백도 스스로 검증한다 — 그중 service_role 실행 가능 확인이 있다 (P4-5 리뷰 K4)", () => {
    const code = sqlCode(DOWN16_SQL);
    expect(code).toContain("raise exception");
    expect(code, "표 권한이 실제로 돌아왔는지 보지 않는다").toContain("has_table_privilege");
    expect(
      code,
      "service_role 실행 가능 확인이 없다 — 롤백이 성공했다고 말하면서 발송기를 죽일 수 있다(K4)",
    ).toContain("has_function_privilege('service_role'");
    expect(code, "공개 롤에 EXECUTE 가 붙었는지 보지 않는다").toContain("aclexplode");
  });

  test("데이터는 건드리지 않고, 표가 없으면 건너뛴다", () => {
    const code = sqlCode(DOWN16_SQL);
    for (const forbidden of ["delete from", "truncate table", "drop table", "insert into"]) {
      expect(code, `롤백이 "${forbidden}" 을 한다`).not.toContain(forbidden);
    }
    expect(code, "표 존재 확인 없이 grant 하면 0001·0002·0008 롤백 뒤 재실행에서 죽는다").toContain("to_regclass");
  });
});

// =============================================================================
// 9. 0016 권한·함수 행렬 실측 — pg_catalog 를 직접 본다 (로컬 스택)
//
//    §5 의 실행 증명과 짝이다. 행동만 보면 "권한은 남았는데 RLS 가 막아 4xx" 를 구분하지 못하고,
//    상태만 보면 "권한은 없는데 관리자 화면이 죽었다" 를 놓친다. TRUNCATE·TRIGGER 는 PostgREST 로
//    호출할 방법이 아예 없으므로, 그 둘은 **여기서만** 확인할 수 있다.
// =============================================================================
describe.skipIf(!gate.allowed)("9. DB — 0016 권한·함수 행렬 실측 (로컬 스택)", { timeout: 300_000 }, () => {
  let verdict = "";
  const SEVEN =
    "(values ('public.notices'),('public.popups'),('public.gallery'),('public.gallery_albums'),('public.showcase_routes'),('public.vehicles'),('public.places'))";

  beforeAll(() => {
    verdict = runLocalSql(
      [
        "select",
        // ① RLS 가 막지 못하는 셋이 authenticated 에게 남았는가 (표 단위 + 컬럼 단위 references).
        "  coalesce((select 'RLS_BLIND_LEAK ' || string_agg(format('%s/%s', t.tbl, p.priv), ' ')",
        `     from ${SEVEN} t(tbl)`,
        "     cross join (values ('truncate'),('trigger'),('references')) p(priv)",
        "    where has_table_privilege('authenticated', t.tbl, p.priv)",
        "       or (p.priv = 'references' and has_any_column_privilege('authenticated', t.tbl, 'references'))), 'RLS_BLIND_NONE') as blind,",
        // ② anon 은 일곱 표에서 select 만 갖는다.
        "  coalesce((select 'ANON_EXTRA ' || string_agg(format('%s/%s', t.tbl, p.priv), ' ')",
        `     from ${SEVEN} t(tbl)`,
        "     cross join (values ('insert'),('update'),('delete'),('truncate'),('trigger'),('references')) p(priv)",
        "    where has_table_privilege('anon', t.tbl, p.priv)), 'ANON_SELECT_ONLY') as anon_extra,",
        // ③ places 의 쓰기 셋은 authenticated 에게서 사라졌고 select 는 두 롤 모두 살아 있다.
        "  coalesce((select 'PLACES_WRITE_LEAK ' || string_agg(p.priv, ' ')",
        "     from (values ('insert'),('update'),('delete')) p(priv)",
        "    where has_table_privilege('authenticated', 'public.places', p.priv)), 'PLACES_WRITE_NONE') as places_write,",
        "  coalesce((select 'PLACES_READ_LOST ' || string_agg(r.role, ' ')",
        "     from (values ('anon'),('authenticated')) r(role)",
        "    where not has_table_privilege(r.role, 'public.places', 'select')), 'PLACES_READ_OK') as places_read,",
        // ④ 함수 셋: proconfig 에 pg_temp 가 있는가.
        "  coalesce((select 'PG_TEMP_MISSING ' || string_agg(p.proname, ' ')",
        "     from pg_proc p join pg_namespace n on n.oid = p.pronamespace",
        "    where n.nspname = 'public'",
        "      and p.proname in ('mark_notification_sent','mark_notification_failed','reap_stale_notifications')",
        "      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like '%pg_temp%')), 'PG_TEMP_OK') as pg_temp,",
        // ⑤ 함수 셋의 EXECUTE 보유자가 service_role(과 소유자) 뿐인가 — create or replace 가 ACL 을 보존했는가.
        "  coalesce((select 'FN_EXEC_EXTRA ' || string_agg(format('%s/%s', p.proname, g.who), ' ')",
        "     from pg_proc p join pg_namespace n on n.oid = p.pronamespace",
        "     cross join lateral (select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as who",
        "                           from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE') g",
        "    where n.nspname = 'public'",
        "      and p.proname in ('mark_notification_sent','mark_notification_failed','reap_stale_notifications')",
        "      and g.who <> 'service_role' and g.who <> pg_get_userbyid(p.proowner)), 'FN_EXEC_ONLY_SERVICE') as fn_exec,",
        // ⑥ 그 셋을 service_role 이 여전히 실행할 수 있는가 — 못 하면 발송기가 멈춘다.
        "  coalesce((select 'FN_SERVICE_LOST ' || string_agg(p.proname, ' ')",
        "     from pg_proc p join pg_namespace n on n.oid = p.pronamespace",
        "    where n.nspname = 'public'",
        "      and p.proname in ('mark_notification_sent','mark_notification_failed','reap_stale_notifications')",
        "      and not has_function_privilege('service_role', p.oid, 'execute')), 'FN_SERVICE_OK') as fn_service,",
        // ⑦ 1-인자 claim 구버전이 되살아나지 않았는가(되살아나면 발송기가 42725 로 멈춘다).
        "  case when to_regprocedure('public.claim_pending_notifications(int)') is not null",
        "       then 'CLAIM_ONE_ARG_BACK' else 'CLAIM_ONE_ARG_GONE' end as claim_old,",
        // ⑧ 콘텐츠 6표의 CRUD 와 시퀀스는 그대로인가 — 관리자 화면이 죽지 않았다는 상태 쪽 증거.
        "  coalesce((select 'ADMIN_BROKEN ' || string_agg(format('%s/%s', t.tbl, p.priv), ' ')",
        "     from (values ('public.notices'),('public.popups'),('public.gallery'),('public.gallery_albums'),('public.showcase_routes'),('public.vehicles')) t(tbl)",
        "     cross join (values ('select'),('insert'),('update'),('delete')) p(priv)",
        "    where not has_table_privilege('authenticated', t.tbl, p.priv)), 'ADMIN_OK') as admin_crud,",
        "  coalesce((select 'SEQ_BROKEN ' || string_agg(s.seq, ' ')",
        "     from (values ('public.notices_id_seq'),('public.popups_id_seq'),('public.gallery_id_seq'),('public.gallery_albums_id_seq'),('public.showcase_routes_id_seq'),('public.vehicles_id_seq')) s(seq)",
        "    where not has_sequence_privilege('authenticated', s.seq, 'usage')), 'SEQ_OK') as seqs;",
      ].join("\n"),
    );
  }, 300_000);

  test("authenticated 에게 TRUNCATE·TRIGGER·REFERENCES 가 하나도 없다 — RLS 가 막지 못하던 것들이다", () => {
    expect(verdict, verdict).toContain("RLS_BLIND_NONE");
  });

  test("anon 은 일곱 표에서 select 만 갖는다 (0013 이 네 동작 · 0016 이 trigger·references)", () => {
    expect(verdict, verdict).toContain("ANON_SELECT_ONLY");
  });

  test("places — 쓰기 셋은 사라지고 두 롤의 읽기는 살아 있다", () => {
    expect(verdict, verdict).toContain("PLACES_WRITE_NONE");
    expect(verdict, verdict).toContain("PLACES_READ_OK");
  });

  test("definer 함수 셋에 pg_temp 가 붙었고 EXECUTE 보유자는 그대로다 — create or replace 가 ACL 을 보존했다", () => {
    expect(verdict, verdict).toContain("PG_TEMP_OK");
    expect(verdict, verdict).toContain("FN_EXEC_ONLY_SERVICE");
    expect(verdict, verdict).toContain("FN_SERVICE_OK");
  });

  test("1-인자 claim 구버전이 되살아나지 않았다 — 되살아나면 호출이 모호해져 발송기가 멈춘다", () => {
    expect(verdict, verdict).toContain("CLAIM_ONE_ARG_GONE");
  });

  test("관리자 화면은 살아 있다 — 콘텐츠 6표 CRUD 와 시퀀스 usage 가 그대로다", () => {
    expect(verdict, verdict).toContain("ADMIN_OK");
    expect(verdict, verdict).toContain("SEQ_OK");
  });
});

// =============================================================================
// 10. supabase/migrations/0017_pii_tables_trigger_references.sql — 텍스트 (P5-13)
//
//     0016 이 닫은 것은 **콘텐츠 일곱 표**뿐이었다. 같은 구멍이 개인정보 두 표에도 있었고, 그쪽이 더 위험하다:
//     `reservations` 에는 고객 성명·전화번호·이메일·문의내용이, `notifications_log` 에는 수신처와 문자 본문이 있다.
// =============================================================================
describe("10. 0017_pii_tables_trigger_references.sql", () => {
  test("존재하고, 0017 번호는 이 파일 하나뿐이다. migrations/ 안에 롤백이 섞여 있지 않다", () => {
    expect(exists(UP17_SQL), `${UP17_SQL} 이 없다`).toBe(true);
    const files = readdirSync(path.join(ROOT, "supabase", "migrations"));
    expect(files.filter((f) => f.startsWith("0017"))).toEqual(["0017_pii_tables_trigger_references.sql"]);
    expect(files.filter((f) => f.endsWith(".down.sql"))).toEqual([]);
  });

  test("두 개인정보 표 × 두 공개 롤에서 trigger·references 를 회수한다", () => {
    const revoked = triples(parsePrivStatements(UP17_SQL), "revoke");
    for (const table of PII_TABLES) {
      for (const role of ["anon", "authenticated"]) {
        for (const priv of PII_RLS_BLIND_PRIVS) {
          expect(revoked.has(`${role}|${table}|${priv}`), `${role} 의 ${table} ${priv} 가 남는다`).toBe(true);
        }
      }
    }
  });

  test("`anon` 의 select 는 회수하고 `authenticated` 의 select 는 남긴다 — 관리자 화면이 두 표를 읽는다", () => {
    const revoked = triples(parsePrivStatements(UP17_SQL), "revoke");
    for (const table of PII_TABLES) {
      for (const priv of PII_ANON_ONLY_PRIVS) {
        expect(revoked.has(`anon|${table}|${priv}`), `anon 의 ${table} ${priv} 가 남는다 — 공개 롤은 이 표를 읽을 이유가 없다`).toBe(true);
        expect(
          revoked.has(`authenticated|${table}|${priv}`),
          `authenticated 의 ${table} ${priv} 를 회수한다 — 관리자 예약 목록·발송 내역이 통째로 빈다`,
        ).toBe(false);
      }
    }
    // `all` 로 뭉뚱그리면 authenticated 의 select 까지 사라진다.
    expect(sqlCode(UP17_SQL)).not.toMatch(/revoke\s+all\s+on\s+table/);
  });

  test("쓰기 네 동작은 다시 회수하지 않는다 — 0010·0012 소관이고, 중복하면 롤백이 그 문을 되살린다", () => {
    const revoked = triples(parsePrivStatements(UP17_SQL), "revoke");
    for (const table of PII_TABLES) {
      for (const role of ["anon", "authenticated"]) {
        for (const priv of WRITE_PRIVS) {
          expect(
            revoked.has(`${role}|${table}|${priv}`),
            `0017 이 0010·0012 의 회수를 중복 실행한다 — 롤백이 ${role} 의 ${table} ${priv} 를 되살리게 된다`,
          ).toBe(false);
        }
      }
    }
  });

  test("회수 목록이 정확히 그것뿐이다 — 더도 덜도 아니다", () => {
    const revoked = triples(parsePrivStatements(UP17_SQL), "revoke");
    const expected = new Set<string>();
    for (const table of PII_TABLES) {
      for (const role of ["anon", "authenticated"]) for (const priv of PII_RLS_BLIND_PRIVS) expected.add(`${role}|${table}|${priv}`);
      for (const priv of PII_ANON_ONLY_PRIVS) expected.add(`anon|${table}|${priv}`);
    }
    expect([...revoked].sort(), "회수 삼중항이 기대와 다르다").toEqual([...expected].sort());
  });

  test("service_role·postgres·public 롤은 건드리지 않는다 — 접수·enqueue·발송기·파기가 서비스 롤로 돈다", () => {
    for (const s of parsePrivStatements(UP17_SQL)) {
      expect(s.roles, `${s.raw} 가 service_role 을 건드린다`).not.toContain("service_role");
      expect(s.roles, `${s.raw} 가 postgres 를 건드린다`).not.toContain("postgres");
      expect(s.roles, `${s.raw} 가 public 롤을 건드린다`).not.toContain("public");
      expect(s.privs, `${s.raw} 가 all 로 뭉뚱그린다`).not.toContain("all");
    }
  });

  test("부여(grant)는 하나도 없다 — 이 마이그레이션은 닫기만 한다", () => {
    expect(parsePrivStatements(UP17_SQL).filter((s) => s.verb === "grant")).toEqual([]);
    // **문장 머리에서만** 찾는다 — hint 문자열이 다른 마이그레이션의 grant 문(0009 §6·0005 §6)을 인용한다(§7 과 같은 이유).
    expect(sqlCode(UP17_SQL)).not.toMatch(/(?:^|;)\s*grant\s+/);
  });

  test("범위 밖 표는 SQL 본문에서 건드리지 않는다 — 콘텐츠 7표는 0013·0016, admin_users 는 0009 소관", () => {
    const code = sqlCode(UP17_SQL);
    for (const t of OUT_OF_SCOPE_FOR_17) {
      expect(code, `0017 의 SQL 본문이 ${t} 를 건드린다`).not.toMatch(new RegExp(`on\\s+table\\s+[a-z_, ]*\\b${t}\\b`));
    }
  });

  test("함수를 만들지도 지우지도 고치지도 않는다 — `drop function` 도 `create or replace` 도 없다", () => {
    const code = sqlCode(UP17_SQL);
    // drop 하면 ACL 이 초기화되고 이 DB 의 기본 권한이 공개 롤에 EXECUTE 를 다시 부여한다(CLAUDE.md §3).
    expect(code, "drop function 문장이 있다").not.toMatch(/(?:^|;)\s*drop\s+function\b/);
    expect(code, "0017 이 함수를 재정의한다 — 이 파일은 표 권한만 다룬다").not.toMatch(/create\s+or\s+replace\s+function/);
  });

  test("데이터·스키마·정책을 바꾸지 않는다 — 권한 문장과 검증 블록뿐", () => {
    const code = sqlCode(UP17_SQL);
    for (const forbidden of ["create table", "alter table", "drop table", "create policy", "drop policy", "insert into", "delete from", "truncate table"]) {
      expect(code, `0017 이 "${forbidden}" 을 한다 — 권한만 건드려야 한다`).not.toContain(forbidden);
    }
    // 거동 탐침이 트리거를 만들었다 지우지만, 그것은 **동적 SQL**(execute format(…)) 안에 있고 최상위 문장이 아니다.
    // 최상위에 남아 있으면 마이그레이션이 트리거를 실제로 남기게 된다.
    expect(code, "최상위 create trigger 문장이 있다 — 탐침은 execute format(…) 안에 있어야 한다").not.toMatch(/(?:^|;)\s*create\s+trigger\b/);
  });

  test("재실행 안전 — revoke 는 멱등이고 조건 분기가 필요 없다", () => {
    const code = sqlCode(UP17_SQL);
    expect(code).toMatch(/revoke /);
    expect(code, "or replace 없는 create 가 최상위에 있다").not.toMatch(/(?:^|;)\s*create\s+(?!or replace)/);
  });

  test("스스로 검증한다 — 표·컬럼·함수 권한을 보고, 어긋나면 마이그레이션이 실패한다", () => {
    const code = sqlCode(UP17_SQL);
    expect(code, "has_table_privilege 로 표 권한을 확인하지 않는다").toContain("has_table_privilege");
    // 표 단위 revoke 는 따로 부여된 컬럼 grant 를 지우지 않는다 — has_table_privilege 는 그것을 못 본다(runbook ⚠️).
    expect(code, "컬럼 단위 grant 를 보지 않는다").toContain("has_any_column_privilege");
    expect(code, "아웃박스 definer 함수의 EXECUTE 보유자를 보지 않는다").toContain("has_function_privilege");
    expect(code, "PUBLIC 까지 보는 아클 전수 검사가 없다").toContain("aclexplode");
    expect(code, "어긋나도 조용히 성공한다 — raise exception 이 없다").toContain("raise exception");
    // 필터된 뷰를 증거로 쓰지 않는다 (CLAUDE.md §3 · runbook 의 ⚠️ 절).
    expect(code, "information_schema.role_table_grants 를 증거로 쓴다 — 필터된 뷰라 PUBLIC 상속을 놓친다").not.toContain(
      "from information_schema.role_table_grants",
    );
    // 컬럼 단위 검사에 표 전용 권한(`delete`·`truncate`·`trigger`)을 리터럴로 넣으면 22023 으로 죽는다
    // (0016 이 적용 중에 한 번 걸렸다). 호출 괄호 안만 본다 — 변수로 넘기는 형태까지는 텍스트로 잡지 못하므로
    // 그쪽은 **마이그레이션이 실제로 적용됐다는 사실**이 증거다(22023 이면 적용이 멈춘다).
    const colCalls = [...code.matchAll(/has_any_column_privilege\s*\([^)]*\)/g)].map((m) => m[0]);
    expect(colCalls.length, "컬럼 단위 권한 검사 호출이 하나도 없다").toBeGreaterThan(0);
    for (const call of colCalls) {
      for (const tableOnly of ["'delete'", "'truncate'", "'trigger'"]) {
        expect(call, `컬럼 단위 검사에 표 전용 권한 ${tableOnly} 이 섞였다 — 22023(unrecognized privilege type)으로 죽는다`).not.toContain(tableOnly);
      }
    }
  });

  /**
   * 표 단위 `select` 는 컬럼 단위 `select` 를 **함의한다.** 그래서 "anon 의 표 단위 select 가 남았다" 와
   * "컬럼 grant 가 따로 남았다" 를 같은 검사로 보면 전자가 후자의 메시지로 보고돼 엉뚱한 곳을 고치게 된다.
   * 두 검사의 **순서**가 그 진단을 가른다 — 순서가 뒤집히면 이 테스트가 잡는다.
   */
  test("자기검증 순서 — `anon` 표 단위 select 검사가 컬럼 단위 검사보다 먼저다 (두 사고가 다른 메시지로 갈린다)", () => {
    const code = sqlCode(UP17_SQL);
    const anonTableCheck = code.indexOf("has_table_privilege('anon'");
    const columnCheck = code.indexOf("has_any_column_privilege(r.role");
    expect(anonTableCheck, "anon 의 표 단위 select 검사가 없다").toBeGreaterThan(-1);
    expect(columnCheck, "컬럼 단위 누수 검사가 없다").toBeGreaterThan(-1);
    expect(anonTableCheck, "컬럼 단위 검사가 먼저 돌면 표 단위 누락까지 '컬럼 grant 가 남았다' 로 보고된다").toBeLessThan(columnCheck);
  });

  test("자기검증이 **거동**까지 본다 — 행렬 대조로 끝내지 않고 실제로 CREATE TRIGGER 를 시도한다", () => {
    const code = sqlCode(UP17_SQL);
    expect(code, "거동 탐침이 없다 — 권한 행렬만으로는 'CREATE TRIGGER 가 정말 막히는가' 를 증명하지 못한다").toContain("create trigger");
    expect(code, "권한 거부 코드(42501)를 명시하지 않는다 — 다른 이유로 실패해도 통과한다").toContain("42501");
    // 대조군이 없으면 "탐침 SQL 이 틀려서 실패한 것" 과 "권한이 없어서 거부된 것" 이 구분되지 않는다.
    expect(code, "대조군(service_role)이 없다").toContain("service_role");
    expect(code, "탐침이 만든 트리거가 남지 않는지 확인하지 않는다").toContain("drop trigger");
  });

  test("무엇이 왜 위험한지 파일에 적혀 있다 — 다음 사람이 되돌리지 않도록", () => {
    const raw = read(UP17_SQL);
    expect(raw, "실제로 붙여 본 실측이 없다").toMatch(/CREATE TRIGGER/);
    expect(raw, "이 DB 의 위험한 트리거 함수를 적지 않았다").toContain("supabase_functions.http_request");
    // `anon` 의 select 를 회수한 **근거**가 적혀 있어야 한다 — 0012 의 "관리자 화면이 읽는다" 는 authenticated 에만 해당한다.
    expect(raw, "anon select 회수의 근거가 없다").toMatch(/anon[^\n]*select|select[^\n]*anon/i);
    expect(raw, "RLS 가 왜 이것을 막지 못하는지 적지 않았다").toMatch(/RLS/);
  });

  test("0001~0016 을 수정하지 않는다 — 0017 은 파일 하나를 더할 뿐이다", () => {
    const nine = sqlCode("supabase/migrations/0009_admin_rls.sql");
    expect(nine, "0009 의 관리자 select grant 가 사라졌다").toContain("grant select on table notifications_log to authenticated");
    expect(nine, "0009 의 reservations grant 가 사라졌다").toContain("grant select, update on table reservations to authenticated");
    const twelve = sqlCode(UP_SQL);
    expect(twelve, "0012 의 회수 문장이 사라졌다").toContain("revoke insert, update, delete, truncate on table notifications_log from anon, authenticated");
    const sixteen = sqlCode(UP16_SQL);
    expect(sixteen, "0016 의 회수 문장이 사라졌다").toContain("revoke trigger, references on table");
  });
});

// =============================================================================
// 11. supabase/rollbacks/0017_pii_tables_trigger_references.down.sql — 텍스트
// =============================================================================
describe("11. 0017 롤백", () => {
  test("rollbacks/ 에만 있고, 수동 실행 절차를 헤더에 적는다", () => {
    expect(exists(DOWN17_SQL), `${DOWN17_SQL} 이 없다`).toBe(true);
    const raw = read(DOWN17_SQL);
    expect(raw).toMatch(/migration repair --status reverted 0017/);
    expect(raw).toMatch(/begin;/);
    expect(raw).toMatch(/commit;/);
  });

  test("승인 플래그를 **언제나** 요구한다 — 행 수를 조건으로 걸지 않는다", () => {
    const raw = read(DOWN17_SQL);
    expect(raw, "승인 플래그가 없다").toContain("bestour.rollback_0017_ack");
    const code = sqlCode(DOWN17_SQL);
    expect(code).toContain("raise exception");
    expect(code, "행 수가 승인 조건에 섞여 있다 — 빈 DB 에서 조용히 복원된다").not.toMatch(/[>)]\s*0\s+and\s+coalesce\s*\(\s*current_setting/);
    expect(code, "승인 플래그 검사가 단독 조건이 아니다").toContain("if coalesce(current_setting('bestour.rollback_0017_ack', true), '') <> '1' then");
  });

  test("대칭 — 0017 이 회수한 것을 정확히 되돌린다(더도 덜도 아니게)", () => {
    const revoked = triples(parsePrivStatements(UP17_SQL), "revoke");
    const granted = triples(parsePrivStatements(DOWN17_SQL), "grant");
    for (const t of revoked) expect(granted.has(t), `0017 이 회수한 ${t} 를 롤백이 되돌리지 않는다`).toBe(true);
    for (const t of granted) expect(revoked.has(t), `롤백이 0017 이 회수하지 않은 ${t} 를 부여한다 — 이전 상태보다 넓어진다`).toBe(true);
    expect(granted.size).toBe(revoked.size);
  });

  test("0010·0012 가 닫은 쓰기 네 동작을 되살리지 않는다", () => {
    const granted = triples(parsePrivStatements(DOWN17_SQL), "grant");
    for (const table of PII_TABLES) {
      for (const role of ["anon", "authenticated"]) {
        for (const priv of WRITE_PRIVS) {
          expect(granted.has(`${role}|${table}|${priv}`), `롤백이 0010·0012 가 닫은 ${role} 의 ${table} ${priv} 를 되살린다`).toBe(false);
        }
      }
    }
  });

  test("되돌린 뒤 무엇이 다시 가능해지는지 헤더가 적는다 — 승인 플래그를 요구하는 근거", () => {
    const raw = read(DOWN17_SQL);
    expect(raw, "http_request 트리거로 개인정보가 나간다는 설명이 없다").toContain("supabase_functions.http_request");
    expect(raw, "예외 메시지가 무엇이 열리는지 말하지 않는다").toMatch(/raise exception '0017 롤백 중단:[^']*http_request/);
  });

  test("함수를 언급조차 하지 않는다 — 0017 이 건드리지 않았으므로 롤백도 건드리지 않는다", () => {
    const code = sqlCode(DOWN17_SQL);
    expect(code, "drop function 문장이 있다").not.toMatch(/(?:^|;)\s*drop\s+function\b/);
    expect(code, "롤백이 함수를 재정의한다 — 상행이 건드리지 않은 것을 하행이 건드리면 대칭이 깨진다").not.toMatch(/create\s+or\s+replace\s+function/);
  });

  test("롤백도 스스로 검증한다 — 관리자 select·서비스 롤·definer EXECUTE 를 함께 본다 (리뷰 K4)", () => {
    const code = sqlCode(DOWN17_SQL);
    expect(code).toContain("raise exception");
    expect(code, "표 권한이 실제로 돌아왔는지 보지 않는다").toContain("has_table_privilege");
    expect(
      code,
      "service_role 실행 가능 확인이 없다 — 롤백이 성공했다고 말하면서 발송기를 죽일 수 있다(K4)",
    ).toContain("has_function_privilege('service_role'");
    expect(code, "공개 롤에 EXECUTE 가 붙었는지 보지 않는다").toContain("aclexplode");
  });

  test("데이터는 건드리지 않고, 표가 없으면 건너뛴다", () => {
    const code = sqlCode(DOWN17_SQL);
    for (const forbidden of ["delete from", "truncate table", "drop table", "insert into"]) {
      expect(code, `롤백이 "${forbidden}" 을 한다`).not.toContain(forbidden);
    }
    expect(code, "표 존재 확인 없이 grant 하면 0001·0005 롤백 뒤 재실행에서 죽는다").toContain("to_regclass");
  });
});

// =============================================================================
// 12. 0017 권한 행렬 + **거동 실증** (로컬 스택)
//
//     §9 와 같은 짝 구조지만 하나가 더 있다: TRUNCATE·TRIGGER 는 PostgREST 로 호출할 방법이 없어 §9 는
//     행렬 대조가 유일한 증거였다. 여기서는 **실제로 `CREATE TRIGGER` 를 쳐 본다** — 로컬 스택의 Postgres 에
//     `set local role` 로 그 롤이 되어 시도하고, 거부 SQLSTATE 가 정확히 `42501` 인지 본다.
//     그리고 **대조군으로 `service_role` 이 같은 문장에 성공하는지** 함께 본다. 대조군이 없으면
//     "탐침 SQL 이 틀려서 실패한 것" 과 "권한이 없어서 거부된 것" 이 구분되지 않는다.
//
//     이 블록은 행을 만들지 않는다(트리거를 만들었다 즉시 지우고, 거부된 시도는 서브트랜잭션이 롤백한다).
//     그래서 아웃박스·갤러리 잠금이 필요 없다 — claim 대상 pending 행을 남기지 않는다.
// =============================================================================
describe.skipIf(!gate.allowed)("12. DB — 0017 권한 행렬 + 거동 실증 (로컬 스택)", { timeout: 300_000 }, () => {
  let verdict = "";
  const TWO = "(values ('public.reservations'),('public.notifications_log'))";
  const FN_NAMES = OUTBOX_DEFINER_FNS.map((f) => `'${f}'`).join(",");

  beforeAll(() => {
    verdict = runLocalSql(
      [
        "select",
        // ① RLS 가 막지 못하는 둘이 두 공개 롤에 남았는가 (표 단위 + 컬럼 단위 references).
        "  coalesce((select 'PII_BLIND_LEAK ' || string_agg(format('%s/%s/%s', r.role, t.tbl, p.priv), ' ')",
        "     from (values ('anon'),('authenticated')) r(role)",
        `     cross join ${TWO} t(tbl)`,
        "     cross join (values ('trigger'),('references')) p(priv)",
        "    where has_table_privilege(r.role, t.tbl, p.priv)",
        "       or (p.priv = 'references' and has_any_column_privilege(r.role, t.tbl, 'references'))), 'PII_BLIND_NONE') as blind,",
        // ② anon 은 두 표에서 **아무 권한도** 갖지 않는다(select 까지 회수했다).
        "  coalesce((select 'ANON_PII_LEFT ' || string_agg(format('%s/%s', t.tbl, p.priv), ' ')",
        `     from ${TWO} t(tbl)`,
        "     cross join (values ('select'),('insert'),('update'),('delete'),('truncate'),('trigger'),('references')) p(priv)",
        "    where has_table_privilege('anon', t.tbl, p.priv)), 'ANON_PII_NONE') as anon_pii,",
        // ③ 관리자 화면: authenticated 의 select 는 표 단위·컬럼 단위 모두 살아 있어야 한다.
        "  coalesce((select 'ADMIN_READ_LOST ' || string_agg(t.tbl, ' ')",
        `     from ${TWO} t(tbl)`,
        "    where not has_table_privilege('authenticated', t.tbl, 'select')",
        "       or not has_any_column_privilege('authenticated', t.tbl, 'select')), 'ADMIN_READ_OK') as admin_read,",
        // ④ 서비스 롤: 접수·enqueue·발송기·파기가 그것으로 돈다. 일곱 동작 전부 그대로여야 한다.
        "  coalesce((select 'SERVICE_LOST ' || string_agg(format('%s/%s', t.tbl, p.priv), ' ')",
        `     from ${TWO} t(tbl)`,
        "     cross join (values ('select'),('insert'),('update'),('delete'),('truncate'),('trigger'),('references')) p(priv)",
        "    where not has_table_privilege('service_role', t.tbl, p.priv)), 'SERVICE_OK') as service,",
        // ⑤ 컬럼 단위 — 표 단위 revoke 가 지우지 못하는 경로. authenticated 의 select 만 예외다.
        "  coalesce((select 'PII_COLUMN_LEAK ' || string_agg(format('%s/%s/%s', r.role, t.tbl, p.priv), ' ')",
        "     from (values ('anon'),('authenticated')) r(role)",
        `     cross join ${TWO} t(tbl)`,
        "     cross join (values ('select'),('insert'),('update'),('references')) p(priv)",
        "    where not (r.role = 'authenticated' and p.priv = 'select')",
        "      and has_any_column_privilege(r.role, t.tbl, p.priv)), 'PII_COLUMN_NONE') as pii_col,",
        // ⑥ PUBLIC 롤 grant 전수 — 표 단위 revoke 는 PUBLIC 의 grant 를 지우지 않는다(CLAUDE.md §3).
        "  coalesce((select 'PII_PUBLIC_ACL ' || string_agg(format('%s/%s', c.relname, a.privilege_type), ' ')",
        "     from pg_class c join pg_namespace n on n.oid = c.relnamespace",
        "     cross join lateral aclexplode(c.relacl) a",
        "    where n.nspname = 'public' and c.relname in ('reservations','notifications_log')",
        "      and a.grantee = 0), 'PII_PUBLIC_NONE') as pii_public,",
        // ⑦ 아웃박스 definer 함수 넷 — 0017 은 함수를 건드리지 않는다. 건드려지지 않았음을 확인한다.
        "  coalesce((select 'OUTBOX_FN_EXTRA ' || string_agg(format('%s/%s', p.proname, g.who), ' ')",
        "     from pg_proc p join pg_namespace n on n.oid = p.pronamespace",
        "     cross join lateral (select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as who",
        "                           from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE') g",
        `    where n.nspname = 'public' and p.proname in (${FN_NAMES})`,
        "      and g.who <> 'service_role' and g.who <> pg_get_userbyid(p.proowner)), 'OUTBOX_FN_ONLY_SERVICE') as fn_exec,",
        "  coalesce((select 'OUTBOX_FN_SERVICE_LOST ' || string_agg(p.proname, ' ')",
        "     from pg_proc p join pg_namespace n on n.oid = p.pronamespace",
        `    where n.nspname = 'public' and p.proname in (${FN_NAMES})`,
        "      and not has_function_privilege('service_role', p.oid, 'execute')), 'OUTBOX_FN_SERVICE_OK') as fn_service,",
        // ⑧ 탐침이 만든 트리거(또는 누가 붙인 트리거)가 두 표에 남아 있지 않은가.
        "  coalesce((select 'PII_USER_TRIGGER ' || string_agg(tgname, ' ')",
        "     from pg_trigger",
        "    where not tgisinternal",
        "      and tgrelid in ('public.reservations'::regclass, 'public.notifications_log'::regclass)), 'PII_NO_USER_TRIGGER') as trg;",
      ].join("\n"),
    );
  }, 300_000);

  test("두 공개 롤에게 TRIGGER·REFERENCES 가 하나도 없다 — RLS 가 막지 못하던 것들이다", () => {
    expect(verdict, verdict).toContain("PII_BLIND_NONE");
  });

  test("`anon` 은 두 개인정보 표에서 **아무 권한도** 갖지 않는다 — select 까지 회수했다", () => {
    expect(verdict, verdict).toContain("ANON_PII_NONE");
  });

  test("관리자 화면은 살아 있다 — `authenticated` 의 select 가 표·컬럼 단위 모두 그대로다", () => {
    expect(verdict, verdict).toContain("ADMIN_READ_OK");
  });

  test("서비스 롤 경로는 그대로다 — 접수·enqueue·발송기·파기가 그것으로 돈다", () => {
    expect(verdict, verdict).toContain("SERVICE_OK");
  });

  test("컬럼 단위 권한과 PUBLIC 상속도 0 — 표 단위 revoke 가 지우지 못하는 두 경로", () => {
    expect(verdict, verdict).toContain("PII_COLUMN_NONE");
    expect(verdict, verdict).toContain("PII_PUBLIC_NONE");
  });

  test("아웃박스 definer 함수 넷은 그대로다 — EXECUTE 보유자는 service_role(+소유자) 뿐이고 실행할 수 있다", () => {
    expect(verdict, verdict).toContain("OUTBOX_FN_ONLY_SERVICE");
    expect(verdict, verdict).toContain("OUTBOX_FN_SERVICE_OK");
  });

  test("두 표에 사용자 트리거가 하나도 없다", () => {
    expect(verdict, verdict).toContain("PII_NO_USER_TRIGGER");
  });

  /**
   * **거동 실증** — 행렬은 "권한이 없다" 까지만 말한다. 여기서는 실제로 `CREATE TRIGGER` 를 친다.
   *
   * 통과 조건은 넷이고, 하나라도 어긋나면 DO 블록이 `raise exception` 해서 runLocalSql 이 던진다:
   *   · `anon`·`authenticated` × 두 표 = 4회 시도가 전부 **거부**되고 SQLSTATE 가 정확히 `42501` 이다
   *   · `service_role` × 두 표 = 2회 시도가 **성공**한다(대조군 — 탐침 SQL 자체는 멀쩡하다는 증거)
   *   · 롤이 원래대로 되돌아온다
   *   · 탐침이 만든 트리거가 하나도 남지 않는다
   *
   * 탐침 함수는 내장 무해 함수(`pg_catalog.suppress_redundant_updates_trigger`)다 — 검사하는 것은
   * "TRIGGER 권한이 CREATE TRIGGER 를 막는가" 이지 특정 함수가 아니고, pg_catalog 함수는 어느 DB 에나 있다.
   * 이 DB 에서 실제로 위험한 것은 `supabase_functions.http_request` 이고, 0017 적용 **전** 실측에서는
   * 그 함수로 네 조합 모두 `CREATE TRIGGER` 에 **성공했다**.
   */
  test("거동 실증 — anon·authenticated 는 두 표에 트리거를 붙일 수 없다(42501) · service_role 은 붙일 수 있다(대조군)", () => {
    const out = runLocalSql(
      [
        "do $$",
        "declare",
        "  probe_n   int := 0;",
        "  trg       text;",
        "  created   boolean;",
        "  st        text;",
        "  ms        text;",
        "  role_name text;",
        "  probe_tbl text;",
        "  applier   constant text := current_user;",
        "begin",
        "  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop",
        "    foreach probe_tbl in array array['reservations', 'notifications_log'] loop",
        "      probe_n := probe_n + 1;",
        "      trg := format('p513_test_probe_%s', probe_n);",
        "      created := false; st := null; ms := null;",
        "      execute format('set local role %I', role_name);",
        "      if current_user <> role_name then",
        "        raise exception 'P513 탐침: 롤 전환이 반영되지 않았다 (current_user=% · 기대=%)', current_user, role_name;",
        "      end if;",
        "      begin",
        "        execute format('create trigger %I before update on public.%I for each row execute function pg_catalog.suppress_redundant_updates_trigger()', trg, probe_tbl);",
        "        created := true;",
        "      exception when others then",
        "        get stacked diagnostics st = returned_sqlstate, ms = message_text;",
        "      end;",
        "      execute 'reset role';",
        "      if created then execute format('drop trigger %I on public.%I', trg, probe_tbl); end if;",
        "      if role_name = 'service_role' then",
        "        if not created then",
        "          raise exception 'P513 탐침: 대조군 실패 — service_role 조차 % 에 트리거를 붙이지 못했다 (SQLSTATE=% MESSAGE=%)', probe_tbl, st, ms;",
        "        end if;",
        "      else",
        "        if created then",
        "          raise exception 'P513 탐침: % 가 % 에 트리거를 붙일 수 있다 — 고객 개인정보가 외부로 나갈 수 있다', role_name, probe_tbl;",
        "        end if;",
        "        if st is distinct from '42501' then",
        "          raise exception 'P513 탐침: 권한 거부(42501)가 아닌 이유로 실패했다 — % → % : SQLSTATE=% MESSAGE=%', role_name, probe_tbl, st, ms;",
        "        end if;",
        "      end if;",
        "    end loop;",
        "  end loop;",
        "  if current_user <> applier then",
        "    raise exception 'P513 탐침: 롤이 되돌아오지 않았다 (current_user=%)', current_user;",
        "  end if;",
        "  if exists (select 1 from pg_trigger where not tgisinternal",
        "               and tgrelid in ('public.reservations'::regclass, 'public.notifications_log'::regclass)) then",
        "    raise exception 'P513 탐침: 탐침이 만든 트리거가 남았다';",
        "  end if;",
        "end",
        "$$;",
      ].join("\n"),
    );
    expect(out, out).toContain("DO");
  }, 300_000);
});
