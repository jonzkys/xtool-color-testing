import { Badge, Tab, TabList, TabPanel, Tabs } from "xcs-gen-web";

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
        {label}
      </div>
      <div className="mt-1 font-mono text-[14px] tabular-nums text-[color:var(--color-ink)]">
        {value}
      </div>
    </div>
  );
}

function Swatch({ hex, note }: { hex: string; note: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2">
      <span
        aria-hidden="true"
        className="h-6 w-6 shrink-0 rounded-[6px] border border-[color:var(--color-border-strong)]"
        style={{ background: hex }}
      />
      <div className="min-w-0">
        <div className="font-mono text-[12px] tabular-nums text-[color:var(--color-ink)]">
          {hex}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
          {note}
        </div>
      </div>
    </div>
  );
}

export function EditorTabs() {
  return (
    <Tabs defaultValue="geometry">
      <TabList>
        <Tab value="geometry">Geometry</Tab>
        <Tab value="passes">Passes</Tab>
        <Tab value="preview">Preview</Tab>
      </TabList>

      <TabPanel value="geometry">
        <div className="grid grid-cols-3 gap-3 max-w-[640px]">
          <Readout label="Angle (°)" value="45" />
          <Readout label="Spacing (mm)" value="0.12" />
          <Readout label="Thickness (mm)" value="0.08" />
        </div>
        <p className="mt-3 text-[13px] text-[color:var(--color-ink-muted)] max-w-[420px]">
          Hatch geometry is resolved against the outer contour before any pass
          is emitted, so spacing stays true after the offset.
        </p>
      </TabPanel>

      <TabPanel value="passes">
        <div className="flex flex-col gap-2 max-w-[420px]">
          <div className="flex items-center gap-2">
            <Badge variant="accent" size="sm">Pass 1</Badge>
            <span className="font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
              45° · 0.12mm · t2
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="accent" size="sm">Pass 2</Badge>
            <span className="font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
              135° · 0.12mm · t2
            </span>
          </div>
        </div>
      </TabPanel>

      <TabPanel value="preview">
        <p className="text-[13px] text-[color:var(--color-ink-muted)] max-w-[420px]">
          Estimated cut time 4m 12s on F2 Ultra at 1200 mm/s.
        </p>
      </TabPanel>
    </Tabs>
  );
}

export function PaletteViews() {
  return (
    <Tabs defaultValue="favorites">
      <TabList>
        <Tab value="browse">Browse</Tab>
        <Tab value="manual">Manual</Tab>
        <Tab value="favorites">Favorites</Tab>
        <Tab value="query">Query</Tab>
      </TabList>

      <TabPanel value="browse">
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">
          Every swatch harvested from burn results on Brass 3.0mm.
        </p>
      </TabPanel>

      <TabPanel value="manual">
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">
          Hand-author a swatch and pin it to the material.
        </p>
      </TabPanel>

      <TabPanel value="favorites">
        <div className="grid grid-cols-3 gap-2 max-w-[640px]">
          <Swatch hex="#8C5A2B" note="12 W · 900 mm/s" />
          <Swatch hex="#B57A3E" note="9 W · 1200 mm/s" />
          <Swatch hex="#5E3A18" note="15 W · 700 mm/s" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="success" size="sm">12 stable</Badge>
          <Badge variant="warning" size="sm">3 marginal</Badge>
        </div>
      </TabPanel>

      <TabPanel value="query">
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">
          Match a target hex against the validated palette.
        </p>
      </TabPanel>
    </Tabs>
  );
}

export function WithDisabledTab() {
  return (
    <Tabs defaultValue="query">
      <TabList>
        <Tab value="query">Query</Tab>
        <Tab value="browse">Browse</Tab>
        <Tab value="import" disabled>Import</Tab>
      </TabList>

      <TabPanel value="query">
        <p className="text-[13px] text-[color:var(--color-ink-muted)] max-w-[420px]">
          Import is greyed out until a material is selected — the disabled tab
          keeps its slot so the strip does not reflow.
        </p>
      </TabPanel>

      <TabPanel value="browse">
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">
          Browse content.
        </p>
      </TabPanel>
    </Tabs>
  );
}
