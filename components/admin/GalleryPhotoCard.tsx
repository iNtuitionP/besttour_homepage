"use client";
/**
 * 사진 한 장의 카드 — 썸네일 · 설명 · 앨범 이동 · 순서 · 노출 토글 · 삭제 (P6-2).
 *
 * **앨범 이동이 여기 있다.** 파일은 움직이지 않는다 — 경로에 앨범이 없으므로(P6-1 §7-2) 이동은 `album_id`
 * UPDATE 한 줄이다. 그래서 이동은 실패해도 파일과 행이 어긋나지 않는다.
 *
 * **삭제는 두 단계**다(components/admin/NoticeForm.tsx 선례). 사진은 원본까지 함께 지워지고 되돌릴 수 없다.
 * 감추는 것으로 충분하면 노출 중지가 맞는 도구라, 중지 버튼을 삭제보다 앞에 둔다.
 *
 * **파일이 없는 행을 화면에서 잡는다.** 삭제가 중간에 멈추면(파일은 지워졌는데 행이 남는 경우) 목록에 깨진 이미지가
 * 뜬다 — 그것을 그냥 두지 않고 onError 로 잡아 "파일을 찾지 못했다"고 적어 준다. 조용한 실패를 눈에 보이게 만드는 것이
 * 이 화면의 몫이다(서버는 그 사실을 알 방법이 없다 — 스토리지에 물어봐야 안다).
 */
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteGalleryPhoto, toggleGalleryPhotoActive, updateGalleryPhoto } from "@/actions/admin/gallery";
import { GALLERY_CAPTION_MAX, GALLERY_SORT_MAX, type GalleryActionCode } from "@/lib/admin/galleryInput";

import s from "./admin.module.css";

const THUMB_WIDTH = 320;
const THUMB_HEIGHT = 240;

export interface GalleryPhotoCardLabels {
  caption: string;
  captionHint: string;
  sort: string;
  albumLabel: string;
  albumNone: string;
  save: string;
  turnOn: string;
  turnOff: string;
  delete: string;
  deleteArm: string;
  deleteConfirm: string;
  processing: string;
  missingFile: string;
  state: { live: string; off: string };
  results: Record<GalleryActionCode, string>;
}

export interface AdminPhotoView {
  id: number;
  /** resolveImageUrl 이 만든 절대 URL. null 이면 경로를 해석하지 못한 것이다. */
  url: string | null;
  caption: string;
  sort: number;
  active: boolean;
  albumId: number | null;
  width: number | null;
  height: number | null;
}

export function GalleryPhotoCard({
  photo,
  albums,
  labels,
}: {
  photo: AdminPhotoView;
  albums: readonly { id: number; title: string }[];
  labels: GalleryPhotoCardLabels;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [missing, setMissing] = useState(false);
  const [armed, setArmed] = useState(false);
  const [caption, setCaption] = useState(photo.caption);
  const [albumId, setAlbumId] = useState<number | null>(photo.albumId);
  const [sort, setSort] = useState(String(photo.sort));

  const run = (action: () => Promise<{ code: GalleryActionCode }>): void => {
    setNotice("");
    startTransition(async () => {
      const result = await action();
      setNotice(labels.results[result.code]);
      router.refresh();
    });
  };

  const onSave = (): void => {
    const parsed = Number(sort);
    run(() =>
      updateGalleryPhoto({
        id: photo.id,
        caption: caption.trim() === "" ? null : caption.trim(),
        albumId,
        sort: Number.isInteger(parsed) ? parsed : 0,
      }),
    );
  };

  return (
    <li className={s.photoCard} data-testid="admin-gallery-card" data-active={photo.active}>
      <div className={s.photoThumb}>
        {photo.url && !missing ? (
          <Image
            src={photo.url}
            alt=""
            width={THUMB_WIDTH}
            height={THUMB_HEIGHT}
            className={s.photoImg}
            loading="lazy"
            onError={() => setMissing(true)}
          />
        ) : (
          <p className={s.photoMissing} role="status">
            {labels.missingFile}
          </p>
        )}
        <span className={s.badge} data-state={photo.active ? "live" : "off"}>
          {photo.active ? labels.state.live : labels.state.off}
        </span>
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor={`caption-${photo.id}`}>
          {labels.caption}
        </label>
        <input
          id={`caption-${photo.id}`}
          className={s.input}
          value={caption}
          maxLength={GALLERY_CAPTION_MAX}
          disabled={pending}
          onChange={(e) => setCaption(e.target.value)}
        />
        <p className={s.hint}>{labels.captionHint}</p>
      </div>

      <div className={s.dateRow}>
        <div className={s.dateCol}>
          <label className={s.label} htmlFor={`album-${photo.id}`}>
            {labels.albumLabel}
          </label>
          <select
            id={`album-${photo.id}`}
            className={s.input}
            value={albumId === null ? "" : String(albumId)}
            disabled={pending}
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
        <div className={s.dateCol}>
          <label className={s.label} htmlFor={`sort-${photo.id}`}>
            {labels.sort}
          </label>
          <input
            id={`sort-${photo.id}`}
            className={s.input}
            type="number"
            inputMode="numeric"
            min={0}
            max={GALLERY_SORT_MAX}
            value={sort}
            disabled={pending}
            onChange={(e) => setSort(e.target.value)}
          />
        </div>
      </div>

      <div className={s.rowActions}>
        <button type="button" className={s.btnPrimary} disabled={pending} onClick={onSave} data-testid="admin-gallery-save">
          {pending ? labels.processing : labels.save}
        </button>
        <button
          type="button"
          className={s.btnSecondary}
          disabled={pending}
          onClick={() => run(() => toggleGalleryPhotoActive({ id: photo.id, active: !photo.active }))}
          data-testid="admin-gallery-toggle"
        >
          {photo.active ? labels.turnOff : labels.turnOn}
        </button>
      </div>

      <div className={s.dangerZone}>
        <label className={s.checkRow} htmlFor={`arm-${photo.id}`}>
          <input id={`arm-${photo.id}`} type="checkbox" checked={armed} disabled={pending} onChange={(e) => setArmed(e.target.checked)} />
          {labels.deleteArm}
        </label>
        <button
          type="button"
          className={s.btnSecondary}
          disabled={pending || !armed}
          onClick={() => {
            if (!window.confirm(labels.deleteConfirm)) return;
            run(() => deleteGalleryPhoto({ id: photo.id }));
          }}
          data-testid="admin-gallery-delete"
        >
          {labels.delete}
        </button>
      </div>

      <p className={s.notice} role="status">
        {notice}
      </p>
    </li>
  );
}
