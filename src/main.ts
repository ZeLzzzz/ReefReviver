import "./ui/style.css";
import { App } from "./app";
import { Game } from "./game/game";
import { browserStorage } from "./i18n/i18n";
import { getWebGL2Context, isPhoneOrTablet, readDeviceInfo } from "./platform";
import { domPointerLock } from "./ui/pointer-lock";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;

new App({
  ui: document.querySelector<HTMLElement>("#ui")!,
  browserLanguages: navigator.languages?.length ? navigator.languages : [navigator.language],
  storage: browserStorage(window),
  phoneOrTablet: isPhoneOrTablet(readDeviceInfo(navigator)),
  getWebGL2: () => getWebGL2Context(canvas),
  createGame: (context) => new Game(canvas, context),
  pointerLock: domPointerLock(canvas),
}).boot();
