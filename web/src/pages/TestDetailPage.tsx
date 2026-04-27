import { useEffect, useState } from "react";
import { Copy, Download, Lock, Save, Trash2 } from "lucide-react";
import type { Material, Preset } from "../library";
import type { TestRecord, TestSpec } from "../types";
import {
  getTest,
  updateTest,
  deleteTest,
  generateTestXcs,
  retestTest,
  createTest,
} from "../api/tests";
import { listMaterials, listPresets } from "../api/library";
import { ParamTestEditor } from "../components/ParamTestEditor";
import type { ParamTestEditorTab } from "../components/ParamTestEditor";
import { TestPreview } from "../components/TestPreview";
import { ResultsPanel } from "../components/ResultsPanel";
import { formatRoute } from "../router";
import { DEFAULT_SPEC } from "../defaults";
import { normalizeSpec } from "../specUtils";
import { getCurrentMachineId } from "../state/machine";
import {
  Badge,
  Button,
  DemoLock,
  EmptyState,
  Input,
  TabBar,
} from "../ui";

interface Props {
  testId: number | "new";
}

export function TestDetailPage({ testId }: Props) {
  const [test, setTest] = useState<TestRecord | null>(null);
  const [spec, setSpec] = useState<TestSpec>(DEFAULT_SPEC);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [, setPresets] = useState<Preset[]>([]);
  const [materialId, setMaterialId] = useState<number | null>(null);
  const [name, setName] = useState("New test");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<ParamTestEditorTab>("test");

  useEffect(() => {
    (async () => {
      const [m, p] = await Promise.all([listMaterials(), listPresets()]);
      setMaterials(m);
      setPresets(p);
      if (testId !== "new") {
        const t = await getTest(testId);
        setTest(t);
        setSpec(t.spec);
        setName(t.name);
        setMaterialId(t.material_id);
      } else {
        const firstMid = m[0]?.id ?? null;
        setMaterialId(firstMid);
        const preset = firstMid
          ? p.find((q) => q.material_id === firstMid && q.is_default)
          : null;
        if (preset) setSpec((s) => ({ ...s, base_params: preset.base_params }));
      }
    })().catch((e) => setError((e as Error).message));
  }, [testId]);

  async function onSave() {
    if (materialId === null) {
      setError("Pick a material");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const normalized = normalizeSpec(spec);
      if (normalized !== spec) setSpec(normalized);
      if (test) {
        // Spec is frozen once a result has been uploaded, but name and
        // material can still change — the backend cascades a material
        // reassignment to any palette entries harvested from this test
        // so a wrong-substrate burn can be relabelled in place.
        const patch = test.locked
          ? { name, material_id: materialId }
          : { name, spec: normalized, material_id: materialId };
        const updated = await updateTest(test.id, patch);
        setTest(updated);
      } else {
        const created = await createTest({
          name,
          material_id: materialId,
          spec: normalized,
          machine_id: getCurrentMachineId(),
        });
        window.location.hash = formatRoute({ name: "test-detail", id: created.id });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!test) return;
    if (!confirm(`Delete test #${test.id}?`)) return;
    await deleteTest(test.id);
    window.location.hash = formatRoute({ name: "tests" });
  }

  async function onDuplicate() {
    if (materialId === null) return;
    const copy = await createTest({
      name: `${name} (copy)`,
      material_id: materialId,
      spec: normalizeSpec(spec),
      machine_id: getCurrentMachineId(),
    });
    window.location.hash = formatRoute({ name: "test-detail", id: copy.id });
  }

  async function onGenerate() {
    if (!test) return;
    setError(undefined);
    try {
      if (!test.locked) {
        const normalized = normalizeSpec(spec);
        if (normalized !== spec) setSpec(normalized);
        const updated = await updateTest(test.id, { name, spec: normalized });
        setTest(updated);
      }
      const blob = await generateTestXcs(test.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${test.name || `test-${test.id}`}.xcs`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onRetest() {
    if (!test) return;
    const next = (test.retest_index ?? 0) + 1;
    if (
      !confirm(
        `Bump this test's retest counter to #${next}?\n\nThe next Generate will stamp the new number into the QR so the burn uploaded from that XCS is labelled distinctly.`,
      )
    ) {
      return;
    }
    setError(undefined);
    try {
      const updated = await retestTest(test.id);
      setTest(updated);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="shrink-0 px-6 pt-4 pb-3 flex flex-wrap items-start gap-4 border-b border-[color:var(--color-border)]">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)] mb-1">
            <span>Test</span>
            {test && (
              <>
                <span className="font-mono text-[color:var(--color-ink-muted)]">
                  #{test.id}
                </span>
                <Badge
                  variant={
                    test.status === "tested"
                      ? "success"
                      : test.status === "deleted"
                        ? "destructive"
                        : "info"
                  }
                  size="sm"
                >
                  {test.status}
                </Badge>
                {test.locked && (
                  <Badge variant="neutral" size="sm">
                    <Lock className="h-3 w-3" />
                    locked
                  </Badge>
                )}
              </>
            )}
          </div>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-[20px] font-semibold h-auto px-2 py-1.5 bg-transparent border-transparent hover:border-[color:var(--color-border)] focus:bg-[color:var(--color-surface)] focus:border-[color:var(--color-primary)]"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <DemoLock label="Saving test edits is disabled in the demo.">
            <Button variant="secondary" onClick={onSave} disabled={saving}>
              <Save className="h-4 w-4" />
              {test ? "Save" : "Create"}
            </Button>
          </DemoLock>
          {test && (
            <DemoLock label="Generating .xcs is disabled in the demo.">
              <Button variant="primary" onClick={onGenerate}>
                <Download className="h-4 w-4" />
                Generate .xcs
                {(test.retest_index ?? 0) > 0 && (
                  <span className="ml-1 font-mono text-[10px] tabular-nums opacity-80">
                    · retest #{test.retest_index}
                  </span>
                )}
              </Button>
            </DemoLock>
          )}
          {test && (
            <DemoLock label="Retest is disabled in the demo.">
              <Button
                variant="ghost"
                onClick={onRetest}
                size="sm"
                title="Bump the retest counter and stamp it into the next Generate"
              >
                Retest
                {(test.retest_index ?? 0) > 0 && (
                  <span className="ml-1 font-mono text-[10px] tabular-nums opacity-70">
                    #{test.retest_index}
                  </span>
                )}
              </Button>
            </DemoLock>
          )}
          {test && (
            <DemoLock label="Duplicating tests is disabled in the demo.">
              <Button variant="ghost" onClick={onDuplicate} size="sm">
                <Copy className="h-3.5 w-3.5" />
                Duplicate
              </Button>
            </DemoLock>
          )}
          {test && (
            <DemoLock label="Deleting tests is disabled in the demo.">
              <Button
                variant="ghost"
                onClick={onDelete}
                size="sm"
                className="text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-tint)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </DemoLock>
          )}
        </div>
      </header>

      {error && (
        <div className="shrink-0 mx-6 mt-3 rounded-[6px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-3 py-2 text-[13px] text-[color:var(--color-destructive)]">
          {error}
        </div>
      )}

      {/* BODY: 2-column grid filling remaining viewport height */}
      <div className="flex-1 min-h-0 grid grid-cols-[58fr_42fr] gap-5 px-6 py-4">
        {/* LEFT: tabbed editor */}
        <div className="flex flex-col min-h-0 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] overflow-hidden">
          <TabBar<ParamTestEditorTab>
            items={[
              { id: "test", label: "Test" },
              { id: "sweep", label: "Sweep" },
              { id: "base", label: "Base params" },
              { id: "registration", label: "Registration" },
            ]}
            value={activeTab}
            onChange={setActiveTab}
          />
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ParamTestEditor
              spec={spec}
              onChange={setSpec}
              locked={test?.locked ?? false}
              tab={activeTab}
              materials={materials}
              materialId={materialId}
              onMaterialChange={setMaterialId}
            />
          </div>
        </div>

        {/* RIGHT: preview + scrollable results */}
        <div className="flex flex-col min-h-0 gap-3">
          <div className="shrink-0">
            <TestPreview spec={spec} testId={test?.id ?? null} compact />
          </div>
          <div className="flex-1 min-h-0 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] overflow-hidden">
            {test ? (
              <ResultsPanel testId={test.id} locked={test.locked} />
            ) : (
              <EmptyState
                className="h-full"
                title="Save first"
                description="Upload and ingest palette swatches after the test is saved."
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
