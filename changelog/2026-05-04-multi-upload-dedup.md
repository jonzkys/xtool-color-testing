---
id: 2026-05-04-multi-upload-dedup
date: 2026-05-04
level: major
title: Upload — drop a batch, identical re-uploads caught
summary: The upload dialog now accepts multiple files at once and dedups on SHA-256 — the same photo can't silently land twice in the same test, but a hard-deleted result can be re-uploaded any time.
---

The upload dialog used to be a one-photo-at-a-time funnel: pick a
file, watch the progress, get a result card, click "another" to
start over. Two failure modes piled up around it. First, batch days
— five test prints in a session, five trips through the modal.
Second, the same photo silently re-processed itself if you dropped it
twice while comparing two terminals.

Both fixed.

### What's new

**Multi-file upload.** Drop or browse a list of photos in one go.
Each file gets its own row with a thumbnail, filename, status, and
inline retry / remove actions. The pool runs three uploads in
parallel — enough to keep the backend's QR-and-warp pipeline busy
without thrashing it. As each file resolves the row settles into
one of four states:

- **Done** — the test the QR matched, with an "open" link
  straight into the test detail page.
- **Duplicate** — caught by SHA-256, surfaced as `duplicate of
  result #N`. The user can hard-delete the existing result and
  retry to re-process the same image.
- **Error** — the original error message (no QR detected, capture
  failed, etc.) with a retry button on the row.
- **In-flight** — primary spinner + "processing…" inline.

The bottom of the queue carries a summary: `5 files · 4 done ·
1 dup · 0 err`, plus an `Add more` drop target so you can extend
the queue without closing the dialog.

**SHA-256 dedup.** Backend computes the photo's hash before it runs
the capture pipeline. If a result with the same hash already exists
on the same test (excluded or not), the upload 409s with the
existing `result_id` in the detail. Hard-deleting the existing row
frees the hash, so the workflow `delete → re-upload` works without
ceremony. Dedup is **per-test** — the same photo legitimately
uploaded to two different tests doesn't conflict.

The preflight endpoint also surfaces the duplicate hint
(`duplicate_of_result_id`) so future clients can short-circuit
before sending the file twice.

### Why hash, not filename or upload time

A SHA-256 over the bytes is the cheapest signal that "these are the
same photo" — robust against renaming, identical across devices,
and computed in the same place that already hashes for storage.
Filename is unreliable (downloaders rename), upload time is
useless (you'd block legitimate retries). The backend stored
`image_sha256` already, so the cost was zero columns + one index
worth of work.

### Mobile path

The mobile upload page (the QR-code-on-desktop → take-photo-on-
phone flow) gets the same multi-file treatment: the gallery
picker accepts a batch, the queue runs two uploads in parallel
(cellular networks are flakier than desktop, so the cap is
lower), each row shows its status with the same green/amber/red
language. The 409 from the desktop's dedup is surfaced as
"Duplicate of #N" on the mobile row too. The "From phone" tab on
the desktop dialog is now always visible, not just in
multi-user mode — standalone users on a LAN can use their phone
just as easily.

### Tests

Five new pytest cases cover: same-test 409, deleted-then-retry
ok, excluded duplicates still 409, distinct-tests-not-conflated,
and auto-route 409. Existing rate-limit + recent-uploads tests
were updated to use distinct payloads — they always intended to
test rate-limiting / source classification, never dedup.
