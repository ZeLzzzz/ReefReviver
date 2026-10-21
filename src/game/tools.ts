/** Tool slots follow the number keys (D-019). The Scanner (REQ-006) is locked until the Bloom is over. */
export type ToolId = "vacuum" | "cutter" | "seedLauncher" | "scanner";

export const START_TOOL: ToolId = "vacuum";

const SLOTS: Readonly<Record<string, ToolId>> = { Digit1: "cutter", Digit2: "vacuum", Digit3: "seedLauncher", Digit4: "scanner" };

/** The tool a key selects, or null when the key selects nothing. */
export function toolForKey(code: string): ToolId | null {
  return SLOTS[code] ?? null;
}
