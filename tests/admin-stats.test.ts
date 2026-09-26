/**
 * P5-17 — 관리자 통계 `/admin/stats` (마이그레이션 0022 · definer 함수 `admin_stats` 하나).
 *
 * 무엇을 잠그나
 * ---------------------------------------------------------------------------
 * ① **결과에 개인정보가 없다.** 함수는 (버킷·코드, 건수)만 돌려준다. 결과 JSON 의 **키 집합을 통째로 고정**해
 *    누가 나중에 칸 하나를 조용히 더하면 여기서 깨지게 한다(ADMIN-STATS-RESEARCH §5-1).
 * ② **작은 칸 숨김(k=3)** — 분해표(여행 구분·차량·구간·리드타임)에서 1~2건인 칸은 건수를 내리지 않고
 *    `count: null · suppressed: true` 로 오며 하나의 "기타" 로 합쳐진다. **숨김은 SQL 안에서** 일어난다 —
 *    원자료가 브라우저까지 내려오지 않는다는 뜻이고, 그래서 여기서 REST 응답 본문 자체를 본다.
 * ③ **KST 경계** — 기간 양끝과 버킷은 서울 벽시계다. 세션 TZ 는 UTC 라(0004 헤더) UTC 로 자르면 9시간이 어긋난다.
 *    픽스처에 00:00 KST 직전·직후 행을 넣어 **UTC 로 잘랐다면 반드시 틀리는** 값을 단언한다.
 * ④ **권한 세 갈래** — anon = EXECUTE 거부 · 명단 밖 로그인 = 가드 거부(42501 + 문구) · service_role = EXECUTE 거부.
 *    판정은 tests/helpers/expect-denied.ts 로만 한다(`>= 400` 금지 — CLAUDE.md §7).
 *
 * 왜 2031년 픽스처인가
 * ---------------------------------------------------------------------------
 * 기간 단위 지표(①②③⑥⑦⑧⑨⑩)는 **다른 테스트 파일의 행이 섞이면 안 된다.** 이 저장소의 다른 DB 블록은 전부
 * `now()` 근처의 `created_at` 을 쓰므로, 아무도 쓰지 않는 미래 달(2031-03)에 픽스처를 놓으면 그 창이 **배타적**이 된다.
 * 파기 배치(lib/retention/purge.ts)도 `retention_until` 이 먼 미래라 이 행들을 건드리지 않는다.
 * 반면 기간과 무관한 지표(④ 처리 대기 · ⑤ 발송 문제)는 표 전체를 세므로 절대값을 단언할 수 없다 —
 * 그쪽은 **한 트랜잭션 안에서** 기준선과 삽입 후 값을 나란히 재고 되돌리는 탐침으로 본다(§5-E).
 *
 * `reservations` · `notifications_log` 에 행을 남기므로 `withNotificationsLock()` 안에서 돈다(CLAUDE.md §7).
 * `showcase_routes` 는 **읽지 않는다**(함수가 안에서 조인할 뿐) — 시드 값을 바꾸지도, 16행을 대조하지도 않으므로
 * 대표 노선 잠금은 쓰지 않는다. 대신 다른 파일이 값을 잠시 바꾸는 두 행(SEL→WJU · ICN→SEL)을 픽스처에서 피한다.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { ADMIN_GUARD_MESSAGE } from "@/lib/admin/adminRpc";

import { withNotificationsLock } from "./helpers/db-lock";
import { expectFunctionPrivilegeDenied, expectRaisedDenied } from "./helpers/expect-denied";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";
import { runLocalSqlExpectingError, sqlErrorText } from "./helpers/local-stack-sql";
import { stripComments } from "./helpers/strip-comments";

vi.mock("server-only", () => ({}));

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const exists = (rel: string) => existsSync(path.join(ROOT, rel));
const compact = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

const UP_REL = "supabase/migrations/0022_admin_stats.sql";
const DOWN_REL = "supabase/rollbacks/0022_admin_stats.down.sql";
const LIB_REL = "lib/admin/stats.ts";
const PAGE_REL = "app/admin/(protected)/stats/page.tsx";
const TABS_REL = "components/admin/tabs.ts";
const CSS_REL = "components/admin/admin.module.css";
const SEMANTIC_REL = "styles/semantic.css";
const RUNBOOK_REL = "docs/ops/migration-runbook.md";

const GUARD_MESSAGE = `admin_stats: ${ADMIN_GUARD_MESSAGE}`;

/** 결과 JSON 의 고정 키 집합 — 하나라도 늘거나 줄면 이 파일이 깨진다(§① 의 뜻). */
const TOP_KEYS = [
  "backlog",
  "confirmation",
  "intake",
  "lead_time",
  "notifications",
  "purposes",
  "range",
  "response_time",
  "segments",
  "trend",
  "vehicles",
] as const;
const RANGE_KEYS = ["bucket", "days", "from", "has_prev", "prev_from", "prev_to", "to"];
const INTAKE_KEYS = ["delta", "prev_total", "total"];
const CONFIRMATION_KEYS = ["confirmed", "pending", "rate_pct", "total"];
const RESPONSE_KEYS = ["enough", "median_minutes", "sample"];
const BACKLOG_KEYS = ["hours", "new_total", "over_72h"];
const NOTIFICATIONS_KEYS = ["failed", "stuck", "stuck_hours", "window_days"];
const TREND_ITEM_KEYS = ["bucket", "cancelled", "confirmed", "split", "total", "waiting"];
const PURPOSE_ITEM_KEYS = ["code", "count", "other", "suppressed"];
const VEHICLE_ITEM_KEYS = ["buses", "count", "other", "slug", "suppressed"];
const SEGMENT_ITEM_KEYS = ["count", "destination", "origin", "other", "showcase", "suppressed"];
const LEAD_ITEM_KEYS = ["bucket", "count", "other", "suppressed"];

/**
 * 보완 숨김의 뜻 — "기타" 에 들어간 원자료 칸이 **둘 이상**이어야 한다(수정 라운드 2 · astra P1).
 * 칸이 하나뿐이면 `총건수 − 보이는 칸들의 합` 이 곧 그 칸의 건수이고, 칸 목록이 고정된 축에서는 이름까지 드러난다.
 * 테스트는 "남은 건수가 한 칸 분량보다 크다" 로 그것을 본다 — 3·3·3·1 배치에서 보완 숨김이 없으면 남은 건수가 1 이다.
 */
const MIN_HIDDEN_COUNT_FLOOR = 1;

const sortedKeys = (o: unknown): string[] => Object.keys(o as Record<string, unknown>).sort();

/**
 * 소스에서 **산술 나눗셈**을 찾는다 (수정 라운드 3 · astra P2).
 *
 * 문자열·템플릿의 **리터럴 글자만** 지우고 `${…}` 안의 식은 남긴다. 템플릿을 통째로 지우던 옛 판은
 * `` `${(value ?? 0) / max}%` `` 를 **0건**으로 읽었다 — 검사가 막으려던 바로 그 회귀를 통과시킨 것이다.
 * 주석은 호출부가 먼저 지운다(stripComments). 정규식 리터럴은 이 화면에 없다.
 */
function divisionsIn(src: string): string[] {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      out += " ";
      i++;
      while (i < src.length && src[i] !== c) {
        i += src[i] === "\\" ? 2 : 1;
        out += "  ";
      }
      out += " ";
      i++;
      continue;
    }
    if (c === "`") {
      out += " ";
      i++;
      while (i < src.length && src[i] !== "`") {
        if (src[i] === "\\") {
          i += 2;
          out += "  ";
          continue;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          i += 2;
          out += "  ";
          let depth = 1;
          while (i < src.length && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            if (depth === 0) break;
            out += src[i]; // 식은 그대로 남긴다 — 여기 든 나눗셈을 잡아야 한다
            i++;
          }
          out += " ";
          i++;
          continue;
        }
        out += " ";
        i++;
        continue;
      }
      out += " ";
      i++;
      continue;
    }
    out += c;
    i++;
  }
  // `${…}` 안에 남은 문자열 리터럴은 한 번 더 지운다(경로·클래스 이름의 `/` 오탐 방지).
  const flattened = out.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
  return [...flattened.matchAll(/[)\]\w]\s*\/\s*[(\w]/g)].map((m) => m[0]);
}

// =============================================================================
// 1. 마이그레이션 0022 — 텍스트 계약
// =============================================================================
describe("1. supabase/migrations/0022_admin_stats.sql", () => {
  const raw = exists(UP_REL) ? read(UP_REL) : "";
  const code = compact(stripComments(raw, UP_REL));

  test("존재하고 0022 번호는 이 파일 하나다", () => {
    expect(raw.length).toBeGreaterThan(0);
    expect(readdirSync(path.join(ROOT, "supabase", "migrations")).filter((f) => /^0022_/.test(f))).toEqual([
      "0022_admin_stats.sql",
    ]);
  });

  test("첫 실행문이 `set local lock_timeout = '5s'` 이고 곧바로 확인 DO 가 온다 (0020·0021 규범)", () => {
    const body = stripComments(raw, UP_REL).replace(/^\s*\n/gm, "").trimStart();
    expect(body.split("\n")[0].trim()).toBe("set local lock_timeout = '5s';");
    expect(code).toContain("if current_setting('lock_timeout') <> '5s' then");
  });

  test("definer 규범 — create or replace · stable · security definer · search_path 는 pg_temp 로 끝난다", () => {
    expect(code).toContain("create or replace function admin_stats(p_from date, p_to date)");
    expect(code).toContain("returns jsonb");
    expect(code).toContain("language plpgsql");
    expect(code).toContain("stable");
    expect(code).toContain("security definer");
    expect(code).toContain("set search_path = public, pg_temp");
  });

  test("🔴 `drop function` 을 쓰지 않는다 — drop 후 create 는 EXECUTE 를 공개 롤에 다시 연다(CLAUDE.md §3)", () => {
    expect(code).not.toMatch(/\bdrop function\b/);
  });

  test("첫 문장이 is_admin() 가드이고 문구가 ADMIN_GUARD_MESSAGE 와 한 글자도 같다", () => {
    expect(code).toContain("if not is_admin() then");
    expect(raw).toContain(`raise exception '${GUARD_MESSAGE}' using errcode = '42501'`);
    // 본문에서 가드가 다른 어떤 질의보다 앞에 있다
    const iGuard = code.indexOf("if not is_admin() then");
    expect(iGuard).toBeGreaterThan(-1);
    expect(iGuard).toBeLessThan(code.indexOf("from reservations"));
  });

  test("입력 검증 22023 세 가지 — null · from > to · 366일 초과", () => {
    expect(code).toMatch(/p_from is null or p_to is null/);
    expect(code).toMatch(/p_from > p_to/);
    expect(code).toMatch(/366/);
    expect((raw.match(/errcode = '22023'/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test("권한 — public·anon·service_role 에서 회수하고 authenticated 에만 준다", () => {
    expect(code).toContain("revoke all on function admin_stats(date, date) from public, anon, service_role;");
    expect(code).toContain("grant execute on function admin_stats(date, date) to authenticated;");
  });

  test("KST 경계 — 양끝은 Asia/Seoul 로 해석하고 current_date·now()::date 를 쓰지 않는다 (0004 가 고친 버그)", () => {
    expect(code).toContain("(p_from::timestamp at time zone 'asia/seoul')");
    expect(code).toContain("((p_to + 1)::timestamp at time zone 'asia/seoul')");
    expect(code).toMatch(/at time zone 'asia\/seoul'\)::date/);
    expect(code).not.toMatch(/\bcurrent_date\b/);
    expect(code).not.toMatch(/now\(\)::date/);
  });

  test("함수 본문이 개인정보 칸을 읽지 않는다 — 이름·전화·메일·메모·접수번호·수신처", () => {
    // 자기검증 DO 는 "그 이름이 본문에 없다" 를 단언하느라 이름을 정당하게 담는다 — 그래서 **함수 본문만** 본다.
    const body = /as \$\$([\s\S]*?)\n\$\$;/.exec(stripComments(raw, UP_REL))?.[1];
    expect(body, "함수 본문을 찾지 못했다").toBeTruthy();
    for (const col of ["name", "phone", "email", "message", "admin_memo", "public_code", "to_phone", "provider_message_id", "last_error"]) {
      expect(body as string, col).not.toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  test("가격을 계산하지 않는다 — price_from 을 곱하거나 더하지 않고 이름조차 꺼내지 않는다 (CLAUDE.md §3)", () => {
    expect(code).not.toMatch(/price_from/);
    expect(code).not.toMatch(/sum\(\s*price/);
  });

  test("인덱스·뷰·캐시를 만들지 않는다 (수백~수천 행 규모 — 연구 §5-4)", () => {
    expect(code).not.toMatch(/create (unique )?index/);
    expect(code).not.toMatch(/create (or replace )?(materialized )?view/);
    expect(code).not.toMatch(/create table/);
  });

  test("작은 칸 숨김 k=3 이 SQL 안에 있다 — 앱이 원자료를 받지 않는다", () => {
    expect(code).toMatch(/c_k\s+constant\s+int\s*:=\s*3/);
    expect(code).toMatch(/suppressed/);
    expect(code).toMatch(/'other'/);
  });

  test("🔴 R2-A 보완 숨김 — 네 축 모두 `hide_n` 으로 '가려진 칸이 0개 또는 2개 이상' 을 만든다", () => {
    // 가려질 칸이 하나뿐이면 보이는 칸 중 가장 작은 것도 함께 가린다 — 축마다 같은 식이 있어야 한다.
    for (const axis of ["purpose_ranked", "vehicle_ranked", "seg_ranked", "lead_ranked"]) {
      expect(code, axis).toContain(axis);
    }
    expect((code.match(/as hide_n/g) ?? []).length, "네 축 전부에 hide_n 이 있어야 한다").toBe(4);
    expect((code.match(/least\(2, count\(\*\) over \(\)\)/g) ?? []).length, "가려진 칸이 하나면 둘까지 늘린다").toBe(4);
    expect((code.match(/rn <= [a-z]\.hide_n/g) ?? []).length, "기타 행이 hide_n 으로 모인다").toBe(4);
  });

  test("🔴 R3-A 추이 — 쪼갤지는 **총건수가 아니라 각 상태 칸**으로 정한다", () => {
    // 옛 판은 `t.total >= c_k` 였다 — 하루 3건이 1·1·1 이면 세 칸이 그대로 나갔다(astra P1).
    expect(code, "총건수로 판정하는 옛 식이 남아 있다").not.toMatch(/'split',\s*\(?t\.total (= 0 or t\.total )?>= c_k/);
    for (const k of ["waiting", "confirmed", "cancelled"]) {
      expect(code, k).toMatch(new RegExp(`\\(x\\.${k}\\s*=? ?0 or x\\.${k}\\s*>= c_k\\)`));
      expect(code, k).toMatch(new RegExp(`'${k}',\\s*case when t\\.splittable then t\\.${k} end`));
    }
    expect(code).toMatch(/'split',\s*t\.splittable/);
  });

  test("🔴 R2-E 날짜 검증 — 유한성·지원 범위를 산술보다 **먼저** 본다", () => {
    const iInf = code.indexOf("'infinity'::date");
    const iBounds = code.indexOf("c_min_date");
    const iDays = code.indexOf("v_days := (p_to - p_from) + 1");
    expect(iInf, "infinity 검사가 없다").toBeGreaterThan(-1);
    expect(iBounds, "지원 범위 상수가 없다").toBeGreaterThan(-1);
    expect(iInf, "무한대 검사가 기간 산술보다 뒤에 있다").toBeLessThan(iDays);
    expect(iBounds, "범위 검사가 기간 산술보다 뒤에 있다").toBeLessThan(iDays);
    expect((raw.match(/errcode = '22023'/g) ?? []).length, "검증 갈래가 늘었는데 22023 이 그대로다").toBeGreaterThanOrEqual(5);
  });

  test("🔴 R3-D 자기검증 — 가드가 **첫 실행문**임을 위치로 보고, 선언부 초기화까지 본다", () => {
    // 옛 판의 `\mbegin\s+if …` 는 앵커가 없어 **중첩 begin 안의 가드**도 통과했다(astra P2).
    expect(raw, "앵커 없는 옛 정규식이 남아 있다").not.toContain("\\mbegin\\s+if not is_admin");
    expect(raw).toContain("position(' begin ' in v_norm)");
    expect(raw).toMatch(/가드가 본문의 첫 실행문이 아니다/);
    // 선언부 초기화(가드보다 먼저 도는 경로)가 리터럴인지 본다
    expect(raw).toMatch(/선언부 초기화가 리터럴이 아니다/);
    expect(raw).toMatch(/:=\(\[\^;\]\+\);/);
  });

  test("🔴 R3-D 자기검증 — 결과 키는 **들여쓰기에 기대지 않고** 집합으로 대조한다", () => {
    // 옛 판은 "4칸 들여쓴 줄" 만 봐서 여섯 칸으로 넣은 `'debug_rows',` 가 통과했다(astra P2).
    expect(raw, "들여쓰기에 기댄 옛 패턴이 남아 있다").not.toContain("(?n)^    ''(");
    expect(raw).toMatch(/결과 select 의 키 집합이 계약과 다르다/);
    expect(raw).toMatch(/select jsonb_build_object\(' in v_norm/);
    // 허용 목록에 중첩 키까지 들어 있다(최상위만 적으면 중첩 자리에 새 키를 넣을 수 있다)
    for (const k of ["median_minutes", "stuck_hours", "showcase", "buses", "split", "d91_plus"]) {
      expect(raw, k).toContain(`'${k}'`);
    }
  });

  test("🔴 R3-D 자기검증 — 금지 칸에 name·phone·email·message 가 들어 있다", () => {
    for (const col of ["name", "phone", "email", "message", "public_code", "admin_memo", "to_phone", "last_error"]) {
      expect(raw, col).toMatch(new RegExp(`'${col}'`));
    }
  });

  test("🔴 R3-B 헤더가 숨김을 **보장으로 말하지 않는다** — 익명화가 아니라고 적는다", () => {
    expect(raw).toMatch(/익명화가 아니다/);
    expect(raw).toMatch(/캡처/);
    expect(raw).toMatch(/known-defects\.md.*D13|D13/);
    // 못 지킬 약속이 남아 있지 않다
    expect(raw, "되돌릴 수 없다는 과장").not.toMatch(/되돌릴 수 없다/);
    expect(raw, "알 수 없다는 과장").not.toMatch(/알 수 없다|알 방법이 없다/);
  });

  test("자기검증 DO 가 네 가지를 본다 — 가드 문구 · prosecdef·pg_temp · EXECUTE 보유자 · NULL proacl 함정", () => {
    expect(code).toContain("prosecdef");
    expect(code).toContain("coalesce(p.proacl, acldefault('f', p.proowner))");
    expect(code).toMatch(/has_function_privilege\('anon'/);
    expect(code).toMatch(/has_function_privilege\('service_role'/);
    expect(code).toMatch(/has_function_privilege\('authenticated'/);
    expect(code).toMatch(/pg_temp/);
    expect(raw).toContain(GUARD_MESSAGE);
  });

  test("실제 표에 쓰지 않는다 — insert/update/delete 문장 0 (읽기 전용 집계다)", () => {
    expect(code).not.toMatch(/\binsert into\b/);
    expect(code).not.toMatch(/\bupdate\s+[a-z0-9_.]+\s+set\b/);
    expect(code).not.toMatch(/\bdelete from\b/);
    expect(code).not.toMatch(/set local role/);
    expect(code).not.toMatch(/reset role/);
    expect(code).not.toMatch(/\block table\b/);
  });
});

// =============================================================================
// 2. 롤백 0022 — 함수만 지운다
// =============================================================================
describe("2. supabase/rollbacks/0022_admin_stats.down.sql", () => {
  const raw = exists(DOWN_REL) ? read(DOWN_REL) : "";
  const code = compact(stripComments(raw, DOWN_REL));

  test("rollbacks/ 에 있고 migrations/ 에는 롤백 파일이 없다", () => {
    expect(raw.length).toBeGreaterThan(0);
    expect(exists("supabase/migrations/0022_admin_stats.down.sql")).toBe(false);
  });

  test("함수 하나만 시그니처까지 적어 지운다 — 표·권한·데이터는 건드리지 않는다", () => {
    expect(code).toContain("drop function if exists public.admin_stats(date, date)");
    expect(code).not.toMatch(/\bgrant\b/);
    expect(code).not.toMatch(/\brevoke\b/);
    expect(code).not.toMatch(/\balter table\b/);
    expect(code).not.toMatch(/\bdrop table\b/);
    expect(code).not.toMatch(/\bdelete from\b/);
  });

  test("승인 플래그를 요구하지 않는다 — 판단 근거를 헤더에 적는다 (0015~0020 기준)", () => {
    expect(code).not.toMatch(/rollback_0022_ack/);
    expect(raw).toMatch(/승인 플래그/);
    expect(raw).toContain("supabase migration repair --status reverted 0022");
  });
});

// =============================================================================
// 3. lib/admin/stats.ts — 순수 함수 (기간 계산은 DB 없이 단언한다)
// =============================================================================
describe("3. lib/admin/stats.ts — 기간 계산과 계약", () => {
  test("기간 선택지는 넷이고 기본은 이번 달", async () => {
    const m = await import("@/lib/admin/stats");
    expect([...m.STATS_PERIODS]).toEqual(["thisMonth", "lastMonth", "last3Months", "last12Months"]);
    expect(m.parseStatsPeriod(undefined)).toBe("thisMonth");
    expect(m.parseStatsPeriod("nope")).toBe("thisMonth");
    expect(m.parseStatsPeriod("lastMonth")).toBe("lastMonth");
    expect(m.parseStatsPeriod("last12Months")).toBe("last12Months");
  });

  test("statsRange — 이번 달 · 지난 달(윤년 포함) · 최근 3개월 · 최근 12개월", async () => {
    const { statsRange } = await import("@/lib/admin/stats");
    expect(statsRange("thisMonth", "2026-09-23")).toEqual({ from: "2026-09-01", to: "2026-09-23" });
    expect(statsRange("lastMonth", "2026-03-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(statsRange("lastMonth", "2028-03-15")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(statsRange("lastMonth", "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(statsRange("last3Months", "2026-09-23")).toEqual({ from: "2026-07-01", to: "2026-09-23" });
    expect(statsRange("last12Months", "2026-09-23")).toEqual({ from: "2025-10-01", to: "2026-09-23" });
    expect(statsRange("last12Months", "2026-01-01")).toEqual({ from: "2025-02-01", to: "2026-01-01" });
  });

  test("🔴 R2-C 어떤 날을 골라도 365일을 넘지 않는다 — 파기 경계(보유 365일)를 넘으면 확정률이 부풀어 보인다", async () => {
    const { MAX_RANGE_DAYS, STATS_PERIODS, statsRange } = await import("@/lib/admin/stats");
    const { PRIVACY_NOTICE } = await import("@/lib/legal/disclosures");
    expect(MAX_RANGE_DAYS).toBe(PRIVACY_NOTICE.retentionDays);
    const days = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000 + 1;
    // 모든 달의 **모든 날**을 돈다 — astra 가 짚은 경로는 2028-02-29 처럼 드문 날짜다.
    for (let y = 2026; y <= 2032; y++) {
      for (let mo = 1; mo <= 12; mo++) {
        for (let d = 1; d <= 31; d++) {
          const today = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          if (new Date(`${today}T00:00:00Z`).getUTCDate() !== d) continue; // 존재하지 않는 날짜는 건너뛴다
          for (const p of STATS_PERIODS) {
            const r = statsRange(p, today);
            expect(days(r.from, r.to), `${p}@${today}`).toBeGreaterThan(0);
            expect(days(r.from, r.to), `${p}@${today}`).toBeLessThanOrEqual(MAX_RANGE_DAYS);
          }
        }
      }
    }
    // astra 가 짚은 정확한 날: 옛 판은 2027-03-01 ~ 2028-02-29 = 366일이었다
    expect(days(statsRange("last12Months", "2028-02-29").from, "2028-02-29")).toBe(365);
  });

  test("🔴 R2-C 파기 경계 경고 — 조회 시작이 보유기간 끝에 가까우면 확정률에 주의를 붙인다", async () => {
    const { PURGE_WARN_MARGIN_DAYS, isNearPurgeBoundary, statsRange } = await import("@/lib/admin/stats");
    const { PRIVACY_NOTICE } = await import("@/lib/legal/disclosures");
    const today = "2026-09-23";
    expect(PURGE_WARN_MARGIN_DAYS).toBeGreaterThan(0);
    expect(isNearPurgeBoundary(statsRange("thisMonth", today), today), "이번 달은 경고하지 않는다").toBe(false);
    expect(isNearPurgeBoundary(statsRange("lastMonth", today), today), "지난 달은 경고하지 않는다").toBe(false);
    expect(isNearPurgeBoundary(statsRange("last3Months", today), today), "최근 3개월은 경고하지 않는다").toBe(false);
    expect(isNearPurgeBoundary(statsRange("last12Months", today), today), "최근 12개월은 경고한다").toBe(true);
    // 경계 바로 안/밖
    const edge = PRIVACY_NOTICE.retentionDays - PURGE_WARN_MARGIN_DAYS;
    const minus = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
    expect(isNearPurgeBoundary({ from: minus(edge - 1), to: today }, today)).toBe(false);
    expect(isNearPurgeBoundary({ from: minus(edge + 1), to: today }, today)).toBe(true);
    // 전부 파기된 옛 구간(짧아도) 도 경고한다 — 길이가 아니라 **시작일의 나이**로 본다
    expect(isNearPurgeBoundary({ from: "2020-01-01", to: "2020-03-31" }, today)).toBe(true);
  });

  test("🔴 R2-E 나눗셈 — 분모 0 을 실제로 넣어 본다 (파일 어딘가의 Math.max 를 세지 않는다)", async () => {
    const { barWidthPercent, visibleMax } = await import("@/lib/admin/stats");
    expect(visibleMax([]), "빈 축의 분모는 1 이다").toBe(1);
    expect(visibleMax([{ count: null }, { count: null }]), "전부 가려진 축의 분모도 1 이다").toBe(1);
    expect(visibleMax([{ count: 0 }]), "0 건짜리 칸만 있어도 분모는 1 이다").toBe(1);
    expect(visibleMax([{ count: 2 }, { count: 7 }, { count: null }])).toBe(7);
    for (const max of [0, -1, Number.NaN]) {
      const w = barWidthPercent(5, max);
      expect(Number.isFinite(w), `max=${max} 에서 폭이 유한하지 않다`).toBe(true);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(100);
    }
    expect(barWidthPercent(null, 10), "가려진 칸은 폭 0").toBe(0);
    expect(barWidthPercent(0, 10)).toBe(0);
    expect(barWidthPercent(5, 10)).toBe(50);
    expect(barWidthPercent(20, 10), "분자가 분모보다 커도 100 을 넘지 않는다").toBe(100);
  });

  test("🔴 R2-E 화면 상태 — denied·empty·ready 를 실제 값으로 가른다 (번역 호출 존재가 아니라)", async () => {
    const { statsViewState } = await import("@/lib/admin/stats");
    expect(statsViewState(null)).toBe("denied");
    expect(statsViewState({ intake: { total: 0 } } as never)).toBe("empty");
    expect(statsViewState({ intake: { total: 1 } } as never)).toBe("ready");
  });

  test("상수 — 경로 · RPC 이름 · 숨김 기준 · 리드타임 버킷", async () => {
    const m = await import("@/lib/admin/stats");
    expect(m.ADMIN_STATS_PATH).toBe("/admin/stats");
    expect(m.ADMIN_STATS_RPC).toBe("admin_stats");
    expect(m.MIN_VISIBLE_COUNT).toBe(3);
    expect([...m.LEAD_BUCKETS]).toEqual(["d0_7", "d8_30", "d31_90", "d91_plus"]);
    expect([...m.ADMIN_STATS_KEYS].sort()).toEqual([...TOP_KEYS]);
  });

  test("서비스 롤을 쓰지 않는다 (ADR-2) · 캐시하지 않는다 (ADR-3)", () => {
    // 주석은 뺀다 — 헤더가 "unstable_cache 로 감싸지 않는다" 라고 규약을 설명한다(P6-7 규약: 판정은 코드에만).
    const src = stripComments(read(LIB_REL), LIB_REL);
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE_KEY|supabase\/server/);
    expect(src).not.toMatch(/unstable_cache/);
    expect(src).toMatch(/createSsrClient/);
    // 가드 판정은 함수 이름이 **정확히 같을 때만** 참이다(lib/admin/adminRpc.ts) — 이름은 ADMIN_STATS_RPC 한 곳에서 온다.
    expect(src).toMatch(/isAdminGuardDenial\(\s*error\s*,\s*ADMIN_STATS_RPC\s*\)/);
  });
});

// =============================================================================
// 4. 화면 · 탭 · 문구
// =============================================================================
describe("4. /admin/stats 화면 · 탭 · messages/ko.json", () => {
  test("탭에 통계가 **맨 뒤에** 붙었고 기존 순서·경로는 그대로다", async () => {
    const { ADMIN_TABS, ADMIN_TAB_KEYS } = await import("@/components/admin/tabs");
    expect([...ADMIN_TAB_KEYS]).toEqual(["reservations", "popups", "notices", "gallery", "routes", "notifications", "stats"]);
    expect(ADMIN_TABS.filter((t) => t.ready).map((t) => t.href)).toEqual([
      "/admin/reservations",
      "/admin/popups",
      "/admin/notices",
      "/admin/gallery",
      "/admin/routes",
      "/admin/notifications",
      "/admin/stats",
    ]);
    expect(read(TABS_REL)).toContain("/admin/stats");
  });

  test("경로 상수가 실제 라우트와 같다", async () => {
    const { ADMIN_STATS_PATH } = await import("@/lib/admin/stats");
    expect(exists(`app/admin/(protected)${ADMIN_STATS_PATH.replace("/admin", "")}/page.tsx`)).toBe(true);
  });

  test("화면 첫 문장이 requireAdmin() 이고 세션 클라이언트 경로만 쓴다", () => {
    const src = stripComments(read(PAGE_REL), PAGE_REL);
    expect(src).toMatch(/export default async function \w+\([\s\S]*?\)\s*\{\s*await requireAdmin\(\);/);
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE_KEY|supabase\/server/);
  });

  test("차트 라이브러리를 쓰지 않는다 — import 는 next·react·저장소 경로뿐", () => {
    const src = stripComments(read(PAGE_REL), PAGE_REL);
    const specs = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) {
      expect(/^(next(\/.*)?|react(\/.*)?|next-intl(\/.*)?|@\/.*)$/.test(s), `허용되지 않은 import: ${s}`).toBe(true);
    }
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    for (const bad of ["recharts", "chart.js", "d3", "victory", "apexcharts", "echarts", "nivo"]) {
      expect(Object.keys(pkg.dependencies).some((d) => d.includes(bad)), bad).toBe(false);
    }
  });

  test("🔴 R2-E 화면은 스스로 나누지 않는다 — 폭·상태를 lib 의 검증된 함수에 맡긴다", () => {
    const src = stripComments(read(PAGE_REL), PAGE_REL);
    // 상태 분기와 막대 폭은 lib/admin/stats.ts 의 순수 함수가 정한다(위 §3 이 값으로 단언한다).
    expect(src).toMatch(/statsViewState\(/);
    expect(src).toMatch(/barWidthPercent\(/);
    expect(src).toMatch(/visibleMax\(/);
    expect(src).toMatch(/t\("empty"\)/);
    expect(src).toMatch(/t\("denied"\)/);
    // 화면 코드에 산술 나눗셈이 **한 건도** 없어야 한다.
    // 🔴 템플릿 리터럴을 통째로 지우면 그 안의 `${…}` 식(= 실행되는 코드)까지 사라져 나눗셈이 0건으로 보인다(astra P2).
    //    그래서 리터럴 글자만 지우고 **`${…}` 안은 남긴다**. 아래 "이빨" 테스트가 그 우회를 실제로 재현해 잡는지 본다.
    const hits = divisionsIn(src);
    expect(hits, `화면에 나눗셈이 남았다 — lib 의 검증된 함수로 옮기세요: ${hits.join(" | ")}`).toEqual([]);
  });

  test("🔴 R3-D 나눗셈 탐지기에 이빨이 있다 — astra 의 우회(`${…}` 안의 나눗셈)를 실제로 잡는다", () => {
    // 옛 판은 템플릿을 통째로 지워 이 세 줄을 전부 0건으로 읽었다.
    expect(divisionsIn('const w = `${(value ?? 0) / max}%`;').length, "템플릿 안의 나눗셈").toBeGreaterThan(0);
    expect(divisionsIn("const h = `${p.total * 100 / peak}%`;").length, "템플릿 안의 나눗셈(곱셈 섞임)").toBeGreaterThan(0);
    expect(divisionsIn("const r = a / b;").length, "평범한 나눗셈").toBeGreaterThan(0);
    // 오탐은 없어야 한다 — 경로·클래스 이름·JSX 닫는 태그·주석 기호
    expect(divisionsIn('import x from "@/lib/admin/stats";'), "import 경로").toEqual([]);
    expect(divisionsIn("const c = `${a.badge} ${a.segBadge}`;"), "클래스 조합 템플릿").toEqual([]);
    expect(divisionsIn("const el = <div><span>x</span></div>;"), "JSX 닫는 태그").toEqual([]);
    expect(divisionsIn('const u = `/admin/stats?period=${p}`;'), "템플릿 안의 경로 글자").toEqual([]);
  });

  test("색은 역할 토큰만 쓴다 — admin.module.css 의 모든 var() 가 semantic.css 에 정의돼 있다 (CLAUDE.md §4)", () => {
    const css = read(CSS_REL);
    const semantic = read(SEMANTIC_REL);
    const declared = new Set([...semantic.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    const raw = [...used].filter((v) => !declared.has(v));
    expect(raw, `semantic.css 에 없는 원시 토큰: ${raw.join(", ")}`).toEqual([]);
    expect(used.size).toBeGreaterThan(10);
  });

  test("통계 막대 스타일이 생겼다 (인라인 SVG·CSS 막대 — 라이브러리 없음)", () => {
    const css = read(CSS_REL);
    for (const cls of [".statGrid", ".statCard", ".statValue", ".statNote", ".barTrack", ".barFill", ".trendChart"]) {
      expect(css, cls).toContain(cls);
    }
  });

  test("messages/ko.json — admin.stats.* 가 있고 en.json 에는 admin 이 없다", () => {
    const ko = JSON.parse(read("messages/ko.json")) as { admin: Record<string, Record<string, unknown>> };
    const en = JSON.parse(read("messages/en.json")) as Record<string, unknown>;
    expect(en).not.toHaveProperty("admin");
    expect(ko.admin.tabs.stats).toBe("통계");

    const s = ko.admin.stats as Record<string, unknown>;
    for (const k of ["title", "sub", "periodLabel", "rangeNote", "empty", "denied", "suppressed", "suppressedNote", "other", "unit"]) {
      expect(s[k], `admin.stats.${k}`).toBeTruthy();
    }
    const group = (name: string) => s[name] as Record<string, unknown>;
    for (const k of ["thisMonth", "lastMonth", "last3Months", "last12Months"]) {
      expect(group("period")[k], `admin.stats.period.${k}`).toBeTruthy();
    }
    for (const k of ["title", "intake", "intakeNote", "confirmed", "confirmedNote", "response", "responseNote", "responseFew"]) {
      expect(group("overview")[k], `admin.stats.overview.${k}`).toBeTruthy();
    }
    for (const k of ["title", "backlog", "backlogNote", "backlogLink", "notify", "notifyNote", "notifyLink", "ok"]) {
      expect(group("attention")[k], `admin.stats.attention.${k}`).toBeTruthy();
    }
    for (const k of ["title", "note", "waiting", "confirmed", "cancelled", "unsplit", "unsplitNote"]) {
      expect(group("trend")[k], `admin.stats.trend.${k}`).toBeTruthy();
    }
    for (const k of ["axisTotalNote", "suppressedLimit"]) expect(s[k], `admin.stats.${k}`).toBeTruthy();
    expect(group("overview").purgeWarning, "admin.stats.overview.purgeWarning").toBeTruthy();
    for (const k of ["title", "purposes", "purposesNote", "vehicles", "vehiclesNote", "segments", "segmentsNote", "showcase", "buses"]) {
      expect(group("inquiry")[k], `admin.stats.inquiry.${k}`).toBeTruthy();
    }
    for (const k of ["title", "note", "d0_7", "d8_30", "d31_90", "d91_plus"]) {
      expect(group("lead")[k], `admin.stats.lead.${k}`).toBeTruthy();
    }
    for (const k of ["title", "note", "link", "unset"]) {
      expect(group("visits")[k], `admin.stats.visits.${k}`).toBeTruthy();
    }
  });

  test("여행 구분 라벨은 위저드의 카탈로그를 그대로 쓴다 — 네임스페이스 경로가 실제로 있고 코드 10개가 다 있다", async () => {
    // 실측에서 한 번 틀렸다: `quote.purpose.options` 로 적었더니 렌더가 MISSING_MESSAGE 로 터졌다(실제 경로는 steps 가 한 단계 더 있다).
    // 화면 소스의 경로 문자열과 ko.json 의 실제 경로를 함께 본다 — 둘 중 하나만 보면 같은 실수가 다시 지나간다.
    const src = stripComments(read(PAGE_REL), PAGE_REL);
    const ns = /namespace:\s*"([^"]+)"/g;
    const namespaces = [...src.matchAll(ns)].map((m) => m[1]);
    expect(namespaces).toContain("quote.steps.purpose.options");
    const ko = JSON.parse(read("messages/ko.json")) as Record<string, unknown>;
    for (const path of namespaces) {
      const node = path.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], ko);
      expect(node, `messages/ko.json 에 ${path} 가 없다`).toBeTruthy();
    }
    const { PURPOSES } = await import("@/lib/codes");
    const options = "quote.steps.purpose.options".split(".").reduce<Record<string, string>>(
      (acc, k) => acc[k] as unknown as Record<string, string>,
      ko as unknown as Record<string, string>,
    );
    for (const code of PURPOSES) expect(options[code], `라벨 없음: ${code}`).toBeTruthy();
  });

  test("제목·부제 — '전화로 받은 예약은 포함되지 않는다' 를 말한다", () => {
    // 금지어·실증 불가 주장 검사는 여기서 다시 하지 않는다: tests/copy-rules.test.ts §2 가 **ko.json 전 네임스페이스**
    // (admin 포함)를 lib/copy/rules.ts 의 목록으로 훑는다. 여기에 목록을 다시 적으면 두 벌이 되고,
    // 그 리터럴 자체가 scripts/check-legal-disclosures.sh 의 금지어 검사(tests 도 대상이다)에 걸린다.
    const ko = JSON.parse(read("messages/ko.json")) as { admin: { stats: Record<string, string> } };
    expect(ko.admin.stats.title).toBe("홈페이지 견적 접수 통계");
    expect(ko.admin.stats.sub).toContain("전화");
    expect(ko.admin.stats.suppressed).toBe("3건 미만");
    // R2-D — 숨김을 "개인이 특정되지 않는다" 는 보장처럼 말하지 않는다. 캡처 공유용이고 한계를 함께 적는다.
    const all = JSON.stringify(ko.admin.stats);
    expect(all, "보장처럼 읽히는 문구").not.toMatch(/특정되지 않습니다|익명(으로)? 처리됩니다|알 수 없습니다/);
    expect(ko.admin.stats.suppressedLimit).toMatch(/기간/);
    expect(ko.admin.stats.axisTotalNote, "축 합계가 총건수와 다를 수 있다는 안내").toBeTruthy();
  });

  test("추적 코드를 넣지 않았다 — 방문 통계는 링크 카드 하나뿐", async () => {
    const src = read(PAGE_REL);
    expect(src).not.toMatch(/@vercel\/analytics|<Analytics|inject\(/);
    // 관리자 경로에는 process.env 분기를 둘 수 없다(scripts/check-admin-gate.mjs) — env 는 이 모듈이 읽는다.
    expect(src).toMatch(/vercelAnalyticsUrl/);
    expect(read("lib/analytics/dashboard.ts")).toMatch(/VERCEL_ANALYTICS_URL/);
    const { vercelAnalyticsUrl } = await import("@/lib/analytics/dashboard");
    const before = process.env.VERCEL_ANALYTICS_URL;
    try {
      delete process.env.VERCEL_ANALYTICS_URL;
      expect(vercelAnalyticsUrl()).toBeNull();
      process.env.VERCEL_ANALYTICS_URL = "   ";
      expect(vercelAnalyticsUrl()).toBeNull();
      process.env.VERCEL_ANALYTICS_URL = "javascript:alert(1)";
      expect(vercelAnalyticsUrl(), "https 가 아닌 값은 링크로 쓰지 않는다").toBeNull();
      process.env.VERCEL_ANALYTICS_URL = "https://vercel.com/acme/bestour/analytics";
      expect(vercelAnalyticsUrl()).toBe("https://vercel.com/acme/bestour/analytics");
    } finally {
      if (before === undefined) delete process.env.VERCEL_ANALYTICS_URL;
      else process.env.VERCEL_ANALYTICS_URL = before;
    }
  });

  test("런북에 0022 절이 생겼다", () => {
    const rb = read(RUNBOOK_REL);
    expect(rb).toMatch(/^## 0022 /m);
    expect(rb).toContain("admin_stats");
  });
});

// =============================================================================
// 4-a. 발송 문제 보정 (P4-7 수정 라운드 3 · 리뷰 P1-B·P2-8) — 마이그레이션 없이 앱에서
// =============================================================================
/**
 * 0022 의 ⑤ 는 `status` 만 본다: 격리 행(보냈지만 기록 못 함 — pending)을 "1시간 넘게 보내지 못하고 있는 건" 으로,
 * 중복 억제된 알림 행(`failed/duplicate_sent` — 메일은 한 통 도착)을 "발송 실패" 로 센다. 둘 다 사장님 화면에 틀린 말이다.
 * 0022 를 고치려면 600줄 함수를 통째로 다시 정의하는 0023 이 필요해(원격 적용 두 번) **앱에서 보정**한다:
 * 같은 창(0022 가 돌려준 window_days·stuck_hours 를 그대로 쓴다 — 상수를 두 벌 두지 않는다)으로 세 가지를 따로 세어 빼고,
 * 격리 행은 "발송됨 · 기록 확인 필요" 로 따로 보여 준다.
 */
describe("4-a. 발송 문제 보정 — 격리 행·중복 억제 행", () => {
  test("notifyAttention — 실패에서 중복 억제를, 멈춘 대기에서 격리 행을 빼고 격리 행은 따로 · 음수는 0 으로", async () => {
    const { notifyAttention } = await import("@/lib/admin/stats");
    const n = { failed: 3, stuck: 2, window_days: 7, stuck_hours: 1 };
    expect(notifyAttention(n, { sentUnconfirmed: 2, sentUnconfirmedStuck: 1, suppressedDuplicates: 1 })).toEqual({
      failed: 2,
      stuck: 1,
      sentUnconfirmed: 2,
      ok: false,
    });
    // 두 쿼리가 다른 순간에 돌아 보정치가 더 커도 음수로 내려가지 않는다
    expect(notifyAttention({ ...n, failed: 0, stuck: 0 }, { sentUnconfirmed: 0, sentUnconfirmedStuck: 1, suppressedDuplicates: 1 })).toEqual({
      failed: 0,
      stuck: 0,
      sentUnconfirmed: 0,
      ok: true,
    });
    // 격리 행만 있으면 ok 가 아니다 — "이상 없음" 으로 덮지 않는다
    expect(notifyAttention({ ...n, failed: 0, stuck: 1 }, { sentUnconfirmed: 1, sentUnconfirmedStuck: 1, suppressedDuplicates: 0 })).toMatchObject({
      failed: 0,
      stuck: 0,
      sentUnconfirmed: 1,
      ok: false,
    });
  });

  test("getNotifyCorrections — 0022 가 준 창으로 head 집계 세 번(개인정보 0) · 조건 모양", async () => {
    const { getNotifyCorrections } = await import("@/lib/admin/stats");
    const calls: { q: number; method: string; args: unknown[] }[] = [];
    const counts = [4, 1, 2];
    let q = -1;
    const client = {
      from(table: string) {
        q += 1;
        const idx = q;
        expect(table).toBe("notifications_log");
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "like", "gte", "lt"]) {
          chain[m] = (...args: unknown[]) => {
            calls.push({ q: idx, method: m, args });
            return chain;
          };
        }
        chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ count: counts[idx], error: null }).then(ok);
        return chain;
      },
    };
    const now = new Date("2026-09-26T03:00:00.000Z");
    const got = await getNotifyCorrections({ window_days: 7, stuck_hours: 1 }, now, client as never);
    expect(got).toEqual({ sentUnconfirmed: 4, sentUnconfirmedStuck: 1, suppressedDuplicates: 2 });
    const of = (i: number) => calls.filter((c) => c.q === i).map((c) => [c.method, ...c.args]);
    const since = "2026-09-19T03:00:00.000Z";
    expect(of(0)).toEqual([
      ["select", "id", { count: "exact", head: true }],
      ["eq", "status", "pending"],
      ["like", "last_error", "sent_unmarked:%"],
      ["gte", "created_at", since],
    ]);
    expect(of(1)).toEqual([
      ["select", "id", { count: "exact", head: true }],
      ["eq", "status", "pending"],
      ["like", "last_error", "sent_unmarked:%"],
      ["gte", "created_at", since],
      ["lt", "created_at", "2026-09-26T02:00:00.000Z"],
    ]);
    expect(of(2)).toEqual([
      ["select", "id", { count: "exact", head: true }],
      ["eq", "status", "failed"],
      ["eq", "last_error", "duplicate_sent"],
      ["gte", "created_at", since],
    ]);
  });

  test("getNotifyCorrections — count 가 오지 않거나 오류면 0 으로 갈음하지 않고 throw", async () => {
    const { getNotifyCorrections } = await import("@/lib/admin/stats");
    const mk = (res: { count: number | null; error: { code?: string; message: string } | null }) => ({
      from() {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "like", "gte", "lt"]) chain[m] = () => chain;
        chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
        return chain;
      },
    });
    await expect(getNotifyCorrections({ window_days: 7, stuck_hours: 1 }, new Date(), mk({ count: null, error: null }) as never)).rejects.toThrow();
    await expect(
      getNotifyCorrections({ window_days: 7, stuck_hours: 1 }, new Date(), mk({ count: null, error: { code: "42501", message: "denied" } }) as never),
    ).rejects.toThrow(/42501/);
  });
});

// =============================================================================
// 4-b. 화면을 **실제로 렌더**해서 분기를 본다 (수정 라운드 3 · astra P2)
// =============================================================================
/**
 * 옛 판은 "화면 소스에 `t("empty")` 호출이 있다" 만 봤다 — 분기를 `view === "ready"` 로 뒤집어도 통과했다.
 * 여기서는 서버 컴포넌트를 **실제로 호출**해 돌아온 React 트리를 훑는다(DOM 없이 element 트리만 본다).
 * `getAdminStats` 만 갈아끼우고 나머지(순수 함수·상태 판정)는 진짜를 쓴다.
 */
const MOCKED_FOR_RENDER = ["@/lib/auth/requireAdmin", "next-intl/server", "@/lib/queries/vehicles", "@/lib/analytics/dashboard", "@/lib/admin/stats"];

interface RenderWalk {
  testids: string[];
  components: string[];
  /** Attention 에 넘긴 보정된 발송 문제 값(P4-7 수정 라운드 3). */
  attentionNotify?: unknown;
  /** Attention 을 그 props 로 한 번 호출해 돌려준다(트리 걷기는 함수 컴포넌트를 펼치지 않는다). */
  renderAttention?: () => unknown;
}

function walkTree(node: unknown, out: RenderWalk): void {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return;
  if (Array.isArray(node)) {
    for (const child of node) walkTree(child, out);
    return;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (typeof el.type === "function") {
    const name = (el.type as { name?: string }).name ?? "(anonymous)";
    out.components.push(name);
    if (name === "Attention" && el.props) {
      const fn = el.type as (p: Record<string, unknown>) => unknown;
      const props = el.props;
      out.attentionNotify = props.notify;
      out.renderAttention = () => fn(props);
    }
  }
  if (el.props && typeof el.props === "object") {
    const tid = el.props["data-testid"];
    if (typeof tid === "string") out.testids.push(tid);
    walkTree(el.props.children, out);
  }
}

const NO_CORRECTIONS = { sentUnconfirmed: 0, sentUnconfirmedStuck: 0, suppressedDuplicates: 0 };
/** 렌더 한 번 동안 불린 순서 — "stats"(0022) 와 getNotifyCorrections 에 넘긴 창. */
const correctionCalls: unknown[] = [];

async function renderStatsPage(stats: unknown, corrections: typeof NO_CORRECTIONS = NO_CORRECTIONS): Promise<RenderWalk> {
  vi.resetModules();
  vi.doMock("@/lib/auth/requireAdmin", () => ({ requireAdmin: async () => ({ userId: "u", email: "a@example.test" }) }));
  vi.doMock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
  vi.doMock("@/lib/queries/vehicles", () => ({ getVehicles: async () => [] }));
  vi.doMock("@/lib/analytics/dashboard", () => ({ vercelAnalyticsUrl: () => null }));
  vi.doMock("@/lib/admin/stats", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("@/lib/admin/stats");
    return {
      ...actual,
      getAdminStats: async () => {
        correctionCalls.push("stats");
        return stats;
      },
      getNotifyCorrections: async (window: unknown) => {
        correctionCalls.push(window);
        return corrections;
      },
    };
  });
  const page = (await import("@/app/admin/(protected)/stats/page")) as {
    default: (p: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
  };
  const tree = await page.default({ searchParams: Promise.resolve({}) });
  const out: RenderWalk = { testids: [], components: [] };
  walkTree(tree, out);
  return out;
}

/** 지표는 전부 0 이고 키 집합은 계약대로인 최소 결과. `total` 만 바꿔 분기를 고른다. */
function emptyStats(total: number): Record<string, unknown> {
  return {
    range: { from: "2026-09-01", to: "2026-09-23", days: 23, bucket: "day", prev_from: null, prev_to: null, has_prev: false },
    intake: { total, prev_total: null, delta: null },
    confirmation: { total, confirmed: 0, rate_pct: total > 0 ? 0 : null, pending: 0 },
    response_time: { sample: 0, median_minutes: null, enough: false },
    backlog: { new_total: 0, over_72h: 0, hours: 72 },
    notifications: { failed: 0, stuck: 0, window_days: 7, stuck_hours: 1 },
    trend: [{ bucket: "2026-09-01", total, split: true, waiting: total, confirmed: 0, cancelled: 0 }],
    purposes: total > 0 ? [{ code: "family", count: total, suppressed: false, other: false }] : [],
    vehicles: total > 0 ? [{ slug: "bus45", count: total, buses: total, suppressed: false, other: false }] : [],
    segments: total > 0 ? [{ origin: "SEL", destination: "BSN", count: total, showcase: true, suppressed: false, other: false }] : [],
    lead_time: total > 0 ? [{ bucket: "d0_7", count: total, suppressed: false, other: false }] : [],
  };
}

describe("4-b. 화면 분기 — 실제 렌더로 확인 (번역 호출 존재가 아니라)", () => {
  afterAll(() => {
    for (const m of MOCKED_FOR_RENDER) vi.doUnmock(m);
    vi.resetModules();
  });

  test("가드가 막으면(null) '권한 없음' 만 그린다 — 빈 상태도 본문도 그리지 않는다", async () => {
    const r = await renderStatsPage(null);
    expect(r.testids).toContain("admin-stats-denied");
    expect(r.testids).not.toContain("admin-stats-empty");
    expect(r.components, "거부 상태에서 요약 카드를 그리면 안 된다").not.toContain("Overview");
  });

  test("0건이면 빈 상태를 그리고, 머리 숫자·지금 확인할 것은 그대로 그린다(기간과 무관한 지표다)", async () => {
    const r = await renderStatsPage(emptyStats(0));
    expect(r.testids).toContain("admin-stats-empty");
    expect(r.testids).not.toContain("admin-stats-denied");
    expect(r.components).toContain("Overview");
    expect(r.components).toContain("Attention");
    expect(r.components, "0건인데 추이를 그리면 안 된다").not.toContain("Trend");
  });

  test("격리 행이 있으면 '발송됨 · 기록 확인 필요' 줄을 그리고, 그것만으로 '보내지 못한 건' 을 말하지 않는다 (P4-7 수정 라운드 3)", async () => {
    const s = emptyStats(3) as { notifications: Record<string, number> };
    s.notifications = { failed: 1, stuck: 1, window_days: 7, stuck_hours: 1 };
    const r = await renderStatsPage(s, { sentUnconfirmed: 1, sentUnconfirmedStuck: 1, suppressedDuplicates: 1 });
    // 페이지는 보정된 값을 Attention 에 넘긴다 — 0022 의 failed 1 · stuck 1 은 각각 중복 억제·격리 행이었다
    expect(r.attentionNotify).toEqual({ failed: 0, stuck: 0, sentUnconfirmed: 1, ok: false });
    // Attention 을 실제로 그려 줄을 확인한다(트리 걷기는 함수 컴포넌트를 펼치지 않으므로 여기서 한 번 호출한다)
    const drawn: RenderWalk = { testids: [], components: [] };
    walkTree(r.renderAttention?.(), drawn);
    expect(drawn.testids).toContain("admin-stats-notify-sent-unconfirmed");
    expect(drawn.testids).not.toContain("admin-stats-notify-failed");
    expect(drawn.testids).not.toContain("admin-stats-notify-stuck");
    const clean = await renderStatsPage(emptyStats(3));
    expect(clean.attentionNotify).toEqual({ failed: 0, stuck: 0, sentUnconfirmed: 0, ok: true });
  });

  // P4-7b · 재검토 P2-R3-2 — 0022 와 보정을 **동시에** 보내고, 창이 같으면 다시 세지 않는다
  test("보정 집계는 0022 와 동시에 한 번(NOTIFY_WINDOW) — 0022 가 준 창이 다르면 그 창으로 한 번 더 센다", async () => {
    const { NOTIFY_WINDOW } = await import("@/lib/admin/stats");
    correctionCalls.length = 0;
    await renderStatsPage(emptyStats(3));
    expect(correctionCalls).toHaveLength(2);
    expect(correctionCalls).toContain("stats");
    expect(correctionCalls).toContainEqual(NOTIFY_WINDOW);

    correctionCalls.length = 0;
    const odd = emptyStats(3) as { notifications: Record<string, number> };
    odd.notifications = { failed: 0, stuck: 0, window_days: 14, stuck_hours: 2 };
    await renderStatsPage(odd);
    expect(correctionCalls).toEqual(expect.arrayContaining(["stats", NOTIFY_WINDOW, { failed: 0, stuck: 0, window_days: 14, stuck_hours: 2 }]));
    expect(correctionCalls).toHaveLength(3);
  });

  test("NOTIFY_WINDOW 는 0022 의 c_notify_days · c_notify_stuck_h 와 같다(동시 조회의 전제)", async () => {
    const { NOTIFY_WINDOW } = await import("@/lib/admin/stats");
    const sql = read(UP_REL);
    expect(sql).toMatch(new RegExp(`c_notify_days\\s+constant int := ${NOTIFY_WINDOW.window_days};`));
    expect(sql).toMatch(new RegExp(`c_notify_stuck_h\\s+constant int := ${NOTIFY_WINDOW.stuck_hours};`));
  });

  test("1건 이상이면 빈 상태도 거부도 없고 추이를 그린다", async () => {
    const r = await renderStatsPage(emptyStats(3));
    expect(r.testids).not.toContain("admin-stats-empty");
    expect(r.testids).not.toContain("admin-stats-denied");
    expect(r.testids).toContain("admin-stats");
    expect(r.components).toContain("Trend");
  });
});

// =============================================================================
// 5. DB — 로컬 스택 + REQUIRE_DB_TESTS=1
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) console.warn(`[admin-stats.test] DB 블록 skip — ${gate.reason}`);

/** 배타적인 미래 창 — 다른 테스트 파일의 픽스처가 절대 들어오지 않는다(파일 머리 주석). */
const WIN_FROM = "2031-03-01";
const WIN_TO = "2031-03-31";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface Fixture {
  tag: string;
  /** KST 벽시계 — `+09:00` 을 붙여 인스턴트로 보낸다. UTC 로 잘랐다면 틀리는 값이 여기 들어 있다. */
  createdKst: string;
  status: "new" | "confirmed" | "done" | "cancelled";
  /** 확정까지 걸린 시간(시간 단위). null 이면 확정된 적 없음. */
  confirmAfterHours: number | null;
  purpose: string;
  vehicle: string;
  buses: number;
  origin: string;
  destination: string;
  /** 운행일(KST 달력 날짜) — 리드타임 계산의 뒤쪽. */
  departKstDate: string;
}

/**
 * 창 안 10건 — 분해표의 기대값이 여기서 곧장 나온다. **astra P1 재현 배치**(수정 라운드 2):
 *   리드타임   7일 이내 3 · 8~30일 3 · 31~90일 3 · 91일 이상 1
 *              → 가려질 칸이 하나뿐(1건)이라 **보완 숨김**이 보이는 칸 하나를 더 가린다(0022 §⑦⑧⑨⑩ 공통 규칙).
 *                그러지 않으면 `10 − (3+3+3) = 1` 로 **건수와 칸 이름이 함께** 복원된다.
 *   여행 구분  family 4 · airport_pickup 3 · workshop 1 · univ_mt 2  → 가려질 칸이 둘 → 기타 3(보임)
 *   차량       bus45 5(버스 6대) · limo28 3(3대) · bus16 1 · bus25 1 → 가려질 칸이 **둘** → 기타 2 → 기타마저 3건 미만이라 **건수·대수 둘 다 가려진다**
 *              (수정 라운드 3 — astra P2: 전까지는 주 픽스처에 `suppressed: true` 행이 하나도 없어 D-9 의 null 단언이 0번 돌았다)
 *   구간       SEL→BSN 4(대표 노선) · INC→GWJ 3 · SEL→INC 2 · GWJ→BSN 1 → 가려질 칸이 둘 → 기타 3(보임)
 *   추이       03-05 에 3건을 몰아 **상태별로 쪼개지는 버킷**을 하나 만든다. 나머지 날은 1건이라 쪼개지 않는다(R2-B).
 *   확정       5건(1·2·3·10·30시간) → 중앙값 3시간 = 180분 · 확정률 50% · 처리 전 3건
 */
const IN_WINDOW: Fixture[] = [
  { tag: "R01", createdKst: "2031-03-01T00:00:00", status: "confirmed", confirmAfterHours: 1, purpose: "family", vehicle: "bus45", buses: 1, origin: "SEL", destination: "BSN", departKstDate: "2031-03-04" },
  { tag: "R02", createdKst: "2031-03-05T09:00:00", status: "confirmed", confirmAfterHours: 2, purpose: "family", vehicle: "bus45", buses: 2, origin: "SEL", destination: "BSN", departKstDate: "2031-03-10" },
  { tag: "R03", createdKst: "2031-03-05T10:00:00", status: "confirmed", confirmAfterHours: 3, purpose: "family", vehicle: "bus45", buses: 1, origin: "SEL", destination: "BSN", departKstDate: "2031-03-11" },
  { tag: "R04", createdKst: "2031-03-05T11:00:00", status: "done", confirmAfterHours: 10, purpose: "family", vehicle: "bus45", buses: 1, origin: "SEL", destination: "BSN", departKstDate: "2031-03-20" },
  { tag: "R05", createdKst: "2031-03-12T09:00:00", status: "cancelled", confirmAfterHours: 30, purpose: "airport_pickup", vehicle: "bus45", buses: 1, origin: "INC", destination: "GWJ", departKstDate: "2031-03-30" },
  { tag: "R06", createdKst: "2031-03-15T09:00:00", status: "new", confirmAfterHours: null, purpose: "airport_pickup", vehicle: "limo28", buses: 1, origin: "INC", destination: "GWJ", departKstDate: "2031-04-10" },
  { tag: "R07", createdKst: "2031-03-18T09:00:00", status: "new", confirmAfterHours: null, purpose: "airport_pickup", vehicle: "limo28", buses: 1, origin: "INC", destination: "GWJ", departKstDate: "2031-05-01" },
  { tag: "R08", createdKst: "2031-03-20T09:00:00", status: "new", confirmAfterHours: null, purpose: "workshop", vehicle: "limo28", buses: 1, origin: "SEL", destination: "INC", departKstDate: "2031-05-20" },
  { tag: "R09", createdKst: "2031-03-25T09:00:00", status: "cancelled", confirmAfterHours: null, purpose: "univ_mt", vehicle: "bus16", buses: 1, origin: "SEL", destination: "INC", departKstDate: "2031-06-10" },
  { tag: "R10", createdKst: "2031-03-31T23:59:00", status: "cancelled", confirmAfterHours: null, purpose: "univ_mt", vehicle: "bus25", buses: 1, origin: "GWJ", destination: "BSN", departKstDate: "2031-08-01" },
];

/**
 * 창 밖 두 건 — **UTC 로 잘랐다면 결과가 달라지는** 자리에 정확히 놓았다.
 *   B1 2031-02-28 23:59:59 KST = 02-28 14:59:59Z → 창 앞(직전 기간 안이라 prev_total 을 1 로 만든다)
 *   B2 2031-04-01 00:00:00 KST = 03-31 15:00:00Z → 창 뒤. UTC 경계(< 04-01T00:00Z)로 잘랐다면 **들어온다**.
 * 창 첫 행 R01 도 같은 뜻이다: 03-01 00:00 KST = 02-28 15:00Z — UTC 경계였다면 **빠진다**.
 */
const OUT_WINDOW: Fixture[] = [
  { tag: "B01", createdKst: "2031-02-28T23:59:59", status: "new", confirmAfterHours: null, purpose: "family", vehicle: "bus45", buses: 1, origin: "SEL", destination: "BSN", departKstDate: "2031-03-20" },
  { tag: "B02", createdKst: "2031-04-01T00:00:00", status: "new", confirmAfterHours: null, purpose: "family", vehicle: "bus45", buses: 1, origin: "SEL", destination: "BSN", departKstDate: "2031-04-20" },
];

const kstInstant = (wallClock: string): string => new Date(`${wallClock}+09:00`).toISOString();

interface TrendPoint {
  bucket: string;
  split: boolean;
  waiting: number | null;
  confirmed: number | null;
  cancelled: number | null;
  total: number;
}

describe.skipIf(!gate.allowed || !env.hasServiceRole)("5. DB — admin_stats (로컬 스택)", { timeout: 180_000 }, () => {
  withNotificationsLock();

  const baseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceHeaders = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const RUN = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  const PREFIX = `P517${RUN}`;
  const PASSWORD = `p517-${randomUUID()}`;
  const emailFor = (who: string) => `p517-${RUN.toLowerCase()}-${who}@example.test`;

  type Res = { status: number; body: unknown };
  async function call(method: string, url: string, headers: Record<string, string>, json?: unknown, prefer?: string): Promise<Res> {
    const res = await fetch(url, {
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
  const rest = (method: string, pathAndQuery: string, json?: unknown, prefer?: string) =>
    call(method, `${env.restRoot}${pathAndQuery}`, serviceHeaders, json, prefer);
  const asUser = (token: string, method: string, pathAndQuery: string, json?: unknown) =>
    call(method, `${env.restRoot}${pathAndQuery}`, { apikey: env.anonKey as string, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, json);
  const asAnon = (method: string, pathAndQuery: string, json?: unknown) =>
    call(method, `${env.restRoot}${pathAndQuery}`, { apikey: env.anonKey as string, "Content-Type": "application/json" }, json);

  const statsAs = (token: string, from = WIN_FROM, to = WIN_TO) => asUser(token, "POST", "/rpc/admin_stats", { p_from: from, p_to: to });

  let adminToken = "";
  let plainToken = "";
  let adminId = "";
  let plainId = "";
  const made: string[] = [];
  let result: Record<string, unknown> = {};

  async function createUser(email: string): Promise<string> {
    const r = await call("POST", `${baseUrl()}/auth/v1/admin/users`, serviceHeaders, { email, password: PASSWORD, email_confirm: true });
    expect(r.status, `사용자 생성 실패: ${JSON.stringify(r.body).slice(0, 300)}`).toBeLessThan(300);
    return (r.body as { id: string }).id;
  }
  async function signIn(email: string): Promise<string> {
    const r = await call("POST", `${baseUrl()}/auth/v1/token?grant_type=password`, { apikey: env.anonKey as string, "Content-Type": "application/json" }, { email, password: PASSWORD });
    expect(r.status, `로그인 실패: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(200);
    return (r.body as { access_token: string }).access_token;
  }

  async function seed(f: Fixture): Promise<void> {
    const created = kstInstant(f.createdKst);
    const row: Record<string, unknown> = {
      public_code: `${PREFIX}${f.tag}`,
      created_at: created,
      status: f.status,
      name: "통계픽스처",
      phone: "+821000000000",
      vehicle_slug: f.vehicle,
      purpose_code: f.purpose,
      origin_code: f.origin,
      destination_code: f.destination,
      waypoint_codes: [],
      trip_type: "oneway",
      depart_at: kstInstant(`${f.departKstDate}T09:00:00`),
      return_at: null,
      nights: 0,
      bus_count: f.buses,
      locale: "ko",
      privacy_consent_at: created,
      privacy_policy_version: "2026-09-11",
      marketing_consent_at: null,
      // 파기 배치가 이 행을 집어가지 않도록 보관 기한을 먼 미래에 둔다(창이 미래라 접수일 기준으로는 아직 유효하다).
      retention_until: new Date(Date.parse(created) + 900 * MS_PER_DAY).toISOString(),
      withdrawal_consent_at: created,
      confirmed_at: f.confirmAfterHours === null ? null : new Date(Date.parse(created) + f.confirmAfterHours * 3_600_000).toISOString(),
    };
    const r = await rest("POST", "/reservations", row, "return=representation");
    expect(r.status, `${f.tag} 접수 실패: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(201);
    made.push((r.body as { id: string }[])[0].id);
  }

  beforeAll(async () => {
    const probe = await rest("GET", "/reservations?select=id&limit=1");
    expect(probe.status, "이전 마이그레이션이 적용되지 않았다").toBe(200);

    adminId = await createUser(emailFor("admin"));
    plainId = await createUser(emailFor("plain"));
    adminToken = await signIn(emailFor("admin"));
    plainToken = await signIn(emailFor("plain"));
    const add = await rest("POST", "/admin_users", { user_id: adminId, email: emailFor("admin"), note: "P5-17 test" });
    expect(add.status, JSON.stringify(add.body).slice(0, 300)).toBeLessThan(300);

    for (const f of [...IN_WINDOW, ...OUT_WINDOW]) await seed(f);

    const r = await statsAs(adminToken);
    expect(r.status, `admin_stats 호출 실패: ${JSON.stringify(r.body).slice(0, 400)}`).toBe(200);
    result = r.body as Record<string, unknown>;
  });

  afterAll(async () => {
    for (const id of made) {
      await rest("DELETE", `/notifications_log?reservation_id=eq.${id}`);
      await rest("DELETE", `/reservations?id=eq.${id}`);
    }
    await rest("DELETE", `/admin_users?user_id=eq.${adminId}`);
    for (const id of [adminId, plainId]) if (id) await call("DELETE", `${baseUrl()}/auth/v1/admin/users/${id}`, serviceHeaders);
    const left = await rest("GET", `/reservations?select=id&public_code=like.${PREFIX}*`);
    expect(left.body, "정리되지 않은 픽스처가 남았다").toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // A. 권한 세 갈래
  // ---------------------------------------------------------------------------
  test("A-1 anon — EXECUTE 거부 (함수 본문이 한 줄도 돌지 않는다)", async () => {
    expectFunctionPrivilegeDenied(await asAnon("POST", "/rpc/admin_stats", { p_from: WIN_FROM, p_to: WIN_TO }), "admin_stats", "anon 의 admin_stats");
  });

  test("A-2 service_role — EXECUTE 거부 (서비스 롤은 이 함수를 부를 이유가 없다)", async () => {
    expectFunctionPrivilegeDenied(await rest("POST", "/rpc/admin_stats", { p_from: WIN_FROM, p_to: WIN_TO }), "admin_stats", "service_role 의 admin_stats");
  });

  test("A-3 명단 밖 로그인 — 가드 거부(42501 + 문구) · 두 판정이 서로를 받아들이지 않는다", async () => {
    const guard = await statsAs(plainToken);
    expectRaisedDenied(guard, GUARD_MESSAGE, "명단 밖 세션의 admin_stats");
    expect(() => expectFunctionPrivilegeDenied(guard, "admin_stats", "대조"), "EXECUTE 판정이 가드 거부를 받아들였다").toThrow();

    const exec = await asAnon("POST", "/rpc/admin_stats", { p_from: WIN_FROM, p_to: WIN_TO });
    expect(() => expectRaisedDenied(exec, GUARD_MESSAGE, "대조"), "가드 판정이 EXECUTE 거부를 받아들였다").toThrow();
  });

  // ---------------------------------------------------------------------------
  // B. 입력 검증
  // ---------------------------------------------------------------------------
  test("B 입력 검증 22023 — null · 뒤집힌 기간 · 366일 초과", async () => {
    for (const [what, args] of [
      ["from null", { p_from: null, p_to: WIN_TO }],
      ["to null", { p_from: WIN_FROM, p_to: null }],
      ["뒤집힘", { p_from: WIN_TO, p_to: WIN_FROM }],
      ["367일", { p_from: "2030-01-01", p_to: "2031-01-02" }],
    ] as const) {
      const r = await asUser(adminToken, "POST", "/rpc/admin_stats", args);
      expect(r.status, `${what}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(400);
      expect((r.body as { code?: string }).code, what).toBe("22023");
    }
    // 366일 정확히는 통과한다(최근 12개월의 상한)
    const ok = await asUser(adminToken, "POST", "/rpc/admin_stats", { p_from: "2030-01-01", p_to: "2031-01-01" });
    expect(ok.status, JSON.stringify(ok.body).slice(0, 200)).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // C. 결과의 모양 — 키 집합 고정 · 개인정보 0
  // ---------------------------------------------------------------------------
  test("C-1 최상위 키 집합이 정확히 고정돼 있다 (칸이 조용히 늘지 않는다)", () => {
    expect(sortedKeys(result)).toEqual([...TOP_KEYS]);
  });

  test("C-2 각 구역의 키 집합도 고정돼 있다", () => {
    expect(sortedKeys(result.range)).toEqual(RANGE_KEYS);
    expect(sortedKeys(result.intake)).toEqual(INTAKE_KEYS);
    expect(sortedKeys(result.confirmation)).toEqual(CONFIRMATION_KEYS);
    expect(sortedKeys(result.response_time)).toEqual(RESPONSE_KEYS);
    expect(sortedKeys(result.backlog)).toEqual(BACKLOG_KEYS);
    expect(sortedKeys(result.notifications)).toEqual(NOTIFICATIONS_KEYS);
    for (const [name, keys] of [
      ["trend", TREND_ITEM_KEYS],
      ["purposes", PURPOSE_ITEM_KEYS],
      ["vehicles", VEHICLE_ITEM_KEYS],
      ["segments", SEGMENT_ITEM_KEYS],
      ["lead_time", LEAD_ITEM_KEYS],
    ] as const) {
      const arr = result[name] as unknown[];
      expect(Array.isArray(arr), name).toBe(true);
      expect(arr.length, name).toBeGreaterThan(0);
      for (const item of arr) expect(sortedKeys(item), name).toEqual([...keys]);
    }
  });

  test("C-3 결과 어디에도 개인정보가 없다 — 픽스처의 이름·전화·접수번호가 한 글자도 없다", () => {
    const json = JSON.stringify(result);
    for (const needle of ["통계픽스처", "+821000000000", PREFIX, "example.test", emailFor("admin")]) {
      expect(json, needle).not.toContain(needle);
    }
    for (const col of ["name", "phone", "email", "message", "admin_memo", "public_code", "to_phone", "last_error"]) {
      expect(json, col).not.toContain(`"${col}"`);
    }
  });

  // ---------------------------------------------------------------------------
  // D. 값 — KST 경계와 집계
  // ---------------------------------------------------------------------------
  test("D-1 KST 경계 — 창 안 10건 · 직전 기간 1건 (UTC 로 잘랐다면 둘 다 틀린다)", () => {
    expect(result.range).toEqual({
      from: WIN_FROM,
      to: WIN_TO,
      days: 31,
      bucket: "day",
      prev_from: "2031-01-29",
      prev_to: "2031-02-28",
      has_prev: true,
    });
    expect(result.intake).toEqual({ total: 10, prev_total: 1, delta: 9 });
  });

  test("D-2 KST 버킷 — 03-01 00:00 KST 행이 첫날 칸에, 03-31 23:59 KST 행이 마지막 칸에 든다", () => {
    const trend = result.trend as TrendPoint[];
    expect(trend).toHaveLength(31);
    expect(trend[0].bucket).toBe("2031-03-01");
    expect(trend[30].bucket).toBe("2031-03-31");
    expect(trend[0].total).toBe(1);
    expect(trend[30].total).toBe(1);
    // 빈 칸은 0 으로 채워진다 — 화면이 구멍을 만들지 않는다. 0 건은 아무것도 드러내지 않으므로 상태를 쪼갠다.
    expect(trend[1]).toEqual({ bucket: "2031-03-02", split: true, waiting: 0, confirmed: 0, cancelled: 0, total: 0 });
    const byDay = Object.fromEntries(trend.map((t) => [t.bucket, t.total]));
    expect(byDay["2031-03-05"]).toBe(3);
    expect(trend.reduce((a, t) => a + t.total, 0)).toBe(10);
  });

  test("D-2b 🔴 R2-B 추이 — 3건 미만인 버킷은 상태로 쪼개지 않는다 (그 날 혼자 낸 사람의 상태가 드러나지 않게)", () => {
    const trend = result.trend as TrendPoint[];
    // 1건짜리 날: 총건수만 오고 상태 칸은 전부 null 이다 (03-01 확정 · 03-31 취소 — 둘 다 가려진다)
    for (const day of ["2031-03-01", "2031-03-31", "2031-03-12", "2031-03-15"]) {
      const p = trend.find((t) => t.bucket === day) as TrendPoint;
      expect(p.total, day).toBe(1);
      expect(p.split, day).toBe(false);
      expect([p.waiting, p.confirmed, p.cancelled], day).toEqual([null, null, null]);
    }
    // 3건짜리 날만 쪼개진다
    const many = trend.find((t) => t.bucket === "2031-03-05") as TrendPoint;
    expect(many).toEqual({ bucket: "2031-03-05", split: true, waiting: 0, confirmed: 3, cancelled: 0, total: 3 });
    // 쪼개진 버킷은 합이 맞고, 쪼개지지 않은 버킷은 상태 합계를 낼 수 없다
    for (const p of trend) {
      if (p.split) expect((p.waiting ?? 0) + (p.confirmed ?? 0) + (p.cancelled ?? 0), p.bucket).toBe(p.total);
      else expect(p.total, p.bucket).toBeLessThan(3);
    }
    expect(trend.filter((t) => !t.split).length, "쪼개지지 않은 버킷이 하나도 없다 — 이빨이 빠졌다").toBeGreaterThanOrEqual(6);
  });

  test("D-3 확정·확정률·처리 전 — 한 번이라도 확정된 것을 센다(확정 뒤 취소 포함)", () => {
    expect(result.confirmation).toEqual({ total: 10, confirmed: 5, rate_pct: 50, pending: 3 });
  });

  test("D-4 확정까지 걸린 시간 — 1·2·3·10·30시간의 중앙값 = 180분", () => {
    expect(result.response_time).toEqual({ sample: 5, median_minutes: 180, enough: true });
  });

  test("D-5 여행 구분별 — 3건 이상만 이름이 보이고 1~2건은 '기타' 로 합쳐진다", () => {
    expect(result.purposes).toEqual([
      { code: "family", count: 4, suppressed: false, other: false },
      { code: "airport_pickup", count: 3, suppressed: false, other: false },
      // workshop 1 + univ_mt 2 → 가려질 칸이 **둘**이라 보완 숨김이 더 가리지 않는다
      { code: null, count: 3, suppressed: false, other: true },
    ]);
  });

  test("D-6 차량별 — 숨겨진 '기타' 는 건수도 **대수도** 내려오지 않는다 (대수는 건수를 역산하는 또 다른 창이다)", () => {
    // 원자료: bus45 5(버스 6) · limo28 3(버스 3) · bus16 1 · bus25 1 → 1~2건 칸이 둘이라 그대로 묶이고, 합이 2라 숨는다.
    expect(result.vehicles).toEqual([
      { slug: "bus45", count: 5, buses: 6, suppressed: false, other: false },
      { slug: "limo28", count: 3, buses: 3, suppressed: false, other: false },
      { slug: null, count: null, buses: null, suppressed: true, other: true },
    ]);
  });

  test("D-7 많이 찾는 구간 — 대표 노선 일치 표시 · 소수 구간은 좌표 없이 합쳐진다", () => {
    expect(result.segments).toEqual([
      { origin: "SEL", destination: "BSN", count: 4, showcase: true, suppressed: false, other: false },
      { origin: "INC", destination: "GWJ", count: 3, showcase: false, suppressed: false, other: false },
      // SEL→INC 2 + GWJ→BSN 1 → 가려질 칸이 둘
      { origin: null, destination: null, count: 3, showcase: false, suppressed: false, other: true },
    ]);
  });

  test("D-8 🔴 R2-A 리드타임 — astra 배치(3·3·3·1)에서 가려진 칸이 **둘 이상**이 된다", () => {
    // 보완 숨김이 없으면: 총 10 − (3+3+3) = 1 → 가려진 칸의 **건수와 이름**(네 구간 중 남은 하나)이 함께 드러난다.
    // 있으면: 91일 이상(1) + 31~90일(3) 이 함께 "기타 4" 가 된다 — 4 를 1·3 으로 되돌릴 수 없다.
    expect(result.lead_time).toEqual([
      { bucket: "d0_7", count: 3, suppressed: false, other: false },
      { bucket: "d8_30", count: 3, suppressed: false, other: false },
      { bucket: null, count: 4, suppressed: false, other: true },
    ]);
    const rows = result.lead_time as { bucket: string | null; count: number | null; other: boolean }[];
    const shown = rows.filter((x) => !x.other);
    const total = (result.intake as { total: number }).total;
    const remainder = total - shown.reduce((a, x) => a + (x.count ?? 0), 0);
    expect(remainder, "남은 건수가 한 칸 분량이면 그 칸이 복원된다").toBeGreaterThan(MIN_HIDDEN_COUNT_FLOOR);
    expect(shown.length, "네 구간 중 둘만 보인다 — 나머지 둘이 기타로 합쳐졌다").toBe(2);
  });

  test("D-9 🔴 숨김은 SQL 안에서 일어난다 — 원자료(1·2건 칸)가 응답 본문에 아예 없다", () => {
    const json = JSON.stringify(result);
    // 1~2건짜리 여행 구분·차량은 이름조차 오지 않는다. d31_90 은 **보완 숨김**으로 함께 사라진 칸이다.
    for (const leaked of ["workshop", "univ_mt", "bus16", "bus25", "d31_90", "d91_plus"]) {
      expect(json, leaked).not.toContain(leaked);
    }
    // 1~2건짜리 구간도 좌표가 오지 않는다(SEL→INC · GWJ→BSN). 코드 자체는 다른 행에도 쓰이므로 **쌍**으로 본다.
    const segs = result.segments as { origin: string | null; destination: string | null }[];
    for (const [o, d] of [["SEL", "INC"], ["GWJ", "BSN"]] as const) {
      expect(segs.some((s) => s.origin === o && s.destination === d), `${o}→${d} 가 노출됐다`).toBe(false);
    }
    // 숨겨진 칸은 숫자가 아니라 null 로 온다. **실제로 그런 행이 있어야** 이 단언이 뜻을 갖는다(astra P2 — 전까지 0번 돌았다).
    const suppressedRows = (
      [result.purposes, result.vehicles, result.segments, result.lead_time] as { count: number | null; suppressed: boolean }[][]
    ).flat().filter((row) => row.suppressed);
    expect(suppressedRows.length, "주 픽스처에 숨겨진 행이 하나도 없다 — 단언이 공회전한다").toBeGreaterThanOrEqual(1);
    for (const row of suppressedRows) expect(row.count).toBeNull();
    expect((result.vehicles as { buses: number | null; suppressed: boolean }[]).find((v) => v.suppressed)?.buses).toBeNull();
  });

  test("D-10 기간이 3개월을 넘으면 직전 기간과 비교하지 않는다 (파기로 비어 있다)", async () => {
    const r = await statsAs(adminToken, "2030-04-01", "2031-03-31");
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    const b = r.body as { range: Record<string, unknown>; intake: Record<string, unknown> };
    expect(b.range.has_prev).toBe(false);
    expect(b.range.prev_from).toBeNull();
    expect(b.range.prev_to).toBeNull();
    // 이 창은 창 앞 경계 행(B01 · 2031-02-28 KST)까지 품는다 — 10 + 1
    expect(b.intake).toEqual({ total: 11, prev_total: null, delta: null });
    expect(b.range.bucket).toBe("month");
    expect((r.body as { trend: unknown[] }).trend).toHaveLength(12);
  });

  test("D-11 버킷 단위가 기간 길이로 정해진다 — 31일 이하 일 · 92일 이하 주(월요일 시작) · 그 위 월", async () => {
    const week = await statsAs(adminToken, "2031-01-01", "2031-03-31");
    expect(week.status, JSON.stringify(week.body).slice(0, 200)).toBe(200);
    const wb = week.body as { range: { bucket: string }; trend: { bucket: string }[] };
    expect(wb.range.bucket).toBe("week");
    // 2030-12-30 이 2031-01-01 이 든 주의 월요일이다
    expect(wb.trend[0].bucket).toBe("2030-12-30");
    for (const t of wb.trend) expect(new Date(`${t.bucket}T00:00:00Z`).getUTCDay(), `${t.bucket} 가 월요일이 아니다`).toBe(1);
  });

  test("D-12 데이터 0건 — 빈 기간에도 200 이고 0 으로 나누지 않는다", async () => {
    const r = await statsAs(adminToken, "2031-06-01", "2031-06-30");
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const b = r.body as Record<string, unknown>;
    expect(sortedKeys(b)).toEqual([...TOP_KEYS]);
    expect(b.intake).toEqual({ total: 0, prev_total: 0, delta: 0 });
    expect(b.confirmation).toEqual({ total: 0, confirmed: 0, rate_pct: null, pending: 0 });
    expect(b.response_time).toEqual({ sample: 0, median_minutes: null, enough: false });
    expect(b.purposes).toEqual([]);
    expect(b.vehicles).toEqual([]);
    expect(b.segments).toEqual([]);
    expect(b.lead_time).toEqual([]);
    expect((b.trend as unknown[]).length).toBe(30);
  });

  test("D-13 확정이 3건 미만이면 중앙값 대신 '표본 부족'", async () => {
    // 1~2일 창: 확정 1건 → 부족. 1~5일 창: 확정 4건(R01~R04 · 1·2·3·10시간) → 충분, 중앙값 2.5시간 = 150분.
    const few = await statsAs(adminToken, "2031-03-01", "2031-03-02");
    expect((few.body as { response_time: unknown }).response_time).toEqual({ sample: 1, median_minutes: null, enough: false });
    const enough = await statsAs(adminToken, "2031-03-01", "2031-03-05");
    expect((enough.body as { response_time: unknown }).response_time).toEqual({ sample: 4, median_minutes: 150, enough: true });
  });

  test("D-14 🔴 R2-E 날짜 검증 — 무한대와 지원 범위 밖은 산술 전에 22023 으로 거부된다", async () => {
    for (const [what, args] of [
      ["from infinity", { p_from: "infinity", p_to: WIN_TO }],
      ["to infinity", { p_from: WIN_FROM, p_to: "infinity" }],
      ["from -infinity", { p_from: "-infinity", p_to: WIN_TO }],
      ["둘 다 infinity", { p_from: "infinity", p_to: "infinity" }],
      ["지원 범위 앞", { p_from: "1800-01-01", p_to: "1800-06-30" }],
      ["지원 범위 뒤", { p_from: "2300-01-01", p_to: "2300-06-30" }],
    ] as const) {
      const r = await asUser(adminToken, "POST", "/rpc/admin_stats", args);
      expect(r.status, `${what}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(400);
      // 22023(invalid_parameter_value)이어야 한다 — 22008(datetime field overflow)이나 5xx 가 아니다
      expect((r.body as { code?: string }).code, what).toBe("22023");
    }
  });

  // ---------------------------------------------------------------------------
  // E. 기간과 무관한 두 지표 — **한 트랜잭션 안에서** 기준선과 비교하고 되돌린다
  //    (표 전체를 세므로 다른 파일의 행이 섞인다 — 절대값을 단언할 수 없다. 파일 머리 주석)
  // ---------------------------------------------------------------------------
  test("E 처리 대기·발송 문제 — 표 전체 기준과 같고, 넣은 만큼만 늘어난다 (탐침은 되돌려진다)", () => {
    const out = runLocalSqlExpectingError(`
do $$
declare
  v_admin uuid;
  j0 jsonb; j1 jsonb;
  ref_new bigint; ref_old bigint; ref_failed bigint; ref_stuck bigint;
  rid uuid;
  o text[] := '{}';
begin
  select user_id into v_admin from public.admin_users where email = '${emailFor("admin")}';
  if v_admin is null then raise exception 'P517 탐침: 관리자 픽스처를 찾지 못했다'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  j0 := public.admin_stats('${WIN_FROM}'::date, '${WIN_TO}'::date);
  execute 'set local role postgres';
  select count(*) into ref_new from public.reservations where status = 'new';
  select count(*) into ref_old from public.reservations where status = 'new' and created_at < now() - interval '72 hours';
  select count(*) into ref_failed from public.notifications_log where status = 'failed' and created_at >= now() - interval '7 days';
  select count(*) into ref_stuck from public.notifications_log where status = 'pending' and created_at >= now() - interval '7 days' and created_at < now() - interval '1 hour';
  o := o || ('new_matches=' || ((j0->'backlog'->>'new_total')::bigint = ref_new)::text);
  o := o || ('old_matches=' || ((j0->'backlog'->>'over_72h')::bigint = ref_old)::text);
  o := o || ('failed_matches=' || ((j0->'notifications'->>'failed')::bigint = ref_failed)::text);
  o := o || ('stuck_matches=' || ((j0->'notifications'->>'stuck')::bigint = ref_stuck)::text);

  -- 창 밖(100일 전)에 대기 1건 — 72시간을 넘긴 건으로만 잡혀야 한다
  insert into public.reservations (public_code, created_at, status, name, phone, vehicle_slug, purpose_code, origin_code, destination_code, trip_type, depart_at, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
    values ('${PREFIX}X1', now() - interval '100 days', 'new', 'x', '+821000000000', 'bus45', 'family', 'SEL', 'BSN', 'oneway', now() + interval '30 days', now() - interval '100 days', '2026-09-11', now() + interval '400 days', now() - interval '100 days')
    returning id into rid;
  insert into public.notifications_log (reservation_id, event, channel, to_phone, template, status, created_at, next_attempt_at)
    values (rid, 'created', 'sms', '+821000000000', 'created.customer.sms', 'failed', now() - interval '3 days', now() + interval '400 days'),
           (rid, 'created', 'sms', '+821000000000', 'created.customer.sms', 'failed', now() - interval '10 days', now() + interval '400 days'),
           (rid, 'created', 'sms', '+821000000000', 'created.customer.sms', 'pending', now() - interval '2 hours', now() + interval '400 days'),
           (rid, 'created', 'sms', '+821000000000', 'created.customer.sms', 'pending', now() - interval '10 minutes', now() + interval '400 days');

  execute 'set local role authenticated';
  j1 := public.admin_stats('${WIN_FROM}'::date, '${WIN_TO}'::date);
  execute 'set local role postgres';
  o := o || ('new_delta=' || ((j1->'backlog'->>'new_total')::bigint - (j0->'backlog'->>'new_total')::bigint)::text);
  o := o || ('old_delta=' || ((j1->'backlog'->>'over_72h')::bigint - (j0->'backlog'->>'over_72h')::bigint)::text);
  o := o || ('failed_delta=' || ((j1->'notifications'->>'failed')::bigint - (j0->'notifications'->>'failed')::bigint)::text);
  o := o || ('stuck_delta=' || ((j1->'notifications'->>'stuck')::bigint - (j0->'notifications'->>'stuck')::bigint)::text);
  o := o || ('hours=' || (j1->'backlog'->>'hours'));
  o := o || ('window_days=' || (j1->'notifications'->>'window_days'));
  o := o || ('stuck_hours=' || (j1->'notifications'->>'stuck_hours'));
  -- 기간을 바꿔도 이 네 숫자는 그대로다(기간 무관 지표다)
  execute 'set local role authenticated';
  o := o || ('period_independent=' || (public.admin_stats('2031-06-01'::date, '2031-06-30'::date)->'backlog' = j1->'backlog')::text);
  execute 'set local role postgres';

  raise exception 'P517BACKLOG %', array_to_string(o, ' ');
end $$;`);
    const text = sqlErrorText(out);
    expect(text).toContain("P517BACKLOG");
    for (const expected of [
      "new_matches=true",
      "old_matches=true",
      "failed_matches=true",
      "stuck_matches=true",
      "new_delta=1",
      "old_delta=1",
      "failed_delta=1",
      "stuck_delta=1",
      "hours=72",
      "window_days=7",
      "stuck_hours=1",
      "period_independent=true",
    ]) {
      expect(text, expected).toContain(expected);
    }
  });

  test("E-2 🔴 R2-A 보완 숨김의 가장자리 — 칸이 하나뿐일 때·둘일 때 (탐침은 되돌려진다)", () => {
    // 픽스처를 넣었다 되돌리며 **실제 함수**를 부른다. 축은 여행 구분 하나만 움직이고 나머지는 고정한다.
    //   W1  칸 1개(2건)            → 가릴 칸이 하나뿐이고 더 가릴 칸이 없다 → 전부 기타, 2건이라 건수도 가려진다
    //   W2  칸 2개(4건 · 1건)       → 4건짜리까지 함께 가려 기타 5건 (그러지 않으면 5−4=1 로 복원된다)
    //   W3  칸 3개(4·3·3건)        → 가릴 칸이 없다 → 셋 다 보인다
    const out = runLocalSqlExpectingError(`
do $$
declare
  v_admin uuid;
  j jsonb;
  o text[] := '{}';
  w record;
begin
  select user_id into v_admin from public.admin_users where email = '${emailFor("admin")}';
  if v_admin is null then raise exception 'P517 탐침: 관리자 픽스처를 찾지 못했다'; end if;

  insert into public.reservations (public_code, created_at, status, name, phone, vehicle_slug, purpose_code, origin_code, destination_code, trip_type, depart_at, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
  select
    '${PREFIX}S' || v.i, v.at, 'new', 'x', '+821000000000', 'bus45', v.purpose, 'SEL', 'BSN', 'oneway',
    v.at + interval '10 days', v.at, '2026-09-11', v.at + interval '900 days', v.at
  from (values
    (1, timestamptz '2032-05-02 09:00+09', 'family'), (2, timestamptz '2032-05-03 09:00+09', 'family'),
    (3, timestamptz '2032-06-02 09:00+09', 'family'), (4, timestamptz '2032-06-03 09:00+09', 'family'),
    (5, timestamptz '2032-06-04 09:00+09', 'family'), (6, timestamptz '2032-06-05 09:00+09', 'family'),
    (7, timestamptz '2032-06-06 09:00+09', 'workshop'),
    (8, timestamptz '2032-07-02 09:00+09', 'family'), (9, timestamptz '2032-07-03 09:00+09', 'family'),
    (10, timestamptz '2032-07-04 09:00+09', 'family'), (11, timestamptz '2032-07-05 09:00+09', 'family'),
    (12, timestamptz '2032-07-06 09:00+09', 'workshop'), (13, timestamptz '2032-07-07 09:00+09', 'workshop'),
    (14, timestamptz '2032-07-08 09:00+09', 'workshop'), (15, timestamptz '2032-07-09 09:00+09', 'univ_mt'),
    (16, timestamptz '2032-07-10 09:00+09', 'univ_mt'), (17, timestamptz '2032-07-11 09:00+09', 'univ_mt')
  ) as v(i, at, purpose);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  for w in select * from (values ('W1', date '2032-05-01', date '2032-05-31'), ('W2', date '2032-06-01', date '2032-06-30'), ('W3', date '2032-07-01', date '2032-07-31')) t(tag, f, u) loop
    j := public.admin_stats(w.f, w.u);
    o := o || (w.tag || '=' || (j->'intake'->>'total') || '|' || coalesce((
      select string_agg(format('%s:%s', coalesce(e->>'code', 'OTHER'), coalesce(e->>'count', 'HIDDEN')), ',')
        from jsonb_array_elements(j->'purposes') e), 'NONE'));
  end loop;
  execute 'set local role postgres';
  raise exception 'P517EDGE %', array_to_string(o, ' ');
end $$;`);
    const text = sqlErrorText(out);
    expect(text).toContain("P517EDGE");
    // W1: 칸이 하나뿐 → 전부 기타, 2건이라 건수도 가려진다
    expect(text).toContain("W1=2|OTHER:HIDDEN");
    // W2: 4건짜리까지 함께 가려 기타 5 — 보완 숨김이 없으면 `family:4,OTHER:HIDDEN` 이 되어 5−4=1 이 복원된다
    expect(text).toContain("W2=5|OTHER:5");
    expect(text).not.toContain("W2=5|family:4");
    // W3: 가릴 칸이 없다
    // 동률(3건)은 코드 오름차순 — univ_mt < workshop
    expect(text).toContain("W3=10|family:4,univ_mt:3,workshop:3");
  });

  test("E-3 🔴 R3-A 추이 — 판정은 총건수가 아니라 **각 상태 칸**이다 (탐침은 되돌려진다)", () => {
    // astra P1 반례: 하루 총 3건이 대기·확정·취소 **1건씩**이면 옛 판(`total >= c_k`)은 세 칸을 그대로 내보냈다.
    //   W1 (1,1,1) → 쪼개지 않는다      W2 (3,1,0) → 쪼개지 않는다(1건짜리 칸이 있다)
    //   W3 (3,0,0) → 쪼갠다             W4 (3,3,0) → 쪼갠다
    const out = runLocalSqlExpectingError(`
do $$
declare
  v_admin uuid;
  j jsonb;
  o text[] := '{}';
  w record;
begin
  select user_id into v_admin from public.admin_users where email = '${emailFor("admin")}';
  if v_admin is null then raise exception 'P517 탐침: 관리자 픽스처를 찾지 못했다'; end if;

  insert into public.reservations (public_code, created_at, status, confirmed_at, name, phone, vehicle_slug, purpose_code, origin_code, destination_code, trip_type, depart_at, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
  select
    '${PREFIX}T' || v.i, v.at, v.st::reservation_status,
    case when v.st in ('confirmed', 'done') then v.at + interval '2 hours' end,
    'x', '+821000000000', 'bus45', 'family', 'SEL', 'BSN', 'oneway',
    v.at + interval '10 days', v.at, '2026-09-11', v.at + interval '900 days', v.at
  from (values
    -- W1 2033-01-10 : 대기1 확정1 취소1
    (1, timestamptz '2033-01-10 09:00+09', 'new'), (2, timestamptz '2033-01-10 10:00+09', 'confirmed'), (3, timestamptz '2033-01-10 11:00+09', 'cancelled'),
    -- W2 2033-02-10 : 대기3 확정1
    (4, timestamptz '2033-02-10 09:00+09', 'new'), (5, timestamptz '2033-02-10 10:00+09', 'new'), (6, timestamptz '2033-02-10 11:00+09', 'new'),
    (7, timestamptz '2033-02-10 12:00+09', 'confirmed'),
    -- W3 2033-03-10 : 대기3
    (8, timestamptz '2033-03-10 09:00+09', 'new'), (9, timestamptz '2033-03-10 10:00+09', 'new'), (10, timestamptz '2033-03-10 11:00+09', 'new'),
    -- W4 2033-04-10 : 대기3 확정3
    (11, timestamptz '2033-04-10 09:00+09', 'new'), (12, timestamptz '2033-04-10 10:00+09', 'new'), (13, timestamptz '2033-04-10 11:00+09', 'new'),
    (14, timestamptz '2033-04-10 12:00+09', 'confirmed'), (15, timestamptz '2033-04-10 13:00+09', 'confirmed'), (16, timestamptz '2033-04-10 14:00+09', 'done')
  ) as v(i, at, st);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  for w in select * from (values
      ('W1', date '2033-01-10'), ('W2', date '2033-02-10'), ('W3', date '2033-03-10'), ('W4', date '2033-04-10')) t(tag, d) loop
    j := public.admin_stats(w.d, w.d);
    o := o || (w.tag || '=' || (j->'trend'->0->>'total') || '/' || (j->'trend'->0->>'split') || '/'
               || coalesce(j->'trend'->0->>'waiting', 'NULL') || ',' || coalesce(j->'trend'->0->>'confirmed', 'NULL') || ','
               || coalesce(j->'trend'->0->>'cancelled', 'NULL'));
  end loop;
  execute 'set local role postgres';
  raise exception 'P517TREND %', array_to_string(o, ' ');
end $$;`);
    const text = sqlErrorText(out);
    expect(text).toContain("P517TREND");
    expect(text, "총 3건이 1·1·1 인 날은 쪼개지면 안 된다").toContain("W1=3/false/NULL,NULL,NULL");
    expect(text, "1건짜리 칸이 섞이면 쪼개지 않는다").toContain("W2=4/false/NULL,NULL,NULL");
    expect(text, "0 인 칸은 드러낼 것이 없다 — 쪼갠다").toContain("W3=3/true/3,0,0");
    expect(text).toContain("W4=6/true/3,3,0");
  });

  // ---------------------------------------------------------------------------
  // F. 카탈로그 — 함수의 상태
  // ---------------------------------------------------------------------------
  test("F 카탈로그 — definer · search_path · EXECUTE 보유자는 authenticated 뿐 (PUBLIC·anon·service_role 없음)", () => {
    const out = runLocalSqlExpectingError(`
do $$
declare
  p record;
  o text[] := '{}';
begin
  select prosecdef, provolatile, coalesce(array_to_string(proconfig, ' '), '(none)') as cfg, proacl is null as acl_null
    into p from pg_proc where oid = 'public.admin_stats(date,date)'::regprocedure;
  o := o || ('secdef=' || p.prosecdef::text);
  o := o || ('volatile=' || p.provolatile::text);
  o := o || ('cfg=' || p.cfg);
  o := o || ('anon=' || has_function_privilege('anon', 'public.admin_stats(date,date)', 'execute')::text);
  o := o || ('service=' || has_function_privilege('service_role', 'public.admin_stats(date,date)', 'execute')::text);
  o := o || ('auth=' || has_function_privilege('authenticated', 'public.admin_stats(date,date)', 'execute')::text);
  o := o || ('public_grant=' || exists (
      select 1 from pg_proc x cross join lateral aclexplode(coalesce(x.proacl, acldefault('f', x.proowner))) a
       where x.oid = 'public.admin_stats(date,date)'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE')::text);
  raise exception 'P517CAT %', array_to_string(o, ' ');
end $$;`);
    const text = sqlErrorText(out);
    for (const expected of [
      "secdef=true",
      "volatile=s",
      "cfg=search_path=public, pg_temp",
      "anon=false",
      "service=false",
      "auth=true",
      "public_grant=false",
    ]) {
      expect(text, expected).toContain(expected);
    }
  });
});
