import { useState, type ReactNode } from "react";
import { Badge, Button, TabBar } from "xcs-gen-web";
import { Plus } from "lucide-react";

const PARAM_TEST_TABS = [
  { id: "test", label: "Test" },
  { id: "sweep", label: "Sweep" },
  { id: "base", label: "Base params" },
  { id: "registration", label: "Registration" },
];

const VALIDATION_TABS = [
  { id: "test", label: "Test" },
  { id: "palette", label: "Palette" },
  { id: "recipes", label: "Recipes" },
  { id: "registration", label: "Registration" },
];

const LIBRARY_RIGHT_TABS = [
  { id: "presets", label: "Presets" },
  { id: "text-reg", label: "Text & Registration" },
];

function Rows({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-col">
      {items.map(([label, value], i) => (
        <div
          key={label}
          className={
            i === items.length - 1
              ? "flex items-center justify-between py-2"
              : "flex items-center justify-between border-b border-[color:var(--color-border)] py-2"
          }
        >
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
            {label}
          </span>
          <span className="font-mono text-[12.5px] tabular-nums text-[color:var(--color-ink)]">
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="px-4 pb-3">{children}</div>;
}

export function ParamTestEditor() {
  const [tab, setTab] = useState("sweep");
  const body: Record<string, [string, string][]> = {
    test: [
      ["Name", "Brass ramp — 04"],
      ["Machine", "F2 Ultra"],
      ["Material", "Brass 3.0mm"],
    ],
    sweep: [
      ["Speed (mm/s)", "600 → 1400 / 5"],
      ["Power (%)", "30 → 90 / 4"],
      ["Pulse width (ns)", "30"],
    ],
    base: [
      ["Passes", "2"],
      ["Interval (mm)", "0.02"],
    ],
    registration: [
      ["Corner marks", "4 · 3.0mm"],
      ["Label font", "JetBrains Mono 7pt"],
    ],
  };

  return (
    <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] max-w-[640px]">
      <TabBar items={PARAM_TEST_TABS} value={tab} onChange={setTab} />
      <Panel>
        <Rows items={body[tab]} />
      </Panel>
    </div>
  );
}

export function ValidationEditor() {
  const [tab, setTab] = useState("registration");
  return (
    <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] max-w-[640px]">
      <TabBar items={VALIDATION_TABS} value={tab} onChange={setTab} />
      <Panel>
        <Rows
          items={[
            ["Corner marks", "4 · 3.0mm"],
            ["Sheet origin", "12.0, 8.5 mm"],
            ["Cell pitch", "14.0 mm"],
          ]}
        />
      </Panel>
    </div>
  );
}

export function LibraryRightPane() {
  const [tab, setTab] = useState("presets");
  return (
    <div className="max-w-[640px]">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
          Brass 3.0mm
        </span>
        <Button variant="secondary" size="sm">
          <Plus className="h-3.5 w-3.5" />
          New preset
        </Button>
      </div>
      <TabBar
        items={LIBRARY_RIGHT_TABS}
        value={tab}
        onChange={setTab}
        className="mb-4"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="accent" size="sm">Deep engrave</Badge>
        <Badge variant="accent" size="sm">Anneal — dark</Badge>
        <Badge variant="accent" size="sm">Spiral cut 0.8mm</Badge>
      </div>
      <p className="mt-3 text-[13px] text-[color:var(--color-ink-muted)]">
        Presets seed new tests and SVG layers for this material.
      </p>
    </div>
  );
}
