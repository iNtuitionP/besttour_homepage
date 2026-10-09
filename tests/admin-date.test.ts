/**
 * P5-23 라운드 2 (컨트롤러 A-3) — 관리자 날짜 표기는 **하나의 틀**이다.
 *
 * 화면마다 날짜 모양이 제각각이었다: 공지 목록·고치기 "2026-09-20" · 팝업 기간 "2026-10-13 ~ 2026-11-13" · 홈·허브 "마지막 게시일 2026-09-27" ·
 * 발송 기록 "2026-09-29 22:07" · 통계 "2026-09-01 ~ 2026-09-29" · 접수 기록 "2026-09-28 20:02" — 사장님이 보는 한국어 화면에 원형 날짜가 새어 나왔다.
 * 이제 `components/admin/admin-date.ts` 하나가 "9월 27일 (일)" · 시각이 있으면 " 22:07" · **올해(KST)가 아니면 연도**를 붙인다.
 * 기간은 요일 없이 "10월 13일 ~ 11월 13일". 격리 행의 10년 뒤 다음 시도는 화면 어디에도 날짜로 나오지 않는다 — '다음 시도' 칸이 없어졌고
 * 격리 행에는 '대기' 둘째 줄도 달지 않는다(tests/admin-notify-display.test.ts 가 2036 부재를 단언).
 * 입력칸(<input type=date>)의 값은 그대로다(브라우저가 그린다).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { calendarParts, formatAdminDate, formatAdminMonth, formatAdminPeriod, type AdminDateLabels } from "@/components/admin/admin-date";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf-8");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const HANGUL = /[가-힣]/;

const ko = JSON.parse(read("messages/ko.json")) as { admin: { dates: Record<string, unknown> } };
const d = ko.admin.dates as Record<string, string | string[]>;
const L: AdminDateLabels = {
  weekdays: d.weekdays as string[],
  day: d.day as string,
  dayYear: d.dayYear as string,
  md: d.md as string,
  mdYear: d.mdYear as string,
  month: d.month as string,
  monthYear: d.monthYear as string,
  time: d.time as string,
  dateTime: d.dateTime as string,
  period: d.period as string,
};
const NBSP = " ";
/** 기준 — 2026-09-29(화) 22:00 KST. */
const NOW = new Date("2026-09-29T13:00:00.000Z");

describe("1. 카탈로그 — admin.dates 틀", () => {
  test("틀이 전부 있다(요일 · 연도 · 요일 없는 날 · 달 · 시각 · 날짜+시각 · 기간)", () => {
    for (const k of ["day", "dayYear", "md", "mdYear", "month", "monthYear", "time", "dateTime", "period"]) {
      expect(typeof d[k], `admin.dates.${k}`).toBe("string");
    }
    expect(d.weekdays).toHaveLength(7);
    expect(L.day).toContain("{weekday}");
    expect(L.dayYear).toContain("{year}");
    expect(L.md).not.toContain("{weekday}");
    expect(L.period).toContain("{from}");
    expect(L.period).toContain("{to}");
  });
});

describe("2. formatAdminDate", () => {
  test("올해 날짜 — '9월 27일 (일)' · 시각을 달면 ' 22:07'", () => {
    expect(formatAdminDate("2026-09-27T13:07:00.000Z", NOW, L)).toBe("9월 27일 (일)");
    expect(formatAdminDate("2026-09-27T13:07:00.000Z", NOW, L, { time: true })).toBe("9월 27일 (일) 22:07");
  });

  test("날짜만 있는 값(게시일 · 팝업 기간 'YYYY-MM-DD')은 KST 달력 그대로 — 시각을 지어내지 않는다", () => {
    expect(formatAdminDate("2026-09-27", NOW, L)).toBe("9월 27일 (일)");
    expect(formatAdminDate("2026-09-27", NOW, L, { time: true })).toBe("9월 27일 (일)");
  });

  test("올해(KST)가 아니면 연도를 붙인다 — '2025년 12월 3일 (수)' · '2027년 9월 28일 (화) 20:02'", () => {
    expect(formatAdminDate("2025-12-03", NOW, L)).toBe("2025년 12월 3일 (수)");
    expect(formatAdminDate("2027-09-28T11:02:00.000Z", NOW, L, { time: true })).toBe("2027년 9월 28일 (화) 20:02");
  });

  test("🔴 KST 로 자른다 — UTC 날짜가 전날인 새벽도 KST 날짜 · 올해 판정도 KST(12/31 15:30Z = 1월 1일)", () => {
    expect(formatAdminDate("2026-09-26T15:30:00.000Z", NOW, L, { time: true })).toBe("9월 27일 (일) 00:30");
    const newYear = new Date("2026-12-31T15:30:00.000Z"); // KST 2027-01-01 00:30
    expect(formatAdminDate("2027-01-01", newYear, L)).toBe("1월 1일 (금)");
    expect(formatAdminDate("2026-12-31", newYear, L)).toBe("2026년 12월 31일 (목)");
  });

  test("요일을 뺄 수 있다 — '9월 27일'", () => {
    expect(formatAdminDate("2026-09-27", NOW, L, { weekday: false })).toBe("9월 27일");
    expect(formatAdminDate("2025-09-27", NOW, L, { weekday: false })).toBe("2025년 9월 27일");
  });

  test("keep — 날짜 안에서는 줄이 꺾이지 않게(줄바꿈 없는 공백) · 문장 속 날짜용", () => {
    expect(formatAdminDate("2026-09-27", NOW, L, { keep: true })).toBe(`9월${NBSP}27일${NBSP}(일)`);
    expect(formatAdminDate("2026-09-27T13:07:00.000Z", NOW, L, { keep: true, time: true })).toBe(`9월${NBSP}27일${NBSP}(일)${NBSP}22:07`);
  });

  test("읽을 수 없는 값은 null — 부르는 쪽이 '—' 를 그린다(지어내지 않는다)", () => {
    expect(formatAdminDate("", NOW, L)).toBeNull();
    expect(formatAdminDate("not-a-date", NOW, L)).toBeNull();
    expect(formatAdminDate(null, NOW, L)).toBeNull();
    expect(calendarParts("2026-02-30")).toBeNull();
  });
});

describe("3. 기간 · 달", () => {
  test("기간은 요일 없이 '10월 13일 ~ 11월 13일' — 날짜 안은 붙이고, 물결표 앞뒤에서만 꺾인다", () => {
    expect(formatAdminPeriod("2026-10-13", "2026-11-13", NOW, L)).toBe(`10월${NBSP}13일 ~ 11월${NBSP}13일`);
    expect(formatAdminPeriod("2025-12-20", "2026-01-05", NOW, L)).toBe(`2025년${NBSP}12월${NBSP}20일 ~ 1월${NBSP}5일`);
    expect(formatAdminPeriod("x", "2026-01-05", NOW, L)).toBeNull();
  });

  test("달 — '9월' · 올해가 아니면 '2025년 10월'(통계 달 단위 축)", () => {
    expect(formatAdminMonth("2026-09-01", NOW, L)).toBe("9월");
    expect(formatAdminMonth("2025-10-01", NOW, L)).toBe(`2025년${NBSP}10월`);
  });
});

describe("4. 정적 규약 — 틀 하나 · 화면에 원형 날짜 0", () => {
  test("모듈은 순수하다 — React·Next·DB·env 0 · 한글 리터럴 0(문구는 카탈로그)", () => {
    const src = codeOf("components/admin/admin-date.ts");
    expect(src).not.toMatch(/from\s+["'](react|next|next-intl)/);
    expect(src).not.toMatch(/process\.env|createSsrClient|supabase/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
  });

  test("🔴 관리자 화면은 원형 날짜 도우미(kstWallClock)를 더는 쓰지 않는다 — 날짜는 전부 admin-date 로", () => {
    const walk = (dir: string): string[] =>
      readdirSync(path.join(ROOT, dir)).flatMap((f) => {
        const rel = `${dir}/${f}`;
        return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : rel.endsWith(".tsx") || rel.endsWith(".ts") ? [rel] : [];
      });
    const offenders = [...walk("app/admin"), ...walk("components/admin")].filter((rel) => /\bkstWallClock\b/.test(codeOf(rel)));
    expect(offenders).toEqual([]);
  });

  test.each([
    ["app/admin/(protected)/notices/page.tsx", "공지 목록 게시일"],
    ["app/admin/(protected)/notices/[id]/page.tsx", "공지 고치기 부제"],
    ["app/admin/(protected)/popups/page.tsx", "팝업 노출 기간"],
    ["app/admin/(protected)/popups/[id]/page.tsx", "팝업 고치기 부제"],
    ["app/admin/(protected)/site/page.tsx", "허브 마지막 게시일"],
    ["app/admin/(protected)/page.tsx", "홈 마지막 게시일"],
    ["app/admin/(protected)/notifications/page.tsx", "발송 기록 시각"],
    ["app/admin/(protected)/stats/page.tsx", "통계 기간 줄 · 축"],
    ["app/admin/(protected)/reservations/[id]/page.tsx", "접수 기록 시각"],
  ])("%s — %s 는 admin-date 로 그린다", (rel) => {
    expect(codeOf(rel)).toMatch(/from "@\/components\/admin\/admin-date"/);
  });
});
