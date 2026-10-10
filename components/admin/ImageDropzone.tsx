"use client";
/**
 * 공통 사진 고르기 부품 (T3-2, 사장님 요청 6 · 6.2 · 6.3 최소안) — 갤러리 업로더와 팝업 사진(T3-3)이 같이 쓴다.
 *
 *   - 끌어다 놓기 또는 «사진 고르기». 고른 사진은 **바로 올리지 않고** 미리보기 목록에 쌓는다 — 빼기 · 장별 설명을 받은 뒤 «올리기».
 *   - 창의 다른 곳에 떨어뜨려도 브라우저가 그 파일로 이동하지 않게 막는다(window dragover/drop preventDefault) — 쓰던 내용이 날아가지 않게.
 *   - 진짜 파일 칸은 그대로 있다(B-10): 보이지 않게 접었을 뿐 Tab 으로 포커스를 받고 Space·Enter 로 열린다. 이름은 버튼 모양 라벨.
 *   - 올리기 자체(준비·업로드·기록)는 하지 않는다 — `onUpload` 콜백이 맡는다. 파일 본문을 서버액션에 넘기지 않는 규칙(ADR-9)도 거기서 지킨다.
 *     준비 규칙은 lib/admin/imagePrepare.ts 한 곳에 있다.
 *   - 미리보기는 objectURL 이고, 목록에서 빠지거나 부품이 사라지면 되돌린다. HEIC 는 크롬이 그리지 못해 이름만 보인다.
 *   - HTML 을 그리지 않는다. 문구는 전부 props(ko.json).
 */
import { useEffect, useImperativeHandle, useRef, useState, type DragEvent, type Ref } from "react";

import s from "./admin.module.css";

export interface ImageDropzoneLabels {
  /** 버튼 모양 라벨 — "사진 고르기" */
  pick: string;
  pickNone: string;
  /** "{n}" 자리표시자 */
  pickCount: string;
  /** 놓는 자리 안내 */
  drop: string;
  /** 장별 설명 칸 이름(captionMax 가 있을 때만) */
  caption: string;
  remove: string;
  start: string;
}

export interface PickedImage {
  file: File;
  caption: string;
}

export interface ImageDropzoneHandle {
  /** 고른 목록과 파일 칸을 비운다 — 올리기 흐름이 끝났을 때 */
  clear(): void;
}

interface Staged {
  key: string;
  file: File;
  caption: string;
  url: string | null;
}

let seq = 0;

export function ImageDropzone({
  inputId,
  countId,
  accept,
  multiple,
  captionMax,
  disabled,
  labels,
  onUpload,
  handleRef,
  testId,
}: {
  inputId: string;
  countId: string;
  accept: string;
  multiple: boolean;
  /** 장별 설명 칸의 길이 상한 — null 이면 설명 칸이 없다 */
  captionMax: number | null;
  disabled: boolean;
  labels: ImageDropzoneLabels;
  onUpload: (picked: PickedImage[]) => Promise<void> | void;
  handleRef?: Ref<ImageDropzoneHandle>;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [over, setOver] = useState(false);
  const urls = useRef(new Set<string>());

  const revoke = (url: string | null) => {
    if (url === null) return;
    URL.revokeObjectURL(url);
    urls.current.delete(url);
  };

  const clear = () => {
    setStaged((prev) => {
      for (const it of prev) revoke(it.url);
      return [];
    });
    if (inputRef.current) inputRef.current.value = "";
  };

  useImperativeHandle(handleRef, () => ({ clear }));

  // 창 밖(놓는 자리 밖)에 떨어뜨려도 브라우저가 파일을 열며 페이지를 떠나지 않게 막는다
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    const owned = urls.current;
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
      for (const url of owned) URL.revokeObjectURL(url);
      owned.clear();
    };
  }, []);

  const add = (list: FileList | File[] | null) => {
    if (!list || disabled) return;
    const files = Array.from(list);
    if (files.length === 0) return;
    const next = (multiple ? files : files.slice(0, 1)).map((file) => {
      let url: string | null = null;
      try {
        url = URL.createObjectURL(file);
        urls.current.add(url);
      } catch {
        url = null;
      }
      seq += 1;
      return { key: `p${seq}`, file, caption: "", url };
    });
    setStaged((prev) => {
      if (multiple) return [...prev, ...next];
      for (const it of prev) revoke(it.url);
      return next;
    });
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeOne = (key: string) => {
    setStaged((prev) => {
      const gone = prev.find((it) => it.key === key);
      if (gone) revoke(gone.url);
      return prev.filter((it) => it.key !== key);
    });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    add(e.dataTransfer?.files ?? null);
  };

  const start = async () => {
    if (staged.length === 0 || disabled) return;
    await onUpload(staged.map((it) => ({ file: it.file, caption: it.caption })));
  };

  return (
    <div className={s.dropzoneWrap} data-testid={testId}>
      <div
        className={s.dropzone}
        data-over={over ? "true" : undefined}
        data-disabled={disabled ? "true" : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <p className={s.dropzoneText}>{labels.drop}</p>
        <div className={s.field}>
          <input
            ref={inputRef}
            id={inputId}
            className={s.fileInput}
            type="file"
            multiple={multiple}
            accept={accept}
            disabled={disabled}
            aria-describedby={countId}
            onKeyDown={(e) => {
              // 버튼 모양이라 Enter 로도 연다 — 브라우저의 파일 칸은 Space 로만 열린다(크롬 실측)
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.click();
              }
            }}
            onChange={(e) => add(e.target.files)}
          />
          <div className={s.pickRow}>
            <label className={`${s.btnSecondary} ${s.pickButton}`} htmlFor={inputId} data-disabled={disabled ? "true" : undefined}>
              {labels.pick}
            </label>
            <span className={s.pickCount} id={countId} data-testid={`${inputId}-count`}>
              {staged.length === 0 ? labels.pickNone : labels.pickCount.replace("{n}", String(staged.length))}
            </span>
          </div>
        </div>
      </div>

      {staged.length > 0 ? (
        <>
          <ul className={s.stageList} data-testid={`${inputId}-staged`}>
            {staged.map((it, i) => (
              <li key={it.key} className={s.stageItem}>
                <div className={s.stageThumb}>
                  {it.url !== null ? (
                    // objectURL 미리보기 — next/image 최적화 대상이 아니다(브라우저 메모리의 파일)
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.url} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                  ) : null}
                </div>
                <div className={s.stageBody}>
                  <span className={s.uploadName}>{it.file.name}</span>
                  {captionMax !== null ? (
                    <>
                      <label className={s.label} htmlFor={`${inputId}-caption-${it.key}`}>
                        {labels.caption}
                      </label>
                      <input
                        id={`${inputId}-caption-${it.key}`}
                        className={s.input}
                        type="text"
                        maxLength={captionMax}
                        value={it.caption}
                        disabled={disabled}
                        onChange={(e) => {
                          const v = e.target.value;
                          setStaged((prev) => prev.map((p) => (p.key === it.key ? { ...p, caption: v } : p)));
                        }}
                        data-index={i}
                      />
                    </>
                  ) : null}
                </div>
                <button type="button" className={s.btnSecondary} onClick={() => removeOne(it.key)} disabled={disabled}>
                  {labels.remove}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className={s.btnPrimary} onClick={() => void start()} disabled={disabled} data-testid={`${inputId}-start`}>
            {labels.start}
          </button>
        </>
      ) : null}
    </div>
  );
}
