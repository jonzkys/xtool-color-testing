import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface OverlayItem {
  readonly key: "colourField" | "contours" | "fadeDots";
  readonly label: string;
  readonly checked: boolean;
  readonly onToggle: () => void;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}

interface Props {
  items: readonly OverlayItem[];
}

function placePopover(
  anchor: HTMLElement,
  size: { width: number; height: number },
): { left: number; top: number } {
  const a = anchor.getBoundingClientRect();
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = a.right - size.width;       // right-align to the button
  if (left + size.width + margin > vw) left = vw - size.width - margin;
  if (left < margin) left = margin;
  let top = a.bottom + 6;
  if (top + size.height + margin > vh) top = a.top - size.height - 6;
  if (top < margin) top = margin;
  return { left, top };
}

export function ExposureOverlaysMenu({ items }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return;
      if (btnRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const activeCount = items.filter((i) => i.checked && !i.disabled).length;
  const accented = activeCount > 0 || open;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          "shrink-0 whitespace-nowrap px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border transition-colors " +
          (accented
            ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-[color:var(--color-surface-elevated)]"
            : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)]")
        }
      >
        ▦ OVERLAYS{activeCount > 0 ? ` · ${activeCount}` : ""} ▾
      </button>
      {open && btnRef.current && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          role="menu"
          className="fixed z-[1000] rounded-[6px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] shadow-lg py-1"
          style={{ ...placePopover(btnRef.current, { width: 210, height: 130 }), width: 210 }}
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitemcheckbox"
              aria-checked={it.checked}
              disabled={it.disabled}
              onClick={() => {
                if (it.disabled) return;
                it.onToggle();
              }}
              title={it.disabled ? it.disabledReason : undefined}
              className={
                "flex w-full items-center gap-2 px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] " +
                (it.disabled
                  ? "text-[color:var(--color-ink-subtle)] opacity-50 cursor-not-allowed"
                  : "text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface)]")
              }
            >
              <span
                aria-hidden
                className={
                  "inline-block w-3 h-3 flex-none rounded-sm border " +
                  (it.checked && !it.disabled
                    ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)]"
                    : "border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)]")
                }
              >
                {it.checked && !it.disabled && (
                  <svg viewBox="0 0 10 10" className="w-3 h-3">
                    <path d="M2 5.5l2 2 4-4.5" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="flex-1 text-left">{it.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
