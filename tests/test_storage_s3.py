"""Tests for the S3 storage backend.

boto3 is mocked at the client level so we can run these without
network access and without needing the optional [s3] extra installed.
The tests assert the *contract* the app relies on — bucket + key
construction, SSE enforcement, Content-Type, bucket confinement, and
dispatcher behaviour for mixed-mode deployments.
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

import pytest

from xcs_gen_web.config import Settings
from xcs_gen_web import storage
from xcs_gen_web.storage import (
    DispatchingStorage,
    FilesystemStorage,
    S3Storage,
    _assert_safe_suffix,
    content_type_for,
    _parse_s3_uri,
    get_storage,
)


@pytest.fixture
def s3_mock(monkeypatch):
    """Install a fake boto3 module so S3Storage.__init__ can import it
    without needing the real package installed. Returns the MagicMock
    that stands in for the boto3 S3 client so individual tests can
    assert against its call log."""
    client = MagicMock()
    fake_boto3 = types.SimpleNamespace(client=lambda *a, **kw: client)
    monkeypatch.setitem(sys.modules, "boto3", fake_boto3)
    return client


# --- pure helpers --------------------------------------------------------

def test_parse_s3_uri_accepts_bucket_and_key():
    bucket, key = _parse_s3_uri("s3://my-bucket/some/nested/key.png")
    assert bucket == "my-bucket"
    assert key == "some/nested/key.png"


def test_parse_s3_uri_rejects_non_s3():
    with pytest.raises(ValueError, match="not an s3 uri"):
        _parse_s3_uri("https://example.com/foo")


def test_parse_s3_uri_rejects_missing_key():
    with pytest.raises(ValueError, match="malformed"):
        _parse_s3_uri("s3://my-bucket")


def test_content_type_maps_common_image_suffixes():
    assert content_type_for(".png") == "image/png"
    assert content_type_for(".JPG") == "image/jpeg"  # case-insensitive
    assert content_type_for(".heic") == "image/heic"
    assert content_type_for(".xyz") == "application/octet-stream"


def test_safe_suffix_rejects_traversal_attempts():
    _assert_safe_suffix(".png")  # OK
    for bad in ("png", "./a", "../../pwn", ".a/b", ".a\\b", ".\x00evil"):
        with pytest.raises(ValueError):
            _assert_safe_suffix(bad)


# --- S3Storage behaviour ------------------------------------------------

def test_s3_save_builds_key_with_prefix_and_sse(s3_mock):
    s = S3Storage(bucket="xcs", prefix="images")
    rec = s.save(test_id=12, result_id=34, data=b"hello", suffix=".png")
    assert rec["path"] == "s3://xcs/images/12/34.png"
    # sha256 computed over the raw bytes — same hash regardless of backend.
    assert rec["sha256"] == (
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    )
    # Encryption is forced at upload time.
    (_, kw), = s3_mock.put_object.call_args_list
    assert kw["Bucket"] == "xcs"
    assert kw["Key"] == "images/12/34.png"
    assert kw["ContentType"] == "image/png"
    assert kw["ServerSideEncryption"] == "AES256"
    assert kw["Body"] == b"hello"


def test_s3_save_without_prefix(s3_mock):
    s = S3Storage(bucket="xcs", prefix="")
    rec = s.save(test_id=1, result_id=1, data=b"x", suffix=".jpg")
    assert rec["path"] == "s3://xcs/1/1.jpg"
    (_, kw), = s3_mock.put_object.call_args_list
    assert kw["Key"] == "1/1.jpg"


def test_s3_save_coerces_ids_to_int_so_key_is_always_numeric(s3_mock):
    """Belt-and-braces against a caller passing string ids that look
    valid but aren't. Int cast fails loudly instead of writing a weird
    key."""
    s = S3Storage(bucket="xcs")
    with pytest.raises((ValueError, TypeError)):
        s.save(test_id="../../evil", result_id=1, data=b"x", suffix=".png")  # type: ignore[arg-type]


def test_s3_read_rejects_paths_pointing_at_other_buckets(s3_mock):
    """DB poisoning protection: an attacker shouldn't be able to store
    ``s3://their-bucket/…`` as a result path and have us fetch from it."""
    s = S3Storage(bucket="xcs")
    with pytest.raises(PermissionError, match="outside configured bucket"):
        s.read("s3://attacker-bucket/some/key.png")
    # Nothing should have been fetched.
    assert not s3_mock.get_object.called


def test_s3_delete_rejects_paths_pointing_at_other_buckets(s3_mock):
    s = S3Storage(bucket="xcs")
    with pytest.raises(PermissionError):
        s.delete("s3://attacker-bucket/foo")
    assert not s3_mock.delete_object.called


def test_s3_read_calls_get_object_with_key(s3_mock):
    body = MagicMock()
    body.read.return_value = b"payload"
    s3_mock.get_object.return_value = {"Body": body}

    s = S3Storage(bucket="xcs", prefix="env/prod")
    data = s.read("s3://xcs/env/prod/7/9.png")
    assert data == b"payload"
    (_, kw), = s3_mock.get_object.call_args_list
    assert kw == {"Bucket": "xcs", "Key": "env/prod/7/9.png"}


def test_s3_delete_is_idempotent_like_fs(s3_mock):
    """S3 delete_object succeeds even when the key doesn't exist; the
    backend mirrors the filesystem one, which swallows FileNotFoundError."""
    s3_mock.delete_object.return_value = {}
    s = S3Storage(bucket="xcs")
    s.delete("s3://xcs/1/2.png")  # should not raise
    (_, kw), = s3_mock.delete_object.call_args_list
    assert kw == {"Bucket": "xcs", "Key": "1/2.png"}


# --- get_storage dispatcher --------------------------------------------

def test_get_storage_returns_fs_when_no_bucket_configured(tmp_path):
    s = Settings(mode="standalone", images_dir=str(tmp_path))
    backend = get_storage(s)
    assert isinstance(backend, FilesystemStorage)


def test_get_storage_returns_s3_when_bucket_set(s3_mock):
    s = Settings(mode="standalone", s3_bucket="xcs")
    backend = get_storage(s)
    assert isinstance(backend, S3Storage)
    assert backend.bucket == "xcs"


# --- DispatchingStorage (mixed-mode read/delete) -----------------------

def test_dispatching_storage_reads_filesystem_path_via_fs(tmp_path, s3_mock):
    """Mixed mode: after migrating FS → S3, old rows still have absolute
    paths. Reads should route them to the FS backend."""
    fs = FilesystemStorage(tmp_path)
    # Pre-write a legacy file as if it had been saved before migration.
    legacy = tmp_path / "1" / "1.png"
    legacy.parent.mkdir(parents=True)
    legacy.write_bytes(b"legacy")

    primary = S3Storage(bucket="xcs")
    dispatching = DispatchingStorage(primary, fs)

    assert dispatching.read(str(legacy)) == b"legacy"
    # S3 client must not have been touched.
    assert not s3_mock.get_object.called


def test_dispatching_storage_reads_s3_path_via_s3(tmp_path, s3_mock):
    body = MagicMock()
    body.read.return_value = b"new"
    s3_mock.get_object.return_value = {"Body": body}

    fs = FilesystemStorage(tmp_path)
    primary = S3Storage(bucket="xcs")
    dispatching = DispatchingStorage(primary, fs)

    assert dispatching.read("s3://xcs/1/1.png") == b"new"
    assert s3_mock.get_object.called


def test_dispatching_storage_rejects_s3_path_when_primary_is_fs(tmp_path):
    """If someone manages to poison the DB with an s3:// path while the
    app is FS-only, we refuse to open a random S3 client rather than
    silently contacting AWS."""
    fs = FilesystemStorage(tmp_path)
    dispatching = DispatchingStorage(fs, fs)
    with pytest.raises(RuntimeError, match="no S3 backend is configured"):
        dispatching.read("s3://some-bucket/foo")


def test_dispatching_storage_writes_always_go_to_primary(tmp_path, s3_mock):
    fs = FilesystemStorage(tmp_path)
    primary = S3Storage(bucket="xcs")
    dispatching = DispatchingStorage(primary, fs)

    rec = dispatching.save(test_id=5, result_id=6, data=b"y", suffix=".png")
    assert rec["path"].startswith("s3://xcs/")
    # Filesystem wasn't touched.
    assert list(tmp_path.iterdir()) == []
