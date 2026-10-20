import { LANGUAGES, t, type Lang, type StringKey } from "../i18n/i18n";

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
  onLanguage: (lang: Lang) => void;
}

export function titleScreen({ lang, notice: noticeKey, onStart, onLanguage }: TitleProps): HTMLElement {
  return h(
    "main",
    { class: "screen title-screen" },
    h("h1", { class: "game-name" }, t(lang, "game.name")),
    button(t(lang, "title.start"), onStart, "primary"),
    languagePicker(lang, "title.language", onLanguage),
    notice(lang, noticeKey),
  );
}

export type PauseView = "main" | "controls" | "language";

export interface PauseProps {
  lang: Lang;
  view: PauseView;
  notice: StringKey | null;
  onResume: () => void;
  onView: (view: PauseView) => void;
  onLanguage: (lang: Lang) => void;
}

// Only the controls that work so far; each REQ that adds a control adds its row (D-019).
const CONTROLS = ["move", "rise", "dive", "look", "use", "cutter", "vacuum", "interact", "pause"] as const;

export function pauseMenu({ lang, view, notice: noticeKey, onResume, onView, onLanguage }: PauseProps): HTMLElement {
  const back = button(t(lang, "pause.back"), () => onView("main"));
  let body: Child[];
  if (view === "controls") {
    body = [
      h(
        "dl",
        { class: "controls" },
        ...CONTROLS.flatMap((control) => [
          h("dt", {}, h("kbd", {}, t(lang, `controls.${control}.keys`))),
          h("dd", {}, t(lang, `controls.${control}.action`)),
        ]),
      ),
      back,
    ];
  } else if (view === "language") {
    body = [languagePicker(lang, "pause.language", onLanguage), back];
  } else {
    body = [
      button(t(lang, "pause.resume"), onResume, "primary"),
      button(t(lang, "pause.controls"), () => onView("controls")),
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
