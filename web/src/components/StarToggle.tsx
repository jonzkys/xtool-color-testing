import { Star } from "lucide-react";
import { cn } from "../ui";

export function StarToggle({
  favorited,
  onChange,
  disabled,
  className,
  size = "sm",
}: {
  favorited: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  const px = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange(!favorited);
      }}
      aria-pressed={favorited}
      aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
      title={favorited ? "Favorited" : "Favorite"}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center p-1 rounded-full",
        "transition-opacity",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
        favorited
          ? "opacity-100"
          : "opacity-70 hover:opacity-100",
        className,
      )}
      style={{ mixBlendMode: favorited ? "normal" : "difference" }}
    >
      <Star
        className={px}
        strokeWidth={2}
        fill={favorited ? "var(--color-accent, #caa14b)" : "none"}
        color={favorited ? "var(--color-accent, #caa14b)" : "white"}
      />
    </button>
  );
}
