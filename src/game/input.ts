import type { MoveInput } from "./rov";

/** Keyboard and mouse state, read once per frame by the game. Keys are `KeyboardEvent.code`, so any layout works. */
export class Input {
  private readonly keys = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;

  constructor(doc: Document) {
    const win = doc.defaultView!;
    win.addEventListener("keydown", (event) => {
      this.keys.add(event.code);
      // Space must not scroll or press a focused button while the ROV is being flown.
      if (event.code === "Space" && doc.pointerLockElement) event.preventDefault();
    });
    win.addEventListener("keyup", (event) => this.keys.delete(event.code));
    doc.addEventListener("mousemove", (event) => {
      if (!doc.pointerLockElement) return;
      this.mouseX += event.movementX;
      this.mouseY += event.movementY;
    });
  }

  move(): MoveInput {
    const held = (code: string) => (this.keys.has(code) ? 1 : 0);
    return {
      forward: held("KeyW") - held("KeyS"),
      strafe: held("KeyD") - held("KeyA"),
      rise: held("Space") - Math.max(held("ShiftLeft"), held("ShiftRight")),
    };
  }

  /** Mouse movement since the last call, in pixels. */
  takeMouse(): [number, number] {
    const movement: [number, number] = [this.mouseX, this.mouseY];
    this.mouseX = 0;
    this.mouseY = 0;
    return movement;
  }

  /** Forget held keys, e.g. when the game pauses, so no key stays "stuck" after alt-tab. */
  clear(): void {
    this.keys.clear();
    this.mouseX = 0;
    this.mouseY = 0;
  }
}
