import { isPlaceholder, type CreditRow, type CreditSection, type Credits } from "../credits";
import { t, type Lang } from "../i18n/i18n";
import { h } from "./screens";

export interface CreditsProps {
  lang: Lang;
  credits: Credits;
  onBack: () => void;
}

function notices(section: CreditSection): HTMLElement[] {
  return section.notices.map((notice) =>
    h("details", { class: "credit-notice" }, h("summary", {}, notice.label), h("pre", {}, notice.text)),
  );
}

/** The team: a name and a role per line. A TODO line shows the "not filled in yet" marker instead of a name (D-054). */
function teamList(lang: Lang, section: CreditSection): HTMLElement {
  const rows: CreditRow[] = section.rows.length ? section.rows : [["TODO"]];
  return h(
    "ul",
    { class: "credit-list credit-team" },
    ...rows.map((row) =>
      isPlaceholder(row)
        ? h("li", { class: "credit-pending" }, t(lang, "credits.teamPending"))
        : h("li", {}, h("strong", {}, row[0]), row[1] && h("span", {}, row[1])),
    ),
  );
}

/** Third-party assets or code: name, then author, licence and source on the line below. */
function creditList(lang: Lang, section: CreditSection, emptyKey: "credits.assetsNone" | "credits.codeNone"): HTMLElement {
  if (!section.rows.length) return h("p", { class: "credit-none" }, t(lang, emptyKey));
  return h(
    "ul",
    { class: "credit-list" },
    ...section.rows.map(([name, author, licence, source]) =>
      h(
        "li",
        {},
        h("strong", {}, name),
        h(
          "span",
          {},
          [author && `${t(lang, "credits.by")} ${author}`, licence && `${t(lang, "credits.licence")}: ${licence}`]
            .filter(Boolean)
            .join(" · "),
        ),
        source && h("a", { href: source, target: "_blank", rel: "noopener noreferrer" }, source),
      ),
    ),
  );
}

/** The credits screen, opened from the title screen (REQ-009 AC-5): the team, third-party assets and code, with licences. */
export function creditsScreen({ lang, credits, onBack }: CreditsProps): HTMLElement {
  return h(
    "main",
    { class: "screen credits-screen" },
    h(
      "section",
      { class: "panel credits-panel", "aria-label": t(lang, "credits.title") },
      // Back comes first so it is in view however long the lists get on a short window; Esc works too.
      h(
        "div",
        { class: "credits-head" },
        h("h1", {}, t(lang, "credits.title")),
        h("button", { type: "button", class: "primary", onclick: onBack }, t(lang, "credits.back")),
      ),
      h("h2", {}, t(lang, "credits.team")),
      teamList(lang, credits.team),
      h("h2", {}, t(lang, "credits.assets")),
      creditList(lang, credits.assets, "credits.assetsNone"),
      ...notices(credits.assets),
      h("h2", {}, t(lang, "credits.code")),
      creditList(lang, credits.code, "credits.codeNone"),
      ...notices(credits.code),
    ),
  );
}
