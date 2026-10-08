import { describe, expect, it } from "vitest";
import type { jsPDF, OutlineItem } from "jspdf";
import type { ChangelogDocument, ChangelogSubject } from "../pokeweb/changelogDocument";
import { buildChangelogPdf } from "../pokeweb/changelogPdf";

describe("changelog PDF navigation", () => {
  it("exposes named entries under their document bookmarks and links the contents to their changes", () => {
    const pdf = buildChangelogPdf([
      document("pokemon", "Pokemon", [subject("Charizard"), subject("Ivysaur")]),
      document("trainers", "Trainers", [subject("Leader Iris (Trainer 1)")]),
    ]);
    const roots = (pdf.outline as typeof pdf.outline & { root: { children: OutlineItem[] } }).root.children;
    expect(roots.map((item) => item.title)).toEqual(["Contents", "Pokemon", "Trainers"]);
    expect(roots[1].children.map((item: OutlineItem) => item.title)).toEqual(["Charizard", "Ivysaur"]);
    expect(roots[2].children.map((item: OutlineItem) => item.title)).toEqual(["Leader Iris (Trainer 1)"]);
    const pokemonPage = pageContaining(pdf, "Charizard", 2);
    const trainerPage = pageContaining(pdf, "Leader Iris \\(Trainer 1\\)", 2);
    expect(roots[1].children[0].options.pageNumber).toBe(pokemonPage);
    expect(roots[2].children[0].options.pageNumber).toBe(trainerPage);
    const contentsLinks = linksOnPage(pdf, 1);
    expect(contentsLinks.map((link) => link.options.pageNumber)).toEqual([pokemonPage, pokemonPage, pokemonPage, trainerPage, trainerPage]);
    expect(contentsLinks[1].options.top).toBeGreaterThan(contentsLinks[0].options.top!);
    expect(contentsLinks[2].options.top).toBeGreaterThan(contentsLinks[1].options.top!);
    expect(linksOnPage(pdf, pokemonPage).some((link) => link.options.pageNumber === 1)).toBe(true);
    expect(pdf.output()).toContain("/PageMode /UseOutlines");
    expect(pdf.output()).toContain("/Title (Charizard)");
  });

  it("keeps destinations correct after contents and comparison tables span multiple pages", () => {
    const subjects = Array.from({ length: 130 }, (_, index) => subject(`Pokemon ${String(index + 1).padStart(3, "0")}`));
    subjects[0].comparisons = [{ title: "Learnset", columns: ["Slot", "Level", "Move"],
      before: Array.from({ length: 100 }, (_, index) => [String(index + 1), String(index), "Flamethrower"]),
      after: Array.from({ length: 100 }, (_, index) => [String(index + 1), String(index + 1), "Tackle"]),
      beforeIcons: [], afterIcons: [],
    }];
    subjects[129].title = "A very long Pokemon name with a form description that wraps across more than one line in the contents";
    const pdf = buildChangelogPdf([document("pokemon", "Pokemon", subjects), document("moves", "Moves", [])]);
    const roots = (pdf.outline as typeof pdf.outline & { root: { children: OutlineItem[] } }).root.children;
    const firstContentPage = roots[1].options.pageNumber;
    expect(firstContentPage).toBeGreaterThan(2);
    expect(roots[1].children).toHaveLength(130);
    for (let index = 0; index < 129; index++) {
      const expectedPage = pageContaining(pdf, subjects[index].title, firstContentPage);
      expect(roots[1].children[index].options.pageNumber).toBe(expectedPage);
    }
    expect(roots[1].children[1].options.pageNumber).toBeGreaterThan(firstContentPage + 1);
    const links = Array.from({ length: firstContentPage - 1 }, (_, index) => linksOnPage(pdf, index + 1)).flat();
    expect(links).toHaveLength(132);
    const destinations = [roots[1], ...roots[1].children, roots[2]].map((item) => item.options.pageNumber);
    expect(links.map((link) => link.options.pageNumber)).toEqual(destinations);
    const bytes = pdf.output();
    for (const page of destinations) expect(bytes.includes(`/Dest [${inspect(pdf).getPageInfo(page).objId} 0 R /XYZ`)).toBe(true);
  });

  it("provides section navigation for unchanged documents", () => {
    const pdf = buildChangelogPdf([document("pokemon", "Pokemon", [])]);
    expect(pdf.getNumberOfPages()).toBe(2);
    expect(linksOnPage(pdf, 1)).toHaveLength(1);
    expect(linksOnPage(pdf, 1)[0].options.pageNumber).toBe(2);
    expect(pageContaining(pdf, "No changes detected.", 2)).toBe(2);
  });
});

function pageContaining(pdf: jsPDF, text: string, from: number): number {
  for (let page = from; page <= pdf.getNumberOfPages(); page++) {
    if (inspect(pdf).pages[page].some((line) => line.includes(`(${text}) Tj`))) return page;
  }
  throw new Error(`Missing PDF heading: ${text}`);
}

function linksOnPage(pdf: jsPDF, page: number): Array<{ options: { pageNumber: number; top?: number } }> {
  return inspect(pdf).getPageInfo(page).pageContext.annotations.filter((annotation) => annotation.type === "link");
}

function inspect(pdf: jsPDF) {
  return pdf.internal as unknown as { pages: string[][]; getPageInfo(page: number): {
    objId: number; pageContext: { annotations: Array<{ type: string; options: { pageNumber: number; top?: number } }> };
  } };
}

function subject(title: string): ChangelogSubject {
  return { title, fields: [{ label: "Attack", before: "84", after: "110" }], notes: [], comparisons: [], pokemon: [] };
}

function document(domain: ChangelogDocument["domain"], title: string, subjects: ChangelogSubject[]): ChangelogDocument {
  return { domain, title, subjects, narcs: domain === "pokemon" ? ["personal", "learnsets", "evolutions"] : domain === "trainers" ? ["trdata", "trpok"] : ["moves"],
    filename: `pokeweb-changelog-${domain}.pdf`, changes: subjects.length, original: "original.nds", modified: "modified.nds", version: "W2",
    emptyMessage: "No changes detected.", icons: [], html: "" };
}
