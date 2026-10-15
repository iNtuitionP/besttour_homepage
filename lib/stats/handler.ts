/**
 * POST /api/stats/view 의 본체 (OF2-C) — 의존을 인자로 받아 vitest 가 그대로 돌린다(app/api/stats/view/route.ts 는 얇은 껍데기).
 *
 * 흐름: 봇·거부 헤더 → 본문(경로) → 세어도 되는 경로 → IP 한도 → vid → DB 기록. **어느 단계에서 빠지든 응답은 204** 다 —
 * 통계가 방문자 화면을 깨거나, 봇에게 어느 단계에서 걸렸는지 알려 주지 않는다.
 *
 * IP·UA 원문은 두 곳에서만 쓰이고 **어디에도 저장·기록되지 않는다**:
 *   · vid 해시의 입력(lib/stats/visitor-id.ts) — 나온 값은 128비트 해시뿐이다.
 *   · 한도 키(lib/guard/ipKey.ts clientIpKey — sha256(secret + ip) 앞 16자).
 * DB 로 가는 것은 vid 하나뿐(`record(vid)`)이다. 로그에는 오류 이름만 남긴다(메시지에 IP·UA 가 섞일 수 있다).
 *
 * 한도: ratelimit(한도 초과)면 세지 않는다. infra(Redis 장애·타임아웃·설정 누락)면 **세기를 멈추지 않는다** — 통계는 보안 경계가 아니고,
 * Redis 가 잠깐 죽었다고 방문 숫자에 구멍이 나면 안 된다(접수·예약확인 가드는 fail-closed 지만 그쪽은 개인정보·발송을 지킨다).
 * secret(GUARD_SECRET) 이 없으면 vid 를 만들 수 없으므로 세지 않는다(fail-closed — 해시 없이 저장하지 않는다).
 */
import { clientIp, clientIpKey, UNKNOWN_IP_BUCKET } from "@/lib/guard/ipKey";
import type { GuardResult, IpBucket } from "@/lib/guard/types";
import { toKstDateString } from "@/lib/kst";

import { SITE_VIEW_MAX_BODY, browserSendsRefusal, isBotUserAgent, isCountablePath } from "./site-view";
import { visitorId } from "./visitor-id";

export interface SiteViewDeps {
  now: () => Date;
  /** GUARD_SECRET — 없거나 짧으면 던진다. */
  secret: () => string;
  /** 키는 IP 해시(원문 아님). */
  checkRate: (key: string, bucket: IpBucket) => Promise<GuardResult>;
  /** DB 의 record_site_view(vid) — 서비스 롤 · 인자는 vid 뿐. */
  record: (vid: string) => Promise<void>;
}

const noContent = (): Response => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

/** 오류 이름만 기록한다 — 메시지·스택에는 IP·UA 가 섞일 수 있다. */
function logFailure(stage: string, err: unknown): void {
  console.error(JSON.stringify({ event: "site_view_error", stage, name: err instanceof Error ? err.name : typeof err }));
}

/** 비콘 본문에서 경로를 꺼낸다 — 모양이 어긋나면 null. */
async function readPath(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > SITE_VIEW_MAX_BODY) return null;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (text.length > SITE_VIEW_MAX_BODY) return null;
  try {
    const body: unknown = JSON.parse(text);
    if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
    const p = (body as { path?: unknown }).path;
    return typeof p === "string" ? p : null;
  } catch {
    return null;
  }
}

export async function handleSiteView(request: Request, deps: SiteViewDeps): Promise<Response> {
  const headers = request.headers;
  const userAgent = headers.get("user-agent");
  if (isBotUserAgent(userAgent) || userAgent === null) return noContent();
  // 거부: 클라이언트가 이미 보내지 않았겠지만(저장 표시·DNT·GPC), 헤더가 오면 서버도 세지 않는다.
  if (browserSendsRefusal(headers)) return noContent();

  const path = await readPath(request);
  if (path === null || !isCountablePath(path)) return noContent();

  let secret: string;
  try {
    secret = deps.secret();
  } catch (err) {
    logFailure("secret", err);
    return noContent();
  }

  try {
    const rate = clientIpKey(headers, secret);
    let limited = false;
    try {
      const res = await deps.checkRate(rate.key, rate.bucket);
      limited = !res.ok && res.reason === "ratelimit";
    } catch (err) {
      logFailure("ratelimit", err); // 장애는 세기를 멈추지 않는다
    }
    if (limited) return noContent();

    const vid = visitorId({
      secret,
      kstDate: toKstDateString(deps.now()),
      ip: clientIp(headers) ?? UNKNOWN_IP_BUCKET,
      userAgent,
    });
    await deps.record(vid);
  } catch (err) {
    logFailure("record", err);
  }
  return noContent();
}
