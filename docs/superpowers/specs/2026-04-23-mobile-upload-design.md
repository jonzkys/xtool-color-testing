# Mobile Upload (QR-paired phone camera)

**Date:** 2026-04-23
**Status:** Design approved, ready for implementation plan.

## Problem

Today, uploading a photo of a burned test is a desktop-only flow:
the user takes the photo on their phone, transfers it to their
computer (AirDrop, email, cloud sync, USB), then drag-and-drops or
file-picks it into `UploadResultDialog`. That extra hop is the slowest
part of the iterate-and-burn loop.

We want a one-tap path: scan a QR on the desktop with the phone,
shoot, done. The desktop should reflect the upload without a manual
refresh.

## Goals

- Desktop user can pair their phone in one action: open dialog, scan
  QR. No app install.
- Phone uploads land against the correct user **without** that user
  having to type their access key on the phone (so a screenshotted QR
  doesn't disclose account access).
- Mobile-id alone gates abuse (knowledge = access). A leaked mobile-id
  cannot exfiltrate data, only push photos in.
- Existing desktop upload flow is untouched.

## Non-goals

- No native mobile app. The mobile flow is a regular web page.
- No real-time push from server (no WebSocket / SSE). Desktop uses
  short polling while the QR dialog is open.
- No batch / multi-photo selection on mobile. One photo per tap. (The
  "Upload another" button covers multi-photo sessions.)
- No persistent mobile session: the page does not store an auth token.
  The mobile-id in the URL is the only credential.

## User flows

### Pairing + first upload

1. Desktop user clicks the existing **Upload test photo** button in
   the top bar.
2. Dialog opens with two tabs: **From this device** (existing flow)
   and **From phone** (new).
3. User clicks **From phone**. Desktop fetches the user's mobile-id
   (lazily generated server-side on first call) and renders a QR
   encoding `https://<app-origin>/m/<mobile_id>`.
4. User scans with phone camera. Phone opens the URL.
5. Mobile page validates the mobile-id, then shows a single big
   "Take or choose photo" affordance (a styled `<input type="file"
   accept="image/*" capture="environment">`). The OS handles the
   camera-vs-gallery picker natively.
6. User shoots. Photo POSTs to `/api/m/<mid>/upload`. Server runs the
   existing fiducial pipeline (same code path as
   `/api/results/upload`).
7. Phone shows a thumbnail + matched test name + **Continue on
   desktop** / **Upload another**.
8. Desktop poll surfaces the new upload as a card under the QR with a
   link to the test detail page.

### Subsequent uploads (mobile-id is persistent)

The mobile-id is generated once and reused. The same QR (or a
bookmarked mobile URL) keeps working until rotated. Rotating from
desktop instantly invalidates the old value.

## Architecture

### Backend

#### Data model

Add one column to `users`:

```
mobile_id  VARCHAR(32)  NULL  UNIQUE
```

- 24-char URL-safe random (`secrets.token_urlsafe(18)`).
- Nullable — only populated on first request, so existing users have
  no value until they open the dialog.
- Unique index supports fast `mobile_id → user` lookup on the upload
  hot path.

Add an Alembic migration that creates the column + index. (Reminder:
bump the hardcoded `alembic_version` assertion in
`ci.yml::mysql-migration-test` in the same commit.)

#### Endpoints

All under the existing FastAPI app in `src/xcs_gen_web/app.py`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/me/mobile-id` | `X-User-Id` | Return `{ mobile_id }`. Generate + persist if absent. |
| `POST` | `/api/me/mobile-id/rotate` | `X-User-Id` | Replace value. Old is rejected on the next request. |
| `GET`  | `/api/m/{mid}/check` | none | `{ ok: true, display_name }` if the mid resolves to a user, else 404. `display_name` is the user's library name and is shown as a greeting on the mobile page ("Uploading as **Jon**") so the phone-holder can confirm they're paired with the right account before they shoot. |
| `POST` | `/api/m/{mid}/upload` | none | Multipart photo. Resolves user, runs the existing fiducial pipeline. Returns `{ result_id, test_id, test_name }` on success, structured error on detection failure. |
| `GET`  | `/api/me/mobile-uploads/recent?since=<unix>` | `X-User-Id` | List uploads tied to my mobile-id since `since`. Used by desktop polling. |

The `/api/m/*` routes **must reject** `X-User-Id` (or simply ignore
it) — the mobile-id is the only accepted credential on those routes,
to keep the trust boundary clean.

The upload endpoint reuses the existing `capture_pipeline` code that
`/api/results/upload` already calls. The only delta is the auth
shim: resolve user from `mid`, then hand off.

#### Abuse limits

Per-mobile-id, enforced in middleware (extend the pattern already used
for `XCS_GEN_REGISTER_RATE_PER_HOUR` in `security.py`):

- 30 uploads/hour → 429
- 200 uploads/day → 429

Failed fiducial detections **count** against the budget — the work
cost is the same.

In-memory counters are fine for the alpha. If we move to multi-host
deployment, swap for Redis (out of scope here).

#### Security

- Mobile-id is a bearer token. Knowledge = access. No additional
  proof of identity is requested or accepted on `/api/m/*`.
- Rotation is a plain `UPDATE`. Because there is only one active
  value per user, the old value stops resolving immediately.
- Logs **must** truncate the mobile-id (e.g. `***last4`). Never log
  the full value, never include it in error messages echoed back to
  the client beyond the rotation/error UX needs.
- The mobile page is plain HTTPS in prod (existing deployment
  posture). No service worker, no localStorage of the mid — it stays
  in the URL only.

### Frontend

#### Desktop — extend `UploadResultDialog`

The existing `web/src/components/UploadResultDialog.tsx` becomes a
tabbed dialog:

- **From this device** — current behaviour, unchanged.
- **From phone** — new tab.

"From phone" tab structure:

```
+-------------------------------------------+
|  [QR code, ~220px]                         |
|                                            |
|  Scan with your phone camera.              |
|  Pictures land here automatically.         |
|                                            |
|  rotate code                               |
|                                            |
|  --- recent uploads ---                    |
|  [thumb] Speed test #4 — just now  Open >  |
+-------------------------------------------+
```

- QR is rendered locally with the `qrcode` npm package (no third-party
  service). QR encodes `${window.location.origin}/m/${mobile_id}`.
- The `rotate code` link calls the rotate endpoint and re-renders.
  Confirm-prompt the user — rotating breaks any phone that already
  has the old QR open.
- Polling: while the tab is mounted, call
  `/api/me/mobile-uploads/recent?since=<lastSeenTs>` every 3000ms.
  Cancel on tab unmount or dialog close.
- Each new upload renders as a card. Clicking **Open** navigates to
  the matching test detail page (existing route).

#### Mobile — new route `/m/:mid`

A new top-level route registered in `web/src/router.ts`. The page
sits **outside** the normal `TopBar` chrome — no nav, no account
menu, no other tabs. It is its own near-empty layout.

State machine:

```
loading        → GET /api/m/{mid}/check
   ↓ ok
idle           → big "Take or choose photo" button
   ↓ file picked
uploading      → spinner + filename
   ↓ 200          ↓ 4xx fiducial         ↓ 429              ↓ network
success         no_markers_error         rate_limited        try_again
```

- `success`: thumbnail (the file the user just picked, rendered
  client-side) + matched test name + **Continue on desktop** /
  **Upload another**.
- `no_markers_error`: "Couldn't find the test markers — try a
  clearer, well-lit photo." with **Try again** (returns to idle).
- `rate_limited`: "Too many uploads in the last hour. Try again in
  N minutes." (Server returns retry-after; the page just shows a
  rough number.)
- `try_again`: generic network error → **Retry** button.

Layout principles:

- One-handed thumb-friendly: primary action sits in the lower half of
  the viewport, large hit target.
- No autoplay of camera (the file input handles permission via the OS
  picker — no `getUserMedia`).
- Works fine offline-shown / cached, fails gracefully if no network.

## Data flow (sequence)

```
Desktop                          Server                          Phone
  |                                 |                              |
  |-- POST /api/me/mobile-id ------>|                              |
  |<------- { mobile_id } ----------|                              |
  | (renders QR)                    |                              |
  |                                 |                              |
  |                                 |<-- GET /m/<mid> -------------|
  |                                 |   (serves React shell)       |
  |                                 |<-- GET /api/m/<mid>/check ---|
  |                                 |---- { ok, display_name } --->|
  |                                 |                              |
  | -- (poll) GET recent?since= --->|                              |
  |<------ [] ----------------------|                              |
  |                                 |<-- POST /api/m/<mid>/upload -|
  |                                 |   (fiducial pipeline)        |
  |                                 |--- { result_id, test_id } -->|
  |                                 |                              |
  | -- (poll) GET recent?since= --->|                              |
  |<-- [{ result, test_name }] -----|                              |
  | (toast / card)                  |                              |
```

## Edge cases

- **Mobile-id is null when phone hits `/m/<mid>/upload`** — user
  rotated mid-upload. Server returns 404. Phone shows
  `no_longer_valid` page with re-scan instructions.
- **Two phones use the same QR concurrently** — fine. Both succeed
  (independently), both count against the same per-mid rate budget.
- **User opens the QR dialog without ever having logged in** —
  shouldn't happen (header only renders multi-user chrome when
  `mode === "multi_user"` and the user has an id), but guard the
  endpoint with the existing `X-User-Id` requirement.
- **Standalone mode** — there is no concept of users in standalone
  mode. The "From phone" tab should be hidden when
  `mode !== "multi_user"`.
- **Image too large** — existing `XCS_GEN_MAX_UPLOAD_BYTES` cap
  applies. Phone shows a clear error if exceeded.
- **Phone Safari camera permission denied** — file input falls back
  to gallery only. Page still works.
- **Desktop closes the dialog mid-upload** — phone upload still
  succeeds server-side. When the dialog is reopened, polling restarts
  from `since = now - 10 minutes` so any uploads that landed during
  the gap still surface as cards.
- **Clock skew between phone and server** — `since` is server-time;
  phone never participates in the polling. No skew.

## Testing

### Backend (pytest)

- `test_mobile_id_create_and_reuse` — first call generates, second
  call returns same value.
- `test_mobile_id_rotate_invalidates_old` — old mid 404s after
  rotate; new mid resolves.
- `test_mobile_upload_rejects_x_user_id` — `/api/m/{mid}/upload` does
  not allow elevation via `X-User-Id`.
- `test_mobile_upload_runs_fiducial_pipeline` — happy path produces a
  result row matched to the user that owns the mid.
- `test_mobile_upload_failed_detection_returns_400` — non-test photo
  yields a structured error, not 500.
- `test_mobile_upload_rate_limit_hourly` — 31st upload in an hour
  returns 429.
- `test_mobile_upload_rate_limit_daily` — 201st upload in a day
  returns 429.
- `test_mobile_id_logs_are_truncated` — log capture asserts full mid
  never appears.
- `test_recent_uploads_filters_by_since` — only mobile uploads tied
  to caller's mobile-id, after `since`, are returned.
- `test_recent_uploads_excludes_other_users` — multi-user isolation.

### Frontend (vitest)

- `QrCard` renders correct `https://.../m/<mid>` URL into the QR
  component.
- `MobilePage` state machine transitions for each branch (loading →
  idle → uploading → success/error).
- Rotate confirm-prompt fires before calling rotate endpoint.
- "From phone" tab hidden when `mode !== "multi_user"`.

### Manual

- Real iOS Safari: camera permission, capture, upload, success page.
- Real Android Chrome: same.
- Rotate while phone has the old QR loaded → next upload should fail
  cleanly.
- Burn-and-shoot loop: open dialog, scan, shoot 5 photos in
  succession, all surface as cards on desktop.

## Out of scope (follow-ups, if useful later)

- WebSocket / SSE push so the entire app (not just the dialog) reacts
  to mobile uploads in real time.
- A "pending uploads" inbox for photos where fiducial detection
  failed but the user still wants to attach manually.
- A QR on individual test pages that scopes the upload to just that
  test (skipping fiducial test-matching). Current design handles all
  tests via fiducial detection, which is good enough.
- Redis-backed rate counters for multi-host deployments.

## Files affected (rough)

**Backend**
- `alembic/versions/NNNN_users_mobile_id.py` (new)
- `src/xcs_gen_web/models.py` (add column)
- `src/xcs_gen_web/security.py` (per-mid rate limiter)
- `src/xcs_gen_web/app.py` (5 new endpoints, reuse existing pipeline)
- `src/xcs_gen_web/schemas.py` (response models)
- `tests/test_mobile_upload.py` (new)
- `.github/workflows/ci.yml` (bump `alembic_version` assertion)

**Frontend**
- `web/src/components/UploadResultDialog.tsx` (add tabs)
- `web/src/components/MobileQrTab.tsx` (new — QR + rotate + recent
  uploads list)
- `web/src/pages/MobileUploadPage.tsx` (new — the `/m/:mid` page)
- `web/src/router.ts` + `router.test.ts` (new route)
- `web/src/api/mobileUpload.ts` (new — typed fetch wrappers)
- `web/package.json` (add `qrcode` dep)
- Vitest specs alongside the new components

Remember to `npm run build` so `web/dist/` reflects frontend changes
(server mounts the built bundle).
