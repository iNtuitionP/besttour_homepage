/**
 * 갤러리 카드 그리드 — 홈 GallerySection(섹션 8)과 /gallery(P6-3)가 같은 카드를 쓴다. 서버 컴포넌트, fetch 없음.
 *
 * URL 은 resolveImageUrl(Storage 공개 객체 URL, next.config.ts remotePatterns). 해석할 수 없는 행은 resolvePictures 가
 * 미리 뺀다 — 깨진 이미지를 만들지 않는다. alt 는 gallery.caption(없으면 빈 alt — 장식). 첫 장은 넓은 칸(목업 .gal 첫 타일).
 * P7-4: 사진 설명은 사장님이 쓴 한국어 — 영문 화면에서는 figure 에 lang="ko"(alt·figcaption 둘 다 덮는다 · koLang — ko 화면은 속성 없음).
 * 로케일은 여기서 읽는다 — 부르는 쪽(홈 · /gallery · 앨범 상세)의 모양은 그대로다.
 */
import Image from "next/image";
import { getLocale } from "next-intl/server";

import { koLang } from "@/lib/i18n/ledger-ui";
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

export async function GalleryGrid({ pictures, testId = "gallery-grid" }: { pictures: readonly Picture[]; testId?: string }) {
  const locale = await getLocale();
  const lang = koLang(locale);
  return (
    <div className={s.gal} data-testid={testId}>
      {pictures.map((g, i) => (
        <figure key={g.id} className={i === 0 ? s.galWide : s.galItem} lang={g.caption ? lang : undefined}>
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
