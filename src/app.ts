import { silentAudio, type AppAudio } from "./audio/types";
import type { GameView } from "./game/game";
import type { HudState } from "./game/hud-state";
import type { SessionSummary } from "./game/session";
import type { LogbookId } from "./logbook/entries";
import { initialLanguage, saveLanguage, t, type Lang, type StorageLike, type StringKey } from "./i18n/i18n";
import type { Orientation } from "./platform";
import type { PointerLock } from "./ui/pointer-lock";
import { credits } from "./credits";
import { creditsScreen } from "./ui/credits";
import { endScreen } from "./ui/end";
import { createHud, type HudView } from "./ui/hud";
import { createLoadingScreen, type LoadingView } from "./ui/loading";
import { logbookScreen } from "./ui/logbook";
import { missionScreen } from "./ui/mission";
import { h, messageScreen, pauseMenu, rotateMessage, titleScreen, type PauseView } from "./ui/screens";
import type { TouchHud } from "./ui/touch";

export type Screen = "loading" | "title" | "credits" | "playing" | "mission" | "paused" | "logbook" | "end" | "noWebgl" | "assetError";

export interface AppDeps {
  /** Where the screens are drawn, over the canvas. */
  ui: HTMLElement;
  browserLanguages: readonly string[];
  storage: StorageLike | null;
  /** REQ-030: a phone or tablet, played with touch controls (its `pointerLock` asks for the full screen instead). */
  phoneOrTablet: boolean;
  /** REQ-030 AC-6: the screen's orientation on a phone or tablet; held upright, a message covers the game and it pauses. */
  orientation?: Orientation;
  getWebGL2: () => WebGL2RenderingContext | null;
  createGame: (context: WebGL2RenderingContext) => GameView;
  pointerLock: PointerLock;
  /** Loads the game's files, reporting progress (0 to 1); rejects when one cannot be loaded (REQ-009). Without it, the game starts at once. */
  loadAssets?: (onProgress: (fraction: number) => void) => Promise<void>;
  /** The game's sound (REQ-026); without it the screens are silent. */
  audio?: AppAudio;
  /** REQ-040: `?presenter` in the address: P skips a phase and B calls the dumping boat while playing, and a tag says so. */
  presenter?: boolean;
}

/** Screen flow around the game: loading, title, credits, playing, the mission card, pause, the Marine Logbook, the end screen, and the messages for unsupported browsers and for a phone held upright. */
export class App {
  screen: Screen = "title";
  lang: Lang;
  private pauseView: PauseView = "main";
  private notice: StringKey | null = null;
  private game: GameView | null = null;
  private hudView: HudView | null = null;
  private hudState: HudState | null = null;
  /** The Logbook entry shown while the Logbook is open (REQ-006). */
  private logbookEntry: LogbookId | null = null;
  private loadingView: LoadingView | null = null;
  /** REQ-008: what the end screen shows, and which of its buttons was pressed. */
  private summary: SessionSummary | null = null;
  private endChoice: "replay" | "explore" = "explore";
  private readonly audio: AppAudio;
  /** REQ-026 AC-7: the window has lost focus (the tab being hidden is read from the document). */
  private blurred = false;

  constructor(private readonly deps: AppDeps) {
    this.lang = initialLanguage(deps.storage, deps.browserLanguages);
    this.audio = deps.audio ?? silentAudio;
  }

  /** Resolves once the title screen (or an error screen) is up; with no `loadAssets`, that happens before it returns. */
  async boot(): Promise<void> {
    const doc = this.deps.ui.ownerDocument;
    doc.documentElement.lang = this.lang;
    doc.documentElement.classList.toggle("touch", this.deps.phoneOrTablet);
    this.deps.orientation?.onChange(() => this.orientationChanged());
    const context = this.deps.getWebGL2();
    if (!context) return this.show("noWebgl");

    if (this.deps.loadAssets) {
      this.show("loading");
      try {
        await this.deps.loadAssets((fraction) => this.loadingView?.update(fraction));
      } catch (error) {
        console.error("Could not load the game files:", error);
        return this.show("assetError");
      }
    }
    this.start(context);
  }

  private start(context: WebGL2RenderingContext): void {
    const doc = this.deps.ui.ownerDocument;
    this.game = this.deps.createGame(context);
    this.game.onHud((state) => {
      this.hudState = state;
      this.hudView?.update(state);
    });
    this.game.onEnd((summary) => this.showEnd(summary));
    this.game.onOpeningEnd?.(() => this.showMission());
    this.deps.pointerLock.onChange((locked) => this.lockChanged(locked));
    doc.defaultView!.addEventListener("keydown", (event) => this.keyDown(event));
    // Losing the cursor or the window (alt-tab, another tab) pauses the game (AC-6).
    doc.defaultView!.addEventListener("blur", () => {
      this.blurred = true;
      this.pause();
      this.audio.setInactive(true);
    });
    doc.defaultView!.addEventListener("focus", () => {
      this.blurred = false;
      this.audio.setInactive(doc.hidden);
    });
    doc.addEventListener("visibilitychange", () => {
      if (doc.hidden) this.pause();
      this.audio.setInactive(doc.hidden || this.blurred);
    });
    // REQ-026 AC-3: every menu button clicks. The first click is also what lets the browser play sound at all.
    this.deps.ui.addEventListener("click", (event) => {
      if (!(event.target instanceof Element) || !event.target.closest("button")) return;
      this.audio.unlock();
      this.audio.play("click");
    });
    this.show("title");
  }

  setLanguage(lang: Lang): void {
    this.lang = lang;
    saveLanguage(this.deps.storage, lang);
    this.deps.ui.ownerDocument.documentElement.lang = lang;
    this.render();
  }

  /** AC-6: turned upright the game pauses under the message; turned back, the pause menu is there to resume from (D-118). */
  private orientationChanged(): void {
    if (this.deps.orientation?.portrait()) this.pause();
    this.render();
  }

  /** REQ-026 AC-5: M (or the sound button, REQ-030) mutes and unmutes all sound while playing; the HUD shows a tag while it is off. */
  private toggleMute(): void {
    this.audio.setMuted(!this.audio.settings.muted);
    this.hudView?.setMuted(this.audio.settings.muted);
  }

  /** REQ-030: the touch controls drive the game's input; their menu buttons do what Esc, L and M do (AC-4). Null on a computer. */
  private touchHud(): TouchHud | null {
    const input = this.game?.touchInput?.();
    if (!this.deps.phoneOrTablet || !input) return null;
    return {
      input,
      onPause: () => this.pause(),
      onLogbook: () => {
        if (!this.game?.cinematic?.()) this.openLogbook();
      },
      onMute: () => this.toggleMute(),
    };
  }

  pause(): void {
    if (this.screen !== "playing") return;
    this.game!.pause();
    this.pauseView = "main";
    this.show("paused");
    this.deps.pointerLock.exit();
  }

  /**
   * L opens the Marine Logbook (REQ-006 AC-2): the game stops like in the pause menu and the cursor is released, so
   * the player can click entries and links. The screen is switched first, so the unlock does not count as a pause.
   */
  private openLogbook(): void {
    if (this.screen !== "playing") return;
    this.game!.pause();
    this.logbookEntry = this.hudState?.unlocked?.[0] ?? null;
    this.show("logbook");
    this.deps.pointerLock.exit();
  }

  /** L or Esc closes the Logbook and locks the cursor again. If the browser refuses the lock, the pause menu takes over. */
  private async closeLogbook(): Promise<void> {
    if (await this.deps.pointerLock.request() || this.screen !== "logbook") return;
    this.pauseView = "main";
    this.screen = "paused";
    this.notice = "pause.lockFailed";
    this.render();
  }

  /**
   * REQ-029 AC-1: the opening cinematic is over (finished or skipped); the mission card stops the game like the pause menu
   * and frees the cursor for its button. The screen is switched first, so the unlock does not count as a pause.
   */
  private showMission(): void {
    if (this.screen !== "playing") return;
    this.game!.pause();
    this.show("mission");
    this.deps.pointerLock.exit();
  }

  /** AC-4: Mulai menyelam (or Enter) locks the cursor again; once it is locked, the dive goes on with the HUD. */
  private leaveMission(): void {
    if (this.screen === "mission") void this.lockCursor("mission.lockFailed");
  }

  /**
   * REQ-008: the 7th entry's notice has been read; the end screen stops the game like the pause menu and frees the
   * cursor for its buttons. The screen is switched first, so the unlock does not count as a pause.
   */
  private showEnd(summary: SessionSummary): void {
    this.game!.pause();
    this.summary = summary;
    this.show("end");
    this.deps.pointerLock.exit();
  }

  /** Main lagi (AC-3) and Lanjut menjelajah (AC-5) both lock the cursor; once it is locked, the choice is carried out. */
  private leaveEnd(choice: "replay" | "explore"): void {
    this.endChoice = choice;
    void this.lockCursor("end.lockFailed");
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
    if (this.screen === "title" || (this.screen === "end" && this.endChoice === "replay")) this.game!.play();
    else if (this.screen === "end") this.game!.resume();
    else if (this.screen === "paused" || this.screen === "logbook" || this.screen === "mission") this.game!.resume();
    else return;
    this.show("playing");
  }

  private keyDown(event: KeyboardEvent): void {
    // REQ-029 AC-4: Enter does what the card's button does (the button's own click for Enter is left out, so it counts once).
    if (event.code === "Enter" && this.screen === "mission") {
      event.preventDefault();
      if (!event.repeat) this.leaveMission();
      return;
    }
    if (event.code === "KeyM" && !event.repeat && this.screen === "playing") this.toggleMute();
    // REQ-040: the presenter's shortcuts, only in presenter mode and while playing (the game ignores them in a cinematic).
    if (this.deps.presenter && this.screen === "playing" && !event.repeat && (event.code === "KeyP" || event.code === "KeyB")) {
      this.game?.presenter?.(event.code === "KeyP" ? "phase" : "boat");
    }
    if (event.code === "KeyL" && !event.repeat) {
      // REQ-027 AC-4: during a cinematic L does nothing.
      if (this.screen === "playing" && !this.game?.cinematic?.()) this.openLogbook();
      else if (this.screen === "logbook") void this.closeLogbook();
    }
    if (event.code !== "Escape") return;
    if (this.screen === "playing") this.pause();
    else if (this.screen === "logbook") void this.closeLogbook();
    else if (this.screen === "paused" && this.pauseView !== "main") this.showPauseView("main");
    else if (this.screen === "credits") this.show("title");
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
    const touch = this.deps.phoneOrTablet;
    this.hudView = null;
    this.loadingView = null;
    // REQ-026 AC-7: while paused, in the Logbook or on the end screen the ambience and effects stop and the music quietens;
    // REQ-029 AC-7: so it does on the mission card.
    const quiet = this.screen === "paused" || this.screen === "logbook" || this.screen === "end" || this.screen === "mission";
    this.audio.setPhase(quiet ? "quiet" : "playing");
    const onLanguage = (choice: Lang) => this.setLanguage(choice);
    let content: HTMLElement;
    switch (this.screen) {
      case "loading":
        this.loadingView = createLoadingScreen(lang);
        content = this.loadingView.element;
        break;
      case "title":
        content = titleScreen({
          lang,
          notice,
          onStart: () => {
            this.audio.start(); // REQ-026 AC-1: this click is what lets the music and the ambience begin
            void this.lockCursor("title.lockFailed");
          },
          onCredits: () => this.show("credits"),
          onLanguage,
        });
        break;
      case "credits":
        content = creditsScreen({ lang, credits, onBack: () => this.show("title") });
        break;
      case "playing":
        // The HUD is rebuilt for the current language and shows the latest state at once.
        this.hudView = createHud(lang, this.touchHud());
        this.hudView.setMuted(this.audio.settings.muted);
        if (this.hudState) this.hudView.update(this.hudState);
        // REQ-027: the game's cinematic now, not the last state's: a dive that has just begun has not published one yet.
        this.hudView.setCinematic(this.game?.cinematic?.() ?? null);
        content = this.hudView.element;
        break;
      case "mission":
        content = missionScreen({ lang, notice, touch, onStart: () => this.leaveMission() });
        break;
      case "paused":
        content = pauseMenu({
          lang,
          notice,
          view: this.pauseView,
          touch,
          onResume: () => this.lockCursor("pause.lockFailed"),
          onView: (view) => this.showPauseView(view),
          onLanguage,
          sound: {
            music: this.audio.settings.music,
            effects: this.audio.settings.effects,
            available: this.audio.available,
            onMusic: (volume) => this.audio.setMusicVolume(volume),
            onEffects: (volume) => this.audio.setEffectsVolume(volume),
            onEffectsDone: () => this.audio.play("click"),
          },
        });
        break;
      case "end":
        content = endScreen({
          lang,
          summary: this.summary!,
          notice,
          onReplay: () => this.leaveEnd("replay"),
          onExplore: () => this.leaveEnd("explore"),
        });
        break;
      case "logbook":
        content = logbookScreen({
          lang,
          unlocked: this.hudState?.unlocked ?? [],
          selected: this.logbookEntry,
          touch,
          onSelect: (id) => {
            this.logbookEntry = id;
            this.render();
          },
          onClose: () => void this.closeLogbook(),
        });
        break;
      case "noWebgl":
        content = messageScreen(lang, "noWebgl.title", "noWebgl.body", "noWebgl.reload");
        break;
      case "assetError":
        content = messageScreen(lang, "assetError.title", "assetError.body", "assetError.reload");
        break;
    }
    // REQ-030 AC-6: held upright, the message covers whatever screen is up.
    // REQ-040: in presenter mode a tag in the corner reminds the presenter of the keys, over every screen.
    const tag = this.deps.presenter ? [h("p", { class: "presenter-tag" }, t(lang, "presenter.tag"))] : [];
    if (touch && this.deps.orientation?.portrait()) this.deps.ui.replaceChildren(content, rotateMessage(lang), ...tag);
    else this.deps.ui.replaceChildren(content, ...tag);
  }
}
