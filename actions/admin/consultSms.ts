"use server";
/**
 * 상담완료 문자 보내기 서버액션 (OF3-R4 · 마이그레이션 0028).
 *
 * 순서: requireAdmin()(첫 문장 — scripts/check-admin-gate.mjs) → zod → 예약 읽기(상태·상담완료 시각·접수 시각 세 칸만) → 상담완료인가 →
 *       최종 본문 = 문구.trim() + 빈 줄 + 계약 정보 블록(■ 대금 · ■ 취소·환불 · 계약 주체 — lib/notify/templates.ts composeConsultSms ·
 *       환불 규정은 **그 예약의 접수일 판** — 옛 확정 문자와 같은 refundPolicyAt) → 2000바이트 상한 → 0028 RPC 한 번 → 넣었으면 응답 뒤 즉시 발송.
 *
 * 경계 규칙(actions/admin/reservation.ts 와 같다)
 *   - export 는 이 함수 하나다('use server' 파일의 export 는 전부 공개 POST 엔드포인트다).
 *   - 서비스 롤을 쓰지 않는다(ADR-2). 세션(anon 키 + 쿠키) 클라이언트로 읽고 부른다 — 0009 정책(is_admin)이 읽기를, 0028 함수의
 *     첫 문장 가드가 쓰기를 다시 막는다. 받는 번호는 인자로 넘기지 않는다 — 0028 함수가 그 예약의 번호로 고정한다.
 *   - 계약 정보 블록은 **서버에서** 원장으로 만든다. 화면이 보낸 미리보기를 믿지 않는다(문구만 받는다).
 *   - 즉시 발송(P4-7)은 응답 뒤에 도는 서버 쪽 발송기다(lib/notify/deps.ts — 관리자 경로의 서비스 롤 예외는 그 파일 하나뿐).
 *     발송이 실패해도 이 액션은 이미 성공이다(큐에 들어갔다) — 결과는 상세의 "보낸 문자" 기록과 발송 기록 화면이 보여 준다.
 *   - 예외는 여기서 끝난다(서버액션이 throw 하면 화면은 다이제스트만 받는다). requireAdmin() 의 redirect 는 그대로 전파된다.
 *   - 로그에 개인정보·본문 0: id(uuid)와 결과 코드뿐이다.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import {
  CONSULT_SMS_FAILED,
  CONSULT_SMS_RPC,
  CONSULT_TARGET_SELECT,
  consultSmsInputSchema,
  isConsulted,
  toConsultSmsResult,
  type ConsultSmsResult,
  type ConsultTargetRow,
} from "@/lib/admin/consultSms";
import { ADMIN_REVALIDATE_PATH } from "@/lib/admin/result";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { structuredLog, type StructuredLogEntry } from "@/lib/log";
import { CONSULT_SMS_MAX_BYTES } from "@/lib/notify/consult-text";
import { notifyAfterResponse } from "@/lib/notify/deps";
import { composeConsultSms, utf8ByteLength } from "@/lib/notify/templates";
import { runAfter } from "@/lib/ports/after";
import { createSsrClient } from "@/lib/supabase/ssr";

/** 이 액션이 남기는 로그의 전부 — id 와 결과 코드. 본문·문구·번호는 싣지 않는다. 필드를 늘리기 전에 그것이 개인정보가 아닌지 먼저 볼 것. */
interface ConsultSmsLogEntry extends StructuredLogEntry {
  /** 예약 uuid. uuid 모양이 아니면 "invalid". */
  id: string;
  outcome: ConsultSmsResult["code"];
}

function report(id: unknown, result: ConsultSmsResult): ConsultSmsResult {
  const entry: ConsultSmsLogEntry = {
    level: result.ok ? "info" : result.code === "failed" ? "error" : "warn",
    event: "admin.reservation.consult_sms",
    id: typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : "invalid",
    outcome: result.code,
  };
  structuredLog(entry);
  return result;
}

/** 상담완료 예약에 관리자가 쓴 문구 + 계약 정보 블록을 문자 한 통으로 큐에 넣는다. 여러 번 부를 수 있다(부를 때마다 한 통). */
export async function sendConsultSms(id: string, freeText: string): Promise<ConsultSmsResult> {
  await requireAdmin();

  const parsed = consultSmsInputSchema.safeParse({ id, freeText });
  if (!parsed.success) return report(id, { ok: false, code: "invalid" });

  try {
    const db = createSsrClient(await cookies());
    const read = await db.from("reservations").select(CONSULT_TARGET_SELECT).eq("id", parsed.data.id).maybeSingle();
    if (read.error) return report(id, CONSULT_SMS_FAILED);
    const row = (read.data ?? null) as ConsultTargetRow | null;
    if (!isConsulted(row)) return report(id, { ok: false, code: "notConsulted" });

    const body = composeConsultSms(parsed.data.freeText, row.created_at);
    if (utf8ByteLength(body) > CONSULT_SMS_MAX_BYTES) return report(id, { ok: false, code: "tooLong" });

    const { data, error } = await db.rpc(CONSULT_SMS_RPC, { p_id: parsed.data.id, p_body: body });
    if (error) return report(id, CONSULT_SMS_FAILED);
    const result = toConsultSmsResult(data);
    if (result.ok) {
      runAfter(() => revalidatePath(ADMIN_REVALIDATE_PATH, "layout"));
      notifyAfterResponse("consult_sms", runAfter);
    }
    return report(id, result);
  } catch {
    return report(id, CONSULT_SMS_FAILED);
  }
}
