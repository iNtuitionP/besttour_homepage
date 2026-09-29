/**
 * P5-23 라운드 2 (컨트롤러 A-1 · A-2) — 발송 기록 화면의 표시 판정.
 *
 * A-1 '마지막 오류' 칸: 발송기가 적는 **코드 원문**(provider_timeout · provider_503:http_503 · unsupported_recipient …)이 한국어 화면에 그대로
 *     나왔다(라운드 1 자동 점검 🔴 15화면). 이제 코드를 짧은 한국어 라벨로 바꾸고, 원문은 `title`(툴팁)에만 둔다. 모르는 코드는 "기타 오류".
 *     라벨 목록을 손으로 적어 빠뜨리지 않게 — **lib/notify/** 소스와 마이그레이션에서 발송기가 적을 수 있는 코드를 뽑아** 전부 라벨이 있는지 본다.
 * A-2 '대기' 배지: 방금 들어온 것 · 발송기가 집어 간 것 · 다시 보낼 차례를 기다리는 것 · 오래 멈춘 것이 모두 같은 '대기' 였다.
 *     배지는 두고 작은 둘째 줄로 나눈다 — 보내는 중 / 다시 보낼 예정 {시각} / 오래 멈춤 — 확인 필요.
 *     (격리 행은 '대기' 배지가 아니라 자기 배지 '발송됨 · 기록 확인 필요' 를 단다 — P4-7. 같은 말을 둘째 줄로 되풀이하지 않는다.)
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })) }));
vi.mock("@/lib/supabase/ssr", () => ({ createSsrClient: vi.fn() }));
vi.mock("@/lib/auth/requireAdmin", () => ({ requireAdmin: vi.fn(async () => ({ userId: "test", email: "e" })) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/admin/notifications", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/admin/notifications")>();
  return { ...mod, getNotificationSummary: vi.fn(), listNotifications: vi.fn() };
});
vi.mock("next-intl/server", async () => {
  const { createTranslator: ct } = await import("next-intl");
  const { readFileSync: rf } = await import("node:fs");
  const p = await import("node:path");
  const messages = JSON.parse(rf(p.resolve(import.meta.dirname, "..", "messages", "ko.json"), "utf8"));
  return {
    getTranslations: vi.fn(async (opts?: { namespace?: string } | string) => {
      const namespace = typeof opts === "string" ? opts : opts?.namespace;
      return ct({ locale: "ko", messages, namespace: namespace as never });
    }),
  };
});

import AdminNotificationsPage from "@/app/admin/(protected)/notifications/page";
import { formatAdminDate, type AdminDateLabels } from "@/components/admin/admin-date";
import {
  NOTIFY_ERROR_KEYS,
  PENDING_STALL_HOURS,
  notifyErrorKey,
  pendingSubState,
  type NotifyErrorKey,
} from "@/lib/admin/notificationDisplay";
import { getNotificationSummary, listNotifications, type NotificationListRow } from "@/lib/admin/notifications";
import {
  CLAIM_LEASE_MS,
  DUPLICATE_SENT_ERROR,
  MAX_ATTEMPTS,
  QUARANTINE_RETRY_AFTER_MS,
  SENT_UNMARKED_PREFIX,
  nextAttemptDecision,
  notificationRecordState,
} from "@/lib/notify/outbox";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf-8");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const HANGUL = /[가-힣]/;
const LATIN = /[A-Za-z]/;

const ko = JSON.parse(read("messages/ko.json")) as { admin: { notifications: Record<string, unknown> } };
const n = ko.admin.notifications as Record<string, Record<string, string>>;

// =============================================================================
// 발송기가 적을 수 있는 코드 — 소스에서 뽑는다(손으로 적은 목록 없음)
// =============================================================================
type Produced = { file: string; code: string; kind: "exact" | "prefix" | "http" };

/**
 * lib/notify/*.ts 와 supabase/migrations/*.sql 에서 last_error 로 가는 값을 뽑는다.
 *   - 제공자 어댑터의 결과 `fail(code, …)` — 그 파일에 `const fail = (code: string` 이 있을 때만(outbox.ts 의 `fail(op, error)` 는 던지는 함수라 코드가 아니다)
 *     · 문자열 "x" · 상수 NAME(같은 파일의 const) · 틀 `x:${…}`(접두) · 틀 `provider_${status}:${…}`(HTTP 상태 — 종류별로 풀어 본다)
 *   - 발송기 `recordFailure(row, "x" | `x:${…}`)`
 *   - 라우터 `error: `${PREFIX}${…}``
 *   - 아웃박스 상수(중복 억제 · 격리 표식) · 마이그레이션의 `last_error = 'x'`
 */
type Scan = { produced: Produced[]; unresolved: string[] };
type SourceText = { rel: string; text: string };

/**
 * 발송기가 last_error 로 보낼 수 있는 값을 **구문 트리(TypeScript 컴파일러)** 로 뽑는다(리뷰 P2-4 — 정규식 스캐너는 `const fail = (code: string`
 * 모양 · `${상수}` 로 시작하는 틀만 봐서, `function fail(` · `error: "리터럴"` · 순서가 바뀐 객체 같은 다른 어댑터 모양을 조용히 흘렸다).
 * 코드가 생기는 자리 — 전부 본다:
 *   ① `{ ok: false, error: X }` 객체(순서 무관 · 줄임 표기 포함) — 발송 결과(SendOutcome)
 *   ② `{ p_error: X }` 객체 — 실패 기록 RPC(mark_notification_failed)의 인자 · `.update/.insert/.upsert({ last_error: X })`
 *   ③ ①·② 의 X 가 **감싼 함수의 인자**면 그 함수를 부르는 모든 곳의 그 자리 인자(①은 같은 파일 안 · ②는 모든 파일 — 이름으로, 끝까지 따라간다)
 *   ④ SQL 의 `last_error = …` · `insert into notifications_log (… last_error …)`
 * X 를 푸는 법: 문자열 · 상수(모든 파일의 `const NAME = "…"`) · 틀의 머리(또는 머리 자리 상수) · `provider_${…status}:` 틀(HTTP 상태) ·
 * 조건식의 양쪽 · `.slice(…)` · `scrubError(x, …)`(수신처만 지운다) · 지역 변수의 초기값 · `<발송 결과>.error`(① 에서 이미 센다).
 * **풀지 못하면 unresolved 에 자리를 적는다 — 건너뛰지 않는다**(테스트가 unresolved = [] 를 요구한다: 새 모양은 크게 실패한다).
 */
function scanNotifyCodes(files: SourceText[], sqls: SourceText[]): Scan {
  const produced: Produced[] = [];
  const unresolved: string[] = [];
  const parsed = files.map((f) => ({ rel: f.rel, sf: ts.createSourceFile(f.rel, f.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) }));
  const walk = (node: ts.Node, fn: (n: ts.Node) => void): void => {
    fn(node);
    node.forEachChild((c) => walk(c, fn));
  };

  // 상수 — 모든 파일의 const NAME = "…"(같은 이름이 다른 값이면 풀지 않는다)
  const consts = new Map<string, string | null>();
  for (const { sf } of parsed) {
    walk(sf, (node) => {
      if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.initializer === undefined) return;
      if (!(ts.getCombinedNodeFlags(node) & ts.NodeFlags.Const)) return;
      if (!ts.isStringLiteral(node.initializer) && !ts.isNoSubstitutionTemplateLiteral(node.initializer)) return;
      const prev = consts.get(node.name.text);
      consts.set(node.name.text, prev === undefined || prev === node.initializer.text ? node.initializer.text : null);
    });
  }

  const enclosingFn = (node: ts.Node): ts.SignatureDeclaration | undefined => {
    for (let p = node.parent; p !== undefined; p = p.parent) if (ts.isFunctionLike(p)) return p;
    return undefined;
  };
  const fnName = (fn: ts.SignatureDeclaration): string | undefined => {
    if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name !== undefined && ts.isIdentifier(fn.name)) return fn.name.text;
    const p = fn.parent;
    if (p !== undefined && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (p !== undefined && ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) return p.name.text;
    return undefined;
  };

  type Res =
    | { kind: "codes"; codes: { code: string; kind: Produced["kind"] }[] }
    | { kind: "param"; fn: ts.SignatureDeclaration; index: number }
    | { kind: "outcome" }
    | { kind: "unresolved" };
  const classify = (expr: ts.Expression, depth = 0): Res => {
    if (depth > 10) return { kind: "unresolved" };
    if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr)) return classify(expr.expression, depth + 1);
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return { kind: "codes", codes: [{ code: expr.text, kind: "exact" }] };
    if (ts.isTemplateExpression(expr)) {
      const first = expr.templateSpans[0];
      if (expr.head.text === "provider_" && /status$/.test(first.expression.getText()) && first.literal.text.startsWith(":")) {
        return { kind: "codes", codes: [{ code: "provider_${status}:", kind: "http" }] };
      }
      if (expr.head.text !== "") return { kind: "codes", codes: [{ code: expr.head.text, kind: "prefix" }] };
      const lead = classify(first.expression, depth + 1);
      if (lead.kind === "codes" && lead.codes.length === 1 && lead.codes[0].kind === "exact") {
        const code = lead.codes[0].code + first.literal.text;
        return { kind: "codes", codes: [{ code, kind: expr.templateSpans.length === 1 ? "exact" : "prefix" }] };
      }
      return { kind: "unresolved" };
    }
    if (ts.isConditionalExpression(expr)) {
      const a = classify(expr.whenTrue, depth + 1);
      const b = classify(expr.whenFalse, depth + 1);
      return a.kind === "codes" && b.kind === "codes" ? { kind: "codes", codes: [...a.codes, ...b.codes] } : { kind: "unresolved" };
    }
    // 발송 결과의 error — ① 에서 이미 뽑는다(여기서는 다시 세지 않는다)
    if (ts.isPropertyAccessExpression(expr) && expr.name.text === "error") return { kind: "outcome" };
    if (ts.isCallExpression(expr)) {
      const callee = expr.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "slice") return classify(callee.expression, depth + 1);
      if (ts.isIdentifier(callee) && callee.text === "scrubError" && expr.arguments.length > 0) return classify(expr.arguments[0], depth + 1);
      return { kind: "unresolved" };
    }
    if (ts.isIdentifier(expr)) {
      const name = expr.text;
      for (let fn = enclosingFn(expr); fn !== undefined; fn = enclosingFn(fn)) {
        const index = fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === name);
        if (index >= 0) return { kind: "param", fn, index };
        let local: ts.VariableDeclaration | undefined;
        walk(fn, (n) => {
          if (local === undefined && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer !== undefined && enclosingFn(n) === fn) local = n;
        });
        if (local?.initializer !== undefined) return classify(local.initializer, depth + 1);
      }
      const value = consts.get(name);
      return typeof value === "string" ? { kind: "codes", codes: [{ code: value, kind: "exact" }] } : { kind: "unresolved" };
    }
    return { kind: "unresolved" };
  };

  /** 코드를 받는 함수 — 같은 파일 안에서만 부르는 것(① 발송 결과를 만드는 fail 류)과 어디서나 부르는 것(② 실패 기록 쪽) */
  const localFns = new Map<string, Map<string, number>>();
  const globalFns = new Map<string, number>();
  const where = (rel: string, sf: ts.SourceFile, node: ts.Node) => `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.getText().replace(/\s+/g, " ").slice(0, 90)}`;
  const take = (rel: string, sf: ts.SourceFile, expr: ts.Expression, scope: "local" | "global"): boolean => {
    const res = classify(expr);
    if (res.kind === "codes") {
      for (const c of res.codes) produced.push({ file: rel, ...c });
      return false;
    }
    if (res.kind === "outcome") return false;
    if (res.kind === "param") {
      const name = fnName(res.fn);
      if (name === undefined) {
        unresolved.push(`${where(rel, sf, expr)} (이름 없는 함수의 인자)`);
        return false;
      }
      const map = scope === "local" ? (localFns.get(rel) ?? new Map<string, number>()) : globalFns;
      if (scope === "local") localFns.set(rel, map);
      const known = map.get(name);
      if (known === res.index) return false;
      if (known !== undefined) unresolved.push(`${where(rel, sf, expr)} (같은 이름 ${name} 의 코드 자리가 둘)`);
      map.set(name, res.index);
      return true;
    }
    unresolved.push(where(rel, sf, expr));
    return false;
  };

  // ①·② 자리
  for (const { rel, sf } of parsed) {
    walk(sf, (node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const prop = (key: string): ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined =>
          node.properties.find(
            (p): p is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
              (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === key,
          );
        const ok = prop("ok");
        const error = prop("error");
        if (ok !== undefined && ts.isPropertyAssignment(ok) && ok.initializer.kind === ts.SyntaxKind.FalseKeyword && error !== undefined) {
          take(rel, sf, ts.isPropertyAssignment(error) ? error.initializer : error.name, "local");
        }
        const pError = prop("p_error");
        if (pError !== undefined) take(rel, sf, ts.isPropertyAssignment(pError) ? pError.initializer : pError.name, "global");
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["update", "insert", "upsert"].includes(node.expression.name.text)) {
        for (const arg of node.arguments) {
          const objs = ts.isArrayLiteralExpression(arg) ? arg.elements : [arg];
          for (const o of objs) {
            if (!ts.isObjectLiteralExpression(o)) continue;
            const le = o.properties.find((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "last_error");
            if (le !== undefined && ts.isPropertyAssignment(le)) take(rel, sf, le.initializer, "global");
          }
        }
      }
    });
  }
  // ③ 부르는 곳 — 새 함수가 더 나오지 않을 때까지
  for (let round = 0, grew = true; grew && round < 12; round += 1) {
    grew = false;
    for (const { rel, sf } of parsed) {
      walk(sf, (node) => {
        if (!ts.isCallExpression(node)) return;
        const callee = node.expression;
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
        if (name === undefined) return;
        const localIndex = ts.isIdentifier(callee) ? localFns.get(rel)?.get(name) : undefined;
        const globalIndex = globalFns.get(name);
        for (const [index, scope] of [
          [localIndex, "local"],
          [globalIndex, "global"],
        ] as const) {
          if (index === undefined) continue;
          const arg = node.arguments[index];
          if (arg === undefined) {
            unresolved.push(`${where(rel, sf, node)} (코드 자리 인자가 없다)`);
            continue;
          }
          if (take(rel, sf, arg, scope)) grew = true;
        }
      });
    }
  }
  // ④ SQL — 주석은 공용 제거기로 걷는다(문자열·달러 인용 속 `--` 를 주석으로 읽지 않는다 — tests/strip-comments.test.ts §6-S)
  for (const { rel, text } of sqls) {
    const code = stripComments(text, rel);
    for (const m of code.matchAll(/\blast_error\s*=\s*([^,;\n]+)/g)) {
      const v = m[1].trim().replace(/\s+where\b[\s\S]*$/i, "").trim();
      const lit = /^'([^']*)'$/.exec(v);
      if (lit !== null) produced.push({ file: rel, code: lit[1], kind: "exact" });
      else if (v !== "null" && v !== "p_error") unresolved.push(`${rel}: last_error = ${v}`); // p_error 는 RPC 인자 — TS 의 p_error 자리에서 따라간다
    }
    for (const m of code.matchAll(/insert\s+into\s+(?:public\.)?notifications_log\s*\(([^)]*)\)/gi)) {
      if (/\blast_error\b/.test(m[1])) unresolved.push(`${rel}: insert into notifications_log (… last_error …)`);
    }
  }
  return { produced, unresolved };
}

/** 저장소의 발송기 소스(lib/notify 아래 전부 · 하위 폴더 포함)와 마이그레이션. */
function repoSources(): { files: SourceText[]; sqls: SourceText[] } {
  const files: SourceText[] = [];
  const visit = (rel: string) => {
    for (const e of readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) visit(child);
      else if (e.name.endsWith(".ts")) files.push({ rel: child, text: read(child) });
    }
  };
  visit("lib/notify");
  const mig = "supabase/migrations";
  const sqls = readdirSync(path.join(ROOT, mig))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ rel: `${mig}/${f}`, text: read(`${mig}/${f}`) }));
  return { files, sqls };
}

const REPO_SCAN = (() => {
  const { files, sqls } = repoSources();
  return scanNotifyCodes(files, sqls);
})();

function producibleCodes(): Produced[] {
  return REPO_SCAN.produced;
}

/** 뽑은 코드 하나 → 실제로 적히는 모양의 표본들. */
function samplesOf(p: Produced): string[] {
  if (p.kind === "http") return [400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 503].map((s) => `provider_${s}:http_${s}`);
  if (p.kind === "prefix") return [`${p.code}x`, `${p.code}M4V2026Q`];
  return [p.code];
}

const PRODUCED = producibleCodes();

describe("1. 발송기가 적는 코드 — 소스에서 뽑기(스캐너가 살아 있다)", () => {
  test("🔴 뽑힌 것이 충분하고, 알려진 코드가 다 들어 있다 — 스캐너가 낡아 아무것도 못 뽑는 상황을 막는다", () => {
    const codes = new Set(PRODUCED.map((p) => p.code));
    expect(PRODUCED.length).toBeGreaterThanOrEqual(20);
    for (const known of [
      "alimtalk_not_enabled",
      "unsupported_recipient",
      "provider_timeout",
      "provider_network:",
      "provider_${status}:",
      "provider_rejected:",
      "provider_no_accepted",
      "provider_bad_json",
      "vars_load_failed",
      "reservation_not_found",
      "template_render_failed",
      "unsupported_channel:",
      "missing_subject",
      "unsafe_row_id",
      "unknown_template",
      "claim_invariant_violated",
      "sender_threw:",
      "no_sender_for_channel:",
      DUPLICATE_SENT_ERROR,
      SENT_UNMARKED_PREFIX,
      "lease_expired_after_max_attempts",
    ]) {
      expect(codes, known).toContain(known);
    }
    expect(PRODUCED.filter((p) => p.code === ""), "빈 코드").toEqual([]);
  });

  test("🔴 리뷰 P2-4 — 코드가 생기는 자리를 전부 풀었다(못 푼 자리 0) · 발송 결과를 만드는 어댑터가 다 잡혔다", () => {
    // 못 푼 자리가 있으면 여기서 그 자리(파일:줄 식)를 그대로 보여 주며 실패한다 — 새 모양의 코드가 조용히 '기타 오류' 로 떨어지지 않는다
    expect(REPO_SCAN.unresolved).toEqual([]);
    // 발송 결과(ok:false)를 만드는 파일 — 메일 · 문자 어댑터 · 라우터 셋 다 코드를 냈다
    const files = new Set(PRODUCED.map((p) => p.file));
    for (const f of ["lib/notify/mail.ts", "lib/notify/solapi.ts", "lib/notify/router.ts", "lib/notify/worker.ts"]) expect(files, f).toContain(f);
    // 실패 기록 경로(worker recordFailure → markFailed → p_error)와 격리 표식(note → quarantineSentUnmarked)도 따라갔다
    expect(PRODUCED.filter((p) => p.file === "lib/notify/worker.ts").map((p) => p.code)).toEqual(
      expect.arrayContaining(["claim_invariant_violated", "unknown_template", "sender_threw:", SENT_UNMARKED_PREFIX]),
    );
  });

  test("🔴 발송기가 적을 수 있는 코드는 전부 라벨이 있다 — '기타 오류' 로 떨어지는 것이 없다", () => {
    const misses: string[] = [];
    for (const p of PRODUCED) {
      for (const sample of samplesOf(p)) {
        const key = notifyErrorKey(sample);
        if (key === null || key === "other") misses.push(`${p.file}: ${sample} → ${key}`);
      }
    }
    expect(misses).toEqual([]);
  });

  test("HTTP 상태는 종류별로 — 401·403 인증 · 408 시간 초과 · 429 요청 많음 · 그 밖 4xx 거절 · 5xx 제공자 오류", () => {
    const k = (s: number) => notifyErrorKey(`provider_${s}:http_${s}`);
    expect([k(401), k(403)]).toEqual(["auth", "auth"]);
    expect(k(408)).toBe("timeout");
    expect(k(429)).toBe("tooMany");
    expect([k(400), k(404), k(409), k(422)]).toEqual(["rejectedRequest", "rejectedRequest", "rejectedRequest", "rejectedRequest"]);
    expect([k(500), k(502), k(503)]).toEqual(["providerDown", "providerDown", "providerDown"]);
    expect(notifyErrorKey("provider_503:ErrorServiceUnavailable")).toBe("providerDown");
  });

  test("모르는 코드는 '기타 오류'(other) · 오류가 없으면 null(칸은 '—')", () => {
    expect(notifyErrorKey("totally_new_code")).toBe("other");
    expect(notifyErrorKey("http_503")).toBe("other");
    expect(notifyErrorKey(null)).toBeNull();
    expect(notifyErrorKey("")).toBeNull();
    expect(notifyErrorKey("   ")).toBeNull();
  });

  test("🔴 리뷰 P2-5 — 객체 프로토타입의 이름(toString · constructor · __proto__ · hasOwnProperty)은 코드가 아니다 — '기타 오류'", () => {
    // 정확 일치 표가 일반 객체라 EXACT["toString"] 이 함수를 돌려줬다 → 화면이 t("error.function toString() …") 를 불렀다
    for (const name of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(notifyErrorKey(name), name).toBe("other");
    }
    // 돌려받는 값은 늘 키 목록 안이다
    for (const name of ["toString", "constructor", "__proto__"]) expect(NOTIFY_ERROR_KEYS).toContain(notifyErrorKey(name));
  });
});

describe("1-b. 스캐너 자체 — 다른 모양의 어댑터도 뽑고, 못 푸는 것은 크게 실패시킨다(리뷰 P2-4)", () => {
  const scan = (tsText: string, sql = "") =>
    scanNotifyCodes([{ rel: "lib/notify/fake.ts", text: tsText }], sql === "" ? [] : [{ rel: "supabase/migrations/9999_fake.sql", text: sql }]);
  const codes = (s: Scan) => s.produced.map((p) => `${p.kind}:${p.code}`);

  test("🔴 function 선언 fail · 곧바로 쓴 error 리터럴 · 순서가 바뀐 객체 · 상수 · 틀 머리 — 전부 뽑는다", () => {
    const s = scan(`
      const REASON = "const_code";
      function fail(code: string, retryable: boolean) { return { ok: false, error: code, retryable }; }
      export async function send(x: number) {
        if (x === 1) return fail("function_style_code", true);
        if (x === 2) return { ok: false, error: "direct_literal_code", retryable: false };
        if (x === 3) return { retryable: true, error: \`reversed_prefix:\${x}\`, ok: false };
        return { ok: false, error: REASON, retryable: false };
      }`);
    expect(s.unresolved).toEqual([]);
    expect(codes(s)).toEqual(expect.arrayContaining(["exact:function_style_code", "exact:direct_literal_code", "prefix:reversed_prefix:", "exact:const_code"]));
  });

  test("🔴 기록 함수(p_error)를 거쳐 가는 코드도 따라간다 — 감싼 함수의 인자 · 지역 변수의 틀 · 포트 속성", () => {
    const s = scan(`
      const PREFIX = "local_prefix:";
      export async function markFailed(row: unknown, error: string, client: any) {
        await client.rpc("mark_notification_failed", { p_id: 1, p_error: error.slice(0, 10) });
      }
      const port = { markFailed: (row: unknown, error: string) => markFailed(row, error, null) };
      async function record(row: unknown, why: string) { await port.markFailed(row, why); }
      export async function run(row: unknown) {
        await record(row, "wrapped_code");
        const note = \`\${PREFIX}\${String(row)}\`;
        await markFailed(row, note, null);
      }`);
    expect(s.unresolved).toEqual([]);
    expect(codes(s)).toEqual(expect.arrayContaining(["exact:wrapped_code", "prefix:local_prefix:"]));
  });

  test("🔴 못 푸는 코드는 조용히 넘기지 않는다 — 계산한 코드 · 알 수 없는 인자 · SQL 의 식 · SQL insert 의 last_error", () => {
    const s = scan(
      `
      function computeCode(x: number) { return "c" + x; }
      export async function markFailed(row: unknown, error: string, client: any) { await client.rpc("mark_notification_failed", { p_id: 1, p_error: error }); }
      export async function send(x: number) {
        await markFailed(null, String(x), null);
        return { ok: false, error: computeCode(x), retryable: true };
      }`,
      `update notifications_log set last_error = 'sql_code' where id = 1;
       update notifications_log set last_error = upper(p_note) where id = 2;
       insert into notifications_log (event, last_error) values ('created', 'x');`,
    );
    expect(codes(s)).toContain("exact:sql_code");
    expect(s.unresolved, JSON.stringify(s.unresolved)).toHaveLength(4);
  });
});

describe("2. 라벨 카탈로그 — admin.notifications.error 는 키와 1:1 · 사람이 읽는 한국어", () => {
  test("키 집합이 NOTIFY_ERROR_KEYS 와 같다(빠진 라벨도, 아무도 안 쓰는 라벨도 없다)", () => {
    expect(Object.keys(n.error).sort()).toEqual([...NOTIFY_ERROR_KEYS].sort());
    expect(NOTIFY_ERROR_KEYS).toContain("other");
  });

  test("라벨은 한국어이고 코드 원문(영문)을 담지 않는다 · '기타 오류'", () => {
    for (const k of NOTIFY_ERROR_KEYS) {
      const label = n.error[k];
      expect(HANGUL.test(label), `${k} → ${label}`).toBe(true);
      expect(LATIN.test(label), `${k} → ${label}`).toBe(false);
    }
    expect(n.error.other).toBe("기타 오류");
  });

  test("🔴 화면 — 보이는 글자는 라벨, 원문 코드는 title(툴팁)에만 · 원문을 칸 글자로 그리지 않는다", () => {
    const page = codeOf("app/admin/(protected)/notifications/page.tsx");
    expect(page).toMatch(/notifyErrorKey\(/);
    expect(page).toMatch(/t\(`error\.\$\{/);
    expect(page).toMatch(/title=\{row\.lastError/);
    expect(page, "원문 코드를 칸 글자로 그린다").not.toMatch(/>\s*\{row\.lastError/);
    // 옛 모양(원문이 없으면 '—', 있으면 원문을 그대로 칸에)이 돌아오지 않았다
    expect(page).not.toMatch(/\{row\.lastError \?\? t\("none"\)\}/);
    // 원문은 title 속성 안에서만 쓰인다 — 그 밖에 row.lastError 가 나오는 곳은 판정(notifyErrorKey)뿐
    const uses = [...page.matchAll(/row\.lastError/g)].map((m) => page.slice(Math.max(0, (m.index ?? 0) - 20), (m.index ?? 0) + 20));
    expect(uses.length).toBeGreaterThanOrEqual(2);
    for (const u of uses) expect(u, u).toMatch(/title=\{row\.lastError|notifyErrorKey\(row\.lastError/);
  });
});

describe("3. '대기' 둘째 줄 — pendingSubState(시간을 본다 · 리뷰 P1-1)", () => {
  /**
   * 리뷰 P1-1 — 예전 판정은 시도 수·오류 유무·만든 때만 봤다. 그래서 lease 가 55분 전에 끝난 행을 "보내는 중",
   * 54분 지난 시각을 "다시 보낼 예정 {시각}" 이라고 말했다(크론이 하루 1회라 그 거짓이 몇 시간~하루 간다).
   * 이제 발송기와 같은 규칙(nextAttemptDecision — 0014 claim 의 where 절)과 lease 로, 서버의 **한 순간(now)** 에 대어 가른다:
   *   lease 안 → 보내는 중 · lease 가 없고 다음 시도가 아직 → 다시 보낼 예정 {시각} ·
   *   보낼 때가 됨(다음 시도 ≤ now 또는 lease 끝남) 24시간 미만 → 보낼 차례 · 다음 발송 때 나가요 · 24시간 이상(하루 1회 크론을 한 번 이상 놓침) → 오래 멈춤.
   * lease 는 따로 칸이 없다 — claim 은 한 문장에서 updated_at = now() · next_attempt_at = now() + 5분을 찍는다(0014). 그 모양과 시도 수로 가른다.
   * 시각은 전부 손으로 적은 값이다(NOW = 13:00:00Z).
   */
  const NOW = new Date("2026-09-29T13:00:00.000Z");
  type In = Parameters<typeof pendingSubState>[0];
  const row = (over: Partial<In>): In => ({
    status: "pending",
    attempts: 1,
    lastError: null,
    nextAttemptAt: "2026-09-29T13:03:00.000Z",
    updatedAt: "2026-09-29T12:58:00.000Z",
    ...over,
  });
  const sub = (over: Partial<In>) => pendingSubState(row(over), NOW);

  test("대기가 아니면(발송·실패) 둘째 줄 없음", () => {
    expect(sub({ status: "sent" })).toBeNull();
    expect(sub({ status: "failed", lastError: "provider_timeout" })).toBeNull();
  });

  test("🔴 lease 안(발송기가 집어 가 보내는 중) — 보내는 중 · lease 가 끝났으면 보내는 중이 아니다(보낼 차례)", () => {
    // 집힌 뒤 실패한 적 없음(last_error 없음) · lease 12:58 → 13:03
    expect(sub({ attempts: 1, updatedAt: "2026-09-29T12:58:00.000Z", nextAttemptAt: "2026-09-29T13:03:00.000Z" })).toEqual({ kind: "sending" });
    // 리뷰 실측 ① — lease 가 55분 전에 끝남(발송기가 기록 없이 죽음) → 다음 실행이 다시 집는다
    expect(sub({ attempts: 1, updatedAt: "2026-09-29T12:00:00.000Z", nextAttemptAt: "2026-09-29T12:05:00.000Z" })).toEqual({ kind: "due" });
  });

  test("🔴 실패 뒤 다음 시도를 기다림 — 아직이면 다시 보낼 예정 {시각} · 지났으면(리뷰 실측 ② 54분 · 하루 1회 크론 18시간) 보낼 차례", () => {
    // 3번째 실패 → 백오프 30분(12:50 → 13:20)
    expect(sub({ attempts: 3, lastError: "provider_timeout", updatedAt: "2026-09-29T12:50:00.000Z", nextAttemptAt: "2026-09-29T13:20:00.000Z" })).toEqual({
      kind: "retry",
      at: "2026-09-29T13:20:00.000Z",
    });
    // 2번째 실패 → 백오프 5분(12:01 → 12:06) — 54분 지남
    expect(sub({ attempts: 2, lastError: "provider_timeout", updatedAt: "2026-09-29T12:01:00.000Z", nextAttemptAt: "2026-09-29T12:06:00.000Z" })).toEqual({ kind: "due" });
    // 18시간 지남(다음 크론을 기다림)
    expect(sub({ attempts: 3, lastError: "provider_503:http_503", updatedAt: "2026-09-28T18:30:00.000Z", nextAttemptAt: "2026-09-28T19:00:00.000Z" })).toEqual({
      kind: "due",
    });
    // 경계 — 다음 시도 = 지금이면 이미 보낼 때다(발송기도 집는다: next_attempt_at <= now)
    expect(sub({ attempts: 2, lastError: "provider_timeout", updatedAt: "2026-09-29T12:55:00.000Z", nextAttemptAt: "2026-09-29T13:00:00.000Z" })).toEqual({ kind: "due" });
    // Retry-After 가 5분이라 기다림이 lease 와 같은 길이 — 1회째에는 claim 이 오류를 들고 있을 수 없으니 기다림이다
    expect(sub({ attempts: 1, lastError: "provider_429:http_429", updatedAt: "2026-09-29T12:58:00.000Z", nextAttemptAt: "2026-09-29T13:03:00.000Z" })).toEqual({
      kind: "retry",
      at: "2026-09-29T13:03:00.000Z",
    });
  });

  test("🔴 실패 뒤 다시 집힌 것(claim 이 last_error 를 지우지 않는다) — 그 시도의 백오프가 lease 보다 길면 lease 로 알아본다 · 같은 길이(2회째 5분)면 가를 수 없어 기다림", () => {
    // 3회째 claim(12:59 → lease 13:04) — 3회째 실패의 기다림은 30분 이상이라 5분 간격은 claim 뿐이다
    expect(sub({ attempts: 3, lastError: "provider_timeout", updatedAt: "2026-09-29T12:59:00.000Z", nextAttemptAt: "2026-09-29T13:04:00.000Z" })).toEqual({ kind: "sending" });
    // 그 lease 가 끝남 → 보낼 차례
    expect(sub({ attempts: 3, lastError: "provider_timeout", updatedAt: "2026-09-29T12:40:00.000Z", nextAttemptAt: "2026-09-29T12:45:00.000Z" })).toEqual({ kind: "due" });
    // 2회째: claim 의 lease 도 5분, 2번째 실패의 백오프도 5분 — 칸만으로는 같은 모양. 몇 초짜리 claim 보다 5분 기다림일 때가 훨씬 많아 기다림으로 본다
    expect(sub({ attempts: 2, lastError: "provider_timeout", updatedAt: "2026-09-29T12:58:00.000Z", nextAttemptAt: "2026-09-29T13:03:00.000Z" })).toEqual({
      kind: "retry",
      at: "2026-09-29T13:03:00.000Z",
    });
  });

  test("🔴 한 번도 집히지 않은 것(attempts 0 — 다음 시도 = 만든 때) — 곧바로 보낼 차례 · 24시간 넘으면 오래 멈춤", () => {
    expect(sub({ attempts: 0, updatedAt: "2026-09-29T12:59:58.000Z", nextAttemptAt: "2026-09-29T12:59:58.000Z" })).toEqual({ kind: "due" });
    expect(sub({ attempts: 0, updatedAt: "2026-09-28T11:00:00.000Z", nextAttemptAt: "2026-09-28T11:00:00.000Z" })).toEqual({ kind: "stalled" });
  });

  test("🔴 24시간 경계 — 보낼 때가 된 지 24시간이면 오래 멈춤(하루 1회 크론을 한 번 이상 놓쳤다) · 1ms 모자라면 보낼 차례", () => {
    const due = (nextAttemptAt: string) => sub({ attempts: 2, lastError: "provider_timeout", updatedAt: "2026-09-28T12:00:00.000Z", nextAttemptAt });
    expect(due("2026-09-28T13:00:00.000Z")).toEqual({ kind: "stalled" });
    expect(due("2026-09-28T13:00:00.001Z")).toEqual({ kind: "due" });
    // lease 가 끝난 지 하루 넘음도 같다
    expect(sub({ attempts: 1, updatedAt: "2026-09-27T09:00:00.000Z", nextAttemptAt: "2026-09-27T09:05:00.000Z" })).toEqual({ kind: "stalled" });
    expect(PENDING_STALL_HOURS).toBe(24);
  });

  test("🔴 오래 멈춤의 기준 ≥ 발송 크론의 간격 — 크론이 한 번 돌 시간을 주고 나서야 멈췄다고 말한다(vercel.json)", () => {
    const json = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    const cron = json.crons.find((c) => c.path === "/api/cron/notify");
    expect(cron, "통지 크론").toBeDefined();
    // "분 시 * * *" = 하루 한 번(24시간 간격) — 다른 모양이면 간격을 다시 재야 한다
    const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cron!.schedule);
    expect(m, `하루 1회 모양이 아니다: ${cron!.schedule}`).not.toBeNull();
    const intervalHours = 24;
    expect(PENDING_STALL_HOURS).toBeGreaterThanOrEqual(intervalHours);
  });

  test("🔴 시도를 다 쓴 것(attempts ≥ MAX) — 다섯 번째 시도의 lease 안이면 보내는 중 · 끝났으면 '다시 보내기를 다 씀'(더 보내지 않는다 — 다음 실행의 회수기가 실패로 닫는다)", () => {
    expect(sub({ attempts: MAX_ATTEMPTS, lastError: "provider_503:http_503", updatedAt: "2026-09-29T12:59:00.000Z", nextAttemptAt: "2026-09-29T13:04:00.000Z" })).toEqual({
      kind: "sending",
    });
    expect(sub({ attempts: MAX_ATTEMPTS, lastError: "provider_503:http_503", updatedAt: "2026-09-29T12:30:00.000Z", nextAttemptAt: "2026-09-29T12:35:00.000Z" })).toEqual({
      kind: "exhausted",
    });
  });

  test("🔴 발송기와 같은 규칙 — 보내는 중·다시 보낼 예정 = 발송기가 기다리는 행(wait) · 보낼 차례·오래 멈춤 = 발송기가 집을 행(send) · 다 씀 = 더 보내지 않는 행(give_up)", () => {
    const cases: In[] = [
      row({ attempts: 1, updatedAt: "2026-09-29T12:58:00.000Z", nextAttemptAt: "2026-09-29T13:03:00.000Z" }),
      row({ attempts: 1, updatedAt: "2026-09-29T12:00:00.000Z", nextAttemptAt: "2026-09-29T12:05:00.000Z" }),
      row({ attempts: 3, lastError: "provider_timeout", updatedAt: "2026-09-29T12:50:00.000Z", nextAttemptAt: "2026-09-29T13:20:00.000Z" }),
      row({ attempts: 2, lastError: "provider_timeout", updatedAt: "2026-09-29T12:01:00.000Z", nextAttemptAt: "2026-09-29T12:06:00.000Z" }),
      row({ attempts: 3, lastError: "provider_timeout", updatedAt: "2026-09-29T12:59:00.000Z", nextAttemptAt: "2026-09-29T13:04:00.000Z" }),
      row({ attempts: 0, updatedAt: "2026-09-28T11:00:00.000Z", nextAttemptAt: "2026-09-28T11:00:00.000Z" }),
      row({ attempts: 2, lastError: "provider_timeout", updatedAt: "2026-09-29T12:55:00.000Z", nextAttemptAt: "2026-09-29T13:00:00.000Z" }),
      row({ attempts: MAX_ATTEMPTS, lastError: "x", updatedAt: "2026-09-29T12:30:00.000Z", nextAttemptAt: "2026-09-29T12:35:00.000Z" }),
    ];
    const worker: Record<string, string> = { sending: "wait", retry: "wait", due: "send", stalled: "send", exhausted: "give_up" };
    for (const c of cases) {
      const s = pendingSubState(c, NOW);
      expect(s, JSON.stringify(c)).not.toBeNull();
      const decision = nextAttemptDecision({ status: c.status as "pending", attempts: c.attempts, next_attempt_at: c.nextAttemptAt }, NOW);
      // 다섯 번째 시도의 lease 안은 발송기 판정으로 give_up(더 집지 않는다)이지만 지금 보내는 중이다 — 그 한 칸만 예외
      const expected = c.attempts >= MAX_ATTEMPTS && s!.kind === "sending" ? "give_up" : worker[s!.kind];
      expect(decision, `${JSON.stringify(c)} → ${s!.kind}`).toBe(expected);
    }
  });

  test("🔴 판정의 lease 모양은 claim 함수와 같다 — 마지막 claim 정의가 updated_at = now() · next_attempt_at = now() + 5분(CLAIM_LEASE_MS)을 한 문장에서 찍는다", () => {
    const mig = "supabase/migrations";
    const files = readdirSync(path.join(ROOT, mig)).filter((f) => f.endsWith(".sql")).sort();
    const defining = files.filter((f) => /create or replace function claim_pending_notifications/.test(read(`${mig}/${f}`)));
    expect(defining.length).toBeGreaterThan(0);
    const sql = read(`${mig}/${defining.at(-1)}`);
    const body = sql.slice(sql.lastIndexOf("create or replace function claim_pending_notifications"));
    const set = /set\s+attempts\s*=\s*n\.attempts\s*\+\s*1,\s*updated_at\s*=\s*now\(\),\s*next_attempt_at\s*=\s*now\(\)\s*\+\s*interval\s*'(\d+) minutes'/.exec(body);
    expect(set, "claim 이 attempts · updated_at · next_attempt_at 을 한 set 에서 찍는다").not.toBeNull();
    expect(Number(set![1]) * 60_000).toBe(CLAIM_LEASE_MS);
  });

  /**
   * 격리 행은 '대기' 배지가 아니라 자기 배지(발송됨 · 기록 확인 필요 — P4-7 수정 라운드 3)를 단다. 둘째 줄은 그 말을 되풀이할 뿐이고,
   * 그 행의 next_attempt_at 은 격리 표식(먼 미래)이라 '다시 보낼 예정 {시각}' 으로 풀면 **거짓**이다 — 시도 수와 무관하게 둘째 줄 없음.
   */
  test("🔴 격리 행(보냈지만 기록 못 함 — sent_unmarked:) — 둘째 줄 없음(자기 배지가 말한다 · 먼 미래 시각을 '다시 보낼 예정' 으로 풀지 않는다)", () => {
    const farFuture = "2036-09-26T13:00:00.000Z";
    expect(pendingSubState(row({ attempts: 1, lastError: `${SENT_UNMARKED_PREFIX}M4V1`, nextAttemptAt: farFuture }), NOW)).toBeNull();
    expect(pendingSubState(row({ attempts: MAX_ATTEMPTS, lastError: `${SENT_UNMARKED_PREFIX}` }), NOW)).toBeNull();
  });

  test("카탈로그 — 둘째 줄 다섯 가지 · 다시 보낼 예정은 {time} 을 받는다 · 보낼 차례는 컨트롤러 문구 그대로", () => {
    const p = n.pending;
    expect(Object.keys(p).sort()).toEqual(["due", "exhausted", "retry", "sending", "stalled"]);
    for (const k of Object.keys(p)) expect(HANGUL.test(p[k]), k).toBe(true);
    expect(p.retry).toContain("{time}");
    expect(p.sending).toBe("보내는 중");
    expect(p.due).toBe("보낼 차례 · 다음 발송 때 나가요");
    expect(p.stalled).toBe("오래 멈춤 — 확인 필요");
    expect(p.exhausted).toBe("다시 보내기를 다 씀 — 확인 필요");
  });

  test("🔴 화면 — 대기 행은 배지 아래 둘째 줄을 그린다(시각은 관리자 날짜 틀) · 격리·중복 행은 자기 배지만", () => {
    const page = codeOf("app/admin/(protected)/notifications/page.tsx");
    expect(page).toMatch(/pendingSubState\(/);
    expect(page).toMatch(/data-testid="admin-notification-substate"/);
    expect(page).toMatch(/t\("pending\.retry"/);
    expect(page).toMatch(/t\(`pending\.\$\{/);
    // 기록 상태 표식이 있는 행(격리 · 중복 억제)은 '대기'·'실패' 배지를 달지 않는다(P4-7 수정 라운드 3 — 되돌리지 않는다)
    expect(page).toMatch(/row\.recordState [!=]== null/);
    expect(page).toMatch(/t\(`recordState\.\$\{row\.recordState\}`\)/);
  });
});

// =============================================================================
// 5. 화면을 그려 본다 — 보이는 글자에 코드 원문·먼 미래 날짜가 없다 · 둘째 줄 · 요약 세 칸 · 칸 일곱
// =============================================================================
describe("5. 발송 기록 화면(서버 부품을 그대로 그린다 · 조회만 가짜)", () => {
  const NOW = new Date("2026-09-29T13:00:00.000Z"); // KST 9월 29일 (화) 22:00
  const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();
  const MIN = 60_000;
  const base = (over: Partial<NotificationListRow>): NotificationListRow => {
    const row: NotificationListRow = {
      id: 1,
      reservationId: "11111111-1111-4111-8111-111111111111",
      publicCode: "P523N001",
      event: "created",
      channel: "sms",
      template: "created.customer.sms",
      status: "pending",
      attempts: 0,
      lastError: null,
      recordState: null,
      nextAttemptAt: iso(MIN),
      createdAt: iso(MIN),
      updatedAt: iso(MIN),
      toMasked: "010-****-0004",
      ...over,
    };
    return { ...row, recordState: notificationRecordState(row.status, row.lastError) };
  };
  const RETRY_AT = new Date(NOW.getTime() + 25 * MIN).toISOString();
  const HOUR = 60 * MIN;
  const ROWS: NotificationListRow[] = [
    // 들어오자마자 집혀서 lease 안(1분 전 claim → 4분 뒤 lease 끝) — 보내는 중
    base({ id: 1, attempts: 1, createdAt: iso(MIN), updatedAt: iso(MIN), nextAttemptAt: new Date(NOW.getTime() + 4 * MIN).toISOString() }),
    // 2번째 실패 뒤 다음 시도가 아직(기다림 30분 — lease 모양이 아니다) — 다시 보낼 예정
    base({ id: 2, attempts: 2, lastError: "provider_timeout", nextAttemptAt: RETRY_AT, createdAt: iso(30 * MIN), updatedAt: iso(5 * MIN) }),
    // 한 번도 집히지 않고 40분 — 보낼 차례(다음 발송 때 나간다)
    base({ id: 3, createdAt: iso(40 * MIN), nextAttemptAt: iso(40 * MIN), updatedAt: iso(40 * MIN) }),
    base({
      id: 4,
      attempts: 1,
      lastError: `${SENT_UNMARKED_PREFIX}M4V20260928143012KQZ7Y1`,
      nextAttemptAt: new Date(NOW.getTime() + QUARANTINE_RETRY_AFTER_MS).toISOString(),
    }), // 격리 — 자기 배지 · 먼 미래 시각은 어디에도 없다
    base({ id: 5, status: "failed", attempts: 3, lastError: "provider_503:http_503", channel: "email", template: "created.owner.email", toMasked: "***@example.test" }),
    base({ id: 6, status: "failed", attempts: 1, lastError: DUPLICATE_SENT_ERROR }),
    base({ id: 7, status: "sent", attempts: 1 }),
    base({ id: 8, status: "failed", attempts: 1, lastError: "totally_new_code", reservationId: null, publicCode: null }),
    // 다시 보낼 시각이 30시간 전(하루 1회 크론을 놓침) — 오래 멈춤
    base({ id: 9, attempts: 3, lastError: "provider_timeout", createdAt: iso(40 * HOUR), updatedAt: iso(30 * HOUR + 30 * MIN), nextAttemptAt: iso(30 * HOUR) }),
    // 다섯 번째 시도의 lease 가 끝남 — 다시 보내기를 다 씀
    base({ id: 10, attempts: MAX_ATTEMPTS, lastError: "provider_503:http_503", createdAt: iso(3 * HOUR), updatedAt: iso(20 * MIN), nextAttemptAt: iso(15 * MIN) }),
  ];

  const dl = (): AdminDateLabels => {
    const d = (ko.admin as unknown as { dates: Record<string, unknown> }).dates;
    const s = (k: string) => String(d[k]);
    return {
      weekdays: d.weekdays as string[],
      day: s("day"),
      dayYear: s("dayYear"),
      md: s("md"),
      mdYear: s("mdYear"),
      month: s("month"),
      monthYear: s("monthYear"),
      time: s("time"),
      dateTime: s("dateTime"),
      period: s("period"),
    };
  };
  const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

  async function render(summary = { failed: 2, stuck: 0, sentUnconfirmed: 1, windowHours: 24, ok: false }) {
    vi.mocked(getNotificationSummary).mockResolvedValue(summary);
    vi.mocked(listNotifications).mockResolvedValue({ items: ROWS, hasMore: false, nextCursor: null });
    const tree = (await AdminNotificationsPage({ searchParams: Promise.resolve({}) })) as ReactElement;
    return renderToStaticMarkup(tree);
  }
  const rowHtml = (html: string, id: number) => {
    const rows = [...html.matchAll(/<tr[^>]*data-row-status="[^"]*"[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
    const idx = ROWS.findIndex((r) => r.id === id);
    return rows[idx];
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  test("🔴 보이는 글자에 코드 원문이 없다 — 라벨만 보이고 원문은 title 에만(모르는 코드는 '기타 오류')", async () => {
    const html = await render();
    const visible = strip(html);
    for (const raw of ["provider_timeout", "provider_503", "http_503", "sent_unmarked", "duplicate_sent", "totally_new_code", "M4V2026"]) {
      expect(visible, raw).not.toContain(raw);
    }
    expect(visible).not.toMatch(/[a-z]+_[a-z]+/);
    // 라벨이 보이고, 원문은 그 라벨의 title 에
    expect(rowHtml(html, 2)).toMatch(new RegExp(`title="provider_timeout"[^>]*>${n.error.timeout}<`));
    expect(rowHtml(html, 5)).toMatch(new RegExp(`title="provider_503:http_503"[^>]*>${n.error.providerDown}<`));
    expect(rowHtml(html, 8)).toMatch(new RegExp(`title="totally_new_code"[^>]*>${n.error.other}<`));
    expect(n.error.other).toBe("기타 오류");
  });

  test("🔴 '대기' 둘째 줄 — 보내는 중 · 다시 보낼 예정 {시각} · 보낼 차례 · 오래 멈춤 · 다시 보내기를 다 씀 · 격리 행은 자기 배지만(먼 미래 시각은 어디에도 없다)", async () => {
    const html = await render();
    /** 둘째 줄 span 의 보이는 글자(안의 조각 span 까지) — 없으면 null. */
    const sub = (id: number): string | null => {
      const h = rowHtml(html, id);
      const at = h.indexOf('data-testid="admin-notification-substate"');
      if (at < 0) return null;
      const open = h.indexOf(">", at) + 1;
      let depth = 1;
      const re = /<(\/?)span\b[^>]*>/g;
      re.lastIndex = open;
      for (let m = re.exec(h); m; m = re.exec(h)) {
        depth += m[1] === "/" ? -1 : 1;
        // 태그만 걷는다 — 날짜 틀의 줄바꿈 없는 빈칸(U+00A0)은 그대로 둔다(strip 의 \s 는 그것까지 빈칸으로 바꾼다)
        if (depth === 0) return h.slice(open, m.index).replace(/<[^>]+>/g, " ").replace(/[ \t\r\n]+/g, " ").trim();
      }
      return null;
    };
    expect(sub(1)).toBe(n.pending.sending);
    const retryAt = formatAdminDate(RETRY_AT, NOW, dl(), { time: true, keep: true }) ?? "";
    expect(retryAt).toBe("9월 29일 (화) 22:25".replace(/ /g, " "));
    expect(sub(2)).toBe(n.pending.retry.replace("{time}", retryAt));
    // 보낼 차례 — "보낼 차례 · 다음 발송 때 나가요" 는 조각 줄(가운데점은 CSS 장식 — 줄 머리·끝에 서지 않는다 · DOM 글자로는 빈칸 하나)
    expect(sub(3)).toBe("보낼 차례 다음 발송 때 나가요");
    expect(rowHtml(html, 3)).toMatch(/data-testid="admin-notification-substate"[^>]*><span class="_segs_[0-9a-f]+"/);
    expect(sub(9)).toBe(n.pending.stalled);
    expect(sub(10)).toBe(n.pending.exhausted);
    expect(sub(4), "격리 행에 둘째 줄").toBeNull();
    expect(strip(rowHtml(html, 4))).toContain((n.recordState as Record<string, string>).sentUnconfirmed);
    expect(strip(rowHtml(html, 4))).not.toContain((n.status as Record<string, string>).pending);
    expect(strip(html), "격리 표식의 먼 미래 다음 시도가 날짜로 보인다").not.toMatch(/2036/);
    // 대기가 아닌 행 — 둘째 줄 없음 · 중복 억제 행은 자기 배지
    for (const id of [5, 6, 7, 8]) expect(sub(id), String(id)).toBeNull();
    expect(strip(rowHtml(html, 6))).toContain((n.recordState as Record<string, string>).duplicateSuppressed);
  });

  test("칸 일곱(상태 · 알림 · 받는 번호 · 접수번호 · 시도 · 오류 · 기록 시각) · 알림 = '종류 · 문자 종류' · 시각은 관리자 날짜 틀", async () => {
    const html = await render();
    const heads = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    const col = n.col;
    expect(heads).toEqual([col.status, col.alert, col.to, col.code, col.attempts, col.lastError, col.time]);
    const tpl = n.template as unknown as { created: { customer: { sms: string }; owner: { email: string } } };
    // 알림 칸은 조각 줄(종류 / 문자 종류) — 가운데점은 조각 사이 CSS 장식이라 DOM 글자로는 빈칸 하나다(P5-23 라운드 3)
    expect(strip(rowHtml(html, 1))).toContain(`${(n.channel as Record<string, string>).sms} ${tpl.created.customer.sms}`);
    expect(strip(rowHtml(html, 5))).toContain(`${(n.channel as Record<string, string>).email} ${tpl.created.owner.email}`);
    expect(rowHtml(html, 1)).toMatch(/class="_segs_[0-9a-f]+"/);
    // 기록 시각 한 줄 + (1분 이상 달라졌으면) 갱신 둘째 줄
    const created2 = (formatAdminDate(ROWS[1].createdAt, NOW, dl(), { time: true }) ?? "").replace(/ /g, " ");
    const updated2 = (formatAdminDate(ROWS[1].updatedAt, NOW, dl(), { time: true }) ?? "").replace(/ /g, " ");
    expect(strip(rowHtml(html, 2))).toContain(created2);
    const updatedLine = (n as unknown as Record<string, string>).updatedLine;
    expect(strip(rowHtml(html, 2))).toContain(updatedLine.replace("{time}", updated2));
    expect(strip(rowHtml(html, 1))).not.toContain(updatedLine.replace("{time}", "").trim());
    // 원형 날짜(YYYY-MM-DD)는 한 곳에도 없다
    expect(strip(html)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test("요약 — 세 칸(작은 이름 · 큰 숫자 · 작은 기간) · 0이 아닌 칸만 강조 · 이상 없으면 '이상 없음' 줄 + 세 칸 0건", async () => {
    const html = await render();
    const items = [...html.matchAll(/<div[^>]*data-kind="(failed|stuck|sentUnconfirmed)"[^>]*>([\s\S]*?)<\/div>/g)];
    expect(items.map((m) => m[1])).toEqual(["failed", "stuck", "sentUnconfirmed"]);
    const g = (n.summary as unknown as { grid: Record<string, string> }).grid;
    const s = n.summary as unknown as Record<string, string>;
    expect(strip(items[0][2])).toBe(`${g.failed} ${s.count.replace("{n}", "2")} ${s.periodAll}`);
    // 재검토 P2-A — 둘째 칸의 작은 줄은 센 창 그대로 "마지막 시도 · 최근 24시간"(조각 — DOM 글자로는 빈칸 하나)
    expect(g.stuckNote).toBe("마지막 시도 · 최근 {hours}시간");
    expect(strip(items[1][2])).toBe(`${g.stuck} ${s.count.replace("{n}", "0")} 마지막 시도 최근 24시간`);
    // 라운드 3 — 이름은 짧게 "기록 확인 필요", '발송됨' 은 작은 줄로("발송됨 · 전체 기간" — 조각이라 DOM 글자로는 빈칸 하나)
    expect(g.sentUnconfirmed).toBe("기록 확인 필요");
    expect(g.sentUnconfirmedNote).toBe(`발송됨 · ${s.periodAll}`);
    expect(strip(items[2][2])).toBe(`${g.sentUnconfirmed} ${s.count.replace("{n}", "1")} ${g.sentUnconfirmedNote.split(" · ").join(" ")}`);
    expect(items[0][0]).toMatch(/data-alert="true"/);
    expect(items[1][0]).not.toMatch(/data-alert/);
    const ok = await render({ failed: 0, stuck: 0, sentUnconfirmed: 0, windowHours: 24, ok: true });
    expect(strip(ok)).toContain(s.ok);
    expect([...ok.matchAll(/data-alert="true"/g)]).toHaveLength(0);
  });
});

describe("6. 요약 칸 이름과 둘째 줄이 부딪치지 않는다(리뷰 P2-3)", () => {
  /**
   * 요약의 둘째 칸은 "시도를 다 쓴 pending"(attempts ≥ MAX · 최근 24시간)을 센다. 예전 이름 "멈춘 알림" 은 한 화면의 행 둘째 줄 "오래 멈춤"
   * (보낼 때가 된 지 24시간)과 같은 말이라, 사장님이 "멈춘 알림 1건" 과 "오래 멈춤" 4행을 맞춰 보게 됐다. 이제 센 것을 그대로 이름으로 쓴다.
   */
  const s = n.summary as unknown as Record<string, string> & { grid: Record<string, string> };
  test("🔴 둘째 칸 이름은 센 것 그대로 — '다시 보내기를 다 쓴 알림' · 요약 어디에도 '멈' 이 없다(행의 '오래 멈춤' 과 다른 말)", () => {
    expect(s.grid.stuck).toBe("다시 보내기를 다 쓴 알림");
    // 재검토 P2-A — 창은 마지막 시도(updated_at)라 문장도 그대로 말한다(기록 허브 줄)
    expect(s.stuck).toBe("다시 보내기를 다 쓴 알림 {n}건 (최근 24시간 안에 마지막 시도)");
    for (const [k, v] of [...Object.entries(s.grid), ...Object.entries(s).filter(([, v]) => typeof v === "string")]) {
      expect(String(v), `summary ${k}`).not.toMatch(/멈/);
    }
    expect(n.pending.stalled).toContain("멈춤");
  });

  test("🔴 같은 행을 같은 말로 — 요약이 세는 '다 쓴' 행의 둘째 줄도 '다시 보내기를 다 씀'", () => {
    const phrase = "다시 보내기를 다 ";
    expect(s.grid.stuck.startsWith(phrase)).toBe(true);
    expect(n.pending.exhausted.startsWith(phrase)).toBe(true);
  });

  test("매뉴얼 8장 — 요약 둘째 칸 이름과 둘째 줄 다섯 가지를 화면 문구 그대로 설명한다 · 옛 이름 '멈춘 알림' 이 없다", () => {
    const manual = read("docs/ops/admin-manual.md");
    const sec = manual.slice(manual.indexOf("## 8. 발송 기록 보기"), manual.indexOf("## 9."));
    expect(sec.length).toBeGreaterThan(100);
    expect(sec).toContain(s.grid.stuck);
    expect(sec).not.toContain("멈춘 알림");
    // 재검토 P2-A — 둘째 칸이 무엇으로 세는지(마지막 시도 · 최근 24시간)를 화면 문구 그대로 적는다
    expect(sec).toContain(s.grid.stuckNote.replace("{hours}", "24"));
    for (const k of ["sending", "due", "stalled", "exhausted"] as const) expect(sec, k).toContain(n.pending[k]);
    expect(sec).toContain(n.pending.retry.replace(" {time}", ""));
    // 옛 설명("10분이 지나면 … 오래 멈춤") — 이제 기준은 보낼 때가 된 지 24시간이다
    expect(sec).not.toMatch(/10분이 지나면[^\n]*오래 멈춤/);
    expect(sec).toContain("24시간");
  });
});

describe("4. 순수 모듈", () => {
  test("React·Next·DB·env 0 · 한글 리터럴 0 · server-only 아님(판정만)", () => {
    const src = codeOf("lib/admin/notificationDisplay.ts");
    expect(src).not.toMatch(/from\s+["'](react|next|next-intl)/);
    expect(src).not.toMatch(/process\.env|createSsrClient|server-only/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
  });

  test("키 목록에 중복이 없다", () => {
    const keys: readonly NotifyErrorKey[] = NOTIFY_ERROR_KEYS;
    expect(new Set(keys).size).toBe(keys.length);
  });
});
