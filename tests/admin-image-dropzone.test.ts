/**
 * T3-2(사장님 요청 6 · 6.2 · 6.3 최소안) — 공통 사진 올리기 부품.
 *
 *   - lib/admin/imagePrepare.ts: GalleryUploader 의 "디코드 → 1600px WebP → 타입 확인" 과 스토리지 포트(upsert:false)를 옮겼다.
 *   - components/admin/ImageDropzone.tsx: 끌어다 놓기 + 파일 고르기 · 올리기 전 미리보기 · 장별 설명 칸 · 창 밖 드롭 막기.
 *   - GalleryUploader 는 그 부품을 쓰고, 장별 설명을 행에 넣는다(전에는 caption: null 고정).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { GALLERY_PUBLIC_LONG_EDGE, buildUploadPaths } from "@/lib/admin/galleryInput";
import { commitUpload, type GalleryStoragePort } from "@/lib/admin/galleryUpload";
import { PUBLIC_CACHE_CONTROL, WEBP_QUALITY, prepareImage, storagePort } from "@/lib/admin/imagePrepare";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);

const PREPARE = "lib/admin/imagePrepare.ts";
const DROPZONE = "components/admin/ImageDropzone.tsx";
const UPLOADER = "components/admin/GalleryUploader.tsx";

/** createImageBitmap · canvas 를 가짜로 — node 환경이라 DOM 이 없다 */
function stubDom(opts: { decode: "ok" | "throw"; blobType: string | null; width?: number; height?: number }) {
  const closed = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => {
      if (opts.decode === "throw") throw new Error("InvalidStateError");
      return { width: opts.width ?? 4000, height: opts.height ?? 3000, close: closed };
    }),
  );
  const toBlob = vi.fn((cb: (b: Blob | null) => void, type: string, q: number) => {
    expect(type).toBe("image/webp");
    expect(q).toBe(WEBP_QUALITY);
    cb(opts.blobType === null ? null : new Blob(["x"], { type: opts.blobType }));
  });
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob };
  vi.stubGlobal("document", { createElement: (tag: string) => (tag === "canvas" ? canvas : null) });
  return { closed, canvas };
}

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("T3-2 imagePrepare — 옮긴 규칙이 그대로다", () => {
  test("🔴 성공 — 긴 변 1600px WebP · 비트맵을 닫는다", async () => {
    const { closed, canvas } = stubDom({ decode: "ok", blobType: "image/webp" });
    const r = await prepareImage(file("a.jpg"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ext).toBe("jpg");
    expect(Math.max(r.width, r.height)).toBe(GALLERY_PUBLIC_LONG_EDGE);
    expect(canvas.width).toBe(r.width);
    expect(r.webp.type).toBe("image/webp");
    expect(closed).toHaveBeenCalledTimes(1);
  });

  test("🔴 WebP 를 못 만드는 브라우저(조용히 PNG) · null — encode 로 거부", async () => {
    stubDom({ decode: "ok", blobType: "image/png" });
    expect(await prepareImage(file("a.png"))).toEqual({ ok: false, reason: "encode" });
    stubDom({ decode: "ok", blobType: null });
    expect(await prepareImage(file("a.png"))).toEqual({ ok: false, reason: "encode" });
  });

  test("🔴 디코드 실패 — HEIC 는 heic(설정 안내), 그 밖은 decode · 확장자가 없으면 type", async () => {
    stubDom({ decode: "throw", blobType: "image/webp" });
    expect(await prepareImage(file("a.heic"))).toEqual({ ok: false, reason: "heic" });
    expect(await prepareImage(file("a.jpg"))).toEqual({ ok: false, reason: "decode" });
    expect(await prepareImage(file("noext"))).toEqual({ ok: false, reason: "type" });
  });

  test("🔴 스토리지 포트 — upsert:false 고정(덮어쓰지 않는다) · 호출자가 upsert 를 넘겨도 바뀌지 않는다", async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const remove = vi.fn(async () => ({ error: null }));
    const client = { storage: { from: vi.fn(() => ({ upload, remove })) } };
    const port = storagePort(client as never);
    await port.upload("gallery", "k.webp", new Blob(), { contentType: "image/webp", upsert: true } as never);
    expect(upload).toHaveBeenCalledWith("k.webp", expect.anything(), expect.objectContaining({ upsert: false }));
    await port.remove("gallery", "k.webp");
    expect(remove).toHaveBeenCalledWith(["k.webp"]);
    expect(codeOf(PREPARE)).toMatch(/\{ \.\.\.options, upsert: false \}/);
    expect(PUBLIC_CACHE_CONTROL).toBe("31536000");
  });
});

describe("T3-2 설명(caption) — 금지 표현이면 파일을 되돌리고 '설명' 이유로 알린다", () => {
  test("🔴 record 가 copyWarning → 두 파일 삭제 · reason caption", async () => {
    const removed: string[] = [];
    const storage: GalleryStoragePort = {
      upload: async () => ({ error: null }),
      remove: async (b, k) => {
        removed.push(`${b}/${k}`);
      },
    };
    const paths = buildUploadPaths("123e4567-e89b-42d3-a456-426614174000", "jpg", new Date("2026-10-10T00:00:00Z"));
    const outcome = await commitUpload({
      paths,
      original: new Blob(),
      publicBody: new Blob(),
      originalContentType: "image/jpeg",
      publicCacheControl: PUBLIC_CACHE_CONTROL,
      meta: { width: 1, height: 1, bytes: 1, albumId: null, caption: "설명", sort: 0, active: true },
      storage,
      record: async () => ({ ok: true, code: "copyWarning" }),
    });
    expect(outcome).toEqual({ kind: "failed", reason: "caption" });
    expect(removed.sort()).toEqual([paths.imagePath, paths.originalPath].sort());
  });
});

describe("T3-2 ImageDropzone — 끌어다 놓기 · 미리보기 · 장별 설명", () => {
  test("🔴 'use client' · 드롭 처리 · 창 밖 드롭 막기(window dragover/drop preventDefault) · 정리", () => {
    const raw = read(DROPZONE);
    expect(raw.split("\n")[0].trim()).toMatch(/^["']use client["'];?$/);
    const src = codeOf(DROPZONE);
    expect(src).toMatch(/onDrop=\{/);
    expect(src).toMatch(/onDragOver=\{/);
    expect(src).toMatch(/window\.addEventListener\("dragover", block\)/);
    expect(src).toMatch(/window\.addEventListener\("drop", block\)/);
    expect(src).toMatch(/window\.removeEventListener\("drop", block\)/);
    // 미리보기 — objectURL 을 만들고 반드시 되돌린다(메모리)
    expect(src).toMatch(/URL\.createObjectURL\(/);
    expect(src).toMatch(/URL\.revokeObjectURL\(/);
    // 진짜 파일 칸은 그대로(B-10 규칙) — 라벨로 이름 · 키보드 Enter 로 연다
    expect(src).toMatch(/type="file"/);
    expect(src).toMatch(/className=\{s\.fileInput\}/);
    expect(src).toMatch(/if \(e\.key === "Enter"\) \{\s*e\.preventDefault\(\);\s*e\.currentTarget\.click\(\);/);
    // 설명 칸 — 장마다 · 길이 상한
    expect(src).toMatch(/maxLength=\{captionMax\}/);
    // HTML 을 그리지 않는다
    expect(src).not.toMatch(/dangerouslySetInnerHTML/);
  });

  test("🔴 GalleryUploader — 부품과 준비 모듈을 쓰고, 장별 설명을 행에 넣는다(caption: null 고정이 사라졌다)", () => {
    const src = codeOf(UPLOADER);
    expect(src).toMatch(/<ImageDropzone\b/);
    expect(src).toMatch(/prepareImage\(/);
    expect(src).not.toMatch(/caption: null/);
    expect(src).toMatch(/caption: captionOf\(/);
    // 준비 코드가 두 벌이 되지 않는다
    expect(src).not.toMatch(/createImageBitmap|toBlob\(/);
    expect(codeOf(PREPARE)).toMatch(/createImageBitmap\(/);
    const ko = JSON.parse(read("messages/ko.json")) as { admin: { gallery: Record<string, unknown> } };
    const g = ko.admin.gallery;
    for (const k of ["dropHere", "captionLabel", "removePick", "startUpload"]) expect(g[k], k).toBeTruthy();
    expect((g.reject as Record<string, string>).caption).toMatch(/요\.$/);
  });
});
