"""Tests for the xcs-workspace-v2 (.xs) emitter.

Fidelity references are real xTool bundles vendored under ``samples/xcs/``
(``shape.xs``, ``png-included.xs``); the ground-truth structure was
reverse-engineered from a wider corpus. These tests assert the emitted
bundle matches that contract: member set, JSON shapes, the two
content-addressed side stores (vectors + resources), and the device/
param-binding layer.
"""

from __future__ import annotations

import hashlib
import json
import os
import zipfile

import pytest

from xcs_gen.model import Bitmap, Circle, Path, ProcessingParams, XCSProject
from xcs_gen.xcs_v2 import write_xs

# A real, valid 1x1 PNG used for raster tests.
_PNG_1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000d49444154789c6360000002000001e221bc330000000049454e44ae"
    "426082"
)


def _open(path: str) -> zipfile.ZipFile:
    return zipfile.ZipFile(path, "r")


def _read_json(zf: zipfile.ZipFile, name: str) -> dict:
    return json.loads(zf.read(name).decode("utf-8"))


# ---------------------------------------------------------------------------
# 1. Round-trip structure: a path + a circle
# ---------------------------------------------------------------------------


def _simple_project() -> XCSProject:
    path = Path(
        d="M0,0 L10,0 L10,10 Z",
        width=10,
        height=10,
        x=5,
        y=5,
        is_close_path=True,
        processing_type="VECTOR_ENGRAVING",
    )
    circle = Circle(
        x=20, y=20, width=10, height=10, processing_type="VECTOR_CUTTING"
    )
    return XCSProject(paths=[path], circles=[circle])


def test_format_and_meta(tmp_path) -> None:
    out = str(tmp_path / "simple.xs")
    write_xs(_simple_project(), out)
    with _open(out) as zf:
        assert zf.read(".format") == b"v2"
        meta = _read_json(zf, "meta/persistence-meta.json")
        assert meta == {"schemaVersion": "2.0.0", "protocol": "xcs-workspace-v2"}


def test_project_json_required_keys(tmp_path) -> None:
    proj = _simple_project()
    out = str(tmp_path / "simple.xs")
    write_xs(proj, out)
    with _open(out) as zf:
        pj = _read_json(zf, "project.json")
    assert pj["__v2__"] is True
    assert pj["version"] == "2.0.0"
    assert pj["activeCanvasId"] == proj.canvas_id
    assert pj["activeDeviceId"] == proj.device.ext_id + "-1"
    assert pj["cover"] == "resources/project-cover.png"
    assert pj["modules"]["canvases"] == [proj.canvas_id]
    assert pj["modules"]["devices"] == [proj.device.ext_id + "-1"]
    assert "projectId" in pj and "projectTraceID" in pj
    assert "schemaMeta" in pj and "versionInfo" in pj


def test_member_set_present(tmp_path) -> None:
    proj = _simple_project()
    out = str(tmp_path / "simple.xs")
    write_xs(proj, out)
    cid = proj.canvas_id
    did = proj.device.ext_id + "-1"
    with _open(out) as zf:
        names = set(zf.namelist())
    required = {
        ".format",
        "meta/persistence-meta.json",
        "project.json",
        "profiles.json",
        f"devices/device-{did}.json",
        f"canvases/{cid}.json",
        f"canvases/{cid}/displays-0.json",
        "resources/project-cover.png",
        "resources/project-cover.png.meta.json",
    }
    assert required <= names


def test_profiles_at_least_one(tmp_path) -> None:
    out = str(tmp_path / "simple.xs")
    write_xs(_simple_project(), out)
    with _open(out) as zf:
        profiles = _read_json(zf, "profiles.json")["profiles"]
    assert len(profiles) >= 1
    for pid, prof in profiles.items():
        assert pid.startswith("profile_")
        assert prof["id"] == pid
        assert "processingType" in prof
        assert "values" in prof


def test_every_display_has_exactly_one_binding(tmp_path) -> None:
    proj = _simple_project()
    out = str(tmp_path / "simple.xs")
    write_xs(proj, out)
    cid = proj.canvas_id
    did = proj.device.ext_id + "-1"
    with _open(out) as zf:
        displays = _read_json(zf, f"canvases/{cid}/displays-0.json")["displays"]
        dev = _read_json(zf, f"devices/device-{did}.json")
        profiles = _read_json(zf, "profiles.json")["profiles"]
    display_ids = [d["id"] for d in displays]
    proc = dev["processing"][cid]
    bindings = proc["modes"][proc["activeMode"]]["bindings"]
    for did_disp in display_ids:
        matches = [b for b in bindings if did_disp in b.get("displayIds", [])]
        assert len(matches) == 1, f"{did_disp} bound {len(matches)} times"
        assert matches[0]["baseProfileId"] in profiles


def test_display_count_and_types(tmp_path) -> None:
    proj = _simple_project()
    out = str(tmp_path / "simple.xs")
    write_xs(proj, out)
    cid = proj.canvas_id
    with _open(out) as zf:
        chunk = _read_json(zf, f"canvases/{cid}/displays-0.json")
        canvas = _read_json(zf, f"canvases/{cid}.json")
    displays = chunk["displays"]
    assert chunk["canvasId"] == cid
    assert chunk["chunkIndex"] == 0
    assert len(displays) == 2
    assert sorted(d["type"] for d in displays) == ["CIRCLE", "PATH"]
    assert canvas["chunkLayout"]["displayCount"] == 2


def test_single_unique_path_inlines_dpath_no_vector_store(tmp_path) -> None:
    """A single unique PATH inlines its dPath and emits NO vectors/ member.

    VERIFIED: shape.xs (one PATH) stores dPath inline on the display and has no
    ``vectors/`` dir. Externalizing is only a dedup win for repeated geometry.
    """
    proj = _simple_project()
    src_d = proj.paths[0].d
    out = str(tmp_path / "simple.xs")
    write_xs(proj, out)
    cid = proj.canvas_id
    with _open(out) as zf:
        names = zf.namelist()
        displays = _read_json(zf, f"canvases/{cid}/displays-0.json")["displays"]
    path_disp = next(d for d in displays if d["type"] == "PATH")
    # Geometry is inline, no externalization.
    assert "dPath" in path_disp
    assert path_disp["dPath"] == src_d
    assert "vectorRef" not in path_disp
    # No vectors/ member at all (not even a dir entry).
    assert not any(n.startswith("vectors/") for n in names)


def _dup_path_project() -> XCSProject:
    """Two PATH elements sharing the SAME dPath (geometry should externalize)."""
    d = "M0,0 L10,0 L10,10 Z"
    p1 = Path(
        d=d, width=10, height=10, x=5, y=5,
        is_close_path=True, processing_type="VECTOR_ENGRAVING",
    )
    p2 = Path(
        d=d, width=10, height=10, x=30, y=30,
        is_close_path=True, processing_type="VECTOR_ENGRAVING",
    )
    return XCSProject(paths=[p1, p2])


def test_duplicate_paths_externalize_and_dedup(tmp_path) -> None:
    """A repeated dPath is externalized to vectors/svg and deduped to one entry."""
    proj = _dup_path_project()
    src_d = proj.paths[0].d
    out = str(tmp_path / "dup.xs")
    write_xs(proj, out)
    cid = proj.canvas_id
    vh = hashlib.sha256(src_d.encode("utf-8")).hexdigest()
    with _open(out) as zf:
        names = set(zf.namelist())
        displays = _read_json(zf, f"canvases/{cid}/displays-0.json")["displays"]
        data = _read_json(zf, "vectors/svg/data-0.json")
        index = _read_json(zf, "vectors/svg/index.json")
    path_disps = [d for d in displays if d["type"] == "PATH"]
    assert len(path_disps) == 2
    # Both reference the same externalized geometry; neither inlines dPath.
    assert "vectors/svg/data-0.json" in names
    assert "vectors/svg/index.json" in names
    for pd in path_disps:
        assert "dPath" not in pd
        assert pd["vectorRef"]["vectorHash"] == vh
        assert pd["vectorRef"]["bucketType"] == "svg"
        assert pd["vectorRef"]["originalField"] == "dPath"
    # Deduped: one entry for the shared geometry.
    assert list(data["entries"].keys()) == [vh]
    assert data["entries"][vh] == src_d
    assert index["entries"][vh]["size"] == len(src_d)


def test_circle_is_parametric(tmp_path) -> None:
    proj = _simple_project()
    out = str(tmp_path / "simple.xs")
    write_xs(proj, out)
    cid = proj.canvas_id
    with _open(out) as zf:
        displays = _read_json(zf, f"canvases/{cid}/displays-0.json")["displays"]
    circ = next(d for d in displays if d["type"] == "CIRCLE")
    assert "dPath" not in circ and "vectorRef" not in circ
    assert "width" in circ and "scale" in circ


def test_displays_carry_no_inline_params(tmp_path) -> None:
    """Geometry-only displays: no per-display `data`/processingType block."""
    proj = _simple_project()
    out = str(tmp_path / "simple.xs")
    write_xs(proj, out)
    cid = proj.canvas_id
    with _open(out) as zf:
        displays = _read_json(zf, f"canvases/{cid}/displays-0.json")["displays"]
    for d in displays:
        assert "data" not in d
        assert "processingType" not in d


# ---------------------------------------------------------------------------
# 2. Raster
# ---------------------------------------------------------------------------


def _raster_project(png: bytes, n: int = 1) -> XCSProject:
    bmps = [
        Bitmap(
            x=10 * i,
            y=10 * i,
            width=20,
            height=20,
            png_bytes=png,
            origin_width=1,
            origin_height=1,
            processing_type="BITMAP_ENGRAVING",
        )
        for i in range(n)
    ]
    return XCSProject(bitmaps=bmps)


def test_raster_resource_named_by_sha(tmp_path) -> None:
    proj = _raster_project(_PNG_1)
    out = str(tmp_path / "raster.xs")
    write_xs(proj, out)
    sha = hashlib.sha256(_PNG_1).hexdigest()
    cid = proj.canvas_id
    with _open(out) as zf:
        names = set(zf.namelist())
        assert f"resources/{sha}.png" in names
        assert f"resources/{sha}.png.meta.json" in names
        assert zf.read(f"resources/{sha}.png") == _PNG_1
        meta = _read_json(zf, f"resources/{sha}.png.meta.json")
        assert meta["ref"] == f"resources/{sha}.png"
        assert meta["metadata"]["source"]["value"] == f"{sha}.png"
        displays = _read_json(zf, f"canvases/{cid}/displays-0.json")["displays"]
    bmp = next(d for d in displays if d["type"] == "BITMAP")
    assert bmp["resourcePath"] == f"resources/{sha}.png"
    assert "base64" not in bmp


def test_identical_bitmaps_dedup_to_one_resource(tmp_path) -> None:
    proj = _raster_project(_PNG_1, n=2)
    out = str(tmp_path / "raster2.xs")
    write_xs(proj, out)
    sha = hashlib.sha256(_PNG_1).hexdigest()
    with _open(out) as zf:
        names = zf.namelist()
        png_members = [
            n
            for n in names
            if n.startswith("resources/")
            and n.endswith(".png")
            and "project-cover" not in n
        ]
    assert png_members == [f"resources/{sha}.png"]


# ---------------------------------------------------------------------------
# 3. Relief
# ---------------------------------------------------------------------------


def _relief_project() -> XCSProject:
    params = ProcessingParams()
    intaglio_path = Path(
        d="M0,0 L5,0 L5,5 Z",
        width=5,
        height=5,
        x=0,
        y=0,
        is_close_path=True,
        processing_type="INTAGLIO",
        params=params,
    )
    relief_bmp = Bitmap(
        x=10,
        y=10,
        width=20,
        height=20,
        png_bytes=_PNG_1,
        origin_width=1,
        origin_height=1,
        processing_type="RELIEF",
        params=params,
    )
    return XCSProject(paths=[intaglio_path], bitmaps=[relief_bmp])


def test_relief_mode_and_depth_keys(tmp_path) -> None:
    proj = _relief_project()
    out = str(tmp_path / "relief.xs")
    write_xs(proj, out)
    cid = proj.canvas_id
    did = proj.device.ext_id + "-1"
    with _open(out) as zf:
        dev = _read_json(zf, f"devices/device-{did}.json")
        profiles = _read_json(zf, "profiles.json")["profiles"]
        displays = _read_json(zf, f"canvases/{cid}/displays-0.json")["displays"]
    proc = dev["processing"][cid]
    assert proc["activeMode"] == "RELIEF_PROCESS"
    mode = proc["modes"]["RELIEF_PROCESS"]

    depth_keys = ("sliceNumber", "zLayers", "zDecline", "zAxisMove", "processAngle")

    # The RELIEF bitmap binds to a RELIEF profile carrying the depth keys.
    relief_bmp_id = next(d["id"] for d in displays if d["type"] == "BITMAP")
    binding = next(
        b for b in mode["bindings"] if relief_bmp_id in b.get("displayIds", [])
    )
    prof = profiles[binding["baseProfileId"]]
    assert prof["processingType"] == "RELIEF"
    for key in depth_keys:
        assert key in prof["values"], f"relief profile missing {key}"

    # The INTAGLIO path also binds to an INTAGLIO profile with the same keys.
    intaglio_id = next(d["id"] for d in displays if d["type"] == "PATH")
    binding_i = next(
        b for b in mode["bindings"] if intaglio_id in b.get("displayIds", [])
    )
    prof_i = profiles[binding_i["baseProfileId"]]
    assert prof_i["processingType"] == "INTAGLIO"
    for key in depth_keys:
        assert key in prof_i["values"], f"intaglio profile missing {key}"


# ---------------------------------------------------------------------------
# 4. Faithfulness vs a real sample (shape.xs)
# ---------------------------------------------------------------------------

_SAMPLES_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "samples", "xcs"
)
_SAMPLE = os.path.join(_SAMPLES_DIR, "shape.xs")


@pytest.mark.skipif(not os.path.exists(_SAMPLE), reason="reference sample absent")
def test_faithfulness_member_and_key_set(tmp_path) -> None:
    proj = _simple_project()
    out = str(tmp_path / "simple.xs")
    write_xs(proj, out)
    cid = proj.canvas_id
    did = proj.device.ext_id + "-1"

    with _open(out) as zf:
        emitted = _read_json(zf, "project.json")
        emitted_dev = _read_json(zf, f"devices/device-{did}.json")
        emitted_disp = _read_json(zf, f"canvases/{cid}/displays-0.json")
        emitted_canvas = _read_json(zf, f"canvases/{cid}.json")

    with _open(_SAMPLE) as zf:
        sample = _read_json(zf, "project.json")
        names = zf.namelist()
        dev_name = next(n for n in names if n.startswith("devices/device-"))
        sample_dev = _read_json(zf, dev_name)
        scid = sample["activeCanvasId"]
        sample_disp = _read_json(zf, f"canvases/{scid}/displays-0.json")
        sample_canvas = _read_json(zf, f"canvases/{scid}.json")

    assert set(emitted.keys()) == set(sample.keys())
    assert set(emitted_dev.keys()) == set(sample_dev.keys())
    assert set(emitted_canvas.keys()) == set(sample_canvas.keys())
    assert set(emitted_disp.keys()) == set(sample_disp.keys())

    # PATH common-field set (drop the geometry-ref key that differs by
    # variant: emitted uses vectorRef, sample inlines dPath).
    emitted_path = next(d for d in emitted_disp["displays"] if d["type"] == "PATH")
    sample_path = next(d for d in sample_disp["displays"] if d["type"] == "PATH")

    def common(d: dict) -> set:
        return set(d.keys()) - {"dPath", "vectorRef"}

    assert common(emitted_path) == common(sample_path)

    # CIRCLE keys must match exactly (both parametric).
    emitted_circle = next(
        d for d in emitted_disp["displays"] if d["type"] == "CIRCLE"
    )
    sample_circle = next(d for d in sample_disp["displays"] if d["type"] == "CIRCLE")
    assert set(emitted_circle.keys()) == set(sample_circle.keys())


@pytest.mark.skipif(not os.path.exists(_SAMPLE), reason="reference sample absent")
def test_faithfulness_device_mode_envelope(tmp_path) -> None:
    proj = _simple_project()
    out = str(tmp_path / "simple.xs")
    write_xs(proj, out)
    cid = proj.canvas_id
    did = proj.device.ext_id + "-1"
    with _open(out) as zf:
        dev = _read_json(zf, f"devices/device-{did}.json")
    with _open(_SAMPLE) as zf:
        names = zf.namelist()
        dev_name = next(n for n in names if n.startswith("devices/device-"))
        sample_dev = _read_json(zf, dev_name)
        sample_proj = _read_json(zf, "project.json")
    scid = sample_proj["activeCanvasId"]

    emitted_mode = dev["processing"][cid]
    sample_mode = sample_dev["processing"][scid]
    assert set(emitted_mode.keys()) == set(sample_mode.keys())
    em = emitted_mode["modes"][emitted_mode["activeMode"]]
    sm = sample_mode["modes"][sample_mode["activeMode"]]
    assert set(em.keys()) == set(sm.keys())
    assert set(em["data"].keys()) == set(sm["data"].keys())


# ---------------------------------------------------------------------------
# 5. BITMAP faithfulness vs a real raster sample (png-included.xs)
# ---------------------------------------------------------------------------

_BITMAP_SAMPLE = os.path.join(_SAMPLES_DIR, "png-included.xs")


def _first_display_of_type(zf: zipfile.ZipFile, dtype: str) -> dict | None:
    """Return the first display of ``dtype`` across all chunk files (or None)."""
    proj = _read_json(zf, "project.json")
    scid = proj["activeCanvasId"]
    for name in zf.namelist():
        if name.startswith(f"canvases/{scid}/displays-") and name.endswith(".json"):
            for d in _read_json(zf, name).get("displays", []):
                if d.get("type") == dtype:
                    return d
    return None


@pytest.mark.skipif(
    not os.path.exists(_BITMAP_SAMPLE), reason="raster reference sample absent"
)
def test_faithfulness_bitmap_key_set(tmp_path) -> None:
    """Emitted BITMAP display key set matches the real png-included.xs BITMAP.

    Drops the geometry-ref keys that differ by variant (emitted uses
    ``resourcePath``; the sample inlines ``base64``/``currentUrl``). Guards the
    same missing/extra-key drift on the raster path that #2 fixed for vectors.
    """
    proj = _raster_project(_PNG_1)
    out = str(tmp_path / "raster.xs")
    write_xs(proj, out)
    cid = proj.canvas_id
    with _open(out) as zf:
        displays = _read_json(zf, f"canvases/{cid}/displays-0.json")["displays"]
        emitted_bmp = next(d for d in displays if d["type"] == "BITMAP")
    with _open(_BITMAP_SAMPLE) as zf:
        sample_bmp = _first_display_of_type(zf, "BITMAP")
    if sample_bmp is None:
        pytest.skip("reference sample has no BITMAP display")

    skip = {"base64", "resourcePath", "currentUrl"}
    # Optional keys whose presence varies by studio version — emitting them is
    # harmless (Studio ignores unknown extras), so they don't count as drift.
    tolerated_extra = {"filterList_V2"}

    def common(d: dict) -> set:
        return set(d.keys()) - skip

    missing = common(sample_bmp) - common(emitted_bmp)
    extra = common(emitted_bmp) - common(sample_bmp) - tolerated_extra
    # Missing keys are real fidelity gaps (Studio expects them); fail hard.
    assert not missing, f"emitted BITMAP missing keys: {sorted(missing)}"
    # Any extra key beyond the tolerated set is unexpected drift.
    assert not extra, f"emitted BITMAP has unexpected extra keys: {sorted(extra)}"


# ---------------------------------------------------------------------------
# 6. Generator round-trip: extra_device_entries params flow into profiles
# ---------------------------------------------------------------------------


def test_generator_extra_entries_bind_real_params(tmp_path) -> None:
    """Gradient extras bind profiles whose values == the generator's real params.

    ``generate_gradient`` populates ``extra_displays`` (TEXT labels, LINE ticks)
    AND ``extra_device_entries`` (their real processing). The v2 emitter must
    bind each extra display to a profile whose ``values`` come from that entry's
    resolved customize block — NOT a hardcoded VECTOR_ENGRAVING default.
    Guards #1.
    """
    from xcs_gen.generators import generate_gradient

    proj = generate_gradient(
        x_param="power",
        x_min=10,
        x_max=40,
        x_steps=4,
        total_width=40,
        total_height=20,
    )
    assert proj.extra_displays, "generator produced no extra displays"
    assert proj.extra_device_entries, "generator produced no extra device entries"

    out = str(tmp_path / "gradient.xs")
    write_xs(proj, out)
    cid = proj.canvas_id
    did = proj.device.ext_id + "-1"
    with _open(out) as zf:
        dev = _read_json(zf, f"devices/device-{did}.json")
        profiles = _read_json(zf, "profiles.json")["profiles"]
    proc = dev["processing"][cid]
    bindings = proc["modes"][proc["activeMode"]]["bindings"]

    # Map each display id -> its baseProfileId via the bindings.
    disp_to_profile: dict[str, str] = {}
    for b in bindings:
        for d in b.get("displayIds", []):
            disp_to_profile[d] = b["baseProfileId"]

    checked = 0
    for disp_id, entry in proj.extra_device_entries:
        assert disp_id in disp_to_profile, f"extra display {disp_id} not bound"
        prof = profiles[disp_to_profile[disp_id]]
        ptype = entry["processingType"]
        assert prof["processingType"] == ptype
        expected = dict(entry["data"][ptype]["parameter"]["customize"])
        expected["processingType"] = ptype
        assert prof["values"] == expected, (
            f"profile values diverge from generator params for {disp_id}"
        )
        checked += 1
    assert checked > 0
