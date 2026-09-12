-- 0006_trip_return_check.sql — 편도·편도(oneway_oneway)에 귀가 일시 저장 허용
--
-- 배경(P3-2 발견, 2026-09-13): 목업 wizard-b 의 "편도·편도"는 두 번째 운행(귀가) 일시를 받는다.
-- 그런데 0001 의 reservations_round_trip_return_ck 는 `(trip_type = 'round') = (return_at is not null)` —
-- 왕복에만 return_at 을 허용하고 나머지는 금지한다. 편도·편도의 귀가 일시는 사장님이 견적을 내는 데
-- 필수 정보라 조용히 버릴 수 없고, P3-2 는 이 경우 fail-loud 로 throw 하고 있었다.
--
-- 결정(컨트롤러): CHECK 를 넓힌다.
--   round          → return_at 필수 (기존과 동일)
--   oneway_oneway  → return_at 허용 (선택 — 폼 레벨에서 필수 여부는 P3-4 가 정한다)
--   oneway         → return_at 금지 (기존과 동일)
-- `return_at > depart_at` 컬럼 CHECK(0001)는 그대로 유지된다.
--
-- 기존 행 영향: 새 CHECK 는 옛 CHECK 보다 넓다(옛 CHECK 를 만족하는 모든 행이 새 CHECK 도 만족). 원격 reservations
-- 는 현재 0행이지만, 행이 있어도 안전하다. 롤백은 반대 — 좁히므로 oneway_oneway + return_at 행이 있으면 실패한다
-- (rollbacks/0006_trip_return_check.down.sql 의 가드 참조).
--
-- 번호: P1-4 가 0005 를 썼고 이 파일이 0006. 플랜 §4 의 admin_rls → 0007, gallery_albums → 0008 로 밀린다.

alter table reservations
  drop constraint if exists reservations_round_trip_return_ck;

alter table reservations
  add constraint reservations_round_trip_return_ck check (
       (trip_type = 'round'         and return_at is not null)
    or (trip_type = 'oneway_oneway')
    or (trip_type = 'oneway'        and return_at is null)
  );
