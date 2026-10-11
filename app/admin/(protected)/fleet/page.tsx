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

        <section className={a.section} aria-labelledby="fleet-list-title">
          <h2 className={a.sectionTitle} id="fleet-list-title">
            {t("listLabel")}
          </h2>
          {rows.length === 0 ? (
            <p className={a.empty}>{t("empty")}</p>
          ) : (
            <div className={`${a.tableWrap} ${a.contentWrap}`}>
              <table className={`${a.tablePopups} ${a.contentTable} ${a.tableMiddle}`} aria-labelledby="fleet-list-title" data-testid="admin-fleet-table">
                <thead>
                  <tr>
                    <th className={a.th} scope="col">
                      {t("col.vehicle")}
                    </th>
                    <th className={a.th} scope="col">
                      {t("col.capacity")}
                    </th>
                    <th className={a.th} scope="col">
                      {t("col.state")}
                    </th>
                    <th className={a.th} scope="col">
                      {t("col.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const url = resolveImageUrl(row.image_path);
                    return (
                      <tr key={row.id}>
                        <td className={`${a.td} ${a.tdStrong}`} data-cell="title">
                          <span className={a.rowActions}>
                            {url !== null ? (
                              <Image src={url} alt="" width={THUMB_W} height={THUMB_H} className={a.popupImageThumb} unoptimized />
                            ) : (
                              <span className={a.hint}>{t("noPhoto")}</span>
                            )}
                            <Link className={a.rowLink} href={`${ADMIN_FLEET_PATH}/${row.id}`}>
                              {row.name_ko}
                            </Link>
                          </span>
                        </td>
                        <td className={`${a.td} ${a.tdNowrap}`} data-cell="meta">
                          {t("seatValue", { n: row.capacity })}
                        </td>
                        <td className={a.td} data-cell="meta">
                          <span className={a.badge} data-state={row.active ? "live" : "off"}>
                            {row.active ? t("state.live") : t("state.off")}
                          </span>
                        </td>
                        <td className={a.td} data-cell="actions">
                          <div className={a.rowActions}>
                            <Link className={a.rowLink} href={`${ADMIN_FLEET_PATH}/${row.id}`}>
                              {t("editLink")}
                            </Link>
                            <VehicleToggle
                              id={row.id}
                              active={row.active}
                              labels={{ turnOn: t("turnOn"), turnOff: t("turnOff"), processing: t("processing"), results }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {rows.length > 1 ? (
          <section className={a.section} aria-labelledby="fleet-order-title">
            <h2 className={a.sectionTitle} id="fleet-order-title">
              {t("order.title")}
            </h2>
            <p className={a.hint}>{t("order.hint")}</p>
            <VehicleOrder
              items={rows.map((row) => ({
                id: row.id,
                label: row.name_ko,
                meta: `${t("seatValue", { n: row.capacity })}${row.active ? "" : ` · ${t("state.off")}`}`,
              }))}
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
              }}
              saved={t("order.saved")}
              failed={t("order.failed")}
            />
          </section>
        ) : null}
      </div>
    </main>
  );
}
