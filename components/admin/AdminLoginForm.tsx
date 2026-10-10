"use client";

/**
 * 관리자 로그인 폼 (P5-1 → OF-T3-6 · 사장님 요청 13 · 결정 6) — 메일 주소 + 비밀번호가 기본, 메일 링크는 보조(비상용).
 *
 *   - 한 폼, 제출 버튼 둘. 두 버튼이 `name="mode"` 로 password / link 를 싣는다(React 는 누른 버튼의 name·value 를 FormData 에 넣는다).
 *     엔터 키는 첫 버튼(로그인)을 누른 것과 같다. 서버액션은 하나(actions/admin/auth.ts signInAdmin — ADR-3 export 하나).
 *   - 제출: <form action={formAction}> + useActionState. 서버액션 시그니처는 (formData) 하나라 (_prev, fd) 래퍼로 감싼다
 *     (P3-3 리뷰 M3 — 액션을 직접 넘기면 prevState 가 첫 인자가 된다). 비밀번호 로그인에 성공하면 서버가 redirect 하므로 결과가 오지 않는다.
 *   - **문구를 자기가 갖고 있지 않다.** 관리자 영역은 로케일 밖이라 NextIntlClientProvider 가 없다 —
 *     서버 페이지가 messages/ko.json admin.login.* 을 읽어 props 로 내린다(한글 리터럴 0).
 *   - 결과 6종은 전부 같은 자리(role="alert")에 한 줄로 뜬다. 비밀번호 실패는 이유와 무관하게 `credentials` 한 문구다 —
 *     없는 주소·틀린 비밀번호·허용 목록 밖·보안 확인 실패를 화면으로도 구분하지 않는다. 링크 모드는 성공과 "목록 밖" 이 같은 문구다.
 *   - **CAPTCHA(Turnstile)**: 위젯이 폼 안에 `cf-turnstile-response` 를 스스로 넣는다. 토큰이 아직 없으면 서버에 보내지 않고 안내만 띄운다.
 *     서버 응답이 오면 위젯을 리셋한다 — 토큰은 1회용이라 같은 토큰으로 다시 보내면 원격 Supabase Auth 가 거부한다.
 *   - **비밀번호는 남기지 않는다.** 칸은 비제어(uncontrolled)라 React 가 제출 뒤 폼을 되돌릴 때 비워진다. 메일 주소만 상태로 들고 있어 남는다.
 *     결과 상태에는 비밀번호가 없다(서버가 상태 이름만 돌려준다).
 *   - 설정이 없으면(ready=false) 입력·버튼을 비활성화한다(P3-4 fail-closed 패턴). 죽은 버튼을 두지 않는다.
 *   - 허니팟 `website` 는 P3-4·P6-3a 와 같은 처리(aria-hidden + tabIndex -1 + 화면 밖).
 */
import { useActionState, useEffect, useId, useState, type FormEvent } from "react";

import { signInAdmin } from "@/actions/admin/auth";
import { TurnstileWidget } from "@/components/quote/TurnstileWidget";
import {
  ADMIN_CAPTCHA_FIELD,
  ADMIN_EMAIL_FIELD,
  ADMIN_EMAIL_MAX_LENGTH,
  ADMIN_MODE_FIELD,
  ADMIN_PASSWORD_FIELD,
  ADMIN_PASSWORD_MAX_LENGTH,
  parseAdminLoginMode,
  type AdminLoginMode,
  type AdminLoginResult,
  type AdminLoginState,
} from "@/lib/auth/adminLogin";
import { HONEYPOT_FIELD } from "@/lib/guard/honeypot";

import s from "@/app/admin/login/login.module.css";

export interface AdminLoginFormProps {
  /** 설정이 갖춰졌는가. false 면 제출을 닫는다(문구는 notice 로 온다). */
  ready: boolean;
  /** 서버가 미리 정한 안내 — 설정 부재(closed·unavailable) 또는 콜백 실패. 없으면 null. */
  notice: string | null;
  labels: {
    emailLabel: string;
    passwordLabel: string;
    submit: string;
    submitting: string;
    linkHint: string;
    linkSubmit: string;
    linkSubmitting: string;
    captchaWaiting: string;
  };
  /** 액션 결과 상태 → 화면 문구. 서버 페이지가 카탈로그에서 뽑아 내린다. */
  messages: Record<AdminLoginState, string>;
  /** NEXT_PUBLIC_TURNSTILE_SITE_KEY. 비어 있으면 페이지가 ready=false 로 내린다(위젯을 그리지 않는다). */
  turnstileSiteKey: string;
  turnstileAction: string;
}

export function AdminLoginForm({ ready, notice, labels, messages, turnstileSiteKey, turnstileAction }: AdminLoginFormProps) {
  const idPrefix = useId();
  const emailId = `${idPrefix}-email`;
  const passwordId = `${idPrefix}-password`;
  const linkHintId = `${idPrefix}-link-hint`;

  const [email, setEmail] = useState("");
  const [submittedMode, setSubmittedMode] = useState<AdminLoginMode>("password");
  const [captchaWaiting, setCaptchaWaiting] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const [result, formAction, pending] = useActionState<AdminLoginResult | null, FormData>(
    async (_prev, fd) => signInAdmin(fd),
    null,
  );

  // 서버 응답이 오면 위젯을 리셋한다(토큰 1회용).
  useEffect(() => {
    if (result) setResetKey((k) => k + 1);
  }, [result]);

  const message = notice ?? (captchaWaiting ? labels.captchaWaiting : result ? messages[result.state] : null);
  const locked = !ready || pending;

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (!ready) {
      e.preventDefault();
      return;
    }
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const mode = parseAdminLoginMode(submitter instanceof HTMLButtonElement ? submitter.value : null);
    // 위젯이 아직 토큰을 넣지 않았으면 서버에 보내지 않는다 — 보내 봐야 거부다.
    const token = new FormData(e.currentTarget).get(ADMIN_CAPTCHA_FIELD);
    if (typeof token !== "string" || token.length === 0) {
      e.preventDefault();
      setCaptchaWaiting(true);
      return;
    }
    setCaptchaWaiting(false);
    setSubmittedMode(mode);
  };

  return (
    <form className={s.form} action={formAction} onSubmit={onSubmit} noValidate data-testid="admin-login-form">
      <div className={s.field}>
        <label className={s.label} htmlFor={emailId}>
          {labels.emailLabel}
        </label>
        <input
          className={s.input}
          id={emailId}
          name={ADMIN_EMAIL_FIELD}
          type="email"
          inputMode="email"
          autoComplete="username"
          spellCheck={false}
          maxLength={ADMIN_EMAIL_MAX_LENGTH}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={locked}
          required
          data-testid="admin-login-email"
        />
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor={passwordId}>
          {labels.passwordLabel}
        </label>
        <input
          className={s.input}
          id={passwordId}
          name={ADMIN_PASSWORD_FIELD}
          type="password"
          autoComplete="current-password"
          maxLength={ADMIN_PASSWORD_MAX_LENGTH}
          disabled={locked}
          data-testid="admin-login-password"
        />
      </div>

      <input
        className={s.honeypot}
        type="text"
        name={HONEYPOT_FIELD}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        defaultValue=""
      />

      {ready ? <TurnstileWidget siteKey={turnstileSiteKey} action={turnstileAction} resetKey={resetKey} /> : null}

      <button className={s.submit} type="submit" name={ADMIN_MODE_FIELD} value="password" disabled={locked} data-testid="admin-login-submit">
        {pending && submittedMode === "password" ? labels.submitting : labels.submit}
      </button>

      <p className={s.notice} role="alert" data-testid="admin-login-message">
        {message}
      </p>

      <div className={s.linkBox}>
        <p className={s.linkHint} id={linkHintId}>
          {labels.linkHint}
        </p>
        <button
          className={s.secondary}
          type="submit"
          name={ADMIN_MODE_FIELD}
          value="link"
          disabled={locked}
          aria-describedby={linkHintId}
          data-testid="admin-login-link-submit"
        >
          {pending && submittedMode === "link" ? labels.linkSubmitting : labels.linkSubmit}
        </button>
      </div>
    </form>
  );
}
