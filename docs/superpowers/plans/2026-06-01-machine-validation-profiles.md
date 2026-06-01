# Machine Validation Profiles (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-curated validation profiles with real per-machine/mode constraints extracted from xTool Studio for the F2 Ultra and F1 families, served through the existing `/api/machines` API unchanged.

**Architecture:** Extracted constraints live in a committed `src/xcs_gen/data/machine_profiles.json`, which `machines.py` loads at import into `PROFILES`. The registry gains four machines and two modes (`intaglio`, `relief`); profile ids become per-machine `"<machineId>:<mode>"`. The `FieldConstraint` union, `/api/machines` payload shape, and all param widgets stay unchanged — this is data population, not redesign.

**Tech Stack:** Python 3 / FastAPI / dataclasses (backend); Node 24 + minified-bundle parsing + Chrome DevTools Protocol (extraction tooling); React / TypeScript / vitest (frontend). Tests: pytest (backend), vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-06-01-validation-profiles-design.md`

**Reference data already captured:** `~/xtool-param-capture/` (IndexedDB dump `atomm_material.json`, registry map `material-device-basic-info.json`, F2 Ultra field schema, CDP helper `cdp-eval.mjs`). xTool Studio bundles unpacked at `/tmp/Contents/Resources/exts/<dir>/index.js`.

---

## File Structure

**New:**
- `src/xcs_gen/data/machine_profiles.json` — committed extracted profiles (produced in Task 4).
- `src/xcs_gen/profiles_loader.py` — loads + validates the JSON. One responsibility: turn the file into the `PROFILES` dict, fail-fast on malformed data.
- `tools/xtool-extract/parse-bundle.mjs` — extracts base field ranges from one ext bundle.
- `tools/xtool-extract/read-pulse-enums.mjs` — reads pulse_width enums from the live Studio renderer via CDP.
- `tools/xtool-extract/README.md` — reproduction procedure.
- `tests/test_profiles_loader.py` — loader unit tests.
- `changelog/2026-06-01-machine-profiles.md` — changelog entry.

**Modified:**
- `src/xcs_gen/machines.py` — `ModeId`/`ProfileId` types, four new machines, `intaglio`/`relief` modes, per-machine profile ids, load JSON into `PROFILES`, generalise laser helpers.
- `src/xcs_gen_web/schemas.py:48` — add `intaglio`/`relief` to the `mode` literal.
- `src/xcs_gen_web/app.py:~1293` — generalise the default-mode helper.
- `web/src/types.ts:349-383` — `ModeId` += `intaglio`/`relief`; `ProfileId` → `string`; `profiles` keyed by `string`.
- `web/src/components/ParamTestEditor.tsx:1136` — add `intaglio`/`relief` to `MODE_LABELS`.
- `web/public/machines/` — images for the four new machines.
- Affected backend tests (`tests/test_machines.py`, `test_machines_endpoint.py`, `test_validation_profiles.py`, `test_machine_device.py`, `test_xcs_builder_machines.py`) — updated to the new profile-id scheme + machine set.

---

## Task 1: JSON profile loader (TDD)

**Files:**
- Create: `src/xcs_gen/profiles_loader.py`
- Create: `tests/test_profiles_loader.py`
- Create (placeholder for now): `src/xcs_gen/data/machine_profiles.json`

- [ ] **Step 1: Create the data directory with a minimal valid stub**

So imports work before extraction (Task 4 replaces the contents). Create `src/xcs_gen/data/machine_profiles.json`:

```json
{
  "meta": { "source": "stub — replaced in Task 4", "extracted": "2026-06-01" },
  "profiles": {
    "F2Ultra:engrave": {
      "power": { "kind": "range", "min": 1, "max": 100, "step": 1 },
      "laser": { "kind": "enum", "values": ["red", "blue"] }
    }
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_profiles_loader.py`:

```python
import json
import pytest
from xcs_gen.profiles_loader import load_profiles, validate_profiles


def _write(tmp_path, obj):
    p = tmp_path / "machine_profiles.json"
    p.write_text(json.dumps(obj))
    return p


def test_loads_valid_profiles(tmp_path):
    path = _write(tmp_path, {
        "meta": {"source": "x"},
        "profiles": {
            "F2Ultra:cut": {
                "power": {"kind": "range", "min": 1, "max": 100, "step": 1},
                "pulse_width": {"kind": "not_applicable"},
                "laser": {"kind": "enum", "values": ["red", "blue"]},
            },
        },
    })
    profiles = load_profiles(path)
    assert profiles["F2Ultra:cut"]["power"]["max"] == 100


def test_rejects_unknown_kind(tmp_path):
    path = _write(tmp_path, {"profiles": {"P": {"power": {"kind": "wat"}}}})
    with pytest.raises(ValueError, match="unknown constraint kind"):
        load_profiles(path)


def test_rejects_inverted_range(tmp_path):
    path = _write(tmp_path, {"profiles": {"P": {"speed": {"kind": "range", "min": 10, "max": 2}}}})
    with pytest.raises(ValueError, match="invalid range"):
        load_profiles(path)


def test_rejects_empty_stepped(tmp_path):
    path = _write(tmp_path, {"profiles": {"P": {"pw": {"kind": "stepped", "values": []}}}})
    with pytest.raises(ValueError, match="non-empty"):
        load_profiles(path)


def test_committed_file_is_valid():
    # The real committed machine_profiles.json must always pass validation.
    from xcs_gen.profiles_loader import load_profiles as lp, DEFAULT_PATH
    validate_profiles(lp(DEFAULT_PATH))
```

- [ ] **Step 3: Run test to verify it fails**

Run: `uv run --active pytest tests/test_profiles_loader.py -q`
Expected: FAIL — `ModuleNotFoundError: xcs_gen.profiles_loader`.

- [ ] **Step 4: Write the loader**

Create `src/xcs_gen/profiles_loader.py`:

```python
"""Load + validate the extracted machine validation profiles.

The committed dataset lives at ``data/machine_profiles.json`` and is the
source of truth for per-(machine, mode) constraints. ``machines.py`` loads
it at import time. Shape per profile mirrors what /api/machines returns:
``{ field: FieldConstraint }`` where FieldConstraint is one of
range / stepped / not_applicable / enum.
"""

from __future__ import annotations

import json
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent / "data" / "machine_profiles.json"

_VALID_KINDS = {"range", "stepped", "not_applicable", "enum"}


def _validate_constraint(profile_id: str, field_name: str, c: dict) -> None:
    kind = c.get("kind")
    if kind not in _VALID_KINDS:
        raise ValueError(
            f"{profile_id}.{field_name}: unknown constraint kind {kind!r}",
        )
    if kind == "range":
        lo, hi = c.get("min"), c.get("max")
        if lo is None or hi is None or lo > hi:
            raise ValueError(
                f"{profile_id}.{field_name}: invalid range {lo!r}..{hi!r}",
            )
    elif kind in ("stepped", "enum"):
        vals = c.get("values")
        if not isinstance(vals, list) or not vals:
            raise ValueError(
                f"{profile_id}.{field_name}: {kind} needs a non-empty values list",
            )


def validate_profiles(profiles: dict[str, dict[str, dict]]) -> None:
    """Raise ValueError if any constraint is malformed."""
    for pid, prof in profiles.items():
        for field_name, c in prof.items():
            _validate_constraint(pid, field_name, c)


def load_profiles(path: Path = DEFAULT_PATH) -> dict[str, dict[str, dict]]:
    """Read + validate the profiles JSON, returning the ``profiles`` dict."""
    raw = json.loads(Path(path).read_text())
    profiles = raw.get("profiles", {})
    validate_profiles(profiles)
    return profiles
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run --active pytest tests/test_profiles_loader.py -q`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen/profiles_loader.py src/xcs_gen/data/machine_profiles.json tests/test_profiles_loader.py
git commit -m "feat(profiles): JSON loader + validation for machine profiles"
```

---

## Task 2: Bundle range-parser tool

**Files:**
- Create: `tools/xtool-extract/parse-bundle.mjs`

This extracts the base numeric field ranges from one ext bundle by regexing the
field-definition objects (`NAME:{label:`device.common.X`,...,min:N,max:M,...}`),
the pattern proven during capture. Per-mode overrides (e.g. Color Engrave density
1–5000) are handled manually in Task 4 — this tool gives the per-field base
envelope.

- [ ] **Step 1: Write the parser**

Create `tools/xtool-extract/parse-bundle.mjs`:

```javascript
// Extract base field-constraint ranges from one xTool Studio ext bundle.
// Usage: node parse-bundle.mjs /tmp/Contents/Resources/exts/<dir>/index.js
// Emits JSON: { field: {min, max, defMin, defMax, label} , ... } to stdout.
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node parse-bundle.mjs <ext-bundle/index.js>");
  process.exit(2);
}
const js = readFileSync(file, "utf8");

// Field-definition objects: NAME:{label:`device.common.X`, ... min:N, max:M, ...}
const re = /(\w+):\{label:`(device\.common\.[^`]+)`[^{}]*?\}/g;
const out = {};
let m;
while ((m = re.exec(js))) {
  const block = m[0];
  const num = (k) => {
    const mm = block.match(new RegExp(k + ":(-?[0-9.]+(?:e[0-9]+)?)"));
    return mm ? Number(mm[1]) : null;
  };
  const key = m[1];
  const rec = {
    label: m[2].replace("device.common.", ""),
    min: num("min"),
    max: num("max"),
    defMin: num("defaultMinValue"),
    defMax: num("defaultMaxValue"),
  };
  // Keep the widest seen range for a repeated field name (union envelope).
  const prev = out[key];
  if (!prev) out[key] = rec;
  else {
    if (rec.min != null && (prev.min == null || rec.min < prev.min)) prev.min = rec.min;
    if (rec.max != null && (prev.max == null || rec.max > prev.max)) prev.max = rec.max;
  }
}
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
```

- [ ] **Step 2: Verify against the F2 Ultra bundle (known-good values)**

Run:
```bash
node tools/xtool-extract/parse-bundle.mjs /tmp/Contents/Resources/exts/GS004-CLASS-4/index.js
```
Expected: includes `power {min:1,max:100}`, `pulseWidth {min:2,max:500}`, `frequency {min:40,max:150}`, `dpi {min:1,max:1270}`, `density {min:1,max:300}`, `repeat {min:1,max:10}`, `cutPressure {min:45,max:360}`. If those appear, the parser works.

NOTE: this parser captures only the **base** field-def blocks (`density:{label:`device.common.lines_per_cm`,...max:300}`). The Color-Engrave density max of **5000** lives in a different widget-config structure — `{name:`density`,...widgetAttrs:{...max:5e3...}}` — which this regex intentionally does NOT match. That per-mode override is sourced manually in Task 4 (Step 2).

- [ ] **Step 3: Commit**

```bash
git add tools/xtool-extract/parse-bundle.mjs
git commit -m "feat(tools): xtool ext-bundle field-range parser"
```

---

## Task 3: CDP pulse_width enum reader

**Files:**
- Create: `tools/xtool-extract/read-pulse-enums.mjs`

Reads the pulse_width dropdown options from the live Studio renderer DOM (the
enum isn't a static literal in the bundle). Requires Studio launched with
`--remote-debugging-port=9222` and the editor open on the target machine/mode.

- [ ] **Step 1: Write the reader**

Create `tools/xtool-extract/read-pulse-enums.mjs`:

```javascript
// Read the open pulse-width <select> options from the Studio editor renderer.
// Prereq: Studio launched with --remote-debugging-port=9222, editor open, and
// the Pulse width dropdown for the target machine/mode visible.
// Usage: node read-pulse-enums.mjs   (auto-finds the editor page target)
const BASE = "http://127.0.0.1:9222";

const targets = await (await fetch(BASE + "/json")).json();
const editor = targets.find((t) => t.type === "page" && /renderer\/editor/.test(t.url || ""));
if (!editor) { console.error("no editor page target — open a project in Studio"); process.exit(1); }

const ws = new WebSocket(editor.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
});
ws.addEventListener("open", async () => {
  await send("Runtime.enable");
  const expr = `[...document.querySelectorAll('[role="option"]')].map(e=>e.textContent.trim()).filter(t=>/^\\d+$/.test(t)).map(Number)`;
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  process.stdout.write(JSON.stringify(r.result.value) + "\n");
  ws.close();
  process.exit(0);
});
```

- [ ] **Step 2: Verify (operator) against F2 Ultra**

With Studio running (`--remote-debugging-port=9222`) and the Pulse width dropdown open on F2 Ultra Color Engrave, run:
```bash
node tools/xtool-extract/read-pulse-enums.mjs
```
Expected: `[2,4,6,9,13,20,30,45,60,80,100,150,200,250,350,500]`.

- [ ] **Step 3: Commit**

```bash
git add tools/xtool-extract/read-pulse-enums.mjs
git commit -m "feat(tools): CDP pulse-width enum reader"
```

---

## Task 4: Produce & hand-verify `machine_profiles.json` (operator)

**Files:**
- Modify: `src/xcs_gen/data/machine_profiles.json` (replace the Task 1 stub)

This is a data-production task, not code. Assemble one profile per supported
`(machine, mode)` (per the spec's availability table) using the tools + capture.

- [ ] **Step 1: Extract base ranges for all six machines**

Run the parser for each bundle dir and save raw output:
```bash
mkdir -p /tmp/profile-build
for d in GS004-CLASS-4 GS007-CLASS-4 GS009-CLASS-4 F1Ultra GS005 F1; do
  node tools/xtool-extract/parse-bundle.mjs "/tmp/Contents/Resources/exts/$d/index.js" > "/tmp/profile-build/$d.json"
done
ls -la /tmp/profile-build/
```

- [ ] **Step 2: Determine per-mode overrides and applicability**

For each machine, decide each `(mode, field)` constraint by combining:
- **Base ranges** from Step 1 (`power→power`, `speed→speed`, `frequency→frequency`, `density→density`, `passes→repeat`, `pulse_width→pulseWidth`).
- **Per-mode density override:** Color Engrave density max = 5000; base engrave modes = 300 (or the machine's `density` base if lower). The base parser (Task 2) does NOT capture the 5000 — it's in a `{name:`density`,...widgetAttrs:{...max:5e3...}}` widget config. Find it with: `node -e 'const js=require("fs").readFileSync("/tmp/Contents/Resources/exts/GS004-CLASS-4/index.js","utf8");const i=js.indexOf("max:5e3");console.log(js.slice(i-220,i+40))'` and confirm it sits in a `density`/`lines_per_cm` group near `device.gs.color_engrave`.
- **Applicability (`not_applicable`):** for each `(machine, mode)`, a field is `not_applicable` if that processingType's recommended entries in `atomm_material.json` never set it. Verify with:
  ```bash
  node -e 'const d=require(process.env.HOME+"/xtool-param-capture/atomm_material.json");
    const code="GS004-CLASS-4", pt="VECTOR_CUTTING";
    const ps=d.materialParams.filter(m=>m.deviceCode===code).flatMap(m=>m.machineParas||[]).filter(p=>p.processingType?.code===pt);
    const f=(k)=>[...new Set(ps.map(p=>p[k]).filter(v=>v!==""&&v!=null))];
    console.log(pt, {density:f("density"), pulseWidth:f("pulseWidth"), frequency:f("frequency")});'
  ```
  e.g. cut → `density: not_applicable`; diode-only machines/modes → `pulse_width: not_applicable`.
- **pulse_width enum:** for IR machines/modes, run Task 3's reader with Studio on that machine/mode. (F2 Ultra family share the MOPA list `[2,4,6,9,13,20,30,45,60,80,100,150,200,250,350,500]`; confirm F1 Ultra separately.)
- **laser enum:** from `sourcePowerAssoc` in `material-device-basic-info.json` (F2 Ultra `["red","blue"]`, F1 Lite `["blue"]`, F1 `["blue","red"]`, UV `["uv"]`).
- **Superset rule:** where a numeric field's range differs by source within a mode, take min-of-mins / max-of-maxes.
- **color_engrave on UV / F1 Ultra:** grep those two bundles for `device.gs.color_engrave`; include the mode only if present.

- [ ] **Step 3: Diff against the current hardcoded profiles (migration safety)**

For every field, compare the new range to today's value in `machines.py` (`STANDARD`/`COLOR_ENGRAVE`). For any field whose new range is **tighter** (smaller max or larger min), note it — either widen to cover the old bound or accept that saved values snap/clamp. Record findings in `tools/xtool-extract/README.md` (Task 9).

- [ ] **Step 4: Write `machine_profiles.json`**

Assemble `src/xcs_gen/data/machine_profiles.json` with one profile per supported `(machine, mode)`, id `"<machineId>:<mode>"`. Example entry (use real extracted numbers):

```json
{
  "meta": { "source": "xTool Studio 1.7.24", "extracted": "2026-06-01", "tool": "tools/xtool-extract" },
  "profiles": {
    "F2Ultra:color_engrave": {
      "power": {"kind":"range","min":1,"max":100,"step":1},
      "density": {"kind":"range","min":1,"max":5000,"step":1},
      "frequency": {"kind":"range","min":40,"max":150,"step":1},
      "speed": {"kind":"range","min":2,"max":15000,"step":1},
      "passes": {"kind":"range","min":1,"max":99,"step":1},
      "pulse_width": {"kind":"stepped","values":[2,4,6,9,13,20,30,45,60,80,100,150,200,250,350,500]},
      "laser": {"kind":"enum","values":["red","blue"]}
    },
    "F2Ultra:cut": {
      "power": {"kind":"range","min":1,"max":100,"step":1},
      "density": {"kind":"not_applicable"},
      "frequency": {"kind":"range","min":40,"max":150,"step":1},
      "speed": {"kind":"range","min":2,"max":10000,"step":1},
      "passes": {"kind":"range","min":1,"max":250,"step":1},
      "pulse_width": {"kind":"stepped","values":[2,4,6,9,13,20,30,45,60,80,100,150,200,250,350,500]},
      "laser": {"kind":"enum","values":["red","blue"]}
    }
  }
}
```

Profile ids required (only where the mode is supported per the spec table):
`F2Ultra:{engrave,score,cut,color_engrave,intaglio,relief}`,
`F2UltraSingle:{engrave,score,cut,color_engrave,intaglio,relief}`,
`F2UltraUV:{engrave,score,cut,intaglio,relief}` (+`color_engrave` only if its bundle has it),
`F1Ultra:{engrave,score,cut,intaglio,relief}` (+`color_engrave` only if present),
`F1Lite:{engrave,score,cut}`,
`F1:{engrave,score,cut}`.

- [ ] **Step 5: Cross-check recommended values fall in range**

Run this guard for each machine to catch extraction errors (recommended presets must be inside the extracted ranges):
```bash
node -e 'const fs=require("fs");
  const prof=JSON.parse(fs.readFileSync("src/xcs_gen/data/machine_profiles.json","utf8")).profiles;
  const d=require(process.env.HOME+"/xtool-param-capture/atomm_material.json");
  const map={VECTOR_ENGRAVING:"score",BITMAP_ENGRAVING:"engrave",VECTOR_CUTTING:"cut",INTAGLIO:"intaglio",RELIEF:"relief"};
  const code="GS004-CLASS-4", mid="F2Ultra";
  for(const mp of d.materialParams.filter(m=>m.deviceCode===code))for(const p of (mp.machineParas||[])){
    const mode=map[p.processingType?.code]; if(!mode) continue;
    const prf=prof[mid+":"+mode]; if(!prf) continue;
    for(const [f,xk] of [["power","power"],["speed","speed"],["density","density"]]){
      const c=prf[f]; const v=p[xk];
      if(c&&c.kind==="range"&&typeof v==="number"&&(v<c.min||v>c.max))
        console.log("OUT OF RANGE",mode,f,v,"not in",c.min,c.max);
    }
  }
  console.log("cross-check done");'
```
Expected: only `cross-check done` (no `OUT OF RANGE` lines). Fix the JSON if any appear.

- [ ] **Step 6: Verify the loader accepts the real file**

Run: `uv run --active pytest tests/test_profiles_loader.py::test_committed_file_is_valid -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/xcs_gen/data/machine_profiles.json
git commit -m "feat(profiles): extracted F2/F1 family validation profiles"
```

---

## Task 5: Migrate `machines.py` registry (TDD)

**Files:**
- Modify: `src/xcs_gen/machines.py`
- Modify: `tests/test_machines.py`, `tests/test_machines_endpoint.py`, `tests/test_validation_profiles.py`, `tests/test_machine_device.py`, `tests/test_xcs_builder_machines.py`

- [ ] **Step 1: Write the failing test for the new registry**

Add to `tests/test_machines.py`:

```python
def test_six_machines_registered():
    from xcs_gen import machines
    ids = set(machines.known_ids())
    assert {"F2Ultra", "F2UltraSingle", "F2UltraUV", "F1Ultra", "F1Lite", "F1"} <= ids


def test_profile_ids_are_per_machine_mode():
    from xcs_gen import machines
    assert machines.profile_for("F2Ultra", "color_engrave") == "F2Ultra:color_engrave"
    assert machines.profile_for("F1Lite", "engrave") == "F1Lite:engrave"


def test_every_mode_profile_exists_in_loaded_profiles():
    from xcs_gen import machines
    for m in machines.all_machines():
        for mode in m.modes:
            assert mode.profile in machines.PROFILES, f"missing profile {mode.profile}"


def test_intaglio_and_relief_modes_on_f2ultra():
    from xcs_gen import machines
    modes = {m.id for m in machines.get("F2Ultra").modes}
    assert {"intaglio", "relief"} <= modes


def test_device_power_unchanged_for_dual_laser():
    from xcs_gen import machines
    assert machines.device_power("F2Ultra") == [60, 40]
    assert machines.device_power("F1Ultra") == [20, 20]
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run --active pytest tests/test_machines.py -q`
Expected: FAIL (new machines/modes absent; profile ids still `STANDARD`).

- [ ] **Step 3: Update the type aliases + laser kinds**

In `src/xcs_gen/machines.py`, replace lines 18-21:

```python
LaserKind = Literal["fiber", "blue", "uv"]
LaserName = Literal["red", "blue", "uv"]   # the wire-format name used inside .xcs files
ModeId = Literal["engrave", "score", "cut", "color_engrave", "intaglio", "relief"]
ProfileId = str   # per-machine "<machineId>:<mode>"; validated by profiles_loader
```

And extend the laser-name map at line 26:

```python
_LASER_NAME_TO_KIND: dict[LaserName, LaserKind] = {"red": "fiber", "blue": "blue", "uv": "uv"}
```

- [ ] **Step 4: Replace the registry with six machines**

Replace the `_MACHINES` dict (lines 59-93). Use a helper so each machine's modes reference `"<id>:<mode>"` ids and only list modes present in `PROFILES`:

```python
def _modes(machine_id: str, mode_ids: tuple[str, ...]) -> tuple[ModeSpec, ...]:
    return tuple(ModeSpec(m, f"{machine_id}:{m}") for m in mode_ids)


_MACHINES: dict[str, MachineSpec] = {
    "F2Ultra": MachineSpec(
        id="F2Ultra", display_name="F2 Ultra",
        ext_id="GS004-CLASS-4", ext_name="F2 Ultra", image="f2ultra.png",
        lasers=(LaserSpec("fiber", 60, (0.03, 0.03)), LaserSpec("blue", 40, (0.08, 0.10))),
        modes=_modes("F2Ultra", ("engrave", "score", "cut", "color_engrave", "intaglio", "relief")),
    ),
    "F2UltraSingle": MachineSpec(
        id="F2UltraSingle", display_name="F2 Ultra (Single)",
        ext_id="GS007-CLASS-4", ext_name="F2 Ultra", image="f2ultrasingle.png",
        lasers=(LaserSpec("fiber", 60, (0.03, 0.03)),),
        modes=_modes("F2UltraSingle", ("engrave", "score", "cut", "color_engrave", "intaglio", "relief")),
    ),
    "F2UltraUV": MachineSpec(
        id="F2UltraUV", display_name="F2 Ultra UV",
        ext_id="GS009-CLASS-4", ext_name="F2 Ultra UV", image="f2ultrauv.png",
        lasers=(LaserSpec("uv", 5, (0.02, 0.02)),),
        modes=_modes("F2UltraUV", ("engrave", "score", "cut", "intaglio", "relief")),
    ),
    "F1Ultra": MachineSpec(
        id="F1Ultra", display_name="F1 Ultra",
        ext_id="F1Ultra", ext_name="F1 Ultra", image="f1ultra.png",
        lasers=(LaserSpec("fiber", 20, (0.03, 0.03)), LaserSpec("blue", 20, (0.08, 0.10))),
        modes=_modes("F1Ultra", ("engrave", "score", "cut", "intaglio", "relief")),
    ),
    "F1Lite": MachineSpec(
        id="F1Lite", display_name="F1 Lite",
        ext_id="GS005", ext_name="F1 Lite", image="f1lite.png",
        lasers=(LaserSpec("blue", 10, (0.08, 0.10)),),
        modes=_modes("F1Lite", ("engrave", "score", "cut")),
    ),
    "F1": MachineSpec(
        id="F1", display_name="F1",
        ext_id="F1", ext_name="F1", image="f1.png",
        lasers=(LaserSpec("blue", 10, (0.08, 0.10)), LaserSpec("fiber", 2, (0.03, 0.03))),
        modes=_modes("F1", ("engrave", "score", "cut")),
    ),
}
```

> NOTE: if Task 4 found `device.gs.color_engrave` in the F2UltraUV / F1Ultra bundles, add `"color_engrave"` to their mode tuples (and ensure those profile ids exist in the JSON). Otherwise leave as above.

- [ ] **Step 5: Load PROFILES from JSON + generalise `device_power`**

Replace the hardcoded `PROFILES` block (lines 143-174) with:

```python
from .pulse_width import snap_pulse_width  # noqa: E402  (used by validate_against_profile)
from .profiles_loader import load_profiles  # noqa: E402

# Loaded from data/machine_profiles.json (extracted from xTool Studio).
PROFILES: dict[str, dict[str, dict]] = load_profiles()
```

Replace `device_power` (lines 133-138) so it tolerates non-dual-laser machines while staying bit-identical for dual ones:

```python
def device_power(machine_id: str) -> list[int]:
    """``device.power`` list as written to .xcs files, ordered fiber, blue, uv."""
    m = get(machine_id)
    order = {"fiber": 0, "blue": 1, "uv": 2}
    return [laser.wattage for laser in sorted(m.lasers, key=lambda x: order.get(x.kind, 9))]
```

(Removes the old `from .pulse_width import ALLOWED_PULSE_WIDTHS, snap_pulse_width` line and the `_STANDARD_DENSITY` constant, now unused.)

- [ ] **Step 6: Run the new registry tests**

Run: `uv run --active pytest tests/test_machines.py -q`
Expected: PASS.

- [ ] **Step 7: Update the rest of the affected backend tests**

Run the full machine/profile suite and fix assertions that referenced the old scheme:

Run: `uv run --active pytest tests/test_machines_endpoint.py tests/test_validation_profiles.py tests/test_machine_device.py tests/test_xcs_builder_machines.py -q`

For each failure, update per these rules (read the test, then edit):
- Profile-id assertions `"STANDARD"`/`"COLOR_ENGRAVE"` → `"<machineId>:<mode>"` (e.g. `profile_for("F2Ultra","engrave")` is now `"F2Ultra:engrave"`).
- `validate_against_profile("STANDARD", …)` / `("COLOR_ENGRAVE", …)` → use a real id like `"F2Ultra:engrave"` / `"F2Ultra:color_engrave"`.
- Any hardcoded range assertion that changed with real data (e.g. frequency `30..60`) → assert against the value now in `machines.PROFILES["F2Ultra:engrave"]["frequency"]` rather than a literal, so the test tracks the data.
- `/api/machines` count/shape assertions → expect six machines; keep shape checks (`machines`, `profiles` keys) unchanged.

- [ ] **Step 8: Run the whole backend suite**

Run: `uv run --active pytest tests/ -q`
Expected: PASS (fix any remaining stragglers the same way).

- [ ] **Step 9: Commit**

```bash
git add src/xcs_gen/machines.py tests/
git commit -m "feat(machines): six machines, intaglio/relief modes, per-machine profiles from JSON"
```

---

## Task 6: Backend schema + default-mode helper (TDD)

**Files:**
- Modify: `src/xcs_gen_web/schemas.py:48`
- Modify: `src/xcs_gen_web/app.py:~1293`
- Modify: `tests/test_validation_endpoints.py` (if it asserts the mode literal)

- [ ] **Step 1: Write the failing test**

Add to `tests/test_machines_endpoint.py`:

```python
def test_intaglio_mode_accepted_by_schema():
    from xcs_gen_web.schemas import BaseParams
    bp = BaseParams(power=50, speed=1000, mode="intaglio")
    assert bp.mode == "intaglio"
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run --active pytest tests/test_machines_endpoint.py::test_intaglio_mode_accepted_by_schema -q`
Expected: FAIL — pydantic rejects `"intaglio"`.

- [ ] **Step 3: Widen the schema literal**

In `src/xcs_gen_web/schemas.py:48`:

```python
    mode: Literal["engrave", "score", "cut", "color_engrave", "intaglio", "relief"] | None = None
```

- [ ] **Step 4: Generalise the default-mode helper**

In `src/xcs_gen_web/app.py` (the helper around line 1293 returning `"color_engrave" if machine_id == "F2Ultra" else "engrave"`), replace with a registry-aware version:

```python
        from xcs_gen.machines import get
        supported = {m.id for m in get(machine_id).modes}
        return "color_engrave" if "color_engrave" in supported else "engrave"
```

- [ ] **Step 5: Run tests**

Run: `uv run --active pytest tests/test_machines_endpoint.py tests/test_validation_endpoints.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/schemas.py src/xcs_gen_web/app.py tests/
git commit -m "feat(api): accept intaglio/relief modes; registry-aware default mode"
```

---

## Task 7: Frontend types + mode labels (TDD)

**Files:**
- Modify: `web/src/types.ts:349-383`
- Modify: `web/src/components/ParamTestEditor.tsx:1136`
- Modify: `web/src/state/machine.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `web/src/state/machine.test.ts` (inside the existing describe, using the existing mock-registry pattern — extend the mock to include an `F2Ultra` machine with an `intaglio` mode pointing at profile id `"F2Ultra:intaglio"`, and a matching entry in `profiles`):

```typescript
  it("resolves a per-machine intaglio profile id", () => {
    const reg = {
      machines: [{ id: "F2Ultra", display_name: "F2 Ultra", ext_id: "", ext_name: "", image: "",
        lasers: [], modes: [{ id: "intaglio", profile: "F2Ultra:intaglio" }] }],
      profiles: { "F2Ultra:intaglio": { power: { kind: "range", min: 1, max: 100 } } },
    } as unknown as MachinesPayload;
    const p = getValidationProfile(reg, "F2Ultra", "intaglio");
    expect(p?.power).toEqual({ kind: "range", min: 1, max: 100 });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/state/machine.test.ts`
Expected: FAIL — TypeScript error: `"intaglio"` not assignable to `ModeId`, and `"F2Ultra:intaglio"` not assignable to `ProfileId`.

- [ ] **Step 3: Widen the frontend types**

In `web/src/types.ts`, replace lines 349-350:

```typescript
export type ModeId = "engrave" | "score" | "cut" | "color_engrave" | "intaglio" | "relief";
export type ProfileId = string;   // per-machine "<machineId>:<mode>"
```

And line 383 (`MachinesPayload.profiles`):

```typescript
  profiles: Record<string, ValidationProfile>;
```

- [ ] **Step 4: Add mode labels**

In `web/src/components/ParamTestEditor.tsx`, extend `MODE_LABELS` (line 1136) with:

```typescript
  intaglio: "Intaglio",
  relief: "Relief",
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd web && npx tsc --noEmit && npx vitest run src/state/machine.test.ts`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/types.ts web/src/components/ParamTestEditor.tsx web/src/state/machine.test.ts
git commit -m "feat(web): intaglio/relief modes + string profile ids"
```

---

## Task 8: Machine images

**Files:**
- Create: `web/public/machines/f2ultrasingle.png`, `f2ultrauv.png`, `f1lite.png`, `f1.png`

- [ ] **Step 1: Source the images**

Look for machine artwork in the Studio bundle first:
```bash
find /tmp/Contents/Resources -iname '*.png' -path '*machine*' 2>/dev/null | head
find /tmp/Contents/Resources -iname '*f2*ultra*' 2>/dev/null | head
```
If suitable images exist, copy them to the four target filenames. If not, copy the existing `web/public/machines/f2ultra.png` as a temporary placeholder for the F2 variants and `f1ultra.png` for `f1lite.png`/`f1.png`:
```bash
cd web/public/machines
cp f2ultra.png f2ultrasingle.png
cp f2ultra.png f2ultrauv.png
cp f1ultra.png f1lite.png
cp f1ultra.png f1.png
ls -la
```
(Note placeholder use in the changelog / README so real art can replace them later.)

- [ ] **Step 2: Verify the switcher renders all six (build + browser)**

Run: `cd web && npm run build > /dev/null 2>&1 && echo built`
Then with the dev server running (`uv run --active xcs-gen serve --host 127.0.0.1 --port 8017`), open the app and confirm the machine switcher lists all six machines with images and no broken-image icons.

- [ ] **Step 3: Commit**

```bash
git add web/public/machines/
git commit -m "feat(web): machine images for F2 variants + F1 family"
```

---

## Task 9: Extraction docs, changelog, final verification

**Files:**
- Create: `tools/xtool-extract/README.md`
- Create: `changelog/2026-06-01-machine-profiles.md`

- [ ] **Step 1: Write the extraction procedure doc**

Create `tools/xtool-extract/README.md` documenting: launching Studio with `--remote-debugging-port=9222`, running `parse-bundle.mjs` per bundle dir, running `read-pulse-enums.mjs` per IR machine/mode, the applicability/superset rules, the cross-check command from Task 4 Step 5, and the migration-diff findings from Task 4 Step 3. Note any placeholder machine images.

- [ ] **Step 2: Write the changelog entry**

Create `changelog/2026-06-01-machine-profiles.md`:

```markdown
---
id: 2026-06-01-machine-profiles
date: 2026-06-01
level: minor
title: Real machine limits for the F2 Ultra & F1 families
summary: Param fields are now bounded by xTool's actual per-machine, per-mode limits, and four more machines are selectable.
---
```

- [ ] **Step 3: Full verification**

Run all gates:
```bash
uv run --active pytest tests/ -q
cd web && npx tsc --noEmit && npm test && npm run build > /dev/null 2>&1 && echo "web ok"
```
Expected: backend green, tsc clean, vitest green, build succeeds.

- [ ] **Step 4: Browser smoke test**

With the dev server running: switch to F1 Ultra and confirm the param form shows F1 Ultra ranges; switch to F2 Ultra and open Forge — confirm `ForgeStageParams` shows the real Color Engrave constraints (pulse-width dropdown with the 16 values, density up to 5000). Screenshot and read critically.

- [ ] **Step 5: Commit + open PR**

```bash
git add tools/xtool-extract/README.md changelog/2026-06-01-machine-profiles.md
git commit -m "docs(profiles): extraction procedure + changelog"
git push -u origin feat/machine-validation-profiles
gh pr create --draft --title "Real machine validation profiles (F2/F1 families)" --body "Phase 1 of machine validation profiles. Extracts real per-machine/mode constraints from xTool Studio into a committed machine_profiles.json the backend loads, adds four machines + intaglio/relief modes. Spec: docs/superpowers/specs/2026-06-01-validation-profiles-design.md"
```

---

## Self-Review Notes

- **Spec coverage:** machines+modes (Task 5), extraction tooling (Tasks 2–3), JSON data + format + loader (Tasks 1, 4), superset rule + applicability (Task 4 Step 2), backend serving unchanged (Task 5 uses existing `/api/machines`), validation/back-compat (Task 4 Step 3 + Task 5), frontend consumers auto-fed (Tasks 5+7), testing (every task), images (Task 8), docs+changelog (Task 9). The four open risks are addressed in Task 4 (per-mode parse, color_engrave on UV/F1Ultra, pulse_width enum per machine) and Task 8 (images).
- **Profile-id scheme** `"<machineId>:<mode>"` is used consistently across Tasks 4, 5, 7.
- **Known non-TDD tasks:** Tasks 2–4 and 8 are tooling/data/asset production — they use concrete commands + acceptance checks rather than red-green-refactor, which is appropriate for extraction work.
