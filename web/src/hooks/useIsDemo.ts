import { useEffect, useState } from "react";
import { isDemoUser, USER_CHANGED_EVENT } from "../api/userHeader";

/**
 * Read-only boolean derived from ``localStorage``. Two subscriptions:
 *
 *   - ``storage`` event — fires in OTHER tabs when this origin writes
 *     to localStorage. Lets the banner state sync across tabs.
 *   - ``xcsgen:user-changed`` custom event — dispatched by
 *     ``enterDemo``/``exitDemo`` (and could be by other user-mutation
 *     call sites in the future). Catches SAME-TAB updates so the
 *     banner appears immediately after a ``#/demo`` entry without
 *     needing a page reload.
 */
export function useIsDemo(): boolean {
  const [v, setV] = useState<boolean>(isDemoUser);
  useEffect(() => {
    const refresh = () => setV(isDemoUser());
    const storageHandler = (e: StorageEvent) => {
      if (
        e.key === "xcsgen:userId" ||
        e.key === "xcsgen:userId:prev" ||
        e.key === null
      ) {
        refresh();
      }
    };
    window.addEventListener("storage", storageHandler);
    window.addEventListener(USER_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", storageHandler);
      window.removeEventListener(USER_CHANGED_EVENT, refresh);
    };
  }, []);
  return v;
}
