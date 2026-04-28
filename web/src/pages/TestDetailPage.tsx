import { useEffect, useRef, useState } from "react";
import {
  AlertCircle, Check, Copy, Download, Loader2, Lock, Save, Trash2,
} from "lucide-react";
import { useIsDemo } from "../hooks/useIsDemo";
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

type SaveStatus = "idle" | "saving" | "saved" | "error";

function formatAgo(date: Date, now: number): string {
  const seconds = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function SaveStatusPill({
  status, lastSavedAt, onRetry,
}: {
  status: SaveStatus;
  lastSavedAt: Date | null;
  onRetry: () => void;
}) {
  // Tick once a minute so "5m ago" → "6m ago" without a manual refresh.
  // Below 60s the displayed value is "just now"/"Ns ago" — for those
  // the next save event will replace it before the second matters.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--color-ink-subtle)] tabular-nums">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Saving…
      </span>
    );
  }
  if (status === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--color-destructive)] hover:underline"
        title="Retry save"
      >
        <AlertCircle className="h-3.5 w-3.5" />
        Save failed — retry
      </button>
    );
  }
  // status === "idle" | "saved" — render the last-saved timestamp
  // when we have one, otherwise nothing to say.
  if (!lastSavedAt) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--color-ink-subtle)] tabular-nums">
      <Check className="h-3.5 w-3.5" />
      Saved · {formatAgo(lastSavedAt, now)}
    </span>
  );
}

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
  const [creating, setCreating] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [activeTab, setActiveTab] = useState<ParamTestEditorTab>("test");
  // True once the user has changed name / spec / material at least
  // once via the editor. Autosave is gated on this so the load
  // effect's re-renders never trigger a PATCH-back of the loaded
  // values.
  const userInteractedRef = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const inFlightSaveRef = useRef<Promise<void> | null>(null);
  const isDemo = useIsDemo();
  // Timestamp of the last successful persistence — pre-filled from
  // test.updated_at on load so the pill can show "Saved · 3m ago"
  // even before the user makes their first edit.
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    (async () => {
      const [m, p] = await Promise.all([listMaterials(), listPresets()]);
      setMaterials(m);
      setPresets(p);
      if (testId !== "new") {
        const t = await getTest(testId);
        userInteractedRef.current = false;
        setLastSavedAt(t.updated_at ? new Date(t.updated_at) : null);
        setTest(t);
        setSpec(t.spec);
        setName(t.name);
        setMaterialId(t.material_id);
      } else {
        // Prefer the user's default material; fall back to the first
        // when none has been promoted yet.
        const startMat = m.find((mm) => mm.is_default) ?? m[0] ?? null;
        const firstMid = startMat?.id ?? null;
        setMaterialId(firstMid);
        const preset = firstMid
          ? p.find((q) => q.material_id === firstMid && q.is_default)
          : null;
        if (preset) setSpec((s) => ({ ...s, base_params: preset.base_params }));
      }
    })().catch((e) => setError((e as Error).message));
  }, [testId]);

  // Persist the current state to an existing test. No-ops when there's
  // no test yet (the Create button handles initial creation explicitly
  // since it also navigates to the new URL). Sequences saves so that a
  // PATCH in flight can't be overtaken by a newer one on a later
  // keystroke — we simply queue and run once the current promise
  // settles.
  async function persistChanges(): Promise<void> {
    if (!test || materialId === null || isDemo) return;
    setSaveStatus("saving");
    setError(undefined);
    try {
      const normalized = normalizeSpec(spec);
      if (normalized !== spec) setSpec(normalized);
      // Spec is frozen once a result has been uploaded, but name and
      // material can still change — the backend cascades a material
      // reassignment to any palette entries harvested from this test
      // so a wrong-substrate burn can be relabelled in place.
      const patch = test.locked
        ? { name, material_id: materialId }
        : { name, spec: normalized, material_id: materialId };
      const updated = await updateTest(test.id, patch);
      setTest(updated);
      setLastSavedAt(new Date());
      setSaveStatus("saved");
    } catch (e) {
      setError((e as Error).message);
      setSaveStatus("error");
    }
  }

  // Debounced autosave for existing tests. Locked off until the user
  // has touched the form once — the load effect can re-render
  // multiple times before all loaded values settle, and we don't want
  // to PATCH the loaded values back to the server during that window.
  useEffect(() => {
    if (!test || materialId === null || isDemo) return;
    if (!userInteractedRef.current) return;
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      inFlightSaveRef.current = persistChanges();
    }, 800);
    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [name, spec, materialId, test?.id, test?.locked, isDemo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wrapped setters that flag user interaction. The autosave effect
  // skips its scheduling unless the flag is set, so loaded values
  // never get PATCHed back unchanged.
  function handleSpecChange(next: TestSpec) {
    userInteractedRef.current = true;
    setSpec(next);
  }
  function handleNameChange(next: string) {
    userInteractedRef.current = true;
    setName(next);
  }
  function handleMaterialChange(id: number) {
    userInteractedRef.current = true;
    setMaterialId(id);
  }

  // Flush any pending debounced save and wait for any in-flight one.
  // Used by Generate before downloading the .xcs so the file always
  // reflects the visible spec.
  async function flushAutoSave(): Promise<void> {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
      inFlightSaveRef.current = persistChanges();
    }
    if (inFlightSaveRef.current) await inFlightSaveRef.current;
  }

  async function onCreate() {
    if (materialId === null) {
      setError("Pick a material");
      return;
    }
    setCreating(true);
    setError(undefined);
    try {
      const normalized = normalizeSpec(spec);
      if (normalized !== spec) setSpec(normalized);
      const created = await createTest({
        name,
        material_id: materialId,
        spec: normalized,
        machine_id: getCurrentMachineId(),
      });
      window.location.hash = formatRoute({ name: "test-detail", id: created.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
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
      // Flush any debounced autosave so the .xcs reflects the visible
      // spec, not the last persisted one.
      await flushAutoSave();
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
      <header className="shrink-0 border-b border-[color:var(--color-border)]">
        <div className="mx-auto max-w-[1500px] w-full px-6 pt-4 pb-3 flex flex-wrap items-start gap-4">
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
            onChange={(e) => handleNameChange(e.target.value)}
            className="text-[20px] font-semibold h-auto px-2 py-1.5 max-w-[420px] bg-transparent border-transparent hover:border-[color:var(--color-border)] focus:bg-[color:var(--color-surface)] focus:border-[color:var(--color-primary)]"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {test ? (
            <span className="mr-2">
              <SaveStatusPill
                status={saveStatus}
                lastSavedAt={lastSavedAt}
                onRetry={persistChanges}
              />
            </span>
          ) : (
            <DemoLock label="Saving test edits is disabled in the demo.">
              <Button variant="secondary" onClick={onCreate} disabled={creating}>
                <Save className="h-4 w-4" />
                Create
              </Button>
            </DemoLock>
          )}
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
        </div>
      </header>

      {error && (
        <div className="shrink-0 mx-auto max-w-[1500px] w-full px-6 mt-3">
          <div className="rounded-[6px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-3 py-2 text-[13px] text-[color:var(--color-destructive)]">
            {error}
          </div>
        </div>
      )}

      {/* BODY: 2-column grid filling remaining viewport height, centered with breathing room on wide screens */}
      <div className="flex-1 min-h-0 mx-auto max-w-[1500px] w-full grid grid-cols-[58fr_42fr] gap-5 px-6 py-4">
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
              onChange={handleSpecChange}
              locked={test?.locked ?? false}
              tab={activeTab}
              materials={materials}
              materialId={materialId}
              onMaterialChange={handleMaterialChange}
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
