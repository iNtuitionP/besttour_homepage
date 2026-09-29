"use client";
/**
 * 앨범 관리 — 만들기 · 이름/주소/순서 고치기 · 노출 토글 · 삭제 (P6-2 · 0008).
 *
 * **앨범을 지워도 사진은 지워지지 않는다.** 0008 의 FK 가 `on delete set null` 이라 그 안의 사진은 '미분류'로 남는다.
 * 사장님이 "앨범을 지우면 사진도 사라지나?" 하고 멈추지 않도록 그 사실을 삭제 버튼 옆에 **미리** 적어 둔다
 * (messages/ko.json admin.gallery.albumDeleteNote) — 지운 뒤에 알려 주는 것은 늦다.
 *
 * **삭제는 두 단계다**(P5-11 — 사진 카드·공지의 선례를 앨범에도 맞췄다). 무장 체크박스를 켠 뒤에야 버튼이 눌리고,
 * 누르면 브라우저가 한 번 더 묻는다. 사진이 남는다고 해서 가벼운 동작은 아니다: 0008 의 공개 정책이
 * `album_id is null or (소속 앨범이 active)` 이므로, **노출을 꺼 둔 앨범을 지우면 그 안의 사진이 미분류가 되어
 * 방문자에게 다시 보인다.** 감추는 것이 목적이면 삭제가 아니라 앨범 노출 중지가 맞는 도구다.
 *
 * slug 는 URL 세그먼트(/gallery/<slug>)로 그대로 쓰이므로 0008 의 CHECK 와 같은 규칙으로 먼저 거른다
 * (lib/admin/galleryInput.ts ALBUM_SLUG_RE). 형식이 틀리면 서버가 DB 를 부르지 않고 validation 으로 돌려준다.
 *
 * **앨범 이름은 저장 전에 확인한다(P6-12 · known-defects D4).** 앨범 이름은 공개 갤러리에 그대로 보인다.
 * 서버가 확인이 필요한 표현을 찾으면 저장하지 않고 그 줄(또는 새 앨범 칸) 아래에 CopyWarningPanel 을 띄운다.
 * **그대로 저장하기**를 누르면 같은 값에 확인 키(copyAck)를 붙여 다시 보낸다 — 막지 않는다.
 *
 * 결과 알림(P5-20): 성공은 레이아웃의 토스트, 실패는 **그 자리**(새 앨범 칸 아래 · 그 앨범 줄 안) 배너(role=alert — 다음 동작 때 걷힌다).
 * 판정은 feedback.ts. 앨범을 지우면 그 줄이 사라져도 토스트는 레이아웃에 남는다.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createGalleryAlbum, deleteGalleryAlbum, toggleGalleryAlbumActive, updateGalleryAlbum } from "@/actions/admin/gallery";
import { COPY_ACK_FIELD, type CopyWarning } from "@/lib/admin/copyWarning";
import { ALBUM_SLUG_MAX, ALBUM_TITLE_MAX, GALLERY_SORT_MAX, type GalleryActionCode, type GalleryActionResult } from "@/lib/admin/galleryInput";

import s from "./admin.module.css";
import { AdminBanner } from "./AdminBanner";
import { useAdminToast } from "./AdminToast";
import { CopyWarningPanel, mergeAck, type CopyWarningLabels } from "./CopyWarningPanel";
import { feedbackKind } from "./feedback";

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
  albumDeleteArm: string;
  albumDeleteNote: string;
  albumDeleteConfirm: string;
  turnOn: string;
  turnOff: string;
  processing: string;
  state: { live: string; off: string };
  results: Record<GalleryActionCode, string>;
  copyWarning: CopyWarningLabels;
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

function AlbumRow({
  album,
  labels,
  onDone,
}: {
  album: AdminAlbumView;
  labels: GalleryAlbumsLabels;
  /** 결과를 알리고(성공 = 토스트) 화면을 다시 읽는다. 실패 문구를 돌려주면 이 줄 안에 배너로 남긴다. */
  onDone: (result: GalleryActionResult) => string;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(album.title);
  const [slug, setSlug] = useState(album.slug);
  const [sort, setSort] = useState(String(album.sort));
  const [armed, setArmed] = useState(false);
  const [warnings, setWarnings] = useState<CopyWarning[]>([]);
  /** 저장이 경고로 멈춘 횟수 — 같은 경고가 다시 와도 패널이 다시 보이는 자리로 온다(재리뷰 P2-R1 · CopyWarningPanel attempt). */
  const [warningRound, setWarningRound] = useState(0);
  const [ack, setAck] = useState<string[]>([]);
  const [banner, setBanner] = useState("");

  /** save=true 인 동작(이름 저장)만 경고 패널을 열고 닫는다. */
  const run = (action: () => Promise<GalleryActionResult>, save = false): void => {
    setBanner("");
    startTransition(async () => {
      const result = await action();
      if (result.code === "copyWarning") {
        const held = result.copyWarnings ?? [];
        setWarnings(held);
        setWarningRound((n) => n + 1);
        setAck((prev) => mergeAck(prev, held));
      } else if (save) {
        setWarnings([]);
        setAck([]);
      }
      setBanner(onDone(result));
    });
  };

  const onSave = (confirmed: boolean): void =>
    run(
      () =>
        updateGalleryAlbum({
          id: album.id,
          title: title.trim(),
          slug: slug.trim(),
          sort: num(sort),
          active: album.active,
          ...(confirmed ? { [COPY_ACK_FIELD]: ack } : {}),
        }),
      true,
    );

  return (
    <li className={s.albumRow} data-testid="admin-gallery-album">
      {/* 상태 배지는 줄 머리에(사진 카드와 같은 자리 — P5-23 라운드 2 B-10). 아래 버튼 줄은 저장 · 노출 두 버튼만 같은 높이로 선다. */}
      <p className={s.albumState}>
        <span className={s.badge} data-state={album.active ? "live" : "off"}>
          {album.active ? labels.state.live : labels.state.off}
        </span>
      </p>
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
        <button
          type="button"
          className={s.btnPrimary}
          disabled={pending}
          onClick={() => onSave(false)}
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
      </div>

      <CopyWarningPanel
        warnings={warnings}
        labels={labels.copyWarning}
        pending={pending}
        onConfirm={() => onSave(true)}
        idPrefix={`album-${album.id}`}
        attempt={warningRound}
      />

      <div className={s.dangerZone} data-testid="admin-gallery-album-danger">
        <label className={s.checkRow} htmlFor={`album-arm-${album.id}`}>
          <input
            id={`album-arm-${album.id}`}
            type="checkbox"
            checked={armed}
            disabled={pending}
            onChange={(e) => setArmed(e.currentTarget.checked)}
          />
          {labels.albumDeleteArm}
        </label>
        <button
          type="button"
          className={s.btnSecondary}
          disabled={pending || !armed}
          onClick={() => {
            if (!armed) return;
            if (!window.confirm(labels.albumDeleteConfirm)) return;
            run(() => deleteGalleryAlbum({ id: album.id }));
          }}
          data-testid="admin-gallery-album-delete"
        >
          {labels.albumDelete}
        </button>
      </div>

      <AdminBanner text={banner} />
    </li>
  );
}

export function GalleryAlbums({ albums, labels }: { albums: readonly AdminAlbumView[]; labels: GalleryAlbumsLabels }) {
  const router = useRouter();
  const toast = useAdminToast();
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState("");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [warnings, setWarnings] = useState<CopyWarning[]>([]);
  /** 새 앨범 칸의 경고 횟수 — 같은 경고가 다시 와도 패널이 다시 보이는 자리로 온다(재리뷰 P2-R1). */
  const [warningRound, setWarningRound] = useState(0);
  const [ack, setAck] = useState<string[]>([]);

  /** 성공은 토스트로 알리고 화면을 다시 읽는다. 실패 문구를 돌려준다 — 부른 자리(새 앨범 칸 · 앨범 줄)가 배너로 남긴다. */
  const done = (result: GalleryActionResult): string => {
    const kind = feedbackKind(result);
    if (kind === "toast") toast.show({ text: labels.results[result.code] });
    if (result.code !== "copyWarning") router.refresh();
    return kind === "banner" ? labels.results[result.code] : "";
  };

  /** confirmed=true 는 경고 패널의 "그대로 저장하기" — 이미 본 표현의 확인 키를 함께 보낸다. */
  const onCreate = (confirmed: boolean): void => {
    setBanner("");
    startTransition(async () => {
      const result = await createGalleryAlbum({
        title: title.trim(),
        slug: slug.trim(),
        sort: albums.length,
        active: true,
        ...(confirmed ? { [COPY_ACK_FIELD]: ack } : {}),
      });
      if (result.code === "copyWarning") {
        const held = result.copyWarnings ?? [];
        setWarnings(held);
        setWarningRound((n) => n + 1);
        setAck((prev) => mergeAck(prev, held));
        return;
      }
      setWarnings([]);
      setAck([]);
      if (result.ok) {
        setTitle("");
        setSlug("");
      }
      setBanner(done(result));
    });
  };

  return (
    <div data-testid="admin-gallery-albums">
      {/* 새 앨범 — 다른 폼과 같은 순서(이름 → 안내 → 입력칸 · P5-23 라운드 2 B-9). 안내가 입력칸 아래에 있던 유일한 칸이었다. */}
      <div className={s.field}>
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
      <div className={s.field}>
        <label className={s.label} htmlFor="album-new-slug">
          {labels.albumSlug}
        </label>
        <p className={s.hint} id="album-new-slug-hint">
          {labels.albumSlugHint}
        </p>
        <input
          id="album-new-slug"
          className={s.input}
          value={slug}
          maxLength={ALBUM_SLUG_MAX}
          disabled={pending}
          aria-describedby="album-new-slug-hint"
          onChange={(e) => setSlug(e.target.value)}
        />
      </div>
      <div className={s.rowActions}>
        <button type="button" className={s.btnPrimary} disabled={pending} onClick={() => onCreate(false)} data-testid="admin-gallery-album-create">
          {pending ? labels.processing : labels.albumCreate}
        </button>
      </div>

      <AdminBanner text={banner} testId="admin-gallery-album-banner" />

      <CopyWarningPanel
        warnings={warnings}
        labels={labels.copyWarning}
        pending={pending}
        onConfirm={() => onCreate(true)}
        idPrefix="album-new"
        attempt={warningRound}
      />

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
    </div>
  );
}
