# Demo account — read-only showcase access

Status: Draft — 2026-04-24
Scope: backend (FastAPI) + frontend (React). No DB/schema changes.

## Motivation

Prospective users want to poke at the app before registering. The current
gate (claim a workbench or paste an existing key) is a dead-stop for
anyone who hasn't decided yet. A demo account — read-only access to a
curated real account's data — lets visitors explore every page without
touching the DB.

## Features

### 1. Demo API key

Static header value `X-User-Id: DEMO` (default; overridable via
`XCS_GEN_DEMO_API_KEY`) is recognised by the backend as the demo
identity. The auth layer returns `settings.demo_target_user_id` (default
1, overridable via `XCS_GEN_DEMO_TARGET_USER_ID`) as the resolved
`owner_id`. No row is added to the `users` table — the demo is a virtual
user.

### 2. Write-block middleware

A new `DemoReadOnlyMiddleware` runs early in the request pipeline.
On every request it inspects the `X-User-Id` header directly. If the
value matches `settings.demo_api_key` (non-empty) and the request
method is `POST`, `PUT`, `PATCH`, or `DELETE`, the `(method, path)`
tuple is compared against a hardcoded allowlist:

```python
DEMO_SAFE_WRITES = {
    ("POST", "/api/svg-layers"),
    ("POST", "/api/svg-preview"),
    ("POST", "/api/results/preflight"),
}
```

On miss → `403 {"detail": "demo account is read-only"}`. On hit, or
for any GET/HEAD/OPTIONS request, the handler runs normally. Setting
`demo_api_key` to an empty string disables the middleware entirely for
deployments that don't want the demo feature.

### 3. Frontend demo mode

When `localStorage["xcsgen:userId"] === "DEMO"`:

- A sticky `DemoBanner` renders above `TopBar` on every authenticated
  page (`App.tsx`).
- All UI controls that trigger non-allowlisted mutations render
  disabled via the `DemoLock` wrapper — button stays visible, gets
  `disabled` / `aria-disabled` / `title` / `cursor-not-allowed`.
- Photo-upload file inputs (`ResultsPanel`, `MobileUploadPage`) are
  locked — clicks are intercepted and show an inline message instead
  of opening the file picker.
- The SVG Layers page is **unaffected** — all its API calls hit the
  allowlist. Auto-match, merge similar, generate `.xcs` all work.

### 4. Entry & exit flows

- **Entry:** navigate to `#/demo` → the router calls `enterDemo()`
  (saves existing key, if any, to `xcsgen:userId:prev`; writes `"DEMO"`
  into `xcsgen:userId`) → navigates to `#/tests`.
- **WelcomeDialog CTA:** "Just browsing? Try the demo account →" row
  near the bottom of the dialog. Clicking it is equivalent to
  navigating to `#/demo`.
- **Exit:** banner's "Exit demo →" button (plus the whole-banner
  clickable affordance) calls `exitDemo()` (restores `:prev` if
  present, otherwise removes the key) → navigates to `#/tests`. If a
  real key was restored, the user lands in their own account; if not,
  the WelcomeDialog appears as normal.

## Non-goals

- No `users` row for demo. No DB migration.
- No curated demo data seeding — deployment owner is responsible.
- No analytics / demo-specific telemetry.
- No rate limiting specific to the demo key.
- No multi-tenant demo (one target account per deployment).
- No auto-exit after idle. Refreshing the page stays in demo until
  explicit exit.
- No write-simulation ("pretend the delete worked in-browser"). The
  UI is locked, period.
- No pre-filled `WelcomeDialog` for demo-exited users.

## Architecture

### Backend: identification + enforcement split

**Identification** lives in `deps.py`:

```python
def get_current_user(request: Request) -> int:
    settings = request.app.state.settings
    if settings.mode == "standalone":
        return settings.standalone_user_id
    raw = request.headers.get(settings.user_header, "").strip()
    if not raw:
        raise HTTPException(401, "missing header")
    # NEW: recognise the demo key before the DB lookup.
    if settings.demo_api_key and raw == settings.demo_api_key:
        return int(settings.demo_target_user_id)
    if not u_repo.is_valid_api_key(raw):
        raise HTTPException(401, "malformed api key")
    user = u_repo.get_by_api_key(raw)
    if user is None:
        raise HTTPException(401, "api key not registered")
    u_repo.touch_last_seen(user["id"])
    return int(user["id"])
```

**Enforcement** lives in a new `demo.py`:

```python
DEMO_SAFE_WRITES: frozenset[tuple[str, str]] = frozenset({
    ("POST", "/api/svg-layers"),
    ("POST", "/api/svg-preview"),
    ("POST", "/api/results/preflight"),
})

WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

class DemoReadOnlyMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, demo_api_key: str, user_header: str) -> None:
        super().__init__(app)
        self._key = demo_api_key
        self._header = user_header

    async def dispatch(self, request: Request, call_next):
        if self._key and request.method in WRITE_METHODS:
            if request.headers.get(self._header, "").strip() == self._key:
                route = (request.method, request.url.path)
                if route not in DEMO_SAFE_WRITES:
                    return JSONResponse(
                        {"detail": "demo account is read-only"},
                        status_code=403,
                    )
        return await call_next(request)
```

Wired in `create_app` just after CORS:

```python
if settings.mode != "standalone" and settings.demo_api_key:
    app.add_middleware(
        DemoReadOnlyMiddleware,
        demo_api_key=settings.demo_api_key,
        user_header=settings.user_header,
    )
```

### Frontend: single source of truth + tiny wrappers

All demo-aware behaviour reads from one place: `localStorage.xcsgen:userId`.

```ts
// web/src/api/userHeader.ts (additions)
const PREV_KEY = "xcsgen:userId:prev";

export function isDemoUser(): boolean {
  return getCurrentUserId() === "DEMO";
}

export function enterDemo(): void {
  const current = localStorage.getItem(STORAGE_KEY);
  if (current && current !== "DEMO") {
    localStorage.setItem(PREV_KEY, current);
  }
  localStorage.setItem(STORAGE_KEY, "DEMO");
}

export function exitDemo(): void {
  const prev = localStorage.getItem(PREV_KEY);
  if (prev) {
    localStorage.setItem(STORAGE_KEY, prev);
    localStorage.removeItem(PREV_KEY);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}
```

```ts
// web/src/hooks/useIsDemo.ts
export function useIsDemo(): boolean {
  const [v, setV] = useState(isDemoUser);
  useEffect(() => {
    const handler = () => setV(isDemoUser());
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  return v;
}
```

```tsx
// web/src/ui/DemoLock.tsx
export function DemoLock({
  children,
  label = "Not available in the demo account",
}: {
  children: React.ReactElement;
  label?: string;
}) {
  const isDemo = useIsDemo();
  if (!isDemo) return children;
  return (
    <span className="cursor-not-allowed" title={label}>
      {React.cloneElement(children, {
        disabled: true,
        "aria-disabled": true,
        title: label,
      })}
    </span>
  );
}
```

## UI

### Top banner (DemoBanner)

- Mount point: `App.tsx`, conditionally above `<TopBar>` when
  `useIsDemo()`.
- Height 40px, full width, `sticky top-0 z-40`.
- Background: `--color-warning-tint` with a 6% opacity inline-SVG
  diagonal-stripe pattern (same "roped off" motif as the palette
  modal's grain overlay, different angle).
- Icon: lucide `Eye`.
- Copy: "Demo mode — exploring a read-only showcase account. Every
  change is locked." in `text-[12.5px]` on the warning foreground
  token.
- CTA: ghost-variant `<Button>` labelled "Exit demo →". Clicking
  calls `exitDemo()` then `navigate("tests")`.
- Whole-banner clickable affordance (`role="button"`, keyboard
  Enter/Space handler) mirrors the CTA action.
- Animation: 160 ms `translateY(-100%) → 0` slide-in on mount. No
  exit animation — demo exit is decisive.

### WelcomeDialog CTA

A bottom section added to `WelcomeDialog.tsx` after the existing
"Claim a workbench" / "Paste an existing key" panes:

```
─── or ───

Just browsing? Try the demo account →
Read-only access to a pre-filled workbench.
```

- Divider: `MetalBar` variant="soft" with a centred pill reading
  "or" in mono caps.
- Ghost-variant `<Button>` with trailing arrow, takes the user to
  `#/demo`.
- Subtitle line in `text-[11px]` `--color-ink-subtle`.

### Disabled-button coverage (DemoLock application)

The checklist from the design section, mechanically:

| Component | Controls to lock |
| --- | --- |
| `LibraryPage` | Add material, edit material, delete material, add preset, edit preset, delete preset, set-as-default |
| `TestsPage` | "New test" CTA, per-row delete |
| `TestDetailPage` | Save-test edits, regenerate+save XCS, any POST/PATCH handler |
| `ResultsPanel` | Upload photo, delete result, exclude toggle, ingest-to-palette |
| `PalettePage` | Patch palette entry, delete entry |
| `LoomPage` | Generate+save if it writes; leave alone if pure generator (verify at implementation) |
| `SvgLayersPage` | **Nothing.** All its writes are allowlisted. |
| `UploadResultDialog` | Submit button (photo upload), "Generate mobile QR" button, "Rotate QR" button |
| `MaterialPresetPicker` | Whatever CTAs it exposes that hit write endpoints |
| Photo-upload `<input type="file">` (`ResultsPanel`, `MobileUploadPage`) | Click interception + inline "not available" message |

### Routing

In `web/src/router.ts`, add `"demo"` as a recognised route name. When
`parseRoute(hash)` encounters `#/demo`:

```ts
{ name: "demo" }
```

In `App.tsx`, handling:

```tsx
useEffect(() => {
  if (route.name === "demo") {
    enterDemo();
    navigate("tests");
  }
}, [route.name]);
```

(Rendered as nothing while the effect fires — the navigate takes over
synchronously on the next render.)

## Edge cases

| Case | Behaviour |
| --- | --- |
| Enter demo, close tab, reopen | Still in demo — `"DEMO"` persists in localStorage. `:prev` (if any) also persists until explicit exit. |
| Enter demo twice in a row | Second `enterDemo()` is a no-op on `:prev` because `current === "DEMO"`. Safe. |
| Demo session opened in two tabs, exit in tab A | Tab B's `useIsDemo` hook fires its `storage` listener, re-reads `isDemoUser() === false`, re-renders without the banner. If `:prev` was restored, tab B is now authed as that user mid-session; in-flight API calls in tab B finish with whatever header was current at request time — acceptable. |
| Previous real key was revoked server-side | On exit, restore succeeds client-side, but the first API call in the restored session returns 401 — the existing `WelcomeDialog` gate handles it (shows dialog asking to paste or claim). |
| Demo user calls `/api/users/register` | Public, un-authed endpoint — demo middleware doesn't inspect it (header may not even be present). Register succeeds, a new real key is returned. Frontend stores it via `setCurrentUserId(newKey)`, overwriting `"DEMO"`. `:prev` is left behind and becomes stale (harmless — overwritten on next `enterDemo`). |
| Demo user somehow sends a non-allowlisted POST from devtools | Middleware 403s before the handler runs. No data mutated. |
| Demo key set to empty string in deployment | Middleware short-circuits via `if self._key` — every request bypasses the check. Demo is fully disabled. |
| `demo_target_user_id` points at a non-existent user | `get_current_user` returns the id; repositories return empty lists / 404s. UI shows empty state. Not a security issue, just a misconfiguration. |
| SVG Layers demo user generates a `.xcs` larger than the body-size limiter allows | `MaxBodySizeMiddleware` handles it normally (same as any user). Demo middleware doesn't interact. |

## Testing

**Backend tests** (`tests/test_demo.py`):

- Demo-key GET returns 200 with target user's data.
- Demo-key POST to `/api/svg-layers` (allowlisted) returns 200.
- Demo-key POST to `/api/tests` (non-allowlisted) returns 403 with body
  `{"detail": "demo account is read-only"}`.
- Demo-key DELETE to `/api/results/{id}` returns 403.
- Real-key POST to `/api/tests` unaffected (still 200).
- `demo_api_key=""` disables middleware: demo-key POST to `/api/tests`
  returns 401 (unregistered key, same as any garbage header value).
- `demo_target_user_id=0` + demo-key GET returns whatever `owner_id=0`
  would return (usually empty) — asserts the config knob is wired up.
- `standalone` mode — demo middleware is not even registered; demo key
  works like any value in standalone (which ignores the header).

**Frontend tests**: no new unit tests. The existing Vitest suites for
`mergeColors`, `math`, `router`, and `TestPreview` stay green. The
demo-aware logic is thin (storage read + boolean → UI branch) and would
require introducing a React component test harness just for it — YAGNI.
Manual QA covers the entry/exit flow and a spot-check of disabled
controls per page.

## File change summary

**New (5):**
- `src/xcs_gen_web/demo.py` (~40 LOC)
- `tests/test_demo.py` (~80 LOC)
- `web/src/hooks/useIsDemo.ts` (~20 LOC)
- `web/src/ui/DemoLock.tsx` (~25 LOC)
- `web/src/components/DemoBanner.tsx` (~50 LOC)

**Modified (12+):**
- `src/xcs_gen_web/config.py` (+4 LOC)
- `src/xcs_gen_web/deps.py` (+6 LOC)
- `src/xcs_gen_web/app.py` (+3 LOC)
- `web/src/api/userHeader.ts` (+30 LOC)
- `web/src/router.ts` (+10 LOC)
- `web/src/App.tsx` (+6 LOC)
- `web/src/ui/index.ts` (+1 LOC: export DemoLock)
- `web/src/components/WelcomeDialog.tsx` (+15 LOC)
- Per-component DemoLock wrappings: `LibraryPage`, `TestsPage`,
  `TestDetailPage`, `ResultsPanel`, `PalettePage`, `LoomPage`
  (conditional), `UploadResultDialog`, `MaterialPresetPicker`,
  `MobileUploadPage`. ~5–15 LOC each.

## Rollout

No feature flag — the environment variables `XCS_GEN_DEMO_API_KEY`
and `XCS_GEN_DEMO_TARGET_USER_ID` control activation. Setting
`XCS_GEN_DEMO_API_KEY=""` disables the demo cleanly. Standalone-mode
deployments are unaffected (middleware not registered, header ignored).

Frontend rebuild + CloudFront invalidation required after deploy per
existing project practice. Backend restart picks up the middleware
and `deps.py` change automatically.

## Open questions

None.
