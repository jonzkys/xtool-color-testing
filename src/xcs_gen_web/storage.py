"""Pluggable image storage backend.

Two implementations:

* :class:`FilesystemStorage` — writes under ``images_root``. Returns
  absolute paths. Default for single-host / single-user deployments.

* :class:`S3Storage` — writes to an S3 bucket using boto3's default
  credential chain (IAM role or similar — the app never holds
  long-lived credentials). Returns ``s3://bucket/key`` URIs.

The returned path is stored verbatim in ``results.image_path``. Read
and delete dispatch on the path prefix: absolute paths go to the
filesystem backend, ``s3://…`` URIs go to the S3 backend. This
means a deployment can migrate from FS to S3 without rewriting old
rows — everything old keeps reading from disk, everything new writes
to S3.

Security posture of the S3 backend:

* **No credentials in config.** All auth comes from boto3's default
  chain (IAM role, ECS task role, Lambda exec role, env, ~/.aws).
* **Server-side encryption enforced at upload.** Every object is
  written with ``ServerSideEncryption=AES256`` so data is encrypted
  at rest even if the bucket-level default isn't configured.
* **Bucket confinement.** Reads and deletes refuse to touch any
  bucket other than the one configured at startup — a poisoned DB
  row claiming ``s3://attacker-bucket/…`` can't exfiltrate or
  delete from the attacker's bucket.
* **No ACL writes.** Objects inherit the bucket's default ACL
  (private). The API proxies downloads through ``/api/results/{rid}/image``
  which enforces the owner check; we never hand out presigned URLs
  at this layer.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any, Protocol

from .config import Settings


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class StorageBackend(Protocol):
    """Minimal interface the app needs.

    ``kind`` lets callers attach sidecar artefacts to a result without
    overwriting the original (e.g. a cached warped image). Empty
    string keeps the legacy ``<id><suffix>`` filename; a non-empty
    value produces ``<id>-<kind><suffix>``.
    """

    def save(self, *, test_id: int, result_id: int, data: bytes,
             suffix: str, kind: str = "") -> dict[str, Any]: ...
    def save_at(self, path: str, data: bytes) -> None: ...
    def read(self, path: str) -> bytes: ...
    def delete(self, path: str) -> None: ...


# --------------------------------------------------------------------------
# Filesystem backend (default)
# --------------------------------------------------------------------------

class FilesystemStorage:
    def __init__(self, root: Path) -> None:
        self.root = root

    def save(
        self, *, test_id: int, result_id: int,
        data: bytes, suffix: str, kind: str = "",
    ) -> dict[str, Any]:
        _assert_safe_suffix(suffix)
        _assert_safe_kind(kind)
        target_dir = self.root / str(test_id)
        target_dir.mkdir(parents=True, exist_ok=True)
        suffix_kind = f"-{kind}" if kind else ""
        path = target_dir / f"{result_id}{suffix_kind}{suffix}"
        path.write_bytes(data)
        return {"path": str(path), "sha256": sha256_hex(data)}

    def save_at(self, path: str, data: bytes) -> None:
        """Write raw bytes to an explicit path. Used for path-convention
        sidecars (e.g. the cached HEIC→JPEG transcode) whose location
        is derived from a sibling path rather than ``(test_id,
        result_id, kind)``."""
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def read(self, path: str) -> bytes:
        return Path(path).read_bytes()

    def delete(self, path: str) -> None:
        try:
            Path(path).unlink()
        except FileNotFoundError:
            pass


# --------------------------------------------------------------------------
# S3 backend (optional)
# --------------------------------------------------------------------------

S3_URI_PREFIX = "s3://"
_SSE_ALGORITHM = "AES256"

# Minimal Content-Type map so browsers render inline and boto3 sets the
# right header on upload. Everything else falls back to octet-stream.
_CONTENT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
}


def content_type_for(suffix: str) -> str:
    return _CONTENT_TYPES.get(suffix.lower(), "application/octet-stream")


def _assert_safe_suffix(suffix: str) -> None:
    """Reject suffixes that could escape the key namespace (e.g. ``/../evil``).

    The upload route derives the suffix from ``Path(filename).suffix``
    which already strips directories, but belt-and-braces: suffixes
    must start with a dot and contain only safe chars. Applies to both
    backends so a buggy caller can't write outside the intended key.
    """
    if not suffix or not suffix.startswith("."):
        raise ValueError(f"suffix must start with '.', got {suffix!r}")
    if any(c in suffix for c in ("/", "\\", "\x00")):
        raise ValueError(f"suffix contains illegal chars: {suffix!r}")
    # Cap the suffix length — legitimate image extensions are short.
    if len(suffix) > 10:
        raise ValueError(f"suffix too long: {suffix!r}")


def _assert_safe_kind(kind: str) -> None:
    """``kind`` becomes part of the filename — same hardening as
    ``_assert_safe_suffix``. Empty is allowed (= no sidecar segment)."""
    if not kind:
        return
    if any(c in kind for c in ("/", "\\", "\x00", ".", " ")):
        raise ValueError(f"kind contains illegal chars: {kind!r}")
    if len(kind) > 16:
        raise ValueError(f"kind too long: {kind!r}")


def _parse_s3_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith(S3_URI_PREFIX):
        raise ValueError(f"not an s3 uri: {uri!r}")
    rest = uri[len(S3_URI_PREFIX):]
    bucket, _, key = rest.partition("/")
    if not bucket or not key:
        raise ValueError(f"malformed s3 uri: {uri!r}")
    return bucket, key


class S3Storage:
    """S3-backed storage. Requires boto3 to be installed.

    Only instantiate when ``settings.s3_bucket`` is set — the dispatcher
    in :func:`get_storage` handles that check.
    """

    def __init__(
        self, *, bucket: str, prefix: str = "",
        region: str | None = None,
        endpoint_url: str | None = None,
    ) -> None:
        try:
            import boto3  # noqa: F401
        except ImportError as e:  # pragma: no cover - import-guard path
            raise RuntimeError(
                "S3 storage is configured but boto3 isn't installed. "
                "Install with: pip install 'xcs-gen[s3]'"
            ) from e
        import boto3
        self.bucket = bucket
        # Normalise: strip leading/trailing slashes; collapse double slashes.
        self.prefix = "/".join(p for p in prefix.split("/") if p)
        self._client = boto3.client(
            "s3",
            region_name=region,
            endpoint_url=endpoint_url,
        )

    def _key(self, test_id: int, result_id: int, suffix: str, kind: str = "") -> str:
        parts = [p for p in (self.prefix, str(int(test_id))) if p]
        suffix_kind = f"-{kind}" if kind else ""
        parts.append(f"{int(result_id)}{suffix_kind}{suffix}")
        return "/".join(parts)

    def _uri(self, key: str) -> str:
        return f"{S3_URI_PREFIX}{self.bucket}/{key}"

    def _check_bucket(self, uri: str) -> str:
        """Parse an ``s3://`` URI and refuse anything not in our bucket.

        Returns the key. Raises PermissionError on bucket mismatch so
        the caller can map it to a 500-class error rather than
        silently touching a foreign bucket.
        """
        bucket, key = _parse_s3_uri(uri)
        if bucket != self.bucket:
            raise PermissionError(
                f"refused to access s3 object outside configured bucket "
                f"(got {bucket!r}, expected {self.bucket!r})"
            )
        return key

    def save(
        self, *, test_id: int, result_id: int,
        data: bytes, suffix: str, kind: str = "",
    ) -> dict[str, Any]:
        _assert_safe_suffix(suffix)
        _assert_safe_kind(kind)
        key = self._key(test_id, result_id, suffix, kind=kind)
        self._client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type_for(suffix),
            ServerSideEncryption=_SSE_ALGORITHM,
        )
        return {"path": self._uri(key), "sha256": sha256_hex(data)}

    def save_at(self, path: str, data: bytes) -> None:
        """Write to an explicit ``s3://`` URI. Refuses URIs outside the
        configured bucket, same posture as :meth:`read` / :meth:`delete`."""
        key = self._check_bucket(path)
        # Derive content-type from the path suffix so HEIC→JPEG sidecars
        # serve as ``image/jpeg`` if a future code path streams them
        # directly from S3.
        suffix = "." + path.rsplit(".", 1)[-1] if "." in path else ""
        self._client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type_for(suffix),
            ServerSideEncryption=_SSE_ALGORITHM,
        )

    def read(self, path: str) -> bytes:
        import botocore.exceptions

        key = self._check_bucket(path)
        try:
            resp = self._client.get_object(Bucket=self.bucket, Key=key)
        except botocore.exceptions.ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            # Normalise S3's "missing object" signal to the same exception
            # the filesystem backend raises, so callers (e.g. the reingest
            # endpoint) can have a single error path that works on both
            # storage types.
            if code in ("NoSuchKey", "404"):
                raise FileNotFoundError(path) from e
            raise
        return resp["Body"].read()

    def delete(self, path: str) -> None:
        key = self._check_bucket(path)
        # S3 delete is idempotent — missing keys are a no-op, matching
        # the filesystem backend's FileNotFoundError swallowing.
        self._client.delete_object(Bucket=self.bucket, Key=key)


# --------------------------------------------------------------------------
# Dispatcher
# --------------------------------------------------------------------------

def default_fs_root() -> Path:
    """Legacy fallback when no images_dir is configured."""
    override = os.environ.get("XCS_GEN_IMAGES_DIR")
    if override:
        return Path(override)
    return Path.home() / ".xcs-gen" / "images"


def get_storage(settings: Settings) -> StorageBackend:
    """Construct the backend implied by the current settings.

    * ``s3_bucket`` set → :class:`S3Storage`.
    * otherwise → :class:`FilesystemStorage` rooted at ``images_dir`` or
      ``~/.xcs-gen/images``.

    Returns a fresh instance on every call; callers are expected to
    cache it once per app (``create_app`` stashes the result on
    ``app.state.storage``).
    """
    if settings.s3_bucket:
        return S3Storage(
            bucket=settings.s3_bucket,
            prefix=settings.s3_prefix,
            region=settings.s3_region,
            endpoint_url=settings.s3_endpoint_url,
        )
    root = Path(settings.images_dir) if settings.images_dir else default_fs_root()
    return FilesystemStorage(root)


class DispatchingStorage:
    """Wraps a primary backend (from settings) but dispatches reads +
    deletes based on the stored path's prefix.

    Writes always go to the primary. Reads and deletes route to the
    filesystem backend for absolute paths and to the S3 backend for
    ``s3://…`` URIs, so legacy rows keep working after a migration.
    """

    def __init__(self, primary: StorageBackend, fs_fallback: FilesystemStorage) -> None:
        self._primary = primary
        self._fs = fs_fallback

    def save(self, **kw: Any) -> dict[str, Any]:
        return self._primary.save(**kw)

    def _backend_for(self, path: str) -> StorageBackend:
        if path.startswith(S3_URI_PREFIX):
            # Only the S3 backend can resolve this path. If the primary
            # is FS (an unusual mixed-mode config), raise — rather than
            # silently creating a rogue S3 client.
            if not isinstance(self._primary, S3Storage):
                raise RuntimeError(
                    "encountered s3:// stored path but no S3 backend is "
                    "configured. Set XCS_GEN_S3_BUCKET to the owning bucket."
                )
            return self._primary
        return self._fs

    def save_at(self, path: str, data: bytes) -> None:
        self._backend_for(path).save_at(path, data)

    def read(self, path: str) -> bytes:
        return self._backend_for(path).read(path)

    def delete(self, path: str) -> None:
        self._backend_for(path).delete(path)
