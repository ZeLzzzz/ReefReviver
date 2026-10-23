import { describe, expect, it, vi } from "vitest";
import { config } from "../../src/config";
import { Session, type SessionSummary } from "../../src/game/session";
import { LOGBOOK_ENTRIES } from "../../src/logbook/entries";
import { endScreen, formatPlayTime } from "../../src/ui/end";

const { end, phase1, reef } = config;

function session() {
  return new Session(config.trash.count);
}

/** Scans every Logbook entry, the last one included. */
function scanAll(s: Session) {
  for (const entry of LOGBOOK_ENTRIES) s.scanned({ kind: "scanned", entry: entry.id });
}

/** Steps the end timer in frames of `dt` for `seconds`; returns how many times it said the end is due. */
function step(s: Session, seconds: number, dt = 1 / 60) {
  let due = 0;
  for (let t = 0; t < seconds; t += dt) if (s.endDue(dt)) due++;
  return due;
}

describe("the end follows the 7th entry (REQ-008 AC-1)", () => {
  it("is not due while an entry is still missing", () => {
    const s = session();
    for (const entry of LOGBOOK_ENTRIES.slice(1)) s.scanned({ kind: "scanned", entry: entry.id });
    expect(step(s, 10)).toBe(0);
  });

  it("is due once, after the new entry's notice has had its time", () => {
    const s = session();
    scanAll(s);
    expect(s.currentNotice).toEqual({ key: "scanner.newEntry", entry: LOGBOOK_ENTRIES.at(-1)!.id });
    expect(end.delay).toBeGreaterThanOrEqual(config.hud.noticeSeconds);
    expect(step(s, end.delay - 0.1)).toBe(0);
    expect(step(s, 0.2)).toBe(1);
    expect(step(s, 30)).toBe(0);
  });

  it("is due again in a new session", () => {
    const first = session();
    scanAll(first);
    step(first, end.delay + 1);
    const next = session();
    scanAll(next);
    expect(step(next, end.delay + 1)).toBe(1);
  });
});

describe("play time (REQ-008 AC-4)", () => {
  it("adds up the time the game reports while playing", () => {
    const s = session();
    expect(s.playSeconds).toBe(0);
    s.addPlayTime(1.25);
    s.addPlayTime(0.75);
    expect(s.playSeconds).toBe(2);
  });

  it("stops at the 7th entry, so exploring afterwards does not count", () => {
    const s = session();
    s.addPlayTime(100);
    scanAll(s);
    s.addPlayTime(50);
    expect(s.playSeconds).toBe(100);
  });

  it("is written as minutes and seconds", () => {
    expect(formatPlayTime(0)).toBe("0:00");
    expect(formatPlayTime(9.9)).toBe("0:09");
    expect(formatPlayTime(75.4)).toBe("1:15");
    expect(formatPlayTime(600)).toBe("10:00");
    expect(formatPlayTime(3725)).toBe("62:05");
  });
});

describe("summary (REQ-008 AC-2)", () => {
  it("holds the numbers of the session", () => {
    const s = session();
    for (let i = 0; i < 5; i++) s.collect();
    s.freeAnimal("turtle");
    s.coralAttached(true);
    s.seedPlanted(true);
    s.addPlayTime(321);
    expect(s.summary()).toEqual({
      trashRemoved: 5,
      trashTotal: config.trash.count,
      animalsFreed: 1,
      animalsTotal: phase1.animals,
      framesPlanted: 1,
      framesTotal: reef.frames,
      patchesPlanted: 1,
      patchesTotal: reef.patches,
      seconds: 321,
      score: s.score,
    });
  });
});

const summary: SessionSummary = {
  trashRemoved: 36,
  trashTotal: 40,
  animalsFreed: 2,
  animalsTotal: 2,
  framesPlanted: 3,
  framesTotal: 3,
  patchesPlanted: 2,
  patchesTotal: 2,
  seconds: 487.6,
  score: 810,
};

const rows = (el: HTMLElement) =>
  [...el.querySelectorAll(".end-stats > div")].map((row) => [row.querySelector("dt")!.textContent, row.querySelector("dd")!.textContent]);

describe("end screen (REQ-008 AC-2, AC-3, AC-5)", () => {
  it("shows the session's numbers, in Indonesian", () => {
    const el = endScreen({ lang: "id", summary, notice: null, onReplay: () => {}, onExplore: () => {} });
    expect(el.querySelector("h1")?.textContent).toBe("Teluk sudah pulih!");
    expect(rows(el)).toEqual([
      ["Sampah terangkat", "36/40"],
      ["Satwa diselamatkan", "2/2"],
      ["Rangka koral ditanami", "3/3"],
      ["Petak lamun ditanami", "2/2"],
      ["Waktu bermain", "8:07"],
      ["Skor", "810"],
    ]);
    expect([...el.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Main lagi", "Lanjut menjelajah"]);
  });

  it("is in English when English is chosen", () => {
    const el = endScreen({ lang: "en", summary, notice: null, onReplay: () => {}, onExplore: () => {} });
    expect(el.querySelector("h1")?.textContent).toBe("The bay is healthy again!");
    expect(rows(el).map(([label]) => label)).toEqual(["Trash removed", "Animals rescued", "Coral frames planted", "Seagrass patches planted", "Play time", "Score"]);
    expect([...el.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Play again", "Keep exploring"]);
  });

  it("calls back on each button, and shows a notice when there is one", () => {
    const onReplay = vi.fn();
    const onExplore = vi.fn();
    const el = endScreen({ lang: "id", summary, notice: "end.lockFailed", onReplay, onExplore });
    const [replay, explore] = el.querySelectorAll("button");
    replay.click();
    explore.click();
    expect(onReplay).toHaveBeenCalledOnce();
    expect(onExplore).toHaveBeenCalledOnce();
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("Kursor belum terkunci ke game. Klik tombolnya lagi.");
  });
});
