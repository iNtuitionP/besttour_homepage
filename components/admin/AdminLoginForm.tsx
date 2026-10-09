"use client";

/**
 * 관리자 로그인 폼 (P5-1) — 주소 한 칸 + 전송 버튼.
 *
 *   - 제출: <form action={formAction}> + useActionState. 서버액션 시그니처는 (formData) 하나라 (_prev, fd) 래퍼로 감싼다
 *     (P3-3 리뷰 M3 — 액션을 직접 넘기면 prevState 가 첫 인자가 된다).
 *   - **문구를 자기가 갖고 있지 않다.** 관리자 영역은 로케일 밖이라 NextIntlClientProvider 가 없다 —
 *     서버 페이지가 messages/ko.json admin.login.* 을 읽어 props 로 내린다(한글 리터럴 0).
 *   - 결과 5종(sent·closed·invalid·ratelimit·infra)은 전부 같은 자리(role="alert")에 한 줄로 뜬다.
 *     **성공과 "목록 밖" 이 같은 문구**인 것이 설계다 — 어느 주소가 관리자인지 화면으로도 알려주지 않는다.
 *   - 설정이 없으면(ready=false) 입력·버튼을 비활성화한다(P3-4 fail-closed 패턴). 죽은 버튼을 두지 않는다.
 *   - 허니팟 `website` 는 P3-4·P6-3a 와 같은 처리(aria-hidden + tabIndex -1 + 화면 밖).
 */
import { useActionState, useId, type FormEvent } from "react";

import { requestAdminLoginLink } from "@/actions/admin/auth";
import { ADMIN_EMAIL_FIELD, type AdminLoginResult, type AdminLoginState } from "@/lib/auth/adminLogin";
import { HONEYPOT_FIELD } from "@/lib/guard/honeypot";

import s from "@/app/admin/login/login.module.css";

export interface AdminLoginFormProps {
  /** 설정이 갖춰졌는가. false 면 제출을 닫는다(문구는 notice 로 온다). */
  ready: boolean;
  /** 서버가 미리 정한 안내 — 설정 부재(closed·unavailable) 또는 콜백 실패. 없으면 null. */
  notice: string | null;
  labels: {
    emailLabel: string;
    submit: string;
    submitting: string;
  };
  /** 액션 결과 상태 → 화면 문구. 서버 페이지가 카탈로그에서 뽑아 내린다. */
  messages: Record<AdminLoginState, string>;
}

export function AdminLoginForm({ ready, notice, labels, messages }: AdminLoginFormProps) {
  const idPrefix = useId();
  const emailId = `${idPrefix}-email`;

  const [result, formAction, pending] = useActionState<AdminLoginResult | null, FormData>(
    async (_prev, fd) => requestAdminLoginLink(fd),
    null,
  );

  const message = notice ?? (result ? messages[result.state] : null);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (!ready) e.preventDefault();
  };

  return (
    <form className={s.form} action={formAction} onSubmit={onSubmit} noValidate>
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
          autoComplete="email"
          spellCheck={false}
          maxLength={254}
          disabled={!ready || pending}
          required
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

      <button className={s.submit} type="submit" disabled={!ready || pending}>
        {pending ? labels.submitting : labels.submit}
      </button>

      <p className={s.notice} role="alert" data-testid="admin-login-message">
        {message}
      </p>
    </form>
  );
}
