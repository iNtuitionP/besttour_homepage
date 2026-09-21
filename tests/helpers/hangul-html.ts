/**
 * 렌더된 HTML 에서 "한국어로 표시된 곳 밖의 한글" 을 찾는다 (P2-6 — `/en` 번역 게이트).
 *
 * 왜 필요한가
 *   `/en` 에는 한국어가 남아도 되는 곳이 정확히 두 종류뿐이다.
 *     (1) 법정 원장 텍스트 — 영문판은 컨트롤러가 따로 확정한다. 화면은 그 블록을 `lang="ko"` 로 표시한다.
 *     (2) 사장님·고객이 넣은 DB 자유 텍스트(공지·갤러리·접수 현황) — 번역 대상이 아니다. 기존 `data-testid` 컨테이너로 가린다.
 *   그 밖의 한글은 전부 번역이 빠진 것이다. 이 함수가 그것을 문자 그대로 뽑는다.
 *
 * 규칙
 *   - 텍스트 노드와 사람이 읽는/듣는 속성(alt·title·aria-label·placeholder·label·content)을 본다.
 *   - `lang` 이 `ko` 로 시작하는 요소와 그 자손은 통과(요소 자신의 속성 포함).
 *   - `allowTestIds` 에 든 `data-testid` 를 가진 요소와 그 자손도 통과.
 *   - `<script>`·`<style>` 내용은 보지 않는다 — RSC 페이로드(self.__next_f)가 메시지 카탈로그 전체를 싣는다.
 *   - 주석(`<!-- -->`)은 보지 않는다.
 *
 * DOM 라이브러리를 들이지 않는다(vitest 는 node 환경이고 패키지 추가는 이 태스크 범위 밖) — 작은 토크나이저다.
 * 판정이 틀리지 않는지는 tests/i18n-en.test.ts 의 픽스처 단언이 잠근다.
 */

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const RAW_TEXT = new Set(["script", "style"]);

/** 사람이 읽거나 듣는 속성 — 여기에 한글이 있으면 텍스트와 똑같이 취급한다. */
const READABLE_ATTRS = new Set(["alt", "title", "aria-label", "placeholder", "label", "content", "aria-roledescription"]);

export interface UnmarkedHangul {
  /** "text" 또는 속성 이름 */
  where: string;
  /** 요소 경로(가장 가까운 5개) */
  path: string;
  value: string;
}

interface Frame {
  tag: string;
  allowed: boolean;
}

function parseAttrs(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const m of raw.matchAll(re)) {
    out.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/**
 * 표시되지 않은 한글을 전부 돌려준다. 빈 배열이면 통과.
 * @param allowTestIds 이 `data-testid` 를 가진 요소의 하위는 검사하지 않는다(DB 자유 텍스트 컨테이너).
 */
export function findUnmarkedHangul(html: string, allowTestIds: readonly string[] = []): UnmarkedHangul[] {
  const allowIds = new Set(allowTestIds);
  const stack: Frame[] = [{ tag: "#root", allowed: false }];
  const hits: UnmarkedHangul[] = [];
  const top = () => stack[stack.length - 1];
  const pathOf = () =>
    stack
      .slice(1)
      .slice(-5)
      .map((f) => f.tag)
      .join(" > ");

  const token = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|[^<]+|</g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(html)) !== null) {
    const [whole, closeTag, openTag, rawAttrs, selfClose] = m;

    if (whole.startsWith("<!")) continue; // 주석 · doctype

    if (closeTag !== undefined) {
      const name = closeTag.toLowerCase();
      const at = stack.map((f) => f.tag).lastIndexOf(name);
      if (at > 0) stack.length = at; // 짝이 맞는 곳까지 닫는다(느슨한 HTML 허용)
      continue;
    }

    if (openTag !== undefined) {
      const name = openTag.toLowerCase();
      const attrs = parseAttrs(rawAttrs ?? "");
      const lang = (attrs.get("lang") ?? "").toLowerCase();
      const testId = attrs.get("data-testid") ?? "";
      const allowed = top().allowed || lang.startsWith("ko") || allowIds.has(testId);

      if (!allowed) {
        for (const [attr, value] of attrs) {
          if (READABLE_ATTRS.has(attr) && HANGUL.test(decode(value))) {
            hits.push({ where: attr, path: `${pathOf()} > ${name}`, value: decode(value) });
          }
        }
      }

      if (RAW_TEXT.has(name)) {
        // 내용을 건너뛴다 — 닫는 태그까지
        const end = html.toLowerCase().indexOf(`</${name}`, token.lastIndex);
        token.lastIndex = end === -1 ? html.length : end;
        continue;
      }
      if (VOID.has(name) || selfClose === "/") continue;
      stack.push({ tag: name, allowed });
      continue;
    }

    // 텍스트
    const text = decode(whole);
    if (!top().allowed && HANGUL.test(text)) {
      hits.push({ where: "text", path: pathOf(), value: text.trim() });
    }
  }
  return hits;
}

/** `<title>` 의 텍스트(없으면 null). */
export function documentTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decode(m[1]).trim() : null;
}

/** `<meta name="description" content="…">` 값(없으면 null). */
export function metaDescription(html: string): string | null {
  for (const m of html.matchAll(/<meta\s+([^>]*?)\/?>/gi)) {
    const attrs = parseAttrs(m[1]);
    if (attrs.get("name") === "description") return decode(attrs.get("content") ?? "");
  }
  return null;
}

export { HANGUL };
