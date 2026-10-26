export interface PointerLock {
  /** Asks the browser to lock the cursor; resolves false when it refuses. */
  request(): Promise<boolean>;
  exit(): void;
  onChange(listener: (locked: boolean) => void): void;
}

export function domPointerLock(target: HTMLElement): PointerLock {
  const doc = target.ownerDocument;
  const isLocked = () => doc.pointerLockElement === target;
  return {
    request() {
      return new Promise((resolve) => {
        const finish = (locked: boolean) => {
          doc.removeEventListener("pointerlockchange", onChange);
          doc.removeEventListener("pointerlockerror", onError);
          resolve(locked);
        };
        const onChange = () => isLocked() && finish(true);
        const onError = () => finish(false);
        doc.addEventListener("pointerlockchange", onChange);
        doc.addEventListener("pointerlockerror", onError);
        try {
          // Chrome returns a promise and rejects e.g. when re-locking too soon after Esc; Firefox returns nothing.
          const result = target.requestPointerLock() as Promise<void> | undefined;
          result?.catch(onError);
        } catch {
          onError();
        }
      });
    },
    exit() {
      if (isLocked()) doc.exitPointerLock();
    },
    onChange(listener) {
      doc.addEventListener("pointerlockchange", () => listener(isLocked()));
    },
  };
}

/**
 * REQ-030: a phone or tablet has no cursor to lock. Each "lock" (Mulai, Lanjut, Mulai menyelam, closing the Logbook) asks
 * for the full screen instead and counts as locked at once, whether the browser allows the full screen or not (D-118), so
 * the game always goes on. Leaving the full screen does not pause the game; switching apps does, as on a computer.
 */
export function touchPointerLock(doc: Document): PointerLock {
  const listeners: ((locked: boolean) => void)[] = [];
  let locked = false;
  const set = (value: boolean) => {
    if (locked === value) return;
    locked = value;
    for (const listener of listeners) listener(value);
  };
  return {
    request() {
      enterFullscreen(doc);
      set(true);
      return Promise.resolve(true);
    },
    exit() {
      set(false);
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}

/** Asks for the full screen, turned sideways where the browser can lock the orientation; a refusal changes nothing. */
function enterFullscreen(doc: Document): void {
  const root = doc.documentElement;
  if (doc.fullscreenElement || typeof root.requestFullscreen !== "function") return;
  const orientation = doc.defaultView?.screen.orientation as (ScreenOrientation & { lock?: (to: string) => Promise<void> }) | undefined;
  try {
    root.requestFullscreen({ navigationUI: "hide" }).then(
      () => orientation?.lock?.("landscape").catch(() => {}),
      () => {},
    );
  } catch {
    // Not allowed here: the game goes on in the browser's own view.
  }
}
