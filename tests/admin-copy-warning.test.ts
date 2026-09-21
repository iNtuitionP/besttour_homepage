/**
 * P6-12 — 사장님이 관리자 화면에서 쓰는 글에 **경고**를 붙인다 (known-defects D4) + 카피 잔여 2건.
 *
 * 무엇을 잠그나
 *   1. 목록은 한 벌이다 — 정의는 lib/copy/rules.ts 하나, tests/helpers/forbidden-copy.ts 는 re-export 뿐
 *   2. 경고 흐름 — 걸리면 **저장하지 않고** 확인을 요청하고, 확인하면 **저장한다**(차단이 아니다)
 *   3. 정당한 운영 글 픽스처(대표전화·요금 안내·행사 공지 …) → 경고 0 · 금액·연락처 규칙은 대조하지 않는다
 *   4. 공개 화면으로 새지 않는다 — 공개 코드는 경고 모듈을 모르고, 저장되는 글자는 입력 그대로다
 *   5. 목록이 클라이언트 번들로 가는 import 경로가 없다(빌드 실측은 보고서)
 *   6. 카피 2건 — 빼기만 했고 새 주장을 넣지 않았다
 *   7. 문구 — 화면 사유 문장이 운영 매뉴얼 4장과 **같은 말**이다
 *
 * DB 없음 — 액션은 기존 admin 테스트와 같은 방식으로 세션 클라이언트를 스텁한다.
 * 금지어 리터럴은 적지 않는다(이 파일도 check-legal-disclosures (c) 대상) — FORBIDDEN_WORDS 에서 꺼내 조립한다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/supabase/ssr", () => ({ createSsrClient: vi.fn() }));
vi.mock("@/lib/auth/requireAdmin", () => ({
  requireAdmin: vi.fn(async () => ({ userId: "admin-uuid", email: "owner@example.test" })),
}));
vi.mock("@/lib/ports/after", () => ({ runAfter: vi.fn((task: () => unknown) => void task()) }));
vi.mock("@/lib/ports/revalidate", () => ({ revalidate: vi.fn() }));
vi.mock("@/lib/log", () => ({ structuredLog: vi.fn() }));

import { revalidatePath } from "next/cache";

import { createGalleryAlbum, recordGalleryUpload, updateGalleryAlbum, updateGalleryPhoto } from "@/actions/admin/gallery";
import { createNotice, updateNotice } from "@/actions/admin/notice";
import { createPopup, updatePopup } from "@/actions/admin/popup";
import { copyAckKey, findCopyWarnings, holdForCopy } from "@/lib/admin/copyCheck";
import {
  COPY_ACK_FIELD,
  COPY_FIELDS,
  COPY_WARNING_MAX,
  copyHold,
  fillCopyWarningItem,
  mergeCopyAck,
  readCopyAckForm,
  readCopyAckValue,
} from "@/lib/admin/copyWarning";
import { buildUploadPaths } from "@/lib/admin/galleryInput";
import { commitUpload } from "@/lib/admin/galleryUpload";
import { NOTICE_FIELDS } from "@/lib/admin/noticeInput";
import { POPUP_FIELDS } from "@/lib/admin/popupInput";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { OWNER_COPY_KINDS } from "@/lib/copy/kinds";
import { normalizeForCopyMatch } from "@/lib/copy/normalize";
import * as rules from "@/lib/copy/rules";
import {
  COMPARATIVE_CLAIMS,
  COMPARATIVE_CLAIMS_EN,
  CONTACT_LITERALS,
  FORBIDDEN_WORD_KINDS,
  FORBIDDEN_WORDS,
  OWNER_COPY_RULES,
  OWNER_TEXT_EXEMPT,
  PRICE_LITERALS,
  UNPROVEN_CLAIMS,
} from "@/lib/copy/rules";
import { COMPANY } from "@/lib/legal/disclosures";
import { structuredLog } from "@/lib/log";
import { revalidate } from "@/lib/ports/revalidate";
import { createSsrClient } from "@/lib/supabase/ssr";

import * as helper from "./helpers/forbidden-copy";
import { stripComments } from "./helpers/strip-comments";

// =============================================================================
// 공통
// =============================================================================
const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const toPosix = (p: string) => p.split(path.sep).join("/");

function walk(absDir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(absDir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = path.join(absDir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const sourcesUnder = (dirs: readonly string[]) =>
  dirs.flatMap((d) =>
    walk(path.join(ROOT, d))
      .map((p) => toPosix(path.relative(ROOT, p)))
      .filter((f) => /\.(tsx?|mjs|cjs|js)$/.test(f)),
  );

const APP_DIRS = ["app", "lib", "actions", "components", "i18n"] as const;
const appFiles = [...sourcesUnder(APP_DIRS), "middleware.ts"];
/** 주석 제거는 비싸다 — 같은 파일을 여러 단언이 다시 보므로 기억해 둔다. */
const codeCache = new Map<string, string>();
const codeOf = (rel: string): string => {
  let code = codeCache.get(rel);
  if (code === undefined) {
    code = stripComments(read(rel), rel);
    codeCache.set(rel, code);
  }
  return code;
};

// 금지어는 목록에서 꺼낸다(리터럴 금지) — FORBIDDEN_WORD_KINDS 의 순서: 면허 · 타사 · BM 4종
const wordOf = (kind: string, nth = 0) => FORBIDDEN_WORD_KINDS.filter(([, k]) => k === kind)[nth][0];
const W_LICENSE = wordOf("license");
const W_RIVAL = wordOf("rival");
const W_BM = [0, 1, 2, 3].map((i) => wordOf("internal", i));
/** "운전" — 금지어의 좁힘 대상. 목록의 좁힘 표에서 꺼낸다. */
const DRIVING = rules.OWNER_WORD_NOT_AFTER[0][1];

/** 서버가 만드는 확인 키 그대로 — (칸, 원문 글, 걸린 표현). 글은 서버처럼 정규화해서 넣는다. */
const ackKey = (field: (typeof COPY_FIELDS)[number], rawText: string, hit: string) =>
  copyAckKey(field, normalizeForCopyMatch(rawText), hit);

const kindsOf = (text: string, field: (typeof COPY_FIELDS)[number] = "body") => findCopyWarnings({ [field]: text }).map((w) => w.kind);

// =============================================================================
// 1. 목록은 한 벌이다
// =============================================================================
// 파일 전수를 읽는 묶음 — 전량 실행(파일 60개 병렬)에서는 단독 실행보다 몇 배 느리다. 기본 5초로는 흔들린다.
describe("1. 단일 원장 — 정의는 lib/copy/rules.ts 하나", { timeout: 60_000 }, () => {
  const LIST_NAMES = ["FORBIDDEN_WORDS", "UNPROVEN_CLAIMS", "COMPARATIVE_CLAIMS", "COMPARATIVE_CLAIMS_EN", "PRICE_LITERALS", "CONTACT_LITERALS", "COPY_ALLOWLIST"];
  const DEF = new RegExp(`\\b(const|let|var)\\s+(${LIST_NAMES.join("|")}|FORBIDDEN|UNPROVEN|PRICE_TABLE)\\s*[:=]`);
  /** 원문으로 먼저 거르고(빠르다), 걸린 파일만 주석을 걷어 다시 본다 — 전량 실행에서 파일 수백 개를 주석 제거하면 시간 초과가 난다. */
  const definesList = (f: string) => DEF.test(read(f)) && DEF.test(codeOf(f));

  test("앱 코드(app·lib·actions·components·i18n·middleware)와 scripts 에서 목록 정의는 rules.ts 하나", () => {
    const files = [...appFiles, ...sourcesUnder(["scripts"])];
    expect(files.length, "검사 대상이 비었다").toBeGreaterThan(150);
    expect(files.filter(definesList)).toEqual(["lib/copy/rules.ts"]);
  });

  /**
   * tests/ 쪽 — P6-6 이전부터 있던 **로컬 사본 다섯 개**가 남아 있다(P6-6 은 home·pages 만 통합했다).
   * 전부 금지어 6종(또는 그 부분집합 + 파일 고유 낱말)을 자기 파일에 다시 적은 것이다. 이 태스크는 그 파일들을 고치지 않는다 —
   * tests/admin-notifications.test.ts 는 다음 태스크의 편집 대상이라 손대지 말라는 지시가 있었다(P6-12 브리프 "하지 말 것").
   * 대신 **목록을 고정한다**: 여기에 없는 새 사본이 생기면 실패한다. 후속 태스크가 각 파일을 re-export 로 바꾸면 이 표에서 지운다.
   */
  const KNOWN_TEST_LOCAL_COPIES = [
    "tests/admin-notifications.test.ts", // const FORBIDDEN_WORDS = new RegExp([...6종].join("|"))
    "tests/layout.test.ts", // const UNPROVEN = [연중무휴·24시간·운행 13년·대 보유·누적] (레이아웃 전용 좁은 목록)
    "tests/legal.test.ts", // const FORBIDDEN = [6종 + 70만 + 4,800]
    "tests/quote-wizard.test.ts", // const FORBIDDEN = [6종 — 코드포인트 조립]
    "tests/reservation-check.test.ts", // const FORBIDDEN = [6종] · const UNPROVEN = [5종]
  ];

  test("tests/ 의 목록 정의는 helpers 입구가 아니라 **알려진 옛 사본 다섯 곳**뿐이다 — 새 사본 금지", () => {
    const files = sourcesUnder(["tests"]).filter((f) => f !== "tests/admin-copy-warning.test.ts");
    expect(files.length).toBeGreaterThan(50);
    const hits = files.filter(definesList);
    expect(hits).toEqual(KNOWN_TEST_LOCAL_COPIES);
    expect(hits).not.toContain("tests/helpers/forbidden-copy.ts");
  });

  test("tests/helpers/forbidden-copy.ts 는 re-export 뿐이다 — 정규식·배열 리터럴 0", () => {
    const code = codeOf("tests/helpers/forbidden-copy.ts");
    expect(code).toMatch(/from\s+["']@\/lib\/copy\/rules["']/);
    expect(code).not.toMatch(/\/[^/\n]+\/[gimsuy]*\s*[\],]/); // 정규식 리터럴
    expect(code).not.toMatch(/=\s*\[/); // 배열 정의
    expect(code).not.toMatch(/fromCharCode/);
  });

  test("테스트 입구와 앱 모듈은 **같은 객체**다 (복사본이 아니다)", () => {
    expect(helper.FORBIDDEN_WORDS).toBe(rules.FORBIDDEN_WORDS);
    expect(helper.UNPROVEN_CLAIMS).toBe(rules.UNPROVEN_CLAIMS);
    expect(helper.COMPARATIVE_CLAIMS).toBe(rules.COMPARATIVE_CLAIMS);
    expect(helper.COMPARATIVE_CLAIMS_EN).toBe(rules.COMPARATIVE_CLAIMS_EN);
    expect(helper.PRICE_LITERALS).toBe(rules.PRICE_LITERALS);
    expect(helper.CONTACT_LITERALS).toBe(rules.CONTACT_LITERALS);
    expect(helper.COPY_ALLOWLIST).toBe(rules.COPY_ALLOWLIST);
  });

  test("FORBIDDEN_WORDS 는 FORBIDDEN_WORD_KINDS 에서 파생된다(순서까지 같다) · 빈 목록 통과 방지", () => {
    expect(FORBIDDEN_WORDS).toEqual(FORBIDDEN_WORD_KINDS.map(([w]) => w));
    expect(FORBIDDEN_WORDS.length).toBeGreaterThanOrEqual(6);
    expect(UNPROVEN_CLAIMS.length).toBeGreaterThanOrEqual(29);
    expect(COMPARATIVE_CLAIMS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(FORBIDDEN_WORD_KINDS.map(([, k]) => k))).toEqual(new Set(["license", "rival", "internal"]));
  });

  test("rules.ts 코드 줄에 금지어 리터럴이 없다 (게이트가 자기 자신을 잡지 않게 — 규약 1)", () => {
    const code = codeOf("lib/copy/rules.ts");
    for (const w of FORBIDDEN_WORDS) expect(code.includes(w), "금지어 리터럴").toBe(false);
    // (d) 실증 불가 주장 7종도 원문으로 이어져 있지 않다
    for (const claim of ["4,800", "누적 견적", "누적 운행", "업계 1위", "국내 최대", "최저가 보장", "무사고"]) {
      expect(code.includes(claim), claim).toBe(false);
    }
  });
});

// =============================================================================
// 2. 앱 쪽 import 경계 — 목록이 브라우저로 가는 길이 없다
// =============================================================================
describe("2. import 경계 — 목록은 server-only 한 곳으로만 들어온다", { timeout: 60_000 }, () => {
  // import 문이 없는 파일은 주석 제거를 건너뛴다(빠른 길) — 결과는 같다.
  const importsOf = (rel: string) =>
    !/\bimport\b/.test(read(rel)) ? [] : [...codeOf(rel).matchAll(/^\s*import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => ({ typeOnly: !!m[1], spec: m[2] }));
  const resolvesTo = (rel: string, spec: string, target: string) => {
    if (spec === `@/${target}`) return true;
    if (spec.startsWith(".")) return toPosix(path.join(path.dirname(rel), spec)) === target;
    return false;
  };

  test("lib/copy/rules 를 값으로 import 하는 앱 파일은 lib/admin/copyCheck.ts 하나", () => {
    const importers = appFiles.filter((f) => importsOf(f).some((i) => !i.typeOnly && resolvesTo(f, i.spec, "lib/copy/rules")));
    expect(importers).toEqual(["lib/admin/copyCheck.ts"]);
  });

  test("copyCheck.ts 는 server-only 이고, 그것을 부르는 곳은 'use server' 액션 셋뿐이다", () => {
    expect(read("lib/admin/copyCheck.ts")).toMatch(/^import "server-only";$/m);
    const importers = appFiles.filter((f) => importsOf(f).some((i) => resolvesTo(f, i.spec, "lib/admin/copyCheck")));
    expect(importers.sort()).toEqual(["actions/admin/gallery.ts", "actions/admin/notice.ts", "actions/admin/popup.ts"]);
    for (const f of importers) expect(read(f).split("\n")[0].trim(), f).toMatch(/^["']use server["'];?$/);
  });

  test("클라이언트 컴포넌트('use client')는 rules·copyCheck 를 import 하지 않는다 · 클라이언트가 쓰는 copyWarning.ts 도 rules 를 모른다", () => {
    const clients = appFiles.filter((f) => /^["']use client["']/.test(read(f).trimStart()));
    expect(clients.length).toBeGreaterThan(5);
    for (const f of clients) {
      for (const i of importsOf(f)) {
        expect(resolvesTo(f, i.spec, "lib/copy/rules"), `${f} → ${i.spec}`).toBe(false);
        expect(resolvesTo(f, i.spec, "lib/admin/copyCheck"), `${f} → ${i.spec}`).toBe(false);
      }
    }
    for (const f of ["lib/admin/copyWarning.ts", "lib/copy/kinds.ts", "components/admin/CopyWarningPanel.tsx", "components/admin/copyWarningLabels.ts"]) {
      expect(importsOf(f).some((i) => /copy\/rules|copyCheck/.test(i.spec)), f).toBe(false);
    }
    // kinds.ts 는 낱말이 없다 — 분류 이름만
    expect(codeOf("lib/copy/kinds.ts")).not.toMatch(/[가-힣]/);
  });

  test("관리자 액션의 첫 문장은 여전히 게이트다 (대조는 게이트·zod 뒤)", () => {
    for (const [file, names] of [
      ["actions/admin/notice.ts", ["createNotice", "updateNotice"]],
      ["actions/admin/popup.ts", ["createPopup", "updatePopup"]],
      ["actions/admin/gallery.ts", ["recordGalleryUpload", "updateGalleryPhoto", "createGalleryAlbum", "updateGalleryAlbum"]],
    ] as const) {
      const code = codeOf(file);
      for (const name of names) {
        const body = new RegExp(`export async function ${name}\\([^)]*\\)[^{]*\\{\\s*await requireAdmin\\(\\);[^]*?const parsed =[^\\n]+\\n\\s*if \\(!parsed\\.(ok|success)\\)[^\\n]+\\n\\s*const held = holdForCopy\\(`);
        expect(code, `${file} ${name}`).toMatch(body);
      }
    }
  });
});

// =============================================================================
// 3. 무엇을 대조하나 — 세 목록에서 파생, 금액·연락처·영문은 뺀다
// =============================================================================
describe("3. OWNER_COPY_RULES — 파생 · 제외 목록과 이유", () => {
  const exempt = new Set(OWNER_TEXT_EXEMPT.map((e) => e.label));

  test("규칙 수 = 금지어 + (실증 불가 − 제외) + 비교", () => {
    expect(OWNER_COPY_RULES.length).toBe(FORBIDDEN_WORDS.length + UNPROVEN_CLAIMS.length - exempt.size + COMPARATIVE_CLAIMS.length);
    const labels = new Set(OWNER_COPY_RULES.map((r) => r.label));
    for (const [label] of [...UNPROVEN_CLAIMS, ...COMPARATIVE_CLAIMS]) expect(labels.has(label), label).toBe(!exempt.has(label));
    for (const [label] of [...PRICE_LITERALS, ...COMPARATIVE_CLAIMS_EN]) expect(labels.has(label), label).toBe(false);
    for (const [label] of CONTACT_LITERALS) expect(labels.has(label), label).toBe(false);
  });

  test("제외 항목마다 실재 라벨 + 이유가 있다 · 제외는 두 건뿐", () => {
    expect(OWNER_TEXT_EXEMPT.length).toBe(2);
    const known = new Set(UNPROVEN_CLAIMS.map(([l]) => l));
    for (const e of OWNER_TEXT_EXEMPT) {
      expect(known.has(e.label), e.label).toBe(true);
      expect(e.reason.trim().length, e.label).toBeGreaterThan(30);
    }
  });

  test("분류는 다섯 개이고, 규칙마다 하나다 · g 플래그 없음", () => {
    expect([...OWNER_COPY_KINDS]).toEqual(["license", "rival", "internal", "unproven", "comparative"]);
    expect(new Set(OWNER_COPY_RULES.map((r) => r.kind))).toEqual(new Set(OWNER_COPY_KINDS));
    for (const r of OWNER_COPY_RULES) expect(r.pattern.global, r.label).toBe(false);
  });

  test("연락처·등록번호 원장 값을 공지에 적어도 경고가 없다", () => {
    for (const [label, literal] of CONTACT_LITERALS) {
      expect(literal.trim().length, label).toBeGreaterThan(0);
      expect(findCopyWarnings({ body: `문의는 ${literal} 로 주세요.` }), label).toEqual([]);
    }
  });
});

// =============================================================================
// 4. 잡아야 할 것을 잡는다
// =============================================================================
describe("4. 경고가 나온다 — 분류까지 맞게", () => {
  const CATCHES: ReadonlyArray<readonly [text: string, kind: string]> = [
    [`${W_LICENSE} 보유 업체입니다`, "license"],
    [`정식 ${W_LICENSE} 업체`, "license"],
    [`${W_RIVAL}와 제휴했습니다`, "rival"],
    [`${W_BM[0]} 시간에 맞춰 할인`, "internal"],
    [`${W_BM[0].replace(" ", "")} 특가`, "internal"], // 띄어쓰기를 빼도 잡는다
    [`손님을 ${W_BM[1]}는 길에`, "internal"],
    [`${W_BM[2]} 운행 특가`, "internal"],
    [`${W_BM[3]} 차량 특가`, "internal"],
    ["업계 1위 전세버스", "comparative"],
    ["최저가 보장합니다", "comparative"],
    ["가장 저렴한 견적", "comparative"],
    ["국내 최대 규모", "comparative"],
    ["가장 인기 있는 차량", "comparative"],
    ["무사고 운행 10년", "unproven"],
    ["누적 4,800건 운행", "unproven"],
    ["보유 차량 50대 보유", "unproven"],
    ["오랜 경력의 기사님", "unproven"],
    ["외국인 투어로 다져온 운행 기준", "unproven"],
    ["노하우를 쌓아 온 회사", "unproven"],
    ["DVD·노래방 시스템 완비", "unproven"],
    ["전 차량 종합보험 가입", "unproven"],
    ["투명한 요금 안내", "unproven"],
  ];

  test.for(CATCHES.map((c) => [c[0], c[1]] as const))("%s → %s", ([text, kind]) => {
    expect(kindsOf(text)).toContain(kind);
  });

  test("네 칸 모두 대조한다 — 제목·내용·사진 설명·앨범 이름", () => {
    for (const field of COPY_FIELDS) {
      const w = findCopyWarnings({ [field]: "업계 1위" });
      expect(w, field).toHaveLength(1);
      expect(w[0]).toEqual({ key: ackKey(field, "업계 1위", "업계 1위"), field, kind: "comparative", text: "업계 1위" });
    }
  });

  test("걸린 글자만 싣는다(문장 전체가 아니다) · 칸 순서대로 · 같은 칸·같은 글자는 한 줄", () => {
    const w = findCopyWarnings({ title: "최저가 보장 이벤트", body: "무사고 기사님" });
    // `최저` 와 `최저가 보장` 두 규칙이 같은 칸에서 **다른** 글자를 잡는다 — 둘 다 보인다
    expect(w.map((x) => [x.field, x.text])).toEqual([
      ["title", "최저"],
      ["title", "최저가 보장"],
      ["body", "무사고"],
    ]);
    // `누적`(단독 규칙)과 `4,800 …누적 견적…` 규칙은 다른 글자를 잡는다. 같은 글자를 두 규칙이 잡는 경우는 한 줄로 합친다:
    // `운행 경력` 과 `오랜 경력` 은 겹치지 않지만, 같은 칸에서 같은 글자를 두 번 넣어도 한 줄이다.
    const twice = findCopyWarnings({ body: "무사고 · 무사고" });
    expect(twice).toHaveLength(1);
  });

  test("자모 분해(NFD)로 들어와도 잡는다", () => {
    expect(kindsOf("업계 1위".normalize("NFD"))).toEqual(["comparative"]);
  });
});

// =============================================================================
// 5. 정당한 운영 글은 걸리지 않는다 (오탐 0)
// =============================================================================
describe("5. 정당한 운영 글 픽스처 — 경고 0", () => {
  // 사장님이 실제로 쓰실 법한 문장이다. 금액·연락처·날짜·운행 안내가 섞여 있다.
  const LEGIT: readonly string[] = [
    `추석 연휴 운행 안내 — 연휴 기간 문의는 대표전화 ${COMPANY.tel} 로 주세요.`,
    "성수기(7월 20일~8월 31일) 요금 안내: 45인승 당일 왕복 1,200,000원부터, 주차료·통행료 별도입니다.",
    "운행 시간이 10시간을 초과하면 기사님 대기 요금이 추가됩니다.",
    "성수기에는 요금표가 달라질 수 있어 견적서로 따로 안내드립니다. 10% 계약금 입금 후 확정됩니다.",
    "외국인 관광객 단체 의전 예약을 받습니다. 영어 안내가 가능한 기사님을 배정해 드립니다.",
    "베스트투어는 2013년부터 전세버스 알선을 해 왔습니다.",
    `기사님은 모두 대형 ${DRIVING}${W_LICENSE}와 버스운전 자격을 갖추고 있습니다.`,
    "내일 아침 최저기온 영하 10도 예보로 출발 시각이 30분 늦춰질 수 있습니다.",
    "공항 픽업·샌딩 (송영 전문) — 새벽 5시 인천공항 도착편도 배차합니다.",
    "최대 45명까지 탑승하실 수 있습니다. 짐이 많으시면 한 단계 큰 차를 권해 드립니다.",
    "인천공항 제1터미널 3층 14번 출구 앞에서 기사님이 기다립니다.",
    "통신판매업 신고번호가 바뀌었습니다. 하단 사업자 정보를 확인해 주세요.",
    "2026 봄 단체여행",
    "제주 가족여행 3박 4일",
    "안전 운행에 최선을 다합니다.",
    "차량 보험에 가입되어 있으며, 원하시면 보험 서류를 보내 드립니다.",
    "11월 1일부터 입금 계좌가 바뀝니다. 기존 계좌로 보내신 분은 연락 주세요.",
    "이전 차량보다 좌석 간격이 넓은 우등 차량으로 바뀌었습니다.",
    "출발 10분 전까지 탑승 장소에 와 주세요.",
    "합리적인 견적으로 상담해 드립니다.",
  ];

  test("픽스처는 10개 이상이다", () => {
    expect(LEGIT.length).toBeGreaterThanOrEqual(10);
  });

  test.for(LEGIT.map((s) => [s] as const))("경고 없음 — %s", ([text]) => {
    for (const field of COPY_FIELDS) {
      const hit = findCopyWarnings({ [field]: text });
      expect(hit, `${field}: ${hit.map((w) => w.text).join(", ")}`).toEqual([]);
    }
  });

  // 알고 남겨 둔 오탐 — 경고는 **나온다**. 저장은 한 번 더 누르면 되고, 규칙을 좁히면 진짜 주장까지 놓친다(보고서 ⑧).
  // 이 표가 깨지면(=경고가 사라지면) 누군가 규칙을 좁힌 것이다 — 의도였는지 확인하라.
  const TOLERATED: ReadonlyArray<readonly [text: string, reason: string]> = [
    ["전 차량 금연입니다.", "전칭 규칙 — '전 차량 종합보험'과 같은 모양이라 문맥 없이는 가를 수 없다"],
    ["가장 많이 묻는 질문 모음", "순위 규칙 — '가장 많이 찾는 차량'과 같은 모양"],
    ["눈길 사고 없이 안전하게 다녀오세요.", "안전 주장 규칙 — '사고 없는 회사'와 같은 모양"],
  ];
  test.for(TOLERATED.map((t) => [t[0], t[1]] as const))("알고 남긴 오탐 — %s (%s)", ([text]) => {
    expect(kindsOf(text)).toHaveLength(1);
  });
});

// =============================================================================
// 6. 확인 흐름 — 저장 전 확인, 막지 않는다
// =============================================================================
describe("6. holdForCopy · 확인 키", () => {
  test("걸린 것이 없으면 null(바로 저장)", () => {
    expect(holdForCopy({ title: "추석 연휴 운행 안내", body: "연휴에도 예약을 받습니다." }, new Set())).toBeNull();
    expect(holdForCopy({ caption: null, albumTitle: undefined }, new Set())).toBeNull();
  });

  test("걸렸는데 확인이 없으면 멈추고, 전부 확인하면 저장한다", () => {
    const fields = { title: "업계 1위", body: "무사고 운행" };
    const held = holdForCopy(fields, new Set());
    expect(held).toMatchObject({ ok: true, changed: false, code: "copyWarning" });
    const keys = new Set(held!.copyWarnings.map((w) => w.key));
    expect(holdForCopy(fields, keys)).toBeNull();
  });

  test("일부만 확인했으면 다시 멈추고, 확인하지 않은 것을 앞에 싣는다", () => {
    const fields = { title: "업계 1위", body: "무사고 운행" };
    const held = holdForCopy(fields, new Set([ackKey("title", "업계 1위", "업계 1위")]));
    expect(held?.copyWarnings.map((w) => w.text)).toEqual(["무사고", "업계 1위"]);
  });

  test("확인한 뒤 글을 고쳐 **다른** 표현을 쓰면 다시 묻는다 — 확인은 옛 글에 묶여 있어 둘 다 다시 보인다", () => {
    const ack = new Set([ackKey("title", "업계 1위", "업계 1위")]);
    expect(holdForCopy({ title: "업계 1위 · 국내 최대" }, ack)?.copyWarnings.map((w) => w.text)).toEqual(["업계 1위", "국내 최대"]);
  });

  test("화면 상한(20) 뒤에 숨은 표현도 확인 없이는 저장되지 않는다", () => {
    // 여러 칸·여러 규칙으로 상한을 넘긴다(한 칸·한 규칙으로 넘기는 경우는 §10 R5).
    const fields = {
      title: "업계 1위 최다 반값 저렴 싸게 최적 무사고 누적 연식 년식",
      body: "업계 2위 국내 최대 가격 경쟁력 연중무휴 운행 경력 큰 사고 종합보험 수십 년 70만 17건 오랜 세월 완비",
    };
    expect(findCopyWarnings(fields).length).toBeGreaterThan(COPY_WARNING_MAX);
    const shown = holdForCopy(fields, new Set())!;
    expect(shown.copyWarnings).toHaveLength(COPY_WARNING_MAX);
    // 보인 것만 확인하면 → 나머지가 다시 나온다(누적 확인 — mergeCopyAck)
    const acked = new Set(mergeCopyAck([], shown.copyWarnings));
    const second = holdForCopy(fields, acked)!;
    expect(second.copyWarnings[0].key).not.toBe(shown.copyWarnings[0].key);
    expect(acked.has(second.copyWarnings[0].key)).toBe(false);
    for (const w of second.copyWarnings) acked.add(w.key);
    expect(holdForCopy(fields, acked)).toBeNull();
  });

  test("확인 키 읽기 — 모양이 맞는 항목만 받는다 · 개수가 넘치면 빈 집합(= 다시 묻는다)", () => {
    const k1 = ackKey("title", "업계 1위", "업계 1위");
    const k2 = ackKey("body", "무사고", "무사고");
    expect(k1).toMatch(/^title:[0-9a-f]{16}:[0-9a-f]{16}$/);
    const fd = new FormData();
    fd.append(COPY_ACK_FIELD, k1);
    fd.append(COPY_ACK_FIELD, "title:업계 1위"); // 옛 모양 — 버린다
    fd.append(COPY_ACK_FIELD, "x".repeat(500)); // 버린다
    fd.append(COPY_ACK_FIELD, k2);
    expect([...readCopyAckForm(fd)]).toEqual([k1, k2]);
    expect(readCopyAckForm(new FormData()).size).toBe(0);
    const flood = new FormData();
    for (let i = 0; i < 1001; i++) flood.append(COPY_ACK_FIELD, k1);
    expect(readCopyAckForm(flood).size).toBe(0);
    // 모르는 칸 이름은 버린다
    expect(readCopyAckForm((() => { const f = new FormData(); f.append(COPY_ACK_FIELD, k1.replace("title", "slug")); return f; })()).size).toBe(0);

    expect([...readCopyAckValue({ [COPY_ACK_FIELD]: [k2, 1, "caption:완비"] })]).toEqual([k2]);
    for (const bad of [null, undefined, 1, "x", {}, { [COPY_ACK_FIELD]: k1 }, { [COPY_ACK_FIELD]: [1] }]) {
      expect(readCopyAckValue(bad).size, JSON.stringify(bad)).toBe(0);
    }
  });

  test("경고 결과에는 규칙 라벨·목록이 실리지 않는다 — 걸린 글자와 분류뿐", () => {
    const held = copyHold(findCopyWarnings({ body: "누적 4,800건" }));
    const json = JSON.stringify(held);
    for (const r of OWNER_COPY_RULES) {
      if (r.label === "누적") continue; // 라벨이 곧 걸린 글자인 규칙
      expect(json.includes(r.label), r.label).toBe(false);
    }
    expect(Object.keys(held.copyWarnings[0]).sort()).toEqual(["field", "key", "kind", "text"]);
  });

  test("패널 한 줄은 한 번에 채운다 — 사장님 글자의 `{reason}`·`$&` 가 다시 치환되지 않는다", () => {
    const labels = {
      item: "{field} ‘{text}’ — {reason}",
      field: { title: "제목", body: "내용", caption: "사진 설명", albumTitle: "앨범 이름" },
      kind: { license: "L", rival: "R", internal: "I", unproven: "U", comparative: "C" },
    };
    expect(fillCopyWarningItem(labels, { key: "k", field: "body", kind: "unproven", text: "투명한{reason}$&요금" })).toBe("내용 ‘투명한{reason}$&요금’ — U");
  });
});

// =============================================================================
// 7. 액션 — 멈추고, 확인하면 저장한다
// =============================================================================
type DbResult = { data: unknown; error: unknown };
function dbStub(result: DbResult) {
  const chain: Record<string, ReturnType<typeof vi.fn> | unknown> = {};
  for (const m of ["select", "order", "limit", "eq", "is", "insert", "update", "delete", "maybeSingle"]) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  const from = vi.fn(() => chain);
  // 0020(P5-16) 뒤 관리자 쓰기는 definer 함수 RPC 다. "저장했다/안 했다" 는 이제 이 호출로 판정한다.
  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    void fn;
    void args;
    return result;
  });
  return { client: { from, rpc, storage: { from: vi.fn() } }, chain: chain as Record<string, ReturnType<typeof vi.fn>>, from, rpc };
}

/** 저장 RPC 한 번의 인자 — 함수 이름과 함께. 저장이 없었으면 undefined. */
function writtenArgs(rpc: ReturnType<typeof vi.fn>, index = 0): { fn: string; args: Record<string, unknown> } | undefined {
  const call = rpc.mock.calls[index] as [string, Record<string, unknown>] | undefined;
  return call ? { fn: call[0], args: call[1] } : undefined;
}

const form = (values: Record<string, string | string[]>): FormData => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
  return fd;
};

const RISKY_TITLE = "업계 1위 전세버스";
const RISKY_BODY = `정식 ${W_LICENSE} 업체입니다.`;

const noticeForm = (over: Record<string, string | string[]> = {}) =>
  form({
    [NOTICE_FIELDS.title]: RISKY_TITLE,
    [NOTICE_FIELDS.body]: RISKY_BODY,
    [NOTICE_FIELDS.category]: "notice",
    [NOTICE_FIELDS.publishedAt]: "2026-09-17",
    [NOTICE_FIELDS.active]: "on",
    ...over,
  });

const popupForm = (over: Record<string, string | string[]> = {}) =>
  form({
    [POPUP_FIELDS.title]: RISKY_TITLE,
    [POPUP_FIELDS.body]: RISKY_BODY,
    [POPUP_FIELDS.imagePath]: "",
    [POPUP_FIELDS.startsAt]: "2026-09-17",
    [POPUP_FIELDS.endsAt]: "2026-09-30",
    [POPUP_FIELDS.active]: "on",
    ...over,
  });

const ACK_BOTH = [ackKey("title", RISKY_TITLE, "업계 1위"), ackKey("body", RISKY_BODY, W_LICENSE)];

describe("7. 서버액션 — 저장 전 확인, 확인하면 저장", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ userId: "admin-uuid", email: "owner@example.test" });
  });

  /**
   * DB 를 한 번도 부르지 않았다 — 읽기(from)도 쓰기(rpc)도.
   * 0020 뒤로 쓰기는 rpc 로 간다. from 만 보면 이 단언은 **공허하게 통과한다**(쓰기가 from 을 부르지 않으므로) — 그래서 둘 다 본다.
   */
  const expectNothingWritten = (stub: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> }) => {
    expect(stub.from).not.toHaveBeenCalled();
    expect(stub.rpc).not.toHaveBeenCalled();
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    expect(vi.mocked(revalidate)).not.toHaveBeenCalled();
  };

  const expectLogHasNoText = () => {
    const logged = JSON.stringify(vi.mocked(structuredLog).mock.calls);
    expect(logged).toContain("copyWarning");
    for (const t of ["업계", W_LICENSE, "완비"]) expect(logged.includes(t), t).toBe(false);
  };

  test.for([
    ["createNotice", () => createNotice(noticeForm()), (ack: string[]) => createNotice(noticeForm({ [COPY_ACK_FIELD]: ack })), [{ id: 3 }]],
    ["updateNotice", () => updateNotice(noticeForm({ id: "12" })), (ack: string[]) => updateNotice(noticeForm({ id: "12", [COPY_ACK_FIELD]: ack })), [{ id: 12 }]],
    ["createPopup", () => createPopup(popupForm()), (ack: string[]) => createPopup(popupForm({ [COPY_ACK_FIELD]: ack })), [{ id: 3 }]],
    ["updatePopup", () => updatePopup(popupForm({ id: "5" })), (ack: string[]) => updatePopup(popupForm({ id: "5", [COPY_ACK_FIELD]: ack })), [{ id: 5 }]],
  ] as const)("%s — 확인 전에는 DB 를 부르지 않고, 확인하면 입력 그대로 저장한다", async ([name, first, confirmed, rows]) => {
    const stub = dbStub({ data: rows, error: null });
    vi.mocked(createSsrClient).mockReturnValue(stub.client as never);

    const held = await first();
    expect(held.code).toBe("copyWarning");
    expect(held.ok).toBe(true);
    expect(held.changed).toBe(false);
    expect(held.copyWarnings?.map((w) => [w.field, w.kind, w.text])).toEqual([
      ["title", "comparative", "업계 1위"],
      ["body", "license", W_LICENSE],
    ]);
    expect(vi.mocked(requireAdmin)).toHaveBeenCalledTimes(1);
    expectNothingWritten(stub);
    expectLogHasNoText();

    // 일부만 확인 → 여전히 멈춘다
    const partial = await confirmed([ACK_BOTH[0]]);
    expect(partial.code).toBe("copyWarning");
    expect(stub.from).not.toHaveBeenCalled();
    expect(stub.rpc).not.toHaveBeenCalled();

    // 전부 확인 → 저장된다. 저장되는 글자는 입력 그대로다(경고 표식이 섞이지 않는다 — 공개 화면에 새지 않는다)
    const saved = await confirmed([...ACK_BOTH]);
    expect(saved.ok).toBe(true);
    expect(saved.changed).toBe(true);
    expect(saved.copyWarnings).toBeUndefined();
    // 저장은 정확히 한 번, 그 액션에 맞는 0020 함수로
    expect(stub.rpc).toHaveBeenCalledTimes(1);
    const expectedFn = {
      createNotice: "admin_create_notice",
      updateNotice: "admin_update_notice",
      createPopup: "admin_create_popup",
      updatePopup: "admin_update_popup",
    }[name];
    const written = writtenArgs(stub.rpc);
    expect(written?.fn).toBe(expectedFn);
    expect(written?.args.p_title).toBe(RISKY_TITLE);
    expect(written?.args.p_body).toBe(RISKY_BODY);
    expect(JSON.stringify(written?.args)).not.toMatch(/copyAck|copyWarning/);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalled();
  });

  test("걸린 것이 없는 글은 한 번에 저장된다 (기존 흐름 그대로)", async () => {
    const { client, rpc } = dbStub({ data: [{ id: 3 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    const r = await createNotice(noticeForm({ [NOTICE_FIELDS.title]: "추석 연휴 운행 안내", [NOTICE_FIELDS.body]: `문의는 ${COMPANY.tel} 로 주세요.` }));
    expect(r).toEqual({ ok: true, changed: true, code: "created" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(writtenArgs(rpc)?.fn).toBe("admin_create_notice");
  });

  test("검증 실패가 먼저다 — 형식이 틀리면 경고 대신 validation", async () => {
    const r = await createNotice(noticeForm({ [NOTICE_FIELDS.category]: "bogus" }));
    expect(r.code).toBe("validation");
    expect(r.copyWarnings).toBeUndefined();
  });

  test("사진 설명 — updateGalleryPhoto", async () => {
    const stub = dbStub({ data: [{ id: 7 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(stub.client as never);
    const input = { id: 7, caption: "DVD·노래방 시스템 완비", albumId: null, sort: 0 };
    const held = await updateGalleryPhoto(input);
    expect(held).toMatchObject({ ok: true, changed: false, code: "copyWarning" });
    expect(held.copyWarnings?.map((w) => [w.field, w.text])).toEqual([["caption", "완비"]]);
    expectNothingWritten(stub);
    expectLogHasNoText();

    const saved = await updateGalleryPhoto({ ...input, [COPY_ACK_FIELD]: [ackKey("caption", input.caption, "완비")] });
    expect(saved).toMatchObject({ ok: true, changed: true, code: "updated" });
    const written = writtenArgs(stub.rpc);
    expect(written?.fn).toBe("admin_update_gallery_photo");
    expect(written?.args.p_caption).toBe("DVD·노래방 시스템 완비");
    expect(Object.keys(written?.args ?? {})).not.toContain(COPY_ACK_FIELD);
    expect(JSON.stringify(written?.args)).not.toMatch(/copyAck|copyWarning/);
  });

  test("앨범 이름 — createGalleryAlbum · updateGalleryAlbum", async () => {
    const stub = dbStub({ data: [{ id: 1 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(stub.client as never);
    const album = { title: "업계 1위 단체여행", slug: "trip", sort: 0, active: true };
    const key = ackKey("albumTitle", album.title, "업계 1위");

    expect((await createGalleryAlbum(album)).code).toBe("copyWarning");
    expect((await updateGalleryAlbum({ id: 1, ...album })).code).toBe("copyWarning");
    expectNothingWritten(stub);

    expect(await createGalleryAlbum({ ...album, [COPY_ACK_FIELD]: [key] })).toMatchObject({ ok: true, changed: true, code: "albumCreated" });
    expect(writtenArgs(stub.rpc)).toEqual({ fn: "admin_create_album", args: expect.objectContaining({ p_title: "업계 1위 단체여행", p_slug: "trip" }) });
    expect(await updateGalleryAlbum({ id: 1, ...album, [COPY_ACK_FIELD]: [key] })).toMatchObject({ ok: true, changed: true, code: "albumUpdated" });
    expect(writtenArgs(stub.rpc, 1)).toEqual({ fn: "admin_update_album", args: expect.objectContaining({ p_id: 1, p_title: "업계 1위 단체여행" }) });
  });

  test("업로드 기록 — 설명이 걸리면 멈추고, 업로더는 그것을 성공으로 읽지 않는다(파일을 되돌린다)", async () => {
    const stub = dbStub({ data: [{ id: 9 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(stub.client as never);
    const paths = buildUploadPaths("0f9c1a2b-3d4e-4f60-8a1b-2c3d4e5f6071", "jpg", new Date("2026-09-17T09:00:00+09:00"));
    const meta = { width: 1600, height: 1200, bytes: 1000, albumId: null, caption: "업계 1위", sort: 0, active: true };
    const held = await recordGalleryUpload({ ...meta, imagePath: paths.imagePath, originalPath: paths.originalPath });
    expect(held.code).toBe("copyWarning");
    expectNothingWritten(stub);

    const removed: string[] = [];
    const outcome = await commitUpload({
      paths,
      original: new Blob(["o"]),
      originalContentType: "image/jpeg",
      publicBody: new Blob(["p"]),
      publicCacheControl: "31536000",
      meta,
      storage: {
        upload: async () => ({ error: null }),
        remove: async (bucket: string, key: string) => {
          removed.push(`${bucket}/${key}`);
        },
      },
      record: async () => copyHold(findCopyWarnings({ caption: "업계 1위" })),
    } as never);
    expect(outcome).toEqual({ kind: "failed", reason: "record" });
    expect(removed.sort()).toEqual([paths.imagePath, paths.originalPath].sort());
  });
});

// =============================================================================
// 8. 화면 · 문구 · 공개 화면 무영향
// =============================================================================
describe("8. 화면 배선 · 문구 · 공개 화면", { timeout: 60_000 }, () => {
  const ko = JSON.parse(read("messages/ko.json")) as { admin: Record<string, Record<string, unknown>> };
  const cw = ko.admin.copyWarning as {
    title: string;
    lead: string;
    confirm: string;
    item: string;
    field: Record<string, string>;
    kind: Record<string, string>;
  };

  test("admin.copyWarning — 칸·분류 키가 코드와 정확히 같다 · 한 줄 틀에 세 자리", () => {
    expect(Object.keys(cw.field).sort()).toEqual([...COPY_FIELDS].sort());
    expect(Object.keys(cw.kind).sort()).toEqual([...OWNER_COPY_KINDS].sort());
    for (const k of ["title", "lead", "confirm"] as const) expect(cw[k].trim().length, k).toBeGreaterThan(0);
    for (const slot of ["{field}", "{text}", "{reason}"]) expect(cw.item).toContain(slot);
    // 막지 않는다는 것을 화면이 말한다 — 버튼 이름이 곧 그 약속이다
    expect(cw.lead).toContain("아직 저장하지 않았습니다");
    expect(cw.lead).toContain("그대로 올리셔도");
  });

  test("세 탭의 결과 문구에 copyWarning 이 있다", () => {
    for (const ns of ["notices", "popups", "gallery"]) {
      expect((ko.admin[ns].result as Record<string, string>).copyWarning, ns).toBeTruthy();
    }
  });

  test("사유 문장은 운영 매뉴얼 4장과 **같은 말**이다 (두 곳이 다른 말을 하지 않는다)", () => {
    const manual = read("docs/ops/admin-manual.md");
    const start = manual.indexOf("## 4. 공지사항 쓰기");
    const end = manual.indexOf("## 5. 팝업 띄우기");
    expect(start).toBeGreaterThan(0);
    const ch4 = manual.slice(start, end);
    for (const kind of OWNER_COPY_KINDS) expect(ch4, kind).toContain(cw.kind[kind]);
    expect(ch4).toContain(cw.title);
    expect(ch4).toContain(cw.confirm);
    // 옛 설명("검사가 하나도 걸리지 않습니다")은 이제 사실이 아니다
    expect(ch4).not.toContain("검사가 하나도 걸리지 않습니다");
  });

  test("다섯 관리자 화면이 패널 문구를 내려 주고, 네 입력 컴포넌트가 패널을 그린다", () => {
    for (const page of [
      "app/admin/(protected)/notices/page.tsx",
      "app/admin/(protected)/notices/[id]/page.tsx",
      "app/admin/(protected)/popups/page.tsx",
      "app/admin/(protected)/popups/[id]/page.tsx",
      "app/admin/(protected)/gallery/page.tsx",
    ]) {
      const code = codeOf(page);
      expect(code, page).toMatch(/await getCopyWarningLabels\(\)/);
      expect(code, page).toMatch(/copyWarning: t\("result\.copyWarning"\)/);
    }
    for (const ui of ["NoticeForm", "PopupForm", "GalleryPhotoCard", "GalleryAlbums"]) {
      expect(codeOf(`components/admin/${ui}.tsx`), ui).toMatch(/<CopyWarningPanel\b/);
    }
    // 폼은 "그대로 저장하기"로 보낸 제출에만 확인 키를 붙인다
    for (const ui of ["NoticeForm", "PopupForm"]) {
      expect(codeOf(`components/admin/${ui}.tsx`), ui).toMatch(/if \(isCopyAckSubmitter\(\(event\.nativeEvent as SubmitEvent\)\.submitter\)\) \{\s*for \(const key of ack\) formData\.append\(COPY_ACK_FIELD, key\);/);
    }
  });

  test("공개 화면 코드는 경고 모듈을 모른다 — app/[locale] · components(관리자 제외) · lib/queries", () => {
    const pub = [
      ...sourcesUnder(["app/[locale]", "lib/queries"]),
      ...sourcesUnder(["components"]).filter((f) => !f.startsWith("components/admin/")),
    ];
    expect(pub.length).toBeGreaterThan(40);
    for (const f of pub) {
      expect(read(f), f).not.toMatch(/copyWarning|copyCheck|CopyWarningPanel|lib\/copy\//);
    }
  });

  test("새 컴포넌트·모듈에 한글 리터럴 0 (문구는 카탈로그에서만)", () => {
    for (const f of ["components/admin/CopyWarningPanel.tsx", "components/admin/copyWarningLabels.ts", "lib/admin/copyWarning.ts", "lib/admin/copyCheck.ts", "lib/copy/kinds.ts"]) {
      expect(codeOf(f), f).not.toMatch(/[가-힣]/);
    }
  });
});

// =============================================================================
// 9. 카피 잔여 2건 — 빼기만 했다
// =============================================================================
describe("9. 카피 2건 (P6-10 잔여) — 빼기만, 새 주장 0", () => {
  const ko = JSON.parse(read("messages/ko.json")) as { home: { hero: { slides: { trust: { heading: string } } }; fleet: { lines: Record<string, string>; disc: string } } };
  const OLD_HEADING = "외국인 투어로 다져온\n운행 기준";
  const OLD_BUS45 = "단체 워크샵·현장학습·종교단체 이동에 쓰이는 대형 차량. DVD·노래방 시스템 완비.";

  test("slides.trust.heading — `로 다져온` 만 뺐다", () => {
    const now = ko.home.hero.slides.trust.heading;
    expect(now).toBe(OLD_HEADING.replace("로 다져온", ""));
    expect(now).toContain("외국인 투어");
    expect(now).toContain("운행 기준");
  });

  test("fleet.lines.bus45 — 전칭 문장 하나만 뺐다 · 옵션 안내는 disc 가 맡는다", () => {
    const now = ko.home.fleet.lines.bus45;
    expect(now).toBe(OLD_BUS45.replace(" DVD·노래방 시스템 완비.", ""));
    expect(ko.home.fleet.disc).toContain("배차 차량에 따라 일부 다를 수 있습니다");
  });

  test("새 값은 옛 값의 부분 문자열 조각으로만 이루어졌다 (새 수식어 0)", () => {
    const now = [ko.home.hero.slides.trust.heading, ko.home.fleet.lines.bus45];
    const old = [OLD_HEADING, OLD_BUS45];
    now.forEach((n, i) => {
      // 새 값의 모든 글자가 옛 값에 같은 순서로 있다(부분수열) — 뺐을 뿐 넣지 않았다
      let j = 0;
      for (const ch of old[i]) if (j < n.length && ch === n[j]) j++;
      expect(j, n).toBe(n.length);
      expect(n.length).toBeLessThan(old[i].length);
    });
  });

  test("두 규칙은 옛 문구를 잡는다 (수정 전 빨강의 재현)", () => {
    const hit = (s: string) => UNPROVEN_CLAIMS.filter(([, re]) => re.test(s)).map(([l]) => l);
    expect(hit(OLD_HEADING)).toEqual(["다져온 / 쌓아 온 (경험·기간 암시)"]);
    expect(hit(OLD_BUS45)).toEqual(["완비 (전칭 — 모든 차량에 갖췄다는 주장)"]);
  });
});

// =============================================================================
// 10. GPT 독립 검증(Codex) 재현 입력 — 회귀 픽스처
// 확인 키는 **서버가 돌려준 결과에서만** 꺼낸다(화면이 하는 그대로). 그래서 키 모양이 바뀌어도 이 절은 그대로다.
// =============================================================================
describe("10. Codex 재현 — 보지 못한 것을 승인하지 않는다", () => {
  const keysOf = (fields: Parameters<typeof holdForCopy>[0], ack: ReadonlySet<string> = new Set()) =>
    new Set((holdForCopy(fields, ack)?.copyWarnings ?? []).map((w) => w.key));
  const textsOf = (fields: Parameters<typeof holdForCopy>[0], ack: ReadonlySet<string> = new Set()) =>
    (holdForCopy(fields, ack)?.copyWarnings ?? []).map((w) => w.text);
  /** 폼이 실제로 보내는 길 그대로 — FormData 에 싣고 파서로 읽는다. */
  const viaForm = (keys: Iterable<string>) => {
    const fd = new FormData();
    for (const k of keys) fd.append(COPY_ACK_FIELD, k);
    return readCopyAckForm(fd);
  };

  test("R1 — '10대 보유' 를 확인한 뒤 ' / 20대 보유' 를 덧붙이면 다시 묻고, 두 번째 주장이 목록에 보인다", () => {
    const first = { body: "10대 보유" };
    const ack = viaForm(keysOf(first));
    expect(ack.size).toBe(1);
    const second = { body: "10대 보유 / 20대 보유" };
    const held = holdForCopy(second, ack);
    expect(held, "두 번째 주장이 확인 없이 저장된다").not.toBeNull();
    expect(held!.copyWarnings.map((w) => w.text)).toContain("20대 보유");
  });

  test("R1b — 같은 규칙의 서로 다른 일치는 처음부터 전부 보인다", () => {
    expect(textsOf({ body: "10대 보유 / 20대 보유" })).toEqual(["10대 보유", "20대 보유"]);
    expect(textsOf({ title: "업계 1위 · 업계 2위" })).toEqual(["업계 1위", "업계 2위"]);
    // 같은 글자의 반복은 여전히 한 줄
    expect(textsOf({ body: "무사고 · 무사고" })).toEqual(["무사고"]);
  });

  test("R1c — 두 일치를 모두 확인해야 저장된다 (UI 누적 흐름)", () => {
    const fields = { body: "10대 보유 / 20대 보유" };
    const ack = viaForm(keysOf(fields));
    expect(holdForCopy(fields, ack)).toBeNull();
  });

  test.for([
    ["업계 １위", "comparative"], // 전각 숫자
    ["업계　1위", "comparative"], // 전각 공백(U+3000)
    ["무​사고", "unproven"], // 폭 없는 공백
    ["무‍사고", "unproven"], // 폭 없는 결합자
    ["무﻿사고", "unproven"], // BOM
    ["무­사고", "unproven"], // 소프트 하이픈
    ["무⁠사고", "unproven"], // 단어 결합자
    ["운행  경력", "unproven"], // 공백 둘
    ["운행 경력", "unproven"], // 줄바꿈 없는 공백
    ["ｏｏ 최저가", "comparative"], // 전각 라틴 옆의 주장
  ] as const)("R2 — 보기엔 같은 주장 %s → %s", ([text, kind]) => {
    expect(kindsOf(text)).toContain(kind);
  });

  test("R2b — 금지어도 폭 없는 문자로 쪼개지지 않는다", () => {
    const split = W_LICENSE.split("").join("​");
    expect(kindsOf(`${split} 보유`)).toContain("license");
  });

  test("R2c — 대조용 사본만 바뀐다: 저장되는 값(액션이 DB 에 쓰는 글자)은 입력 그대로", async () => {
    vi.clearAllMocks();
    const { client, rpc } = dbStub({ data: [{ id: 3 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    const title = "업계 １위​ 안내";
    const fields = { title, body: "안내드립니다." };
    const ack = [...keysOf(fields)];
    expect(ack.length).toBe(1);
    const r = await createNotice(noticeForm({ [NOTICE_FIELDS.title]: title, [NOTICE_FIELDS.body]: "안내드립니다.", [COPY_ACK_FIELD]: ack }));
    expect(r.changed).toBe(true);
    // 0020 의 admin_create_notice 에 실린 글자 — 정규화 사본이 아니라 입력 그대로(전각·폭 없는 문자 포함)
    expect(writtenArgs(rpc)?.fn).toBe("admin_create_notice");
    expect(writtenArgs(rpc)?.args.p_title).toBe(title);
  });

  test("R3 — '업계' + 공백 201개 + '1위' 도 확인하면 저장된다 (키 길이가 고정)", () => {
    const fields = { body: `업계${" ".repeat(201)}1위` };
    const keys = keysOf(fields);
    expect(keys.size).toBe(1);
    for (const k of keys) expect(k.length).toBeLessThanOrEqual(64);
    expect(holdForCopy(fields, viaForm(keys)), "확인해도 계속 경고만 돈다").toBeNull();
  });

  test("R3b — 아주 긴 일치(숫자 1000자리)도 키는 짧다", () => {
    const fields = { body: `${"9".repeat(1000)}대 보유` };
    const keys = keysOf(fields);
    for (const k of keys) expect(k.length).toBeLessThanOrEqual(64);
    expect(holdForCopy(fields, viaForm(keys))).toBeNull();
  });

  test("R4 — 확인은 그 칸의 **그 글**에 묶인다: 글이 바뀌면 같은 표현이라도 다시 묻는다", () => {
    const ack = viaForm(keysOf({ title: "업계 1위 안내" }));
    expect(holdForCopy({ title: "업계 1위 안내" }, ack)).toBeNull();
    expect(holdForCopy({ title: "업계 1위 공지" }, ack), "A 에 대한 확인이 B 에 쓰인다").not.toBeNull();
    // 다른 칸으로 옮겨도 무효
    expect(holdForCopy({ body: "업계 1위 안내" }, ack)).not.toBeNull();
  });

  test("R4b — 공백·보이지 않는 문자만 다른 글은 같은 글로 본다 (확인이 유지된다)", () => {
    const ack = viaForm(keysOf({ title: "업계 1위 안내" }));
    expect(holdForCopy({ title: "업계  1위​ 안내" }, ack)).toBeNull();
  });

  test("R4c — 누적 확인은 글이 바뀐 칸의 낡은 키를 버린다 (편집을 거듭해도 키가 쌓이지 않는다)", () => {
    let ack: string[] = [];
    let text = "업계 1위";
    for (let i = 0; i < 200; i++) {
      text = `업계 1위 ${i}번째 고침`;
      const held = holdForCopy({ title: text }, new Set(ack))!;
      ack = mergeCopyAck(ack, held.copyWarnings);
    }
    expect(ack.length).toBe(1);
    expect(holdForCopy({ title: text }, viaForm(ack))).toBeNull();
  });

  test("R5 — 화면 상한 20 을 넘는 한 칸의 일치도 몇 번 누르면 끝난다 (누적 확인)", () => {
    const body = Array.from({ length: 45 }, (_, i) => `${i + 1}대 보유`).join(" / ");
    let ack: string[] = [];
    let rounds = 0;
    for (; rounds < 10; rounds++) {
      const held = holdForCopy({ body }, viaForm(ack));
      if (!held) break;
      expect(held.copyWarnings.length).toBeLessThanOrEqual(COPY_WARNING_MAX);
      ack = mergeCopyAck(ack, held.copyWarnings);
    }
    expect(rounds).toBe(3);
  });
});

// =============================================================================
// 11. 위조 확인 — **막지 않는 것**을 있는 그대로 고정한다 (컨트롤러 판단 P2 · lib/admin/copyWarning.ts 헤더)
// =============================================================================
describe("11. 확인 위조는 막지 않는다 — 실수 방지 장치이지 권한 통제가 아니다", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ userId: "admin-uuid", email: "owner@example.test" });
  });

  test("관리자가 키 계산법대로 첫 요청에 확인을 실어 보내면 저장된다 (알려진 한계)", async () => {
    const { client, rpc } = dbStub({ data: [{ id: 3 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    const r = await createNotice(noticeForm({ [COPY_ACK_FIELD]: [...ACK_BOTH] }));
    expect(r.changed).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(writtenArgs(rpc)?.fn).toBe("admin_create_notice");
    // 그래도 게이트는 먼저 돈다 — 이 경로의 주체는 requireAdmin() 을 통과한 관리자뿐이다
    expect(vi.mocked(requireAdmin)).toHaveBeenCalledTimes(1);
  });

  test("옛 모양 키(`칸:글자`)를 지어내도 통하지 않는다 — 키는 글 전체의 해시에 묶인다", async () => {
    const { client, from, rpc } = dbStub({ data: [{ id: 3 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    const r = await createNotice(noticeForm({ [COPY_ACK_FIELD]: ["title:업계 1위", `body:${W_LICENSE}`] }));
    expect(r.code).toBe("copyWarning");
    expect(from).not.toHaveBeenCalled();
    expect(rpc, "0020 뒤 쓰기는 rpc 다 — 위조 키로 저장됐다").not.toHaveBeenCalled();
  });

  test("다른 글에 대해 받은 진짜 확인 키도 이 글에는 통하지 않는다", async () => {
    const { client, from, rpc } = dbStub({ data: [{ id: 3 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    const other = [ackKey("title", "업계 1위 다른 글", "업계 1위"), ackKey("body", `${W_LICENSE} 다른 글`, W_LICENSE)];
    const r = await createNotice(noticeForm({ [COPY_ACK_FIELD]: other }));
    expect(r.code).toBe("copyWarning");
    expect(from).not.toHaveBeenCalled();
    expect(rpc, "0020 뒤 쓰기는 rpc 다 — 다른 글의 키로 저장됐다").not.toHaveBeenCalled();
  });

  test("헤더가 이 판단을 적어 두었다", () => {
    const header = read("lib/admin/copyWarning.ts");
    expect(header).toContain("막지 않는 것");
    expect(header).toContain("확인 위조");
    expect(header).toContain("requireAdmin()");
  });

  test("정규화 모듈은 낱말이 없고 순수하다 (클라이언트에 실려도 목록이 새지 않는다)", () => {
    const code = codeOf("lib/copy/normalize.ts");
    expect(code).not.toMatch(/[가-힣]/);
    expect(code).not.toMatch(/import\s/);
    expect(code).toMatch(/Default_Ignorable_Code_Point/);
    expect(code).toMatch(/normalize\("NFKC"\)/);
  });

  test("정규화는 줄바꿈을 남긴다 — 한 줄 규칙(`[^\\n]{0,8}`)이 줄 너머로 번지지 않게", () => {
    expect(normalizeForCopyMatch("투명하게\r\n\r\n   요금")).toBe("투명하게\n요금");
    expect(kindsOf("절차를 투명하게 공개합니다\n\n요금 안내")).toEqual([]);
    expect(normalizeForCopyMatch("업계　１​위")).toBe("업계 1위");
  });
});
