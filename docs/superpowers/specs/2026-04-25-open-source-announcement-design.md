# Open-source announcement + GitHub link in TopBar

**Date:** 2026-04-25
**Status:** design — pending implementation plan
**Surface area:** `changelog/2026-04-25-open-source.md` (new), `web/src/components/TopBar.tsx`.

## Goal

Mark the public open-sourcing of `xcs-gen` (the repo went public earlier
today; `LICENSE` and GitHub issue templates are already on `main`) with:

1. A **major** changelog entry that announces the move, links the repo,
   invites issues / discussions / suggestions, and previews an upcoming
   Docker image for local runs.
2. A **GitHub button** in the TopBar so the repo is one click away from
   anywhere in the workbench.

No code-shape, API, or behaviour changes beyond those two surfaces.

## Non-goals

- Issues link in TopBar (deferred — single GitHub link for now).
- Discussions link in TopBar (deferred).
- "Report a bug" UI hooked into the GitHub issue templates.
- README badges, `package.json` `repository` field, footer link, etc.
- The Docker image itself — only mentioned as forthcoming in the
  changelog body. Tracked separately.

## Design

### 1. Changelog entry — `changelog/2026-04-25-open-source.md`

Frontmatter:

```yaml
---
id: 2026-04-25-open-source
date: 2026-04-25
level: major
title: xcs-gen is open source
summary: The source code is on GitHub under MIT — file issues, share burns, suggest features.
---
```

No `images:` block — the post is a project-event announcement, not a
visual feature, and an image would be filler. (If we later want one, a
screenshot of the repo page is the obvious choice.)

Body, in Workshop-Instrument voice (~150 words, prose paragraphs not
bullet-blast). Covers, in order:

1. The move itself: `xcs-gen` is now public on GitHub, MIT-licensed.
   Repo URL stated inline in prose, not buried in a footnote.
2. **What hasn't changed**: the hosted workbench keeps running exactly
   as before; users who don't care about source code don't need to do
   anything.
3. **What you can do now**, three concrete on-ramps:
   - **Issues** for reproducible bugs (existing bug-report template).
   - **Discussions** for "how would I tackle X with this?",
     show-your-burns, design questions.
   - **Feature requests / suggestions** via the feature-request template
     or as a Discussion.
4. **Coming soon**: a Docker image so you can run the whole workbench
   locally with one command (no `uv` / `npm` setup). Phrased as a
   forthcoming item, not a commitment with a date.
5. A closing sentence pointing at the new GitHub icon in the TopBar.

The repository URL is **`https://github.com/jonzkys/xtool-color-testing`**
(confirmed from `git remote -v`).

### 2. TopBar GitHub button — `web/src/components/TopBar.tsx`

**Import change** (line 2):

```diff
-import { BookOpen, Sparkles, UploadCloud } from "lucide-react";
+import { BookOpen, Github, Sparkles, UploadCloud } from "lucide-react";
```

**Placement**: inside the right action cluster, **between the Upload
button and `<ThemeToggle />`**, so the GitHub link sits with the other
meta/utility actions rather than the workbench-task actions.

**Form factor**: icon-only square pill (Option B from brainstorming).
Same border / hover / focus styling as Guide / Upload so it reads as
the same visual family, but **no label and square footprint** so it
doesn't widen the row further on narrower viewports.

```tsx
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
```

Notes:

- It's an `<a>`, not a `<button>` — it navigates externally, so an
  anchor is the right element semantically. (All the other right-cluster
  controls are buttons because they trigger in-app actions.)
- No active state, no unseen-badge logic — the link is never the
  current route, and there's nothing to count.
- The icon size (`h-3.5 w-3.5`, `strokeWidth={1.75}`) matches the
  other right-cluster icons exactly.

**URL constant**: inline. There is no other place in the codebase that
needs the GitHub URL right now; introducing a `constants.ts` for a
single usage would be premature abstraction.

### 3. Tests

- **No new pytest tests.** Web-only change.
- **No new vitest test for TopBar.** TopBar has no existing render test;
  introducing one just for this button would be disproportionate. The
  frontend `tsc --noEmit` covers the import / typing.
- **Backend changelog parsing** is already tested generically — the new
  markdown file is picked up by the existing parser; no new test needed
  unless the post uses a frontmatter shape we haven't used before
  (it doesn't).
- **Manual checks before declaring done**:
  - `cd web && npm run build` (CLAUDE.md gotcha: backend serves
    `web/dist/`, not Vite dev).
  - `cd web && npx tsc --noEmit && npm test`.
  - Browser: TopBar renders the GitHub icon between Upload and Theme;
    clicking opens the repo in a new tab; row doesn't wrap awkwardly
    on a ~1280px viewport.
  - Browser: `#/changelog` shows the new entry at the top, Workshop
    voice reads cleanly, no broken markdown.
  - Browser: TopBar Log button shows the unseen "NEW" treatment until
    the changelog page is viewed (verifies the entry threads into the
    existing unseen-count flow).

### 4. Files touched

- `changelog/2026-04-25-open-source.md` — new file.
- `web/src/components/TopBar.tsx` — `lucide-react` import + new anchor
  inside the right cluster.

That's it.

## Risks / open questions

- **Date collision** — there are already two `2026-04-25-*.md` entries.
  Confirmed safe: the changelog `id` is the filename stem and the slugs
  differ (`open-source` vs `multi-machine-support` /
  `palette-manual-favorites`).
- **Repo visibility** — design assumes the repo is genuinely public.
  Current branch fetch succeeds without auth, and the user explicitly
  said it's been open-sourced; nothing further to verify.
- **Docker mention** — phrased as forthcoming, no date promised. If the
  Docker work slips significantly, the post may need a follow-up edit
  or a separate "Docker is here" entry later. Acceptable.

## Out of scope follow-ups (parking lot)

- Add `Issues` and `Discussions` items to the TopBar (e.g. a small
  popover off the GitHub icon) once we know whether users actually
  want them surfaced from the chrome.
- Wire the bug-report issue template into a "Report a bug" affordance
  inside the workbench (e.g. a footer link or a help-menu item that
  pre-fills the template URL with the current page / build SHA).
- Ship the Docker image and announce it in its own changelog entry.
