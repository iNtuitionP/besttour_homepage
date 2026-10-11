/**
 * 갤러리 게시판 (OWNER-FEEDBACK T4-2 · 결정 8-② · 마이그레이션 0025) — 소스 규약.
 * DB 거동은 기존 파일이 갤러리 잠금 안에서 본다: 글 쓰기·고치기·slug 유지(admin-gallery §8) · 삭제 시 사진 비공개(album-delete-visibility §4 ·
 * gallery-albums §8) · 함수 ACL(write-privileges §20 · db-privilege-gate). 0025 자기검증이 anon 공개 칸을 정확히 대조한다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const code = (rel: string) => stripComments(read(rel), path.basename(rel));

describe("1. 0025 마이그레이션", () => {
  const mig = read("supabase/migrations/0025_gallery_posts.sql");

  test("공개해도 되는 칸 둘만 더한다(body · published_at) — 자기검증이 anon 공개 칸을 정확히 대조한다", () => {
    const added = [...mig.matchAll(/add column if not exists (\w+)/g)].map((m) => m[1]);
    expect(added).toEqual(["body", "published_at"]);
    expect(mig).toMatch(/expected constant text\[\] := array\['active', 'body', 'created_at', 'description', 'id', 'published_at', 'slug', 'sort', 'title'\]/);
    expect(mig).toMatch(/has_any_column_privilege\('anon'/);
    expect(mig).toMatch(/default \(now\(\) at time zone 'Asia\/Seoul'\)::date/);
  });

  test("drop + create 와 같은 트랜잭션에서 revoke(public·anon·service_role) + grant(authenticated)", () => {
    expect(mig).toContain("drop function if exists admin_create_album(text, text, integer, boolean);");
    expect(mig).toContain("drop function if exists admin_update_album(integer, text, text, integer, boolean);");
    for (const sig of ["admin_create_album(text, text, date, boolean)", "admin_update_album(integer, text, text, date, boolean)"]) {
      expect(mig).toContain(`revoke all on function ${sig} from public, anon, service_role;`);
      expect(mig).toContain(`grant execute on function ${sig} to authenticated;`);
    }
    expect(mig).toContain("revoke all on function gallery_album_delete_keep_visibility() from public, anon, authenticated, service_role;");
    expect(mig).not.toMatch(/^begin;|^commit;/m);
  });

  test("새 글의 slug 는 DB 가 짓고, 고치기는 slug 를 받지도 쓰지도 않는다 (공개 주소 유지 · 위험 31)", () => {
    const update = mig.slice(mig.indexOf("create or replace function admin_update_album"), mig.indexOf("revoke all on function admin_create_album"));
    expect(update).not.toMatch(/p_slug/);
    expect(update).not.toMatch(/set[^;]*\bslug\s*=/);
    expect(mig).toMatch(/v_slug := 'a-' \|\| substr\(md5\(gen_random_uuid\(\)::text\), 1, 8\);/);
  });

  test("0015 개정 — 트리거에 when 절이 없고 함수는 활성 여부와 상관없이 사진을 내린다(행은 지우지 않는다)", () => {
    const trg = mig.slice(mig.indexOf("create trigger gallery_albums_keep_visibility_on_delete"));
    expect(trg.slice(0, trg.indexOf(";"))).not.toMatch(/\bwhen\b/i);
    const fn = mig.slice(mig.indexOf("create or replace function gallery_album_delete_keep_visibility"), mig.indexOf("drop trigger if exists"));
    expect(fn).not.toMatch(/if old\.active then/);
    expect(fn).toMatch(/update gallery set active = false where album_id = old\.id and active;/);
    expect(fn).not.toMatch(/delete from gallery/);
  });

  test("롤백 — 옛 서명을 되살리며 revoke/grant 를 다시 적고, 0015 트리거로 되돌린 뒤 칸을 지운다(코드 먼저 되돌림)", () => {
    const down = read("supabase/rollbacks/0025_gallery_posts.down.sql");
    expect(down).toMatch(/코드를 먼저/);
    expect(down).toContain("revoke all on function admin_create_album(text, text, integer, boolean) from public, anon, service_role;");
    expect(down).toContain("grant execute on function admin_update_album(integer, text, text, integer, boolean) to authenticated;");
    expect(down).toContain("when (not old.active)");
    expect(down).toContain("drop column if exists body;");
    expect(down).toContain("drop column if exists published_at;");
  });
});

describe("2. 관리자 화면", () => {
  test("글 쓰기·고치기 화면은 첫 문장 requireAdmin · 주소 입력란이 없다", () => {
    for (const rel of ["app/admin/(protected)/gallery/posts/new/page.tsx", "app/admin/(protected)/gallery/posts/[id]/page.tsx"]) {
      expect(code(rel), rel).toMatch(/export default async function \w+\([^)]*\)[^{]*\{\s*await requireAdmin\(\);/);
    }
    for (const rel of ["components/admin/AlbumPostForm.tsx", "components/admin/GalleryAlbums.tsx"]) {
      expect(code(rel), rel).not.toMatch(/name="slug"|albumSlug|ALBUM_SLUG_MAX/);
    }
    expect(code("components/admin/AlbumPostForm.tsx")).toMatch(/<RichTextEditor\b/);
    expect(code("components/admin/AlbumPostForm.tsx")).toMatch(/<CopyWarningPanel\b/);
  });

  test("lib — 쓰기는 slug 를 보내지 않는다 · 목록은 게시일 최신순", () => {
    const lib = code("lib/admin/gallery.ts");
    const writes = lib.slice(lib.indexOf("export async function insertAlbum"), lib.indexOf("export async function setAlbumActive"));
    expect(writes).not.toMatch(/p_slug|p_sort/);
    expect(lib).toMatch(/\.order\("published_at", \{ ascending: false \}\)/);
  });
});

describe("3. 공개 화면", () => {
  test("상세는 날짜 · 본문(RichText — HTML 아님) · 확대 보기 · 목록 카드는 날짜·요약", () => {
    const detail = code("app/[locale]/(site)/gallery/[album]/page.tsx");
    expect(detail).toMatch(/<RichText text=\{album\.body\}/);
    expect(detail).toMatch(/<GalleryLightbox\b/);
    expect(detail).not.toMatch(/dangerouslySetInnerHTML/);
    expect(code("components/pages/AlbumCards.tsx")).toMatch(/formatPostDate\(a\.publishedAt, locale\)/);
  });

  test("확대 보기 — 대화상자 · Esc · 좌우 화살표 · 스크롤 잠금은 lib/scroll-lock · 문구는 props", () => {
    const lb = code("components/home/GalleryLightbox.tsx");
    expect(lb).toMatch(/role="dialog"/);
    expect(lb).toMatch(/aria-modal="true"/);
    expect(lb).toMatch(/"Escape"/);
    expect(lb).toMatch(/"ArrowLeft"/);
    expect(lb).toMatch(/lockDocumentScroll\(\)/);
    expect(lb).not.toMatch(/[가-힣]/);
    for (const loc of ["ko", "en"]) {
      const m = JSON.parse(read(`messages/${loc}.json`)) as { pages: { gallery: { detail: { lightbox: Record<string, string> } } } };
      expect(Object.keys(m.pages.gallery.detail.lightbox).sort(), loc).toEqual(["close", "label", "next", "open", "position", "prev"]);
    }
  });
});
