import * as TabsPrimitive from "@radix-ui/react-tabs";
import { forwardRef, type ComponentProps } from "react";
import { cn } from "./cn";

export const Tabs = TabsPrimitive.Root;

export const TabList = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex items-center gap-0 border-b border-[color:var(--color-border)]",
      className,
    )}
    {...props}
  />
));
TabList.displayName = "TabList";

export const Tab = forwardRef<
  HTMLButtonElement,
  ComponentProps<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative inline-flex items-center gap-1.5 px-3 py-2",
      "text-[12.5px] font-medium text-[color:var(--color-ink-muted)]",
      "hover:text-[color:var(--color-ink)]",
      "transition-colors",
      "focus-visible:outline-none",
      // Active: ember underline that overlaps the border-bottom of TabList
      "data-[state=active]:text-[color:var(--color-primary)]",
      "data-[state=active]:after:absolute data-[state=active]:after:left-0 data-[state=active]:after:right-0",
      "data-[state=active]:after:-bottom-px data-[state=active]:after:h-[2px]",
      "data-[state=active]:after:bg-[color:var(--color-primary)]",
      className,
    )}
    {...props}
  />
));
Tab.displayName = "Tab";

export const TabPanel = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "pt-4 focus-visible:outline-none",
      className,
    )}
    {...props}
  />
));
TabPanel.displayName = "TabPanel";

// ---------------------------------------------------------------------------
// Headless controlled Tabs primitive
// ---------------------------------------------------------------------------

export interface TabItem<Id extends string = string> {
  id: Id;
  label: string;
}

export interface TabBarProps<Id extends string = string> {
  items: TabItem<Id>[];
  value: Id;
  onChange: (id: Id) => void;
  /** Optional extra className for the outer bar container. */
  className?: string;
}

/**
 * TabBar — headless controlled tab bar. Renders the tab strip only; the
 * active tab's content is rendered by the parent (this component does NOT
 * own the panel content).
 *
 * Workshop-instrument register: JetBrains Mono uppercase tracking,
 * primary-colour underline on the active tab. Visual treatment is
 * intentionally minimal here so the frontend-design pass can refine
 * later.
 */
export function TabBar<Id extends string = string>({ items, value, onChange, className }: TabBarProps<Id>) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex items-stretch border-b border-[color:var(--color-border)]",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cn(
              "relative px-4 py-2.5",
              "font-mono text-[10.5px] tracking-[0.18em] uppercase font-semibold",
              "transition-colors duration-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/50 focus-visible:ring-inset",
              active
                ? "text-[color:var(--color-primary)]"
                : "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]",
            )}
          >
            {item.label}
            {active && (
              <span
                aria-hidden
                className="absolute left-3 right-3 bottom-[-1px] h-[2px] bg-[color:var(--color-primary)] rounded-full"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
