import { describe, expect, it } from "vitest";
import { insertBlockLines, replaceRange } from "../pokeweb/mastersheetEdits";
import type { ProjectState } from "../pokeweb/projectStore";
import { MastersheetSession } from "../mastersheetViewer/session";

const SOURCE = "# Sheet\n# Cheren Split (Level Cap 15)\n## Route 19\nFirst line\n";

describe("mastersheet editing session", () => {
  it("rebuilds the document after each edit and steps back and forward through them", () => {
    const session = new MastersheetSession(makeProject(), SOURCE);
    const reasons: string[] = [];
    session.onChange((_, reason) => reasons.push(reason));
    session.apply((source) => insertBlockLines(source, 4, ["### New section"]));
    expect(session.document.pages.find((page) => page.title === "Route 19")!.blocks.map((block) => block.kind)).toEqual(["text", "heading"]);
    expect(session.dirty).toBe(true);
    expect(session.unsavedSteps()).toBe(1);
    session.undo();
    expect(session.source).toBe(SOURCE);
    expect(session.dirty).toBe(false);
    session.redo();
    expect(session.source).toContain("### New section");
    expect(reasons).toEqual(["edit", "undo", "redo"]);
  });

  it("counts typing in one field as one step", () => {
    const session = new MastersheetSession(makeProject(), SOURCE);
    for (const text of ["F", "Fi", "Fir", "First!"]) session.apply((source) => replaceRange(source, { start: 3, end: 4 }, [text]), { coalesce: "text" });
    expect(session.source.split("\n")[3]).toBe("First!");
    session.undo();
    expect(session.source).toBe(SOURCE);
    expect(session.canUndo).toBe(false);
  });

  it("remembers what was saved, and takes a newer saved sheet from elsewhere", () => {
    const session = new MastersheetSession(makeProject(), "# Draft\n", SOURCE);
    expect(session.dirty).toBe(true);
    session.markSaved();
    expect(session.dirty).toBe(false);
    session.replaceSaved("# From the editor\n");
    expect(session.source).toBe("# From the editor\n");
    expect(session.dirty).toBe(false);
    expect(session.document.title).toBe("From the editor");
    session.undo();
    expect(session.source).toBe("# Draft\n");
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
