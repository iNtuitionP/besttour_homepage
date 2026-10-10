/**
 * 사진 한 장 준비 + 브라우저 스토리지 포트 — **브라우저 전용** (T3-2, GalleryUploader 에서 옮겼다).
 *
 * 갤러리 업로더와 팝업 사진 올리기(T3-3)가 같은 규칙을 쓴다. 규칙이 두 벌이 되지 않게 여기 한 곳에만 둔다.
 *   1. 디코드  `createImageBitmap(file)`  ← HEIC 는 여기서 걸린다(크롬 계열은 HEIC 를 그리지 못한다 — GalleryUploader 헤더의 실측)
 *   2. 축소·인코딩  canvas → 긴 변 1600px WebP
 *   3. **타입 확인** — WebP 를 못 만드는 브라우저는 조용히 PNG 를 돌려준다(.webp 이름의 PNG 를 저장하지 않는다)
 * 실패는 던지지 않고 이유로 돌려준다 — 한 장의 실패가 나머지를 멈추지 않는다.
 *
 * 스토리지 포트는 **upsert:false 고정**이다 — 키에 uuid 가 있어 겹칠 일이 없고, 겹쳤다면 그것은 사고다(덮어쓰지 말고 알려야 한다).
 * 업로드를 허용하는 것은 0011 의 storage.objects 정책(is_admin())이다. 서비스 롤을 쓰지 않는다(ADR-2).
 */
import { GALLERY_PUBLIC_LONG_EDGE, fileExtension, fitLongEdge, isHeicExtension, type GalleryExtension } from "./galleryInput";
import type { GalleryStoragePort } from "./galleryUpload";

/** 공개본 WebP 품질. 0.82 는 1600px 사진에서 눈에 띄는 손실 없이 원본의 5~8% 크기가 되는 지점이다. */
export const WEBP_QUALITY = 0.82;
/** 공개본은 내용이 바뀌지 않는다(키에 uuid 가 있다) — 1년 캐시. */
export const PUBLIC_CACHE_CONTROL = "31536000";
/** 파일 칸이 받는 형식 — 갤러리·팝업 공용(서버·흐름의 형식 검사는 galleryInput 이 따로 한다) */
export const GALLERY_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";

export type PrepareFailure = "type" | "decode" | "heic" | "encode";

export type PreparedImage =
  | { ok: true; ext: GalleryExtension; webp: Blob; width: number; height: number }
  | { ok: false; reason: PrepareFailure };

export async function prepareImage(file: File): Promise<PreparedImage> {
  const ext = fileExtension(file.name);
  if (ext === null) return { ok: false, reason: "type" };

  // 1. 디코드
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, reason: isHeicExtension(ext) ? "heic" : "decode" };
  }

  // 2. 축소 → WebP
  const size = fitLongEdge(bitmap.width, bitmap.height, GALLERY_PUBLIC_LONG_EDGE);
  let webp: Blob | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);
      webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY));
    }
  } finally {
    bitmap.close();
  }
  // 3. 타입까지 확인
  if (!webp || webp.type !== "image/webp") return { ok: false, reason: "encode" };
  return { ok: true, ext, webp, width: size.width, height: size.height };
}

/** 브라우저 Supabase 클라이언트 중 스토리지 부분만 — 테스트가 가짜로 갈아 끼운다. */
export interface BrowserStorageClient {
  storage: {
    from(bucket: string): {
      upload(key: string, body: Blob, options: { contentType?: string; cacheControl?: string; upsert?: boolean }): Promise<{ error: unknown }>;
      remove(keys: string[]): Promise<unknown>;
    };
  };
}

/**
 * 브라우저 스토리지 클라이언트 → `commitUpload` 이 쓰는 포트. 이 어댑터가 얇을수록 되돌리기 규칙(순수 모듈)이 테스트로 덮인다.
 */
export function storagePort(client: BrowserStorageClient): GalleryStoragePort {
  return {
    async upload(bucket, key, body, options) {
      const { error } = await client.storage.from(bucket).upload(key, body as Blob, { ...options, upsert: false });
      return { error };
    },
    async remove(bucket, key) {
      await client.storage.from(bucket).remove([key]);
    },
  };
}
