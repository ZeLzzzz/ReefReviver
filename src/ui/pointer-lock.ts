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
