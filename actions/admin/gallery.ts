"use server";
/**
 * 관리자 갤러리 서버액션 (플랜 v4 P6-2 · ADR-2·ADR-3·ADR-4·ADR-9).
 *
 * **여기로 파일이 오지 않는다.** 20MB 사진 30장은 브라우저가 Storage 로 직접 올리고(0011 정책 + 관리자 세션),
 * 이 액션들은 그 결과의 **경로·크기 메타만** 받아 행을 만든다. Server Action 본문 1MB · Vercel 4.5MB 한계를
 * 그렇게 피한다(ADR-9 — signed URL 대신 스토리지 RLS 를 쓴 이유는 0011 헤더).
 *
 * 순서: requireAdmin() → zod → DB → 바뀌었으면 무효화. **로직은 삭제 하나뿐이고** 그것도 순서 자체가 규약이다:
 *   행 읽기 → 노출 끄기 → 파일(원본→공개본) → 행.
 *   · 파일이 안 지워지면 **행을 지우지 않는다.** 행 없는 파일은 눈에 안 보이는 용량이지만, 파일 없는 행은
 *     깨진 이미지다 — 나쁜 쪽을 고르지 않는다.
 *   · 그런데 파일을 먼저 지우는 동안 행은 잠깐 파일 없이 남는다. 그 창을 없애려고 **먼저 노출을 끈다** —
 *     방문자 화면에서 내려간 뒤에 파일이 사라지므로, 어느 단계에서 멈춰도 공개 화면에는 깨진 이미지가 뜨지 않는다.
 *   · 스토리지 삭제는 이미 없는 키에도 오류를 내지 않는다 → **재시도가 안전하다**(중간에 멈췄으면 다시 누르면 이어서 끝난다).
 *
 * 경계 규칙 (actions/admin/notice.ts 와 같은 규약)
 *   - export 는 async 함수 8개뿐이다(ADR-3 — 'use server' 파일의 export 는 전부 공개 POST 엔드포인트가 된다).
 *     **여덟 함수 모두 본문 첫 문장이 `await requireAdmin();`** 이고 게이트는 별칭 없이 정본 이름으로 가져온다.
 *   - 인자는 폼이 아니라 **직렬화 가능한 객체**다. 이 탭의 화면은 전부 클라이언트 컴포넌트고(업로더가 JS 없이는
 *     동작하지 않는다), 업로드 기록은 폼 제출이 아니라 업로드 루프의 결과다. 신뢰하지 않는 값인 것은 FormData 와 같아서
 *     전부 zod 를 지난다(lib/admin/galleryInput.ts).
 *   - 서비스 롤을 쓰지 않는다(ADR-2). 0009 의 gallery·gallery_albums 정책과 0011 의 storage 정책이 DB 에서 한 번 더 막는다.
 *   - 예외는 여기서 끝난다(단 requireAdmin() 의 redirect 는 throw 로 전파돼야 하므로 게이트는 try 밖이다).
 *   - 로그에 남기는 것은 id 와 결과 코드뿐이다. 경로·캡션은 싣지 않는다.
 */
import { revalidatePath } from "next/cache";

import {
  ADMIN_GALLERY_PATH,
  adminGalleryClient,
  deleteAlbumRow,
  deleteGalleryPhotoRow,
  getAdminPhoto,
  insertAlbum,
  insertGalleryPhoto,
  removePhotoObjects,
  setAlbumActive,
  setGalleryPhotoActive,
  updateAlbumRow,
  updateGalleryPhotoRow,
} from "@/lib/admin/gallery";
import {
  AlbumInput,
  AlbumPatchInput,
  GALLERY_FAILED,
  GALLERY_FILE_FAILED,
  GALLERY_NOT_FOUND,
  GALLERY_VALIDATION,
  GalleryIdInput,
  GalleryPatchInput,
  GalleryToggleInput,
  GalleryUploadInput,
  galleryChanged,
  type GalleryActionCode,
  type GalleryActionResult,
} from "@/lib/admin/galleryInput";
import { PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE } from "@/lib/admin/publicRevalidate";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { structuredLog, type StructuredLogEntry } from "@/lib/log";
import { runAfter } from "@/lib/ports/after";
import { revalidate } from "@/lib/ports/revalidate";
import { QUERY_TAGS } from "@/lib/queries/tags";

/** 이 파일이 남기는 로그의 전부. */
interface AdminGalleryLogEntry extends StructuredLogEntry {
  /** 사진 또는 앨범 id. 새로 만드는 중이면 null. */
  id: number | null;
  outcome: GalleryActionCode;
}

type GalleryAction = "record" | "update" | "toggle" | "delete" | "albumCreate" | "albumUpdate" | "albumToggle" | "albumDelete";

const EVENT: Record<GalleryAction, string> = {
  record: "admin.gallery.record",
  update: "admin.gallery.update",
  toggle: "admin.gallery.toggle",
  delete: "admin.gallery.delete",
  albumCreate: "admin.gallery.album.create",
  albumUpdate: "admin.gallery.album.update",
  albumToggle: "admin.gallery.album.toggle",
  albumDelete: "admin.gallery.album.delete",
};

function report(action: GalleryAction, id: number | null, result: GalleryActionResult): GalleryActionResult {
  const entry: AdminGalleryLogEntry = {
    level: result.ok ? "info" : "error",
    event: EVENT[action],
    id,
    outcome: result.code,
  };
  structuredLog(entry);
  return result;
}

/** 공개 화면을 실제로 새로 그리게 하는 것은 revalidatePath 한 줄뿐이다 — 근거·실측표는 lib/admin/publicRevalidate.ts. */
function invalidate(): void {
  runAfter(() => {
    revalidatePath(PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE);
    // 아래 태그는 지금 소비자가 없다(공개 읽기가 unstable_cache 로 감싸여 있지 않다). 누가 감싸는 날을 위한 배선이다.
    revalidate(QUERY_TAGS.gallery);
    revalidate(QUERY_TAGS.albums);
    revalidatePath(ADMIN_GALLERY_PATH);
  });
}

/** 쓰기 한 번 → 결과 매핑 → 바뀌었으면 무효화. 0행 = 정책에 막혔거나 그런 행이 없다. */
async function apply(
  action: GalleryAction,
  id: number | null,
  code: GalleryActionCode,
  write: () => Promise<boolean>,
): Promise<GalleryActionResult> {
  let changed: boolean;
  try {
    changed = await write();
  } catch {
    return report(action, id, GALLERY_FAILED);
  }
  if (!changed) return report(action, id, id === null ? GALLERY_FAILED : GALLERY_NOT_FOUND);
  invalidate();
  return report(action, id, galleryChanged(code));
}

// =============================================================================
// 사진
// =============================================================================

/**
 * 업로드 한 장을 기록한다. 브라우저가 원본과 공개본을 **이미 올린 뒤에** 부른다 —
 * zod 가 두 경로의 버킷·형식·uuid 짝까지 확인하므로, 지어낸 경로로 행만 만드는 요청은 DB 에 닿지 않는다.
 */
export async function recordGalleryUpload(input: unknown): Promise<GalleryActionResult> {
  await requireAdmin();
  const parsed = GalleryUploadInput.safeParse(input);
  if (!parsed.success) return report("record", null, GALLERY_VALIDATION);
  return apply("record", null, "recorded", () => insertGalleryPhoto(parsed.data));
}

/** 캡션·앨범·순서. 앨범 이동이 여기 있다 — 파일은 움직이지 않는다(P6-1 §7-2). */
export async function updateGalleryPhoto(input: unknown): Promise<GalleryActionResult> {
  await requireAdmin();
  const parsed = GalleryPatchInput.safeParse(input);
  if (!parsed.success) return report("update", null, GALLERY_VALIDATION);
  return apply("update", parsed.data.id, "updated", () => updateGalleryPhotoRow(parsed.data));
}

/** 목록에서 한 번에 내리고 올린다. 지우기 전에 먼저 쓰는 도구다(되돌릴 수 있다). */
export async function toggleGalleryPhotoActive(input: unknown): Promise<GalleryActionResult> {
  await requireAdmin();
  const parsed = GalleryToggleInput.safeParse(input);
  if (!parsed.success) return report("toggle", null, GALLERY_VALIDATION);
  const { id, active } = parsed.data;
  return apply("toggle", id, active ? "activated" : "deactivated", () => setGalleryPhotoActive(id, active));
}

/**
 * 사진 한 장을 지운다 — 행과 두 버킷의 파일 모두. 되돌릴 수 없다.
 * 순서는 위 헤더의 규약 그대로이고, **파일이 하나라도 안 지워지면 행을 남긴 채 fileFailed 로 끝난다.**
 * 그때 사진은 이미 노출이 꺼져 있으므로 방문자는 아무것도 보지 못하고, 사장님은 같은 버튼을 다시 누르면 된다.
 */
export async function deleteGalleryPhoto(input: unknown): Promise<GalleryActionResult> {
  await requireAdmin();
  const parsed = GalleryIdInput.safeParse(input);
  if (!parsed.success) return report("delete", null, GALLERY_VALIDATION);
  const { id } = parsed.data;

  let hidden = false;
  try {
    const db = await adminGalleryClient();
    const row = await getAdminPhoto(id, db);
    if (!row) return report("delete", id, GALLERY_NOT_FOUND);

    // 1) 공개 화면에서 먼저 내린다 — 파일이 사라진 뒤 행이 남는 순간에도 깨진 이미지가 뜨지 않는다
    if (!(await setGalleryPhotoActive(id, false, db))) return report("delete", id, GALLERY_NOT_FOUND);
    hidden = true;

    // 2) 파일 (원본 → 공개본). 실패하면 여기서 끝 — 행은 남는다
    if (!(await removePhotoObjects(row, db))) {
      invalidate();
      return report("delete", id, GALLERY_FILE_FAILED);
    }

    // 3) 행
    if (!(await deleteGalleryPhotoRow(id, db))) {
      invalidate();
      return report("delete", id, GALLERY_NOT_FOUND);
    }
  } catch {
    if (hidden) invalidate();
    return report("delete", id, GALLERY_FAILED);
  }

  invalidate();
  return report("delete", id, galleryChanged("deleted"));
}

// =============================================================================
// 앨범 — 사진을 담는 그릇. 지워도 사진은 미분류로 남는다(0008 on delete set null)
// =============================================================================

export async function createGalleryAlbum(input: unknown): Promise<GalleryActionResult> {
  await requireAdmin();
  const parsed = AlbumInput.safeParse(input);
  if (!parsed.success) return report("albumCreate", null, GALLERY_VALIDATION);
  return apply("albumCreate", null, "albumCreated", () => insertAlbum(parsed.data));
}

export async function updateGalleryAlbum(input: unknown): Promise<GalleryActionResult> {
  await requireAdmin();
  const parsed = AlbumPatchInput.safeParse(input);
  if (!parsed.success) return report("albumUpdate", null, GALLERY_VALIDATION);
  const { id, ...values } = parsed.data;
  return apply("albumUpdate", id, "albumUpdated", () => updateAlbumRow(id, values));
}

export async function toggleGalleryAlbumActive(input: unknown): Promise<GalleryActionResult> {
  await requireAdmin();
  const parsed = GalleryToggleInput.safeParse(input);
  if (!parsed.success) return report("albumToggle", null, GALLERY_VALIDATION);
  const { id, active } = parsed.data;
  return apply("albumToggle", id, active ? "albumActivated" : "albumDeactivated", () => setAlbumActive(id, active));
}

/** 앨범만 지운다. 그 안의 사진은 지워지지 않고 미분류로 남는다 — 화면이 먼저 알려 준다. */
export async function deleteGalleryAlbum(input: unknown): Promise<GalleryActionResult> {
  await requireAdmin();
  const parsed = GalleryIdInput.safeParse(input);
  if (!parsed.success) return report("albumDelete", null, GALLERY_VALIDATION);
  return apply("albumDelete", parsed.data.id, "albumDeleted", () => deleteAlbumRow(parsed.data.id));
}
