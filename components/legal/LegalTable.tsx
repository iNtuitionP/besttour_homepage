/**
 * 법정 표 두 형태. 둘 다 빈 값("")을 DOM 에 내지 않는다 — 원장의 미확정 필드는 "" 이고, 빈 <td> 는 게이트 위반이다.
 *
 *   - LegalTable: 열 표 (취소·환불 4단계처럼 모든 행이 같은 열을 가질 때). 빈 셀이 하나라도 있는 행은 통째로 뺀다 —
 *     열 표에서 셀만 빼면 열이 어긋나기 때문이다.
 *   - LegalRecordList: 레코드 표 (수탁자·국외 이전처럼 항목당 필드가 많고 일부가 미확정일 때). 항목마다 한 <table>,
 *     필드 = 한 행(라벨 th + 값 td). 빈 필드 행만 뺀다 — 수탁자 자체(이름·업무)는 법정 공개 항목이라 항목을 숨기지 않는다.
 *
 * 라벨·문구는 전부 props 로 받는다. 이 파일에는 한글 리터럴이 없다.
 */
import styles from "./legal.module.css";

type Cell = string | number;
type Row = Readonly<Record<string, Cell>>;

function isBlank(v: Cell | undefined): boolean {
  return v === undefined || (typeof v === "string" && v.trim() === "");
}

export function LegalTable<K extends string>({
  columns,
  rows,
  caption,
  testId,
}: {
  columns: ReadonlyArray<{ key: K; label: string }>;
  rows: ReadonlyArray<Readonly<Partial<Record<K, Cell>>>>;
  caption?: string;
  testId?: string;
}) {
  const kept = rows.filter((r) => columns.every((c) => !isBlank(r[c.key])));
  if (kept.length === 0) return null;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} data-testid={testId}>
        {caption ? <caption className={styles.recordCaption}>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {kept.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key}>{r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LegalRecordList<K extends string>({
  labels,
  records,
  titleKey,
  testId,
}: {
  /** 필드 순서 = 라벨 객체의 키 순서 */
  labels: Readonly<Record<K, string>>;
  records: ReadonlyArray<Readonly<Partial<Record<K, Cell>>>>;
  /** 이 필드 값을 표 제목(caption)으로 올리고 본문 행에서는 뺀다 */
  titleKey?: K;
  testId?: string;
}) {
  const keys = Object.keys(labels) as K[];
  return (
    <div data-testid={testId}>
      {records.map((rec, i) => {
        const fields = keys.filter((k) => k !== titleKey && !isBlank(rec[k]));
        if (fields.length === 0) return null;
        const title = titleKey !== undefined && !isBlank(rec[titleKey]) ? rec[titleKey] : undefined;
        return (
          <div className={styles.tableWrap} key={i}>
            <table className={`${styles.table} ${styles.record}`}>
              {title !== undefined ? <caption className={styles.recordCaption}>{title}</caption> : null}
              <tbody>
                {fields.map((k) => (
                  <tr key={k}>
                    <th scope="row">{labels[k]}</th>
                    <td>{rec[k]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
