import { describe, expect, it } from "vitest";
import { LOGBOOK_ENTRIES, logbookKeys, type LogbookEntry } from "../../src/logbook/entries";
import { LANGUAGES, strings, type Lang, type StringKey } from "../../src/i18n/i18n";

// D-016: the order of the seven entries.
const ORDER = ["turtle", "reefShark", "clownfish", "mantaRay", "dolphin", "coral", "seagrass"];

// The ten official SDG 14 targets (UN, sdgs.un.org/goals/goal14).
const SDG14_TARGETS = ["14.1", "14.2", "14.3", "14.4", "14.5", "14.6", "14.7", "14.a", "14.b", "14.c"];

// D-027: the species and their Latin names. Coral and seagrass stay at group level.
const SCIENTIFIC_NAMES: Record<string, string | undefined> = {
  turtle: "Chelonia mydas",
  reefShark: "Carcharhinus melanopterus",
  clownfish: "Amphiprion ocellaris",
  mantaRay: "Mobula alfredi",
  dolphin: "Stenella longirostris",
  coral: undefined,
  seagrass: undefined,
};

// AC-7: facts + SDG sentence must fit the Logbook panel without scrolling (about 60 words, 65 at most).
const MAX_WORDS = 65;

const text = (lang: Lang, key: StringKey): string => strings[lang][key];
const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;
const sentenceCount = (s: string): number => s.trim().split(/(?<=[.!?])\s+/).filter(Boolean).length;

describe("Logbook entries (REQ-007 AC-1, D-016)", () => {
  it("has the seven entries in the D-016 order", () => {
    expect(LOGBOOK_ENTRIES.map((entry) => entry.id)).toEqual(ORDER);
  });

  it.each(LANGUAGES)("every entry has a name, 2-3 sentences of facts and an SDG sentence in %s", (lang) => {
    for (const entry of LOGBOOK_ENTRIES) {
      const keys = logbookKeys(entry.id);
      expect(text(lang, keys.name).trim(), `${entry.id} name`).not.toBe("");
      expect(text(lang, keys.sdg).trim(), `${entry.id} sdg`).not.toBe("");
      const sentences = sentenceCount(text(lang, keys.facts));
      expect(sentences, `${entry.id} facts in ${lang}`).toBeGreaterThanOrEqual(2);
      expect(sentences, `${entry.id} facts in ${lang}`).toBeLessThanOrEqual(3);
      expect(sentenceCount(text(lang, keys.sdg)), `${entry.id} sdg in ${lang}`).toBe(1);
    }
  });

  it("the Indonesian and English texts differ (no untranslated copy)", () => {
    for (const entry of LOGBOOK_ENTRIES) {
      const keys = logbookKeys(entry.id);
      expect(text("id", keys.facts)).not.toBe(text("en", keys.facts));
      expect(text("id", keys.sdg)).not.toBe(text("en", keys.sdg));
    }
  });
});

describe("Logbook sources (REQ-007 AC-2, G-002)", () => {
  it.each(ORDER)("%s lists at least one source with a checkable https URL", (id) => {
    const entry = LOGBOOK_ENTRIES.find((e) => e.id === id) as LogbookEntry;
    expect(entry.sources.length).toBeGreaterThanOrEqual(1);
    for (const source of entry.sources) {
      expect(source.publisher.trim()).not.toBe("");
      expect(source.title.trim()).not.toBe("");
      expect(source.supports.trim()).not.toBe("");
      const url = new URL(source.url); // throws on a malformed URL
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toContain(".");
    }
  });

  it("every entry has a source about the subject itself, not only the UN goal page", () => {
    for (const entry of LOGBOOK_ENTRIES) {
      const subjectSources = entry.sources.filter((s) => new URL(s.url).hostname !== "sdgs.un.org");
      expect(subjectSources.length, entry.id).toBeGreaterThanOrEqual(1);
    }
  });

  it("no source is listed twice in one entry", () => {
    for (const entry of LOGBOOK_ENTRIES) {
      const urls = entry.sources.map((s) => s.url);
      expect(new Set(urls).size, entry.id).toBe(urls.length);
    }
  });
});

describe("Logbook SDG 14 link (REQ-007 AC-3)", () => {
  it.each(ORDER)("%s links to an official SDG 14 target and names its number in both languages", (id) => {
    const entry = LOGBOOK_ENTRIES.find((e) => e.id === id) as LogbookEntry;
    expect(SDG14_TARGETS).toContain(entry.sdgTarget);
    for (const lang of LANGUAGES) {
      const sdg = text(lang, logbookKeys(entry.id).sdg);
      expect(sdg, `${id} in ${lang}`).toContain(`Target ${entry.sdgTarget}`);
      const named = sdg.match(/\b14\.[1-7a-c]\b/g) ?? [];
      expect(named, `${id} in ${lang}`).toEqual([entry.sdgTarget]);
    }
  });

  it("the UN goal page is listed as the source of the target text", () => {
    for (const entry of LOGBOOK_ENTRIES) {
      const un = entry.sources.find((s) => new URL(s.url).hostname === "sdgs.un.org");
      expect(un, entry.id).toBeDefined();
      expect(un?.supports).toContain(`Target ${entry.sdgTarget}`);
    }
  });

  it("rejects a number that is not an SDG 14 target", () => {
    expect(SDG14_TARGETS).not.toContain("14.8");
    expect(SDG14_TARGETS).not.toContain("15.1");
  });
});

describe("Logbook species (REQ-007 AC-5, D-027)", () => {
  it.each(ORDER)("%s has the scientific name from D-027", (id) => {
    const entry = LOGBOOK_ENTRIES.find((e) => e.id === id) as LogbookEntry;
    expect(entry.scientificName).toBe(SCIENTIFIC_NAMES[id]);
  });

  it("names the species, not the group, in both languages", () => {
    expect(text("id", logbookKeys("turtle").name)).toBe("Penyu hijau");
    expect(text("id", logbookKeys("reefShark").name)).toBe("Hiu sirip hitam karang");
    expect(text("id", logbookKeys("clownfish").name)).toBe("Ikan badut");
    expect(text("id", logbookKeys("mantaRay").name)).toBe("Pari manta karang");
    expect(text("id", logbookKeys("dolphin").name)).toBe("Lumba-lumba spinner");
    expect(text("id", logbookKeys("coral").name)).toBe("Karang");
    expect(text("id", logbookKeys("seagrass").name)).toBe("Lamun");
    expect(text("en", logbookKeys("turtle").name)).toBe("Green turtle");
    expect(text("en", logbookKeys("reefShark").name)).toBe("Blacktip reef shark");
    expect(text("en", logbookKeys("clownfish").name)).toBe("Clownfish");
    expect(text("en", logbookKeys("mantaRay").name)).toBe("Reef manta ray");
    expect(text("en", logbookKeys("dolphin").name)).toBe("Spinner dolphin");
    expect(text("en", logbookKeys("coral").name)).toBe("Coral");
    expect(text("en", logbookKeys("seagrass").name)).toBe("Seagrass");
  });
});

describe("Logbook length (REQ-007 AC-7)", () => {
  it("counts words by whitespace", () => {
    expect(wordCount("  satu dua\ttiga\n")).toBe(3);
    expect(wordCount("")).toBe(0);
  });

  it(`facts + SDG sentence stay within ${MAX_WORDS} words per language`, () => {
    for (const lang of LANGUAGES) {
      for (const entry of LOGBOOK_ENTRIES) {
        const keys = logbookKeys(entry.id);
        const words = wordCount(text(lang, keys.facts)) + wordCount(text(lang, keys.sdg));
        expect(words, `${entry.id} in ${lang}`).toBeLessThanOrEqual(MAX_WORDS);
      }
    }
  });

  it("would flag a text that is too long", () => {
    expect(wordCount(Array(MAX_WORDS + 1).fill("kata").join(" "))).toBeGreaterThan(MAX_WORDS);
  });
});
