# Idempotent Palette Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `POST /api/tests/{tid}/ingest-to-palette` idempotent on natural identity so re-clicking the ingest button produces no duplicate `palette_entries` rows.

**Architecture:** App-level upsert inside `repositories/palette.py:insert_bulk`. For each input entry, SELECT for an existing row matching `(test_id, x_value, y_value, source, source_result_id, owner_id)` (NULL-safe equality on the nullable fields). If found, UPDATE the capture-derived columns in place; if not, INSERT as today. The user-curated columns (`notes`, `favorited`, `created_at`) are preserved across updates. `replace_for_test` stays unchanged as the destructive "scorched earth" path.

**Tech Stack:** Python 3, SQLAlchemy core, pytest. No DB migration. No frontend changes.

**Spec:** `docs/superpowers/specs/2026-04-27-palette-idempotent-ingest-design.md`

**Branch:** `feat/palette-idempotent-ingest` (already created from `main`; spec committed at SHA `f5c7524`).

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/xcs_gen_web/repositories/palette.py` | **Modify** `insert_bulk` (lines 100–116) | Replace the per-row `INSERT` loop with a SELECT-then-UPDATE-or-INSERT loop on natural identity. Update the function's docstring to match the new contract. |
| `tests/test_repo_palette.py` | **Append** 3 unit tests | TDD coverage: idempotency, refresh-but-preserve, distinct-source-result-id. |
| `tests/test_ingest_to_palette.py` | **Append** 1 integration test | Verify `POST /api/tests/{tid}/ingest-to-palette` is idempotent through the API surface. |

`replace_for_test` (`palette.py:119–142`) is intentionally left alone. The `_check_machine_matches_test` validation also stays unchanged.

---

## Task 1: TDD the idempotent upsert in `insert_bulk`

**Files:**
- Modify: `/Users/jonzky/Documents/XTools/Reverse/src/xcs_gen_web/repositories/palette.py` (lines 100–116, the `insert_bulk` function body + docstring)
- Test: append to `/Users/jonzky/Documents/XTools/Reverse/tests/test_repo_palette.py`

### 1.1: Append the three failing tests

Append to `/Users/jonzky/Documents/XTools/Reverse/tests/test_repo_palette.py`:

```python
def test_insert_bulk_is_idempotent_for_same_identity(fresh_db):
    """Calling insert_bulk twice with the same entries must produce
    the same rows — no duplicates. The second call returns the same
    ids as the first."""
    mid = _seed_material()
    entries = [
        dict(test_id=1, material_id=mid, x_value=500, y_value=None,
             hex="#ff0000", sigma=1.0, source="averaged",
             source_result_id=None, params={"power": 50}),
        dict(test_id=1, material_id=mid, x_value=600, y_value=None,
             hex="#00ff00", sigma=1.0, source="averaged",
             source_result_id=None, params={"power": 60}),
    ]
    first_ids = repo.insert_bulk(entries)
    second_ids = repo.insert_bulk(entries)
    assert first_ids == second_ids
    # Only the original two rows exist, not four.
    assert len(repo.list_all(material_id=mid)) == 2


def test_insert_bulk_refreshes_capture_fields_preserves_user_state(fresh_db):
    """A re-ingest with a different hex must update the row in place,
    refreshing hex/lab/sigma/params but preserving notes, favorited,
    and created_at."""
    mid = _seed_material()
    [rid] = repo.insert_bulk([
        dict(test_id=1, material_id=mid, x_value=500, y_value=None,
             hex="#aa0000", sigma=1.0, source="averaged",
             source_result_id=None, params={"power": 40}),
    ])
    # Mark the row favorited and add a note via the existing repo API.
    repo.set_favorited(rid, True)
    repo.update_entry(rid, notes="perfect for stainless 316")
    original = repo.get_by_id(rid)
    original_created_at = original["created_at"]

    # Re-ingest with a different hex + sigma + params.
    [rid_again] = repo.insert_bulk([
        dict(test_id=1, material_id=mid, x_value=500, y_value=None,
             hex="#bb1111", sigma=2.5, source="averaged",
             source_result_id=None, params={"power": 50}),
    ])
    assert rid_again == rid  # same row, refreshed in place
    refreshed = repo.get_by_id(rid)
    # Capture-derived fields refreshed:
    assert refreshed["hex"] == "#bb1111"
    assert refreshed["sigma"] == 2.5
    assert refreshed["params"] == {"power": 50}
    # lab_l should reflect the new hex (just check it changed).
    assert refreshed["lab"] != original["lab"]
    # User-curated state preserved:
    assert refreshed["notes"] == "perfect for stainless 316"
    assert refreshed["favorited"] is True
    assert refreshed["created_at"] == original_created_at


def test_insert_bulk_distinct_source_result_ids_stay_distinct(fresh_db):
    """Two rows with the same (test_id, x, y, source) but different
    source_result_id are DIFFERENT logical entries — they must not
    merge."""
    mid = _seed_material()
    [id_a] = repo.insert_bulk([
        dict(test_id=1, material_id=mid, x_value=500, y_value=None,
             hex="#aa0000", sigma=1.0, source="single_result",
             source_result_id=10, params={"power": 50}),
    ])
    [id_b] = repo.insert_bulk([
        dict(test_id=1, material_id=mid, x_value=500, y_value=None,
             hex="#bb0000", sigma=1.0, source="single_result",
             source_result_id=11, params={"power": 50}),
    ])
    assert id_a != id_b
    assert len(repo.list_all(material_id=mid)) == 2
    # Re-ingesting just one should refresh only that row.
    [id_a_again] = repo.insert_bulk([
        dict(test_id=1, material_id=mid, x_value=500, y_value=None,
             hex="#cc0000", sigma=1.0, source="single_result",
             source_result_id=10, params={"power": 50}),
    ])
    assert id_a_again == id_a
    rows = {e["id"]: e for e in repo.list_all(material_id=mid)}
    assert rows[id_a]["hex"] == "#cc0000"
    assert rows[id_b]["hex"] == "#bb0000"  # untouched
```

### 1.2: Run, expect FAIL

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_repo_palette.py::test_insert_bulk_is_idempotent_for_same_identity tests/test_repo_palette.py::test_insert_bulk_refreshes_capture_fields_preserves_user_state tests/test_repo_palette.py::test_insert_bulk_distinct_source_result_ids_stay_distinct -v
```

Expected: FAIL on the first test (`assert len(repo.list_all(material_id=mid)) == 2` fails — current behaviour gives 4 rows). The second test fails on `assert rid_again == rid` (a fresh INSERT produces a new id). The third test passes today *for the distinct-id assertion*, but fails on the refresh-only-one assertion (a re-ingest of `(id_a)` would currently insert a third row, not refresh).

### 1.3: Implement the upsert

In `/Users/jonzky/Documents/XTools/Reverse/src/xcs_gen_web/repositories/palette.py`, replace the existing `insert_bulk` function (currently lines 100–116) with:

```python
# Capture-derived columns refreshed on re-ingest; user-curated columns
# (notes, favorited, created_at) are preserved.
_REFRESH_COLUMNS = ("hex", "lab_l", "lab_a", "lab_b", "sigma", "params_json")


def _find_existing_id(s, row: dict[str, Any]) -> int | None:
    """Return the id of the existing palette_entries row whose natural
    identity matches ``row``, or None if none exists. Identity is
    (test_id, x_value, y_value, source, source_result_id, owner_id)
    with NULL-safe equality on the nullable fields."""
    cond = and_(
        palette_entries.c.test_id == row["test_id"],
        palette_entries.c.source == row["source"],
        palette_entries.c.owner_id == row["owner_id"],
        (
            palette_entries.c.x_value.is_(None)
            if row["x_value"] is None
            else palette_entries.c.x_value == row["x_value"]
        ),
        (
            palette_entries.c.y_value.is_(None)
            if row["y_value"] is None
            else palette_entries.c.y_value == row["y_value"]
        ),
        (
            palette_entries.c.source_result_id.is_(None)
            if row["source_result_id"] is None
            else palette_entries.c.source_result_id == row["source_result_id"]
        ),
    )
    existing = s.execute(
        select(palette_entries.c.id).where(cond).limit(1)
    ).one_or_none()
    return existing.id if existing else None


def insert_bulk(
    entries: Iterable[dict[str, Any]], *, owner_id: int = STANDALONE_USER_ID,
    visibility: str = DEFAULT_VISIBILITY,
) -> list[int]:
    """Idempotent upsert: for each entry, refresh the existing row whose
    natural identity matches if one exists, else insert a new row.

    Natural identity is (test_id, x_value, y_value, source,
    source_result_id, owner_id). On UPDATE only the capture-derived
    columns (hex, lab_*, sigma, params_json) are refreshed —
    user-curated columns (notes, favorited, created_at) are preserved
    so that ingest never silently destroys annotations or favourite
    stars.

    Returns the list of row ids (existing or newly-inserted) in input
    order, so callers can correlate ``ids[i]`` with ``entries[i]``.
    """
    entries = list(entries)
    now = _now()
    rows = [_build_row(e, now, owner_id, visibility) for e in entries]
    if not rows:
        return []
    with session_scope() as s:
        for e in entries:
            _check_machine_matches_test(s, e)
        ids: list[int] = []
        for row in rows:
            existing_id = _find_existing_id(s, row)
            if existing_id is not None:
                refresh_values = {col: row[col] for col in _REFRESH_COLUMNS}
                s.execute(
                    palette_entries.update()
                    .where(palette_entries.c.id == existing_id)
                    .values(**refresh_values)
                )
                ids.append(existing_id)
            else:
                res = s.execute(palette_entries.insert().values(**row))
                ids.append(res.inserted_primary_key[0])
        return ids
```

(The `_REFRESH_COLUMNS` tuple and the `_find_existing_id` helper go ABOVE the `insert_bulk` definition — i.e. between `_check_machine_matches_test` and `insert_bulk`.)

### 1.4: Run the new tests + the existing repo suite

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_repo_palette.py -v
```

Expected: ALL pass — pre-existing tests + the 3 new ones. If a pre-existing test breaks (most likely candidate: a test that expected fresh ids on every insert_bulk call), inspect carefully — the test may have been pinning behaviour that this change deliberately reverses. Stop and report rather than reflexively "fixing" it.

### 1.5: Stage

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add src/xcs_gen_web/repositories/palette.py tests/test_repo_palette.py
git status --short
```

Expected: 2 staged paths. NO commit yet (Task 3 is the commit).

---

## Task 2: API integration test for idempotency

**Files:**
- Test: append to `/Users/jonzky/Documents/XTools/Reverse/tests/test_ingest_to_palette.py`

### 2.1: Append the test

Append to `/Users/jonzky/Documents/XTools/Reverse/tests/test_ingest_to_palette.py`:

```python
def test_ingest_is_idempotent_through_api(fresh_db, monkeypatch, tmp_path):
    """Re-calling POST /api/tests/{tid}/ingest-to-palette with the
    same body must not produce duplicate palette rows."""
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_cap)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    c.post(f"/api/tests/{tid}/results",
           files={"image": ("x.png", b"fake", "image/png")})

    body = {"swatch_indices": [0, 1], "mode": "averaged"}
    c.post(f"/api/tests/{tid}/ingest-to-palette", json=body)
    c.post(f"/api/tests/{tid}/ingest-to-palette", json=body)

    entries = c.get(f"/api/palette?material_id={mid}").json()
    assert len(entries) == 2, (
        f"expected 2 entries after two identical ingest calls, got {len(entries)}"
    )
```

### 2.2: Run it

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_ingest_to_palette.py -v
```

Expected: ALL pass — pre-existing tests + the new one. (The new test passes because of Task 1's repo change, even though `app.py` is untouched.)

### 2.3: Stage

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add tests/test_ingest_to_palette.py
git status --short
```

Expected: 3 staged paths total (T1's 2 + T2's 1). NO commit.

---

## Task 3: Full sweep, commit, push, open PR

### 3.1: Run the full backend suite

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/ -q
```

Expected: all green. If anything regressed (most likely: a test elsewhere that relied on `insert_bulk` always creating fresh rows), stop and inspect — that's a meaningful behaviour expectation that this change reverses, not a bug to mask.

### 3.2: Commit

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git status --short  # confirm only T1+T2 files staged
git commit -m "$(cat <<'EOF'
fix(palette): idempotent insert_bulk on natural identity

Re-ingesting the same selection of swatches into the palette used to
create duplicate rows because insert_bulk did straight INSERTs with
no dedupe and palette_entries has no uniqueness constraint. Two
common paths to the bug: an impatient double-click on the ingest
button, and re-ingesting after re-running a result with a different
sample_aggregator.

Switch insert_bulk to upsert on
  (test_id, x_value, y_value, source, source_result_id, owner_id)
with NULL-safe equality on the nullable fields. On UPDATE only the
capture-derived columns (hex, lab_*, sigma, params_json) are refreshed
— user-curated columns (notes, favorited, created_at) are preserved
so ingest never silently stomps annotations or favourite stars.

replace_for_test stays as-is for the "scorched earth, restart from
nothing" path.

Tests cover three repo cases (idempotency, refresh-but-preserve,
distinct source_result_ids stay separate) plus one API integration
case (POST /ingest-to-palette twice with the same body produces
2 rows, not 4).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### 3.3: Push the branch

```bash
git push -u origin feat/palette-idempotent-ingest
```

### 3.4: Open a draft PR

```bash
gh pr create --draft --title "fix: idempotent palette ingest" --body "$(cat <<'EOF'
## Summary

\`POST /api/tests/{tid}/ingest-to-palette\` used to create duplicate \`palette_entries\` rows when called twice with the same body. Two common paths into the bug:

- impatient double-click on the ingest button;
- re-ingesting after re-running a result with a different sample_aggregator (PR #12), where the user expects the palette entry to refresh, not duplicate.

\`insert_bulk\` is now an idempotent upsert on natural identity \`(test_id, x_value, y_value, source, source_result_id, owner_id)\` with NULL-safe equality on the three nullable fields. On UPDATE only the capture-derived columns refresh (hex, lab_*, sigma, params_json); the user-curated columns (notes, favorited, created_at) are preserved.

\`replace_for_test\` is left untouched as the destructive "scorched earth" escape hatch.

No alembic migration. No frontend changes.

Spec: \`docs/superpowers/specs/2026-04-27-palette-idempotent-ingest-design.md\`. Plan: \`docs/superpowers/plans/2026-04-27-palette-idempotent-ingest.md\`.

## Test plan

- [x] \`uv run --active pytest tests/ -q\` is green.
- [x] 3 new repo unit tests cover idempotency, refresh-but-preserve, and distinct-source-result-id semantics.
- [x] 1 new API integration test confirms two identical \`POST /ingest-to-palette\` calls produce a single set of rows.
- [ ] **Manual browser check:** open a result, click "Ingest swatches" twice in quick succession. Verify the palette page shows each swatch only once, not duplicated.
- [ ] **Manual browser check:** ingest a swatch, mark it favorited / add a note in the palette, then re-ingest. Confirm the favorite + note are still there after the second ingest.

## Out of scope (parking lot)

- Alembic 0012 unique index + \`ON CONFLICT DO UPDATE\` for race-safety.
- One-shot SQL cleanup of duplicates already in prod.
- Splitting the API response into \`added\` + \`updated\` counts.
- Reconsidering the \`replace_existing\` toggle in the UI now that upsert covers most of its use cases.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 3.5: Watch CI and flip to ready when green

```bash
gh pr checks --watch
```

When all checks pass:

```bash
gh pr ready
```

If CI fails, do not flip. Most likely failure mode: a pre-existing test elsewhere that pins "insert_bulk always returns fresh ids". Investigate, push a fix commit on the same branch.

---

## Self-review notes

**Spec coverage:**

| Spec section | Task / step | ✓ |
|---|---|---|
| 1. Natural identity (6-field tuple, NULL-safe) | T1.3 (`_find_existing_id`) | ✓ |
| 2. Behaviour matrix (5 scenarios) | T1.1 (3 unit tests cover all 5) + T2.1 (API path) | ✓ |
| 3. Refreshed vs preserved fields | T1.3 (`_REFRESH_COLUMNS` tuple) + T1.1 second test asserts both | ✓ |
| 4. Implementation surface (`insert_bulk` upsert, `replace_for_test` untouched) | T1.3 | ✓ |
| 5. Ordering semantics (`ids[i]` correlates to `entries[i]`) | T1.3 (per-row append in input order) + T1.1 first test asserts `first_ids == second_ids` | ✓ |
| 6. Data flow (no endpoint contract change) | T2 verifies via the existing endpoint | ✓ |
| 7. Error handling (no new paths; existing `_check_machine_matches_test` still runs) | T1.3 keeps the validation loop | ✓ |
| 8. Testing (3 repo + 1 API) | T1.1 + T2.1 | ✓ |
| 9. Files touched (3 paths, no migration, no frontend) | T1 + T2 + T3 | ✓ |

**Type / name consistency:**

- `_REFRESH_COLUMNS` is the single source of truth for "what gets refreshed on UPDATE" — used in T1.3, asserted indirectly by T1.1's second test.
- `_find_existing_id` returns `int | None`. Caller uses `if existing_id is not None`, not `if existing_id` (avoids the `id == 0` trap, even though autoincrement primary keys never produce 0 in practice).
- All test fixtures (`fresh_db`, `_seed_material`, `repo`, `m_repo`, `t_repo`, `cap`, `_fake_cap`, `SPEC`, `BASE`) are pre-existing in the relevant test files and don't need creating.

**Placeholder scan:** no TODOs, no "TBD", no "implement later", every code block is complete and committable.
