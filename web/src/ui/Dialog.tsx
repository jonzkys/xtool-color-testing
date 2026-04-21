import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn";
import { IconButton } from "./IconButton";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof DialogPrimitive.Content> & { width?: "sm" | "md" | "lg" }
>(({ className, children, width = "md", ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      )}
    />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
        "bg-[color:var(--color-surface)] text-[color:var(--color-ink)]",
        "border border-[color:var(--color-border)] rounded-[14px]",
        "shadow-[var(--shadow-popover)]",
        "p-5 w-[calc(100vw-2rem)]",
        width === "sm" && "max-w-[380px]",
        width === "md" && "max-w-[520px]",
        width === "lg" && "max-w-[720px]",
        "focus:outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";

export function DialogHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-3 mb-4", className)}>
      <div className="flex-1 min-w-0">{children}</div>
      <DialogClose asChild>
        <IconButton
          aria-label="Close"
          variant="ghost"
          size="sm"
          icon={<X className="h-4 w-4" />}
        />
      </DialogClose>
    </div>
  );
}

export function DialogTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Title
      className={cn("text-[15px] font-semibold text-[color:var(--color-ink)]", className)}
    >
      {children}
    </DialogPrimitive.Title>
  );
}

export function DialogDescription({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Description
      className={cn("mt-1 text-[13px] text-[color:var(--color-ink-muted)]", className)}
    >
      {children}
    </DialogPrimitive.Description>
  );
}
