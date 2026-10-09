/**
 * next-intl rich-text 태그 핸들러 — 홈 카피의 <ac>(브랜드 강조) · <b> · <em> 를 렌더한다.
 * 서버 컴포넌트에서 t.rich(key, RICH) 로 쓴다. 카피 자체는 messages/ko.json home.* 에 있다.
 */
import type { ReactNode } from "react";
import h from "./home.module.css";

export const RICH: Record<string, (chunks: ReactNode) => ReactNode> = {
  ac: (chunks) => <span className={h.ac}>{chunks}</span>,
  b: (chunks) => <b>{chunks}</b>,
  em: (chunks) => <em>{chunks}</em>,
};
