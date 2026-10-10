/**
 * 섹션 헤드 — [eyebrow +] 제목(aria-labelledby 대상) [+ 설명] (목업 variant-08 .sec-head/.sec-head--split).
 * 문구는 props 로만 받는다. 이 파일에 한글 리터럴 없음.
 * eyebrow 는 선택이다(사장님 요청 5 · 2026-10-10 — /about 사업자 정보 구역의 '운영사' 소제목을 걷었다). 넘기지 않거나 빈 값이면
 * 빈 <p> 를 남기지 않는다(PageHeader 와 같은 규칙). 넘기는 화면은 예전과 같다.
 */
import type { ReactNode } from "react";
import h from "./home.module.css";

export function SectionHead({
  id,
  eyebrow,
  title,
  desc,
  split = true,
}: {
  id: string;
  eyebrow?: string;
  title: ReactNode;
  desc?: ReactNode;
  split?: boolean;
}) {
  return (
    <div className={split ? `${h.head} ${h.headSplit}` : h.head}>
      <div>
        {eyebrow ? <p className={h.eyebrow}>{eyebrow}</p> : null}
        <h2 className={h.title} id={id}>
          {title}
        </h2>
      </div>
      {desc ? <p className={h.desc}>{desc}</p> : null}
    </div>
  );
}
