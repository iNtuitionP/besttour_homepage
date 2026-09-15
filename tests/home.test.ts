/**
 * P2-4 — 홈 이식(목업 variant-08 → app/[locale]/(site)/page.tsx) 계약 테스트.
 *
 * vitest 는 node 환경이다 — DOM 렌더 테스트용 패키지를 설치하지 않는다. 여기서는
 *   (1) 순수 함수(quoteHref · dismissKey · resolveImageUrl · getGallery 매퍼),
 *   (2) 소스 정적 검사(금지어·실증 불가 수치·'use client' 경계·원장 import·데이터 속성·섹션 순서),
 *   (3) 원격 gallery anon 읽기(행 수 0 이어도 OK)
 * 만 잠그고, 실제 렌더(캐러셀 5초·팝업 dismiss·위젯 href·3폭 오버플로)는 browse 로 실측해 보고서에 남긴다.
 *
 * 주의: tests/ 아래라 세 게이트(check-no-pricing · check-legal-disclosures · check-temp-values)의 검사 대상이다.
 * 금지어 리터럴은 유니코드 이스케이프로 조립한다(tests/gates.test.ts 규약).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { PREVIEW_POPUP } from "@/components/home/popup-preview";
import { dismissKey, POPUP_DISMISS_PREFIX } from "@/components/home/popup-dismiss";
import { quoteHref } from "@/components/home/quote-href";
import { resolveImageUrl } from "@/components/home/image-url";
import { LOCATION_CODES } from "@/lib/codes";
import { parseKst, toKstDateString } from "@/lib/kst";
import { COMPANY, PAYMENT, QUOTE_BASIS, VERBATIM } from "@/lib/legal/disclosures";
import { DEFAULT_GALLERY_LIMIT, getGallery, mapGalleryRows, QUERY_TAGS } from "@/lib/queries";
import { withGalleryLock } from "./helpers/db-lock";
import { loadDotEnvLocal } from "./helpers/load-env-local";

loadDotEnvLocal();

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOME_DIR = "components/home";
const PAGE = "app/[locale]/(site)/page.tsx";
const DEV_DIR = "app/[locale]/(site)/dev";
const GALLERY_QUERY = "lib/queries/gallery.ts";
const MESSAGES_KO = "messages/ko.json";

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function walk(absDir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(absDir)) {
    const p = path.join(absDir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const toPosix = (p: string) => p.split(path.sep).join("/");

/** 주석 제거 — 블록 주석 전체, 줄 주석은 문자열 밖의 // 부터 (tests/layout.test.ts 와 같은 규칙) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      let inStr: string | null = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inStr) {
          if (ch === "\\") i++;
          else if (ch === inStr) inStr = null;
        } else if (ch === '"' || ch === "'" || ch === "`") inStr = ch;
        else if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

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

const homeFiles = walk(path.join(ROOT, HOME_DIR)).map((p) => toPosix(path.relative(ROOT, p)));
const homeTsx = homeFiles.filter((f) => f.endsWith(".tsx"));
const homeSources = homeFiles
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((file) => ({ file, text: read(file) }));
const homeCode = homeSources.map(({ file, text }) => ({ file, code: stripComments(text) }));

const ko = JSON.parse(read(MESSAGES_KO)) as Record<string, unknown>;
const homeKo = JSON.stringify(ko.home ?? null);

// ── 금지어 (리터럴 금지 — 헤더 참조) ──────────────────────────────────────
const W_LICENSE = "\uba74\ud5c8"; // "등록"이 맞다 — CLAUDE.md §3
const W_RIVAL = "\uc804\uc138\ubc84\uc2a4\ud558\ub098"; // 타사 상호
const W_BM_OUTBOUND = "\ub098\uac00\ub294 \ubc84\uc2a4"; // soul §10.2
const W_BM_TAKEOUT = "\ud0dc\uc6b0\uace0 \ub098\uac00"; // soul §10.2
const W_BM_EMPTY = "\uacf5\ucc28"; // soul §10.2
const W_BM_RETURN = "\ud68c\uc1a1"; // soul §10.2
const FORBIDDEN = [W_LICENSE, W_RIVAL, W_BM_OUTBOUND, W_BM_TAKEOUT, W_BM_EMPTY, W_BM_RETURN];

/** 실증 불가 수치·문구 (브리프 §검증 1 + CLAUDE.md §3). "2013년" 은 허용이므로 13년 앞에 숫자가 없을 때만 잡는다. */
const UNPROVEN: ReadonlyArray<[string, RegExp]> = [
  ["4,800", /4,800/],
  ["70만", /70만/],
  ["13년", /(?<!\d)13년/],
  ["17건", /17건/],
  ["연중무휴", /연중무휴/],
  ["누적", /누적/],
  ["운행 경력", /운행 경력/],
  ["2013 하드코딩", /(?<![\w-])2013(?![\w-])/],
];

// =============================================================================
// 1. 금지어·실증 불가 수치 0건 — components/home/** + messages/ko.json home.*
// =============================================================================
describe("1. components/home/** · ko.json home — 금지어·실증 불가 수치 0건", () => {
  test("검사 대상 파일이 실제로 있다 (빈 배열 통과 방지)", () => {
    expect(homeTsx.length).toBeGreaterThanOrEqual(11);
    expect(ko.home, "messages/ko.json 에 home 네임스페이스가 없다").toBeTruthy();
  });

  test.for(homeCode.map((s) => [s.file, s.code] as const))("%s — 게이트 금지어 0건", ([, code]) => {
    for (const w of FORBIDDEN) expect(code.includes(w)).toBe(false);
  });

  test.for(homeCode.map((s) => [s.file, s.code] as const))("%s — 실증 불가 수치 0건", ([, code]) => {
    for (const [label, re] of UNPROVEN) expect(re.test(code), label).toBe(false);
  });

  test("ko.json home.* — 금지어·실증 불가 수치 0건", () => {
    for (const w of FORBIDDEN) expect(homeKo.includes(w)).toBe(false);
    for (const [label, re] of UNPROVEN) expect(re.test(homeKo), label).toBe(false);
  });

  test("인사말 요약에 '외국인 관광객' 수치 문장이 없다 (legacy-content-inventory §2 주의 1·2)", () => {
    expect(homeKo.includes("외국인 관광객")).toBe(false);
  });

  test("확정 표기 '공항 픽업·샌딩 (송영 전문)' 이 카피에 있고, '송영' 단독 표기는 없다 (soul §10.2)", () => {
    expect(homeKo).toContain("공항 픽업·샌딩 (송영 전문)");
    const alone = homeKo.replace(/\(송영 전문\)/g, "");
    expect(alone.includes("송영")).toBe(false);
  });
});

// =============================================================================
// 2. 'use client' 경계 — 캐러셀·팝업·위젯만
// =============================================================================
const CLIENT_ALLOWED = [`${HOME_DIR}/HeroCarousel.tsx`, `${HOME_DIR}/Popup.tsx`, `${HOME_DIR}/QuoteWidget.tsx`];

describe("2. 'use client' 경계", () => {
  test("'use client' 는 HeroCarousel · Popup · QuoteWidget 에만 (파일명으로 단언)", () => {
    const clients = homeTsx.filter((f) => /^\s*["']use client["']/m.test(read(f)));
    expect(clients.sort()).toEqual([...CLIENT_ALLOWED].sort());
  });

  test("클라이언트 컴포넌트는 원장을 import 하지 않는다 (법정 문구는 서버가 props 로 내린다)", () => {
    for (const f of CLIENT_ALLOWED) expect(ledgerImports(read(f)), f).toEqual([]);
  });

  test("클라이언트 컴포넌트는 lib/queries · supabase 를 import 하지 않는다", () => {
    for (const f of CLIENT_ALLOWED) {
      const src = read(f);
      expect(/@\/lib\/queries|@\/lib\/supabase/.test(src), f).toBe(false);
    }
  });

  test("next/link 직접 import 0건 — i18n/navigation 의 Link 만", () => {
    for (const { file, text } of homeSources) {
      expect(/from\s+["']next\/link["']/.test(text), file).toBe(false);
    }
    expect(read(`${HOME_DIR}/QuoteWidget.tsx`)).toMatch(/from\s+["']@\/i18n\/navigation["']/);
  });
});

// =============================================================================
// 3. 원장 import 존재 + 원장 문구 문자열 리터럴 0
// =============================================================================
describe("3. 법정 문구는 원장 참조로만", () => {
  test("components/home/** 전체에서 VERBATIM · QUOTE_BASIS · PAYMENT · COMPANY 를 import 한다", () => {
    const all = new Set(homeTsx.flatMap((f) => ledgerImports(read(f))));
    for (const name of ["VERBATIM", "QUOTE_BASIS", "PAYMENT", "COMPANY"]) expect(all.has(name), name).toBe(true);
  });

  test("원장 문구의 문자열 리터럴 0건 — 소스와 ko.json home.* 양쪽", () => {
    const fragments = [
      VERBATIM.bookingNotice,
      VERBATIM.showcaseNotice,
      QUOTE_BASIS.line,
      PAYMENT.line,
      COMPANY.legalName,
      COMPANY.bizRegNo,
      COMPANY.mailOrderNo,
      COMPANY.tel,
      COMPANY.representative,
      "45인승 당일왕복",
      "결제 진행됩니다",
      "견적 산정 기준",
      "대금 지급",
    ];
    for (const { file, code } of homeCode) {
      for (const frag of fragments) expect(code.includes(frag), `${file} 에 원장 문구 리터럴: ${frag}`).toBe(false);
    }
    for (const frag of fragments) expect(homeKo.includes(frag), `ko.json home 에 원장 문구 복제: ${frag}`).toBe(false);
  });

  test("HowItWorks 는 GUIDE_SECTIONS.flow 와 verbatim · 산정기준 · 대금 문구를 원장에서 렌더한다", () => {
    const src = read(`${HOME_DIR}/HowItWorks.tsx`);
    expect(ledgerImports(src)).toEqual(expect.arrayContaining(["GUIDE_SECTIONS", "VERBATIM", "QUOTE_BASIS", "PAYMENT"]));
    expect(src).toMatch(/VERBATIM\.bookingNotice/);
    expect(src).toMatch(/QUOTE_BASIS\.line/);
    expect(src).toMatch(/PAYMENT\.line/);
  });

  test("TrustBar 는 연도를 COMPANY.establishedYear 에서 계산하고, 신고번호·대표자도 원장 필드다", () => {
    const src = read(`${HOME_DIR}/TrustBar.tsx`);
    expect(src).toMatch(/COMPANY\.establishedYear/);
    expect(src).toMatch(/COMPANY\.mailOrderNo/);
    expect(src).toMatch(/COMPANY\.representative/);
  });

  test("CompanyIntro 의 대표 서명은 COMPANY.representative", () => {
    expect(read(`${HOME_DIR}/CompanyIntro.tsx`)).toMatch(/COMPANY\.representative/);
  });

  test("RoutesSection 은 KrMap 을 그대로 쓰고 showcaseNotice 를 중복 렌더하지 않는다", () => {
    const src = read(`${HOME_DIR}/RoutesSection.tsx`);
    expect(src).toMatch(/from\s+["']@\/components\/KrMap\/KrMap["']/);
    expect(src).toMatch(/<KrMap\s+routes=/);
    expect(src.includes("showcaseNotice")).toBe(false);
  });
});

// =============================================================================
// 4. getGallery — 서버 액션 아님 · 서비스 롤 없음 · anon+RLS
// =============================================================================
describe("4. lib/queries/gallery.ts 정적 검사", () => {
  const src = read(GALLERY_QUERY);

  test.each([
    ["서버 액션 지시어", /['"]use server['"]/],
    ["서비스 롤 심볼", /service_role|SUPABASE_SERVICE_ROLE_KEY|createServiceClient/],
    ["서비스 롤 모듈 import", /supabase\/server['"]/],
    ["Next import", /from\s+['"]next(\/|['"])/],
  ])("금지 심볼 0건 — %s", (_label, pattern) => {
    expect(pattern.test(src)).toBe(false);
  });

  test("anon 클라이언트로 active 행만 sort 오름차순", () => {
    expect(src).toMatch(/createAnonClient/);
    expect(src).toMatch(/\.eq\("active",\s*true\)/);
    expect(src).toMatch(/\.order\("sort"/);
  });

  test("index.ts 가 getGallery 를 export 하고 QUERY_TAGS 에 gallery 가 있다", () => {
    expect(read("lib/queries/index.ts")).toMatch(/getGallery/);
    expect(QUERY_TAGS.gallery).toBe("gallery");
  });

  test("mapGalleryRows — 컬럼을 버리지 않고 camelCase 로 옮긴다", () => {
    expect(mapGalleryRows([{ id: 3, image_path: "gallery/a.jpg", caption: null, sort: 2, active: true }])).toEqual([
      { id: 3, imagePath: "gallery/a.jpg", caption: null, sort: 2, active: true },
    ]);
  });

  test("limit 이 양의 정수가 아니면 조회 전에 throw", async () => {
    await expect(getGallery(0)).rejects.toThrow();
    await expect(getGallery(-1)).rejects.toThrow();
    await expect(getGallery(1.5)).rejects.toThrow();
    expect(DEFAULT_GALLERY_LIMIT).toBeGreaterThan(0);
  });
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasAnon = Boolean(supabaseUrl && anonKey);
if (process.env.REQUIRE_DB_TESTS === "1" && !hasAnon) {
  describe("getGallery DB — REQUIRE_DB_TESTS guard", () => {
    test("REQUIRE_DB_TESTS=1 인데 anon 접속 정보가 없음", () => {
      throw new Error("REQUIRE_DB_TESTS=1 이지만 NEXT_PUBLIC_SUPABASE_URL / ANON_KEY 가 비어 있다.");
    });
  });
}

describe.skipIf(!hasAnon)("4-DB. getGallery — anon 키 + RLS (읽기 전용, 행 수 0 이어도 OK)", () => {
  // 읽기 전용인데도 잠금이 필요하다: 아래 단언은 `getGallery(100)` 과 직접 anon REST 조회가 **같은 행 집합**인지를 본다.
  // 그 두 조회 사이에 갤러리 픽스처를 쓰는 다른 파일이 사진을 넣거나 지우면 어긋난다(P5-10 관측 → P6-3b 승격).
  withGalleryLock();

  const SERVICE_KEY_NAME = "SUPABASE_SERVICE_ROLE_KEY";
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env[SERVICE_KEY_NAME];
    delete process.env[SERVICE_KEY_NAME];
  });
  afterAll(() => {
    if (saved !== undefined) process.env[SERVICE_KEY_NAME] = saved;
  });

  test("서비스 롤 없이 읽히고, 직접 anon REST 조회와 행 수·순서가 같다", async () => {
    const res = await fetch(`${supabaseUrl}/rest/v1/gallery?select=id,sort&order=sort.asc,id.asc`, {
      headers: { apikey: anonKey as string, Authorization: `Bearer ${anonKey}` },
    });
    expect(res.ok).toBe(true);
    const direct = (await res.json()) as { id: number; sort: number }[];

    const items = await getGallery(100);
    expect(items.map((g) => g.id)).toEqual(direct.map((r) => r.id));
    for (const g of items) {
      expect(Object.keys(g).sort()).toEqual(["active", "caption", "id", "imagePath", "sort"]);
      expect(g.active).toBe(true);
      expect(typeof g.imagePath).toBe("string");
    }
    for (let i = 1; i < items.length; i++) expect(items[i - 1].sort <= items[i].sort).toBe(true);

    const one = await getGallery(1);
    expect(one.length).toBeLessThanOrEqual(1);
  });
});

// =============================================================================
// 5. 팝업 dismiss 키 — KST 날짜 (TZ=UTC / Asia/Seoul 양쪽에서 같은 답)
// =============================================================================
describe.each([["UTC"], ["Asia/Seoul"]])("5. dismissKey (process.env.TZ=%s)", (tz) => {
  let originalTz: string | undefined;
  beforeEach(() => {
    originalTz = process.env.TZ;
    process.env.TZ = tz;
  });
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  test("형식 popup-dismissed:<id>:<YYYY-MM-DD>", () => {
    expect(POPUP_DISMISS_PREFIX).toBe("popup-dismissed");
    expect(dismissKey(7, parseKst("2026-09-12T12:00"))).toBe("popup-dismissed:7:2026-09-12");
  });

  test("KST 자정 경계 — 09-12T00:00 은 09-12, 09-11T23:59 는 09-11 (UTC 날짜라면 둘 다 09-11)", () => {
    const midnight = parseKst("2026-09-12T00:00");
    const beforeMidnight = parseKst("2026-09-11T23:59");
    expect(dismissKey(1, midnight)).toBe("popup-dismissed:1:2026-09-12");
    expect(dismissKey(1, beforeMidnight)).toBe("popup-dismissed:1:2026-09-11");
    // 대조: 같은 인스턴트의 UTC 날짜는 전날 — 그래서 UTC 날짜를 키에 쓰면 하루 어긋난다
    expect(midnight.toISOString().slice(0, 10)).toBe("2026-09-11");
    expect(dismissKey(1, midnight).endsWith("2026-09-11")).toBe(false);
  });

  test("08:59 → 같은 KST 날짜, 다른 id 는 다른 키", () => {
    const t = parseKst("2026-09-12T08:59");
    expect(dismissKey(1, t)).toBe(`popup-dismissed:1:${toKstDateString(t)}`);
    expect(dismissKey(2, t)).not.toBe(dismissKey(1, t));
  });
});

// =============================================================================
// 6. 견적 위젯 — /quote 프리필 URL 순수 함수 (접수하지 않는다)
// =============================================================================
describe("6. quoteHref", () => {
  test("네 값 전부 → /quote?origin=SEL&dest=TYG&date=…&pax=…", () => {
    expect(quoteHref({ origin: "SEL", dest: "TYG", date: "2026-09-20", pax: 40 })).toBe(
      "/quote?origin=SEL&dest=TYG&date=2026-09-20&pax=40",
    );
  });

  test("빈 값은 생략 — 아무것도 없으면 /quote", () => {
    expect(quoteHref({})).toBe("/quote");
    expect(quoteHref()).toBe("/quote");
    expect(quoteHref({ origin: "SEL" })).toBe("/quote?origin=SEL");
    expect(quoteHref({ origin: "", dest: "", date: "", pax: "" })).toBe("/quote");
    expect(quoteHref({ origin: "ICN", dest: "SEL", pax: 0 })).toBe("/quote?origin=ICN&dest=SEL");
  });

  test("pax 는 양의 정수만, 문자열 숫자도 받는다", () => {
    expect(quoteHref({ pax: "12" })).toBe("/quote?pax=12");
    expect(quoteHref({ pax: "abc" })).toBe("/quote");
    expect(quoteHref({ pax: -3 })).toBe("/quote");
    expect(quoteHref({ pax: 2.5 })).toBe("/quote");
  });

  test("장소는 LOCATION_CODES 에 있는 코드만 — 번역 문자열·미지 코드는 생략", () => {
    expect(quoteHref({ origin: "서울", dest: "XXX" })).toBe("/quote");
    for (const code of LOCATION_CODES) expect(quoteHref({ origin: code })).toBe(`/quote?origin=${code}`);
  });

  test("날짜는 YYYY-MM-DD 만, 차량 slug 는 선택", () => {
    expect(quoteHref({ date: "2026-9-2" })).toBe("/quote");
    expect(quoteHref({ date: "2026-09-02T08:00" })).toBe("/quote");
    expect(quoteHref({ vehicle: "bus45" })).toBe("/quote?vehicle=bus45");
    expect(quoteHref({ vehicle: "../x" })).toBe("/quote");
  });

  test("인코딩 — URLSearchParams 규칙(공백·특수문자 인코딩, 인젝션 불가)", () => {
    expect(quoteHref({ date: "2026-09-02&pax=9" })).toBe("/quote");
    const href = quoteHref({ origin: "SEL", pax: "7" });
    expect(href.split("?")[1].split("&")).toEqual(["origin=SEL", "pax=7"]);
  });
});

describe("6-b. QuoteWidget 은 접수하지 않는다", () => {
  const src = stripComments(read(`${HOME_DIR}/QuoteWidget.tsx`));

  test("이름·전화 입력란 없음 (개인정보를 동의 UI 없이 받게 된다 — P3 위저드 몫)", () => {
    expect(/type=["']tel["']/.test(src)).toBe(false);
    expect(/autoComplete=["'](name|tel)["']/.test(src)).toBe(false);
  });

  test("서버 액션·fetch·form action 없음, 모달 없음", () => {
    expect(/['"]use server['"]/.test(src)).toBe(false);
    expect(/\bfetch\s*\(/.test(src)).toBe(false);
    expect(/action=/.test(src)).toBe(false);
    expect(/role=["']dialog["']/.test(src)).toBe(false);
  });

  test("quoteHref 로 만든 href 를 i18n Link 에 건다", () => {
    expect(src).toMatch(/quoteHref\(/);
    expect(src).toMatch(/<Link[^>]*href=\{/);
  });
});

// =============================================================================
// 7. 개발 라우트 삭제 — /dev/krmap 부재 + 옛 테스트 참조 정리
// =============================================================================
describe("7. /dev/krmap 삭제", () => {
  test("app/[locale]/(site)/dev/ 디렉터리가 없다", () => {
    expect(existsSync(path.join(ROOT, DEV_DIR))).toBe(false);
  });

  test("tests/krmap.test.ts · tests/review-fix.test.ts 가 dev 페이지 파일을 참조하지 않는다", () => {
    for (const rel of ["tests/krmap.test.ts", "tests/review-fix.test.ts"]) {
      const src = read(rel);
      expect(src.includes("dev/krmap/page.tsx"), rel).toBe(false);
      expect(src.includes("DEV_PAGE"), rel).toBe(false);
    }
  });
});

// =============================================================================
// 8. 페이지 조립 — 섹션 9개 순서 · data-section · 정적 렌더 조건 · 메타데이터
// =============================================================================
const SECTIONS: ReadonlyArray<[component: string, dataSection: string]> = [
  ["Hero", "hero"],
  ["RoutesSection", "routes"],
  ["TrustBar", "trust"],
  ["ServiceStrip", "services"],
  ["HowItWorks", "how"],
  ["FleetSection", "fleet"],
  ["CompanyIntro", "company"],
  ["GallerySection", "gallery"],
  ["NoticeSection", "notice"],
];

describe("8. app/[locale]/(site)/page.tsx", () => {
  const page = stripComments(read(PAGE));

  test("섹션 9개를 목업 DOM 순서대로 렌더한다", () => {
    let last = -1;
    for (const [name] of SECTIONS) {
      const at = page.search(new RegExp(`<${name}[\\s/>]`));
      expect(at, `${name} 가 페이지에 없다`).toBeGreaterThan(last);
      last = at;
    }
    expect(page).toMatch(/<HomePopup\s/);
  });

  test.for(SECTIONS.map(([c, d]) => [c, d] as const))("%s 소스에 data-section=\"%s\"", ([component, dataSection]) => {
    expect(read(`${HOME_DIR}/${component}.tsx`)).toContain(`data-section="${dataSection}"`);
  });

  test("데이터는 페이지가 lib/queries 로 받아 props 로 내린다 (섹션 컴포넌트는 fetch 하지 않는다)", () => {
    for (const fn of ["getShowcaseRoutes", "getVehicles", "getGallery", "getNotices", "getActivePopup"]) {
      expect(page, fn).toMatch(new RegExp(`${fn}\\(`));
    }
    for (const { file, code } of homeCode) {
      expect(/@\/lib\/queries|createAnonClient/.test(code), `${file} 가 직접 조회한다`).toBe(false);
    }
  });

  test("정적 렌더 — force-dynamic 없음 · ISR revalidate 있음 · searchParams 는 개발 분기에서만", () => {
    expect(/force-dynamic/.test(page)).toBe(false);
    expect(page).toMatch(/export\s+const\s+revalidate\s*=\s*\d+/);
    const guard = page.indexOf('process.env.NODE_ENV !== "production"');
    const sp = page.indexOf("await searchParams");
    expect(guard).toBeGreaterThan(-1);
    expect(sp).toBeGreaterThan(guard);
  });

  test("팝업 프리뷰 분기(?previewPopup=1)는 원격 행 대신 더미 props 를 쓴다 — 원격에 행을 넣지 않는다", () => {
    expect(page).toMatch(/previewPopup/);
    expect(page).toMatch(/PREVIEW_POPUP/);
    expect(PREVIEW_POPUP.id).toBe(0);
    expect(PREVIEW_POPUP.active).toBe(true);
  });

  test("generateMetadata 가 있고 제목에 브랜드명은 원장(COMPANY.brandName)에서 온다", () => {
    expect(page).toMatch(/export\s+async\s+function\s+generateMetadata/);
    expect(page).toMatch(/COMPANY\.brandName/);
  });

  test("gallery · notice 는 비어 있으면 섹션 자체를 숨긴다 (빈 그리드 금지)", () => {
    for (const f of ["GallerySection.tsx", "NoticeSection.tsx", "FleetSection.tsx"]) {
      const src = stripComments(read(`${HOME_DIR}/${f}`));
      expect(src, f).toMatch(/length\s*===\s*0\)\s*return\s+null/);
    }
  });
});

// =============================================================================
// 9. 히어로 — 이미지 자산 · priority 1장 · 캐러셀 규약 · 팝업 규약
// =============================================================================
const sha256 = (rel: string) => createHash("sha256").update(readFileSync(path.join(ROOT, rel))).digest("hex");

describe("9. 히어로 캐러셀 · 이미지 · 팝업", () => {
  test("public/hero/bus-01..06.jpg 가 mockups/assets 와 바이트 단위로 같다", () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const name = `bus-0${n}.jpg`;
      expect(existsSync(path.join(ROOT, "public/hero", name)), name).toBe(true);
      expect(sha256(`public/hero/${name}`)).toBe(sha256(`mockups/assets/${name}`));
    }
  });

  test("next/image 만 쓰고 <img> 는 없다; priority 는 HeroCarousel 의 첫 슬라이드 한 곳뿐", () => {
    for (const { file, code } of homeCode) {
      if (!file.endsWith(".tsx")) continue;
      expect(/<img[\s>]/.test(code), `${file} 에 <img>`).toBe(false);
    }
    const carousel = stripComments(read(`${HOME_DIR}/HeroCarousel.tsx`));
    expect(carousel.match(/priority=\{/g) ?? []).toHaveLength(1);
    expect(carousel).toMatch(/priority=\{i === 0\}/);
    for (const { file, code } of homeCode) {
      if (file.endsWith("HeroCarousel.tsx")) continue;
      expect(/\bpriority\b/.test(code), `${file} 에 priority`).toBe(false);
    }
  });

  test("캐러셀 — 5초 · hover/focus 정지 · reduced-motion · aria-current · 방향키", () => {
    const src = stripComments(read(`${HOME_DIR}/HeroCarousel.tsx`));
    expect(src).toMatch(/AUTOPLAY_MS\s*=\s*5000/);
    expect(src).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(src).toMatch(/onMouseEnter/);
    expect(src).toMatch(/onFocus/);
    expect(src).toMatch(/aria-current=/);
    expect(src).toMatch(/ArrowLeft/);
    expect(src).toMatch(/ArrowRight/);
    expect(src).toMatch(/visibilitychange/);
  });

  test("팝업 — dialog · aria-modal · ESC · localStorage try/catch · dismissKey 사용", () => {
    const src = stripComments(read(`${HOME_DIR}/Popup.tsx`));
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/aria-modal/);
    expect(src).toMatch(/Escape/);
    expect(src).toMatch(/dismissKey\(/);
    expect(src).toMatch(/localStorage/);
    expect((src.match(/try\s*\{/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(src.includes("toISOString().slice(0, 10)")).toBe(false);
  });
});

// =============================================================================
// 10. 이미지 URL 해석 — Storage 경로 · 절대 URL · 로컬 경로
// =============================================================================
describe("10. resolveImageUrl", () => {
  const SUPA = "https://example.supabase.co";
  test("절대 URL 과 / 로 시작하는 로컬 경로는 그대로", () => {
    expect(resolveImageUrl("https://cdn.example.com/a.jpg", SUPA)).toBe("https://cdn.example.com/a.jpg");
    expect(resolveImageUrl("/hero/bus-02.jpg", SUPA)).toBe("/hero/bus-02.jpg");
  });
  test("bucket/object 경로는 Supabase 공개 Storage URL 로", () => {
    expect(resolveImageUrl("gallery/2026/a.jpg", SUPA)).toBe(`${SUPA}/storage/v1/object/public/gallery/2026/a.jpg`);
    expect(resolveImageUrl("gallery/a.jpg", `${SUPA}/`)).toBe(`${SUPA}/storage/v1/object/public/gallery/a.jpg`);
  });
  test("빈 값·null 은 null, Supabase URL 이 없으면 상대 경로도 null (깨진 이미지를 만들지 않는다)", () => {
    expect(resolveImageUrl(null, SUPA)).toBeNull();
    expect(resolveImageUrl("  ", SUPA)).toBeNull();
    expect(resolveImageUrl("gallery/a.jpg", "")).toBeNull();
  });
});
