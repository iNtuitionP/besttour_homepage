// lib/legal/disclosures.ts — 법정 문구 단일 원장 (플랜 v4 P1-1 · ADR-5)
//
// 규칙
//   - 상수만 export 한다. 함수 export 0개 — scripts/check-legal-disclosures.sh 가 grep 으로 강제한다.
//   - 컴포넌트·페이지·i18n 은 법정 문구를 이 모듈에서만 가져온다. 다른 파일에 법정 문구를 쓰면 게이트 위반.
//   - 문안은 P1-1 브리프(.superpowers/sdd/2026-09-06-bestour-implementation-v4/P1-1-brief.md)에서
//     그대로 옮겼다. 윤문 금지 — 바꿔야 하면 브리프·스펙을 먼저 고치고 여기로 내려온다.
//   - 확인되지 않은 값은 줄 끝 TEMP 마커 주석(`CONST.field: 사유`) + scripts/gates/temp-allowlist.txt 등록.
//     값 자체가 미확정인 필드는 "" 로 둔다 — 지어내지 않는다. 소비자는 빈 값을 숨김 폴백으로 처리한다.
//   - source: 각 상수가 어디서 확정됐는지(스펙 §번호 / 사업자등록증 / 사장님 확인시트 ★번호 / 옛 사이트 bo_page).
//     배열 상수(PROCESSORS·OVERSEAS_TRANSFERS)는 객체가 아니라서 형제 상수 *_SOURCE 에 둔다.

// ── 운영사 ───────────────────────────────────────────────────────────────
export const COMPANY = {
  legalName: "합자회사 베스트투어",
  brandName: "베스트투어",
  brandNameEn: "Bestour",
  representative: "이승묵",
  representativeEn: "Lee SeungMuk",
  bizRegNo: "130-86-77328",
  mailOrderNo: "제 2020-고양일산동-1211호",
  mailOrderIssuer: "고양시 일산동구청",
  address: "경기도 고양시 일산동구 동국로 107(식사동)",
  branchAddress: "서울시 마포구 월드컵북로 23길 18",
  // 대표전화 — 푸터 사업자 정보 블록의 "대표전화" 한 줄로만 쓴다(사용자 2026-09-21 "1566 은 둔다").
  // 손님에게 "여기로 전화하라" 고 안내하는 자리는 전부 아래 consultTel 이다(tests/contact-phone.test.ts).
  tel: "1566-6188",
  // 예약·상담 전화 — 이 홈페이지를 위해 새로 개통한 번호(사용자 2026-09-21). 영문 페이지는 consultTelIntl(해외에서 1566 은 걸리지 않는다).
  consultTel: "010-6362-6188",
  consultTelIntl: "+82 10-6362-6188",
  mobile: "010-2048-8585",
  fax: "0303-3443-5252",
  email: "bestour2013@naver.com", // [TEMP] COMPANY.email: P0-10 도메인 메일 개설 후 info@bestour.co.kr 로 교체
  establishedYear: 2013,
  privacyOfficer: { name: "조선영", phone: "010-6362-6188" },
  hostingProvider: "Vercel Inc.",
  // 입금 계좌는 PAYMENT.account 에 있다 — 예금주가 관계사라 COMPANY 안에 두면 운영사 계좌로 오독된다(P1-7 브리프 1-D).
  source: "사업자등록증 2021-12-14 / whois / 스펙 §13.1·§13.8 / 확인시트 ★3 / 사장님 답변 2026-09-21 A-4·A-9·A-21",
} as const;

// ── 관계사 (푸터 병기용) ─────────────────────────────────────────────────
export const RELATED_COMPANY = {
  legalName: "(주)베스트모빌리티",
  representative: "이승묵",
  bizRegNo: "342-88-03855", // 시트의 332-… 는 오기. 등록증 확대 판독으로 342 확정 (스펙 §13.8)
  address: "경기도 용인시 기흥구 용구대로 2439, 4층 2호 201호(마북동)",
  role: "관계사",
  note: "계약과 개인정보 처리의 주체는 합자회사 베스트투어이며, 대금은 관계사 (주)베스트모빌리티 명의 계좌로 받습니다.",
  source: "사업자등록증 2026-08-18 / 스펙 §13.1 / 사장님 답변 2026-09-21 A-5",
} as const;

// ── verbatim — 한 바이트도 바꾸지 마라 (CLAUDE.md §3) ────────────────────
export const VERBATIM = {
  bookingNotice: "사장님 확정 후 연락드리며, 확정된 예약만 결제 진행됩니다.",
  showcaseNotice: "대표 노선 예시 견적 · 45인승 당일왕복 기준 · 실제 견적은 상담 후 확정",
  source: "CLAUDE.md §3",
} as const;

// ── 견적 산정 기준 — 전자상거래법 §13②3호 (가격 미결정 시 산정 방법 표시) ──
export const QUOTE_BASIS = {
  title: "견적 산정 기준",
  factors: ["차종", "탑승 인원", "운행 거리", "운행 시간", "운행 일수", "심야/주말 할증"],
  line: "견적 산정 기준 : 차종 · 탑승 인원 · 운행 거리 · 운행 시간 · 운행 일수 · 심야/주말 할증",
  source: "스펙 §13.10 / 전자상거래법 제13조 제2항 제3호",
} as const;

// ── 지급 방법·시기 ───────────────────────────────────────────────────────
export const PAYMENT = {
  onlinePayment: false,
  depositKrw: 100000,
  line: "대금 지급 : 온라인 결제 없음 · 계약금 10만원 · 잔금과 지급 방법은 예약 확정 시 안내",
  balanceTiming: "예약 확정 시 안내", // 사장님 확정 2026-09-21 — 값 그대로(P1-7 브리프 1-E)
  // 계약은 베스트투어, 입금만 관계사(사장님 답변 2026-09-21 A-5). RELATED_COMPANY.note 가 같은 사실을 말한다.
  account: { bank: "하나은행", number: "255-910018-71504", holder: "(주)베스트모빌리티", holderRole: "관계사" },
  accountLine: "입금 계좌 : 하나은행 255-910018-71504 (예금주 (주)베스트모빌리티 · 관계사)",
  source: "확인시트 C3 / 2차 회신 2026-09-06 / 사장님 답변 2026-09-21 A-5",
} as const;

// ── 취소·환불 — 사장님 답변 2026-09-21 A-1 로 2단계 확정 ────────────────────
// 초과 운행 요금은 적지 않는다(사장님: 받지 않음).
export const CANCELLATION = {
  basis: "deposit",
  tiers: [
    { when: "운행일 3일 전까지", refundPct: 100, label: "계약금 전액 환불" },
    { when: "운행일 2일 전부터 운행 당일까지", refundPct: 0, label: "계약금 환불 불가" },
  ],
  referenceTime: "기준은 운행일의 날짜(한국 시간)입니다. 예) 10일 운행이면 7일 23시 59분까지 취소하시면 계약금 전액을 돌려드리고, 8일부터는 돌려드리지 않습니다.",
  depositNote: "계약금은 10만원이며, 잔금과 지급 방법은 예약 확정 시 안내드립니다.",
  // 표·요약은 그 자체로 절대적으로 읽힌다("계약금 환불 불가"). 이 문장이 표 바로 아래에서 범위를 밝힌다
  // (P1-7 R3 [P2-F] — astra: 전체 고지는 조건부인데 요약은 무조건으로 읽혔다). 표가 나오는 화면마다 함께 싣는다.
  scope:
    "위 규정은 고객 사정으로 취소하시는 경우에 적용되며, 제공된 서비스가 표시·광고 또는 계약 내용과 다른 경우 등 법에 따른 권리에는 영향을 주지 않습니다.",
  // 확정 통지(문자·알림톡)에 싣는 한 줄 — 약관 제8조 "예약 확정 통지에 고지"(P1-7 R2 [P1-4]) · R3 [P2-F] 로 범위를 밝혔다
  smsLine: "취소·환불 : 운행일 3일 전까지 취소 시 계약금 전액 환불, 2일 전부터는 계약금 환불 불가(고객 사정으로 취소하는 경우)",
  source: "사장님 답변 2026-09-21 A-1 (사용자 경유)",
} as const;

// ── 청약철회 제한 — 전자상거래법 §17②·③·⑥. 위저드 6단계(필수 체크) · 이용안내 · 약관 · 확정 통지에 싣는다 ──
// P1-7 R2 [P1-1]: 제한은 실제 손해가 나는 운행 2일 전부터로 좁히고 조건부로 쓴다. §17③ 권리(표시·광고·계약과 다른 경우)를 남긴다.
// 영문 화면은 noticeEn(번역본 — 한국어가 법적 원문이라는 문장이 그 안에 있다)을 보여 주고 한국어 원문을 lang="ko" 로 함께 둔다.
export const WITHDRAWAL = {
  notice:
    "이 서비스는 고객이 정한 운행일에 맞춰 차량을 따로 배차하는 전세버스 대절 알선 서비스입니다. 운행일 3일 전까지는 계약 시기와 관계없이 언제든 취소하시면 계약금 전액을 돌려드립니다. 운행일 2일 전부터는 배차한 차량을 다시 배정하기 어려워 「전자상거래 등에서의 소비자보호에 관한 법률」 제17조 제2항에 따라 청약철회가 제한될 수 있으며, 그 경우 계약 후 7일 이내라도 위 취소·환불 규정이 적용됩니다. 다만 제공된 서비스가 표시·광고 또는 계약 내용과 다른 경우에는 법에 따라 청약철회 등을 하실 수 있습니다.",
  // R3 [P2-G]: 한국어에만 있던 날짜 계산(한국 시간 · 예시)을 영문에도 싣고, 표가 "고객이 요청한 취소" 범위임을 밝힌다.
  noticeEn:
    "This charter is arranged individually for the travel date you choose. If you cancel at least 3 days before the travel date, we refund your full deposit, no matter when you booked; days are counted by calendar date in Korea time, so for a trip on the 10th you can cancel until 11:59 pm on the 7th. From 2 days before the travel date, the vehicle assigned to you is hard to reassign, so your right of withdrawal under Korea's Act on the Consumer Protection in Electronic Commerce may be restricted; in that case the refund policy above applies even within 7 days of booking. The policy above covers cancellations you request; it does not affect your rights under the law, for example if the service provided differs from what was advertised or agreed. The Korean text is the legally binding version.",
  consentLabel: "위 청약철회 제한 내용을 확인했으며, 취소·환불이 위 규정에 따르는 데 동의합니다. (필수)",
  consentLabelEn: "I have read the restriction on withdrawal above and agree that cancellations and refunds follow the policy above. (required)",
  smsLine: "운행일 2일 전부터는 계약 후 7일 이내라도 청약철회가 제한될 수 있습니다.",
  source: "사장님 답변 2026-09-21 A-2 · 전자상거래법 §17②·③·⑥ · astra P1-7 리뷰 반영",
} as const;

// ── 개인정보 수집·이용 4대 고지 (PIPA §15②) ─────────────────────────────
export const PRIVACY_NOTICE = {
  title: "개인정보 수집·이용 안내",
  purpose: "전세버스 견적 상담 및 예약 접수·확정",
  items: ["이름", "휴대폰 번호", "운행 희망 일시", "출발지·도착지·경유지", "탑승 인원"],
  itemsLine: "이름, 휴대폰 번호, 운행 희망 일시, 출발지·도착지·경유지, 탑승 인원",
  // 이 문구는 lib/retention/purge.ts 의 실제 파기 동작과 일치해야 한다. 배치는 확정 이력이 있는 예약을
  // created_at + CONFIRMED_KEEP_YEARS(5년) 까지 보관하므로, 그 예외가 문구에도 있어야 고지가 참이 된다.
  retention:
    "접수일로부터 1년. 다만 「전자상거래 등에서의 소비자보호에 관한 법률」에 따라 계약 또는 청약철회 등에 관한 기록과 대금결제 및 재화 등의 공급에 관한 기록은 5년간 보관합니다.", // 사장님 확정 2026-09-21 — 값 그대로(P1-7 브리프 1-E). 법정 보존 5년 예외는 전자상거래법 §6③·시행령 §6①2·3호
  retentionDays: 365, // 위 retention 문안의 숫자값(사장님 확정 2026-09-21) — lib/reservations/consent.ts 가 retention_until 계산에 읽는다. 문안과 함께 바꾼다
  refusal: "동의를 거부하실 수 있으며, 거부 시 견적 상담과 예약 접수가 제한됩니다.",
  consentLabel: "위 내용을 확인했으며 개인정보 수집·이용에 동의합니다. (필수)",
  marketingConsentLabel: "할인·이벤트 안내 문자 수신에 동의합니다. (선택)",
  // 2026-09-13 P3-5 독립 리뷰 M-1: 화면이 접수 상태(접수/확정) 칩도 보여 주므로 한정 열거에 넣었다. tests/feed-notice-parity.test.ts 가 항목 키와 대조한다.
  publicFeedNotice: "접수 현황은 성명 일부(예: 한**)·차종·운행일·접수 상태(접수/확정)만 마스킹하여 홈에 공개됩니다.",
  source: "스펙 §13.10 / 플랜 ADR-6 / UIUX 브리프 §3-②",
} as const;

// ── 처리위탁 (PIPA §26② 실명 공개, 별도 동의 불요) ──────────────────────
export const PROCESSORS = [
  { name: "주식회사 누리고(Solapi)", task: "문자·알림톡 발송", location: "대한민국" }, // [TEMP] PROCESSORS.Solapi.name: 법인명 — solapi.com 사업자정보에서 확인 후 교체
  { name: "Vercel Inc.", task: "웹 호스팅·서버 운영, 방문 통계", location: "미국" },
  // 리전 실측: supabase/.temp/pooler-url = aws-0-ap-northeast-2 → 서울. 국내 저장이므로 국외이전 목록에 두지 않는다.
  { name: "Supabase Inc.", task: "데이터베이스·인증·파일 저장", location: "대한민국(서울 리전)" },
  { name: "Upstash Inc.", task: "접수 폭주 방지(요청 제한)", location: "" }, // [TEMP] PROCESSORS.Upstash.location: 리전 확인 전
  { name: "Cloudflare Inc.", task: "봇 차단(Turnstile)·DNS", location: "미국" },
] as const;
export const PROCESSORS_SOURCE = "플랜 ADR-10 / 결정 메모 1-C" as const;

// ── 국외 이전 (PIPA §28조의8② **5개 호 전부** + 시행령 §31① "이전의 근거") ────────
// 이 사이트는 별도 동의(§28조의8①1호)가 아니라 **계약 이행 위탁 + 처리방침 공개**(§28조의8①3호가목)를
// 근거로 국외이전을 한다. 그 근거는 제2항 각 호를 **전부** 공개해야만 성립하므로, 아래 5개 필드 중
// 하나라도 비면 적법 근거가 사라진다 — tests/legal.test.ts 가 공란을 실패로 잡는다.
//   1호 items · 2호 country+timingMethod · 3호 recipient+contact · 4호 purpose+retention · 5호 refusal
//
// 방문 통계(Vercel Web Analytics)는 호스팅과 **별도 항목**이다(P1-7 R2 · 사용자 결정 "거부 버튼 + 별도 고지") — 호스팅의 근거
// (계약 이행)를 빌려 쓰지 않고, 자체 항목·보관 기간·거부 수단(/privacy 의 '방문 통계 거부' 버튼 · DNT·GPC)을 갖는다.
// 이름 붙은 상수로 두는 이유: /privacy 가 이 항목 바로 아래에 거부 버튼을 놓으려고 **같은 참조**로 자리를 찾는다(문자열 비교 없이).
export const VISITOR_STATS_TRANSFER = {
  recipient: "Vercel Inc.",
  contact: "privacy@vercel.com",
  country: "미국",
  timingMethod: "공개 페이지를 여실 때 네트워크를 통해 전송",
  items: "방문한 페이지 주소(주소 뒤 매개변수 제외), 들어온 경로(이전 페이지 주소), 기기 종류·운영체제·브라우저, 접속 국가·지역",
  purpose: "방문 통계(방문 수·많이 보는 페이지·유입 경로 파악)",
  retention: "수집일로부터 12개월",
  // R3 [P1-B]: "이전의 근거" 칸에 근거가 아닌 설명만 있었다(astra). 동의를 받지 않는다는 사실을 먼저 밝히고 거부 수단으로 잇는다.
  legalBasis:
    "별도의 동의를 받지 않고 처리합니다. 수집되는 정보는 개인을 알아볼 수 없는 통계 목적으로만 이용하며, Vercel은 이 기능에서 쿠키를 쓰지 않고 IP 주소를 저장하지 않는다고 밝히고 있습니다. 원하지 않으시면 아래 방법으로 거부하실 수 있습니다.",
  // R4 [P2-E]: 저장이 막힌 브라우저에서는 거부 표시가 남지 않아 다른 탭·새로고침에서 다시 수집된다 — 고지를 그 사실에 맞춘다(astra 재현).
  refusal:
    "이 항목의 '방문 통계 거부' 버튼을 누르시면 그 브라우저에서는 방문 통계를 보내지 않습니다. 거부 표시는 브라우저 저장소에 남는데, 저장이 막혀 있는 브라우저(사생활 보호 모드 등)에서는 이번 방문 동안만 적용되므로 그때는 브라우저의 추적 거부(Do Not Track·GPC) 설정을 함께 켜 주시기 바랍니다. 추적 거부·GPC 설정은 별도 조작 없이 거부로 봅니다. 거부하셔도 사이트 이용에는 제한이 없습니다.",
} as const;

export const OVERSEAS_TRANSFERS = [
  {
    recipient: "Vercel Inc.",
    contact: "privacy@vercel.com",
    country: "미국",
    timingMethod: "서비스 이용 시 네트워크를 통한 상시 전송",
    items: "접속 로그·요청 정보",
    purpose: "웹 호스팅",
    retention: "위탁 계약 종료 시까지",
    legalBasis: "정보주체와의 계약 이행을 위한 처리위탁",
    refusal:
      "국외 이전을 거부하시려면 견적 신청을 하지 않으시면 됩니다. 본 서비스는 해외에 서버를 둔 클라우드 인프라를 이용하므로, 이전을 거부하시는 경우 온라인 견적 신청·예약 접수 이용이 제한됩니다. 전화(010-6362-6188)로는 이전 없이 상담하실 수 있습니다.",
  },
  VISITOR_STATS_TRANSFER,
  {
    recipient: "Upstash Inc.",
    contact: "", // [TEMP] OVERSEAS_TRANSFERS.Upstash.contact: 개인정보 연락처 확인 전 — 지어내지 않는다
    country: "", // [TEMP] OVERSEAS_TRANSFERS.Upstash.country: 리전 확인 전
    timingMethod: "서비스 이용 시 네트워크를 통한 상시 전송",
    items: "요청 식별자(IP 해시)",
    purpose: "요청 제한",
    retention: "위탁 계약 종료 시까지",
    legalBasis: "정보주체와의 계약 이행을 위한 처리위탁",
    refusal:
      "국외 이전을 거부하시려면 견적 신청을 하지 않으시면 됩니다. 본 서비스는 해외에 서버를 둔 클라우드 인프라를 이용하므로, 이전을 거부하시는 경우 온라인 견적 신청·예약 접수 이용이 제한됩니다. 전화(010-6362-6188)로는 이전 없이 상담하실 수 있습니다.",
  },
  {
    recipient: "Cloudflare Inc.",
    contact: "privacy@cloudflare.com",
    country: "미국",
    timingMethod: "서비스 이용 시 네트워크를 통한 상시 전송",
    items: "접속 정보",
    purpose: "봇 차단",
    retention: "위탁 계약 종료 시까지",
    legalBasis: "정보주체와의 계약 이행을 위한 처리위탁",
    refusal:
      "국외 이전을 거부하시려면 견적 신청을 하지 않으시면 됩니다. 본 서비스는 해외에 서버를 둔 클라우드 인프라를 이용하므로, 이전을 거부하시는 경우 온라인 견적 신청·예약 접수 이용이 제한됩니다. 전화(010-6362-6188)로는 이전 없이 상담하실 수 있습니다.",
  },
] as const;
export const OVERSEAS_TRANSFERS_SOURCE = "결정 메모 1-C / PIPA §28조의8" as const;

// ── 차량 보험 — 사장님 "기존 문구 그대로" (확인시트 ★2) ───────────────────
export const INSURANCE = {
  title: "차량 보험",
  body: "전세버스의 차량보험 가입은 각 손해보험회사와 전세버스 공제조합의 보험에 가입되어 있으며 유사시 보상조건은 동일합니다. 여러분께서 이용하실 회사의 차량에 대해서는 원하시는 경우 보험 서류를 받아 보실 수 있습니다.",
  source: "옛 사이트 page.php?bo_page=intro10 / 확인시트 ★2",
} as const;

// ── 소비자 불만·분쟁 처리 (전자상거래법 §13②8호) ────────────────────────
export const DISPUTE = {
  channel: "예약·상담 전화 010-6362-6188 또는 이메일로 접수",
  handling: "접수 후 영업일 기준 3일 이내 처리 결과를 안내드립니다.", // 사장님 확정 2026-09-21 — 값 그대로(P1-7 브리프 1-E)
  mediation: "분쟁이 해결되지 않을 경우 한국소비자원(1372) 또는 전자거래분쟁조정위원회에 조정을 신청하실 수 있습니다.",
  source: "결정 메모 1-C / 사장님 답변 2026-09-21",
} as const;

// ── 아동 ─────────────────────────────────────────────────────────────────
export const MINORS = {
  line: "만 14세 미만 아동은 법정대리인의 동의 없이 견적을 신청하실 수 없습니다.",
  source: "PIPA §22조의2 / 전자상거래법 §13③",
} as const;

// ── 법정 링크 ─────────────────────────────────────────────────────────────
export const LEGAL_LINKS = {
  privacy: "/privacy",
  terms: "/terms",
  guide: "/guide",
  ftcBizInfo: "https://www.ftc.go.kr/bizCommPop.do?wrkr_no=1308677328",
  source: "시행규칙 §7②",
} as const;

// ── 법정 페이지 메타 (P1-6) ───────────────────────────────────────────────
export const LEGAL_PAGES = {
  privacy: { title: "개인정보 처리방침", effectiveDate: "2026-09-21" }, // [TEMP] LEGAL_PAGES.privacy.effectiveDate: 오픈일로 교체 — consent.ts PRIVACY_POLICY_VERSION 이 이 값을 그대로 읽는다(동의 기록 버전 = 표시 시행일, P1-7 R2)
  terms: { title: "이용약관", effectiveDate: "2026-09-11" }, // [TEMP] LEGAL_PAGES.terms.effectiveDate: 오픈일로 교체(위와 동일)
  guide: { title: "이용안내" },
  source: "플랜 P1-6",
} as const;

// ── 법정 페이지 보조 라벨 — 표 머리·연락처·조 번호 (페이지는 리터럴 대신 이것을 렌더) ──
export const LEGAL_LABELS = {
  effectiveDate: "시행일",
  home: "홈으로",
  legalNav: "법정 고지",
  articleNo: { prefix: "제", suffix: "조" },
  processor: { name: "수탁자", task: "위탁 업무", location: "처리 국가" },
  overseas: {
    recipient: "이전받는 자",
    contact: "연락처",
    country: "이전되는 국가",
    timingMethod: "이전 일시·방법",
    items: "이전 항목",
    purpose: "이용 목적",
    retention: "보유·이용 기간",
    legalBasis: "이전의 근거",
    refusal: "이전 거부 방법·절차·효과",
  },
  cancellation: { when: "취소 시점", label: "환불" },
  officer: { name: "성명", phone: "연락처" },
  // /privacy 의 방문 통계 거부 버튼(P1-7 R2 — 브리프 문구). 영문은 en.json legal.labels.analyticsOptOut.
  // R3 [P2-C]: 저장에 실패해도 이번 방문 동안은 실제로 멈춘다(lib/analytics/before-send.ts 의 메모리 표시) — 문구가 그 사실을 말한다.
  //   브라우저의 추적 거부(DNT·GPC)가 켜져 있으면 버튼 대신 "이미 거부 중" 을 보여 준다. 둘 다 법정 문안이 아닌 UI 문구다.
  analyticsOptOut: {
    optOut: "방문 통계 거부",
    optIn: "방문 통계 다시 허용",
    storageFailed: "설정을 저장하지 못했습니다. 이번 방문 동안에는 이 브라우저에서 방문 통계를 보내지 않습니다.",
    browserRefused: "브라우저의 추적 거부 설정으로 이미 거부 중입니다",
  },
  // consultTel — 예약·상담 전화(COMPANY.consultTel). tel(대표전화)은 푸터 사업자 정보 한 줄에만 쓴다(P1-7).
  contact: { tel: "대표전화", consultTel: "예약·상담 전화", mobile: "휴대전화", fax: "팩스", email: "이메일", address: "주소" },
  // 푸터 사업자 정보 줄의 라벨 (P2-3). 공개 셸은 한글 리터럴을 쓰지 않고 여기서만 가져간다.
  // 관계사 배지 라벨은 RELATED_COMPANY.role 이 이미 갖고 있으므로 중복해서 두지 않는다.
  footer: {
    companyInfo: "사업자 정보",
    operator: "운영사",
    representative: "대표",
    bizRegNo: "사업자등록번호",
    mailOrder: "통신판매업신고",
    headOffice: "본사",
    branch: "지사",
    privacyOfficer: "개인정보 보호책임자",
    hosting: "호스팅",
    ftcBizInfo: "사업자정보 확인",
  },
  source: "플랜 P1-6",
} as const;

// ── 이용약관 — 전자상거래법 §10①5호 필수 표시 (연결화면 허용, 생략 불가) ──
export const TERMS = {
  articles: [
    {
      no: 1,
      title: "목적",
      body: "이 약관은 합자회사 베스트투어(이하 \"회사\")가 운영하는 인터넷 사이트(bestour.co.kr)에서 제공하는 전세버스 견적 상담 및 예약 접수 서비스(이하 \"서비스\")의 이용 조건과 절차, 회사와 이용자의 권리·의무 및 책임 사항을 규정함을 목적으로 합니다.",
    },
    {
      no: 2,
      title: "정의",
      body: "\"이용자\"란 사이트에 접속하여 이 약관에 따라 서비스를 이용하는 자를 말합니다. \"견적 신청\"이란 이용자가 운행 조건을 제출하여 회사에 견적 상담을 요청하는 행위를 말합니다. \"예약 확정\"이란 회사가 이용자와 상담을 거쳐 운행 조건과 대금에 합의하고 그 사실을 이용자에게 통지한 때를 말합니다.",
    },
    {
      no: 3,
      title: "약관의 효력 및 변경",
      body: "이 약관은 사이트에 게시함으로써 효력이 발생합니다. 회사는 관련 법령을 위배하지 않는 범위에서 이 약관을 변경할 수 있으며, 변경 시 적용일자 및 변경 사유를 명시하여 적용일자 7일 전부터 사이트에 공지합니다. 이용자에게 불리한 변경은 30일 전부터 공지합니다.",
    },
    {
      no: 4,
      title: "서비스의 내용",
      body: "회사는 이용자의 견적 신청을 접수하고, 상담을 거쳐 전세버스 운행 조건과 대금을 안내하며, 예약 확정 후 운행을 제공하거나 등록된 전세버스 운송사업자를 통하여 제공합니다. 사이트에 표시된 가격은 대표 노선의 예시이며 실제 견적은 상담 후 확정됩니다.",
    },
    {
      no: 5,
      title: "계약의 성립",
      body: "견적 신청은 계약의 청약이 아닌 상담 요청이며, 회사가 상담을 거쳐 예약을 확정하고 이용자에게 통지한 때에 계약이 성립합니다. 회사는 예약 확정 전까지 차량 수급 등의 사유로 접수를 거절할 수 있으며 이 경우 이용자에게 그 사실을 통지합니다.",
    },
    {
      no: 6,
      title: "대금 및 계약금",
      body: "사이트에서는 온라인 결제를 제공하지 않습니다. 예약 확정 시 계약금 10만원을 지급하며, 잔금의 금액·지급 방법·지급 시기는 예약 확정 시 회사가 안내합니다.", // [TEMP] TERMS.articles.six.body: 잔금 시기·지급수단 사장님 확정 후 교체 (PAYMENT.balanceTiming 과 함께)
    },
    {
      no: 7,
      title: "취소 및 환불",
      body: "예약 확정 후 이용자의 사정으로 취소하는 경우 이용안내에 게시된 취소·환불 규정에 따릅니다. 회사의 사정으로 운행이 불가능한 경우 회사는 지급받은 계약금 전액을 환불하며, 이용자에게 발생한 통상의 손해를 배상합니다.",
    },
    {
      no: 8,
      title: "청약철회",
      body: "전세버스 운행은 특정 일시에 제공되는 용역으로서 「전자상거래 등에서의 소비자보호에 관한 법률」 제17조 제2항에 따라 청약철회가 제한될 수 있으며, 그 경우 제7조의 취소·환불 규정이 적용됩니다. 회사는 이 사실을 견적 신청 화면과 예약 확정 통지에 고지합니다.",
    },
    {
      no: 9,
      title: "회사의 의무",
      body: "회사는 관련 법령과 이 약관이 정하는 바에 따라 지속적이고 안정적으로 서비스를 제공하기 위하여 노력하며, 이용자의 개인정보를 개인정보 처리방침에 따라 보호합니다.",
    },
    {
      no: 10,
      title: "이용자의 의무",
      body: "이용자는 견적 신청 시 정확한 정보를 제공하여야 하며, 타인의 정보를 도용하거나 허위 신청을 하여서는 안 됩니다. 허위 신청으로 회사에 손해가 발생한 경우 이용자는 그 손해를 배상할 책임이 있습니다.",
    },
    {
      no: 11,
      title: "책임의 제한",
      body: "회사는 천재지변, 도로 통제, 불가항력 등 회사의 귀책사유 없는 사유로 서비스를 제공할 수 없는 경우 그에 대한 책임을 지지 않습니다. 회사는 이용자의 귀책사유로 인한 서비스 이용 장애에 대하여 책임을 지지 않습니다.",
    },
    {
      no: 12,
      title: "분쟁의 해결",
      body: "회사와 이용자 간에 발생한 분쟁은 상호 협의하여 해결하며, 협의가 이루어지지 않는 경우 이용자는 한국소비자원 또는 전자거래분쟁조정위원회에 조정을 신청할 수 있습니다. 소송이 제기되는 경우 「민사소송법」에 따른 관할법원을 전속관할로 하며, 대한민국 법을 준거법으로 합니다.",
    },
  ],
  source: "전자상거래법 §10①5호·§13②5호·§17 / 플랜 P1-6 / 컨트롤러 확정 2026-09-11",
} as const;

// ── 처리방침 필수 기재 (PIPA §30① + 시행령 §31) — 절 순서와 각 절의 출처 상수 ──
//    from: 이미 원장에 있는 상수를 그대로 가리킨다(복제하지 않는다). body: 이 절에서만 쓰는 문안.
export const PRIVACY_POLICY_SECTIONS = [
  { key: "purpose", title: "개인정보의 처리 목적", from: PRIVACY_NOTICE.purpose },
  { key: "items", title: "처리하는 개인정보의 항목", from: PRIVACY_NOTICE.items },
  { key: "retention", title: "개인정보의 처리 및 보유 기간", from: PRIVACY_NOTICE.retention },
  { key: "processors", title: "개인정보 처리업무의 위탁", from: PROCESSORS },
  { key: "overseas", title: "개인정보의 국외 이전", from: OVERSEAS_TRANSFERS },
  {
    key: "rights",
    title: "정보주체의 권리·의무 및 행사 방법",
    body: "정보주체는 회사에 대하여 언제든지 개인정보 열람·정정·삭제·처리정지를 요구할 수 있습니다. 권리 행사는 개인정보 보호책임자에게 서면, 전화 또는 이메일로 하실 수 있으며 회사는 지체 없이 조치합니다.",
  },
  {
    key: "destruction",
    title: "개인정보의 파기 절차 및 방법",
    body: "회사는 보유 기간이 경과하거나 처리 목적이 달성된 개인정보를 지체 없이 파기합니다. 전자적 파일은 복구할 수 없는 방법으로 영구 삭제하며, 종이 문서는 분쇄 또는 소각합니다.",
  },
  {
    key: "safety",
    title: "개인정보의 안전성 확보 조치",
    body: "회사는 개인정보의 안전성 확보를 위하여 접근 권한 관리, 암호화 통신(HTTPS), 접속 기록 보관, 처리 시스템의 접근 통제 등의 조치를 취하고 있습니다.",
  },
  {
    key: "cookies",
    title: "자동 수집 장치의 설치·운영 및 거부",
    // 끝의 방문 통계 문장들("또한 방문 통계를 위해 …")은 P1-7 R2 브리프 문안 그대로다 — lib/analytics/before-send.ts 가 "보내지 않고 · 지운 뒤 보냅니다" 와
    // 거부 수단(버튼 · DNT·GPC)을 참으로 만든다. Vercel 쪽 동작(쿠키·IP·하루 초기화)은 "밝히고 있습니다" 로만 적는다(회사가 보증하지 않는다).
    body: "사이트는 팝업 \"오늘 하루 보지 않기\" 등 이용 편의를 위해 브라우저 저장소(localStorage)를 사용합니다. 이는 개인을 식별하지 않으며, 브라우저 설정에서 저장소를 삭제하거나 차단할 수 있습니다. 또한 방문 통계를 위해 Vercel Web Analytics를 사용합니다. Vercel은 이 기능에서 쿠키를 쓰지 않고 IP 주소를 저장하지 않으며 하루 단위로 초기화되는 값으로 방문 수를 센다고 밝히고 있습니다. 회사는 관리자 화면 주소를 보내지 않고, 주소 뒤에 붙는 매개변수(검색어·접수번호 등)는 지운 뒤 보냅니다. 방문 통계는 개인정보처리방침의 '방문 통계 거부' 버튼이나 브라우저의 추적 거부(Do Not Track·GPC) 설정으로 거부하실 수 있으며, 거부 표시는 브라우저 저장소(localStorage)에 남습니다. 저장이 막혀 있는 브라우저에서는 그 표시가 남지 않아 이번 방문 동안만 적용되므로, 그때는 브라우저의 추적 거부 설정을 함께 켜 주시기 바랍니다.",
  },
  { key: "publicFeed", title: "접수 현황 공개 안내", from: PRIVACY_NOTICE.publicFeedNotice },
  { key: "officer", title: "개인정보 보호책임자", from: COMPANY.privacyOfficer },
  {
    key: "remedy",
    title: "권익침해 구제 방법",
    body: "정보주체는 개인정보 침해에 대한 신고나 상담을 개인정보분쟁조정위원회(1833-6972), 개인정보침해신고센터(118), 대검찰청(1301), 경찰청(182)에 문의하실 수 있습니다.",
  },
  {
    key: "changes",
    title: "처리방침의 변경",
    body: "이 처리방침은 시행일로부터 적용되며, 법령·정책 또는 서비스 변경에 따라 내용이 추가·삭제·수정될 경우 변경 사항의 시행 7일 전부터 사이트에 공지합니다.",
  },
] as const;
export const PRIVACY_POLICY_SECTIONS_SOURCE = "PIPA §30① / 시행령 §31 / 결정 메모 1-C / 비평 §1-4" as const;

// ── 이용안내 (기존 메뉴 "이용안내" 계승 + 전자상거래법 §13② 거래조건 표시) ──
export const GUIDE_SECTIONS = [
  {
    key: "flow",
    title: "이용 절차",
    steps: ["견적 신청 (사이트 또는 전화)", "상담 (운행 조건·대금 안내)", "예약 확정 (계약금 10만원)", "운행 당일"],
  },
  { key: "quoteBasis", title: "견적 산정 기준", from: QUOTE_BASIS },
  { key: "payment", title: "대금 지급", from: PAYMENT },
  { key: "cancel", title: "취소·환불 규정", from: CANCELLATION },
  { key: "insurance", title: "차량 보험", from: INSURANCE },
  { key: "dispute", title: "문의 및 분쟁 처리", from: DISPUTE },
  { key: "minors", title: "만 14세 미만 이용 제한", from: MINORS },
  // 연락처 첫 줄은 예약·상담 전화(P1-7). 대표전화(tel)는 푸터 사업자 정보 한 줄에만 남는다.
  { key: "contact", title: "연락처", from: COMPANY, fields: ["consultTel", "mobile", "fax", "email", "address"] },
] as const;
export const GUIDE_SECTIONS_SOURCE = "플랜 P6-3 매핑표 / 전자상거래법 §13②" as const;
