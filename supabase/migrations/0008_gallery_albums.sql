-- 0008_gallery_albums.sql — 갤러리 앨범 신설 + gallery 확장 (플랜 v4 P6-1 · 스펙 §13.9 (5))
--
-- 왜: 사장님 요구는 "회사 사진을 아주 많이 올리고 싶다"다. 그런데 0001 의 gallery 는 `sort int` 하나로 정렬하는
-- 평면 목록이라 수백 장만 넘어도 관리(어느 사진이 어디 것인지)도 열람(방문자가 원하는 묶음만 보기)도 성립하지 않는다.
-- 스펙 §13.9 (5)가 "앨범/카테고리 도입 필수"로 못박은 이유다. 이 마이그레이션은 그 스키마만 세운다 —
-- 업로드·변환·Storage 버킷은 P6-2, 화면(앨범 UI)은 사진과 업로드 경로가 생긴 뒤 별도 태스크다.
--
-- §13.9 (5)가 요구한 컬럼 6개를 gallery 에 더한다:
--   album_id      — 앨범 소속. null = 미분류(기존 행과 앨범 삭제 후의 사진이 여기 남는다)
--   width·height  — 레이아웃 시프트(CLS) 방지. <img width height> 로 자리를 먼저 잡는다
--   bytes         — Storage 사용량 모니터링(관리자 전용 정보 — 공개 읽기 타입·select 에 넣지 않는다)
--   original_path — 비공개 버킷의 원본 경로. §13.9 (4)의 "원본 보관, 공개 노출은 변환본만" 정책을 스키마로 표현한다.
--                   공개 변환본 경로인 image_path 와 다른 컬럼이다
--   created_at    — 업로드 시각
--
-- 결정: 변환본 경로를 컬럼으로 늘리지 않는다.
--   §13.9 (4)의 자동 변환 3종(1600 / 800 / 400px WebP)을 image_path_1600 / _800 / _400 처럼 컬럼으로 두면
--   스키마가 변환 전략에 묶인다 — 변환 크기를 하나 바꾸거나 늘릴 때마다 마이그레이션이 필요해지고,
--   Storage 변환 파라미터(on-the-fly)로 갈아타면 컬럼 전부가 죽은 데이터가 된다.
--   공개 경로는 image_path 하나만 두고 크기 변형은 렌더 계층이 정한다(components/home/image-url.ts).
--   사전 생성이냐 변환 파라미터냐는 P6-2 가 결정하며, 어느 쪽이든 이 스키마는 그대로다.
--
-- 0001 은 수정하지 않는다(원격에 이미 적용됨) — 0002·0003·0006 과 같은 규약. gallery 는 alter 로만 넓히고,
-- gallery_select_active 정책은 이름을 유지한 채 런타임에 교체한다. tests/gallery-albums.test.ts §2 가
-- 0001_init.sql 의 정규화 sha256 을 고정해 이 규약을 잠근다.
--
-- 기존 행 영향: 추가 컬럼은 전부 null 허용이거나 default 가 있다(created_at). 원격 gallery 는 현재 0행이지만
-- 행이 있어도 안전하다 — album_id 는 null(미분류)로, created_at 은 now() 로 채워진다.
-- 롤백은 반대로 좁히므로 앨범 행·업로드 메타가 있으면 멈춘다: supabase/rollbacks/0008_gallery_albums.down.sql
-- (수동 실행 전용 — migrations/ 밖에 두는 이유는 0005·0007 롤백 헤더 참조).
-- 번호: 플랜 §4 — 0007 은 P4-1 회수기가 선점했고 이 파일이 0008, admin_rls 가 0009.

-- =========================================================================
-- 1. gallery_albums — 앨범(차량별·행사별) 카탈로그
--    slug 는 URL 세그먼트(/gallery/<slug>)로 그대로 쓰이므로 DB 가 형식을 강제한다. 경로 조작(`../`)·
--    대문자(대소문자 혼동)·공백이 애초에 들어오지 못하게 CHECK 로 막는다 — lib/queries/albums.ts
--    parseAlbumSlug 가 같은 규칙으로 한 번 더 걸러 잘못된 slug 는 DB 에 가지도 않는다.
-- =========================================================================
create table if not exists gallery_albums (
  id          serial primary key,
  slug        text unique not null,
  title       text not null,                    -- 화면 표시명
  description text,                             -- 선택
  sort        int not null default 0,           -- 앨범 목록 정렬(동률은 id)
  active      boolean not null default true,    -- 비활성 앨범은 공개 조회 0행 (아래 RLS)
  created_at  timestamptz not null default now()
);

alter table gallery_albums drop constraint if exists gallery_albums_slug_ck;
alter table gallery_albums
  add constraint gallery_albums_slug_ck
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 1 and 40);

-- =========================================================================
-- 2. gallery 확장 — alter 로만. 0001 의 테이블 정의는 건드리지 않는다.
--    album_id 는 null 허용 + on delete set null 이다: 앨범을 지웠다고 사진이 사라지면 안 된다.
--    cascade 였다면 사장님이 앨범 하나를 지우는 순간 그 안의 사진 수백 장이 함께 사라진다 —
--    Storage 객체는 남고 DB 행만 사라져 복구 불가능한 고아 파일이 된다.
-- =========================================================================
alter table gallery
  add column if not exists album_id      int references gallery_albums (id) on delete set null,
  add column if not exists width         int,
  add column if not exists height        int,
  add column if not exists bytes         int,
  add column if not exists original_path text,
  add column if not exists created_at    timestamptz not null default now();

-- 픽셀·바이트는 "모르면 null, 있으면 양수"다. 0 이나 음수는 업로드 메타가 깨졌다는 뜻이라 저장을 막는다.
alter table gallery drop constraint if exists gallery_width_ck;
alter table gallery add constraint gallery_width_ck  check (width  is null or width  > 0);
alter table gallery drop constraint if exists gallery_height_ck;
alter table gallery add constraint gallery_height_ck check (height is null or height > 0);
alter table gallery drop constraint if exists gallery_bytes_ck;
alter table gallery add constraint gallery_bytes_ck  check (bytes  is null or bytes  > 0);

-- 앨범별 페이지네이션 경로 — lib/queries/gallery.ts getGalleryPage 가 (album_id 필터) + sort, id 순으로 읽는다.
create index if not exists gallery_album_sort_idx on gallery (album_id, sort, id);

-- =========================================================================
-- 3. RLS — 비활성 앨범의 사진은 anon 에게 보이지 않아야 한다
--
--    앨범을 비활성으로 내리는 것은 "이 묶음을 내리겠다"는 뜻인데, 0001 정책(using (active))만 두면
--    그 앨범 안의 사진은 저마다 active = true 라 그대로 공개된다 — 앨범을 내려도 내용이 다 보인다.
--    그래서 사진 정책에 "소속 앨범도 활성이어야 한다"를 더한다. album_id is null(미분류)은 그대로 공개다.
--
--    gallery_albums 에도 정책을 건다. 안 걸면 RLS 만 켜진 채 정책이 없어 anon 이 0행이 되거나(읽기 불가),
--    정책을 아예 안 켜면 anon 이 REST 로 비활성 앨범 제목까지 전부 읽는다. 둘 다 원하는 결과가 아니다.
--
--    anon 의 select 권한: gallery 정책의 EXISTS 절이 gallery_albums 를 읽으므로, 그 권한이 없으면
--    갤러리 조회 전체가 "permission denied" 로 죽는다. public 스키마 기본권한에 기대지 않고 명시한다.
-- =========================================================================
alter table gallery_albums enable row level security;
drop policy if exists gallery_albums_select_active on gallery_albums;
create policy gallery_albums_select_active on gallery_albums for select using (active);

grant select on table gallery_albums to anon, authenticated;

drop policy if exists gallery_select_active on gallery;
create policy gallery_select_active on gallery for select using (
  active
  and (album_id is null or exists (select 1 from gallery_albums a where a.id = gallery.album_id and a.active))
);
