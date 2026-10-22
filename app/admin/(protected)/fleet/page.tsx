import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { VehicleOrder, VehicleToggle } from "@/components/admin/VehicleControls";
import { resolveImageUrl } from "@/components/home/image-url";
import { routing } from "@/i18n/routing";
import { ADMIN_FLEET_PATH, listAdminVehicles } from "@/lib/admin/vehicles";
import { requireAdmin } from "@/lib/auth/requireAdmin";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/fleet — 차량 소개 목록 (OWNER-FEEDBACK T4-1 · 결정 11).
 *
 * (protected) 그룹 안이지만 **본문 첫 문장으로** requireAdmin() 을 다시 부른다(scripts/check-admin-gate).
 * 목록에서 할 수 있는 것: 새 차량 추가 · 고치기로 들어가기 · 숨기기/다시 보이기 · 순서 바꾸기(0024 원자적 저장).
 * 순서는 공개 화면(홈 차량 섹션 · /fleet)과 같다. 숨긴 차량도 보인다(되살릴 수 있어야 한다).
 * OF3-R2: **목록은 하나다** — 예전의 표 + 아래 «순서 바꾸기» 목록을 공용 SortableList 한 줄(손잡이·↑↓·이름·정원·상태·[고치기]·[숨기기])로 합쳤다.
 * 순서가 바뀌어 저장 전인 동안은 목록 위 막대가 나타나고 줄 끝 단추는 잠긴다.
 */
const THUMB_W = 96;
const THUMB_H = 64;

export default async function AdminFleetPage() {
  await requireAdmin();

  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.fleet" });
  const rows = await listAdminVehicles();

  const results = {
    created: t("result.created"),
    updated: t("result.updated"),
    deleted: t("result.deleted"),
    activated: t("result.activated"),
    deactivated: t("result.deactivated"),
    reordered: t("result.reordered"),
    notFound: t("result.notFound"),
    locked: t("result.locked"),
    referenced: t("result.referenced"),
    validation: t("result.validation"),
    failed: t("result.failed"),
    copyWarning: t("result.copyWarning"),
  };

  return (
    <main className={q.main} data-testid="admin-fleet">
      <div className={a.pageWrap}>
        <header className={q.pageHead}>
          <h1 className={q.title}>{t("title")}</h1>
          <p className={q.sub}>{t("sub")}</p>
        </header>

        <section className={a.section}>
          <Link className={`${a.btnPrimary} ${a.btnLink}`} href={`${ADMIN_FLEET_PATH}/new`} data-testid="admin-fleet-new">
            {t("new")}
          </Link>
        </section>

        <section className={a.section} aria-labelledby="fleet-list-title" data-testid="admin-fleet-list">
          <h2 className={a.sectionTitle} id="fleet-list-title">
            {t("listLabel")}
          </h2>
          {rows.length === 0 ? (
            <p className={a.empty}>{t("empty")}</p>
          ) : (
            <>
              {/* 항목이 하나뿐이면 순서 안내도 줄의 손잡이·↑↓ 도 없다(SortableList 가 count ≤ 1 이면 그리지 않는다) */}
              {rows.length > 1 ? <p className={a.hint}>{t("order.hint")}</p> : null}
              {/* OF3-R2 — 목록은 하나다. 줄 하나 = 손잡이·↑↓·차량 이름(사진)·정원·상태·[고치기]·[숨기기/다시 보이기] */}
              <VehicleOrder
                items={rows.map((row) => {
                  const url = resolveImageUrl(row.image_path);
                  return {
                    id: row.id,
                    label: row.name_ko,
                    meta: t("seatValue", { n: row.capacity }),
                    thumb:
                      url !== null ? (
                        <Image src={url} alt="" width={THUMB_W} height={THUMB_H} className={a.popupImageThumb} unoptimized />
                      ) : (
                        <span className={a.hint}>{t("noPhoto")}</span>
                      ),
                    status: { text: row.active ? t("state.live") : t("state.off"), live: row.active },
                    end: (
                      <>
                        <Link className={a.rowLink} href={`${ADMIN_FLEET_PATH}/${row.id}`}>
                          {t("editLink")}
                        </Link>
                        <VehicleToggle
                          id={row.id}
                          active={row.active}
                          labels={{ turnOn: t("turnOn"), turnOff: t("turnOff"), processing: t("processing"), results }}
                        />
                      </>
                    ),
                  };
                })}
                labels={{
                  save: t("order.save"),
                  reset: t("order.reset"),
                  processing: t("processing"),
                  up: t.raw("order.up") as string,
                  down: t.raw("order.down") as string,
                  handle: t.raw("order.handle") as string,
                  moved: t.raw("order.moved") as string,
                  picked: t.raw("order.picked") as string,
                  canceled: t("order.canceled"),
                  instructions: t("order.instructions"),
                  locked: t("order.locked"),
                }}
                saved={t("order.saved")}
                failed={t("order.failed")}
              />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
