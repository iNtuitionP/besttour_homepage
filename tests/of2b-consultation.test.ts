/**
 * OF2-B — "확정" → "상담완료" 표시 이름 · 손님 문자 제목 · 마이그레이션 0026 · 숨기기 액션의 **정적 잠금**.
 * DB 가 필요한 증명(숨김 칸·함수·노출 규칙)은 tests/feed-hidden-db.test.ts, 피드 규칙의 단위 증명은 tests/recent-feed.test.ts.
 *
 * 결정(2026-10-15): DB 값(`confirmed`)·함수 이름(`confirm_reservation` 등)은 그대로 두고 **표시 이름만** 바꾼다.
 * 손님 문자 제목은 계약 성립 통지의 뜻(약관 제5조)을 지켜 "상담 완료 · 예약 확정 안내" — "확정"이 문자에서 사라지지 않는다.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

import { COMPANY } from "@/lib/legal/disclosures";
import { ALIMTALK_TEMPLATES, ALIMTALK_TEMPLATES_NEXT, CONFIRMED_HEADLINE, renderTemplate } from "@/lib/notify/templates";

import { stripComments } from "./helpers/strip-comments";

vi.mock("server-only", () => ({}));

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const code = (rel: string) => stripComments(read(rel), rel);

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
const ko = JSON.parse(read("messages/ko.json")) as { [k: string]: Json };
const en = JSON.parse(read("messages/en.json")) as { [k: string]: Json };

/** (경로, 문자열) 목록 — 객체·배열을 끝까지 내려간다. */
function leaves(node: Json, at: string, out: [string, string][] = []): [string, string][] {
  if (typeof node === "string") out.push([at, node]);
  else if (Array.isArray(node)) node.forEach((v, i) => leaves(v, `${at}[${i}]`, out));
  else if (node !== null && typeof node === "object") for (const [k, v] of Object.entries(node)) leaves(v, `${at}.${k}`, out);
  return out;
}
const at = (root: { [k: string]: Json }, dotted: string): Json => dotted.split(".").reduce<Json>((n, k) => (n as { [k: string]: Json })[k], root);

describe("1. 표시 이름 — 관리자 · 공개 예약 확인 · 홈 칩 전부 '상담완료'", () => {
  test("상태 이름 자리 — 관리자 필터·배지·상세 필드, 공개 예약 확인 카드, 홈 접수 현황 칩", () => {
    for (const key of [
      "admin.reservations.filter.confirmed",
      "admin.reservations.status.confirmed",
      "reservationCheck.status.confirmed",
      "home.recentFeed.statusConfirmed",
    ]) {
      expect(at(ko, key), key).toBe("상담완료");
    }
    expect(at(ko, "admin.detail.field.confirmedAt")).toBe("상담완료 일시");
    expect(at(ko, "admin.detail.confirm")).toBe("상담완료로 바꾸기");
    expect(at(en, "home.recentFeed.statusConfirmed")).toBe("Consultation completed");
    expect(at(en, "reservationCheck.status.confirmed")).toBe("Consultation completed");
  });

  test("관리자 화면 문구에 '확정'이 남지 않는다 — 손님에게 가는 문자 이름 '예약 확정 안내'만 예외", () => {
    const left = leaves(ko.admin, "admin").filter(([, v]) => v.includes("확정") && !v.includes("예약 확정 안내"));
    expect(left, `아직 '확정'이 남은 관리자 문구:\n${left.map(([k, v]) => `${k}: ${v}`).join("\n")}`).toEqual([]);
  });

  test("홈 칩과 예약 확인 카드의 상태 이름에 '확정'이 없다 (상담완료 · 접수 · 취소 · 완료)", () => {
    expect(leaves(at(ko, "home.recentFeed"), "home.recentFeed").filter(([, v]) => v.includes("확정"))).toEqual([]);
    expect(leaves((ko.reservationCheck as { status: Json }).status, "reservationCheck.status").filter(([, v]) => v.includes("확정"))).toEqual([]);
  });

  test("버튼 문구 하나로 상태가 바뀐다는 것을 말한다 — 시트 제목·제출·결과 토스트가 같은 이름을 쓴다", () => {
    const sheet = at(ko, "admin.detail.sheet") as { [k: string]: string };
    expect(sheet.confirmTitle).toContain("상담완료");
    expect(sheet.confirmSubmit).toContain("상담완료");
    expect((at(ko, "admin.detail.result") as { confirmed: string }).confirmed).toContain("상담완료");
    // OF3-R4(0028): 상담완료는 문자를 자동으로 보내지 않는다 — 시트 본문이 그 사실을 말한다(예전: "예약 확정 안내 문자가 가요")
    expect(sheet.confirmBody).toContain("자동으로 가지 않아요");
    expect(sheet.confirmBody).not.toContain("문자가 가요");
  });
});

describe("2. 손님 상담완료 문자 · 알림톡 제목", () => {
  const CUSTOMER = { publicCode: "BT12ABCD", origin: "https://bestour.co.kr", createdAt: "2026-10-01T00:00:00+09:00" };

  test("제목은 '상담 완료 · 예약 확정 안내' — 계약 성립 통지의 뜻(약관 제5조)을 유지한다", () => {
    expect(CONFIRMED_HEADLINE).toBe("상담 완료 · 예약 확정 안내");
    const rows = renderTemplate("confirmed.customer.sms", CUSTOMER).text.split("\n");
    expect(rows[0]).toBe(`[${COMPANY.brandName}] ${CONFIRMED_HEADLINE}`);
  });

  test("접수 문자에는 그대로 '확인 후 연락드리겠습니다.'가 있고 상담완료 문자에는 없다 (뜻이 뒤집히지 않는다)", () => {
    expect(renderTemplate("created.customer.sms", CUSTOMER).text).toContain("확인 후 연락드리겠습니다.");
    expect(renderTemplate("confirmed.customer.sms", CUSTOMER).text).not.toContain("확인 후 연락드리겠습니다");
  });

  test("알림톡 초안 — 상담완료 본문의 첫 줄과 목록 이름이 같은 제목이다 (두 판 모두)", () => {
    for (const list of [ALIMTALK_TEMPLATES, ALIMTALK_TEMPLATES_NEXT]) {
      const t = list.find((x) => x.event === "confirmed");
      expect(t, "확정 알림톡 초안이 없다").toBeDefined();
      expect(t!.name.startsWith(CONFIRMED_HEADLINE), t!.name).toBe(true);
      expect(t!.body.split("\n")[0]).toBe(`[${COMPANY.brandName}] ${CONFIRMED_HEADLINE}`);
    }
  });

  test("사장님 발송 실패 알림 — 어떤 통지인지 '상담완료'로 말한다", () => {
    const text = renderTemplate("confirmed.owner.failure.email", CUSTOMER).text;
    expect(text).toContain("상담완료 통지");
    expect(text).not.toContain("확정 통지");
  });
});

describe("3. 마이그레이션 0026 — 숨김 칸 + 함수 (CLAUDE.md §3)", () => {
  const FILE = "supabase/migrations/0026_feed_hidden.sql";
  const DOWN = "supabase/rollbacks/0026_feed_hidden.down.sql";
  const sql = code(FILE);

  test("0026 번호는 이 파일 하나뿐이고 롤백은 migrations/ 밖에 있다", () => {
    expect(readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.startsWith("0026"))).toEqual(["0026_feed_hidden.sql"]);
    expect(readdirSync(path.join(ROOT, "supabase/rollbacks"))).toContain("0026_feed_hidden.down.sql");
  });

  test("칩 — boolean not null default false 인 새 칸 하나 (재실행 안전)", () => {
    expect(sql).toMatch(/alter table reservations add column if not exists hidden_from_feed boolean not null default false/i);
  });

  test("함수 — definer · search_path 고정 · 첫 문장 is_admin() 가드 · 서명 (uuid, boolean)", () => {
    const body = sql.slice(sql.search(/create or replace function admin_set_feed_hidden/i));
    expect(body).toMatch(/admin_set_feed_hidden\(p_id uuid, p_hidden boolean\)/);
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path = public, pg_temp/i);
    expect(body).toMatch(/begin\s+if not is_admin\(\) then\s+raise exception 'admin_set_feed_hidden: 관리자 명단에 없는 호출자다' using errcode = '42501'/);
  });

  test("권한 — public·anon·service_role 회수 + authenticated 에게만 EXECUTE (같은 파일에서)", () => {
    expect(sql).toMatch(/revoke all on function admin_set_feed_hidden\(uuid, boolean\) from public, anon, service_role/i);
    expect(sql).toMatch(/grant execute on function admin_set_feed_hidden\(uuid, boolean\) to authenticated/i);
  });

  test("자기검증 — has_column_privilege · has_function_privilege · PUBLIC(aclexplode) · 권한 종류는 acldefault 에서", () => {
    expect(sql).toMatch(/has_column_privilege/i);
    expect(sql).toMatch(/has_any_column_privilege/i);
    expect(sql).toMatch(/has_function_privilege/i);
    expect(sql).toMatch(/aclexplode/i);
    expect(sql).toMatch(/acldefault/i);
    // 표 권한을 열지 않는다 — 이 파일은 표에 grant 하지 않는다
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete|all|truncate)[^;]*on\s+(table\s+)?reservations/i);
  });

  test("취소·완료·확정 함수를 건드리지 않는다 — confirmed_at 은 취소가 지우지 않는다 (0010 그대로)", () => {
    expect(sql).not.toMatch(/admin_(cancel|confirm|complete)_reservation/i);
    const cancel = code("supabase/migrations/0010_admin_reservation_actions.sql");
    const cancelBody = cancel.slice(cancel.indexOf("function admin_cancel_reservation"), cancel.indexOf("function admin_complete_reservation"));
    expect(cancelBody).toMatch(/set status = 'cancelled'/);
    expect(cancelBody).not.toMatch(/confirmed_at/);
  });

  test("롤백 — 트랜잭션 · 함수 먼저 지우고 칸을 지운다 · 재실행 안전 · 코드 먼저 되돌리라는 안내", () => {
    const down = read(DOWN);
    expect(down).toMatch(/^begin;/m);
    expect(down).toMatch(/^commit;/m);
    const code0 = code(DOWN);
    expect(code0.indexOf("drop function if exists admin_set_feed_hidden")).toBeGreaterThanOrEqual(0);
    expect(code0.indexOf("drop function if exists admin_set_feed_hidden")).toBeLessThan(code0.indexOf("drop column if exists hidden_from_feed"));
    expect(down).toMatch(/코드를 먼저/);
    expect(down).toMatch(/migration repair --status reverted 0026/);
  });
});

describe("4. 숨기기 서버 액션 · 화면 배선", () => {
  const ACTION = "actions/admin/reservationFeed.ts";

  test("액션 — 'use server' 첫 줄 · export 하나(async) · 첫 문장 requireAdmin · 세션 클라이언트로 rpc · 서비스 롤 0", () => {
    const raw = read(ACTION);
    expect(raw.trimStart().startsWith('"use server"')).toBe(true);
    const src = code(ACTION);
    const exported = [...src.matchAll(/^export\s+(?!type\b|interface\b)(async\s+)?(function|const)\s+(\w+)/gm)];
    expect(exported.map((m) => [m[1]?.trim(), m[3]])).toEqual([["async", "setReservationFeedHidden"]]);
    expect(src).toMatch(/export async function setReservationFeedHidden\([^)]*\)[^{]*\{\s*await requireAdmin\(\);/);
    expect(src).toMatch(/admin_set_feed_hidden/);
    expect(src).toMatch(/p_hidden/);
    expect(/createServiceClient|SUPABASE_SERVICE_ROLE_KEY|service_role/.test(src)).toBe(false);
    // 홈이 바로 반영된다 — 홈 피드 태그와 관리자 경로를 무효화
    expect(src).toMatch(/QUERY_TAGS\.recent/);
  });

  test("화면 — 상세 페이지가 토글을 그리고, 토글은 확인 시트 없이 액션을 부르며 토스트로 알린다", () => {
    const page = code("app/admin/(protected)/reservations/[id]/page.tsx");
    expect(page).toMatch(/FeedHideToggle/);
    expect(page).toMatch(/hidden_from_feed/);
    const toggle = code("components/admin/FeedHideToggle.tsx");
    expect(toggle).toMatch(/setReservationFeedHidden/);
    expect(toggle).toMatch(/useAdminToast/);
    expect(toggle).not.toMatch(/AdminSheet|SheetTrigger/);
    expect(toggle).toMatch(/PendingButton/);
  });

  test("카피 — 숨기기·다시 보이기·상태 표시·결과 토스트가 admin.detail.feed 에만 있고, 홈 설명 문구는 만들지 않는다", () => {
    const feed = at(ko, "admin.detail.feed") as { [k: string]: string };
    for (const k of ["title", "hide", "show", "stateHidden", "resultHidden", "resultShown", "resultFailed", "processing"]) {
      expect(feed[k], `admin.detail.feed.${k}`).toBeTruthy();
    }
    expect(en.admin).toBeUndefined();
    expect(JSON.stringify(at(ko, "home"))).not.toMatch(/일 뿐|뿐입니다/);
  });
});
