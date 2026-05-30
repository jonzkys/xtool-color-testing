// web/src/lib/forge/forge.worker.ts
import type { ForgeConfig, ParsedXcs, PipelineResult, XcsObject } from "./types";
import { parseXcsFile } from "./xcs";
import { runPipeline } from "./pipeline";
import { buildGeneratedXcs, exportXcs } from "./xcs";

export type ForgeRequest =
  | { type: "parse"; buf: ArrayBuffer }
  | { type: "generate"; inciseId: string; config: ForgeConfig }
  | { type: "export"; inciseId: string; config: ForgeConfig };

export type ForgeResponse =
  | { type: "parsed"; objects: XcsObject[]; embossIds: string[]; inciseIds: string[] }
  | { type: "generated"; result: PipelineResult }
  | { type: "exported"; buf: ArrayBuffer }
  | { type: "error"; message: string };

let parsed: ParsedXcs | null = null;

self.onmessage = (e: MessageEvent<ForgeRequest>) => {
  const post = (r: ForgeResponse, transfer?: Transferable[]) =>
    (self as unknown as Worker).postMessage(r, transfer ?? []);
  try {
    const msg = e.data;
    if (msg.type === "parse") {
      parsed = parseXcsFile(msg.buf);
      post({
        type: "parsed",
        objects: parsed.objects,
        embossIds: parsed.emboss.map((o) => o.id),
        inciseIds: parsed.incise.map((o) => o.id),
      });
      return;
    }
    if (!parsed) throw new Error("no file parsed yet");
    if (msg.type === "generate") {
      post({ type: "generated", result: runPipeline(parsed, msg.inciseId, msg.config) });
      return;
    }
    if (msg.type === "export") {
      const { paths, stats } = runPipeline(parsed, msg.inciseId, msg.config);
      const doc = buildGeneratedXcs(parsed, msg.inciseId, paths, stats.mmPerUnit, msg.config.stageParams);
      const buf = exportXcs(doc);
      post({ type: "exported", buf }, [buf]);
      return;
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
