import { forTouch, LANGUAGES, t, type Lang, type StringKey } from "../i18n/i18n";

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | ((event: Event) => void)>;

/** Builds an element; `onclick`-style keys become listeners, strings are added as text, never as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (typeof value === "function") element.addEventListener(name.slice(2), value);
    else element.setAttribute(name, value);
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

function button(text: string, onClick: () => void, className = ""): HTMLButtonElement {
  return h("button", { type: "button", class: className, onclick: onClick }, text);
}

function notice(lang: Lang, key: StringKey | null): Child {
  return key && h("p", { class: "notice", role: "alert" }, t(lang, key));
}

function languagePicker(lang: Lang, labelKey: StringKey, onLanguage: (lang: Lang) => void): HTMLElement {
  const label = t(lang, labelKey);
  return h(
    "div",
    { class: "language-picker", role: "group", "aria-label": label },
    h("span", {}, label),
    ...LANGUAGES.map((option) => {
      const choice = button(t(lang, `language.${option}`), () => onLanguage(option));
      choice.setAttribute("aria-pressed", String(option === lang));
      return choice;
    }),
  );
}

export interface TitleProps {
  lang: Lang;
  notice: StringKey | null;
  onStart: () => void;
  onCredits: () => void;
  onLanguage: (lang: Lang) => void;
}

export function titleScreen({ lang, notice: noticeKey, onStart, onCredits, onLanguage }: TitleProps): HTMLElement {
  return h(
    "main",
    { class: "screen title-screen" },
    h("h1", { class: "game-name" }, t(lang, "game.name")),
    button(t(lang, "title.start"), onStart, "primary"),
    languagePicker(lang, "title.language", onLanguage),
    button(t(lang, "title.credits"), onCredits),
    notice(lang, noticeKey),
  );
}

export type PauseView = "main" | "controls" | "sound" | "language";

/** REQ-026 AC-6: the Sound view's sliders (0 to 1) and where they start. */
export interface SoundProps {
  music: number;
  effects: number;
  /** False when the browser cannot make sound: the sliders stay, with a note that they do nothing. */
  available: boolean;
  onMusic: (volume: number) => void;
  onEffects: (volume: number) => void;
  /** The effects slider was let go: a click lets the player hear the new level. */
  onEffectsDone: () => void;
}

export interface PauseProps {
  lang: Lang;
  view: PauseView;
  notice: StringKey | null;
  onResume: () => void;
  onView: (view: PauseView) => void;
  onLanguage: (lang: Lang) => void;
  sound: SoundProps;
  /** REQ-030 AC-5: on a phone or tablet the Controls list names the touch controls. */
  touch?: boolean;
}

// Only the controls that work so far; each REQ that adds a control adds its row (D-019).
const CONTROLS = ["move", "rise", "dive", "look", "use", "cutter", "vacuum", "seed", "scanner", "interact", "logbook", "mute", "pause"] as const;

/** A volume slider, 0 to 100 %, that applies as it moves; the percentage beside it is updated without redrawing the screen. */
function volumeSlider(lang: Lang, id: string, labelKey: StringKey, value: number, onInput: (volume: number) => void, onDone?: () => void): HTMLElement {
  const percent = (v: number) => `${Math.round(v)}%`;
  const output = h("output", { for: id }, percent(value * 100));
  const input = h("input", { id, type: "range", min: "0", max: "100", step: "1", value: String(Math.round(value * 100)) });
  input.addEventListener("input", () => {
    output.textContent = percent(input.valueAsNumber);
    onInput(input.valueAsNumber / 100);
  });
  if (onDone) input.addEventListener("change", onDone);
  return h("div", { class: "slider-row" }, h("label", { for: id }, t(lang, labelKey)), input, output);
}

export function pauseMenu({ lang, view, notice: noticeKey, onResume, onView, onLanguage, sound, touch = false }: PauseProps): HTMLElement {
  const back = button(t(lang, "pause.back"), () => onView("main"));
  let body: Child[];
  if (view === "controls") {
    body = [
      h(
        "dl",
        { class: "controls" },
        ...CONTROLS.flatMap((control) => [
          h("dt", {}, h("kbd", {}, t(lang, forTouch(`controls.${control}.keys`, touch)))),
          h("dd", {}, t(lang, `controls.${control}.action`)),
        ]),
      ),
      back,
    ];
  } else if (view === "sound") {
    body = [
      volumeSlider(lang, "volume-music", "sound.music", sound.music, sound.onMusic),
      volumeSlider(lang, "volume-effects", "sound.effects", sound.effects, sound.onEffects, sound.onEffectsDone),
      !sound.available && h("p", { class: "notice" }, t(lang, "sound.unavailable")),
      back,
    ];
  } else if (view === "language") {
    body = [languagePicker(lang, "pause.language", onLanguage), back];
  } else {
    body = [
      button(t(lang, "pause.resume"), onResume, "primary"),
      button(t(lang, "pause.controls"), () => onView("controls")),
      button(t(lang, "pause.sound"), () => onView("sound")),
      button(t(lang, "pause.language"), () => onView("language")),
      notice(lang, noticeKey),
    ];
  }
  return h(
    "div",
    { class: "screen pause-screen" },
    h("section", { class: "panel", role: "dialog", "aria-label": t(lang, "pause.title") }, h("h2", {}, t(lang, "pause.title")), ...body),
  );
}

/** REQ-030 AC-6: over everything while a phone or tablet is held upright. */
export function rotateMessage(lang: Lang): HTMLElement {
  return h(
    "div",
    { class: "screen rotate-screen", role: "alertdialog", "aria-label": t(lang, "rotate.title") },
    h("div", { class: "rotate-icon", "aria-hidden": "true" }),
    h("h1", {}, t(lang, "rotate.title")),
    h("p", {}, t(lang, "rotate.body")),
  );
}

export function messageScreen(lang: Lang, titleKey: StringKey, bodyKey: StringKey, reloadKey?: StringKey): HTMLElement {
  return h(
    "main",
    { class: "screen message-screen" },
    h(
      "section",
      { class: "panel" },
      h("h1", {}, t(lang, titleKey)),
      h("p", {}, t(lang, bodyKey)),
      reloadKey && button(t(lang, reloadKey), () => location.reload(), "primary"),
    ),
  );
}
