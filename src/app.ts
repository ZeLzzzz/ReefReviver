import type { GameView } from "./game/game";
import { initialLanguage, saveLanguage, type Lang, type StorageLike, type StringKey } from "./i18n/i18n";
import type { PointerLock } from "./ui/pointer-lock";
import { hud, messageScreen, pauseMenu, titleScreen, type PauseView } from "./ui/screens";

export type Screen = "title" | "playing" | "paused" | "unsupported" | "noWebgl";

export interface AppDeps {
  /** Where the screens are drawn, over the canvas. */
  ui: HTMLElement;
  browserLanguages: readonly string[];
  storage: StorageLike | null;
  phoneOrTablet: boolean;
  getWebGL2: () => WebGL2RenderingContext | null;
  createGame: (context: WebGL2RenderingContext) => GameView;
  pointerLock: PointerLock;
}

/** Screen flow around the game: title, playing, pause, and the messages for unsupported browsers. */
export class App {
  screen: Screen = "title";
  lang: Lang;
  private pauseView: PauseView = "main";
  private notice: StringKey | null = null;
  private game: GameView | null = null;

  constructor(private readonly deps: AppDeps) {
    this.lang = initialLanguage(deps.storage, deps.browserLanguages);
  }

  boot(): void {
    const doc = this.deps.ui.ownerDocument;
    doc.documentElement.lang = this.lang;
    if (this.deps.phoneOrTablet) return this.show("unsupported");
    const context = this.deps.getWebGL2();
    if (!context) return this.show("noWebgl");

    this.game = this.deps.createGame(context);
    this.deps.pointerLock.onChange((locked) => this.lockChanged(locked));
    doc.defaultView!.addEventListener("keydown", (event) => this.keyDown(event));
    // Losing the cursor or the window (alt-tab, another tab) pauses the game (AC-6).
    doc.defaultView!.addEventListener("blur", () => this.pause());
    doc.addEventListener("visibilitychange", () => doc.hidden && this.pause());
    this.show("title");
  }

  setLanguage(lang: Lang): void {
    this.lang = lang;
    saveLanguage(this.deps.storage, lang);
    this.deps.ui.ownerDocument.documentElement.lang = lang;
    this.render();
  }

  pause(): void {
    if (this.screen !== "playing") return;
    this.game!.pause();
    this.pauseView = "main";
    this.show("paused");
    this.deps.pointerLock.exit();
  }

  /** Mulai and Lanjut lock the cursor; the game starts or resumes once the lock is in place. */
  private async lockCursor(failedKey: StringKey): Promise<void> {
    this.notice = null;
    if (!(await this.deps.pointerLock.request()) && this.screen !== "playing") {
      this.notice = failedKey;
      this.render();
    }
  }

  private lockChanged(locked: boolean): void {
    if (!locked) return this.pause();
    if (this.screen === "title") this.game!.play();
    else if (this.screen === "paused") this.game!.resume();
    else return;
    this.show("playing");
  }

  private keyDown(event: KeyboardEvent): void {
    if (event.code !== "Escape") return;
    if (this.screen === "playing") this.pause();
    else if (this.screen === "paused" && this.pauseView !== "main") this.showPauseView("main");
  }

  private showPauseView(view: PauseView): void {
    this.pauseView = view;
    this.notice = null;
    this.render();
  }

  private show(screen: Screen): void {
    this.screen = screen;
    this.notice = null;
    this.render();
  }

  private render(): void {
    const { lang, notice } = this;
    const onLanguage = (choice: Lang) => this.setLanguage(choice);
    let content: HTMLElement;
    switch (this.screen) {
      case "title":
        content = titleScreen({ lang, notice, onStart: () => this.lockCursor("title.lockFailed"), onLanguage });
        break;
      case "playing":
        content = hud();
        break;
      case "paused":
        content = pauseMenu({
          lang,
          notice,
          view: this.pauseView,
          onResume: () => this.lockCursor("pause.lockFailed"),
          onView: (view) => this.showPauseView(view),
          onLanguage,
        });
        break;
      case "unsupported":
        content = messageScreen(lang, "unsupported.title", "unsupported.body");
        break;
      case "noWebgl":
        content = messageScreen(lang, "noWebgl.title", "noWebgl.body", "noWebgl.reload");
        break;
    }
    this.deps.ui.replaceChildren(content);
  }
}
