/**
 * OF3-R2 (5 · 6 · 7) — 상시 팝업 · 사진만 팝업 · 여러 팝업 동시.
 * 근거: .superpowers/sdd/2026-09-06-bestour-implementation-v4/OF3-requirements.md R2 · OF3-R2-brief.md.
 *
 * 순수 규칙(lib/popup-display.ts) · 서버 검증(parsePopupForm) · 홈 쿼리(getActivePopups, 스텁 클라이언트) ·
 * 소스 규약(폼·홈 팝업·CSS·페이지). DB 는 부르지 않는다(원격 쓰기 없음 — 쿼리는 가짜 체인으로 확인한다).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POPUP_FIELDS, parsePopupForm } from "@/lib/admin/popupInput";
import { dismissKey, undismissedIds } from "@/components/home/popup-dismiss";
import { POPUP_ALWAYS_ENDS_AT, POPUP_HOME_LIMIT, isAlwaysEndsAt, isImageOnlyPopup, sortHomePopups } from "@/lib/popup-display";
import { getActivePopups, isActiveOn } from "@/lib/queries/popups";
import type { AnonClient } from "@/lib/supabase/anon";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const HANGUL = /[가-힣]/;

// =============================================================================
// 순수 규칙
// =============================================================================
describe("lib/popup-display — 상시 · 사진만 · 정렬", () => {
  test("🔴 상시 종료일은 9999-12-31 한 곳의 상수 · 홈 상한은 4", () => {
    expect(POPUP_ALWAYS_ENDS_AT).toBe("9999-12-31");
    expect(POPUP_HOME_LIMIT).toBe(4);
    expect(isAlwaysEndsAt("9999-12-31")).toBe(true);
    expect(isAlwaysEndsAt("2026-12-31")).toBe(false);
    // 상시 값은 노출 판정(isActiveOn)을 그대로 통과한다 — 별도 분기 없음
    expect(isActiveOn({ active: true, startsAt: "2026-10-01", endsAt: POPUP_ALWAYS_ENDS_AT }, "2030-01-01")).toBe(true);
  });

  test("🔴 사진만 판정 — 본문이 (공백 제외) 비어 있고 사진이 있을 때만", () => {
    expect(isImageOnlyPopup({ body: "", imagePath: "popups/a.webp" })).toBe(true);
    expect(isImageOnlyPopup({ body: "  \n ", imagePath: "popups/a.webp" })).toBe(true);
    expect(isImageOnlyPopup({ body: "안내", imagePath: "popups/a.webp" })).toBe(false);
    expect(isImageOnlyPopup({ body: "", imagePath: null })).toBe(false);
    expect(isImageOnlyPopup({ body: "", imagePath: "" })).toBe(false);
  });

  test("🔴 정렬 — 상시 맨 앞 → 시작일 최신 → id 최신 · 입력을 바꾸지 않는다", () => {
    const list = [
      { id: 1, startsAt: "2026-10-01", endsAt: "2026-12-31" },
      { id: 2, startsAt: "2026-10-05", endsAt: "2026-12-31" },
      { id: 3, startsAt: "2026-01-01", endsAt: POPUP_ALWAYS_ENDS_AT },
      { id: 4, startsAt: "2026-10-05", endsAt: "2026-11-30" },
      { id: 5, startsAt: "2026-02-01", endsAt: POPUP_ALWAYS_ENDS_AT },
    ];
    const before = JSON.stringify(list);
    expect(sortHomePopups(list).map((p) => p.id)).toEqual([5, 3, 4, 2, 1]);
    expect(JSON.stringify(list)).toBe(before);
  });
});

// =============================================================================
// 서버 검증 — 상시 · 사진만
// =============================================================================
function form(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    [POPUP_FIELDS.title]: "관리용 이름",
    [POPUP_FIELDS.body]: "본문",
    [POPUP_FIELDS.imagePath]: "popups/poster.webp",
    [POPUP_FIELDS.startsAt]: "2026-10-22",
    [POPUP_FIELDS.endsAt]: "2026-10-31",
    [POPUP_FIELDS.active]: "on",
    ...over,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

describe("parsePopupForm — 상시 게시", () => {
  test("🔴 always 체크 → 종료일은 9999-12-31 (보낸 종료일은 버린다 · 비어 있어도 통과)", () => {
    for (const ends of ["2026-10-31", "", "not-a-date"]) {
      const r = parsePopupForm(form({ [POPUP_FIELDS.always]: "on", [POPUP_FIELDS.endsAt]: ends }));
      expect(r.ok, `endsAt=${ends}`).toBe(true);
      if (r.ok) expect(r.value.endsAt).toBe("9999-12-31");
    }
  });

  test("always 체크가 없으면 종전대로 종료일이 필수 · 형식 검사", () => {
    expect(parsePopupForm(form({ [POPUP_FIELDS.endsAt]: "" })).ok).toBe(false);
    const r = parsePopupForm(form());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.endsAt).toBe("2026-10-31");
  });

  test("상시여도 시작일은 검증한다", () => {
    expect(parsePopupForm(form({ [POPUP_FIELDS.always]: "on", [POPUP_FIELDS.startsAt]: "2026-02-30" })).ok).toBe(false);
  });
});

describe("parsePopupForm — 사진만 보이기", () => {
  test("🔴 imageOnly + 사진 → 본문을 버리고 '' 로 저장", () => {
    const r = parsePopupForm(form({ [POPUP_FIELDS.imageOnly]: "on", [POPUP_FIELDS.body]: "이미 쓴 본문" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.body).toBe("");
      expect(r.value.imagePath).toBe("popups/poster.webp");
    }
  });

  test("🔴 imageOnly 인데 사진이 없으면 저장 불가 — 사진 칸을 표시한다", () => {
    const r = parsePopupForm(form({ [POPUP_FIELDS.imageOnly]: "on", [POPUP_FIELDS.imagePath]: "  " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.result.fieldErrors?.imagePath).toBe(true);
  });

  test("🔴 본문이 비어도 사진이 있으면 저장된다(zod 최소 길이 해제) · 본문도 사진도 없으면 거부", () => {
    const withPhoto = parsePopupForm(form({ [POPUP_FIELDS.body]: "" }));
    expect(withPhoto.ok).toBe(true);
    if (withPhoto.ok) expect(withPhoto.value.body).toBe("");
    const bare = parsePopupForm(form({ [POPUP_FIELDS.body]: "", [POPUP_FIELDS.imagePath]: "" }));
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.result.fieldErrors?.body).toBe(true);
  });

  test("본문 상한은 그대로(보이는 글자 500)", () => {
    expect(parsePopupForm(form({ [POPUP_FIELDS.body]: "가".repeat(501) })).ok).toBe(false);
  });
});

// =============================================================================
// getActivePopups — 스텁 클라이언트
// =============================================================================
interface StubRow {
  id: number;
  title: string;
  body: string;
  image_path: string | null;
  starts_at: string;
  ends_at: string;
  active: boolean;
  created_at: string;
}
const row = (id: number, starts: string, ends: string, over: Partial<StubRow> = {}): StubRow => ({
  id,
  title: `t${id}`,
  body: "b",
  image_path: null,
  starts_at: starts,
  ends_at: ends,
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

function stubClient(rows: StubRow[]): { client: AnonClient; calls: [string, unknown[]][] } {
  const calls: [string, unknown[]][] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "lte", "gte", "order", "limit"]) {
    chain[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return chain;
    };
  }
  chain.overrideTypes = () => Promise.resolve({ data: rows, error: null });
  return { client: chain as unknown as AnonClient, calls };
}

describe("getActivePopups", () => {
  const NOW = new Date("2026-10-22T03:00:00Z"); // KST 2026-10-22 12:00

  test("🔴 오늘 노출 중 전부 · 상시 먼저 → 시작일 최신 → id 최신 · 상한 4", async () => {
    const { client } = stubClient([
      row(1, "2026-10-01", "2026-12-31"),
      row(2, "2026-10-05", "2026-12-31"),
      row(3, "2026-01-01", POPUP_ALWAYS_ENDS_AT),
      row(4, "2026-10-05", "2026-11-30"),
      row(5, "2026-02-01", POPUP_ALWAYS_ENDS_AT),
      row(6, "2026-10-20", "2026-12-31"),
    ]);
    const popups = await getActivePopups({ client, now: NOW });
    expect(popups.map((p) => p.id)).toEqual([5, 3, 6, 4]);
    expect(popups).toHaveLength(POPUP_HOME_LIMIT);
  });

  test("DB 가 거른 뒤에도 최종 판정은 isActiveOn — 기간 밖·꺼진 행은 뺀다 · 없으면 빈 배열", async () => {
    const { client } = stubClient([row(1, "2026-11-01", "2026-12-31"), row(2, "2026-01-01", "2026-02-01"), row(3, "2026-01-01", "2026-12-31", { active: false })]);
    expect(await getActivePopups({ client, now: NOW })).toEqual([]);
  });

  test("🔴 상시 팝업이 상한에 잘리지 않는다 — DB 에서 4개로 먼저 자르지 않고 정렬 뒤 자른다", async () => {
    const rows = [1, 2, 3, 4, 5].map((i) => row(i, `2026-10-0${i}`, "2026-12-31"));
    rows.push(row(9, "2020-01-01", POPUP_ALWAYS_ENDS_AT));
    const { client, calls } = stubClient(rows);
    const popups = await getActivePopups({ client, now: NOW });
    expect(popups[0].id).toBe(9);
    const limit = calls.find(([m]) => m === "limit")?.[1][0] as number;
    expect(limit).toBeGreaterThan(POPUP_HOME_LIMIT);
  });

  test("Popup 형태로 매핑한다(camelCase)", async () => {
    const { client } = stubClient([row(7, "2026-10-01", "2026-12-31", { image_path: "popups/a.webp", body: "" })]);
    const [p] = await getActivePopups({ client, now: NOW });
    expect(p).toMatchObject({ id: 7, imagePath: "popups/a.webp", startsAt: "2026-10-01", endsAt: "2026-12-31", body: "" });
  });
});

// =============================================================================
// 오늘 하루 보지 않기 — 숨긴 창은 빼고 남은 것만
// =============================================================================
describe("undismissedIds", () => {
  const NOW = new Date("2026-10-22T03:00:00Z");
  test("🔴 오늘 숨긴 창은 빼고 순서는 유지 · 전부 숨기면 빈 배열(막도 없다)", () => {
    const hidden = new Set([dismissKey(2, NOW), dismissKey(4, NOW)]);
    expect(undismissedIds([1, 2, 3, 4], NOW, (k) => hidden.has(k))).toEqual([1, 3]);
    expect(undismissedIds([2, 4], NOW, (k) => hidden.has(k))).toEqual([]);
  });
  test("어제 키는 오늘 효력이 없다(키에 KST 날짜)", () => {
    const yesterday = new Date("2026-10-21T03:00:00Z");
    const hidden = new Set([dismissKey(1, yesterday)]);
    expect(undismissedIds([1], NOW, (k) => hidden.has(k))).toEqual([1]);
  });
});

// =============================================================================
// 소스 규약
// =============================================================================
describe("홈 — ko 에서만 팝업 · 여러 개", () => {
  const page = codeOf("app/[locale]/(site)/page.tsx");

  test("🔴 en 홈은 쿼리도 렌더도 없다 — ko 일 때만 getActivePopups", () => {
    expect(page).toMatch(/getActivePopups\(/);
    expect(page).not.toMatch(/getActivePopup\(/);
    expect(page).toMatch(/locale === "ko"/);
    expect(page).toMatch(/isKo \? getActivePopups\(\) : Promise\.resolve\(\[\]\)/);
    expect(page).toMatch(/<HomePopup popups=\{popups\} \/>/);
    expect(page).toMatch(/!isKo\s*\?\s*\[\]/);
  });

  test("HomePopup 은 여러 개를 받아 isImageOnlyPopup 으로 사진만 여부를 정해 내려 준다 · 비면 렌더 없음", () => {
    const src = codeOf("components/home/HomePopup.tsx");
    expect(src).toMatch(/popups\.length === 0\) return null/);
    expect(src).toMatch(/isImageOnlyPopup\(p\)/);
    expect(src).toMatch(/koLang\(locale\)/);
  });
});

describe("Popup(홈 여러 창) — 동작 규약", () => {
  const src = codeOf("components/home/Popup.tsx");

  test("🔴 창별 닫기 · 막/Esc 는 전부 · 오늘 하루 보지 않기는 창별", () => {
    expect(src).toMatch(/const closeOne = useCallback/);
    expect(src).toMatch(/const closeAll = useCallback/);
    // 창의 X·닫기 버튼은 그 창만
    expect(src).toMatch(/onClose=\{\(\) => closeOne\(id\)\}/);
    // 막 클릭·Esc 는 전부
    expect(src).toMatch(/if \(event\.target === event\.currentTarget\) closeAll\(\)/);
    expect(src).toMatch(/event\.key === "Escape"[\s\S]{0,80}closeAll\(\)/);
    // 체크는 창별(Set) — 닫을 때 그 창의 체크만 본다
    expect(src).toMatch(/hideRef\.current\.has\(id\)/);
    expect(src).toMatch(/undismissedIds\(/);
  });

  test("🔴 모달 접근성 — 창마다 dialog · aria-modal · 포커스 가둠은 막 전체(창 사이 Tab 이동) · 스크롤 잠금", () => {
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/aria-modal="true"/);
    expect(src).toMatch(/overlayRef\.current\?\.querySelectorAll/);
    expect(src).toMatch(/"Tab"/);
    expect(src).toMatch(/lockDocumentScroll\(\)/);
    expect(src).toMatch(/overlay\.contains\(document\.activeElement\)/);
    expect(src).not.toMatch(/dangerouslySetInnerHTML/);
  });

  test("🔴 사진만 창 — 제목·본문을 그리지 않고, 제목은 창 이름·사진 대체 글로만", () => {
    expect(src).toMatch(/imageOnly \? null : \(/);
    expect(src).toMatch(/aria-label=\{imageOnly \? popup\.title : undefined\}/);
    expect(src).toMatch(/alt=\{imageOnly \? popup\.title : ""\}/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
  });
});

describe("Popup.module.css — 여러 창 배치 · 사진 잘림 없음", () => {
  const css = stripComments(read("components/home/Popup.module.css"), "Popup.module.css");

  test("🔴 사진은 16:9 틀에 꽉 채우지 않는다 — cover·aspect-ratio 없음, contain + 최대 높이", () => {
    expect(css).not.toMatch(/object-fit:\s*cover/);
    expect(css).not.toMatch(/aspect-ratio/);
    expect(css).toMatch(/object-fit:\s*contain/);
    expect(css).toMatch(/\.phImg\s*\{[^}]*max-height:\s*min\(50dvh, 26rem\)/);
    expect(css).toMatch(/\.modalImageOnly \.phImg\s*\{[^}]*max-height:\s*calc\(100dvh - 8\.5rem\)/);
    expect(css).toMatch(/height:\s*auto/);
  });

  test("🔴 PC — 줄 단위로 나란히(row · wrap · 왼쪽 위부터), 휴대폰 — 세로로 쌓기(column)", () => {
    const base = /\.stack\s*\{[^}]*flex-direction:\s*column/;
    expect(css).toMatch(base);
    const desktop = css.slice(css.indexOf("@media (min-width: 1024px)"));
    expect(desktop).toMatch(/\.stack\s*\{[^}]*flex-direction:\s*row/);
    expect(desktop).toMatch(/flex-wrap:\s*wrap/);
    expect(desktop).toMatch(/justify-content:\s*flex-start/);
    expect(desktop).toMatch(/align-items:\s*flex-start/);
  });

  test("사진만 창은 좁게(360px) · 막(overlay)은 그대로 어둡게 · 창 사이 빈 곳 클릭은 막으로 통과", () => {
    expect(css).toMatch(/\.modalImageOnly\s*\{[^}]*max-width:\s*360px/);
    expect(css).toMatch(/\.overlay\s*\{[^}]*background:\s*var\(--overlay-medium\)/);
    expect(css).toMatch(/\.stack\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.modal\s*\{[^}]*pointer-events:\s*auto/);
  });
});

describe("관리자 팝업 폼 — 상시 · 사진만 · 관리용 이름", () => {
  const form = codeOf("components/admin/PopupForm.tsx");
  const ko = JSON.parse(read("messages/ko.json")) as { admin: { popups: Record<string, unknown> } };
  const popups = ko.admin.popups as { field: Record<string, string>; hint: Record<string, string>; alwaysValue: string; limitNote: string };

  test("🔴 라벨 — 제목 칸은 '관리용 이름' · 체크박스 두 개 · 안내 한 줄", () => {
    expect(popups.field.title).toBe("관리용 이름");
    expect(popups.field.always).toContain("상시");
    expect(popups.field.imageOnly).toBe("사진만 보이기");
    expect(popups.hint.imageOnlyDropsBody).toContain("본문");
    expect(popups.alwaysValue).toBe("상시 게시");
    expect(popups.limitNote).toContain("{max}");
  });

  test("🔴 상시 체크 → 종료일 칸을 그리지 않는다 · 사진만 체크 → 본문 칸 숨김 + 보낼 때 본문 ''", () => {
    expect(form).toMatch(/name=\{POPUP_FIELDS\.always\}/);
    expect(form).toMatch(/name=\{POPUP_FIELDS\.imageOnly\}/);
    expect(form).toMatch(/\{always \? null : \(/);
    expect(form).toMatch(/hidden=\{imageOnly\}/);
    expect(form).toMatch(/formData\.set\(POPUP_FIELDS\.body, ""\)/);
    // 사진 없이 사진만 → 서버를 부르기 전에 막는다
    expect(form).toMatch(/imageOnlyNeedsPhoto/);
  });

  test("🔴 두 화면(목록·수정)이 같은 초기 체크를 판정 함수에서 얻는다 · 목록은 '상시 게시' 와 상한 안내", () => {
    const edit = codeOf("app/admin/(protected)/popups/[id]/page.tsx");
    expect(edit).toMatch(/isAlwaysEndsAt\(row\.ends_at\)/);
    expect(edit).toMatch(/isImageOnlyPopup\(\{ body: row\.body, imagePath: row\.image_path \}\)/);
    expect(edit).toMatch(/endsAt: always \? "" : row\.ends_at/);
    expect(edit).toMatch(/<HomePopup\s+popups=\{\[/);
    const list = codeOf("app/admin/(protected)/popups/page.tsx");
    expect(list).toMatch(/isAlwaysEndsAt\(row\.ends_at\)/);
    expect(list).toMatch(/POPUP_HOME_LIMIT/);
    expect(list).toMatch(/limitNote/);
    expect(list).toMatch(/always: false, imageOnly: false/);
  });

  test("상수·판정은 한 곳 — 문자열 '9999-12-31' 은 lib/popup-display.ts 외 소스에 없다", () => {
    for (const rel of [
      "components/admin/PopupForm.tsx",
      "app/admin/(protected)/popups/page.tsx",
      "app/admin/(protected)/popups/[id]/page.tsx",
      "lib/queries/popups.ts",
      "lib/admin/popupInput.ts",
      "components/home/Popup.tsx",
      "components/home/HomePopup.tsx",
    ]) {
      expect(codeOf(rel), rel).not.toContain("9999-12-31");
    }
    expect(codeOf("lib/popup-display.ts")).toContain("9999-12-31");
  });

  test("en 에는 한글 0 (팝업 관련 키는 ko 관리자 전용 — en 은 home.popup 라벨만)", () => {
    const en = JSON.parse(read("messages/en.json")) as { home: { popup: Record<string, string> } };
    expect(JSON.stringify(en)).not.toMatch(HANGUL);
    expect(Object.keys(en.home.popup).sort()).toEqual(Object.keys((JSON.parse(read("messages/ko.json")) as { home: { popup: Record<string, string> } }).home.popup).sort());
  });
});
