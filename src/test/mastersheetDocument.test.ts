import { describe, expect, it } from "vitest";
import { buildMastersheetDocument, slugify, titleCase } from "../pokeweb/mastersheetDocument";
import type { ProjectState } from "../pokeweb/projectStore";

const SOURCE = [
  "# Cascade White",
  "Thank you for playing!",
  "",
  "### Mechanics Changes",
  "- Rivalry is new",
  "- Gastro Acid has priority",
  "",
  "# Cheren Split (Level Cap 15)",
  "## Aspertia City",
  "Talk to [Juniper](https://example.com).",
  "## Route 19",
  "## Route 19",
  "# End of Current Content",
].join("\n");

describe("mastersheet document", () => {
  it("turns the source into an introduction, splits and area pages", () => {
    const doc = buildMastersheetDocument(makeProject(), SOURCE);
    expect(doc.title).toBe("Cascade White");
    expect(doc.pages.map((page) => [page.kind, page.title])).toEqual([
      ["intro", "Cascade White"],
      ["area", "Aspertia City"],
      ["area", "Route 19"],
      ["area", "Route 19"],
    ]);
    // Area IDs stay unique, and an empty split ("End of Current Content") stays out of the outline.
    expect(doc.pages.map((page) => page.id)).toEqual(["introduction", "aspertia-city", "route-19", "route-19-2"]);
    expect(doc.splits).toMatchObject([{ id: "split-cheren-split", title: "Cheren Split", detail: "Level Cap 15", pageIds: ["aspertia-city", "route-19", "route-19-2"] }]);
    expect(doc.splits).toHaveLength(1);
    // The editor still sees the empty split, so authors can add areas to it.
    expect(doc.allSplits.map((split) => split.title)).toEqual(["Cheren Split", "End of Current Content"]);
  });

  it("knows which source lines every page, split and block came from", () => {
    const doc = buildMastersheetDocument(makeProject(), SOURCE);
    const lines = SOURCE.split("\n");
    expect(doc.titleLine).toBe(0);
    const [intro, aspertia, route19] = doc.pages;
    expect(intro!.src).toEqual({ start: 0, end: 7 });
    expect(intro!.blocks.map((block) => block.src)).toEqual([{ start: 1, end: 2 }, { start: 3, end: 4 }, { start: 4, end: 6 }]);
    expect(lines[aspertia!.headingLine!]).toBe("## Aspertia City");
    expect(aspertia!.src).toEqual({ start: 8, end: 10 });
    expect(route19!.src).toEqual({ start: 10, end: 11 });
    const cheren = doc.allSplits[0]!;
    expect(cheren.src).toEqual({ start: 7, end: 12 });
    expect(lines[cheren.headingLine]).toBe("# Cheren Split (Level Cap 15)");
  });

  it("reads zone links under a page heading, and keeps them out of the calc sheet", () => {
    const source = "# Sheet\n## Route 1\n!zones 12, 40\nSome text\n";
    const doc = buildMastersheetDocument(makeProject(), source);
    const route = doc.pages.find((page) => page.title === "Route 1")!;
    expect(route.zones).toEqual([12, 40]);
    expect(route.zonesLine).toBe(2);
    expect(route.blocks.map((block) => block.kind)).toEqual(["text"]);
  });

  it("reads Fill suggestions marked not needed under a page heading", () => {
    const source = "# Sheet\n## Route 1\n!zones 12\n!skip tr 4, item 3\nSome text\n";
    const route = buildMastersheetDocument(makeProject(), source).pages.find((page) => page.title === "Route 1")!;
    expect(route.skips).toEqual(["tr 4", "item 3"]);
    expect(route.skipLine).toBe(3);
    expect(route.blocks.map((block) => block.kind)).toEqual(["text"]);
  });

  it("keeps sections, lists and links, without the source's empty paragraphs", () => {
    const doc = buildMastersheetDocument(makeProject(), SOURCE);
    const intro = doc.pages[0]!;
    expect(intro.blocks.map((block) => block.kind)).toEqual(["text", "heading", "list"]);
    expect(intro.blocks[2]).toMatchObject({ kind: "list", items: [[{ type: "text", text: "Rivalry is new" }], [{ type: "text", text: "Gastro Acid has priority" }]] });
    const aspertia = doc.pages[1]!;
    expect(aspertia.blocks[0]).toMatchObject({ kind: "text", parts: expect.arrayContaining([{ type: "link", text: "Juniper", href: "https://example.com" }]) });
  });

  it("references to trainers and encounters the ROM doesn't have resolve to nothing", () => {
    const doc = buildMastersheetDocument(makeProject(), "# Sheet\n## Route 1\n!trm 5 Guards an item\n!enc 3\n");
    const route = doc.pages.find((page) => page.title === "Route 1")!;
    expect(route.blocks).toMatchObject([
      { kind: "trainer", role: "mandatory", notes: [{ type: "text", text: "Guards an item" }] },
      { kind: "encounter" },
    ]);
    expect(doc.trainers).toEqual({});
    expect(doc.encounters).toEqual({});
    expect(doc.warnings.map((warning) => warning.message)).toEqual([
      'Unable to resolve trainer reference "5".',
      'Unable to resolve encounter reference "3".',
    ]);
  });

  it("names things the way players read them", () => {
    expect(slugify("Pokéstar Studios")).toBe("pokestar-studios");
    expect(titleCase("STENCH")).toBe("Stench");
    expect(titleCase("SAND VEIL")).toBe("Sand Veil");
    expect(titleCase("Run Away")).toBe("Run Away");
  });
});

function makeProject(): ProjectState {
  return {
    session: { romName: "casc23", generation: "gen5", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "IRDO", fileName: "casc23.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {},
    texts: { banks: { pokedex: [], moves: [], items: [] } },
    formats: {},
    trpokInfo: [],
    docs: { romTitle: "casc23", trainerLocations: {}, trainerDiffs: {}, itemLocations: {}, groundItemScriptMap: {} },
  } as unknown as ProjectState;
}
