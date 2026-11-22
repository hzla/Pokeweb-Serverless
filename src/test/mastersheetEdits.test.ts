import { describe, expect, it } from "vitest";
import {
  duplicateRange,
  emptyBlock,
  insertBlockLines,
  insertHeading,
  moveRange,
  moveSection,
  printBlock,
  readBlock,
  removeRange,
  replaceHeading,
  replaceRange,
  setPageSkips,
  setPageZones,
  splitHeading,
  swapRanges,
  type BlockDraft,
} from "../pokeweb/mastersheetEdits";
import { buildMastersheetExport, mastersheetMarkdownFromMasterData, parseMastersheetMarkdown, parseMastersheetSkips } from "../pokeweb/mastersheetModel";
import type { ProjectState } from "../pokeweb/projectStore";

const SHEET = [
  "# Sheet", // 0
  "", // 1
  "# Cheren Split (Level Cap 15)", // 2
  "## Floccesy Ranch", // 3
  "!items Items", // 4
  "green shard, Green Shard x20 — reward for defeating Rival", // 5
  "tm normal, TM10 Hidden Power", // 6
  "end", // 7
  "", // 8
  "!enc 45", // 9
  "", // 10
  "!trm 181", // 11
  "", // 12
  "!tr 182 Guards the Brightpowder", // 13
  "", // 14
  "## Alder's House", // 15
  "!notif WARNING, Seymour and Cassie are fought back to back., #f26253", // 16
].join("\n");

describe("mastersheet block printing", () => {
  it("reads every block kind back to the lines it came from", () => {
    const blocks: string[][] = [
      ["!items Items", "green shard, Green Shard x20 — reward for defeating Rival", "tm normal, TM10 Hidden Power", "end"],
      ["!gifts Juniper Gift Pokémon", "desc: Speak to professor Juniper.", "wingull, If you chose Snivy", "numel", "end"],
      ["!trm 166 If chose Snivy"],
      ["!tr 182"],
      ["!enc 45"],
      ["!notif WARNING, Seymour and Cassie are fought back to back., #f26253"],
      ["### Rival Fight (Rewards 20x Green Shards)"],
      ["#### Smaller"],
      ["- one", "- two [link](https://example.com)"],
      ["Thank you for playing [Cascade White](https://example.com)!"],
    ];
    for (const lines of blocks) expect(printBlock(readBlock(lines)!)).toEqual(lines);
  });

  it("keeps a trainer written by name as written until another is picked", () => {
    const draft = readBlock(["!trm Cheren/Snivy/15 Gym Leader"]) as Extract<BlockDraft, { kind: "trainer" }>;
    expect(draft).toEqual({ kind: "trainer", ref: "Cheren/Snivy/15", mandatory: true, notes: "Gym Leader" });
    expect(printBlock({ ...draft, mandatory: false })).toEqual(["!tr Cheren/Snivy/15 Gym Leader"]);
  });

  it("writes list rows without commas in names, and skips empty rows", () => {
    expect(printBlock({ kind: "items", title: "", description: "", entries: [{ name: "Oran, Berry", note: "x10, from Hugh" }, { name: " ", note: "" }] }))
      .toEqual(["!items", "Oran  Berry, x10, from Hugh", "end"]);
  });

  it("starts each new block with something to edit", () => {
    for (const kind of ["text", "heading", "list", "trainer", "encounter", "items", "gifts", "notice"] as const) {
      expect(printBlock(emptyBlock(kind)).length).toBeGreaterThan(0);
    }
  });
});

describe("mastersheet source edits", () => {
  it("replaces a block and reports where it is", () => {
    const change = replaceRange(SHEET, { start: 11, end: 12 }, ["!tr 181 Optional now"]);
    expect(change.source.split("\n")[11]).toBe("!tr 181 Optional now");
    expect(change.range).toEqual({ start: 11, end: 12 });
  });

  it("inserts a block as its own paragraph", () => {
    const change = insertBlockLines(SHEET, 14, ["!tr 180"]);
    const lines = change.source.split("\n");
    expect(lines.slice(13, 18)).toEqual(["!tr 182 Guards the Brightpowder", "", "!tr 180", "", "## Alder's House"]);
    expect(change.range).toEqual({ start: 15, end: 16 });
  });

  it("removes a block without leaving double blank lines", () => {
    const change = removeRange(SHEET, { start: 11, end: 12 });
    expect(change.source.split("\n").slice(9, 13)).toEqual(["!enc 45", "", "!tr 182 Guards the Brightpowder", ""]);
  });

  it("swaps neighbouring blocks, keeping the gap between them", () => {
    const change = swapRanges(SHEET, { start: 11, end: 12 }, { start: 13, end: 14 });
    expect(change.source.split("\n").slice(11, 14)).toEqual(["!tr 182 Guards the Brightpowder", "", "!trm 181"]);
    expect(change.range).toEqual({ start: 13, end: 14 });
    const back = swapRanges(change.source, { start: 13, end: 14 }, { start: 11, end: 12 });
    expect(back.source).toBe(SHEET);
  });

  it("moves a multi-line block and duplicates one", () => {
    const moved = moveRange(SHEET, { start: 4, end: 8 }, 15);
    const lines = moved.source.split("\n");
    expect(lines[moved.range.start]).toBe("!items Items");
    expect(lines[moved.range.end - 1]).toBe("end");
    expect(lines[4]).toBe("!enc 45");
    const duplicated = duplicateRange(SHEET, { start: 9, end: 10 });
    expect(duplicated.source.split("\n").filter((line) => line === "!enc 45")).toHaveLength(2);
  });

  it("adds, renames and moves splits and areas", () => {
    const added = insertHeading(SHEET, 17, "## Pledge Grove");
    expect(added.source.split("\n").slice(-2)).toEqual(["", "## Pledge Grove"]);
    const renamed = replaceHeading(SHEET, 2, splitHeading("Cheren Split", "Level Cap 16"));
    expect(renamed.source.split("\n")[2]).toBe("# Cheren Split (Level Cap 16)");
    // Alder's House (15–17) before Floccesy Ranch (3–15).
    const moved = moveSection(SHEET, { start: 15, end: 17 }, 3);
    const lines = moved.source.split("\n");
    expect(lines[moved.range.start]).toBe("## Alder's House");
    expect(lines.indexOf("## Floccesy Ranch")).toBeGreaterThan(moved.range.start);
  });

  it("links a page to zones under its heading, and the calc sheet leaves the line out", () => {
    const linked = setPageZones(SHEET, { headingLine: 3 }, [445]);
    expect(linked.source.split("\n")[4]).toBe("!zones 445");
    const parsed = parseMastersheetMarkdown(linked.source);
    expect(parsed.masterData.some((element) => element.tag === "zones")).toBe(true);
    expect(parsed.sourceRanges).toHaveLength(parsed.masterData.length);
    const project = { docs: { romTitle: "", mastersheetMarkdown: linked.source }, session: { romName: "x", baseRom: "BW2" }, texts: { banks: {} }, narcs: {} } as unknown as ProjectState;
    expect(buildMastersheetExport(project, linked.source).masterData.some((element) => element.tag === "zones")).toBe(false);
    const relinked = setPageZones(linked.source, { headingLine: 3, zonesLine: 4 }, [445, 446]);
    expect(relinked.source.split("\n")[4]).toBe("!zones 445, 446");
    const unlinked = setPageZones(relinked.source, { headingLine: 3, zonesLine: 4 }, []);
    expect(unlinked.source).toBe(SHEET);
  });

  it("remembers Fill suggestions marked not needed under the heading and zones, out of the calc sheet", () => {
    const linked = setPageZones(SHEET, { headingLine: 3 }, [445]);
    const skipped = setPageSkips(linked.source, { headingLine: 3, zonesLine: 4 }, ["tr 180", "item 417"]);
    expect(skipped.source.split("\n").slice(3, 6)).toEqual(["## Floccesy Ranch", "!zones 445", "!skip tr 180, item 417"]);
    const project = { docs: { romTitle: "", mastersheetMarkdown: skipped.source }, session: { romName: "x", baseRom: "BW2" }, texts: { banks: {} }, narcs: {} } as unknown as ProjectState;
    expect(buildMastersheetExport(project, skipped.source).masterData.some((element) => element.tag === "skip")).toBe(false);
    expect(readBlock(["!skip tr 180"])).toBeUndefined();
    const more = setPageSkips(skipped.source, { headingLine: 3, zonesLine: 4, skipLine: 5 }, ["tr 180", "item 417", "enc 44"]);
    expect(more.source.split("\n")[5]).toBe("!skip tr 180, item 417, enc 44");
    const none = setPageSkips(more.source, { headingLine: 3, zonesLine: 4, skipLine: 5 }, []);
    expect(none.source).toBe(linked.source);
  });

  it("writes a notice's colour only when the sheet can read it back as one", () => {
    expect(printBlock({ kind: "notice", title: "Note", text: "Mind the gap", color: "#4e86", frame: "" })).toEqual(["!notif Note, Mind the gap"]);
    expect(printBlock({ kind: "notice", title: "Note", text: "Mind the gap", color: "#4e86d4", frame: "" })).toEqual(["!notif Note, Mind the gap, #4e86d4"]);
    expect(readBlock(["!notif Note, Mind the gap, #4e86d4"])).toEqual({ kind: "notice", title: "Note", text: "Mind the gap", color: "#4e86d4", frame: "" });
  });

  it("reads and writes a notice's text box, which the calc sheet doesn't get", () => {
    const line = "!notif Split-locked, Only before Cheren, #427b9c, frame=system";
    expect(readBlock([line])).toEqual({ kind: "notice", title: "Split-locked", text: "Only before Cheren", color: "#427b9c", frame: "system" });
    expect(printBlock(readBlock([line])!)).toEqual([line]);
    expect(readBlock(["!notif Heads up, frame=sign"])).toEqual({ kind: "notice", title: "Heads up", text: "", color: "", frame: "sign" });
    const parsed = parseMastersheetMarkdown(`# Sheet\n## Route 1\n${line}\n!notif Odd, text, frame=round\n`);
    expect(parsed.masterData.find((element) => element.tag === "notif")).toMatchObject({ notificationTitle: "Split-locked", text: "Only before Cheren", fontColor: "#427b9c", noticeFrame: "system" });
    expect(parsed.warnings.some((warning) => warning.message.startsWith("!notif frame="))).toBe(true);
    expect(mastersheetMarkdownFromMasterData(parsed.masterData).split("\n")).toContain(line);
    const project = { docs: { romTitle: "", mastersheetMarkdown: "" }, session: { romName: "x", baseRom: "BW2" }, texts: { banks: {} }, narcs: {} } as unknown as ProjectState;
    const exported = buildMastersheetExport(project, `# Sheet\n## Route 1\n${line}\n`).masterData.find((element) => element.tag === "notif");
    expect(exported).toEqual({ tag: "notif", notificationTitle: "Split-locked", text: "Only before Cheren", fontColor: "#427b9c" });
  });

  it("reads !skip keys and flags what it can't read", () => {
    expect(parseMastersheetSkips(" tr 180,ENC44 , item 417, tr 180")).toEqual({ keys: ["tr 180", "enc 44", "item 417"], invalid: false });
    expect(parseMastersheetSkips("tr 180, trainer 2").invalid).toBe(true);
    const parsed = parseMastersheetMarkdown("# Sheet\n## Route 1\n!skip tr 4, bogus\n");
    expect(parsed.warnings.some((warning) => warning.message.startsWith("!skip"))).toBe(true);
  });
});
