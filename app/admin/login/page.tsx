import { getTranslations } from "next-intl/server";

import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { routing } from "@/i18n/routing";
import {
  ADMIN_LOGIN_ERROR_CALLBACK,
  ADMIN_LOGIN_ERROR_PARAM,
  adminEmailAllowlist,
  type AdminLoginState,
} from "@/lib/auth/adminLogin";
import { adminGuardDeps } from "@/lib/guard/deps";

import s from "./login.module.css";

/**
 * /admin/login — 관리자 로그인 (P5-1). (protected) 그룹 **밖**이라 게이트를 타지 않는다.
 * app/admin/layout.tsx 가 force-dynamic 이므로 이 화면도 요청마다 렌더되고 캐시에 남지 않는다.
 *
 * 여기서 하는 일은 두 가지다:
 *   1. 설정이 갖춰졌는지 확인해 **닫힌 상태를 화면으로 표현한다**(fail-closed 3경로 중 둘).
 *      - ADMIN_EMAILS 가 비었다  → closed:      로그인 자체가 설정되지 않았다
 *      - Upstash·GUARD_SECRET 부재 → unavailable: 방어(rate limit)가 없으면 메일 발송 문을 열지 않는다
 *      세 번째 경로(허용 목록 밖 주소)는 화면이 아니라 액션이 담당한다 — 목록 안과 **같은 응답**이라 화면도 같다.
 *   2. 문구를 카탈로그에서 읽어 클라이언트 폼에 props 로 내린다. 관리자 영역은 로케일 밖이라
 *      NextIntlClientProvider 가 없다 — 클라이언트에서 useTranslations 를 쓸 수 없다.
 *
 * 설정 확인에 adminGuardDeps() 를 실제로 불러 본다(생성은 네트워크를 타지 않는다). env 이름을 여기서 다시 열거하면
 * deps 쪽 검증과 갈라지기 때문이다 — "액션이 던질 것인가" 를 화면이 같은 코드로 물어본다.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.login" });

  const allowlistEmpty = adminEmailAllowlist().length === 0;
  let guardReady = true;
  if (!allowlistEmpty) {
    try {
      adminGuardDeps();
    } catch {
      guardReady = false;
    }
  }
  const ready = !allowlistEmpty && guardReady;

  const params = await searchParams;
  const callbackFailed = params[ADMIN_LOGIN_ERROR_PARAM] === ADMIN_LOGIN_ERROR_CALLBACK;

  let notice: string | null = null;
  if (allowlistEmpty) notice = t("closed");
  else if (!guardReady) notice = t("unavailable");
  else if (callbackFailed) notice = t("callbackFailed");

  const messages: Record<AdminLoginState, string> = {
    sent: t("sent"),
    closed: t("closed"),
    invalid: t("invalid"),
    ratelimit: t("ratelimit"),
    infra: t("infra"),
  };

  return (
    <main className={s.main} data-testid="admin-login">
      <div className={s.card}>
        <h1 className={s.title}>{t("title")}</h1>
        <p className={s.sub}>{t("sub")}</p>
        <AdminLoginForm
          ready={ready}
          notice={notice}
          labels={{ emailLabel: t("emailLabel"), submit: t("submit"), submitting: t("submitting") }}
          messages={messages}
        />
      </div>
    </main>
  );
}
