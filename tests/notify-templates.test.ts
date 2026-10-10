/**
 * P4-3 — 문자·알림톡 문안 (플랜 v4 P4-3 · CLAUDE.md §3 · ADR-7).
 *
 * 이 태스크가 지키는 것:
 *   1. **verbatim 은 한 바이트도 바뀌지 않는다.** "확인 후 연락드리겠습니다."(2026-10-10 사장님 요청 7)는 원장
 *      (lib/legal/disclosures.ts VERBATIM.bookingNotice)에서 import 하고, 접수 문자·접수 알림톡 렌더 결과 안에서 **바이트 열 그대로**
 *      발견돼야 한다. 길이 때문에 줄여야 하면 다른 문장을 줄인다 — 이 문장은 남는다. 확정 문자·확정 알림톡에는 없어야 한다(T2-2 · 결정 3-2).
 *      아래 §1 이 hex 비교로 잠근다.
 *   2. **정보성 문자에 광고 표현 0.** 섞이면 정보통신망법 §50 상 광고성 정보가 되어 `(광고)` 표기·수신거부 번호 의무가 생긴다.
 *      할인·이벤트·특가 류 단어를 정적으로 금지한다(§5).
 *   3. **법정 문구·회사 정보 리터럴 0.** 전화번호·결제 안내·verbatim 을 이 파일에 다시 타이핑하지 않는다(§6).
 *   4. **개인정보는 사장님 템플릿에만.** 고객 문자에 남의 이름·번호가 들어갈 경로가 **타입에 없다**(§4).
 *   5. **SMS/LMS 는 렌더 결과의 바이트로 고른다.** 경계 89·90·91 을 §2 가 직접 친다.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { CANCELLATION, COMPANY, PAYMENT, VERBATIM, WITHDRAWAL } from "@/lib/legal/disclosures";
import { FALLBACK_SITE_ORIGIN } from "@/lib/site-url";
import { ALL_TEMPLATE_KEYS, FAILURE_TEMPLATE_KEYS, TEMPLATE_KEYS, type TemplateKey } from "@/lib/notify/outbox";
import {
  ADMIN_RESERVATIONS_PATH,
  ALIMTALK_TEMPLATES,
  CHECK_GUIDE_ITEM,
  CONFIRMED_HEADLINE,
  CONTRACT_PARTY_LINE,
  GUIDE_PATH,
  LMS_BYTE_LIMIT,
  RESERVATION_CHECK_PATH,
  SMS_BYTE_LIMIT,
  chooseFormat,
  kscByteLength,
  renderAlimtalk,
  renderTemplate,
  renderVariants,
  utf8ByteLength,
  type CustomerVars,
  type OwnerVars,
} from "@/lib/notify/templates";
import { domesticPhoneText } from "@/lib/phone-format";

import { RETIRED_PHONE } from "./helpers/retired-phones";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf-8");
const exists = (rel: string): boolean => existsSync(path.join(ROOT, rel));

const TEMPLATES = "lib/notify/templates.ts";

/** 주석을 걷어낸 코드. 제거기는 저장소에 하나뿐이다(`tests/helpers/strip-comments.ts` · P6-7/P6-8 · D7). */
const codeOf = (rel: string) => stripComments(read(rel), rel);

const hex = (s: string): string => Buffer.from(s, "utf8").toString("hex");

// ── 금지어 (리터럴 금지) ─────────────────────────────────────────────────
// scripts/check-legal-disclosures.sh 는 tests/ 도 검사 대상에 넣는다 — 금지어를 글자 그대로 적으면 이 파일이 게이트를
// 빨갛게 만든다. 그래서 낱말을 쪼개 이어 붙인다(tests/admin-reservations.test.ts 의 가격 심볼과 같은 수법).
const W_LICENSE = "면" + "허"; // "등록"이 맞다 — CLAUDE.md §3
const W_RIVAL = "전세버스" + "하나"; // 타사 상호
/** soul §10.2 BM 비노출 — 원가 구조를 드러내는 표현. */
const BM_WORDS = new RegExp(["나가는 " + "버스", "태우고 " + "나가", "공" + "차", "회" + "송"].join("|"));

const ORIGIN = "https://bestour.co.kr";

const CUSTOMER: CustomerVars = { publicCode: "BT12ABCD", origin: ORIGIN };

/** 옛 위저드 접수분(intake='wizard') — 문안이 바뀌지 않았음을 이 픽스처로 잠근다. */
const OWNER: OwnerVars = {
  publicCode: "BT12ABCD",
  origin: ORIGIN,
  reservationId: "3f2b9c14-5f0a-4a2e-9c1b-8d7e6f5a4b3c",
  name: "한지원",
  phone: "+821020488585",
  intake: "wizard",
  vehicleLabel: "45인승 우등",
  departAtKst: "2026-10-03 08:00",
  returnDateKst: null,
  originLabel: "서울",
  destinationLabel: "부산",
  busCount: 2,
  passengers: 80,
};

/** 홈 간편 견적(P3-8 · intake='quick') — 차종·대수·시각이 없다. 날짜만 · 인원 필수. */
const QUICK_OWNER: OwnerVars = {
  publicCode: "BT34EFGH",
  origin: ORIGIN,
  reservationId: "5a1c2d3e-4f50-4a61-8b72-9c83d4e5f607",
  name: "김서연",
  phone: "+821055512345",
  intake: "quick",
  vehicleLabel: null,
  departAtKst: "2026-10-03",
  returnDateKst: "2026-10-05",
  originLabel: "인천공항",
  destinationLabel: "서울",
  busCount: null,
  passengers: 30,
};

const OWNER_KEYS = ["created.owner.sms", "created.owner.email"] as const;
const CUSTOMER_KEYS = ["created.customer.sms", "confirmed.customer.sms"] as const;

/**
 * 규약 루프가 도는 키 — **아웃박스가 받아들이는 키 전부**다(P4-4 독립 리뷰 경미-5).
 *
 * P4-4 가 실패 알림 문안 2종을 `FAILURE_TEMPLATE_KEYS` 로 따로 두면서(관리자 라벨 1:1 게이트를 깨지 않기 위해)
 * 이 파일의 §5 규약 루프가 `TEMPLATE_KEYS`(4종)만 돌아 **새 문안을 렌더 단위로 검사하지 않는 구멍**이 생겼다.
 * 광고 표현·**BM 금지어**(CLAUDE.md §3 절대 규칙)·브랜드 접두는 사장님께 나가는 문안에도 똑같이 걸려야 한다.
 * 그래서 규약 루프는 `ALL_TEMPLATE_KEYS` 를 돈다. **키 집합 자체의 잠금(§3)은 여전히 두 목록을 따로 단언한다** —
 * 그 둘은 뜻이 다르고(예약 통지 / 아웃박스 전체) 섞이면 관리자 라벨 게이트가 무의미해진다.
 */
const CONTRACT_KEYS = ALL_TEMPLATE_KEYS;

const isOwnerVarsKey = (key: TemplateKey): key is (typeof OWNER_KEYS)[number] =>
  key === "created.owner.sms" || key === "created.owner.email";

/** 키마다 알맞은 vars 로 렌더한다 — 호출부가 키별 분기를 반복하지 않게. 실패 알림 2종은 고객 변수를 받는다(P4-4). */
function renderAny(key: TemplateKey) {
  return isOwnerVarsKey(key) ? renderTemplate(key, OWNER) : renderTemplate(key, CUSTOMER);
}

function variantsAny(key: TemplateKey) {
  return isOwnerVarsKey(key) ? renderVariants(key, OWNER) : renderVariants(key, CUSTOMER);
}

// =============================================================================
// 1. verbatim — 바이트 동일 (xxd 수준)
// =============================================================================
// T2-2(2026-10-10, 사장님 요청 7 · 결정 3-2): verbatim 이 "확인 후 연락드리겠습니다." 로 바뀌면서 **접수 문자에만** 남고 확정 문자에서는 빠졌다.
// 그래서 "고객 템플릿 2종에 정확히 한 번" 단언을 둘로 나눴다 — 접수 문자는 같은 강도(바이트 열 그대로 · 정확히 한 번 · 두 판 모두 · 변수와 무관),
// 확정 문자는 0(두 판 모두 · 변수와 무관). 확정 문자의 "verbatim 은 본문 마지막 줄" 배치 잠금은 대상이 사라져 "맨 아래 계약 주체 줄 앞이 확정 선언이
// 아니다" 로 옮겼다.
const CREATED_CUSTOMER = "created.customer.sms" as const;
const CONFIRMED_CUSTOMER = "confirmed.customer.sms" as const;

describe("1. verbatim 보존", () => {
  test("고객 템플릿 키는 접수·확정 둘이다(아래 단언이 둘을 나눠 본다)", () => {
    expect([...CUSTOMER_KEYS].sort()).toEqual([CONFIRMED_CUSTOMER, CREATED_CUSTOMER].sort());
  });

  test("고객 접수 문자에 verbatim 이 바이트 열 그대로, 정확히 한 번 들어간다", () => {
    const expected = Buffer.from(VERBATIM.bookingNotice, "utf8");
    const actual = Buffer.from(renderTemplate(CREATED_CUSTOMER, CUSTOMER).text, "utf8");
    const at = actual.indexOf(expected);
    expect(at, "접수 문자에 verbatim 이 없다").toBeGreaterThanOrEqual(0);
    // xxd 수준 비교 — 잘라낸 구간의 hex 가 원장 문구의 hex 와 완전히 같아야 한다.
    expect(actual.subarray(at, at + expected.length).toString("hex")).toBe(expected.toString("hex"));
    expect(actual.lastIndexOf(expected), "접수 문자에 verbatim 이 두 번 들어갔다").toBe(at);
  });

  test("고객 확정 문자에는 verbatim 이 없다 — 확정 통지에 '확인 후 연락드리겠습니다' 가 붙으면 뜻이 뒤집힌다(결정 3-2)", () => {
    expect(renderTemplate(CONFIRMED_CUSTOMER, CUSTOMER).text).not.toContain(VERBATIM.bookingNotice);
  });

  test("SMS·LMS 두 벌 — 접수는 둘 다 verbatim 을 그대로 갖고(짧게 만들 때 줄이지 않았다), 확정은 둘 다 갖지 않는다", () => {
    const created = renderVariants(CREATED_CUSTOMER, CUSTOMER);
    expect(hex(created.sms), `${CREATED_CUSTOMER}.sms`).toContain(hex(VERBATIM.bookingNotice));
    expect(hex(created.lms), `${CREATED_CUSTOMER}.lms`).toContain(hex(VERBATIM.bookingNotice));
    const confirmed = renderVariants(CONFIRMED_CUSTOMER, CUSTOMER);
    expect(hex(confirmed.sms), `${CONFIRMED_CUSTOMER}.sms`).not.toContain(hex(VERBATIM.bookingNotice));
    expect(hex(confirmed.lms), `${CONFIRMED_CUSTOMER}.lms`).not.toContain(hex(VERBATIM.bookingNotice));
  });

  test("변수 치환 뒤에도 — 접수 문자의 verbatim 은 그대로, 확정 문자에는 생기지 않는다", () => {
    const odd: CustomerVars[] = [
      { publicCode: "", origin: "" },
      { publicCode: "확인 후", origin: "https://example.test/a?b=c&d=e" },
      { publicCode: "A".repeat(200), origin: ORIGIN },
    ];
    for (const vars of odd) {
      const where = vars.publicCode.slice(0, 12);
      expect(hex(renderTemplate(CREATED_CUSTOMER, vars).text), `${CREATED_CUSTOMER} / ${where}`).toContain(hex(VERBATIM.bookingNotice));
      expect(hex(renderTemplate(CONFIRMED_CUSTOMER, vars).text), `${CONFIRMED_CUSTOMER} / ${where}`).not.toContain(hex(VERBATIM.bookingNotice));
    }
  });

  // 사장님 요청 14 · 결정 12(2026-10-10 · T2-1): 확정 문자 맨 아래에 계약 주체 줄(CONTRACT_PARTY_LINE — '운영: ' + 원장 legalName).
  // T2-2: 그 바로 앞에 있던 verbatim 이 빠졌다 — 확정 선언과 맨 아래가 이웃하지 않는다는 잠금은 그대로 둔다.
  // T2-4(블록 서식 · 승인 초안): 계약 주체 줄 바로 앞은 `■ 예약 확인·변경` 블록의 마지막 항목 "- 이용안내: <주소>" 다(예전: 전화 안내 문장).
  // 그래서 "바로 앞 줄에 전화번호" 단언을 "바로 앞 줄은 이용안내 항목 · 전화는 같은 블록의 변경·취소 항목" 으로 바꿨다.
  test("확정 문자 — 맨 아래는 계약 주체 줄이고, 그 바로 앞은 확정 선언이 아닌 '예약 확인·변경' 블록(이용안내 · 변경·취소 전화)이다", () => {
    for (const variant of ["sms", "lms"] as const) {
      const text = renderVariants(CONFIRMED_CUSTOMER, CUSTOMER)[variant];
      const rows = text.split("\n").filter((l) => l.trim().length > 0);
      expect(rows[rows.length - 1], `${variant}: 계약 주체 줄이 마지막 줄이 아니다`).toBe(CONTRACT_PARTY_LINE);
      rows.pop();
      const before = rows[rows.length - 1];
      expect(before, `${variant}: 계약 주체 줄 앞이 확정 선언이다`).not.toContain(CONFIRMED_HEADLINE);
      expect(before, `${variant}: 계약 주체 줄 앞이 이용안내 항목이 아니다`).toBe(`- 이용안내: ${ORIGIN}${GUIDE_PATH}`);
      expect(rows.slice(-4), `${variant}: 예약 확인·변경 블록에 전화가 없다`).toEqual([
        "■ 예약 확인·변경",
        `- 확인: ${ORIGIN}${RESERVATION_CHECK_PATH}`,
        `- 변경·취소: ${COMPANY.consultTel}`,
        `- 이용안내: ${ORIGIN}${GUIDE_PATH}`,
      ]);
      expect(rows, `${variant}: verbatim 이 남았다`).not.toContain(VERBATIM.bookingNotice);
    }
  });

  // T2-4: 대금 블록의 첫 줄이 원장 PAYMENT.line(한 줄 요약)에서 PAYMENT.smsDeposit(블록 항목)으로 바뀌어 기준점만 옮겼다.
  test("확정 문자 — 확정 사실은 맨 첫 줄에 있다 (일어난 일 → 앞으로 할 일 → 계약 주체)", () => {
    const lms = renderVariants(CONFIRMED_CUSTOMER, CUSTOMER).lms;
    const rows = lms.split("\n").filter((l) => l.trim().length > 0);
    expect(rows[0]).toContain(CONFIRMED_HEADLINE);
    expect(rows[0]).toContain(`[${COMPANY.brandName}]`);
    // 확정 선언과 맨 아래 줄 사이에 "앞으로 할 일"이 실제로 들어 있다 — 두 줄이 이웃하지 않는다.
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(lms.indexOf(PAYMENT.smsDeposit)).toBeGreaterThan(lms.indexOf(CONFIRMED_HEADLINE));
    expect(lms.indexOf(CONTRACT_PARTY_LINE)).toBeGreaterThan(lms.indexOf(PAYMENT.smsDeposit));
  });

  test("사장님 템플릿에는 verbatim 을 넣지 않는다 — 사장님에게 '확인 후 연락드리겠습니다' 라고 보내지 않는다", () => {
    for (const key of OWNER_KEYS) {
      expect(renderTemplate(key, OWNER).text).not.toContain(VERBATIM.bookingNotice);
    }
  });

  test("Top-5 고지 verbatim 은 문자에 들어가지 않는다 (그 문구는 홈 노선 라벨용이다)", () => {
    for (const key of CONTRACT_KEYS) {
      expect(renderAny(key).text, key).not.toContain(VERBATIM.showcaseNotice);
    }
  });
});

// =============================================================================
// 2. SMS / LMS 선택 — 경계 89 · 90 · 91 바이트
// =============================================================================
describe("2. SMS/LMS 선택", () => {
  test("상한 상수 — SMS 90 · LMS 2,000", () => {
    expect(SMS_BYTE_LIMIT).toBe(90);
    expect(LMS_BYTE_LIMIT).toBe(2000);
  });

  test("utf8ByteLength — 한글 3바이트 · ASCII 1바이트 (UTF-8 로 잰다)", () => {
    expect(utf8ByteLength("가")).toBe(3);
    expect(utf8ByteLength("a")).toBe(1);
    expect(utf8ByteLength("")).toBe(0);
    expect(utf8ByteLength("가a")).toBe(4);
  });

  test("kscByteLength — 보고·비용 추정 전용. 한글 2바이트 · ASCII 1바이트", () => {
    expect(kscByteLength("가")).toBe(2);
    expect(kscByteLength("a")).toBe(1);
    expect(kscByteLength("가a")).toBe(3);
    // 제공자(EUC-KR) 기준이 UTF-8 보다 항상 짧거나 같다 — 그래서 UTF-8 선택은 보수적이다.
    expect(kscByteLength(VERBATIM.bookingNotice)).toBeLessThan(utf8ByteLength(VERBATIM.bookingNotice));
  });

  test("경계 — 89 바이트 sms · 90 바이트 sms · 91 바이트 lms (ASCII)", () => {
    expect(chooseFormat("a".repeat(89))).toBe("sms");
    expect(chooseFormat("a".repeat(90))).toBe("sms");
    expect(chooseFormat("a".repeat(91))).toBe("lms");
  });

  test("경계 — 한글도 같은 잣대. 30자(90바이트) sms · 그 뒤 1바이트만 더해도 lms", () => {
    const ninety = "가".repeat(30);
    expect(utf8ByteLength(ninety)).toBe(90);
    expect(chooseFormat(ninety)).toBe("sms");
    expect(chooseFormat(`${ninety}a`)).toBe("lms");
    // 29자 + ASCII 2개 = 89 바이트
    const eightyNine = `${"가".repeat(29)}aa`;
    expect(utf8ByteLength(eightyNine)).toBe(89);
    expect(chooseFormat(eightyNine)).toBe("sms");
  });

  test("렌더 결과의 format 은 sms 본문의 실제 바이트로 정해진다", () => {
    for (const key of CONTRACT_KEYS) {
      const v = variantsAny(key);
      const r = renderAny(key);
      const expected = utf8ByteLength(v.sms) <= SMS_BYTE_LIMIT ? "sms" : "lms";
      expect(r.format, key).toBe(expected);
      expect(r.text, key).toBe(expected === "sms" ? v.sms : v.lms);
      expect(r.utf8Bytes, key).toBe(utf8ByteLength(r.text));
      expect(r.kscBytes, key).toBe(kscByteLength(r.text));
    }
  });

  test("어떤 키도 LMS 상한을 넘지 않는다 (성명 30자·인원 3자리 최대 입력에서도)", () => {
    const long: OwnerVars = { ...OWNER, name: "가".repeat(30), vehicleLabel: "가".repeat(40), passengers: 900, busCount: 20 };
    for (const key of OWNER_KEYS) expect(utf8ByteLength(renderTemplate(key, long).text), key).toBeLessThanOrEqual(LMS_BYTE_LIMIT);
    for (const key of CUSTOMER_KEYS) expect(utf8ByteLength(renderTemplate(key, CUSTOMER).text), key).toBeLessThanOrEqual(LMS_BYTE_LIMIT);
    for (const key of FAILURE_TEMPLATE_KEYS) expect(utf8ByteLength(renderTemplate(key, CUSTOMER).text), key).toBeLessThanOrEqual(LMS_BYTE_LIMIT);
  });

  // T2-5: 고객 접수 문자는 접수번호를 더 싣지 않으므로, 길이를 부풀리는 변수를 접수번호 대신 원점(링크)으로 바꿨다(단언은 그대로).
  test("LMS 상한을 넘기면 조용히 자르지 않고 throw 한다 — verbatim 을 잘라 보내는 일은 없다", () => {
    expect(() => renderTemplate("created.customer.sms", { publicCode: "BT12ABCD", origin: `https://${"a".repeat(LMS_BYTE_LIMIT)}.test` })).toThrow(/LMS/);
  });
});

// =============================================================================
// 3. 키 — TEMPLATE_KEYS 그대로. 새 키 0
// =============================================================================
describe("3. 템플릿 키", () => {
  test("예약 통지는 네 키뿐이다 — 관리자 라벨(messages/ko.json)이 이 집합과 1:1 이다", () => {
    expect([...TEMPLATE_KEYS]).toEqual(["created.owner.sms", "created.owner.email", "created.customer.sms", "confirmed.customer.sms"]);
  });

  /**
   * P4-4 가 **발송 실패 알림** 2종을 더했다. 예약 통지와 **섞지 않은** 이유는 위 1:1 잠금과 관리자 화면의 번역 조회다
   * (`app/admin/(protected)/notifications/page.tsx` 가 `TEMPLATE_KEYS` 로 라벨을 찾는다 — 라벨 없는 키를 넣으면 화면이 조회에 실패한다).
   * 대신 **렌더·규약 검사는 두 집합을 합친 `ALL_TEMPLATE_KEYS`(= CONTRACT_KEYS)로 돈다** — 사장님께 나가는 문안도
   * 광고 표현·BM 금지어·브랜드 접두 규약을 똑같이 지켜야 하기 때문이다(독립 리뷰 경미-5).
   */
  test("실패 알림 2종이 따로 있고, 아웃박스가 받아들이는 키는 그 둘을 합친 여섯이다", () => {
    expect([...FAILURE_TEMPLATE_KEYS]).toEqual(["created.owner.failure.email", "confirmed.owner.failure.email"]);
    expect([...ALL_TEMPLATE_KEYS]).toEqual([...TEMPLATE_KEYS, ...FAILURE_TEMPLATE_KEYS]);
  });

  test("여섯 키 전부 렌더된다 — 그리고 그 여섯뿐이다", () => {
    expect(CONTRACT_KEYS).toHaveLength(6);
    for (const key of CONTRACT_KEYS) {
      const r = renderAny(key);
      expect(r.key, key).toBe(key);
      expect(r.text.trim().length, key).toBeGreaterThan(0);
    }
  });

  test("알 수 없는 키는 throw — 조용히 빈 문자를 보내지 않는다", () => {
    expect(() => renderTemplate("created.owner.kakao" as TemplateKey, OWNER as never)).toThrow();
  });

  test("메일 키만 제목을 갖는다 — 문자 키에는 제목이 없다 (키 이름의 채널과 1:1)", () => {
    for (const key of CONTRACT_KEYS) {
      const subject = renderAny(key).subject;
      if (key.endsWith(".email")) {
        expect(subject, `${key} 는 메일 키인데 제목이 없다`).toBeTruthy();
      } else {
        expect(subject, `${key} 는 문자 키인데 제목이 있다`).toBeUndefined();
      }
    }
    // 메일 키가 실제로 셋이다(사장님 접수 폴백 1 + 실패 알림 2) — 조건이 비어 통과하는 일이 없게
    expect(CONTRACT_KEYS.filter((k) => k.endsWith(".email"))).toHaveLength(3);
  });
});

// =============================================================================
// 4. 개인정보 — 사장님 템플릿에만
// =============================================================================
describe("4. 개인정보 경계", () => {
  // T2-4(결정 12): 전화번호는 국내 표기(+8210… → 010-…), 운행일은 "10월 3일(토) 08:00" 으로 보인다 — 바늘 둘을 표시값으로 바꿨다(정보는 그대로).
  test("사장님 접수 알림 — 접수번호·성명(마스킹 안 함)·연락처·차량·운행일·구간·인원·관리자 링크가 전부 있다", () => {
    for (const key of OWNER_KEYS) {
      const text = renderTemplate(key, OWNER).text;
      for (const needle of [
        OWNER.publicCode,
        OWNER.name,
        domesticPhoneText(OWNER.phone),
        OWNER.vehicleLabel,
        "10월 3일(토) 08:00",
        OWNER.originLabel,
        OWNER.destinationLabel,
        String(OWNER.busCount),
        String(OWNER.passengers),
        `${ORIGIN}${ADMIN_RESERVATIONS_PATH}/${OWNER.reservationId}`,
      ]) {
        expect(text, `${key} 에 ${needle} 가 없다`).toContain(needle);
      }
      // 마스킹하지 않는다 — 사장님은 전화를 걸어야 한다. 국내 표기로 바꿨으니 E.164 원형은 보이지 않는다(T2-4).
      expect(text, key).not.toContain("*");
      expect(text, key).not.toContain(OWNER.phone);
    }
  });

  // T2-4(사장님 요청 11 · 결정 12): 옛 판은 "전화로 확인할 것: 차종·대수·출발 시각·…" 줄을 실었고 이 테스트가 "전화"·"차종"·"시각" 낱말을 요구했다.
  // 그 줄을 뺐으므로 그 세 바늘을 지우고 **반대로**(없어야 한다) 단언한다. 전화·날짜 바늘은 표시값(010-… · "10월 3일(토)")으로 바꿨다.
  test("P3-8 간편 접수 — 사장님 알림에 '간편 접수' 가 드러나고, 날짜만(시각 0) · 차종·대수는 지어내지 않는다 · '전화로 확인할 것' 줄 없음", () => {
    for (const key of OWNER_KEYS) {
      const v = renderVariants(key, QUICK_OWNER);
      for (const [variant, text] of [["sms", v.sms], ["lms", v.lms]] as const) {
        const where = `${key}.${variant}`;
        for (const needle of [
          QUICK_OWNER.publicCode,
          QUICK_OWNER.name,
          domesticPhoneText(QUICK_OWNER.phone),
          "10월 3일(토)",
          "10월 5일(월)",
          QUICK_OWNER.originLabel,
          QUICK_OWNER.destinationLabel,
          `${QUICK_OWNER.passengers}명`,
          `${ORIGIN}${ADMIN_RESERVATIONS_PATH}/${QUICK_OWNER.reservationId}`,
          "간편",
        ]) {
          expect(text, `${where} 에 ${needle} 가 없다`).toContain(needle);
        }
        expect(text, where).not.toContain("전화로 확인");
        expect(text, where).not.toContain("차종");
        // 시각이 없다 — 저장된 00:00 은 자리값이다(손님이 고르지 않았다)
        expect(text, where).not.toMatch(/\b\d{2}:\d{2}\b/);
        // 차종·대수를 지어내지 않는다
        expect(text, where).not.toMatch(/\d+대/);
        expect(text, where).not.toContain("null");
        expect(text, where).not.toContain("undefined");
        expect(text, where).not.toContain(VERBATIM.bookingNotice);
      }
    }
  });

  // T2-4: 날짜 표기가 "2026-10-03 (당일)" 에서 승인 초안의 "10월 3일(토) 당일" 로 바뀌었다(뜻은 같다).
  test("P3-8 간편 접수 · 같은 날 — 도착일이 없으면 날짜 하나(당일)", () => {
    const sameDay: OwnerVars = { ...QUICK_OWNER, returnDateKst: null };
    const text = renderVariants("created.owner.sms", sameDay).lms;
    expect(text.split("\n")).toContain("- 날짜: 10월 3일(토) 당일");
    expect(text).not.toContain("~");
  });

  // P3-8 때는 "위저드 접수분의 사장님 알림은 한 글자도 바뀌지 않았다(옛 문안 그대로)" 를 옛 문안 전문으로 잠갔다(T2-1 은 접두만 되돌려 대조).
  // T2-4(사장님 요청 8 · 결정 12 · 2026-10-10 사용자 승인 초안)가 **일부러** 그 문안을 블록 서식으로 바꿨다 — 새 문안의 줄 단위 잠금은
  // 아래 "T2-4" 절의 WIZARD_DRAFT 다. 여기서는 옛 문안의 줄이 하나도 남지 않았다는 것만 잠근다(옛 판으로 되돌아가는 회귀를 막는다).
  test("T2-4 — 위저드 접수분의 사장님 알림도 블록 서식으로 바뀌었다(옛 줄 0 · 새 문안 전문은 T2-4 절)", () => {
    const raw = renderVariants("created.owner.sms", OWNER);
    const OLD_LINES = [
      `[${COMPANY.brandName}] 새 예약이 접수되었습니다.`,
      "고객 한지원 +821020488585",
      "운행 2026-10-03 08:00",
      "구간 서울 → 부산",
      "차량 45인승 우등 2대 · 80명",
      `확인 ${ORIGIN}${ADMIN_RESERVATIONS_PATH}/${OWNER.reservationId}`,
    ];
    for (const s of [raw.sms, raw.lms]) {
      expect(s.startsWith(`[${COMPANY.brandName}] 새 견적 신청 (상세 접수)`)).toBe(true);
      for (const old of OLD_LINES) expect(s.split("\n"), old).not.toContain(old);
      expect(s).not.toContain("+821020488585");
    }
  });

  test("고객 템플릿 — 남의 이름·번호가 들어갈 자리가 없다 (여분 필드를 넘겨도 새지 않는다)", () => {
    const smuggled = { ...CUSTOMER, name: OWNER.name, phone: OWNER.phone } as CustomerVars;
    for (const key of CUSTOMER_KEYS) {
      const text = renderTemplate(key, smuggled).text;
      expect(text, key).not.toContain(OWNER.name);
      expect(text, key).not.toContain(OWNER.phone);
      expect(text, key).not.toContain("2048");
    }
  });

  test("고객 템플릿 vars 타입에 원문 개인정보 키가 없다 (컴파일 잠금)", () => {
    type RawPii = Extract<keyof CustomerVars, "name" | "phone" | "email" | "message">;
    const noRawPii: RawPii extends never ? true : never = true;
    expect(noRawPii).toBe(true);
  });

  // P1-7 — 손님에게 전화하라고 안내하는 번호는 예약·상담 전화(COMPANY.consultTel)다.
  // P7-5 — 옛 대표전화 필드(COMPANY.tel)는 원장에서 지웠다. "다른 번호를 쓰지 않는다" 는 뜻은 옛 번호 0건(RETIRED_PHONE)으로 잠근다.
  // T2-5(사장님 요청 1 · 결정 5, 2026-10-10): 예약확인이 "휴대폰 번호 + 예약자 이름" 으로 바뀌어 손님 문자에서 접수번호를 뺐다.
  // 예전 단언(`toContain(CUSTOMER.publicCode)`)을 **반대로** 바꿨다 — 접수번호는 이제 관리자·발송 기록용 내부 식별자다.
  // T2-4(블록 서식): 조회 안내가 문장("… 에서 휴대폰 번호와 예약자 이름으로 확인하실 수 있습니다.")에서 `■ 예약 확인` 블록의 두 항목
  // (주소 · CHECK_GUIDE_ITEM)으로 바뀌어 바늘을 항목 줄로 바꿨다. 접수번호 0 · 전화 · 옛 번호 0 은 그대로.
  test("고객 접수 확인 — 접수번호 없음 · '휴대폰 번호와 예약자 이름으로' 조회 안내 · 예약확인 경로 · 예약·상담 전화", () => {
    const text = renderTemplate("created.customer.sms", CUSTOMER).text;
    const rows = text.split("\n");
    expect(text).not.toContain(CUSTOMER.publicCode);
    expect(rows).toContain(`- ${ORIGIN}${RESERVATION_CHECK_PATH}`);
    expect(rows).toContain(`- ${CHECK_GUIDE_ITEM}`);
    expect(rows).toContain(`- ${COMPANY.consultTel}`);
    expect(text).not.toMatch(RETIRED_PHONE);
  });

  // T2-4: 대금 안내가 원장 PAYMENT.line(한 줄 요약)에서 원장 PAYMENT.sms*(블록 항목 — 컨트롤러가 넣은 상수, 약관 제6조와 같은 뜻)로 바뀌었다.
  // "원장 문안을 그대로 쓴다(지어내지 않는다)" 는 뜻은 같고 가리키는 상수만 바꿨다. 옛 한 줄 요약은 확정 문자에 더 없다.
  test("고객 확정 안내 — 접수번호 없음 · 확정 사실 · 원장 PAYMENT 문안. 결제 문구를 지어내지 않았다", () => {
    const text = renderTemplate("confirmed.customer.sms", CUSTOMER).text;
    const rows = text.split("\n");
    expect(text).not.toContain(CUSTOMER.publicCode);
    expect(rows).toContain(`- 확인: ${ORIGIN}${RESERVATION_CHECK_PATH}`);
    for (const s of [PAYMENT.smsDeposit, PAYMENT.smsBalance, PAYMENT.smsAccount, PAYMENT.smsAccountHolder]) expect(text, s).toContain(s);
    expect(text).not.toContain(PAYMENT.line);
    expect(rows).toContain(`- 변경·취소: ${COMPANY.consultTel}`);
    expect(text).not.toMatch(RETIRED_PHONE);
  });

  // P1-7 R2 [P1-4] — 약관 제8조: "회사는 이 사실을 견적 신청 화면과 **예약 확정 통지**에 고지합니다."
  // T2-2(2026-10-10): 끝 기준점이던 verbatim 이 확정 문자에서 빠져, 같은 자리(맨 아래)의 계약 주체 줄을 끝 기준점으로 삼는다.
  // T2-4(승인 초안): 순서가 "대금(계약금 · 잔금 · 입금 계좌 · 예금주) → 취소·환불(취소 · 청약철회) → 예약 확인·변경(… 이용안내)" 로 바뀌었다.
  // 계좌가 대금 블록으로 올라가 취소·청약철회보다 **앞**에 온다 — 옛 단언(청약철회 < 계좌)을 새 순서로 바꿨다. 고지 줄은 하나도 빠지지 않았다(위험 #9).
  // T2-4 후속: 취소 줄이 원장 CANCELLATION.smsLine → smsItem(머리말 "취소·환불 : " 을 뺀 같은 문장 — 섹션 제목과 겹치지 않게)으로 바뀌어 바늘을 옮겼다.
  test("확정 통지 — 대금 · 입금 계좌 · 취소·환불 · 청약철회 줄 · 이용안내 링크가 이 순서로, 계약 주체 줄 앞에 있다 (두 판 모두)", () => {
    const guide = `${ORIGIN}${GUIDE_PATH}`;
    const order = [PAYMENT.smsDeposit, PAYMENT.smsBalance, PAYMENT.smsAccount, PAYMENT.smsAccountHolder, CANCELLATION.smsItem, WITHDRAWAL.smsLine, guide, CONTRACT_PARTY_LINE];
    for (const variant of ["sms", "lms"] as const) {
      const text = renderVariants("confirmed.customer.sms", CUSTOMER)[variant];
      const at = order.map((s) => text.indexOf(s));
      for (const [i, s] of order.entries()) expect(at[i], `${variant}: ${s}`).toBeGreaterThan(-1);
      for (let i = 1; i < order.length; i += 1) expect(at[i - 1], `${variant}: ${order[i - 1]} → ${order[i]}`).toBeLessThan(at[i]);
    }
  });

  // T2-4: 계좌 줄이 원장 PAYMENT.accountLine(한 줄)에서 smsAccount + smsAccountHolder(두 줄)로 바뀌었다 — 바늘만 바꿨다.
  test("확정 통지는 LMS 로만 나간다 — 고지를 빼서 SMS(90바이트)에 맞추지 않았다", () => {
    const r = renderTemplate("confirmed.customer.sms", CUSTOMER);
    expect(r.format).toBe("lms");
    for (const s of [CANCELLATION.smsItem, WITHDRAWAL.smsLine, PAYMENT.smsAccount, PAYMENT.smsAccountHolder]) expect(r.text).toContain(s);
    expect(utf8ByteLength(renderVariants("confirmed.customer.sms", CUSTOMER).sms)).toBeGreaterThan(SMS_BYTE_LIMIT);
  });

  test("접수 통지(고객)에는 — 아직 계약 전이라 대금·취소·청약철회·계좌 줄이 없다", () => {
    for (const variant of ["sms", "lms"] as const) {
      const text = renderVariants("created.customer.sms", CUSTOMER)[variant];
      for (const s of [CANCELLATION.smsItem, WITHDRAWAL.smsLine, PAYMENT.accountLine, PAYMENT.smsAccount, PAYMENT.smsDeposit]) {
        expect(text.includes(s), `${variant}: ${s}`).toBe(false);
      }
    }
  });
});

// =============================================================================
// 5. 광고 판별 회피 · BM 금지어 · 실증불가 수치
// =============================================================================
describe("5. 문구 규약", () => {
  /** 정보통신망법 §50 상 광고성으로 읽힐 수 있는 표현. 하나라도 섞이면 (광고) 표기·수신거부 의무가 생긴다. */
  const AD_WORDS = /할인|이벤트|저렴|특가|최저가|무료|사은품|경품|프로모션|쿠폰|세일|혜택|기회|추천드립니다|모시겠습니다|초특가/;
  /** 표시광고법 §5 실증책임 — 근거 없는 수치 주장. */
  const CLAIM_NUMBERS = /[0-9][0-9,]*\s*(건|명|년|대|원|%|만\s*원|만\s*명)/;

  test("렌더 결과에 광고 표현 0", () => {
    for (const key of CONTRACT_KEYS) {
      const v = variantsAny(key);
      expect(v.sms, `${key}.sms`).not.toMatch(AD_WORDS);
      expect(v.lms, `${key}.lms`).not.toMatch(AD_WORDS);
    }
    for (const t of ALIMTALK_TEMPLATES) expect(t.body, t.event).not.toMatch(AD_WORDS);
  });

  test("렌더 결과에 BM 금지어 0", () => {
    for (const key of CONTRACT_KEYS) {
      const v = variantsAny(key);
      expect(v.sms, `${key}.sms`).not.toMatch(BM_WORDS);
      expect(v.lms, `${key}.lms`).not.toMatch(BM_WORDS);
    }
    for (const t of ALIMTALK_TEMPLATES) expect(t.body, t.event).not.toMatch(BM_WORDS);
  });

  test("소스에 광고 표현·BM 금지어·타사 상호 0 (주석 제외)", () => {
    const src = codeOf(TEMPLATES);
    expect(src).not.toMatch(AD_WORDS);
    expect(src).not.toMatch(BM_WORDS);
    expect(src).not.toContain(W_LICENSE);
    expect(src).not.toContain(W_RIVAL);
  });

  test("소스에 실증불가 수치 주장 0 — 숫자는 원장(PAYMENT)과 변수에서만 온다", () => {
    expect(codeOf(TEMPLATES)).not.toMatch(CLAIM_NUMBERS);
  });

  test("렌더 결과의 수치 주장은 전부 변수·원장에서 온 것이다", () => {
    // 고객 문자에서 원장 PAYMENT 문안(계약금 10만원)·대표전화·접수번호를 걷어내면 수치 주장이 남지 않아야 한다.
    // (T2-5 이전에는 "휴대폰 뒷 4자리" 의 4 를 조작 안내로 따로 설명했다 — 지금 조회 안내는 "휴대폰 번호와 예약자 이름으로" 라 숫자가 없다.)
    for (const key of CUSTOMER_KEYS) {
      // P1-7 R2 — 확정 통지의 원장 줄(취소·환불 · 청약철회 · 입금 계좌)도 원장에서 온 것이라 걷어낸다.
      // T2-4 — 확정 문자의 대금 줄이 원장 PAYMENT.sms*(계약금 10만원 · 계좌)로 바뀌어 걷어낼 원장 줄에 더했다.
      let withoutSources = renderTemplate(key, CUSTOMER).text;
      for (const source of [
        PAYMENT.line,
        PAYMENT.smsDeposit,
        PAYMENT.smsBalance,
        PAYMENT.smsAccount,
        PAYMENT.smsAccountHolder,
        CANCELLATION.smsLine,
        CANCELLATION.smsItem,
        WITHDRAWAL.smsLine,
        PAYMENT.accountLine,
        COMPANY.consultTel,
        CUSTOMER.publicCode,
      ]) {
        withoutSources = withoutSources.split(source).join("");
      }
      expect(withoutSources, key).not.toMatch(CLAIM_NUMBERS);
    }
  });

  test("(광고) 표기·수신거부 안내가 없다 — 정보성 문자이므로 붙이면 오히려 광고로 읽힌다", () => {
    for (const key of CONTRACT_KEYS) {
      expect(renderAny(key).text, key).not.toContain("(광고)");
      expect(renderAny(key).text, key).not.toMatch(/수신\s*거부|무료거부/);
    }
  });
});

// =============================================================================
// 6. 원장 import — 리터럴 0
// =============================================================================
describe("6. 원장 단일 출처", () => {
  const src = () => read(TEMPLATES);

  test("법정 문구 원장에서 import 한다", () => {
    expect(src()).toMatch(/from\s+"\.\.\/legal\/disclosures"/);
    for (const sym of ["COMPANY", "PAYMENT", "VERBATIM"]) expect(src(), sym).toMatch(new RegExp(`\\b${sym}\\b`));
  });

  test("verbatim·대표전화·결제 문안을 다시 타이핑하지 않았다", () => {
    const bare = codeOf(TEMPLATES);
    expect(bare, "verbatim 리터럴").not.toContain(VERBATIM.bookingNotice);
    expect(bare, "옛 전화번호 리터럴(P7-5)").not.toMatch(RETIRED_PHONE);
    expect(bare, "예약·상담 전화 리터럴").not.toContain(COMPANY.consultTel);
    expect(bare, "결제 안내 리터럴").not.toContain(PAYMENT.line);
    expect(bare, "상호 리터럴").not.toContain(COMPANY.legalName);
  });

  test("링크는 원점(호출부가 넘긴 origin) + 경로 상수뿐 — 도메인 리터럴 0", () => {
    const bare = codeOf(TEMPLATES);
    expect(bare).not.toMatch(/https?:\/\//);
    expect(bare).not.toMatch(/bestour/i);
    expect(bare).not.toMatch(/process\.env/);
  });

  test("경로 상수가 실제 라우트를 가리킨다", () => {
    expect(RESERVATION_CHECK_PATH).toBe("/reservation/check");
    expect(ADMIN_RESERVATIONS_PATH).toBe("/admin/reservations");
    expect(GUIDE_PATH).toBe("/guide");
    expect(exists("app/[locale]/(site)/reservation/check/page.tsx"), RESERVATION_CHECK_PATH).toBe(true);
    expect(exists("app/admin/(protected)/reservations/[id]/page.tsx"), ADMIN_RESERVATIONS_PATH).toBe(true);
    expect(exists("app/[locale]/(legal)/guide/page.tsx"), GUIDE_PATH).toBe(true);
  });

  test("순수 모듈 — 서버 지시어·네트워크·DB 0", () => {
    const bare = codeOf(TEMPLATES);
    expect(bare).not.toMatch(/"use server"|'use server'/);
    expect(bare).not.toMatch(/\bfetch\(/);
    expect(bare).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE_KEY|supabase\//);
  });

  test("브랜드 접두는 원장 COMPANY.brandName 에서 만든다", () => {
    for (const key of CONTRACT_KEYS) expect(renderAny(key).text, key).toContain(`[${COMPANY.brandName}]`);
  });
});

// =============================================================================
// 7. 알림톡 (P4-2 발송 연동 전 — 심사 제출용 원문)
// =============================================================================
describe("7. 알림톡 템플릿", () => {
  test("접수·확정 2종이고 각각 심사용 변수 자리 `#{…}` 를 쓴다", () => {
    expect(ALIMTALK_TEMPLATES.map((t) => t.event)).toEqual(["created", "confirmed"]);
    for (const t of ALIMTALK_TEMPLATES) {
      expect(t.body, t.event).toMatch(/#\{[^}]+\}/);
      expect(t.variables.length, t.event).toBeGreaterThan(0);
      for (const v of t.variables) expect(t.body, `${t.event}/${v}`).toContain(`#{${v}}`);
    }
  });

  test("본문 안의 모든 `#{…}` 가 variables 목록에 있다 — 심사에서 미선언 변수로 반려되지 않게", () => {
    for (const t of ALIMTALK_TEMPLATES) {
      const used = [...t.body.matchAll(/#\{([^}]+)\}/g)].map((m) => m[1]);
      expect([...new Set(used)].sort(), t.event).toEqual([...t.variables].sort());
    }
  });

  // T2-2(2026-10-10 · 결정 3-2): 접수 알림톡은 verbatim 을 그대로 갖고, 확정 알림톡은 갖지 않는다(문자와 같은 규칙).
  test("알림톡 — 접수 알림톡은 verbatim 을 바이트 그대로 한 번 갖고, 확정 알림톡은 갖지 않는다", () => {
    const byEvent = Object.fromEntries(ALIMTALK_TEMPLATES.map((t) => [t.event, t.body]));
    expect(Object.keys(byEvent).sort()).toEqual(["confirmed", "created"]);
    expect(hex(byEvent.created)).toContain(hex(VERBATIM.bookingNotice));
    expect(byEvent.created.split(VERBATIM.bookingNotice).length - 1).toBe(1);
    expect(hex(byEvent.confirmed)).not.toContain(hex(VERBATIM.bookingNotice));
  });

  // T2-1(2026-10-10): 문자와 같이 맨 아래에 계약 주체 줄. T2-2: 그 앞의 verbatim 이 빠졌다.
  // T2-4(블록 서식): 계약 주체 줄 바로 앞은 `■ 예약 확인·변경` 블록의 마지막 항목 "- 이용안내: 아래 '이용안내' 버튼" 이다 —
  // `#{상담전화}` 는 같은 블록의 변경·취소 항목으로 옮겨 갔다. 바로 앞 줄 단언을 블록 단언으로 바꿨다(문자 §1 과 같은 이유).
  test("확정 알림톡도 문자와 같은 순서다 — 계약 주체 줄이 마지막, 그 바로 앞은 확정 선언이 아닌 '예약 확인·변경' 블록이다", () => {
    const confirmed = ALIMTALK_TEMPLATES.find((t) => t.event === "confirmed");
    expect(confirmed).toBeTruthy();
    const rows = (confirmed as { body: string }).body.split("\n").filter((l) => l.trim().length > 0);
    expect(rows.pop()).toBe(CONTRACT_PARTY_LINE);
    expect(rows[rows.length - 1]).not.toContain(CONFIRMED_HEADLINE);
    expect(rows.slice(-4)).toEqual(["■ 예약 확인·변경", "- 확인: 아래 '예약확인' 버튼", "- 변경·취소: #{상담전화}", "- 이용안내: 아래 '이용안내' 버튼"]);
    expect(rows).not.toContain(VERBATIM.bookingNotice);
    expect(rows[0]).toContain(CONFIRMED_HEADLINE);
  });

  // P1-7 R2 [P1-4] — 알림톡 초안에도 확정 통지의 고지 줄을 넣는다. 전화 자리 이름은 `#{상담전화}`(심사 전이라 바꿀 수 있다).
  // T2-4: 대금·계좌 줄이 원장 PAYMENT.line·accountLine 에서 PAYMENT.sms* 로, 순서가 "대금(계좌 포함) → 취소·환불" 로 바뀌었다(문자와 같다).
  // T2-4 후속: 취소 줄 바늘 smsLine → smsItem(머리말 없는 같은 문장).
  test("확정 알림톡 — 대금 · 입금 계좌 · 취소·환불 · 청약철회 줄이 이 순서로 계약 주체 줄 앞에 있다 · 접수 알림톡에는 없다", () => {
    const confirmed = ALIMTALK_TEMPLATES.find((t) => t.event === "confirmed")?.body ?? "";
    const order = [PAYMENT.smsDeposit, PAYMENT.smsBalance, PAYMENT.smsAccount, PAYMENT.smsAccountHolder, CANCELLATION.smsItem, WITHDRAWAL.smsLine, CONTRACT_PARTY_LINE];
    const at = order.map((s) => confirmed.indexOf(s));
    expect(at[0]).toBeGreaterThan(-1);
    for (let i = 1; i < order.length; i += 1) expect(at[i - 1], `${order[i - 1]} → ${order[i]}`).toBeLessThan(at[i]);
    const created = ALIMTALK_TEMPLATES.find((t) => t.event === "created")?.body ?? "";
    for (const s of [CANCELLATION.smsItem, WITHDRAWAL.smsLine, PAYMENT.accountLine, PAYMENT.smsAccount, PAYMENT.smsDeposit]) expect(created.includes(s), s).toBe(false);
  });

  // P1-7 R3 [P2-H] — 링크가 주석으로만 있으면 초안이 아니다. 심사에 낼 수 있게 **버튼 정의**를 초안에 담는다.
  test("🔴 버튼(웹링크) 정의가 초안에 있다 — 확정은 이용안내(/guide)와 예약확인, 접수는 예약확인", () => {
    const origin = FALLBACK_SITE_ORIGIN;
    const byEvent = Object.fromEntries(ALIMTALK_TEMPLATES.map((t) => [t.event, t]));
    for (const t of ALIMTALK_TEMPLATES) {
      expect(Array.isArray(t.buttons), t.event).toBe(true);
      expect(t.buttons.length, t.event).toBeGreaterThan(0);
      for (const b of t.buttons) {
        // 카카오 웹링크 버튼: 이름 · 타입 WL · 모바일/PC 링크. 링크는 절대 URL 이고 변수 자리를 쓰지 않는다(고정 URL 심사).
        expect(b.type, `${t.event}/${b.name}`).toBe("WL");
        expect(b.linkMo, `${t.event}/${b.name}`).toMatch(new RegExp(`^${origin}/`));
        expect(b.linkPc).toBe(b.linkMo);
        expect(b.name.length).toBeGreaterThan(0);
        expect(b.linkMo).not.toMatch(/#\{/);
      }
    }
    expect(byEvent.confirmed.buttons.map((b) => b.linkMo)).toContain(`${origin}${GUIDE_PATH}`);
    expect(byEvent.confirmed.buttons.map((b) => b.linkMo)).toContain(`${origin}${RESERVATION_CHECK_PATH}`);
    expect(byEvent.created.buttons.map((b) => b.linkMo)).toEqual([`${origin}${RESERVATION_CHECK_PATH}`]);
    // 본문에는 여전히 URL 을 적지 않는다(심사에서 본문 URL 은 광고성으로 걸리기 쉽다 — 기존 규칙)
    for (const t of ALIMTALK_TEMPLATES) expect(t.body, t.event).not.toMatch(/https?:\/\//);
  });

  test("알림톡 전화 자리 이름은 #{상담전화} — #{대표전화} 는 남지 않는다", () => {
    for (const t of ALIMTALK_TEMPLATES) {
      expect(t.body, t.event).toContain("#{상담전화}");
      expect(t.body, t.event).not.toContain("#{대표전화}");
      expect(t.variables, t.event).toContain("상담전화");
    }
  });

  // T2-5: 변수 `#{접수번호}` 를 뺐다(손님은 휴대폰 번호와 이름으로 조회한다). 접수번호 값을 넘겨도 본문에 들어갈 자리가 없다.
  test("renderAlimtalk — 변수를 치환해도 접수 알림톡의 verbatim 이 남고(확정에는 생기지 않고), 미치환 자리는 throw 한다 · 접수번호 자리는 없다", () => {
    const values = { 접수번호: "BT12ABCD", 상담전화: COMPANY.consultTel };
    for (const t of ALIMTALK_TEMPLATES) {
      expect([...t.variables], t.event).toEqual(["상담전화"]);
      const out = renderAlimtalk(t.event, values);
      expect(out).not.toMatch(/#\{/);
      if (t.event === "created") expect(hex(out), t.event).toContain(hex(VERBATIM.bookingNotice));
      else expect(hex(out), t.event).not.toContain(hex(VERBATIM.bookingNotice));
      expect(out).not.toContain("BT12ABCD");
      expect(out).toContain(COMPANY.consultTel);
    }
    expect(() => renderAlimtalk("created", {})).toThrow();
  });

  test("알림톡 본문은 1,000자 이하다 (카카오 심사 상한)", () => {
    for (const t of ALIMTALK_TEMPLATES) expect(t.body.length, t.event).toBeLessThanOrEqual(1000);
  });
});

// =============================================================================
// T2-5 — 예약확인 = 휴대폰 번호 + 예약자 이름 (사장님 요청 1 · 결정 5, 2026-10-10)
// =============================================================================
describe("T2-5. 손님 문자·알림톡의 조회 안내 — 접수번호·뒷 4자리 0, '휴대폰 번호와 예약자 이름으로'", () => {
  const OLD_GUIDE = /접수번호와 휴대폰 뒷\s*4자리|뒷\s*4자리|뒷자리/;

  // T2-4(블록 서식 · 승인 초안): 조회 안내가 문장 꼬리 CHECK_GUIDE_TAIL("…확인하실 수 있습니다.")에서 `■ 예약 확인` 블록 항목
  // CHECK_GUIDE_ITEM("휴대폰 번호와 예약자 이름으로 조회")으로 바뀌었다. 승인 초안은 이 항목을 **접수** 문자·알림톡에만 두고,
  // 확정 문자·알림톡에는 "- 확인: <주소/버튼>" 한 줄만 둔다 — 그래서 "2종 모두 한 번" 을 "접수 한 번 · 확정 0" 으로 바꿨다.
  test("조회 안내 항목 원문 고정", () => {
    expect(CHECK_GUIDE_ITEM).toBe("휴대폰 번호와 예약자 이름으로 조회");
  });

  test("손님 문자 2종(보낼 한 통 · SMS 판 · LMS 판) — 접수번호 낱말·값 0 · 옛 안내 0 · 새 안내는 접수에 한 번, 확정에 0", () => {
    for (const key of CUSTOMER_KEYS) {
      const v = renderVariants(key, CUSTOMER);
      for (const [where, text] of [
        ["sent", renderTemplate(key, CUSTOMER).text],
        ["sms", v.sms],
        ["lms", v.lms],
      ] as const) {
        expect(text, `${key}/${where}`).not.toContain("접수번호");
        expect(text, `${key}/${where}`).not.toContain(CUSTOMER.publicCode);
        expect(text, `${key}/${where}`).not.toMatch(OLD_GUIDE);
        expect(text, `${key}/${where}`).not.toContain("확인하실 수 있습니다");
      }
      expect(v.lms.split(CHECK_GUIDE_ITEM).length - 1, key).toBe(key === "created.customer.sms" ? 1 : 0);
    }
  });

  test("알림톡 심사 제출본 2종 — 접수번호 줄·변수 0 · 옛 안내 0 · 새 안내는 접수에 한 번, 확정에 0", () => {
    for (const t of ALIMTALK_TEMPLATES) {
      expect(t.body, t.event).not.toContain("접수번호");
      expect(t.body, t.event).not.toMatch(OLD_GUIDE);
      expect(t.body.split(CHECK_GUIDE_ITEM).length - 1, t.event).toBe(t.event === "created" ? 1 : 0);
      expect(t.variables, t.event).not.toContain("접수번호");
    }
  });

  test("사장님 접수 알림·발송 실패 알림의 접수번호는 그대로다(관리자용 내부 식별자)", () => {
    for (const key of OWNER_KEYS) expect(renderTemplate(key, OWNER).text, key).toContain(OWNER.publicCode);
    expect(renderVariants("created.owner.sms", OWNER).lms).toContain(`접수번호 ${OWNER.publicCode}`);
    for (const key of FAILURE_TEMPLATE_KEYS) expect(renderTemplate(key, CUSTOMER).text, key).toContain(CUSTOMER.publicCode);
  });
});

// =============================================================================
// T2-4 — 블록 서식 "■ 섹션 / - 라벨: 값" (사장님 요청 8 · 11 문자 줄 · 결정 12 · 2026-10-10 사용자 승인 초안)
// =============================================================================
// 승인 초안(OWNER-FEEDBACK-decisions.md "문자 서식 승인")을 **줄 단위로** 잠근다. 초안과 다르게 한 곳은 셋뿐이고 각각 이유가 있다:
//   - 주소에 `https://` 를 붙인다 — 지금 문자와 같은 형식(origin + 경로)이다. 휴대폰 문자앱이 링크로 알아보게 하는 쪽을 유지했다.
//   - 관리자 링크의 "…" 자리에는 실제 예약 id 가 들어간다.
//   - 취소·환불 블록의 두 줄은 초안이 "(원장 취소 규정 줄)" "(청약철회 제한 줄)" 로 비워 둔 자리다 — 원장에서 그대로 쓴다
//     (취소 = CANCELLATION.smsItem — smsLine 에서 머리말 "취소·환불 : " 만 뺀 같은 문장 · T2-4 후속 / 청약철회 = WITHDRAWAL.smsLine).
// 손님 문자는 SMS 판과 LMS 판이 **같은 본문**이다(어느 판도 90바이트에 들어가지 않아 SMS 판은 쓰일 일이 없었다 — 보낼 한 통이 곧 승인 초안).
describe("T2-4. 블록 서식 — 승인 초안과 줄 단위 일치", () => {
  const ADMIN = (id: string) => `${ORIGIN}${ADMIN_RESERVATIONS_PATH}/${id}`;

  /** 초안의 사장님 알림 예시 그대로 — 홍길동 · 010-1234-5678 · 11월 3일(화) 당일 · 서울 → 부산 · 40명 · BT7Q2XKM. */
  const DRAFT_QUICK: OwnerVars = {
    publicCode: "BT7Q2XKM",
    origin: ORIGIN,
    reservationId: "0b1c2d3e-4f50-4a61-8b72-9c83d4e5f6a7",
    name: "홍길동",
    phone: "+821012345678",
    intake: "quick",
    vehicleLabel: null,
    departAtKst: "2026-11-03",
    returnDateKst: null,
    originLabel: "서울",
    destinationLabel: "부산",
    busCount: null,
    passengers: 40,
  };

  const CREATED_DRAFT = [
    `[${COMPANY.brandName}] 견적 신청 접수`,
    "",
    "확인 후 연락드리겠습니다.",
    "",
    "■ 예약 확인",
    `- ${ORIGIN}/reservation/check`,
    "- 휴대폰 번호와 예약자 이름으로 조회",
    "■ 문의",
    "- 010-6362-6188",
  ].join("\n");

  const CONFIRMED_DRAFT = [
    `[${COMPANY.brandName}] 예약 확정 안내`,
    "",
    "■ 대금",
    "- 계약금: 10만원",
    "- 잔금·지급 방법: 담당자가 따로 안내",
    "- 입금 계좌: 하나은행 255-910018-71504",
    "  (예금주 (주)베스트모빌리티)",
    "",
    "■ 취소·환불",
    // T2-4 후속: 머리말 "취소·환불 : " 없는 원장 smsItem — 섹션 제목과 겹치지 않는다
    "- 운행일 3일 전까지 취소 시 계약금 전액 환불, 2일 전부터는 계약금 환불 불가(고객 사정으로 취소하는 경우)",
    `- ${WITHDRAWAL.smsLine}`,
    "",
    "■ 예약 확인·변경",
    `- 확인: ${ORIGIN}/reservation/check`,
    "- 변경·취소: 010-6362-6188",
    `- 이용안내: ${ORIGIN}/guide`,
    "",
    "운영: 합자회사 베스트투어",
  ].join("\n");

  const QUICK_DRAFT = [
    `[${COMPANY.brandName}] 새 견적 신청 (간편 접수)`,
    "",
    "■ 고객",
    "- 홍길동 / 010-1234-5678",
    "■ 운행",
    "- 날짜: 11월 3일(화) 당일",
    "- 구간: 서울 → 부산",
    "- 인원: 40명",
    "",
    "관리자에서 보기",
    ADMIN(DRAFT_QUICK.reservationId),
    "접수번호 BT7Q2XKM",
  ].join("\n");

  /** 위저드 접수(옛 6단계 접수분) — 초안의 틀 그대로, 운행 블록에 시각·차량·대수가 더 있다(지금 사장님 알림의 정보 그대로). */
  const WIZARD_DRAFT = [
    `[${COMPANY.brandName}] 새 견적 신청 (상세 접수)`,
    "",
    "■ 고객",
    "- 한지원 / 010-2048-8585",
    "■ 운행",
    "- 날짜: 10월 3일(토) 08:00",
    "- 구간: 서울 → 부산",
    "- 차량: 45인승 우등 2대",
    "- 인원: 80명",
    "",
    "관리자에서 보기",
    ADMIN(OWNER.reservationId),
    "접수번호 BT12ABCD",
  ].join("\n");

  const byLine = (actual: string, expected: string) => expect(actual.split("\n")).toEqual(expected.split("\n"));

  test("손님 접수 — 보낼 한 통 · 두 판 모두 초안과 줄 단위로 같다", () => {
    const v = renderVariants("created.customer.sms", CUSTOMER);
    byLine(v.lms, CREATED_DRAFT);
    byLine(v.sms, CREATED_DRAFT);
    const sent = renderTemplate("created.customer.sms", CUSTOMER);
    expect(sent.format).toBe("lms");
    expect(sent.text).toBe(CREATED_DRAFT);
  });

  test("손님 확정 — 보낼 한 통 · 두 판 모두 초안과 줄 단위로 같다", () => {
    const v = renderVariants("confirmed.customer.sms", CUSTOMER);
    byLine(v.lms, CONFIRMED_DRAFT);
    byLine(v.sms, CONFIRMED_DRAFT);
    const sent = renderTemplate("confirmed.customer.sms", CUSTOMER);
    expect(sent.format).toBe("lms");
    expect(sent.text).toBe(CONFIRMED_DRAFT);
  });

  test("확정 문자의 대금 줄은 원장 PAYMENT.sms* 그대로다(지어내지 않는다)", () => {
    const rows = renderTemplate("confirmed.customer.sms", CUSTOMER).text.split("\n");
    expect(rows).toContain(`- ${PAYMENT.smsDeposit}`);
    expect(rows).toContain(`- ${PAYMENT.smsBalance}`);
    expect(rows).toContain(`- ${PAYMENT.smsAccount}`);
    expect(rows).toContain(`  ${PAYMENT.smsAccountHolder}`);
  });

  // T2-4 후속(2026-10-10): 섹션 제목 "■ 취소·환불" 아래 항목이 "- 취소·환불 : …" 로 낱말이 겹쳤다(보고서 ④-2). 컨트롤러가 원장에
  // CANCELLATION.smsItem(머리말만 뺀 같은 문장)을 더했고 문자·알림톡이 그것을 쓴다. smsLine 은 원장에 남는다(다른 곳이 읽을 수 있다) —
  // 그래서 두 값이 어긋나지 않게 "smsItem = smsLine − 정확한 머리말" 을 잠근다.
  test("원장 CANCELLATION.smsItem 은 smsLine 에서 머리말 '취소·환불 : ' 만 뺀 같은 문장이다(어긋남 방지)", () => {
    const PREFIX = "취소·환불 : ";
    expect(CANCELLATION.smsLine.startsWith(PREFIX)).toBe(true);
    expect(CANCELLATION.smsItem).toBe(CANCELLATION.smsLine.slice(PREFIX.length));
    expect(CANCELLATION.smsItem.length).toBeGreaterThan(0);
  });

  test("확정 문자(두 판)·확정 알림톡에 '취소·환불' 은 섹션 제목 한 번뿐이다 — 제목과 항목이 겹치지 않는다", () => {
    const v = renderVariants("confirmed.customer.sms", CUSTOMER);
    const alimtalk = ALIMTALK_TEMPLATES.find((t) => t.event === "confirmed")?.body ?? "";
    for (const [where, text] of [["sms", v.sms], ["lms", v.lms], ["alimtalk", alimtalk]] as const) {
      expect(text.split("취소·환불").length - 1, where).toBe(1);
      const rows = text.split("\n");
      const at = rows.indexOf("■ 취소·환불");
      expect(at, where).toBeGreaterThan(-1);
      expect(rows[at + 1], where).toBe(`- ${CANCELLATION.smsItem}`);
      expect(text, where).not.toContain(CANCELLATION.smsLine);
    }
  });

  test("사장님 알림 — 간편 접수 · 문자와 메일 폴백 모두 초안과 줄 단위로 같다", () => {
    for (const key of OWNER_KEYS) {
      const v = renderVariants(key, DRAFT_QUICK);
      byLine(v.lms, QUICK_DRAFT);
      byLine(v.sms, QUICK_DRAFT);
      expect(renderTemplate(key, DRAFT_QUICK).text, key).toBe(QUICK_DRAFT);
    }
  });

  test("사장님 알림 — 위저드 접수 · 운행 블록에 시각·차량·대수", () => {
    for (const key of OWNER_KEYS) {
      byLine(renderVariants(key, OWNER).lms, WIZARD_DRAFT);
      expect(renderTemplate(key, OWNER).text, key).toBe(WIZARD_DRAFT);
    }
  });

  test("사장님 알림 — 간편 접수의 여러 날 운행은 '시작 ~ 끝', 인원 미입력이면 인원 줄을 뺀다", () => {
    const multi = renderTemplate("created.owner.sms", { ...DRAFT_QUICK, returnDateKst: "2026-11-05" }).text.split("\n");
    expect(multi).toContain("- 날짜: 11월 3일(화) ~ 11월 5일(목)");
    const noPax = renderTemplate("created.owner.sms", { ...DRAFT_QUICK, passengers: null }).text;
    expect(noPax).not.toContain("인원");
    expect(noPax).not.toContain("null");
    const wizardNoPax = renderTemplate("created.owner.sms", { ...OWNER, passengers: null }).text;
    expect(wizardNoPax).not.toContain("인원");
    expect(wizardNoPax.split("\n")).toContain("- 차량: 45인승 우등 2대");
  });

  test("요청 11 — '전화로 확인할 것' 줄이 사장님 알림 어디에도 없다(소스에도)", () => {
    for (const key of OWNER_KEYS) {
      for (const vars of [OWNER, QUICK_OWNER, DRAFT_QUICK]) {
        const v = renderVariants(key, vars);
        for (const text of [v.sms, v.lms]) {
          expect(text, key).not.toContain("전화로 확인");
          expect(text, key).not.toContain("전화 확인");
        }
      }
    }
    expect(codeOf(TEMPLATES)).not.toContain("전화로 확인");
    expect(codeOf(TEMPLATES)).not.toContain("QUICK_CONFIRM_BY_PHONE");
  });

  test("전화번호 — 국내 휴대폰은 010-xxxx-xxxx, 해외·그 밖은 저장값 그대로", () => {
    const cases: [string, string][] = [
      ["+821012345678", "- 홍길동 / 010-1234-5678"],
      ["+82101234567", "- 홍길동 / 010-123-4567"],
      ["+15551234567", "- 홍길동 / +15551234567"],
      ["+8221234567", "- 홍길동 / +8221234567"],
    ];
    for (const [phone, line] of cases) {
      const rows = renderTemplate("created.owner.sms", { ...DRAFT_QUICK, phone }).text.split("\n");
      expect(rows, phone).toContain(line);
    }
  });

  test("이름의 줄바꿈·제어문자는 공백으로 접는다 — 줄을 위조할 수 없다", () => {
    const forged = ["홍길동\n■ 운행\n- 날짜: 1월 1일(목) 당일", "홍길동\r\n접수번호 BT0000XX", "홍\t길\u0000동", "홍길동 - 구간: 가짜", "홍길동‮\u0085끝"];
    const normalRows = QUICK_DRAFT.split("\n").length;
    for (const name of forged) {
      for (const key of OWNER_KEYS) {
        const text = renderTemplate(key, { ...DRAFT_QUICK, name }).text;
        const rows = text.split("\n");
        expect(rows.length, JSON.stringify(name)).toBe(normalRows);
        expect(rows.filter((l) => l.startsWith("■ ")), JSON.stringify(name)).toEqual(["■ 고객", "■ 운행"]);
        expect(rows.filter((l) => l.startsWith("접수번호 ")), JSON.stringify(name)).toEqual(["접수번호 BT7Q2XKM"]);
        // 고객 줄은 한 줄이고 제어문자·줄 구분자가 남지 않는다
        const customer = rows[3];
        expect(customer.startsWith("- 홍"), JSON.stringify(name)).toBe(true);
        expect(customer.endsWith(" / 010-1234-5678"), JSON.stringify(name)).toBe(true);
        for (const ch of customer) {
          const c = ch.codePointAt(0) ?? 0;
          expect(c >= 0x20 && !(c >= 0x7f && c <= 0x9f) && c !== 0x2028 && c !== 0x2029 && c !== 0x202e, `U+${c.toString(16)}`).toBe(true);
        }
      }
    }
    // 차량 라벨·장소 라벨도 같은 규칙(관리자·코드에서 오지만 한 줄로 보낸다)
    const odd = renderTemplate("created.owner.sms", { ...OWNER, vehicleLabel: "45인승\n■ 가짜", originLabel: "서\r울" }).text.split("\n");
    expect(odd).toContain("- 차량: 45인승 ■ 가짜 2대");
    expect(odd).toContain("- 구간: 서 울 → 부산");
  });

  test("기호는 KS X 1001 에 있는 것만 — 한글 음절 · ASCII · ■ · → 뿐(이모지 0)", () => {
    const allowed = new Set(["■", "·", "→"]);
    const texts: [string, string][] = [];
    for (const key of CONTRACT_KEYS) {
      const v = variantsAny(key);
      texts.push([`${key}.sms`, v.sms], [`${key}.lms`, v.lms]);
    }
    for (const key of OWNER_KEYS) texts.push([`${key}/quick`, renderVariants(key, DRAFT_QUICK).lms]);
    for (const t of ALIMTALK_TEMPLATES) texts.push([`alimtalk.${t.event}`, t.body]);
    for (const [where, text] of texts) {
      for (const ch of text) {
        const c = ch.codePointAt(0) ?? 0;
        const ok = ch === "\n" || (c >= 0x20 && c <= 0x7e) || (c >= 0xac00 && c <= 0xd7a3) || allowed.has(ch);
        expect(ok, `${where}: U+${c.toString(16)} (${ch})`).toBe(true);
      }
    }
  });

  test("알림톡 초안 2종도 같은 순서 — 본문 URL 대신 버튼 이름을 가리키고, 전화는 #{상담전화}", () => {
    const created = ALIMTALK_TEMPLATES.find((t) => t.event === "created")?.body ?? "";
    const confirmed = ALIMTALK_TEMPLATES.find((t) => t.event === "confirmed")?.body ?? "";
    byLine(
      created,
      [
        `[${COMPANY.brandName}] 견적 신청 접수`,
        "",
        "확인 후 연락드리겠습니다.",
        "",
        "■ 예약 확인",
        "- 아래 '예약확인' 버튼",
        "- 휴대폰 번호와 예약자 이름으로 조회",
        "■ 문의",
        "- #{상담전화}",
      ].join("\n"),
    );
    byLine(
      confirmed,
      CONFIRMED_DRAFT.replace(`- 확인: ${ORIGIN}/reservation/check`, "- 확인: 아래 '예약확인' 버튼")
        .replace("- 변경·취소: 010-6362-6188", "- 변경·취소: #{상담전화}")
        .replace(`- 이용안내: ${ORIGIN}/guide`, "- 이용안내: 아래 '이용안내' 버튼"),
    );
    // 본문이 가리키는 버튼 이름이 실제 버튼 정의와 같다
    for (const t of ALIMTALK_TEMPLATES) {
      for (const m of t.body.matchAll(/아래 '([^']+)' 버튼/g)) expect(t.buttons.map((b) => b.name), `${t.event}: ${m[1]}`).toContain(m[1]);
    }
    expect(renderAlimtalk("created", { 상담전화: COMPANY.consultTel }).split("\n")).toContain(`- ${COMPANY.consultTel}`);
  });

  test("LMS 상한 — 최대 입력(성명 30자 · 차량 40자 · 인원 3자리)에서도 2,000바이트 아래", () => {
    const longQuick: OwnerVars = { ...DRAFT_QUICK, name: "가".repeat(30), returnDateKst: "2026-12-31", passengers: 900 };
    const longWizard: OwnerVars = { ...OWNER, name: "가".repeat(30), vehicleLabel: "가".repeat(40), busCount: 20, passengers: 900 };
    for (const key of OWNER_KEYS) {
      expect(renderTemplate(key, longQuick).utf8Bytes).toBeLessThanOrEqual(LMS_BYTE_LIMIT);
      expect(renderTemplate(key, longWizard).utf8Bytes).toBeLessThanOrEqual(LMS_BYTE_LIMIT);
    }
  });

  test("LMS 제목은 따로 두지 않았다 — 문자 키에 subject 0(메일 가드가 subject 를 본다 · 위험 #12)", () => {
    for (const key of ["created.owner.sms", "created.customer.sms", "confirmed.customer.sms"] as const) {
      const v = key === "created.owner.sms" ? renderVariants(key, OWNER) : renderVariants(key, CUSTOMER);
      expect(v.subject, key).toBeUndefined();
      expect(Object.keys(v).sort(), key).toEqual(["lms", "sms"]);
    }
  });

  test("메일 폴백 제목은 본문 첫 줄 + 접수번호", () => {
    expect(renderTemplate("created.owner.email", DRAFT_QUICK).subject).toBe(`[${COMPANY.brandName}] 새 견적 신청 (간편 접수) BT7Q2XKM`);
    expect(renderTemplate("created.owner.email", OWNER).subject).toBe(`[${COMPANY.brandName}] 새 견적 신청 (상세 접수) BT12ABCD`);
  });
});
