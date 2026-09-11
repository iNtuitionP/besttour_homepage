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
describe("5. 취소·환불 4단계", () => {
  test("tiers 는 4단계", () => {
    expect(CANCELLATION.tiers).toHaveLength(4);
  });

  test("refundPct 는 [100, 80, 50, 0] 순서", () => {
    expect(CANCELLATION.tiers.map((t) => t.refundPct)).toEqual([100, 80, 50, 0]);
  });

  test("당일을 제외한 모든 label 에 계약금 포함, 당일은 환불 불가", () => {
    const [d8, d7, d1, d0] = CANCELLATION.tiers;
    for (const t of [d8, d7, d1]) expect(t.label, t.when).toContain("계약금");
    expect(d0.when).toContain("당일");
    expect(d0.label).toBe("환불 불가");
    expect(d0.label).not.toContain("계약금");
  });

  test("기준액이 계약금이면 depositNote 가 10만원을 말한다", () => {
    expect(CANCELLATION.basis).toBe("deposit");
    expect(CANCELLATION.depositNote).toContain("10만원");
    expect(CANCELLATION.referenceTime.length).toBeGreaterThan(0);
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
