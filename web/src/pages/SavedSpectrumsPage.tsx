import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, Section, PageContainer, EmptyState } from "../ui";
import { listSpectrums, deleteSpectrum } from "../api/savedSpectrums";
import type { SavedSpectrum } from "../types";

export function SavedSpectrumsPage() {
  const [spectrums, setSpectrums] = useState<SavedSpectrum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minR2, setMinR2] = useState<number | "">("");

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const rows = await listSpectrums({
        minR2: typeof minR2 === "number" ? minR2 : undefined,
      });
      setSpectrums(rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minR2]);

  async function onDelete(id: number) {
    if (!window.confirm("Delete this saved spectrum?")) return;
    await deleteSpectrum(id);
    await refresh();
  }

  return (
    <PageContainer maxWidth="wide" className="py-6">
      <header className="mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)] mb-1">
          Saved spectrums
        </div>
        <h1 className="text-[22px] font-semibold text-[color:var(--color-ink)]">
          Cropped sub-spectrums + fits
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--color-ink-muted)] max-w-[68ch]">
          Each saved spectrum carries its data points, axis bounds, and per-channel
          Lab polynomial. The upcoming colour-to-spectrum predictor will read these
          to find which saved range a given colour belongs to.
        </p>
      </header>

      <div className="grid grid-cols-[260px_1fr] gap-6">
        <aside>
          <Section title="Filters" dense>
            <label className="block">
              <span className="block text-[11.5px] uppercase tracking-[0.12em] text-[color:var(--color-ink-muted)] mb-1">
                Min R²
              </span>
              <input
                type="number"
                step="0.01" min="0" max="1"
                value={minR2}
                onChange={(e) =>
                  setMinR2(e.target.value === "" ? "" : Number(e.target.value))
                }
                placeholder="any"
                className="w-full h-9 px-3 rounded-[6px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] text-[14px]"
              />
            </label>
          </Section>
        </aside>

        <main>
          {loading ? (
            <div className="text-[13px] text-[color:var(--color-ink-muted)]">Loading…</div>
          ) : error ? (
            <div className="text-[13px] text-[color:var(--color-destructive)]">{error}</div>
          ) : spectrums.length === 0 ? (
            <EmptyState
              title="No saved spectrums yet"
              description="Save one from the spectrum page — crop a sub-range, pick a fit degree, click Save spectrum. These will become the source data for the upcoming colour-to-spectrum predictor."
            />
          ) : (
            <ul className="space-y-3">
              {spectrums.map((sp) => (
                <SavedSpectrumCard key={sp.id} spectrum={sp} onDelete={onDelete} />
              ))}
            </ul>
          )}
        </main>
      </div>
    </PageContainer>
  );
}

function SavedSpectrumCard({
  spectrum, onDelete,
}: { spectrum: SavedSpectrum; onDelete: (id: number) => void }) {
  return (
    <li className="rounded-[8px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-[color:var(--color-ink)]">
            {spectrum.name}
          </h3>
          {spectrum.source_test_id !== null ? (
            <a
              href={`#/spectrum/${spectrum.source_test_id}`}
              className="text-[12px] text-[color:var(--color-primary)] hover:underline"
            >
              Test #{spectrum.source_test_id} →
            </a>
          ) : (
            <span className="text-[12px] text-[color:var(--color-ink-subtle)] italic">
              source test deleted
            </span>
          )}
        </div>
        <Button
          variant="ghost" size="sm"
          onClick={() => onDelete(spectrum.id)}
          aria-label={`Delete ${spectrum.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[12px] font-mono">
        <div className="text-[color:var(--color-ink-muted)]">axis</div>
        <div>{spectrum.axis_param}: {spectrum.axis_min}→{spectrum.axis_max} · {spectrum.swatches.length} points</div>
        <div className="text-[color:var(--color-ink-muted)]">fit</div>
        <div>
          {spectrum.fit_form} · degree {spectrum.fit_degree} ·
          {" "}L {spectrum.fit_r2.l.toFixed(2)} · a {spectrum.fit_r2.a.toFixed(2)} · b {spectrum.fit_r2.b.toFixed(2)}
        </div>
        <div className="text-[color:var(--color-ink-muted)]">lab</div>
        <div>
          L {spectrum.lab_l_min.toFixed(0)}–{spectrum.lab_l_max.toFixed(0)}
          {" "}· a {spectrum.lab_a_min.toFixed(0)}..{spectrum.lab_a_max.toFixed(0)}
          {" "}· b {spectrum.lab_b_min.toFixed(0)}..{spectrum.lab_b_max.toFixed(0)}
        </div>
        <div className="text-[color:var(--color-ink-muted)]">saved</div>
        <div>{new Date(spectrum.created_at).toLocaleString()}</div>
      </div>
      <SavedSpectrumStrip spectrum={spectrum} />
    </li>
  );
}

function SavedSpectrumStrip({ spectrum }: { spectrum: SavedSpectrum }) {
  if (spectrum.swatches.length === 0) return null;
  return (
    <div className="mt-3 flex h-6 rounded-[3px] overflow-hidden border border-[color:var(--color-border)]">
      {spectrum.swatches.map((sw) => (
        <div
          key={`${sw.swatch_row}-${sw.swatch_col}`}
          className="flex-1"
          style={{ backgroundColor: sw.hex }}
          title={`${sw.x_value} → ${sw.hex}`}
        />
      ))}
    </div>
  );
}
