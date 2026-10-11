import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { VehicleForm } from "@/components/admin/VehicleForm";
import { getVehicleFormLabels } from "@/components/admin/vehicleFormLabels";
import { routing } from "@/i18n/routing";
import { parseVehicleId } from "@/lib/admin/vehicleInput";
import { ADMIN_FLEET_PATH, getAdminVehicle, vehicleHasBookings } from "@/lib/admin/vehicles";
import { requireAdmin } from "@/lib/auth/requireAdmin";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/fleet/[id] — 차량 고치기·지우기 (T4-1 · 결정 11). 본문 첫 문장 requireAdmin()(scripts/check-admin-gate).
 * 접수 기록이 있으면 이름·정원 칸이 잠기고 지우기 대신 안내가 보인다(막는 것은 DB — 0024).
 * 기록 여부를 읽지 못하면 **있다고 본다**(잠근 쪽이 안전하다 — 저장은 어차피 DB 가 판정한다).
 */
type Params = Promise<{ id: string }>;

export default async function AdminFleetEditPage({ params }: { params: Params }) {
  await requireAdmin();

  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.fleet" });
  const { id } = await params;
  const vehicleId = parseVehicleId(id);
  const row = vehicleId === null ? null : await getAdminVehicle(vehicleId);

  if (row === null) {
    return (
      <main className={q.main} data-testid="admin-fleet-edit">
        <div className={q.wrap}>
          <Link className={a.backLink} href={ADMIN_FLEET_PATH}>
            {t("back")}
          </Link>
          <p className={a.empty}>{t("notFound")}</p>
        </div>
      </main>
    );
  }

  const [hasBookings, labels] = await Promise.all([vehicleHasBookings(row.slug).catch(() => true), getVehicleFormLabels()]);

  return (
    <main className={q.main} data-testid="admin-fleet-edit">
      <div className={q.wrap}>
        <Link className={a.backLink} href={ADMIN_FLEET_PATH}>
          {t("back")}
        </Link>
        <header className={q.pageHead}>
          <h1 className={q.title}>{t("edit")}</h1>
          <p className={q.sub}>
            {row.name_ko}
            {hasBookings ? ` · ${t("bookedBadge")}` : ""}
          </p>
        </header>
        <section className={a.section} aria-label={t("edit")}>
          <VehicleForm
            mode="edit"
            id={row.id}
            initial={{
              nameKo: row.name_ko,
              nameEn: row.name_en,
              capacity: String(row.capacity),
              descriptionKo: row.description_ko ?? "",
              imagePath: row.image_path ?? "",
              active: row.active,
            }}
            hasBookings={hasBookings}
            labels={labels}
            listHref={ADMIN_FLEET_PATH}
          />
        </section>
      </div>
    </main>
  );
}
