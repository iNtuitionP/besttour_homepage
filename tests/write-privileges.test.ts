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
 *   13·14. 0018 SQL·롤백 (P5-14) — **시퀀스.** 0012~0017 이 한 번도 회수하지 않았고, 사람이 아니라 P6-11 게이트가 먼저 찾았다.
 *        회수 집합이 정확하고(콘텐츠 여섯의 `authenticated` usage 는 남긴다) 롤백이 대칭이며 승인 플래그를 조건 없이 요구한다
 *   15. 0018 권한 행렬 + **거동 실증** — `setval`·`nextval` 을 공개 롤로 직접 쳐서 42501 을 보고, 허용된 두 경로
 *        (관리자 nextval · 서비스 롤 nextval)는 성공하는지 대조군으로 본다. §5 에는 관리자 insert 4종 201 과 서비스 롤 통지 적재가 있다
 *   16·17. 0019 SQL·롤백 (P5-15) — **표 권한 `MAINTAIN`**(PG17 · LOCK TABLE·VACUUM·ANALYZE — RLS 밖). 게이트가 권한 종류를
 *        하드코딩해 놓쳤다. **버전 조건부**(16 이하에서는 notice 만)이고 표는 카탈로그 열거, 롤백은 기본 기준선 아홉 표 고정 목록
 *   18. 0019 행렬 + **LOCK 거동 실증** + 버전 분기(실제 파일의 판정 줄 치환). §5-6 에는 0019 뒤 관리자 CRUD 2xx 와
 *        앱의 실제 `enqueue`·파기 어댑터 실행이 있다
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

import { withGalleryLock, withNotificationsLock, withShowcaseRoutesLock } from "./helpers/db-lock";
import { expectPermissionDenied } from "./helpers/expect-denied";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";
import { runLocalSql, runLocalSqlExpectingError, runLocalSuperuserSqlExpectingError, sqlCells, sqlErrorText } from "./helpers/local-stack-sql";
import { type SqlDataMode, sqlView, stripComments } from "./helpers/strip-comments";

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
const UP18_SQL = "supabase/migrations/0018_sequence_privileges.sql";
const DOWN18_SQL = "supabase/rollbacks/0018_sequence_privileges.down.sql";

const compact = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * 값 단언용 — CLI 출력 형식(로컬 JSON · CI 의 ASCII 표)을 지우고 **값 칸만** 이어 붙인다 (P5-15 R9).
 * 따옴표·표 테두리에 기댄 정규식은 CI 에서 깨진다(f696020 DB Smoke).
 */
const sqlValue = (sql: string) => sqlCells(runLocalSql(sql)).join(" | ");
/** 되돌려지는 탐침 — 오류 메시지만 뽑는다(JSON 이스케이프를 풀고 표 테두리를 지운다). 두 CLI 형식에서 같은 글자가 된다. */
const probeError = (sql: string) => sqlErrorText(runLocalSqlExpectingError(sql));
const superProbeError = (sql: string) => sqlErrorText(runLocalSuperuserSqlExpectingError(sql));

/*
 * =============================================================================
 * 텍스트 단언의 두 시야 (P6-11 · GPT 검증 P1-4)
 * =============================================================================
 * **이 파일의 텍스트 단언은 "그 문장이 파일에 쓰여 있다" 만 증명한다. 실제 권한을 재는 1차 방어선은
 * `tests/db-privilege-gate.test.ts`(카탈로그 실측)와 각 마이그레이션의 자기검증 블록(적용 중에 실행된다)이다.**
 * 아래 §5·§6·§9·§12·§15 의 DB 실증도 텍스트가 아니라 권한 상태·거동을 본다.
 *
 * 주석을 옳게 지워도 부분 문자열 검색은 **실행**을 증명하지 못한다 — 데이터 인용(`comment on … is $c$ revoke … $c$`,
 * `raise exception '… revoke …'` 의 hint)의 글자도 "문장" 으로 읽힌다. 그리고 극성에 따라 필요한 시야가 반대다:
 *
 *   · **문장 존재**("회수 문이 있다" · "0009 의 grant 가 남아 있다") → `sqlExec()` = `executable` 시야.
 *     데이터 인용의 내용은 공백 처리하고, `execute '…'` · `execute format('…', …)` 의 **첫 인자만** 실행될 SQL 로 남긴다
 *     (그 안의 주석도 지운다). 설명·힌트 문자열 속 문장이 존재를 거짓으로 만족시키지 못한다.
 *   · **문장 부재**("grant 가 없다" · "select 를 건드리지 않는다" · "drop function 이 없다") → `sqlCode()` = `keep` 시야.
 *     데이터를 **전부** 보인다 — 롤백이 실제로 쓰는 `execute 'grant …'` 같은 동적 SQL 을 놓치지 않기 위해서다.
 *     데이터 속 무해한 글자 때문에 **실패**하는 쪽으로만 틀린다(안전한 방향).
 *   · **정확한 집합**("회수 목록이 정확히 그것") → 두 시야로 나눠 본다: 기대 ⊆ 실행 시야 · 파일(keep) ⊆ 기대.
 *   · **자기검증 구성요소**(`has_table_privilege`·`'select'`·`to_regclass`·`42501` …) → `keep`.
 *     검사식의 인자가 문자열 리터럴이라(`has_function_privilege('service_role'`) executable 시야에서는 찾을 수 없다.
 *     이 단언들은 "검증 블록이 그 모양으로 쓰여 있다" 까지만 말하고, 검증이 **돌았다**는 증거는 마이그레이션 적용 자체다.
 *
 * **한계** — 변수를 거치는 동적 SQL(`v_sql := …; execute v_sql`)은 어느 시야도 추적하지 못한다. 존재 단언은 그런 문장을
 * 못 보고(실패 — 안전), 부재 단언은 조각 문자열이 보이는 만큼만 본다. 그 경로의 증거는 위의 1차 방어선이다.
 */
/** `keep` 시야 — 주석만 지운다. 부재 단언과 자기검증 구성요소 단언용. */
const sqlCode = (rel: string) => compact(stripComments(read(rel), rel));
/** `executable` 시야 — 실행되는 글자만. 문장 존재 단언용. */
const sqlExec = (rel: string) => compact(sqlView(read(rel), rel, { data: "executable" }));
const viewOf = (rel: string, data: SqlDataMode) => (data === "keep" ? sqlCode(rel) : sqlExec(rel));

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
function parsePrivStatements(rel: string, data: SqlDataMode): PrivStatement[] {
  return parsePrivText(viewOf(rel, data));
}

/** `parsePrivStatements` 의 본체 — 이미 시야를 고른 텍스트를 받는다(이빨 픽스처가 메모리 SQL 로 부른다). */
function parsePrivText(code: string): PrivStatement[] {
  const out: PrivStatement[] = [];
  // 종결자는 `;`(최상위 문장) 또는 `'`(do 블록 안의 execute 문자열) 둘 다.
  const re = /\b(revoke|grant)\s+([a-z, ]+?)\s+on\s+table\s+([a-z_, ]+?)\s+(?:from|to)\s+([a-z_, ]+?)\s*(?:;|')/g;
  for (const m of code.matchAll(re)) {
    const [raw, verb, privs, tables, roles] = m;
    const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
    for (const table of list(tables)) {
      out.push({ verb: verb as "revoke" | "grant", privs: list(privs), table, roles: list(roles), raw: raw.trim() });
    }
  }
  return out;
}

/**
 * 0018 (P5-14) 의 대상 — serial 기본값이 쓰는 **일곱 시퀀스**. `reservations` 는 uuid 라 시퀀스가 없다.
 * 콘텐츠 여섯은 관리자 insert 가 `nextval` 하므로 `authenticated` 의 **usage** 만 남긴다.
 */
const CONTENT_SEQS = CONTENT_TABLES.map((t) => `${t}_id_seq`);
const ALL_SEQS = [...CONTENT_SEQS, "notifications_log_id_seq"] as const;
const SEQ_PRIVS = ["usage", "select", "update"] as const;

/** 0018 이 회수하는 (롤|시퀀스|권한) 전체 — 헤더 "회수하는 것" 1~3 의 정확한 집합. */
function expected0018Revokes(): Set<string> {
  const set = new Set<string>();
  for (const seq of ALL_SEQS) {
    for (const priv of SEQ_PRIVS) set.add(`anon|${seq}|${priv}`);
    for (const priv of ["select", "update"]) set.add(`authenticated|${seq}|${priv}`);
  }
  set.add("authenticated|notifications_log_id_seq|usage");
  return set;
}

/**
 * `revoke a, b on sequence s1, s2 from r` / `grant … to …` 를 (동사·권한·시퀀스·롤) 로 쪼갠다 — `parsePrivStatements` 의 시퀀스 판.
 * 이름 목록에 `.` 이나 숫자가 섞이면 매치하지 않는다(대조군 임시 시퀀스 `public.p0018_probe_seq` 는 대상이 아니다).
 */
function parseSeqStatements(rel: string, data: SqlDataMode): PrivStatement[] {
  const out: PrivStatement[] = [];
  const re = /\b(revoke|grant)\s+([a-z, ]+?)\s+on\s+sequence\s+([a-z_, ]+?)\s+(?:from|to)\s+([a-z_, ]+?)\s*(?:;|')/g;
  for (const m of viewOf(rel, data).matchAll(re)) {
    const [raw, verb, privs, seqs, roles] = m;
    const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
    for (const table of list(seqs)) {
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

type Parse = (rel: string, data: SqlDataMode) => PrivStatement[];

/**
 * **정확한 집합** — 존재 쪽(기대 ⊆ 실행 시야)과 부재 쪽(파일 전체 ⊆ 기대)을 나눠 본다.
 * 실행 시야 ⊆ keep 시야이므로 둘 다 통과하면 두 시야의 집합이 기대와 같다.
 */
function expectExactTriples(rel: string, parse: Parse, verb: "revoke" | "grant", expected: Set<string>, what: string): void {
  const exec = triples(parse(rel, "executable"), verb);
  const keep = triples(parse(rel, "keep"), verb);
  const missing = [...expected].filter((t) => !exec.has(t)).sort();
  const extra = [...keep].filter((t) => !expected.has(t)).sort();
  expect(missing, `${what} — 실행되는 문장에 없다(주석·데이터 속 글자는 세지 않는다)`).toEqual([]);
  expect(extra, `${what} — 기대 밖의 ${verb} 가 파일에 있다(데이터 속 글자까지 본다 — 동적 SQL 을 놓치지 않기 위해)`).toEqual([]);
}

/**
 * **대칭** — 상행이 (실행으로) 회수한 것은 하행이 (실행으로) 되돌리고, 하행이 파일 어디에서든 부여하는 것은
 * 상행이 (실행으로) 회수한 것이어야 한다. 크기 비교는 옛 단언을 그대로 둔다.
 */
function expectSymmetric(upRel: string, downRel: string, parse: Parse, label: string): void {
  const revoked = triples(parse(upRel, "executable"), "revoke");
  const grantedExec = triples(parse(downRel, "executable"), "grant");
  const grantedKeep = triples(parse(downRel, "keep"), "grant");
  for (const t of revoked) expect(grantedExec.has(t), `${label} 이 회수한 ${t} 를 롤백이 되돌리지 않는다`).toBe(true);
  for (const t of grantedKeep) expect(revoked.has(t), `롤백이 ${label} 이 회수하지 않은 ${t} 를 부여한다 — 이전 상태보다 넓어진다`).toBe(true);
  expect(grantedKeep.size).toBe(revoked.size);
}

// =============================================================================
// 0. 텍스트 단언의 시야 — 이빨 픽스처 (P6-11 · GPT 검증 P1-4)
//
//    파일 머리의 "두 시야" 규칙이 실제로 판정을 가르는지, 메모리 SQL 로 확인한다.
//    각 픽스처는 **옛 시야(keep 하나로 존재·부재를 모두 보던 방식)에서의 판정**을 함께 단언한다 — 그것이 고치기 전의 거짓 통과다.
// =============================================================================
describe("0. 텍스트 단언의 시야 — 존재는 executable · 부재는 keep", () => {
  const REVOKE_PII = "revoke insert, update, delete, truncate on table notifications_log from anon, authenticated;";
  const view = (sql: string, data: SqlDataMode) => compact(sqlView(sql, "fixture.sql", { data }));
  const revokesNotifInsert = (code: string) => triples(parsePrivText(code), "revoke").has("anon|notifications_log|insert");
  const grantsNoticesToAnon = (code: string) => triples(parsePrivText(code), "grant").has("anon|notices|update");

  test("① `comment on … is $c$ -- revoke … $c$` 는 회수 문의 존재를 만족시키지 못한다 (옛 시야: 만족시켰다)", () => {
    const sql = ["comment on table notifications_log is $c$", `-- ${REVOKE_PII}`, "$c$;"].join("\n");
    expect(revokesNotifInsert(view(sql, "keep")), "옛 시야의 거짓 통과 재현").toBe(true);
    expect(revokesNotifInsert(view(sql, "executable")), "설명 문자열 속 revoke 가 존재로 세어진다").toBe(false);
  });

  test("② `execute format($q$ … -- revoke … $q$)` — 실행될 SQL 속 **주석** revoke 는 존재가 아니다 (옛 시야: 존재였다)", () => {
    const sql = ["do $$", "begin", "  execute format($q$", "    select 1;", `    -- ${REVOKE_PII}`, "  $q$);", "end;", "$$;"].join("\n");
    expect(revokesNotifInsert(view(sql, "keep")), "옛 시야의 거짓 통과 재현").toBe(true);
    expect(revokesNotifInsert(view(sql, "executable")), "동적 SQL 속 주석이 존재로 세어진다").toBe(false);
  });

  test("③ 대조군 — `execute '<revoke …>'` 는 실행되는 문장이므로 존재로 센다", () => {
    const sql = ["do $$", "begin", `  execute '${REVOKE_PII.replace(/;$/, "")}';`, "end $$;"].join("\n");
    expect(revokesNotifInsert(view(sql, "executable")), "실행되는 동적 revoke 를 못 본다 — 롤백 대칭 검사가 눈이 먼다").toBe(true);
  });

  test("④ `execute 'grant update … to anon'` — 부재 단언은 동적 GRANT 를 본다(keep)", () => {
    const sql = ["do $$", "begin", "  execute 'grant update on table notices to anon';", "end $$;"].join("\n");
    expect(grantsNoticesToAnon(view(sql, "keep")), "부재 단언이 동적 GRANT 를 놓친다").toBe(true);
    // 설명 문자열 속 grant 는 keep 에서도 보인다 — 부재 단언은 그 때문에 **실패**하는 쪽으로만 틀린다(안전)
    expect(grantsNoticesToAnon(view("select 1; comment on table t is 'grant update on table notices to anon';", "keep"))).toBe(true);
  });

  test("⑤ Codex P1-1 입력 — 이어붙인 E 문자열 뒤의 실제 GRANT 를 부재 단언이 본다 (스캐너 수정 전: 숨겨졌다)", () => {
    const sql = "select E'a'\n'\\' -- data'; grant update on table notices to anon;";
    expect(grantsNoticesToAnon(view(sql, "keep"))).toBe(true);
    expect(grantsNoticesToAnon(view(sql, "executable")), "실행되는 최상위 GRANT 는 어느 시야에서도 보여야 한다").toBe(true);
  });

  test("⑥ 조각 인자 — SQL 로 닫히지 않는 `execute` 인자는 존재 시야에서 숨긴다(실패 쪽) · throw 하지 않는다", () => {
    const sql = ["do $$", "begin", `  execute 'revoke insert on table notifications_log from anon where x = ''' || v || '''';`, "end $$;"].join("\n");
    expect(() => view(sql, "executable")).not.toThrow();
    expect(revokesNotifInsert(view(sql, "executable"))).toBe(false);
  });
});

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
    const revoked = triples(parsePrivStatements(UP_SQL, "executable"), "revoke");
    for (const role of ["anon", "authenticated"]) {
      for (const priv of WRITE_PRIVS) {
        expect(revoked.has(`${role}|notifications_log|${priv}`), `${role} 의 notifications_log ${priv} 가 남는다`).toBe(true);
      }
    }
  });

  test("reservations — insert·delete·truncate 는 양쪽에서, update 는 anon 에서 회수한다 (authenticated update 는 0010 이 이미 닫았다)", () => {
    const revoked = triples(parsePrivStatements(UP_SQL, "executable"), "revoke");
    for (const role of ["anon", "authenticated"]) {
      for (const priv of ["insert", "delete", "truncate"]) {
        expect(revoked.has(`${role}|reservations|${priv}`), `${role} 의 reservations ${priv} 가 남는다`).toBe(true);
      }
    }
    expect(revoked.has("anon|reservations|update"), "anon 의 reservations update 가 남으면 RLS 가 다시 유일한 방어선이다").toBe(true);
  });

  test("select 는 어디서도 회수하지 않는다 — 관리자 화면이 그것으로 읽는다(0009 정책)", () => {
    for (const s of parsePrivStatements(UP_SQL, "keep")) {
      expect(s.privs, `${s.raw} 가 select 를 건드린다`).not.toContain("select");
      expect(s.privs, `${s.raw} 가 all 로 뭉뚱그린다 — select 까지 사라진다`).not.toContain("all");
    }
    expect(sqlCode(UP_SQL)).not.toMatch(/revoke\s+all/);
  });

  test("콘텐츠 6표와 범위 밖 2표는 회수 대상이 아니다 — 회수하면 관리자 화면이 죽는다", () => {
    // 존재: 실행되는 권한 문장이 하나 이상 · 부재: 파일(데이터 포함)의 어느 문장도 범위 밖 표를 건드리지 않는다
    expect(parsePrivStatements(UP_SQL, "executable").length, "권한 문장이 하나도 없다").toBeGreaterThan(0);
    const stmts = parsePrivStatements(UP_SQL, "keep");
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
    expect(parsePrivStatements(UP_SQL, "keep").filter((s) => s.verb === "grant")).toEqual([]);
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
    expect(sqlExec(UP_SQL), "실행되는 revoke 가 없다").toMatch(/revoke /);
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
    const nine = sqlExec("supabase/migrations/0009_admin_rls.sql");
    expect(nine).toContain("grant select on table notifications_log to authenticated");
    expect(nine).toContain("grant select, update on table reservations to authenticated");
    const ten = sqlExec("supabase/migrations/0010_admin_reservation_actions.sql");
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
    expectSymmetric(UP_SQL, DOWN_SQL, parsePrivStatements, "0012");
    // 0012 는 authenticated 의 reservations update 를 회수하지 않았다(0010 소관). 따라서 롤백도 주면 안 된다 —
    // 주는 순간 리뷰 N5 가 지적한 "관리자가 retention_until·privacy_consent_at 을 고칠 수 있는" 상태로 돌아간다.
    // (부재 단언 — 파일 전체를 본다)
    const revokedKeep = triples(parsePrivStatements(UP_SQL, "keep"), "revoke");
    const grantedKeep = triples(parsePrivStatements(DOWN_SQL, "keep"), "grant");
    expect(revokedKeep.has("authenticated|reservations|update"), "0012 가 0010 의 회수를 중복 실행하면 롤백이 그것을 되살리게 된다").toBe(false);
    expect(grantedKeep.has("authenticated|reservations|update"), "롤백이 0010 이 닫은 문을 되살린다").toBe(false);
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
    const revoked = triples(parsePrivStatements(UP13_SQL, "executable"), "revoke");
    for (const table of ANON_REVOKE_TABLES) {
      for (const priv of WRITE_PRIVS) {
        expect(revoked.has(`anon|${table}|${priv}`), `anon 의 ${table} ${priv} 가 남는다`).toBe(true);
      }
    }
    // 개수는 파일 전체(keep)로 센다 — 데이터 속 문장까지 넣어도 그 이상이 없어야 한다
    const revokedKeep = triples(parsePrivStatements(UP13_SQL, "keep"), "revoke");
    expect(revokedKeep.size, `회수 삼중항이 ${ANON_REVOKE_TABLES.length} × ${WRITE_PRIVS.length} 가 아니다: ${[...revokedKeep].join(" ")}`).toBe(
      ANON_REVOKE_TABLES.length * WRITE_PRIVS.length,
    );
  });

  test("`authenticated` 는 한 칸도 건드리지 않는다 — 관리자 화면이 그 롤로 쓴다", () => {
    for (const s of parsePrivStatements(UP13_SQL, "keep")) {
      expect(s.roles, `${s.raw} 가 authenticated 를 건드린다 — 관리자 화면이 죽는다`).not.toContain("authenticated");
      expect(s.roles, `${s.raw} 가 service_role 을 건드린다`).not.toContain("service_role");
      expect(s.roles, `${s.raw} 가 public 롤을 건드린다 — 이 파일의 범위가 아니다`).not.toContain("public");
    }
  });

  test("select 는 회수하지 않는다 — 공개 사이트가 anon 키로 이 7표를 읽는다", () => {
    for (const s of parsePrivStatements(UP13_SQL, "keep")) {
      expect(s.privs, `${s.raw} 가 select 를 건드린다`).not.toContain("select");
      expect(s.privs, `${s.raw} 가 all 로 뭉뚱그린다`).not.toContain("all");
    }
    expect(sqlCode(UP13_SQL)).not.toMatch(/revoke\s+all/);
  });

  test("0012 가 이미 닫은 두 표와 admin_users 는 언급조차 하지 않는다", () => {
    const code = sqlCode(UP13_SQL);
    for (const t of OUT_OF_SCOPE_FOR_13) {
      // 헤더 주석에서는 설명하지만(주석은 helpers/strip-comments 가 걷어낸다) SQL 본문에는 나오면 안 된다.
      expect(code, `0013 의 SQL 본문이 ${t} 를 건드린다`).not.toContain(t);
    }
  });

  test("부여(grant)는 하나도 없고, 데이터·스키마를 바꾸지 않는다", () => {
    expect(parsePrivStatements(UP13_SQL, "keep").filter((s) => s.verb === "grant")).toEqual([]);
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
    const twelve = sqlExec(UP_SQL);
    expect(twelve).toContain("revoke insert, update, delete, truncate on table notifications_log from anon, authenticated");
    const nine = sqlExec("supabase/migrations/0009_admin_rls.sql");
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
    expectSymmetric(UP13_SQL, DOWN13_SQL, parsePrivStatements, "0013");
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
    // 아래 "0016 실행 증명" 이 ICN→SEL 시드 행의 sort 를 바꿨다 되돌린다 — 16행 전체를 대조하는 블록(places·queries)과 줄 세운다.
    // **순서 고정**: notifications → gallery → showcase-routes (tests/helpers/db-lock.ts SHOWCASE_ROUTES_LOCK 주석).
    withShowcaseRoutesLock();

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

    // 권한 거부 판정(401/403 + 42501)은 tests/helpers/expect-denied.ts 의 `expectPermissionDenied` 다 (P6-13 에서 이 자리에서 옮겼다 —
    // 판정 로직은 그대로다). 대조군은 아래 "거부와 부재는 구분된다" 테스트가 둔다.

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

    // -------------------------------------------------------------------------
    // 5-5. 0018 — **시퀀스를 회수한 뒤에도 관리자가 새 행을 만든다** (행렬이 아니라 201 로).
    //
    //      insert 권한은 표에 있지만 serial 기본값의 `nextval` 은 **시퀀스 권한**으로 검사된다.
    //      0018 이 콘텐츠 여섯의 `authenticated` usage 까지 가져갔다면 표 권한은 멀쩡한데 저장만 42501 로 실패한다 —
    //      원인이 잘 보이지 않는 고장이다. 네 표에 실제로 넣어 **새 id 가 발급되는지** 본다.
    // -------------------------------------------------------------------------
    test("0018 실행 증명 — 관리자 세션이 공지·팝업·앨범·사진에 새 행을 만든다 (201 · nextval 이 새 id 를 준다)", async () => {
      const made: { table: string; id: number }[] = [];
      try {
        const cases: [string, Record<string, unknown>][] = [
          ["notices", { title: `P514-${RUN}`, body: "P5-14", active: false }],
          ["popups", { title: `P514-${RUN}`, body: "P5-14", starts_at: "2000-01-01", ends_at: "2000-01-02", active: false }],
          ["gallery_albums", { slug: `p514-${RUN}`, title: `P5-14 ${RUN}`, sort: 910014, active: false }],
        ];
        for (const [table, row] of cases) {
          const r = await asUser(adminToken, "POST", `/${table}`, row, "return=representation");
          expect(r.status, `관리자 화면이 새 글을 못 쓴다 — ${table} insert: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(201);
          const id = (r.body as { id: number }[])[0].id;
          expect(Number.isInteger(id) && id > 0, `${table} 의 새 id 가 시퀀스에서 오지 않았다: ${id}`).toBe(true);
          made.push({ table, id });
        }
        const albumId = made.find((m) => m.table === "gallery_albums")!.id;
        const g = await asUser(
          adminToken,
          "POST",
          "/gallery",
          { image_path: `p514/${RUN}.webp`, original_path: `p514/${RUN}.orig`, sort: 910014, active: false, album_id: albumId },
          "return=representation",
        );
        expect(g.status, `관리자 화면이 새 사진을 못 올린다 — gallery insert: ${JSON.stringify(g.body).slice(0, 300)}`).toBe(201);
        const photoId = (g.body as { id: number }[])[0].id;
        expect(Number.isInteger(photoId) && photoId > 0).toBe(true);
        made.unshift({ table: "gallery", id: photoId }); // 사진을 앨범보다 먼저 지운다
      } finally {
        for (const m of made) {
          const del = await asUser(adminToken, "DELETE", `/${m.table}?id=eq.${m.id}`);
          expect(del.status, `${m.table} 정리: ${JSON.stringify(del.body).slice(0, 300)}`).toBeLessThan(300);
        }
      }
    });

    test("0018 실행 증명 — 서비스 롤의 공개 접수 → 통지 적재가 그대로 201 이다 (notifications_log 의 nextval)", async () => {
      const id = await seedReservation(`D${RUN.slice(0, 4).toUpperCase()}`);
      madeReservations.push(id);
      const before = await rest("GET", "/notifications_log?select=id&order=id.desc&limit=1");
      const maxBefore = ((before.body as { id: number }[])[0]?.id ?? 0) as number;
      const enq = await rest(
        "POST",
        "/notifications_log",
        { reservation_id: id, event: "created", channel: "sms", to_phone: "+821000000014", template: "created.customer.sms", status: "pending", next_attempt_at: OUT_OF_CLAIM_WINDOW },
        "return=representation",
      );
      expect(enq.status, `통지 적재가 막혔다 — 접수는 되는데 문자가 한 통도 안 나간다: ${JSON.stringify(enq.body).slice(0, 300)}`).toBe(201);
      const newId = (enq.body as { id: number }[])[0].id;
      expect(newId, "새 통지 id 가 기존 최대값보다 크지 않다 — 시퀀스가 되감겼나").toBeGreaterThan(maxBefore);
    });

    test("0018 — 공개 롤에는 setval·nextval 을 부를 REST 경로 자체가 없다 (404 PGRST202)", async () => {
      // 권한 회수와 별개로, 오늘의 도달 경로가 없음을 매번 확인한다(P6-11 실측의 고정). 이것이 바뀌면 0018 이 유일한 방어선이다.
      for (const fn of ["setval", "nextval"]) {
        const anon = await asAnon("POST", `/rpc/${fn}`, { regclass: "notifications_log_id_seq" });
        expect(anon.status, `anon 의 /rpc/${fn}: ${JSON.stringify(anon.body).slice(0, 200)}`).toBe(404);
        expect((anon.body as { code?: string } | null)?.code).toBe("PGRST202");
        const user = await asUser(adminToken, "POST", `/rpc/${fn}`, { regclass: "notifications_log_id_seq" });
        expect(user.status, `관리자 세션의 /rpc/${fn}: ${JSON.stringify(user.body).slice(0, 200)}`).toBe(404);
      }
    });

    // -------------------------------------------------------------------------
    // 5-6. 0019 (P5-15) — **MAINTAIN 을 회수한 뒤에도 관리자·접수·파기가 돈다** (행렬이 아니라 실행으로).
    //
    //      관리자 화면은 MAINTAIN 을 쓰지 않는다는 판단을 **실제 호출**로 확인한다. 접수 뒤 통지 적재와 파기는
    //      테스트용 REST 흉내가 아니라 **앱의 실제 코드**(lib/notify/outbox.ts `enqueue` · lib/retention/purge.ts
    //      `supabasePurgeClient`)를 서비스 롤 클라이언트로 부른다. 파기는 전역 `purge()` 가 아니라 어댑터의 두 메서드를
    //      내 행에만 쓴다 — 전역 파기는 병렬로 도는 다른 파일의 만료 행까지 지운다(tests/purge.test.ts 가 그 실증을 따로 한다).
    //      전제: 이 블록이 도는 DB 에서 공개 롤의 MAINTAIN 이 **실제로 회수돼 있다**(PG17+) — 먼저 확인하고 시작한다.
    // -------------------------------------------------------------------------
    test("0019 실행 증명 — MAINTAIN 회수 뒤 관리자 CRUD(공지·팝업·앨범·사진·노선) 2xx · 접수 → enqueue → 파기 어댑터", async () => {
      const pre = runLocalSql(
        [
          "select 'P515_PRE ' || current_setting('server_version_num') || ' ' ||",
          "  case when current_setting('server_version_num')::int < 170000 then 'PRE17'",
          "       when exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace",
          "                     cross join (values ('anon'), ('authenticated')) r(role)",
          "                    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')",
          "                      and has_table_privilege(r.role, c.oid, 'MAINTAIN')) then 'MAINTAIN_LEFT'",
          "       else 'MAINTAIN_REVOKED' end as pre;",
        ].join("\n"),
      );
      expect(pre, `0019 가 적용되지 않은 DB 에서 "0019 뒤에도 돈다" 를 증명할 수 없다: ${pre}`).toMatch(/P515_PRE \d+ (MAINTAIN_REVOKED|PRE17)/);

      const made: { table: string; id: number }[] = [];
      try {
        // ① 관리자 CRUD — insert·update·delete 를 공지·팝업·앨범·사진에서 전부 2xx 로
        for (const [table, row, patch] of [
          ["notices", { title: `P515-${RUN}`, body: "P5-15", active: false }, { title: `P515-${RUN}-edit` }],
          ["popups", { title: `P515-${RUN}`, body: "P5-15", starts_at: "2000-01-01", ends_at: "2000-01-02", active: false }, { body: "P5-15 edit" }],
          ["gallery_albums", { slug: `p515-${RUN}`, title: `P5-15 ${RUN}`, sort: 910015, active: false }, { title: `P5-15 ${RUN} edit` }],
        ] as const) {
          const ins = await asUser(adminToken, "POST", `/${table}`, row, "return=representation");
          expect(ins.status, `0019 뒤 관리자 ${table} insert: ${JSON.stringify(ins.body).slice(0, 300)}`).toBe(201);
          const id = (ins.body as { id: number }[])[0].id;
          made.push({ table, id });
          const upd = await asUser(adminToken, "PATCH", `/${table}?id=eq.${id}`, patch, "return=representation");
          expect(upd.status, `0019 뒤 관리자 ${table} update: ${JSON.stringify(upd.body).slice(0, 300)}`).toBe(200);
          expect((upd.body as unknown[]).length, `${table} update 가 0행을 고쳤다`).toBe(1);
        }
        const albumId = made.find((m) => m.table === "gallery_albums")!.id;
        const g = await asUser(
          adminToken,
          "POST",
          "/gallery",
          { image_path: `p515/${RUN}.webp`, original_path: `p515/${RUN}.orig`, sort: 910015, active: false, album_id: albumId },
          "return=representation",
        );
        expect(g.status, `0019 뒤 관리자 gallery insert: ${JSON.stringify(g.body).slice(0, 300)}`).toBe(201);
        const photoId = (g.body as { id: number }[])[0].id;
        made.unshift({ table: "gallery", id: photoId });
        const gUpd = await asUser(adminToken, "PATCH", `/gallery?id=eq.${photoId}`, { caption: "P5-15" }, "return=representation");
        expect(gUpd.status, `0019 뒤 관리자 gallery update: ${JSON.stringify(gUpd.body).slice(0, 300)}`).toBe(200);
        // astra R2 P2-D — 200 만으로는 RLS 가 걸러 낸 `[]`(0행 갱신)도 통과한다. 바뀐 행 1개와 caption 을 본다.
        const gRows = gUpd.body as { id: number; caption: string | null }[];
        expect(gRows.length, `gallery update 가 ${gRows.length}행을 고쳤다(RLS 가 걸렀나): ${JSON.stringify(gUpd.body).slice(0, 300)}`).toBe(1);
        expect(gRows[0].id).toBe(photoId);
        expect(gRows[0].caption, "gallery update 가 caption 을 바꾸지 않았다").toBe("P5-15");

        // 노선 — 행 수를 바꾸지 않는다(§5-4 의 사유). 실제 관리 화면과 같은 update 를 치고 되돌린다.
        const before = await rest("GET", "/showcase_routes?select=id,sort&origin_code=eq.ICN&destination_code=eq.SEL");
        const route = (before.body as { id: number; sort: number | null }[])[0];
        expect(route, "노선 시드 행이 없다").toBeDefined();
        const rUpd = await asUser(adminToken, "PATCH", `/showcase_routes?id=eq.${route.id}`, { sort: 910015 }, "return=representation");
        expect(rUpd.status, `0019 뒤 관리자 showcase_routes update: ${JSON.stringify(rUpd.body).slice(0, 300)}`).toBe(200);
        const rBack = await asUser(adminToken, "PATCH", `/showcase_routes?id=eq.${route.id}`, { sort: route.sort }, "return=representation");
        expect(rBack.status).toBe(200);
        expect((rBack.body as { sort: number | null }[])[0].sort, "노선 sort 를 되돌리지 못했다").toBe(route.sort);
      } finally {
        for (const m of made) {
          const del = await asUser(adminToken, "DELETE", `/${m.table}?id=eq.${m.id}`, undefined, "return=representation");
          expect(del.status, `0019 뒤 관리자 ${m.table} delete: ${JSON.stringify(del.body).slice(0, 300)}`).toBe(200);
          expect((del.body as unknown[]).length, `${m.table} delete 가 0행을 지웠다`).toBe(1);
        }
      }

      // ② 공개 접수 → 통지 적재 — 앱의 실제 enqueue 로
      const { createClient } = await import("@supabase/supabase-js");
      const { enqueue } = await import("@/lib/notify/outbox");
      const { supabasePurgeClient } = await import("@/lib/retention/purge");
      const service = createClient(baseUrl(), dbEnv.serviceRoleKey, { auth: { persistSession: false } });
      const rid = await seedReservation(`E${RUN.slice(0, 4).toUpperCase()}`);
      madeReservations.push(rid);
      const ids = await enqueue(
        [{ reservation_id: rid, event: "created", channel: "sms", to: "+821000000015", template: "created.customer.sms" }],
        service,
      );
      // 방금 넣은 pending 행을 claim 창 밖으로 — 이 블록은 아웃박스 잠금 안이지만 잠금이 풀린 뒤에도 남지 않게 아래에서 지운다
      await pushOutOfClaimWindow(rid);
      expect(ids.length, "0019 뒤 접수 통지가 적재되지 않았다").toBe(1);
      expect(Number.isInteger(ids[0]) && ids[0] > 0).toBe(true);

      // ③ 파기 크론 경로 — 실제 어댑터: 만료 조회(읽기) + 내 행 삭제(통지 먼저, 예약 다음)
      const purgeClient = supabasePurgeClient(service);
      const scanned = await purgeClient.selectExpired(new Date().toISOString(), 1);
      expect(Array.isArray(scanned), "파기 조회가 배열을 돌려주지 않았다").toBe(true);
      const deleted = await purgeClient.deleteReservations([rid]);
      expect(deleted, "0019 뒤 파기 어댑터가 예약을 지우지 못했다").toBe(1);
      const logsLeft = await rest("GET", `/notifications_log?select=id&reservation_id=eq.${rid}`);
      expect(logsLeft.body, "파기가 통지 로그를 남겼다").toEqual([]);
      const resLeft = await rest("GET", `/reservations?select=id&id=eq.${rid}`);
      expect(resLeft.body, "파기가 예약을 남겼다").toEqual([]);
      madeReservations.splice(madeReservations.indexOf(rid), 1);
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
    const revoked = triples(parsePrivStatements(UP16_SQL, "executable"), "revoke");
    for (const table of ANON_REVOKE_TABLES) {
      for (const priv of RLS_BLIND_PRIVS) {
        expect(revoked.has(`authenticated|${table}|${priv}`), `authenticated 의 ${table} ${priv} 가 남는다`).toBe(true);
      }
    }
  });

  test("같은 일곱 표 × anon 에서 trigger·references 를 회수한다 — 0013 은 네 동작만 가져갔다", () => {
    const revoked = triples(parsePrivStatements(UP16_SQL, "executable"), "revoke");
    const revokedKeep = triples(parsePrivStatements(UP16_SQL, "keep"), "revoke");
    for (const table of ANON_REVOKE_TABLES) {
      for (const priv of ANON_RLS_BLIND_PRIVS) {
        expect(revoked.has(`anon|${table}|${priv}`), `anon 의 ${table} ${priv} 가 남는다`).toBe(true);
      }
    }
    // anon 의 TRUNCATE 는 0013 소관이다. 여기서 다시 회수하면 **롤백이** 0013 이 닫은 문을 되살리게 된다
    // (0012 §2 가 reservations update 에서 같은 이유로 피한 함정).
    for (const table of ANON_REVOKE_TABLES) {
      expect(revokedKeep.has(`anon|${table}|truncate`), `0016 이 0013 의 회수를 중복 실행한다 — 롤백이 그것을 되살린다`).toBe(false);
    }
  });

  test("`places` 에서만 authenticated 의 insert·update·delete 를 추가로 회수한다 (select 는 남긴다)", () => {
    const revoked = triples(parsePrivStatements(UP16_SQL, "executable"), "revoke");
    const revokedKeep = triples(parsePrivStatements(UP16_SQL, "keep"), "revoke");
    for (const priv of PLACES_WRITE_PRIVS) {
      expect(revoked.has(`authenticated|places|${priv}`), `places 의 ${priv} 가 남는다 — 관리자 쓰기 정책도 코드 경로도 없다`).toBe(true);
    }
    for (const table of CONTENT_TABLES) {
      for (const priv of PLACES_WRITE_PRIVS) {
        expect(revokedKeep.has(`authenticated|${table}|${priv}`), `${table} 의 ${priv} 를 회수한다 — 관리자 화면이 죽는다`).toBe(false);
      }
      expect(revokedKeep.has(`authenticated|${table}|select`), `${table} 의 select 를 회수한다`).toBe(false);
    }
  });

  test("회수 목록이 정확히 그 셋이다 — 더도 덜도 아니다", () => {
    const expected = new Set<string>();
    for (const table of ANON_REVOKE_TABLES) {
      for (const priv of RLS_BLIND_PRIVS) expected.add(`authenticated|${table}|${priv}`);
      for (const priv of ANON_RLS_BLIND_PRIVS) expected.add(`anon|${table}|${priv}`);
    }
    for (const priv of PLACES_WRITE_PRIVS) expected.add(`authenticated|places|${priv}`);
    expectExactTriples(UP16_SQL, parsePrivStatements, "revoke", expected, "0016 회수 삼중항");
  });

  test("select 는 어디서도 회수하지 않고 `all` 로 뭉뚱그리지 않는다 · service_role 도 건드리지 않는다", () => {
    for (const s of parsePrivStatements(UP16_SQL, "keep")) {
      expect(s.privs, `${s.raw} 가 select 를 건드린다`).not.toContain("select");
      expect(s.privs, `${s.raw} 가 all 로 뭉뚱그린다`).not.toContain("all");
      expect(s.roles, `${s.raw} 가 service_role 을 건드린다 — 접수·enqueue·발송기·파기가 그것으로 돈다`).not.toContain("service_role");
      expect(s.roles, `${s.raw} 가 public 롤을 건드린다 — 이 파일의 범위가 아니다`).not.toContain("public");
    }
    expect(sqlCode(UP16_SQL)).not.toMatch(/revoke\s+all\s+on\s+table/);
  });

  test("부여(grant)는 하나도 없다 — 이 마이그레이션은 닫기만 한다", () => {
    expect(parsePrivStatements(UP16_SQL, "keep").filter((s) => s.verb === "grant")).toEqual([]);
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
    // 정확한 집합 — 실행 시야(존재)와 파일 전체(부재) 둘 다 기대와 같아야 한다
    for (const view of [code, sqlExec(UP16_SQL)]) {
      const created = [...view.matchAll(/create or replace function ([a-z_]+)\s*\(/g)].map((m) => m[1]);
      expect(created.sort(), "고치는 함수 목록이 다르다").toEqual([...PG_TEMP_FIXED_FNS].sort());
    }
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
    for (const view of [code, sqlExec(UP16_SQL)]) {
      expect(
        [...view.matchAll(/security definer set search_path = public, pg_temp as \$\$/g)].length,
        "세 함수 전부에 pg_temp 가 붙지 않았다",
      ).toBe(PG_TEMP_FIXED_FNS.length);
    }
    expect(code, "pg_temp 없는 옛 형태가 남아 있다").not.toMatch(/set search_path = public as \$\$/);
    // 본문 로직은 0005·0007 원문 그대로여야 한다 — 상태 전이의 핵심 조건을 그대로 담고 있는지 본다.
    // (조건에 문자열 리터럴이 들어 있어 keep 시야로 본다 — 파일 머리의 "자기검증 구성요소" 와 같은 이유)
    expect(code, "mark_notification_sent 의 where 조건이 바뀌었다").toContain("where id = p_id and status = 'pending'");
    expect(code, "reap 의 대상 조건이 바뀌었다").toContain("where status = 'pending' and attempts >= 5 and next_attempt_at <= now()");
    expect(code, "mark_notification_failed 의 백오프 계산이 바뀌었다").toContain("make_interval(secs => greatest(coalesce(p_retry_after_ms, 0), 0) / 1000.0)");
    for (const fn of PG_TEMP_FIXED_FNS) {
      expect(sqlExec(UP16_SQL), `${fn} 이 security definer 가 아니다`).toMatch(new RegExp(`${fn}\\s*\\([^)]*\\)[\\s\\S]{0,160}security definer`));
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
    expect(sqlExec(UP16_SQL), "실행되는 revoke 가 없다").toMatch(/revoke /);
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
    const five = sqlExec("supabase/migrations/0005_outbox.sql");
    expect(five, "0005 의 EXECUTE 회수가 사라졌다").toContain("revoke all on function mark_notification_sent(bigint, text) from public, anon, authenticated");
    const seven = sqlExec("supabase/migrations/0007_outbox_reaper.sql");
    expect(seven, "0007 의 service_role grant 가 사라졌다").toContain("grant execute on function reap_stale_notifications() to service_role");
    const fourteen = sqlExec("supabase/migrations/0014_claim_by_channel.sql");
    expect(fourteen, "0014 의 1-인자 drop 이 사라졌다").toContain("drop function if exists claim_pending_notifications(int)");
    const nine = sqlExec("supabase/migrations/0009_admin_rls.sql");
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
    expectSymmetric(UP16_SQL, DOWN16_SQL, parsePrivStatements, "0016");
  });

  test("`search_path` 를 옛 형태로 되돌린다 — 되돌리지 않으면 0016 재적용에서 검사가 눈이 먼다", () => {
    const code = sqlCode(DOWN16_SQL);
    expect(code, "롤백이 pg_temp 를 그대로 남긴다").not.toMatch(/security definer set search_path = public, pg_temp as \$\$/);
    for (const view of [code, sqlExec(DOWN16_SQL)]) {
      expect(
        [...view.matchAll(/security definer set search_path = public as \$\$/g)].length,
        "세 함수 전부를 옛 형태로 되돌리지 않았다",
      ).toBe(PG_TEMP_FIXED_FNS.length);
    }
  });

  test("`drop function` 을 쓰지 않는다 — 롤백이 상행보다 넓은 문을 열면 안 된다", () => {
    const code = sqlCode(DOWN16_SQL);
    // 문장 머리에서만 찾는다 — 롤백의 hint 문자열이 "drop function 이 섞였는지 확인할 것" 을 설명한다(위 §7 과 같은 이유).
    expect(code, "drop function 문장이 있다 — ACL 이 초기화돼 기본 권한이 공개 롤에 EXECUTE 를 다시 부여한다").not.toMatch(/(?:^|;)\s*drop\s+function\b/);
    for (const view of [code, sqlExec(DOWN16_SQL)]) {
      const created = [...view.matchAll(/create or replace function ([a-z_]+)\s*\(/g)].map((m) => m[1]);
      expect(created.sort()).toEqual([...PG_TEMP_FIXED_FNS].sort());
    }
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

  beforeAll(() => {
    // P5-15 R5 — 원격에 붙이는 행렬 원문(runbook 0016 절 표식 사이)을 **그대로** 실행한다. 사본을 두지 않는다(§19 가 잠근다).
    // 항목: ① authenticated 의 truncate·trigger·references(컬럼 references 포함) ② anon 은 select 만 ③ places 쓰기 0·읽기 생존
    //       ④ 함수 셋 존재·pg_temp·EXECUTE 보유자(NULL ACL = PUBLIC EXECUTE)·공개 롤 유효 EXECUTE 0·service_role 실행 가능
    //       ⑤ 1-인자 claim 없음 ⑥ 콘텐츠 6표 CRUD·시퀀스 usage 생존
    verdict = runLocalSql(runbookSql("0016"));
  }, 300_000);

  test("authenticated 에게 TRUNCATE·TRIGGER·REFERENCES 가 하나도 없다 — RLS 가 막지 못하던 것들이다", () => {
    expect(verdict, verdict).toContain("RLS_BLIND_NONE");
  });

  test("anon 은 일곱 표에서 select 만 갖는다 (0013 이 네 동작 · 0016 이 trigger·references)", () => {
    expect(verdict, verdict).toContain("ANON_SELECT_ONLY");
    expect(verdict, verdict).toContain("ANON_SELECT_OK");
  });

  test("places — 쓰기 셋은 사라지고 두 롤의 읽기는 살아 있다", () => {
    expect(verdict, verdict).toContain("PLACES_WRITE_NONE");
    expect(verdict, verdict).toContain("PLACES_READ_OK");
  });

  test("definer 함수 셋에 pg_temp 가 붙었고 EXECUTE 보유자는 그대로다 — create or replace 가 ACL 을 보존했다", () => {
    expect(verdict, verdict).toContain("FN_ALL_PRESENT");
    expect(verdict, verdict).toContain("PG_TEMP_OK");
    expect(verdict, verdict).toContain("FN_EXEC_ONLY_SERVICE");
    expect(verdict, verdict).toContain("FN_NO_PUBLIC_ROLE_EXEC");
    expect(verdict, verdict).toContain("FN_SERVICE_OK");
  });

  test("🔴 R5 — 행렬은 NULL proacl(기본 PUBLIC EXECUTE)과 사라진 함수를 실패 라벨로 보고한다 (슈퍼유저 · 되돌림)", () => {
    const matrix = runbookSql("0016").replace(/;\s*$/, "");
    const out = superProbeError(
      [
        "do $p515n$",
        "declare payload text;",
        "begin",
        "  update pg_catalog.pg_proc set proacl = null where oid = 'public.reap_stale_notifications()'::regprocedure;",
        "  alter function public.mark_notification_failed(bigint, text, boolean, bigint) rename to p515_renamed_mark_failed;",
        `  select row_to_json(m)::text into payload from (${matrix}) m;`,
        "  raise exception 'P515N %', payload;",
        "end",
        "$p515n$;",
      ].join("\n"),
    );
    expect(out, out).toMatch(/FN_MISSING public\.mark_notification_failed\(bigint, text, boolean, bigint\)/);
    expect(out, out).toMatch(/FN_EXEC_EXTRA [^"\\]*reap_stale_notifications\/PUBLIC/);
    expect(out, out).toMatch(/FN_PUBLIC_ROLE_EXEC [^"\\]*reap_stale_notifications\(\)\/anon/);
    const after = sqlValue(
      "select 'P515B ' || coalesce((select proacl::text from pg_proc where oid = to_regprocedure('public.reap_stale_notifications()')), 'NULL') || ' ' || (to_regprocedure('public.mark_notification_failed(bigint, text, boolean, bigint)') is not null)::text as a;",
    );
    expect(after, after).toMatch(/P515B \{[^}]*service_role=X[^}]*\} true/);
  }, 300_000);

  test("🔴 R6 P2-2·P2-3 — 행렬은 사라진 anon SELECT · 컬럼 단위 쓰기 · search_path 밖의 pg_temp 를 실패 라벨로 보고한다 (되돌림)", () => {
    const matrix = runbookSql("0016").replace(/;\s*$/, "");
    const out = probeError(
      [
        "do $p515r6$",
        "declare payload text;",
        "begin",
        // P2-2 ① 콘텐츠 표의 anon SELECT 가 사라짐 — 공개 사이트가 빈다
        "  revoke select on table public.notices from anon;",
        // P2-2 ② 컬럼 단위 쓰기 — 표 단위 has_table_privilege 는 이것을 못 본다
        "  grant update (sort) on table public.places to authenticated;",
        "  grant insert (name_ko) on table public.vehicles to anon;",
        "  grant references (caption) on table public.gallery to anon;",
        // P2-3 ① search_path 에는 없고 다른 설정 값에만 pg_temp — 옛 판정(`like '%pg_temp%'`)은 통과시켰다
        "  alter function public.reap_stale_notifications() set search_path = public;",
        "  alter function public.reap_stale_notifications() set application_name = 'pg_temp';",
        // P2-3 ② 따옴표 식별자 안의 낱말 — pg_temp 스키마가 아니다
        `  alter function public.mark_notification_sent(bigint, text) set search_path = public, "x pg_temp";`,
        `  select row_to_json(m)::text into payload from (${matrix}) m;`,
        "  raise exception 'P515R6 %', payload;",
        "end",
        "$p515r6$;",
      ].join("\n"),
    );
    expect(out, out).toContain("P515R6");
    expect(out, out).toMatch(/ANON_SELECT_LOST [^"\\]*public\.notices/);
    expect(out, out).toMatch(/PLACES_WRITE_LEAK [^"\\]*update/);
    expect(out, out).toMatch(/ANON_EXTRA [^"\\]*public\.vehicles\/insert/);
    expect(out, out).toMatch(/ANON_EXTRA [^"\\]*public\.gallery\/references/);
    expect(out, out).toMatch(/PG_TEMP_MISSING [^"\\]*reap_stale_notifications/);
    expect(out, out).toMatch(/PG_TEMP_MISSING [^"\\]*mark_notification_sent/);
    expect(out, out).not.toMatch(/PG_TEMP_MISSING [^"\\]*mark_notification_failed/);
    // 되돌려졌다 — 실제 객체는 그대로
    const after = sqlValue(
      [
        "select 'P515R6B '",
        "  || has_table_privilege('anon', 'public.notices', 'select')::text || ' '",
        "  || has_any_column_privilege('authenticated', 'public.places', 'update')::text || ' '",
        "  || has_any_column_privilege('anon', 'public.vehicles', 'insert')::text || ' '",
        "  || array_to_string((select proconfig from pg_proc where oid = 'public.reap_stale_notifications()'::regprocedure), ';') as a;",
      ].join("\n"),
    );
    expect(after, after).toContain("P515R6B true false false search_path=public, pg_temp");
  }, 300_000);

  test("R6 — 정상 상태의 search_path 표기 변형도 pg_temp 로 읽는다 (대문자 비인용 · 따옴표 · 공백) (되돌림)", () => {
    const matrix = runbookSql("0016").replace(/;\s*$/, "");
    const out = probeError(
      [
        "do $p515r6ok$",
        "declare payload text;",
        "begin",
        `  alter function public.reap_stale_notifications() set search_path = "$user", public, PG_TEMP;`,
        `  alter function public.mark_notification_sent(bigint, text) set search_path = "public", "pg_temp";`,
        `  alter function public.mark_notification_failed(bigint, text, boolean, bigint) set search_path = "a,b", pg_temp;`,
        `  select m.pg_temp || ' | ' || (select string_agg(array_to_string(proconfig, ';'), ' / ') from pg_proc where proname in ('reap_stale_notifications', 'mark_notification_sent', 'mark_notification_failed')) into payload from (${matrix}) m;`,
        "  raise exception 'P515R6OK %', payload;",
        "end",
        "$p515r6ok$;",
      ].join("\n"),
    );
    expect(out, out).toMatch(/P515R6OK PG_TEMP_OK \|/);
  }, 300_000);

  test("🔴 R7 P2-a — 행렬의 search_path 분리는 PostgreSQL 공백 집합(\\t 등 · \\v 는 17 이상)을 쓴다 (SET FROM CURRENT · 되돌림)", () => {
    const matrix = runbookSql("0016").replace(/;\s*$/, "");
    const out = probeError(
      [
        "do $p515r7$",
        "declare payload text; saved text := current_setting('search_path'); v17 boolean := current_setting('server_version_num')::int >= 170000;",
        "begin",
        // ① 탭 — 유효한 search_path(PG 가 pg_temp 로 읽는다)
        "  perform set_config('search_path', 'public,' || chr(9) || 'pg_temp', true);",
        "  alter function public.reap_stale_notifications() set search_path from current;",
        // ② 세로 탭 — 17 이상에서만 공백
        "  perform set_config('search_path', 'public,' || chr(11) || 'pg_temp', true);",
        "  alter function public.mark_notification_sent(bigint, text) set search_path from current;",
        // ③ 대조군 — 따옴표 안의 탭은 이름의 일부 → pg_temp 아님
        "  perform set_config('search_path', 'public, \"' || chr(9) || 'pg_temp\"', true);",
        "  alter function public.mark_notification_failed(bigint, text, boolean, bigint) set search_path from current;",
        "  perform set_config('search_path', saved, true);",
        `  select row_to_json(m)::text into payload from (${matrix}) m;`,
        "  raise exception 'P515R7 v17=% cfg=% %', v17,",
        "    (select string_agg(replace(replace(array_to_string(proconfig, ';'), chr(9), '<TAB>'), chr(11), '<VT>'), ' / ' order by proname) from pg_proc",
        "      where proname in ('reap_stale_notifications', 'mark_notification_sent', 'mark_notification_failed')), payload;",
        "end",
        "$p515r7$;",
      ].join("\n"),
    );
    expect(out, out).toContain("P515R7 v17=t ");
    expect(out, out).toContain("search_path=public,<TAB>pg_temp");
    expect(out, out).toContain("search_path=public,<VT>pg_temp");
    expect(out, out).not.toMatch(/PG_TEMP_MISSING [^"\\]*reap_stale_notifications/);
    expect(out, out).not.toMatch(/PG_TEMP_MISSING [^"\\]*mark_notification_sent/);
    expect(out, out).toMatch(/PG_TEMP_MISSING [^"\\]*mark_notification_failed/);
    const after = sqlValue("select 'P515R7B ' || array_to_string((select proconfig from pg_proc where oid = 'public.reap_stale_notifications()'::regprocedure), ';') as a;");
    expect(after, after).toContain("P515R7B search_path=public, pg_temp");
  }, 300_000);

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
    const revoked = triples(parsePrivStatements(UP17_SQL, "executable"), "revoke");
    for (const table of PII_TABLES) {
      for (const role of ["anon", "authenticated"]) {
        for (const priv of PII_RLS_BLIND_PRIVS) {
          expect(revoked.has(`${role}|${table}|${priv}`), `${role} 의 ${table} ${priv} 가 남는다`).toBe(true);
        }
      }
    }
  });

  test("`anon` 의 select 는 회수하고 `authenticated` 의 select 는 남긴다 — 관리자 화면이 두 표를 읽는다", () => {
    const revoked = triples(parsePrivStatements(UP17_SQL, "executable"), "revoke");
    const revokedKeep = triples(parsePrivStatements(UP17_SQL, "keep"), "revoke");
    for (const table of PII_TABLES) {
      for (const priv of PII_ANON_ONLY_PRIVS) {
        expect(revoked.has(`anon|${table}|${priv}`), `anon 의 ${table} ${priv} 가 남는다 — 공개 롤은 이 표를 읽을 이유가 없다`).toBe(true);
        expect(
          revokedKeep.has(`authenticated|${table}|${priv}`),
          `authenticated 의 ${table} ${priv} 를 회수한다 — 관리자 예약 목록·발송 내역이 통째로 빈다`,
        ).toBe(false);
      }
    }
    // `all` 로 뭉뚱그리면 authenticated 의 select 까지 사라진다.
    // 예외는 ⑦ 의 일회용 표 하나뿐이다(P5-15 astra R3 — 기본 권한을 전부 걷고 TRIGGER 만 준다. 서브트랜잭션째 되돌린다).
    expect(sqlCode(UP17_SQL)).not.toMatch(/revoke\s+all\s+on\s+table\s+(?!public\.p0017_probe_tbl\s)/);
  });

  test("쓰기 네 동작은 다시 회수하지 않는다 — 0010·0012 소관이고, 중복하면 롤백이 그 문을 되살린다", () => {
    const revoked = triples(parsePrivStatements(UP17_SQL, "keep"), "revoke");
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
    const expected = new Set<string>();
    for (const table of PII_TABLES) {
      for (const role of ["anon", "authenticated"]) for (const priv of PII_RLS_BLIND_PRIVS) expected.add(`${role}|${table}|${priv}`);
      for (const priv of PII_ANON_ONLY_PRIVS) expected.add(`anon|${table}|${priv}`);
    }
    expectExactTriples(UP17_SQL, parsePrivStatements, "revoke", expected, "0017 회수 삼중항");
  });

  test("service_role·postgres·public 롤은 건드리지 않는다 — 접수·enqueue·발송기·파기가 서비스 롤로 돈다", () => {
    for (const s of parsePrivStatements(UP17_SQL, "keep")) {
      expect(s.roles, `${s.raw} 가 service_role 을 건드린다`).not.toContain("service_role");
      expect(s.roles, `${s.raw} 가 postgres 를 건드린다`).not.toContain("postgres");
      expect(s.roles, `${s.raw} 가 public 롤을 건드린다`).not.toContain("public");
      expect(s.privs, `${s.raw} 가 all 로 뭉뚱그린다`).not.toContain("all");
    }
  });

  test("부여(grant)는 하나도 없다 — 이 마이그레이션은 닫기만 한다", () => {
    expect(parsePrivStatements(UP17_SQL, "keep").filter((s) => s.verb === "grant")).toEqual([]);
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
    for (const forbidden of ["alter table", "drop table", "create policy", "drop policy", "insert into", "delete from", "truncate table"]) {
      expect(code, `0017 이 "${forbidden}" 을 한다 — 권한만 건드려야 한다`).not.toContain(forbidden);
    }
    // P5-15 astra R3 — ⑦ 의 일회용 표만 예외다. 되돌려지는 execute 안에서만 만든다(최상위에 있으면 커밋된다).
    expect([...code.matchAll(/create table ([a-z0-9_.]+)/g)].map((m) => m[1]), "일회용 표 말고 다른 표를 만든다").toEqual(["public.p0017_probe_tbl"]);
    expect(code, "최상위 create table 이 있다").not.toMatch(/(?:^|;)\s*create\s+table\b/);
    // 거동 탐침이 트리거를 만들었다 지우지만, 그것은 **동적 SQL**(execute format(…)) 안에 있고 최상위 문장이 아니다.
    // 최상위에 남아 있으면 마이그레이션이 트리거를 실제로 남기게 된다.
    expect(code, "최상위 create trigger 문장이 있다 — 탐침은 execute format(…) 안에 있어야 한다").not.toMatch(/(?:^|;)\s*create\s+trigger\b/);
  });

  test("재실행 안전 — revoke 는 멱등이고 조건 분기가 필요 없다", () => {
    const code = sqlCode(UP17_SQL);
    expect(sqlExec(UP17_SQL), "실행되는 revoke 가 없다").toMatch(/revoke /);
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
    expect(code, "탐침 뒤 두 표의 사용자 트리거 0 을 확인하지 않는다").toContain("where not tgisinternal");
  });

  test("🔴 P5-15 astra R4 P1 — ⑥ 은 NULL proacl 을 기본 ACL(PUBLIC EXECUTE)로 읽고, 공개 롤의 유효 EXECUTE 를 따로 거부한다", () => {
    const code = sqlCode(UP17_SQL);
    expect(code, "aclexplode(NULL) 은 0행이다 — 기본 ACL 로 채우지 않으면 NULL 이 '서비스 전용' 으로 통과한다").toContain("aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))");
    expect(code).not.toMatch(/aclexplode\(p\.proacl\)/);
    expect(code).toContain("where has_function_privilege(r.role, fn_oid, 'execute');");
    expect(code).toContain("공개 롤이 % 를 실행할 수 있다(유효 execute)");
  });

  test("🔴 P5-15 astra R3 — ⑦ 은 실제 두 표에 CREATE/DROP TRIGGER 를 치지 않는다 (잠금이 권한 검사보다 먼저다) · 거동은 일회용 표에서만", () => {
    const code = sqlCode(UP17_SQL);
    const creates = [...code.matchAll(/create trigger %i before update on ([a-z0-9_.%]+)/g)].map((m) => m[1]);
    expect(creates, "create trigger 대상이 일회용 표가 아니다").toEqual(["public.p0017_probe_tbl"]);
    expect(code, "실제 표에 drop trigger 를 실행한다(ACCESS EXCLUSIVE 를 커밋까지 쥔다)").not.toMatch(/execute\s+format\('drop trigger/);
    // 일회용 표: 서브트랜잭션 안에서 만들고, TRIGGER 는 service_role 에게만, 끝에서 P0017 로 되돌린다
    const make = code.indexOf("execute 'create table public.p0017_probe_tbl (id int)';");
    const revokeAll = code.indexOf("execute 'revoke all on table public.p0017_probe_tbl from public, anon, authenticated, service_role';");
    // astra R4 P2-3 — 탐침 직전마다 의도한 유효 권한만(열거) 있는지 단언한다
    expect(code).toContain("일회용 표의 유효 권한이 의도와 다르다");
    expect(code).toContain("aclexplode(acldefault('r', (select relowner from pg_class where oid = 'public.p0017_probe_tbl'::regclass)))");
    const grantSvc = code.indexOf("execute 'grant trigger on table public.p0017_probe_tbl to service_role';");
    const rollback = code.indexOf("raise exception using errcode = 'p0017'");
    expect(make).toBeGreaterThan(-1);
    expect(revokeAll).toBeGreaterThan(make);
    expect(grantSvc).toBeGreaterThan(revokeAll);
    expect(rollback).toBeGreaterThan(grantSvc);
    // 실제 두 표는 카탈로그로만 — 시도 없이 멈추는 검사가 일회용 표 블록보다 먼저다
    const catalogStop = code.indexOf("(실제 표에는 아무것도 시도하지 않았다)");
    expect(catalogStop, "실제 두 표의 카탈로그 검사가 없다").toBeGreaterThan(-1);
    expect(catalogStop).toBeLessThan(make);
    expect(code.slice(code.lastIndexOf("select string_agg", catalogStop), catalogStop), "카탈로그 검사가 acldefault 열거를 쓰지 않는다").toContain("aclexplode(acldefault('r'");
    // 카탈로그 ↔ 거동 일치 — 매 시도의 예측과 결과를 대조하고, TRIGGER 를 받은 anon 은 성공해야 한다
    expect(code).toContain("expected := has_table_privilege(role_name, 'public.p0017_probe_tbl', 'trigger');");
    expect(code).toContain("if created is distinct from expected then");
    expect(code).toContain("execute 'grant trigger on table public.p0017_probe_tbl to anon';");
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
    const nine = sqlExec("supabase/migrations/0009_admin_rls.sql");
    expect(nine, "0009 의 관리자 select grant 가 사라졌다").toContain("grant select on table notifications_log to authenticated");
    expect(nine, "0009 의 reservations grant 가 사라졌다").toContain("grant select, update on table reservations to authenticated");
    const twelve = sqlExec(UP_SQL);
    expect(twelve, "0012 의 회수 문장이 사라졌다").toContain("revoke insert, update, delete, truncate on table notifications_log from anon, authenticated");
    const sixteen = sqlExec(UP16_SQL);
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
    expectSymmetric(UP17_SQL, DOWN17_SQL, parsePrivStatements, "0017");
  });

  test("0010·0012 가 닫은 쓰기 네 동작을 되살리지 않는다", () => {
    const granted = triples(parsePrivStatements(DOWN17_SQL, "keep"), "grant");
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
  beforeAll(() => {
    // P5-15 astra R3 — 원격에 붙이는 행렬 원문(runbook 0017 절 표식 사이)을 **그대로** 실행한다. 사본을 두지 않는다(§19 가 잠근다).
    // 항목: ① 두 공개 롤의 trigger·references(컬럼 references 포함) ② anon 일곱 동작 0 ③ 관리자 select 생존 ④ service_role 불변
    //       ⑤ 컬럼 단위 0 ⑥ PUBLIC grant 0 ⑦ 아웃박스 definer 넷의 EXECUTE ⑧ 두 표의 사용자 트리거 0
    verdict = runLocalSql(runbookSql("0017"));
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
    expect(verdict, verdict).toContain("OUTBOX_FN_ALL_PRESENT");
    expect(verdict, verdict).toContain("OUTBOX_FN_ONLY_SERVICE");
    expect(verdict, verdict).toContain("OUTBOX_FN_NO_PUBLIC_ROLE_EXEC");
    expect(verdict, verdict).toContain("OUTBOX_FN_SERVICE_OK");
  });

  test("두 표에 사용자 트리거가 하나도 없다", () => {
    expect(verdict, verdict).toContain("PII_NO_USER_TRIGGER");
  });

  /**
   * astra R4 P1·P2-4 — 원격 행렬의 이빨. 슈퍼유저 채널(로컬 전용)에서 되돌려지는 트랜잭션 안에서
   *   ① `reap_stale_notifications()` 의 proacl 을 NULL(= 기본 ACL · PUBLIC EXECUTE)로 만들고
   *   ② `mark_notification_sent` 의 이름을 바꿔 "함수가 없음" 을 만든 뒤
   * **runbook 원문 행렬**을 돌려 결과를 예외로 실어 나른다. 옛 행렬(aclexplode(p.proacl) · proname 목록)은 두 경우 모두 성공 라벨을 냈다.
   */
  test("🔴 R4 — 행렬은 NULL proacl(기본 PUBLIC EXECUTE)과 사라진 함수를 실패 라벨로 보고한다 (슈퍼유저 · 되돌림)", () => {
    const matrix = runbookSql("0017").replace(/;\s*$/, "");
    const out = superProbeError(
      [
        "do $p515m$",
        "declare payload text;",
        "begin",
        "  update pg_catalog.pg_proc set proacl = null where oid = 'public.reap_stale_notifications()'::regprocedure;",
        "  alter function public.mark_notification_sent(bigint, text) rename to p515_renamed_mark_sent;",
        `  select row_to_json(m)::text into payload from (${matrix}) m;`,
        "  raise exception 'P515M %', payload;",
        "end",
        "$p515m$;",
      ].join("\n"),
    );
    expect(out, out).toMatch(/OUTBOX_FN_MISSING public\.mark_notification_sent\(bigint, text\)/);
    expect(out, out).toMatch(/OUTBOX_FN_EXTRA [^"]*reap_stale_notifications\/PUBLIC/);
    expect(out, out).toMatch(/OUTBOX_FN_PUBLIC_ROLE_EXEC [^"]*reap_stale_notifications\(\)\/anon/);
    // 되돌려졌다
    const after = sqlValue(
      "select 'P515A ' || coalesce((select proacl::text from pg_proc where oid = to_regprocedure('public.reap_stale_notifications()')), 'NULL') || ' ' || (to_regprocedure('public.mark_notification_sent(bigint, text)') is not null)::text as a;",
    );
    expect(after, after).toMatch(/P515A \{[^}]*service_role=X[^}]*\} true/);
  }, 300_000);

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

// =============================================================================
// 13. supabase/migrations/0018_sequence_privileges.sql — 텍스트 (P5-14)
//
//     기본 권한은 새 시퀀스도 공개 롤에 연다. 0012~0017 은 표·함수만 정리했고 시퀀스는 한 번도 회수하지 않았다.
//     P6-11 게이트가 첫 실행에서 36건을 이름으로 대며 빨개졌다 — 사람보다 기계가 먼저 찾은 첫 사례다.
// =============================================================================
describe("13. 0018_sequence_privileges.sql", () => {
  test("존재하고, 0018 번호는 이 파일 하나뿐이다. migrations/ 안에 롤백이 섞여 있지 않다", () => {
    expect(exists(UP18_SQL), `${UP18_SQL} 이 없다`).toBe(true);
    const files = readdirSync(path.join(ROOT, "supabase", "migrations"));
    expect(files.filter((f) => f.startsWith("0018"))).toEqual(["0018_sequence_privileges.sql"]);
    expect(files.filter((f) => f.endsWith(".down.sql"))).toEqual([]);
  });

  test("회수 집합이 정확히 그것뿐이다 — anon 은 일곱×셋 전부, authenticated 는 일곱×(select·update) + 통지 시퀀스 usage", () => {
    expectExactTriples(UP18_SQL, parseSeqStatements, "revoke", expected0018Revokes(), "0018 시퀀스 회수 삼중항");
  });

  test("🔴 콘텐츠 여섯의 `authenticated` usage 는 회수하지 않는다 — 관리자가 새 글을 못 쓰게 된다", () => {
    const revoked = triples(parseSeqStatements(UP18_SQL, "keep"), "revoke");
    for (const seq of CONTENT_SEQS) {
      expect(revoked.has(`authenticated|${seq}|usage`), `authenticated 의 ${seq} usage 를 회수한다 — 관리자 insert 의 nextval 이 42501 로 죽는다`).toBe(false);
    }
    // `all` 로 뭉뚱그리면 usage 까지 사라진다. 예외는 ⑤-나 의 일회용 시퀀스 하나뿐이다(P5-15 astra R4 — 서브트랜잭션째 되돌린다).
    expect(sqlCode(UP18_SQL)).not.toMatch(/revoke\s+all\s+on\s+sequence\s+(?!public\.p0018_probe_seq\s)/);
  });

  test("service_role·postgres·public 롤은 건드리지 않는다 — 통지 적재와 definer 함수가 nextval 한다", () => {
    expect(parseSeqStatements(UP18_SQL, "executable").length, "시퀀스 회수 문장을 하나도 읽지 못했다 — 파서가 눈이 멀었다").toBeGreaterThan(0);
    const stmts = parseSeqStatements(UP18_SQL, "keep");
    for (const s of stmts) {
      for (const role of ["service_role", "postgres", "public"]) expect(s.roles, `${s.raw} 가 ${role} 을 건드린다`).not.toContain(role);
      expect(s.privs, `${s.raw} 가 all 로 뭉뚱그린다`).not.toContain("all");
    }
  });

  test("부여는 최상위에 하나도 없다 — 대조군의 임시 시퀀스 부여는 되돌려지는 execute 안에만 있다", () => {
    expect(parseSeqStatements(UP18_SQL, "keep").filter((s) => s.verb === "grant")).toEqual([]);
    const code = sqlCode(UP18_SQL);
    expect(code).not.toMatch(/(?:^|;)\s*grant\s+/);
    const probeGrants = [...new Set([...code.matchAll(/grant [a-z, ]+ on sequence ([a-z0-9_.]+)/g)].map((m) => m[1]))];
    expect(probeGrants, "임시 시퀀스 말고 다른 것에 부여한다").toEqual(["public.p0018_probe_seq"]);
  });

  test("표·함수·데이터를 건드리지 않는다 — 시퀀스 권한 문장과 검증 블록뿐", () => {
    const code = sqlCode(UP18_SQL);
    expect(code, "표 권한 문장이 있다 — 0012~0017 소관이다").not.toMatch(/(?:revoke|grant)\s+[a-z, ]+\s+on\s+table\b/);
    expect(code, "drop function 문장이 있다").not.toMatch(/(?:^|;)\s*drop\s+function\b/);
    expect(code, "함수를 재정의한다").not.toMatch(/create\s+or\s+replace\s+function/);
    for (const forbidden of ["create table", "alter table", "drop table", "create policy", "drop policy", "insert into", "delete from", "truncate table", "alter default privileges", "alter sequence"]) {
      expect(code, `0018 이 "${forbidden}" 을 한다`).not.toContain(forbidden);
    }
    // 대조군의 임시 시퀀스 생성은 execute 문자열 안에 있어야 한다 — 최상위에 있으면 커밋된다.
    expect(code, "최상위 create sequence 가 있다").not.toMatch(/(?:^|;)\s*create\s+sequence\b/);
  });

  test("스스로 검증한다 — 카탈로그 열거 · 콘텐츠 usage 생존 · 서비스 롤 불변 · PUBLIC 0 · 거동 탐침 + 대조군", () => {
    const code = sqlCode(UP18_SQL);
    expect(code, "시퀀스 권한을 실효값으로 보지 않는다").toContain("has_sequence_privilege");
    expect(code, "시퀀스를 하드코딩으로만 본다 — 모르는 새 시퀀스를 놓친다").toMatch(/c\.relkind\s*=\s*'s'/);
    expect(code, "PUBLIC 전수 검사가 없다").toContain("aclexplode");
    expect(code, "PUBLIC 을 grantee 0 으로 보지 않는다").toContain("a.grantee = 0");
    expect(code, "service_role 불변 확인이 없다").toContain("('service_role')");
    expect(code, "setval 거동 탐침이 없다").toContain("pg_catalog.setval");
    expect(code, "권한 거부 코드(42501)를 명시하지 않는다").toContain("42501");
    expect(code, "롤 전환을 current_user 로 확인하지 않는다").toContain("current_user <> probe_role");
    expect(code, "대조군이 없다").toContain("p0018_probe_seq");
    expect(code, "어긋나도 조용히 성공한다").toContain("raise exception");
    expect(code, "필터된 뷰를 증거로 쓴다").not.toContain("information_schema");
  });

  test("🔴 P5-15 astra R4 — ⑤ 는 실제 시퀀스에 setval·nextval 을 치지 않는다 (잠금이 권한 검사보다 먼저다) · 거동은 일회용 시퀀스에서만", () => {
    const code = sqlCode(UP18_SQL);
    const calls = [...code.matchAll(/pg_catalog\.(setval|nextval)\(([^)]*)\)/g)].map((m) => m[2]);
    expect(calls.length, "거동 탐침이 없다").toBeGreaterThan(0);
    for (const c of calls) expect(c, `실제 시퀀스에 호출한다: ${c}`).toContain("p0018_probe_seq");
    expect(code, "실제 시퀀스 값을 읽는다").not.toContain("select last_value");
    // ⑤-가 실제 시퀀스는 카탈로그로만 — 종류 열거, 소스상 허용하지 않는 것만 제외, 허용 경로(authenticated nextval × 콘텐츠 usage)만 제외
    const catalogStop = code.indexOf("(실제 시퀀스에는 아무것도 시도하지 않았다)");
    const make = code.indexOf("execute 'create sequence public.p0018_probe_seq';");
    expect(catalogStop).toBeGreaterThan(-1);
    expect(make, "일회용 시퀀스 생성이 카탈로그 검사보다 먼저다").toBeGreaterThan(catalogStop);
    const cat = code.slice(code.lastIndexOf("select string_agg", catalogStop), catalogStop);
    expect(cat).toContain("aclexplode(acldefault('s', c.relowner))");
    expect(cat).toContain("d.privilege_type <> 'select'");
    expect(cat).toContain("not (q.call = 'setval' and d.privilege_type = 'usage')");
    expect(cat).toContain("not (r.role = 'authenticated' and q.call = 'nextval' and d.privilege_type = 'usage' and c.relname = any(content6))");
    expect(cat, "카탈로그 검사가 UPDATE 를 뺀다").not.toMatch(/privilege_type\s*(?:=|<>)\s*'update'/);
    // ⑤-나 일회용 시퀀스: PUBLIC 까지 회수 → 의도한 유효 권한만(열거) → 예측↔결과 대조 → P0018 되돌림
    expect(code).toContain("execute 'revoke all on sequence public.p0018_probe_seq from public, anon, authenticated, service_role';");
    expect(code).toContain("aclexplode(acldefault('s', (select relowner from pg_class where oid = 'public.p0018_probe_seq'::regclass)))");
    expect(code).toContain("일회용 시퀀스의 유효 권한이 의도와 다르다");
    expect(code).toContain("if ok is distinct from expected then");
    expect(code).toContain("'anon+update:setval', 'anon+update:nextval'");
    expect(code).toContain("raise exception using errcode = 'p0018'");
  });

  test("자기검증 순서 — PUBLIC 검사가 공개 롤 행렬 검사보다 먼저다 (상속된 권한을 anon 의 것으로 오진하지 않게)", () => {
    const code = sqlCode(UP18_SQL);
    const publicCheck = code.indexOf("a.grantee = 0");
    const matrixCheck = code.indexOf("has_sequence_privilege(r.role, c.oid");
    expect(publicCheck).toBeGreaterThan(-1);
    expect(matrixCheck).toBeGreaterThan(-1);
    expect(publicCheck, "행렬 검사가 먼저 돌면 PUBLIC grant 가 'anon → x' 로 보고돼 엉뚱한 회수를 하게 된다").toBeLessThan(matrixCheck);
  });

  test("무엇이 왜 위험한지 파일에 적혀 있다 — setval 되감기 · 도달 경로 판단의 전례", () => {
    const raw = read(UP18_SQL);
    expect(raw).toContain("setval");
    expect(raw, "통지 적재가 조용히 실패한다는 설명이 없다").toMatch(/기본키 중복/);
    expect(raw, "TRIGGER 때의 전례(도달 불가 판단이 틀렸다)를 적지 않았다").toContain("supabase_functions.http_request");
    expect(raw, "게이트가 먼저 찾았다는 출처가 없다").toContain("db-privilege-gate");
  });

  test("0001~0017 을 수정하지 않는다 — 0018 은 파일 하나를 더할 뿐이다", () => {
    const nine = sqlExec("supabase/migrations/0009_admin_rls.sql");
    expect(nine, "0009 의 관리자 시퀀스 부여가 사라졌다").toMatch(
      /grant usage, select on sequence notices_id_seq, popups_id_seq, gallery_id_seq, gallery_albums_id_seq, showcase_routes_id_seq, vehicles_id_seq to authenticated/,
    );
    expect(sqlExec(UP17_SQL), "0017 의 회수 문장이 사라졌다").toContain("revoke trigger, references on table reservations, notifications_log from anon, authenticated");
    expect(sqlExec(UP16_SQL), "0016 의 회수 문장이 사라졌다").toContain("revoke trigger, references on table");
  });
});

// =============================================================================
// 14. supabase/rollbacks/0018_sequence_privileges.down.sql — 텍스트
// =============================================================================
describe("14. 0018 롤백", () => {
  test("rollbacks/ 에만 있고, 수동 실행 절차를 헤더에 적는다", () => {
    expect(exists(DOWN18_SQL), `${DOWN18_SQL} 이 없다`).toBe(true);
    const raw = read(DOWN18_SQL);
    expect(raw).toMatch(/migration repair --status reverted 0018/);
    expect(raw).toMatch(/begin;/);
    expect(raw).toMatch(/commit;/);
  });

  test("승인 플래그를 **언제나** 요구한다 — 행 수·시퀀스 값을 조건으로 걸지 않는다", () => {
    const raw = read(DOWN18_SQL);
    expect(raw).toContain("bestour.rollback_0018_ack");
    const code = sqlCode(DOWN18_SQL);
    expect(code).toContain("raise exception");
    expect(code, "행 수가 승인 조건에 섞여 있다").not.toMatch(/[>)]\s*0\s+and\s+coalesce\s*\(\s*current_setting/);
    expect(code).toContain("if coalesce(current_setting('bestour.rollback_0018_ack', true), '') <> '1' then");
  });

  test("대칭 — 0018 이 회수한 것을 정확히 되돌린다(더도 덜도 아니게)", () => {
    expectSymmetric(UP18_SQL, DOWN18_SQL, parseSeqStatements, "0018");
    expect(parseSeqStatements(DOWN18_SQL, "keep").filter((s) => s.verb === "revoke")).toEqual([]);
  });

  test("되돌린 뒤 무엇이 다시 가능해지는지 예외 메시지가 말한다 — 승인 플래그를 요구하는 근거", () => {
    expect(read(DOWN18_SQL)).toMatch(/raise exception '0018 롤백 중단:[^']*setval/);
  });

  test("표·함수·데이터를 건드리지 않고, 시퀀스가 없으면 건너뛴다", () => {
    const code = sqlCode(DOWN18_SQL);
    expect(code).not.toMatch(/(?:revoke|grant)\s+[a-z, ]+\s+on\s+table\b/);
    expect(code).not.toMatch(/(?:^|;)\s*drop\s+function\b/);
    expect(code).not.toMatch(/create\s+or\s+replace\s+function/);
    for (const forbidden of ["delete from", "truncate table", "drop table", "insert into", "alter sequence"]) {
      expect(code, `롤백이 "${forbidden}" 을 한다`).not.toContain(forbidden);
    }
    // 시퀀스 값은 건드리지 않는다. (예외 메시지는 "setval 이 다시 열린다" 를 설명하므로 호출 형태만 본다.)
    expect(code, "롤백이 시퀀스 값을 바꾼다").not.toMatch(/\b(?:setval|nextval)\s*\(/);
    expect(code, "시퀀스 존재 확인 없이 부여하면 0001·0008 롤백 뒤 재실행에서 죽는다").toContain("to_regclass");
  });

  test("롤백도 스스로 검증한다 — 되돌림 · PUBLIC 0 · 관리자 usage 와 서비스 롤 생존", () => {
    const code = sqlCode(DOWN18_SQL);
    expect(code).toContain("has_sequence_privilege");
    expect(code).toContain("a.grantee = 0");
    expect(code).toContain("('service_role', 'usage')");
    expect(code).toContain("('authenticated', 'usage')");
  });
});

// =============================================================================
// 15. 0018 권한 행렬 + **거동 실증** (로컬 스택)
//
//     §12 와 같은 짝 구조. 행렬은 "권한이 없다" 까지만 말하므로, `set local role` 로 그 롤이 되어
//     `setval`·`nextval` 을 **직접** 치고 42501 을 본다. 허용된 두 경로(관리자·서비스 롤의 nextval)는 대조군으로 성공해야 한다.
//
//     이 블록은 행을 만들지 않는다. setval 은 **현재 값 그대로** 치므로(거부돼야 하고, 만에 하나 통과해도 되감기지 않는다)
//     시퀀스를 되감지 않는다. 대조군 nextval 은 번호 하나씩을 소모할 뿐이다 — 아웃박스·갤러리 잠금이 필요 없다.
// =============================================================================
describe.skipIf(!gate.allowed)("15. DB — 0018 시퀀스 권한 행렬 + 거동 실증 (로컬 스택)", { timeout: 300_000 }, () => {
  let verdict = "";

  beforeAll(() => {
    // P5-15 astra R3 — 원격에 붙이는 행렬 원문(runbook 0018 절 표식 사이)을 **그대로** 실행한다. 사본을 두지 않는다(§19 가 잠근다).
    // 항목: ① 허용(콘텐츠 여섯 × authenticated usage) 밖의 공개 롤 시퀀스 권한 0 ② 관리자 usage 생존 ③ 서비스 롤·소유자 일곱 × 셋
    //       ④ PUBLIC 직접 부여 0 · 시퀀스 수(열거가 공허하지 않다)
    verdict = runLocalSql(
      runbookSql("0018"),
    );
  }, 300_000);

  test("공개 롤의 시퀀스 권한은 콘텐츠 여섯 × authenticated usage 뿐이다 (카탈로그 전수)", () => {
    expect(verdict, verdict).toContain("SEQ_NONE");
    expect(verdict, "시퀀스 열거가 공허하다").toMatch(/SEQ_COUNT [7-9]|SEQ_COUNT \d{2,}/);
  });

  test("관리자 화면이 산다 — 콘텐츠 여섯의 authenticated usage 가 그대로다", () => {
    expect(verdict, verdict).toContain("ADMIN_SEQ_OK");
  });

  test("서비스 롤·소유자의 시퀀스 권한은 불변 · PUBLIC 직접 부여 0", () => {
    expect(verdict, verdict).toContain("SERVICE_SEQ_OK");
    expect(verdict, verdict).toContain("SEQ_PUBLIC_NONE");
  });

  /**
   * 거동 실증 — 통과 조건(하나라도 어긋나면 DO 블록이 raise 해서 runLocalSql 이 던진다):
   *   · anon: 통지·공지 시퀀스의 setval·nextval 4회가 전부 **42501**
   *   · authenticated: 통지 시퀀스의 setval·nextval, 공지 시퀀스의 setval 3회가 전부 **42501**
   *   · authenticated 의 공지 nextval · service_role 의 통지 nextval 은 **성공**(대조군 = 허용된 두 경로)
   *   · 매 시도 전에 `current_user` 가 기대 롤로 바뀌었고, 끝에 적용 롤로 돌아왔다
   *   · 두 시퀀스의 값이 되감기지 않았다(setval 이 아무것도 바꾸지 않았다)
   */
  test("거동 실증 — 공개 롤의 setval·nextval 은 42501 · 관리자·서비스 롤의 nextval 은 성공 (롤 전환 확인 포함)", () => {
    const out = runLocalSql(
      [
        "do $$",
        "declare",
        "  probe     record;",
        "  ok        boolean;",
        "  st        text;",
        "  ms        text;",
        "  v_last    bigint;",
        "  v_called  boolean;",
        "  n_before  bigint;",
        "  x_before  bigint;",
        "  applier   constant text := current_user;",
        "begin",
        "  select last_value into n_before from public.notifications_log_id_seq;",
        "  select last_value into x_before from public.notices_id_seq;",
        "  for probe in",
        "    select * from (values",
        "      ('anon', 'notifications_log_id_seq', 'setval', false),",
        "      ('anon', 'notifications_log_id_seq', 'nextval', false),",
        "      ('anon', 'notices_id_seq', 'setval', false),",
        "      ('anon', 'notices_id_seq', 'nextval', false),",
        "      ('authenticated', 'notifications_log_id_seq', 'setval', false),",
        "      ('authenticated', 'notifications_log_id_seq', 'nextval', false),",
        "      ('authenticated', 'notices_id_seq', 'setval', false),",
        "      ('authenticated', 'notices_id_seq', 'nextval', true),",
        "      ('service_role', 'notifications_log_id_seq', 'nextval', true)",
        "    ) v(who, seq, fn, allowed)",
        "  loop",
        "    execute format('select last_value, is_called from public.%I', probe.seq) into v_last, v_called;",
        "    execute format('set local role %I', probe.who);",
        "    if current_user <> probe.who then",
        "      raise exception 'P514 탐침: 롤 전환이 반영되지 않았다 (current_user=% · 기대=%)', current_user, probe.who;",
        "    end if;",
        "    ok := false; st := null; ms := null;",
        "    begin",
        "      if probe.fn = 'setval' then",
        "        execute format('select pg_catalog.setval(%L::regclass, %s, %L::boolean)', 'public.' || probe.seq, v_last, v_called);",
        "      else",
        "        execute format('select pg_catalog.nextval(%L::regclass)', 'public.' || probe.seq);",
        "      end if;",
        "      ok := true;",
        "    exception when others then",
        "      get stacked diagnostics st = returned_sqlstate, ms = message_text;",
        "    end;",
        "    execute 'reset role';",
        "    if probe.allowed and not ok then",
        "      raise exception 'P514 탐침: 허용된 경로가 막혔다 — % → %(%) : SQLSTATE=% MESSAGE=%', probe.who, probe.fn, probe.seq, st, ms;",
        "    end if;",
        "    if not probe.allowed and ok then",
        "      raise exception 'P514 탐침: % 가 %(%) 를 실행할 수 있다', probe.who, probe.fn, probe.seq;",
        "    end if;",
        "    if not probe.allowed and st is distinct from '42501' then",
        "      raise exception 'P514 탐침: 권한 거부(42501)가 아닌 이유로 실패했다 — % → %(%) : SQLSTATE=% MESSAGE=%', probe.who, probe.fn, probe.seq, st, ms;",
        "    end if;",
        "  end loop;",
        "  if current_user <> applier then",
        "    raise exception 'P514 탐침: 롤이 되돌아오지 않았다 (current_user=%)', current_user;",
        "  end if;",
        "  if (select last_value from public.notifications_log_id_seq) < n_before",
        "     or (select last_value from public.notices_id_seq) < x_before then",
        "    raise exception 'P514 탐침: 시퀀스가 되감겼다';",
        "  end if;",
        "end",
        "$$;",
      ].join("\n"),
    );
    expect(out, out).toContain("DO");
  }, 300_000);
});

// =============================================================================
// 16. supabase/migrations/0019_maintain_privilege.sql — 텍스트 (P5-15)
//
//     PostgreSQL 17 의 표 권한 `MAINTAIN`(VACUUM·ANALYZE·CLUSTER·REINDEX·LOCK TABLE — RLS 밖). 0012~0018 이 한 번도 회수하지 않았고,
//     P6-11 게이트는 권한 종류를 하드코딩해서 그것을 **초록으로 통과**시켰다. P5-15 가 게이트를 먼저 고쳤다.
//     이 파일의 핵심 제약 두 가지: **버전 조건부**(16 이하에서 `revoke maintain` 은 오류 — 원격 푸시 전체가 막힌다)와
//     **표 카탈로그 열거**. 그래서 회수 문장은 최상위가 아니라 버전 판정 뒤의 동적 SQL 안에만 있다.
// =============================================================================
const UP19_SQL = "supabase/migrations/0019_maintain_privilege.sql";
const DOWN19_SQL = "supabase/rollbacks/0019_maintain_privilege.down.sql";

/** 0019 적용 시점의 public 표 중 공개 롤이 MAINTAIN 을 갖고 있던 아홉 — 롤백이 되돌리는 고정 목록(admin_users 는 0009 가 revoke all). */
const MAINTAIN_BASELINE_TABLES = [...CONTENT_TABLES, "places", "reservations", "notifications_log"] as const;

/**
 * §18 의 LOCK 거동 블록 — 🔴 **로컬 테스트 전용. 원격에 붙이지 마라** (astra R2 P1-A · 컨트롤러 결정).
 * 1라운드에서는 이것을 runbook 과 공유하는 "원격 안전" 블록으로 만들었지만, 권한이 예상과 달리 남아 있으면 거부를 기대한
 * 실제 표 LOCK 도 **잡히고**(되돌릴 때까지 접수가 막힌다), 일회용 표 DDL 은 운영의 이벤트 트리거를 태운다.
 * 원격 확인은 runbook 의 카탈로그 행렬(§19)만 쓰고, 적용 시점의 거동 확인은 0019 ⑥(시도 직전 사전 검사 포함)이 한다.
 * 로컬에서의 구조: 실제 표는 거부만 기대 · 성공 대조군은 일회용 표 · 매 시도를 서브트랜잭션으로 **언제나** 되돌림 · 적용 롤 복원.
 * PostgreSQL 17 전용이다(`grant maintain`).
 */
const LOCK_PROBE_SQL = [
  "do $$",
  "declare",
  "  probe    record;",
  "  ok       boolean;",
  "  st       text;",
  "  ms       text;",
  "  applier  constant text := current_user;",
  "begin",
  "  for probe in",
  "    select * from (values",
  "      ('anon', 'reservations', false),",
  "      ('anon', 'notifications_log', false),",
  "      ('anon', 'notices', false),",
  "      ('anon', 'places', false),",
  "      ('authenticated', 'reservations', false),",
  "      ('authenticated', 'notifications_log', false),",
  "      ('authenticated', 'places', false),",
  "      ('service_role', 'p0515_probe_tbl', true)",
  "    ) v(who, tbl, allowed)",
  "  loop",
  "    ok := false; st := null; ms := null;",
  "    begin",
  "      if probe.tbl = 'p0515_probe_tbl' then",
  "        execute 'create table public.p0515_probe_tbl (id int)';",
  "        execute 'revoke all on table public.p0515_probe_tbl from anon, authenticated, service_role';",
  "        execute 'grant maintain on table public.p0515_probe_tbl to service_role';",
  "      end if;",
  "      execute format('set local role %I', probe.who);",
  "      if current_user <> probe.who then",
  "        raise exception 'P515 탐침: 롤 전환이 반영되지 않았다 (current_user=% · 기대=%)', current_user, probe.who using errcode = 'P0517';",
  "      end if;",
  "      begin",
  "        execute format('lock table public.%I in access exclusive mode nowait', probe.tbl);",
  "        ok := true;",
  "      exception when others then",
  "        get stacked diagnostics st = returned_sqlstate, ms = message_text;",
  "      end;",
  "      execute format('set local role %I', applier);",
  // 언제나 되돌린다 — 성공한 잠금·일회용 표·롤 전환이 이 서브트랜잭션과 함께 사라진다
  "      raise exception using errcode = 'P0516', message = 'p515 probe rollback';",
  "    exception",
  "      when sqlstate 'P0516' then null;",
  "    end;",
  "    if current_user <> applier then",
  "      raise exception 'P515 탐침: 적용 롤로 돌아오지 못했다 (current_user=%)', current_user;",
  "    end if;",
  "    if probe.allowed and not ok then",
  "      raise exception 'P515 탐침: 대조군이 막혔다 — % → LOCK % : SQLSTATE=% MESSAGE=%', probe.who, probe.tbl, st, ms;",
  "    end if;",
  "    if not probe.allowed and ok then",
  "      raise exception 'P515 탐침: % 가 % 를 ACCESS EXCLUSIVE 로 잠글 수 있다', probe.who, probe.tbl;",
  "    end if;",
  "    if not probe.allowed and st is distinct from '42501' then",
  "      raise exception 'P515 탐침: 권한 거부(42501)가 아닌 이유로 실패했다 — % → LOCK % : SQLSTATE=% MESSAGE=%', probe.who, probe.tbl, st, ms;",
  "    end if;",
  "  end loop;",
  "  if to_regclass('public.p0515_probe_tbl') is not null then",
  "    raise exception 'P515 탐침: 일회용 표가 남았다';",
  "  end if;",
  "end",
  "$$;",
].join("\n");

describe("16. 0019_maintain_privilege.sql", () => {
  test("존재하고, 0019 번호는 이 파일 하나뿐이다. migrations/ 안에 롤백이 섞여 있지 않다", () => {
    expect(exists(UP19_SQL), `${UP19_SQL} 이 없다`).toBe(true);
    const files = readdirSync(path.join(ROOT, "supabase", "migrations"));
    expect(files.filter((f) => f.startsWith("0019"))).toEqual(["0019_maintain_privilege.sql"]);
    expect(files.filter((f) => f.endsWith(".down.sql"))).toEqual([]);
  });

  test("🔴 최상위에 revoke·grant 가 없다 — MAINTAIN 문장은 버전 판정 뒤 동적 SQL 에만 있다 (16 이하에서 문법 오류로 푸시가 막힌다)", () => {
    const code = sqlCode(UP19_SQL);
    expect(code, "최상위 revoke/grant 가 있다").not.toMatch(/(?:^|;)\s*(?:revoke|grant)\s/);
    // P5-15 R7 — 앞머리 두 문장(set local lock_timeout · 그 확인 DO)은 모든 버전에서 유효하다(lock_timeout 은 9.3+). 그 뒤가 버전 판정 DO 다.
    const PREAMBLE = /^set local lock_timeout = '5s'; do \$\$ begin if current_setting\('lock_timeout'\) <> '5s' then .*? end if; end \$\$; /;
    expect(code, "lock_timeout 앞머리가 없다").toMatch(PREAMBLE);
    expect(code.replace(PREAMBLE, ""), "앞머리 뒤 최상위 문장이 do 블록 하나가 아니다").toMatch(/^do \$\$ declare/);
    // 버전 판정 → 16 이하 건너뛰기(return) → 회수 의 순서
    const ver = code.indexOf("v_applies constant boolean := v_ver >= 170000;");
    const skip = code.indexOf("if not v_applies then");
    const ret = code.indexOf("return;", skip);
    const revoke = code.indexOf("revoke maintain on table");
    expect(ver, "버전 판정식이 없다(server_version_num >= 170000)").toBeGreaterThan(-1);
    expect(code).toContain("current_setting('server_version_num')::int");
    expect(skip).toBeGreaterThan(ver);
    expect(ret, "16 이하 분기가 return 으로 끝나지 않는다").toBeGreaterThan(skip);
    expect(revoke, "회수가 버전 분기보다 먼저 나온다").toBeGreaterThan(ret);
    expect(code.slice(skip, ret), "건너뛴 사실을 notice 로 남기지 않는다").toMatch(/raise notice '0019: [^']*건너뛴다/);
  });

  test("회수는 정확히 하나 — 공개 두 롤의 MAINTAIN, 표는 카탈로그 열거 (표 이름·권한 뭉치 하드코딩 없음)", () => {
    const code = sqlCode(UP19_SQL);
    const revokes = [...code.matchAll(/revoke ([a-z, ]+) on table ([^ ]+) from ([a-z_, ]+)/g)].map((m) => m.slice(1, 4));
    expect(revokes).toEqual([
      ["maintain", "%s", "anon, authenticated"],
      ["all", "public.p0019_probe_tbl", "public, anon, authenticated, service_role"],
    ]);
    // astra R4 P2-3 — 대조군 직전에 anon 의 MAINTAIN 하나만 유효한지(열거) 단언한다
    expect(code).toContain("대조군 일회용 표의 유효 권한이 의도와 다르다");
    expect(code).toContain("is distinct from (w.role = 'anon' and d.privilege_type = 'maintain')");
    // 회수 루프는 pg_class 를 relkind 로 열거한다
    expect(code).toMatch(/for rel in\s+select c\.oid::regclass\s+from pg_class c join pg_namespace n on n\.oid = c\.relnamespace\s+where n\.nspname = 'public' and c\.relkind in \('r', 'p', 'v', 'm', 'f'\)/);
    // 부여는 대조군 임시 표에만
    const grants = [...code.matchAll(/grant ([a-z, ]+) on table ([^ ]+) to ([a-z_, ]+)/g)].map((m) => m.slice(1, 4));
    expect(grants).toEqual([["maintain", "public.p0019_probe_tbl", "anon"]]);
  });

  test("service_role·postgres·다른 권한·표·함수·데이터를 건드리지 않는다", () => {
    const code = sqlCode(UP19_SQL);
    expect(code, "시퀀스 권한 문장이 있다").not.toMatch(/(?:revoke|grant)\s+[a-z, ]+\s+on\s+sequence\b/);
    expect(code, "함수 권한 문장이 있다").not.toMatch(/(?:revoke|grant)\s+[a-z, ]+\s+on\s+function\b/);
    expect(code, "drop function 문장이 있다").not.toMatch(/\bdrop\s+function\b/);
    expect(code, "함수를 재정의한다").not.toMatch(/create\s+or\s+replace\s+function/);
    // 힌트 문장("reset role 로 바꾸면 안 된다")은 허용하고, **실행되는 형태**(최상위 문장·execute 인자)만 금지한다.
    expect(code, "🔴 reset role 은 세션 기본 롤로 돌아간다 — 0017·0018 에서 원격 푸시를 막을 뻔했다").not.toMatch(/(?:^|;)\s*reset\s+role\b|execute\s+'\s*reset\s+role/);
    expect(code.match(/set local role/g)?.length ?? 0, "롤 전환·복원 문장이 없다").toBeGreaterThanOrEqual(3);
    for (const forbidden of ["alter table", "drop table", "create policy", "drop policy", "insert into", "delete from", "truncate", "alter default privileges", "vacuum", "cluster", "reindex"]) {
      expect(code, `0019 가 "${forbidden}" 을 한다`).not.toContain(forbidden);
    }
    // 임시 표 생성은 되돌려지는 execute 안에만
    expect(code, "최상위 create table 이 있다").not.toMatch(/(?:^|;)\s*create\s+table\b/);
    expect([...code.matchAll(/create table ([a-z0-9_.]+)/g)].map((m) => m[1])).toEqual(["public.p0019_probe_tbl"]);
  });

  test("스스로 검증한다 — ⑤ 분기↔능력 · ③ PUBLIC · ① 열거 · ② 서비스 롤 불변 · ④ 전후 ACL 전수 · ⑥ LOCK 거동 + 대조군", () => {
    const code = sqlCode(UP19_SQL);
    expect(code, "⑤ 서버 능력(acldefault)과 버전 판정을 대조하지 않는다").toContain("v_applies is distinct from v_knows_maintain");
    expect(code).toContain("aclexplode(acldefault('r', to_regrole(current_user)))");
    expect(code, "③ PUBLIC 을 grantee 0 으로 보지 않는다").toContain("a.grantee = 0 and a.privilege_type = 'maintain'");
    expect(code, "① 실효값으로 보지 않는다").toContain("has_table_privilege(r.role, c.oid, 'maintain')");
    expect(code, "② 서비스 롤 전후 대조가 없다").toContain("after_svc is distinct from before_svc");
    expect(code, "④ 전후 ACL 대조가 없다").toContain("after_acl is distinct from before_acl");
    expect(code, "④ 가 종류를 하드코딩한다 — aclexplode 로 전 종류를 펼쳐야 한다").toMatch(/before_acl from \(\s*select format\('[^']*', c\.relname, a\.grantee::regrole, a\.grantor::regrole, a\.privilege_type, a\.is_grantable\)/);
    expect(code, "④ 가 컬럼 ACL 을 보지 않는다").toContain("aclexplode(at.attacl)");
    expect(code, "⑥ 강한 잠금 탐침이 없다").toContain("lock table %s in access exclusive mode nowait");
    expect(code, "⑥ 롤 전환을 current_user 로 확인하지 않는다").toContain("current_user <> probe.who");
    expect(code, "⑥ 적용 롤로 명시 복원하지 않는다").toContain("execute format('set local role %i', applier);");
    expect(code, "권한 거부 코드(42501)를 명시하지 않는다").toContain("42501");
    expect(code, "⑥ 대조군이 없다").toContain("lock table public.p0019_probe_tbl in access exclusive mode nowait");
    expect(code, "⑥ 탐침이 공허해도 통과한다").toContain("n_probes = 0");
    expect(code, "필터된 뷰를 증거로 쓴다").not.toContain("information_schema");
  });

  test("자기검증 순서 — PUBLIC(③)이 공개 롤 행렬(①)보다 먼저 · 분기(⑤)가 맨 앞", () => {
    const code = sqlCode(UP19_SQL);
    const branch = code.indexOf("v_applies is distinct from v_knows_maintain");
    const revoke = code.indexOf("revoke maintain on table");
    const pub = code.indexOf("a.grantee = 0 and a.privilege_type = 'maintain'");
    const matrix = code.indexOf("and has_table_privilege(r.role, c.oid, 'maintain');");
    const probe = code.indexOf("lock table %s in access exclusive mode nowait");
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(revoke);
    expect(revoke).toBeLessThan(pub);
    expect(pub, "행렬 검사가 먼저 돌면 PUBLIC grant 가 'anon → x' 로 보고돼 엉뚱한 회수를 하게 된다").toBeLessThan(matrix);
    expect(matrix).toBeLessThan(probe);
  });

  test("⑥ 탐침 대상 선정이 MAINTAIN 을 '다른 권한' 으로 세지 않는다 — 새는 조합에서 눈을 감지 않게", () => {
    const code = sqlCode(UP19_SQL);
    expect(code).toContain("d.privilege_type not in ('select', 'maintain')");
  });

  test("🔴 astra R2 P1-A — ⑥ 은 시도 직전에 SELECT 외 모든 권한(열거)이 false 인지 보고, 아니면 LOCK 없이 멈춘다 · ① 이 ⑥ 보다 먼저다", () => {
    const code = sqlCode(UP19_SQL);
    const matrix = code.indexOf("and has_table_privilege(r.role, c.oid, 'maintain');");
    const loop = code.indexOf("n_probes := n_probes + 1;");
    const pre = code.indexOf("and has_table_privilege(probe.who, k.oid, d.privilege_type);");
    const stop = code.indexOf("잠금을 시도하지 않고 멈춘다");
    const lock = code.indexOf("lock table %s in access exclusive mode nowait");
    expect(matrix, "① 행렬이 없다").toBeGreaterThan(-1);
    expect(matrix, "① 이 ⑥ 보다 뒤에 있다 — MAINTAIN 이 남은 채 LOCK 을 시도한다").toBeLessThan(loop);
    expect(pre, "시도 직전 사전 검사가 없다").toBeGreaterThan(loop);
    expect(stop).toBeGreaterThan(pre);
    expect(lock, "사전 검사가 LOCK 뒤에 있다").toBeGreaterThan(stop);
    // 사전 검사의 종류는 열거(acldefault)에서 오고, SELECT 만 뺀다 — MAINTAIN 을 빼면 안 된다
    const preBlock = code.slice(loop, lock);
    expect(preBlock).toContain("aclexplode(acldefault('r', k.relowner))");
    expect(preBlock).toContain("d.privilege_type <> 'select'");
    expect(preBlock, "사전 검사가 MAINTAIN 을 뺀다").not.toContain("'maintain'");
  });

  test("무엇이 왜 위험한지, 무엇을 닫지 못하는지 파일에 적혀 있다", () => {
    const raw = read(UP19_SQL);
    expect(raw).toMatch(/LOCK TABLE/);
    expect(raw, "예약 접수가 멈춘다는 설명이 없다").toMatch(/예약 접수/);
    expect(raw, "TRIGGER 때의 전례를 적지 않았다").toContain("supabase_functions.http_request");
    expect(raw, "게이트가 놓쳤다는 출처가 없다").toContain("db-privilege-gate");
    expect(raw, "버전 조건의 이유가 없다").toMatch(/PostgreSQL 17/);
    expect(raw, "authenticated 의 콘텐츠 표 LOCK 잔존을 적지 않았다").toMatch(/닫지 \*\*못하는\*\* 것/);
  });

  test("0001~0018 을 수정하지 않는다 — 0019 는 파일 하나를 더할 뿐이다", () => {
    expect(sqlExec(UP18_SQL), "0018 의 회수 문장이 사라졌다").toMatch(/revoke usage, select, update on sequence/);
    expect(sqlExec(UP17_SQL), "0017 의 회수 문장이 사라졌다").toContain("revoke trigger, references on table reservations, notifications_log from anon, authenticated");
    expect(sqlCode(UP18_SQL), "0018 에 maintain 이 섞였다").not.toContain("maintain");
  });
});

// =============================================================================
// 17. supabase/rollbacks/0019_maintain_privilege.down.sql — 텍스트
// =============================================================================
describe("17. 0019 롤백", () => {
  test("rollbacks/ 에만 있고, 수동 실행 절차와 '기본 기준선' 복원임을 헤더에 적는다", () => {
    expect(exists(DOWN19_SQL), `${DOWN19_SQL} 이 없다`).toBe(true);
    const raw = read(DOWN19_SQL);
    expect(raw).toMatch(/migration repair --status reverted 0019/);
    expect(raw).toMatch(/^begin;/m);
    expect(raw).toMatch(/^commit;/m);
    expect(raw, "이전 ACL 이 아니라 기본 기준선으로 복원한다는 명시가 없다").toMatch(/Supabase 기본 기준선/);
    expect(raw, "업그레이드된 DB 에서 어긋나는 경우를 적지 않았다").toMatch(/업그레이드/);
  });

  test("승인 플래그를 **언제나** 요구한다 — 버전 판정보다 먼저, 행 수를 조건으로 걸지 않는다", () => {
    const code = sqlCode(DOWN19_SQL);
    const flag = code.indexOf("if coalesce(current_setting('bestour.rollback_0019_ack', true), '') <> '1' then");
    expect(flag).toBeGreaterThan(-1);
    expect(flag, "플래그 검사가 버전 분기 뒤에 있다").toBeLessThan(code.indexOf("v_ver"));
    expect(code, "행 수가 승인 조건에 섞여 있다").not.toMatch(/[>)]\s*0\s+and\s+coalesce\s*\(\s*current_setting/);
    expect(read(DOWN19_SQL)).toMatch(/raise exception '0019 롤백 중단:[^']*LOCK TABLE/);
  });

  test("버전 조건부 — 16 이하에서는 부여하지 않고 notice 로 끝난다", () => {
    const code = sqlCode(DOWN19_SQL);
    const skip = code.indexOf("if not v_applies then");
    const firstGrant = code.indexOf("grant maintain");
    expect(code).toContain("v_applies constant boolean := v_ver >= 170000;");
    expect(code).toContain("v_applies is distinct from v_knows_maintain");
    expect(skip).toBeGreaterThan(-1);
    expect(skip, "부여가 버전 분기보다 먼저 나온다").toBeLessThan(firstGrant);
    expect(code, "최상위 grant 가 있다").not.toMatch(/(?:^|;)\s*grant\s/);
    expect(code, "검증 블록이 16 이하에서 has_table_privilege('maintain') 을 부른다(오류)").toMatch(/if current_setting\('server_version_num'\)::int < 170000 then\s+return;/);
  });

  test("대칭 — 아홉 표 × 두 공개 롤의 MAINTAIN 만 되돌린다 (admin_users 없음 · 다른 종류 없음 · 회수 없음)", () => {
    const code = sqlCode(DOWN19_SQL);
    const grants = new Set<string>();
    for (const m of code.matchAll(/grant ([a-z, ]+) on table ([a-z_]+) to ([a-z_, ]+)'/g)) {
      for (const p of m[1].split(",").map((s) => s.trim())) for (const r of m[3].split(",").map((s) => s.trim())) grants.add(`${r}|${m[2]}|${p}`);
    }
    const expected = new Set(MAINTAIN_BASELINE_TABLES.flatMap((t) => [`anon|${t}|maintain`, `authenticated|${t}|maintain`]));
    expect([...grants].sort()).toEqual([...expected].sort());
    expect(code).not.toMatch(/grant [a-z, ]+ on table admin_users/);
    expect(code, "롤백이 회수한다").not.toMatch(/\brevoke\s/);
    expect(code, "롤백이 표 이름 없이 열거로 부여한다 — 0019 뒤에 생긴 표까지 연다").not.toMatch(/grant maintain on table %s/);
    for (const t of MAINTAIN_BASELINE_TABLES) expect(code, `${t} 존재 확인이 없다`).toContain(`to_regclass('public.${t}')`);
  });

  test("표·함수·시퀀스·데이터를 건드리지 않고, reset role 을 쓰지 않는다", () => {
    const code = sqlCode(DOWN19_SQL);
    expect(code).not.toMatch(/(?:revoke|grant)\s+[a-z, ]+\s+on\s+(?:sequence|function)\b/);
    expect(code).not.toMatch(/\bdrop\s+function\b/);
    expect(code).not.toMatch(/(?:^|;)\s*reset\s+role\b|execute\s+'\s*reset\s+role/);
    expect(code, "롤백은 롤을 바꿀 이유가 없다").not.toContain("set local role");
    for (const forbidden of ["delete from", "truncate", "drop table", "insert into", "alter table"]) {
      expect(code, `롤백이 "${forbidden}" 을 한다`).not.toContain(forbidden);
    }
  });

  test("롤백도 스스로 검증한다 — 되돌림 · PUBLIC 0 · admin_users 미개방 · 서비스 롤", () => {
    const code = sqlCode(DOWN19_SQL);
    expect(code).toContain("has_table_privilege(r.role, t.tbl, 'maintain')");
    expect(code).toContain("a.grantee = 0 and a.privilege_type = 'maintain'");
    expect(code).toContain("has_table_privilege('anon', 'public.admin_users', 'maintain')");
    expect(code).toContain("has_table_privilege('service_role', t.tbl, 'maintain')");
    // astra P2-6 — 서비스 롤 검사는 경고다. 롤백은 그 권한을 없앨 수 없고, 업그레이드 DB 에서는 원래 없었을 수 있다.
    expect(code, "서비스 롤 검사가 롤백을 멈춘다 — 업그레이드 DB 에서 거짓 실패한다").toMatch(/raise warning '0019 롤백: service_role 의 maintain 이 없는 표가 있다/);
    expect(code).not.toMatch(/raise exception '0019 롤백: service_role/);
  });
});

// =============================================================================
// 18. 0019 권한 행렬 + **거동 실증** + 버전 분기 (로컬 스택)
//
//     §12·§15 와 같은 짝 구조. 행렬은 "권한이 없다" 까지만 말하므로 `set local role` 로 그 롤이 되어
//     `LOCK TABLE … ACCESS EXCLUSIVE MODE NOWAIT` 를 **직접** 치고 42501 을 본다(service_role 은 성공 — 대조군).
//     VACUUM 은 트랜잭션·함수 안에서 돌 수 없고, 권한 없는 ANALYZE 는 오류가 아니라 WARNING 으로 건너뛰므로
//     여기서는 LOCK 만 자동화한다(셋 모두의 거부 출력은 P5-15 보고서 ⑥).
//     **버전 분기**: 로컬은 17 이므로 16 이하 경로는 실제 파일의 판정 줄만 치환해 실행한다(되돌려지게 notice 만 예외로 올린다).
//     이 블록은 행을 만들지 않는다 — 탐침은 잠금을 잡더라도 서브트랜잭션째 되돌리고, 분기 실행은 전부 예외로 끝난다.
// =============================================================================
describe.skipIf(!gate.allowed)("18. DB — 0019 MAINTAIN 행렬 + LOCK 거동 + 버전 분기 (로컬 스택)", { timeout: 300_000 }, () => {
  let version = 0;
  let verdict = "";

  beforeAll(() => {
    const v = runLocalSql("select 'P515_VER ' || current_setting('server_version_num') as v;");
    version = Number(v.match(/P515_VER (\d+)/)?.[1] ?? 0);
    if (version < 170000) return;
    // astra R2 P1-A — 원격에 붙이는 행렬 원문(runbook 표식 사이)을 **그대로** 실행한다. 사본을 두지 않는다(§19 가 잠근다).
    // service_role 은 "true" 를 요구한다 — 로컬·CI 는 마이그레이션으로 만든 17 DB 라 기본 권한이 m 을 준다.
    // 원격(16→17 업그레이드일 수 있다)에서는 그 줄을 적용 직전 스냅샷과 대조한다(runbook 0019 · astra P2-6).
    verdict = runLocalSql(runbookMatrixSql());
  }, 300_000);

  test("서버 버전을 읽었다 (로컬 스택·CI 는 17 이다 — supabase/config.toml)", () => {
    expect(version).toBeGreaterThan(0);
    expect(version, "로컬 스택이 17 미만이다 — 이 절의 행렬·거동은 17 전용이다").toBeGreaterThanOrEqual(170000);
  });

  test("공개 롤의 MAINTAIN 0 (카탈로그 전수) · service_role 은 그대로 · PUBLIC 0 · 롤백 목록 아홉 표 실재", () => {
    expect(verdict, verdict).toContain("MAINTAIN_NONE");
    expect(verdict, verdict).toContain("SERVICE_MAINTAIN_OK");
    expect(verdict, verdict).toContain("MAINTAIN_PUBLIC_NONE");
    expect(verdict, verdict).toContain(`BASELINE_PRESENT ${MAINTAIN_BASELINE_TABLES.length}`);
  });

  /**
   * 거동 실증 — 통과 조건(하나라도 어긋나면 DO 블록이 raise 해서 runLocalSql 이 던진다):
   *   · anon: reservations · notifications_log · notices · places 의 ACCESS EXCLUSIVE 잠금이 **42501**
   *   · authenticated: reservations · notifications_log · places(SELECT 만 있는 표) 가 **42501**
   *   · service_role: **일회용 임시 표**(블록 안에서 만들고 되돌린다)에 MAINTAIN 만 주면 잠금 **성공**(대조군)
   *   · 매 시도 전에 `current_user` 가 기대 롤로 바뀌었고, 매 시도 뒤 **적용 롤로 `set local role`** 해서 돌아왔다(reset role 금지)
   *
   * 🔴 **로컬 전용** (astra R2 P1-A). 원격 확인은 §19 의 카탈로그 행렬뿐이다 — 이 블록은 권한이 예상과 달리 남아 있으면 실제 표를
   * 잡을 수 있고(거부를 "기대" 할 뿐 보장하지 않는다), 일회용 표 DDL 이 운영 이벤트 트리거를 태운다.
   * 로컬에서의 설계: 성공 대조군은 일회용 표뿐(1라운드 P1-1 — 옛 대조군은 실제 `reservations` 였다). 거부 탐침이 잠금을 잡지 않는 근거는
   * PostgreSQL 17 `LockTableCommand` → `RangeVarGetRelidExtended(…, RangeVarCallbackForLockTable)` 가 **잠금 전에** `LockTableAclCheck`
   * (MAINTAIN|UPDATE|DELETE|TRUNCATE, 약한 모드면 +SELECT/INSERT)를 하고 실패하면 `aclcheck_error` 로 끝나기 때문이다.
   */
  test("거동 실증 — 공개 롤의 LOCK TABLE … ACCESS EXCLUSIVE 는 42501 · service_role 은 일회용 표에서 성공 (롤 전환 확인 포함)", () => {
    const out = runLocalSql(LOCK_PROBE_SQL);
    expect(out, out).toContain("DO");
    expect(runLocalSql("select 'P515_LEFT ' || count(*) as l from pg_class where relname = 'p0515_probe_tbl';")).toContain("P515_LEFT 0");
  }, 300_000);

  test("astra P1-1 — (로컬 전용) LOCK 블록은 실제 표에서 잠금 성공을 기대하지 않는다 (성공 기대 = 일회용 표뿐)", () => {
    const rows = [...LOCK_PROBE_SQL.matchAll(/\('(\w+)', '([\w.]+)', (true|false)\)/g)].map((m) => ({ who: m[1], tbl: m[2], allowed: m[3] === "true" }));
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const r of rows.filter((x) => x.allowed)) expect(r.tbl, `${r.who} 가 실제 표 ${r.tbl} 를 잠그는 데 성공해야 한다고 적혀 있다`).toBe("p0515_probe_tbl");
    for (const r of rows.filter((x) => !x.allowed)) expect(r.tbl).not.toBe("p0515_probe_tbl");
    expect(rows.some((x) => x.allowed), "대조군이 없다").toBe(true);
    // 일회용 표는 블록 안에서 만들고 예외로 되돌린다 — 최상위에 create 가 없다
    expect(LOCK_PROBE_SQL).toContain("execute 'create table public.p0515_probe_tbl (id int)';");
    expect(LOCK_PROBE_SQL).toContain("raise exception using errcode = 'P0516'");
    expect(LOCK_PROBE_SQL).not.toMatch(/reset\s+role/);
  });

  // ---------------------------------------------------------------------------
  // 버전 분기 — 실제 0019 파일의 판정 줄만 치환해서 실행한다.
  //   · skip 경로의 `raise notice` 를 `raise exception` 으로 올린다 — 메시지를 읽고 트랜잭션을 통째로 되돌리기 위해서다
  //     (db query 는 notice 를 돌려주지 않는다). 분기 로직 자체는 한 글자도 바꾸지 않는다.
  // ---------------------------------------------------------------------------
  const VER_LINE = "v_ver             constant int     := current_setting('server_version_num')::int;";
  const KNOWS_LINE =
    "v_knows_maintain  constant boolean := exists (select 1 from aclexplode(acldefault('r', to_regrole(current_user))) d where d.privilege_type = 'MAINTAIN');";
  const SKIP_NOTICE = "raise notice '0019: PostgreSQL % (server_version_num=%) — MAINTAIN 권한이 없는 버전이다";
  const variant = (ver: string, knows: string) => {
    const full = read(UP19_SQL);
    // P5-15 R7 — 이 헬퍼는 문장 하나만 보낸다(prepared statement). 앞머리(set local lock_timeout · 확인 DO)를 떼고 버전 판정 DO 만 돌린다.
    //            떼어 낸 부분이 주석과 그 앞머리뿐인지 확인한다(다른 최상위 문장이 숨지 않게).
    const cut = full.indexOf("do $$\ndeclare");
    const head = compact(stripComments(full.slice(0, cut), UP19_SQL));
    expect(head).toMatch(/^set local lock_timeout = '5s'; do \$\$ begin if current_setting\('lock_timeout'\) <> '5s' then .*? end if; end \$\$;$/);
    const src = full.slice(cut);
    for (const needle of [VER_LINE, KNOWS_LINE, SKIP_NOTICE]) expect(src, `치환 대상이 파일에 없다 — 파일이 바뀌었나: ${needle}`).toContain(needle);
    return src
      .split(VER_LINE).join(`v_ver             constant int     := ${ver};`)
      .split(KNOWS_LINE).join(`v_knows_maintain  constant boolean := ${knows};`)
      .split(SKIP_NOTICE).join("raise exception 'P515_SKIP 0019: PostgreSQL % (server_version_num=%) — MAINTAIN 권한이 없는 버전이다");
  };

  test("16 이하 경로 — 판정 16·능력 없음이면 **아무것도 하지 않고** 건너뛴 사실을 남긴다 (회수 문장까지 가지 않는다)", () => {
    const out = probeError(variant("160004", "false"));
    expect(out, out).toContain("P515_SKIP 0019:");
    expect(out, out).toContain("server_version_num=160004");
    expect(out, "건너뛰지 않고 뒤로 진행했다").not.toMatch(/0019: (공개 롤|PUBLIC|MAINTAIN 말고|service_role|거동|대조군)/);
  });

  test("분기 가드 — 판정과 능력이 어긋나면 어느 쪽이든 멈춘다 (16 인데 MAINTAIN 을 안다 · 17 인데 모른다)", () => {
    const a = probeError(variant("160004", "true"));
    expect(a, a).toContain("0019: 버전 분기와 서버 능력이 어긋난다 — server_version_num=160004");
    const b = probeError(variant("170006", "false"));
    expect(b, b).toContain("0019: 버전 분기와 서버 능력이 어긋난다 — server_version_num=170006");
  });

  test("판정식 단위 — 경계값 (160099 → 건너뜀 · 170000 → 적용 · 180001 → 적용)", () => {
    const out = runLocalSql("select 'P515_EDGE ' || (160099 >= 170000)::text || ' ' || (170000 >= 170000)::text || ' ' || (180001 >= 170000)::text as e;");
    expect(out).toContain("P515_EDGE false true true");
  });
});

// =============================================================================
// 19. runbook 0019 절 — **원격에 붙이는 확인 절차는 카탈로그 질의뿐** (astra R2 P1-A)
//
//     컨트롤러 결정(2026-09-17): 운영자가 원격에 붙이는 확인은 `has_table_privilege`·`aclexplode` 행렬만 쓴다.
//     LOCK 거동과 일회용 표 대조군은 **로컬 테스트 전용**이다 — 권한이 예상과 달리 남아 있으면 거부를 "기대" 한 LOCK 도 잡히고,
//     일회용 표 DDL 은 운영의 이벤트 트리거를 태운다. 적용 시점의 거동 확인은 0019 자기검증 ⑥ 이 이미 한다(그쪽은 시도 직전에
//     강한 잠금을 줄 수 있는 권한이 전부 false 임을 확인하므로 잠금 획득이 구조적으로 불가능하다).
//     그리고 **원격에 붙이는 행렬 원문 = 이 파일이 실행하는 원문** 이 되도록, §18 은 runbook 의 표식 사이 SQL 을 읽어 실행한다.
// =============================================================================
const RUNBOOK = "docs/ops/migration-runbook.md";
type RunbookSection = "0016" | "0017" | "0018" | "0019";
const MATRIX_MARKER: Record<RunbookSection, string> = {
  "0016": "0016_MATRIX_SQL",
  "0017": "0017_MATRIX_SQL",
  "0018": "0018_MATRIX_SQL",
  "0019": "MAINTAIN_MATRIX_SQL",
};

/** runbook 의 한 마이그레이션 절(`## <번호>` 부터 다음 `## ` 머리 전까지). */
function runbookSection(num: RunbookSection): string {
  const raw = read(RUNBOOK);
  const start = raw.indexOf(`\n## ${num}`);
  expect(start, `runbook 에 ${num} 절이 없다`).toBeGreaterThan(-1);
  const next = raw.indexOf("\n## ", start + 5);
  return raw.slice(start, next === -1 ? undefined : next);
}

/** CommonMark 여는 펜스: 3칸 이하 들여쓰기 · 같은 문자 3개 이상 · 정보 문자열. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/**
 * CommonMark 닫는 펜스 (astra R6 P2-4): 3칸 이하 들여쓰기, 여는 펜스와 **같은 문자**로
 * **여는 길이 이상**, 뒤에는 **공백만**. `~~~not-a-close`·`` ```sql `` 은 닫는 줄이 아니다.
 */
function isFenceClose(line: string, openFence: string): boolean {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/);
  return !!m && m[1][0] === openFence[0] && m[1].length >= openFence.length;
}

/**
 * 표식 사이의 ```sql 블록을 꺼낸다 (텍스트 단위 — 단위 테스트가 변형을 넣는다).
 * `full` 은 runbook 전체, `section` 은 그 절. 실패하면 throw.
 */
function extractMarkedSql(full: string, section: string, marker: string): string {
  const begin = `<!-- P515:${marker}:BEGIN -->`;
  const end = `<!-- P515:${marker}:END -->`;
  const count = (s: string, needle: string) => s.split(needle).length - 1;
  // 표식 쌍은 runbook 전체에서 정확히 하나 — 그리고 그 하나가 이 절 안에 있어야 한다 (astra R6 P2-4)
  for (const mk of [begin, end]) {
    if (count(full, mk) !== 1) throw new Error(`표식이 runbook 전체에 정확히 하나가 아니다: ${mk} ×${count(full, mk)}`);
    if (count(section, mk) !== 1) throw new Error(`표식이 이 절에 정확히 하나가 아니다: ${mk} ×${count(section, mk)}`);
  }
  const b = section.indexOf(begin);
  const e = section.indexOf(end);
  if (e <= b) throw new Error(`끝 표식이 시작 표식보다 앞에 있다 (${marker})`);
  // 표식 사이에는 완결된 ```sql 블록 정확히 하나와 빈 줄만 있어야 한다
  const lines = section.slice(b + begin.length, e).replace(/\r\n/g, "\n").split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const open = lines[0]?.match(FENCE_OPEN);
  if (!open || open[2].trim().toLowerCase() !== "sql") throw new Error("표식 뒤 첫 줄이 ```sql 여는 펜스가 아니다");
  const closeAt = lines.findIndex((l, k) => k > 0 && isFenceClose(l, open[1]));
  if (closeAt < 0) throw new Error("표식 사이의 sql 블록이 닫히지 않았다");
  if (closeAt !== lines.length - 1) throw new Error("표식 사이에 sql 블록 뒤로 다른 내용(두 번째 블록·산문)이 있다");
  return lines.slice(1, closeAt).join("\n");
}

/** runbook 표식 사이의 ```sql 블록 — 운영자가 원격 SQL Editor 에 붙여 **읽기 확인**하는 원문이고, 테스트가 그대로 실행하는 원문이다. */
function runbookSql(num: RunbookSection): string {
  return extractMarkedSql(read(RUNBOOK), runbookSection(num), MATRIX_MARKER[num]);
}
const runbookMatrixSql = () => runbookSql("0019");

/** 원격에서 실행되면 안 되는 문장 — 잠금·DDL·DML·롤 전환·유지보수·익명 블록. */
const REMOTE_FORBIDDEN =
  /\b(lock\s+table|create\s|alter\s|drop\s|grant\s|revoke\s|truncate\b|vacuum\b|analyze\b|cluster\b|reindex\b|refresh\s|insert\s+into|delete\s+from|update\s+[\w."]+\s+set\b|do\s+\$|set\s+(local\s+)?role|setval\s*\(|nextval\s*\()/i;

/**
 * 판정 전에 주석을 지우고 문자열 내용을 비운다 — 행렬은 `('truncate')` 같은 **권한 이름 리터럴**을 담는다.
 * 저장소의 단일 스캐너(`sqlView` · executable 시야)를 쓴다(제자리 정규식 제거기 금지 — strip-comments §6-S).
 * 동적 SQL 은 `do $…$` 없이는 실행될 수 없으므로 `do $` 가 남아 잡힌다(executable 시야는 execute 인자도 실행될 SQL 로 남긴다).
 */
const remoteScan = (sql: string) => sqlView(sql, "runbook-remote-block.sql", { data: "executable" });

/** 로컬 전용 표식 — 이것이 붙은 줄, 또는 바로 앞 줄에 이것이 있는 코드 블록만 위험 문장을 담을 수 있다. */
const LOCAL_ONLY = "원격에 붙이지 마라";

/**
 * astra R4 P2-1 — **실행 가능한 문장의 모양**(위험 토큰 + 대상). 코드 블록(언어 무관)과 산문 둘 다에 적용한다.
 * 산문에는 "revoke 는 …" 같은 설명이 많아서 토큰만으로는 못 본다 — 대상이 붙은 문장 모양만 잡는다.
 */
const T = String.raw`"?[a-z_][\w."]*`; // 대상 이름 — 식별자로 시작해야 한다(산문의 따옴표·기호에 걸리지 않게)
const STATEMENT_SHAPE = new RegExp(
  [
    String.raw`\block\s+(?:table\s+)?${T}\s+in\s+[a-z ]+\s+mode`,
    String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:table|trigger|sequence|function|procedure|policy|index|role|schema|extension|view|event\s+trigger)\s+${T}`,
    String.raw`\bdrop\s+(?:table|trigger|sequence|function|procedure|policy|index|role|schema|extension|view|owned)\s+${T}`,
    String.raw`\balter\s+(?:table|sequence|function|procedure|role|default\s+privileges|schema|view)\s+${T}`,
    String.raw`\b(?:grant|revoke)\s+[\w ,()]+?\s+on\s+(?:all\s+\w+\s+in\s+schema\s+|table\s+|sequence\s+|function\s+|schema\s+)?${T}`,
    String.raw`\b(?:grant|revoke)\s+[a-z_"]+\s+(?:to|from)\s+[a-z_"]+`,
    String.raw`\btruncate\s+(?:table\s+)?${T}`,
    String.raw`\bvacuum\b(?:\s*\([^)]*\))?\s+${T}`,
    String.raw`\banalyze\s+${T}`,
    String.raw`\b(?:cluster|reindex)\s+${T}`,
    String.raw`\brefresh\s+materialized\s+view\s+${T}`,
    String.raw`\binsert\s+into\s+${T}`,
    String.raw`\bdelete\s+from\s+${T}`,
    String.raw`\bupdate\s+${T}\s+set\b`,
    String.raw`\bset\s+(?:local\s+)?role\s+"?[a-z_]`,
    String.raw`\bdo\s+\$`,
    String.raw`\b(?:setval|nextval)\s*\(\s*['"\w]`,
  ].join("|"),
  "i",
);

/** 원격 확인 안내가 테스트 파일·테스트 절을 가리키는 모양 — runbook 밖의 원문을 붙이게 만든다. */
// `§1~§4` 같은 **마이그레이션 자신의 절 번호**는 잡지 않는다 — 테스트를 가리키는 모양(tests/ 경로 · "테스트/test … §N" · "§N … SQL/원문/블록")만.
const TEST_REFERENCE = /tests\/|(?:테스트|test)[^\n]{0,20}§\s*\d|§\s*\d+[^\n]{0,10}(?:SQL|원문|블록)/i;
const PASTE_WORDS = /SQL\s*Editor|붙여|복사|copy|paste|psql/i;

/**
 * runbook 한 절에서 **원격에 붙일 수 있는 위험 문장**을 찾는다 (astra R4 P2-1).
 *   · 코드 블록: ``` 와 ~~~ 둘 다, 언어 무관. `sql` 블록은 sqlView(executable)로 본 뒤 넓은 토큰(REMOTE_FORBIDDEN)과 문장 모양 둘 다,
 *     그 밖의 블록(text·c·무표기)은 문장 모양. 블록 바로 앞의 비지 않은 줄에 LOCAL_ONLY 가 있으면 예외.
 *   · 산문: 문장 모양, 그리고 "테스트 파일/§번호 + 붙여넣기 말" 이 같은 줄에 있으면 위반. 그 줄에 LOCAL_ONLY 가 있으면 예외.
 * **한계**: 정규식 휴리스틱이다 — 문장을 여러 줄로 쪼개거나 다른 말로 풀어 쓰면 빠진다. 보증이 아니라 회귀 방지 보조다.
 */
function remoteViolations(sec: string): string[] {
  const lines = sec.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let lastProse = "";
  for (let i = 0; i < lines.length; i++) {
    // 여는 줄은 넓게 잡는다(들여쓰기 무관 — 놓치는 것보다 과하게 보는 쪽이 안전하다). 닫는 줄은 엄격하게.
    const open = lines[i].match(/^\s*(`{3,}|~{3,})\s*([\w-]*)/);
    if (open) {
      const fence = open[1];
      const lang = open[2].toLowerCase();
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !isFenceClose(lines[j], fence)) body.push(lines[j++]);
      if (j >= lines.length) out.push(`닫히지 않은 코드 블록 (${i + 1}행)`);
      const text = body.join("\n");
      const exempt = lastProse.includes(LOCAL_ONLY);
      if (!exempt) {
        const shaped = text.match(STATEMENT_SHAPE);
        if (shaped) out.push(`코드 블록(${lang || "무표기"}, ${i + 1}행)에 실행 문장: ${shaped[0]}`);
        if (lang === "sql") {
          const broad = remoteScan(text).match(REMOTE_FORBIDDEN);
          if (broad) out.push(`sql 블록(${i + 1}행)에 금지 토큰: ${broad[0]}`);
        }
      }
      i = j;
      continue;
    }
    const line = lines[i];
    if (line.trim() !== "") lastProse = line;
    if (line.includes(LOCAL_ONLY)) continue;
    const shaped = line.match(STATEMENT_SHAPE);
    if (shaped) out.push(`산문(${i + 1}행)에 실행 문장: ${shaped[0]} — ${line.slice(0, 120)}`);
    if (TEST_REFERENCE.test(line) && PASTE_WORDS.test(line)) out.push(`산문(${i + 1}행)이 테스트 원문을 붙이라고 한다 — ${line.slice(0, 120)}`);
  }
  return out;
}

describe("19. runbook 0017·0018·0019 — 원격 확인 절차는 카탈로그 질의뿐 (astra R2 P1-A · R3 · R4)", () => {
  // ---------------------------------------------------------------------------
  // astra R6 P2-4 — 표식·펜스 파서의 엄격성
  // ---------------------------------------------------------------------------
  const M = "TEST_MATRIX_SQL";
  const B = `<!-- P515:${M}:BEGIN -->`;
  const E = `<!-- P515:${M}:END -->`;
  const one = [B, "```sql", "select 1;", "```", E].join("\n");

  test("🔴 R6 P2-1 — 원격 적용 경로는 `supabase db push` 하나 · 적용 후 이력 확인 · 수동 적용 예외는 승인 조건부", () => {
    const raw = read(RUNBOOK).replace(/\r\n/g, "\n");
    const top = raw.slice(0, raw.indexOf("\n## 0012"));
    // SQL Editor 를 적용 경로로 적은 문장이 어디에도 없다 (runbook · 0012~0019 마이그레이션)
    const applyViaEditor = /db push[^\n]{0,30}또는[^\n]{0,30}SQL Editor|SQL Editor[^\n]{0,10}로 적용|SQL Editor 로만/;
    expect(raw.match(applyViaEditor)?.[0] ?? null, "runbook 이 SQL Editor 를 적용 경로로 적는다").toBeNull();
    const migs = readdirSync(path.join(ROOT, "supabase", "migrations")).filter((n) => /^001[2-9]_.*\.sql$/.test(n));
    expect(migs.length).toBe(8);
    for (const f of migs) {
      expect(read(`supabase/migrations/${f}`).match(applyViaEditor)?.[0] ?? null, f).toBeNull();
    }
    // 맨 위에 결정이 있다
    expect(top.indexOf("### 🔴 적용 경로"), "맨 위에 「적용 경로」 절이 없다").toBeGreaterThan(-1);
    const route = top.slice(top.indexOf("### 🔴 적용 경로"));
    expect(route).toMatch(/0012~0019[^\n]*`supabase db push`[^\n]*하나/);
    expect(route).toMatch(/SQL Editor[^\n]*읽기 확인/);
    // 적용 직후 필수 — 이력 마지막이 0019
    expect(route).toContain("select version, name from supabase_migrations.schema_migrations order by version;");
    expect(route).toMatch(/마지막이 `0019`/);
    // 예외 — 수동 적용 뒤 repair 는 컨트롤러 승인이 있을 때만
    const repairLine = route.split("\n").find((l) => l.includes("supabase migration repair --status applied")) ?? "";
    expect(repairLine, "repair --status applied 안내가 없다").not.toBe("");
    expect(repairLine).toMatch(/컨트롤러 승인/);
    // 순서 4 도 같은 말을 한다
    expect(top).toMatch(/^4\. 원격에 적용한다[^\n]*`supabase db push`/m);
  });

  // ---------------------------------------------------------------------------
  // R9 — CLI 출력 형식(JSON · ASCII 표)에 기대지 않는다 (f696020 CI DB Smoke 실패)
  //      로컬 CLI 2.117.0 은 JSON, CI(setup-cli `version: latest`)는 표를 낸다. 값 끝 따옴표에 기댄
  //      단언이 로컬만 통과했다. 여기서는 **두 형식의 픽스처**로 헬퍼와 실제 단언식을 함께 검사한다.
  // ---------------------------------------------------------------------------
  const VALUE = "P515R7B search_path=public, pg_temp";
  const JSON_OUT = JSON.stringify({ boundary: "230f061b69807da4e4378371b69041e5", rows: [{ a: VALUE }], warning: "…untrusted…" }, null, 2);
  const TABLE_OUT = ["┌──────────────────────────────────────────┐", "│ a                                        │", "├──────────────────────────────────────────┤", `│ ${VALUE}     │`, "└──────────────────────────────────────────┘"].join("\n");
  const PLAIN_OUT = ["            a             ", " ------------------------ ", `  ${VALUE}  `, "(1 row)"].join("\n");

  test("🔴 R9 — sqlCells 는 JSON·표·평문에서 같은 값을 준다 (따옴표·테두리에 기대지 않는다)", () => {
    for (const [name, out] of [["JSON(로컬 2.117.0)", JSON_OUT], ["ASCII 표(CI latest)", TABLE_OUT], ["평문", PLAIN_OUT]] as const) {
      expect(sqlCells(out), name).toContain(VALUE);
      expect(sqlCells(out).join(" | "), name).toContain("P515R7B search_path=public, pg_temp");
    }
    // 옛 단언(값 끝의 따옴표)은 표 형식에서 깨진다 — 그래서 이 단언 형태를 쓰지 않는다
    expect(new RegExp(`${VALUE}"`).test(TABLE_OUT), "표 형식에는 값 끝에 따옴표가 없다").toBe(false);
    // 여러 칸·여러 행 · NULL
    expect(sqlCells(JSON.stringify({ rows: [{ a: "1", b: null }, { a: "2", b: "x" }] }))).toEqual(["1", "", "2", "x"]);
    expect(sqlCells(["│ a │ b │", "│ 1 │ 2 │"].join("\n"))).toEqual(["a", "b", "1", "2"]);
  });

  test("🔴 R9 — sqlErrorText 는 두 형식에서 같은 오류 메시지를 준다 (탐침 단언식이 둘 다에서 맞는다)", () => {
    const message =
      'failed to execute query: error: P515R6 {"blind":"RLS_BLIND_NONE","anon_read":"ANON_SELECT_LOST public.notices",' +
      '"places_write":"PLACES_WRITE_LEAK update","anon_extra":"ANON_EXTRA public.vehicles/insert public.gallery/references",' +
      '"pg_temp":"PG_TEMP_MISSING public.mark_notification_sent(bigint, text) public.reap_stale_notifications()"}';
    const jsonErr = JSON.stringify({ _tag: "Error", error: { code: "LegacyDbQueryExecError", message } });
    const tableErr = ["┌───────────────┐", "│ error         │", "├───────────────┤", `│ ${message} │`, "└───────────────┘", "", "Try rerunning the command with --debug"].join("\n");
    for (const [name, out] of [["JSON(로컬)", jsonErr], ["표(CI)", tableErr], ["평문(stderr)", `${message}\n`]] as const) {
      const text = sqlErrorText(out);
      expect(text, name).toContain("P515R6");
      // §9 탐침이 쓰는 단언식 그대로
      expect(text, name).toMatch(/ANON_SELECT_LOST [^"\\]*public\.notices/);
      expect(text, name).toMatch(/PLACES_WRITE_LEAK [^"\\]*update/);
      expect(text, name).toMatch(/ANON_EXTRA [^"\\]*public\.vehicles\/insert/);
      expect(text, name).toMatch(/PG_TEMP_MISSING [^"\\]*mark_notification_sent/);
      expect(text, name).not.toMatch(/PG_TEMP_MISSING [^"\\]*mark_notification_failed/);
    }
  });

  test("🔴 R9 — 탐침 단언은 헬퍼를 거친다 · CLI 출력 원문에 따옴표를 기대는 정규식이 없다", () => {
    const self = read("tests/write-privileges.test.ts");
    // 실패 출력은 언제나 sqlErrorText 를 거친다 — 원시 호출은 래퍼 두 줄뿐이다
    for (const fn of ["runLocalSqlExpectingError", "runLocalSuperuserSqlExpectingError"]) {
      const uses = self.split(`${fn}(`).length - 1;
      expect(uses, `${fn} 의 원시 호출은 래퍼 정의 하나뿐이어야 한다`).toBe(1);
    }
    // P515 라벨을 쓰는 단언식이 CLI 출력의 따옴표에 기대지 않는다(f696020 회귀 방지)
    for (const f of readdirSync(path.join(ROOT, "tests")).filter((n) => n.endsWith(".test.ts"))) {
      const src = read(`tests/${f}`);
      for (const m of src.matchAll(/toMatch\(\/([^\n]*?)\/[gimsuy]*\)/g)) {
        if (!m[1].includes("P515")) continue;
        expect(m[1].includes('"'), `${f}: CLI 출력의 따옴표에 기댄 단언 — ${m[1]}`).toBe(false);
      }
    }
  });

  test("🔴 R7 P2-b — 대기 중인 0012~0019 여덟 파일의 첫 실행문은 `set local lock_timeout = '5s'` · runbook 은 부분 적용을 적는다", () => {
    const all = readdirSync(path.join(ROOT, "supabase", "migrations")).filter((n) => /^\d{4}_.*\.sql$/.test(n));
    const pending = all.filter((n) => /^001[2-9]_/.test(n));
    expect(pending.length).toBe(8);
    for (const f of pending) {
      const rel = `supabase/migrations/${f}`;
      const code = sqlCode(rel);
      expect(code.slice(0, 40), `${f} — 첫 실행문`).toMatch(/^set local lock_timeout = '5s';/);
      // 둘째 실행문 — set local 이 실제로 걸렸는지(파일이 한 트랜잭션인지) 확인하고, 아니면 아무것도 바꾸기 전에 멈춘다
      expect(code.slice(0, 200), `${f} — 가드`).toMatch(
        new RegExp(String.raw`^set local lock_timeout = '5s'; do \$\$ begin if current_setting\('lock_timeout'\) <> '5s' then raise exception '${f.slice(0, 4)}: 앞 문장의 set local lock_timeout 이 남지 않았다`),
      );
      expect(code.match(/lock_timeout'?\s*(=|to\s)/g)?.length ?? 0, `${f} — 다른 곳에서 lock_timeout 을 바꾸지 않는다`).toBe(1);
      expect(code, `${f} — set_config 로 바꾸지 않는다`).not.toMatch(/set_config\(\s*'lock_timeout'/);
      // 바로 윗줄 주석이 이유를 적는다
      expect(read(rel), `${f} — 이유 주석`).toMatch(/\n--[^\n]*lock_timeout[^\n]*\nset local lock_timeout = '5s';\n/);
    }
    // 이미 원격에 적용된 0001~0011 은 건드리지 않는다(db push 가 다시 돌리지 않는다)
    for (const f of all.filter((n) => !pending.includes(n))) expect(read(`supabase/migrations/${f}`), f).not.toMatch(/lock_timeout/);
    const raw = read(RUNBOOK);
    expect(raw, "db push 에서 lock_timeout 이 불가하다는 옛 서술").not.toMatch(/lock_timeout[^\n]*(걸 수 없다|넣을 수 없다)|넣을 수 없다[^\n]*lock_timeout/);
    const top = raw.slice(0, raw.indexOf("\n## 0012"));
    expect(top).toContain("set local lock_timeout = '5s';");
    // 부분 적용 — 앞 파일은 커밋·기록된 채 남고, 그 파일은 롤백되고, 다음 push 가 그 파일부터
    expect(top).toMatch(/앞 파일[^\n]*커밋[^\n]*기록/);
    expect(top).toMatch(/그 파일[^\n]*롤백/);
    expect(top).toMatch(/다음 `supabase db push` 가 그 파일부터/);
    // R8 P2-b — 확인 DO 의 보장 수준을 과장하지 않는다(자동 커밋 + 기본값 5초면 통과한다)
    expect(top, "확인 DO 가 원자성을 증명한다고 적혀 있다").toMatch(/원자성을 증명하지 않는다/);
    expect(top).toMatch(/기본값이 이미 5초면 통과한다/);
  });

  test("🔴 R6 P2-4 — 표식 사이에 SQL 블록이 둘이면 거부한다 (두 번째 블록을 조용히 버리지 않는다)", () => {
    expect(extractMarkedSql(one, one, M)).toBe("select 1;");
    const two = [B, "```sql", "select 1;", "```", "", "```sql", "grant maintain on table notices to anon;", "```", E].join("\n");
    expect(() => extractMarkedSql(two, two, M)).toThrow();
    const trailing = [B, "```sql", "select 1;", "```", "그리고 이것도 붙여라: vacuum", E].join("\n");
    expect(() => extractMarkedSql(trailing, trailing, M), "블록 밖의 산문이 표식 안에 있다").toThrow();
  });

  test("🔴 R6 P2-4 — 표식 쌍이 둘이면 거부한다 (절 안이든 runbook 전체든)", () => {
    const dup = [one, "", one.replace("select 1;", "select 2;")].join("\n");
    expect(() => extractMarkedSql(dup, dup, M)).toThrow();
    // 절에는 하나뿐이지만 runbook 다른 곳에 같은 표식이 또 있다
    expect(() => extractMarkedSql(`${one}\n\n## 다른 절\n${one}`, one, M)).toThrow();
    // 끝 표식만 중복
    const dupEnd = [B, "```sql", "select 1;", "```", E, E].join("\n");
    expect(() => extractMarkedSql(dupEnd, dupEnd, M)).toThrow();
  });

  test("🔴 R6 P2-4 — 닫는 펜스 문법은 엄격하다: `~~~not-a-close` 는 닫는 줄이 아니다", () => {
    // 옛 파서(startsWith)는 `~~~not-a-close` 에서 블록을 닫고, 블록 안의 주석 줄을 "로컬 전용" 산문으로 읽어
    // 다음 펜스 블록(실제로는 블록 밖의 잠금 문장)을 면제했다.
    const sec = ["## 예시", "", "~~~sql", "select 1;", "~~~not-a-close", `-- ${LOCAL_ONLY}`, "~~~", "lock table public.notices in access exclusive mode;", "~~~"].join("\n");
    expect(remoteViolations(sec), "가짜 닫는 줄로 잠금 문장이 면제됐다").not.toEqual([]);
    // 표식 추출도 같은 규칙 — 닫는 줄 뒤에 글자가 있으면 닫힘이 아니다
    const bad = [B, "```sql", "select 1;", "```sql", E].join("\n");
    expect(() => extractMarkedSql(bad, bad, M)).toThrow();
    // 여는 줄보다 짧은 닫는 줄은 닫힘이 아니다 · 다른 문자도 아니다
    const short = [B, "````sql", "select 1;", "```", E].join("\n");
    expect(() => extractMarkedSql(short, short, M)).toThrow();
    const mixed = [B, "~~~sql", "select 1;", "```", E].join("\n");
    expect(() => extractMarkedSql(mixed, mixed, M)).toThrow();
    // 허용: 더 긴 닫는 줄 · 뒤따르는 공백 · 3칸 이하 들여쓰기
    expect(extractMarkedSql([B, "~~~sql", "select 1;", "~~~~  ", E].join("\n"), [B, "~~~sql", "select 1;", "~~~~  ", E].join("\n"), M)).toBe("select 1;");
    expect(remoteViolations(["```sql", "select 1;", "   ```", "평범한 설명."].join("\n"))).toEqual([]);
  });

  test("🔴 R4 P2-1 — 스캐너의 이빨: astra 의 세 우회(text 펜스의 LOCK · 산문의 명령 · 테스트 절 복사 안내)와 변형을 잡는다", () => {
    const base = ["## 0019 — 예시", "", "원격 확인:", ""];
    const cases: [string, string[]][] = [
      ["text 펜스의 LOCK", [...base, "```text", "LOCK TABLE public.reservations IN ACCESS EXCLUSIVE MODE;", "```"]],
      ["산문의 명령", [...base, "운영에서 LOCK TABLE public.reservations IN ACCESS EXCLUSIVE MODE; 를 실행해 확인한다."]],
      ["테스트 절 복사 안내", [...base, "For production verification, copy section 18 of tests/write-privileges.test.ts into the SQL editor."]],
      ["§ 번호 복사 안내(한국어)", [...base, "§18 을 SQL Editor 에 복사하라."]],
      ["~~~ 펜스", [...base, "~~~sql", "grant maintain on table notices to anon;", "~~~"]],
      ["무표기 펜스의 트리거", [...base, "```", "create trigger t before update on public.reservations for each row execute function f();", "```"]],
      ["인라인 코드의 롤 전환", [...base, "먼저 `set local role anon` 을 친다."]],
      ["sql 펜스의 do 블록", [...base, "```sql", "do $$ begin perform 1; end $$;", "```"]],
      ["sql 펜스의 nextval", [...base, "```sql", "select nextval('public.notices_id_seq');", "```"]],
      ["닫히지 않은 펜스", [...base, "```sql", "select 1;"]],
    ];
    for (const [name, sec] of cases) {
      expect(remoteViolations(sec.join("\n")), name).not.toEqual([]);
    }
    // 로컬 전용 표식이 붙으면 허용 — 블록은 바로 앞 줄, 산문은 같은 줄
    const ok = [
      ...base,
      "⛔ 아래는 로컬 실측 출력이다 — 원격에 붙이지 마라:",
      "```text",
      "[anon → reservations] CREATE TRIGGER 성공",
      "LOCK TABLE public.reservations IN ACCESS EXCLUSIVE MODE;",
      "```",
      "로컬에서 `set local role anon` 으로 쟀다(원격에 붙이지 마라).",
      "revoke 는 실행 롤이 부여한 grant 만 지운다. `CREATE TRIGGER` 는 TRIGGER 권한을 요구한다.",
      "```sql",
      "select has_table_privilege('anon', c.oid, 'MAINTAIN'), p.priv from pg_class c cross join (values ('truncate')) p(priv);",
      "```",
    ];
    expect(remoteViolations(ok.join("\n"))).toEqual([]);
  });

  for (const num of ["0016", "0017", "0018", "0019"] as const) {
    test(`🔴 R4·R5 — ${num} 절 전체(모든 펜스·산문)에 원격에 붙일 수 있는 위험 문장 0 · 테스트 원문 복사 안내 0`, () => {
      const v = remoteViolations(runbookSection(num));
      expect(v, v.join("\n")).toEqual([]);
    });
  }
  for (const num of ["0016", "0017", "0018", "0019"] as const) {
    test(`🔴 ${num} 절의 코드 블록 — sql 은 잠금·DDL·DML·롤 전환·setval/nextval 0개 · 그 밖은 출력(text)·C 인용뿐`, () => {
      const sec = runbookSection(num);
      const blocks = [...sec.matchAll(/```(\w*)\n([\s\S]*?)\n```/g)];
      const sql = blocks.filter((m) => m[1] === "sql");
      expect(sql.length, `${num} 절에 원격 확인 SQL 이 없다`).toBeGreaterThanOrEqual(1);
      for (const [, lang, body] of blocks) {
        expect(["sql", "text", "c"], `${num} 절의 코드 블록 언어가 '${lang}' — 붙여 넣을 SQL 인지 출력인지 알 수 없다`).toContain(lang);
        if (lang !== "sql") continue;
        const hit = remoteScan(body).match(REMOTE_FORBIDDEN);
        expect(hit?.[0] ?? null, `${num} 절의 원격 SQL 블록에 금지 문장이 있다:\n${body}`).toBeNull();
      }
    });

    test(`🔴 ${num} 절 — 로컬 전용 거동 블록을 언급하는 줄은 전부 '원격에 붙이지 마라' 를 말한다`, () => {
      const lines = runbookSection(num)
        .split("\n")
        .filter((l) => l.includes("LOCK_PROBE_SQL") || (/거동/.test(l) && /DO 블록|테스트/.test(l)));
      // 0016 절에는 로컬 전용 거동 블록이 없다(그 절의 테스트 §9 는 행렬뿐) — 경고 줄이 없어도 된다.
      if (num !== "0016") expect(lines.length, `${num} 절에 로컬 전용 경고가 없다`).toBeGreaterThan(0);
      for (const l of lines) expect(l, `원격에 붙이라는 뜻으로 읽힐 수 있다:\n${l}`).toMatch(/원격에 붙이지 마라/);
      expect(runbookSection(num), "옛 안내 문장이 남아 있다").not.toMatch(/원문을 붙인다|원격에 붙여도 되는 이유|거동 DO 블록이 오류 없이|SQL 을 그대로 SQL Editor/);
    });
  }

  test("금지 문장 판정의 이빨 — 옛 안내가 붙이던 LOCK·트리거·시퀀스 블록과 흔한 DDL 을 잡고, 권한 이름 리터럴은 넘긴다", () => {
    for (const bad of [LOCK_PROBE_SQL, "create table public.x (id int);", "grant maintain on table t to anon;", "set local role anon;", "vacuum reservations;", "select setval('s', 1);", "create trigger t before update on public.reservations for each row execute function f();", "select nextval('public.notices_id_seq');"]) {
      expect(remoteScan(bad), bad.slice(0, 60)).toMatch(REMOTE_FORBIDDEN);
    }
    for (const ok of ["select has_table_privilege('anon', c.oid, 'MAINTAIN') from pg_class c;", "select current_setting('server_version_num'), version();", "select 1 from (values ('truncate'),('trigger'),('update')) p(priv);"]) {
      expect(remoteScan(ok)).not.toMatch(REMOTE_FORBIDDEN);
    }
  });

  test("🔴 0017·0018 행렬 SQL 은 테스트의 대상 목록과 같다 (runbook 원문 = §12·§15 실행 원문)", () => {
    const s17 = runbookSql("0017");
    expect(s17).toMatch(/^select\b/i);
    expect(s17).toContain("(values ('public.reservations'),('public.notifications_log')) t(tbl)");
    for (const f of OUTBOX_DEFINER_FNS) expect(s17, f).toContain(`'public.${f}(`);
    // P2-4 — 네 시그니처가 **존재**하는지 단언한다(없으면 나머지 검사가 0행으로 통과한다)
    expect(s17).toContain("where to_regprocedure(s.sig) is null), 'OUTBOX_FN_ALL_PRESENT')");
    expect(s17.match(/\('public\.\w+\([^)]*\)'\)/g)?.length ?? 0, "네 시그니처 목록이 네 곳(존재·보유자·유효·서비스)에 있어야 한다").toBe(16);
    // P1 — NULL proacl 을 기본 ACL 로 읽고, 공개 롤의 유효 EXECUTE 를 따로 본다
    expect(s17).toContain("aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))");
    expect(s17).not.toMatch(/aclexplode\(p\.proacl\)/);
    expect(s17).toContain("'OUTBOX_FN_NO_PUBLIC_ROLE_EXEC'");
    for (const k of ["'PII_BLIND_NONE'", "'ANON_PII_NONE'", "'ADMIN_READ_OK'", "'SERVICE_OK'", "'PII_COLUMN_NONE'", "'PII_PUBLIC_NONE'", "'OUTBOX_FN_ALL_PRESENT'", "'OUTBOX_FN_ONLY_SERVICE'", "'OUTBOX_FN_SERVICE_OK'", "'PII_NO_USER_TRIGGER'"]) {
      expect(s17, k).toContain(k);
    }
    const s18 = runbookSql("0018");
    expect(s18).toMatch(/^select\b/i);
    expect(s18).toContain(`c.relname in (${CONTENT_SEQS.map((s) => `'${s}'`).join(",")})`);
    expect(s18).toContain(`(values ${ALL_SEQS.map((s) => `('public.${s}')`).join(",")}) s(seq)`);
    for (const k of ["'SEQ_NONE'", "'ADMIN_SEQ_OK'", "'SERVICE_SEQ_OK'", "'SEQ_PUBLIC_NONE'", "'SEQ_COUNT '"]) expect(s18, k).toContain(k);
    // 테스트 파일에 같은 행렬의 사본이 남아 있으면 둘이 어긋날 수 있다
    const self = read("tests/write-privileges.test.ts");
    // (1 = 아래 검사식 자신)
    expect(self.match(/'PII_BLIND_LEAK '/g)?.length ?? 0, "0017 행렬 사본이 테스트 파일에 남아 있다").toBe(1);
    expect(self.match(/'SEQ_LEAK '/g)?.length ?? 0, "0018 행렬 사본이 테스트 파일에 남아 있다").toBe(1);
  });

  test("🔴 R5 — 0016 상행·롤백의 함수 EXECUTE 검사는 NULL proacl 을 기본 ACL 로 읽고, 둘 다 공개 롤 유효 EXECUTE 를 거부한다", () => {
    for (const rel of [UP16_SQL, DOWN16_SQL]) {
      const code = sqlCode(rel);
      expect(code, `${rel}: aclexplode(NULL) 은 0행이다`).toContain("aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))");
      expect(code, rel).not.toMatch(/aclexplode\(p\.proacl\)/);
      expect(code, `${rel}: 유효 EXECUTE 거부가 없다`).toMatch(/has_function_privilege\('anon', fn_oid, 'execute'\) or has_function_privilege\('authenticated', fn_oid, 'execute'\)/);
    }
  });

  test("R5 — 소스 의미에 근거한 제외(컨트롤러 승인)마다 PG 소스 경로 주석이 붙어 있다", () => {
    const lineOf = (rel: string, needle: string) => read(rel).split("\n").find((l) => l.includes(needle)) ?? "";
    expect(lineOf(UP17_SQL, "where d.privilege_type = 'TRIGGER'")).toContain("src/backend/commands/trigger.c");
    expect(lineOf(UP17_SQL, "expected := has_table_privilege(role_name, 'public.p0017_probe_tbl', 'TRIGGER');")).toContain("src/backend/commands/trigger.c");
    expect(lineOf(UP18_SQL, "and d.privilege_type <> 'SELECT'")).toContain("src/backend/commands/sequence.c");
    expect(lineOf(UP18_SQL, "and not (q.call = 'setval' and d.privilege_type = 'USAGE')")).toContain("src/backend/commands/sequence.c");
    const up18 = read(UP18_SQL);
    expect(up18.slice(up18.indexOf("expected := case probe_call") - 10, up18.indexOf("when 'setval' then has_sequence_privilege"))).toContain("src/backend/commands/sequence.c");
    expect(lineOf(UP19_SQL, "where d.privilege_type not in ('SELECT', 'MAINTAIN')")).toContain("src/backend/commands/lockcmds.c");
    expect(lineOf(UP19_SQL, "and d.privilege_type <> 'SELECT'")).toContain("src/backend/commands/lockcmds.c");
  });

  test("🔴 R5 — 0016 행렬 SQL 은 runbook 한 곳에 있고, 세 시그니처 존재·NULL ACL·유효 EXECUTE 를 본다", () => {
    const s16 = runbookSql("0016");
    expect(s16).toMatch(/^select\b/i);
    for (const f of PG_TEMP_FIXED_FNS) expect(s16, f).toContain(`('public.${f}(`);
    expect(s16).toContain("where to_regprocedure(s.sig) is null), 'FN_ALL_PRESENT')");
    const sigRe = new RegExp(String.raw`\('public\.(?:${PG_TEMP_FIXED_FNS.join("|")})\([^)]*\)'\)`, "g");
    expect(s16.match(sigRe)?.length ?? 0, "세 시그니처 목록이 다섯 곳(존재·pg_temp·보유자·유효·서비스)에 있어야 한다").toBe(15);
    expect(s16).toContain("aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))");
    expect(s16).not.toMatch(/aclexplode\(p\.proacl\)/);
    expect(s16).not.toMatch(/p\.proname in \(/);
    // R6 P2-2·P2-3 — anon select 생존 · 컬럼 단위 쓰기 · search_path 항목만 파싱
    expect(s16).toContain("has_any_column_privilege('anon', t.tbl, p.priv)");
    expect(s16).toContain("has_any_column_privilege('authenticated', 'public.places', p.priv)");
    expect(s16).toContain("where left(c, 12) = 'search_path='");
    expect(s16, "모든 설정 값을 훑는 pg_temp 판정이 돌아왔다").not.toMatch(/like\s+'%pg_temp%'/i);
    // R7 P2-a — 세 SQL 판정(행렬·0016 ④·롤백)이 같은 공백 집합을 쓴다. 스페이스만 지우는 btrim(x.tok) 은 금지.
    const WS_EXPR = /btrim\(x\.tok, ' ' \|\| chr\(9\) \|\| chr\(10\) \|\| chr\(13\) \|\| chr\(12\)\s+\|\| case when current_setting\('server_version_num'\)::int >= 170000 then chr\(11\) else '' end\)/;
    for (const [name, text] of [
      ["runbook 0016 행렬", s16],
      ["0016 ④", read("supabase/migrations/0016_privileges_rls_cannot_protect.sql")],
      ["0016 롤백", read("supabase/rollbacks/0016_privileges_rls_cannot_protect.down.sql")],
    ] as const) {
      expect(text, name).toMatch(WS_EXPR);
      expect(text, `${name} — 스페이스만 지우는 btrim`).not.toMatch(/btrim\(x\.tok\)/);
      expect(text, `${name} — E'\\v' 는 PG 이스케이프가 아니다`).not.toMatch(/E'[^']*\\v/);
    }
    for (const k of ["'RLS_BLIND_NONE'", "'ANON_SELECT_ONLY'", "'ANON_SELECT_OK'", "'PLACES_WRITE_NONE'", "'PLACES_READ_OK'", "'PG_TEMP_OK'", "'FN_EXEC_ONLY_SERVICE'", "'FN_NO_PUBLIC_ROLE_EXEC'", "'FN_SERVICE_OK'", "'CLAIM_ONE_ARG_GONE'", "'ADMIN_OK'", "'SEQ_OK'"]) {
      expect(s16, k).toContain(k);
    }
    const self = read("tests/write-privileges.test.ts");
    expect(self.match(/'RLS_BLIND_LEAK '/g)?.length ?? 0, "0016 행렬 사본이 테스트 파일에 남아 있다(1 = 이 검사식 자신)").toBe(1);
  });

  test("🔴 행렬 SQL 은 runbook 한 곳에 있고, 카탈로그 질의뿐이며, 롤백 기준선 아홉 표를 그대로 담는다", () => {
    const sql = runbookMatrixSql();
    expect(sql).toMatch(/^select\b/i);
    expect(remoteScan(sql)).not.toMatch(REMOTE_FORBIDDEN);
    for (const needle of ["has_table_privilege(r.role, c.oid, 'MAINTAIN')", "'MAINTAIN_NONE'", "'SERVICE_MAINTAIN_OK'", "'MAINTAIN_PUBLIC_NONE'", "a.grantee = 0", "'BASELINE_PRESENT '"]) {
      expect(sql, needle).toContain(needle);
    }
    const listed = [...(sql.match(/unnest\(array\[([^\]]*)\]\)/)?.[1] ?? "").matchAll(/'public\.(\w+)'/g)].map((m) => m[1]);
    expect(listed).toEqual([...MAINTAIN_BASELINE_TABLES]);
    // 테스트 파일에 같은 행렬의 사본이 따로 있으면 둘이 어긋날 수 있다 — 사본 0
    expect(read("tests/write-privileges.test.ts").match(/'SERVICE_MAINTAIN_LOST '/g)?.length ?? 0, "행렬 SQL 사본이 테스트 파일에 남아 있다").toBe(1);
  });
});
