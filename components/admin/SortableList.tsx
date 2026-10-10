"use client";
/**
 * 순서 바꾸기 목록 (T3-5 · 결정 10 · 사장님 요청 6.4) — 노선·차량·갤러리가 같이 쓸 수 있는 공용 부품(지금은 노선만 붙였다).
 *
 *   - @dnd-kit: 마우스·터치(휴대폰)·키보드(손잡이에 포커스 → Space 로 집기 → 화살표 → Space 로 놓기)로 끌어 옮긴다.
 *   - ↑/↓ 단추로도 한 칸씩 옮긴다(끌기가 어려운 손·화면 읽기 도구).
 *   - 옮길 때마다 aria-live 로 "○○을(를) N번째로 옮겼어요" 를 읽어 준다.
 *   - **저장은 «순서 저장» 단추 한 번** — 실수로 끌었으면 «처음 순서로» 로 되돌린다. 바뀐 것이 없으면 저장 단추가 잠긴다.
 *   - 문구는 전부 props(ko.json). HTML 을 그리지 않는다.
 */
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useId, useState } from "react";

import s from "./admin.module.css";

export interface SortableItem {
  id: number;
  label: string;
  /** 줄 오른쪽의 짧은 정보(금액·상태 등) */
  meta?: string;
}

export interface SortableListLabels {
  save: string;
  reset: string;
  processing: string;
  /** "{name}" 자리표시자 */
  up: string;
  down: string;
  handle: string;
  /** "{name}" · "{pos}" 자리표시자 */
  moved: string;
  /** "{name}" — 손잡이로 집었을 때 */
  picked: string;
  canceled: string;
  /** 손잡이에 포커스가 갔을 때 읽는 사용법 */
  instructions: string;
}

const fill = (tpl: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), tpl);

function Row({
  item,
  index,
  count,
  labels,
  disabled,
  move,
}: {
  item: SortableItem;
  index: number;
  count: number;
  labels: SortableListLabels;
  disabled: boolean;
  move: (index: number, delta: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled });
  const i = index;
  return (
    <li
      ref={setNodeRef}
      className={s.sortRow}
      data-dragging={isDragging ? "true" : undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid="admin-sort-row"
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className={s.sortHandle}
        aria-label={fill(labels.handle, { name: item.label })}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <span className={s.sortPos} aria-hidden="true">
        {i + 1}
      </span>
      <span className={s.sortLabel}>{item.label}</span>
      {item.meta ? <span className={s.sortMeta}>{item.meta}</span> : null}
      <span className={s.sortButtons}>
        <button type="button" className={s.sortMove} aria-label={fill(labels.up, { name: item.label })} disabled={disabled || i === 0} onClick={() => move(i, -1)}>
          ↑
        </button>
        <button type="button" className={s.sortMove} aria-label={fill(labels.down, { name: item.label })} disabled={disabled || i === count - 1} onClick={() => move(i, 1)}>
          ↓
        </button>
      </span>
    </li>
  );
}

export function SortableList({
  items: initial,
  labels,
  onSave,
  testId,
}: {
  items: readonly SortableItem[];
  labels: SortableListLabels;
  /** 저장 — 화면에 보인 순서대로의 id. 끝나면 true(성공) · false(실패) */
  onSave: (ids: number[]) => Promise<boolean>;
  testId?: string;
}) {
  const dndId = useId();
  const [items, setItems] = useState<SortableItem[]>(() => [...initial]);
  const [saving, setSaving] = useState(false);
  const [announce, setAnnounce] = useState("");
  const dirty = items.some((it, i) => it.id !== initial[i]?.id);
  const nameOf = (id: string | number) => items.find((it) => it.id === id)?.label ?? "";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const moved = (list: SortableItem[], to: number) => {
    setAnnounce(fill(labels.moved, { name: list[to].label, pos: to + 1 }));
  };

  const move = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= items.length) return;
    const next = arrayMove(items, index, to);
    setItems(next);
    moved(next, to);
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex((it) => it.id === e.active.id);
    const to = items.findIndex((it) => it.id === e.over?.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(items, from, to);
    setItems(next);
    moved(next, to);
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(items.map((it) => it.id));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={s.sortWrap} data-testid={testId}>
      <DndContext
        // 서버·브라우저가 같은 접근성 id 를 쓰게(dnd-kit 기본 카운터는 하이드레이션 불일치를 낸다)
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          // 기본 안내는 영어다 — 한국어로 바꾸고, 놓은 뒤의 자리는 아래 aria-live 가 읽는다
          screenReaderInstructions: { draggable: labels.instructions },
          announcements: {
            onDragStart: ({ active }) => fill(labels.picked, { name: nameOf(active.id) }),
            onDragOver: () => undefined,
            onDragEnd: () => undefined,
            onDragCancel: () => labels.canceled,
          },
        }}
      >
        <SortableContext items={items.map((it) => it.id)} strategy={verticalListSortingStrategy}>
          <ol className={s.sortList}>
            {items.map((item, i) => (
              <Row key={item.id} item={item} index={i} count={items.length} labels={labels} disabled={saving} move={move} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <p className={s.srOnly} aria-live="polite" data-testid="admin-sort-live">
        {announce}
      </p>
      <div className={s.sortActions}>
        <button type="button" className={s.btnPrimary} onClick={() => void save()} disabled={!dirty || saving} data-testid="admin-sort-save">
          {saving ? labels.processing : labels.save}
        </button>
        <button
          type="button"
          className={s.btnSecondary}
          onClick={() => {
            setItems([...initial]);
            setAnnounce("");
          }}
          disabled={!dirty || saving}
        >
          {labels.reset}
        </button>
      </div>
    </div>
  );
}
