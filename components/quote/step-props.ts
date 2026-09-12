/**
 * 단계 컴포넌트 공통 props (P3-4). 단계 컴포넌트는 상태를 소유하지 않는다 — QuoteWizard 의 리듀서 상태·dispatch 를 받아 그린다.
 */
import type { Dispatch, RefObject } from "react";

import type { WizardAction, WizardState } from "./wizard-state";

/** 서버 페이지가 getVehicles() 결과에서 화면에 필요한 세 필드만 골라 내린다. */
export interface WizardVehicle {
  slug: string;
  nameKo: string;
  capacity: number;
}

export interface StepProps {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  /** 현재 단계인가 — 아니면 section 이 hidden 이다(입력은 DOM 에 남아 폼과 함께 제출된다). */
  active: boolean;
  /** 단계 전환 시 포커스를 받는 제목. active 인 단계만 ref 를 붙인다. */
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** FormData 키 → 현재 표시할 오류 문구(없으면 undefined). 서버 fieldErrors 와 클라이언트 검증을 같은 통로로 받는다. */
  errorFor: (field: string) => string | undefined;
  /** useId() 접두 — label/for·aria-describedby 연결용. */
  idPrefix: string;
}
