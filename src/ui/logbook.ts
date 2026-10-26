import { LOGBOOK_ENTRIES, logbookKeys, type LogbookEntry, type LogbookId } from "../logbook/entries";
import { forTouch, t, type Lang } from "../i18n/i18n";
import { h } from "./screens";

export interface LogbookProps {
  lang: Lang;
  /** The entries the player has scanned. */
  unlocked: readonly LogbookId[];
  /** The entry shown on the right, or null for none. Only an unlocked entry can be shown. */
  selected: LogbookId | null;
  onSelect: (id: LogbookId) => void;
  onClose: () => void;
  /** REQ-030 AC-5: on a phone or tablet the hints name the buttons, not the keys. */
  touch?: boolean;
}

const SVG = "http://www.w3.org/2000/svg";

type Shape = "animal" | "coral" | "seagrass";

const SHAPE_OF: Record<LogbookId, Shape> = {
  turtle: "animal",
  reefShark: "animal",
  clownfish: "animal",
  mantaRay: "animal",
  dolphin: "animal",
  coral: "coral",
  seagrass: "seagrass",
};

/** Plain shapes, 64 x 40. `fill` ones are solid, the others are drawn as lines. */
const SHAPES: Record<Shape, { path: string; fill: boolean }> = {
  animal: { path: "M6 20 C14 6 40 6 50 20 C40 34 14 34 6 20 Z M50 20 L62 8 L62 32 Z", fill: true },
  coral: { path: "M32 38 V22 M32 28 L20 16 M32 24 L44 10 M20 16 V8 M44 10 V4 M32 22 V6", fill: false },
  seagrass: { path: "M16 38 C14 26 16 14 12 4 M28 38 C28 26 32 14 30 2 M40 38 C42 28 40 18 48 8", fill: false },
};

/**
 * The picture of an entry: a dark silhouette until it is scanned, a lighter one after. These are stand-ins until
 * the artist's pictures arrive (D-022); swap this one function for an image of `id` and nothing else changes.
 */
function entryImage(id: LogbookId, open: boolean): HTMLElement {
  const { path, fill } = SHAPES[SHAPE_OF[id]];
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 64 40");
  svg.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS(SVG, "path");
  shape.setAttribute("d", path);
  shape.setAttribute("fill", fill ? "currentColor" : "none");
  shape.setAttribute("stroke", "currentColor");
  shape.setAttribute("stroke-width", fill ? "0" : "4");
  shape.setAttribute("stroke-linecap", "round");
  shape.setAttribute("stroke-linejoin", "round");
  svg.append(shape);
  return h("span", { class: `entry-image ${open ? "open" : "locked"}` }, svg);
}

function slot(props: LogbookProps, entry: LogbookEntry): HTMLElement {
  const { lang, selected, onSelect } = props;
  const open = props.unlocked.includes(entry.id);
  const name = open ? t(lang, logbookKeys(entry.id).name) : t(lang, "logbook.unknown");
  const button = h(
    "button",
    { type: "button", class: "slot", "data-entry": entry.id, "data-state": open ? "open" : "locked", "aria-pressed": String(open && selected === entry.id) },
    entryImage(entry.id, open),
    h("span", { class: "slot-name" }, name),
    // Not colour alone: a locked slot says so in words for screen readers.
    !open && h("span", { class: "visually-hidden" }, t(lang, "logbook.lockedSlot")),
  );
  if (open) button.addEventListener("click", () => onSelect(entry.id));
  else button.disabled = true;
  return h("li", {}, button);
}

function detail({ lang, unlocked, selected, touch = false }: LogbookProps): HTMLElement {
  const entry = LOGBOOK_ENTRIES.find((candidate) => candidate.id === selected && unlocked.includes(candidate.id));
  if (!entry) {
    const empty = unlocked.length === 0 ? "logbook.none" : "logbook.pick";
    return h("article", { class: "entry entry-empty" }, h("p", {}, t(lang, forTouch(empty, touch))));
  }
  const keys = logbookKeys(entry.id);
  return h(
    "article",
    { class: "entry", "data-entry": entry.id },
    h("h3", {}, t(lang, keys.name)),
    entry.scientificName && h("p", { class: "entry-latin" }, h("em", {}, entry.scientificName)),
    h("h4", {}, t(lang, "logbook.factsLabel")),
    h("p", { class: "entry-facts" }, t(lang, keys.facts)),
    h("h4", {}, t(lang, "logbook.sdgLabel")),
    h("p", { class: "entry-sdg" }, t(lang, keys.sdg)),
    h("h4", {}, t(lang, "logbook.sourcesLabel")),
    h(
      "ul",
      { class: "entry-sources" },
      // G-002: every source is listed with its publisher and a link that opens in a new tab.
      ...entry.sources.map((source) =>
        h("li", {}, h("a", { href: source.url, target: "_blank", rel: "noopener noreferrer" }, source.title), ` (${source.publisher})`),
      ),
    ),
  );
}

/** The Marine Logbook (REQ-006 AC-2, AC-3): seven slots, silhouettes with "???" for what is not scanned yet, and the open entry. */
export function logbookScreen(props: LogbookProps): HTMLElement {
  const { lang, unlocked, onClose, touch = false } = props;
  return h(
    "div",
    { class: "screen logbook-screen" },
    h(
      "section",
      { class: "panel logbook", role: "dialog", "aria-label": t(lang, "logbook.title") },
      h(
        "header",
        { class: "logbook-head" },
        h("h2", {}, t(lang, "logbook.title")),
        h("span", { class: "logbook-count" }, `${t(lang, "logbook.progress")} ${unlocked.length}/${LOGBOOK_ENTRIES.length}`),
        h("span", { class: "logbook-hint" }, t(lang, forTouch("logbook.closeHint", touch))),
        h("button", { type: "button", class: "primary", onclick: onClose }, t(lang, "logbook.close")),
      ),
      h(
        "div",
        { class: "logbook-body" },
        h("ul", { class: "slots", "aria-label": t(lang, "logbook.list") }, ...LOGBOOK_ENTRIES.map((entry) => slot(props, entry))),
        detail(props),
      ),
    ),
  );
}
