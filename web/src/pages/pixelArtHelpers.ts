/**
 * Helpers for ``PixelArtPage`` — extracted so the page itself stays
 * focused on state orchestration rather than coordinate math + image
 * decode plumbing.
 */

import { deltaE2000, hexToLab, type Lab } from "../color/math";
import type { PaletteEntry } from "../types";
import type { Material } from "../library";
import type { CroppedRegion } from "../components/PixelArtCanvas";

/** Width / height (mm) for the active material; falls back to a 50×50
 *  square when the material has no shape data. */
export function materialDims(mat: Material | undefined | null): {
  widthMm: number;
  heightMm: number;
} {
  if (mat?.shape === "rect" && mat.width_mm && mat.height_mm) {
    return { widthMm: mat.width_mm, heightMm: mat.height_mm };
  }
  if (mat?.shape === "circle" && mat.diameter_mm) {
    // Pixel art on round material: pick the inscribed square.
    const d = mat.diameter_mm;
    return { widthMm: d, heightMm: d };
  }
  return { widthMm: 50, heightMm: 50 };
}

/** Crop that perfectly covers the image, optimised for the given
 *  material aspect (cropping out as little as possible). */
export function defaultCrop(
  imgW: number,
  imgH: number,
  matW: number,
  matH: number,
): CroppedRegion {
  if (imgW <= 0 || imgH <= 0 || matW <= 0 || matH <= 0) {
    return { x: 0, y: 0, w: imgW, h: imgH };
  }
  const matAspect = matW / matH;
  const imgAspect = imgW / imgH;
  if (imgAspect > matAspect) {
    // image wider than material — crop x
    const w = imgH * matAspect;
    return { x: (imgW - w) / 2, y: 0, w, h: imgH };
  }
  const h = imgW / matAspect;
  return { x: 0, y: (imgH - h) / 2, w: imgW, h };
}

/** Decode a File into both ``ImageBitmap`` (for the canvas paint) and
 *  ``ImageData`` (for the cell sampler). The latter requires a hidden
 *  canvas because ``ImageBitmap`` itself doesn't expose pixel access. */
export async function decodeFile(
  file: File,
): Promise<{ bitmap: ImageBitmap; data: ImageData }> {
  const bitmap = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D context");
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { bitmap, data };
}

/** Find the palette entry nearest to ``hex`` by deltaE2000. Returns
 *  null when the palette is empty or the hex is malformed. */
export function nearestPaletteEntry(
  hex: string,
  entries: PaletteEntry[],
): PaletteEntry | null {
  if (entries.length === 0) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const target = hexToLab(hex);
  let best: PaletteEntry | null = null;
  let bestD = Infinity;
  for (const e of entries) {
    const eLab =
      e.lab.length >= 3
        ? ([e.lab[0], e.lab[1], e.lab[2]] as Lab)
        : hexToLab(e.hex);
    const d = deltaE2000(target, eLab);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}
