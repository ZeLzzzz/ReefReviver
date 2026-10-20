/** Tool slots follow the number keys (D-019). The Cutter and the Vacuum exist so far; REQ-004/006 add the others. */
export type ToolId = "vacuum" | "cutter";

export const START_TOOL: ToolId = "vacuum";

const SLOTS: Readonly<Record<string, ToolId>> = { Digit1: "cutter", Digit2: "vacuum" };

/** The tool a key selects, or null when the key selects nothing (yet). */
export function toolForKey(code: string): ToolId | null {
  return SLOTS[code] ?? null;
}
