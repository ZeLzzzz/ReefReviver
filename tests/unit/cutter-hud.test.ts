import { describe, expect, it } from "vitest";
import type { HudState } from "../../src/game/hud-state";
import { Session } from "../../src/game/session";
import { createHud } from "../../src/ui/hud";
import enStrings from "../../src/i18n/en.json";
import idStrings from "../../src/i18n/id.json";

function state(overrides: Partial<HudState> = {}): HudState {
  const session = new Session(40);
  return {
    tool: session.tool,
    tank: 0,
    capacity: session.capacity,
    tankFull: false,
    score: session.score,
    materials: 0,
    cleanliness: session.cleanliness,
    objectives: session.objectives,
    notice: null,
    inStationZone: false,
    stationDistance: 37,
    marker: { left: 100, top: 200, onScreen: false, angle: 1 },
    sucking: false,
    cutProgress: 0,
    ...overrides,
  };
}

const q = (el: HTMLElement, selector: string) => el.querySelector<HTMLElement>(selector)!;

describe("Cutter in the HUD (REQ-003 AC-1, AC-4)", () => {
  it("shows the Cutter as tool 1 with its hint", () => {
    const hud = createHud("id");
    hud.update(state({ tool: "cutter" }));
    expect(q(hud.element, ".tool-name").textContent).toBe("1 Cutter");
    expect(q(hud.element, ".tool-hint").textContent).toBe("Tahan klik kiri pada jaring untuk memotongnya");
  });

  it("hides the progress indicator when nothing is being cut", () => {
    const hud = createHud("id");
    hud.update(state());
    expect(q(hud.element, ".cut-progress").hidden).toBe(true);
    expect(hud.element.classList.contains("cutting")).toBe(false);
  });

  it("fills the indicator as the cut progresses, in words and numbers as well as the ring", () => {
    const hud = createHud("id");
    hud.update(state({ tool: "cutter", cutProgress: 0.5 }));
    const progress = q(hud.element, ".cut-progress");
    expect(progress.hidden).toBe(false);
    expect(progress.getAttribute("role")).toBe("progressbar");
    expect(progress.getAttribute("aria-valuenow")).toBe("50");
    expect(q(hud.element, ".cut-label").textContent).toBe("Memotong jaring 50%");
    expect(q(hud.element, ".cut-ring").style.getPropertyValue("--cut")).toBe("0.500");
    hud.update(state({ tool: "cutter", cutProgress: 0.9 }));
    expect(q(hud.element, ".cut-label").textContent).toBe("Memotong jaring 90%");
    expect(hud.element.classList.contains("cutting")).toBe(true);
  });

  it("empties and hides again the moment the cut stops", () => {
    const hud = createHud("id");
    hud.update(state({ tool: "cutter", cutProgress: 0.7 }));
    hud.update(state({ tool: "cutter", cutProgress: 0 }));
    expect(q(hud.element, ".cut-progress").hidden).toBe(true);
    expect(hud.element.classList.contains("cutting")).toBe(false);
  });

  it("speaks English too", () => {
    const hud = createHud("en");
    hud.update(state({ tool: "cutter", cutProgress: 0.25 }));
    expect(q(hud.element, ".cut-label").textContent).toBe("Cutting the net 25%");
    expect(q(hud.element, ".tool-name").textContent).toBe("1 Cutter");
  });
});

describe("Freed notices and goal (REQ-003 AC-2)", () => {
  function after(lang: "id" | "en", species: "turtle" | "reefShark") {
    const session = new Session(40);
    session.freeAnimal(species);
    const hud = createHud(lang);
    hud.update(state({ score: session.score, cleanliness: session.cleanliness, objectives: session.objectives, notice: session.currentNotice }));
    return hud.element;
  }

  it("says the turtle was freed, with the score, and ticks the goal count", () => {
    const hud = after("id", "turtle");
    expect(q(hud, ".message-notice").textContent).toBe("Penyu hijau dibebaskan! +100");
    expect(q(hud, ".stat-score").textContent).toBe("Skor100");
    expect(q(hud, '[data-goal="free"] .goal-text').textContent).toBe("Bebaskan satwa 1/2");
  });

  it("says the same for the shark, in both languages", () => {
    expect(q(after("id", "reefShark"), ".message-notice").textContent).toBe("Hiu sirip hitam karang dibebaskan! +100");
    expect(q(after("en", "turtle"), ".message-notice").textContent).toBe("Green turtle freed! +100");
    expect(q(after("en", "reefShark"), ".message-notice").textContent).toBe("Blacktip reef shark freed! +100");
    expect(q(after("en", "turtle"), '[data-goal="free"] .goal-text').textContent).toBe("Free the animals 1/2");
  });
});

describe("REQ-003 texts (G-004)", () => {
  it("every new key exists in both languages", () => {
    for (const key of ["tools.cutter", "tools.cutter.hint", "controls.cutter.keys", "controls.cutter.action", "cutter.progress", "animals.turtle.freed", "animals.reefShark.freed"]) {
      expect(idStrings).toHaveProperty(key);
      expect(enStrings).toHaveProperty(key);
    }
  });
});
