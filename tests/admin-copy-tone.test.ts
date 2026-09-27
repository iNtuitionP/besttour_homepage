/**
 * P5-20 — 관리자 문구·알림 (브리프 P5-20 §C · 제안서 ④ 원칙 6 · ⑦ 1-7 문구 사전 · 사용자 결정 "해요체").
 *
 * 이 파일이 잠그는 것
 *   1. 해요체 — messages/ko.json `admin.*` 의 어떤 값도 합쇼체("…니다" · "…십시오")로 끝나는 문장이 없다.
 *      예외는 **목록이 아니라 출처로** 판정한다: 값이 법정 원장(lib/legal/disclosures.ts)의 문자열과 글자 그대로 같으면 원장 문구다(건드리지 않는다).
 *   2. 개발 용어 0 — 발송 대기열 · 상행 · 옛 6단계 · 이미지 경로 · 주소에 쓰는 이름 · slug · 경로
 *   3. 빈 상태 — 방향 지시("왼쪽에서" 등) 없이 다음 행동과 짝짓는다(공지 쓰기 · 팝업 만들기 · 사진 올리기)
 *   4. 결과 알림 — 성공은 토스트(role=status · 3초 · 링크가 있으면 5초), 실패는 그 자리 배너(role=alert · 저절로 닫히지 않음).
 *      P5-19 의 토스트 부품을 관리자 전체(공지·팝업·갤러리·노선)로 넓혔다 — 레이아웃이 자리 하나를 둔다(삭제 뒤 목록으로 옮겨도 남는다).
 *   5. 섹션 제목이 본문보다 작지 않다 · 표 캡션이 섹션 제목을 되풀이하지 않는다
 * tests/ 아래라 게이트 3종의 검사 대상이다 — 금지어·임시값 마커 리터럴을 쓰지 않는다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import * as ledger from "@/lib/legal/disclosures";

import { stripComments } from "./helpers/strip-comments";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

import { AdminToastProvider, AdminToastRegion } from "@/components/admin/AdminToast";
import { feedbackKind, uploadSummary } from "@/components/admin/feedback";
import { TOAST_MS } from "@/components/admin/reservation-sheet";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const ko = JSON.parse(read("messages/ko.json")) as { admin: Record<string, unknown> };

/** JSON 트리의 문자열 잎을 점 경로와 함께. */
function leaves(node: unknown, prefix: string): Array<{ path: string; value: string }> {
  if (typeof node === "string") return [{ path: prefix, value: node }];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${prefix}[${i}]`));
  if (node && typeof node === "object") return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leaves(v, `${prefix}.${k}`));
  return [];
}
const ADMIN = leaves(ko.admin, "admin");

// =============================================================================
// 1. 해요체 — 원장 문구는 출처로 판정해 제외
// =============================================================================
/** 합쇼체 어미 — "…니다"·"…십시오" 가 낱말 끝에 온다(뒤에 문장부호·괄호·따옴표·공백·끝). "다니다가" 같은 낱말 가운데는 아니다. */
const FORMAL = /(니다|십시오)(?=[\s.,!?…)\]"'’」』»]|$)/u;
const isFormal = (value: string): boolean => FORMAL.test(value);

/** 원장(lib/legal/disclosures.ts)이 내보내는 모든 문자열 — 깊이 우선으로 모은다. */
function ledgerStrings(): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") out.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(ledger);
  return out;
}
const LEDGER = ledgerStrings();
/** 출처 판정 — 값이 원장의 문자열과 글자 그대로 같으면 원장 문구다(목록을 손으로 적지 않는다). */
const isLedgerSourced = (value: string): boolean => LEDGER.has(value);

describe("1. 해요체", () => {
  test("판정기 자체 — 합쇼체는 잡고 해요체·낱말 가운데는 놓아준다", () => {
    for (const s of ["저장했습니다.", "삭제하겠습니다 (되돌릴 수 없습니다)", "다시 시도해 주십시오", "노출됩니다", "«지금» 상태입니다."]) expect(isFormal(s), s).toBe(true);
    for (const s of ["저장했어요.", "삭제할게요 (되돌릴 수 없어요)", "다시 눌러 주세요", "학교에 다니다가", "메모 저장", "{n}건"]) expect(isFormal(s), s).toBe(false);
  });

  test("출처 판정 — 원장에 글자 그대로 있는 문장만 예외(합쇼체여도 건드리지 않는다)", () => {
    expect(LEDGER.size, "원장에서 문자열을 하나도 못 모았다").toBeGreaterThan(50);
    expect(isLedgerSourced(ledger.WITHDRAWAL.smsLine)).toBe(true);
    expect(isFormal(ledger.WITHDRAWAL.smsLine), "원장 문장은 합쇼체 — 예외 판정이 실제로 일한다").toBe(true);
    expect(isLedgerSourced("관리자 화면에만 있는 문장입니다.")).toBe(false);
  });

  test("🔴 admin.* 모든 값 — 합쇼체 문장 0 (원장 출처만 예외)", () => {
    expect(ADMIN.length, "admin 잎이 너무 적다 — 경로를 잘못 봤다").toBeGreaterThan(400);
    const offenders = ADMIN.filter((l) => isFormal(l.value) && !isLedgerSourced(l.value)).map((l) => `${l.path} = ${l.value}`);
    expect(offenders).toEqual([]);
  });

  test("원장 라벨을 쓰는 곳(동의·보유)은 원장·기존 값 그대로다", () => {
    const detail = (ko.admin.detail as Record<string, Record<string, string>>).field;
    expect(detail.privacyConsentAt).toBe("개인정보 동의");
    expect(detail.marketingConsentAt).toBe("광고성 정보 수신 동의");
    expect(detail.withdrawalConsentAt).toBe("청약철회 제한 동의");
    expect(detail.retentionUntil).toBe("파기 예정");
    expect((ko.admin.detail as Record<string, string>).sectionConsent).toBe("동의 · 보유");
    expect((ko.admin.detail as Record<string, Record<string, string>>).value.noWithdrawalRecord).toBe("기록 없음(동의 기록 도입 전 접수)");
  });
});

// =============================================================================
// 2. 개발 용어 0 · 문구 사전(제안서 ⑦ 1-7)
// =============================================================================
describe("2. 개발 용어 · 문구 사전", () => {
  const DEV_TERMS = ["발송 대기열", "대기열", "상행", "옛 6단계", "6단계", "이미지 경로", "주소에 쓰는 이름", "slug", "경로"];

  test("🔴 admin.* 에 개발 용어가 없다", () => {
    const hits = ADMIN.flatMap((l) => DEV_TERMS.filter((w) => l.value.includes(w)).map((w) => `${l.path} ∋ ${w}`));
    expect(hits).toEqual([]);
  });

  test("문구 사전 그대로 — 상태 이름 · 결과 · 안내", () => {
    const a = ko.admin as Record<string, Record<string, unknown>>;
    const res = a.reservations as Record<string, Record<string, string>>;
    expect(res.status.new).toBe("새 접수");
    expect(res.status.done).toBe("운행 완료");
    expect(res.filter.new).toBe("새 접수");
    expect(res.filter.done).toBe("운행 완료");
    const detail = a.detail as Record<string, Record<string, string>>;
    expect(detail.value.intakeWizard).toBe("상세 접수");
    expect(detail.value.intakeQuick).toBe("간편 접수 · 전화 확인 필요");
    expect(detail.result.cancelled).toBe("취소했어요. 고객에게 전화로 알려 주세요.");
    expect(detail.result.memoUpdated).toBe("메모를 저장했어요.");
    expect(res.sub).toContain("확정하면 고객에게 확정 안내 문자가 가요.");
    expect((a.gallery as Record<string, string>).albumSlug).toBe("앨범 주소 (영문)");
    expect((a.popups as Record<string, string>).empty).toBe("지금 등록된 팝업이 없어요.");
  });

  test("버튼은 {무엇을}+{하기} · 결과는 '…했어요' 로 짧게(모든 result 가 해요체로 끝난다)", () => {
    const a = ko.admin as Record<string, Record<string, string>>;
    expect(a.notices.new).toBe("공지 쓰기");
    expect(a.popups.new).toBe("팝업 만들기");
    expect(a.gallery.uploadTitle).toBe("사진 올리기");
    expect(a.notices.emptyAction).toBe("공지 쓰기");
    expect(a.popups.emptyAction).toBe("팝업 만들기");
    expect(a.gallery.emptyAction).toBe("사진 올리기");
    const results = ADMIN.filter((l) => /\.result\.\w+$/.test(l.path));
    expect(results.length).toBeGreaterThan(40);
    for (const r of results) expect(r.value, r.path).toMatch(/요[.!]?$/);
  });

  /**
   * 리뷰 P2-8(가볍게): 고치는 화면의 저장 버튼이 "저장하기" 뿐이었고(새로 쓸 때는 "공지 저장하기"), 줄 버튼 "고치기"·"노출하기"·"중지하기" 는
   * 목적어가 없었다. 저장 버튼은 만드는 화면과 같게, 줄 버튼은 무엇을 하는지 목적어와 함께 — "노출 켜기/끄기" 는 노출 칸 안내("끄면 …
   * 다시 켜면 …")와 결과 문구("노출을 다시 켰어요/껐어요")의 말과 같다. "메모 저장"·"사진 삭제"·"앨범 삭제" 는 시안대로 그대로 둔다.
   */
  test("P2-8 — 고치는 화면 저장 = 만드는 화면 저장 · 줄 버튼은 목적어와 함께 · 시안의 세 버튼은 그대로", () => {
    const a = ko.admin as Record<string, Record<string, string>>;
    expect(a.notices.save).toBe(a.notices.create);
    expect(a.popups.save).toBe(a.popups.create);
    expect(a.routes.save).toBe("노선 저장하기");
    expect(a.gallery.save).toBe("사진 정보 저장하기");
    expect(a.gallery.albumSave).toBe("앨범 저장하기");
    expect(a.notices.editLink).toBe("공지 고치기");
    expect(a.popups.editLink).toBe("팝업 고치기");
    expect(a.routes.editLink).toBe("노선 고치기");
    for (const ns of ["notices", "popups", "routes", "gallery"]) {
      expect(a[ns].turnOn, ns).toBe("노출 켜기");
      expect(a[ns].turnOff, ns).toBe("노출 끄기");
    }
    // 결과 문구가 버튼과 같은 말이다(켜기 → 켰어요 · 끄기 → 껐어요)
    for (const ns of ["notices", "popups", "routes", "gallery"]) {
      const r = (a[ns] as unknown as { result: Record<string, string> }).result;
      expect(r.activated, ns).toMatch(/노출을 다시 켰어요\.$/);
      expect(r.deactivated, ns).toMatch(/노출을 껐어요\.$/);
    }
    expect((ko.admin.detail as Record<string, string>).memoSave).toBe("메모 저장");
    expect(a.gallery.delete).toBe("사진 삭제");
    expect(a.gallery.albumDelete).toBe("앨범 삭제");
  });

  /** 재리뷰 P2-R2: 공지 화면 안내가 옛 버튼 이름("노출 중지")을 말하고 있었다 — 버튼 이름("노출 끄기")과 같은 말로 · 매뉴얼 인용도 같은 글자. */
  test("P2-R2 — 공지 화면 안내는 지금 버튼 이름(노출 끄기)을 말한다 · 매뉴얼이 그 안내를 글자 그대로 인용한다", () => {
    const a = ko.admin as Record<string, Record<string, string>>;
    expect(a.notices.sub).toContain(a.notices.turnOff);
    expect(a.notices.sub).not.toMatch(/노출 중지/);
    expect(read("docs/ops/admin-manual.md")).toContain(a.notices.sub);
    // 안내·힌트 어디에도 버튼으로서의 "중지하기"·"노출 중지" 가 남지 않는다(상태 이름 "중지" 는 상태 명사라 그대로)
    const stale = ADMIN.filter((l) => /중지하기|노출 중지/.test(l.value)).map((l) => l.path);
    expect(stale).toEqual([]);
  });

  /** 리뷰 P2-5: 관리자는 여러 명일 수 있다(ADMIN_EMAILS 는 쉼표 목록) — 세션과 무관하게 "사장님" 이라고 하지 않는다. 주소는 여전히 보이지 않는다. */
  test("P2-5 — 계정 안내는 사실만: '관리자 계정으로 로그인 중'", () => {
    expect((ko.admin.tabs as Record<string, string>).account).toBe("관리자 계정으로 로그인 중");
  });
});

// =============================================================================
// 3. 빈 상태 — 방향 지시 없이 다음 행동과 짝
// =============================================================================
describe("3. 빈 상태", () => {
  test("🔴 빈 상태 문구(…empty…)에 방향 지시(왼쪽·오른쪽·위·아래에서)가 없다", () => {
    const empties = ADMIN.filter((l) => /\.(\w*[eE]mpty\w*)$/.test(l.path));
    expect(empties.length).toBeGreaterThanOrEqual(8);
    const hits = empties.filter((l) => /(왼쪽|오른쪽|위|아래)\s*(에서|쪽)/.test(l.value)).map((l) => `${l.path} = ${l.value}`);
    expect(hits).toEqual([]);
  });

  test.each([
    ["app/admin/(protected)/notices/page.tsx", "#notice-title", "components/admin/NoticeForm.tsx", 'id="notice-title"'],
    ["app/admin/(protected)/popups/page.tsx", "#popup-title", "components/admin/PopupForm.tsx", 'id="popup-title"'],
    ["app/admin/(protected)/gallery/page.tsx", "#gallery-upload-input", "components/admin/GalleryUploader.tsx", 'id="gallery-upload-input"'],
  ])("%s — 빈 상태에 다음 행동 링크(%s)가 있고, 그 자리가 실제 입력칸이다", (page, anchor, form, id) => {
    const src = codeOf(page);
    expect(src).toContain(`href="${anchor}"`);
    expect(src).toMatch(/t\("emptyAction"\)/);
    expect(codeOf(form)).toContain(id);
  });

  test("접수 목록 — 걸러 본 상태가 비었으면 '전체 보기'(필터 지우기), 아무것도 없으면 다른 문장", () => {
    const src = codeOf("app/admin/(protected)/reservations/page.tsx");
    expect(src).toMatch(/t\("clearFilter"\)/);
    expect(src).toMatch(/t\("emptyAll"\)/);
  });
});

// =============================================================================
// 4. 결과 알림 — 성공은 토스트, 실패는 배너
// =============================================================================
describe("4. 결과 알림", () => {
  test("feedbackKind — 바뀐 성공은 토스트 · 저장 전 확인(copyWarning)은 패널이 말한다 · 나머지는 배너", () => {
    expect(feedbackKind({ ok: true, changed: true, code: "updated" })).toBe("toast");
    expect(feedbackKind({ ok: true, changed: false, code: "copyWarning" })).toBe("none");
    for (const code of ["notFound", "validation", "failed", "duplicate", "fileFailed"]) {
      expect(feedbackKind({ ok: false, changed: false, code }), code).toBe("banner");
    }
    // 바뀐 것이 없는 성공 모양(ok · changed=false)은 성공 알림이 아니다 — 배너로 알린다
    expect(feedbackKind({ ok: true, changed: false, code: "notFound" })).toBe("banner");
  });

  test("토스트 시간은 P5-19 와 같은 상수 — 3초, 링크가 붙으면 5초", () => {
    expect(TOAST_MS).toEqual({ plain: 3000, withLink: 5000 });
    expect(codeOf("components/admin/AdminToast.tsx")).toMatch(/TOAST_MS|toastDurationMs/);
  });

  test("토스트 자리 — role=status · aria-live=polite · 처음부터 있다(비어 있음) · 공급자는 자리 하나와 본문을 함께 그린다", () => {
    const empty = renderToStaticMarkup(createElement(AdminToastRegion, { toast: null, onDone: () => {} }));
    expect(empty).toMatch(/role="status"/);
    expect(empty).toMatch(/aria-live="polite"/);
    expect(empty).not.toContain('data-testid="admin-toast"');
    const withChild = renderToStaticMarkup(createElement(AdminToastProvider, null, createElement("p", null, "BODY")));
    expect(withChild).toContain("BODY");
    expect((withChild.match(/role="status"/g) ?? []).length).toBe(1);
  });

  const WIRED = [
    "components/admin/NoticeForm.tsx",
    "components/admin/NoticeToggle.tsx",
    "components/admin/PopupForm.tsx",
    "components/admin/PopupToggle.tsx",
    "components/admin/RouteForm.tsx",
    "components/admin/RouteToggle.tsx",
    "components/admin/GalleryPhotoCard.tsx",
    "components/admin/GalleryAlbums.tsx",
  ];

  test.each(WIRED)("%s — 성공은 토스트(useAdminToast · show) · 실패는 배너(공용 AdminBanner — role=alert · 나타날 때 스크롤) · 옛 결과 한 줄(role=status 알림)은 없다", (rel) => {
    const src = codeOf(rel);
    expect(src).toMatch(/useAdminToast\(\)/);
    expect(src).toMatch(/feedbackKind\(/);
    expect(src).toMatch(/\.show\(/);
    expect(src).toMatch(/<AdminBanner\b/);
    expect(src).not.toMatch(/setNotice\(/);
    expect(src).not.toMatch(/className=\{s\.notice\}\s+role="status"/);
  });

  test("업로더 — 한 장씩의 진행 목록은 그대로, 다 올린 뒤 성공 장수를 토스트로(카탈로그 uploadDone)", () => {
    const src = codeOf("components/admin/GalleryUploader.tsx");
    expect(src).toMatch(/useAdminToast\(\)/);
    expect(src).toMatch(/toast\.show\(\{ text: labels\.done\.replace\("\{ok\}", String\(ok\)\) \}\)/);
    expect(codeOf("app/admin/(protected)/gallery/page.tsx")).toMatch(/done: t\.raw\("uploadDone"\)/);
    expect((ko.admin.gallery as Record<string, string>).uploadDone).toBe("{ok}장을 올렸어요.");
  });

  /**
   * 🔴 리뷰 P2-6: 한 장이라도 올라가면 토스트가 뜨지만, **전부 실패하면** 토스트도 role=alert 도 없었다(줄마다 이유만 적힘).
   * 전부 실패 → 요약 배너 · 일부 실패 → 성공 토스트와 함께 "N장은 올리지 못했어요" 배너(실패 = 배너 원칙 그대로).
   * 진행 목록은 polite 라이브 영역이라 한 장씩의 결과가 스크린리더에 읽힌다.
   */
  test("🔴 uploadSummary — 전부 실패 · 일부 실패 · 실패 없음(0장 선택 포함)", () => {
    expect(uploadSummary(0, 3)).toEqual({ kind: "allFailed", failed: 3 });
    expect(uploadSummary(2, 1)).toEqual({ kind: "someFailed", failed: 1 });
    expect(uploadSummary(3, 0)).toBeNull();
    expect(uploadSummary(0, 0)).toBeNull();
  });

  test("🔴 업로더 — 실패 요약은 공용 배너(AdminBanner) · 진행 목록은 aria-live=polite · 문구는 카탈로그(해요체 · {n})", () => {
    const src = codeOf("components/admin/GalleryUploader.tsx");
    expect(src).toMatch(/uploadSummary\(/);
    expect(src).toMatch(/<AdminBanner\b[^>]*testId="admin-gallery-upload-banner"/);
    expect(src).toMatch(/<ul className=\{s\.uploadList\}[^>]*aria-live="polite"/);
    const g = ko.admin.gallery as Record<string, string>;
    expect(g.uploadFailedAll).toMatch(/요\.$/);
    expect(g.uploadFailedSome).toContain("{n}장");
    expect(g.uploadFailedSome).toMatch(/요\.$/);
    const page = codeOf("app/admin/(protected)/gallery/page.tsx");
    expect(page).toMatch(/failedAll: t\("uploadFailedAll"\)/);
    expect(page).toMatch(/failedSome: t\.raw\("uploadFailedSome"\)/);
  });
});

// =============================================================================
// 5. 타이포 위계 · 캡션 중복
// =============================================================================
describe("5. 섹션 제목 · 캡션", () => {
  const css = codeOf("components/admin/admin.module.css");
  const block = (sel: string) => new RegExp(`(^|\\})\\s*${sel.replace(/[.[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m").exec(css)?.[2] ?? "";
  const px = (body: string, prop: string) => Number(new RegExp(`${prop}\\s*:\\s*([\\d.]+)px`).exec(body)?.[1] ?? NaN);

  test("🔴 섹션 제목은 본문(15px)보다 작지 않다 — 13px 이던 것을 키웠다", () => {
    const title = px(block(".sectionTitle"), "font-size");
    const bodyText = px(block(".dd"), "font-size");
    expect(title).toBeGreaterThanOrEqual(bodyText);
    expect(title).toBeGreaterThanOrEqual(16);
  });

  test.each(["app/admin/(protected)/notices/page.tsx", "app/admin/(protected)/popups/page.tsx", "app/admin/(protected)/routes/page.tsx"])(
    "%s — 표 이름은 섹션 제목을 가리키고(aria-labelledby) 같은 말의 캡션을 또 적지 않는다",
    (rel) => {
      const src = codeOf(rel);
      expect(src).not.toMatch(/<caption>\{t\("listLabel"\)\}<\/caption>/);
      expect(src).toMatch(/aria-labelledby=/);
    },
  );

  test("통계의 구간 표도 같은 규칙 · 제목이 따로 없는 표(접수 목록 · 문자 기록)는 캡션을 화면에서만 숨긴다", () => {
    expect(codeOf("app/admin/(protected)/stats/page.tsx")).not.toMatch(/<caption>\{t\("inquiry\.segments"\)\}<\/caption>/);
    for (const rel of ["app/admin/(protected)/reservations/page.tsx", "app/admin/(protected)/notifications/page.tsx"]) {
      expect(codeOf(rel), rel).toMatch(/<caption className=\{a\.srOnly\}>/);
    }
    expect(block(".srOnly")).toMatch(/clip|clip-path/);
  });
});
