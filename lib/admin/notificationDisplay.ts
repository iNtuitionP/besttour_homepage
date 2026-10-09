/**
 * 발송 기록 화면의 표시 판정 — 순수 (P5-23 라운드 2 · 컨트롤러 A-1 · A-2).
 *
 * A-1 '마지막 오류': 발송기(lib/notify/**)가 last_error 에 적는 코드를 **라벨 키**로 바꾼다. 화면은 키로 한국어 라벨
 *     (messages/ko.json admin.notifications.error.*)을 그리고, 코드 원문은 title(툴팁)에만 둔다 — 한국어 화면에 영문 코드가 새지 않는다.
 *     모르는 코드는 "other"(기타 오류). 발송기가 적을 수 있는 코드가 전부 여기서 풀리는지는 tests/admin-notify-display.test.ts 가
 *     **소스에서 코드를 뽑아** 확인한다(목록을 손으로 맞추지 않는다 — 새 코드가 생기면 그 테스트가 빨개진다).
 *     코드 모양(lib/notify): 제공자 어댑터 `provider_timeout` · `provider_network:<이름>` · `provider_<HTTP 상태>:<코드>` · `provider_rejected:<코드>` ·
 *     `provider_no_accepted` · `provider_bad_json` · `unsupported_recipient` · `unsupported_channel:<채널>` · `alimtalk_not_enabled` ·
 *     `vars_load_failed` · `reservation_not_found` · `template_render_failed` · `missing_subject` · `unsafe_row_id`, 라우터 `no_sender_for_channel:<채널>`,
 *     발송기 `unknown_template` · `claim_invariant_violated` · `sender_threw:<이름>`, 아웃박스 `duplicate_sent`(0005) · `sent_unmarked:<id>`(격리) ·
 *     회수기 `lease_expired_after_max_attempts`(0007).
 * A-2 '대기' 둘째 줄: status='pending' 인 행을 행의 칸(시도 수 · 마지막 오류 · 다음 시도 · 갱신 시각)과 **지금**으로 나눈다 — 배지는 그대로 둔다.
 *     (리뷰 P1-1) 시간을 본다: 발송기와 같은 규칙(nextAttemptDecision)과 lease 로 — 끝난 lease 를 "보내는 중", 지난 시각을 "다시 보낼 예정" 이라 하지 않는다.
 *     격리 행(보냈지만 기록 못 함)은 이미 자기 배지(발송됨 · 기록 확인 필요)가 그 상태를 말하므로 둘째 줄을 달지 않는다.
 *
 * React·Next·DB·env 없음 · 한글 없음. 화면(app/admin/(protected)/notifications/page.tsx)이 부른다.
 */
import { BACKOFF_MS, CLAIM_LEASE_MS, DUPLICATE_SENT_ERROR, MAX_ATTEMPTS, SENT_UNMARKED_PREFIX, nextAttemptDecision } from "../notify/outbox";

export const NOTIFY_ERROR_KEYS = [
  "timeout",
  "network",
  "auth",
  "tooMany",
  "rejectedRequest",
  "providerDown",
  "providerRejected",
  "badResponse",
  "recipient",
  "channel",
  "noSender",
  "alimtalk",
  "varsLoad",
  "notFound",
  "template",
  "unknownTemplate",
  "internal",
  "threw",
  "duplicate",
  "leaseExpired",
  "sentUnmarked",
  "other",
] as const;
export type NotifyErrorKey = (typeof NOTIFY_ERROR_KEYS)[number];

const EXACT: Readonly<Record<string, NotifyErrorKey>> = {
  provider_timeout: "timeout",
  provider_no_accepted: "providerRejected",
  provider_bad_json: "badResponse",
  unsupported_recipient: "recipient",
  alimtalk_not_enabled: "alimtalk",
  vars_load_failed: "varsLoad",
  reservation_not_found: "notFound",
  template_render_failed: "template",
  missing_subject: "template",
  unknown_template: "unknownTemplate",
  unsafe_row_id: "internal",
  claim_invariant_violated: "internal",
  lease_expired_after_max_attempts: "leaseExpired",
};

const PREFIX: readonly (readonly [string, NotifyErrorKey])[] = [
  ["provider_network:", "network"],
  ["provider_rejected:", "providerRejected"],
  ["unsupported_channel:", "channel"],
  ["no_sender_for_channel:", "noSender"],
  ["sender_threw:", "threw"],
];

/** HTTP 상태(제공자 응답)의 종류 — 401·403 인증 · 408 시간 초과 · 429 요청이 많음 · 그 밖 4xx 요청 거절 · 5xx 제공자 쪽 오류. */
function httpKey(status: number): NotifyErrorKey {
  if (status === 401 || status === 403) return "auth";
  if (status === 408) return "timeout";
  if (status === 429) return "tooMany";
  if (status >= 500 && status <= 599) return "providerDown";
  if (status >= 400 && status <= 499) return "rejectedRequest";
  return "other";
}

/** last_error → 라벨 키. 오류가 없으면(null · 빈 값) null — 칸은 "—". 모르는 코드는 "other". */
export function notifyErrorKey(lastError: string | null | undefined): NotifyErrorKey | null {
  if (lastError === null || lastError === undefined) return null;
  const e = lastError.trim();
  if (e === "") return null;
  if (e === DUPLICATE_SENT_ERROR) return "duplicate";
  if (e.startsWith(SENT_UNMARKED_PREFIX)) return "sentUnmarked";
  // 제 키만 본다(리뷰 P2-5) — 일반 객체라 EXACT["toString"] · EXACT["__proto__"] 가 프로토타입의 함수·객체를 돌려줬다
  if (Object.hasOwn(EXACT, e)) return EXACT[e];
  const http = /^provider_(\d{3}):/.exec(e);
  if (http !== null) return httpKey(Number(http[1]));
  for (const [prefix, key] of PREFIX) if (e.startsWith(prefix)) return key;
  return "other";
}

/**
 * '오래 멈춤' 의 기준(리뷰 P1-1) — 보낼 때가 된 지(다음 시도 시각 또는 lease 끝이 지남) 이만큼 지나면 멈춘 것으로 본다.
 * 통지 크론은 하루 1회(vercel.json)라 보낼 때가 된 행은 늦어도 다음 크론에 나간다 — 24시간이 지났다면 크론을 한 번 이상 놓친 것이다
 * (테스트가 크론 간격 ≤ 이 값을 잠근다). 그 전에는 "보낼 차례 · 다음 발송 때 나가요" 다(즉시 발송 · 다음 크론이 집는다).
 */
export const PENDING_STALL_HOURS = 24;

export type PendingSubState =
  | { kind: "sending" }
  | { kind: "retry"; at: string }
  | { kind: "due" }
  | { kind: "stalled" }
  | { kind: "exhausted" };

export interface PendingSubStateInput {
  status: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  updatedAt: string;
}

/**
 * 마지막 전이가 claim(발송기가 집어 감)인가 — lease 에는 따로 칸이 없다. claim(0014)은 한 문장에서 attempts+1 · updated_at = now() ·
 * next_attempt_at = now() + CLAIM_LEASE_MS 를 찍고 last_error 는 건드리지 않는다. 실패 기록(markFailed)은 last_error 를 적고
 * next_attempt_at = now() + 기다림(그 시도의 백오프 이상 — Retry-After 는 늘리기만 한다)을 찍는다.
 *   - attempts ≥ MAX_ATTEMPTS: 다섯 번째 실패는 곧바로 failed(종착)라 pending 으로 남은 이 행은 claim 뒤다.
 *   - 실패한 적 없음(last_error 없음) + 집힌 적 있음: claim 뒤다.
 *   - 실패한 적 있음: 간격이 lease 와 같고 **그 시도의 백오프가 lease 보다 길면** claim 뿐이다(3·4회째). 백오프가 lease 이하인 1·2회째는
 *     칸만으로 가를 수 없어 기다림으로 본다 — claim 은 보내는 몇 초뿐이고 5분 기다림이 훨씬 길다(1회째 claim 은 오류를 들고 있을 수 없다).
 */
function claimedLast(row: PendingSubStateInput, next: number, updated: number): boolean {
  if (row.attempts < 1) return false;
  if (row.attempts >= MAX_ATTEMPTS) return true;
  if ((row.lastError ?? "").trim() === "") return true;
  return Number.isFinite(updated) && next - updated === CLAIM_LEASE_MS && BACKOFF_MS[row.attempts - 1] > CLAIM_LEASE_MS;
}

/**
 * '대기' 배지 아래 둘째 줄 — 발송기와 같은 규칙(nextAttemptDecision · 0014 claim 의 where 절) + lease 를 **서버의 한 순간 now** 에 대어 가른다(리뷰 P1-1):
 *   - lease 안(claim 뒤 · lease 끝 > now) → sending(보내는 중)
 *   - 시도를 다 씀(give_up) · lease 도 끝남 → exhausted(다시 보내기를 다 씀 — 더 보내지 않는다. 다음 실행의 회수기(0007)가 실패로 닫는다)
 *   - lease 가 없고 다음 시도가 아직(wait) → retry(다시 보낼 예정 {다음 시도})
 *   - 보낼 때가 됨(send — 다음 시도 ≤ now, 또는 lease 가 끝남) PENDING_STALL_HOURS 미만 → due(보낼 차례 · 다음 발송 때 나가요) · 이상 → stalled(오래 멈춤)
 * 한 번도 집히지 않은 행은 다음 시도 = 만든 때(enqueue 기본값)라 곧바로 due 다.
 * 대기가 아니면 null. **격리 행(sent_unmarked:)도 null** — 그 행은 '대기' 배지가 아니라 자기 배지(발송됨 · 기록 확인 필요,
 * P4-7 수정 라운드 3)를 달고 있어 둘째 줄이 같은 말을 되풀이할 뿐이다. 무엇보다 그 행의 next_attempt_at 은 먼 미래(격리 표식)라
 * '다시 보낼 예정 {시각}' 으로 풀면 **거짓**이 된다 — 그래서 여기서 먼저 걸러 낸다. 시각을 읽을 수 없으면 null(지어내지 않는다).
 */
export function pendingSubState(row: PendingSubStateInput, now: Date): PendingSubState | null {
  if (row.status !== "pending") return null;
  if ((row.lastError ?? "").startsWith(SENT_UNMARKED_PREFIX)) return null;
  const next = Date.parse(row.nextAttemptAt);
  if (!Number.isFinite(next)) return null;
  const inLease = claimedLast(row, next, Date.parse(row.updatedAt)) && next > now.getTime();
  const decision = nextAttemptDecision({ status: "pending", attempts: row.attempts, next_attempt_at: row.nextAttemptAt }, now);
  if (inLease) return { kind: "sending" };
  if (decision === "give_up") return { kind: "exhausted" };
  if (decision === "wait") return { kind: "retry", at: row.nextAttemptAt };
  return now.getTime() - next >= PENDING_STALL_HOURS * 3_600_000 ? { kind: "stalled" } : { kind: "due" };
}
