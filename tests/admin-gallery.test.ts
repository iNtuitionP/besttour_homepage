/**
 * P6-2 — 관리자 갤러리 탭: 브라우저 직업로드 + 스토리지 RLS (플랜 v4 P6-2 · ADR-2·ADR-3·ADR-4·ADR-9 · 스펙 §13.9).
 *
 * **ADR-9 의 수단이 바뀌었다.** 원문은 "signed URL 직업로드"였지만 signed URL 을 만들려면 서비스 롤이 필요하고,
 * `scripts/check-admin-no-service-role.sh` 가 관리자 경로의 서비스 롤을 금지한다(ADR-2). 두 규칙을 동시에 지키는 길은
 * `storage.objects` 에 `is_admin()` 정책을 걸고 **브라우저가 관리자 세션으로 직접 올리는 것**뿐이다.
 * 목적(Server Action 1MB · Vercel 4.5MB 본문 한계 회피 — 20MB 사진이 서버를 통과하지 않는다)은 그대로다.
 *
 * 이 파일이 잠그는 것:
 *   1. 0011 의 정책이 버킷별로 갈린다 — `gallery` 는 읽기 공개, `gallery-originals` 는 읽기까지 `is_admin()`.
 *   2. 경로 규약(P6-1 §7-2): `yyyy/mm/<uuid>` 이고 **앨범이 경로에 없다**(앨범 이동은 UPDATE 한 줄이어야 한다).
 *   3. 클라이언트 검증(스펙 §13.9 (4)): 30장 · 20MB · 형식 5종. 순수 함수라 브라우저 없이 검증된다.
 *   4. 삭제 순서와 부분 실패 — 파일이 안 지워졌으면 행을 지우지 않는다(고아 행 = 깨진 이미지).
 *   5. 사용량(스펙 §13.9 (5))은 DB 값의 합이지 지어낸 수치가 아니다. 1000행 페이지 경계에서 조용히 undercount 하지 않는다.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { withGalleryLock } from "./helpers/db-lock";
import {
  STORAGE_DELETE_DENIED_MESSAGE,
  STORAGE_RLS_MESSAGE,
  expectRlsInsertDenied,
  expectStorageDenied,
  expectStorageNotFound,
} from "./helpers/expect-denied";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";

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
  createGalleryAlbum,
  deleteGalleryAlbum,
  deleteGalleryPhoto,
  recordGalleryUpload,
  toggleGalleryAlbumActive,
  toggleGalleryPhotoActive,
  updateGalleryAlbum,
  updateGalleryPhoto,
} from "@/actions/admin/gallery";
import {
  ADMIN_GALLERY_PATH,
  ALBUM_ADMIN_SELECT,
  GALLERY_ADMIN_SELECT,
  galleryUsage,
  listAdminPhotos,
} from "@/lib/admin/gallery";
import {
  ALBUM_TITLE_MAX,
  GALLERY_ALLOWED_EXTENSIONS,
  GALLERY_BUCKET,
  GALLERY_CAPTION_MAX,
  GALLERY_HEIC_EXTENSIONS,
  GALLERY_MAX_BYTES,
  GALLERY_MAX_FILES,
  GALLERY_ORIGINALS_BUCKET,
  GALLERY_PUBLIC_LONG_EDGE,
  buildUploadPaths,
  fileExtension,
  fitLongEdge,
  formatUsageSize,
  isHeicExtension,
  parseStoragePath,
  selectGalleryFiles,
  usageOf,
} from "@/lib/admin/galleryInput";
import { commitUpload } from "@/lib/admin/galleryUpload";
import { PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE } from "@/lib/admin/publicRevalidate";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { ALBUM_SLUG_PATTERN, parseAlbumSlug } from "@/lib/queries/albums";
import { createSsrClient } from "@/lib/supabase/ssr";

import { stripComments } from "./helpers/strip-comments";

// =============================================================================
// 공통 헬퍼 (tests/admin-routes.test.ts 와 같은 구현)
// =============================================================================
const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf-8");
const exists = (rel: string): boolean => existsSync(path.join(ROOT, rel));
const HANGUL = /[가-힣]/;

/** 주석을 걷어낸 코드. 제거기는 저장소에 하나뿐이다(`tests/helpers/strip-comments.ts` · P6-7/P6-8 · D7). */
const codeOf = (rel: string) => stripComments(read(rel), rel);

/** SQL 의 주석(`--`)을 뺀 실행 코드만. */
function sqlCode(src: string): string {
  return src
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const UP_SQL = "supabase/migrations/0011_storage_policies.sql";
const DOWN_SQL = "supabase/rollbacks/0011_storage_policies.down.sql";
const ACTION = "actions/admin/gallery.ts";
const LIB_INPUT = "lib/admin/galleryInput.ts";
const LIB_COMMIT = "lib/admin/galleryUpload.ts";
const LIB_DB = "lib/admin/gallery.ts";
const LIST_PAGE = "app/admin/(protected)/gallery/page.tsx";
const UPLOADER_UI = "components/admin/GalleryUploader.tsx";
const CARD_UI = "components/admin/GalleryPhotoCard.tsx";
const ALBUMS_UI = "components/admin/GalleryAlbums.tsx";
const TABS_DEF = "components/admin/tabs.ts";
const TS_TARGETS = [ACTION, LIB_INPUT, LIB_COMMIT, LIB_DB, LIST_PAGE, UPLOADER_UI, CARD_UI, ALBUMS_UI];

const UUID = "0f9c1a2b-3d4e-4f60-8a1b-2c3d4e5f6071";
const AT = new Date("2026-09-15T00:30:00+09:00"); // KST 로 9월 15일, UTC 로는 9월 14일

interface Chain {
  [method: string]: ReturnType<typeof vi.fn>;
}
type DbResult = { data: unknown; error: unknown };

/**
 * 세션 클라이언트 스텁. 결과를 배열로 주면 `await` 순서대로 하나씩 꺼내 쓴다(한 액션이 여러 번 쓰는 경우).
 * storage 는 `remove` 하나만 쓴다 — 업로드는 브라우저가 하고 서버는 지우기만 한다.
 */
function dbStub(results: DbResult | DbResult[], storage?: { error: unknown } | { error: unknown }[]) {
  const queue = Array.isArray(results) ? [...results] : null;
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "range", "eq", "is", "insert", "update", "delete", "maybeSingle", "overrideTypes"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    const next = queue ? (queue.shift() ?? { data: [], error: null }) : (results as DbResult);
    return Promise.resolve(next).then(resolve, reject);
  };
  const storageQueue = Array.isArray(storage) ? [...storage] : null;
  const storageOne: { error: unknown } = Array.isArray(storage) ? { error: null } : (storage ?? { error: null });
  const remove = vi.fn(async (keys: string[]) => {
    const next = storageQueue ? (storageQueue.shift() ?? { error: null }) : storageOne;
    return { data: next.error ? null : keys.map(() => ({})), error: next.error };
  });
  const storageFrom = vi.fn((bucket: string) => {
    void bucket;
    return { remove };
  });
  const from = vi.fn((table: string) => {
    void table;
    return chain;
  });
  return { client: { from, storage: { from: storageFrom } }, chain: chain as Chain, from, remove, storageFrom };
}

const PHOTO_ROW = {
  id: 7,
  image_path: `${GALLERY_BUCKET}/2026/09/${UUID}-1600.webp`,
  original_path: `${GALLERY_ORIGINALS_BUCKET}/2026/09/${UUID}.heic`,
  caption: null,
  sort: 0,
  active: true,
  album_id: null,
  width: 1600,
  height: 1200,
  bytes: 4_200_000,
  created_at: "2026-09-15T00:30:00+09:00",
};

const UPLOAD = {
  imagePath: PHOTO_ROW.image_path,
  originalPath: PHOTO_ROW.original_path,
  width: 1600,
  height: 1200,
  bytes: 4_200_000,
  albumId: null,
  caption: null,
  sort: 0,
  active: true,
};

// =============================================================================
// 1. 0011 — storage.objects 정책 (SQL 텍스트)
// =============================================================================
describe("1. 0011_storage_policies.sql", () => {
  test("파일이 있다 — 마이그레이션과 롤백 한 쌍", () => {
    expect(exists(UP_SQL), UP_SQL).toBe(true);
    expect(exists(DOWN_SQL), DOWN_SQL).toBe(true);
  });

  test("버킷을 만들지 않는다 — 컨트롤러가 이미 만들었다(브리프 §컨트롤러가 이미 해 둔 것)", () => {
    const code = sqlCode(read(UP_SQL));
    expect(code).not.toMatch(/insert\s+into\s+storage\.buckets/i);
    expect(code).not.toMatch(/create_bucket|storage\.create_bucket/i);
  });

  test("8개 정책 — 버킷 2개 × 동작 4종. 이름에 접두사가 붙어 Supabase 기본 정책과 섞이지 않는다", () => {
    const code = sqlCode(read(UP_SQL));
    const names = [...code.matchAll(/create policy ([a-z0-9_]+) on storage\.objects/g)].map((m) => m[1]);
    expect(names.sort()).toEqual(
      [
        "storage_gallery_admin_delete",
        "storage_gallery_admin_insert",
        "storage_gallery_admin_read",
        "storage_gallery_admin_update",
        "storage_originals_admin_delete",
        "storage_originals_admin_insert",
        "storage_originals_admin_read",
        "storage_originals_admin_update",
      ].sort(),
    );
    for (const n of names) expect(code, `${n} 의 drop policy if exists 가 없다`).toContain(`drop policy if exists ${n} on storage.objects`);
  });

  /**
   * 독립 리뷰 M1 — 처음 초안은 공개 버킷의 select 를 `to anon` 으로 열었다. 그 권한은 내려받기가 아니라 **열거**
   * (`/object/list/<bucket>`)여서, 사장님이 내려 둔 사진의 키까지 누구나 훑을 수 있었다. 공개 렌더는 이 권한을
   * 쓰지 않는다 — `/object/public/...` 은 storage-api 가 asSuperUser 로 처리한다(§보고서 리뷰 조치 M1 실측).
   */
  test("anon 에게 열린 정책이 하나도 없다 — 8개 전부 authenticated + is_admin() (리뷰 M1)", () => {
    const code = sqlCode(read(UP_SQL));
    expect(code, "storage.objects 정책이 anon 을 대상으로 삼는다").not.toMatch(/to [^;]*\banon\b/);
    const blocks = code.split(/create policy /).slice(1);
    expect(blocks).toHaveLength(8);
    for (const block of blocks) {
      const name = block.slice(0, block.indexOf(" "));
      const stmt = block.slice(0, block.indexOf(";"));
      expect(stmt, `${name} 가 authenticated 로 좁혀져 있지 않다`).toMatch(/to authenticated/);
      expect(stmt, `${name} 에 is_admin() 이 없다`).toContain("is_admin()");
      expect(stmt, `${name} 에 bucket_id 조건이 없다 — 다른 버킷까지 열린다`).toMatch(/bucket_id = '(gallery|gallery-originals)'/);
    }
  });

  test("gallery-originals 는 select 도 is_admin() 이다 — 원본은 사장님만 본다", () => {
    const code = sqlCode(read(UP_SQL));
    const stmt = code.slice(code.indexOf("create policy storage_originals_admin_read"));
    const one = stmt.slice(0, stmt.indexOf(";"));
    expect(one).toMatch(/for select to authenticated/);
    expect(one).toContain("is_admin()");
    expect(one).toContain("bucket_id = 'gallery-originals'");
    // 공개 버킷 이름이 원본 정책에 섞여 있으면 원본이 함께 열린다
    expect(one).not.toMatch(/bucket_id = 'gallery'/);
  });

  test("insert·update 는 with check 까지 is_admin() 이다 — using 만 두면 남의 파일을 밀어 넣을 수 있다", () => {
    const code = sqlCode(read(UP_SQL));
    for (const name of ["storage_gallery_admin_insert", "storage_originals_admin_insert"]) {
      const stmt = code.slice(code.indexOf(`create policy ${name}`));
      expect(stmt.slice(0, stmt.indexOf(";")), name).toMatch(/with check \(/);
    }
    for (const name of ["storage_gallery_admin_update", "storage_originals_admin_update"]) {
      const stmt = code.slice(code.indexOf(`create policy ${name}`)).slice(0, 400);
      expect(stmt, name).toMatch(/using \(/);
      expect(stmt, name).toMatch(/with check \(/);
    }
  });

  test("RLS 가 켜져 있는지 확인하고 아니면 멈춘다 — 정책만 걸고 RLS 가 꺼져 있으면 전부 통과한다", () => {
    const code = sqlCode(read(UP_SQL));
    expect(code).toMatch(/relrowsecurity/);
    expect(code).toMatch(/raise exception/);
  });

  test("0008·0009·0010 을 건드리지 않는다 — 남의 함수·정책 재정의 0", () => {
    const code = sqlCode(read(UP_SQL));
    expect(code).not.toMatch(/create or replace function is_admin/);
    expect(code).not.toMatch(/create policy [a-z_]+ on (gallery|gallery_albums|notices|popups|reservations)\b/);
    expect(code).not.toMatch(/drop policy if exists [a-z_]+ on (gallery|gallery_albums)\b/);
    expect(code).not.toMatch(/alter table (gallery|gallery_albums)\b/);
  });

  test("재실행 안전 — 모든 create policy 앞에 같은 이름의 drop 이 온다", () => {
    const code = sqlCode(read(UP_SQL));
    for (const m of code.matchAll(/create policy ([a-z0-9_]+) on storage\.objects/g)) {
      const dropAt = code.indexOf(`drop policy if exists ${m[1]} on storage.objects`);
      expect(dropAt, `${m[1]} 의 drop 이 없다`).toBeGreaterThanOrEqual(0);
      expect(dropAt, `${m[1]} 의 drop 이 create 뒤에 있다`).toBeLessThan(code.indexOf(`create policy ${m[1]}`));
    }
  });

  test("롤백 — 정책만 지운다. 파일·행·버킷을 지우는 SQL 이 없다", () => {
    const code = sqlCode(read(DOWN_SQL));
    const drops = [...code.matchAll(/drop policy if exists ([a-z0-9_]+) on storage\.objects/g)].map((m) => m[1]);
    expect(drops.sort()).toEqual(
      [...sqlCode(read(UP_SQL)).matchAll(/create policy ([a-z0-9_]+) on storage\.objects/g)].map((m) => m[1]).sort(),
    );
    expect(code, "롤백이 객체를 지운다").not.toMatch(/delete\s+from\s+storage\.objects/i);
    expect(code, "롤백이 버킷을 지운다").not.toMatch(/delete\s+from\s+storage\.buckets/i);
    expect(code, "롤백이 표를 지운다").not.toMatch(/delete\s+from\s+(gallery|gallery_albums)\b/i);
    expect(code).not.toMatch(/drop table|truncate/i);
    expect(code).not.toMatch(/create policy/i);
  });
});

// =============================================================================
// 2. 경로 규약 (P6-1 §7-2)
// =============================================================================
describe("2. 경로 규약", () => {
  test("원본·공개본이 같은 uuid 와 같은 yyyy/mm 을 쓴다 — 이 키 하나로 두 객체를 함께 지운다", () => {
    const p = buildUploadPaths(UUID, "heic", AT);
    expect(p.originalPath).toBe(`gallery-originals/2026/09/${UUID}.heic`);
    expect(p.imagePath).toBe(`gallery/2026/09/${UUID}-1600.webp`);
    expect(p.originalBucket).toBe(GALLERY_ORIGINALS_BUCKET);
    expect(p.publicBucket).toBe(GALLERY_BUCKET);
    // 버킷을 뺀 키가 storage 클라이언트에 넘어가는 값이다
    expect(p.originalKey).toBe(`2026/09/${UUID}.heic`);
    expect(p.publicKey).toBe(`2026/09/${UUID}-1600.webp`);
  });

  test("연·월은 KST 달력이다 — UTC 로 자르면 KST 00:00~08:59 에 전달로 밀린다", () => {
    // 2026-10-01T00:30+09:00 = 2026-09-30T15:30Z
    const p = buildUploadPaths(UUID, "jpg", new Date("2026-10-01T00:30:00+09:00"));
    expect(p.imagePath.startsWith("gallery/2026/10/")).toBe(true);
  });

  test("앨범이 경로에 없다 — 앨범 이동이 UPDATE 한 줄로 끝나야 한다(P6-1 §7-2)", () => {
    const p = buildUploadPaths(UUID, "jpg", AT);
    for (const seg of [p.originalPath, p.imagePath]) {
      expect(seg.split("/").length, seg).toBe(4); // bucket/yyyy/mm/file
    }
    // 업로드 경로를 만드는 함수는 앨범을 아예 인자로 받지 않는다
    expect(buildUploadPaths.length).toBeLessThanOrEqual(3);
    expect(codeOf(LIB_INPUT)).not.toMatch(/albumId[^\n]*\/[^\n]*(yyyy|mm)/);
  });

  test("확장자 화이트리스트 — 스펙 §13.9 (4)의 5종(+heif)", () => {
    expect([...GALLERY_ALLOWED_EXTENSIONS].sort()).toEqual(["heic", "heif", "jpeg", "jpg", "png", "webp"]);
    expect(fileExtension("사진.JPG")).toBe("jpg");
    expect(fileExtension("photo.jpeg")).toBe("jpeg");
    expect(fileExtension("a.b.HEIC")).toBe("heic");
    expect(fileExtension("noext")).toBeNull();
    expect(fileExtension("evil.svg")).toBeNull();
    expect(fileExtension("evil.php.gif")).toBeNull();
    expect(fileExtension(".jpg")).toBeNull();
    for (const ext of GALLERY_HEIC_EXTENSIONS) expect(isHeicExtension(ext)).toBe(true);
    expect(isHeicExtension("jpg")).toBe(false);
  });

  test("uuid 형식이 아니거나 화이트리스트 밖 확장자면 경로를 만들지 않는다", () => {
    expect(() => buildUploadPaths("not-a-uuid", "jpg", AT)).toThrow();
    expect(() => buildUploadPaths(`../${UUID}`, "jpg", AT)).toThrow();
    expect(() => buildUploadPaths(UUID, "svg", AT)).toThrow();
    expect(() => buildUploadPaths(UUID, "jpg/../..", AT)).toThrow();
  });

  test("parseStoragePath — 우리 두 버킷의 규약 경로만 해석한다(삭제가 이 판정으로 지울 것을 고른다)", () => {
    const p = parseStoragePath(`gallery/2026/09/${UUID}-1600.webp`);
    expect(p).toEqual({ bucket: "gallery", key: `2026/09/${UUID}-1600.webp` });
    expect(parseStoragePath(`gallery-originals/2026/09/${UUID}.heic`)).toEqual({
      bucket: "gallery-originals",
      key: `2026/09/${UUID}.heic`,
    });
    // 우리 것이 아닌 경로는 null — 지우려 들지 않는다(옛 시드 행·로컬 파일·절대 URL)
    expect(parseStoragePath("/brand/bus.png")).toBeNull();
    expect(parseStoragePath("https://example.test/a.jpg")).toBeNull();
    expect(parseStoragePath("other-bucket/2026/09/x.webp")).toBeNull();
    expect(parseStoragePath("gallery/../secret.webp")).toBeNull();
    expect(parseStoragePath("")).toBeNull();
  });

  test("image_path 는 resolveImageUrl 이 이해하는 상대 경로다 (P2-4 규약)", async () => {
    const { resolveImageUrl } = await import("@/components/home/image-url");
    const p = buildUploadPaths(UUID, "jpg", AT);
    expect(resolveImageUrl(p.imagePath, "https://x.supabase.co")).toBe(
      `https://x.supabase.co/storage/v1/object/public/gallery/2026/09/${UUID}-1600.webp`,
    );
  });
});

// =============================================================================
// 3. 클라이언트 검증 (스펙 §13.9 (4)) — 순수 함수라 브라우저 없이 돈다
// =============================================================================
describe("3. 파일 선택 검증", () => {
  const file = (name: string, size: number) => ({ name, size });

  test("상한 — 30장 · 20MB", () => {
    expect(GALLERY_MAX_FILES).toBe(30);
    expect(GALLERY_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(GALLERY_PUBLIC_LONG_EDGE).toBe(1600);
  });

  test("30장까지 통과하고 31번째부터 거부한다 — 앞의 30장은 그대로 올린다", () => {
    const files = Array.from({ length: 31 }, (_, i) => file(`p${i}.jpg`, 1000));
    const sel = selectGalleryFiles(files);
    expect(sel.accepted).toHaveLength(30);
    expect(sel.rejected).toEqual([{ name: "p30.jpg", reason: "count" }]);
  });

  test("20MB 초과 · 빈 파일 · 형식 밖은 각각의 사유로 거부된다", () => {
    const sel = selectGalleryFiles([
      file("ok.jpg", GALLERY_MAX_BYTES),
      file("big.jpg", GALLERY_MAX_BYTES + 1),
      file("zero.png", 0),
      file("doc.pdf", 100),
      file("noext", 100),
    ]);
    expect(sel.accepted.map((f) => f.name)).toEqual(["ok.jpg"]);
    expect(sel.rejected).toEqual([
      { name: "big.jpg", reason: "size" },
      { name: "zero.png", reason: "empty" },
      { name: "doc.pdf", reason: "type" },
      { name: "noext", reason: "type" },
    ]);
  });

  test("판정은 확장자로 한다 — 실측: 크롬(Windows)은 .heic 의 MIME 을 빈 문자열로 준다", () => {
    // heic-probe(2026-09-15, HeadlessChrome/145): file.type === "" 이었다. MIME 으로 거르면 heic 가 통째로 사라진다.
    const sel = selectGalleryFiles([file("IMG_0001.HEIC", 3_000_000)]);
    expect(sel.accepted.map((f) => f.name)).toEqual(["IMG_0001.HEIC"]);
    expect(sel.rejected).toEqual([]);
  });

  test("fitLongEdge — 긴 변만 1600 으로 줄이고 작은 사진은 키우지 않는다", () => {
    expect(fitLongEdge(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitLongEdge(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitLongEdge(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitLongEdge(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 });
    // 극단적인 파노라마도 최소 1px 은 남는다(0 이면 canvas 가 던진다)
    expect(fitLongEdge(20000, 3, 1600)).toEqual({ width: 1600, height: 1 });
  });
});

// =============================================================================
// 4. 서버액션 — 게이트·zod·무효화
// =============================================================================
describe("4. 서버액션", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ userId: "admin-uuid", email: "owner@example.test" } as never);
  });

  test("'use server' 첫 줄 · export 8개 전부 async · 전부 첫 문장이 게이트", () => {
    const src = read(ACTION);
    expect(src.split("\n")[0].trim()).toMatch(/^["']use server["'];?$/);
    const exports = [...codeOf(ACTION).matchAll(/^export\s+.*$/gm)].map((m) => m[0]);
    expect(exports.length, "'use server' 파일의 export 는 전부 공개 POST 엔드포인트가 된다 (ADR-3)").toBe(8);
    for (const e of exports) expect(e, e).toMatch(/^export async function/);
    for (const name of [
      "recordGalleryUpload",
      "updateGalleryPhoto",
      "toggleGalleryPhotoActive",
      "deleteGalleryPhoto",
      "createGalleryAlbum",
      "updateGalleryAlbum",
      "toggleGalleryAlbumActive",
      "deleteGalleryAlbum",
    ]) {
      const body = new RegExp(`export async function ${name}\\([^)]*\\)[^{]*\\{\\s*await requireAdmin\\(\\);`);
      expect(codeOf(ACTION), `${name} 의 첫 문장이 게이트가 아니다`).toMatch(body);
    }
    expect(src).toMatch(/import \{ requireAdmin \} from "@\/lib\/auth\/requireAdmin"/);
    expect(src).not.toMatch(/as requireAdmin/);
  });

  test("업로드 기록 — 게이트가 DB 보다 먼저 돈다", async () => {
    const { client, from } = dbStub({ data: [{ id: 1 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    await recordGalleryUpload(UPLOAD);
    expect(vi.mocked(requireAdmin).mock.invocationCallOrder[0]).toBeLessThan(from.mock.invocationCallOrder[0]);
  });

  test("업로드 기록 — 성공하면 공개 화면을 한 번 무효화한다", async () => {
    const { client, chain } = dbStub({ data: [{ id: 1 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    const r = await recordGalleryUpload(UPLOAD);
    expect(r).toMatchObject({ ok: true, changed: true, code: "recorded" });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE);
    expect(vi.mocked(revalidatePath).mock.calls.filter((c) => c[0] === PUBLIC_CACHE_PATH)).toHaveLength(1);
    // insert 에 실린 컬럼 — bytes 는 원본 크기, image_path 는 공개 상대경로
    const row = chain.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      image_path: UPLOAD.imagePath,
      original_path: UPLOAD.originalPath,
      width: 1600,
      height: 1200,
      bytes: UPLOAD.bytes,
    });
  });

  test("zod 실패 — DB 를 한 번도 부르지 않고 무효화도 없다", async () => {
    const cases: unknown[] = [
      { ...UPLOAD, imagePath: "gallery/2026/09/not-a-uuid-1600.webp" },
      { ...UPLOAD, imagePath: `gallery-originals/2026/09/${UUID}-1600.webp` }, // 공개본이 비공개 버킷을 가리킨다
      { ...UPLOAD, originalPath: `gallery/2026/09/${UUID}.heic` }, // 원본이 공개 버킷을 가리킨다
      { ...UPLOAD, originalPath: `gallery-originals/2026/09/${randomUUID()}.heic` }, // 짝이 아닌 uuid
      { ...UPLOAD, imagePath: `gallery/2026/09/${UUID}-1600.png` }, // 공개본은 반드시 webp
      { ...UPLOAD, bytes: GALLERY_MAX_BYTES + 1 },
      { ...UPLOAD, bytes: 0 },
      { ...UPLOAD, width: 0 },
      { ...UPLOAD, caption: "x".repeat(GALLERY_CAPTION_MAX + 1) },
      { ...UPLOAD, albumId: 0 },
      { ...UPLOAD, albumId: "1" },
      null,
      undefined,
      "gallery/2026/09/x.webp",
    ];
    for (const bad of cases) {
      vi.clearAllMocks();
      const { client, from } = dbStub({ data: [{ id: 1 }], error: null });
      vi.mocked(createSsrClient).mockReturnValue(client as never);
      const r = await recordGalleryUpload(bad);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      expect(r.code, JSON.stringify(bad)).toBe("validation");
      expect(from, JSON.stringify(bad)).not.toHaveBeenCalled();
      expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    }
  });

  test("requireAdmin 이 리다이렉트(throw)하면 DB 는 돌지 않는다", async () => {
    const { client, from } = dbStub({ data: [{ id: 1 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    vi.mocked(requireAdmin).mockRejectedValue(new Error("NEXT_REDIRECT"));
    for (const call of [
      () => recordGalleryUpload(UPLOAD),
      () => updateGalleryPhoto({ id: 7, caption: null, albumId: null, sort: 0 }),
      () => toggleGalleryPhotoActive({ id: 7, active: false }),
      () => deleteGalleryPhoto({ id: 7 }),
      () => createGalleryAlbum({ title: "t", slug: "t", sort: 0, active: true }),
      () => updateGalleryAlbum({ id: 1, title: "t", slug: "t", sort: 0, active: true }),
      () => toggleGalleryAlbumActive({ id: 1, active: false }),
      () => deleteGalleryAlbum({ id: 1 }),
    ]) {
      await expect(call()).rejects.toThrow("NEXT_REDIRECT");
    }
    expect(from).not.toHaveBeenCalled();
  });

  test("0행 = 정책에 막혔거나 그런 행이 없다 → notFound (무효화 없음)", async () => {
    const { client } = dbStub({ data: [], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    const r = await toggleGalleryPhotoActive({ id: 7, active: false });
    expect(r).toEqual({ ok: false, changed: false, code: "notFound" });
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  test("앨범 — 만들기·이름 바꾸기·내리기. slug 는 0008 CHECK 와 같은 규칙으로 먼저 거른다", async () => {
    const { client, chain } = dbStub({ data: [{ id: 3 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    const ok = await createGalleryAlbum({ title: "45인승", slug: "bus-45", sort: 1, active: true });
    expect(ok).toMatchObject({ ok: true, code: "albumCreated" });
    expect(chain.insert.mock.calls[0][0]).toMatchObject({ slug: "bus-45", title: "45인승", sort: 1, active: true });

    for (const bad of [
      { title: "x", slug: "Bus-45", sort: 0, active: true },
      { title: "x", slug: "-bus", sort: 0, active: true },
      { title: "x", slug: "bus--45", sort: 0, active: true },
      { title: "x", slug: "a".repeat(41), sort: 0, active: true },
      { title: "", slug: "bus", sort: 0, active: true },
      { title: "x".repeat(ALBUM_TITLE_MAX + 1), slug: "bus", sort: 0, active: true },
    ]) {
      const r = await createGalleryAlbum(bad);
      expect(r.code, JSON.stringify(bad)).toBe("validation");
    }
  });

  test("앨범 slug 규칙은 공개 읽기(lib/queries/albums.ts)와 같은 판정이다", async () => {
    const { ALBUM_SLUG_RE } = await import("@/lib/admin/galleryInput");
    for (const s of ["bus-45", "a", "a1-b2-c3", "Bus", "-a", "a-", "a--b", "", "../x", "a b"]) {
      expect(ALBUM_SLUG_RE.test(s), s).toBe(ALBUM_SLUG_PATTERN.test(s));
      if (s.length >= 1 && s.length <= 40) expect(ALBUM_SLUG_RE.test(s), s).toBe(parseAlbumSlug(s) !== null);
    }
  });
});

// =============================================================================
// 4-B. commitUpload — 되돌리기 규칙 (독립 리뷰 F1·M2)
//      포트를 주입해 **실제로 거부하고 실제로 던지는** 기록 함수를 관찰한다. 소스 정규식은 "그렇게 적혀 있다"만
//      증명하고, F1 이 잡아낸 것은 바로 그 틈(서버액션이 던지면 되돌리기도 잠금 해제도 돌지 않았다)이었다.
// =============================================================================
describe("4-B. 업로드 커밋과 되돌리기", () => {
  const PATHS = buildUploadPaths(UUID, "heic", AT);
  const META = { width: 1600, height: 1200, bytes: 4_200_000, albumId: null, caption: null, sort: 0, active: true };

  function ports(record: (input: unknown) => Promise<{ ok: boolean; code: string }>, uploadError: unknown = null) {
    const removed: string[] = [];
    const uploaded: string[] = [];
    const storage = {
      upload: vi.fn(async (bucket: string, key: string) => {
        uploaded.push(`${bucket}/${key}`);
        return { error: uploadError };
      }),
      remove: vi.fn(async (bucket: string, key: string) => {
        removed.push(`${bucket}/${key}`);
      }),
    };
    return { storage, removed, uploaded, record: vi.fn(record) };
  }

  const run = (p: ReturnType<typeof ports>) =>
    commitUpload({
      paths: PATHS,
      original: "original-bytes",
      publicBody: "webp-bytes",
      originalContentType: "image/heic",
      publicCacheControl: "31536000",
      meta: META,
      storage: p.storage,
      record: p.record as never,
    });

  test("성공 — 두 파일을 올리고 행을 만들고 아무것도 지우지 않는다", async () => {
    const p = ports(async () => ({ ok: true, code: "recorded" }));
    expect(await run(p)).toEqual({ kind: "done" });
    expect(p.uploaded).toEqual([`gallery-originals/${PATHS.originalKey}`, `gallery/${PATHS.publicKey}`]);
    expect(p.removed).toEqual([]);
    // 행에 실린 경로가 올린 객체와 같은 것이어야 한다
    expect(p.record.mock.calls[0][0]).toMatchObject({ imagePath: PATHS.imagePath, originalPath: PATHS.originalPath, ...META });
  });

  test("기록이 **거부**되면(validation) 두 파일을 되돌린다 — 행이 없음이 증명된 경우다", async () => {
    const p = ports(async () => ({ ok: false, code: "validation" }));
    expect(await run(p)).toEqual({ kind: "failed", reason: "record" });
    expect(p.removed).toEqual([`gallery/${PATHS.publicKey}`, `gallery-originals/${PATHS.originalKey}`]);
  });

  test("notFound 도 되돌린다", async () => {
    const p = ports(async () => ({ ok: false, code: "notFound" }));
    expect(await run(p)).toEqual({ kind: "failed", reason: "record" });
    expect(p.removed).toHaveLength(2);
  });

  // F1 — 이 테스트가 없어서 놓쳤다: 서버액션이 **던지면** 되돌리기도 잠금 해제도 돌지 않았다.
  test("서버액션이 던지면(연결 끊김·세션 만료·배포) 예외를 밖으로 내보내지 않고 needsCheck 로 끝낸다", async () => {
    const p = ports(async () => {
      throw new Error("Failed to fetch");
    });
    await expect(run(p)).resolves.toEqual({ kind: "failed", reason: "needsCheck" });
  });

  // M2 — 응답을 못 받았거나 결과가 불확실하면 **지우지 않는다**. 지웠는데 행이 살아 있으면 active=true 인 행이
  //      없는 파일을 가리킨다(가장 나쁜 상태). 파일만 남으면 눈에 안 보이는 용량일 뿐이다.
  test("결과가 불확실하면 파일을 지우지 않는다 — 던진 경우와 failed 인 경우 둘 다", async () => {
    const thrown = ports(async () => {
      throw new Error("network");
    });
    await run(thrown);
    expect(thrown.removed, "행이 만들어졌을 수도 있는데 파일을 지웠다").toEqual([]);

    const failed = ports(async () => ({ ok: false, code: "failed" }));
    expect(await run(failed)).toEqual({ kind: "failed", reason: "needsCheck" });
    expect(failed.removed).toEqual([]);
  });

  test("원본 업로드 실패 — 되돌릴 것이 없고 공개본을 올리지 않는다", async () => {
    const p = ports(async () => ({ ok: true, code: "recorded" }), { message: "storage down" });
    expect(await run(p)).toEqual({ kind: "failed", reason: "upload" });
    expect(p.uploaded).toEqual([`gallery-originals/${PATHS.originalKey}`]);
    expect(p.removed).toEqual([]);
    expect(p.record).not.toHaveBeenCalled();
  });

  test("공개본 업로드 실패 — 원본을 되돌리고 기록하지 않는다", async () => {
    const removed: string[] = [];
    let call = 0;
    const storage = {
      upload: vi.fn(async () => {
        call += 1;
        return { error: call === 2 ? { message: "boom" } : null };
      }),
      remove: vi.fn(async (bucket: string, key: string) => {
        removed.push(`${bucket}/${key}`);
      }),
    };
    const record = vi.fn(async () => ({ ok: true, code: "recorded" }));
    const outcome = await commitUpload({
      paths: PATHS,
      original: "o",
      publicBody: "w",
      originalContentType: "image/heic",
      publicCacheControl: "31536000",
      meta: META,
      storage,
      record: record as never,
    });
    expect(outcome).toEqual({ kind: "failed", reason: "upload" });
    expect(removed).toEqual([`gallery-originals/${PATHS.originalKey}`]);
    expect(record).not.toHaveBeenCalled();
  });

  test("되돌리기 자체가 던져도 결과가 바뀌지 않는다 — 고아 파일은 화면을 깨지 않는다", async () => {
    const storage = {
      upload: vi.fn(async () => ({ error: null })),
      remove: vi.fn(async () => {
        throw new Error("remove failed");
      }),
    };
    const outcome = await commitUpload({
      paths: PATHS,
      original: "o",
      publicBody: "w",
      originalContentType: "image/heic",
      publicCacheControl: "31536000",
      meta: META,
      storage,
      record: (async () => ({ ok: false, code: "validation" })) as never,
    });
    expect(outcome).toEqual({ kind: "failed", reason: "record" });
  });

  test("업로더는 이 규칙을 자기 안에 다시 적지 않는다 — commitUpload 에 진짜 서버액션을 물린다", () => {
    const src = codeOf(UPLOADER_UI);
    expect(src).toMatch(/commitUpload\(/);
    expect(src).toMatch(/record: recordGalleryUpload/);
    // 잠금 해제는 finally 안에 있어야 한다(F1) — try 를 빠져나가는 어떤 경로에서도 화면이 잠기지 않는다
    expect(src).toMatch(/finally\s*\{[\s\S]{0,200}setBusy\(false\)/);
    // 되돌리기 **판단**은 순수 모듈에만 있어야 한다. 컴포넌트에서 remove 가 등장해도 되는 곳은
    // 포트 어댑터(storagePort)뿐이고, 업로드 루프(onPick) 안에는 없어야 한다 — 두 곳에 규칙이 갈리면 M2 가 되살아난다.
    const loop = src.slice(src.indexOf("const onPick"));
    expect(loop.length, "onPick 을 찾지 못했다").toBeGreaterThan(0);
    expect(loop, "업로드 루프가 스스로 파일을 지운다").not.toMatch(/\.remove\(/);
    expect(src.slice(0, src.indexOf("const onPick"))).toMatch(/function storagePort/);
  });
});

// =============================================================================
// 5. 삭제 — 파일 먼저, 행 나중. 파일이 실패하면 행을 남긴다
// =============================================================================
describe("5. 삭제 순서와 부분 실패", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ userId: "admin-uuid", email: "owner@example.test" } as never);
  });

  test("행 읽기 → 노출 끄기 → 두 버킷 삭제 → 행 삭제", async () => {
    const stub = dbStub([
      { data: PHOTO_ROW, error: null }, // getAdminPhoto
      { data: [{ id: 7 }], error: null }, // active=false
      { data: [{ id: 7 }], error: null }, // delete
    ]);
    vi.mocked(createSsrClient).mockReturnValue(stub.client as never);

    const r = await deleteGalleryPhoto({ id: 7 });
    expect(r).toMatchObject({ ok: true, changed: true, code: "deleted" });

    // 두 버킷 모두 지웠다. 원본이 먼저다 — 중간에 실패해도 화면에 보이는 공개본이 남는 쪽이 덜 나쁘다
    expect(stub.storageFrom.mock.calls.map((c) => c[0])).toEqual([GALLERY_ORIGINALS_BUCKET, GALLERY_BUCKET]);
    expect(stub.remove).toHaveBeenCalledTimes(2);
    expect(stub.remove.mock.calls[0][0]).toEqual([`2026/09/${UUID}.heic`]);
    expect(stub.remove.mock.calls[1][0]).toEqual([`2026/09/${UUID}-1600.webp`]);

    // 파일이 행보다 먼저다
    expect(stub.remove.mock.invocationCallOrder[1]).toBeLessThan(stub.chain.delete.mock.invocationCallOrder[0]);
    // 공개 화면에서 먼저 내린다 — 파일이 사라진 뒤 행이 남는 순간에도 방문자는 깨진 이미지를 보지 않는다
    expect(stub.chain.update.mock.calls[0][0]).toEqual({ active: false });
    expect(stub.chain.update.mock.invocationCallOrder[0]).toBeLessThan(stub.remove.mock.invocationCallOrder[0]);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE);
  });

  test("파일 삭제가 실패하면 행을 지우지 않는다 — 행 없는 파일보다 파일 없는 행이 더 나쁘다", async () => {
    const stub = dbStub(
      [
        { data: PHOTO_ROW, error: null },
        { data: [{ id: 7 }], error: null },
        { data: [{ id: 7 }], error: null },
      ],
      [{ error: { message: "storage down" } }],
    );
    vi.mocked(createSsrClient).mockReturnValue(stub.client as never);

    const r = await deleteGalleryPhoto({ id: 7 });
    expect(r).toEqual({ ok: false, changed: false, code: "fileFailed" });
    expect(stub.chain.delete).not.toHaveBeenCalled();
  });

  test("원본 경로가 비어 있어도(옛 행) 공개본만 지우고 행을 지운다", async () => {
    const stub = dbStub([
      { data: { ...PHOTO_ROW, original_path: null }, error: null },
      { data: [{ id: 7 }], error: null },
      { data: [{ id: 7 }], error: null },
    ]);
    vi.mocked(createSsrClient).mockReturnValue(stub.client as never);

    const r = await deleteGalleryPhoto({ id: 7 });
    expect(r).toMatchObject({ ok: true, code: "deleted" });
    expect(stub.storageFrom.mock.calls.map((c) => c[0])).toEqual([GALLERY_BUCKET]);
    expect(stub.chain.delete).toHaveBeenCalled();
  });

  test("우리 버킷 밖 경로(옛 시드 행·로컬 파일)는 지우려 들지 않는다", async () => {
    const stub = dbStub([
      { data: { ...PHOTO_ROW, image_path: "/brand/bus.png", original_path: null }, error: null },
      { data: [{ id: 7 }], error: null },
      { data: [{ id: 7 }], error: null },
    ]);
    vi.mocked(createSsrClient).mockReturnValue(stub.client as never);

    const r = await deleteGalleryPhoto({ id: 7 });
    expect(r).toMatchObject({ ok: true, code: "deleted" });
    expect(stub.remove).not.toHaveBeenCalled();
  });

  test("행이 없으면 스토리지를 건드리지 않는다", async () => {
    const stub = dbStub([{ data: null, error: null }]);
    vi.mocked(createSsrClient).mockReturnValue(stub.client as never);
    const r = await deleteGalleryPhoto({ id: 7 });
    expect(r).toEqual({ ok: false, changed: false, code: "notFound" });
    expect(stub.remove).not.toHaveBeenCalled();
    expect(stub.chain.delete).not.toHaveBeenCalled();
  });

  test("앨범 삭제는 사진을 지우지 않는다 — 0008 의 on delete set null (미분류로 남는다)", async () => {
    const stub = dbStub([{ data: [{ id: 3 }], error: null }]);
    vi.mocked(createSsrClient).mockReturnValue(stub.client as never);
    const r = await deleteGalleryAlbum({ id: 3 });
    expect(r).toMatchObject({ ok: true, code: "albumDeleted" });
    expect(stub.remove, "앨범을 지우면서 파일을 지우면 사진이 통째로 사라진다").not.toHaveBeenCalled();
    expect(stub.from.mock.calls.map((c) => c[0])).toEqual(["gallery_albums"]);
  });
});

// =============================================================================
// 6. 사용량 (스펙 §13.9 (5)) — DB 값의 합. 지어낸 수치가 아니다
// =============================================================================
describe("6. 사용량", () => {
  beforeEach(() => vi.clearAllMocks());

  test("빈 갤러리는 0장 0바이트", () => {
    expect(usageOf([])).toEqual({ photos: 0, bytes: 0 });
    expect(formatUsageSize(0)).toBe("0MB");
  });

  test("bytes 가 null 인 행도 장수에는 든다(용량만 모른다)", () => {
    expect(usageOf([{ bytes: 1000 }, { bytes: null }, { bytes: 2000 }])).toEqual({ photos: 3, bytes: 3000 });
  });

  test("표시는 반올림 — MB 는 소수 첫째 자리, 1GB 이상은 GB", () => {
    expect(formatUsageSize(1024 * 1024)).toBe("1.0MB");
    expect(formatUsageSize(1_500_000)).toBe("1.4MB");
    expect(formatUsageSize(1024 * 1024 * 1024)).toBe("1.00GB");
    expect(formatUsageSize(3 * 1024 * 1024 * 1024 + 512 * 1024 * 1024)).toBe("3.50GB");
  });

  test("1000행 경계에서 조용히 멈추지 않는다 — 빈 페이지가 나올 때까지 이어 읽는다", async () => {
    const page = (n: number, b: number) => ({ data: Array.from({ length: n }, () => ({ bytes: b })), error: null });
    const { client, chain } = dbStub([page(1000, 1000), page(1000, 1000), page(7, 1000), { data: [], error: null }]);
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    const usage = await galleryUsage();
    expect(usage).toEqual({ photos: 2007, bytes: 2_007_000 });
    // 다음 offset 은 "요청한 크기"가 아니라 **받은 행 수**로 민다 — 서버의 max_rows 가 1000 보다 작아도 정확하다.
    // 멈추는 조건은 "덜 왔다"가 아니라 "빈 페이지"다: 딱 떨어지는 경계(2000장)에서 조용히 끝나지 않게 하려는 것이고,
    // 그 대가가 마지막 빈 요청 한 번이다.
    expect(chain.range).toHaveBeenCalledTimes(4);
    expect(chain.range.mock.calls[0]).toEqual([0, 999]);
    expect(chain.range.mock.calls[1]).toEqual([1000, 1999]);
    expect(chain.range.mock.calls[3]).toEqual([2007, 3006]);
  });
});

// =============================================================================
// 7. 정적 규약
// =============================================================================
describe("7. 정적 규약", () => {
  test("서비스 롤 0 · unstable_cache 0 (ADR-2·ADR-3)", () => {
    for (const rel of TS_TARGETS) {
      expect(read(rel), rel).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE_KEY|supabase\/server/);
      expect(codeOf(rel), rel).not.toMatch(/unstable_cache/);
    }
  });

  test("signed URL 0 — 만들려면 서비스 롤이 필요하다(ADR-9 수단 변경의 이유)", () => {
    for (const rel of TS_TARGETS) {
      expect(codeOf(rel), rel).not.toMatch(/createSignedUrl|createSignedUploadUrl/);
    }
  });

  test("관리자 경로에 process.env 분기 0 (check-admin-gate 규칙 6)", () => {
    for (const rel of TS_TARGETS) {
      expect(codeOf(rel), rel).not.toMatch(/process\s*\.\s*env|NODE_ENV/);
    }
  });

  test("한글 리터럴 0 — 문구는 messages/ko.json admin.gallery.* 에서만 온다", () => {
    for (const rel of TS_TARGETS) {
      const code = codeOf(rel);
      const lines = code.split("\n").filter((l) => HANGUL.test(l));
      expect(lines, `${rel} 에 한글 리터럴: ${lines.join(" / ")}`).toEqual([]);
    }
  });

  test("새 패키지 0 — sharp·heic 디코더를 넣지 않았다(ADR-9)", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(" ");
    expect(all).not.toMatch(/sharp|heic|heif|libvips|browser-image-compression/i);
  });

  test("공개 읽기 계층은 그대로다 — bytes·original_path 가 새지 않는다 (P6-1 규약)", () => {
    for (const rel of ["lib/queries/gallery.ts", "lib/queries/albums.ts"]) {
      const code = codeOf(rel);
      expect(code, rel).not.toMatch(/\bbytes\b/);
      expect(code, rel).not.toMatch(/original_path|originalPath/);
    }
    // 관리자 select 에는 있어야 한다 — 삭제가 원본 경로를 알아야 파일을 지운다
    expect(GALLERY_ADMIN_SELECT.split(",")).toContain("original_path");
    expect(GALLERY_ADMIN_SELECT.split(",")).toContain("bytes");
    expect(GALLERY_ADMIN_SELECT).not.toContain("*");
    expect(ALBUM_ADMIN_SELECT).not.toContain("*");
  });

  test("화면 — 첫 문장이 게이트다", () => {
    expect(codeOf(LIST_PAGE)).toMatch(/export default async function \w+\([^)]*\)[^{]*\{\s*await requireAdmin\(\);/);
  });

  test("클라이언트 컴포넌트 3종은 'use client' 로 시작한다 — 업로더만 브라우저 코드를 갖는다", () => {
    for (const rel of [UPLOADER_UI, CARD_UI, ALBUMS_UI]) {
      expect(read(rel).split("\n")[0].trim(), rel).toMatch(/^["']use client["'];?$/);
    }
    // 서버 컴포넌트에 canvas·File API 가 새지 않는다
    expect(codeOf(LIST_PAGE)).not.toMatch(/createImageBitmap|canvas|FileReader/i);
  });

  test("업로더는 브라우저 세션으로 직접 올린다 — 서버액션에 파일 본문을 넘기지 않는다 (ADR-9)", () => {
    const src = codeOf(UPLOADER_UI);
    expect(src).toMatch(/createBrowserSupabase/);
    expect(src).toMatch(/\.storage\s*\.from\(/);
    expect(src).toMatch(/createImageBitmap/);
    expect(src).toMatch(/toBlob|convertToBlob/);
    // 서버액션에 넘어가는 것은 경로·크기 메타뿐이다
    expect(src).not.toMatch(/FormData\([^)]*\)[\s\S]{0,200}append\((["'])file\1/);
    expect(src).toMatch(/recordGalleryUpload/);
  });

  test("HEIC — 디코드에 실패하면 업로드하지 않고 안내한다(서버 변환 없음)", () => {
    const src = codeOf(UPLOADER_UI);
    expect(src).toMatch(/isHeicExtension/);
    expect(src).toMatch(/heic/i);
    const ko = JSON.parse(read("messages/ko.json")) as Record<string, never>;
    const gallery = (ko.admin as Record<string, Record<string, string>>).gallery;
    expect(gallery.heicHelp, "아이폰 설정 안내 문구가 없다").toBeTruthy();
    expect(gallery.heicHelp).toContain("높은 호환성");
  });

  // P5-8 이 여섯 번째 탭(발송 내역)을 덧붙였다 — tests/admin-notifications.test.ts 가 그 탭의 화면을 단언한다.
  test("탭 — 갤러리가 켜졌다. 여섯 탭 전부 ready 다", async () => {
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
    expect(ADMIN_TABS.find((t) => t.key === "gallery")?.href).toBe(ADMIN_GALLERY_PATH);
    expect(read(TABS_DEF)).toContain("/admin/gallery");
  });

  test("messages/ko.json — admin.gallery 가 생겼고 en 은 여전히 비어 있다", () => {
    const ko = JSON.parse(read("messages/ko.json")) as Record<string, never>;
    const gallery = (ko.admin as Record<string, Record<string, unknown>>).gallery;
    for (const k of [
      "title",
      "sub",
      "upload",
      "uploadHint",
      "usage",
      "albumLabel",
      "albumNone",
      "albumNew",
      "albumDeleteNote",
      "empty",
      "delete",
      "deleteArm",
      "deleteConfirm",
      "processing",
      "heicHelp",
      "missingFile",
      "result",
      "reject",
      "state",
    ]) {
      expect(gallery[k], `admin.gallery.${k}`).toBeTruthy();
    }
    const result = gallery.result as Record<string, string>;
    for (const k of [
      "recorded",
      "updated",
      "deleted",
      "activated",
      "deactivated",
      "albumCreated",
      "albumUpdated",
      "albumActivated",
      "albumDeactivated",
      "albumDeleted",
      "notFound",
      "validation",
      "failed",
      "fileFailed",
    ]) {
      expect(result[k], `admin.gallery.result.${k}`).toBeTruthy();
    }
    const reject = gallery.reject as Record<string, string>;
    for (const k of ["count", "size", "type", "empty", "decode", "encode", "upload", "record", "needsCheck"]) {
      expect(reject[k], `admin.gallery.reject.${k}`).toBeTruthy();
    }
    expect(JSON.parse(read("messages/en.json"))).toEqual({});
  });

  test("로컬 스택 config.toml 에 버킷 두 개가 선언돼 있다 — CI db-test 가 정책을 실제로 시험할 수 있어야 한다", () => {
    const toml = read("supabase/config.toml");
    expect(toml).toMatch(/\[storage\.buckets\.gallery\]/);
    expect(toml).toMatch(/\[storage\.buckets\.gallery-originals\]/);
  });

  test("목록 읽기는 세션 클라이언트로 돈다 — 서비스 롤도 anon 클라이언트도 아니다", async () => {
    const { client, from } = dbStub({ data: [], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    await listAdminPhotos({ albumId: undefined });
    expect(vi.mocked(createSsrClient)).toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith("gallery");
  });
});

// =============================================================================
// 8. DB 실증 — 로컬 스택 + REQUIRE_DB_TESTS=1 에서만 (원격에는 어떤 쓰기도 하지 않는다)
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[admin-gallery.test] DB 실증 블록 skip — ${gate.reason}`);
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

describe.skipIf(!gate.allowed || !env.hasServiceRole)("8. DB — 0011 스토리지 RLS + 갤러리 표 실증", { timeout: 120_000 }, () => {
  // 이 블록은 gallery · gallery_albums 에 행을 남긴다 — 표 전체를 단언하는 블록(home 4-DB)과 줄 세운다
  // (tests/helpers/db-lock.ts GALLERY_LOCK).
  withGalleryLock();

  const baseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceHeaders = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
  const PASSWORD = `p62-${randomUUID()}`;
  const emailFor = (who: string) => `p62-${RUN}-${who}@example.test`;
  const KEY = (who: string) => `p62-${RUN}/${who}.webp`;
  /** 1×1 WebP (base64) — 실제 바이트를 올려야 스토리지 정책이 도는 것을 본다. */
  const PIXEL = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");

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
    call(method, `${env.restRoot}${pathAndQuery}`, serviceHeaders, json, prefer);

  const asUser = (token: string, method: string, pathAndQuery: string, json?: unknown, prefer?: string) =>
    call(
      method,
      `${env.restRoot}${pathAndQuery}`,
      { apikey: env.anonKey as string, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      json,
      prefer,
    );

  /**
   * 스토리지 요청 — 상태와 **본문**을 함께 돌려준다 (P6-13).
   * 거부 판정은 본문(`statusCode`·`code`)을 봐야 한다: 로컬 storage-api 는 거부·부재·중복을 **전부 HTTP 400** 으로 싸서 보낸다
   * (tests/helpers/expect-denied.ts 머리 주석). 상태만 돌려주던 옛 판은 그 셋을 구분할 수 없었다.
   */
  async function storageFetch(method: string, url: string, headers: Record<string, string>, body?: typeof PIXEL): Promise<Res> {
    const res = await fetch(url, { method, headers, body });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // 객체 바이트 등 JSON 이 아니면 문자열 그대로
    }
    return { status: res.status, body: parsed };
  }

  const objectUrl = (bucket: string, key: string) => `${baseUrl()}/storage/v1/object/${bucket}/${key}`;

  /** 스토리지 업로드 — 토큰이 없으면 anon 키로. */
  async function upload(token: string | null, bucket: string, key: string): Promise<Res> {
    return storageFetch(
      "POST",
      objectUrl(bucket, key),
      { apikey: env.anonKey as string, Authorization: `Bearer ${token ?? env.anonKey}`, "Content-Type": "image/webp" },
      PIXEL,
    );
  }

  async function download(token: string | null, bucket: string, key: string, publicPath = false): Promise<Res> {
    const url = publicPath ? `${baseUrl()}/storage/v1/object/public/${bucket}/${key}` : objectUrl(bucket, key);
    return storageFetch(
      "GET",
      url,
      token ? { apikey: env.anonKey as string, Authorization: `Bearer ${token}` } : { apikey: env.anonKey as string },
    );
  }

  async function removeObject(token: string, bucket: string, key: string): Promise<Res> {
    return storageFetch("DELETE", objectUrl(bucket, key), { apikey: env.anonKey as string, Authorization: `Bearer ${token}` });
  }

  /** 덮어쓰기(PUT) — storage 의 update 동작. 정책이 없으면 남의 사진을 갈아 끼울 수 있다(리뷰 M4). */
  async function overwrite(token: string | null, bucket: string, key: string): Promise<Res> {
    return storageFetch(
      "PUT",
      objectUrl(bucket, key),
      { apikey: env.anonKey as string, Authorization: `Bearer ${token ?? env.anonKey}`, "Content-Type": "image/webp" },
      PIXEL,
    );
  }

  /** 객체 열거 — select 정책이 지키는 동작. 토큰이 없으면 anon 키로(리뷰 M1·M4). */
  async function listObjects(token: string | null, bucket: string): Promise<Res> {
    return call(
      "POST",
      `${baseUrl()}/storage/v1/object/list/${bucket}`,
      { apikey: env.anonKey as string, Authorization: `Bearer ${token ?? env.anonKey}`, "Content-Type": "application/json" },
      { prefix: "", limit: 100 },
    );
  }

  /**
   * 버킷 보장 (리뷰 M3). `supabase/config.toml` 의 선언이 `supabase start` → `db reset` 을 지나 남는지는
   * 이 머신에서 확인할 수 없었다(Docker 부재). 남지 않는 CLI 버전에서도 CI 가 "버킷 없음"으로 죽지 않도록
   * 여기서 서비스 롤로 만들어 둔다 — **로컬 스택 + REQUIRE_DB_TESTS=1 블록 안이라 원격에서는 절대 돌지 않는다.**
   * 이미 있으면 아무것도 하지 않는다(설정을 덮어쓰지 않는다).
   */
  async function ensureBucket(id: string, isPublic: boolean): Promise<void> {
    const found = await call("GET", `${baseUrl()}/storage/v1/bucket/${id}`, serviceHeaders);
    if (found.status === 200) return;
    const created = await call("POST", `${baseUrl()}/storage/v1/bucket`, serviceHeaders, {
      id,
      name: id,
      public: isPublic,
      file_size_limit: 20 * 1024 * 1024,
      allowed_mime_types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
    });
    expect(created.status, `버킷 ${id} 생성 실패: ${JSON.stringify(created.body).slice(0, 300)}`).toBeLessThan(300);
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
      { apikey: env.anonKey as string, "Content-Type": "application/json" },
      { email, password: PASSWORD },
    );
    expect(r.status, `로그인 실패: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(200);
    return (r.body as { access_token: string }).access_token;
  }

  let adminId = "";
  let plainId = "";
  let adminToken = "";
  let plainToken = "";
  let albumId = 0;
  let photoId = 0;

  test("준비 — 버킷 2개가 있고, 관리자 1명·일반 로그인 1명", async () => {
    await ensureBucket("gallery", true);
    await ensureBucket("gallery-originals", false);

    const buckets = await call("GET", `${baseUrl()}/storage/v1/bucket`, serviceHeaders);
    const names = (buckets.body as { id: string }[]).map((b) => b.id);
    expect(names, `버킷이 없다: ${JSON.stringify(buckets.body).slice(0, 200)}`).toContain("gallery");
    expect(names).toContain("gallery-originals");
    // 공개/비공개가 뒤바뀌면 원본이 공개 라우트로 나간다 — 설정 자체를 단언한다
    const flags = new Map((buckets.body as { id: string; public: boolean }[]).map((b) => [b.id, b.public]));
    expect(flags.get("gallery"), "gallery 가 public 이 아니면 방문자에게 사진이 보이지 않는다").toBe(true);
    expect(flags.get("gallery-originals"), "원본 버킷이 public 이면 EXIF 가 붙은 원본이 그대로 열린다").toBe(false);

    adminId = await createUser(emailFor("admin"));
    plainId = await createUser(emailFor("plain"));
    adminToken = await signIn(emailFor("admin"));
    plainToken = await signIn(emailFor("plain"));
    const add = await rest("POST", "/admin_users", { user_id: adminId, email: emailFor("admin"), note: "P6-2 test" });
    expect(add.status, JSON.stringify(add.body).slice(0, 300)).toBeLessThan(300);
  });

  test("스토리지 — 관리자 세션만 두 버킷에 올릴 수 있다", async () => {
    expect((await upload(adminToken, "gallery", KEY("pub"))).status).toBeLessThan(300);
    expect((await upload(adminToken, "gallery-originals", KEY("orig"))).status).toBeLessThan(300);
    // P6-13 실측: 셋 다 HTTP 400 · 본문 statusCode "403" · AccessDenied · "new row violates row-level security policy" (0011 insert 정책)
    expectStorageDenied(await upload(plainToken, "gallery", KEY("intruder")), "명단 밖 세션의 gallery 업로드", STORAGE_RLS_MESSAGE);
    expectStorageDenied(await upload(plainToken, "gallery-originals", KEY("intruder")), "명단 밖 세션의 원본 업로드", STORAGE_RLS_MESSAGE);
    expectStorageDenied(await upload(null, "gallery", KEY("anon")), "anon 의 gallery 업로드", STORAGE_RLS_MESSAGE);
  });

  /**
   * 대조군 (P6-13) — Storage 의 "거부" 와 "부재" 는 **본문으로만** 갈린다(HTTP 는 둘 다 400).
   * 없는 버킷·없는 객체는 statusCode "404"(NoSuchBucket·NoSuchKey), 권한 없는 쓰기는 "403"(AccessDenied) 이다.
   * 이것이 없으면 `expectStorageDenied` 가 무엇을 걸러 내는지 알 수 없다 — 옛 `>= 400` 은 버킷 이름 오타도 "보안 성공" 으로 읽었다.
   */
  test("스토리지 대조군 — 거부(403 AccessDenied)와 부재(404 NoSuchBucket·NoSuchKey)는 구분된다", async () => {
    const missingBucket = await upload(adminToken, "p613-no-such-bucket", KEY("x"));
    expectStorageNotFound(missingBucket, "NoSuchBucket", "관리자의 없는 버킷 업로드");
    expect(() => expectStorageDenied(missingBucket, "대조"), "거부 판정이 '없는 버킷' 을 거부로 받아들였다").toThrow();

    const missingKey = await download(adminToken, "gallery-originals", KEY("never-uploaded"));
    expectStorageNotFound(missingKey, "NoSuchKey", "관리자의 없는 객체 내려받기");
    expect(() => expectStorageDenied(missingKey, "대조"), "거부 판정이 '없는 객체' 를 거부로 받아들였다").toThrow();

    const denied = await upload(plainToken, "gallery", KEY("intruder-control"));
    expectStorageDenied(denied, "명단 밖 세션의 gallery 업로드");
    expect(() => expectStorageNotFound(denied, "NoSuchBucket", "대조"), "부재 판정이 거부를 부재로 받아들였다").toThrow();
  });

  test("스토리지 — 공개 라우트는 누구나 읽고, 원본 버킷은 관리자만 읽는다", async () => {
    // 정책은 anon 에게 select 를 주지 않는다(리뷰 M1). 그래도 방문자의 사진이 보이는 것은 이 경로가
    // storage-api 에서 asSuperUser 로 처리되기 때문이다 — 그 사실을 여기서 실제로 확인한다.
    expect((await download(null, "gallery", KEY("pub"), true)).status, "공개 라우트가 막히면 홈 갤러리가 통째로 깨진다").toBe(200);
    // Storage 는 **읽기 거부를 "없음" 으로 숨긴다** (P6-13 실측 — 둘 다 HTTP 400):
    //   · 공개 라우트는 비공개 버킷을 "없는 버킷" 이라 답한다 — statusCode "404" · NoSuchBucket. 버킷이 공개로 뒤집히면 200 이 된다.
    //   · 명단 밖 세션은 RLS 가 행을 가려 "없는 객체" — statusCode "404" · NoSuchKey.
    // 이 모양만으로는 부재와 구분되지 않는다. 그래서 **같은 키를 관리자가 200 으로 읽는 줄(아래)** 이 이 두 단언의 짝이다 —
    // 키가 실제로 있다는 것을 그 줄이 증명한다.
    expectStorageNotFound(await download(null, "gallery-originals", KEY("orig"), true), "NoSuchBucket", "공개 라우트의 원본 버킷 내려받기");
    expectStorageNotFound(await download(plainToken, "gallery-originals", KEY("orig")), "NoSuchKey", "명단 밖 세션의 원본 내려받기");
    expect((await download(adminToken, "gallery-originals", KEY("orig"))).status, "대조 — 같은 키가 실제로 있다").toBe(200);
  });

  // 리뷰 M1·M4 — select 정책이 지키는 것은 내려받기가 아니라 **열거**다. 열려 있으면 내려 둔 사진의 키까지 샌다.
  test("스토리지 — anon 은 공개 버킷의 객체 목록을 볼 수 없다. 관리자만 본다", async () => {
    const anonList = await listObjects(null, "gallery");
    const anonNames = Array.isArray(anonList.body) ? (anonList.body as { name: string }[]).map((o) => o.name) : [];
    expect(anonNames, `anon 이 공개 버킷을 열거했다: ${JSON.stringify(anonList.body).slice(0, 200)}`).toEqual([]);

    const plainList = await listObjects(plainToken, "gallery");
    const plainNames = Array.isArray(plainList.body) ? (plainList.body as { name: string }[]).map((o) => o.name) : [];
    expect(plainNames, "명단 밖 로그인 세션이 공개 버킷을 열거했다").toEqual([]);

    const originalsList = await listObjects(plainToken, "gallery-originals");
    const originalNames = Array.isArray(originalsList.body) ? (originalsList.body as { name: string }[]).map((o) => o.name) : [];
    expect(originalNames, "명단 밖 세션이 원본 버킷을 열거했다").toEqual([]);

    // 반대 방향 — 정책이 "아무도 못 본다"가 아니라 "관리자만 본다"인지 확인한다(빈 목록이 통과 사유가 되지 않게)
    const adminList = await listObjects(adminToken, "gallery");
    const adminNames = Array.isArray(adminList.body) ? (adminList.body as { name: string }[]).map((o) => o.name) : [];
    expect(adminNames.length, `관리자가 자기 버킷을 못 본다: ${JSON.stringify(adminList.body).slice(0, 200)}`).toBeGreaterThan(0);
  });

  // 리뷰 M4 — update 정책이 없으면 남의 사진을 같은 키로 갈아 끼울 수 있다(주소는 그대로, 내용만 바뀐다).
  test("스토리지 — 명단 밖 세션·anon 은 덮어쓰지 못한다", async () => {
    // P6-13 실측: 셋 다 HTTP 400 · 본문 statusCode "403" · AccessDenied · "new row violates row-level security policy" (0011 update 정책)
    expectStorageDenied(await overwrite(plainToken, "gallery", KEY("pub")), "명단 밖 세션의 gallery 덮어쓰기", STORAGE_RLS_MESSAGE);
    expectStorageDenied(await overwrite(null, "gallery", KEY("pub")), "anon 의 gallery 덮어쓰기", STORAGE_RLS_MESSAGE);
    expectStorageDenied(await overwrite(plainToken, "gallery-originals", KEY("orig")), "명단 밖 세션의 원본 덮어쓰기", STORAGE_RLS_MESSAGE);
    // 관리자는 덮어쓸 수 있다(정책이 update 를 관리자에게 열어 둔 이유)
    expect((await overwrite(adminToken, "gallery", KEY("pub"))).status).toBeLessThan(300);
  });

  test("스토리지 — 관리자만 지운다", async () => {
    // P6-13 실측: HTTP 400 · 본문 statusCode "403" · AccessDenied · "Access denied" (0011 delete 정책이 행을 가린다).
    // 다음 줄의 관리자 삭제 성공이 "키가 실제로 있었다" 의 대조다(없는 키면 관리자도 404 NoSuchKey 를 받는다).
    expectStorageDenied(await removeObject(plainToken, "gallery", KEY("pub")), "명단 밖 세션의 gallery 삭제", STORAGE_DELETE_DENIED_MESSAGE);
    expect((await removeObject(adminToken, "gallery", KEY("pub"))).status).toBeLessThan(300);
    expect((await removeObject(adminToken, "gallery-originals", KEY("orig"))).status).toBeLessThan(300);
  });

  test("표 — 관리자 세션이 사진 행을 만들고 고치고 지운다 (0009 gallery_admin_all)", async () => {
    const album = await asUser(
      adminToken,
      "POST",
      "/gallery_albums",
      { slug: `p62-${RUN}`, title: `P6-2 ${RUN}`, sort: 1, active: true },
      "return=representation",
    );
    expect(album.status, JSON.stringify(album.body).slice(0, 300)).toBe(201);
    albumId = (album.body as { id: number }[])[0].id;

    const ins = await asUser(
      adminToken,
      "POST",
      "/gallery",
      {
        image_path: `gallery/p62-${RUN}/a-1600.webp`,
        original_path: `gallery-originals/p62-${RUN}/a.heic`,
        width: 1600,
        height: 1200,
        bytes: 4_200_000,
        album_id: albumId,
        sort: 1,
        active: true,
      },
      "return=representation",
    );
    expect(ins.status, JSON.stringify(ins.body).slice(0, 300)).toBe(201);
    photoId = (ins.body as { id: number }[])[0].id;

    const up = await asUser(adminToken, "PATCH", `/gallery?id=eq.${photoId}`, { caption: "p62" }, "return=representation");
    expect(up.status).toBeLessThan(300);
  });

  test("표 — 명단에 없는 로그인 세션은 사진을 만들지도 고치지도 못한다", async () => {
    const ins = await asUser(plainToken, "POST", "/gallery", { image_path: `gallery/p62-${RUN}/x.webp`, sort: 1, active: true });
    // P6-13 실측: 403 · 42501 · `new row violates row-level security policy for table "gallery"` — 0009 gallery_admin_all 의 with check.
    expectRlsInsertDenied(ins, "gallery", "명단 밖 세션의 gallery INSERT");
    await asUser(plainToken, "PATCH", `/gallery?id=eq.${photoId}`, { caption: "hijacked" });
    await asUser(plainToken, "DELETE", `/gallery?id=eq.${photoId}`);
    const still = await rest("GET", `/gallery?select=caption&id=eq.${photoId}`);
    expect((still.body as { caption: string }[])[0].caption).toBe("p62");
  });

  test("anon — 활성 앨범의 활성 사진만 보인다 (0008 회귀)", async () => {
    const seen = async () => {
      const r = await call("GET", `${env.restRoot}/gallery?select=id&id=eq.${photoId}`, {
        apikey: env.anonKey as string,
        Authorization: `Bearer ${env.anonKey}`,
      });
      return (r.body as unknown[]).length;
    };
    expect(await seen()).toBe(1);
    await rest("PATCH", `/gallery_albums?id=eq.${albumId}`, { active: false });
    expect(await seen(), "비활성 앨범의 사진이 anon 에게 보인다").toBe(0);
    await rest("PATCH", `/gallery_albums?id=eq.${albumId}`, { active: true });
    await rest("PATCH", `/gallery?id=eq.${photoId}`, { active: false });
    expect(await seen()).toBe(0);
    await rest("PATCH", `/gallery?id=eq.${photoId}`, { active: true });
  });

  test("정리 — 만든 것을 전부 지운다", async () => {
    await asUser(adminToken, "DELETE", `/gallery?id=eq.${photoId}`);
    await rest("DELETE", `/gallery?image_path=like.${encodeURIComponent(`*p62-${RUN}*`)}`);
    await rest("DELETE", `/gallery_albums?slug=like.${encodeURIComponent(`*p62-${RUN}*`)}`);
    await rest("DELETE", `/admin_users?user_id=eq.${adminId}`);
    for (const id of [adminId, plainId]) {
      if (id) await call("DELETE", `${baseUrl()}/auth/v1/admin/users/${id}`, serviceHeaders);
    }
    const leftPhotos = await rest("GET", `/gallery?select=id&image_path=like.${encodeURIComponent(`*p62-${RUN}*`)}`);
    const leftAlbums = await rest("GET", `/gallery_albums?select=id&slug=like.${encodeURIComponent(`*p62-${RUN}*`)}`);
    expect(leftPhotos.body).toEqual([]);
    expect(leftAlbums.body).toEqual([]);
  });
});
