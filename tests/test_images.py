from __future__ import annotations

from pathlib import Path

from xcs_gen_web import images


def test_save_and_read_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
    rec = images.save(test_id=7, result_id=3, data=data, suffix=".png")
    assert rec["path"].endswith("7/3.png")
    assert rec["sha256"] == images.sha256_hex(data)
    assert (tmp_path / "7" / "3.png").read_bytes() == data


def test_delete(tmp_path, monkeypatch):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    rec = images.save(test_id=7, result_id=3, data=b"x", suffix=".bin")
    images.delete(rec["path"])
    assert not Path(rec["path"]).exists()
