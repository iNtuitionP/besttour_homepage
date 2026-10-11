"use client";
/**
 * 차량 사진 칸 (T4-1 · 결정 9) — 지금 사진 미리보기 + 새로 올리기(공통 ImageDropzone, 한 장 · 설명 칸 없음).
 *
 * 올리기는 팝업 사진과 같은 준비 규칙(lib/admin/imagePrepare.ts — 1600px WebP)으로 gallery 버킷 `vehicles/` 접두어에 공개본만 올린다.
 * 경로는 숨은 칸(name=imagePath)에 들어가고, 서버(lib/admin/vehicleInput.ts)와 DB(0024 CHECK)가 형식을 다시 본다.
 * 옛 파일은 지우지 않는다(고아 파일 허용 — 결정 9). 문구는 전부 props(ko.json admin.fleet.image.*).
 */
import Image from "next/image";
import { useRef, useState } from "react";

import { resolveImageUrl } from "@/components/home/image-url";
import { GALLERY_ACCEPT, prepareImage, PUBLIC_CACHE_CONTROL, storagePort } from "@/lib/admin/imagePrepare";
import { buildVehicleImagePath, VEHICLE_FIELDS } from "@/lib/admin/vehicleInput";
import { createBrowserSupabase } from "@/lib/supabase/client";

import s from "./admin.module.css";
import { ImageDropzone, type ImageDropzoneHandle, type PickedImage } from "./ImageDropzone";

export interface VehicleImageLabels {
  current: string;
  none: string;
  clear: string;
  upload: string;
  uploading: string;
  uploadFailed: string;
  heicHelp: string;
  pick: string;
  pickNone: string;
  pickCount: string;
  drop: string;
  remove: string;
  start: string;
}

const THUMB = 96;

export function VehicleImageField({
  initialPath,
  labels,
  disabled,
  invalid,
  hintId,
}: {
  initialPath: string;
  labels: VehicleImageLabels;
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
      const target = buildVehicleImagePath(crypto.randomUUID());
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
    <div className={s.popupImage} data-testid="admin-vehicle-image" role="group" aria-labelledby="vehicle-image-label" aria-describedby={hintId} data-invalid={invalid ? "true" : undefined}>
      <input type="hidden" name={VEHICLE_FIELDS.imagePath} value={path} />

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

      <div className={s.popupImageUpload}>
        <span className={s.label}>{labels.upload}</span>
        <ImageDropzone
          handleRef={dropzoneRef}
          inputId="vehicle-image-upload"
          countId="vehicle-image-upload-count"
          accept={GALLERY_ACCEPT}
          multiple={false}
          captionMax={null}
          disabled={locked}
          labels={{ pick: labels.pick, pickNone: labels.pickNone, pickCount: labels.pickCount, drop: labels.drop, caption: "", remove: labels.remove, start: labels.start }}
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
