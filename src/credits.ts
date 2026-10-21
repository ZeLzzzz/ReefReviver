import creditsMarkdown from "../CREDITS.md?raw";

/** One `- a | b | c` line of CREDITS.md, split into its fields. */
export type CreditRow = string[];

/** A fenced block: the full licence text, titled by the label after the opening fence. */
export interface CreditNotice {
  label: string;
  text: string;
}

export interface CreditSection {
  rows: CreditRow[];
  notices: CreditNotice[];
}

export interface Credits {
  team: CreditSection;
  assets: CreditSection;
  code: CreditSection;
}

// The section headings of CREDITS.md, in the order the credits screen shows them.
const SECTION_HEADINGS = { team: "Tim", assets: "Aset pihak ketiga", code: "Kode pihak ketiga" } as const;

/** The marker row that stands in for names the team has not filled in yet (D-054). */
export function isPlaceholder(row: CreditRow): boolean {
  return row[0]?.toUpperCase() === "TODO";
}

/**
 * Reads CREDITS.md, the single source of the credits screen (G-005). Only `- ` lines and fenced
 * blocks count; prose and HTML comments are for the people who edit the file. A missing section
 * is an error, so a renamed heading fails loudly instead of silently emptying the screen.
 */
export function parseCredits(markdown: string): Credits {
  const sections = new Map<string, CreditSection>();
  let current: CreditSection | null = null;
  let fence: { label: string; lines: string[] } | null = null;
  let comment = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (fence) {
      if (line.startsWith("```")) {
        current?.notices.push({ label: fence.label, text: fence.lines.join("\n") });
        fence = null;
      } else fence.lines.push(line);
      continue;
    }
    if (comment) {
      comment = !line.includes("-->");
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("<!--")) {
      comment = !trimmed.includes("-->");
    } else if (line.startsWith("## ")) {
      current = { rows: [], notices: [] };
      sections.set(line.slice(3).trim(), current);
    } else if (trimmed.startsWith("```")) {
      fence = { label: trimmed.slice(3).trim(), lines: [] };
    } else if (trimmed.startsWith("- ") && current) {
      current.rows.push(trimmed.slice(2).split("|").map((field) => field.trim()));
    }
  }

  const find = (heading: string): CreditSection => {
    const section = sections.get(heading);
    if (!section) throw new Error(`CREDITS.md has no "## ${heading}" section`);
    return section;
  };
  return { team: find(SECTION_HEADINGS.team), assets: find(SECTION_HEADINGS.assets), code: find(SECTION_HEADINGS.code) };
}

/** The credits of this build. */
export const credits: Credits = parseCredits(creditsMarkdown);
