import { afterEach, describe, expect, it } from "vitest";
import { config as realConfig } from "../../src/config";
import idStrings from "../../src/i18n/id.json";
import enStrings from "../../src/i18n/en.json";
import { format } from "../../src/i18n/i18n";
import { LOGBOOK_ENTRIES } from "../../src/logbook/entries";
import { missionScreen, missionTexts } from "../../src/ui/mission";

describe("the mission card's texts (REQ-029 AC-2, AC-3, AC-5)", () => {
  it("are the agreed Indonesian texts, with the game's numbers", () => {
    expect(missionTexts("id")).toEqual({
      title: "Misi: Pulihkan Teluk",
      state:
        "Teluk ini keruh dan karangnya memucat. Sekitar 60 sampah berserakan di dasar laut, mengapung di permukaan, dan tergeletak di pantai. Dua jaring hantu menjerat seekor penyu dan seekor hiu karang.",
      list: "Misi",
      missions: [
        "Bersihkan teluk sampai 80%, lalu setor sampahnya di gudang daur ulang di darat.",
        "Potong jaring hantu untuk membebaskan penyu dan hiu karang.",
        "Pasang 3 rangka terumbu, tembakkan fragmen koral ke rangka, dan tanam biji lamun di 2 petak.",
        "Setelah teluk jernih kembali, pindai 7 satwa dan biota untuk Marine Logbook.",
      ],
      dumper: "Sesekali kapal pembuang sampah datang. Balikkan dengan Cutter supaya sampahnya tidak terus bertambah.",
      controls: "WASD bergerak · Mouse mengarahkan · Spasi/Shift naik/turun · Klik kiri pakai alat · 1–4 pilih alat · E berinteraksi",
      closing: "Bisakah kamu memulihkan teluk ini?",
    });
  });

  it("are the agreed English texts, with the game's numbers", () => {
    expect(missionTexts("en")).toEqual({
      title: "Mission: Restore the Bay",
      state:
        "The bay is murky and its corals are bleaching. About 60 pieces of trash lie on the sea floor, float on the surface and litter the beach. Two ghost nets have trapped a turtle and a reef shark.",
      list: "Mission",
      missions: [
        "Clean the bay to 80%, then drop the trash off at the recycling shed on land.",
        "Cut the ghost nets to free the turtle and the reef shark.",
        "Set up 3 reef frames, shoot coral fragments onto them, and plant seagrass seeds in 2 patches.",
        "Once the bay is clear again, scan 7 kinds of sea life for the Marine Logbook.",
      ],
      dumper: "Now and then a boat comes to dump trash. Capsize it with the Cutter before the trash piles up.",
      controls: "WASD move · Mouse steer · Space/Shift up/down · Left click use tool · 1–4 choose tool · E interact",
      closing: "Can you bring this bay back to life?",
    });
  });

  it("carry the numbers as placeholders in the strings, not typed in", () => {
    for (const strings of [idStrings, enStrings]) {
      for (const [key, text] of Object.entries(strings).filter(([k]) => /^mission\.(1|3|4|state)$/.test(k))) {
        expect(text, key).toMatch(/\{\w+\}/);
        expect(text, key).not.toMatch(/\b(60|80|7)\b|\b3 |\b2 /);
      }
    }
  });

  describe("follow the configuration", () => {
    // The configuration is read-only for the game; this test changes it to see the card follow.
    const config = realConfig as unknown as { trash: { count: number }; phase1: { cleanTarget: number; nets: number }; reef: { frames: number; patches: number } };
    const saved = {
      trash: config.trash.count,
      target: config.phase1.cleanTarget,
      nets: config.phase1.nets,
      frames: config.reef.frames,
      patches: config.reef.patches,
    };
    afterEach(() => {
      config.trash.count = saved.trash;
      config.phase1.cleanTarget = saved.target;
      config.phase1.nets = saved.nets;
      config.reef.frames = saved.frames;
      config.reef.patches = saved.patches;
    });

    it("so a changed number changes the card", () => {
      config.trash.count = 45;
      config.phase1.cleanTarget = 70;
      config.phase1.nets = 3;
      config.reef.frames = 4;
      config.reef.patches = 5;
      const id = missionTexts("id");
      expect(id.state).toContain("Sekitar 45 sampah");
      expect(id.state).toContain("Tiga jaring hantu");
      expect(id.missions[0]).toContain("sampai 70%");
      expect(id.missions[2]).toContain("Pasang 4 rangka");
      expect(id.missions[2]).toContain("di 5 petak");
      expect(id.missions[3]).toContain(`pindai ${LOGBOOK_ENTRIES.length} satwa`);
      expect(missionTexts("en").state).toContain("Three ghost nets");
    });
  });
});

describe("format", () => {
  it("fills the placeholders and leaves unknown ones alone", () => {
    expect(format("en", "mission.1", { percent: 75 })).toBe("Clean the bay to 75%, then drop the trash off at the recycling shed on land.");
    expect(format("en", "mission.3", { frames: 1 })).toContain("{patches}");
  });
});

describe("the mission card screen (REQ-029 AC-8)", () => {
  it("has the end screen's panel, a dialog with the title, the four missions in order and the button", () => {
    const element = missionScreen({ lang: "id", notice: null, onStart: () => {} });
    const panel = element.querySelector(".panel.mission")!;
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-label")).toBe("Misi: Pulihkan Teluk");
    expect([...element.querySelectorAll("ol > li")].map((li) => li.textContent)).toEqual(missionTexts("id").missions);
    expect(element.querySelector("button.primary")?.textContent).toBe("Mulai menyelam");
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it("warns of the dumping boat right after the missions (REQ-037 AC-6)", () => {
    const element = missionScreen({ lang: "id", notice: null, onStart: () => {} });
    const warning = element.querySelector(".mission-dumper")!;
    expect(warning.previousElementSibling?.matches("ol.mission-list")).toBe(true);
    expect(warning.textContent).toBe(missionTexts("id").dumper);
  });

  it("shows the notice under the button when there is one", () => {
    const element = missionScreen({ lang: "en", notice: "mission.lockFailed", onStart: () => {} });
    expect(element.querySelector('[role="alert"]')?.textContent).toBe("The game couldn't capture the mouse. Click the button again.");
  });

  it("has no character: no portrait or image (D-114)", () => {
    const element = missionScreen({ lang: "id", notice: null, onStart: () => {} });
    expect(element.querySelector("img, svg, canvas")).toBeNull();
  });
});
