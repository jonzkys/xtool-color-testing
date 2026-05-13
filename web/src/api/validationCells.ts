/**
 * PATCH /api/tests/{id}/validation-cells — replaces the cell list for
 * a kind=validation test in one shot. Frontend sorts cells by L*
 * before posting (the burn ordering). Returns the new cell count.
 */
import { j } from "./_fetch";

export interface ValidationCellPayload {
  cell_index: number;
  palette_entry_id: number | null;
  expected_hex: string;
  expected_lab: number[];   // [L*, a*, b*]
  // ``boolean`` is included for ``crosshatch`` — the forward-sample
  // propose-test path persists per-cell crosshatch so the validation
  // cell carries its own toggle independent of the test-level default.
  // The backend Pydantic schema coerces bools to numbers, and the
  // renderer reads ``crosshatch`` back via ``bool(...)``.
  params: Record<string, string | number | boolean>;
}

export async function patchValidationCells(
  testId: number,
  cells: ValidationCellPayload[],
): Promise<{ ok: boolean; count: number }> {
  return j(await fetch(`/api/tests/${testId}/validation-cells`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cells }),
  }));
}
