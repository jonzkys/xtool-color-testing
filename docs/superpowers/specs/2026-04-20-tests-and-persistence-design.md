# Tests as Persistent Entities + SQLite Persistence

**Date:** 2026-04-20
**Status:** Accepted (pending plan)

## Summary

Elevate "parameter tests" from transient entries in a browser-local `Project`
to first-class persistent entities stored in SQLite. Results (burned-strip
photos + sampled swatches) attach to tests. Palette entries flow from test
results only — the standalone photo-upload path is removed. Shrink the
substrate footprint of registration markers by replacing the single 12 mm
inline QR with a tiny ID-only QR plus three ArUco corners. Upgrade the
in-app preview to render the real cell structure and fiducials.

## Non-goals

- Migrating existing `palette.json`, `xcs-gen:project:v1`, or
  `xcs-gen:library:v1` data. Clean slate — nothing carries forward.
- Duplicate-test detection on the Materials page (deferred).
- Multi-device synchronisation beyond "point a second browser at the same
  backend". No auth, no per-user scoping.
- MySQL today. The choice of SQLAlchemy Core + Alembic preserves the option
  later.

## Architecture overview

A new `Tests` tab replaces `Param tests` at the top level. It lists test
rows (filterable by material and status) and, on selection, opens a detail
page with:

- **Left** — parameter editor (ported from today's `TestEditor.tsx`).
- **Center** — upgraded SVG preview: real cell shape, correct wrapped rows,
  per-row axis labels, QR + 3 ArUcos drawn to scale.
- **Right** — results panel: photo upload, per-result cards, averaged
  swatch grid, ingest-to-palette action.

`palette.json` retires. SQLite at `~/.xcs-gen/app.db` (overridable via
`XCS_GEN_DB_URL`). Images live at `~/.xcs-gen/images/<test_id>/<result_id>.<ext>`.

The `Project` localStorage blob retires. Library (materials + presets)
moves server-side. The frontend becomes a thin client: every read is a
REST call.

Fiducial burns change from "12 mm inline QR at one corner" to "4–6 mm
ID-only QR at top-left + three 2 mm ArUco corners". The QR payload shrinks
to `{"v":1,"id":<int>}`; the server resolves the spec from the database.

Top-level tabs after: `Tests · SVG stack · SVG layers · Library · Palette`.

## Data model

SQLite schema, managed by Alembic. Keys and typing shown in simplified
form; actual DDL in the migration file.

```
materials
  id                INTEGER PK AUTOINCREMENT
  name              TEXT NOT NULL
  notes             TEXT
  created_at        TEXT NOT NULL          -- ISO 8601 UTC

presets
  id                INTEGER PK AUTOINCREMENT
  material_id       INTEGER NOT NULL FK → materials(id)
  name              TEXT NOT NULL
  color             TEXT
  is_default        INTEGER NOT NULL       -- 0/1, exactly one true per material
  base_params_json  TEXT NOT NULL          -- {power, speed, frequency, density, passes, pulse_width, laser}
  created_at        TEXT NOT NULL
  updated_at        TEXT NOT NULL

tests
  id                INTEGER PK AUTOINCREMENT    -- QR payload carries this
  name              TEXT NOT NULL
  material_id       INTEGER NOT NULL FK → materials(id)
  status            TEXT NOT NULL              -- 'created' | 'tested' | 'deleted'
  spec_json         TEXT NOT NULL              -- full ParamTest shape
  notes             TEXT DEFAULT ''
  created_at        TEXT NOT NULL
  updated_at        TEXT NOT NULL
  locked            INTEGER NOT NULL DEFAULT 0 -- 1 after first result write; never unset; blocks spec edits

results
  id                INTEGER PK AUTOINCREMENT
  test_id           INTEGER NOT NULL FK → tests(id)
  uploaded_at       TEXT NOT NULL
  image_path        TEXT NOT NULL              -- relative to images root
  image_sha256      TEXT NOT NULL              -- dedup + integrity
  excluded          INTEGER NOT NULL DEFAULT 0 -- excluded from test's avg
  notes             TEXT DEFAULT ''
  swatches_json     TEXT NOT NULL              -- [{row, col, x_value, y_value, hex, lab, sigma}, ...]

palette_entries
  id                INTEGER PK AUTOINCREMENT
  test_id           INTEGER NOT NULL FK → tests(id)
  material_id       INTEGER NOT NULL FK → materials(id)
  x_value           REAL
  y_value           REAL
  hex               TEXT NOT NULL
  lab_l, lab_a, lab_b  REAL NOT NULL
  params_json       TEXT NOT NULL              -- base + x + y value resolved
  sigma             REAL NOT NULL
  source            TEXT NOT NULL              -- 'averaged' | 'single_result'
  source_result_id  INTEGER NULL FK → results(id)
  notes             TEXT DEFAULT ''
  created_at        TEXT NOT NULL
```

**Invariants:**

- `tests.id` is the canonical identifier; the QR carries it.
- `locked=1` set on the first result write (excluded or not) and never
  unset → `spec_json` is immutable; editor offers "Duplicate as new test"
  in place of Save.
- `results.swatches_json` holds the raw capture for that single upload.
  The test's averaged swatch set is computed on read (Lab-space average
  across non-excluded results); not stored.
- `palette_entries.lab_*` are split into three REAL columns to leave the
  door open for index-assisted nearest-neighbour narrowing. Current query
  is a full scan; fine at expected scale.
- `status` is denormalised for UI filtering speed. It's set in exactly one
  place: the server path that writes a result.
- Materials with referencing tests or presets cannot be hard-deleted
  (matches existing Library behaviour).

**Why opaque JSON for spec/params/swatches:** these blobs are consumed
whole by the app; no query filters on their internals. Storing as TEXT
keeps the schema minimal and lets the blob shape evolve without migration.
CIEDE2000 queries need only `lab_*` and `material_id`, which are
first-class columns.

**Indexes:** `tests(material_id)`, `tests(status)`, `results(test_id)`,
`palette_entries(material_id)`.

## Fiducials + capture pipeline

Burned markers on each strip:

| Marker | Size | Position | Purpose |
|---|---|---|---|
| ID-only QR (v1, ECC-M) | 5 mm default; configurable 4–6 mm | Top-left | Carries `{"v":1,"id":<int>}` |
| ArUco 4×4 (`DICT_4X4_50`), IDs 1/2/3 | 2 mm default; configurable | Top-right, bottom-left, bottom-right | 4-point homography baseline |

A 1.5 mm margin separates every marker from the strip edge and from the
grid, matching the existing `MARKER_MARGIN_MM`. The grid insets so its
bounding box never intersects any marker.

Homography uses all four known marker positions (QR's top-left module
plus the three ArUcos) as burn-space anchors — over-determined least
squares via `cv2.findHomography(..., cv2.RANSAC)`. A single damaged
marker still leaves a valid fit.

**Backend rendering (`src/xcs_gen/capture/`):**

- `layout.py` gains `compute_layout_with_aruco()` returning
  `{qr: MarkerPosition, arucos: [MarkerPosition, MarkerPosition, MarkerPosition]}`.
  The old single-QR layout is removed.
- `marker_render.py` gains `render_aruco(marker_id: int, size_mm: float) -> bits`
  using `DICT_4X4_50`. Emitted as BITMAP displays on the annotation layer,
  same path as the QR.
- `qr_payload.py` keeps only `encode_id_only()`. The `encode_inline()`
  function is removed along with its tests.

**Ingest pipeline (`src/xcs_gen_web/capture_pipeline.py`):**

- `detect_fiducials(img) -> (qr_id: int, corners_px: dict[int, (x, y)])`
  uses `pyzbar` for the QR and `cv2.aruco.detectMarkers` for the ArUcos.
- `warp_to_burn_space` is rewritten to take a mapping of
  `{marker_id → burn-space mm}` plus detected pixel positions and compute
  a least-squares homography.

**Failure modes:**

- QR decodable but `qr_id` mismatches the path-parameter test id → HTTP
  400 "QR on photo (#N) does not match this test (#M)".
- QR undecodable: fall back to ArUco-only homography, then the upload UI
  prompts the user to confirm "this photo is for test #N". The test id is
  already known client-side (you're on the test's page).
- Fewer than 3 ArUcos detected → HTTP 400 "insufficient fiducials;
  re-take photo".

**Capture knobs preserved on the editor:** fiducial mode (`on`/`off`),
QR size mm, ArUco size mm. The `qr_position` and `qr_mode` sub-controls
are removed — the new scheme has a fixed one-QR + three-ArUco layout,
and all QRs are id-only (the server resolves the spec from the DB).

## Test lifecycle + ingestion

```
   (new test)                 (first result uploaded)
        │                              │
        ▼                              ▼
    created  ───── upload result ─► tested  ──── delete ─► deleted
                                     ▲  │
                                     │  └── delete → deleted
                                     │
                          (all results excluded/removed
                           leaves status=tested; no demotion)
```

- `created → tested`: the server sets this on the first result write
  (excluded or not).
- `tested → deleted` and `created → deleted`: soft-delete via
  `DELETE /api/tests/{id}`. The row remains indefinitely; excluded from
  list views by default. Results cascade-soft-delete. Palette entries
  **do not** — they're standalone provenance. They're only removed
  explicitly from the Palette tab (existing `DELETE
  /api/palette/by-test/{test_id}` is kept).
- No demotion back to `created`. Physical reality is you burned something.

**Locking:**

- `locked=0` in `created`: full editor. Name, params, grid geometry,
  fiducial knobs all live.
- On first result write the server sets `locked=1`. Subsequent
  `PATCH /api/tests/{id}` that touch any field of `spec_json` return HTTP
  409 Conflict. The UI swaps "Save" for "Duplicate as new test".
- `name` and `notes` stay editable in any state (they aren't part of
  `spec_json`).

**Per-upload ingest flow (server side):**

```
  Client POST /api/tests/{id}/results  (multipart: image)
        │
        ▼
  save bytes to tmp; compute sha256
        │
        ▼
  detect_fiducials(img)  ──► qr_id, aruco corners
        │
        ▼
  verify qr_id == path {id}  (400 on mismatch)
        │
        ▼
  load test.spec_json; warp_to_burn_space
        │
        ▼
  sample_grid(warped, spec) ──► [CaptureSwatch, ...]
        │
        ▼
  move image → ~/.xcs-gen/images/{test_id}/{result_id}.{ext}
  insert results row (image_path, sha256, swatches_json, excluded=0)
  if tests.status == 'created': set 'tested', locked=1
        │
        ▼
  return ResultResponse (id, image_url, swatches, avg_preview)
```

**Averaged swatch computation** (on read):

- `GET /api/tests/{id}/swatches` returns, per cell position, `{row, col,
  x_value, y_value, hex, lab, sigma, sample_count, per_result: [...]}`.
- Per cell: average Lab across non-excluded results (averaging sRGB
  hex is wrong in linear-light terms), convert back to hex; `sigma` =
  pooled stddev; `sample_count` = contributing results.
- If `sample_count == 0` (all excluded or no uploads) the cell is
  flagged unavailable.

**Palette ingest from a test:**

- `POST /api/tests/{id}/ingest-to-palette` with body `{swatch_indices:
  [0, 2, 5], mode: "averaged" | "single_result", result_id?: int}`.
- `mode="averaged"` (default): `source="averaged"`,
  `source_result_id=NULL`, averaged Lab/hex.
- `mode="single_result"`: `source="single_result"`,
  `source_result_id=<id>`, that result's raw Lab/hex.
- Replaces the current `POST /api/capture/ingest` + `POST
  /api/palette/ingest` pair.

**Re-ingest handling:** palette rows stand on their own, so ingesting
from the same test twice produces duplicates by default. The UI detects
existing rows and offers "Replace" (delete existing `palette_entries
WHERE test_id=?`, then insert) or "Add more".

## UI layout

**`Tests` tab** (new, replaces `Param tests`):

```
┌─────────────────────────────────────────────────────────────────────┐
│  TopBar: Tests                                       [ + New test ] │
├─────────────┬───────────────────────────────────────────────────────┤
│  List pane  │  Detail pane                                          │
│  (280 px)   │                                                       │
│             │  ┌── left ──┐  ┌── center ──┐  ┌── right ──────────┐ │
│ Filters:    │  │ editor   │  │ preview    │  │ results panel      │ │
│  Material ▾ │  │          │  │ (new SVG)  │  │ [Upload]           │ │
│  Status  ▾  │  │ Name     │  │            │  │ ─ #3  ⬤            │ │
│             │  │ #42      │  │            │  │ ─ #2  ⬤            │ │
│ ─────────── │  │ locked🔒 │  │            │  │ ─ #1  ☒ excluded   │ │
│             │  │ Material │  │            │  │                    │ │
│ #42 Speed…  │  │ X axis   │  │            │  │ Averaged swatches  │ │
│ #41 Power…  │  │ Y axis   │  │            │  │ (grid of cells)    │ │
│ #40 Freq…   │  │ Layout   │  │            │  │                    │ │
│             │  │ Passes   │  │            │  │ [Ingest to palette]│ │
│             │  │ [Generate .xcs]          │  │                    │ │
│             │  │ [Duplicate as new]       │  │                    │ │
│             │  └──────────┘  └────────────┘  └────────────────────┘ │
└─────────────┴───────────────────────────────────────────────────────┘
```

List pane: `GET /api/tests?material_id=&status=`, default filter
`status != deleted`. Material dropdown reuses the existing
`MaterialSelect` component shape.

Detail pane is client-side-routed: `/tests/{id}`. `/tests/new` creates a
draft; material inherits from the list's filter or the library's active
material. First Save POSTs to `/api/tests` and navigates to the new id.

The preview is the upgraded SVG from the approved mockup: real
proportions, rect/circle cells, wrapped rows with per-row axis labels,
QR + 3 ArUcos drawn to scale. Rendered from `spec_json` only.

Results panel (new `ResultsPanel.tsx`):

- Upload button (`<input type="file" accept="image/*" capture="environment">`)
  → POST `/api/tests/{id}/results` → prepend a new result card.
- Each card: thumbnail, upload timestamp, σ summary, "exclude from
  average" toggle, delete button, notes field.
- Expanding a card shows the warped crop + that result's raw swatches.
- Below the result list: "Averaged swatches" grid. Unavailable cells
  render as a dashed outline.
- Bottom: "Ingest to palette" opens a modal with swatch multi-select +
  mode toggle (averaged vs single-result picker).

**Generate button** moves from TopBar to the Test detail page. TopBar
keeps the validation-banner pattern for the Tests tab. SVG tabs keep
their own top-level Generate unchanged.

**`Library` tab — Materials row update:** each material row grows a
"▸ N tests" disclosure. Expanded, it shows a small table:
`#id · name · status · created_at · ▶` link → navigates to the Test
detail. Dup-detection heuristic deferred.

**`Palette` tab:**

- Upload sub-tab removed — photo ingestion is via Test now.
- Query view unchanged shape; underlying call still `/api/palette/query`.
- Browse view unchanged, with a new "View source test" link per entry
  that jumps to the test detail.

**TopBar:**

- `Tests · SVG stack · SVG layers · Library · Palette`.
- The top-level Generate button disappears (it's per-test now). SVG
  tabs keep their own Generate as today.

## Backend surface

```
# Tests
POST   /api/tests                         create (body: spec_json + name + material_id)
GET    /api/tests                         list   (?material_id=&status=&limit=&offset=)
GET    /api/tests/{id}                    detail
PATCH  /api/tests/{id}                    update (409 if locked and spec touched)
DELETE /api/tests/{id}                    soft delete

# Results
POST   /api/tests/{id}/results            multipart image → detect+warp+sample
GET    /api/tests/{id}/results            list results for test
PATCH  /api/results/{id}                  toggle excluded / notes
DELETE /api/results/{id}                  delete result + image file
GET    /api/results/{id}/image            streams stored image
GET    /api/tests/{id}/swatches           averaged swatch set (computed on read)

# XCS generation (per-test)
POST   /api/tests/{id}/generate           returns .xcs bytes

# Palette — new
POST   /api/tests/{id}/ingest-to-palette  body: {swatch_indices, mode, result_id?}

# Palette — existing, ported to DB
GET    /api/palette
GET    /api/palette/query
DELETE /api/palette/{entry_id}
DELETE /api/palette/by-test/{test_id}
PATCH  /api/palette/{entry_id}            notes

# Library — ported to DB
GET/POST/PATCH/DELETE /api/materials
GET/POST/PATCH/DELETE /api/presets

# Retired
POST   /api/capture/ingest                removed
POST   /api/generate                      removed
POST   /api/palette/ingest                removed
```

## Code structure

**Backend:**

```
src/xcs_gen_web/
  app.py               FastAPI wiring (endpoints thin)
  db.py                SQLAlchemy Core: engine, metadata, session helper
  models.py            Table definitions (5 tables)
  repositories/
    tests.py           CRUD + status transitions + locking
    results.py         persist, list, toggle, avg swatches
    materials.py       CRUD + deletion guard
    presets.py         CRUD + default-per-material invariant
    palette.py         query, list, ingest-from-test, delete, patch
  services/
    capture.py         detect_fiducials + warp + sample
    xcs.py             build XCS bytes from a Test row
  images.py            filesystem helpers (paths, write with sha256, read)
  schemas.py           Pydantic request/response models

alembic/
  env.py
  versions/0001_initial.py      creates all 5 tables
```

`converter.py`, `svg_converter.py`, `svg_layers_converter.py` stay as-is
— the SVG tabs continue to use them.

**Frontend:**

```
web/src/
  api/
    tests.ts           client for tests + results endpoints
    palette.ts         replaces palette-api.ts
    library.ts         materials + presets client
  pages/
    TestsPage.tsx      list + filters
    TestDetailPage.tsx editor + preview + results panel
    LibraryPage.tsx    ported to server
    PalettePage.tsx    Upload removed; Query + Browse remain
    SvgStackPage.tsx   unchanged
    SvgLayersPage.tsx  unchanged
  components/
    ParamTestEditor.tsx   extracted from today's TestEditor.tsx
    TestPreview.tsx       new SVG preview
    ResultsPanel.tsx      upload + results + averaged swatches + ingest
    fields/…              unchanged
  routing.ts              minimal hash-based router
```

`storage.ts` is removed (server-authoritative).

## Testing

| Layer | What | How |
|---|---|---|
| DB | schema migrations, constraints | pytest + in-memory SQLite; `alembic upgrade head` in fixture; assert tables present |
| Repositories | CRUD + invariants (locked, status, deletion guards, default-preset-per-material) | pytest per repository; ephemeral DB |
| Services | `capture.detect_fiducials`, `capture.warp_to_burn_space`, averaged swatches math | pytest with synthetic images; extend current `tests/test_capture_*` |
| API | happy path + key error branches per endpoint | `TestClient(app)` fixtures; one file per resource |
| Frontend | new API clients, preview SVG math | vitest (existing Vite setup); snapshot test the preview SVG |
| Manual E2E | QR+ArUco decode from phone photo; warp alignment | `RESUME_VALIDATION.txt`-style flow, updated for the new scheme |

## Dependencies

- `sqlalchemy >= 2.0` (Core only)
- `alembic`
- `opencv-contrib-python-headless` — swap for the existing
  `opencv-python-headless`, which lacks `cv2.aruco`.

## Performance

Single-user desktop tool. Expected scale: single-digit GB of result
images, hundreds of tests, thousands of palette entries. SQLite is
over-specced. Indexes on `tests.material_id`, `tests.status`,
`results.test_id`, `palette_entries.material_id` cover the only hot
queries.

## Open questions (deferred)

- Duplicate-test detection on the Materials page. A meaningful heuristic
  needs parameter-space clustering rules that depend on how the user
  actually works; revisit after some real usage data exists.
- Multi-device / multi-user. Today's design assumes one backend, one
  user. Auth + per-user scoping would layer in cleanly on top because
  material/test ownership is already centralised in the DB.
