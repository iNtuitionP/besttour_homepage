/**
 * P5-23 리뷰 P2-1 — 사진 고르기 한 번의 흐름(lib/admin/galleryPick.ts runGalleryPick).
 *
 * 고른 사진이 **전부 걸러지면**(형식·크기·장수) 업로더가 올리기 전에 돌아가서, 버튼 옆 "N장을 골랐어요" 가 실패 배너 옆에 그대로 남고
 * 입력칸도 비우지 않아 같은 파일을 다시 고르면 change 가 나지 않았다(리뷰 실측 — 0바이트 사진 1장 → "1장을 골랐어요" + "사진을 올리지 못했어요").
 * 흐름을 순수 모듈로 빼서 부품(GalleryUploader)은 포트만 잇고, 여기서 **어느 길로 끝나든** 되돌리기가 한 번 도는지 본다.
 * 포트는 호출 기록만 남기는 가짜다 — 흐름(순서 · finally)은 진짜다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { runGalleryPick, type GalleryPickFlow } from "@/lib/admin/galleryPick";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const codeOf = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), "utf-8"), rel);

/** 호출을 차례대로 적는 포트. uploads[i] = i 번째 장의 결과(true 올림 · false 실패 · "throw" 예외). */
function flow(accepted: number, rejected: number, uploads: (boolean | "throw")[] = [], opts: { prepareThrows?: boolean } = {}) {
  const log: string[] = [];
  const f: GalleryPickFlow = {
    accepted,
    rejected,
    prepare: () => {
      log.push("prepare");
      if (opts.prepareThrows) throw new Error("no client");
    },
    uploadOne: async (i) => {
      log.push(`upload ${i}`);
      const r = uploads[i];
      if (r === "throw") throw new Error("boom");
      return r === true;
    },
    onThrow: (i) => log.push(`onThrow ${i}`),
    setBusy: (b) => log.push(`busy ${b}`),
    resetPicker: () => log.push("reset"),
    finish: (ok, failed) => log.push(`finish ${ok}/${failed}`),
  };
  return { f, log };
}

describe("사진 고르기 흐름 — 어느 길로 끝나든 고른 장수 줄과 입력칸을 되돌린다", () => {
  test("🔴 전부 걸러짐(리뷰 P2-1) — 올리지 않고 곧바로 요약하되, 고른 장수 줄·입력칸은 되돌린다(잠그지도 않는다)", async () => {
    const { f, log } = flow(0, 2);
    await runGalleryPick(f);
    expect(log).toEqual(["reset", "finish 0/2"]);
  });

  test("올릴 것이 있으면 — 잠금 → 준비 → 한 장씩 → 잠금 풀기 → 되돌리기 → 요약(올라가지 못한 장 = 고른 장 − 올라간 장)", async () => {
    const { f, log } = flow(3, 1, [true, false, true]);
    await runGalleryPick(f);
    expect(log).toEqual(["busy true", "prepare", "upload 0", "upload 1", "upload 2", "busy false", "reset", "finish 2/2"]);
  });

  test("한 장이 던져도 그 장만 '확인 필요' · 나머지는 계속 · 잠금은 풀린다(리뷰 F1)", async () => {
    const { f, log } = flow(3, 0, [true, "throw", true]);
    await runGalleryPick(f);
    expect(log).toEqual(["busy true", "prepare", "upload 0", "upload 1", "onThrow 1", "upload 2", "busy false", "reset", "finish 2/1"]);
  });

  test("준비(브라우저 클라이언트)가 던지면 — 한 장도 올리지 않고 잠금 풀기·되돌리기·요약은 한다 · 예외는 위로(부품의 void onPick 이 받는다 — 예전과 같다)", async () => {
    const { f, log } = flow(2, 1, [true, true], { prepareThrows: true });
    await expect(runGalleryPick(f)).rejects.toThrow("no client");
    expect(log).toEqual(["busy true", "prepare", "busy false", "reset", "finish 0/3"]);
  });

  test("부품은 흐름을 쓴다 — 되돌리기 포트가 입력칸을 비우고 고른 장수를 0 으로 · 잠금 포트는 setBusy", () => {
    const src = codeOf("components/admin/GalleryUploader.tsx");
    expect(src).toMatch(/await runGalleryPick\(\{/);
    expect(src).toMatch(/resetPicker: \(\) => \{\s*if \(inputRef\.current\) inputRef\.current\.value = "";\s*setPicked\(0\);\s*\}/);
    expect(src).toMatch(/\bsetBusy,\s/);
    // 부품 안에 자기 finally 로 잠금·되돌리기를 다시 적지 않는다(흐름이 둘로 갈리지 않게)
    expect(src).not.toMatch(/finally\s*\{[\s\S]{0,200}setPicked\(0\)/);
  });
});
