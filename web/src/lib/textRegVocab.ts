import type { TextRegParamsBody } from "../types";

/** TextReg field name -> validation-profile field name. Others passthrough.
 *  Mirror of src/xcs_gen_web/text_reg_vocab.py. */
const TEXTREG_TO_PROFILE: Record<string, string> = {
  repeat: "passes",
  mopa_frequency: "frequency",
  processing_light_source: "laser",
};
const PROFILE_TO_TEXTREG: Record<string, string> = Object.fromEntries(
  Object.entries(TEXTREG_TO_PROFILE).map(([k, v]) => [v, k]),
);

export type ProfileShapedParams = Record<string, number | string>;

/** Rename TextReg fields to profile field names for the shared form/validator. */
export function toProfile(v: TextRegParamsBody): ProfileShapedParams {
  const out: ProfileShapedParams = {};
  for (const [k, val] of Object.entries(v)) out[TEXTREG_TO_PROFILE[k] ?? k] = val as number | string;
  return out;
}

/** Rename profile field names back to TextReg fields for storage/wire. */
export function fromProfile(p: ProfileShapedParams): TextRegParamsBody {
  const out: Record<string, number | string> = {};
  for (const [k, val] of Object.entries(p)) out[PROFILE_TO_TEXTREG[k] ?? k] = val;
  return out as unknown as TextRegParamsBody;
}
