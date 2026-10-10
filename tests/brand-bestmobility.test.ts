/**
 * 사장님 요청 14 · 2 · 5 — 단계 2 T2-1 브랜드·로고·푸터·확정 문자 계약 주체
 * (2026-10-10, 계획 `.superpowers/sdd/2026-09-06-bestour-implementation-v4/OWNER-FEEDBACK-plan.md` T2-1 · 결정 1 · 2 · 12).
 *
 * 결정 1 "간판만 변경": 화면·로고·문자 접두의 이름 = 베스트모빌리티(원장 COMPANY.brandName) · 영문 Bestmobility(brandNameEn).
 * 법정 상호·계약 주체·통신판매업 신고·약관 당사자 = 합자회사 베스트투어(COMPANY.legalName) 그대로 — 전자상거래법 §10①.
 * 2013 개업 이력은 합자회사 베스트투어에 붙여 둔다(2026년 신설 법인의 것처럼 읽히지 않게). 실적·사진 문장은 주어 없이 쓴다(표시광고법).
 * 도메인 bestour.co.kr · 메일 · 내부 식별자(bestour:analytics-optout · 롤백 GUC)는 그대로다.
 *
 *   1. 원장 전제          — 컨트롤러가 바꾼 값(브랜드 · note · accountLine)
 *   2. 카탈로그 회귀 잠금 — ko 에 옛 브랜드 표기 0(법정 상호 예외) · en 은 'Bestmobility' 하나 · 실적·사진 문장은 주어 없음
 *   3. 메타              — 루트·관리자 레이아웃 제목이 원장 브랜드
 *   4. 로고              — 헤더·푸터·404·공유 이미지가 logo-bestmobility.png · 크기 CSS 가 새 비율 · alt 는 브랜드명
 *   5. 공유 이미지 판     — 캐시를 비우려고 주소에 판 번호(?v=2) · 경로는 같은 정적 라우트
 *   6. 푸터(요청 5)       — '운영사'·'관계사' 배지·점선 없음 · 베스트투어(신고번호 · 사업자정보 확인 링크) → 베스트모빌리티 · note 유지
 *   7. /about            — '운영사' 라벨 대신 '상호' · 소제목 없음
 *   8. 원장 UI 정리       — 렌더하지 않는 'Operator'·'Affiliate'(relatedRole · footer.operator)를 걷었다
 *   9. 확정 문자 계약 주체 — 확정 문자·알림톡 맨 아래 '운영: 합자회사 베스트투어'(원장 legalName 으로 조립)
 *  10. 2013 은 법정 상호와 붙어 있다 — 홈 신뢰 바
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ locale: "ko" as "ko" | "en" }));

// 서버 컴포넌트를 실제로 불러 렌더한다 — next-intl/server 만 가짜다(로케일은 테스트가 고르고, 문구는 실제 카탈로그). tests/contact-phone.test.ts 와 같은 방식.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { readFileSync: rf } = await import("node:fs");
  const p = await import("node:path");
  const load = (l: string) => JSON.parse(rf(p.resolve(import.meta.dirname, "..", "messages", `${l}.json`), "utf8"));
  const messages: Record<string, unknown> = { ko: load("ko"), en: load("en") };
  return {
    getLocale: vi.fn(async () => state.locale),
    setRequestLocale: vi.fn(),
    getTranslations: vi.fn(async (opts?: { namespace?: string } | string) => {
      const namespace = typeof opts === "string" ? opts : opts?.namespace;
      return createTranslator({ locale: state.locale, messages: messages[state.locale] as never, namespace: namespace as never });
    }),
  };
});

import AboutPage from "@/app/[locale]/(site)/about/page";
import h from "@/components/home/home.module.css";
import { SectionHead } from "@/components/home/SectionHead";
import { TrustBar } from "@/components/home/TrustBar";
import Footer from "@/components/layout/Footer";
import footerStyles from "@/components/layout/Footer.module.css";
import { ledgerUi } from "@/lib/i18n/ledger-ui";
import { COMPANY, LEGAL_LINKS, PAYMENT, RELATED_COMPANY } from "@/lib/legal/disclosures";
import {
  ALIMTALK_TEMPLATES,
  CONTRACT_PARTY_LINE,
  LMS_BYTE_LIMIT,
  renderTemplate,
  renderVariants,
  utf8ByteLength,
  type CustomerVars,
  type OwnerVars,
} from "@/lib/notify/templates";
import { ALL_TEMPLATE_KEYS, type TemplateKey } from "@/lib/notify/outbox";
import { OG_IMAGE_PATH, shareMetadata } from "@/lib/share-meta";

import { CREATED_BEFORE_REFUND_CHANGE } from "./helpers/refund-policy-fixtures";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);

type Catalog = Record<string, unknown>;
const ko = JSON.parse(read("messages/ko.json")) as Catalog;
const en = JSON.parse(read("messages/en.json")) as Catalog;
const CATALOG = { ko, en } as const;
const at = (cat: Catalog, dotted: string): unknown =>
  dotted.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Catalog)[k] : undefined), cat);
const str = (locale: "ko" | "en", dotted: string): string => {
  const v = at(CATALOG[locale], dotted);
  expect(typeof v, `${locale}.${dotted} 가 문자열이 아니다`).toBe("string");
  return v as string;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const params = (locale: string) => ({ params: Promise.resolve({ locale }) });

/** 새 로고 원본의 가로:세로(2110×265) — 크기 CSS·이미지 속성이 이 비율을 따라야 찌그러지거나 여백이 생기지 않는다. */
const LOGO = "public/brand/logo-bestmobility.png";
const OLD_LOGO = "logo-bestour.png";

type El = ReactElement<Record<string, unknown>>;
function findEl(node: unknown, pred: (el: El) => boolean): El | undefined {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findEl(n, pred);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  const el = node as El;
  if (pred(el)) return el;
  return findEl(el.props.children, pred);
}
function block(tree: ReactNode, pred: (el: El) => boolean, what: string): string {
  const el = findEl(tree, pred);
  expect(el, `${what} 를 찾지 못했다`).toBeDefined();
  return renderToStaticMarkup(el!);
}

/** 주석을 뺀 CSS 에서 선택자 하나의 선언 블록들 — 미디어 쿼리 안의 것까지(조건 문자열과 함께). */
function cssRules(rel: string, selector: string): { media: string | null; body: string }[] {
  const css = read(rel).replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { media: string | null; body: string }[] = [];
  const re = /@media([^{]+)\{|([^{}@]+)\{([^{}]*)\}|\}/g;
  let media: string | null = null;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    if (m[1] !== undefined) media = m[1].trim();
    else if (m[2] !== undefined) {
      const selectors = m[2].split(",").map((s) => s.trim());
      if (selectors.includes(selector)) out.push({ media, body: m[3] });
    } else media = null;
  }
  return out;
}
const px = (body: string, prop: string): number | null => {
  const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([\\d.]+)px`).exec(body);
  return m ? Number(m[1]) : null;
};

function pngInfo(rel: string) {
  const b = readFileSync(path.join(ROOT, rel));
  expect(b.subarray(1, 4).toString("latin1"), `${rel} 은 PNG`).toBe("PNG");
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] };
}

// =============================================================================
// 1. 원장 전제 — 컨트롤러가 바꾼 값 (원장 수정은 이 태스크 밖. 바뀐 값을 그대로 쓰는지만 본다)
// =============================================================================
describe("1. 원장 전제 — 간판은 베스트모빌리티, 법정 상호는 합자회사 베스트투어", () => {
  test("COMPANY.brandName · brandNameEn · legalName", () => {
    expect(COMPANY.brandName).toBe("베스트모빌리티");
    expect(COMPANY.brandNameEn).toBe("Bestmobility");
    expect(COMPANY.legalName).toBe("합자회사 베스트투어");
  });

  test("손님에게 보이는 원장 줄에 '관계사' 꼬리표가 없다 — note · accountLine (결정 2)", () => {
    expect(RELATED_COMPANY.note).not.toContain("관계사");
    expect(PAYMENT.accountLine).not.toContain("관계사");
    // 계약 주체와 대금 수령 주체가 다르다는 고지(§13①1호)는 남아 있다
    expect(RELATED_COMPANY.note).toContain(COMPANY.legalName);
    expect(RELATED_COMPANY.note).toContain(RELATED_COMPANY.legalName);
    expect(PAYMENT.accountLine).toContain(PAYMENT.account.holder);
  });
});

// =============================================================================
// 2. 카탈로그 — ko 회귀 잠금(옛 브랜드 표기 0 · 법정 상호 예외) · en 은 하나의 표기
// =============================================================================
/**
 * 옛 브랜드의 모든 표기 — 베스트투어 · 베스트 투어 · BEST TOUR · Best Tour · Bestour (대소문자·띄어쓰기 무관).
 * 'Bestour' 는 t 가 **하나**다(Best + our) — `/best\s*tour/` 로는 잡히지 않는다(옛 en 단언 i18n-en §4 가 그 구멍을 가졌다). 그래서 `t?`.
 */
const OLD_BRAND_KO = /베스트\s*투어/;
const OLD_BRAND_LATIN = /best\s*t?our/i;
/** 그대로 두는 것 — 법정 상호(계약 주체) · 도메인 · 회사 메일. 회귀 검사 전에 걷어 낸다. */
const KEPT = [COMPANY.legalName, COMPANY.email, "bestour.co.kr"];
const withoutKept = (s: string) => KEPT.reduce((acc, k) => acc.split(k).join(""), s);

describe("2. 카탈로그 — 옛 브랜드 표기 0, 새 브랜드 표기는 원장 그대로", () => {
  test("전제 — 옛 표기 정규식이 다섯 표기를 모두 잡는다(거짓 초록 방지)", () => {
    for (const s of ["베스트투어", "베스트 투어"]) expect(OLD_BRAND_KO.test(s), s).toBe(true);
    for (const s of ["BEST TOUR", "Best Tour", "Bestour", "bestour", "BestTour"]) expect(OLD_BRAND_LATIN.test(s), s).toBe(true);
    expect(OLD_BRAND_LATIN.test(COMPANY.brandNameEn)).toBe(false);
    expect(withoutKept(`${COMPANY.legalName} ${COMPANY.email} https://bestour.co.kr/`).match(OLD_BRAND_LATIN)).toBeNull();
  });

  test("ko.json 전체(손님 화면 + 관리자)에 옛 브랜드 표기가 없다 — 법정 상호 '합자회사 베스트투어'·도메인·메일만 예외", () => {
    const text = withoutKept(JSON.stringify(ko));
    expect(text.match(OLD_BRAND_KO), "베스트투어 · 베스트 투어").toBeNull();
    expect(text.match(OLD_BRAND_LATIN), "BEST TOUR · Best Tour · Bestour").toBeNull();
  });

  test("ko 의 새 브랜드 표기는 원장 그대로(붙여 쓰기) — '베스트 모빌리티' 같은 변형 0", () => {
    const text = JSON.stringify(ko);
    const forms = [...text.matchAll(/베스트\s*모빌리티/g)].map((m) => m[0]);
    expect(forms.length).toBeGreaterThan(0);
    expect(new Set(forms)).toEqual(new Set([COMPANY.brandName]));
    expect(str("ko", "common.siteName")).toBe(COMPANY.brandName);
    expect(str("ko", "common.description").startsWith(`${COMPANY.brandName} — `)).toBe(true);
  });

  test("en.json 의 브랜드 표기는 'Bestmobility' 하나 — 옛 표기 0 · 'Best Mobility'·'BESTMOBILITY' 같은 변형 0", () => {
    const text = JSON.stringify(en);
    expect(withoutKept(text).match(OLD_BRAND_LATIN)).toBeNull();
    const forms = [...text.matchAll(/best[\s-]*mobility/gi)].map((m) => m[0]);
    expect(forms.length).toBeGreaterThan(0);
    expect(new Set(forms)).toEqual(new Set([COMPANY.brandNameEn]));
    expect(str("en", "common.siteName")).toBe(COMPANY.brandNameEn);
    expect(str("en", "common.description").startsWith(`${COMPANY.brandNameEn} — `)).toBe(true);
  });

  // 옛 브랜드가 있던 자리 중 브랜드를 그대로 이어받는 곳 — 인사말(옛 사이트 원문 포함)·캐러셀 이름·공지 설명
  const BRANDED = [
    "common.siteName",
    "common.description",
    "home.hero.sectionLabel",
    "home.hero.carouselLabel",
    "home.company.lead",
    "home.company.body.0",
    "home.company.body.1",
    "pages.about.more.0",
    "pages.notices.meta.description",
    "pages.notices.detail.meta.description",
  ] as const;
  test.for(["ko", "en"] as const)("%s — 옛 브랜드 자리는 새 브랜드를 이어받는다", (locale) => {
    const brand = locale === "ko" ? COMPANY.brandName : COMPANY.brandNameEn;
    for (const key of BRANDED) expect(str(locale, key), key).toContain(brand);
  });

  test("관리자 셸 이름(admin.tabs.brand)도 새 브랜드 — 관리자 문구는 ko.json 에만 있다", () => {
    expect(str("ko", "admin.tabs.brand")).toBe(`${COMPANY.brandName} 관리`);
    expect(en).not.toHaveProperty("admin");
  });

  // 실적·사진·차량 문장은 브랜드만 바꾸지 않고 주어를 뺐다 — "베스트모빌리티가 다녀온 운행 현장" 은 2026-08 신설 법인의 실적처럼 읽힌다(표시광고법 실증책임).
  // 회사소개 설명은 "사업자 정보" 가 합자회사 베스트투어의 것이라 브랜드를 주어로 두면 (주)베스트모빌리티의 사업자 정보로 오독된다.
  const SUBJECTLESS = [
    "pages.gallery.meta.description",
    "pages.gallery.detail.meta.description",
    "pages.fleet.meta.description",
    "pages.about.meta.description",
  ] as const;
  test.for(["ko", "en"] as const)("%s — 실적·사진·차량·사업자 정보 설명 문장에는 상호가 주어로 없다", (locale) => {
    for (const key of SUBJECTLESS) {
      const s = str(locale, key);
      for (const name of [COMPANY.brandName, COMPANY.brandNameEn, COMPANY.legalName, RELATED_COMPANY.legalName]) {
        expect(s.includes(name), `${locale}.${key} 에 ${name}`).toBe(false);
      }
      expect(s.match(OLD_BRAND_KO), key).toBeNull();
      expect(s.match(OLD_BRAND_LATIN), key).toBeNull();
      expect(s.trim().length, key).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// 3. 메타 — 루트·관리자 레이아웃 제목은 원장 브랜드
// =============================================================================
describe("3. 메타 — 레이아웃 제목", () => {
  test("루트 레이아웃(app/layout.tsx) — 제목 = 원장 COMPANY.brandName · 설명 = ko 카탈로그 common.description · 브랜드 리터럴 0", async () => {
    const { metadata } = await import("@/app/layout");
    expect(metadata.title).toBe(COMPANY.brandName);
    expect(metadata.description).toBe(str("ko", "common.description"));
    const code = codeOf("app/layout.tsx");
    expect(code).toMatch(/COMPANY\.brandName/);
    expect(code.match(OLD_BRAND_KO)).toBeNull();
    expect(code.includes(COMPANY.brandName), "브랜드를 리터럴로 다시 적었다").toBe(false);
  });

  test("관리자 레이아웃(app/admin/layout.tsx) — 제목은 원장 브랜드 + 관리자 · 리터럴 0", async () => {
    const { metadata } = await import("@/app/admin/layout");
    expect(metadata.title).toBe(`${COMPANY.brandName} 관리자`);
    const code = codeOf("app/admin/layout.tsx");
    expect(code).toMatch(/COMPANY\.brandName/);
    expect(code.match(OLD_BRAND_KO)).toBeNull();
    expect(code.includes(COMPANY.brandName)).toBe(false);
  });

  test("공유 메타의 사이트 이름(alt)은 로케일 카탈로그 브랜드다", () => {
    const k = shareMetadata("ko", str("ko", "common.siteName"));
    expect(k.openGraph).toMatchObject({ siteName: COMPANY.brandName, images: [{ alt: COMPANY.brandName }] });
    const e = shareMetadata("en", str("en", "common.siteName"));
    expect(e.openGraph).toMatchObject({ siteName: COMPANY.brandNameEn, images: [{ alt: COMPANY.brandNameEn }] });
  });
});

// =============================================================================
// 4. 로고 — logo-bestmobility.png (고해상도 투명판)
// =============================================================================
describe("4. 로고 — 헤더 · 푸터 · 404 · 공유 이미지", () => {
  const ratio = (() => {
    const { w, h: ht } = pngInfo(LOGO);
    return w / ht;
  })();
  const near = (r: number, what: string) => expect(Math.abs(r - ratio) / ratio, `${what} 비율 ${r.toFixed(3)} ≠ ${ratio.toFixed(3)}`).toBeLessThan(0.02);

  test("원본은 저장소의 고해상도 투명 PNG(RGBA) 이고 두 사본이 같다 — 사용자가 준 흰 배경 파일(docs/)은 쓰지 않는다", () => {
    const info = pngInfo(LOGO);
    expect(info).toEqual({ w: 2110, h: 265, colorType: 6 });
    expect(readFileSync(path.join(ROOT, LOGO)).equals(readFileSync(path.join(ROOT, "mockups/assets/brand/logo-bestmobility.png")))).toBe(true);
    for (const f of ["components/layout/Header.tsx", "components/layout/Footer.tsx", "app/not-found.tsx", "app/og.png/route.tsx"]) {
      expect(read(f).includes("bestmobility_img"), f).toBe(false);
    }
  });

  test.for([
    ["components/layout/Header.tsx", 1],
    ["components/layout/Footer.tsx", 1],
    ["app/not-found.tsx", 2],
  ] as const)("%s — 로고 src 는 /brand/logo-bestmobility.png(옛 로고 0) · 이미지 속성 비율 = 원본 비율", ([file, n]) => {
    const code = codeOf(file);
    expect(code.includes(OLD_LOGO), `${file} 에 옛 로고`).toBe(false);
    const tags = [...code.matchAll(/<Image\b[^>]*src="\/brand\/logo-bestmobility\.png"[^>]*\/>/g)].map((m) => m[0]);
    expect(tags).toHaveLength(n);
    for (const tag of tags) {
      const w = Number(/\bwidth=\{(\d+)\}/.exec(tag)?.[1]);
      const ht = Number(/\bheight=\{(\d+)\}/.exec(tag)?.[1]);
      near(w / ht, `${file} <Image>`);
    }
  });

  test("alt 는 브랜드명 — 헤더·푸터는 ledgerUi(locale).brand, 404 는 원장 brandName / brandNameEn", () => {
    for (const f of ["components/layout/Header.tsx", "components/layout/Footer.tsx"]) {
      expect(codeOf(f)).toMatch(/src="\/brand\/logo-bestmobility\.png"[\s\S]{0,80}alt=\{ui\.brand\}/);
    }
    const nf = codeOf("app/not-found.tsx");
    expect(nf).toMatch(/logo-bestmobility\.png" alt=\{COMPANY\.brandName\}/);
    expect(nf).toMatch(/logo-bestmobility\.png" alt=\{COMPANY\.brandNameEn\}/);
    expect(ledgerUi("ko").brand).toBe(COMPANY.brandName);
    expect(ledgerUi("en").brand).toBe(COMPANY.brandNameEn);
  });

  test.for([
    ["components/layout/Header.module.css", 2],
    ["components/layout/Footer.module.css", 1],
    ["app/errors.module.css", 1],
  ] as const)("%s — .logo 의 width:height 가 새 비율이다(모든 폭)", ([file, n]) => {
    const rules = cssRules(file, ".logo").filter((r) => px(r.body, "width") !== null && px(r.body, "height") !== null);
    expect(rules.length, `${file} .logo 치수 규칙 수`).toBe(n);
    for (const r of rules) near(px(r.body, "width")! / px(r.body, "height")!, `${file} .logo ${r.media ?? ""}`);
  });

  test("공유 이미지(app/og.png/route.tsx)는 새 로고를 그리고, 그리는 크기도 새 비율이다", () => {
    const code = codeOf("app/og.png/route.tsx");
    expect(code).toMatch(/public\/brand\/logo-bestmobility\.png/);
    expect(code.includes(OLD_LOGO)).toBe(false);
    const img = /<img\b[^>]*width=\{(\d+)\}[^>]*height=\{(\d+)\}/.exec(code);
    expect(img).not.toBeNull();
    near(Number(img![1]) / Number(img![2]), "OG <img>");
    // 1200 폭 안에 좌우 여백을 남긴다(카카오톡이 2:1 로 잘라도 로고가 남게)
    expect(Number(img![1])).toBeLessThanOrEqual(1000);
  });
});

// =============================================================================
// 5. 공유 이미지 판 — 캐시(카카오·페이스북)가 옛 로고를 들고 있지 않게
// =============================================================================
describe("5. 공유 이미지 주소에 판 번호", () => {
  test("OG_IMAGE_PATH = /og.png?v=2 — 경로는 같은 정적 라우트(app/og.png/route.tsx) · 메타가 이 주소를 쓴다", () => {
    expect(OG_IMAGE_PATH).toBe("/og.png?v=2");
    const u = new URL(OG_IMAGE_PATH, "https://example.test");
    expect(u.pathname).toBe("/og.png");
    expect(u.searchParams.get("v")).toBe("2");
    const m = shareMetadata("ko", COMPANY.brandName);
    expect((m.openGraph as { images: { url: string }[] }).images[0].url).toBe(OG_IMAGE_PATH);
    expect((m.twitter as { images: { url: string }[] }).images[0].url).toBe(OG_IMAGE_PATH);
  });
});

// =============================================================================
// 6. 푸터 — 배지·점선 없음 · 베스트투어(신고번호 · 사업자정보 확인) → 베스트모빌리티 · 계약·대금 주체 고지 유지
// =============================================================================
describe.each(["ko", "en"] as const)("6. 푸터 사업자 정보 (%s)", (locale) => {
  const ui = ledgerUi(locale);

  async function companyInfo(): Promise<string> {
    state.locale = locale;
    return block(await Footer(), (el) => el.props["data-testid"] === "footer-company-info", "footer-company-info");
  }

  test("'운영사'·'관계사' 꼬리표가 없다(영문 Operator · Affiliate 도) · 배지 클래스 0", async () => {
    const html = await companyInfo();
    for (const word of ["운영사", "관계사", "Operator", "Affiliate"]) expect(html.includes(word), word).toBe(false);
    // CSS Modules 클래스 이름은 원래 이름을 품는다(_badge_xxxx) — 배지·점선 묶음 클래스가 마크업에 없다
    expect(footerStyles.row.length).toBeGreaterThan(0);
    expect(html).toContain(footerStyles.row);
    expect(html).not.toMatch(/badge/i);
    expect(html).not.toMatch(/_related_/);
  });

  test("순서 — 합자회사 베스트투어 · 통신판매업 신고번호 · 사업자정보 확인 링크 → (주)베스트모빌리티 → 계약·대금 주체 고지", async () => {
    const html = await companyInfo();
    const ftc = `href="${esc(LEGAL_LINKS.ftcBizInfo)}"`;
    const order = [esc(COMPANY.legalName), esc(COMPANY.mailOrderNo), ftc, esc(RELATED_COMPANY.legalName), esc(RELATED_COMPANY.note)];
    const idx = order.map((s) => html.indexOf(s));
    for (const [i, s] of order.entries()) expect(idx[i], `${s} 가 없다`).toBeGreaterThan(-1);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    // 사업자정보 확인 링크는 베스트투어 줄 안 — 새 창 · 라벨은 원장 라벨(en 은 en.json legal)
    expect(html).toMatch(new RegExp(`<a [^>]*${ftc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^>]*target="_blank"[^>]*>${esc(ui.labels.footer.ftcBizInfo)}</a>`));
    expect(html).toMatch(/rel="noreferrer noopener"/);
    expect(count(html, ftc)).toBe(1);
  });

  test("계약·대금 주체 고지(RELATED_COMPANY.note)는 한 번 그대로 · 계좌 줄에 '관계사' 없음", async () => {
    const html = await companyInfo();
    expect(count(html, esc(RELATED_COMPANY.note))).toBe(1);
    expect(html).toContain(esc(PAYMENT.accountLine));
  });
});

describe("6. 푸터 소스 — 사업자정보 확인 링크는 한 곳 · 점선 규칙 없음", () => {
  test("LEGAL_LINKS.ftcBizInfo 는 푸터에서 한 번만 쓰인다(베스트투어 줄로 옮겼다 — 법정 링크 줄에 같은 링크를 두지 않는다)", () => {
    expect(count(codeOf("components/layout/Footer.tsx"), "LEGAL_LINKS.ftcBizInfo")).toBe(1);
  });

  test("Footer.module.css 에 배지·점선 구분 규칙이 없다", () => {
    const css = read("components/layout/Footer.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/\.badge/);
    expect(css).not.toMatch(/dashed/);
  });

  test("Footer.tsx 는 운영사 라벨·관계사 역할(relatedRole · labels.operator · RELATED_COMPANY.role)을 읽지 않는다", () => {
    const code = codeOf("components/layout/Footer.tsx");
    expect(code).not.toMatch(/relatedRole|labels\.operator|\.operator\b|RELATED_COMPANY\.role/);
  });
});

// =============================================================================
// 7. /about — '운영사' 라벨 대신 '상호' · 소제목 없음
// =============================================================================
describe.each(["ko", "en"] as const)("7. /about 회사 정보 (%s)", (locale) => {
  test("상호 행 라벨은 pages.about.facts.legalName · 값은 원장 legalName · '운영사'·'Operator' 0", async () => {
    state.locale = locale;
    const tree = await AboutPage(params(locale));
    const html = block(tree, (el) => el.props.testId === "company-facts", "company-facts");
    expect(html).toMatch(new RegExp(`<th scope="row">${esc(str(locale, "pages.about.facts.legalName"))}</th><td[^>]*>${esc(COMPANY.legalName)}</td>`));
    for (const word of ["운영사", "Operator"]) expect(html.includes(word), word).toBe(false);
  });

  test("사업자 정보 구역 머리에 소제목(eyebrow)이 없다 — 제목(h2)은 남는다", async () => {
    state.locale = locale;
    const tree = await AboutPage(params(locale));
    const head = findEl(tree, (el) => el.type === SectionHead && el.props.id === "facts-h");
    expect(head, "facts 구역 SectionHead").toBeDefined();
    const html = renderToStaticMarkup(head!);
    expect(html).not.toContain(`class="${h.eyebrow}"`);
    expect(html).toContain(`<h2 class="${h.title}" id="facts-h">${esc(ledgerUi(locale).labels.footer.companyInfo)}</h2>`);
  });
});

describe("7. 카탈로그 · 소스", () => {
  test("새 키 pages.about.facts.legalName — ko '상호' · en 'Company name'", () => {
    expect(at(ko, "pages.about.facts.legalName")).toBe("상호");
    expect(at(en, "pages.about.facts.legalName")).toBe("Company name");
  });

  test("/about 은 운영사 라벨(footer.operator)을 읽지 않는다", () => {
    expect(codeOf("app/[locale]/(site)/about/page.tsx")).not.toMatch(/\.operator\b/);
  });

  test("SectionHead 소제목은 선택 — 넘기지 않거나 빈 값이면 <p> 를 남기지 않는다 · 넘기면 예전 그대로", () => {
    const none = renderToStaticMarkup(SectionHead({ id: "x", title: "T" }));
    expect(none).not.toContain(`class="${h.eyebrow}"`);
    expect(none).toContain(`<h2 class="${h.title}" id="x">T</h2>`);
    expect(renderToStaticMarkup(SectionHead({ id: "x", eyebrow: "", title: "T" }))).not.toContain(`class="${h.eyebrow}"`);
    expect(renderToStaticMarkup(SectionHead({ id: "x", eyebrow: "E", title: "T" }))).toContain(`<p class="${h.eyebrow}">E</p><h2`);
  });
});

// =============================================================================
// 8. 원장 UI 정리 — 렌더하지 않는 꼬리표 라벨을 걷었다 (원장 값 RELATED_COMPANY.role · LEGAL_LABELS.footer.operator 는 기록용으로 남는다)
// =============================================================================
describe("8. ledgerUi — relatedRole · labels.footer.operator 없음", () => {
  test.for(["ko", "en"] as const)("%s — relatedRole · footer.operator 키가 없다", (locale) => {
    const ui = ledgerUi(locale) as unknown as Record<string, unknown> & { labels: { footer: Record<string, unknown> } };
    expect(ui).not.toHaveProperty("relatedRole");
    expect(ui.labels.footer).not.toHaveProperty("operator");
  });

  test("en.json legal 에 'Affiliate'·'Operator' 가 없다", () => {
    const legal = en.legal as Record<string, unknown> & { labels: { footer: Record<string, unknown> } };
    expect(legal).not.toHaveProperty("relatedRole");
    expect(legal.labels.footer).not.toHaveProperty("operator");
    const text = JSON.stringify(en);
    expect(text).not.toMatch(/\bOperator\b|\bAffiliate\b/);
  });

  test("공개 화면 소스(app/[locale] · components)가 꼬리표 라벨을 읽지 않는다", () => {
    for (const f of ["components/layout/Footer.tsx", "app/[locale]/(site)/about/page.tsx", "components/home/TrustBar.tsx"]) {
      expect(codeOf(f), f).not.toMatch(/relatedRole|footer\.operator|labels\.operator|RELATED_COMPANY\.role/);
    }
  });
});

// =============================================================================
// 9. 확정 문자 · 알림톡 — 맨 아래 '운영: 합자회사 베스트투어' (접두가 베스트모빌리티로 바뀌어도 계약 상대가 문자에 남게)
// =============================================================================
// OF-T2-3: 고객 변수에 접수 시각이 생겼다(시행일 전 접수 — 이 블록은 판과 무관한 계약 주체 줄을 본다).
const CUSTOMER: CustomerVars = { publicCode: "BT12ABCD", origin: "https://bestour.co.kr", createdAt: CREATED_BEFORE_REFUND_CHANGE };
const OWNER: OwnerVars = {
  ...CUSTOMER,
  reservationId: "3f2b9c14-5f0a-4a2e-9c1b-8d7e6f5a4b3c",
  name: "한지원",
  phone: "+821020488585",
  intake: "quick",
  vehicleLabel: null,
  departAtKst: "2026-10-03",
  returnDateKst: "2026-10-05",
  originLabel: "서울",
  destinationLabel: "부산",
  busCount: null,
  passengers: 40,
};
const isOwnerKey = (k: TemplateKey) => k === "created.owner.sms" || k === "created.owner.email";
const variantsOf = (k: TemplateKey) => (isOwnerKey(k) ? renderVariants(k, OWNER as never) : renderVariants(k, CUSTOMER as never));
const nonEmpty = (s: string) => s.split("\n").filter((l) => l.trim().length > 0);

describe("9. 확정 통지의 계약 주체 줄", () => {
  test("CONTRACT_PARTY_LINE = '운영: ' + 원장 COMPANY.legalName — 상호를 리터럴로 적지 않는다", () => {
    expect(CONTRACT_PARTY_LINE).toBe(`운영: ${COMPANY.legalName}`);
    const code = codeOf("lib/notify/templates.ts");
    expect(code).toMatch(/CONTRACT_PARTY_LINE\s*=\s*`운영: \$\{COMPANY\.legalName\}`/);
    expect(code.includes(COMPANY.legalName)).toBe(false);
    expect(code.match(OLD_BRAND_KO)).toBeNull();
  });

  test("확정 문자 두 판(sms · lms) 모두 맨 아래 줄이 계약 주체 줄이고 정확히 한 번", () => {
    const v = renderVariants("confirmed.customer.sms", CUSTOMER);
    for (const [variant, text] of [["sms", v.sms], ["lms", v.lms]] as const) {
      const rows = nonEmpty(text);
      expect(rows[rows.length - 1], variant).toBe(CONTRACT_PARTY_LINE);
      expect(count(text, CONTRACT_PARTY_LINE), variant).toBe(1);
    }
    // 실제로 나가는 판(LMS)이 상한 안
    const sent = renderTemplate("confirmed.customer.sms", CUSTOMER);
    expect(sent.format).toBe("lms");
    expect(sent.text).toBe(v.lms);
    expect(utf8ByteLength(sent.text)).toBeLessThanOrEqual(LMS_BYTE_LIMIT);
  });

  test("확정 알림톡 초안도 맨 아래 줄이 계약 주체 줄 · 접수 알림톡에는 없다", () => {
    const confirmed = ALIMTALK_TEMPLATES.find((t) => t.event === "confirmed")?.body ?? "";
    const rows = nonEmpty(confirmed);
    expect(rows[rows.length - 1]).toBe(CONTRACT_PARTY_LINE);
    expect(count(confirmed, CONTRACT_PARTY_LINE)).toBe(1);
    // 계약 주체 줄은 확정 통지 전용 — 접수 알림톡(아직 계약 전)과 확정 아닌 문자에는 싣지 않는다
    const others = ALIMTALK_TEMPLATES.filter((t) => t.event !== "confirmed");
    expect(others.length).toBeGreaterThan(0);
    for (const t of others) expect(t.body.includes(CONTRACT_PARTY_LINE), t.event).toBe(false);
    for (const key of ALL_TEMPLATE_KEYS.filter((k) => k !== "confirmed.customer.sms")) {
      const v = variantsOf(key);
      for (const text of [v.sms, v.lms]) expect(text.includes(CONTRACT_PARTY_LINE), key).toBe(false);
    }
  });

  test("모든 문안의 접두는 [베스트모빌리티] — 옛 접두 · '관계사' 0", () => {
    for (const key of ALL_TEMPLATE_KEYS) {
      const v = variantsOf(key);
      for (const [variant, text] of [["sms", v.sms], ["lms", v.lms], ["subject", v.subject ?? ""]] as const) {
        if (variant === "subject" && text === "") continue;
        expect(text.startsWith(`[${COMPANY.brandName}]`), `${key}.${variant}`).toBe(true);
        // 법정 상호(계약 주체 줄)·도메인은 그대로 둔다 — 그 밖의 옛 브랜드 표기 0
        expect(withoutKept(text).match(OLD_BRAND_KO), `${key}.${variant}`).toBeNull();
        expect(text.includes("관계사"), `${key}.${variant}`).toBe(false);
      }
    }
    for (const t of ALIMTALK_TEMPLATES) {
      expect(t.body.startsWith(`[${COMPANY.brandName}]`), t.event).toBe(true);
      expect(t.body.includes("관계사"), t.event).toBe(false);
    }
  });
});

// =============================================================================
// 10. 2013 은 합자회사 베스트투어와 붙어 있다 — 홈 신뢰 바
// =============================================================================
describe("10. 개업 이력(2013)은 법정 상호와 같은 칸", () => {
  test.for(["ko", "en"] as const)("홈 신뢰 바 (%s) — 개업 칸에 법정 상호가 있고 브랜드는 없다", async (locale) => {
    state.locale = locale;
    const html = renderToStaticMarkup(await TrustBar());
    const since = esc(locale === "ko" ? `${COMPANY.establishedYear}년부터` : `Since ${COMPANY.establishedYear}`);
    const li = html.split("<li").find((part) => part.includes(since));
    expect(li, "개업 칸").toBeDefined();
    expect(li!).toContain(esc(COMPANY.legalName));
    expect(li!.includes(esc(COMPANY.brandName))).toBe(false);
    expect(li!.includes(COMPANY.brandNameEn)).toBe(false);
  });
});
