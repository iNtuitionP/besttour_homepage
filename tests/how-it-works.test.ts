/**
 * 홈 '이용 방법' 4단계 — 로케일별 원장 문구 (P7-4 후속 ①, 2026-10-01).
 *
 *   - ko: 원장 GUIDE_SECTIONS.flow.steps 그대로 — 한국어 화면의 마크업은 이 후속 전과 **바이트까지 같다**(아래 KO_GOLDEN).
 *   - en: 원장 GUIDE_SECTIONS.flow.stepsEn(컨트롤러 작성 영문 · 독립 리뷰 서명) — 단계 목록에 lang="ko" 가 없다.
 *         한국어로 남는 두 줄(산정 기준 QUOTE_BASIS.line · 대금 지급 PAYMENT.line)에만 lang="ko", 공식 한국어 안내는 **그 두 줄 바로 위**
 *         (OfficialKoreanNotice 규약 — "영문 화면의 한국어 원장 블록 바로 위". 영문 단계 위에 두면 "아래 한국어가 정본" 이 영문을 가리킨다).
 *   - 영문 네 줄은 원장에만 있다 — 클라이언트 파일·카탈로그·다른 소스에 리터럴 0(원장 단일 출처 · CLAUDE.md §3).
 *
 * 서버 컴포넌트를 실제로 불러 렌더한다 — next-intl/server 만 가짜다(로케일은 테스트가 고르고, 문구는 실제 카탈로그).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ locale: "ko" as "ko" | "en" }));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { readFileSync: rf } = await import("node:fs");
  const p = await import("node:path");
  const load = (l: string) => JSON.parse(rf(p.resolve(import.meta.dirname, "..", "messages", `${l}.json`), "utf8"));
  const messages: Record<string, unknown> = { ko: load("ko"), en: load("en") };
  return {
    getLocale: vi.fn(async () => state.locale),
    getTranslations: vi.fn(async (opts?: { namespace?: string } | string) => {
      const namespace = typeof opts === "string" ? opts : opts?.namespace;
      return createTranslator({ locale: state.locale, messages: messages[state.locale] as never, namespace: namespace as never });
    }),
  };
});

import { HowItWorks } from "@/components/home/HowItWorks";
import { GUIDE_SECTIONS, PAYMENT, QUOTE_BASIS, VERBATIM } from "@/lib/legal/disclosures";

import { stripComments } from "./helpers/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

type Flow = Extract<(typeof GUIDE_SECTIONS)[number], { key: "flow" }>;
const flow = GUIDE_SECTIONS.find((s): s is Flow => s.key === "flow")!;

async function render(locale: "ko" | "en"): Promise<string> {
  state.locale = locale;
  return renderToStaticMarkup(await HowItWorks());
}
const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
/** 단계 목록 <ol data-testid="how-steps"> — 여는 태그와 안쪽 */
function stepList(html: string): { open: string; inner: string } {
  const m = /(<ol\b[^>]*data-testid="how-steps"[^>]*>)([\s\S]*?)<\/ol>/.exec(html);
  expect(m, "how-steps 목록이 없다").not.toBeNull();
  return { open: m![1], inner: m![2] };
}
const titles = (inner: string) => [...inner.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => decode(m[1]));

/**
 * 이 후속 전(P7-4 본 작업 끝)의 ko 렌더를 캡처해 그 모양 그대로 다시 짠 것 — 한국어 화면 마크업이 바뀌지 않았다는 증거.
 * 태그·속성·클래스·순서는 캡처 그대로 박고, 글자는 원장·카탈로그 값을 끼운다(원장 문구가 나중에 확정돼 바뀌어도 이 잠금이 거짓으로 깨지지 않게).
 * 캡처 원본(1,317자)은 보고서 후속 ①에 있다.
 */
const koMessages = JSON.parse(read("messages/ko.json")) as { home: { how: { eyebrow: string; title: string; desc: string } } };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
function koGolden(): string {
  const how = koMessages.home.how;
  const m = /^([\s\S]*)<ac>([\s\S]*)<\/ac>([\s\S]*)$/.exec(how.title);
  expect(m, "home.how.title 의 <ac> 강조").not.toBeNull();
  const title = `${esc(m![1])}<span class="_ac_4bcd29">${esc(m![2])}</span>${esc(m![3])}`;
  const steps = flow.steps
    .map((s, i) => `<li class="_step_ce5c51"><span class="_stepNo_ce5c51" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span><h3 class="_stepTitle_ce5c51">${esc(s)}</h3></li>`)
    .join("");
  return (
    `<section class="_section_4bcd29 _toneWhite_4bcd29" aria-labelledby="how-h" data-section="how"><div class="_wrap_4bcd29">` +
    `<div class="_head_4bcd29 _headSplit_4bcd29"><div><p class="_eyebrow_4bcd29">${esc(how.eyebrow)}</p><h2 class="_title_4bcd29" id="how-h">${title}</h2></div><p class="_desc_4bcd29">${esc(how.desc)}</p></div>` +
    `<ol class="_steps_ce5c51" data-testid="how-steps">${steps}</ol>` +
    `<div class="_stepsNotes_ce5c51" data-testid="how-notes"><p class="_stepsNote_ce5c51">${esc(VERBATIM.bookingNotice)}</p>` +
    `<p class="_stepsMeta_ce5c51">${esc(QUOTE_BASIS.line)}</p><p class="_stepsMeta_ce5c51">${esc(PAYMENT.line)}</p></div></div></section>`
  );
}

describe("홈 '이용 방법' — ko 는 원장 steps(무변경) · en 은 원장 stepsEn", () => {
  test("원장 — stepsEn 은 steps 와 같은 수(4)·같은 순서의 영문 · 한글 0 · 빈 줄 0", () => {
    expect(flow.steps).toHaveLength(4);
    expect(flow.stepsEn).toHaveLength(flow.steps.length);
    for (const s of flow.stepsEn) {
      expect(s.trim()).toBe(s);
      expect(s.length).toBeGreaterThan(0);
      expect(HANGUL.test(s), s).toBe(false);
    }
  });

  // 리뷰 P2-5: 계약금은 이용 절차 두 문장(ko·en)에 숫자로 따로 적혀 있다. 대금 지급의 원장 값(PAYMENT.depositKrw)이 바뀌면 함께 바뀌어야 한다.
  test("원장 — 이용 절차의 계약금(ko steps · en stepsEn)이 PAYMENT.depositKrw 와 같다", () => {
    const deposit = PAYMENT.depositKrw;
    expect(deposit % 10000, "만원 단위가 아니면 ko 표기 규칙부터 다시 정할 것").toBe(0);
    expect(flow.steps.filter((s) => s.includes(`계약금 ${deposit / 10000}만원`))).toHaveLength(1);
    expect(flow.stepsEn.filter((s) => s.includes(`KRW ${deposit.toLocaleString("en-US")} deposit`))).toHaveLength(1);
    // 다른 금액이 섞여 있지 않다(문장 안의 숫자는 계약금 하나)
    expect(flow.steps.join(" ").match(/\d[\d,]*/g)).toEqual([String(deposit / 10000)]);
    expect(flow.stepsEn.join(" ").match(/\d[\d,]*/g)).toEqual([deposit.toLocaleString("en-US")]);
  });

  test("en — 단계 4줄이 원장 stepsEn 과 바이트까지 같다 · 목록에 lang 없음 · 목록 안 한글 0", async () => {
    const html = await render("en");
    const { open, inner } = stepList(html);
    expect(open).not.toMatch(/\slang=/);
    expect(titles(inner)).toEqual([...flow.stepsEn]);
    expect(HANGUL.test(inner)).toBe(false);
  });

  test("en — 공식 한국어 안내는 하나 · 단계 목록 뒤, 한국어 두 줄(lang=ko · 산정 기준 · 대금 지급) 바로 앞", async () => {
    const html = await render("en");
    const notices = html.match(/data-legal="official-korean-notice"/g) ?? [];
    expect(notices).toHaveLength(1);
    const iList = html.indexOf("</ol>");
    const iNotice = html.indexOf('data-legal="official-korean-notice"');
    const iFirstKo = html.indexOf('lang="ko"');
    expect(iList).toBeGreaterThan(-1);
    expect(iNotice).toBeGreaterThan(iList);
    expect(iFirstKo).toBeGreaterThan(iNotice);
    const koLines = [...html.matchAll(/<p\b[^>]*lang="ko"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => decode(m[1]));
    expect(koLines).toEqual([QUOTE_BASIS.line, PAYMENT.line]);
  });

  test("ko — 마크업이 이 후속 전과 같다(KO_GOLDEN) · 단계는 원장 steps · lang 속성 0 · 공식 안내 0", async () => {
    const html = await render("ko");
    expect(html).toBe(koGolden());
    expect(titles(stepList(html).inner)).toEqual([...flow.steps]);
    expect(html).not.toMatch(/\slang=/);
    expect(html).not.toContain("official-korean-notice");
  });
});

// =============================================================================
// 영문 네 줄은 원장에만 — 리터럴 0
// =============================================================================
const SOURCE_DIRS = ["app", "components", "lib", "i18n"];
function walk(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const p = path.join(abs, name);
    const r = path.relative(ROOT, p).replace(/\\/g, "/");
    if (statSync(p).isDirectory()) out.push(...walk(r));
    else if (/\.(ts|tsx|js|mjs|json)$/.test(name)) out.push(r);
  }
  return out;
}

describe("영문 단계 문구는 원장 단일 출처", () => {
  const files = SOURCE_DIRS.flatMap(walk).filter((f) => f !== "lib/legal/disclosures.ts");
  const clientFiles = files.filter((f) => /\.tsx?$/.test(f) && /^\s*["']use client["']/.test(read(f)));

  test("클라이언트 파일('use client')에 영문 단계 리터럴 0", () => {
    expect(clientFiles.length).toBeGreaterThan(20); // 탐지가 비지 않았다
    for (const f of clientFiles) for (const s of flow.stepsEn) expect(read(f).includes(s), `${f}: ${s}`).toBe(false);
  });

  test("원장 밖 어떤 소스·카탈로그(messages/*.json)에도 영문 단계 리터럴 0", () => {
    for (const f of [...files, "messages/en.json", "messages/ko.json"]) for (const s of flow.stepsEn) expect(read(f).includes(s), `${f}: ${s}`).toBe(false);
  });

  test("HowItWorks 는 원장 flow.stepsEn · flow.steps 를 읽는다(문구 리터럴 0)", () => {
    const src = stripComments(read("components/home/HowItWorks.tsx"), "components/home/HowItWorks.tsx");
    expect(src).toMatch(/flow\.stepsEn/);
    expect(src).toMatch(/flow\.steps\b/);
  });
});
