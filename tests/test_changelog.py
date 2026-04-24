"""Tests for the changelog frontmatter parser + loader."""

from __future__ import annotations

from pathlib import Path

import pytest

from xcs_gen_web.changelog import load_entries


def _write(tmp: Path, name: str, body: str) -> None:
    (tmp / name).write_text(body, encoding="utf-8")


def test_parses_major_with_body(tmp_path: Path) -> None:
    _write(tmp_path, "2026-04-23-foo.md", """---
id: 2026-04-23-foo
date: 2026-04-23
level: major
title: Foo
summary: Did a foo.
images:
  - src: foo.png
    caption: A foo
---

Body **here**.
""")
    entries = load_entries(tmp_path)
    assert len(entries) == 1
    e = entries[0]
    assert e.id == "2026-04-23-foo"
    assert e.level == "major"
    assert e.body_md == "Body **here**."
    assert e.images == [type(e.images[0])(src="foo.png", caption="A foo")]


def test_minor_ignores_body(tmp_path: Path) -> None:
    _write(tmp_path, "2026-04-22-bar.md", """---
id: 2026-04-22-bar
date: 2026-04-22
level: minor
title: Bar
---

Some body that should be dropped for minors.
""")
    entries = load_entries(tmp_path)
    assert len(entries) == 1
    assert entries[0].body_md == ""


def test_sorts_newest_first(tmp_path: Path) -> None:
    _write(tmp_path, "a.md", "---\nid: 2026-04-01-a\ndate: 2026-04-01\nlevel: minor\ntitle: A\n---\n")
    _write(tmp_path, "b.md", "---\nid: 2026-04-03-b\ndate: 2026-04-03\nlevel: minor\ntitle: B\n---\n")
    _write(tmp_path, "c.md", "---\nid: 2026-04-02-c\ndate: 2026-04-02\nlevel: minor\ntitle: C\n---\n")
    entries = load_entries(tmp_path)
    assert [e.date for e in entries] == ["2026-04-03", "2026-04-02", "2026-04-01"]


@pytest.mark.parametrize("missing", ["id", "date", "level", "title"])
def test_skips_entries_missing_required_fields(tmp_path: Path, missing: str, caplog) -> None:
    meta = {"id": "x", "date": "2026-04-01", "level": "minor", "title": "T"}
    del meta[missing]
    lines = "\n".join(f"{k}: {v}" for k, v in meta.items())
    _write(tmp_path, "broken.md", f"---\n{lines}\n---\n")
    with caplog.at_level("WARNING"):
        entries = load_entries(tmp_path)
    assert entries == []


def test_skips_unknown_level(tmp_path: Path) -> None:
    _write(tmp_path, "x.md", "---\nid: x\ndate: 2026-04-01\nlevel: cataclysmic\ntitle: T\n---\n")
    assert load_entries(tmp_path) == []


def test_missing_frontmatter_is_skipped(tmp_path: Path) -> None:
    _write(tmp_path, "plain.md", "Just a markdown body, no frontmatter.\n")
    assert load_entries(tmp_path) == []


def test_duplicate_ids_skipped(tmp_path: Path) -> None:
    _write(tmp_path, "a.md", "---\nid: dup\ndate: 2026-04-02\nlevel: minor\ntitle: A\n---\n")
    _write(tmp_path, "b.md", "---\nid: dup\ndate: 2026-04-01\nlevel: minor\ntitle: B\n---\n")
    entries = load_entries(tmp_path)
    # One of them wins (whichever sorts first alphabetically); the other
    # is dropped with a warning.
    assert len(entries) == 1


def test_missing_dir_returns_empty(tmp_path: Path) -> None:
    assert load_entries(tmp_path / "nope") == []
