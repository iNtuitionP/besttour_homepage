/**
 * P1-3 추가 — 0004_kst_dates.sql: 0001 의 `current_date`(DB 세션 TZ = UTC) → KST 달력 날짜 (CLAUDE.md §3).
 *
 * 고치는 버그(P2-1 발견):
 *   - 0001:189 popups_select_active 가 `current_date between starts_at and ends_at` 로 거른다. Supabase 세션 TZ 는 UTC 라
 *     KST 00:00~08:59(= UTC 전날 15:00~23:59)에는 "오늘" 이 KST 기준 어제여서, 그날 시작하는 팝업이 RLS 에 가려 안 보인다.
 *     RLS 가 먼저 막으니 쿼리 계층(isActiveOn)으로는 살릴 수 없다.
 *   - 0001:150 notices.published_at default current_date — 같은 시간대에 올린 공지의 게시일이 전날로 찍힌다.
 *
 * 검증:
 *   1. 0004 텍스트 — 정책·default 양쪽에 `at time zone 'Asia/Seoul'`, 코드 줄에 `current_date` 없음
 *   2. 0004.down.sql — 0001 원문(current_date)으로 복원
 *   3. 재현 조건을 순수 함수로 고정 (lib/kst.toKstDateString)
 *   4. DB — 로컬 스택 + REQUIRE_DB_TESTS=1 일 때만: pg_policy 정의문 + 실제 anon 조회 + notices default
 *
 * 주의: 이 파일은 tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { toKstDateString } from "@/lib/kst";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";
import { runLocalSql } from "./helpers/local-stack-sql";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const ROLLBACKS_DIR = path.join(ROOT, "supabase", "rollbacks");
const UP_SQL_PATH = path.join(MIGRATIONS_DIR, "0004_kst_dates.sql");
const DOWN_SQL_PATH = path.join(ROLLBACKS_DIR, "0004_kst_dates.down.sql");
const INIT_SQL_PATH = path.join(MIGRATIONS_DIR, "0001_init.sql");

const KST_TODAY_SQL = "(now() at time zone 'Asia/Seoul')::date";
const readSql = (p: string) => readFileSync(p, "utf-8");
const stripSqlComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const compact = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// =============================================================================
// 1. 0004_kst_dates.sql 텍스트
// =============================================================================
describe("supabase/migrations/0004_kst_dates.sql", () => {
  test("존재하고, 0004 번호는 이 파일 하나뿐이며 0003 뒤에 온다 (번호 규약: 0004 = kst_dates)", () => {
    expect(existsSync(UP_SQL_PATH)).toBe(true);
    const numbered = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^[0-9]+_.*\.sql$/.test(f))
      .sort();
    expect(numbered.filter((f) => /^0004_/.test(f))).toEqual(["0004_kst_dates.sql"]);
    expect(numbered.indexOf("0003_consent.sql")).toBeLessThan(numbered.indexOf("0004_kst_dates.sql"));
  });

  test("popups_select_active 를 drop 후 KST 오늘로 다시 만든다 — 0001 과 같은 이름·같은 구간(양 끝 포함)", () => {
    const code = compact(stripSqlComments(readSql(UP_SQL_PATH)));
    expect(code).toContain("drop policy if exists popups_select_active on popups;");
    expect(code).toContain(
      compact(
        `create policy popups_select_active on popups for select using (active and ${KST_TODAY_SQL} between starts_at and ends_at);`,
      ),
    );
  });

  test("notices.published_at default 를 KST 오늘로 바꾼다", () => {
    const code = compact(stripSqlComments(readSql(UP_SQL_PATH)));
    expect(code).toContain(compact(`alter table notices alter column published_at set default ${KST_TODAY_SQL};`));
  });

  test("코드 줄에 `at time zone 'Asia/Seoul'` 이 정책·default 양쪽(2회 이상) 있고 current_date 는 없다", () => {
    const code = compact(stripSqlComments(readSql(UP_SQL_PATH)));
    expect(count(code, "at time zone 'asia/seoul'")).toBeGreaterThanOrEqual(2);
    expect(code).not.toContain("current_date");
  });

  test("0001 은 수정하지 않았다 — current_date 가 원래 두 자리(popups 정책·notices default)에 그대로 있다", () => {
    const init = compact(stripSqlComments(readSql(INIT_SQL_PATH)));
    expect(count(init, "current_date")).toBe(2);
    expect(init).toContain("published_at date not null default current_date");
    expect(init).toContain("for select using (active and current_date between starts_at and ends_at)");
    expect(init).not.toContain("asia/seoul");
  });
});

// =============================================================================
// 2. 0004_kst_dates.down.sql
// =============================================================================
describe("supabase/rollbacks/0004_kst_dates.down.sql", () => {
  test("migrations/ 안에는 CLI 패턴에 걸리는 롤백 파일이 없다", () => {
    const stray = readdirSync(MIGRATIONS_DIR).filter(
      (f) => /^[0-9]+_.*\.sql$/.test(f) && /\.down\.sql$|rollback/i.test(f),
    );
    expect(stray).toEqual([]);
  });

  test("존재하고, 정책과 default 를 0001 원문(current_date)으로 되돌리며 Asia/Seoul 은 코드 줄에 없다", () => {
    expect(existsSync(DOWN_SQL_PATH)).toBe(true);
    const code = compact(stripSqlComments(readSql(DOWN_SQL_PATH)));
    expect(code).toContain("drop policy if exists popups_select_active on popups;");
    expect(code).toContain(
      "create policy popups_select_active on popups for select using (active and current_date between starts_at and ends_at);",
    );
    expect(code).toContain("alter table notices alter column published_at set default current_date;");
    expect(code).not.toContain("asia/seoul");
    expect(code).toMatch(/^begin;/);
    expect(code).toMatch(/commit;$/);
  });

  test("복원되는 정책 정의문은 0001 의 것과 글자 단위로 같다", () => {
    const init = compact(stripSqlComments(readSql(INIT_SQL_PATH)));
    const down = compact(stripSqlComments(readSql(DOWN_SQL_PATH)));
    const policyRe = /create policy popups_select_active on popups for select using \([^;]*\);/;
    const initPolicy = init.match(policyRe)?.[0];
    const downPolicy = down.match(policyRe)?.[0];
    expect(initPolicy).toBeDefined();
    expect(downPolicy).toBe(initPolicy);
  });

  test("0002·0003 롤백과 같은 형식 — migration repair --status reverted 0004 안내가 있다", () => {
    expect(readSql(DOWN_SQL_PATH)).toContain("supabase migration repair --status reverted 0004");
  });
});

// =============================================================================
// 3. 재현 조건 — KST 00:00~08:59 에는 UTC 날짜가 KST 날짜보다 하루 앞선다
// =============================================================================
describe("버그 재현 조건 (순수 함수로 고정)", () => {
  test("UTC 2026-09-11 20:00 = KST 2026-09-12 05:00 — UTC 날짜(current_date)는 09-11, KST 오늘은 09-12", () => {
    const instant = new Date("2026-09-11T20:00:00Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-09-11"); // 세션 TZ=UTC 인 DB 의 current_date
    expect(toKstDateString(instant)).toBe("2026-09-12"); // (now() at time zone 'Asia/Seoul')::date
    // 결과: starts_at = '2026-09-12' 인 팝업이 옛 정책에서는 이 시각에 보이지 않는다.
  });

  test("KST 09:00 부터는 두 날짜가 같아 옛 정책도 우연히 맞는다 — 그래서 테스트 시각에 따라 재현이 안 될 수 있다", () => {
    const instant = new Date("2026-09-12T00:00:00Z"); // KST 09:00
    expect(instant.toISOString().slice(0, 10)).toBe(toKstDateString(instant));
  });
});

// =============================================================================
// 4. DB — 로컬 스택 + REQUIRE_DB_TESTS=1 일 때만
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[kst-dates.test] DB 실증 블록 skip — ${gate.reason}`);
}

describe.skipIf(!gate.allowed || !env.hasServiceRole)("DB — 0004 실증 (로컬 스택 + REQUIRE_DB_TESTS=1)", () => {
  const svc = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const popupIds: number[] = [];
  const noticeIds: number[] = [];

  async function svcJson(method: string, pathAndQuery: string, json?: unknown) {
    const res = await fetch(`${env.restRoot}${pathAndQuery}`, {
      method,
      headers: { ...svc, Prefer: "return=representation" },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as unknown) : null };
  }

  // 정책 정의문 — 세션 TZ·실행 시각과 무관한 결정적 증거. REST 로는 pg_catalog 를 못 읽어 CLI(`supabase db query --local`)로 읽는다.
  let policyQual = "";
  let noticeDefault = "";

  beforeAll(async () => {
    policyQual = await runLocalSql(
      "select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'popups_select_active' and polrelid = 'public.popups'::regclass",
    );
    noticeDefault = await runLocalSql(
      "select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum " +
        "where d.adrelid = 'public.notices'::regclass and a.attname = 'published_at'",
    );
    if (!/asia\/seoul/i.test(policyQual)) {
      throw new Error(
        `0004_kst_dates.sql 이 이 DB(${process.env.NEXT_PUBLIC_SUPABASE_URL})에 적용되지 않은 것으로 보인다 — ` +
          `popups_select_active 정의문: ${policyQual.slice(0, 300)}. CI(db-test)라면 supabase db reset 단계를 확인할 것.`,
      );
    }
  });

  afterAll(async () => {
    for (const id of popupIds) await svcJson("DELETE", `/popups?id=eq.${id}`);
    for (const id of noticeIds) await svcJson("DELETE", `/notices?id=eq.${id}`);
    const leftP = await svcJson("GET", `/popups?select=id&title=like.p13kst-*`);
    const leftN = await svcJson("GET", `/notices?select=id&title=like.p13kst-*`);
    expect(leftP.body).toEqual([]);
    expect(leftN.body).toEqual([]);
  });

  test("pg_policy: popups_select_active 정의문에 Asia/Seoul 이 있고 current_date 는 없다", () => {
    expect(policyQual).toMatch(/asia\/seoul/i);
    expect(policyQual).not.toMatch(/current_date/i);
  });

  test("pg_attrdef: notices.published_at default 에 Asia/Seoul 이 있고 current_date 는 없다", () => {
    expect(noticeDefault).toMatch(/asia\/seoul/i);
    expect(noticeDefault).not.toMatch(/current_date/i);
  });

  test.skipIf(!env.anonKey)(
    "anon: starts_at = ends_at = KST 오늘인 팝업은 보이고, KST 내일 팝업은 안 보인다",
    async () => {
      const today = toKstDateString(new Date());
      const tomorrow = toKstDateString(new Date(Date.now() + 24 * 60 * 60 * 1000));
      const made = await svcJson("POST", "/popups", [
        { title: `p13kst-today-${today}`, body: "test", starts_at: today, ends_at: today, active: true },
        { title: `p13kst-tomorrow-${tomorrow}`, body: "test", starts_at: tomorrow, ends_at: tomorrow, active: true },
      ]);
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      const [todayRow, tomorrowRow] = made.body as { id: number }[];
      popupIds.push(todayRow.id, tomorrowRow.id);

      const anon = env.anonKey as string;
      const anonHeaders = { apikey: anon, Authorization: `Bearer ${anon}` };
      const seeToday = await fetch(`${env.restRoot}/popups?select=id&id=eq.${todayRow.id}`, { headers: anonHeaders });
      expect(seeToday.status).toBe(200);
      expect(await seeToday.json()).toEqual([{ id: todayRow.id }]);

      const seeTomorrow = await fetch(`${env.restRoot}/popups?select=id&id=eq.${tomorrowRow.id}`, {
        headers: anonHeaders,
      });
      expect(seeTomorrow.status).toBe(200);
      expect(await seeTomorrow.json()).toEqual([]);
      // 한계: 옛 정책(current_date, UTC)도 KST 09:00~23:59 에는 같은 결과를 낸다. 시각 무관 증거는 위 pg_policy 테스트다.
    },
  );

  test("notices: published_at 을 생략한 insert 의 게시일이 KST 오늘이다", async () => {
    const today = toKstDateString(new Date());
    const made = await svcJson("POST", "/notices", { title: `p13kst-notice-${today}`, body: "test" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const [row] = made.body as { id: number; published_at: string }[];
    noticeIds.push(row.id);
    expect(row.published_at).toBe(today);
  });
});
