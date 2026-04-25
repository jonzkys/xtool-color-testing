import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Info, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { DialogClose } from "@radix-ui/react-dialog";
import {
  listPaletteEntries,
  queryPalette,
  deletePaletteEntry,
  deletePaletteByTest,
  createManualPaletteEntry,
  patchPaletteEntry,
} from "../api/palette";
import type { PaletteEntry, PaletteQueryResult } from "../types";
import type { Material } from "../library";
import { listMaterials, listPresets } from "../api/library";
import { formatRoute } from "../router";
import { PaletteEntryDialog } from "./PaletteEntryDialog";
import { getCurrentMachineId } from "../state/machine";
import { StarToggle } from "./StarToggle";
import {
  Badge, Button, Card, Dialog, DialogContent, DialogTitle, DemoLock,
  EmptyState, Field, Input, MetalBar, PageContainer, Section, Select,
  Tab, TabList, TabPanel, Tabs, cn,
} from "../ui";

type View = "browse" | "manual" | "favorites" | "query";

export function PalettePage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [view, setView] = useState<View>("browse");

  useEffect(() => {
    Promise.all([listMaterials(), listPresets(undefined, getCurrentMachineId())])
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
          Browse every swatch harvested from burn results, hand-author your
          own, or query by hex. Star any swatch to keep it on hand. All entries
          are scoped by material so different substrates never mix.
        </p>
      </header>

      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabList>
          <Tab value="browse">Browse</Tab>
          <Tab value="manual">Manual</Tab>
          <Tab value="favorites">Favorites</Tab>
          <Tab value="query">Query</Tab>
        </TabList>
        <TabPanel value="browse">
          <BrowseView materials={materials} />
        </TabPanel>
        <TabPanel value="manual">
          <ManualView materials={materials} />
        </TabPanel>
        <TabPanel value="favorites">
          <FavoritesView materials={materials} />
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
      const r = await queryPalette(hex, { limit: 5, material_id: matIdNum, machine_id: getCurrentMachineId() });
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
      {result.entry.test_id !== null && (
        <a
          href={formatRoute({ name: "test-detail", id: result.entry.test_id })}
          className="ml-auto text-[12px] text-[color:var(--color-secondary)] hover:underline"
        >
          View test #{result.entry.test_id}
        </a>
      )}
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
      setEntries(await listPaletteEntries({ material_id: matIdNum, machine_id: getCurrentMachineId() }));
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
  async function onFavoriteToggle(entry: PaletteEntry, next: boolean) {
    // Optimistic
    setEntries((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, favorited: next } : e)),
    );
    try {
      await patchPaletteEntry(entry.id, { favorited: next });
    } catch (e) {
      setError((e as Error).message);
      // rollback
      setEntries((prev) =>
        prev.map((x) => (x.id === entry.id ? { ...x, favorited: !next } : x)),
      );
    }
  }

  const byTest: Record<number, PaletteEntry[]> = {};
  entries.forEach((e) => {
    if (e.test_id === null) return;  // manual entries — shown on the Manual tab, not here
    (byTest[e.test_id] = byTest[e.test_id] ?? []).push(e);
  });
  const testIds = Object.keys(byTest).map(Number).sort((a, b) => b - a);

  const infoEntry = useMemo(
    () => (infoId !== null ? entries.find((e) => e.id === infoId) ?? null : null),
    [infoId, entries],
  );

  const visibleCount = entries.filter((e) => e.test_id !== null).length;

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
          {visibleCount} {visibleCount === 1 ? "entry" : "entries"}
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
                <DemoLock label="Deleting palette entries is disabled in the demo.">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeleteTest(testId)}
                    className="text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-tint)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete all ({group.length})
                  </Button>
                </DemoLock>
              </>
            }
          >
            <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2.5">
              {group.map((e) => (
                <EntryCard
                  key={e.id}
                  entry={e}
                  materials={materials}
                  onDelete={() => onDelete(e.id)}
                  onInfo={() => setInfoId(e.id)}
                  onFavoriteToggle={(entry, next) => onFavoriteToggle(entry, next)}
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
  materials,
  onDelete,
  onInfo,
  onEdit,
  onCopy,
  onFavoriteToggle,
}: {
  entry: PaletteEntry;
  materials: Material[];
  /** When omitted, the trash affordance is hidden (used by FavoritesView,
   *  where the only valid swatch action is unfavoriting via the star). */
  onDelete?: () => void;
  onInfo: () => void;
  onEdit?: (entry: PaletteEntry) => void;
  onCopy?: (entry: PaletteEntry, toMaterialId: number) => void;
  onFavoriteToggle: (entry: PaletteEntry, next: boolean) => void;
}) {
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTo, setCopyTo] = useState<string>("");
  const isManual = entry.source === "manual";
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!copyOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setCopyOpen(false);
    }
    function onDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setCopyOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [copyOpen]);
  return (
    <div className="group relative rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] overflow-hidden shadow-[var(--shadow-card)]">
      <div
        className="aspect-[4/3] w-full border-b border-[color:var(--color-border)] relative"
        style={{ background: entry.hex }}
      >
        {isManual && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-[4px] text-[9px] font-mono font-semibold tracking-[0.08em] uppercase bg-[color:var(--color-accent,#caa14b)] text-black/85">
            MAN
          </span>
        )}
        <StarToggle
          favorited={entry.favorited}
          onChange={(next) => onFavoriteToggle(entry, next)}
          className="absolute top-1 right-1"
        />
      </div>
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
          {isManual && onEdit && (
            <button
              type="button"
              onClick={() => onEdit(entry)}
              title="Edit swatch"
              className="p-1 rounded text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {isManual && onCopy && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setCopyOpen((v) => !v); }}
              title="Copy to another material"
              className="p-1 rounded text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          )}
          {onDelete && (
            <DemoLock label="Deleting palette entries is disabled in the demo.">
              <button
                type="button"
                onClick={onDelete}
                title="Delete swatch"
                className="p-1 rounded text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-tint)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </DemoLock>
          )}
        </div>
      </div>
      {copyOpen && isManual && onCopy && (
        <div
          ref={popoverRef}
          className="absolute right-2 top-12 z-10 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] shadow-[var(--shadow-card)] p-2 flex items-center gap-2"
        >
          <Select
            value={copyTo}
            onChange={(e) => setCopyTo(e.target.value)}
            className="text-[11px] py-1"
          >
            <option value="">Copy to…</option>
            {materials
              .filter((m) => m.id !== entry.material_id)
              .map((m) => (
                <option key={m.id} value={String(m.id)}>{m.name}</option>
              ))}
          </Select>
          <Button
            variant="primary"
            size="sm"
            disabled={copyTo === ""}
            onClick={() => {
              onCopy(entry, Number(copyTo));
              setCopyTo("");
              setCopyOpen(false);
            }}
          >
            Copy
          </Button>
        </div>
      )}
    </div>
  );
}

function ManualView({ materials }: { materials: Material[] }) {
  const [entries, setEntries] = useState<PaletteEntry[]>([]);
  const [materialId, setMaterialId] = useState<string>("");
  const [error, setError] = useState<string | undefined>();
  const [infoId, setInfoId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PaletteEntry | null>(null);

  async function refresh() {
    setError(undefined);
    try {
      setEntries(await listPaletteEntries({
        material_id: materialId ? Number(materialId) : undefined,
        source: "manual",
        machine_id: getCurrentMachineId(),
      }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [materialId]);

  async function onDelete(id: number) {
    if (!confirm("Delete this manual swatch?")) return;
    try {
      await deletePaletteEntry(id);
      await refresh();
    } catch (e) { setError((e as Error).message); }
  }
  async function onFavoriteToggle(entry: PaletteEntry, next: boolean) {
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, favorited: next } : e)));
    try {
      await patchPaletteEntry(entry.id, { favorited: next });
    } catch (e) {
      setError((e as Error).message);
      setEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, favorited: !next } : x)));
    }
  }
  async function onCopy(entry: PaletteEntry, toMaterialId: number) {
    try {
      await createManualPaletteEntry({
        material_id: toMaterialId,
        hex: entry.hex,
        params: entry.params,
        notes: entry.notes,
        machine_id: getCurrentMachineId(),
      });
      await refresh();
    } catch (e) { setError((e as Error).message); }
  }

  const byMaterial: Record<number, PaletteEntry[]> = {};
  entries.forEach((e) => { (byMaterial[e.material_id] ??= []).push(e); });
  const matIds = Object.keys(byMaterial).map(Number);

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
          {entries.length} {entries.length === 1 ? "manual swatch" : "manual swatches"}
        </div>
        <div className="ml-auto">
          <Button
            variant="primary"
            onClick={() => { setEditing(null); setDialogOpen(true); }}
          >
            <Plus className="h-4 w-4" />
            Add manual entry
          </Button>
        </div>
      </div>
      {error && <p className="text-[13px] text-[color:var(--color-destructive)]">{error}</p>}
      {entries.length === 0 && !error && (
        <EmptyState
          title="No manual entries yet"
          description={materialId
            ? "Click + to capture a recipe you've dialled in by hand."
            : "Pick a material above, then click + to add a manual swatch."}
        />
      )}
      {matIds.map((mid) => {
        const group = byMaterial[mid];
        const materialName = materials.find((m) => m.id === mid)?.name ?? "(unknown)";
        return (
          <Section
            key={mid}
            title={
              <span className="flex items-baseline gap-2">
                <span>{materialName}</span>
                <Badge variant="info" size="sm">{group.length}</Badge>
              </span>
            }
          >
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
              {group.map((e) => (
                <EntryCard
                  key={e.id}
                  entry={e}
                  materials={materials}
                  onDelete={() => onDelete(e.id)}
                  onInfo={() => setInfoId(e.id)}
                  onEdit={(en) => { setEditing(en); setDialogOpen(true); }}
                  onCopy={(en, toId) => void onCopy(en, toId)}
                  onFavoriteToggle={(entry, next) => void onFavoriteToggle(entry, next)}
                />
              ))}
            </div>
          </Section>
        );
      })}

      <PaletteEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        materials={materials}
        entry={editing}
        defaultMaterialId={materialId || undefined}
        onSaved={() => { void refresh(); }}
      />

      <Dialog open={infoEntry !== null} onOpenChange={(o) => !o && setInfoId(null)}>
        {infoEntry && (
          <InfoModalContent entry={infoEntry} materials={materials} />
        )}
      </Dialog>
    </div>
  );
}

function FavoritesView({ materials }: { materials: Material[] }) {
  const [entries, setEntries] = useState<PaletteEntry[]>([]);
  const [materialId, setMaterialId] = useState<string>("");
  const [error, setError] = useState<string | undefined>();
  const [infoId, setInfoId] = useState<number | null>(null);

  async function refresh() {
    setError(undefined);
    try {
      setEntries(await listPaletteEntries({
        material_id: materialId ? Number(materialId) : undefined,
        favorites_only: true,
        machine_id: getCurrentMachineId(),
      }));
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [materialId]);

  async function onUnfavorite(entry: PaletteEntry) {
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    try {
      await patchPaletteEntry(entry.id, { favorited: false });
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    }
  }

  const byMaterial: Record<number, PaletteEntry[]> = {};
  entries.forEach((e) => { (byMaterial[e.material_id] ??= []).push(e); });
  const matIds = Object.keys(byMaterial).map(Number);

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
          {entries.length} {entries.length === 1 ? "favorite" : "favorites"}
        </div>
      </div>
      {error && <p className="text-[13px] text-[color:var(--color-destructive)]">{error}</p>}
      {entries.length === 0 && !error && (
        <EmptyState
          title="No favorites yet"
          description="Click the star on any swatch (Browse, Manual, or the SVG matcher) to pin it here."
        />
      )}
      {matIds.map((mid) => {
        const group = byMaterial[mid];
        const materialName = materials.find((m) => m.id === mid)?.name ?? "(unknown)";
        return (
          <Section
            key={mid}
            title={
              <span className="flex items-baseline gap-2">
                <span>{materialName}</span>
                <Badge variant="info" size="sm">{group.length}</Badge>
              </span>
            }
          >
            <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2.5">
              {group.map((e) => (
                <EntryCard
                  key={e.id}
                  entry={e}
                  materials={materials}
                  onInfo={() => setInfoId(e.id)}
                  onFavoriteToggle={(entry, next) => {
                    if (!next) void onUnfavorite(entry);
                  }}
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

function InfoModalContent({
  entry,
  materials,
}: {
  entry: PaletteEntry;
  materials: Material[];
}) {
  const [copied, setCopied] = useState(false);
  const materialName =
    materials.find((m) => m.id === entry.material_id)?.name ?? "(unknown material)";

  const rgb = hexToRgb(entry.hex);
  const hsl = rgbToHsl(rgb);
  const lab = entry.lab;

  const copyHex = useCallback(() => {
    void navigator.clipboard?.writeText(entry.hex);
    setCopied(true);
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [entry.hex]);

  const paramEntries = Object.entries(entry.params);
  const capturedPretty = formatCaptured(entry.created_at);

  return (
    <DialogContent
      width="lg"
      className="p-0 overflow-hidden"
      aria-describedby={undefined}
    >
      <DialogTitle className="sr-only">Swatch {entry.hex}</DialogTitle>

      {/* Hero chip — the swatch as a physical specimen. Click to copy hex. */}
      <button
        type="button"
        onClick={copyHex}
        aria-label={`Copy ${entry.hex} to clipboard`}
        className="group relative block w-full h-[210px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--color-primary)]/60"
        style={{ background: entry.hex }}
      >
        {/* Soft inner vignette — gives the flat colour the sense of a
            painted chip rather than a CSS fill. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 40%, transparent 55%, rgba(0,0,0,0.22) 100%)",
          }}
        />
        {/* Fine grain overlay — inline SVG noise, low opacity. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.08] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          }}
        />

        {/* Registration tick marks at each corner — print-shop crop-mark
            motif. mix-blend-difference keeps them readable on any swatch
            colour. */}
        <TickMark corner="tl" />
        <TickMark corner="tr" />
        <TickMark corner="bl" />
        <TickMark corner="br" />

        {/* Top-right slug */}
        <div
          className="absolute top-4 right-5 font-mono text-[10px] tracking-[0.22em] uppercase font-semibold"
          style={{ color: "white", mixBlendMode: "difference" }}
        >
          Swatch · Test {entry.test_id}
        </div>

        {/* Bottom-left: HEX printed on the chip in display-monospace */}
        <div
          className="absolute bottom-4 left-5 font-mono text-[22px] tracking-[0.08em] font-semibold leading-none"
          style={{ color: "white", mixBlendMode: "difference" }}
        >
          {entry.hex.toUpperCase()}
        </div>

        {/* Bottom-right: click-to-copy affordance. Morphs to a check on
            copy and fades after 1.5s. */}
        <div
          className="absolute bottom-4 right-5 inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.18em] uppercase font-semibold"
          style={{ color: "white", mixBlendMode: "difference" }}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              Copied
            </>
          ) : (
            <>
              <Copy
                className="h-3.5 w-3.5 opacity-70 group-hover:opacity-100 transition-opacity"
                strokeWidth={2}
              />
              Copy hex
            </>
          )}
        </div>
      </button>

      {/* Close button floated over the chip so it doesn't eat vertical
          space. Uses mix-blend so it's visible against any colour. */}
      <DialogClose
        aria-label="Close"
        className="absolute top-3 left-3 h-7 w-7 inline-flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60"
        style={{ color: "white", mixBlendMode: "difference" }}
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </DialogClose>

      <MetalBar />

      {/* Colour-space readout strip — instrument panel across 4 axes. */}
      <div className="grid grid-cols-4 divide-x divide-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]">
        <ReadoutCell label="HEX" value={entry.hex.toUpperCase()} />
        <ReadoutCell label="RGB" value={`${rgb.r} · ${rgb.g} · ${rgb.b}`} />
        <ReadoutCell
          label="L*a*b*"
          value={
            lab.length >= 3
              ? `${fmtNum(lab[0])} · ${fmtNum(lab[1])} · ${fmtNum(lab[2])}`
              : "—"
          }
        />
        <ReadoutCell label="HSL" value={`${hsl.h}° · ${hsl.s}% · ${hsl.l}%`} />
      </div>

      <MetalBar variant="soft" />

      {/* Provenance block */}
      <div className="px-6 pt-5 pb-5">
        <SectionLabel>Provenance</SectionLabel>
        <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2.5 text-[12.5px]">
          <FactLabel>Material</FactLabel>
          <FactValue>{materialName}</FactValue>

          <FactLabel>Test</FactLabel>
          <FactValue mono>#{entry.test_id}</FactValue>

          <FactLabel>Captured</FactLabel>
          <FactValue mono>{capturedPretty}</FactValue>

          <FactLabel>Source</FactLabel>
          <dd className="self-center">
            <SourceBadge source={entry.source} />
          </dd>

          <FactLabel>Deviation</FactLabel>
          <dd className="self-center flex items-center gap-3">
            <SigmaMeter sigma={entry.sigma} />
            <span className="font-mono tabular-nums text-[12.5px] text-[color:var(--color-ink)]">
              σ {entry.sigma.toFixed(2)}
            </span>
          </dd>
        </dl>
      </div>

      {paramEntries.length > 0 && (
        <>
          <MetalBar variant="soft" />
          <div className="px-6 pt-5 pb-5">
            <SectionLabel>Laser parameters</SectionLabel>
            <div className="mt-3 flex flex-wrap gap-2">
              {paramEntries.map(([k, v]) => (
                <ParamChip key={k} name={k} value={v} />
              ))}
            </div>
          </div>
        </>
      )}

      {entry.notes && (
        <>
          <MetalBar variant="soft" />
          <div className="px-6 pt-5 pb-5">
            <SectionLabel>Notes</SectionLabel>
            <p className="mt-2 text-[13px] text-[color:var(--color-ink)] leading-relaxed whitespace-pre-wrap">
              {entry.notes}
            </p>
          </div>
        </>
      )}
    </DialogContent>
  );
}

function TickMark({ corner }: { corner: "tl" | "tr" | "bl" | "br" }) {
  const pos = {
    tl: "top-3 left-3",
    tr: "top-3 right-3 rotate-90",
    bl: "bottom-3 left-3 -rotate-90",
    br: "bottom-3 right-3 rotate-180",
  }[corner];
  return (
    <div
      aria-hidden
      className={cn("absolute h-3 w-3 pointer-events-none", pos)}
      style={{ mixBlendMode: "difference" }}
    >
      <div className="absolute top-0 left-0 h-px w-full" style={{ background: "white" }} />
      <div className="absolute top-0 left-0 w-px h-full" style={{ background: "white" }} />
    </div>
  );
}

function ReadoutCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3.5">
      <div className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
        {label}
      </div>
      <div className="mt-1 font-mono text-[12px] tabular-nums text-[color:var(--color-ink)] truncate">
        {value}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
      <span className="h-px w-4 bg-[color:var(--color-border-strong)]" aria-hidden />
      {children}
    </div>
  );
}

function FactLabel({ children }: { children: ReactNode }) {
  return (
    <dt className="font-mono text-[10px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)] self-center">
      {children}
    </dt>
  );
}

function FactValue({
  children,
  mono,
}: {
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <dd
      className={cn(
        "text-[color:var(--color-ink)] self-center",
        mono && "font-mono tabular-nums",
      )}
    >
      {children}
    </dd>
  );
}

function SourceBadge({ source }: { source: PaletteEntry["source"] }) {
  const label = source === "averaged" ? "averaged" : source === "manual" ? "manual" : "single result";
  const dotClass =
    source === "averaged"
      ? "bg-[color:var(--color-primary)]"
      : source === "manual"
        ? "bg-[color:var(--color-accent,#caa14b)]"
        : "bg-[color:var(--color-secondary)]";
  return (
    <span className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] font-mono text-[11px] tracking-[0.04em] text-[color:var(--color-ink-muted)]">
      <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} aria-hidden />
      {label}
    </span>
  );
}

function SigmaMeter({ sigma }: { sigma: number }) {
  // Scale σ onto a 0→3 "tight → noisy" range; anything above 3 pins at full.
  const pct = Math.min(1, Math.max(0, sigma / 3)) * 100;
  const fill =
    pct < 50
      ? "var(--color-success)"
      : pct < 83
        ? "var(--color-warning)"
        : "var(--color-destructive)";
  return (
    <div
      className="relative w-[110px] h-[4px] rounded-full bg-[color:var(--color-surface-elevated)] border border-[color:var(--color-border)] overflow-hidden"
      role="img"
      aria-label={`Sigma ${sigma.toFixed(2)} of 3`}
    >
      <div
        className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, background: fill }}
      />
    </div>
  );
}

function ParamChip({ name, value }: { name: string; value: string | number }) {
  const unit = unitForParam(name);
  const prettyName = name.replace(/_/g, " ");
  return (
    <div className="inline-flex items-baseline gap-2 px-2.5 py-1 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]">
      <span className="font-mono text-[9.5px] font-semibold tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
        {prettyName}
      </span>
      <span className="font-mono text-[12px] tabular-nums font-medium text-[color:var(--color-ink)]">
        {value}
        {unit && (
          <span className="ml-0.5 text-[10px] text-[color:var(--color-ink-muted)]">
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}

function unitForParam(name: string): string | null {
  const map: Record<string, string> = {
    speed: "mm/s",
    power: "%",
    frequency: "Hz",
    freq: "Hz",
    mopa_frequency: "Hz",
    density: "l/cm",
    passes: "×",
    repeat: "×",
    pulse_width: "ns",
    pulsewidth: "ns",
  };
  return map[name.toLowerCase()] ?? null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "").trim();
  if (h.length !== 6) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }): {
  h: number;
  s: number;
  l: number;
} {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
  }
  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function fmtNum(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return n.toFixed(1);
}

function formatCaptured(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
