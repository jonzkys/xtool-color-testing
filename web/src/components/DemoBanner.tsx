import { Eye } from "lucide-react";
import { exitDemo } from "../api/userHeader";
import { cn } from "../ui";

/**
 * Sticky top-of-app banner shown while the user is in demo mode.
 * Mounted by ``App.tsx`` above ``<TopBar>`` when ``useIsDemo()``
 * returns true. The whole banner is click-to-exit; the trailing
 * button is redundant but matches the user-facing phrasing.
 *
 * Colour family: ``--color-warning-tint`` background with
 * ``--color-warning`` foreground — the "amber caution strip" cue
 * that's already used elsewhere for non-error alerts. A low-opacity
 * diagonal-stripe pattern gives it the "roped off" print-shop feel
 * without introducing a new design token.
 */
export function DemoBanner({ onExit }: { onExit: () => void }) {
  const handleExit = () => {
    exitDemo();
    onExit();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleExit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleExit();
        }
      }}
      className={cn(
        "sticky top-0 z-40 w-full h-10 px-4",
        "flex items-center justify-between gap-4",
        "bg-[color:var(--color-warning-tint)]",
        "text-[color:var(--color-warning)]",
        "border-b border-[color:var(--color-warning)]/30",
        "cursor-pointer select-none",
        "animate-[demo-banner-slide_160ms_ease-out]",
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12'><path d='M-1,1 l6,-6 M0,12 l12,-12 M11,13 l6,-6' stroke='%23C98A1E' stroke-width='0.8' opacity='0.25'/></svg>\")",
      }}
    >
      <style>{`
        @keyframes demo-banner-slide {
          from { transform: translateY(-100%); opacity: 0; }
          to   { transform: translateY(0);      opacity: 1; }
        }
      `}</style>
      <div className="flex items-center gap-2 text-[12.5px] font-medium">
        <Eye className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span>
          <strong className="font-semibold">Demo mode</strong>
          <span className="ml-1 opacity-85">
            — exploring a read-only showcase account. Every change is locked.
          </span>
        </span>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleExit();
        }}
        className={cn(
          "inline-flex items-center gap-1 h-7 px-2.5 rounded-[6px]",
          "text-[12px] font-semibold tracking-[0.02em]",
          "border border-[color:var(--color-warning)]/40",
          "bg-[color:var(--color-warning-tint)]/80",
          "hover:bg-[color:var(--color-warning)]/10",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-warning)]/50",
        )}
      >
        Exit demo →
      </button>
    </div>
  );
}
