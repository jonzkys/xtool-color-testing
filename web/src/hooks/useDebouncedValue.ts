import { useEffect, useState } from "react";

/** Returns `value` delayed by `delayMs` — it only updates once `value` has
 *  stopped changing for that long. Use it to keep a fast-changing input (a
 *  controlled form field) responsive while deferring an expensive downstream
 *  computation so it doesn't run on every keystroke. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
