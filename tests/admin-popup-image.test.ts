/**
 * T3-3(결정 9 · 사장님 요청 6.2 · known-defects D6) — 팝업 사진은 "갤러리에서 고르기 + 새로 올리기".
 *
 *   - 경로를 적는 글자 칸이 없어졌다. 화면이 숨은 칸(name=imagePath)에 경로를 넣는다.
 *   - 새로 올린 사진은 gallery 버킷의 `popups/` 접두어에 공개본(1600px WebP)만 올린다 — 갤러리 행을 만들지 않는다(갤러리에 뜨지 않게).
 *   - **옛 파일은 자동으로 지우지 않는다**(갤러리가 같은 파일을 쓸 수 있다 — 고아 파일 허용).
 *   - 갤러리 사진을 지울 때 팝업 참조를 본다 — tests/admin-gallery.test.ts §5.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { GALLERY_BUCKET } from "@/lib/admin/galleryInput";
import { POPUP_IMAGE_PATH_MAX, isPopupImagePath } from "@/lib/admin/popupInput";
import { buildPopupImagePath } from "@/lib/admin/popupImage";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);

const PICKER = "components/admin/PopupImagePicker.tsx";
const FORM = "components/admin/PopupForm.tsx";
const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("T3-3 새로 올린 팝업 사진의 경로", () => {
  test("🔴 gallery 버킷 · popups/yyyy/mm/<uuid>-1600.webp(KST 달) · 팝업 입력 규칙을 통과", () => {
    const p = buildPopupImagePath(UUID, new Date("2026-10-31T16:00:00Z")); // KST 11월 1일
    expect(p.bucket).toBe(GALLERY_BUCKET);
    expect(p.key).toBe(`popups/2026/11/${UUID}-1600.webp`);
    expect(p.imagePath).toBe(`${GALLERY_BUCKET}/popups/2026/11/${UUID}-1600.webp`);
    expect(isPopupImagePath(p.imagePath)).toBe(true);
    expect(p.imagePath.length).toBeLessThanOrEqual(POPUP_IMAGE_PATH_MAX);
    expect(() => buildPopupImagePath("not-a-uuid", new Date())).toThrow();
  });
});

describe("T3-3 팝업 폼 — 고르기 + 올리기", () => {
  test("🔴 경로 글자 칸이 없다 · 숨은 칸이 경로를 보낸다 · 고르기 부품을 쓴다", () => {
    const form = codeOf(FORM);
    expect(form).toMatch(/<PopupImagePicker\b/);
    expect(form, "경로를 손으로 적는 칸").not.toMatch(/id="popup-image"[\s\S]{0,120}type="text"/);
    const src = codeOf(PICKER);
    expect(read(PICKER).split("\n")[0].trim()).toMatch(/^["']use client["'];?$/);
    expect(src).toMatch(/<input type="hidden" name=\{POPUP_FIELDS\.imagePath\} value=\{path\}/);
    expect(src).toMatch(/<ImageDropzone\b/);
    expect(src).toMatch(/captionMax=\{null\}/);
    expect(src).toMatch(/multiple=\{false\}/);
    expect(src).toMatch(/prepareImage\(/);
    expect(src).toMatch(/storagePort\(createBrowserSupabase\(\)\)/);
    expect(src).toMatch(/buildPopupImagePath\(crypto\.randomUUID\(\), new Date\(\)\)/);
  });

  test("🔴 옛 파일을 지우지 않는다 — 고르기 부품 어디에도 삭제 호출이 없다 · 갤러리 행도 만들지 않는다", () => {
    const src = codeOf(PICKER);
    expect(src).not.toMatch(/\.remove\(/);
    expect(src).not.toMatch(/removePhotoObjects|deleteGalleryPhoto/);
    expect(src).not.toMatch(/recordGalleryUpload|commitUpload/);
    expect(src).not.toMatch(/dangerouslySetInnerHTML/);
  });

  test("🔴 갤러리에서 고르기 — 화면이 사진 목록(경로·설명)을 받아 버튼으로 보여 주고, 고른 것은 aria-pressed", () => {
    const src = codeOf(PICKER);
    expect(src).toMatch(/photos\.map\(/);
    expect(src).toMatch(/aria-pressed=\{path === photo\.imagePath\}/);
    for (const page of ["app/admin/(protected)/popups/page.tsx", "app/admin/(protected)/popups/[id]/page.tsx"]) {
      const code = codeOf(page);
      expect(code, page).toMatch(/getPopupGalleryPhotos\(\)/);
      expect(code, page).toMatch(/galleryPhotos=\{galleryPhotos\}/);
      expect(code, page).toMatch(/image: imageLabels/);
    }
    expect(codeOf("components/admin/popupImageLabels.ts")).toMatch(/listAdminPhotos\(/);
    const ko = JSON.parse(read("messages/ko.json")) as { admin: { popups: { image: Record<string, string> } } };
    for (const k of ["fromGallery", "upload", "none", "clear", "galleryEmpty", "uploading", "uploadFailed", "current"]) {
      expect(ko.admin.popups.image[k], k).toBeTruthy();
    }
  });
});
