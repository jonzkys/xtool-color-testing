"""Changelog loader.

Reads every ``*.md`` file under ``changelog/`` (repo-relative), parses a
simple YAML frontmatter block, and returns a list of entries sorted by
date (newest first).

Entry file format::

    ---
    id: 2026-04-23-loom
    date: 2026-04-23
    level: major            # major | minor
    title: Loom — gradient-hatched fill
    summary: One-line blurb shown in the list view.
    images:                 # optional, majors only
      - src: loom-preview.png
        caption: A silhouette filled with gradient hatch.
    ---

    Markdown body. Only rendered for ``major`` entries.

``images[].src`` is resolved against ``changelog/images/`` at render
time (the backend serves that directory as ``/changelog-media/``), so
entries just reference filenames.

Parsing is deliberately a regex-based minimal parser rather than
pulling in ``python-frontmatter``. The frontmatter format is stable
and small; a hard dep is not worth the extra install surface.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml


LOGGER = logging.getLogger(__name__)


# Level taxonomy — trivial changes intentionally absent: they don't get
# an entry. Keep the set closed so typos in frontmatter surface early.
_LEVELS = {"major", "minor"}

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.DOTALL)


@dataclass
class ChangelogImage:
    src: str
    caption: str = ""


@dataclass
class ChangelogEntry:
    id: str
    date: str                 # ISO YYYY-MM-DD
    level: str                # "major" | "minor"
    title: str
    summary: str = ""
    body_md: str = ""         # raw markdown body; empty for minors
    images: list[ChangelogImage] = field(default_factory=list)

    def to_api(self) -> dict:
        return {
            "id": self.id,
            "date": self.date,
            "level": self.level,
            "title": self.title,
            "summary": self.summary,
            "body_md": self.body_md,
            "images": [
                {"src": f"/changelog-media/{img.src}", "caption": img.caption}
                for img in self.images
            ],
        }


def _parse_entry(path: Path) -> ChangelogEntry | None:
    """Parse one ``.md`` file. Returns ``None`` on malformed input so a
    single bad entry doesn't take the whole page down — just logs a
    warning and moves on."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        LOGGER.warning("changelog: failed to read %s: %s", path, e)
        return None

    m = _FRONTMATTER_RE.match(text)
    if not m:
        LOGGER.warning("changelog: %s missing frontmatter block; skipping", path.name)
        return None

    try:
        meta = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError as e:
        LOGGER.warning("changelog: %s has invalid YAML: %s", path.name, e)
        return None

    body = m.group(2).strip()

    required = ("id", "date", "level", "title")
    missing = [k for k in required if not meta.get(k)]
    if missing:
        LOGGER.warning(
            "changelog: %s missing required fields %s; skipping",
            path.name, missing,
        )
        return None

    level = str(meta["level"]).strip().lower()
    if level not in _LEVELS:
        LOGGER.warning(
            "changelog: %s has unknown level %r (want one of %s); skipping",
            path.name, level, sorted(_LEVELS),
        )
        return None

    images_raw = meta.get("images") or []
    images = []
    for entry in images_raw:
        if isinstance(entry, str):
            images.append(ChangelogImage(src=entry))
        elif isinstance(entry, dict) and entry.get("src"):
            images.append(ChangelogImage(
                src=str(entry["src"]),
                caption=str(entry.get("caption", "")),
            ))

    return ChangelogEntry(
        id=str(meta["id"]).strip(),
        date=str(meta["date"]).strip(),
        level=level,
        title=str(meta["title"]).strip(),
        summary=str(meta.get("summary", "")).strip(),
        body_md=body if level == "major" else "",
        images=images,
    )


def load_entries(changelog_dir: Path) -> list[ChangelogEntry]:
    """Load and sort all entries in ``changelog_dir``. Newest first."""
    if not changelog_dir.exists() or not changelog_dir.is_dir():
        return []
    entries: list[ChangelogEntry] = []
    seen_ids: set[str] = set()
    for path in sorted(changelog_dir.glob("*.md")):
        entry = _parse_entry(path)
        if entry is None:
            continue
        if entry.id in seen_ids:
            LOGGER.warning(
                "changelog: duplicate id %r in %s; skipping",
                entry.id, path.name,
            )
            continue
        seen_ids.add(entry.id)
        entries.append(entry)
    # Sort by (date desc, id desc) so ties break on a consistent key.
    entries.sort(key=lambda e: (e.date, e.id), reverse=True)
    return entries


def latest_id(entries: list[ChangelogEntry]) -> str | None:
    return entries[0].id if entries else None
