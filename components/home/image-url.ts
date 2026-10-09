/**
 * DB 의 image_path(gallery · popups) → <Image src> 로 쓸 URL (순수 함수).
 *
 * 저장 규약(P2-4 잠정, P6-2 갤러리 업로드가 확정한다):
 *   - "bucket/object.jpg" 형태의 상대 경로 = Supabase Storage **공개** 버킷 객체 → `${SUPABASE_URL}/storage/v1/object/public/…`
 *   - "https://…" 절대 URL 과 "/…" 로컬(public/) 경로는 그대로 쓴다.
 * next.config.ts 의 images.remotePatterns 가 이 호스트·경로만 허용한다.
 * Supabase URL 이 없으면 상대 경로를 해석할 수 없으므로 null — 깨진 이미지를 만들지 않는다(호출부가 이미지를 뺀다).
 */
const STORAGE_PUBLIC = "/storage/v1/object/public/";

export function resolveImageUrl(
  imagePath: string | null | undefined,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string | null {
  const p = (imagePath ?? "").trim();
  if (p === "") return null;
  if (/^https?:\/\//i.test(p) || p.startsWith("/")) return p;
  if (!supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/+$/, "")}${STORAGE_PUBLIC}${p.replace(/^\/+/, "")}`;
}
