"""Repository for text/registration default ProcessingParams.

Coverage:
- machine-level CRUD round-trip
- material-level CRUD round-trip
- material override wins over machine fallback
- machine fallback applies when no material override
- ``None`` return when neither is set
- owner scoping (different owner sees no rows)
"""

from __future__ import annotations

import pytest

from xcs_gen_web.repositories import (
    materials as m_repo,
    text_reg_defaults as repo,
)


_BASE_PARAMS = {
    "speed": 400,
    "power": 14.0,
    "density": 2566,
    "repeat": 1,
    "pulse_width": 80,
    "mopa_frequency": 90,
    "processing_light_source": "red",
}


def _alt(seed: int = 1) -> dict:
    """Distinct param set so equality checks don't pass by accident."""
    return {**_BASE_PARAMS, "speed": 400 + seed * 50, "power": 14.0 + seed}


def _seed_material(name: str = "M") -> int:
    return m_repo.create(name=name)["id"]


def test_machine_upsert_round_trips(fresh_db):
    mid = _seed_material()  # noqa: F841 — just to seed FK target
    row = repo.upsert_machine(machine_id="F2Ultra", params=_BASE_PARAMS)
    assert row["machine_id"] == "F2Ultra"
    assert row["speed"] == 400
    assert row["power"] == 14.0
    got = repo.get_machine(machine_id="F2Ultra")
    assert got is not None
    assert got["id"] == row["id"]


def test_machine_upsert_updates_existing(fresh_db):
    repo.upsert_machine(machine_id="F2Ultra", params=_BASE_PARAMS)
    updated = repo.upsert_machine(machine_id="F2Ultra", params=_alt(2))
    # Same row id (UPSERT, not duplicate insert).
    got = repo.get_machine(machine_id="F2Ultra")
    assert got is not None
    assert got["id"] == updated["id"]
    assert got["speed"] == 500
    assert got["power"] == 16.0


def test_material_override_round_trips(fresh_db):
    mid = _seed_material()
    repo.upsert_material(
        machine_id="F2Ultra", material_id=mid, params=_BASE_PARAMS,
    )
    got = repo.get_material(machine_id="F2Ultra", material_id=mid)
    assert got is not None
    assert got["material_id"] == mid


def test_material_override_wins_over_machine_default(fresh_db):
    mid = _seed_material()
    repo.upsert_machine(machine_id="F2Ultra", params=_BASE_PARAMS)
    repo.upsert_material(
        machine_id="F2Ultra", material_id=mid, params=_alt(3),
    )
    pp = repo.resolve_params(machine_id="F2Ultra", material_id=mid)
    assert pp is not None
    # Material override values, not machine fallback.
    assert pp.speed == 550
    assert pp.power == pytest.approx(17.0)


def test_machine_fallback_when_no_material_override(fresh_db):
    mid = _seed_material()
    repo.upsert_machine(machine_id="F2Ultra", params=_BASE_PARAMS)
    pp = repo.resolve_params(machine_id="F2Ultra", material_id=mid)
    assert pp is not None
    assert pp.speed == 400


def test_machine_fallback_when_material_id_none(fresh_db):
    repo.upsert_machine(machine_id="F2Ultra", params=_BASE_PARAMS)
    pp = repo.resolve_params(machine_id="F2Ultra", material_id=None)
    assert pp is not None
    assert pp.speed == 400


def test_resolve_returns_none_when_nothing_set(fresh_db):
    mid = _seed_material()
    pp = repo.resolve_params(machine_id="F2Ultra", material_id=mid)
    assert pp is None


def test_machine_scoped_per_machine(fresh_db):
    """A row for F2Ultra doesn't satisfy a request for F1Ultra."""
    repo.upsert_machine(machine_id="F2Ultra", params=_BASE_PARAMS)
    pp = repo.resolve_params(machine_id="F1Ultra", material_id=None)
    assert pp is None


def test_owner_scoped(fresh_db):
    """A different owner sees nothing of mine."""
    repo.upsert_machine(machine_id="F2Ultra", params=_BASE_PARAMS)
    assert repo.get_machine(owner_id=999, machine_id="F2Ultra") is None


def test_material_owner_scoped(fresh_db):
    mid = _seed_material()
    repo.upsert_material(
        machine_id="F2Ultra", material_id=mid, params=_BASE_PARAMS,
    )
    assert repo.get_material(
        owner_id=999, machine_id="F2Ultra", material_id=mid,
    ) is None


def test_delete_machine(fresh_db):
    repo.upsert_machine(machine_id="F2Ultra", params=_BASE_PARAMS)
    assert repo.delete_machine(machine_id="F2Ultra") is True
    assert repo.get_machine(machine_id="F2Ultra") is None
    # Idempotent — deleting again returns False.
    assert repo.delete_machine(machine_id="F2Ultra") is False


def test_delete_material(fresh_db):
    mid = _seed_material()
    repo.upsert_material(
        machine_id="F2Ultra", material_id=mid, params=_BASE_PARAMS,
    )
    assert repo.delete_material(
        machine_id="F2Ultra", material_id=mid,
    ) is True
    assert repo.get_material(
        machine_id="F2Ultra", material_id=mid,
    ) is None


def test_list_for_material_returns_per_machine_rows(fresh_db):
    mid = _seed_material()
    repo.upsert_material(
        machine_id="F2Ultra", material_id=mid, params=_BASE_PARAMS,
    )
    repo.upsert_material(
        machine_id="F1Ultra", material_id=mid, params=_alt(5),
    )
    rows = repo.list_for_material(material_id=mid)
    assert len(rows) == 2
    machines = {r["machine_id"] for r in rows}
    assert machines == {"F2Ultra", "F1Ultra"}


def test_material_cascade_delete(fresh_db):
    """When the source material is deleted, its overrides go with it
    (FK ON DELETE CASCADE)."""
    mid = _seed_material()
    repo.upsert_material(
        machine_id="F2Ultra", material_id=mid, params=_BASE_PARAMS,
    )
    m_repo.delete(mid)
    assert repo.get_material(
        machine_id="F2Ultra", material_id=mid,
    ) is None
