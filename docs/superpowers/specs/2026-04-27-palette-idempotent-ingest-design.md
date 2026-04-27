# Idempotent palette ingest

**Date:** 2026-04-27
**Status:** design — pending implementation plan
**Surface area:** `src/xcs_gen_web/repositories/palette.py`. Tests in
`tests/test_palette_repo.py` (or wherever the existing palette ingest
tests live — verify at implementation time).

## Goal

Re-running "ingest swatches" from the result-detail dialog currently
produces duplicate `palette_entries` rows for the same logical swatch
— `insert_bulk` does straight INSERTs with no dedupe, and the
`palette_entries` table has no uniqueness constraint to catch them.
Users hit this by clicking the ingest button twice (impatient first
click) or by re-ingesting after re-running the result with a different
aggregator.

This spec makes the ingest **idempotent on natural identity**: the
second click produces the same row count as the first, with the
capture-derived fields refreshed in place.

## Non-goals

- DB-level unique index + `ON CONFLICT DO UPDATE`. Race-safe and
  schema-correct, but requires alembic 0012 plus migration logic to
  dedupe pre-existing rows before the index can be added. App-level
  upsert is enough for the single-user-mostly workload today; the DB
  constraint can come later if concurrency ever bites.
- Cleaning up pre-existing duplicate rows in the prod database.
  Out of scope; can be a separate one-shot ticket.
- Changing the `replace_existing` toggle in the UI. Stays as the
  "scorched earth — wipe all entries from this test, start fresh"
  escape hatch. Most users won't need to click it after this PR, but
  removing it would be a separate UX call.
- UI changes. The toggle stays in `ResultsPanel`'s ingest dialog as
  it is.

## Design

### 1. Natural identity

A palette entry's "this is the same logical swatch" identity is:

```
(test_id, x_value, y_value, source, source_result_id, owner_id)
```

- `test_id` — the test the swatch came from.
- `x_value`, `y_value` — the parameter coordinates within the test.
  `y_value` is `NULL` for 1D-axis tests (`y_param=None`).
- `source` — `"averaged"` or `"single_result"` (or `"manual"` for
  hand-authored entries from PR #8, which this design treats the same
  way: a manual entry with the same x/y won't be merged into an
  ingest because `source` differs).
- `source_result_id` — `NULL` for averaged-mode entries, the result
  id for `single_result`-mode.
- `owner_id` — multi-user scoping (always equal to the caller for
  ingest paths, but the WHERE clause includes it defensively).

NULL-safe equality is required for `x_value`, `y_value`, and
`source_result_id` because all three can legitimately be `NULL`.
SQLAlchemy expresses this with `is_(None)` in the conditional.

### 2. Behaviour matrix

| Scenario | Identity comparison | Outcome |
|---|---|---|
| Same averaged ingest, twice | All 6 fields equal | UPDATE in place (refresh hex/lab/sigma/params) |
| Re-ingest after aggregator change | All 6 equal | UPDATE in place |
| Ingest from a *different* result for same x/y | `source_result_id` differs | INSERT (distinct row) |
| Averaged + single-result for same x/y | `source` differs | INSERT (distinct row) |
| Manual entry + ingest for same x/y | `source` differs | INSERT (distinct row) |

### 3. Field semantics on UPDATE

When an existing row is found, the UPDATE refreshes the
**capture-derived** fields and preserves the **user-curated** fields.

**Refreshed:**
- `hex`
- `lab_l`, `lab_a`, `lab_b`
- `sigma`
- `params_json`

**Preserved (NOT touched on update):**
- `notes` — user free-form text. Stomping it would silently destroy
  annotations like "perfect match for stainless 316".
- `favorited` — added in PR #8 (manual favorites). A manually starred
  entry must not be unstarred by an upsert.
- `created_at` — represents when the entry first joined the palette,
  not when it was last refreshed. Don't touch.

### 4. Implementation surface

`repositories/palette.py:insert_bulk` becomes upsert:

```python
def insert_bulk(
    entries: Iterable[dict[str, Any]],
    *,
    owner_id: int = STANDALONE_USER_ID,
    visibility: str = DEFAULT_VISIBILITY,
) -> list[int]:
    """For each entry, UPDATE the existing palette row that matches the
    entry's natural identity (test_id, x_value, y_value, source,
    source_result_id, owner_id) if one exists, else INSERT a new row.

    Returns the list of row ids (existing or new) in input order.

    Refreshes the capture-derived fields (hex, lab_*, sigma,
    params_json) on update; preserves user-curated state (notes,
    favorited, created_at).
    """
```

Per row inside one transaction:

1. SELECT id FROM palette_entries WHERE
   `test_id = :tid` AND
   `x_value` matches (`= :xv` if not None, `IS NULL` if None) AND
   `y_value` matches (same) AND
   `source = :src` AND
   `source_result_id` matches (same) AND
   `owner_id = :uid`
   LIMIT 1.
2. If found → UPDATE that row's hex/lab/sigma/params_json.
3. If not → INSERT (existing path, unchanged).

`replace_for_test` is **kept as-is** — still does a destructive
delete-then-insert. Intent is unchanged: "scorched earth, restart from
nothing." Documented as such in its docstring.

The existing `_check_machine_matches_test` validation still runs
before any DB write.

### 5. Ordering semantics

Today, `insert_bulk` returns ids in input order so the caller can
correlate. The new behaviour preserves this — for each input entry
the returned list contains the matching row's id (whether that's an
existing id or a freshly-inserted one). The caller's mental model
("ids[i] is the palette entry for entries[i]") is unchanged.

### 6. Data flow

**Single ingest call:**

```
POST /api/tests/{tid}/ingest-to-palette
  → tests_ingest_to_palette()
  → builds payload list (one dict per swatch)
  → if replace_existing: pal_repo.replace_for_test(...)   ← unchanged path
  → else:                pal_repo.insert_bulk(payload)    ← now upserts
  → returns { "added": len(ids), "ids": [...] }
```

The endpoint contract doesn't change. `added` keeps its current
meaning ("count of rows touched"), even though some of them may have
been refreshed in place rather than created. A future minor revision
could split this into `added` + `updated`, but that's out of scope.

### 7. Error handling

No new error paths. The existing `_check_machine_matches_test`
guard-rail still triggers `ValueError` if any entry's machine_id
doesn't match the test's machine_id. SQLAlchemy errors bubble as
500s as today.

### 8. Testing

Three new integration tests in `tests/test_palette_repo.py` (or
wherever the existing palette repo tests live; verify with
`grep -l "insert_bulk\|palette_entries" tests/`):

1. **`test_insert_bulk_is_idempotent_for_same_identity`** — call
   `insert_bulk` twice with identical entries; assert the row count
   in `palette_entries` matches `len(entries)`, not `2 * len(entries)`.
   Assert the ids returned by the second call equal the ids from the
   first call.

2. **`test_insert_bulk_refreshes_capture_fields_preserves_user_state`** —
   insert a row, then mark it favorited and add a note via direct DB
   update. Re-call `insert_bulk` with a modified hex (and slightly
   different lab/sigma) for the same identity. Assert: the row's
   `hex` updated, but `notes`, `favorited`, and `created_at` are
   unchanged.

3. **`test_insert_bulk_distinct_source_result_ids_are_separate_rows`** —
   insert two rows with the same `(test_id, x_value, y_value, source)`
   but different `source_result_id`; assert both rows exist (no merge).
   Then re-insert one of them — assert only that row updates, not both.

Plus extending the existing API integration test in
`tests/test_palette_api.py` (or similar, if present): re-call
`POST /api/tests/{tid}/ingest-to-palette` with the same body twice
and assert the post-call row count is unchanged after the second
call.

### 9. Files touched

| Path | Action |
|---|---|
| `src/xcs_gen_web/repositories/palette.py` | Rewrite `insert_bulk` body to upsert; update its docstring; leave `replace_for_test` untouched (just clarify its scorched-earth semantics in the docstring). |
| `tests/test_palette_repo.py` (or equivalent) | Add the 3 new tests. |
| `tests/test_palette_api.py` (or `tests/test_results_api.py`) | Extend an existing ingest test to verify the API surface is now idempotent. |

No alembic migration. No frontend changes. No changelog entry — this
is a bugfix to a quiet behaviour, not a user-visible feature; the UI
stays the same.

## Risks / open questions

- **Test file location.** Verify the palette repo tests live in
  `tests/test_palette_repo.py` (or `tests/test_repo_palette.py`) at
  implementation time. Implementation step 1 should grep:
  `grep -ln "insert_bulk" tests/` to find the right file.
- **Single transaction.** Both the SELECT and the conditional
  UPDATE/INSERT for each entry happen inside one `session_scope()`
  context, mirroring how `replace_for_test` already wraps its delete
  + bulk insert. This prevents partial writes if any row's
  `_check_machine_matches_test` validation fails mid-batch.
- **Performance.** N entries → N SELECTs + N writes. Today's largest
  ingest is ~80 swatches per click; ~80 round trips inside one
  transaction is sub-100ms even on prod. If a future bulk-ingest
  feature ships at 1000+ entries, batch the SELECT into a single
  query then do the writes.
- **Race condition.** Two concurrent ingest calls with the same
  identity could both SELECT-miss and both INSERT, producing two
  rows. In a single-user-mostly workload this is vanishingly
  unlikely. The DB-level fix (unique index + `ON CONFLICT`) is the
  right long-term answer; deferred to a follow-up.

## Out of scope follow-ups (parking lot)

- Alembic 0012: unique index on
  `(test_id, x_value, y_value, source, source_result_id, owner_id)`
  with NULL-aware semantics, plus a migration that dedupes existing
  rows before adding the index. Race-safe upsert with `ON CONFLICT`.
- One-shot SQL cleanup of duplicates already in prod
  (`DELETE … WHERE id NOT IN (MIN(id) GROUP BY identity)`).
- Split the API response into `added` + `updated` counts.
- Reconsider the `replace_existing` toggle in the UI now that
  upsert covers most of its use cases.
