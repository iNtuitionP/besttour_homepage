/**
 * 갤러리 카드 그리드 — 홈 GallerySection(섹션 8)과 /gallery(P6-3)가 같은 카드를 쓴다. 서버 컴포넌트, fetch 없음.
 *
 * URL 은 resolveImageUrl(Storage 공개 객체 URL, next.config.ts remotePatterns). 해석할 수 없는 행은 resolvePictures 가
 * 미리 뺀다 — 깨진 이미지를 만들지 않는다. alt 는 gallery.caption(없으면 빈 alt — 장식). 첫 장은 넓은 칸(목업 .gal 첫 타일).
 */
import Image from "next/image";

import type { GalleryItem } from "@/lib/types";

import s from "./Sections.module.css";
import { resolveImageUrl } from "./image-url";

export type Picture = GalleryItem & { src: string };

/** 행 → 표시 가능한 사진만 (URL 해석 불가 행 제외). 순서는 유지. */
export function resolvePictures(items: readonly GalleryItem[]): Picture[] {
  return items
    .map((g) => ({ ...g, src: resolveImageUrl(g.imagePath) }))
    .filter((g): g is Picture => g.src !== null);
}

export function GalleryGrid({ pictures, testId = "gallery-grid" }: { pictures: readonly Picture[]; testId?: string }) {
  return (
    <div className={s.gal} data-testid={testId}>
      {pictures.map((g, i) => (
        <figure key={g.id} className={i === 0 ? s.galWide : s.galItem}>
          <Image
            className={s.galImg}
            src={g.src}
            alt={g.caption ?? ""}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
          />
          {g.caption ? <figcaption className={s.galCap}>{g.caption}</figcaption> : null}
        </figure>
      ))}
    </div>
  );
}
