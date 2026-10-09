/**
 * 손님이 보는 표면에 "사장님"(영문 "owner")이 없다 — P7-7 (사용자 지시 2026-10-09).
 *
 * "예약할 때 사장님한테 … 이런 사장님이라는 말 다 빼야 해. 실제 홈페이지에서 사장님이 … 이런 얘기를 하면 안 되잖아."
 * 범위 = 손님이 보는 것 전부: 공개 카탈로그(ko·en — `admin.*` 제외) · 원장 verbatim · 손님에게 가는 문자·알림톡 ·
 * 공개 페이지·컴포넌트의 렌더되는 리터럴. 관리자 화면과 사장님에게 가는 알림은 범위 밖이다(사장님 본인이 보는 곳).
 *
 * 영문은 같은 기준으로 "owner" 를 쓰지 않는다(대소문자 무시) — "we" 로 말한다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { ledgerUi } from "@/lib/i18n/ledger-ui";
import * as ledger from "@/lib/legal/disclosures";
import { VERBATIM } from "@/lib/legal/disclosures";
import { TEMPLATE_KEYS } from "@/lib/notify/outbox";
import { ALIMTALK_TEMPLATES, renderTemplate, renderVariants, type CustomerVars } from "@/lib/notify/templates";
import { stripComments } from "./helpers/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const OWNER_KO = "사장님";
const OWNER_EN = /owner/i;

/** 문자열 잎 전부 — [점 경로, 값]. 배열은 [i] 로 적는다. */
function leaves(node: unknown, prefix = ""): [string, string][] {
  if (typeof node === "string") return [[prefix, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${prefix}[${i}]`));
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix === "" ? k : `${prefix}.${k}`));
  }
  return [];
}

/** 관리자 네임스페이스를 뺀 잎 — 손님이 볼 수 있는 카탈로그 범위. */
function publicLeaves(catalog: Record<string, unknown>): [string, string][] {
  return leaves(Object.fromEntries(Object.entries(catalog).filter(([ns]) => ns !== "admin")));
}

const ko = JSON.parse(read("messages/ko.json")) as Record<string, unknown>;
const en = JSON.parse(read("messages/en.json")) as Record<string, unknown>;

describe("1. 공개 카탈로그 — admin.* 를 뺀 모든 값", () => {
  test("범위가 비어 있지 않다(잎을 실제로 본다)", () => {
    expect(publicLeaves(ko).length).toBeGreaterThan(200);
    expect(publicLeaves(en).length).toBeGreaterThan(200);
    // 관리자 네임스페이스는 실제로 "사장님" 을 쓴다 — 필터가 그것을 빼는지 확인(필터가 아무것도 안 빼면 아래 0건이 거짓 초록이 된다)
    expect(leaves(ko.admin).some(([, v]) => v.includes(OWNER_KO))).toBe(true);
  });

  test(`ko — "${OWNER_KO}" 0건`, () => {
    const hits = publicLeaves(ko).filter(([, v]) => v.includes(OWNER_KO));
    expect(hits).toEqual([]);
  });

  test('en — "owner"(대소문자 무시) 0건 · "사장님" 0건', () => {
    const hits = publicLeaves(en).filter(([, v]) => OWNER_EN.test(v) || v.includes(OWNER_KO));
    expect(hits).toEqual([]);
  });

  test("P7-7 에서 바꾼 세 자리 — 새 문구 그대로", () => {
    const pick = (cat: Record<string, unknown>, dotted: string) =>
      dotted.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], cat);
    expect(pick(ko, "home.hero.widget.sub")).toBe("일정과 인원을 남겨 주시면 확인 후 연락드립니다");
    expect(pick(ko, "quote.modal.summaryHint")).toBe("차량 종류·출발 시각 등은 전화로 확인해 드립니다.");
    expect(pick(en, "home.hero.widget.sub")).toBe("Leave your dates and group size, and we will review them and contact you");
  });
});

describe("2. 원장 — 손님 화면에 렌더되는 값", () => {
  test("verbatim 접수·확정 문구에 사장님이 없다 — 새 문구 바이트 그대로", () => {
    expect(VERBATIM.bookingNotice).toBe("담당자 확인 후 연락드리며, 확정된 예약만 결제 진행됩니다.");
    expect(VERBATIM.bookingNotice).not.toContain(OWNER_KO);
  });

  test("원장 상수의 문자열 값 — 출처 메모(source) 를 뺀 전부에 사장님 0건", () => {
    // `source` 는 근거 메모(사장님 답변 날짜 등)로 화면에 렌더되지 않는다. 그 밖의 값은 법정 페이지·모달에 나간다.
    const hits = Object.entries(ledger)
      .flatMap(([name, value]) => leaves(value, name))
      .filter(([p]) => !/(^|\.)source$/.test(p))
      .filter(([, v]) => v.includes(OWNER_KO));
    expect(hits).toEqual([]);
  });

  test("원장 UI 문구(ko·en) — 사장님 0건 · owner 0건", () => {
    for (const locale of ["ko", "en"] as const) {
      const hits = leaves(ledgerUi(locale), locale).filter(([, v]) => v.includes(OWNER_KO) || OWNER_EN.test(v));
      expect(hits, locale).toEqual([]);
    }
  });
});

describe("3. 손님에게 가는 문자·알림톡", () => {
  const CUSTOMER: CustomerVars = { publicCode: "BT12ABCD", origin: "https://bestour.co.kr" };
  const customerKeys = TEMPLATE_KEYS.filter((k) => k.includes(".customer."));

  test("손님 문자 키가 둘 있다(접수·확정)", () => {
    expect([...customerKeys].sort()).toEqual(["confirmed.customer.sms", "created.customer.sms"]);
  });

  test("렌더 결과(보낼 한 통 · SMS 판 · LMS 판)에 사장님 0건", () => {
    for (const key of customerKeys) {
      const v = renderVariants(key, CUSTOMER);
      for (const [variant, text] of [
        ["sent", renderTemplate(key, CUSTOMER).text],
        ["sms", v.sms],
        ["lms", v.lms],
      ] as const) {
        expect(text, `${key} / ${variant}`).not.toContain(OWNER_KO);
      }
    }
  });

  test("알림톡 심사 제출본(손님에게 간다)에 사장님 0건", () => {
    expect(ALIMTALK_TEMPLATES.length).toBe(2);
    for (const t of ALIMTALK_TEMPLATES) {
      expect(t.body, t.event).not.toContain(OWNER_KO);
      expect(t.name, t.event).not.toContain(OWNER_KO);
      for (const b of t.buttons) expect(b.name, t.event).not.toContain(OWNER_KO);
    }
  });
});

describe("4. 공개 페이지·컴포넌트 소스 — 주석을 걷어낸 코드에 사장님 0건", () => {
  /** 손님이 보는 화면의 소스. 관리자(app/admin · components/admin)는 뺀다. */
  const PUBLIC_DIRS = ["app/[locale]", "components"];
  const EXCLUDED = [path.join("components", "admin")];

  function walk(dir: string): string[] {
    const abs = path.join(ROOT, dir);
    return readdirSync(abs).flatMap((name) => {
      const rel = path.join(dir, name);
      if (EXCLUDED.some((e) => rel === e || rel.startsWith(e + path.sep))) return [];
      return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : /\.(tsx?|mjs|js)$/.test(name) ? [rel] : [];
    });
  }

  const files = PUBLIC_DIRS.flatMap(walk);

  test("스캔 대상이 실제로 있다", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.startsWith(path.join("components", "admin")))).toBe(false);
  });

  test("렌더되는 리터럴에 사장님이 없다", () => {
    const hits = files.filter((rel) => stripComments(read(rel), rel).includes(OWNER_KO));
    expect(hits).toEqual([]);
  });
});
