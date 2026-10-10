"use client";

/**
 * 내 계정 — 비밀번호 정하기·바꾸기 폼 (OF-T3-6 · 결정 6).
 *
 *   - 새 비밀번호 두 칸. 클라이언트는 빈 칸·불일치·72자 초과만 미리 막고(서버도 같은 판정을 한다 — lib/auth/adminAccount.ts checkPasswordInput),
 *     최소 길이·조합은 원격 Supabase Auth 규칙에 맡긴다. 원격이 거부하면 서버가 이유를 상태 이름으로 돌려주고 여기서 사람 말로 보인다.
 *   - 결과 알림은 관리자 화면 공통 규약(tests/admin-copy-tone.test.ts 4): **성공은 토스트**(useAdminToast — 레이아웃의 자리),
 *     **실패는 그 자리 배너**(AdminBanner — role=alert · 나타날 때 탭 바 위로 스크롤 · 저절로 닫히지 않음). 제출을 시작할 때 배너를 비운다
 *     (AdminBanner 머리 주석 ① — 같은 실패가 다시 와도 새로 붙어 다시 보이는 자리로 온다).
 *   - **비밀번호는 남기지 않는다.** 서버 응답이 오면 두 칸을 비운다(성공·실패 모두 — 다시 칠 때는 처음부터). 결과에는 상태 이름만 있다.
 *     클라이언트 판정에서 막힌 경우(불일치 등)는 서버로 가지 않았으므로 칸을 그대로 두어 고칠 수 있게 한다.
 *   - 메일 주소는 읽기 전용 칸으로 보인다(autocomplete=username · name 없음 — 서버로 보내지 않는다). 비밀번호 관리자가 어느 계정의 비밀번호인지 알 수 있게.
 *   - 문구는 서버 페이지가 messages/ko.json admin.account.* 에서 뽑아 props 로 내린다(한글 리터럴 0).
 */
import { useId, useRef, useState, useTransition, type FormEvent } from "react";

import { changeAdminPassword } from "@/actions/admin/account";
import {
  ACCOUNT_CONFIRM_PASSWORD_FIELD,
  ACCOUNT_NEW_PASSWORD_FIELD,
  checkPasswordInput,
  type AccountState,
} from "@/lib/auth/adminAccount";
import { ADMIN_PASSWORD_MAX_LENGTH } from "@/lib/auth/adminLogin";

import l from "@/app/admin/login/login.module.css";

import { AdminBanner } from "./AdminBanner";
import { useAdminToast } from "./AdminToast";

import a from "./admin.module.css";

export interface AccountPasswordFormProps {
  email: string;
  labels: {
    emailLabel: string;
    newPasswordLabel: string;
    confirmPasswordLabel: string;
    hint: string;
    submit: string;
    submitting: string;
  };
  messages: Record<AccountState, string>;
}

export function AccountPasswordForm({ email, labels, messages }: AccountPasswordFormProps) {
  const idPrefix = useId();
  const emailId = `${idPrefix}-email`;
  const newId = `${idPrefix}-new`;
  const confirmId = `${idPrefix}-confirm`;
  const hintId = `${idPrefix}-hint`;

  const toast = useAdminToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState("");

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setBanner("");
    const bad = checkPasswordInput(formData.get(ACCOUNT_NEW_PASSWORD_FIELD), formData.get(ACCOUNT_CONFIRM_PASSWORD_FIELD));
    if (bad !== null) {
      setBanner(messages[bad]);
      return;
    }
    startTransition(async () => {
      let state: AccountState;
      try {
        state = (await changeAdminPassword(formData)).state;
      } catch {
        state = "failed";
      }
      formRef.current?.reset();
      if (state === "changed") toast.show({ text: messages.changed });
      else setBanner(messages[state]);
    });
  };

  return (
    <div className={a.accountCard}>
      <form ref={formRef} className={l.form} onSubmit={onSubmit} noValidate data-testid="admin-account-form">
        <div className={l.field}>
          <label className={l.label} htmlFor={emailId}>
            {labels.emailLabel}
          </label>
          <input className={l.input} id={emailId} type="email" autoComplete="username" value={email} readOnly data-testid="admin-account-email" />
        </div>

        <div className={l.field}>
          <label className={l.label} htmlFor={newId}>
            {labels.newPasswordLabel}
          </label>
          <input
            className={l.input}
            id={newId}
            name={ACCOUNT_NEW_PASSWORD_FIELD}
            type="password"
            autoComplete="new-password"
            maxLength={ADMIN_PASSWORD_MAX_LENGTH}
            aria-describedby={hintId}
            disabled={pending}
            data-testid="admin-account-new"
          />
          <p className={l.linkHint} id={hintId}>
            {labels.hint}
          </p>
        </div>

        <div className={l.field}>
          <label className={l.label} htmlFor={confirmId}>
            {labels.confirmPasswordLabel}
          </label>
          <input
            className={l.input}
            id={confirmId}
            name={ACCOUNT_CONFIRM_PASSWORD_FIELD}
            type="password"
            autoComplete="new-password"
            maxLength={ADMIN_PASSWORD_MAX_LENGTH}
            disabled={pending}
            data-testid="admin-account-confirm"
          />
        </div>

        <button className={l.submit} type="submit" disabled={pending} data-testid="admin-account-submit">
          {pending ? labels.submitting : labels.submit}
        </button>

        <AdminBanner text={banner} testId="admin-account-error" />
      </form>
    </div>
  );
}
