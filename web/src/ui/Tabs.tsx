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
