"""Tests for QR payload encode/decode."""

import json

import pytest

from xcs_gen.capture.qr_payload import PayloadError, decode_payload, encode_id


def test_encode_id_roundtrip():
    # retest_index defaults to 0, which omits ``r`` from the encoded
    # payload (to keep the wire compatible with pre-retest-era QRs)
    # but decoder synthesises ``r: 0`` so downstream code can rely on
    # the key always being present.
    s = encode_id(42)
    assert decode_payload(s) == {"v": 1, "id": 42, "r": 0}


def test_encode_with_retest_index():
    s = encode_id(42, retest_index=3)
    assert decode_payload(s) == {"v": 1, "id": 42, "r": 3}


def test_retest_index_defaults_when_missing_from_wire():
    s = json.dumps({"v": 1, "id": 42})
    assert decode_payload(s)["r"] == 0


def test_encode_id_rejects_negative_retest_index():
    with pytest.raises(PayloadError):
        encode_id(42, retest_index=-1)


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


def test_encode_id_rejects_bool():
    with pytest.raises(PayloadError):
        encode_id(True)  # type: ignore[arg-type]
    with pytest.raises(PayloadError):
        encode_id(False)  # type: ignore[arg-type]


def test_decode_rejects_float_id():
    with pytest.raises(PayloadError):
        decode_payload(json.dumps({"v": 1, "id": 42.7}))


def test_decode_rejects_bool_id():
    with pytest.raises(PayloadError):
        decode_payload(json.dumps({"v": 1, "id": True}))
