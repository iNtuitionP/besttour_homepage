/**
 * P1-6 — 법정 페이지 3종 `/privacy` `/terms` `/guide` 계약 테스트 (플랜 v4 P1-6 · ADR-5).
 *
 * 브리프 §검증을 그대로 단언한다:
 *   1. 원장 소스 — TERMS 12조(no 1..12 연속·title/body 비어 있지 않음) · PRIVACY_POLICY_SECTIONS 13절
 *      (rights·destruction·safety·cookies·remedy·changes·publicFeed 포함) · GUIDE_SECTIONS 8절 · LEGAL_PAGES
 *   2. 조문 ↔ 원장 키 ↔ 페이지 경로 매핑표(상수, 20행 이상) — 각 원장 키가 실제 export 되고 값이 비어 있지 않으며,
 *      해당 페이지 소스가 그 최상위 상수를 import 한다(정적 grep). "섹션 존재" 가 아니라 "법적 요건 → 코드 위치" 를 잠근다.
 *   3. 페이지 3개 + 레이아웃 + 컴포넌트 소스에 한글 리터럴 0건(주석 제외) — 문구는 전부 원장 import
 *   4. 원장 함수 export 0 유지 · 새 임시값 마커는 허용 목록에 (check-legal-disclosures.sh · check-temp-values.sh exit 0)
 *   5. dev 서버 응답 — LEGAL_BASE_URL 이 주어졌을 때만 HTTP 로 단언(그 외는 browse 실측 보고서가 담당)
 *
 * 주의: tests/ 는 세 게이트의 검사 대상이다. 임시값 마커 리터럴은 문자열 결합으로 조립한다(tests/legal.test.ts 규약).
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import * as ledger from "@/lib/legal/disclosures";
import {
  CANCELLATION,
  COMPANY,
  GUIDE_SECTIONS,
  LEGAL_LINKS,
  LEGAL_PAGES,
  OVERSEAS_TRANSFERS,
  PRIVACY_NOTICE,
  PRIVACY_POLICY_SECTIONS,
  PROCESSORS,
  TERMS,
} from "@/lib/legal/disclosures";

import { stripComments } from "./helpers/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LEDGER_REL = "lib/legal/disclosures.ts";
const ALLOWLIST_REL = "scripts/gates/temp-allowlist.txt";
const GATE_TIMEOUT_MS = 90_000;
const TEMP_MARKER = "[TEMP" + "]";

// ── 페이지·컴포넌트 소스 (한글 리터럴 0건 검사 대상) ─────────────────────
const PAGE_FILES = {
  privacy: "app/[locale]/(legal)/privacy/page.tsx",
  terms: "app/[locale]/(legal)/terms/page.tsx",
  guide: "app/[locale]/(legal)/guide/page.tsx",
  layout: "app/[locale]/(legal)/layout.tsx",
} as const;
const COMPONENT_FILES = [
  "components/legal/LegalArticle.tsx",
  "components/legal/LegalTable.tsx",
  "components/legal/LegalPageHeader.tsx",
  "components/legal/legal.module.css",
] as const;
type PagePath = "/privacy" | "/terms" | "/guide" | "(legal)/layout";
const PATH_TO_FILE: Record<PagePath, string> = {
  "/privacy": PAGE_FILES.privacy,
  "/terms": PAGE_FILES.terms,
  "/guide": PAGE_FILES.guide,
  "(legal)/layout": PAGE_FILES.layout,
};

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

/** 주석을 걷어낸 코드. 제거기는 저장소에 하나뿐이다(`tests/helpers/strip-comments.ts` · P6-7/P6-8 · D7). */
const codeOf = (rel: string) => stripComments(read(rel), rel);

const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;

/** `import { A, B } from "@/lib/legal/disclosures"` 블록에서 가져온 식별자 목록 */
function ledgerImports(src: string): string[] {
  const names: string[] = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/legal\/disclosures["']/g;
  for (const m of src.matchAll(re)) {
    for (const raw of m[1].split(",")) {
      const n = raw.trim().split(/\s+as\s+/)[0].trim();
      if (n) names.push(n);
    }
  }
  return names;
}

/** "PRIVACY_NOTICE.purpose" 같은 점 경로를 원장 네임스페이스에서 해석한다 */
function resolveKey(keyPath: string): unknown {
  return keyPath.split(".").reduce<unknown>((acc, seg) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[seg];
  }, ledger as unknown);
}

function isNonEmpty(v: unknown): boolean {
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number" || typeof v === "boolean") return true;
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") return Object.keys(v).length > 0;
  return false;
}

// ── bash 해석 (tests/gates.test.ts 와 동일) ───────────────────────────────
function resolveBash(): { bin: string; env: NodeJS.ProcessEnv } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (process.env.BASH_PATH) return { bin: process.env.BASH_PATH, env };
  if (process.platform !== "win32") return { bin: "bash", env };
  const roots: string[] = [];
  try {
    const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
    roots.push(path.resolve(execPath, "..", "..", ".."));
  } catch {
    // git 이 PATH 에 없으면 고정 후보로
  }
  roots.push("C:\\Program Files\\Git", "C:\\Program Files (x86)\\Git");
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, "Programs", "Git"));
  for (const root of roots) {
    const bin = path.join(root, "bin", "bash.exe");
    if (!existsSync(bin)) continue;
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    env[pathKey] = [path.join(root, "usr", "bin"), path.join(root, "mingw64", "bin"), env[pathKey] ?? ""].join(
      path.delimiter,
    );
    return { bin, env };
  }
  return { bin: "bash", env };
}
const toPosix = (p: string) => p.split(path.sep).join("/");
function runGate(rel: string): Promise<{ status: number | null; out: string }> {
  const bash = resolveBash();
  return new Promise((resolve, reject) => {
    const child = spawn(bash.bin, [toPosix(path.join(ROOT, rel))], {
      env: { ...bash.env, CLAUDE_PROJECT_DIR: toPosix(ROOT) },
      windowsHide: true,
    });
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => (out += c));
    child.stderr.setEncoding("utf8").on("data", (c: string) => (out += c));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, out }));
  });
}

// ═════════════════════════════════════════════════════════════════════════
describe("1. 원장 소스 — 새 상수 4종", () => {
  test("TERMS.articles 는 12조, no 1..12 연속, title·body 비어 있지 않음", () => {
    expect(TERMS.articles).toHaveLength(12);
    expect(TERMS.articles.map((a) => a.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const a of TERMS.articles) {
      expect(a.title.trim().length, `no=${a.no}`).toBeGreaterThan(0);
      expect(a.body.trim().length, `no=${a.no}`).toBeGreaterThan(0);
    }
  });

  test("TERMS 는 청약철회 제한 근거(전자상거래법 제17조 제2항)와 계약 성립 시점을 말한다", () => {
    const art8 = TERMS.articles.find((a) => a.no === 8);
    expect(art8?.body).toContain("제17조 제2항");
    const art5 = TERMS.articles.find((a) => a.no === 5);
    expect(art5?.body).toContain("계약이 성립");
  });

  test("PRIVACY_POLICY_SECTIONS 13절 — 비평이 지적한 7항목 포함, key 중복 없음", () => {
    expect(PRIVACY_POLICY_SECTIONS).toHaveLength(13);
    const keys = PRIVACY_POLICY_SECTIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(13);
    for (const k of ["rights", "destruction", "safety", "cookies", "remedy", "changes", "publicFeed"]) {
      expect(keys, k).toContain(k);
    }
    for (const k of ["purpose", "items", "retention", "processors", "overseas", "officer"]) {
      expect(keys, k).toContain(k);
    }
    for (const s of PRIVACY_POLICY_SECTIONS) expect(s.title.trim().length, s.key).toBeGreaterThan(0);
  });

  test("PRIVACY_POLICY_SECTIONS 의 body 절은 비어 있지 않고, from 절은 원장 상수와 동일 참조다", () => {
    const byKey = Object.fromEntries(PRIVACY_POLICY_SECTIONS.map((s) => [s.key, s]));
    for (const k of ["rights", "destruction", "safety", "cookies", "remedy", "changes"]) {
      const s = byKey[k] as { body?: string };
      expect(s.body?.trim().length, k).toBeGreaterThan(0);
    }
    expect((byKey.purpose as { from: unknown }).from).toBe(PRIVACY_NOTICE.purpose);
    expect((byKey.items as { from: unknown }).from).toBe(PRIVACY_NOTICE.items);
    expect((byKey.retention as { from: unknown }).from).toBe(PRIVACY_NOTICE.retention);
    expect((byKey.processors as { from: unknown }).from).toBe(PROCESSORS);
    expect((byKey.overseas as { from: unknown }).from).toBe(OVERSEAS_TRANSFERS);
    expect((byKey.publicFeed as { from: unknown }).from).toBe(PRIVACY_NOTICE.publicFeedNotice);
    expect((byKey.officer as { from: unknown }).from).toBe(COMPANY.privacyOfficer);
  });

  test("GUIDE_SECTIONS 8절 — flow 는 4단계, contact 는 COMPANY 5개 필드", () => {
    expect(GUIDE_SECTIONS).toHaveLength(8);
    expect(GUIDE_SECTIONS.map((s) => s.key)).toEqual([
      "flow",
      "quoteBasis",
      "payment",
      "cancel",
      "insurance",
      "dispute",
      "minors",
      "contact",
    ]);
    const flow = GUIDE_SECTIONS[0] as { steps: readonly string[] };
    expect(flow.steps).toHaveLength(4);
    for (const s of flow.steps) expect(s.trim().length).toBeGreaterThan(0);
    const contact = GUIDE_SECTIONS[7] as { fields: readonly string[] };
    expect(contact.fields).toEqual(["tel", "mobile", "fax", "email", "address"]);
    for (const f of contact.fields) expect(typeof COMPANY[f as keyof typeof COMPANY], f).toBe("string");
  });

  test("LEGAL_PAGES — 세 페이지 제목, 약관·처리방침에 시행일(YYYY-MM-DD)", () => {
    for (const k of ["privacy", "terms", "guide"] as const) {
      expect(LEGAL_PAGES[k].title.trim().length, k).toBeGreaterThan(0);
    }
    expect(LEGAL_PAGES.privacy.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(LEGAL_PAGES.terms.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("LEGAL_LABELS — 표 머리·연락처 라벨이 모두 비어 있지 않다 (페이지에서 리터럴 대신 쓴다)", () => {
    const walk = (v: unknown, at: string) => {
      if (typeof v === "string") expect(v.trim().length, at).toBeGreaterThan(0);
      else if (v && typeof v === "object") for (const [k, c] of Object.entries(v)) walk(c, `${at}.${k}`);
    };
    walk(ledger.LEGAL_LABELS, "LEGAL_LABELS");
    for (const p of PROCESSORS) for (const k of Object.keys(p)) expect(ledger.LEGAL_LABELS.processor, k).toHaveProperty(k);
    for (const t of OVERSEAS_TRANSFERS)
      for (const k of Object.keys(t)) expect(ledger.LEGAL_LABELS.overseas, k).toHaveProperty(k);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2. 조문 ↔ 원장 키 ↔ 페이지 경로 매핑표 (보고서 P1-6-report.md 에 전문 수록)
// ═════════════════════════════════════════════════════════════════════════
type MappingRow = { law: string; ledgerKey: string; page: PagePath };
export const LEGAL_MAPPING: readonly MappingRow[] = [
  // ── 이용약관 (전자상거래법) ──
  { law: "전자상거래법 §10①5호 — 이용약관 표시(연결화면 허용)", ledgerKey: "TERMS.articles", page: "/terms" },
  { law: "전자상거래법 §10①5호 — 약관 제목·시행일", ledgerKey: "LEGAL_PAGES.terms", page: "/terms" },
  { law: "약관규제법 §3 — 약관의 명시·설명(사이트 게시로 효력, 제3조)", ledgerKey: "TERMS.articles.2", page: "/terms" },
  { law: "전자상거래법 §13②5호 — 계약 성립·취소·환불 조건(제5조·제7조)", ledgerKey: "TERMS.articles.4", page: "/terms" },
  { law: "전자상거래법 §17② — 청약철회 제한 사유 고지(제8조)", ledgerKey: "TERMS.articles.7", page: "/terms" },
  { law: "전자상거래법 §13②9호 — 분쟁 해결·관할·준거법(제12조)", ledgerKey: "TERMS.articles.11", page: "/terms" },
  // ── 이용안내 (전자상거래법 §13② 거래조건 표시) ──
  { law: "전자상거래법 §13①1호 — 상호·대표자·주소·전화·이메일", ledgerKey: "COMPANY", page: "/guide" },
  { law: "전자상거래법 §13②3호 — 가격 미결정 시 산정 기준", ledgerKey: "QUOTE_BASIS.line", page: "/guide" },
  { law: "전자상거래법 §13②4호 — 대금 지급 방법·시기", ledgerKey: "PAYMENT.line", page: "/guide" },
  { law: "전자상거래법 §13②5호 — 취소·환불 조건(4단계 표)", ledgerKey: "CANCELLATION.tiers", page: "/guide" },
  { law: "전자상거래법 §13②5호 — 환불 기준액(계약금) 고지", ledgerKey: "CANCELLATION.depositNote", page: "/guide" },
  { law: "전자상거래법 §13②8호 — 소비자 불만·분쟁 처리 절차", ledgerKey: "DISPUTE", page: "/guide" },
  { law: "전자상거래법 §13③ / PIPA §22조의2 — 만 14세 미만 제한", ledgerKey: "MINORS.line", page: "/guide" },
  { law: "확인시트 ★2 — 차량 보험 안내(기존 문구 계승)", ledgerKey: "INSURANCE.body", page: "/guide" },
  { law: "CLAUDE.md §3 — verbatim 접수·확정 고지", ledgerKey: "VERBATIM.bookingNotice", page: "/guide" },
  { law: "CLAUDE.md §3 — verbatim Top-5 예시 견적 고지", ledgerKey: "VERBATIM.showcaseNotice", page: "/guide" },
  { law: "플랜 P1-6 — 이용안내 절 순서·이용 절차 4단계", ledgerKey: "GUIDE_SECTIONS", page: "/guide" },
  // ── 개인정보 처리방침 (PIPA §30① · 시행령 §31) ──
  { law: "PIPA §30①1호 — 개인정보의 처리 목적", ledgerKey: "PRIVACY_NOTICE.purpose", page: "/privacy" },
  { law: "PIPA §30①2호 — 처리 및 보유 기간", ledgerKey: "PRIVACY_NOTICE.retention", page: "/privacy" },
  { law: "PIPA §30①3호의2 / §28조의8② — 국외 이전 5항목+근거", ledgerKey: "OVERSEAS_TRANSFERS", page: "/privacy" },
  { law: "PIPA §30①4호 / §26② — 처리위탁 수탁자·업무", ledgerKey: "PROCESSORS", page: "/privacy" },
  { law: "PIPA §30①5호 — 정보주체 권리·의무 및 행사 방법", ledgerKey: "PRIVACY_POLICY_SECTIONS.5.body", page: "/privacy" },
  { law: "PIPA §30①6호 — 처리하는 개인정보 항목", ledgerKey: "PRIVACY_NOTICE.items", page: "/privacy" },
  { law: "PIPA §30①7호 — 파기 절차 및 방법", ledgerKey: "PRIVACY_POLICY_SECTIONS.6.body", page: "/privacy" },
  { law: "PIPA §30①8호 / §29 — 안전성 확보 조치", ledgerKey: "PRIVACY_POLICY_SECTIONS.7.body", page: "/privacy" },
  { law: "PIPA §30①9호 / §31 — 개인정보 보호책임자", ledgerKey: "COMPANY.privacyOfficer", page: "/privacy" },
  { law: "시행령 §31①2호 — 자동 수집 장치 설치·운영·거부", ledgerKey: "PRIVACY_POLICY_SECTIONS.8.body", page: "/privacy" },
  { law: "시행령 §31①3호 — 권익침해 구제 방법", ledgerKey: "PRIVACY_POLICY_SECTIONS.11.body", page: "/privacy" },
  { law: "시행령 §31② — 처리방침 변경 공지", ledgerKey: "PRIVACY_POLICY_SECTIONS.12.body", page: "/privacy" },
  { law: "플랜 ADR-6 — 접수 현황 마스킹 공개 고지", ledgerKey: "PRIVACY_NOTICE.publicFeedNotice", page: "/privacy" },
  { law: "PIPA §30① — 처리방침 절 순서·제목 13절", ledgerKey: "PRIVACY_POLICY_SECTIONS", page: "/privacy" },
  { law: "PIPA §30② — 처리방침 제목·시행일 공개", ledgerKey: "LEGAL_PAGES.privacy", page: "/privacy" },
  // ── 공통 셸 ──
  { law: "시행규칙 §7② — 법정 문서 링크 상시 노출", ledgerKey: "LEGAL_LINKS", page: "(legal)/layout" },
];

describe("2. 조문 ↔ 원장 키 ↔ 페이지 경로 매핑표", () => {
  test("매핑표는 20행 이상이고 세 페이지를 모두 덮는다", () => {
    expect(LEGAL_MAPPING.length).toBeGreaterThanOrEqual(20);
    const pages = new Set(LEGAL_MAPPING.map((r) => r.page));
    for (const p of ["/privacy", "/terms", "/guide"]) expect(pages).toContain(p);
  });

  test.for(LEGAL_MAPPING.map((r) => [r.ledgerKey, r] as const))(
    "원장 키 %s 가 export 돼 있고 비어 있지 않다",
    ([, row]) => {
      const v = resolveKey(row.ledgerKey);
      expect(v, `${row.law} → ${row.ledgerKey}`).not.toBeUndefined();
      expect(isNonEmpty(v), `${row.ledgerKey} 가 비어 있음`).toBe(true);
    },
  );

  test.for(LEGAL_MAPPING.map((r) => [`${r.page} ← ${r.ledgerKey}`, r] as const))(
    "%s — 페이지 소스가 그 최상위 상수를 원장에서 import 한다",
    ([, row]) => {
      const src = read(PATH_TO_FILE[row.page]);
      const top = row.ledgerKey.split(".")[0];
      expect(ledgerImports(src), `${PATH_TO_FILE[row.page]} 에 ${top} import 없음`).toContain(top);
    },
  );

  test("페이지가 import 한 원장 상수는 전부 매핑표에 있다 (역방향 — 표에 없는 문구 유입 방지)", () => {
    const mapped = new Set(LEGAL_MAPPING.map((r) => r.ledgerKey.split(".")[0]));
    // 라벨·페이지 메타는 조문이 아니라 렌더 보조 상수 — 매핑 면제
    const aux = new Set(["LEGAL_LABELS", "LEGAL_PAGES", "LEGAL_LINKS"]);
    for (const rel of Object.values(PAGE_FILES)) {
      for (const name of ledgerImports(read(rel))) {
        if (aux.has(name)) continue;
        expect(mapped, `${rel} 이 import 한 ${name} 이 매핑표에 없음`).toContain(name);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("3. 페이지·레이아웃·컴포넌트 소스에 한글 리터럴 0건 (주석 제외)", () => {
  const files = [...Object.values(PAGE_FILES), ...COMPONENT_FILES];
  test.for(files.map((f) => [f] as const))("%s", ([rel]) => {
    const code = codeOf(rel);
    const hits = code
      .split("\n")
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => HANGUL.test(l));
    expect(hits, `한글은 원장(lib/legal/disclosures.ts)에서만 온다`).toEqual([]);
  });

  test("페이지 3개는 원장에서만 문구를 가져오고 messages/ 를 읽지 않는다 (ko 폴백 — en.json 무관)", () => {
    for (const rel of [PAGE_FILES.privacy, PAGE_FILES.terms, PAGE_FILES.guide]) {
      const src = read(rel);
      expect(src, rel).toMatch(/from ["']@\/lib\/legal\/disclosures["']/);
      expect(src, rel).not.toMatch(/getTranslations|useTranslations/);
    }
  });

  test("페이지 3개 모두 generateMetadata 로 제목을 LEGAL_PAGES 에서 가져오고 robots index/follow 를 선언한다", () => {
    for (const rel of [PAGE_FILES.privacy, PAGE_FILES.terms, PAGE_FILES.guide]) {
      const src = read(rel);
      expect(src, rel).toMatch(/export (async )?function generateMetadata/);
      expect(src, rel).toMatch(/LEGAL_PAGES\.(privacy|terms|guide)\.title/);
      expect(src, rel).toMatch(/robots:\s*\{\s*index:\s*true,\s*follow:\s*true/);
    }
  });

  test("/guide 는 verbatim 2건을 원장 VERBATIM 에서 렌더한다", () => {
    const src = read(PAGE_FILES.guide);
    expect(src).toMatch(/VERBATIM\.bookingNotice/);
    expect(src).toMatch(/VERBATIM\.showcaseNotice/);
  });

  test("레이아웃은 (site) 셸을 상속하지 않고 LEGAL_LINKS 3개 + 홈 링크를 i18n Link 로 렌더한다", () => {
    const src = codeOf(PAGE_FILES.layout);
    expect(src).toMatch(/from ["']@\/i18n\/navigation["']/);
    expect(src).not.toMatch(/\(site\)/);
    for (const k of ["privacy", "terms", "guide"]) expect(src).toMatch(new RegExp(`LEGAL_LINKS\\.${k}`));
  });

  test("빈 값 숨김 — 표 컴포넌트는 빈 문자열 셀을 렌더하지 않는다 (필터가 소스에 있다)", () => {
    const src = read("components/legal/LegalTable.tsx");
    // 빈 값 판정이 한 곳에 있고, 레코드·열 렌더 양쪽이 그것을 쓴다
    expect(src).toMatch(/function isBlank\(/);
    expect((src.match(/isBlank\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test("legal.module.css 는 semantic 토큰만 쓴다 (HEX·rgba·--brand-N 0건, 모든 var 가 semantic.css 에 정의)", () => {
    const css = codeOf("components/legal/legal.module.css");
    const semantic = codeOf("styles/semantic.css");
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(/--brand-\d/.test(css)).toBe(false);
    expect(/\b(rgba?|hsla?)\(/.test(css)).toBe(false);
    const refs = [...new Set([...css.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)].map((m) => m[1]))];
    const missing = refs.filter((r) => !semantic.includes(`${r}:`));
    expect(missing).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("4. 게이트 — 원장 함수 export 0 · 새 TEMP 마커 허용 목록", { timeout: GATE_TIMEOUT_MS }, () => {
  test("새 TEMP 마커 3건(LEGAL_PAGES 시행일 2 · TERMS 제6조 1)이 원장과 허용 목록에 있다", () => {
    const ledgerSrc = read(LEDGER_REL);
    const allow = read(ALLOWLIST_REL);
    for (const key of ["LEGAL_PAGES.privacy.effectiveDate", "LEGAL_PAGES.terms.effectiveDate", "TERMS.articles.six.body"]) {
      expect(ledgerSrc, key).toContain(`${TEMP_MARKER} ${key}:`);
      expect(allow, key).toContain(key.replace(/\./g, "\\."));
    }
  });

  test("TEMP 상태는 화면 문자열에 없다 — 원장의 마커는 주석에만 있고 페이지 소스에 마커가 없다", () => {
    for (const rel of [...Object.values(PAGE_FILES), ...COMPONENT_FILES]) {
      expect(read(rel), rel).not.toContain(TEMP_MARKER);
    }
    for (const a of TERMS.articles) expect(a.body).not.toContain(TEMP_MARKER);
  });

  test("bash scripts/check-legal-disclosures.sh → exit 0", async () => {
    const r = await runGate("scripts/check-legal-disclosures.sh");
    expect(r.status, r.out).toBe(0);
  });

  test("bash scripts/check-temp-values.sh → exit 0", async () => {
    const r = await runGate("scripts/check-temp-values.sh");
    expect(r.status, r.out).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 5. dev 서버 응답 — LEGAL_BASE_URL(예: http://localhost:3111) 이 있을 때만. 없으면 browse 실측 보고서가 담당.
// ═════════════════════════════════════════════════════════════════════════
const BASE = process.env.LEGAL_BASE_URL;
describe.runIf(Boolean(BASE))("5. dev 서버 — 200/404", { timeout: GATE_TIMEOUT_MS }, () => {
  test.for([["/privacy"], ["/terms"], ["/guide"], ["/en/privacy"]] as const)("%s → 200", async ([p]) => {
    const res = await fetch(`${BASE}${p}`);
    expect(res.status).toBe(200);
  });
  test("/legal/x → 404", async () => {
    const res = await fetch(`${BASE}/legal/x`);
    expect(res.status).toBe(404);
  });
  test("/privacy 의 위탁 표에 빈 <td> 가 없다", async () => {
    const html = await (await fetch(`${BASE}/privacy`)).text();
    expect(html.match(/<td[^>]*>\s*<\/td>/g) ?? []).toEqual([]);
  });
  test("/terms 조항 12개 · /guide verbatim 2건", async () => {
    const terms = await (await fetch(`${BASE}/terms`)).text();
    expect((terms.match(/<article/g) ?? []).length).toBe(12);
    const guide = await (await fetch(`${BASE}/guide`)).text();
    expect(guide).toContain(ledger.VERBATIM.bookingNotice);
    expect(guide).toContain(ledger.VERBATIM.showcaseNotice);
    expect(CANCELLATION.tiers.length).toBe(4);
  });
});
