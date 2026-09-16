/**
 * P0-5 — 게이트 3종을 픽스처로 실증한다.
 *
 * 각 스크립트는 CLAUDE_PROJECT_DIR 환경변수를 프로젝트 루트로 존중하므로,
 * 임시 디렉터리에 픽스처를 만들고 그 경로를 루트로 위장해 exit code 를 단언한다.
 *
 * 주의 1: 이 파일은 tests/ 아래에 있어 그 자체가 세 게이트의 검사 대상이다.
 *   금지어·임시값 마커 리터럴을 소스에 그대로 두면 실제 저장소 실행이 빨간불이 되므로
 *   유니코드 이스케이프 / 문자열 결합으로 조립한다 (아래 상수 블록).
 * 주의 2: Windows Git Bash 는 프로세스 생성이 느리다(bash 기동 0.2초 + fork 1회 0.1초).
 *   테스트는 비동기 spawn 으로 돌리고 describe.concurrent 로 겹쳐 실행한다.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPTS = path.join(ROOT, "scripts");
// 게이트 설정 파일은 커밋되는 경로에 둔다. .superpowers/ 는 gitignore 라 CI 체크아웃에 없다 —
// 거기 두면 드리프트 게이트는 CI 에서 무의미하게 통과하고, 임시값 게이트는 허용 목록이 없어 빨간불이 난다.
const GATES = "scripts/gates";
const BASELINE = `${GATES}/mockup-baseline.json`;
const ALLOWLIST = `${GATES}/temp-allowlist.txt`;
const GATE_TIMEOUT_MS = 60_000;

// ── 금지어·마커 (리터럴 금지 — 위 헤더 참조) ─────────────────────────────
const W_LICENSE = "\uba74\ud5c8"; // "등록"이 맞다 — CLAUDE.md §3
const W_RIVAL = "\uc804\uc138\ubc84\uc2a4\ud558\ub098"; // 타사 상호
const W_BM_OUTBOUND = "\ub098\uac00\ub294 \ubc84\uc2a4"; // soul §10.2
const W_BM_EMPTY = "\uacf5\ucc28"; // soul §10.2
const W_BM_RETURN = "\ud68c\uc1a1"; // soul §10.2
const TEMP_MARKER = "[TEMP" + "]";
const TODO_MARKER = "TODO(" + "실값)";
const PLACEHOLDER_MARKER = "__PLACE" + "HOLDER__";

// ── verbatim 2건 (CLAUDE.md §3 — 원문 그대로) ────────────────────────────
const VERBATIM_CONFIRM = "사장님 확정 후 연락드리며, 확정된 예약만 결제 진행됩니다.";
const VERBATIM_TOP5 = "대표 노선 예시 견적 · 45인승 당일왕복 기준 · 실제 견적은 상담 후 확정";

// ── bash 해석 ────────────────────────────────────────────────────────────
// Windows 에서 PATH 의 `bash` 는 WSL(System32\bash.exe)로 잡힐 수 있다. Git for Windows 의
// bin/bash.exe 를 명시적으로 찾고, coreutils(sha256sum·tr) 가 보이도록 usr/bin 을 PATH 앞에 둔다.
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

const BASH = resolveBash();

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

interface GateResult {
  status: number | null;
  out: string;
}

function runGate(script: string, projectDir: string, args: string[]): Promise<GateResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(BASH.bin, [toPosix(path.join(SCRIPTS, script)), ...args], {
      env: { ...BASH.env, CLAUDE_PROJECT_DIR: toPosix(projectDir) },
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

// ── 픽스처 ───────────────────────────────────────────────────────────────
class Fixture {
  constructor(readonly dir: string) {}

  put(rel: string, content: string | Buffer): void {
    const p = path.join(this.dir, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  }

  read(rel: string): string {
    return readFileSync(path.join(this.dir, rel), "utf8");
  }

  readBytes(rel: string): Buffer {
    return readFileSync(path.join(this.dir, rel));
  }

  exists(rel: string): boolean {
    return existsSync(path.join(this.dir, rel));
  }

  remove(rel: string): void {
    rmSync(path.join(this.dir, rel));
  }

  run(script: string, ...args: string[]): Promise<GateResult> {
    return runGate(script, this.dir, args);
  }
}

// vitest 픽스처의 두 번째 인자는 관례상 `use` 지만, 그 이름은 react-hooks/rules-of-hooks 가 React 훅으로
// 오인해 lint 에러를 낸다. 이름은 자유이므로 `provide` 로 받는다.
const it = test.extend<{ fx: Fixture }>({
  fx: async ({ task }, provide) => {
    const dir = mkdtempSync(path.join(tmpdir(), `bestour-gates-${task.id.replace(/[^\w-]/g, "")}-`));
    await provide(new Fixture(dir));
    rmSync(dir, { recursive: true, force: true });
  },
});

// 상수만 있고 verbatim 2건을 모두 담은 정상 원장 (5줄 + 마지막 개행)
const GOOD_LEDGER = [
  "// lib/legal/disclosures.ts — 법정 문구 단일 원장 (ADR-5: 상수만, 함수 export 0개)",
  'export const BUSINESS = { name: "베스트투어", type: "전세버스 운송사업 등록" } as const;',
  `export const CONFIRMATION_NOTICE = "${VERBATIM_CONFIRM}";`,
  `export const TOP5_NOTICE = "${VERBATIM_TOP5}";`,
  'export const REFUND_STAGES = ["1단계", "2단계", "3단계", "4단계"] as const;',
  "",
].join("\n");

// ═════════════════════════════════════════════════════════════════════════
describe.concurrent("check-legal-disclosures.sh", { timeout: GATE_TIMEOUT_MS }, () => {
  const SCRIPT = "check-legal-disclosures.sh";

  it("대상 파일 없음 → exit 0, 대상 없음 안내", async ({ fx }) => {
    fx.put("lib/other.ts", "export const x = 1;\n");
    const r = await fx.run(SCRIPT);
    expect(r.out).toContain("대상 없음");
    expect(r.status).toBe(0);
  });

  it("verbatim 2건 + 상수만 있는 원장 → exit 0", async ({ fx }) => {
    fx.put("lib/legal/disclosures.ts", GOOD_LEDGER);
    const r = await fx.run(SCRIPT);
    expect(r.out).toContain("OK");
    expect(r.status).toBe(0);
  });

  it("verbatim 1건 누락 (Top-5 고지) → exit 1, 누락 문구 표시", async ({ fx }) => {
    fx.put("lib/legal/disclosures.ts", GOOD_LEDGER.replace(VERBATIM_TOP5, "대표 노선 예시 견적"));
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
    expect(r.out).toContain("lib/legal/disclosures.ts");
    expect(r.out).toContain(VERBATIM_TOP5);
  });

  it("verbatim 이 바이트 단위로 달라지면(가운뎃점 U+00B7 → U+2027) → exit 1", async ({ fx }) => {
    fx.put("lib/legal/disclosures.ts", GOOD_LEDGER.replace(/\u00b7/g, "\u2027"));
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
  });

  it("verbatim 이 주석 줄에만 있으면 부족하다 → exit 1", async ({ fx }) => {
    const ledger = GOOD_LEDGER.replace(
      `export const TOP5_NOTICE = "${VERBATIM_TOP5}";`,
      `// ${VERBATIM_TOP5}\nexport const TOP5_NOTICE = "TBD";`,
    );
    fx.put("lib/legal/disclosures.ts", ledger);
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
  });

  it("CRLF 로 저장된 원장도 같은 결과 (autocrlf 환경) → exit 0", async ({ fx }) => {
    fx.put("lib/legal/disclosures.ts", GOOD_LEDGER.replace(/\n/g, "\r\n"));
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(0);
  });

  it.for([
    { label: "export function", line: "export function fmt(x: string) { return x; }" },
    { label: "export default function", line: "export default function fmt(x: string) { return x; }" },
    { label: "export async function", line: "export async function load() { return 1; }" },
    { label: "export const = (", line: "export const fmt = (x: string) => x;" },
    { label: "export const = async", line: "export const load = async () => 1;" },
    { label: "export const : Type = (", line: "export const fmt: (x: string) => string = (x) => x;" },
    { label: "export 줄의 =>", line: "export const fmt = x => x;" },
  ])("함수 export 검출 — $label → exit 1 (파일:줄 출력)", async ({ line }, { fx }) => {
    fx.put("lib/legal/disclosures.ts", `${GOOD_LEDGER}${line}\n`);
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
    expect(r.out).toContain("lib/legal/disclosures.ts:6:");
  });

  it("주석 줄의 함수 패턴은 오탐 — `// export function` 만 있으면 exit 0", async ({ fx }) => {
    fx.put("lib/legal/disclosures.ts", `${GOOD_LEDGER}// export function 은 여기 금지 (ADR-5)\n`);
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(0);
  });

  it("금지어가 원장의 코드 줄에 등장 → exit 1, 파일:줄 출력", async ({ fx }) => {
    fx.put("lib/legal/disclosures.ts", `${GOOD_LEDGER}export const LICENSE = "전세버스 ${W_LICENSE}";\n`);
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
    expect(r.out).toContain("lib/legal/disclosures.ts:6:");
  });

  it.for([
    { file: "app/page.tsx", word: W_LICENSE },
    { file: "components/Footer.tsx", word: W_RIVAL },
    { file: "i18n/messages.ts", word: W_BM_OUTBOUND },
    { file: "messages/ko.json", word: W_BM_EMPTY },
    { file: "styles/notes.css", word: W_BM_RETURN },
    { file: "tests/foo.test.ts", word: W_LICENSE },
  ])("대상 파일이 없어도 금지어 grep 은 돈다 — $file → exit 1", async ({ file, word }, { fx }) => {
    fx.put(file, `const copy = "${word}";\n`);
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
    expect(r.out).toContain(`${file}:1:`);
  });

  it("주석 줄의 금지어는 오탐 — //, /*, *, # 로 시작하는 줄만 있으면 exit 0", async ({ fx }) => {
    fx.put(
      "lib/legal/disclosures.ts",
      [
        `// "${W_LICENSE}"는 금지어 — 등록이 맞다`,
        `/* ${W_RIVAL} 는 타사 상호이므로 쓰지 않는다 */`,
        `  * ${W_BM_EMPTY}, ${W_BM_RETURN} — soul §10.2 BM 비노출`,
        `# ${W_BM_OUTBOUND} 도 금지`,
        GOOD_LEDGER,
      ].join("\n"),
    );
    fx.put("lib/notes.ts", `  // ${W_LICENSE} 라는 단어는 카피에 쓰지 말 것\nexport const NOTE = 1;\n`);
    const r = await fx.run(SCRIPT);
    expect(r.out).not.toContain("lib/notes.ts:1:");
    expect(r.status).toBe(0);
  });

  it("같은 파일에서 주석 줄은 빠지고 코드 줄만 잡힌다", async ({ fx }) => {
    fx.put("lib/copy.ts", [`// ${W_LICENSE} 금지`, `export const bad = "${W_LICENSE}";`, ""].join("\n"));
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
    expect(r.out).toContain("lib/copy.ts:2:");
    expect(r.out).not.toContain("lib/copy.ts:1:");
  });

  it("검사 대상 디렉터리가 하나도 없어도 exit 0", async ({ fx }) => {
    fx.put("README.md", `${W_LICENSE}\n`);
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(0);
  });

  // ── (d) 실증 불가 주장 (P6-6) — tests 를 뺀 대상에서만 돈다 ──────────────────
  // 여기 문자열은 리터럴로 적어도 된다: (d) 의 대상 배열에 tests 가 없기 때문이다.
  // 그 "tests 제외"가 규약이라는 것 자체를 아래 마지막 두 케이스가 단언한다.
  it.for([
    { file: "messages/ko.json", claim: "무사고" },
    { file: "app/page.tsx", claim: "업계 1위" },
    { file: "components/Hero.tsx", claim: "국내 최대" },
    { file: "lib/copy.ts", claim: "최저가 보장" },
    { file: "i18n/messages.ts", claim: "누적 견적" },
    { file: "styles/notes.css", claim: "누적 운행" },
    { file: "supabase/migrations/0099_seed.sql", claim: "4,800" },
  ])("실증 불가 주장을 잡는다 — $file / $claim → exit 1", async ({ file, claim }, { fx }) => {
    fx.put(file, `const copy = "${claim}";\n`);
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
    expect(r.out).toContain(`${file}:1:`);
  });

  it("tests/ 의 같은 문자열은 잡지 않는다 — 테스트는 '없어야 한다'를 단언하려고 정당하게 담는다", async ({ fx }) => {
    fx.put("tests/copy.test.ts", `expect(text).not.toContain("무사고");\nexpect(text).not.toContain("업계 1위");\n`);
    const r = await fx.run(SCRIPT);
    expect(r.out).not.toContain("tests/copy.test.ts:");
    expect(r.status).toBe(0);
  });

  it("주석 줄의 실증 불가 주장은 오탐 — 코드 줄만 잡는다", async ({ fx }) => {
    fx.put("lib/copy.ts", [`// 무사고 는 실증 불가라 쓰지 않는다`, `export const ok = 1;`, ""].join("\n"));
    const r = await fx.run(SCRIPT);
    expect(r.out).not.toContain("lib/copy.ts:1:");
    expect(r.status).toBe(0);
  });

  it("오탐이 큰 패턴은 넣지 않았다 — 쉼표 없는 4800(픽셀·타임아웃)·최다(일반 어휘)·N개 시도(attempt)", async ({ fx }) => {
    fx.put("styles/a.css", ".x { width: 4800px; }\n");
    fx.put("lib/b.ts", "export const TIMEOUT_MS = 4800;\n");
    fx.put("lib/c.ts", 'export const note = "최다 득표";\n');
    fx.put("lib/d.ts", 'export const retry = "3개 시도 후 중단";\n');
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(0);
  });

  it("supabase/ 도 금지어 검사 대상이다 (P6-6 — 시드 SQL 에 한글 카피가 들어간다)", async ({ fx }) => {
    fx.put("supabase/migrations/0099_seed.sql", `insert into t values ('${W_RIVAL}');\n`);
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
    expect(r.out).toContain("supabase/migrations/0099_seed.sql:1:");
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe.concurrent("check-mockup-drift.sh", { timeout: GATE_TIMEOUT_MS }, () => {
  const SCRIPT = "check-mockup-drift.sh";
  const MOCKUPS = ["variant-08-map-hero.html", "wizard-b.html", "admin.html"] as const;

  function seedMockups(fx: Fixture): void {
    for (const name of MOCKUPS) {
      fx.put(`mockups/${name}`, `<!doctype html>\n<title>${name}</title>\n<p>v8.1</p>\n`);
    }
  }

  // PNG 시그니처 + 임의 바이트 — 실제 이미지일 필요는 없다
  function png(seed: number): Buffer {
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([seed, 1, 2, 3])]);
  }

  function seedBrand(fx: Fixture): void {
    for (const [name, seed] of [
      ["logo-bestour.png", 1],
      ["symbol-mark.png", 2],
    ] as const) {
      fx.put(`public/brand/${name}`, png(seed));
      fx.put(`mockups/assets/brand/${name}`, png(seed));
    }
  }

  // 스크립트의 hash_text 와 같은 규약: CR 제거 후 sha256
  function normalizedSha256(bytes: Buffer): string {
    return createHash("sha256")
      .update(Buffer.from(bytes.filter((b) => b !== 0x0d)))
      .digest("hex");
  }

  // --update 를 스폰하지 않고 같은 규약으로 베이스라인을 쓴다 (스폰 1회 절약)
  function writeBaseline(fx: Fixture): Record<string, string> {
    const baseline: Record<string, string> = {};
    for (const name of MOCKUPS) baseline[name] = normalizedSha256(fx.readBytes(`mockups/${name}`));
    fx.put(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
    return baseline;
  }

  it("베이스라인 없음 → exit 0 + 첫 실행 안내", async ({ fx }) => {
    seedMockups(fx);
    seedBrand(fx);
    const r = await fx.run(SCRIPT);
    expect(r.out).toContain("--update");
    expect(r.status).toBe(0);
  });

  it("--update 가 3개 키의 sha256 베이스라인을 만들고(JS 계산값과 일치), 이후 일반 실행은 exit 0", async ({
    fx,
  }) => {
    seedMockups(fx);
    seedBrand(fx);
    const u = await fx.run(SCRIPT, "--update");
    expect(u.status).toBe(0);
    const baseline = JSON.parse(fx.read(BASELINE)) as Record<string, string>;
    expect(Object.keys(baseline).sort()).toEqual([...MOCKUPS].sort());
    for (const name of MOCKUPS) {
      expect(baseline[name]).toMatch(/^[0-9a-f]{64}$/);
      expect(baseline[name]).toBe(normalizedSha256(fx.readBytes(`mockups/${name}`)));
    }

    const r = await fx.run(SCRIPT);
    expect(r.out).toContain("OK");
    expect(r.status).toBe(0);
  });

  it("해시 일치 → exit 0", async ({ fx }) => {
    seedMockups(fx);
    seedBrand(fx);
    writeBaseline(fx);
    const r = await fx.run(SCRIPT);
    expect(r.out).toContain("OK");
    expect(r.status).toBe(0);
  });

  it("목업 1바이트 변경 → exit 1 + 갱신 안내, 베이스라인은 자동 갱신되지 않는다", async ({ fx }) => {
    seedMockups(fx);
    seedBrand(fx);
    writeBaseline(fx);
    const before = fx.read(BASELINE);

    fx.put("mockups/wizard-b.html", fx.read("mockups/wizard-b.html").replace("v8.1", "v8.2"));

    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
    expect(r.out).toContain("wizard-b.html");
    expect(r.out).toContain("목업이 바뀌었다");
    expect(fx.read(BASELINE)).toBe(before);
  });

  it("줄바꿈(CRLF↔LF)만 다른 목업은 드리프트가 아니다 → exit 0 (autocrlf 환경과 CI 해시 일치)", async ({ fx }) => {
    seedMockups(fx);
    seedBrand(fx);
    writeBaseline(fx);
    fx.put("mockups/variant-08-map-hero.html", fx.read("mockups/variant-08-map-hero.html").replace(/\n/g, "\r\n"));
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(0);
  });

  it("베이스라인은 있는데 목업 파일이 사라짐 → exit 1", async ({ fx }) => {
    seedMockups(fx);
    seedBrand(fx);
    writeBaseline(fx);
    fx.remove("mockups/admin.html");
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
    expect(r.out).toContain("admin.html");
  });

  it("베이스라인에 키가 빠져 있음 → exit 1", async ({ fx }) => {
    seedMockups(fx);
    seedBrand(fx);
    fx.put(BASELINE, JSON.stringify({ "variant-08-map-hero.html": "0".repeat(64) }, null, 2));
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
    expect(r.out).toContain("wizard-b.html");
  });

  it("--update 는 목업 파일이 하나라도 없으면 베이스라인을 쓰지 않는다 → exit 2", async ({ fx }) => {
    fx.put("mockups/admin.html", "<p>only one</p>\n");
    const r = await fx.run(SCRIPT, "--update");
    expect(r.status).toBe(2);
    expect(fx.exists(BASELINE)).toBe(false);
  });

  it("브랜드 자산 1:1 일치 → exit 0", async ({ fx }) => {
    seedMockups(fx);
    seedBrand(fx);
    writeBaseline(fx);
    const r = await fx.run(SCRIPT);
    expect(r.out).toContain("일치 2건, 불일치 0건");
    expect(r.status).toBe(0);
  });

  it("public/brand 에만 있는 파일 → exit 1", async ({ fx }) => {
    seedMockups(fx);
    seedBrand(fx);
    writeBaseline(fx);
    fx.put("public/brand/logo-bestmobility.png", png(3));
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
    expect(r.out).toContain("logo-bestmobility.png");
  });

  it("mockups/assets/brand 에만 있는 파일 → exit 1", async ({ fx }) => {
    seedMockups(fx);
    seedBrand(fx);
    writeBaseline(fx);
    fx.put("mockups/assets/brand/extra.png", png(4));
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
    expect(r.out).toContain("extra.png");
  });

  it("같은 이름, 다른 바이트 → exit 1", async ({ fx }) => {
    seedMockups(fx);
    seedBrand(fx);
    writeBaseline(fx);
    fx.put("public/brand/symbol-mark.png", png(99));
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
    expect(r.out).toContain("symbol-mark.png");
  });

  it("브랜드 자산 디렉터리가 양쪽 다 없으면 (b) 는 통과 처리", async ({ fx }) => {
    seedMockups(fx);
    writeBaseline(fx);
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(0);
  });

  it("알 수 없는 플래그 → exit 2", async ({ fx }) => {
    seedMockups(fx);
    const r = await fx.run(SCRIPT, "--bogus");
    expect(r.status).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe.concurrent("check-temp-values.sh", { timeout: GATE_TIMEOUT_MS }, () => {
  const SCRIPT = "check-temp-values.sh";

  it("마커 없음 → exit 0", async ({ fx }) => {
    fx.put("lib/a.ts", "export const a = 1;\n");
    const r = await fx.run(SCRIPT);
    expect(r.out).toContain("임시값 마커 없음");
    expect(r.status).toBe(0);
  });

  it("허용 목록에 없는 마커 1건 → exit 1 + 파일:줄 출력", async ({ fx }) => {
    fx.put("lib/a.ts", `export const years = 20; // ${TEMP_MARKER} 사장님 미수령\n`);
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
    expect(r.out).toContain("lib/a.ts:1:");
  });

  it("허용 목록에 있는 마커 1건 → exit 0, '허용된 임시값 1건' 으로 따로 센다", async ({ fx }) => {
    fx.put("i18n/messages.ts", `/**\n * shallow 병합이다. ${TEMP_MARKER}\n */\nexport const m = 1;\n`);
    fx.put(ALLOWLIST, ["# 사유: en.json 이 빌 때까지 shallow 병합으로 충분하다", "i18n/messages.ts:shallow 병합", ""].join("\n"));
    const r = await fx.run(SCRIPT);
    expect(r.out).toContain("허용된 임시값 1건");
    expect(r.status).toBe(0);
  });

  it("허용 목록 항목은 파일까지 일치해야 한다 — 다른 파일의 같은 패턴은 불허 → exit 1", async ({ fx }) => {
    fx.put("lib/other.ts", `// shallow 병합 ${TEMP_MARKER}\n`);
    fx.put(ALLOWLIST, "i18n/messages.ts:shallow 병합\n");
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
    expect(r.out).toContain("lib/other.ts:1:");
  });

  it("허용 1건 + 불허 1건이 섞이면 exit 1 이고 둘 다 따로 보고한다", async ({ fx }) => {
    fx.put("i18n/messages.ts", `// shallow 병합 ${TEMP_MARKER}\n`);
    fx.put("lib/b.ts", `// ${TEMP_MARKER} 누적 건수 미수령\n`);
    fx.put(ALLOWLIST, "i18n/messages.ts:shallow 병합\n");
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
    expect(r.out).toContain("허용된 임시값 1건");
    expect(r.out).toContain("lib/b.ts:1:");
  });

  it("docs/, .superpowers/, CLAUDE.md 안의 마커는 무시된다 → exit 0", async ({ fx }) => {
    fx.put("docs/plan.md", `규약: 확인되지 않은 값에는 ${TEMP_MARKER} 를 붙인다\n`);
    // .superpowers/ 는 규약·브리프가 사는 곳이라 마커 문자열이 들어 있어도 무시돼야 한다
    fx.put(".superpowers/sdd/any-plan/brief.md", `${TEMP_MARKER} 는 마커다\n`);
    fx.put("CLAUDE.md", `${TEMP_MARKER} 마커 전수 조회\n`);
    fx.put("lib/clean.ts", "export const ok = true;\n");
    const r = await fx.run(SCRIPT);
    expect(r.out).toContain("임시값 마커 없음");
    expect(r.status).toBe(0);
  });

  it.for([TODO_MARKER, PLACEHOLDER_MARKER])("다른 마커 형식도 검출 — %s → exit 1", async (marker, { fx }) => {
    fx.put("app/page.tsx", `const n = 0; // ${marker}\n`);
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(1);
  });

  it("허용 목록 형식 오류(콜론 없음) → exit 2", async ({ fx }) => {
    fx.put("lib/a.ts", `// ${TEMP_MARKER}\n`);
    fx.put(ALLOWLIST, "i18n/messages.ts\n");
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(2);
  });

  it("검사 대상 경로가 하나도 없으면 exit 0", async ({ fx }) => {
    fx.put("README.md", `${TEMP_MARKER}\n`);
    const r = await fx.run(SCRIPT);
    expect(r.status).toBe(0);
  });
});
