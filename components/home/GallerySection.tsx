/**
 * 섹션 8 — 갤러리 (#gallery, 목업 variant-08 §06). 서버 컴포넌트.
 * 원격 gallery 가 비어 있으면(또는 URL 을 해석할 수 있는 행이 하나도 없으면) **섹션 자체를 숨긴다** — 빈 그리드 금지.
 * 이미지는 next/image + resolveImageUrl(Storage 공개 객체 URL, next.config.ts remotePatterns).
 * "갤러리 전체 보기" 는 /gallery 가 준비(LEGACY_MENU gallery.ready)된 뒤에만 — 죽은 링크를 배포하지 않는다.
 */
import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { LEGACY_MENU } from "@/lib/legacy-menu-map";
import type { GalleryItem } from "@/lib/types";

import h from "./home.module.css";
import s from "./Sections.module.css";
import { resolveImageUrl } from "./image-url";
import { RICH } from "./rich";
import { SectionHead } from "./SectionHead";

export async function GallerySection({ items }: { items: readonly GalleryItem[] }) {
  const pictures = items
    .map((g) => ({ ...g, src: resolveImageUrl(g.imagePath) }))
    .filter((g): g is GalleryItem & { src: string } => g.src !== null);
  if (pictures.length === 0) return null;

  const t = await getTranslations("home.gallery");
  const galleryMenu = LEGACY_MENU.find((m) => m.key === "gallery");

  return (
    <section id="gallery" className={`${h.section} ${h.toneLav}`} aria-labelledby="gallery-h" data-section="gallery">
      <div className={h.wrap}>
        <SectionHead id="gallery-h" eyebrow={t("eyebrow")} title={t.rich("title", RICH)} desc={t("desc")} />

        <div className={s.gal} data-testid="gallery-grid">
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

        {galleryMenu?.ready ? (
          <p className={s.galMore}>
            <Link href={galleryMenu.href} className={h.btnGhost}>
              {t("more")}
            </Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}
