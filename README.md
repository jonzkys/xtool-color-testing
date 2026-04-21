# xcs-gen - XTool Creative Space File Generator

Programmatic generation of `.xcs` files for XTool laser cutters (XTool Creative Space / XCS Studio).

## Why

XCS Studio doesn't support generating test grids - hundreds of small shapes with systematically varying parameters (speed, power, frequency, etc.). Manually creating these is impractical. This tool generates `.xcs` files directly, enabling:

- **Parameter test grids**: Vary one parameter (e.g. speed) across the X axis and another (e.g. power) across the Y axis
- **Gradient sweeps**: Generate 100s of vertical lines/rects with incrementally different settings
- **Repeatable test files**: Script your test patterns instead of clicking through the UI

## XCS File Format (Reverse-Engineered)

The `.xcs` format is **uncompressed JSON** with the following structure:

```
Root
+-- canvasId          (UUID)
+-- canvas[]          (array of panels/workspaces)
|   +-- id            (matches canvasId)
|   +-- layerData     (color-keyed layers, e.g. "#00befe")
|   +-- displays[]    (geometry objects)
|       +-- id        (UUID, links to device processing data)
|       +-- type      ("RECT", likely also "LINE", "ELLIPSE", "PATH", etc.)
|       +-- x, y      (position in mm)
|       +-- width, height (dimensions in mm)
|       +-- layerTag  (color key linking to layerData)
|       +-- fill, stroke (visual properties)
+-- extId, extName    (device model, e.g. "F2 Ultra")
+-- device
|   +-- data          (Map keyed by canvasId -> displayId)
|       +-- mode      ("LASER_PLANE", etc.)
|       +-- displays  (Map of display UUID -> processing config)
|           +-- processingType  ("COLOR_FILL_ENGRAVE", "VECTOR_CUTTING", etc.)
|           +-- data   (all processing type configs with parameters)
+-- cover             (base64 PNG thumbnail)
+-- version, meta, etc.
```

### Key Processing Parameters (per element)

| Parameter | Field | Notes |
|-----------|-------|-------|
| Power (%) | `power` | Laser power percentage |
| Speed (mm/s) | `speed` | Movement speed |
| Passes | `repeat` | Number of repeat passes |
| Lines per cm | `density` | Engrave line density |
| Pulse Width | `pulseWidth` | For MOPA lasers |
| MOPA Frequency | `mopaFrequency` | MOPA frequency setting |
| DPI | `dpi` | Dots per inch for fill engraving |

### Processing Types

- `COLOR_FILL_ENGRAVE` - Filled engraving (raster)
- `VECTOR_ENGRAVING` - Vector outline engraving
- `FILL_VECTOR_ENGRAVING` - Combined fill + vector
- `VECTOR_CUTTING` - Cut through material
- `INTAGLIO` - 3D/depth engraving

## Installation

```bash
pip install -e .
```

## Usage

```bash
# Generate a speed test grid (placeholder - API will evolve)
xcs-gen --param speed --min 100 --max 5000 --steps 50 --output speed_test.xcs
```

## Project Status

**Active development.** The core generation pipeline is stable; tests are persisted in SQLite and a photo-ingest loop populates a searchable per-material colour palette.

## Device Compatibility

Currently tested with **XTool F2 Ultra** (`GS004-CLASS-4`). Device IDs and power configurations may differ for other models.

## Web UI

A browser-based UI for designing param tests, generating their `.xcs` files, uploading photos of the burned result, and building a colour-to-parameter palette per material.

### Data stores

The server persists everything locally:

- **SQLite database** at `~/.xcs-gen/app.db` (override with `XCS_GEN_DB_URL`). Alembic migrations run on startup — no manual upgrade step.
- **Result images** at `~/.xcs-gen/images/<test_id>/<result_id>.<ext>` (override with `XCS_GEN_IMAGES_DIR`).

Data flow:

1. **Library**: register materials and preset parameter sets.
2. **Tests**: create a test bound to a material. Edit until you're happy, then click *Generate .xcs* to download the file and burn it.
3. **Results**: upload a photo of the burn back to the same test. The server locates the fiducials (id-only QR top-left + 3 ArUco corners), warps the image to burn-space, and samples each cell for a Lab/ΔE swatch.
4. **Palette**: pick swatches (averaged across results or pulled from one specific upload) and ingest them into the material palette. The Palette tab supports hex → nearest-match queries.

### First-time setup

```bash
cd web
npm install
npm run build
cd ..
```

### Run

```bash
xcs-gen serve
```

This launches a local server at http://localhost:4000 and opens it in your default browser.

Options:
- `--port N` — change the port (default 4000)
- `--host HOST` — change the bind host (default 127.0.0.1)
- `--no-browser` — don't open the browser automatically

Environment overrides (useful for dev and multi-user setups):
- `XCS_GEN_DB_URL` — SQLAlchemy URL; defaults to `sqlite:///~/.xcs-gen/app.db`
- `XCS_GEN_IMAGES_DIR` — directory for uploaded result images

### Development

For frontend development with hot reload:

```bash
# Terminal 1: run the API
xcs-gen serve --no-browser

# Terminal 2: run Vite dev server (proxies /api/* to the backend)
cd web
npm run dev
```

Then open the URL printed by Vite (usually http://localhost:5173).

## License

MIT
