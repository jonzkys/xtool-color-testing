# Open-Source Announcement + GitHub TopBar Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Announce that `xcs-gen` is open source on GitHub via a major changelog post, and surface the repo with an icon-only GitHub link in the TopBar action cluster.

**Architecture:** Two surface-level additions, no new modules. (1) A markdown file in `changelog/` that the existing `xcs_gen_web.changelog` parser picks up automatically. (2) A new `<a>` element in `web/src/components/TopBar.tsx`, styled as a square icon-only pill in the same visual family as the existing Guide / Log / Upload buttons but compressed to icon-only since the GitHub link is a meta action rather than a workbench tool.

**Tech Stack:** Markdown + YAML frontmatter (changelog), React + Tailwind v4 + lucide-react `Github` icon (TopBar), Python 3 + FastAPI for the changelog parser path that consumes the new file.

**Spec:** `docs/superpowers/specs/2026-04-25-open-source-announcement-design.md`

**Branch:** `feat/open-source-announcement` (already created off `main`; design doc is committed there).

**Repo URL constant (used twice in this plan):** `https://github.com/jonzkys/xtool-color-testing`

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `changelog/2026-04-25-open-source.md` | **Create** | Major changelog entry. Body explains the open-sourcing, MIT license, three on-ramps (issues / discussions / suggestions), upcoming Docker image, and points at the new TopBar icon. |
| `web/src/components/TopBar.tsx` | **Modify** | Two edits: (1) add `Github` to the `lucide-react` import on line 2, (2) insert a new external-link anchor between the existing Upload `<button>` and `<ThemeToggle />` inside the right-cluster `<div className="ml-auto …">`. |

No backend code change. No new tests. The existing changelog parser tests (covering the `parse_entries` happy path) and `tsc --noEmit` (covering the import) are sufficient — verifying this two-surface change beyond that is what manual browser checks are for.

---

## Task 1: Changelog entry

**Files:**
- Create: `changelog/2026-04-25-open-source.md`

This is a content task. The "test" is that the existing parser ingests it without warnings and that the entry renders correctly in the SPA. The parser logs warnings on missing required keys or unknown `level`, so we exercise it by hitting the API.

- [ ] **Step 1.1: Create the changelog file**

Create `changelog/2026-04-25-open-source.md` with this exact content:

```markdown
---
id: 2026-04-25-open-source
date: 2026-04-25
created_at: 2026-04-25T20:00:00Z
level: major
title: xcs-gen is open source
summary: The source is on GitHub under MIT — file issues, share burns, suggest features.
---

`xcs-gen` is now public on GitHub at
[github.com/jonzkys/xtool-color-testing](https://github.com/jonzkys/xtool-color-testing),
released under the MIT license.

**Nothing changes for the workbench.** The hosted instance keeps running
exactly as before; if you don't care about the source, you don't have to
do anything. Your tests, library, palette, and machines are untouched.

**If you do care, three doors are open.**

- **Issues** for reproducible bugs — anything you can describe with
  steps and an expected vs. actual outcome. There's a bug-report
  template that asks for the right context up front.
- **Discussions** for the open-ended stuff: how would you tackle a
  particular pattern, why does *this* shape need 38 W instead of 32 W,
  what burns are you proudest of. Show your work.
- **Suggestions and feature requests** through the feature-request
  template, or as a Discussion if you'd rather sketch the idea before
  pinning it to a ticket.

**Coming soon:** a Docker image so the whole workbench runs locally with
one command — no `uv`, no `npm`, no Python version juggling. If that's
the thing keeping you on the hosted instance, watch this space.

The new GitHub icon in the TopBar (top right, between Upload and the
theme toggle) opens the repo in a new tab from anywhere in the
workbench.
```

The `created_at` of `T20:00:00Z` is later than the existing
`2026-04-25T16:30:00Z` on the multi-machine entry, so the open-source
post sorts to the top of the list. Don't change this without checking
the sort order in `src/xcs_gen_web/changelog.py:69-70`.

- [ ] **Step 1.2: Verify the parser ingests it**

Run the changelog parser unit tests (they iterate the `changelog/` directory):

```bash
uv run --active pytest tests/ -q -k changelog
```

Expected: PASS. No warnings about missing frontmatter, unknown level, or unknown keys.

- [ ] **Step 1.3: Smoke-check the API serves it**

Start the dev server in the background, hit the changelog API, then stop the server:

```bash
uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
SERVER_PID=$!
sleep 2
curl -s http://127.0.0.1:8017/api/changelog | python -m json.tool | head -40
kill $SERVER_PID
```

Expected output: the JSON list starts with `id: "2026-04-25-open-source"`, `level: "major"`, body present (non-empty `body_md`).

- [ ] **Step 1.4: Commit**

```bash
git add changelog/2026-04-25-open-source.md
git commit -m "$(cat <<'EOF'
docs: changelog entry for open-source announcement

Major-level entry announcing the GitHub move under MIT, with on-ramps
for issues / discussions / feature requests and a heads-up about an
upcoming Docker image.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: TopBar GitHub button

**Files:**
- Modify: `web/src/components/TopBar.tsx` (line 2 import; new anchor inside the `ml-auto` cluster, currently `web/src/components/TopBar.tsx:89-141`)

- [ ] **Step 2.1: Add `Github` to the `lucide-react` import**

Edit `web/src/components/TopBar.tsx` line 2:

Change:

```tsx
import { BookOpen, Sparkles, UploadCloud } from "lucide-react";
```

To:

```tsx
import { BookOpen, Github, Sparkles, UploadCloud } from "lucide-react";
```

- [ ] **Step 2.2: Insert the GitHub anchor between Upload and ThemeToggle**

In the right-cluster `<div>` (currently `web/src/components/TopBar.tsx:89-142`), find the closing `</button>` of the Upload button (currently line 140) immediately followed by `<ThemeToggle />` on line 141. Insert the new anchor between them.

Locate this block:

```tsx
              <UploadCloud className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="font-mono text-[10.5px] tracking-[0.12em] uppercase font-semibold">
                Upload
              </span>
            </button>
            <ThemeToggle />
```

Replace with:

```tsx
              <UploadCloud className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="font-mono text-[10.5px] tracking-[0.12em] uppercase font-semibold">
                Upload
              </span>
            </button>
            <a
              href="https://github.com/jonzkys/xtool-color-testing"
              target="_blank"
              rel="noopener noreferrer"
              title="View source on GitHub"
              aria-label="View source on GitHub (opens in new tab)"
              className={cn(
                "inline-flex items-center justify-center h-7 w-7 rounded-[6px]",
                "border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]",
                "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-primary)]",
                "hover:border-[color:var(--color-primary)]/50 hover:bg-[color:var(--color-primary-tint)]/40",
                "transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
              )}
            >
              <Github className="h-3.5 w-3.5" strokeWidth={1.75} />
            </a>
            <ThemeToggle />
```

Notes:
- `<a>` not `<button>` — external navigation, semantically an anchor.
- `target="_blank"` + `rel="noopener noreferrer"` — opens in new tab without leaking the workbench's window reference.
- `h-7 w-7` square + `justify-center` — the visual family matches Guide/Upload but compressed since the icon stands alone.
- No active state, no unseen-badge logic, and no usage of `route` or `onNavigate` — the link is never the current route and never an in-app navigation.

- [ ] **Step 2.3: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: PASS, no errors. (If it fails on the import, double-check that `lucide-react` exports `Github` — it does in the version pinned in `web/package.json`.)

- [ ] **Step 2.4: Run the frontend test suite**

```bash
cd web && npm test
```

Expected: PASS. No tests target TopBar directly, so this run is a regression check that nothing else broke.

- [ ] **Step 2.5: Rebuild `web/dist/`**

`xcs-gen serve` mounts `web/dist/`, not the Vite dev server (per `CLAUDE.md`). Without a rebuild, browser checks would test the old bundle.

```bash
cd web && npm run build > /dev/null 2>&1
```

Expected: exit 0. (Gitignored output — nothing to commit from this step.)

- [ ] **Step 2.6: Browser check — golden path**

Start the server in the background:

```bash
uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
SERVER_PID=$!
sleep 2
```

In a real browser at `http://127.0.0.1:8017/`:

1. The TopBar renders with this right-cluster order: page title, Machine switcher, vertical divider, Guide pill, Log/New pill, Upload pill, **GitHub icon**, theme toggle.
2. The GitHub icon is square, same height as the other pills, with the `lucide` Github mark centered.
3. Hovering the GitHub icon shows the primary-tint hover treatment used elsewhere; tooltip reads "View source on GitHub".
4. Clicking the GitHub icon opens `https://github.com/jonzkys/xtool-color-testing` in a new tab; the workbench tab is unaffected.
5. Resize the window to ~1280px wide — the right cluster still fits on one row without wrapping or overflow.

Stop the server:

```bash
kill $SERVER_PID
```

If any of the five points above fails, fix the styling / placement before continuing. Otherwise proceed.

- [ ] **Step 2.7: Browser check — changelog entry**

Restart the server (or reuse the one above), then in the browser:

1. Navigate to `http://127.0.0.1:8017/#/changelog`.
2. The `2026-04-25-open-source` entry is at the top of the list (above the `multi-machine-support` and `palette-manual-favorites` entries from the same day).
3. The body renders cleanly: title is bold, the markdown link to the repo is clickable and points at `https://github.com/jonzkys/xtool-color-testing`, the "Coming soon" / Docker paragraph is present, no rendering glitches.
4. The TopBar Log button shows the unseen "NEW" treatment until the changelog page is opened. After the page is open and visible long enough to fire the seen event, the badge clears in the same tab. (If the badge does not clear, the entry's `id` may not match the filename stem — verify both are `2026-04-25-open-source`.)

Stop the server again if you started a new one.

- [ ] **Step 2.8: Commit**

```bash
git add web/src/components/TopBar.tsx
git commit -m "$(cat <<'EOF'
feat(web): GitHub link in the TopBar action cluster

Icon-only square pill placed between Upload and the theme toggle.
Opens github.com/jonzkys/xtool-color-testing in a new tab.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: PR

- [ ] **Step 3.1: Push the branch**

```bash
git push -u origin feat/open-source-announcement
```

- [ ] **Step 3.2: Open a draft PR**

```bash
gh pr create --draft --title "feat: open-source announcement + GitHub link in TopBar" --body "$(cat <<'EOF'
## Summary

- Major changelog entry announcing `xcs-gen` is open source on GitHub under MIT, with on-ramps for issues / discussions / feature requests and a teaser for an upcoming Docker image.
- New icon-only GitHub link in the TopBar action cluster, between Upload and the theme toggle. Opens the repo in a new tab.

Issues / Discussions surfacing inside the workbench is intentionally deferred — this PR ships only the single GitHub link per the brainstormed scope. Spec: `docs/superpowers/specs/2026-04-25-open-source-announcement-design.md`.

## Test plan

- [ ] `uv run --active pytest tests/ -q -k changelog` is green.
- [ ] `cd web && npx tsc --noEmit` is green.
- [ ] `cd web && npm test` is green.
- [ ] `cd web && npm run build` succeeds.
- [ ] Browser: TopBar has a GitHub icon between Upload and the theme toggle. Clicking opens the repo in a new tab. Row does not overflow at ~1280px.
- [ ] Browser: `#/changelog` shows the new entry at the top. Markdown renders cleanly. Repo link works. The "NEW" badge on the TopBar Log button clears once the page is viewed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3.3: Mark ready for review once CI is green**

Watch CI:

```bash
gh pr checks --watch
```

When all checks pass:

```bash
gh pr ready
```

If CI fails, do not flip to ready. Investigate the failure (most likely path: typecheck or the changelog parser warning on a frontmatter typo) and push a fix commit on the same branch.

---

## Self-review notes

**Spec coverage:**
- Changelog entry — Task 1 ✓
- Workshop-Instrument voice with the five topics in the spec's order — Task 1.1 (the body is written out in full, not paraphrased) ✓
- Docker mention as forthcoming — Task 1.1 ✓
- TopBar import + anchor — Task 2.1 / 2.2 ✓
- Icon-only square pill, between Upload and ThemeToggle, external-link semantics — Task 2.2 ✓
- No new tests by design — Tasks 1.2 / 2.3 / 2.4 use existing suites only ✓
- Manual browser checks for both surfaces — Tasks 2.6 / 2.7 ✓
- `npm run build` to refresh `web/dist/` before browser checks — Task 2.5 ✓
- Branch + draft PR + CI gate — Task 3 ✓

**Out of scope (explicitly):** Issues / Discussions in TopBar, "Report a bug" UI, Docker image itself, README badges. Not in this plan; surfaced in the PR body.

**Type / name consistency:** the only new identifier is the `Github` lucide import; used once. The repo URL appears verbatim in the changelog markdown (Task 1.1) and the TopBar `href` (Task 2.2) — both spell `jonzkys/xtool-color-testing` exactly. Confirmed against `git remote -v`.

**Placeholder scan:** zero TODOs, zero "implement later", every code block is complete and committable.
