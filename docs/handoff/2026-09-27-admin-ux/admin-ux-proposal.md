# ADMIN-UX — 관리자 화면 UIUX 진단 + 개선안 (리서치·제안, 구현 아님)

- 작성: 2026-09-27 · 브리프 `ADMIN-UX-brief.md` · 저장소 코드 변경 0 · 커밋 0
- 산출물: 이 문서 · `ADMIN-UX-mockup.html`(시안) · `ADMIN-UX-shots/`(현재 43장 + 시안 16장)
- 실측 환경: 로컬 스택 + 사본 서버 `127.0.0.1:3003` · **정상 매직링크 로그인**(로컬 Mailpit) · 예시 데이터 8건 + 공지 2건 → 촬영 뒤 전부 삭제 (절차·정리는 부록 A)
- 동시 작업과의 경계: **P5-18**(화면 전환 속도 — `loading.tsx` 스켈레톤·`cache()`·쿼리 병렬화·탭 prefetch·지역 `icn1`)과 **P7-3**(Pretendard 전면 적용)이 지금 돌고 있다. 이 문서는 그 둘을 **다시 진단하지 않고 그 위에 쌓는다**. 관리자 파일이 겹치므로 아래 구현은 두 태스크가 들어간 뒤 **직렬로** 한다(CLAUDE.md §6 서브에이전트 규칙).

---

## ① 요약 (5줄)

1. **로그인하면 매번 도착하는 첫 화면이 비어 있다.** `/admin` 은 "관리자" 세 글자뿐이다. 새 접수 수, 오래 기다린 접수, 문자 실패 중 무엇도 보이지 않는다(`current-home-*.png`).
2. **휴대폰에서 핵심 업무가 안 된다.** 접수 목록은 10열 표(1198px)를 341px 창으로 본다. 그래서 첫 화면에 **접수 일시·접수번호 2열만** 보이고, 이름·전화·상태는 가로 스크롤 뒤에 있다. 상세에서 **확정 버튼은 2.1화면 아래**, 전화번호는 **18px 높이의 점선 글자**다. 공지 목록은 오른쪽이 **잘려 수정·노출 버튼이 아예 안 보인다**. 이 넘침은 `body{overflow-x:hidden}`에 가려져 "가로 스크롤 없음" 검사를 통과한다.
3. **되돌릴 수 없는 취소가 한 번 누르면 끝난다.** 실측에서 확인 창 0회, `new → cancelled`, 되돌리기 없음. 게다가 취소해도 **고객에게 문자가 가지 않는데** 화면은 그 사실을 알려 주지 않는다.
4. **개선 방향: "오늘 할 일 → 전화 → 확정"** 한 줄기. 레퍼런스는 카페24 "오늘의 할 일", 네이버 예약 상태 틀·빠른 찾기, Airbnb Today, Shopify 2열 상세·배지 톤, 토스 하단 고정 버튼·"닫기" 규칙, WordPress 상태 링크+건수다.
5. **내비는 데스크톱 좌측 사이드바 + 휴대폰 하단 탭 4개(홈·접수·홈페이지·기록).** 1단계(DB 변경 없음, M 4개·S 4개)에서 홈 대시보드·목록 카드화·상세 재배치·확인 시트·내비를 바꾸면 체감의 대부분을 얻는다.

---

## ② 현재 문제 목록 (심각도순)

심각도: **P0** 핵심 업무가 막히거나 되돌릴 수 없는 실수를 부른다 · **P1** 매일 겪는 큰 마찰 · **P2** 눈에 띄는 마찰 · **P3** 다듬기
수치는 사본 3003을 Playwright로 잰 값이다. 측정 JSON은 스크래치에만 두었다가 정리 때 지웠고, 쓰는 수치는 이 표와 ⑧에 옮겨 두었다.

| # | 심각도 | 문제 | 근거 (스크린샷 · 파일:줄 · 실측값) |
|---|---|---|---|
| 1 | **P0** | **관리 홈이 비어 있다.** 매직링크 콜백이 보내는 첫 화면(`/admin`)에 "관리자" 한 줄뿐이다. 여백·제목 스타일도 없다. 어느 탭도 선택되지 않고, 내비에 '홈' 링크가 없다. 목업에 있던 요약 카드 4개(신규·확정 대기·이번 주 운행·이번 달 완료)가 이식되지 않았다. | `current-home-1280.png` · `current-home-375-fold.png` · `app/admin/(protected)/page.tsx:7,15-19`(자리표시자) · `lib/auth/adminLogin.ts:20` + `app/admin/auth/callback/route.ts:40`(로그인 후 항상 여기로 옴) · `components/admin/tabs.ts:11`(홈 항목 없음) · `mockups/admin.html:832-849` |
| 2 | **P0** | **휴대폰 목록이 "누가·언제·상태"를 못 보여 준다.** 표 최소 폭 68rem(1088px) → 375px에서 표 1198px 중 **341px만** 보이고 **10열 중 2열**(접수 일시·접수번호)만 온전하다. 고객명·전화·상태·상세 보기는 표 안 가로 스크롤 뒤에 있다. 전화 링크는 x=460(화면 밖). 첫 화면의 약 60%가 탭 3줄·제목·필터 2줄이다. | `current-reservations-375-fold.png` · `admin.module.css:139-144`(`.table{min-width:68rem}`) · `reservations/page.tsx:97-167` · 실측 `tableWrap 341/1198`, `visibleCols 2/10` |
| 3 | **P0** | **취소가 한 번에 끝나고 되돌릴 수 없다.** 확정(114×44)과 취소(118×44)가 16px 간격으로 나란하다. 취소는 확인 없이 바로 실행된다(실측 dialog **0회**). 실행 뒤 버튼이 사라져 되돌릴 수 없다(0010에 역전이 없음). 통화하며 한 손으로 누르다 틀리면 복구할 길이 없다. 반면 **공지 삭제는 2단계**(무장 체크 + `window.confirm`)다. 고객 예약 취소가 공지 삭제보다 쉬운 셈이다. | `current-detail-actions-before-cancel-375.png` → `current-detail-after-cancel-375.png` · `components/admin/ReservationActions.tsx:72-74,101-111` · 비교 `components/admin/NoticeForm.tsx:76,110-111,241-252` |
| 4 | **P1** | **취소해도 고객에게 아무 연락이 가지 않는데 화면이 말하지 않는다.** 통지 템플릿은 접수 3종 + 확정 1종뿐이고 취소 문자는 없다. 결과 문구는 "취소 처리했습니다." 한 줄이다. 사장님이 전화로 알려야 한다는 안내가 없다. | `lib/notify/outbox.ts:109-114`(`TEMPLATE_KEYS`) · `messages/ko.json` `admin.detail.result.cancelled` |
| 5 | **P1** | **상세에서 가장 중요한 두 행동(전화·확정)이 가장 멀다.** 제목은 접수번호다("예약 상세 · EXQ7M2A1"). 사장님이 기억하는 건 이름·날짜·구간이다. 구역 순서는 고객 → 운행 → 접수 조건 → **동의·보유** → 처리다. 확정 버튼은 375px에서 y=1673(**2.1화면 아래**), 1280px에서 y=1223(1.5화면)에 있다. 전화번호는 **102×18px 점선 텍스트 링크**이고, 전화·문자 버튼은 없다. | `current-detail-quick-375.png` · `current-detail-wizard-1280.png` · `reservations/[id]/page.tsx:108-117`(제목) · `:119-295`(구역 순서) · `:297-322`(처리 맨 끝) · `admin.module.css:190-197`(`.telLink`) |
| 6 | **P1** | **간편 접수의 "전화로 확인할 것"을 챙길 곳이 없다.** 간편 접수는 차량·여행 구분·운행 구분·대수 4칸이 "미정(전화 확인)"이고, 출발 시각은 날짜만 있다. 그런데 통화로 확인할 항목 목록이 없고, 확인한 값을 넣을 칸도 없다. 자유 메모뿐이다. 긴 설명 한 줄(`intakeQuick`)이 375px 값 칸에서 6줄로 꺾인다. | `current-detail-quick-375.png` · `ko.json:566` · `reservations/[id]/page.tsx:152-225` · `admin.module.css:300-306`(라벨 칸 10.5rem 고정) |
| 7 | **P1** | **메모가 확정·취소와 따로 논다.** 메모를 쓰고 '확정하기'를 누르면 메모는 저장되지 않는다. 확정은 `confirmReservation(id)`로 메모 없이 부른다. 서버 액션은 이미 `memo` 인자를 받는다. 통화 메모를 잃기 쉽다. | `ReservationActions.tsx:84,106`(메모 미전달) · `actions/admin/reservation.ts:111,117`(`memo?` 지원) |
| 8 | **P1** | **내비가 휴대폰에서 매 화면 3줄(137px, 화면의 17%)을 먹는다.** 탭 높이는 34px(44 미만)이다. 건수 배지·홈 링크·브랜드가 없다. 매일 쓰는 '예약 현황'과 가끔 쓰는 '대표 노선 관리'가 같은 무게다. | 모든 `current-*-375-fold.png` · `admin.module.css:12-35`(`flex-wrap`) · 실측 `navH 137 · navRows 3 · itemH 34` |
| 9 | **P1** | **상태 표시가 "할 일"을 드러내지 않는다.** '신규'(처리 필요)는 테두리 배지이고 '확정'(처리 끝)은 **채운 보라**여서 끝난 건이 더 눈에 띈다. 채운 보라는 현재 탭·선택된 필터·확정 배지·노출 중 배지·주요 버튼 **5곳에서 서로 다른 뜻**이다. 필터에 건수가 없다. 72시간 넘게 기다린 신규(통계에는 있음)가 목록에서는 똑같아 보인다. 접수 일시가 절대시각이라 얼마나 기다렸는지 계산해야 한다. | `current-reservations-1280.png` · `admin.module.css:44-47,113-117,199-228,507-511` · `reservations/page.tsx:85-92`(건수 없음) · `stats/page.tsx:344-354`(`over_72h`) |
| 10 | **P1** | **전화 온 손님을 찾을 수 없다.** 검색이 없고 상태 필터 + 20건 페이지 넘김뿐이다. 되걸려 온 전화에 이름이나 번호 뒷자리로 접수를 찾는 일이 막힌다. | `reservations/page.tsx:62-65` · `lib/admin/reservations.ts:33`(`DEFAULT_ADMIN_PAGE_SIZE=20`) |
| 11 | **P1** | **결과 피드백이 작고 멀다.** 저장·확정·취소 결과는 버튼 옆이 아니라 처리 영역 맨 밑에 14px 한 줄(`role=status`)로 뜬다. 토스트가 없다(목업의 토스트도 빠짐). 취소 뒤에는 버튼이 사라지고 '처리' 제목만 남는다. | `current-detail-memo-saved-375.png` · `current-detail-after-cancel-375.png` · `ReservationActions.tsx:142-144` · `admin.module.css:404-415` · `mockups/admin.html:1031` |
| 12 | **P1** | **로그인이 휴대폰에서 끊기기 쉽다.** 매직링크는 PKCE라 **요청한 그 브라우저**에서 열어야 한다. 사장님 메일은 naver.com이라, 네이버 메일 앱처럼 앱 안 브라우저로 열면 "만료되었거나 이미 사용"으로 실패할 수 있다. 로컬 기본 메일 제목은 영어 "Your sign-in link"였다(운영 템플릿은 저장소 밖이라 확인 필요). 로그인 화면에는 브랜드가 없고 "받으/신"처럼 낱말이 쪼개진다. | `current-login-1280.png` · `ko.json:452,462` · `app/admin/auth/callback/route.ts`(exchangeCodeForSession) · 부록 A 로그인 출력 |
| 13 | **P1** | **공지 관리 화면이 휴대폰에서 오른쪽으로 잘린다 — 목록의 '수정'·'중지하기'가 보이지도 눌리지도 않는다.** 입력칸 오른쪽 테두리와 도움말 끝도 잘린다. 목록 제목 칸은 한 낱말씩 줄이 꺾인다("예시 / 공지 — / 추석 / …").<br>원인: `.popupGrid`는 1024px 미만에서 칸 정의가 없는 격자다. 격자 항목은 기본값 `min-width:auto`이고, 표 최소 폭 `.tablePopups{min-width:30rem}`(480px)이 칸을 화면보다 넓게 민다.<br>그런데 `html,body{overflow-x:hidden}`이 넘친 부분을 **감춘다**. 그래서 가로 스크롤조차 생기지 않고, "375px 가로 스크롤 없음" 검사도 **통과한다**(실측 `scrollWidth 375 = clientWidth 375`).<br>팝업 관리도 같은 격자·같은 표라 **행이 생기면 같은 증상**이다(촬영 때는 0행이라 빈 문구만 보임 — 코드 근거). | `current-notices-375.png` · `admin.module.css:422-427`(`.popupGrid`) · `:494-500`(`.tablePopups{min-width:30rem}`) · `app/globals.css:1-5`(`overflow-x:hidden`) · `notices/page.tsx:85-158` · `popups/page.tsx:58-150` |
| 14 | **P2** | **문자 발송 결과가 해당 예약에 안 보인다.** 확정 문자가 나갔는지는 '발송 내역' 탭에서 접수번호로 찾아야 한다. 실패 경보는 통계·발송 내역 두 탭에 흩어져 있고 홈에는 없다. | `current-notifications-1280.png` · `notifications/page.tsx:87-106` · `stats/page.tsx:357-389` |
| 15 | **P2** | **공지·팝업이 "항상 펼친 등록 폼 + 옆 목록"이다.** 등록 폼이 화면 절반(높이 1080px)을 늘 차지한다. 1024px 미만에서는 폼이 목록 위에 쌓여, 목록은 폼(약 1.4화면)을 지나야 나오고 페이지 전체는 2.1~2.4화면 길이가 된다. 빈 상태 문구 "**왼쪽에서** 등록해 주세요"는 그 폭에서 틀린다. 가장 잦은 '수정'은 작은 글자 링크인데 노출 토글은 큰 버튼이다. | `current-notices-1280.png` · `current-popups-375-fold.png` · `ko.json:594,659` · `admin.module.css:422-427,706-711` · `notices/page.tsx:85-158` |
| 16 | **P2** | **팝업 이미지를 "경로 문자열"로 입력한다**("/hero/bus-02.jpg"). 비개발자가 쓸 수 없는 UI이고 갤러리 업로드와 이어지지 않는다(목업엔 이미지 고르기 격자가 있었다). | `ko.json:599,607` · `components/admin/PopupForm.tsx:163-176` · `mockups/admin.html:888-891` |
| 17 | **P2** | **갤러리 카드마다 편집 컨트롤이 전부 펼쳐져 있다.** 사진 7장에 컨트롤 **64개**, 375px에서 **7.5화면**이다. 순서는 "90000" 같은 숫자 입력이다(목업은 ▲▼). 무장 체크박스 + 삭제 버튼이 카드마다 있다. | `current-gallery-1280.png` · `GalleryPhotoCard.tsx:184,221` · 실측 `interactive 64 · 6107px` · `mockups/admin.html:1399-1400` |
| 18 | **P2** | **대표 노선 표가 375px에서 표 안 가로 스크롤로 밀린다.** 5열 중 3열만 보이고, '노출 중' 배지가 반쯤 걸치며, 수정·중지 버튼은 표를 옆으로 밀어야 나온다. 이 표는 스크롤 상자 안이라 #13처럼 사라지지는 않는다. 순서도 숫자 입력이다. | `current-routes-375-fold.png` · 실측 `307/480 · 3/5열` |
| 19 | **P2** | **말투에 개발 용어가 섞였다.** "발송 대기열에 쌓입니다", "상행 일시", "상세 접수(옛 6단계)", "이미지 경로", "주소에 쓰는 이름". 사장님 기준 말이 아니다. | `ko.json:480,542,567,572,599,785` |
| 20 | **P2** | **다가오는 운행을 한눈에 볼 수 없다.** 확정 건을 운행일 순으로 보는 화면이 없다. 목업의 '이번 주 운행' 카드도 빠졌다. 협력사 배차 준비에 필요한 정보다. | `mockups/admin.html:841-844` · 목록은 접수순 고정(`reservations/page.tsx:65`) |
| 21 | **P3** | **타이포·간격 위계가 약하다.** 섹션 제목이 13px(본문 15px보다 작음)이다. 표 캡션과 섹션 제목이 같은 말을 두 번 한다("등록된 공지 목록"×2). 체크박스가 브랜드색이 아니다. 한국어 글꼴 미적용은 **P7-3이 처리 중**이다. 로딩 경계가 없는 것은 **P5-18이 처리 중**이다. | `admin.module.css:287-293` · `current-notices-1280.png` · `app/globals.css:7-9` |
| 22 | **P3** | **빈 상태가 모두 같은 회색 상자 한 줄이다.** 다음 행동(버튼)이 없다. 통계는 설명이 숫자보다 먼저 나와 3.1화면(1280)·4.7화면(375)이다. | `admin.module.css:231-239` · `current-stats-375-fold.png` |

> 참고 — 잘 되어 있어 **지켜야 할 것**:
> - URL엔 uuid만 둔다.
> - 개인정보를 props로 내리지 않는다.
> - 처리 중 버튼을 막는다(두 번 누름 방지).
> - `role=status`를 쓴다.
> - 사장님 글 경고 패널(copyWarning)
> - 삭제 2단계
> - 발송 내역 번호 가림
> - 통계의 소수 항목 가림과 "캡처해서 밖으로 보내지 마시라" 안내
>
> 개선안은 이 위에 얹는다.

---

## ③ 레퍼런스별 옮길 패턴 (출처 URL)

조사는 두 갈래(국내·해외)로 병렬로 했고, 공개 자료만 봤다(로그인 0).
- **[직접]**: 원문을 열어 확인했다.
- **[검색요약]**: 검색 결과 요약만 봤다.

주의할 점이 있다.
- 네이버 예약의 가장 자세한 공개 문서는 **2017년 파트너센터 매뉴얼**이다. 지금 화면과 다를 수 있다.
- polaris-react 문서는 접속이 끊겨 **같은 문서의 GitHub 원본 MDX**로 확인했다. 이 저장소는 2026-09-11에 아카이브됐다.

통계 화면 레퍼런스는 이미 `ADMIN-STATS-RESEARCH.md`에 있어 여기서 되풀이하지 않는다.

### 3-1. 네이버 스마트플레이스 · 예약 파트너센터 ★ 업무가 가장 가깝다
- **상태 틀**: 신청 → 확정 → 이용완료 / 취소 / 노쇼. 처리 버튼은 예약확정·예약취소·이용완료 [직접] — https://ssl.pstatic.net/adimg3.search/imp/resrv/manage/cdn/documents/manual/newpartner_v1.0.pdf
- **빠른 찾기(한 번 클릭)**: "오늘이용", "확정대기", "당일취소". 검색은 예약자·전화번호·예약번호 [직접] — 위 PDF
- **상세 5칸**: 고객정보 · 예약내역(요청사항 포함) · 결제정보 · **직원메모(내부용)** · **진행이력(언제·누가·무엇)**. 처음 온 고객은 "신규예약"으로 표시 [직접] — 위 PDF
- **확정 시 안내문 입력 + 알림 발송**, **취소 시 안내 필수 입력 + 알림 발송**. 같은 상태로 거른 뒤에만 일괄 처리 [직접] — 위 PDF
- **앱**: "지금 당장 확인해야하는 예약과 주문관리! 대시보드를 통해 바로 체크", 예약이 들어오면 푸시, 놓친 알림은 알림피드. v2.5.1(2024-08) "전화번호 길게 누르면 통화, 문자보내기", v2.5.3 "아래로 당겨 리프레시" [직접] — https://apps.apple.com/kr/app/id1521817390 · https://play.google.com/store/apps/details?id=com.naver.smartplace&hl=ko
- **주문 화면**: 카드뷰는 "가장 빨리 접수된 주문부터", 새 주문은 "붉은색으로 깜박" [직접] — https://booking.pstatic.net/shared/documents/manual/NAVER_%EC%A3%BC%EB%AC%B8_%ED%85%8C%EC%9D%B4%EB%B8%94%EC%84%9C%EB%B9%99%ED%98%95_%EB%A7%A4%EB%89%B4%EC%96%BC.pdf
- **→ 옮길 것**
  - 상태 라벨 4개 + 파생 "3일째 대기"
  - 목록 위 빠른 찾기(새 접수 · 오늘/이번 주 운행)
  - 이름·번호·접수번호 검색
  - 상세의 메모 + **문자 기록(진행이력)**
  - "이 번호로 받은 접수: 처음" 표시
  - 취소 시 안내·사유
  - 대기 목록은 **오래 기다린 순**

### 3-2. 카페24 쇼핑몰 관리자
- 관리자 메인 맨 위가 **"오늘의 할 일"**이다. 처리할 주문을 상태별 건수로 보여 주고, "각 주문 상태 별 건수 클릭 시, 해당 되는 메뉴와 주문 목록을 보여줍니다" [직접] — https://ecsupport.cafe24.com/web/upload/manual/ec/dsh/dsh0000001.html
- 행마다 **상태에 맞는 버튼만** 둔다(취소신청 행만 [처리]) [직접] — https://ecsupport.cafe24.com/web/upload/manual/ec/ord/ord1090002.html
- 일괄 취소는 **사유 팝업** 한 번으로 한다. 행에서 **SMS 바로보내기**를 할 수 있다 [직접] — https://ecsupport.cafe24.com/web/upload/manual/ec/ord/ord1010001.html
- 메모 아이콘을 고객(USER)과 관리자(ADMIN)로 구분한다 [직접] — https://serviceguide.cafe24.com/IN/ko_KR/OD.AO.html
- 2023년 개편은 "화면 너비가 조정되는 반응형"이다 [직접] — https://shopnotice.cafe24.com/view?no=347490&bbs_no=5
- 예전 모바일 관리자에는 "전화연결"이 있었지만 "PC 관리자에 비해 제한적"이었다 [직접] — https://ecsupport.cafe24.com/article/%EC%87%BC%ED%95%91%EB%AA%B0-%EA%B4%80%EB%A6%AC%EC%9E%90/5/1030/
- **→ 옮길 것**
  - 홈 맨 위 "오늘 할 일" 카드. **숫자 자체가 그 조건의 목록으로 가는 링크**다.
  - 상태에 맞는 버튼만 보인다.
  - 고객 요청사항과 사장님 메모를 시각적으로 구분한다.
  - 반응형 한 벌로 만든다(모바일 축소판을 따로 만들지 않는다).

### 3-3. 티스토리 블로그 관리
- 좌측 메뉴 그룹은 콘텐츠 / 댓글·방명록 / 꾸미기 / 플러그인 / 수익 / 통계 / 관리다 [직접] — https://brunch.co.kr/@77e09178f4bc470/1
- 관리 홈은 "오늘, 어제, 누적 방문 수"와 "최근 7일의 인기글, 유입 경로, 유입 키워드를 한 눈에" 보여 준다. 지표 중심이다 [직접] — https://notice.tistory.com/2466
- 목록 행에 마우스를 올리면 보조 버튼(통계)이 나타난다 [직접] — https://notice.tistory.com/2462
- 스팸 댓글은 휴지통으로 가고, 복원할 수 있으며, 15일 뒤 자동으로 지워진다 [직접] — https://notice.tistory.com/2661
- 폰에서는 별도 앱으로 알림·통계 카드를 본다 [직접] — https://apps.apple.com/kr/app/%ED%8B%B0%EC%8A%A4%ED%86%A0%EB%A6%AC-tistory/id906304982
- **→ 옮길 것**
  - 업무 묶음 사이드바(예약 / 홈페이지 / 기록)
  - 요약에서 상세로 바로 가는 링크
  - (2단계) 갤러리·공지 **휴지통·복원**
  - PC는 hover 보조 버튼, 모바일은 늘 보이게
  - 반면교사: 관리 홈이 "할 일"이 아니라 "지표"다. 우리 홈은 할 일이 먼저다.

### 3-4. Shopify Admin · Polaris
- **홈**: 작업별로 남은 건수를 보여 준다(Capture a payment, Fulfill an order …) [직접] — https://help.shopify.com/en/manual/shopify-admin/shopify-home
- **앱 홈 템플릿**: "주의가 필요한 항목"을 보여 주고, 배너는 한 번에 하나만 둔다 [직접] — https://shopify.dev/docs/api/app-home/latest/patterns/templates/homepage
- **페이지 헤더**: primary 1개 + secondary 3개 이하, "페이지 하단에 동작을 두지 말 것"(데스크톱 앱 기준) [직접] — https://shopify.dev/docs/api/app-home/web-components/layout-and-structure/page
- **상세 2/3 + 1/3**(작은 화면에선 한 열), 되돌릴 수 없는 동작은 Modal로 확인한다 [직접] — https://shopify.dev/docs/api/app-home/latest/patterns/templates/details · https://raw.githubusercontent.com/Shopify/polaris/main/polaris.shopify.com/content/patterns/resource-details-layout/variants/default.mdx
- **Table `variant="auto"`**: 넓으면 표, 좁으면 리스트다. 열마다 리스트 안에서의 역할(primary·kicker·labeled)을 준다 [직접] — https://shopify.dev/docs/api/app-home/web-components/layout-and-structure/table
- **Badge 톤·진행 아이콘**
  - Attention(주의·비치명) / Warning(시간에 민감) / Critical(치명·되돌릴 수 없음)
  - incomplete·partiallyComplete·complete를 **빈 원·반 원·꽉 찬 원**으로 그린다
  - 라벨은 1~2단어
  - 출처 [직접] — https://raw.githubusercontent.com/Shopify/polaris/main/polaris.shopify.com/content/components/feedback-indicators/badge.mdx · https://raw.githubusercontent.com/Shopify/polaris/main/polaris.shopify.com/content/design/colors/palettes-and-roles.mdx
- **모달 제목**: {동사}+{명사} 질문으로 쓴다("Delete customer?"). 버튼은 결과를 말하는 동사로 쓴다 [직접] — https://raw.githubusercontent.com/Shopify/polaris/main/polaris.shopify.com/content/components/deprecated/modal.mdx
- **Toast**
  - 기본 5초, 동작이 붙으면 10초 이상
  - "**오류는 토스트가 아니라 배너로**"
  - 출처 [직접] — https://raw.githubusercontent.com/Shopify/polaris/main/polaris.shopify.com/content/components/deprecated/toast.mdx · 배너 https://raw.githubusercontent.com/Shopify/polaris/main/polaris.shopify.com/content/components/feedback-indicators/banner.mdx
- **주문 상세 연락처**: 이메일·전화·문자 아이콘. 앱 아이콘 배지는 열린 주문 수 [직접] — https://help.shopify.com/en/manual/fulfillment/managing-orders/managing-order-details
- **반면교사**: Orders 메뉴 숫자(Open)와 홈 숫자(Unfulfilled)의 정의가 달라 판매자가 혼란스러워했다 [직접] — https://community.shopify.com/t/why-does-my-order-count-display-incorrectly-on-the-homepage/265968
- **→ 옮길 것**
  - 상세 2열(오른쪽 = 연락 + 처리 카드, 스크롤해도 보임)
  - 목록은 한 벌의 마크업으로 표 ↔ 카드
  - 배지는 글자 + 모양 + 톤 단계
  - 성공은 토스트, 실패는 배너
  - **메뉴 배지·홈 카드·목록 탭 건수를 한 정의(`status='new'`)로** 통일

### 3-5. Stripe Dashboard
- **배지 정의**: Warning = 즉시 조치 필요하지만 해결은 선택, **Urgent = 즉시 조치·해결 필수** [직접] — https://docs.stripe.com/stripe-apps/components/badge.md?app-sdk-version=9
- **내부 상태 7개 → 대시보드 라벨 몇 개**로 줄인다 [직접] — https://docs.stripe.com/payments/payment-intents/verifying-status
- **모바일**: 하단 탭 Home·Payments·Balances·Customers, 상세는 **하단 동작 바**(주요 동작 + ⋯) [직접] — https://docs.stripe.com/dashboard/mobile.md
- **토스트 vs 배너**: 토스트는 4단어 미만·최대 30자, 배너는 계속 남고 조치를 요구한다 [직접] — https://docs.stripe.com/stripe-apps/patterns/communicating-state.md
- **로딩**: 200~300ms 뒤에 스피너, 저장 버튼 pending(두 번 제출 방지) [직접] — https://docs.stripe.com/stripe-apps/patterns/loading.md
- **되돌리기**: 발송을 3초 늦춰 그 사이 취소 [직접] — https://docs.stripe.com/stripe-apps/components/toast.md?app-sdk-version=9
- **빈 상태**: "No transactions yet."처럼 이유를 쓰고 행동과 짝짓는다. 필터 결과 0건이면 '필터 지우기' [직접] — https://docs.stripe.com/stripe-apps/patterns/empty-state.md
- **검색**: 카드 끝 4자리·이메일·날짜, **검색어가 URL에 남음** [직접] — https://docs.stripe.com/dashboard/search
  - 우리는 **따르지 않는다**. URL에 개인정보를 두지 않는다는 규약 때문이다(아래 ⑤-2).
- **→ 옮길 것**
  - 상태 4 + 파생 1의 짧은 라벨
  - 모바일 상세 하단 동작 바
  - 배지 톤을 "조치가 필수인가" 기준으로 정의(오래 기다림·발송 실패 = 급함)
  - 빈 상태 두 종류

### 3-6. WordPress 관리자
- **상태 링크 + 건수**: "All (n) · Published (n) …", **건수 0인 상태는 링크를 뺀다** [직접] — https://developer.wordpress.org/reference/classes/wp_posts_list_table/get_views/ · https://wordpress.org/documentation/article/posts-screen/
- **Dashboard At a Glance**: 각 숫자가 해당 관리 화면 링크다 [직접] — https://wordpress.org/documentation/article/dashboard-screen/
- **메뉴 건수 버블**: 숫자는 `aria-hidden`, 스크린리더엔 "N Comments in moderation" 문장 [직접] — https://raw.githubusercontent.com/WordPress/wordpress-develop/trunk/src/wp-admin/menu.php
- **4.3부터 작은 화면 목록**: 대표 열만 보이고 나머지는 "Show more details". 이유는 "폰 사용자가 무엇을 할지 판단하려고 두 번째 화면을 열지 않게" [직접] — https://make.wordpress.org/core/2015/08/08/list-table-changes-in-4-3/
- **휴지통**: 30일 보관 뒤 영구 삭제, 그 전에 복구 불가 경고 [직접] — https://wordpress.com/support/trash/
- **→ 옮길 것**
  - 상태 탭 + 건수
  - 메뉴 배지 스크린리더 문장("새 접수 4건")
  - 모바일 목록은 "판단에 필요한 것"만 카드에 담는다(이름·구간·날짜·인원·상태·전화)

### 3-7. Airbnb 호스트 도구
- **Today 탭**: "하루를 계획하게 돕는" 첫 화면, 긴급한 순서로 4블록이다(시간에 민감한 알림 → 현재·예정 예약 → 다음 할 일 → 팁) [직접] — https://www.airbnb.com/resources/hosting-homes/a/exploring-your-hosting-tools-738 · https://www.rentalscaleup.com/what-airbnbs-new-today-host-tab-and-price-comparison-tool-with-booking-com-say-the-companys-priorities/
- **예약 카드**: "대화 목록을 찾을 필요 없이" **메시지·전화 버튼**, 호스트만 보는 **비공개 메모**, 요청에는 **24시간 카운트다운** [직접] — https://www.airbnb.com/resources/hosting-homes/a/reservations-redesigned-765 · https://www.airbnb.com/help/article/2810
- **→ 옮길 것**
  - 홈 = "지금 처리할 것 → 곧 운행 → 홈페이지 점검" 순서
  - 카드마다 전화 버튼
  - 경과 시간("25분 전 · 3일째")

### 3-8. 토스 TDS · UX 라이팅
- **하단 고정 2버튼**(BottomCTA.Double / FixedBottomCTA), safe area 기본 [직접] — https://tossmini-docs.toss.im/tds-mobile/components/BottomCTA/Double/ · https://tossmini-docs.toss.im/tds-mobile/components/BottomCTA/fixed-bottom-cta/
- **ConfirmDialog**는 "중요한 액션의 실행 전 확인"에 쓴다 [직접] — https://tossmini-docs.toss.im/tds-mobile/components/Dialog/confirm-dialog/
- **다이얼로그 왼쪽 버튼 문구는 "닫기"로 통일**, 모든 문구는 해요체 [직접] — https://developers-apps-in-toss.toss.im/design/consumer-ux-guide.md
  - 우리에겐 특히 중요하다. 업무 동작이 '취소'라서 다이얼로그 버튼 '취소'와 헷갈리기 때문이다.
- **Toast**: 기본 3초, 버튼이 있으면 5초, 되돌리기는 아래쪽 토스트에서만, 하단 고정 버튼 위에 띄우는 옵션 [직접] — https://tossmini-docs.toss.im/tds-mobile/components/toast/
- **Tab**: 가로 스크롤이 아니면 최대 4개, 새 소식은 빨간 점 [직접] — https://tossmini-docs.toss.im/tds-mobile/components/tab/
- **ListRow**: 왼쪽 · 가운데(2줄) · 오른쪽(배지·버튼) [직접] — https://tossmini-docs.toss.im/tds-mobile/components/ListRow/list-row-overview/
- **8가지 라이팅 원칙**(의미 없는 말 빼기·핵심만·모두가 아는 말 …) [직접] — https://toss.tech/article/8-writing-principles-of-toss
- **토스플레이스 예약**: 월/주/일 보기, 시간이 다가오면 남은 시간 표시 [직접] — https://tossplace.com/story/reservation_renewal
- **→ 옮길 것**
  - 모바일 상세 [전화] [확정하기]
  - 확인 시트 [닫기] [확정하고 문자 보내기] / [닫기] [접수 취소하기]
  - 토스트 3/5초
  - 짧은 해요체(결정 필요 — ⑨)

### 3-9. 당근 비즈프로필 · SEED 디자인 시스템
- **견적**: 새·진행 중·완료를 상태별로, "48시간 이내 견적 발송", "빠르게 답변할수록 수락률이 4배 높아져요" [직접] — https://businessdaangn.gitbook.io/business.daangn/profile/tools/estimate.md
- **예약**: 상태별·일자별 보기, **나만 볼 수 있는 메모** [직접] — https://businessdaangn.gitbook.io/business.daangn/profile/tools/reservation.md
- **Badge 톤**: Neutral / Informative / Positive / Warning / Critical, 2~3단어, 한 대상에 1~2개 [직접] — https://seed-design.io/components/badge
- **하단 탭**: **5개 이하, 라벨 한글 5자 이내, 배지는 탭 2개까지** [직접] — https://seed-design.io/components/bottom-navigation
- **Notification badge**: 0은 숨기고 99+로 줄인다 [직접] — https://seed-design.io/components/notification-badge
- **List**: 주목이 필요한 행은 강조, **행 어디를 눌러도 동작**, 한 행에 누를 요소 4개 미만 [직접] — https://seed-design.io/components/list
- **Snackbar**: 4초, 동작 1개, 문구는 "게시글을 저장했어요"(좋은 예) vs "게시글 저장 처리가 완료되었습니다"(나쁜 예) [직접] — https://seed-design.io/components/snackbar
- **Alert dialog**: "되돌릴 수 없는 액션"에만 쓰고, 경고 버튼을 따로 둔다 [직접] — https://seed-design.io/components/alert-dialog
- **→ 옮길 것**
  - 하단 탭 4개, 배지 2개 이하(접수·기록)
  - 행 전체가 링크 + 전화 버튼 1개
  - 스낵바 문구 규칙
  - 확인 시트는 되돌릴 수 없는 동작(확정 = 문자 발송, 취소)에만

### 3-10. 배민사장님 · 카카오비즈니스 (선택)
- **배민**: 새 주문이 오면 알림음, 첫 화면 [주문접수 > 신규·처리중] 탭, **거부·취소 버튼은 화면 최하단, 누르면 사유 선택** [직접] — https://ceo.baemin.com/guide/10597?one_depth=%EC%A3%BC%EB%AC%B8%EC%A0%91%EC%88%98&two_depth=%EB%B0%B0%EB%AF%BC%EC%82%AC%EC%9E%A5%EB%8B%98+%EC%95%B1
- **카카오 상담**: 읽지 않은 / 답변하지 않은 / 답변한 / 완료, 라벨·메모 [직접] — https://kakaobusiness.gitbook.io/main/channel/run/chat
- **→ 옮길 것**: 긍정 버튼과 취소 버튼을 멀리 떨어뜨리고, 취소에는 사유 고르기를 붙인다.

### 3-11. 가이드라인 (내비·터치·색)
- **폭 600dp 미만은 하단 Navigation bar**, 목적지 3~5개 [직접] — https://developer.android.com/develop/ui/compose/layouts/adaptive/build-adaptive-navigation · https://github.com/material-components/material-components-android/blob/master/docs/components/BottomNavigation.md
- **Apple HIG 탭 바** [직접] — https://developer.apple.com/design/human-interface-guidelines/tab-bars (원본 JSON 확인)
  - 탭 바는 이동에만 쓴다(동작은 toolbar)
  - **넘치는 탭을 모은 "More" 탭은 피한다**
  - 탭을 숨기거나 비활성화하지 않는다
  - 배지는 중요한 것에만 쓴다
- **터치 크기** [직접]
  - WCAG 2.5.8(AA) 24×24 — https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
  - WCAG 2.5.5(AAA) 44×44 — https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html
  - iOS 44×44pt — https://developer.apple.com/design/human-interface-guidelines/accessibility
  - Android 48dp — https://support.google.com/accessibility/android/answer/7101858
- **색만으로 정보 전달 금지(1.4.1)** · 글자 4.5:1 · UI 3:1 [직접] — https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html · https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html

### 3-12. 교차표 — 어느 레퍼런스가 무엇을 하나

| 패턴 | 네이버 | 카페24 | 티스토리 | Shopify | Stripe | WP | Airbnb | 토스 | 당근 |
|---|---|---|---|---|---|---|---|---|---|
| 첫 화면 = 지금 처리할 것(건수 → 목록 링크) | ● | ● | ◐지표 | ● | ● | ◐ | ● | | |
| 상태 탭/링크 + 건수 | ● | ● | | ◐ | ◐ | ● | ◐ | ● | ● |
| 목록 → 휴대폰 카드/대표 열 | | ◐ | | ● | | ● | ● | ● | ● |
| 상세 2열(본문 + 요약·연락) | ◐ | | | ● | | | | | |
| 전화·문자 바로가기 | ● | ● | | ● | | | ● | | |
| 모바일 하단 고정 동작 | | | | ✗데스크톱 | ● | | | ● | ◐ |
| 되돌릴 수 없는 동작 확인 + 결과 동사 버튼 | ◐ | ◐ | | ● | ● | ● | | ● | ● |
| 취소 사유 선택/입력 | ●필수 | ● | | | | | | | |
| 내부 메모 + 처리 이력 | ● | ● | | ● | | | ● | | ● |
| 성공 = 토스트 · 실패 = 배너 | | | | ● | ● | | | ● | ● |
| 하단 탭 ≤5 · 배지 절제 | | | ◐앱 | | ● | | ● | ● | ● |

(● 문서로 확인 · ◐ 일부/비슷함 · ✗ 명시적으로 권하지 않음)

---

## ④ 원칙 (7)

1. **오늘 할 일이 첫 화면이다.**
   - 로그인 직후 보이는 건 지표가 아니라 **지금 처리할 일**이다. 새 접수, 답이 늦은 접수, 문자 실패, 곧 운행 순이다.
   - 숫자는 그 조건의 목록으로 가는 링크다.
   - 근거: 카페24 C1 · Shopify Home · Airbnb Today · 네이버 앱 대시보드
2. **상태는 "해야 할 일"로 읽힌다.**
   - 처리가 필요한 상태가 **가장 강하고**, 끝난 상태는 **가장 약하다**.
   - 글자 + 모양(점·!·✓·실선·점선) + 톤 단계로 표시하고 색에만 기대지 않는다.
   - 탭에 건수를 붙이고, 건수의 정의는 메뉴·홈·목록에서 하나로 통일한다.
   - 근거: Polaris 톤·진행 아이콘 · Stripe Warning/Urgent · SEED Badge · WordPress 상태 링크 · WCAG 1.4.1 · Shopify 커뮤니티 반면교사
3. **전화가 먼저, 확정은 엄지가 닿는 곳에.**
   - 목록 카드와 상세 맨 위에 **전화 버튼(44px 이상)**을 둔다.
   - 휴대폰 상세는 **하단 고정 [전화] [확정하기]**, 데스크톱은 **오른쪽 고정 처리 카드**다.
   - 근거: Airbnb 예약 카드 · Shopify 주문 연락처 · 네이버 앱 v2.5.1 · Stripe 모바일 동작 바 · 토스 BottomCTA · Polaris "하단 동작 금지(데스크톱)"
4. **되돌릴 수 없는 일은 한 번 더 묻고, 결과는 바로 보인다.**
   - 확정(=문자 발송)과 취소는 확인 시트로 묻는다. 제목은 결과 질문, 왼쪽 버튼은 "닫기", 오른쪽 버튼은 결과 동사다.
   - 취소에는 사유를 고르게 하고, "고객에게 문자가 가지 않는다"를 알린다.
   - 성공은 토스트(3초, 동작이 있으면 5초)로 알린다. 실패는 그 자리의 **배너**(`role=alert`, 닫히지 않음)로 알린다.
   - 근거: Polaris Modal·Toast·Banner · 토스 규칙 · SEED Alert · 배민·네이버 취소 사유
5. **한 화면 한 목적, 휴대폰에선 카드.**
   - 목록은 목록, 등록·편집은 버튼으로 여는 별도 화면이나 시트에서 한다.
   - 휴대폰 목록은 판단에 필요한 것만 카드에 담는다(이름·가린 번호·구간·날짜·차량/인원·상태·경과).
   - 근거: Polaris Resource index · Table auto · WordPress 4.3 · SEED List · 토스 ListRow
6. **사장님 말로, 짧게.**
   - 개발 용어를 뺀다(대기열·상행·옛 6단계·경로·slug).
   - 버튼은 {동사}+{명사}, 결과 문구는 "○○했어요"처럼 짧게 쓴다.
   - 말투(해요체/합쇼체)는 한 가지로 정한다(⑨-1).
   - 근거: 토스 8원칙·해요체 · SEED Snackbar · Polaris 라벨 규칙
7. **필요한 만큼만 보여 준다.**
   - 목록에서는 번호 가운데를 가린다. 전체 번호는 상세와 전화 버튼 안에 둔다.
   - 메일 주소는 상세에만 둔다.
   - **URL엔 uuid만** 둔다. 검색어도 주소창에 남기지 않는다.
   - 법정 기록(동의·파기일)은 지우지 않되 접어 둔다.
   - 가격 계산·실증 못 할 숫자는 관리자에도 만들지 않는다.
   - 근거: CLAUDE.md §3 · 기존 발송 내역 가림·통계 가림 규약의 연장

---

## ⑤ 화면별 개선 설계

시안: `ADMIN-UX-mockup.html`(`#home` · `#list` · `#detail`). 캡처는 ⑧에 있다.
시안의 색은 **역할 토큰 이름 그대로**다. 새로 제안하는 토큰도 **기존 브랜드 원시색만** 참조한다(⑤-0).

### 5-0. 공통 — 상태 배지 체계와 제안 역할 토큰

| 사장님이 보는 라벨 | DB 상태 | 모양 | 제안 토큰(→ 원시색) | 대비 |
|---|---|---|---|---|
| **새 접수** | `new` | 채운 골드 + 검은 점 | `--status-attention-bg`(gold) · `-fg`(brand-950) · `-border`(gold-deep) | 글자 **7.66:1** · 테두리 4.97:1 |
| **N일째 대기**(파생: `new` + 72시간 초과 · 시안 예시는 "3일째") | `new` | 가장 짙은 보라 면 + ! 아이콘 + 행 왼쪽 4px 띠 | `--status-urgent-bg`(brand-950) · `-fg`(white) | **18.2:1** |
| **확정** | `confirmed` | 옅은 보라 면 + ✓ | `--status-confirmed-bg`(brand-100) · `-fg`(brand-700) | **8.41:1** |
| **운행 완료** | `done` | 흰 면 + 회색 실선 | `--status-closed-fg`(gray-text) · `-border`(gray) | 5.31:1 |
| **취소** | `cancelled` | 흰 면 + 회색 **점선** + × | 위와 같음 | 5.31:1 |
| 간편 · 전화 확인(속성) | `intake='quick'` | 보라 테두리 + 전화 아이콘 | 기존 `--border-strong`·`--text-brand` | 9.85:1 |

- **채운 보라(`--action-primary-bg`)는 버튼 전용**으로 한다.
  - 현재 탭 표시는 옅은 면 + 왼쪽 띠(사이드바) 또는 밑줄(상태 탭)로 바꾼다.
  - 이렇게 하면 "채운 보라 = 누를 수 있는 것" 하나의 뜻만 남는다.
- **되돌릴 수 없는 최종 버튼(확인 시트 안에서만)**: `--action-destructive-bg`(brand-950) + white. 긍정 동작(보라)과 한눈에 구분된다.
- 72시간은 0022 `admin_stats`의 `backlog.hours`와 **같은 값**을 쓴다. 통계 카드와 목록 표시가 어긋나지 않게 하기 위해서다.
- 대비는 WCAG 상대휘도 공식으로 이 태스크에서 계산했다. 구현 때는 `tests/tokens.test.ts`에 새 쌍을 단언으로 넣는다.

### 5-1. 관리 홈 (대시보드) — `proposed-home-*.png`

**목적**: 로그인 직후 "오늘 무엇을 해야 하나"에 3초 안에 답한다.

**위에서 아래로**
1. **날짜 + 한 줄 요약**: "9월 27일 일요일 · 오늘 확인할 일 · 새 접수 **4건**이 기다리고 있어요. 그중 1건은 3일째예요."
   - 데스크톱 헤더 오른쪽에 primary 1개 "새 접수 확인하기"(Polaris 규칙).
2. **할 일 카드 4장**(휴대폰 2×2, 데스크톱 4열). 카드 전체가 링크다.

   | 카드 | 값 | 보조 | 링크 | 데이터 |
   |---|---|---|---|---|
   | 새 접수 | `status='new'` 건수 | 간편 n · 상세 n | 접수(새 접수 탭) | count 쿼리(세션 + RLS) |
   | 답이 늦은 접수 | `new` 중 72시간 초과 | "72시간 넘게 기다리는 중" | 접수(같은 탭, 맨 위 묶음) | 0022 `backlog.over_72h` 재사용(기간과 무관한 값) 또는 같은 기준의 count 쿼리 |
   | 문자 발송 | 실패 n건 / "이상 없음" | 최근 7일 | 문자 기록 | `getNotificationSummary()` 재사용 |
   | 이번 주 운행 | 7일 안의 `confirmed` | 날짜 나열 | 운행 목록(2단계 캘린더 전엔 확정 탭) | 새 조회: `status='confirmed' and depart_at between now and +7d` |

3. **새 접수 미리보기**: 최대 5건. 목록과 **같은 카드 부품**이다. "3일째 대기"가 맨 위, 각 카드에 전화 버튼이 있다. "전체 보기 →"
4. **다가오는 운행(7일)**: 날짜별 묶음이다. "9월 30일 (수) · 3일 뒤 → 14:30 인천공항 → 서울 · 예시고객마 · 28인승 우등리무진 1대 · 22명 [✓ 확정]"
5. **홈페이지 점검**(데스크톱 오른쪽 열 / 휴대폰 아래):
   - 노출 중 팝업 없음 [만들기]
   - 마지막 공지 날짜 [공지 쓰기]
   - 대표 노선 금액 비어 있음 n개 [확인]. 홈이 금액 라벨을 숨기는 폴백 상태임을 알린다.
6. **이번 달 접수·확정** 한 줄 → 통계.

**상태 처리**
- 문자 실패가 있으면 할 일 카드 줄 바로 위에 **배너 1개**를 띄운다(Polaris "한 번에 하나"). "확정 안내 문자 1건이 나가지 않았어요 — 고객에게 전화로 알려 주세요 [보기]"
- 새 접수 0건: 카드 값 "0건" + 보조 "새 접수가 오면 문자로도 알려 드려요". 사장님 접수 알림 문자 `created.owner.sms`가 이미 있다.
- 로딩: P5-18의 스켈레톤을 그대로 쓴다.

**비용**: DB 변경 없음. 쿼리 3~4개는 서로 독립이라 `Promise.all`로 묶는다(P5-18 규약).

### 5-2. 접수 목록 — `proposed-list-*.png`

**구성**
- **검색 한 칸**: "이름 · 전화번호 뒷자리 · 접수번호". **검색어를 URL 쿼리에 싣지 않는다**(POST 폼 또는 클라이언트 상태). Stripe와 다르게 가는 이유는 원칙 7이다. 2단계에서 만든다.
- **상태 탭 + 건수**: [새 접수 **4**] [확정 2] [운행 완료 1] [취소 1] [전체 8]
  - 새 접수 건수는 골드 알약, 나머지는 옅은 보라 알약이다.
  - **기본 탭 = 새 접수**다.
  - 휴대폰에서는 탭 줄만 가로로 스크롤된다(페이지는 넘치지 않음).
- **정렬**(탭마다 다름)
  - 새 접수: **오래 기다린 것부터**. 네이버 주문 "가장 빨리 접수된 것부터"와 같다. 72시간이 넘은 건은 "답이 늦은 접수" 묶음으로 맨 위에 둔다.
  - 확정: **운행이 가까운 것부터**. 배차 준비 순서다.
  - 운행 완료·취소·전체: 최근 것부터.
- **행 = 한 벌의 마크업**(Polaris Table auto / WordPress 4.3)
  - 데스크톱(≥1024): 표 모양 7칸 — 상태 · 고객(이름 + 가린 번호) · 운행 구간 · 출발(날짜 + 시각/미정) · 차량·인원 · 접수(경과) · [전화]
  - 휴대폰: 카드 — 1줄 상태 배지 + 간편 칩 + 경과 / 2줄 **이름** + 가린 번호 / 3줄 구간 / 4줄 날짜 · 차량 · 인원, 오른쪽 **44px 전화 버튼**
  - 행 전체가 상세 링크이고(SEED List), 전화 버튼은 별개의 단일 목표다(행 안 누를 요소 2개).
- **페이지 넘김**: "20건 더 보기" 버튼 하나(이전/다음 쌍 대신).
- **빈 상태**(Stripe 두 종류)
  - 데이터 없음: "새 접수가 없어요. 들어오면 문자로 알려 드려요."
  - 검색 결과 없음: "‘0004’로 찾은 접수가 없어요 [검색 지우기]"

**개인정보**
- 목록의 번호는 `010-****-0004`로 보여 준다.
- `tel:` 링크는 전체 번호다. **어깨너머·캡처 노출을 줄이는 표시 규칙**이지 DOM 은닉이 아니다. 관리자 전용 화면이라는 전제는 그대로다.

**비용**
- 건수 4개는 count(head) 4회를 병렬로 부른다. 또는 나중에 RPC 1개로 합친다(마이그레이션 → 권한 회수 규약 적용).
- 정렬·묶음은 쿼리 파라미터만 바꾸면 된다. 인덱스 `reservations_status_created_at_idx`가 있다.

### 5-3. 접수 상세 — `proposed-detail-*.png` · `proposed-detail-confirm-sheet-*` · `proposed-detail-cancel-sheet-*` · `proposed-detail-after-confirm-*`

**머리**
- 배지([새 접수] [간편 접수 · 전화 확인 필요])
- **제목 = "예시고객가 님"**
- 한 줄 메타: "오늘 09:42 접수 (25분 전) · 홈 간편 견적 · 접수번호 EXQ7M2A1"

**배치**
- 데스크톱: **2/3 본문 + 1/3 오른쪽 고정 열**(Shopify)
- 휴대폰: 한 열 + **하단 고정 [전화] [확정하기]**. 이때 탭 바는 숨기고, 제목줄 ← 로 돌아간다.

| 오른쪽 열(데스크톱) / 맨 위(휴대폰) | 본문 |
|---|---|
| **연락**: 큰 번호 + [전화 걸기] [문자 보내기](48px, `tel:`·`sms:`) + "이 번호로 받은 접수는 이번이 처음이에요"(2단계, 네이버 "신규예약") | **운행**: 큰 "서울 → 강릉" + 가는 날·오는 날·기간·인원 + 미정 칸은 "📞 전화로 확인"(회색 + 전화 아이콘) |
| **처리**(데스크톱만, 휴대폰은 하단 바): [확정하기](primary, 전체 폭) + "확정하면 고객에게 확정 안내 문자가 가요" · 구분선 · [× 이 접수 취소하기](글자 버튼) + "취소하면 고객에게 문자가 가지 않아요. 전화로 알려 주세요." | **전화로 확인할 것**(간편 접수만): 체크 4개(차량 종류와 대수 · 출발 시각과 타는 곳 · 왕복인지 편도인지 · 여행 목적) + "0/4 확인" 진행 표시. 1단계는 **화면 안내용**(저장 안 함), 3단계에서 실제 칸 저장 |
| | **메모**: 한 칸 + "확정·취소할 때 메모도 함께 저장돼요" + [메모 저장]. 고객 요청 사항은 여기 위에 따로 보인다 |
| | **문자 기록**(2단계): 09:42 고객 접수 확인 문자 ✓ · 09:42 사장님 새 접수 알림 ✓ · (다음) 확정하면 확정 안내 문자가 가요. 실패하면 이 카드 위에 **배너** |
| | **접수 기록(동의·보관)**: `<details>`로 접힘. 개인정보 동의 · 청약철회 제한 동의 · 광고성 수신 · 파기 예정. 라벨은 **기존 `admin.detail.field.*` 그대로**다. 법정 문안을 새로 쓰지 않는다 |
| | 휴대폰 맨 아래: [× 이 접수 취소하기](글자 버튼). 긍정 버튼과 멀리 둔다(배민) |

**확정 시트**
- 제목: "예시고객가 님 접수를 확정할까요?"
- 요약 상자: 구간 · 날짜 · 인원
- (간편 접수이고 체크가 4개 미만이면) 경고 상자: "전화로 확인할 것 4개 중 2개를 확인했어요. 통화로 확인하셨나요?"
- 본문: "확정하면 **010-0000-0001**로 확정 안내 문자가 가요. 보낸 문자는 되돌릴 수 없어요."
- 버튼: [닫기] [확정하고 문자 보내기]
- 열리면 **포커스는 '닫기'**에 간다. Esc·바깥 누르기로 닫히고, Tab은 시트 안에서만 돈다(시안에서 실측).

**취소 시트**
- 제목: "…접수를 취소할까요?"
- 본문: "취소하면 되돌릴 수 없어요. **고객에게 문자가 가지 않으니** 전화로 알려 주세요."
- 사유 칩(선택): 고객 일정 변경 · 차량을 못 구함 · 연락이 안 됨 · 기타 → "고른 사유는 메모에 함께 남아요"
  - `admin_cancel_reservation(p_id, p_memo)`가 이미 메모를 받으므로 **DB 변경이 없다**.
- 버튼: [닫기] [접수 취소하기](짙은 면)

**확정 뒤**
- 토스트: "확정했어요. 확정 안내 문자를 보내고 있어요. [문자 기록]" (5초, `role=status`)
- 배지가 [✓ 확정]으로 바뀐다.
- 휴대폰 하단 바는 [전화] [문자 보내기]가 된다.
- **'운행 완료' 버튼은 운행일이 지난 뒤에만** 보인다(운행 전 완료 처리 실수 방지 — UI 규칙, 2단계).

**실패**: 처리 실패는 시트를 닫지 않고 시트 안 **배너**로 알린다("처리하지 못했어요. 잠시 뒤 다시 눌러 주세요"). 이미 처리된 건(`alreadyHandled`)은 배너 + 새로고침.

**비용**
- 1단계는 DB 변경 없음. 재배치 + 시트 + 메모 동시 저장(`ReservationActions` 인자 한 줄) + 토스트다.
- '문자 기록'·'이전 접수'는 2단계로 한다. RLS select로 읽을 수 있어 마이그레이션이 없다.

### 5-4. 콘텐츠 편집 (공지·팝업·갤러리·대표 노선)

- **공통 구조: 목록이 먼저다**(Polaris resource index)
  - 헤더 오른쪽에 primary 하나("공지 쓰기", "팝업 만들기", "사진 올리기"). 대표 노선은 추가 기능이 없으니 버튼도 없다.
  - 등록·수정은 **별도 화면**(데스크톱) 또는 **전체 화면 시트**(휴대폰)에서 한다. 지금의 "항상 펼친 폼"을 없앤다.
- **목록 행**
  - 제목(행 전체가 수정 링크) + 상태 배지(노출 중 / 예정 / 끝남 / 중지)
  - 노출은 **스위치**로 한다. 라벨 "노출"을 늘 같이 쓰고, 44px 이상이다.
  - 방향을 가리키는 문구("왼쪽에서")를 없앤다 → "아직 공지가 없어요. [공지 쓰기]"
- **팝업**
  - 이미지를 **갤러리 사진에서 고르거나 바로 올린다**(경로 입력 제거).
  - 기간 빠른 선택: "오늘부터 7일 · 14일 · 직접".
  - 저장 전 **미리보기**(기존 `PopupSample` 활용).
- **갤러리**
  - 썸네일 격자(휴대폰 2열 · 데스크톱 4~5열).
  - 사진을 누르면 **편집 시트**(설명 · 앨범 · 노출 · 삭제)가 열린다.
  - 순서는 ▲▼ 버튼(데스크톱은 끌기 추가).
  - **여러 장 선택** → 노출 켜기/끄기 · 앨범 옮기기.
  - 업로드는 큰 "사진 올리기" 버튼 + 줄마다 진행 상태(지금 장점 유지).
  - 삭제는 2단계를 유지하고, 2단계 이후 휴지통을 검토한다.
- **대표 노선(16개 고정)**
  - 휴대폰 카드: "인천공항 → 서울 · 표시 금액 · 노출 중 [수정]".
  - 금액 미리보기("홈에서 이렇게 보입니다")는 **이미 수정 화면에 있다**(`admin.routes.homeLook*`, `formatPriceKrw` — 계산 없음). 좋은 패턴이니 목록 카드에도 한 줄로 보여 준다.
  - 순서는 ▲▼.
  - 금액 옆 고지는 원장 `VERBATIM.showcaseNotice` 그대로다.
- **사장님 글 경고(copyWarning)**: 지금 방식을 유지한다. 저장 버튼 바로 아래 패널이고, 좋은 패턴이다.

### 5-5. 통계

- P5-17의 구조(①~⑤)와 가림 규약은 유지한다.
- 바꿀 것 3가지
  1. **"지금 확인할 것"(처리 대기·문자 문제)은 홈으로 옮긴다.** 통계에는 링크만 남긴다.
  2. 기간 칩 아래의 긴 설명(집계 기준·코호트·가림·합계 차이)을 **"이 숫자는 어떻게 셌나요?" 접힘 하나**로 모은다. 숫자가 먼저 보인다.
  3. 휴대폰에서는 막대 라벨·값을 한 줄로 둔다(지금도 넘치지 않음). 구간 표는 카드 목록으로 바꾼다.

---

## ⑥ 내비 결정

**결정: 데스크톱(≥1024px) 좌측 사이드바 + 휴대폰(<1024px) 위 제목줄 + 하단 탭 바 4개.**

| | 데스크톱 사이드바(248px) | 휴대폰 하단 탭 바 |
|---|---|---|
| 항목 | **홈 · 접수(새 접수 배지)** / 홈페이지: 공지 · 팝업 · 갤러리 · 대표 노선 / 기록: 문자 기록 · 통계 / 아래: "사장님 계정" · 홈페이지 보기 ↗ · 로그아웃 | **홈 · 접수(배지) · 홈페이지(허브 → 공지·팝업·갤러리·노선) · 기록(허브 → 문자 기록·통계, 실패 있으면 ! 배지)** · 로그아웃은 홈 제목줄의 계정 버튼 |
| 현재 표시 | 옅은 면 + 왼쪽 4px 띠 + 굵은 글자(채운 보라 아님) | 보라 아이콘·글자 + 위 3px 띠 |
| 크기 | 항목 44px | 탭 56px + safe area |

**이유**
1. **목적지가 8개다.** 지금 가로 탭은 1024px 미만에서 3줄(137px)로 꺾인다. 사이드바는 묶음(매일 / 가끔 / 기록)으로 무게를 나눈다. 티스토리·카페24·Shopify·Stripe·WordPress가 모두 이 형태다.
2. **휴대폰은 엄지 영역에 이동을 둔다.** Material 폭 600dp 미만 = Navigation bar, 목적지 3~5개. HIG 탭 바. SEED(5개 이하, 한글 5자 이내 라벨, 배지 탭 2개까지). 네 라벨은 모두 4자 이내다(홈·접수·홈페이지·기록).
3. **"더보기" 탭을 두지 않는다.** HIG가 넘치는 탭을 모은 More 탭을 피하라고 한다. 그래서 공지·팝업·갤러리·노선은 '홈페이지' 허브로, 문자 기록·통계는 '기록' 허브로 묶었다. 허브 화면은 항목마다 상태 한 줄을 보여 준다(예: "팝업 — 노출 중 없음").
4. **배지 정의는 하나다.** 메뉴 '접수 4' = 홈 '새 접수 4' = 목록 탭 '새 접수 4' = `status='new'` 건수. Shopify의 두 숫자 혼란을 피한다. 스크린리더에는 "새 접수 4건"을 읽힌다(WordPress). 0이면 숨긴다(SEED).
5. **상세에서는 탭 바를 숨기고 하단 동작 바를 둔다.** HIG "탭 바는 이동, 동작은 toolbar"와 Stripe 모바일 상세를 따른다. 두 바를 겹치면 하단 130px를 먹는다. HIG는 탭 바를 계속 보이라고도 한다. 그래도 상세는 ← 가 있는 **작업 화면**이라 국내 앱(토스·당근·배민)처럼 하단을 주 동작에 내준다. 사장님이 불편해하면 동작 바를 탭 바 위에 얹는 대안으로 되돌린다(⑨).
6. **태블릿(600~1023px) 레일은 두지 않는다.** Material은 중간 폭에 레일을 권한다. 사장님 기기가 폰이라 구현 비용 대비 이득이 적어 휴대폰 형태로 통일했다. 필요해지면 사이드바를 아이콘만 남기는 접힘형으로 1024 아래로 늘린다.

**구현 경계**
- `components/admin/tabs.ts`의 `ready` 규약(만들지 않은 탭도 자리를 지킴)은 그대로 둔다. 항목에 `group`(daily·site·records)과 `mobileHub`만 더한다.
- 로그아웃은 지금처럼 **form POST**로 한다(프리페치 로그아웃 방지 — `AdminTabs.tsx` 헤더 주석).

---

## ⑦ 단계별 구현 계획 (규모 S/M/L)

**0단계 — 순서·소유권(비용 0)**
- **목업 소유권 절차**
  - `mockups/admin.html`은 UIUX 세션 소유다.
  - 이 제안이 채택되면 UIUX 세션이 목업을 v2로 반영하고 **커밋 해시를 브리프에 고정**한다(ADR-8).
  - 구현 세션은 그 해시를 따라 이식한다.
  - 이 시안(`ADMIN-UX-mockup.html`)은 그 입력 자료다.
- **P5-18·P7-3 머지 뒤에 시작한다.** `app/admin/**`·`components/admin/*`·`admin.module.css`가 겹치기 때문이다. 1단계 안에서도 파일이 겹치는 항목은 직렬로 한다.

**1단계 — 가장 적은 비용으로 가장 큰 체감.** 모두 **DB 변경 없음**. 파일은 `app/admin/(protected)/page.tsx`·`reservations/**`·`layout.tsx`, `components/admin/*`, `admin.module.css`, `styles/semantic.css`, `messages/ko.json`(admin.*)이다.

| # | 항목 | 규모 | 비고 |
|---|---|---|---|
| 1-0 | **즉시 수정: 공지·팝업 격자 넘침**(②-13). 격자 항목에 `min-width:0`(또는 `grid-template-columns:minmax(0,1fr)`)을 준다. 그러면 표가 자기 스크롤 상자 안에서 밀린다. 2-4에서 카드 목록으로 바꾸기 전까지 쓰는 임시 처방이다 | **S** | CSS 한두 줄 · 다른 단계와 무관하게 먼저 해도 된다 |
| 1-1 | **관리 홈 대시보드**(할 일 카드 4 · 새 접수 5 · 곧 운행 7일 · 점검 · 실패 배너) | **M** | 0022 backlog·`getNotificationSummary` 재사용 + 곧 운행 조회 1개. 병렬 조회 |
| 1-2 | **상세 재배치**(제목 = 고객명 · 연락 카드 전화/문자 버튼 · 데스크톱 오른쪽 고정 처리 카드 · 휴대폰 하단 고정 바 · 간편 "전화로 확인할 것" · 동의·보유 접기) | **M** | 개인정보는 지금처럼 서버에서 그린다(props 금지 규약 유지) |
| 1-3 | **확정·취소 확인 시트 + 메모 동시 저장 + "취소 시 문자 없음" 안내 + 사유 → 메모** | **S** | `ReservationActions.tsx`에서 `memo` 전달, 시트 컴포넌트 1개. 포커스 가두기·Esc |
| 1-4 | **목록 카드화 + 상태 탭 건수 + 기본 탭 새 접수 + 경과 시간·72시간 묶음 + 번호 가운데 가림 + 탭별 정렬** | **M** | count 4회 병렬. `min-width:68rem` 표 제거 |
| 1-5 | **내비**(사이드바 ≥1024 · 하단 탭 <1024 · 배지 · 홈 링크 · 허브 2개는 링크 목록 화면) | **M** | `AdminTabs.tsx`·`tabs.ts`·보호 레이아웃 |
| 1-6 | **상태 배지·토큰**(`--status-*`·`--action-destructive-*` 추가, 채운 보라 = 버튼 전용) | **S** | `semantic.css` + `tests/tokens.test.ts` 대비 단언 |
| 1-7 | **문구 정리 + 토스트**(아래 사전 · 결과 토스트 3/5초 · 실패는 배너) | **S** | `ko.json` admin.*만. 말투 결정(⑨-1) 뒤 |

문구 사전(1-7):

| 지금 | 제안 |
|---|---|
| 확정하시면 고객에게 보낼 확정 문자가 발송 대기열에 쌓입니다. | 확정하면 고객에게 확정 안내 문자가 가요. |
| 상행 일시 | 오는 날(돌아오는 날) |
| 상세 접수(옛 6단계) | 상세 접수 |
| 간편 접수(홈) — 차량 종류·여행 구분·출발 시각·운행 구분·대수는 전화로 확인 | 간편 접수 · 전화 확인 필요 (+ "전화로 확인할 것" 목록) |
| 취소 처리했습니다. | 취소했어요. 고객에게 전화로 알려 주세요. |
| 메모를 저장했습니다. | 메모를 저장했어요. |
| 신규 / 완료 | 새 접수 / 운행 완료 |
| 등록된 팝업이 없습니다. 왼쪽에서 새 팝업을 등록해 주세요. | 지금 등록된 팝업이 없어요. [팝업 만들기] |
| 이미지 경로 | 사진 고르기 (2단계) |
| 주소에 쓰는 이름 | 앨범 주소 (영문) |

**2단계 — 찾기 · 기록 · 콘텐츠**

| # | 항목 | 규모 | 비고 |
|---|---|---|---|
| 2-1 | **검색**(이름 · 전화 뒷자리 · 접수번호, **URL에 남기지 않음**) | **M** | POST 폼/서버 액션. 입력 zod 검증. 관리자 게이트 |
| 2-2 | **상세 '문자 기록' 타임라인 + 실패 배너** | **M** | `notifications_log` RLS select(0009) · 번호 가림 재사용 |
| 2-3 | **"이 번호로 받은 접수" 이력**(처음/재방문) | **S** | 관리자 select. 목록 링크 |
| 2-4 | **공지·팝업·노선: 목록 우선 + 편집 화면/시트 + 스위치** | **M** | 기존 폼 컴포넌트 재사용 |
| 2-5 | **팝업 이미지 고르기**(갤러리에서 선택/업로드) | **M** | Storage 공개 경로만. 원본 경로 금지 규약 유지 |
| 2-6 | **갤러리: 썸네일 격자 · 편집 시트 · ▲▼ · 여러 장 선택** | **L** | 일괄 쓰기는 기존 액션 반복 또는 RPC(마이그레이션이면 권한 규약) |
| 2-7 | **'운행 완료'는 운행일 뒤에만 노출 + "완료 처리 안 된 지난 운행" 목록** | **S** | UI 규칙(DB 무변경) |
| 2-8 | **로그인: 6자리 코드 입력 병행**(같은 브라우저 문제) + 한국어 메일 템플릿 + 세션 유지 기간 결정 | **M** | **인증 변경 → 독립 보안 리뷰 필수**(CLAUDE.md §6) |
| 2-9 | **통계 설명 접기 · "지금 확인할 것" 홈 이전** | **S** | P5-17 규약 유지 |

**3단계 — 선택 · 결정이 필요한 것**

| # | 항목 | 규모 | 비고 |
|---|---|---|---|
| 3-1 | **간편 접수 확인 값을 칸으로 저장**(차량·출발 시각·운행 구분·대수·여행 구분) | **L** | 관리자에게 `reservations` UPDATE 권한이 **없다**(실측 `has_table_privilege=f` — 상태는 0010 definer 함수로만 바뀜). 새 definer 함수 + EXECUTE 회수/부여 + CHECK 정합 + 독립 리뷰 |
| 3-2 | **취소 시 고객 문자**(새 템플릿 `cancelled.customer.sms`) | **M** | 문안 승인 · Solapi 비용 · 아웃박스 라벨 1:1 게이트 |
| 3-3 | **확정 되돌리기**(발송을 N초 늦춤 + 역전이) | **L** | 0010에 역전이가 없음 · 즉시 발송(P4-7) 구조 변경 |
| 3-4 | **새 접수 웹 푸시 / 홈 화면 아이콘(PWA)** | **L** | 지금은 사장님 접수 알림 문자로 충분한지 먼저 확인 |
| 3-5 | **운행 캘린더(월·주)** | **M** | 토스플레이스·네이버 달력 |
| 3-6 | **관리자 전용 기능색(빨강 1개) 도입** | **S** | 브랜드 결정(⑨-2) |

---

## ⑧ 시안 파일 · 캡처 목록

**시안**
- `ADMIN-UX-mockup.html`
  - 자체 포함이다. 외부 스크립트·스타일·글꼴이 0이고, 인라인 JS는 화면 전환·시트·토스트용이다.
  - 주소 뒤에 `#home` · `#list` · `#detail`을 붙이면 해당 화면이 열린다.
  - 색은 `tokens.css` 값을 그대로 옮기고, 역할 토큰 이름만 쓴다. "제안" 토큰은 주석으로 표시했다. 컴포넌트 CSS에는 색 리터럴이 **0개**다(원시 토큰 블록에만 있다). 그림자는 고도 토큰만, 딤은 `--overlay-medium`을 쓴다.
  - 예시 데이터는 전부 가짜다(`예시고객가~아` · `010-0000-00xx` · `EX…`).
  - 시안 범위 밖 메뉴(공지·팝업 등)를 누르면 "시안 범위 밖" 토스트가 뜬다.

**시안 실측(Playwright, 1280·375)**

| 화면 | 가로 넘침 | 콘솔 오류 | 44px 미만 | 주 동작이 첫 화면에 |
|---|---|---|---|---|
| 홈 | 없음(1280/1280 · 375/375) | 0 | 0/29 · 0/24 | — |
| 목록 | 없음 | 0 | 1(시각적으로 숨긴 라벨 = 오탐) | 전화 버튼 44×44 카드마다 |
| 상세 | 없음 | 0 | 5(체크박스 22px — 감싸는 라벨이 48px라 실제 목표는 48px · "메모" 라벨) | **확정: 1280 y=481 · 375 하단 바 y=754** (지금: 1223 · 1673) |
| 시트 | 없음 | 0 | — | 열면 포커스 = '닫기', Esc로 닫힘 |

**캡처 — 현재(`current-*`)**
- 모든 탭 1280·375 전체 화면
  - `current-home` · `current-reservations` · `current-reservations-new` · `current-detail-quick` · `current-detail-wizard` · `current-detail-confirmed`
  - `current-popups` · `current-notices` · `current-notice-edit` · `current-gallery` · `current-routes` · `current-route-edit` · `current-notifications` · `current-stats`
  - 각각 `-1280.png` · `-375.png`
- 첫 화면: `current-{home,reservations,detail-quick,detail-wizard,popups,notices,gallery,routes,notifications,stats}-375-fold.png`
- 로그인: `current-login-1280.png` · `current-login-375.png`
- 상호작용 증거
  - `current-detail-actions-before-cancel-375.png` → `current-detail-after-cancel-375.png` (한 번 눌러 취소 · 확인 창 0)
  - `current-detail-memo-saved-375.png` (14px 결과 한 줄)
- 참고: 갤러리의 깨진 썸네일은 **이전 테스트가 남긴 행**(`p69-…`, 저장소 객체 없음)이다. 이번 진단 대상이 아니다. 개발 표시 "N" 버튼은 캡처에서 숨겼다(제품 UI 아님).

**캡처 — 시안(`proposed-*`)**
- `proposed-home-1280.png` · `proposed-home-375.png` · `proposed-home-375-fold.png`
- `proposed-list-1280.png` · `proposed-list-375.png` · `proposed-list-375-fold.png` · `proposed-list-confirmed-tab-1280.png`
- `proposed-detail-1280.png` · `proposed-detail-375.png` · `proposed-detail-375-fold.png`
- `proposed-detail-confirm-sheet-1280.png` · `proposed-detail-confirm-sheet-375.png`
- `proposed-detail-cancel-sheet-1280.png` · `proposed-detail-cancel-sheet-375.png`
- `proposed-detail-after-confirm-1280.png` · `proposed-detail-after-confirm-375.png`
- ⚠ **검증 방법의 맹점(컨트롤러 참고)**: CLAUDE.md §7의 "375px 가로 스크롤 없음"은 `scrollWidth = clientWidth`로 확인한다. 이 사이트는 `app/globals.css:1-5`가 `html,body{overflow-x:hidden}`이라 **넘친 내용을 잘라 숨겨도 통과한다**(②-13이 그 예다).
  - 보완 제안: "스크롤 상자 밖에서 오른쪽 끝이 뷰포트 폭을 넘는 요소 0개" 검사를 UI 실측 절차에 더한다(`getBoundingClientRect().right > innerWidth`이면서 조상에 `overflow-x:auto|scroll`이 없는 요소).
  - 시안 HTML은 `overflow-x:hidden`을 쓰지 않았으므로 위 표의 "넘침 없음"이 그대로 유효하다. 같은 엄격 검사도 돌렸다. 홈·목록·상세·확정 시트·취소 시트 × 375·1280 **모두 0개**였다. 상태 탭 줄만 의도한 가로 스크롤 상자다.
- 375 전체 화면 캡처에서는 고정 바를 문서 맨 아래에 붙여 찍었다. 캡처 도구가 고정 요소를 첫 화면 위치에 그리기 때문이다. `-fold`가 실제로 보이는 모습이다.
- 글꼴: 이 기계엔 Pretendard가 없어 맑은 고딕으로 렌더됐다. P7-3이 들어가면 Pretendard로 보인다.

---

## ⑨ 열린 질문 (사용자·사장님이 정할 것)

1. **말투**: 해요체("확정했어요" — 토스·당근·배민 사장님 앱)와 지금의 합쇼체("확정 처리했습니다") 중 어느 쪽으로 할까? 시안은 해요체다. 한 가지로 통일해야 한다.
2. **상태 색**: 브랜드 3색만으로 갈까(시안: 새 접수 = 골드, 급함 = 가장 짙은 보라)? 아니면 관리자 화면에만 기능색 빨강 1개(발송 실패·오래 기다림)를 허용할까? 브랜드 가이드 결정 사항이다.
3. **목록 전화번호**: 가운데를 가릴까(시안), 전체를 보일까? 사장님이 목록에서 번호를 눈으로 대조하는 습관이 있는지 확인이 필요하다.
4. **기본 탭·정렬**
   - 목록 기본 탭: '새 접수'(시안)인가, '전체'인가?
   - 새 접수 정렬: 오래 기다린 것부터(시안)인가, 최근 것부터인가?
5. **간편 접수 확인 값**: 1단계처럼 메모에 적는 것으로 충분한가, 아니면 칸으로 저장해야 하나(3-1, 마이그레이션 L)?
6. **취소**
   - 사유를 메모에 붙이는 방식(시안)이면 되는가?
   - 고객에게 취소 문자를 보내야 하나(3-2 — 문안·비용)? 지금은 아무것도 가지 않는다.
7. **로그인**
   - 사장님이 메일을 어떤 앱으로 여는가(네이버 메일 앱? 기본 메일?)
   - 6자리 코드 입력을 병행할까(2-8)?
   - 한 번 로그인하면 며칠 유지되면 좋은가? 호스팅 설정이라 저장소 밖이다.
8. **사장님 기기·글자 크기**
   - 아이폰인가 안드로이드인가?
   - 시스템 큰 글씨를 쓰는가? 쓴다면 본문 16→17px, 카드 높이를 다시 잡는다.
9. **72시간 기준**: '답이 늦은 접수' 기준을 72시간(통계와 같음)으로 둘까, 24/48시간으로 둘까? 당근 견적 48시간, Airbnb 24시간 사례가 있다.
10. **운행 캘린더**(3-5)가 필요한가, '이번 주 운행' 목록으로 충분한가?
11. **상세 하단**: 탭 바를 숨기고 동작 바만 두는 방식(시안)이 괜찮은가, 탭 바도 계속 보여야 하나?

---

## 부록 A — 실측 절차 · 정리 기록

**환경**
- 저장소를 `C:\dev\besttour_adminux_copy`로 robocopy했다(`/XF .env.local ".env*.local"` · node_modules·.next·.git·.superpowers 제외).
  - 복사 직후 `.env.local` 없음을 확인했다(`False`).
  - `node_modules`는 정션으로 연결했다.
  - 사본 `next.config.ts`에만 `turbopack.root:"C:/dev"`·`allowedDevOrigins:["127.0.0.1"]`을 넣었다(P2-9·P3-8 선례).
- env는 사본 전용 `.env.development.local`에 새로 썼다. 값은 로컬 스택 값(`npx supabase status`)이다.
  - `ADMIN_EMAILS=admin-ux-review@example.test`
  - `GUARD_SECRET`(무작위 64자)
  - Upstash 대체: docker `adminux-srh`(hiett/serverless-redis-http, 127.0.0.1:18079) + `adminux-redis` · 네트워크 `adminux-net`
  - Turnstile 테스트 키
  - `NOTIFY_*`·Solapi·Resend 없음 → 외부 발송 0
- 서버는 `next dev --turbopack -p 3003 -H 127.0.0.1`로 띄웠다.
  - ⚠ 브리프의 `-H localhost`에서 벗어났다. 로컬 Auth의 `site_url`이 `http://127.0.0.1:3000`이고 허용 목록이 `https://127.0.0.1:3000` 하나라서다. GoTrue는 **호스트명이 site_url과 같을 때만** 다른 포트로 되돌려 준다. `localhost:3003`이면 **3000으로 떨어져** 금지 포트를 밟는다. 루프백 전용이라는 취지는 같다.

**로그인(인증 우회 없음)**
1. 로컬 Auth에 사용자 1명을 만들었다(admin API, `email_confirm`). 로그인 경로가 `shouldCreateUser:false`라 미리 있어야 한다. 이어서 `admin_users` 행 1개를 넣었다.
2. 사본 로그인 화면의 폼으로 링크를 요청했다 → "로그인 링크를 보냈습니다."
3. Mailpit에서 메일을 받았다(제목 "Your sign-in link").
   - 링크 `type=magiclink`, `redirect_to=http://127.0.0.1:3003/admin/auth/callback`
   - GoTrue verify가 303으로 응답했고, 행선지 호스트를 확인한 뒤(3003) 같은 브라우저로 열었다.
   - 앱의 콜백이 PKCE 코드를 교환해 세션 쿠키를 심었다.
4. 콜백은 `NextURL`이 `127.0.0.1`을 `localhost`로 바꿔 `localhost:3003/admin`으로 보냈다. 쿠키는 127.0.0.1에 있어 로그인 화면이 떴다. 로컬에서만 생기는 현상이다(운영은 도메인이 하나). `127.0.0.1:3003`으로 다시 열어 관리자 화면에 들어갔다.
5. 로컬 Auth 메일 한도는 스택 전체 **시간당 2통**이다(`config.toml`). 다른 에이전트와 나눠 쓰므로 **메일은 1통만** 썼다.

**데이터**
- 예시 접수 8건: 간편 3 · 상세 5 / 신규 4(1건 72시간 초과) · 확정 2 · 완료 1 · 취소 1.
- 공지 2건: 비노출. 촬영하는 동안만 1건을 노출했다가 되돌렸다.
- 알림 행 0건: 접수 insert에는 아웃박스 트리거가 없다.
- '확정하기'는 **누르지 않았다.** 누르면 claim 가능한 pending 문자 행이 생겨 동시에 도는 통지 잠금 테스트를 흔든다(CLAUDE.md §7).
- 취소는 내 예시 행 1건에만 눌렀다. 취소 함수는 상태만 바꾸고 문자 행을 만들지 않는다.
- 노출: 예시 행은 **10:07~10:17 KST(약 10분)** 동안 로컬 DB에 있었다. 그동안 같은 DB를 쓰는 다른 사본(3001·3002)의 홈 **"접수 현황"(가려진 이름)**에 보였을 수 있다. P7-3 홈 캡처에 섞였는지 컨트롤러가 확인해 주면 좋다.

**측정 도구**
- gstack browse 번들의 Playwright(1.58.2)로 측정했다(P2-9 선례).
- 공용 browse 데몬은 다른 에이전트와 탭·쿠키를 나누게 된다. 그래서 전용 상태 파일로 따로 띄웠는데, 이 Windows 환경에서는 호출 사이에 재시작·중단돼 스크립트로 바꿨다.

**정리 — 실행 결과 (10:40~10:45 KST)**

| 대상 | 조치 | 확인 출력 |
|---|---|---|
| 사본 서버 3003 | 백그라운드 작업 중지 + `next dev -p 3003 -H 127.0.0.1` 프로세스 트리(PID 30408→17500)만 종료 | `3003: no listener` · 3001·3002는 다른 에이전트 것이라 **건드리지 않음**(`listening (not mine, untouched)`) |
| 정션·사본 | 정션 먼저 `rmdir`(링크만 제거) → 사본 안 재분석 지점 0개 확인 → 삭제 | `junction removed: True` · `reparse points left in copy: 0` · `copy deleted: True` · 저장소 `node_modules/next present: True`(327개 폴더) |
| docker | `adminux-srh`·`adminux-redis` 컨테이너, `adminux-net` 네트워크 | `remaining adminux: none` · Supabase 컨테이너 11개 그대로 |
| 로컬 Auth·DB | Auth admin API로 사용자 삭제(`admin_users`는 FK cascade) | `DELETE user HTTP 200` · `admin_users(mine) 0` · `auth.users(mine) 0` · `auth.sessions(mine) 0` · `reservations EX* 0` · `notices 예시 0` |
| Mailpit | 내 주소로 온 메일 1통 | `DELETE HTTP 200` · `remaining for my address: 0` |
| 스크래치 | 세션 상태 파일(쿠키)·로컬 데모 키·SRH 토큰·스크립트·측정 JSON 폴더, 실패 로그 1개 | `scratch adminux folder deleted: yes` · browse 데몬 상태 파일 없음(실행 중 아님) |
| 저장소 | 코드 변경 0 | `git status`의 변경은 전부 P7-3의 글꼴·견적 모달 작업이다. `.superpowers/`는 gitignore 대상이다 |

- 로컬 DB에 남은 알림 1행과 갤러리 `p69-*` 7행은 **내 것이 아니라서** 두었다. 알림 행은 내 접수와 연결된 0행을 삭제한 뒤에도 남은 것이고, 갤러리 행은 이전 테스트의 잔여다.
- 공유 스크래치패드의 `b.sh`는 P7-3이 자기 용도로 덮어썼다. 내 것이 아니므로 그대로 두었다.
