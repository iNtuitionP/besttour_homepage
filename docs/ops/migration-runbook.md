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
0012·0013·0014·0015·0016·0017·0018 롤백은 **승인 플래그를 조건 없이 요구**한다(`set bestour.rollback_00NN_ack = '1';`). 행이 0이어도 멈춘다 — 권한은 열린 채 남고 데이터는 나중에 들어오기 때문이다.

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

### ⚠️ 위 ②번 확인은 생각만큼 강하지 않다 (외부 모델 크로스체크, 2026-09-16)

OpenAI Codex 에 적용 직전 검토를 받았고 **P1 은 나오지 않았다**(적용을 막을 문제 없음). 다만 **내 확인 방법 중 하나가 틀렸다**:

`information_schema.role_table_grants` 는 **완전한 ACL 목록이 아니다.** grantor·grantee 가 "활성화된 롤" 인 항목만 보여주는 **필터된 뷰**다.
따라서 **"이 뷰에 PUBLIC 이 없다" 는 "PUBLIC 에 권한이 없다" 의 증명이 아니다.** 제대로 보려면 `pg_class.relacl` 을 `aclexplode()` 로 풀고 **grantee OID = 0**(PUBLIC)을 찾아야 한다.

다행히 **②가 무너져도 결론은 유지된다** — ④⑤의 `has_table_privilege` 검사는 **PUBLIC 과 상속된 표 권한까지 실제로 잡아내기** 때문이다. 즉 강한 증거는 ④⑤이고 ②는 보조였다. 그래도 남는 구멍 둘:

- **"select 뿐" 은 "질의한 다섯 가지 중 select 뿐" 이라는 뜻이다.** `REFERENCES`·`TRIGGER` 는 그대로 남아 있다(의도적으로 남겼다).
- **컬럼 단위 grant 는 `has_table_privilege` 가 못 본다.** 표 단위 revoke 가 직접 부여된 컬럼 grant 는 함께 지우지만, **PUBLIC 이나 다른 롤을 통해 상속된 컬럼 grant 는 살아남는다.** `has_any_column_privilege(role, table, 'insert')`·`'update'` 검사를 추가해야 한다.

또 하나 정정: `0012` 가 `TRIGGER` 를 남긴 근거로 "스키마 CREATE 권한이 없어 쓸 수 없다" 고 적었는데 **그 이유는 성립하지 않는다.** `CREATE TRIGGER` 는 표의 TRIGGER 권한과 **이미 존재하는** 트리거 함수의 EXECUTE 만 요구한다 — 함수를 새로 만들 필요도, 스키마 CREATE 도 필요 없다. 공개 경로로 임의 `CREATE TRIGGER` 를 칠 방법은 못 찾았으므로 실exploit 은 아니지만, **적어 둔 이유가 틀렸다.**

### 적용 **전** 원격 점검 (Codex 권고 — 로컬 성공은 원격 사실을 증명하지 못한다)

로컬에서만 재고 원격은 적용 **후에** 보는 순서였는데, 그러면 이미 늦다. 그래서 적용 전에 원격 스키마를 떠서(`supabase db dump --linked`, **데이터 없이 스키마만**) 아래를 실측했다.

| 확인 | 결과 (2026-09-16, 원격 `expexkhcuogkavpacrem`) |
|---|---|
| 마이그레이션 이력 | 0001~0011 적용됨, **0012·0013 대기** — 로컬과 일치 |
| 9표에 PUBLIC 대상 GRANT | **없음** |
| 컬럼 단위 GRANT | **없음** |
| public 스키마의 뷰 | **없음** (보안 우회 경로 없음) |
| 트리거 | **없음** |
| 9표 소유자 | 전부 `postgres` |
| definer 함수 9개 소유자 | 전부 `postgres` |
| 함수 EXECUTE | 아웃박스 4종 → `service_role` · 관리자 전이 4종 → `authenticated` · `is_admin` → `authenticated`+`service_role`. **의도와 일치** |
| RLS 활성 표 | 10 |

### 🔴 이번에 찾은 뿌리 — 네 번 반복된 이유

원격에 이것이 살아 있다:
```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
```

"Supabase 가 넓게 준다" 는 막연한 말이 아니라 **이 설정 세 줄**이다. 그리고 이것은 **앞으로 만들 모든 객체에 계속 적용된다.**

- 새 표를 만들면 **자동으로** anon·authenticated 가 전권을 갖는다 → 0012·0013 같은 사후 회수가 영원히 반복된다.
- **새 함수도 마찬가지다.** `drop function` 후 `create function` 하면 **EXECUTE 가 anon·authenticated 에게 자동으로 다시 부여된다.**
  → **0014(P4-5)가 정확히 이 모양이다.** 그래서 0014 는 재생성과 같은 트랜잭션 안에서 반드시 `revoke ... from public, anon, authenticated` 를 해야 한다.
  빠뜨리면 **아웃박스 큐를 변경하고 통지 행을 반환하는 definer 함수가 공개 롤에 열린다** — 0012 가 표 권한을 회수한 것이 그 함수 하나로 무의미해진다. Codex 가 이것을 "빠뜨리면 P1" 으로 분류했다.

**기본 권한 자체를 회수할 것인가?** 하지 않는다(지금은). Supabase 의 설계는 "새 표는 PostgREST 로 즉시 쓸 수 있고 RLS 가 문지기" 이고, 이 기본값을 건드리면 대시보드·PostgREST 의 기대와 어긋날 수 있다. 우리는 **개인정보 표에 한해 RLS 를 유일 방어선으로 두지 않기로** 결정했고, 그래서 표 단위로 명시 회수한다.
대신 **재발을 기계로 잡는다** → 아래 후속 태스크.

### 후속
- ~~**DB 권한 게이트**: `anon` 이 public 스키마의 어느 표에도 쓰기 권한을 갖지 않는지(허용 목록 외) 단언하는 테스트.~~ → **P6-11 (2026-09-17) 에서 신설: `tests/db-privilege-gate.test.ts`.** ✅
  `pg_class`·`pg_proc`·`pg_policy` 에서 public 의 표·뷰·시퀀스·함수를 **열거**하고(하드코딩 없음) `has_*_privilege` 실효값 · 컬럼 단위 · PUBLIC(`aclexplode` grantee 0, NULL ACL 은 `acldefault`) ·
  definer 함수의 `pg_temp` · 소유자 · RLS 켜짐 · "쓰기 권한에는 그 동작을 허용하는 `authenticated` 정책이 있다" 를 허용 목록(항목마다 사유)과 대조한다. 죽은 예외도 실패다.
  **이빨**: 기본 권한 그대로의 임시 표·시퀀스·definer 함수를 `do $$ … raise $$` 로 **되돌려지는 트랜잭션 안에서** 만들어 게이트가 **이름을 대며** 빨개지는 것을 매 실행 확인한다(흔적 0 도 확인).
  0017 롤백을 적용하면 `reservations`·`notifications_log` 10건으로 빨개진다(실측).
  - ~~🔴 **게이트가 첫 실행에서 찾은 것 — 시퀀스 36건.**~~ → **0018 (P5-14, 2026-09-17) 에서 회수 완료. 게이트 초록.** ✅
    0012~0017 은 **시퀀스를 한 번도 회수하지 않았다.** 공개 7개 시퀀스에서 `anon` 이 usage·select·update 를, `authenticated` 가 select·update(+ `notifications_log_id_seq` 의 usage)를 갖고 있었다.
    허용 목록은 넓히지 않았다 — 처음부터 있던 **콘텐츠 6 × `authenticated.usage`** 만 남기고 나머지를 회수해서 초록이 됐다. 아래 0018 절.
- ④⑤ 질의에 `has_any_column_privilege` 추가, ② 질의를 `pg_class.relacl` + `aclexplode` 로 교체. → **0016 이 자기검증·테스트 §9 에서 그렇게 한다**(질의 자체는 아래 0016 절에 있다). ✅
- ~~`0012:34` 의 TRIGGER 관련 주석 정정.~~ → **0016 (P5-12) 에서 완료.** `0012` 헤더에 원문을 남긴 채 정정을 덧붙였다. ✅
- ~~`authenticated` 의 콘텐츠 7표 **TRUNCATE 회수**~~ → **0016 에서 완료** (TRIGGER·REFERENCES 도 함께). ✅
- ~~**`places` 는 애초에 관리자가 쓰지 않는다**~~ → **0016 에서 `authenticated` 의 insert/update/delete 회수 완료**(`select` 는 남겼다). ✅
- ~~`0005:96`·`0007:31` 의 definer 함수가 `pg_temp` 를 빠뜨렸다~~ → **0016 에서 완료.** 단 **함수는 넷이 아니라 셋**이었다 — `0005:96` 의 `claim_pending_notifications(int)` 는 `0014` 가 이미 지웠고 2-인자 판은 처음부터 `public, pg_temp` 다. ✅
- ~~`tests/write-privileges.test.ts` 가 **상태코드 ≥400 이면 통과**로 본다~~ → **0017 (P5-13) 에서 완료.** 같은 파일의 거부 단언 13곳을 `expectPermissionDenied()`(상태코드 401·403 **그리고** PostgreSQL `42501`)로 바꾸고, **대조군**(없는 표 → 404 `PGRST205`)을 같은 블록에 둬 "거부" 와 "부재" 가 구분되는지 보인다. ✅ *(같은 형태가 `tests/admin-*.test.ts` 등 6파일에 아직 남아 있다 — 아래 새 후속 항목)*
- ~~🔴 **`reservations`·`notifications_log` 에도 `TRIGGER`·`REFERENCES` 가 남아 있다**~~ → **0017 에서 회수 완료.** 적용 전에 **실제로 붙여 봤고 붙었다**(아래 0017 절의 실측 원문). ✅
- ~~`anon` 이 `reservations`·`notifications_log` 에 **`select`** 를 갖고 있다~~ → **0017 에서 회수 완료.** 두 표를 `anon` 으로 읽는 경로가 코드에 하나도 없고(공개 경로는 전부 서비스 롤) 0009 의 세 정책은 전부 `to authenticated` 다. ✅
- **느슨한 거부 단언이 남은 파일들**: `tests/admin-auth.test.ts` · `tests/admin-reservations.test.ts` · `tests/admin-notifications.test.ts` · `tests/admin-notices.test.ts` · `tests/admin-popups.test.ts` · `tests/admin-routes.test.ts` · `tests/admin-gallery.test.ts` 에 `toBeGreaterThanOrEqual(400)` 이 남아 있다. 전부가 권한 거부는 아니다(Storage API 응답·중복키 409·RPC 부재 404 가 섞여 있어 일괄 치환하면 오히려 틀린 단언이 된다) — **한 건씩 무엇을 단언하려던 것인지 읽고** 권한 거부인 것만 `42501` 로 조인다. *(미착수)*

### 적용 후 확인 (원격)
같은 질의 다섯 개를 원격에서 돌려 **위 표와 같은 결과**인지 대조하고, 아래에 날짜·결과를 적는다.

> **원격 적용: 아직 하지 않았다 (2026-09-16).** CI 는 green 이고 적용 전 점검도 끝났다.
> `supabase db push --linked` 가 **자동 승인 정책(Production Deploy)에 막혔다.** 우회하지 않는다 — 사람이 판단할 자리다.
> 진행하려면 사용자가 그 명령을 승인하거나 직접 실행해야 한다. 그때까지 원격은 **0011 상태**이고, 그 상태에서도 사이트는 정상 동작한다(회수는 방어 강화이지 기능 요구사항이 아니다).

---

## 0014 — claim 채널 필터 (작성 완료, 독립 리뷰 **승인**, 원격 적용 대기)

`claim_pending_notifications` 에 채널 화이트리스트(`p_channels text[] default null`)를 넣어 **보낼 수 없는 채널의 행을 아예 집지 않게** 한다. 배경은 `docs/ops/known-defects.md` **D3**.
1-인자 구버전을 **먼저 `drop`** 한 뒤 2-인자를 만든다 — `create or replace` 에 파라미터를 더하면 Postgres 가 새 함수로 보고 구버전이 남아 1-인자 호출이 **모호(42725)** 해진다.

### 🔴 배포 순서 — **0014 원격 적용이 코드 배포보다 먼저다** (리뷰 K5)
`claimPending` 은 **항상** `p_channels` 를 함께 보낸다. 따라서 순서를 뒤집으면 배포된 코드가 아직 없는 2-인자 시그니처를 불러 **PostgREST 가 PGRST202/404 를 내고 통지 크론이 500** 이 된다(리뷰어 실측).
안전한 실패이긴 하다(발송이 잘못 나가는 것이 아니라 아예 안 돈다). 그래도 **순서를 지킨다**:
1. `supabase db push` 로 **0014 를 원격에 적용**
2. 그다음 코드 배포(Vercel)
3. 통지 크론을 `?dry=0` 으로 전환하는 것은 **그 뒤**

### ⚠️ 적용 경로 — `psql -f` 를 쓰지 마라 (리뷰 K1)
마이그레이션 파일에는 명시적 `begin/commit` 이 없다. `psql -f` 로 실행하면 **파일이 원자적이지 않아** 자기검증 블록이 `raise` 해도 앞서 실행된 문장이 남는다(리뷰어 실측: 가드가 멈췄는데 `anon` ACL 이 그대로 남았다).
**`supabase db push` 또는 대시보드 SQL Editor 로만** 적용한다(CLI 는 마이그레이션 하나를 한 트랜잭션으로 돈다). 저장소의 13개 마이그레이션 전부 같은 관례이므로 0014 가 새로 만든 위험은 아니다.

### 독립 리뷰가 실증한 것 (2026-09-16, 승인 · 치명 0 · 중대 0)
- **SQL 뮤테이션 7종 전부 자기검증에서 멈췄다** — `revoke` 제거 / `revoke`+`grant` 제거 / `revoke` 를 `create` 앞으로 / 채널 필터 제거 / 1-인자 `drop` 제거 / `service_role` 회수.
- **로컬에도 같은 기본 권한이 실재**함을 `pg_default_acl` 로 확인했다(원격만의 문제가 아니다).
- 채널 인자 **9가지**(`null`·`{sms}`·`{email}`·`{sms,email}`·`{}`·`{bogus}`·`{alimtalk}`·`{sms,sms}`·`{null}`)를 직접 돌려, 집히지 않은 행은 `attempts` 는 물론 **`updated_at` 까지 불변**이고 **어떤 입력도 "전 채널" 로 승격되지 않음**(fail-closed)을 확인했다.
- 타입 뮤테이션 **10종 전부 검출**(미검출 0).

### 남은 권고 (후속)
- **K2**: 롤백이 `set search_path = public`(pg_temp 없음)을 되살린다 — temp 표 섀도잉을 실증 재현했다. EXECUTE 가 `service_role` 뿐이라 악용성은 낮다. `0005`·`0007` 의 같은 문제와 **함께** 고친다.
- **K3**: `expect([401,403,404]).toContain(...)` 가 "함수 없음(404)" 과 "권한 없음(401/42501)" 을 구분하지 못한다. 좁힐 것.
- **K4**: 롤백 검증 블록에 `service_role` 실행 가능 확인이 빠졌다(상행에는 있다).
- **K7**: Resend 가 `Idempotency-Key` 를 지원한다 — `WorkerReport.sentUnmarked` 의 중복 수신 창을 메일 채널에서 한 줄로 닫을 수 있다.
- 보고서 §4 를 "가정" → "문서 확인" 으로 갱신(리뷰어가 Resend 공개 문서로 엔드포인트·인증·본문 필드·성공 `id` 4건을 대조해 전부 정확함을 확인했다).

---

## 0016 — RLS 가 막지 못하는 권한 회수 (작성 완료, 원격 적용 대기)

**무엇을 하나**: 0012·0013 이 닫은 것은 **쓰기 네 동작**뿐이었다. 남은 `TRUNCATE`·`TRIGGER` 는 RLS 가 관여하는 종류의 권한이 아니다 — TRUNCATE 는 행을 하나씩 보지 않아 정책 평가가 일어나지 않고, TRIGGER 는 `CREATE TRIGGER` 를 허용한다. 즉 그 둘에 대해서는 **"RLS 가 유일한 방어선" 조차 아니고 아무 방어선도 없었다.**

1. 콘텐츠 7표에서 `authenticated` 의 **TRUNCATE·TRIGGER·REFERENCES** 회수
2. 같은 7표에서 `anon` 의 **TRIGGER·REFERENCES** 회수 (네 동작은 0013 이 가져갔다)
3. `places` 에서 `authenticated` 의 **insert·update·delete** 회수 — 관리자 쓰기 정책이 없고(0009 는 여섯 표) 코드 경로도 없다. **`select` 는 남긴다.**
4. definer 함수 **셋**(`mark_notification_sent`·`mark_notification_failed`·`reap_stale_notifications`)의 `search_path` 를 `public, pg_temp` 로. **`create or replace`** 만 쓴다(drop 하면 기본 권한이 EXECUTE 를 공개 롤에 다시 부여한다).

### 🔴 `claim_pending_notifications` 는 **건드리지 않는다**
후속 목록이 `0005:96` 을 포함해 "함수 넷" 으로 적었는데 **그 함수는 이미 없다.** `0014` 가 1-인자 판을 `drop` 하고 2-인자 판을 만들었으며 그쪽은 처음부터 `public, pg_temp` 다. 0016 에서 1-인자 형태를 `create or replace` 하면 **없던 함수를 새로 만드는 것**이 되어 두 판이 공존하고, `claim_pending_notifications(10)` 호출이 **모호(42725)** 해져 발송기가 통째로 멈춘다(0014 §4 ①). 0016 의 자기검증 ⑥ 이 그 상태를 매번 다시 확인한다.

### TRIGGER 가 무력하지 않다는 근거 (0012 헤더 정정의 실측)
`CREATE TRIGGER` 는 ⓐ 표의 TRIGGER 권한과 ⓑ **이미 존재하는** 트리거 반환 함수의 EXECUTE 만 요구한다. ⓑ 가 이 DB 에 실재한다:
```sql
select n.nspname||'.'||p.proname, has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.prorettype = 'pg_catalog.trigger'::regtype
  and (has_function_privilege('anon', p.oid,'execute') or has_function_privilege('authenticated', p.oid,'execute'));
```
로컬 실측 22건 — 그중 **`supabase_functions.http_request`**(행이 바뀔 때마다 외부 URL 로 HTTP 호출)가 `anon`·`authenticated` 모두 `execute=true`.

### 적용 전 확인 질의 (0016 판 — 컬럼 단위 grant 와 PUBLIC 까지 본다)
`information_schema.role_table_grants` 를 **증거로 쓰지 않는다**(필터된 뷰). 아래 여덟 가지를 한 문장으로 묻는 질의가 `tests/write-privileges.test.ts` §9 에 그대로 들어 있다 — 원격에서는 그 SQL 을 SQL Editor 에 붙여넣어 같은 결과인지 대조한다.

| # | 기대 문자열 | 뜻 |
|---|---|---|
| ① | `RLS_BLIND_NONE` | 7표에 `authenticated` 의 truncate/trigger/references 0 (컬럼 단위 references 포함) |
| ② | `ANON_SELECT_ONLY` | 7표에서 `anon` 은 select 만 |
| ③ | `PLACES_WRITE_NONE` · `PLACES_READ_OK` | places 쓰기 0 · 두 롤의 읽기 생존 |
| ④ | `PG_TEMP_OK` | 함수 셋의 `proconfig` 에 `pg_temp` |
| ⑤ | `FN_EXEC_ONLY_SERVICE` | 그 셋의 EXECUTE 보유자는 `service_role`(+소유자) 뿐 |
| ⑥ | `FN_SERVICE_OK` | `service_role` 이 여전히 실행할 수 있다(발송기) |
| ⑦ | `CLAIM_ONE_ARG_GONE` | 1-인자 claim 이 되살아나지 않았다 |
| ⑧ | `ADMIN_OK` · `SEQ_OK` | 콘텐츠 6표 CRUD 와 시퀀스 usage 생존 = **관리자 화면이 살아 있다** |

### 로컬 실측 (2026-09-16, P5-12 구현)
적용 전 → 후, `has_table_privilege` 전수:

| 표 | 롤 | 적용 전 | 적용 후 |
|---|---|---|---|
| 콘텐츠 6표 | `authenticated` | delete, insert, references, select, trigger, truncate, update | **delete, insert, select, update** |
| 콘텐츠 6표 | `anon` | references, select, trigger | **select** |
| `places` | `authenticated` | (위와 같음 7종) | **select** |
| `places` | `anon` | references, select, trigger | **select** |
| 9표 | `service_role`·`postgres` | 7종 전부 | **변화 없음** |

함수 셋: `{search_path=public}` → `{"search_path=public, pg_temp"}`, EXECUTE 보유자 `postgres,service_role` **불변**.

### 적용 경로
`supabase db push` 또는 SQL Editor. **`psql -f` 를 쓰지 마라**(리뷰 K1 — 파일이 원자적이지 않아 자기검증이 `raise` 해도 앞 문장이 남는다). 실제로 0016 을 만들면서 `supabase db reset` 이 **문장 단위로** 적용하다 6번째 문장에서 멈추는 것을 봤다(그 시점에 §1~§4 는 이미 적용돼 있었다) — 같은 성질이다.

### 롤백
`supabase/rollbacks/0016_privileges_rls_cannot_protect.down.sql` · **승인 플래그 요구**(`set bestour.rollback_0016_ack = '1';`). 근거: 되돌린 뒤의 세계가 **조용히** 위험하다(TRUNCATE 는 RLS 밖, TRIGGER 는 외부 유출, `pg_temp` 없는 `search_path` 는 엉뚱한 표를 고치고 성공을 돌려준다). 되돌린 것을 필요로 하는 정상 경로는 하나도 없다.

> **원격 적용: 아직 하지 않았다 (2026-09-16).** 0012~0016 이 함께 대기 중이다(원격은 0011 상태).

---

## 0017 — 개인정보 두 표의 TRIGGER·REFERENCES 와 `anon` SELECT 회수 (작성 완료, 원격 적용 대기)

**무엇을 하나**: 0016 은 브리프가 못박은 **콘텐츠 일곱 표**만 다뤘다. 같은 구멍이 `reservations`(고객 성명·전화번호·이메일·문의내용)·`notifications_log`(수신처·문자 본문)에도 남아 있었고, **그쪽이 더 위험하다.**

1. 두 표 × `anon`·`authenticated` 에서 **TRIGGER·REFERENCES** 회수
2. 두 표에서 **`anon` 의 SELECT** 회수 (`authenticated` 의 SELECT 는 남긴다 — 관리자 화면이 읽는다)

함수·정책·데이터는 건드리지 않는다. `drop function` 도, `create or replace function` 도 없다.

### 🔴 이것은 이론이 아니다 — 적용 **전에** 붙여 봤고, 붙었다 (2026-09-16 로컬 실측)
`set local role <롤>` 뒤 `supabase_functions.http_request` 트리거를 `CREATE TRIGGER` 로 붙이는 시도(마지막에 `raise` 로 전부 롤백):
```
[anon → reservations]          CREATE TRIGGER 성공
[anon → notifications_log]     CREATE TRIGGER 성공
[authenticated → reservations] CREATE TRIGGER 성공
[authenticated → notifications_log] CREATE TRIGGER 성공
```
0017 적용 **후** 같은 시도:
```
[anon → reservations]          거부 SQLSTATE=42501 MESSAGE=permission denied for table reservations
[anon → notifications_log]     거부 SQLSTATE=42501 MESSAGE=permission denied for table notifications_log
[authenticated → reservations] 거부 SQLSTATE=42501 MESSAGE=permission denied for table reservations
[authenticated → notifications_log] 거부 SQLSTATE=42501 MESSAGE=permission denied for table notifications_log
```
`CREATE TRIGGER` 는 표의 TRIGGER 권한 + **이미 존재하는** 트리거 함수의 EXECUTE 만 요구한다(스키마 CREATE 도, 소유권도 불필요). `supabase_functions.http_request` 는 `anon`·`authenticated` 모두 `execute=true` 다.

### `anon` 의 SELECT 를 회수한 근거
0012 의 "select 는 회수하지 않는다" 는 **관리자 화면이 읽는다** 였고, 그것은 `authenticated` 에만 해당한다. 두 표를 `anon` 으로 읽는 경로가 코드에 **하나도 없다**: `lib/queries/recent.ts`·`lib/reservation-check/db.ts`·`lib/notify/vars.ts`·`lib/retention/purge.ts` 전부 **서비스 롤**이고, 관리자 목록·발송 내역은 `authenticated`(SSR 세션)다. 0009 의 세 정책(`reservations_admin_select`·`reservations_admin_update`·`notifications_log_admin_select`)도 전부 `to authenticated` 다.

**거동 변화**: PostgREST 가 `200 []` 대신 **`401` + `42501`** 을 낸다. 그 0행은 *정책이 없어서* 나오던 결과라, 누가 `anon` 용 select 정책을 한 줄 붙이면 고객 표가 공개됐다 — 이제 정책과 무관하게 권한에서 먼저 막힌다. 바뀐 단언: `tests/notify-vars.test.ts` 의 "anon 키로는 0행" → "권한 거부(42501)".

### 적용 전/후 확인 질의 (0017 판 — 여덟 가지를 한 문장으로)
`tests/write-privileges.test.ts` §12 의 SQL 을 그대로 SQL Editor 에 붙여 넣어 대조한다.

| # | 기대 문자열 | 뜻 |
|---|---|---|
| ① | `PII_BLIND_NONE` | 두 표에 `anon`·`authenticated` 의 trigger/references 0 (컬럼 단위 references 포함) |
| ② | `ANON_PII_NONE` | `anon` 은 두 표에서 **일곱 동작 전부** 없음(select 까지) |
| ③ | `ADMIN_READ_OK` | `authenticated` 의 select 는 표·컬럼 단위 모두 생존 = 관리자 화면이 산다 |
| ④ | `SERVICE_OK` | `service_role` 의 일곱 동작 불변 = 접수·enqueue·발송기·파기가 산다 |
| ⑤ | `PII_COLUMN_NONE` · `PII_PUBLIC_NONE` | 컬럼 단위 grant 0 · PUBLIC 상속 0 |
| ⑥ | `OUTBOX_FN_ONLY_SERVICE` · `OUTBOX_FN_SERVICE_OK` | 아웃박스 definer 함수 **넷**의 EXECUTE 보유자는 `service_role`(+소유자) 뿐이고 실행 가능 |
| ⑦ | `PII_NO_USER_TRIGGER` | 두 표에 사용자 트리거 0 |
| ⑧ | (같은 파일의 거동 테스트) | `anon`·`authenticated` 의 `CREATE TRIGGER` 4회가 **42501**, `service_role` 2회는 **성공**(대조군) |

### 로컬 실측 (2026-09-16, P5-13 구현)
| 표 | 롤 | 적용 전 | 적용 후 |
|---|---|---|---|
| `reservations`·`notifications_log` | `anon` | references, select, trigger | **(없음)** |
| `reservations`·`notifications_log` | `authenticated` | references, select, trigger | **select** |
| 같은 두 표 | `service_role`·`postgres` | 7종 전부 | **변화 없음** |

PUBLIC 롤 grant 0 · 따로 부여된 컬럼 ACL 0(`pg_class.relacl`·`pg_attribute.attacl` 을 `aclexplode` 로 전수) — 적용 전후 모두.

### 적용 경로
`supabase db push` 또는 SQL Editor. **`psql -f` 를 쓰지 마라**(리뷰 K1).
⚠️ 자기검증 ⑦ 이 `set local role` 로 롤을 바꿔 `CREATE TRIGGER` 를 시도한다 — **적용하는 롤이 `anon`·`authenticated`·`service_role` 의 멤버여야 한다**(`postgres`/`supabase_admin` 은 멤버다). 아니면 마이그레이션이 "롤 전환 실패" 로 **명시적으로 멈춘다**(조용히 건너뛰지 않는다).
✅ 탐침 뒤 복원은 `reset role` 이 아니라 **캡처한 적용 롤로 `set local role`** 한다(2026-09-17 수정, GPT 검증 P2 — 0018 과 같은 형태). 로컬 실측 세 방식 통과: postgres 로그인 · supabase_admin 로그인 + `set role postgres` · supabase_admin 로그인 그대로. 수정 전 파일은 두 번째 방식에서 멈췄다.

### 롤백
`supabase/rollbacks/0017_pii_tables_trigger_references.down.sql` · **승인 플래그 요구**(`set bestour.rollback_0017_ack = '1';`). 근거: 되돌리면 `http_request` 트리거로 **접수마다 고객 개인정보가 외부로 나가는** 경로가 오류·로그·화면 변화 없이 다시 열린다. 되돌린 것을 필요로 하는 정상 경로는 하나도 없다.

> **원격 적용: 아직 하지 않았다 (2026-09-16).** 0012~0017 이 함께 대기 중이다(원격은 0011 상태).

---

## 0018 — 공개 롤의 시퀀스 권한 회수 (작성 완료, 원격 적용 대기)

**출처**: 사람이 아니라 **P6-11 게이트**(`tests/db-privilege-gate.test.ts`)가 첫 실행에서 36건을 이름으로 대며 찾았다. 기본 권한이 새 객체를 공개 롤에 여는 같은 뿌리의 **다섯 번째 사례**다.

1. `anon` — 일곱 시퀀스(`notices`·`popups`·`gallery`·`gallery_albums`·`showcase_routes`·`vehicles`·`notifications_log` `_id_seq`)에서 usage·select·update **전부**
2. `authenticated` — 일곱 시퀀스에서 select·update
3. `authenticated` — `notifications_log_id_seq` 에서 usage 도

🔴 **남기는 것: `authenticated` 의 콘텐츠 여섯 시퀀스 `usage`.** 관리자 화면의 insert 가 serial 기본값으로 `nextval` 한다. 이것을 잃으면 **표 insert 권한은 멀쩡한데 저장만 `42501 permission denied for sequence …` 로 실패**한다(로컬에서 일부러 회수해 봤더니 `gallery_albums` insert 가 403 이었다).
`service_role`·`postgres` 불변 — 통지 적재(서비스 롤)와 0010 definer 함수(소유자)가 `notifications_log_id_seq` 를 `nextval` 한다. 표·함수 권한은 건드리지 않는다.

**왜 회수하나**: `update` = `setval()`. `notifications_log_id_seq` 를 되감으면 이후 통지 적재가 **기본키 중복으로 전부 실패**한다 — 접수는 되는데 문자가 한 통도 나가지 않고, `setval` 은 행을 바꾸지 않아 흔적도 없다. 오늘 PostgREST 로 부를 경로는 없지만(`/rpc/setval`·`/rpc/nextval` → 404 PGRST202, `write-privileges` §5 가 매번 확인) "경로가 없으니 괜찮다" 는 0017(TRIGGER)에서 이미 틀렸다.

### 로컬 실측 (2026-09-17, P5-14 구현 · `has_sequence_privilege` 실효값)
| 시퀀스 | 롤 | 적용 전 | 적용 후 |
|---|---|---|---|
| 콘텐츠 여섯 | `anon` | usage, select, update | **(없음)** |
| 콘텐츠 여섯 | `authenticated` | usage, select, update | **usage** |
| `notifications_log_id_seq` | `anon`·`authenticated` | usage, select, update | **(없음)** |
| 일곱 전부 | `service_role`·`postgres` | usage, select, update | **변화 없음** |

`relacl` 부여자는 로컬에서 `postgres` 하나였다. PUBLIC(grantee 0) grant 0 — 적용 전후 모두. 적용 전후 권한 사실(표·컬럼·함수·정책·트리거 전수) diff 는 **시퀀스 7줄뿐**이었고 시퀀스 값도 그대로였다.
⚠️ **원격은 부여자가 다를 수 있다**(CLAUDE.md §3 — `postgres`·`supabase_admin` 둘). `revoke` 는 실행 롤이 준 grant 만 지운다. 자기검증 ① 이 부여자와 무관한 실효값을 보므로 남으면 **적용이 멈춘다** — 그때는 힌트의 `aclexplode` 질의로 부여자를 확인할 것.

### 자기검증 (마이그레이션 안의 DO 블록 — 실행 순서대로)
| 순서 | 항 | 멈추는 조건 |
|---|---|---|
| 1 | ④ PUBLIC | public 스키마 시퀀스에 PUBLIC grant 가 있다 — **① 보다 먼저** 본다(상속된 권한을 anon 의 것으로 오진하지 않게) |
| 2 | ① 행렬 | public 스키마 **모든** 시퀀스(카탈로그 열거)에서 `anon`·`authenticated` 권한이 콘텐츠 6 × `authenticated.usage` 밖에 있다 |
| 3 | ② 관리자 | 콘텐츠 여섯 중 하나라도 `authenticated.usage` 가 없다 |
| 4 | ③ 서비스 롤 | `service_role`·`postgres` 가 일곱 × 셋 중 하나라도 잃었다 |
| 5 | ⑤ 거동 | `set local role` 로 `anon`·`authenticated` 가 되어 `setval`(**현재 값 그대로**)·`nextval` 을 쳐서 42501 이 아니면 멈춘다. 대조군: 권한을 준 임시 시퀀스에서 같은 문장이 성공해야 한다(서브트랜잭션째 되돌림) |

로컬에서 각 항을 **일부러 깨뜨려** 전부 멈추는 것을 확인했다(P5-14 보고서 ⑤ — 7변형, 멈추지 않은 것 0).

### 적용 경로
`supabase db push` 또는 SQL Editor. **`psql -f` 를 쓰지 마라**(리뷰 K1). 로컬 단건 적용은 `psql -1`(단일 트랜잭션).
⚠️ 자기검증 ⑤ 가 `set local role` 로 롤을 바꾼다 — **적용하는 롤이 `anon`·`authenticated` 의 멤버여야 한다**(0017 과 같다). 아니면 "롤 전환 실패" 로 명시적으로 멈춘다.
⚠️ ⑤ 의 대조군은 `public.p0018_probe_seq` 를 **만들었다 되돌린다**(커밋되지 않는다). 적용 롤에 public 스키마 CREATE 가 필요하다(`postgres` 는 있다).
⚠️ 탐침 뒤 롤 복원은 `reset role` 이 아니라 **캡처한 적용 롤로 `set local role`** 한다(GPT 검증 P2). 로컬 실측 세 방식 모두 통과: postgres 로그인 · supabase_admin 로그인 + `set role postgres` · supabase_admin 로그인 그대로.
~~🔴 **0017 에는 같은 결함이 남아 있다**~~ → **0017 도 같은 두 줄로 고쳤다 (2026-09-17, P5-14 후속).** 수정 전에는 supabase_admin 로그인 + `set role postgres` 로 적용하면 `0017: 탐침이 롤을 되돌리지 못했다 (current_user=supabase_admin · 기대=postgres)` 로 멈췄다(로컬 재현). `db push` 가 0012~0018 을 한 번에 미므로 0017 이 멈추면 0018 까지 막혔을 것이다. 수정 후 세 방식 모두 통과. ✅

**🔴 적용 직전 스냅샷 (필수 절차)** — 0018 롤백은 이전 ACL 이 아니라 **기본 기준선**(anon·authenticated 전권)으로 복원한다(롤백 헤더). 원격 적용 **직전** 아래를 실행해 결과를 이 절에 날짜와 함께 붙여 둔다:
```sql
select c.relname, c.relacl
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'S' order by 1;
```
기대(기준선): 일곱 개 모두 `anon=rwU`·`authenticated=rwU` 를 포함. **다르면**(이미 좁혀진 권한이 있으면) 롤백 파일의 부여 목록을 스냅샷에 맞게 고쳐 둔다 — 아니면 롤백이 0018 이 지운 적 없는 권한까지 연다.
부여자(`/postgres`)도 함께 본다 — `supabase_admin` 부여가 섞여 있으면 0018 의 자기검증 ① 이 적용을 멈춘다(위 "부여자" 경고).

### 적용 전/후 확인
`tests/write-privileges.test.ts` §15 의 SQL 을 SQL Editor 에 붙여 넣는다. 기대 문자열: `SEQ_NONE` · `ADMIN_SEQ_OK` · `SERVICE_SEQ_OK` · `SEQ_PUBLIC_NONE` · `SEQ_COUNT 7`. 같은 절의 거동 DO 블록이 오류 없이 `DO` 로 끝나야 한다.

### 롤백
`supabase/rollbacks/0018_sequence_privileges.down.sql` · **승인 플래그 요구**(`set bestour.rollback_0018_ack = '1';`). **복원 대상은 기본 기준선이다 — 실행 전에 위 스냅샷과 대조할 것.** 0012~0017 롤백도 같은 방식(상행이 회수한 고정 목록을 조건 없이 부여)이다. 근거: 되돌리면 공개 롤이 `setval` 로 통지 시퀀스를 되감는 문이 오류·로그·화면 변화 없이 다시 열린다. 되돌린 것을 필요로 하는 정상 경로는 없다(앱 코드는 시퀀스를 직접 부르지 않는다).
로컬 실측: 플래그 없이 실행 → 멈춤(exit 3, 권한 불변). 플래그와 함께 실행 → 적용 전 실효 권한으로 복원되고 **게이트가 다시 36건으로 빨개졌다**. 0018 재적용 뒤 사실 전수 diff 동일.
⚠️ 관리자 "새 글 저장" 이 죽어서 롤백을 생각한다면 원인은 0018 이 아닐 가능성이 높다 — 0018 은 콘텐츠 여섯의 `authenticated` usage 를 남긴다. 먼저 `has_sequence_privilege('authenticated', 'public.notices_id_seq', 'usage')` 를 볼 것.

> **원격 적용: 아직 하지 않았다 (2026-09-17).** 0012~0018 이 함께 대기 중이다. 로컬 `supabase_migrations.schema_migrations` 에도 0018 은 **기록되지 않았다**(`psql -1` 파일 적용 — `db reset` 금지 조건 때문). 다음 `db reset` 이나 CI 는 파일에서 정상 적용한다.
