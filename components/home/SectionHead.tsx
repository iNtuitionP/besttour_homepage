/**
 * 섹션 헤드 — eyebrow + 제목(aria-labelledby 대상) [+ 설명] (목업 variant-08 .sec-head/.sec-head--split).
 * 문구는 props 로만 받는다. 이 파일에 한글 리터럴 없음.
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
  eyebrow: string;
  title: ReactNode;
  desc?: ReactNode;
  split?: boolean;
}) {
  return (
    <div className={split ? `${h.head} ${h.headSplit}` : h.head}>
      <div>
        <p className={h.eyebrow}>{eyebrow}</p>
        <h2 className={h.title} id={id}>
          {title}
        </h2>
      </div>
      {desc ? <p className={h.desc}>{desc}</p> : null}
    </div>
  );
}
