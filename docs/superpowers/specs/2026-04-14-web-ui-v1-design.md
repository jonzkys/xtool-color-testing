# XCS Gen Web UI v1 Design

## Goal

A locally-run web UI for building XCS files composed of one or more "param tests" (gradient bands varying a chosen laser parameter). Replaces the CLI for the primary workflow, keeps the existing Python library untouched.

## Audience

Single user, local-only. No authentication, no hosting, runs on the user's own machine via `xcs-gen serve`.

## Architecture

```
┌──────────────────────┐         ┌──────────────────────┐
│   React frontend     │◄───────►│   FastAPI backend    │
│   (Vite + TS)        │  JSON   │   (Python, uvicorn)  │
└──────────────────────┘         └──────────┬───────────┘
                                            │
                                            ▼
                                  ┌──────────────────────┐
                                  │   xcs_gen library    │
                                  │   (existing code)    │
                                  └──────────────────────┘
```

- **Backend**: FastAPI app that imports the existing `xcs_gen` library. One API endpoint (`POST /api/generate`) plus static serving for the built frontend.
- **Frontend**: React + Vite + TypeScript SPA. Calls the backend to generate; otherwise all state is local.
- **Storage**: Browser localStorage holds the current project JSON. No server-side persistence.
- **Launch**: New `xcs-gen serve` CLI subcommand starts uvicorn and opens the browser automatically.

## Directory Layout

Added alongside existing code, nothing moves:

```
src/xcs_gen/          (existing - unchanged)
src/xcs_gen_web/      (new - FastAPI app)
web/                  (new - React frontend)
```

## Data Model

Stored in localStorage, posted to the API, and the authoritative input to the generator.

```typescript
interface ParamTest {
  id: string;                    // uuid for UI tracking
  name: string;                  // user-editable label
  x_param: string;               // "speed" | "power" | "frequency" | "density" | "passes" | "pulse_width"
  x_min: number;
  x_max: number;
  x_steps: number;
  y_param?: string;              // null/undefined = single axis mode
  y_min?: number;
  y_max?: number;
  y_steps?: number;
  rows: number;                  // row-wrap for single axis
  width_mm: number;
  height_mm: number;
  gap_mm: number;
  base_params: {
    power: number;
    speed: number;
    frequency: number;
    density: number;
    passes: number;
    pulse_width: number;
    laser: "red" | "blue";
  };
}

interface TestPlacement {
  test: ParamTest;
  row: number;                   // grid row (0-indexed)
  col: number;                   // grid col (0-indexed)
  col_span: number;              // grid cols (default 1, use 2+ for full-width)
}

interface Project {
  name: string;
  grid_gap_mm: number;           // gap between placed tests in the composition
  tests: TestPlacement[];
}
```

Backend Pydantic models in `src/xcs_gen_web/schemas.py` mirror these TS types exactly.

## Grid Composition

CSS-grid-like: each test declares row/col/col_span. The backend computes absolute positions by:
1. Determining column widths from the widest test in each column.
2. Determining row heights from the tallest test in each row.
3. Adding `grid_gap_mm` between cells.
4. Offsetting each test's generation by its computed (x, y).

Validation rejects overlapping placements (two tests in the same cell with incompatible col_spans).

## API

Single endpoint:

**`POST /api/generate`**
- Request body: `Project` JSON
- Response: `.xcs` file, `Content-Type: application/json`, `Content-Disposition: attachment; filename="<project.name>.xcs"`
- 400 on invalid config with a descriptive error message

Plus static serving: FastAPI mounts `web/dist/` at `/` for everything except `/api/*`.

## UI Layout

Three-panel layout:

```
┌─────────────────────────────────────────────────────────────────────┐
│  xcs-gen                                 [Generate .xcs] [⚙]        │
├──────────────────┬──────────────────────────┬───────────────────────┤
│                  │                          │                       │
│  Project tests   │                          │                       │
│  ├─ Speed test   │                          │                       │
│  ├─ Freq test    │    Editor for            │    Live SVG Preview   │
│  └─ Power test   │    selected test         │    (shape only, to    │
│                  │                          │     scale)            │
│  [+ Add test]    │    All parameters,       │                       │
│                  │    grid position,        │                       │
│                  │    validation warnings   │                       │
│                  │                          │                       │
│  Global settings │                          │                       │
│  - Project name  │                          │                       │
│  - Grid gap      │                          │                       │
│                  │                          │                       │
└──────────────────┴──────────────────────────┴───────────────────────┘
```

- **Left sidebar**: List of tests (click to select/edit, drag to reorder within grid via row/col, delete via context menu). "+ Add test" button below. Project-level settings (name, grid gap) at the bottom.
- **Middle panel**: Form for the currently selected test. Fields for name, x-param (dropdown + min/max/steps), optional y-param, layout (width/height/gap/rows), base params (all fixed values), grid placement (row/col/col_span). Inline validation warnings appear below the relevant field.
- **Right panel**: SVG preview of the whole project at scale. Rectangles represent each test's band/grid, color-coded per test (distinct colors from a palette). No gradient values rendered - shape only. Axis label positions indicated by small tick marks as placeholders. Tests with beam-width violations get a red outline.
- **Top bar**: Project name (editable inline). Generate button (disabled if zero tests or any validation error). Optional settings icon for preferences.

## Frontend File Structure

```
web/
├─ package.json          # React 18, Vite, TypeScript
├─ vite.config.ts
├─ index.html
└─ src/
   ├─ main.tsx
   ├─ App.tsx            # Three-panel shell
   ├─ types.ts           # Project, ParamTest, TestPlacement
   ├─ storage.ts         # load/save to localStorage
   ├─ generate.ts        # POST /api/generate + trigger download
   ├─ validation.ts      # Project/test validation rules
   ├─ defaults.ts        # New-test defaults based on current project
   ├─ components/
   │  ├─ TestList.tsx
   │  ├─ TestEditor.tsx
   │  ├─ Preview.tsx
   │  ├─ fields/         # Small reusable form fields
   │  │  ├─ NumberField.tsx
   │  │  ├─ SelectField.tsx
   │  │  └─ WarningBanner.tsx
   │  └─ TopBar.tsx
   └─ index.css
```

## Backend File Structure

```
src/xcs_gen_web/
├─ __init__.py
├─ app.py              # FastAPI app, static mount, /api/generate route
├─ schemas.py          # Pydantic models (Project, ParamTest, TestPlacement)
└─ converter.py        # Project → XCSProject → .xcs bytes
```

`converter.py`:
- Validates the Project (overlap detection, param name validation, etc.).
- For each test, calls the existing `generate_gradient()` with the right offset (`start_x`, `start_y`).
- Combines all resulting `XCSProject` instances into one (merging elements, extra_displays, extra_device_entries under a shared canvas_id).
- Returns the JSON-serialized .xcs bytes.

## CLI Integration

New subcommand added to the existing `xcs-gen` entry point:

```
xcs-gen serve [--port 8000] [--host 127.0.0.1] [--no-browser]
```

Behavior:
1. Check `web/dist/index.html` exists. If not, print an error pointing to build instructions.
2. Start uvicorn serving the FastAPI app from `src/xcs_gen_web/app.py`.
3. Unless `--no-browser`, open the URL in the user's default browser (Python `webbrowser` module).

## Build Workflow

Since the user is building this for themselves, the React bundle is built locally, not committed:

1. One-time setup: `cd web && npm install && npm run build`
2. Run: `xcs-gen serve`

README gets a "Web UI" section explaining these steps. `web/dist/` goes in `.gitignore`.

For dev iteration on the frontend, `npm run dev` in `web/` starts Vite's dev server with HMR, configured to proxy `/api/*` to the backend.

## Validation Rules

Runs on both frontend (for live feedback) and backend (for safety):

- Param name in known set: `speed`, `power`, `frequency`, `density`, `passes`, `pulse_width`, `dpi`.
- `x_steps >= 2`, `y_steps >= 2` if `y_param` is set.
- `x_min != x_max` (same for y).
- `width_mm > 0`, `height_mm > 0`, `rows >= 1`.
- Per-element width must be >= beam spot (0.03mm default). Smaller → warning, not rejection.
- No two placements share the same `(row, col)` unless their `col_span` ranges don't overlap.
- Backend rejects with 400 on any hard-fail validation. Frontend surfaces soft warnings inline.

## Dependencies

### Python (added to pyproject.toml)

- `fastapi` - the web framework
- `uvicorn[standard]` - ASGI server
- `pydantic` - already a FastAPI dependency, used for schemas

### Frontend (in web/package.json)

- `react`, `react-dom`
- `vite`, `@vitejs/plugin-react`
- `typescript`, `@types/react`, `@types/react-dom`

No UI component libraries - styling done with plain CSS for simplicity and full control. A few dozen lines of CSS is enough for a tool like this.

## Testing

**Backend** (pytest, alongside existing tests):
- `tests/test_converter.py`: Given a Project with 1, 2, N tests in various grid positions, verify output element counts, positions, and processing params.
- `tests/test_api.py`: Use FastAPI's `TestClient` to exercise `POST /api/generate` with valid and invalid inputs.

**Frontend** (vitest, minimal):
- `web/src/validation.test.ts`: Validation rule coverage.
- `web/src/storage.test.ts`: localStorage round-trip with a mocked Storage.

No component tests for v1 - visual iteration will catch UI issues faster than unit tests.

## Edge Cases

- **Empty project (no tests)**: Generate button disabled with tooltip.
- **localStorage unavailable/full**: Fall back to in-memory state, show a one-time banner. State is lost on reload.
- **Zero-dimension test**: Rejected by validation.
- **Image-to-laser feature**: Not in scope for v1. A future v2 can add an "Image source" tab alongside "Gradient source".
- **Saving/loading named projects**: Explicitly out of scope for v1. LocalStorage holds exactly one project.

## Out of Scope (v1)

- Image-to-laser workflow (existing CLI-only feature remains).
- Named/saved projects with load/delete UI.
- Exporting intermediate formats (SVG, PNG preview).
- Undo/redo.
- Multiple users, authentication, remote hosting.
- Drag-to-reposition in the preview (position is specified via the grid row/col fields only).

## Success Criteria

- `xcs-gen serve` opens a browser, the UI loads, configures a simple single-axis speed test, clicks Generate, downloads an .xcs that opens correctly in XCS Studio.
- Multi-test composition: three param tests arranged in a grid generate a single .xcs with all three bands laid out correctly relative to each other.
- Live preview updates as values change, with validation warnings appearing inline.
- Closing the browser and reopening restores the last project state.
