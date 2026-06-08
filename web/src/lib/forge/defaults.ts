// web/src/lib/forge/defaults.ts
import type { ForgeConfig } from "./types";
import { LEAN } from "./presets";

/** Shipped default = the LEAN preset (time-aware; the deep 1/2/4/8 schedule is
 *  the AGGRESSIVE preset). */
export const DEFAULT_CONFIG: ForgeConfig = LEAN;
