/**
 * 섹션 1 — 히어로 (목업 variant-08 .hero): 좌 5초 캐러셀 3장 + 우 견적 위젯. 서버 컴포넌트.
 *
 * 카피는 messages/ko.json home.hero.* — 목업 슬라이드 문구를 옮기되 실증 불가 수치("13년"·"4,800+"·"운행 경력")가
 * 든 문장·팩트 블록·스탯 블록은 뺐다(P2-4 보고서 §제거 목록). verbatim(bookingNotice)은 원장에서 가져와 모달 법정 묶음(legal)으로만 내린다 —
 * 위젯 하단의 결제 안내·verbatim 두 줄은 사장님 요청 7(2026-10-10 · T2-2)로 걷었다(모달 제출 위·완료 화면에만 남는다).
 * 위젯 선택지는 LOCATION_CODES(28) 전부 — 공항 / 16개 시도 / 대표 노선 도시 세 그룹(공항 그룹명은 사장님 요청 10 으로 '공항' 한 단어), 라벨은 locationLabel(code, locale)
 * (ko 는 locationLabelKo 그대로, en 은 PLACES.nameEn · REGION_LABELS_EN — P2-6). 값은 언제나 canonical code 다.
 * verbatim 은 localizeVerbatim — ko 는 원장 문자열 그 자체, en 은 컨트롤러 확정 영문.
 *
 * P3-8 — 위젯이 곧 접수 경로다(간편 견적 모달). 모달의 법정 문구를 **여기서** 원장에서 읽어 props 로 내린다
 * (옛 /quote 페이지가 하던 일): 개인정보 수집·이용 4대 고지 + 보유 기간 요약(PRIVACY_NOTICE — 마케팅 동의 라벨은 내리지 않는다) · 청약철회 고지 노드
 * (<WithdrawalNotice/>) · 청약철회 제한 확인 라벨 · verbatim · 예약·상담 전화 · Turnstile 사이트키·action.
 * **폼 토큰은 내리지 않는다** — 홈은 ISR 이라 구운 토큰이 만료된다. 모달이 열릴 때 서버액션(actions/quote-form-token.ts)으로 받는다.
 * 개인정보는 props 로 흐르지 않는다(정적 문구뿐 — P3-5 리뷰 N-2).
 */
import { getLocale, getTranslations } from "next-intl/server";

import { WithdrawalNotice } from "@/components/quote/WithdrawalNotice";
import { LOCATION_CODES, REGIONS, locationLabel, type LocationCode } from "@/lib/codes";
import { consultPhone } from "@/lib/contact-phone";
import { TURNSTILE_ACTION } from "@/lib/guard/turnstile";
import { koLang, ledgerUi, localizeVerbatim } from "@/lib/i18n/ledger-ui";
import { LEGAL_LINKS, PRIVACY_NOTICE, VERBATIM } from "@/lib/legal/disclosures";

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
  const [t, tMeta, locale] = await Promise.all([getTranslations("home.hero"), getTranslations("home.meta"), getLocale()]);
  const ui = ledgerUi(locale);

  // 슬라이드 제목은 전부 h2(P7-4 · 브리프 §3) — 예전에는 1번 슬라이드 제목이 h1 이라 2·3번이 보이는 동안(대부분의 시간) 페이지에 h1 이 없었다.
  // 페이지 h1 은 아래 섹션 맨 앞에 하나(화면에서만 숨김) — 문구는 홈 메타 제목과 같은 확정 카피(home.meta.title)라 새 문구가 없다.
  const slides: HeroSlide[] = SLIDES.map(({ key, image }, i) => {
    const title = t(`slides.${key}.title`);
    const chips = t.raw(`slides.${key}.chips`) as string[];
    const chipsOn = Number(t.raw(`slides.${key}.chipsOn`)) || 0;
    return {
      key,
      image,
      ariaLabel: t("slideLabel", { n: String(i + 1), total: String(SLIDES.length), title }),
      dotLabel: t("dotLabel", { n: String(i + 1), title }),
      // 태그는 세 슬라이드 모두 같은 테두리 모양 — 공항 슬라이드만 골드 배경(.tag)이던 것을 사장님 요청 10(2026-10-10)으로 없앴다.
      content: (
        <>
          <p className={s.tagLine}>{t(`slides.${key}.tag`)}</p>
          <h2 className={s.heading}>{t.rich(`slides.${key}.heading`, RICH)}</h2>
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

  const bookingNotice = localizeVerbatim(locale, VERBATIM.bookingNotice);

  return (
    <section className={s.hero} aria-label={t("sectionLabel")} data-section="hero">
      <h1 className={s.srOnly}>{tMeta("title", { brand: ui.brand })}</h1>
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
            pause: t("pause"),
            play: t("play"),
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
            returnDate: t("widget.returnDate"),
            pax: t("widget.pax"),
            cta: t("widget.cta"),
          }}
          groups={groups}
          defaults={{ origin: AIRPORT_CODE, dest: "SEL" }}
          locale={locale}
          legal={{
            // 제목·체크박스 라벨은 ledgerUi(ko 는 PRIVACY_NOTICE 그대로, en 은 컨트롤러 확정 영문). 4대 고지 본문은 원장 한국어 그대로 —
            // en 에서는 본문에 lang="ko"(bodyLang). P2-6 브리프 §3.
            consent: {
              title: ui.headings.privacyNotice,
              purpose: PRIVACY_NOTICE.purpose,
              itemsLine: PRIVACY_NOTICE.itemsLine,
              retention: PRIVACY_NOTICE.retention,
              // P7-3: 접힌 줄에 강조해 보이는 보유 기간 요약(중요한 내용 — 시행령 §17③3호). 전문(retention)은 "자세히 보기" 안.
              retentionSummary: PRIVACY_NOTICE.retentionSummary,
              refusal: PRIVACY_NOTICE.refusal,
              consentLabel: ui.consent.privacy,
              publicFeedNotice: PRIVACY_NOTICE.publicFeedNotice,
              privacyHref: LEGAL_LINKS.privacy,
              // P7-3 독립 리뷰 P2-6②: en 의 접힌 줄은 원장 영문 요약(컨트롤러 작성 · 서명). ko 는 null — 접힌 줄도 원장 한국어.
              summaryEn: locale === "en" ? PRIVACY_NOTICE.summaryEn : null,
              // P2-6①: 접힌 카드 안내 — 한국어 원문이 "View details" 안에 있다고 말하는 문안(en 전용 · ko null). 다른 화면은 officialNotice 그대로.
              officialNotice: ui.officialNoticeCollapsed,
              bodyLang: koLang(locale),
            },
            withdrawalNotice: <WithdrawalNotice />,
            // 청약철회 제한 확인 라벨 — ko 는 원장 WITHDRAWAL.consentLabel, en 은 원장 WITHDRAWAL.consentLabelEn(P1-7).
            withdrawalConsentLabel: ui.consent.withdrawal,
            bookingNotice,
            // 예약·상담 전화(P1-7) — ko 010-…, en +82 …, 링크는 E.164.
            tel: consultPhone(locale),
          }}
          turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
          turnstileAction={TURNSTILE_ACTION}
        />
      </div>
    </section>
  );
}
