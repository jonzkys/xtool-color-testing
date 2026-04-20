from __future__ import annotations

from xcs_gen_web.repositories import palette as repo
from xcs_gen_web.repositories import materials as m_repo


def _seed_material(name: str = "SS") -> int:
    return m_repo.create(name=name)["id"]


def test_insert_and_query(fresh_db):
    mid = _seed_material()
    repo.insert_bulk([
        dict(test_id=1, material_id=mid, x_value=500, y_value=None,
             hex="#ff0000", sigma=1.0, source="averaged", source_result_id=None,
             params={"power": 50}),
        dict(test_id=1, material_id=mid, x_value=600, y_value=None,
             hex="#00ff00", sigma=1.0, source="averaged", source_result_id=None,
             params={"power": 60}),
    ])
    results = repo.query_by_hex("#ff0101", limit=2, material_id=mid)
    assert results[0]["entry"]["hex"] == "#ff0000"
    assert results[0]["delta_e"] < results[1]["delta_e"]


def test_list_filter_by_material(fresh_db):
    m1 = _seed_material("A")
    m2 = _seed_material("B")
    repo.insert_bulk([dict(test_id=1, material_id=m1, x_value=0, y_value=None,
                           hex="#000000", sigma=0.0, source="averaged",
                           source_result_id=None, params={})])
    repo.insert_bulk([dict(test_id=2, material_id=m2, x_value=0, y_value=None,
                           hex="#111111", sigma=0.0, source="averaged",
                           source_result_id=None, params={})])
    assert [e["material_id"] for e in repo.list_all(material_id=m1)] == [m1]


def test_delete_by_test(fresh_db):
    mid = _seed_material()
    repo.insert_bulk([dict(test_id=7, material_id=mid, x_value=0, y_value=None,
                           hex="#abcdef", sigma=0.0, source="averaged",
                           source_result_id=None, params={})])
    repo.delete_by_test(7)
    assert repo.list_all() == []
