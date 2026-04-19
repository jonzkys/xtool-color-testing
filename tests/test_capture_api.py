"""Tests for the /api/capture/ingest endpoint."""

from __future__ import annotations

import io
import json

import pytest
import segno
from fastapi.testclient import TestClient
from PIL import Image

from xcs_gen_web.app import create_app


@pytest.fixture
def client():
    return TestClient(create_app())


def _synthetic_sheet_png(
    qr_text: str,
    grid_colors: list[tuple[int, int, int]],
    *,
    qr_size_mm: float = 12.0,
    margin_mm: float = 1.5,
    cell_w_mm: float = 3.0,
    cell_h_mm: float = 5.0,
    px_per_mm: int = 10,
) -> bytes:
    """Render a synthetic burn-space PNG with the QR at the top-left and a
    row of uniform-color cells at (qr_size + margin, qr_size + margin).

    The layout must match where the endpoint's warp → sample pipeline
    will look, otherwise the sample will read empty background pixels.
    """
    qr_size_px = int(qr_size_mm * px_per_mm)
    margin_px = int(margin_mm * px_per_mm)
    cell_w_px = int(cell_w_mm * px_per_mm)
    cell_h_px = int(cell_h_mm * px_per_mm)

    grid_x_px = qr_size_px + margin_px
    grid_y_px = qr_size_px + margin_px
    canvas_w = grid_x_px + len(grid_colors) * cell_w_px + 20
    canvas_h = grid_y_px + cell_h_px + 20

    canvas = Image.new("RGB", (canvas_w, canvas_h), (255, 255, 255))

    qr = segno.make(qr_text, error="m")
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=10, border=2)
    buf.seek(0)
    qr_img = Image.open(buf).convert("RGB").resize((qr_size_px, qr_size_px))
    canvas.paste(qr_img, (0, 0))

    for i, color in enumerate(grid_colors):
        cell = Image.new("RGB", (cell_w_px, cell_h_px), color)
        canvas.paste(cell, (grid_x_px + i * cell_w_px, grid_y_px))

    out = io.BytesIO()
    canvas.save(out, format="PNG")
    return out.getvalue()


def test_ingest_returns_swatches_matching_cell_colors(client):
    spec = {
        "v": 1,
        "id": "testid01",
        "t": "grid",
        "x": {"p": "speed", "min": 100, "max": 1000, "n": 3},
        "grid": {"w": 9.0, "h": 5.0, "rows": 1, "gap": 0.0},
        "b": {"p": 50, "s": 500, "f": 60, "d": 200, "r": 1, "pw": 200, "l": "red"},
    }
    qr_text = json.dumps(spec, separators=(",", ":"))
    png = _synthetic_sheet_png(
        qr_text,
        [(255, 0, 0), (0, 255, 0), (0, 0, 255)],  # RGB for each cell
    )
    resp = client.post(
        "/api/capture/ingest",
        files={"image": ("sheet.png", png, "image/png")},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["test_id"] == "testid01"
    assert data["kind"] == "grid"
    assert data["x_param"] == "speed"
    assert data["y_param"] is None
    assert data["base_params"]["power"] == 50
    assert data["base_params"]["frequency"] == 60
    assert data["base_params"]["laser"] == "red"
    assert len(data["swatches"]) == 3
    hexes = [s["hex"] for s in data["swatches"]]
    # Each synthetic cell is pure RGB; the median sample should round-trip.
    assert hexes[0] == "#ff0000"
    assert hexes[1] == "#00ff00"
    assert hexes[2] == "#0000ff"
    assert data["swatches"][0]["x_value"] == 100
    assert data["swatches"][-1]["x_value"] == 1000


def test_ingest_rejects_sheet_without_qr(client):
    canvas = Image.new("RGB", (200, 200), (255, 255, 255))
    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    resp = client.post(
        "/api/capture/ingest",
        files={"image": ("blank.png", buf.getvalue(), "image/png")},
    )
    assert resp.status_code == 400
    assert "qr" in resp.json()["detail"].lower()


def test_ingest_rejects_id_only_qr(client):
    qr_text = json.dumps({"v": 1, "id": "abcdefgh"}, separators=(",", ":"))
    png = _synthetic_sheet_png(qr_text, [])
    resp = client.post(
        "/api/capture/ingest",
        files={"image": ("sheet.png", png, "image/png")},
    )
    assert resp.status_code == 400
    assert "id_only" in resp.json()["detail"].lower()


def test_ingest_rejects_non_image_upload(client):
    resp = client.post(
        "/api/capture/ingest",
        files={"image": ("not-an-image.txt", b"hello world", "text/plain")},
    )
    assert resp.status_code == 400
