/**
 * P5-23 라운드 2 — 컨트롤러가 라운드 1 촬영을 한 장씩 보고 준 디자인 디테일(B · C 항목)을 잠근다.
 * A-1·A-2(발송 기록 코드 라벨 · '대기' 둘째 줄)는 tests/admin-notify-display.test.ts, A-3(날짜 틀 하나)은 tests/admin-date.test.ts 가 잠근다.
 *
 *   C-14 메타 줄 조각 — 줄은 조각 사이에서만 꺾이고, 구분점은 같은 줄의 두 조각 사이에만 보인다(라운드 3: 줄 머리에서 잘리는 CSS 구분점 ·
 *        줄 머리·끝 '·' 0 · 단위 하나만 떨어지지 않음 · 늘 같이 읽히는 둘은 붙은 구분점 glued)
 *   C-15 문단 끝 외톨이 — text-wrap: pretty(점진적 개선) + 두 문장 안내는 문장마다 한 덩어리 · "72시간 넘게 대기"
 *   C-16 상태 탭 줄 — 밀릴 수 있으면 가려진 쪽 끝을 옅게(판정은 TabIntoView · 모양은 CSS mask)
 *   C-17 관리자 글자 12px 아래 0
 *   B-5  공지·팝업 — 목록 먼저 · 한 칸 · 1024 미만 카드 · 버튼 글자 한 줄
 *   B-6  발송 기록 — 옛 68rem 표가 아니다 · 1280 미만 카드
 *   B-8  대표 노선 — 칸마다 세로 가운데
 *   B-9  폼 간격 — 칸 묶음 뒤 간격 · 이름 → 안내 → 입력칸 · 체크 줄의 이름 충돌(.checkRow) 해소
 *   B-10 갤러리 — 안내와 첫 칸 사이 · 사진 고르기 버튼(진짜 입력칸은 접근 가능) · 앨범 줄 배지 자리
 *   B-11 관리 홈 — 절 머리 높이가 같다(제목이 한 줄에 선다)
 *   B-12 체크 상자·라디오 — 역할 토큰의 accent-color
 *   B-13 로그인 — keep-all · overflow-wrap anywhere · 브랜드 표식
 *   A-4  옛 위저드 라벨 띄어쓰기
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { dashUnits, glued, keepLastWord, segments, sentences, splitSegments } from "@/components/admin/segments";
import { revealsOnFocus } from "@/components/admin/TabIntoView";
import { COMPANY } from "@/lib/legal/disclosures";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const ADMIN_CSS = "components/admin/admin.module.css";
const LOGIN_CSS = "app/admin/login/login.module.css";
const ko = JSON.parse(read("messages/ko.json")) as { admin: Record<string, Record<string, unknown>> };

/** 주석을 걷은 CSS 의 `선택자 { 본문 }` 쌍(가장 안쪽 블록) — tests/admin-nav.test.ts 와 같은 방식. */
function cssRules(css: string): { selector: string; body: string; media: string | null }[] {
  const out: { selector: string; body: string; media: string | null }[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const mediaRe = /@media([^{]+)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
  const medias: { start: number; end: number; query: string }[] = [];
  for (const m of stripped.matchAll(mediaRe)) medias.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, query: m[1].trim() });
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (selector.startsWith("@")) continue;
    const at = m.index ?? 0;
    const media = medias.find((x) => at > x.start && at < x.end)?.query ?? null;
    out.push({ selector: selector.replace(/^@media[^{]*/, "").trim(), body: m[2], media });
  }
  return out;
}
const decl = (body: string, prop: string): string | null => new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim() ?? null;
const rules = cssRules(read(ADMIN_CSS));
/** 선택자 목록(`a,\n b`)은 나눠서 본다. */
const bodyOf = (selector: string, media: string | null = null, list = rules) =>
  list
    .filter((r) => r.media === media && r.selector.split(",").map((s) => s.trim()).includes(selector))
    .map((r) => r.body)
    .join(";");
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// =============================================================================
// C-14 · C-15 — 조각
// =============================================================================
describe("C-14 · C-15 — 메타 줄 조각 · 문장 조각", () => {
  const html = (nodes: unknown) => renderToStaticMarkup(createElement("p", null, nodes as never));

  /**
   * 라운드 3(컨트롤러 1) — 줄 머리에서 잘려 나가는 구분점. 라운드 2 는 '·' 를 다음 조각의 머리(DOM 글자)에 붙여 줄 머리에 '·' 가 섰다.
   * 이제 '·' 는 CSS(`.seg::before`)가 그리는 장식이고 DOM 글자에 없다 — 바깥 상자(.segs)가 왼쪽 가장자리를 잘라 줄 머리 조각의 '·' 를 감춘다.
   */
  test("🔴 조각 줄 — 바깥 상자(.segs) › 안쪽 상자(.segsIn) › 조각(.seg) · 구분점은 DOM 글자가 아니다(읽히지 않는다) · 조각 사이는 빈칸 하나", () => {
    const out = html(segments(["35인승 관광버스 1대", "30명", "1박 2일"]));
    // vitest 의 CSS 모듈 이름은 `_seg_<해시>` 모양이다 — 클래스 이름을 이름표로 바꿔 모양을 본다
    const shape = out.replace(/class="_(\w+?)_[0-9a-f]+"/g, 'class="$1"');
    expect(shape).toBe(
      '<p><span class="segs"><span class="segsIn"><span class="seg">35인승 관광버스 1대</span> <span class="seg">30명</span> <span class="seg">1박 2일</span></span></span></p>',
    );
    expect(text(out)).toBe("35인승 관광버스 1대 30명 1박 2일");
    expect(out, "구분점은 DOM 글자가 아니다(aria-hidden 글자도 없다)").not.toContain("·");
  });

  test("빈 조각(null · 빈 글자 · false)은 건너뛴다 — 조각 수가 곧 보이는 조각 수", () => {
    const out = html(segments(["예시고객", null, "", false, "30명"]));
    expect(text(out)).toBe("예시고객 30명");
    expect((out.match(/class="_seg_[0-9a-f]+"/g) ?? []).length).toBe(2);
    expect(text(html(segments([])))).toBe("");
  });

  test("🔴 붙은 구분점(glued · 라운드 3) — 한 조각 안의 두 부분을 '줄바꿈 없는 빈칸 · 읽히지 않는 가운데점 · 줄바꿈 없는 빈칸' 으로 잇는다", () => {
    const NB = String.fromCharCode(0xa0);
    const out = html(glued(["35인승 관광버스 1대", null, "30명"]));
    const shape = out.replace(/class="_(\w+?)_[0-9a-f]+"/g, 'class="$1"');
    // 가운데점 양쪽이 줄바꿈 없는 빈칸 — 줄은 그 자리에서 꺾이지 않는다('·' 가 줄 머리·끝에 서지 않고 인원만 떨어지지 않는다)
    expect(shape).toBe(`<p>35인승 관광버스 1대<span class="glue">${NB}<span aria-hidden="true">·</span>${NB}</span>30명</p>`);
    // 화면 읽기 — 가운데점은 가려지고(aria-hidden) 두 빈칸이 남아 띄어 읽는다(붙여 읽지 않는다)
    const spoken = out.replace(/<span aria-hidden="true">[^<]*<\/span>/g, "").replace(/<[^>]+>/g, "");
    expect(spoken).toBe(`35인승 관광버스 1대${NB}${NB}30명`);
    expect(spoken).not.toContain("·");
    // 부분이 하나면 구분점 없음
    expect(html(glued(["차량 미정", null]))).toBe("<p>차량 미정</p>");
    // 조각 사이 구분점과 같은 색 · 굵기(행의 옅은 굵은 글자 안에서도 가는 점)
    expect(decl(bodyOf(".glue"), "color")).toBe(decl(bodyOf(".seg::before"), "color"));
    expect(decl(bodyOf(".glue"), "font-weight")).toBe("400");
  });

  test("🔴 조각 안에서 한 줄보다 긴 낱말은 꺾는다(overflow-wrap: anywhere) — 바깥 상자의 자르기(clip)에 끝이 소리 없이 잘려 나가지 않게", () => {
    expect(decl(bodyOf(".seg"), "overflow-wrap")).toBe("anywhere");
  });

  test("🔴 줄표 덧말(dashUnits · 라운드 3) — 줄표 앞뒤가 한 덩어리씩 · 줄표는 앞 덩어리 끝에 줄바꿈 없는 빈칸으로 붙는다 · 글자는 그대로", () => {
    const NB = String.fromCharCode(0xa0);
    const owner = ((ko.admin.home as { card: Record<string, string> }).card.notifyOwner).replace("{n}", "1");
    expect(owner).toBe("사장님 알림 실패 1건 — 발송 기록에서 확인");
    const out = html(dashUnits(owner));
    const shape = out.replace(/class="_(\w+?)_[0-9a-f]+"/g, 'class="$1"');
    expect(shape).toBe(`<p><span class="unit">사장님 알림 실패 1건${NB}—</span> <span class="unit">발송 기록에서 확인</span></p>`);
    expect(text(out)).toBe(owner);
    // 줄표가 없으면 통째로 한 덩어리
    expect(html(dashUnits("고객 문자 대기 중 2건")).replace(/class="_(\w+?)_[0-9a-f]+"/g, 'class="$1"')).toBe('<p><span class="unit">고객 문자 대기 중 2건</span></p>');
    // 홈 문자 발송 카드의 사장님 쪽 실패 줄이 이것을 쓴다
    expect(codeOf("app/admin/(protected)/page.tsx")).toMatch(/<span className=\{a\.todoMinor\}>\{dashUnits\(t\("home\.card\.notifyOwner", \{ n: notify\.owner \}\)\)\}<\/span>/);
  });

  test("🔴 CSS — 구분점은 조각 왼쪽 바깥 틈에 걸리고(음수 여백 = 폭) · 안쪽 상자는 조각의 앞 여백만큼 당겨지고 · 바깥 상자가 왼쪽을 잘라 낸다", () => {
    expect(decl(bodyOf(".segs"), "display")).toBe("block");
    expect(decl(bodyOf(".segs"), "overflow-x"), "왼쪽 가장자리를 잘라 줄 머리 조각의 '·' 를 감춘다(세로는 그대로)").toBe("clip");
    expect(decl(bodyOf(".segs"), "overflow")).toBeNull();
    const pull = decl(bodyOf(".segsIn"), "margin-inline-start");
    const gapStart = decl(bodyOf(".seg"), "margin-inline-start");
    expect(pull).toBe("-0.65em");
    expect(gapStart, "당김 = 조각의 앞 여백(그래야 줄 머리 조각의 글자가 가장자리에 맞는다)").toBe("0.65em");
    expect(decl(bodyOf(".seg"), "display")).toBe("inline-block");
    expect(decl(bodyOf(".seg"), "max-width"), "당긴 폭만큼 뺀다 — 한 줄보다 긴 조각도 잘리지 않고 안에서 꺾인다").toBe("calc(100% - 0.65em)");
    const sep = bodyOf(".seg::before");
    // 구분점 상자 폭 = 음수 여백 = 틈(빈칸 약 0.25em + 앞 여백 0.65em) — 조각 사이 가운데에 선다
    expect(decl(sep, "width")).toBe("0.9em");
    expect(decl(sep, "margin-inline-start")).toBe("-0.9em");
    expect(decl(sep, "text-align")).toBe("center");
    // 읽히지 않는다 — 대체 글이 빈 글자(지원하지 않는 브라우저는 앞 선언의 '·' 만)
    expect(sep).toMatch(/content:\s*"·"\s*\/\s*""/);
    expect(decl(sep, "color")).toBe("var(--text-muted)");
  });

  test("🔴 단위가 혼자 떨어지지 않는다 — 대수는 앞 낱말에 붙고(keepLastWord) · 날짜 범위는 물결표 뒤에서만 꺾인다(<wbr>) · 노선 이름은 한 덩어리", () => {
    expect(keepLastWord("35인승 관광버스 1대")).toBe("35인승 관광버스 1대");
    expect(keepLastWord("미정")).toBe("미정");
    const row = codeOf("components/admin/reservationRow.tsx");
    expect(row).toMatch(/keepLastWord\(fillTemplate\(ctx\.labels\.busValue/);
    expect(row).toMatch(/\{range\.slice\(0, at \+ 1\)\}\s*<wbr \/>\s*\{range\.slice\(at \+ 1\)\}/);
    expect(row).toMatch(/rangeNode\(stay\.range\)/);
    expect(codeOf("app/admin/(protected)/routes/page.tsx")).toMatch(/className=\{`\$\{a\.td\} \$\{a\.tdStrong\} \$\{a\.tdNowrap\}`\}/);
    // 통계 확정률 "17건 중 9건 · 53%" 도 조각(좁은 카드에서 '·' 가 줄 끝에 남았다)
    expect(codeOf("app/admin/(protected)/stats/page.tsx")).toMatch(/segments\(splitSegments\(t\("overview\.confirmedValue"/);
    // 업로드 안내의 형식 나열은 쉼표(가운데점이 줄 끝에 남았다)
    expect((ko.admin.gallery as Record<string, string>).uploadHint).toContain("jpg, png, webp, heic");
  });

  test("리뷰 참고 — 같은 업로더 안의 형식 나열은 한 모양(쉼표): 거부 사유 '받을 수 없는 형식' 도 안내와 같은 목록", () => {
    const g = ko.admin.gallery as Record<string, unknown>;
    const list = /jpg(?:, [a-z]+)+/.exec(String(g.uploadHint))?.[0];
    expect(list).toBe("jpg, png, webp, heic");
    const type = (g.reject as Record<string, string>).type;
    expect(type).toContain(list);
    expect(type).not.toMatch(/jpg · /);
  });

  test("카탈로그 문장을 ' · ' 로 나눈다 — 조각이 없으면 통째로 하나", () => {
    expect(splitSegments("노출 중 2건 · 마지막 게시일 9월 27일 (일)")).toEqual(["노출 중 2건", "마지막 게시일 9월 27일 (일)"]);
    expect(splitSegments("지금은 상태를 불러오지 못했어요")).toEqual(["지금은 상태를 불러오지 못했어요"]);
  });

  test("🔴 문장 조각 — 두 문장 안내는 문장마다 한 덩어리('…알려 / 주세요.' 방지) · 글자는 그대로 · 구분점 없음(.unit)", () => {
    const hint = (ko.admin.detail as Record<string, string>).cancelHint;
    const out = html(sentences(hint));
    expect(text(out)).toBe(hint);
    expect([...out.matchAll(/<span class="_unit_[0-9a-f]+">/g)]).toHaveLength(2);
    expect(out).toMatch(/<span class="_unit_[0-9a-f]+">전화로 알려 주세요\.<\/span>/);
    expect(out, "문장 조각은 구분점을 받지 않는다(.seg 가 아니다)").not.toMatch(/class="_seg_/);
    expect(decl(bodyOf(".unit"), "display")).toBe("inline-block");
  });

  test("🔴 목록 카드의 메타 줄도 같은 조각 줄 — 날짜·시각 / 차량·인원 두 조각(차량과 인원은 붙은 구분점으로 한 조각) · 표 모양(≥1024)에서는 칸으로 풀리고 구분점을 걷는다", () => {
    const row = codeOf("components/admin/reservationRow.tsx");
    expect(row).toMatch(/className=\{`\$\{s\.inqMeta\} \$\{s\.segs\}`\}/);
    expect(row).toMatch(/<span className=\{s\.segsIn\}>/);
    expect(row).toMatch(/className=\{`\$\{s\.seg\} \$\{s\.inqWhen\}`\}/);
    // 라운드 3 — 인원만 다음 줄로 떨어지지 않는다("…1대 / 30명"): 차량·인원이 한 조각(.seg.inqBus) 안에서 glued 로 붙는다
    expect(row).toMatch(/<span className=\{`\$\{s\.seg\} \$\{s\.inqBus\}`\}>\s*\{glued\(\[/);
    expect([...row.matchAll(/<span className=\{s\.seg\}>/g)], "차량과 인원을 따로 조각으로 두지 않는다").toHaveLength(0);
    expect(row, "옛 DOM 가운데점(inqSep)이 남지 않았다").not.toMatch(/inqSep/);
    const TABLE = "(min-width: 1024px)";
    expect(decl(bodyOf('.inqTable[data-layout="table"] .inqMeta > .segsIn', TABLE), "display")).toBe("contents");
    expect(decl(bodyOf('.inqTable[data-layout="table"] .inqMeta .seg::before', TABLE), "content")).toBe("none");
    expect(decl(bodyOf('.inqTable[data-layout="table"] .inqMeta .seg', TABLE), "margin-inline-start")).toBe("0");
    expect(decl(bodyOf('.inqTable[data-layout="table"] .inqWhen', TABLE), "display")).toBe("flex");
    // 표의 차량·인원 칸은 두 줄(차량 / 인원) — 붙은 구분점은 걷는다(표 칸 display:flex 세로가 .seg 의 inline-block 을 이긴다)
    expect(decl(bodyOf('.inqTable[data-layout="table"] .inqBus', TABLE), "display")).toBe("flex");
    expect(decl(bodyOf('.inqTable[data-layout="table"] .inqBus', TABLE), "flex-direction")).toBe("column");
    expect(decl(bodyOf('.inqTable[data-layout="table"] .inqBus .glue', TABLE), "display")).toBe("none");
    // "시각 · 남은 날" 은 한 덩어리 — 붙은 구분점(glued: 가운데점 앞뒤가 줄바꿈 없는 빈칸 — 줄 머리·끝 모두 막는다 · 모양은 아래 glued 테스트)
    expect(row).toMatch(/<span className=\{s\.inqTime\}>[\s\S]{0,200}?\{glued\(\[[\s\S]{0,200}?\{time\.text\}[\s\S]{0,200}?\{relative\}/);
    // 구간 옆 덧말("왕복 · 1박 2일")은 줄바꿈 없는 한 덩어리 — 통째로 움직이고 붙은 구분점이라 가운데점이 줄 머리·끝에 서지 않는다(목록 행 · 다가오는 운행 줄)
    expect([...row.matchAll(/className=\{`\$\{s\.inqMuted\} \$\{s\.nowrap\}`\}>\{glued\(aside\)\}/g)]).toHaveLength(2);
    // 다가오는 운행 줄 — 이름 · (날짜 범위) · 차량·인원(붙은 한 조각)
    expect(row).toMatch(/segments\(\[row\.name, stay\?\.range \?\? null, glued\(\[vehicle\.text, pax\]\)\]\)/);
    expect(decl(bodyOf(".nowrap"), "white-space")).toBe("nowrap");
  });

  test.each([
    ["components/admin/reservationRow.tsx", "목록·홈 카드 줄(차량 · 인원) · 다가오는 운행 줄 · 구간 옆 왕복·기간"],
    ["app/admin/(protected)/reservations/[id]/page.tsx", "상세 한 줄 메타(접수번호 P523N001 이 한 덩어리)"],
    ["app/admin/(protected)/page.tsx", "홈 이번 주 운행 날짜 · 홈페이지 점검 줄"],
    ["app/admin/(protected)/site/page.tsx", "허브 한 줄 상태"],
    ["app/admin/(protected)/records/page.tsx", "기록 허브 한 줄 상태(문제 여럿)"],
    ["app/admin/(protected)/stats/page.tsx", "통계 기간 줄('…기준으로 세요.') · 추세 안내"],
    ["app/admin/(protected)/notifications/page.tsx", "발송 기록 알림 칸(종류 · 문자 종류)"],
  ])("🔴 %s — %s 는 조각으로 그린다(segments)", (rel) => {
    expect(codeOf(rel)).toMatch(/\bsegments\(/);
  });

  test("🔴 옛 모양이 돌아오지 않았다 — 메타 줄을 ' · ' 로 이어 붙인 한 글자열이 아니다", () => {
    // 라운드 3 — 목록 행에는 " · " 잇기가 없다(구간 옆 덧말도 붙은 구분점 glued · 가운데점은 읽히지 않는다)
    expect([...codeOf("components/admin/reservationRow.tsx").matchAll(/\.join\(" · "\)/g)]).toHaveLength(0);
    expect(codeOf("app/admin/(protected)/page.tsx")).not.toMatch(/\.join\(" · "\)/);
    // 상세 메타의 가운데점을 글자로 끼워 넣지 않는다
    const detail = codeOf("app/admin/(protected)/reservations/[id]/page.tsx");
    const meta = detail.slice(detail.indexOf('data-testid="admin-detail-meta"'), detail.indexOf("</p>", detail.indexOf('data-testid="admin-detail-meta"')));
    expect(meta).not.toContain('{" · "}');
  });

  test("취소 안내는 문장 조각으로(처리 카드 · 휴대폰 맨 아래 두 곳)", () => {
    const src = codeOf("components/admin/ReservationProcess.tsx");
    expect([...src.matchAll(/sentences\(labels\.cancelHint\)/g)]).toHaveLength(2);
  });

  test("🔴 C-15 — 관리자 셸은 낱말 안에서 꺾지 않고(keep-all) 문단 끝 외톨이를 줄인다(text-wrap: pretty — 상속)", () => {
    expect(decl(bodyOf(".shell"), "word-break")).toBe("keep-all");
    expect(decl(bodyOf(".shell"), "text-wrap")).toBe("pretty");
    const home = ko.admin.home as { card: Record<string, string> };
    expect(home.card.overdueSub).toBe("72시간 넘게 대기");
  });
});

// =============================================================================
// C-16 · C-17 — 탭 줄 옅음 · 12px
// =============================================================================
describe("C-16 · C-17 — 상태 탭 줄 · 글자 크기", () => {
  test("🔴 탭 줄이 밀릴 수 있으면 가려진 쪽 끝을 옅게 — TabIntoView 가 data-fade-start/end 를 달고 CSS 가 mask 로 그린다", () => {
    const src = codeOf("components/admin/TabIntoView.tsx");
    expect(src).toMatch(/dataset\.fadeStart\s*=/);
    expect(src).toMatch(/dataset\.fadeEnd\s*=/);
    expect(src).toMatch(/addEventListener\("scroll"/);
    expect(src).toMatch(/removeEventListener\("scroll"/);
    // 지금 탭을 보이는 자리로 미는 옛 동작은 그대로(tests/admin-list.test.ts 가 같이 잠근다)
    expect(src).toMatch(/scrollIntoView\(\{\s*inline:\s*"nearest",\s*block:\s*"nearest"\s*\}\)/);
    for (const sel of ['.statusTabs[data-fade-end="true"]', '.statusTabs[data-fade-start="true"]', '.statusTabs[data-fade-start="true"][data-fade-end="true"]']) {
      expect(decl(bodyOf(sel), "mask-image"), sel).toMatch(/^linear-gradient\(/);
    }
    // 끝 쪽만 옅다 — 가운데(다 보이는 탭)는 불투명
    expect(decl(bodyOf('.statusTabs[data-fade-end="true"]'), "mask-image")).toMatch(/calc\(100% - 2\.5rem\), transparent\)$/);
  });

  test("🔴 리뷰 P2-2 — 지금 탭·포커스 탭은 옅은 띠 밑에 서지 않는다: 탭 줄의 scroll-padding-inline = 옅은 띠의 폭(scrollIntoView 와 포커스 스크롤이 둘 다 따른다)", () => {
    // 옅은 띠의 폭은 마스크에서 읽는다(calc(100% - 폭)) — 둘 중 하나만 바뀌면 여기서 걸린다
    const fade = /calc\(100% - ([0-9.]+rem)\)/.exec(decl(bodyOf('.statusTabs[data-fade-end="true"]'), "mask-image") ?? "")?.[1];
    expect(fade).toBeDefined();
    expect(decl(bodyOf(".statusTabs"), "scroll-padding-inline")).toBe(fade);
    // 양쪽 옅음도 같은 폭
    expect(decl(bodyOf('.statusTabs[data-fade-start="true"]'), "mask-image")).toContain(`calc(100% - ${fade})`);
  });

  test("🔴 리뷰 P2-2 — 키보드 포커스 탭도: 브라우저 포커스 스크롤은 반쯤 보이는 탭을 밀지 않는다(크롬 실측 — 끝이 줄 밖 7.6px 인 채 옅은 띠 밑) → 탭 줄의 focusin 에서 그 탭을 nearest 로 민다(scroll-padding 을 따른다)", () => {
    const src = codeOf("components/admin/TabIntoView.tsx");
    expect(src).toMatch(/nav\.addEventListener\("focusin", reveal\)/);
    expect(src).toMatch(/nav\.removeEventListener\("focusin", reveal\)/);
  });

  /**
   * 재검토 P1-A — 위 처리기가 **마우스·터치 포커스에도** 돌았다. 크롬은 링크를 mousedown 에서 포커스하므로, 반쯤 가려진 탭(375 의 '취소')의
   * 끝 쪽을 누르면 누르는 사이에 탭 줄이 밀리고 click 이 링크가 아니라 두 대상의 공통 조상 `<ul>` 에 떨어졌다 — 탭이 바뀌지 않았다(리뷰 실측 70 · 85 · 95%).
   * 이제 포커스가 **키보드 포커스(:focus-visible)** 일 때만 민다. focusin 안에서 :focus-visible 은 마우스·터치 false · 키보드 true 다.
   */
  test("🔴 재검토 P1-A — focusin 에서 미는 것은 :focus-visible(키보드 포커스)일 때만 · 판정을 먼저 보고 민다", () => {
    // 판정은 순수 함수 — DOM 없이 가짜 요소로 본다. 가짜는 ':focus-visible' 을 물었을 때만 참을 돌려준다(':focus' 로 바꾸면 여기서 걸린다)
    const el = (keyboard: boolean) => ({ matches: (sel: string) => sel === ":focus-visible" && keyboard, scrollIntoView: () => undefined });
    expect(revealsOnFocus(el(true) as unknown as EventTarget)).toBe(true);
    expect(revealsOnFocus(el(false) as unknown as EventTarget), "마우스·터치 포커스는 밀지 않는다").toBe(false);
    expect(revealsOnFocus(null)).toBe(false);
    expect(revealsOnFocus({} as EventTarget), "요소가 아닌 대상").toBe(false);
    // 처리기 — 그 판정이 참일 때만 지금 탭과 같은 방식(가장 가까운 자리 · 세로도 가장 가까운 자리)으로 민다
    const src = codeOf("components/admin/TabIntoView.tsx");
    expect(src).toMatch(/const reveal = \(e: FocusEvent\) => \{\s*if \(revealsOnFocus\(e\.target\)\) e\.target\.scrollIntoView\(\{ inline: "nearest", block: "nearest" \}\);\s*\};/);
    expect(src, "판정 없이 미는 옛 모양").not.toMatch(/if \(e\.target instanceof HTMLElement\) e\.target\.scrollIntoView/);
  });

  test("🔴 관리자 화면 글자는 12px 아래가 없다 — 관리자 CSS 모듈 전부(탭 바 배지가 11px 이었다)", () => {
    const files = [
      ...readdirSync(path.join(ROOT, "components/admin"))
        .filter((f) => f.endsWith(".module.css"))
        .map((f) => `components/admin/${f}`),
      LOGIN_CSS,
    ];
    expect(files).toContain(ADMIN_CSS);
    const small: string[] = [];
    for (const rel of files) {
      for (const r of cssRules(read(rel))) {
        const v = decl(r.body, "font-size");
        if (v === null) continue;
        const px = /^(\d+(?:\.\d+)?)px$/.exec(v);
        const rem = /^(\d+(?:\.\d+)?)rem$/.exec(v);
        const size = px ? Number(px[1]) : rem ? Number(rem[1]) * 16 : null;
        if (size !== null && size < 12) small.push(`${rel} — ${r.selector} { font-size: ${v} }`);
      }
    }
    expect(small).toEqual([]);
    expect(decl(bodyOf(".tabCount"), "font-size")).toBe("12px");
  });
});

// =============================================================================
// B-5 · B-6 · B-8 — 목록 표
// =============================================================================
describe("B-5 · B-6 · B-8 — 목록 표와 카드", () => {
  test("🔴 B-5 공지·팝업 — 표는 1024px 이상 · 그보다 좁으면 카드(제목 한 줄 전체 · 분류/날짜/상태 이어서 · 버튼 한 줄 전체) · 행 버튼 글자는 꺾이지 않는다", () => {
    for (const [page, table] of [
      ["app/admin/(protected)/notices/page.tsx", "admin-notices-table"],
      ["app/admin/(protected)/popups/page.tsx", "admin-popups-table"],
      // 대표 노선도 같은 카드(노선 이름을 한 덩어리로 두자 375 표가 옆으로 밀렸다 — 라운드 2 실측)
      ["app/admin/(protected)/routes/page.tsx", "admin-routes-table"],
    ] as const) {
      const src = codeOf(page);
      expect(src, page).toContain(`data-testid="${table}"`);
      expect(src, page).toMatch(/a\.contentTable/);
      expect(src, page).toMatch(/a\.contentWrap/);
      for (const cell of ["title", "meta", "actions"]) expect(src, `${page} data-cell=${cell}`).toContain(`data-cell="${cell}"`);
    }
    const NARROW = "(max-width: 1023.98px)";
    expect(decl(bodyOf(".contentTable tr", NARROW), "display")).toBe("flex");
    expect(decl(bodyOf(".contentTable tr", NARROW), "flex-wrap")).toBe("wrap");
    expect(decl(bodyOf('.contentTable td[data-cell="title"]', NARROW), "flex")).toBe("1 1 100%");
    expect(decl(bodyOf(".rowActions > .btnSecondary"), "white-space")).toBe("nowrap");
    expect(decl(bodyOf(".rowActions > .rowLink"), "white-space"), "[공지 고치기] 링크도 한 줄").toBe("nowrap");
    expect(decl(bodyOf(".tableMiddle .rowActions", "(min-width: 1024px)"), "flex-wrap"), "표 모양에서는 [고치기][노출 끄기] 가 나란히").toBe("nowrap");
  });

  test("🔴 B-6 발송 기록 — 옛 68rem 표(.table)가 아니다 · 표 최소 폭 없음 · 1280px 미만 카드(칸 라벨이 보인다 · 빈 오류 칸은 숨김)", () => {
    const src = codeOf("app/admin/(protected)/notifications/page.tsx");
    expect(src).toMatch(/className=\{a\.notifyTable\}/);
    expect(src).not.toMatch(/className=\{a\.table\}/);
    expect(decl(bodyOf(".notifyTable"), "min-width")).toBeNull();
    expect(decl(bodyOf(".table"), "min-width"), "다른 넓은 표(통계 등)의 옛 규칙은 그대로").toBe("68rem");
    const CARD = "(max-width: 1279.98px)";
    expect(decl(bodyOf(".notifyTable thead", CARD), "display")).toBe("none");
    expect(decl(bodyOf(".notifyTable .cellLabel", CARD), "display")).toBe("block");
    expect(decl(bodyOf('.notifyTable td[data-empty="true"]', CARD), "display")).toBe("none");
    expect(decl(bodyOf(".cellLabel"), "display"), "표에서는 칸 라벨을 그리지 않는다(머리글이 한다)").toBe("none");
  });

  test("B-8 대표 노선 — 칸마다 세로 가운데(글자·배지·버튼이 한 줄에) · 공지·팝업 표도 같은 규칙", () => {
    expect(decl(bodyOf(".tableMiddle .td"), "vertical-align")).toBe("middle");
    for (const page of ["app/admin/(protected)/routes/page.tsx", "app/admin/(protected)/notices/page.tsx", "app/admin/(protected)/popups/page.tsx"]) {
      expect(codeOf(page), page).toMatch(/a\.tableMiddle/);
    }
    // 발송 기록(여러 줄 칸)은 위 맞춤 그대로
    expect(codeOf("app/admin/(protected)/notifications/page.tsx")).not.toMatch(/tableMiddle/);
  });
});

// =============================================================================
// B-9 · B-10 · B-11 · B-12 — 폼 · 갤러리 · 홈 · 체크 상자
// =============================================================================
describe("B-9 · B-10 · B-11 · B-12 — 폼 간격 · 갤러리 · 홈 절 머리 · 체크 상자 색", () => {
  test("🔴 B-9 — 칸 묶음(.dateRow) 뒤에도 칸 묶음과 같은 간격('표시 금액' 이름이 선택 칸에 붙지 않는다) · 묶음 안에서는 묶음의 간격", () => {
    expect(decl(bodyOf(".dateRow"), "margin")).toBe(`0 0 ${decl(bodyOf(".field"), "margin")?.split(" ").at(-1)}`);
    expect(decl(bodyOf(".field"), "margin")).toBe("0 0 var(--space-stack-md)");
    expect(decl(bodyOf(".field .dateRow"), "margin")).toBe("0");
    // 이름 → 안내 → 입력칸 — 사이는 묶음의 gap 하나(안내 문단의 위 여백을 겹쳐 쌓지 않는다)
    expect(decl(bodyOf(".field > .hint"), "margin")).toBe("0");
    expect(decl(bodyOf(".dateCol > .hint"), "margin")).toBe("0");
  });

  test("🔴 B-9 — 체크 줄 이름 충돌을 풀었다: 홈 점검 줄은 .checkItem, 폼 체크 줄 .checkRow 는 한 번만 정의된다", () => {
    const base = rules.filter((r) => r.media === null && r.selector.split(",").map((s) => s.trim()).includes(".checkRow"));
    expect(base, ".checkRow 가 두 곳에서 정의됐다(CSS 모듈은 같은 이름을 한 클래스로 합친다)").toHaveLength(1);
    expect(decl(base[0].body, "display")).toBe("flex");
    expect(decl(bodyOf(".checkItem"), "display")).toBe("grid");
    const home = codeOf("app/admin/(protected)/page.tsx");
    expect(home).toMatch(/className=\{a\.checkItem\} data-check="popups"/);
    expect(home).not.toMatch(/a\.checkRow/);
  });

  test("B-9 — 팝업 노출 기간도 이름 → 안내 → 날짜 칸 순서(묶음 이름은 group 의 이름) · 체크 칸은 안내와 한 묶음(.field)", () => {
    const src = codeOf("components/admin/PopupForm.tsx");
    const group = src.slice(src.indexOf('aria-labelledby="popup-period-label"'));
    const [label, hint, starts] = ['id="popup-period-label"', 'id="popup-period-hint"', 'id="popup-starts"'].map((s) => group.indexOf(s));
    expect(label).toBeGreaterThan(0);
    expect(label).toBeLessThan(hint);
    expect(hint).toBeLessThan(starts);
    expect((ko.admin.popups as { field: Record<string, string> }).field.period).toBe("노출 기간");
    for (const [rel, id] of [
      ["components/admin/PopupForm.tsx", "popup-active"],
      ["components/admin/NoticeForm.tsx", "notice-active"],
      ["components/admin/RouteForm.tsx", "route-active"],
    ] as const) {
      const code = codeOf(rel);
      const at = code.indexOf(`id="${id}"`);
      const before = code.slice(0, at);
      // 체크 칸 바로 앞의 여는 묶음 두 개가 .field → .checkRow
      expect(before.lastIndexOf("className={s.field}"), rel).toBeGreaterThan(before.lastIndexOf("</div>"));
      expect(code.indexOf(`id="${id}-hint"`), rel).toBeGreaterThan(at);
    }
  });

  test("🔴 B-10 사진 고르기 — 진짜 입력칸은 그대로(라벨로 이름 · 보이지 않게 접었을 뿐 포커스 받음 · 키보드로 연다) · 버튼 모양 라벨 + 고른 장수 한 줄", () => {
    const src = codeOf("components/admin/GalleryUploader.tsx");
    expect(src).toMatch(/id="gallery-upload-input"[\s\S]{0,80}className=\{s\.fileInput\}/);
    expect(src).toMatch(/type="file"/);
    expect(src).toMatch(/<label className=\{`\$\{s\.btnSecondary\} \$\{s\.pickButton\}`\} htmlFor="gallery-upload-input"/);
    expect(src).toMatch(/aria-describedby="gallery-upload-count"/);
    expect(src).toMatch(/id="gallery-upload-count"/);
    expect(src, "입력칸을 없애거나 tabIndex 로 빼지 않는다").not.toMatch(/tabIndex=\{-1\}[\s\S]{0,40}gallery-upload-input|gallery-upload-input[\s\S]{0,200}tabIndex=\{-1\}/);
    // 키보드 — Space 는 브라우저가 연다 · 버튼 모양이라 Enter 로도 연다
    expect(src).toMatch(/if \(e\.key === "Enter"\) \{\s*e\.preventDefault\(\);\s*e\.currentTarget\.click\(\);/);
    // 접는 방법 — 화면에서만 사라지고 포커스·키보드는 살아 있다(display:none · visibility:hidden 금지)
    const hidden = bodyOf(".fileInput");
    expect(decl(hidden, "clip-path")).toBe("inset(50%)");
    expect(decl(hidden, "display")).toBeNull();
    expect(decl(hidden, "visibility")).toBeNull();
    expect(decl(bodyOf(".fileInput:focus-visible + .pickRow .pickButton"), "outline")).toBe("2px solid var(--focus-ring)");
    const g = ko.admin.gallery as Record<string, string>;
    expect(g.upload).toBe("사진 고르기");
    expect(g.pickNone).toMatch(/요$/);
    expect(g.pickCount).toContain("{n}");
    expect(codeOf("app/admin/(protected)/gallery/page.tsx")).toMatch(/pickCount: t\.raw\("pickCount"\)/);
  });

  test("B-10 — 업로드 안내와 '넣을 앨범' 사이 간격 · 앨범 줄의 상태 배지는 줄 머리(버튼 줄에는 저장 · 노출 두 버튼만)", () => {
    expect(decl(bodyOf(".uploaderHint"), "margin")).toBe("0 0 var(--space-stack-md)");
    expect(codeOf("components/admin/GalleryUploader.tsx")).toMatch(/className=\{`\$\{s\.hint\} \$\{s\.uploaderHint\}`\}/);
    const albums = codeOf("components/admin/GalleryAlbums.tsx");
    const row = albums.slice(albums.indexOf('data-testid="admin-gallery-album"'));
    expect(row.indexOf("className={s.albumState}")).toBeGreaterThan(0);
    expect(row.indexOf("className={s.albumState}")).toBeLessThan(row.indexOf("className={s.dateRow}"));
    const actions = row.slice(row.indexOf("className={s.rowActions}"), row.indexOf("<CopyWarningPanel"));
    expect(actions).not.toMatch(/s\.badge/);
    expect([...actions.matchAll(/<button/g)]).toHaveLength(2);
  });

  test("🔴 B-11 — 관리 홈 절 머리는 링크(44px)가 있든 없든 같은 높이 · 제목은 그 가운데 → '새 접수' 와 '다가오는 운행' 이 한 줄에 선다", () => {
    expect(decl(bodyOf(".secHead"), "min-height")).toBe("44px");
    expect(decl(bodyOf(".secHead"), "align-items")).toBe("center");
    expect(decl(bodyOf(".secLink"), "min-height")).toBe("44px");
  });

  test("🔴 B-12 — 체크 상자·라디오는 역할 토큰의 accent-color(브라우저 기본 빨강·파랑이 아니다)", () => {
    for (const sel of ['.shell input[type="checkbox"]', '.shell input[type="radio"]']) {
      expect(decl(bodyOf(sel), "accent-color"), sel).toBe("var(--action-primary-bg)");
    }
  });
});

// =============================================================================
// B-13 · A-4 — 로그인 · 옛 위저드 라벨
// =============================================================================
describe("B-13 · A-4 — 로그인 · 라벨 띄어쓰기", () => {
  test("🔴 B-13 로그인 — 낱말 안에서 꺾지 않고(keep-all) 긴 주소만 어디서든(anywhere) · 문단 끝 외톨이 줄임 · 카드 머리에 브랜드 표식과 '{브랜드} 관리'", () => {
    const login = cssRules(read(LOGIN_CSS));
    const main = bodyOf(".main", null, login);
    expect(decl(main, "word-break")).toBe("keep-all");
    expect(decl(main, "overflow-wrap")).toBe("anywhere");
    expect(decl(main, "text-wrap")).toBe("pretty");
    const page = codeOf("app/admin/login/page.tsx");
    expect(page).toMatch(/data-testid="admin-login-brand"/);
    expect(page).toMatch(/src="\/brand\/symbol-mark\.png"/);
    expect(page).toMatch(/tTabs\("brand"\)/);
    // 브랜드가 제목(h1)보다 먼저
    expect(page.indexOf('data-testid="admin-login-brand"')).toBeLessThan(page.indexOf("<h1"));
    // 사장님 요청 14 · 결정 1(2026-10-10): 셸 이름의 브랜드도 원장 간판(베스트모빌리티)이다 — "베스트투어 관리" → "베스트모빌리티 관리".
    expect((ko.admin.tabs as Record<string, string>).brand).toBe(`${COMPANY.brandName} 관리`);
  });

  test("A-4 — 옛 위저드 라벨: '가족 여행' · '세금계산서 발행' · '외국인 의전·관광' (부가세(VAT)는 그대로)", () => {
    const labels = ko.admin.labels as Record<string, Record<string, string>>;
    expect(labels.purpose.family).toBe("가족 여행");
    expect(labels.payment.tax_invoice).toBe("세금계산서 발행");
    expect(labels.purpose.foreign_vip).toBe("외국인 의전·관광");
    expect(JSON.stringify(ko.admin)).toContain("부가세(VAT)");
  });
});

// =============================================================================
// 라운드 3 (컨트롤러 2 · 3 · 4) — 홈 카드 이름 · 발송 기록 요약 600px 미만 · 대표 노선 안내 카드 위 여백
// =============================================================================
describe("라운드 3 — 홈 카드 이름 · 요약 줄 쌓기 · 안내 카드 위 여백", () => {
  test("🔴 2 — 홈 카드 이름: 화살표는 이름 폭을 가져가지 않는다(겹치는 9px + 3px 만 비움) · 꺾이면 앞에서부터 채운다(wrap — 셸의 pretty 를 끔) · 400px 미만은 14px", () => {
    const label = bodyOf(".todoLabel");
    expect(decl(label, "padding")).toBe("0 calc(var(--space-inline-xs) * 1.5) 0 0");
    expect(decl(label, "text-wrap"), "pretty 는 '접수' 가 혼자 남지 않게 '답이 / 늦은 접수' 로 당겼다 — 이름은 '답이 늦은 / 접수'").toBe("wrap");
    expect(decl(bodyOf(".todoLabel", "(max-width: 399.98px)"), "font-size")).toBe("14px");
    // 화살표 자리(오른쪽 8px · 18px 폭) — 이 값이 바뀌면 위 비움 폭도 다시 재야 한다
    expect(decl(bodyOf(".todoArrow"), "right")).toBe("var(--space-inline-xs)");
    expect(decl(bodyOf(".todoArrow"), "width")).toBe("18px");
    // 이름에 줄바꿈 없는 빈칸을 끼우지 않는다(라운드 2 의 keepLastWord 는 "답이 / 늦은 접수" 를 만들었다)
    expect(codeOf("app/admin/(protected)/page.tsx")).not.toMatch(/keepLastWord/);
  });

  test("🔴 2 — 홈 카드 덧말은 줄 길이를 고르게(balance) — 320px 에서 '…켜지지 않았을 수 / 있어요' 처럼 마지막 줄에 낱말 하나만 남지 않는다(셸의 pretty 가 남겼다)", () => {
    expect(decl(bodyOf(".todoSub"), "text-wrap")).toBe("balance");
    expect(decl(bodyOf(".todoMinor"), "text-wrap")).toBe("balance");
    // 카드 이름은 덧말 규칙을 따르지 않고 앞에서부터 채운다(wrap — 꺾이면 "답이 늦은 / 접수")
    expect(decl(bodyOf(".todoLabel"), "text-wrap")).toBe("wrap");
  });

  test("🔴 3 — 발송 기록 요약: 600px 미만은 한 칸씩 전체 폭 줄(이름 왼쪽 · 숫자와 기간 오른쪽) · 오른쪽 붙임은 상자째(글줄 오른쪽 정렬 아님 — 조각 구분점이 잘려야 한다)", () => {
    const NARROW = "(max-width: 599.98px)";
    expect(decl(bodyOf(".summaryGrid", NARROW), "grid-template-columns")).toBe("minmax(0, 1fr)");
    const item = bodyOf(".summaryItem", NARROW);
    expect(decl(item, "display")).toBe("grid");
    expect(decl(item, "grid-template-columns")).toBe("minmax(0, 1fr) auto");
    expect(item).toMatch(/grid-template-areas:\s*"label num"\s*"label period"/);
    expect(decl(bodyOf(".summaryLabel", NARROW), "grid-area")).toBe("label");
    expect(decl(bodyOf(".summaryNum", NARROW), "justify-self")).toBe("end");
    expect(decl(bodyOf(".summaryPeriod", NARROW), "justify-self")).toBe("end");
    expect(decl(bodyOf(".summaryPeriod", NARROW), "text-align"), "글줄 오른쪽 정렬이면 줄 머리 조각의 구분점이 가장자리에 닿지 않아 보인다").toBeNull();
    const g = (ko.admin.notifications as unknown as { summary: { grid: Record<string, string> } }).summary.grid;
    expect(g.sentUnconfirmed).toBe("기록 확인 필요");
    expect(g.sentUnconfirmedNote).toBe("발송됨 · 전체 기간");
    const page = codeOf("app/admin/(protected)/notifications/page.tsx");
    expect(page).toMatch(/splitSegments\(t\("summary\.grid\.sentUnconfirmedNote"\)\)/);
    expect(page).toMatch(/<dd className=\{a\.summaryPeriod\}>\{segments\(item\.period\)\}<\/dd>/);
  });

  test("🔴 4 — 카드의 첫 줄이 안내 문단이면 위 여백 0(대표 노선 맨 위 안내 카드가 빈 제목 자리처럼 떴다)", () => {
    expect(decl(bodyOf(".section > .hint:first-child"), "margin-top")).toBe("0");
    const routes = codeOf("app/admin/(protected)/routes/page.tsx");
    // 그 카드의 첫 자식이 안내 문단이다(규칙이 실제로 걸리는 자리)
    expect(routes).toMatch(/<section className=\{a\.section\}>\s*<p className=\{a\.hint\} data-testid="admin-routes-verbatim">/);
  });
});
