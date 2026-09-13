/**
 * REVIEW-FIX (2026-09-12) — 독립 리뷰(REVIEW-2026-09-11.md) 잔여 5건의 계약 테스트.
 *
 *   M5  접수 코드 집합 LOCATION_CODES = PlaceCode ∪ RegionCode(28개) — 대표 노선 16쌍이 접수 스키마를 통과한다
 *   M6  phone XOR phoneIntl(로케일 무관) — 죽은 refine 대신 살아 있는 XOR, contactPhone() E.164 정규화
 *   M1  전역 404(app/not-found.tsx)가 <html lang><body> 를 직접 렌더 · (site) 404 · (site) error 바운더리
 *   M8  app/admin/layout.tsx force-dynamic — 관리자 응답은 CDN 에 남지 않는다
 *   M9  ci.yml legal-pages-http 잡 — LEGAL_BASE_URL 로 서버를 띄워 HTTP 테스트가 CI 에서 실제로 돈다
 *
 * 마지막 HTTP 블록은 LEGAL_BASE_URL 이 있을 때만 돈다(tests/legal-pages.test.ts §5 와 같은 가드). 그 서버를 띄우는 것이
 * ci.yml 의 legal-pages-http 잡이고, 그 잡이 이 파일도 함께 실행한다.
 * 로컬 재현: npm run build && npx next start -p 3117 → LEGAL_BASE_URL=http://127.0.0.1:3117 npx vitest run tests/review-fix.test.ts
 *
 * 주의: tests/ 아래라 게이트 3종의 검사 대상이다 — 금지어·임시값 마커 리터럴을 쓰지 않는다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  isLocationCode,
  LOCATION_CODES,
  locationLabelKo,
  locationRegion,
  PLACES,
  REGIONS,
  SHOWCASE_ROUTE_SEED,
  type LocationCode,
} from "@/lib/codes";
import { contactPhone } from "@/lib/reservations/phone";
import { ReservationInput } from "@/lib/types";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const ROOT_NOT_FOUND = "app/not-found.tsx";
const SITE_NOT_FOUND = "app/[locale]/(site)/not-found.tsx";
const SITE_ERROR = "app/[locale]/(site)/error.tsx";
const ADMIN_LAYOUT = "app/admin/layout.tsx";
const CI_YML = ".github/workflows/ci.yml";
const MESSAGES_KO = "messages/ko.json";

/** 리뷰 M5 가 "접수 폼에서 선택 불가"로 지적한 11개 도시 코드 */
const REVIEW_M5_REJECTED = ["TYG", "PHG", "JJU", "YSU", "HNM", "SJG", "SCH", "GNG", "TBK", "HCN", "WJU"] as const;

/** 유효한 접수 입력 — tests/schema.test.ts 의 validInput 과 같은 모양 */
const validInput = {
  name: "홍길동",
  phone: "010-1234-5678",
  vehicleSlug: "bus45" as const,
  purposeCode: "family" as const,
  originCode: "SEL" as const,
  destinationCode: "BSN" as const,
  waypointCodes: [] as string[],
  tripType: "oneway" as const,
  departAtLocal: "2026-09-01T08:00",
  busCount: 1,
  locale: "ko" as const,
  turnstileToken: "test-turnstile-token",
  privacyConsent: true as const,
};

/** 주석을 걷어낸 코드만 남긴다 — tests/layout.test.ts 와 같은 구현 */
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock
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

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

/** `t("key")` / `t('key')` 로 쓰인 i18n 키를 소스에서 뽑는다 */
function usedMessageKeys(src: string): string[] {
  return [...src.matchAll(/\bt\(\s*["']([A-Za-z0-9_.]+)["']/g)].map((m) => m[1]);
}

// ═════════════════════════════════════════════════════════════════════════
// M5 — LOCATION_CODES
// ═════════════════════════════════════════════════════════════════════════
describe("M5 — LOCATION_CODES = PlaceCode ∪ RegionCode", () => {
  test("PLACES 17 + REGIONS 17 − 겹침 6 = 28개, 중복 0", () => {
    expect(PLACES).toHaveLength(17);
    expect(REGIONS).toHaveLength(17);
    const overlap = REGIONS.filter((r) => PLACES.some((p) => p.code === r));
    expect(overlap).toEqual(["ICN", "SEL", "BSN", "DGU", "GWJ", "DJN"]);
    expect(LOCATION_CODES).toHaveLength(28);
    expect(new Set(LOCATION_CODES).size).toBe(28);
  });

  test("순서: PLACES(sort 순) 먼저, 그 다음 REGIONS 잔여 11개(스펙 순서)", () => {
    const placeCodes = [...PLACES].sort((a, b) => a.sort - b.sort).map((p) => p.code);
    expect(LOCATION_CODES.slice(0, 17)).toEqual(placeCodes);
    expect(LOCATION_CODES.slice(17)).toEqual(["INC", "ULS", "GG", "GW", "CN", "CB", "GB", "GN", "JN", "JB", "JJ"]);
  });

  test("정확히 합집합이다 — PLACES 코드·REGIONS 전부 포함, 그 외 없음", () => {
    const union = new Set<string>([...PLACES.map((p) => p.code), ...REGIONS]);
    expect(new Set(LOCATION_CODES)).toEqual(union);
    for (const p of PLACES) expect(isLocationCode(p.code)).toBe(true);
    for (const r of REGIONS) expect(isLocationCode(r)).toBe(true);
  });

  test("SHOWCASE_ROUTE_SEED 16쌍 전부 isLocationCode — 리뷰가 지적한 11개 포함", () => {
    expect(SHOWCASE_ROUTE_SEED).toHaveLength(16);
    const rejected = SHOWCASE_ROUTE_SEED.filter(
      (s) => !isLocationCode(s.originCode) || !isLocationCode(s.destinationCode),
    );
    expect(rejected).toEqual([]);
    for (const c of REVIEW_M5_REJECTED) expect(isLocationCode(c), c).toBe(true);
  });

  test("isLocationCode 는 미지 코드·소문자·빈 문자열·번역 문자열을 거부한다", () => {
    for (const x of ["XXX", "tyg", "", "SEOUL", "서울", "ICN "]) {
      expect(isLocationCode(x), JSON.stringify(x)).toBe(false);
    }
  });

  test("locationRegion: 도시 → PLACES.regionCode, 시도 → 자기 자신, 결과는 항상 REGIONS 안", () => {
    expect(locationRegion("TYG")).toBe("GN");
    expect(locationRegion("GW")).toBe("GW");
    expect(locationRegion("SEL")).toBe("SEL");
    expect(locationRegion("SJG")).toBe("CN");
    // ICN 은 양쪽에 있다 — 카탈로그(PLACES) 우선이므로 시도는 인천(INC). 공항 판별은 코드 자체(=== "ICN")로 한다.
    expect(locationRegion("ICN")).toBe("INC");
    for (const c of LOCATION_CODES) expect(REGIONS).toContain(locationRegion(c));
  });

  test("locationLabelKo: 도시 → nameKo, 시도 → 시도 라벨 — 28개 전부 비어 있지 않고 서로 다르다", () => {
    expect(locationLabelKo("TYG")).toBe("통영");
    expect(locationLabelKo("ICN")).toBe("인천공항");
    expect(locationLabelKo("GW")).toBe("강원");
    expect(locationLabelKo("JJ")).toBe("제주");
    expect(locationLabelKo("INC")).toBe("인천");
    for (const c of LOCATION_CODES) expect(locationLabelKo(c).trim().length, c).toBeGreaterThan(0);
    expect(new Set(LOCATION_CODES.map((c) => locationLabelKo(c))).size).toBe(28);
  });
});

describe("M5 — ReservationInput 이 도시·시도 코드를 모두 받는다", () => {
  test("시도 코드(SEL→BSN) — 기존 계약 유지", () => {
    expect(ReservationInput.safeParse(validInput).success).toBe(true);
  });

  test("도시 코드(SEL→TYG) — 홈 대표 노선 카드 프리필이 접수까지 간다", () => {
    expect(ReservationInput.safeParse({ ...validInput, destinationCode: "TYG" }).success).toBe(true);
  });

  test("대표 노선 16쌍 전부 originCode/destinationCode 로 통과", () => {
    const failed = SHOWCASE_ROUTE_SEED.filter(
      (s) =>
        !ReservationInput.safeParse({ ...validInput, originCode: s.originCode, destinationCode: s.destinationCode })
          .success,
    ).map((s) => `${s.originCode}->${s.destinationCode}`);
    expect(failed).toEqual([]);
  });

  test("미지 코드(XXX)·번역 문자열은 거부", () => {
    expect(ReservationInput.safeParse({ ...validInput, originCode: "XXX" }).success).toBe(false);
    expect(ReservationInput.safeParse({ ...validInput, destinationCode: "통영" }).success).toBe(false);
  });

  test("경유지: 도시·시도 혼합 통과, 미지 코드 거부, 5개 초과 거부", () => {
    expect(ReservationInput.safeParse({ ...validInput, waypointCodes: ["TYG", "GW", "SJG"] }).success).toBe(true);
    expect(ReservationInput.safeParse({ ...validInput, waypointCodes: ["TYG", "XXX"] }).success).toBe(false);
    expect(
      ReservationInput.safeParse({ ...validInput, waypointCodes: ["TYG", "PHG", "JJU", "YSU", "HNM", "SJG"] }).success,
    ).toBe(false);
  });

  test("파싱 결과의 코드 타입이 LocationCode 로 좁혀진다(컴파일 계약)", () => {
    const parsed = ReservationInput.parse({ ...validInput, destinationCode: "TYG" });
    const dest: LocationCode = parsed.destinationCode;
    expect(locationRegion(dest)).toBe("GN");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// M6 — phone XOR phoneIntl
// ═════════════════════════════════════════════════════════════════════════
describe("M6 — phone XOR phoneIntl (로케일 무관)", () => {
  const { phone: _omitPhone, ...noPhone } = validInput;
  void _omitPhone;

  const cases = [
    { name: "phone 만", patch: { phone: "010-1234-5678" }, ok: true },
    { name: "phone 만(하이픈 없음)", patch: { phone: "01012345678" }, ok: true },
    { name: "phoneIntl 만", patch: { phoneIntl: "+15551234567" }, ok: true },
    { name: "phoneIntl 만(+82 국내번호)", patch: { phoneIntl: "+821012345678" }, ok: true },
    { name: "둘 다", patch: { phone: "010-1234-5678", phoneIntl: "+15551234567" }, ok: false },
    { name: "둘 다 없음", patch: {}, ok: false },
    { name: "phone 에 국제형식(필드 위반)", patch: { phone: "+821012345678" }, ok: false },
    { name: "phoneIntl 에 010-…(필드 위반)", patch: { phoneIntl: "010-1234-5678" }, ok: false },
    {
      name: "phone 빈 문자열 + phoneIntl — 빈 문자열은 '없음'이 아니라 형식 위반(폼은 빈 칸을 아예 빼서 보낸다)",
      patch: { phone: "", phoneIntl: "+15551234567" },
      ok: false,
    },
  ] as const;

  for (const locale of ["ko", "en"] as const) {
    test.for(cases)(`locale=${locale} · $name → $ok`, ({ patch, ok }) => {
      const result = ReservationInput.safeParse({ ...noPhone, locale, ...patch });
      expect(result.success).toBe(ok);
    });
  }

  test("둘 다 / 둘 다 없음 의 에러 path 는 ['phone'] (필드 레벨 위반이 아니라 XOR 위반)", () => {
    for (const patch of [{ phone: "010-1234-5678", phoneIntl: "+15551234567" }, {}]) {
      const result = ReservationInput.safeParse({ ...noPhone, ...patch });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.map((i) => i.path.join("."))).toEqual(["phone"]);
      expect(result.error.issues[0].code).toBe("custom");
    }
  });

  test("옛 refine 의 자취가 없다 — locale 로 전화번호를 강제하지 않는다", () => {
    const src = stripComments(read("lib/types.ts"));
    expect(src).not.toMatch(/locale\s*!==\s*["']en["']/);
    expect(src).toMatch(/superRefine|\.check\(/);
  });
});

describe("M6 — contactPhone(): E.164 하나로 정규화", () => {
  test("phone '010-1234-5678' → +821012345678 / kr", () => {
    expect(contactPhone({ phone: "010-1234-5678" })).toEqual({ e164: "+821012345678", kind: "kr" });
  });

  test("하이픈 없는 국내번호·10자리(01x-xxx-xxxx)도 같은 규칙", () => {
    expect(contactPhone({ phone: "01012345678" })).toEqual({ e164: "+821012345678", kind: "kr" });
    expect(contactPhone({ phone: "011-123-4567" })).toEqual({ e164: "+82111234567", kind: "kr" });
  });

  test("phoneIntl 은 그대로 — 국가번호가 82 가 아니면 intl", () => {
    expect(contactPhone({ phoneIntl: "+15551234567" })).toEqual({ e164: "+15551234567", kind: "intl" });
    expect(contactPhone({ phoneIntl: "+8613800138000" })).toEqual({ e164: "+8613800138000", kind: "intl" });
  });

  test("phoneIntl 로 들어온 +82 국내번호는 kind 가 kr 이다 — 종류는 칸이 아니라 국가번호로 정한다", () => {
    expect(contactPhone({ phoneIntl: "+821012345678" })).toEqual({ e164: "+821012345678", kind: "kr" });
  });

  test("둘 다 / 둘 다 없음 / 빈 문자열 둘 은 throw (스키마가 먼저 걸러야 할 프로그래밍 오류)", () => {
    expect(() => contactPhone({ phone: "010-1234-5678", phoneIntl: "+15551234567" })).toThrow();
    expect(() => contactPhone({})).toThrow();
    expect(() => contactPhone({ phone: "", phoneIntl: "" })).toThrow();
  });

  test("형식이 깨진 값은 throw — 정규화가 잘못된 번호를 만들어 내지 않는다", () => {
    expect(() => contactPhone({ phone: "123" })).toThrow();
    expect(() => contactPhone({ phoneIntl: "010-1234-5678" })).toThrow();
  });

  test("ReservationInput 파싱 결과를 그대로 넣을 수 있다(타입·값 왕복)", () => {
    const kr = ReservationInput.parse(validInput);
    expect(contactPhone(kr).e164).toBe("+821012345678");
    const intl = ReservationInput.parse({ ...validInput, phone: undefined, phoneIntl: "+15551234567" });
    expect(contactPhone(intl)).toEqual({ e164: "+15551234567", kind: "intl" });
  });
});

// ═════════════════════════════════════════════════════════════════════════
// M1 — 404 / error 바운더리 (소스 계약 — 런타임은 아래 HTTP 블록 + browse 실측)
// ═════════════════════════════════════════════════════════════════════════
describe("M1 — 전역 404 · (site) 404 · (site) error 바운더리", () => {
  test("app/not-found.tsx: 루트 레이아웃이 통과만 하므로 <html lang> 과 <body> 를 직접 렌더한다", () => {
    const src = read(ROOT_NOT_FOUND);
    expect(src).toMatch(/<html\s[^>]*lang=/);
    expect(src).toMatch(/<body[\s>]/);
    expect(src).toMatch(/<\/body>\s*<\/html>/);
  });

  test('app/not-found.tsx: 로케일 밖 — i18n Link 가 아니라 <a href="/">, 원장 COMPANY.tel 로 전화 링크', () => {
    const src = read(ROOT_NOT_FOUND);
    expect(src).not.toMatch(/from\s+["']@\/i18n\/navigation["']/);
    expect(src).not.toMatch(/from\s+["']next\/link["']/);
    expect(src).toMatch(/<a\s[^>]*href="\/"/);
    expect(src).toContain("COMPANY.tel");
    expect(src).toMatch(/href=\{`tel:\$\{COMPANY\.tel\}`\}/);
  });

  test("(site)/not-found.tsx: 공개 셸 상속 — <html>/<body> 없음, i18n Link 로 홈, 같은 errors 문구", () => {
    const src = read(SITE_NOT_FOUND);
    expect(src).not.toMatch(/<html/);
    expect(src).not.toMatch(/<body/);
    expect(src).toMatch(/from\s+["']@\/i18n\/navigation["']/);
    expect(src).toContain("COMPANY.tel");
    expect(usedMessageKeys(src)).toEqual(expect.arrayContaining(["notFoundTitle", "notFoundBody", "home"]));
    expect(usedMessageKeys(read(ROOT_NOT_FOUND))).toEqual(
      expect.arrayContaining(["notFoundTitle", "notFoundBody", "home"]),
    );
  });

  test("(site)/error.tsx: 'use client' 첫 문장 · reset() 버튼 · 에러 원문(message/stack/String(error)) 미노출", () => {
    const src = read(SITE_ERROR);
    expect(src.trimStart()).toMatch(/^["']use client["']/);
    expect(src).toMatch(/onClick=\{\s*\(\)\s*=>\s*reset\(\)\s*\}|onClick=\{reset\}/);
    const code = stripComments(src);
    expect(code).not.toMatch(/error\.message/);
    expect(code).not.toMatch(/error\.stack/);
    expect(code).not.toMatch(/error\.toString/);
    expect(code).not.toMatch(/String\(\s*error\s*\)/);
    expect(code).not.toMatch(/\{\s*error\s*\}/);
  });

  test("messages/ko.json 의 errors 네임스페이스 — 세 파일이 쓰는 키가 전부 있고 비어 있지 않다", () => {
    const ko = JSON.parse(read(MESSAGES_KO)) as { errors?: Record<string, string> };
    expect(ko.errors).toBeDefined();
    const used = new Set([ROOT_NOT_FOUND, SITE_NOT_FOUND, SITE_ERROR].flatMap((f) => usedMessageKeys(read(f))));
    expect(used.size).toBeGreaterThanOrEqual(4);
    for (const key of used) {
      expect(typeof ko.errors?.[key], key).toBe("string");
      expect((ko.errors?.[key] ?? "").trim().length, key).toBeGreaterThan(0);
    }
    expect(ko.errors?.retry).toBeTruthy();
  });

  test("세 파일에 한글 리터럴 0건 — 문구는 i18n(errors) 과 원장에서만", () => {
    for (const rel of [ROOT_NOT_FOUND, SITE_NOT_FOUND, SITE_ERROR]) {
      const offenders = stripComments(read(rel))
        .split("\n")
        .map((l, i) => [i + 1, l] as const)
        .filter(([, l]) => HANGUL.test(l));
      expect(offenders, rel).toEqual([]);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
// M8 — /admin force-dynamic
// ═════════════════════════════════════════════════════════════════════════
describe("M8 — /admin 은 요청마다 렌더한다", () => {
  test('app/admin/layout.tsx 에 export const dynamic = "force-dynamic"', () => {
    const src = stripComments(read(ADMIN_LAYOUT));
    expect(src).toMatch(/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// M9 — ci.yml legal-pages-http 잡
// ═════════════════════════════════════════════════════════════════════════
describe("M9 — ci.yml legal-pages-http 잡", () => {
  const yml = read(CI_YML);
  const start = yml.search(/^ {2}legal-pages-http:/m);
  const rest = start >= 0 ? yml.slice(start + 1) : "";
  const nextJob = rest.search(/^ {2}[a-z][a-z0-9-]*:\s*$/m);
  const job = start >= 0 ? (nextJob >= 0 ? rest.slice(0, nextJob) : rest) : "";

  test("잡이 존재한다", () => {
    expect(start, "legal-pages-http 잡 없음").toBeGreaterThanOrEqual(0);
  });

  test("build → start → 포트 대기 → LEGAL_BASE_URL 로 vitest(legal-pages + review-fix) 순서", () => {
    const iBuild = job.indexOf("npm run build");
    const iStart = job.search(/npm start|next start/);
    const iBase = job.indexOf("LEGAL_BASE_URL");
    const iVitest = job.indexOf("tests/legal-pages.test.ts");
    expect(iBuild).toBeGreaterThan(0);
    expect(iStart).toBeGreaterThan(iBuild);
    expect(iBase).toBeGreaterThan(iStart);
    expect(iVitest).toBeGreaterThan(iStart);
    expect(job).toContain("tests/review-fix.test.ts");
    expect(job).toMatch(/curl[^\n]*--retry|for i in|until curl/);
  });

  test("같은 잡에서 M1(_not-found.html 의 <html) 과 M8(/admin 헤더 s-maxage 부재) 을 셸로 단언한다", () => {
    expect(job).toContain("_not-found.html");
    expect(job).toMatch(/<html/);
    expect(job).toContain("s-maxage");
    expect(job).toMatch(/x-nextjs-prerender/);
    expect(job).toMatch(/\/admin/);
  });

  test("skip 0 을 강제한다 — vitest 출력에 skipped 가 있으면 실패", () => {
    expect(job).toMatch(/skipped/);
  });

  // P3-4 (2026-09-13): /quote 의 폼 토큰은 요청마다 새로 서명돼야 한다(FORM_MAX_AGE_MS 1시간). 빌드 표 글리프(●/ƒ)가 아니라
  // 런타임으로 잠근다 — 두 요청의 formToken 이 다르고 no-store 여야 하며, 토큰을 만들 GUARD_SECRET 은 일회용 문자열로 준다(secrets.* 아님).
  // P6-3 (2026-09-13): 옛 메뉴 매핑의 ready:true 경로 전부 + 예약확인 + 법정 3페이지가 200, 없는 공지 id 는 404.
  // 그 404 의 문서 껍데기는 일부러 단언하지 않는다 — docs/ops/known-defects.md D1(매칭된 라우트의 notFound() 가 __next_error__ 셸을 탄다).
  test("P6-3 — 공개 라우트 전수 200 + /notices/<없는 id> 404 를 단언한다", () => {
    const iStart = job.search(/npm start|next start/);
    const iRoutes = job.indexOf("/reservation/check");
    expect(iRoutes).toBeGreaterThan(iStart);
    for (const p of ["/about", "/fleet", "/fares", "/notices", "/gallery", "/reservation/check", "/guide", "/privacy", "/terms"]) {
      expect(job, `${p} 가 200 단언 목록에 없다`).toContain(p);
    }
    expect(job).toMatch(/\/notices\/does-not-exist/);
  });

  test("P3-4 — /quote 를 두 번 받아 formToken 이 다름·no-store·청약철회 고지·/quote/done 200 을 단언한다", () => {
    const iStart = job.search(/npm start|next start/);
    const iQuote = job.indexOf("/quote?step=6");
    expect(iQuote).toBeGreaterThan(iStart);
    expect(job).toMatch(/formToken/);
    expect(job).toMatch(/no-store/);
    expect(job).toMatch(/withdrawal-notice/);
    expect(job).toMatch(/\/quote\/done/);
    expect(job).toMatch(/GUARD_SECRET:\s*\S+/);
    expect(job).not.toMatch(/GUARD_SECRET:\s*\$\{\{\s*secrets/);
  });

  // 2026-09-13 개정: P2-4 홈이 ISR 이라 next build 가 빌드 타임에 Supabase 를 읽는다. "env 없음" 은 더 이상 성립하지 않는다.
  // 대신 잠그는 것 — (1) env 는 로컬 스택(supabase start → status)에서만 온다, (2) 원격 자격(secrets.*) 0, (3) 빌드는 export 뒤에,
  // (4) 스택은 always() 로 내린다. 법정 페이지가 DB 를 안 읽는다는 것은 legal-pages.test.ts 의 정적 import 검사가 맡는다.
  test("Supabase env 는 로컬 스택에서만 온다 — supabase start → db reset → status export → build 순서", () => {
    const iStack = job.indexOf("supabase start");
    const iReset = job.indexOf("supabase db reset");
    const iExport = job.indexOf("supabase status");
    const iBuild = job.indexOf("npm run build");
    expect(iStack).toBeGreaterThan(0);
    expect(iReset).toBeGreaterThan(iStack);
    expect(iExport).toBeGreaterThan(iReset);
    expect(iBuild).toBeGreaterThan(iExport);
    expect(job).toMatch(/--override-name api\.url=NEXT_PUBLIC_SUPABASE_URL/);
    expect(job).toMatch(/--override-name auth\.anon_key=NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(job).toMatch(/GITHUB_ENV/);
  });

  test("원격 프로젝트 자격은 이 잡에 없다 — secrets.* 0, env: 블록에 Supabase 키 리터럴 0", () => {
    expect(job).not.toMatch(/secrets\./);
    expect(job).not.toMatch(/NEXT_PUBLIC_SUPABASE_URL\s*:/);
    expect(job).not.toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY\s*:/);
    expect(job).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY\s*:/);
  });

  test("로컬 스택도 always() 로 내린다", () => {
    const iStop = job.indexOf("supabase stop");
    expect(iStop).toBeGreaterThan(0);
    const before = job.slice(0, iStop);
    const lastAlways = before.lastIndexOf("if: always()");
    expect(lastAlways).toBeGreaterThan(0);
    // 마지막 always() 와 supabase stop 사이에 다른 step 이 끼어 있지 않다
    expect(before.slice(lastAlways)).not.toMatch(/- name:/);
  });

  test("서버는 always() 로 정리한다", () => {
    expect(job).toMatch(/if:\s*always\(\)/);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// HTTP — LEGAL_BASE_URL 이 있을 때만 (ci.yml legal-pages-http 잡이 띄운 production 서버)
// ═════════════════════════════════════════════════════════════════════════
const BASE = process.env.LEGAL_BASE_URL;
describe.runIf(Boolean(BASE))("HTTP — production 서버 실측 (LEGAL_BASE_URL)", { timeout: 60_000 }, () => {
  // /dev/krmap 은 P2-4 에서 삭제됐다(홈에 KrMap 이 들어감) — 이제 여느 미지 경로와 같은 전역 404 다.
  test.for([["/no-such-page"], ["/fr"], ["/ko-KR/x"], ["/dev/krmap"]] as const)(
    "%s → 404 + <html lang> + <body> + 홈 링크 (M1)",
    async ([p]) => {
      const res = await fetch(`${BASE}${p}`);
      expect(res.status).toBe(404);
      const html = await res.text();
      expect(html).toMatch(/<html[^>]*\slang="[a-z]{2}"/);
      expect(html).toMatch(/<body[\s>]/);
      expect(html).toMatch(/<\/html>\s*$/);
      expect(html).toContain('href="/"');
    },
  );

  test("/admin → 200 · s-maxage=31536000 없음 · x-nextjs-prerender 없음 (M8)", async () => {
    const res = await fetch(`${BASE}/admin`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control") ?? "").not.toContain("s-maxage=31536000");
    expect(res.headers.get("x-nextjs-prerender")).toBeNull();
  });
});
