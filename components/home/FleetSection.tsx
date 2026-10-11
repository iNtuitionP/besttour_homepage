/**
 * 섹션 6 — 차량 (#fleet, 목업 variant-08 §04). 서버 컴포넌트. **가격 없음.**
 * 카드 = 사진(vehicles.image_path) · 이름(name_ko / name_en) · 정원(capacity) · 설명(description_ko) · 견적 CTA(홈 간편 견적 `/#quote`).
 * T4-1(0024) — 사진·설명은 DB 가 진실이다(사장님이 /admin/fleet 에서 고친다). 코드에 차종별 사진·문구를 두지 않는다.
 * 영문 화면에서는 설명을 숨긴다(결정 11 — 영문 설명 칸이 없다). 사진이 없는 차량은 사진 없이 렌더한다.
 * P3-8: 차종 프리필(`/quote?vehicle=`)은 위저드와 함께 없어졌다 — 간편 견적은 차종을 받지 않고 사장님이 전화로 확인한다.
 * 차량이 0대면 섹션을 숨긴다.
 */
import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import type { Vehicle } from "@/lib/types";

import h from "./home.module.css";
import { resolveImageUrl } from "./image-url";
import s from "./Sections.module.css";
import { QUOTE_ANCHOR } from "./quote-anchor";
import { RICH } from "./rich";
import { SectionHead } from "./SectionHead";

export async function FleetSection({ vehicles }: { vehicles: readonly Vehicle[] }) {
  if (vehicles.length === 0) return null;
  const [t, locale] = await Promise.all([getTranslations("home.fleet"), getLocale()]);
  /** 차량 이름 — DB 행의 로케일 필드(vehicles.name_ko · name_en). P2-6 */
  const nameOf = (v: Vehicle) => (locale === "en" ? v.nameEn : v.nameKo);

  return (
    <section id="fleet" className={`${h.section} ${h.toneLav}`} aria-labelledby="fleet-h" data-section="fleet">
      <div className={h.wrap}>
        <SectionHead
          id="fleet-h"
          eyebrow={t("eyebrow")}
          title={t.rich("title", { ...RICH, count: String(vehicles.length) })}
        />

        <div className={s.fleet} data-testid="fleet-cards">
          {vehicles.map((v) => {
            const image = resolveImageUrl(v.imagePath);
            const line = locale === "en" ? null : (v.descriptionKo ?? "").trim();
            return (
              <article key={v.id} className={s.bus} data-vehicle={v.slug}>
                <div className={s.busPh}>
                  <span className={s.busSeat}>{t("seat", { n: String(v.capacity) })}</span>
                  {image ? (
                    <Image
                      className={s.busImg}
                      src={image}
                      alt={nameOf(v)}
                      fill
                      sizes="(min-width: 1024px) 33vw, (min-width: 560px) 50vw, 100vw"
                    />
                  ) : null}
                </div>
                <div className={s.busBody}>
                  <h3 className={s.busName}>{nameOf(v)}</h3>
                  {line ? <p className={s.busSpec}>{line}</p> : null}
                  <dl className={s.busMeta}>
                    <div>
                      <dt>{t("capacityLabel")}</dt>
                      <dd>{t.rich("capacity", { ...RICH, n: String(v.capacity) })}</dd>
                    </div>
                  </dl>
                  <Link href={QUOTE_ANCHOR} className={`${h.btnGhost} ${h.btnBlock} ${h.btnSm} ${s.busCta}`}>
                    {t("cta")}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>

        <p className={s.fleetDisc}>{t("disc")}</p>
      </div>
    </section>
  );
}
