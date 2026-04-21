"""Tests for QR payload encode/decode."""

import json

import pytest

from xcs_gen.capture.qr_payload import PayloadError, decode_payload, encode_id


def test_encode_id_roundtrip():
    s = encode_id(42)
    assert decode_payload(s) == {"v": 1, "id": 42}


def test_decode_accepts_string_id_for_legacy():
    s = json.dumps({"v": 1, "id": "42"})
    assert decode_payload(s)["id"] == 42


def test_rejects_unknown_version():
    with pytest.raises(PayloadError):
        decode_payload(json.dumps({"v": 99, "id": 1}))


def test_encode_id_rejects_non_positive():
    with pytest.raises(PayloadError):
        encode_id(0)


def test_encode_id_rejects_non_int():
    with pytest.raises(PayloadError):
        encode_id("not-an-int")  # type: ignore[arg-type]


def test_decode_rejects_malformed_json():
    with pytest.raises(PayloadError):
        decode_payload("not-json")


def test_decode_rejects_missing_id():
    with pytest.raises(PayloadError, match="id"):
        decode_payload(json.dumps({"v": 1}))


def test_encode_id_produces_compact_json():
    s = encode_id(1)
    assert len(s) < 30
    # No spaces
    assert " " not in s
