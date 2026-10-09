/**
 * 앨범 카드 목록 (P6-3b `/gallery` 색인) — 서버 컴포넌트, fetch 없음.
 *
 * 카드 하나가 통째로 `/gallery/<slug>` 링크다(제목만 링크로 두면 모바일에서 표적이 너무 작다).
 * 표지는 그 앨범의 첫 사진(`components/pages/albums.ts` buildAlbumCards). 표지가 없으면 빈 틀만 두고,
 * **사진이 한 장도 없는 앨범에만** "준비 중" 라벨을 붙인다 — 문구는 props 로만 받는다(한글 리터럴 0).
 * 표지 이미지는 장식이므로 alt 는 빈 문자열이다: 바로 옆에 앨범 제목이 텍스트로 있다.
 * P7-4: 영문 화면에서는 사장님이 쓴 앨범 제목·설명에 lang="ko"(koLang — ko 화면은 속성 없음). 로케일은 여기서 읽는다(페이지 호출 모양 그대로).
 */
import Image from "next/image";
import { getLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { koLang } from "@/lib/i18n/ledger-ui";

import type { AlbumCard } from "./albums";
import p from "./pages.module.css";

export async function AlbumCards({
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
  const locale = await getLocale();
  const lang = koLang(locale);
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
            <span className={p.albumTitle} lang={lang}>
              {a.title}
            </span>
            {a.description ? (
              <span className={p.albumDesc} lang={lang}>
                {a.description}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
