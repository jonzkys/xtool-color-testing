export interface CellGridOptions {
  cols: number;
  rows: number;
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
}

/** Sample a grid of cells over a source ImageData (or its crop), returning
 *  one hex string per cell, or null where mean alpha < 30 (skip cell). */
export function sampleCellGrid(
  img: ImageData,
  opts: CellGridOptions,
): (string | null)[] {
  const cropX = opts.cropX ?? 0;
  const cropY = opts.cropY ?? 0;
  const cropW = opts.cropW ?? img.width;
  const cropH = opts.cropH ?? img.height;

  const out: (string | null)[] = new Array(opts.cols * opts.rows).fill(null);
  const cellW = cropW / opts.cols;
  const cellH = cropH / opts.rows;

  for (let cy = 0; cy < opts.rows; cy++) {
    for (let cx = 0; cx < opts.cols; cx++) {
      const x0 = Math.floor(cropX + cx * cellW);
      const y0 = Math.floor(cropY + cy * cellH);
      const x1 = Math.min(img.width, Math.floor(cropX + (cx + 1) * cellW));
      const y1 = Math.min(img.height, Math.floor(cropY + (cy + 1) * cellH));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * img.width + x) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          a += img.data[i + 3];
          n += 1;
        }
      }
      if (n === 0) {
        out[cy * opts.cols + cx] = null;
        continue;
      }
      const meanA = a / n;
      if (meanA < 30) {
        out[cy * opts.cols + cx] = null;
        continue;
      }
      const mr = Math.round(r / n);
      const mg = Math.round(g / n);
      const mb = Math.round(b / n);
      out[cy * opts.cols + cx] =
        "#" +
        mr.toString(16).padStart(2, "0") +
        mg.toString(16).padStart(2, "0") +
        mb.toString(16).padStart(2, "0");
    }
  }
  return out;
}
