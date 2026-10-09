/**
 * 공지 본문(plain text) → 문단 배열 (순수, P6-3 /notices/[id]).
 *
 * 빈 줄(\n\n 이상)로만 문단을 나눈다 — HTML 은 해석하지도 벗기지도 않는다(admin 입력 → XSS. React 의 raw-HTML 주입 prop 금지).
 * React 가 문자열을 이스케이프해 렌더하므로 태그가 들어 있어도 글자로 보일 뿐이다.
 * 한 줄 바꿈은 문단 안에 남긴다 — 표시 계층이 white-space: pre-line 으로 줄을 바꾼다.
 */
export function splitParagraphs(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
