"""Tests for QR payload encode/decode."""

import pytest

from xcs_gen.capture.qr_payload import (
    encode_inline, encode_id_only, decode_payload, PayloadError,
)


def _sample_spec():
    return {
        "id": "a1b2c3d4",
        "t": "grid",
        "x": {"p": "speed", "min": 100, "max": 5000, "n": 50},
        "y": {"p": "power", "min": 10, "max": 100, "n": 10},
        "grid": {"w": 22.0, "h": 44.0, "rows": 1, "gap": 0.0},
        "b": {"p": 80, "s": 230, "f": 60000, "d": 200, "r": 1, "pw": 200, "l": "red"},
    }


def test_encode_decode_inline_roundtrip():
    spec = _sample_spec()
    encoded = encode_inline(spec)
    decoded = decode_payload(encoded)
    assert decoded["v"] == 1
    assert decoded["id"] == spec["id"]
    assert decoded["x"] == spec["x"]
    assert decoded["grid"] == spec["grid"]


def test_encode_id_only_is_compact():
    encoded = encode_id_only("a1b2c3d4")
    assert len(encoded) < 40
    decoded = decode_payload(encoded)
    assert decoded == {"v": 1, "id": "a1b2c3d4"}


def test_inline_payload_fits_in_reasonable_qr_size():
    spec = _sample_spec()
    encoded = encode_inline(spec)
    # Must comfortably fit in QR v6 alphanumeric ECC-M (~230 chars) or v8 binary ECC-M (~250).
    assert len(encoded) <= 260, f"payload is {len(encoded)} chars"


def test_decode_rejects_unknown_version():
    bad = '{"v": 99, "id": "x"}'
    with pytest.raises(PayloadError, match="version"):
        decode_payload(bad)


def test_decode_rejects_malformed_json():
    with pytest.raises(PayloadError):
        decode_payload("not-json")


def test_encode_inline_without_y_axis():
    spec = {
        "id": "aaaaaaaa",
        "t": "grid",
        "x": {"p": "speed", "min": 100, "max": 5000, "n": 50},
        "grid": {"w": 22.0, "h": 5.0, "rows": 1, "gap": 0.0},
        "b": {"p": 80, "s": 230, "f": 60000, "d": 200, "r": 1, "pw": 200, "l": "red"},
    }
    encoded = encode_inline(spec)
    decoded = decode_payload(encoded)
    assert "y" not in decoded
    assert decoded["t"] == "grid"


def test_encode_inline_rejects_spec_without_id():
    spec = {"t": "grid", "x": {"p": "speed", "min": 100, "max": 5000, "n": 50}}
    with pytest.raises(PayloadError, match="id"):
        encode_inline(spec)


def test_encode_id_only_rejects_empty_string():
    with pytest.raises(PayloadError, match="non-empty"):
        encode_id_only("")
