/**
 * 섹션 1 — 히어로 (목업 variant-08 .hero): 좌 5초 캐러셀 3장 + 우 견적 위젯. 서버 컴포넌트.
 *
 * 카피는 messages/ko.json home.hero.* — 목업 슬라이드 문구를 옮기되 실증 불가 수치("13년"·"4,800+"·"운행 경력")가
 * 든 문장·팩트 블록·스탯 블록은 뺐다(P2-4 보고서 §제거 목록). verbatim(bookingNotice)만 원장에서 가져와 위젯에 props 로 내린다.
 * 위젯 선택지는 LOCATION_CODES(28) 전부 — 공항 / 16개 시도 / 대표 노선 도시 세 그룹, 라벨은 locationLabel(code, locale)
 * (ko 는 locationLabelKo 그대로, en 은 PLACES.nameEn · REGION_LABELS_EN — P2-6). 값은 언제나 canonical code 다.
 * verbatim 은 localizeVerbatim — ko 는 원장 문자열 그 자체, en 은 컨트롤러 확정 영문.
 */
import { getLocale, getTranslations } from "next-intl/server";

import { LOCATION_CODES, REGIONS, locationLabel, type LocationCode } from "@/lib/codes";
import { localizeVerbatim } from "@/lib/i18n/ledger-ui";
import { VERBATIM } from "@/lib/legal/disclosures";

import h from "./home.module.css";
import s from "./Hero.module.css";
import { HeroCarousel, type HeroSlide } from "./HeroCarousel";
import { QuoteWidget, type QuoteGroup } from "./QuoteWidget";
import { RICH } from "./rich";

/** 목업 슬라이드 순서·사진 (assets/bus-05 · bus-01 · bus-03 → public/hero). */
const SLIDES = [
  { key: "airport", image: "/hero/bus-05.jpg" },
  { key: "nationwide", image: "/hero/bus-01.jpg" },
  { key: "trust", image: "/hero/bus-03.jpg" },
] as const;

const AIRPORT_CODE: LocationCode = "ICN";

export async function Hero() {
  const [t, locale] = await Promise.all([getTranslations("home.hero"), getLocale()]);

  const slides: HeroSlide[] = SLIDES.map(({ key, image }, i) => {
    const title = t(`slides.${key}.title`);
    const chips = t.raw(`slides.${key}.chips`) as string[];
    const chipsOn = Number(t.raw(`slides.${key}.chipsOn`)) || 0;
    const Heading = i === 0 ? "h1" : "h2";
    return {
      key,
      image,
      ariaLabel: t("slideLabel", { n: String(i + 1), total: String(SLIDES.length), title }),
      dotLabel: t("dotLabel", { n: String(i + 1), title }),
      content: (
        <>
          <p className={key === "airport" ? s.tag : s.tagLine}>{t(`slides.${key}.tag`)}</p>
          <Heading className={s.heading}>{t.rich(`slides.${key}.heading`, RICH)}</Heading>
          <p className={s.body}>{t.rich(`slides.${key}.body`, RICH)}</p>
          {chips.length > 0 ? (
            <ul className={s.chips}>
              {chips.map((chip, j) => (
                <li key={chip} className={j < chipsOn ? s.chipOn : s.chip}>
                  {chip}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ),
    };
  });

  const regionSet = new Set<string>(REGIONS);
  const option = (code: LocationCode) => ({ value: code, label: locationLabel(code, locale) });
  const groups: QuoteGroup[] = [
    { label: t("widget.groupAirport"), options: [option(AIRPORT_CODE)] },
    { label: t("widget.groupRegions"), options: REGIONS.filter((r) => r !== AIRPORT_CODE).map(option) },
    { label: t("widget.groupCities"), options: LOCATION_CODES.filter((c) => !regionSet.has(c)).map(option) },
  ];

  return (
    <section className={s.hero} aria-label={t("sectionLabel")} data-section="hero">
      <div className={`${h.wrap} ${s.grid}`}>
        <HeroCarousel
          slides={slides}
          labels={{
            carousel: t("carouselLabel"),
            role: t("carouselRole"),
            slideRole: t("slideRole"),
            prev: t("prev"),
            next: t("next"),
            dots: t("dotsLabel"),
          }}
        />
        <QuoteWidget
          labels={{
            widget: t("widget.label"),
            title: t("widget.title"),
            sub: t("widget.sub"),
            origin: t("widget.origin"),
            dest: t("widget.dest"),
            date: t("widget.date"),
            pax: t("widget.pax"),
            cta: t("widget.cta"),
          }}
          groups={groups}
          defaults={{ origin: AIRPORT_CODE, dest: "SEL" }}
          airNote={t.rich("widget.airNote", RICH)}
          paymentNote={t("widget.note")}
          bookingNotice={localizeVerbatim(locale, VERBATIM.bookingNotice)}
        />
      </div>
    </section>
  );
}
