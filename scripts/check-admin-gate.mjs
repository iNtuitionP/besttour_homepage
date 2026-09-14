#!/usr/bin/env node
/**
 * scripts/check-admin-gate.mjs
 *
 * 관리자 인가 게이트 — **구문 트리(AST)** 검사 (플랜 v4 P5-4 · P5-3 독립 리뷰 §재-2 · P5-4 독립 리뷰 §재공격).
 *
 * 왜 정규식을 버렸나
 * ---------------------------------------------------------------------------
 * 이 게이트의 1·2세대는 정규식이었고, 독립 리뷰가 두 번의 공격으로 다음을 통과시켰다:
 *   · `"use server"; // 주석` — 줄 끝에 주석 하나를 붙이면 지시어 판정이 통째로 꺼졌다(F3)
 *   · `function f(requireAdmin = async () => {}) { await requireAdmin(); … }` — 첫 문장은 글자 그대로 게이트인데
 *     그 이름이 **매개변수**였다(M5)
 *   · 네 디렉터리 밖에 가짜 `requireAdmin` 모듈을 두고 그것을 import (M6)
 *   · 반대로 `const s: AdminSession = await requireAdmin();` 같은 **정상 코드가 반려**됐다(M8)
 * 정규식은 자바스크립트를 이해하지 못한다. 패치할 때마다 새 헛경보가 붙었고, 헛경보를 내는 게이트는 꺼진다.
 * 그래서 규칙을 **문자열의 모양이 아니라 구조적 사실**로 다시 썼다. 주석과 공백은 트리에 없으므로 F3·N7·N8 은
 * 존재 자체가 사라지고, 이름의 출처는 텍스트가 아니라 **바인딩 해석**으로 답한다(M5·M6·별칭).
 *
 * 규칙
 * ---------------------------------------------------------------------------
 * 1. **대상은 폴더가 아니라 지시어다**(리뷰 F4). 저장소 전체에서 statement 목록이 `use server` 지시어로 시작하는
 *    파일을 전부 찾는다. 그런 파일의 export 는 예외 없이 공개 POST 엔드포인트다. 각 파일은 둘 중 하나여야 한다:
 *      · 아래 PUBLIC_ACTIONS 에 **사유와 함께** 올라 있는 인증 전 공개 접수 액션
 *      · 또는 모든 export 가 **본문 첫 문장에서** 게이트를 통과하는 파일
 * 2. **게이트는 첫 문장이다.** `await requireAdmin();` 또는 그 await 를 그대로 받는 변수 선언
 *    (`const s: AdminSession = await requireAdmin();` 도 같은 문장이다 — 타입 표기는 구조를 바꾸지 않는다).
 *    조건문·try·앞선 return 은 전부 "첫 문장이 아니다" 로 걸린다.
 * 3. **이름은 해석한다.** 호출 대상 식별자는 정본 모듈(lib/auth/requireAdmin.ts)에서 **`requireAdmin` 이라는 이름으로**
 *    들어온 import 바인딩이어야 한다. 매개변수·지역 선언에 가려졌거나(M5), 다른 경로의 모듈이거나(M6),
 *    `resolveAdminSession as requireAdmin` 처럼 다른 것을 그 이름으로 바꾼 것이면 게이트가 아니다
 *    (resolveAdminSession 은 redirect 하지 않고 null 을 돌려준다 — 게이트가 통째로 no-op 이 된다).
 * 4. **화면·라우트.** app/admin 아래의 page·layout·default·template 은 기본 export 가, route 는 HTTP 메서드 export
 *    **각각이** 첫 문장 게이트를 가져야 한다(Route Handler 는 레이아웃을 타지 않는다). 공개여야 하는 것은
 *    PUBLIC_ROUTES 둘뿐이고, 그 둘을 감싸는 바깥 레이아웃은 반대로 게이트를 **걸면 안 된다**(로그인 무한 리다이렉트).
 * 5. **인라인 서버액션 금지.** 함수 본문 안의 `use server` 지시어는 컴포넌트 속에 엔드포인트를 숨긴다.
 *    엔드포인트는 모듈 단위로 **열거 가능**해야 한다.
 * 6. 삭제된 개발용 우회 심볼 5종 금지 · 관리자 경로 코드의 NODE_ENV/process.env 분기 0.
 *
 * 검사하지 않는 것: 서비스 롤(scripts/check-admin-no-service-role.sh 가 본다 — 둘은 다른 층이다).
 * "미리보기" 기능 자체는 막지 않는다(P5-4 팝업 미리보기는 정당하다).
 *
 * 종료코드: 0 통과 · 1 위반(파일:줄 출력) · 2 실행 오류(정본 모듈 부재·목록 변조 등)
 * 로컬 실행: node scripts/check-admin-gate.mjs   (= npm run check:admin-gate)
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const TAG = "check-admin-gate";
const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(process.env.CLAUDE_PROJECT_DIR ?? path.join(path.dirname(SELF), ".."));

/**
 * 게이트의 정본. 이 **파일**에서 온 `requireAdmin` 만 게이트로 인정한다 —
 * 지정자 문자열(`@/lib/auth/requireAdmin`·상대 경로)이 아니라 해석된 파일 경로로 비교하므로
 * 같은 이름의 다른 모듈(리뷰 M6)은 통과하지 못하고, 상대 경로로 같은 파일을 가리키면 통과한다.
 */
const CANONICAL_RELATIVE = "lib/auth/requireAdmin.ts";
const GATE_NAME = "requireAdmin";

/**
 * 인증 **이전** 이라 게이트를 걸 수 없는 `use server` 파일. 여기 한 줄을 더하는 것이 게이트를 우회하는
 * 가장 싼 방법이므로, tests/admin-gate.test.ts 가 이 객체를 import 해서 **해석된 목록 그대로** 단언한다.
 */
const PUBLIC_ACTION_REASONS = Object.freeze({
  "actions/reservation.ts":
    "공개 접수 폼 — 방문자가 로그인 없이 부른다. zod + Upstash RateLimit + Turnstile + 허니팟이 이 액션의 방어선이다(CLAUDE.md §3)",
  "actions/reservation-check.ts":
    "공개 예약 확인 — 접수번호+전화번호로 본인 건만 조회한다. 같은 4종 가드가 붙어 있고 부재/불일치를 구분하지 않는다",
  "actions/admin/auth.ts":
    "관리자 로그인 링크 요청 — 인증 전이므로 requireAdmin 을 부를 수 없다. 허용 목록·레이트리밋·허니팟·중립 응답이 지킨다",
});

/** 세션 없이 열려야 하는 관리자 화면·라우트. 역시 사유가 붙고 테스트가 목록을 그대로 단언한다. */
const PUBLIC_ROUTE_REASONS = Object.freeze({
  "app/admin/login/page.tsx": "로그인 화면 — 세션이 없는 사람이 보는 유일한 관리자 화면이다",
  "app/admin/auth/callback/route.ts": "매직링크 세션 교환 — 세션을 만드는 자리라 세션을 요구할 수 없다",
});

export const PUBLIC_ACTIONS = Object.freeze(Object.keys(PUBLIC_ACTION_REASONS));
export const PUBLIC_ROUTES = Object.freeze(Object.keys(PUBLIC_ROUTE_REASONS));
export { PUBLIC_ACTION_REASONS, PUBLIC_ROUTE_REASONS };

/** P5-3 에서 삭제된 개발용 우회 심볼. 이름을 조립해 이 파일 자신이 검사에 걸리지 않게 한다. */
const BYPASS_SYMBOLS = ["preview" + "Admin", "ADMIN" + "_PREVIEW", "adminPreview" + "Allowed", "isAdmin" + "Preview", "PREVIEW" + "_ADMIN_ROWS"];

/** 관리자 경로(여기에 NODE_ENV 분기가 있으면 개발 전용 우회가 시작된다). */
const ADMIN_DIRS = ["app/admin", "actions/admin", "lib/admin", "components/admin"];

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".vercel", "coverage", "dist", "build", "out", ".turbo"]);

const ROUTE_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const ROUTE_CONFIG_EXPORTS = new Set([
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
  "metadata",
  "viewport",
  "experimental_ppr",
  "generateMetadata",
  "generateViewport",
]);
/** 렌더 전에 서버에서 도는 export — 기본 export 와 같은 잣대로 게이트를 요구한다. */
const GATED_HELPERS = new Set(["generateMetadata", "generateViewport"]);

// =============================================================================
// 유틸
// =============================================================================
const violations = [];

function add(rel, node, sourceFile, message) {
  let line = 1;
  if (node && sourceFile) {
    line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  }
  violations.push(`${rel}:${line}  ${message}`);
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function walkFiles(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFiles(abs, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!SCAN_EXTENSIONS.has(ext)) continue;
      if (entry.name.endsWith(".d.ts")) continue;
      out.push(abs);
    }
  }
  return out;
}

function parse(abs, text) {
  return ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, /* .tsx 를 포함해 JSX 로 읽는다 */ ts.ScriptKind.TSX);
}

function modifiersOf(node) {
  return ts.canHaveModifiers?.(node) ? (ts.getModifiers(node) ?? []) : (node.modifiers ?? []);
}

const hasModifier = (node, kind) => modifiersOf(node).some((m) => m.kind === kind);
const isExported = (node) => hasModifier(node, ts.SyntaxKind.ExportKeyword);
const isAsync = (node) => hasModifier(node, ts.SyntaxKind.AsyncKeyword);

/**
 * statement 목록 맨 앞의 **지시어 서곡**에 `use server` 가 있는가.
 * 주석·공백·줄 끝 주석은 트리에 없으므로 여기서 문제가 되지 않는다(리뷰 F3).
 */
function hasUseServerDirective(statements) {
  for (const st of statements) {
    if (!ts.isExpressionStatement(st)) break;
    const expr = st.expression;
    if (!ts.isStringLiteral(expr) && !ts.isNoSubstitutionTemplateLiteral(expr)) break;
    if (expr.text === "use server") return true;
  }
  return false;
}

/** 모듈 지정자 → 실제 파일 경로(없으면 null). tsconfig 의 `@/*` → 루트, 상대 경로, 확장자·index 보정. */
function resolveSpecifier(spec, fromAbs) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = path.resolve(path.dirname(fromAbs), spec);
  else return null;
  for (const candidate of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"]) {
    const p = base + candidate;
    try {
      if (existsSync(p) && statSync(p).isFile()) return path.resolve(p);
    } catch {
      // 접근 불가는 미해석으로 본다
    }
  }
  return null;
}

// =============================================================================
// 게이트 해석 — 이름이 아니라 바인딩을 본다
// =============================================================================
/**
 * 파일이 정본 모듈에서 가져온 게이트의 **지역 이름** 집합.
 * `import { requireAdmin } …` → {"requireAdmin"} · `import { requireAdmin as gate } …` → {"gate"}
 * `import { resolveAdminSession as requireAdmin } …` → {} (가져온 것이 게이트가 아니다 — 이름만 같다)
 */
function gateBindings(sourceFile, abs, canonicalAbs) {
  const names = new Set();
  for (const st of sourceFile.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    if (!ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (st.importClause.isTypeOnly) continue;
    const resolved = resolveSpecifier(st.moduleSpecifier.text, abs);
    if (resolved === null || resolved !== canonicalAbs) continue;
    const bindings = st.importClause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      if (el.isTypeOnly) continue;
      const imported = (el.propertyName ?? el.name).text;
      if (imported === GATE_NAME) names.add(el.name.text);
    }
  }
  return names;
}

/** fn 바깥(자기 매개변수 포함)에서 이름을 가리는 바인딩이 있는가 — 매개변수 그림자(M5)를 잡는다. */
function isShadowed(name, fn, sourceFile) {
  let node = fn;
  while (node && node !== sourceFile) {
    if (ts.isFunctionLike(node)) {
      for (const p of node.parameters ?? []) {
        if (ts.isIdentifier(p.name) && p.name.text === name) return true;
        if (!ts.isIdentifier(p.name) && bindsName(p.name, name)) return true;
      }
      if (node !== fn && node.name && ts.isIdentifier(node.name) && node.name.text === name) return true;
    }
    if (ts.isBlock(node) || ts.isSourceFile(node)) {
      for (const st of node.statements) {
        if (node === fn.body && st === node.statements[0]) continue; // 첫 문장 자체(= 게이트)는 그림자가 아니다
        if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.name.text === name) return true;
            if (!ts.isIdentifier(d.name) && bindsName(d.name, name)) return true;
          }
        }
        if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name?.text === name) return true;
      }
    }
    if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)) {
      if (node.variableDeclaration.name.text === name) return true;
    }
    node = node.parent;
  }
  return false;
}

/** 구조분해 패턴이 이름을 묶는가. */
function bindsName(pattern, name) {
  let found = false;
  const visit = (n) => {
    if (ts.isIdentifier(n) && n.text === name) found = true;
    else ts.forEachChild(n, visit);
  };
  visit(pattern);
  return found;
}

/** 함수 본문의 첫 문장에서 꺼낸 `await <식별자>()` 의 식별자. 아니면 null. */
function awaitedCalleeOfFirstStatement(fn) {
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return { kind: "no-block" };
  const first = body.statements[0];
  if (!first) return { kind: "empty" };

  const fromAwait = (expr) => {
    if (!expr || !ts.isAwaitExpression(expr)) return null;
    const call = expr.expression;
    if (!ts.isCallExpression(call)) return null;
    return ts.isIdentifier(call.expression) ? call.expression : null;
  };

  if (ts.isExpressionStatement(first)) {
    const id = fromAwait(first.expression);
    return id ? { kind: "await", id } : { kind: "other", node: first };
  }
  // `const s: AdminSession = await requireAdmin();` — 타입 표기는 구조를 바꾸지 않는다(리뷰 M8·N6)
  if (ts.isVariableStatement(first) && first.declarationList.declarations.length === 1) {
    const id = fromAwait(first.declarationList.declarations[0].initializer);
    return id ? { kind: "await", id } : { kind: "other", node: first };
  }
  return { kind: "other", node: first };
}

/**
 * 이 함수가 첫 문장에서 게이트를 통과하는가. 통과하지 못하면 이유를 붙여 위반으로 기록한다.
 * label 은 사람이 읽을 이름(export 이름 등).
 */
function requireGate(fn, label, ctx) {
  const { rel, sourceFile, bindings } = ctx;
  const target = fn.node ?? fn;
  if (!isAsync(target)) {
    add(rel, target, sourceFile, `${label} — async 함수가 아니다. 게이트를 await 할 수 없다`);
    return;
  }
  const result = awaitedCalleeOfFirstStatement(target);
  if (result.kind === "no-block") {
    add(rel, target, sourceFile, `${label} — 본문이 블록이 아니다(식 본문 화살표). 첫 문장 게이트를 확인할 수 없다`);
    return;
  }
  if (result.kind !== "await") {
    add(rel, result.node ?? target, sourceFile, `${label} — 본문 첫 문장이 \`await ${GATE_NAME}();\` 이 아니다`);
    return;
  }
  const name = result.id.text;
  if (isShadowed(name, target, sourceFile)) {
    add(rel, result.id, sourceFile, `${label} — ${name} 이 매개변수·지역 선언에 가려져 있다. 게이트가 아니라 그 지역 값이 호출된다`);
    return;
  }
  if (!bindings.has(name)) {
    add(
      rel,
      result.id,
      sourceFile,
      `${label} — ${name} 은 ${CANONICAL_RELATIVE} 에서 \`${GATE_NAME}\` 으로 가져온 바인딩이 아니다(별칭·다른 모듈·지역 정의)`,
    );
  }
}

// =============================================================================
// 파일 단위 검사
// =============================================================================
/** 지역 이름 → 선언(함수 선언 또는 화살표/함수식 변수). export {x} · export default x 를 따라가기 위한 표. */
function localFunctions(sourceFile) {
  const table = new Map();
  for (const st of sourceFile.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) table.set(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        if (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) table.set(d.name.text, d.initializer);
      }
    }
  }
  return table;
}

/** `use server` 파일: 모든 export 가 게이트를 통과하는 async 함수여야 한다. */
function checkServerActionFile(ctx) {
  const { rel, sourceFile } = ctx;
  const locals = localFunctions(sourceFile);
  let exportCount = 0;

  for (const st of sourceFile.statements) {
    // export { a, b } · export { a } from "./x" · export * from "./x"
    if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly) continue;
      if (st.moduleSpecifier) {
        add(rel, st, sourceFile, "use server 파일의 재수출(export … from)은 게이트를 확인할 수 없다 — 이 파일 안에서 정의하고 게이트를 걸어라");
        continue;
      }
      if (!st.exportClause || !ts.isNamedExports(st.exportClause)) {
        add(rel, st, sourceFile, "use server 파일에서 확인할 수 없는 export 형태다");
        continue;
      }
      for (const el of st.exportClause.elements) {
        if (el.isTypeOnly) continue;
        exportCount += 1;
        const localName = (el.propertyName ?? el.name).text;
        const fn = locals.get(localName);
        if (!fn) {
          add(rel, el, sourceFile, `${el.name.text} — export 된 것이 이 파일에서 정의한 async 함수가 아니다`);
          continue;
        }
        requireGate(fn, el.name.text, ctx);
      }
      continue;
    }

    // export default <식별자>
    if (ts.isExportAssignment(st)) {
      exportCount += 1;
      if (ts.isIdentifier(st.expression) && locals.has(st.expression.text)) {
        requireGate(locals.get(st.expression.text), "default", ctx);
      } else {
        add(rel, st, sourceFile, "default export 가 이 파일에서 정의한 async 함수가 아니다");
      }
      continue;
    }

    if (!isExported(st)) continue;
    if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) continue; // 런타임에 사라진다

    if (ts.isFunctionDeclaration(st)) {
      exportCount += 1;
      requireGate(st, st.name?.text ?? "default", ctx);
      continue;
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        exportCount += 1;
        const label = ts.isIdentifier(d.name) ? d.name.text : "export";
        if (d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          requireGate(d.initializer, label, ctx);
        } else {
          add(rel, d, sourceFile, `${label} — use server 파일의 export 는 async 함수뿐이다`);
        }
      }
      continue;
    }
    exportCount += 1;
    add(rel, st, sourceFile, "use server 파일의 export 는 async 함수뿐이다");
  }

  if (exportCount === 0) {
    add(rel, sourceFile.statements[0], sourceFile, "use server 파일인데 export 가 없다 — 지시어가 잘못 붙었거나 파일이 비었다");
  }
}

/** app/admin 아래 화면·라우트. */
function checkScreenFile(ctx, kind, exempt) {
  const { rel, sourceFile } = ctx;
  const locals = localFunctions(sourceFile);
  let sawDefault = false;
  let methodCount = 0;

  for (const st of sourceFile.statements) {
    if (ts.isExportDeclaration(st) || ts.isExportAssignment(st)) {
      if (ts.isExportAssignment(st)) {
        sawDefault = true;
        if (kind !== "screen") {
          add(rel, st, sourceFile, "라우트 파일에 기본 export 가 있을 수 없다");
        } else if (!exempt) {
          if (ts.isIdentifier(st.expression) && locals.has(st.expression.text)) requireGate(locals.get(st.expression.text), "default", ctx);
          else add(rel, st, sourceFile, "기본 export 가 이 파일에서 정의한 async 함수가 아니다 — 게이트를 확인할 수 없다");
        }
      }
      continue;
    }
    if (!isExported(st)) continue;
    if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) continue;

    const decls = ts.isFunctionDeclaration(st)
      ? [{ name: st.name?.text, fn: st, node: st }]
      : ts.isVariableStatement(st)
        ? st.declarationList.declarations.map((d) => ({
            name: ts.isIdentifier(d.name) ? d.name.text : undefined,
            fn: d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) ? d.initializer : null,
            node: d,
          }))
        : [{ name: undefined, fn: null, node: st }];

    for (const { name, fn, node } of decls) {
      const isDefault = ts.isFunctionDeclaration(st) && hasModifier(st, ts.SyntaxKind.DefaultKeyword);

      if (name === "generateStaticParams") {
        add(rel, node, sourceFile, "generateStaticParams 는 관리자 경로에 있을 수 없다 — 프리렌더된 HTML 은 게이트를 한 번도 거치지 않는다");
        continue;
      }

      if (kind === "route") {
        if (name && ROUTE_METHODS.has(name)) {
          methodCount += 1;
          if (!fn) {
            add(rel, node, sourceFile, `${name} — HTTP 메서드가 async 함수가 아니다`);
            continue;
          }
          if (!exempt) requireGate(fn, name, ctx);
          continue;
        }
        if (name && ROUTE_CONFIG_EXPORTS.has(name)) {
          if (fn && GATED_HELPERS.has(name) && !exempt) requireGate(fn, name, ctx);
          continue;
        }
        add(rel, node, sourceFile, `라우트 파일의 export 는 HTTP 메서드 또는 세그먼트 설정뿐이다${name ? `: ${name}` : ""}`);
        continue;
      }

      // 화면(page·layout·default·template)
      if (isDefault) {
        sawDefault = true;
        if (exempt) continue;
        if (!fn && !ts.isFunctionDeclaration(st)) {
          add(rel, node, sourceFile, "기본 export 가 async 함수가 아니다 — 게이트를 확인할 수 없다");
          continue;
        }
        requireGate(fn ?? st, "default", ctx);
        continue;
      }
      if (name && GATED_HELPERS.has(name)) {
        if (fn ?? ts.isFunctionDeclaration(st)) requireGate(fn ?? st, name, ctx);
        continue;
      }
      // 그 밖의 export(세그먼트 설정·헬퍼)는 엔드포인트가 아니다
    }
  }

  if (kind === "screen" && !sawDefault) add(rel, sourceFile.statements[0] ?? null, sourceFile, "기본 export 를 찾지 못했다 — 화면 파일은 기본 export 가 있어야 한다");
  if (kind === "route" && methodCount === 0) add(rel, sourceFile.statements[0] ?? null, sourceFile, "HTTP 메서드 export 를 찾지 못했다");
}

/** 공개 라우트를 감싸는 레이아웃은 게이트를 걸면 안 된다(로그인이 자기 자신으로 무한 리다이렉트한다). */
function checkShellFile(ctx) {
  const { rel, sourceFile, bindings } = ctx;
  if (bindings.size === 0) return;
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && bindings.has(node.expression.text)) {
      add(rel, node, sourceFile, "공개 라우트(로그인·콜백)를 감싸는 레이아웃이 게이트를 건다 — 로그인 화면이 자기 자신으로 리다이렉트한다");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/** 함수 본문 안에 숨은 `use server` — 컴포넌트 속의 엔드포인트. */
function checkInlineDirectives(ctx) {
  const { rel, sourceFile } = ctx;
  const visit = (node) => {
    if (ts.isFunctionLike(node) && node.body && ts.isBlock(node.body) && hasUseServerDirective(node.body.statements)) {
      add(rel, node.body.statements[0], sourceFile, "함수 안의 use server 지시어 — 엔드포인트는 모듈 단위로 열거 가능해야 한다(인라인 서버액션 금지)");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/** 관리자 경로 코드의 환경변수 분기 — 주석은 트리에 없으므로 자연히 제외된다. */
function checkEnvBranches(ctx) {
  const { rel, sourceFile } = ctx;
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const text = node.getText(sourceFile);
      if (/\bprocess\s*\.\s*env\b/.test(text) || /\bNODE_ENV\b/.test(text)) {
        add(rel, node, sourceFile, "관리자 경로에 환경변수 분기가 있다 (NODE_ENV/process.env) — 개발 전용 우회가 여기서 시작된다");
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

// =============================================================================
// 실행
// =============================================================================
function fatal(message) {
  console.log(`${TAG}: ${message}`);
  process.exit(2);
}

function main() {
  // 목록 변조 tripwire — 배열은 const + Object.freeze 지만, 파일을 고치는 쪽을 막는 것이 목적이다.
  const selfSource = readFileSync(SELF, "utf8");
  if (/(PUBLIC_ACTIONS|PUBLIC_ROUTES)\s*(\+=|\[[^\]]*\]\s*=|\.push|\.unshift|\.splice)/.test(selfSource)) {
    fatal("예외 목록을 나중에 덧붙였다 — 목록은 한 곳에서 한 번만 정의한다.");
  }
  for (const name of ["PUBLIC_ACTION_REASONS", "PUBLIC_ROUTE_REASONS"]) {
    const assigns = selfSource.match(new RegExp(`^const ${name} = `, "gm")) ?? [];
    if (assigns.length !== 1) fatal(`${name} 대입이 1개가 아니다 (${assigns.length}개) — 목록은 한 곳에서 한 번만 정의한다.`);
  }

  const canonicalAbs = path.join(ROOT, ...CANONICAL_RELATIVE.split("/"));
  const targets = walkFiles(ROOT, []);
  const hasAdminArea = ADMIN_DIRS.some((d) => existsSync(path.join(ROOT, ...d.split("/"))));

  if (!existsSync(canonicalAbs)) {
    if (!hasAdminArea && targets.every((abs) => !readFileSync(abs, "utf8").includes("use server"))) {
      console.log(`${TAG}: 검사 대상 없음 (관리자 경로도, use server 파일도 없다). 통과 처리.`);
      process.exit(0);
    }
    fatal(`정본 게이트 모듈이 없다: ${CANONICAL_RELATIVE}`);
  }

  console.log(`${TAG}: 저장소 전체에서 use server 파일을 찾는다 (루트 ${toPosix(path.relative(process.cwd(), ROOT) || ".")}) + 관리자 경로 = ${ADMIN_DIRS.join(" ")}`);
  console.log(`${TAG}: 예외(인증 전) = ${[...PUBLIC_ACTIONS, ...PUBLIC_ROUTES].join(" ")}`);

  // 예외가 가리키는 파일이 사라졌다면 목록이 현실과 갈라진 것이다.
  for (const rel of [...PUBLIC_ACTIONS, ...PUBLIC_ROUTES]) {
    if (!existsSync(path.join(ROOT, ...rel.split("/")))) {
      violations.push(`${rel}:1  예외 목록의 파일이 없다 — 목록이 낡았거나 파일이 옮겨졌다`);
    }
  }

  for (const abs of targets) {
    const rel = toPosix(path.relative(ROOT, abs));
    const text = readFileSync(abs, "utf8");
    const inAdminDir = ADMIN_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`));
    const maybeServerAction = text.includes("use server");
    const stem = path.basename(rel, path.extname(rel));
    const isScreenFile = rel.startsWith("app/admin/") && ["page", "layout", "default", "template", "route"].includes(stem);

    if (!maybeServerAction && !inAdminDir && !isScreenFile) continue;

    const sourceFile = parse(abs, text);
    const bindings = gateBindings(sourceFile, abs, canonicalAbs);
    const ctx = { rel, sourceFile, bindings };

    checkInlineDirectives(ctx);
    if (inAdminDir) {
      checkEnvBranches(ctx);
      for (const symbol of BYPASS_SYMBOLS) {
        if (text.includes(symbol)) violations.push(`${rel}:1  삭제된 개발용 우회 심볼이 되살아났다: ${symbol}`);
      }
    }

    if (hasUseServerDirective(sourceFile.statements)) {
      if (!PUBLIC_ACTIONS.includes(rel)) checkServerActionFile(ctx);
    }

    if (isScreenFile) {
      const exempt = PUBLIC_ROUTES.includes(rel);
      const dir = path.posix.dirname(rel);
      const wrapsPublic = ["layout", "template", "default"].includes(stem) && PUBLIC_ROUTES.some((pub) => pub.startsWith(`${dir}/`));
      if (wrapsPublic) checkShellFile(ctx);
      else checkScreenFile(ctx, stem === "route" ? "route" : "screen", exempt);
    }
  }

  if (violations.length > 0) {
    for (const v of violations) console.log(`${TAG}: ${v}`);
    console.log(`${TAG}: 위반 ${violations.length}건 — 관리자 인가가 구조적으로 보장되지 않는다.`);
    console.log(`${TAG}: 규칙: export 된 async 함수의 **첫 문장**이 정본 ${GATE_NAME}() 의 await 여야 한다(조건·try·앞선 return·이름 가리기 금지).`);
    process.exit(1);
  }

  console.log(`${TAG}: OK — use server 파일과 관리자 화면·라우트가 전부 첫 문장에서 게이트를 통과한다.`);
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) main();
