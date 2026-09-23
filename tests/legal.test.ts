/**
 * P1-1 — 법정 문구 단일 원장 `lib/legal/disclosures.ts` 계약 테스트 (ADR-5).
 *
 * 브리프 §검증 9항목을 그대로 단언한다:
 *   1. 함수 export 0건 (정규식)            2. verbatim 2건 CLAUDE.md §3 와 바이트 일치
 *   3. 금지어 0건                           4. 등록번호·주소 실값
 *   5. 취소 4단계·환불율·라벨               6. 개인정보 4대 고지 비어 있지 않음
 *   7. 처리위탁 5건                         8. TEMP 마커 ↔ 허용 목록 1:1
 *   9. check-legal-disclosures.sh exit 0   (게이트와 원장이 실제로 맞물리는지)
 *
 * 주의: 이 파일은 tests/ 아래에 있어 그 자체가 세 게이트의 검사 대상이다. 금지어·임시값 마커
 * 리터럴을 소스에 그대로 두면 실제 저장소 실행이 빨간불이 되므로 유니코드 이스케이프 /
 * 문자열 결합으로 조립한다 (tests/gates.test.ts 와 같은 규약).
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { OVERSEAS_TRANSFERS } from "@/lib/legal/disclosures";

import * as ledger from "@/lib/legal/disclosures";
import {
  CANCELLATION,
  COMPANY,
  PRIVACY_NOTICE,
  PROCESSORS,
  RELATED_COMPANY,
  VERBATIM,
} from "@/lib/legal/disclosures";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LEDGER_REL = "lib/legal/disclosures.ts";
const ALLOWLIST_REL = "scripts/gates/temp-allowlist.txt";
const GATE_REL = "scripts/check-legal-disclosures.sh";
const GATE_TIMEOUT_MS = 60_000;

// ── 금지어·마커 (리터럴 금지 — 위 헤더 참조) ─────────────────────────────
const W_LICENSE = "\uba74\ud5c8"; // "등록"이 맞다 — CLAUDE.md §3
const W_RIVAL = "\uc804\uc138\ubc84\uc2a4\ud558\ub098"; // 타사 상호
const W_BM_OUTBOUND = "\ub098\uac00\ub294 \ubc84\uc2a4"; // soul §10.2
const W_BM_BOARD_OUT = "\ud0dc\uc6b0\uace0 \ub098\uac00"; // soul §10.2
const W_BM_EMPTY = "\uacf5\ucc28"; // soul §10.2
const W_BM_RETURN = "\ud68c\uc1a1"; // soul §10.2
const W_UNPROVEN_COUNT = "70" + "\ub9cc"; // 옛 인사말의 실증 불가 수치
const W_OLD_TARIFF = "4," + "800"; // 옛 요금 매트릭스 셀
const FORBIDDEN = [
  W_LICENSE,
  W_RIVAL,
  W_BM_OUTBOUND,
  W_BM_BOARD_OUT,
  W_BM_EMPTY,
  W_BM_RETURN,
  W_UNPROVEN_COUNT,
  W_OLD_TARIFF,
] as const;
const TEMP_MARKER = "[TEMP" + "]";

// ── 소스 로딩 ────────────────────────────────────────────────────────────
function readLines(rel: string): string[] {
  return readFileSync(path.join(ROOT, rel), "utf8")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""));
}

// 게이트와 같은 규약: //, /*, *, # 로 시작하는 줄은 주석 줄. 줄 끝 주석은 코드 줄로 취급된다.
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#)/;
const ledgerLines = readLines(LEDGER_REL);
const codeLines = ledgerLines.filter((l) => !COMMENT_LINE.test(l));

// ── bash 해석 (tests/gates.test.ts 와 동일 — Windows 의 PATH bash 는 WSL 일 수 있다) ──
function resolveBash(): { bin: string; env: NodeJS.ProcessEnv } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (process.env.BASH_PATH) return { bin: process.env.BASH_PATH, env };
  if (process.platform !== "win32") return { bin: "bash", env };

  const roots: string[] = [];
  try {
    const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
    roots.push(path.resolve(execPath, "..", "..", ".."));
  } catch {
    // git 이 PATH 에 없으면 아래 고정 후보로 넘어간다
  }
  roots.push("C:\\Program Files\\Git", "C:\\Program Files (x86)\\Git");
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, "Programs", "Git"));

  for (const root of roots) {
    const bin = path.join(root, "bin", "bash.exe");
    if (!existsSync(bin)) continue;
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    env[pathKey] = [path.join(root, "usr", "bin"), path.join(root, "mingw64", "bin"), env[pathKey] ?? ""].join(
      path.delimiter,
    );
    return { bin, env };
  }
  return { bin: "bash", env };
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function runLegalGate(): Promise<{ status: number | null; out: string }> {
  const bash = resolveBash();
  return new Promise((resolve, reject) => {
    const child = spawn(bash.bin, [toPosix(path.join(ROOT, GATE_REL))], {
      env: { ...bash.env, CLAUDE_PROJECT_DIR: toPosix(ROOT) },
      windowsHide: true,
    });
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      out += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, out }));
  });
}

// ═════════════════════════════════════════════════════════════════════════
describe("1. 상수만 — 함수 export 0건", () => {
  // scripts/check-legal-disclosures.sh 의 FUNC_RULES 4개를 JS 정규식으로 옮긴 것
  const FUNC_RULES = [
    /^\s*export\s+(default\s+)?(async\s+)?function(?![A-Za-z0-9_$])/,
    /^\s*export\s+(const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*(\s*:[^=]*)?\s*=\s*\(/,
    /^\s*export\s+(const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*(\s*:[^=]*)?\s*=\s*async(?![A-Za-z0-9_$])/,
    /^\s*export(?![A-Za-z0-9_$]).*=>/,
  ];

  test("게이트의 함수 export 패턴에 걸리는 코드 줄이 없다", () => {
    const hits = codeLines.filter((l) => FUNC_RULES.some((r) => r.test(l)));
    expect(hits).toEqual([]);
  });

  test("코드 줄에 `function` · `async` · `=>` 가 전혀 없다 (export 여부와 무관)", () => {
    const hits = codeLines.filter((l) => /\bfunction\b|\basync\b|=>/.test(l));
    expect(hits).toEqual([]);
  });

  test("런타임에도 export 된 값 중 함수가 없다", () => {
    const entries = Object.entries(ledger);
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, value] of entries) {
      expect(typeof value, name).not.toBe("function");
    }
  });

  test("모든 export 줄이 `export const NAME = ` 이고 as const 로 닫힌다", () => {
    const exportLines = codeLines.filter((l) => /^\s*export\b/.test(l));
    expect(exportLines.length).toBeGreaterThan(0);
    for (const l of exportLines) expect(l).toMatch(/^export const [A-Z_]+ = /);
    const asConstCount = codeLines.filter((l) => /\bas const;\s*$/.test(l)).length;
    expect(asConstCount).toBe(exportLines.length);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("2. verbatim 2건 — CLAUDE.md §3 와 바이트 일치", () => {
  const claudeMd = readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");

  function extract(label: RegExp): Buffer {
    const m = label.exec(claudeMd);
    if (!m) throw new Error(`CLAUDE.md 에서 verbatim 라벨을 찾지 못함: ${label}`);
    return Buffer.from(m[1], "utf8");
  }

  // 라벨의 가운뎃점은 U+00B7 — CLAUDE.md 원문과 같은 코드포인트로 찾는다
  const expectedBooking = extract(/^\s*-\s*접수\u00b7확정:\s*"([^"\r\n]+)"/m);
  const expectedShowcase = extract(/^\s*-\s*Top-5 고지:\s*"([^"\r\n]+)"/m);

  test("VERBATIM.bookingNotice — Buffer.compare === 0", () => {
    expect(Buffer.compare(Buffer.from(VERBATIM.bookingNotice, "utf8"), expectedBooking)).toBe(0);
  });

  test("VERBATIM.showcaseNotice — Buffer.compare === 0", () => {
    expect(Buffer.compare(Buffer.from(VERBATIM.showcaseNotice, "utf8"), expectedShowcase)).toBe(0);
  });

  test("가운뎃점은 U+00B7 이고 U+2027·U+30FB·U+2022 로 바뀌지 않았다", () => {
    expect(VERBATIM.showcaseNotice).toContain("\u00b7");
    expect(VERBATIM.showcaseNotice).not.toMatch(/[\u2027\u30fb\u2022]/);
  });

  test("verbatim 은 주석이 아니라 코드 줄에 있다 (배포되는 문자열)", () => {
    expect(codeLines.some((l) => l.includes(VERBATIM.bookingNotice))).toBe(true);
    expect(codeLines.some((l) => l.includes(VERBATIM.showcaseNotice))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("3. 금지어 0건 (주석 포함 소스 전체)", () => {
  test.for(FORBIDDEN.map((w) => [w] as const))("금지어 %s 가 소스 어디에도 없다", ([word]) => {
    const hits = ledgerLines.map((l, i) => [i + 1, l] as const).filter(([, l]) => l.includes(word));
    expect(hits).toEqual([]);
  });

  test("옛 요금 매트릭스의 단가 셀이 없다 — `n,nnn원` 형태 금지", () => {
    const hits = codeLines.filter((l) => /\d{1,3}(,\d{3})+\s*원/.test(l));
    expect(hits).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("4. 등록번호 · 주소 실값", () => {
  test("COMPANY.bizRegNo === 130-86-77328", () => {
    expect(COMPANY.bizRegNo).toBe("130-86-77328");
  });

  test("RELATED_COMPANY.bizRegNo === 342-88-03855 (시트의 332 오기 아님)", () => {
    expect(RELATED_COMPANY.bizRegNo).toBe("342-88-03855");
    expect(RELATED_COMPANY.bizRegNo.startsWith("332")).toBe(false);
  });

  test("COMPANY.address 에 107 포함 · 99-19 미포함", () => {
    expect(COMPANY.address).toContain("107");
    expect(COMPANY.address).not.toContain("99-19");
  });

  test("계약 주체는 합자회사 베스트투어 — 관계사 note 가 이를 명시한다", () => {
    expect(COMPANY.legalName).toBe("합자회사 베스트투어");
    expect(RELATED_COMPANY.note).toContain(COMPANY.legalName);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 5. 취소·환불 — 사장님 답변 2026-09-21 A-1 로 4단계 → 2단계 (P1-7 브리프 1-A 문안 그대로)
// ═════════════════════════════════════════════════════════════════════════
describe("5. 취소·환불 2단계 (P1-7 · A-1)", () => {
  test("CANCELLATION 은 브리프 1-A 의 객체와 바이트 단위로 같다", () => {
    expect(CANCELLATION).toEqual({
      basis: "deposit",
      tiers: [
        { when: "운행일 3일 전까지", refundPct: 100, label: "계약금 전액 환불" },
        { when: "운행일 2일 전부터 운행 당일까지", refundPct: 0, label: "계약금 환불 불가" },
      ],
      referenceTime:
        "기준은 운행일의 날짜(한국 시간)입니다. 예) 10일 운행이면 7일 23시 59분까지 취소하시면 계약금 전액을 돌려드리고, 8일부터는 돌려드리지 않습니다.",
      depositNote: "계약금은 10만원이며, 잔금과 지급 방법은 예약 확정 시 안내드립니다.",
      // P1-7 R3 [P2-F] — 표가 절대적으로 읽히지 않게: 표가 나오는 화면마다 표 바로 아래 싣는다
      scope:
        "위 규정은 고객 사정으로 취소하시는 경우에 적용되며, 제공된 서비스가 표시·광고 또는 계약 내용과 다른 경우 등 법에 따른 권리에는 영향을 주지 않습니다.",
      // P1-7 R2 [P1-4] — 확정 통지에 싣는 한 줄(약관 제8조 "예약 확정 통지에 고지") · R3 [P2-F] 로 범위를 밝혔다
      smsLine: "취소·환불 : 운행일 3일 전까지 취소 시 계약금 전액 환불, 2일 전부터는 계약금 환불 불가(고객 사정으로 취소하는 경우)",
      source: "사장님 답변 2026-09-21 A-1 (사용자 경유)",
    });
  });

  test("tiers 는 2단계, refundPct 는 [100, 0]", () => {
    expect(CANCELLATION.tiers).toHaveLength(2);
    expect(CANCELLATION.tiers.map((t) => t.refundPct)).toEqual([100, 0]);
  });

  test("옛 4단계 문구가 원장 어디에도 남지 않았다 (주석 포함)", () => {
    const src = ledgerLines.join("\n");
    for (const gone of ["운행일 8일 전까지", "운행일 7일 전 ~ 2일 전", "계약금의 80% 환불", "계약금의 50% 환불", "운행일 전날", "기준 시각은 운행 출발 시각입니다."]) {
      expect(src.includes(gone), gone).toBe(false);
    }
  });

  test("초과 운행 요금은 적지 않는다 (사장님: 받지 않음)", () => {
    expect(JSON.stringify(CANCELLATION)).not.toMatch(/초과/);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 5-b. P1-7 — 사장님 답변 반영 (A-2 청약철회 · A-4·A-9·A-21 연락처 · A-5 계좌 · 방문 통계). 문안은 브리프 그대로.
// ═════════════════════════════════════════════════════════════════════════
describe("5-b. P1-7 원장 변경 — 브리프 문안과 바이트 일치", () => {
  const eq = (actual: string, expected: string) => expect(Buffer.compare(Buffer.from(actual, "utf8"), Buffer.from(expected, "utf8"))).toBe(0);

  // P1-7 R2 [P1-1] — 옛 문구("운행일이 정해진 서비스이므로 … 7일 이내라도 … 따릅니다")는 법보다 넓게 읽혔다. R2 브리프의 새 문구.
  test("WITHDRAWAL — R2 브리프 [P1-1] 그대로 (noticeEn · smsLine 포함)", () => {
    expect(ledger.WITHDRAWAL).toEqual({
      notice:
        "이 서비스는 고객이 정한 운행일에 맞춰 차량을 따로 배차하는 전세버스 대절 알선 서비스입니다. 운행일 3일 전까지는 계약 시기와 관계없이 언제든 취소하시면 계약금 전액을 돌려드립니다. 운행일 2일 전부터는 배차한 차량을 다시 배정하기 어려워 「전자상거래 등에서의 소비자보호에 관한 법률」 제17조 제2항에 따라 청약철회가 제한될 수 있으며, 그 경우 계약 후 7일 이내라도 위 취소·환불 규정이 적용됩니다. 다만 제공된 서비스가 표시·광고 또는 계약 내용과 다른 경우에는 법에 따라 청약철회 등을 하실 수 있습니다.",
      // R3 [P2-G] — 한국어에만 있던 날짜 계산(한국 시간 · 예시)을 영문에도 넣고, 표가 "고객 사정 취소" 범위임을 밝힌다
      noticeEn:
        "This charter is arranged individually for the travel date you choose. If you cancel at least 3 days before the travel date, we refund your full deposit, no matter when you booked; days are counted by calendar date in Korea time, so for a trip on the 10th you can cancel until 11:59 pm on the 7th. From 2 days before the travel date, the vehicle assigned to you is hard to reassign, so your right of withdrawal under Korea's Act on the Consumer Protection in Electronic Commerce may be restricted; in that case the refund policy above applies even within 7 days of booking. The policy above covers cancellations you request; it does not affect your rights under the law, for example if the service provided differs from what was advertised or agreed. The Korean text is the legally binding version.",
      consentLabel: "위 청약철회 제한 내용을 확인했으며, 취소·환불이 위 규정에 따르는 데 동의합니다. (필수)",
      consentLabelEn:
        "I have read the restriction on withdrawal above and agree that cancellations and refunds follow the policy above. (required)",
      smsLine: "운행일 2일 전부터는 계약 후 7일 이내라도 청약철회가 제한될 수 있습니다.",
      source: "사장님 답변 2026-09-21 A-2 · 전자상거래법 §17②·③·⑥ · astra P1-7 리뷰 반영",
    });
  });

  test("옛 청약철회 문구가 원장 어디에도 남지 않았다 (주석 포함)", () => {
    const src = ledgerLines.join("\n");
    expect(src.includes("운행일이 정해진 서비스이므로")).toBe(false);
    expect(src.includes("계약 후 7일 이내라도 취소·환불은 위 취소·환불 규정에 따릅니다.")).toBe(false);
  });

  test("COMPANY — 통신판매업 신고 기관 · 예약·상담 전화(국내/국제) · 보호책임자 전화", () => {
    eq(COMPANY.mailOrderIssuer, "고양시 일산동구청");
    eq((COMPANY as unknown as Record<string, string>).consultTel, "010-6362-6188");
    eq((COMPANY as unknown as Record<string, string>).consultTelIntl, "+82 10-6362-6188");
    eq(COMPANY.privacyOfficer.phone, "010-6362-6188");
    expect(COMPANY.privacyOfficer.name).toBe("조선영");
    // 그대로 두는 것 — 대표전화(푸터 사업자 정보 한 줄) · 사장님 휴대전화 · 팩스
    expect(COMPANY.tel).toBe("1566-6188");
    expect(COMPANY.mobile).toBe("010-2048-8585");
    expect(COMPANY.fax).toBe("0303-3443-5252");
  });

  test("입금 계좌는 COMPANY 가 아니라 PAYMENT 에 있다 — 예금주가 관계사라 COMPANY 안에 두면 오독된다", () => {
    expect(Object.keys(COMPANY)).not.toContain("bankAccount");
    expect(Object.keys(COMPANY)).not.toContain("bankHolder");
    expect((ledger.PAYMENT as unknown as { account: unknown }).account).toEqual({
      bank: "하나은행",
      number: "255-910018-71504",
      holder: "(주)베스트모빌리티",
      holderRole: "관계사",
    });
    eq((ledger.PAYMENT as unknown as { accountLine: string }).accountLine, "입금 계좌 : 하나은행 255-910018-71504 (예금주 (주)베스트모빌리티 · 관계사)");
    eq(RELATED_COMPANY.note, "계약과 개인정보 처리의 주체는 합자회사 베스트투어이며, 대금은 관계사 (주)베스트모빌리티 명의 계좌로 받습니다.");
  });

  test("DISPUTE — 접수 창구는 예약·상담 전화, 처리 기한은 값 그대로", () => {
    eq(ledger.DISPUTE.channel, "예약·상담 전화 010-6362-6188 또는 이메일로 접수");
    eq(ledger.DISPUTE.handling, "접수 후 영업일 기준 3일 이내 처리 결과를 안내드립니다.");
  });

  test("국외이전 거부 안내의 전화는 호스팅·요청 제한·봇 차단 세 항목 모두 010-6362-6188", () => {
    const hosting = OVERSEAS_TRANSFERS.filter((t) => t !== ledger.VISITOR_STATS_TRANSFER);
    expect(hosting).toHaveLength(3);
    for (const t of hosting) {
      eq(
        t.refusal,
        "국외 이전을 거부하시려면 견적 신청을 하지 않으시면 됩니다. 본 서비스는 해외에 서버를 둔 클라우드 인프라를 이용하므로, 이전을 거부하시는 경우 온라인 견적 신청·예약 접수 이용이 제한됩니다. 전화(010-6362-6188)로는 이전 없이 상담하실 수 있습니다.",
      );
    }
  });

  // P1-7 R2 [사용자 결정] — 방문 통계는 호스팅과 **별도 항목**(자체 거부 수단·항목·보관 기간). 호스팅 항목의 목적은 되돌린다.
  test("방문 통계 — 호스팅 항목 목적은 '웹 호스팅' 으로 되돌리고, 별도 국외이전 항목을 호스팅 바로 뒤에 둔다", () => {
    expect(OVERSEAS_TRANSFERS).toHaveLength(4);
    eq(OVERSEAS_TRANSFERS[0].recipient, "Vercel Inc.");
    eq(OVERSEAS_TRANSFERS[0].purpose, "웹 호스팅");
    expect(OVERSEAS_TRANSFERS[1]).toBe(ledger.VISITOR_STATS_TRANSFER);
    expect(ledger.VISITOR_STATS_TRANSFER).toEqual({
      recipient: "Vercel Inc.",
      contact: "privacy@vercel.com",
      country: "미국",
      timingMethod: "공개 페이지를 여실 때 네트워크를 통해 전송",
      items: "방문한 페이지 주소(주소 뒤 매개변수 제외), 들어온 경로(이전 페이지 주소), 기기 종류·운영체제·브라우저, 접속 국가·지역",
      purpose: "방문 통계(방문 수·많이 보는 페이지·유입 경로 파악)",
      retention: "수집일로부터 12개월",
      // R3 [P1-B] — "근거" 칸이 근거가 아닌 설명만 담고 있었다. 동의를 받지 않는다는 사실을 먼저 밝히고 거부 수단으로 잇는다.
      legalBasis:
        "별도의 동의를 받지 않고 처리합니다. 수집되는 정보는 개인을 알아볼 수 없는 통계 목적으로만 이용하며, Vercel은 이 기능에서 쿠키를 쓰지 않고 IP 주소를 저장하지 않는다고 밝히고 있습니다. 원하지 않으시면 아래 방법으로 거부하실 수 있습니다.",
      // R4 [P2-E] — 저장이 막힌 브라우저에서는 "그 브라우저에서는 보내지 않는다" 가 참이 아니다(다른 탭·새로고침). 사실대로 적는다.
      refusal:
        "이 항목의 '방문 통계 거부' 버튼을 누르시면 그 브라우저에서는 방문 통계를 보내지 않습니다. 거부 표시는 브라우저 저장소에 남는데, 저장이 막혀 있는 브라우저(사생활 보호 모드 등)에서는 이번 방문 동안만 적용되므로 그때는 브라우저의 추적 거부(Do Not Track·GPC) 설정을 함께 켜 주시기 바랍니다. 추적 거부·GPC 설정은 별도 조작 없이 거부로 봅니다. 거부하셔도 사이트 이용에는 제한이 없습니다.",
    });
  });

  test("위탁(PROCESSORS)의 Vercel 업무에 '방문 통계' 를 더했다", () => {
    const vercel = ledger.PROCESSORS.find((p) => p.name === "Vercel Inc.");
    eq(vercel?.task ?? "", "웹 호스팅·서버 운영, 방문 통계");
  });

  test("자동 수집 장치 절 — 앞 문장은 그대로, 방문 통계 문장은 R2 문구로 바꿨다", () => {
    const cookies = ledger.PRIVACY_POLICY_SECTIONS.find((s) => s.key === "cookies") as { body: string };
    const before =
      "사이트는 팝업 \"오늘 하루 보지 않기\" 등 이용 편의를 위해 브라우저 저장소(localStorage)를 사용합니다. 이는 개인을 식별하지 않으며, 브라우저 설정에서 저장소를 삭제하거나 차단할 수 있습니다.";
    // R4 [P2-E] — 마지막 문장 뒤에 한 문장만 덧붙였다(앞 문장들은 바이트 그대로). 저장이 막힌 브라우저의 한계를 여기서도 밝힌다.
    const appended =
      "또한 방문 통계를 위해 Vercel Web Analytics를 사용합니다. Vercel은 이 기능에서 쿠키를 쓰지 않고 IP 주소를 저장하지 않으며 하루 단위로 초기화되는 값으로 방문 수를 센다고 밝히고 있습니다. 회사는 관리자 화면 주소를 보내지 않고, 주소 뒤에 붙는 매개변수(검색어·접수번호 등)는 지운 뒤 보냅니다. 방문 통계는 개인정보처리방침의 '방문 통계 거부' 버튼이나 브라우저의 추적 거부(Do Not Track·GPC) 설정으로 거부하실 수 있으며, 거부 표시는 브라우저 저장소(localStorage)에 남습니다. 저장이 막혀 있는 브라우저에서는 그 표시가 남지 않아 이번 방문 동안만 적용되므로, 그때는 브라우저의 추적 거부 설정을 함께 켜 주시기 바랍니다.";
    eq(cookies.body, `${before} ${appended}`);
    // P1-7 의 옛 문장("쿠키를 설치하지 않고 … 수집하지 않습니다.")은 남지 않는다
    expect(cookies.body.includes("관리자 화면 주소와 주소 뒤에 붙는 매개변수(검색어·접수번호 등)는 수집하지 않습니다.")).toBe(false);
  });

  test("방문 통계 거부 버튼 라벨 — LEGAL_LABELS.analyticsOptOut (영문은 en.json legal)", () => {
    const labels = (ledger.LEGAL_LABELS as unknown as { analyticsOptOut: Record<string, string> }).analyticsOptOut;
    eq(labels.optOut, "방문 통계 거부");
    eq(labels.optIn, "방문 통계 다시 허용");
    // R3 [P2-C] — 저장에 실패해도 이번 방문 동안은 실제로 멈춘다. 문구가 그 사실을 말한다(UI 문구 — 구현자 작성).
    eq(labels.storageFailed, "설정을 저장하지 못했습니다. 이번 방문 동안에는 이 브라우저에서 방문 통계를 보내지 않습니다.");
    eq(labels.browserRefused, "브라우저의 추적 거부 설정으로 이미 거부 중입니다");
    expect(Object.keys(labels).sort()).toEqual(["browserRefused", "optIn", "optOut", "storageFailed"]);
  });

  // P1-7 R2 [P2-9] — 처리방침에 표시하는 시행일과 동의 기록의 방침 버전은 같은 상수다.
  test("처리방침 시행일 = 동의 기록 버전 (한 곳에서 읽는다) · 값 2026-09-21 · TEMP 유지", async () => {
    const { PRIVACY_POLICY_VERSION } = await import("@/lib/reservations/consent");
    expect(ledger.LEGAL_PAGES.privacy.effectiveDate).toBe("2026-09-21");
    expect(PRIVACY_POLICY_VERSION).toBe(ledger.LEGAL_PAGES.privacy.effectiveDate);
    const consentSrc = readFileSync(path.join(ROOT, "lib/reservations/consent.ts"), "utf8");
    expect(consentSrc).toMatch(/export const PRIVACY_POLICY_VERSION(?:: string)? = LEGAL_PAGES\.privacy\.effectiveDate;/);
    expect(ledgerLines.some((l) => l.includes(`${TEMP_MARKER} LEGAL_PAGES.privacy.effectiveDate:`))).toBe(true);
  });

  test("값은 그대로, TEMP 마커만 해제 — PAYMENT.balanceTiming · PRIVACY_NOTICE.retention · retentionDays · DISPUTE.handling", () => {
    expect(ledger.PAYMENT.balanceTiming).toBe("예약 확정 시 안내");
    expect(PRIVACY_NOTICE.retentionDays).toBe(365);
    expect(PRIVACY_NOTICE.retention.startsWith("접수일로부터 1년.")).toBe(true);
    const released = [
      "COMPANY.mailOrderIssuer",
      "COMPANY.bankHolder",
      "PAYMENT.balanceTiming",
      "CANCELLATION.basis",
      "PRIVACY_NOTICE.retention",
      "PRIVACY_NOTICE.retentionDays",
      "DISPUTE.handling",
    ];
    // 마커 키는 "// <마커> CONST.field:" 꼴이다. 남는 TERMS 제6조 마커의 사유 문장이 "PAYMENT.balanceTiming 과 함께" 를 언급하므로 키 자리만 본다.
    for (const key of released) {
      const hits = ledgerLines.filter((l) => l.includes(`${TEMP_MARKER} ${key}:`));
      expect(hits, key).toEqual([]);
    }
  });

  test("옛 계좌·옛 보호책임자 번호가 원장 어디에도 없다 (주석 포함)", () => {
    const src = ledgerLines.join("\n");
    for (const gone of ["KB국민", "690101-00-050894", "010-2047-8585"]) expect(src.includes(gone), gone).toBe(false);
  });

  test("1566-6188 은 원장에서 COMPANY.tel 한 곳에만 있다 — 안내 문장(분쟁·국외이전 거부)은 예약·상담 전화를 쓴다", () => {
    const hits = codeLines.filter((l) => l.includes("1566-6188"));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/^\s*tel: "1566-6188",/);
  });

  test("예약·상담 전화 라벨 — LEGAL_LABELS.contact.consultTel", () => {
    eq((ledger.LEGAL_LABELS.contact as unknown as Record<string, string>).consultTel, "예약·상담 전화");
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("6. 개인정보 4대 고지 (PIPA §15②)", () => {
  test.for([["purpose"], ["itemsLine"], ["retention"], ["refusal"]] as const)(
    "PRIVACY_NOTICE.%s 가 비어 있지 않다",
    ([key]) => {
      expect(PRIVACY_NOTICE[key].trim().length).toBeGreaterThan(0);
    },
  );

  test("items 배열은 비어 있지 않고 각 항목도 비어 있지 않다", () => {
    expect(PRIVACY_NOTICE.items.length).toBeGreaterThan(0);
    for (const item of PRIVACY_NOTICE.items) expect(item.trim().length).toBeGreaterThan(0);
  });

  test("itemsLine 은 items 를 쉼표로 이은 것과 같다 (두 표기가 어긋나지 않게)", () => {
    expect(PRIVACY_NOTICE.itemsLine).toBe(PRIVACY_NOTICE.items.join(", "));
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("7. 처리위탁 (PIPA §26②)", () => {
  test("PROCESSORS 는 5개", () => {
    expect(PROCESSORS).toHaveLength(5);
  });

  test("각 name · task 가 비어 있지 않다", () => {
    for (const p of PROCESSORS) {
      expect(p.name.trim().length, JSON.stringify(p)).toBeGreaterThan(0);
      expect(p.task.trim().length, JSON.stringify(p)).toBeGreaterThan(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("8. TEMP 마커 ↔ 허용 목록 1:1", () => {
  // 원장의 마커 줄
  const tempLines = ledgerLines.filter((l) => l.includes(TEMP_MARKER));

  // 허용 목록 중 이 파일 항목 — check-temp-values.sh 와 같은 파싱(첫 콜론 기준, # 은 주석)
  const allowPatterns = readLines(ALLOWLIST_REL)
    .filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => ({ file: l.slice(0, l.indexOf(":")).replace(/^\.\//, ""), pattern: l.slice(l.indexOf(":") + 1) }))
    .filter((e) => e.file === LEDGER_REL)
    .map((e) => e.pattern);

  test("마커는 값이 아니라 줄 끝 주석에만 있다 (문자열 값으로 배포되지 않는다)", () => {
    for (const l of tempLines) {
      const c = l.indexOf("//");
      expect(c, l).toBeGreaterThan(-1);
      expect(l.indexOf(TEMP_MARKER), l).toBeGreaterThan(c);
    }
  });

  test("마커 줄마다 허용 목록 항목이 정확히 하나 매칭된다", () => {
    for (const l of tempLines) {
      const matched = allowPatterns.filter((p) => new RegExp(p).test(l));
      expect(matched, l).toHaveLength(1);
    }
  });

  test("허용 목록 항목마다 마커 줄이 정확히 하나 매칭된다 (죽은 항목 없음)", () => {
    for (const p of allowPatterns) {
      const matched = tempLines.filter((l) => new RegExp(p).test(l));
      expect(matched, p).toHaveLength(1);
    }
  });

  test("마커 수 === 허용 목록 항목 수", () => {
    expect(tempLines.length).toBe(allowPatterns.length);
  });

  test("마커 주석은 `CONST.field:` 키로 시작한다 (보고서·사장님 질문 목록의 키)", () => {
    // 소스에 마커 리터럴이 남지 않도록 이스케이프된 문자열로 조립한다
    const keyed = new RegExp("// \\[TEMP\\] [A-Z_]+(\\.[A-Za-z]+)+: ");
    for (const l of tempLines) expect(l, l).toMatch(keyed);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("9. 게이트와 원장이 실제로 맞물린다", { timeout: GATE_TIMEOUT_MS }, () => {
  test("bash scripts/check-legal-disclosures.sh → exit 0 (대상 = 원장, OK)", async () => {
    const r = await runLegalGate();
    expect(r.out, r.out).toContain(`대상 = ${LEDGER_REL}`);
    expect(r.out, r.out).toContain("OK");
    expect(r.status, r.out).toBe(0);
  });
});

// =============================================================================
// 국외이전 필수 항목 완결성 (2026-09-11 독립 리뷰 F1·F2 재발 방지)
//
// 왜 이 테스트가 필요한가: 화면(LegalTable)은 빈 값 행을 숨긴다. 그 자체는 옳다 —
// 열 단위로 지우면 수탁자가 목록에서 사라져 PIPA §26② 공개 의무를 깬다. 그런데 그 결과
// **법정 필수 항목이 빈 채로 숨겨져도 아무도 모른다.** 실제로 Supabase 의 country 가 "" 인
// 상태로 게이트 4종·테스트 515건을 전부 통과했고, "빈 <td> 0" 단언은 green 이었다.
//
// 이 사이트는 별도 동의가 아니라 §28조의8①3호가목(계약 이행 위탁 + 처리방침 공개)을 근거로
// 국외이전을 한다. 그 근거는 제2항 **각 호를 전부** 공개해야 성립한다. 하나라도 비면 근거가 없다.
// =============================================================================
describe("OVERSEAS_TRANSFERS — PIPA §28조의8② 각 호 완결성", () => {
  /** 제2항 각 호 → 원장 필드. 하나라도 비면 적법 근거가 사라진다. */
  const STATUTORY: ReadonlyArray<{ ho: string; fields: readonly string[] }> = [
    { ho: "1호 이전되는 개인정보 항목", fields: ["items"] },
    { ho: "2호 이전되는 국가·시기·방법", fields: ["country", "timingMethod"] },
    { ho: "3호 이전받는 자의 명칭·연락처", fields: ["recipient", "contact"] },
    { ho: "4호 이용목적·보유이용기간", fields: ["purpose", "retention"] },
    { ho: "5호 거부 방법·절차·효과", fields: ["refusal"] },
  ];

  /**
   * 아직 채울 수 없는 칸. **오픈 전 반드시 0 이 되어야 한다**(플랜 §8 오픈 게이트).
   * 여기 없는 공란은 실패한다. 여기 있는 칸이 채워져도 실패한다 — 목록이 줄어들도록 강제하는 래칫이다.
   */
  const PENDING: ReadonlyArray<{ recipient: string; field: string; why: string }> = [
    { recipient: "Upstash Inc.", field: "contact", why: "계정 미발급(P0-1). 개인정보 연락처를 지어내지 않는다" },
    { recipient: "Upstash Inc.", field: "country", why: "계정 미발급(P0-1). 리전이 정해지지 않았다" },
  ];

  const allFields = STATUTORY.flatMap((s) => s.fields);
  const pendingKey = (r: string, f: string) => `${r}|${f}`;
  const pendingSet = new Set(PENDING.map((p) => pendingKey(p.recipient, p.field)));

  test("모든 레코드가 5개 호에 해당하는 필드를 전부 갖는다(키 존재)", () => {
    for (const t of OVERSEAS_TRANSFERS) {
      for (const f of allFields) {
        expect(Object.keys(t), `${t.recipient} 에 ${f} 키가 없다`).toContain(f);
      }
    }
  });

  test("PENDING 에 없는 공란이 하나도 없다", () => {
    const blanks: string[] = [];
    for (const t of OVERSEAS_TRANSFERS) {
      for (const f of allFields) {
        const v = (t as unknown as Record<string, string>)[f];
        if (!v || v.trim() === "") {
          if (!pendingSet.has(pendingKey(t.recipient, f))) blanks.push(`${t.recipient}.${f}`);
        }
      }
    }
    expect(
      blanks,
      "국외이전 필수 항목이 비었다 — 화면은 이 행을 숨기므로 눈으로는 안 보인다.\n" +
        "값을 채우거나, 아직 못 채우면 PENDING 에 사유와 함께 등록하고 오픈 게이트로 올려라:\n" +
        blanks.join("\n"),
    ).toEqual([]);
  });

  test("PENDING 항목이 채워졌으면 목록에서 빼라(래칫)", () => {
    const stale: string[] = [];
    for (const p of PENDING) {
      const rec = OVERSEAS_TRANSFERS.find((t) => t.recipient === p.recipient);
      if (!rec) { stale.push(`${p.recipient} 레코드가 없다 — PENDING 에서 제거하라`); continue; }
      const v = (rec as unknown as Record<string, string>)[p.field];
      if (v && v.trim() !== "") stale.push(`${p.recipient}.${p.field} 이 채워졌다 — PENDING 에서 제거하라`);
    }
    expect(stale).toEqual([]);
  });

  test("국내 처리자를 국외이전 목록에 넣지 않는다", () => {
    const domestic = OVERSEAS_TRANSFERS.filter((t) => /대한민국|한국|Korea/i.test(t.country));
    expect(
      domestic.map((t) => t.recipient),
      "국내 리전 처리자는 국외이전이 아니다. PROCESSORS 에만 둬라(2026-09-11 Supabase 사례)",
    ).toEqual([]);
  });
});
