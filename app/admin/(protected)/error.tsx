"use client";

/**
 * 관리자 화면 오류 경계 (P7-4 · 브리프 §8) — (protected) 레이아웃 **안**이라 메뉴·탭 바(관리자 셸)는 그대로 두고 본문 자리만 바뀐다.
 * 예전에는 이 파일이 없어 DB 오류 같은 예외에 Next 기본 오류 화면(영문)이 셸 없이 떴다(UIUX 감사 G-15).
 *
 *   - 클라이언트 경계(Next 규약)라 게이트 규칙 밖이다 — 데이터를 읽지 않고 requireAdmin 도 부르지 않는다(scripts/check-admin-gate.mjs 규칙 7 주석 ·
 *     tests/admin-gate.test.ts 6-c). 다시 시도(reset)는 같은 화면을 다시 그리고, 그때 게이트가 그대로 돈다.
 *   - 관리자 영역은 로케일 밖이라 NextIntlClientProvider 가 없다 — 문구(admin.error · 해요체)는 lib/i18n/error-copy.ts 를 지연 로드한다
 *     (받기 전 잠깐은 빈 본문 · aria-busy). 에러 원문(message·stack)은 내지 않는다 — digest 만 참조 번호로.
 * 이 파일에 한글 리터럴 없음.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "@/app/errors.module.css";
import { revealBanner } from "@/components/admin/AdminBanner";

type Copy = (typeof import("@/lib/i18n/error-copy"))["ADMIN_ERROR_COPY"];

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [copy, setCopy] = useState<Copy | null>(null);

  useEffect(() => {
    let alive = true;
    import("@/lib/i18n/error-copy")
      .then((m) => {
        if (alive) setCopy(m.ADMIN_ERROR_COPY);
      })
      .catch(() => {
        // 문구 조각을 받지 못하면 빈 본문 — 메뉴는 그대로 남아 다른 화면으로 옮길 수 있다
      });
    return () => {
      alive = false;
    };
  }, []);

  // 알림(role=alert)은 <main> 이 아니라 안쪽 묶음에 단다(main 의 랜드마크 역할을 덮지 않는다). 관리자 규칙대로 나타날 때
  // revealBanner 로 보이는 자리에 온다 — 휴대폰에서 내려 둔 채 오류가 나도 아래 탭 바 밑에 숨지 않는다(tests/admin-banner.test.ts §3).
  return (
    <main className={styles.page} aria-busy={copy ? undefined : true} data-testid="admin-error">
      {copy ? (
        <div className={styles.block} role="alert" ref={revealBanner}>
          <h1 className={styles.title}>{copy.title}</h1>
          <p className={styles.body}>{copy.body}</p>
          {error.digest ? <p className={styles.ref}>{copy.ref.replace("{digest}", error.digest)}</p> : null}
          <p className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => reset()}>
              {copy.retry}
            </button>
            <Link className={styles.secondary} href="/admin">
              {copy.home}
            </Link>
          </p>
        </div>
      ) : null}
    </main>
  );
}
