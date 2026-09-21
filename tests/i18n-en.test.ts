/**
 * P2-6 — 영문 페이지(`/en`) 번역 계약.
 *
 * 무엇을 잠그는가
 *   1. en.json 의 구성 — 공개 네임스페이스 전부 + `legal`(원장 UI 문구의 영문), **admin 없음**(관리자는 로케일 밖, 한국어 전용).
 *   2. ko ↔ en 키 패리티 — i18n/messages.ts 는 최상위 shallow 병합이라 en 에 네임스페이스를 넣으면 그 안의 빠진 키는
 *      ko 로 떨어지지 않고 **비어서 깨진다.** 키 집합 · 배열 길이 · 잎 타입 · ICU 인자 · 리치 태그를 전부 같게 한다.
 *   3. en.json 에 한글 0 — 허용 목록 없음.
 *   4. `legal` 네임스페이스 ↔ 원장 — ko 쪽 값은 원장 상수를 **그대로**(같은 참조) 쓰고, 컨트롤러가 확정한 영문은 바이트 그대로다.
 *   5. 옮긴 문구 — 메뉴 라벨은 ko.json 과 lib/legacy-menu-map.ts 가 같은 글자다.
 *   6. 코드 표면 — app/[locale]/** · components/**(관리자 제외)에 한글 리터럴 0(명시적 허용 목록만).
 *   7. 원장 텍스트 사용처 — `/en` 에 한국어로 남는 원장 문자열은 **명시적 허용 목록**(파일 → 원장 기호)에만 있고,
 *      그 블록 위에는 컨트롤러 확정 안내(OfficialKoreanNotice)가 있다. 목록을 넓혀 통과시키지 마라 — 보고서 ③ 이 이 표다.
 *   8. 렌더 실측(EN_BASE_URL 이 있을 때만) — `<html lang="en">` · 영문 title/description · `lang="ko"` 밖 한글 0.
 *
 * 주의: tests/ 아래라 게이트(check-no-pricing · check-legal-disclosures · check-temp-values)의 검사 대상이다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { loadMessages } from "@/i18n/messages";
import { ledgerUi, localizeVerbatim } from "@/lib/i18n/ledger-ui";
import { LEGACY_MENU } from "@/lib/legacy-menu-map";
import {
  COMPANY,
  INSURANCE,
  LEGAL_LABELS,
  LEGAL_PAGES,
  PRIVACY_NOTICE,
  QUOTE_BASIS,
  RELATED_COMPANY,
  VERBATIM,
} from "@/lib/legal/disclosures";

import { documentTitle, findUnmarkedHangul, HANGUL, metaDescription } from "./helpers/hangul-html";
import { stripComments } from "./helpers/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const toPosix = (p: string) => p.split(path.sep).join("/");
const codeOf = (rel: string) => stripComments(read(rel), rel);

const ko = JSON.parse(read("messages/ko.json")) as Record<string, unknown>;
const en = JSON.parse(read("messages/en.json")) as Record<string, unknown>;

/** 공개 네임스페이스 — 브리프 (1). admin 은 넣지 않는다. */
const PUBLIC_NAMESPACES = ["common", "layout", "errors", "home", "reservation", "quote", "reservationCheck", "pages"] as const;

/** 컨트롤러 확정 문안 — 브리프 (3)·(4). 바이트 그대로 쓴다. */
const FIXED = {
  officialNotice:
    "The Korean text below is the official, legally binding version. If you need help understanding it, please contact us before booking.",
  bookingNotice: "We will contact you once your booking is confirmed. Payment is taken only for confirmed bookings.",
  showcaseNotice:
    "Sample quotes for popular routes · Based on a 45-seat coach, same-day round trip · Final quote confirmed after consultation",
  airportMark: "Airport Pickup & Drop-off (Transfer Specialists)",
  registered: "registered charter bus booking agency",
  consentPrivacy: "I agree to the collection and use of my personal information (required)",
  consentMarketing: "I agree to receive marketing messages (optional)",
} as const;

/** 잎 경로 → 값. 배열은 `key[i]`. */
function leafMap(node: unknown, prefix = "", out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(node)) {
    out.set(`${prefix}#length`, node.length);
    node.forEach((v, i) => leafMap(v, `${prefix}[${i}]`, out));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) leafMap(v, prefix === "" ? k : `${prefix}.${k}`, out);
  } else {
    out.set(prefix, node);
  }
  return out;
}

/** ICU 인자 이름(`{name}` · `{name, …}`) */
const icuArgs = (s: string) => [...s.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)].map((m) => m[1]).sort();
/** 리치 텍스트 태그 이름(`<b>` · `<em>` · `<ac>`) — 여는 태그와 닫는 태그 수까지 */
const richTags = (s: string) => [...s.matchAll(/<(\/?)([A-Za-z][A-Za-z0-9]*)>/g)].map((m) => `${m[1]}${m[2]}`).sort();

function walk(absDir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(absDir)) {
    const p = path.join(absDir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** 공개 화면 소스 — app/[locale]/** + components/**(관리자 제외). */
const PUBLIC_SOURCES = ["app/[locale]", "components"]
  .flatMap((dir) => walk(path.join(ROOT, dir)))
  .map((p) => toPosix(path.relative(ROOT, p)))
  .filter((f) => /\.tsx?$/.test(f) && !f.startsWith("components/admin/"))
  .sort();

// =============================================================================
// 1. en.json 구성
// =============================================================================
describe("1. en.json — 공개 네임스페이스 전부 + legal, admin 없음", () => {
  test("최상위 키 = 공개 네임스페이스 8개 + legal", () => {
    expect(Object.keys(en).sort()).toEqual([...PUBLIC_NAMESPACES, "legal"].sort());
  });

  test("admin 은 en 에 없다 — loadMessages('en') 은 admin 을 ko 에서 그대로 받는다", () => {
    expect(en).not.toHaveProperty("admin");
    const merged = loadMessages("en") as Record<string, unknown>;
    expect(merged.admin).toEqual(ko.admin);
    for (const ns of PUBLIC_NAMESPACES) expect(merged[ns], ns).toEqual(en[ns]);
    expect(merged.legal).toEqual(en.legal);
  });

  test("ko 에는 공개 네임스페이스와 admin 이 있고 legal 은 없다 (ko 원장 UI 문구는 원장 상수에서 온다)", () => {
    for (const ns of [...PUBLIC_NAMESPACES, "admin"]) expect(ko, ns).toHaveProperty(ns);
    expect(ko).not.toHaveProperty("legal");
  });
});

// =============================================================================
// 2. 키 패리티
// =============================================================================
describe("2. ko ↔ en 키 패리티 (공개 네임스페이스)", () => {
  test.for(PUBLIC_NAMESPACES.map((ns) => [ns] as const))("%s — 잎 경로·배열 길이가 같다", ([ns]) => {
    const k = leafMap(ko[ns]);
    const e = leafMap(en[ns]);
    expect(k.size, `${ns} 가 비었다`).toBeGreaterThan(0);
    expect([...e.keys()].sort()).toEqual([...k.keys()].sort());
  });

  test.for(PUBLIC_NAMESPACES.map((ns) => [ns] as const))("%s — 잎 타입이 같고, 숫자 잎은 값까지 같다", ([ns]) => {
    const k = leafMap(ko[ns]);
    const e = leafMap(en[ns]);
    for (const [p, v] of k) {
      expect(typeof e.get(p), `${ns}.${p}`).toBe(typeof v);
      if (typeof v === "number") expect(e.get(p), `${ns}.${p}`).toBe(v);
      if (typeof v === "string") expect((e.get(p) as string).trim().length, `${ns}.${p} 가 빈 문자열이다`).toBeGreaterThan(0);
    }
  });

  test.for(PUBLIC_NAMESPACES.map((ns) => [ns] as const))("%s — ICU 인자와 리치 태그가 같다", ([ns]) => {
    const k = leafMap(ko[ns]);
    const e = leafMap(en[ns]);
    for (const [p, v] of k) {
      if (typeof v !== "string") continue;
      const ev = e.get(p) as string;
      expect(icuArgs(ev), `${ns}.${p} ICU 인자`).toEqual(icuArgs(v));
      expect(richTags(ev), `${ns}.${p} 리치 태그`).toEqual(richTags(v));
    }
  });

  test("패리티 검사가 빈 통과가 아니다 — 공개 잎 350개 이상", () => {
    const total = PUBLIC_NAMESPACES.reduce((n, ns) => n + [...leafMap(en[ns]).keys()].filter((p) => !p.endsWith("#length")).length, 0);
    expect(total).toBeGreaterThan(350);
  });
});

// =============================================================================
// 3. en.json 에 한글 0
// =============================================================================
describe("3. en.json — 한글 0 (허용 목록 없음)", () => {
  test("모든 잎에 한글이 없다", () => {
    const hits = [...leafMap(en)].filter(([, v]) => typeof v === "string" && HANGUL.test(v)).map(([p, v]) => `${p} :: ${String(v)}`);
    expect(hits, hits.join("\n")).toEqual([]);
  });
});

// =============================================================================
// 4. legal 네임스페이스 ↔ 원장
// =============================================================================
describe("4. 원장 UI 문구 — ko 는 원장 그대로, en 은 컨트롤러 확정 영문", () => {
  const koUi = ledgerUi("ko");
  const enUi = ledgerUi("en");

  test("ko 는 원장 상수를 같은 값으로 돌려준다 (윤문 0)", () => {
    expect(koUi.brand).toBe(COMPANY.brandName);
    expect(koUi.representative).toBe(COMPANY.representative);
    expect(koUi.officialNotice).toBeNull();
    expect(koUi.verbatim.bookingNotice).toBe(VERBATIM.bookingNotice);
    expect(koUi.verbatim.showcaseNotice).toBe(VERBATIM.showcaseNotice);
    expect(koUi.pages).toEqual({
      privacy: LEGAL_PAGES.privacy.title,
      terms: LEGAL_PAGES.terms.title,
      guide: LEGAL_PAGES.guide.title,
    });
    expect(koUi.headings).toEqual({
      quoteBasis: QUOTE_BASIS.title,
      insurance: INSURANCE.title,
      privacyNotice: PRIVACY_NOTICE.title,
    });
    expect(koUi.consent).toEqual({ privacy: PRIVACY_NOTICE.consentLabel, marketing: PRIVACY_NOTICE.marketingConsentLabel });
    expect(koUi.relatedRole).toBe(RELATED_COMPANY.role);
    expect(koUi.labels.effectiveDate).toBe(LEGAL_LABELS.effectiveDate);
    expect(koUi.labels.home).toBe(LEGAL_LABELS.home);
    expect(koUi.labels.legalNav).toBe(LEGAL_LABELS.legalNav);
    expect(koUi.labels.officer).toEqual({ phone: LEGAL_LABELS.officer.phone });
    for (const k of Object.keys(koUi.labels.contact) as (keyof typeof koUi.labels.contact)[]) {
      expect(koUi.labels.contact[k], `contact.${k}`).toBe(LEGAL_LABELS.contact[k]);
    }
    for (const k of Object.keys(koUi.labels.footer) as (keyof typeof koUi.labels.footer)[]) {
      expect(koUi.labels.footer[k], `footer.${k}`).toBe(LEGAL_LABELS.footer[k]);
    }
    expect(Object.keys(koUi.labels.footer).sort()).toEqual(Object.keys(LEGAL_LABELS.footer).sort());
  });

  test("en.json legal 과 ko 원장 UI 의 키 구조가 같다 (officialNotice 는 en 에만 값이 있다)", () => {
    // brand·representative 는 en.json 이 아니라 원장의 영문 필드에서 온다(아래 단언). officialNotice 는 ko 에서 null.
    const koRest: Record<string, unknown> = { ...koUi };
    for (const k of ["brand", "representative", "officialNotice"]) delete koRest[k];
    const enRest: Record<string, unknown> = { ...(en.legal as Record<string, unknown>) };
    const officialNotice = enRest.officialNotice;
    delete enRest.officialNotice;
    expect([...leafMap(enRest).keys()].sort()).toEqual([...leafMap(koRest).keys()].sort());
    expect(Object.keys(officialNotice as object).sort()).toEqual(["body", "lead"]);
  });

  test("en 의 상호·대표자는 원장의 영문 필드(COMPANY.brandNameEn · representativeEn)다 — 지어내지 않는다", () => {
    expect(enUi.brand).toBe(COMPANY.brandNameEn);
    expect(enUi.representative).toBe(COMPANY.representativeEn);
  });

  test("컨트롤러 확정 문안이 바이트 그대로다", () => {
    expect(`${enUi.officialNotice?.lead} ${enUi.officialNotice?.body}`).toBe(FIXED.officialNotice);
    expect(enUi.officialNotice?.lead).toBe("The Korean text below is the official, legally binding version.");
    expect(enUi.verbatim.bookingNotice).toBe(FIXED.bookingNotice);
    expect(enUi.verbatim.showcaseNotice).toBe(FIXED.showcaseNotice);
    expect(enUi.consent.privacy).toBe(FIXED.consentPrivacy);
    expect(enUi.consent.marketing).toBe(FIXED.consentMarketing);
  });

  test("localizeVerbatim — ko 는 받은 원장 문자열 그 자체, en 은 확정 영문", () => {
    expect(localizeVerbatim("ko", VERBATIM.bookingNotice)).toBe(VERBATIM.bookingNotice);
    expect(localizeVerbatim("ko", VERBATIM.showcaseNotice)).toBe(VERBATIM.showcaseNotice);
    expect(localizeVerbatim("en", VERBATIM.bookingNotice)).toBe(FIXED.bookingNotice);
    expect(localizeVerbatim("en", VERBATIM.showcaseNotice)).toBe(FIXED.showcaseNotice);
  });

  test("ko verbatim 두 문구는 CLAUDE.md §3 원문과 바이트 일치 (ko 는 한 글자도 바꾸지 않았다)", () => {
    expect(VERBATIM.bookingNotice).toBe("사장님 확정 후 연락드리며, 확정된 예약만 결제 진행됩니다.");
    expect(VERBATIM.showcaseNotice).toBe("대표 노선 예시 견적 · 45인승 당일왕복 기준 · 실제 견적은 상담 후 확정");
  });

  test("확정 표기 — ko 에 '공항 픽업·샌딩 (송영 전문)' 이 있는 잎은 en 같은 자리에 확정 영문이 있다", () => {
    const k = leafMap(Object.fromEntries(PUBLIC_NAMESPACES.map((ns) => [ns, ko[ns]])));
    const e = leafMap(Object.fromEntries(PUBLIC_NAMESPACES.map((ns) => [ns, en[ns]])));
    const paths = [...k].filter(([, v]) => typeof v === "string" && v.includes("공항 픽업·샌딩 (송영 전문)")).map(([p]) => p);
    expect(paths.length).toBeGreaterThanOrEqual(4);
    for (const p of paths) expect(e.get(p), p).toContain(FIXED.airportMark);
    // 원문 한국어 괄호 표기를 영문 속에 섞지 않았다
    for (const [p, v] of e) if (typeof v === "string") expect(v.includes("송영"), p).toBe(false);
  });

  test("'정식 등록 알선업체' 자리는 확정 영문 'registered charter bus booking agency' 다", () => {
    const k = leafMap(Object.fromEntries(PUBLIC_NAMESPACES.map((ns) => [ns, ko[ns]])));
    const e = leafMap(Object.fromEntries(PUBLIC_NAMESPACES.map((ns) => [ns, en[ns]])));
    const paths = [...k].filter(([, v]) => typeof v === "string" && v.includes("등록 알선업체")).map(([p]) => p);
    expect(paths.length).toBeGreaterThanOrEqual(2);
    for (const p of paths) expect(String(e.get(p)).toLowerCase(), p).toContain(FIXED.registered);
  });

  test("영문 브랜드 표기는 하나 — 'Bestour' (원장 COMPANY.brandNameEn). 'Best Tour'·'BEST TOUR' 변형 0", () => {
    const text = JSON.stringify(en);
    expect(text).toContain(COMPANY.brandNameEn);
    expect(/best\s+tour/i.test(text)).toBe(false);
    expect((en.common as Record<string, string>).siteName).toBe(COMPANY.brandNameEn);
  });
});

// =============================================================================
// 5. 옮긴 문구 — 메뉴 라벨
// =============================================================================
describe("5. 메뉴 라벨 — ko.json layout.menu 는 옛 메뉴 텍스트(LEGACY_MENU.labelKo)와 같은 글자", () => {
  const koMenu = (ko.layout as Record<string, Record<string, string>>).menu;
  const enMenu = (en.layout as Record<string, Record<string, string>>).menu;

  test("키 집합 = LEGACY_MENU 의 key 집합 (ko·en)", () => {
    const keys = LEGACY_MENU.map((m) => m.key).sort();
    expect(Object.keys(koMenu ?? {}).sort()).toEqual(keys);
    expect(Object.keys(enMenu ?? {}).sort()).toEqual(keys);
  });

  test.for(LEGACY_MENU.map((m) => [m.key, m.labelKo] as const))("%s — ko 라벨이 labelKo 와 바이트 일치", ([key, label]) => {
    expect(koMenu[key]).toBe(label);
  });

  test("Nav 는 labelKo 를 직접 렌더하지 않는다 — 서버 부모가 로케일 라벨을 넘긴다", () => {
    expect(codeOf("components/layout/Nav.tsx")).not.toMatch(/\.labelKo\b/);
  });
});

// =============================================================================
// 6. 코드 표면 — 한글 리터럴 0 (명시적 허용 목록)
// =============================================================================
/**
 * 허용 목록 — `/en` 화면에 한글을 내보내지 않는 한글 리터럴. 파일 + 줄 조각 + 사유.
 * 번역이 빠진 문구를 여기로 옮겨 통과시키지 마라. 항목이 더는 쓰이지 않으면 아래 단언이 실패한다.
 */
const HANGUL_CODE_ALLOW: ReadonlyArray<{ file: string; line: string; reason: string }> = [
  {
    file: "components/KrMap/format.ts",
    line: "만원",
    reason: "ko 전용 금액 표기(formatPriceKrw). en 은 formatPriceKrwEn 이 `KRW 400,000` 으로 낸다.",
  },
  {
    file: "components/home/HowItWorks.tsx",
    line: "throw new Error",
    reason: "개발자용 불변식 예외 문구 — 화면에 렌더되지 않는다((site)/error.tsx 는 message 를 렌더하지 않는다).",
  },
  {
    file: "components/quote/options.ts",
    line: "throw new Error",
    reason: "개발자용 불변식 예외 문구 — 화면에 렌더되지 않는다.",
  },
  {
    file: "components/home/popup-preview.ts",
    line: "title:",
    reason: "개발 전용 프리뷰 더미(?previewPopup=1, production 죽은 코드) — 운영 팝업은 DB 의 사장님 글이다.",
  },
  {
    file: "components/home/popup-preview.ts",
    line: "body:",
    reason: "개발 전용 프리뷰 더미(위와 같다).",
  },
  {
    file: "components/home/recent-feed-preview.ts",
    line: "name:",
    reason: "개발 전용 프리뷰 더미 원문 이름 — 마스킹 경로 실측용(production 죽은 코드).",
  },
  {
    file: "components/reservation-check/preview-result.ts",
    line: "",
    reason: "개발 전용 프리뷰 더미(?previewResult=, production 죽은 코드) — 실제 결과는 서버액션이 낸다.",
  },
];

describe("6. 공개 화면 코드 — 한글 리터럴 0 (주석 제외, 명시적 허용 목록만)", () => {
  test("검사 대상이 있다", () => {
    expect(PUBLIC_SOURCES.length).toBeGreaterThan(60);
  });

  test("허용 목록 밖의 한글 줄이 0이다", () => {
    const hits: string[] = [];
    for (const file of PUBLIC_SOURCES) {
      codeOf(file)
        .split("\n")
        .forEach((line, i) => {
          if (!HANGUL.test(line)) return;
          const ok = HANGUL_CODE_ALLOW.some((a) => a.file === file && line.includes(a.line));
          if (!ok) hits.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  test("허용 목록 항목마다 사유가 있고, 아직 쓰이는 항목이다 (죽은 항목 금지)", () => {
    for (const a of HANGUL_CODE_ALLOW) {
      expect(a.reason.trim().length, `${a.file} 사유`).toBeGreaterThan(10);
      const used = codeOf(a.file)
        .split("\n")
        .some((l) => HANGUL.test(l) && l.includes(a.line));
      expect(used, `${a.file} :: "${a.line}" — 더는 쓰이지 않는 허용 항목`).toBe(true);
    }
  });
});

// =============================================================================
// 7. 원장 텍스트 사용처 — /en 에 한국어로 남는 원장 문자열의 명시적 목록
// =============================================================================
/**
 * `/en` 에 한국어 그대로 렌더되는 원장 문자열 — **보고서 ③ 의 원천**. 컨트롤러가 이 표를 보고 영문판을 확정한다.
 *
 *   notice: true  → 그 블록 위에 OfficialKoreanNotice(컨트롤러 확정 안내)를 둔다(파일에 JSX 사용이 있어야 한다).
 *   notice: false → 산문이 아니라 식별자(상호·등록번호·주소)라 안내 없이 `lang="ko"` 로만 표시한다(koLang 사용).
 *   notice: "via" → 그 문자열을 만드는 도우미 — 안내는 소비자(`via`)가 둔다.
 *
 * 원장 라벨·제목·verbatim 은 여기 없다 — ledgerUi(locale) · localizeVerbatim 을 거쳐 en 에서 영문이 된다.
 * 법정 문서 3쪽(/privacy·/terms·/guide)은 본문 전체(절 제목·표 머리·조 번호 포함)가 원장 한국어다.
 */
const LEDGER_ON_EN: ReadonlyArray<{ file: string; refs: readonly string[]; screen: string; notice: boolean | { via: string } }> = [
  { file: "app/[locale]/(legal)/guide/page.tsx", screen: "/en/guide 본문 전체", notice: true, refs: ["CANCELLATION", "COMPANY[]", "DISPUTE", "GUIDE_SECTIONS", "INSURANCE", "LEGAL_LABELS", "MINORS", "PAYMENT", "QUOTE_BASIS", "VERBATIM"] },
  { file: "app/[locale]/(legal)/privacy/page.tsx", screen: "/en/privacy 본문 전체", notice: true, refs: ["COMPANY.privacyOfficer", "LEGAL_LABELS", "OVERSEAS_TRANSFERS", "PRIVACY_NOTICE", "PRIVACY_POLICY_SECTIONS", "PROCESSORS"] },
  { file: "app/[locale]/(legal)/terms/page.tsx", screen: "/en/terms 본문 전체", notice: true, refs: ["TERMS"] },
  { file: "components/legal/LegalArticle.tsx", screen: "/en/terms 조 번호(제N조)", notice: { via: "app/[locale]/(legal)/terms/page.tsx" }, refs: ["LEGAL_LABELS"] },
  { file: "app/[locale]/(site)/about/page.tsx", screen: "/en/about 회사 정보 표 · 찾아오시는 길 주소", notice: true, refs: ["COMPANY.address", "COMPANY.branchAddress", "COMPANY.legalName", "COMPANY.mailOrderIssuer", "COMPANY.mailOrderNo"] },
  { file: "app/[locale]/(site)/fares/page.tsx", screen: "/en/fares 산정 기준 칩 · 대금 지급", notice: true, refs: ["PAYMENT", "QUOTE_BASIS"] },
  { file: "app/[locale]/(site)/fleet/page.tsx", screen: "/en/fleet 보험 본문", notice: true, refs: ["INSURANCE"] },
  { file: "app/[locale]/(site)/quote/page.tsx", screen: "/en/quote 6단계 동의 고지 본문", notice: true, refs: ["PRIVACY_NOTICE"] },
  { file: "components/quote/WithdrawalNotice.tsx", screen: "/en/quote 6단계 접수 전 확인 사항", notice: true, refs: ["CANCELLATION", "PAYMENT", "QUOTE_BASIS", "TERMS"] },
  { file: "components/quote/withdrawal.ts", screen: "/en/quote 6단계 청약철회 문장", notice: { via: "components/quote/WithdrawalNotice.tsx" }, refs: ["TERMS"] },
  { file: "components/home/HowItWorks.tsx", screen: "/en 이용 방법 4단계 · 산정 기준 · 대금 지급", notice: true, refs: ["GUIDE_SECTIONS", "PAYMENT", "QUOTE_BASIS"] },
  { file: "components/home/RecentFeed.tsx", screen: "/en 접수 현황 공개 고지(행이 있을 때만)", notice: true, refs: ["PRIVACY_NOTICE"] },
  { file: "components/home/TrustBar.tsx", screen: "/en 신뢰 지표 — 통신판매업 신고번호 · 법인 상호", notice: false, refs: ["COMPANY.legalName", "COMPANY.mailOrderNo"] },
  { file: "components/layout/Footer.tsx", screen: "/en/* 푸터 사업자 정보", notice: true, refs: ["COMPANY.address", "COMPANY.bankAccount", "COMPANY.branchAddress", "COMPANY.legalName", "COMPANY.mailOrderIssuer", "COMPANY.mailOrderNo", "COMPANY.privacyOfficer", "RELATED_COMPANY"] },
];

/** 한국어 산문을 담은 원장 기호 — 참조가 곧 `/en` 에 한국어가 남는다는 뜻이다. */
const PROSE_SYMBOLS = [
  "QUOTE_BASIS",
  "PAYMENT",
  "CANCELLATION",
  "PRIVACY_NOTICE",
  "PROCESSORS",
  "OVERSEAS_TRANSFERS",
  "INSURANCE",
  "DISPUTE",
  "MINORS",
  "TERMS",
  "PRIVACY_POLICY_SECTIONS",
  "GUIDE_SECTIONS",
  "RELATED_COMPANY",
  "LEGAL_LABELS",
] as const;
/** COMPANY 의 한글 값 필드 — tel·mobile·fax·email·bizRegNo 는 숫자·ASCII 라 빠진다. */
const COMPANY_KO_FIELDS = [
  "legalName",
  "brandName",
  "representative",
  "mailOrderNo",
  "mailOrderIssuer",
  "address",
  "branchAddress",
  "bankAccount",
  "bankHolder",
  "privacyOfficer",
] as const;

/** 파일이 참조하는 한국어 원장 기호(정렬·중복 제거). import 문과 주석은 빼고 본다. */
function koreanLedgerRefs(file: string): string[] {
  const code = codeOf(file).replace(/import\s*(?:type\s*)?\{[^}]*\}\s*from\s*["'][^"']+["'];?/g, "");
  const refs = new Set<string>();
  for (const sym of PROSE_SYMBOLS) if (new RegExp(`\\b${sym}\\b`).test(code)) refs.add(sym);
  for (const f of COMPANY_KO_FIELDS) if (new RegExp(`\\bCOMPANY\\.${f}\\b`).test(code)) refs.add(`COMPANY.${f}`);
  if (/\bCOMPANY\[/.test(code)) refs.add("COMPANY[]");
  // LEGAL_PAGES 는 제목만 한글이다(시행일은 날짜). 제목을 직접 읽으면 en 에서도 한국어다 — ledgerUi(locale).pages 를 써야 한다.
  if (/\bLEGAL_PAGES\.\w+\.title\b/.test(code)) refs.add("LEGAL_PAGES.title");
  // VERBATIM 은 localizeVerbatim(locale, VERBATIM.x) 로 감싸면 en 에서 확정 영문이 된다. 감싸지 않은 참조만 센다.
  for (const line of code.split("\n")) {
    for (const m of line.matchAll(/\bVERBATIM\.\w+/g)) {
      const before = line.slice(0, m.index);
      if (!/localizeVerbatim\(\s*\w+\s*,\s*$/.test(before)) refs.add("VERBATIM");
    }
  }
  return [...refs].sort();
}

describe("7. /en 에 한국어로 남는 원장 문자열 — 명시적 허용 목록", () => {
  test("공개 화면 파일 전수: 한국어 원장 참조 = 허용 목록 (넓히지도, 빠뜨리지도 않는다)", () => {
    const actual = Object.fromEntries(
      PUBLIC_SOURCES.map((f) => [f, koreanLedgerRefs(f)] as const).filter(([, refs]) => refs.length > 0),
    );
    const expected = Object.fromEntries(LEDGER_ON_EN.map((e) => [e.file, [...e.refs].sort()]));
    expect(actual).toEqual(expected);
  });

  test("notice: true 인 파일은 컨트롤러 확정 안내를 렌더한다", () => {
    for (const e of LEDGER_ON_EN) {
      if (e.notice !== true) continue;
      const code = codeOf(e.file);
      const rendersNotice = /<OfficialKoreanNotice\b/.test(code) || /\bofficialNotice\s*:/.test(code);
      expect(rendersNotice, `${e.file} 에 OfficialKoreanNotice 가 없다`).toBe(true);
    }
  });

  test("notice: false 인 파일은 한국어 값을 lang=\"ko\" 로 표시한다 (koLang)", () => {
    for (const e of LEDGER_ON_EN) {
      if (e.notice !== false) continue;
      expect(codeOf(e.file), e.file).toMatch(/\bkoLang\(/);
    }
  });

  test("notice: via 인 도우미는 소비자가 안내를 렌더한다", () => {
    for (const e of LEDGER_ON_EN) {
      const notice = e.notice;
      if (typeof notice !== "object") continue;
      const consumer = LEDGER_ON_EN.find((x) => x.file === notice.via);
      expect(consumer?.notice, `${e.file} → ${notice.via}`).toBe(true);
    }
  });

  test("안내 컴포넌트는 ledgerUi 의 officialNotice 만 렌더한다 — ko(null)에서는 아무것도 내지 않는다", () => {
    const src = codeOf("components/legal/OfficialKoreanNotice.tsx");
    expect(src).toMatch(/if\s*\(\s*!notice\s*\)\s*return null/);
    expect(src).toMatch(/data-legal="official-korean-notice"/);
    // 문안은 en.json legal.officialNotice 한 곳에만 — 컴포넌트에 다시 적지 않는다
    expect(src).not.toMatch(/legally binding|Korean text below/);
  });
});

// =============================================================================
// 8. 렌더 실측 — EN_BASE_URL(예: http://localhost:3000) 이 있을 때만. GET 만 한다.
// =============================================================================
/** DB 자유 텍스트 컨테이너 — 사장님 공지 · 갤러리 캡션 · 앨범 · 접수 현황(마스킹 이름). 번역 대상이 아니다. */
const OWNER_CONTENT_TESTIDS = ["notice-list", "gallery-grid", "album-cards", "album-gallery-grid", "recent-feed", "popup"] as const;

describe("8-a. findUnmarkedHangul — 판정 픽스처", () => {
  test("표시 없는 한글 텍스트는 잡는다", () => {
    expect(findUnmarkedHangul("<main><p>안녕</p></main>")).toHaveLength(1);
  });
  test("lang=ko 하위는 통과 (중첩 포함)", () => {
    expect(findUnmarkedHangul('<div lang="ko"><section><p>안녕</p></section></div>')).toEqual([]);
  });
  test("lang=ko 가 닫힌 뒤의 한글은 잡는다 — void·self-closing 요소가 스택을 어지럽히지 않는다", () => {
    expect(findUnmarkedHangul('<div lang="ko"><img alt="x"><br/>안녕</div>')).toEqual([]);
    expect(findUnmarkedHangul('<div lang="ko"><img alt="x"></div><p>안녕</p>')).toHaveLength(1);
  });
  test("script·style·주석은 보지 않는다", () => {
    expect(findUnmarkedHangul('<script>self.__next_f.push("안녕")</script><style>/*안녕*/</style><!-- 안녕 -->')).toEqual([]);
  });
  test("읽히는 속성(alt·aria-label·title·placeholder·content)은 잡는다 — 요소 자신의 lang=ko 면 통과", () => {
    expect(findUnmarkedHangul('<img alt="버스">')).toHaveLength(1);
    expect(findUnmarkedHangul('<a aria-label="대표전화 1566">x</a>')).toHaveLength(1);
    expect(findUnmarkedHangul('<meta name="description" content="설명">')).toHaveLength(1);
    expect(findUnmarkedHangul('<img lang="ko" alt="버스">')).toEqual([]);
    expect(findUnmarkedHangul('<a href="/x" data-x="한글">x</a>')).toEqual([]); // 읽히지 않는 속성
  });
  test("허용 testid 하위는 통과", () => {
    expect(findUnmarkedHangul('<ul data-testid="notice-list"><li>공지</li></ul>', ["notice-list"])).toEqual([]);
    expect(findUnmarkedHangul('<ul data-testid="other"><li>공지</li></ul>', ["notice-list"])).toHaveLength(1);
  });
  test("title·description 추출", () => {
    const html = '<head><title>Hi &amp; bye</title><meta name="description" content="Desc"/></head>';
    expect(documentTitle(html)).toBe("Hi & bye");
    expect(metaDescription(html)).toBe("Desc");
  });
});

const EN_BASE = process.env.EN_BASE_URL;
const EN_ROUTES = [
  "/en",
  "/en/about",
  "/en/fleet",
  "/en/fares",
  "/en/quote",
  "/en/quote/done",
  "/en/reservation/check",
  "/en/notices",
  "/en/gallery",
  "/en/privacy",
  "/en/terms",
  "/en/guide",
] as const;
/** 원장 블록이 있어 안내가 보여야 하는 영문 경로 */
const NOTICE_ROUTES = ["/en", "/en/about", "/en/fleet", "/en/fares", "/en/privacy", "/en/terms", "/en/guide"] as const;

describe.runIf(Boolean(EN_BASE))("8-b. 렌더 실측 — /en (GET)", { timeout: 120_000 }, () => {
  const fetchHtml = async (p: string) => {
    const res = await fetch(`${EN_BASE}${p}`);
    return { status: res.status, html: await res.text() };
  };

  test.for(EN_ROUTES.map((r) => [r] as const))("%s — 200 · lang=en · 영문 title/description · lang=ko 밖 한글 0", async ([route]) => {
    const { status, html } = await fetchHtml(route);
    expect(status).toBe(200);
    expect(html).toMatch(/<html[^>]*\slang="en"/);
    const title = documentTitle(html);
    expect(title && title.length > 0, `${route} title 없음`).toBe(true);
    expect(HANGUL.test(title ?? ""), `${route} title: ${title}`).toBe(false);
    const desc = metaDescription(html);
    if (desc !== null) expect(HANGUL.test(desc), `${route} description: ${desc}`).toBe(false);
    const hits = findUnmarkedHangul(html, OWNER_CONTENT_TESTIDS);
    expect(hits.map((h) => `${h.where} @ ${h.path}: ${h.value}`)).toEqual([]);
  });

  test.for(NOTICE_ROUTES.map((r) => [r] as const))("%s — 컨트롤러 확정 안내가 보인다", async ([route]) => {
    const { html } = await fetchHtml(route);
    expect(html).toContain('data-legal="official-korean-notice"');
    expect(html).toContain("The Korean text below is the official, legally binding version.");
  });

  test("ko 화면에는 안내가 없다 — /, /privacy, /about", async () => {
    for (const p of ["/", "/privacy", "/about"]) {
      const { html } = await fetchHtml(p);
      expect(html, p).not.toContain("official-korean-notice");
      expect(html, p).toMatch(/<html[^>]*\slang="ko"/);
    }
  });

  test("/en 은 hreflang 대안(ko·en·x-default)을 선언하고 canonical 이 자기 자신(/en)이다", async () => {
    const { html } = await fetchHtml("/en");
    for (const lang of ["ko", "en", "x-default"]) expect(html, lang).toMatch(new RegExp(`<link[^>]*hrefLang="${lang}"`, "i"));
    expect(html).toMatch(/<link[^>]*rel="canonical"[^>]*href="[^"]*\/en"/);
  });
});
