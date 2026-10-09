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
import { runGalleryPick } from "@/lib/admin/galleryPick";
import { commitUpload, type GalleryStoragePort } from "@/lib/admin/galleryUpload";
import { createBrowserSupabase } from "@/lib/supabase/client";

import s from "./admin.module.css";
import { AdminBanner } from "./AdminBanner";
import { useAdminToast } from "./AdminToast";
import { uploadSummary } from "./feedback";

/** 공개본 WebP 품질. 0.82 는 1600px 사진에서 눈에 띄는 손실 없이 원본의 5~8% 크기가 되는 지점이다. */
const WEBP_QUALITY = 0.82;
/** 공개본은 내용이 바뀌지 않는다(키에 uuid 가 있다) — 1년 캐시. */
const PUBLIC_CACHE_CONTROL = "31536000";

export interface GalleryUploaderLabels {
  upload: string;
  uploadHint: string;
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
  const toast = useAdminToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [albumId, setAlbumId] = useState<number | null>(defaultAlbumId);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  /** 고른 장수 — 버튼 옆 한 줄(P5-23 라운드 2 B-10). 한 번의 고르기가 끝나면(전부 걸러져도) 흐름의 resetPicker 가 입력칸을 비우고 0 으로 되돌린다. */
  const [picked, setPicked] = useState(0);
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

  const onPick = async (fileList: FileList | null): Promise<void> => {
    if (!fileList || fileList.length === 0 || busy) return;
    setFailure("");
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

        const ext = fileExtension(file.name);
        if (ext === null) {
          mark(key, "failed", labels.reject.type);
          return false;
        }

        // 1. 디코드 — HEIC 는 여기서 걸린다(위 헤더의 실측)
        let bitmap: ImageBitmap;
        try {
          bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        } catch {
          mark(key, "failed", isHeicExtension(ext) ? labels.heicHelp : labels.reject.decode);
          return false;
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
          return false;
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
        if (inputRef.current) inputRef.current.value = "";
        setPicked(0);
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

      {/* 사진 고르기(P5-23 라운드 2 · 컨트롤러 B-10) — 브라우저 기본 파일 칸("파일 선택 · 선택된 파일 없음") 대신 버튼 모양의 라벨과
          고른 장수 한 줄. 진짜 입력칸은 그대로 있다: 보이지 않게 접었을 뿐 Tab 으로 포커스를 받고 Enter·Space 로 열린다(포커스 링은 라벨에 그린다).
          입력칸의 이름은 그 라벨("사진 고르기")이고, 고른 장수 줄이 설명(aria-describedby)이다. */}
      <div className={s.field}>
        <input
          ref={inputRef}
          id="gallery-upload-input"
          className={s.fileInput}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
          disabled={busy}
          data-max-files={GALLERY_MAX_FILES}
          aria-describedby="gallery-upload-count"
          onKeyDown={(e) => {
            // 버튼 모양이라 Enter 로도 연다 — 브라우저의 파일 칸은 Space 로만 열린다(크롬 실측)
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.click();
            }
          }}
          onChange={(e) => {
            setPicked(e.target.files?.length ?? 0);
            void onPick(e.target.files);
          }}
        />
        <div className={s.pickRow}>
          <label className={`${s.btnSecondary} ${s.pickButton}`} htmlFor="gallery-upload-input" data-disabled={busy ? "true" : undefined}>
            {labels.upload}
          </label>
          <span className={s.pickCount} id="gallery-upload-count" data-testid="admin-gallery-pick-count">
            {picked === 0 ? labels.pickNone : labels.pickCount.replace("{n}", String(picked))}
          </span>
        </div>
      </div>

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
