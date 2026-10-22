/**
 * 출발지·도착지 두 단 선택 (OF3-G) — 상태 없는 표시 컴포넌트. 'use client' 를 두지 않는다: 클라이언트 위젯(QuoteWidget)만 import 한다
 * (tests/home.test.ts 가 'use client' 파일을 네 개로 고정한다). — ① 시·도(+ 인천공항) ② 그 안의 시·군·구(선택 사항, 기본 "전체").
 *
 * 저장값은 한 칸(코드 하나): 시·군·구를 고르면 그 코드, "전체"면 시·도 코드(lib/codes.ts pickedCode). 대표 노선 도시(통영 등)를 고르면 옛 코드로 저장된다.
 * 읽을 때는 splitLocation 으로 두 칸에 나눠 보인다(41110 → 경기 · 수원시).
 * 하위가 없는 곳(세종 · 인천공항)과 영문 화면은 두 번째 칸이 없다 — 영문 화면은 시·도까지만 고른다(시·군·구 공식 영문 표기 자료가 없다 — lib/codes-sigungu.ts).
 * 이 파일에 한글 리터럴 없음 — 문구는 props(서버 Hero 가 카탈로그에서 읽는다).
 * 틀(.ctrl · .ctrlSelect)은 견적 위젯과 같은 Hero.module.css 를 쓴다.
 */
import type { Ref } from "react";

import { pickedCode, sigunguOptions, splitLocation } from "@/lib/codes";

import s from "./Hero.module.css";

export interface LocationGroup {
  label: string;
  options: { value: string; label: string }[];
}

export interface LocationSelectProps {
  /** 첫 칸 select 의 id — 바깥 `<label htmlFor>` 가 이 id 로 붙는다. */
  id: string;
  /** 칸 이름(출발지 · 도착지) — 두 번째 칸의 접근성 이름을 만든다. */
  fieldLabel: string;
  /** 저장된 코드 하나. */
  value: string;
  onChange: (code: string) => void;
  /** 첫 칸 선택지(시·도 묶음). */
  groups: LocationGroup[];
  locale: string;
  labels: { sigungu: string; all: string };
  invalid?: boolean;
  describedBy?: string;
  testId: string;
  selectRef?: Ref<HTMLSelectElement>;
}

export function LocationSelect({ id, fieldLabel, value, onChange, groups, locale, labels, invalid, describedBy, testId, selectRef }: LocationSelectProps) {
  const { region, sigungu } = splitLocation(value);
  const options = sigunguOptions(region, locale);

  return (
    <div className={s.locStack}>
      <div className={`${s.ctrl} ${s.ctrlSelect}`}>
        <select
          ref={selectRef}
          id={id}
          value={region}
          onChange={(e) => onChange(pickedCode(e.target.value, ""))}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          data-testid={testId}
        >
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {options.length > 0 ? (
        <div className={`${s.ctrl} ${s.ctrlSelect}`}>
          <select
            value={sigungu}
            onChange={(e) => onChange(pickedCode(region, e.target.value))}
            aria-label={`${fieldLabel} ${labels.sigungu}`}
            data-testid={`${testId}-sigungu`}
          >
            <option value="">{labels.all}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
