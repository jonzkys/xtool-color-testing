import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import {
  Button,
  cn,
  DemoLock,
  notify,
  Section,
} from "../ui";
import {
  putMachineTextRegDefault,
  putMaterialTextRegDefault,
  resolveTextRegDefaults,
} from "../api/textRegDefaults";
import type {
  TextRegParamsBody,
  TextRegResolveResponse,
} from "../types";
import { useCurrentMachine, getValidationProfile, representativeMode } from "../state/machine";
import { TextRegParamsEditor, TextRegSourcePill } from "./TextRegParamsEditor";

/**
 * Engraved annotation params block — used inside the Tests-page
 * Registration tab, below the QR/ArUco mode + size fields.
 *
 * The values are independent of the test row: editing the fields here
 * never modifies the test (no `updateSpec`). The two action buttons
 * promote the current draft to the corresponding default level. The
 * test itself reads whatever the resolver returns at burn time.
 */

export interface AnnotationParamsSectionProps {
  machineId: string;
  machineDisplayName: string;
  materialId: number | null;
  materialName: string | null;
  /** Whether the surrounding test is locked. We still let the user
   *  edit + save defaults — locking the test only affects the burn
   *  spec, and saving a default is intentionally orthogonal. */
  locked?: boolean;
  isDemo?: boolean;
}

export function AnnotationParamsSection({
  machineId,
  machineDisplayName,
  materialId,
  materialName,
  isDemo,
}: AnnotationParamsSectionProps) {
  const { registry } = useCurrentMachine();
  const machine = registry?.machines.find((m) => m.id === machineId) ?? null;
  const profile = registry
    ? getValidationProfile(registry, machineId, machine ? representativeMode(machine) : "engrave")
    : null;

  const [resolved, setResolved] = useState<TextRegResolveResponse | null>(null);
  const [draft, setDraft] = useState<TextRegParamsBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingMachine, setSavingMachine] = useState(false);
  const [savingMaterial, setSavingMaterial] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const resv = await resolveTextRegDefaults(machineId, materialId);
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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [machineId, materialId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSaveMachine() {
    if (!draft) return;
    setSavingMachine(true);
    setError(null);
    try {
      await putMachineTextRegDefault(machineId, draft);
      notify(`Saved as machine default for ${machineDisplayName}.`, "info");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      notify(`Save failed: ${(e as Error).message}`, "error");
    } finally {
      setSavingMachine(false);
    }
  }

  async function onSaveMaterial() {
    if (!draft || materialId == null) return;
    setSavingMaterial(true);
    setError(null);
    try {
      await putMaterialTextRegDefault(materialId, machineId, draft);
      notify(
        `Saved as material default for ${materialName ?? "material"} on ${machineDisplayName}.`,
        "info",
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      notify(`Save failed: ${(e as Error).message}`, "error");
    } finally {
      setSavingMaterial(false);
    }
  }

  const busy = savingMachine || savingMaterial;

  return (
    <Section
      title={
        <div className="flex items-center gap-2 flex-wrap">
          <span>Engraved annotation params</span>
          {resolved && <TextRegSourcePill source={resolved.source} />}
        </div>
      }
      description={
        <>
          Drives the QR, ArUco markers, axis tick labels, and summary text
          strip on this test. Editing here{" "}
          <span className="text-[color:var(--color-ink)]">does not</span>{" "}
          modify the in-flight burn — use the buttons below to promote the
          values into the per-machine or per-material defaults. Defaults
          are scoped to{" "}
          <span className="font-mono text-[11px] text-[color:var(--color-ink)]">
            {machineDisplayName}
          </span>
          .
        </>
      }
    >
      {loading || !draft ? (
        <div className="flex items-center gap-2 text-[12.5px] text-[color:var(--color-ink-subtle)] py-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading current defaults…
        </div>
      ) : (
        <>
          <TextRegParamsEditor
            value={draft}
            onChange={setDraft}
            disabled={isDemo || busy}
            profile={profile}
          />
          {error && (
            <p className="text-[11.5px] text-[color:var(--color-destructive)]">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <DemoLock label="Defaults are read-only in the demo.">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void onSaveMachine()}
                disabled={busy}
                title={`Save these values as the fallback for ${machineDisplayName}.`}
                className={cn(
                  "font-mono text-[10.5px] tracking-[0.12em] uppercase font-semibold",
                )}
              >
                <Save className="h-3 w-3" />
                {savingMachine ? "Saving…" : "Save as machine default"}
              </Button>
            </DemoLock>
            <DemoLock label="Defaults are read-only in the demo.">
              <Button
                variant="primary"
                size="sm"
                onClick={() => void onSaveMaterial()}
                disabled={busy || materialId == null}
                title={
                  materialId == null
                    ? "Pick a material on the Test tab first."
                    : `Save these values for ${materialName ?? "this material"} on ${machineDisplayName}.`
                }
                className="font-mono text-[10.5px] tracking-[0.12em] uppercase font-semibold"
              >
                <Save className="h-3 w-3" />
                {savingMaterial ? "Saving…" : "Save as material default"}
              </Button>
            </DemoLock>
          </div>
          <p className="text-[11px] text-[color:var(--color-ink-subtle)] leading-relaxed">
            Defaults are per-machine — saving here only affects burns on{" "}
            <span className="font-mono text-[11px] text-[color:var(--color-ink-muted)]">
              {machineDisplayName}
            </span>
            . Other machines keep their own values.
          </p>
        </>
      )}
    </Section>
  );
}
