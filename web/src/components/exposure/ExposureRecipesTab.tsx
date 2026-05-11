/*
 * ExposureRecipesTab — per-cell effective-recipe view for validation
 * tests on the Test detail page.
 *
 * For each validation cell, the *effective recipe* is the test's
 * `base_params` overlaid with the cell's `params` overrides. This view
 * surfaces those recipes as a table so the user can see exactly what
 * the laser will burn for each cell — particularly useful for tests
 * created via the propose-test flow, where each cell has bespoke
 * values for the varied parameters and the rest inherit from base.
 *
 * Highlights cells whose params override the base, so it's immediate
 * which fields are varied per-cell vs. the test-wide defaults.
 */

import * as React from "react";
import type { BaseParams, ValidationCell } from "../../types";

interface Props {
  baseParams: BaseParams | null | undefined;
  validationCells: readonly ValidationCell[];
}

const NUMERIC_FIELDS: readonly { key: keyof BaseParams; label: string; unit: string; integer?: boolean }[] = [
  { key: "power",       label: "Power",     unit: "%",     integer: false },
  { key: "speed",       label: "Speed",     unit: "mm/s",  integer: true  },
  { key: "frequency",   label: "Frequency", unit: "kHz",   integer: true  },
  { key: "density",     label: "Density",   unit: "",      integer: true  },
  { key: "passes",      label: "Passes",    unit: "",      integer: true  },
  { key: "pulse_width", label: "Pulse W.",  unit: "ns",    integer: true  },
  { key: "scan_angle",  label: "Angle",     unit: "°",     integer: false },
];

function fmt(v: unknown, unit: string, integer = false): string {
  if (v == null) return "—";
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
  const formatted = integer ? String(Math.round(v)) : v.toFixed(2);
  return unit ? `${formatted} ${unit}` : formatted;
}

function effectiveValue(
  cell: ValidationCell, base: BaseParams | null | undefined, key: keyof BaseParams,
): { value: unknown; differsFromBase: boolean } {
  const cellVal = cell.params?.[key as string];
  const baseVal = base?.[key];
  if (cellVal !== undefined && cellVal !== null) {
    // Compare numerically when possible; otherwise strict.
    const same = typeof cellVal === "number" && typeof baseVal === "number"
      ? cellVal === baseVal
      : cellVal === baseVal;
    return { value: cellVal, differsFromBase: !same };
  }
  return { value: baseVal, differsFromBase: false };
}

export function ExposureRecipesTab({ baseParams, validationCells }: Props) {
  const cells = React.useMemo(
    () => [...validationCells].sort((a, b) => a.cell_index - b.cell_index),
    [validationCells],
  );

  // Which fields actually vary across cells? Headers for these get
  // primary-tinted to draw the eye to the per-cell values that matter.
  // Works whether cell.params carries the full recipe or only the
  // varied keys (legacy tests created before the full-recipe fix).
  const variedFields = React.useMemo(() => {
    const out = new Set<string>();
    for (const f of NUMERIC_FIELDS) {
      let allSame: unknown = undefined;
      let allSameValid = true;
      for (const c of cells) {
        const v = c.params?.[f.key as string];
        const eff = v !== undefined && v !== null ? v : baseParams?.[f.key];
        if (allSame === undefined) allSame = eff;
        else if (eff !== allSame) { allSameValid = false; break; }
      }
      if (!allSameValid) out.add(f.key as string);
    }
    return out;
  }, [cells, baseParams]);

  if (cells.length === 0) {
    return (
      <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
        <p className="font-mono text-[11px] text-[color:var(--color-ink-muted)]">
          No validation cells. Validation tests get cells either by
          picking palette entries on the Palette tab, or by drawing
          a region on the Exposure page (propose-test flow).
        </p>
      </div>
    );
  }

  const sourceSummary = (() => {
    let palettePicked = 0;
    let bespoke = 0;
    for (const c of cells) {
      if (c.palette_entry_id != null) palettePicked++;
      else bespoke++;
    }
    if (palettePicked > 0 && bespoke > 0) {
      return `${palettePicked} palette-picked · ${bespoke} bespoke`;
    }
    if (palettePicked > 0) return `${palettePicked} palette-picked`;
    return `${bespoke} bespoke`;
  })();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3 px-1">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] font-semibold text-[color:var(--color-ink-subtle)]">
          Recipes
        </h3>
        <span className="font-mono text-[11px] tabular-nums text-[color:var(--color-ink-muted)]">
          {cells.length} cell{cells.length === 1 ? "" : "s"} · {sourceSummary}
        </span>
        {variedFields.size > 0 && (
          <span className="font-mono text-[10px] text-[color:var(--color-ink-subtle)] ml-auto">
            <span className="inline-block w-2 h-2 rounded-sm bg-[color:var(--color-primary-tint)] border border-[color:var(--color-primary)] mr-1 align-middle" />
            varied per cell
          </span>
        )}
      </div>
      <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] overflow-x-auto">
        <table className="w-full font-mono text-[10.5px] tabular-nums">
          <thead>
            <tr className="bg-[color:var(--color-surface-elevated)]">
              <th className="px-2 py-1.5 text-left text-[9.5px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] font-semibold w-[34px]">
                #
              </th>
              <th className="px-2 py-1.5 text-left text-[9.5px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] font-semibold">
                Hex
              </th>
              {NUMERIC_FIELDS.map((f) => (
                <th
                  key={f.key as string}
                  className={
                    "px-2 py-1.5 text-right text-[9.5px] uppercase tracking-[0.16em] font-semibold " +
                    (variedFields.has(f.key as string)
                      ? "text-[color:var(--color-primary)]"
                      : "text-[color:var(--color-ink-subtle)]")
                  }
                >
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cells.map((c) => (
              <tr key={c.cell_index} className="border-t border-[color:var(--color-border)]">
                <td className="px-2 py-1 text-[color:var(--color-ink-subtle)]">{c.cell_index}</td>
                <td className="px-2 py-1">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block w-3 h-3 rounded-sm border border-[color:var(--color-border)]"
                      style={{ background: c.expected_hex }}
                      aria-hidden
                    />
                    <span className="text-[color:var(--color-ink)]">{c.expected_hex}</span>
                  </span>
                </td>
                {NUMERIC_FIELDS.map((f) => {
                  const { value, differsFromBase } = effectiveValue(c, baseParams, f.key);
                  return (
                    <td
                      key={f.key as string}
                      className={
                        "px-2 py-1 text-right " +
                        (differsFromBase
                          ? "text-[color:var(--color-primary)] font-semibold bg-[color:var(--color-primary-tint)]/40"
                          : "text-[color:var(--color-ink)]")
                      }
                      title={differsFromBase ? "Differs from base" : "Matches base"}
                    >
                      {fmt(value, f.unit, f.integer)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-[10px] text-[color:var(--color-ink-subtle)] leading-relaxed px-1 max-w-[80ch]">
        Tinted cells ({" "}
        <span className="inline-block w-1.5 h-1.5 rounded-sm bg-[color:var(--color-primary-tint)] border border-[color:var(--color-primary)] align-middle" />{" "}
        ) differ from the test's base parameters; un-tinted cells
        match base. Numbers shown are exactly what the laser will
        receive at burn time.
      </p>
    </div>
  );
}
