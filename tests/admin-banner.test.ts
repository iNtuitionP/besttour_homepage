/**
 * P5-20 수정 라운드 — 리뷰 P1-1: 휴대폰(<1024px)의 고정 탭 바가 **키보드 포커스**와 **새로 뜬 실패 배너**를 가리지 않는다.
 *
 * 리뷰 실측(수정 전): 375×812 에서 Tab 34번 중 7번 포커스가 탭 바 뒤로 완전히 숨었고, 탭 바 바로 위 버튼의 실패 배너는 0px 보였다.
 * 고친 방법 두 가지를 잠근다.
 *   1. 스크롤 여백 — 셸이 있는 문서(<html>)의 아래 scroll-padding 이 탭 바 높이(항목 + 위 테두리 1px) + 틈 + safe area 다.
 *      브라우저의 포커스 스크롤과 scrollIntoView 가 이 여백을 따른다(WCAG 2.2 SC 2.4.11). 1024px 이상(탭 바 없음)은 되돌린다.
 *   2. 실패 배너 부품 하나(components/admin/AdminBanner.tsx) — 나타날 때 한 번 `scrollIntoView({ block: "nearest" })`.
 *      가까운 쪽으로만 움직여서 이미 보이면 가만히 있고, 1 의 여백 덕에 탭 바 위에 멈춘다. 문구가 바뀌면 다시 나타난 것으로 본다(key).
 *   3. 배너를 그리는 곳은 **전부** 이 부품을 쓴다 — 파일 목록을 손으로 적지 않고 (protected) 화면에서 import 를 따라가며 찾는다.
 *
 * vitest 는 node 환경(DOM 패키지 없음)이다. 그래서 "나타날 때 스크롤한다" 는 React 가 마운트 때 부르는 ref 콜백을
 * 컴포넌트가 돌려준 요소에서 꺼내 가짜 요소로 직접 불러 확인한다(부품에 훅이 없어서 함수로 부를 수 있다).
 * 실제 화면의 위치는 브라우저 실측(보고서 수정 라운드)이 잰다.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { AdminBanner, revealBanner } from "@/components/admin/AdminBanner";
import s from "@/components/admin/admin.module.css";
import { CopyWarningPanel } from "@/components/admin/CopyWarningPanel";
import { bannerMessage, initialPanelState, panelReducer, type PanelState } from "@/components/admin/reservation-sheet";
import type { CopyWarning, CopyWarningLabels } from "@/lib/admin/copyWarning";
import { FAILED_RESULT } from "@/lib/admin/result";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const exists = (rel: string) => existsSync(path.join(ROOT, rel));
const codeOf = (rel: string) => stripComments(read(rel), rel);
const CSS = "components/admin/admin.module.css";
const BANNER = "components/admin/AdminBanner.tsx";

// =============================================================================
// 1. 스크롤 여백 — 탭 바 높이에서 유도
// =============================================================================
/** 주석을 걷은 CSS 의 `선택자 { 본문 }` 쌍(가장 안쪽 블록) — tests/admin-status-badge.test.ts 와 같은 방식. */
function cssRules(css: string): { selector: string; body: string; media: string | null }[] {
  const out: { selector: string; body: string; media: string | null }[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const mediaRe = /@media([^{]+)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
  const medias: { start: number; end: number; query: string }[] = [];
  for (const m of stripped.matchAll(mediaRe)) medias.push({ start: m.index!, end: m.index! + m[0].length, query: m[1].trim() });
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (selector.startsWith("@")) continue;
    const at = m.index!;
    const media = medias.find((x) => at > x.start && at < x.end)?.query ?? null;
    out.push({ selector: selector.replace(/^@media[^{]*/, "").trim(), body: m[2], media });
  }
  return out;
}
const decl = (body: string, prop: string): string | null => new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim() ?? null;

describe("1. 스크롤 여백 — 포커스·배너가 탭 바 뒤로 가지 않는다", () => {
  const rules = cssRules(read(CSS));
  const DESKTOP = "(min-width: 1024px)";
  const body = (selector: string, media: string | null = null) =>
    rules
      .filter((r) => r.media === media && r.selector.split(",").map((x) => x.replace(/\s+/g, " ").trim()).includes(selector))
      .map((r) => r.body)
      .join(";");

  /** 탭 바의 실제 높이 = 항목 min-height + 위 테두리 두께(리뷰: 여백 56 대 바 57 이면 1px 이 겹친다). */
  const itemPx = Number(/^(\d+)px$/.exec(decl(body(".tabItem"), "min-height") ?? "")?.[1]);
  const borderPx = Number(/^(\d+)px\b/.exec(decl(body(".tabbar"), "border-top") ?? "")?.[1]);

  test("탭 바 높이의 재료를 CSS 에서 읽는다(항목 56px · 위 테두리 1px) — 숫자를 여기 적지 않는다", () => {
    expect(itemPx).toBeGreaterThan(0);
    expect(borderPx).toBeGreaterThan(0);
  });

  test("🔴 셸이 있는 문서의 <html> 아래 scroll-padding = 항목 높이 + 테두리 + 틈 + safe area (관리자 셸에만 — :has(.shell))", () => {
    const value = decl(body(":global(html):has(.shell)"), "scroll-padding-bottom");
    expect(value, "셸 문서에 아래 스크롤 여백이 없다").not.toBeNull();
    expect(value).toContain(`${itemPx}px`);
    expect(value).toContain(`${borderPx}px`);
    expect(value).toContain("env(safe-area-inset-bottom)");
    // 틈 — 포커스 링(2px + 2px)이 탭 바 테두리에 걸치지 않게 간격 토큰 하나를 더 둔다
    expect(value).toMatch(/var\(--space-[\w-]+\)/);
  });

  test("1024px 이상(탭 바 없음)에서는 여백을 되돌린다 · 본문 끝 여백(tabbarSpacer)도 같은 높이다 — 마지막 줄도 탭 바 위로 올라온다", () => {
    expect(decl(body(":global(html):has(.shell)", DESKTOP), "scroll-padding-bottom")).toBe("auto");
    expect(decl(body(".tabbarSpacer"), "height")).toBe(decl(body(":global(html):has(.shell)"), "scroll-padding-bottom"));
  });
});

// =============================================================================
// 2. 배너 부품 — 나타날 때 한 번, 가까운 쪽으로 스크롤
// =============================================================================
describe("2. AdminBanner", () => {
  test("revealBanner — scrollIntoView({ block: 'nearest', inline: 'nearest' }) 한 번 · 요소가 없으면(null — 떼어질 때) 아무것도 하지 않는다", () => {
    const el = { scrollIntoView: vi.fn() };
    revealBanner(el as unknown as HTMLElement);
    expect(el.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    expect(() => revealBanner(null)).not.toThrow();
  });

  test("🔴 나타날 때 스크롤한다 — 돌려준 요소의 ref 가 revealBanner 이고, React 가 마운트 때 부르면 가까운 쪽으로 움직인다", () => {
    const el = AdminBanner({ text: "처리하지 못했어요." }) as ReactElement<{ ref?: unknown; role?: string; children?: unknown }>;
    expect(el).not.toBeNull();
    expect(el.type).toBe("p");
    expect(el.props.role).toBe("alert");
    expect(el.props.ref).toBe(revealBanner);
    const fake = { scrollIntoView: vi.fn() };
    (el.props.ref as (node: unknown) => void)(fake);
    expect(fake.scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });

  test("문구가 바뀌면 새로 나타난 것이다(key = 문구 → 다시 마운트 → 다시 스크롤) · 빈 문구·null 이면 아무것도 그리지 않는다", () => {
    expect((AdminBanner({ text: "가" }) as ReactElement).key).toBe("가");
    expect((AdminBanner({ text: "나" }) as ReactElement).key).toBe("나");
    expect(AdminBanner({ text: "" })).toBeNull();
    expect(AdminBanner({ text: null })).toBeNull();
  });

  test("마크업 — <p role=alert> · 기본은 블록 배너, inline 은 줄 안 배너 · data-testid 그대로", () => {
    const block = renderToStaticMarkup(createElement(AdminBanner, { text: "실패", testId: "t-1" }));
    expect(block).toBe(`<p class="${s.banner}" role="alert" data-testid="t-1">실패</p>`);
    const inline = renderToStaticMarkup(createElement(AdminBanner, { text: "실패", variant: "inline" }));
    expect(inline).toBe(`<p class="${s.bannerInline}" role="alert">실패</p>`);
  });

  test("부품 자체 — 'use client' · 훅 없음(함수로 불러도 된다) · 한글 리터럴 0", () => {
    const src = codeOf(BANNER);
    expect(src.split("\n")[0].trim()).toMatch(/^["']use client["'];?$/);
    expect(src).not.toMatch(/\buse(State|Effect|LayoutEffect|Ref|Memo|Callback)\(/);
    expect(src.split("\n").filter((l) => /[가-힯]/.test(l))).toEqual([]);
  });
});

// =============================================================================
// 3. 배너를 그리는 곳은 전부 이 부품 — (protected) 화면에서 import 를 따라가며 찾는다
// =============================================================================
/** 디렉터리 아래 파일 전부(상대 경로 · 슬래시). */
function walk(rel: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, rel))) {
    const child = `${rel}/${name}`;
    if (statSync(path.join(ROOT, child)).isDirectory()) out.push(...walk(child));
    else out.push(child);
  }
  return out;
}

/** 파일이 불러오는 관리자 부품(components/admin/*) — `@/components/admin/X` 와 components/admin 안의 `./X`. */
function adminImportsOf(rel: string): string[] {
  const out: string[] = [];
  for (const m of codeOf(rel).matchAll(/from\s+"([^"]+)"/g)) {
    const spec = m[1];
    let base: string | null = null;
    if (spec.startsWith("@/components/admin/")) base = spec.slice(2);
    else if (spec.startsWith("./") && rel.startsWith("components/admin/")) base = path.posix.join(path.posix.dirname(rel), spec);
    if (base === null || base.endsWith(".css")) continue;
    for (const ext of [".tsx", ".ts"]) if (exists(base + ext)) out.push(base + ext);
  }
  return out;
}

/** 관리자 셸 안에서 그려지는 파일 전부 — (protected) 아래 .tsx 에서 시작해 관리자 부품 import 를 끝까지 따라간다. */
function shellFiles(): string[] {
  const seen = new Set<string>();
  const queue = walk("app/admin/(protected)").filter((f) => f.endsWith(".tsx"));
  while (queue.length > 0) {
    const f = queue.shift()!;
    if (seen.has(f)) continue;
    seen.add(f);
    queue.push(...adminImportsOf(f));
  }
  return [...seen].filter((f) => f.endsWith(".tsx")).sort();
}

describe("3. 배너를 그리는 곳 — 전부 AdminBanner (목록은 import 를 따라가 유도한다)", () => {
  const files = shellFiles();

  test("유도가 살아 있다 — 셸 안 파일에 레이아웃·메뉴·예약 처리·공지 폼이 들어온다", () => {
    for (const must of [
      "app/admin/(protected)/layout.tsx",
      "components/admin/AdminTabs.tsx",
      "components/admin/ReservationActions.tsx",
      "components/admin/NoticeForm.tsx",
    ])
      expect(files, must).toContain(must);
    expect(files).not.toContain("components/admin/AdminLoginForm.tsx"); // 로그인 화면은 셸(탭 바) 밖
  });

  /**
   * JSX 태그 경계를 정규식으로 자르지 않는다(속성 안의 `=>` 가 `>` 로 읽힌다). 대신 **개수**로 본다 — 한 파일에서 role="alert" 를
   * 직접 쓴 자리 수가 ref={revealBanner} 를 단 자리 수보다 많으면, 스스로 보이는 자리로 오지 않는 알림이 있는 것이다.
   */
  test("🔴 role=\"alert\" 를 직접 쓰는 곳은 부품 자신뿐 — 다른 곳(글 경고 패널)은 나타날 때 스크롤하는 revealBanner 를 함께 단다", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f === BANNER) continue;
      const src = codeOf(f);
      const alerts = (src.match(/\brole="alert"/g) ?? []).length;
      const reveals = (src.match(/\bref=\{revealBanner\}/g) ?? []).length;
      if (alerts > reveals) offenders.push(`${f}: role=alert ${alerts} · revealBanner ${reveals}`);
    }
    expect(offenders, "배너를 직접 그렸다 — AdminBanner 를 쓰거나 ref={revealBanner} 를 단다").toEqual([]);
    // 패널(여러 줄 · 버튼이 든 알림)은 부품이 아니라 같은 reveal 을 단다 — 그 한 곳이 실제로 있다
    expect(codeOf("components/admin/CopyWarningPanel.tsx")).toMatch(/ref=\{revealBanner\}/);
  });

  test("🔴 결과·실패를 다루는 파일(feedbackKind · …banner 상태 · banner 속성)은 AdminBanner 를 그린다", () => {
    const needs = files.filter((f) => {
      if (f === BANNER) return false;
      const src = codeOf(f).replace(/\b(AdminBanner|revealBanner)\b/g, "");
      return /\bfeedbackKind\(/.test(src) || /\b\w*[bB]anner\b/.test(src);
    });
    const missing = needs.filter((f) => !/<AdminBanner\b/.test(codeOf(f)));
    expect(missing).toEqual([]);
    // 리뷰가 짚은 10곳(공지·팝업·노선 폼과 전환 · 갤러리 앨범 · 사진 카드 · 예약 메모)이 모두 들어와야 유도가 맞다
    expect(needs.length).toBeGreaterThanOrEqual(10);
  });
});

// =============================================================================
// 4. 같은 실패가 두 번이면 두 번 보인다 (재리뷰 P2-R1)
// =============================================================================
/**
 * 재리뷰 P2-R1: 부품은 **나타날 때** 한 번 스크롤한다(ref 콜백). 그런데 배너를 지우지 않은 채 같은 문구가 다시 서면 React 가 같은 요소로
 * 보고 다시 붙이지 않는다 — 사장님이 배너를 탭 바 밑으로 밀어 둔 채 같은 실패를 한 번 더 겪으면 배너가 돌아오지 않았다.
 * 그런 자리는 두 곳이었다: 예약 메모(P5-19 상태 기계는 저장을 시작할 때 배너를 비우지 않는다)와 글 경고 패널(제출 사이에 경고를 들고 있다).
 * 고친 방법: **시도 번호**(`attempt`)를 key 에 붙인다 — 실패가 날 때마다 번호가 늘어 요소가 새로 붙고, 그때 다시 스크롤한다.
 *
 * vitest 에는 DOM 이 없어 React 의 재조정을 돌릴 수 없다. 그래서 React 의 규칙 그대로를 적은 작은 모델로 센다:
 * 같은 자리의 요소가 없다가 생기거나 key·type 이 바뀌면 새로 붙고, 붙을 때 ref 가 불린다(React 가 요소를 다시 쓰는 기준이 key·type 이다).
 */
function revealsOver(frames: ReadonlyArray<ReactElement | null>): number {
  let reveals = 0;
  let prev: ReactElement | null = null;
  for (const el of frames) {
    if (el !== null && (prev === null || prev.key !== el.key || prev.type !== el.type)) {
      const fake = { scrollIntoView: vi.fn() };
      ((el.props as { ref: (node: unknown) => void }).ref)(fake);
      reveals += fake.scrollIntoView.mock.calls.length;
    }
    prev = el;
  }
  return reveals;
}

const ko = JSON.parse(read("messages/ko.json")) as { admin: { detail: { result: Record<string, string>; sheet: Record<string, string> } } };
const BANNER_LABELS = {
  results: ko.admin.detail.result,
  memoTooLong: ko.admin.detail.sheet.memoTooLong,
  memoTooLongWithReason: ko.admin.detail.sheet.memoTooLongWithReason,
} as unknown as Parameters<typeof bannerMessage>[1];
/** ReservationActions 가 메모 배너를 그리는 것과 같은 모양. */
const memoFrame = (st: PanelState) =>
  AdminBanner({ text: st.memoBanner === null ? null : bannerMessage(st.memoBanner, BANNER_LABELS), attempt: st.memoBannerSeq, testId: "admin-memo-banner" }) as ReactElement | null;
/** 시트 안 배너(AdminSheet 에 bannerAttempt 로 넘긴다). */
const sheetFrame = (st: PanelState) =>
  AdminBanner({ text: st.sheetBanner === null ? null : bannerMessage(st.sheetBanner, BANNER_LABELS), attempt: st.sheetBannerSeq }) as ReactElement | null;
const failMemo = (st: PanelState) => panelReducer(st, { type: "settled", source: "memo", action: "memo", stored: "x", result: FAILED_RESULT });

describe("4. 같은 실패가 두 번이면 두 번 보인다 (재리뷰 P2-R1)", () => {
  test("모델 확인 — 지웠다 다시 서면(비움 → 문구) 두 번, 문구가 같고 key 가 그대로면 한 번(고치기 전의 결함 모양)", () => {
    const a = AdminBanner({ text: "실패" }) as ReactElement;
    expect(revealsOver([a, AdminBanner({ text: "" }), AdminBanner({ text: "실패" })])).toBe(2);
    expect(revealsOver([a, a, AdminBanner({ text: "실패" })])).toBe(1);
  });

  test("🔴 예약 메모 — 같은 실패 두 번(저장 시작에 배너를 비우지 않는 상태 기계) → 두 번 스크롤 · 시도 번호가 는다", () => {
    const s0 = panelReducer(initialPanelState("메모"), { type: "editMemo", text: "고친 메모" });
    const s1 = failMemo(s0);
    const s2 = failMemo(s1); // 다시 눌렀다 — 같은 실패, 같은 문구
    expect(bannerMessage(s1.memoBanner!, BANNER_LABELS)).toBe(bannerMessage(s2.memoBanner!, BANNER_LABELS));
    expect(s2.memoBannerSeq).toBe(s1.memoBannerSeq + 1);
    // 다시 누르는 동안(요청 중)에는 상태가 그대로라 같은 요소 — 그 사이에 스크롤하지 않는다
    expect(revealsOver([memoFrame(s0), memoFrame(s1), memoFrame(s1), memoFrame(s2)])).toBe(2);
  });

  test("🔴 예약 메모 — 상한 초과(누르자마자 막힘)도 두 번이면 두 번 · 배너와 무관한 다시 그리기(토스트 걷힘)는 스크롤하지 않는다", () => {
    const block = (st: PanelState) => panelReducer(st, { type: "blocked", source: "memo", count: 2100, max: 2000, withReason: false });
    const s1 = block(initialPanelState(""));
    const s2 = block(s1);
    expect(revealsOver([memoFrame(s1), memoFrame(s2)])).toBe(2);
    const idle = panelReducer(s2, { type: "toastDone", id: 999 });
    expect(revealsOver([memoFrame(s2), memoFrame(idle)])).toBe(1);
  });

  test("🔴 시트 안 배너 — 열린 시트에서 같은 실패 두 번이면 두 번 · 메모 배너의 번호는 그대로(뒤의 메모 배너가 끌려 스크롤하지 않는다)", () => {
    const opened = panelReducer(initialPanelState(""), { type: "open", sheet: "confirm", customerName: "예시" });
    const fail = (x: PanelState) => panelReducer(x, { type: "settled", source: "sheet", seq: x.sheetSeq, action: "confirm", stored: null, result: FAILED_RESULT });
    const s1 = fail(opened);
    const s2 = fail(s1);
    expect(revealsOver([sheetFrame(opened), sheetFrame(s1), sheetFrame(s2)])).toBe(2);
    expect(s2.memoBannerSeq).toBe(opened.memoBannerSeq);
  });

  // 걸린 표현 글자는 아무 말이어도 된다 — 이 검사는 key 만 본다(tests/ 도 금지어 게이트 대상이라 실제 금지어를 쓰지 않는다)
  const WARN: CopyWarning[] = [{ key: "title:0123456789abcdef:0123456789abcdef", field: "title", kind: "license", text: "예시 표현" }];
  const WARN_LABELS: CopyWarningLabels = {
    title: "t",
    lead: "l",
    confirm: "c",
    item: "{field} {text} {reason}",
    field: { title: "제목", body: "본문", caption: "설명", albumTitle: "앨범 이름" },
    kind: { license: "r", rival: "r", internal: "r", unproven: "r", comparative: "r" } as CopyWarningLabels["kind"],
  };
  const panel = (attempt: number) => CopyWarningPanel({ warnings: WARN, labels: WARN_LABELS, pending: false, idPrefix: "t", attempt }) as ReactElement;

  test("🔴 글 경고 패널 — 같은 경고가 두 번 오면(제출 사이에 경고를 들고 있어도) 두 번 스크롤 · ref 는 같은 revealBanner", () => {
    expect((panel(1).props as { ref: unknown }).ref).toBe(revealBanner);
    expect(panel(1).key).not.toBe(panel(2).key);
    expect(revealsOver([panel(1), panel(1), panel(2)])).toBe(2);
  });

  /** 배선 — 시도 번호를 실제로 넘기는지. 자리는 셸 파일에서 유도한다(글 경고 패널을 그리는 곳 전부). */
  test("🔴 배선 — 글 경고 패널을 그리는 곳은 전부 시도 번호(attempt)를 넘기고 경고마다 번호를 올린다 · 메모·시트·업로더도 넘긴다", () => {
    const files = shellFiles().filter((f) => f !== "components/admin/CopyWarningPanel.tsx");
    const panels = files.filter((f) => /<CopyWarningPanel\b/.test(codeOf(f)));
    expect(panels.length).toBeGreaterThanOrEqual(4); // 공지 · 팝업 · 사진 카드 · 앨범
    for (const f of panels) {
      const src = codeOf(f);
      const tags = src.match(/<CopyWarningPanel\b[\s\S]*?\/>/g) ?? [];
      for (const tag of tags) expect(tag, f).toMatch(/\battempt=\{/);
      expect(src, f).toMatch(/set\w*Round\(\(\w+\)\s*=>\s*\w+\s*\+\s*1\)/);
    }
    const actions = codeOf("components/admin/ReservationActions.tsx");
    expect(actions).toMatch(/<AdminBanner\b[^>]*attempt=\{state\.memoBannerSeq\}/);
    expect(actions).toMatch(/bannerAttempt=\{state\.sheetBannerSeq\}/);
    expect(codeOf("components/admin/AdminSheet.tsx")).toMatch(/<AdminBanner\b[^>]*attempt=\{bannerAttempt\}/);
    expect(codeOf("components/admin/GalleryUploader.tsx")).toMatch(/<AdminBanner\b[^>]*attempt=\{failureRound\}/);
  });

  /**
   * 나머지 배너 자리는 동작을 시작할 때 배너를 비운다(`setBanner("")` → 요청 → 문구 = 비움과 문구가 다른 렌더라 다시 붙는다).
   * 시도 번호도 비우기도 없는 자리가 새로 생기면 여기서 걸린다.
   */
  test("🔴 AdminBanner 를 그리는 곳은 전부 — 시도 번호를 넘기거나, 동작 시작에 배너를 비운다", () => {
    const offenders: string[] = [];
    for (const f of shellFiles()) {
      if (f === BANNER) continue;
      const src = codeOf(f);
      for (const tag of src.match(/<AdminBanner\b[\s\S]*?\/>/g) ?? []) {
        if (/\battempt=\{/.test(tag)) continue;
        if (/\bsetBanner\(""\)/.test(src)) continue;
        offenders.push(`${f}: ${tag.replace(/\s+/g, " ").slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
