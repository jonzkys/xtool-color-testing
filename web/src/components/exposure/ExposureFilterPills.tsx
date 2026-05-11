import {
  DEFAULT_FILTERS, FILTERABLE_PARAMS,
  formatClause, removeClauseAt,
  type ActiveFilters, type FilterableParam,
} from "./exposureFilters";

interface Props {
  filters: ActiveFilters;
  entryCount: number;
  onChange: (next: ActiveFilters) => void;
  onClearAll: () => void;
}

const PARAM_LABEL: Record<FilterableParam, string> = {
  power: "POWER", speed: "SPEED", frequency: "FREQUENCY",
  pulse_width: "PULSE WIDTH", density: "DENSITY", passes: "PASSES",
  scan_angle: "SCAN ANGLE",
};

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function isDefault(f: ActiveFilters): boolean {
  return (
    setsEqual(f.sources, DEFAULT_FILTERS.sources) &&
    !f.validatedOnly &&
    f.family == null &&
    f.testIds.size === 0 &&
    f.testKind === "all" &&
    f.crosshatch === "any" &&
    f.unidirectional === "any" &&
    f.angleMode === "any" &&
    Object.values(f.paramClauses).every((cs) => !cs || cs.length === 0)
  );
}

function Pill({
  text, ariaLabel, onClear,
}: {
  text: string;
  ariaLabel: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border border-[color:var(--color-primary)] bg-[color:var(--color-surface-elevated)] font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-primary)]">
      {text}
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={(e) => { e.stopPropagation(); onClear(); }}
        className="ml-0.5 text-[color:var(--color-primary)] hover:text-[color:var(--color-ink)]"
      >
        ×
      </button>
    </span>
  );
}

export function ExposureFilterPills({
  filters: f, entryCount, onChange, onClearAll,
}: Props) {
  if (isDefault(f)) return null;

  const items: { text: string; key: string; clear: () => void }[] = [];

  if (!setsEqual(f.sources, DEFAULT_FILTERS.sources)) {
    items.push({
      text: `SOURCE: ${[...f.sources].join(", ")}`,
      key: "sources",
      clear: () => onChange({ ...f, sources: new Set(DEFAULT_FILTERS.sources) }),
    });
  }
  if (f.validatedOnly) {
    items.push({
      text: "VALIDATED ONLY",
      key: "validated",
      clear: () => onChange({ ...f, validatedOnly: false }),
    });
  }

  // Per-clause pills — one per clause, so multi-clause filters stay legible.
  for (const k of FILTERABLE_PARAMS) {
    const clauses = f.paramClauses[k];
    if (!clauses) continue;
    clauses.forEach((c, i) => {
      items.push({
        text: `${PARAM_LABEL[k]} ${formatClause(c)}`,
        key: `clause:${k}:${i}`,
        clear: () => onChange(removeClauseAt(f, k, i)),
      });
    });
  }

  if (f.testIds.size > 0) {
    const lineage: string[] = [];
    if (f.testLineage.has("source")) lineage.push("source");
    if (f.testLineage.has("parent")) lineage.push("parent");
    const suffix = lineage.length ? ` (+${lineage.join(",+")})` : "";
    const ids = [...f.testIds].sort((a, b) => a - b);
    const text = ids.length === 1
      ? `TEST #${ids[0]}${suffix}`
      : `TESTS ${ids.map((n) => `#${n}`).join(",")}${suffix}`;
    items.push({
      text,
      key: "testIds",
      clear: () => onChange({
        ...f, testIds: new Set(), testLineage: new Set(),
      }),
    });
  }
  if (f.testKind !== "all") {
    items.push({
      text: f.testKind.toUpperCase(),
      key: "testKind",
      clear: () => onChange({ ...f, testKind: "all" }),
    });
  }
  if (f.family) {
    items.push({
      text: `FAMILY: ${f.family.axis} sweep`,
      key: "family",
      clear: () => onChange({ ...f, family: null }),
    });
  }
  if (f.crosshatch !== "any") {
    items.push({
      text: `CROSSHATCH: ${f.crosshatch.toUpperCase()}`,
      key: "crosshatch",
      clear: () => onChange({ ...f, crosshatch: "any" }),
    });
  }
  if (f.unidirectional !== "any") {
    items.push({
      text: `UNIDIRECTIONAL: ${f.unidirectional.toUpperCase()}`,
      key: "unidirectional",
      clear: () => onChange({ ...f, unidirectional: "any" }),
    });
  }
  if (f.angleMode !== "any") {
    items.push({
      text: `ANGLE MODE: ${f.angleMode.toUpperCase()}`,
      key: "angleMode",
      clear: () => onChange({ ...f, angleMode: "any" }),
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap py-1.5 px-1">
      {items.map((p) => (
        <Pill key={p.key} text={p.text} ariaLabel={`clear ${p.key}`} onClear={p.clear} />
      ))}
      <span className="ml-auto inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
        <span>{entryCount} entries</span>
        <button
          type="button"
          onClick={onClearAll}
          className="text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-primary)]"
        >
          Clear all
        </button>
      </span>
    </div>
  );
}
