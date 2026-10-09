/**
 * 구조화 로그 — JSON 한 줄 (P3-3).
 *
 * 서버 경계(서버액션·크론)가 쓴다. 개인정보(이름·전화·IP)를 넣지 않는 것은 **만드는 쪽**의 규약이다 —
 * lib/reservations/submitResult.ts(thrownToLog·createdToLogs)·lib/reservations/create.ts(CreateReservationLogEntry)가 필드를 고르고,
 * 이 함수는 받은 것을 그대로 직렬화한다. 여기서 걸러 주지 않는다(걸러 주면 호출자가 그것에 기댄다).
 *
 * 순수 lib 모듈 — 서버액션 지시어 없음, Next 없음, env 없음. vitest 는 vi.mock("@/lib/log") 로 대체한다.
 *
 * info 레벨(P4-1): 배치의 정상 실행 보고(notify.worker_run)용 — lib/retention/purge.ts 가 console.info 로 남기는 감사 로그와 같은 층이다.
 * 정상 실행을 warn 으로 찍으면 진짜 경고가 묻힌다.
 */
export interface StructuredLogEntry {
  level: "error" | "warn" | "info";
  /** `도메인.사건` 형태의 기계용 키 (예: reservation.create_failed). */
  event: string;
}

export function structuredLog(entry: StructuredLogEntry): void {
  const line = JSON.stringify(entry);
  if (entry.level === "info") console.info(line);
  else if (entry.level === "warn") console.warn(line);
  else console.error(line);
}
