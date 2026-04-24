import { useEffect, useState } from "react";
import { isDemoUser } from "../api/userHeader";

/**
 * Read-only boolean derived from ``localStorage``. Re-checks when the
 * ``storage`` event fires so exiting demo in another tab updates the
 * banner and disabled-button state in this tab.
 *
 * In-tab updates (entering/exiting demo via a button in this same tab)
 * don't fire ``storage`` — callers who need to react inside the tab
 * that mutated storage must also trigger a state update themselves
 * (e.g. a ``navigate`` that re-renders the tree).
 */
export function useIsDemo(): boolean {
  const [v, setV] = useState<boolean>(isDemoUser);
  useEffect(() => {
    const handler = () => setV(isDemoUser());
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  return v;
}
