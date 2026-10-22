/**
 * OF3-R4 — 접수/상담완료 두 상태 · 상담완료 문자 직접 보내기 (마이그레이션 0028 · OF3-requirements R4 10번).
 *
 *   1. 0028 SQL 텍스트 — 확정 통지 적재 제거 · body 칸 + CHECK · 부분 유니크(자동 통지에만) · 새 definer 함수(받는 번호 고정) ·
 *      권한(public·anon·authenticated·service_role 회수 → authenticated 만) · MAINTAIN 조건부 · 자기검증 · 롤백 파일 · 런북
 *   2. 문안 — 기본 문구(verbatim 없음) · 계약 정보 블록(원장 · 접수일 판) · 최종 본문 = 문구.trim() + 빈 줄 + 블록(언제나)
 *   3. 발송기 — body 행은 body 를 그대로, 키·body 짝이 어긋나면 unknown_template(보내지 않음)
 *   4. 문자 어댑터 — 직접 쓴 문자는 body 를 SMS/LMS 로(문안 변수 조회 없음) · 메일 어댑터는 받지 않는다
 *   5. 서버액션 sendConsultSms — 게이트 · zod · 상담완료 아님 · 상한 · RPC 인자(p_id · p_body 만) · 즉시 발송 트리거
 *   6. 상담완료는 자동 발송을 부르지 않는다(confirmReservation) · 즉시 발송 트리거에 "confirmed" 가 없다
 *   7. 관리자 화면 — 취소 진입 0 · 상담완료 뒤 [문자 보내기] · 시트(문구 칸 · 바이트 · 장문 안내 · 블록 미리보기 · [보내기][보내지 않음])
 *   8. 카피 — 자동 발송 문구 0 · 새 키 · 보낸 문자 기록
 *
 * 실제 문자는 나가지 않는다 — 제공자 호출은 가짜 fetch, 발송기는 memorySender, 서버액션의 즉시 발송은 모의.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/ports/after", () => ({ runAfter: vi.fn() }));
vi.mock("@/lib/ports/revalidate", () => ({ revalidate: vi.fn() }));
vi.mock("@/lib/log", () => ({ structuredLog: vi.fn() }));
vi.mock("@/lib/supabase/ssr", () => ({ createSsrClient: vi.fn() }));
vi.mock("@/lib/auth/requireAdmin", () => ({ requireAdmin: vi.fn(async () => ({ userId: "admin-uuid", email: "owner@example.test" })) }));
vi.mock("@/lib/notify/deps", () => ({ notifyAfterResponse: vi.fn(() => true) }));
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

import { sendConsultSms } from "@/actions/admin/consultSms";
import { confirmReservation } from "@/actions/admin/reservation";
import { ConsultSmsSheet } from "@/components/admin/ConsultSmsSheet";
import { ReservationProcess } from "@/components/admin/ReservationProcess";
import {
  blockBeforeSend,
  checkConsultSms,
  consultSmsReducer,
  initialConsultSmsState,
  smsByteLength,
} from "@/components/admin/consult-sms";
import { getReservationActionLabels } from "@/components/admin/reservationActionLabels";
import { toastHasLink, type ReservationActionLabels } from "@/components/admin/reservation-sheet";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { COMPANY, PAYMENT, VERBATIM } from "@/lib/legal/disclosures";
import { notifyAfterResponse } from "@/lib/notify/deps";
import {
  CONSULT_CONTRACT_MAX_CHARS,
  CONSULT_FREE_TEXT_MAX_CHARS,
  CONSULT_SMS_MAX_BYTES,
  SMS_SHORT_MAX_BYTES,
  joinConsultSms,
} from "@/lib/notify/consult-text";
import { resendSender } from "@/lib/notify/mail";
import {
  ALL_TEMPLATE_KEYS,
  CONSULT_SMS_TEMPLATE,
  MANUAL_TEMPLATE_KEYS,
  OUTBOX_TEMPLATE_KEYS,
} from "@/lib/notify/outbox";
import { memorySender } from "@/lib/notify/sender";
import { solapiSender, type SolapiDeps, type TemplateVarsPort } from "@/lib/notify/solapi";
import {
  CONTRACT_PARTY_LINE,
  LMS_BYTE_LIMIT,
  SMS_BYTE_LIMIT,
  consultContractBlock,
  consultSmsDefaultText,
  renderTemplate,
} from "@/lib/notify/templates";
import { runNotificationWorker, type WorkerDb } from "@/lib/notify/worker";
import { REFUND_POLICY_EFFECTIVE_DATE, refundPolicyAt } from "@/lib/refund-policy";
import { createSsrClient } from "@/lib/supabase/ssr";
import type { OutboxRow } from "@/lib/types";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const compact = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const UP = (() => {
  const f = readdirSync(MIGRATIONS).filter((n) => n.startsWith("0028_"));
  return f.length === 1 ? `supabase/migrations/${f[0]}` : "supabase/migrations/0028_(missing).sql";
})();
const DOWN = UP.replace("supabase/migrations/", "supabase/rollbacks/").replace(/\.sql$/, ".down.sql");

const RID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ORIGIN = "https://example.test";
/** 시행일 전날 정오 KST — 옛 규정 판 · 시행일 정오 KST — 개정 판. */
const dayBefore = (() => {
  const d = new Date(`${REFUND_POLICY_EFFECTIVE_DATE}T12:00:00+09:00`);
  return new Date(d.getTime() - 86_400_000).toISOString();
})();
const onEffective = new Date(`${REFUND_POLICY_EFFECTIVE_DATE}T12:00:00+09:00`).toISOString();

/** 함수 하나의 본문 — `create or replace function <name>(` 부터 다음 `$$;` 까지(주석 제거 · 소문자 · 공백 접기). */
function fnBody(sql: string, name: string): string {
  const code = compact(stripComments(sql, UP));
  const start = code.indexOf(`create or replace function ${name}(`);
  expect(start, `${name} 정의가 없다`).toBeGreaterThanOrEqual(0);
  const end = code.indexOf("$$;", code.indexOf("as $$", start) + 5);
  return code.slice(start, end);
}

// =============================================================================
// 1. 0028 SQL 텍스트
// =============================================================================
describe("1. supabase/migrations/0028 — 텍스트", () => {
  const sql = () => read(UP);
  const code = () => compact(stripComments(sql(), UP));

  test("0028 은 파일 하나 · 한 트랜잭션 가드(set local lock_timeout + 확인) · 롤백은 migrations/ 밖", () => {
    expect(existsSync(path.join(ROOT, UP)), UP).toBe(true);
    expect(code()).toContain("set local lock_timeout = '5s'");
    expect(code()).toMatch(/current_setting\('lock_timeout'\) <> '5s'/);
    expect(existsSync(path.join(ROOT, DOWN)), DOWN).toBe(true);
    expect(readdirSync(MIGRATIONS).filter((f) => f.includes(".down."))).toEqual([]);
  });

  test("상담완료 함수 — 같은 서명(create or replace · ACL 유지) · 첫 문장 가드 · 경합 방어 그대로 · 통지 insert 0 · enqueued 0", () => {
    const body = fnBody(sql(), "admin_confirm_reservation");
    expect(body).toContain("admin_confirm_reservation(p_id uuid, p_memo text default null) returns table (outcome text, public_code text, enqueued int)");
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public, pg_temp");
    expect(body).toMatch(/begin if not is_admin\(\) then raise exception 'admin_confirm_reservation: 관리자 명단에 없는 호출자다' using errcode = '42501';/);
    expect(body).toContain("update reservations set status = 'confirmed', confirmed_at = now(), admin_memo = coalesce(p_memo, admin_memo) where id = p_id and status = 'new'");
    expect(body, "상담완료가 여전히 통지를 큐에 넣는다").not.toContain("notifications_log");
    expect(body).toContain("'confirmed'::text, v_code, 0");
    // drop 하지 않는다 — drop + create 는 EXECUTE 를 공개 롤에 다시 연다(CLAUDE.md §3)
    expect(code()).not.toMatch(/drop function[^;]*admin_confirm_reservation/);
  });

  test("notifications_log.body — text · null 허용 · UTF-8 2000바이트 상한 · 빈 본문 금지 · 직접 쓴 문자 키(문자 채널)와 짝", () => {
    const c = code();
    expect(c).toContain("alter table notifications_log add column if not exists body text");
    expect(c).toMatch(/octet_length\(body\) <= 2000/);
    expect(c).toContain("body ~ '\\s'"); // compact() 가 소문자로 접는다 — 원문은 '\S'(공백 아닌 글자가 있다)
    expect(c).toContain("'consult.customer.sms'");
    expect(c).toMatch(/channel = 'sms'/);
    expect(CONSULT_SMS_MAX_BYTES).toBe(2000);
    expect(CONSULT_SMS_MAX_BYTES).toBe(LMS_BYTE_LIMIT);
  });

  test("부분 유니크 — 같은 이름으로 다시 만들고 body 없는 행(자동 통지)에만 건다 · 여러 번 보내는 직접 문자는 밖", () => {
    const c = code();
    expect(c).toContain("drop index if exists notifications_log_sent_once");
    expect(c).toContain(
      "create unique index notifications_log_sent_once on notifications_log (reservation_id, event, channel, template) where status = 'sent' and body is null",
    );
  });

  test("admin_send_reservation_sms — (p_id uuid, p_body text) 뿐(번호 인자 없음) · definer · search_path · 첫 문장 가드 · 예약의 번호 · 상담완료만 · pending 1건", () => {
    const body = fnBody(sql(), "admin_send_reservation_sms");
    expect(body).toContain("admin_send_reservation_sms(p_id uuid, p_body text) returns table (outcome text, notification_id bigint)");
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public, pg_temp");
    // 첫 문장이 가드다 — declare 의 변수 선언 다음 begin 바로 뒤
    expect(body).toMatch(/as \$\$ declare (?:v_\w+ +\w+; )+begin if not is_admin\(\) then raise exception 'admin_send_reservation_sms: 관리자 명단에 없는 호출자다' using errcode = '42501';/);
    expect(body).toMatch(/select r\.phone, r\.status, r\.confirmed_at into v_phone, v_status, v_confirmed from reservations r where r\.id = p_id/);
    expect(body).toMatch(/v_confirmed is null or v_status not in \('confirmed', 'done'\)/);
    expect(body).toContain(
      "insert into notifications_log (reservation_id, event, channel, to_phone, template, status, body) values (p_id, 'confirmed', 'sms', v_phone, 'consult.customer.sms', 'pending', p_body)",
    );
    expect(body).toMatch(/errcode = '22023'/);
    // 받는 번호는 인자에서 오지 않는다 — p_ 로 시작하는 인자는 둘뿐
    expect([...new Set(body.match(/\bp_[a-z_]+/g))].sort()).toEqual(["p_body", "p_id"]);
  });

  test("권한 — 새 함수: public·anon·authenticated·service_role 회수 후 authenticated 만 · 표: anon·authenticated 쓰기·TRUNCATE 재회수 · MAINTAIN 은 17+ 조건부 동적 SQL", () => {
    const c = code();
    expect(c).toContain("revoke all on function admin_send_reservation_sms(uuid, text) from public, anon, authenticated, service_role");
    expect(c).toContain("grant execute on function admin_send_reservation_sms(uuid, text) to authenticated");
    expect(c.indexOf("grant execute on function admin_send_reservation_sms")).toBeGreaterThan(c.indexOf("revoke all on function admin_send_reservation_sms"));
    expect(c).toMatch(/revoke insert, update, delete, truncate, references, trigger on table notifications_log from public, anon, authenticated/);
    expect(c).toMatch(/current_setting\('server_version_num'\)::int >= 170000 then execute 'revoke maintain on table public\.notifications_log from public, anon, authenticated'/);
  });

  test("자기검증 do 블록 — 칸 모양 · 칸 권한 · 함수 EXECUTE 보유자 · definer · search_path · 가드 · 상담완료 함수가 통지를 넣지 않음 · 인덱스 술어", () => {
    const c = code();
    const check = c.slice(c.lastIndexOf("do $$"));
    for (const needle of [
      "has_column_privilege",
      "has_function_privilege",
      "aclexplode",
      "prosecdef",
      "proconfig",
      "pg_get_indexdef",
      "notifications_log_sent_once",
      "admin_confirm_reservation",
      "has_table_privilege",
    ]) {
      expect(check, needle).toContain(needle);
    }
    expect(check).toContain("raise exception '0028:");
  });

  test("롤백 파일 — 코드 먼저 · 직접 쓴 문자 행이 있으면 멈춤(승인 플래그) · 0010 의 상담완료(통지 적재) 복원 + revoke/grant · 함수·칸·제약 제거 · 인덱스 원래 술어", () => {
    const down = compact(stripComments(read(DOWN), DOWN));
    const raw = read(DOWN);
    expect(raw).toMatch(/코드를 먼저/);
    expect(down).toContain("begin;");
    expect(down).toContain("commit;");
    expect(down).toMatch(/besttour\.rollback_0028_drop_sms/);
    expect(down).toContain("raise exception");
    expect(down).toContain("drop function if exists admin_send_reservation_sms(uuid, text)");
    expect(down).toContain("create or replace function admin_confirm_reservation(p_id uuid, p_memo text default null)");
    expect(down).toContain("insert into notifications_log (reservation_id, event, channel, to_phone, template, status)");
    expect(down).toContain("revoke all on function admin_confirm_reservation(uuid, text) from public, anon, service_role");
    expect(down).toContain("grant execute on function admin_confirm_reservation(uuid, text) to authenticated");
    expect(down).toContain(
      "create unique index notifications_log_sent_once on notifications_log (reservation_id, event, channel, template) where status = 'sent'",
    );
    expect(down).toContain("drop column if exists body");
    // 멈춤 판정이 지우기보다 먼저다
    expect(down.indexOf("raise exception")).toBeLessThan(down.indexOf("drop column if exists body"));
  });

  test("런북 — 0028 절(배포 순서 DB → 코드 · 롤백 코드 먼저 · 남은 confirmed 대기 행 확인 질의)", () => {
    const rb = read("docs/ops/migration-runbook.md");
    const at = rb.indexOf("## 0028");
    expect(at, "런북에 0028 절이 없다").toBeGreaterThanOrEqual(0);
    const sec = rb.slice(at, rb.indexOf("\n## ", at + 5) === -1 ? undefined : rb.indexOf("\n## ", at + 5));
    expect(sec).toContain("supabase/rollbacks/0028_");
    expect(sec).toMatch(/DB → 코드/);
    expect(sec).toMatch(/코드 먼저/);
    expect(sec).toContain("confirmed.customer.sms");
  });
});

// =============================================================================
// 2. 문안 — 기본 문구 · 계약 정보 블록 · 최종 본문
// =============================================================================
describe("2. 문안 (lib/notify/templates.ts · lib/notify/consult-text.ts)", () => {
  test("기본 문구 — 확정 문자의 인사·안내(제목 · 예약 확인·변경) · verbatim 없음 · 계약 블록 없음", () => {
    const t = consultSmsDefaultText(ORIGIN);
    expect(t.split("\n")[0]).toBe(`[${COMPANY.brandName}] 상담 완료 · 예약 확정 안내`);
    expect(t).toContain(`${ORIGIN}/reservation/check`);
    expect(t).toContain(`${ORIGIN}/guide`);
    expect(t).toContain(COMPANY.consultTel);
    expect(t, "기본 칸에 verbatim 이 들어갔다(뜻이 뒤집힌다)").not.toContain(VERBATIM.bookingNotice);
    expect(t).not.toContain("■ 대금");
    expect(t).not.toContain("■ 취소·환불");
    expect(t).not.toContain(CONTRACT_PARTY_LINE);
  });

  test("계약 정보 블록 — ■ 대금(원장) · ■ 취소·환불(접수일 판) · 계약 주체 줄이 맨 끝 · 옛/개정 판이 갈린다", () => {
    for (const createdAt of [dayBefore, onEffective]) {
      const block = consultContractBlock(createdAt);
      const policy = refundPolicyAt(createdAt);
      for (const line of [
        "■ 대금",
        `- ${PAYMENT.smsDeposit}`,
        `- ${PAYMENT.smsBalance}`,
        `- ${PAYMENT.smsAccount}`,
        `  ${PAYMENT.smsAccountHolder}`,
        "■ 취소·환불",
        `- ${policy.cancellation.smsItem}`,
        `- ${policy.withdrawal.smsLine}`,
      ]) {
        expect(block.split("\n"), `${createdAt}: ${line}`).toContain(line);
      }
      expect(block.split("\n").at(-1)).toBe(CONTRACT_PARTY_LINE);
      expect(block).not.toContain(VERBATIM.bookingNotice);
    }
    expect(consultContractBlock(dayBefore)).not.toBe(consultContractBlock(onEffective));
  });

  test("블록은 옛 확정 문자 템플릿이 원장에서 만들던 ■ 대금 · ■ 취소·환불 줄과 글자 그대로 같다(같은 함수)", () => {
    const legacy = renderTemplate("confirmed.customer.sms", { publicCode: "ABCD2345", origin: ORIGIN, createdAt: dayBefore }).text;
    const block = consultContractBlock(dayBefore);
    const sections = block.slice(0, block.lastIndexOf("\n\n"));
    expect(legacy).toContain(sections);
  });

  test("최종 본문 = 문구.trim() + 빈 줄 + 계약 정보.trim() (OF3-R4b) — 계약 정보를 전부 지우면 빈 줄 없이 문구만 · 문구가 비면 계약 정보만 · 둘 다 비면 빈 글자", () => {
    const block = consultContractBlock(onEffective);
    expect(joinConsultSms("  안녕하세요\n", block)).toBe(`안녕하세요\n\n${block}`);
    expect(joinConsultSms("  안녕하세요\n", `\n  ${block}  \n`)).toBe(`안녕하세요\n\n${block}`);
    expect(joinConsultSms("안녕하세요", "")).toBe("안녕하세요");
    expect(joinConsultSms("안녕하세요", " \n ")).toBe("안녕하세요");
    expect(joinConsultSms("  ", block)).toBe(block);
    expect(joinConsultSms(" ", "\n")).toBe("");
    // 줄바꿈은 LF 하나로 — 브라우저 textarea 의 CRLF 가 바이트 수를 갈리게 하지 않는다
    expect(joinConsultSms("가\r\n나", "다\r\n라")).toBe("가\n나\n\n다\n라");
    expect(SMS_SHORT_MAX_BYTES).toBe(SMS_BYTE_LIMIT);
  });

  test("서버는 계약 정보를 다시 만들지 않는다 — composeConsultSms 는 없다(기본 블록 함수 consultContractBlock 은 시트 기본값용으로 남는다)", () => {
    expect(codeOf("lib/notify/templates.ts")).not.toMatch(/export function composeConsultSms/);
    expect(codeOf("lib/notify/templates.ts")).toMatch(/export function consultContractBlock/);
  });

  test("기본 문구 + 기본 블록은 2000바이트 안에 들어간다 — 손대지 않고 보내도 상한을 넘지 않는다", () => {
    const body = joinConsultSms(consultSmsDefaultText("https://bestour.co.kr"), consultContractBlock(onEffective));
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(CONSULT_SMS_MAX_BYTES);
    expect(smsByteLength(body)).toBe(Buffer.byteLength(body, "utf8"));
  });
});

// =============================================================================
// 3. 발송기 — body 를 그대로
// =============================================================================
function fakeDb(rows: OutboxRow[]): WorkerDb & { failed: { id: number; error: string }[]; sent: number[] } {
  const failed: { id: number; error: string }[] = [];
  const sent: number[] = [];
  let queue = [...rows];
  return {
    failed,
    sent,
    reapStale: async () => [],
    claimPending: async (limit) => {
      const out = queue.slice(0, limit);
      queue = queue.slice(limit);
      return out;
    },
    markSent: async (id) => {
      sent.push(id);
      return true;
    },
    markFailed: async (row, error) => {
      failed.push({ id: row.id, error });
    },
    quarantineSentUnmarked: async () => {},
    listQuarantined: async () => [],
    rowStatus: async () => null,
    enqueueFailureNotice: async () => [],
    pendingStats: async () => ({ pending: 0, truncated: false, oldestCreatedAt: null, wouldReap: 0 }),
  };
}
const NOW = new Date("2026-10-22T03:00:00.000Z");
const outboxRow = (over: Partial<OutboxRow>): OutboxRow => ({
  id: 1,
  reservation_id: RID,
  event: "confirmed",
  channel: "sms",
  to: "+821055556666",
  template: CONSULT_SMS_TEMPLATE,
  status: "pending",
  attempts: 1,
  last_error: null,
  next_attempt_at: new Date(NOW.getTime() + 300_000).toISOString(),
  updated_at: NOW.toISOString(),
  body: "직접 쓴 본문",
  ...over,
});

describe("3. 발송기 (lib/notify/worker.ts)", () => {
  test("키 목록 — 직접 쓴 문자 키는 렌더 키(ALL_TEMPLATE_KEYS) 밖 · 아웃박스 키(OUTBOX_TEMPLATE_KEYS) 안", () => {
    expect([...MANUAL_TEMPLATE_KEYS]).toEqual(["consult.customer.sms"]);
    expect(ALL_TEMPLATE_KEYS as readonly string[]).not.toContain(CONSULT_SMS_TEMPLATE);
    expect([...OUTBOX_TEMPLATE_KEYS]).toEqual([...ALL_TEMPLATE_KEYS, CONSULT_SMS_TEMPLATE]);
  });

  test("body 행 → sender 가 body 를 그대로 받는다(키 = consult.customer.sms) · sent", async () => {
    const db = fakeDb([outboxRow({ id: 7 })]);
    const sender = memorySender();
    const report = await runNotificationWorker({ dryRun: false }, { db, sender, now: () => NOW, log: () => {} });
    expect(sender.calls).toEqual([
      { id: 7, channel: "sms", to: "+821055556666", template: CONSULT_SMS_TEMPLATE, reservationId: RID, body: "직접 쓴 본문" },
    ]);
    expect(report.sent).toBe(1);
  });

  test("짝이 어긋난 행은 보내지 않는다 — 직접 쓴 문자 키인데 body 없음 · 자동 통지 키인데 body 있음 → unknown_template", async () => {
    const db = fakeDb([outboxRow({ id: 8, body: null }), outboxRow({ id: 9, template: "confirmed.customer.sms", body: "끼워 넣은 본문" })]);
    const sender = memorySender();
    await runNotificationWorker({ dryRun: false }, { db, sender, now: () => NOW, log: () => {} });
    expect(sender.calls).toEqual([]);
    expect(db.failed).toEqual([
      { id: 8, error: "unknown_template" },
      { id: 9, error: "unknown_template" },
    ]);
  });

  test("자동 통지(body 없음)는 예전 그대로 — sender 요청에 body 가 실리지 않는다", async () => {
    const db = fakeDb([outboxRow({ id: 10, event: "created", template: "created.customer.sms", body: null })]);
    const sender = memorySender();
    await runNotificationWorker({ dryRun: false }, { db, sender, now: () => NOW, log: () => {} });
    expect(sender.calls).toHaveLength(1);
    expect("body" in sender.calls[0]).toBe(false);
  });
});

// =============================================================================
// 4. 문자·메일 어댑터
// =============================================================================
describe("4. 어댑터 — 직접 쓴 문자는 SMS/LMS 로 body 그대로 · 메일은 받지 않는다", () => {
  const varsPort: TemplateVarsPort & { calls: number } = {
    calls: 0,
    async ownerVars() {
      this.calls += 1;
      return null;
    },
    async customerVars() {
      this.calls += 1;
      return null;
    },
  };
  function solapiDeps(fetch: SolapiDeps["fetch"]): SolapiDeps {
    return {
      apiKey: "K",
      apiSecret: "S",
      from: "15666189",
      fetch,
      now: () => NOW,
      randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => i),
      log: () => {},
      vars: varsPort,
    };
  }
  const accepted = () =>
    new Response(JSON.stringify({ groupInfo: { groupId: "G1", count: { registeredSuccess: 1 } }, failedMessageList: [], messageList: [{ messageId: "M1" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  test("긴 본문 → LMS · 짧은 본문 → SMS · text = body · 문안 변수 조회 0 · 알림톡 아님", async () => {
    const bodies: { text: string; type: string }[] = [];
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push((JSON.parse(String(init.body)) as { messages: { text: string; type: string }[] }).messages[0]);
      return accepted();
    });
    const sender = solapiSender(solapiDeps(fetch));
    const long = joinConsultSms("안녕하세요. 상담 내용입니다.", consultContractBlock(onEffective));
    expect(await sender.send({ id: 1, channel: "sms", to: "+821055556666", template: CONSULT_SMS_TEMPLATE, reservationId: RID, body: long })).toEqual({
      ok: true,
      providerMessageId: "M1",
    });
    expect(await sender.send({ id: 2, channel: "sms", to: "+821055556666", template: CONSULT_SMS_TEMPLATE, reservationId: RID, body: "짧은 안내" })).toMatchObject({ ok: true });
    expect(bodies).toEqual([
      { text: long, type: "LMS", to: "01055556666", from: "15666189", autoTypeDetect: false },
      { text: "짧은 안내", type: "SMS", to: "01055556666", from: "15666189", autoTypeDetect: false },
    ]);
    expect(varsPort.calls).toBe(0);
  });

  test("직접 쓴 문자 키인데 body 가 없거나 2000바이트를 넘으면 보내지 않는다(제공자 호출 0)", async () => {
    const fetch = vi.fn(async () => accepted());
    const sender = solapiSender(solapiDeps(fetch));
    expect(await sender.send({ id: 3, channel: "sms", to: "+821055556666", template: CONSULT_SMS_TEMPLATE, reservationId: RID })).toMatchObject({
      ok: false,
      error: "template_render_failed",
      retryable: false,
    });
    expect(
      await sender.send({ id: 4, channel: "sms", to: "+821055556666", template: CONSULT_SMS_TEMPLATE, reservationId: RID, body: "가".repeat(700) }),
    ).toMatchObject({ ok: false, error: "template_render_failed", retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("메일 어댑터는 직접 쓴 문자를 보내지 않는다", async () => {
    const fetch = vi.fn(async () => accepted());
    const mail = resendSender({ apiKey: "re_x", from: "noreply@example.test", fetch, log: () => {}, vars: varsPort, now: () => NOW });
    const out = await mail.send({ id: 5, channel: "email", to: "owner@example.test", template: CONSULT_SMS_TEMPLATE, reservationId: RID, body: "x" });
    expect(out).toMatchObject({ ok: false, retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 5. 서버액션 sendConsultSms
// =============================================================================
interface FakeDbCalls {
  rpc: { fn: string; args: Record<string, unknown> }[];
  selects: string[];
}
function ssrClient(opts: { row?: Record<string, unknown> | null; readError?: unknown; rpcData?: unknown; rpcError?: unknown }): { client: unknown; calls: FakeDbCalls } {
  const calls: FakeDbCalls = { rpc: [], selects: [] };
  const client = {
    from(table: string) {
      expect(table).toBe("reservations");
      const b: Record<string, unknown> = {};
      b.select = (cols: string) => {
        calls.selects.push(cols);
        return b;
      };
      b.eq = () => b;
      b.maybeSingle = async () => ({ data: opts.row ?? null, error: opts.readError ?? null });
      return b;
    },
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.rpc.push({ fn, args });
      return { data: opts.rpcData ?? null, error: opts.rpcError ?? null };
    }),
  };
  return { client, calls };
}
const consultedRow = { status: "confirmed", confirmed_at: "2026-10-20T01:00:00Z" };
/** 시트가 열 때 채우는 기본 계약 정보(서버가 원장으로 만들어 내린 글자) — 클라이언트가 그대로 또는 고쳐서 돌려보낸다(OF3-R4b). */
const DEFAULT_CONTRACT = consultContractBlock(onEffective);

describe("5. 서버액션 sendConsultSms (actions/admin/consultSms.ts)", () => {
  beforeEach(() => {
    vi.mocked(notifyAfterResponse).mockClear();
    vi.mocked(createSsrClient).mockReset();
    vi.mocked(requireAdmin).mockClear();
  });

  test("성공 — 예약을 읽고(상태·상담완료 시각만) 최종 본문 = 문구.trim() + 빈 줄 + 클라이언트가 보낸 기본 계약 정보로 RPC 1회 · 인자는 p_id · p_body 뿐 · 즉시 발송 'consult_sms'", async () => {
    const { client, calls } = ssrClient({ row: consultedRow, rpcData: [{ outcome: "queued", notification_id: 41 }] });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    const result = await sendConsultSms(RID, "  안녕하세요, 상담 내용입니다.  ", DEFAULT_CONTRACT);
    expect(result).toEqual({ ok: true, code: "queued" });
    expect(requireAdmin).toHaveBeenCalledTimes(1);
    expect(calls.selects).toEqual(["status,confirmed_at"]);
    expect(calls.rpc).toEqual([
      { fn: "admin_send_reservation_sms", args: { p_id: RID, p_body: `안녕하세요, 상담 내용입니다.\n\n${DEFAULT_CONTRACT}` } },
    ]);
    expect(Object.keys(calls.rpc[0].args).sort()).toEqual(["p_body", "p_id"]);
    expect(notifyAfterResponse).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyAfterResponse).mock.calls[0][0]).toBe("consult_sms");
  });

  test("고친 계약 정보는 그대로 본문에 들어간다 — 서버가 원장 블록으로 되돌리지 않는다(OF3-R4b)", async () => {
    const { client, calls } = ssrClient({ row: consultedRow, rpcData: [{ outcome: "queued", notification_id: 41 }] });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    const edited = DEFAULT_CONTRACT.replace(PAYMENT.smsDeposit, "계약금은 통화로 정한 금액으로 받습니다");
    expect(edited).not.toBe(DEFAULT_CONTRACT);
    expect(await sendConsultSms(RID, "안녕하세요", edited)).toEqual({ ok: true, code: "queued" });
    const body = String(calls.rpc[0].args.p_body);
    expect(body).toBe(`안녕하세요\n\n${edited}`);
    expect(body).toContain("계약금은 통화로 정한 금액으로 받습니다");
    expect(body).not.toContain(PAYMENT.smsDeposit);
  });

  test("계약 정보를 전부 지우면 문구만 간다(빈 줄 없음) · 문구가 비어도 계약 정보가 있으면 계약 정보만 간다 · 줄바꿈은 LF", async () => {
    for (const [text, contract, expected] of [
      ["안녕하세요", "  \n ", "안녕하세요"],
      ["  ", DEFAULT_CONTRACT, DEFAULT_CONTRACT],
      ["가\r\n나", "다\r\n라", "가\n나\n\n다\n라"],
    ] as const) {
      const { client, calls } = ssrClient({ row: consultedRow, rpcData: [{ outcome: "queued", notification_id: 41 }] });
      vi.mocked(createSsrClient).mockReturnValue(client as never);
      expect(await sendConsultSms(RID, text, contract), expected.slice(0, 12)).toEqual({ ok: true, code: "queued" });
      expect(calls.rpc[0].args.p_body).toBe(expected);
    }
  });

  test("입력 검증 — uuid 아님 · 문구와 계약 정보가 둘 다 비면 · 상한 초과 · 제어문자 · 문자열 아님 · 계약 정보 인자 없음 → invalid · DB 0", async () => {
    for (const [id, text, contract] of [
      ["not-a-uuid", "안녕", DEFAULT_CONTRACT],
      [RID, "   \n ", "  \n "],
      [RID, "", ""],
      [RID, "가".repeat(CONSULT_FREE_TEXT_MAX_CHARS + 1), DEFAULT_CONTRACT],
      [RID, "안녕", "가".repeat(CONSULT_CONTRACT_MAX_CHARS + 1)],
      [RID, "안내\u0007벨", DEFAULT_CONTRACT],
      [RID, "안녕", "계약\u0007정보"],
      [RID, 42 as unknown as string, DEFAULT_CONTRACT],
      [RID, "안녕", 42 as unknown as string],
      [RID, "안녕", undefined as unknown as string],
      [RID, "안녕", null as unknown as string],
    ] as const) {
      expect(await sendConsultSms(id, text, contract), `${id}/${String(text).slice(0, 10)}/${String(contract).slice(0, 10)}`).toEqual({ ok: false, code: "invalid" });
    }
    expect(createSsrClient).not.toHaveBeenCalled();
    expect(notifyAfterResponse).not.toHaveBeenCalled();
  });

  test("상담완료가 아닌 예약(new · 취소 · confirmed_at 없음 · 없음) → notConsulted · RPC 0", async () => {
    for (const row of [
      { ...consultedRow, status: "new", confirmed_at: null },
      { ...consultedRow, status: "cancelled" },
      { ...consultedRow, confirmed_at: null },
      null,
    ]) {
      const { client, calls } = ssrClient({ row });
      vi.mocked(createSsrClient).mockReturnValue(client as never);
      expect(await sendConsultSms(RID, "안녕하세요", DEFAULT_CONTRACT), JSON.stringify(row)).toEqual({ ok: false, code: "notConsulted" });
      expect(calls.rpc).toEqual([]);
    }
    expect(notifyAfterResponse).not.toHaveBeenCalled();
  });

  test("최종 본문이 2000바이트를 넘으면(두 칸의 합) tooLong · RPC 0", async () => {
    const { client, calls } = ssrClient({ row: consultedRow });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    expect(await sendConsultSms(RID, "가".repeat(CONSULT_FREE_TEXT_MAX_CHARS), "")).toEqual({ ok: false, code: "tooLong" });
    // 칸 하나씩은 상한 안이어도 합이 넘으면 막는다
    expect(await sendConsultSms(RID, "가".repeat(400), "나".repeat(400))).toEqual({ ok: false, code: "tooLong" });
    // 경계 — 정확히 2000바이트는 통과
    const exact = joinConsultSms("a".repeat(900), "b".repeat(2000 - 900 - 2));
    expect(Buffer.byteLength(exact, "utf8")).toBe(CONSULT_SMS_MAX_BYTES);
    const ok = ssrClient({ row: consultedRow, rpcData: [{ outcome: "queued", notification_id: 41 }] });
    vi.mocked(createSsrClient).mockReturnValue(ok.client as never);
    expect(await sendConsultSms(RID, "a".repeat(900), "b".repeat(2000 - 900 - 2))).toEqual({ ok: true, code: "queued" });
    expect(ok.calls.rpc[0].args.p_body).toBe(exact);
    expect(calls.rpc).toEqual([]);
  });

  test("DB 가 상담완료 아님을 돌려주면 notConsulted · RPC 오류·이상한 응답·읽기 오류는 failed · 어느 쪽도 즉시 발송 0", async () => {
    for (const [opts, code] of [
      [{ row: consultedRow, rpcData: [{ outcome: "not_consulted", notification_id: null }] }, "notConsulted"],
      [{ row: consultedRow, rpcData: [{ outcome: "noop", notification_id: null }] }, "notConsulted"],
      [{ row: consultedRow, rpcError: { code: "42501", message: "denied" } }, "failed"],
      [{ row: consultedRow, rpcData: [{ outcome: "surprise" }] }, "failed"],
      [{ readError: { code: "XX000", message: "boom" } }, "failed"],
    ] as const) {
      const { client } = ssrClient(opts);
      vi.mocked(createSsrClient).mockReturnValue(client as never);
      expect(await sendConsultSms(RID, "안녕하세요", DEFAULT_CONTRACT), JSON.stringify(opts)).toEqual({ ok: false, code });
    }
    expect(notifyAfterResponse).not.toHaveBeenCalled();
  });

  test("정적 — 'use server' · export 는 이 함수 하나 · 첫 문장 게이트 · 서비스 롤 0 · env 0 · 로그에 본문 0", () => {
    const src = codeOf("actions/admin/consultSms.ts");
    expect(src).toMatch(/^"use server";/);
    expect(src.match(/export async function/g)).toHaveLength(1);
    expect(src).toMatch(/export async function sendConsultSms\(id: string, freeText: string, contract: string\)[^{]*\{\s*await requireAdmin\(\);/);
    // 계약 정보는 클라이언트가 보낸 글자를 쓴다 — 서버가 원장에서 다시 만들어 덮지 않는다(OF3-R4b)
    expect(src).not.toMatch(/composeConsultSms|consultContractBlock|refundPolicyAt|created_at/);
    expect(src).toMatch(/joinConsultSms\(/);
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE_KEY|supabase\/server|process\.env/);
    expect(src.match(/notifyAfterResponse\(/g)).toHaveLength(1);
    expect(src).toMatch(/notifyAfterResponse\("consult_sms", runAfter\)/);
    expect(src).not.toMatch(/structuredLog\([^)]*(body|text|freeText|contract)/);
  });
});

// =============================================================================
// 6. 상담완료는 자동 발송을 부르지 않는다
// =============================================================================
describe("6. 상담완료 — 자동 발송 없음", () => {
  test("confirmReservation 성공해도 즉시 발송을 부르지 않는다 · 소스에 notifyAfterResponse 0", async () => {
    vi.mocked(notifyAfterResponse).mockClear();
    vi.mocked(createSsrClient).mockReturnValue({
      rpc: vi.fn(async () => ({ data: [{ outcome: "confirmed", public_code: "BT123456", enqueued: 0 }], error: null })),
    } as never);
    expect(await confirmReservation(RID)).toEqual({ ok: true, changed: true, code: "confirmed" });
    expect(notifyAfterResponse).not.toHaveBeenCalled();
    expect(codeOf("actions/admin/reservation.ts")).not.toMatch(/notifyAfterResponse/);
  });

  test("즉시 발송 트리거 어휘에 'confirmed' 가 없다 — 접수(created)와 직접 쓴 문자(consult_sms)뿐", () => {
    expect(codeOf("lib/notify/inline.ts")).toMatch(/export type InlineTrigger = "created" \| "consult_sms";/);
  });

  test("예약 통지 계획(planNotifications)은 접수만 만든다 — 확정 통지 분기는 도달할 수 없다", () => {
    const src = codeOf("lib/notify/outbox.ts");
    expect(src).toMatch(/export function planNotifications\(reservation: ReservationForNotify, event: "created", opts: PlanOptions\)/);
    expect(src).not.toMatch(/newRow\([^)]*"confirmed\.customer\.sms"\)/);
  });
});

// =============================================================================
// 7. 관리자 화면
// =============================================================================
let labelsCache: ReservationActionLabels | null = null;
async function labels(): Promise<ReservationActionLabels> {
  labelsCache ??= await getReservationActionLabels();
  return labelsCache;
}
const STATUSES = ["new", "confirmed", "done", "cancelled"] as const;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe("7. 관리자 화면", () => {
  test("처리 카드·휴대폰 맨 아래 — 어느 상태에서도 취소 진입이 없다", async () => {
    for (const status of STATUSES) {
      for (const layout of ["card", "mobile"] as const) {
        const html = renderToStaticMarkup(createElement(ReservationProcess, { id: RID, status, labels: await labels(), layout }));
        expect(html, `${status}/${layout}`).not.toContain('data-sheet="cancel"');
        expect(html, `${status}/${layout}`).not.toContain("admin-cancel");
      }
    }
  });

  test("처리 카드 — 새 접수: [상담완료로 바꾸기] + 자동 발송 없음 안내 · 상담완료: [문자 보내기](주) + [운행 완료로 바꾸기] · 운행 완료: [문자 보내기] · 옛 취소 기록: 한 줄", async () => {
    const l = await labels();
    const card = async (status: (typeof STATUSES)[number]) => renderToStaticMarkup(createElement(ReservationProcess, { id: RID, status, labels: l, layout: "card" }));
    const neu = await card("new");
    expect(neu).toContain('data-sheet="confirm"');
    expect(neu).not.toContain('data-sheet="sms"');
    expect(text(neu)).toContain(l.confirmHint);
    const conf = await card("confirmed");
    expect(conf).toContain('data-testid="admin-sms-open"');
    expect(conf).toContain('data-sheet="sms"');
    expect(conf).toContain('data-sheet="complete"');
    expect(conf.indexOf('data-sheet="sms"')).toBeLessThan(conf.indexOf('data-sheet="complete"'));
    expect(text(conf)).toContain(l.sms.hint);
    const done = await card("done");
    expect(done).toContain('data-sheet="sms"');
    expect(done).not.toContain('data-sheet="complete"');
    const cancelled = await card("cancelled");
    expect(cancelled).not.toContain("data-sheet=");
    expect(text(cancelled)).toContain(l.processCancelled);
  });

  test("상세 페이지 — 위 제목줄 ⋯ 취소 없음 · 행동 바: 새 접수 = 상담완료 · 상담완료·운행 완료 = [문자 보내기] 시트", () => {
    const page = codeOf("app/admin/(protected)/reservations/[id]/page.tsx");
    expect(page).not.toMatch(/kind="cancel"/);
    expect(page).not.toMatch(/moreCancel|canCancel/);
    expect(page).toMatch(/kind="sms"/);
    expect(page).toMatch(/testId="admin-bar-sms"/);
  });

  test("처리 영역 — 취소 액션을 부르는 길이 화면에 없다(서버액션·DB 함수는 남는다)", () => {
    const actions = codeOf("components/admin/ReservationActions.tsx");
    expect(actions).not.toMatch(/cancelReservation/);
    expect(codeOf("actions/admin/reservation.ts")).toMatch(/export async function cancelReservation/);
    expect(codeOf("components/admin/reservation-sheet.ts")).toMatch(/export const SHEET_KINDS = \["confirm", "complete"\] as const;/);
  });

  const sheetHtml = async (over: Record<string, unknown> = {}) => {
    const l = await labels();
    const block = consultContractBlock(onEffective);
    const draft = consultSmsDefaultText(ORIGIN);
    return {
      l,
      block,
      draft,
      html: renderToStaticMarkup(
        createElement(ConsultSmsSheet, {
          labels: l.sms,
          processing: l.processing,
          slowNote: l.sheet.slow,
          customerName: "",
          text: draft,
          block,
          contract: block,
          banner: null,
          bannerAttempt: 0,
          pending: false,
          slow: false,
          onText: () => {},
          onContract: () => {},
          onResetContract: () => {},
          onClose: () => {},
          onSubmit: () => {},
          ...over,
        }),
      ),
    };
  };

  test("문자 시트 — 문구 칸(기본값) · 계약 정보 편집 칸(기본값 = 원장 블록) · 바이트 · 90바이트 넘으면 장문 안내 · [보내기][보내지 않음] (OF3-R4b)", async () => {
    const { l, block, draft, html } = await sheetHtml();
    expect(html).toContain('data-testid="admin-sheet-sms"');
    expect(html).toMatch(/<textarea[^>]*data-testid="admin-sms-text"/);
    expect(text(html)).toContain(draft.split("\n")[0]);
    // 계약 정보 = 읽기 전용 <pre> 가 아니라 편집 칸(textarea) — 기본값은 서버가 내린 원장 블록 그대로
    expect(html).toMatch(/<textarea[^>]*data-testid="admin-sms-contract"/);
    expect(html).not.toMatch(/<pre[^>]*data-testid="admin-sms-block"/);
    expect(html).not.toContain("<pre");
    const contractTag = /<textarea[^>]*data-testid="admin-sms-contract"[^>]*>([\s\S]*?)<\/textarea>/.exec(html);
    expect(contractTag, "계약 정보 textarea").not.toBeNull();
    expect(text(contractTag![1])).toContain("■ 대금");
    expect(text(contractTag![1])).toContain(text(block.split("\n")[0]));
    expect(html).not.toMatch(/<textarea[^>]*data-testid="admin-sms-contract"[^>]*readonly/i);
    const bytes = smsByteLength(joinConsultSms(draft, block));
    expect(text(html)).toContain(bytes.toLocaleString("ko-KR"));
    expect(text(html)).toContain(l.sms.long);
    expect(text(html)).toContain(l.sms.submit);
    expect(text(html)).toContain(l.sms.skip);
    expect(text(html)).not.toContain(VERBATIM.bookingNotice);
    // 고치지 않았으면 안내·되돌리기 버튼이 없다
    expect(html).not.toContain('data-testid="admin-sms-contract-changed"');
    expect(html).not.toContain('data-testid="admin-sms-contract-reset"');
  });

  test("문자 시트 — 계약 정보를 기본값과 다르게 고치면 작은 안내 + [기본 내용으로 되돌리기] · 지워도 같다 · 줄바꿈만 CRLF 로 다른 것은 고친 것이 아니다", async () => {
    const edited = await sheetHtml({ contract: "내가 고친 계약 정보" });
    expect(edited.html).toContain('data-testid="admin-sms-contract-changed"');
    expect(text(edited.html)).toContain(edited.l.sms.contractChanged);
    expect(edited.html).toMatch(/<button[^>]*type="button"[^>]*data-testid="admin-sms-contract-reset"|<button[^>]*data-testid="admin-sms-contract-reset"[^>]*type="button"/);
    expect(text(edited.html)).toContain(edited.l.sms.contractReset);
    const cleared = await sheetHtml({ contract: "" });
    expect(cleared.html).toContain('data-testid="admin-sms-contract-reset"');
    const crlf = await sheetHtml({ contract: consultContractBlock(onEffective).replace(/\n/g, "\r\n") });
    expect(crlf.html).not.toContain('data-testid="admin-sms-contract-reset"');
    // 처리 중에는 되돌리기도 막는다
    const pending = await sheetHtml({ contract: "고침", pending: true });
    expect(pending.html).toMatch(/<button[^>]*data-testid="admin-sms-contract-reset"[^>]*disabled|<button[^>]*disabled[^>]*data-testid="admin-sms-contract-reset"/);
    expect(pending.html).toMatch(/<textarea[^>]*disabled[^>]*data-testid="admin-sms-contract"|<textarea[^>]*data-testid="admin-sms-contract"[^>]*disabled/);
  });

  test("문자 시트 — 바이트 수는 두 칸의 합(최종 본문 기준) · 합이 2000바이트를 넘으면 빨강 표시", async () => {
    const both = await sheetHtml({ text: "안녕하세요", contract: "계약" });
    expect(text(both.html)).toContain(smsByteLength(joinConsultSms("안녕하세요", "계약")).toLocaleString("ko-KR"));
    const textOnly = await sheetHtml({ text: "안녕하세요", contract: "" });
    expect(text(textOnly.html)).toContain(smsByteLength("안녕하세요").toLocaleString("ko-KR"));
    const over = await sheetHtml({ text: "가".repeat(400), contract: "나".repeat(400) });
    expect(over.html).toMatch(/data-over="true"[^>]*data-testid="admin-sms-bytes"|data-testid="admin-sms-bytes"[^>]*data-over="true"/);
  });

  test("판정 — 둘 다 비면 empty · 문구만 비어도 계약 정보가 있으면 ok · 2000바이트 초과 · 90바이트 초과(장문) · 기본", () => {
    const block = consultContractBlock(onEffective);
    expect(checkConsultSms("   ", "  \n")).toMatchObject({ kind: "empty" });
    expect(checkConsultSms("   ", block)).toMatchObject({ kind: "ok" });
    expect(checkConsultSms("안녕", "")).toMatchObject({ kind: "ok", long: false });
    expect(checkConsultSms("가".repeat(700), block)).toMatchObject({ kind: "tooLong", max: CONSULT_SMS_MAX_BYTES });
    expect(checkConsultSms("가".repeat(400), "나".repeat(400))).toMatchObject({ kind: "tooLong" });
    expect(checkConsultSms("안녕", block)).toMatchObject({ kind: "ok", long: true });
    expect(checkConsultSms("hi", "x")).toMatchObject({ kind: "ok", long: false });
    expect(blockBeforeSend("  ", "")).toEqual({ kind: "empty" });
    expect(blockBeforeSend("", block)).toBeNull();
    expect(blockBeforeSend("안녕", "")).toBeNull();
    expect(blockBeforeSend("가".repeat(400), "나".repeat(400))).toMatchObject({ kind: "tooLong", max: CONSULT_SMS_MAX_BYTES });
  });

  test("상태 — 보내지 않음은 시트를 닫고 안내를 남긴다 · 보낸 뒤에는 기본 문구·기본 계약 정보로 돌아간다 · 실패·상담완료 아님은 시트 안 배너", () => {
    let s = initialConsultSmsState("기본", "블록");
    expect(s).toMatchObject({ text: "기본", block: "블록", contract: "블록" });
    s = consultSmsReducer(s, { type: "open", customerName: "홍" });
    expect(s).toMatchObject({ open: true, skipped: false, customerName: "홍", text: "기본", contract: "블록" });
    s = consultSmsReducer(s, { type: "edit", text: "고친 문구" });
    s = consultSmsReducer(s, { type: "skip" });
    expect(s).toMatchObject({ open: false, skipped: true, text: "고친 문구" });
    s = consultSmsReducer(s, { type: "open", customerName: "" });
    expect(s.skipped).toBe(false);
    s = consultSmsReducer(s, { type: "settled", result: { ok: false, code: "failed" } });
    expect(s).toMatchObject({ open: true, banner: { kind: "failed" } });
    s = consultSmsReducer(s, { type: "settled", result: { ok: false, code: "notConsulted" } });
    expect(s.banner).toEqual({ kind: "notConsulted" });
    s = consultSmsReducer(s, { type: "settled", result: { ok: true, code: "queued" } });
    expect(s).toMatchObject({ open: false, skipped: false, banner: null, text: "기본", contract: "블록" });
  });

  test("상태 — 계약 정보 고치기 · 되돌리기 · 열 때마다 기본값으로 · 지우고 보내면 '보내지 않음' 과 같은 안내를 남긴다(막지는 않는다)", () => {
    let s = initialConsultSmsState("기본", "블록");
    s = consultSmsReducer(s, { type: "open", customerName: "" });
    s = consultSmsReducer(s, { type: "contract", text: "고친 블록" });
    expect(s).toMatchObject({ contract: "고친 블록", banner: null });
    s = consultSmsReducer(s, { type: "resetContract" });
    expect(s).toMatchObject({ contract: "블록", text: "기본" });
    // 문구는 지켜진 채 계약 정보만 되돌아간다
    s = consultSmsReducer(s, { type: "edit", text: "고친 문구" });
    s = consultSmsReducer(s, { type: "contract", text: "또 고침" });
    s = consultSmsReducer(s, { type: "resetContract" });
    expect(s).toMatchObject({ contract: "블록", text: "고친 문구" });
    // 고친 채 보내지 않고 닫았다가 다시 열면 계약 정보는 기본값부터(열 때마다 기본값) — 문구는 그대로
    s = consultSmsReducer(s, { type: "contract", text: "고친 블록" });
    s = consultSmsReducer(s, { type: "skip" });
    s = consultSmsReducer(s, { type: "open", customerName: "" });
    expect(s).toMatchObject({ contract: "블록", text: "고친 문구" });
    // 고친 계약 정보로 보냈다 → 안내 없음 · 기본값으로 복귀
    s = consultSmsReducer(s, { type: "contract", text: "고친 블록" });
    s = consultSmsReducer(s, { type: "settled", result: { ok: true, code: "queued" } });
    expect(s).toMatchObject({ open: false, skipped: false, contract: "블록", text: "기본" });
    // 계약 정보를 지우고 보냈다 → 같은 안내("대금·취소 규정은 …")를 한 번 남긴다 · 기본값으로 복귀
    s = consultSmsReducer(s, { type: "open", customerName: "" });
    s = consultSmsReducer(s, { type: "contract", text: " \n " });
    s = consultSmsReducer(s, { type: "settled", result: { ok: true, code: "queued" } });
    expect(s).toMatchObject({ open: false, skipped: true, contract: "블록", text: "기본" });
    // 지웠지만 보내지 못했다(실패) → 시트 안 배너만, 안내는 아직 아니다
    s = consultSmsReducer(initialConsultSmsState("기본", "블록"), { type: "open", customerName: "" });
    s = consultSmsReducer(s, { type: "contract", text: "" });
    s = consultSmsReducer(s, { type: "settled", result: { ok: false, code: "failed" } });
    expect(s).toMatchObject({ open: true, skipped: false, banner: { kind: "failed" }, contract: "" });
    // 2000바이트 초과 배너의 바이트 수는 두 칸의 합
    s = consultSmsReducer(s, { type: "edit", text: "가".repeat(400) });
    s = consultSmsReducer(s, { type: "contract", text: "나".repeat(400) });
    s = consultSmsReducer(s, { type: "settled", result: { ok: false, code: "tooLong" } });
    expect(s.banner).toEqual({ kind: "tooLong", bytes: smsByteLength(joinConsultSms("가".repeat(400), "나".repeat(400))), max: CONSULT_SMS_MAX_BYTES });
  });

  test("상태 — 상담완료로 바뀐 뒤 새로고침이 두 조각을 처음 내려 주면 고치지 않은 문구·계약 정보는 새 기본값 · 고치던 것은 지킨다", () => {
    let s = initialConsultSmsState("", "");
    s = consultSmsReducer(s, { type: "draft", defaultText: "기본", block: "블록" });
    expect(s).toMatchObject({ text: "기본", defaultText: "기본", block: "블록", contract: "블록" });
    s = consultSmsReducer(s, { type: "edit", text: "고침" });
    s = consultSmsReducer(s, { type: "contract", text: "고친 블록" });
    s = consultSmsReducer(s, { type: "draft", defaultText: "새 기본", block: "새 블록" });
    expect(s).toMatchObject({ text: "고침", defaultText: "새 기본", block: "새 블록", contract: "고친 블록" });
    expect(consultSmsReducer(s, { type: "draft", defaultText: "새 기본", block: "새 블록" })).toBe(s);
    // 고치지 않은 계약 정보는 새 기본값을 따른다
    const fresh = consultSmsReducer(initialConsultSmsState("기본", "블록"), { type: "draft", defaultText: "기본", block: "새 블록" });
    expect(fresh.contract).toBe("새 블록");
    expect(codeOf("components/admin/ReservationActions.tsx")).toMatch(/smsDispatch\(\{ type: "draft", defaultText: sms\.defaultText, block: sms\.block \}\)/);
  });

  test("처리 영역 — 보내기는 문구와 계약 정보를 함께 서버액션에 넘긴다(블록을 서버가 만들지 않는다)", () => {
    const actions = codeOf("components/admin/ReservationActions.tsx");
    expect(actions).toMatch(/sendConsultSms\(id, text, contract\)/);
    expect(actions).toMatch(/blockBeforeSend\(smsState\.text, smsState\.contract\)/);
    expect(actions).toMatch(/onContract=\{\(contract\) => smsDispatch\(\{ type: "contract", text: contract \}\)\}/);
    expect(actions).toMatch(/onResetContract=\{\(\) => smsDispatch\(\{ type: "resetContract" \}\)\}/);
  });

  test("토스트 — 발송 기록 링크는 문자 발송 토스트에만(상담완료는 문자를 보내지 않는다)", () => {
    expect(toastHasLink("smsQueued")).toBe(true);
    expect(toastHasLink("confirmed")).toBe(false);
  });
});

// =============================================================================
// 8. 카피
// =============================================================================
describe("8. 관리자 카피 (messages/ko.json)", () => {
  const ko = JSON.parse(read("messages/ko.json")) as { admin: Record<string, unknown> };
  const flat = (o: unknown, prefix = ""): [string, string][] =>
    typeof o === "string" ? [[prefix, o]] : Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, prefix ? `${prefix}.${k}` : k));
  const admin = flat(ko.admin, "admin");

  test("자동 발송을 말하는 문구가 없다 — '상담완료로 바꾸면 … 문자가 가요' · '바꾸고 문자 보내기' · '안내 문자를 보내고 있어요'", () => {
    const bad = admin.filter(([, v]) => /바꾸면[^.]*문자가 가요|바꾸고 문자 보내기|안내 문자를 보내고 있어요|확정 안내 문자가 가요/.test(v));
    expect(bad).toEqual([]);
  });

  test("취소 진입 문구가 없다(옛 기록 한 줄 · 결과 문구는 남는다)", () => {
    const keys = admin.map(([k]) => k);
    for (const k of ["admin.detail.cancel", "admin.detail.cancelHint", "admin.detail.process.moreCancel", "admin.detail.sheet.cancelTitle", "admin.detail.sheet.reason.schedule"]) {
      expect(keys, k).not.toContain(k);
    }
    expect(keys).toContain("admin.detail.process.cancelled");
  });

  test("새 문구 — 문자 시트 · 보내지 않음 안내(원문) · 보낸 문자 기록 · 발송 기록 라벨", () => {
    const get = (k: string) => admin.find(([key]) => key === k)?.[1];
    expect(get("admin.detail.sms.open")).toBe("문자 보내기");
    expect(get("admin.detail.sms.skipped")).toBe("대금·취소 규정은 다른 방법으로 꼭 안내해 주세요");
    expect(get("admin.detail.sms.long")).toBe("장문 문자로 보내져요");
    expect(get("admin.detail.sms.submit")).toBe("보내기");
    expect(get("admin.detail.sms.skip")).toBe("보내지 않음");
    expect(get("admin.detail.messages.title")).toBeTruthy();
    expect(get("admin.notifications.template.consult.customer.sms")).toBeTruthy();
    expect(admin.some(([, v]) => v.includes(VERBATIM.bookingNotice))).toBe(false);
  });

  test("계약 정보는 고칠 수 있다(OF3-R4b) — '고칠 수 없어요' 문구가 없고, 라벨이 되도록 그대로 두는 이유(약관 · 예약 확정 안내에 대금·취소 규정)를 말한다", () => {
    const get = (k: string) => admin.find(([key]) => key === k)?.[1] ?? "";
    const sms = admin.filter(([k]) => k.startsWith("admin.detail.sms."));
    expect(sms.filter(([, v]) => /고칠 수 없|수정할 수 없|편집 불가/.test(v))).toEqual([]);
    const label = get("admin.detail.sms.blockLabel");
    expect(label).toContain("계약 정보");
    expect(label).toMatch(/고칠 수 있/);
    expect(label).toMatch(/그대로 두/);
    expect(label).toContain("약관");
    expect(label).toContain("예약 확정");
    expect(label).toMatch(/대금/);
    expect(label).toMatch(/취소/);
    expect(get("admin.detail.sms.body")).toMatch(/고칠 수 있/);
    expect(get("admin.detail.sms.contractChanged")).toBe("계약 정보를 고쳤어요");
    expect(get("admin.detail.sms.contractReset")).toBe("기본 내용으로 되돌리기");
    // 두 칸이 모두 비면 막는다 — 문구만 비는 것은 막지 않는다
    expect(get("admin.detail.sms.empty")).toMatch(/문구|계약 정보/);
    expect(get("admin.detail.sms.hint")).not.toMatch(/늘 함께 붙/);
  });

  test("보낸 문자 기록 — 예약 상세가 읽고(세션 + RLS · 받는 번호 칸을 읽지 않는다) 시각·상태·본문 앞부분을 그린다", () => {
    const lib = codeOf("lib/admin/notifications.ts");
    const m = /export const RESERVATION_MESSAGE_COLUMNS = (\[[^\]]*\])/.exec(lib);
    expect(m, "RESERVATION_MESSAGE_COLUMNS 가 없다").not.toBeNull();
    expect(m![1]).toContain('"body"');
    expect(m![1]).not.toContain("to_phone");
    const page = codeOf("app/admin/(protected)/reservations/[id]/page.tsx");
    expect(page).toMatch(/listReservationMessages\(/);
    expect(page).toMatch(/data-testid="admin-messages"/);
  });
});
