import { useEffect, useState } from "react";
import { Beaker, Lock, Plus } from "lucide-react";
import type { Material, Preset } from "../library";
import type { BaseParams, ParamName, TestRecord, TestSpec } from "../types";
import { listTests, createTest } from "../api/tests";
import { getCurrentMachineId, useCurrentMachine, getValidationProfile } from "../state/machine";
import { listMaterials, listPresets } from "../api/library";
import { formatRoute } from "../router";
import { defaultSpec } from "../defaults";
import { normalizeSpec } from "../specUtils";
import {
  Badge,
  Button,
  cn,
  DemoLock,
  EmptyState,
  Field,
  MetalBar,
  PageContainer,
  Section,
  Select,
} from "../ui";

const STATUS_VARIANTS: Record<string, "neutral" | "info" | "success" | "warning" | "destructive" | "accent"> = {
  created: "info",
  tested: "success",
  deleted: "destructive",
};

export function TestsPage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [tests, setTests] = useState<TestRecord[]>([]);
  const [materialId, setMaterialId] = useState<number | undefined>();
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>();

  const { registry, machineId } = useCurrentMachine();

  async function refresh() {
    try {
      const [m, p, t] = await Promise.all([
        listMaterials(),
        listPresets(undefined, getCurrentMachineId()),
        listTests({ material_id: materialId, status: status || undefined, machine_id: getCurrentMachineId() }),
      ]);
      setMaterials(m);
      setPresets(p);
      setTests(t);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    refresh();
  }, [materialId, status]); // eslint-disable-line

  async function onNew() {
    if (materials.length === 0) {
      setError("Create a material on the Library tab first.");
      return;
    }
    const mid = materialId ?? materials[0].id;
    const preset = presets.find((p) => p.material_id === mid && p.is_default);

    // Resolve a profile so the default spec produces values in-range for this
    // machine. F1 Ultra has no color_engrave mode, so we fall back to engrave.
    const defaultMode = machineId === "F2Ultra" ? "color_engrave" : "engrave";
    const profile = getValidationProfile(registry, machineId, defaultMode) ?? undefined;
    const baseSpec = defaultSpec(profile);
    const spec = normalizeSpec({
      ...baseSpec,
      base_params: {
        ...baseSpec.base_params,
        ...(preset?.base_params ?? {}),
        mode: defaultMode,
      },
    });
    const t = await createTest({ name: "New test", material_id: mid, spec, machine_id: getCurrentMachineId() });
    window.location.hash = formatRoute({ name: "test-detail", id: t.id });
  }

  return (
    <PageContainer className="py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)] mb-1">
            Tests
          </div>
          <h1 className="text-[22px] font-semibold text-[color:var(--color-ink)]">
            Parameter tests
          </h1>
          <p className="mt-1 text-[13px] text-[color:var(--color-ink-muted)] max-w-[68ch]">
            Each test is a parameter sweep for one substrate. Create one,
            burn it, then upload the photo to ingest colour swatches into
            the palette.
          </p>
        </div>
        <DemoLock label="Creating tests is disabled in the demo.">
          <Button variant="primary" onClick={onNew}>
            <Plus className="h-4 w-4" />
            New test
          </Button>
        </DemoLock>
      </header>

      <div className="grid grid-cols-[260px_1fr] gap-6">
        <div>
          <Section title="Filters" dense>
            <Field label="Material">
              <Select
                value={materialId ?? ""}
                onChange={(e) =>
                  setMaterialId(e.target.value ? Number(e.target.value) : undefined)
                }
              >
                <option value="">— all —</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">not deleted</option>
                <option value="created">created</option>
                <option value="tested">tested</option>
                <option value="deleted">deleted</option>
              </Select>
            </Field>
          </Section>
        </div>

        <div>
          <Section title={`${tests.length} test${tests.length === 1 ? "" : "s"}`} dense>
            {error && (
              <div className="rounded-[6px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-3 py-2 text-[13px] text-[color:var(--color-destructive)]">
                {error}
              </div>
            )}
            {tests.length === 0 && !error && (
              <EmptyState
                icon={<Beaker className="h-6 w-6" />}
                title="No tests match"
                description={
                  materialId || status
                    ? "Try a wider filter, or create a new test."
                    : "Create a test to start burning parameter sweeps on a substrate."
                }
                action={
                  <DemoLock label="Creating tests is disabled in the demo.">
                    <Button variant="primary" onClick={onNew}>
                      <Plus className="h-4 w-4" />
                      New test
                    </Button>
                  </DemoLock>
                }
              />
            )}
            {tests.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {tests.map((t) => (
                  <TestCard
                    key={t.id}
                    test={t}
                    materialName={
                      materials.find((m) => m.id === t.material_id)?.name ??
                      "?"
                    }
                  />
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </PageContainer>
  );
}

/* --- Test card + helpers --------------------------------------------- */

function TestCard({
  test,
  materialName,
}: {
  test: TestRecord;
  materialName: string;
}) {
  const spec = test.spec;
  const statusVariant = STATUS_VARIANTS[test.status] ?? "neutral";
  const sweptNames = new Set<ParamName>([spec.x_param]);
  if (spec.y_param) sweptNames.add(spec.y_param);
  const fixedChips = fixedParamChips(spec.base_params, sweptNames);

  return (
    <a
      href={formatRoute({ name: "test-detail", id: test.id })}
      className={cn(
        "group relative rounded-[12px] border overflow-hidden no-underline",
        "flex flex-col h-full",
        "bg-[color:var(--color-surface)] border-[color:var(--color-border)]",
        "shadow-[var(--shadow-card)]",
        "transition-all duration-200",
        "hover:border-[color:var(--color-primary)]/50",
        "hover:shadow-[0_4px_16px_rgba(20,10,0,0.06)]",
        "hover:-translate-y-[1px]",
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10.5px] font-semibold tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
              #{test.id}
            </span>
            <span className="text-[14.5px] font-semibold text-[color:var(--color-ink)] truncate group-hover:text-[color:var(--color-primary)] transition-colors">
              {test.name}
            </span>
            {test.locked && (
              <Lock
                className="h-3 w-3 text-[color:var(--color-ink-subtle)] shrink-0"
                aria-label="Locked"
              />
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11.5px] text-[color:var(--color-ink-muted)]">
            <span className="truncate">{materialName}</span>
            <span className="text-[color:var(--color-border-strong)]">·</span>
            <LaserDot laser={spec.base_params.laser} />
            <span className="capitalize">{spec.base_params.laser} laser</span>
          </div>
        </div>
        <Badge variant={statusVariant} size="sm" className="shrink-0">
          {test.status}
        </Badge>
      </div>

      {/* Grid pictograph — visual signature of the sweep layout */}
      <div className="relative px-4 pb-3">
        <GridPictograph spec={spec} />
      </div>

      <MetalBar variant="soft" />

      {/* Sweep + fixed params */}
      <div className="px-4 py-3.5 space-y-3.5">
        <div>
          <TinyCaps>Sweep</TinyCaps>
          <div className="mt-1.5 space-y-1">
            <SweepLine
              axis="X"
              param={spec.x_param}
              min={spec.x_min}
              max={spec.x_max}
              steps={spec.x_steps}
            />
            {spec.y_param && spec.y_steps && (
              <SweepLine
                axis="Y"
                param={spec.y_param}
                min={spec.y_min ?? 0}
                max={spec.y_max ?? 0}
                steps={spec.y_steps}
              />
            )}
            {!spec.y_param && spec.rows > 1 && (
              <div className="font-mono text-[11px] text-[color:var(--color-ink-muted)] pl-[22px]">
                wrapped · {spec.rows} rows
              </div>
            )}
          </div>
        </div>

        {fixedChips.length > 0 && (
          <div>
            <TinyCaps>Fixed</TinyCaps>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {fixedChips.map((chip) => (
                <span
                  key={chip.name}
                  className="inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded-[4px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] font-mono text-[11px]"
                >
                  <span className="text-[9px] font-semibold tracking-[0.14em] uppercase text-[color:var(--color-ink-subtle)]">
                    {chip.short}
                  </span>
                  <span className="tabular-nums text-[color:var(--color-ink)]">
                    {chip.value}
                    {chip.unit && (
                      <span className="ml-0.5 text-[9.5px] text-[color:var(--color-ink-muted)]">
                        {chip.unit}
                      </span>
                    )}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Geometry footer — mt-auto keeps it pinned to the card bottom
          so stretched cards in a row don't show blank space below it. */}
      <div className="mt-auto px-4 py-2 bg-[color:var(--color-surface-elevated)] border-t border-[color:var(--color-border)]">
        <div className="flex items-center justify-between gap-2 text-[10.5px] font-mono text-[color:var(--color-ink-subtle)] tabular-nums">
          <span>
            {fmtMm(spec.width_mm)} × {fmtMm(spec.height_mm)} mm
            {spec.gap_mm > 0 && ` · gap ${fmtMm(spec.gap_mm)}`}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="capitalize">{spec.cell_shape}</span>
            {spec.angle_mode !== "fixed" && (
              <>
                <span className="text-[color:var(--color-border-strong)]">·</span>
                <span>{spec.angle_mode}</span>
              </>
            )}
            {spec.registration.mode === "on" && (
              <>
                <span className="text-[color:var(--color-border-strong)]">·</span>
                <span>registered</span>
              </>
            )}
          </span>
        </div>
      </div>
    </a>
  );
}

/* --- Sub-components -------------------------------------------------- */

function TinyCaps({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-1.5 font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
      <span
        className="h-px w-3 bg-[color:var(--color-border-strong)]"
        aria-hidden
      />
      {children}
    </div>
  );
}

function LaserDot({ laser }: { laser: "red" | "blue" }) {
  const color = laser === "red" ? "#D13A2A" : "#3B6FCF";
  return (
    <span
      className="inline-block h-2 w-2 rounded-full shrink-0"
      style={{
        background: color,
        boxShadow: `0 0 0 2px ${color}22`,
      }}
      aria-hidden
    />
  );
}

function SweepLine({
  axis,
  param,
  min,
  max,
  steps,
}: {
  axis: "X" | "Y";
  param: ParamName;
  min: number;
  max: number;
  steps: number;
}) {
  const unit = unitForParam(param);
  return (
    <div className="flex items-baseline gap-2 font-mono text-[12px] tabular-nums">
      <span className="inline-block w-[14px] text-[9.5px] font-semibold tracking-[0.14em] uppercase text-[color:var(--color-ink-subtle)]">
        {axis}
      </span>
      <span className="text-[color:var(--color-ink-muted)] w-[76px] truncate">
        {param.replace(/_/g, " ")}
      </span>
      <span className="text-[color:var(--color-ink)]">
        {fmtNum(min)} → {fmtNum(max)}
        {unit && (
          <span className="ml-0.5 text-[10px] text-[color:var(--color-ink-muted)]">
            {unit}
          </span>
        )}
      </span>
      <span className="text-[color:var(--color-ink-subtle)]">× {steps}</span>
    </div>
  );
}

/* --- Grid pictograph ------------------------------------------------- */
/* A cartridge-label-style diagram of the sweep. 1D flat → a line of
 * cells. 1D wrapped → a typewriter grid. 2D → rows × cols. Opacity
 * ramps from left (pale) to right (full primary), visualising the
 * swept axis as a gradient. Purely decorative; doesn't represent real
 * burn colour. */

const MAX_PICTO_COLS = 30;
const MAX_PICTO_ROWS = 8;

function GridPictograph({ spec }: { spec: TestSpec }) {
  let cols: number;
  let rows: number;
  if (spec.y_param && spec.y_steps) {
    cols = Math.min(spec.x_steps, MAX_PICTO_COLS);
    rows = Math.min(spec.y_steps, MAX_PICTO_ROWS);
  } else if (spec.rows > 1) {
    const perRow = Math.ceil(spec.x_steps / spec.rows);
    cols = Math.min(perRow, MAX_PICTO_COLS);
    rows = Math.min(spec.rows, MAX_PICTO_ROWS);
  } else {
    cols = Math.min(spec.x_steps, MAX_PICTO_COLS);
    rows = 1;
  }

  const cells: Array<{ key: string; opacity: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = cols === 1 ? 1 : c / (cols - 1);
      const opacity = 0.22 + t * 0.78;
      cells.push({ key: `${r}-${c}`, opacity });
    }
  }

  return (
    <div className="h-[38px] flex items-center overflow-hidden">
      <div
        className="grid gap-[2px] w-full"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          height: `${rows * 4 + (rows - 1) * 2}px`,
          maxHeight: "38px",
        }}
      >
        {cells.map((cell) => (
          <span
            key={cell.key}
            className="rounded-[1px]"
            style={{
              background: "var(--color-primary)",
              opacity: cell.opacity,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* --- Helpers --------------------------------------------------------- */

interface FixedChip {
  name: string;
  short: string;
  value: string;
  unit: string | null;
}

const PARAM_SHORTS: Record<ParamName, string> = {
  speed: "S",
  power: "P",
  frequency: "F",
  density: "L",
  passes: "N",
  pulse_width: "PW",
};

function fixedParamChips(
  base: BaseParams,
  swept: Set<ParamName>,
): FixedChip[] {
  const chips: FixedChip[] = [];
  for (const name of [
    "power",
    "speed",
    "frequency",
    "density",
    "passes",
    "pulse_width",
  ] as ParamName[]) {
    if (swept.has(name)) continue;
    const value = base[name];
    chips.push({
      name,
      short: PARAM_SHORTS[name],
      value: String(value),
      unit: unitForParam(name),
    });
  }
  return chips;
}

function unitForParam(name: string): string | null {
  const map: Record<string, string> = {
    speed: "mm/s",
    power: "%",
    frequency: "kHz",
    density: "l/cm",
    passes: "×",
    pulse_width: "ns",
  };
  return map[name] ?? null;
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

function fmtMm(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
