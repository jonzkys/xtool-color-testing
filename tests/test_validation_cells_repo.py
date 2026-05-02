"""Validation-cells repo: insert a batch keyed to a test, fetch back
ordered by cell_index, replace on update, cascade-clear on test delete."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import insert

from xcs_gen_web.db import session_scope
from xcs_gen_web.models import materials, tests
from xcs_gen_web.repositories import validation_cells as vc_repo


def _make_test(*, owner_id: int = 1) -> int:
    """Insert a parent material + a kind=validation test, return the
    test id. Uses raw inserts so this test doesn't depend on the tests
    repo growing a ``kind=`` parameter (Task 4 of the plan)."""
    now = datetime.now(timezone.utc).isoformat()
    with session_scope() as s:
        mres = s.execute(
            insert(materials).values(
                name="V-Material", notes="", created_at=now,
                owner_id=owner_id, visibility="private",
            ),
        )
        mid = int(mres.inserted_primary_key[0])
        tres = s.execute(
            insert(tests).values(
                name="V", material_id=mid, status="created",
                spec_json="{}", notes="",
                created_at=now, updated_at=now,
                owner_id=owner_id, visibility="private",
                kind="validation",
            ),
        )
        return int(tres.inserted_primary_key[0])


def test_replace_for_test_keeps_order(fresh_db):
    tid = _make_test()
    rows = [
        {
            "cell_index": i,
            "palette_entry_id": None,
            "expected_hex": f"#{i:02x}0000",
            "expected_lab": [50.0 + i, 0.0, 0.0],
            "params": {"power": 10, "speed": 1000},
        }
        for i in range(3)
    ]
    vc_repo.replace_for_test(test_id=tid, cells=rows)

    fetched = vc_repo.list_for_test(test_id=tid)
    assert [c["cell_index"] for c in fetched] == [0, 1, 2]
    assert fetched[0]["expected_hex"] == "#000000"
    assert fetched[2]["expected_lab"] == [52.0, 0.0, 0.0]
    assert fetched[1]["params"] == {"power": 10, "speed": 1000}


def test_replace_overwrites_previous(fresh_db):
    tid = _make_test()
    vc_repo.replace_for_test(test_id=tid, cells=[
        {"cell_index": 0, "palette_entry_id": None, "expected_hex": "#abc",
         "expected_lab": [50.0, 0.0, 0.0], "params": {}},
    ])
    vc_repo.replace_for_test(test_id=tid, cells=[
        {"cell_index": 0, "palette_entry_id": None, "expected_hex": "#cba",
         "expected_lab": [60.0, 0.0, 0.0], "params": {}},
        {"cell_index": 1, "palette_entry_id": None, "expected_hex": "#def",
         "expected_lab": [70.0, 0.0, 0.0], "params": {}},
    ])
    fetched = vc_repo.list_for_test(test_id=tid)
    assert len(fetched) == 2
    assert fetched[0]["expected_hex"] == "#cba"


def test_delete_for_test(fresh_db):
    tid = _make_test()
    vc_repo.replace_for_test(test_id=tid, cells=[
        {"cell_index": 0, "palette_entry_id": None, "expected_hex": "#000",
         "expected_lab": [50.0, 0.0, 0.0], "params": {}},
    ])
    vc_repo.delete_for_test(test_id=tid)
    assert vc_repo.list_for_test(test_id=tid) == []
