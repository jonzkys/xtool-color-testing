import { useCallback, useEffect, useState } from "react";
import type { Machine, MachinesPayload, ProfileId, ValidationProfile } from "../types";
import { getMachines } from "../api/machines";

const LS_KEY = "xcs.currentMachineId";
const DEFAULT_MACHINE_ID = "F2Ultra";

export function getCurrentMachineId(): string {
  try {
    return localStorage.getItem(LS_KEY) || DEFAULT_MACHINE_ID;
  } catch {
    return DEFAULT_MACHINE_ID;
  }
}

/** React hook: returns the registry payload + the current machine + a setter
 *  that persists to localStorage and reloads the page. The page reload is
 *  intentional — switching machines changes the entire data scope, so a
 *  hard refresh is the simplest way to invalidate every cached query. */
export function useCurrentMachine() {
  const [registry, setRegistry] = useState<MachinesPayload | null>(null);
  const [machineId, setMachineIdState] = useState<string>(getCurrentMachineId());

  useEffect(() => {
    let cancelled = false;
    getMachines().then((p) => { if (!cancelled) setRegistry(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const machine: Machine | null = registry
    ? registry.machines.find((m) => m.id === machineId) ?? registry.machines[0]
    : null;

  const setMachineId = useCallback((id: string) => {
    try { localStorage.setItem(LS_KEY, id); } catch { /* private mode */ }
    setMachineIdState(id);
    // Switching machines wholesale-changes the data scope. Send the
    // user back to the Tests homepage before reloading so we can never
    // land on a detail/edit route owned by the previous machine
    // (e.g. /tests/14 belongs to F1; that id may not exist on F2).
    window.location.hash = "#/tests";
    window.location.reload();
  }, []);

  return { registry, machineId, machine, setMachineId };
}

/** Pure derivation — given a registry, machine id, and mode, return the
 *  constraint dict. Returns null if the machine doesn't support that mode. */
export function getValidationProfile(
  registry: MachinesPayload | null, machineId: string, mode: string,
): ValidationProfile | null {
  if (!registry) return null;
  const machine = registry.machines.find((m) => m.id === machineId);
  if (!machine) return null;
  const modeSpec = machine.modes.find((m) => m.id === mode);
  if (!modeSpec) return null;
  return registry.profiles[modeSpec.profile as ProfileId] ?? null;
}
