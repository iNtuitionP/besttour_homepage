/**
 * 앨범 카드 목록 (P6-3b `/gallery` 색인) — 서버 컴포넌트, fetch 없음.
 *
 * 카드 하나가 통째로 `/gallery/<slug>` 링크다(제목만 링크로 두면 모바일에서 표적이 너무 작다).
 * 표지는 그 앨범의 첫 사진(`components/pages/albums.ts` buildAlbumCards). 표지가 없으면 빈 틀만 두고,
 * **사진이 한 장도 없는 앨범에만** "준비 중" 라벨을 붙인다 — 문구는 props 로만 받는다(한글 리터럴 0).
 * 표지 이미지는 장식이므로 alt 는 빈 문자열이다: 바로 옆에 앨범 제목이 텍스트로 있다.
 */
import Image from "next/image";

import { Link } from "@/i18n/navigation";

import type { AlbumCard } from "./albums";
import p from "./pages.module.css";

export function AlbumCards({
  albums,
  label,
  pendingLabel,
}: {
  albums: readonly AlbumCard[];
  /** 목록 <ul> 의 aria-label */
  label: string;
  /** 사진이 아직 없는 앨범에 붙는 라벨 */
  pendingLabel: string;
}) {
  return (
    <ul className={p.albumGrid} aria-label={label} data-testid="album-cards">
      {albums.map((a) => (
        <li key={a.slug} className={p.albumItem}>
          <Link className={p.albumLink} href={`/gallery/${a.slug}`} data-album-slug={a.slug}>
            <span className={p.albumThumb}>
              {a.cover ? (
                <Image
                  className={p.albumImg}
                  src={a.cover.src}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                />
              ) : null}
              {a.hasPhotos ? null : <span className={p.albumPending}>{pendingLabel}</span>}
            </span>
            <span className={p.albumTitle}>{a.title}</span>
            {a.description ? <span className={p.albumDesc}>{a.description}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
