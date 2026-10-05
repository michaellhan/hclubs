import * as cheerio from "cheerio";
import sharp from "sharp";

/**
 * Instagram profile pictures as club logos (ADR 0050, owner's extension of the §21 exception):
 * read from the same public profile page load that gives the follower count, downloaded once
 * (Instagram's image addresses are signed and expire within days) and served from our own
 * copy (`hci logo-files` → apps/web/public/logos/ig/).
 */

/** Instagram's stand-in picture for accounts without one (the grey silhouette). */
const DEFAULT_AVATAR =
  /44884218_345707102882519_2446069589734326272_n|464760996_1254146839119862_3605321457742435801_n/;

/** Profile picture files live under this CDN. */
export const INSTAGRAM_IMAGE_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;

/**
 * The profile picture's address on a rendered profile page, or null. Only the image the page
 * labels as this account's ("<handle>'s profile picture") counts, never a post or a story
 * avatar of another account. PURE.
 */
export function profilePictureUrl(html: string, handle: string, pageUrl = "https://www.instagram.com/"): string | null {
  const $ = cheerio.load(html);
  const want = `${handle.toLowerCase()}'s profile picture`;
  let src: string | undefined;
  $("img").each((_, el) => {
    if (src) return;
    if (($(el).attr("alt") ?? "").trim().toLowerCase() === want) src = $(el).attr("src");
  });
  if (!src) return null;
  try {
    const u = new URL(src, pageUrl);
    if (u.protocol !== "https:" || !INSTAGRAM_IMAGE_HOST.test(u.hostname)) return null;
    if (DEFAULT_AVATAR.test(u.pathname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * The picture's lasting identity: its address without the signed, expiring query. The same
 * picture keeps its file name; a new picture gets a new one. Used as the claim value. PURE.
 */
export function pictureKey(url: string): string {
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
}

/** File name our copy is served under (`/logos/ig/<name>.webp`). PURE. */
export function pictureFileName(url: string): string | null {
  try {
    const u = new URL(url);
    if (!INSTAGRAM_IMAGE_HOST.test(u.hostname)) return null;
    const base =
      u.pathname
        .split("/")
        .pop()
        ?.replace(/\.[a-z0-9]+$/i, "") ?? "";
    return /^[A-Za-z0-9_-]{8,200}$/.test(base) ? base : null;
  } catch {
    return null;
  }
}

/**
 * Whether a picture is Instagram's stand-in (a mid-grey silhouette on light grey), whatever
 * file it is served from: grey only, about two thirds light and a third mid grey, nothing else.
 */
export async function looksLikeDefaultAvatar(bytes: Uint8Array): Promise<boolean> {
  const { data, info } = await sharp(bytes)
    .flatten({ background: "#ffffff" })
    .resize(32, 32, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let light = 0;
  let mid = 0;
  const px = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 30) return false; // any colour: a real picture
    const l = (r + g + b) / 3;
    if (l >= 225) light++;
    else if (l >= 110 && l <= 170) mid++;
  }
  return light / px >= 0.5 && mid / px >= 0.18 && (light + mid) / px >= 0.9;
}

const MAX_PICTURE_BYTES = 2 * 1024 * 1024;

/** Download a profile picture right after the page load (its address expires). */
export async function downloadPicture(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array; contentType: string } | { error: string }> {
  try {
    const res = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    if (!contentType.startsWith("image/")) return { error: `not an image (${contentType || "no type"})` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_PICTURE_BYTES) return { error: "picture too large" };
    return { bytes, contentType };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
