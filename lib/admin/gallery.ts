/**
 * 관리자 갤러리 읽기·쓰기 — SSR 세션 + RLS (플랜 v4 P6-2 · ADR-2·ADR-3).
 *
 * **읽기는 표에서, 행 쓰기는 definer 함수로** (P5-16 · 마이그레이션 0020 · known-defects **D10**) —
 * 판단이 뒤집힌 경위는 lib/admin/notices.ts 헤더와 같다. 정책이 부족해서가 아니라 **GRANT** 때문이다:
 * 세션 롤(`authenticated`)이 표에 UPDATE·DELETE 를 가지면 PostgreSQL 이 그 롤에게 `ACCESS EXCLUSIVE` 잠금도
 * 허용해(`LockTableAclCheck`) 로그인만 한 사람이 갤러리·앨범 표를 잠글 수 있었다. RLS 는 그것을 막지 못한다.
 * 0020 이 표 쓰기 권한을 회수했고 행 쓰기는 `admin_*_gallery_photo`·`admin_*_album` definer 함수로 간다.
 * 읽기는 그대로 표에서 한다(`gallery_admin_select`·`gallery_albums_admin_select` — 0020 이 0009 의 `_admin_all` 을 좁힌 것).
 *
 * **파일도 같은 세션으로 지운다.** 0011 의 `storage.objects` 정책이 `is_admin()` 을 요구하므로, 서비스 롤 없이
 * (ADR-2) 관리자 쿠키 세션 그대로 Storage 를 부른다. 업로드는 여기 없다 — 브라우저가 직접 한다(ADR-9,
 * components/admin/GalleryUploader.tsx). 서버가 만지는 파일 작업은 **삭제뿐**이고, 삭제 요청 본문은 경로 문자열 하나다.
 *
 * 캐시를 모른다(ADR-3). 관리자 화면은 캐시하지 않고, 무효화는 액션이 한다.
 * 공개 노출 규칙(active + 앨범 active)은 0008 의 정책이 판정한다 — 여기서는 **거르지 않는다.**
 * 관리자는 내린 사진을 되살릴 수 있어야 하고, 되살리려면 먼저 보여야 한다.
 */
import "server-only";

import { cookies } from "next/headers";

import { createSsrClient } from "../supabase/ssr";
import { isAdminGuardDenial, rpcChangedRows } from "./adminRpc";
import {
  GALLERY_BUCKET,
  GALLERY_ORIGINALS_BUCKET,
  parseStoragePath,
  usageOf,
  type AlbumValues,
  type GalleryPatchValues,
  type GalleryUploadValues,
  type GalleryUsage,
} from "./galleryInput";

export type AdminDbClient = ReturnType<typeof createSsrClient>;

export const GALLERY_TABLE = "gallery";
export const ALBUM_TABLE = "gallery_albums";

/** 쓰기 경로 — 0020 의 definer 함수 이름(lib/admin/notices.ts NOTICE_RPC 와 같은 규약). */
export const GALLERY_RPC = {
  createPhoto: "admin_create_gallery_photo",
  updatePhoto: "admin_update_gallery_photo",
  setPhotoActive: "admin_set_gallery_photo_active",
  deletePhoto: "admin_delete_gallery_photo",
  createAlbum: "admin_create_album",
  updateAlbum: "admin_update_album",
  setAlbumActive: "admin_set_album_active",
  deleteAlbum: "admin_delete_album",
} as const;

/** 관리자 화면 경로 — 무효화 대상과 탭의 링크가 갈리지 않게 한 곳에 둔다(components/admin/tabs.ts 가 이 값을 쓴다). */
export const ADMIN_GALLERY_PATH = "/admin/gallery";

/** 한 화면에 그리는 사진 수 상한. 넘으면 앨범으로 나눠 보시라는 뜻이다(앨범 필터가 그 도구다). */
export const ADMIN_GALLERY_LIST_LIMIT = 120;

/** 사용량 합계를 읽는 페이지 크기. PostgREST 의 db.max_rows(기본 1000)보다 크게 잡지 않는다. */
export const USAGE_PAGE_SIZE = 1000;

/** select 화이트리스트 — `select('*')` 금지. bytes·original_path 는 **관리자 전용**이다(P6-1 §5). */
export const GALLERY_ADMIN_COLUMNS = [
  "id",
  "image_path",
  "original_path",
  "caption",
  "sort",
  "active",
  "album_id",
  "width",
  "height",
  "bytes",
  "created_at",
] as const;
export const GALLERY_ADMIN_SELECT: string = GALLERY_ADMIN_COLUMNS.join(",");

export const ALBUM_ADMIN_COLUMNS = ["id", "slug", "title", "description", "sort", "active", "created_at"] as const;
export const ALBUM_ADMIN_SELECT: string = ALBUM_ADMIN_COLUMNS.join(",");

export interface AdminGalleryRow {
  id: number;
  image_path: string;
  original_path: string | null;
  caption: string | null;
  sort: number;
  active: boolean;
  album_id: number | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  created_at: string;
}

export interface AdminAlbumRow {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  sort: number;
  active: boolean;
  created_at: string;
}

/** 앨범 필터 — `undefined` 전체 · `null` 미분류 · 숫자 그 앨범. */
export interface GalleryListFilter {
  albumId: number | null | undefined;
}

/** 오류 문구에 행 내용을 싣지 않는다 — code·message 만(lib/admin/notices.ts 와 같은 규약). */
function fail(op: string, error: { code?: string | null; message: string }): never {
  throw new Error(`adminGallery.${op}: [${error.code ?? "?"}] ${error.message}`);
}

async function sessionClient(): Promise<AdminDbClient> {
  return createSsrClient(await cookies());
}

/**
 * 한 요청 안에서 여러 번 쓰는 호출부(삭제: 읽기 → 내리기 → 파일 → 행)가 **같은 세션 클라이언트**를 쓰도록 열어 둔다.
 * 넘기지 않으면 아래 함수들이 각자 하나씩 만든다 — 동작은 같지만 쿠키 파싱을 네 번 한다.
 */
export async function adminGalleryClient(): Promise<AdminDbClient> {
  return sessionClient();
}

/**
 * 쓰기 한 번 — 0020 의 definer 함수를 세션 클라이언트로 부른다(lib/admin/notices.ts 와 같은 규약).
 * 가드 거부(명단 밖 세션)는 **바뀐 행 0** 으로, 그 밖의 오류는 던진다(lib/admin/adminRpc.ts).
 */
async function write(op: string, fn: string, args: Record<string, unknown>, client?: AdminDbClient): Promise<boolean> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    if (isAdminGuardDenial(error, fn)) return false;
    fail(op, error);
  }
  return rpcChangedRows(data);
}

// =============================================================================
// 읽기
// =============================================================================

/** 사진 목록 — 앨범 필터 + sort, id 순(공개 목록과 같은 차례). 비활성 행도 보인다. */
export async function listAdminPhotos(filter: GalleryListFilter, client?: AdminDbClient): Promise<AdminGalleryRow[]> {
  const db = client ?? (await sessionClient());
  let query = db.from(GALLERY_TABLE).select(GALLERY_ADMIN_SELECT);
  if (filter.albumId === null) query = query.is("album_id", null);
  else if (typeof filter.albumId === "number") query = query.eq("album_id", filter.albumId);

  const { data, error } = await query
    .order("sort", { ascending: true })
    .order("id", { ascending: true })
    .limit(ADMIN_GALLERY_LIST_LIMIT)
    .overrideTypes<AdminGalleryRow[], { merge: false }>();

  if (error) fail("listPhotos", error);
  return data ?? [];
}

/** 앨범 목록 — sort, id 순. 비활성 앨범도 보인다. */
export async function listAdminAlbums(client?: AdminDbClient): Promise<AdminAlbumRow[]> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db
    .from(ALBUM_TABLE)
    .select(ALBUM_ADMIN_SELECT)
    .order("sort", { ascending: true })
    .order("id", { ascending: true })
    .overrideTypes<AdminAlbumRow[], { merge: false }>();

  if (error) fail("listAlbums", error);
  return data ?? [];
}

/** 한 장. 없거나 정책에 가려지면 null. 삭제가 파일 경로를 알기 위해 먼저 부른다. */
export async function getAdminPhoto(id: number, client?: AdminDbClient): Promise<AdminGalleryRow | null> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db
    .from(GALLERY_TABLE)
    .select(GALLERY_ADMIN_SELECT)
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<AdminGalleryRow, { merge: false }>();

  if (error) fail("getPhoto", error);
  return data ?? null;
}

/**
 * 장수와 바이트 합 (스펙 §13.9 (5)). **페이지를 끝까지 읽는다** —
 * PostgREST 는 응답 행 수를 db.max_rows(기본 1000)로 자르므로 한 번만 읽으면 1000장을 넘는 순간 조용히 undercount 한다.
 * 다음 offset 을 "요청한 크기"가 아니라 **실제로 받은 행 수**로 밀기 때문에 서버의 max_rows 가 얼마든 정확하고,
 * 빈 페이지가 나올 때까지 읽으므로 경계에서 딱 떨어져도 멈추지 않는다(마지막 한 번의 빈 요청이 그 대가다).
 */
export async function galleryUsage(client?: AdminDbClient): Promise<GalleryUsage> {
  const db = client ?? (await sessionClient());
  let photos = 0;
  let bytes = 0;
  let offset = 0;
  // 상한이 아니라 폭주 방지선이다 — 한 번에 1000행씩, 200회면 20만 장이다.
  for (let page = 0; page < 200; page += 1) {
    const { data, error } = await db
      .from(GALLERY_TABLE)
      .select("bytes")
      .range(offset, offset + USAGE_PAGE_SIZE - 1)
      .overrideTypes<{ bytes: number | null }[], { merge: false }>();
    if (error) fail("usage", error);
    const rows = data ?? [];
    if (rows.length === 0) break;
    const sum = usageOf(rows);
    photos += sum.photos;
    bytes += sum.bytes;
    offset += rows.length;
  }
  return { photos, bytes };
}

// =============================================================================
// 쓰기 — 행
// =============================================================================

/** 업로드 기록. 파일은 이미 브라우저가 올렸고, 이 행이 그 파일을 화면에 잇는다. */
export async function insertGalleryPhoto(values: GalleryUploadValues, client?: AdminDbClient): Promise<boolean> {
  return write(
    "insertPhoto",
    GALLERY_RPC.createPhoto,
    {
      p_image_path: values.imagePath,
      p_original_path: values.originalPath,
      p_width: values.width,
      p_height: values.height,
      p_bytes: values.bytes,
      p_album_id: values.albumId,
      p_caption: values.caption,
      p_sort: values.sort,
      p_active: values.active,
      // created_at 은 DB default(now()) — 함수가 인자로 받지 않는다(P6-1 §7-1 · 0020 §3)
    },
    client,
  );
}

/** 캡션·앨범·순서만 고친다. 파일은 그대로다 — 앨범 이동이 UPDATE 한 줄인 이유(P6-1 §7-2). */
export async function updateGalleryPhotoRow(values: GalleryPatchValues, client?: AdminDbClient): Promise<boolean> {
  return write(
    "updatePhoto",
    GALLERY_RPC.updatePhoto,
    { p_id: values.id, p_caption: values.caption, p_album_id: values.albumId, p_sort: values.sort },
    client,
  );
}

/** 노출/중지만 바꾼다 — 목록에서 한 번에 내리기 위한 좁은 쓰기. 삭제의 첫 걸음이기도 하다. */
export async function setGalleryPhotoActive(id: number, active: boolean, client?: AdminDbClient): Promise<boolean> {
  return write("setPhotoActive", GALLERY_RPC.setPhotoActive, { p_id: id, p_active: active }, client);
}

/** 행 삭제 — 파일을 먼저 지운 뒤에만 부른다(actions/admin/gallery.ts deleteGalleryPhoto). */
export async function deleteGalleryPhotoRow(id: number, client?: AdminDbClient): Promise<boolean> {
  return write("deletePhoto", GALLERY_RPC.deletePhoto, { p_id: id }, client);
}

// =============================================================================
// 쓰기 — 앨범
// =============================================================================

export async function insertAlbum(values: AlbumValues, client?: AdminDbClient): Promise<boolean> {
  return write(
    "insertAlbum",
    GALLERY_RPC.createAlbum,
    { p_slug: values.slug, p_title: values.title, p_sort: values.sort, p_active: values.active },
    client,
  );
}

export async function updateAlbumRow(id: number, values: AlbumValues, client?: AdminDbClient): Promise<boolean> {
  return write(
    "updateAlbum",
    GALLERY_RPC.updateAlbum,
    { p_id: id, p_slug: values.slug, p_title: values.title, p_sort: values.sort, p_active: values.active },
    client,
  );
}

export async function setAlbumActive(id: number, active: boolean, client?: AdminDbClient): Promise<boolean> {
  return write("setAlbumActive", GALLERY_RPC.setAlbumActive, { p_id: id, p_active: active }, client);
}

/**
 * 앨범 삭제. 0008 의 FK 가 `on delete set null` 이라 **사진은 지워지지 않고 미분류로 남는다** —
 * 화면이 그 사실을 먼저 알려 준다(messages/ko.json admin.gallery.albumDeleteNote).
 * 여기서 사진 행이나 파일을 함께 지우는 코드를 쓰지 않는다. 앨범 하나로 사진 수백 장이 사라지는 경로를 만들지 않는다.
 */
export async function deleteAlbumRow(id: number, client?: AdminDbClient): Promise<boolean> {
  return write("deleteAlbum", GALLERY_RPC.deleteAlbum, { p_id: id }, client);
}

// =============================================================================
// 쓰기 — 파일 (0011 정책 + 관리자 세션. 서비스 롤도 signed URL 도 아니다)
// =============================================================================

/**
 * 사진 한 장의 파일을 지운다. **원본 → 공개본** 순서인 이유:
 * 중간에 실패하면 남는 상태가 갈리는데, 원본이 먼저 사라진 상태는 화면상 아무 차이가 없고(원본은 보관용이다)
 * 공개본이 먼저 사라진 상태는 그 행이 곧 깨진 이미지가 된다. 덜 나쁜 쪽을 앞에 둔다.
 *
 * 규약 밖 경로(옛 시드 행의 `/brand/...`, 절대 URL, 다른 버킷)는 **건드리지 않는다** — 우리가 올린 것이 확실한 객체만 지운다.
 * 이미 없는 키를 지우는 것은 오류가 아니다(Storage 가 error 없이 돌아온다) — 그래서 재시도가 안전하다.
 *
 * 돌려주는 값: 전부 지웠으면(또는 지울 것이 없으면) true, 한 번이라도 실패하면 false — 호출부는 false 면 행을 남긴다.
 */
export async function removePhotoObjects(row: Pick<AdminGalleryRow, "image_path" | "original_path">, client?: AdminDbClient): Promise<boolean> {
  const db = client ?? (await sessionClient());
  const targets = [parseStoragePath(row.original_path), parseStoragePath(row.image_path)].filter(
    (t): t is { bucket: string; key: string } => t !== null,
  );
  for (const target of targets) {
    if (target.bucket !== GALLERY_BUCKET && target.bucket !== GALLERY_ORIGINALS_BUCKET) continue;
    const { error } = await db.storage.from(target.bucket).remove([target.key]);
    // 첫 실패에서 멈춘다 — 반쯤 지운 상태로 행까지 지우면 무엇이 남았는지 아무도 모른다. 재시도가 이어서 한다.
    if (error) return false;
  }
  return true;
}
