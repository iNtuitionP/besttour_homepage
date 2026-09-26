import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { ReservationActions } from "@/components/admin/ReservationActions";
import { CONTACT_METHODS, PAYMENT_METHODS } from "@/components/quote/options";
import { routing } from "@/i18n/routing";
import { getReservation, isUuid } from "@/lib/admin/reservations";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { PURPOSES, isLocationCode, locationLabelKo } from "@/lib/codes";
import { getVehicles } from "@/lib/queries";
import { TRIP_TYPES, kstWallClock } from "@/lib/reservation-check/view";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/reservations/[id] — 예약 상세 + 처리 (P5-3).
 *
 * 경로에는 uuid 만 들어간다(URL 에 개인정보 금지). 목록과 같은 이유로 여기서도 **무조건** requireAdmin() 을 다시 부르고
 * (리뷰 F1 — 조건부 게이트는 게이트가 아니다), 읽기는 세션 클라이언트 + 0009 RLS 다(서비스 롤 금지 — ADR-2). 캐시하지 않는다.
 *
 * 원문을 보여 준다(마스킹 없음) — 사장님이 전화를 걸고 문자를 확인해야 한다. 다만 **서버 컴포넌트 props 로 내리지 않는다**:
 * 값은 이 파일 안에서 그리고, 클라이언트(ReservationActions)로는 uuid·상태·라벨·메모만 내린다(P3-5 리뷰 N-2).
 *
 * 화면에 함께 보이는 것: `privacy_consent_at`(언제 동의했는지)과 `retention_until`(언제 파기되는지). 파기 배치(P1-5)가
 * 그 시각을 보고 지우므로, 사장님이 "이 예약 기록이 언제 사라지는지" 를 화면에서 알 수 있어야 한다.
 * `withdrawal_consent_at`(청약철회 제한 확인 — 0021 · P1-7)도 보여 준다: 취소·환불 분쟁 때 사장님이 증거를 찾을 수 있게.
 * 0021 적용 순간에 있던 접수는 `withdrawal_consent_legacy = true` 이고 값이 없다 — "기록 없음(동의 기록 도입 전 접수)" 으로 보여 준다
 * (빈 칸이 누락으로 읽히지 않게 · 날짜를 박지 않는다 — 경계는 날짜가 아니라 적용 순간이다, P1-7 R2). legacy 가 아니면서 값이 없는 행은
 * 0021 의 CHECK 가 만들지 못한다 — 만약 보이면 "—" 로 둔다(지어내지 않는다).
 *
 * 값 라벨(여행 구분·운행 구분·연락/결제 방법)은 **위저드가 쓰는 문구를 그대로 재사용한다**(quote.* · reservationCheck.*).
 * 같은 코드에 두 벌의 한국어를 두면 사장님이 보는 말과 고객이 고른 말이 갈라진다. 관리자 전용 문구만 admin.* 에 있다.
 *
 * 개발용 우회 경로는 없다(목록 화면 헤더 참조 — P5-3 독립 리뷰에서 제거).
 */
type Params = Promise<{ id: string }>;

const isPurpose = (c: string): boolean => (PURPOSES as readonly string[]).includes(c);
const isTripType = (c: string): boolean => (TRIP_TYPES as readonly string[]).includes(c);
const isContact = (c: string): boolean => (CONTACT_METHODS as readonly string[]).includes(c);
const isPayment = (c: string): boolean => (PAYMENT_METHODS as readonly string[]).includes(c);
const placeLabel = (code: string): string => (isLocationCode(code) ? locationLabelKo(code) : code);

/** jsonb 경유지 — 문자열 배열이 아니면 빈 목록으로 본다(표시 계층은 DB 모양을 신뢰하지 않는다). */
function waypointLabels(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").map(placeLabel) : [];
}

async function vehicleLabel(slug: string): Promise<string> {
  try {
    const vehicles = await getVehicles();
    return vehicles.find((v) => v.slug === slug)?.nameKo ?? slug;
  } catch {
    return slug;
  }
}

/**
 * 함수 시간 한도(P4-7 수정 라운드 3 · 리뷰 P2-3). 이 화면의 확정 버튼(서버액션)이 응답 뒤에 즉시 발송(lib/notify/inline.ts)을 돌린다 —
 * 한도가 즉시 발송 마감(40초)보다 짧으면 send 와 markSent 사이에서 잘려 행이 다시 집히고 **손님이 두 번 받는다.**
 * 60초 = Vercel 문서(2026-08-24 판)상 Hobby 가 Fluid compute 에서 받는 값(기본·최대 300초)이자 Fluid 가 아닌 Hobby 의 최대치(60초) —
 * 어느 설정이든 받아들여지는 가장 큰 공통값이다. tests/notify-inline.test.ts §7 이 잠근다.
 */
export const maxDuration = 60;

export default async function AdminReservationDetailPage({ params }: { params: Params }) {
  await requireAdmin();

  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.detail" });
  const tRoot = await getTranslations({ locale: routing.defaultLocale });
  const { id } = await params;

  // uuid 가 아닌 경로 값은 DB 를 부르지 않고 "찾을 수 없음" 으로 (getReservation 은 그런 값에 throw 한다).
  const row = isUuid(id) ? await getReservation(id) : null;
  const backHref = "/admin/reservations";

  if (row === null) {
    return (
      <main className={q.main} data-testid="admin-reservation-detail">
        <div className={q.wrap}>
          <Link className={a.backLink} href={backHref}>
            {t("back")}
          </Link>
          <p className={a.empty}>{t("notFound")}</p>
        </div>
      </main>
    );
  }

  const none = t("value.none");
  // 차량 라벨은 공개 표(vehicles)에서 — 없으면 slug 폴백(목록 화면 주석 참조).
  const vehicle = await vehicleLabel(row.vehicle_slug);
  const waypoints = waypointLabels(row.waypoint_codes);
  const boolLabel = (v: boolean | null): string => (v === null ? none : v ? t("value.included") : t("value.excluded"));

  return (
    <main className={q.main} data-testid="admin-reservation-detail">
      <div className={q.wrap}>
        <Link className={a.backLink} href={backHref}>
          {t("back")}
        </Link>

        <header className={q.pageHead}>
          <h1 className={q.title}>
            {t("title")} · {row.public_code}
          </h1>
          <p className={q.sub}>
            <span className={a.badge} data-status={row.status}>
              {tRoot(`admin.reservations.status.${row.status}`)}
            </span>
          </p>
        </header>

        <section className={a.section}>
          <h2 className={a.sectionTitle}>{t("sectionCustomer")}</h2>
          <dl className={a.dl}>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.name")}</dt>
              <dd className={a.dd}>{row.name}</dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.phone")}</dt>
              <dd className={a.dd}>
                <a className={a.telLink} href={`tel:${row.phone.replace(/[^0-9+]/g, "")}`}>
                  {row.phone}
                </a>
              </dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.email")}</dt>
              <dd className={a.dd}>{row.email ?? none}</dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.createdAt")}</dt>
              <dd className={a.dd}>{kstWallClock(row.created_at)}</dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.confirmedAt")}</dt>
              <dd className={a.dd}>{row.confirmed_at === null ? none : kstWallClock(row.confirmed_at)}</dd>
            </div>
          </dl>
        </section>

        <section className={a.section}>
          <h2 className={a.sectionTitle}>{t("sectionTrip")}</h2>
          <dl className={a.dl}>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.purpose")}</dt>
              <dd className={a.dd}>
                {isPurpose(row.purpose_code) ? tRoot(`quote.steps.purpose.options.${row.purpose_code}`) : row.purpose_code}
              </dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.vehicle")}</dt>
              <dd className={a.dd}>{vehicle}</dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.route")}</dt>
              <dd className={a.dd}>
                {tRoot("admin.reservations.routeValue", {
                  origin: placeLabel(row.origin_code),
                  destination: placeLabel(row.destination_code),
                })}
              </dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.waypoints")}</dt>
              <dd className={a.dd}>{waypoints.length === 0 ? none : waypoints.join(" · ")}</dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.tripType")}</dt>
              <dd className={a.dd}>
                {row.trip_type !== null && isTripType(row.trip_type)
                  ? tRoot(`reservationCheck.tripType.${row.trip_type}`)
                  : (row.trip_type ?? none)}
              </dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.departAt")}</dt>
              <dd className={a.dd}>{kstWallClock(row.depart_at)}</dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.returnAt")}</dt>
              <dd className={a.dd}>{row.return_at === null ? none : kstWallClock(row.return_at)}</dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.busCount")}</dt>
              <dd className={a.dd}>{tRoot("reservationCheck.card.busCountValue", { n: row.bus_count })}</dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.passengers")}</dt>
              <dd className={a.dd}>
                {row.passengers === null ? none : tRoot("reservationCheck.card.passengersValue", { n: row.passengers })}
              </dd>
            </div>
          </dl>
        </section>

        <section className={a.section}>
          <h2 className={a.sectionTitle}>{t("sectionOptions")}</h2>
          <dl className={a.dl}>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.contactMethod")}</dt>
              <dd className={a.dd}>
                {row.contact_method === null
                  ? none
                  : isContact(row.contact_method)
                    ? tRoot(`quote.steps.options.contact.${row.contact_method}`)
                    : row.contact_method}
              </dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.paymentMethod")}</dt>
              <dd className={a.dd}>
                {row.payment_method === null
                  ? none
                  : isPayment(row.payment_method)
                    ? tRoot(`quote.steps.options.payment.${row.payment_method}`)
                    : row.payment_method}
              </dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.parking")}</dt>
              <dd className={a.dd}>{boolLabel(row.parking_included)}</dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.vat")}</dt>
              <dd className={a.dd}>{boolLabel(row.vat_included)}</dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.message")}</dt>
              <dd className={a.dd}>{row.message ?? none}</dd>
            </div>
          </dl>
        </section>

        <section className={a.section}>
          <h2 className={a.sectionTitle}>{t("sectionConsent")}</h2>
          <dl className={a.dl}>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.privacyConsentAt")}</dt>
              <dd className={a.dd}>{kstWallClock(row.privacy_consent_at)}</dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.marketingConsentAt")}</dt>
              <dd className={a.dd}>
                {row.marketing_consent_at === null ? t("value.notConsented") : kstWallClock(row.marketing_consent_at)}
              </dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.withdrawalConsentAt")}</dt>
              <dd className={a.dd} data-testid="admin-withdrawal-consent">
                {row.withdrawal_consent_at !== null
                  ? kstWallClock(row.withdrawal_consent_at)
                  : row.withdrawal_consent_legacy
                    ? t("value.noWithdrawalRecord")
                    : none}
              </dd>
            </div>
            <div className={a.row}>
              <dt className={a.dt}>{t("field.retentionUntil")}</dt>
              <dd className={a.dd}>{kstWallClock(row.retention_until)}</dd>
            </div>
          </dl>
        </section>

        <section className={a.section}>
          <h2 className={a.sectionTitle}>{t("sectionAdmin")}</h2>
          <ReservationActions
            id={row.id}
            status={row.status}
            initialMemo={row.admin_memo ?? ""}
            labels={{
              confirm: t("confirm"),
              cancel: t("cancel"),
              complete: t("complete"),
              confirmHint: t("confirmHint"),
              memoLabel: t("memoLabel"),
              memoHint: t("memoHint"),
              memoSave: t("memoSave"),
              processing: t("processing"),
              results: {
                confirmed: t("result.confirmed"),
                cancelled: t("result.cancelled"),
                completed: t("result.completed"),
                memoUpdated: t("result.memoUpdated"),
                alreadyHandled: t("result.alreadyHandled"),
                failed: t("result.failed"),
              },
            }}
          />
        </section>
      </div>
    </main>
  );
}
