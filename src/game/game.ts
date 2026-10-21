import {
  AdditiveBlending,
  ConeGeometry,
  type Color,
  type Fog,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { config } from "../config";
import { LOGBOOK_ENTRIES, type LogbookId } from "../logbook/entries";
import { rocks, setFrameColumns } from "./bay";
import { Bloom } from "./bloom";
import { aimDirection, followCamera, keepCameraInWater } from "./follow-camera";
import type { HudState } from "./hud-state";
import { Input } from "./input";
import { createCutterBeam, placeCutterBeam } from "./net-model";
import { placeMarker } from "./marker";
import { buildMinimap } from "./minimap";
import { createReefView, createShotView } from "./reef-model";
import { framePlanted, patchPlanted, ReefField } from "./reef-sites";
import { aimedScanTarget, collectScanTargets, Scanner, type ScanHit } from "./scanner";
import { SeaLife } from "./sea-life";
import { createSeaLifeView } from "./sea-life-model";
import { createRovModel } from "./rov-model";
import { createRovState, rightVector, steer, stepRov, type RovState } from "./rov";
import { Rescue } from "./rescue";
import { findAimPoint, SeedLauncher } from "./seed-launcher";
import { Session } from "./session";
import { distanceToStation, inStationZone, stationPosition } from "./station";
import { createStationModel, STATION_MARKER_HEIGHT } from "./station-model";
import { toolForKey } from "./tools";
import { TrashField } from "./trash";
import { createTrashView } from "./trash-model";
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
}

type Mode = "title" | "playing" | "paused";

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
  private readonly camera = new PerspectiveCamera(config.camera.fov, 1, 0.1, 200);
  private readonly cameraTarget = new Vector3();
  private readonly rovModel = createRovModel();
  private readonly world: World;
  private readonly input: Input;
  private readonly field = new TrashField();
  private readonly trashView = createTrashView(this.field.items);
  private readonly beam = createVacuumBeam();
  // REQ-003: ghost nets, trapped animals, the cutter.
  private readonly rescue = new Rescue();
  private readonly aim = new Vector3();
  private readonly stationAnchor = new Vector3(stationPosition.x, stationPosition.y + STATION_MARKER_HEIGHT, stationPosition.z);
  private readonly viewPoint = new Vector3();
  // REQ-004: reef sites, frames, coral and seagrass, and the seed launcher.
  private readonly reef = new ReefField();
  private readonly reefView = createReefView(this.reef);
  private readonly seeds = new SeedLauncher();
  private readonly seedView = createShotView();
  private readonly seedCamera = new Vector3();
  private readonly seedCameraTarget = new Vector3();
  private readonly seedTarget = new Vector3();
  // REQ-005: the Bloom's clock and the sea life that returns with it.
  private readonly bloom = new Bloom();
  private readonly seaLife = new SeaLife();
  private readonly seaLifeView = createSeaLifeView(this.seaLife);
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
  private lastHud: HudState | null = null;
  private sucking = false;
  private rov: RovState = createRovState();
  private mode: Mode = "title";
  private titleTime = 0;
  private lastFrame: number | null = null;

  constructor(canvas: HTMLCanvasElement, context: WebGL2RenderingContext) {
    this.renderer = new WebGLRenderer({ canvas, context, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.world = buildWorld(this.scene);
    this.scene.add(this.rovModel, createStationModel(), this.trashView.group, this.beam, this.rescue.group, this.scanBeam);
    this.trashView.sync(this.field.items);
    this.scene.add(this.reefView.group, this.seedView.group, this.seaLifeView.group);
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
        trashTotal: () => this.field.total,
        rocks: () => rocks.map((r) => [r.x, r.y, r.z, r.size]),
        station: () => [stationPosition.x, stationPosition.y, stationPosition.z],
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
        // REQ-005: reach the Bloom quickly and read what it changes. (REQ-010's e2e tests use removeTrash too.)
        // Takes n free trash items out of the field and counts them as removed, like the vacuum, but without tank or score.
        removeTrash: (n: number) => {
          let removed = 0;
          for (const item of this.field.items) {
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
        bloom: () => ({ state: this.bloom.state, progress: this.bloom.progress, clarity: this.bloom.clarity, scannerOpen: this.session.bloomDone }),
        water: () => {
          const fog = this.scene.fog as Fog;
          return { background: (this.scene.background as Color).getHex(), fog: fog.color.getHex(), fogNear: fog.near, fogFar: fog.far };
        },
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

  play(): void {
    this.rov = createRovState();
    this.session = new Session(this.field.total);
    this.field.reset();
    this.trashView.sync(this.field.items);
    this.rescue.reset(); // REQ-003
    this.resetReef();
    this.resetBloom(); // REQ-005
    this.scanner.reset(); // REQ-006
    this.scanBeam.visible = false;
    this.sucking = false;
    this.input.clear();
    this.mode = "playing";
  }

  pause(): void {
    this.mode = "paused";
    this.input.clear();
  }

  resume(): void {
    this.input.clear();
    this.mode = "playing";
  }

  private frame(time: number): void {
    const dt = this.lastFrame === null ? 0 : Math.min((time - this.lastFrame) / 1000, 0.1);
    this.lastFrame = time;

    if (this.mode === "playing") {
      const [dx, dy] = this.input.takeMouse();
      steer(this.rov, dx, dy);
      stepRov(this.rov, this.input.move(), dt);
      this.stepTools(dt);
      this.stepBloom(dt); // REQ-005
      this.syncRovModel();
      followCamera(this.rov, this.camera.position, this.cameraTarget);
    } else if (this.mode === "title") {
      this.orbitTitleCamera(dt);
    }
    if (this.mode !== "paused") this.world.update(dt, this.camera.position);

    this.camera.lookAt(this.cameraTarget);
    if (this.mode === "playing") this.publishHud();
    this.renderer.render(this.scene, this.camera);
  }

  /** The vacuum, the tool keys and E, for one simulated frame. */
  private stepTools(dt: number): void {
    const { session, rov } = this;
    for (const code of this.input.takePressed()) {
      session.select(toolForKey(code));
      if (code === "KeyE" && inStationZone(rov.position)) session.deposit();
      else if (code === "KeyE") this.installFrame();
    }

    aimDirection(rov.yaw, rov.pitch, this.aim);
    const held = this.input.primaryHeld() && session.tool === "vacuum";
    const room = session.tankSpace - this.field.pulling;
    this.sucking = held && room > 0;
    for (const _item of this.field.update(dt, rov.position, this.aim, held, room)) session.collect();
    // REQ-003: the cutter, the nets and the animals.
    this.rescue.step(dt, rov, this.aim, this.input.primaryHeld() && session.tool === "cutter", this.field.items, session);
    this.stepSeedLauncher(dt);
    this.stepScanner(dt);
    session.tick(dt);
    this.trashView.sync(this.field.items);

    this.beam.visible = this.sucking;
    if (this.sucking) {
      this.beam.position.copy(rov.position);
      this.beam.lookAt(rov.position.x + this.aim.x, rov.position.y + this.aim.y, rov.position.z + this.aim.z);
      (this.beam.material as MeshBasicMaterial).opacity = 0.07 + 0.03 * Math.sin(performance.now() / 60);
    }
  }

  /**
   * REQ-006: while the Scanner is selected and the button is held, the ray from the camera along the aim must hit a
   * scannable target; held on it for `scanner.seconds` it opens the Logbook entry (AC-1, AC-5, AC-6, AC-7).
   */
  private stepScanner(dt: number): void {
    const { session, rov } = this;
    const scanning = this.input.primaryHeld() && session.tool === "scanner";
    this.scanHit = null;
    if (scanning) {
      followCamera(rov, this.scanCamera, this.scanLookAt);
      const targets = collectScanTargets(this.rescue.animals.animals, this.seaLife.creatures, this.seaLife.scale, this.reef.frames, this.reef.patches);
      this.scanHit = aimedScanTarget(this.scanCamera, this.aim, rov.position, targets);
    }
    const event = this.scanner.update(dt, scanning, this.scanHit, session.unlocked);
    if (event) session.scanned(event);

    const working = this.scanHit !== null && this.scanner.progress > 0;
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
    this.showBloom(this.bloom.clarity);
    if (event === "finished") {
      this.seaLife.start();
      this.session.openScanner();
    }
    this.seaLife.update(dt);
    this.seaLifeView.sync(this.seaLife, dt);
  }

  /** Sets the water, coral and seagrass to a point of the Bloom, only when it changed. */
  private showBloom(clarity: number): void {
    if (clarity === this.bloomShown) return;
    this.bloomShown = clarity;
    this.world.setClarity(clarity);
    this.reefView.setBloom(clarity);
  }

  /** REQ-005: a new dive starts murky, with pale coral, sprouts and no sea life. */
  private resetBloom(): void {
    this.bloom.reset();
    this.seaLife.reset();
    this.showBloom(0);
    this.seaLifeView.sync(this.seaLife, 0);
  }

  /** REQ-004: a new dive starts with no frames, coral or seagrass. */
  private resetReef(): void {
    this.reef.reset();
    setFrameColumns([]);
    this.seeds.clear();
    this.reefView.sync(this.reef);
    this.seedView.sync(this.seeds.shots);
  }

  /** E near an empty reef site: pays 5 materials and installs a frame (AC-2), or says materials are short (AC-3). */
  private installFrame(): void {
    const site = this.reef.emptySiteNear(this.rov.position.x, this.rov.position.z);
    if (site < 0 || !this.session.buyFrame()) return;
    this.reef.install(site);
    setFrameColumns(this.reef.columns());
    this.reefView.sync(this.reef);
  }

  /** The seed launcher: shots fly to the crosshair's target; coral and seeds land on frames and patches (AC-4 to AC-6). */
  private stepSeedLauncher(dt: number): void {
    const { session, rov, seeds } = this;
    let changed = false;
    for (const result of seeds.update(dt, this.reef)) {
      if (result.kind === "coral") session.coralAttached(result.planted);
      else if (result.kind === "seed") session.seedPlanted(result.planted);
      changed ||= result.kind !== "miss";
    }
    if (this.input.primaryHeld() && session.tool === "seedLauncher" && seeds.ready) {
      // The crosshair is the camera's ray along the aim; the shot leaves the ROV and flies to the point that ray hits.
      followCamera(rov, this.seedCamera, this.seedCameraTarget);
      findAimPoint(this.seedCamera, this.aim, this.reef, this.seedTarget);
      seeds.fire(rov.position, this.seedTarget, this.aim);
    }
    if (changed) this.reefView.sync(this.reef);
    this.seedView.sync(seeds.shots);
  }

  private publishHud(): void {
    const { session } = this;
    this.camera.updateMatrixWorld();
    this.viewPoint.copy(this.stationAnchor).applyMatrix4(this.camera.matrixWorldInverse);
    const tanHalfFov = Math.tan((config.camera.fov * Math.PI) / 360);
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
      inStationZone: inStationZone(this.rov.position),
      stationDistance: Math.round(distanceToStation(this.rov.position)),
      marker: placeMarker(this.viewPoint, tanHalfFov, window.innerWidth, window.innerHeight, config.hud.markerMargin, config.hud.markerBottomMargin),
      sucking: this.sucking,
      cutProgress: this.rescue.progress, // REQ-003
      scanProgress: this.scanner.progress, // REQ-006
      unlocked: LOGBOOK_ENTRIES.filter((entry) => session.unlocked.has(entry.id)).map((entry) => entry.id),
      reef: {
        phase2: session.phase2Objectives,
        canInstall: !inStationZone(this.rov.position) && this.reef.emptySiteNear(this.rov.position.x, this.rov.position.z) >= 0,
      },
      // REQ-005: the Phase 3 list, empty until the Bloom is over.
      phase3: session.phase3Objectives,
      // REQ-010
      minimap: buildMinimap({
        rov: { x: this.rov.position.x, z: this.rov.position.z, yaw: this.rov.yaw },
        frames: this.reef.frames,
        patches: this.reef.patches,
        nets: this.rescue.nets.nets,
        trash: this.field.items,
        cleanliness: session.cleanliness,
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
    keepCameraInWater(this.camera.position);
    this.cameraTarget.set(position.x, position.y + 2.6, position.z);
  }

  private syncRovModel(): void {
    const { position, velocity, yaw } = this.rov;
    this.rovModel.position.copy(position);
    // Lean into the motion: nose up when rising, bank toward a sideways move.
    const sideways = velocity.dot(rightVector(yaw));
    this.rovModel.rotation.set(-velocity.y * 0.06, yaw, sideways * 0.05, "YXZ");
  }

  private resize(): void {
    const { innerWidth: width, innerHeight: height } = window;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
