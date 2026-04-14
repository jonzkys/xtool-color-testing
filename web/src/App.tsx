import { useEffect, useMemo, useState } from "react";
import { TopBar } from "./components/TopBar";
import { TestList } from "./components/TestList";
import { TestEditor } from "./components/TestEditor";
import { Preview } from "./components/Preview";
import { WarningBanner } from "./components/fields/WarningBanner";
import { defaultProject, defaultPlacement } from "./defaults";
import { loadProject, saveProject } from "./storage";
import { generateAndDownload } from "./generate";
import { hasErrors, validateProject } from "./validation";
import type { Project, TestPlacement } from "./types";

export default function App() {
  const [project, setProject] = useState<Project>(() => loadProject() ?? defaultProject());
  const [selectedId, setSelectedId] = useState<string | null>(
    project.tests[0]?.test.id ?? null,
  );
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | undefined>();

  // Persist on every change
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
    // Pick next free row at col 0
    const usedRows = new Set(project.tests.map((p) => p.row));
    let row = 0;
    while (usedRows.has(row)) row += 1;
    const placement = defaultPlacement(row, 0);
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
        title={project.name}
        generateDisabled={disableGenerate}
        generating={generating}
        onGenerate={handleGenerate}
        errorMessage={genError}
      />
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "260px 1fr 1fr", minHeight: 0 }}>
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
                onChange={updatePlacement}
                onDelete={deleteSelected}
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
    </div>
  );
}
