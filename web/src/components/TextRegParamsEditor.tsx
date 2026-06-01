import { type ReactNode } from "react";
import { cn } from "../ui";
import { DynamicParamForm } from "./dynamic-form/DynamicParamForm";
import { toProfile, fromProfile } from "../lib/textRegVocab";
import type { TextRegParamsBody, TextRegSource, ValidationProfile } from "../types";

/**
 * Editor for the seven-field "engraved annotation params". A thin adapter:
 * renames TextReg fields to the profile vocabulary, renders the shared
 * DynamicParamForm (constrained widgets), and renames back on change. The
 * active machine's profile is resolved by the parent and passed in (each
 * Library card constrains by its own machine, not the globally-selected one).
 */
export interface TextRegParamsEditorProps {
  value: TextRegParamsBody;
  onChange: (next: TextRegParamsBody) => void;
  disabled?: boolean;
  profile: ValidationProfile | null;
}

export function TextRegParamsEditor({
  value,
  onChange,
  disabled,
  profile,
}: TextRegParamsEditorProps) {
  if (!profile) {
    return (
      <p className="font-mono text-[11px] tracking-[0.04em] text-[color:var(--color-ink-subtle)]">
        Loading constraints…
      </p>
    );
  }
  return (
    <DynamicParamForm
      profile={profile}
      value={toProfile(value)}
      onChange={(next) => onChange(fromProfile(next))}
      disabled={disabled}
    />
  );
}

// ── Source pill ──────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<TextRegSource, string> = {
  material: "From material default",
  machine: "From machine default",
  fallback: "Built-in fallback",
};

/** Small uppercase mono pill describing which layer the resolved
 *  params came from. Primary tint when the override is at the most
 *  specific level (material), softer for machine, muted for fallback. */
export function TextRegSourcePill({
  source,
  className,
  override,
}: {
  source: TextRegSource;
  className?: string;
  /** Optional label override (e.g. "Material default" on the Library
   *  cards where the surrounding context already says material/machine). */
  override?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center h-[18px] px-2 rounded-[4px]",
        "border font-mono text-[9.5px] tracking-[0.14em] uppercase font-semibold",
        source === "material"
          ? "border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary-tint)]/60 text-[color:var(--color-primary)]"
          : source === "machine"
            ? "border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] text-[color:var(--color-ink-muted)]"
            : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-ink-subtle)]",
        className,
      )}
    >
      {override ?? SOURCE_LABELS[source]}
    </span>
  );
}
