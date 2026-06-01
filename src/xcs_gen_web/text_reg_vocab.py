"""TextReg <-> validation-profile field-name vocabulary.

TextReg stores ``repeat``/``mopa_frequency``/``processing_light_source``;
the validation profiles use ``passes``/``frequency``/``laser``. These maps
rename in both directions so TextReg params can be validated/rendered with
the shared profile machinery. Keep in sync with web/src/lib/textRegVocab.ts.
"""

from __future__ import annotations

TEXTREG_TO_PROFILE: dict[str, str] = {
    "repeat": "passes",
    "mopa_frequency": "frequency",
    "processing_light_source": "laser",
}
PROFILE_TO_TEXTREG: dict[str, str] = {v: k for k, v in TEXTREG_TO_PROFILE.items()}


def to_profile(params: dict) -> dict:
    """Rename TextReg field names to profile field names (others passthrough)."""
    return {TEXTREG_TO_PROFILE.get(k, k): v for k, v in params.items()}


def from_profile(params: dict) -> dict:
    """Rename profile field names back to TextReg field names."""
    return {PROFILE_TO_TEXTREG.get(k, k): v for k, v in params.items()}
