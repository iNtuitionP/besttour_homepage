import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

function readSource(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

describe("i18n/routing.ts — 라우트 골격 계약", () => {
  test("locales=['ko','en'], defaultLocale='ko', localePrefix='as-needed'", async () => {
    const { routing } = await import("@/i18n/routing");

    expect(routing.locales).toEqual(["ko", "en"]);
    expect(routing.defaultLocale).toBe("ko");
    expect(routing.localePrefix).toBe("as-needed");
  });

  test("로케일은 경로만 정한다 — localeDetection·localeCookie 끔 (P2-6b · 동작은 tests/header-locale.test.ts §2)", async () => {
    const { routing } = await import("@/i18n/routing");

    expect(routing.localeDetection).toBe(false);
    expect(routing.localeCookie).toBe(false);
  });
});

describe("메시지 폴백 — en 은 공개 네임스페이스를 갖고, 없는 네임스페이스(admin)는 ko 로 떨어진다", () => {
  test("messages/en.json 에는 admin 이 없다 (관리자 화면은 로케일 밖 · 한국어 전용 — P2-6)", async () => {
    const en = JSON.parse(readSource("messages/en.json"));
    expect(en.admin).toBeUndefined();
    expect(en.common?.siteName).toBe("Bestour");
  });

  test("messages/ko.json에는 최소 키가 있다", async () => {
    const ko = JSON.parse(readSource("messages/ko.json"));
    expect(ko.common?.siteName).toBe("베스트투어");
  });

  test("병합 결과: locale='en' 은 영문 공개 문구 + ko 의 admin (loadMessages — 최상위 shallow 병합)", async () => {
    const { loadMessages } = await import("@/i18n/messages");
    const ko = JSON.parse(readSource("messages/ko.json"));

    const messages = loadMessages("en") as Record<
      string,
      Record<string, unknown>
    >;
    expect(messages.common.siteName).toBe("Bestour");
    expect(messages.admin).toEqual(ko.admin);
  });

  test("ko는 자기 자신과 병합돼도 동일하다", async () => {
    const { loadMessages } = await import("@/i18n/messages");
    const ko = JSON.parse(readSource("messages/ko.json"));

    expect(loadMessages("ko")).toEqual(ko);
  });

  test("지원하지 않는 로케일도 ko 메시지로 폴백한다", async () => {
    const { loadMessages } = await import("@/i18n/messages");

    const messages = loadMessages("fr") as Record<
      string,
      Record<string, string>
    >;
    expect(messages.common.siteName).toBe("베스트투어");
  });

  test("request.ts가 loadMessages를 통해 병합한다 (배선 확인)", () => {
    const source = readSource("i18n/request.ts");
    expect(source).toContain("loadMessages");
    expect(source).toMatch(/hasLocale\(routing\.locales/);
    expect(source).toContain("routing.defaultLocale");
  });
});

describe("middleware.ts — /admin을 matcher에서 제외하지 않는다", () => {
  test("matcher 정규식에 admin 부정문자열이 없다", () => {
    const source = readSource("middleware.ts");
    const matcherBlock = source.slice(source.indexOf("export const config"));

    // 부정 룩어헤드 `(?! ... admin ... )` 안에 admin이 들어 있으면 실패.
    const negativeLookaheads = matcherBlock.match(/\(\?![^)]*\)/g) ?? [];
    expect(negativeLookaheads.length).toBeGreaterThan(0);
    for (const lookahead of negativeLookaheads) {
      expect(lookahead).not.toContain("admin");
    }
  });

  test("matcher가 /api, /_next, 확장자 있는 경로는 계속 제외한다", () => {
    const source = readSource("middleware.ts");
    const matcherBlock = source.slice(source.indexOf("export const config"));

    expect(matcherBlock).toContain("api");
    expect(matcherBlock).toContain("_next");
    expect(matcherBlock).toContain(".*\\\\..*");
  });

  test("middleware 본문이 /admin을 로케일 처리 없이 통과시킨다", () => {
    const source = readSource("middleware.ts");
    expect(source).toMatch(/startsWith\(\s*["'`]\/admin["'`]\s*\)/);
    expect(source).toContain("P5-1");
  });
});

describe("app/admin — 공개 셸을 상속하지 않는다", () => {
  test("app/admin/layout.tsx에 Header/Footer/SiteLayout import가 0건", () => {
    const source = readSource("app/admin/layout.tsx");
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line));

    const publicShellImports = importLines.filter((line) =>
      /\b(Header|Footer|SiteLayout)\b/.test(line),
    );

    expect(publicShellImports).toEqual([]);
  });

  test("app/admin/layout.tsx는 (site) 셸 경로를 참조하지 않는다", () => {
    const source = readSource("app/admin/layout.tsx");
    expect(source).not.toContain("(site)");
    expect(source).not.toContain("[locale]");
  });
});
