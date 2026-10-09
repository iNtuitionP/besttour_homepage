/**
 * P6-9 (D8) — **앨범을 지우는 것이 공개 여부를 바꾸면 안 된다.**
 *
 * 사고의 모양: 0008 은 `album_id … on delete set null`(0008:61)과
 * `active and (album_id is null or exists (… a.active))`(0008:99-102)를 함께 정했다. 둘 다 각각은 옳은데,
 * 합치면 **비활성 앨범을 지우는 순간** 그 안의 활성 사진이 `album_id is null` 가지로 넘어가 **손님에게 공개된다.**
 * 사장님의 의도("안 보이게 해 뒀으니 지워도 되겠다")의 정확히 반대다.
 *
 * 불변식: **지우기 전에 안 보이던 사진은 지운 뒤에도 안 보인다. 보이던 앨범을 지우면 계속 보인다.**
 * 0015 의 `before delete` 트리거가 그것을 DB 에서 지킨다(애플리케이션이 아닌 이유는 그 파일 헤더).
 *
 * 이 파일이 잠그는 것:
 *   §1 되돌리면 안 되는 전제 — `on delete set null` 유지 · 공개 정책의 `album_id is null` 가지 유지
 *   §2 0015 의 형태 — before/row/when · security definer + search_path · EXECUTE 회수 · grant 0 · 표/정책 변경 0
 *   §3 롤백 파일의 규약 — migrations/ 밖 · 승인 플래그 요구 · 트리거와 함수를 둘 다 지운다
 *   §4 DB 실증 — 비활성/활성 두 경우의 anon 가시성, 사진 행과 원본 경로가 남는다, 트리거 함수 권한이 닫혔다
 *
 * DB 블록은 `gallery`·`gallery_albums` 에 행을 남긴다 → `withGalleryLock()`(CLAUDE.md §7 · P6-3b).
 * 통지 표는 건드리지 않으므로 잠금은 하나뿐이다.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { withGalleryLock } from "./helpers/db-lock";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";
import { runLocalSql } from "./helpers/local-stack-sql";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const exists = (rel: string): boolean => existsSync(path.join(ROOT, rel));

const MIGRATION = "supabase/migrations/0015_album_delete_keeps_visibility.sql";
const ROLLBACK = "supabase/rollbacks/0015_album_delete_keeps_visibility.down.sql";
const M0008 = "supabase/migrations/0008_gallery_albums.sql";

const FN = "gallery_album_delete_keep_visibility";
const TRIGGER = "gallery_albums_keep_visibility_on_delete";

/** SQL 주석을 걷어낸 본문. 주석에 적어 둔 설명 문장이 "코드에 그것이 있다" 로 오인되지 않게 한다. */
const sqlCode = (rel: string): string =>
  read(rel)
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");

// =============================================================================
// 0. 산출물
// =============================================================================
describe("0. 산출물", () => {
  test.for([[MIGRATION], [ROLLBACK]] as const)("%s 가 있다", ([rel]) => {
    expect(exists(rel), `${rel} 없음`).toBe(true);
  });

  test("롤백은 migrations/ 밖에 둔다 — CLI 가 migrations/ 를 전부 적용하기 때문이다", () => {
    expect(exists("supabase/migrations/0015_album_delete_keeps_visibility.down.sql")).toBe(false);
  });
});

// =============================================================================
// 1. 되돌리면 안 되는 전제 두 가지 (0008)
// =============================================================================
describe("1. 0008 의 전제는 그대로다", () => {
  const code = sqlCode(M0008);

  test("FK 는 여전히 on delete set null 이다 — cascade 면 Storage 고아 파일이 생긴다", () => {
    expect(code).toMatch(/album_id\s+int\s+references\s+gallery_albums\s*\(id\)\s+on delete set null/);
    expect(/references\s+gallery_albums\s*\(id\)\s+on delete cascade/.test(code)).toBe(false);
  });

  test("공개 정책의 `album_id is null` 가지가 살아 있다 — 없애면 앨범 이전의 평면 사진이 전부 사라진다", () => {
    expect(code).toMatch(/create policy gallery_select_active on gallery for select using \(/);
    expect(code).toMatch(/album_id is null or exists \(select 1 from gallery_albums a where a\.id = gallery\.album_id and a\.active\)/);
  });

  test("0015 는 그 정책도 FK 도 건드리지 않는다 — 트리거 하나만 더한다", () => {
    // 문장만 본다(행 첫 칸에서 시작하는 DDL). 자기검증 블록의 hint 문자열에는 고치는 법이 적혀 있고,
    // 그것까지 잡으면 "고치는 법을 적었다"는 이유로 실패한다.
    const stmts = sqlCode(MIGRATION);
    expect(/^\s*(create|drop|alter) policy/m.test(stmts), "0015 가 정책을 손댄다").toBe(false);
    expect(/^alter table/m.test(stmts), "0015 가 표 정의를 손댄다").toBe(false);
    expect(/^\s*alter table [a-z_]+\s+(add|drop|alter) /m.test(stmts), "0015 가 컬럼·제약을 손댄다").toBe(false);
    expect(/on delete cascade/.test(stmts), "0015 가 FK 를 cascade 로 바꾼다").toBe(false);
  });
});

// =============================================================================
// 2. 0015 의 형태
// =============================================================================
describe("2. 0015 — 트리거·함수의 형태", () => {
  const code = sqlCode(MIGRATION);

  test("before delete · for each row · when (not old.active) — 활성 앨범에서는 함수가 불리지도 않는다", () => {
    expect(code).toMatch(new RegExp(`create trigger ${TRIGGER}\\s+before delete on gallery_albums\\s+for each row\\s+when \\(not old\\.active\\)\\s+execute function ${FN}\\(\\)`));
    // after 로 붙이면 FK 의 set null 이 먼저 돌아 album_id 가 이미 null 이다 — 어느 사진이었는지 알 수 없다.
    expect(/after delete on gallery_albums/.test(code)).toBe(false);
    expect(/for each statement/.test(code)).toBe(false);
  });

  test("security definer + search_path 고정 (public, pg_temp) — pg_temp 를 빼면 암묵 검색이 맨 앞에 붙는다", () => {
    expect(code).toMatch(new RegExp(`create or replace function ${FN}\\(\\)[\\s\\S]{0,200}security definer`));
    expect(code).toMatch(/set search_path = public, pg_temp/);
  });

  test("EXECUTE 를 공개 롤에서 회수하고, 아무에게도 grant 하지 않는다 (트리거는 EXECUTE 없이 발화한다)", () => {
    const revoke = new RegExp(`revoke all on function ${FN}\\(\\) from public, anon, authenticated, service_role;`);
    expect(code).toMatch(revoke);
    // 회수는 반드시 create **뒤**여야 한다 — 이 DB 의 default privileges 가 create 시점에 EXECUTE 를 부여한다.
    expect(code.indexOf("create or replace function")).toBeLessThan(code.search(revoke));
    expect(new RegExp(`grant execute on function ${FN}`).test(code), "grant 가 있다 — 남길 롤이 없다").toBe(false);
  });

  test("사진 행을 지우지 않는다 — 바꾸는 컬럼은 active 하나뿐이다 (고아 파일 방지 의도 유지)", () => {
    expect(code).toMatch(/update gallery set active = false where album_id = old\.id and active;/);
    expect(/delete from gallery\b/.test(code), "0015 가 사진 행을 지운다").toBe(false);
    expect(/update gallery set [^;]*image_path|update gallery set [^;]*original_path/.test(code)).toBe(false);
  });

  test("자기검증 do 블록이 있다 — 트리거 부착 · EXECUTE 보유자 · 거동 세 가지를 실행 중에 못박는다", () => {
    expect(code).toMatch(/do \$\$/);
    expect(code).toMatch(/has_function_privilege\('anon'/);
    expect(code).toMatch(/aclexplode/);
    expect(code).toMatch(/pg_trigger/);
    // 거동 검사가 실제 행으로 돌고 되돌린다
    expect(code).toMatch(/insert into gallery_albums \(slug, title, sort, active\)/);
    expect(code).toMatch(/0015_probe_rollback/);
  });
});

// =============================================================================
// 3. 롤백 파일의 규약
// =============================================================================
describe("3. 롤백", () => {
  const code = sqlCode(ROLLBACK);

  test("승인 플래그를 요구한다 — 되돌린 뒤의 피해가 조용해서(오류 없이 공개) 손이 미끄러지면 안 된다", () => {
    expect(code).toMatch(/current_setting\('bestour\.rollback_0015_ack', true\)/);
    expect(code).toMatch(/raise exception '0015 롤백 중단:/);
    // 행 수를 보고 건너뛰는 분기가 없다 (0012 독립 리뷰 M2 와 같은 규약)
    expect(/if\s+\(?\s*select\s+count\(\*\)/.test(code), "행 수로 플래그를 건너뛴다").toBe(false);
  });

  test("트리거와 함수를 둘 다 지우고, 표·행·정책은 건드리지 않는다", () => {
    expect(code).toMatch(new RegExp(`drop trigger if exists ${TRIGGER} on gallery_albums;`));
    expect(code).toMatch(new RegExp(`drop function if exists ${FN}\\(\\);`));
    expect(/delete from|update .* set|alter table|drop table|create policy|drop policy/.test(code)).toBe(false);
  });

  test("내려간 사진을 되살리지 않는다 — 되살리면 이 롤백이 되돌리려는 것보다 큰 사고가 된다", () => {
    expect(/set active = true/.test(code)).toBe(false);
  });

  test("반쯤 지워진 상태로 끝나지 않게 검증한다", () => {
    expect(code).toMatch(/raise exception '0015 롤백: 트리거가 아직 붙어 있다'/);
    expect(code).toMatch(/to_regprocedure\('public\.gallery_album_delete_keep_visibility\(\)'\)/);
  });
});

// =============================================================================
// 4. DB 실증 — 로컬 스택 + REQUIRE_DB_TESTS=1 일 때만
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[album-delete-visibility.test] DB 실증 블록 skip — ${gate.reason}`);
}

describe.skipIf(!gate.allowed || !env.hasServiceRole)("4. DB — 삭제가 공개 여부를 바꾸지 않는다", () => {
  // gallery · gallery_albums 에 행을 남긴다 — 표 전체를 단언하는 블록(home 4-DB)과 줄 세운다.
  withGalleryLock();

  const svc = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
  const SLUG_PREFIX = `p69-${RUN}`;
  const PATH_PREFIX = `p69-${RUN}/`;

  async function rest(method: string, q: string, json?: unknown, prefer?: string, anon = false) {
    const key = anon ? (env.anonKey as string) : env.serviceRoleKey;
    const headers: Record<string, string> = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    const res = await fetch(`${env.restRoot}${q}`, {
      method,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* JSON 이 아니면 문자열 그대로 */
    }
    return { status: res.status, body };
  }

  async function makeAlbum(suffix: string, active: boolean): Promise<number> {
    const r = await rest(
      "POST",
      "/gallery_albums",
      { slug: `${SLUG_PREFIX}-${suffix}`, title: `P69 ${suffix}`, sort: 90000, active },
      "return=representation",
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return (r.body as { id: number }[])[0].id;
  }

  async function makePhoto(name: string, albumId: number | null, active = true): Promise<void> {
    const r = await rest(
      "POST",
      "/gallery",
      {
        image_path: `${PATH_PREFIX}${name}.webp`,
        original_path: `${PATH_PREFIX}${name}.orig`,
        sort: 90000,
        active,
        album_id: albumId,
      },
      "return=representation",
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }

  const like = (prefix: string) => encodeURIComponent(`*${prefix}*`);

  /** 서비스 롤로 본 사진 한 장(정책과 무관하게 행 자체가 있는가). */
  async function photoRow(name: string): Promise<{ active: boolean; album_id: number | null; original_path: string | null } | null> {
    const r = await rest("GET", `/gallery?select=active,album_id,original_path&image_path=eq.${encodeURIComponent(`${PATH_PREFIX}${name}.webp`)}`);
    const rows = r.body as { active: boolean; album_id: number | null; original_path: string | null }[];
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * anon 이 실제로 볼 수 있는 사진 이름들(= 0008 정책의 판정 결과).
   * `scope` 로 **그 테스트가 만든 행만** 본다 — 같은 describe 의 앞선 테스트가 남긴 행이 섞이면
   * 무엇이 보이는지가 실행 순서에 달라진다(첫 실행에서 실제로 섞였다).
   */
  async function anonVisible(scope: string): Promise<string[]> {
    const q = `/gallery?select=image_path&image_path=like.${like(`${PATH_PREFIX}${scope}`)}&order=image_path`;
    const r = await rest("GET", q, undefined, undefined, true);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return (r.body as { image_path: string }[]).map((x) => x.image_path.slice(PATH_PREFIX.length).replace(/\.webp$/, ""));
  }

  beforeAll(async () => {
    expect(env.anonKey, "공개 가시성 실증에는 anon 키가 필요하다").toBeTruthy();
    const probe = await rest("GET", "/gallery_albums?select=id&limit=1");
    if (probe.status !== 200) throw new Error(`0008 이 이 DB 에 적용되지 않았다 — HTTP ${probe.status}`);
  });

  afterAll(async () => {
    await rest("DELETE", `/gallery?image_path=like.${like(PATH_PREFIX)}`);
    await rest("DELETE", `/gallery_albums?slug=like.${like(SLUG_PREFIX)}`);
    const leftPhotos = await rest("GET", `/gallery?select=id&image_path=like.${like(PATH_PREFIX)}`);
    const leftAlbums = await rest("GET", `/gallery_albums?select=id&slug=like.${like(SLUG_PREFIX)}`);
    expect(leftPhotos.body).toEqual([]);
    expect(leftAlbums.body).toEqual([]);
  });

  test("🔴 비활성 앨범을 지워도 그 사진은 손님에게 보이지 않는다 (D8 그 자체)", async () => {
    const albumId = await makeAlbum("off", false);
    await makePhoto("off-1", albumId);

    expect(await anonVisible("off-"), "삭제 전 — 비활성 앨범의 사진은 숨겨져 있다").toEqual([]);

    const del = await rest("DELETE", `/gallery_albums?id=eq.${albumId}`);
    expect(del.status, JSON.stringify(del.body)).toBe(204);

    expect(await anonVisible("off-"), "삭제 후에도 여전히 0행이어야 한다 — 바뀌면 숨긴 사진이 공개된 것이다").toEqual([]);

    const row = await photoRow("off-1");
    expect(row, "사진 행이 사라졌다 — Storage 고아 파일이 생긴다").not.toBeNull();
    expect(row!.active, "active 가 false 로 내려가 있어야 한다").toBe(false);
    expect(row!.album_id, "FK 의 on delete set null 은 그대로 돈다").toBeNull();
    expect(row!.original_path, "원본 경로가 남아 있어야 나중에 지울 수 있다").toBe(`${PATH_PREFIX}off-1.orig`);
  });

  test("활성 앨범을 지우면 그 사진은 계속 보인다 — 반대 방향으로도 공개 여부가 바뀌지 않는다", async () => {
    const albumId = await makeAlbum("on", true);
    await makePhoto("on-1", albumId);

    expect(await anonVisible("on-")).toEqual(["on-1"]);

    const del = await rest("DELETE", `/gallery_albums?id=eq.${albumId}`);
    expect(del.status, JSON.stringify(del.body)).toBe(204);

    expect(await anonVisible("on-"), "보이던 사진이 사라졌다 — 활성 앨범 삭제에서 사진을 내리면 안 된다").toEqual(["on-1"]);

    const row = await photoRow("on-1");
    expect(row!.active).toBe(true);
    expect(row!.album_id).toBeNull();
  });

  test("이미 내려가 있던 사진은 그대로 · 미분류 사진은 아무 영향을 받지 않는다", async () => {
    const albumId = await makeAlbum("mixed", false);
    await makePhoto("mix-live", albumId, true);
    await makePhoto("mix-off", albumId, false);
    await makePhoto("mix-loose", null, true); // 미분류 — 앨범과 무관하다

    expect(await anonVisible("mix-"), "비활성 앨범의 사진은 숨겨지고 미분류만 보인다").toEqual(["mix-loose"]);

    const del = await rest("DELETE", `/gallery_albums?id=eq.${albumId}`);
    expect(del.status, JSON.stringify(del.body)).toBe(204);

    expect(await anonVisible("mix-"), "미분류 사진의 공개 여부는 그대로다").toEqual(["mix-loose"]);
    expect((await photoRow("mix-live"))!.active).toBe(false);
    expect((await photoRow("mix-off"))!.active).toBe(false);
    expect((await photoRow("mix-loose"))!.active).toBe(true);
    expect((await photoRow("mix-loose"))!.album_id).toBeNull();
  });

  test("앨범 여러 개를 한 번에 지워도 각 앨범의 상태대로 판정한다 (행 단위 트리거)", async () => {
    const offId = await makeAlbum("bulk-off", false);
    const onId = await makeAlbum("bulk-on", true);
    await makePhoto("bulk-off-1", offId);
    await makePhoto("bulk-on-1", onId);

    expect(await anonVisible("bulk-")).toEqual(["bulk-on-1"]);

    const del = await rest("DELETE", `/gallery_albums?slug=like.${like(`${SLUG_PREFIX}-bulk`)}`);
    expect(del.status, JSON.stringify(del.body)).toBe(204);

    expect(await anonVisible("bulk-")).toEqual(["bulk-on-1"]);
    expect((await photoRow("bulk-off-1"))!.active).toBe(false);
    expect((await photoRow("bulk-on-1"))!.active).toBe(true);
  });

  test("트리거가 붙어 있고, 공개 롤은 그 함수를 실행할 수 없다 (CLAUDE.md §3 — 기본권한이 되돌려 놓는다)", () => {
    const verdict = runLocalSql(
      "select 'trigger=' || coalesce((select pg_get_triggerdef(oid) from pg_trigger " +
        `where tgrelid = 'public.gallery_albums'::regclass and not tgisinternal and tgname = '${TRIGGER}'), '(none)') || ` +
        "' | secdef=' || coalesce((select prosecdef::text from pg_proc " +
        `where oid = to_regprocedure('public.${FN}()')::oid), '(none)') || ` +
        "' | searchpath=' || coalesce((select array_to_string(proconfig, ';') from pg_proc " +
        `where oid = to_regprocedure('public.${FN}()')::oid), '(none)') || ` +
        `' | anon=' || has_function_privilege('anon', 'public.${FN}()', 'execute')::text || ` +
        `' | authenticated=' || has_function_privilege('authenticated', 'public.${FN}()', 'execute')::text || ` +
        `' | service_role=' || has_function_privilege('service_role', 'public.${FN}()', 'execute')::text || ` +
        "' | execholders=' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, '+') " +
        "from pg_proc p cross join lateral aclexplode(p.proacl) a " +
        `where p.oid = to_regprocedure('public.${FN}()')::oid and a.privilege_type = 'EXECUTE'), '(none)') as verdict`,
    );

    expect(verdict, "0015 가 이 DB 에 적용되지 않았다").not.toContain("trigger=(none)");
    expect(verdict).toContain("BEFORE DELETE ON public.gallery_albums");
    expect(verdict).toContain("FOR EACH ROW");
    expect(verdict).toContain("WHEN ((NOT old.active))");
    expect(verdict).toContain("secdef=t");
    expect(verdict).toContain("searchpath=search_path=public, pg_temp");
    expect(verdict, "anon 이 트리거 함수를 실행할 수 있다").toContain("| anon=false");
    expect(verdict, "authenticated 가 트리거 함수를 실행할 수 있다").toContain("| authenticated=false");
    expect(verdict, "service_role 이 트리거 함수를 실행할 수 있다").toContain("| service_role=false");
    // EXECUTE 보유자는 소유자뿐 — PUBLIC 이 보이면 revoke 에서 public 이 빠진 것이다.
    expect(verdict).not.toContain("PUBLIC");
    // supabase CLI 를 프로세스로 띄우므로 기본 5초로는 모자라다(다른 pg_catalog 검증 테스트와 같은 사정).
  }, 120_000);
});
