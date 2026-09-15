import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { GalleryAlbums } from "@/components/admin/GalleryAlbums";
import { GalleryPhotoCard } from "@/components/admin/GalleryPhotoCard";
import { GalleryUploader } from "@/components/admin/GalleryUploader";
import { resolveImageUrl } from "@/components/home/image-url";
import { routing } from "@/i18n/routing";
import { ADMIN_GALLERY_PATH, galleryUsage, listAdminAlbums, listAdminPhotos } from "@/lib/admin/gallery";
import { formatUsageSize, type GalleryActionCode, type GalleryRejectReason } from "@/lib/admin/galleryInput";
import { requireAdmin } from "@/lib/auth/requireAdmin";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/gallery — 사진 업로드·목록·앨범 (P6-2 · 스펙 §13.9).
 *
 * (protected) 그룹 안이라 레이아웃이 이미 게이트를 걸었지만 **여기서 다시, 본문 첫 문장으로** requireAdmin() 을 부른다.
 * 조건도 try 도 붙이지 않는다 — scripts/check-admin-gate.mjs 가 그 형태를 구조로 강제한다.
 *
 * 읽기는 lib/admin/gallery.ts 의 세션 클라이언트 + 0009 RLS 다(서비스 롤 금지 — ADR-2). 캐시하지 않는다
 * (app/admin/layout.tsx 의 force-dynamic). 비활성 사진·비활성 앨범도 보인다 — 되살리려면 먼저 보여야 한다.
 *
 * **업로드는 이 서버를 지나가지 않는다.** 파일은 브라우저가 Storage 로 직접 올리고(components/admin/GalleryUploader.tsx),
 * 이 화면이 하는 일은 올릴 앨범을 고르게 하고 결과 목록을 다시 그리는 것뿐이다(ADR-9).
 *
 * 사용량(스펙 §13.9 (5))은 **DB 에 저장된 bytes 의 합**이다 — 지어낸 수치가 아니라 우리가 기록한 값의 합계이고,
 * 그래서 화면에 적어도 실증 문제(CLAUDE.md §3)가 없다. 합계는 서버에서 계산하고 표시만 반올림한다.
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** `?album=` — 없으면 전체, `none` 이면 미분류, 숫자면 그 앨범. 그 밖의 값은 전체로 본다. */
function parseAlbumParam(raw: string | string[] | undefined): number | null | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === "") return undefined;
  if (value === "none") return null;
  return /^[1-9]\d{0,9}$/.test(value) ? Number(value) : undefined;
}

export default async function AdminGalleryPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();

  const params = await searchParams;
  const albumFilter = parseAlbumParam(params.album);
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.gallery" });

  const [albums, photos, usage] = await Promise.all([listAdminAlbums(), listAdminPhotos({ albumId: albumFilter }), galleryUsage()]);

  const results = {
    recorded: t("result.recorded"),
    updated: t("result.updated"),
    deleted: t("result.deleted"),
    activated: t("result.activated"),
    deactivated: t("result.deactivated"),
    albumCreated: t("result.albumCreated"),
    albumUpdated: t("result.albumUpdated"),
    albumActivated: t("result.albumActivated"),
    albumDeactivated: t("result.albumDeactivated"),
    albumDeleted: t("result.albumDeleted"),
    notFound: t("result.notFound"),
    validation: t("result.validation"),
    failed: t("result.failed"),
    fileFailed: t("result.fileFailed"),
  } satisfies Record<GalleryActionCode, string>;

  const reject = {
    count: t("reject.count"),
    size: t("reject.size"),
    type: t("reject.type"),
    empty: t("reject.empty"),
    decode: t("reject.decode"),
    encode: t("reject.encode"),
    upload: t("reject.upload"),
    record: t("reject.record"),
    needsCheck: t("reject.needsCheck"),
  } satisfies Record<GalleryRejectReason, string>;

  const state = { live: t("state.live"), off: t("state.off") };
  const albumOptions = albums.map((album) => ({ id: album.id, title: album.title }));

  const filters: { key: string; label: string; href: string; current: boolean }[] = [
    { key: "all", label: t("albumAll"), href: ADMIN_GALLERY_PATH, current: albumFilter === undefined },
    { key: "none", label: t("albumNone"), href: `${ADMIN_GALLERY_PATH}?album=none`, current: albumFilter === null },
    ...albums.map((album) => ({
      key: String(album.id),
      label: album.title,
      href: `${ADMIN_GALLERY_PATH}?album=${album.id}`,
      current: albumFilter === album.id,
    })),
  ];

  return (
    <main className={q.main} data-testid="admin-gallery">
      <div className={a.pageWrap}>
        <header className={q.pageHead}>
          <h1 className={q.title}>{t("title")}</h1>
          <p className={q.sub}>{t("sub")}</p>
        </header>

        <section className={a.section}>
          <h2 className={a.sectionTitle}>{t("upload")}</h2>
          <GalleryUploader
            albums={albumOptions}
            defaultAlbumId={typeof albumFilter === "number" ? albumFilter : null}
            labels={{
              upload: t("upload"),
              uploadHint: t("uploadHint"),
              uploadTarget: t("uploadTarget"),
              albumNone: t("albumNone"),
              processing: t("processing"),
              heicHelp: t("heicHelp"),
              running: t.raw("uploadRunning") as string,
              status: { waiting: t("status.waiting"), working: t("status.working"), done: t("status.done"), failed: t("status.failed") },
              reject,
              result: results,
            }}
          />
          <p className={a.hint} data-testid="admin-gallery-usage">
            {t("usage", { count: usage.photos, size: formatUsageSize(usage.bytes) })} · {t("usageHint")}
          </p>
        </section>

        <section className={a.section}>
          <h2 className={a.sectionTitle}>{t("albumNew")}</h2>
          <GalleryAlbums
            albums={albums.map((album) => ({ id: album.id, slug: album.slug, title: album.title, sort: album.sort, active: album.active }))}
            labels={{
              albumNew: t("albumNew"),
              albumListLabel: t("albumListLabel"),
              albumEmpty: t("albumEmpty"),
              albumTitle: t("albumTitle"),
              albumSlug: t("albumSlug"),
              albumSlugHint: t("albumSlugHint"),
              albumSort: t("albumSort"),
              albumActive: t("albumActive"),
              albumCreate: t("albumCreate"),
              albumSave: t("albumSave"),
              albumDelete: t("albumDelete"),
              albumDeleteNote: t("albumDeleteNote"),
              albumDeleteConfirm: t("albumDeleteConfirm"),
              turnOn: t("turnOn"),
              turnOff: t("turnOff"),
              processing: t("processing"),
              state,
              results,
            }}
          />
        </section>

        <section className={a.section}>
          <h2 className={a.sectionTitle}>{t("listLabel")}</h2>
          <nav className={a.filters} aria-label={t("albumLabel")}>
            <span className={a.filterLabel}>{t("albumLabel")}</span>
            {filters.map((f) => (
              <Link key={f.key} className={a.filter} href={f.href} aria-current={f.current ? "page" : undefined}>
                {f.label}
              </Link>
            ))}
          </nav>

          {photos.length === 0 ? (
            <p className={a.empty}>{t("empty")}</p>
          ) : (
            <ul className={a.photoGrid} aria-label={t("listLabel")}>
              {photos.map((photo) => (
                <GalleryPhotoCard
                  key={photo.id}
                  photo={{
                    id: photo.id,
                    // 원본(original_path)은 절대 넘기지 않는다 — 비공개 버킷 경로다(P6-1 §7-1)
                    url: resolveImageUrl(photo.image_path),
                    caption: photo.caption ?? "",
                    sort: photo.sort,
                    active: photo.active,
                    albumId: photo.album_id,
                    width: photo.width,
                    height: photo.height,
                  }}
                  albums={albumOptions}
                  labels={{
                    caption: t("caption"),
                    captionHint: t("captionHint"),
                    sort: t("sort"),
                    albumLabel: t("albumLabel"),
                    albumNone: t("albumNone"),
                    save: t("save"),
                    turnOn: t("turnOn"),
                    turnOff: t("turnOff"),
                    delete: t("delete"),
                    deleteArm: t("deleteArm"),
                    deleteConfirm: t("deleteConfirm"),
                    processing: t("processing"),
                    missingFile: t("missingFile"),
                    state,
                    results,
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
