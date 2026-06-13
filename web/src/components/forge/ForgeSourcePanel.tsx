// web/src/components/forge/ForgeSourcePanel.tsx
//
// The left-rail "source" cards shared by the Spiral and Forge pages: validation
// status, the cut-target picker, and the read-only preserved-layers list. Pure
// presentation over engine-derived data — no worker or config knowledge.
import { Badge, Card, CardHeader, CardTitle } from "../../ui";
import type { XcsObject } from "../../lib/forge/types";

export interface ForgeSourcePanelProps {
  validation: { errors: string[]; warnings: string[] };
  targetIds: string[];
  selectedIncise: string | null;
  onSelectIncise: (id: string) => void;
  preservedIds: string[];
  objects: XcsObject[];
}

export function ForgeSourcePanel({
  validation,
  targetIds,
  selectedIncise,
  onSelectIncise,
  preservedIds,
  objects,
}: ForgeSourcePanelProps) {
  return (
    <div className="min-h-0 overflow-y-auto pr-1 flex flex-col gap-3 text-xs">
      <Card>
        <CardHeader>
          <CardTitle>Validation</CardTitle>
        </CardHeader>
        <div className="p-2 flex flex-col gap-1">
          {validation.errors.length === 0 ? (
            <Badge variant="accent">ready</Badge>
          ) : (
            validation.errors.map((e, i) => (
              <Badge key={i} variant="destructive" className="block w-full whitespace-normal break-words rounded-md text-left py-1">
                {e}
              </Badge>
            ))
          )}
          {validation.warnings.map((w, i) => (
            <Badge key={`w${i}`} variant="warning" className="block w-full whitespace-normal break-words rounded-md text-left py-1">
              {w}
            </Badge>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Cut target</CardTitle>
        </CardHeader>
        <div className="p-2 font-mono flex flex-col gap-1">
          {targetIds.map((id) => {
            const o = objects.find((x) => x.id === id);
            return (
              <label key={id} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="incise"
                  checked={selectedIncise === id}
                  onChange={() => onSelectIncise(id)}
                />
                {id.slice(0, 8)} · {o?.processingType ?? "INTAGLIO"}
              </label>
            );
          })}
        </div>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Preserved layers</CardTitle>
        </CardHeader>
        <div className="p-2 font-mono flex flex-col gap-1 text-[var(--color-ink-muted)]">
          {preservedIds.length === 0 ? (
            <span>None — only the cut target is present.</span>
          ) : (
            <>
              {preservedIds.map((id) => {
                const o = objects.find((x) => x.id === id);
                return (
                  <div key={id}>
                    {id.slice(0, 8)} · {o?.processingType ?? "—"}
                  </div>
                );
              })}
              <span className="mt-1 text-[10px]">passed through untouched</span>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
