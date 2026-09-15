"use client";
/**
 * 앨범 관리 — 만들기 · 이름/주소/순서 고치기 · 노출 토글 · 삭제 (P6-2 · 0008).
 *
 * **앨범을 지워도 사진은 지워지지 않는다.** 0008 의 FK 가 `on delete set null` 이라 그 안의 사진은 '미분류'로 남는다.
 * 사장님이 "앨범을 지우면 사진도 사라지나?" 하고 멈추지 않도록 그 사실을 삭제 버튼 옆에 **미리** 적어 둔다
 * (messages/ko.json admin.gallery.albumDeleteNote) — 지운 뒤에 알려 주는 것은 늦다.
 *
 * slug 는 URL 세그먼트(/gallery/<slug>)로 그대로 쓰이므로 0008 의 CHECK 와 같은 규칙으로 먼저 거른다
 * (lib/admin/galleryInput.ts ALBUM_SLUG_RE). 형식이 틀리면 서버가 DB 를 부르지 않고 validation 으로 돌려준다.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createGalleryAlbum, deleteGalleryAlbum, toggleGalleryAlbumActive, updateGalleryAlbum } from "@/actions/admin/gallery";
import { ALBUM_SLUG_MAX, ALBUM_TITLE_MAX, GALLERY_SORT_MAX, type GalleryActionCode } from "@/lib/admin/galleryInput";

import s from "./admin.module.css";

export interface GalleryAlbumsLabels {
  albumNew: string;
  albumListLabel: string;
  albumEmpty: string;
  albumTitle: string;
  albumSlug: string;
  albumSlugHint: string;
  albumSort: string;
  albumActive: string;
  albumCreate: string;
  albumSave: string;
  albumDelete: string;
  albumDeleteNote: string;
  albumDeleteConfirm: string;
  turnOn: string;
  turnOff: string;
  processing: string;
  state: { live: string; off: string };
  results: Record<GalleryActionCode, string>;
}

export interface AdminAlbumView {
  id: number;
  slug: string;
  title: string;
  sort: number;
  active: boolean;
}

const num = (raw: string): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

function AlbumRow({ album, labels, onDone }: { album: AdminAlbumView; labels: GalleryAlbumsLabels; onDone: (code: GalleryActionCode) => void }) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(album.title);
  const [slug, setSlug] = useState(album.slug);
  const [sort, setSort] = useState(String(album.sort));

  const run = (action: () => Promise<{ code: GalleryActionCode }>): void => {
    startTransition(async () => {
      const result = await action();
      onDone(result.code);
    });
  };

  return (
    <li className={s.albumRow} data-testid="admin-gallery-album">
      <div className={s.dateRow}>
        <div className={s.dateCol}>
          <label className={s.label} htmlFor={`album-title-${album.id}`}>
            {labels.albumTitle}
          </label>
          <input
            id={`album-title-${album.id}`}
            className={s.input}
            value={title}
            maxLength={ALBUM_TITLE_MAX}
            disabled={pending}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className={s.dateCol}>
          <label className={s.label} htmlFor={`album-slug-${album.id}`}>
            {labels.albumSlug}
          </label>
          <input
            id={`album-slug-${album.id}`}
            className={s.input}
            value={slug}
            maxLength={ALBUM_SLUG_MAX}
            disabled={pending}
            onChange={(e) => setSlug(e.target.value)}
          />
        </div>
        <div className={s.dateCol}>
          <label className={s.label} htmlFor={`album-sort-${album.id}`}>
            {labels.albumSort}
          </label>
          <input
            id={`album-sort-${album.id}`}
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
        <span className={s.badge} data-state={album.active ? "live" : "off"}>
          {album.active ? labels.state.live : labels.state.off}
        </span>
        <button
          type="button"
          className={s.btnPrimary}
          disabled={pending}
          onClick={() => run(() => updateGalleryAlbum({ id: album.id, title: title.trim(), slug: slug.trim(), sort: num(sort), active: album.active }))}
        >
          {pending ? labels.processing : labels.albumSave}
        </button>
        <button
          type="button"
          className={s.btnSecondary}
          disabled={pending}
          onClick={() => run(() => toggleGalleryAlbumActive({ id: album.id, active: !album.active }))}
        >
          {album.active ? labels.turnOff : labels.turnOn}
        </button>
        <button
          type="button"
          className={s.btnSecondary}
          disabled={pending}
          onClick={() => {
            if (!window.confirm(labels.albumDeleteConfirm)) return;
            run(() => deleteGalleryAlbum({ id: album.id }));
          }}
          data-testid="admin-gallery-album-delete"
        >
          {labels.albumDelete}
        </button>
      </div>
    </li>
  );
}

export function GalleryAlbums({ albums, labels }: { albums: readonly AdminAlbumView[]; labels: GalleryAlbumsLabels }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");

  const done = (code: GalleryActionCode): void => {
    setNotice(labels.results[code]);
    router.refresh();
  };

  const onCreate = (): void => {
    setNotice("");
    startTransition(async () => {
      const result = await createGalleryAlbum({ title: title.trim(), slug: slug.trim(), sort: albums.length, active: true });
      if (result.ok) {
        setTitle("");
        setSlug("");
      }
      done(result.code);
    });
  };

  return (
    <div data-testid="admin-gallery-albums">
      <div className={s.dateRow}>
        <div className={s.dateCol}>
          <label className={s.label} htmlFor="album-new-title">
            {labels.albumTitle}
          </label>
          <input
            id="album-new-title"
            className={s.input}
            value={title}
            maxLength={ALBUM_TITLE_MAX}
            disabled={pending}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className={s.dateCol}>
          <label className={s.label} htmlFor="album-new-slug">
            {labels.albumSlug}
          </label>
          <input
            id="album-new-slug"
            className={s.input}
            value={slug}
            maxLength={ALBUM_SLUG_MAX}
            disabled={pending}
            onChange={(e) => setSlug(e.target.value)}
          />
          <p className={s.hint}>{labels.albumSlugHint}</p>
        </div>
      </div>
      <div className={s.rowActions}>
        <button type="button" className={s.btnPrimary} disabled={pending} onClick={onCreate} data-testid="admin-gallery-album-create">
          {pending ? labels.processing : labels.albumCreate}
        </button>
      </div>

      <p className={s.hint}>{labels.albumDeleteNote}</p>

      {albums.length === 0 ? (
        <p className={s.empty}>{labels.albumEmpty}</p>
      ) : (
        <ul className={s.albumList} aria-label={labels.albumListLabel}>
          {albums.map((a) => (
            <AlbumRow key={a.id} album={a} labels={labels} onDone={done} />
          ))}
        </ul>
      )}

      <p className={s.notice} role="status">
        {notice}
      </p>
    </div>
  );
}
