# Import `.xs` → pick depth map — design

**Date:** 2026-06-17
**Status:** approved (design), pending implementation

## Goal

Let the Relief / Depth Maps tool **import an xTool Studio `.xs` workspace** and
pull a depth-map / emboss job's grayscale image straight into the cleaner. On
import: pick a depth map (when several exist), import directly (exactly one),
or show an error (none found). Cancellable. Fully client-side.

## Format (confirmed from `CutwithEmboss.xs`)

An `.xs` is a ZIP (xcs-workspace-v2). A **depth-map / emboss job is a `BITMAP`
display whose processing type is `RELIEF` (emboss) or `INTAGLIO` (engraved
relief)** — both consume a grayscale height map.

- `project.json` → `modules.canvases` (canvas ids; fall back to `activeCanvasId`).
- `canvases/<cid>/displays-0.json` → `{ displays: [...] }`; `BITMAP` displays
  carry `resourcePath` (e.g. `resources/<hash>.png`), mm `width`/`height`, `name`.
- `devices/device-*.json` → `processing.<cid>.modes.<MODE>.bindings[]`, each
  `{ displayIds, baseProfileId, patchIds, … }`.
- `profiles.json` → `profiles[baseProfileId].processingType` (`RELIEF` /
  `INTAGLIO` / `VECTOR_CUTTING` / …).
- `resources/<hash>.png` → the raster pixels.

So: walk the device bindings to build `displayId → processingType` (via
`baseProfileId` → `profiles`), then keep `BITMAP` displays whose type is
`RELIEF` or `INTAGLIO`, and read their `resourcePath` bytes.

## Architecture

Client-side only (the standalone `/depthmaps` page has no backend beyond
`/api/relief/smooth`). Uses `fflate.unzipSync` — already a dependency, used by
`forge/xs.ts`.

### 1. Parser — `web/src/lib/relief/xsImport.ts` (pure)

```ts
export interface XsDepthJob {
  name: string;                 // display name, else "Depth map N"
  processingType: "RELIEF" | "INTAGLIO";
  widthMm: number;
  heightMm: number;
  pngBytes: Uint8Array;         // the resources/<hash>.png bytes
}
export function parseXsDepthMaps(bytes: Uint8Array): XsDepthJob[];
```

Steps: `unzipSync(bytes)` → read `project.json` (canvas ids) → `profiles.json`
(`profileId → processingType`) → device file (`displayId → processingType` via
binding `baseProfileId`) → for each canvas's `displays-0.json`, keep `BITMAP`
displays with `processingType ∈ {RELIEF, INTAGLIO}` and attach
`members[resourcePath]`. A display with no resolvable processingType, or a
missing resource, is skipped. A non-zip / malformed file throws — the caller
treats any throw (and an empty result) as "nothing importable".

### 2. Modal — `web/src/components/relief/XsImportDialog.tsx` (Radix `Dialog`)

Props: `{ open, jobs: XsDepthJob[], onPick(job), onCancel }`.
- `jobs.length === 0` → **error** state: "No depth-map or emboss jobs found in
  this .xs." + Close.
- `jobs.length ≥ 1` → a grid: each job a button with a PNG thumbnail
  (object-URL from `pngBytes`, revoked on unmount), a label
  (`Emboss · RELIEF` / `Relief · INTAGLIO`), and `W × H mm`. Click → `onPick`.
- Cancel/close (Escape, backdrop, button) → `onCancel`.

(The dialog is only opened for 0 or ≥2 jobs; the exactly-one case imports
directly without it — see wiring.)

### 3. Wiring — `web/src/pages/ReliefPage.tsx`

- The Upload/Replace `<input>` gains `accept="image/*,.xs"`.
- Extract the existing ingest into `ingestImageBlob(blob: Blob)` (the current
  `createImageBitmap` + `setBitmap` + `setOriginalUrl` logic; `onFile`'s image
  path calls it).
- `onFile(file)`: if the name ends `.xs` → read `file.arrayBuffer()` →
  `parseXsDepthMaps`. **0 → open error modal; exactly 1 → `ingestImageBlob`
  directly; ≥2 → open picker modal** with the jobs. On pick →
  `ingestImageBlob(new Blob([job.pngBytes], {type:"image/png"}))` + close.
- Dialog state: `const [xsJobs, setXsJobs] = useState<XsDepthJob[] | null>(null)`
  (null = closed; `[]` = error state open; non-empty = picker open).

### Data flow

upload `.xs` → `parseXsDepthMaps` → {0: error modal | 1: ingest | ≥2: picker →
pick → ingest} → `ingestImageBlob` → same downstream pipeline as a normal
upload (preview / 3D / export).

### Error handling

- Unreadable / non-`.xs` zip → caught → error modal.
- Malformed JSON / missing members → that piece is skipped; net result may be 0
  jobs → error modal.
- A job whose `resourcePath` is absent → skipped.

## Testing

- `xsImport.test.ts`: build a **tiny synthetic `.xs`** in-test with
  `fflate.zipSync` (project.json + one canvas displays with a RELIEF bitmap, an
  INTAGLIO bitmap, a VECTOR_CUTTING path, and a 1×1 PNG resource + device +
  profiles). Assert `parseXsDepthMaps` returns the two relief/intaglio bitmaps
  (correct names/types/dims/bytes) and ignores the path; assert a junk buffer
  throws / yields `[]`.
- `XsImportDialog.test.tsx`: error state renders the message; job list renders
  labels + fires `onPick`; Cancel fires `onCancel`.
- Browser: import the real `CutwithEmboss.xs` → picker lists its two relief
  bitmaps → pick one → it loads into the cleaner and smooths.

## Out of scope

- Legacy `.xcs` (v1, JSON) import — different parser; `.xs` (v2) only for now.
- Importing job parameters (slice count, z-layers, etc.) — Relief only needs the
  grayscale image.
- Multi-canvas selection UI beyond listing all qualifying jobs together.
