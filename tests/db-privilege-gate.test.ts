/**
 * P6-11 — **새 객체 권한 자동 게이트** (DB 실증, 로컬 스택).
 *
 * 왜 이 파일이 있나. 이 DB 에는 **새로 만드는 표·시퀀스·함수를 공개 롤에 자동으로 여는 기본 권한**이 있다
 * (`pg_default_acl` — 부여자 `postgres`·`supabase_admin` 둘, 대상 `anon`·`authenticated`·`postgres`·`service_role` 넷,
 * CLAUDE.md §3). 그래서 객체가 생길 때마다 **사람이 기억해서** 회수해야 했고, **다섯 번 놓쳤다**:
 * `admin_users`(→0009) · `reservations` UPDATE(→0010) · `notifications_log` 전부(→0012) · 콘텐츠 7표(→0013·0016) ·
 * 개인정보 2표의 TRIGGER(→0017, 실제로 외부 유출 트리거를 붙여 봤더니 붙었다).
 * **여섯 번째를 사람에게 맡기지 않는다.** 표가 하나 새로 생기면 이 파일이 **그 이름을 대며** 빨개진다.
 * 그리고 첫 실행에서 실제로 그렇게 됐다 — 0012~0017 이 한 번도 회수하지 않은 **시퀀스 36건**을 이름으로 대며 빨개졌고,
 * 허용 목록을 넓히지 않은 채 0018(P5-14)의 회수로 초록이 됐다. 사람보다 기계가 먼저 찾은 첫 사례다.
 *
 * 설계
 * ---------------------------------------------------------------------------
 *  · **열거는 카탈로그에서 한다** (`pg_class`·`pg_proc`·`pg_policy`) — 표 이름을 하드코딩하지 않는다. 그래야 새 객체가
 *    허용 목록에 없다는 이유만으로 자동으로 잡힌다. 하드코딩은 **허용 목록**(아래)에만 있고, 항목마다 사유가 붙는다.
 *  · **권한은 실효값으로 본다** — `has_table_privilege`·`has_sequence_privilege`·`has_function_privilege`(PUBLIC·상속까지 잡는다),
 *    컬럼 단위는 `has_any_column_privilege`, PUBLIC 직접 부여는 `relacl`/`proacl` 을 `aclexplode` 로 풀어 grantee OID 0.
 *    **`information_schema.role_table_grants` 는 쓰지 않는다** — 활성 롤 항목만 보이는 필터된 뷰라 증거가 아니다.
 *    ACL 이 NULL 인 객체는 `acldefault()` 로 채운다 — 함수의 NULL ACL 은 "아무도 없음" 이 아니라 **PUBLIC EXECUTE** 다.
 *  · SQL 은 **사실(fact)만** 뽑고, 판정(허용 목록 대조)은 TypeScript 가 한다. 같은 판정 함수를 이빨 실측(§3)에도 쓴다 —
 *    "게이트가 이것을 잡는가" 를 게이트와 **같은 코드**로 확인하기 위해서다.
 *  · 이빨 실측은 **되돌려지는 트랜잭션 안에서** 한다: `do $$ … 임시 객체 생성 … 사실 수집 … raise exception $$`.
 *    예외가 트랜잭션 전체를 되돌리므로 임시 객체는 **커밋되지 않는다** — 다른 세션(병렬 테스트)은 그것을 보지 못하고,
 *    테스트가 중간에 죽어도 흔적이 남지 않는다. 마지막에 흔적이 없음을 다시 확인한다.
 *
 * 잠금: 이 파일은 `notifications_log`·`gallery` 에 **쓰지 않는다**(카탈로그 읽기 + 되돌려지는 DDL 뿐).
 * 그런데도 `withNotificationsLock()` 을 잡는 이유 — 허용 목록에 관리자 확정 함수의 **이름**이 들어 있어
 * `db-test-preconditions` 의 완전성 게이트(문자열 휴리스틱)가 이 파일을 아웃박스 사용자로 분류한다.
 * 휴리스틱을 속이는 표기(이름 쪼개기 등)보다 잠금 하나가 싸고 정직하다. 갤러리 마커(`/gallery` REST 경로·공개 읽기 호출)는
 * 이 파일에 없으므로 갤러리 잠금은 잡지 않는다.
 *
 * tests/ 아래라 게이트 3종의 검사 대상이다 — 금지어·임시값 마커 리터럴을 그대로 쓰지 않는다.
 */
import { beforeAll, describe, expect, test } from "vitest";

import { withNotificationsLock } from "./helpers/db-lock";
import { dbWriteGate } from "./helpers/load-env-local";
import { runLocalSql, runLocalSqlExpectingError } from "./helpers/local-stack-sql";

const gate = dbWriteGate();

// =============================================================================
// 허용 목록 — 항목마다 사유 한 줄. **넓혀서 통과시키지 마라**: 빨개졌다면 그것이 진짜 구멍일 수 있다.
// =============================================================================
type Reasoned = Readonly<Record<string, string>>;

/** `anon` 이 SELECT 할 수 있는 표 — 공개 사이트가 anon 키로 읽는 표면. 전부 `…_select_active` 정책(RLS)이 행을 거른다. */
const ANON_SELECT: Reasoned = {
  notices: "공지 목록·상세 (0001 notices_select_active)",
  popups: "홈 팝업 — KST 게시 기간 안의 활성 행만 (0004 popups_select_active)",
  gallery: "갤러리 사진 — 활성 앨범의 활성 사진만 (0008 gallery_select_active)",
  gallery_albums: "갤러리 앨범 목록 (0008 gallery_albums_select_active)",
  showcase_routes: "홈 대표 노선 16개 정적 표시 (0001 showcase_routes_select_active)",
  vehicles: "차량 소개 (0001 vehicles_select_active)",
  places: "위저드 장소 선택지 (0002 places_select_active)",
};

/** `authenticated` 가 SELECT 할 수 있는 표 — 공개 표면(위 7표) + 관리자 화면이 읽는 개인정보 2표(0009 `is_admin()` 정책). */
const AUTH_SELECT: Reasoned = {
  ...ANON_SELECT,
  reservations: "관리자 예약 목록 — 0009 reservations_admin_select (is_admin)",
  notifications_log: "관리자 발송 내역 — 0009 notifications_log_admin_select (is_admin)",
};

/**
 * `authenticated` 가 INSERT·UPDATE·DELETE 할 수 있는 표 — **관리자 쓰기 정책(0009 `…_admin_all`)이 있는 콘텐츠 6표만.**
 * 게이트는 목록에 더해 **그 동작을 허용하는 정책이 카탈로그에 실제로 있는지**도 본다(정책 없는 쓰기 권한 = RLS 만 믿는 상태).
 */
const AUTH_WRITE_REASON = "관리자 콘텐츠 편집(P5-4~6·P6-2) — 0009 …_admin_all 정책 (is_admin)";
const AUTH_WRITE: Readonly<Record<string, readonly string[]>> = {
  notices: ["insert", "update", "delete"],
  popups: ["insert", "update", "delete"],
  gallery: ["insert", "update", "delete"],
  gallery_albums: ["insert", "update", "delete"],
  showcase_routes: ["insert", "update", "delete"],
  vehicles: ["insert", "update", "delete"],
};

/**
 * 시퀀스 — 관리자 insert 가 `serial` 기본값(nextval)을 부르려면 USAGE 가 필요하다. 그 밖(SELECT·UPDATE=setval)은 필요 없다.
 * **이 게이트가 첫 실행에서 찾은 36건**(공개 7개 시퀀스의 anon usage·select·update, authenticated select·update,
 * `notifications_log_id_seq` 의 authenticated usage)을 0018 이 회수했다. 목록은 그때도 지금도 **이 여섯 항목뿐**이다 —
 * 넓혀서 통과시키지 않고 회수로 초록이 됐다. `notifications_log_id_seq` 는 여기 없다: 그 표에 넣는 것은 서비스 롤과
 * 소유자 권한으로 도는 definer 함수뿐이다.
 */
const SEQ_REASON = "관리자 insert 의 serial 기본값 nextval (0009 §6 의 grant · 0016 ⑧ SEQ_OK · 0018 이 이것만 남기고 회수)";
const SEQ_ALLOW: Readonly<Record<string, readonly string[]>> = {
  "notices_id_seq|authenticated": ["usage"],
  "popups_id_seq|authenticated": ["usage"],
  "gallery_id_seq|authenticated": ["usage"],
  "gallery_albums_id_seq|authenticated": ["usage"],
  "showcase_routes_id_seq|authenticated": ["usage"],
  "vehicles_id_seq|authenticated": ["usage"],
};

/** `anon` 이 EXECUTE 할 수 있는 public 함수 — **없다.** 공개 경로(접수·발송·파기)는 전부 서비스 롤이다. */
const ANON_EXEC: Reasoned = {};

/** `authenticated` 가 EXECUTE 할 수 있는 public 함수 — 시그니처까지 고정한다(drop+create 로 바뀌면 ACL 이 초기화되기 때문). */
const AUTH_EXEC: Reasoned = {
  "admin_confirm_reservation(uuid,text)": "관리자 예약 확정 전이 (0010, definer · 내부 is_admin 검사)",
  "admin_cancel_reservation(uuid,text)": "관리자 예약 취소 전이 (0010)",
  "admin_complete_reservation(uuid,text)": "관리자 예약 완료 전이 (0010)",
  "admin_update_memo(uuid,text)": "관리자 메모 수정 (0010)",
  "is_admin()": "RLS 정책이 부르는 관리자 판정 (0009) — 정책 평가가 호출자 권한으로 돈다",
};

/** 객체 소유자 — 마이그레이션은 `postgres` 로 적용된다. 공개 롤이 소유하면 권한 회수가 의미를 잃는다. */
const OWNERS: Reasoned = { postgres: "supabase db push / SQL Editor 의 적용 롤" };

// =============================================================================
// 사실 수집 SQL — 카탈로그 전수. 한 행 한 열, base64 로 감싼다(CLI 출력 형식 text/json 과 무관하게 읽기 위해).
// =============================================================================
const SENTINEL_B = "@@P611_FACTS_B@@";
const SENTINEL_E = "@@P611_FACTS_E@@";

/** `f` 한 열을 내는 WITH 질의. 서브쿼리로도 쓴다(이빨 실측의 DO 블록 안). */
const FACTS_QUERY = [
  "with roles(role) as (values ('anon'), ('authenticated')),",
  "rels as (",
  "  select c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity",
  "  from pg_class c join pg_namespace n on n.oid = c.relnamespace",
  "  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')",
  "),",
  "fns as (",
  "  select p.oid, p.proowner, p.proacl, p.prosecdef, p.proconfig",
  "  from pg_proc p join pg_namespace n on n.oid = p.pronamespace",
  "  where n.nspname = 'public'",
  "),",
  "facts(f) as (",
  // 표·뷰 — 표 단위 7종
  "  select format('table|%s|%s|%s', r.relname, ro.role, p.priv)",
  "  from rels r cross join roles ro",
  "  cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('trigger'), ('references')) p(priv)",
  "  where r.relkind <> 'S' and has_table_privilege(ro.role, r.oid, p.priv)",
  "  union all",
  // 컬럼 단위 — 표 단위에는 없는데 어느 컬럼에는 있는 권한(표 단위 revoke 가 지우지 못하는 경로).
  // delete·truncate·trigger 는 표 전용 권한이라 넣으면 22023 으로 죽는다(0016 이 한 번 걸렸다).
  "  select format('column|%s|%s|%s', r.relname, ro.role, p.priv)",
  "  from rels r cross join roles ro",
  "  cross join (values ('select'), ('insert'), ('update'), ('references')) p(priv)",
  "  where r.relkind <> 'S' and has_any_column_privilege(ro.role, r.oid, p.priv)",
  "    and not has_table_privilege(ro.role, r.oid, p.priv)",
  "  union all",
  "  select format('sequence|%s|%s|%s', r.relname, ro.role, p.priv)",
  "  from rels r cross join roles ro",
  "  cross join (values ('usage'), ('select'), ('update')) p(priv)",
  "  where r.relkind = 'S' and has_sequence_privilege(ro.role, r.oid, p.priv)",
  "  union all",
  "  select format('function|%s|%s|execute', f.oid::regprocedure, ro.role)",
  "  from fns f cross join roles ro",
  "  where has_function_privilege(ro.role, f.oid, 'execute')",
  "  union all",
  "  select format('definer|%s|%s', f.oid::regprocedure, coalesce((select c from unnest(f.proconfig) c where c like 'search_path=%' limit 1), 'search_path=(none)'))",
  "  from fns f where f.prosecdef",
  "  union all",
  "  select format('public_acl|%s|%s', r.relname, a.privilege_type)",
  "  from rels r",
  "  cross join lateral aclexplode(coalesce(r.relacl, acldefault(case when r.relkind = 'S' then 's' else 'r' end::\"char\", r.relowner))) a",
  "  where a.grantee = 0",
  "  union all",
  "  select format('public_fn_acl|%s|%s', f.oid::regprocedure, a.privilege_type)",
  "  from fns f cross join lateral aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a",
  "  where a.grantee = 0",
  "  union all",
  "  select format('schema_create|public|%s', ro.role) from roles ro where has_schema_privilege(ro.role, 'public', 'create')",
  "  union all",
  "  select format('owner|%s|%s|%s', r.relname, r.relkind, pg_get_userbyid(r.relowner)) from rels r",
  "  union all",
  "  select format('fnowner|%s|%s', f.oid::regprocedure, pg_get_userbyid(f.proowner)) from fns f",
  "  union all",
  "  select format('rls|%s|%s', r.relname, case when r.relrowsecurity then 'on' else 'off' end) from rels r where r.relkind in ('r', 'p')",
  "  union all",
  "  select format('policy|%s|%s|%s', r.relname, pol.polcmd, case when x.role_oid = 0 then 'PUBLIC' else pg_get_userbyid(x.role_oid) end)",
  "  from pg_policy pol join rels r on r.oid = pol.polrelid",
  "  cross join lateral unnest(pol.polroles) x(role_oid)",
  ")",
  "select f from facts",
].join("\n");

const encodeFacts = (inner: string) =>
  `'${SENTINEL_B}' || translate(encode(convert_to(coalesce((${inner}), ''), 'UTF8'), 'base64'), E'\\n', '') || '${SENTINEL_E}'`;

const FACTS_SQL = `select ${encodeFacts(`select string_agg(q.f, ';' order by q.f) from (${FACTS_QUERY}) q`)} as facts;`;

function parseFacts(output: string): string[] {
  const m = output.match(new RegExp(`${SENTINEL_B}([A-Za-z0-9+/=]*)${SENTINEL_E}`));
  if (!m) throw new Error(`사실 수집 출력에서 표식을 찾지 못했다 — CLI 출력 형식이 바뀌었나?\n${output.slice(0, 800)}`);
  return Buffer.from(m[1], "base64")
    .toString("utf8")
    .split(";")
    .filter((f) => f.length > 0);
}

// =============================================================================
// 판정 — 사실 목록 → 위반 목록(사람이 읽는 문장, 객체 이름이 맨 앞에 온다)
// =============================================================================
const POLICY_CMD: Record<string, string> = { insert: "a", update: "w", delete: "d", select: "r" };

function evaluate(facts: readonly string[]): string[] {
  const rows = facts.map((f) => f.split("|"));
  const policies = new Set(
    rows.filter((r) => r[0] === "policy" && (r[3] === "authenticated" || r[3] === "PUBLIC")).map((r) => `${r[1]}|${r[2]}`),
  );
  const hasAuthPolicy = (table: string, priv: string) =>
    policies.has(`${table}|${POLICY_CMD[priv]}`) || policies.has(`${table}|*`);
  const rlsOff = new Set(rows.filter((r) => r[0] === "rls" && r[2] === "off").map((r) => r[1]));
  const exposed = new Set<string>();
  const out: string[] = [];

  for (const r of rows) {
    const [kind, obj, a, b] = r;
    switch (kind) {
      case "table": {
        const role = a;
        const priv = b;
        exposed.add(obj);
        if (role === "anon") {
          if (priv === "select" && obj in ANON_SELECT) break;
          out.push(`${obj} — 표: anon 에게 ${priv} (허용 목록 밖)`);
        } else if (role === "authenticated") {
          if (priv === "select" && obj in AUTH_SELECT) break;
          if (["insert", "update", "delete"].includes(priv) && AUTH_WRITE[obj]?.includes(priv)) {
            if (!hasAuthPolicy(obj, priv)) out.push(`${obj} — 표: authenticated 의 ${priv} 를 허용하는 정책이 없다 (RLS 만 믿는 쓰기 권한)`);
            break;
          }
          out.push(`${obj} — 표: authenticated 에게 ${priv} (허용 목록 밖)`);
        }
        break;
      }
      case "column":
        exposed.add(obj);
        out.push(`${obj} — 컬럼 단위: ${a} 에게 일부 컬럼 ${b} (표 단위 revoke 가 지우지 못하는 경로)`);
        break;
      case "sequence":
        if (SEQ_ALLOW[`${obj}|${a}`]?.includes(b)) break;
        out.push(`${obj} — 시퀀스: ${a} 에게 ${b} (허용 목록 밖)`);
        break;
      case "function": {
        const allow = a === "anon" ? ANON_EXEC : AUTH_EXEC;
        if (obj in allow) break;
        out.push(`${obj} — 함수: ${a} 에게 EXECUTE (허용 목록 밖)`);
        break;
      }
      case "definer": {
        const config = r.slice(2).join("|");
        const searchPath = config.startsWith("search_path=") ? config.slice("search_path=".length) : "";
        if (!/\bpg_temp\b/.test(searchPath)) {
          out.push(`${obj} — definer 함수: search_path 에 pg_temp 가 없다 (${config}) — 임시 스키마 섀도잉`);
        }
        break;
      }
      case "public_acl":
        out.push(`${obj} — PUBLIC 에 ${a} 가 직접 부여돼 있다 (표 단위 revoke 로 지워지지 않는다)`);
        break;
      case "public_fn_acl":
        out.push(`${obj} — 함수: PUBLIC 에 ${a} 가 부여돼 있다`);
        break;
      case "schema_create":
        out.push(`public 스키마 — ${a} 에게 CREATE`);
        break;
      case "owner":
        if (!(b in OWNERS)) out.push(`${obj} — 소유자가 ${b} 다 (허용: ${Object.keys(OWNERS).join(", ")})`);
        break;
      case "fnowner":
        if (!(a in OWNERS)) out.push(`${obj} — 함수 소유자가 ${a} 다 (허용: ${Object.keys(OWNERS).join(", ")})`);
        break;
      default:
        break;
    }
  }
  for (const t of exposed) {
    if (rlsOff.has(t)) out.push(`${t} — 공개 롤에 권한이 있는데 RLS 가 꺼져 있다`);
  }
  return [...new Set(out)].sort();
}

/** 허용 목록의 항목이 **실제로 존재하는 권한**인가 — 죽은 예외 금지. 반환: 사실에 없는 항목들. */
function deadAllowances(facts: readonly string[]): string[] {
  const has = new Set(facts);
  const dead: string[] = [];
  for (const t of Object.keys(ANON_SELECT)) if (!has.has(`table|${t}|anon|select`)) dead.push(`ANON_SELECT ${t}`);
  for (const t of Object.keys(AUTH_SELECT)) if (!has.has(`table|${t}|authenticated|select`)) dead.push(`AUTH_SELECT ${t}`);
  for (const [t, privs] of Object.entries(AUTH_WRITE)) {
    for (const p of privs) if (!has.has(`table|${t}|authenticated|${p}`)) dead.push(`AUTH_WRITE ${t}/${p}`);
  }
  for (const [key, privs] of Object.entries(SEQ_ALLOW)) {
    const [seq, role] = key.split("|");
    for (const p of privs) if (!has.has(`sequence|${seq}|${role}|${p}`)) dead.push(`SEQ_ALLOW ${seq}/${role}/${p}`);
  }
  for (const f of Object.keys(ANON_EXEC)) if (!has.has(`function|${f}|anon|execute`)) dead.push(`ANON_EXEC ${f}`);
  for (const f of Object.keys(AUTH_EXEC)) if (!has.has(`function|${f}|authenticated|execute`)) dead.push(`AUTH_EXEC ${f}`);
  return dead;
}

const byKind = (violations: readonly string[], marker: string) => violations.filter((v) => v.includes(marker));

// =============================================================================
// 0. 순수 — 허용 목록 자체의 신선도·사유
// =============================================================================
describe("0. 허용 목록 — 사유 필수 · 비어 있지 않음(의도적 빈 목록은 명시)", () => {
  test("모든 항목에 사유가 한 줄 이상 있다", () => {
    for (const [name, list] of Object.entries({ ANON_SELECT, AUTH_SELECT, ANON_EXEC, AUTH_EXEC, OWNERS })) {
      for (const [k, why] of Object.entries(list)) expect(why.trim().length, `${name}.${k} 의 사유가 비었다`).toBeGreaterThan(5);
    }
    expect(AUTH_WRITE_REASON.length).toBeGreaterThan(5);
    expect(SEQ_REASON.length).toBeGreaterThan(5);
  });

  test("허용 목록이 비어 있지 않다 — 비면 '전부 금지' 가 아니라 판정이 무의미해진 것일 수 있다", () => {
    expect(Object.keys(ANON_SELECT).length).toBeGreaterThan(0);
    expect(Object.keys(AUTH_SELECT).length).toBeGreaterThan(Object.keys(ANON_SELECT).length);
    expect(Object.keys(AUTH_WRITE).length).toBeGreaterThan(0);
    expect(Object.keys(SEQ_ALLOW).length).toBeGreaterThan(0);
    expect(Object.keys(AUTH_EXEC).length).toBeGreaterThan(0);
  });

  test("anon 이 실행할 수 있는 함수는 **의도적으로 0** 이다", () => {
    expect(ANON_EXEC).toEqual({});
  });

  test("판정 자체의 이빨 — 합성 사실에서 허용 목록 밖을 이름으로 잡는다", () => {
    const v = evaluate([
      "table|new_table|anon|select",
      "table|notices|anon|insert",
      "table|reservations|authenticated|truncate",
      "table|notices|authenticated|insert",
      "policy|notices|*|authenticated",
      "table|places|authenticated|update",
      "column|reservations|anon|update",
      "sequence|new_seq|anon|usage",
      "function|new_fn()|anon|execute",
      "definer|new_def()|search_path=public",
      "definer|ok_def()|search_path=public, pg_temp",
      "public_acl|new_table|SELECT",
      "owner|new_table|r|anon",
      "rls|new_table|off",
    ]);
    const text = v.join("\n");
    for (const needle of ["new_table — 표: anon 에게 select", "notices — 표: anon 에게 insert", "reservations — 표: authenticated 에게 truncate", "places — 표: authenticated 에게 update", "reservations — 컬럼 단위", "new_seq — 시퀀스", "new_fn() — 함수", "new_def() — definer", "new_table — PUBLIC", "new_table — 소유자", "new_table — 공개 롤에 권한이 있는데 RLS 가 꺼져"]) {
      expect(text, needle).toContain(needle);
    }
    expect(text).not.toContain("notices — 표: authenticated");
    expect(text).not.toContain("ok_def()");
  });

  test("정책 없는 쓰기 권한은 허용 목록에 있어도 잡힌다", () => {
    expect(evaluate(["table|notices|authenticated|delete"]).join("\n")).toContain("notices — 표: authenticated 의 delete 를 허용하는 정책이 없다");
    expect(evaluate(["table|notices|authenticated|delete", "policy|notices|d|PUBLIC"])).toEqual([]);
  });
});

// =============================================================================
// 1·2. DB — 현재 스키마 전수 (로컬 스택, 0017 까지 적용된 상태)
// =============================================================================
describe.skipIf(!gate.allowed)("1. DB — public 스키마 전수 권한 게이트 (로컬 스택)", { timeout: 300_000 }, () => {
  // 쓰기 없음 — 헤더의 "잠금" 절 참고(완전성 게이트 휴리스틱이 허용 목록의 함수 이름을 본다).
  withNotificationsLock();

  let facts: string[] = [];
  let violations: string[] = [];

  beforeAll(() => {
    facts = parseFacts(runLocalSql(FACTS_SQL));
    violations = evaluate(facts);
  }, 300_000);

  test("열거가 실제로 일어났다 — 카탈로그에서 표·함수·정책을 읽었다(빈 결과로 통과하지 않는다)", () => {
    const kinds = new Set(facts.map((f) => f.split("|")[0]));
    for (const k of ["table", "owner", "fnowner", "rls", "policy", "function", "definer", "sequence"]) {
      expect(kinds, `사실 종류 ${k} 가 하나도 없다`).toContain(k);
    }
    const tables = facts.filter((f) => f.startsWith("owner|") && f.split("|")[2] === "r").map((f) => f.split("|")[1]);
    expect(tables.length, tables.join(", ")).toBeGreaterThanOrEqual(10);
    expect(tables).toContain("reservations");
    expect(tables).toContain("admin_users");
  });

  test("표 — anon 은 허용 목록의 SELECT 만 · authenticated 는 허용 목록의 SELECT 와 정책 있는 쓰기만", () => {
    const v = byKind(violations, " — 표:");
    expect(v, `허용 목록 밖의 표 권한:\n${v.join("\n")}`).toEqual([]);
  });

  test("컬럼 단위 권한 0 · PUBLIC 직접 부여 0 (표·함수) · public 스키마 CREATE 0", () => {
    const v = [
      ...byKind(violations, " — 컬럼 단위"),
      ...byKind(violations, "PUBLIC 에"),
      ...byKind(violations, "public 스키마 —"),
    ];
    expect(v, v.join("\n")).toEqual([]);
  });

  test("시퀀스 — 공개 롤은 허용 목록(관리자 insert 의 nextval)만", () => {
    const v = byKind(violations, " — 시퀀스:");
    expect(v, `허용 목록 밖의 시퀀스 권한 ${v.length}건:\n${v.join("\n")}`).toEqual([]);
  });

  test("함수 — anon EXECUTE 0 · authenticated 는 허용 목록만 · definer 는 전부 search_path 에 pg_temp", () => {
    const v = [...byKind(violations, " — 함수:"), ...byKind(violations, " — definer 함수")];
    expect(v, v.join("\n")).toEqual([]);
  });

  test("소유자는 적용 롤뿐 · 공개 롤에 권한이 있는 표는 전부 RLS 켜짐", () => {
    const v = [...byKind(violations, "소유자가"), ...byKind(violations, "RLS 가 꺼져")];
    expect(v, v.join("\n")).toEqual([]);
  });

  test("판정이 분류하지 못한 위반이 없다 (위 다섯 묶음의 합 = 전체)", () => {
    const covered = new Set([
      ...byKind(violations, " — 표:"),
      ...byKind(violations, " — 컬럼 단위"),
      ...byKind(violations, "PUBLIC 에"),
      ...byKind(violations, "public 스키마 —"),
      ...byKind(violations, " — 시퀀스:"),
      ...byKind(violations, " — 함수:"),
      ...byKind(violations, " — definer 함수"),
      ...byKind(violations, "소유자가"),
      ...byKind(violations, "RLS 가 꺼져"),
    ]);
    expect(violations.filter((v) => !covered.has(v))).toEqual([]);
  });

  test("허용 목록의 모든 항목이 실제로 존재한다 — 죽은 예외 금지", () => {
    const dead = deadAllowances(facts);
    expect(dead, `존재하지 않는 권한을 허용하고 있다 — 목록에서 지울 것:\n${dead.join("\n")}`).toEqual([]);
  });

  test("이빨 실측의 흔적이 없다 — 임시 객체 이름이 카탈로그에 없다", () => {
    expect(facts.filter((f) => f.includes("p611_gate_probe"))).toEqual([]);
  });
});

// =============================================================================
// 3. 이빨 — 기본 권한 그대로 만든 임시 객체를 게이트가 **이름으로** 잡는가 (되돌려지는 트랜잭션)
// =============================================================================
describe.skipIf(!gate.allowed)("3. DB — 이빨 실측: 회수 없이 만든 임시 객체 (되돌림)", { timeout: 300_000 }, () => {
  withNotificationsLock();

  const PROBE_SQL = [
    "do $p611$",
    "declare payload text;",
    "begin",
    // ① 회수 없이 — 기본 권한(pg_default_acl) 그대로의 표 + serial 시퀀스
    "  create table public.p611_gate_probe (id serial primary key, note text);",
    // ② 기본 권한은 회수했지만 컬럼 단위 grant 와 PUBLIC grant 가 남은 표
    "  create table public.p611_gate_probe_col (id int, note text);",
    "  alter table public.p611_gate_probe_col enable row level security;",
    "  revoke all on table public.p611_gate_probe_col from anon, authenticated, service_role;",
    "  grant update (note) on public.p611_gate_probe_col to anon;",
    "  grant select on public.p611_gate_probe_col to public;",
    // ③ definer 함수, search_path 에 pg_temp 없음, EXECUTE 회수 없음
    "  create function public.p611_gate_probe_fn() returns int language sql security definer",
    "    set search_path = public as $fn$ select 1 $fn$;",
    `  select string_agg(q.f, ';' order by q.f) into payload from (${FACTS_QUERY}) q where q.f like '%p611_gate_probe%';`,
    `  raise exception '%', ${encodeFacts("select payload")};`,
    "end",
    "$p611$;",
  ].join("\n");

  let probeFacts: string[] = [];
  let probeViolations: string[] = [];

  beforeAll(() => {
    probeFacts = parseFacts(runLocalSqlExpectingError(PROBE_SQL));
    probeViolations = evaluate(probeFacts);
  }, 300_000);

  test("임시 객체의 사실이 수집됐다 (탐침이 실제로 돌았다)", () => {
    expect(probeFacts.some((f) => f.startsWith("owner|p611_gate_probe|r|"))).toBe(true);
    expect(probeFacts.some((f) => f.startsWith("fnowner|p611_gate_probe_fn()|"))).toBe(true);
  });

  test("새 표 — 이름을 대며 빨개진다 (anon 쓰기·authenticated TRUNCATE/TRIGGER/REFERENCES)", () => {
    const text = probeViolations.join("\n");
    for (const needle of [
      "p611_gate_probe — 표: anon 에게 select",
      "p611_gate_probe — 표: anon 에게 insert",
      "p611_gate_probe — 표: anon 에게 truncate",
      "p611_gate_probe — 표: authenticated 에게 trigger",
      "p611_gate_probe — 표: authenticated 에게 insert",
    ]) {
      expect(text, `${needle} 를 못 잡았다:\n${text}`).toContain(needle);
    }
  });

  test("새 시퀀스 — 이름을 대며 빨개진다", () => {
    expect(probeViolations.join("\n")).toContain("p611_gate_probe_id_seq — 시퀀스: anon 에게 usage");
  });

  test("컬럼 단위 grant · PUBLIC grant — 표 단위를 회수해도 잡힌다", () => {
    const text = probeViolations.join("\n");
    expect(text).toContain("p611_gate_probe_col — 컬럼 단위: anon 에게 일부 컬럼 update");
    expect(text).toContain("p611_gate_probe_col — PUBLIC 에 SELECT");
    expect(text, "PUBLIC 을 통해 상속된 select 도 anon 의 실효 권한으로 보인다").toContain("p611_gate_probe_col — 표: anon 에게 select");
  });

  test("새 definer 함수 — EXECUTE 공개 · pg_temp 누락을 이름으로 잡는다", () => {
    const text = probeViolations.join("\n");
    expect(text).toContain("p611_gate_probe_fn() — 함수: anon 에게 EXECUTE");
    expect(text).toContain("p611_gate_probe_fn() — 함수: authenticated 에게 EXECUTE");
    expect(text).toContain("p611_gate_probe_fn() — definer 함수: search_path 에 pg_temp 가 없다");
  });

  test("되돌림 확인 — 탐침 뒤 카탈로그에 임시 객체가 하나도 없다", () => {
    const after = parseFacts(runLocalSql(FACTS_SQL));
    expect(after.filter((f) => f.includes("p611_gate_probe"))).toEqual([]);
  });
});
