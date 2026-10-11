import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { VehicleForm } from "@/components/admin/VehicleForm";
import { getVehicleFormLabels } from "@/components/admin/vehicleFormLabels";
import { routing } from "@/i18n/routing";
import { ADMIN_FLEET_PATH } from "@/lib/admin/vehicles";
import { requireAdmin } from "@/lib/auth/requireAdmin";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/fleet/new — 새 차량 추가 (T4-1). 본문 첫 문장 requireAdmin()(scripts/check-admin-gate).
 * 저장하면 맨 뒤 순서로 들어가고 목록으로 돌아간다.
 */
export default async function AdminFleetNewPage() {
  await requireAdmin();

  const [t, labels] = await Promise.all([getTranslations({ locale: routing.defaultLocale, namespace: "admin.fleet" }), getVehicleFormLabels()]);

  return (
    <main className={q.main} data-testid="admin-fleet-new-page">
      <div className={q.wrap}>
        <Link className={a.backLink} href={ADMIN_FLEET_PATH}>
          {t("back")}
        </Link>
        <header className={q.pageHead}>
          <h1 className={q.title}>{t("newTitle")}</h1>
        </header>
        <section className={a.section} aria-label={t("newTitle")}>
          <VehicleForm
            mode="create"
            initial={{ nameKo: "", nameEn: "", capacity: "", descriptionKo: "", imagePath: "", active: true }}
            hasBookings={false}
            labels={labels}
            listHref={ADMIN_FLEET_PATH}
          />
        </section>
      </div>
    </main>
  );
}
