import {
  AdditiveBlending,
  ConeGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { config } from "../config";
import { rocks } from "./bay";
import { aimDirection, followCamera, keepCameraInWater } from "./follow-camera";
import type { HudState } from "./hud-state";
import { Input } from "./input";
import { placeMarker } from "./marker";
import { createRovModel } from "./rov-model";
import { createRovState, rightVector, steer, stepRov, type RovState } from "./rov";
import { Rescue } from "./rescue";
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
    this.scene.add(this.rovModel, createStationModel(), this.trashView.group, this.beam, this.rescue.group);
    this.trashView.sync(this.field.items);
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
        placeRov: (x: number, y: number, z: number, yaw: number, pitch: number) => {
          this.rov.position.set(x, y, z);
          this.rov.velocity.set(0, 0, 0);
          this.rov.yaw = yaw;
          this.rov.pitch = pitch;
        },
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
    }

    aimDirection(rov.yaw, rov.pitch, this.aim);
    const held = this.input.primaryHeld() && session.tool === "vacuum";
    const room = session.tankSpace - this.field.pulling;
    this.sucking = held && room > 0;
    for (const _item of this.field.update(dt, rov.position, this.aim, held, room)) session.collect();
    // REQ-003: the cutter, the nets and the animals.
    this.rescue.step(dt, rov, this.aim, this.input.primaryHeld() && session.tool === "cutter", this.field.items, session);
    session.tick(dt);
    this.trashView.sync(this.field.items);

    this.beam.visible = this.sucking;
    if (this.sucking) {
      this.beam.position.copy(rov.position);
      this.beam.lookAt(rov.position.x + this.aim.x, rov.position.y + this.aim.y, rov.position.z + this.aim.z);
      (this.beam.material as MeshBasicMaterial).opacity = 0.07 + 0.03 * Math.sin(performance.now() / 60);
    }
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
      marker: placeMarker(this.viewPoint, tanHalfFov, window.innerWidth, window.innerHeight, config.hud.markerMargin),
      sucking: this.sucking,
      cutProgress: this.rescue.progress, // REQ-003
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
