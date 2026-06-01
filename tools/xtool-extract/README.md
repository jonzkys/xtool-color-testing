# xtool-extract — machine validation profile extraction

Tooling that produced `src/xcs_gen/data/machine_profiles.json` (the per-machine,
per-mode validation constraints served by `/api/machines`). Re-run when xTool
Studio changes its parameter model.

## What's here
- `parse-bundle.mjs` — extracts base field-def ranges from one ext bundle.
- `read-pulse-enums.mjs` — reads the pulse-width dropdown enum from the live
  Studio renderer over CDP (the enum isn't a static literal in the bundle).
- `build-profiles.mjs` — assembles `machine_profiles.json` from the findings
  below (encodes the per-(machine,mode) constraint matrix + applicability).

## Sources (three places)
1. **Base numeric ranges** — each machine's ext bundle
   (`/tmp/Contents/Resources/exts/<dir>/index.js`, unpacked xTool Studio).
   `parse-bundle.mjs` regexes the `NAME:{label:`device.common.X`,…min,max}`
   field-defs. NOTE: these base defs are **identical across all six bundles**
   (shared common module), so machine differentiation comes from the items below.
2. **Per-mode overrides** — not in the base defs:
   - Color Engrave density max `5000` lives in a `{name:`density`,…widgetAttrs:{max:5e3}}`
     widget config. Find with:
     `node -e 'const js=require("fs").readFileSync(".../GS004-CLASS-4/index.js","utf8");const i=js.indexOf("max:5e3");console.log(js.slice(i-220,i+40))'`
   - Cut `passes`/repeat goes high (observed up to ~300); base repeat def caps at 10.
3. **Applicability + sources + enums** — the IndexedDB dump
   (`~/xtool-param-capture/atomm_material.json`) + the registry map
   (`material-device-basic-info.json`):
   - `pulse_width` (MOPA) — only F2Ultra & F2UltraSingle have non-empty pulseWidth
     in their recommended params → `stepped` there, `not_applicable` everywhere else.
   - `color_engrave` — only F2Ultra & F2UltraSingle (need the MOPA pulse control;
     `device.gs.color_engrave` appears in every bundle as shared i18n, so it's NOT
     a reliable signal — use the pulse-width capability instead).
   - `frequency` — `not_applicable` on diode-only machines (F1Lite, F1; observed 0).
   - `laser` enum — from `sourcePowerAssoc`.
   - `pulse_width` enum values — read from the live editor DOM via `read-pulse-enums.mjs`
     (F2 family: `[2,4,6,9,13,20,30,45,60,80,100,150,200,250,350,500]`).

## Reproduce
```bash
# 1. Studio launched with the debug port (renderer bypasses proxies; CDP is the way):
nohup "/Applications/xTool Studio.app/Contents/MacOS/xTool Studio" \
  --remote-debugging-port=9222 "--remote-allow-origins=*" & disown

# 2. Base ranges per machine (sanity check):
node tools/xtool-extract/parse-bundle.mjs /tmp/Contents/Resources/exts/GS004-CLASS-4/index.js

# 3. pulse-width enum per IR machine (open that machine's editor + the Pulse width dropdown):
node tools/xtool-extract/read-pulse-enums.mjs

# 4. Regenerate the dataset:
node tools/xtool-extract/build-profiles.mjs > src/xcs_gen/data/machine_profiles.json

# 5. Verify it loads + validates:
uv run --active pytest tests/test_profiles_loader.py::test_committed_file_is_valid -q
```

The constraint matrix is encoded in `build-profiles.mjs` — edit it there, not the JSON.

## Migration diff (old hardcoded → new extracted)
Mostly **wider** (safe). The one tightening is handled by the frontend
`RangeField` clamping a stale value on load:

| field | old (STANDARD / COLOR_ENGRAVE) | new | note |
|---|---|---|---|
| density | stepped `[10..200]` / range `1–5000` | range `1–300` / `1–5000` | kind change stepped→range; wider |
| frequency | `30–60` / `60–500` | `1–150` (fiber/UV); `not_applicable` (diode) | color max **tighter** 500→150 (frontend clamps); diode now N/A |
| passes | `1–99` | `1–99`; cut `1–300` | wider for cut |
| power / speed | `1–100` / `2–10000`,`2–15000` | unchanged | — |
| pulse_width | N/A (STANDARD) / stepped (COLOR) | stepped on F2Ultra+F2UltraSingle only; N/A elsewhere | — |

New: machines `F2UltraSingle`, `F2UltraUV`, `F1Lite`, `F1`; modes `intaglio`, `relief`.

## Caveats
- `speed` bounds use runtime variables in the bundle (no literal) — kept at the
  generous current values (back-compat safe; never wrongly rejects).
- Machine images for the four new machines are **placeholders** (copies of the
  F2/F1 Ultra icons) — replace with real artwork when available.
- The raw 5.75 MB IndexedDB dump is not committed; it lives in `~/xtool-param-capture/`.
