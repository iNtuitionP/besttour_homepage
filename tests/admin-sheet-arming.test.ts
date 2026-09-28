/**
 * P5-22 수정 라운드(리뷰 반려 P0-1) — 확인 시트의 실행 버튼은 **열린 뒤 잠깐 누름을 받지 않는다** · 휴대폰에서는 [닫기]가 맨 아래다.
 *
 * 무엇을 막는가: 휴대폰(<1024px) 상세의 아래 고정 행동 바 [확정하기]를 두 번 누르면(더블탭 · 더블클릭) 첫 누름이 연 확정 시트의
 * [확정하고 문자 보내기]가 **같은 자리**에 떠서 두 번째 누름이 그대로 확정 + 고객 문자가 됐다(리뷰 실측 7폭 7/7 · 실제 제스처 3종 모두 1회).
 * 확인 시트가 되돌릴 수 없는 동작 앞의 유일한 장벽인데 확인을 받지 못한 채 통과됐다.
 *
 * 컨트롤러 결정 — 두 겹을 **모두** 둔다(방어 깊이):
 *   (a) 무장 지연 — 모든 시트(확정 · 취소 · 완료)의 실행 버튼은 열린 뒤 SHEET_ARM_MS(600ms) 동안 누름을 무시한다.
 *       그동안 aria-disabled + 흐린 모양 · 포인터·click·Enter·Space 모두 무시. 첫 포커스는 그대로 [닫기].
 *       판정은 **누름이 시작된 시각**으로 한다(pointerdown · Enter/Space keydown — 없으면 click 시각): 무장 전에 손가락을 댄 채
 *       무장 뒤에 떼는 누름도 무시한다.
 *   (b) 배치 — 1024px 미만에서 시트 버튼을 세로로 쌓는다: 실행 버튼이 위, [닫기]가 **맨 아래 전체 폭**. 행동 바 [확정하기] 자리에
 *       두 번째 누름이 떨어지면 [닫기]다(시트가 닫힐 뿐). 1024px 이상은 예전처럼 나란히(시안). 시안과 다른 점은 보고서에 적는다.
 *
 * vitest 는 node 환경이다(DOM 없음). 그래서 판정은 순수 함수로 단위 테스트하고, 컴포넌트가 그 판정을 **어떻게** 잇는지는 소스 정적 검사,
 * 첫 화면 마크업은 renderToStaticMarkup, 배치는 CSS 규칙으로 잠근다. 실제 제스처와 기하는 브라우저 실측(보고서 수정 라운드 절의 점검표).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AdminSheet, type AdminSheetProps } from "@/components/admin/AdminSheet";
import { SHEET_ARM_MS, armingGuard, eventTime, sheetArmed } from "@/components/admin/reservation-sheet";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const SHEET = "components/admin/AdminSheet.tsx";
const ADMIN_CSS = "components/admin/admin.module.css";

const attr = (tag: string, name: string): string | null => new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1] ?? null;
const openTag = (html: string, testid: string): string => {
  const m = new RegExp(`<[a-z]+[^>]*data-testid="${testid}"[^>]*>`).exec(html);
  expect(m, `${testid} 가 없다`).not.toBeNull();
  return m![0];
};

// =============================================================================
// 1. 순수 — 무장 판정
// =============================================================================
describe("1. 무장 판정 — 누름이 시작된 시각이 열린 뒤 SHEET_ARM_MS 가 지났을 때만", () => {
  test("🔴 SHEET_ARM_MS = 600 — 두 번 누름 간격(더블탭 150~300ms · 느린 두 번째 누름)보다 길고, 일부러 누르는 사람을 오래 붙잡지 않는다", () => {
    expect(SHEET_ARM_MS).toBe(600);
  });

  test("🔴 경계 — 599ms 는 아니고 600ms 는 된다 · 열리기 전에 시작된 누름은 아니다 · 숫자가 아니면 아니다(모르면 막는다)", () => {
    const opened = 10_000;
    expect(sheetArmed(opened, opened + 599)).toBe(false);
    expect(sheetArmed(opened, opened + 600)).toBe(true);
    expect(sheetArmed(opened, opened + 5_000)).toBe(true);
    expect(sheetArmed(opened, opened - 1)).toBe(false);
    expect(sheetArmed(opened, opened)).toBe(false);
    expect(sheetArmed(Number.NaN, opened + 1_000)).toBe(false);
    expect(sheetArmed(opened, Number.NaN)).toBe(false);
    expect(sheetArmed(opened, Number.POSITIVE_INFINITY)).toBe(false);
  });

  test("사건 시각 — event.timeStamp 가 performance.now() 와 같은 시계(최근 10초 안)면 그 값 · 아니면 지금(옛 브라우저의 epoch 밀리초 등)", () => {
    expect(eventTime(4_900, 5_000)).toBe(4_900);
    expect(eventTime(5_000, 5_000)).toBe(5_000);
    // epoch 밀리초(옛 Safari 의 DOMTimeStamp) — 지금 값으로 떨어진다(무장 판정이 "한참 뒤" 로 속지 않는다)
    expect(eventTime(1_790_000_000_000, 5_000)).toBe(5_000);
    // 미래 · 너무 오래전 · 숫자가 아님
    expect(eventTime(6_000, 5_000)).toBe(5_000);
    expect(eventTime(5_000 - 20_000, 5_000)).toBe(5_000);
    expect(eventTime(Number.NaN, 5_000)).toBe(5_000);
  });
});

describe("2. 무장 판정기 — 누름 시작을 기억했다가 click 에서 판정하고 지운다", () => {
  const OPENED = 1_000;

  test("🔴 더블탭 · 더블클릭 — 두 번째 누름이 열린 뒤 150ms·300ms 에 시작되면 무시", () => {
    for (const gap of [0, 150, 300, 599]) {
      const g = armingGuard(OPENED);
      g.press(OPENED + gap);
      expect(g.allow(OPENED + gap + 80), `${gap}ms`).toBe(false);
    }
  });

  test("🔴 무장 전에 손가락을 댄 채 무장 뒤에 떼도 무시 — 판정은 click 이 아니라 누름이 시작된 시각이다", () => {
    const g = armingGuard(OPENED);
    g.press(OPENED + 400);
    expect(g.allow(OPENED + 900)).toBe(false);
  });

  test("무장 뒤에 시작된 누름은 받는다 · 누름 기록이 없으면(보조기술의 click 등) click 시각으로 본다", () => {
    const g = armingGuard(OPENED);
    g.press(OPENED + 650);
    expect(g.allow(OPENED + 700)).toBe(true);
    const h = armingGuard(OPENED);
    expect(h.allow(OPENED + 100)).toBe(false);
    expect(h.allow(OPENED + 600)).toBe(true);
  });

  test("판정 뒤 기록을 지운다 — 막힌 누름 하나가 다음 누름을 계속 막지 않는다 · 새 누름은 새 시각을 적는다", () => {
    const g = armingGuard(OPENED);
    g.press(OPENED + 100);
    expect(g.allow(OPENED + 120)).toBe(false);
    expect(g.allow(OPENED + 800)).toBe(true); // 기록 없음 → click 시각
    g.press(OPENED + 200);
    g.press(OPENED + 900); // 새 제스처(새 pointerdown)
    expect(g.allow(OPENED + 950)).toBe(true);
  });
});

// =============================================================================
// 3. 컴포넌트 — 첫 화면 마크업 · 연결(정적)
// =============================================================================
function sheetProps(patch: Partial<AdminSheetProps> = {}): AdminSheetProps {
  return {
    name: "confirm",
    title: "제목",
    description: "본문",
    banner: null,
    closeLabel: "close",
    submitLabel: "submit",
    processingLabel: "processing",
    submitVariant: "primary",
    pending: false,
    slow: false,
    slowNote: "slow",
    submitDisabled: false,
    onClose: () => {},
    onSubmit: () => {},
    ...patch,
  };
}

describe("3. 시트 — 열린 첫 화면의 실행 버튼은 무장 전(aria-disabled) · [닫기]는 바로 쓴다", () => {
  test("🔴 확정·취소·완료 시트 모두 — 실행 버튼 aria-disabled=true · data-armed=false · disabled 아님(포커스를 잃지 않는다) · [닫기]는 무장과 무관", () => {
    for (const [name, variant] of [
      ["confirm", "primary"],
      ["cancel", "destructive"],
      ["complete", "primary"],
    ] as const) {
      const html = renderToStaticMarkup(createElement(AdminSheet, sheetProps({ name, submitVariant: variant })));
      const submit = openTag(html, "admin-sheet-submit");
      expect(attr(submit, "aria-disabled"), name).toBe("true");
      expect(attr(submit, "data-armed"), name).toBe("false");
      expect(submit, name).not.toMatch(/\sdisabled=""/);
      const close = openTag(html, "admin-sheet-close");
      expect(attr(close, "aria-disabled"), name).toBeNull();
      expect(close, name).not.toMatch(/\sdisabled=""/);
    }
  });

  test("처리 중 · 잠긴 시트는 예전처럼 disabled(P5-19 그대로) — 무장은 그 위에 덧댄 것이다", () => {
    const pending = openTag(renderToStaticMarkup(createElement(AdminSheet, sheetProps({ pending: true }))), "admin-sheet-submit");
    expect(pending).toMatch(/\sdisabled=""/);
    const locked = openTag(renderToStaticMarkup(createElement(AdminSheet, sheetProps({ submitDisabled: true }))), "admin-sheet-submit");
    expect(locked).toMatch(/\sdisabled=""/);
  });

  test("🔴 정적 — 열릴 때 판정기를 만들고(레이아웃 효과 · 열린 시각) · 누름 시작을 적고 · click 에서 판정이 통과해야만 onSubmit", () => {
    const src = codeOf(SHEET);
    // 열린 시각 — DOM 에 붙은 순간(레이아웃 효과)
    expect(src).toMatch(/useLayoutEffect\(\(\) => \{\s*armRef\.current = armingGuard\(performance\.now\(\)\);/);
    // 모양은 타이머가 되살린다(판정은 시각이 한다 — 타이머는 모양만)
    expect(src).toMatch(/window\.setTimeout\(\(\) => setArmed\(true\), SHEET_ARM_MS\)/);
    // 실행 버튼
    const submit = /<button[\s\S]*?data-testid="admin-sheet-submit"[\s\S]*?>/.exec(src)?.[0] ?? "";
    expect(submit).toMatch(/aria-disabled=\{armed \? undefined : "true"\}/);
    expect(submit).toMatch(/data-armed=\{armed \? "true" : "false"\}/);
    expect(submit).toMatch(/disabled=\{pending \|\| submitDisabled\}/);
    expect(submit).toMatch(/onPointerDown=\{onSubmitPointerDown\}/);
    expect(submit).toMatch(/onKeyDown=\{onSubmitKeyDown\}/);
    expect(submit).toMatch(/onClick=\{onSubmitClick\}/);
    expect(submit).not.toMatch(/onClick=\{onSubmit\}/);
    // click — 판정이 통과해야만 onSubmit. 판정 앞에서 onSubmit 을 부르는 길이 없다
    const click = /const onSubmitClick = \([^)]*\) => \{([\s\S]*?)\n {2}\};/.exec(src)?.[1] ?? "";
    expect(click).toMatch(/if \(!\(armRef\.current\?\.allow\(eventTime\(e\.timeStamp, performance\.now\(\)\)\) \?\? false\)\) \{\s*e\.preventDefault\(\);\s*return;\s*\}\s*onSubmit\(\);/);
    // 누름 시작 — 포인터 · Enter/Space(자동 반복은 막는다)
    const down = /const onSubmitPointerDown = \([^)]*\) => \{([\s\S]*?)\n {2}\};/.exec(src)?.[1] ?? "";
    expect(down).toMatch(/armRef\.current\?\.press\(eventTime\(e\.timeStamp, performance\.now\(\)\)\)/);
    const key = /const onSubmitKeyDown = \([^)]*\) => \{([\s\S]*?)\n {2}\};/.exec(src)?.[1] ?? "";
    expect(key).toMatch(/e\.key !== "Enter" && e\.key !== " "/);
    expect(key).toMatch(/if \(e\.repeat\) \{\s*e\.preventDefault\(\);\s*return;\s*\}/);
    expect(key).toMatch(/armRef\.current\?\.press\(eventTime\(e\.timeStamp, performance\.now\(\)\)\)/);
    // 첫 포커스는 그대로 [닫기](P5-19)
    expect(src).toMatch(/closeRef\.current\?\.focus\(\);/);
  });
});

// =============================================================================
// 4. 배치 — 1024px 미만: 실행 위 · [닫기] 맨 아래 전체 폭 / 1024px 이상: 나란히(시안)
// =============================================================================
function cssRules(css: string): { selector: string; body: string; media: string | null }[] {
  const out: { selector: string; body: string; media: string | null }[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const mediaRe = /@media([^{]+)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
  const medias: { start: number; end: number; query: string }[] = [];
  for (const m of stripped.matchAll(mediaRe)) medias.push({ start: m.index!, end: m.index! + m[0].length, query: m[1].trim() });
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (selector.startsWith("@")) continue;
    const pos = m.index!;
    const media = medias.find((x) => pos > x.start && pos < x.end)?.query ?? null;
    out.push({ selector: selector.replace(/^@media[^{]*/, "").trim(), body: m[2], media });
  }
  return out;
}
const decl = (body: string, prop: string): string | null => new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim() ?? null;
const DESKTOP = "(min-width: 1024px)";

describe("4. 배치 — 휴대폰 시트는 [닫기]가 맨 아래(두 번째 누름이 [닫기]에 떨어진다)", () => {
  const rules = cssRules(read(ADMIN_CSS));
  const body = (sel: string, media: string | null = null) =>
    rules
      .filter((r) => r.media === media && r.selector.split(",").map((x) => x.trim()).includes(sel))
      .map((r) => r.body)
      .join(";");

  test("🔴 1024px 미만 — 한 칸(세로로 쌓음) · 실행 버튼([data-variant])이 위(order -1) · 버튼 48px · [닫기]는 DOM 첫째라 맨 아래 전체 폭", () => {
    expect(decl(body(".sheetActions"), "grid-template-columns")).toBe("minmax(0, 1fr)");
    expect(decl(body(".sheetActions > [data-variant]"), "order")).toBe("-1");
    expect(decl(body(".sheetActions > button"), "min-height")).toBe("48px");
    // DOM 순서는 그대로 — [닫기]가 먼저(키보드 첫 포커스 · Tab 순서 · P5-19 테스트). 모양만 CSS 가 바꾼다
    const src = codeOf(SHEET);
    expect(src.indexOf('data-testid="admin-sheet-close"')).toBeLessThan(src.indexOf('data-testid="admin-sheet-submit"'));
    expect(src).toMatch(/data-variant=\{submitVariant\}/);
  });

  test("1024px 이상 — 예전처럼 나란히(왼쪽 [닫기] · 오른쪽 실행 · 시안) · 순서 되돌림", () => {
    expect(decl(body(".sheetActions", DESKTOP), "grid-template-columns")).toBe("minmax(0, 1fr) minmax(0, 1.6fr)");
    expect(decl(body(".sheetActions > [data-variant]", DESKTOP), "order")).toBe("0");
  });

  test("매뉴얼 — 확정·취소·완료 절이 휴대폰의 [닫기] 자리(맨 아래)와 무장 지연(0.6초)을 사장님 말로 적는다", () => {
    const manual = read("docs/ops/admin-manual.md");
    const section = manual.slice(manual.indexOf("### 확정 · 취소 · 완료"), manual.indexOf("### 상태는 앞으로만 갑니다"));
    expect(section).toContain("맨 아래");
    expect(section).toContain(`${SHEET_ARM_MS / 1000}초`);
  });

  test("매뉴얼 — 처리 결과 안내 절이 늦은 응답 안내(카탈로그 문구 그대로)와 알려진 한계(결과 전에는 이동이 넘어가지 않을 수 있다 · 새로고침)를 적는다(리뷰 P2-5)", () => {
    const ko = JSON.parse(read("messages/ko.json")) as { admin: { detail: { sheet: { slow: string } } } };
    const manual = read("docs/ops/admin-manual.md");
    const section = manual.slice(manual.indexOf("### 처리 결과 안내"), manual.indexOf("## 3. 손님 연락처 다루기"));
    expect(section).toContain(ko.admin.detail.sheet.slow);
    expect(section).toContain("넘어가지 않을 수 있습니다");
    expect(section).toContain("새로고침");
  });
});
