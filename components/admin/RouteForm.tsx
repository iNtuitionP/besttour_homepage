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
 *
 * 결과 알림(P5-20): 성공은 레이아웃의 토스트, 실패(중복·입력 확인·찾을 수 없음)는 저장 버튼 아래 배너(role=alert). 판정은 feedback.ts.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { updateRoute } from "@/actions/admin/route";
import { ROUTE_FIELDS, ROUTE_PRICE_MAX, groupPriceDigits, type RouteActionCode, type RouteField } from "@/lib/admin/routeInput";
import { formatPriceKrw } from "@/components/KrMap/format";

import s from "./admin.module.css";
import { AdminBanner } from "./AdminBanner";
import { useAdminToast } from "./AdminToast";
import { feedbackKind } from "./feedback";

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
  /** "홈 표시: {price}" — {price} 자리에 홈과 같은 포맷(formatPriceKrw)의 결과가 들어간다(T3-1) */
  priceOnHome: string;
  /** 칸이 비었을 때의 미리보기 — 홈은 금액 라벨을 감춘다 */
  priceOnHomeEmpty: string;
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
  const toast = useAdminToast();
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState("");
  const [invalid, setInvalid] = useState<Partial<Record<RouteField, true>>>({});
  // T3-1 — 금액 칸은 쉼표를 넣어 보여 주고, 아래에 홈 표시 모양을 미리 보인다(값을 만들지 않는다 — 표시 포맷뿐)
  const [price, setPrice] = useState(() => groupPriceDigits(initial.priceFrom));
  const priceDigits = price.replace(/,/g, "");
  const priceLabel = priceDigits === "" ? "" : formatPriceKrw(Number(priceDigits));

  const mark = (field: RouteField): "true" | undefined => (invalid[field] ? "true" : undefined);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setBanner("");
    setInvalid({});
    startTransition(async () => {
      const result = await updateRoute(formData);
      const kind = feedbackKind(result);
      if (kind === "toast") toast.show({ text: labels.results[result.code] });
      else if (kind === "banner") setBanner(labels.results[result.code]);
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
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={String(ROUTE_PRICE_MAX).length + 4}
          value={price}
          onChange={(e) => setPrice(groupPriceDigits(e.target.value))}
          disabled={pending}
          aria-describedby="route-price-hint route-price-home"
          aria-invalid={mark("priceFrom")}
        />
        <p className={s.priceOnHome} id="route-price-home" aria-live="polite" data-testid="admin-route-price-home">
          {priceLabel === "" ? labels.priceOnHomeEmpty : labels.priceOnHome.replace("{price}", priceLabel)}
        </p>
      </div>

      {/* T3-5 — 순서는 목록 화면의 «순서 바꾸기»에서만 바꾼다. 이 폼은 지금 순서를 그대로 돌려보낸다(덮어써서 뒤로 밀리지 않게) */}
      <input type="hidden" name={ROUTE_FIELDS.sort} value={initial.sort} readOnly />

      <div className={s.field}>
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
      </div>

      <div className={s.formActions}>
        <button type="submit" className={s.btnPrimary} disabled={pending} data-testid="admin-route-submit">
          {pending ? labels.processing : labels.submit}
        </button>
      </div>

      <AdminBanner text={banner} testId="admin-route-banner" />
    </form>
  );
}
