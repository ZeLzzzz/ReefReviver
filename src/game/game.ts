import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { config } from "../config";
import { followCamera, keepCameraInWater } from "./follow-camera";
import { Input } from "./input";
import { createRovModel } from "./rov-model";
import { createRovState, rightVector, steer, stepRov, type RovState } from "./rov";
import { buildWorld, type World } from "./world";

/** What the app shell needs from the game. */
export interface GameView {
  /** Starts a new dive from the start position. */
  play(): void;
  /** Freezes the game; nothing moves until resume(). */
  pause(): void;
  resume(): void;
}

type Mode = "title" | "playing" | "paused";

export class Game implements GameView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(config.camera.fov, 1, 0.1, 200);
  private readonly cameraTarget = new Vector3();
  private readonly rovModel = createRovModel();
  private readonly world: World;
  private readonly input: Input;
  private rov: RovState = createRovState();
  private mode: Mode = "title";
  private titleTime = 0;
  private lastFrame: number | null = null;

  constructor(canvas: HTMLCanvasElement, context: WebGL2RenderingContext) {
    this.renderer = new WebGLRenderer({ canvas, context, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.world = buildWorld(this.scene);
    this.scene.add(this.rovModel);
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
      };
    }
  }

  play(): void {
    this.rov = createRovState();
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
      this.syncRovModel();
      followCamera(this.rov, this.camera.position, this.cameraTarget);
    } else if (this.mode === "title") {
      this.orbitTitleCamera(dt);
    }
    if (this.mode !== "paused") this.world.update(dt, this.camera.position);

    this.camera.lookAt(this.cameraTarget);
    this.renderer.render(this.scene, this.camera);
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
