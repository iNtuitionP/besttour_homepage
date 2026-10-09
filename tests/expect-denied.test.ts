/**
 * P6-13 — 거부 판정 헬퍼(`tests/helpers/expect-denied.ts`)의 계약.
 *
 * 1. 판정 — 응답 모양별로 무엇을 통과시키고 무엇을 막는가. **옛 단언(`status >= 400`)이 통과시키던 것**을 나란히 적어
 *    "새 판정이 무엇을 더 잡는가" 를 고정한다. 응답 모양은 2026-09-17 로컬 스택 실측값이다(P6-13 보고서 ①②).
 * 2. 제자리 재정의 금지 — 테스트 파일이 판정 함수를 다시 정의하면 실패한다(`stripComments`·DB 잠금과 같은 규약).
 *    판정을 쓰는 파일은 전부 이 헬퍼에서 가져온다.
 * 3. "400 이상이면 통과" 0건 — `tests/**` 어디에도 그 단언이 다시 생기면 실패한다.
 *
 * DB 를 건드리지 않는다(순수 함수 + 소스 텍스트). 실제 응답으로 거부/부재를 가르는 대조군은 각 DB 블록에 있다:
 * tests/write-privileges.test.ts §5 · tests/admin-auth.test.ts §7 · tests/admin-reservations.test.ts §7 · tests/admin-gallery.test.ts §8.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  type HttpResult,
  STORAGE_DELETE_DENIED_MESSAGE,
  STORAGE_RLS_MESSAGE,
  expectFunctionPrivilegeDenied,
  expectPermissionDenied,
  expectRaisedDenied,
  expectRlsInsertDenied,
  expectStorageDenied,
  expectStorageNotFound,
  expectTablePrivilegeDenied,
} from "./helpers/expect-denied";
import { stripComments } from "./helpers/strip-comments";

const TESTS_DIR = path.resolve(import.meta.dirname);

/** 옛 단언 — 이것이 통과시키던 것을 새 판정이 막는지 나란히 본다. */
const oldAccepts = (res: HttpResult) => res.status >= 400;
const passes = (fn: () => void) => {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
};

// ---- 실측 응답 (2026-09-17 로컬 스택 · P6-13 보고서 ①) ------------------------------------------------------------
const pg = (status: number, code: string, message: string): HttpResult => ({
  status,
  body: { code, details: null, hint: null, message },
});
const GRANT_DENIED = pg(403, "42501", "permission denied for table reservations");
const GRANT_DENIED_ANON = pg(401, "42501", "permission denied for table reservations");
const RLS_DENIED = pg(403, "42501", 'new row violates row-level security policy for table "notices"');
const EXECUTE_DENIED = pg(401, "42501", "permission denied for function is_admin");
const GUARD_DENIED = pg(403, "42501", "admin_confirm_reservation: 관리자 명단에 없는 호출자다");
const MISSING_TABLE = pg(404, "PGRST205", "Could not find the table 'public.p613_no_such_table' in the schema cache");
const MISSING_FUNCTION = pg(404, "PGRST202", "Could not find the function public.p613_no_such_fn(p_id) in the schema cache");
const BAD_COLUMN = pg(400, "PGRST204", "Could not find the 'p613_no_col' column of 'notices' in the schema cache");
const UNIQUE = pg(409, "23505", 'duplicate key value violates unique constraint "showcase_routes_origin_code_destination_code_key"');
/** 서버 고장 흉내 — PostgreSQL internal_error 가 그대로 올라온 모양. */
const SERVER_ERROR = pg(500, "XX000", "simulated internal error");
/** 상태는 거부처럼 보이지만 SQLSTATE 가 없는 응답(프록시·게이트웨이가 만든 403 등). */
const BARE_403: HttpResult = { status: 403, body: { message: "Forbidden" } };

const st = (status: number, statusCode: string, error: string, code: string, message: string): HttpResult => ({
  status,
  body: { statusCode, error, code, message },
});
const S_WRITE_DENIED = st(400, "403", "Unauthorized", "AccessDenied", STORAGE_RLS_MESSAGE);
const S_DELETE_DENIED = st(400, "403", "Unauthorized", "AccessDenied", STORAGE_DELETE_DENIED_MESSAGE);
const S_NO_KEY = st(400, "404", "not_found", "NoSuchKey", "Object not found");
const S_NO_BUCKET = st(400, "404", "Bucket not found", "NoSuchBucket", "Bucket not found");
const S_DUPLICATE = st(400, "409", "Duplicate", "KeyAlreadyExists", "The resource already exists");
const S_SERVER_ERROR = st(500, "500", "internal", "InternalError", "simulated internal error");
/** 포장을 벗긴 판(HTTP 상태 = 본문 상태)도 받아들인다 — storage-api 버전에 따라 이 모양이 온다. */
const S_WRITE_DENIED_UNWRAPPED: HttpResult = { status: 403, body: { statusCode: 403, error: "Unauthorized", code: "AccessDenied", message: STORAGE_RLS_MESSAGE } };
/** 본문은 거부인데 HTTP 가 5xx — 게이트웨이가 망가진 상황. 통과시키면 안 된다. */
const S_DENIED_BODY_BUT_500 = st(500, "403", "Unauthorized", "AccessDenied", STORAGE_RLS_MESSAGE);

describe("1. 판정 — PostgREST", () => {
  test("expectPermissionDenied — 401/403 + 42501 만 통과 (P5-13 원형 그대로)", () => {
    for (const ok of [GRANT_DENIED, GRANT_DENIED_ANON, RLS_DENIED, EXECUTE_DENIED, GUARD_DENIED]) {
      expect(passes(() => expectPermissionDenied(ok, "t")), JSON.stringify(ok)).toBe(true);
    }
    for (const bad of [SERVER_ERROR, MISSING_TABLE, MISSING_FUNCTION, BAD_COLUMN, UNIQUE, BARE_403, { status: 204, body: null }]) {
      expect(passes(() => expectPermissionDenied(bad, "t")), JSON.stringify(bad)).toBe(false);
    }
  });

  test("옛 단언은 서버 고장·부재·검증 실패·중복을 전부 '거부' 로 통과시켰다 — 새 판정은 전부 막는다", () => {
    for (const bad of [SERVER_ERROR, MISSING_TABLE, MISSING_FUNCTION, BAD_COLUMN, UNIQUE, BARE_403]) {
      expect(oldAccepts(bad), `옛 단언 재현: ${JSON.stringify(bad)}`).toBe(true);
      for (const judge of [
        () => expectPermissionDenied(bad, "t"),
        () => expectTablePrivilegeDenied(bad, "reservations", "t"),
        () => expectFunctionPrivilegeDenied(bad, "is_admin", "t"),
        () => expectRlsInsertDenied(bad, "notices", "t"),
        () => expectRaisedDenied(bad, "admin_confirm_reservation: 관리자 명단에 없는 호출자다", "t"),
      ]) {
        expect(passes(judge), JSON.stringify(bad)).toBe(false);
      }
    }
  });

  test("무엇이 막았는지 — GRANT · EXECUTE · RLS · 함수 가드는 서로의 판정을 통과하지 못한다", () => {
    const cases: [HttpResult, () => void, (r: HttpResult) => void][] = [
      [GRANT_DENIED, () => expectTablePrivilegeDenied(GRANT_DENIED, "reservations", "t"), (r) => expectRlsInsertDenied(r, "reservations", "t")],
      [RLS_DENIED, () => expectRlsInsertDenied(RLS_DENIED, "notices", "t"), (r) => expectTablePrivilegeDenied(r, "notices", "t")],
      [EXECUTE_DENIED, () => expectFunctionPrivilegeDenied(EXECUTE_DENIED, "is_admin", "t"), (r) => expectRaisedDenied(r, "is_admin", "t")],
      [
        GUARD_DENIED,
        () => expectRaisedDenied(GUARD_DENIED, "admin_confirm_reservation: 관리자 명단에 없는 호출자다", "t"),
        (r) => expectFunctionPrivilegeDenied(r, "admin_confirm_reservation", "t"),
      ],
    ];
    for (const [res, own, other] of cases) {
      expect(passes(own), `자기 판정이 실측 응답을 못 받는다: ${JSON.stringify(res)}`).toBe(true);
      expect(passes(() => other(res)), `다른 판정이 받아들였다: ${JSON.stringify(res)}`).toBe(false);
    }
    // 표·함수 이름까지 본다 — 다른 표의 거부는 이 표의 거부가 아니다
    expect(passes(() => expectTablePrivilegeDenied(GRANT_DENIED, "notifications_log", "t"))).toBe(false);
    expect(passes(() => expectRlsInsertDenied(RLS_DENIED, "popups", "t"))).toBe(false);
  });
});

describe("1-S. 판정 — Storage", () => {
  test("expectStorageDenied — 본문 statusCode 403 + AccessDenied, HTTP 는 포장(400) 또는 본문과 같은 403", () => {
    for (const ok of [S_WRITE_DENIED, S_DELETE_DENIED, S_WRITE_DENIED_UNWRAPPED]) {
      expect(passes(() => expectStorageDenied(ok, "t")), JSON.stringify(ok)).toBe(true);
    }
    for (const bad of [S_NO_KEY, S_NO_BUCKET, S_DUPLICATE, S_SERVER_ERROR, S_DENIED_BODY_BUT_500, { status: 200, body: { Key: "x" } }]) {
      expect(passes(() => expectStorageDenied(bad, "t")), JSON.stringify(bad)).toBe(false);
    }
    // 메시지를 넘기면 동작(올리기·지우기)까지 맞춘다
    expect(passes(() => expectStorageDenied(S_WRITE_DENIED, "t", STORAGE_RLS_MESSAGE))).toBe(true);
    expect(passes(() => expectStorageDenied(S_DELETE_DENIED, "t", STORAGE_RLS_MESSAGE))).toBe(false);
    // PostgREST 판정은 Storage 거부를 받지 않는다(42501 이 없다) — 억지로 42501 을 기대하면 영원히 빨갛다
    expect(passes(() => expectPermissionDenied(S_WRITE_DENIED, "t"))).toBe(false);
  });

  test("옛 단언은 Storage 의 부재·중복·서버 고장을 전부 '거부' 로 통과시켰다 — 새 판정은 막는다", () => {
    for (const bad of [S_NO_KEY, S_NO_BUCKET, S_DUPLICATE, S_SERVER_ERROR, S_DENIED_BODY_BUT_500]) {
      expect(oldAccepts(bad), JSON.stringify(bad)).toBe(true);
      expect(passes(() => expectStorageDenied(bad, "t")), JSON.stringify(bad)).toBe(false);
    }
  });

  test("expectStorageNotFound — 코드까지 맞아야 통과하고, 거부·서버 고장은 부재가 아니다", () => {
    expect(passes(() => expectStorageNotFound(S_NO_KEY, "NoSuchKey", "t"))).toBe(true);
    expect(passes(() => expectStorageNotFound(S_NO_BUCKET, "NoSuchBucket", "t"))).toBe(true);
    expect(passes(() => expectStorageNotFound(S_NO_KEY, "NoSuchBucket", "t"))).toBe(false);
    expect(passes(() => expectStorageNotFound(S_NO_BUCKET, "NoSuchKey", "t"))).toBe(false);
    for (const bad of [S_WRITE_DENIED, S_SERVER_ERROR, S_DUPLICATE, { status: 404, body: "Not Found" }]) {
      expect(passes(() => expectStorageNotFound(bad, "NoSuchKey", "t")), JSON.stringify(bad)).toBe(false);
    }
  });
});

// =============================================================================
// 2. 제자리 재정의 금지
// =============================================================================
const HELPER_REL = "helpers/expect-denied.ts";
const JUDGES = [
  "expectPermissionDenied",
  "expectTablePrivilegeDenied",
  "expectFunctionPrivilegeDenied",
  "expectRlsInsertDenied",
  "expectRaisedDenied",
  "expectStorageDenied",
  "expectStorageNotFound",
] as const;
/** 판정 함수를 **정의**하는 형태 — 선언문·변수 대입. 이 파일 소스에 정의 문장이 그대로 나타나지 않도록 이름을 런타임에 끼운다. */
const definesJudge = (src: string) =>
  JUDGES.filter((name) => new RegExp(`\\b(?:function\\s*\\*?|const|let|var)\\s+${name}\\b`).test(src));
const importsJudgeFromHelper = (src: string, name: string) =>
  new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']\\.\\/helpers\\/expect-denied["']`).test(src);

function listTestSources(dir = TESTS_DIR, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.isDirectory()) return d.name === "node_modules" ? [] : listTestSources(path.join(dir, d.name), `${prefix}${d.name}/`);
    return d.name.endsWith(".ts") ? [`${prefix}${d.name}`] : [];
  });
}

/**
 * 원문·주석 제거본을 파일마다 **한 번만** 만든다. 제거는 TypeScript 파서라 무겁다 — 테스트마다 전 파일을 다시 파싱하면
 * 전량 실행의 부하 아래에서 5초 제한을 넘는다(2026-09-17 실측: 단독 2~4초 · 전량 실행 중 시간 초과).
 */
const rawCache = new Map<string, string>();
const codeCache = new Map<string, string>();
const rawOf = (rel: string) => {
  let v = rawCache.get(rel);
  if (v === undefined) rawCache.set(rel, (v = readFileSync(path.join(TESTS_DIR, rel), "utf-8")));
  return v;
};
const codeOf = (rel: string) => {
  let v = codeCache.get(rel);
  if (v === undefined) codeCache.set(rel, (v = stripComments(rawOf(rel), rel)));
  return v;
};

describe("2. 제자리 재정의 금지 — 판정은 헬퍼 하나뿐이다", { timeout: 60_000 }, () => {
  const files = listTestSources().filter((f) => f !== HELPER_REL);

  test("tests/** 어디에도 판정 함수의 제자리 정의가 없다", () => {
    const offenders = files.flatMap((file) => definesJudge(codeOf(file)).map((n) => `${file}: ${n}`));
    expect(offenders, "판정을 제자리에 다시 만들었다 — tests/helpers/expect-denied.ts 에서 import 할 것").toEqual([]);
  });

  test("판정을 부르는 파일은 전부 헬퍼에서 가져온다", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const name of JUDGES) {
        if (new RegExp(`\\b${name}\\(`).test(codeOf(file)) && !importsJudgeFromHelper(rawOf(file), name)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("헬퍼 자신은 일곱 판정을 전부 정의한다 (탐지식이 정의를 알아본다)", () => {
    expect(definesJudge(rawOf(HELPER_REL))).toEqual([...JUDGES]);
  });

  test("탐지가 낡지 않았다 — 옛 지역 정의(write-privileges 의 원형)와 화살표 변종을 잡는다", () => {
    const [name] = JUDGES;
    const legacy = [`    ${"func"}tion ${name}(res: Res, what: string): void {`, "      expect([401, 403]).toContain(res.status);", "    }"].join("\n");
    const arrow = `const ${name} = (res: Res) => expect(res.status).toBe(403);`;
    expect(definesJudge(legacy)).toEqual([name]);
    expect(definesJudge(arrow)).toEqual([name]);
    expect(definesJudge(`import { ${name} } from "./helpers/expect-denied";\n${name}(r, "x");`)).toEqual([]);
  });

  test("P6-13 이 조인 8개 파일은 헬퍼를 import 해 실제로 부른다", () => {
    for (const f of [
      "write-privileges.test.ts",
      "admin-auth.test.ts",
      "admin-gallery.test.ts",
      "admin-reservations.test.ts",
      "admin-notifications.test.ts",
      "admin-routes.test.ts",
      "admin-notices.test.ts",
      "admin-popups.test.ts",
    ]) {
      const used = JUDGES.filter((n) => new RegExp(`\\b${n}\\(`).test(codeOf(f)));
      expect(used.length, `${f} 가 판정 헬퍼를 부르지 않는다`).toBeGreaterThan(0);
      for (const n of used) expect(importsJudgeFromHelper(rawOf(f), n), `${f}: ${n}`).toBe(true);
    }
  });
});

// =============================================================================
// 3. "400 이상이면 통과" 0건
// =============================================================================
/** 이 파일 소스에 그대로 나타나지 않도록 조립한다 — 그대로 적으면 이 파일 자신이 걸린다. */
const LOOSE_4XX = new RegExp(["toBeGreaterThan", "OrEqual\\(\\s*400\\s*\\)"].join(""));

describe("3. 느슨한 거부 단언 0건", { timeout: 60_000 }, () => {
  // 제목에 그 단언을 글자 그대로 적지 않는다 — 문자열은 주석 제거 뒤에도 남아 이 파일 자신이 걸린다(실제로 한 번 빨개졌다).
  test("tests/** 어디에도 '400 이상이면 통과' 단언이 없다 — 응답 모양에 맞는 판정을 쓸 것", () => {
    const offenders = listTestSources()
      .filter((f) => LOOSE_4XX.test(codeOf(f)))
      .sort();
    expect(
      offenders,
      "500(서버 고장)·404(이름 오타)·409(중복)까지 통과시키는 단언이다. PostgREST 거부는 expectPermissionDenied 계열, " +
        "Storage 는 expectStorageDenied/expectStorageNotFound, 그 밖의 실패는 정확한 상태·코드로 단언할 것 (P6-13)",
    ).toEqual([]);
  });

  test("탐지가 낡지 않았다 — 공백 변형까지 잡고, 다른 문턱은 잡지 않는다", () => {
    const m = ["expect(r.status).toBeGreaterThan", "OrEqual(400);"].join("");
    expect(LOOSE_4XX.test(m)).toBe(true);
    expect(LOOSE_4XX.test(m.replace("(400)", "( 400 )"))).toBe(true);
    expect(LOOSE_4XX.test(m.replace("400", "4000"))).toBe(false);
    expect(LOOSE_4XX.test("expect(r.status).toBeLessThan(500);")).toBe(false);
  });
});
