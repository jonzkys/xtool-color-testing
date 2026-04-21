import { useEffect, useMemo, useState } from "react";
import { Info, Search, Trash2 } from "lucide-react";
import {
  listPaletteEntries,
  queryPalette,
  deletePaletteEntry,
  deletePaletteByTest,
} from "../api/palette";
import type { PaletteEntry, PaletteQueryResult } from "../types";
import type { Material } from "../library";
import { listMaterials, listPresets } from "../api/library";
import { formatRoute } from "../router";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  PageContainer,
  Section,
  Select,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "../ui";

type View = "query" | "browse";

export function PalettePage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [view, setView] = useState<View>("browse");

  useEffect(() => {
    Promise.all([listMaterials(), listPresets()])
      .then(([mats]) => setMaterials(mats))
      .catch((e) => console.error("Failed to load library:", e));
  }, []);

  if (materials.length === 0) {
    return (
      <PageContainer className="py-8">
        <Card className="border-dashed">
          <EmptyState
            title="No materials yet"
            description="Palette entries have to be tagged with a material so queries stay scoped. Add a material on the Library tab first, then burn a test and upload the result."
            action={
              <Button variant="primary" onClick={() => (window.location.hash = "#/library")}>
                Open library
              </Button>
            }
          />
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="py-8">
      <header className="mb-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)] mb-1">
          Palette
        </div>
        <h1 className="text-[22px] font-semibold text-[color:var(--color-ink)]">
          Colour swatches per material
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--color-ink-muted)] max-w-[68ch]">
          Browse every swatch harvested from burn results, or query by hex
          to find the closest match. All entries are scoped by material so
          different substrates never mix.
        </p>
      </header>

      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabList>
          <Tab value="browse">Browse</Tab>
          <Tab value="query">Query</Tab>
        </TabList>
        <TabPanel value="browse">
          <BrowseView materials={materials} />
        </TabPanel>
        <TabPanel value="query">
          <QueryView materials={materials} />
        </TabPanel>
      </Tabs>
    </PageContainer>
  );
}

function MaterialSelect({
  materials,
  value,
  onChange,
  required,
  label,
  allowAll = true,
}: {
  materials: Material[];
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  label?: string;
  allowAll?: boolean;
}) {
  return (
    <Field label={label} inline>
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        invalid={required && !value}
      >
        {allowAll && !required && <option value="">— all materials —</option>}
        {required && !value && <option value="">— pick a material —</option>}
        {materials.map((m) => (
          <option key={m.id} value={String(m.id)}>
            {m.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function QueryView({ materials }: { materials: Material[] }) {
  const [hex, setHex] = useState("#c4a87b");
  const [materialId, setMaterialId] = useState<string>(
    materials[0] ? String(materials[0].id) : "",
  );
  const [results, setResults] = useState<PaletteQueryResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  async function onQuery() {
    setError(undefined);
    setLoading(true);
    try {
      const matIdNum = materialId ? Number(materialId) : undefined;
      const r = await queryPalette(hex, { limit: 5, material_id: matIdNum });
      setResults(r);
      setSearched(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <Section
          title="Find the closest match"
          description="Pick a target colour; we return the 5 nearest palette entries by CIEDE2000. Scope by material to avoid mixing burn families."
        >
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Target colour">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={hex}
                  onChange={(e) => setHex(e.target.value)}
                  aria-label="Colour picker"
                  className="h-9 w-12 rounded-[6px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] cursor-pointer p-1"
                />
                <Input
                  mono
                  value={hex}
                  onChange={(e) => setHex(e.target.value)}
                  className="w-[136px]"
                />
              </div>
            </Field>
            <MaterialSelect
              materials={materials}
              value={materialId}
              onChange={setMaterialId}
              label="Material"
            />
            <Button variant="primary" onClick={onQuery} disabled={loading}>
              <Search className="h-4 w-4" />
              {loading ? "Searching…" : "Find closest"}
            </Button>
          </div>
          {error && (
            <p className="text-[12px] text-[color:var(--color-destructive)]">{error}</p>
          )}
        </Section>
      </Card>

      {searched && results.length === 0 && !error && (
        <EmptyState
          title="No matches"
          description="Either the palette is empty for this material, or no entries are close enough. Try a wider material scope, or burn more reference tests."
        />
      )}

      {results.length > 0 && (
        <Card padded={false}>
          <ul className="divide-y divide-[color:var(--color-border)]">
            {results.map((r) => (
              <li key={r.entry.id}>
                <ResultRow result={r} materials={materials} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ResultRow({
  result,
  materials,
}: {
  result: PaletteQueryResult;
  materials: Material[];
}) {
  const p = result.entry.params;
  const materialName =
    materials.find((m) => m.id === result.entry.material_id)?.name ??
    "(unknown material)";
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
      <div className="flex items-center gap-3 min-w-[220px]">
        <div
          className="h-12 w-12 rounded-[6px] border border-[color:var(--color-border-strong)] shrink-0"
          style={{ background: result.entry.hex }}
        />
        <div className="leading-tight">
          <div className="font-mono text-[13px] text-[color:var(--color-ink)]">
            {result.entry.hex}
          </div>
          <div className="font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
            ΔE {result.delta_e.toFixed(2)}
          </div>
        </div>
      </div>
      <Badge variant="info">{materialName}</Badge>
      <div className="font-mono text-[11px] text-[color:var(--color-ink-muted)] tabular-nums">
        P={p.power}% · S={p.speed} · F={p.frequency} · D={p.density} · ×{p.passes} · PW={p.pulse_width} · {p.laser}
      </div>
      <a
        href={formatRoute({ name: "test-detail", id: result.entry.test_id })}
        className="ml-auto text-[12px] text-[color:var(--color-secondary)] hover:underline"
      >
        View test #{result.entry.test_id}
      </a>
    </div>
  );
}

function BrowseView({ materials }: { materials: Material[] }) {
  const [entries, setEntries] = useState<PaletteEntry[]>([]);
  const [materialId, setMaterialId] = useState<string>("");
  const [error, setError] = useState<string | undefined>();
  const [infoId, setInfoId] = useState<number | null>(null);

  async function refresh() {
    setError(undefined);
    try {
      const matIdNum = materialId ? Number(materialId) : undefined;
      setEntries(await listPaletteEntries(matIdNum));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId]);

  async function onDelete(id: number) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    if (!confirm(`Delete the ${entry.hex} swatch?`)) return;
    try {
      await deletePaletteEntry(id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function onDeleteTest(testId: number) {
    const count = entries.filter((e) => e.test_id === testId).length;
    if (!confirm(`Delete all ${count} palette entries from test #${testId}?`)) return;
    try {
      await deletePaletteByTest(testId);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const byTest: Record<number, PaletteEntry[]> = {};
  entries.forEach((e) => {
    (byTest[e.test_id] = byTest[e.test_id] ?? []).push(e);
  });
  const testIds = Object.keys(byTest).map(Number).sort((a, b) => b - a);

  const infoEntry = useMemo(
    () => (infoId !== null ? entries.find((e) => e.id === infoId) ?? null : null),
    [infoId, entries],
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <MaterialSelect
          materials={materials}
          value={materialId}
          onChange={setMaterialId}
          label="Material"
        />
        <div className="text-[12.5px] text-[color:var(--color-ink-muted)]">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
          {materialId && ` · ${materials.find((m) => String(m.id) === materialId)?.name ?? ""}`}
        </div>
      </div>
      {error && (
        <p className="text-[13px] text-[color:var(--color-destructive)]">{error}</p>
      )}
      {entries.length === 0 && !error && (
        <EmptyState
          title={materialId ? "No entries for this material" : "Palette is empty"}
          description={
            materialId
              ? "Burn a test for this material and upload the result — swatches will appear here once they're ingested."
              : "Upload a photo of a burned test on its Test Detail page and ingest swatches to populate the palette."
          }
        />
      )}
      {testIds.map((testId) => {
        const group = byTest[testId];
        const materialName =
          materials.find((m) => m.id === group[0]?.material_id)?.name ??
          "(unknown material)";
        return (
          <Section
            key={testId}
            title={
              <span className="flex items-baseline gap-2">
                <span>
                  Test <span className="font-mono text-[color:var(--color-ink)]">#{testId}</span>
                </span>
                <Badge variant="info" size="sm">{materialName}</Badge>
              </span>
            }
            actions={
              <>
                <a
                  href={formatRoute({ name: "test-detail", id: testId })}
                  className="text-[12px] text-[color:var(--color-secondary)] hover:underline"
                >
                  Open
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDeleteTest(testId)}
                  className="text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-tint)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete all ({group.length})
                </Button>
              </>
            }
          >
            <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2.5">
              {group.map((e) => (
                <EntryCard
                  key={e.id}
                  entry={e}
                  onDelete={() => onDelete(e.id)}
                  onInfo={() => setInfoId(e.id)}
                />
              ))}
            </div>
          </Section>
        );
      })}

      <Dialog open={infoEntry !== null} onOpenChange={(o) => !o && setInfoId(null)}>
        {infoEntry && (
          <InfoModalContent entry={infoEntry} materials={materials} />
        )}
      </Dialog>
    </div>
  );
}

function EntryCard({
  entry,
  onDelete,
  onInfo,
}: {
  entry: PaletteEntry;
  onDelete: () => void;
  onInfo: () => void;
}) {
  return (
    <div className="group relative rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] overflow-hidden shadow-[var(--shadow-card)]">
      <div
        className="aspect-[4/3] w-full border-b border-[color:var(--color-border)]"
        style={{ background: entry.hex }}
      />
      <div className="px-2 py-1.5 flex items-center justify-between gap-2">
        <div className="font-mono text-[11px] text-[color:var(--color-ink)]">{entry.hex}</div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={onInfo}
            title="Show full params"
            className="p-1 rounded text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete swatch"
            className="p-1 rounded text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-tint)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoModalContent({
  entry,
  materials,
}: {
  entry: PaletteEntry;
  materials: Material[];
}) {
  const materialName =
    materials.find((m) => m.id === entry.material_id)?.name ?? "(unknown material)";

  return (
    <DialogContent width="md">
      <DialogHeader>
        <DialogTitle>Swatch details</DialogTitle>
      </DialogHeader>
      <div className="flex items-center gap-4 mb-5">
        <div
          className="h-16 w-16 rounded-[10px] border border-[color:var(--color-border-strong)] shrink-0"
          style={{ background: entry.hex }}
        />
        <div className="leading-tight">
          <div className="font-mono text-[16px] font-semibold text-[color:var(--color-ink)]">
            {entry.hex}
          </div>
          <div className="text-[12px] text-[color:var(--color-ink-muted)] mt-0.5">
            σ {entry.sigma.toFixed(2)} · {entry.source}
          </div>
        </div>
      </div>
      <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-[12.5px]">
        <InfoRow label="Material" value={materialName} />
        <InfoRow label="Test" value={`#${entry.test_id}`} mono />
        <InfoRow label="Captured" value={entry.created_at} mono />
        {Object.entries(entry.params).map(([k, v]) => (
          <InfoRow key={k} label={k} value={String(v)} mono />
        ))}
        {entry.notes && <InfoRow label="Notes" value={entry.notes} />}
      </dl>
    </DialogContent>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="text-[color:var(--color-ink-subtle)]">{label}</dt>
      <dd
        className={
          mono
            ? "font-mono text-[color:var(--color-ink)] tabular-nums"
            : "text-[color:var(--color-ink)]"
        }
      >
        {value}
      </dd>
    </>
  );
}
