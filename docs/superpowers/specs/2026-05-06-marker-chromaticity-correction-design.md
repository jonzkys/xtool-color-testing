# Anchored colour correction via embedded calibration strip — Design Spec

**Date:** 2026-05-06 (revised after clean-pass / stainless-steel discussion)
**Status:** Approved (design discussion); awaiting implementation plan
**Branch:** TBD (separate from `feat/saved-spectrums` and `feat/pixel-art`)
**Primary material:** stainless steel (premise generalises to other
metals once their clean-pass profiles are configured)

## Summary

Embed a small **calibration strip** in the registration frame of every
test plate. Each strip cell is produced by a **two-stage burn**:

1. **Clean pass**: removes/standardises the substrate over the patch
   area + a 2 mm border, eliminating pitting and reflective coating
   variance.
2. **Calibration burn**: lays down a known, repeatable colour on top
   of the cleaned area.

At ingest, the strip's measured RGB anchors a per-channel linear
correction (gain + offset, optionally a 3-anchor curve), neutralising
both white balance **and** exposure drift across photos. Falls back
to chromaticity-only correction (using unburned material adjacent to
markers) when no strip is present (legacy results, materials without
a calibration profile).

## Goals

- Cross-session colour consistency: a Bordeaux-red engrave shot under
  warm tungsten and the same engrave shot under cool LED yield
  identical palette entries.
- **Robust to specular reflection** — the calibration patches sit on
  matte, clean-passed substrate, eliminating the 2× luminance swing
  that polished metal produces.
- Per-material extensibility: clean-pass params live on the material
  row, so adding a new substrate is a calibration ceremony, not a
  code change.
- Minimal user-facing complexity: calibration is automatic at ingest
  once the material is set up; one-time setup wizard handles the
  initial canonical RGB capture.

## Non-goals (v1)

- **Auto-detecting clean-pass parameters from the substrate.** The
  user specifies them per-material (with sensible defaults for
  stainless steel).
- **Real-time live correction** in the capture preview. Correction
  applies at ingest.
- **Auto-backfill** of historic results. Per-result "Re-ingest with
  WB" button is available.
- **Pixel-art page integration.** Pixel-art ingests source images
  for engraving, not as calibrated palette results — different domain.

---

## Empirical findings (carried over from the prior design discussion)

Probed four stainless-steel test photos
(`samples/color/IMG_7868.jpeg` … `IMG_7871.jpeg`), sampling 30×30 px
patches of unburned material adjacent to detected ArUco markers:

| photo | unburned-material RGB (mean) | R/G | B/G |
|---|---|---:|---:|
| 7868 | (147.3, 146.5, 132.6) | 1.005 | 0.905 |
| 7869 | (116.8, 115.3, 103.1) | 1.013 | 0.895 |
| 7870 | (167.6, 167.6, 152.9) | 1.000 | 0.912 |
| 7871 | (183.8, 182.9, 172.7) | 1.005 | 0.944 |

Two findings drive the design:

1. **Per-channel absolute brightness varies wildly** — 67-unit
   spread across photos, plus 2.4× swing **within a single photo**
   between markers from specular vs diffuse reflection. Polished
   stainless has no stable absolute white anchor.
2. **Per-channel chromaticity is rock-stable** — R/G in
   1.000–1.013 (1.3% spread), B/G in 0.895–0.944 (5%). The
   colour cast carries cross-photo.

The first finding is the reason for the **clean pass**: a matte
surface eliminates the specular contribution, restoring a stable
absolute anchor. With anchored mode available, finding 2 becomes
the **fallback** when the strip is absent.

---

## Architecture: two ingest modes

| Mode | When | Correction kind |
|---|---|---|
| **Anchored** (preferred) | result has a calibration strip + the material has canonical RGB recorded | per-channel gain + offset (optionally 3-anchor curve); fixes white balance AND exposure |
| **Chromaticity-only** (fallback) | no strip / no canonical / strip unreadable | per-channel ratio normalisation against unburned-material samples adjacent to markers; fixes white balance only |
| **Skip** | both modes fail (no markers + no strip) | result flagged `wb_applied=false`; raw colour kept |

`results.wb_mode` is one of `"anchored"`, `"chromaticity"`, `"skipped"`,
`"disabled"`.

---

## Calibration strip layout

### Where it sits

The QR code sits top-left. The space immediately to its right is
typically empty / used for human-readable parameter labels. The
calibration strip occupies that band:

```
┌─────────────────────────────────────────────────┐
│ [QR]   [strip: P0 P1 P2]    [param label text]   ◤ ArUco
│        ←  clean-passed area + 2mm border  →
│
│        [colour grid …]
│
│ [ArUco]                              [ArUco] (corner)
└─────────────────────────────────────────────────┘
```

(round plates: same idea, the strip lives in the top arc next to
the QR, fitting within the chord that already accommodates the
parameter label).

### Geometry

Defaults (all configurable per-material):

- **Patch count:** 3 (light / mid / dark)
- **Patch size:** 5 mm × 5 mm
- **Patch spacing:** 1 mm gap between patches
- **Clean-pass area:** patch bounding box + **2 mm border** in all
  directions
- **Total footprint:** ~21 mm × 9 mm (3 × 5 + 2 × 1 = 17 mm + 4 mm
  border = 21 mm wide; 5 + 4 = 9 mm tall)

### Why 3 patches and not 2

Two anchors (light + dark) give a per-channel linear
`raw → corrected` transform — fixes white balance + exposure under
the assumption that the camera's response is linear. Three anchors
let us additionally fit a per-channel **gamma** correction (or a
piecewise-linear curve), which catches camera-side gamma encoding
and JPEG curve baking. The third sample doubles the data points
for fitting and gives a way to sanity-check linearity (if the curve
through 3 points isn't smooth, something's off — flag and fall back).

The patch count is a per-material setting; users can drop to 2 if
plate space is tight, or extend to 4-5 for finer fitting.

---

## Two-stage burn protocol

For each calibration patch:

```
Stage A: clean pass over (patch_bbox + 2mm border)
  └── parameters: material.clean_pass_params
                   (power, speed, frequency, density, passes, pulse_width)

Stage B: calibration burn over patch_bbox (no border)
  └── parameters: material.calibration_patches[i].params
                   (same parameter set; varies per patch to produce
                   distinct light/mid/dark targets)
```

The clean pass eliminates substrate variance (pitting, oxide
inconsistency, fingerprints) so Stage B lands on a uniform surface.
Without Stage A, even a perfect calibration burn would inherit the
substrate's defects and the canonical RGB wouldn't be repeatable
plate-to-plate.

The clean-pass area extends 2 mm beyond the patch on every side so
the calibration burn isn't sampled along its edges, where the
clean/uncleaned boundary creates colour discontinuities. Sampling
the centre 3×3 mm of each 5×5 mm patch (i.e., 1 mm interior margin)
is robust to small alignment errors.

---

## Per-material data model

New columns on `materials`:

| Column | Type | Notes |
|---|---|---|
| `wb_supported` | bool | Default true. False for substrates incompatible with the protocol (e.g., transparent acrylic). |
| `clean_pass_params_json` | JSON `BaseParams` | The burn applied to (patch + 2 mm border) before each calibration patch. Configurable knobs: power, speed, frequency, density, passes, pulse_width. |
| `calibration_patches_json` | JSON `list[{label, params: BaseParams, canonical_rgb: [R,G,B] \| null}]` | Each entry: a label (e.g., `"light"`), the burn params, and the canonical RGB measured during setup. `null` until calibration ceremony runs. |

`canonical_rgb = null` means "this material is configured but
hasn't been calibrated yet". Anchored mode requires every patch to
have a canonical RGB; otherwise falls back to chromaticity-only.

---

## Calibration ceremony (one-time per material)

The user runs this once per material to populate `canonical_rgb`:

1. **User flow:** in the material settings page, click "Calibrate".
2. **Generate:** system emits a calibration test `.xcs` with just
   the registration frame + calibration strip (no colour grid).
   User burns it.
3. **Photograph:** user shoots the calibration plate under good
   lighting (preferably 2–3 conditions for robustness).
4. **Measure:** ingest pipeline detects markers, locates the strip,
   samples each patch (centre 3×3 mm), pools across photos.
5. **Persist:** writes the measured per-patch RGB as
   `canonical_rgb`.
6. **Validate:** sanity-check that the patches form a monotonic
   light → dark sequence; flag if not (e.g., wrong burn params).

The ceremony output is the source of truth for that material going
forward. Re-running it (e.g., after a major lighting change in the
user's setup, or if the substrate batch changes) is a simple
reset.

---

## Algorithm (anchored mode)

```
input: warped frame W (h × w × 3 RGB), strip patch positions Ψ_i
       (in warped-frame coords, derived from registration markers),
       canonical RGB targets C_i = (Cr_i, Cg_i, Cb_i) for each patch

1. For each patch i:
   a. Sample centre 3×3 mm (or scaled equivalent in pixels).
   b. Per-channel mean μ_i = (Mr_i, Mg_i, Mb_i).
   c. Per-channel std σ_i. Reject patch if σ exceeds 2× the median —
      indicates the patch was contaminated (specular hit, debris).

2. If fewer than 2 patches survive: abort to chromaticity-only.

3. Per-channel curve fit:
   - 2 patches surviving → linear: corrected = a*raw + b, fit
     (a, b) per channel from {(M_dark, C_dark), (M_light, C_light)}.
   - 3+ patches surviving → linear least-squares per channel,
     OR gamma fit: log(C) = a*log(M) + b. Pick whichever has
     lower residual.

4. Apply: W'[r,g,b] = clip(transform(W[r,g,b]), 0, 255) per channel.

5. Return W', the measured μ_i array, the fit parameters,
   wb_mode = "anchored", wb_applied = True.
```

## Algorithm (chromaticity-only fallback)

Unchanged from the prior design — see "chromaticity correction"
section in the previous version of this spec, kept as the v0 of
this code. Sample unburned material adjacent to markers, compute
per-channel ratios, normalise against `U_canon`. Used when:

- Plate has no strip (legacy).
- Material has no `calibration_patches_json`.
- Strip is present but unreadable (markers fail, or all patches
  rejected as specular-contaminated).

## Failure cascade

```
strip present + canonical RGB available + ≥2 patches usable
    → anchored mode
strip absent OR canonical missing OR <2 patches usable
    → chromaticity-only fallback
markers also unreadable
    → skip; raw colour, flag with red badge
toggle off
    → skip; flag with grey badge
```

---

## Where it slots in

`src/xcs_gen_web/capture_pipeline.py` orchestrates ingest. New
steps:

```
photo upload → perspective warp → marker decode →
                                      ↓
                                  locate strip (using marker
                                  positions + plate template)
                                      ↓
                                  attempt anchored correction
                                      ↓ (fallback on failure)
                                  attempt chromaticity correction
                                      ↓
                                  apply chosen correction →
photo upload → … → cell sampling (sees corrected frame)
```

The strip is at known offsets relative to the QR (top-left marker),
so its location in warped-frame coordinates is deterministic from
the registration layout — no detection of the patches per-se, just
sampling at known offsets.

`src/xcs_gen/capture/marker_render.py` (or its sibling
registration layout module) extends to emit the calibration strip
as part of the registration frame:

- New parameter `with_calibration_strip: bool` on the registration
  layout config.
- Emits Bitmap displays for the clean-pass + calibration burns at
  computed positions.
- Two-stage burn: the clean pass + calibration burn are separate
  display elements with their own params, layered in the right
  order in the .xcs project.

---

## Persistence

### `materials` (additions)

| Column | Type |
|---|---|
| `wb_supported` | `Boolean` (default `True`) |
| `clean_pass_params_json` | `JSON` nullable (defaults from a registry per substrate kind) |
| `calibration_patches_json` | `JSON` nullable (`null` until ceremony runs) |

### `results` (additions)

| Column | Type | Purpose |
|---|---|---|
| `wb_mode` | `String(16)` | `"anchored"`, `"chromaticity"`, `"skipped"`, `"disabled"` |
| `wb_anchor_rgb_json` | `JSON` | For chromaticity: `[Ru, Gu, Bu]`. For anchored: the array of measured patch RGBs. |
| `wb_correction_json` | `JSON` nullable | For anchored: per-channel `(a, b)` (linear) or `(a, b, gamma)` (gamma). For chromaticity: per-channel scale factors. Lets us re-derive without re-sampling. |
| `wb_canonical_id` | `String(64)` nullable | Versioning hook — e.g., `"v1.steel-default.2026-05-06"`. When the canonical RGBs change for a material, results carry the version they used. |

Single migration. Three nullable columns on `results`, three
nullable columns on `materials`.

(CLAUDE.md gotcha: bump the alembic head check in
`.github/workflows/ci.yml::mysql-migration-test` in the same commit.)

---

## UI surfaces

- **Material settings (`#/library` material editor):**
  - New "Calibration" panel with:
    - Clean-pass params editor (power, speed, frequency, density,
      passes, pulse_width — same widgets as elsewhere).
    - Calibration patches editor (label + params per patch; default
      to 3 patches with sensible stainless-steel presets).
    - "Run calibration" button → opens the ceremony wizard.
  - Display the `canonical_rgb` per patch as colour swatches with
    measured values; "(uncalibrated)" if not yet captured.
- **Calibration ceremony wizard:** stepwise — emit test → instruct
  user to burn + photograph → upload photo → measure → confirm
  swatches look right → save.
- **Capture settings (per-ingest):** `WB correction` toggle (on/off).
  Default on. When on, the system picks anchored or chromaticity
  automatically based on what the result has.
- **Result detail dialog:**
  - Badge showing the mode: green "ANCHORED", yellow "CHROMA",
    red "RAW (no WB)", grey "DISABLED".
  - Expanded view: measured RGBs, fitted correction parameters,
    pre/post thumbnails.
- **Per-result re-ingest button:** "Re-ingest with current WB
  settings" — re-runs from `warped_image_path` using the latest
  per-material canonical and global toggle state.

---

## Tests

| Layer | File | Coverage |
|---|---|---|
| Pure functions | `src/xcs_gen_web/wb_correction.py` (new) + `tests/test_wb_correction.py` | Strip detection from synthetic frames. Per-channel curve fitting (linear and gamma). Specular rejection. Anchored→chromaticity fallback when too few patches survive. |
| Layout | `tests/test_capture_layout.py` (extend) | New flag emits the strip at the right position with the right two-stage burns. |
| Material model | `tests/test_repo_materials.py` (extend) | New columns persist + round-trip; default values for stainless. |
| Result model | `tests/test_repo_results.py` (extend) | `wb_mode` etc. round-trip. |
| Integration | `tests/test_capture_pipeline_wb.py` (new) | End-to-end: tinted photo with calibration strip → corrected colour matches expected. |
| E2E (Playwright, optional) | calibration ceremony walkthrough |

The `samples/color/IMG_786{8,9,0,1}.jpeg` photos are usable as
chromaticity-only acceptance fixtures (they don't have a calibration
strip). For the anchored-mode acceptance test, a synthetic generator
should produce frames with a deterministic strip + known cast →
correctness assertions on the recovered colours.

---

## File / module map

```
src/xcs_gen_web/
  wb_correction.py            NEW   anchored + chromaticity corrections (~200 lines)
  capture_pipeline.py         EDIT  insert correction step + persist
  models.py                   EDIT  3 new result cols + 3 new material cols
  schemas.py                  EDIT  ResultResponse + MaterialResponse extensions
  repositories/results.py     EDIT  new columns
  repositories/materials.py   EDIT  new columns + calibration ceremony helpers

src/xcs_gen/capture/
  marker_render.py            EDIT  optional calibration strip emission
  layout.py      EDIT  strip geometry as part of layout (or
                                    new sibling file calibration_strip.py)
  default_calibration.py      NEW   per-substrate defaults (stainless first)

alembic/versions/
  NNNN_wb_correction.py       NEW   one migration, six nullable columns

.github/workflows/ci.yml      EDIT  bump alembic head check

src/xcs_gen_web/
  app.py (or routers/)        EDIT  re-ingest endpoint, calibration ceremony endpoints

web/src/
  types.ts                    EDIT  result + material types
  components/MaterialEditDialog.tsx  EDIT  calibration panel
  components/CalibrationWizard.tsx   NEW   ceremony flow
  components/ResultDebugDialog.tsx   EDIT  WB badge + expanded panel
  components/CaptureSettings.tsx (or wherever)  EDIT  toggle
  components/ResultDetailDialog.tsx  EDIT  re-ingest button

tests/
  test_wb_correction.py       NEW
  test_capture_pipeline_wb.py NEW

samples/color/                ALREADY THERE   chromaticity-only fixtures
samples/calibration/          TODO during implementation   anchored-mode synthetic fixtures
```

---

## Default clean-pass + calibration profile (stainless steel)

These are starter values to bake into `default_calibration.py`;
the user can override per material. Refining them is part of the
implementation work, not this spec.

- **Clean pass (stainless):** moderate power + multi-pass to remove
  surface variance without deep marking. Goal is a uniform matte
  finish, not a colour. Tentative: power 30%, speed 800 mm/s,
  frequency 60 kHz, density 1000 lpi, passes 2, pulse-width 200 ns.
  Calibrate against actual hardware before locking.
- **Calibration patches (stainless):**
  - **Light:** very low power burst, light tan/yellow oxide.
    `(power=8, speed=1500, freq=30, density=800, passes=1, pw=120)`
  - **Mid:** moderate burn, gold/blue oxide colour.
    `(power=18, speed=1000, freq=80, density=1000, passes=1, pw=160)`
  - **Dark:** high power, deep blue/black oxide.
    `(power=40, speed=400, freq=120, density=1200, passes=2, pw=240)`

These are educated guesses; the calibration ceremony then captures
the actual measured RGBs as the canonical targets, so the burn
params just need to produce **distinct** and **repeatable** colours,
not particular target values.

---

## Open / followup items (out of scope)

- **Per-material auto-detection of clean-pass viability.** v1
  trusts the user-set `wb_supported` flag.
- **Multi-substrate support beyond stainless.** Aluminium, brass,
  black anodise, etc., each need their own clean-pass profile.
  The data model supports them; the defaults registry needs entries.
- **Live calibration preview** — show the measured strip RGBs in
  real-time as the user drags the camera around. Polish.
- **Drift dashboard** — chart of measured strip RGBs over time
  per material. Surfaces "your bulb has shifted" or "camera lens
  has aged". Non-trivial; v2.
- **Higher-order correction.** Beyond per-channel gamma, a 3×3
  colour matrix could correct cross-channel mixing (rare for
  consumer cameras after auto-WB has done its thing, but possible).
  v3 if anyone needs it.
- **Pixel-art page integration.** Pixel-art doesn't currently use
  WB-corrected images; adding it depends on whether pixel-art
  evolves to use stored results as source images.
- **Calibration drift alarm.** Detect when a fresh ingest's strip
  measurements deviate significantly from a recent baseline →
  prompt the user to recalibrate.

---

## Migration notes

- Existing results have no `wb_*` columns; on first deploy, all
  read as `wb_mode = NULL`, treated as "uncorrected legacy".
- Existing materials have no `calibration_patches_json`; default to
  `wb_supported = True` but anchored mode is unavailable until
  the ceremony runs. Chromaticity-only fallback can still apply.
- `wb_canonical_id` versioning: bump the suffix any time the
  canonical RGBs are recaptured (after a major lighting setup
  change, or as the canonical defaults are refined). Lets diagnostic
  tools group results by which calibration generation they belong to.
- New tests in `samples/` should ship with the strip enabled, so
  fresh integration tests exercise the anchored path.
