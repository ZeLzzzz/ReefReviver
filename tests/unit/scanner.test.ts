import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { floorHeight, rocks } from "../../src/game/bay";
import { AnimalField } from "../../src/game/animals";
import { ReefField } from "../../src/game/reef-sites";
import { SeaLife } from "../../src/game/sea-life";
import { aimedScanTarget, collectScanTargets, Scanner, type ScanHit, type ScanTarget } from "../../src/game/scanner";
import { Session } from "../../src/game/session";
import { LOGBOOK_ENTRIES, type LogbookId } from "../../src/logbook/entries";

const { scanner } = config;

const hit = (entry: LogbookId, trapped = false): ScanHit => ({ entry, trapped, point: new Vector3() });
const none = new Set<LogbookId>();

/** Holds `seconds` of aim on `target` in steps of 1/30 s; returns every event and the progress after the last step. */
function hold(s: Scanner, target: ScanHit | null, seconds: number, known: ReadonlySet<LogbookId> = none) {
  const events = [];
  for (let i = 0; i < Math.round(seconds * 30); i++) {
    const event = s.update(1 / 30, true, target, known);
    if (event) events.push(event);
  }
  return { events, progress: s.progress };
}

describe("Scanner progress (REQ-006 AC-1, AC-5)", () => {
  it("takes 1.5 seconds on one target to open its entry", () => {
    expect(scanner.seconds).toBe(1.5);
    const s = new Scanner();
    const early = hold(s, hit("clownfish"), 1.4);
    expect(early.events).toEqual([]);
    expect(early.progress).toBeGreaterThan(0.9);
    expect(early.progress).toBeLessThan(1);
    expect(s.update(0.1, true, hit("clownfish"), none)).toEqual({ kind: "scanned", entry: "clownfish" });
    expect(s.progress).toBe(0);
  });

  it("goes back to zero when the aim leaves the target before the end (AC-5)", () => {
    const s = new Scanner();
    hold(s, hit("dolphin"), 1);
    expect(s.progress).toBeGreaterThan(0.6);
    expect(s.update(1 / 30, true, null, none)).toBeNull();
    expect(s.progress).toBe(0);
    // Aiming back starts again from nothing: another second is not enough.
    expect(hold(s, hit("dolphin"), 1).events).toEqual([]);
  });

  it("goes back to zero when the button is let go or the tool is changed", () => {
    const s = new Scanner();
    hold(s, hit("coral"), 1);
    s.update(1 / 30, false, hit("coral"), none);
    expect(s.progress).toBe(0);
    expect(hold(s, hit("coral"), 1).events).toEqual([]);
  });

  it("starts again when the aim moves to another entry", () => {
    const s = new Scanner();
    hold(s, hit("mantaRay"), 1);
    expect(hold(s, hit("dolphin"), 1).events).toEqual([]);
    expect(hold(s, hit("dolphin"), 0.6).events).toEqual([{ kind: "scanned", entry: "dolphin" }]);
  });

  it("keeps the progress when the aim slides from one clownfish to another, which is the same entry", () => {
    const s = new Scanner();
    hold(s, hit("clownfish"), 1);
    expect(hold(s, hit("clownfish"), 0.6).events).toEqual([{ kind: "scanned", entry: "clownfish" }]);
  });

  it("says nothing more about a target it just scanned while the aim stays on it", () => {
    const s = new Scanner();
    const known = new Set<LogbookId>();
    const { events } = hold(s, hit("seagrass"), 1.6);
    expect(events).toEqual([{ kind: "scanned", entry: "seagrass" }]);
    known.add("seagrass");
    expect(hold(s, hit("seagrass"), 2, known).events).toEqual([]);
    expect(s.progress).toBe(0);
  });
});

describe("Scanner on entries already in the Logbook (REQ-006 AC-6)", () => {
  it("says 'known' once when the aim arrives and never fills", () => {
    const s = new Scanner();
    const known = new Set<LogbookId>(["turtle"]);
    const { events, progress } = hold(s, hit("turtle"), 3, known);
    expect(events).toEqual([{ kind: "known" }]);
    expect(progress).toBe(0);
  });

  it("says it again after the aim left and came back", () => {
    const s = new Scanner();
    const known = new Set<LogbookId>(["turtle"]);
    expect(hold(s, hit("turtle"), 0.2, known).events).toHaveLength(1);
    s.update(1 / 30, true, null, known);
    expect(hold(s, hit("turtle"), 0.2, known).events).toHaveLength(1);
  });
});

describe("Scanner on animals still in a net (REQ-006 AC-7)", () => {
  it("says the animal must be freed first and does not scan", () => {
    const s = new Scanner();
    const { events, progress } = hold(s, hit("turtle", true), 3);
    expect(events).toEqual([{ kind: "trapped" }]);
    expect(progress).toBe(0);
  });

  it("scans the same animal normally once it is free", () => {
    const s = new Scanner();
    hold(s, hit("reefShark", true), 0.5);
    s.update(1 / 30, true, null, none);
    expect(hold(s, hit("reefShark"), 1.6).events).toEqual([{ kind: "scanned", entry: "reefShark" }]);
  });
});

describe("scan targets", () => {
  const freeAll = (animals: AnimalField) => animals.animals.forEach((a) => animals.free(a.id, new Vector3()));

  function world() {
    const animals = new AnimalField();
    const reef = new ReefField();
    const sea = new SeaLife();
    sea.start();
    sea.update(config.seaLife.appearSeconds + 1);
    return { animals, reef, sea };
  }
  const targetsOf = ({ animals, reef, sea }: ReturnType<typeof world>) =>
    collectScanTargets(animals.animals, sea.creatures, sea.scale, reef.frames, reef.patches);

  it("lists the turtle and the shark whether trapped or free, with their state", () => {
    const w = world();
    const trapped = targetsOf(w).filter((t) => t.entry === "turtle" || t.entry === "reefShark");
    expect(trapped.map((t) => [t.entry, t.trapped])).toEqual([["turtle", true], ["reefShark", true]]);
    freeAll(w.animals);
    expect(targetsOf(w).filter((t) => t.entry === "turtle" || t.entry === "reefShark").map((t) => t.trapped)).toEqual([false, false]);
  });

  it("lists clownfish, manta rays and dolphins but never the yellowtail (D-038)", () => {
    const w = world();
    const targets = targetsOf(w);
    const wanted = w.sea.creatures.filter((c) => c.scannable);
    expect(wanted.length).toBeGreaterThan(0);
    expect(w.sea.creatures.some((c) => c.species === "yellowtail")).toBe(true);
    expect(targets.filter((t) => t.entry === "clownfish")).toHaveLength(w.sea.creatures.filter((c) => c.species === "clownfish").length);
    expect(targets.filter((t) => t.entry === "mantaRay")).toHaveLength(config.seaLife.mantaRays.length);
    expect(targets.filter((t) => t.entry === "dolphin")).toHaveLength(config.seaLife.dolphins.count);
    expect(targets).toHaveLength(2 + wanted.length);
  });

  it("lists coral only on planted frames and seagrass only on planted patches", () => {
    const w = world();
    expect(targetsOf(w).filter((t) => t.entry === "coral" || t.entry === "seagrass")).toEqual([]);
    w.reef.frames[1].installed = true;
    w.reef.frames[1].fragments = config.reef.fragmentsPerFrame - 1;
    w.reef.patches[0].seeds = config.reef.seedsPerPatch;
    const found = targetsOf(w).filter((t) => t.entry === "coral" || t.entry === "seagrass");
    // REQ-019: a planted patch is a sphere around its sprouts and the ground under them.
    expect(found.map((t) => t.entry)).toEqual(["seagrass", "seagrass"]);
    expect(found.map((t) => Boolean(t.flat))).toEqual([false, true]);
    w.reef.frames[1].fragments = config.reef.fragmentsPerFrame;
    expect(targetsOf(w).filter((t) => t.entry === "coral")).toHaveLength(1);
  });

  it("scans a planted patch in the shallows from straight above it, where the camera is inside its sphere (REQ-019)", () => {
    const w = world();
    const patch = w.reef.patches[0];
    patch.seeds = config.reef.seedsPerPatch;
    // The sub low over the patch, its camera 1 m above the sprouts: inside the patch's sphere.
    const eye = new Vector3(patch.x, patch.y + scanner.seagrassHeight + 1, patch.z);
    const rov = new Vector3(patch.x, patch.y + 2, patch.z - 2);
    const hitAbove = aimedScanTarget(eye, new Vector3(0, -1, 0), rov, targetsOf(w));
    expect(hitAbove?.entry).toBe("seagrass");
    // Without the ground target, the sphere alone is not hit from there.
    const spheres = targetsOf(w).filter((t) => !t.flat && t.entry === "seagrass");
    expect(aimedScanTarget(eye, new Vector3(0, -1, 0), rov, spheres)).toBeNull();
  });

  it("has no sea life as a target until it has appeared, and a smaller one while it grows in", () => {
    const animals = new AnimalField();
    const reef = new ReefField();
    const sea = new SeaLife();
    const count = () => collectScanTargets(animals.animals, sea.creatures, sea.scale, reef.frames, reef.patches).length;
    expect(count()).toBe(2);
    sea.start();
    sea.update(config.seaLife.appearSeconds / 2);
    const growing = collectScanTargets(animals.animals, sea.creatures, sea.scale, reef.frames, reef.patches).find((t) => t.entry === "dolphin")!;
    expect(growing.r).toBeLessThan(scanner.radius.dolphin);
    expect(growing.r).toBeGreaterThan(0);
    sea.update(config.seaLife.appearSeconds);
    expect(collectScanTargets(animals.animals, sea.creatures, sea.scale, reef.frames, reef.patches).find((t) => t.entry === "dolphin")!.r).toBe(scanner.radius.dolphin);
  });

  it("covers every Logbook entry", () => {
    const w = world();
    freeAll(w.animals);
    w.reef.frames.forEach((f) => Object.assign(f, { installed: true, fragments: config.reef.fragmentsPerFrame }));
    w.reef.patches.forEach((p) => (p.seeds = config.reef.seedsPerPatch));
    const entries = new Set(targetsOf(w).map((t) => t.entry));
    expect([...entries].sort()).toEqual(LOGBOOK_ENTRIES.map((e) => e.id).sort());
  });
});

describe("aiming at a target", () => {
  const sphere = (x: number, y: number, z: number, r: number, entry: LogbookId = "dolphin", trapped = false): ScanTarget => ({ x, y, z, r, entry, trapped });
  const origin = new Vector3(0, -5, 20);
  const forward = new Vector3(0, 0, -1);
  const rovAt = (z: number) => new Vector3(0, -5, z);

  it("hits a sphere on the ray, within range of the ROV", () => {
    const found = aimedScanTarget(origin, forward, rovAt(26), [sphere(0, -5, 12, 1)]);
    expect(found).toMatchObject({ entry: "dolphin", trapped: false });
    expect(found!.point.z).toBeCloseTo(13, 5);
  });

  it("misses a sphere beside the ray", () => {
    expect(aimedScanTarget(origin, forward, rovAt(26), [sphere(2, -5, 12, 1)])).toBeNull();
  });

  it("misses a target further than the range from the ROV", () => {
    const far = sphere(0, -5, 20 - scanner.range - 5, 1);
    expect(aimedScanTarget(origin, forward, origin, [far])).toBeNull();
    const near = sphere(0, -5, 20 - scanner.range + 3, 1);
    expect(aimedScanTarget(origin, forward, origin, [near])).not.toBeNull();
  });

  it("takes the nearest target, so something in front hides what is behind it", () => {
    const found = aimedScanTarget(origin, forward, rovAt(26), [sphere(0, -5, 8, 1, "mantaRay"), sphere(0, -5, 14, 1, "clownfish")]);
    expect(found!.entry).toBe("clownfish");
  });

  it("reports a trapped animal as trapped", () => {
    expect(aimedScanTarget(origin, forward, rovAt(26), [sphere(0, -5, 12, 1, "turtle", true)])).toMatchObject({ entry: "turtle", trapped: true });
  });

  it("returns nothing when there is no target", () => {
    expect(aimedScanTarget(origin, forward, rovAt(26), [])).toBeNull();
  });

  it("does not see through a rock or the floor", () => {
    // A rock with open water around it at its height, so only the rock itself can be in the way.
    const rock = rocks.find((r) =>
      [[0, 4], [0, -4], [r.size + 6, -4]].every(([dx, dz]) => floorHeight(r.x + dx, r.z + dz) < r.y + r.height * 0.4 - 1),
    )!;
    expect(rock).toBeDefined();
    const above = new Vector3(rock.x, rock.y + rock.height * 0.4, rock.z);
    // The target lies 4 m behind the rock's centre, the ray comes from 4 m in front of it, at the rock's height.
    const start = new Vector3(rock.x, above.y, rock.z + 4);
    const behind = sphere(rock.x, above.y, rock.z - 4, 0.8);
    expect(aimedScanTarget(start, new Vector3(0, 0, -1), start, [behind])).toBeNull();
    // From the side the same target is in plain view.
    const side = new Vector3(rock.x + rock.size + 6, above.y, rock.z - 4);
    expect(aimedScanTarget(side, new Vector3(-1, 0, 0), side, [behind])).not.toBeNull();

    // A target half under the floor, seen from above: the ray meets the floor before the sphere.
    const x = 5;
    const z = 5;
    const low = new Vector3(x, floorHeight(x, z) + 1, z - 3);
    const toward = (centre: Vector3) => centre.clone().sub(low).normalize();
    const buried = new Vector3(x, floorHeight(x, z) - 0.3, z);
    expect(aimedScanTarget(low, toward(buried), low, [sphere(buried.x, buried.y, buried.z, 0.5)])).toBeNull();
    const raised = new Vector3(x, floorHeight(x, z) + 1.7, z);
    expect(aimedScanTarget(low, toward(raised), low, [sphere(raised.x, raised.y, raised.z, 0.5)])).not.toBeNull();
  });
});

describe("Session and the scanner (REQ-006 AC-1, AC-4, AC-6, AC-7)", () => {
  const session = () => new Session(config.trash.count);

  it("opening an entry adds it, counts it in 'Pindai x/7' and announces it (AC-1)", () => {
    const s = session();
    s.openScanner();
    expect(s.phase3Objectives[0]).toMatchObject({ id: "scan", current: 0, target: 7, done: false });
    s.scanned({ kind: "scanned", entry: "turtle" });
    expect(s.entriesScanned).toBe(1);
    expect(s.unlocked.has("turtle")).toBe(true);
    expect(s.currentNotice).toEqual({ key: "scanner.newEntry", entry: "turtle" });
    expect(s.phase3Objectives[0]).toMatchObject({ current: 1, target: 7, done: false });
  });

  it("an entry that is already recorded says so and the count stays (AC-6)", () => {
    const s = session();
    s.openScanner();
    s.scanned({ kind: "scanned", entry: "coral" });
    s.scanned({ kind: "known" });
    expect(s.currentNotice).toEqual({ key: "scanner.known" });
    expect(s.entriesScanned).toBe(1);
  });

  it("a trapped animal gives the message and no entry (AC-7)", () => {
    const s = session();
    s.openScanner();
    s.scanned({ kind: "trapped" });
    expect(s.currentNotice).toEqual({ key: "scanner.trapped" });
    expect(s.entriesScanned).toBe(0);
  });

  it("the Scanner cannot be selected before the Bloom: a message, and the tool stays (AC-4)", () => {
    const s = session();
    s.select("scanner");
    expect(s.tool).toBe("vacuum");
    expect(s.currentNotice).toEqual({ key: "scanner.locked" });
    s.select("cutter");
    s.select("scanner");
    expect(s.tool).toBe("cutter");
  });

  it("the Scanner can be selected once the Bloom is over", () => {
    const s = session();
    s.openScanner();
    s.select("scanner");
    expect(s.tool).toBe("scanner");
  });

  it("knows when all seven are scanned, for the end screen (REQ-008)", () => {
    const s = session();
    s.openScanner();
    expect(s.allScanned).toBe(false);
    for (const entry of LOGBOOK_ENTRIES) s.scanned({ kind: "scanned", entry: entry.id });
    expect(s.allScanned).toBe(true);
    expect(s.entriesScanned).toBe(7);
    expect(s.phase3Objectives[0].done).toBe(true);
  });
});
