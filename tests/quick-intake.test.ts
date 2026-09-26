/**
 * P3-8 — 0023_quick_intake.sql: 간편 접수(intake='quick')가 차종·목적·대수·왕복 구분을 **null** 로 둘 수 있게 넓히되,
 * 위저드 행의 요구는 그대로 두고 지어낸 값이 들어올 길(기본값)을 닫는다.
 *
 * 무엇을 잠그는가
 *   1. 텍스트 — lock_timeout 첫 문장 · 권한 문장 0(새 표·함수·시퀀스 0 → 회수할 것이 없다) · definer 함수 drop/create 0 ·
 *      intake 기본값 제거 · bus_count 기본값 제거 · 두 CHECK · 자기검증 탐침 · 롤백 파일(간편 행이 있으면 멈춘다)
 *   2. DB(로컬 스택 · REQUIRE_DB_TESTS=1) — 카탈로그 모양 + **실제 표**에 치는 거동(한 트랜잭션 안에서 넣고 마지막 raise 로 되돌린다):
 *      intake 누락 → 23502 · 위저드인데 차종 없음 → 23514 · 위저드인데 왕복 구분 없음 → 23514 · 간편 행(전부 null) → 통과 ·
 *      간편 행의 return_at ≤ depart_at → 23514(0001 칸 CHECK 그대로)
 *   권한 게이트(tests/db-privilege-gate.test.ts)는 전량 실행에서 그대로 초록이어야 한다 — 이 파일은 권한을 다시 재지 않는다.
 *
 * 이 파일의 DB 블록은 reservations 에 행을 **커밋하지 않는다**(탐침은 되돌려진다) · notifications_log 를 건드리지 않는다 —
 * 그래서 통지 아웃박스 잠금(tests/helpers/db-lock.ts)의 대상이 아니다(tests/db-test-preconditions.test.ts 의 마커에 걸리지 않는다).
 * 주의: tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";
import { runLocalSql, runLocalSqlExpectingError, sqlCells, sqlErrorText } from "./helpers/local-stack-sql";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const UP_REL = "supabase/migrations/0023_quick_intake.sql";
const DOWN_REL = "supabase/rollbacks/0023_quick_intake.down.sql";
const compact = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

// =============================================================================
// 1. 텍스트
// =============================================================================
describe("1. supabase/migrations/0023_quick_intake.sql — 텍스트", () => {
  const raw = read(UP_REL);
  const code = compact(stripComments(raw, UP_REL));

  test("첫 실행문은 set local lock_timeout = '5s' 이고 곧바로 그 값을 확인한다 (runbook 「적용 경로」)", () => {
    expect(code.startsWith("set local lock_timeout = '5s';")).toBe(true);
    expect(code).toMatch(/current_setting\('lock_timeout'\) <> '5s'/);
  });

  test("권한 문장 0 · 새 표·함수·시퀀스 0 · drop function 0 — 함수는 admin_stats 하나를 create or replace 로만 바꾼다 (CLAUDE.md §3)", () => {
    expect(code).not.toMatch(/\b(grant|revoke)\b/);
    expect(code).not.toMatch(/drop function|create function|create table (?!.*p0023_probe)|create sequence/);
    const replaced = [...code.matchAll(/create or replace function (\w+)\(/g)].map((m) => m[1]);
    expect(replaced).toEqual(["admin_stats"]);
    // 권한·소유자·definer·search_path 를 전후로 대조하는 확인이 있다
    expect(code).toContain("set_config('p0023.stats_before'");
    expect(code).toContain("current_setting('p0023.stats_before', true)");
  });

  test("P2-7 — admin_stats 본문은 0022 와 '기타' 대수 한 줄만 다르다(대수 미상이 섞이면 null)", () => {
    const fnBlock = (rel: string) => {
      const text = read(rel);
      const start = text.indexOf("create or replace function admin_stats(p_from date, p_to date)");
      expect(start, rel).toBeGreaterThan(-1);
      const end = text.indexOf("\nend;\n$$;", start);
      expect(end, rel).toBeGreaterThan(start);
      return text.slice(start, end).split("\n");
    };
    const old = fnBlock("supabase/migrations/0022_admin_stats.sql");
    const neu = fnBlock(UP_REL);
    expect(neu.length).toBe(old.length);
    const diffs = old.map((line, i) => [i, line, neu[i]] as const).filter(([, a, b]) => a !== b);
    expect(diffs.length).toBe(1);
    const [, before, after] = diffs[0];
    expect(before.trim()).toBe(
      "select null::text, sum(y.n)::bigint, sum(y.buses)::bigint, true from vehicle_ranked y where y.rn <= y.hide_n having sum(y.n) > 0",
    );
    expect(after.trim()).toBe(
      "select null::text, sum(y.n)::bigint, case when bool_and(y.buses is not null) then sum(y.buses) end::bigint, true from vehicle_ranked y where y.rn <= y.hide_n having sum(y.n) > 0",
    );
  });

  test("P2-2 — 표를 먼저 ACCESS EXCLUSIVE 로 잡고 그 뒤에 센다(거짓 중단 창 없음)", () => {
    const iLock = code.indexOf("lock table public.reservations in access exclusive mode");
    expect(iLock).toBeGreaterThan(-1);
    expect(iLock).toBeLessThan(code.indexOf("from public.reservations where trip_type is null"));
    expect(iLock).toBeLessThan(code.indexOf("select count(*) into n_before"));
    expect(iLock).toBeLessThan(code.indexOf("alter table public.reservations add column intake"));
  });

  test("P2-3 — 헤더의 롤백 안내가 롤백 파일과 맞다(승인 플래그 없음 · 간편 행이 있으면 멈춘다)", () => {
    const header = raw.slice(0, raw.indexOf("set local lock_timeout"));
    const rollbackLines = header.split("\n").filter((l) => l.includes("롤백"));
    expect(rollbackLines.join("\n")).not.toMatch(/간편 행이 있으면 승인 플래그/);
    expect(header).toContain("승인 플래그 없음");
    expect(header).toContain("무조건 멈춘다");
    expect(read(DOWN_REL)).not.toMatch(/p0023_confirm|approve|승인 플래그를/i);
  });

  test("P2-5 — 간편 행은 인원 필수 CHECK(wizard 는 0001 그대로) · 탐침 두 줄", () => {
    expect(code).toContain("add constraint reservations_quick_passengers_ck check (intake = 'wizard' or passengers is not null)");
    expect(code).toContain("quick_no_pax=23514:reservations_quick_passengers_ck");
    expect(code).toContain("wizard_no_pax=ok");
    expect(compact(stripComments(read(DOWN_REL), DOWN_REL))).toContain("drop constraint if exists reservations_quick_passengers_ck");
  });

  test("intake — not null · 기존 행 wizard(빠른 기본값) → 같은 트랜잭션에서 기본값 제거 · 값은 wizard|quick", () => {
    expect(code).toContain("add column intake text not null default 'wizard'");
    expect(code).toContain("alter column intake drop default");
    expect(code).toContain("check (intake in ('wizard', 'quick'))");
    expect(code.indexOf("add column intake")).toBeLessThan(code.indexOf("alter column intake drop default"));
  });

  test("차종·목적·대수 NOT NULL 해제 + 대수 기본값(1) 제거 — 간편 insert 가 '1대' 를 지어내지 않는다", () => {
    for (const col of ["vehicle_slug", "purpose_code", "bus_count"]) expect(code).toContain(`alter column ${col} drop not null`);
    expect(code).toContain("alter column bus_count drop default");
  });

  test("CHECK — intake='quick' 이거나 세 칸 모두 not null / 왕복 구분 CASE(없음은 quick 만 · round 귀가 필수 · oneway 귀가 금지)", () => {
    expect(code).toContain("intake = 'quick' or (vehicle_slug is not null and purpose_code is not null and bus_count is not null)");
    expect(code).toContain("drop constraint reservations_round_trip_return_ck");
    expect(code).toMatch(/when trip_type is null then intake = 'quick'/);
    expect(code).toMatch(/when trip_type = 'round' then return_at is not null/);
    expect(code).toMatch(/when trip_type = 'oneway' then return_at is null/);
    expect(code).toMatch(/when trip_type = 'oneway_oneway' then true/);
    expect(code).toMatch(/else false/);
  });

  test("자기검증 — 재실행 거부 · 조여지는 기존 행 선검사 · ACL 전후 대조 · 임시 복제본 탐침과 기대 결과 문자열", () => {
    expect(code).toContain("attname = 'intake'");
    expect(code).toContain("from public.reservations where trip_type is null");
    expect(code).toContain("after_acl is distinct from before_acl");
    expect(code).toContain("create temp table p0023_probe (like public.reservations including defaults including constraints)");
    for (const token of [
      "no_intake=23502:intake",
      "wizard_no_vehicle=23514:reservations_intake_fields_ck",
      "wizard_no_bus=23514:reservations_intake_fields_ck",
      "wizard_no_trip=23514:reservations_round_trip_return_ck",
      "bad_intake=23514:reservations_intake_ck",
      "quick_same_day=ok",
      "quick_multi_day=ok",
      "wizard_full=ok",
    ]) {
      expect(code, token).toContain(token);
    }
  });

  test("롤백 파일 — migrations/ 밖 · 간편 행이 있으면 멈춘다(쓰기 잠금 뒤에 센다) · 0006 판 CHECK 복구 · repair 안내", () => {
    expect(existsSync(path.join(ROOT, "supabase/migrations/0023_quick_intake.down.sql"))).toBe(false);
    const down = compact(stripComments(read(DOWN_REL), DOWN_REL));
    expect(down).toContain("lock table public.reservations in exclusive mode");
    expect(down.indexOf("lock table public.reservations")).toBeLessThan(down.indexOf("where intake = 'quick'"));
    expect(down).toMatch(/if n_quick > 0 then raise exception/);
    expect(down).toContain("(trip_type = 'round' and return_at is not null) or (trip_type = 'oneway_oneway') or (trip_type = 'oneway' and return_at is null)");
    expect(down).toContain("alter column bus_count set default 1");
    expect(down).toContain("drop column intake");
    expect(read(DOWN_REL)).toContain("supabase migration repair --status reverted 0023");
    // 값을 지어내거나 행을 지우지 않는다
    expect(down).not.toMatch(/\bdelete from\b|\bupdate public\.reservations\b/);
  });
});

// =============================================================================
// 2. DB — 로컬 스택
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[quick-intake] DB 블록 skip — ${gate.reason}`);
}

describe.skipIf(!gate.allowed || !env.hasServiceRole)("2. DB — 0023 적용 상태 (로컬 스택)", () => {
  test("이력에 0023 이 있다 · intake 칸 not null · 기본값 없음 · 차종·목적·대수 nullable · 대수 기본값 없음", () => {
    const out = runLocalSql(`
select string_agg(format('%s:%s:%s', a.attname, a.attnotnull, a.atthasdef), ' ' order by a.attname)
  || ' | ' || (select count(*) from supabase_migrations.schema_migrations where version = '0023')::text
  from pg_attribute a
 where a.attrelid = 'public.reservations'::regclass
   and a.attname in ('intake', 'vehicle_slug', 'purpose_code', 'bus_count') and not a.attisdropped`);
    const cells = sqlCells(out).join(" ");
    // format('%s', boolean) 은 t/f 로 찍힌다
    expect(cells).toContain("bus_count:f:f");
    expect(cells).toContain("intake:t:f");
    expect(cells).toContain("purpose_code:f:f");
    expect(cells).toContain("vehicle_slug:f:f");
    expect(cells).toMatch(/\| 1\b/);
  });

  test("실제 표 거동 — intake 누락 23502 · 위저드 차종 없음/왕복 구분 없음 23514 · 간편 행 통과 · 간편 귀가 ≤ 출발 23514 (탐침은 되돌려진다)", () => {
    const out = runLocalSqlExpectingError(`
do $$
declare
  o text[] := '{}';
  cn text;
begin
  begin
    insert into public.reservations (public_code, name, phone, vehicle_slug, purpose_code, bus_count, origin_code, destination_code, trip_type, depart_at, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
      values ('P38A0001', 'x', '+821000000000', 'bus45', 'family', 1, 'SEL', 'BSN', 'oneway', now() + interval '7 days', now(), 'probe', now() + interval '365 days', now());
    o := o || 'no_intake=INSERTED'::text;
  exception when not_null_violation then
    get stacked diagnostics cn = column_name;
    o := o || ('no_intake=23502:' || cn);
  end;
  begin
    insert into public.reservations (public_code, intake, name, phone, purpose_code, bus_count, origin_code, destination_code, trip_type, depart_at, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
      values ('P38A0002', 'wizard', 'x', '+821000000000', 'family', 1, 'SEL', 'BSN', 'oneway', now() + interval '7 days', now(), 'probe', now() + interval '365 days', now());
    o := o || 'wizard_no_vehicle=INSERTED'::text;
  exception when check_violation then
    get stacked diagnostics cn = constraint_name;
    o := o || ('wizard_no_vehicle=23514:' || cn);
  end;
  begin
    insert into public.reservations (public_code, intake, name, phone, vehicle_slug, purpose_code, bus_count, origin_code, destination_code, depart_at, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
      values ('P38A0003', 'wizard', 'x', '+821000000000', 'bus45', 'family', 1, 'SEL', 'BSN', now() + interval '7 days', now(), 'probe', now() + interval '365 days', now());
    o := o || 'wizard_no_trip=INSERTED'::text;
  exception when check_violation then
    get stacked diagnostics cn = constraint_name;
    o := o || ('wizard_no_trip=23514:' || cn);
  end;
  insert into public.reservations (public_code, intake, name, phone, origin_code, destination_code, depart_at, return_at, nights, passengers, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
    values ('P38A0004', 'quick', 'x', '+821000000000', 'ICN', 'SEL', date_trunc('day', now()) + interval '7 days', date_trunc('day', now()) + interval '9 days', 2, 30, now(), 'probe', now() + interval '365 days', now());
  o := o || ('quick=OK:' || (select format('%s/%s/%s/%s', coalesce(vehicle_slug, 'NULL'), coalesce(purpose_code, 'NULL'), coalesce(bus_count::text, 'NULL'), coalesce(trip_type, 'NULL'))
                               from public.reservations where public_code = 'P38A0004'));
  begin
    insert into public.reservations (public_code, intake, name, phone, origin_code, destination_code, depart_at, return_at, passengers, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
      values ('P38A0005', 'quick', 'x', '+821000000000', 'ICN', 'SEL', date_trunc('day', now()) + interval '7 days', date_trunc('day', now()) + interval '7 days', 30, now(), 'probe', now() + interval '365 days', now());
    o := o || 'quick_same_instant=INSERTED'::text;
  exception when check_violation then
    o := o || 'quick_same_instant=23514'::text;
  end;
  raise exception 'P38INTAKE %', array_to_string(o, ' ');
end $$;`);
    const text = sqlErrorText(out);
    expect(text).toContain("P38INTAKE");
    expect(text).toContain("no_intake=23502:intake");
    expect(text).toContain("wizard_no_vehicle=23514:reservations_intake_fields_ck");
    expect(text).toContain("wizard_no_trip=23514:reservations_round_trip_return_ck");
    expect(text).toContain("quick=OK:NULL/NULL/NULL/NULL");
    expect(text).toContain("quick_same_instant=23514");
  });

  test("P2-5 실제 표 — 간편 행 인원 null → 23514 quick_passengers_ck · 카탈로그에 제약이 있다 (탐침은 되돌려진다)", () => {
    const out = runLocalSqlExpectingError(`
do $$
declare
  o text[] := '{}';
  cn text;
begin
  begin
    insert into public.reservations (public_code, intake, name, phone, origin_code, destination_code, depart_at, nights, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
      values ('P38A0006', 'quick', 'x', '+821000000000', 'ICN', 'SEL', date_trunc('day', now()) + interval '7 days', 0, now(), 'probe', now() + interval '365 days', now());
    o := o || 'quick_no_pax=INSERTED'::text;
  exception when check_violation then
    get stacked diagnostics cn = constraint_name;
    o := o || ('quick_no_pax=23514:' || cn);
  end;
  o := o || ('def=' || coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
                                   where c.conrelid = 'public.reservations'::regclass and c.conname = 'reservations_quick_passengers_ck'), 'NONE'));
  raise exception 'P38PAX %', array_to_string(o, ' ');
end $$;`);
    const text = sqlErrorText(out);
    expect(text).toContain("P38PAX");
    expect(text).toContain("quick_no_pax=23514:reservations_quick_passengers_ck");
    expect(text).toMatch(/def=CHECK \(\(\(intake = 'wizard'::text\) OR \(passengers IS NOT NULL\)\)\)/);
  });

  test("탐침이 흔적을 남기지 않았다 — P38A 로 시작하는 행 0", () => {
    const out = runLocalSql("select count(*) from public.reservations where public_code like 'P38A%'");
    expect(sqlCells(out).join(" ")).toMatch(/\b0\b/);
  });
});
