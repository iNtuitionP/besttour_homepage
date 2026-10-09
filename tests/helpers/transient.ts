/**
 * 로컬 스택의 일시적 끊김에 대한 재시도 (P5-22 수정 라운드).
 *
 * 전량 실행에서 로컬 게이트웨이(Kong · 127.0.0.1:54321)가 가끔 연결을 끊는다 — `TypeError: fetch failed` + cause
 * `SocketError: other side closed`(UND_ERR_SOCKET), 또는 502 "upstream connect error". 인프라 흔들림이지만 **정리 훅**에서 나면
 * 그 describe 가 실패하고 남은 행이 다음 실행을 흔든다(잠금 누수는 tests/helpers/db-lock.ts 의 aroundAll finally 가 따로 막는다).
 * 그래서 **다시 해도 같은 결과인 호출**(정리의 DELETE · 남은 행 GET)만 몇 번 더 한다. 삽입(POST)처럼 두 번 하면 뜻이 바뀌는 호출,
 * 그리고 단언이 보려는 응답(권한 거부 등)에는 쓰지 않는다 — 재시도가 결함을 덮으면 안 된다.
 * 계약은 tests/transient-retry.test.ts 가 잠근다.
 */

/** 다시 해 볼 만한 undici 원인 코드 — 연결이 중간에 끊겼거나(소켓) 막 거부됐다. 주소 오류(ENOTFOUND) 따위는 아니다. */
const TRANSIENT_CODES = new Set(["UND_ERR_SOCKET", "UND_ERR_CLOSED", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"]);

/** fetch 가 일시적 끊김으로 던졌나 — undici 는 TypeError("fetch failed") 에 cause 를 단다. */
export function isTransientNetworkError(e: unknown): boolean {
  if (!(e instanceof TypeError) || !/fetch failed/.test(e.message)) return false;
  const cause = (e as { cause?: unknown }).cause as { code?: unknown; message?: unknown } | undefined;
  if (cause !== undefined && typeof cause.code === "string") return TRANSIENT_CODES.has(cause.code);
  return typeof cause?.message === "string" && /other side closed|socket hang up/i.test(cause.message);
}

/** 게이트웨이의 일시 오류 응답 — Kong 이 위쪽(PostgREST) 연결을 잃었다. */
export function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

export interface RetryOptions<T> {
  /** 처음 한 번 뒤에 더 해 볼 횟수(기본 2). */
  retries?: number;
  /** 첫 기다림(기본 300ms) — 다음은 두 배. */
  delayMs?: number;
  /** 응답으로도 다시 할지(예: 502). 끝내 그렇다면 마지막 응답을 돌려준다 — 던지지 않는다(단언이 본다). */
  retryResult?: (value: T) => boolean;
  /** 테스트용 시계. */
  sleep?: (ms: number) => Promise<void>;
}

/** `fn` 을 부르고, 일시적 끊김(던짐) 또는 retryResult 가 참인 응답이면 몇 번 더 한다. 그 밖의 오류와 마지막 끊김은 그대로 던진다. */
export async function retryTransient<T>(fn: () => Promise<T>, opts: RetryOptions<T> = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const delayMs = opts.delayMs ?? 300;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    let value: T;
    try {
      value = await fn();
    } catch (e) {
      if (attempt >= retries || !isTransientNetworkError(e)) throw e;
      await sleep(delayMs * 2 ** attempt);
      continue;
    }
    if (attempt < retries && opts.retryResult?.(value) === true) {
      await sleep(delayMs * 2 ** attempt);
      continue;
    }
    return value;
  }
}
