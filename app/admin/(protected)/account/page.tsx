import { getTranslations } from "next-intl/server";

import { AccountPasswordForm } from "@/components/admin/AccountPasswordForm";
import { routing } from "@/i18n/routing";
import { ACCOUNT_STATES, type AccountState } from "@/lib/auth/adminAccount";
import { requireAdmin } from "@/lib/auth/requireAdmin";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/account — 내 계정: 비밀번호 정하기·바꾸기 (OF-T3-6 · 사장님 요청 13 · 결정 6).
 *
 * 처음 비밀번호도 여기서 정한다 — 메일 링크로 로그인한 뒤 이 화면에서 설정한다(비밀번호는 채팅·문서로 주고받지 않는다).
 * 사이드바 아래 · 휴대폰 위 제목줄의 "내 계정" 링크가 여기로 온다(components/admin/AdminTabs.tsx).
 *
 * 첫 문장 게이트(조건·try 금지 — scripts/check-admin-gate.mjs 규칙 2·4). 변경 액션(actions/admin/account.ts)도 자기 첫 문장에서 다시 게이트를 탄다.
 * 화면에 보이는 주소는 게이트가 돌려준 세션의 주소다(권한 판정에는 쓰지 않는다 — 표시와 비밀번호 관리자의 username 칸용).
 * 이 폴더에는 loading.tsx 를 두지 않는다 — (protected)/loading.tsx 가 맡는다.
 */
export default async function AdminAccountPage() {
  const session = await requireAdmin();

  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.account" });
  const messages = Object.fromEntries(ACCOUNT_STATES.map((k) => [k, t(k)])) as Record<AccountState, string>;

  return (
    <main className={q.main} data-testid="admin-account">
      <div className={a.pageWrap}>
        <header className={q.pageHead}>
          <h1 className={q.title}>{t("title")}</h1>
          <p className={q.sub}>{t("sub")}</p>
        </header>
        <AccountPasswordForm
          email={session.email}
          labels={{
            emailLabel: t("emailLabel"),
            newPasswordLabel: t("newPasswordLabel"),
            confirmPasswordLabel: t("confirmPasswordLabel"),
            hint: t("hint"),
            submit: t("submit"),
            submitting: t("submitting"),
          }}
          messages={messages}
        />
      </div>
    </main>
  );
}
