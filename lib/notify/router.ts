/**
 * 채널 라우팅 sender (플랜 v4 P4-5 · ADR-7).
 *
 * 어댑터는 채널 하나씩만 안다 — 문자는 `./solapi.ts`, 메일은 `./mail.ts`. 이 파일은 그 둘을 하나의
 * `NotificationSender` 로 묶어 worker 에 넘긴다. worker 는 여전히 sender 포트 하나만 본다.
 *
 * ## 이 파일이 존재하는 이유 — claim 을 채널로 가리기 위해서다
 * worker 의 대원칙은 "**보낼 수 없으면 claim 하지 않는다**" 다(worker.ts 헤더). claim 은 attempts 를 +1 하고 lease 를 건다 —
 * 되돌릴 수 없다. 그 원칙이 2026-09-15 까지 **sender 전체에만** 적용되고 **채널 단위로는 적용되지 않았다.**
 * 그래서 사장님 번호가 없어 생긴 `channel='email'` 행을 문자 어댑터가 집어가 `unsupported_channel:email` 로 다섯 번을
 * 확정 실패시키고 죽였다. 고객 문자는 나가고 사장님 알림만 조용히 사라지는 형태다.
 *
 * 그 결함을 닫는 규칙이 아래 **한 줄**이다:
 *   `channels` = **구성된(configured === true) 구성원들의 채널 합집합.**
 * 미구성 구성원의 채널은 넣지 않는다. worker 가 그 채널을 claim 에 넘기지 않으므로(0014 p_channels), 그 행은
 * pending 인 채로 큐에 남고 attempts 는 0 그대로다 — **키가 온 날 그대로 나간다.**
 *
 * ## 채널을 고르는 기준은 구성원의 선언이다
 * `sms` · `email` 키는 **보고서에 찍히는 이름표**일 뿐이고, 실제 라우팅은 각 구성원이 스스로 밝힌 `channels` 가 정한다.
 * 같은 채널을 둘이 들고 있으면 먼저 선언된 쪽(sms → email 순)이 담당한다.
 *
 * 순수 모듈 — env 없음, 네트워크 없음, 서버 지시어 없음. env 를 보는 곳은 app/api/cron/notify/route.ts 뿐이다(P4-1 경계).
 */
import type { NotifyChannel } from "../types";
import type { NotificationSender, SendOutcome, SendRequest } from "./sender";

/** 보고서·로그 이름의 앞머리. 뒤에 구성원 목록이 붙는다 — `routing(sms=solapi,email=resend)`. */
export const ROUTING_SENDER_PREFIX = "routing";

/**
 * 담당 어댑터가 없는 채널의 실패 코드 앞머리. **retryable:true** 다 — 키가 오면 보낼 수 있는 행이므로
 * "영구 실패" 로 기록하지 않는다. 정상 경로에서는 claim 이 이미 가려 주므로 여기까지 오지 않는다(방어).
 */
export const NO_SENDER_FOR_CHANNEL_PREFIX = "no_sender_for_channel:";

/** 이름·코드에 실어도 되는 형태(solapi.ts CODE_SHAPE 와 같은 규약) — 사람이 읽는 문구·수신처가 새는 것을 막는다. */
const SAFE_SHAPE = /^[A-Za-z0-9_.-]{1,40}$/;
const safeWord = (raw: unknown): string => (typeof raw === "string" && SAFE_SHAPE.test(raw.trim()) ? raw.trim() : "unknown");

/** 라우팅에 넣을 구성원. 키는 이름표이고, 실제 담당 채널은 각 구성원의 `channels` 가 정한다. */
export interface RoutingMembers {
  sms?: NotificationSender;
  email?: NotificationSender;
}

/** 구성원 키의 고정 순서 — 이름과 담당 선택의 순서를 둘 다 정한다(입력 객체의 키 순서에 의존하지 않는다). */
const MEMBER_ORDER = ["sms", "email"] as const satisfies readonly (keyof RoutingMembers)[];

/**
 * 채널별로 나눠 보내는 sender.
 *
 *   - `channels`  구성된 구성원들의 채널 합집합(중복 제거, 선언 순서 유지). worker 가 claim 에 그대로 넘긴다.
 *   - `configured` channels 가 하나라도 있으면 true. 전부 미구성이면 false 이고 worker 는 claim 하지 않는다.
 *   - `send`      req.channel 을 담당하는 구성원에게 그대로 넘긴다. 담당이 없으면 재시도 가능한 실패.
 *   - `name`      켜진 구성원과 꺼진 구성원을 함께 드러낸다 — 보고서만 보고 무엇이 켜졌는지 알아야 한다.
 */
export function routingSender(members: RoutingMembers): NotificationSender {
  const present = MEMBER_ORDER.filter((key) => members[key] !== undefined).map((key) => ({ key, sender: members[key] as NotificationSender }));

  // configured 는 **정확히 true** 일 때만 인정한다(worker 와 같은 규약 — undefined·'true' 는 미구성이다).
  const live = present.filter(({ sender }) => sender.configured === true);

  const byChannel = new Map<NotifyChannel, NotificationSender>();
  for (const { sender } of live) {
    for (const channel of sender.channels ?? []) {
      if (!byChannel.has(channel)) byChannel.set(channel, sender);
    }
  }
  const channels = Object.freeze([...byChannel.keys()]) as readonly NotifyChannel[];

  const name = `${ROUTING_SENDER_PREFIX}(${present
    .map(({ key, sender }) => `${key}=${safeWord(sender.name)}${sender.configured === true ? "" : "(off)"}`)
    .join(",")})`;

  return {
    name,
    configured: channels.length > 0,
    channels,

    async send(req: SendRequest): Promise<SendOutcome> {
      const member = byChannel.get(req.channel);
      if (member === undefined) {
        // claim 이 가려 주므로 정상 경로에서는 도달하지 않는다. 도달했다면 큐에 담당 없는 채널의 행이 있다는 뜻이고,
        // 그것은 "보낼 수 없다" 이지 "보내면 안 된다" 가 아니다 — 키가 오면 보낼 수 있으므로 재시도 가능으로 남긴다.
        return { ok: false, error: `${NO_SENDER_FOR_CHANNEL_PREFIX}${safeWord(req.channel)}`, retryable: true };
      }
      return member.send(req);
    },
  };
}
