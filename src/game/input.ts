import type { MoveInput } from "./rov";

/**
 * REQ-030: what the touch controls feed into, the same state the keyboard and mouse drive. Keys are the codes the keyboard
 * would send (▲ is "Space", ▼ is "ShiftLeft", E is "KeyE", the tool bar's slots are "Digit1".."Digit4").
 */
export interface TouchInput {
  /** The joystick: `x` to the right, `y` forward, each -1..1 (0, 0 when let go). */
  stick(x: number, y: number): void;
  /** A button held down (true) or let go (false), as its key would be. */
  hold(code: string, down: boolean): void;
  /** A tap on a button: one press of its key. */
  tap(code: string): void;
  /** The PAKAI button, held down or let go, as the left mouse button. */
  primary(down: boolean): void;
  /** A drag to steer or look, in mouse pixels. */
  look(dx: number, dy: number): void;
  /** A tap on the picture: skips a cinematic, as a click does. */
  click(): void;
}

/** Keyboard, mouse and touch state, read once per frame by the game. Keys are `KeyboardEvent.code`, so any layout works. */
export class Input implements TouchInput {
  private readonly keys = new Set<string>();
  /** Keys pressed since the last takePressed(), once per press (holding a key does not repeat). */
  private readonly pressed: string[] = [];
  private mouseX = 0;
  private mouseY = 0;
  private primaryDown = false;
  /** REQ-027 AC-4: presses of the left button while the cursor is locked since the last takeClicks(): a click skips a cinematic. */
  private clicks = 0;
  /** Keys held that must not count until they are let go: the Space that skipped a cinematic must not also lift the submarine. */
  private readonly ignored = new Set<string>();
  /** REQ-030 AC-2: the joystick, x right and y forward. */
  private stickX = 0;
  private stickY = 0;

  constructor(doc: Document) {
    const win = doc.defaultView!;
    win.addEventListener("keydown", (event) => {
      // Space must not scroll or press a focused button while the ROV is being flown.
      if (event.code === "Space" && doc.pointerLockElement) event.preventDefault();
      this.keyDown(event.code, event.repeat);
    });
    win.addEventListener("keyup", (event) => this.keyUp(event.code));
    doc.addEventListener("mousemove", (event) => {
      if (!doc.pointerLockElement) return;
      this.mouseX += event.movementX;
      this.mouseY += event.movementY;
    });
    // The button only counts while the cursor is locked to the game; releasing always counts.
    doc.addEventListener("mousedown", (event) => {
      if (event.button === 0 && doc.pointerLockElement) this.primary(true);
    });
    doc.addEventListener("mouseup", (event) => {
      if (event.button === 0) this.primaryDown = false;
    });
  }

  private keyDown(code: string, repeat: boolean): void {
    if (this.ignored.has(code)) return;
    if (!repeat && !this.keys.has(code)) this.pressed.push(code);
    this.keys.add(code);
  }

  private keyUp(code: string): void {
    this.keys.delete(code);
    this.ignored.delete(code);
  }

  move(): MoveInput {
    const held = (code: string) => (this.keys.has(code) ? 1 : 0);
    const axis = (value: number) => Math.min(1, Math.max(-1, value));
    return {
      forward: axis(held("KeyW") - held("KeyS") + this.stickY),
      strafe: axis(held("KeyD") - held("KeyA") + this.stickX),
      rise: held("Space") - Math.max(held("ShiftLeft"), held("ShiftRight")),
    };
  }

  /** Whether the tool button is held: the left mouse button, or PAKAI (REQ-030). */
  primaryHeld(): boolean {
    return this.primaryDown;
  }

  /** Keys pressed since the last call, in order, each once per press. */
  takePressed(): string[] {
    return this.pressed.splice(0);
  }

  /** How many times the left button went down (with the cursor locked), or the picture was tapped, since the last call. */
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

  /** Mouse movement (and touch drags, REQ-030) since the last call, in pixels. */
  takeMouse(): [number, number] {
    const movement: [number, number] = [this.mouseX, this.mouseY];
    this.mouseX = 0;
    this.mouseY = 0;
    return movement;
  }

  stick(x: number, y: number): void {
    this.stickX = x;
    this.stickY = y;
  }

  hold(code: string, down: boolean): void {
    if (down) this.keyDown(code, false);
    else this.keyUp(code);
  }

  tap(code: string): void {
    this.pressed.push(code);
  }

  primary(down: boolean): void {
    if (down && !this.primaryDown) this.clicks += 1;
    this.primaryDown = down;
  }

  look(dx: number, dy: number): void {
    this.mouseX += dx;
    this.mouseY += dy;
  }

  click(): void {
    this.clicks += 1;
  }

  /** Forget held keys and buttons, e.g. when the game pauses, so nothing stays "stuck" after alt-tab. */
  clear(): void {
    this.keys.clear();
    this.pressed.length = 0;
    this.primaryDown = false;
    this.clicks = 0;
    this.mouseX = 0;
    this.mouseY = 0;
    this.stickX = 0;
    this.stickY = 0;
  }
}
