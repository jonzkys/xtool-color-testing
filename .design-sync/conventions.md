## Building with Workshop Instrument

The house style of a laser-cutter workbench: instrument-like, dense, quiet.
JetBrains Mono for every number, label and machine string; Inter for prose;
one ember accent (`--color-primary`) on a warm paper ground; 1px metallic
hairlines instead of heavy rules.

### Setup — no provider needed

Components read no React context, so there is **no wrapper to add**: render
any component directly. Two real requirements:

- **`styles.css` must be loaded.** It is the whole look — it `@import`s
  `fonts/fonts.css` (Inter + JetBrains Mono variable) and `_ds_bundle.css`
  (the compiled component styles *and* every design token). Without it every
  component renders as unstyled browser default.
- **Dark mode is a class, not a prop:** put `dark` on `<html>` and every
  token re-binds. `ThemeToggle` does this itself (light → dark → system,
  persisted); don't build your own theme switch.

`ToastHost` is the one component with a mounting rule: render it **once**
near the app root, then call `notify(message, "info" | "error")` from
anywhere — it listens on a window event, so callers need no context.

### Styling idiom

This DS is **Tailwind v4 utility classes**, and it reads tokens through
Tailwind's arbitrary-value syntax rather than a custom colour scale. That
bracket form is the house idiom — copy it:

```jsx
className="text-[color:var(--color-ink-muted)] bg-[color:var(--color-surface)] border-[color:var(--color-border)]"
```

**Tokens** (all defined in the shipped CSS, all flip under `.dark`):
`--color-bg --color-surface --color-surface-elevated` · `--color-ink
--color-ink-muted --color-ink-subtle` · `--color-border
--color-border-strong` · `--color-primary --color-primary-hover
--color-primary-tint` · `--color-secondary --color-secondary-tint` ·
`--color-success --color-success-tint` · `--color-warning
--color-warning-tint --color-warning-ink` · `--color-destructive --color-destructive-hover
--color-destructive-tint` · `--color-substrate --color-substrate-ink` ·
`--font-sans --font-mono` · `--metal-bar --metal-bar-soft` · `--shadow-card
--shadow-popover` · `--radius --radius-sm --radius-md`.

**One important constraint:** the stylesheet is a *compiled, fixed* Tailwind
build, not a live JIT. Ordinary utilities are present — `flex flex-col
flex-wrap grid grid-cols-2 grid-cols-3 gap-1…gap-4 items-center items-start
justify-between p-3 p-4 px-3 py-2 mt-2 w-full min-w-0 shrink-0 truncate
border border-b rounded-[6px] rounded-[8px] rounded-[10px] font-mono
font-medium font-semibold uppercase tabular-nums text-[11px] text-[12.5px]
text-[13px] text-[14px] tracking-[0.08em] max-w-[420px] max-w-[640px]` —
but an unusual arbitrary value (`text-[17px]`, `max-w-[560px]`, `space-y-*`,
`border-collapse`) may not exist and will silently do nothing. When in doubt
use `style={{ … }}` with the tokens above. Build table-like layouts with
`grid` and an explicit `gridTemplateColumns`.

Type register: numerics and labels are mono and small (10–12.5px), often
`uppercase tracking-[0.08em]` for section labels; prose is Inter 12.5–14px.

### Where the truth is

- `styles.css` and its imports — the real tokens and component CSS.
- `components/<group>/<Name>/<Name>.prompt.md` — usage plus worked examples
  for that component. `<Name>.d.ts` — its exact props. Read these before
  guessing at an API.
- Compound parts have **no cards of their own** but are importable and are
  the intended composition: `CardHeader CardTitle CardFooter` inside `Card`;
  `TabList Tab TabPanel` inside `Tabs`; `DialogTrigger DialogContent
  DialogHeader DialogTitle DialogDescription DialogClose` inside `Dialog`.
  `Field` is the standard wrapper around `Input`, `Textarea` and `Select`
  (it owns the label, help tooltip, hint and error). Prefer `NumberField`
  over a bare numeric `Input`.

### Idiomatic composition

```jsx
const { Section, Card, Badge, NumberField, Button } = window.WorkshopInstrument;

<Section
  title="Hatch passes"
  actions={<Button variant="secondary" size="sm">Add pass</Button>}
>
  <Card variant="elevated" padded={false} className="p-3">
    <div className="flex items-center gap-2">
      <Badge variant="accent" size="sm">Pass 1</Badge>
      <span className="font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
        45° · 0.12mm · t2
      </span>
    </div>
    <div className="grid grid-cols-3 gap-2 mt-3">
      <NumberField label="Angle (°)" value={45} onChange={setAngle} integer />
      <NumberField label="Spacing (mm)" value={0.12} onChange={setSpacing} step={0.01} />
      <NumberField label="Thickness (mm)" value={2} onChange={setThickness} step={0.1} />
    </div>
  </Card>
</Section>
```
