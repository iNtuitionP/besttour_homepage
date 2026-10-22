/**
 * OF3-R2 (4 · E) — 관리자 대표 노선·차량 소개: 순서 바꾸기와 편집을 **목록 하나**로.
 * 근거: .superpowers/sdd/2026-09-06-bestour-implementation-v4/OF3-requirements.md R2-4 · OF3-datepicker-plan.md §8 OF3-E.
 *
 * 이 저장소는 화면 소스 규약을 파일 대조로 잠그는 방식이다(vitest 가 node 환경이라 DOM 이 없다) — 같은 방식으로 구조를 잠그고,
 * SortableList 는 실제로 렌더해(renderToStaticMarkup) 줄 끝 슬롯·단일 줄·막대 숨김을 확인한다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { SortableList, type SortableListLabels } from "@/components/admin/SortableList";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");
const codeOf = (rel: string) => stripComments(read(rel), rel);

const ROUTES = "app/admin/(protected)/routes/page.tsx";
const FLEET = "app/admin/(protected)/fleet/page.tsx";

const LABELS: SortableListLabels = {
  save: "SAVE",
  reset: "RESET",
  processing: "…",
  up: "{name} up",
  down: "{name} down",
  handle: "{name} handle",
  moved: "{name} {pos}",
  picked: "{name} picked",
  canceled: "canceled",
  instructions: "how",
  locked: "LOCKED-NOTE",
};

const render = (items: Parameters<typeof SortableList>[0]["items"]) =>
  renderToStaticMarkup(createElement(SortableList, { items, labels: LABELS, onSave: async () => true, testId: "list" }));

describe("두 화면 — 목록이 하나다", () => {
  test.each([
    [ROUTES, "route-order-title", "admin-routes-table"],
    [FLEET, "fleet-order-title", "admin-fleet-table"],
  ])("🔴 %s — 따로 있던 «순서 바꾸기» 섹션 제목(%s)도 옛 표(%s)도 없다", (rel, orderTitle, table) => {
    const src = codeOf(rel);
    expect(src).not.toContain(orderTitle);
    expect(src).not.toContain(table);
    expect(src).not.toMatch(/<table\b/);
    expect(src).not.toMatch(/t\("order\.title"\)/);
  });

  test("🔴 노선 — 각 줄에 [수정] 링크 · 노출 토글 · 상태 · 가격(없으면 '금액 없음') · 노선 이름", () => {
    const src = codeOf(ROUTES);
    expect(src).toMatch(/<RouteOrder\b/);
    expect(src).toMatch(/<RouteToggle\b/);
    expect(src).toMatch(/t\("editLink"\)/);
    expect(src).toMatch(/formatPriceKrw\(row\.price_from\)/);
    expect(src).toMatch(/amount === "" \? t\("noPrice"\) : amount/);
    expect(src).toMatch(/status: \{ text: row\.active \? t\("state\.live"\) : t\("state\.off"\), live: row\.active \}/);
    expect(src).toMatch(/end: \(/);
    expect(src).toMatch(/locked: t\("order\.locked"\)/);
    // 한 목록이라 RouteOrder 호출은 한 번
    expect(src.match(/<RouteOrder\b/g)).toHaveLength(1);
  });

  test("🔴 차량 — 각 줄에 이름 · 정원 · 상태 · [고치기] · 숨기기 토글 · 사진", () => {
    const src = codeOf(FLEET);
    expect(src).toMatch(/<VehicleOrder\b/);
    expect(src).toMatch(/<VehicleToggle\b/);
    expect(src).toMatch(/t\("editLink"\)/);
    expect(src).toMatch(/meta: t\("seatValue", \{ n: row\.capacity \}\)/);
    expect(src).toMatch(/thumb:/);
    expect(src).toMatch(/locked: t\("order\.locked"\)/);
    expect(src.match(/<VehicleOrder\b/g)).toHaveLength(1);
  });

  test("게이트·가격 고지는 그대로 — 첫 문장 requireAdmin · verbatim 원장", () => {
    for (const rel of [ROUTES, FLEET]) {
      expect(codeOf(rel), rel).toMatch(/export default async function \w+\([^)]*\)[^{]*\{\s*await requireAdmin\(\);/);
    }
    expect(codeOf(ROUTES)).toMatch(/\{VERBATIM\.showcaseNotice\}/);
  });

  test("🔴 저장 액션은 그대로 재사용 — 새 액션·DB 변경 없음", () => {
    expect(codeOf("components/admin/RouteOrder.tsx")).toMatch(/reorderRoutes\(ids\)/);
    expect(codeOf("components/admin/VehicleControls.tsx")).toMatch(/reorderVehicles\(ids\)/);
  });

  test("카탈로그 — order.locked 문구 · 쓰지 않는 표 머리글·순서 제목 키는 지웠다", () => {
    const ko = JSON.parse(read("messages/ko.json")) as { admin: { routes: Record<string, unknown>; fleet: Record<string, unknown> } };
    for (const ns of [ko.admin.routes, ko.admin.fleet]) {
      const order = ns.order as Record<string, string>;
      expect(order.locked).toBe("순서를 먼저 저장하거나 되돌려 주세요.");
      expect(order.title).toBeUndefined();
      expect(ns.col).toBeUndefined();
    }
  });
});

describe("SortableList — 줄 끝 슬롯 · 단일 줄 · 막대", () => {
  const two = [
    { id: 1, label: "서울 → 부산", meta: "30만원", status: { text: "노출 중", live: true }, end: createElement("a", { href: "/edit/1", "data-x": "end-1" }, "수정") },
    { id: 2, label: "서울 → 대구", meta: "금액 없음", status: { text: "중지", live: false }, end: createElement("a", { href: "/edit/2", "data-x": "end-2" }, "수정") },
  ];

  test("🔴 각 줄 = 손잡이 · ↑↓ · 이름 · 보조 정보 · 상태 · 줄 끝 슬롯", () => {
    const html = render(two);
    expect(html.match(/data-testid="admin-sort-row"/g)).toHaveLength(2);
    expect(html).toContain("서울 → 부산");
    expect(html).toContain("30만원");
    expect(html).toContain("노출 중");
    expect(html).toContain('data-x="end-1"');
    expect(html).toContain('data-x="end-2"');
    expect(html.match(/aria-label="[^"]* handle"/g)).toHaveLength(2);
    expect(html.match(/aria-label="[^"]* up"/g)).toHaveLength(2);
    expect(html.match(/aria-label="[^"]* down"/g)).toHaveLength(2);
  });

  test("🔴 순서가 바뀌지 않았으면 «순서 저장 / 되돌리기» 막대가 없다 · 줄 끝 슬롯은 잠기지 않는다", () => {
    const html = render(two);
    expect(html).not.toContain("admin-sort-bar");
    expect(html).not.toContain("LOCKED-NOTE");
    expect(html).not.toContain("data-locked");
    expect(html).not.toMatch(/\binert\b/);
  });

  test("🔴 항목이 하나뿐이면 손잡이·↑↓ 를 그리지 않는다(줄 끝 슬롯은 그대로)", () => {
    const html = render([two[0]]);
    expect(html).toContain('data-x="end-1"');
    expect(html).not.toMatch(/handle"/);
    expect(html).not.toMatch(/aria-label="[^"]* (up|down)"/);
  });

  test("🔴 소스 규약 — 바뀐 동안만 막대 · 줄 끝 슬롯 inert 잠금 + 이유 문구 · 기존 접근성(aria-live · 키보드 센서) 유지", () => {
    const src = codeOf("components/admin/SortableList.tsx");
    expect(src).toMatch(/\{dirty \? \(\s*<div className=\{s\.sortBar\}/);
    expect(src).toMatch(/\{labels\.locked\}/);
    expect(src).toMatch(/inert=\{locked\}/);
    expect(src).toMatch(/locked=\{dirty \|\| saving\}/);
    expect(src).toMatch(/aria-live="polite"/);
    expect(src).toMatch(/useSensor\(KeyboardSensor/);
    // 막대는 목록(DndContext)보다 위에 있다
    expect(src.indexOf("admin-sort-bar")).toBeLessThan(src.indexOf("<DndContext"));
  });

  test("🔴 375px — 줄은 두 단으로 접히고(flex-wrap · 좁은 폭에서 아래 단이 한 줄 전체) 가로 스크롤을 만들지 않는다", () => {
    const css = stripComments(read("components/admin/admin.module.css"), "admin.module.css");
    expect(css).toMatch(/\.sortRow\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/@media \(max-width: 639\.98px\)\s*\{\s*\.sortSide\s*\{[^}]*flex:\s*1 1 100%/);
    expect(css).toMatch(/\.sortMain\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.sortText\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.sortLabel\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.sortEnd\[data-locked="true"\]/);
    expect(css).toMatch(/\.field\[hidden\]\s*\{[^}]*display:\s*none/);
  });
});
