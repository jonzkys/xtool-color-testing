import {
  DEFAULT_FILTERS, FILTERABLE_PARAMS,
  type ActiveFilters, type FilterableParam,
} from "./exposureFilters";

export type ClearKey =
  | "sources" | "validated" | "testId" | "testKind"
  | "family" | "brush"
  | `range:${FilterableParam}`;

interface Props {
  filters: ActiveFilters;
  entryCount: number;
  onClearOne: (key: ClearKey) => void;
  onClearAll: () => void;
}

const PARAM_LABEL: Record<FilterableParam, string> = {
  power: "POWER", speed: "SPEED", frequency: "FREQUENCY",
  pulse_width: "PULSE WIDTH", density: "DENSITY", passes: "PASSES",
};

function fmtRange(min: number | null, max: number | null): string {
  if (min != null && max != null) return `${min}–${max}`;
  if (min != null) return `≥${min}`;
  if (max != null) return `≤${max}`;
  return "";
}

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function isDefault(f: ActiveFilters): boolean {
  // trimOutliers is not pillable, so we ignore it for "default" check.
  return (
    setsEqual(f.sources, DEFAULT_FILTERS.sources) &&
    !f.validatedOnly &&
    f.brushRange == null &&
    f.family == null &&
    f.testId == null &&
    f.testKind === "all" &&
    Object.values(f.paramRanges).every((r) => !r ||
      (r.min == null && r.max == null))
  );
}

interface PillProps {
  text: string;
  ariaLabel: string;
  onClear: () => void;
}

function Pill({ text, ariaLabel, onClear }: PillProps) {
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
  filters: f, entryCount, onClearOne, onClearAll,
}: Props) {
  if (isDefault(f)) return null;

  const pills: { text: string; key: string; clear: () => void }[] = [];

  if (!setsEqual(f.sources, DEFAULT_FILTERS.sources)) {
    pills.push({
      text: `SOURCE: ${[...f.sources].join(", ")}`,
      key: "sources",
      clear: () => onClearOne("sources"),
    });
  }
  if (f.validatedOnly) {
    pills.push({
      text: "VALIDATED ONLY",
      key: "validated",
      clear: () => onClearOne("validated"),
    });
  }
  for (const k of FILTERABLE_PARAMS) {
    const r = f.paramRanges[k];
    if (!r || (r.min == null && r.max == null)) continue;
    pills.push({
      text: `${PARAM_LABEL[k]} ${fmtRange(r.min, r.max)}`,
      key: `range:${k}`,
      clear: () => onClearOne(`range:${k}`),
    });
  }
  if (f.testId != null) {
    const lineage: string[] = [];
    if (f.testLineage.has("source")) lineage.push("source");
    if (f.testLineage.has("parent")) lineage.push("parent");
    const suffix = lineage.length ? ` (+${lineage.join(",+")})` : "";
    pills.push({
      text: `TEST #${f.testId}${suffix}`,
      key: "testId",
      clear: () => onClearOne("testId"),
    });
  }
  if (f.testKind !== "all") {
    pills.push({
      text: f.testKind.toUpperCase(),
      key: "testKind",
      clear: () => onClearOne("testKind"),
    });
  }
  if (f.family) {
    pills.push({
      text: `FAMILY: ${f.family.axis} sweep`,
      key: "family",
      clear: () => onClearOne("family"),
    });
  }
  if (f.brushRange) {
    pills.push({
      text: `EXPOSURE ${f.brushRange[0]}–${f.brushRange[1]}`,
      key: "brush",
      clear: () => onClearOne("brush"),
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap py-1.5 px-1">
      {pills.map((p) => (
        <Pill
          key={p.key}
          text={p.text}
          ariaLabel={`clear ${p.key.replace("range:", "")}`}
          onClear={p.clear}
        />
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
