"use client";
/**
 * 갤러리 업로더 — **브라우저가 Storage 로 직접 올린다** (P6-2 · ADR-9 · 스펙 §13.9 (4)).
 *
 * 왜 서버를 거치지 않나: 폰 원본은 3~5MB, 상한이 20MB 이고 한 번에 30장이다. Server Action 본문은 기본 1MB,
 * Vercel 요청은 4.5MB 에서 잘린다 — 서버로 보내는 순간 이 기능은 성립하지 않는다. 그래서 파일은 관리자 자신의
 * 세션(anon 키 + 쿠키 JWT)으로 Storage 에 바로 올라가고, 서버액션에는 **경로·크기 숫자만** 간다.
 * 그 업로드를 허용하는 것은 0011 의 `storage.objects` 정책(`is_admin()`)이다. signed URL 을 쓰지 않는 이유는
 * signed URL 생성이 서비스 롤을 요구하고 ADR-2 가 그것을 금지하기 때문이다(0011 헤더).
 *
 * 한 장의 처리 순서 — **어느 단계에서 실패해도 그 장만 실패하고 나머지는 계속 올라간다**:
 *   1. 디코드  `createImageBitmap(file)`  ← HEIC 는 여기서 걸린다(아래)
 *   2. 축소·인코딩  canvas → 긴 변 1600px WebP  (더 작은 크기는 만들지 않는다 — 렌더 계층이 변환 파라미터로 정한다)
 *   3. 원본 업로드 → gallery-originals/yyyy/mm/<uuid>.<ext>
 *   4. 공개본 업로드 → gallery/yyyy/mm/<uuid>-1600.webp
 *   5. 행 기록  recordGalleryUpload(경로·크기)
 *   3~5 의 되돌리기 규칙은 lib/admin/galleryUpload.ts `commitUpload` 에 있다 — **행이 만들어지지 않았음이 증명될 때만**
 *   파일을 지우고, 응답을 못 받았거나 결과가 불확실하면 파일을 남긴 채 "확인 필요"로 알린다(독립 리뷰 F1·M2).
 *   한 장의 어떤 실패도 루프를 멈추지 못하고(try/catch), 무슨 일이 있어도 마지막에 잠금이 풀린다(finally).
 *
 * **HEIC (실측, 2026-09-15)**: HeadlessChrome/145 · Windows 에서 실제 .heic 3종을 시험한 결과
 *   `ImageDecoder.isTypeSupported('image/heic')` → false, `createImageBitmap` → InvalidStateError,
 *   `<img>` → error 이벤트. 즉 크롬 계열은 HEIC 를 **그리지 못한다**. 서버 변환도 불가능하다(sharp 미설치,
 *   Vercel 기본 빌드에 libheif 없음 — ADR-9). 그래서 디코드 실패를 감추지 않고 **거부하고 무엇을 하면 되는지 알려 준다**
 *   (messages/ko.json admin.gallery.heicHelp — 아이폰 설정 → 카메라 → 포맷 → 높은 호환성).
 *   같은 시험에서 PNG 는 정상 디코드되고 canvas → image/webp 인코딩도 성공했다(대조군).
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { recordGalleryUpload } from "@/actions/admin/gallery";
import {
  GALLERY_MAX_FILES,
  GALLERY_PUBLIC_LONG_EDGE,
  buildUploadPaths,
  contentTypeFor,
  fileExtension,
  fitLongEdge,
  isHeicExtension,
  selectGalleryFiles,
  type GalleryActionCode,
  type GalleryRejectReason,
} from "@/lib/admin/galleryInput";
import { commitUpload, type GalleryStoragePort } from "@/lib/admin/galleryUpload";
import { createBrowserSupabase } from "@/lib/supabase/client";

import s from "./admin.module.css";

/** 공개본 WebP 품질. 0.82 는 1600px 사진에서 눈에 띄는 손실 없이 원본의 5~8% 크기가 되는 지점이다. */
const WEBP_QUALITY = 0.82;
/** 공개본은 내용이 바뀌지 않는다(키에 uuid 가 있다) — 1년 캐시. */
const PUBLIC_CACHE_CONTROL = "31536000";

export interface GalleryUploaderLabels {
  upload: string;
  uploadHint: string;
  uploadTarget: string;
  albumNone: string;
  processing: string;
  heicHelp: string;
  /** "{done} / {total}" 자리표시자가 든 원문 — 관리자 영역에는 next-intl 프로바이더가 없어 여기서 채운다. */
  running: string;
  status: Record<"waiting" | "working" | "done" | "failed", string>;
  reject: Record<GalleryRejectReason, string>;
  result: Record<GalleryActionCode, string>;
}

export interface UploaderAlbum {
  id: number;
  title: string;
}

type ItemState = "waiting" | "working" | "done" | "failed";

interface Item {
  key: string;
  name: string;
  state: ItemState;
  message: string;
}

/**
 * 브라우저 스토리지 클라이언트 → `commitUpload` 이 쓰는 포트.
 * 이 어댑터가 얇을수록 되돌리기 규칙(순수 모듈)이 테스트로 덮인다.
 */
function storagePort(client: ReturnType<typeof createBrowserSupabase>): GalleryStoragePort {
  return {
    async upload(bucket, key, body, options) {
      // upsert 하지 않는다 — 키에 uuid 가 있어 겹칠 일이 없고, 겹쳤다면 그것은 사고다(덮어쓰지 말고 알려야 한다)
      const { error } = await client.storage.from(bucket).upload(key, body as Blob, { ...options, upsert: false });
      return { error };
    },
    async remove(bucket, key) {
      await client.storage.from(bucket).remove([key]);
    },
  };
}

export function GalleryUploader({
  albums,
  defaultAlbumId,
  labels,
}: {
  albums: readonly UploaderAlbum[];
  defaultAlbumId: number | null;
  labels: GalleryUploaderLabels;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [albumId, setAlbumId] = useState<number | null>(defaultAlbumId);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);

  const mark = (key: string, state: ItemState, message: string): void => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, state, message } : it)));
  };

  const onPick = async (fileList: FileList | null): Promise<void> => {
    if (!fileList || fileList.length === 0 || busy) return;
    const picked = Array.from(fileList);
    const { accepted, rejected } = selectGalleryFiles(picked);

    const rejectedItems: Item[] = rejected.map((r, i) => ({
      key: `r${i}-${r.name}`,
      name: r.name,
      state: "failed",
      message: labels.reject[r.reason],
    }));
    const acceptedItems: Item[] = accepted.map((f, i) => ({ key: `a${i}-${f.name}`, name: f.name, state: "waiting", message: "" }));
    setItems([...acceptedItems, ...rejectedItems]);
    if (accepted.length === 0) return;

    setBusy(true);
    let ok = 0;

    // finally 가 잠금을 푼다. 무엇이 던지든(포트·React·브라우저) 업로더가 잠긴 채 남지 않는다 — 리뷰 F1 의 핵심.
    try {
      const client = createBrowserSupabase();
      const storage = storagePort(client);

      for (let i = 0; i < accepted.length; i += 1) {
        const file = accepted[i];
        const key = acceptedItems[i].key;
        mark(key, "working", labels.running.replace("{done}", String(i + 1)).replace("{total}", String(accepted.length)));

        // 한 장의 실패가 나머지를 멈추지 않는다. 예상 못 한 예외도 여기서 끝난다.
        try {
          const ext = fileExtension(file.name);
          if (ext === null) {
            mark(key, "failed", labels.reject.type);
            continue;
          }

          // 1. 디코드 — HEIC 는 여기서 걸린다(위 헤더의 실측)
          let bitmap: ImageBitmap;
          try {
            bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
          } catch {
            mark(key, "failed", isHeicExtension(ext) ? labels.heicHelp : labels.reject.decode);
            continue;
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
          // 타입까지 확인한다 — WebP 를 못 만드는 브라우저는 조용히 PNG 를 돌려준다(.webp 이름의 PNG 를 저장하지 않는다)
          if (!webp || webp.type !== "image/webp") {
            mark(key, "failed", labels.reject.encode);
            continue;
          }

          // 3~5. 업로드 두 번 + 기록. 되돌리기 판단은 commitUpload 안에 있다(리뷰 F1·M2)
          const outcome = await commitUpload({
            paths: buildUploadPaths(crypto.randomUUID(), ext, new Date()),
            original: file,
            publicBody: webp,
            originalContentType: contentTypeFor(ext),
            publicCacheControl: PUBLIC_CACHE_CONTROL,
            meta: {
              width: size.width,
              height: size.height,
              // bytes 는 **원본** 크기다(P6-1 §7-1 · 스펙 §13.9 (2)의 용량 추정이 보는 축)
              bytes: file.size,
              albumId,
              caption: null,
              sort: 0,
              active: true,
            },
            storage,
            record: recordGalleryUpload,
          });

          if (outcome.kind === "done") {
            ok += 1;
            mark(key, "done", labels.result.recorded);
          } else {
            mark(key, "failed", labels.reject[outcome.reason]);
          }
        } catch {
          // 여기까지 온 예외는 정체를 모른다 — 파일이 올라갔는지도 알 수 없으므로 "확인 필요"다(리뷰 M2 와 같은 원칙)
          mark(key, "failed", labels.reject.needsCheck);
        }
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
      if (ok > 0) router.refresh();
    }
  };

  return (
    <div className={s.uploader} data-testid="admin-gallery-uploader">
      <p className={s.hint}>{labels.uploadHint}</p>

      <div className={s.field}>
        <label className={s.label} htmlFor="gallery-upload-album">
          {labels.uploadTarget}
        </label>
        <select
          id="gallery-upload-album"
          className={s.input}
          value={albumId === null ? "" : String(albumId)}
          disabled={busy}
          onChange={(e) => setAlbumId(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">{labels.albumNone}</option>
          {albums.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="gallery-upload-input">
          {labels.upload}
        </label>
        <input
          ref={inputRef}
          id="gallery-upload-input"
          className={s.input}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
          disabled={busy}
          data-max-files={GALLERY_MAX_FILES}
          onChange={(e) => void onPick(e.target.files)}
        />
      </div>

      {busy ? (
        <p className={s.notice} role="status">
          {labels.processing}
        </p>
      ) : null}

      {items.length > 0 ? (
        <ul className={s.uploadList} data-testid="admin-gallery-upload-list">
          {items.map((it) => (
            <li key={it.key} className={s.uploadItem} data-state={it.state}>
              <span className={s.uploadName}>{it.name}</span>
              <span className={s.badge} data-state={it.state === "done" ? "live" : "off"}>
                {labels.status[it.state]}
              </span>
              {it.message ? <span className={s.uploadMessage}>{it.message}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
