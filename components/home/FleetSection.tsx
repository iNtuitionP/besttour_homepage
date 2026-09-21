/**
 * 섹션 6 — 차량 (#fleet, 목업 variant-08 §04). 서버 컴포넌트. **가격 없음.**
 * 카드 = 이름(vehicles.name_ko) · 정원(capacity) · 한 줄(ko.json home.fleet.lines[slug], 목업 .bus__spec) · 견적 CTA(/quote?vehicle=).
 * 옛 사이트 차량소개 원문·용도·옵션 표는 P6-3 /fleet 몫. 사진은 목업의 slug↔사진 대응 그대로(public/hero).
 * 차량이 0대면 섹션을 숨긴다.
 */
import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import type { Vehicle } from "@/lib/types";

import h from "./home.module.css";
import s from "./Sections.module.css";
import { quoteHref } from "./quote-href";
import { RICH } from "./rich";
import { SectionHead } from "./SectionHead";

/** 목업 .fleet 의 카드별 사진 (assets/bus-0N → public/hero/bus-0N). 없는 slug 는 사진 없이 렌더한다. */
const FLEET_IMAGES: Readonly<Record<string, string>> = {
  bus45: "/hero/bus-01.jpg",
  bus35: "/hero/bus-04.jpg",
  limo28: "/hero/bus-03.jpg",
  bus25: "/hero/bus-02.jpg",
  bus16: "/hero/bus-05.jpg",
};

export async function FleetSection({ vehicles }: { vehicles: readonly Vehicle[] }) {
  if (vehicles.length === 0) return null;
  const [t, locale] = await Promise.all([getTranslations("home.fleet"), getLocale()]);
  const lines = t.raw("lines") as Record<string, string | undefined>;
  /** 차량 이름 — DB 행의 로케일 필드(vehicles.name_ko · name_en, 0001 시드). P2-6 */
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
            const image = FLEET_IMAGES[v.slug];
            const line = lines[v.slug];
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
                  <Link href={quoteHref({ vehicle: v.slug })} className={`${h.btnGhost} ${h.btnBlock} ${h.btnSm} ${s.busCta}`}>
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
