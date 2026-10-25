import "./ui/style.css";
import { App } from "./app";
import { loadAssets } from "./assets";
import { AudioEngine } from "./audio/engine";
import { Game } from "./game/game";
import { browserStorage } from "./i18n/i18n";
import { getWebGL2Context, isPhoneOrTablet, readDeviceInfo } from "./platform";
import { domPointerLock } from "./ui/pointer-lock";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;

// REQ-026: the sound is made once and lives as long as the page, so the volumes and M survive "Main lagi" (AC-6).
// It makes no sound until a click lets the browser (AC-1); the music file is fetched as the game is made, so it is ready by then.
const audio = new AudioEngine({ debug: import.meta.env.DEV });

new App({
  ui: document.querySelector<HTMLElement>("#ui")!,
  browserLanguages: navigator.languages?.length ? navigator.languages : [navigator.language],
  storage: browserStorage(window),
  phoneOrTablet: isPhoneOrTablet(readDeviceInfo(navigator)),
  getWebGL2: () => getWebGL2Context(canvas),
  createGame: (context) => {
    audio.preload();
    return new Game(canvas, context, audio);
  },
  pointerLock: domPointerLock(canvas),
  loadAssets: (onProgress) => loadAssets(onProgress),
  audio,
}).boot();
