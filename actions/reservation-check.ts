"use server";
/**
 * 예약확인 서버액션 — 얇은 래퍼 (플랜 v4 P6-3a · ADR-3 · ADR-4 · actions/reservation.ts 와 같은 모양).
 *
 * 순서: headers() → FormData 모양 바꾸기 → runCheckGuards(zod·허니팟·RateLimit) → lookupReservation(서비스 롤) → 결과 매핑.
 * 로직 0 — 분기는 lib/reservation-check/{formData,guards,lookup,view,result}.ts 에 있고 거기서 테스트된다.
 * 이 파일의 테스트(tests/reservation-check.test.ts §5)는 "순서대로 불렀는가 / 결과를 올바르게 매핑했는가" 만 본다.
 *
 * 경계 규칙
 *   - export 는 이 async 함수 하나(ADR-3). 환경변수는 이 파일이 읽지 않는다 — lib/guard/deps.ts checkGuardDeps() 만 읽는다.
 *   - 봇 검증 위젯(Cloudflare) 없음(컨트롤러 결정). 열거 방지는 rateLimit(접수와 분리된 prefix) + "부재 = 불일치 동일 응답" 이 맡는다.
 *   - IP 는 변수에 담지 않는다 — headers() 객체를 checkGuardContext 가 감싸 guard 에 넘기고, guard 가 해시 키로만 쓴다.
 *   - 예외는 여기서 끝난다. headers()·모양 바꾸기·guard 준비·실행이 던지면 infra, 조회가 던지면 server. 스택은 structuredLog 로(개인정보 없음).
 *   - 허니팟(silent)은 **not_found 와 같은 응답**이다 — 성공 화면이 곧 데이터라 P3-3 의 "가짜 성공" 대신 "가짜 실패".
 *   - 서비스 롤 클라이언트는 조회 단계에서만 만든다 — guard 를 통과하지 못한 요청은 DB 근처에도 가지 않는다.
 */
import { headers } from "next/headers";

import { checkGuardDeps } from "@/lib/guard/deps";
import { structuredLog } from "@/lib/log";
import { supabaseReservationCheckDb } from "@/lib/reservation-check/db";
import { checkGuardContext, formDataToCheckRaw } from "@/lib/reservation-check/formData";
import { runCheckGuards, type CheckGuardOutcome } from "@/lib/reservation-check/guards";
import { lookupReservation, type LookupOutcome } from "@/lib/reservation-check/lookup";
import {
  checkFailureResult,
  checkThrownToLog,
  guardFailureToCheckResult,
  lookupToResult,
  notFoundResult,
  type CheckResult,
} from "@/lib/reservation-check/result";
import { createServiceClient } from "@/lib/supabase/server";

export async function checkReservation(formData: FormData): Promise<CheckResult> {
  let outcome: CheckGuardOutcome;
  try {
    const requestHeaders = await headers();
    const { raw, guardFields } = formDataToCheckRaw(formData);
    outcome = await runCheckGuards(raw, checkGuardContext(requestHeaders, guardFields), checkGuardDeps());
  } catch (err) {
    structuredLog(checkThrownToLog("reservation_check.guard_setup_failed", err));
    return checkFailureResult("infra");
  }
  if (!outcome.ok) return guardFailureToCheckResult(outcome);
  if (outcome.silent) return notFoundResult();

  let found: LookupOutcome;
  try {
    found = await lookupReservation(outcome.input, { db: supabaseReservationCheckDb(createServiceClient()) });
  } catch (err) {
    structuredLog(checkThrownToLog("reservation_check.lookup_failed", err));
    return checkFailureResult("server");
  }
  return lookupToResult(found);
}
