import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { PopupForm } from "@/components/admin/PopupForm";
import { PopupSample } from "@/components/admin/PopupSample";
import { HomePopup } from "@/components/home/HomePopup";
import { routing } from "@/i18n/routing";
import { ADMIN_POPUPS_PATH, getAdminPopup } from "@/lib/admin/popups";
import { parsePopupId } from "@/lib/admin/popupInput";
import { requireAdmin } from "@/lib/auth/requireAdmin";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/popups/[id] — 팝업 수정 · 삭제 · 미리보기 (P5-4).
 *
 * 목록과 같은 이유로 여기서도 **본문 첫 문장이** requireAdmin() 이다(조건·try 금지 — scripts/check-admin-gate.sh).
 * 경로의 id 가 양의 정수가 아니면 DB 를 부르지 않고 "찾을 수 없음" 으로 끝낸다.
 *
 * 미리보기는 홈이 쓰는 `components/home/HomePopup` 을 **그대로** 렌더한다(관리자 전용 사본 금지 — 브리프 §Part 2).
 * 서버가 그린 그 컴포넌트를 PopupSample 이 붙였다 뗀다: 홈 팝업은 화면 전체를 덮는 모달이라 상시로 띄우면 폼을 가린다.
 * 미리보기에 실리는 값은 **저장된 행**이다 — 폼에 입력 중인 내용이 아니라 방문자가 지금 보게 될 내용이다.
 */
type Params = Promise<{ id: string }>;

export default async function AdminPopupEditPage({ params }: { params: Params }) {
  await requireAdmin();

  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.popups" });
  const { id } = await params;
  const popupId = parsePopupId(id);
  const row = popupId === null ? null : await getAdminPopup(popupId);

  if (row === null) {
    return (
      <main className={q.main} data-testid="admin-popup-edit">
        <div className={q.wrap}>
          <Link className={a.backLink} href={ADMIN_POPUPS_PATH}>
            {t("back")}
          </Link>
          <p className={a.empty}>{t("notFound")}</p>
        </div>
      </main>
    );
  }

  const results = {
    created: t("result.created"),
    updated: t("result.updated"),
    deleted: t("result.deleted"),
    activated: t("result.activated"),
    deactivated: t("result.deactivated"),
    notFound: t("result.notFound"),
    validation: t("result.validation"),
    failed: t("result.failed"),
  };

  return (
    <main className={q.main} data-testid="admin-popup-edit">
      <div className={q.wrap}>
        <Link className={a.backLink} href={ADMIN_POPUPS_PATH}>
          {t("back")}
        </Link>

        <header className={q.pageHead}>
          <h1 className={q.title}>{t("edit")}</h1>
          <p className={q.sub}>{t("periodValue", { start: row.starts_at, end: row.ends_at })}</p>
        </header>

        <section className={a.section}>
          <h2 className={a.sectionTitle}>{t("edit")}</h2>
          <PopupForm
            mode="edit"
            id={row.id}
            listHref={ADMIN_POPUPS_PATH}
            initial={{
              title: row.title,
              body: row.body,
              imagePath: row.image_path ?? "",
              startsAt: row.starts_at,
              endsAt: row.ends_at,
              active: row.active,
            }}
            labels={{
              field: {
                title: t("field.title"),
                body: t("field.body"),
                imagePath: t("field.imagePath"),
                startsAt: t("field.startsAt"),
                endsAt: t("field.endsAt"),
                active: t("field.active"),
              },
              hint: {
                title: t("hint.title"),
                body: t("hint.body"),
                imagePath: t("hint.imagePath"),
                period: t("hint.period"),
                active: t("hint.active"),
              },
              notice: t("notice"),
              submit: t("save"),
              processing: t("processing"),
              delete: t("delete"),
              deleteArm: t("deleteArm"),
              deleteConfirm: t("deleteConfirm"),
              results,
            }}
          />
        </section>

        <section className={a.section}>
          <h2 className={a.sectionTitle}>{t("sample.title")}</h2>
          <PopupSample labels={{ show: t("sample.show"), hide: t("sample.hide"), note: t("sample.note") }}>
            <HomePopup
              popup={{
                id: row.id,
                title: row.title,
                body: row.body,
                imagePath: row.image_path,
                startsAt: row.starts_at,
                endsAt: row.ends_at,
                active: row.active,
                createdAt: row.created_at,
              }}
            />
          </PopupSample>
        </section>
      </div>
    </main>
  );
}
