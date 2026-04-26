"""Pure aggregator functions for distilling a region of BGR pixels into
a single (b, g, r) tuple.

Each aggregator takes ``(N, 3)`` uint8 BGR input and returns
``(b, g, r)`` ints in [0, 255]. No I/O, no shared state. Composed by the
sampler in ``xcs_gen_web.capture_sampling`` after a cell mask is applied.

Adding a new aggregator: implement ``aggregate_<name>(pixels) -> tuple``,
add the name to :data:`LEGAL_AGGREGATORS`, and register a branch in
:func:`aggregate`. Tests in ``tests/test_sampling_aggregators.py``.
"""

from __future__ import annotations

import cv2
import numpy as np

LEGAL_AGGREGATORS: tuple[str, ...] = (
    "median",
    "mean",
    "saturation_median",
    "trimmed_mean",
    "kmeans_dominant",
)


def _to_int_bgr(arr: np.ndarray) -> tuple[int, int, int]:
    """Coerce a length-3 ndarray to a (b, g, r) int tuple."""
    return int(arr[0]), int(arr[1]), int(arr[2])


def aggregate_median(pixels: np.ndarray) -> tuple[int, int, int]:
    """Per-channel median of all pixels."""
    if pixels.size == 0:
        return (0, 0, 0)
    return _to_int_bgr(np.median(pixels, axis=0).astype(np.uint8))


def aggregate_mean(pixels: np.ndarray) -> tuple[int, int, int]:
    """Per-channel mean of all pixels."""
    if pixels.size == 0:
        return (0, 0, 0)
    return _to_int_bgr(np.mean(pixels, axis=0).astype(np.uint8))


def aggregate_saturation_median(pixels: np.ndarray) -> tuple[int, int, int]:
    """Median of the most-saturated half of the pixels.

    Designed for MOPA gradient strips where a thin colored band sits in
    a mostly-substrate cell — the saturation filter keeps the vivid peak
    rather than averaging it away with substrate.
    """
    if pixels.size == 0:
        return (0, 0, 0)
    if len(pixels) < 4:
        return aggregate_median(pixels)
    hsv = cv2.cvtColor(
        pixels.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_BGR2HSV,
    )
    sats = hsv.reshape(-1, 3)[:, 1]
    threshold = float(np.median(sats))
    mask = sats >= threshold
    vivid = pixels[mask] if mask.any() else pixels
    return _to_int_bgr(np.median(vivid, axis=0).astype(np.uint8))


def aggregate_trimmed_mean(
    pixels: np.ndarray, trim: float = 0.10,
) -> tuple[int, int, int]:
    """Drop the top and bottom ``trim`` fraction of pixels by luminance,
    then take the per-channel mean of the rest. Robust to glare / dust
    specks."""
    if pixels.size == 0:
        return (0, 0, 0)
    if len(pixels) < 4:
        return aggregate_median(pixels)
    # Luminance proxy: 0.114 B + 0.587 G + 0.299 R (Rec. 601).
    lum = (
        pixels[:, 0].astype(np.float32) * 0.114
        + pixels[:, 1].astype(np.float32) * 0.587
        + pixels[:, 2].astype(np.float32) * 0.299
    )
    n = len(pixels)
    drop = max(1, int(round(n * trim)))
    order = np.argsort(lum)
    keep = order[drop : n - drop] if (n - 2 * drop) > 0 else order
    return _to_int_bgr(np.mean(pixels[keep], axis=0).astype(np.uint8))


def aggregate_kmeans_dominant(
    pixels: np.ndarray, n_clusters: int = 3,
) -> tuple[int, int, int]:
    """Run K-Means on the pixels and return the centroid of the cluster
    with the most members. Falls back to the plain median when there are
    fewer distinct colours than ``n_clusters``."""
    if pixels.size == 0:
        return (0, 0, 0)
    distinct = np.unique(pixels.reshape(-1, 3), axis=0)
    if len(distinct) < n_clusters:
        return aggregate_median(pixels)
    from sklearn.cluster import KMeans

    km = KMeans(n_clusters=n_clusters, n_init=4, random_state=0)
    labels = km.fit_predict(pixels.astype(np.float32))
    counts = np.bincount(labels, minlength=n_clusters)
    dominant = int(np.argmax(counts))
    centroid = km.cluster_centers_[dominant]
    return _to_int_bgr(np.clip(centroid, 0, 255).astype(np.uint8))


_DISPATCH = {
    "median": aggregate_median,
    "mean": aggregate_mean,
    "saturation_median": aggregate_saturation_median,
    "trimmed_mean": aggregate_trimmed_mean,
    "kmeans_dominant": aggregate_kmeans_dominant,
}


def aggregate(name: str, pixels: np.ndarray) -> tuple[int, int, int]:
    """Dispatch by aggregator name. Raises ValueError on unknown names."""
    fn = _DISPATCH.get(name)
    if fn is None:
        raise ValueError(
            f"unknown aggregator: {name!r}; legal values: {LEGAL_AGGREGATORS}",
        )
    return fn(pixels)
