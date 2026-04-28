import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { defaultBaseParams } from "../defaults";
import { PulseWidthSelect } from "./PulseWidthSelect";
import type { Material, Preset } from "../library";
import {
  createMaterial,
  createPreset,
  deleteMaterial,
  deletePreset,
  listMaterials,
  listPresets,
  setDefaultMaterial,
  setDefaultPreset,
  updateMaterial,
  updatePreset,
} from "../api/library";
import type { TestRecord } from "../types";
import { listTests } from "../api/tests";
import { formatRoute } from "../router";
import { getCurrentMachineId, useCurrentMachine, getValidationProfile } from "../state/machine";
import { useIsDemo } from "../hooks/useIsDemo";
import { MaterialEditDialog, type SubmitValues } from "./MaterialEditDialog";
import {
  Badge,
  Button,
  Card,
  cn,
  DemoLock,
  EmptyState,
  Field,
  NumberField,
  PageContainer,
  Section,
  Select,
} from "../ui";

interface Props {
  onMaterialsChange?: (m: Material[]) => void;
}

export function LibraryPage({ onMaterialsChange }: Props) {
  const isDemo = useIsDemo();
  const { registry, machineId, machine } = useCurrentMachine();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activeMaterialId, setActiveMaterialId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [byMaterial, setByMaterial] = useState<Record<number, TestRecord[]>>({});

  const selectedMaterial =
    activeMaterialId !== null
      ? materials.find((m) => m.id === activeMaterialId) ?? null
      : materials[0] ?? null;
  const selectedMaterialId = selectedMaterial?.id ?? null;
  const materialPresets =
    selectedMaterialId !== null
      ? presets.filter((p) => p.material_id === selectedMaterialId)
      : [];

  async function refresh() {
    try {
      const [mats, pres] = await Promise.all([listMaterials(), listPresets(undefined, getCurrentMachineId())]);
      setMaterials(mats);
      setPresets(pres);
      onMaterialsChange?.(mats);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Material-edit dialog. ``editingMaterial=null`` means create-mode;
  // ``=Material`` means edit-mode for that record. The dialog itself
  // rejects empty names and validates the shape/dimension consistency
  // before calling onSubmit.
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);

  function onAddMaterial() {
    setEditingMaterial(null);
    setMaterialDialogOpen(true);
  }

  function onEditMaterial(id: number) {
    const m = materials.find((mm) => mm.id === id);
    if (!m) return;
    setEditingMaterial(m);
    setMaterialDialogOpen(true);
  }

  async function onMaterialDialogSubmit(values: SubmitValues) {
    setLoading(true);
    try {
      if (editingMaterial) {
        await updateMaterial(editingMaterial.id, values);
      } else {
        const created = await createMaterial(values);
        setActiveMaterialId(created.id);
      }
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  async function onMakeDefaultMaterial(id: number) {
    // Cheap optimistic update so the pill flips before the round-trip.
    setMaterials((prev) =>
      prev.map((m) => ({ ...m, is_default: m.id === id })),
    );
    try {
      await setDefaultMaterial(id);
    } catch (err) {
      setError((err as Error).message);
      await refresh();
    }
  }

  async function onDeleteMaterial(id: number) {
    const m = materials.find((mm) => mm.id === id);
    if (!m) return;
    const hasPresets = presets.some((p) => p.material_id === id);
    if (hasPresets) {
      alert(`Cannot delete "${m.name}" — delete its presets first.`);
      return;
    }
    if (!confirm(`Delete material "${m.name}"?`)) return;
    setLoading(true);
    try {
      await deleteMaterial(id);
      await refresh();
      if (activeMaterialId === id) setActiveMaterialId(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onAddPreset() {
    if (selectedMaterialId === null) return;
    const existingDefault = presets.find(
      (p) => p.material_id === selectedMaterialId && p.is_default,
    );
    // Profile-aware defaults so a fresh preset on (say) F1 doesn't
    // ship freq=125 (the F2-era legacy default), which then 422s
    // when the preset is later applied to an F1 test save.
    const defaultMode = machine?.modes[0]?.id ?? (machineId === "F2Ultra" ? "color_engrave" : "engrave");
    const profile = getValidationProfile(registry, machineId, defaultMode) ?? undefined;
    const seed = existingDefault ? existingDefault.base_params : defaultBaseParams(profile);
    setLoading(true);
    try {
      await createPreset({
        material_id: selectedMaterialId,
        name: "Untitled preset",
        base_params: { ...seed },
        machine_id: getCurrentMachineId(),
      });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onUpdatePreset(
    id: number,
    patch: Partial<Pick<Preset, "name" | "color" | "base_params">>,
  ) {
    setLoading(true);
    try {
      await updatePreset(id, patch);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onDeletePreset(id: number) {
    const p = presets.find((pp) => pp.id === id);
    if (!p) return;
    if (!confirm(`Delete preset "${p.name}"?`)) return;
    setLoading(true);
    try {
      await deletePreset(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onSetDefault(id: number) {
    setLoading(true);
    try {
      await setDefaultPreset(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleTests(m: Material) {
    if (!expanded[m.id] && !byMaterial[m.id]) {
      try {
        const tests = await listTests({ material_id: m.id, machine_id: getCurrentMachineId() });
        setByMaterial((prev) => ({ ...prev, [m.id]: tests }));
      } catch (e) {
        setError((e as Error).message);
      }
    }
    setExpanded((prev) => ({ ...prev, [m.id]: !prev[m.id] }));
  }

  return (
    <PageContainer className="py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)] mb-1">
            Library
          </div>
          <h1 className="text-[22px] font-semibold text-[color:var(--color-ink)]">
            Materials &amp; presets
          </h1>
          <p className="mt-1 text-[13px] text-[color:var(--color-ink-muted)] max-w-[68ch]">
            Every test, palette entry, and SVG project is scoped to a
            material. Presets are named parameter bundles you can reuse across
            tests for the same substrate.
          </p>
        </div>
        <DemoLock label="Materials are read-only in the demo.">
          <Button variant="primary" onClick={onAddMaterial} disabled={loading}>
            <Plus className="h-4 w-4" />
            New material
          </Button>
        </DemoLock>
      </header>

      {error && (
        <div className="mb-4 rounded-[6px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-3 py-2 text-[13px] text-[color:var(--color-destructive)]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-[280px_1fr] gap-6">
        {/* LEFT — materials list */}
        <div>
          <Section title={`Materials (${materials.length})`} dense>
            <div className="flex flex-col gap-1">
              {materials.map((m) => {
                const presetCount = presets.filter((p) => p.material_id === m.id).length;
                const testCount = byMaterial[m.id]?.length ?? null;
                const isSelected = m.id === selectedMaterialId;
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "rounded-[8px] border transition-colors",
                      isSelected
                        ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary-tint)]/60"
                        : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] hover:border-[color:var(--color-border-strong)]",
                    )}
                  >
                    <div
                      onClick={() => setActiveMaterialId(m.id)}
                      className="flex items-center gap-2 px-2.5 py-2 cursor-pointer select-none"
                    >
                      <div className="flex-1 min-w-0 truncate text-[13px] font-medium text-[color:var(--color-ink)]">
                        {m.name}
                      </div>
                      <Badge
                        variant={isSelected ? "accent" : "neutral"}
                        size="sm"
                        title={`${presetCount} preset${presetCount === 1 ? "" : "s"}`}
                      >
                        {presetCount}
                      </Badge>
                      <DefaultStar
                        isDefault={m.is_default}
                        isDemo={isDemo}
                        onPromote={() => void onMakeDefaultMaterial(m.id)}
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditMaterial(m.id);
                        }}
                        className="p-1 rounded text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface-elevated)]"
                        title={isDemo ? "Materials are read-only in the demo." : "Edit"}
                        disabled={isDemo}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onDeleteMaterial(m.id);
                        }}
                        className="p-1 rounded text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-tint)]"
                        title={isDemo ? "Materials are read-only in the demo." : "Delete"}
                        disabled={isDemo}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="px-2.5 pb-2">
                      <button
                        type="button"
                        onClick={() => void toggleTests(m)}
                        className="inline-flex items-center gap-1 text-[11px] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-secondary)]"
                      >
                        {expanded[m.id] ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        {testCount === null ? "tests…" : `${testCount} test${testCount === 1 ? "" : "s"}`}
                      </button>
                      {expanded[m.id] && (
                        <div className="mt-1 ml-4 flex flex-col gap-0.5">
                          {(byMaterial[m.id] ?? []).length === 0 && (
                            <div className="text-[11px] text-[color:var(--color-ink-subtle)]">
                              no tests yet
                            </div>
                          )}
                          {(byMaterial[m.id] ?? []).map((t) => (
                            <a
                              key={t.id}
                              href={formatRoute({ name: "test-detail", id: t.id })}
                              className="text-[11.5px] text-[color:var(--color-secondary)] hover:underline"
                            >
                              <span className="font-mono">#{t.id}</span> {t.name}{" "}
                              <span className="text-[color:var(--color-ink-subtle)]">
                                ({t.status})
                              </span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {materials.length === 0 && (
                <div className="text-[12.5px] text-[color:var(--color-ink-subtle)] py-4 text-center">
                  No materials yet.
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* RIGHT — presets for the selected material */}
        <div>
          {selectedMaterial ? (
            <Section
              title={selectedMaterial.name}
              description={`${materialPresets.length} preset${materialPresets.length === 1 ? "" : "s"}`}
              actions={
                <DemoLock label="Presets are read-only in the demo.">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void onAddPreset()}
                    disabled={loading}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New preset
                  </Button>
                </DemoLock>
              }
            >
              {materialPresets.length === 0 ? (
                <Card className="border-dashed">
                  <EmptyState
                    title="No presets yet"
                    description='Presets hold reusable parameter bundles. Click "New preset" to start one — they seed new tests and SVG layers for this material.'
                    action={
                      <DemoLock label="Presets are read-only in the demo.">
                        <Button variant="primary" onClick={() => void onAddPreset()}>
                          <Plus className="h-4 w-4" />
                          New preset
                        </Button>
                      </DemoLock>
                    }
                  />
                </Card>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
                  {materialPresets.map((p) => (
                    <PresetCard
                      key={p.id}
                      preset={p}
                      onPatch={(patch) => void onUpdatePreset(p.id, patch)}
                      onSetDefault={() => void onSetDefault(p.id)}
                      onDelete={() => void onDeletePreset(p.id)}
                      isDemo={isDemo}
                    />
                  ))}
                </div>
              )}
            </Section>
          ) : (
            <EmptyState
              title="Select a material"
              description="Pick one on the left to see and edit its presets, or add a new material."
            />
          )}
        </div>
      </div>
      <MaterialEditDialog
        open={materialDialogOpen}
        onOpenChange={setMaterialDialogOpen}
        initial={editingMaterial}
        onSubmit={onMaterialDialogSubmit}
      />
    </PageContainer>
  );
}

function PresetCard({
  preset,
  onPatch,
  onSetDefault,
  onDelete,
  isDemo,
}: {
  preset: Preset;
  onPatch: (patch: Partial<Pick<Preset, "name" | "color" | "base_params">>) => void;
  onSetDefault: () => void;
  onDelete: () => void;
  isDemo?: boolean;
}) {
  const [draftName, setDraftName] = useState(preset.name);
  const [draftColor, setDraftColor] = useState(preset.color ?? "#888888");
  const [draftParams, setDraftParams] = useState(preset.base_params);

  useEffect(() => {
    setDraftName(preset.name);
  }, [preset.name]);
  useEffect(() => {
    setDraftColor(preset.color ?? "#888888");
  }, [preset.color]);
  useEffect(() => {
    setDraftParams(preset.base_params);
  }, [preset.base_params]);

  function commitName() {
    if (draftName !== preset.name) onPatch({ name: draftName });
  }
  function commitColor() {
    if (draftColor !== (preset.color ?? "#888888")) onPatch({ color: draftColor });
  }
  function commitParam<K extends keyof typeof draftParams>(
    key: K,
    v: (typeof draftParams)[K],
  ) {
    const next = { ...draftParams, [key]: v };
    setDraftParams(next);
    onPatch({ base_params: next });
  }

  return (
    <Card
      padded={false}
      className={cn(
        preset.is_default &&
          "ring-1 ring-[color:var(--color-primary)]/30 border-[color:var(--color-primary)]/30",
      )}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-[color:var(--color-border)]">
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          disabled={isDemo}
          title={isDemo ? "Presets are read-only in the demo." : undefined}
          className="flex-1 min-w-0 bg-transparent border-0 border-b border-transparent hover:border-[color:var(--color-border)] focus:outline-none focus:border-[color:var(--color-primary)] text-[14px] font-semibold text-[color:var(--color-ink)] px-0 py-0.5"
        />
        <label
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] cursor-pointer select-none",
            preset.is_default
              ? "bg-[color:var(--color-primary-tint)] text-[color:var(--color-primary)] border border-[color:var(--color-primary)]/30"
              : "text-[color:var(--color-ink-muted)] border border-[color:var(--color-border)] hover:border-[color:var(--color-border-strong)]",
          )}
        >
          <input
            type="radio"
            checked={preset.is_default}
            onChange={onSetDefault}
            disabled={isDemo}
            title={isDemo ? "Presets are read-only in the demo." : undefined}
            className="sr-only"
          />
          {preset.is_default ? "Default" : "Make default"}
        </label>
      </div>

      <div className="px-3 py-2 flex items-center gap-2 border-b border-[color:var(--color-border)]">
        <input
          type="color"
          value={draftColor}
          onChange={(e) => setDraftColor(e.target.value)}
          onBlur={commitColor}
          disabled={isDemo}
          title={isDemo ? "Presets are read-only in the demo." : undefined}
          aria-label="Preset colour"
          className="h-7 w-10 rounded-[4px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] cursor-pointer p-0.5"
        />
        <div className="font-mono text-[11px] text-[color:var(--color-ink-muted)] flex-1">
          {preset.color ?? "(no colour set)"}
        </div>
        {preset.color && (
          <button
            type="button"
            onClick={() => onPatch({ color: undefined })}
            disabled={isDemo}
            title={isDemo ? "Presets are read-only in the demo." : undefined}
            className="text-[11px] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]"
          >
            clear
          </button>
        )}
      </div>

      <div className="px-3 pt-3 pb-2 grid grid-cols-2 gap-3">
        <NumberField
          label="Power %"
          value={draftParams.power}
          onChange={(v) => setDraftParams((p) => ({ ...p, power: v }))}
          onCommit={(v) => commitParam("power", v)}
          disabled={isDemo}
        />
        <NumberField
          label="Speed"
          value={draftParams.speed}
          integer
          onChange={(v) => setDraftParams((p) => ({ ...p, speed: v }))}
          onCommit={(v) => commitParam("speed", v)}
          disabled={isDemo}
        />
        <NumberField
          label="Frequency"
          value={draftParams.frequency}
          integer
          onChange={(v) => setDraftParams((p) => ({ ...p, frequency: v }))}
          onCommit={(v) => commitParam("frequency", v)}
          disabled={isDemo}
        />
        <NumberField
          label="Lines/cm"
          value={draftParams.density}
          integer
          onChange={(v) => setDraftParams((p) => ({ ...p, density: v }))}
          onCommit={(v) => commitParam("density", v)}
          disabled={isDemo}
        />
        <NumberField
          label="Passes"
          value={draftParams.passes}
          integer
          min={1}
          onChange={(v) => setDraftParams((p) => ({ ...p, passes: v }))}
          onCommit={(v) => commitParam("passes", v)}
          disabled={isDemo}
        />
        <PulseWidthSelect
          label="Pulse width"
          value={draftParams.pulse_width}
          onChange={(v) => {
            if (!isDemo) {
              setDraftParams((p) => ({ ...p, pulse_width: v }));
              commitParam("pulse_width", v);
            }
          }}
        />
        <div className="col-span-2">
          <Field label="Laser">
            <Select
              value={draftParams.laser}
              disabled={isDemo}
              onChange={(e) =>
                onPatch({
                  base_params: {
                    ...draftParams,
                    laser: e.target.value as "red" | "blue",
                  },
                })
              }
            >
              <option value="red">Red (MOPA)</option>
              <option value="blue">Blue (diode)</option>
            </Select>
          </Field>
        </div>
      </div>

      <div className="px-3 py-2 border-t border-[color:var(--color-border)] flex justify-end">
        <DemoLock label="Presets are read-only in the demo.">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-tint)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete preset
          </Button>
        </DemoLock>
      </div>
    </Card>
  );
}

/** Tiny star icon on each material row. Filled = current default;
 *  outline = clickable to promote. Sits inline with the edit/delete
 *  buttons — keeps the material name column wider than the previous
 *  text-pill which truncated longer names. Promotion is optimistic. */
function DefaultStar({
  isDefault,
  isDemo,
  onPromote,
}: {
  isDefault: boolean;
  isDemo: boolean;
  onPromote: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!isDefault && !isDemo) onPromote();
      }}
      disabled={isDemo || isDefault}
      className={cn(
        "p-1 rounded transition-colors",
        isDefault
          ? "text-[color:var(--color-primary)] cursor-default"
          : isDemo
            ? "text-[color:var(--color-ink-subtle)] opacity-40 cursor-not-allowed"
            : "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-tint)] cursor-pointer",
      )}
      title={
        isDefault
          ? "Default material — pre-fills the new-test picker"
          : isDemo
            ? "Materials are read-only in the demo."
            : "Make this the default material"
      }
      aria-label={isDefault ? "Default material" : "Make default"}
      aria-pressed={isDefault}
    >
      <Star
        className="h-3.5 w-3.5"
        fill={isDefault ? "currentColor" : "none"}
        strokeWidth={2}
      />
    </button>
  );
}
