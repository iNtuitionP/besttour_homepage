"use server";
/**
 * 접수 서버액션 — 얇은 래퍼 (플랜 v4 P3-3 · ADR-3 · ADR-4 · CLAUDE.md §3 "공개 뮤테이션은 전부 통과 후").
 *
 * 순서: headers() → FormData 모양 바꾸기 → runGuards(zod·허니팟·타임트랩·Turnstile·RateLimit) → createReservation → 결과 매핑.
 * 로직 0 — 분기는 lib/reservations/formData.ts·submitResult.ts 에 있고 거기서 테스트된다. 이 파일의 테스트(tests/reservation-action.test.ts)는
 * "순서대로 불렀는가 / 결과를 올바르게 매핑했는가" 만 본다.
 *
 * 경계 규칙
 *   - export 는 이 async 함수 하나(ADR-3 — 읽기 함수를 서버액션으로 내지 않는다).
 *   - process.env 는 이 파일(OWNER_PHONE·OWNER_EMAIL)과 lib/guard/deps.ts 만 읽는다. lib 로 새지 않는다.
 *   - IP 는 변수에 담지 않는다 — headers() 객체를 guardContext 가 감싸 guard 에 넘기고, guard 가 Turnstile remoteip 와 해시 키로만 쓴다.
 *     결과·로그 어디에도 IP·이름·전화가 없다(테스트 §4 가 x-forwarded-for 값으로 대조).
 *   - 예외는 여기서 끝난다. headers()·FormData 모양 바꾸기·guard 준비·실행이 던지면 infra, createReservation 이 던지면 server — 서버액션이
 *     throw 하면 Next 가 500 과 다이제스트만 내고 UI 가 안내를 못 한다. 스택은 structuredLog 로. FormData 가 아닌 인자는 formDataToRaw 가
 *     빈 폼으로 봐서 validation 으로 나간다(P3-3-FIX M3 — useActionState 의 (prevState, formData) 호출 규약 참고).
 *   - 허니팟(silent)은 저장·로그 없이 가짜 성공. 봇에게 아무것도 알려주지 않는다.
 *   - 성공하면 응답 뒤 runAfter 로 접수 현황 태그(QUERY_TAGS.recent, P3-5)를 무효화한다. 통지 enqueue 실패(notifyQueued:false)도 접수 성공이다.
 *   - 성공하면 응답 뒤 즉시 발송(P4-7, lib/notify/deps.ts notifyAfterResponse)도 맡긴다 — 스위치 NOTIFY_INLINE 은 그 모듈이 읽는다
 *     (이 파일의 env 는 여전히 OWNER_* 둘뿐). 실패·허니팟 경로는 부르지 않는다.
 */
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";

import { runGuards, type GuardOutcome } from "@/lib/guard";
import { defaultGuardDeps } from "@/lib/guard/deps";
import { structuredLog } from "@/lib/log";
import { notifyAfterResponse } from "@/lib/notify/deps";
import { runAfter } from "@/lib/ports/after";
import { revalidate } from "@/lib/ports/revalidate";
import { QUERY_TAGS } from "@/lib/queries/tags";
import { createReservation } from "@/lib/reservations/create";
import { supabaseReservationDb } from "@/lib/reservations/db";
import { formDataToRaw, guardContext } from "@/lib/reservations/formData";
import {
  createdToLogs,
  createdToResult,
  failureResult,
  guardFailureToResult,
  silentResult,
  thrownToLog,
  type SubmitResult,
} from "@/lib/reservations/submitResult";
import { createServiceClient } from "@/lib/supabase/server";
import type { CreateReservationResult } from "@/lib/types";

export async function submitReservation(formData: FormData): Promise<SubmitResult> {
  let outcome: GuardOutcome;
  try {
    const requestHeaders = await headers();
    const { raw, guardFields } = formDataToRaw(formData);
    outcome = await runGuards(raw, guardContext(requestHeaders, guardFields), defaultGuardDeps());
  } catch (err) {
    structuredLog(thrownToLog("reservation.guard_setup_failed", err));
    return failureResult("infra");
  }
  if (!outcome.ok) return guardFailureToResult(outcome);
  if (outcome.silent) return silentResult();

  let created: CreateReservationResult;
  try {
    created = await createReservation(outcome.input, {
      db: supabaseReservationDb(createServiceClient()),
      now: () => new Date(),
      randomBytes,
      ownerPhone: process.env.OWNER_PHONE || undefined,
      ownerEmail: process.env.OWNER_EMAIL || undefined,
      log: structuredLog,
    });
  } catch (err) {
    structuredLog(thrownToLog("reservation.create_failed", err));
    return failureResult("server");
  }

  for (const entry of createdToLogs(created)) structuredLog(entry);
  runAfter(() => revalidate(QUERY_TAGS.recent));
  // 즉시 발송(P4-7) — 방금 쌓인 통지를 응답 뒤에 발송기로 한 번 흘린다. NOTIFY_INLINE="1" 이 아니면 아무것도 맡기지 않는다.
  // 결과를 기다리지 않는다: 발송이 던지거나 느려도 이 접수는 이미 성공이다(예외는 lib/notify/inline.ts 가 로그로 끝낸다).
  notifyAfterResponse("created", runAfter);
  return createdToResult(created);
}
