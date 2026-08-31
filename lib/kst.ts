/**
 * KST(Asia/Seoul) 벽시계 문자열 파싱 유틸.
 *
 * 배경: 위저드는 사용자가 고른 한국 현지 벽시계 값(예: "2026-09-01T08:00")을
 * 그대로 서버로 보낸다. 서버가 이를 UTC로 잘못 해석하면(Date 생성자에 그대로
 * 넘기는 등) KST와 UTC의 9시간 차이만큼 오류가 난다. 이 모듈은 그 해석을
 * 명시적으로, 서버 프로세스의 TZ 설정과 무관하게 고정된 로직으로 수행한다.
 *
 * 한국(KST)은 UTC+09:00 고정 오프셋이며 서머타임(DST)을 사용하지 않으므로,
 * 연중 어떤 날짜든 항상 "KST = UTC + 9시간"으로 계산해도 안전하다.
 */

const KST_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const KST_OFFSET_HOURS = 9;

interface ParsedKstComponents {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/** "YYYY-MM-DDTHH:mm" 형식만 허용(초·타임존 접미사 불가)하고 각 구성요소를 검증한다. */
function parseAndValidateComponents(local: string): ParsedKstComponents {
  const match = KST_LOCAL_PATTERN.exec(local);
  if (!match) {
    throw new Error(
      `Invalid KST local datetime string: "${local}" — expected "YYYY-MM-DDTHH:mm" (no seconds, no timezone suffix)`,
    );
  }

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if (hour > 23) {
    throw new Error(`Invalid KST local datetime string: "${local}" — hour out of range`);
  }
  if (minute > 59) {
    throw new Error(`Invalid KST local datetime string: "${local}" — minute out of range`);
  }

  // 달력상 실존하는 연-월-일인지 round-trip으로 검증한다(예: 2026-13-01, 2026-02-30 등을
  // Date.UTC가 다음 달/연으로 이월시키는 것을 잡아낸다). month는 1-12가 아니어도
  // 여기서 자연스럽게 걸러진다.
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new Error(`Invalid KST local datetime string: "${local}" — date does not exist`);
  }

  return { year, month, day, hour, minute };
}

/** KST 벽시계 문자열("YYYY-MM-DDTHH:mm")을 UTC Date로 해석한다. */
export function parseKst(local: string): Date {
  const { year, month, day, hour, minute } = parseAndValidateComponents(local);
  // Date.UTC(y, m-1, d, h-9, min): 서버 프로세스의 로컬 TZ 설정(process.env.TZ)과
  // 완전히 무관하게 고정 +09:00 오프셋을 적용해 UTC 인스턴트를 계산한다.
  return new Date(Date.UTC(year, month - 1, day, hour - KST_OFFSET_HOURS, minute));
}

/**
 * 출발~도착 사이의 숙박 수(밤 수)를 KST 달력 날짜 기준으로 계산한다.
 * 같은 KST 날짜면 0, 다음 KST 날짜면 1. 도착이 출발보다 앞서면 throw한다.
 */
export function nightsBetween(departLocal: string, returnLocal: string): number {
  const depart = parseKst(departLocal);
  const ret = parseKst(returnLocal);

  if (ret.getTime() < depart.getTime()) {
    throw new Error(
      `Invalid range: return ("${returnLocal}") precedes depart ("${departLocal}")`,
    );
  }

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const KST_OFFSET_MS = KST_OFFSET_HOURS * 60 * 60 * 1000;
  // UTC 인스턴트에 KST 오프셋을 다시 더해 "KST 달력상의 날짜"를 얻은 뒤,
  // 자정 기준 일수 차이를 구한다.
  const departKstDayIndex = Math.floor((depart.getTime() + KST_OFFSET_MS) / MS_PER_DAY);
  const returnKstDayIndex = Math.floor((ret.getTime() + KST_OFFSET_MS) / MS_PER_DAY);

  return returnKstDayIndex - departKstDayIndex;
}
