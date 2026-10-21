import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { credits, isPlaceholder, parseCredits } from "../../src/credits";

const sample = `# Kredit

Prose is ignored.

## Tim

<!--
- Not | A row, it is a comment
-->

- Sari | Kode
- Budi

## Aset pihak ketiga

<!-- - Also | ignored -->

- Karang | Seniman | CC0 | https://example.test/karang

## Kode pihak ketiga

- lib | Penulis | MIT | https://example.test

\`\`\`lib (MIT)
Line one

Line three
\`\`\`
`;

describe("parseCredits (REQ-009 AC-5)", () => {
  it("reads the rows of each section and the licence blocks, ignoring prose and comments", () => {
    const parsed = parseCredits(sample);
    expect(parsed.team.rows).toEqual([["Sari", "Kode"], ["Budi"]]);
    expect(parsed.assets.rows).toEqual([["Karang", "Seniman", "CC0", "https://example.test/karang"]]);
    expect(parsed.code.rows).toEqual([["lib", "Penulis", "MIT", "https://example.test"]]);
    expect(parsed.code.notices).toEqual([{ label: "lib (MIT)", text: "Line one\n\nLine three" }]);
    expect(parsed.team.notices).toEqual([]);
  });

  it("handles Windows line endings", () => {
    expect(parseCredits(sample.replaceAll("\n", "\r\n")).team.rows).toEqual([["Sari", "Kode"], ["Budi"]]);
  });

  it("fails loudly when a section is missing, so a renamed heading cannot empty the screen", () => {
    expect(() => parseCredits(sample.replace("## Tim", "## Team"))).toThrow('no "## Tim" section');
  });

  it("recognises the TODO marker in any case", () => {
    expect(isPlaceholder(["TODO"])).toBe(true);
    expect(isPlaceholder(["todo", "Kode"])).toBe(true);
    expect(isPlaceholder(["Sari", "Kode"])).toBe(false);
  });
});

describe("CREDITS.md itself (G-005)", () => {
  const file = readFileSync("CREDITS.md", "utf8");

  it("lists the team as the TODO marker or as name and role, never half a row (D-054)", () => {
    expect(credits.team.rows.length).toBeGreaterThan(0);
    for (const row of credits.team.rows) {
      expect(isPlaceholder(row) || (row[0] && row[1]), `incomplete team row: ${row.join(" | ")}`).toBeTruthy();
    }
  });

  it("credits three.js with the MIT notice, copied from the package", () => {
    const three = credits.code.rows.find((row) => row[0] === "three.js");
    expect(three?.[2]).toBe("MIT");
    const licence = readFileSync("node_modules/three/LICENSE", "utf8").trim();
    expect(credits.code.notices.find((n) => n.label.startsWith("three.js"))?.text.trim()).toBe(licence);
    expect(file).toContain("Copyright © 2010-2026 three.js authors");
  });

  it("gives every third-party asset an author, a licence and a source", () => {
    for (const row of [...credits.assets.rows, ...credits.code.rows]) {
      expect(row.slice(0, 4).every(Boolean), `incomplete credit: ${row.join(" | ")}`).toBe(true);
      expect(row).toHaveLength(4);
    }
  });
});
