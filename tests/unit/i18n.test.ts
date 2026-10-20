import { describe, expect, it } from "vitest";
import idStrings from "../../src/i18n/id.json";
import enStrings from "../../src/i18n/en.json";
import {
  LANGUAGE_STORAGE_KEY,
  browserStorage,
  detectLanguage,
  initialLanguage,
  saveLanguage,
  type StorageLike,
} from "../../src/i18n/i18n";

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

const blockedStorage: StorageLike = {
  getItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
};

describe("detectLanguage (REQ-001 AC-2)", () => {
  it.each([
    [["id"], "id"],
    [["id-ID", "en-US"], "id"],
    [["ID-id"], "id"],
    [["en-US", "id"], "en"],
    [["ms-MY"], "en"],
    [["fr"], "en"],
    [[], "en"],
  ])("%j -> %s", (languages, expected) => {
    expect(detectLanguage(languages)).toBe(expected);
  });
});

describe("remembered language (REQ-001 AC-2)", () => {
  it("uses the browser language when nothing was chosen", () => {
    expect(initialLanguage(memoryStorage(), ["id-ID"])).toBe("id");
  });

  it("keeps the player's choice across visits", () => {
    const storage = memoryStorage();
    saveLanguage(storage, "en");
    expect(storage.data.get(LANGUAGE_STORAGE_KEY)).toBe("en");
    expect(initialLanguage(storage, ["id-ID"])).toBe("en");
  });

  it("ignores an unknown stored value", () => {
    const storage = memoryStorage();
    storage.setItem(LANGUAGE_STORAGE_KEY, "fr");
    expect(initialLanguage(storage, ["id"])).toBe("id");
  });

  it("falls back to the browser language when storage is blocked or missing", () => {
    expect(initialLanguage(blockedStorage, ["id"])).toBe("id");
    expect(initialLanguage(null, ["en-GB"])).toBe("en");
    expect(() => saveLanguage(blockedStorage, "en")).not.toThrow();
    expect(() => saveLanguage(null, "en")).not.toThrow();
  });

  it("treats a localStorage getter that throws as no storage", () => {
    const win = {} as Window;
    Object.defineProperty(win, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    expect(browserStorage(win)).toBeNull();
  });
});

describe("string files (G-004)", () => {
  it("ID and EN have the same keys", () => {
    expect(Object.keys(enStrings).sort()).toEqual(Object.keys(idStrings).sort());
  });

  it("no string is empty", () => {
    for (const value of [...Object.values(idStrings), ...Object.values(enStrings)]) {
      expect(value.trim()).not.toBe("");
    }
  });
});
