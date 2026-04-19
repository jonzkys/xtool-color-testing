"""Tests for the palette JSON store + ΔE2000 query."""

from __future__ import annotations

from xcs_gen_web.palette import (
    PaletteEntry,
    append_entries,
    delta_e_2000,
    hex_to_lab,
    load_palette,
    query_by_hex,
    save_palette,
)


def _make_entry(
    eid: str, hex_: str, *, power: int = 50,
    material_id: str = "mat-stainless", ts: str = "2026-04-17T10:00:00Z",
) -> PaletteEntry:
    return PaletteEntry(
        id=eid, test_id="t1", material_id=material_id,
        source="upload", timestamp=ts,
        hex=hex_, lab=list(hex_to_lab(hex_)),
        params={"power": power, "speed": 1000, "frequency": 60000,
                "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"},
        sigma=1.5, notes="",
    )


def test_save_load_roundtrip(tmp_path):
    path = tmp_path / "palette.json"
    entries = [_make_entry("e1", "#ff0000")]
    save_palette(path, entries)
    loaded = load_palette(path)
    assert len(loaded) == 1
    assert loaded[0].hex == "#ff0000"
    assert loaded[0].test_id == "t1"
    assert loaded[0].params["power"] == 50


def test_load_missing_file_returns_empty(tmp_path):
    assert load_palette(tmp_path / "does-not-exist.json") == []


def test_append_entries_preserves_existing(tmp_path):
    path = tmp_path / "palette.json"
    save_palette(path, [_make_entry("e1", "#ff0000")])
    append_entries(path, [_make_entry("e2", "#00ff00", power=60)])
    loaded = load_palette(path)
    assert len(loaded) == 2
    assert {e.id for e in loaded} == {"e1", "e2"}


def test_delta_e_2000_identical_is_zero():
    lab = hex_to_lab("#c4a87b")
    assert delta_e_2000(lab, lab) < 0.01


def test_delta_e_2000_pure_colors_are_large():
    red = hex_to_lab("#ff0000")
    green = hex_to_lab("#00ff00")
    assert delta_e_2000(red, green) > 50


def test_query_returns_nearest_first(tmp_path):
    path = tmp_path / "palette.json"
    entries = [
        _make_entry("e0", "#ff0000", power=50),
        _make_entry("e1", "#ee0000", power=55),
        _make_entry("e2", "#00ff00", power=70),
    ]
    save_palette(path, entries)

    results = query_by_hex(path, "#ff0100", limit=3)
    assert len(results) == 3
    assert results[0].entry.hex in ("#ff0000", "#ee0000")
    assert results[-1].entry.hex == "#00ff00"
    # Ascending by delta_e
    deltas = [r.delta_e for r in results]
    assert deltas == sorted(deltas)


def test_query_respects_limit(tmp_path):
    path = tmp_path / "palette.json"
    save_palette(path, [
        _make_entry(f"e{i}", f"#{i*20:02x}0000") for i in range(10)
    ])
    results = query_by_hex(path, "#800000", limit=3)
    assert len(results) == 3


def test_query_scopes_by_material_id(tmp_path):
    path = tmp_path / "palette.json"
    save_palette(path, [
        _make_entry("e-s-red", "#ff0000", material_id="mat-stainless"),
        _make_entry("e-s-green", "#00ff00", material_id="mat-stainless"),
        _make_entry("e-b-red", "#ef0000", material_id="mat-brass"),
    ])
    # Even though the brass red is visually closer to "#ff0000" than the
    # stainless green, restricting to stainless should exclude it.
    results = query_by_hex(path, "#ff0000", limit=5, material_id="mat-stainless")
    assert len(results) == 2
    assert {r.entry.id for r in results} == {"e-s-red", "e-s-green"}
    # And no filter returns everything.
    results_all = query_by_hex(path, "#ff0000", limit=5)
    assert len(results_all) == 3


def test_load_palette_backfills_missing_material_id(tmp_path):
    """Legacy entries persisted before material_id existed should still load."""
    path = tmp_path / "palette.json"
    legacy_body = {
        "version": 1,
        "entries": [{
            "id": "e-legacy", "test_id": "t1", "source": "upload",
            "timestamp": "2026-04-17T10:00:00Z",
            "hex": "#ff0000", "lab": list(hex_to_lab("#ff0000")),
            "params": {"power": 50}, "sigma": 1.5, "notes": "",
            # no material_id
        }],
    }
    import json as _json
    path.write_text(_json.dumps(legacy_body))
    loaded = load_palette(path)
    assert len(loaded) == 1
    assert loaded[0].material_id == ""
