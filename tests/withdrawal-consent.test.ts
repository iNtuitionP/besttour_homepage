/**
 * P1-7 (1-B)·(2) + 수정 라운드 2 — 청약철회 제한 동의: UI 게이트 · 서버 거부 · DB 제약(0021) 세 층.
 *
 * 왜 세 층인가
 *   - UI(위저드 6단계)만 막으면 서버액션은 공개 POST 라 우회된다 → zod `withdrawalConsent: z.literal(true)` 가 서버에서 거부한다.
 *   - 서버 코드만 막으면 다른 코드 경로(스크립트·이후 기능)가 값 없이 넣을 수 있다 → 0021 이 **새 행에 한해** DB 제약으로 막는다
 *     (0003 이 privacy_consent_at 을 NOT NULL 로 강제한 것과 같은 이유 — 코드 경로가 아니라 제약으로).
 *   - 동의 시각은 **서버 시각**이다(consentFields 의 now — 클라이언트가 보낸 시각은 받지 않는다. 폼에는 시각 필드가 없다).
 *
 * 0021 설계 (R2 — astra P1-3): 적용 시각 기준 CHECK 는 버렸다. `created_at default now()` 는 트랜잭션 시작 시각이라 적용 전에 시작한
 * 트랜잭션이 적용 뒤에 동의 없이 넣을 수 있었고, created_at 을 과거로 넣으면 우회됐다. 이제는 **시각에 기대지 않는다**:
 *   `withdrawal_consent_legacy boolean not null` — 적용 순간의 기존 행만 true(같은 트랜잭션 · ACCESS EXCLUSIVE 안), 그 뒤 기본값 false.
 *   CHECK `withdrawal_consent_at is not null or withdrawal_consent_legacy` (VALID) + legacy 값은 트리거가 바꾸지 못하게 한다
 *   (false→true · true→false 모두, 새 행을 legacy=true 로 넣는 것도).
 * 여기서 실증하는 것:
 *   (a) 값 없는 새 접수 → 23514 — **created_at 을 지정하지 않은 기본값 경로**와 **과거로 넣은 경로** 모두
 *   (b) 값 있는 새 접수 → 201, legacy false   (c) legacy 행의 관리자 확정·취소·완료·메모 → 통과(실제 0010 함수)
 *   (d) 새 행의 값을 null 로 지우는 UPDATE → 23514   (e) legacy 값 변경·legacy=true 삽입 → 트리거 거부
 *   (f) 공개 롤의 권한은 늘지 않았다(카탈로그 — 새 칸의 유효 권한 = 옆 칸 privacy_consent_at, 트리거 함수 EXECUTE 0)
 *
 * DB 블록은 로컬 스택 + REQUIRE_DB_TESTS=1 일 때만 돈다(원격 reservations 에는 어떤 쓰기도 하지 않는다).
 * legacy 행은 트리거가 막으므로 **슈퍼유저 탐침 안에서 `session_replication_role = replica` 로만** 만들고 트랜잭션째 되돌린다.
 * 관리자 함수 탐침은 admin_confirm_reservation 이 통지를 큐에 넣으므로(0010) withNotificationsLock() 안에서 돈다.
 * 주의: tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { withdrawalParagraphs } from "@/components/legal/withdrawal-text";
import { serializeDraft } from "@/components/quote/draft";
import { F } from "@/components/quote/fields";
import { submitBlock } from "@/components/quote/submit-gate";
import { INITIAL_STATE, reducer, toFormValues, validateStep, type WizardState } from "@/components/quote/wizard-state";
import { ledgerUi } from "@/lib/i18n/ledger-ui";
import { CANCELLATION, TERMS, WITHDRAWAL } from "@/lib/legal/disclosures";
import { consentFields } from "@/lib/reservations/consent";
import { createReservation, type ReservationDb } from "@/lib/reservations/create";
import { BOOLEAN_FORM_FIELDS, RESERVATION_FORM_FIELDS, formDataToRaw } from "@/lib/reservations/formData";
import { ReservationInput, type ReservationInsert } from "@/lib/types";

import { withNotificationsLock } from "./helpers/db-lock";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";
import { runLocalSql, runLocalSqlExpectingError, runLocalSuperuserSqlExpectingError, sqlCells, sqlErrorText } from "./helpers/local-stack-sql";
import { stripComments } from "./helpers/strip-comments";

vi.mock("server-only", () => ({}));

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const UP_REL = "supabase/migrations/0021_withdrawal_consent.sql";
const DOWN_REL = "supabase/rollbacks/0021_withdrawal_consent.down.sql";
const compact = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const GUARD_FN = "public.reservations_withdrawal_legacy_guard()";

const validInput = {
  name: "홍길동",
  phone: "010-1234-5678",
  vehicleSlug: "bus45" as const,
  purposeCode: "family" as const,
  originCode: "SEL" as const,
  destinationCode: "BSN" as const,
  waypointCodes: [],
  tripType: "oneway" as const,
  departAtLocal: "2026-10-01T08:00",
  busCount: 1,
  locale: "ko" as const,
  turnstileToken: "test-turnstile-token",
  privacyConsent: true as const,
  withdrawalConsent: true as const,
};

// =============================================================================
// 1. 서버 — zod · 폼 계약 · 동의 시각
// =============================================================================
describe("1. 서버 — 동의 없는 payload 는 zod 에서 거부된다", () => {
  test("withdrawalConsent: true 면 통과", () => {
    expect(ReservationInput.safeParse(validInput).success).toBe(true);
  });

  test.for([
    ["누락", undefined],
    ["false", false],
    ["문자열 'true'", "true"],
    ["1", 1],
    ["'on'", "on"],
  ] as const)("withdrawalConsent %s → 실패 (path = withdrawalConsent)", ([, value]) => {
    const input: Record<string, unknown> = { ...validInput, withdrawalConsent: value };
    if (value === undefined) delete input.withdrawalConsent;
    const r = ReservationInput.safeParse(input);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path.join(".") === "withdrawalConsent")).toBe(true);
  });

  test("폼 계약 — withdrawalConsent 는 체크박스 필드다 (없으면 undefined → zod 가 잡는다)", () => {
    expect(RESERVATION_FORM_FIELDS.withdrawalConsent).toBe("withdrawalConsent");
    expect(BOOLEAN_FORM_FIELDS).toContain("withdrawalConsent");
    const fd = new FormData();
    fd.set("withdrawalConsent", "on");
    expect(formDataToRaw(fd).raw.withdrawalConsent).toBe(true);
    expect(formDataToRaw(new FormData()).raw.withdrawalConsent).toBeUndefined();
  });

  test("consentFields — withdrawal_consent_at = 서버 now (필수 동의와 같은 인스턴트) · legacy 칸은 보내지 않는다(기본값 false)", () => {
    const now = new Date("2026-09-22T01:02:03.004Z");
    const f = consentFields({ privacyConsent: true, marketingConsent: false, withdrawalConsent: true }, now);
    expect(f.withdrawal_consent_at).toBe(now.toISOString());
    expect(f.withdrawal_consent_at).toBe(f.privacy_consent_at);
    expect("withdrawal_consent_legacy" in f).toBe(false);
  });

  test("consentFields — 타입을 우회해 withdrawalConsent 가 true 가 아니면 throw (받은 적 없는 동의의 시각을 만들지 않는다)", () => {
    const now = new Date();
    for (const bad of [false, "true", undefined]) {
      const input = { privacyConsent: true, marketingConsent: false, withdrawalConsent: bad } as unknown as Parameters<typeof consentFields>[0];
      expect(() => consentFields(input, now)).toThrow(/withdrawalConsent/);
    }
  });

  test("createReservation — insert 페이로드에 withdrawal_consent_at = deps.now() (클라이언트 시각 경로 없음) · legacy 칸 없음", async () => {
    const now = new Date("2026-09-22T03:00:00.000Z");
    const rows: ReservationInsert[] = [];
    const db: ReservationDb = {
      insert: async (row) => {
        rows.push(row);
        return { id: "11111111-1111-4111-8111-111111111111" };
      },
      enqueue: async (r) => r.map((_, i) => i + 1),
    };
    await createReservation(ReservationInput.parse(validInput), {
      db,
      now: () => now,
      randomBytes: (n: number) => Buffer.alloc(n, 7),
      ownerPhone: "01000000000",
      log: () => {},
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].withdrawal_consent_at).toBe(now.toISOString());
    expect("withdrawal_consent_legacy" in rows[0]).toBe(false);
  });
});

// =============================================================================
// 2. UI — 사전 체크 없음 · 미체크면 제출 불가 · 초안에 남지 않음 · 라벨 · 영문 번역본
// =============================================================================
describe("2. 위저드 — 체크하지 않으면 제출할 수 없다", () => {
  const filled = (over: Partial<WizardState> = {}): WizardState => ({
    ...INITIAL_STATE,
    name: "홍길동",
    phone: "010-1234-5678",
    privacyConsent: true,
    withdrawalConsent: true,
    ...over,
  });

  test("초기값은 false — 사전 체크 없음", () => {
    expect(INITIAL_STATE.withdrawalConsent).toBe(false);
  });

  test("init(초안·프리필 복원)은 청약철회 동의를 켜지 않는다", () => {
    const s = reducer(INITIAL_STATE, { type: "init", draft: { withdrawalConsent: true } as never, prefill: {} });
    expect(s.withdrawalConsent).toBe(false);
  });

  test("초안(sessionStorage)에 직렬화되지 않는다", () => {
    expect("withdrawalConsent" in JSON.parse(serializeDraft(filled()))).toBe(false);
  });

  test("6단계 검증 — 미체크면 withdrawalConsent 필드 오류", () => {
    expect(validateStep(filled({ withdrawalConsent: false }), 6).map((e) => e.field)).toEqual(["withdrawalConsent"]);
    expect(validateStep(filled(), 6)).toEqual([]);
  });

  test("제출 게이트 — 개인정보 동의가 있어도 청약철회 동의가 없으면 consent 로 닫힌다", () => {
    const base = { formToken: "1.abc", siteKey: "site", privacyConsent: true, withdrawalConsent: true, pending: false };
    expect(submitBlock(base)).toBeNull();
    expect(submitBlock({ ...base, withdrawalConsent: false })).toBe("consent");
    expect(submitBlock({ ...base, privacyConsent: false, withdrawalConsent: true })).toBe("consent");
  });

  test("폼 값 — 체크박스 값이 그대로 실린다 (시각은 싣지 않는다 — 서버가 찍는다)", () => {
    const v = toFormValues(filled());
    expect(v.withdrawalConsent).toBe(true);
    expect(Object.keys(v).some((k) => /At$|time/i.test(k))).toBe(false);
    expect(F.withdrawalConsent).toBe("withdrawalConsent");
  });

  test("라벨 — ko 는 원장 consentLabel, en 은 원장 consentLabelEn", () => {
    expect(ledgerUi("ko").consent.withdrawal).toBe(WITHDRAWAL.consentLabel);
    expect(ledgerUi("en").consent.withdrawal).toBe(WITHDRAWAL.consentLabelEn);
  });

  test("체크박스 — name={F.withdrawalConsent} · checked 는 상태 · defaultChecked 0 · 필수 오류 연결", () => {
    const src = stripComments(read("components/quote/Step6Contact.tsx"), "Step6Contact.tsx");
    expect(src).toMatch(/name=\{F\.withdrawalConsent\}/);
    expect(src).toMatch(/checked=\{state\.withdrawalConsent\}/);
    expect(src).not.toMatch(/defaultChecked/);
    expect(src).toMatch(/errorFor\(\s*["']withdrawalConsent["']\s*\)/);
    expect(src).toMatch(/data-testid="consent-withdrawal"/);
    // 청약철회 고지(서버 컴포넌트 노드) 바로 뒤에 체크박스가 온다
    expect(src.indexOf("{withdrawalNotice}")).toBeGreaterThan(-1);
    expect(src.indexOf("{withdrawalNotice}")).toBeLessThan(src.indexOf("F.withdrawalConsent"));
  });

  test("고지 — 위저드는 원장 WITHDRAWAL.notice·noticeEn 을 취소·환불 규정 바로 아래에서 로케일에 맞춰 렌더한다", () => {
    const src = stripComments(read("components/quote/WithdrawalNotice.tsx"), "WithdrawalNotice.tsx");
    expect(src).toMatch(/<WithdrawalRestrictionText[\s\S]*?notice=\{WITHDRAWAL\.notice\}[\s\S]*?noticeEn=\{WITHDRAWAL\.noticeEn\}[\s\S]*?locale=\{locale\}/);
    const iCancel = src.indexOf('data-legal="cancellation"');
    const iNotice = src.indexOf("<WithdrawalRestrictionText");
    expect(iCancel).toBeGreaterThan(-1);
    expect(iNotice).toBeGreaterThan(iCancel);
  });

  // R2 [P1-1] — 영어 손님이 읽지 못하는 문장에 동의하게 하지 않는다. 이 문구만은 번역본(noticeEn)을 싣고, 한국어 원문을 lang="ko" 로 함께 둔다.
  test("withdrawalParagraphs — ko 는 한국어 한 문단 · en 은 noticeEn(lang=en) 다음에 한국어 원문(lang=ko)", () => {
    expect(withdrawalParagraphs("ko", WITHDRAWAL.notice, WITHDRAWAL.noticeEn)).toEqual([
      { legal: "withdrawal-restriction", lang: undefined, text: WITHDRAWAL.notice },
    ]);
    expect(withdrawalParagraphs("en", WITHDRAWAL.notice, WITHDRAWAL.noticeEn)).toEqual([
      { legal: "withdrawal-restriction-en", lang: "en", text: WITHDRAWAL.noticeEn },
      { legal: "withdrawal-restriction", lang: "ko", text: WITHDRAWAL.notice },
    ]);
  });

  test("위저드·이용안내·약관이 같은 컴포넌트로 같은 원장 문구를 렌더한다 (세 곳이 갈라지지 않는다)", () => {
    for (const f of ["components/quote/WithdrawalNotice.tsx", "app/[locale]/(legal)/guide/page.tsx", "app/[locale]/(legal)/terms/page.tsx"]) {
      const src = stripComments(read(f), f);
      expect(src, f).toMatch(/notice=\{WITHDRAWAL\.notice\}/);
      expect(src, f).toMatch(/noticeEn=\{WITHDRAWAL\.noticeEn\}/);
    }
  });
});

// =============================================================================
// 2-c. 문구 일관성 — 법보다 넓게 쓰지 않는다 (R2 [P1-1])
// =============================================================================
describe("2-c. 청약철회·취소환불 문구 — 절대 표현 0 · 조건부 · 기한 일치 · §17③ 권리 보존", () => {
  const ABSOLUTE = ["무조건", "어떠한 경우에도", "어떤 경우에도", "예외 없이", "일절", "일체", "절대"];
  const art7 = TERMS.articles.find((a) => a.no === 7);
  const art8 = TERMS.articles.find((a) => a.no === 8);
  const texts: Array<[string, string]> = [
    ["WITHDRAWAL.notice", WITHDRAWAL.notice],
    ["WITHDRAWAL.smsLine", WITHDRAWAL.smsLine],
    ["CANCELLATION.referenceTime", CANCELLATION.referenceTime],
    ["CANCELLATION.depositNote", CANCELLATION.depositNote],
    ["CANCELLATION.smsLine", CANCELLATION.smsLine],
    ...CANCELLATION.tiers.map((t, i) => [`CANCELLATION.tiers[${i}]`, `${t.when} ${t.label}`] as [string, string]),
    ["TERMS 제7조", art7?.body ?? ""],
    ["TERMS 제8조", art8?.body ?? ""],
  ];

  test.for(texts)("%s — 절대 표현이 없다", ([, text]) => {
    for (const w of ABSOLUTE) expect(text.includes(w), w).toBe(false);
  });

  test("청약철회 고지는 약관 제8조처럼 조건부다 — 같은 조항(제17조 제2항) · '제한될 수 있으며' · '그 경우'", () => {
    expect(art8?.body).toContain("제17조 제2항에 따라 청약철회가 제한될 수 있으며, 그 경우");
    expect(WITHDRAWAL.notice).toContain("제17조 제2항에 따라 청약철회가 제한될 수 있으며, 그 경우");
    expect(WITHDRAWAL.smsLine).toContain("제한될 수 있습니다");
  });

  test("제17조 제3항 권리(표시·광고·계약과 다른 경우의 철회)를 지우지 않는다", () => {
    expect(WITHDRAWAL.notice).toContain("표시·광고 또는 계약 내용과 다른 경우에는 법에 따라 청약철회 등을 하실 수 있습니다");
    // R3 [P2-G] — 같은 뜻을 "표의 범위" 문장 안에서 말한다: 법에 따른 권리에는 영향이 없다(예: 광고·계약과 다른 서비스).
    expect(WITHDRAWAL.noticeEn).toContain(
      "it does not affect your rights under the law, for example if the service provided differs from what was advertised or agreed",
    );
  });

  test("기한이 취소·환불 규정과 같다 — 3일 전까지 전액 · 2일 전부터 제한", () => {
    expect(CANCELLATION.tiers[0].when).toBe("운행일 3일 전까지");
    expect(CANCELLATION.tiers[1].when.startsWith("운행일 2일 전부터")).toBe(true);
    expect(WITHDRAWAL.notice).toContain("운행일 3일 전까지는");
    expect(WITHDRAWAL.notice).toContain("운행일 2일 전부터는");
    expect(WITHDRAWAL.smsLine.startsWith("운행일 2일 전부터는")).toBe(true);
    expect(CANCELLATION.smsLine).toContain("운행일 3일 전까지 취소 시 계약금 전액 환불");
    expect(CANCELLATION.smsLine).toContain("2일 전부터는 계약금 환불 불가");
    expect(WITHDRAWAL.noticeEn).toContain("at least 3 days before the travel date");
    expect(WITHDRAWAL.noticeEn).toContain("From 2 days before the travel date");
  });

  test("영문 번역본은 스스로 '한국어가 법적 원문' 이라고 말한다", () => {
    expect(WITHDRAWAL.noticeEn.endsWith("The Korean text is the legally binding version.")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // R3 [P2-F] — 표·요약은 그 자체로 절대적으로 읽힌다("계약금 환불 불가"). 범위 문장이 표 바로 아래에 함께 있어야 한다.
  // ---------------------------------------------------------------------------
  test("🔴 취소·환불 범위 문장 — 고객 사정 취소에 적용 · 법에 따른 권리는 영향 없음", () => {
    expect(CANCELLATION.scope).toContain("고객 사정으로 취소하시는 경우에 적용되며");
    expect(CANCELLATION.scope).toContain("법에 따른 권리에는 영향을 주지 않습니다");
    for (const w of ABSOLUTE) expect(CANCELLATION.scope.includes(w), w).toBe(false);
    // 확정 통지 한 줄에도 범위가 들어간다(문자에는 표가 없다)
    expect(CANCELLATION.smsLine).toContain("고객 사정으로 취소하는 경우");
  });

  test("🔴 취소·환불 표가 나오는 화면마다 표 바로 아래 범위 문장이 있다 (위저드 · /guide · 약관 제7조)", () => {
    const wizard = stripComments(read("components/quote/WithdrawalNotice.tsx"), "WithdrawalNotice.tsx");
    expect(wizard).toMatch(/CANCELLATION\.scope/);
    expect(wizard.indexOf("CANCELLATION.referenceTime")).toBeLessThan(wizard.indexOf("CANCELLATION.scope"));
    expect(wizard.indexOf("CANCELLATION.scope")).toBeLessThan(wizard.indexOf("<WithdrawalRestrictionText"));

    const guide = stripComments(read("app/[locale]/(legal)/guide/page.tsx"), "guide/page.tsx");
    expect(guide).toMatch(/CANCELLATION\.scope/);
    expect(guide.indexOf("CANCELLATION.referenceTime")).toBeLessThan(guide.indexOf("CANCELLATION.scope"));
    expect(guide.indexOf("CANCELLATION.scope")).toBeLessThan(guide.indexOf("<WithdrawalRestrictionText"));

    // 약관에는 표가 없고 제7조가 "이용안내에 게시된 취소·환불 규정에 따릅니다" 라고만 한다 — 그 조 아래에 같은 범위 문장을 붙인다
    const terms = stripComments(read("app/[locale]/(legal)/terms/page.tsx"), "terms/page.tsx");
    expect(terms).toMatch(/CANCELLATION\.scope/);
    expect(terms).toMatch(/CANCEL_ARTICLE_NO\s*=\s*7/);

    // 세 곳 모두 같은 data-legal 로 표시해 렌더 실측이 찾을 수 있게 한다
    for (const [f, src] of [["wizard", wizard], ["guide", guide], ["terms", terms]] as const) {
      expect(src, f).toMatch(/data-legal="cancellation-scope"/);
    }
  });

  test("약관 제8조 본문은 바꾸지 않았다 (새 고지는 그 조건부 문장 안에 들어간다)", () => {
    expect(art8?.body).toBe(
      "전세버스 운행은 특정 일시에 제공되는 용역으로서 「전자상거래 등에서의 소비자보호에 관한 법률」 제17조 제2항에 따라 청약철회가 제한될 수 있으며, 그 경우 제7조의 취소·환불 규정이 적용됩니다. 회사는 이 사실을 견적 신청 화면과 예약 확정 통지에 고지합니다.",
    );
  });
});

// =============================================================================
// 2-b. 관리자 예약 상세 — 분쟁 때 사장님이 증거를 찾을 수 있게
// =============================================================================
describe("2-b. 관리자 예약 상세 — 청약철회 제한 동의 시각", () => {
  test("상세 select 화이트리스트에 withdrawal_consent_at·legacy 가 있고 목록에는 없다", async () => {
    const mod = await import("@/lib/admin/reservations");
    expect(mod.RESERVATION_DETAIL_COLUMNS).toContain("withdrawal_consent_at");
    expect(mod.RESERVATION_DETAIL_COLUMNS).toContain("withdrawal_consent_legacy");
    expect(mod.RESERVATION_LIST_COLUMNS as readonly string[]).not.toContain("withdrawal_consent_at");
    expect(mod.RESERVATION_LIST_COLUMNS as readonly string[]).not.toContain("withdrawal_consent_legacy");
  });

  test("화면 — 값이 있으면 KST 시각, legacy 면 '기록 없음(동의 기록 도입 전 접수)' (날짜를 박지 않는다)", () => {
    const src = stripComments(read("app/admin/(protected)/reservations/[id]/page.tsx"), "admin-detail.tsx");
    expect(src).toMatch(/t\("field\.withdrawalConsentAt"\)/);
    expect(src).toMatch(/row\.withdrawal_consent_at !== null\s*\?\s*kstWallClock\(row\.withdrawal_consent_at\)\s*:\s*row\.withdrawal_consent_legacy\s*\?\s*t\("value\.noWithdrawalRecord"\)\s*:\s*none/);
    const ko = JSON.parse(read("messages/ko.json")) as { admin: { detail: { field: Record<string, string>; value: Record<string, string> } } };
    expect(ko.admin.detail.field.withdrawalConsentAt).toBe("청약철회 제한 동의");
    expect(ko.admin.detail.value.noWithdrawalRecord).toBe("기록 없음(동의 기록 도입 전 접수)");
    expect(ko.admin.detail.value.noWithdrawalRecord).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test("통지 조회는 이 칸들을 읽지 않는다 (문안에 쓰지 않는 값 — lib/notify/vars.ts FORBIDDEN_VARS_COLUMNS)", async () => {
    const vars = await import("@/lib/notify/vars");
    expect(vars.FORBIDDEN_VARS_COLUMNS as readonly string[]).toContain("withdrawal_consent_at");
    expect(vars.FORBIDDEN_VARS_COLUMNS as readonly string[]).toContain("withdrawal_consent_legacy");
  });
});

// =============================================================================
// 3. 0021 텍스트 — legacy 플래그 · 시각에 기대지 않음 · 실제 표 탐침 0
// =============================================================================
describe("3. supabase/migrations/0021_withdrawal_consent.sql (R2 — legacy 플래그 설계)", () => {
  const raw = existsSync(path.join(ROOT, UP_REL)) ? read(UP_REL) : "";
  const code = compact(stripComments(raw, UP_REL));

  test("존재하고 0021 번호는 이 파일 하나다", () => {
    expect(raw.length).toBeGreaterThan(0);
    expect(readdirSync(path.join(ROOT, "supabase", "migrations")).filter((f) => /^0021_/.test(f))).toEqual(["0021_withdrawal_consent.sql"]);
  });

  test("칸 둘 — 동의 시각(nullable · 기본값 없음) · legacy(not null) — 기존 행은 기본값 true 로 한 번에, 그 뒤 기본값 false", () => {
    expect(code).toContain(
      "alter table public.reservations add column withdrawal_consent_at timestamptz, add column withdrawal_consent_legacy boolean not null default true;",
    );
    expect(code).toContain("alter table public.reservations alter column withdrawal_consent_legacy set default false;");
    expect(code.indexOf("default true;")).toBeLessThan(code.indexOf("set default false;"));
    expect(code).not.toMatch(/withdrawal_consent_at timestamptz (not null|default)/);
  });

  test("CHECK 는 legacy 로만 예외를 둔다 — created_at·시각 비교 0 · NOT VALID 0", () => {
    expect(code).toContain(
      "add constraint reservations_withdrawal_consent_required check (withdrawal_consent_at is not null or withdrawal_consent_legacy)",
    );
    expect(code).not.toMatch(/created_at\s*</);
    expect(code).not.toMatch(/clock_timestamp|cutoff/);
    expect(code).not.toMatch(/not valid/);
  });

  test("동의 시각 범위 제약 — 0003 과 같은 폭(+5분 / -1일)", () => {
    expect(code).toContain("add constraint reservations_withdrawal_consent_before_created check (withdrawal_consent_at <= created_at + interval '5 minutes')");
    expect(code).toContain("add constraint reservations_withdrawal_consent_not_stale check (withdrawal_consent_at >= created_at - interval '1 day')");
  });

  test("legacy 값은 바꿀 수 없다 — before insert or update 행 트리거 · 함수 EXECUTE 는 전부 회수(grant 0)", () => {
    expect(code).toContain(
      "create trigger reservations_withdrawal_legacy_guard before insert or update on public.reservations for each row execute function public.reservations_withdrawal_legacy_guard();",
    );
    expect(code).toContain("revoke all on function public.reservations_withdrawal_legacy_guard() from public, anon, authenticated, service_role;");
    expect(code).not.toMatch(/\bgrant\b/);
    expect(code).not.toMatch(/security definer/);
  });

  test("기존 행을 UPDATE 로 채우지 않는다 — 실제 표에 쓰는 문장은 add column 뿐(행 트리거·재작성 없음)", () => {
    expect(code).not.toMatch(/update public\.reservations\b/);
    expect(code).not.toMatch(/insert into public\.reservations\b/);
  });

  test("P2-8 — 자기검증은 실제 표에 문장을 치지 않는다: 롤 전환 0 · 잠금 0 · insert/update 는 임시 복제본에만", () => {
    expect(code).not.toMatch(/set local role/);
    expect(code).not.toMatch(/\block table\b/);
    expect(code).not.toMatch(/from public\.reservations limit 0/);
    // DML 모양으로만 잡는다(`insert into X` · `update X set`) — 트리거 이벤트 목록(`before insert or update on …`)은 쓰기 문장이 아니다.
    const writes = [...code.matchAll(/\binsert into\s+([a-z0-9_.]+)|\bupdate\s+([a-z0-9_.]+)\s+set\b/g)].map((m) => m[1] ?? m[2]);
    expect(writes.length).toBeGreaterThan(0);
    for (const t of writes) expect(t, t).toBe("pg_temp.p0021_probe");
  });

  test("기본값 경로 반례(created_at·legacy 를 지정하지 않은 insert)를 자기검증이 친다", () => {
    expect(raw).toMatch(/default_path=/);
    expect(raw).toMatch(/backdated=/);
  });

  // ---------------------------------------------------------------------------
  // R3 [P1-A] — astra 재현: 표의 TRIGGER 권한이 있으면 `create or replace trigger` 로 가드를 다른 함수로 갈아끼운 뒤
  //             legacy=true 행을 넣을 수 있다. 회수하지 않으면 CHECK 는 남아도 강제가 사라진다.
  // ---------------------------------------------------------------------------
  test("🔴 service_role 의 TRIGGER 를 개인정보 두 표에서 회수한다 — 다른 권한은 건드리지 않는다", () => {
    expect(code).toContain("revoke trigger on table public.reservations, public.notifications_log from service_role;");
    // 앱이 쓰는 권한(select·insert·update·delete)은 그대로다 — 회수 문장은 이 하나뿐이다
    expect(code.match(/revoke[^;]*from service_role/g) ?? []).toHaveLength(1);
    expect(code).not.toMatch(/revoke\s+all\s+on\s+table/);
  });

  test("🔴 자기검증이 '소유자 말고는 아무도 TRIGGER 를 갖지 않는다' 를 본다 (권한 종류는 카탈로그에서 얻는다)", () => {
    expect(code).toContain("acldefault('r'");
    // 직접 부여(ACL 전수)와 유효 권한(has_table_privilege) 두 시야로 본다
    expect(code).toMatch(/a\.privilege_type = 'trigger'/);
    expect(code).toMatch(/a\.grantee is distinct from c\.relowner/);
    // R4 [P2-C] — 유효 권한은 **pg_roles 전수**를 본다(셋만 보면 소유자를 상속하는 롤·슈퍼유저가 빠진다).
    expect(code).toMatch(/from pg_roles r/);
    expect(code).toMatch(/not r\.rolsuper/);
    expect(code).toMatch(/pg_has_role\(r\.oid, \(select c\.relowner/);
    expect(code).toMatch(/has_table_privilege\(r\.oid, t\.tbl::regclass, 'trigger'\)/);
    // 검사 밖에 있는 롤(소유자·그 멤버·슈퍼유저)을 이름으로 남긴다 — 주장을 넓히지 않기 위해
    expect(code).toMatch(/outside_roles/);
    // 트리거 모양 검사에 tgqual(WHEN 조건)·tgenabled 가 들어간다 — when (false) 로 무력화한 트리거를 잡는다
    expect(code).toMatch(/tgqual is not null|tgqual is null/);
    expect(code).toMatch(/tgenabled/);
  });

  // R4 [P2-C] — `session_replication_role` 에 SET 권한이 있으면 그 롤이 replica 로 트리거를 통째로 끈다. 소유자 전용 권한이 아니다.
  test("🔴 session_replication_role 부여가 0 인지 자기검증이 본다 (pg_parameter_acl)", () => {
    expect(code).toMatch(/pg_parameter_acl/);
    expect(code).toMatch(/parname = 'session_replication_role'/);
    expect(raw).toMatch(/replica 로 이 가드를 통째로 끌 수 있다/);
  });

  // R4 [P2-F] — 이미 굳혀 둔 DB 에서 되돌릴 때 없던 권한을 만들지 않으려면, 상행이 **실제로 회수한 것**을 기록해야 한다.
  test("🔴 실제로 회수한 표만 기록한다 — 롤백이 읽을 수 있게 함수 주석에 남긴다", () => {
    expect(code).toMatch(/into revoked_list/);
    expect(code).toMatch(/comment on function public\.reservations_withdrawal_legacy_guard\(\) is %l/);
    expect(raw).toContain("이 파일이 회수한 TRIGGER: service_role@");
    // 기대 ACL 도 "실제로 회수한 표" 만 뺀다(무조건 두 표를 빼면 이미 없던 DB 에서 거짓 통과한다)
    expect(code).toMatch(/string_to_array\(revoked_list, ','\)/);
  });

  test("🔴 헤더가 남는 우회(소유자·슈퍼유저 DDL)를 숨기지 않는다", () => {
    expect(raw).toMatch(/create or replace trigger/i);
    expect(raw).toMatch(/소유자|슈퍼유저/);
    expect(read("docs/ops/known-defects.md")).toMatch(/0021|withdrawal_consent_legacy/);
  });
});

describe("3-b. supabase/rollbacks/0021_withdrawal_consent.down.sql (R2 [P1-6] — 잠금 먼저, 그다음 센다)", () => {
  const raw = existsSync(path.join(ROOT, DOWN_REL)) ? read(DOWN_REL) : "";
  const code = compact(stripComments(raw, DOWN_REL));

  test("rollbacks/ 에 있고 migrations/ 에는 롤백 파일이 없다", () => {
    expect(raw.length).toBeGreaterThan(0);
    expect(existsSync(path.join(ROOT, "supabase/migrations/0021_withdrawal_consent.down.sql"))).toBe(false);
  });

  test("순서 — begin → lock_timeout → 승인 플래그 → 쓰기 잠금(exclusive) → 기록 수·반출 플래그 → 제거 → commit", () => {
    expect(code).toMatch(/^begin; set local lock_timeout = '5s';/);
    const iAck = code.indexOf("bestour.rollback_0021_ack");
    const iLock = code.indexOf("lock table public.reservations in exclusive mode;");
    const iEvidence = code.indexOf("bestour.rollback_0021_evidence_exported");
    const iDrop = code.indexOf("drop column if exists withdrawal_consent_at");
    expect(iAck).toBeGreaterThan(-1);
    expect(iLock).toBeGreaterThan(iAck);
    expect(iEvidence).toBeGreaterThan(iLock);
    expect(iDrop).toBeGreaterThan(iEvidence);
    expect(code).toMatch(/commit;$/);
  });

  test("트리거·함수·제약 3개·칸 2개를 되돌린다 · repair 안내", () => {
    expect(code).toContain("drop trigger if exists reservations_withdrawal_legacy_guard on public.reservations");
    expect(code).toContain("drop function if exists public.reservations_withdrawal_legacy_guard()");
    for (const n of ["reservations_withdrawal_consent_required", "reservations_withdrawal_consent_before_created", "reservations_withdrawal_consent_not_stale"]) {
      expect(code, n).toContain(`drop constraint if exists ${n}`);
    }
    expect(code).toContain("drop column if exists withdrawal_consent_legacy");
    expect(raw).toContain("supabase migration repair --status reverted 0021");
  });

  // R3 [P1-A] · R4 [P2-F] — 0021 이 **실제로 회수한 표에만** TRIGGER 를 되돌린다. 무조건 grant 하면 이미 굳혀 둔 DB 에서 권한 확대다.
  test("🔴 되돌리는 것은 상행이 기록한 목록뿐이다 — 무조건 grant 하지 않는다", () => {
    // 함수를 지우기 전에 주석에서 목록을 읽어 트랜잭션 지역 설정에 담는다
    expect(code).toMatch(/obj_description\(to_regprocedure\('public\.reservations_withdrawal_legacy_guard\(\)'\), 'pg_proc'\)/);
    expect(code).toMatch(/회수한 trigger: service_role@\(\[a-z_,\]\*\)/);
    expect(code).toMatch(/set_config\('bestour\.rollback_0021_revoked'/);
    // 기록이 없으면 사람이 스냅샷을 보고 값을 넘겨야 한다(0018 롤백의 기준선 복원 규범)
    expect(code).toMatch(/bestour\.rollback_0021_restore_trigger/);
    // 부여는 동적 — 목록이 비면 아무것도 하지 않는다
    expect(code).toMatch(/format\('grant trigger on table %s to service_role', tbls\)/);
    expect(code).not.toMatch(/^\s*grant trigger on table public\./m);
    const iAck = code.indexOf("bestour.rollback_0021_ack");
    const iCapture = code.indexOf("obj_description");
    const iDropFn = code.indexOf("drop function if exists");
    const iGrant = code.indexOf("grant trigger on table %s");
    expect(iCapture).toBeGreaterThan(iAck);
    expect(iCapture, "함수를 지우기 전에 기록을 읽어야 한다").toBeLessThan(iDropFn);
    expect(iGrant).toBeGreaterThan(code.indexOf("drop column if exists withdrawal_consent_at"));
  });
});

// =============================================================================
// 4. DB — 로컬 스택 + REQUIRE_DB_TESTS=1
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) console.warn(`[withdrawal-consent.test] DB 블록 skip — ${gate.reason}`);

/** legacy 행 한 건을 트리거를 끈 채(session_replication_role = replica) 넣는 SQL 조각 — 슈퍼유저 탐침 안에서만, 되돌린다. */
const insertLegacyRow = (varName: string, code: string) => `
  set local session_replication_role = replica;
  insert into public.reservations (public_code, created_at, name, phone, vehicle_slug, purpose_code, origin_code, destination_code, trip_type, depart_at, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_legacy)
    values ('${code}' || substr(md5(random()::text), 1, 4), now() - interval '30 days', 'x', '+821000000000', 'bus45', 'family', 'SEL', 'BSN', 'oneway', now() + interval '7 days', now() - interval '30 days', '2026-09-11', now() + interval '300 days', true)
    returning id into ${varName};
  set local session_replication_role = origin;`;

// 로컬 SQL 탐침은 `supabase db query` 한 번에 수 초 걸린다(CLI 기동) — 기본 5초 경계를 넘지 않게 여유를 준다.
describe.skipIf(!gate.allowed || !env.hasServiceRole)("4. DB — 0021 새 행만 강제 (로컬 스택)", { timeout: 60_000 }, () => {
  withNotificationsLock();

  const headers = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, "Content-Type": "application/json" };
  const PREFIX = "P17W";
  const inserted: string[] = [];

  type RestResult = { status: number; body: unknown };
  async function rest(method: string, pathAndQuery: string, json?: unknown, prefer?: string): Promise<RestResult> {
    const res = await fetch(`${env.restRoot}${pathAndQuery}`, {
      method,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // JSON 이 아니면 문자열 그대로
    }
    return { status: res.status, body };
  }
  const err = (r: RestResult) => (r.body ?? {}) as { code?: string; message?: string };

  function row(overrides: Record<string, unknown> = {}, at: Date = new Date()): Record<string, unknown> {
    const out: Record<string, unknown> = {
      public_code: `${PREFIX}${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      name: "테스트",
      phone: "+821000000000",
      vehicle_slug: "bus45",
      purpose_code: "family",
      origin_code: "SEL",
      destination_code: "BSN",
      waypoint_codes: [],
      trip_type: "oneway",
      depart_at: new Date(at.getTime() + 7 * MS_PER_DAY).toISOString(),
      return_at: null,
      nights: 0,
      bus_count: 1,
      locale: "ko",
      ...consentFields({ privacyConsent: true, marketingConsent: false, withdrawalConsent: true }, at),
    };
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete out[k];
      else out[k] = v;
    }
    return out;
  }
  async function insert(r: Record<string, unknown>): Promise<RestResult> {
    const res = await rest("POST", "/reservations", r, "return=representation");
    if (res.status === 201 && Array.isArray(res.body)) for (const x of res.body as { id: string }[]) inserted.push(x.id);
    return res;
  }

  beforeAll(async () => {
    const probe = await rest("GET", "/reservations?select=withdrawal_consent_at,withdrawal_consent_legacy&limit=0");
    if (probe.status !== 200) {
      throw new Error(`0021 이 이 DB 에 적용되지 않은 것으로 보인다 — 조회 HTTP ${probe.status}: ${JSON.stringify(probe.body).slice(0, 200)}`);
    }
  });
  afterEach(async () => {
    while (inserted.length > 0) await rest("DELETE", `/reservations?id=eq.${inserted.pop() as string}`);
  });
  afterAll(async () => {
    await rest("DELETE", `/reservations?public_code=like.${PREFIX}*`);
    const left = await rest("GET", `/reservations?select=id&public_code=like.${PREFIX}*`);
    expect(left.body).toEqual([]);
  });

  test("(a) 값 없는 새 접수 → 400 · 23514 required — created_at·legacy 를 보내지 않는 기본값 경로", async () => {
    for (const r of [row({ withdrawal_consent_at: undefined }), row({ withdrawal_consent_at: null })]) {
      expect("created_at" in r).toBe(false);
      const res = await insert(r);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(err(res).code).toBe("23514");
      expect(err(res).message).toContain("reservations_withdrawal_consent_required");
    }
  });

  test("(a') astra 반례 — created_at 을 과거로 넣어도 동의가 없으면 23514 (시각으로 우회되지 않는다)", async () => {
    const past = new Date(Date.now() - 30 * MS_PER_DAY);
    const res = await insert(row({ created_at: past.toISOString(), withdrawal_consent_at: undefined }, past));
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(err(res).code).toBe("23514");
    expect(err(res).message).toContain("reservations_withdrawal_consent_required");
  });

  test("(b) consentFields 로 만든 새 접수 → 201, 서버 시각이 저장되고 legacy 는 false", async () => {
    const r = row();
    const res = await insert(r);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [saved] = res.body as Record<string, string | boolean>[];
    expect(new Date(saved.withdrawal_consent_at as string).toISOString()).toBe(r.withdrawal_consent_at);
    expect(saved.withdrawal_consent_legacy).toBe(false);
  });

  test("(b') 동의 시각이 접수보다 10분 미래 · 2일 과거 → 23514 (시계 조작·옛 동의 재사용 방어)", async () => {
    const future = await insert(row({ withdrawal_consent_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }));
    expect(future.status).toBe(400);
    expect(err(future).message).toContain("reservations_withdrawal_consent_before_created");
    const stale = await insert(row({ withdrawal_consent_at: new Date(Date.now() - 2 * MS_PER_DAY).toISOString() }));
    expect(stale.status).toBe(400);
    expect(err(stale).message).toContain("reservations_withdrawal_consent_not_stale");
  });

  test("(e) 새 행을 legacy=true 로 넣으면 트리거가 거부한다 (동의가 있어도 없어도)", async () => {
    for (const r of [row({ withdrawal_consent_legacy: true, withdrawal_consent_at: undefined }), row({ withdrawal_consent_legacy: true })]) {
      const res = await insert(r);
      expect(res.status, JSON.stringify(res.body)).not.toBe(201);
      expect(err(res).code).toBe("23000");
      expect(err(res).message).toContain("withdrawal_consent_legacy");
    }
  });

  test("(d)(e) 새 행 — 동의 시각을 지우면 23514 · legacy 를 true 로 바꾸면 23000", async () => {
    const res = await insert(row());
    const [saved] = res.body as { id: string }[];
    const wipe = await rest("PATCH", `/reservations?id=eq.${saved.id}`, { withdrawal_consent_at: null }, "return=representation");
    expect(wipe.status, JSON.stringify(wipe.body)).toBe(400);
    expect(err(wipe).code).toBe("23514");
    const flip = await rest("PATCH", `/reservations?id=eq.${saved.id}`, { withdrawal_consent_legacy: true }, "return=representation");
    expect(flip.status, JSON.stringify(flip.body)).not.toBe(200);
    expect(err(flip).code).toBe("23000");
  });

  test("(c)(e) legacy 행 — 관리자 확정·완료·취소·메모(실제 0010 함수)는 통과 · legacy 를 false 로 바꾸면 거부 (트랜잭션째 되돌림)", () => {
    const out = runLocalSuperuserSqlExpectingError(`
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_old uuid; v_old2 uuid; v_new uuid;
  r record;
  st text;
  o text[] := '{}';
begin
  insert into auth.users (id, email) values (v_uid, 'p17-' || v_uid || '@example.invalid');
  insert into public.admin_users (user_id, email, note) values (v_uid, 'p17-' || v_uid || '@example.invalid', 'P1-7 probe (rolled back)');
  ${insertLegacyRow("v_old", "P17A")}
  ${insertLegacyRow("v_old2", "P17B")}
  insert into public.reservations (public_code, name, phone, vehicle_slug, purpose_code, origin_code, destination_code, trip_type, depart_at, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
    values ('P17C' || substr(md5(v_uid::text), 1, 4), 'x', '+821000000000', 'bus45', 'family', 'SEL', 'BSN', 'oneway', now() + interval '7 days', now(), '2026-09-21', now() + interval '365 days', now())
    returning id into v_new;
  o := o || ('old_legacy=' || (select withdrawal_consent_legacy::text from public.reservations where id = v_old));
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into r from public.admin_update_memo(v_old, 'P17 memo'); o := o || ('memo_old=' || r.outcome);
  select * into r from public.admin_confirm_reservation(v_old, null); o := o || ('confirm_old=' || r.outcome);
  select * into r from public.admin_complete_reservation(v_old, null); o := o || ('complete_old=' || r.outcome);
  select * into r from public.admin_cancel_reservation(v_old2, null); o := o || ('cancel_old=' || r.outcome);
  select * into r from public.admin_confirm_reservation(v_new, null); o := o || ('confirm_new=' || r.outcome);
  execute 'reset role';
  begin
    update public.reservations set withdrawal_consent_legacy = false where id = v_old;
    o := o || 'unlegacy=UPDATED'::text;
  exception when integrity_constraint_violation then
    get stacked diagnostics st = returned_sqlstate;
    o := o || ('unlegacy=' || st);
  end;
  o := o || ('old_still_null=' || (select (withdrawal_consent_at is null)::text from public.reservations where id = v_old));
  o := o || ('old_status=' || (select status::text from public.reservations where id = v_old));
  raise exception 'P17PROBE %', array_to_string(o, ' ');
end $$;`);
    const text = sqlErrorText(out);
    expect(text).toContain("P17PROBE");
    for (const expected of [
      "old_legacy=true",
      "memo_old=memo_updated",
      "confirm_old=confirmed",
      "complete_old=completed",
      "cancel_old=cancelled",
      "confirm_new=confirmed",
      "unlegacy=23000",
      "old_still_null=true",
      "old_status=done",
    ]) {
      expect(text, expected).toContain(expected);
    }
    expect(text).not.toMatch(/23514|check constraint/);
  });

  test("(f) 권한 불변(카탈로그) — 새 칸 둘의 유효 권한은 옆 칸(privacy_consent_at)과 같고, 칸 ACL 없음 · 트리거 함수 EXECUTE 0", () => {
    // 권한 종류는 하드코딩하지 않는다 — 표 권한 종류(acldefault('r'))에서 칸에 쓸 수 있는 것만 has_column_privilege 가 받는다.
    const out = runLocalSqlExpectingError(`
do $$
declare
  k text; w text; col text;
  res text[] := '{}';
  checked int := 0;
begin
  for k in select d.privilege_type from pg_class c cross join lateral aclexplode(acldefault('r', c.relowner)) d where c.oid = 'public.reservations'::regclass order by 1 loop
    begin
      perform has_column_privilege('anon', 'public.reservations', 'privacy_consent_at', k);
    exception when invalid_parameter_value then
      continue;
    end;
    checked := checked + 1;
    foreach col in array array['withdrawal_consent_at', 'withdrawal_consent_legacy'] loop
      foreach w in array array['anon', 'authenticated', 'service_role'] loop
        if has_column_privilege(w, 'public.reservations', col, k) is distinct from has_column_privilege(w, 'public.reservations', 'privacy_consent_at', k) then
          res := res || format('DIFF:%s/%s/%s', col, w, k);
        end if;
        if has_column_privilege(w, 'public.reservations', col, k) then
          res := res || format('HAS:%s/%s/%s', col, w, lower(k));
        end if;
      end loop;
    end loop;
  end loop;
  if exists (select 1 from pg_attribute where attrelid = 'public.reservations'::regclass and attname like 'withdrawal_consent%' and attacl is not null) then
    res := res || 'COLUMN_ACL';
  end if;
  foreach w in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(w, '${GUARD_FN}', 'EXECUTE') then res := res || format('FN_EXEC:%s', w); end if;
  end loop;
  if exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = '${GUARD_FN}'::regprocedure and a.grantee = 0) then
    res := res || 'FN_PUBLIC';
  end if;
  raise exception 'P17PRIV checked=% %', checked, array_to_string(res, ' ');
end $$;`);
    const text = sqlErrorText(out);
    expect(text).toMatch(/P17PRIV checked=4 /);
    expect(text).not.toMatch(/DIFF:|COLUMN_ACL|FN_EXEC:|FN_PUBLIC/);
    expect(text).not.toMatch(/HAS:[a-z_]+\/anon\//);
    expect(text).toMatch(/HAS:withdrawal_consent_at\/authenticated\/select/);
    for (const k of ["insert", "update", "references"]) expect(text).not.toMatch(new RegExp(`HAS:[a-z_]+/authenticated/${k}\\b`));
  });

  /**
   * R3 [P1-A] — astra 재현 SQL 을 실제로 친다. `create or replace trigger` 는 표의 TRIGGER 권한 + 교체할 함수의 EXECUTE 만
   * 요구하므로, 0021 이 `service_role` 에서 TRIGGER 를 회수하지 않으면 가드를 무해한 내장 함수로 갈아끼운 뒤 legacy=true 를 넣을 수 있었다.
   * 대조군(일회용 표에 TRIGGER 를 주면 성공)이 "탐침 SQL 자체는 멀쩡하다" 를 보인다. 전부 되돌린다.
   */
  test("(i) service_role 은 가드 트리거를 갈아끼울 수 없다 — 42501 · 대조군(일회용 표)은 성공", () => {
    const out = runLocalSqlExpectingError(`
do $p17r3$
declare
  o text[] := '{}';
  st text;
begin
  execute 'create table public.p17r3_probe_tbl (id int)';
  execute 'revoke all on table public.p17r3_probe_tbl from public, anon, authenticated, service_role';
  execute 'grant trigger on table public.p17r3_probe_tbl to service_role';
  execute 'set local role service_role';
  begin
    execute 'create or replace trigger reservations_withdrawal_legacy_guard before update on public.reservations for each row execute function pg_catalog.suppress_redundant_updates_trigger()';
    o := o || 'replace_guard=CREATED'::text;
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    o := o || ('replace_guard=' || st);
  end;
  begin
    execute 'create trigger p17r3_extra before update on public.reservations for each row execute function pg_catalog.suppress_redundant_updates_trigger()';
    o := o || 'new_trigger=CREATED'::text;
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    o := o || ('new_trigger=' || st);
  end;
  begin
    execute 'create trigger p17r3_outbox before update on public.notifications_log for each row execute function pg_catalog.suppress_redundant_updates_trigger()';
    o := o || 'outbox_trigger=CREATED'::text;
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    o := o || ('outbox_trigger=' || st);
  end;
  begin
    execute 'create trigger p17r3_control before update on public.p17r3_probe_tbl for each row execute function pg_catalog.suppress_redundant_updates_trigger()';
    o := o || 'control=CREATED'::text;
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    o := o || ('control=' || st);
  end;
  execute 'reset role';
  o := o || ('guard_fn=' || (select tgfoid::regprocedure::text from pg_trigger where tgrelid = 'public.reservations'::regclass and tgname = 'reservations_withdrawal_legacy_guard'));
  raise exception 'P17R3 %', array_to_string(o, ' ');
end $p17r3$;`);
    const text = sqlErrorText(out);
    expect(text).toContain("P17R3");
    for (const expected of [
      "replace_guard=42501",
      "new_trigger=42501",
      "outbox_trigger=42501",
      "control=CREATED",
      "guard_fn=reservations_withdrawal_legacy_guard()",
    ]) {
      expect(text, expected).toContain(expected);
    }
    // 되돌려졌다 — 일회용 표도, 탐침 트리거도 남지 않는다
    const left = sqlCells(
      runLocalSql(
        "select coalesce(to_regclass('public.p17r3_probe_tbl')::text, 'none') as tbl, (select count(*) from pg_trigger where not tgisinternal and tgname like 'p17r3%')::text as trg",
      ),
    ).join(" ");
    expect(left).toContain("none");
    expect(left).toContain("0");
  });

  test("(g) 카탈로그 — 칸 모양 · 제약 3개 VALID · 트리거가 붙고 켜져 있다 · 함수는 invoker", () => {
    const out = runLocalSql(`select
  (select string_agg(format('%s:null=%s,def=%s', a.attname, (not a.attnotnull)::text, coalesce(pg_get_expr(d.adbin, d.adrelid), 'none')), ' ' order by a.attname)
     from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.reservations'::regclass and a.attname like 'withdrawal_consent%' and not a.attisdropped) as cols,
  (select string_agg(format('%s:%s', conname, convalidated::text), ' ' order by conname) from pg_constraint where conrelid = 'public.reservations'::regclass and conname like 'reservations_withdrawal_consent_%') as cons,
  (select format('trg=%s enabled=%s when=%s fn=%s', tgname, tgenabled, coalesce(pg_get_expr(tgqual, tgrelid), 'none'), tgfoid::regprocedure)
     from pg_trigger where tgrelid = 'public.reservations'::regclass and not tgisinternal and tgname = 'reservations_withdrawal_legacy_guard') as trg,
  (select format('definer=%s', prosecdef::text) from pg_proc where oid = '${GUARD_FN}'::regprocedure) as fn,
  (select coalesce('TRIGGER_PRIV ' || string_agg(format('%s/%s', c.relname, a.grantee::regrole), ' '), 'TRIGGER_PRIV_OWNER_ONLY')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where n.nspname = 'public' and c.relname in ('reservations', 'notifications_log')
      and a.privilege_type = 'TRIGGER' and a.grantee <> c.relowner) as trg_priv`);
    const cells = sqlCells(out).join(" | ");
    expect(cells).toContain("withdrawal_consent_at:null=true,def=none withdrawal_consent_legacy:null=false,def=false");
    expect(cells).toContain(
      "reservations_withdrawal_consent_before_created:true reservations_withdrawal_consent_not_stale:true reservations_withdrawal_consent_required:true",
    );
    expect(cells).toContain("trg=reservations_withdrawal_legacy_guard enabled=O when=none fn=reservations_withdrawal_legacy_guard()");
    expect(cells).toContain("definer=false");
    // R3 [P1-A] — 소유자(postgres) 말고는 아무도 두 표에 TRIGGER 를 갖지 않는다
    expect(cells).toContain("TRIGGER_PRIV_OWNER_ONLY");
  });

  test("(h) runbook 0021 절의 확인 질의(원격에 붙일 원문)가 로컬에서 기대값을 낸다 — 표식 사이 원문을 그대로 돌린다", () => {
    const runbook = read("docs/ops/migration-runbook.md");
    const block = runbook.split("<!-- P17:0021_CHECK_SQL:BEGIN -->")[1]?.split("<!-- P17:0021_CHECK_SQL:END -->")[0] ?? "";
    const sql = block.replace(/^[\s\S]*?```sql\n/, "").replace(/```[\s\S]*$/, "");
    const statements = sql.split(/;\s*\n\s*\n/).map((s) => s.trim().replace(/;$/, "")).filter(Boolean);
    expect(statements).toHaveLength(2);
    // 카탈로그 질의뿐 — 쓰기·잠금·롤 전환 문장이 없다
    for (const s of statements) expect(s).not.toMatch(/\b(insert|update|delete|alter|drop|create|lock|grant|revoke|set\s+role|truncate)\b/i);
    const first = sqlCells(runLocalSql(statements[0])).join(" | ");
    expect(first).toContain("withdrawal_consent_at:null=true,def=none withdrawal_consent_legacy:null=false,def=false");
    expect(first).toContain(
      "reservations_withdrawal_consent_before_created:true reservations_withdrawal_consent_not_stale:true reservations_withdrawal_consent_required:true",
    );
    expect(first).toContain("TRIGGER_OK");
    expect(first).toContain("FN_EXEC_NONE");
    // R3 [P1-A]·[P2-E] — 확인 질의도 TRIGGER 보유자와 WHEN 조건을 본다
    expect(first).toContain("TRIGGER_PRIV_OWNER_ONLY");
    expect(statements[0]).toMatch(/tgqual/);
    const second = sqlCells(runLocalSql(statements[1])).join(" | ");
    expect(second).toMatch(/\b[0-9a-f]{32}\b/);
    // R4 [P2-E] — 해시는 **허용된 차이를 뺀** 집합이어야 한다. 전수 해시를 요구하면 정상 적용이 절차에서 막힌다(0021 은 TRIGGER 두 건을 회수한다).
    expect(statements[1]).toMatch(/not \(c\.relname in \('reservations','notifications_log'\)/);
    expect(statements[1]).toMatch(/a\.privilege_type = 'TRIGGER'/);
  });
});
