/**
 * 공지·팝업 본문 렌더 (T3-4 · 결정 7) — **React 요소만** 그린다. 서버·클라이언트 어디서나 쓸 수 있다(훅·상태 없음).
 *
 * 입력은 lib/content/richText.ts 의 제한 서식(마크다운 하위집합)이고, 이 컴포넌트는 그 구문 트리를 h2·h3·ul·li·p·strong·em·br 로만 옮긴다.
 * 글자는 언제나 React 의 텍스트 자식이라 이스케이프된다 — `<script>` 를 적어도 글자로 보인다. raw HTML 주입 prop·정화기 패키지를 쓰지 않는다.
 *
 * 본문 제목은 한 단계 내린다(제목1 → h2, 제목2 → h3) — 화면 제목(h1)과 겹치지 않게.
 */
import { Fragment, type ReactNode } from "react";

import { parseRichText, type RichInline } from "@/lib/content/richText";

function inline(nodes: RichInline[], keyBase: string): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyBase}-${i}`;
    if (n.type === "text") return <Fragment key={key}>{n.text}</Fragment>;
    if (n.type === "bold") return <strong key={key}>{inline(n.children, key)}</strong>;
    return <em key={key}>{inline(n.children, key)}</em>;
  });
}

export function RichText({
  text,
  className,
  lang,
  testId,
  headingBase = 2,
}: {
  text: string;
  className?: string;
  lang?: string;
  testId?: string;
  /** 제목1 이 될 단계 — 기본 h2(화면 제목 h1 아래). 제목이 이미 h2 인 팝업은 3 */
  headingBase?: 2 | 3;
}) {
  const blocks = parseRichText(text);
  const H1 = headingBase === 3 ? "h3" : "h2";
  const H2 = headingBase === 3 ? "h4" : "h3";
  return (
    <div className={className} lang={lang} data-testid={testId}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        if (b.type === "h1") return <H1 key={key}>{inline(b.children, key)}</H1>;
        if (b.type === "h2") return <H2 key={key}>{inline(b.children, key)}</H2>;
        if (b.type === "ul")
          return (
            <ul key={key}>
              {b.items.map((it, j) => (
                <li key={`${key}-${j}`}>{inline(it, `${key}-${j}`)}</li>
              ))}
            </ul>
          );
        return (
          <p key={key}>
            {b.lines.map((l, j) => (
              <Fragment key={`${key}-${j}`}>
                {j > 0 ? <br /> : null}
                {inline(l, `${key}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
