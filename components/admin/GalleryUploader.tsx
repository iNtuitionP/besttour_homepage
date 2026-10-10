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
 *   한 번의 고르기 순서(전부 걸러짐 · 한 장씩 · 잠금 풀기 · 고른 장수 줄 되돌리기 · 요약)는 lib/admin/galleryPick.ts `runGalleryPick` 에 있다 —
 *   한 장의 어떤 실패도 루프를 멈추지 못하고, 무슨 일이 있어도 마지막에 잠금이 풀리고 고른 장수 줄이 되돌아간다(P5-23 리뷰 P2-1).
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
  GALLERY_CAPTION_MAX,
  buildUploadPaths,
  contentTypeFor,
  selectGalleryFiles,
  type GalleryActionCode,
  type GalleryRejectReason,
} from "@/lib/admin/galleryInput";
import { runGalleryPick } from "@/lib/admin/galleryPick";
import { commitUpload, type GalleryStoragePort } from "@/lib/admin/galleryUpload";
import { GALLERY_ACCEPT, PUBLIC_CACHE_CONTROL, prepareImage, storagePort } from "@/lib/admin/imagePrepare";
import { createBrowserSupabase } from "@/lib/supabase/client";

import s from "./admin.module.css";
import { AdminBanner } from "./AdminBanner";
import { useAdminToast } from "./AdminToast";
import { uploadSummary } from "./feedback";
import { ImageDropzone, type ImageDropzoneHandle, type PickedImage } from "./ImageDropzone";

export interface GalleryUploaderLabels {
  upload: string;
  uploadHint: string;
  /** T3-2 — 놓는 자리 안내 · 장별 설명 칸 · 빼기 · 올리기 */
  dropHere: string;
  captionLabel: string;
  removePick: string;
  startUpload: string;
  /** 고른 사진이 없을 때 버튼 옆 한 줄. */
  pickNone: string;
  /** "{n}" 자리표시자가 든 원문 — 고른 장수. */
  pickCount: string;
  uploadTarget: string;
  albumNone: string;
  processing: string;
  heicHelp: string;
  /** "{done} / {total}" 자리표시자가 든 원문 — 관리자 영역에는 next-intl 프로바이더가 없어 여기서 채운다. */
  running: string;
  /** "{ok}" 자리표시자가 든 원문 — 다 올린 뒤 토스트(P5-20). 한 장씩의 결과는 아래 진행 목록이 그대로 보여 준다. */
  done: string;
  /** 전부 실패했을 때의 요약 배너(리뷰 P2-6). */
  failedAll: string;
  /** "{n}" 자리표시자가 든 원문 — 일부만 실패했을 때의 요약 배너. */
  failedSome: string;
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
  const toast = useAdminToast();
  /** 고르기 부품(T3-2) — 한 번의 올리기가 끝나면(전부 걸러져도) 흐름의 resetPicker 가 고른 목록과 파일 칸을 비운다. */
  const dropzoneRef = useRef<ImageDropzoneHandle>(null);
  const [albumId, setAlbumId] = useState<number | null>(defaultAlbumId);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  /**
   * 요약 배너가 선 횟수(AdminBanner attempt) — 고른 것이 전부 걸러지면 같은 틱에 비우고 다시 써서, 같은 문구가 두 번이면
   * 배너가 다시 붙지 않았다(재리뷰 P2-R1). 실패 요약마다 하나씩 는다.
   */
  const [failureRound, setFailureRound] = useState(0);

  const mark = (key: string, state: ItemState, message: string): void => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, state, message } : it)));
  };

  /** 한 번의 올리기가 끝났을 때 실패 요약(없으면 비운다) — 전부 실패도, 일부 실패도 배너로 남는다(리뷰 P2-6). */
  const summarize = (ok: number, failed: number): void => {
    const summary = uploadSummary(ok, failed);
    setFailure(summary === null ? "" : summary.kind === "allFailed" ? labels.failedAll : labels.failedSome.replace("{n}", String(summary.failed)));
    if (summary !== null) setFailureRound((n) => n + 1);
  };

  const onPick = async (pickedImages: PickedImage[]): Promise<void> => {
    if (pickedImages.length === 0 || busy) return;
    setFailure("");
    const picked = pickedImages.map((p) => p.file);
    // 장별 설명(T3-2 · 사장님 요청 6.3 최소안) — 고른 파일 객체로 찾는다(걸러진 장이 빠져도 짝이 어긋나지 않는다). 빈 설명은 null
    const captions = new Map(pickedImages.map((p) => [p.file, p.caption.trim()] as const));
    const captionOf = (f: File): string | null => captions.get(f) || null;
    const { accepted, rejected } = selectGalleryFiles(picked);

    const rejectedItems: Item[] = rejected.map((r, i) => ({
      key: `r${i}-${r.name}`,
      name: r.name,
      state: "failed",
      message: labels.reject[r.reason],
    }));
    const acceptedItems: Item[] = accepted.map((f, i) => ({ key: `a${i}-${f.name}`, name: f.name, state: "waiting", message: "" }));
    setItems([...acceptedItems, ...rejectedItems]);

    // 순서·마무리(전부 걸러짐 · 한 장씩 · 잠금 풀기 · 고른 장수 줄 되돌리기)는 순수 흐름(lib/admin/galleryPick.ts)이 정한다 — 여기서는 포트만 잇는다.
    let storage: GalleryStoragePort | undefined;
    await runGalleryPick({
      accepted: accepted.length,
      rejected: rejected.length,
      prepare: () => {
        storage = storagePort(createBrowserSupabase());
      },
      uploadOne: async (i) => {
        const file = accepted[i];
        const key = acceptedItems[i].key;
        mark(key, "working", labels.running.replace("{done}", String(i + 1)).replace("{total}", String(accepted.length)));
        if (storage === undefined) throw new Error("storage not prepared");

        // 1~2. 디코드 → 1600px WebP → 타입 확인 — 규칙은 lib/admin/imagePrepare.ts 한 곳(HEIC 는 디코드에서 걸린다, 위 헤더의 실측)
        const prepared = await prepareImage(file);
        if (!prepared.ok) {
          mark(key, "failed", prepared.reason === "heic" ? labels.heicHelp : labels.reject[prepared.reason]);
          return false;
        }
        const { ext, webp } = prepared;

        // 3~5. 업로드 두 번 + 기록. 되돌리기 판단은 commitUpload 안에 있다(리뷰 F1·M2)
        const outcome = await commitUpload({
          paths: buildUploadPaths(crypto.randomUUID(), ext, new Date()),
          original: file,
          publicBody: webp,
          originalContentType: contentTypeFor(ext),
          publicCacheControl: PUBLIC_CACHE_CONTROL,
          meta: {
            width: prepared.width,
            height: prepared.height,
            // bytes 는 **원본** 크기다(P6-1 §7-1 · 스펙 §13.9 (2)의 용량 추정이 보는 축)
            bytes: file.size,
            albumId,
            caption: captionOf(file),
            sort: 0,
            active: true,
          },
          storage,
          record: recordGalleryUpload,
        });

        if (outcome.kind === "done") {
          mark(key, "done", labels.result.recorded);
          return true;
        }
        mark(key, "failed", labels.reject[outcome.reason]);
        return false;
      },
      // 여기까지 온 예외는 정체를 모른다 — 파일이 올라갔는지도 알 수 없으므로 "확인 필요"다(리뷰 M2 와 같은 원칙)
      onThrow: (i) => mark(acceptedItems[i].key, "failed", labels.reject.needsCheck),
      setBusy,
      resetPicker: () => {
        dropzoneRef.current?.clear();
      },
      finish: (ok, failed) => {
        if (ok > 0) {
          // 다 올린 뒤 한 번 — 성공 장수만(실패한 장은 진행 목록에 그 자리 이유와 함께 남아 있다)
          toast.show({ text: labels.done.replace("{ok}", String(ok)) });
          router.refresh();
        }
        // 실패한 장이 있으면 요약 배너 — 전부 실패면 토스트가 없어서 이것이 유일한 알림이다
        summarize(ok, failed);
      },
    });
  };

  return (
    <div className={s.uploader} data-testid="admin-gallery-uploader">
      <p className={`${s.hint} ${s.uploaderHint}`}>{labels.uploadHint}</p>

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

      {/* 사진 고르기(T3-2) — 끌어다 놓기 또는 버튼 모양 라벨(B-10 규칙은 부품 안에 그대로). 고른 사진은 미리보기 목록에 쌓이고,
          장별 설명을 적은 뒤 «올리기» 를 누르면 아래 흐름이 돈다. */}
      <ImageDropzone
        handleRef={dropzoneRef}
        inputId="gallery-upload-input"
        countId="gallery-upload-count"
        accept={GALLERY_ACCEPT}
        multiple
        captionMax={GALLERY_CAPTION_MAX}
        disabled={busy}
        labels={{
          pick: labels.upload,
          pickNone: labels.pickNone,
          pickCount: labels.pickCount,
          drop: labels.dropHere,
          caption: labels.captionLabel,
          remove: labels.removePick,
          start: labels.startUpload,
        }}
        onUpload={onPick}
        testId="admin-gallery-dropzone"
      />

      {busy ? (
        <p className={s.notice} role="status">
          {labels.processing}
        </p>
      ) : null}

      <AdminBanner text={failure} attempt={failureRound} testId="admin-gallery-upload-banner" />

      {items.length > 0 ? (
        // 한 장씩의 결과(올리는 중 → 올림/실패)가 스크린리더에 차례로 읽힌다(polite — 리뷰 P2-6)
        <ul className={s.uploadList} aria-live="polite" data-testid="admin-gallery-upload-list">
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
