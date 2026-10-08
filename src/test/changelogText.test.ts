import { describe, expect, it } from "vitest";
import type { ChangelogDocument, ChangelogSubject, DocumentComparison } from "../pokeweb/changelogDocument";
import { renderChangelogText } from "../pokeweb/changelogText";

describe("changelog TXT export", () => {
  it("groups Pokemon fields under one name and exports raw text with ASCII borders", () => {
    const text = renderChangelogText([document({ subjects: [subject({
      title: "Charizard", fields: [{ label: "Attack", before: "84", after: "110" }, { label: "Defense", before: "78", after: "95" }],
    })] })]);
    expect(text).toContain("NARCs: personal + learnsets + evolutions");
    expect(text.match(/Charizard/gu)).toHaveLength(1);
    expect(text).toContain("| Field   | Original | Updated |");
    expect(text).toContain("| Attack  | 84       | 110     |");
    expect(text).toContain("+---------+----------+---------+");
    expect(text).not.toContain("<article>");
    expect(text).not.toContain("<mark>");
    expect(text).not.toContain("**");
    expect(text).not.toContain("~~");
    expect(text).toMatch(/\n$/u);
    expectTableAlignment(text);
  });

  it("keeps unequal learnsets side by side with wrapped rows aligned", () => {
    const move = "A very long move name that needs several lines to stay aligned";
    const text = renderChangelogText([document({ subjects: [subject({ comparisons: [comparison({
      title: "Learnset", columns: ["Slot", "Level", "Move"],
      before: [["1", "5", move], ["2", "10", "Growl"]],
      after: [["1", "15", "Flamethrower"]],
    })] })] })]);
    expect(text).toMatch(/Original +Updated/u);
    expect(text).toMatch(/\| 1 +\| 5 +\| A very long move name that needs +\| {4}\| 1 +\| 15 +\| FLAMETHROWER/u);
    expect(text).toContain("several lines to stay aligned");
    expect(text).toMatch(/\| 2 +\| 10 +\| Growl +\| {4}\| NONE/u);
    expectTableAlignment(text);
  });

  it("shows encounter rates and newly added rows without losing columns", () => {
    const text = renderChangelogText([document({ domain: "encounters", narcs: ["encounters"], title: "Encounters", subjects: [subject({
      title: "Route 4", comparisons: [comparison({ title: "Spring · Grass", columns: ["Slot", "Pokemon", "Min level", "Max level"],
        before: [], after: [["1", "Charizard", "10", "15"]], rate: { before: "0", after: "30" },
      })],
    })] })]);
    expect(text).toContain("Spring / Grass");
    expect(text).toMatch(/Encounter rate: 0 +Encounter rate: 30/u);
    expect(text).toMatch(/\| None +\| +\| +\| +\| {4}\| 1 +\| CHARIZARD +\| 10 +\| 15/u);
    expectTableAlignment(text);
  });

  it("keeps trainer settings and team fields in one aligned export", () => {
    const text = renderChangelogText([document({ domain: "trainers", narcs: ["trdata", "trpok"], title: "Trainers", subjects: [subject({
      title: "Leader Iris (Trainer 1)", fields: [{ label: "Money", before: "10", after: "20" }],
      comparisons: [comparison({ title: "Team", layout: "fields", columns: ["Slot", "Pokemon", "Level", "Moves"],
        before: [["1", "Charizard", "50", "Flamethrower, Growl"]], after: [["1", "Ivysaur", "55", "Tackle, Growl"]],
      })],
    })] })]);
    expect(text.match(/Leader Iris/gu)).toHaveLength(1);
    expect(text).toContain("NARCs: trdata + trpok");
    expect(text).toContain("| Money | 10       | 20      |");
    expect(text).toMatch(/\| 1 +\| Pokemon +\| Charizard +\| IVYSAUR/u);
    expect(text).toMatch(/\| 1 +\| Level +\| 50 +\| 55/u);
    expect(text).toContain("Flamethrower, Growl");
    expect(text).toContain("TACKLE, GROWL");
    expectTableAlignment(text);
  });

  it("preserves multiline text, long unbroken values, and accented Pokemon names", () => {
    const long = "X".repeat(90);
    const text = renderChangelogText([document({ subjects: [subject({ fields: [
      { label: "Pokemon", before: "Flabe\u0301be\u0301", after: "Nidoran♀" },
      { label: "Description", before: "First line\nSecond\tline", after: long },
    ] })] })]);
    expect(text).toContain("Flabe\u0301be\u0301");
    expect(text).toContain("NIDORAN♀");
    expect(text).toContain("First line");
    expect(text).toContain("Second    line");
    expect(text.match(/X/gu)).toHaveLength(90);
    expect(text).not.toContain("\t");
    expectTableAlignment(text.normalize("NFC"));
  });

  it("uppercases only changed Updated cells and measures their expanded text without changing shared documents", () => {
    const input = document({ subjects: [subject({ fields: [
      { label: "Ability", before: "Intimidate", after: "Inner Focus" },
      { label: "Unchanged", before: "Blaze", after: "Blaze" },
    ], comparisons: [comparison({
      columns: ["Slot", "Level", "Move"],
      before: [["1", "5", "Ember"], ["2", "10", "a"]],
      after: [["1", "15", "Ember"], ["2", "10", "ßßßß"]],
    })] })] });
    const text = renderChangelogText([input]);
    expect(text).toMatch(/\| Ability +\| Intimidate +\| INNER FOCUS/u);
    expect(text).toMatch(/\| Unchanged +\| Blaze +\| Blaze/u);
    expect(text).toMatch(/\| 1 +\| 5 +\| Ember +\| {4}\| 1 +\| 15 +\| Ember/u);
    expect(text).toContain("SSSSSSSS");
    expect(text).not.toContain("EMBER");
    expect(input.subjects[0].fields[0].after).toBe("Inner Focus");
    expect(input.subjects[0].comparisons[0].after[1][2]).toBe("ßßßß");
    expectTableAlignment(text);
  });

  it("combines selected sections and includes unchanged or unavailable messages", () => {
    const text = renderChangelogText([
      document({ subjects: [subject({ pokemon: [{ name: "Charizard" }], notes: ["Updated team settings."] })] }),
      document({ domain: "moves", narcs: ["moves"], title: "Moves", changes: 0 }),
      document({ domain: "marts", narcs: ["marts"], title: "Marts", changes: 0, emptyMessage: "This NARC is not available in either ROM." }),
    ]);
    expect(text).toContain("Pokemon changelog\n=================");
    expect(text).toContain("Moves changelog\n===============");
    expect(text).toContain("Marts changelog\n===============");
    expect(text).toContain("Team: Charizard");
    expect(text).toContain("- Updated team settings.");
    expect(text).toContain("No changes detected in these NARCs.");
    expect(text).toContain("This NARC is not available in either ROM.");
    expect(text).not.toContain("icon could not be extracted");
  });
});

function expectTableAlignment(text: string): void {
  const sections = text.split(/\n\n+/u);
  for (const section of sections) {
    const rows = section.split("\n").filter((line) => /^[+|]/u.test(line));
    if (rows.length) expect(new Set(rows.map((row) => row.length)).size).toBe(1);
  }
}

function document(overrides: Partial<ChangelogDocument> = {}): ChangelogDocument {
  return { domain: "pokemon", narcs: ["personal", "learnsets", "evolutions"], title: "Pokemon", filename: "pokeweb-changelog-pokemon.pdf", changes: 2,
    original: "original.nds", modified: "modified.nds", version: "W2", emptyMessage: "No changes detected in these NARCs.",
    iconWarning: "1 referenced Pokemon icon could not be extracted.", subjects: [], icons: [], html: "<article>Unused HTML</article>", ...overrides };
}

function subject(overrides: Partial<ChangelogSubject> = {}): ChangelogSubject {
  return { title: "Charizard", fields: [], notes: [], comparisons: [], pokemon: [], ...overrides };
}

function comparison(overrides: Partial<DocumentComparison> = {}): DocumentComparison {
  return { title: "Learnset", columns: ["Slot", "Level", "Move"], before: [], after: [], beforeIcons: [], afterIcons: [], ...overrides };
}
