import { useEffect, useMemo, useState } from "react";
import { TopBar } from "./components/TopBar";
import { TestList } from "./components/TestList";
import { TestEditor } from "./components/TestEditor";
import { Preview } from "./components/Preview";
import { WarningBanner } from "./components/fields/WarningBanner";
import { SvgStackPage } from "./components/SvgStackPage";
import { SvgLayersPage } from "./components/SvgLayersPage";
import { LibraryPage } from "./components/LibraryPage";
import { defaultProject, defaultPlacement, newId } from "./defaults";
import { loadProject, saveProject, loadLibrary, saveLibrary } from "./storage";
import { bootstrapLibrary, type LibraryState } from "./library";
import { generateAndDownload } from "./generate";
import { hasErrors, validateProject } from "./validation";
import type { Project, TestPlacement } from "./types";

type Tab = "tests" | "svg" | "layers" | "library";

export default function App() {
  const [tab, setTab] = useState<Tab>("tests");
  const [project, setProject] = useState<Project>(() => loadProject() ?? defaultProject());
  const [selectedId, setSelectedId] = useState<string | null>(
    project.tests[0]?.test.id ?? null,
  );
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | undefined>();
  const [library, setLibrary] = useState<LibraryState>(() => loadLibrary() ?? bootstrapLibrary());

  // Persist on every change
  useEffect(() => {
    saveProject(project);
  }, [project]);

  useEffect(() => {
    saveLibrary(library);
  }, [library]);

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

    // Inherit material_id from the most recent test (or library active material).
    const lastTest = project.tests[project.tests.length - 1]?.test;
    const inheritedMaterialId = lastTest?.material_id ?? library.active_material_id;
    if (inheritedMaterialId) {
      placement.test.material_id = inheritedMaterialId;
      const defaultPreset = library.presets.find(
        (p) => p.material_id === inheritedMaterialId && p.is_default,
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

  const disableGenerate = project.tests.length === 0 || hasErrors(issues);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopBar
        title={
          tab === "tests" ? project.name
          : tab === "svg" ? "SVG stack"
          : tab === "layers" ? "SVG layers"
          : "Library"
        }
        generateDisabled={disableGenerate}
        generating={generating}
        onGenerate={handleGenerate}
        errorMessage={genError}
        showGenerate={tab === "tests"}
        tab={tab}
        onTabChange={setTab}
      />
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
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <LibraryPage library={library} onChange={setLibrary} />
        </div>
      )}
    </div>
  );
}
