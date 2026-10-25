import type { MoveInput } from "./rov";

/** Keyboard and mouse state, read once per frame by the game. Keys are `KeyboardEvent.code`, so any layout works. */
export class Input {
  private readonly keys = new Set<string>();
  /** Keys pressed since the last takePressed(), once per press (holding a key does not repeat). */
  private readonly pressed: string[] = [];
  private mouseX = 0;
  private mouseY = 0;
  private primary = false;
  /** REQ-027 AC-4: presses of the left button while the cursor is locked since the last takeClicks(): a click skips a cinematic. */
  private clicks = 0;
  /** Keys held that must not count until they are let go: the Space that skipped a cinematic must not also lift the submarine. */
  private readonly ignored = new Set<string>();

  constructor(doc: Document) {
    const win = doc.defaultView!;
    win.addEventListener("keydown", (event) => {
      // Space must not scroll or press a focused button while the ROV is being flown.
      if (event.code === "Space" && doc.pointerLockElement) event.preventDefault();
      if (this.ignored.has(event.code)) return;
      if (!event.repeat && !this.keys.has(event.code)) this.pressed.push(event.code);
      this.keys.add(event.code);
    });
    win.addEventListener("keyup", (event) => {
      this.keys.delete(event.code);
      this.ignored.delete(event.code);
    });
    doc.addEventListener("mousemove", (event) => {
      if (!doc.pointerLockElement) return;
      this.mouseX += event.movementX;
      this.mouseY += event.movementY;
    });
    // The button only counts while the cursor is locked to the game; releasing always counts.
    doc.addEventListener("mousedown", (event) => {
      if (event.button === 0 && doc.pointerLockElement) {
        this.primary = true;
        this.clicks += 1;
      }
    });
    doc.addEventListener("mouseup", (event) => {
      if (event.button === 0) this.primary = false;
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

  /** Whether the left mouse button is held (the tool button). */
  primaryHeld(): boolean {
    return this.primary;
  }

  /** Keys pressed since the last call, in order, each once per press. */
  takePressed(): string[] {
    return this.pressed.splice(0);
  }

  /** How many times the left button went down (with the cursor locked) since the last call. */
  takeClicks(): number {
    const clicks = this.clicks;
    this.clicks = 0;
    return clicks;
  }

  /** Lets go of `code` if it is held, and ignores it until it really is released (the repeat of a held key is not a new press). */
  ignoreUntilReleased(code: string): void {
    if (this.keys.has(code)) this.ignored.add(code);
    this.keys.delete(code);
  }

  /** Mouse movement since the last call, in pixels. */
  takeMouse(): [number, number] {
    const movement: [number, number] = [this.mouseX, this.mouseY];
    this.mouseX = 0;
    this.mouseY = 0;
    return movement;
  }

  /** Forget held keys and buttons, e.g. when the game pauses, so nothing stays "stuck" after alt-tab. */
  clear(): void {
    this.keys.clear();
    this.pressed.length = 0;
    this.primary = false;
    this.clicks = 0;
    this.mouseX = 0;
    this.mouseY = 0;
  }
}
