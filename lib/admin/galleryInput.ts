/**
 * 갤러리 입력 검증 · 경로 규약 · 결과 타입 — 순수 모듈 (플랜 v4 P6-2 · ADR-4 · 스펙 §13.9).
 *
 * Next 도 Supabase 도 모른다. 서버액션(actions/admin/gallery.ts)과 **브라우저 업로더**
 * (components/admin/GalleryUploader.tsx)가 같은 규칙을 쓰기 위해 여기 한 곳에만 적는다 —
 * 업로더가 만든 경로와 액션이 검증하는 경로가 어긋나면 파일과 행이 따로 노는 사고가 난다.
 *
 * 규칙 다섯:
 *   1. **경로에 앨범이 없다**(P6-1 §7-2). 사진은 앨범 사이를 옮겨 다니고, 경로에 앨범이 들어가면 이동할 때마다
 *      객체를 복사·삭제해야 한다. 소속은 `album_id` 컬럼 하나에만 산다 — 이동은 UPDATE 한 줄이다.
 *   2. **원본과 변환본은 같은 uuid·같은 yyyy/mm 을 쓴다.** 그 한 쌍이 두 객체를 묶는 유일한 키이고,
 *      행을 지울 때 이 키로 두 파일을 함께 지운다. 액션의 zod 가 짝이 맞는지 다시 확인한다.
 *   3. **연·월은 KST 달력**이다(CLAUDE.md §3). UTC 로 자르면 KST 00:00~08:59 에 전달 폴더로 밀린다.
 *   4. **판정은 확장자로 한다.** 실측(2026-09-15, HeadlessChrome/145 · Windows): `.heic` 파일의 `File.type` 이
 *      **빈 문자열**이었다. MIME 으로 거르면 아이폰 사진이 통째로 사라진다. 확장자 화이트리스트가 1차 방어선이고,
 *      실제 내용 판정은 브라우저의 디코드 시도(createImageBitmap)가 한다 — 그리지 못하는 파일은 올라가지 않는다.
 *   5. **결과에 개인정보가 없다.** 갤러리는 콘텐츠 표라 애초에 없지만, 결과 객체는 브라우저까지 나가는 값이므로
 *      화면이 쓸 최소(ok·changed·code)만 담는다. 문구는 messages/ko.json `admin.gallery.*` 몫이다.
 *
 * 사용자에게 보일 문구는 여기 없다(한글 리터럴 0). zod 메시지는 개발자용이라 ASCII 로 적는다.
 */
import { z } from "zod";

import { toKstDateString } from "../kst";

// =============================================================================
// 버킷·상한 (스펙 §13.9 (4) · 컨트롤러가 만든 버킷 두 개)
// =============================================================================

/** 공개 버킷 — 변환본(1600px WebP)만. image_path 의 첫 세그먼트다. */
export const GALLERY_BUCKET = "gallery";
/** 비공개 버킷 — 폰 원본만. original_path 의 첫 세그먼트이고, 절대 resolveImageUrl 에 넘기지 않는다. */
export const GALLERY_ORIGINALS_BUCKET = "gallery-originals";

/** 1회 업로드 장수 상한(스펙 §13.9 (4)). 넘는 파일은 거부하고 앞의 30장은 그대로 올린다. */
export const GALLERY_MAX_FILES = 30;
/** 장당 상한 20MB — 폰 원본 그대로 허용(스펙 §13.9 (4)). */
export const GALLERY_MAX_BYTES = 20 * 1024 * 1024;
/** 공개 변환본의 긴 변. 더 작은 크기는 만들지 않는다 — 렌더 계층이 변환 파라미터로 정한다(P6-1 결정). */
export const GALLERY_PUBLIC_LONG_EDGE = 1600;
/** 공개 변환본 파일명 접미사 — `<uuid>-1600.webp`. */
export const GALLERY_PUBLIC_SUFFIX = `-${GALLERY_PUBLIC_LONG_EDGE}`;
/** 공개 변환본 확장자. HEIC 원본이어도 공개본은 **반드시** WebP 다(브라우저가 heic 를 그리지 못한다). */
export const GALLERY_PUBLIC_EXTENSION = "webp";

/**
 * 허용 확장자 — 스펙 §13.9 (4)의 5종(jpg·jpeg·png·heic·webp) + `heif`.
 * heif 를 더한 이유: 컨트롤러가 만든 두 버킷의 허용 MIME 에 image/heif 가 들어 있고, 아이폰이 설정에 따라
 * `.heif` 로 저장하는 경우가 있다. 형식은 heic 와 같은 컨테이너라 취급도 같다(=디코드 못 하면 거부).
 */
export const GALLERY_ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif"] as const;
export type GalleryExtension = (typeof GALLERY_ALLOWED_EXTENSIONS)[number];

/** 브라우저가 그리지 못하는(=변환할 수 없는) 컨테이너. 업로더가 이 확장자에만 아이폰 설정 안내를 붙인다. */
export const GALLERY_HEIC_EXTENSIONS = ["heic", "heif"] as const;

/** 캡션 — 목록 한 줄. 화면이 무너지지 않는 선. */
export const GALLERY_CAPTION_MAX = 200;
/** 정렬 값 — 작은 번호가 앞. */
export const GALLERY_SORT_MAX = 9999;
/** 앨범 제목 상한(화면 표시명). slug 는 0008 의 CHECK 와 같은 40자다. */
export const ALBUM_TITLE_MAX = 40;
export const ALBUM_SLUG_MAX = 40;

/**
 * 앨범 slug 규칙 — 0008 `gallery_albums_slug_ck` 및 공개 읽기(lib/queries/albums.ts `ALBUM_SLUG_PATTERN`)와
 * **같은 판정**이어야 한다. 그 모듈을 import 하지 않는 이유는 하나뿐이다: 그쪽은 `@supabase/supabase-js` 를 끌고 오고,
 * 이 모듈은 클라이언트 컴포넌트가 import 하는 순수 모듈이어야 한다(lib/admin/noticeInput.ts 의 parseAdminNoticeId 와 같은 사정).
 * tests/admin-gallery.test.ts 가 두 정규식의 답을 표로 대조해 어긋남을 막는다.
 */
export const ALBUM_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const EXTENSION_SET: ReadonlySet<string> = new Set(GALLERY_ALLOWED_EXTENSIONS);
const HEIC_SET: ReadonlySet<string> = new Set(GALLERY_HEIC_EXTENSIONS);

/** uuid v4 (crypto.randomUUID 의 출력). 경로 조작(`../`)이 uuid 자리에 들어오지 못한다. */
export const GALLERY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// =============================================================================
// 파일 선택 검증 (브라우저) — 순수 함수라 브라우저 없이 테스트된다
// =============================================================================

/** 파일 이름의 확장자(소문자). 화이트리스트 밖이거나 확장자가 없으면 null. */
export function fileExtension(name: string): GalleryExtension | null {
  if (typeof name !== "string") return null;
  const dot = name.lastIndexOf(".");
  // dot === 0 은 `.jpg` 같은 숨김 파일 — 이름이 없다
  if (dot <= 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return EXTENSION_SET.has(ext) ? (ext as GalleryExtension) : null;
}

/** 브라우저가 그리지 못하는 컨테이너인가. */
export function isHeicExtension(ext: string): boolean {
  return HEIC_SET.has(ext.toLowerCase());
}

/**
 * 확장자 → Content-Type. **File.type 을 쓰지 않는 이유**: 실측(2026-09-15, HeadlessChrome/145 · Windows)에서
 * `.heic` 의 File.type 이 빈 문자열이었다. 그대로 올리면 버킷의 allowed_mime_types 에 걸려 400 이 난다 —
 * 무엇을 올리는지는 우리가 확장자로 이미 알고 있으므로 브라우저의 추측에 기대지 않는다.
 */
const MIME_BY_EXTENSION: Readonly<Record<GalleryExtension, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

export function contentTypeFor(ext: GalleryExtension): string {
  return MIME_BY_EXTENSION[ext];
}

/**
 * 거부 사유 — 화면 문구는 messages/ko.json `admin.gallery.reject.*`.
 * `needsCheck` 는 "실패했는지도 확실하지 않다"다 — 행이 만들어졌는지 알 수 없어 파일을 남겨 둔 경우(lib/admin/galleryUpload.ts).
 */
export type GalleryRejectReason = "count" | "size" | "type" | "empty" | "decode" | "encode" | "upload" | "record" | "needsCheck";

export interface GalleryFileMeta {
  name: string;
  size: number;
}

export interface GallerySelection<T extends GalleryFileMeta = GalleryFileMeta> {
  accepted: T[];
  rejected: { name: string; reason: GalleryRejectReason }[];
}

/**
 * 고른 파일들을 상한·형식으로 가른다. **거부는 장별이다** — 한 장이 걸렸다고 나머지를 버리지 않는다.
 * 30장 상한은 "앞에서부터 30장"이다(브라우저의 FileList 순서 = 사장님이 고른 순서).
 * 제네릭인 이유: 업로더는 `File` 을 그대로 돌려받아야 한다(이름으로 다시 찾으면 같은 이름의 두 장이 섞인다).
 */
export function selectGalleryFiles<T extends GalleryFileMeta>(files: readonly T[]): GallerySelection<T> {
  const accepted: T[] = [];
  const rejected: { name: string; reason: GalleryRejectReason }[] = [];
  for (const file of files) {
    if (accepted.length >= GALLERY_MAX_FILES) {
      rejected.push({ name: file.name, reason: "count" });
      continue;
    }
    if (fileExtension(file.name) === null) {
      rejected.push({ name: file.name, reason: "type" });
      continue;
    }
    if (file.size <= 0) {
      rejected.push({ name: file.name, reason: "empty" });
      continue;
    }
    if (file.size > GALLERY_MAX_BYTES) {
      rejected.push({ name: file.name, reason: "size" });
      continue;
    }
    accepted.push(file);
  }
  return { accepted, rejected };
}

/** 긴 변을 max 로 맞춘 크기. 원본이 더 작으면 그대로 둔다(키우면 화질만 잃는다). 최소 1px. */
export function fitLongEdge(width: number, height: number, max: number = GALLERY_PUBLIC_LONG_EDGE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (!Number.isFinite(long) || long <= 0) return { width: 1, height: 1 };
  if (long <= max) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const scale = max / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// =============================================================================
// 경로 규약 (P6-1 §7-2)
// =============================================================================

export interface UploadPaths {
  /** KST 연도 4자리. */
  yyyy: string;
  /** KST 월 2자리. */
  mm: string;
  uuid: string;
  ext: GalleryExtension;
  originalBucket: string;
  /** 버킷을 뺀 키 — storage 클라이언트에 넘기는 값. */
  originalKey: string;
  /** `버킷/키` — DB 의 original_path 에 들어가는 값. */
  originalPath: string;
  publicBucket: string;
  publicKey: string;
  /** `버킷/키` — DB 의 image_path 에 들어가는 값(resolveImageUrl 이 이해하는 형태). */
  imagePath: string;
}

/**
 * uuid 하나로 원본·공개본 두 경로를 만든다. **앨범을 받지 않는다**(규칙 1).
 * 잘못된 uuid·확장자는 예외다 — 조용히 이상한 경로를 만들면 그 파일은 아무도 못 찾는다.
 */
export function buildUploadPaths(uuid: string, ext: string, at: Date): UploadPaths {
  if (!GALLERY_UUID_RE.test(uuid)) throw new Error("buildUploadPaths: uuid must be a v4 uuid");
  const lower = typeof ext === "string" ? ext.toLowerCase() : "";
  if (!EXTENSION_SET.has(lower)) throw new Error("buildUploadPaths: extension not allowed");
  // KST 달력 날짜 — 서버 프로세스·브라우저의 TZ 와 무관하게 고정 +09:00 (lib/kst.ts)
  const [yyyy, mm] = toKstDateString(at).split("-");
  const originalKey = `${yyyy}/${mm}/${uuid}.${lower}`;
  const publicKey = `${yyyy}/${mm}/${uuid}${GALLERY_PUBLIC_SUFFIX}.${GALLERY_PUBLIC_EXTENSION}`;
  return {
    yyyy,
    mm,
    uuid,
    ext: lower as GalleryExtension,
    originalBucket: GALLERY_ORIGINALS_BUCKET,
    originalKey,
    originalPath: `${GALLERY_ORIGINALS_BUCKET}/${originalKey}`,
    publicBucket: GALLERY_BUCKET,
    publicKey,
    imagePath: `${GALLERY_BUCKET}/${publicKey}`,
  };
}

const MONTH_RE = /^(0[1-9]|1[0-2])$/;

/**
 * 저장된 `버킷/키` 경로를 해석한다. **우리 두 버킷의 규약 경로만** 통과한다 — 그 밖(옛 시드 행의 로컬 경로,
 * 절대 URL, 다른 버킷)은 null 이고, 삭제는 null 인 경로를 건드리지 않는다. 지우려 드는 대상이 확실할 때만 지운다.
 */
export function parseStoragePath(fullPath: string | null | undefined): { bucket: string; key: string } | null {
  if (typeof fullPath !== "string" || fullPath === "") return null;
  const parts = fullPath.split("/");
  if (parts.length !== 4) return null;
  const [bucket, yyyy, mm, file] = parts;
  if (bucket !== GALLERY_BUCKET && bucket !== GALLERY_ORIGINALS_BUCKET) return null;
  if (!/^\d{4}$/.test(yyyy) || !MONTH_RE.test(mm)) return null;
  const dot = file.lastIndexOf(".");
  if (dot <= 0) return null;
  const stem = file.slice(0, dot);
  const ext = file.slice(dot + 1).toLowerCase();
  if (!EXTENSION_SET.has(ext)) return null;
  const uuid = stem.endsWith(GALLERY_PUBLIC_SUFFIX) ? stem.slice(0, -GALLERY_PUBLIC_SUFFIX.length) : stem;
  if (!GALLERY_UUID_RE.test(uuid)) return null;
  return { bucket, key: `${yyyy}/${mm}/${file}` };
}

/** 경로에서 uuid·연월만 뽑는다(짝 검증용). 규약 밖이면 null. */
function pathIdentity(fullPath: string): { uuid: string; yyyymm: string; ext: string; suffixed: boolean } | null {
  const parsed = parseStoragePath(fullPath);
  if (!parsed) return null;
  const [yyyy, mm, file] = parsed.key.split("/");
  const dot = file.lastIndexOf(".");
  const stem = file.slice(0, dot);
  const suffixed = stem.endsWith(GALLERY_PUBLIC_SUFFIX);
  return {
    uuid: suffixed ? stem.slice(0, -GALLERY_PUBLIC_SUFFIX.length) : stem,
    yyyymm: `${yyyy}/${mm}`,
    ext: file.slice(dot + 1).toLowerCase(),
    suffixed,
  };
}

// =============================================================================
// 업로드 기록 입력 (서버액션 zod)
// =============================================================================

const positiveInt = z.number().int().positive();

export const GalleryUploadInput = z
  .object({
    imagePath: z.string(),
    originalPath: z.string(),
    width: positiveInt,
    height: positiveInt,
    /** 원본 파일 크기(P6-1 §7-1). 업로드 상한과 같은 값이라 두 번 재지 않는다. */
    bytes: positiveInt.max(GALLERY_MAX_BYTES),
    albumId: positiveInt.nullable(),
    caption: z.string().trim().max(GALLERY_CAPTION_MAX).nullable(),
    sort: z.number().int().min(0).max(GALLERY_SORT_MAX),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const pub = pathIdentity(v.imagePath);
    const orig = pathIdentity(v.originalPath);
    if (!pub || !v.imagePath.startsWith(`${GALLERY_BUCKET}/`) || !pub.suffixed || pub.ext !== GALLERY_PUBLIC_EXTENSION) {
      ctx.addIssue({ code: "custom", path: ["imagePath"], message: "imagePath must be gallery/yyyy/mm/<uuid>-1600.webp" });
    }
    if (!orig || !v.originalPath.startsWith(`${GALLERY_ORIGINALS_BUCKET}/`) || orig.suffixed) {
      ctx.addIssue({ code: "custom", path: ["originalPath"], message: "originalPath must be gallery-originals/yyyy/mm/<uuid>.<ext>" });
    }
    if (pub && orig && (pub.uuid !== orig.uuid || pub.yyyymm !== orig.yyyymm)) {
      // 짝이 어긋나면 행 하나가 두 사진을 가리키게 되고, 삭제가 남의 파일을 지운다
      ctx.addIssue({ code: "custom", path: ["originalPath"], message: "original and public objects must share uuid and yyyy/mm" });
    }
  });

export type GalleryUploadValues = z.infer<typeof GalleryUploadInput>;

/** 사진 메타 수정(캡션·앨범·순서). 파일은 건드리지 않는다 — 앨범 이동이 UPDATE 한 줄인 이유. */
export const GalleryPatchInput = z.object({
  id: positiveInt,
  caption: z.string().trim().max(GALLERY_CAPTION_MAX).nullable(),
  albumId: positiveInt.nullable(),
  sort: z.number().int().min(0).max(GALLERY_SORT_MAX),
});
export type GalleryPatchValues = z.infer<typeof GalleryPatchInput>;

/** 노출 토글 — id 와 상태만. */
export const GalleryToggleInput = z.object({ id: positiveInt, active: z.boolean() });
/** 삭제 — id 만. */
export const GalleryIdInput = z.object({ id: positiveInt });

/** 앨범 만들기·고치기. slug 는 0008 CHECK 와 같은 규칙(위 ALBUM_SLUG_RE). */
export const AlbumInput = z.object({
  title: z.string().trim().min(1).max(ALBUM_TITLE_MAX),
  slug: z.string().trim().min(1).max(ALBUM_SLUG_MAX).regex(ALBUM_SLUG_RE),
  sort: z.number().int().min(0).max(GALLERY_SORT_MAX),
  active: z.boolean(),
});
export type AlbumValues = z.infer<typeof AlbumInput>;
export const AlbumPatchInput = AlbumInput.extend({ id: positiveInt });

// =============================================================================
// 사용량 (스펙 §13.9 (5)) — DB 에 있는 값의 합이지 지어낸 수치가 아니다
// =============================================================================

export interface GalleryUsage {
  photos: number;
  bytes: number;
}

/** 행들의 장수·바이트 합. bytes 가 null 인 옛 행도 **장수에는 든다**(용량만 모르는 것이다). */
export function usageOf(rows: readonly { bytes: number | null }[]): GalleryUsage {
  let bytes = 0;
  for (const r of rows) bytes += typeof r.bytes === "number" && Number.isFinite(r.bytes) ? r.bytes : 0;
  return { photos: rows.length, bytes };
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** 사람이 읽는 크기. 1GB 미만은 MB 소수 첫째 자리, 그 이상은 GB 소수 둘째 자리. 단위는 ASCII 라 문구가 아니다. */
export function formatUsageSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0MB";
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)}GB`;
  return `${(bytes / MB).toFixed(1)}MB`;
}

// =============================================================================
// 결과 어휘 — 화면 문구는 messages/ko.json `admin.gallery.result.*`
// =============================================================================

export type GalleryActionCode =
  | "recorded"
  | "updated"
  | "deleted"
  | "activated"
  | "deactivated"
  | "albumCreated"
  | "albumUpdated"
  | "albumActivated"
  | "albumDeactivated"
  | "albumDeleted"
  | "notFound"
  | "validation"
  | "failed"
  /** 파일을 못 지웠다 → **행을 남겼다**. 사장님이 다시 시도하면 된다(스토리지 삭제는 재시도해도 안전하다). */
  | "fileFailed";

export interface GalleryActionResult {
  /** 사장님에게 빨간 오류를 보일 것인가. */
  ok: boolean;
  /** DB 가 실제로 바뀌었는가. 캐시 무효화는 이것이 true 일 때만. */
  changed: boolean;
  code: GalleryActionCode;
}

export const GALLERY_FAILED: GalleryActionResult = { ok: false, changed: false, code: "failed" };
export const GALLERY_NOT_FOUND: GalleryActionResult = { ok: false, changed: false, code: "notFound" };
export const GALLERY_VALIDATION: GalleryActionResult = { ok: false, changed: false, code: "validation" };
/** 파일 삭제 실패 — 행은 그대로다. "지웠다"고 말하지 않는다. */
export const GALLERY_FILE_FAILED: GalleryActionResult = { ok: false, changed: false, code: "fileFailed" };

/** 성공 결과 — changed 는 언제나 true 다(바뀐 것이 없으면 notFound 로 끝난다). */
export const galleryChanged = (code: GalleryActionCode): GalleryActionResult => ({ ok: true, changed: true, code });
