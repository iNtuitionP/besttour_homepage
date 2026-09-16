/**
 * P4-5 — 채널 라우팅 sender 계약 테스트 (플랜 v4 · ADR-7).
 *
 * 브리프 §검증 3 을 그대로 단언한다:
 *   1. channels = **구성된 구성원들의 채널 합집합** — 미구성 구성원의 채널은 들어가지 않는다(이 태스크의 핵심)
 *   2. configured = channels.length > 0
 *   3. send 는 req.channel 로 담당을 고르고, 담당이 없으면 no_sender_for_channel:… · **retryable:true**
 *   4. name 이 구성원을 드러낸다 — 보고서만 보고 무엇이 켜졌는지 알 수 있어야 한다
 *   5. 정적 — env 0 · 네트워크 0 (env 를 보는 곳은 app/api/cron/notify/route.ts 뿐이다)
 *
 * 왜 "미구성 구성원의 채널을 넣지 않는다" 가 핵심인가: worker 는 sender.channels 를 그대로 claim 에 넘긴다(0014).
 * 미구성 구성원의 채널을 넣으면 그 채널의 행이 claim 되고, claim 은 attempts 를 +1 하고 lease 를 건다 — 되돌릴 수 없다.
 * 키가 오기 전에 5회를 태우면 키가 온 뒤에도 영영 보낼 수 없다(worker.ts 헤더의 대원칙을 채널 단위로 내린 것).
 *
 * 실제 네트워크 0 — 이 파일은 가짜 sender 만 쓴다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

import { ALL_NOTIFY_CHANNELS, type NotificationSender, type SendOutcome, type SendRequest } from "@/lib/notify/sender";
import { NO_SENDER_FOR_CHANNEL_PREFIX, ROUTING_SENDER_PREFIX, routingSender } from "@/lib/notify/router";
import type { NotifyChannel } from "@/lib/types";

const ROOT = path.resolve(import.meta.dirname, "..");
const RID = "00000000-0000-4000-8000-000000000042";

const req = (over: Partial<SendRequest> = {}): SendRequest => ({
  id: 7,
  channel: "sms",
  to: "01098765432",
  template: "created.customer.sms",
  reservationId: RID,
  ...over,
});

/** 가짜 구성원 — 이름·구성 여부·채널을 직접 정한다. send 호출을 기록한다. */
function member(name: string, configured: boolean, channels: readonly NotifyChannel[]) {
  const send = vi.fn(async (r: SendRequest): Promise<SendOutcome> => ({ ok: true, providerMessageId: `${name}-${r.id}` }));
  return { name, configured, channels, send } satisfies NotificationSender & { send: typeof send };
}

const sms = () => member("solapi", true, ["sms"]);
const email = () => member("resend", true, ["email"]);
const smsOff = () => member("solapi", false, ["sms"]);
const emailOff = () => member("resend", false, ["email"]);

// =============================================================================
// 1. channels — 구성된 구성원들의 합집합
// =============================================================================
describe("1. channels 계산 (구성 조합 4가지)", () => {
  test("둘 다 구성 → ['sms','email'] · configured=true", () => {
    const s = routingSender({ sms: sms(), email: email() });
    expect(s.channels).toEqual(["sms", "email"]);
    expect(s.configured).toBe(true);
  });

  test("문자만 구성 → ['sms'] — 메일 채널은 들어가지 않는다(메일 행을 claim 하지 않는다)", () => {
    const s = routingSender({ sms: sms(), email: emailOff() });
    expect(s.channels).toEqual(["sms"]);
    expect(s.configured).toBe(true);
  });

  test("메일만 구성 → ['email']", () => {
    const s = routingSender({ sms: smsOff(), email: email() });
    expect(s.channels).toEqual(["email"]);
    expect(s.configured).toBe(true);
  });

  test("둘 다 미구성 → channels=[] · configured=false — worker 는 claim 조차 하지 않는다", () => {
    const s = routingSender({ sms: smsOff(), email: emailOff() });
    expect(s.channels).toEqual([]);
    expect(s.configured).toBe(false);
  });

  test("구성원이 아예 없어도 같은 상태 — channels=[] · configured=false", () => {
    const s = routingSender({});
    expect(s.channels).toEqual([]);
    expect(s.configured).toBe(false);
  });

  test("configured 가 정확히 true 가 아니면 미구성으로 본다 (undefined·'true'·1 도)", () => {
    for (const odd of [undefined, "true", 1, null]) {
      const bad = { name: "odd", configured: odd, channels: ["sms"], send: vi.fn() } as unknown as NotificationSender;
      const s = routingSender({ sms: bad });
      expect(s.channels, String(odd)).toEqual([]);
      expect(s.configured, String(odd)).toBe(false);
    }
  });

  test("구성원이 여러 채널을 들고 있으면 전부 합치고, 겹치는 채널은 한 번만 — 순서는 안정적이다", () => {
    const all = member("memory", true, ALL_NOTIFY_CHANNELS);
    const s = routingSender({ sms: all, email: email() });
    expect(s.channels).toEqual([...ALL_NOTIFY_CHANNELS]);
    expect(new Set(s.channels).size).toBe(s.channels.length);
  });

  test("channels 는 읽기 전용 배열이고 호출마다 같은 값이다", () => {
    const s = routingSender({ sms: sms() });
    expect(s.channels).toEqual(s.channels);
    expect(Object.isFrozen(s.channels)).toBe(true);
  });
});

// =============================================================================
// 2. send — 채널로 담당을 고른다
// =============================================================================
describe("2. send 라우팅", () => {
  test("문자 행은 문자 어댑터로, 메일 행은 메일 어댑터로 — 서로의 요청을 보지 않는다", async () => {
    const a = sms();
    const b = email();
    const s = routingSender({ sms: a, email: b });

    expect(await s.send(req({ id: 1, channel: "sms" }))).toEqual({ ok: true, providerMessageId: "solapi-1" });
    expect(await s.send(req({ id: 2, channel: "email", to: "owner@example.test", template: "created.owner.email" }))).toEqual({
      ok: true,
      providerMessageId: "resend-2",
    });

    expect(a.send.mock.calls.map((c) => c[0].id)).toEqual([1]);
    expect(b.send.mock.calls.map((c) => c[0].id)).toEqual([2]);
  });

  test("요청은 손대지 않고 그대로 넘긴다", async () => {
    const a = sms();
    const r = req({ id: 3 });
    await routingSender({ sms: a }).send(r);
    expect(a.send).toHaveBeenCalledWith(r);
  });

  test("담당이 없는 채널 → no_sender_for_channel:… · retryable:true (키가 오면 보낼 수 있다)", async () => {
    const a = sms();
    const out = await routingSender({ sms: a }).send(req({ channel: "email", to: "owner@example.test", template: "created.owner.email" }));
    expect(out).toEqual({ ok: false, error: `${NO_SENDER_FOR_CHANNEL_PREFIX}email`, retryable: true });
    expect(a.send).not.toHaveBeenCalled();
  });

  test("미구성 구성원에게는 보내지 않는다 — 담당 없음으로 떨어진다(구성원의 send 는 throw 하도록 설계돼 있다)", async () => {
    const off = emailOff();
    const out = await routingSender({ sms: sms(), email: off }).send(req({ channel: "email", to: "owner@example.test" }));
    expect(out).toEqual({ ok: false, error: `${NO_SENDER_FOR_CHANNEL_PREFIX}email`, retryable: true });
    expect(off.send).not.toHaveBeenCalled();
  });

  test("알림톡은 담당이 없다 — 조용히 문자로 바꾸지 않는다", async () => {
    const out = await routingSender({ sms: sms(), email: email() }).send(req({ channel: "alimtalk" }));
    expect(out).toEqual({ ok: false, error: `${NO_SENDER_FOR_CHANNEL_PREFIX}alimtalk`, retryable: true });
  });

  test("채널 값이 이상해도 오류 문자열에 그대로 싣지 않는다 (형태 검사)", async () => {
    const out = await routingSender({ sms: sms() }).send(req({ channel: "메일 owner@example.test" as NotifyChannel }));
    expect(out).toEqual({ ok: false, error: `${NO_SENDER_FOR_CHANNEL_PREFIX}unknown`, retryable: true });
  });

  test("구성원이 낸 실패는 그대로 통과시킨다 (라우터가 판정을 바꾸지 않는다)", async () => {
    const a = member("solapi", true, ["sms"]);
    a.send.mockResolvedValueOnce({ ok: false, error: "provider_500:x", retryable: true });
    expect(await routingSender({ sms: a }).send(req())).toEqual({ ok: false, error: "provider_500:x", retryable: true });
  });

  test("같은 채널을 둘이 들고 있으면 먼저 선언된 구성원(sms → email 순)이 담당한다", async () => {
    const a = member("first", true, ["sms", "email"]);
    const b = member("second", true, ["email"]);
    const s = routingSender({ sms: a, email: b });
    await s.send(req({ channel: "email", to: "owner@example.test" }));
    expect(a.send).toHaveBeenCalledTimes(1);
    expect(b.send).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 3. name — 보고서만 보고 무엇이 켜졌는지 안다
// =============================================================================
describe("3. name", () => {
  test("구성원과 켜짐 여부를 드러낸다", () => {
    expect(routingSender({ sms: sms(), email: email() }).name).toBe(`${ROUTING_SENDER_PREFIX}(sms=solapi,email=resend)`);
    expect(routingSender({ sms: sms(), email: emailOff() }).name).toBe(`${ROUTING_SENDER_PREFIX}(sms=solapi,email=resend(off))`);
    expect(routingSender({ email: email() }).name).toBe(`${ROUTING_SENDER_PREFIX}(email=resend)`);
    expect(routingSender({}).name).toBe(`${ROUTING_SENDER_PREFIX}()`);
  });

  test("구성원 이름이 이상해도 짧고 안전한 형태로만 싣는다", () => {
    const weird = member("이름 owner@example.test " + "x".repeat(100), true, ["sms"]);
    const name = routingSender({ sms: weird }).name;
    expect(name).toBe(`${ROUTING_SENDER_PREFIX}(sms=unknown)`);
  });
});

// =============================================================================
// 4. 정적 — env 0 · 네트워크 0
// =============================================================================
describe("4. 정적", () => {
  const src = readFileSync(path.join(ROOT, "lib", "notify", "router.ts"), "utf-8");

  test("router.ts — process.env 0 · 'use server' 0 · server-only 0 · fetch 0", () => {
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/["']use server["']/);
    expect(src).not.toMatch(/import\s+["']server-only["']/);
    expect(src).not.toMatch(/(^|[^.\w])fetch\s*\(/m);
  });

  test("router.ts — import 는 같은 디렉터리·lib 타입뿐 (새 패키지 0)", () => {
    const specifiers = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const s of specifiers) expect(s.startsWith("./") || s.startsWith("../"), s).toBe(true);
  });

  test("sender.ts 를 부풀리지 않았다 — 구현은 router.ts 에만 있다(포트 파일에는 언급뿐)", () => {
    const sender = readFileSync(path.join(ROOT, "lib", "notify", "sender.ts"), "utf-8");
    expect(sender).not.toMatch(/export function routingSender/);
    expect(src).toMatch(/export function routingSender/);
  });
});
