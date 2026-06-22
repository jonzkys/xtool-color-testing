import { parseGcode } from "./parser";
import type { GcodeFile } from "./types";

export interface ParserRequest {
  type: "parse";
  /** Full text body of the .gc file. */
  text: string;
}

export type ParserResponse =
  | { type: "parsed"; file: GcodeFile; elapsedMs: number }
  | { type: "error"; message: string };

self.onmessage = (e: MessageEvent<ParserRequest>) => {
  if (e.data.type !== "parse") return;
  const t0 = performance.now();
  try {
    const file = parseGcode(e.data.text);
    const elapsedMs = performance.now() - t0;
    const resp: ParserResponse = { type: "parsed", file, elapsedMs };
    // Transfer every block's geometry buffers zero-copy (they're distinct
    // ArrayBuffers — slice() in the builders makes tight, unshared copies).
    const transfer: Transferable[] = [];
    for (const job of file.jobs) {
      for (const layer of job.layers) {
        for (const block of layer.blocks) {
          const g = block.geometry;
          transfer.push(g.x.buffer, g.y.buffer, g.s.buffer, g.rapid.buffer);
        }
      }
    }
    (self as unknown as Worker).postMessage(resp, transfer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const resp: ParserResponse = { type: "error", message };
    (self as unknown as Worker).postMessage(resp);
  }
};
