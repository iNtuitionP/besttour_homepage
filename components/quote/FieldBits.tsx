/**
 * 폼 공용 조각 — 오류 문구 한 줄 (P3-4 · P3-8). 클라이언트 트리(간편 견적 모달·동의 블록)에서만 쓰인다.
 * 한글 리터럴 없음 — 문구는 호출자가 messages 에서 풀어 넘긴다.
 * (옛 위저드의 단계 셸·필수/선택 배지는 위저드와 함께 지웠다 — P3-8.)
 */
import s from "./quote.module.css";

/** 필드 아래 오류 한 줄. message 가 없으면 아무것도 그리지 않는다(빈 요소를 남기지 않는다). */
export function ErrorText({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p className={s.err} id={id} data-testid={`quote-error-${id}`}>
      {message}
    </p>
  );
}
