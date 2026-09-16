/**
 * 발송이 끝내 실패하면 사장님께 알린다 — 판정만 (플랜 v4 P4-4 · ADR-7).
 *
 * 지금은 통지가 다섯 번 시도 끝에 죽어도 아무도 모른다. 행은 `failed` 로 남고 `last_error` 가 적히지만 그것을 보려면
 * 사장님이 관리자 발송 내역에 **직접 들어가야** 한다. 접수가 들어왔는데 고객 문자가 안 나간 것을 며칠 뒤에 아는 상황이 가능하다.
 *
 * ## 알림도 아웃박스를 탄다
 * 워커에서 직접 메일을 쏘지 않는다. ADR-7 의 규약이 "기록 먼저, 발송 나중, 두 번 보내지 않는다" 이고 그 기계가 이미 있다.
 * 워커가 직접 `fetch` 하면 재시도·중복방지·감사 기록을 전부 다시 만들어야 한다. 그래서 **실패가 확정되면 새 pending 행 하나**를
 * 넣고, 그 행은 다음 크론에서 평소대로 나간다.
 *
 * ## 🔴 재귀를 막는 것이 이 파일의 제1 목적이다
 * 알림의 실패가 또 알림을 만들면 무한이다. 그리고 이건 이론이 아니다: 사장님 번호가 없으면 `created.owner.email` 이 생기고,
 * 메일 발송이 거절되면(도메인 미인증 403 등) 그 행이 다섯 번 만에 죽고, **알림도 메일이라 같은 이유로 죽는다.**
 * 그래서 `isFailureTemplate()` 이 **가장 먼저** 걸리고, 참이면 무엇도 넣지 않는다(`reason: "recursion"`).
 * 판정은 등록된 키 목록뿐 아니라 **`failure` 라는 마디가 있는 키 전부**를 막는다 — 나중에 실패 알림 키가 하나 더 생겨도
 * 등록을 잊은 채로 재귀가 열리지 않게 하기 위해서다(목록은 열거, 형태는 안전망).
 *
 * ## give_up 일 때만 · event 는 원래 행의 것
 * 매 실패마다 넣으면 한 건에 알림이 다섯 번 간다. 그래서 `gaveUp` 이 참일 때만 넣고, 그 값은 워커가
 * `retryPlanAfterFailure`(outbox.ts)로 **이미 계산해 둔 것**을 그대로 받는다 — 여기서 다시 계산하지 않는다(판정이 두 벌이 되면 갈라진다).
 * event 를 유지하는 근거는 outbox.ts `FAILURE_TEMPLATE_KEYS` 주석에 있다(마이그레이션 불필요 + 사고 단위의 입도).
 *
 * ## 개인정보를 다시 싣지 않는다
 * 알림은 *"무엇이 실패했는지"* 만 말한다. 넣는 행에 실리는 값은 예약 id·event·채널·키·**사장님 수신 주소**뿐이고,
 * 고객 이름·전화·메일·문의내용은 하나도 없다. 문안 쪽도 같은 규약을 **타입으로** 건다 —
 * 실패 알림의 변수 타입은 `CustomerVars`(접수번호·원점)라서 애초에 개인정보 필드가 없다(templates.ts).
 * 실패한 채널로 고객 개인정보를 다시 흘릴 이유가 없다.
 *
 * 순수 모듈 — env 없음, DB 없음, 시계 없음, 네트워크 없음. 행을 실제로 넣는 것은 워커가 주입받은 포트다(worker.ts `WorkerDb`).
 */
import type { NewOutboxRow, NotifyChannel, NotifyEvent, OutboxRow } from "../types";
import { FAILURE_TEMPLATE_KEYS, type FailureTemplateKey } from "./outbox";

// =============================================================================
// 상수
// =============================================================================

/**
 * 실패 알림이 나가는 채널. 메일 하나다 — 문자가 죽어서 알리는 마당에 같은 문자로 알릴 수 없고,
 * 사장님 번호(OWNER_PHONE)가 없어서 죽는 경우가 애초에 가장 흔한 시나리오다.
 */
export const FAILURE_NOTICE_CHANNEL = "email" as const satisfies NotifyChannel;

/**
 * event → 실패 알림 키. **Record 로 둔 이유**: `NotifyEvent` 에 값이 하나 늘면 여기서 컴파일이 깨져
 * "그 event 의 실패는 어떻게 알릴 것인가" 를 반드시 정하게 된다. 문자열을 조립해 만들면 조용히 없는 키가 생긴다.
 */
export const FAILURE_TEMPLATE_BY_EVENT: Record<NotifyEvent, FailureTemplateKey> = {
  created: "created.owner.failure.email",
  confirmed: "confirmed.owner.failure.email",
};

/**
 * 재귀 차단의 형태 판정 — 키에 `failure` 라는 **마디**가 있는가. `created.owner.failure.email` 은 걸리고
 * `created.owner.email` 은 걸리지 않는다. 마디 단위로 보므로 `failures`·`notfailure` 같은 말은 걸리지 않는다.
 */
const FAILURE_SEGMENT = /(^|\.)failure(\.|$)/;

// =============================================================================
// 순수 — 재귀 차단
// =============================================================================

/**
 * 이 행의 실패가 **또 알림을 만들면 안 되는** 행인가. 참이면 아무것도 넣지 않는다.
 *
 * 등록된 키 목록과 형태 판정을 **둘 다** 본다. 목록만 보면 새 실패 알림 키를 만들며 등록을 잊는 순간 재귀가 열리고,
 * 형태만 보면 목록에 있는데 이름이 다른 키를 놓친다. 둘 중 하나라도 참이면 막는다(fail-closed).
 * 인자는 `TemplateKey` 가 아니라 `string` 이다 — DB 에서 온 값은 무엇이든 될 수 있고, 모르는 값 앞에서
 * 이 판정이 조용히 통과하면 안 된다.
 */
export function isFailureTemplate(template: string): boolean {
  if (typeof template !== "string") return true;
  return (FAILURE_TEMPLATE_KEYS as readonly string[]).includes(template) || FAILURE_SEGMENT.test(template);
}

// =============================================================================
// 순수 — 넣을 것인가, 무엇을 넣을 것인가
// =============================================================================

/**
 * 넣지 않은 이유. 전부 **조용히 넘어가지 않는다** — 워커가 보고서(`WorkerReport.failureNotices`)와 로그에 개수로 싣는다.
 *   - recursion       실패한 행 자체가 실패 알림이다. 여기서 또 넣으면 무한이다(§재귀).
 *   - not_given_up    아직 재시도가 남았다. 매 실패마다 넣으면 한 건에 알림이 다섯 번 간다.
 *   - unknown_event   행의 event 가 우리가 아는 둘이 아니다(DB CHECK 가 막지만 방어).
 *   - no_reservation  행에 예약이 없다(reservation_id null). 유니크 키가 성립하지 않아 묶이지 않고, 알릴 대상도 없다.
 *   - no_owner_email  OWNER_EMAIL 이 비었다 — **보낼 곳이 없다.** 지어내지 않는다.
 */
export type FailureNoticeSkipReason = "recursion" | "not_given_up" | "unknown_event" | "no_reservation" | "no_owner_email";

export type FailureNoticePlan = { enqueue: true; row: NewOutboxRow } | { enqueue: false; reason: FailureNoticeSkipReason };

export interface FailureNoticeOptions {
  /** 워커가 `retryPlanAfterFailure` 로 이미 계산한 값. 여기서 다시 계산하지 않는다. */
  gaveUp: boolean;
  /** OWNER_EMAIL — 라우트가 env 에서 읽어 워커에 주입한 값. 비면 넣지 않는다. */
  ownerEmail?: string;
}

/** 죽은 행에서 이 판정에 필요한 만큼만. 수신처(`to`)·오류 문구는 보지 않는다 — 알림에 다시 싣지 않기 때문이다. */
export type FailedRowForNotice = Pick<OutboxRow, "reservation_id" | "event" | "template">;

const present = (v: string | undefined | null): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * 죽은 행 하나에 대해 실패 알림 행을 넣을지 정한다.
 *
 * 판정 순서가 곧 우선순위다. **재귀 차단이 맨 앞**인 것은 의도다 — 다른 조건이 어떻든(심지어 OWNER_EMAIL 이 멀쩡해도)
 * 실패 알림의 실패는 아무것도 만들지 않는다. 그 단언이 없으면 무한 고리가 열린다.
 */
export function planFailureNotice(row: FailedRowForNotice, opts: FailureNoticeOptions): FailureNoticePlan {
  if (isFailureTemplate(row.template)) return { enqueue: false, reason: "recursion" };
  if (opts.gaveUp !== true) return { enqueue: false, reason: "not_given_up" };

  const template = FAILURE_TEMPLATE_BY_EVENT[row.event];
  if (template === undefined) return { enqueue: false, reason: "unknown_event" };

  if (!present(row.reservation_id)) return { enqueue: false, reason: "no_reservation" };
  if (!present(opts.ownerEmail)) return { enqueue: false, reason: "no_owner_email" };

  return {
    enqueue: true,
    row: {
      reservation_id: row.reservation_id,
      // 원래 행의 event 그대로 — 그래야 부분 유니크가 "예약 하나 · event 하나당 한 번" 으로 묶어 준다.
      event: row.event,
      channel: FAILURE_NOTICE_CHANNEL,
      to: opts.ownerEmail.trim(),
      template,
    },
  };
}
