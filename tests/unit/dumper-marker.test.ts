import { describe, expect, it } from "vitest";
import type { TouchInput } from "../../src/game/input";
import type { HudState } from "../../src/game/hud-state";
import type { MarkerPlacement } from "../../src/game/marker";
import { Session } from "../../src/game/session";
import { createHud } from "../../src/ui/hud";

// REQ-037: the marker to the dumping boat and the line that says how to turn it over. Where the marker sits on the
// screen (placeMarker, avoidRects) is tested with the station's marker; the real layout is checked in req-037.spec.ts.

const state = (dumper?: HudState["dumper"]): HudState => {
  const session = new Session(40);
  return {
    tool: "vacuum",
    tank: 0,
    capacity: session.capacity,
    tankFull: false,
    score: 0,
    materials: 0,
    cleanliness: 0,
    objectives: session.objectives,
    notice: null,
    inStationZone: false,
    stationDistance: 30,
    marker: { left: 100, top: 200, onScreen: false, angle: 1 },
    sucking: false,
    cutProgress: 0,
    dumper,
  };
};
const beside: MarkerPlacement = { left: 1180, top: 300, onScreen: false, angle: Math.PI / 2 };
const input: TouchInput = { stick() {}, hold() {}, tap() {}, primary() {}, look() {}, click() {} };

describe("the dumping boat's marker (REQ-037 AC-1, AC-2, AC-4)", () => {
  it("shows only while the boat is in the bay with somewhere to point, with a '!' before its name and distance", () => {
    const hud = createHud("id");
    const marker = hud.element.querySelector<HTMLElement>(".dumper-marker")!;
    hud.update(state());
    expect(marker.hidden).toBe(true);
    hud.update(state({ active: true, atBoat: false, marker: beside, distance: 85 }));
    expect(marker.hidden).toBe(false);
    expect(marker.querySelector(".dumper-marker-mark")!.textContent).toBe("!");
    expect(marker.querySelector(".dumper-marker-label")!.textContent).toBe("!Kapal pembuang sampah · 85 m");
    expect(marker.classList.contains("on-screen")).toBe(false);
    expect(marker.querySelector<HTMLElement>(".dumper-marker-arrow")!.style.transform).toBe(`rotate(${(Math.PI / 2).toFixed(3)}rad)`);
    hud.update(state({ active: true, atBoat: false, marker: { left: 600, top: 300, onScreen: true, angle: 0 }, distance: 12 }));
    expect(marker.classList.contains("on-screen")).toBe(true);
    expect(marker.textContent).toContain("· 12 m");
    // Capsized (no longer active), or nothing to point at: gone.
    hud.update(state({ active: false, atBoat: false, marker: beside, distance: 12 }));
    expect(marker.hidden).toBe(true);
    hud.update(state({ active: true, atBoat: false, marker: null, distance: 12 }));
    expect(marker.hidden).toBe(true);
  });

  it("keeps the station marker's classes to the station's marker alone", () => {
    const hud = createHud("id");
    hud.update(state({ active: true, atBoat: false, marker: beside, distance: 85 }));
    for (const selector of [".station-marker", ".marker-label", ".marker-arrow"]) expect(hud.element.querySelectorAll(selector)).toHaveLength(1);
  });

  it("names the boat in English", () => {
    const hud = createHud("en");
    hud.update(state({ active: true, atBoat: false, marker: beside, distance: 40 }));
    expect(hud.element.querySelector(".dumper-marker-label")!.textContent).toBe("!Dumping boat · 40 m");
  });
});

describe("how to turn the dumping boat over, under its goal (REQ-037 AC-5)", () => {
  it("says it with the keyboard and mouse on a computer, and with the touch controls on a phone, only while the boat is there", () => {
    const desktop = createHud("id");
    const alert = desktop.element.querySelector<HTMLElement>(".goal-alert-list")!;
    desktop.update(state({ active: true, atBoat: false, marker: beside, distance: 85 }));
    expect(alert.querySelector(".goal-alert-text")!.textContent).toBe("Balikkan kapal pembuang sampah");
    expect(alert.querySelector(".goal-alert-hint")!.textContent).toBe("Pegang Cutter (1), dekati kapal, bidik lambungnya, lalu tahan klik kiri");
    desktop.update(state());
    expect(alert.hidden).toBe(true);

    const phone = createHud("id", { input, onPause() {}, onLogbook() {}, onMute() {} });
    phone.update(state({ active: true, atBoat: false, marker: beside, distance: 85 }));
    expect(phone.element.querySelector(".goal-alert-hint")!.textContent).toBe("Pilih Cutter, dekati kapal, bidik lambungnya, lalu tahan PAKAI");

    const english = createHud("en", { input, onPause() {}, onLogbook() {}, onMute() {} });
    english.update(state({ active: true, atBoat: false, marker: beside, distance: 85 }));
    expect(english.element.querySelector(".goal-alert-hint")!.textContent).toBe("Pick the Cutter, get close, aim at the hull and hold USE");
  });
});
