/** Tool slots follow the number keys (D-019). The Cutter, Vacuum and Seed launcher exist so far; REQ-006 adds the Scanner. */
export type ToolId = "vacuum" | "cutter" | "seedLauncher";

export const START_TOOL: ToolId = "vacuum";

const SLOTS: Readonly<Record<string, ToolId>> = { Digit1: "cutter", Digit2: "vacuum", Digit3: "seedLauncher" };

/** The tool a key selects, or null when the key selects nothing (yet). */
export function toolForKey(code: string): ToolId | null {
  return SLOTS[code] ?? null;
}
