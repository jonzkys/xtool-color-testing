import { hexToLab, deltaE2000, labToHex, type Lab } from "../color/math";

/** Result of one quantisation pass.
 *
 *  ``labels`` is parallel to the input cell array: ``-1`` for "skip"
 *  (null input), otherwise the centroid index in ``centroidsHex``. */
export interface KMeansResult {
  labels: number[];
  centroidsHex: string[];
}

const _MAX_ITERS = 30;
const _EPSILON = 0.5;

/** Quantise an array of cell colours (hex strings or null for skip) to K
 *  perceptual centroids using k-means in CIE Lab space.
 *
 *  Skip cells (null) are excluded from the clustering and labeled ``-1``. */
export function kMeansLab(
  cells: (string | null)[],
  k: number,
): KMeansResult {
  const labels = new Array<number>(cells.length).fill(-1);
  const validIdx: number[] = [];
  const validLab: Lab[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c === null) continue;
    validIdx.push(i);
    validLab.push(hexToLab(c));
  }
  if (validLab.length === 0) {
    return { labels, centroidsHex: [] };
  }

  const effectiveK = Math.min(k, validLab.length);

  // k-means++ init
  const centroids: Lab[] = [];
  centroids.push(validLab[Math.floor(Math.random() * validLab.length)]);
  while (centroids.length < effectiveK) {
    const dists = validLab.map((l) =>
      Math.min(...centroids.map((c) => deltaE2000(l, c))),
    );
    const total = dists.reduce((a, b) => a + b, 0);
    if (total === 0) break;
    let r = Math.random() * total;
    let pick = 0;
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i];
      if (r <= 0) { pick = i; break; }
    }
    centroids.push(validLab[pick]);
  }

  const valLabels = new Array<number>(validLab.length).fill(0);

  for (let iter = 0; iter < _MAX_ITERS; iter++) {
    for (let i = 0; i < validLab.length; i++) {
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let c = 0; c < centroids.length; c++) {
        const d = deltaE2000(validLab[i], centroids[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      valLabels[i] = best;
    }
    const sums: Array<[number, number, number, number]> = centroids.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < validLab.length; i++) {
      const c = valLabels[i];
      sums[c][0] += validLab[i][0];
      sums[c][1] += validLab[i][1];
      sums[c][2] += validLab[i][2];
      sums[c][3] += 1;
    }
    let maxShift = 0;
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c][3] === 0) continue;
      const next: Lab = [
        sums[c][0] / sums[c][3],
        sums[c][1] / sums[c][3],
        sums[c][2] / sums[c][3],
      ];
      const shift = deltaE2000(centroids[c], next);
      if (shift > maxShift) maxShift = shift;
      centroids[c] = next;
    }
    if (maxShift < _EPSILON) break;
  }

  // Drop centroids with zero members (k-clamping side-effect)
  const memberCount = new Array(centroids.length).fill(0);
  for (const l of valLabels) memberCount[l]++;
  const remap: Record<number, number> = {};
  const liveCentroids: Lab[] = [];
  for (let c = 0; c < centroids.length; c++) {
    if (memberCount[c] === 0) continue;
    remap[c] = liveCentroids.length;
    liveCentroids.push(centroids[c]);
  }

  for (let i = 0; i < valLabels.length; i++) {
    labels[validIdx[i]] = remap[valLabels[i]];
  }

  return { labels, centroidsHex: liveCentroids.map(labToHex) };
}

export interface CoverRect {
  x: number;
  y: number;
  width: number;
  height: number;
  label: number;
}

/** Greedy max-rectangle covering of same-label adjacent cells.
 *
 *  For each label: scan grid for the largest uncovered rectangle of that
 *  label, emit, mark covered, repeat. Cells with label === -1 (skip) are
 *  treated as permanently-covered gaps and never appear in the output. */
export function greedyRectCover(
  labels: number[],
  width: number,
  height: number,
): CoverRect[] {
  const covered = new Array<boolean>(labels.length).fill(false);
  const out: CoverRect[] = [];
  for (let i = 0; i < labels.length; i++) if (labels[i] < 0) covered[i] = true;

  // Derive the upper bound on labels actually present in the grid.
  let maxLabel = -1;
  for (const l of labels) if (l > maxLabel) maxLabel = l;

  while (true) {
    let best: CoverRect | null = null;
    let bestArea = 0;
    for (let label = 0; label <= maxLabel; label++) {
      const heights = new Array<number>(width).fill(0);
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const i = row * width + col;
          if (!covered[i] && labels[i] === label) {
            heights[col] += 1;
          } else {
            heights[col] = 0;
          }
        }
        const stack: { col: number; h: number }[] = [];
        for (let col = 0; col <= width; col++) {
          const h = col === width ? 0 : heights[col];
          let leftCol = col;
          while (stack.length > 0 && stack[stack.length - 1].h > h) {
            const top = stack.pop()!;
            leftCol = top.col;
            const w = col - leftCol;
            const area = w * top.h;
            if (area > bestArea) {
              bestArea = area;
              best = {
                x: leftCol,
                y: row - top.h + 1,
                width: w,
                height: top.h,
                label,
              };
            }
          }
          stack.push({ col: leftCol, h });
        }
      }
    }
    if (!best || bestArea === 0) break;
    out.push(best);
    for (let r = best.y; r < best.y + best.height; r++) {
      for (let c = best.x; c < best.x + best.width; c++) {
        covered[r * width + c] = true;
      }
    }
  }
  return out;
}
