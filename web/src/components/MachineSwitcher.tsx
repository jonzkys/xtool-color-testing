import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";
import { useCurrentMachine } from "../state/machine";
import { cn } from "../ui";
import type { Machine } from "../types";

/**
 * TopBar control for switching the active xTool laser machine.
 *
 * Closed state: compact button showing the machine thumbnail + display_name,
 * styled to match the Guide / Upload button family in TopBar.
 *
 * Open state: a Radix Popover with one card per machine in the registry.
 * Each card shows the product photo, display name, laser specs (mono), and
 * supported-mode pills.  Clicking a card persists the choice and reloads.
 */
export function MachineSwitcher() {
  const { registry, machine, setMachineId } = useCurrentMachine();
  const [open, setOpen] = useState(false);

  // While the registry is still fetching, render nothing rather than a
  // skeleton — the TopBar layout shifts by only one item, which is less
  // jarring than a flickering placeholder.
  if (!registry || !machine) return null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Active machine: ${machine.display_name}. Click to switch.`}
          className={cn(
            "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[6px]",
            "border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]",
            open
              ? "text-[color:var(--color-primary)] border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary-tint)]/40"
              : "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-primary)] hover:border-[color:var(--color-primary)]/50 hover:bg-[color:var(--color-primary-tint)]/40",
            "transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
          )}
        >
          {/* Thumbnail */}
          <img
            src={machine.image}
            alt=""
            aria-hidden="true"
            className="h-[18px] w-[18px] rounded-[3px] object-contain shrink-0"
          />
          {/* Display name */}
          <span className="font-mono text-[10.5px] tracking-[0.12em] uppercase font-semibold max-w-[12ch] truncate">
            {machine.display_name}
          </span>
          <ChevronDown
            className={cn(
              "h-3 w-3 shrink-0 transition-transform duration-150",
              open && "rotate-180",
            )}
            strokeWidth={2}
          />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className={cn(
            "z-50 w-[340px] rounded-[12px] overflow-hidden",
            "border border-[color:var(--color-border)] bg-[color:var(--color-surface)]",
            "shadow-[var(--shadow-popover)]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-top-1",
            "focus:outline-none",
          )}
        >
          {/* Header label */}
          <div className="px-3.5 pt-3 pb-2.5 bg-[color:var(--color-surface-elevated)] border-b border-[color:var(--color-border)]">
            <span className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
              Machine
            </span>
          </div>

          {/* Machine cards */}
          <div className="p-2 flex flex-col gap-1.5">
            {registry.machines.map((m) => (
              <MachineCard
                key={m.id}
                machine={m}
                active={m.id === machine.id}
                onSelect={() => {
                  setOpen(false);
                  if (m.id !== machine.id) setMachineId(m.id);
                }}
              />
            ))}
          </div>

          {/* Footer hint */}
          <div className="px-3.5 py-2 bg-[color:var(--color-surface-elevated)] border-t border-[color:var(--color-border)]">
            <span className="font-mono text-[9.5px] tracking-[0.06em] text-[color:var(--color-ink-subtle)]">
              Switching reloads the workbench to scope data to the new machine.
            </span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Machine card ─────────────────────────────────────────────────────────────

function MachineCard({
  machine,
  active,
  onSelect,
}: {
  machine: Machine;
  active: boolean;
  onSelect: () => void;
}) {
  const laserSpec = machine.lasers
    .map((l) => `${l.kind} ${l.wattage}W`)
    .join(" · ");

  const modeLabels = machine.modes.map((m) => m.id.replace(/_/g, " "));

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full flex items-start gap-3 px-3 py-2.5 rounded-[8px] text-left",
        "border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
        active
          ? "border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary-tint)]/40 text-[color:var(--color-ink)]"
          : "border-transparent bg-transparent hover:bg-[color:var(--color-primary-tint)]/20 hover:border-[color:var(--color-primary)]/20 text-[color:var(--color-ink)]",
      )}
    >
      {/* Product photo */}
      <img
        src={machine.image}
        alt={machine.display_name}
        className="h-[64px] w-[64px] rounded-[6px] object-contain shrink-0 bg-[color:var(--color-surface-elevated)] border border-[color:var(--color-border)]"
      />

      {/* Text block */}
      <div className="flex-1 min-w-0 pt-0.5">
        {/* Display name */}
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium leading-snug text-[color:var(--color-ink)]">
            {machine.display_name}
          </span>
          {active && (
            <span className="inline-flex items-center h-[16px] px-1.5 rounded-[3px] font-mono text-[8.5px] tracking-[0.12em] uppercase font-semibold bg-[color:var(--color-primary)] text-white">
              active
            </span>
          )}
        </div>

        {/* Laser specs */}
        {laserSpec && (
          <div className="mt-1 font-mono text-[11px] tracking-[0.04em] text-[color:var(--color-ink-muted)]">
            {laserSpec}
          </div>
        )}

        {/* Supported modes */}
        {modeLabels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {modeLabels.map((label) => (
              <span
                key={label}
                className={cn(
                  "inline-flex items-center h-[18px] px-1.5 rounded-[3px]",
                  "font-mono text-[9px] tracking-[0.08em] uppercase",
                  "border",
                  active
                    ? "border-[color:var(--color-primary)]/30 bg-[color:var(--color-primary-tint)]/50 text-[color:var(--color-primary)]"
                    : "border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] text-[color:var(--color-ink-muted)]",
                )}
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
