import { useEffect, useState } from "react";
import { Beaker, Lock, Plus } from "lucide-react";
import type { Material, Preset } from "../library";
import type { TestRecord } from "../types";
import { listTests, createTest } from "../api/tests";
import { listMaterials, listPresets } from "../api/library";
import { formatRoute } from "../router";
import { DEFAULT_SPEC } from "../defaults";
import { normalizeSpec } from "../specUtils";
import {
  Badge,
  Button,
  cn,
  EmptyState,
  Field,
  PageContainer,
  Section,
  Select,
} from "../ui";

const STATUS_VARIANTS: Record<string, "neutral" | "info" | "success" | "warning" | "destructive" | "accent"> = {
  created: "info",
  tested: "success",
  deleted: "destructive",
};

export function TestsPage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [tests, setTests] = useState<TestRecord[]>([]);
  const [materialId, setMaterialId] = useState<number | undefined>();
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>();

  async function refresh() {
    try {
      const [m, p, t] = await Promise.all([
        listMaterials(),
        listPresets(),
        listTests({ material_id: materialId, status: status || undefined }),
      ]);
      setMaterials(m);
      setPresets(p);
      setTests(t);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    refresh();
  }, [materialId, status]); // eslint-disable-line

  async function onNew() {
    if (materials.length === 0) {
      setError("Create a material on the Library tab first.");
      return;
    }
    const mid = materialId ?? materials[0].id;
    const preset = presets.find((p) => p.material_id === mid && p.is_default);
    const spec = normalizeSpec({
      ...DEFAULT_SPEC,
      base_params: preset?.base_params ?? DEFAULT_SPEC.base_params,
    });
    const t = await createTest({ name: "New test", material_id: mid, spec });
    window.location.hash = formatRoute({ name: "test-detail", id: t.id });
  }

  return (
    <PageContainer className="py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)] mb-1">
            Tests
          </div>
          <h1 className="text-[22px] font-semibold text-[color:var(--color-ink)]">
            Parameter tests
          </h1>
          <p className="mt-1 text-[13px] text-[color:var(--color-ink-muted)] max-w-[68ch]">
            Each test is a parameter sweep for one substrate. Create one,
            burn it, then upload the photo to ingest colour swatches into
            the palette.
          </p>
        </div>
        <Button variant="primary" onClick={onNew}>
          <Plus className="h-4 w-4" />
          New test
        </Button>
      </header>

      <div className="grid grid-cols-[260px_1fr] gap-6">
        <div>
          <Section title="Filters" dense>
            <Field label="Material">
              <Select
                value={materialId ?? ""}
                onChange={(e) =>
                  setMaterialId(e.target.value ? Number(e.target.value) : undefined)
                }
              >
                <option value="">— all —</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">not deleted</option>
                <option value="created">created</option>
                <option value="tested">tested</option>
                <option value="deleted">deleted</option>
              </Select>
            </Field>
          </Section>
        </div>

        <div>
          <Section title={`${tests.length} test${tests.length === 1 ? "" : "s"}`} dense>
            {error && (
              <div className="rounded-[6px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-3 py-2 text-[13px] text-[color:var(--color-destructive)]">
                {error}
              </div>
            )}
            {tests.length === 0 && !error && (
              <EmptyState
                icon={<Beaker className="h-6 w-6" />}
                title="No tests match"
                description={
                  materialId || status
                    ? "Try a wider filter, or create a new test."
                    : "Create a test to start burning parameter sweeps on a substrate."
                }
                action={
                  <Button variant="primary" onClick={onNew}>
                    <Plus className="h-4 w-4" />
                    New test
                  </Button>
                }
              />
            )}
            {tests.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {tests.map((t) => {
                  const materialName =
                    materials.find((m) => m.id === t.material_id)?.name ?? "?";
                  const statusVariant = STATUS_VARIANTS[t.status] ?? "neutral";
                  return (
                    <a
                      key={t.id}
                      href={formatRoute({ name: "test-detail", id: t.id })}
                      className={cn(
                        "block rounded-[10px] border bg-[color:var(--color-surface)]",
                        "border-[color:var(--color-border)] hover:border-[color:var(--color-primary)]/60",
                        "shadow-[var(--shadow-card)] hover:shadow-[0_2px_6px_rgba(20,10,0,0.06)]",
                        "px-3.5 py-3 transition-all no-underline",
                      )}
                    >
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
                          #{t.id}
                        </span>
                        <span className="text-[14px] font-semibold text-[color:var(--color-ink)] truncate">
                          {t.name}
                        </span>
                        {t.locked && (
                          <Lock
                            className="h-3 w-3 text-[color:var(--color-ink-subtle)]"
                            aria-label="Locked"
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={statusVariant} size="sm">
                          {t.status}
                        </Badge>
                        <span className="text-[11.5px] text-[color:var(--color-ink-muted)]">
                          {materialName}
                        </span>
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </Section>
        </div>
      </div>
    </PageContainer>
  );
}
