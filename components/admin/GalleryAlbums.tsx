"use client";
/**
 * 갤러리 글 목록 — 글(앨범) 마다 제목 · 날짜 · 상태 · 고치기 · 숨기기/다시 보이기 (OWNER-FEEDBACK T4-2 · 0025).
 *
 * 글 하나 = 제목 + 날짜 + 본문 + 사진 여러 장. 쓰기·고치기·지우기는 각자 화면이다(/admin/gallery/posts/new · /[id]) —
 * 본문 편집기가 들어가 한 줄에 담기지 않는다. 이 목록은 차례(게시일 최신순)와 노출만 다룬다.
 *
 * **주소(slug) 입력란은 없다.** 새 글은 DB 가 짓고 고치기는 slug 를 보내지 않는다(공개 주소 /gallery/<slug> 유지 · 위험 31).
 * **글을 지우면 그 안의 사진은 미분류 · 비공개가 된다**(0025 — 결정 8 (b)). 그 사실은 목록 위(albumDeleteNote)와 삭제 버튼 옆에 미리 적는다.
 *
 * 결과 알림(P5-20): 성공은 레이아웃의 토스트, 실패는 그 줄 안 배너. 판정은 feedback.ts.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toggleGalleryAlbumActive } from "@/actions/admin/gallery";
import type { GalleryActionCode, GalleryActionResult } from "@/lib/admin/galleryInput";

import s from "./admin.module.css";
import { AdminBanner } from "./AdminBanner";
import { useAdminToast } from "./AdminToast";
import { feedbackKind } from "./feedback";

export interface GalleryAlbumsLabels {
  albumNew: string;
  albumLead: string;
  albumListLabel: string;
  albumEmpty: string;
  albumOpen: string;
  albumDeleteNote: string;
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
  /** 관리자 날짜 틀로 이미 적은 게시일(서버가 채운다). */
  dateLabel: string;
  active: boolean;
}

/** 새 글 쓰기 · 고치기 화면의 경로 — 서버 페이지와 같은 값. */
export const ADMIN_ALBUM_POSTS_PATH = "/admin/gallery/posts";

function AlbumRow({ album, labels, onDone }: { album: AdminAlbumView; labels: GalleryAlbumsLabels; onDone: (result: GalleryActionResult) => string }) {
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState("");

  const toggle = (): void => {
    setBanner("");
    startTransition(async () => {
      setBanner(onDone(await toggleGalleryAlbumActive({ id: album.id, active: !album.active })));
    });
  };

  return (
    <li className={s.albumRow} data-testid="admin-gallery-album">
      <p className={s.albumState}>
        <span className={s.badge} data-state={album.active ? "live" : "off"}>
          {album.active ? labels.state.live : labels.state.off}
        </span>
        <span className={s.hint}>{album.dateLabel}</span>
      </p>
      <p>
        <Link className={s.rowLink} href={`${ADMIN_ALBUM_POSTS_PATH}/${album.id}`} data-testid="admin-gallery-album-open">
          {album.title}
        </Link>
      </p>
      <div className={s.rowActions}>
        <Link className={`${s.btnSecondary} ${s.btnLink}`} href={`${ADMIN_ALBUM_POSTS_PATH}/${album.id}`}>
          {labels.albumOpen}
        </Link>
        <button type="button" className={s.btnSecondary} disabled={pending} onClick={toggle} data-testid="admin-gallery-album-toggle">
          {pending ? labels.processing : album.active ? labels.turnOff : labels.turnOn}
        </button>
      </div>
      <AdminBanner text={banner} />
    </li>
  );
}

export function GalleryAlbums({ albums, labels }: { albums: readonly AdminAlbumView[]; labels: GalleryAlbumsLabels }) {
  const router = useRouter();
  const toast = useAdminToast();

  /** 성공은 토스트로 알리고 화면을 다시 읽는다. 실패 문구를 돌려준다 — 그 줄이 배너로 남긴다. */
  const done = (result: GalleryActionResult): string => {
    const kind = feedbackKind(result);
    if (kind === "toast") toast.show({ text: labels.results[result.code] });
    router.refresh();
    return kind === "banner" ? labels.results[result.code] : "";
  };

  return (
    <div data-testid="admin-gallery-albums">
      <p className={s.hint}>{labels.albumLead}</p>
      <div className={s.rowActions}>
        <Link className={`${s.btnPrimary} ${s.btnLink}`} href={`${ADMIN_ALBUM_POSTS_PATH}/new`} data-testid="admin-gallery-album-create">
          {labels.albumNew}
        </Link>
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
    </div>
  );
}
