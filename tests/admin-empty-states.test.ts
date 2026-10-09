/**
 * P5-20 수정 라운드 — 리뷰 P2-3: 빈 상태 문구가 **거짓이 되는 가장자리** 2곳.
 *
 *   1. 접수 목록 — 쪽 번호(cursor)가 끝을 넘으면 목록이 비는데, 예전에는 "아직 들어온 접수가 없어요."(전체) /
 *      "이 상태의 접수가 없어요."(걸러 본 상태)라고 했다. 바로 아래에는 "← 이전" 이 보인다. 2쪽의 새 접수를 확정하고 돌아와도 그렇다.
 *      → P5-20: "이 쪽에는 더 없어요." + [첫 쪽 보기]. P5-21: 목록이 "20건 더 보기"(늘 첫 줄부터 읽는다)가 되어 그 상황이 없어졌다 —
 *        빈 목록은 그 탭에 정말 한 건도 없다는 뜻이고, 문장은 두 종류(데이터 없음 · 걸러 본 결과 없음)다.
 *   2. 갤러리 — 앨범으로 거른 화면이 비면, 다른 앨범에 사진이 있어도 "아직 올린 사진이 없어요." 라고 했다.
 *      → "고른 앨범에 사진이 없어요." + [모든 사진 보기] · [사진 올리기]. 사진이 정말 하나도 없을 때만 "아직 올린 사진이 없어요."
 *
 * 화면은 서버 컴포넌트를 그대로 그리고(renderToStaticMarkup), 조회 함수만 가짜로 바꾼다. 문구는 진짜 messages/ko.json 이다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock("@/lib/auth/requireAdmin", () => ({ requireAdmin: vi.fn(async () => ({ userId: "test", email: "e" })) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/queries", () => ({ getVehicles: vi.fn(async () => []) }));
vi.mock("@/lib/admin/reservations", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/admin/reservations")>();
  return { ...mod, listReservations: vi.fn(), countReservationsByStatus: vi.fn(async () => ({ new: 0, confirmed: 0, done: 0, cancelled: 0 })) };
});
// P5-21 — 목록의 '20건 더 보기'(클라이언트)가 라우터를 쓴다.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) }));
vi.mock("@/lib/admin/gallery", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/admin/gallery")>();
  return { ...mod, listAdminAlbums: vi.fn(), listAdminPhotos: vi.fn(), galleryUsage: vi.fn() };
});
// 갤러리의 클라이언트 부품은 이 검사의 대상이 아니다(서버액션 모듈을 끌어오지 않게 바꿔치기)
vi.mock("@/components/admin/GalleryUploader", () => ({ GalleryUploader: () => null }));
vi.mock("@/components/admin/GalleryAlbums", () => ({ GalleryAlbums: () => null }));
vi.mock("@/components/admin/GalleryPhotoCard", () => ({ GalleryPhotoCard: () => createElement("li", { "data-testid": "card" }) }));
vi.mock("next-intl/server", async () => {
  const { createTranslator: ct } = await import("next-intl");
  const { readFileSync: rf } = await import("node:fs");
  const p = await import("node:path");
  const messages = JSON.parse(rf(p.resolve(import.meta.dirname, "..", "messages", "ko.json"), "utf8"));
  return {
    getTranslations: vi.fn(async (opts?: { namespace?: string } | string) => {
      const namespace = typeof opts === "string" ? opts : opts?.namespace;
      return ct({ locale: "ko", messages, namespace: namespace as never });
    }),
  };
});

import AdminGalleryPage from "@/app/admin/(protected)/gallery/page";
import AdminReservationsPage from "@/app/admin/(protected)/reservations/page";
import { galleryUsage, listAdminAlbums, listAdminPhotos, type AdminGalleryRow } from "@/lib/admin/gallery";
import { listReservations } from "@/lib/admin/reservations";

const ROOT = path.resolve(import.meta.dirname, "..");
const ko = JSON.parse(readFileSync(path.join(ROOT, "messages/ko.json"), "utf-8")) as { admin: Record<string, Record<string, unknown>> };
const res = ko.admin.reservations as Record<string, string>;
const gal = ko.admin.gallery as Record<string, string>;

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const links = (h: string) => [...h.matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ href: m[1].replace(/&amp;/g, "&"), text: text(m[2]) }));

async function renderReservations(params: Record<string, string>): Promise<string> {
  vi.mocked(listReservations).mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  return renderToStaticMarkup((await AdminReservationsPage({ searchParams: Promise.resolve(params) })) as ReactElement);
}

/**
 * P5-21 — 목록이 "20건 더 보기"(쪽 수 × 20 을 **첫 줄부터** 한 번에 읽는다)로 바뀌어, 리뷰 P2-3 이 짚은 "끝을 넘은 쪽" 자체가 없어졌다.
 * 뒤쪽 쪽 번호로 들어와도 목록은 첫 줄부터이므로, 비었다면 그 탭에 정말 한 건도 없는 것이다 — 그래서 문장이 거짓이 되지 않는다.
 * 빈 상태는 두 종류(브리프 §B): ① 데이터 없음(새 접수 탭 · 전체 탭) ② 걸러 본 결과 없음(확정·운행 완료·취소 탭) + [전체 보기].
 */
describe("1. 접수 목록 — 빈 상태 두 종류 · 뒤쪽 쪽 번호도 거짓 없는 문장", () => {
  test("옛 '쪽' 문장(이 쪽에는 더 없어요 · 첫 쪽 보기)은 카탈로그에서 빠졌다 — 그 상황이 더는 생기지 않는다", () => {
    expect(res.emptyPage).toBeUndefined();
    expect(res.firstPage).toBeUndefined();
  });

  test("🔴 기본(새 접수) 탭이 비었으면 '새 접수가 없어요…' + [전체 보기] — 뒤쪽 쪽 번호로 들어와도 같은 문장", async () => {
    const cases: Record<string, string>[] = [{}, { page: "3" }];
    for (const params of cases) {
      const html = await renderReservations(params);
      expect(text(html)).toContain(res.emptyNew);
      expect(links(html)).toContainEqual({ href: "/admin/reservations?status=all", text: res.clearFilter });
    }
  });

  test("🔴 전체 탭이 비었으면 '아직 들어온 접수가 없어요.' · 걸러 본 탭이 비었으면 '이 상태의 접수가 없어요.' + [전체 보기]", async () => {
    const all = await renderReservations({ status: "all", page: "2" });
    expect(text(all)).toContain(res.emptyAll);
    expect(text(all)).not.toContain(res.empty);
    const filtered = await renderReservations({ status: "cancelled" });
    expect(text(filtered)).toContain(res.empty);
    expect(links(filtered)).toContainEqual({ href: "/admin/reservations?status=all", text: res.clearFilter });
  });
});

const PHOTO: AdminGalleryRow = {
  id: 1,
  image_path: "gallery/2026/09/a-1600.webp",
  original_path: null,
  caption: null,
  sort: 0,
  active: true,
  album_id: 3,
  width: 1600,
  height: 1200,
  bytes: 1000,
  created_at: "2026-09-27T00:00:00.000Z",
};

async function renderGallery(params: Record<string, string>, opts: { photos: AdminGalleryRow[]; total: number }): Promise<string> {
  vi.mocked(listAdminAlbums).mockResolvedValue([
    { id: 3, slug: "bus-45", title: "45인승", description: null, sort: 0, active: true, created_at: "2026-09-27T00:00:00.000Z" },
    { id: 4, slug: "airport", title: "공항", description: null, sort: 1, active: true, created_at: "2026-09-27T00:00:00.000Z" },
  ]);
  vi.mocked(listAdminPhotos).mockResolvedValue(opts.photos);
  vi.mocked(galleryUsage).mockResolvedValue({ photos: opts.total, bytes: opts.total * 1000 });
  return renderToStaticMarkup((await AdminGalleryPage({ searchParams: Promise.resolve(params) })) as ReactElement);
}

describe("2. 갤러리 — 거른 앨범이 비었을 때", () => {
  beforeEach(() => vi.clearAllMocks());

  test("카탈로그 — '고른 앨범에 사진이 없어요.' · [모든 사진 보기]", () => {
    expect(gal.emptyFiltered).toBe("고른 앨범에 사진이 없어요.");
    expect(gal.clearFilter).toBe("모든 사진 보기");
  });

  test("🔴 앨범으로 걸렀고 비었는데 다른 앨범에 사진이 있다 → '고른 앨범에 사진이 없어요.' + [모든 사진 보기] + [사진 올리기] — '아직 올린 사진이 없어요' 가 아니다", async () => {
    const html = await renderGallery({ album: "4" }, { photos: [], total: 5 });
    expect(text(html)).toContain(gal.emptyFiltered);
    expect(text(html)).not.toContain(gal.empty);
    expect(links(html)).toContainEqual({ href: "/admin/gallery", text: gal.clearFilter });
    expect(links(html)).toContainEqual({ href: "#gallery-upload-input", text: gal.emptyAction });
  });

  test("🔴 미분류로 걸렀을 때도 같다(album=none)", async () => {
    const html = await renderGallery({ album: "none" }, { photos: [], total: 2 });
    expect(text(html)).toContain(gal.emptyFiltered);
    expect(text(html)).not.toContain(gal.empty);
  });

  test("사진이 정말 하나도 없으면 — 거른 화면이어도 '아직 올린 사진이 없어요.' + [사진 올리기]", async () => {
    const cases: Record<string, string>[] = [{}, { album: "3" }];
    for (const params of cases) {
      const html = await renderGallery(params, { photos: [], total: 0 });
      expect(text(html)).toContain(gal.empty);
      expect(text(html)).not.toContain(gal.emptyFiltered);
      expect(links(html)).toContainEqual({ href: "#gallery-upload-input", text: gal.emptyAction });
    }
  });

  test("사진이 있으면 빈 상태 문구가 없다", async () => {
    const html = await renderGallery({ album: "3" }, { photos: [PHOTO], total: 1 });
    expect(text(html)).not.toContain(gal.empty);
    expect(text(html)).not.toContain(gal.emptyFiltered);
    expect(html).toContain('data-testid="card"');
  });
});
