/**
 * 섹션 8 — 갤러리 (#gallery, 목업 variant-08 §06). 서버 컴포넌트.
 * 원격 gallery 가 비어 있으면(또는 URL 을 해석할 수 있는 행이 하나도 없으면) **섹션 자체를 숨긴다** — 빈 그리드 금지.
 * 카드 그리드는 GalleryGrid(next/image + resolveImageUrl) — /gallery(P6-3)와 같은 컴포넌트다.
 * "갤러리 전체 보기" 는 /gallery 가 준비(LEGACY_MENU gallery.ready)된 뒤에만 — 죽은 링크를 배포하지 않는다.
 */
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { LEGACY_MENU } from "@/lib/legacy-menu-map";
import type { GalleryItem } from "@/lib/types";

import h from "./home.module.css";
import s from "./Sections.module.css";
import { GalleryGrid, resolvePictures } from "./GalleryGrid";
import { RICH } from "./rich";
import { SectionHead } from "./SectionHead";

export async function GallerySection({ items }: { items: readonly GalleryItem[] }) {
  const pictures = resolvePictures(items);
  if (pictures.length === 0) return null;

  const t = await getTranslations("home.gallery");
  const galleryMenu = LEGACY_MENU.find((m) => m.key === "gallery");

  return (
    <section id="gallery" className={`${h.section} ${h.toneLav}`} aria-labelledby="gallery-h" data-section="gallery">
      <div className={h.wrap}>
        <SectionHead id="gallery-h" eyebrow={t("eyebrow")} title={t.rich("title", RICH)} desc={t("desc")} />

        <GalleryGrid pictures={pictures} />

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
