"use client";
/**
 * 대표 노선 수정 폼 (P5-6). **수정만 있다** — 등록 모드도, 삭제 버튼도 없다.
 * 16개는 스펙 §13.2 가 고정하고 0002 가 지도 핀과 FK 로 묶은 집합이라, 이 화면이 할 수 있는 일은 값을 고치는 것뿐이다
 * (근거는 lib/admin/routes.ts 헤더).
 *
 * **가격 칸에는 사장님이 숫자를 직접 넣는다.** 이 컴포넌트는 그 값을 계산하거나 채워 주지 않는다(CLAUDE.md §3).
 * 비워 두면 "값 없음"이고 홈은 그 노선의 금액 라벨만 감춘 채 노선·핀을 그린다 — 그 뜻은 labels.hint.priceFrom 이 말해 준다.
 *
 * 저장되는 것은 언제나 **코드**다(CLAUDE.md §3). 선택지의 한글 라벨은 서버가 lib/codes.ts 카탈로그에서 풀어 내려 준다.
 * 문구는 전부 props(messages/ko.json `admin.routes.*`), 필드 이름은 lib/admin/routeInput.ts 의 단일 상수에서 온다.
 * 검증은 서버가 한다 — 이 컴포넌트를 거치지 않고 액션을 직접 부를 수 있기 때문이다(ADR-3).
 */
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { updateRoute } from "@/actions/admin/route";
import { ROUTE_FIELDS, ROUTE_PRICE_MAX, ROUTE_SORT_MAX, type RouteActionCode, type RouteField } from "@/lib/admin/routeInput";

import s from "./admin.module.css";

export interface RouteFormValues {
  originCode: string;
  destinationCode: string;
  /** 문자열로 다룬다 — 빈 문자열이 "값 없음"이고, 폼은 숫자를 만들지 않는다. */
  priceFrom: string;
  sort: string;
  active: boolean;
}

export interface RoutePlaceOption {
  code: string;
  label: string;
}

export interface RouteFormLabels {
  field: Record<"originCode" | "destinationCode" | "priceFrom" | "sort" | "active", string>;
  hint: Record<"originCode" | "destinationCode" | "priceFrom" | "sort" | "active", string>;
  submit: string;
  processing: string;
  results: Record<RouteActionCode, string>;
}

export function RouteForm({
  id,
  initial,
  places,
  labels,
}: {
  id: number;
  initial: RouteFormValues;
  places: readonly RoutePlaceOption[];
  labels: RouteFormLabels;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [invalid, setInvalid] = useState<Partial<Record<RouteField, true>>>({});

  const mark = (field: RouteField): "true" | undefined => (invalid[field] ? "true" : undefined);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setNotice("");
    setInvalid({});
    startTransition(async () => {
      const result = await updateRoute(formData);
      setNotice(labels.results[result.code]);
      setInvalid(result.fieldErrors ?? {});
      if (!result.changed) return;
      router.refresh();
    });
  };

  return (
    <form className={s.popupForm} onSubmit={onSubmit} data-testid="admin-route-form">
      <input type="hidden" name={ROUTE_FIELDS.id} value={id} readOnly />

      <div className={s.dateRow}>
        <div className={s.dateCol}>
          <label className={s.label} htmlFor="route-origin">
            {labels.field.originCode}
          </label>
          <p className={s.hint} id="route-origin-hint">
            {labels.hint.originCode}
          </p>
          <select
            id="route-origin"
            className={s.input}
            name={ROUTE_FIELDS.originCode}
            defaultValue={initial.originCode}
            disabled={pending}
            aria-describedby="route-origin-hint"
            aria-invalid={mark("originCode")}
          >
            {places.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className={s.dateCol}>
          <label className={s.label} htmlFor="route-destination">
            {labels.field.destinationCode}
          </label>
          <p className={s.hint} id="route-destination-hint">
            {labels.hint.destinationCode}
          </p>
          <select
            id="route-destination"
            className={s.input}
            name={ROUTE_FIELDS.destinationCode}
            defaultValue={initial.destinationCode}
            disabled={pending}
            aria-describedby="route-destination-hint"
            aria-invalid={mark("destinationCode")}
          >
            {places.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="route-price">
          {labels.field.priceFrom}
        </label>
        <p className={s.hint} id="route-price-hint">
          {labels.hint.priceFrom}
        </p>
        <input
          id="route-price"
          className={s.input}
          name={ROUTE_FIELDS.priceFrom}
          type="number"
          inputMode="numeric"
          min={1}
          max={ROUTE_PRICE_MAX}
          step={1}
          defaultValue={initial.priceFrom}
          disabled={pending}
          aria-describedby="route-price-hint"
          aria-invalid={mark("priceFrom")}
        />
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="route-sort">
          {labels.field.sort}
        </label>
        <p className={s.hint} id="route-sort-hint">
          {labels.hint.sort}
        </p>
        <input
          id="route-sort"
          className={s.input}
          name={ROUTE_FIELDS.sort}
          type="number"
          inputMode="numeric"
          min={0}
          max={ROUTE_SORT_MAX}
          step={1}
          defaultValue={initial.sort}
          disabled={pending}
          aria-describedby="route-sort-hint"
          aria-invalid={mark("sort")}
        />
      </div>

      <div className={s.checkRow}>
        <input
          id="route-active"
          name={ROUTE_FIELDS.active}
          type="checkbox"
          defaultChecked={initial.active}
          disabled={pending}
          aria-describedby="route-active-hint"
        />
        <label className={s.label} htmlFor="route-active">
          {labels.field.active}
        </label>
      </div>
      <p className={s.hint} id="route-active-hint">
        {labels.hint.active}
      </p>

      <div className={s.formActions}>
        <button type="submit" className={s.btnPrimary} disabled={pending} data-testid="admin-route-submit">
          {pending ? labels.processing : labels.submit}
        </button>
      </div>

      <p className={s.notice} role="status" data-testid="admin-route-notice">
        {notice}
      </p>
    </form>
  );
}
