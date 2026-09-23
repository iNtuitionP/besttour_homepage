/**
 * P4-3 — 문자·알림톡 문안 (플랜 v4 P4-3 · CLAUDE.md §3 · ADR-7).
 *
 * 이 태스크가 지키는 것:
 *   1. **verbatim 은 한 바이트도 바뀌지 않는다.** "사장님 확정 후 연락드리며, 확정된 예약만 결제 진행됩니다." 는 원장
 *      (lib/legal/disclosures.ts VERBATIM.bookingNotice)에서 import 하고, 렌더 결과 안에서 **바이트 열 그대로** 발견돼야 한다.
 *      길이 때문에 줄여야 하면 다른 문장을 줄인다 — 이 문장은 남는다. 아래 §1 이 hex 비교로 잠근다.
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
  CONFIRMED_HEADLINE,
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

const OWNER: OwnerVars = {
  publicCode: "BT12ABCD",
  origin: ORIGIN,
  reservationId: "3f2b9c14-5f0a-4a2e-9c1b-8d7e6f5a4b3c",
  name: "한지원",
  phone: "+821020488585",
  vehicleLabel: "45인승 우등",
  departAtKst: "2026-10-03 08:00",
  originLabel: "서울",
  destinationLabel: "부산",
  busCount: 2,
  passengers: 80,
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
describe("1. verbatim 보존", () => {
  test("고객 템플릿 2종에 verbatim 이 바이트 열 그대로, 정확히 한 번 들어간다", () => {
    const expected = Buffer.from(VERBATIM.bookingNotice, "utf8");
    for (const key of CUSTOMER_KEYS) {
      const actual = Buffer.from(renderTemplate(key, CUSTOMER).text, "utf8");
      const at = actual.indexOf(expected);
      expect(at, `${key} 에 verbatim 이 없다`).toBeGreaterThanOrEqual(0);
      // xxd 수준 비교 — 잘라낸 구간의 hex 가 원장 문구의 hex 와 완전히 같아야 한다.
      expect(actual.subarray(at, at + expected.length).toString("hex")).toBe(expected.toString("hex"));
      expect(actual.lastIndexOf(expected), `${key} 에 verbatim 이 두 번 들어갔다`).toBe(at);
    }
  });

  test("SMS·LMS 두 벌 모두 verbatim 을 그대로 갖는다 — 짧게 만들 때 이 문장을 줄이지 않았다", () => {
    for (const key of CUSTOMER_KEYS) {
      const v = renderVariants(key, CUSTOMER);
      expect(hex(v.sms), `${key}.sms`).toContain(hex(VERBATIM.bookingNotice));
      expect(hex(v.lms), `${key}.lms`).toContain(hex(VERBATIM.bookingNotice));
    }
  });

  test("변수 치환 뒤에도 verbatim 은 그대로다 — 값이 무엇이든", () => {
    const odd: CustomerVars[] = [
      { publicCode: "", origin: "" },
      { publicCode: "사장님 확정 후", origin: "https://example.test/a?b=c&d=e" },
      { publicCode: "A".repeat(200), origin: ORIGIN },
    ];
    for (const vars of odd) {
      for (const key of CUSTOMER_KEYS) {
        expect(hex(renderTemplate(key, vars).text), `${key} / ${vars.publicCode.slice(0, 12)}`).toContain(hex(VERBATIM.bookingNotice));
      }
    }
  });

  /**
   * 확정 문자의 배치 잠금. verbatim 은 한 글자도 못 고치므로 **주변을 고쳤다**:
   * "예약이 확정되었습니다" 바로 뒤에 "사장님 확정 후 연락드리며" 가 붙으면 아직 확정 전인 것처럼 읽힌다.
   * 확정 선언은 맨 위, verbatim 은 맨 아래(사이트 카드의 상시 고지 자리와 같은 위치)여야 한다.
   */
  test("확정 문자 — verbatim 은 마지막 줄이고, 그 바로 앞 문장은 확정 선언이 아니다", () => {
    for (const variant of ["sms", "lms"] as const) {
      const text = renderVariants("confirmed.customer.sms", CUSTOMER)[variant];
      const rows = text.split("\n").filter((l) => l.trim().length > 0);
      expect(rows[rows.length - 1], `${variant}: verbatim 이 마지막 줄이 아니다`).toBe(VERBATIM.bookingNotice);
      const before = rows[rows.length - 2];
      expect(before, `${variant}: verbatim 앞이 확정 선언이다`).not.toContain(CONFIRMED_HEADLINE);
      expect(before, `${variant}: verbatim 앞 문장이 없다`).toBeTruthy();
    }
  });

  test("확정 문자 — 확정 사실은 맨 첫 줄에 있다 (일어난 일 → 앞으로 할 일 → 상시 고지)", () => {
    const lms = renderVariants("confirmed.customer.sms", CUSTOMER).lms;
    const rows = lms.split("\n").filter((l) => l.trim().length > 0);
    expect(rows[0]).toContain(CONFIRMED_HEADLINE);
    expect(rows[0]).toContain(`[${COMPANY.brandName}]`);
    // 확정 선언과 verbatim 사이에 "앞으로 할 일"이 실제로 들어 있다 — 두 문장이 이웃하지 않는다.
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(lms.indexOf(PAYMENT.line)).toBeGreaterThan(lms.indexOf(CONFIRMED_HEADLINE));
    expect(lms.indexOf(VERBATIM.bookingNotice)).toBeGreaterThan(lms.indexOf(PAYMENT.line));
  });

  test("사장님 템플릿에는 verbatim 을 넣지 않는다 — 사장님에게 '사장님 확정 후' 라고 보내지 않는다", () => {
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

  test("LMS 상한을 넘기면 조용히 자르지 않고 throw 한다 — verbatim 을 잘라 보내는 일은 없다", () => {
    expect(() => renderTemplate("created.customer.sms", { publicCode: "A".repeat(LMS_BYTE_LIMIT), origin: ORIGIN })).toThrow(/LMS/);
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
  test("사장님 접수 알림 — 접수번호·성명(마스킹 안 함)·연락처·차량·운행일·구간·인원·관리자 링크가 전부 있다", () => {
    for (const key of OWNER_KEYS) {
      const text = renderTemplate(key, OWNER).text;
      for (const needle of [
        OWNER.publicCode,
        OWNER.name,
        OWNER.phone,
        OWNER.vehicleLabel,
        OWNER.departAtKst,
        OWNER.originLabel,
        OWNER.destinationLabel,
        String(OWNER.busCount),
        String(OWNER.passengers),
        `${ORIGIN}${ADMIN_RESERVATIONS_PATH}/${OWNER.reservationId}`,
      ]) {
        expect(text, `${key} 에 ${needle} 가 없다`).toContain(needle);
      }
      // 마스킹하지 않는다 — 사장님은 전화를 걸어야 한다.
      expect(text, key).not.toContain("*");
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

  // P1-7 — 손님에게 전화하라고 안내하는 번호는 예약·상담 전화(COMPANY.consultTel)다. 대표전화(COMPANY.tel)는 문자에 쓰지 않는다.
  test("고객 접수 확인 — 접수번호 · 예약확인 경로 · 예약·상담 전화가 있다", () => {
    const text = renderTemplate("created.customer.sms", CUSTOMER).text;
    expect(text).toContain(CUSTOMER.publicCode);
    expect(text).toContain(`${ORIGIN}${RESERVATION_CHECK_PATH}`);
    expect(text).toContain(COMPANY.consultTel);
    expect(text).not.toContain(COMPANY.tel);
  });

  test("고객 확정 안내 — 접수번호 · 확정 사실 · 원장 PAYMENT 문안. 결제 문구를 지어내지 않았다", () => {
    const text = renderTemplate("confirmed.customer.sms", CUSTOMER).text;
    expect(text).toContain(CUSTOMER.publicCode);
    expect(text).toContain(PAYMENT.line);
    expect(text).toContain(COMPANY.consultTel);
    expect(text).not.toContain(COMPANY.tel);
  });

  // P1-7 R2 [P1-4] — 약관 제8조: "회사는 이 사실을 견적 신청 화면과 **예약 확정 통지**에 고지합니다."
  test("확정 통지 — 취소·환불 줄 · 청약철회 줄 · 입금 계좌 줄 · 이용안내 링크가 결제 안내 다음, verbatim 앞에 있다 (두 판 모두)", () => {
    const guide = `${ORIGIN}${GUIDE_PATH}`;
    for (const variant of ["sms", "lms"] as const) {
      const text = renderVariants("confirmed.customer.sms", CUSTOMER)[variant];
      const at = (s: string) => text.indexOf(s);
      for (const s of [CANCELLATION.smsLine, WITHDRAWAL.smsLine, PAYMENT.accountLine, guide]) expect(at(s), `${variant}: ${s}`).toBeGreaterThan(-1);
      expect(at(PAYMENT.line), variant).toBeLessThan(at(CANCELLATION.smsLine));
      expect(at(CANCELLATION.smsLine), variant).toBeLessThan(at(WITHDRAWAL.smsLine));
      expect(at(WITHDRAWAL.smsLine), variant).toBeLessThan(at(PAYMENT.accountLine));
      expect(at(PAYMENT.accountLine), variant).toBeLessThan(at(guide));
      expect(at(guide), variant).toBeLessThan(at(VERBATIM.bookingNotice));
    }
  });

  test("확정 통지는 LMS 로만 나간다 — 고지를 빼서 SMS(90바이트)에 맞추지 않았다", () => {
    const r = renderTemplate("confirmed.customer.sms", CUSTOMER);
    expect(r.format).toBe("lms");
    for (const s of [CANCELLATION.smsLine, WITHDRAWAL.smsLine, PAYMENT.accountLine]) expect(r.text).toContain(s);
    expect(utf8ByteLength(renderVariants("confirmed.customer.sms", CUSTOMER).sms)).toBeGreaterThan(SMS_BYTE_LIMIT);
  });

  test("접수 통지(고객)는 바꾸지 않는다 — 아직 계약 전이라 취소·청약철회·계좌 줄이 없다", () => {
    for (const variant of ["sms", "lms"] as const) {
      const text = renderVariants("created.customer.sms", CUSTOMER)[variant];
      for (const s of [CANCELLATION.smsLine, WITHDRAWAL.smsLine, PAYMENT.accountLine]) expect(text.includes(s), `${variant}: ${s}`).toBe(false);
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
    // "휴대폰 뒷 4자리" 의 4 는 조회 화면(messages/ko.json reservationCheck.form.phoneLast4Label)과 같은 말이라
    // 주장이 아니라 조작 안내다 — CLAIM_NUMBERS 의 단위(건·명·년·대·원·%)에 걸리지 않는다.
    for (const key of CUSTOMER_KEYS) {
      // P1-7 R2 — 확정 통지의 원장 줄(취소·환불 · 청약철회 · 입금 계좌)도 원장에서 온 것이라 걷어낸다.
      let withoutSources = renderTemplate(key, CUSTOMER).text;
      for (const source of [PAYMENT.line, CANCELLATION.smsLine, WITHDRAWAL.smsLine, PAYMENT.accountLine, COMPANY.consultTel, CUSTOMER.publicCode]) {
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
    expect(bare, "대표전화 리터럴").not.toContain(COMPANY.tel);
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

  test("알림톡도 verbatim 을 바이트 그대로 갖는다", () => {
    for (const t of ALIMTALK_TEMPLATES) expect(hex(t.body), t.event).toContain(hex(VERBATIM.bookingNotice));
  });

  test("확정 알림톡도 문자와 같은 순서다 — verbatim 이 마지막이고 그 앞은 확정 선언이 아니다", () => {
    const confirmed = ALIMTALK_TEMPLATES.find((t) => t.event === "confirmed");
    expect(confirmed).toBeTruthy();
    const rows = (confirmed as { body: string }).body.split("\n").filter((l) => l.trim().length > 0);
    expect(rows[rows.length - 1]).toBe(VERBATIM.bookingNotice);
    expect(rows[rows.length - 2]).not.toContain(CONFIRMED_HEADLINE);
    expect(rows[0]).toContain(CONFIRMED_HEADLINE);
  });

  // P1-7 R2 [P1-4] — 알림톡 초안에도 확정 통지의 고지 줄을 넣는다. 전화 자리 이름은 `#{상담전화}`(심사 전이라 바꿀 수 있다).
  test("확정 알림톡 — 취소·환불 · 청약철회 · 입금 계좌 줄이 결제 안내 다음, verbatim 앞에 있다 · 접수 알림톡에는 없다", () => {
    const confirmed = ALIMTALK_TEMPLATES.find((t) => t.event === "confirmed")?.body ?? "";
    const at = (s: string) => confirmed.indexOf(s);
    expect(at(PAYMENT.line)).toBeGreaterThan(-1);
    expect(at(PAYMENT.line)).toBeLessThan(at(CANCELLATION.smsLine));
    expect(at(CANCELLATION.smsLine)).toBeLessThan(at(WITHDRAWAL.smsLine));
    expect(at(WITHDRAWAL.smsLine)).toBeLessThan(at(PAYMENT.accountLine));
    expect(at(PAYMENT.accountLine)).toBeLessThan(at(VERBATIM.bookingNotice));
    const created = ALIMTALK_TEMPLATES.find((t) => t.event === "created")?.body ?? "";
    for (const s of [CANCELLATION.smsLine, WITHDRAWAL.smsLine, PAYMENT.accountLine]) expect(created.includes(s), s).toBe(false);
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

  test("renderAlimtalk — 변수를 치환해도 verbatim 이 남고, 미치환 자리는 throw 한다", () => {
    const values = { 접수번호: "BT12ABCD", 상담전화: COMPANY.consultTel };
    for (const t of ALIMTALK_TEMPLATES) {
      const out = renderAlimtalk(t.event, values);
      expect(out).not.toMatch(/#\{/);
      expect(hex(out), t.event).toContain(hex(VERBATIM.bookingNotice));
      expect(out).toContain("BT12ABCD");
    }
    expect(() => renderAlimtalk("created", {})).toThrow();
  });

  test("알림톡 본문은 1,000자 이하다 (카카오 심사 상한)", () => {
    for (const t of ALIMTALK_TEMPLATES) expect(t.body.length, t.event).toBeLessThanOrEqual(1000);
  });
});
