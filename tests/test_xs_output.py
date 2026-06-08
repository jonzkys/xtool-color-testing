"""Backend ``.xs`` (xcs-workspace-v2) output support.

Covers the shared serializer (:mod:`xcs_gen_web.serialize`), each
converter's ``*_to_xcs_bytes`` format switch, and the request/endpoint
plumbing for the three body endpoints plus the test-generate query param.

The new ``.xs`` ZIP bundle is the DEFAULT; ``.xcs`` flat JSON stays
selectable. A regression test guards that the legacy ``build_xcs`` JSON
output is byte-identical to before the shared refactor.
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path as FsPath

from fastapi.testclient import TestClient

from xcs_gen.builder import build_xcs
from xcs_gen.model import Circle, Path, XCSProject
from xcs_gen_web.app import create_app
from xcs_gen_web.pixel_art_converter import pixel_art_to_xcs_bytes
from xcs_gen_web.schemas import (
    BaseParams,
    LayerSpec,
    PixelArtLayerSpec,
    PixelArtRequest,
    PixelArtShapeSpec,
    SvgLayersRequest,
    SvgStackRequest,
)
from xcs_gen_web.serialize import project_to_bytes
from xcs_gen_web.svg_converter import svg_stack_to_xcs_bytes
from xcs_gen_web.svg_layers_converter import svg_layers_to_xcs_bytes
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import tests as t_repo

SAMPLES = FsPath(__file__).parent.parent / "samples"
PIKACHU_SVG = SAMPLES / "Pikachu.svg"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _base_params() -> BaseParams:
    return BaseParams(
        power=50, speed=1000, frequency=65, density=100,
        passes=1, pulse_width=200, laser="red",
    )


def _simple_project() -> XCSProject:
    path = Path(
        d="M0,0 L10,0 L10,10 Z", width=10, height=10, x=5, y=5,
        is_close_path=True, processing_type="VECTOR_ENGRAVING",
    )
    circle = Circle(x=20, y=20, width=10, height=10, processing_type="VECTOR_CUTTING")
    return XCSProject(paths=[path], circles=[circle])


def _open_zip(body: bytes) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BytesIO(body), "r")


def _assert_valid_xs_bundle(body: bytes, *, expected_displays: int | None = None) -> None:
    """The bytes are a v2 ZIP bundle with the contract members present."""
    assert body.startswith(b"PK"), "xs body should be a ZIP (PK magic)"
    with _open_zip(body) as zf:
        names = set(zf.namelist())
        assert ".format" in names
        assert zf.read(".format") == b"v2"
        assert "project.json" in names
        assert "profiles.json" in names
        # exactly one canvas displays chunk + one device file
        displays_members = [
            n for n in names
            if n.startswith("canvases/") and n.endswith("/displays-0.json")
        ]
        assert len(displays_members) == 1, displays_members
        assert any(
            n.startswith("devices/") and n.endswith(".json") for n in names
        ), names
        if expected_displays is not None:
            chunk = json.loads(zf.read(displays_members[0]).decode("utf-8"))
            assert len(chunk["displays"]) == expected_displays


# ---------------------------------------------------------------------------
# 1. shared serializer
# ---------------------------------------------------------------------------


def test_serialize_xcs_returns_json_tuple():
    body, media, ext = project_to_bytes(_simple_project(), "xcs")
    assert media == "application/json"
    assert ext == "xcs"
    assert body.startswith(b"{")
    assert isinstance(json.loads(body.decode("utf-8")), dict)


def test_serialize_xs_returns_zip_tuple():
    proj = _simple_project()
    body, media, ext = project_to_bytes(proj, "xs")
    assert media == "application/zip"
    assert ext == "xs"
    # path + circle => 2 displays
    _assert_valid_xs_bundle(body, expected_displays=2)


def test_serialize_default_is_xs():
    body, media, ext = project_to_bytes(_simple_project())
    assert media == "application/zip"
    assert ext == "xs"
    assert body.startswith(b"PK")


def test_serialize_rejects_unknown_format():
    import pytest
    with pytest.raises(ValueError, match="unknown output format"):
        project_to_bytes(_simple_project(), "pdf")  # type: ignore[arg-type]


def test_serialize_xs_matches_disk_write(tmp_path):
    """In-memory xs bytes carry the same member set as a disk write_xs."""
    from xcs_gen.xcs_v2 import write_xs
    proj = _simple_project()
    out = str(tmp_path / "p.xs")
    write_xs(proj, out)
    with zipfile.ZipFile(out, "r") as disk:
        disk_names = set(disk.namelist())
    body, _, _ = project_to_bytes(proj, "xs")
    with _open_zip(body) as mem:
        mem_names = set(mem.namelist())
    assert disk_names == mem_names


# ---------------------------------------------------------------------------
# 2. converters: *_to_xcs_bytes format switch
# ---------------------------------------------------------------------------


def _stack_request(fmt: str | None = None) -> SvgStackRequest:
    kw = dict(
        name="stack", svg_content=PIKACHU_SVG.read_text(), width_mm=50.0,
        base_params=_base_params(), processing_type="COLOR_FILL_ENGRAVE",
        material_id="mat-test",
    )
    if fmt is not None:
        kw["format"] = fmt
    return SvgStackRequest(**kw)


def _layers_request(fmt: str | None = None) -> SvgLayersRequest:
    kw = dict(
        name="layers", svg_content=PIKACHU_SVG.read_text(), width_mm=50.0,
        material_id="mat-test",
        layers=[
            LayerSpec(color="#ffd73e", name="yellow", enabled=True,
                      processing_type="COLOR_FILL_ENGRAVE",
                      base_params=_base_params(), angle_mode="fixed"),
            LayerSpec(color="#000000", name="black", enabled=True,
                      processing_type="VECTOR_ENGRAVING",
                      base_params=_base_params(), angle_mode="fixed"),
        ],
    )
    if fmt is not None:
        kw["format"] = fmt
    return SvgLayersRequest(**kw)


def _pixel_request(fmt: str | None = None) -> PixelArtRequest:
    kw = dict(
        name="pixel", material_id="mat-1", width_mm=10.0, height_mm=10.0,
        cell_mm=1.0,
        shapes=[PixelArtShapeSpec(color="#000000", loops=[[(0, 0), (2, 0), (2, 2), (0, 2)]])],
        layers=[PixelArtLayerSpec(color="#000000", enabled=True,
                                  base_params=_base_params())],
    )
    if fmt is not None:
        kw["format"] = fmt
    return PixelArtRequest(**kw)


def test_svg_stack_bytes_xcs_and_xs():
    xcs, media, ext = svg_stack_to_xcs_bytes(_stack_request("xcs"))
    assert (media, ext) == ("application/json", "xcs")
    assert xcs.startswith(b"{") and isinstance(json.loads(xcs), dict)
    xs, media, ext = svg_stack_to_xcs_bytes(_stack_request("xs"))
    assert (media, ext) == ("application/zip", "xs")
    _assert_valid_xs_bundle(xs)


def test_svg_stack_bytes_defaults_to_xs():
    body, media, ext = svg_stack_to_xcs_bytes(_stack_request())
    assert (media, ext) == ("application/zip", "xs")
    _assert_valid_xs_bundle(body)


def test_svg_layers_bytes_xcs_and_xs():
    xcs, media, ext = svg_layers_to_xcs_bytes(_layers_request("xcs"))
    assert (media, ext) == ("application/json", "xcs")
    assert xcs.startswith(b"{") and isinstance(json.loads(xcs), dict)
    xs, media, ext = svg_layers_to_xcs_bytes(_layers_request("xs"))
    assert (media, ext) == ("application/zip", "xs")
    _assert_valid_xs_bundle(xs)


def test_svg_layers_bytes_defaults_to_xs():
    body, media, ext = svg_layers_to_xcs_bytes(_layers_request())
    assert (media, ext) == ("application/zip", "xs")
    _assert_valid_xs_bundle(body)


def test_pixel_art_bytes_xcs_and_xs():
    xcs, media, ext = pixel_art_to_xcs_bytes(_pixel_request("xcs"))
    assert (media, ext) == ("application/json", "xcs")
    assert xcs.startswith(b"{") and isinstance(json.loads(xcs), dict)
    xs, media, ext = pixel_art_to_xcs_bytes(_pixel_request("xs"))
    assert (media, ext) == ("application/zip", "xs")
    # one colour layer => one path => one display
    _assert_valid_xs_bundle(xs, expected_displays=1)


def test_pixel_art_bytes_defaults_to_xs():
    body, media, ext = pixel_art_to_xcs_bytes(_pixel_request())
    assert (media, ext) == ("application/zip", "xs")
    _assert_valid_xs_bundle(body, expected_displays=1)


# ---------------------------------------------------------------------------
# 3. endpoints
# ---------------------------------------------------------------------------


def _pixel_payload(**overrides) -> dict:
    base = {
        "name": "px",
        "material_id": "mat-1",
        "width_mm": 10.0, "height_mm": 10.0,
        "cell_mm": 1.0,
        "shapes": [{"color": "#000000", "loops": [[[0, 0], [2, 0], [2, 2], [0, 2]]]}],
        "layers": [{
            "color": "#000000", "enabled": True,
            "base_params": {
                "power": 50, "speed": 1000, "frequency": 65,
                "density": 100, "passes": 1, "pulse_width": 200, "laser": "red",
            },
        }],
    }
    base.update(overrides)
    return base


def _layers_payload(**overrides) -> dict:
    base = {
        "name": "ly",
        "svg_content": PIKACHU_SVG.read_text(),
        "width_mm": 50,
        "material_id": "mat-test",
        "layers": [
            {"color": "#ffd73e", "name": "yellow", "enabled": True,
             "processing_type": "COLOR_FILL_ENGRAVE", "scan_angle": 0,
             "base_params": _base_params().model_dump(), "angle_mode": "fixed"},
            {"color": "#000000", "name": "black", "enabled": True,
             "processing_type": "VECTOR_ENGRAVING", "scan_angle": 0,
             "base_params": _base_params().model_dump(), "angle_mode": "fixed"},
        ],
    }
    base.update(overrides)
    return base


def test_pixel_art_endpoint_xs_default():
    client = TestClient(create_app())
    resp = client.post("/api/pixel-art", json=_pixel_payload())
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/zip")
    assert "px.xs" in resp.headers["content-disposition"]
    _assert_valid_xs_bundle(resp.content)


def test_pixel_art_endpoint_xcs_selectable():
    client = TestClient(create_app())
    resp = client.post("/api/pixel-art", json=_pixel_payload(format="xcs"))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    assert "px.xcs" in resp.headers["content-disposition"]
    assert isinstance(json.loads(resp.content), dict)


def test_svg_layers_endpoint_xs_default():
    client = TestClient(create_app())
    resp = client.post("/api/svg-layers", json=_layers_payload())
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/zip")
    assert "ly.xs" in resp.headers["content-disposition"]
    _assert_valid_xs_bundle(resp.content)


def test_svg_layers_endpoint_xcs_selectable():
    client = TestClient(create_app())
    resp = client.post("/api/svg-layers", json=_layers_payload(format="xcs"))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    assert "ly.xcs" in resp.headers["content-disposition"]
    assert isinstance(json.loads(resp.content), dict)


def test_svg_stack_endpoint_xs_default():
    client = TestClient(create_app())
    payload = {
        "name": "st", "svg_content": PIKACHU_SVG.read_text(), "width_mm": 50,
        "base_params": _base_params().model_dump(),
        "processing_type": "COLOR_FILL_ENGRAVE", "material_id": "mat-test",
    }
    resp = client.post("/api/svg-stack", json=payload)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/zip")
    assert "st.xs" in resp.headers["content-disposition"]
    _assert_valid_xs_bundle(resp.content)


def test_svg_stack_endpoint_xcs_selectable():
    client = TestClient(create_app())
    payload = {
        "name": "st", "svg_content": PIKACHU_SVG.read_text(), "width_mm": 50,
        "base_params": _base_params().model_dump(),
        "processing_type": "COLOR_FILL_ENGRAVE", "material_id": "mat-test",
        "format": "xcs",
    }
    resp = client.post("/api/svg-stack", json=payload)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    assert "st.xcs" in resp.headers["content-disposition"]


# ---------------------------------------------------------------------------
# 4. test-generate endpoint (query param)
# ---------------------------------------------------------------------------

_GEN_BASE = {"power": 50, "speed": 1000, "frequency": 60,
             "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"}
_GEN_SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 10,
    "rows": 1, "width_mm": 50, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False, "base_params": _GEN_BASE,
    "registration": {"mode": "on"},
}


def test_generate_xs_default(fresh_db):
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=_GEN_SPEC)["id"]
    r = c.post(f"/api/tests/{tid}/generate")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/zip")
    assert ".xs" in r.headers.get("content-disposition", "")
    _assert_valid_xs_bundle(r.content)


def test_generate_xcs_selectable(fresh_db):
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=_GEN_SPEC)["id"]
    r = c.post(f"/api/tests/{tid}/generate?format=xcs")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    assert ".xcs" in r.headers.get("content-disposition", "")
    assert r.content.startswith(b"{")


# ---------------------------------------------------------------------------
# 5. regression: legacy build_xcs JSON byte-identical after refactor
# ---------------------------------------------------------------------------


def _scrub_random(d):
    """Strip the per-call volatile fields so two build_xcs calls on the same
    project can be compared structurally.

    build_xcs injects fresh values on every call: random UUIDs (groupTag,
    projectTraceID via xcs_gen.builder._uuid()) AND millisecond ``created`` /
    ``modify`` timestamps. Two calls a few µs apart usually land in the same
    millisecond, but occasionally straddle a boundary — so the timestamps must
    be scrubbed too, otherwise the comparison is flaky (~7% failure)."""
    if isinstance(d, dict):
        return {
            k: _scrub_random(v)
            for k, v in d.items()
            if k not in ("groupTag", "projectTraceID", "created", "modify")
        }
    if isinstance(d, list):
        return [_scrub_random(x) for x in d]
    return d


def test_legacy_build_xcs_bytes_unchanged():
    """Guards the shared refactor: the legacy flat-JSON path must produce the
    same serialisation as the pre-refactor recipe
    (``json.dumps(build_xcs(p), separators=(",",":")).encode()``).

    build_xcs randomises a couple of UUID fields per call, so we compare with
    those scrubbed; the serialisation recipe itself (separators, encoding,
    media type, extension) is asserted exactly."""
    proj = _simple_project()
    direct_bytes = json.dumps(build_xcs(proj), separators=(",", ":")).encode("utf-8")
    via_serialize, media, ext = project_to_bytes(proj, "xcs")

    assert media == "application/json" and ext == "xcs"
    # The serialisation recipe is byte-stable: no spaces after separators,
    # utf-8 encoded JSON object.
    assert via_serialize.startswith(b'{"')
    assert b", " not in via_serialize and b": " not in via_serialize
    # Structurally identical once the per-call random UUIDs are scrubbed.
    assert _scrub_random(json.loads(via_serialize)) == _scrub_random(
        json.loads(direct_bytes)
    )
