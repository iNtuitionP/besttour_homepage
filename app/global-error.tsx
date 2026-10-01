"use client";

/**
 * 앱 전체 오류 경계 (P7-4 · 브리프 §8) — 루트 레이아웃 자체(또는 로케일 레이아웃)가 던졌거나, 자기 error.tsx 가 없는 구역
 * (법정 문서 3쪽 등)에서 던졌을 때 Next 가 루트 레이아웃 **대신** 그린다. 그래서 자체 <html>·<body> 를 만든다(Next 규약).
 * 예전에는 이 파일이 없어 Next 기본 화면(영문 "Application error")이 나갔다.
 *
 *   - 로케일을 알 수 없는 자리라 한국어 기본(<html lang="ko">) + 예약·상담 전화. 문구는 카탈로그 errors.* — 공개 (site)/error.tsx 와 같은 말이다.
 *   - 문구·전화는 lib/i18n/error-copy.ts 를 **지연 로드**한다: 이 컴포넌트는 모든 페이지의 첫 JS 에 실리므로(RSC 페이로드 G 칸)
 *     카탈로그를 정적으로 붙이면 오류가 없을 때도 매 페이지가 무거워진다. 받기 전 잠깐은 빈 본문(aria-busy)이다.
 *   - 에러 원문(message·stack)은 화면에 내지 않는다 — digest 만 참조 번호로(서버 로그 대조용, (site)/error.tsx 와 같은 규칙).
 *   - 공급자·i18n Link 를 쓸 수 없다(루트 레이아웃 밖) — 홈은 <a href="/">, 전체 이동이 맞다.
 * 루트 레이아웃이 싣는 전역 CSS(글꼴·토큰)를 여기서도 싣는다 — 이 화면은 루트 레이아웃 없이 그려질 수 있다. 이 파일에 한글 리터럴 없음.
 */
import "../styles/pretendard.css";
import "../styles/tokens.css";
import "../styles/semantic.css";
import "./globals.css";

import { useEffect, useState } from "react";

import styles from "./errors.module.css";

type Copy = (typeof import("@/lib/i18n/error-copy"))["GLOBAL_ERROR_COPY"];

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [copy, setCopy] = useState<Copy | null>(null);

  useEffect(() => {
    let alive = true;
    import("@/lib/i18n/error-copy")
      .then((m) => {
        if (alive) setCopy(m.GLOBAL_ERROR_COPY);
      })
      .catch(() => {
        // 문구 조각을 받지 못하면 빈 본문으로 남는다 — 새로고침이 유일한 길이다(네트워크가 끊긴 경우)
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <html lang="ko">
      <body>
        <main className={`${styles.page} ${styles.root}`} aria-busy={copy ? undefined : true} data-testid="global-error">
          {copy ? (
            <div className={styles.block} role="alert">
              <h1 className={styles.title}>{copy.title}</h1>
              <p className={styles.body}>{copy.body}</p>
              {error.digest ? <p className={styles.ref}>{copy.ref.replace("{digest}", error.digest)}</p> : null}
              <p className={styles.actions}>
                <button type="button" className={styles.primary} onClick={() => reset()}>
                  {copy.retry}
                </button>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 루트 레이아웃 밖 오류 화면: 홈은 전체 이동이 맞다 */}
                <a className={styles.secondary} href="/">
                  {copy.home}
                </a>
                <a className={styles.secondary} href={copy.tel.href} aria-label={`${copy.telLabel} ${copy.tel.display}`}>
                  {copy.tel.display}
                </a>
              </p>
            </div>
          ) : null}
        </main>
      </body>
    </html>
  );
}
