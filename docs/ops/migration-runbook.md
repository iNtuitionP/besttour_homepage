# 마이그레이션 원격 적용 런북

원격(호스팅 Supabase)에는 **실고객 데이터**가 있다. 여기 적용하는 것은 되돌리기 어렵다.
그래서 적용은 **컨트롤러만** 하고, 아래 순서를 건너뛰지 않는다.

## 순서
1. 로컬 스택(`supabase db reset`)에 적용하고 **DB 테스트 전량**이 통과한다.
2. **CI 가 green** 이다(푸시된 커밋 기준). red 인 채로 원격에 적용하지 않는다.
3. 아래 **적용 전 확인**을 로컬에서 실행해 기대값과 일치하는지 본다.
4. 원격에 적용한다.
5. 같은 확인을 **원격에서** 다시 실행해 로컬과 같은 결과인지 대조한다.
6. 결과를 이 파일에 날짜와 함께 적는다.

**롤백 파일은 `supabase/rollbacks/` 에 있고 `migrations/` 밖이다** — CLI 가 `migrations/` 의 `^[0-9]+_.*\.sql$` 을 전부 마이그레이션으로 집기 때문이다. 롤백은 사람이 psql/SQL Editor 로 실행한 뒤 `supabase migration repair --status reverted <번호>`.
0012·0013 롤백은 **승인 플래그를 조건 없이 요구**한다(`set bestour.rollback_00NN_ack = '1';`). 행이 0이어도 멈춘다 — 권한은 열린 채 남고 데이터는 나중에 들어오기 때문이다.

---

## 0012 · 0013 — 쓰기 권한 회수 (적용 대기)

**무엇을 하나**: Supabase 가 public 스키마 표에 `anon`·`authenticated` 로 기본 부여한 쓰기 권한을 회수한다. 회수하지 않으면 **RLS 가 유일한 방어선**이 된다(같은 뿌리로 세 번 재발했다).
- `0012` — `notifications_log` 에서 insert/update/delete/truncate, `reservations` 에서 insert/delete/truncate 를 **anon·authenticated** 에서 회수(reservations 의 UPDATE 는 0010 이 이미 회수).
- `0013` — 콘텐츠 7표(`notices`·`popups`·`gallery`·`gallery_albums`·`showcase_routes`·`vehicles`·`places`)에서 insert/update/delete/truncate 를 **anon 에서만** 회수. `authenticated` 는 관리자 화면이 실제로 쓰므로 건드리지 않는다.

**정상 경로가 막히지 않는 이유**: 공개 접수·아웃박스 적재·파기 크론은 **서비스 롤**이고, 예약 상태 전이는 0005·0007·0010 의 **security definer 함수**라 소유자 권한으로 돌아 grant 와 무관하다.

### 적용 전 확인 — 로컬 실측 (2026-09-15, 컨트롤러)

```
docker exec supabase_db_besttour-homepage psql -U postgres -d postgres -At -c "<아래 질의>"
```

| # | 확인 | 기대 | 로컬 결과 |
|---|---|---|---|
| ① | `has_table_privilege('authenticated','public.reservations','update')` | `false` | **false** ✅ |
| ② | `reservations`·`notifications_log` 의 grantee 집합 | `anon,authenticated,postgres,service_role` **4행뿐 · PUBLIC 없음** | 두 표 모두 정확히 그 4행 ✅ |
| ③ | 콘텐츠 7표의 `authenticated` CRUD 생존 | 7표 전부 `select,insert,update,delete` | 7표 전부 4종 ✅ |
| ④ | 회수 반대편 — `anon` 이 9표에서 갖는 권한 | **`select` 뿐** | 9표 전부 `select` 만 ✅ |
| ⑤ | `authenticated` 가 두 개인정보 표에서 갖는 권한 | **`select` 뿐** | 두 표 모두 `select` 만 ✅ |

②가 중요한 이유: **표 단위 `revoke` 는 `PUBLIC` 롤의 grant 를 지우지 못한다.** PUBLIC 에 권한이 남아 있으면 anon 이 그것을 상속해, 회수한 것처럼 보이는데 실제로는 열려 있다. 0012·0013 의 자기검증 블록이 이 경우를 `hint` 에서 첫 번째 원인으로 지목한다.

**질의 원문** (①~⑤를 그대로 재현할 수 있게 남긴다):
```sql
-- ①
select has_table_privilege('authenticated','public.reservations','update');

-- ②
select table_name, string_agg(distinct grantee, ',' order by grantee)
from information_schema.role_table_grants
where table_schema='public' and table_name in ('reservations','notifications_log')
group by table_name;

-- ③④⑤ (롤·표 목록만 바꿔 쓴다)
select t, string_agg(p, ',' order by p)
from (
  select t, p from unnest(array['notices','popups','gallery','gallery_albums','showcase_routes','vehicles','places']) t
  cross join unnest(array['select','insert','update','delete','truncate']) p
  where has_table_privilege('authenticated','public.'||t, p)
) s group by t order by t;
```

### 적용 후 확인 (원격)
같은 질의 다섯 개를 원격에서 돌려 **위 표와 같은 결과**인지 대조하고, 아래에 날짜·결과를 적는다.

> **원격 적용: 아직 하지 않았다.** 선행 조건인 CI green 을 기다리는 중이다(db-test 가 이 두 마이그레이션으로 풀린다).

---

## 0014 — claim 채널 필터 (미작성, P4-5)
`claim_pending_notifications` 에 채널 화이트리스트를 넣는다. **1-인자 구버전을 반드시 `drop` 한 뒤** 2-인자를 만든다 — `create or replace` 에 파라미터를 더하면 Postgres 가 새 함수로 보고 구버전이 남아 1-인자 호출이 **모호(ambiguous)** 해진다. `drop` 은 grant 도 지우므로 `revoke`/`grant` 를 다시 기술해야 한다(0005:166-169).
근거와 배경은 `docs/ops/known-defects.md` **D3**.
