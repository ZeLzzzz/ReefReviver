import "./ui/style.css";
import { App } from "./app";
import { loadAssets } from "./assets";
import { AudioEngine } from "./audio/engine";
import { config } from "./config";
import { Game } from "./game/game";
import { browserStorage } from "./i18n/i18n";
import { getWebGL2Context, isPhoneOrTablet, readDeviceInfo, screenOrientation } from "./platform";
import { domPointerLock, touchPointerLock } from "./ui/pointer-lock";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;

// REQ-026: the sound is made once and lives as long as the page, so the volumes and M survive "Main lagi" (AC-6).
// It makes no sound until a click lets the browser (AC-1); the music file is fetched as the game is made, so it is ready by then.
const audio = new AudioEngine({ debug: import.meta.env.DEV });

// REQ-030: phones and tablets play with touch controls, sideways, with a lighter picture.
const touch = isPhoneOrTablet(readDeviceInfo(navigator));

new App({
  ui: document.querySelector<HTMLElement>("#ui")!,
  browserLanguages: navigator.languages?.length ? navigator.languages : [navigator.language],
  storage: browserStorage(window),
  phoneOrTablet: touch,
  orientation: touch ? screenOrientation(window) : undefined,
  getWebGL2: () => getWebGL2Context(canvas, !touch || config.touch.antialias),
  createGame: (context) => {
    audio.preload();
    return new Game(canvas, context, audio, { touch });
  },
  pointerLock: touch ? touchPointerLock(document) : domPointerLock(canvas),
  loadAssets: (onProgress) => loadAssets(onProgress),
  audio,
}).boot();

if (import.meta.env.DEV) {
  const params = new URLSearchParams(location.search);
  if (params.has("fps")) showFrameRate();
  if (params.has("bloom")) bloomOnStart();
}

/**
 * Development only: `?bloom` cleans and plants the bay as soon as the dive begins, so the Bloom comes at once and the
 * heaviest picture (after it) can be measured on a phone in a minute (REQ-030 AC-7).
 */
function bloomOnStart(): void {
  const hooks = () => (window as unknown as { __reef?: Record<string, (...args: unknown[]) => unknown> }).__reef;
  const wait = setInterval(() => {
    const reef = hooks();
    if (!reef || reef.mode() !== "playing") return;
    clearInterval(wait);
    reef.removeTrash(Math.ceil(config.trash.count * 0.85));
    reef.plantAll("all");
  }, 500);
}

/**
 * Development only: `?fps` in the address shows the frame rate in a corner (the average over the last second and the
 * longest frame in it), so it can be read off a phone that has no developer tools open (REQ-030 AC-7).
 */
function showFrameRate(): void {
  const label = document.createElement("output");
  label.className = "fps";
  document.body.append(label);
  let frames = 0;
  let longest = 0;
  let since = performance.now();
  let last = since;
  const tick = (now: number) => {
    frames += 1;
    longest = Math.max(longest, now - last);
    last = now;
    if (now - since >= 1000) {
      label.textContent = `${Math.round((frames * 1000) / (now - since))} fps · ${Math.round(longest)} ms`;
      frames = 0;
      longest = 0;
      since = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
