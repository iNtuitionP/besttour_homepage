/**
 * P6-3b — 공개 갤러리 **앨범 화면** 계약 테스트 (`/gallery` 색인 + `/gallery/[album]` 상세).
 *
 * 왜: P6-1 이 읽기 쿼리를, P6-2 가 관리자 앨범 관리를 만들었는데 방문자 쪽이 없었다. 사장님이 앨범을 나눠도
 * 공개 화면은 사진을 한 덩어리로 쏟았다. 이 태스크가 그 사이를 잇는다.
 *
 * vitest 는 node 환경이다(DOM 렌더 패키지를 새로 설치하지 않는다 — 브리프 §하지 말 것). 그래서 여기서는
 *   (1) 소스 정적 검사(라우트·ISR·notFound·canonical·요청 시점 API·한글 리터럴 0),
 *   (2) 순수 함수(buildAlbumCards · normalizeAlbumPage · albumPageOffset),
 *   (3) mock 클라이언트로 lib/queries 경로(형식 위반 slug 는 DB 에 가지 않는다),
 *   (4) i18n 키 대칭 — **실제 병합 함수(loadMessages)** 로,
 *   (5) DB 실증(로컬 스택 + REQUIRE_DB_TESTS=1)
 * 만 잠그고, 실제 렌더(375px 가로 스크롤·콘솔·404 문서 껍데기)는 browse/curl 실측으로 보고서에 남긴다.
 *
 * 주의: tests/ 아래라 게이트 3종(check-no-pricing · check-legal-disclosures · check-temp-values)의 검사 대상이다 —
 * 금지어·임시값 마커 리터럴을 두지 않는다.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  ALBUM_PAGE_SIZE,
  MAX_ALBUM_PAGE,
  albumPageOffset,
  buildAlbumCards,
  normalizeAlbumPage,
} from "@/components/pages/albums";
import { loadMessages } from "@/i18n/messages";
import {
  MAX_GALLERY_PAGE_LIMIT,
  getAlbumBySlug,
  getAlbums,
  getGalleryPage,
  parseAlbumSlug,
} from "@/lib/queries";
import type { AnonClient } from "@/lib/supabase/anon";
import type { GalleryAlbum, GalleryItem } from "@/lib/types";
import { withGalleryLock } from "./helpers/db-lock";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = "app/[locale]/(site)";
const INDEX_PAGE = `${SITE}/gallery/page.tsx`;
const ALBUM_PAGE = `${SITE}/gallery/[album]/page.tsx`;
const ALBUM_CARDS = "components/pages/AlbumCards.tsx";
const ALBUM_HELPERS = "components/pages/albums.ts";
const PAGES_CSS = "components/pages/pages.module.css";
const CI_YML = ".github/workflows/ci.yml";

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const exists = (rel: string) => existsSync(path.join(ROOT, rel));

/** 주석 제거 — 블록 주석 전체, 줄 주석은 문자열 밖의 // 부터 (tests/pages.test.ts 와 같은 규칙) */
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

const squish = (s: string) => s.replace(/\s+/g, " ").trim();
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const album = (over: Partial<GalleryAlbum> = {}): GalleryAlbum => ({
  id: 1,
  slug: "airport-pickup",
  title: "공항 픽업",
  description: null,
  sort: 0,
  active: true,
  createdAt: "2026-09-15T00:00:00+00:00",
  ...over,
});

const photo = (over: Partial<GalleryItem> = {}): GalleryItem => ({
  id: 1,
  imagePath: "gallery/a.webp",
  caption: null,
  sort: 0,
  active: true,
  ...over,
});

// =============================================================================
// 0. 산출물이 실제로 있다 (빈 배열 통과 방지)
// =============================================================================
describe("0. 산출물", () => {
  test.for([[INDEX_PAGE], [ALBUM_PAGE], [ALBUM_CARDS], [ALBUM_HELPERS]] as const)("%s 가 있다", ([rel]) => {
    expect(exists(rel), `${rel} 없음`).toBe(true);
  });
});

// =============================================================================
// 1. 앨범 0개 = 현상 유지 — 기존 화면을 한 픽셀도 바꾸지 않는다 (브리프 §검증 1)
// =============================================================================
describe("1. /gallery — 앨범 0개면 지금과 같다", () => {
  const code = stripComments(read(INDEX_PAGE));

  test("기존 평면 그리드 블록이 글자 그대로 남아 있다 (빈 상태 · GalleryGrid · 홈 링크)", () => {
    const original = squish(`
      {pictures.length === 0 ? (
        <div className={p.empty} role="status" data-testid="gallery-empty">
          <p>{t("empty")}</p>
          <p className={p.emptyAction}>
            <Link className={h.btnGhost} href="/">
              {tErrors("home")}
            </Link>
          </p>
        </div>
      ) : (
        <GalleryGrid pictures={pictures} />
      )}
    `);
    expect(squish(code)).toContain(original);
  });

  test("기존 조회·섹션 골격 유지 — getGallery(60) · data-section=\"gallery\" · toneLav · data-testid=\"gallery-page\"", () => {
    expect(code).toMatch(/getGallery\(\s*60\s*\)/);
    expect(code).toContain('data-section="gallery"');
    expect(code).toContain("h.toneLav");
    expect(code).toContain('data-testid="gallery-page"');
  });

  test("새로 그리는 것은 전부 `albums.length > 0` 안에 있다 — 앨범 0개면 DOM 이 늘지 않는다", () => {
    // 두 곳뿐이다: (a) 앨범 색인 섹션 (b) 평면 그리드 위의 "전체 사진" 머리.
    expect(occurrences(code, "albums.length > 0 ? (")).toBe(2);
    expect(code).toMatch(/\{albums\.length > 0 \? \([\s\S]*?data-section="gallery-albums"[\s\S]*?\) : null\}/);
    expect(code).toMatch(/\{albums\.length > 0 \? \([\s\S]*?allTitle[\s\S]*?\) : null\}/);
    // 가드 밖에 앨범 마크업이 새지 않았다
    for (const token of ["<AlbumCards", "gallery-albums", "albumsTitle", "allTitle"]) {
      expect(occurrences(code, token), `${token} 이 가드 밖에도 있다`).toBeGreaterThan(0);
    }
  });

  test("색인 페이지는 여전히 정적 렌더 규약을 지킨다 — revalidate 600 · searchParams·headers·cookies 0", () => {
    expect(code).toMatch(/export\s+const\s+revalidate\s*=\s*600\b/);
    expect(/force-dynamic/.test(code)).toBe(false);
    expect(/searchParams/.test(code)).toBe(false);
    expect(/\bheaders\s*\(/.test(code)).toBe(false);
    expect(/\bcookies\s*\(/.test(code)).toBe(false);
  });
});

// =============================================================================
// 2. /gallery 색인 — 앨범 목록 + 표지 조회 배선
// =============================================================================
describe("2. /gallery — 앨범 색인 배선", () => {
  const code = stripComments(read(INDEX_PAGE));

  test("getAlbums() 로 활성 앨범을 읽고, 표지는 그 앨범의 첫 사진 1장(getGalleryPage limit 1)", () => {
    expect(code).toMatch(/getAlbums\(\s*\)/);
    expect(code).toMatch(/getGalleryPage\(\s*\{[^}]*albumId[^}]*limit:\s*1[^}]*\}\s*\)/);
  });

  test("카드 조립은 순수 함수 buildAlbumCards 로 — 페이지 안에서 손으로 조립하지 않는다", () => {
    expect(code).toMatch(/buildAlbumCards\(/);
    expect(code).toMatch(/from\s*["']@\/components\/pages\/albums["']/);
  });

  test("한글 리터럴 0 — 문구는 messages 의 pages.gallery 에서만", () => {
    const hits = code.split("\n").filter((l) => HANGUL.test(l));
    expect(hits).toEqual([]);
  });
});

// =============================================================================
// 3. buildAlbumCards — 순수 규칙 (브리프 §검증 2·3)
// =============================================================================
describe("3. buildAlbumCards", () => {
  test("앨범 N개 → 카드 N개, 받은 순서(= getAlbums 의 sort 순)를 그대로 유지한다", () => {
    const albums = [
      album({ id: 1, slug: "b-album", title: "두번째", sort: 1 }),
      album({ id: 2, slug: "a-album", title: "첫번째", sort: 2 }),
      album({ id: 3, slug: "c-album", title: "세번째", sort: 3 }),
    ];
    const cards = buildAlbumCards(albums, [[photo()], [photo({ id: 2 })], [photo({ id: 3 })]]);
    expect(cards.map((c) => c.slug)).toEqual(["b-album", "a-album", "c-album"]);
    expect(cards.map((c) => c.title)).toEqual(["두번째", "첫번째", "세번째"]);
  });

  test("사진 없는 앨범도 카드가 남는다 — hasPhotos false, cover null (감추지 않는다)", () => {
    const cards = buildAlbumCards([album({ slug: "empty-one" })], [[]]);
    expect(cards).toHaveLength(1);
    expect(cards[0].hasPhotos).toBe(false);
    expect(cards[0].cover).toBeNull();
  });

  test("표지 URL 을 해석할 수 없어도 hasPhotos 는 true — '준비 중'을 잘못 붙이지 않는다", () => {
    const cards = buildAlbumCards([album()], [[photo({ imagePath: "" })]]);
    expect(cards[0].cover).toBeNull();
    expect(cards[0].hasPhotos).toBe(true);
  });

  test("표지는 받은 첫 장(= sort 순 첫 사진)이고 절대 URL 은 그대로 쓴다", () => {
    const cards = buildAlbumCards(
      [album()],
      [[photo({ id: 7, imagePath: "https://cdn.example.com/a.webp" }), photo({ id: 8 })]],
    );
    expect(cards[0].cover?.id).toBe(7);
    expect(cards[0].cover?.src).toBe("https://cdn.example.com/a.webp");
  });

  test("설명은 그대로 나른다(null 포함) — 개수·장수를 지어내지 않는다", () => {
    const cards = buildAlbumCards([album({ description: "인천공항 픽업" }), album({ id: 2, slug: "x" })], [[], []]);
    expect(cards[0].description).toBe("인천공항 픽업");
    expect(cards[1].description).toBeNull();
    expect(Object.keys(cards[0]).sort()).toEqual(["cover", "description", "hasPhotos", "slug", "title"]);
  });

  test("앨범 0개면 카드 0개", () => {
    expect(buildAlbumCards([], [])).toEqual([]);
  });
});

// =============================================================================
// 4. /gallery/[album] — 라우트 계약 (브리프 §만들 것 (2))
// =============================================================================
describe("4. /gallery/[album] 라우트", () => {
  const code = stripComments(read(ALBUM_PAGE));

  test("ISR 600 · dynamicParams true · generateStaticParams 없음 (관리자가 새로 만든 앨범이 404 가 되면 안 된다)", () => {
    expect(code).toMatch(/export\s+const\s+revalidate\s*=\s*600\b/);
    expect(code).toMatch(/export\s+const\s+dynamicParams\s*=\s*true/);
    expect(/generateStaticParams/.test(code)).toBe(false);
    expect(/force-dynamic/.test(code)).toBe(false);
  });

  test("parseAlbumSlug 로 먼저 거른다 — 라우트에서 slug 정규식을 다시 쓰지 않는다", () => {
    expect(code).toMatch(/parseAlbumSlug\(/);
    expect(/\[a-z0-9\]/.test(code), "0008 CHECK 와 짝인 정규식을 라우트가 복제했다").toBe(false);
  });

  test("getAlbumBySlug → 없으면 notFound() (리다이렉트로 피하지 않는다 — D1 결정)", () => {
    expect(code).toMatch(/import\s*\{[^}]*\bnotFound\b[^}]*\}\s*from\s*["']next\/navigation["']/);
    expect(code).toMatch(/notFound\(\)/);
    expect(code).toMatch(/getAlbumBySlug\(/);
    expect(/\bredirect\s*\(/.test(code), "soft-404 로 피하지 않는다").toBe(false);
  });

  test("사진은 getGalleryPage({ albumId, … }) 로만 — 페이지 상한은 ALBUM_PAGE_SIZE", () => {
    expect(code).toMatch(/getGalleryPage\(/);
    expect(code).toMatch(/albumId:\s*album\.id/);
    expect(code).toMatch(/ALBUM_PAGE_SIZE/);
    expect(/getGallery\(/.test(code.replace(/getGalleryPage\(/g, "")), "평면 조회를 섞지 않는다").toBe(false);
  });

  test("서버 액션·서비스 롤·raw HTML·next/link 0 (다른 공개 페이지와 같은 규약)", () => {
    const raw = read(ALBUM_PAGE);
    expect(/['"]use server['"]/.test(code)).toBe(false);
    expect(/createServiceClient|service_role|SUPABASE_SERVICE_ROLE_KEY/.test(code)).toBe(false);
    expect(/@\/lib\/supabase\/server/.test(code)).toBe(false);
    expect(/@\/actions\//.test(code)).toBe(false);
    expect(raw.includes("dangerouslySetInnerHTML")).toBe(false);
    expect(/from\s+["']next\/link["']/.test(raw)).toBe(false);
    expect(/^\s*["']use client["']/m.test(raw)).toBe(false);
  });

  test("한글 리터럴 0 — 제목·설명은 DB, 나머지는 messages", () => {
    expect(code.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
  });
});

// =============================================================================
// 5. generateMetadata — canonical · 앨범 제목 (브리프 §검증 8)
// =============================================================================
describe("5. /gallery/[album] generateMetadata", () => {
  const code = stripComments(read(ALBUM_PAGE));

  test("canonical 은 canonicalUrl('/gallery/<slug>') 한 번뿐이고 원점을 하드코딩하지 않는다", () => {
    const args = [...code.matchAll(/canonicalUrl\(\s*([^)]*?)\s*\)/g)].map((m) => m[1]);
    expect(args).toEqual(["`/gallery/${album.slug}`"]);
    expect(code).toMatch(/alternates:\s*\{\s*canonical:\s*canonicalUrl\(/);
    expect(code).not.toContain("bestour.co.kr");
    expect(code).not.toMatch(/canonical:\s*new\s+URL/);
  });

  test("앨범 제목이 title 에, 설명이 description 에 들어간다", () => {
    expect(code).toMatch(/title:\s*album\.title/);
    expect(code).toMatch(/album\.description/);
    expect(code).toMatch(/COMPANY\.brandName/);
  });

  test("부재 분기 — noindex 이고 canonical 을 내지 않는다 (없는 문서에는 정본이 없다)", () => {
    const m = /if\s*\(\s*!album\s*\)\s*\{/.exec(code);
    expect(m, "부재 분기를 찾지 못했다").not.toBeNull();
    const open = code.indexOf("{", m!.index);
    let depth = 0;
    let block = "";
    for (let i = open; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") {
        depth--;
        if (depth === 0) {
          block = code.slice(open, i + 1);
          break;
        }
      }
    }
    expect(block).toMatch(/robots:\s*\{\s*index:\s*false/);
    expect(block).not.toContain("canonical");
  });

  test("요청 안에서 조회를 한 번만 한다 (React cache 로 dedupe — notices/[id] 선례)", () => {
    expect(code).toMatch(/from\s*["']react["']/);
    expect(code).toMatch(/cache\(/);
  });
});

// =============================================================================
// 6. slug 거름 — 형식 위반은 DB 에 가지 않고 404 (브리프 §검증 5·6)
// =============================================================================
describe("6. slug 형식 위반 · 부재 · 비활성", () => {
  type Call = { method: string; args: unknown[] };
  function fakeClient(result: { data: unknown; error: { code?: string; message: string } | null }): {
    client: AnonClient;
    calls: Call[];
  } {
    const calls: Call[] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "select", "eq", "order", "limit", "range", "maybeSingle", "overrideTypes"]) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ method: m, args });
        return chain;
      };
    }
    chain.then = (ok: (v: unknown) => unknown, ng?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, ng);
    return { client: chain as unknown as AnonClient, calls };
  }

  test("대문자 · 연속 하이픈 · 앞뒤 하이픈 · 41자 는 parseAlbumSlug 가 null 로 만든다", () => {
    for (const bad of ["Airport", "AIRPORT", "double--hyphen", "-lead", "trail-", "a".repeat(41)]) {
      expect(parseAlbumSlug(bad), bad).toBeNull();
    }
    expect(parseAlbumSlug("airport-pickup")).toBe("airport-pickup");
    expect(parseAlbumSlug("a".repeat(40))).toBe("a".repeat(40));
  });

  test("형식 위반이면 getAlbumBySlug 가 DB 에 가지 않는다 (from 조차 부르지 않는다)", async () => {
    const { client, calls } = fakeClient({ data: { id: 1 }, error: null });
    for (const bad of ["Airport", "double--hyphen", "-lead", "trail-", "a".repeat(41), "../etc"]) {
      expect(await getAlbumBySlug(bad, client), bad).toBeNull();
    }
    expect(calls).toEqual([]);
  });

  test("형식은 맞지만 없는 slug → null (0행). 비활성 앨범도 RLS 가 0행으로 만들어 같은 null 이다", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    expect(await getAlbumBySlug("does-not-exist", client)).toBeNull();
    const eqs = calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual(expect.arrayContaining([["slug", "does-not-exist"], ["active", true]]));
  });
});

// =============================================================================
// 7. 페이지네이션 정규화 (브리프 §검증 7)
// =============================================================================
describe("7. normalizeAlbumPage · albumPageOffset", () => {
  test("한 페이지 장수는 lib/queries 의 상한을 넘지 않는다", () => {
    expect(ALBUM_PAGE_SIZE).toBeGreaterThan(0);
    expect(Number.isInteger(ALBUM_PAGE_SIZE)).toBe(true);
    expect(ALBUM_PAGE_SIZE).toBeLessThanOrEqual(MAX_GALLERY_PAGE_LIMIT);
  });

  test("정상값은 그대로", () => {
    expect(normalizeAlbumPage("1")).toBe(1);
    expect(normalizeAlbumPage("2")).toBe(2);
    expect(normalizeAlbumPage(String(MAX_ALBUM_PAGE))).toBe(MAX_ALBUM_PAGE);
  });

  test("정수 아님 · 음수 · 0 · 거대값 · 빈 값 · 배열 → 전부 첫 페이지 (throw 하지 않는다)", () => {
    const bad = [
      undefined,
      "",
      " ",
      "0",
      "-1",
      "-99999",
      "1.5",
      "1e3",
      "abc",
      "2page",
      "٣",
      "9999999999999999999999",
      String(MAX_ALBUM_PAGE + 1),
      "Infinity",
      "NaN",
      "0x10",
      "+2",
    ];
    for (const raw of bad) {
      expect(() => normalizeAlbumPage(raw as string | undefined), JSON.stringify(raw)).not.toThrow();
      expect(normalizeAlbumPage(raw as string | undefined), JSON.stringify(raw)).toBe(1);
    }
    expect(normalizeAlbumPage(["3", "4"])).toBe(3);
    expect(normalizeAlbumPage(["x"])).toBe(1);
    expect(normalizeAlbumPage([])).toBe(1);
  });

  test("offset 은 (page-1) × 장수 이고, 상한 페이지에서도 안전한 정수다", () => {
    expect(albumPageOffset(1)).toBe(0);
    expect(albumPageOffset(2)).toBe(ALBUM_PAGE_SIZE);
    const max = albumPageOffset(MAX_ALBUM_PAGE);
    expect(Number.isSafeInteger(max)).toBe(true);
    expect(max).toBeLessThan(2147483647);
  });

  test("정규화한 어떤 page 로도 getGalleryPage 가 인자 검증에서 throw 하지 않는다", async () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "select", "eq", "order", "range", "overrideTypes"]) {
      chain[m] = () => chain;
    }
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    const client = chain as unknown as AnonClient;
    for (const raw of ["-1", "abc", String(MAX_ALBUM_PAGE), "1"]) {
      const page = normalizeAlbumPage(raw);
      await expect(
        getGalleryPage({ albumId: 1, limit: ALBUM_PAGE_SIZE, offset: albumPageOffset(page) }, client),
      ).resolves.toEqual({ items: [], hasMore: false });
    }
  });

  test("상세 페이지가 그 정규화를 실제로 쓴다 — 범위 밖이면 첫 페이지로 물러난다", () => {
    const code = stripComments(read(ALBUM_PAGE));
    expect(code).toMatch(/normalizeAlbumPage\(/);
    expect(code).toMatch(/albumPageOffset\(/);
    // 빈 페이지(데이터 끝을 넘긴 page)는 첫 페이지를 다시 읽는다
    expect(code).toMatch(/items\.length === 0 && page > 1/);
  });
});

// =============================================================================
// 8. 카피 · i18n 키 대칭 (브리프 §검증 9 · §만들 것 (4))
// =============================================================================
describe("8. messages · 카피 규칙", () => {
  const koRaw = JSON.parse(read("messages/ko.json")) as Record<string, unknown>;
  const galleryKo = ((koRaw.pages ?? {}) as Record<string, unknown>).gallery as Record<string, unknown>;

  function keyPaths(v: unknown, prefix = ""): string[] {
    if (!v || typeof v !== "object" || Array.isArray(v)) return [prefix];
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) =>
      keyPaths(x, prefix === "" ? k : `${prefix}.${k}`),
    );
  }

  test("pages.gallery 에 앨범 문구가 있다 (색인 · 카드 · 상세 · 페이지네이션)", () => {
    for (const key of ["albumsTitle", "albumsLabel", "allTitle", "albumPending"]) {
      expect(galleryKo, `pages.gallery.${key} 없음`).toHaveProperty(key);
    }
    const detail = galleryKo.detail as Record<string, unknown>;
    expect(detail).toBeTruthy();
    for (const key of ["back", "empty", "meta", "pager"]) {
      expect(detail, `pages.gallery.detail.${key} 없음`).toHaveProperty(key);
    }
  });

  test("ko/en 의 pages.gallery 키 집합이 런타임에 같다 — 실제 병합 함수(loadMessages)로 단언", () => {
    const pick = (locale: string) => {
      const pages = (loadMessages(locale) as { pages?: Record<string, unknown> }).pages ?? {};
      return keyPaths(pages.gallery).sort();
    };
    const ko = pick("ko");
    const en = pick("en");
    expect(ko.length).toBeGreaterThan(5);
    expect(en, "en 로케일에서 pages.gallery 키가 ko 와 다르다 — 한쪽만 채우면 런타임에 깨진다").toEqual(ko);
  });

  test("en.json 에 부분 네임스페이스를 넣지 않았다 — loadMessages 는 최상위 shallow 병합이다", () => {
    const en = JSON.parse(read("messages/en.json")) as Record<string, unknown>;
    // pages 를 en 에 반쯤 넣으면 ko 의 pages 전체(common·notices·…)가 통째로 가려진다.
    if (Object.prototype.hasOwnProperty.call(en, "pages")) {
      const enPages = keyPaths(en.pages).sort();
      const koPages = keyPaths(koRaw.pages).sort();
      expect(enPages).toEqual(koPages);
    }
  });

  test("새 문구에 실증 불가 수치·최상급·개수 자랑이 없다", () => {
    const text = JSON.stringify(galleryKo);
    for (const re of [/\d+\s*장/, /\d+\s*개/, /수백/, /수천/, /최고/, /최대/, /최저/, /저렴/, /누적/]) {
      expect(re.test(text), `pages.gallery 에 ${re}`).toBe(false);
    }
  });

  test("컴포넌트·헬퍼에 한글 리터럴 0 · 조회 0 · next/link 0", () => {
    for (const rel of [ALBUM_CARDS, ALBUM_HELPERS]) {
      const raw = read(rel);
      const code = stripComments(raw);
      expect(code.split("\n").filter((l) => HANGUL.test(l)), `${rel} 에 한글 리터럴`).toEqual([]);
      expect(/@\/lib\/queries|createAnonClient|@\/lib\/supabase/.test(code), `${rel} 가 직접 조회한다`).toBe(false);
      expect(/from\s+["']next\/link["']/.test(raw), rel).toBe(false);
      expect(/^\s*["']use client["']/m.test(raw), rel).toBe(false);
    }
  });

  test("새 CSS 는 pages.module.css 안에만 — 색은 역할 토큰, HEX·원시 토큰 0", () => {
    const css = read(PAGES_CSS).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toContain(".albumGrid");
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(/var\(\s*--(s[1-9]|r|r-s|r-xs|sh-[12]|maxw|ease|t)\s*[,)]/.test(css)).toBe(false);
    expect(exists("components/pages/AlbumCards.module.css")).toBe(false);
  });
});

// =============================================================================
// 9. CI — 없는 앨범의 404 를 상태코드로 단언한다 (브리프 §만들 것 (3))
// =============================================================================
describe("9. CI 단언", () => {
  const yml = read(CI_YML);

  test("legal-pages-http 잡이 /gallery/does-not-exist 를 404 로 단언한다", () => {
    expect(yml).toContain("/gallery/does-not-exist");
    expect(yml).toMatch(/gallery\/does-not-exist[\s\S]{0,400}?404/);
  });

  test("문서 껍데기는 단언하지 않는다 — D1 결정(거짓 green 방지)을 그대로 따른다", () => {
    const idx = yml.indexOf("/gallery/does-not-exist");
    const around = yml.slice(idx, idx + 400);
    expect(/<html\[\^>\]\* lang=/.test(around)).toBe(false);
  });

  test("ci.yml 에 제어문자가 섞이지 않았다 (과거 히어독 사고 재발 감시)", () => {
    // 탭·개행 말고 C0 제어문자가 있으면 YAML 이 조용히 깨진다.
    const bad = [...yml].filter((ch) => ch.charCodeAt(0) < 32 && ch !== "\n" && ch !== "\t");
    expect(bad).toEqual([]);
  });
});

// =============================================================================
// 10. DB 실증 — 로컬 스택 + REQUIRE_DB_TESTS=1 일 때만 (브리프 §검증 10)
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[gallery-albums-public.test] DB 실증 블록 skip — ${gate.reason}`);
}

describe.skipIf(!gate.allowed || !env.hasServiceRole)("10. DB — 공개 경로가 활성 앨범만 본다", () => {
  // 이 블록은 gallery · gallery_albums 에 행을 남긴다 — 표 전체를 단언하는 블록(home 4-DB)과 줄 세운다
  // (tests/helpers/db-lock.ts GALLERY_LOCK).
  withGalleryLock();

  const headers = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
  const SLUG_PREFIX = `p63b-${RUN}`;
  const PATH_PREFIX = `p63b-${RUN}/`;

  let onId = 0;
  let offId = 0;
  let anonClient: AnonClient;

  async function rest(method: string, q: string, json?: unknown, prefer?: string) {
    const res = await fetch(`${env.restRoot}${q}`, {
      method,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* JSON 이 아니면 문자열 그대로 */
    }
    return { status: res.status, body };
  }

  async function insertAlbum(suffix: string, active: boolean, sort: number): Promise<number> {
    const r = await rest(
      "POST",
      "/gallery_albums",
      { slug: `${SLUG_PREFIX}-${suffix}`, title: `P63B ${suffix}`, description: `desc ${suffix}`, sort, active },
      "return=representation",
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return (r.body as { id: number }[])[0].id;
  }

  async function insertPhoto(name: string, albumId: number | null, sort: number): Promise<void> {
    const r = await rest(
      "POST",
      "/gallery",
      { image_path: `${PATH_PREFIX}${name}.webp`, sort, active: true, album_id: albumId, width: 1600, height: 1200 },
      "return=representation",
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }

  beforeAll(async () => {
    expect(env.anonKey, "RLS 실증에는 anon 키가 필요하다").toBeTruthy();
    const probe = await rest("GET", "/gallery_albums?select=id&limit=1");
    if (probe.status !== 200) {
      throw new Error(`0008 이 이 DB 에 적용되지 않았다 — HTTP ${probe.status}`);
    }
    const { createClient } = await import("@supabase/supabase-js");
    anonClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, env.anonKey as string, {
      auth: { persistSession: false },
    });
    onId = await insertAlbum("on", true, 8001);
    offId = await insertAlbum("off", false, 8002);
    await insertPhoto("on-1", onId, 8001);
    await insertPhoto("on-2", onId, 8002);
    await insertPhoto("off-1", offId, 8003);
  });

  afterAll(async () => {
    await rest("DELETE", `/gallery?image_path=like.${encodeURIComponent(`*${PATH_PREFIX}*`)}`);
    await rest("DELETE", `/gallery_albums?slug=like.${encodeURIComponent(`*${SLUG_PREFIX}*`)}`);
    const leftPhotos = await rest("GET", `/gallery?select=id&image_path=like.${encodeURIComponent(`*${PATH_PREFIX}*`)}`);
    const leftAlbums = await rest("GET", `/gallery_albums?select=id&slug=like.${encodeURIComponent(`*${SLUG_PREFIX}*`)}`);
    expect(leftPhotos.body).toEqual([]);
    expect(leftAlbums.body).toEqual([]);
  });

  test("getAlbums — 활성 앨범만 보인다 (비활성은 RLS 가 0행)", async () => {
    const mine = (await getAlbums(anonClient)).filter((a) => a.slug.startsWith(SLUG_PREFIX));
    expect(mine.map((a) => a.slug)).toEqual([`${SLUG_PREFIX}-on`]);
  });

  test("getAlbumBySlug — 활성은 한 건, 비활성은 null (같은 404 경로)", async () => {
    const on = await getAlbumBySlug(`${SLUG_PREFIX}-on`, anonClient);
    expect(on?.title).toBe("P63B on");
    expect(await getAlbumBySlug(`${SLUG_PREFIX}-off`, anonClient)).toBeNull();
    expect(await getAlbumBySlug(`${SLUG_PREFIX}-nope`, anonClient)).toBeNull();
  });

  test("getGalleryPage(albumId) — 그 앨범의 사진만, sort 순", async () => {
    const page = await getGalleryPage({ albumId: onId, limit: ALBUM_PAGE_SIZE }, anonClient);
    expect(page.items.map((i) => i.imagePath)).toEqual([`${PATH_PREFIX}on-1.webp`, `${PATH_PREFIX}on-2.webp`]);
    expect(page.hasMore).toBe(false);
  });

  test("비활성 앨범의 사진은 anon 에게 0행이다 (0008 gallery_select_active)", async () => {
    const page = await getGalleryPage({ albumId: offId, limit: ALBUM_PAGE_SIZE }, anonClient);
    expect(page.items).toEqual([]);
  });

  test("표지 조회(limit 1)가 첫 사진 한 장만 가져온다 + 다음이 있다고 알려 준다", async () => {
    const page = await getGalleryPage({ albumId: onId, limit: 1 }, anonClient);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].imagePath).toBe(`${PATH_PREFIX}on-1.webp`);
    expect(page.hasMore).toBe(true);
    const cards = buildAlbumCards([album({ id: onId, slug: `${SLUG_PREFIX}-on` })], [page.items]);
    expect(cards[0].hasPhotos).toBe(true);
  });

  test("데이터 끝을 넘긴 page 는 빈 페이지지 오류가 아니다 (첫 페이지로 물러날 근거)", async () => {
    const far = await getGalleryPage(
      { albumId: onId, limit: ALBUM_PAGE_SIZE, offset: albumPageOffset(MAX_ALBUM_PAGE) },
      anonClient,
    );
    expect(far.items).toEqual([]);
    expect(far.hasMore).toBe(false);
  });
});
