import { useEffect, useMemo, useState } from "react";
import { TopBar } from "./components/TopBar";
import { TestList } from "./components/TestList";
import { TestEditor } from "./components/TestEditor";
import { Preview } from "./components/Preview";
import { WarningBanner } from "./components/fields/WarningBanner";
import { SvgStackPage } from "./components/SvgStackPage";
import { SvgLayersPage } from "./components/SvgLayersPage";
import { LibraryPage } from "./components/LibraryPage";
import { PalettePage } from "./components/PalettePage";
import { defaultProject, defaultPlacement, newId } from "./defaults";
import { loadProject, saveProject } from "./storage";
import { generateAndDownload } from "./generate";
import { hasErrors, validateProject } from "./validation";
import type { Project, TestPlacement } from "./types";
import type { LibraryState, Material, Preset } from "./library";
import { listMaterials, listPresets } from "./api/library";

type Tab = "tests" | "svg" | "layers" | "library" | "palette";

export default function App() {
  const [tab, setTab] = useState<Tab>("tests");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [project, setProject] = useState<Project>(() => loadProject() ?? defaultProject());
  const [selectedId, setSelectedId] = useState<string | null>(
    project.tests[0]?.test.id ?? null,
  );
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | undefined>();
  const [libraryError, setLibraryError] = useState<string | undefined>();

  // Fetch library on mount (and after library page mutations via onMaterialsChange)
  useEffect(() => {
    void refreshLibrary();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshLibrary() {
    try {
      const [mats, pres] = await Promise.all([listMaterials(), listPresets()]);
      setMaterials(mats);
      setPresets(pres);
      setLibraryError(undefined);
    } catch (e) {
      console.error("Failed to load library:", e);
      setLibraryError((e as Error).message);
    }
  }

  // Compose a LibraryState shape for downstream components that still expect it.
  // active_material_id: use the first material as a reasonable default.
  const library: LibraryState = useMemo(
    () => ({
      materials,
      presets,
      active_material_id: materials[0]?.id ?? null,
    }),
    [materials, presets],
  );

  // Persist project on every change
  useEffect(() => {
    saveProject(project);
  }, [project]);

  const issues = useMemo(() => validateProject(project), [project]);

  const selected = project.tests.find((p) => p.test.id === selectedId) ?? null;

  function updateProject(patch: Partial<Project>) {
    setProject((prev) => ({ ...prev, ...patch }));
  }

  function updatePlacement(next: TestPlacement) {
    setProject((prev) => ({
      ...prev,
      tests: prev.tests.map((p) => (p.test.id === next.test.id ? next : p)),
    }));
  }

  function addTest() {
    const usedRows = new Set(project.tests.map((p) => p.row));
    let row = 0;
    while (usedRows.has(row)) row += 1;
    const placement = defaultPlacement(row, 0);

    // Inherit material_id from the most recent test (or first material as string).
    const lastTest = project.tests[project.tests.length - 1]?.test;
    const inheritedMaterialId =
      (lastTest?.material_id && lastTest.material_id !== ""
        ? lastTest.material_id
        : (materials[0] ? String(materials[0].id) : "")) || "";
    placement.test.material_id = inheritedMaterialId;
    if (inheritedMaterialId && materials.length > 0) {
      const matId = Number(inheritedMaterialId);
      const defaultPreset = presets.find(
        (p) => p.material_id === matId && p.is_default,
      );
      if (defaultPreset) {
        placement.test.base_params = { ...defaultPreset.base_params };
      }
    }

    setProject((prev) => ({ ...prev, tests: [...prev.tests, placement] }));
    setSelectedId(placement.test.id);
  }

  function deleteSelected() {
    if (!selected) return;
    setProject((prev) => ({
      ...prev,
      tests: prev.tests.filter((p) => p.test.id !== selected.test.id),
    }));
    setSelectedId(project.tests.find((p) => p.test.id !== selected.test.id)?.test.id ?? null);
  }

  function duplicateSelected() {
    if (!selected) return;
    // Place the copy on the next free row (at col 0) so it doesn't overlap.
    const usedRows = new Set(project.tests.map((p) => p.row));
    let row = 0;
    while (usedRows.has(row)) row += 1;
    const copy: TestPlacement = {
      ...selected,
      row,
      col: 0,
      col_span: 1,
      test: {
        ...selected.test,
        id: newId(),
        name: `${selected.test.name} (copy)`,
        // Deep-copy base_params so edits don't affect the original
        base_params: { ...selected.test.base_params },
      },
    };
    setProject((prev) => ({ ...prev, tests: [...prev.tests, copy] }));
    setSelectedId(copy.test.id);
  }

  async function handleGenerate() {
    setGenError(undefined);
    setGenerating(true);
    try {
      await generateAndDownload(project);
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  // Block generate if any test is missing a material (required for palette scoping).
  const anyTestMissingMaterial = project.tests.some((p) => !p.test.material_id);
  const disableGenerate =
    project.tests.length === 0 || hasErrors(issues) || anyTestMissingMaterial;
  const topBarError = anyTestMissingMaterial
    ? "Pick a material on every test"
    : genError;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopBar
        title={
          tab === "tests" ? project.name
          : tab === "svg" ? "SVG stack"
          : tab === "layers" ? "SVG layers"
          : tab === "library" ? "Library"
          : "Palette"
        }
        generateDisabled={disableGenerate}
        generating={generating}
        onGenerate={handleGenerate}
        errorMessage={topBarError}
        showGenerate={tab === "tests"}
        tab={tab}
        onTabChange={setTab}
      />
      {libraryError && (
        <div style={{ padding: "6px 12px", background: "#fee", color: "#a02840", fontSize: 12, borderBottom: "1px solid #f5b8c4" }}>
          Library unavailable: {libraryError}
        </div>
      )}
      {tab === "tests" ? (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "260px 1fr minmax(0, 33vw)", minHeight: 0 }}>
          <div style={{ borderRight: "1px solid #ddd", background: "white", overflow: "auto" }}>
            <TestList
              project={project}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onAdd={addTest}
              onProjectChange={updateProject}
            />
          </div>
          <div style={{ borderRight: "1px solid #ddd", background: "white", overflow: "auto" }}>
            {selected ? (
              <>
                {issues.length > 0 && (
                  <div style={{ padding: "12px 16px 0" }}>
                    <WarningBanner issues={issues.filter((i) => i.field.includes(`tests[${project.tests.indexOf(selected)}]`))} />
                  </div>
                )}
                <TestEditor
                  placement={selected}
                  issues={issues}
                  library={library}
                  onChange={updatePlacement}
                  onDelete={deleteSelected}
                  onDuplicate={duplicateSelected}
                />
              </>
            ) : (
              <div style={{ padding: 32, color: "#999" }}>No test selected. Add one from the left.</div>
            )}
          </div>
          <div style={{ background: "white", overflow: "auto" }}>
            <Preview project={project} issues={issues} />
          </div>
        </div>
      ) : tab === "svg" ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <SvgStackPage library={library} />
        </div>
      ) : tab === "layers" ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <SvgLayersPage library={library} />
        </div>
      ) : tab === "library" ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <LibraryPage onMaterialsChange={() => void refreshLibrary()} />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <PalettePage library={library} />
        </div>
      )}
    </div>
  );
}
