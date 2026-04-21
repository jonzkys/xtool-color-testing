/**
 * TS mirror of the design tokens declared in `theme.css`.
 * Used by code that needs the raw hex (e.g. the SVG-DOM manipulation in
 * SvgLayersPage that sets fill/opacity imperatively and can't reach for
 * Tailwind utilities). CSS and JS must stay in sync.
 */
export const tokens = {
  bg: "#F7F5F2",
  surface: "#FFFFFF",
  surfaceElevated: "#FDFBF7",
  ink: "#1A1613",
  inkMuted: "#6B6560",
  inkSubtle: "#8A847E",
  border: "#E8E3DC",
  borderStrong: "#D6CFC5",
  primary: "#B8410E",
  primaryHover: "#9E370C",
  primaryTint: "#FBE9DF",
  secondary: "#1F3A5F",
  secondaryTint: "#E6ECF3",
  success: "#2F6F4E",
  warning: "#C98A1E",
  destructive: "#9B2430",
  destructiveTint: "#FBE2E5",
} as const;

export type TokenKey = keyof typeof tokens;
