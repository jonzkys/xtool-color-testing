import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Compose conditional class names then de-duplicate conflicting Tailwind
 * utilities so later classes always win. Use everywhere a className is
 * built from multiple sources.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
