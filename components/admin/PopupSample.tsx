"use client";
/**
 * 저장된 팝업을 **방문자가 보는 그대로** 열어 보는 스위치 (P5-4).
 *
 * 안에 들어오는 children 은 서버가 이미 그린 `components/home/HomePopup` 이다 — 관리자 화면 전용 사본을 만들지 않는다.
 * 사본을 두면 홈이 바뀔 때마다 사장님이 보는 모양과 방문자가 보는 모양이 갈린다. 이 컴포넌트가 하는 일은
 * **언제 붙이고 뗄지** 정하는 것뿐이다: 홈 팝업은 화면 전체를 덮는 모달이라 편집 화면에 상시로 띄우면 폼을 가린다.
 *
 * 닫았다 다시 열면 새로 붙으므로 팝업의 등장 애니메이션까지 그대로 다시 볼 수 있다.
 * 주의(알려진 것): 모달 안의 "오늘 하루 보지 않기" 는 진짜다 — 그 브라우저의 저장소에 기록되어
 * 같은 날 홈에서도 같은 팝업이 뜨지 않는다. 사장님이 확인용으로 체크하지 않도록 note 문구로 알린다.
 *
 * 이름에 영어 단어를 쓰지 않은 이유: 관리자 네 디렉터리(app/admin·actions/admin·lib/admin·components/admin)에는
 * P5-3 에서 삭제된 개발용 우회 경로의 어근이 다시 들어오지 못하게 막는 검사가 걸려 있다(P5-3 독립 리뷰 F1 · §재-2 N).
 * 기능은 정당하지만 이름은 그 검사를 존중한다 — 규칙을 느슨하게 하는 대신 이름을 바꾼다.
 */
import { useState, type ReactNode } from "react";

import s from "./admin.module.css";

export function PopupSample({ children, labels }: { children: ReactNode; labels: { show: string; hide: string; note: string } }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={s.sample} data-testid="admin-popup-sample">
      <p className={s.hint}>{labels.note}</p>
      <button
        type="button"
        className={s.btnSecondary}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="admin-popup-sample-toggle"
      >
        {open ? labels.hide : labels.show}
      </button>
      {open ? children : null}
    </div>
  );
}
