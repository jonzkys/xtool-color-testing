# CLAUDE.md

Tribal knowledge for working on `xcs-gen`. Read once, then work from code.

## What this is
Programmatic generator for xTool `.xcs` laser-cutter projects. Python/FastAPI
backend exposes a small REST API over SQLite; React/Vite SPA lives in `web/`
and is served statically by the backend in production.

## Run / build / test
```bash
# Backend dev server — ALWAYS use --active (see gotchas below)
uv run --active xcs-gen serve --host 127.0.0.1 --port 8017

# Backend tests
uv run --active pytest tests/ -q

# Frontend: build into web/dist/ (the backend serves this directory)
cd web && npm run build

# Frontend typecheck + unit tests
cd web && npx tsc --noEmit && npm test

# DB migrations (SQLite at ~/.xcs-gen/app.db by default)
uv run --active alembic upgrade head
```

## Gotchas (the "you'll regret skipping this" list)

- **`uv run` without `--active` picks the wrong venv on this machine** and
  fails with `ModuleNotFoundError: xcs_gen`. Always `uv run --active ...`.
- **`web/dist/` is served directly; the Vite dev server is not wired up.**
  After any `web/src/**` change, run `cd web && npm run build` or you'll
  test stale code. Quiet rebuild: `> /dev/null 2>&1`.
- **Alembic has a hardcoded revision assertion in CI.** When you add
  `alembic/versions/NNNN_*.py`, update the `test "$VER" = "NNNN"` line
  in `.github/workflows/ci.yml::mysql-migration-test` in the same
  commit — otherwise CI fails on a green migration.
- **iOS Safari `<input type="file" capture="environment">` hides the
  photo library.** Omit `capture` if you want the native picker that
  offers both camera and gallery.
- **Pydantic validators snap legacy values rather than rejecting.**
  E.g. `pulse_width` outside the allowed preset list is snapped to the
  nearest legal value instead of 422'ing, so old rows keep loading.
  Respect this pattern for any new constrained field on user data.
- **DB auto-migrates on startup** (`XCS_GEN_AUTO_MIGRATE=true` by default).
  Don't alter `~/.xcs-gen/app.db` by hand while the server is running.

## The UI is a first-class feature
This isn't a CLI with a webapp bolted on — the workbench is how users
actually drive the tool. Treat UI polish as product work, not decoration.

- Design system: Tailwind v4 + Radix UI + CVA primitives in
  `web/src/ui/`. The aesthetic is "Workshop Instrument" / blueprint-
  poster: JetBrains Mono for numerics and labels, Inter for prose,
  metallic-bar accents, diagonal warp textures, monospaced tracking.
- **When designing new pages, panels, or significant visual features,
  use the `frontend-design` agent** — it consistently produces
  outputs that match the design language. The Loom page, Spectrum
  pages, and Guide were all shaped with it.
- **Test UI in a real browser before saying "done".** TypeScript and
  vitest verify correctness, not feature behaviour. The Playwright MCP
  tooling is set up — use it for golden-path walkthroughs and
  regression checks on adjacent pages.

## Environment variables (prefix: `XCS_GEN_`)
- `XCS_GEN_MODE` — `standalone` (default) or `multi_user`
- `XCS_GEN_DB_URL` — override SQLite; use `mysql+pymysql://...` for MySQL
- `XCS_GEN_IMAGES_DIR` — where uploaded photos land (local FS)
- `XCS_GEN_S3_BUCKET` + friends — enable S3 image storage (IAM-auth only)
- `XCSGEN_LOG` — `WARNING` to quiet the dev server

## Don't do
- **Don't write migrations by hand.** Use `alembic revision --autogenerate`
  and review the diff — the SQLAlchemy models in `src/xcs_gen_web/models.py`
  are the source of truth.
- **Don't commit `.xcs` files outside `samples/`.** They're gitignored
  elsewhere for a reason (generated output).
- **Don't add backwards-compat shims for renamed routes/fields unless
  the code is already in users' hands.** Route rename + test update is
  the norm; see the `svg-stack` → `loom` rename for the pattern.
- **Don't skip hooks (`--no-verify`)** — pre-commit checks catch real
  issues here (schema drift, unused imports).

## What lives where (high-level)
- `src/xcs_gen/` — pure library: model, SVG parsing, hatch/fill generation,
  `.xcs` serialisation. No HTTP, no DB.
- `src/xcs_gen_web/` — FastAPI app, SQLAlchemy models, repositories,
  services. This is what `xcs-gen serve` runs.
- `web/src/` — React SPA. Hash-routed via `router.ts`. Pages in `pages/`,
  shared UI primitives in `ui/`, feature components in `components/`.
- `tests/` — pytest; `web/src/**/*.test.ts` — vitest.
- `samples/` — reference `.xcs` + source images used by round-trip tests.
