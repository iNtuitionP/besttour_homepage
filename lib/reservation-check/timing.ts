/**
 * 예약 조회 응답 시간 바닥 — 순수 (T2-5 · 결정 5, 2026-10-10).
 *
 * 없음·이름 불일치·지난/취소 건뿐·허니팟·형식 실패는 **같은 not_found 응답**이다(lib/reservation-check/result.ts). 모양만 같고
 * 걸린 시간이 다르면 그 차이가 다시 단서가 된다 — 허니팟·형식 실패는 네트워크를 하나도 쓰지 않아 즉시 끝나고, 진짜 조회는
 * Turnstile·Upstash·DB 를 거친다. 그래서 액션은 **모든 응답**을 요청 시작부터 CHECK_RESPONSE_FLOOR_MS 이상 지난 뒤 돌려준다.
 *
 * "대략" 이다 — 바닥보다 오래 걸린 요청(느린 siteverify·DB)은 그만큼 늦게 끝나고, 행이 많은 번호의 질의는 조금 더 걸린다.
 * 목표는 "즉시 끝남 / 조회함" 같은 굵은 구분을 지우는 것이지 마이크로초를 맞추는 것이 아니다(이름 비교는 따로 상수 시간 — lookup.ts).
 * 값은 평소 조회 한 번(siteverify ~0.2초 + Upstash 2회 + DB 1회)보다 넉넉하게, 사람이 기다림을 느끼지 않을 만큼으로 잡았다.
 */

/** 모든 조회 응답의 최소 소요 시간(ms). */
export const CHECK_RESPONSE_FLOOR_MS = 700;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 요청 시작 시각(`Date.now()` 값)부터 바닥까지 남은 만큼 기다린다. 이미 넘었으면 바로 끝난다. 던지지 않는다.
 * now·sleep 은 테스트용 주입점이다(운영은 기본값).
 */
export async function holdResponseFloor(startedAt: number, now: () => number = Date.now, sleep: (ms: number) => Promise<void> = defaultSleep): Promise<void> {
  const remaining = startedAt + CHECK_RESPONSE_FLOOR_MS - now();
  if (remaining > 0) await sleep(remaining);
}
