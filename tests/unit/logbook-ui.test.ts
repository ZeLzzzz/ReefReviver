import { describe, expect, it, vi } from "vitest";
import type { HudState } from "../../src/game/hud-state";
import { Session } from "../../src/game/session";
import enStrings from "../../src/i18n/en.json";
import idStrings from "../../src/i18n/id.json";
import type { Lang } from "../../src/i18n/i18n";
import { LOGBOOK_ENTRIES, type LogbookId } from "../../src/logbook/entries";
import { createHud } from "../../src/ui/hud";
import { logbookScreen } from "../../src/ui/logbook";

const q = (el: ParentNode, selector: string) => el.querySelector<HTMLElement>(selector)!;
const text = (el: ParentNode, selector: string) => q(el, selector).textContent;

function screen(lang: Lang, unlocked: LogbookId[], selected: LogbookId | null, extra: { onSelect?: () => void; onClose?: () => void } = {}) {
  return logbookScreen({ lang, unlocked, selected, onSelect: extra.onSelect ?? (() => {}), onClose: extra.onClose ?? (() => {}) });
}

describe("Logbook screen (REQ-006 AC-2, AC-3)", () => {
  it("has seven slots; an unscanned one is a silhouette with '???' and says so in words", () => {
    const el = screen("id", ["clownfish"], "clownfish");
    const slots = [...el.querySelectorAll<HTMLElement>(".slot")];
    expect(slots.map((slot) => slot.dataset.entry)).toEqual(LOGBOOK_ENTRIES.map((entry) => entry.id));
    const locked = slots.filter((slot) => slot.dataset.state === "locked");
    expect(locked).toHaveLength(6);
    for (const slot of locked) {
      expect(text(slot, ".slot-name")).toBe("???");
      expect(q(slot, ".entry-image").classList.contains("locked")).toBe(true);
      expect(q(slot, ".entry-image svg")).not.toBeNull();
      expect(text(slot, ".visually-hidden")).toBe("Belum dipindai");
    }
    expect(text(slots[2], ".slot-name")).toBe("Ikan badut");
    expect(q(el, ".logbook-count").textContent).toBe("Entri terbuka 1/7");
  });

  it("an open entry shows its name, facts, the SDG 14 link and every source, in Indonesian", () => {
    const entry = LOGBOOK_ENTRIES.find((e) => e.id === "turtle")!;
    const el = screen("id", ["turtle"], "turtle");
    expect(text(el, ".entry h3")).toBe("Penyu hijau");
    expect(text(el, ".entry-latin")).toBe("Chelonia mydas");
    expect(text(el, ".entry-facts")).toBe(idStrings["logbook.turtle.facts"]);
    expect(text(el, ".entry-sdg")).toBe(idStrings["logbook.turtle.sdg"]);
    expect([...el.querySelectorAll(".entry h4")].map((h) => h.textContent)).toEqual(["Fakta", "Kaitan dengan SDG 14", "Sumber"]);
    const links = [...el.querySelectorAll<HTMLAnchorElement>(".entry-sources a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(entry.sources.map((source) => source.url));
    expect(links.map((a) => a.textContent)).toEqual(entry.sources.map((source) => source.title));
    for (const a of links) {
      expect(a.target).toBe("_blank");
      expect(a.rel).toContain("noopener");
    }
    expect(q(el, ".entry-sources").textContent).toContain(entry.sources[0].publisher);
  });

  it("shows the same entry in English", () => {
    const el = screen("en", ["mantaRay"], "mantaRay");
    expect(text(el, ".entry h3")).toBe("Reef manta ray");
    expect(text(el, ".entry-facts")).toBe(enStrings["logbook.mantaRay.facts"]);
    expect(text(el, ".entry-sdg")).toBe(enStrings["logbook.mantaRay.sdg"]);
    expect([...el.querySelectorAll(".entry h4")].map((h) => h.textContent)).toEqual(["Facts", "Link to SDG 14", "Sources"]);
    expect(text(el, ".logbook-count")).toBe("Entries unlocked 1/7");
    expect(text(el, ".logbook-hint")).toBe("L or Esc to close");
  });

  it("every entry shows its sources when opened, in both languages (G-002)", () => {
    for (const lang of ["id", "en"] as const) {
      for (const entry of LOGBOOK_ENTRIES) {
        const el = screen(lang, [entry.id], entry.id);
        expect(el.querySelectorAll(".entry-sources a").length).toBe(entry.sources.length);
        expect(entry.sources.length).toBeGreaterThan(0);
      }
    }
  });

  it("does not show an entry that is not scanned, even if it is selected", () => {
    const el = screen("id", ["turtle"], "dolphin");
    expect(q(el, ".entry-empty")).not.toBeNull();
    expect(el.textContent).not.toContain(idStrings["logbook.dolphin.facts"]);
  });

  it("with nothing scanned it says how to get entries", () => {
    expect(text(screen("id", [], null), ".entry-empty")).toBe(idStrings["logbook.none"]);
    expect(text(screen("en", [], null), ".entry-empty")).toBe(enStrings["logbook.none"]);
    expect(text(screen("en", ["coral"], null), ".entry-empty")).toBe("Pick an entry to read it.");
  });

  it("selecting a slot and closing call back; the selected slot is marked", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const el = screen("id", ["coral", "dolphin"], "coral", { onSelect, onClose });
    expect(q(el, '.slot[data-entry="coral"]').getAttribute("aria-pressed")).toBe("true");
    expect(q(el, '.slot[data-entry="dolphin"]').getAttribute("aria-pressed")).toBe("false");
    q(el, '.slot[data-entry="dolphin"]').click();
    expect(onSelect).toHaveBeenCalledWith("dolphin");
    q(el, ".logbook-head button").click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("builds text from strings, never HTML", () => {
    const el = screen("id", LOGBOOK_ENTRIES.map((e) => e.id), "seagrass");
    expect(el.querySelectorAll("script, img").length).toBe(0);
  });
});

function state(overrides: Partial<HudState> = {}): HudState {
  const session = new Session(40);
  return {
    tool: session.tool, tank: 0, capacity: session.capacity, tankFull: false, score: 0, materials: 0,
    cleanliness: 0, objectives: session.objectives, notice: null, inStationZone: false, stationDistance: 37,
    marker: { left: 100, top: 200, onScreen: false, angle: 1 }, sucking: false, cutProgress: 0, ...overrides,
  };
}

describe("Scanner in the HUD (REQ-006 AC-1, AC-6, AC-7)", () => {
  it("shows the Scanner as tool 4 with its hint", () => {
    const hud = createHud("id");
    hud.update(state({ tool: "scanner" }));
    expect(text(hud.element, ".tool-name")).toBe("Scanner");
    expect(text(hud.element, ".tool-hint")).toBe("Tahan klik kiri pada satwa, karang, atau lamun untuk memindainya");
  });

  it("shows the scan progress in the crosshair ring, in words and numbers", () => {
    const hud = createHud("id");
    hud.update(state({ tool: "scanner", scanProgress: 0 }));
    expect(q(hud.element, ".cut-progress").hidden).toBe(true);
    hud.update(state({ tool: "scanner", scanProgress: 0.4 }));
    const progress = q(hud.element, ".cut-progress");
    expect(progress.hidden).toBe(false);
    expect(text(hud.element, ".cut-label")).toBe("Memindai 40%");
    expect(progress.getAttribute("aria-valuenow")).toBe("40");
    expect(progress.getAttribute("aria-label")).toBe("Memindai");
    hud.update(state({ tool: "scanner", scanProgress: 0 }));
    expect(q(hud.element, ".cut-progress").hidden).toBe(true);
  });

  it("keeps the cutter's own words for the cutter", () => {
    const hud = createHud("id");
    hud.update(state({ tool: "cutter", cutProgress: 0.5, scanProgress: 0 }));
    expect(text(hud.element, ".cut-label")).toBe("Memotong jaring 50%");
  });

  it("announces a new entry with its name, in both languages (AC-1)", () => {
    const id = createHud("id");
    id.update(state({ notice: { key: "scanner.newEntry", entry: "turtle" } }));
    expect(text(id.element, ".message-notice")).toBe("Entri baru: Penyu hijau");
    const en = createHud("en");
    en.update(state({ notice: { key: "scanner.newEntry", entry: "reefShark" } }));
    expect(text(en.element, ".message-notice")).toBe("New entry: Blacktip reef shark");
  });

  it("shows the other messages exactly (AC-4, AC-6, AC-7)", () => {
    const hud = createHud("id");
    const say = (key: "scanner.known" | "scanner.trapped" | "scanner.locked") => {
      hud.update(state({ notice: { key } }));
      return text(hud.element, ".message-notice");
    };
    expect(say("scanner.known")).toBe("Sudah tercatat");
    expect(say("scanner.trapped")).toBe("Bebaskan dulu satwa ini");
    expect(say("scanner.locked")).toBe("Scanner aktif setelah laut pulih");
  });

  it("the Phase 3 goal counts the scanned entries", () => {
    const session = new Session(40);
    session.openScanner();
    session.scanned({ kind: "scanned", entry: "coral" });
    session.scanned({ kind: "scanned", entry: "dolphin" });
    const hud = createHud("id");
    hud.update(state({ phase3: session.phase3Objectives }));
    expect(text(hud.element, '.goal[data-goal="scan"] .goal-text')).toBe("Pindai 2/7");
  });
});

describe("Scanner and Logbook strings (G-004)", () => {
  it("exist in both languages with the controls listed", () => {
    for (const key of ["tools.scanner", "tools.scanner.hint", "controls.scanner.keys", "controls.scanner.action", "controls.logbook.keys", "controls.logbook.action", "scanner.progress", "scanner.newEntry", "scanner.known", "scanner.trapped", "scanner.locked", "logbook.title", "logbook.unknown"] as const) {
      expect(idStrings[key]).toBeTruthy();
      expect(enStrings[key]).toBeTruthy();
    }
    expect(idStrings["scanner.locked"]).toBe("Scanner aktif setelah laut pulih");
  });
});
