/**
 * P6-1 — 갤러리 앨범 스키마(0008) + 읽기 계층 계약 테스트 (플랜 v4 P6-1 · 스펙 §13.9 (5)).
 *
 * 왜: 지금 gallery 는 `sort int` 하나로 정렬하는 평면 목록이라 수백 장을 넘기면 사장님도 방문자도 다룰 수 없다.
 * 0008 이 gallery_albums 를 세우고 gallery 에 album_id·width·height·bytes·original_path·created_at 을 더한다.
 *
 * 브리프 §검증 1~8:
 *   1. 0008 SQL 텍스트 — 테이블·컬럼·CHECK·FK(on delete set null)·인덱스·정책 2종·RLS enable
 *   2. 0001 은 수정하지 않았다 — 정규화 sha256 고정 + 원문 정책 존치
 *   3. 롤백 텍스트 — begin;/commit; · 행이 있으면 raise exception · delete 0 · 정책 원문 복원
 *   4. getAlbums · getAlbumBySlug — select 화이트리스트, 잘못된 slug 는 DB 에 가지 않고 null
 *   5. getGalleryPage — limit + 1 을 읽어 hasMore 판정(count 쿼리 금지), 경계값, albumId 필터
 *   6. 공개 읽기 타입에 bytes·originalPath 키 없음(컴파일 타임 + 코드 텍스트)
 *   7. getGallery 회귀 0 — 시그니처·select·정렬·limit 규칙 그대로
 *   8. DB 실증 — 로컬 스택 가드 뒤에서만. 비활성 앨범의 활성 사진이 anon 에게 0행, 앨범 삭제 시 사진은 남고 album_id 만 null
 *
 * 주의: tests/ 아래라 게이트 3종의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  ALBUM_SLUG_MAX_LENGTH,
  DEFAULT_GALLERY_LIMIT,
  MAX_GALLERY_PAGE_LIMIT,
  QUERY_TAGS,
  getAlbumBySlug,
  getAlbums,
  getGallery,
  getGalleryPage,
  mapGalleryRows,
  parseAlbumSlug,
  type AlbumRow,
  type GalleryRow,
} from "@/lib/queries";
import type { AnonClient } from "@/lib/supabase/anon";
import type { GalleryAlbum, GalleryItem } from "@/lib/types";
import { withGalleryLock } from "./helpers/db-lock";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const ROLLBACKS_DIR = path.join(ROOT, "supabase", "rollbacks");
const UP_SQL_PATH = path.join(MIGRATIONS_DIR, "0008_gallery_albums.sql");
const DOWN_SQL_PATH = path.join(ROLLBACKS_DIR, "0008_gallery_albums.down.sql");
const INIT_SQL_PATH = path.join(MIGRATIONS_DIR, "0001_init.sql");

/**
 * 0001_init.sql 의 정규화(CRLF→LF) sha256. 0008 은 0001 을 한 글자도 바꾸지 않는다 —
 * 원격에 이미 적용된 파일이라 수정하면 마이그레이션 이력과 실제 스키마가 갈린다(0002·0003·0006 헤더와 같은 규약).
 * 0001 을 정말 바꿔야 하는 날이 오면 그것은 별도 마이그레이션이지 이 해시를 고치는 일이 아니다.
 */
const INIT_SQL_SHA256 = "8b107b04a5f147708a3865e241ce83d97df63eb3cf2e753513f8baa1e81188d6";

const readSql = (p: string) => readFileSync(p, "utf-8");
const normalize = (s: string) => s.replace(/\r\n/g, "\n");
const compact = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const commentLines = (sql: string) => sql.split("\n").filter((l) => /^\s*--/.test(l)).join("\n");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

// =============================================================================
// 1. supabase/migrations/0008_gallery_albums.sql — 텍스트
// =============================================================================
describe("1. supabase/migrations/0008_gallery_albums.sql", () => {
  test("존재하고, 0008 번호는 이 파일 하나뿐이다. migrations/ 안에 롤백 파일이 섞여 있지 않다", () => {
    expect(existsSync(UP_SQL_PATH)).toBe(true);
    expect(readdirSync(MIGRATIONS_DIR).filter((f) => /^0008_/.test(f))).toEqual(["0008_gallery_albums.sql"]);
    const stray = readdirSync(MIGRATIONS_DIR).filter((f) => /^[0-9]+_.*\.sql$/.test(f) && /\.down\.sql$|rollback/i.test(f));
    expect(stray).toEqual([]);
  });

  test("gallery_albums — id serial pk · slug text unique not null · title not null · description · sort · active · created_at", () => {
    const code = compact(stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH));
    expect(code).toContain("create table if not exists gallery_albums");
    expect(code).toMatch(/id serial primary key/);
    expect(code).toMatch(/slug\s+text\s+unique not null/);
    expect(code).toMatch(/title\s+text\s+not null/);
    expect(code).toMatch(/description\s+text/);
    expect(code).toMatch(/sort\s+int\s+not null default 0/);
    expect(code).toMatch(/active\s+boolean\s+not null default true/);
    expect(code).toMatch(/created_at\s+timestamptz\s+not null default now\(\)/);
  });

  test("slug CHECK — 소문자·숫자·하이픈 정규식 + 길이 1~40 (URL 세그먼트로 그대로 쓰인다)", () => {
    const code = compact(stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH));
    expect(code).toContain("^[a-z0-9]+(-[a-z0-9]+)*$");
    expect(code).toMatch(/char_length\(slug\) between 1 and 40/);
  });

  test("gallery 는 alter 로만 넓힌다 — 재생성·drop table·drop column 0건", () => {
    const code = compact(stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH));
    expect(code).toContain("alter table gallery");
    expect(code).not.toContain("create table if not exists gallery (");
    expect(code).not.toMatch(/drop table/);
    expect(code).not.toMatch(/drop column/);
    expect(code).not.toMatch(/\bdelete from\b/);
    expect(code).not.toMatch(/\btruncate\b/);
  });

  test("album_id — int null 허용 + references gallery_albums (id) on delete set null (앨범을 지워도 사진은 남는다)", () => {
    const code = compact(stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH));
    expect(code).toMatch(/album_id\s+int\s+references gallery_albums\s*\(\s*id\s*\) on delete set null/);
    // null 허용이어야 한다 — not null 을 붙이면 기존 행과 미분류 사진이 들어갈 자리가 없다
    expect(code).not.toMatch(/album_id\s+int\s+not null/);
    expect(code).not.toMatch(/on delete cascade/);
  });

  test("width·height·bytes — int, null 허용, 값이 있으면 > 0 CHECK · original_path text · created_at 기본값", () => {
    const code = compact(stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH));
    for (const col of ["width", "height", "bytes"]) {
      expect(code, col).toMatch(new RegExp(`${col}\\s+int\\b`));
      expect(code, col).toMatch(new RegExp(`check \\(${col} is null or ${col} > 0\\)`));
    }
    expect(code).toMatch(/original_path\s+text/);
    expect(code).toMatch(/alter table gallery[\s\S]*created_at\s+timestamptz not null default now\(\)/);
  });

  test("변환본 경로를 컬럼으로 늘리지 않는다 — image_path 하나뿐(1600/800/400 컬럼 없음)", () => {
    const code = compact(stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH));
    for (const bad of ["image_path_1600", "image_path_800", "image_path_400", "thumb_path", "medium_path", "large_path"]) {
      expect(code, bad).not.toContain(bad);
    }
    // 그 결정의 근거가 헤더 주석에 남아 있어야 한다(왜 스키마를 변환 전략에 묶지 않는가)
    expect(commentLines(readSql(UP_SQL_PATH))).toMatch(/1600|변환/);
  });

  test("인덱스 — gallery (album_id, sort, id) 앨범별 페이지네이션 경로", () => {
    const code = compact(stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH));
    expect(code).toMatch(/create index if not exists gallery_album_sort_idx on gallery \(album_id, sort, id\)/);
  });

  test("RLS — gallery_albums enable + gallery_albums_select_active using (active)", () => {
    const code = compact(stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH));
    expect(code).toContain("alter table gallery_albums enable row level security");
    expect(code).toContain("drop policy if exists gallery_albums_select_active on gallery_albums");
    expect(code).toMatch(/create policy gallery_albums_select_active on gallery_albums for select using \(active\)/);
  });

  test("gallery_select_active 교체 — 이름은 유지하고 EXISTS 절로 비활성 앨범의 사진을 가린다", () => {
    const code = compact(stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH));
    expect(code).toContain("drop policy if exists gallery_select_active on gallery");
    expect(code).toContain("create policy gallery_select_active on gallery for select using");
    expect(code).toMatch(/album_id is null or exists \(\s*select 1 from gallery_albums a where a\.id = gallery\.album_id and a\.active\s*\)/);
    // 0001 원문(그냥 active) 그대로 남겨 두면 비활성 앨범 사진이 그대로 보인다
    expect(code).not.toMatch(/create policy gallery_select_active on gallery for select using \(active\);/);
  });

  test("주석에 왜(스펙 §13.9)와 롤백 경로가 있다", () => {
    const comments = commentLines(readSql(UP_SQL_PATH));
    expect(comments).toMatch(/13\.9/);
    expect(comments).toMatch(/rollbacks\/0008_gallery_albums\.down\.sql/);
  });
});

// =============================================================================
// 2. 0001_init.sql 은 한 글자도 바뀌지 않았다
// =============================================================================
describe("2. 0001_init.sql 불변", () => {
  test("정규화(CRLF→LF) sha256 이 고정값과 같다", () => {
    const hash = createHash("sha256").update(normalize(readSql(INIT_SQL_PATH))).digest("hex");
    expect(hash).toBe(INIT_SQL_SHA256);
  });

  test("0001 의 gallery 정책 원문(using (active))은 그 파일에 그대로 남아 있다 — 교체는 0008 이 런타임에 한다", () => {
    const code = compact(stripComments(readSql(INIT_SQL_PATH), INIT_SQL_PATH));
    expect(code).toContain("create policy gallery_select_active on gallery for select using (active);");
    expect(code).not.toContain("gallery_albums");
  });
});

// =============================================================================
// 3. supabase/rollbacks/0008_gallery_albums.down.sql
// =============================================================================
describe("3. supabase/rollbacks/0008_gallery_albums.down.sql", () => {
  test("rollbacks/ 에 있고 트랜잭션 안에서 돈다 + 수동 실행·repair 안내 주석 (0006·0007 규약)", () => {
    expect(existsSync(DOWN_SQL_PATH)).toBe(true);
    const raw = readSql(DOWN_SQL_PATH);
    expect(raw).toMatch(/\bbegin;/);
    expect(raw).toMatch(/\bcommit;/);
    expect(commentLines(raw)).toMatch(/migration repair --status reverted 0008/);
  });

  test("좁히는 롤백 — 앨범 행이 있으면 raise exception 으로 멈춘다(사람이 판단). 데이터를 조용히 지우지 않는다", () => {
    const code = compact(stripComments(readSql(DOWN_SQL_PATH), DOWN_SQL_PATH));
    expect(code).toMatch(/select count\(\*\) into .* from gallery_albums/);
    expect(code).toMatch(/raise exception/);
    expect(code).not.toMatch(/\bdelete from\b/);
    expect(code).not.toMatch(/\btruncate\b/);
    expect(code).not.toMatch(/update gallery set/);
  });

  test("정책은 0001 원문으로 복원하고, 0008 이 더한 것만 되돌린다", () => {
    const code = compact(stripComments(readSql(DOWN_SQL_PATH), DOWN_SQL_PATH));
    expect(code).toMatch(/create policy gallery_select_active on gallery for select using \(active\)/);
    expect(code).not.toContain("exists (select 1 from gallery_albums");
    expect(code).toContain("drop index if exists gallery_album_sort_idx");
    for (const col of ["album_id", "width", "height", "bytes", "original_path", "created_at"]) {
      expect(code, col).toMatch(new RegExp(`drop column if exists ${col}`));
    }
    expect(code).toContain("drop table if exists gallery_albums");
  });

  test("가드가 보는 컬럼 = 롤백이 drop 하는 컬럼 (N3 — created_at 포함)", () => {
    const code = compact(stripComments(readSql(DOWN_SQL_PATH), DOWN_SQL_PATH));
    const guard = code.slice(code.indexOf("select count(*) into metas"), code.indexOf("raise exception", code.indexOf("into metas")));
    for (const col of ["album_id", "width", "height", "bytes", "original_path", "created_at"]) {
      expect(guard, col).toContain(`${col} is not null`);
    }
  });

  test("재실행 가능 — 가드가 이미 사라진 대상을 보지 않는다 (N2)", () => {
    const code = compact(stripComments(readSql(DOWN_SQL_PATH), DOWN_SQL_PATH));
    // 테이블이 없으면 앨범 가드를 건너뛴다
    expect(code).toMatch(/to_regclass\('public\.gallery_albums'\) is null/);
    // 컬럼이 없으면 업로드 메타 가드를 건너뛴다
    expect(code).toMatch(/information_schema\.columns[\s\S]*column_name = 'original_path'/);
    // 테이블이 없는데 drop policy … on gallery_albums 를 맨몸으로 부르면 죽는다 — 존재 확인 뒤에만 부른다
    expect(code).toMatch(/to_regclass\('public\.gallery_albums'\) is not null[\s\S]*drop policy if exists gallery_albums_select_active/);
  });
});

// =============================================================================
// 4. lib/queries/albums.ts — parseAlbumSlug · getAlbums · getAlbumBySlug (mock 클라이언트, 네트워크 없음)
// =============================================================================
type Call = { method: string; args: unknown[] };

/** 모든 메서드가 자기 자신을 돌려주는 체인 + thenable. from/select/eq/order/range/… 호출을 기록한다. */
function fakeClient(result: { data: unknown; error: { code?: string; message: string } | null }): { client: AnonClient; calls: Call[] } {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "select", "eq", "is", "order", "limit", "range", "maybeSingle", "single", "overrideTypes"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return { client: chain as unknown as AnonClient, calls };
}

const ALBUM_ROW: AlbumRow = {
  id: 4,
  slug: "airport-pickup",
  title: "공항 픽업",
  description: null,
  sort: 1,
  active: true,
  created_at: "2026-09-13T00:00:00+00:00",
};

const selectCols = (calls: Call[]) =>
  String(calls.find((c) => c.method === "select")?.args[0] ?? "").split(",").map((s) => s.trim());

describe("4. lib/queries/albums.ts", () => {
  test("parseAlbumSlug — 0008 CHECK 와 같은 규칙(소문자·숫자·하이픈, 1~40자)만 통과", () => {
    for (const ok of ["a", "airport-pickup", "bus45", "2026-workshop", "a".repeat(ALBUM_SLUG_MAX_LENGTH)]) {
      expect(parseAlbumSlug(ok), ok).toBe(ok);
    }
    for (const bad of [
      "",
      "../etc",
      "Airport",
      "AIRPORT",
      "a".repeat(ALBUM_SLUG_MAX_LENGTH + 1),
      "-lead",
      "trail-",
      "double--hyphen",
      "has space",
      "has_underscore",
      "한글",
      "slash/here",
      "dot.here",
      "%2e%2e",
      "a'; drop table gallery_albums; --",
    ]) {
      expect(parseAlbumSlug(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(ALBUM_SLUG_MAX_LENGTH).toBe(40);
  });

  test("getAlbumBySlug — 형식이 틀리면 DB 에 가지 않는다 (from 조차 부르지 않는다)", async () => {
    const { client, calls } = fakeClient({ data: ALBUM_ROW, error: null });
    for (const bad of ["../etc", "Airport", "a".repeat(41), "", "a'; drop table gallery_albums; --"]) {
      expect(await getAlbumBySlug(bad, client), bad).toBeNull();
    }
    expect(calls).toEqual([]);
  });

  test("getAlbumBySlug — slug + active 로 한 건, 부재는 null", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    expect(await getAlbumBySlug("airport-pickup", client)).toBeNull();
    expect(calls.find((c) => c.method === "from")?.args).toEqual(["gallery_albums"]);
    const eqs = calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual(expect.arrayContaining([["slug", "airport-pickup"], ["active", true]]));
    expect(calls.some((c) => c.method === "maybeSingle")).toBe(true);
  });

  test("getAlbumBySlug — 존재하면 GalleryAlbum 뷰(camelCase, 컬럼을 버리지 않는다)", async () => {
    const { client } = fakeClient({ data: ALBUM_ROW, error: null });
    expect(await getAlbumBySlug("airport-pickup", client)).toEqual<GalleryAlbum>({
      id: 4,
      slug: "airport-pickup",
      title: "공항 픽업",
      description: null,
      sort: 1,
      active: true,
      createdAt: "2026-09-13T00:00:00+00:00",
    });
  });

  test("getAlbums — 활성만, sort 오름차순(동률은 id)", async () => {
    const { client, calls } = fakeClient({ data: [ALBUM_ROW], error: null });
    const albums = await getAlbums(client);
    expect(albums.map((a) => a.slug)).toEqual(["airport-pickup"]);
    expect(calls.find((c) => c.method === "from")?.args).toEqual(["gallery_albums"]);
    expect(calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([["active", true]]);
    const orders = calls.filter((c) => c.method === "order").map((c) => c.args[0]);
    expect(orders).toEqual(["sort", "id"]);
    for (const o of calls.filter((c) => c.method === "order")) {
      expect((o.args[1] as { ascending: boolean }).ascending).toBe(true);
    }
  });

  test("select 컬럼 화이트리스트 — `*` 없음, bytes·original_path 없음", async () => {
    const { client, calls } = fakeClient({ data: [ALBUM_ROW], error: null });
    await getAlbums(client);
    const cols = selectCols(calls);
    expect(cols).toEqual(expect.arrayContaining(["id", "slug", "title", "description", "sort", "active"]));
    expect(cols).not.toContain("*");
    expect(cols).not.toContain("bytes");
    expect(cols).not.toContain("original_path");
    expect(new Set(cols).size).toBe(cols.length);
    expect(cols.every((c) => /^[a-z_]+$/.test(c))).toBe(true);
  });

  test("DB 오류는 삼키지 않고 throw", async () => {
    const { client } = fakeClient({ data: null, error: { message: "boom" } });
    await expect(getAlbums(client)).rejects.toThrow(/getAlbums: boom/);
    const { client: c2 } = fakeClient({ data: null, error: { message: "boom" } });
    await expect(getAlbumBySlug("airport-pickup", c2)).rejects.toThrow(/getAlbumBySlug: boom/);
  });

  test("QUERY_TAGS 에 albums 가 있고, index 배럴이 albums 를 export 한다", () => {
    expect(QUERY_TAGS.albums).toBe("albums");
    const index = read("lib/queries/index.ts");
    expect(index).toMatch(/getAlbums\b/);
    expect(index).toMatch(/getAlbumBySlug\b/);
    expect(index).toMatch(/\.\/albums/);
  });
});

// =============================================================================
// 5. getGalleryPage — limit + 1 을 읽어 hasMore 판정 (count 쿼리 금지)
// =============================================================================
const photoRow = (id: number, albumId: number | null = null): GalleryRow => ({
  id,
  image_path: `gallery/${id}.webp`,
  caption: null,
  sort: id,
  active: true,
  album_id: albumId,
  width: 1600,
  height: 1200,
});

describe("5. lib/queries/gallery.ts getGalleryPage", () => {
  test("limit + 1 만큼 읽는다 — range(offset, offset + limit) · count 쿼리 없음", async () => {
    const { client, calls } = fakeClient({ data: [photoRow(1), photoRow(2)], error: null });
    await getGalleryPage({ limit: 2 }, client);
    const range = calls.find((c) => c.method === "range");
    expect(range?.args).toEqual([0, 2]);
    // PostgREST range 는 양끝 포함이므로 0..2 = 3행 = limit(2) + 1 — 여분의 1행이 hasMore 판정용이다
    const [from, to] = range?.args as [number, number];
    expect(to - from + 1).toBe(3);
    // count 를 세지 않는다
    const select = calls.find((c) => c.method === "select");
    expect(select?.args[1] ?? null).toBeNull();
    expect(JSON.stringify(calls)).not.toMatch(/"count"|exact|planned|estimated/);
  });

  test("여분의 1행이 오면 hasMore true 이고 그 행은 items 에서 잘려 나간다", async () => {
    const { client } = fakeClient({ data: [photoRow(1), photoRow(2), photoRow(3)], error: null });
    const page = await getGalleryPage({ limit: 2 }, client);
    expect(page.items.map((i) => i.id)).toEqual([1, 2]);
    expect(page.hasMore).toBe(true);
  });

  test("정확히 limit 만큼 오면 hasMore false", async () => {
    const { client } = fakeClient({ data: [photoRow(1), photoRow(2)], error: null });
    const page = await getGalleryPage({ limit: 2 }, client);
    expect(page.items.map((i) => i.id)).toEqual([1, 2]);
    expect(page.hasMore).toBe(false);
  });

  test("0행이면 빈 배열 + hasMore false (data 가 null 이어도 터지지 않는다)", async () => {
    const { client } = fakeClient({ data: [], error: null });
    expect(await getGalleryPage({ limit: 10 }, client)).toEqual({ items: [], hasMore: false });
    const { client: c2 } = fakeClient({ data: null, error: null });
    expect(await getGalleryPage({ limit: 10 }, c2)).toEqual({ items: [], hasMore: false });
  });

  test("offset 이 range 앞끝에 그대로 반영된다", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await getGalleryPage({ limit: 24, offset: 48 }, client);
    expect(calls.find((c) => c.method === "range")?.args).toEqual([48, 72]);
  });

  test("albumId 를 주면 그 앨범만, 주지 않으면 전체(album_id 필터 없음)", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await getGalleryPage({ albumId: 7, limit: 10 }, client);
    expect(calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual(
      expect.arrayContaining([["active", true], ["album_id", 7]]),
    );

    const { client: c2, calls: calls2 } = fakeClient({ data: [], error: null });
    await getGalleryPage({ limit: 10 }, c2);
    const eqs2 = calls2.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs2).toEqual([["active", true]]);
    expect(calls2.some((c) => c.method === "is")).toBe(false);
  });

  test("정렬은 sort 오름차순 → id 오름차순 (getGallery 와 같은 규칙)", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await getGalleryPage({ limit: 10 }, client);
    expect(calls.filter((c) => c.method === "order").map((c) => c.args[0])).toEqual(["sort", "id"]);
  });

  test("limit 경계 — 1·60 통과, 0·61·음수·소수·NaN 은 조회 전에 throw", async () => {
    for (const ok of [1, MAX_GALLERY_PAGE_LIMIT]) {
      const { client } = fakeClient({ data: [], error: null });
      await expect(getGalleryPage({ limit: ok }, client)).resolves.toBeDefined();
    }
    for (const bad of [0, -1, MAX_GALLERY_PAGE_LIMIT + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { client, calls } = fakeClient({ data: [], error: null });
      await expect(getGalleryPage({ limit: bad }, client), String(bad)).rejects.toThrow(/getGalleryPage/);
      expect(calls, String(bad)).toEqual([]);
    }
    expect(MAX_GALLERY_PAGE_LIMIT).toBe(60);
  });

  test("offset 경계 — 0 통과, 음수·소수는 조회 전에 throw", async () => {
    const { client } = fakeClient({ data: [], error: null });
    await expect(getGalleryPage({ limit: 10, offset: 0 }, client)).resolves.toBeDefined();
    for (const bad of [-1, 1.5, Number.NaN]) {
      const { client: c, calls } = fakeClient({ data: [], error: null });
      await expect(getGalleryPage({ limit: 10, offset: bad }, c), String(bad)).rejects.toThrow(/getGalleryPage/);
      expect(calls, String(bad)).toEqual([]);
    }
  });

  test("albumId 경계 — 양의 int4 만, 0·음수·소수는 조회 전에 throw", async () => {
    for (const bad of [0, -1, 1.5, 2147483648]) {
      const { client, calls } = fakeClient({ data: [], error: null });
      await expect(getGalleryPage({ albumId: bad, limit: 10 }, client), String(bad)).rejects.toThrow(/getGalleryPage/);
      expect(calls, String(bad)).toEqual([]);
    }
  });

  test("select 는 화이트리스트 — album_id·width·height 는 있고 bytes·original_path 는 없다", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await getGalleryPage({ limit: 10 }, client);
    const cols = selectCols(calls);
    expect(cols).toEqual(expect.arrayContaining(["id", "image_path", "caption", "sort", "active", "album_id", "width", "height"]));
    expect(cols).not.toContain("bytes");
    expect(cols).not.toContain("original_path");
    expect(cols).not.toContain("*");
  });

  test("행 → 뷰 변환에 album_id·width·height 가 camelCase 로 실린다", async () => {
    const { client } = fakeClient({ data: [photoRow(9, 3)], error: null });
    const page = await getGalleryPage({ albumId: 3, limit: 10 }, client);
    expect(page.items[0]).toEqual<GalleryItem>({
      id: 9,
      imagePath: "gallery/9.webp",
      caption: null,
      sort: 9,
      active: true,
      albumId: 3,
      width: 1600,
      height: 1200,
    });
  });

  test("DB 오류는 삼키지 않고 throw", async () => {
    const { client } = fakeClient({ data: null, error: { message: "boom" } });
    await expect(getGalleryPage({ limit: 10 }, client)).rejects.toThrow(/getGalleryPage: boom/);
  });

  test("데이터 끝을 넘긴 offset(PostgREST 416 · PGRST103)은 오류가 아니라 빈 페이지다 — 무한스크롤의 끝이 500 이 되면 안 된다", async () => {
    const { client } = fakeClient({
      data: null,
      error: { code: "PGRST103", message: "Requested range not satisfiable" },
    });
    await expect(getGalleryPage({ limit: 10, offset: 1000 }, client)).resolves.toEqual({ items: [], hasMore: false });

    // 오류 코드가 비어 와도 문구로 판정한다(PostgREST 버전차)
    const { client: c2 } = fakeClient({ data: null, error: { message: "Requested Range Not Satisfiable" } });
    await expect(getGalleryPage({ limit: 10, offset: 1000 }, c2)).resolves.toEqual({ items: [], hasMore: false });
  });

  test("range 무관한 오류는 여전히 throw — 416 처리가 모든 오류를 삼키지 않는다", async () => {
    for (const error of [
      { code: "42P01", message: "relation does not exist" },
      { code: "PGRST301", message: "JWT expired" },
      { message: "fetch failed" },
    ]) {
      const { client } = fakeClient({ data: null, error });
      await expect(getGalleryPage({ limit: 10, offset: 0 }, client), error.message).rejects.toThrow(/getGalleryPage/);
    }
  });
});

// =============================================================================
// 6. 공개 읽기 타입에 bytes·originalPath 가 없다 (컴파일 타임 + 코드 텍스트)
// =============================================================================
/** K 가 T 의 키가 되는 순간 타입이 "관리자 전용 정보가 공개 타입에 들어왔다" 가 되어 tsc 가 깨진다. */
type KeyAbsent<T, K extends string> = K extends keyof T ? "관리자 전용 정보가 공개 타입에 들어왔다" : "없음";

const galleryItemHasNoBytes: KeyAbsent<GalleryItem, "bytes"> = "없음";
const galleryItemHasNoOriginalPath: KeyAbsent<GalleryItem, "originalPath"> = "없음";
const galleryRowHasNoBytes: KeyAbsent<GalleryRow, "bytes"> = "없음";
const galleryRowHasNoOriginalPath: KeyAbsent<GalleryRow, "original_path"> = "없음";
const albumHasNoBytes: KeyAbsent<GalleryAlbum, "bytes"> = "없음";

describe("6. 공개 읽기 타입 — bytes·original_path 는 관리자 전용 정보다", () => {
  test("GalleryItem·GalleryRow·GalleryAlbum 어디에도 키가 없다 (컴파일 타임 단언)", () => {
    expect([
      galleryItemHasNoBytes,
      galleryItemHasNoOriginalPath,
      galleryRowHasNoBytes,
      galleryRowHasNoOriginalPath,
      albumHasNoBytes,
    ]).toEqual(["없음", "없음", "없음", "없음", "없음"]);
  });

  test("lib/queries 의 코드 줄(주석 제외)에 bytes·original_path 심볼이 없다 — select 에 섞여 들어갈 여지 0", () => {
    for (const rel of ["lib/queries/gallery.ts", "lib/queries/albums.ts"]) {
      const codeOnly = read(rel)
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
        .join("\n");
      expect(codeOnly, rel).not.toMatch(/\bbytes\b/);
      expect(codeOnly, rel).not.toMatch(/original_path|originalPath/);
    }
  });

  test("albums.ts 도 읽기 계층 규약을 지킨다 — 서버 액션·서비스 롤·Next import 0", () => {
    const src = read("lib/queries/albums.ts");
    expect(src).not.toMatch(/['"]use server['"]/);
    expect(src).not.toMatch(/service_role|SUPABASE_SERVICE_ROLE_KEY|createServiceClient/);
    expect(src).not.toMatch(/from\s+['"]next(\/|['"])/);
    expect(src).toMatch(/createAnonClient/);
  });
});

// =============================================================================
// 7. getGallery 회귀 0 — 홈이 쓰는 기존 함수는 시그니처·동작 그대로
// =============================================================================
describe("7. getGallery 회귀", () => {
  test("기존 select(5컬럼)·정렬·limit 규칙 유지 — 0008 컬럼을 끌어오지 않는다", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await getGallery(8, client);
    const cols = selectCols(calls);
    expect(cols).toEqual(["id", "image_path", "caption", "sort", "active"]);
    expect(calls.filter((c) => c.method === "order").map((c) => c.args[0])).toEqual(["sort", "id"]);
    expect(calls.find((c) => c.method === "limit")?.args).toEqual([8]);
    expect(calls.some((c) => c.method === "range")).toBe(false);
    expect(DEFAULT_GALLERY_LIMIT).toBe(8);
  });

  test("limit 이 양의 정수가 아니면 조회 전에 throw (기존 계약)", async () => {
    for (const bad of [0, -1, 1.5]) {
      const { client, calls } = fakeClient({ data: [], error: null });
      await expect(getGallery(bad, client), String(bad)).rejects.toThrow();
      expect(calls).toEqual([]);
    }
  });

  test("mapGalleryRows — 0008 컬럼이 없는 행은 키도 만들지 않는다(홈 소비자의 키 집합 불변)", () => {
    const item = mapGalleryRows([{ id: 3, image_path: "gallery/a.jpg", caption: null, sort: 2, active: true }])[0];
    expect(item).toEqual({ id: 3, imagePath: "gallery/a.jpg", caption: null, sort: 2, active: true });
    expect(Object.keys(item).sort()).toEqual(["active", "caption", "id", "imagePath", "sort"]);
  });

  test("mapGalleryRows — 0008 컬럼이 있는 행은 camelCase 로 옮긴다(null 도 키로 남긴다)", () => {
    const item = mapGalleryRows([
      { id: 3, image_path: "gallery/a.jpg", caption: "c", sort: 2, active: true, album_id: null, width: null, height: null },
    ])[0];
    expect(Object.keys(item).sort()).toEqual(["active", "albumId", "caption", "height", "id", "imagePath", "sort", "width"]);
    expect(item.albumId).toBeNull();
  });
});

// =============================================================================
// 8. DB 실증 — 로컬 스택 + REQUIRE_DB_TESTS=1 일 때만 (원격에는 어떤 쓰기도 하지 않는다)
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[gallery-albums.test] DB 실증 블록 skip — ${gate.reason}`);
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

describe.skipIf(!gate.allowed || !env.hasServiceRole)("8. DB — 0008 앨범 RLS·FK 실증 (로컬 스택 + REQUIRE_DB_TESTS=1)", () => {
  // 이 블록은 gallery · gallery_albums 에 행을 남기고 앨범 삭제까지 한다 — 표 전체를 단언하는 블록과 줄 세운다
  // (tests/helpers/db-lock.ts GALLERY_LOCK).
  withGalleryLock();

  const headers = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
  const SLUG_PREFIX = `p61-${RUN}`;
  const PATH_PREFIX = `p61-${RUN}/`;

  let activeAlbumId = 0;
  let inactiveAlbumId = 0;
  let anonClient: AnonClient;

  type RestResult = { status: number; body: unknown };
  async function rest(method: string, pathAndQuery: string, json?: unknown, prefer?: string): Promise<RestResult> {
    const res = await fetch(`${env.restRoot}${pathAndQuery}`, {
      method,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // 본문이 JSON 이 아니면 문자열 그대로
    }
    return { status: res.status, body };
  }

  /** anon 키로 직접 REST 조회 — RLS 가 유일한 필터다. */
  async function anonRest(pathAndQuery: string): Promise<unknown> {
    const res = await fetch(`${env.restRoot}${pathAndQuery}`, {
      headers: { apikey: env.anonKey as string, Authorization: `Bearer ${env.anonKey}` },
    });
    expect(res.ok, `anon REST ${pathAndQuery} → ${res.status}`).toBe(true);
    return res.json();
  }

  const errorOf = (r: RestResult) => (r.body ?? {}) as { code?: string; message?: string };

  /** 앨범 insert 시도 — 상태·오류를 그대로 돌려준다(제약 위반 실증용). */
  const tryInsertAlbum = (row: Record<string, unknown>) =>
    rest("POST", "/gallery_albums", { title: "테스트 앨범", sort: 1, active: true, ...row }, "return=representation");

  /** 사진 insert 시도 — 상태·오류를 그대로 돌려준다(제약 위반 실증용). */
  const tryInsertPhoto = (row: Record<string, unknown>) =>
    rest("POST", "/gallery", { sort: 90, active: true, ...row }, "return=representation");

  async function insertAlbum(suffix: string, active: boolean): Promise<number> {
    const r = await tryInsertAlbum({ slug: `${SLUG_PREFIX}-${suffix}`, title: `테스트 앨범 ${suffix}`, active });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return (r.body as { id: number }[])[0].id;
  }

  async function insertPhoto(name: string, albumId: number | null, sort: number): Promise<number> {
    const r = await tryInsertPhoto({
      image_path: `${PATH_PREFIX}${name}.webp`,
      sort,
      album_id: albumId,
      width: 1600,
      height: 1200,
      bytes: 250000,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return (r.body as { id: number }[])[0].id;
  }

  beforeAll(async () => {
    expect(env.anonKey, "RLS 실증에는 anon 키가 필요하다 — .env.local 의 NEXT_PUBLIC_SUPABASE_ANON_KEY").toBeTruthy();
    const probe = await rest("GET", "/gallery_albums?select=id&limit=1");
    if (probe.status !== 200) {
      throw new Error(
        `0008_gallery_albums.sql 이 이 DB(${process.env.NEXT_PUBLIC_SUPABASE_URL})에 적용되지 않은 것으로 보인다 — HTTP ${probe.status}: ${JSON.stringify(probe.body).slice(0, 200)}`,
      );
    }
    const { createClient } = await import("@supabase/supabase-js");
    anonClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, env.anonKey as string, {
      auth: { persistSession: false },
    });

    activeAlbumId = await insertAlbum("on", true);
    inactiveAlbumId = await insertAlbum("off", false);
    await insertPhoto("a1", activeAlbumId, 1);
    await insertPhoto("a2", activeAlbumId, 2);
    await insertPhoto("b1", inactiveAlbumId, 3);
    await insertPhoto("free", null, 4);
  });

  afterAll(async () => {
    // slug 는 `*접두사*`(포함)로 쓸어낸다 — 제약 위반 실증이 쓰는 slug 중에는 앞에 하이픈이 붙은 것이 있어
    // `접두사*`(시작) 필터로는 잡히지 않는다. 제약이 사라져 그것이 통과해 버린 날에도 잔류가 없어야 한다.
    await rest("DELETE", `/gallery?image_path=like.${encodeURIComponent(`*${PATH_PREFIX}*`)}`);
    await rest("DELETE", `/gallery_albums?slug=like.${encodeURIComponent(`*${SLUG_PREFIX}*`)}`);
    const leftPhotos = await rest("GET", `/gallery?select=id&image_path=like.${encodeURIComponent(`*${PATH_PREFIX}*`)}`);
    const leftAlbums = await rest("GET", `/gallery_albums?select=id&slug=like.${encodeURIComponent(`*${SLUG_PREFIX}*`)}`);
    expect(leftPhotos.body).toEqual([]);
    expect(leftAlbums.body).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // 8-a. 제약 실증 (리뷰 M1) — 위반 행을 밀어넣어 DB 가 실제로 거부하는지 본다.
  //      텍스트 테스트는 "파일에 그렇게 적혀 있다"만 증명한다. Postgres 의 `~` 가 JS RegExp 와
  //      같은 판정을 하는지, char_length 41 이 실제로 막히는지는 위반을 시도해야만 나온다.
  //      선례: tests/consent.test.ts — 400 + SQLSTATE + 제약 이름.
  // ---------------------------------------------------------------------------
  test("slug CHECK — 대문자·선행 하이픈·41자는 23514 gallery_albums_slug_ck 로 거부된다", async () => {
    const tooLong = `${SLUG_PREFIX}-${"a".repeat(41 - SLUG_PREFIX.length - 1)}`;
    expect(tooLong.length).toBe(41);
    const cases: [label: string, slug: string][] = [
      ["대문자", `${SLUG_PREFIX}-BAD`],
      ["선행 하이픈", `-${SLUG_PREFIX}-lead`],
      ["41자", tooLong],
      ["후행 하이픈", `${SLUG_PREFIX}-trail-`],
      ["연속 하이픈", `${SLUG_PREFIX}--double`],
      ["공백", `${SLUG_PREFIX} space`],
      ["경로 조작", `${SLUG_PREFIX}/../etc`],
    ];
    for (const [label, slug] of cases) {
      const r = await tryInsertAlbum({ slug });
      expect(r.status, `${label}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(errorOf(r).code, label).toBe("23514");
      expect(errorOf(r).message, label).toContain("gallery_albums_slug_ck");
    }
    // 같은 규칙의 TS 쪽(parseAlbumSlug)도 전부 거부한다 — 코드와 DB 가 갈리지 않는다
    for (const [label, slug] of cases) expect(parseAlbumSlug(slug), label).toBeNull();
    // 40자는 통과한다 — 길이 CHECK 가 41 에서 끊기는지(38 자리 오차가 아닌지) 양쪽에서 확인
    const exactly40 = `${SLUG_PREFIX}-${"a".repeat(40 - SLUG_PREFIX.length - 1)}`;
    expect(exactly40.length).toBe(40);
    expect(parseAlbumSlug(exactly40)).toBe(exactly40);
    const ok = await tryInsertAlbum({ slug: exactly40, active: false });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    await rest("DELETE", `/gallery_albums?slug=eq.${exactly40}`);
  });

  test("slug UNIQUE — 같은 slug 를 두 번 넣으면 23505 로 거부된다", async () => {
    const r = await tryInsertAlbum({ slug: `${SLUG_PREFIX}-off` });
    expect([400, 409], JSON.stringify(r.body)).toContain(r.status);
    expect(errorOf(r).code).toBe("23505");
  });

  test("width·height·bytes CHECK — 0·음수는 23514 로 거부되고, null 은 통과한다", async () => {
    const cases: [label: string, row: Record<string, unknown>, constraintName: string][] = [
      ["width = 0", { width: 0 }, "gallery_width_ck"],
      ["width = -1", { width: -1 }, "gallery_width_ck"],
      ["height = -1", { height: -1 }, "gallery_height_ck"],
      ["height = 0", { height: 0 }, "gallery_height_ck"],
      ["bytes = 0", { bytes: 0 }, "gallery_bytes_ck"],
      ["bytes = -1", { bytes: -1 }, "gallery_bytes_ck"],
    ];
    for (const [label, row, constraintName] of cases) {
      const r = await tryInsertPhoto({ image_path: `${PATH_PREFIX}bad-${label.replace(/[^a-z0-9]/gi, "")}.webp`, ...row });
      expect(r.status, `${label}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(errorOf(r).code, label).toBe("23514");
      expect(errorOf(r).message, label).toContain(constraintName);
    }
    // "모르면 null" 은 정상이다 — CHECK 가 null 까지 막고 있으면 업로드 전 행을 넣을 수 없다
    const nulls = await tryInsertPhoto({ image_path: `${PATH_PREFIX}nulls.webp`, width: null, height: null, bytes: null });
    expect(nulls.status, JSON.stringify(nulls.body)).toBe(201);
    await rest("DELETE", `/gallery?image_path=eq.${encodeURIComponent(`${PATH_PREFIX}nulls.webp`)}`);
  });

  test("album_id FK — 없는 앨범 id 를 가리키면 23503 으로 거부된다", async () => {
    const r = await tryInsertPhoto({ image_path: `${PATH_PREFIX}bad-fk.webp`, album_id: 2147483647 });
    expect([400, 409], JSON.stringify(r.body)).toContain(r.status);
    expect(errorOf(r).code).toBe("23503");
  });

  test("데이터 끝을 넘긴 offset 은 빈 페이지다 (리뷰 M2 — 실 DB 거동)", async () => {
    expect(await getGalleryPage({ albumId: activeAlbumId, limit: 10, offset: 1000 }, anonClient)).toEqual({
      items: [],
      hasMore: false,
    });
    expect(await getGalleryPage({ limit: 10, offset: 1_000_000 }, anonClient)).toEqual({ items: [], hasMore: false });
    // 마지막 페이지의 바로 다음 페이지 — 무한스크롤이 실제로 부르는 요청
    const last = await getGalleryPage({ albumId: activeAlbumId, limit: 2, offset: 0 }, anonClient);
    expect(last.hasMore).toBe(false);
    expect(await getGalleryPage({ albumId: activeAlbumId, limit: 2, offset: 2 }, anonClient)).toEqual({
      items: [],
      hasMore: false,
    });
  });

  test("비활성 앨범의 활성 사진은 anon 에게 0행 — 활성 앨범 2장 + 미분류 1장만 보인다", async () => {
    const rows = (await anonRest(
      `/gallery?select=image_path,album_id&image_path=like.${encodeURIComponent(`${PATH_PREFIX}*`)}&order=sort.asc`,
    )) as { image_path: string; album_id: number | null }[];
    expect(rows.map((r) => r.image_path)).toEqual([`${PATH_PREFIX}a1.webp`, `${PATH_PREFIX}a2.webp`, `${PATH_PREFIX}free.webp`]);
    expect(rows.some((r) => r.album_id === inactiveAlbumId)).toBe(false);
  });

  test("비활성 앨범 자체도 anon 에게 0행 (gallery_albums_select_active)", async () => {
    const albums = (await anonRest(
      `/gallery_albums?select=id,slug,active&slug=like.${encodeURIComponent(`${SLUG_PREFIX}*`)}`,
    )) as { id: number; slug: string }[];
    expect(albums.map((a) => a.id)).toEqual([activeAlbumId]);
  });

  test("getGalleryPage — 비활성 앨범 id 로 물어도 0행, 활성 앨범은 limit+1 페이지네이션이 돈다", async () => {
    expect(await getGalleryPage({ albumId: inactiveAlbumId, limit: 10 }, anonClient)).toEqual({ items: [], hasMore: false });

    const first = await getGalleryPage({ albumId: activeAlbumId, limit: 1 }, anonClient);
    expect(first.items.map((i) => i.imagePath)).toEqual([`${PATH_PREFIX}a1.webp`]);
    expect(first.hasMore).toBe(true);

    const second = await getGalleryPage({ albumId: activeAlbumId, limit: 1, offset: 1 }, anonClient);
    expect(second.items.map((i) => i.imagePath)).toEqual([`${PATH_PREFIX}a2.webp`]);
    expect(second.hasMore).toBe(false);
  });

  test("getAlbums·getAlbumBySlug — anon 은 활성 앨범만 보고, 비활성 slug 는 null", async () => {
    const albums = await getAlbums(anonClient);
    const mine = albums.filter((a) => a.slug.startsWith(SLUG_PREFIX));
    expect(mine.map((a) => a.slug)).toEqual([`${SLUG_PREFIX}-on`]);
    expect((await getAlbumBySlug(`${SLUG_PREFIX}-on`, anonClient))?.id).toBe(activeAlbumId);
    expect(await getAlbumBySlug(`${SLUG_PREFIX}-off`, anonClient)).toBeNull();
  });

  test("앨범을 지우면 사진은 남고 album_id 만 null 이 된다 (on delete set null)", async () => {
    const del = await rest("DELETE", `/gallery_albums?id=eq.${activeAlbumId}`);
    expect([200, 204]).toContain(del.status);

    const photos = (
      await rest("GET", `/gallery?select=image_path,album_id&image_path=like.${encodeURIComponent(`${PATH_PREFIX}*`)}&order=sort.asc`)
    ).body as { image_path: string; album_id: number | null }[];
    expect(photos.map((p) => p.image_path)).toEqual([
      `${PATH_PREFIX}a1.webp`,
      `${PATH_PREFIX}a2.webp`,
      `${PATH_PREFIX}b1.webp`,
      `${PATH_PREFIX}free.webp`,
    ]);
    expect(photos.filter((p) => p.album_id === activeAlbumId)).toEqual([]);
    // 부분 문자열(`includes("a1")`)로 고르면 안 된다 — PATH_PREFIX 에 들어간 임의 16진수 RUN 이 "a1"·"a2" 를
    // 품을 확률이 5.4% 라, 그때는 b1(비활성 앨범 소속, album_id 가 null 이 아니다)까지 걸려 이 단언이 깨졌다.
    // 스케줄링과 무관한 자체 결함이었다(P5-10 실측: 10회 중 6회째 재현). 이름을 정확히 짚는다.
    const albumPhotos = photos.filter((p) => p.image_path === `${PATH_PREFIX}a1.webp` || p.image_path === `${PATH_PREFIX}a2.webp`);
    expect(albumPhotos).toHaveLength(2);
    expect(albumPhotos.every((p) => p.album_id === null)).toBe(true);

    // 미분류가 된 사진은 다시 anon 에게 보인다(앨범이 사라져도 사진이 사라지지 않는다)
    const rows = (await anonRest(
      `/gallery?select=image_path&image_path=like.${encodeURIComponent(`${PATH_PREFIX}*`)}&order=sort.asc`,
    )) as { image_path: string }[];
    expect(rows.map((r) => r.image_path)).toEqual([`${PATH_PREFIX}a1.webp`, `${PATH_PREFIX}a2.webp`, `${PATH_PREFIX}free.webp`]);
  });
});
