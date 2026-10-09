/**
 * P7-3 ② — 간편 견적 모달의 두 동의 블록: **핵심만 보이고, "자세히 보기" 로 전문** (사용자 지시 2026-09-27 · 독립 리뷰 수정 라운드).
 *
 * 법적 제약
 *   - 개인정보: 보유·이용 기간은 **중요한 내용**(개인정보보호법 시행령 §17③3호)이다. 표시 방법은 「개인정보 처리 방법에 관한 고시」
 *     (제2023-12호, 2023-10-16 시행) §4 1호 "글씨의 크기, 색깔, 굵기 또는 밑줄 등을 통하여 그 내용이 명확히 표시되도록 할 것".
 *     구현: 접힌 상태에서도 보이고 · 굵게(800) · 브랜드색 · 별도 줄 · 크게. 크기는 **우리 내부 보수 기준**으로 옛 판(제2020-7호)의
 *     "다른 내용보다 20퍼센트 이상 크게" 를 계속 지킨다(§6 — 카드 안 다른 글자 × 1.2 이상).
 *     접힌 줄(ko) = 수집 목적 · 수집 항목 · 보유 기간(요약 · 강조) · 접수 현황 공개(작은 줄) — 원장 값 그대로(리뷰 P2-1 · P2-2).
 *     접힌 줄(en) = 원장 영문 요약 PRIVACY_NOTICE.summaryEn 같은 네 줄 · lang="ko" 없음(리뷰 P2-6②). 전문은 자세히 보기 안의 한국어 원문 한 벌.
 *   - 청약철회 제한(전자상거래법 §17⑥): 접힌 상태에 2단계 → 날짜 기준(작은 줄, 리뷰 P2-7) → 적용 범위(본문 크기 · 본문색, 리뷰 P2-3)
 *     → 제한 한 줄(강조). en 은 원장 영문 요약 WITHDRAWAL.summaryEn 같은 순서(영문 표지는 `-en` — 리뷰 P2-9).
 *     en 의 자세히 보기 안: 구속력 있는 한국어 한 벌(2단계 → 날짜 기준 → 범위 → 원문) lang="ko" — 영문 번역본 뒤 · 원문 바로 앞.
 *   - en 의 두 접힌 카드 맨 위 안내는 officialNoticeCollapsed("The Korean original under “View details” …" — 리뷰 P2-6①).
 *   - 체크박스·라벨은 그대로 · 기본 해제 · 필수 · 펼치지 않아도 체크할 수 있다. verbatim 은 접히지 않는다.
 *   - 클라이언트 파일에 법정 문구 0 — 서버(Hero · WithdrawalNotice)가 원장에서 읽어 내린다.
 *
 * vitest 는 node 환경이다(DOM 패키지 없음) — 첫 화면을 renderToStaticMarkup 으로 본다. 토글의 "누르면 펼쳐진다" 는
 * ① MoreToggle 을 접힘/펼침(defaultOpen) 두 상태로 렌더하고 ② 두 블록의 전문이 그 토글의 본문 안에만 있음을 보여 잇고,
 * 실제 클릭은 브라우저 실측(보고서)이 본다.
 *
 * 주의: tests/ 아래라 세 게이트(check-no-pricing · check-legal-disclosures · check-temp-values)의 검사 대상이다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/actions/reservation", () => ({ submitReservation: vi.fn() }));
vi.mock("@/actions/quote-form-token", () => ({ requestQuoteFormToken: vi.fn(async () => null) }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("next/script", () => ({ default: () => null }));

/** 서버 컴포넌트 WithdrawalNotice 의 getTranslations/getLocale — 로케일을 테스트가 바꿔 끼운다(실제 카탈로그로 번역). */
const intl = vi.hoisted(() => ({ locale: "ko" as "ko" | "en" }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const koMessages = (await import("../messages/ko.json")).default;
  const enMessages = (await import("../messages/en.json")).default;
  return {
    getLocale: async () => intl.locale,
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: intl.locale, messages: (intl.locale === "en" ? enMessages : koMessages) as never, namespace: namespace as never }),
  };
});

import { ConsentBlock, type ConsentText } from "@/components/quote/ConsentBlock";
import { MoreToggle } from "@/components/quote/MoreToggle";
import { QuickQuoteForm } from "@/components/quote/QuickQuoteModal";
import { WithdrawalNotice } from "@/components/quote/WithdrawalNotice";
import { consultPhone } from "@/lib/contact-phone";
import { LEDGER_UI_KO, ledgerUi } from "@/lib/i18n/ledger-ui";
import { CANCELLATION, LEGAL_LINKS, PAYMENT, PRIVACY_NOTICE, QUOTE_BASIS, VERBATIM, WITHDRAWAL } from "@/lib/legal/disclosures";

import { findElements, findText, findUnmarkedHangul, HANGUL, type FoundText } from "./helpers/hangul-html";
import { stripComments } from "./helpers/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const ko = JSON.parse(read("messages/ko.json")) as { quote: Record<string, Record<string, string>> };
const en = JSON.parse(read("messages/en.json")) as { quote: Record<string, Record<string, string>> };

const QUOTE_DIR = "components/quote";
const CONSENT_FILE = `${QUOTE_DIR}/ConsentBlock.tsx`;
const TOGGLE_FILE = `${QUOTE_DIR}/MoreToggle.tsx`;
const WITHDRAWAL_FILE = `${QUOTE_DIR}/WithdrawalNotice.tsx`;
const MODAL_FILE = `${QUOTE_DIR}/QuickQuoteModal.tsx`;
const HERO_FILE = "components/home/Hero.tsx";
const QUOTE_CSS = `${QUOTE_DIR}/quote.module.css`;
/** 클라이언트 번들에 들어가는 견적 모달 파일 — 모달이 import 하는 것 전부(서버 WithdrawalNotice · 서버 전용 form-token 은 빼고). */
const QUOTE_CLIENT_TREE = [
  MODAL_FILE,
  CONSENT_FILE,
  TOGGLE_FILE,
  `${QUOTE_DIR}/FieldBits.tsx`,
  `${QUOTE_DIR}/TurnstileWidget.tsx`,
  `${QUOTE_DIR}/fields.ts`,
  `${QUOTE_DIR}/quick-quote.ts`,
  `${QUOTE_DIR}/submit-gate.ts`,
  "components/legal/OfficialKoreanNotice.tsx",
];

// ── 렌더 도우미 ──────────────────────────────────────────────────────────────
function render(node: ReactNode, locale: "ko" | "en"): string {
  const providerProps = { locale, messages: locale === "en" ? en : ko, timeZone: "Asia/Seoul" } as unknown as Parameters<typeof NextIntlClientProvider>[0];
  return renderToStaticMarkup(createElement(NextIntlClientProvider, providerProps, node));
}
async function withdrawalHtml(locale: "ko" | "en"): Promise<{ node: ReactNode; html: string }> {
  intl.locale = locale;
  const node = await WithdrawalNotice();
  return { node, html: render(node, locale) };
}
const hiddenAncestor = (o: { ancestors: FoundText["ancestors"] }) => o.ancestors.some((a) => a.attrs.has("hidden"));
const koAncestor = (o: { ancestors: FoundText["ancestors"] }) => o.ancestors.some((a) => (a.attrs.get("lang") ?? "").toLowerCase().startsWith("ko"));
const inRegion = (o: { ancestors: FoundText["ancestors"] }, id: string) => o.ancestors.some((a) => a.attrs.get("id") === id);
/** 원장 영문 요약(청약철회) — en 의 접힌 블록에 이 순서로 보인다. */
const SUMMARY_EN: readonly string[] = [
  ...WITHDRAWAL.summaryEn.tiers,
  WITHDRAWAL.summaryEn.referenceTime,
  WITHDRAWAL.summaryEn.scope,
  WITHDRAWAL.summaryEn.restriction,
];
/** 원장 영문 요약(개인정보) — en 의 접힌 카드에 이 순서로 보인다. */
const PRIVACY_EN: readonly string[] = [
  PRIVACY_NOTICE.summaryEn.purpose,
  PRIVACY_NOTICE.summaryEn.items,
  PRIVACY_NOTICE.summaryEn.retention,
  PRIVACY_NOTICE.summaryEn.publicFeed,
];
/** 한국어 접힌 줄(개인정보) — ko 의 접힌 카드에 이 순서로 보인다. */
const PRIVACY_KO_KEY: readonly string[] = [
  PRIVACY_NOTICE.purpose,
  PRIVACY_NOTICE.itemsLine,
  PRIVACY_NOTICE.retentionSummary,
  PRIVACY_NOTICE.publicFeedNotice,
];
const KO_TIERS: readonly string[] = CANCELLATION.tiers.flatMap((t) => [t.when, t.label]);
const decodeText = (s: string) => s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
/** 텍스트 노드 값이 정확히 `s` 인 곳들(부분 일치는 빼고 — 원장 값 "그대로" 를 본다). */
const exact = (html: string, s: string) => findText(html, s).filter((o) => o.where === "text" && o.value === s);
/** 원장 문장이 들어 있는 텍스트 노드 전부(전문 문단 안 포함). */
const containing = (html: string, s: string) => findText(html, s).filter((o) => o.where === "text");
const stripTags = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "").trim();
const inOrder = (html: string, strings: readonly string[]) => {
  const text = decodeText(html);
  const at = strings.map((s) => text.indexOf(s));
  return at.every((i) => i >= 0) && at.every((i, k) => k === 0 || at[k - 1] < i);
};

function toggles(html: string) {
  return findElements(html, (tag, a) => tag === "button" && a.has("aria-expanded")).map((b) => {
    const controls = b.attrs.get("aria-controls") ?? "";
    const region = findElements(html, (_t, a) => a.get("id") === controls);
    return { button: b, controls, region };
  });
}
function buttonText(html: string, testId: string): string {
  const m = new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</button>`).exec(html);
  return m ? stripTags(m[1]) : "";
}

// ── 픽스처 — Hero(서버)가 원장에서 만들어 내리는 것과 같은 모양 ──────────────────
const CONSENT_KO: ConsentText = {
  title: LEDGER_UI_KO.headings.privacyNotice,
  purpose: PRIVACY_NOTICE.purpose,
  itemsLine: PRIVACY_NOTICE.itemsLine,
  retention: PRIVACY_NOTICE.retention,
  retentionSummary: PRIVACY_NOTICE.retentionSummary,
  refusal: PRIVACY_NOTICE.refusal,
  consentLabel: LEDGER_UI_KO.consent.privacy,
  publicFeedNotice: PRIVACY_NOTICE.publicFeedNotice,
  privacyHref: LEGAL_LINKS.privacy,
  summaryEn: null,
  officialNotice: null,
};
const enUi = ledgerUi("en");
const COLLAPSED_NOTICE = enUi.officialNoticeCollapsed;
const CONSENT_EN: ConsentText = {
  ...CONSENT_KO,
  title: enUi.headings.privacyNotice,
  consentLabel: enUi.consent.privacy,
  summaryEn: PRIVACY_NOTICE.summaryEn,
  officialNotice: COLLAPSED_NOTICE,
  bodyLang: "ko",
};
const consentHtml = (text: ConsentText, locale: "ko" | "en") =>
  render(createElement(ConsentBlock, { text, privacyConsent: false, onPrivacyChange: () => {}, idPrefix: "t" }), locale);

// =============================================================================
// 1. 개인정보 동의(ko) — 접힌 상태
// =============================================================================
describe("1. 개인정보 동의(ko) — 접혀서 시작하고, 수집 목적 · 수집 항목 · 보유 기간(강조) · 접수 현황 공개만 보인다", () => {
  const html = consentHtml(CONSENT_KO, "ko");

  test("토글 하나 — button · aria-expanded=false · aria-controls 가 hidden 본문을 가리킨다 · 문구는 messages", () => {
    const t = toggles(html);
    expect(t).toHaveLength(1);
    expect(t[0].button.attrs.get("type")).toBe("button");
    expect(t[0].button.attrs.get("aria-expanded")).toBe("false");
    expect(t[0].controls).not.toBe("");
    expect(t[0].region).toHaveLength(1);
    expect(t[0].region[0].attrs.has("hidden")).toBe(true);
    expect(buttonText(html, "consent-more-toggle")).toBe(ko.quote.more.show);
    // 모달에 토글이 둘이다 — 어느 블록의 것인지 제목으로 설명한다
    expect(t[0].button.attrs.get("aria-describedby")).toBe("t-consent-title");
    expect(findElements(html, (tag, a) => tag === "h3" && a.get("id") === "t-consent-title")).toHaveLength(1);
  });

  test("접힌 줄 — 수집 목적 → 수집 항목 → 보유 기간 요약 → 접수 현황 공개: 원장 값 그대로 · 보인다 · 한 번만(전문에서 되풀이 0) · 순서", () => {
    for (const s of PRIVACY_KO_KEY) {
      const hits = exact(html, s);
      expect(hits, s.slice(0, 16)).toHaveLength(1);
      expect(hiddenAncestor(hits[0]), s.slice(0, 16)).toBe(false);
      expect(containing(html, s), s.slice(0, 16)).toHaveLength(1);
    }
    expect(inOrder(html, PRIVACY_KO_KEY)).toBe(true);
    // 줄마다 라벨(messages quote.consent) — 목적은 항목 위에 있다(리뷰 P2-1)
    expect(html).toMatch(new RegExp(`<dt>${ko.quote.consent.purpose}</dt><dd[^>]*>${escapeRe(PRIVACY_NOTICE.purpose)}</dd>`));
    expect(html).toMatch(new RegExp(`<dt>${ko.quote.consent.items}</dt><dd[^>]*>${escapeRe(PRIVACY_NOTICE.itemsLine)}</dd>`));
    expect(html).toMatch(new RegExp(`<dt>${ko.quote.consent.retention}</dt><dd[^>]*>${escapeRe(PRIVACY_NOTICE.retentionSummary)}</dd>`));
  });

  test("보유 기간 요약은 강조 줄(data-testid=consent-retention) 안 · 접수 현황 공개는 보이는 작은 줄(consent-public-feed — 리뷰 P2-2)", () => {
    expect(exact(html, PRIVACY_NOTICE.retentionSummary)[0].ancestors.some((a) => a.attrs.get("data-testid") === "consent-retention")).toBe(true);
    const feed = exact(html, PRIVACY_NOTICE.publicFeedNotice)[0];
    expect(feed.ancestors[0].attrs.get("data-testid")).toBe("consent-public-feed");
    expect(feed.ancestors[0].tag).toBe("p");
  });

  test("자세히 보기 안: 보유 기간 전문 · 거부 안내 · 처리방침 링크 — 접힌 상태에서 hidden", () => {
    const [{ controls }] = toggles(html);
    for (const s of [PRIVACY_NOTICE.retention, PRIVACY_NOTICE.refusal]) {
      const hits = containing(html, s);
      expect(hits, s.slice(0, 16)).toHaveLength(1);
      expect(hiddenAncestor(hits[0]), s.slice(0, 16)).toBe(true);
      expect(inRegion(hits[0], controls), s.slice(0, 16)).toBe(true);
    }
    const link = findElements(html, (tag, a) => tag === "a" && a.get("href") === LEGAL_LINKS.privacy);
    expect(link).toHaveLength(1);
    expect(link[0].ancestors.some((a) => a.attrs.get("id") === controls)).toBe(true);
  });

  test("ko 마크업 — lang 속성 0 · 안내 0 · 영문 요약 0", () => {
    expect(findElements(html, (_t, a) => a.has("lang"))).toHaveLength(0);
    expect(html).not.toContain("official-korean-notice");
    for (const s of PRIVACY_EN) expect(decodeText(html).includes(s), s.slice(0, 24)).toBe(false);
  });

  test("체크박스 — 하나 · 기본 해제 · 비활성 아님 · 토글 본문 밖(펼치지 않아도 체크할 수 있다) · 라벨은 원장 그대로", () => {
    const boxes = findElements(html, (tag, a) => tag === "input" && a.get("type") === "checkbox");
    expect(boxes).toHaveLength(1);
    expect(boxes[0].attrs.get("name")).toBe("privacyConsent");
    expect(boxes[0].attrs.has("checked")).toBe(false);
    expect(boxes[0].attrs.has("disabled")).toBe(false);
    expect(hiddenAncestor(boxes[0])).toBe(false);
    const label = exact(html, PRIVACY_NOTICE.consentLabel);
    expect(label).toHaveLength(1);
    expect(hiddenAncestor(label[0])).toBe(false);
  });
});

// =============================================================================
// 1-b. 개인정보 동의(en) — 접힌 줄은 원장 영문 요약, 자세히 보기 안은 한국어 원문 한 벌
// =============================================================================
describe("1-b. 개인정보 동의(en) — 접힌 줄 = PRIVACY_NOTICE.summaryEn(lang=\"ko\" 없음) · 자세히 보기 = 한국어 원문 한 벌(lang=\"ko\")", () => {
  const html = consentHtml(CONSENT_EN, "en");

  test("접힌 줄 — summaryEn 네 줄(목적 → 항목 → 보유 기간 → 공개)이 바이트 그대로 · 보인다 · 순서 · 조상에 lang=\"ko\" 없음", () => {
    for (const s of PRIVACY_EN) {
      const hits = exact(html, s);
      expect(hits, s.slice(0, 24)).toHaveLength(1);
      expect(hiddenAncestor(hits[0]), s.slice(0, 24)).toBe(false);
      expect(koAncestor(hits[0]), s.slice(0, 24)).toBe(false);
    }
    expect(inOrder(html, PRIVACY_EN)).toBe(true);
  });

  test("라벨은 영문 · 보유 기간은 같은 강조 줄(consent-retention) · 공개 고지는 작은 줄(consent-public-feed)", () => {
    for (const k of ["purpose", "items", "retention"]) expect(html, k).toContain(`<dt>${en.quote.consent[k]}</dt>`);
    expect(exact(html, PRIVACY_NOTICE.summaryEn.retention)[0].ancestors.some((a) => a.attrs.get("data-testid") === "consent-retention")).toBe(true);
    expect(exact(html, PRIVACY_NOTICE.summaryEn.publicFeed)[0].ancestors[0].attrs.get("data-testid")).toBe("consent-public-feed");
    expect(buttonText(html, "consent-more-toggle")).toBe(en.quote.more.show);
  });

  test("맨 위 안내 = officialNoticeCollapsed('View details' 안의 한국어 원문이 정본) · 접힌 상태에서 보인다 · 'The Korean text below' 없음(리뷰 P2-6①)", () => {
    const lead = exact(html, COLLAPSED_NOTICE?.lead ?? "");
    expect(lead).toHaveLength(1);
    expect(hiddenAncestor(lead[0])).toBe(false);
    expect(decodeText(html)).toContain(COLLAPSED_NOTICE?.body ?? "∅");
    expect(decodeText(html)).not.toContain("The Korean text below");
  });

  test("자세히 보기 안 — 한국어 원문 한 벌(목적 · 항목 · 보유 기간 전문 · 거부 안내 · 접수 현황 공개)이 lang=\"ko\" · hidden · 처리방침 링크", () => {
    const [{ controls }] = toggles(html);
    for (const s of [PRIVACY_NOTICE.purpose, PRIVACY_NOTICE.itemsLine, PRIVACY_NOTICE.retention, PRIVACY_NOTICE.refusal, PRIVACY_NOTICE.publicFeedNotice]) {
      const hits = containing(html, s);
      expect(hits, s.slice(0, 16)).toHaveLength(1);
      expect(inRegion(hits[0], controls), s.slice(0, 16)).toBe(true);
      expect(hiddenAncestor(hits[0]), s.slice(0, 16)).toBe(true);
      expect(koAncestor(hits[0]), s.slice(0, 16)).toBe(true);
    }
    const link = findElements(html, (tag, a) => tag === "a" && a.get("href") === LEGAL_LINKS.privacy);
    expect(link).toHaveLength(1);
    expect(link[0].ancestors.some((a) => a.attrs.get("id") === controls)).toBe(true);
  });

  test("lang=ko 밖 한글 0 · 한국어 요약(retentionSummary)은 en 에 싣지 않는다(전문이 자세히 보기에 있다)", () => {
    expect(findUnmarkedHangul(html)).toEqual([]);
    expect(containing(html, PRIVACY_NOTICE.retentionSummary)).toHaveLength(0);
  });
});

// =============================================================================
// 2. 토글 — 접힘 / 펼침
// =============================================================================
describe("2. MoreToggle — 누르기 전 접힘, 펼치면 본문이 보이고 문구가 '접기'", () => {
  const body = createElement("p", { "data-x": "body" }, "BODY");

  test.for([["ko"], ["en"]] as const)("%s — 접힘: aria-expanded=false · 본문 hidden · '자세히 보기'", ([locale]) => {
    const html = render(createElement(MoreToggle, { testId: "m", describedBy: "d" }, body), locale);
    const [t] = toggles(html);
    expect(t.button.attrs.get("aria-expanded")).toBe("false");
    expect(t.region[0].attrs.has("hidden")).toBe(true);
    expect(buttonText(html, "m-toggle")).toBe((locale === "en" ? en : ko).quote.more.show);
    expect(findElements(html, (_t, a) => a.get("data-x") === "body")[0].ancestors[0].attrs.get("id")).toBe(t.controls);
  });

  test.for([["ko"], ["en"]] as const)("%s — 펼침(defaultOpen): aria-expanded=true · hidden 없음 · '접기'", ([locale]) => {
    const html = render(createElement(MoreToggle, { testId: "m", describedBy: "d", defaultOpen: true }, body), locale);
    const [t] = toggles(html);
    expect(t.button.attrs.get("aria-expanded")).toBe("true");
    expect(t.region[0].attrs.has("hidden")).toBe(false);
    expect(buttonText(html, "m-toggle")).toBe((locale === "en" ? en : ko).quote.more.hide);
  });

  test("누르면 상태가 뒤집힌다(소스) · 펼침은 aria-expanded 와 hidden 이 같은 상태에서 나온다", () => {
    const src = codeOf(TOGGLE_FILE);
    expect(src).toMatch(/onClick=\{\(\) => setOpen\(\(v\) => !v\)\}/);
    expect(src).toMatch(/aria-expanded=\{open\}/);
    expect(src).toMatch(/aria-controls=\{bodyId\}/);
    expect(src).toMatch(/hidden=\{!open\}/);
    expect(src).toMatch(/useState\(defaultOpen\)/);
  });
});

// =============================================================================
// 3. 청약철회 블록 — 접힌 상태 (ko)
// =============================================================================
describe("3. 청약철회 · 취소 규정(ko) — 핵심(2단계 → 날짜 기준 → 적용 범위 → 제한 한 줄)만 보이고 전문은 자세히 보기 안", async () => {
  const { html } = await withdrawalHtml("ko");

  test("취소·환불 2단계 — 언제 · 환불이 원장 값 그대로 · 보인다 · 한 번만", () => {
    for (const s of KO_TIERS) {
      const hits = exact(html, s);
      expect(hits, s).toHaveLength(1);
      expect(hiddenAncestor(hits[0]), s).toBe(false);
    }
  });

  test("날짜 기준(referenceTime)이 2단계 목록 **바로 뒤** · 적용 범위 **바로 앞** · 보인다 · 원장 그대로(리뷰 P2-7)", () => {
    const hits = exact(html, CANCELLATION.referenceTime);
    expect(hits).toHaveLength(1);
    expect(hiddenAncestor(hits[0])).toBe(false);
    expect(hits[0].ancestors[0].attrs.get("data-legal")).toBe("cancellation-reference");
    expect(html).toMatch(/<\/ul><p[^>]*data-legal="cancellation-reference"/);
    const after = html.slice(html.indexOf(CANCELLATION.referenceTime) + CANCELLATION.referenceTime.length);
    expect(after).toMatch(/^<\/p><p[^>]*data-legal="cancellation-scope"/);
  });

  test("적용 범위(scope) — 표 묶음(2단계 → 날짜 기준) 바로 아래 · 보인다 · 원장 그대로", () => {
    const hits = exact(html, CANCELLATION.scope);
    expect(hits).toHaveLength(1);
    expect(hiddenAncestor(hits[0])).toBe(false);
    expect(hits[0].ancestors[0].attrs.get("data-legal")).toBe("cancellation-scope");
    expect(inOrder(html, [CANCELLATION.tiers[0].when, CANCELLATION.tiers[1].label, CANCELLATION.referenceTime, CANCELLATION.scope, WITHDRAWAL.smsLine])).toBe(true);
  });

  test("청약철회 제한 한 줄(WITHDRAWAL.smsLine) — 보인다 · 원장 그대로 · 강조 요소", () => {
    const hits = exact(html, WITHDRAWAL.smsLine);
    expect(hits).toHaveLength(1);
    expect(hiddenAncestor(hits[0])).toBe(false);
    expect(hits[0].ancestors[0].attrs.get("data-legal")).toBe("withdrawal-summary");
  });

  test("자세히 보기 안: 계약금 안내 · 대금 지급 · 산정 기준 · 청약철회 제한 고지 전문 — hidden · 날짜 기준은 되풀이하지 않는다", () => {
    const t = toggles(html);
    expect(t).toHaveLength(1);
    expect(t[0].button.attrs.get("aria-expanded")).toBe("false");
    expect(t[0].button.attrs.get("aria-describedby")).toBe("quote-withdrawal-title");
    expect(t[0].region[0].attrs.has("hidden")).toBe(true);
    expect(buttonText(html, "withdrawal-more-toggle")).toBe(ko.quote.more.show);
    for (const s of [CANCELLATION.depositNote, PAYMENT.line, QUOTE_BASIS.line, WITHDRAWAL.notice]) {
      const hits = containing(html, s);
      expect(hits.length, s.slice(0, 16)).toBeGreaterThan(0);
      for (const h of hits) expect(inRegion(h, t[0].controls), s.slice(0, 16)).toBe(true);
    }
    const law = findElements(html, (_t, a) => a.get("data-legal") === "withdrawal-restriction");
    expect(law).toHaveLength(1);
    expect(hiddenAncestor(law[0])).toBe(true);
    // 날짜 기준 · 2단계 · 범위는 접힌 자리에만(텍스트 노드 일치 — 부분 일치는 원문 문단 "운행일 3일 전까지는 …" 에도 걸린다)
    expect(findElements(html, (tag) => tag === "ul")).toHaveLength(1);
    for (const s of [...KO_TIERS, CANCELLATION.referenceTime, CANCELLATION.scope]) {
      const hits = exact(html, s);
      expect(hits, s.slice(0, 16)).toHaveLength(1);
      expect(inRegion(hits[0], t[0].controls), s.slice(0, 16)).toBe(false);
    }
  });

  test("ko 마크업 — lang 속성 0 · 영문 번역본 0 · 안내 0 · 영문 요약 0 · `-en` 표지 0", () => {
    expect(findElements(html, (_t, a) => a.has("lang"))).toHaveLength(0);
    expect(html).not.toContain('data-legal="withdrawal-restriction-en"');
    expect(html).not.toContain("official-korean-notice");
    expect(html).not.toMatch(/data-legal="[a-z-]+-en"/);
    for (const s of SUMMARY_EN) expect(decodeText(html).includes(s), s.slice(0, 24)).toBe(false);
  });
});

// =============================================================================
// 4. 청약철회 블록 — en
// =============================================================================
describe("4. 청약철회 · 취소 규정(en) — 접힌 자리는 원장 영문 요약 · 자세히 보기 안에 구속력 있는 한국어 한 벌", async () => {
  const { html: wHtml } = await withdrawalHtml("en");

  test("제목·소제목·토글은 영문 · 안내는 officialNoticeCollapsed(접힌 상태에서 보인다) · 'The Korean text below' 없음 · lang=ko 밖 한글 0", () => {
    expect(wHtml).toContain(en.quote.notice.title);
    expect(wHtml).toContain(en.quote.notice.cancelTitle);
    expect(buttonText(wHtml, "withdrawal-more-toggle")).toBe(en.quote.more.show);
    const notice = findElements(wHtml, (_t, a) => a.get("data-legal") === "official-korean-notice");
    expect(notice).toHaveLength(1);
    expect(hiddenAncestor(notice[0])).toBe(false);
    expect(exact(wHtml, COLLAPSED_NOTICE?.lead ?? "")).toHaveLength(1);
    expect(decodeText(wHtml)).not.toContain("The Korean text below");
    expect(findUnmarkedHangul(wHtml)).toEqual([]);
  });

  test("접힌 자리 — summaryEn(2단계 두 줄 → 날짜 기준 → 범위 → 제한 한 줄)이 바이트 그대로 · 보인다 · lang=\"ko\" 아님 · 순서 · 영문 표지", () => {
    for (const s of SUMMARY_EN) {
      const hits = exact(wHtml, s);
      expect(hits, s.slice(0, 24)).toHaveLength(1);
      expect(hiddenAncestor(hits[0]), s.slice(0, 24)).toBe(false);
      expect(koAncestor(hits[0]), s.slice(0, 24)).toBe(false);
    }
    expect(inOrder(wHtml, SUMMARY_EN)).toBe(true);
    expect(wHtml).toMatch(/<\/ul><p[^>]*data-legal="cancellation-reference-en"/);
    expect(exact(wHtml, WITHDRAWAL.summaryEn.referenceTime)[0].ancestors[0].attrs.get("data-legal")).toBe("cancellation-reference-en");
    expect(exact(wHtml, WITHDRAWAL.summaryEn.scope)[0].ancestors[0].attrs.get("data-legal")).toBe("cancellation-scope-en");
    expect(exact(wHtml, WITHDRAWAL.summaryEn.restriction)[0].ancestors[0].attrs.get("data-legal")).toBe("withdrawal-summary");
  });

  test("한국어 요약(2단계 · 날짜 기준 · 범위 · smsLine)은 접힌 자리에 없다 · 한국어 표지(cancellation-scope)는 자세히 보기 안 하나뿐(리뷰 P2-9)", () => {
    const [t] = toggles(wHtml);
    for (const s of [...KO_TIERS, CANCELLATION.referenceTime, CANCELLATION.scope, WITHDRAWAL.smsLine]) {
      for (const h of containing(wHtml, s)) expect(inRegion(h, t.controls), s.slice(0, 16)).toBe(true);
    }
    const koScope = findElements(wHtml, (_t, a) => a.get("data-legal") === "cancellation-scope");
    expect(koScope).toHaveLength(1);
    expect(koScope[0].ancestors.some((a) => a.attrs.get("id") === t.controls)).toBe(true);
  });

  test("자세히 보기 안 — 구속력 있는 한국어 한 벌(2단계 → 날짜 기준 → 범위 → 원문) lang=\"ko\" · 영문 번역본(lang=en) 뒤 · 원문 **바로 앞**", () => {
    const [t] = toggles(wHtml);
    for (const s of [...KO_TIERS, CANCELLATION.referenceTime, CANCELLATION.scope]) {
      const hits = exact(wHtml, s);
      expect(hits, s.slice(0, 16)).toHaveLength(1);
      expect(inRegion(hits[0], t.controls), s.slice(0, 16)).toBe(true);
      expect(hits[0].ancestors.some((a) => a.attrs.get("lang") === "ko"), s.slice(0, 16)).toBe(true);
    }
    const koTable = findElements(wHtml, (tag, a) => tag === "ul" && a.get("lang") === "ko");
    expect(koTable).toHaveLength(1);
    expect(koTable[0].ancestors.some((a) => a.attrs.get("id") === t.controls)).toBe(true);
    expect(inOrder(wHtml, [WITHDRAWAL.noticeEn, CANCELLATION.tiers[0].when, CANCELLATION.tiers[1].label, CANCELLATION.referenceTime, CANCELLATION.scope, WITHDRAWAL.notice])).toBe(true);
    const afterScope = wHtml.slice(wHtml.indexOf(CANCELLATION.scope) + CANCELLATION.scope.length);
    expect(afterScope).toMatch(/^<\/p><p[^>]*data-legal="withdrawal-restriction"[^>]*lang="ko"|^<\/p><p[^>]*lang="ko"[^>]*data-legal="withdrawal-restriction"/);
    const enLaw = findElements(wHtml, (_t, a) => a.get("data-legal") === "withdrawal-restriction-en");
    expect(enLaw).toHaveLength(1);
    expect(enLaw[0].attrs.get("lang")).toBe("en");
    expect(hiddenAncestor(enLaw[0])).toBe(true);
    const koLaw = findElements(wHtml, (_t, a) => a.get("data-legal") === "withdrawal-restriction");
    expect(koLaw).toHaveLength(1);
    expect(koLaw[0].attrs.get("lang")).toBe("ko");
    expect(hiddenAncestor(koLaw[0])).toBe(true);
  });
});

// =============================================================================
// 5. 모달 전체 — 토글 둘 · 체크박스 둘(기본 해제) · 제출 닫힘 · verbatim 은 접히지 않는다
// =============================================================================
async function modalHtml(locale: "ko" | "en"): Promise<string> {
  const { node } = await withdrawalHtml(locale);
  const ui = ledgerUi(locale);
  return render(
    createElement(QuickQuoteForm, {
      fields: { originCode: "ICN", destinationCode: "SEL", departDate: "2026-10-01", returnDate: "2026-10-03", passengers: "30" },
      placeLabels: { origin: locale === "en" ? "Incheon Airport" : "인천공항", dest: locale === "en" ? "Seoul" : "서울" },
      locale,
      legal: {
        consent: locale === "en" ? CONSENT_EN : CONSENT_KO,
        withdrawalNotice: node,
        withdrawalConsentLabel: ui.consent.withdrawal,
        bookingNotice: locale === "en" ? ui.verbatim.bookingNotice : VERBATIM.bookingNotice,
        tel: consultPhone(locale),
      },
      formToken: "1.tok",
      turnstileSiteKey: "site-key",
      turnstileAction: "reserve",
      onEdit: () => {},
      onDone: () => {},
      onWidgetErrors: () => {},
      onStaleToken: () => {},
      titleId: "qq-title",
    }),
    locale,
  );
}

describe("5. 모달 첫 화면(ko) — 두 블록 모두 접힘, 두 동의 없으면 제출 불가", async () => {
  const html = await modalHtml("ko");

  test("토글 둘 — 전부 접힘(aria-expanded=false · 본문 hidden) · 본문 id 가 서로 다르다", () => {
    const t = toggles(html);
    expect(t).toHaveLength(2);
    for (const x of t) {
      expect(x.button.attrs.get("aria-expanded")).toBe("false");
      expect(x.region).toHaveLength(1);
      expect(x.region[0].attrs.has("hidden")).toBe(true);
    }
    expect(new Set(t.map((x) => x.controls)).size).toBe(2);
  });

  test("체크박스 둘 — 기본 해제 · 본문 밖 · 제출은 disabled(data-block=consent)", () => {
    const boxes = findElements(html, (tag, a) => tag === "input" && a.get("type") === "checkbox");
    expect(boxes.map((b) => b.attrs.get("name")).sort()).toEqual(["privacyConsent", "withdrawalConsent"]);
    for (const b of boxes) {
      expect(b.attrs.has("checked")).toBe(false);
      expect(hiddenAncestor(b)).toBe(false);
    }
    const submit = findElements(html, (tag, a) => tag === "button" && a.get("data-testid") === "quick-quote-submit");
    expect(submit[0].attrs.has("disabled")).toBe(true);
    expect(submit[0].attrs.get("data-block")).toBe("consent");
  });

  test("청약철회 확인 라벨 = 원장 그대로 · 고지 다음에 온다 · verbatim 은 접히지 않고 보인다", () => {
    const label = exact(html, WITHDRAWAL.consentLabel);
    expect(label).toHaveLength(1);
    expect(hiddenAncestor(label[0])).toBe(false);
    expect(html.indexOf('data-legal="withdrawal-notice"')).toBeLessThan(html.indexOf('name="withdrawalConsent"'));
    const verbatim = exact(html, VERBATIM.bookingNotice);
    expect(verbatim).toHaveLength(1);
    expect(hiddenAncestor(verbatim[0])).toBe(false);
  });
});

describe("5-b. 모달 첫 화면(en) — 두 접힌 카드의 안내가 모두 officialNoticeCollapsed · lang=ko 밖 한글 0", async () => {
  const html = await modalHtml("en");

  test("안내 둘 다 'The Korean original under “View details” …' · 'The Korean text below' 0 · 둘 다 접힌 상태에서 보인다", () => {
    const notices = findElements(html, (_t, a) => a.get("data-legal") === "official-korean-notice");
    expect(notices).toHaveLength(2);
    for (const n of notices) expect(hiddenAncestor(n)).toBe(false);
    expect(exact(html, COLLAPSED_NOTICE?.lead ?? "")).toHaveLength(2);
    expect(decodeText(html)).not.toContain("The Korean text below");
  });

  test("영문 요약(개인정보 네 줄 · 청약철회 다섯 줄)이 접힌 상태에서 보이고 lang=ko 밖 한글 0", () => {
    for (const s of [...PRIVACY_EN, ...SUMMARY_EN]) {
      const hits = exact(html, s);
      expect(hits, s.slice(0, 24)).toHaveLength(1);
      expect(hiddenAncestor(hits[0]), s.slice(0, 24)).toBe(false);
    }
    const hits = findUnmarkedHangul(html);
    // 요약의 장소 이름(인천공항)처럼 모달이 받은 로케일 라벨은 en 에서 영문이다 — 남는 한글은 lang=ko 블록 안뿐이다
    expect(hits).toEqual([]);
  });
});

// =============================================================================
// 6. CSS — 중요한 내용의 표시 · 적용 범위의 위계 · 제한 한 줄
// =============================================================================
type CssRule = { selector: string; body: string };
function cssRules(rel: string): CssRule[] {
  const css = read(rel).replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
}
const px = (body: string, prop: string) => {
  const m = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([\\d.]+)px`).exec(body);
  return m ? Number(m[1]) : undefined;
};
const weight = (body: string) => {
  const m = /(?:^|;|\s)font-weight\s*:\s*(\d+)/.exec(body);
  return m ? Number(m[1]) : undefined;
};
const color = (body: string) => /(?:^|;|\s)color\s*:\s*([^;]+)/.exec(body)?.[1].trim();
const mentions = (selector: string, cls: string) => new RegExp(`\\.${cls}(?![\\w-])`).test(selector);
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("6. CSS — 중요한 내용의 표시(고시 제2023-12호 §4 1호) · 적용 범위 위계(리뷰 P2-3) · 제한 한 줄", () => {
  const rules = cssRules(QUOTE_CSS);
  const used = (rel: string) => [...new Set([...codeOf(rel).matchAll(/\bs\.([a-zA-Z][\w]*)/g)].map((m) => m[1]))];
  const blockClasses = [...new Set([...used(CONSENT_FILE), ...used(TOGGLE_FILE)])];
  const retentionClass = /className=\{s\.(\w+)\}\s+data-testid="consent-retention"/.exec(codeOf(CONSENT_FILE))?.[1] ?? "";
  const own = (cls: string) => rules.find((r) => r.selector === `.${cls}`)?.body ?? "";

  test("보유 기간 줄 — 전용 클래스 · 크게(9pt=12px 이상) · 굵게(≥700) · 색 구분(브랜드색 값) — 고시 §4 1호 '크기, 색깔, 굵기 … 명확히'", () => {
    expect(retentionClass).not.toBe("");
    expect(rules.filter((r) => r.selector === `.${retentionClass}`)).toHaveLength(1);
    expect(px(own(retentionClass), "font-size")).toBeGreaterThanOrEqual(12);
    expect(weight(own(retentionClass))).toBeGreaterThanOrEqual(700);
    const dd = rules.find((r) => r.selector === `.${retentionClass} dd`);
    expect(color(dd?.body ?? "")).toBe("var(--text-brand)");
  });

  test("내부 보수 기준 — 보유 기간 줄 ≥ 카드 안 다른 모든 글자 × 1.2 (옛 고시 제2020-7호의 20% 문언을 우리 기준으로 유지 · ko·en 같은 줄 · en 안내 포함)", () => {
    const retention = px(own(retentionClass), "font-size") ?? 0;
    const others: Array<[string, number]> = [];
    for (const r of rules) {
      if (mentions(r.selector, retentionClass)) continue;
      if (!blockClasses.some((c) => mentions(r.selector, c))) continue;
      const size = px(r.body, "font-size");
      if (size !== undefined) others.push([r.selector, size]);
    }
    // en 에서 카드 안에 들어오는 컨트롤러 확정 안내(legal.module.css .officialNotice)
    const official = px(cssRules("components/legal/legal.module.css").find((r) => r.selector === ".officialNotice")?.body ?? "", "font-size");
    if (official !== undefined) others.push([".officialNotice", official]);
    expect(others.length, "비교할 글자 크기가 없다(빈 통과)").toBeGreaterThan(3);
    for (const [selector, size] of others) expect(retention, `${selector} ${size}px`).toBeGreaterThanOrEqual(size * 1.2);
  });

  test("적용 범위 문장 — 본문 크기(13.5px) · 본문색(--text-primary) — 표('계약금 환불 불가')가 무조건으로 읽히지 않게(리뷰 P2-3 · P1-7 R3 [P2-F])", () => {
    const cls = /<p className=\{s\.(\w+)\} data-legal="cancellation-scope"/.exec(codeOf(WITHDRAWAL_FILE))?.[1] ?? "";
    expect(cls).not.toBe("");
    expect(px(own(cls), "font-size")).toBe(13.5);
    expect(color(own(cls))).toBe("var(--text-primary)");
    // 영문 범위도 같은 클래스
    expect(codeOf(WITHDRAWAL_FILE)).toMatch(new RegExp(`<p className=\\{s\\.${cls}\\} data-legal="cancellation-scope-en"`));
  });

  test("날짜 기준 — 작은 줄(적용 범위보다 작다) · ko·en 같은 클래스", () => {
    const ref = /<p className=\{s\.(\w+)\} data-legal="cancellation-reference"/.exec(codeOf(WITHDRAWAL_FILE))?.[1] ?? "";
    const scope = /<p className=\{s\.(\w+)\} data-legal="cancellation-scope"/.exec(codeOf(WITHDRAWAL_FILE))?.[1] ?? "";
    expect(ref).not.toBe("");
    expect(px(own(ref), "font-size")).toBeLessThan(px(own(scope), "font-size") ?? 0);
    expect(codeOf(WITHDRAWAL_FILE)).toMatch(new RegExp(`<p className=\\{s\\.${ref}\\} data-legal="cancellation-reference-en"`));
  });

  test("청약철회 제한 한 줄(smsLine · en restriction)은 굵다 — 강조 클래스의 font-weight ≥ 700", () => {
    const cls = /<p className=\{s\.(\w+)\} data-legal="withdrawal-summary"/.exec(codeOf(WITHDRAWAL_FILE))?.[1] ?? "";
    expect(cls).not.toBe("");
    expect(weight(own(cls))).toBeGreaterThanOrEqual(700);
  });

  test("펼친 본문은 hidden 속성으로 숨는다 — 본문 클래스가 display 로 hidden 을 덮지 않는다", () => {
    const bodyClass = /id=\{bodyId\}\s+className=\{s\.(\w+)\}/.exec(codeOf(TOGGLE_FILE))?.[1] ?? "";
    expect(bodyClass).not.toBe("");
    const displayRules = rules.filter((r) => mentions(r.selector, bodyClass) && /(?:^|;|\s)display\s*:/.test(r.body));
    for (const r of displayRules) expect(r.selector, "display 를 주려면 [hidden] 에서 none 으로 되돌려야 한다").toMatch(/\[hidden\]/);
  });
});

// =============================================================================
// 7. 정적 — 법정 문구는 서버에서 · 클라이언트 경계 · messages · 원장 요약의 일관성
// =============================================================================
describe("7. 정적 — 경계 · messages · 원장", () => {
  test("MoreToggle — 'use client' · 문구는 quote.more · 원장 import 0 · 한글 리터럴 0", () => {
    const raw = read(TOGGLE_FILE);
    expect(raw.split("\n")[0]).toMatch(/^["']use client["'];$/);
    const code = codeOf(TOGGLE_FILE);
    expect(code).toMatch(/useTranslations\(["']quote\.more["']\)/);
    expect(code).not.toMatch(/@\/lib\/legal\/disclosures/);
    expect(HANGUL.test(code)).toBe(false);
  });

  test("두 블록이 같은 토글을 쓴다 — ConsentBlock(클라이언트 트리) · WithdrawalNotice(서버, 본문을 children 으로)", () => {
    for (const f of [CONSENT_FILE, WITHDRAWAL_FILE]) expect(codeOf(f), f).toMatch(/<MoreToggle\b/);
    expect(codeOf(CONSENT_FILE)).not.toMatch(/@\/lib\/legal\/disclosures/);
    expect(codeOf(MODAL_FILE)).not.toMatch(/@\/lib\/legal\/disclosures/);
  });

  test("Hero 가 원장에서 읽어 props 로 내린다(보유 기간 요약 · 개인정보 영문 요약 · 접힌 카드 안내)", () => {
    const hero = codeOf(HERO_FILE);
    expect(hero).toMatch(/retentionSummary:\s*PRIVACY_NOTICE\.retentionSummary/);
    expect(hero).toMatch(/PRIVACY_NOTICE\.summaryEn/);
    expect(hero).toMatch(/officialNotice:\s*ui\.officialNoticeCollapsed/);
  });

  test("클라이언트 트리 · Hero · WithdrawalNotice 에 원장 문구 리터럴 0(영문 요약 포함) · 접힌 카드 안내 문구도 클라이언트에 다시 적지 않는다", () => {
    const phrases = [
      PRIVACY_NOTICE.retentionSummary,
      PRIVACY_NOTICE.purpose,
      PRIVACY_NOTICE.publicFeedNotice,
      WITHDRAWAL.smsLine,
      WITHDRAWAL.noticeEn,
      CANCELLATION.scope,
      CANCELLATION.referenceTime,
      CANCELLATION.depositNote,
      ...KO_TIERS,
      ...SUMMARY_EN,
      ...PRIVACY_EN,
    ];
    const clientTree = [...QUOTE_CLIENT_TREE, "components/home/QuoteWidget.tsx"];
    for (const f of [...new Set([...clientTree, WITHDRAWAL_FILE, HERO_FILE])]) {
      const code = codeOf(f);
      for (const p of phrases) expect(code.includes(p), `${f}: ${p.slice(0, 16)}`).toBe(false);
    }
    for (const f of clientTree) {
      const code = codeOf(f);
      for (const p of [COLLAPSED_NOTICE?.lead ?? "∅", COLLAPSED_NOTICE?.body ?? "∅"]) expect(code.includes(p), `${f}: ${p.slice(0, 16)}`).toBe(false);
    }
    // 카탈로그(messages)에도 원장 요약을 다시 적지 않았다 — 영문 요약은 원장 한 곳에만 있다
    const catalogs = read("messages/en.json") + read("messages/ko.json");
    for (const p of [...SUMMARY_EN, ...PRIVACY_EN]) expect(catalogs.includes(p), p.slice(0, 24)).toBe(false);
  });

  test("영문 요약은 서버가 원장에서 읽는다 — WithdrawalNotice(청약철회) · Hero(개인정보) · 클라이언트 트리는 원장을 import 하지 않는다", () => {
    const w = codeOf(WITHDRAWAL_FILE);
    for (const k of ["tiers", "referenceTime", "scope", "restriction"]) expect(w, k).toMatch(new RegExp(`WITHDRAWAL\\.summaryEn\\.${k}`));
    expect(w).toMatch(/ledgerUi\(locale\)\.officialNoticeCollapsed/);
    expect(/^\s*["']use client["']/m.test(read(WITHDRAWAL_FILE))).toBe(false);
    for (const f of QUOTE_CLIENT_TREE) expect(codeOf(f), f).not.toMatch(/@\/lib\/legal\/disclosures/);
  });

  test("messages — quote.more.show/hide (ko '자세히 보기'·'접기' · en 영문)", () => {
    expect(ko.quote.more).toEqual({ show: "자세히 보기", hide: "접기" });
    expect(Object.keys(en.quote.more).sort()).toEqual(["hide", "show"]);
    for (const v of Object.values(en.quote.more)) expect(HANGUL.test(v)).toBe(false);
  });

  test("원장 — 영문 요약은 한국어 규정과 같은 모양이다(2단계 둘 · 기한 3일/2일/7일 · 예시 7일/8일) · 개인정보 요약 네 줄 · 한글 0", () => {
    expect(WITHDRAWAL.summaryEn.tiers).toHaveLength(CANCELLATION.tiers.length);
    expect(CANCELLATION.tiers[0].when).toContain("3일");
    expect(WITHDRAWAL.summaryEn.tiers[0]).toContain("3 days");
    expect(CANCELLATION.tiers[1].when).toContain("2일");
    expect(WITHDRAWAL.summaryEn.tiers[1]).toContain("2 days");
    for (const [koDays, enDays] of [["2일", "2 days"], ["7일", "7 days"]] as const) {
      expect(WITHDRAWAL.smsLine).toContain(koDays);
      expect(WITHDRAWAL.summaryEn.restriction).toContain(enDays);
    }
    for (const [koDay, enDay] of [["10일", "10th"], ["7일", "7th"], ["8일", "8th"]] as const) {
      expect(CANCELLATION.referenceTime).toContain(koDay);
      expect(WITHDRAWAL.summaryEn.referenceTime).toContain(enDay);
    }
    expect(Object.keys(PRIVACY_NOTICE.summaryEn).sort()).toEqual(["items", "publicFeed", "purpose", "retention"]);
    for (const s of [...SUMMARY_EN, ...PRIVACY_EN]) expect(HANGUL.test(s), s.slice(0, 24)).toBe(false);
  });

  test("원장 — 보유 기간 요약은 전문과 같은 기간(1년 · 5년)을 말한다", () => {
    for (const s of ["1년", "5년"]) {
      expect(PRIVACY_NOTICE.retentionSummary).toContain(s);
      expect(PRIVACY_NOTICE.retention).toContain(s);
    }
    expect(PRIVACY_NOTICE.retentionSummary).toContain("접수일");
    expect(PRIVACY_NOTICE.summaryEn.retention).toContain("1 year");
    expect(PRIVACY_NOTICE.summaryEn.retention).toContain("5 years");
  });
});
