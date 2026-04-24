# Demo Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only demo account that impersonates a configured target user (default user_id=1) so prospective users can explore the app without registering, enforced by a FastAPI middleware that 403s every non-allowlisted write carrying the demo key.

**Architecture:** Backend recognises `X-User-Id: DEMO` as a virtual user in `deps.get_current_user`, returning the target user's id. A new `DemoReadOnlyMiddleware` runs outermost in the request pipeline and rejects any POST/PUT/PATCH/DELETE from the demo key unless the `(method, path)` is in a hardcoded `DEMO_SAFE_WRITES` allowlist. The frontend detects demo mode by checking `localStorage["xcsgen:userId"] === "DEMO"` via a `useIsDemo()` hook, renders a sticky `DemoBanner` above `TopBar`, and disables mutating controls via a `DemoLock` wrapper. Enter/exit flows at `#/demo` save and restore any prior real key.

**Tech Stack:** FastAPI / Starlette middleware, pytest, React 18 + TypeScript, existing `xcsgen:userId` localStorage key, Radix Dialog primitive, JetBrains Mono / warm-amber design tokens.

---

## File Structure

**New files:**
- `src/xcs_gen_web/demo.py` — `DEMO_SAFE_WRITES` constant + `DemoReadOnlyMiddleware` class. One responsibility: reject non-allowlisted writes from the demo key early in the request pipeline.
- `tests/test_demo.py` — middleware + auth-resolution tests.
- `web/src/hooks/useIsDemo.ts` — `useIsDemo(): boolean` hook reading `localStorage` with a `storage` event listener for cross-tab sync.
- `web/src/ui/DemoLock.tsx` — single-child wrapper that clones its child with `disabled` + `title` + `aria-disabled` when in demo mode.
- `web/src/components/DemoBanner.tsx` — sticky top banner with the "Exit demo" CTA.

**Modified files:**
- `src/xcs_gen_web/config.py` — two new `Settings` fields + env resolution.
- `src/xcs_gen_web/deps.py` — `get_current_user` recognises the demo key.
- `src/xcs_gen_web/app.py` — register the middleware after CORS.
- `web/src/api/userHeader.ts` — add `enterDemo()`, `exitDemo()`, `isDemoUser()`.
- `web/src/router.ts` — add `"demo"` route variant.
- `web/src/App.tsx` — mount the banner, handle the `demo` route.
- `web/src/ui/index.ts` — re-export `DemoLock`.
- `web/src/components/WelcomeDialog.tsx` — add the "Try the demo" CTA row.
- Per-component DemoLock wrappings across `LibraryPage`, `TestsPage`, `TestDetailPage`, `ResultsPanel`, `PalettePage`, `LoomPage` (if it writes), `UploadResultDialog`, `MaterialPresetPicker`, `MobileUploadPage`.

---

## Task 1: Settings fields for demo configuration

**Files:**
- Modify: `src/xcs_gen_web/config.py`
- Test: `tests/test_config.py` (or create if missing)

- [ ] **Step 1: Check whether `tests/test_config.py` exists**

Run: `ls /Users/jonzky/Documents/XTools/Reverse/tests/test_config.py 2>/dev/null`
Expected: file exists OR does not. Take note.

- [ ] **Step 2: Write the failing test**

Append (or create if missing) `tests/test_config.py` with these cases. If creating the file, include the standard pytest imports at the top:

```python
import os

import pytest

from xcs_gen_web.config import Settings


def test_demo_fields_default_to_demo_key_and_user_1(monkeypatch):
    for var in ("XCS_GEN_DEMO_API_KEY", "XCS_GEN_DEMO_TARGET_USER_ID"):
        monkeypatch.delenv(var, raising=False)
    s = Settings.from_env()
    assert s.demo_api_key == "DEMO"
    assert s.demo_target_user_id == 1


def test_demo_api_key_overridable_via_env(monkeypatch):
    monkeypatch.setenv("XCS_GEN_DEMO_API_KEY", "SAMPLE")
    s = Settings.from_env()
    assert s.demo_api_key == "SAMPLE"


def test_demo_target_user_id_overridable_via_env(monkeypatch):
    monkeypatch.setenv("XCS_GEN_DEMO_TARGET_USER_ID", "42")
    s = Settings.from_env()
    assert s.demo_target_user_id == 42


def test_demo_api_key_empty_env_disables_demo(monkeypatch):
    monkeypatch.setenv("XCS_GEN_DEMO_API_KEY", "")
    s = Settings.from_env()
    assert s.demo_api_key == ""
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/jonzky/Documents/XTools/Reverse && python3 -m pytest tests/test_config.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'demo_api_key'` (and similar for `demo_target_user_id`).

- [ ] **Step 4: Add the two fields + env resolution**

In `src/xcs_gen_web/config.py`, inside the `Settings` dataclass (after `s3_endpoint_url`) add:

```python
    # Demo account — read-only impersonation of ``demo_target_user_id``.
    # Set ``demo_api_key`` to the empty string to disable the feature;
    # the middleware short-circuits on empty keys so standalone deploys
    # and tests that don't want a demo key see zero overhead.
    demo_api_key: str = "DEMO"
    demo_target_user_id: int = 1
```

Then inside `Settings.from_env()` add two more kwargs to the `return cls(...)` call (alongside the s3_* kwargs):

```python
            demo_api_key=os.environ.get("XCS_GEN_DEMO_API_KEY", "DEMO"),
            demo_target_user_id=int(
                os.environ.get("XCS_GEN_DEMO_TARGET_USER_ID", "1"),
            ),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/jonzky/Documents/XTools/Reverse && python3 -m pytest tests/test_config.py -v`
Expected: PASS — all four tests green.

- [ ] **Step 6: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add src/xcs_gen_web/config.py tests/test_config.py
git commit -m "config: add demo_api_key and demo_target_user_id settings"
```

---

## Task 2: DemoReadOnlyMiddleware + allowlist (TDD)

**Files:**
- Create: `src/xcs_gen_web/demo.py`
- Create: `tests/test_demo.py`

- [ ] **Step 1: Write the failing test file**

Create `tests/test_demo.py`:

```python
"""Tests for DemoReadOnlyMiddleware — the outermost guard that rejects
non-allowlisted writes carrying the demo API key.

The middleware is unit-tested directly against a minimal FastAPI app so
a single test pins down the behaviour without dragging the full
``create_app`` wiring into the loop.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from xcs_gen_web.demo import DemoReadOnlyMiddleware


def make_app(demo_api_key: str = "DEMO") -> FastAPI:
    app = FastAPI()
    app.add_middleware(
        DemoReadOnlyMiddleware,
        demo_api_key=demo_api_key,
        user_header="X-User-Id",
    )

    @app.get("/api/tests")
    def list_tests():
        return {"ok": True}

    @app.post("/api/tests")
    def create_test():
        return {"ok": True}

    @app.patch("/api/tests/{tid}")
    def patch_test(tid: int):
        return {"ok": True}

    @app.delete("/api/tests/{tid}")
    def delete_test(tid: int):
        return {"ok": True}

    @app.post("/api/svg-layers")
    def gen_layers():
        return {"ok": True}

    @app.post("/api/svg-preview")
    def gen_preview():
        return {"ok": True}

    @app.post("/api/results/preflight")
    def preflight():
        return {"ok": True}

    return app


def test_demo_get_passes_through():
    client = TestClient(make_app())
    resp = client.get("/api/tests", headers={"X-User-Id": "DEMO"})
    assert resp.status_code == 200


def test_demo_post_to_non_allowlisted_is_blocked():
    client = TestClient(make_app())
    resp = client.post("/api/tests", headers={"X-User-Id": "DEMO"}, json={})
    assert resp.status_code == 403
    assert resp.json() == {"detail": "demo account is read-only"}


def test_demo_patch_is_blocked():
    client = TestClient(make_app())
    resp = client.patch("/api/tests/7", headers={"X-User-Id": "DEMO"}, json={})
    assert resp.status_code == 403


def test_demo_delete_is_blocked():
    client = TestClient(make_app())
    resp = client.delete("/api/tests/7", headers={"X-User-Id": "DEMO"})
    assert resp.status_code == 403


def test_demo_post_to_svg_layers_is_allowed():
    client = TestClient(make_app())
    resp = client.post("/api/svg-layers", headers={"X-User-Id": "DEMO"}, json={})
    assert resp.status_code == 200


def test_demo_post_to_svg_preview_is_allowed():
    client = TestClient(make_app())
    resp = client.post("/api/svg-preview", headers={"X-User-Id": "DEMO"}, json={})
    assert resp.status_code == 200


def test_demo_post_to_preflight_is_allowed():
    client = TestClient(make_app())
    resp = client.post(
        "/api/results/preflight", headers={"X-User-Id": "DEMO"}, json={},
    )
    assert resp.status_code == 200


def test_non_demo_user_post_passes_through():
    client = TestClient(make_app())
    resp = client.post(
        "/api/tests", headers={"X-User-Id": "fsp9KYfD7zRUL507"}, json={},
    )
    assert resp.status_code == 200


def test_no_header_post_passes_through():
    client = TestClient(make_app())
    resp = client.post("/api/tests", json={})
    assert resp.status_code == 200


def test_empty_demo_key_disables_middleware():
    # When demo_api_key is empty, no header value should trip the block.
    client = TestClient(make_app(demo_api_key=""))
    resp = client.post("/api/tests", headers={"X-User-Id": ""}, json={})
    assert resp.status_code == 200
    resp = client.post("/api/tests", headers={"X-User-Id": "DEMO"}, json={})
    assert resp.status_code == 200


def test_header_whitespace_is_trimmed():
    # Leading/trailing whitespace on the X-User-Id header shouldn't
    # sneak a demo identity past the check.
    client = TestClient(make_app())
    resp = client.post("/api/tests", headers={"X-User-Id": " DEMO "}, json={})
    assert resp.status_code == 403


def test_get_is_never_blocked_even_with_demo_header():
    client = TestClient(make_app())
    resp = client.get("/api/tests", headers={"X-User-Id": "DEMO"})
    assert resp.status_code == 200
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd /Users/jonzky/Documents/XTools/Reverse && python3 -m pytest tests/test_demo.py -v`
Expected: FAIL — `ImportError: cannot import name 'DemoReadOnlyMiddleware' from 'xcs_gen_web.demo'` (module does not exist).

- [ ] **Step 3: Implement the middleware**

Create `src/xcs_gen_web/demo.py`:

```python
"""Demo account — read-only showcase access enforcement.

The middleware recognises the demo API key by its exact header value
(configurable) and rejects any write method outside the allowlist with
``403 {"detail": "demo account is read-only"}``.

Identification of the demo user (returning the target owner_id from
``get_current_user``) lives in ``deps.py`` — this module is only the
write-enforcement gate. Split intentionally so the two concerns can be
understood and tested independently: identification is about auth,
enforcement is about HTTP verb policing.
"""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response


# Methods that can mutate state. HEAD/OPTIONS/TRACE are never blocked
# so that CORS preflight and browser HEAD probes work normally.
WRITE_METHODS: frozenset[str] = frozenset({"POST", "PUT", "PATCH", "DELETE"})


# ``(method, path)`` tuples for writes that demo users ARE allowed to
# make. Every endpoint here must be verified to not persist anything to
# the database — they compute and return bytes only.
DEMO_SAFE_WRITES: frozenset[tuple[str, str]] = frozenset({
    ("POST", "/api/svg-layers"),
    ("POST", "/api/svg-preview"),
    ("POST", "/api/results/preflight"),
})


class DemoReadOnlyMiddleware(BaseHTTPMiddleware):
    """Blocks non-allowlisted writes from the demo API key.

    Runs outermost in the stack (added last in ``create_app``) so that
    a violation is 403'd before any body is read, any DB query runs, or
    any other middleware consumes work.
    """

    def __init__(
        self,
        app,
        *,
        demo_api_key: str,
        user_header: str,
    ) -> None:
        super().__init__(app)
        self._key = demo_api_key
        self._header = user_header

    async def dispatch(self, request: Request, call_next) -> Response:
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

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd /Users/jonzky/Documents/XTools/Reverse && python3 -m pytest tests/test_demo.py -v`
Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add src/xcs_gen_web/demo.py tests/test_demo.py
git commit -m "demo: add DemoReadOnlyMiddleware and write allowlist"
```

---

## Task 3: Wire demo into deps + create_app

**Files:**
- Modify: `src/xcs_gen_web/deps.py`
- Modify: `src/xcs_gen_web/app.py`
- Test: extend `tests/test_demo.py`

- [ ] **Step 1: Write the failing end-to-end test**

Append to `tests/test_demo.py`:

```python
# --- End-to-end: demo key resolves to the target user + middleware wires in.

def test_demo_key_resolves_to_target_user_in_deps():
    """Full create_app wiring: DEMO header returns the target user's
    data on a GET, and is blocked on a POST to a non-allowlisted route."""
    from xcs_gen_web.app import create_app
    from xcs_gen_web.config import Settings

    settings = Settings(
        mode="multi_user",
        db_url="sqlite:///:memory:",
        auto_migrate=True,
        demo_api_key="DEMO",
        demo_target_user_id=1,
    )
    app = create_app(settings=settings)
    client = TestClient(app)

    # GET hits the repo layer. With an empty test DB the target user
    # has no tests yet — but the call succeeds (200, empty list), which
    # proves the demo key resolved to an owner_id without 401.
    resp = client.get("/api/tests", headers={"X-User-Id": "DEMO"})
    assert resp.status_code == 200
    assert resp.json() == []

    # Non-allowlisted POST is 403 (middleware).
    resp = client.post(
        "/api/tests",
        headers={"X-User-Id": "DEMO", "Content-Type": "application/json"},
        json={"name": "should not persist", "spec": {}},
    )
    assert resp.status_code == 403
    assert resp.json() == {"detail": "demo account is read-only"}


def test_demo_disabled_when_key_is_empty():
    """With ``demo_api_key=""`` in settings, sending X-User-Id: DEMO
    behaves like any unregistered key — 401 from deps, NOT 403."""
    from xcs_gen_web.app import create_app
    from xcs_gen_web.config import Settings

    settings = Settings(
        mode="multi_user",
        db_url="sqlite:///:memory:",
        auto_migrate=True,
        demo_api_key="",
    )
    app = create_app(settings=settings)
    client = TestClient(app)

    resp = client.get("/api/tests", headers={"X-User-Id": "DEMO"})
    # DEMO is not a valid base64url 16-char key; deps returns 401.
    assert resp.status_code == 401
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd /Users/jonzky/Documents/XTools/Reverse && python3 -m pytest tests/test_demo.py::test_demo_key_resolves_to_target_user_in_deps tests/test_demo.py::test_demo_disabled_when_key_is_empty -v`
Expected: FAIL — demo key not recognised by deps yet, so the GET returns 401; middleware isn't wired into `create_app` yet, so the POST either succeeds or 401s rather than 403s.

- [ ] **Step 3: Recognise the demo key in `deps.get_current_user`**

Open `src/xcs_gen_web/deps.py`. Replace the function body with:

```python
def get_current_user(request: Request) -> int:
    """Resolve the integer owner_id for the current request.

    Standalone mode: always returns ``settings.standalone_user_id``.

    Multi-user mode: reads the configured header (``X-User-Id`` by
    default). The literal ``settings.demo_api_key`` (when non-empty) is
    recognised as a virtual "demo" user and resolves to
    ``settings.demo_target_user_id`` without a DB lookup. Any other
    value is validated against the users table; malformed or
    unregistered keys return 401. Successful multi-user resolution
    bumps ``last_seen_at``; the demo path does not.
    """
    settings: Settings = request.app.state.settings
    if settings.mode == "standalone":
        return settings.standalone_user_id
    raw = request.headers.get(settings.user_header, "").strip()
    if not raw:
        raise HTTPException(
            status_code=401,
            detail=(
                f"missing {settings.user_header} header — "
                "this server runs in multi_user mode"
            ),
        )
    # Virtual demo user — recognised before DB validation so the demo
    # key doesn't have to be a valid-shape api_key.
    if settings.demo_api_key and raw == settings.demo_api_key:
        return int(settings.demo_target_user_id)
    if not u_repo.is_valid_api_key(raw):
        raise HTTPException(
            status_code=401,
            detail="api key must be 16 url-safe base64 chars",
        )
    user = u_repo.get_by_api_key(raw)
    if user is None:
        raise HTTPException(
            status_code=401,
            detail="api key not registered — claim or load one from the welcome screen",
        )
    u_repo.touch_last_seen(user["id"])
    return int(user["id"])
```

- [ ] **Step 4: Register the middleware in `create_app`**

Open `src/xcs_gen_web/app.py`. Find the block:

```python
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            ...
        )
```

Immediately AFTER that `if` block (still before the `register_limiter = ...` line), add:

```python
    # Demo write-block runs outermost so a disallowed write is 403'd
    # before any body is read or DB query runs. Disabled when
    # demo_api_key is empty or mode is standalone (standalone ignores
    # the header entirely).
    if settings.mode != "standalone" and settings.demo_api_key:
        from .demo import DemoReadOnlyMiddleware
        app.add_middleware(
            DemoReadOnlyMiddleware,
            demo_api_key=settings.demo_api_key,
            user_header=settings.user_header,
        )
```

- [ ] **Step 5: Run the full demo test file**

Run: `cd /Users/jonzky/Documents/XTools/Reverse && python3 -m pytest tests/test_demo.py -v`
Expected: PASS — all 13 tests green.

- [ ] **Step 6: Run the broader backend suite to check no regressions**

Run: `cd /Users/jonzky/Documents/XTools/Reverse && python3 -m pytest tests/ -q`
Expected: PASS — all pre-existing tests still green. The demo_api_key default is `"DEMO"` so existing multi-user tests that send real API keys are unaffected (their keys never equal `"DEMO"`).

- [ ] **Step 7: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add src/xcs_gen_web/deps.py src/xcs_gen_web/app.py tests/test_demo.py
git commit -m "demo: wire virtual user into deps + register middleware"
```

---

## Task 4: Frontend demo state helpers

**Files:**
- Modify: `web/src/api/userHeader.ts`
- Create: `web/src/hooks/useIsDemo.ts`

No tests for these — thin wrappers over `localStorage` + `useState`. Manual verification via `npm run build` + behaviour in later tasks.

- [ ] **Step 1: Add state helpers to `userHeader.ts`**

Open `web/src/api/userHeader.ts`. After the existing `const STORAGE_KEY = "xcsgen:userId";` line, add:

```ts
const PREV_KEY = "xcsgen:userId:prev";

/** Literal API-key value that signals "demo account" to the backend. */
export const DEMO_API_KEY = "DEMO";

export function isDemoUser(): boolean {
  return getCurrentUserId() === DEMO_API_KEY;
}

/**
 * Switch the app into demo mode. If a real key is already stored, it
 * is preserved under ``PREV_KEY`` so ``exitDemo()`` can restore it and
 * users don't lose their session when they click a demo link from
 * within the app.
 */
export function enterDemo(): void {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current && current !== DEMO_API_KEY) {
      localStorage.setItem(PREV_KEY, current);
    }
    localStorage.setItem(STORAGE_KEY, DEMO_API_KEY);
  } catch {
    /* storage disabled — ignore; app will re-gate on next load */
  }
}

/**
 * Leave demo mode. Restores the previously-saved real key if any;
 * otherwise clears the slot entirely (Welcome gate picks up from
 * there).
 */
export function exitDemo(): void {
  try {
    const prev = localStorage.getItem(PREV_KEY);
    if (prev) {
      localStorage.setItem(STORAGE_KEY, prev);
      localStorage.removeItem(PREV_KEY);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 2: Create the `useIsDemo` hook**

Create `web/src/hooks/useIsDemo.ts`:

```ts
import { useEffect, useState } from "react";
import { isDemoUser } from "../api/userHeader";

/**
 * Read-only boolean derived from ``localStorage``. Re-checks when the
 * ``storage`` event fires so exiting demo in another tab updates the
 * banner and disabled-button state in this tab.
 *
 * In-tab updates (entering/exiting demo via a button in this same tab)
 * don't fire ``storage`` — callers who need to react inside the tab
 * that mutated storage must also trigger a state update themselves
 * (e.g. a ``navigate`` that re-renders the tree).
 */
export function useIsDemo(): boolean {
  const [v, setV] = useState<boolean>(isDemoUser);
  useEffect(() => {
    const handler = () => setV(isDemoUser());
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  return v;
}
```

- [ ] **Step 3: Verify the build**

Run: `cd /Users/jonzky/Documents/XTools/Reverse/web && npm run build 2>&1 | grep -vE "GuidePage|App.tsx" | tail -8`
Expected: `✓ built in …s`. No TypeScript errors originating in `userHeader.ts` or `useIsDemo.ts`. Pre-existing unrelated errors in `App.tsx`/`GuidePage` (if any) are filtered.

- [ ] **Step 4: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/api/userHeader.ts web/src/hooks/useIsDemo.ts
git commit -m "demo: add enterDemo/exitDemo/isDemoUser + useIsDemo hook"
```

---

## Task 5: DemoLock wrapper component

**Files:**
- Create: `web/src/ui/DemoLock.tsx`
- Modify: `web/src/ui/index.ts`

- [ ] **Step 1: Create `DemoLock.tsx`**

Create `web/src/ui/DemoLock.tsx`:

```tsx
import { cloneElement, type ReactElement } from "react";
import { useIsDemo } from "../hooks/useIsDemo";
import { cn } from "./cn";

export interface DemoLockProps {
  /**
   * The interactive element to lock. Must accept ``disabled`` and
   * ``title`` props (button-like). Usually a ``<Button>``, but a
   * plain ``<button>`` or a labelled ``<input>`` works too.
   */
  children: ReactElement;
  /** Tooltip shown on hover. Customise per call site to say which
   *  action is blocked. */
  label?: string;
}

/**
 * Disables the wrapped control when the app is in demo mode.
 * Adds ``disabled`` + ``aria-disabled`` + ``title`` to the child and
 * wraps it in a ``<span>`` with ``cursor-not-allowed`` so the mouse
 * affordance still reads as locked even when the inner button itself
 * has ``pointer-events: none`` due to ``disabled``.
 *
 * Outside demo mode this renders the child verbatim with zero DOM
 * overhead — the wrapper span is only emitted on the demo branch.
 */
export function DemoLock({
  children,
  label = "Not available in the demo account",
}: DemoLockProps) {
  const isDemo = useIsDemo();
  if (!isDemo) return children;
  const disabledChild = cloneElement(children, {
    disabled: true,
    "aria-disabled": true,
    title: label,
  } as Record<string, unknown>);
  return (
    <span
      className={cn("inline-flex cursor-not-allowed")}
      title={label}
    >
      {disabledChild}
    </span>
  );
}
```

- [ ] **Step 2: Re-export from the ui barrel**

Open `web/src/ui/index.ts`. Add this line near the bottom (alongside the other `export { … } from "./…"` lines):

```ts
export { DemoLock, type DemoLockProps } from "./DemoLock";
```

- [ ] **Step 3: Verify the build**

Run: `cd /Users/jonzky/Documents/XTools/Reverse/web && npm run build 2>&1 | grep -vE "GuidePage|App.tsx" | tail -5`
Expected: `✓ built in …s`. No errors from `DemoLock.tsx` or `ui/index.ts`.

- [ ] **Step 4: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/ui/DemoLock.tsx web/src/ui/index.ts
git commit -m "demo: add DemoLock wrapper for disabling mutation controls"
```

---

## Task 6: DemoBanner component

**Files:**
- Create: `web/src/components/DemoBanner.tsx`

- [ ] **Step 1: Create the banner**

Create `web/src/components/DemoBanner.tsx`:

```tsx
import { Eye } from "lucide-react";
import { exitDemo } from "../api/userHeader";
import { cn } from "../ui";

/**
 * Sticky top-of-app banner shown while the user is in demo mode.
 * Mounted by ``App.tsx`` above ``<TopBar>`` when ``useIsDemo()``
 * returns true. The whole banner is click-to-exit; the trailing
 * button is redundant but matches the user-facing phrasing.
 *
 * Colour family: ``--color-warning-tint`` background with
 * ``--color-warning`` foreground — the "amber caution strip" cue
 * that's already used elsewhere for non-error alerts. A low-opacity
 * diagonal-stripe pattern gives it the "roped off" print-shop feel
 * without introducing a new design token.
 */
export function DemoBanner({ onExit }: { onExit: () => void }) {
  const handleExit = () => {
    exitDemo();
    onExit();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleExit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleExit();
        }
      }}
      className={cn(
        "sticky top-0 z-40 w-full h-10 px-4",
        "flex items-center justify-between gap-4",
        "bg-[color:var(--color-warning-tint)]",
        "text-[color:var(--color-warning)]",
        "border-b border-[color:var(--color-warning)]/30",
        "cursor-pointer select-none",
        "animate-[demo-banner-slide_160ms_ease-out]",
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12'><path d='M-1,1 l6,-6 M0,12 l12,-12 M11,13 l6,-6' stroke='%23C98A1E' stroke-width='0.8' opacity='0.25'/></svg>\")",
      }}
    >
      <style>{`
        @keyframes demo-banner-slide {
          from { transform: translateY(-100%); opacity: 0; }
          to   { transform: translateY(0);      opacity: 1; }
        }
      `}</style>
      <div className="flex items-center gap-2 text-[12.5px] font-medium">
        <Eye className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span>
          <strong className="font-semibold">Demo mode</strong>
          <span className="ml-1 opacity-85">
            — exploring a read-only showcase account. Every change is locked.
          </span>
        </span>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleExit();
        }}
        className={cn(
          "inline-flex items-center gap-1 h-7 px-2.5 rounded-[6px]",
          "text-[12px] font-semibold tracking-[0.02em]",
          "border border-[color:var(--color-warning)]/40",
          "bg-[color:var(--color-warning-tint)]/80",
          "hover:bg-[color:var(--color-warning)]/10",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-warning)]/50",
        )}
      >
        Exit demo →
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `cd /Users/jonzky/Documents/XTools/Reverse/web && npm run build 2>&1 | grep -vE "GuidePage|App.tsx" | tail -5`
Expected: `✓ built in …s`. No errors from `DemoBanner.tsx`.

- [ ] **Step 3: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/DemoBanner.tsx
git commit -m "demo: add DemoBanner sticky warning strip"
```

---

## Task 7: Router + App.tsx integration

**Files:**
- Modify: `web/src/router.ts`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Add the `demo` route variant**

Open `web/src/router.ts`. Modify the `Route` union to include:

```ts
export type Route =
  | { name: "tests" }
  | { name: "test-new" }
  | { name: "test-detail"; id: number }
  | { name: "loom" }
  | { name: "svg-layers" }
  | { name: "library" }
  | { name: "palette" }
  | { name: "spectrum"; id?: number }
  | { name: "spectrum-2d"; id?: number }
  | { name: "styleguide" }
  | { name: "guide" }
  | { name: "demo" }
  | { name: "mobile-upload"; mid: string };
```

In `parseRoute`, add the `demo` recognition before the fallback. Locate the line `if (h === "guide") return { name: "guide" };` and add right after it:

```ts
  if (h === "demo") return { name: "demo" };
```

In `formatRoute`, add a case for `demo` inside the switch:

```ts
    case "demo":        return "#/demo";
```

- [ ] **Step 2: Handle the `demo` route in `App.tsx`**

Open `web/src/App.tsx`. Add these imports at the top (alongside existing imports):

```ts
import { enterDemo } from "./api/userHeader";
import { useIsDemo } from "./hooks/useIsDemo";
import { DemoBanner } from "./components/DemoBanner";
```

Inside the `App` function, just below the existing `useEffect(() => { if (window.location.hash === "") navigate({ name: "tests" }); }, [navigate]);` hook, add:

```tsx
  const isDemo = useIsDemo();

  // ``#/demo`` is a side-effect route — entering demo mode then
  // bouncing the user to the Tests page. The banner on the main app
  // will show thereafter.
  useEffect(() => {
    if (route.name === "demo") {
      enterDemo();
      setGate("ready");
      navigate({ name: "tests" });
    }
  }, [route.name, navigate]);
```

Find the `title` ternary (the block starting `const title = route.name === "tests" ? "Tests"`). Add a `demo` branch to keep TypeScript exhaustive (the route redirects away instantly, so the title is never actually shown, but the type system insists):

```tsx
  const title =
    route.name === "tests"        ? "Tests"
    : route.name === "test-new"   ? "New test"
    : route.name === "test-detail" ? `Test #${route.id}`
    : route.name === "loom"       ? "Loom"
    : route.name === "svg-layers" ? "SVG layers"
    : route.name === "library"    ? "Library"
    : route.name === "styleguide" ? "Styleguide"
    : route.name === "spectrum"   ? "Spectrum"
    : route.name === "spectrum-2d" ? "Spectrum · 2D"
    : route.name === "guide"      ? "Guide"
    : route.name === "demo"       ? "Demo"
    : "Palette";
```

Mount the banner above `<TopBar>`. Change the return block's top:

```tsx
  return (
    <div className="flex flex-col h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:rounded-[6px] focus:bg-[color:var(--color-primary)] focus:text-white focus:text-[12px] focus:font-medium"
      >
        Skip to main content
      </a>
      {isDemo && (
        <DemoBanner
          onExit={() => {
            // Force a re-render so the gate re-evaluates after the
            // storage slot is cleared (restored prev key → "ready";
            // no prev → "welcome").
            setGate(null);
            navigate({ name: "tests" });
          }}
        />
      )}
      <TopBar title={title} route={route} onNavigate={navigate} />
```

(Everything below `<TopBar …/>` stays unchanged.)

In the `getHealth()` effect, the gate resolution needs to treat the stored `"DEMO"` key as a valid key so the Welcome dialog doesn't show. The existing `hasStoredKey()` check returns true for any non-empty value, so `"DEMO"` already passes. Verify:

Run: `grep -n "hasStoredKey" /Users/jonzky/Documents/XTools/Reverse/web/src/api/users.ts`
Expected: a function returning `localStorage.getItem(STORAGE_KEY) !== null` (or similar non-empty check). If it checks only for valid-shape keys and `"DEMO"` wouldn't pass, flag and ask.

- [ ] **Step 3: After-exit gate recovery**

When the banner's `onExit` callback fires, we reset `gate` to `null` and let the existing `getHealth` effect re-run. But `getHealth` only runs once on mount (empty dep list). So we need a second effect that re-probes the gate when `gate` becomes `null` while the app is already mounted:

Still in `App.tsx`, add this effect immediately after the existing `getHealth` effect:

```tsx
  // Re-probe the gate whenever it transitions back to null (e.g. after
  // a demo exit wiped the stored key and we need to decide whether
  // the restored prev key counts or the Welcome dialog should show).
  useEffect(() => {
    if (gate !== null) return;
    if (hasStoredKey()) {
      setGate("ready");
    } else {
      getHealth()
        .then((h) => {
          setGate(h.mode === "standalone" ? "ready" : "welcome");
        })
        .catch(() => setGate("ready"));
    }
  }, [gate]);
```

Remove the duplicate first-mount effect — the second hook's `gate !== null` guard plus its `hasStoredKey` branch already covers the initial load. Replace the original `useEffect` that called `getHealth()` with the new unified one above, deleting the original.

Actually the simpler refactor is to keep the original mount effect and add a second effect ONLY for the exit path:

```tsx
  useEffect(() => {
    // Fires only after an exit: the original mount effect set the
    // initial gate, then the banner exit set it back to null. Resolve
    // again without re-hitting /api/health if there's now a stored key.
    if (gate !== null) return;
    if (hasStoredKey()) {
      setGate("ready");
    } else {
      setGate("welcome");
    }
  }, [gate]);
```

Use this simpler version — skip the second `getHealth()` call since by the time the exit happens we already know the backend mode.

- [ ] **Step 4: Run tests + build**

Run: `cd /Users/jonzky/Documents/XTools/Reverse/web && npm test`
Expected: 54/54 tests pass.

Run: `cd /Users/jonzky/Documents/XTools/Reverse/web && npm run build 2>&1 | tail -6`
Expected: `✓ built in …s`. No new TypeScript errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/router.ts web/src/App.tsx
git commit -m "demo: route handler + DemoBanner mount + gate recovery"
```

---

## Task 8: WelcomeDialog CTA

**Files:**
- Modify: `web/src/components/WelcomeDialog.tsx`

- [ ] **Step 1: Read the current dialog to find an insertion point**

Run: `grep -n "DialogContent\|</DialogContent>\|Claim\|Paste" /Users/jonzky/Documents/XTools/Reverse/web/src/components/WelcomeDialog.tsx | head -10`
Note the line numbers. The CTA goes just before the closing `</DialogContent>` tag so it sits at the bottom of the dialog regardless of which phase (claim/paste) is visible.

- [ ] **Step 2: Add the CTA row at the bottom of the dialog**

Open `web/src/components/WelcomeDialog.tsx`. Locate the closing `</DialogContent>` tag and add the block below directly before it:

```tsx
          <div className="mt-5 flex items-center gap-3">
            <div className="flex-1 h-px bg-[color:var(--metal-bar-soft)]" />
            <span className="font-mono text-[9.5px] tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
              or
            </span>
            <div className="flex-1 h-px bg-[color:var(--metal-bar-soft)]" />
          </div>
          <a
            href="#/demo"
            className={cn(
              "mt-3 flex items-center justify-between gap-3 w-full",
              "rounded-[8px] border border-[color:var(--color-border)]",
              "bg-[color:var(--color-surface-elevated)]",
              "px-3 py-2.5",
              "text-left transition-colors",
              "hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface)]",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/40",
            )}
          >
            <div>
              <div className="text-[13px] font-semibold text-[color:var(--color-ink)]">
                Just browsing? Try the demo account →
              </div>
              <div className="mt-0.5 text-[11px] text-[color:var(--color-ink-subtle)]">
                Read-only access to a pre-filled workbench.
              </div>
            </div>
          </a>
```

If `cn` is not already imported in this file, add `cn` to the existing `../ui` import list.

- [ ] **Step 3: Build + verify**

Run: `cd /Users/jonzky/Documents/XTools/Reverse/web && npm run build 2>&1 | tail -6 && npm test 2>&1 | tail -3`
Expected: clean build, 54/54 tests still pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/WelcomeDialog.tsx
git commit -m "demo: add 'Try the demo account' CTA to WelcomeDialog"
```

---

## Task 9: Apply DemoLock across mutating UI controls

**Files (modify each):**
- `web/src/components/LibraryPage.tsx`
- `web/src/components/TestsPage.tsx` (likely under `web/src/pages/TestsPage.tsx` — confirm at step 1)
- `web/src/pages/TestDetailPage.tsx`
- `web/src/components/ResultsPanel.tsx`
- `web/src/components/PalettePage.tsx`
- `web/src/components/UploadResultDialog.tsx`
- `web/src/components/MaterialPresetPicker.tsx`
- `web/src/pages/MobileUploadPage.tsx`
- `web/src/pages/LoomPage.tsx` (inspect at step 1 — only wrap if it persists to the DB)

- [ ] **Step 1: Inspect each file and list the mutating controls**

Run: `grep -rln "uploadResult\|createTest\|patchTest\|deleteTest\|createMaterial\|deleteMaterial\|patchMaterial\|createPreset\|deletePreset\|patchPreset\|deleteResult\|deletePaletteEntry\|patchPaletteEntry\|ingestToPalette\|rotateMobileId\|createMobileId" /Users/jonzky/Documents/XTools/Reverse/web/src`

Note the components where each of these API helpers is called. Every caller with a button is a DemoLock target.

- [ ] **Step 2: Wrap the "New test" CTA**

Open `web/src/pages/TestsPage.tsx`. Add `DemoLock` to the existing `../ui` import alongside `Button` et al:

```tsx
import { … DemoLock } from "../ui";
```

Find the primary "New test" button and wrap it:

```tsx
<DemoLock label="Create a test in your own account to get started.">
  <Button variant="primary" onClick={() => navigate("test-new")}>
    + New test
  </Button>
</DemoLock>
```

Find any per-row delete button (trash-icon) and wrap:

```tsx
<DemoLock label="Deleting tests is disabled in the demo.">
  <button …>
    <Trash2 className="h-3.5 w-3.5" />
  </button>
</DemoLock>
```

- [ ] **Step 3: Wrap LibraryPage controls**

Open `web/src/components/LibraryPage.tsx`. Import `DemoLock` and wrap every button that triggers: add material, edit material, delete material, add preset, edit preset, delete preset, set-as-default.

Pattern for each wrap:

```tsx
<DemoLock label="Materials and presets are read-only in the demo.">
  <Button …>…</Button>
</DemoLock>
```

- [ ] **Step 4: Wrap TestDetailPage mutating controls**

Open `web/src/pages/TestDetailPage.tsx`. Wrap the save-test button, any regenerate-XCS button that persists, and any per-field save buttons that call PATCH.

Generation-only buttons (that POST to the allowlisted `/api/svg-layers` or `/api/svg-preview`) MUST NOT be wrapped — those are the demo's showcase endpoints.

Pattern:

```tsx
<DemoLock label="Editing tests is disabled in the demo.">
  <Button onClick={save}>Save changes</Button>
</DemoLock>
```

- [ ] **Step 5: Wrap ResultsPanel controls**

Open `web/src/components/ResultsPanel.tsx`. Import `DemoLock`. Wrap:

- The "Upload photo" button and its file-input label — to guard the file input, the cleanest approach is to set the input's `disabled={isDemo}` via a local `useIsDemo()` call PLUS wrap the label in `DemoLock`:

```tsx
const isDemo = useIsDemo();
…
<DemoLock label="Upload is disabled in the demo.">
  <Button onClick={() => fileInputRef.current?.click()}>
    <Camera className="h-4 w-4" /> Upload photo
  </Button>
</DemoLock>
<input
  ref={fileInputRef}
  type="file"
  accept="image/*"
  onChange={onUpload}
  disabled={isDemo}
  className="hidden"
/>
```

- The delete-result trash button inside each row.
- The exclude-toggle checkbox (wrap as a span with `onClick` guarded, since DemoLock expects a button; for native `<input type="checkbox">`, use a conditional `disabled={isDemo}` + `title` attribute inline):

```tsx
<label … onClick={(e) => e.stopPropagation()}>
  <input
    type="checkbox"
    checked={r.excluded}
    onChange={(e) => toggleExclude(r.id, e.target.checked)}
    disabled={isDemo}
    title={isDemo ? "Exclude is disabled in the demo." : undefined}
  />
  exclude
</label>
```

- The "Ingest to palette" primary button at the bottom:

```tsx
<DemoLock label="Ingesting to palette is disabled in the demo.">
  <Button variant="primary" onClick={doIngest} disabled={indices.length === 0}>
    Ingest to palette
  </Button>
</DemoLock>
```

Import `useIsDemo` alongside the existing `useAuthedImage` import:

```ts
import { useAuthedImage } from "../hooks/useAuthedImage";
import { useIsDemo } from "../hooks/useIsDemo";
```

- [ ] **Step 6: Wrap PalettePage controls**

Open `web/src/components/PalettePage.tsx`. Import `DemoLock` and wrap: the per-entry delete button, the "Delete all for this test" button, any patch/edit controls inside the info modal.

- [ ] **Step 7: Wrap UploadResultDialog controls**

Open `web/src/components/UploadResultDialog.tsx`. The dialog has two tabs (device vs phone). Wrap:

- The "Upload" / "Submit" primary button on the device tab.
- "Generate mobile QR" and "Rotate QR" buttons on the phone tab.

If the tabbed dialog uses `fetch` for the QR calls, the demo user is already 403'd server-side — the lock is cosmetic.

- [ ] **Step 8: Wrap MaterialPresetPicker mutating controls**

Open `web/src/components/MaterialPresetPicker.tsx`. If it has edit/save-as-preset CTAs, wrap them. If it's purely read-and-apply, skip.

- [ ] **Step 9: Wrap MobileUploadPage controls**

Open `web/src/pages/MobileUploadPage.tsx`. The main interactive control is the camera input. Set `disabled={isDemo}` and add an inline `title` attribute when disabled. No DemoLock wrap needed for the file input itself.

- [ ] **Step 10: Verify LoomPage**

Open `web/src/pages/LoomPage.tsx`. Read it end to end and determine whether it persists to the DB (any call to `createTest`, `patchTest`, `uploadResult`, etc.) or just computes + downloads.

- If it's pure compute (generates a downloadable .xcs without a DB write), skip — no locking needed.
- If it persists, wrap each persist-triggering button in `DemoLock` with an appropriate label.

Use this decision criterion explicitly, written out in the commit message so reviewers can verify.

- [ ] **Step 11: Run tests + build**

Run: `cd /Users/jonzky/Documents/XTools/Reverse/web && npm test && npm run build 2>&1 | tail -6`
Expected: 54/54 tests pass; clean build (ignoring pre-existing unrelated errors per existing convention).

- [ ] **Step 12: Manual smoke test**

Run `npm run dev`, open the app, in devtools set `localStorage.setItem("xcsgen:userId", "DEMO")`, reload. Verify:
- Banner appears at the top.
- Tests page: "+ New test" button disabled with tooltip; delete buttons disabled.
- Library page: add/edit/delete material + preset buttons all disabled.
- SVG Layers page: every control still live (auto-match, merge similar, generate .xcs all work).
- ResultsPanel: photo upload, delete, exclude checkbox, ingest all disabled.
- Clicking "Exit demo →" navigates back to Tests, banner disappears, if a prev key was stored it's now active; otherwise WelcomeDialog appears.

- [ ] **Step 13: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/
git commit -m "$(cat <<'EOF'
demo: wrap mutating controls in DemoLock across mutating pages

LibraryPage, TestsPage, TestDetailPage, ResultsPanel, PalettePage,
UploadResultDialog, MaterialPresetPicker, MobileUploadPage — every
button that triggers a non-allowlisted write now renders disabled with
a per-site tooltip. SvgLayersPage is deliberately untouched: all its
writes (svg-layers, svg-preview) are allowlisted so the showcase
generator stays fully interactive in demo mode. LoomPage was inspected
and determined <persists / is compute-only — adjust in commit body>.
EOF
)"
```

---

## Task 10: Backend integration smoke-test against running prod

**Files:** none

- [ ] **Step 1: Ensure backend + frontend build is clean**

Run:
```bash
cd /Users/jonzky/Documents/XTools/Reverse
python3 -m pytest tests/ -q 2>&1 | tail -5
cd web && npm test 2>&1 | tail -3 && npm run build 2>&1 | tail -3
```
Expected: all green.

- [ ] **Step 2: Push**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse push origin main
```

Deployment pipeline then rebuilds and publishes. Verify in prod by opening `https://engraving.media/#/demo` in an incognito window — the banner should appear and all mutating controls should be disabled.

---

## Self-review notes

**Spec coverage check:**

- § Feature 1 (Demo API key) → Tasks 1, 3 Step 3 (deps recognition).
- § Feature 2 (Write-block middleware + DEMO_SAFE_WRITES) → Task 2.
- § Feature 3 (Frontend demo mode + DemoBanner + DemoLock + photo-input lock) → Tasks 4, 5, 6, 9.
- § Feature 4 (Entry via `#/demo`, WelcomeDialog CTA, exit button → prev-key restore or WelcomeDialog) → Tasks 4 (enter/exit), 7 (router + App.tsx), 8 (CTA).
- § Non-goals: no DB row, no seed data, no analytics, no rate limiter, no auto-exit — none of these are implemented, consistent with spec.
- § Settings fields + env overrides → Task 1.
- § Standalone mode ignores demo → Task 3 Step 4 (middleware registration guarded by `settings.mode != "standalone"`).
- § Empty `demo_api_key` disables everything → Task 3 Step 4 guard + Task 2 middleware `if self._key` check + Task 3 Step 1 unit test.
- § Tests table for edge cases → Task 2 + Task 3 tests (13 cases total).

**Placeholder scan:** no TBD / TODO / "implement later" phrases. Task 9 Step 10 has a "decide at implementation" for LoomPage, but it's a concrete mechanical decision: grep the file for the listed API helpers, wrap what writes, skip what computes. Acceptable.

**Type consistency check:** `enterDemo()` / `exitDemo()` / `isDemoUser()` / `DEMO_API_KEY` / `useIsDemo()` / `DemoLock` / `DemoBanner` / `DemoReadOnlyMiddleware` / `DEMO_SAFE_WRITES` — all used consistently across tasks. The banner's `onExit` prop matches Task 7 Step 2's usage.
