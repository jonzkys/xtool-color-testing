// web/src/lib/forge/forge.worker.ts
import type { ForgeConfig, ParsedXcs, PipelineResult, XcsObject } from "./types";
import { parseXcsFile } from "./xcs";
import { runPipeline } from "./pipeline";
import { buildGeneratedXcs, exportXcs } from "./xcs";
import { resolveStageParams, effectiveScanAngle } from "./config";
import { isXsBuffer, xsToLegacyRaw, legacyRawToXs, type Bundle } from "./xs";

/** Project container format. `.xs` is xcs-workspace-v2 (ZIP); `.xcs` is the
 *  legacy flat JSON. Either input can be exported as either format — the user
 *  picks the output via the page's format toggle (default `.xs`). */
export type ForgeFormat = "xcs" | "xs";

export type ForgeRequest =
  | { type: "parse"; buf: ArrayBuffer }
  | { type: "generate"; inciseId: string; config: ForgeConfig }
  | { type: "export"; inciseId: string; config: ForgeConfig; format: ForgeFormat };

export type ForgeResponse =
  | {
      type: "parsed";
      objects: XcsObject[];
      targetIds: string[];
      preservedIds: string[];
      format: ForgeFormat;
    }
  | { type: "generated"; result: PipelineResult }
  | { type: "exported"; buf: ArrayBuffer; format: ForgeFormat }
  | { type: "error"; message: string };

let parsed: ParsedXcs | null = null;
// Input format + the retained .xs members (so export can repack the bundle
// faithfully). `bundle` is null for legacy `.xcs` inputs.
let inputFormat: ForgeFormat = "xcs";
let xsBundle: Bundle | null = null;

/** Parse either a legacy `.xcs` JSON buffer or a `.xs` (v2 ZIP) bundle into the
 *  shared ParsedXcs model, tracking the input format + retained bundle in worker
 *  scope so export can round-trip in kind. */
function parseForgeInput(buf: ArrayBuffer): ParsedXcs {
  if (isXsBuffer(buf)) {
    const { raw, bundle } = xsToLegacyRaw(buf);
    inputFormat = "xs";
    xsBundle = bundle;
    // Feed the legacy-shaped raw through the existing parser.
    return parseXcsFile(new TextEncoder().encode(JSON.stringify(raw)).buffer);
  }
  inputFormat = "xcs";
  xsBundle = null;
  return parseXcsFile(buf);
}

self.onmessage = (e: MessageEvent<ForgeRequest>) => {
  const post = (r: ForgeResponse, transfer?: Transferable[]) =>
    (self as unknown as Worker).postMessage(r, transfer ?? []);
  try {
    const msg = e.data;
    if (msg.type === "parse") {
      parsed = parseForgeInput(msg.buf);
      post({
        type: "parsed",
        objects: parsed.objects,
        targetIds: parsed.targets.map((o) => o.id),
        preservedIds: parsed.preserved.map((o) => o.id),
        format: inputFormat,
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
      // Cut-shortest-first orders the arms (in the pipeline) AND asks the machine
      // to honour that order via user-defined path planning + By Layer. Only when
      // spiral is the active cut — incise jobs keep the optimiser. Joining strands
      // into one object makes ordering moot, so it disables user-order.
      const userOrder =
        msg.config.spiral.enabled &&
        msg.config.spiral.cutShortestFirst &&
        !msg.config.spiral.joinStrands;
      const doc = buildGeneratedXcs(
        parsed,
        msg.inciseId,
        paths,
        stats.mmPerUnit,
        resolveStageParams(msg.config),
        effectiveScanAngle(msg.config, stats.scanAngleDeg),
        userOrder,
        msg.config.spiral.maxPathPoints,
        msg.config.spiral.joinStrands,
      );
      // Output format is the user's choice, independent of the input format.
      // `.xs` repacks the modified legacy raw into a v2 bundle — reusing the
      // retained members when the input was already `.xs`, or synthesizing a
      // fresh bundle (incl. extracting base64 rasters into resources/) when the
      // input was legacy `.xcs`. `.xcs` emits the flat legacy JSON.
      const buf =
        msg.format === "xs"
          ? legacyRawToXs(doc, xsBundle, userOrder)
          : exportXcs(doc);
      post({ type: "exported", buf, format: msg.format }, [buf]);
      return;
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
