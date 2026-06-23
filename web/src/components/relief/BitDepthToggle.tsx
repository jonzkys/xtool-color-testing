/** Segmented 8|16-bit selector for the relief export. Affects export only —
 *  16-bit gives smoother depth gradation (~2× file size); 8-bit is maximally
 *  compatible. */
export function BitDepthToggle({
  value,
  onChange,
}: {
  value: 8 | 16;
  onChange: (v: 8 | 16) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Export bit depth"
      title="16-bit = smoother depth gradation, ~2× file size; 8-bit = maximum compatibility"
      className="inline-flex items-center rounded-[6px] border border-[color:var(--color-border-strong)] overflow-hidden font-mono text-[11px]"
    >
      <span className="px-2 py-1 text-[color:var(--color-ink-subtle)] uppercase tracking-[0.08em]">
        Bit depth
      </span>
      {([8, 16] as const).map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={value === d}
          aria-label={`${d}-bit`}
          onClick={() => onChange(d)}
          className={[
            "px-2.5 py-1 transition-colors",
            value === d
              ? "bg-[color:var(--color-primary)] text-white"
              : "bg-[color:var(--color-surface)] text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-elevated)]",
          ].join(" ")}
        >
          {d}
        </button>
      ))}
    </div>
  );
}
