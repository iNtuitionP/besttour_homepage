"use server";
/**
 * 예약확인 서버액션 — 얇은 래퍼 (플랜 v4 P6-3a · T2-5 · ADR-3 · ADR-4 · actions/reservation.ts 와 같은 모양).
 *
 * 순서: 시작 시각 → headers() → FormData 모양 바꾸기 → runCheckGuards(zod·허니팟·Turnstile·RateLimit) → lookupReservation(서비스 롤)
 *       → 결과 매핑 → 응답 시간 바닥(holdResponseFloor) → 반환.
 * 로직 0 — 분기는 lib/reservation-check/{formData,guards,lookup,view,result,timing}.ts 에 있고 거기서 테스트된다.
 *
 * 경계 규칙
 *   - export 는 이 async 함수 하나(ADR-3). 환경변수는 이 파일이 읽지 않는다 — lib/guard/deps.ts checkGuardDeps() 만 읽는다.
 *   - T2-5(사장님 요청 1 · 결정 5, 2026-10-10): 조회 키 = 휴대폰 번호 + 예약자 이름. **P6-3a 의 "예약확인엔 Turnstile 없음" 결정을 번복했다** —
 *     Turnstile(action 'check')은 guard 안에서 검증된다(이 파일은 siteverify 를 직접 부르지 않는다). 전화번호 단위 한도는 없다(IP 한도 + Turnstile).
 *   - **없음·이름 불일치·지난/취소 건뿐·허니팟·형식 실패는 전부 같은 not_found** (result.ts) — 그리고 모든 응답은 요청 시작부터
 *     바닥 시간 이상 지난 뒤 나간다(timing.ts) — 모양뿐 아니라 대략의 시간으로도 존재 여부가 드러나지 않게.
 *   - IP 는 변수에 담지 않는다 — headers() 객체를 checkGuardContext 가 감싸 guard 에 넘기고, guard 가 해시 키·siteverify remoteip 로만 쓴다.
 *   - 예외는 여기서 끝난다. headers()·모양 바꾸기·guard 준비·실행이 던지면 infra, 조회가 던지면 server. 스택은 structuredLog 로(개인정보 없음).
 *   - 서비스 롤 클라이언트는 조회 단계에서만 만든다 — guard 를 통과하지 못한 요청은 DB 근처에도 가지 않는다.
 *   - 조회의 "오늘(KST)" 은 guard 가 한 번 읽은 시각(outcome.now)이다 — 시계를 다시 읽지 않는다.
 */
import { headers } from "next/headers";

import { checkGuardDeps } from "@/lib/guard/deps";
import { structuredLog } from "@/lib/log";
import { supabaseReservationCheckDb } from "@/lib/reservation-check/db";
import { checkGuardContext, formDataToCheckLocale, formDataToCheckRaw } from "@/lib/reservation-check/formData";
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
import { holdResponseFloor } from "@/lib/reservation-check/timing";
import { createServiceClient } from "@/lib/supabase/server";

export async function checkReservation(formData: FormData): Promise<CheckResult> {
  const startedAt = Date.now();
  const result = await respond(formData);
  await holdResponseFloor(startedAt);
  return result;
}

async function respond(formData: FormData): Promise<CheckResult> {
  // 결과 카드의 지명·차종 언어(P7-4) — 폼의 숨은 칸. 던지지 않는 순수 함수라 try 밖이다(모르는 값은 ko).
  const locale = formDataToCheckLocale(formData);
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
    found = await lookupReservation(outcome.input, { db: supabaseReservationCheckDb(createServiceClient()), now: outcome.now, locale });
  } catch (err) {
    structuredLog(checkThrownToLog("reservation_check.lookup_failed", err));
    return checkFailureResult("server");
  }
  return lookupToResult(found);
}
