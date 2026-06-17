# Standalone `#/depthmaps` page — design

**Date:** 2026-06-17
**Status:** approved (design), pending implementation

## Goal

A shareable, standalone depth-map smoother at `#/depthmaps` that reuses the
existing Relief page/components but renders **without the app menu and without
the registration / demo gate** — so the URL can be shared with anyone and Just
Works. It keeps a GitHub link and adds a "Main App" button back into the full app.

## Why this is safe (no new exposure)

- Relief's only backend call is `POST /api/relief/smooth`, which is an
  **unauthenticated, stateless compute endpoint** — it has no
  `Depends(get_current_user)` and touches no user data, library, or tests.
- `ReliefPage` makes **no other** API calls (no `getHealth`, no user/library
  reads — those live in `App.tsx`).
- Therefore a standalone page that renders `ReliefPage` exposes *only* the
  depth-map smoother. That endpoint is already reachable today regardless of
  this page, so sharing `#/depthmaps` adds no new attack surface.

## Precedent

The `mobile-upload` route (`#/m/<mid>`) already renders alone via an **early
return in `App.tsx` before the gate** — no `TopBar`, no `WelcomeDialog`, no
multi-user gate. `#/depthmaps` mirrors this exactly.

## Decisions (locked)

- **Header:** a slim 56px bar — left: `DEPTH MAPS` wordmark; right: theme
  toggle + GitHub icon + "Main App" button. `ReliefPage`'s own toolbar (status
  / Re-render / Replace / Export) stays below it.
- **Both entry points kept:** `#/relief` stays in the Engraving menu for the
  main app; `#/depthmaps` is the separate standalone — same component.
- **Branding:** "Depth Maps" (matches the URL); the in-app version keeps "Relief".

## Architecture

```
App (route = depthmaps)
  └─ early return (before gate/TopBar/WelcomeDialog/DemoBanner)
       └─ <Suspense> <DepthMapsStandalone onNavigate={navigate} /> </Suspense>

DepthMapsStandalone   (flex-col, h-screen)
  ├─ header (h-14 / 56px): "DEPTH MAPS" · ThemeToggle · GitHub · "Main App"
  └─ <ReliefPage/>   (unchanged; its root is calc(100dvh - 56px))
```

### Components / files

1. **`web/src/router.ts`**
   - Add `{ name: "depthmaps" }` to the `Route` union.
   - `parseRoute`: `if (h === "depthmaps") return { name: "depthmaps" };`
   - `formatRoute`: `case "depthmaps": return "#/depthmaps";`
   - The menu lives in `TopBar` (separate from the router), so adding the route
     does **not** add a menu entry. `#/relief` is left untouched.

2. **`web/src/App.tsx`**
   - Add an early return, alongside the existing `mobile-upload` one:
     ```tsx
     if (route.name === "depthmaps") {
       return (
         <Suspense fallback={<PageFallback />}>
           <DepthMapsStandalone onNavigate={navigate} />
         </Suspense>
       );
     }
     ```
   - `DepthMapsStandalone` is `lazy()`-imported like the other pages (keeps the
     three.js-heavy Relief chunk out of the initial bundle).

3. **`web/src/pages/DepthMapsStandalone.tsx`** (new)
   - Props: `{ onNavigate: (r: Route) => void }`.
   - Layout: `<div className="flex flex-col h-screen">` → 56px header → `<ReliefPage/>`.
   - Header: reuse `ThemeToggle` from `ui`; the GitHub anchor is duplicated
     (~10 lines of inline SVG) so `TopBar` stays untouched; "Main App" button
     (`Button` from `ui`) calls `onNavigate({ name: "tests" })`.
   - `useEffect(() => { document.title = "Depth Maps"; }, [])`.
   - Renders `ReliefPage` **unchanged** — the 56px header makes its
     `calc(100dvh - 56px)` root fit perfectly (no ReliefPage edit needed).

### Data flow / error handling

All owned by `ReliefPage` (unchanged): upload → debounced `POST
/api/relief/smooth` → preview/export. The shell only navigates. No auth, no
extra API surface. Errors surface in `ReliefPage`'s existing error banner.

### Edge cases

- Direct hit `#/depthmaps` in `multi_user` mode → renders standalone, no gate. ✓
- "Main App" → `#/tests` → main app loads (and in `multi_user` shows the welcome
  gate, as normal). ✓
- Back/forward between `#/depthmaps` and the app — `useRoute` handles the
  hashchange; the early-return toggles. ✓
- Theme toggle works standalone (`initThemeEagerly` runs in `main.tsx`
  regardless; `ThemeToggle` is self-contained). ✓

## Testing

- `router.test.ts`: `parseRoute("#/depthmaps")` and `formatRoute` round-trip.
- `DepthMapsStandalone` test (mock `ReliefPage`): renders the `DEPTH MAPS`
  wordmark + "Main App" button; "Main App" calls `onNavigate({ name: "tests" })`;
  no `TopBar`/menu present.
- Browser: `#/depthmaps` loads with no menu/gate, the depth-map tool works
  (upload + smooth), GitHub link + theme toggle present, "Main App" returns to
  the app. Confirm `#/relief` (in-menu) still works unchanged.

## Out of scope

- No backend changes (the endpoint is already unauthenticated).
- No change to the in-app `#/relief` page or the menu.
- No separate auth/rate-limiting for the shared page (the endpoint's existing
  exposure is unchanged).
