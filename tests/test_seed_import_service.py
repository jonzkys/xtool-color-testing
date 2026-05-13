"""Tests for the seed-import service.

Covers preview counts, idempotency guards, basic + FK-remapped copies,
and the self-referential-FK pass-2 patch behaviour for tests and
palette entries. Image bytes are NOT exercised here — that's B3.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from sqlalchemy import and_, select

from xcs_gen_web.db import session_scope
from xcs_gen_web.models import (
    materials as materials_t,
    palette_entries as palette_t,
    presets as presets_t,
    results as results_t,
    saved_spectrums as saved_spectrums_t,
    saved_spectrum_swatches as saved_spectrum_swatches_t,
    saved_spectrum_fit_coefficients as saved_spectrum_fits_t,
    tests as tests_t,
    text_reg_defaults_machine as trd_machine_t,
    text_reg_defaults_material as trd_material_t,
    validation_cells as vc_t,
)
from xcs_gen_web.services.seed_import import (
    SEED_IMPORT_SOURCE,
    AlreadyImportedError,
    EmptySeedError,
    SameUserError,
    preview,
    run_import,
)

SRC = 1
DST = 2


# ── Low-level seed helpers — write directly via SQLA Core so the tests
#    don't depend on every repo's invariants (some repos auto-bump
#    fields we don't want set on a seed row). ────────────────────────


def _now() -> str:
    return "2026-05-12T00:00:00+00:00"


def _seed_material(owner_id: int, name: str = "Stainless") -> int:
    with session_scope() as s:
        res = s.execute(
            materials_t.insert().values(
                name=name,
                notes="seed-test",
                created_at=_now(),
                owner_id=owner_id,
                visibility="private",
            )
        )
        return int(res.inserted_primary_key[0])


def _seed_preset(owner_id: int, material_id: int, name: str = "p1") -> int:
    with session_scope() as s:
        res = s.execute(
            presets_t.insert().values(
                material_id=material_id,
                name=name,
                color="#aabbcc",
                is_default=0,
                base_params_json=json.dumps({"power": 50}),
                created_at=_now(),
                updated_at=_now(),
                owner_id=owner_id,
                visibility="private",
                machine_id="F2Ultra",
            )
        )
        return int(res.inserted_primary_key[0])


def _seed_test(
    owner_id: int,
    material_id: int,
    name: str = "t1",
    source_test_id: int | None = None,
    parent_test_id: int | None = None,
    kind: str = "sweep",
) -> int:
    with session_scope() as s:
        res = s.execute(
            tests_t.insert().values(
                name=name,
                material_id=material_id,
                status="created",
                spec_json="{}",
                notes="",
                created_at=_now(),
                updated_at=_now(),
                locked=0,
                owner_id=owner_id,
                visibility="private",
                retest_index=0,
                machine_id="F2Ultra",
                kind=kind,
                source_test_id=source_test_id,
                parent_test_id=parent_test_id,
            )
        )
        return int(res.inserted_primary_key[0])


def _seed_result(
    owner_id: int,
    test_id: int,
    sha: str = "ab" * 32,
    *,
    image_path: str = "/tmp/seed.jpg",
    warped_image_path: str | None = None,
) -> int:
    with session_scope() as s:
        res = s.execute(
            results_t.insert().values(
                test_id=test_id,
                uploaded_at=_now(),
                image_path=image_path,
                image_sha256=sha,
                excluded=0,
                notes="",
                swatches_json="[]",
                owner_id=owner_id,
                visibility="private",
                via="desktop",
                retest_index=0,
                missing_markers_json="[]",
                warped_image_path=warped_image_path,
            )
        )
        return int(res.inserted_primary_key[0])


def _seed_palette_entry(
    owner_id: int,
    material_id: int,
    *,
    test_id: int | None = None,
    source_result_id: int | None = None,
    derived_from_entry_id: int | None = None,
    hex_: str = "#112233",
) -> int:
    with session_scope() as s:
        res = s.execute(
            palette_t.insert().values(
                test_id=test_id,
                material_id=material_id,
                x_value=1.0,
                y_value=None,
                hex=hex_,
                lab_l=50.0,
                lab_a=0.0,
                lab_b=0.0,
                params_json="{}",
                sigma=0.0,
                source="averaged",
                source_result_id=source_result_id,
                notes="",
                created_at=_now(),
                owner_id=owner_id,
                visibility="private",
                favorited=False,
                machine_id="F2Ultra",
                is_validated=False,
                derived_from_entry_id=derived_from_entry_id,
            )
        )
        return int(res.inserted_primary_key[0])


def _seed_validation_cell(
    test_id: int,
    cell_index: int,
    palette_entry_id: int | None,
) -> int:
    with session_scope() as s:
        res = s.execute(
            vc_t.insert().values(
                test_id=test_id,
                cell_index=cell_index,
                palette_entry_id=palette_entry_id,
                expected_hex="#abcdef",
                expected_lab_l=50.0,
                expected_lab_a=0.0,
                expected_lab_b=0.0,
                params_json="{}",
            )
        )
        return int(res.inserted_primary_key[0])


def _seed_saved_spectrum(
    owner_id: int,
    test_id: int | None,
    material_id: int | None,
) -> int:
    with session_scope() as s:
        res = s.execute(
            saved_spectrums_t.insert().values(
                name="ss1",
                source_test_id=test_id,
                machine_id="F2Ultra",
                material_id=material_id,
                owner_id=owner_id,
                axis_param="speed",
                axis_min=0.0,
                axis_max=1000.0,
                fit_form="polynomial",
                fit_degree=2,
                fit_l_r2=0.9,
                fit_a_r2=0.9,
                fit_b_r2=0.9,
                fit_r2_min=0.9,
                displayed_projection="L",
                lab_l_min=0.0,
                lab_l_max=100.0,
                lab_a_min=-10.0,
                lab_a_max=10.0,
                lab_b_min=-10.0,
                lab_b_max=10.0,
                lab_l_centroid=50.0,
                lab_a_centroid=0.0,
                lab_b_centroid=0.0,
                created_at=_now(),
            )
        )
        sid = int(res.inserted_primary_key[0])
        # One child of each kind so we can verify cascade-copy works.
        s.execute(
            saved_spectrum_swatches_t.insert().values(
                saved_spectrum_id=sid,
                swatch_row=0,
                swatch_col=0,
                x_value=100.0,
                hex="#001122",
                lab_l=50.0,
                lab_a=0.0,
                lab_b=0.0,
            )
        )
        s.execute(
            saved_spectrum_fits_t.insert().values(
                saved_spectrum_id=sid,
                channel="l",
                degree=0,
                coeff=1.23,
            )
        )
        return sid


def _seed_text_reg_machine(owner_id: int) -> None:
    with session_scope() as s:
        s.execute(
            trd_machine_t.insert().values(
                owner_id=owner_id,
                machine_id="F2Ultra",
                speed=500,
                power=50.0,
                density=200,
                repeat=1,
                pulse_width=200,
                mopa_frequency=60,
                processing_light_source="red",
                created_at=_now(),
                updated_at=_now(),
            )
        )


def _seed_text_reg_material(owner_id: int, material_id: int) -> None:
    with session_scope() as s:
        s.execute(
            trd_material_t.insert().values(
                owner_id=owner_id,
                machine_id="F2Ultra",
                material_id=material_id,
                speed=400,
                power=40.0,
                density=180,
                repeat=2,
                pulse_width=200,
                mopa_frequency=60,
                processing_light_source="red",
                created_at=_now(),
                updated_at=_now(),
            )
        )


def _list_rows(table, *, owner_id: int | None = None) -> list[Any]:
    with session_scope() as s:
        q = select(table)
        if owner_id is not None:
            q = q.where(table.c.owner_id == owner_id)
        return list(s.execute(q).all())


# ── preview ────────────────────────────────────────────────────────────


def test_preview_empty_seed(fresh_db):
    p = preview(SRC, DST)
    assert p.src_owner_id == SRC and p.dst_owner_id == DST
    assert p.materials == 0
    assert p.tests == 0
    assert p.results == 0
    assert p.palette_entries == 0
    assert p.presets == 0
    assert p.saved_spectrums == 0
    assert p.already_imported is False
    assert p.src_has_data is False


def test_preview_non_empty_seed(fresh_db):
    m1 = _seed_material(SRC, "A")
    m2 = _seed_material(SRC, "B")
    t1 = _seed_test(SRC, m1, name="t1")
    _seed_test(SRC, m1, name="t2")
    _seed_test(SRC, m2, name="t3")
    _seed_result(SRC, t1)
    p = preview(SRC, DST)
    assert p.materials == 2
    assert p.tests == 3
    assert p.results == 1
    assert p.src_has_data is True
    assert p.already_imported is False


def test_preview_already_imported(fresh_db):
    _seed_material(SRC, "A")
    # Plant a dst row that mimics a previous import.
    with session_scope() as s:
        s.execute(
            materials_t.insert().values(
                name="X",
                notes="",
                created_at=_now(),
                owner_id=DST,
                visibility="private",
                import_source=SEED_IMPORT_SOURCE,
            )
        )
    p = preview(SRC, DST)
    assert p.already_imported is True


# ── run_import — core copy paths ─────────────────────────────────────────


def test_run_import_simple_materials_only(fresh_db):
    _seed_material(SRC, "A")
    _seed_material(SRC, "B")
    res = run_import(SRC, DST)
    assert res.materials == 2
    assert res.tests == 0
    dst_rows = _list_rows(materials_t, owner_id=DST)
    assert len(dst_rows) == 2
    for row in dst_rows:
        assert row.import_source == SEED_IMPORT_SOURCE
        assert row.owner_id == DST
    # New ids — different from the source's.
    src_ids = {r.id for r in _list_rows(materials_t, owner_id=SRC)}
    dst_ids = {r.id for r in dst_rows}
    assert not (src_ids & dst_ids)


def test_run_import_remaps_test_to_new_material_id(fresh_db):
    m_src = _seed_material(SRC, "A")
    _seed_test(SRC, m_src)
    run_import(SRC, DST)
    src_m = [r for r in _list_rows(materials_t, owner_id=SRC)][0]
    dst_m = [r for r in _list_rows(materials_t, owner_id=DST)][0]
    dst_t = [r for r in _list_rows(tests_t, owner_id=DST)][0]
    assert dst_t.material_id == dst_m.id
    assert dst_t.material_id != src_m.id


def test_run_import_remaps_self_referencing_tests(fresh_db):
    m = _seed_material(SRC, "A")
    a = _seed_test(SRC, m, name="A")
    b = _seed_test(SRC, m, name="B", source_test_id=a, parent_test_id=a)
    run_import(SRC, DST)
    dst_tests = {r.name: r for r in _list_rows(tests_t, owner_id=DST)}
    assert dst_tests["A"].source_test_id is None
    assert dst_tests["A"].parent_test_id is None
    assert dst_tests["B"].source_test_id == dst_tests["A"].id
    assert dst_tests["B"].parent_test_id == dst_tests["A"].id
    # New ids are distinct from src ids.
    assert dst_tests["A"].id != a
    assert dst_tests["B"].id != b


def test_run_import_copies_validation_cells_with_remapped_test_id(fresh_db):
    m = _seed_material(SRC, "A")
    t = _seed_test(SRC, m, name="val", kind="validation")
    for i in range(3):
        _seed_validation_cell(t, i, palette_entry_id=None)
    run_import(SRC, DST)
    dst_test = [r for r in _list_rows(tests_t, owner_id=DST)][0]
    with session_scope() as s:
        dst_cells = s.execute(
            select(vc_t).where(vc_t.c.test_id == dst_test.id)
        ).all()
        src_cells = s.execute(
            select(vc_t).where(vc_t.c.test_id == t)
        ).all()
    assert len(dst_cells) == 3
    assert len(src_cells) == 3  # source untouched
    assert {c.cell_index for c in dst_cells} == {0, 1, 2}


def test_run_import_remaps_palette_entries_full_fk_set(fresh_db):
    m = _seed_material(SRC, "A")
    t = _seed_test(SRC, m)
    r = _seed_result(SRC, t)
    pe = _seed_palette_entry(
        SRC, m, test_id=t, source_result_id=r,
    )
    run_import(SRC, DST)
    dst_m = [r for r in _list_rows(materials_t, owner_id=DST)][0]
    dst_t = [r for r in _list_rows(tests_t, owner_id=DST)][0]
    dst_r = [r for r in _list_rows(results_t, owner_id=DST)][0]
    dst_pe = [r for r in _list_rows(palette_t, owner_id=DST)][0]
    assert dst_pe.material_id == dst_m.id
    assert dst_pe.test_id == dst_t.id
    assert dst_pe.source_result_id == dst_r.id
    # None of them should equal the source ids.
    assert dst_pe.id != pe


def test_run_import_remaps_palette_self_ref(fresh_db):
    m = _seed_material(SRC, "A")
    pa = _seed_palette_entry(SRC, m, hex_="#aa0000")
    _seed_palette_entry(
        SRC, m, derived_from_entry_id=pa, hex_="#bb0000",
    )
    run_import(SRC, DST)
    rows = {r.hex: r for r in _list_rows(palette_t, owner_id=DST)}
    assert rows["#aa0000"].derived_from_entry_id is None
    assert rows["#bb0000"].derived_from_entry_id == rows["#aa0000"].id
    # Source untouched.
    src_rows = {r.hex: r for r in _list_rows(palette_t, owner_id=SRC)}
    assert src_rows["#bb0000"].derived_from_entry_id == pa


def test_run_import_remaps_validation_cell_palette_fk(fresh_db):
    m = _seed_material(SRC, "A")
    t = _seed_test(SRC, m, name="val", kind="validation")
    pe = _seed_palette_entry(SRC, m)
    _seed_validation_cell(t, 0, palette_entry_id=pe)
    run_import(SRC, DST)
    dst_test = [r for r in _list_rows(tests_t, owner_id=DST)][0]
    dst_pe = [r for r in _list_rows(palette_t, owner_id=DST)][0]
    with session_scope() as s:
        dst_cell = s.execute(
            select(vc_t).where(
                and_(vc_t.c.test_id == dst_test.id, vc_t.c.cell_index == 0)
            )
        ).one()
    assert dst_cell.palette_entry_id == dst_pe.id
    assert dst_cell.palette_entry_id != pe


def test_run_import_already_imported_raises(fresh_db):
    _seed_material(SRC, "A")
    run_import(SRC, DST)
    with pytest.raises(AlreadyImportedError):
        run_import(SRC, DST)


def test_run_import_empty_seed_raises(fresh_db):
    with pytest.raises(EmptySeedError):
        run_import(SRC, DST)


def test_run_import_same_user_raises(fresh_db):
    _seed_material(SRC, "A")
    with pytest.raises(SameUserError):
        run_import(SRC, SRC)


def test_run_import_does_not_touch_source(fresh_db):
    m = _seed_material(SRC, "A")
    t = _seed_test(SRC, m, name="t1")
    _seed_palette_entry(SRC, m, test_id=t)
    src_materials_before = _list_rows(materials_t, owner_id=SRC)
    src_tests_before = _list_rows(tests_t, owner_id=SRC)
    src_palette_before = _list_rows(palette_t, owner_id=SRC)
    run_import(SRC, DST)
    src_materials_after = _list_rows(materials_t, owner_id=SRC)
    src_tests_after = _list_rows(tests_t, owner_id=SRC)
    src_palette_after = _list_rows(palette_t, owner_id=SRC)
    # Same ids, same row count.
    assert {r.id for r in src_materials_before} == {
        r.id for r in src_materials_after
    }
    assert {r.id for r in src_tests_before} == {
        r.id for r in src_tests_after
    }
    assert {r.id for r in src_palette_before} == {
        r.id for r in src_palette_after
    }
    # Source rows still tagged None — not seed.
    for row in src_materials_after:
        assert row.import_source is None


def test_run_import_tags_all_new_rows_with_import_source_seed(fresh_db):
    m = _seed_material(SRC, "A")
    _seed_preset(SRC, m)
    t = _seed_test(SRC, m)
    r = _seed_result(SRC, t)
    _seed_palette_entry(SRC, m, test_id=t, source_result_id=r)
    _seed_saved_spectrum(SRC, t, m)
    _seed_text_reg_machine(SRC)
    _seed_text_reg_material(SRC, m)
    run_import(SRC, DST)
    for table in (
        materials_t,
        presets_t,
        tests_t,
        results_t,
        palette_t,
        saved_spectrums_t,
        trd_machine_t,
        trd_material_t,
    ):
        rows = _list_rows(table, owner_id=DST)
        assert rows, f"{table.name}: no dst rows written"
        for row in rows:
            assert row.import_source == SEED_IMPORT_SOURCE, (
                f"{table.name} row id={row.id} lacks import_source='seed'"
            )


def test_run_import_copies_saved_spectrum_with_children(fresh_db):
    """Saved spectrums + cascade-delete children (swatches +
    fit_coefficients) must be copied together, with the FK to the
    new parent id."""
    m = _seed_material(SRC, "A")
    t = _seed_test(SRC, m)
    _seed_saved_spectrum(SRC, t, m)
    run_import(SRC, DST)
    dst_parent = [r for r in _list_rows(saved_spectrums_t, owner_id=DST)][0]
    with session_scope() as s:
        sw_rows = s.execute(
            select(saved_spectrum_swatches_t).where(
                saved_spectrum_swatches_t.c.saved_spectrum_id == dst_parent.id,
            )
        ).all()
        co_rows = s.execute(
            select(saved_spectrum_fits_t).where(
                saved_spectrum_fits_t.c.saved_spectrum_id == dst_parent.id,
            )
        ).all()
    assert len(sw_rows) == 1
    assert len(co_rows) == 1


# ── run_import — image bytes copy (B3) ───────────────────────────────────


def _images_setup(monkeypatch, tmp_path):
    """Point image storage at a fresh subdir of tmp_path so a) it doesn't
    collide with the sqlite file `fresh_db` writes into the same dir,
    and b) each test gets isolated bytes."""
    images_root = tmp_path / "images"
    images_root.mkdir(exist_ok=True)
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(images_root))
    from xcs_gen_web import images as images_module
    images_module.reset_for_tests()
    return images_module


def _save_src_bytes(images_module, test_id: int, result_id: int,
                    data: bytes, suffix: str = ".jpg", kind: str = "") -> str:
    """Write source image bytes under the (test_id, result_id) key and
    return the stored path — same path the DB row would carry."""
    saved = images_module.save(
        test_id=test_id, result_id=result_id,
        data=data, suffix=suffix, kind=kind,
    )
    return saved["path"]


def test_run_import_copies_image_bytes(fresh_db, monkeypatch, tmp_path):
    im = _images_setup(monkeypatch, tmp_path)
    m = _seed_material(SRC, "A")
    t = _seed_test(SRC, m)
    # Reserve a result id then put bytes under it.
    r = _seed_result(SRC, t)
    src_path = _save_src_bytes(im, t, r, b"hello-bytes", suffix=".jpg")
    # Patch the result row to point at the real on-disk path.
    with session_scope() as s:
        s.execute(
            results_t.update().where(results_t.c.id == r)
            .values(image_path=src_path)
        )

    res = run_import(SRC, DST)
    assert res.image_warnings == []

    dst_r = [row for row in _list_rows(results_t, owner_id=DST)][0]
    assert dst_r.image_path != src_path
    # Bytes match.
    assert im.read(dst_r.image_path) == b"hello-bytes"
    # Source bytes untouched.
    assert im.read(src_path) == b"hello-bytes"


def test_run_import_copies_warped_sidecar(fresh_db, monkeypatch, tmp_path):
    im = _images_setup(monkeypatch, tmp_path)
    m = _seed_material(SRC, "A")
    t = _seed_test(SRC, m)
    r = _seed_result(SRC, t)
    src_image = _save_src_bytes(im, t, r, b"original", suffix=".jpg")
    src_warped = _save_src_bytes(
        im, t, r, b"warped-png", suffix=".png", kind="warped",
    )
    with session_scope() as s:
        s.execute(
            results_t.update().where(results_t.c.id == r)
            .values(image_path=src_image, warped_image_path=src_warped)
        )

    res = run_import(SRC, DST)
    assert res.image_warnings == []

    dst_r = [row for row in _list_rows(results_t, owner_id=DST)][0]
    assert dst_r.warped_image_path is not None
    assert dst_r.warped_image_path != src_warped
    assert im.read(dst_r.warped_image_path) == b"warped-png"
    # Original image also copied.
    assert im.read(dst_r.image_path) == b"original"


def test_run_import_handles_missing_source_image(fresh_db, monkeypatch, tmp_path):
    _images_setup(monkeypatch, tmp_path)
    m = _seed_material(SRC, "A")
    t = _seed_test(SRC, m)
    # Set image_path to a plausible-looking path but DON'T actually
    # write bytes under it.
    bogus = str(tmp_path / "images" / "does-not-exist.jpg")
    _seed_result(SRC, t, image_path=bogus)

    res = run_import(SRC, DST)

    dst_r = [row for row in _list_rows(results_t, owner_id=DST)][0]
    # Row exists (the result is still useful — cell readings etc.).
    assert dst_r is not None
    # image_path retained the source string (NOT NULL column) but no
    # bytes were written under a new dst path.
    assert dst_r.image_path == bogus
    # Warning surfaced.
    assert len(res.image_warnings) == 1
    assert "source image missing" in res.image_warnings[0]


def test_run_import_copies_heic_cache_sidecar(fresh_db, monkeypatch, tmp_path):
    im = _images_setup(monkeypatch, tmp_path)
    m = _seed_material(SRC, "A")
    t = _seed_test(SRC, m)
    r = _seed_result(SRC, t)
    src_image = _save_src_bytes(im, t, r, b"heic-bytes", suffix=".heic")
    # Write the HEIC cache sidecar at the path-convention location.
    src_cache = f"{src_image}.cached.jpg"
    im.save_at(src_cache, b"cached-jpeg-bytes")
    with session_scope() as s:
        s.execute(
            results_t.update().where(results_t.c.id == r)
            .values(image_path=src_image)
        )

    res = run_import(SRC, DST)
    assert res.image_warnings == []

    dst_r = [row for row in _list_rows(results_t, owner_id=DST)][0]
    dst_cache = f"{dst_r.image_path}.cached.jpg"
    assert im.read(dst_cache) == b"cached-jpeg-bytes"


def test_run_import_skips_heic_cache_if_absent(fresh_db, monkeypatch, tmp_path):
    im = _images_setup(monkeypatch, tmp_path)
    m = _seed_material(SRC, "A")
    t = _seed_test(SRC, m)
    r = _seed_result(SRC, t)
    src_image = _save_src_bytes(im, t, r, b"heic-bytes", suffix=".heic")
    # NOTE: no cached.jpg sidecar exists.
    with session_scope() as s:
        s.execute(
            results_t.update().where(results_t.c.id == r)
            .values(image_path=src_image)
        )

    # Should succeed cleanly — the cache is derived, regenerated on view.
    res = run_import(SRC, DST)
    assert res.image_warnings == []

    dst_r = [row for row in _list_rows(results_t, owner_id=DST)][0]
    dst_cache = f"{dst_r.image_path}.cached.jpg"
    # No cached sidecar was written under the dst path.
    import pytest as _pytest
    with _pytest.raises(FileNotFoundError):
        im.read(dst_cache)
