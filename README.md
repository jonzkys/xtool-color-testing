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
- `XCS_GEN_MODE` — `standalone` (default) or `multi_user`
- `XCS_GEN_CORS_ORIGINS` — comma-separated allowed origins when the API is hosted separately from the frontend
- `XCS_GEN_AUTO_MIGRATE` — `true`/`false`; in production set to `false` and run `alembic upgrade head` as a deploy step
- `XCS_GEN_MAX_UPLOAD_BYTES` — cap on request body size (default 20 MiB)
- `XCS_GEN_REGISTER_RATE_PER_HOUR` — per-IP registration rate limit (default 20; set 0 to disable)
- `XCS_GEN_S3_BUCKET` — activate S3 image storage (see section below)
- `XCS_GEN_S3_PREFIX` — key prefix / namespace inside the bucket
- `XCS_GEN_S3_REGION` — region override (boto3 resolves from env if unset)
- `XCS_GEN_S3_ENDPOINT_URL` — custom endpoint URL for MinIO / LocalStack

### MySQL / MariaDB

SQLite is the default and covers the single-user workflow fine. For a public alpha you'll want MySQL or MariaDB:

```bash
pip install -e ".[mysql]"
export XCS_GEN_MODE=multi_user
export XCS_GEN_DB_URL="mysql+pymysql://xcsgen_user:PASSWORD@db-host/xcsgen?charset=utf8mb4"
export XCS_GEN_AUTO_MIGRATE=false
alembic upgrade head                # run migrations as a deploy step
xcs-gen serve
```

The `?charset=utf8mb4` suffix is important — without it non-ASCII material/test names can be silently corrupted on older MySQL configs. The app logs a warning at startup if it's missing.

The DB user only needs: `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP` on the `xcsgen` schema (the last two are only needed while migrations are running — you can drop them after). No `GRANT` or `SUPER`.

### S3 image storage (optional)

Filesystem storage (the default, `~/.xcs-gen/images/…`) works fine for single-host deployments. For multi-host or autoscaling setups, swap in S3:

```bash
pip install -e ".[s3]"
export XCS_GEN_S3_BUCKET=xcsgen-prod-uploads
export XCS_GEN_S3_PREFIX=images                # optional key namespace
export XCS_GEN_S3_REGION=us-east-1             # optional; boto3 resolves from env if unset
xcs-gen serve
```

Credentials come from boto3's default chain — **IAM role / ECS task role / Lambda exec role / environment / ~/.aws**. The app holds no long-lived keys; never put AWS secrets in these env vars.

The execution role needs only:

| Action | Resource |
|---|---|
| `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` | `arn:aws:s3:::BUCKET/PREFIX/*` |
| `s3:ListBucket` (optional — not used at runtime) | `arn:aws:s3:::BUCKET` |

Nothing bucket-wide, nothing `s3:*`.

Every uploaded object is written with `ServerSideEncryption=AES256` even if the bucket default isn't configured. Reads and deletes enforce bucket-confinement — a row poisoned to reference a different bucket is rejected at the backend before any API call is made.

Images are **served through the app** via `/api/results/{id}/image`, never via presigned URLs, so the ownership check applies. The bucket should stay **private** with no public-read policy.

Mixed-mode is supported: if you migrate from filesystem to S3, old rows with filesystem paths keep reading from disk while new uploads go to S3. No backfill migration needed unless you want to move old files.

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
