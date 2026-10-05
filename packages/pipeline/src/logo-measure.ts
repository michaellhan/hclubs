import sharp from "sharp";
import type { ImageMeasure } from "./extract/logo";

/** Bump when the statistics below change meaning; older probes are measured again. */
export const MEASURE_VERSION = "2";

/** The tile logos sit on (stone-100, apps/web club-logo.tsx). */
const TILE = { r: 245, g: 245, b: 244 };
const lumOf = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const TILE_LUM = lumOf(TILE.r, TILE.g, TILE.b);

/** Images larger than this are decoded at a reduced size only (the statistics need few pixels). */
const SAMPLE = 96;

/**
 * Size, format and pixel statistics of an image (PNG, JPEG, WebP, GIF, AVIF, SVG; not ICO).
 * Throws on undecodable data. Deterministic for the same bytes.
 */
export async function measureImage(bytes: Uint8Array): Promise<ImageMeasure> {
  const img = sharp(bytes, { density: 72, animated: false, limitInputPixels: 40_000_000 });
  const meta = await img.metadata();
  const { data, info } = await img
    .ensureAlpha()
    .resize(SAMPLE, SAMPLE, { fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let opaque = 0;
  let dark = 0;
  let ink = 0;
  let sum = 0;
  let sumSq = 0;
  const px = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    const a = data[i + 3] ?? 255;
    const lum = lumOf(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    // As laid on the tile: alpha-blended with the tile's luminance.
    if (Math.abs((a / 255) * lum + (1 - a / 255) * TILE_LUM - TILE_LUM) >= 0.25) ink++;
    if (a < 40) continue;
    opaque++;
    if (lum < 0.75) dark++;
    sum += lum;
    sumSq += lum * lum;
  }
  const mean = opaque ? sum / opaque : 0;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    // As displayed: an EXIF-rotated photo's stored width is its displayed height.
    width: meta.autoOrient?.width ?? meta.width ?? info.width,
    height: meta.autoOrient?.height ?? meta.height ?? info.height,
    format: meta.format ?? "unknown",
    stats: {
      opaque: round(px ? opaque / px : 0),
      dark: round(opaque ? dark / opaque : 0),
      lumSpread: round(opaque ? Math.sqrt(Math.max(0, sumSq / opaque - mean * mean)) : 0),
      ink: round(px ? ink / px : 0),
    },
  };
}
