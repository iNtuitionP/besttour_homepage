/**
 * P3-8 — 홈 간편 견적(위젯 → 모달 → 접수) 계약 테스트. 6단계 위저드(tests/quote-wizard.test.ts — 삭제)의 자리를 잇는다.
 *
 * vitest 는 node 환경이다(DOM 패키지 없음). 그래서
 *   (1) 순수 로직(components/quote/quick-quote.ts — 위젯 검증·도착일 채우기·연락처 한 칸 → phone XOR phoneIntl·요약 날짜),
 *   (2) 컴포넌트는 react-dom/server 의 renderToStaticMarkup 으로 **첫 화면**(모달 열림 상태 포함)을 검사하고,
 *   (3) 소스 정적 검사(원장 import·문구 리터럴 0·사전 체크 0·마케팅 체크박스 0·필드명 1:1·경계)
 * 를 잠근다. 포커스 가둠·ESC·포커스 복귀·스크롤 잠금·실제 제출은 브라우저 실측(보고서 §8)으로 확인한다.
 *
 * 옛 위저드 테스트에서 옮긴 성질(보고서 ③ 표): 제출 게이트(토큰/사이트키 > 동의 > 제출 중) · 폼 토큰 fail-closed ·
 * 동의 사전 선택 0 · 원장 문구 리터럴 0 · 클라이언트는 원장을 import 하지 않음 · 금지어 0 · 가격 0 · useActionState (_prev, fd) 래퍼 ·
 * 서버 오류 문구에 {tel} 보간 · 허니팟 속성 · 필드명 1:1 · 클라이언트 번들 위생 · 휴대폰 패턴 원본 동일.
 *
 * 주의: tests/ 아래라 세 게이트(check-no-pricing · check-legal-disclosures · check-temp-values)의 검사 대상이다.
 * 금지어 리터럴은 코드포인트로 조립한다(tests/home.test.ts 규약).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
// 서버액션 두 개 — 렌더 테스트는 부르지 않는다(첫 화면만 본다). 'use server' 파일이 next/headers 를 끌어오지 않게 바꿔치기.
vi.mock("@/actions/reservation", () => ({ submitReservation: vi.fn() }));
vi.mock("@/actions/quote-form-token", () => ({ requestQuoteFormToken: vi.fn(async () => null) }));
// next-intl 의 Link 는 라우터 컨텍스트가 필요하다 — 첫 화면 검사에는 평범한 <a> 로 충분하다.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("next/script", () => ({ default: () => null }));

import { QuoteWidget } from "@/components/home/QuoteWidget";
import type { ConsentText } from "@/components/quote/ConsentBlock";
import { F, G } from "@/components/quote/fields";
import { FORM_TOKEN_UNAVAILABLE_EVENT, issueQuoteFormToken } from "@/components/quote/form-token";
import {
  dateSpan,
  formatKrPhone,
  formatPhoneInput,
  inertBackground,
  initialWidgetFields,
  isCalendarDate,
  isWidgetField,
  needsFreshFormToken,
  modalFieldOf,
  NAME_MAX_LENGTH,
  PASSENGERS_RANGE,
  PHONE_INTL_INPUT_PATTERN,
  PHONE_KR_INPUT_PATTERN,
  splitPhone,
  validateContact,
  validateWidget,
  withDepartDate,
  type WidgetFields,
} from "@/components/quote/quick-quote";
import { QuickQuoteDone, QuickQuoteForm, QuickQuoteModal } from "@/components/quote/QuickQuoteModal";
import { isIntakeReady, submitBlock } from "@/components/quote/submit-gate";
import { consultPhone } from "@/lib/contact-phone";
import { verifyFormToken } from "@/lib/guard/timetrap";
import { LEDGER_UI_KO } from "@/lib/i18n/ledger-ui";
import { CANCELLATION, LEGAL_LINKS, PAYMENT, PRIVACY_NOTICE, QUOTE_BASIS, VERBATIM, WITHDRAWAL } from "@/lib/legal/disclosures";
import { GUARD_FORM_FIELDS, RESERVATION_FORM_FIELDS } from "@/lib/reservations/formData";
import {
  NAME_MAX_LENGTH as SERVER_NAME_MAX,
  PASSENGERS_RANGE as SERVER_PASSENGERS,
  PHONE_INTL_PATTERN,
  PHONE_KR_PATTERN,
  isCalendarDate as serverIsCalendarDate,
} from "@/lib/types";

import { FORBIDDEN_WORDS } from "./helpers/forbidden-copy";
import { stripComments } from "./helpers/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const ko = JSON.parse(read("messages/ko.json")) as Record<string, unknown>;
const en = JSON.parse(read("messages/en.json")) as Record<string, unknown>;

const QUOTE_DIR = "components/quote";
const WIDGET = "components/home/QuoteWidget.tsx";
const HERO = "components/home/Hero.tsx";
const MODAL = `${QUOTE_DIR}/QuickQuoteModal.tsx`;
const TOKEN_ACTION = "actions/quote-form-token.ts";
const HOME_PAGE = "app/[locale]/(site)/page.tsx";

function walk(absDir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(absDir)) {
    const p = path.join(absDir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const toPosix = (p: string) => p.split(path.sep).join("/");
const quoteFiles = walk(path.join(ROOT, QUOTE_DIR)).map((p) => toPosix(path.relative(ROOT, p)));
const quoteTsx = quoteFiles.filter((f) => f.endsWith(".tsx"));
const intakeFiles = [...quoteFiles.filter((f) => /\.tsx?$/.test(f)), WIDGET, HERO, TOKEN_ACTION];
const intakeSources = intakeFiles.map((file) => ({ file, text: read(file), code: codeOf(file) }));

function ledgerImports(src: string): string[] {
  const names: string[] = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/legal\/disclosures["']/g)) {
    for (const raw of m[1].split(",")) {
      const n = raw.trim().split(/\s+as\s+/)[0].trim();
      if (n) names.push(n);
    }
  }
  return names;
}

// ── 금지어 — 목록은 lib/copy/rules.ts 한 곳(테스트 입구 ./helpers/forbidden-copy). 새 사본을 만들지 않는다(tests/admin-copy-warning.test.ts). ──
const PRICE_MARKS = [/\d\s*만\s*원/, /₩/, /\bKRW\b/, /priceFrom/, /price_from/];
/** "1분 만에" 같은 측정되지 않은 소요시간 주장(CLAUDE.md §3 실증 불가 수치). */
const DURATION_CLAIM = /\d+\s*(분|초)\s*(만에|안에|이내)/;

const SECRET = "unit-test-guard-secret-0123456789abcdef0123456789abcdef";
const TODAY = "2026-09-13";
const FIELDS: WidgetFields = { originCode: "ICN", destinationCode: "SEL", departDate: "2026-10-01", returnDate: "2026-10-03", passengers: "30" };

// =============================================================================
// 1. 순수 — 위젯 검증 · 도착일 채우기 · 연락처 한 칸
// =============================================================================
describe("1. 위젯 검증 — 빈 칸이면 그 자리에서 안내(모달을 열지 않는다)", () => {
  test("유효 → 오류 0 (= 모달을 연다)", () => {
    expect(validateWidget(FIELDS, TODAY)).toEqual([]);
  });

  test("빈 위젯 → 날짜 둘·인원 오류, messageKey 는 home.hero.widget.errors.* 절대 키", () => {
    const errs = validateWidget({ ...FIELDS, departDate: "", returnDate: "", passengers: "" }, TODAY);
    expect(errs.map((e) => e.field)).toEqual(["departDate", "returnDate", "passengers"]);
    for (const e of errs) expect(e.messageKey).toMatch(/^home\.hero\.widget\.errors\./);
  });

  test("과거 출발일 → departPast · 오늘은 통과 · 도착일 < 출발일 → returnBefore · 같은 날 통과", () => {
    expect(validateWidget({ ...FIELDS, departDate: "2026-09-12", returnDate: "2026-09-12" }, TODAY)).toEqual([
      { field: "departDate", messageKey: "home.hero.widget.errors.departPast" },
    ]);
    expect(validateWidget({ ...FIELDS, departDate: TODAY, returnDate: TODAY }, TODAY)).toEqual([]);
    expect(validateWidget({ ...FIELDS, returnDate: "2026-09-30" }, TODAY)).toEqual([
      { field: "returnDate", messageKey: "home.hero.widget.errors.returnBefore" },
    ]);
  });

  test("달력에 없는 날짜 · 모르는 장소 코드 · 인원 0/901/소수/문자 → 각 칸 오류", () => {
    expect(validateWidget({ ...FIELDS, departDate: "2026-02-30" }, TODAY).map((e) => e.field)).toContain("departDate");
    expect(validateWidget({ ...FIELDS, originCode: "XXX", destinationCode: "" }, TODAY).map((e) => e.field)).toEqual(["originCode", "destinationCode"]);
    for (const passengers of ["0", "901", "1.5", "abc", "-3"]) {
      expect(validateWidget({ ...FIELDS, passengers }, TODAY), passengers).toEqual([{ field: "passengers", messageKey: "home.hero.widget.errors.pax" }]);
    }
  });

  test("출발일을 고르면 도착일이 같은 날로 채워진다 — 비었거나 앞일 때만(뒤 날짜는 지키기)", () => {
    const empty = { ...FIELDS, departDate: "", returnDate: "" };
    expect(withDepartDate(empty, "2026-10-05").returnDate).toBe("2026-10-05");
    expect(withDepartDate({ ...FIELDS, returnDate: "2026-10-02" }, "2026-10-04").returnDate).toBe("2026-10-04");
    expect(withDepartDate({ ...FIELDS, returnDate: "2026-10-09" }, "2026-10-04").returnDate).toBe("2026-10-09");
  });

  test("dateSpan — 같은 날은 하나(당일), 다르면 범위", () => {
    expect(dateSpan({ departDate: "2026-10-01", returnDate: "2026-10-01" })).toEqual({ kind: "single", date: "2026-10-01" });
    expect(dateSpan({ departDate: "2026-10-01", returnDate: "2026-10-03" })).toEqual({ kind: "range", from: "2026-10-01", to: "2026-10-03" });
  });

  test("서버 규칙과 같은 값 — 이름 30 · 인원 1~900 · 휴대폰 패턴 소스 · 달력 판정", () => {
    expect(NAME_MAX_LENGTH).toBe(SERVER_NAME_MAX);
    expect(PASSENGERS_RANGE).toEqual(SERVER_PASSENGERS);
    expect(PHONE_KR_INPUT_PATTERN.source).toBe(PHONE_KR_PATTERN.source);
    expect(PHONE_INTL_INPUT_PATTERN.source).toBe(PHONE_INTL_PATTERN.source);
    for (const d of ["2026-02-28", "2026-02-29", "2028-02-29", "2026-13-01", "2026-9-1", "2026-04-31"]) {
      expect(isCalendarDate(d), d).toBe(serverIsCalendarDate(d));
    }
  });
});

describe("2. 연락처 — 한 칸에서 `+` 로 시작하면 해외(phoneIntl), 아니면 국내(phone) · XOR", () => {
  test("splitPhone — 정확히 하나만 값이 있다", () => {
    expect(splitPhone("010-1234-5678")).toEqual({ phone: "010-1234-5678", phoneIntl: "" });
    expect(splitPhone(" +1 555 123 4567 ")).toEqual({ phone: "", phoneIntl: "+15551234567" });
    expect(splitPhone("")).toEqual({ phone: "", phoneIntl: "" });
  });

  test("formatPhoneInput — 국내는 3-4-4 자동 하이픈(11자리 절단), 해외는 + 와 숫자만", () => {
    expect(formatPhoneInput("01012345678")).toBe("010-1234-5678");
    expect(formatPhoneInput("010123456789999")).toBe("010-1234-5678");
    expect(formatPhoneInput("+82 10-1234")).toBe("+82101234");
    expect(formatKrPhone("0101234")).toBe("010-1234");
  });

  test("validateContact — 이름 1~30 · 국내/해외 형식, messageKey 는 quote.modal.errors.*", () => {
    expect(validateContact({ name: "홍길동", phone: "010-1234-5678" })).toEqual([]);
    expect(validateContact({ name: "Kim", phone: "+15551234567" })).toEqual([]);
    expect(validateContact({ name: " ", phone: "010-1234" })).toEqual([
      { field: "name", messageKey: "quote.modal.errors.name" },
      { field: "phone", messageKey: "quote.modal.errors.phone" },
    ]);
    expect(validateContact({ name: "가".repeat(31), phone: "+1" })).toEqual([
      { field: "name", messageKey: "quote.modal.errors.name" },
      { field: "phone", messageKey: "quote.modal.errors.phoneIntl" },
    ]);
  });

  test("서버 fieldErrors 키 분배 — 위젯 칸은 위젯으로, phoneIntl 은 모달의 한 칸(phone)으로", () => {
    for (const f of ["originCode", "destinationCode", "departDate", "returnDate", "passengers"]) expect(isWidgetField(f), f).toBe(true);
    for (const f of ["name", "phone", "phoneIntl", "privacyConsent", "withdrawalConsent"]) expect(isWidgetField(f), f).toBe(false);
    expect(modalFieldOf("phoneIntl")).toBe("phone");
    expect(modalFieldOf("name")).toBe("name");
  });
});

// =============================================================================
// 3. 제출 게이트 · 폼 토큰 (옛 위저드에서 옮김)
// =============================================================================
describe("3. 제출 게이트 · 폼 토큰 fail-closed", () => {
  test("submitBlock — 토큰/사이트키 없음 > 동의 없음 > 제출 중 > null", () => {
    const base = { formToken: "1.abc", siteKey: "site", privacyConsent: true, withdrawalConsent: true, pending: false };
    expect(submitBlock(base)).toBeNull();
    expect(submitBlock({ ...base, formToken: null })).toBe("not-ready");
    expect(submitBlock({ ...base, siteKey: "" })).toBe("not-ready");
    expect(submitBlock({ ...base, privacyConsent: false })).toBe("consent");
    expect(submitBlock({ ...base, withdrawalConsent: false })).toBe("consent");
    expect(submitBlock({ ...base, pending: true })).toBe("pending");
    expect(isIntakeReady("tok", "key")).toBe(true);
    expect(isIntakeReady(null, "key")).toBe(false);
  });

  describe("issueQuoteFormToken — env 없이도 죽지 않는다", () => {
    let saved: string | undefined;
    beforeEach(() => {
      saved = process.env.GUARD_SECRET;
    });
    afterEach(() => {
      if (saved === undefined) delete process.env.GUARD_SECRET;
      else process.env.GUARD_SECRET = saved;
    });

    test("시크릿 없음 → throw 0 · null · structuredLog 1건 · 시크릿 값 없음", () => {
      delete process.env.GUARD_SECRET;
      const log = vi.fn();
      expect(issueQuoteFormToken(new Date(), log)).toBeNull();
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toMatchObject({ level: "error", event: FORM_TOKEN_UNAVAILABLE_EVENT });
    });

    test("시크릿 있음 → 서명된 토큰, 4초 뒤 verifyFormToken 통과", () => {
      process.env.GUARD_SECRET = SECRET;
      const now = new Date("2026-09-13T00:00:00Z");
      const token = issueQuoteFormToken(now, vi.fn());
      expect(verifyFormToken(token, new Date(now.getTime() + 4_000), SECRET)).toEqual({ ok: true });
    });
  });

  test("토큰 서버액션 파일 — 'use server' 첫 줄 · export 는 async 함수 하나 · issueQuoteFormToken 재사용 · process.env 0", () => {
    const src = read(TOKEN_ACTION);
    expect(src.split("\n")[0]).toMatch(/^["']use server["'];$/);
    const exportLines = src.split("\n").filter((l) => /^\s*export\b/.test(l));
    expect(exportLines).toHaveLength(1);
    expect(exportLines[0]).toMatch(/^export async function requestQuoteFormToken\(\): Promise<string \| null>/);
    const code = codeOf(TOKEN_ACTION);
    expect(code).toMatch(/issueQuoteFormToken\(\)/);
    expect(code).not.toMatch(/process\.env/);
  });
});

// =============================================================================
// 4. 렌더 — 위젯(닫힘) · 모달(열림) · 폼 · 완료
// =============================================================================
const tel = consultPhone("ko");
const CONSENT: ConsentText = {
  title: LEDGER_UI_KO.headings.privacyNotice,
  purpose: PRIVACY_NOTICE.purpose,
  itemsLine: PRIVACY_NOTICE.itemsLine,
  retention: PRIVACY_NOTICE.retention,
  retentionSummary: PRIVACY_NOTICE.retentionSummary, // P7-3 — 접힌 줄의 보유 기간 요약(강조)
  refusal: PRIVACY_NOTICE.refusal,
  consentLabel: LEDGER_UI_KO.consent.privacy,
  publicFeedNotice: PRIVACY_NOTICE.publicFeedNotice,
  privacyHref: LEGAL_LINKS.privacy,
  summaryEn: null, // P7-3 리뷰 — en 전용 영문 요약(ko 는 null)
  officialNotice: null,
};
const LEGAL = {
  consent: CONSENT,
  withdrawalNotice: createElement("aside", { "data-legal": "withdrawal-notice" }, WITHDRAWAL.notice),
  withdrawalConsentLabel: LEDGER_UI_KO.consent.withdrawal,
  bookingNotice: VERBATIM.bookingNotice,
  tel,
};
const PLACE_LABELS = { origin: "인천공항", dest: "서울" };

function withIntl(node: ReactNode): string {
  const providerProps = { locale: "ko", messages: ko, timeZone: "Asia/Seoul" } as unknown as Parameters<typeof NextIntlClientProvider>[0];
  return renderToStaticMarkup(createElement(NextIntlClientProvider, providerProps, node));
}
function renderForm(formToken: string | null | undefined, siteKey = "site-key"): string {
  return withIntl(
    createElement(QuickQuoteForm, {
      fields: FIELDS,
      placeLabels: PLACE_LABELS,
      locale: "ko",
      legal: LEGAL,
      formToken,
      turnstileSiteKey: siteKey,
      turnstileAction: "reserve",
      onEdit: () => {},
      onDone: () => {},
      onWidgetErrors: () => {},
      onStaleToken: () => {},
      titleId: "qq-title",
    }),
  );
}

describe("4. 렌더 — 모달 열림 조건 · 요약 · 동의 · verbatim · fail-closed", () => {
  test("위젯 첫 화면 — id=\"quote\" 앵커 · 다섯 칸 · [견적 신청하기] 버튼 · 모달은 닫혀 있다(role=dialog 0)", () => {
    const html = withIntl(
      createElement(QuoteWidget, {
        labels: {
          widget: "W",
          title: "T",
          sub: "S",
          origin: "O",
          dest: "D",
          date: "DD",
          returnDate: "RD",
          pax: "P",
          cta: "견적 신청하기",
        },
        groups: [{ label: "G", options: [{ value: "ICN", label: "인천공항" }, { value: "SEL", label: "서울" }] }],
        defaults: { origin: "ICN", dest: "SEL" },
        locale: "ko",
        legal: LEGAL,
        turnstileSiteKey: "site-key",
        turnstileAction: "reserve",
      }),
    );
    expect(html).toMatch(/id="quote"/);
    for (const id of ["quote-origin", "quote-dest", "quote-date", "quote-return", "quote-pax"]) expect(html, id).toContain(`data-testid="${id}"`);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*data-testid="quote-cta"/);
    expect(html).not.toMatch(/role="dialog"/);
    // 위젯은 더 이상 /quote 로 링크하지 않는다
    expect(html).not.toMatch(/href="\/quote/);
    // T2-2(2026-10-10, 사장님 요청 7 · 결정 3-2): 위젯 하단의 결제 안내·verbatim 두 줄을 걷었다 — 닫힌 위젯에는 verbatim 이 없다.
    // verbatim 은 모달 제출 버튼 위·완료 화면에 있다(아래 모달 렌더 단언 · tests/quote-disclosure.test.ts).
    expect(html).not.toContain(VERBATIM.bookingNotice);
    expect(html).not.toContain('data-legal="booking-notice"');
    // 사장님 요청 12(2026-10-10 · T1-1): 출발지가 인천공항(기본값)이어도 "공항 … 노선입니다" 안내 줄이 없다.
    expect(html).toMatch(/<option value="ICN" selected="">/);
    expect(html).not.toContain('data-testid="quote-air"');
  });

  test("모달(열림) — role=dialog · aria-modal · aria-labelledby → 제목 '이 내용으로 견적 신청하기' · 닫기 버튼", () => {
    const html = withIntl(
      createElement(QuickQuoteModal, {
        open: true,
        onClose: () => {},
        onEdit: () => {},
        onWidgetErrors: () => {},
        onSubmitted: () => {},
        fields: FIELDS,
        placeLabels: PLACE_LABELS,
        locale: "ko",
        legal: LEGAL,
        turnstileSiteKey: "site-key",
        turnstileAction: "reserve",
      }),
    );
    const dialog = html.match(/<div[^>]*role="dialog"[^>]*>/)?.[0] ?? "";
    expect(dialog).toMatch(/aria-modal="true"/);
    const labelledby = dialog.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(labelledby).toBeTruthy();
    const title = html.match(new RegExp(`<h2[^>]*id="${labelledby}"[^>]*>([^<]*)</h2>`))?.[1];
    expect(title).toBe((ko.quote as { modal: { title: string } }).modal.title);
    expect(title).toBe("이 내용으로 견적 신청하기");
    expect(html).toContain('data-testid="quick-quote-close"');
  });

  test("모달(닫힘) → 아무것도 그리지 않는다", () => {
    const html = withIntl(
      createElement(QuickQuoteModal, {
        open: false,
        onClose: () => {},
        onEdit: () => {},
        onWidgetErrors: () => {},
        onSubmitted: () => {},
        fields: FIELDS,
        placeLabels: PLACE_LABELS,
        locale: "ko",
        legal: LEGAL,
        turnstileSiteKey: "site-key",
        turnstileAction: "reserve",
      }),
    );
    expect(html).toBe("");
  });

  test("요약 — 출발→도착 라벨 · 날짜(범위) · 인원 · [수정]", () => {
    // P7-4: 요약의 날짜는 공개 화면 공용 틀(lib/public-date.ts · 카탈로그 common.dates) — "10월 1일 (목)", 원문 YYYY-MM-DD 0.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T03:00:00.000Z"));
    try {
      const html = renderForm("1.tok");
      const summary = html.match(/<dl[^>]*data-testid="quick-quote-summary"[\s\S]*?<\/dl>/)?.[0] ?? "";
      expect(summary).toContain("인천공항");
      expect(summary).toContain("서울");
      expect(summary).toContain("10월 1일 (목)");
      expect(summary).toContain("10월 3일 (토)");
      expect(summary).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(summary).toContain("30");
      expect(html).toMatch(/<button[^>]*data-testid="quick-quote-edit"/);
    } finally {
      vi.useRealTimers();
    }
  });

  test("이름·연락처 칸 · 동의 2종 체크박스는 기본 해제 · 마케팅 체크박스 없음 · verbatim 원문 · 청약철회 고지", () => {
    const html = renderForm("1.tok");
    expect(html).toMatch(/<input[^>]*name="name"/);
    expect(html).toMatch(/<input[^>]*data-testid="quick-quote-phone"/);
    const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(boxes).toHaveLength(2);
    for (const b of boxes) expect(b).not.toMatch(/\schecked/);
    expect(html).toMatch(/name="privacyConsent"/);
    expect(html).toMatch(/name="withdrawalConsent"/);
    expect(html).not.toMatch(/marketingConsent|consent-marketing/);
    expect(html).not.toContain(PRIVACY_NOTICE.marketingConsentLabel);
    expect(html).toContain(VERBATIM.bookingNotice);
    expect(html).toContain(PRIVACY_NOTICE.itemsLine);
    expect(html).toContain('data-legal="withdrawal-notice"');
    expect(html).toContain(LEDGER_UI_KO.consent.withdrawal);
  });

  test("필수 미체크 → 제출 disabled(data-block=consent) · 동의 안내", () => {
    const html = renderForm("1.tok");
    const submit = html.match(/<button[^>]*data-testid="quick-quote-submit"[^>]*>/)?.[0] ?? "";
    expect(submit).toMatch(/disabled=""/);
    expect(submit).toMatch(/data-block="consent"/);
  });

  test("토큰 null(시크릿 없음) → '접수 준비 중' + 전화 · 제출 disabled(not-ready) · Turnstile 없음", () => {
    const html = renderForm(null);
    expect(html).toContain('data-testid="quick-quote-not-ready"');
    expect(html).toContain(tel.display);
    const submit = html.match(/<button[^>]*data-testid="quick-quote-submit"[^>]*>/)?.[0] ?? "";
    expect(submit).toMatch(/disabled=""/);
    expect(submit).toMatch(/data-block="not-ready"/);
    expect(html).not.toContain('data-testid="turnstile"');
  });

  test("사이트키 없음 → 역시 not-ready (fail-closed)", () => {
    const html = renderForm("1.tok", "");
    expect(html).toContain('data-testid="quick-quote-not-ready"');
  });

  test("토큰 받는 중(undefined) → 제출 disabled · Turnstile 아직 없음", () => {
    const html = renderForm(undefined);
    const submit = html.match(/<button[^>]*data-testid="quick-quote-submit"[^>]*>/)?.[0] ?? "";
    expect(submit).toMatch(/disabled=""/);
    expect(html).not.toContain('data-testid="turnstile"');
  });

  test("숨은 필드 — 위젯 값이 계약 이름으로 실린다(locale·formToken·날짜·장소·인원) · 허니팟", () => {
    const html = renderForm("1.tok");
    const hidden = (name: string) => html.match(new RegExp(`<input[^>]*type="hidden"[^>]*name="${name}"[^>]*value="([^"]*)"`))?.[1] ??
      html.match(new RegExp(`<input[^>]*type="hidden"[^>]*value="([^"]*)"[^>]*name="${name}"`))?.[1];
    expect(hidden("locale")).toBe("ko");
    expect(hidden("formToken")).toBe("1.tok");
    expect(hidden("originCode")).toBe("ICN");
    expect(hidden("destinationCode")).toBe("SEL");
    expect(hidden("departDate")).toBe("2026-10-01");
    expect(hidden("returnDate")).toBe("2026-10-03");
    expect(hidden("passengers")).toBe("30");
    const hp = html.match(/<input[^>]*name="website"[^>]*>/)?.[0] ?? "";
    expect(hp).toMatch(/tabindex="-1"/);
    expect(hp).toMatch(/autoComplete="off"|autocomplete="off"/);
  });

  // T2-5(사장님 요청 1 · 결정 5, 2026-10-10): 완료 화면은 접수번호를 보이지 않는다 — 예약 확인은 휴대폰 번호 + 예약자 이름으로 한다.
  // 예전 두 단언(접수번호가 보인다 / 허니팟이면 번호 자리 대신 noCode)을 하나로 합쳤다 — 이제 진짜 접수와 허니팟의 화면이 같다.
  test("완료 화면 — 접수번호 없음 · '예약 확인에서 휴대폰 번호와 이름으로' 안내 · verbatim · 예약 확인 링크(/reservation/check) · 예약·상담 전화", () => {
    const html = withIntl(createElement(QuickQuoteDone, { bookingNotice: VERBATIM.bookingNotice, tel, onClose: () => {}, titleId: "t" }));
    expect(html).toContain('data-testid="quick-quote-check-hint"');
    expect(html).toContain("휴대폰 번호와 예약자 이름으로 확인하실 수 있습니다.");
    expect(html).not.toContain('data-testid="quick-quote-code"');
    expect(html).not.toContain('data-testid="quick-quote-nocode"');
    expect(html).not.toContain("접수번호");
    expect(html).toContain(VERBATIM.bookingNotice);
    expect(html).toMatch(/href="\/reservation\/check"/);
    expect(html).toContain(tel.href);
    expect(html).toContain(tel.display);
    // 완료 화면 컴포넌트는 접수번호를 받지 않는다(진짜 접수와 허니팟 가짜 성공의 화면이 같다)
    expect(codeOf("components/quote/QuickQuoteModal.tsx")).not.toMatch(/result\.publicCode|code=\{/);
  });
});

// =============================================================================
// 5. 정적 — 원장 · 리터럴 · 사전 체크 · 금지어 · 가격 · 경계 (옛 위저드에서 옮김)
// =============================================================================
describe("5. 정적 검사", () => {
  test("위저드 파일은 없다 — 페이지 2개 · 위저드 컴포넌트 · 상태·초안·프리필·프리뷰", () => {
    for (const f of [
      "app/[locale]/(site)/quote/page.tsx",
      "app/[locale]/(site)/quote/done/page.tsx",
      `${QUOTE_DIR}/QuoteWizard.tsx`,
      `${QUOTE_DIR}/Step1Purpose.tsx`,
      `${QUOTE_DIR}/Step6Contact.tsx`,
      `${QUOTE_DIR}/wizard-state.ts`,
      `${QUOTE_DIR}/draft.ts`,
      `${QUOTE_DIR}/prefill.ts`,
      `${QUOTE_DIR}/preview-submit.ts`,
      "components/home/quote-href.ts",
    ]) {
      expect(existsSync(path.join(ROOT, f)), f).toBe(false);
    }
  });

  test("Hero(서버)가 원장에서 동의·고지 문구를 읽어 props 로 내린다 — PRIVACY_NOTICE · VERBATIM · LEGAL_LINKS", () => {
    const names = ledgerImports(read(HERO));
    for (const n of ["PRIVACY_NOTICE", "VERBATIM", "LEGAL_LINKS"]) expect(names, n).toContain(n);
    const hero = codeOf(HERO);
    expect(hero).toMatch(/<WithdrawalNotice \/>/);
    expect(hero).toMatch(/consultPhone\(locale\)/);
    expect(hero).toMatch(/ledgerUi\(locale\)|ui\.consent\.withdrawal/);
    expect(hero).toMatch(/NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
    expect(hero).toMatch(/TURNSTILE_ACTION/);
    // 마케팅 동의 라벨은 내리지 않는다
    expect(hero).not.toMatch(/marketing/);
    // 청약철회 고지 서버 컴포넌트는 원장 4종을 직접 가져온다. verbatim 은 모달이 제출 바로 위에 한 번만 그린다(중복 0).
    const w = ledgerImports(read(`${QUOTE_DIR}/WithdrawalNotice.tsx`));
    for (const n of ["QUOTE_BASIS", "PAYMENT", "CANCELLATION", "WITHDRAWAL"]) expect(w, n).toContain(n);
    expect(w).not.toContain("VERBATIM");
  });

  test("클라이언트 파일은 원장을 import 하지 않는다 (법정 문구는 서버가 props 로)", () => {
    for (const f of [WIDGET, MODAL, `${QUOTE_DIR}/ConsentBlock.tsx`, `${QUOTE_DIR}/TurnstileWidget.tsx`]) expect(ledgerImports(read(f)), f).toEqual([]);
  });

  test("원장 문구 리터럴 0 — 코드·ko.json quote/home.hero 어디에도 법정 문장을 다시 쓰지 않았다", () => {
    const phrases = [
      VERBATIM.bookingNotice,
      QUOTE_BASIS.line,
      PAYMENT.line,
      CANCELLATION.referenceTime,
      // P7-3 — 접힌 줄에 새로 보이는 원장 문구(요약 · 범위 · 제한 한 줄 · 계약금 안내)도 복제하지 않는다
      CANCELLATION.scope,
      CANCELLATION.depositNote,
      PRIVACY_NOTICE.purpose,
      PRIVACY_NOTICE.itemsLine,
      PRIVACY_NOTICE.retention,
      PRIVACY_NOTICE.retentionSummary,
      PRIVACY_NOTICE.refusal,
      PRIVACY_NOTICE.consentLabel,
      PRIVACY_NOTICE.publicFeedNotice,
      WITHDRAWAL.notice,
      WITHDRAWAL.smsLine,
      WITHDRAWAL.consentLabel,
      // P7-3 후속 · 리뷰 — en 접힌 카드의 영문 요약(원장 WITHDRAWAL.summaryEn · PRIVACY_NOTICE.summaryEn)도 원장 밖에 다시 적지 않는다
      ...WITHDRAWAL.summaryEn.tiers,
      WITHDRAWAL.summaryEn.referenceTime,
      WITHDRAWAL.summaryEn.scope,
      WITHDRAWAL.summaryEn.restriction,
      ...Object.values(PRIVACY_NOTICE.summaryEn),
    ];
    const catalogs = JSON.stringify([ko.quote, (ko.home as Record<string, unknown>).hero, en.quote, (en.home as Record<string, unknown>).hero]);
    for (const { file, code } of intakeSources) for (const p of phrases) expect(code.includes(p), `${file}: ${p.slice(0, 20)}…`).toBe(false);
    for (const p of phrases) expect(catalogs.includes(p), `catalog: ${p.slice(0, 20)}…`).toBe(false);
  });

  test("동의 사전 선택 0 — defaultChecked · checked={true} 리터럴 없음 · localStorage/sessionStorage 0", () => {
    for (const { file, code } of intakeSources) {
      expect(/defaultChecked/.test(code), file).toBe(false);
      expect(/checked=\{?\s*true\s*\}?/.test(code), file).toBe(false);
      expect(/localStorage|sessionStorage/.test(code), file).toBe(false);
    }
  });

  test("금지어 0 · 가격 0 · 소요시간 주장 0 — 코드와 카탈로그(quote·home.hero, ko·en)", () => {
    const catalogs = JSON.stringify([ko.quote, (ko.home as Record<string, unknown>).hero, en.quote, (en.home as Record<string, unknown>).hero]);
    for (const { file, code } of intakeSources) {
      for (const w of FORBIDDEN_WORDS) expect(code.includes(w), `${file}: ${w}`).toBe(false);
      for (const re of PRICE_MARKS) expect(re.test(code), `${file}: ${re}`).toBe(false);
    }
    for (const w of FORBIDDEN_WORDS) expect(catalogs.includes(w), w).toBe(false);
    for (const re of PRICE_MARKS) expect(re.test(catalogs), String(re)).toBe(false);
    expect(DURATION_CLAIM.test(catalogs)).toBe(false);
  });

  test("useActionState — submitReservation 을 직접 넘기지 않고 (_prev, fd) 래퍼로 감싼다", () => {
    const src = codeOf(MODAL);
    expect(src).toMatch(/useActionState/);
    expect(src).not.toMatch(/useActionState(<[^>]*>)?\(\s*submitReservation/);
    expect(src).toMatch(/submitReservation\(\s*fd\s*\)/);
    expect(src).toMatch(/from\s+["']@\/actions\/reservation["']/);
    expect(src).toMatch(/from\s+["']@\/actions\/quote-form-token["']/);
  });

  test("서버 오류 문구를 풀 때 예약·상담 전화를 {tel} 보간 인자로 넘긴다", () => {
    expect(codeOf(MODAL)).toMatch(/\{\s*tel:\s*[a-zA-Z.]*tel\.display\s*\}/);
  });

  test("접근성 코드 — role=dialog · aria-modal · Escape · Tab 가둠 · 포커스 복귀 · 스크롤 잠금", () => {
    const src = codeOf(MODAL);
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/aria-modal="true"/);
    expect(src).toMatch(/"Escape"/);
    expect(src).toMatch(/"Tab"/);
    expect(src).toMatch(/lockDocumentScroll\(\)/); // 스크롤 잠금 — 문서 루트(P7-4 · lib/scroll-lock.ts)
    const widget = codeOf(WIDGET);
    expect(widget).toMatch(/\.focus\(/);
  });

  // P7-3: MoreToggle("자세히 보기" 토글)이 더해졌다 — 서버 WithdrawalNotice 가 전문을 children 으로 넘기는 작은 경계다(원장 import 0 · tests/quote-disclosure.test.ts §7).
  test("'use client' 는 QuoteWidget · QuickQuoteModal · TurnstileWidget · MoreToggle 뿐 (quote 디렉터리 기준)", () => {
    const clients = quoteTsx.filter((f) => /^\s*["']use client["']/m.test(read(f)));
    expect(clients.sort()).toEqual([MODAL, `${QUOTE_DIR}/TurnstileWidget.tsx`, `${QUOTE_DIR}/MoreToggle.tsx`].sort());
    expect(/^\s*["']use client["']/m.test(read(WIDGET))).toBe(true);
    expect(/^\s*["']use client["']/m.test(read(HERO))).toBe(false);
  });

  test("홈은 ISR 을 유지한다(revalidate 600 · force-dynamic 0) — 폼 토큰은 모달이 열릴 때 서버액션으로 받는다", () => {
    const page = codeOf(HOME_PAGE);
    expect(page).toMatch(/^export const revalidate = 600;$/m);
    expect(page).not.toMatch(/force-dynamic/);
    expect(page).not.toMatch(/issueQuoteFormToken/);
    expect(codeOf(HERO)).not.toMatch(/issueQuoteFormToken|formToken/);
  });

  test("next/link 0 · 청약철회 고지 data-legal · 허니팟 속성(tabIndex -1 · autoComplete off · aria-hidden)", () => {
    for (const { file, code } of intakeSources) expect(/from\s+["']next\/link["']/.test(code), file).toBe(false);
    expect(read(`${QUOTE_DIR}/WithdrawalNotice.tsx`)).toMatch(/data-legal="withdrawal-notice"/);
    const hp = codeOf(MODAL).match(/<input[^>]*name=\{G\.website\}[^>]*\/>/)?.[0] ?? "";
    expect(hp, "허니팟 input 이 있어야 한다").not.toBe("");
    expect(hp).toMatch(/tabIndex=\{-1\}/);
    expect(hp).toMatch(/autoComplete="off"/);
    expect(hp).toMatch(/aria-hidden/);
  });

  test("위젯은 개인정보를 받지 않는다 — 이름·연락처 칸은 모달 안에만", () => {
    const widget = codeOf(WIDGET);
    expect(widget).not.toMatch(/name=\{F\.name\}|autoComplete="tel|type="tel"/);
    expect(widget).not.toMatch(/\bfetch\(/);
  });
});

// =============================================================================
// 6. 폼 필드명 1:1
// =============================================================================
describe("6. 폼 필드명 1:1", () => {
  const code = [...quoteTsx.map((f) => codeOf(f)), codeOf(WIDGET)].join("\n");

  test("RESERVATION_FORM_FIELDS 의 키를 전부, 그것만 name={F.…} 로 쓴다 (연락처 둘은 hidden — splitPhone 이 한 칸에서 XOR 로 만든다)", () => {
    const used = new Set([...code.matchAll(/name=\{F\.([A-Za-z]+)\}/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual(Object.keys(RESERVATION_FORM_FIELDS).sort());
  });

  test("guard 필드는 website·formToken 두 개 (cf-turnstile-response 는 위젯이 넣는다)", () => {
    const used = new Set([...code.matchAll(/name=\{G\.([A-Za-z]+)\}/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual(["formToken", "website"]);
    expect(GUARD_FORM_FIELDS.turnstile).toBe("cf-turnstile-response");
  });

  test("문자열 리터럴 name=\"…\" 0건", () => {
    expect(code.match(/\sname="[^"]*"/g) ?? []).toEqual([]);
    expect(code.match(/\sname=\{["'`]/g) ?? []).toEqual([]);
  });

  test("F·G 는 lib/reservations/formData 의 상수와 값이 같다", () => {
    expect(F).toEqual(RESERVATION_FORM_FIELDS);
    expect(G).toEqual({ website: GUARD_FORM_FIELDS.website, formToken: GUARD_FORM_FIELDS.formToken });
  });

  test("클라이언트 번들 위생 — zod·node:crypto 를 끌어오는 lib 을 런타임 import 하지 않는다 (form-token.ts 는 서버 전용 예외)", () => {
    const HEAVY = /^import\s+(?!type\s)[^;]*from\s+["']@\/lib\/(types|guard(\/[a-z]+)?|reservations\/formData|reservations\/create|reservations\/db|supabase\/[a-z]+|legal\/disclosures)["']/m;
    for (const f of [...quoteFiles.filter((x) => /\.tsx?$/.test(x)), WIDGET]) {
      if (f === `${QUOTE_DIR}/form-token.ts` || f === `${QUOTE_DIR}/WithdrawalNotice.tsx`) continue;
      expect(HEAVY.test(codeOf(f)), f).toBe(false);
    }
  });
});

// =============================================================================
// 7. 메시지 — ko·en 짝
// =============================================================================
describe("7. 메시지 카탈로그 — 새 키는 ko·en 모두 · 위저드 전용 키는 없다", () => {
  const keysOf = (o: unknown, p = ""): string[] =>
    o && typeof o === "object" && !Array.isArray(o)
      ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? keysOf(v, `${p}${k}.`) : [`${p}${k}`]))
      : [];

  test("quote.* · home.hero.widget.* 키 집합이 ko·en 에서 같다", () => {
    expect(keysOf(en.quote).sort()).toEqual(keysOf(ko.quote).sort());
    const w = (m: Record<string, unknown>) => ((m.home as Record<string, unknown>).hero as Record<string, unknown>).widget;
    expect(keysOf(w(en)).sort()).toEqual(keysOf(w(ko)).sort());
  });

  test("위저드 전용 키(quote.steps · quote.nav · quote.done · quote.meta · progress*) 는 지워졌다", () => {
    const q = ko.quote as Record<string, unknown>;
    for (const k of ["steps", "nav", "done", "meta", "progressLabel", "progressNow", "kicker"]) expect(q, k).not.toHaveProperty(k);
  });
});

// =============================================================================
// 8. 수정 라운드 (P3-8 리뷰 P2-1 · P2-10 · P2-11)
// =============================================================================
describe("8. 수정 라운드 — 토큰 재발급 · 배경 inert · 성공 뒤 위젯 비우기", () => {
  test("P2-1 needsFreshFormToken — bot(타임트랩 만료·위조·너무 빠름)일 때만 새 토큰", () => {
    expect(needsFreshFormToken({ ok: false, code: "bot", messageKey: "reservation.errors.bot" })).toBe(true);
    for (const code of ["validation", "turnstile", "ratelimit", "infra", "server"] as const) {
      expect(needsFreshFormToken({ ok: false, code, messageKey: `reservation.errors.${code}` }), code).toBe(false);
    }
    expect(needsFreshFormToken({ ok: true, publicCode: "ABCD2345", notifyQueued: true })).toBe(false);
    expect(needsFreshFormToken({ ok: true, publicCode: null })).toBe(false);
  });

  test("P2-1 모달 — bot 결과면 requestQuoteFormToken 을 다시 부르고(토큰 교체) Turnstile 을 리셋한다", () => {
    const src = codeOf(MODAL);
    // 토큰 받기가 한 함수로 모여 있고, 열 때와 bot 결과 때 둘 다 그것을 부른다
    expect(src.match(/requestQuoteFormToken\(\)/g)?.length).toBe(1);
    expect(src).toMatch(/needsFreshFormToken\(result\)/);
    expect(src).toMatch(/onStaleTokenRef\.current\(\)/);
    expect(src).toMatch(/setTurnstileResetKey\(/);
  });

  test("P2-10 inertBackground — 대화상자의 조상은 두고 형제만 inert · 이미 inert 였던 것은 건드리지 않고 되돌린다", () => {
    type Fake = {
      name: string;
      tagName: string;
      parentElement: Fake | null;
      children: Fake[];
      attrs: Map<string, string>;
      hasAttribute(n: string): boolean;
      setAttribute(n: string, v: string): void;
      removeAttribute(n: string): void;
    };
    const el = (name: string, kids: Fake[] = []): Fake => {
      const e: Fake = {
        name,
        tagName: name === "script" ? "SCRIPT" : "DIV",
        parentElement: null,
        children: kids,
        attrs: new Map(),
        hasAttribute: (n) => e.attrs.has(n),
        setAttribute: (n, v) => void e.attrs.set(n, v),
        removeAttribute: (n) => void e.attrs.delete(n),
      };
      for (const k of kids) k.parentElement = e;
      return e;
    };
    const backdrop = el("backdrop");
    const fields = el("fields");
    const aside = el("aside", [fields, backdrop]);
    const carousel = el("carousel");
    const hero = el("hero", [carousel, aside]);
    const header = el("header");
    const footer = el("footer");
    footer.attrs.set("inert", ""); // 이미 inert — 되돌릴 때 풀지 않는다
    const main = el("main", [hero]);
    const script = el("script"); // Next 의 RSC 스크립트 — 보이지 않는 요소는 건드리지 않는다
    const body = el("body", [header, main, footer, script]);

    const restore = inertBackground(backdrop as unknown as HTMLElement, body as unknown as HTMLElement);
    const inert = (e: Fake) => e.attrs.has("inert");
    expect([header, carousel, fields, footer].map(inert)).toEqual([true, true, true, true]);
    expect(inert(script)).toBe(false);
    expect([backdrop, aside, hero, main, body].map(inert)).toEqual([false, false, false, false, false]);
    restore();
    expect([header, carousel, fields].map(inert)).toEqual([false, false, false]);
    expect(inert(footer)).toBe(true);
  });

  test("P2-10 모달 — 열려 있는 동안 배경 inert(열 때 걸고 닫을 때 푼다)", () => {
    const src = codeOf(MODAL);
    expect(src).toMatch(/inertBackground\(/);
    expect(src).toMatch(/return\s*\(\)\s*=>\s*\{[^}]*restore\(\)/);
  });

  test("P2-8 카피 — 차량 카드 CTA 는 차종별 견적을 약속하지 않고, 위젯 부제는 '문자로 견적' 을 약속하지 않는다(ko·en)", () => {
    const pick = (cat: Record<string, unknown>, dotted: string) =>
      dotted.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], cat) as string;
    const koCta = pick(ko, "home.fleet.cta");
    const enCta = pick(en, "home.fleet.cta");
    expect(koCta).not.toMatch(/차량으로|차종/);
    expect(enCta).not.toMatch(/vehicle/i);
    // 위젯 버튼·모달 제출과 같은 말 — 누르면 같은 곳(#quote)으로 간다
    expect(koCta).toBe(pick(ko, "home.hero.widget.cta"));
    expect(enCta).toBe(pick(en, "home.hero.widget.cta"));

    const koSub = pick(ko, "home.hero.widget.sub");
    const enSub = pick(en, "home.hero.widget.sub");
    expect(koSub).not.toMatch(/문자|SMS/);
    expect(enSub).not.toMatch(/text message|SMS|\btext\b/i);
    // 모달 요약 안내("전화로 확인해 드립니다")와 같은 흐름 — 확인하고 연락한다.
    // P7-7(2026-10-09, 사용자 지시): 손님 화면에 "사장님" 을 쓰지 않는다 — 옛 단언(/사장님/ 이 있다)을 뒤집었다.
    expect(koSub).not.toMatch(/사장님/);
    expect(koSub).toMatch(/확인 후 연락/);
    expect(enSub).not.toMatch(/owner/i);
    expect(enSub).toMatch(/contact you/i);
  });

  test("P2-12 낡은 주석 — robots.ts 는 /quote/done 을, form-token.ts 는 /quote 서버 컴포넌트·6단계를 말하지 않는다", () => {
    expect(read("app/robots.ts")).not.toMatch(/\/quote\/done/);
    const tokenModule = read(`${QUOTE_DIR}/form-token.ts`);
    expect(tokenModule).not.toMatch(/\/quote 서버 컴포넌트|6단계|force-dynamic/);
    expect(tokenModule).toMatch(/requestQuoteFormToken/);
  });

  test("quote.module.css — 어떤 파일도 쓰지 않는 클래스가 없다(위저드 전용 클래스 정리)", () => {
    const css = read(`${QUOTE_DIR}/quote.module.css`);
    const classes = [...new Set([...stripCssComments(css).matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))];
    const users = walk(path.join(ROOT, "components"))
      .concat(walk(path.join(ROOT, "app")))
      .filter((p) => /\.tsx?$/.test(p))
      .map((p) => readFileSync(p, "utf8"))
      .filter((src) => /quote\.module\.css["']/.test(src));
    const joined = users.join("\n");
    const unused = classes.filter((c) => !new RegExp(`\\b(s|q|styles)\\.${c}\\b`).test(joined));
    expect(unused).toEqual([]);
  });

  test("P2-11 initialWidgetFields — 기본 출발·도착만 두고 날짜·인원은 비운다", () => {
    expect(initialWidgetFields({ origin: "ICN", dest: "SEL" })).toEqual({
      originCode: "ICN",
      destinationCode: "SEL",
      departDate: "",
      returnDate: "",
      passengers: "",
    });
  });

  test("P2-11 위젯 — 접수 성공(onSubmitted)이면 칸을 처음 상태로 비운다(같은 내용 재접수 방지)", () => {
    const widget = codeOf(WIDGET);
    expect(widget).toMatch(/onSubmitted=\{onSubmitted\}/);
    expect(widget).toMatch(/const onSubmitted = useCallback\(\(\) => \{[^}]*setFields\(initialWidgetFields\(defaults\)\)/);
    expect(widget).toMatch(/useState<WidgetFields>\(\(\) => initialWidgetFields\(defaults\)\)/);
    const modal = codeOf(MODAL);
    expect(modal).toMatch(/onSubmitted\(\)/);
  });
});
