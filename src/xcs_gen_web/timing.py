"""Lightweight phase-timing context manager.

Used to measure where wall-clock goes inside request handlers without
spraying ``time.perf_counter`` pairs everywhere. Each ``phase(name)``
block logs its duration on exit; the enclosing ``TimingReport``
collects a summary so we can emit one aggregated line at the end.
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from dataclasses import dataclass, field


@dataclass
class TimingReport:
    """Accumulates phase durations for an aggregated summary line."""

    label: str
    phases: list[tuple[str, float]] = field(default_factory=list)
    extras: dict[str, int | float | str] = field(default_factory=dict)
    _started_at: float = field(default_factory=time.perf_counter)
    _logger: logging.Logger = field(default_factory=lambda: logging.getLogger("xcs_gen.timing"))

    @contextmanager
    def phase(self, name: str):
        """Time a block; records the duration + logs at DEBUG on exit."""
        t0 = time.perf_counter()
        try:
            yield
        finally:
            dt = time.perf_counter() - t0
            self.phases.append((name, dt))
            self._logger.debug("%s · %s: %.3fs", self.label, name, dt)

    def set(self, key: str, value: int | float | str) -> None:
        """Attach a scalar to the report (e.g. shape_count, layer_count)."""
        self.extras[key] = value

    def emit(self) -> None:
        """Log one INFO line summarising total + per-phase breakdown.

        Format stays machine-greppable: ``label total=Xs phase1=Ys phase2=Zs extra=...``.
        """
        total = time.perf_counter() - self._started_at
        parts = [f"{self.label} total={total:.3f}s"]
        for name, dt in self.phases:
            parts.append(f"{name}={dt:.3f}s")
        for k, v in self.extras.items():
            if isinstance(v, float):
                parts.append(f"{k}={v:.3f}")
            else:
                parts.append(f"{k}={v}")
        self._logger.info(" ".join(parts))
