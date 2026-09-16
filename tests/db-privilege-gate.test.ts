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
 *  · 🔴 **권한 종류도 카탈로그에서 열거한다** (P5-15). 처음 판은 객체는 열거하면서 **권한 종류는 하드코딩**했다
 *    (`values ('select'), ('insert'), … ('references')`). PostgreSQL 17 이 표 권한 `MAINTAIN`(VACUUM·ANALYZE·CLUSTER·
 *    REINDEX·**LOCK TABLE** — RLS 밖)을 더하자 게이트는 그것을 볼 수단이 없었고, 공개 9표 × 두 공개 롤에 열려 있는
 *    `MAINTAIN` 을 **초록으로 통과**시켰다(원칙을 절반만 지킨 결과 — 여섯 번째 사례). 이제 종류는 두 곳에서 얻는다:
 *      (a) `acldefault(<종류>, 소유자)` — **이 서버가 그 객체 종류에 대해 아는 권한 전부**(버전이 권한을 더하면 여기 나타난다)
 *      (b) 실제 ACL(`relacl`·`attacl`·`proacl`)을 `aclexplode` 로 펼쳐 나온 종류 — 어떤 grantee 든
 *    그리고 두 관점을 모두 본다:
 *      (가) **ACL 관점** — 공개 롤에 **직접** 부여된 항목 전부(`acl|…` 사실)를 허용 목록과 대조한다
 *      (나) **유효값 관점** — (a)∪(b) 의 **모든 종류**에 대해 `has_*_privilege` 로 실효값(PUBLIC·멤버십 상속 포함)을 본다
 *    (가)에 있는데 (나)에 없는 항목은 그 자체로 빨강이다(두 관점이 어긋나면 판정을 믿을 수 없다).
 *    **이 파일의 SQL 에 권한 종류 목록 리터럴을 쓰지 마라** — §0 의 텍스트 이빨이 그것을 잡는다.
 *    (컬럼 단위는 `acldefault('c', …)` 가 비어 있다 — 컬럼 권한은 `attacl` 에만 존재하므로 (b) 만으로 완전하다.)
 *  · **astra 수정 라운드 (P5-15 · GPT 독립 리뷰)** — 넓힌 범위:
 *      - 대상 스키마는 `public` 하드코딩이 아니라 **supabase/config.toml `[api] schemas`**(= PostgREST 노출 목록, 지금 public·graphql_public).
 *        graphql_public 의 프레임워크 함수는 `FRAMEWORK_FNS` 에 이름·시그니처·소유자로 고정했다.
 *      - **grant option** — ACL 관점은 `is_grantable` 을 보존하고, 유효값 관점은 `has_*_privilege(…, '<종류> WITH GRANT OPTION')`.
 *      - **공개 롤 자체** — `pg_roles` 의 불리언 속성 전부(to_jsonb 로 열거) · `pg_db_role_setting` 설정 키 ·
 *        `pg_auth_members` 로 도달하는 롤(재귀, 간선 옵션 admin·inherit·set 을 통째로). 객체 ACL 이 멀쩡해도 BYPASSRLS 하나로 RLS 가 꺼진다.
 *      - **스키마 USAGE·CREATE 전 종류**, **사용자 타입 USAGE**(enum·domain·range·독립 composite), **large object 수**(전역 0).
 *      - 허용 목록 조회는 전부 `Object.hasOwn` — `in`·인덱싱은 `constructor`·`__proto__` 를 허용으로 읽었다(재현 테스트 §0).
 *    **여전히 보지 않는 것(경계)**: DB 단위 권한(CONNECT·TEMPORARY — 공개 롤에 필요), 언어·FDW·foreign server,
 *    설정 파라미터 ACL(`pg_parameter_acl`), large object **개별 ACL**(개수 0 을 단언하는 것으로 갈음), 노출되지 않은 스키마
 *    (`extensions`·`auth`·`storage` 등 — Supabase 소유, 이 저장소의 마이그레이션이 만들지 않는다), 표의 행 타입·배열 타입(표 권한을 따른다).
 *    "전수" 는 **노출 스키마 안의 표·뷰·시퀀스·함수·컬럼·스키마·사용자 타입 + 공개 롤 자체** 에 대한 말이다.
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
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";

import { withNotificationsLock } from "./helpers/db-lock";
import { dbWriteGate } from "./helpers/load-env-local";
import { runLocalSql, runLocalSqlExpectingError, runLocalSuperuserSqlExpectingError } from "./helpers/local-stack-sql";

const gate = dbWriteGate();

/**
 * astra P1-5 — **API 에 노출되는 스키마**. 하드코딩하지 않고 supabase/config.toml `[api] schemas` 에서 읽는다
 * (PostgREST 가 실제로 노출하는 목록과 같은 원천). 파싱에 실패하면 게이트 전체가 실패한다 — 조용히 public 만 보지 않는다.
 */
/**
 * `[api] schemas = [ … ]` 를 **토큰 단위로** 읽는다 (astra R2 P2-C).
 * 처음 판은 정규식이 `"소문자"` 원소만 골라 `'secret_api'`·`"PrivateAPI"` 를 **조용히 빠뜨렸다**(원소가 0개일 때만 throw).
 * 지금은 배열 끝 `]` 까지 한 글자씩 훑어 — 공백·줄바꿈·쉼표·`#` 주석·큰따옴표 문자열(이스케이프 포함)·작은따옴표 리터럴 문자열 —
 * 그 밖의 글자가 하나라도 나오면 throw 한다. 빈 문자열·빈 배열·닫히지 않은 배열/문자열도 throw 한다.
 * 식별자 대소문자는 그대로 둔다(PostgREST 는 스키마 이름을 그대로 쓴다 — 게이트는 `nspname = any(...)` 로 정확히 대조한다).
 */
function parseExposedSchemas(toml: string): string[] {
  const fail = (why: string): never => {
    throw new Error(`supabase/config.toml [api] schemas 를 해석하지 못한다 — ${why} (노출 스키마를 모르면 게이트가 성립하지 않는다)`);
  };
  const lines = toml.replace(/\r\n/g, "\n").split("\n");
  const head = lines.findIndex((l) => /^\s*\[api\]\s*(#.*)?$/.test(l));
  if (head === -1) fail("[api] 절이 없다");
  let end = lines.findIndex((l, i) => i > head && /^\s*\[/.test(l));
  if (end === -1) end = lines.length;
  const body = lines.slice(head + 1, end).join("\n");
  const key = body.match(/^\s*schemas\s*=\s*\[/m);
  if (!key || key.index === undefined) return fail("schemas 키가 없다");
  const s = body.slice(key.index + key[0].length);
  const out: string[] = [];
  let i = 0;
  let expectValue = true;
  for (;;) {
    if (i >= s.length) fail("배열이 닫히지 않았다");
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n") {
      i++;
    } else if (c === "#") {
      const nl = s.indexOf("\n", i);
      i = nl === -1 ? s.length : nl;
    } else if (c === "]") {
      break;
    } else if (c === ",") {
      if (expectValue) fail(`${out.length + 1}번째 자리에 값 없이 쉼표가 있다`);
      expectValue = true;
      i++;
    } else if (c === '"' || c === "'") {
      if (!expectValue) fail(`${out.length}번째 원소 뒤에 쉼표가 없다`);
      let j = i + 1;
      let v = "";
      for (;;) {
        if (j >= s.length || s[j] === "\n") fail(`${out.length + 1}번째 문자열이 닫히지 않았다`);
        const d = s[j];
        if (d === c) break;
        if (c === '"' && d === "\\") {
          const e = s[j + 1];
          const map: Record<string, string> = { '"': '"', "\\": "\\", n: "\n", t: "\t" };
          if (e === undefined || !Object.hasOwn(map, e)) fail(`${out.length + 1}번째 문자열의 이스케이프 \\${e ?? ""} 를 해석하지 못한다`);
          v += map[e];
          j += 2;
          continue;
        }
        v += d;
        j++;
      }
      if (v.length === 0) fail(`${out.length + 1}번째 원소가 빈 문자열이다`);
      out.push(v);
      expectValue = false;
      i = j + 1;
    } else {
      fail(`해석하지 못한 원소가 있다: ${JSON.stringify(s.slice(i, i + 20))}`);
    }
  }
  if (out.length === 0) fail("원소가 0개다");
  return out;
}
const EXPOSED_SCHEMAS: readonly string[] = parseExposedSchemas(
  readFileSync(path.resolve(import.meta.dirname, "..", "supabase", "config.toml"), "utf8"),
);

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

// ── astra 수정 라운드 (P5-15) — **새 수집기**의 기준선. 기존 목록은 넓히지 않았다. 항목은 전부 2026-09-17 로컬 실측 그대로다.

/**
 * 노출 스키마(graphql_public)의 **프레임워크 기본 함수** — 이름·시그니처·소유자·허용 롤·실행 모드까지 고정한다.
 * 이 밖의 graphql_public 객체는 전부 위반이다(그 스키마의 기본 권한도 anon·authenticated 에게 전권을 준다 — 실측).
 * 컨트롤러 결정(2026-09-17, P5-15 R3): graphql_public 노출은 **유지**하고 이 게이트로 감시한다(config.toml 은 바꾸지 않는다).
 */
interface FrameworkFn {
  readonly reason: string;
  readonly owner: string;
  readonly roles: readonly string[];
  readonly publicExecute: boolean;
  /** astra R2 P1-B — `prosecdef`. 허용은 **이 실행 모드일 때만** 성립한다(definer 로 바뀌면 소유자 권한으로 돈다). */
  readonly securityDefiner: boolean;
  /** `proconfig` 를 ` && ` 로 이은 값, 없으면 `(none)`. 설정 주입(search_path 등)도 기준선 이탈이다. */
  readonly config: string;
}
const FRAMEWORK_FNS: Readonly<Record<string, FrameworkFn>> = {
  "graphql_public.graphql(text,text,jsonb,jsonb)": {
    reason: "pg_graphql 의 API 진입점(/graphql/v1) — Supabase 가 만든 그대로(소유자 supabase_admin · security invoker · proacl 에 PUBLIC EXECUTE). 실측 2026-09-17",
    owner: "supabase_admin",
    roles: ["anon", "authenticated"],
    publicExecute: true,
    securityDefiner: false,
    config: "(none)",
  },
};

/** 노출 스키마의 USAGE — PostgREST 가 그 스키마의 객체를 이름으로 찾으려면 필요하다. 데이터 접근은 객체 권한·RLS 가 따로 막는다. */
const SCHEMA_USAGE_REASON = "PostgREST 노출 스키마의 이름 해석 — config.toml [api] schemas 에 있는 스키마에만 허용";

/** PUBLIC 의 스키마 USAGE — `public` 스키마의 PostgreSQL 15+ 기본 ACL(`=U/pg_database_owner`). graphql_public 에는 없다(실측). */
const PUBLIC_SCHEMA_USAGE: Reasoned = { public: "PostgreSQL 15+ public 스키마 기본 ACL =U/pg_database_owner (실측 2026-09-17)" };

/**
 * 사용자 타입의 USAGE. `reservation_status`(0001 enum)는 typacl 이 NULL 이라 PostgreSQL 기본값 = **PUBLIC USAGE** 다(실측).
 * 타입 USAGE 는 행을 읽게 해 주지 않는다(값 캐스팅·그 타입으로 객체를 정의하는 데 쓰인다). **새 수집기가 찾은 기준선**이라
 * 넓힌 것이 아니라 고정한 것이다. **컨트롤러 결정(2026-09-17, P5-15 R3): 유지** — 기준선 그대로 둔다.
 */
const TYPE_USAGE: Reasoned = { reservation_status: "0001 enum — typacl NULL = PostgreSQL 기본 PUBLIC USAGE (실측 기준선 · 컨트롤러 결정 2026-09-17: 유지)" };

/**
 * 공개 롤의 불리언 속성 기준선 — 여기 없는 속성은 **false 가 기준**이다(PostgreSQL 이 속성을 더해도 false 가 아니면 빨갛다).
 * 실측: anon·authenticated 모두 rolinherit=true, rolsuper·rolcreaterole·rolcreatedb·rolcanlogin·rolreplication·rolbypassrls=false.
 */
const ROLE_ATTR_BASELINE: Readonly<Record<string, boolean>> = { rolinherit: true };

/** 공개 롤의 설정 키 — Supabase 기본(anon 3s · authenticated 8s). `role`·`search_path` 같은 키가 붙으면 빨갛다. */
const ROLE_CONFIG_KEYS: Reasoned = { statement_timeout: "Supabase 기본 — anon 3s · authenticated 8s (실측 2026-09-17)" };

/** `Object.hasOwn` — 허용 목록 조회는 전부 이것으로 한다. `in`·인덱싱은 `constructor`·`__proto__` 를 허용으로 읽는다(astra P1-3). */
const own = (o: object, k: string): boolean => Object.hasOwn(o, k);

// =============================================================================
// 사실 수집 SQL — 카탈로그 전수. 한 행 한 열, base64 로 감싼다(CLI 출력 형식 text/json 과 무관하게 읽기 위해).
// =============================================================================
const SENTINEL_B = "@@P611_FACTS_B@@";
const SENTINEL_E = "@@P611_FACTS_E@@";

const sqlList = (xs: readonly string[]) => xs.map((s) => `'${s.replace(/'/g, "''")}'`).join(", ");

/**
 * `f` 한 열을 내는 WITH 질의. 서브쿼리로도 쓴다(이빨 실측의 DO 블록 안).
 * 대상 스키마는 **인자**다(config.toml 의 노출 스키마 — astra P1-5). 객체 이름은 public 이면 그대로, 아니면 `스키마.이름`.
 * 함수 이름은 `regprocedure` 의 스키마 접두사를 지운 뒤 같은 규칙으로 붙인다 — 세션의 search_path 에 따라 이름이 흔들리지 않게.
 */
function factsQuery(schemas: readonly string[]): string {
  return [
  "with recursive roles(role) as (values ('anon'), ('authenticated')),",
  `nsps as (select n.oid, n.nspname, n.nspowner, n.nspacl from pg_namespace n where n.nspname = any (array[${sqlList(schemas)}]::text[])),`,
  "rels as (",
  "  select c.oid, case when n.nspname = 'public' then c.relname else n.nspname || '.' || c.relname end as rname,",
  "         c.relkind, c.relowner, c.relacl, c.relrowsecurity",
  "  from pg_class c join nsps n on n.oid = c.relnamespace",
  "  where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')",
  "),",
  "fns as (",
  "  select p.oid, p.proowner, p.proacl, p.prosecdef, p.proconfig,",
  "         case when n.nspname = 'public' then '' else n.nspname || '.' end || regexp_replace(p.oid::regprocedure::text, '^[^(]*\\.', '') as fname",
  "  from pg_proc p join nsps n on n.oid = p.pronamespace",
  "),",
  // 사용자 타입 — enum·domain·range·multirange·독립 composite·배열이 아닌 base. 표의 행 타입·배열 타입은 표 권한을 따르므로 뺀다.
  "typs as (",
  "  select t.oid, case when n.nspname = 'public' then t.typname else n.nspname || '.' || t.typname end as tname, t.typowner, t.typacl",
  "  from pg_type t join nsps n on n.oid = t.typnamespace",
  "  where t.typtype in ('e', 'd', 'r', 'm')",
  "     or (t.typtype = 'b' and t.typcategory <> 'A')",
  "     or (t.typtype = 'c' and exists (select 1 from pg_class k where k.oid = t.typrelid and k.relkind = 'c'))",
  "),",
  // ── 권한 종류 — **하드코딩하지 않는다** (헤더 P5-15). (a) 서버가 아는 전 종류 ∪ (b) 실제 ACL 에 나타난 종류.
  //    `objkind` 는 표('r')와 시퀀스('s')를 가른다 — 두 종류의 권한 집합이 다르고, 서로의 has_* 에 넣으면 22023 으로 죽는다.
  "relacls as (",
  "  select r.oid, r.rname, case when r.relkind = 'S' then 'sequence' else 'table' end as objkind, a.grantee, a.privilege_type, a.is_grantable",
  "  from rels r",
  "  cross join lateral aclexplode(coalesce(r.relacl, acldefault(case when r.relkind = 'S' then 's' else 'r' end::\"char\", r.relowner))) a",
  "),",
  "reltypes(objkind, priv) as (",
  "  select distinct case when r.relkind = 'S' then 'sequence' else 'table' end, d.privilege_type",
  "  from rels r cross join lateral aclexplode(acldefault(case when r.relkind = 'S' then 's' else 'r' end::\"char\", r.relowner)) d",
  "  union",
  "  select objkind, privilege_type from relacls",
  "),",
  // 컬럼 — acldefault('c') 는 비어 있다(컬럼 권한에는 소유자 기본값이 없다). 컬럼 권한은 attacl 에만 존재하므로 (b) 로 완전하다.
  "colacls as (",
  "  select r.oid, r.rname, x.grantee, x.privilege_type, x.is_grantable",
  "  from rels r join pg_attribute at on at.attrelid = r.oid and at.attacl is not null and not at.attisdropped",
  "  cross join lateral aclexplode(at.attacl) x",
  "  where r.relkind <> 'S'",
  "),",
  "coltypes(priv) as (",
  "  select distinct d.privilege_type from rels r cross join lateral aclexplode(acldefault('c', r.relowner)) d where r.relkind <> 'S'",
  "  union",
  "  select privilege_type from colacls",
  "),",
  "fnacls as (",
  "  select f.oid, f.fname, a.grantee, a.privilege_type, a.is_grantable",
  "  from fns f cross join lateral aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a",
  "),",
  "fntypes(priv) as (",
  "  select distinct d.privilege_type from fns f cross join lateral aclexplode(acldefault('f', f.proowner)) d",
  "  union",
  "  select privilege_type from fnacls",
  "),",
  // 스키마 — 종류는 acldefault('n') ∪ nspacl
  "nspacls as (",
  "  select n.oid, n.nspname, a.grantee, a.privilege_type, a.is_grantable",
  "  from nsps n cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a",
  "),",
  "nsptypes(priv) as (",
  "  select distinct d.privilege_type from nsps n cross join lateral aclexplode(acldefault('n', n.nspowner)) d",
  "  union",
  "  select privilege_type from nspacls",
  "),",
  // 타입 — 종류는 acldefault('T') ∪ typacl. typacl 이 NULL 이면 기본값(PUBLIC USAGE)이다.
  "typacls as (",
  "  select t.oid, t.tname, a.grantee, a.privilege_type, a.is_grantable",
  "  from typs t cross join lateral aclexplode(coalesce(t.typacl, acldefault('T', t.typowner))) a",
  "),",
  "typtypes(priv) as (",
  "  select distinct d.privilege_type from typs t cross join lateral aclexplode(acldefault('T', t.typowner)) d",
  "  union",
  "  select privilege_type from typacls",
  "),",
  // 롤 도달 — 공개 롤이 멤버인 롤을 재귀로. 간선의 옵션(admin·inherit·set — PG16+ 컬럼)은 to_jsonb 로 통째로 담는다(버전 무관).
  "reach(root, roleid, opts) as (",
  "  select ro.role, m.roleid, (to_jsonb(m) - 'oid' - 'roleid' - 'member' - 'grantor')::text",
  "  from roles ro join pg_auth_members m on m.member = to_regrole(ro.role)",
  "  union",
  "  select r.root, m.roleid, (to_jsonb(m) - 'oid' - 'roleid' - 'member' - 'grantor')::text",
  "  from reach r join pg_auth_members m on m.member = r.roleid",
  "),",
  "facts(f) as (",
  // 열거된 종류 자체 — 게이트가 무엇을 보았는지 사실로 남긴다(공허 열거 방지 · 새 종류 가시화)
  "  select format('privtype|%s|%s', t.objkind, lower(t.priv)) from reltypes t",
  "  union all",
  "  select format('privtype|column|%s', lower(t.priv)) from coltypes t",
  "  union all",
  "  select format('privtype|function|%s', lower(t.priv)) from fntypes t",
  "  union all",
  "  select format('privtype|schema|%s', lower(t.priv)) from nsptypes t",
  "  union all",
  "  select format('privtype|type|%s', lower(t.priv)) from typtypes t",
  "  union all",
  "  select format('server|version_num|%s', current_setting('server_version_num'))",
  "  union all",
  "  select format('schema_exists|%s', n.nspname) from nsps n",
  "  union all",
  // (나) 유효값 — 표·뷰, 열거된 **모든** 표 권한 종류
  "  select format('table|%s|%s|%s', r.rname, ro.role, lower(t.priv))",
  "  from rels r cross join roles ro join reltypes t on t.objkind = 'table'",
  "  where r.relkind <> 'S' and has_table_privilege(ro.role, r.oid, t.priv)",
  "  union all",
  // 컬럼 단위 — 표 단위에는 없는데 어느 컬럼에는 있는 권한(표 단위 revoke 가 지우지 못하는 경로).
  // 종류는 attacl 에서 온 것뿐이라 표 전용 권한(delete·truncate…)이 섞여 22023 으로 죽지 않는다(0016 이 한 번 걸렸다).
  "  select format('column|%s|%s|%s', r.rname, ro.role, lower(t.priv))",
  "  from rels r cross join roles ro cross join coltypes t",
  "  where r.relkind <> 'S' and has_any_column_privilege(ro.role, r.oid, t.priv)",
  "    and not has_table_privilege(ro.role, r.oid, t.priv)",
  "  union all",
  "  select format('sequence|%s|%s|%s', r.rname, ro.role, lower(t.priv))",
  "  from rels r cross join roles ro join reltypes t on t.objkind = 'sequence'",
  "  where r.relkind = 'S' and has_sequence_privilege(ro.role, r.oid, t.priv)",
  "  union all",
  "  select format('function|%s|%s|%s', f.fname, ro.role, lower(t.priv))",
  "  from fns f cross join roles ro cross join fntypes t",
  "  where has_function_privilege(ro.role, f.oid, t.priv)",
  "  union all",
  "  select format('schema|%s|%s|%s', n.nspname, ro.role, lower(t.priv))",
  "  from nsps n cross join roles ro cross join nsptypes t",
  "  where has_schema_privilege(ro.role, n.oid, t.priv)",
  "  union all",
  "  select format('type|%s|%s|%s', y.tname, ro.role, lower(t.priv))",
  "  from typs y cross join roles ro cross join typtypes t",
  "  where has_type_privilege(ro.role, y.oid, t.priv)",
  "  union all",
  // (나′) 유효값의 grant option — astra P1-2. 같은 종류 목록에 ' WITH GRANT OPTION' 을 붙여 묻는다(상속된 grant option 까지 잡는다).
  "  select format('grantopt|table|%s|%s|%s', r.rname, ro.role, lower(t.priv))",
  "  from rels r cross join roles ro join reltypes t on t.objkind = 'table'",
  "  where r.relkind <> 'S' and has_table_privilege(ro.role, r.oid, t.priv || ' WITH GRANT OPTION')",
  "  union all",
  "  select format('grantopt|column|%s|%s|%s', r.rname, ro.role, lower(t.priv))",
  "  from rels r cross join roles ro cross join coltypes t",
  "  where r.relkind <> 'S' and has_any_column_privilege(ro.role, r.oid, t.priv || ' WITH GRANT OPTION')",
  "    and not has_table_privilege(ro.role, r.oid, t.priv || ' WITH GRANT OPTION')",
  "  union all",
  "  select format('grantopt|sequence|%s|%s|%s', r.rname, ro.role, lower(t.priv))",
  "  from rels r cross join roles ro join reltypes t on t.objkind = 'sequence'",
  "  where r.relkind = 'S' and has_sequence_privilege(ro.role, r.oid, t.priv || ' WITH GRANT OPTION')",
  "  union all",
  "  select format('grantopt|function|%s|%s|%s', f.fname, ro.role, lower(t.priv))",
  "  from fns f cross join roles ro cross join fntypes t",
  "  where has_function_privilege(ro.role, f.oid, t.priv || ' WITH GRANT OPTION')",
  "  union all",
  "  select format('grantopt|schema|%s|%s|%s', n.nspname, ro.role, lower(t.priv))",
  "  from nsps n cross join roles ro cross join nsptypes t",
  "  where has_schema_privilege(ro.role, n.oid, t.priv || ' WITH GRANT OPTION')",
  "  union all",
  "  select format('grantopt|type|%s|%s|%s', y.tname, ro.role, lower(t.priv))",
  "  from typs y cross join roles ro cross join typtypes t",
  "  where has_type_privilege(ro.role, y.oid, t.priv || ' WITH GRANT OPTION')",
  "  union all",
  // (가) ACL — 공개 롤에 **직접** 부여된 항목 전부(종류 불문) + grantable 을 보존한다. 판정은 유효값과 같은 허용 목록으로 한다.
  "  select format('acl|%s|%s|%s|%s|%s', a.objkind, a.rname, ro.role, lower(a.privilege_type), a.is_grantable::text)",
  "  from relacls a join roles ro on a.grantee = to_regrole(ro.role)",
  "  union all",
  "  select format('acl|column|%s|%s|%s|%s', a.rname, ro.role, lower(a.privilege_type), a.is_grantable::text)",
  "  from colacls a join roles ro on a.grantee = to_regrole(ro.role)",
  "  union all",
  "  select format('acl|function|%s|%s|%s|%s', a.fname, ro.role, lower(a.privilege_type), a.is_grantable::text)",
  "  from fnacls a join roles ro on a.grantee = to_regrole(ro.role)",
  "  union all",
  "  select format('acl|schema|%s|%s|%s|%s', a.nspname, ro.role, lower(a.privilege_type), a.is_grantable::text)",
  "  from nspacls a join roles ro on a.grantee = to_regrole(ro.role)",
  "  union all",
  "  select format('acl|type|%s|%s|%s|%s', a.tname, ro.role, lower(a.privilege_type), a.is_grantable::text)",
  "  from typacls a join roles ro on a.grantee = to_regrole(ro.role)",
  "  union all",
  "  select format('definer|%s|%s', f.fname, coalesce((select c from unnest(f.proconfig) c where c like 'search_path=%' limit 1), 'search_path=(none)'))",
  "  from fns f where f.prosecdef",
  "  union all",
  // 실행 모드 — 모든 함수. 구분자 ';'·'|' 와 겹치지 않게 proconfig 는 ' && ' 로 잇는다(astra R2 P1-B).
  "  select format('fnmode|%s|%s|%s', f.fname, f.prosecdef::text, coalesce(array_to_string(f.proconfig, ' && '), '(none)'))",
  "  from fns f",
  "  union all",
  "  select format('public_acl|%s|%s', a.rname, a.privilege_type) from relacls a where a.grantee = 0",
  "  union all",
  "  select format('public_fn_acl|%s|%s', a.fname, a.privilege_type) from fnacls a where a.grantee = 0",
  "  union all",
  "  select format('public_schema_acl|%s|%s', a.nspname, a.privilege_type) from nspacls a where a.grantee = 0",
  "  union all",
  "  select format('public_type_acl|%s|%s', a.tname, a.privilege_type) from typacls a where a.grantee = 0",
  "  union all",
  "  select format('owner|%s|%s|%s', r.rname, r.relkind, pg_get_userbyid(r.relowner)) from rels r",
  "  union all",
  "  select format('fnowner|%s|%s', f.fname, pg_get_userbyid(f.proowner)) from fns f",
  "  union all",
  "  select format('typeowner|%s|%s', y.tname, pg_get_userbyid(y.typowner)) from typs y",
  "  union all",
  "  select format('rls|%s|%s', r.rname, case when r.relrowsecurity then 'on' else 'off' end) from rels r where r.relkind in ('r', 'p')",
  "  union all",
  "  select format('policy|%s|%s|%s', r.rname, pol.polcmd, case when x.role_oid = 0 then 'PUBLIC' else pg_get_userbyid(x.role_oid) end)",
  "  from pg_policy pol join rels r on r.oid = pol.polrelid",
  "  cross join lateral unnest(pol.polroles) x(role_oid)",
  "  union all",
  // 롤 — astra P1-4. 불리언 속성은 to_jsonb 로 **열거**한다(PostgreSQL 이 속성을 더해도 보인다).
  "  select format('roleattr|%s|%s|%s', r.rolname, j.key, j.value)",
  "  from pg_roles r join roles ro on ro.role = r.rolname",
  "  cross join lateral jsonb_each(to_jsonb(r)) j",
  "  where jsonb_typeof(j.value) = 'boolean'",
  "  union all",
  // 설정 — 전역·DB 별 모두(pg_roles.rolconfig 는 전역만 보여 준다)
  "  select format('roleconfig|%s|%s', ro.role, split_part(c, '=', 1))",
  "  from roles ro join pg_db_role_setting s on s.setrole = to_regrole(ro.role)",
  "  cross join lateral unnest(s.setconfig) c",
  "  union all",
  "  select format('rolemember|%s|%s|%s', x.root, pg_get_userbyid(x.roleid), x.opts) from reach x",
  "  union all",
  // large object — 스키마가 없어 위 수집에 들어오지 않는다. DB 전역에 0 개여야 한다(astra P2-7).
  "  select format('lo_count|%s', count(*)) from pg_largeobject_metadata",
  ")",
  "select f from facts",
].join("\n");
}

/** 게이트가 보는 사실 질의 — 노출 스키마 전부. */
const FACTS_QUERY = factsQuery(EXPOSED_SCHEMAS);

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
  const effective = new Set(facts);

  // (가) ACL 관점 — 직접 부여 `acl|<종류>|<객체>|<롤>|<권한>` 을 유효값 사실과 **같은 판정**에 태운다.
  //      그리고 유효값 관점(나)에 짝이 없으면 두 관점이 어긋난 것이므로 그 자체로 빨강이다.
  //      컬럼 단위 직접 부여는 짝을 찾지 않고 언제나 위반이다(표 단위 revoke 가 지우지 못한다).
  //      astra P1-2 — 6번째 필드 grantable 이 true 면 그 자체로 위반이고, 유효값 관점(grantopt)에 짝이 없으면 불일치다.
  const hasFn: Record<string, string> = { table: "table", sequence: "sequence", function: "function", schema: "schema", type: "type", column: "any_column" };
  const judged: string[][] = [];
  for (const r of rows) {
    if (r[0] !== "acl") {
      judged.push(r);
      continue;
    }
    const [, objkind, obj, role, priv, grantable] = r;
    // 형식 방어 — format('%s', boolean) 은 't'/'f' 를 낸다. 처음 판이 그것을 'true' 와 비교해 grant option 을 조용히 놓쳤다(탐침이 잡았다).
    if (grantable !== undefined && grantable !== "true" && grantable !== "false") {
      out.push(`${obj} — 두 관점 불일치: ACL 사실의 grantable 값 '${grantable}' 을 해석할 수 없다 (수집 SQL 이 ::text 로 내야 한다)`);
    }
    if (grantable === "true" &&!effective.has(`grantopt|${objkind}|${obj}|${role}|${priv}`)) {
      out.push(
        `${obj} — 두 관점 불일치: ACL 에는 ${role} 의 ${priv} WITH GRANT OPTION 이 있는데 유효값(has_${own(hasFn, objkind) ? hasFn[objkind] : objkind}_privilege … WITH GRANT OPTION)에는 없다`,
      );
    }
    if (grantable === "true") judged.push(["grantopt", objkind, obj, role, priv]);
    if (objkind === "column") {
      out.push(`${obj} — 컬럼 단위: ${role} 에게 일부 컬럼 ${priv} 가 직접 부여돼 있다 (ACL 관점 · 표 단위 revoke 가 지우지 못하는 경로)`);
      continue;
    }
    const twin = `${objkind}|${obj}|${role}|${priv}`;
    if (!effective.has(twin)) {
      out.push(`${obj} — 두 관점 불일치: ACL 에는 ${role} 의 ${priv} 가 있는데 유효값(has_${own(hasFn, objkind) ? hasFn[objkind] : objkind}_privilege)에는 없다`);
    }
    judged.push(twin.split("|"));
  }

  for (const r of judged) {
    const [kind, obj, a, b] = r;
    switch (kind) {
      case "table": {
        const role = a;
        const priv = b;
        exposed.add(obj);
        if (role === "anon") {
          if (priv === "select" && own(ANON_SELECT, obj)) break;
          out.push(`${obj} — 표: anon 에게 ${priv} (허용 목록 밖)`);
        } else if (role === "authenticated") {
          if (priv === "select" && own(AUTH_SELECT, obj)) break;
          if (["insert", "update", "delete"].includes(priv) && own(AUTH_WRITE, obj) && AUTH_WRITE[obj].includes(priv)) {
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
      case "sequence": {
        const key = `${obj}|${a}`;
        if (own(SEQ_ALLOW, key) && SEQ_ALLOW[key].includes(b)) break;
        out.push(`${obj} — 시퀀스: ${a} 에게 ${b} (허용 목록 밖)`);
        break;
      }
      case "function": {
        // 허용 목록은 EXECUTE 에 대한 것이다. 서버가 함수 권한을 더하면(오늘은 EXECUTE 하나) 그 종류는 무조건 위반이다.
        const priv = (b ?? "execute").toUpperCase();
        if (priv === "EXECUTE" && own(FRAMEWORK_FNS, obj) && FRAMEWORK_FNS[obj].roles.includes(a)) break;
        const allow = a === "anon" ? ANON_EXEC : AUTH_EXEC;
        if (priv === "EXECUTE" && (a === "anon" || a === "authenticated") && own(allow, obj)) break;
        out.push(`${obj} — 함수: ${a} 에게 ${priv} (허용 목록 밖)`);
        break;
      }
      case "grantopt": {
        // [grantopt, 종류, 객체, 롤, 권한] — 어느 허용 목록도 grant option 을 허용하지 않는다.
        const [, objkind, o, role, priv] = r;
        out.push(`${o} — grant option: ${role} 에게 ${priv} WITH GRANT OPTION (${objkind} · 받은 롤이 남에게 다시 줄 수 있다 — 허용 목록은 grant option 을 허용하지 않는다)`);
        break;
      }
      case "schema":
        if (b === "usage" && EXPOSED_SCHEMAS.includes(obj)) break;
        out.push(`${obj} 스키마 — ${a} 에게 ${(b ?? "").toUpperCase()} (허용: 노출 스키마의 USAGE 뿐 — ${SCHEMA_USAGE_REASON})`);
        break;
      case "public_schema_acl":
        if (a === "USAGE" && own(PUBLIC_SCHEMA_USAGE, obj)) break;
        out.push(`${obj} 스키마 — PUBLIC 에 ${a} 가 부여돼 있다`);
        break;
      case "type":
        if (b === "usage" && own(TYPE_USAGE, obj)) break;
        out.push(`${obj} — 타입: ${a} 에게 ${b} (허용 목록 밖)`);
        break;
      case "public_type_acl":
        if (a === "USAGE" && own(TYPE_USAGE, obj)) break;
        out.push(`${obj} — 타입: PUBLIC 에 ${a} 가 부여돼 있다`);
        break;
      case "typeowner":
        if (!own(OWNERS, a)) out.push(`${obj} — 타입 소유자가 ${a} 다 (허용: ${Object.keys(OWNERS).join(", ")})`);
        break;
      case "roleattr": {
        const expected = own(ROLE_ATTR_BASELINE, a) ? ROLE_ATTR_BASELINE[a] : false;
        if (String(expected) !== b) out.push(`${obj} — 롤 속성: ${a}=${b} (기준선 ${expected})`);
        break;
      }
      case "roleconfig":
        if (!own(ROLE_CONFIG_KEYS, a)) out.push(`${obj} — 롤 설정: ${a} (허용: ${Object.keys(ROLE_CONFIG_KEYS).join(", ")})`);
        break;
      case "rolemember":
        out.push(`${obj} — 롤 멤버십: ${a} 에 도달한다 (${r.slice(3).join("|")}) — 공개 롤은 어느 롤의 멤버도 아니어야 한다(기준선 0)`);
        break;
      case "lo_count":
        if (obj !== "0") out.push(`large object ${obj}개 — 스키마 밖이라 객체 권한 수집에 들어오지 않는다(기준선 0)`);
        break;
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
        if (a === "EXECUTE" && own(FRAMEWORK_FNS, obj) && FRAMEWORK_FNS[obj].publicExecute) break;
        out.push(`${obj} — 함수: PUBLIC 에 ${a} 가 부여돼 있다`);
        break;
      case "owner":
        if (!own(OWNERS, b)) out.push(`${obj} — 소유자가 ${b} 다 (허용: ${Object.keys(OWNERS).join(", ")})`);
        break;
      case "fnmode": {
        // [fnmode, 함수, prosecdef, proconfig…] — 프레임워크 예외는 기준선 실행 모드에서만 성립한다.
        if (!own(FRAMEWORK_FNS, obj)) break;
        const spec = FRAMEWORK_FNS[obj];
        const config = r.slice(3).join("|");
        if (a !== String(spec.securityDefiner) || config !== spec.config) {
          out.push(
            `${obj} — 프레임워크 함수의 실행 모드가 기준선과 다르다 (security definer=${a} · 설정=${config} / 기준선 definer=${spec.securityDefiner} · 설정=${spec.config}) — 허용은 그 모드에서만 성립한다`,
          );
        }
        break;
      }
      case "fnowner":
        if (own(OWNERS, a)) break;
        if (own(FRAMEWORK_FNS, obj) && FRAMEWORK_FNS[obj].owner === a) break;
        out.push(`${obj} — 함수 소유자가 ${a} 다 (허용: ${Object.keys(OWNERS).join(", ")} · 프레임워크 함수는 목록의 소유자)`);
        break;
      default:
        break;
    }
  }
  for (const t of exposed) {
    if (rlsOff.has(t)) out.push(`${t} — 공개 롤에 권한이 있는데 RLS 가 꺼져 있다`);
  }
  // 프레임워크 함수가 수집됐는데 실행 모드 사실이 없다 — 수집 누락을 허용으로 읽지 않는다(astra R2 P1-B).
  const moded = new Set(rows.filter((r) => r[0] === "fnmode").map((r) => r[1]));
  for (const r of rows) {
    if (r[0] === "fnowner" && own(FRAMEWORK_FNS, r[1]) && !moded.has(r[1])) {
      out.push(`${r[1]} — 프레임워크 함수의 실행 모드 사실이 없다 (definer 여부를 확인하지 못하면 허용하지 않는다)`);
    }
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
  for (const [f, spec] of Object.entries(FRAMEWORK_FNS)) {
    for (const role of spec.roles) if (!has.has(`function|${f}|${role}|execute`)) dead.push(`FRAMEWORK_FNS ${f}/${role}`);
    if (!has.has(`fnowner|${f}|${spec.owner}`)) dead.push(`FRAMEWORK_FNS ${f} 소유자 ${spec.owner}`);
    if (spec.publicExecute && !has.has(`public_fn_acl|${f}|EXECUTE`)) dead.push(`FRAMEWORK_FNS ${f} PUBLIC EXECUTE`);
    if (!has.has(`fnmode|${f}|${spec.securityDefiner}|${spec.config}`)) dead.push(`FRAMEWORK_FNS ${f} 실행 모드 definer=${spec.securityDefiner} 설정=${spec.config}`);
  }
  for (const s of Object.keys(PUBLIC_SCHEMA_USAGE)) if (!has.has(`public_schema_acl|${s}|USAGE`)) dead.push(`PUBLIC_SCHEMA_USAGE ${s}`);
  for (const t of Object.keys(TYPE_USAGE)) if (!has.has(`public_type_acl|${t}|USAGE`)) dead.push(`TYPE_USAGE ${t}`);
  for (const [attr, v] of Object.entries(ROLE_ATTR_BASELINE)) {
    for (const role of ["anon", "authenticated"]) if (!has.has(`roleattr|${role}|${attr}|${v}`)) dead.push(`ROLE_ATTR_BASELINE ${role}.${attr}`);
  }
  for (const k of Object.keys(ROLE_CONFIG_KEYS)) {
    for (const role of ["anon", "authenticated"]) if (!has.has(`roleconfig|${role}|${k}`)) dead.push(`ROLE_CONFIG_KEYS ${role}.${k}`);
  }
  return dead;
}

const byKind = (violations: readonly string[], marker: string) => violations.filter((v) => v.includes(marker));

// =============================================================================
// 0. 순수 — 허용 목록 자체의 신선도·사유
// =============================================================================
describe("0. 허용 목록 — 사유 필수 · 비어 있지 않음(의도적 빈 목록은 명시)", () => {
  test("모든 항목에 사유가 한 줄 이상 있다", () => {
    for (const [name, list] of Object.entries({ ANON_SELECT, AUTH_SELECT, ANON_EXEC, AUTH_EXEC, OWNERS, PUBLIC_SCHEMA_USAGE, TYPE_USAGE, ROLE_CONFIG_KEYS })) {
      for (const [k, why] of Object.entries(list)) expect(why.trim().length, `${name}.${k} 의 사유가 비었다`).toBeGreaterThan(5);
    }
    for (const [k, spec] of Object.entries(FRAMEWORK_FNS)) expect(spec.reason.trim().length, `FRAMEWORK_FNS.${k} 의 사유가 비었다`).toBeGreaterThan(5);
    expect(AUTH_WRITE_REASON.length).toBeGreaterThan(5);
    expect(SEQ_REASON.length).toBeGreaterThan(5);
    expect(SCHEMA_USAGE_REASON.length).toBeGreaterThan(5);
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

  test("🔴 P5-15 — 옛 하드코딩 목록에 없던 권한 종류도 이름으로 잡는다 (판정은 종류를 가리지 않는다)", () => {
    const v = evaluate([
      "table|notices|anon|maintain",
      "table|reservations|authenticated|maintain",
      "table|notices|authenticated|maintain",
      "policy|notices|*|authenticated",
      "sequence|notices_id_seq|authenticated|some_future_priv",
      "function|is_admin()|authenticated|some_future_priv",
    ]).join("\n");
    for (const needle of [
      "notices — 표: anon 에게 maintain",
      "reservations — 표: authenticated 에게 maintain",
      "notices — 표: authenticated 에게 maintain",
      "notices_id_seq — 시퀀스: authenticated 에게 some_future_priv",
      "is_admin() — 함수: authenticated 에게 SOME_FUTURE_PRIV",
    ]) {
      expect(v, needle).toContain(needle);
    }
  });

  test("P5-15 — ACL 관점: 직접 부여는 유효값과 같은 판정을 받고, 유효값에 짝이 없으면 '두 관점 불일치' 로 빨개진다", () => {
    const lone = evaluate(["acl|table|t_new|anon|maintain"]).join("\n");
    expect(lone).toContain("t_new — 표: anon 에게 maintain");
    expect(lone).toContain("t_new — 두 관점 불일치: ACL 에는 anon 의 maintain 가 있는데 유효값(has_table_privilege)에는 없다");
    expect(evaluate(["acl|table|notices|anon|select", "table|notices|anon|select"]), "허용된 직접 부여 + 짝 있음 = 조용해야 한다").toEqual([]);
    expect(evaluate(["acl|sequence|notices_id_seq|authenticated|usage", "sequence|notices_id_seq|authenticated|usage"])).toEqual([]);
    expect(evaluate(["acl|function|is_admin()|authenticated|execute", "function|is_admin()|authenticated|execute"])).toEqual([]);
    expect(evaluate(["acl|column|reservations|anon|update"]).join("\n")).toContain("reservations — 컬럼 단위: anon 에게 일부 컬럼 update 가 직접 부여돼 있다");
  });

  test("🔴 P5-15 — 사실 수집 SQL 에 권한 종류 리터럴이 없다 (하드코딩 금지의 텍스트 이빨)", () => {
    const q = FACTS_QUERY.toLowerCase();
    const KINDS = "select|insert|update|delete|truncate|trigger|references|maintain|usage|execute|create|connect|temporary|set|alter system";
    // ① `values ('select'), …` 형태의 종류 목록
    expect(q).not.toMatch(new RegExp(`values\\s*\\(\\s*'(?:${KINDS})'`));
    // ② has_table/sequence/function/any_column_privilege 의 세 번째 인자에 리터럴 종류
    expect(q).not.toMatch(new RegExp(`has_(?:table|sequence|function|any_column|schema|type)_privilege\\([^)]*'(?:${KINDS})'`));
    // ③ 종류를 in/any 목록으로 거르는 형태
    expect(q).not.toMatch(new RegExp(`privilege_type\\s*(?:in|=|<>)\\s*(?:\\(|any|all)?\\s*[('"]*(?:${KINDS})`));
    // 열거의 뿌리가 실제로 있다 — 서버가 아는 전 종류(acldefault) + 실제 ACL(aclexplode)
    for (const k of ["'r' end::\"char\", r.relowner", "acldefault('c', r.relowner)", "acldefault('f', f.proowner)", "aclexplode(at.attacl)"]) {
      expect(q, k).toContain(k.toLowerCase());
    }
  });

  // ---------------------------------------------------------------------------
  // astra 수정 라운드 (P5-15) — 순수 평가기 이빨
  // ---------------------------------------------------------------------------
  test("🔴 astra P1-3 재현 — 허용 목록에 없는 `constructor` 표의 anon SELECT (ACL·소유자·RLS 정상) 는 위반 1건이다", () => {
    const v = evaluate(["table|constructor|anon|select", "acl|table|constructor|anon|select|false", "owner|constructor|r|postgres", "rls|constructor|on"]);
    expect(v).toEqual(["constructor — 표: anon 에게 select (허용 목록 밖)"]);
  });

  test("🔴 astra P1-3 — 프로토타입 속성 이름(constructor·__proto__·toString·hasOwnProperty)은 허용이 아니다", () => {
    const names = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"];
    for (const n of names) {
      let v: string[] = [];
      expect(() => {
        v = evaluate([
          `table|${n}|anon|select`,
          `acl|table|${n}|anon|select|false`,
          `table|${n}|authenticated|select`,
          `table|${n}|authenticated|insert`,
          `policy|${n}|*|authenticated`,
          `owner|${n}|r|postgres`,
          `rls|${n}|on`,
          `sequence|${n}|authenticated|usage`,
          `function|${n}|anon|execute`,
          `function|${n}|authenticated|execute`,
          `owner|t_${n}|r|${n}`,
          `fnowner|f_${n}()|${n}`,
        ]);
      }, `${n} 에서 평가기가 던졌다`).not.toThrow();
      const text = v.join("\n");
      for (const needle of [
        `${n} — 표: anon 에게 select`,
        `${n} — 표: authenticated 에게 select`,
        `${n} — 표: authenticated 에게 insert`,
        `${n} — 시퀀스: authenticated 에게 usage`,
        `${n} — 함수: anon 에게 EXECUTE`,
        `${n} — 함수: authenticated 에게 EXECUTE`,
        `t_${n} — 소유자가 ${n} 다`,
        `f_${n}() — 함수 소유자가 ${n} 다`,
      ]) {
        expect(text, `${needle} 를 허용으로 판정했다:\n${text}`).toContain(needle);
      }
    }
  });

  test("🔴 astra P1-2 — grant option: 허용된 권한이라도 WITH GRANT OPTION 은 위반 (ACL·유효값 두 관점)", () => {
    const both = evaluate(["acl|table|notices|anon|select|true", "table|notices|anon|select", "grantopt|table|notices|anon|select"]).join("\n");
    expect(both).toContain("notices — grant option: anon 에게 select WITH GRANT OPTION");
    // 상속으로만 보이는 grant option(유효값 관점) — 직접 ACL 이 없어도 잡는다
    expect(evaluate(["table|notices|anon|select", "grantopt|table|notices|anon|select"]).join("\n")).toContain("notices — grant option: anon 에게 select WITH GRANT OPTION");
    // 직접 ACL 에 grantable 인데 유효값에 없다 → 두 관점 불일치
    expect(evaluate(["acl|table|notices|anon|select|true", "table|notices|anon|select"]).join("\n")).toContain("notices — 두 관점 불일치: ACL 에는 anon 의 select WITH GRANT OPTION 이 있는데");
    // grant option 없는 허용된 직접 부여는 조용하다
    expect(evaluate(["acl|table|notices|anon|select|false", "table|notices|anon|select"])).toEqual([]);
    // 형식 방어 — 't' 같은 값은 조용히 false 로 읽지 않는다
    expect(evaluate(["acl|table|notices|anon|select|t", "table|notices|anon|select"]).join("\n")).toContain("grantable 값 't' 을 해석할 수 없다");
    expect(evaluate(["acl|sequence|notices_id_seq|authenticated|usage|true", "sequence|notices_id_seq|authenticated|usage", "grantopt|sequence|notices_id_seq|authenticated|usage"]).join("\n")).toContain(
      "notices_id_seq — grant option: authenticated 에게 usage WITH GRANT OPTION",
    );
  });

  test("🔴 astra P1-4 — 공개 롤의 속성·설정·멤버십이 기준선에서 벗어나면 빨개진다", () => {
    const v = evaluate([
      "roleattr|authenticated|rolbypassrls|true",
      "roleattr|anon|rolsuper|true",
      "roleattr|anon|rolinherit|true",
      "roleattr|anon|rolsomefutureflag|false",
      "roleattr|authenticated|rolinherit|false",
      "roleconfig|anon|statement_timeout",
      "roleconfig|anon|role",
      "rolemember|anon|pg_read_all_data|{\"set_option\": true, \"admin_option\": false, \"inherit_option\": false}",
    ]).join("\n");
    for (const needle of [
      "authenticated — 롤 속성: rolbypassrls=true",
      "anon — 롤 속성: rolsuper=true",
      "authenticated — 롤 속성: rolinherit=false",
      "anon — 롤 설정: role",
      "anon — 롤 멤버십: pg_read_all_data 에 도달한다",
    ]) {
      expect(v, needle).toContain(needle);
    }
    expect(v).not.toContain("rolsomefutureflag");
    expect(v).not.toContain("anon — 롤 속성: rolinherit");
    expect(v).not.toContain("롤 설정: statement_timeout");
  });

  test("🔴 astra P1-5 — 노출 스키마 전체: 프레임워크 함수만 이름으로 허용 · 그 밖의 graphql_public 객체는 위반", () => {
    const G = "graphql_public.graphql(text,text,jsonb,jsonb)";
    expect(
      evaluate([`function|${G}|anon|execute`, `function|${G}|authenticated|execute`, `acl|function|${G}|anon|execute|false`, `public_fn_acl|${G}|EXECUTE`, `fnowner|${G}|supabase_admin`, `fnmode|${G}|false|(none)`]),
      "프레임워크 기본 함수는 조용해야 한다",
    ).toEqual([]);
    const v = evaluate([
      "function|graphql_public.p611_x()|anon|execute",
      "definer|graphql_public.p611_x()|search_path=(none)",
      "fnowner|graphql_public.p611_x()|supabase_admin",
      `fnowner|${G}|anon`,
      `grantopt|function|${G}|anon|execute`,
    ]).join("\n");
    for (const needle of [
      "graphql_public.p611_x() — 함수: anon 에게 EXECUTE",
      "graphql_public.p611_x() — definer 함수",
      "graphql_public.p611_x() — 함수 소유자가 supabase_admin 다",
      `${G} — 함수 소유자가 anon 다`,
      `${G} — grant option: anon 에게 execute WITH GRANT OPTION`,
    ]) {
      expect(v, needle).toContain(needle);
    }
  });

  test("🔴 astra R2 P1-B — 허용된 프레임워크 함수가 SECURITY DEFINER 로 바뀌면(pg_temp 가 있어도) 빨개진다", () => {
    const G = "graphql_public.graphql(text,text,jsonb,jsonb)";
    const base = [
      `function|${G}|anon|execute`,
      `function|${G}|authenticated|execute`,
      `acl|function|${G}|anon|execute|false`,
      `acl|function|${G}|authenticated|execute|false`,
      `public_fn_acl|${G}|EXECUTE`,
      `fnowner|${G}|supabase_admin`,
    ];
    // astra 가 넣은 사실 그대로 — definer + search_path=public, pg_temp
    const escalated = evaluate([...base, `definer|${G}|search_path=public, pg_temp`, `fnmode|${G}|true|search_path=public, pg_temp`]).join("\n");
    expect(escalated).toContain(`${G} — 프레임워크 함수의 실행 모드가 기준선과 다르다`);
    // proconfig 만 붙어도(설정 주입) 빨갛다
    expect(evaluate([...base, `fnmode|${G}|false|search_path=public`]).join("\n")).toContain(`${G} — 프레임워크 함수의 실행 모드가 기준선과 다르다`);
    // 실행 모드 사실이 아예 없으면(수집 누락) 조용히 통과하지 않는다
    expect(evaluate(base).join("\n")).toContain(`${G} — 프레임워크 함수의 실행 모드 사실이 없다`);
    // 기준선(invoker · 설정 없음)은 조용하다
    expect(evaluate([...base, `fnmode|${G}|false|(none)`])).toEqual([]);
  });

  test("🔴 astra R2 P2-C — config.toml schemas 파서: 모든 원소를 받거나, 하나라도 해석 못 하면 throw 한다", () => {
    const wrap = (arr: string) => `project_id = "x"\n[api]\nenabled = true\n${arr}\nmax_rows = 1\n[api.tls]\nenabled = false\n`;
    expect(parseExposedSchemas(wrap(`schemas = ["public", "graphql_public", 'secret_api']`))).toEqual(["public", "graphql_public", "secret_api"]);
    expect(parseExposedSchemas(wrap(`schemas = ["public", "PrivateAPI"]`))).toEqual(["public", "PrivateAPI"]);
    expect(parseExposedSchemas(wrap(`schemas = [\n  "public",\n  "graphql_public",\n]`))).toEqual(["public", "graphql_public"]);
    expect(parseExposedSchemas(wrap(`schemas = [ # 노출 스키마\n  "public", # 기본\n  'a]b', # 괄호가 든 이름\n  "c\\"d", # 이스케이프\n]  # 끝`))).toEqual(["public", "a]b", 'c"d']);
    expect(parseExposedSchemas(wrap(`schemas = []\n# schemas = ["x"]`).replace("schemas = []", `schemas = ["public"]`))).toEqual(["public"]);
    // 해석 불가 — 조용히 빠뜨리지 않는다
    expect(() => parseExposedSchemas(wrap(`schemas = ["public", graphql_public]`))).toThrow(/해석하지 못한/);
    expect(() => parseExposedSchemas(wrap(`schemas = ["public", "unterminated]`))).toThrow();
    expect(() => parseExposedSchemas(wrap(`schemas = ["public"`))).toThrow();
    expect(() => parseExposedSchemas(wrap(`schemas = []`))).toThrow();
    expect(() => parseExposedSchemas(wrap(`other = 1`))).toThrow();
    expect(() => parseExposedSchemas(wrap(`schemas = ["public", ""]`))).toThrow();
  });

  test("astra P2-7 — 스키마 USAGE·CREATE, 타입 USAGE, large object 도 판정한다", () => {
    const v = evaluate([
      "schema|public|anon|usage",
      "schema|graphql_public|authenticated|usage",
      "schema|public|anon|create",
      "schema|p611_x|anon|usage",
      "public_schema_acl|public|USAGE",
      "public_schema_acl|graphql_public|USAGE",
      "type|reservation_status|anon|usage",
      "public_type_acl|reservation_status|USAGE",
      "type|p611_enum|anon|usage",
      "public_type_acl|p611_enum|USAGE",
      "typeowner|p611_enum|anon",
      "lo_count|3",
    ]);
    const lines = (prefix: string) => v.filter((x) => x.startsWith(prefix));
    const text = v.join("\n");
    for (const needle of [
      "public 스키마 — anon 에게 CREATE",
      "p611_x 스키마 — anon 에게 USAGE",
      "graphql_public 스키마 — PUBLIC 에 USAGE",
      "p611_enum — 타입: anon 에게 usage",
      "p611_enum — 타입: PUBLIC 에 USAGE",
      "p611_enum — 타입 소유자가 anon 다",
      "large object 3개",
    ]) {
      expect(text, needle).toContain(needle);
    }
    // 줄 머리로 본다 — "graphql_public 스키마 — …" 가 "public 스키마 — …" 를 부분 문자열로 품기 때문이다.
    for (const quiet of ["public 스키마 — anon 에게 USAGE", "graphql_public 스키마 — authenticated 에게 USAGE", "public 스키마 — PUBLIC 에 USAGE", "reservation_status —"]) {
      expect(lines(quiet), `${quiet} 는 허용이다`).toEqual([]);
    }
  });

  test("astra P1-5 — 노출 스키마는 config.toml 에서 읽는다 · 사실 수집 SQL 에 스키마 이름 필터를 박지 않는다", () => {
    expect(EXPOSED_SCHEMAS).toContain("public");
    expect(EXPOSED_SCHEMAS).toContain("graphql_public");
    expect(FACTS_QUERY, "public 을 필터로 하드코딩했다").not.toMatch(/where\s+n\.nspname\s*=\s*'public'/);
    for (const s of EXPOSED_SCHEMAS) expect(FACTS_QUERY).toContain(`'${s}'`);
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

  test("🔴 P5-15 — 권한 종류가 카탈로그에서 열거됐다 (옛 하드코딩 목록은 하한일 뿐 · PG17+ 에서는 maintain 포함)", () => {
    const types = (objkind: string) => facts.filter((f) => f.startsWith(`privtype|${objkind}|`)).map((f) => f.split("|")[2]);
    // 하한 — 처음 판이 하드코딩했던 목록. 열거가 그보다 좁아지면 안 된다(여기서만 쓰는 대조용 리터럴이다).
    for (const p of ["select", "insert", "update", "delete", "truncate", "trigger", "references"]) expect(types("table"), `표 ${p}`).toContain(p);
    for (const p of ["usage", "select", "update"]) expect(types("sequence"), `시퀀스 ${p}`).toContain(p);
    expect(types("function")).toContain("execute");
    const ver = Number(facts.find((f) => f.startsWith("server|version_num|"))?.split("|")[2]);
    expect(ver, "서버 버전 사실이 없다").toBeGreaterThan(0);
    if (ver >= 170000) expect(types("table"), "PG17 의 MAINTAIN 을 열거하지 못했다 — 게이트가 다시 눈을 감았다").toContain("maintain");
    // (가) 관점이 실제로 사실을 냈다 — 허용된 직접 부여(anon select 등)가 존재하므로 0 이면 수집이 고장난 것이다
    expect(facts.filter((f) => f.startsWith("acl|table|")).length).toBeGreaterThan(0);
    expect(facts.filter((f) => f.startsWith("acl|function|")).length).toBeGreaterThan(0);
  });

  test("🔴 astra P1-5 — config.toml 의 노출 스키마 전부를 열거했다 (graphql_public 포함)", () => {
    for (const s of EXPOSED_SCHEMAS) expect(facts, `노출 스키마 ${s} 를 보지 않았다`).toContain(`schema_exists|${s}`);
    expect(facts.some((f) => f.startsWith("fnowner|graphql_public.")), "graphql_public 의 함수를 하나도 수집하지 않았다").toBe(true);
  });

  test("🔴 astra P1-4 — 공개 롤의 속성·설정·멤버십이 기준선 그대로다", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(facts.filter((f) => f.startsWith(`roleattr|${role}|`)).length, `${role} 의 롤 속성을 수집하지 않았다`).toBeGreaterThanOrEqual(6);
    }
    const v = byKind(violations, " — 롤 ");
    expect(v, v.join("\n")).toEqual([]);
  });

  test("🔴 astra P1-2 — 공개 롤에 grant option 0 (직접·상속)", () => {
    const v = byKind(violations, " — grant option:");
    expect(v, v.join("\n")).toEqual([]);
  });

  test("astra P2-7 — 스키마 권한(USAGE 외)·타입 권한(허용 외)·large object 0", () => {
    expect(facts.some((f) => f.startsWith("lo_count|")), "large object 수를 세지 않았다").toBe(true);
    expect(facts.some((f) => f.startsWith("typeowner|")), "타입을 하나도 수집하지 않았다(0001 의 enum 이 있다)").toBe(true);
    const v = [...byKind(violations, " 스키마 — "), ...byKind(violations, " — 타입"), ...byKind(violations, "large object")];
    expect(v, v.join("\n")).toEqual([]);
  });

  test("P5-15 — 두 관점이 일치한다 (공개 롤의 직접 ACL 항목은 전부 유효값에도 있다)", () => {
    const v = byKind(violations, " — 두 관점 불일치");
    expect(v, v.join("\n")).toEqual([]);
  });

  test("표 — anon 은 허용 목록의 SELECT 만 · authenticated 는 허용 목록의 SELECT 와 정책 있는 쓰기만", () => {
    const v = byKind(violations, " — 표:");
    expect(v, `허용 목록 밖의 표 권한:\n${v.join("\n")}`).toEqual([]);
  });

  test("컬럼 단위 권한 0 · PUBLIC 직접 부여 0 (표·함수) · 노출 스키마 CREATE 0", () => {
    const v = [
      ...byKind(violations, " — 컬럼 단위"),
      ...byKind(violations, "PUBLIC 에"),
      ...byKind(violations, " 스키마 — "),
    ];
    expect(v, v.join("\n")).toEqual([]);
  });

  test("시퀀스 — 공개 롤은 허용 목록(관리자 insert 의 nextval)만", () => {
    const v = byKind(violations, " — 시퀀스:");
    expect(v, `허용 목록 밖의 시퀀스 권한 ${v.length}건:\n${v.join("\n")}`).toEqual([]);
  });

  test("함수 — anon EXECUTE 0 · authenticated 는 허용 목록만 · definer 는 전부 search_path 에 pg_temp", () => {
    const v = [...byKind(violations, " — 함수:"), ...byKind(violations, " — definer 함수"), ...byKind(violations, " — 프레임워크 함수의")];
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
      ...byKind(violations, " 스키마 — "),
      ...byKind(violations, " — 시퀀스:"),
      ...byKind(violations, " — 함수:"),
      ...byKind(violations, " — definer 함수"),
      ...byKind(violations, " — 프레임워크 함수의"),
      ...byKind(violations, "소유자가"),
      ...byKind(violations, "RLS 가 꺼져"),
      ...byKind(violations, " — 두 관점 불일치"),
      ...byKind(violations, " — 롤 "),
      ...byKind(violations, " — grant option:"),
      ...byKind(violations, " — 타입"),
      ...byKind(violations, "large object"),
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

  /**
   * P5-15 — 게이트의 옛 하드코딩 목록. **탐침을 만들 때만** 쓴다: "이 목록 밖의 종류만 남긴 표" 를 만들어,
   * 새 게이트가 그것을 이름으로 잡는지 본다. 게이트 자신의 SQL 은 이 목록을 쓰지 않는다(§0 텍스트 이빨).
   */
  const OLD_HARDCODED_TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "TRIGGER", "REFERENCES"];

  const PROBE_SQL = [
    "do $p611$",
    "declare payload text; newpriv text; t text;",
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
    // ④ P5-15 — 옛 하드코딩 목록 **밖의** 종류만 남긴 표. 종류는 서버에서 얻는다(PG17 이면 MAINTAIN).
    //    기본 권한을 전부 회수한 뒤 그 종류만 anon 에게 준다 — 옛 게이트라면 이 표는 완전히 조용했다.
    "  create table public.p611_gate_probe_newpriv (id int);",
    "  alter table public.p611_gate_probe_newpriv enable row level security;",
    "  revoke all on table public.p611_gate_probe_newpriv from anon, authenticated, service_role;",
    "  for t in select d.privilege_type from aclexplode(acldefault('r', 'postgres'::regrole)) d",
    `           where d.privilege_type <> all (array[${OLD_HARDCODED_TABLE_PRIVS.map((p) => `'${p}'`).join(", ")}]) loop`,
    "    execute format('grant %s on table public.p611_gate_probe_newpriv to anon', t);",
    "    newpriv := concat_ws(',', newpriv, lower(t));",
    "  end loop;",
    // ⑤ astra P1-2 — **허용된** anon SELECT(notices)에 grant option 만 더한다. 트랜잭션째 되돌려지므로 커밋되지 않는다.
    "  grant select on table public.notices to anon with grant option;",
    `  select string_agg(q.f, ';' order by q.f) into payload from (${FACTS_QUERY}) q where q.f like '%p611_gate_probe%' or q.f like '%|notices|%';`,
    "  payload := payload || ';probe_newpriv|p611_gate_probe_newpriv|' || coalesce(newpriv, '') || '|' || current_setting('server_version_num');",
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

  test("🔴 P5-15 — 옛 하드코딩 목록 밖의 권한(PG17: MAINTAIN)만 남긴 표를 이름으로 잡는다 (ACL·유효값 두 관점)", () => {
    const meta = probeFacts.find((f) => f.startsWith("probe_newpriv|"));
    expect(meta, "탐침 메타가 없다").toBeDefined();
    const [, , listed, ver] = (meta ?? "").split("|");
    const newPrivs = listed.split(",").filter(Boolean);
    if (Number(ver) >= 170000) expect(newPrivs, "PG17+ 인데 옛 목록 밖의 표 권한이 없다").toContain("maintain");
    if (newPrivs.length === 0) return; // PG16 이하 — 옛 목록 밖의 표 권한 자체가 없다
    const text = probeViolations.join("\n");
    for (const p of newPrivs) {
      expect(text, `p611_gate_probe_newpriv 의 ${p} 를 못 잡았다:\n${text}`).toContain(`p611_gate_probe_newpriv — 표: anon 에게 ${p}`);
      expect(probeFacts, "(나) 유효값 관점").toContain(`table|p611_gate_probe_newpriv|anon|${p}`);
      expect(probeFacts, "(가) ACL 관점").toContain(`acl|table|p611_gate_probe_newpriv|anon|${p}|false`);
    }
    // 옛 목록 안의 종류는 회수했으므로 그 표에 대해서는 그것들로 빨개지지 않는다 — 잡힌 이유가 정확히 새 종류다
    const onThis = probeViolations.filter((v) => v.startsWith("p611_gate_probe_newpriv — 표:"));
    expect(onThis.length, onThis.join("\n")).toBe(newPrivs.length);
    // 옛 게이트(하드코딩 목록)로 같은 사실을 걸렀다면 조용했다 — 대조
    const oldView = probeFacts.filter((f) => f.startsWith("table|p611_gate_probe_newpriv|") && OLD_HARDCODED_TABLE_PRIVS.includes(f.split("|")[3].toUpperCase()));
    expect(oldView, "옛 목록 안의 종류가 남아 있다 — 탐침이 의도대로 만들어지지 않았다").toEqual([]);
  });

  test("🔴 astra P1-2 — 허용된 anon SELECT 에 grant option 만 더한 표를 이름으로 잡는다 (그 밖의 이유로는 조용하다)", () => {
    const onNotices = probeViolations.filter((v) => v.startsWith("notices —"));
    expect(onNotices.join("\n"), onNotices.join("\n")).toContain("notices — grant option: anon 에게 select WITH GRANT OPTION");
    expect(onNotices.filter((v) => !v.includes("grant option")), "grant option 말고 다른 이유로 빨개졌다 — 탐침이 의도와 다르다").toEqual([]);
    expect(probeFacts, "(가) ACL 관점이 grantable 을 보존하지 않았다").toContain("acl|table|notices|anon|select|true");
    expect(probeFacts, "(나) 유효값 관점이 WITH GRANT OPTION 을 보지 않았다").toContain("grantopt|table|notices|anon|select");
  });

  test("되돌림 확인 — 탐침 뒤 카탈로그에 임시 객체가 하나도 없다", () => {
    const after = parseFacts(runLocalSql(FACTS_SQL));
    expect(after.filter((f) => f.includes("p611_gate_probe"))).toEqual([]);
    expect(after, "notices 의 grant option 이 커밋됐다").not.toContain("grantopt|table|notices|anon|select");
  });
});

// =============================================================================
// 4. 이빨 (astra P1-4·P1-5) — **슈퍼유저로만 만들 수 있는** 사고. 되돌려지는 트랜잭션.
//
//    `postgres` 로는 `authenticated` 의 속성을 바꿀 수 없고("reserved role") graphql_public 에 함수를 만들 수 없다
//    (스키마 소유자가 supabase_admin). 그래서 로컬 스택의 supabase_admin 연결(127.0.0.1 고정)로 탐침한다.
//    역할 속성·멤버십 변경은 **트랜잭션 안의 카탈로그 변경**이라 마지막 raise 로 함께 되돌려진다 — finally 로 되돌리는 것보다
//    강하다(커밋 전이라 다른 세션은 끝까지 그 상태를 보지 못한다). 끝에서 되돌려졌는지 다시 확인한다.
// =============================================================================
describe.skipIf(!gate.allowed)("4. DB — 이빨 실측: 롤 속성·멤버십 · graphql_public (슈퍼유저 · 되돌림)", { timeout: 300_000 }, () => {
  withNotificationsLock();

  const SUPER_PROBE_SQL = [
    "do $p611s$",
    "declare payload text;",
    "begin",
    // ① BYPASSRLS — 두 관점(객체 ACL)은 그대로인데 reservations 의 RLS 가 통째로 꺼지는 사고
    "  alter role authenticated bypassrls;",
    // ② 사전 정의 롤 멤버십 — 전 표 읽기
    "  grant pg_read_all_data to anon;",
    // ③ INHERIT FALSE · SET TRUE — 상속 권한에는 안 보이지만 SET ROLE 로 전환 가능한 멤버십 (PG16+ 문법)
    "  if current_setting('server_version_num')::int >= 160000 then",
    "    execute 'grant pg_signal_backend to authenticated with inherit false, set true';",
    "  end if;",
    // ④ graphql_public 에 definer 함수 — 기본 권한이 anon·authenticated 에게 EXECUTE 를 연다
    "  create function graphql_public.p611_gate_probe_gql() returns int language sql security definer as $fn$ select 1 $fn$;",
    // ⑤ astra R2 P1-B — **허용된** 프레임워크 함수 자체를 definer 로 (pg_temp 를 넣어 definer 규칙은 통과하게)
    "  alter function graphql_public.graphql(text, text, jsonb, jsonb) security definer set search_path = public, pg_temp;",
    `  select string_agg(q.f, ';' order by q.f) into payload from (${FACTS_QUERY}) q where q.f like 'role%' or q.f like '%p611_gate_probe%' or q.f like '%graphql_public.graphql(%';`,
    `  raise exception '%', ${encodeFacts("select payload")};`,
    "end",
    "$p611s$;",
  ].join("\n");

  let superFacts: string[] = [];
  let superViolations: string[] = [];

  beforeAll(() => {
    superFacts = parseFacts(runLocalSuperuserSqlExpectingError(SUPER_PROBE_SQL));
    superViolations = evaluate(superFacts);
  }, 300_000);

  test("🔴 P1-4 — authenticated 에 BYPASSRLS 를 붙이면 이름을 대며 빨개진다", () => {
    expect(superFacts).toContain("roleattr|authenticated|rolbypassrls|true");
    expect(superViolations.join("\n")).toContain("authenticated — 롤 속성: rolbypassrls=true");
  });

  test("🔴 P1-4 — 멤버십(상속 · SET 전용 모두)을 도달 롤로 잡는다", () => {
    const text = superViolations.join("\n");
    expect(text).toContain("anon — 롤 멤버십: pg_read_all_data 에 도달한다");
    expect(text).toContain("authenticated — 롤 멤버십: pg_signal_backend 에 도달한다");
    const setOnly = superFacts.find((f) => f.startsWith("rolemember|authenticated|pg_signal_backend|")) ?? "";
    expect(setOnly, "SET 전용 멤버십의 옵션을 보존하지 않았다").toContain('"set_option": true');
    expect(setOnly).toContain('"inherit_option": false');
  });

  test("🔴 P1-5 — graphql_public 의 새 definer 함수를 이름으로 잡는다", () => {
    const text = superViolations.join("\n");
    expect(text).toContain("graphql_public.p611_gate_probe_gql() — 함수: anon 에게 EXECUTE");
    expect(text).toContain("graphql_public.p611_gate_probe_gql() — 함수: authenticated 에게 EXECUTE");
    expect(text).toContain("graphql_public.p611_gate_probe_gql() — definer 함수: search_path 에 pg_temp 가 없다");
    expect(text).toContain("graphql_public.p611_gate_probe_gql() — 함수 소유자가 supabase_admin 다");
  });

  test("🔴 R2 P1-B — 허용된 graphql 함수를 definer(search_path 에 pg_temp 포함)로 바꾸면 이름을 대며 빨개진다", () => {
    const G = "graphql_public.graphql(text,text,jsonb,jsonb)";
    const text = superViolations.filter((v) => v.startsWith(`${G} —`)).join("\n");
    expect(text, text).toContain(`${G} — 프레임워크 함수의 실행 모드가 기준선과 다르다`);
    expect(text, "definer 규칙(pg_temp)은 통과해야 탐침이 뜻대로다").not.toContain("definer 함수: search_path 에 pg_temp 가 없다");
  });

  test("되돌림 확인 — 롤 속성·멤버십·임시 함수가 남지 않았다", () => {
    const after = parseFacts(runLocalSql(FACTS_SQL));
    expect(after, "graphql 함수의 definer 전환이 커밋됐다").toContain("fnmode|graphql_public.graphql(text,text,jsonb,jsonb)|false|(none)");
    expect(after).toContain("roleattr|authenticated|rolbypassrls|false");
    expect(after.filter((f) => f.startsWith("rolemember|"))).toEqual([]);
    expect(after.filter((f) => f.includes("p611_gate_probe"))).toEqual([]);
  });
});
