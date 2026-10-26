import { config } from "../config";
import { minimapLayout, type MapMark, type MapPoint, type MinimapState, type SiteMark } from "../game/minimap";
import { t, type Lang } from "../i18n/i18n";
import { h } from "./screens";

export interface MinimapView {
  element: HTMLElement;
  /** Shows a new state. Only touches the DOM for what changed, so it is cheap to call every frame. */
  update(state: MinimapState): void;
}

const NS = "http://www.w3.org/2000/svg";
const { icon } = config.minimap;

/** Builds an SVG element; the HUD's own `h` only makes HTML. */
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: SVGElement[]): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  element.append(...children);
  return element;
}

const at = (point: MapPoint) => `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`;

function setAttr(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

/**
 * A reef site: a diamond for a frame, a circle for a seagrass patch. The status is in the shape, never colour alone:
 * empty is an outline, started is filled, planted is filled with a check mark (CSS shows each).
 */
function siteIcon(kind: "frame" | "patch"): SVGGElement {
  const r = icon.site;
  const shape =
    kind === "frame"
      ? svg("polygon", { class: "mm-shape", points: `0,${-r} ${r},0 0,${r} ${-r},0` })
      : svg("circle", { class: "mm-shape", r: r - 0.5 });
  const check = svg("path", { class: "mm-check", d: "M-3.4 0.2 L-0.9 3 L3.6 -3" });
  return svg("g", { class: "mm-icon mm-site", "data-kind": kind, "data-status": "empty" }, shape, check);
}

/**
 * The minimap panel: the bay seen from above, north up, with the ROV arrow, the station (square), reef sites
 * (diamonds), seagrass patches (circles), nets that still trap an animal (X), the cave's two mouths (arches) with its tunnel
 * (a faint line) and, late in the dive, the trash (dots).
 * Drawn as SVG so every icon is an element a test can find; it has one accessible name for the whole map.
 */
export function createMinimap(lang: Lang): MinimapView {
  const layout = minimapLayout;
  const s = icon.station;

  const terrain = layout.terrain.map((shade) => svg("path", { class: "mm-terrain", "data-shade": shade.shade, d: shade.path }));
  // REQ-022 AC-6: the dive area's edge, a thin line round the map.
  const edge = svg("polygon", {
    class: "mm-edge",
    "data-kind": "edge",
    points: layout.edge.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "),
  });
  const rocks = layout.rocks.map((rock) => svg("circle", { class: "mm-rock", cx: rock.x.toFixed(1), cy: rock.y.toFixed(1), r: rock.radius.toFixed(1) }));
  const dock = svg("line", {
    class: "mm-dock",
    "data-kind": "dock",
    x1: layout.dock.from.x.toFixed(1),
    y1: layout.dock.from.y.toFixed(1),
    x2: layout.dock.to.x.toFixed(1),
    y2: layout.dock.to.y.toFixed(1),
  });
  // REQ-014 AC-7: the cave's tunnel, faint, and its two mouths, each an arch (a dark opening in a rock).
  const tunnel = svg("polyline", {
    class: "mm-tunnel",
    "data-kind": "tunnel",
    points: layout.cave.tunnel.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "),
  });
  const m = icon.mouth;
  const mouths = layout.cave.mouths.map((mouth, index) =>
    svg(
      "g",
      { class: "mm-icon", "data-kind": "cave", "data-mouth": index === 0 ? "west" : "east", transform: at(mouth) },
      svg("path", { class: "mm-shape mm-mouth", d: `M${-m} ${m * 0.7} V${-m * 0.1} A${m} ${m} 0 0 1 ${m} ${-m * 0.1} V${m * 0.7} Z` }),
    ),
  );
  const station = svg(
    "g",
    { class: "mm-icon", "data-kind": "station", transform: at(layout.station) },
    svg("rect", { class: "mm-shape mm-solid", x: -s, y: -s, width: 2 * s, height: 2 * s }),
  );
  // REQ-012: the sites move with every dive, so their icons are placed on each update.
  const frames = Array.from({ length: config.reef.frames }, () => siteIcon("frame"));
  const patches = Array.from({ length: config.reef.patches }, () => siteIcon("patch"));
  const netLayer = svg("g", { class: "mm-nets" });
  const trashLayer = svg("g", { class: "mm-trash" });
  const r = icon.rov;
  const rov = svg(
    "g",
    { class: "mm-icon", "data-kind": "rov" },
    svg("polygon", { class: "mm-rov", points: `0,${-r} ${r * 0.7},${r * 0.75} 0,${r * 0.35} ${-r * 0.7},${r * 0.75}` }),
  );

  // REQ-015 AC-6: the submarine left floating while the player walks on the land: a hull shape, not an arrow.
  const sub = svg(
    "g",
    { class: "mm-icon", "data-kind": "sub" },
    svg("path", { class: "mm-shape mm-sub", d: `M0 ${-icon.sub} C${icon.sub * 0.6} ${-icon.sub * 0.6} ${icon.sub * 0.6} ${icon.sub * 0.6} 0 ${icon.sub} C${-icon.sub * 0.6} ${icon.sub * 0.6} ${-icon.sub * 0.6} ${-icon.sub * 0.6} 0 ${-icon.sub}Z` }),
  );
  sub.style.display = "none";

  const map = svg(
    "svg",
    { class: "mm-map", viewBox: `0 0 ${layout.size} ${layout.size}`, role: "img", "aria-label": t(lang, "minimap.label") },
    ...terrain,
    edge,
    ...rocks,
    tunnel,
    trashLayer,
    dock,
    station,
    ...mouths,
    ...frames,
    ...patches,
    netLayer,
    sub,
    rov,
  );
  const north = h("span", { class: "mm-north", "aria-hidden": "true" }, t(lang, "minimap.north"));
  const element = h("section", { class: "hud-panel hud-minimap" }, map, north);

  /** Rebuilds the marks of one layer only when the items or their places changed (REQ-012: a new dive moves them). */
  const layerState = (layer: SVGElement, build: (mark: MapMark) => SVGElement) => {
    let shown: readonly MapMark[] = [];
    return (marks: readonly MapMark[]) => {
      const same = (mark: MapMark, i: number) => mark.id === shown[i].id && mark.x === shown[i].x && mark.y === shown[i].y;
      if (marks.length === shown.length && marks.every(same)) return;
      shown = marks;
      layer.replaceChildren(...marks.map(build));
    };
  };
  const setNets = layerState(netLayer, (mark) => {
    const n = icon.net;
    return svg(
      "g",
      { class: "mm-icon", "data-kind": "net", "data-id": mark.id, transform: at(mark) },
      svg("path", { class: "mm-x", d: `M${-n} ${-n} L${n} ${n} M${n} ${-n} L${-n} ${n}` }),
    );
  });
  const setTrash = layerState(trashLayer, (mark) =>
    svg("circle", { class: "mm-dot", "data-kind": "trash", "data-id": mark.id, cx: mark.x.toFixed(1), cy: mark.y.toFixed(1), r: icon.trash }),
  );

  const setSites = (icons: readonly SVGGElement[], marks: readonly SiteMark[]) =>
    icons.forEach((iconElement, i) => {
      if (!marks[i]) return;
      setAttr(iconElement, "data-status", marks[i].status);
      setAttr(iconElement, "transform", at(marks[i]));
    });

  return {
    element,
    update(state) {
      setAttr(rov, "transform", `${at(state.rov)} rotate(${state.rov.heading.toFixed(1)})`);
      const showSub = state.sub ? "" : "none";
      if (sub.style.display !== showSub) sub.style.display = showSub;
      if (state.sub) setAttr(sub, "transform", `${at(state.sub)} rotate(${state.sub.heading.toFixed(1)})`);
      setSites(frames, state.frames);
      setSites(patches, state.patches);
      setNets(state.nets);
      setTrash(state.trash);
    },
  };
}
