import { PageContainer, Section } from "../ui";

export function GcodeViewerPage() {
  return (
    <PageContainer maxWidth="wide">
      <Section title="Gcode Viewer" dense>
        <p className="text-[12px] text-[color:var(--color-ink-muted)] font-mono">
          Drop a Studio-exported <code>.gc</code> file to inspect its layers.
          (Wired in Tasks 9 and 10.)
        </p>
      </Section>
    </PageContainer>
  );
}
