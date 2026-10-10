"use client";
/**
 * 팝업 사진 고르기 (T3-3 · 결정 9 · known-defects D6 해소) — "갤러리에서 고르기 + 새로 올리기".
 *
 * 전에는 사장님이 경로("/hero/bus-02.jpg")를 손으로 적었다. 이제 경로는 화면이 숨은 칸(name=imagePath)에 넣는다 —
 * 서버 검증(lib/admin/popupInput.ts)은 그대로라, 이 부품을 거치지 않은 요청도 같은 형식 검사를 받는다.
 *
 *   - 갤러리에서 고르기: 화면(서버)이 내려 준 사진 목록(경로·설명·URL)을 버튼으로 보인다. 고른 것은 aria-pressed.
 *   - 새로 올리기: 공통 고르기 부품(ImageDropzone, 한 장 · 설명 칸 없음) → lib/admin/imagePrepare.ts 의 같은 준비 규칙(1600px WebP · 타입 확인)
 *     → gallery 버킷 `popups/` 접두어에 **공개본만** upsert:false 로 올린다. 갤러리 행은 만들지 않는다(공개 갤러리에 섞이지 않게).
 *   - **옛 파일은 지우지 않는다.** 바꾸거나 빼도 파일은 남는다(갤러리가 같은 파일을 쓸 수 있다 — 고아 파일 허용).
 *     갤러리 사진을 지울 때는 반대로 팝업 참조를 본다(lib/admin/gallery.ts popupsUsingImage).
 *   - HTML 을 그리지 않는다. 문구는 전부 props(ko.json admin.popups.image.*).
 */
import Image from "next/image";
import { useRef, useState } from "react";

import { resolveImageUrl } from "@/components/home/image-url";
import { GALLERY_ACCEPT, prepareImage, PUBLIC_CACHE_CONTROL, storagePort } from "@/lib/admin/imagePrepare";
import { buildPopupImagePath } from "@/lib/admin/popupImage";
import { POPUP_FIELDS } from "@/lib/admin/popupInput";
import { createBrowserSupabase } from "@/lib/supabase/client";

import s from "./admin.module.css";
import { ImageDropzone, type ImageDropzoneHandle, type PickedImage } from "./ImageDropzone";

export interface PopupGalleryPhoto {
  imagePath: string;
  caption: string | null;
  /** 서버가 resolveImageUrl 로 만든 절대 URL — 못 풀면 null */
  url: string | null;
}

export interface PopupImageLabels {
  current: string;
  none: string;
  clear: string;
  fromGallery: string;
  galleryEmpty: string;
  upload: string;
  uploading: string;
  uploadFailed: string;
  heicHelp: string;
  /** 고르기 부품 문구 */
  pick: string;
  pickNone: string;
  pickCount: string;
  drop: string;
  remove: string;
  start: string;
}

const THUMB = 96;

export function PopupImagePicker({
  initialPath,
  photos,
  labels,
  disabled,
  invalid,
  hintId,
}: {
  initialPath: string;
  photos: readonly PopupGalleryPhoto[];
  labels: PopupImageLabels;
  disabled: boolean;
  invalid: boolean;
  hintId: string;
}) {
  const [path, setPath] = useState(initialPath);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dropzoneRef = useRef<ImageDropzoneHandle>(null);
  const currentUrl = resolveImageUrl(path);
  const locked = disabled || busy;

  const upload = async (picked: PickedImage[]): Promise<void> => {
    const one = picked[0];
    if (!one) return;
    setBusy(true);
    setMessage(labels.uploading);
    try {
      const prepared = await prepareImage(one.file);
      if (!prepared.ok) {
        setMessage(prepared.reason === "heic" ? labels.heicHelp : labels.uploadFailed);
        return;
      }
      const target = buildPopupImagePath(crypto.randomUUID(), new Date());
      const { error } = await storagePort(createBrowserSupabase()).upload(target.bucket, target.key, prepared.webp, {
        contentType: "image/webp",
        cacheControl: PUBLIC_CACHE_CONTROL,
      });
      if (error) {
        setMessage(labels.uploadFailed);
        return;
      }
      setPath(target.imagePath);
      setMessage("");
      dropzoneRef.current?.clear();
    } catch {
      setMessage(labels.uploadFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.popupImage} data-testid="admin-popup-image" role="group" aria-labelledby="popup-image-label" aria-describedby={hintId} data-invalid={invalid ? "true" : undefined}>
      <input type="hidden" name={POPUP_FIELDS.imagePath} value={path} />

      <div className={s.popupImageCurrent}>
        <span className={s.label}>{labels.current}</span>
        {path !== "" && currentUrl !== null ? (
          <Image src={currentUrl} alt="" width={THUMB * 2} height={THUMB} className={s.popupImageThumb} unoptimized />
        ) : (
          <p className={s.hint}>{labels.none}</p>
        )}
        {path !== "" ? (
          <button type="button" className={s.btnSecondary} onClick={() => setPath("")} disabled={locked}>
            {labels.clear}
          </button>
        ) : null}
      </div>

      <details className={s.popupImageGallery}>
        <summary className={s.notesFoldSummary}>{labels.fromGallery}</summary>
        {photos.length === 0 ? (
          <p className={s.hint}>{labels.galleryEmpty}</p>
        ) : (
          <ul className={s.popupImageGrid}>
            {photos.map((photo) => (
              <li key={photo.imagePath}>
                <button
                  type="button"
                  className={s.popupImageChoice}
                  aria-pressed={path === photo.imagePath}
                  aria-label={photo.caption ?? photo.imagePath}
                  onClick={() => setPath(photo.imagePath)}
                  disabled={locked}
                >
                  {photo.url !== null ? <Image src={photo.url} alt="" width={THUMB} height={THUMB} className={s.popupImageThumb} /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>

      <div className={s.popupImageUpload}>
        <span className={s.label}>{labels.upload}</span>
        <ImageDropzone
          handleRef={dropzoneRef}
          inputId="popup-image-upload"
          countId="popup-image-upload-count"
          accept={GALLERY_ACCEPT}
          multiple={false}
          captionMax={null}
          disabled={locked}
          labels={{
            pick: labels.pick,
            pickNone: labels.pickNone,
            pickCount: labels.pickCount,
            drop: labels.drop,
            caption: "",
            remove: labels.remove,
            start: labels.start,
          }}
          onUpload={upload}
        />
        {message !== "" ? (
          <p className={s.hint} role="status">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
