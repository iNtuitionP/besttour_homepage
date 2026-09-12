/**
 * 통지 발송 포트 (플랜 v4 P4-1 · ADR-7).
 *
 * 발송기(lib/notify/worker.ts)는 이 인터페이스만 본다. 제공자 어댑터(P4-2)는 이 인터페이스를 구현하는 파일 하나를 추가하고,
 * 어느 구현을 쓸지는 app/api/cron/notify/route.ts 만 정한다 — env 를 보는 곳은 거기뿐이다. 문안 렌더(P4-3)도 여기 없다.
 * `template` 은 키뿐이다.
 *
 * 두 구현
 *   - unconfiguredSender: 제공자 키가 없는 기간의 기본값. configured=false. worker 는 이것을 보면 **claim 자체를 하지 않는다** —
 *     claim 은 attempts 를 소모하고 lease 를 건다(0005). 키 없는 몇 주 동안 5회를 태우면 키가 온 뒤 그 행은 영영 보낼 수 없다.
 *     send() 는 호출되면 안 되므로 throw 한다 — 호출됐다면 worker 의 버그다.
 *   - memorySender: 테스트·로컬 실증용. 호출을 기록하고 시나리오(성공 / 재시도 가능 실패 / 영구 실패 / throw)를 낸다. 실제 발송 없음.
 *     운영(VERCEL_ENV=production)에서는 route.ts 가 이 구현을 거부한다 — 발송 없이 sent 처리되는 사고를 막기 위해.
 *
 * 순수 모듈 — env 없음, 네트워크 없음, 서버 지시어 없음. tests/outbox-worker.test.ts 가 정적으로 잠근다.
 */
import type { NotifyChannel } from "../types";
import type { TemplateKey } from "./outbox";

export interface SendRequest {
  /** notifications_log.id — 로그·보고서에 쓰는 유일한 식별자. */
  id: number;
  channel: NotifyChannel;
  /** 수신처(전화 또는 메일 주소). 제공자 호출에만 쓴다 — 로그·보고서·오류 문구에 넣지 않는다. */
  to: string;
  /** 문안 키 — 문안이 아니다. 제공자 어댑터가 P4-3 렌더러에 이 키와 reservationId 를 넘겨 문안을 얻는다. */
  template: TemplateKey;
  reservationId: string;
}

/**
 * 실패의 `error` 는 짧은 코드여야 한다(예: 'provider_timeout', 'provider_4xx:1041'). 수신처·문안·응답 덤프를 넣지 않는다 —
 * worker 가 보고서·로그·last_error 에 싣는다(방어로 수신처 문자열은 지우지만, 그것에 기대지 마라).
 * `retryable` 은 기록용이다 — 백오프·give_up 판정은 0005 mark_notification_failed 와 retryPlanAfterFailure 가 attempts 로 한다.
 */
export type SendOutcome = { ok: true; providerMessageId: string | null } | { ok: false; error: string; retryable: boolean };

export interface NotificationSender {
  /** 보고서·로그에 찍히는 이름(예: 'unconfigured', 'memory'). */
  readonly name: string;
  /** 정확히 true 일 때만 worker 가 claim 한다. 그 외(undefined 포함)는 전부 미구성으로 본다. */
  readonly configured: boolean;
  send(req: SendRequest): Promise<SendOutcome>;
}

export const UNCONFIGURED_SENDER_NAME = "unconfigured";
export const MEMORY_SENDER_NAME = "memory";

/** 제공자 키가 없을 때의 기본값. worker 는 configured=false 를 보고 claim 전에 멈춘다. send 는 호출되면 안 된다. */
export function unconfiguredSender(): NotificationSender {
  return {
    name: UNCONFIGURED_SENDER_NAME,
    configured: false,
    async send(req) {
      throw new Error(
        `unconfiguredSender.send: 미구성 sender 로 send 가 호출됐다 (id=${req.id}) — worker 는 configured 를 확인하고 claim 전에 멈춰야 한다`,
      );
    },
  };
}

/** 테스트 시나리오 — 요청과 호출 순번(0부터)을 받아 결과를 낸다. throw 하면 worker 의 'sender_threw' 경로를 탄다. */
export type MemoryScript = (req: SendRequest, index: number) => SendOutcome | Promise<SendOutcome>;

export interface MemorySender extends NotificationSender {
  /** send 가 받은 요청, 호출 순서대로. */
  readonly calls: readonly SendRequest[];
}

/** 테스트·로컬 실증용. script 가 없으면 전부 성공(providerMessageId = memory-<id>). 실제 발송은 없다. */
export function memorySender(script?: MemoryScript): MemorySender {
  const calls: SendRequest[] = [];
  return {
    name: MEMORY_SENDER_NAME,
    configured: true,
    calls,
    async send(req) {
      const index = calls.length;
      calls.push(req);
      if (!script) return { ok: true, providerMessageId: `memory-${req.id}` };
      return script(req, index);
    },
  };
}
