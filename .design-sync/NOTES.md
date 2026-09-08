# design-sync notes — Workshop Instrument (web/src/ui)

Repo-specific gotchas for `/design-sync`. Read this before re-running a sync.

## Shape

- The design system is `web/src/ui/` inside the **app** package `xcs-gen-web`
  (`"private": true`, Vite SPA). It is **not** a published component library:
  there is no library build, no `dist/` entry, no shipped `.d.ts` tree of its
  own. Everything below exists to hand the converter the two things it needs
  anyway — a real entry and a real type tree.
- `shape: "package"` is pinned in config. There is no Storybook anywhere in
  this repo (checked to depth 4, plus a `*.stories.*` sweep) — don't go
  looking again.
- `cfg.entry` is `./web/src/ui/index.ts` — the **barrel**, not a built
  bundle. esbuild compiles the TSX source directly. Do NOT drop `cfg.entry`
  and let the adapter synthesise one: with no entry it globs every `.tsx`
  under `srcDir` and would pull the whole app (pages, three.js viewers,
  vtracer-wasm) into the bundle.
- `cfg.srcDir` is `src/ui` (not `src`) for the same reason — it also stops
  the fuzzy src-matcher binding a component name to an unrelated app file.

## Two repo files exist only for this sync

1. **`web/tsconfig.ds.json`** — declaration-only emit of `src/ui/index.ts`
   into `web/dist-ds/` (gitignored). Needed because component discovery and
   every `<Name>Props` body come from a `.d.ts` tree; without it discovery
   returns zero components.
   - It must keep `"src/vite-env.d.ts"` in `include`: without it,
     `src/api/userHeader.ts` fails on `import.meta.env` (TS2339).
   - `rootDir` is `src`, not `src/ui`, because `DemoLock` imports
     `../hooks/useIsDemo` — declarations land at `dist-ds/ui/*.d.ts`.
2. **`"types": "./dist-ds/ui/index.d.ts"` in `web/package.json`** — the
   converter derives its type-tree entry from `pkgJson.types`; with no
   `types` field it looks for `web/index.d.ts`, finds nothing, and emits an
   empty component list. The field is inert for Vite/vitest/`tsc -b`.

Both are re-run by `cfg.buildCmd`. If either disappears, the symptom is
`[ZERO_MATCH]` or 21 components with empty props bodies.

## CSS: the shipped stylesheet is the app's compiled Tailwind

- Tailwind v4 lives behind `@tailwindcss/vite`, so the only compiled
  stylesheet in the repo is the app's own build output. `cfg.buildCmd` runs
  the app build and then makes a stable copy:
  `sed 's|url(/assets/|url(./|g' dist/assets/index-*.css > dist/assets/ds-styles.css`.
  - The **stable name** matters: Vite hashes `index-<hash>.css`, so pointing
    `cssEntry` at the hashed file would rot on every rebuild.
  - The **`sed`** matters: Vite writes root-absolute `url(/assets/x.woff2)`.
    `extractFonts` resolves url()s relative to the stylesheet's directory, so
    absolute paths yield `[FONT_DANGLING]` and no fonts ship. Rewriting to
    `./` (and keeping the copy inside `dist/assets/`, next to the woff2s)
    makes all 24 `@font-face` rules resolve — Inter + JetBrains Mono
    variable, 13 files into `fonts/`.
- **Consequence worth knowing:** the shipped CSS contains only the utilities
  this app actually uses — it is not a full Tailwind JIT. A probed sample of
  115 realistic classes came back 112 present (missing: `text-base`,
  `basis-0`, `space-y-2`). Arbitrary values the app never wrote
  (`text-[17px]`, `gap-[7px]`) will silently do nothing.
  - Helper: `python3 .design-sync/.cache/probe-css.py "flex gap-2 …"` prints
    anything MISSING. Use it before putting an unfamiliar class in a preview
    or in `conventions.md`.
  - If the design agent ever hits missing utilities in practice, the upgrade
    is a dedicated Tailwind entry (`@import "tailwindcss"` + theme +
    `@source inline(...)` safelist) compiled via `@tailwindcss/cli`, with
    `cfg.extraFonts` taking over font shipping. Not done — the app CSS
    covered enough, and the CLI path re-opens the font-URL problem.

## Curation choices

- `componentSrcMap` nulls out 12 flat sub-exports (CardHeader/CardTitle/
  CardFooter, TabList/Tab/TabPanel, and the six Dialog parts). They stay in
  the bundle and are importable — they just don't get cards of their own,
  because `loadDts` sees them as top-level exports (they are separate consts,
  not `Dialog.Content`-style compound members), and 12 near-empty cards is
  worse than composing them inside their parent's preview. **If you add a
  part export, null it here and show it in the parent's preview.**
- `TabBar` and `ToastHost` are pinned in `componentSrcMap` to
  `src/ui/Tabs.tsx` / `src/ui/Toast.tsx` — the fuzzy matcher can't find them
  because neither has a file of its own (21/21 src-matched with the pins,
  19/21 without, which costs those two their JSDoc and group).
- **Grouping comes from `.design-sync/docs/<Name>.md` stubs** (discovered via
  `cfg.docsDir: "../.design-sync/docs"`), each holding only
  `---\ncategory: <Group>\n---`. Rationale: the src group-derivation strips
  `ui/` as a generic dir name, so every component would land in `general`;
  and a **frontmatter-only** stub sets the category while leaving `docBody`
  empty, which keeps the *synthesised* `.prompt.md` (props + Examples pulled
  from the authored previews + Related). Put real prose in a stub and you
  LOSE the auto-generated `## Examples` section — the doc body replaces it.
  Groups: actions, forms, layout, navigation, feedback.
- `cfg.dtsPropsFor` is hand-written for 8 components: Button, IconButton,
  Input, Textarea, Select, Tabs, ToastHost, ThemeToggle. Why: `isOwnProp`
  filters every prop declared in `@types/react`, so the native-attribute
  components (`InputHTMLAttributes` & co.) emitted bodies with nothing but
  `invalid`/`mono` — no `placeholder`, `value`, `onChange`, `disabled`,
  `type`. Radix-derived `Tabs` also leaked a `DO_NOT_USE_OR_YOU_WILL_BE_
  FIRED_CALLBACK_REF_RETURN_VALUES` ref type. These bodies are the design
  agent's whole API contract, so they are worth maintaining by hand — but
  see Re-sync risks.

## Known render warns (triaged — a warn NOT in this list is new)

- `[TOKENS_MISSING]` — **fixed, expect zero now.** The first sync found four
  custom properties referenced by *app* code (never by `src/ui`) that no
  stylesheet defined, so those colours silently inherited:
  `--color-danger` (`MobileQrTab.tsx:93`), `--color-warning-ink`
  (`Spectrum2DPage.tsx:1077`), `--color-muted`
  (`forge/ForgeControls.tsx:235`), `--color-fg`
  (`forge/ForgeStageParams.tsx:247,493`). All four are resolved in PR #168:
  three were re-pointed at `--color-destructive` / `--color-ink-muted` /
  `--color-ink`, and `--color-warning-ink` was **added to
  `src/ui/theme.css`** (`#8A5C10` light / `#F0C674` dark — 5.10:1 and
  9.35:1 on the warning tint) because the notice's request for it was
  legitimate and `--color-warning` only reaches 2.58:1 there.
  - Resolved: #168 merged 2026-09-08, so `main`, the uploaded
    `_ds_bundle.css` and `conventions.md`'s token list all agree.
  - Still outstanding, deliberately: `Badge variant="warning"` paints its
    own label with `--color-warning` on `--color-warning-tint` (2.58:1).
    Left alone — changing a DS component is a design call, not a fix.

## Environment

- Render check needs playwright + chromium. The machine's
  `~/Library/Caches/ms-playwright/` already has `chromium-1208` and
  `chromium-1234`; **playwright 1.58.0 pins 1208**, so
  `npm i playwright@1.58.0` inside `.ds-sync/` needs no ~200MB download.
  (Map, if the cache changes: 1.52→1169, 1.54→1181, 1.55→1187, 1.56→1194,
  1.57→1200, 1.58→1208, 1.59→1217, 1.60→1223.)
- This shell is zsh: quote grep globs (`--include='*.tsx'`) or it dies with
  "no matches found", and `${PIPESTATUS[0]}` is `$pipestatus[1]` — run
  `build` and `validate` as separate commands and check each exit code.
- Everything runs from the **repo root** (the config home): the converter
  resolves `.design-sync/overrides/` from cwd. `--node-modules
  ./web/node_modules` (that's where `react` and `@types/react` live).

## Re-sync risks — what can silently go stale

- **`cfg.dtsPropsFor` is hand-maintained and does not track the source.** If
  someone adds a prop to Button/Input/Select/Textarea/IconButton/Tabs, the
  design agent will not see it. On re-sync, diff the emitted
  `ds-bundle/components/*/<Name>/<Name>.d.ts` against
  `web/src/ui/<Name>.tsx` for those 8 and update the config.
- **The shipped CSS tracks the app's class usage.** A refactor that stops
  using a utility removes it from the DS stylesheet, so previews and agent
  designs can lose styling with no error anywhere. Re-probe with
  `probe-css.py` if a card looks unstyled after an app-side cleanup.
- **`web/tsconfig.ds.json` + the `types` field are load-bearing** and live
  in app-owned files. A `package.json` rewrite (or a dependency tool that
  reformats it) can drop `types` and quietly zero out discovery.
- Grouping depends on 21 frontmatter stubs in `.design-sync/docs/`. A new
  component with no stub lands in `general` and prints `[DOCS_UNMAPPED]`.
- Card-mode overrides (`Dialog`/`ToastHost` single, `Toolbar`/`MetalBar`/
  `PageContainer` column) were chosen from the components' geometry, not
  from a `[GRID_OVERFLOW]` warn — if a preview's export set changes shape,
  re-check the card in the product's grid.
- Only what the previews render is verified. Hover/focus/drag states,
  dark mode (`.dark` on `<html>`), and DemoLock's locked state were never
  machine-checked.

## Preview authoring — harness facts (folded from wave 1, four authors)

The capture harness, not taste, drove most of the composition choices:

- Every cell is photographed **alone**, one page load per cell
  (`<Name>.html?story=<Export>`), at a **900×700** viewport with
  `fullPage: false` and 24px body padding — usable area ~852×650, and
  **anything below ~650px is simply cut off**. Compose compact.
- The composed review sheet then scales each row to ~760×520 (×0.84). Fine
  detail (40% disabled opacity, 1px hairlines, caption baselines) is NOT
  judgeable from the sheet — grade those from the per-cell originals in
  `ds-bundle/_screenshots/review/raw/<group>__<Name>__<Cell>.png`.
- A composition narrower than ~420px reads as a postage stamp on the sheet;
  `max-w-[640px]` is about right for a variant sweep.
- **The preview page body is `#fff` and `--color-surface` is also `#FFFFFF`.**
  A default Card / Toolbar / MetalBar dropped straight on the body has nothing
  to read against. Every story here wraps itself in a local ground helper with
  `bg-[color:var(--color-bg)]` (the warm #F7F5F2 the app actually uses). Do
  the same in new previews.
- Only **exports** become cells (uppercase-initial functions). Non-exported
  PascalCase helpers inside a preview file are safe and are the right way to
  share a ground/specimen wrapper.
- `.ds-single`/`.ds-cell` carry `transform: translateZ(0)`, so they are the
  containing block for `position: fixed` descendants. Consequence:
  `ToastHost` renders inline, so its `fixed top-4 right-4` anchors to the
  **story root** (give the story a real box or the toasts pin to the very
  top); `Dialog` and `HelpTooltip` content is portaled to `document.body`, so
  they centre on the real viewport — that's fine.
- No `StrictMode`, and `settle()` only awaits fonts + image decode, so a
  `notify()` in `useEffect` fires once and the toast is still on screen at
  shot time (info dismisses at 6s, error at 12s).
- Cells render depth-first in export order and siblings mount in order —
  which is what makes the DemoLock trick below work.

## Per-component authoring gotchas (worth reading before editing a preview)

- **Dialog**: Radix auto-focus lands on `DialogHeader`'s close IconButton (the
  first focusable node), painting an ember focus ring that reads as a
  highlighted X. Previews pass
  `<DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>`. Preview-only
  concern — no DS change wanted.
- **MetalBar** is a 1px hairline; at sheet scale `default` and `soft` are
  indistinguishable. Each variant is shown at 1× **plus** an `×8 detail` row
  (`transform: scaleY(8)` on the real component inside an
  `h-6 overflow-hidden` box). Honest magnification, not a stand-in.
- **PageContainer**'s `maxWidth` axis (1280/1440/none) is **not observable**
  at a 900px viewport — all three fill the frame. Only the padding axis is,
  and that prop is named **`bleed`**, not `noPadding`. The two maxWidth cells
  are differentiated by carrying the layout each one actually holds in the
  app; `maxWidth="full"` is skipped as a pixel-identical duplicate.
- **Card**: `CardHeader`/`CardFooter` use `-mx-4 -mt-4` / `-mx-4 -mb-4`, so
  they only line up inside a **padded** Card — never combine with
  `padded={false}`. `CardHeader` is `flex items-center gap-3` with no auto
  spacing: a trailing Badge needs `ml-auto`.
- **Badge** stretches to full width inside a `flex flex-col` (default
  `align-items: stretch`); previews add `items-start`. NB the app's
  `forge/ForgeSourcePanel.tsx` has the same stretch on its `ready` badge, so
  that pill is probably a full-width lozenge in the real Forge panel —
  possible product nit, untouched by this sync.
- **Field**: inline mode reserves no label column, so inline rows with
  unequal label lengths are legitimately ragged. Mixing `items-end` with a
  `hint` on only one Field in a row misaligns labels — use `items-start`.
- **Select**: props do spread onto the `<select>`, but it is content-sized, so
  `minWidth` changes nothing visible; crowded option text is fixed by
  shortening the option and moving detail into `Field`'s `hint`.
- **Tabs**: `TabList` is `inline-flex`, so its bottom hairline stops at the
  last tab instead of spanning the panel — by design, not a clipped render.
  At least one story must put the active tab somewhere other than first, or
  the sheet can't prove the ember underline tracks selection.
- **IconButton**: `variant="ghost"` + `disabled` is nearly invisible
  (transparent, borderless, 40% opacity). Real behaviour — the Disabled story
  pairs each disabled button with its enabled twin instead of "fixing" it.
  Specimen tiles need a fixed-height centred slot, because `sm` is `h-7` and
  `md` is `h-9` and otherwise the captions land on different baselines.
- **DemoLock**: demo mode IS reachable in a static render. `useIsDemo()` reads
  `localStorage["xcsgen:userId"] === "DEMO"` in a lazy `useState` initialiser
  (once at mount, never memoised), so a wrapper that writes the flag from its
  own `useState` initialiser lands before the nested DemoLock reads it — and
  since siblings mount in order, both states can sit side by side in one
  cell. Caveat: `localStorage` is shared across the whole capture run, so
  every DemoLock story writes the flag **explicitly** (set *or* remove)
  rather than trusting the ambient value.
- **ThemeToggle** renders one 28px ghost IconButton, so it must be composed
  into real chrome or the card is near-blank. In headless it shows the
  Monitor (system) glyph.

## Compiled-CSS gaps found the hard way

Probe with `.design-sync/.cache/probe-css.py` — **a neighbouring arbitrary
value existing proves nothing** (`max-w-[420px]` and `max-w-[640px]` exist,
`max-w-[560px]` does not).

Confirmed MISSING: `text-base`, `font-sans`, `basis-0`, `basis-[240px]`,
`space-y-*`, `last:border-0`, `border-collapse`, `decoration-dotted`, `p-8`,
`h-20`, `h-24`, `w-20`, `w-28`, `w-32`, `w-[520px]`, `min-h-[120px]`,
`max-w-[240px]`, `max-w-[300px]`, `max-w-[460px]`, `max-w-[560px]`.

Confirmed present and useful: `max-w-[360px]`, `max-w-[420px]`,
`max-w-[480px]`, `max-w-[520px]`, `max-w-[640px]`, `min-w-[140px]`,
`min-w-[160px]`, `w-[160px]`, `w-auto`, `h-14`, `grid-cols-6`, `gap-px`,
`rounded-sm`, `rounded-md`, `grid-cols-[1fr_auto]`,
`grid-cols-[max-content_1fr]`, `gap-x-4`, `gap-y-1.5`, `tabular-nums`,
`cursor-not-allowed`, `whitespace-nowrap`, `break-words`,
`tracking-[0.06em]`, `tracking-[0.12em]`, `tracking-[0.14em]`,
`tracking-[0.22em]`, `hover:bg-[color:var(--color-destructive-tint)]`, the
whole `text-/bg-/border-[color:var(--…)]` family. Build table layouts with
`grid` + an explicit `gridTemplateColumns` (equal `grid-cols-N` tracks
truncate long cells), and use `Fragment` when mapping sibling grid cells.

## Deliberately not verified (no static render exists)

Recorded so a re-sync doesn't read these as regressions: focus rings and
hover states on every control; the native `<select>` popup; `HelpTooltip`'s
tooltip **body** (only the `?`/custom trigger is captured); `Toolbar`/`Tab`
hover; drag; **dark mode** (`.dark` on `<html>` — the card body is hard-coded
`#fff`, so it isn't capturable by this harness); `PageContainer`
`maxWidth="full"`.

## Resolved in wave 1 (don't re-litigate)

- `[GRID_OVERFLOW] TabBar` (ParamTestEditor, ValidationEditor wider than a
  grid cell) → fixed with `cfg.overrides.TabBar: {"cardMode": "column"}`.
  Column cards cannot re-flag `wide`, so this warn should not return.

## Re-syncing this repo (the one-liner)

```sh
# from the repo root
cd web && npx tsc -p tsconfig.ds.json && npm run build \
  && sed 's|url(/assets/|url(./|g' dist/assets/index-*.css > dist/assets/ds-styles.css && cd ..
cp -r "<skill-base-dir>"/{package-build.mjs,package-validate.mjs,package-capture.mjs,resync.mjs,lib,storybook} .ds-sync/
(cd .ds-sync && npm i esbuild ts-morph @types/react playwright@1.58.0)
# fetch the project's anchor first: DesignSync(get_file, "_ds_sync.json") -> .design-sync/.cache/remote-sync.json
node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules ./web/node_modules \
  --out ./ds-bundle --remote .design-sync/.cache/remote-sync.json
```

`cfg.entry` and `cfg.cssEntry` live in the config, so no extra flags are
needed. Verified state is NOT in git: it comes from the uploaded
`_ds_sync.json` (any machine), while the per-cell grades in
`.design-sync/.cache/review/` are gitignored campaign-local scratch. The
first sync (2026-09-08) ended with all 21 components graded `good` and the
anchor uploaded, so a re-sync with an unchanged `src/ui` should re-verify
nothing.

## conventions.md

`.design-sync/conventions.md` is wired in via `cfg.readmeHeader` and is
prepended verbatim to the generated `README.md`, which is inlined into the
**design agent's** system prompt. It is deliberately human-editable —
**never rewrite it on a re-sync.** The standing job is to re-validate its
names against the fresh build and report drift: every class it enumerates
must pass `probe-css.py`, every token must appear as `--<name>:` in
`ds-bundle/_ds_bundle.css`, and every component name must exist under
`ds-bundle/components/`. Two names were deliberately excluded when it was
written: `--radius-lg` (declared in `theme.css` but unused, so Tailwind
tree-shakes it out of the compiled CSS) and `text-base`.

## Card presentation (config, not preview, decisions)

`cfg.overrides` holds: `Dialog` and `ToastHost` as `single` cards (an
overlay needs the whole card or it escapes/collapses); `Toolbar`,
`MetalBar`, `PageContainer`, `TabBar` as `column` (wide/thin — one export
per full-width row).

**A `single` card renders the alphabetically-first export, not the first in
file order** — esbuild's export object decides the enumeration. `Dialog`
therefore pins `primaryStory: "SimplifyShapes"`, or the card would open on
the small `ConfirmDestructiveSm` confirm instead of the canonical dialog.
`ToastHost` is deliberately left unpinned: its alphabetically-first export
`AtCapacity` is the richest demo (both toast levels plus the 4-item
eviction).

## First re-sync (2026-09-08, same day) — what the anchor bought

Ran `resync.mjs --remote` against merged `main` right after PRs #167/#168
landed. Worth knowing because it is the mechanism working, not a problem:

- **`verify: 21 verified-by-upload (skip capture/grade), 0 changed, 0 new`**
  — the capture stage was skipped entirely and nothing was re-graded. The
  whole run was ~3 minutes, versus hours for the first sync. That is what
  the uploaded `_ds_sync.json` is for; do not delete it to "force a clean
  sync" without meaning to pay for a full re-verify.
- **`upload.any: true` with `styling: true` and `bundle: false`,
  `components: []`.** PR #169 (an unrelated SVG-Layers empty-palette hint)
  added markup, which added utility classes to the app's compiled Tailwind
  — and since `cfg.cssEntry` *is* that stylesheet, `styleSha` moved while
  every component contract and all 21 `renderHashes` stayed byte-identical.
  Uploaded `_ds_bundle.css` + `styles.css` + `fonts/fonts.css` and
  re-anchored; nothing else.
- **So: expect a styling-only delta from app-side UI work that never
  touches `src/ui`.** That is the documented "shipped CSS tracks the app's
  class usage" risk showing up benignly. The thing to actually worry about
  is the inverse — a refactor that *stops* using a utility silently drops
  it from the DS stylesheet. `renderHashes` won't catch that (the cards
  don't use it); only a preview or an agent-built design going unstyled
  will.
