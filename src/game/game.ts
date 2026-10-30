import {
  AdditiveBlending,
  Box3,
  ConeGeometry,
  type Color,
  DirectionalLight,
  type Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { silentAudio, type GameAudio } from "../audio/types";
import { config } from "../config";
import { LOGBOOK_ENTRIES, type LogbookId } from "../logbook/entries";
import { atDiveEdge, rocks, setFrameColumns } from "./bay";
import { Bloom } from "./bloom";
import { caveInfo, caveLamp, caveLevel } from "./cave";
import { BloomShot, Cinematic, EndingShot, beachGroup, cinematicsOnByDefault, createPose, floorGroup, openingPlan, patchReefs, seaFloorTrash, type CinematicHud, type CinematicKind } from "./cinematic";
import { createCaveView } from "./cave-model";
import { aimDirection, followCamera, keepCameraInWater, viewAbove } from "./follow-camera";
import type { HudState } from "./hud-state";
import { Input, type TouchInput } from "./input";
import { terrainBlocks } from "./cutter";
import { createCutterBeam, placeCutterBeam } from "./net-model";
import { placeMarker, type MarkerPlacement } from "./marker";
import { buildMinimap } from "./minimap";
import { chooseLayout, type Layout } from "./layout";
import { createReefView, createShotView } from "./reef-model";
import { framePlanted, patchPlanted, ReefField } from "./reef-sites";
import { aimedScanTarget, collectScanTargets, Scanner, type ScanHit } from "./scanner";
import { SeaLife } from "./sea-life";
import { createSeaLifeView } from "./sea-life-model";
import { naturalTargets } from "./nature";
import { createNatureView } from "./nature-model";
import { createRovModel, setHeadlight, updateRovPropellers } from "./rov-model";
import { Dumper } from "./dumper";
import { createDumperView } from "./dumper-model";
import { FLOAT_Y, constrainRov, createRovState, rightVector, steer, stepRov, surfaceBob, type Bob, type RovState } from "./rov";
import { ashoreSpot, canBoard, createWalker, eyePosition, lookWalker, onDock, standable, stepWalker, type AshoreSpot, type Walker } from "./land";
import { Rescue } from "./rescue";
import { findAimPoint, SeedLauncher } from "./seed-launcher";
import { Session, type SessionSummary } from "./session";
import { counterPosition, distanceToStation, inStationZone, stationPosition } from "./station";
import { buildDockMesh, createStationModel, STATION_MARKER_HEIGHT } from "./station-model";
import { toolForKey } from "./tools";
import { TrashField, aimedBeachItem, floatingTrash, type TrashItem } from "./trash";
import { createTrashView } from "./trash-model";
import { inVacuumCone, pickNearestInCone } from "./vacuum";
import { buildWorld, type World } from "./world";

/** What the app shell needs from the game. */
export interface GameView {
  /** Starts a new dive from the start position. */
  play(): void;
  /** Freezes the game; nothing moves until resume(). */
  pause(): void;
  resume(): void;
  /** The HUD listens here; it gets the state once per frame while playing. */
  onHud(listener: (state: HudState) => void): void;
  /** REQ-008: called once per dive, a moment after the 7th Logbook entry is scanned (REQ-028: after the ending cinematic). */
  onEnd(listener: (summary: SessionSummary) => void): void;
  /** REQ-027, REQ-028: what the cinematic that is playing shows, or null when none is; the app keeps the Logbook shut meanwhile (AC-4). */
  cinematic?(): CinematicHud | null;
  /** REQ-029: called when the opening cinematic ends or is skipped; the app then shows the mission card over the stopped game. */
  onOpeningEnd?(listener: () => void): void;
  /** REQ-030: where the touch controls send the joystick, the drags and the buttons. */
  touchInput?(): TouchInput;
}

export interface GameOptions {
  /** REQ-030 AC-7: a phone or tablet, drawn with fewer pixels and without antialiasing. */
  touch?: boolean;
}

type Mode = "title" | "playing" | "paused";

/**
 * REQ-012: the seed of the first dive's layout; each new dive takes the next. The browser tests set VITE_TEST_SEED so
 * their dives are the same every run; otherwise every dive is new. The player cannot choose it.
 */
const TEST_SEED = import.meta.env.DEV && import.meta.env.VITE_TEST_SEED ? Number(import.meta.env.VITE_TEST_SEED) : null;

/** A faint cone from the ROV along the aim, shown while the vacuum is pulling. Apex at the origin, base toward +Z. */
function createVacuumBeam(): Mesh {
  const { range, coneHalfAngle } = config.vacuum;
  const geometry = new ConeGeometry(range * Math.tan(coneHalfAngle), range, 20, 1, true);
  geometry.translate(0, -range / 2, 0);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.06, blending: AdditiveBlending, depthWrite: false });
  const beam = new Mesh(geometry, material);
  beam.visible = false;
  beam.frustumCulled = false;
  return beam;
}

/** A thin cyan line from the ROV to the target the scanner works on (REQ-006). */
function createScanBeam(): Mesh {
  const beam = createCutterBeam();
  (beam.material as MeshBasicMaterial).color.setHex(0x6ff2ff);
  return beam;
}

export class Game implements GameView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(config.camera.fov, 1, 0.1, config.camera.far);
  private readonly cameraTarget = new Vector3();
  private readonly rovModel = createRovModel();
  // REQ-014: the cave's rock and light shaft, how dark the water is around the camera (0..1, eased), and the lamp.
  private readonly caveView = createCaveView();
  private caveDark = 0;
  private above = false;
  private aboveFlips = 0;
  private readonly bob: Bob = { lift: 0, roll: 0, pitch: 0 };
  private lampLit = false;
  private lampLevel = 0;
  private readonly world: World;
  private readonly input: Input;
  private readonly field = new TrashField();
  private readonly trashView = createTrashView(this.field.items);
  /** REQ-025 AC-8: the items that lie on the floor or the sand; the ones floating at the surface never hide a net from the cutter. */
  private readonly floorItems = this.field.items.filter((item) => !item.floating);
  private readonly beam = createVacuumBeam();
  // REQ-003: ghost nets, trapped animals, the cutter.
  private readonly rescue = new Rescue();
  private readonly aim = new Vector3();
  private readonly stationAnchor = new Vector3(stationPosition.x, stationPosition.y + STATION_MARKER_HEIGHT, stationPosition.z);
  private readonly viewPoint = new Vector3();
  // REQ-037: the dumping boat's marker points a little above the boat.
  private readonly dumperAnchor = new Vector3();
  private readonly dumperViewPoint = new Vector3();
  // REQ-004: reef sites, frames, coral and seagrass, and the seed launcher.
  private readonly reef = new ReefField();
  private reefView = createReefView(this.reef);
  private dives = 0;
  private readonly seeds = new SeedLauncher();
  private readonly seedView = createShotView();
  private readonly seedCamera = new Vector3();
  private readonly seedCameraTarget = new Vector3();
  private readonly seedTarget = new Vector3();
  // REQ-005: the Bloom's clock and the sea life that returns with it.
  private readonly bloom = new Bloom();
  private readonly seaLife = new SeaLife();
  private readonly seaLifeView = createSeaLifeView(this.seaLife);
  // REQ-013: the natural coral, seagrass meadows, decoration and the light rays.
  private readonly natureView = createNatureView();
  private bloomShown = 0;
  // REQ-006: the Scanner, its beam and the camera ray it aims along.
  private readonly scanner = new Scanner();
  private readonly scanBeam = createScanBeam();
  private readonly scanCamera = new Vector3();
  private readonly scanLookAt = new Vector3();
  private readonly scanNose = new Vector3();
  private scanHit: ScanHit | null = null;
  private session = new Session(this.field.total);
  private hudListener: ((state: HudState) => void) | null = null;
  private endListener: ((summary: SessionSummary) => void) | null = null;
  private openingEndListener: (() => void) | null = null;
  private lastHud: HudState | null = null;
  private sucking = false;
  /** REQ-035: ship horns played since the page opened (for the tests). */
  private horns = 0;
  /** REQ-036: the boat that comes to dump trash in the bay, and its model with the crew. */
  private readonly dumper = new Dumper();
  private readonly dumperView = createDumperView();
  /** REQ-026: the vacuum button was held last frame (a press on a full tank sounds the buzzer), and how far the player has walked since the last footstep. */
  private vacuumHeld = false;
  private stride = 0;
  private rov: RovState = createRovState();
  // REQ-015: on foot on the land, with the submarine floating where it was left (D-080); null while aboard.
  private ashore: { walker: Walker; sub: Vector3 } | null = null;
  /** REQ-022: the submarine is at the dive area's edge, so its message has been shown. */
  private atEdge = false;
  // The fade while getting out or in: the switch happens at its darkest point, halfway (D-084).
  private transition: { time: number; switched: boolean; to: "land" | "sub"; spot: AshoreSpot | null } | null = null;
  private readonly eye = new Vector3();
  private readonly lookAhead = new Vector3();
  // REQ-027, REQ-028: the cinematic that is playing (null when none), the camera paths it flies, whether the opening has
  // played since the page opened (D-021: nothing is saved, so a refresh starts over) and whether cinematics play at all.
  private cine: Cinematic | null = null;
  private openingShot: ReturnType<typeof openingPlan> | null = null;
  private bloomShot: BloomShot | null = null;
  private endingShot: EndingShot | null = null;
  private cinematicsOn = cinematicsOnByDefault(import.meta.env.DEV, import.meta.env.VITE_TEST_SEED);
  private openingPlayed = false;
  /** The screen coming up from black: after the opening begins and after a skip (seconds gone, seconds in all). */
  private fade: { time: number; total: number } | null = null;
  private readonly shotPose = createPose();
  private readonly normalPose = createPose();
  private readonly focus = new Vector3();
  private mode: Mode = "title";
  private titleTime = 0;
  private lastFrame: number | null = null;

  constructor(canvas: HTMLCanvasElement, context: WebGL2RenderingContext, private readonly audio: GameAudio = silentAudio, options: GameOptions = {}) {
    const { touch } = config;
    this.renderer = new WebGLRenderer({ canvas, context, antialias: options.touch ? touch.antialias : true });
    this.renderer.setPixelRatio(options.touch ? touch.pixelRatio : Math.min(window.devicePixelRatio, 2));
    this.world = buildWorld(this.scene);
    this.scene.add(this.rovModel, createStationModel(), buildDockMesh(), this.trashView.group, this.beam, this.rescue.group, this.scanBeam);
    this.trashView.sync(this.field.items);
    this.natureView.setTrash(this.floorHomes()); // REQ-021 AC-6
    this.world.beach.setTrash(this.field.items.filter((item) => item.onBeach).map((item) => item.home));
    this.scene.add(this.reefView.group, this.seedView.group, this.seaLifeView.group, this.natureView.group, this.dumperView.group);
    this.scene.add(this.caveView.group);
    this.reefView.sync(this.reef);
    this.input = new Input(canvas.ownerDocument);
    this.syncRovModel();

    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.renderer.setAnimationLoop((time) => this.frame(time));

    if (import.meta.env.DEV) {
      // Lets the end-to-end tests read the game state; stripped from production builds.
      (window as unknown as Record<string, unknown>).__reef = {
        mode: () => this.mode,
        rovPosition: () => this.rov.position.toArray(),
        rovYaw: () => this.rov.yaw,
        hud: () => this.lastHud,
        // Free trash only: where it lies, for tests that fly to it.
        trash: () => this.field.items.filter((i) => i.state === "free").map((i) => i.position.toArray()),
        // REQ-017: the free items on the beach (they are in trash() too, but aimAtTrash and the vacuum leave them out), and
        // a way to stand `distance` m from the `index`th of them, looking at it.
        beachTrash: () => this.field.items.filter((i) => i.state === "free" && i.onBeach).map((i) => i.position.toArray()),
        beachTotal: () => this.field.items.filter((i) => i.onBeach).length,
        // REQ-025: the bottles and bags floating at the surface (free ones' positions, all of them counted, their kinds and
        // states), the height of each one's model, and a way to put the submarine `distance` m from the nearest free one,
        // aimed at it, floating or `below` m deeper; with `alone`, only from where no other free floating item (oil
        // included) is in the vacuum's cone; with `oil`, the same for the nearest oil slick (REQ-038).
        surfaceTrash: () => this.field.items.filter((i) => i.state === "free" && floatingTrash(i)).map((i) => i.position.toArray()),
        surfaceTotal: () => this.field.items.filter(floatingTrash).length,
        surfaceKinds: () => this.field.items.filter(floatingTrash).map((i) => i.kind),
        surfaceModels: () => this.trashView.group.children.filter((_, id) => floatingTrash(this.field.items[id])).map((model) => model.position.toArray()),
        // REQ-038: the oil slicks (every one, with its state and where it is now) and their models' heights and sizes.
        oil: () => this.field.items.filter((i) => i.kind === "oil").map((i) => ({ id: i.id, state: i.state, position: i.position.toArray(), home: i.home.toArray() })),
        oilModels: () =>
          this.trashView.group.children
            .filter((_, id) => this.field.items[id]?.kind === "oil")
            .map((model) => {
              const size = new Box3().setFromObject(model).getSize(new Vector3());
              return { y: model.position.y, tilt: Math.hypot(model.rotation.x, model.rotation.z), width: Math.max(size.x, size.z), visible: model.visible };
            }),
        // Where a point shows on the screen in CSS pixels from the top left, or null when it is behind the camera.
        screenOf: (x: number, y: number, z: number) => {
          const p = new Vector3(x, y, z).project(this.camera);
          if (Math.abs(p.z) > 1) return null;
          const { clientWidth, clientHeight } = this.renderer.domElement;
          return [((p.x + 1) / 2) * clientWidth, ((1 - p.y) / 2) * clientHeight];
        },
        // Takes every free floating item out of the field, counted as removed like removeTrash (no tank, no score).
        removeSurfaceTrash: () => {
          let removed = 0;
          for (const item of this.field.items) {
            if (!item.floating || item.state !== "free") continue;
            item.state = "collected";
            this.session.trashRemoved += 1;
            removed += 1;
          }
          this.trashView.sync(this.field.items);
          return removed;
        },
        aimAtSurfaceTrash: (distance = 3, below = 0, alone = false, oil = false) => {
          const free = this.field.items.filter((i) => i.state === "free" && i.floating);
          free.sort((a, b) => a.position.distanceTo(this.rov.position) - b.position.distanceTo(this.rov.position));
          const targets = free.filter((i) => (i.kind === "oil") === oil);
          const from = new Vector3();
          const aim = new Vector3();
          for (const item of targets) {
            for (let k = 0; k < 16; k++) {
              const yaw = (k / 16) * Math.PI * 2;
              from.set(item.position.x - Math.sin(yaw) * distance, FLOAT_Y - below, item.position.z - Math.cos(yaw) * distance);
              const probe = from.clone();
              constrainRov(probe, new Vector3());
              if (probe.distanceTo(from) > 1e-6) continue;
              const pitch = Math.atan2(item.position.y - from.y, distance);
              aimDirection(yaw, pitch, aim);
              // The group lies close together: within the vacuum's range, take a direction from which it would pick this very item.
              if (distance <= config.vacuum.range && pickNearestInCone(from, aim, free.map((other) => other.position)) !== free.indexOf(item)) continue;
              if (alone && free.some((other) => other !== item && inVacuumCone(from, aim, other.position))) continue;
              this.rov.position.copy(from);
              this.rov.velocity.set(0, 0, 0);
              this.rov.yaw = yaw;
              this.rov.pitch = pitch;
              return item.position.toArray();
            }
          }
          return null;
        },
        beachStates: () => this.field.items.filter((i) => i.onBeach).map((i) => i.state),
        aimAtBeachTrash: (distance = 2, index = 0) => {
          if (!this.ashore) return null;
          const { walker } = this.ashore;
          const free = this.field.items.filter((i) => i.state === "free" && i.onBeach);
          const item = free[index];
          if (!item) return null;
          // From the sea side or from the side, whichever is standable, with the crosshair on the item.
          for (let k = 0; k < 16; k++) {
            const yaw = -Math.PI / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8);
            const x = item.position.x - Math.sin(yaw) * distance;
            const z = item.position.z - Math.cos(yaw) * distance;
            if (!standable(x, z)) continue;
            walker.position.set(x, 0, z);
            stepWalker(walker, { forward: 0, strafe: 0, rise: 0 }, 0);
            walker.yaw = yaw;
            const eye = eyePosition(walker);
            walker.pitch = Math.atan2(item.position.y - eye.y, distance);
            return item.position.toArray();
          }
          return null;
        },
        trashTotal: () => this.field.total,
        rocks: () => rocks.map((r) => [r.x, r.y, r.z, r.size]),
        station: () => [stationPosition.x, stationPosition.y, stationPosition.z],
        // REQ-016: the middle of the counter's zone, in front of the shed.
        counter: () => [counterPosition.x, counterPosition.z],
        // REQ-003: where the nets and animals are, and a clock of simulated seconds.
        clock: () => this.rescue.animals.elapsed,
        nets: () => this.rescue.nets.nets.map((n) => ({ id: n.id, species: n.species, cut: n.cut, center: n.center.toArray(), yaw: n.yaw, size: [n.width, n.height, n.length] })),
        animals: () => this.rescue.animals.animals.map((a) => ({ id: a.id, species: a.species, state: a.state, position: a.position.toArray(), yaw: a.yaw })),
        // REQ-004: the reef sites and their progress, and a way to give materials without depositing trash.
        reefSites: () => ({
          frames: this.reef.frames.map((f) => ({ x: f.x, y: f.y, z: f.z, installed: f.installed, fragments: f.fragments })),
          patches: this.reef.patches.map((p) => ({ x: p.x, y: p.y, z: p.z, seeds: p.seeds })),
        }),
        giveMaterials: (n: number) => {
          this.session.materials += n;
        },
        placeRov: (x: number, y: number, z: number, yaw: number, pitch: number) => {
          this.rov.position.set(x, y, z);
          this.rov.velocity.set(0, 0, 0);
          this.rov.yaw = yaw;
          this.rov.pitch = pitch;
        },
        // REQ-011: whether the ROV fits at a point (in open water, out of the terrain and the rocks).
        fits: (x: number, y: number, z: number) => {
          const probe = new Vector3(x, y, z);
          constrainRov(probe, new Vector3());
          return probe.distanceTo(new Vector3(x, y, z)) < 1e-6;
        },
        // REQ-012: the sites move every dive, so tests aim at them from whichever side is clear. Puts the ROV `distance`
        // m from (x, y, z) and `rise` m above it, so the crosshair ray (from the camera as it really is) passes through the
        // point with nothing in the way up to `clearance` m before it (the size of the thing aimed at). Returns false if no
        // side works.
        aimAtPoint: (x: number, y: number, z: number, distance = 9, rise = 0, clearance = 0.6) => {
          const target = new Vector3(x, y, z);
          const camera = new Vector3();
          const ahead = new Vector3();
          const aim = new Vector3();
          for (let k = 0; k < 24; k++) {
            const yaw = Math.PI + (k / 24) * Math.PI * 2;
            const at = new Vector3(x - Math.sin(yaw) * distance, y + rise, z - Math.cos(yaw) * distance);
            const probe = at.clone();
            constrainRov(probe, new Vector3());
            if (probe.distanceTo(at) > 1e-6) continue;
            let best: number | null = null;
            let bestError = Infinity;
            for (let pitch = -1.0; pitch <= 0.6; pitch += 0.004) {
              followCamera({ position: at, velocity: new Vector3(), yaw, pitch }, camera, ahead);
              aimDirection(yaw, pitch, aim);
              const toTarget = target.clone().sub(camera);
              const along = toTarget.dot(aim);
              if (along <= 0) continue;
              const error = toTarget.addScaledVector(aim, -along).length();
              if (error < bestError) {
                bestError = error;
                best = pitch;
              }
            }
            if (best === null || bestError > 0.2) continue;
            followCamera({ position: at, velocity: new Vector3(), yaw, pitch: best }, camera, ahead);
            const toTarget = target.clone().sub(camera);
            if (terrainBlocks(camera, toTarget.clone().normalize(), toTarget.length() - clearance)) continue;
            this.rov.position.copy(at);
            this.rov.velocity.set(0, 0, 0);
            this.rov.yaw = yaw;
            this.rov.pitch = best;
            return true;
          }
          return false;
        },
        // The trash lies in groups (D-066): puts the ROV `distance` m from the nearest free item that can be approached
        // with no other item in or near the vacuum's cone, aimed straight at it. Returns the item's position, or null.
        aimAtTrash: (distance = 3) => {
          // REQ-025: the ones lying on the floor; aimAtSurfaceTrash does the floating ones.
          const free = this.field.items.filter((i) => i.state === "free" && !i.onBeach && !i.floating);
          free.sort((a, b) => a.position.distanceTo(this.rov.position) - b.position.distanceTo(this.rov.position));
          const from = new Vector3();
          const aim = new Vector3();
          for (const item of free) {
            for (let k = 0; k < 16; k++) {
              const yaw = (k / 16) * Math.PI * 2;
              from.set(item.position.x - Math.sin(yaw) * distance, item.position.y + 1, item.position.z - Math.cos(yaw) * distance);
              const probe = from.clone();
              constrainRov(probe, new Vector3());
              if (probe.distanceTo(from) > 1e-6) continue;
              const pitch = Math.atan2(-1, distance);
              aimDirection(yaw, pitch, aim);
              const crowded = free.some((other) => {
                if (other === item) return false;
                const offset = other.position.clone().sub(from);
                return offset.length() < config.vacuum.range + 2 && offset.normalize().dot(aim) > Math.cos(config.vacuum.coneHalfAngle + 0.25);
              });
              if (crowded) continue;
              this.rov.position.copy(from);
              this.rov.velocity.set(0, 0, 0);
              this.rov.yaw = yaw;
              this.rov.pitch = pitch;
              return item.position.toArray();
            }
          }
          return null;
        },
        // REQ-015: on foot or aboard, where the player and the submarine are, and where the camera is.
        onLand: () => this.ashore !== null,
        walker: () => (this.ashore ? { position: this.ashore.walker.position.toArray(), yaw: this.ashore.walker.yaw } : null),
        subPosition: () => (this.ashore ? this.ashore.sub : this.rov.position).toArray(),
        cameraPosition: () => this.camera.position.toArray(),
        // REQ-024: whether the view is above the water, how often it changed since the page loaded, and the model's height.
        view: () => ({ above: this.above, flips: this.aboveFlips, modelY: this.rovModel.position.y }),
        // REQ-035: the ships at sea and whether they are drawn, the horns played, and a way to bring the next horn sooner.
        ships: () => ({ visible: this.world.ships.group.visible, list: this.world.ships.shown() }),
        horns: () => this.horns,
        hurryHorn: (seconds: number) => this.world.ships.hurryHorn(seconds),
        // REQ-036: the dumping boat (phase, where it is, how much it dropped, its crew), and ways to bring it or its next drop now.
        dumper: () => ({
          phase: this.dumper.phase,
          position: this.dumper.position.toArray(),
          yaw: this.dumper.yaw,
          roll: this.dumper.roll,
          dumped: this.dumper.dumped,
          crew: this.dumper.crew.map((person) => ({ phase: person.phase, position: person.position.toArray() })),
        }),
        summonDumper: (x?: number, z?: number) => {
          const player = this.ashore ? this.ashore.walker.position : this.rov.position;
          this.dumper.summon(player, x === undefined || z === undefined ? undefined : { x, z });
        },
        hurryDrop: (seconds: number) => this.dumper.hurryDrop(seconds),
        // REQ-032 AC-3: how far each propeller has turned (radians; left, right).
        propellers: () => ["propeller-left", "propeller-right"].map((name) => this.rovModel.getObjectByName(name)?.rotation.z ?? null),
        inTransition: () => this.transition !== null,
        // REQ-027, REQ-028: the browser tests start with the cinematics off (see cinematicsOnByDefault); a test that is about
        // them turns them on before Mulai. `cinematic()` is the one playing (its kind, seconds, shot, whether a skip is under
        // way and what the HUD shows); `skipCinematic` is a click; `seekCinematic` jumps the clock so a test need not wait.
        cinematics: (on: boolean) => {
          this.cinematicsOn = on;
        },
        cinematicsOn: () => this.cinematicsOn,
        cinematic: () =>
          this.cine
            ? { kind: this.cine.kind, time: this.cine.time, duration: this.cine.duration, shot: this.cine.shot, skipping: this.cine.skipTime !== null, hud: this.cine.hud() }
            : null,
        skipCinematic: () => this.cine?.skip(),
        seekCinematic: (seconds: number) => {
          if (this.cine) this.cine.time = Math.min(seconds, this.cine.duration - 0.02);
        },
        openingPlayed: () => this.openingPlayed,
        screenFade: () => this.fadeValue(),
        // REQ-026: the sound engine's state (context, buses, music filter, ambience mix, effects fired), when it has one.
        audio: () => ("debug" in this.audio ? (this.audio as unknown as { debug(): unknown }).debug() : null),
        playSound: (name: Parameters<GameAudio["play"]>[0]) => this.audio.play(name),
        // Turns (and moves) the player on foot, like placeRov for the submarine.
        placeWalker: (x: number, z: number, yaw: number, pitch: number) => {
          if (!this.ashore) return;
          this.ashore.walker.position.set(x, 0, z);
          stepWalker(this.ashore.walker, { forward: 0, strafe: 0, rise: 0 }, 0);
          this.ashore.walker.yaw = yaw;
          this.ashore.walker.pitch = pitch;
        },
        ashoreSpot: (x: number, z: number) => ashoreSpot(x, z),
        // REQ-014: the cave (its mouths, length, roof hole), how dark it is at the camera, and the vehicle's lamp.
        cave: () => ({
          mouths: caveInfo.mouths,
          length: caveInfo.length,
          path: caveInfo.path,
          hole: caveInfo.hole,
          level: caveLevel(this.rov.position.x, this.rov.position.y, this.rov.position.z),
          cameraLevel: caveLevel(this.camera.position.x, this.camera.position.y, this.camera.position.z),
          dark: this.caveDark,
          lampLit: this.lampLit,
          lamp: this.lampLevel * config.bay.cave.lamp.intensity,
          shaft: this.caveView.light.intensity,
          light: this.sceneLight(),
        }),
        // REQ-005: reach the Bloom quickly and read what it changes. (REQ-010's e2e tests use removeTrash too.)
        // Takes n free trash items out of the field and counts them as removed, like the vacuum, but without tank or score.
        // REQ-014: the cave's pieces come first in the list; `fromEnd` takes the others first and leaves them lying.
        removeTrash: (n: number, fromEnd = false) => {
          let removed = 0;
          for (const item of fromEnd ? [...this.field.items].reverse() : this.field.items) {
            if (removed >= n) break;
            if (item.state !== "free") continue;
            item.state = "collected";
            this.session.trashRemoved += 1;
            removed += 1;
          }
          this.trashView.sync(this.field.items);
          return removed;
        },
        // Installs and plants the frames and/or the seagrass patches that are not planted yet.
        // The Session's counts stay right, so the goal lists and the Bloom see it like real planting.
        plantAll: (what: "all" | "frames" | "patches" = "all") => {
          const { session, reef } = this;
          if (what !== "patches") {
            for (const frame of reef.frames) {
              if (framePlanted(frame)) continue;
              if (!frame.installed) session.framesInstalled += 1;
              frame.installed = true;
              frame.fragments = config.reef.fragmentsPerFrame;
              session.framesPlanted += 1;
            }
            setFrameColumns(reef.columns());
          }
          if (what !== "frames") {
            for (const patch of reef.patches) {
              if (patchPlanted(patch)) continue;
              patch.seeds = config.reef.seedsPerPatch;
              session.patchesPlanted += 1;
            }
          }
          this.reefView.sync(reef);
        },
        // Starts a new dive, as "main lagi" will (REQ-005: it must come back murky, with nothing planted).
        newDive: () => this.play(),
        // REQ-012: how many dives have started, and the layout's seed for the browser tests.
        dives: () => this.dives,
        bloom: () => ({ state: this.bloom.state, progress: this.bloom.progress, clarity: this.bloom.clarity, scannerOpen: this.session.bloomDone }),
        water: () => {
          const fog = this.scene.fog as Fog;
          return { background: (this.scene.background as Color).getHex(), fog: fog.color.getHex(), fogNear: fog.near, fogFar: fog.far };
        },
        // REQ-013: the natural reef's look (coral colours, seagrass, rays), and where its corals and meadows are.
        natureLook: () => this.natureView.look(),
        // REQ-020: how many draw calls and triangles the last frame took.
        renderInfo: () => ({ calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles }),
        // REQ-030 AC-7: how many device pixels are drawn per CSS pixel, and whether the picture is antialiased.
        render: () => ({ pixelRatio: this.renderer.getPixelRatio(), antialias: this.renderer.getContext().getContextAttributes()?.antialias ?? null }),
        naturalTargets: () => naturalTargets.map((t) => ({ ...t })),
        // REQ-021: the decoration shown this dive (after the trash rule), as plain pieces.
        decorItems: () => this.natureView.decorItems().map((d) => ({ ...d })),
        beach: () => this.world.beach.look(),
        beachItems: () => this.world.beach.shown(),
        // REQ-023: the sky (drawn or not, the sun's direction, the clock) and the sea surface's mirror.
        sky: () => ({ ...this.world.sky.look(), sea: this.world.sea.look(), lightDirection: this.sunDirection() }),
        reefLook: () => ({ ...this.reefView.look(), coral: this.reefView.coralMaterials.map((m) => m.color.getHex()), markers: this.reefView.markerOpacity() }),
        // REQ-006: the Logbook entries opened so far, and a way to free both animals without cutting.
        unlocked: () => [...this.session.unlocked],
        // Opens entries without scanning, to read the Logbook without a Bloom (the Logbook screen reads the HUD state).
        unlockEntries: (ids: LogbookId[]) => ids.forEach((id) => this.session.unlocked.add(id)),
        freeAnimals: () => {
          for (const net of this.rescue.nets.nets) {
            if (net.cut) continue;
            this.rescue.nets.cut(net.id);
            this.rescue.animals.free(net.id, this.rov.position);
            this.session.freeAnimal(net.species);
          }
        },
        // REQ-008: open an entry as a scan would (the end screen follows the 7th), and read the play time.
        scanEntry: (id: LogbookId) => this.session.scanned({ kind: "scanned", entry: id }),
        playSeconds: () => this.session.playSeconds,
        seaLife: () => ({
          active: this.seaLife.active,
          scale: this.seaLife.scale,
          anemones: this.seaLife.anemones,
          creatures: this.seaLife.creatures.map((c) => ({ id: c.id, species: c.species, scannable: c.scannable, position: c.position.toArray() })),
        }),
      };
    }
  }

  onHud(listener: (state: HudState) => void): void {
    this.hudListener = listener;
  }

  onEnd(listener: (summary: SessionSummary) => void): void {
    this.endListener = listener;
  }

  onOpeningEnd(listener: () => void): void {
    this.openingEndListener = listener;
  }

  cinematic(): CinematicHud | null {
    return this.cine ? this.cine.hud() : null;
  }

  touchInput(): TouchInput {
    return this.input;
  }

  play(): void {
    this.rov = createRovState();
    // REQ-015 AC-8: a new dive always starts aboard, at the start.
    this.ashore = null;
    this.transition = null;
    // REQ-012: every dive puts the nets, the reef sites, the seagrass patches and the trash somewhere else.
    this.dives += 1;
    const seed = TEST_SEED !== null ? TEST_SEED + this.dives : Math.floor(Math.random() * 2 ** 31);
    const layout = chooseLayout(seed);
    this.world.ships.reset(seed); // REQ-035 AC-4: a ship is already out at sea
    this.dumper.reset(seed); // REQ-036: the first dumping boat comes a while into the dive
    this.session = new Session(this.field.total);
    this.field.reset(layout.trashSeed);
    this.trashView.sync(this.field.items);
    this.natureView.setTrash(this.floorHomes()); // REQ-021 AC-6: no decoration over this dive's trash
    this.world.beach.setTrash(this.field.items.filter((item) => item.onBeach).map((item) => item.home));
    this.rescue.reset(layout); // REQ-003
    this.resetReef(layout);
    this.resetBloom(); // REQ-005
    this.scanner.reset(); // REQ-006
    this.scanBeam.visible = false;
    this.sucking = false;
    this.caveDark = 0;
    this.lampLit = false;
    this.lampLevel = 0;
    this.input.clear();
    this.cine = null;
    this.openingShot = this.bloomShot = this.endingShot = null;
    this.fade = null;
    this.mode = "playing";
    // REQ-027 AC-1, AC-6: the first Mulai since the page opened plays the opening; Main lagi (and every later dive) does not.
    if (this.cinematicsOn && !this.openingPlayed) {
      this.openingPlayed = true;
      this.startCinematic("opening");
    }
  }

  pause(): void {
    this.mode = "paused";
    this.input.clear();
    // REQ-026 AC-7: the held sounds stop with the game.
    this.audio.loop("vacuum", 0);
    this.audio.loop("scan", 0);
    this.vacuumHeld = false;
  }

  resume(): void {
    this.input.clear();
    this.mode = "playing";
  }

  private frame(time: number): void {
    // The simulation steps at most 0.1 s per frame; the play time (REQ-008) counts the real time.
    const real = this.lastFrame === null ? 0 : (time - this.lastFrame) / 1000;
    const dt = Math.min(real, 0.1);
    this.lastFrame = time;

    if (this.mode === "playing") {
      const [dx, dy] = this.input.takeMouse();
      this.stepCinematic(dt); // REQ-027, REQ-028
      if (this.transition) this.stepTransition(dt);
      else if (this.cine) {
        // The player does not steer, walk or use a tool during a cinematic (REQ-027 AC-4); the world goes on.
      } else if (this.ashore) {
        // REQ-015: walking on the land.
        lookWalker(this.ashore.walker, dx, dy);
        const { x, z } = this.ashore.walker.position;
        stepWalker(this.ashore.walker, this.input.move(), dt);
        this.stepFootsteps(x, z);
      } else {
        steer(this.rov, dx, dy);
        stepRov(this.rov, this.input.move(), dt);
        this.checkDiveEdge();
      }
      this.stepTools(dt);
      if (!this.cine) this.stepDumper(dt); // REQ-036: its clock runs only while the player plays
      this.stepBloom(dt); // REQ-005
      this.stepEnd(dt, real); // REQ-008
      this.syncRovModel();
      this.placeCamera(dt);
    } else if (this.mode === "title") {
      this.orbitTitleCamera(dt);
    }
    // REQ-015: above the water the world shows the sky and daylight instead of the water's fog.
    this.updateAbove();
    this.audio.scene({ above: this.above, clarity: this.bloom.clarity }); // REQ-026 AC-2, AC-4
    this.world.setAbove(this.above);
    if (this.mode !== "paused") {
      this.stepCave(dt);
      this.trashView.sync(this.field.items, performance.now() / 1000); // REQ-025 AC-2: the floating items bob
      this.dumperView.sync(this.dumper, performance.now() / 1000); // REQ-036
      this.world.update(dt, this.camera.position);
      updateRovPropellers(this.rovModel, dt, this.mode === "playing" && !this.ashore ? this.rov.velocity.length() : 0);
      // REQ-035 AC-5: a ship's horn now and then, heard above the water only (the world counts only then).
      if (this.world.ships.takeHorn() && this.mode === "playing") {
        this.audio.play("shipHorn");
        this.horns += 1;
      }
      // The surface's light rays stay out of the cave, where only its own shaft lights the dark (REQ-014 AC-2).
      this.natureView.update(dt, this.camera.position, this.above || this.caveDark > 0.2);
    }

    this.camera.lookAt(this.cameraTarget);
    if (this.mode === "playing") this.publishHud();
    this.renderer.render(this.scene, this.camera);
  }

  /** REQ-024 AC-4: whether the view is above the water, with a band around the waterline so it cannot flip every frame. */
  private updateAbove(): void {
    const next = viewAbove(this.above, this.camera.position.y);
    if (next !== this.above) this.aboveFlips += 1;
    this.above = next;
  }

  /**
   * REQ-022 AC-4: when the submarine reaches the dive area's invisible edge the message shows (once for each time it gets
   * there; it shows again after the submarine has left the edge and come back).
   */
  private checkDiveEdge(): void {
    const { x, z } = this.rov.position;
    if (atDiveEdge(x, z)) {
      if (!this.atEdge) this.session.say({ key: "hud.diveEdge" }, config.bay.area.messageSeconds);
      this.atEdge = true;
    } else if (!atDiveEdge(x, z, config.bay.area.slowBand / 2)) {
      this.atEdge = false;
    }
  }

  /** REQ-026 AC-3: a footstep every `footstepStride` m walked, on the dock's boards or on the sand. */
  private stepFootsteps(fromX: number, fromZ: number): void {
    const { x, z } = this.ashore!.walker.position;
    this.stride += Math.hypot(x - fromX, z - fromZ);
    if (this.stride < config.audio.footstepStride) return;
    this.stride = 0;
    this.audio.play(onDock(x, z) ? "footstepDock" : "footstepSand");
  }

  /**
   * REQ-014: the water darkens as the camera goes in the cave, and lightens as it comes out, eased so there is no flash;
   * the vehicle's headlamp turns on when the vehicle is in the cave and off when it is out, with no key.
   */
  private stepCave(dt: number): void {
    const { dark, lamp } = config.bay.cave;
    const { position } = this.camera;
    const target = caveLevel(position.x, position.y, position.z);
    this.caveDark = Math.abs(target - this.caveDark) < 0.002 ? target : this.caveDark + (target - this.caveDark) * (1 - Math.exp(-dark.fade * dt));
    this.world.setCave(this.caveDark);
    this.lampLit = !this.ashore && caveLamp(this.lampLit, caveLevel(this.rov.position.x, this.rov.position.y, this.rov.position.z));
    const step = lamp.fade * dt;
    this.lampLevel = Math.min(this.lampLevel + step, Math.max(this.lampLevel - step, this.lampLit ? 1 : 0));
    setHeadlight(this.rovModel, this.lampLevel, lamp.intensity);
    this.caveView.update(performance.now() / 1000);
  }

  /** The direction the sunlight comes from, as a unit vector, for the browser tests. */
  private sunDirection(): [number, number, number] {
    let direction: [number, number, number] = [0, 1, 0];
    this.scene.traverse((object) => {
      if (object instanceof DirectionalLight) direction = object.position.clone().normalize().toArray() as [number, number, number];
    });
    return direction;
  }

  /** The lights' intensities, for the browser tests: the sky, the sun. */
  private sceneLight(): { hemisphere: number; sun: number } {
    let hemisphere = 0;
    let sun = 0;
    this.scene.traverse((object) => {
      if (object instanceof HemisphereLight) hemisphere = object.intensity;
      if (object instanceof DirectionalLight) sun = object.intensity;
    });
    return { hemisphere, sun };
  }

  /**
   * The vacuum, the tool keys and E, for one simulated frame. On the land and while getting in or out the tools do
   * nothing, and E only boards the submarine (REQ-015 AC-2, AC-4).
   */
  /**
   * REQ-036: the dumping boat comes, drops trash (there is more to clean, AC-2) and, once the Cutter turned it over, sinks
   * while its crew swims ashore. Its notice tells the player it came (AC-1).
   */
  private stepDumper(dt: number): void {
    const player = this.ashore ? this.ashore.walker.position : this.rov.position;
    const { arrived, drop } = this.dumper.update(dt, this.bloom.state !== "idle", player);
    if (arrived) this.session.say({ key: "dumper.arrived" }, config.dumper.noticeSeconds);
    if (drop) {
      this.field.drop(drop.x, drop.z, drop.floating);
      this.session.addTrash(1);
    }
  }

  private stepTools(dt: number): void {
    const { session, rov } = this;
    // REQ-027 AC-4: during a cinematic the keys and the button do nothing.
    const locked = this.cine !== null;
    const aboard = !this.ashore && !this.transition && !locked;
    for (const code of this.input.takePressed()) {
      if (this.transition || locked) continue;
      if (this.ashore) {
        // REQ-017 AC-2, AC-5: aiming at trash in reach, E picks it up before anything else; with a full tank it stays.
        // REQ-016: otherwise at the shed's counter E deposits the tank; next to the submarine it gets back in.
        const aimed = code === "KeyE" ? this.aimedBeachTrash() : null;
        if (aimed) {
          if (session.collect()) {
            this.field.lift(aimed);
            this.audio.play("pickup"); // REQ-026
          } else this.audio.play("tankFull");
        } else if (code === "KeyE" && inStationZone(this.ashore.walker.position)) {
          if (session.deposit() !== "empty") this.audio.play("deposit"); // REQ-026
        } else if (code === "KeyE" && canBoard(this.ashore.walker, this.ashore.sub)) this.startTransition("sub", null);
        continue;
      }
      session.select(toolForKey(code));
      if (code === "KeyE") this.interact();
    }

    aimDirection(rov.yaw, rov.pitch, this.aim);
    const primary = aboard && this.input.primaryHeld();
    const held = primary && session.tool === "vacuum";
    const room = session.tankSpace - this.field.pulling;
    this.sucking = held && room > 0;
    // REQ-026 AC-3: the vacuum hums while the button is down; each piece into the tank clinks; the last one that fits
    // sounds the buzzer, and so does a press on a full tank.
    let collected = 0;
    for (const _item of this.field.update(dt, rov.position, this.aim, held, room)) if (session.collect()) collected += 1;
    if (collected > 0) {
      this.audio.play("trashIn");
      if (session.tankFull) this.audio.play("tankFull", 0.12);
    } else if (held && !this.vacuumHeld && session.tankFull) this.audio.play("tankFull");
    this.vacuumHeld = held;
    this.audio.loop("vacuum", this.sucking ? 1 : 0);
    // REQ-003: the cutter, the nets and the animals.
    const netsCut = session.netsCut;
    // REQ-036 AC-4: the cutter also turns the dumping boat over.
    if (this.rescue.step(dt, rov, this.aim, primary && session.tool === "cutter", this.floorItems, session, this.dumper.hull)) {
      this.dumper.capsize();
      session.capsizedBoat();
      this.audio.play("capsize");
    }
    if (session.netsCut > netsCut) {
      this.audio.play("netCut"); // REQ-026
      this.audio.play("animalFreed", 0.25);
    }
    this.stepSeedLauncher(dt, primary);
    this.stepScanner(dt, primary);
    session.tick(dt);

    this.beam.visible = this.sucking;
    if (this.sucking) {
      this.beam.position.copy(rov.position);
      this.beam.lookAt(rov.position.x + this.aim.x, rov.position.y + this.aim.y, rov.position.z + this.aim.z);
      (this.beam.material as MeshBasicMaterial).opacity = 0.07 + 0.03 * Math.sin(performance.now() / 60);
    }
  }

  /** REQ-021 AC-6, REQ-025 AC-2: where the items lie on the floor; the floating ones clear no decoration under them. */
  private floorHomes(): Vector3[] {
    return this.floorItems.map((item) => item.home);
  }

  /** REQ-017: the beach trash the player on foot aims at with the crosshair, within reach; null aboard or when none. */
  private aimedBeachTrash(): TrashItem | null {
    if (!this.ashore) return null;
    const { walker } = this.ashore;
    return aimedBeachItem(walker.position, eyePosition(walker, this.eye), aimDirection(walker.yaw, walker.pitch, this.lookAhead), this.field.items);
  }

  /**
   * REQ-006: while the Scanner is selected and the button is held, the ray from the camera along the aim must hit a
   * scannable target; held on it for `scanner.seconds` it opens the Logbook entry (AC-1, AC-5, AC-6, AC-7).
   */
  private stepScanner(dt: number, primary: boolean): void {
    const { session, rov } = this;
    const scanning = primary && session.tool === "scanner";
    this.scanHit = null;
    if (scanning) {
      followCamera(rov, this.scanCamera, this.scanLookAt);
      const targets = collectScanTargets(this.rescue.animals.animals, this.seaLife.creatures, this.seaLife.scale, this.reef.frames, this.reef.patches, naturalTargets);
      this.scanHit = aimedScanTarget(this.scanCamera, this.aim, rov.position, targets);
    }
    const event = this.scanner.update(dt, scanning, this.scanHit, session.unlocked);
    if (event) {
      session.scanned(event);
      this.audio.play(event.kind === "scanned" ? "logbookEntry" : "scanKnown"); // REQ-026
    }

    const working = this.scanHit !== null && this.scanner.progress > 0;
    this.audio.loop("scan", working ? this.scanner.progress : 0); // REQ-026
    this.scanBeam.visible = working;
    if (working && this.scanHit) {
      this.scanNose.set(rov.position.x + Math.sin(rov.yaw) * 0.8, rov.position.y + 0.2, rov.position.z + Math.cos(rov.yaw) * 0.8);
      placeCutterBeam(this.scanBeam, this.scanNose, this.scanHit.point, 0.5 + 0.5 * Math.sin(performance.now() / 70));
    }
  }

  /**
   * REQ-005: starts the Bloom the moment its conditions hold, blends the water, coral and seagrass while it runs,
   * and when it ends opens the Scanner and lets the sea life in. Only called while playing, so a pause freezes it.
   */
  private stepBloom(dt: number): void {
    const event = this.bloom.update(dt, this.session.bloomReady);
    if (event === "started") {
      this.audio.play("bloom"); // REQ-026 AC-3; the music's filter follows the clarity (AC-4)
      if (this.cinematicsOn && !this.cine) this.startCinematic("bloom"); // REQ-028 AC-1
    }
    this.showBloom(this.bloom.clarity);
    if (event === "finished") {
      this.seaLife.start();
      this.session.openScanner();
    }
    this.seaLife.update(dt);
    this.seaLifeView.sync(this.seaLife, dt);
  }

  /** REQ-008: counts the play time, and once the 7th entry's notice has been read, hands the summary to the end screen. */
  private stepEnd(dt: number, real: number): void {
    // REQ-027 AC-5: the play time starts after the opening. REQ-028 AC-5: it stops at the 7th entry (the Session), so the ending leaves it out.
    // REQ-029 AC-7: nor does it run in the frame where the opening ends and the mission card stops the game.
    this.session.addPlayTime(this.cine?.kind === "opening" || this.mode !== "playing" ? 0 : real);
    if (!this.session.endDue(dt)) return;
    // REQ-028 AC-2: the ending flies over the restored bay first; the end screen follows it (or its skip).
    if (this.cinematicsOn) this.startCinematic("ending");
    else this.endListener?.(this.session.summary());
  }

  /** A click or Space skips the cinematic (REQ-027 AC-4); the Space that did it is not also a press for the submarine. */
  private listenForSkip(cinematic: Cinematic): void {
    const clicked = this.input.takeClicks() > 0;
    const space = this.input.takePressed().includes("Space");
    if (space) this.input.ignoreUntilReleased("Space");
    this.input.clear();
    if (clicked || space) cinematic.skip();
  }

  /** Runs the cinematic's clock; when it ends, or is skipped, control comes back (the ending goes on to the end screen). */
  private stepCinematic(dt: number): void {
    if (this.fade && (this.fade.time += dt) >= this.fade.total) this.fade = null;
    const cinematic = this.cine;
    if (!cinematic) return;
    this.listenForSkip(cinematic);
    const result = cinematic.step(dt);
    if (!result) return;
    this.cine = null;
    this.openingShot = this.bloomShot = this.endingShot = null;
    this.input.clear();
    // REQ-029 AC-1: the opening hands over to the mission card, which stops the game. The camera goes back to the player's
    // view first, so the card (and the game after it) starts there and not at the point where a skip cut the path; and there
    // is no fade to run, because the stopped game could not run it (the card comes up from the dark itself).
    const card = cinematic.kind === "opening" ? this.openingEndListener : null;
    if (card) {
      this.fade = null;
      this.placeNormalCamera();
      card();
    } else if (result === "skipped" && cinematic.kind !== "ending") {
      // REQ-027 AC-4: at the darkest point of a skip the control is back, and the screen fades in on the player's camera.
      this.fade = { time: 0, total: config.cinematic.skipFadeSeconds / 2 };
    }
    if (cinematic.kind === "ending") this.endListener?.(this.session.summary());
  }

  /** Starts a cinematic. The submarine stands still for it. */
  private startCinematic(kind: CinematicKind): void {
    this.cine = new Cinematic(kind);
    this.openingShot = this.bloomShot = this.endingShot = null;
    this.input.clear();
    this.sucking = false;
    this.beam.visible = false;
    this.rov.velocity.set(0, 0, 0);
    if (kind === "opening") {
      // REQ-027 AC-8, D-115: the path follows this dive's floating trash near the beach, the floor trash nearest the start, and
      // the turtle in its net (net 0 always traps it; the animals and nets were laid out for this dive just before).
      const group = beachGroup(this.field.items.filter(floatingTrash).map((item) => item.home));
      const turtle = this.rescue.animals.animals.find((animal) => animal.species === "turtle") ?? this.rescue.animals.animals[0];
      this.openingShot = openingPlan({
        group: group ?? new Vector3(config.bay.shore.waterlineX + 20, config.bay.surfaceY, 0),
        floor: floorGroup(seaFloorTrash(this.field.items), config.rov.start),
        turtle: { position: turtle.home, yaw: turtle.homeYaw },
        nets: this.rescue.nets.nets,
        hide: this.rescue.animals.animals.filter((animal) => animal.species === "reefShark").map((animal) => animal.home),
      });
      this.fade = { time: 0, total: config.cinematic.openingFadeSeconds };
    } else if (kind === "ending") {
      const of = (species: string) => this.seaLife.creatures.filter((creature) => creature.species === species);
      const kinds = { yellowtail: of("yellowtail"), mantaRay: of("mantaRay"), dolphin: of("dolphin") };
      this.endingShot = new EndingShot({ frames: this.reef.frames, reefs: patchReefs, creature: (species, index) => kinds[species][index] ?? null });
    }
  }

  /** 0 (clear) to 1 (black): the screen coming up from black, going dark after a skip, or dark at a cut of the opening (D-115). */
  private fadeValue(): number {
    const coming = this.fade ? 1 - this.fade.time / this.fade.total : 0;
    return Math.max(coming, this.cine?.fade ?? 0, this.cine?.cutFade ?? 0);
  }

  /** Sets the water, coral and seagrass to a point of the Bloom, only when it changed. */
  private showBloom(clarity: number): void {
    if (clarity === this.bloomShown) return;
    this.bloomShown = clarity;
    this.world.setClarity(clarity);
    this.reefView.setBloom(clarity);
    this.natureView.setBloom(clarity); // REQ-013
  }

  /** REQ-005: a new dive starts murky, with pale coral, sprouts and no sea life (the anemones by the new frames). */
  private resetBloom(): void {
    this.bloom.reset();
    this.seaLife.reset(this.reef.frames);
    this.showBloom(0);
    this.seaLifeView.sync(this.seaLife, 0);
  }

  /** REQ-004: a new dive starts with no frames, coral or seagrass; REQ-012: at the layout's spots, so the view is rebuilt. */
  private resetReef(layout: Layout): void {
    this.reef.reset(layout);
    setFrameColumns([]);
    this.seeds.clear();
    this.scene.remove(this.reefView.group);
    this.reefView = createReefView(this.reef);
    this.scene.add(this.reefView.group);
    this.bloomShown = -1;
    this.reefView.sync(this.reef);
    this.seedView.sync(this.seeds.shots);
  }

  /** E aboard: installs a frame near an empty reef site, or goes ashore near the beach. It never deposits (REQ-016 AC-4). */
  private interact(): void {
    const { position } = this.rov;
    if (this.reef.emptySiteNear(position.x, position.z) >= 0) {
      this.installFrame();
      return;
    }
    // REQ-015 AC-1: near the west shore, E takes the player ashore; anywhere else it does nothing (AC-8).
    const spot = ashoreSpot(position.x, position.z);
    if (spot) this.startTransition("land", spot);
  }

  /** REQ-015: starts the short fade for getting out (`spot` is where) or back in. */
  private startTransition(to: "land" | "sub", spot: AshoreSpot | null): void {
    this.transition = { time: 0, switched: false, to, spot };
    this.audio.play(to === "land" ? "leaveSub" : "boardSub"); // REQ-026
    this.sucking = false;
    this.beam.visible = false;
  }

  /** Advances the fade; at its darkest point the player is moved ashore or back aboard. */
  private stepTransition(dt: number): void {
    const transition = this.transition!;
    transition.time += dt;
    if (!transition.switched && transition.time >= config.land.fadeSeconds / 2) {
      transition.switched = true;
      if (transition.to === "land") this.goAshore(transition.spot!);
      else this.boardSub();
    }
    if (transition.time >= config.land.fadeSeconds) this.transition = null;
  }

  /** Leaves the submarine floating alongside the beach and stands the player on it, facing inland (D-079, D-080). */
  private goAshore(spot: AshoreSpot): void {
    const sub = new Vector3(spot.park.x, config.bay.surfaceY - config.land.floatDepth, spot.park.z);
    this.ashore = { walker: createWalker(spot.landing.x, spot.landing.z, spot.landing.yaw), sub };
    this.stride = 0;
    this.rov.position.copy(sub);
    this.rov.velocity.set(0, 0, 0);
    this.rov.pitch = 0;
  }

  /** Back in the submarine where it floats at the surface, ready to dive (REQ-015 AC-4). */
  private boardSub(): void {
    const { sub } = this.ashore!;
    this.ashore = null;
    this.rov.position.set(sub.x, config.bay.surfaceY - config.rov.floatDepth, sub.z);
    this.rov.velocity.set(0, 0, 0);
    constrainRov(this.rov.position, this.rov.velocity);
  }

  /** First person on the land, third person behind the submarine otherwise (D-029, D-079); a cinematic takes the camera over. */
  private placeCamera(dt: number): void {
    // The end screen (or the pause menu) may have taken over in this very frame: the view stays as it was.
    if (this.mode !== "playing") return;
    this.placeNormalCamera();
    if (this.cine) this.placeCinematicCamera(dt);
  }

  /** REQ-027, REQ-028: the camera of the cinematic that is playing. It starts from the normal camera, which it falls back into at the end. */
  private placeCinematicCamera(dt: number): void {
    const cinematic = this.cine!;
    const normal = this.normalPose;
    normal.position.copy(this.camera.position);
    normal.target.copy(this.cameraTarget);
    const pose = this.shotPose;
    if (cinematic.kind === "opening") this.openingShot!.pose(cinematic.time, pose);
    else if (cinematic.kind === "bloom") {
      const focus = this.ashore ? eyePosition(this.ashore.walker, this.focus) : this.focus.copy(this.rov.position);
      this.bloomShot ??= new BloomShot(focus, normal, this.ashore !== null);
      this.bloomShot.pose(cinematic.time, cinematic.duration, dt, focus, normal, pose);
    } else this.endingShot!.pose(cinematic.time, dt, pose);
    this.camera.position.copy(pose.position);
    this.cameraTarget.copy(pose.target);
    this.rovModel.children[0].visible = true;
  }

  private placeNormalCamera(): void {
    if (!this.ashore) {
      followCamera(this.rov, this.camera.position, this.cameraTarget);
      // REQ-014: backed against a wall in the cave, the camera can be pulled right into the hull: show it only from outside.
      this.rovModel.children[0].visible = this.camera.position.distanceTo(this.rov.position) > config.camera.hideVehicleBelow;
      return;
    }
    this.rovModel.children[0].visible = true;
    const { walker } = this.ashore;
    eyePosition(walker, this.eye);
    this.camera.position.copy(this.eye);
    this.cameraTarget.copy(this.eye).add(aimDirection(walker.yaw, walker.pitch, this.lookAhead));
  }

  /** E near an empty reef site: pays 5 materials and installs a frame (AC-2), or says materials are short (AC-3). */
  private installFrame(): void {
    const site = this.reef.emptySiteNear(this.rov.position.x, this.rov.position.z);
    if (site < 0 || !this.session.buyFrame()) return;
    this.reef.install(site);
    this.audio.play("frameInstall"); // REQ-026
    setFrameColumns(this.reef.columns());
    this.reefView.sync(this.reef);
  }

  /** The seed launcher: shots fly to the crosshair's target; coral and seeds land on frames and patches (AC-4 to AC-6). */
  private stepSeedLauncher(dt: number, primary: boolean): void {
    const { session, rov, seeds } = this;
    let changed = false;
    for (const result of seeds.update(dt, this.reef)) {
      if (result.kind === "coral") session.coralAttached(result.planted);
      else if (result.kind === "seed") session.seedPlanted(result.planted);
      if (result.kind !== "miss" && result.planted) this.audio.play("planted"); // REQ-026
      changed ||= result.kind !== "miss";
    }
    if (primary && session.tool === "seedLauncher" && seeds.ready) {
      // The crosshair is the camera's ray along the aim; the shot leaves the ROV and flies to the point that ray hits.
      followCamera(rov, this.seedCamera, this.seedCameraTarget);
      findAimPoint(this.seedCamera, this.aim, this.reef, this.seedTarget);
      if (seeds.fire(rov.position, this.seedTarget, this.aim)) this.audio.play("seedShot"); // REQ-026
    }
    if (changed) this.reefView.sync(this.reef);
    this.seedView.sync(seeds.shots);
  }

  private publishHud(): void {
    const { session } = this;
    this.camera.updateMatrixWorld();
    this.viewPoint.copy(this.stationAnchor).applyMatrix4(this.camera.matrixWorldInverse);
    const tanHalfFov = Math.tan((config.camera.fov * Math.PI) / 360);
    // REQ-037: the marker to the dumping boat while it is in the bay and upright, from the submarine or the player ashore.
    const from = this.ashore ? this.ashore.walker.position : this.rov.position;
    let dumperMarker: MarkerPlacement | null = null;
    if (this.dumper.active) {
      this.dumperAnchor.copy(this.dumper.position).setY(this.dumper.position.y + config.hud.dumperMarkerHeight);
      this.dumperViewPoint.copy(this.dumperAnchor).applyMatrix4(this.camera.matrixWorldInverse);
      dumperMarker = placeMarker(this.dumperViewPoint, tanHalfFov, window.innerWidth, window.innerHeight, config.hud.markerMargin, config.hud.markerBottomMargin);
    }
    const state: HudState = {
      tool: session.tool,
      tank: session.tank,
      capacity: session.capacity,
      tankFull: session.tankFull,
      score: session.score,
      materials: session.materials,
      cleanliness: session.cleanliness,
      objectives: session.objectives,
      notice: session.currentNotice,
      inStationZone: this.ashore !== null && inStationZone(this.ashore.walker.position),
      stationDistance: Math.round(distanceToStation(from)),
      marker: placeMarker(this.viewPoint, tanHalfFov, window.innerWidth, window.innerHeight, config.hud.markerMargin, config.hud.markerBottomMargin),
      sucking: this.sucking,
      cutProgress: this.rescue.progress, // REQ-003
      // REQ-036, REQ-037
      dumper: {
        active: this.dumper.active,
        atBoat: this.rescue.atBoat,
        marker: dumperMarker,
        distance: Math.round(Math.hypot(this.dumper.position.x - from.x, this.dumper.position.z - from.z)),
      },
      scanProgress: this.scanner.progress, // REQ-006
      unlocked: LOGBOOK_ENTRIES.filter((entry) => session.unlocked.has(entry.id)).map((entry) => entry.id),
      reef: {
        phase2: session.phase2Objectives,
        canInstall: !this.ashore && this.reef.emptySiteNear(this.rov.position.x, this.rov.position.z) >= 0,
      },
      // REQ-005: the Phase 3 list, empty until the Bloom is over.
      phase3: session.phase3Objectives,
      // REQ-015: on foot or aboard, the prompts to get out or in, and the fade.
      land: {
        onLand: this.ashore !== null,
        canGoAshore: !this.ashore && !this.transition && ashoreSpot(this.rov.position.x, this.rov.position.z) !== null,
        canBoard: this.ashore !== null && !this.transition && canBoard(this.ashore.walker, this.ashore.sub),
        canPickUp: !this.transition && this.aimedBeachTrash() !== null,
        fade: Math.max(this.transition ? 1 - Math.abs((2 * this.transition.time) / config.land.fadeSeconds - 1) : 0, this.fadeValue()),
      },
      cinematic: this.cine ? this.cine.hud() : null, // REQ-027, REQ-028
      // REQ-010; on the land the arrow is the player, and the parked submarine has its own mark (REQ-015 AC-6).
      minimap: buildMinimap({
        rov: this.ashore
          ? { x: this.ashore.walker.position.x, z: this.ashore.walker.position.z, yaw: this.ashore.walker.yaw }
          : { x: this.rov.position.x, z: this.rov.position.z, yaw: this.rov.yaw },
        sub: this.ashore ? { x: this.ashore.sub.x, z: this.ashore.sub.z, yaw: this.rov.yaw } : null,
        frames: this.reef.frames,
        patches: this.reef.patches,
        nets: this.rescue.nets.nets,
        trash: this.field.items,
        cleanliness: session.cleanliness,
        dumper: this.dumper.active ? { x: this.dumper.position.x, z: this.dumper.position.z } : null,
      }),
    };
    this.lastHud = state;
    this.hudListener?.(state);
  }

  /** Behind the title screen, the camera sways slowly behind the ROV, which sits below the title text. */
  private orbitTitleCamera(dt: number): void {
    this.titleTime += dt;
    const angle = this.rov.yaw + Math.PI + Math.sin(this.titleTime * config.camera.titleOrbitSpeed * 4) * 0.6;
    const { position } = this.rov;
    this.camera.position.set(position.x + Math.sin(angle) * 7, position.y + 0.5, position.z + Math.cos(angle) * 7);
    keepCameraInWater(this.camera.position, position);
    this.cameraTarget.set(position.x, position.y + 2.6, position.z);
  }

  private syncRovModel(): void {
    const { position, velocity, yaw } = this.rov;
    this.rovModel.position.copy(position);
    // At the surface (parked, or floating there) the model rocks gently; the position stays put (REQ-024 AC-1, D-080).
    const bob = surfaceBob(position.y, performance.now() / 1000, this.bob);
    this.rovModel.position.y += bob.lift;
    if (this.ashore) {
      this.rovModel.rotation.set(bob.pitch, yaw, bob.roll, "YXZ");
      return;
    }
    // Lean into the motion: nose up when rising, bank toward a sideways move.
    const sideways = velocity.dot(rightVector(yaw));
    this.rovModel.rotation.set(-velocity.y * 0.06 + bob.pitch, yaw, sideways * 0.05 + bob.roll, "YXZ");
  }

  private resize(): void {
    const { innerWidth: width, innerHeight: height } = window;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
