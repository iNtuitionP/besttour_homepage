/**
 * 서버 전용 — 로케일의 공개 날짜 틀(카탈로그 common.dates)을 next-intl 요청 설정 없이 읽는다 (P7-4).
 *
 * 법정 페이지 3쪽(/privacy · /terms · /guide)은 문구를 원장에서만 가져오고 getTranslations 를 쓰지 않는다(tests/legal-pages.test.ts).
 * 시행일의 **보이는 형식**(ko "2026년 9월 21일" · en "Sep 21, 2026")은 법정 문구가 아니라 표시 틀이라, 로케일 레이아웃의 generateMetadata 와
 * 같은 순수 함수(i18n/messages.ts loadMessages)로 틀만 읽는다.
 *
 * 클라이언트에서 import 하지 않는다 — 두 카탈로그 전체가 번들로 딸려 간다. 클라이언트는 useTranslations("common").raw("dates") 를 쓴다.
 */
import { loadMessages } from "@/i18n/messages";
import { publicDateLabels, type PublicDateLabels } from "@/lib/public-date";

export function publicDateLabelsFor(locale: string): PublicDateLabels {
  return publicDateLabels((loadMessages(locale).common as { dates?: unknown } | undefined)?.dates);
}
