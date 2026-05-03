import { useEffect, useState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import {
  Button,
  Card,
  cn,
  DemoLock,
  notify,
} from "../ui";
import { getMachines } from "../api/machines";
import {
  deleteMaterialTextRegDefault,
  listMaterialTextRegDefaults,
  putMaterialTextRegDefault,
  resolveTextRegDefaults,
} from "../api/textRegDefaults";
import type {
  Machine,
  TextRegMaterialDefault,
  TextRegParamsBody,
  TextRegResolveResponse,
  TextRegSource,
} from "../types";
import { TextRegParamsEditor, TextRegSourcePill } from "./TextRegParamsEditor";

/**
 * Library-page right column, "Text & Registration" tab body.
 *
 * For the selected material, render one card per machine in the
 * registry. Each card shows the effective annotation params (resolved
 * via GET …/resolve) and lets the user save/reset the material-level
 * row for that (material, machine) pair.
 */

export interface MaterialTextRegPanelProps {
  materialId: number;
  materialName: string;
  isDemo?: boolean;
}

export function MaterialTextRegPanel({
  materialId,
  materialName,
  isDemo,
}: MaterialTextRegPanelProps) {
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMachines()
      .then((p) => setMachines(p.machines))
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) {
    return (
      <div className="rounded-[6px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-3 py-2 text-[13px] text-[color:var(--color-destructive)]">
        {error}
      </div>
    );
  }
  if (machines === null) {
    return (
      <div className="flex items-center gap-2 text-[12.5px] text-[color:var(--color-ink-subtle)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading machines…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] leading-relaxed text-[color:var(--color-ink-muted)] max-w-[68ch]">
        These params drive the QR, ArUco markers, axis labels, and summary
        text strip engraved on every burn for{" "}
        <span className="font-medium text-[color:var(--color-ink)]">
          {materialName}
        </span>
        . If a row is set, it overrides the per-machine fallback. Different
        substrates often need different power/density to keep these crisp.
      </p>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {machines.map((m) => (
          <MachineCard
            key={m.id}
            machine={m}
            materialId={materialId}
            materialName={materialName}
            isDemo={isDemo}
          />
        ))}
      </div>
    </div>
  );
}

// ── Per-machine card ─────────────────────────────────────────────────────

function MachineCard({
  machine,
  materialId,
  materialName,
  isDemo,
}: {
  machine: Machine;
  materialId: number;
  materialName: string;
  isDemo?: boolean;
}) {
  const [resolved, setResolved] = useState<TextRegResolveResponse | null>(null);
  const [draft, setDraft] = useState<TextRegParamsBody | null>(null);
  const [hasMaterialRow, setHasMaterialRow] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [resv, mats] = await Promise.all([
        resolveTextRegDefaults(machine.id, materialId),
        listMaterialTextRegDefaults(materialId),
      ]);
      setResolved(resv);
      setDraft({
        speed: resv.speed,
        power: resv.power,
        density: resv.density,
        repeat: resv.repeat,
        pulse_width: resv.pulse_width,
        mopa_frequency: resv.mopa_frequency,
        processing_light_source: resv.processing_light_source,
      });
      setHasMaterialRow(
        mats.some((r: TextRegMaterialDefault) => r.machine_id === machine.id),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // refresh whenever the machine or material changes
  }, [machine.id, materialId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSave() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await putMaterialTextRegDefault(materialId, machine.id, draft);
      notify(
        `Saved as material default for ${materialName} on ${machine.display_name}.`,
        "info",
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      notify(`Save failed: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  }

  async function onReset() {
    if (!hasMaterialRow) return;
    setResetting(true);
    setError(null);
    try {
      await deleteMaterialTextRegDefault(materialId, machine.id);
      notify(
        `Reset to ${machine.display_name} default for ${materialName}.`,
        "info",
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      notify(`Reset failed: ${(e as Error).message}`, "error");
    } finally {
      setResetting(false);
    }
  }

  const source: TextRegSource = resolved?.source ?? "fallback";
  const pillLabel =
    source === "material"
      ? "Material default"
      : source === "machine"
        ? "Machine fallback"
        : "Built-in fallback";

  return (
    <Card padded={false} className="overflow-hidden">
      {/* Header */}
      <div
        className={cn(
          "flex items-center gap-3 px-3.5 py-2.5",
          "border-b border-[color:var(--color-border)]",
          "bg-[color:var(--color-surface-elevated)]",
        )}
      >
        <img
          src={machine.image}
          alt=""
          aria-hidden
          className="h-[28px] w-[28px] rounded-[4px] object-contain shrink-0 bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13.5px] font-semibold text-[color:var(--color-ink)] truncate">
              {machine.display_name}
            </span>
            <TextRegSourcePill source={source} override={pillLabel} />
          </div>
          <div className="font-mono text-[10px] tracking-[0.06em] text-[color:var(--color-ink-subtle)] mt-0.5 truncate">
            {machine.id}
          </div>
        </div>
      </div>

      {/* Metallic divider */}
      <div
        aria-hidden
        className="h-px w-full"
        style={{ background: "var(--metal-bar-soft)" }}
      />

      {/* Body */}
      <div className="px-3.5 py-3">
        {loading || !draft ? (
          <div className="flex items-center gap-2 text-[12.5px] text-[color:var(--color-ink-subtle)] py-6 justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : (
          <TextRegParamsEditor
            value={draft}
            onChange={setDraft}
            disabled={isDemo || saving || resetting}
          />
        )}
        {error && (
          <p className="mt-2 text-[11.5px] text-[color:var(--color-destructive)]">
            {error}
          </p>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex flex-wrap items-center justify-end gap-2 px-3.5 py-2.5 border-t border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]/40">
        <DemoLock label="Defaults are read-only in the demo.">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onReset()}
            disabled={!hasMaterialRow || resetting || saving || loading}
            title={
              hasMaterialRow
                ? "Delete the material override; the machine fallback takes over."
                : "Already on the machine fallback — nothing to reset."
            }
            className={cn(
              "font-mono text-[10.5px] tracking-[0.12em] uppercase font-semibold",
              hasMaterialRow && "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]",
            )}
          >
            <RotateCcw className="h-3 w-3" />
            {resetting ? "Resetting…" : "Reset to machine default"}
          </Button>
        </DemoLock>
        <DemoLock label="Defaults are read-only in the demo.">
          <Button
            variant="primary"
            size="sm"
            onClick={() => void onSave()}
            disabled={saving || resetting || loading || !draft}
            className="font-mono text-[10.5px] tracking-[0.12em] uppercase font-semibold"
          >
            <Save className="h-3 w-3" />
            {saving ? "Saving…" : "Save material default"}
          </Button>
        </DemoLock>
      </div>
    </Card>
  );
}
