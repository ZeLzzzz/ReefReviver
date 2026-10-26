import idStrings from "./id.json";
import enStrings from "./en.json";

export type Lang = "id" | "en";
export type StringKey = keyof typeof idStrings;

// Every text shown in the game comes from these two files, which must have the same keys (G-004).
export const strings: Record<Lang, Record<StringKey, string>> = { id: idStrings, en: enStrings };

export const LANGUAGES: readonly Lang[] = ["id", "en"];

export const LANGUAGE_STORAGE_KEY = "reefreviver.lang";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function t(lang: Lang, key: StringKey): string {
  return strings[lang][key];
}

/**
 * REQ-030 AC-5: on a phone or tablet, a text that names a key or the mouse is read from its touch wording, `<key>.touch`,
 * where it has one ("Tekan E" becomes "Ketuk E", "klik kiri" becomes "PAKAI").
 */
export function forTouch(key: StringKey, touch: boolean): StringKey {
  const touchKey = `${key}.touch`;
  return touch && touchKey in strings.id ? (touchKey as StringKey) : key;
}

/** A text with `{name}` placeholders filled in, so numbers that belong to the game come from its configuration, not from the strings (REQ-029). */
export function format(lang: Lang, key: StringKey, values: Record<string, string | number>): string {
  return t(lang, key).replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

/** Indonesian when the browser's first language is Indonesian, English otherwise (REQ-001 AC-2). */
export function detectLanguage(browserLanguages: readonly string[]): Lang {
  const primary = (browserLanguages[0] ?? "").toLowerCase();
  return primary === "id" || primary.startsWith("id-") ? "id" : "en";
}

/** The language the player picked earlier, or the browser's language. Blocked storage counts as no choice. */
export function initialLanguage(storage: StorageLike | null, browserLanguages: readonly string[]): Lang {
  let saved: string | null = null;
  try {
    saved = storage?.getItem(LANGUAGE_STORAGE_KEY) ?? null;
  } catch {
    // Storage blocked: fall back to the browser's language.
  }
  return saved === "id" || saved === "en" ? saved : detectLanguage(browserLanguages);
}

export function saveLanguage(storage: StorageLike | null, lang: Lang): void {
  try {
    storage?.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // Storage blocked: the choice lasts until the page is closed.
  }
}

/** `window.localStorage`, or null when the browser blocks it (reading the property itself can throw). */
export function browserStorage(win: Window): StorageLike | null {
  try {
    return win.localStorage;
  } catch {
    return null;
  }
}
