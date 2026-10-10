/**
 * OF-T2-3 — 취소·환불 7일/6일 개정과 시행일 전환 장치 (사장님 요청 16 · 결정 4 B안).
 *
 *   0. 고정값 자기검증 — 테스트가 박은 "시행일 전/후" 시각이 원장 시행일과 실제로 그 관계인가
 *   1. 원장 새 상수 바이트 잠금(컨트롤러 작성 · 독립 리뷰 서명 대상) + 두 판의 불변식(B안: 청약철회 제한 시작점 · 동의 문구 그대로)
 *   2. 경계 — KST 날짜 문자열 비교. 전날 23:59:59.999 KST = 옛 · 당일 00:00 KST = 새(UTC 로는 아직 전날) · 시간대 없는 값 거부
 *   3. 문자 — 확정 문자·확정 알림톡의 취소 줄은 접수 시각(created_at)의 판. 보내는 날(시스템 시각)과 무관하다
 *   4. 동의 판 판별 — 0021 에는 판 칸이 없다. withdrawal_consent_at(= 접수 인스턴트)의 KST 날짜로 판별한다 · 화면과 같은 함수
 *   5. 화면 두 상태(ko · en) — 견적 모달 · /guide · /terms
 *   6. 정적 — 판을 고르는 곳은 한 곳(lib/refund-policy.ts) · 운영에서 시행일을 바꾸는 env 경로 0 · 원장 함수 export 0
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
/** WithdrawalNotice 의 getTranslations/getLocale · 법정 페이지의 setRequestLocale — 로케일을 테스트가 바꿔 끼운다(실제 카탈로그). */
const intl = vi.hoisted(() => ({ locale: "ko" as "ko" | "en" }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const koMessages = (await import("../messages/ko.json")).default;
  const enMessages = (await import("../messages/en.json")).default;
  return {
    getLocale: async () => intl.locale,
    setRequestLocale: () => undefined,
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: intl.locale, messages: (intl.locale === "en" ? enMessages : koMessages) as never, namespace: namespace as never }),
  };
});

import { NextIntlClientProvider } from "next-intl";
import enMessages from "../messages/en.json";
import koMessages from "../messages/ko.json";
import GuidePage from "@/app/[locale]/(legal)/guide/page";
import TermsPage from "@/app/[locale]/(legal)/terms/page";
import { WithdrawalNotice } from "@/components/quote/WithdrawalNotice";
import { refundPolicyLine } from "@/components/admin/refund-policy-line";
import { refundChangeTexts } from "@/lib/i18n/refund-change";
import { LEDGER_UI_KO, ledgerUi } from "@/lib/i18n/ledger-ui";
import {
  CANCELLATION,
  CANCELLATION_NEXT,
  REFUND_POLICY_EFFECTIVE_FROM,
  WITHDRAWAL,
  WITHDRAWAL_NEXT,
} from "@/lib/legal/disclosures";
import {
  ALIMTALK_TEMPLATES,
  ALIMTALK_TEMPLATES_NEXT,
  alimtalkTemplatesFor,
  renderAlimtalk,
  renderTemplate,
  renderVariants,
  LMS_BYTE_LIMIT,
  utf8ByteLength,
  type CustomerVars,
} from "@/lib/notify/templates";
import {
  REFUND_POLICY_EFFECTIVE_DATE,
  REFUND_POLICY_LAST_CURRENT_DATE,
  refundPolicyAt,
  refundPolicyEditionAt,
  refundPolicyEditionOn,
  refundPolicyFor,
  upcomingRefundPolicy,
} from "@/lib/refund-policy";
import { consentFields } from "@/lib/reservations/consent";
import { toKstDateString } from "@/lib/kst";

import { findElements, findText, findUnmarkedHangul } from "./helpers/hangul-html";
import {
  AFTER_REFUND_CHANGE,
  BEFORE_REFUND_CHANGE,
  CREATED_AFTER_REFUND_CHANGE,
  CREATED_BEFORE_REFUND_CHANGE,
  FIRST_INSTANT_OF_CHANGE,
  LAST_INSTANT_BEFORE_CHANGE,
} from "./helpers/refund-policy-fixtures";
import { stripComments } from "./helpers/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const decode = (s: string) => s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const ORIGIN = "https://bestour.co.kr";

afterEach(() => {
  vi.useRealTimers();
  intl.locale = "ko";
});

// =============================================================================
// 0. 고정값 자기검증
// =============================================================================
describe("0. 고정값 — 테스트가 박은 시각이 원장 시행일과 그 관계다", () => {
  test("시행일 전 접수 · 전날 마지막 순간은 시행일보다 앞, 시행일 첫 순간 · 시행일 뒤 접수는 그날 이후(KST 날짜)", () => {
    expect(toKstDateString(new Date(CREATED_BEFORE_REFUND_CHANGE)) < REFUND_POLICY_EFFECTIVE_FROM).toBe(true);
    expect(toKstDateString(new Date(LAST_INSTANT_BEFORE_CHANGE))).toBe(REFUND_POLICY_LAST_CURRENT_DATE);
    expect(toKstDateString(new Date(FIRST_INSTANT_OF_CHANGE))).toBe(REFUND_POLICY_EFFECTIVE_FROM);
    expect(toKstDateString(new Date(CREATED_AFTER_REFUND_CHANGE)) > REFUND_POLICY_EFFECTIVE_FROM).toBe(true);
    expect(new Date(FIRST_INSTANT_OF_CHANGE).getTime() - new Date(LAST_INSTANT_BEFORE_CHANGE).getTime()).toBe(1);
  });
});

// =============================================================================
// 1. 원장 새 상수 — 바이트 잠금 + 두 판의 불변식
// =============================================================================
describe("1. 원장 — 개정 상수 바이트 잠금(컨트롤러 작성 2026-10-10 · 서명 후 고정)", () => {
  test("REFUND_POLICY_EFFECTIVE_FROM = 2026-11-09 (공지 게시일 + 30일 — 바꾸면 공지 게시일과 함께)", () => {
    expect(REFUND_POLICY_EFFECTIVE_FROM).toBe("2026-11-09");
    expect(REFUND_POLICY_EFFECTIVE_DATE).toBe("2026-11-09");
    expect(REFUND_POLICY_LAST_CURRENT_DATE).toBe("2026-11-08");
  });

  test("CANCELLATION_NEXT 는 원장 작성본과 바이트 단위로 같다", () => {
    expect(CANCELLATION_NEXT).toEqual({
      basis: "deposit",
      tiers: [
        { when: "운행일 7일 전까지", refundPct: 100, label: "계약금 전액 환불" },
        { when: "운행일 6일 전부터 운행 당일까지", refundPct: 0, label: "계약금 환불 불가" },
      ],
      referenceTime:
        "기준은 운행일의 날짜(한국 시간)입니다. 예) 20일 운행이면 13일 23시 59분까지 취소하시면 계약금 전액을 돌려드리고, 14일부터는 돌려드리지 않습니다.",
      depositNote: "계약금은 10만원이며, 잔금과 지급 방법은 예약 확정 시 안내드립니다.",
      scope:
        "위 규정은 고객 사정으로 취소하시는 경우에 적용되며, 계약 후 7일 이내의 청약철회 등 법에 따른 권리와, 제공된 서비스가 표시·광고 또는 계약 내용과 다른 경우의 권리에는 영향을 주지 않습니다.",
      smsLine: "취소·환불 : 운행일 7일 전까지 취소 시 계약금 전액 환불, 6일 전부터는 계약금 환불 불가(고객 사정으로 취소하는 경우)",
      smsItem: "운행일 7일 전까지 취소 시 계약금 전액 환불, 6일 전부터는 계약금 환불 불가(고객 사정으로 취소하는 경우)",
      source: "사장님 요청 16(2026-10-10, 사용자 경유) · 결정 4 B안 · 약관 제3조 30일 공지",
    });
  });

  test("WITHDRAWAL_NEXT 는 원장 작성본과 바이트 단위로 같다", () => {
    expect(WITHDRAWAL_NEXT).toEqual({
      notice:
        "이 서비스는 고객이 정한 운행일에 맞춰 차량을 따로 배차하는 전세버스 대절 알선 서비스입니다. 운행일 7일 전까지는 계약 시기와 관계없이 언제든 취소하시면 계약금 전액을 돌려드립니다. 운행일 6일 전부터 취소하시면 계약금을 돌려드리지 않지만, 계약 후 7일 이내라면 운행일 3일 전까지는 「전자상거래 등에서의 소비자보호에 관한 법률」 제17조 제1항에 따라 청약을 철회하고 지급하신 대금 전액을 돌려받으실 수 있습니다. 운행일 2일 전부터는 배차한 차량을 다시 배정하기 어려워 같은 법 제17조 제2항에 따라 청약철회가 제한될 수 있으며, 그 경우 계약 후 7일 이내라도 위 취소·환불 규정이 적용됩니다. 다만 제공된 서비스가 표시·광고 또는 계약 내용과 다른 경우에는 법에 따라 청약철회 등을 하실 수 있습니다.",
      noticeEn:
        "This charter is arranged individually for the travel date you choose. If you cancel at least 7 days before the travel date, we refund your full deposit, no matter when you booked. If you cancel from 6 days before the travel date, the deposit is not refunded; however, within 7 days of your booking being confirmed you may still withdraw and get back everything you paid up to 3 days before the travel date, under Article 17(1) of Korea's Act on the Consumer Protection in Electronic Commerce. Days are counted by calendar date in Korea time. From 2 days before the travel date, the vehicle assigned to you is hard to reassign, so your right of withdrawal may be restricted under Article 17(2) of the same Act; in that case the refund policy above applies even within 7 days of booking. The policy above covers cancellations you request; it does not affect your rights under the law, for example if the service provided differs from what was advertised or agreed. The Korean text is the legally binding version.",
      consentLabel: "위 청약철회 제한 내용을 확인했으며, 취소·환불이 위 규정에 따르는 데 동의합니다. (필수)",
      consentLabelEn: "I have read the restriction on withdrawal above and agree that cancellations and refunds follow the policy above. (required)",
      // 릴리스 C 리뷰 P1-1(컨트롤러 원장 수정): 6~3일 전 구간의 §17① 철회권을 확정 문자 한 줄에 함께 적는다
      smsLine: "계약 후 7일 이내라면 운행일 3일 전까지는 청약을 철회하고 지급하신 대금 전액을 돌려받으실 수 있으며, 운행일 2일 전부터는 청약철회가 제한될 수 있습니다.",
      summaryEn: {
        tiers: [
          "At least 7 days before the travel date: full deposit refund",
          "From 6 days before the travel date through the travel day: no deposit refund",
        ],
        referenceTime:
          "Days are counted by calendar date in Korea time. For example, for a trip on the 20th, you get your full deposit back if you cancel by 11:59 pm on the 13th; from the 14th, the deposit is not refunded.",
        scope:
          "These rules cover cancellations you request. They do not affect your legal rights, such as withdrawal within 7 days of booking, or your rights if the service provided differs from what was advertised or agreed.",
        restriction: "From 2 days before the travel date, your right of withdrawal may be restricted even within 7 days of booking.",
      },
      source: "사장님 요청 16(2026-10-10) · 결정 4 B안 · 전자상거래법 §17①·②·③ · 컨트롤러 작성(독립 리뷰 서명 대상)",
    });
  });

  test("두 판은 같은 모양이다 — 키 집합 · 2단계 · refundPct [100, 0] · 영문 요약 단계 수", () => {
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(CANCELLATION_NEXT)).toEqual(keys(CANCELLATION));
    expect(keys(WITHDRAWAL_NEXT)).toEqual(keys(WITHDRAWAL));
    expect(keys(WITHDRAWAL_NEXT.summaryEn)).toEqual(keys(WITHDRAWAL.summaryEn));
    expect(CANCELLATION_NEXT.tiers.map((t) => t.refundPct)).toEqual([100, 0]);
    expect(WITHDRAWAL_NEXT.summaryEn.tiers).toHaveLength(CANCELLATION_NEXT.tiers.length);
    expect(CANCELLATION_NEXT.tiers[0].when).toContain("7일");
    expect(WITHDRAWAL_NEXT.summaryEn.tiers[0]).toContain("7 days");
    expect(CANCELLATION_NEXT.tiers[1].when).toContain("6일");
    expect(WITHDRAWAL_NEXT.summaryEn.tiers[1]).toContain("6 days");
    expect(CANCELLATION_NEXT.referenceTime).toContain("13일");
    expect(WITHDRAWAL_NEXT.summaryEn.referenceTime).toContain("13th");
  });

  // 릴리스 C 리뷰 P1-1: smsLine 은 더 이상 두 판이 같지 않다(의도된 변경). 개정 판은 §17① 철회 구간(계약 후 7일 이내 · 3일 전까지)을
  // 먼저 말하고 옛 판의 제한 시작점(2일 전)을 그대로 이어 말한다 — 제한 시작점이 바뀌지 않았다는 B안 불변식은 문장 안에서 잠근다.
  test("B안 — 청약철회 제한 시작점(운행일 2일 전)과 동의 문구는 두 판이 같다 · 개정 smsLine 은 §17① 철회 구간을 더한다", () => {
    expect(WITHDRAWAL_NEXT.smsLine).not.toBe(WITHDRAWAL.smsLine);
    expect(WITHDRAWAL.smsLine.startsWith("운행일 2일 전부터는")).toBe(true);
    expect(WITHDRAWAL_NEXT.smsLine.startsWith("계약 후 7일 이내라면 운행일 3일 전까지는 청약을 철회하고 지급하신 대금 전액을 돌려받으실 수 있으며, ")).toBe(true);
    expect(WITHDRAWAL_NEXT.smsLine.endsWith("운행일 2일 전부터는 청약철회가 제한될 수 있습니다.")).toBe(true);
    expect(WITHDRAWAL_NEXT.smsLine).toContain("제한될 수 있습니다"); // 조건부 — 절대 표현이 아니다
    expect(WITHDRAWAL_NEXT.summaryEn.restriction).toBe(WITHDRAWAL.summaryEn.restriction);
    expect(WITHDRAWAL_NEXT.consentLabel).toBe(WITHDRAWAL.consentLabel);
    expect(WITHDRAWAL_NEXT.consentLabelEn).toBe(WITHDRAWAL.consentLabelEn);
    // 모달 체크박스 라벨(ledgerUi)은 WITHDRAWAL 에서 읽는다 — 위 같음 덕분에 판과 무관하게 맞다
    expect(LEDGER_UI_KO.consent.withdrawal).toBe(WITHDRAWAL_NEXT.consentLabel);
    expect(ledgerUi("en").consent.withdrawal).toBe(WITHDRAWAL_NEXT.consentLabelEn);
    expect(WITHDRAWAL_NEXT.notice).toContain("운행일 2일 전부터는 배차한 차량을 다시 배정하기 어려워");
  });

  test("smsItem = smsLine − 머리말 '취소·환불 : ' (옛 판과 같은 관계 — 확정 문자 섹션 제목과 겹치지 않게)", () => {
    const PREFIX = "취소·환불 : ";
    expect(CANCELLATION_NEXT.smsLine.startsWith(PREFIX)).toBe(true);
    expect(CANCELLATION_NEXT.smsItem).toBe(CANCELLATION_NEXT.smsLine.slice(PREFIX.length));
    expect(CANCELLATION_NEXT.smsItem.includes("취소·환불")).toBe(false);
  });
});

// =============================================================================
// 2. 경계
// =============================================================================
describe("2. 경계 — KST 날짜 문자열 비교", () => {
  test("KST 날짜: 전날 = 옛 · 당일 = 새 · 뒤 = 새", () => {
    expect(refundPolicyEditionOn("2026-11-08")).toBe("current");
    expect(refundPolicyEditionOn("2026-11-09")).toBe("next");
    expect(refundPolicyEditionOn("2026-11-10")).toBe("next");
    expect(refundPolicyEditionOn("2026-01-01")).toBe("current");
    expect(refundPolicyEditionOn("2027-01-01")).toBe("next");
  });

  test.for([
    ["2026-11-08T14:59:59.999Z", "current"], // 전날 23:59:59.999 KST
    ["2026-11-08T15:00:00.000Z", "next"], // 당일 00:00 KST — UTC 로는 아직 11월 8일
    ["2026-11-08T23:59:59.999+09:00", "current"],
    ["2026-11-09T00:00:00+09:00", "next"],
    ["2026-11-08T15:00:00.123456+00:00", "next"], // PostgREST timestamptz 모양(마이크로초)
    ["2026-11-08T14:59:59.999999+00:00", "current"],
    ["2026-11-09T08:59:59Z", "next"], // 같은 KST 날짜(17:59)
    ["2026-11-08T00:00:00Z", "current"], // KST 09:00 전날
  ] as const)("%s → %s", ([at, edition]) => {
    expect(refundPolicyEditionAt(at)).toBe(edition);
    expect(refundPolicyEditionAt(new Date(at))).toBe(edition);
    expect(refundPolicyAt(at).edition).toBe(edition);
  });

  test("판 → 원장 묶음: current = CANCELLATION·WITHDRAWAL, next = CANCELLATION_NEXT·WITHDRAWAL_NEXT", () => {
    expect(refundPolicyFor("current").cancellation).toBe(CANCELLATION);
    expect(refundPolicyFor("current").withdrawal).toBe(WITHDRAWAL);
    expect(refundPolicyFor("next").cancellation).toBe(CANCELLATION_NEXT);
    expect(refundPolicyFor("next").withdrawal).toBe(WITHDRAWAL_NEXT);
  });

  test("예고(upcoming) — 시행일 전에는 개정 판, 시행일부터는 null", () => {
    expect(upcomingRefundPolicy(LAST_INSTANT_BEFORE_CHANGE)?.cancellation).toBe(CANCELLATION_NEXT);
    expect(upcomingRefundPolicy(FIRST_INSTANT_OF_CHANGE)).toBeNull();
    expect(upcomingRefundPolicy(AFTER_REFUND_CHANGE)).toBeNull();
  });

  test("판을 짐작하지 않는다 — 시간대 없는 값 · 빈 값 · 깨진 Date · 형식 아닌 날짜는 throw", () => {
    for (const bad of ["2026-11-09T00:00", "2026-11-09", "", "not a date", "2026-11-09 00:00:00"]) {
      expect(() => refundPolicyEditionAt(bad), JSON.stringify(bad)).toThrow();
    }
    expect(() => refundPolicyEditionAt(new Date(Number.NaN))).toThrow();
    expect(() => refundPolicyEditionOn("2026/11/09")).toThrow();
    expect(() => refundPolicyEditionOn("2026-11-09T00:00")).toThrow();
  });
});

// =============================================================================
// 3. 문자 — 접수일(created_at, KST) 기준 선택
// =============================================================================
const customer = (createdAt: string): CustomerVars => ({ publicCode: "BT12ABCD", origin: ORIGIN, createdAt });
const rowsOf = (createdAt: string) => renderTemplate("confirmed.customer.sms", customer(createdAt)).text.split("\n");

describe("3. 확정 문자·알림톡 — 취소 줄은 접수일 판", () => {
  test.for([
    [CREATED_BEFORE_REFUND_CHANGE, "current"],
    [LAST_INSTANT_BEFORE_CHANGE, "current"],
    [FIRST_INSTANT_OF_CHANGE, "next"],
    [CREATED_AFTER_REFUND_CHANGE, "next"],
  ] as const)("접수 %s → %s 판의 취소 줄(smsItem)과 청약철회 줄(smsLine) 각 한 줄 · 다른 판 0", ([createdAt, edition]) => {
    const rows = rowsOf(createdAt);
    const mine = edition === "next" ? CANCELLATION_NEXT : CANCELLATION;
    const other = edition === "next" ? CANCELLATION : CANCELLATION_NEXT;
    // 릴리스 C 리뷰 P1-1: 청약철회 줄도 판마다 다르다 — 개정 판은 §17① 철회 구간을 함께 적은 WITHDRAWAL_NEXT.smsLine
    const myW = edition === "next" ? WITHDRAWAL_NEXT : WITHDRAWAL;
    const otherW = edition === "next" ? WITHDRAWAL : WITHDRAWAL_NEXT;
    expect(rows.filter((r) => r === `- ${mine.smsItem}`)).toHaveLength(1);
    expect(rows.some((r) => r.includes(other.smsItem))).toBe(false);
    expect(rows.filter((r) => r === `- ${myW.smsLine}`)).toHaveLength(1);
    expect(rows.some((r) => r === `- ${otherW.smsLine}`)).toBe(false);
    // 순서: ■ 취소·환불 → 취소 줄 → 청약철회 줄
    const at = rows.indexOf("■ 취소·환불");
    expect(rows.slice(at, at + 3)).toEqual(["■ 취소·환불", `- ${mine.smsItem}`, `- ${myW.smsLine}`]);
  });

  test("개정 판 확정 문자가 §17① 철회 구간을 지우지 않는다 — '환불 불가' 줄 바로 다음에 '3일 전까지는 청약을 철회' (P1-1)", () => {
    const rows = rowsOf(CREATED_AFTER_REFUND_CHANGE);
    const i = rows.indexOf(`- ${CANCELLATION_NEXT.smsItem}`);
    expect(rows[i + 1]).toContain("계약 후 7일 이내라면 운행일 3일 전까지는 청약을 철회하고 지급하신 대금 전액을 돌려받으실 수 있으며");
  });

  test("LMS 2,000바이트 상한 — 두 판 확정 문자 모두 아래 · 개정 판이 더 길어도 여유가 있다", () => {
    for (const createdAt of [CREATED_BEFORE_REFUND_CHANGE, CREATED_AFTER_REFUND_CHANGE]) {
      const sent = renderTemplate("confirmed.customer.sms", customer(createdAt));
      expect(sent.format).toBe("lms");
      expect(sent.utf8Bytes, createdAt).toBeLessThanOrEqual(LMS_BYTE_LIMIT);
      expect(sent.utf8Bytes).toBe(utf8ByteLength(sent.text));
    }
    // 가장 긴 원점에서도(관리자 링크가 아니라 고객 링크 두 개가 원점을 쓴다) 상한 아래
    const long = renderTemplate("confirmed.customer.sms", { publicCode: "BT12ABCD", origin: `https://${"a".repeat(200)}.test`, createdAt: CREATED_AFTER_REFUND_CHANGE });
    expect(long.utf8Bytes).toBeLessThanOrEqual(LMS_BYTE_LIMIT);
  });

  test("보내는 날과 무관하다 — 시스템 시각을 시행일 뒤로 옮겨도 시행일 전 접수는 옛 문장, 그 반대도", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AFTER_REFUND_CHANGE);
    expect(rowsOf(CREATED_BEFORE_REFUND_CHANGE)).toContain(`- ${CANCELLATION.smsItem}`);
    vi.setSystemTime(BEFORE_REFUND_CHANGE);
    expect(rowsOf(CREATED_AFTER_REFUND_CHANGE)).toContain(`- ${CANCELLATION_NEXT.smsItem}`);
  });

  test("개정 판 확정 문자 = 옛 판 확정 문자에서 취소·청약철회 두 줄만 바뀐 것(블록 서식 · 계약 주체 줄 · LMS 그대로)", () => {
    const before = renderTemplate("confirmed.customer.sms", customer(CREATED_BEFORE_REFUND_CHANGE));
    const after = renderTemplate("confirmed.customer.sms", customer(CREATED_AFTER_REFUND_CHANGE));
    expect(after.text).toBe(
      before.text
        .replace(`- ${CANCELLATION.smsItem}`, `- ${CANCELLATION_NEXT.smsItem}`)
        .replace(`- ${WITHDRAWAL.smsLine}`, `- ${WITHDRAWAL_NEXT.smsLine}`),
    );
    expect(after.text.split("\n").length).toBe(before.text.split("\n").length);
    expect(after.format).toBe("lms");
    const v = renderVariants("confirmed.customer.sms", customer(CREATED_AFTER_REFUND_CHANGE));
    expect(v.sms).toBe(v.lms);
    expect(after.text.split("\n").filter((l) => l.includes("취소·환불"))).toEqual(["■ 취소·환불"]);
  });

  test("접수 문자는 두 판이 같다(취소 줄이 없다)", () => {
    const a = renderTemplate("created.customer.sms", customer(CREATED_BEFORE_REFUND_CHANGE)).text;
    const b = renderTemplate("created.customer.sms", customer(CREATED_AFTER_REFUND_CHANGE)).text;
    expect(b).toBe(a);
  });

  test("접수 시각을 읽을 수 없으면 확정 문자는 throw — 판을 짐작해 보내지 않는다", () => {
    expect(() => renderTemplate("confirmed.customer.sms", customer("2026-11-09T00:00"))).toThrow();
    expect(() => renderTemplate("confirmed.customer.sms", customer(""))).toThrow();
  });

  test("알림톡 개정 판 — 접수는 같고, 확정은 취소·청약철회 두 줄과 목록 이름만 다르다 · 변수 · 버튼 그대로", () => {
    expect(ALIMTALK_TEMPLATES_NEXT.map((t) => t.event)).toEqual(["created", "confirmed"]);
    expect(alimtalkTemplatesFor("current")).toEqual(ALIMTALK_TEMPLATES);
    const [cOld, kOld] = ALIMTALK_TEMPLATES;
    const [cNew, kNew] = ALIMTALK_TEMPLATES_NEXT;
    expect(cNew).toEqual(cOld);
    expect(kNew.body).toBe(
      kOld.body
        .replace(`- ${CANCELLATION.smsItem}`, `- ${CANCELLATION_NEXT.smsItem}`)
        .replace(`- ${WITHDRAWAL.smsLine}`, `- ${WITHDRAWAL_NEXT.smsLine}`),
    );
    expect(kNew.body.split("\n")).toContain(`- ${WITHDRAWAL_NEXT.smsLine}`);
    expect(kNew.body.split("\n")).not.toContain(`- ${WITHDRAWAL.smsLine}`);
    expect(kOld.body.split("\n")).toContain(`- ${WITHDRAWAL.smsLine}`);
    expect(kNew.body).not.toBe(kOld.body);
    expect(kNew.variables).toEqual(kOld.variables);
    expect(kNew.buttons).toEqual(kOld.buttons);
    expect(kNew.name).not.toBe(kOld.name);
    expect(kNew.name).toContain(REFUND_POLICY_EFFECTIVE_FROM);
    expect(kNew.body.length).toBeLessThanOrEqual(1000);
  });

  test("renderAlimtalk — 확정은 접수일 판의 제출본 · 접수는 판과 무관", () => {
    const values = { 상담전화: "010-6362-6188" };
    const fill = (body: string) => body.split("#{상담전화}").join(values.상담전화);
    expect(renderAlimtalk("confirmed", values, CREATED_BEFORE_REFUND_CHANGE)).toBe(fill(ALIMTALK_TEMPLATES[1].body));
    expect(renderAlimtalk("confirmed", values, LAST_INSTANT_BEFORE_CHANGE)).toBe(fill(ALIMTALK_TEMPLATES[1].body));
    expect(renderAlimtalk("confirmed", values, FIRST_INSTANT_OF_CHANGE)).toBe(fill(ALIMTALK_TEMPLATES_NEXT[1].body));
    expect(renderAlimtalk("created", values, CREATED_AFTER_REFUND_CHANGE)).toBe(fill(ALIMTALK_TEMPLATES[0].body));
    expect(() => renderAlimtalk("confirmed", values, "2026-11-09")).toThrow();
  });
});

// =============================================================================
// 4. 동의 판 판별
// =============================================================================
describe("4. 동의 판 판별 — withdrawal_consent_at(접수 인스턴트)의 KST 날짜 = 화면이 고른 판", () => {
  const input = { privacyConsent: true, withdrawalConsent: true, marketingConsent: false } as const;

  test.for([
    [LAST_INSTANT_BEFORE_CHANGE, "current"],
    [FIRST_INSTANT_OF_CHANGE, "next"],
  ] as const)("접수 순간 %s → 동의 기록으로 %s 판을 판별 · 같은 순간의 견적 모달도 %s 판", async ([at, edition]) => {
    const now = new Date(at);
    const row = consentFields(input, now);
    expect(row.withdrawal_consent_at).toBe(now.toISOString()); // 동의 시각 = 접수 인스턴트(같은 now)
    expect(refundPolicyEditionAt(row.withdrawal_consent_at)).toBe(edition);
    const html = await notice("ko", now);
    expect(html).toContain(`data-refund-policy="${edition}"`);
  });

  test("0021 칸에는 판이 없다(마이그레이션 금지) — 동의 기록 컬럼 5개 그대로 · 판 칸 0", () => {
    const row = consentFields(input, BEFORE_REFUND_CHANGE);
    expect(Object.keys(row).sort()).toEqual(
      ["marketing_consent_at", "privacy_consent_at", "privacy_policy_version", "retention_until", "withdrawal_consent_at"].sort(),
    );
  });
});

// =============================================================================
// 5. 화면 두 상태
// =============================================================================
function render(node: ReactNode, locale: "ko" | "en"): string {
  const messages = locale === "en" ? enMessages : koMessages;
  const props = { locale, messages, timeZone: "Asia/Seoul" } as unknown as Parameters<typeof NextIntlClientProvider>[0];
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props, node));
}
async function notice(locale: "ko" | "en", now: Date): Promise<string> {
  intl.locale = locale;
  return decode(render(await WithdrawalNotice({ now }), locale));
}
async function page(which: "guide" | "terms", locale: "ko" | "en", now: Date): Promise<string> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  intl.locale = locale;
  const Page = which === "guide" ? GuidePage : TermsPage;
  const node = await Page({ params: Promise.resolve({ locale }) });
  vi.useRealTimers();
  return decode(render(node, locale));
}
const count = (html: string, s: string) => html.split(s).length - 1;

const KO_NOTICE = `2026년 11월 9일 접수분부터 취소·환불 규정이 바뀝니다: ${CANCELLATION_NEXT.smsItem}`;
// 릴리스 C 리뷰 P2-3: en 예고에도 범위 단서(ko 의 "(고객 사정으로 취소하는 경우)" 에 해당)를 붙였다 — summaryEn.scope 첫 문장
const EN_NOTICE = `For bookings received on or after Nov 9, 2026, the cancellation and refund policy changes: ${WITHDRAWAL_NEXT.summaryEn.tiers.join(" · ")}. These rules cover cancellations you request.`;

describe("5-a. 예고 문구 — 원장에서 조립 · 공개 날짜 형식", () => {
  test("시행일 전 ko·en 예고 · 머리 두 줄 / 시행일부터 null", () => {
    expect(refundChangeTexts("ko", BEFORE_REFUND_CHANGE)).toEqual({
      notice: KO_NOTICE,
      currentTitle: "현재 규정 — 2026년 11월 8일 접수분까지 적용",
      nextTitle: "변경 예정 — 2026년 11월 9일 접수분부터 적용",
    });
    expect(refundChangeTexts("en", BEFORE_REFUND_CHANGE)?.notice).toBe(EN_NOTICE);
    expect(refundChangeTexts("ko", new Date(FIRST_INSTANT_OF_CHANGE))).toBeNull();
    expect(refundChangeTexts("en", AFTER_REFUND_CHANGE)).toBeNull();
  });
});

describe("5-b. 견적 모달(청약철회 고지) — 시행일 전: 옛 규정 + 예고 · 시행일부터: 개정 규정만", () => {
  test("ko 시행일 전 — 옛 2단계 · 기준 · 범위 · 제한 줄 다음에 예고 한 줄 · 개정 표 0", async () => {
    const html = await notice("ko", BEFORE_REFUND_CHANGE);
    expect(html).toContain('data-refund-policy="current"');
    for (const s of [CANCELLATION.tiers[0].when, CANCELLATION.tiers[1].when, CANCELLATION.referenceTime, CANCELLATION.scope, WITHDRAWAL.notice]) {
      expect(html, s).toContain(s);
    }
    expect(count(html, KO_NOTICE)).toBe(1);
    const at = (s: string) => html.indexOf(s);
    expect(at(CANCELLATION.scope)).toBeLessThan(at(WITHDRAWAL.smsLine));
    expect(at(WITHDRAWAL.smsLine)).toBeLessThan(at(KO_NOTICE));
    expect(at('data-testid="withdrawal-more-toggle"')).toBeGreaterThan(-1);
    expect(at(KO_NOTICE)).toBeLessThan(at('data-testid="withdrawal-more-toggle"'));
    for (const s of [CANCELLATION_NEXT.tiers[1].when, CANCELLATION_NEXT.referenceTime, CANCELLATION_NEXT.scope, WITHDRAWAL_NEXT.notice]) {
      expect(html.includes(s), s).toBe(false);
    }
    const [line] = findElements(html, (_t, a) => a.get("data-legal") === "refund-policy-change");
    expect(line.attrs.has("hidden")).toBe(false);
    expect(line.ancestors.some((a) => a.attrs.has("hidden"))).toBe(false);
  });

  test("ko 시행일부터 — 개정 2단계 · 기준 · 범위 · 고지 전문 · 예고 0 · 옛 문장 0 · 마크업 표지는 같다", async () => {
    const html = await notice("ko", new Date(FIRST_INSTANT_OF_CHANGE));
    expect(html).toContain('data-refund-policy="next"');
    for (const s of [CANCELLATION_NEXT.tiers[0].when, CANCELLATION_NEXT.tiers[1].when, CANCELLATION_NEXT.referenceTime, CANCELLATION_NEXT.scope, WITHDRAWAL_NEXT.notice, WITHDRAWAL_NEXT.smsLine]) {
      expect(html, s).toContain(s);
    }
    expect(html).not.toContain('data-legal="refund-policy-change"');
    // 옛 1단계 문구("운행일 3일 전까지")는 개정 고지 전문 안의 §17① 문장에도 나온다 — 옛 판에만 있는 2단계 문구로 본다.
    for (const s of [CANCELLATION.tiers[1].when, CANCELLATION.referenceTime, CANCELLATION.scope, WITHDRAWAL.notice]) {
      expect(html.includes(s), s).toBe(false);
    }
    for (const mark of ["cancellation-reference", "cancellation-scope", "withdrawal-summary", "withdrawal-restriction"]) {
      expect(html, mark).toContain(`data-legal="${mark}"`);
    }
  });

  test("en 시행일 전 — 옛 영문 요약 + 영문 예고(접힌 자리) · lang=ko 밖 한글 0", async () => {
    const html = await notice("en", BEFORE_REFUND_CHANGE);
    for (const s of [...WITHDRAWAL.summaryEn.tiers, WITHDRAWAL.summaryEn.referenceTime, WITHDRAWAL.noticeEn]) expect(html, s).toContain(s);
    expect(count(html, EN_NOTICE)).toBe(1);
    expect(html.indexOf(WITHDRAWAL.summaryEn.restriction)).toBeLessThan(html.indexOf(EN_NOTICE));
    expect(html.includes(KO_NOTICE)).toBe(false);
    expect(findUnmarkedHangul(html).map((h) => h.value)).toEqual([]);
  });

  test("en 시행일부터 — 개정 영문 요약 · 개정 번역본 · 자세히 보기 안 한국어 한 벌도 개정 판 · 예고 0", async () => {
    const html = await notice("en", AFTER_REFUND_CHANGE);
    for (const s of [...WITHDRAWAL_NEXT.summaryEn.tiers, WITHDRAWAL_NEXT.summaryEn.referenceTime, WITHDRAWAL_NEXT.summaryEn.scope, WITHDRAWAL_NEXT.noticeEn, WITHDRAWAL_NEXT.notice, CANCELLATION_NEXT.tiers[1].when, CANCELLATION_NEXT.scope]) {
      expect(html, s).toContain(s);
    }
    expect(html.includes(EN_NOTICE)).toBe(false);
    for (const s of [...WITHDRAWAL.summaryEn.tiers, WITHDRAWAL.noticeEn, CANCELLATION.scope]) expect(html.includes(s), s).toBe(false);
    expect(findUnmarkedHangul(html).map((h) => h.value)).toEqual([]);
  });
});

describe("5-c. /guide — 시행일 전: 현재 규정 머리 + 옛 판 + 예고 + 변경 예정 전문 · 시행일부터: 개정 판만", () => {
  test("ko 시행일 전 — 순서와 어느 쪽이 적용되는지", async () => {
    const html = await page("guide", "ko", BEFORE_REFUND_CHANGE);
    const order = [
      "현재 규정 — 2026년 11월 8일 접수분까지 적용",
      CANCELLATION.tiers[0].when,
      CANCELLATION.referenceTime,
      CANCELLATION.scope,
      WITHDRAWAL.notice,
      KO_NOTICE,
      "변경 예정 — 2026년 11월 9일 접수분부터 적용",
      CANCELLATION_NEXT.tiers[1].when, // [0] "운행일 7일 전까지" 는 예고 문장(smsItem) 안에도 있다 — 표에만 있는 2단계로 본다
      CANCELLATION_NEXT.referenceTime,
      CANCELLATION_NEXT.scope,
      WITHDRAWAL_NEXT.notice,
    ];
    const at = order.map((s) => html.indexOf(s));
    for (let i = 0; i < order.length; i += 1) expect(at[i], order[i]).toBeGreaterThan(-1);
    for (let i = 1; i < order.length; i += 1) expect(at[i - 1], `${order[i - 1]} → ${order[i]}`).toBeLessThan(at[i]);
    expect(findElements(html, (_t, a) => a.get("data-testid") === "cancellation")).toHaveLength(1);
    expect(findElements(html, (_t, a) => a.get("data-testid") === "cancellation-next")).toHaveLength(1);
    // 옛 판의 청약철회 고지 표지는 하나 그대로(다른 화면·테스트가 존재의 증거로 쓴다), 개정 판은 -next 표지
    expect(findElements(html, (_t, a) => a.get("data-legal") === "withdrawal-restriction")).toHaveLength(1);
    expect(findElements(html, (_t, a) => a.get("data-legal") === "withdrawal-restriction-next")).toHaveLength(1);
    expect(html).not.toContain('data-legal="withdrawal-restriction-next-en"');
  });

  test("ko 시행일부터 — 개정 판만 · 머리·예고·변경 예정 묶음 0 · 표지는 시행일 전과 같다", async () => {
    const html = await page("guide", "ko", AFTER_REFUND_CHANGE);
    for (const s of [CANCELLATION_NEXT.tiers[0].when, CANCELLATION_NEXT.referenceTime, CANCELLATION_NEXT.scope, WITHDRAWAL_NEXT.notice]) expect(html, s).toContain(s);
    for (const s of [CANCELLATION.tiers[1].when, CANCELLATION.referenceTime, CANCELLATION.scope, WITHDRAWAL.notice, "현재 규정", "변경 예정", "접수분부터 취소·환불 규정이 바뀝니다"]) {
      expect(html.includes(s), s).toBe(false);
    }
    for (const mark of ["refund-policy-next", "refund-policy-change", "refund-policy-current-title"]) expect(html, mark).not.toContain(`data-legal="${mark}"`);
    expect(findElements(html, (_t, a) => a.get("data-testid") === "cancellation")).toHaveLength(1);
    expect(findElements(html, (_t, a) => a.get("data-legal") === "withdrawal-restriction")).toHaveLength(1);
  });

  test("en 시행일 전 — 본문은 한국어(lang=ko) · 예고와 개정 고지는 영문 번역(lang=en)을 먼저 · lang=ko 밖 한글 0", async () => {
    const html = await page("guide", "en", BEFORE_REFUND_CHANGE);
    expect(html).toContain(EN_NOTICE);
    expect(html).toContain(KO_NOTICE);
    expect(html.indexOf(EN_NOTICE)).toBeLessThan(html.indexOf(KO_NOTICE));
    const [en] = findElements(html, (_t, a) => a.get("data-legal") === "refund-policy-change-en");
    expect(en.attrs.get("lang")).toBe("en");
    const [nextEn] = findElements(html, (_t, a) => a.get("data-legal") === "withdrawal-restriction-next-en");
    expect(nextEn.attrs.get("lang")).toBe("en");
    expect(html.indexOf(WITHDRAWAL_NEXT.noticeEn)).toBeLessThan(html.indexOf(WITHDRAWAL_NEXT.notice));
    expect(findUnmarkedHangul(html).map((h) => h.value)).toEqual([]);
  });

  test("en 시행일부터 — 개정 번역본 다음 개정 원문 · 예고 0", async () => {
    const html = await page("guide", "en", AFTER_REFUND_CHANGE);
    expect(html).toContain(WITHDRAWAL_NEXT.noticeEn);
    expect(html.indexOf(WITHDRAWAL_NEXT.noticeEn)).toBeLessThan(html.indexOf(WITHDRAWAL_NEXT.notice));
    expect(html.includes(EN_NOTICE)).toBe(false);
    expect(html.includes(WITHDRAWAL.noticeEn)).toBe(false);
    expect(findUnmarkedHangul(html).map((h) => h.value)).toEqual([]);
  });
});

describe("5-d. /terms — 제7조 범위 + 예고 · 제8조 고지가 같은 판", () => {
  test("ko 시행일 전 — 옛 범위 · 예고 · 옛 고지", async () => {
    const html = await page("terms", "ko", BEFORE_REFUND_CHANGE);
    expect(html).toContain(CANCELLATION.scope);
    expect(count(html, KO_NOTICE)).toBe(1);
    expect(html.indexOf(CANCELLATION.scope)).toBeLessThan(html.indexOf(KO_NOTICE));
    expect(html.indexOf(KO_NOTICE)).toBeLessThan(html.indexOf(WITHDRAWAL.notice));
    expect(html.includes(CANCELLATION_NEXT.scope)).toBe(false);
  });

  test("ko 시행일부터 — 개정 범위 · 개정 고지 · 예고 0", async () => {
    const html = await page("terms", "ko", AFTER_REFUND_CHANGE);
    expect(html).toContain(CANCELLATION_NEXT.scope);
    expect(html).toContain(WITHDRAWAL_NEXT.notice);
    expect(html).not.toContain('data-legal="refund-policy-change"');
    expect(html.includes(CANCELLATION.scope)).toBe(false);
    expect(html.includes(WITHDRAWAL.notice)).toBe(false);
  });

  test("en 시행일 전 — 영문 예고 먼저 · lang=ko 밖 한글 0", async () => {
    const html = await page("terms", "en", BEFORE_REFUND_CHANGE);
    expect(html.indexOf(EN_NOTICE)).toBeGreaterThan(-1);
    expect(html.indexOf(EN_NOTICE)).toBeLessThan(html.indexOf(KO_NOTICE));
    expect(findUnmarkedHangul(html).map((h) => h.value)).toEqual([]);
  });
});

// =============================================================================
// 6. 정적
// =============================================================================
describe("6. 정적 — 고르는 곳은 한 곳 · 운영 env 경로 0", () => {
  test("lib/refund-policy.ts 는 process.env 를 읽지 않는다 — 운영에서 시행일은 원장 상수뿐", () => {
    expect(codeOf("lib/refund-policy.ts")).not.toMatch(/process\.env/);
    expect(codeOf("lib/i18n/refund-change.ts")).not.toMatch(/process\.env/);
  });

  test("화면·문자는 옛 상수를 직접 렌더하지 않는다 — refundPolicyAt 을 거친다(한 곳만 빠뜨려도 시행일에 어긋난다)", () => {
    const renderers = [
      "components/quote/WithdrawalNotice.tsx",
      "app/[locale]/(legal)/guide/page.tsx",
      "app/[locale]/(legal)/terms/page.tsx",
      "lib/notify/templates.ts",
    ];
    for (const f of renderers) {
      const code = codeOf(f);
      expect(code, f).not.toMatch(/\b(CANCELLATION|WITHDRAWAL)(_NEXT)?\b/);
      expect(code, f).toMatch(/\brefundPolicy(At|For)\(/);
    }
  });

  test("옛 상수를 직접 읽는 곳은 원장 UI 라벨(동의 문구 — 두 판이 같다 §1)뿐", () => {
    const allowed = new Set(["lib/i18n/ledger-ui.ts", "lib/i18n/ledger-ui-ko.ts", "lib/refund-policy.ts"]);
    const files = [
      "components/home/Hero.tsx",
      "components/quote/WithdrawalNotice.tsx",
      "app/[locale]/(legal)/guide/page.tsx",
      "app/[locale]/(legal)/terms/page.tsx",
      "lib/notify/templates.ts",
      "lib/notify/vars.ts",
      "lib/i18n/refund-change.ts",
    ];
    for (const f of files) {
      if (allowed.has(f)) continue;
      expect(read(f), f).not.toMatch(/import\s*\{[^}]*\b(CANCELLATION|WITHDRAWAL)\b[^}]*\}\s*from\s*["'][^"']*legal\/disclosures["']/);
    }
  });

  test("법정 페이지는 ISR 로 다시 렌더한다(시행일에 저절로 바뀐다) — 홈과 같은 주기", () => {
    for (const f of ["app/[locale]/(legal)/guide/page.tsx", "app/[locale]/(legal)/terms/page.tsx"]) {
      expect(codeOf(f), f).toMatch(/export const revalidate = 600;/);
    }
    expect(codeOf("app/[locale]/(site)/page.tsx")).toMatch(/export const revalidate = 600;/);
  });

  test("새 파일에 판 기준 시각이 숫자로 박혀 있지 않다 — 시행일은 원장 상수 하나", () => {
    for (const f of ["lib/refund-policy.ts", "lib/i18n/refund-change.ts", "components/quote/WithdrawalNotice.tsx", "lib/notify/templates.ts"]) {
      expect(codeOf(f), f).not.toMatch(/2026-11-0[89]/);
    }
  });

  test("관리자 상세 한 줄(P1-3) — 숫자는 원장 tiers 에서 · 날짜는 시행일 상수에서 · 읽지 못하면 null", () => {
    const labels = { current: "C {refund}/{noRefund} {date}", next: "N {refund}/{noRefund} {date}" };
    expect(refundPolicyLine(LAST_INSTANT_BEFORE_CHANGE, labels)).toEqual({ edition: "current", text: "C 3일/2일 2026-11-08" });
    expect(refundPolicyLine(FIRST_INSTANT_OF_CHANGE, labels)).toEqual({ edition: "next", text: "N 7일/6일 2026-11-09" });
    expect(CANCELLATION.tiers.map((t) => /(\d+)일/.exec(t.when)?.[1])).toEqual(["3", "2"]);
    expect(CANCELLATION_NEXT.tiers.map((t) => /(\d+)일/.exec(t.when)?.[1])).toEqual(["7", "6"]);
    expect(refundPolicyLine("2026-11-09", labels)).toBeNull();
    // 문구 틀은 카탈로그에서만 — 헬퍼 소스에 화면 문구(종전·개정·접수)가 없다
    expect(codeOf("components/admin/refund-policy-line.ts")).not.toMatch(/종전|개정|접수/);
  });

  test("텍스트 노드 검사 도우미가 살아 있다(빈 통과 방지)", () => {
    expect(findText("<p>가</p>", "가")).toHaveLength(1);
  });
});
