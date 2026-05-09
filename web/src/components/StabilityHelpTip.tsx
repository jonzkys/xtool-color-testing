/* Backwards-compat shim. Stability's existing call-sites import HelpTip
 * from this file; the implementation has moved to ./HelpTip.tsx with a
 * body-agnostic API. We bind the stability body here so the public API
 * (`<HelpTip help={...}>`) is identical for those call-sites. */

import * as React from "react";
import { HelpTip as GenericHelpTip } from "./HelpTip";
import { StabilityHelpCardBody } from "./StabilityHelpCardBody";
import type { AxisHelp } from "./stabilityHelpCopy";

export interface HelpTipProps {
  help: AxisHelp;
  children: React.ReactElement;
  className?: string;
}

export function HelpTip({ help, children, className }: HelpTipProps) {
  return (
    <GenericHelpTip<AxisHelp>
      help={help}
      Body={StabilityHelpCardBody}
      className={className}
    >
      {children}
    </GenericHelpTip>
  );
}

export { __testing__ } from "./HelpTip";
