/**
 * 메타 줄 조각 — 줄은 **조각 사이에서만** 꺾이고, 구분점은 **같은 줄의 두 조각 사이에만** 보인다
 * (P5-23 라운드 2 C-14 → 라운드 3 컨트롤러 1).
 *
 * 라운드 2 는 가운데점을 다음 조각의 머리에 붙여 줄 끝의 '·' 를 없앴지만, 그 대신 줄 **머리**에 '·' 가 섰다("…1대 / · 30명").
 * 라운드 3 — 줄 머리에서 잘려 나가는 구분점(clipped leading separator):
 *   - 조각마다 앞에 '·' 가 있다(CSS `.seg::before` — 조각 왼쪽 바깥, 음수 여백으로 조각 사이 틈에 걸린다).
 *   - 조각들을 담은 안쪽 상자(`.segsIn`)는 그 틈만큼 왼쪽으로 당겨져 있고, 바깥 상자(`.segs`)가 왼쪽 가장자리를 잘라 낸다(`overflow-x: clip`).
 *   - 그래서 **줄을 시작하는 조각의 '·' 는 잘린 자리에 떨어져 보이지 않고**, 같은 줄에서 앞 조각을 뒤따르는 조각의 '·' 만 두 조각 사이에 보인다.
 *     줄 끝에는 구분점이 올 수 없다(구분점은 늘 자기 조각의 앞에 붙어 있다).
 * 조각은 한 덩어리(inline-block)로 움직인다 — 한 줄보다 길 때만 그 안에서 낱말 단위로 꺾인다(max-width).
 * 조각 사이의 빈칸은 줄바꿈 자리다(관리자 셸의 `word-break: keep-all` 에서도 확실한 자리 — 빈칸 없이 붙은 inline-block 사이는 브라우저마다 다르다).
 *
 * 구분점은 CSS 가 그리는 장식이라 **DOM 글자에 없고 읽히지 않는다**(`content: "·" / ""` — 대체 글이 빈 글자). 화면 읽기는 조각을 차례로 읽는다.
 *
 * **부품이 아니라 함수다** — 이름 같은 개인정보가 조각으로 들어와도 어떤 부품의 props 에도 실리지 않는다(reservationRow.tsx 와 같은 이유).
 * 한글 없음 · 서버·클라이언트 어디서나 쓸 수 있다.
 */
import { Fragment, type ReactNode } from "react";

import s from "./admin.module.css";

const NBSP = " ";

/**
 * 마지막 낱말을 바로 앞 낱말에 붙인다(줄바꿈 없는 빈칸) — 좁은 칸에서 "35인승 관광버스 / 1대" 처럼 단위 하나만 다음 줄로 떨어지지 않게(C-14).
 * 빈칸이 없으면 그대로. 글자는 같다(빈칸 하나가 줄바꿈 없는 빈칸이 될 뿐).
 */
export function keepLastWord(text: string): string {
  const at = text.lastIndexOf(" ");
  return at <= 0 ? text : `${text.slice(0, at)}${NBSP}${text.slice(at + 1)}`;
}

/** 한 줄 문장을 " · " 로 나눈 조각 — 카탈로그 문장("노출 중 {n}건 · 마지막 게시일 {date}")을 조각으로 그릴 때. */
export function splitSegments(text: string): string[] {
  return text.split(" · ").filter((p) => p !== "");
}

/**
 * 문장 조각 — 문장 하나가 한 덩어리로 움직인다(C-15). 두 문장짜리 안내의 짧은 끝 문장("전화로 알려 주세요.")이 "…알려 / 주세요." 로
 * 마지막 낱말만 떨어지지 않는다. 글자는 그대로(문장 사이 빈칸 하나). 문장이 한 줄보다 길면 그 안에서 낱말 단위로 꺾인다. 구분점 없음.
 */
export function sentences(text: string): ReactNode[] {
  const parts = text.split(/(?<=[.!?])\s+/).filter((p) => p !== "");
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 ? " " : null}
      <span className={s.unit}>{part}</span>
    </Fragment>
  ));
}

/**
 * 줄표 덧말 — "사장님 알림 실패 1건 — 발송 기록에서 확인" 을 줄표 앞뒤 두 덩어리로(문장 조각과 같은 상자 · 구분점 없음 · 라운드 3).
 * 줄표는 앞 덩어리 끝에 줄바꿈 없는 빈칸으로 붙어 줄 머리에 서지 않고, 뒤 덩어리는 "발송 / 기록에서" 처럼 갈라지지 않는다.
 * 글자는 그대로(줄표 앞 빈칸이 줄바꿈 없는 빈칸이 될 뿐).
 */
export function dashUnits(text: string): ReactNode[] {
  const parts = text.split(" — ").filter((p) => p !== "");
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 ? " " : null}
      <span className={s.unit}>{i < parts.length - 1 ? `${part}${NBSP}—` : part}</span>
    </Fragment>
  ));
}

/**
 * 한 조각 안에서 붙어 다니는 부분들 — "35인승 관광버스 1대 · 30명" · "09:00 · 3일 뒤" · "왕복 · 1박 2일" (라운드 3).
 * 구분점 양쪽이 줄바꿈 없는 빈칸이라 줄은 그 자리에서 꺾이지 않는다 — '·' 가 줄 머리·끝에 서지 않고, 뒤 부분(인원)만 다음 줄로 떨어지지 않는다.
 * 구분점 글자는 읽히지 않는다(aria-hidden) — 화면 읽기는 두 빈칸 사이를 띄어 읽는다. 빈 부분은 건너뛴다.
 */
export function glued(parts: readonly ReactNode[]): ReactNode[] {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== "");
  return shown.map((part, i) => (
    <Fragment key={i}>
      {i > 0 ? (
        <span className={s.glue}>
          {NBSP}
          <span aria-hidden="true">·</span>
          {NBSP}
        </span>
      ) : null}
      {part}
    </Fragment>
  ));
}

/**
 * 조각 줄 — 바깥 상자(잘라 내는 가장자리) · 안쪽 상자(틈만큼 왼쪽으로) · 조각들. 빈 조각(null · 빈 글자 · false)은 건너뛴다.
 * 블록 상자다(문단 · 표 칸 · 카드 줄 한 줄을 통째로 차지한다) — 글줄 안에 끼우는 짧은 덧말은 이것 대신 glued() 로 쓴다.
 * 늘 같이 읽히는 둘(차량 · 인원)은 glued() 로 묶어 한 조각으로 넘긴다 — 좁으면 둘이 함께 다음 줄로 간다.
 */
export function segments(parts: readonly ReactNode[]): ReactNode {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== "");
  return (
    <span className={s.segs}>
      <span className={s.segsIn}>
        {shown.map((part, i) => (
          <Fragment key={i}>
            {i > 0 ? " " : null}
            <span className={s.seg}>{part}</span>
          </Fragment>
        ))}
      </span>
    </span>
  );
}
