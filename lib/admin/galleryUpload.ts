/**
 * 한 장의 업로드 커밋 — 파일 두 개를 올리고 행 하나를 만든다 (P6-2 · 독립 리뷰 F1·M2).
 *
 * 브라우저 API(canvas·File)를 모르는 순수 모듈이다. 업로더(components/admin/GalleryUploader.tsx)가
 * 디코드·축소까지 끝낸 뒤 이 함수에 넘기고, 여기서부터는 **되돌리기 규칙**만 판단한다.
 * 포트를 주입받는 이유는 하나다: 서버액션이 **거부하거나 던지는** 경우를 테스트가 실제로 관찰할 수 있어야 한다
 * (리뷰 F1 — 소스 정규식 테스트는 "그렇게 적혀 있다"만 증명한다).
 *
 * 되돌리기 규칙 — 여기가 이 파일의 전부다.
 *   · 원본 업로드 실패        → 올린 것이 없다. 되돌릴 것도 없다.
 *   · 공개본 업로드 실패      → 원본만 올라갔다. 원본을 지운다(행이 없으므로 그 파일은 아무도 못 찾는다).
 *   · 기록이 **거부**됐다     → `validation`·`notFound` 는 **행이 만들어지지 않았음을 증명한다**(zod 는 DB 를 부르기 전이고,
 *                              notFound 는 0행이다). 두 파일을 지운다.
 *   · 기록이 **불확실하다**   → 그 밖의 결과(`failed`)와 **예외**(연결 끊김·타임아웃·세션 만료·배포로 액션 id 변경)는
 *                              행이 만들어졌는지 알 수 없다. **파일을 지우지 않는다** — 지웠는데 행이 살아 있으면
 *                              active=true 인 행이 없는 파일을 가리키게 되고(가장 나쁜 상태), 반대로 파일만 남으면
 *                              눈에 안 보이는 용량일 뿐이다. 사장님께는 "확인 필요"로 알린다(리뷰 M2).
 *
 * 예외는 여기서 끝난다 — 던지지 않는다. 한 장의 실패가 나머지 29장의 업로드를 멈추면 안 되고,
 * 호출부의 `finally` 밖으로 튀어 화면을 잠그면 더 안 된다(리뷰 F1).
 */
import { GALLERY_PUBLIC_EXTENSION, type GalleryRejectReason, type GalleryUploadValues, type UploadPaths } from "./galleryInput";

/** 업로드·삭제 포트. 실제 구현은 브라우저의 supabase 스토리지 클라이언트다. */
export interface GalleryStoragePort {
  /** 성공이면 error 가 falsy. 던져도 된다 — 호출부가 잡는다. */
  upload(bucket: string, key: string, body: unknown, options: { contentType: string; cacheControl?: string }): Promise<{ error: unknown }>;
  /** 되돌리기. **던지지 않는 것이 계약**이지만, 던져도 커밋 결과를 바꾸지 않는다. */
  remove(bucket: string, key: string): Promise<void>;
}

/** 서버액션 포트 — actions/admin/gallery.ts recordGalleryUpload. */
export type GalleryRecordPort = (input: GalleryUploadValues) => Promise<{ ok: boolean; code: string }>;

export type UploadFailure = Extract<GalleryRejectReason, "upload" | "record" | "needsCheck">;

export type UploadOutcome = { kind: "done" } | { kind: "failed"; reason: UploadFailure };

/** 행이 만들어지지 않았음이 **증명되는** 결과 코드. 이때만 되돌린다. */
const PROVEN_NOT_WRITTEN: ReadonlySet<string> = new Set(["validation", "notFound"]);

export interface CommitUploadArgs {
  paths: UploadPaths;
  /** 원본 파일 본문(Blob/File). */
  original: unknown;
  /** 공개본 본문(WebP Blob). */
  publicBody: unknown;
  /** 원본의 Content-Type — 확장자에서 만든 값(File.type 이 비어 오는 경우가 있다). */
  originalContentType: string;
  /** 공개본은 키에 uuid 가 있어 내용이 바뀌지 않는다 → 길게 캐시한다. */
  publicCacheControl: string;
  /** 행에 들어갈 값 중 경로가 아닌 것들. */
  meta: Omit<GalleryUploadValues, "imagePath" | "originalPath">;
  storage: GalleryStoragePort;
  record: GalleryRecordPort;
}

async function discard(storage: GalleryStoragePort, bucket: string, key: string): Promise<void> {
  try {
    await storage.remove(bucket, key);
  } catch {
    // 되돌리기 실패는 업로드 실패보다 덜 중요하다 — 고아 파일은 화면을 깨지 않는다. 사장님에게 두 번 알리지 않는다.
  }
}

export async function commitUpload(args: CommitUploadArgs): Promise<UploadOutcome> {
  const { paths, storage, record } = args;

  // 1) 원본 — 아직 아무것도 올라가지 않았으므로 실패해도 되돌릴 것이 없다
  try {
    const first = await storage.upload(paths.originalBucket, paths.originalKey, args.original, {
      contentType: args.originalContentType,
    });
    if (first.error) return { kind: "failed", reason: "upload" };
  } catch {
    return { kind: "failed", reason: "upload" };
  }

  // 2) 공개본 — 실패하면 원본만 남는다. 행이 없으니 그 파일은 아무도 못 찾는다 → 지운다
  try {
    const second = await storage.upload(paths.publicBucket, paths.publicKey, args.publicBody, {
      contentType: `image/${GALLERY_PUBLIC_EXTENSION}`,
      cacheControl: args.publicCacheControl,
    });
    if (second.error) {
      await discard(storage, paths.originalBucket, paths.originalKey);
      return { kind: "failed", reason: "upload" };
    }
  } catch {
    await discard(storage, paths.originalBucket, paths.originalKey);
    return { kind: "failed", reason: "upload" };
  }

  // 3) 행 — 여기서부터는 "썼는지 모른다"가 가능하다
  let result: { ok: boolean; code: string };
  try {
    result = await record({ ...args.meta, imagePath: paths.imagePath, originalPath: paths.originalPath });
  } catch {
    // 응답을 받지 못했다. 행이 있는지 없는지 모른다 → **지우지 않는다**(리뷰 M2)
    return { kind: "failed", reason: "needsCheck" };
  }

  if (result.ok) return { kind: "done" };

  if (PROVEN_NOT_WRITTEN.has(result.code)) {
    await discard(storage, paths.publicBucket, paths.publicKey);
    await discard(storage, paths.originalBucket, paths.originalKey);
    return { kind: "failed", reason: "record" };
  }

  // `failed` 등 — 서버가 쓰기 도중 예외를 삼킨 결과다. 커밋 뒤에 터졌을 가능성을 배제할 수 없다 → 파일을 남긴다
  return { kind: "failed", reason: "needsCheck" };
}
