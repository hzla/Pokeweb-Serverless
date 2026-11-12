import { describe, expect, it } from "vitest";
import { writeU16 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import {
  MASTERSHEET_ROM_PATH,
  decodeMastersheetRomFile,
  encodeMastersheetRomFile,
  hasAuthoredMastersheet,
  hydrateMastersheetFromRom,
  materializeMastersheetRomFile,
  resolveMastersheetRomConflict,
  setMastersheetSavesInRom,
} from "../pokeweb/mastersheetRomFile";
import { createProjectDocument } from "../pokeweb/projectDocument";
import type { ProjectState } from "../pokeweb/projectStore";

const SHEET = {
  romTitle: "Cascade White",
  markdown: "# Cascade White\n\n## Cheren Split\n### Route 20\n!trainer 162 mand If you choose Tepig\n!encounter 13\n",
  highlights: { changed: { Tackle: 1 }, new: { "Psychic Noise": 1 } },
};

describe("mastersheet saved in the ROM", () => {
  it("round-trips compressed, deterministic bytes", () => {
    const big = { ...SHEET, markdown: SHEET.markdown.repeat(400) };
    const bytes = encodeMastersheetRomFile(big);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("PWMS");
    expect(bytes.length).toBeLessThan(new TextEncoder().encode(big.markdown).length / 10);
    expect(encodeMastersheetRomFile(big)).toEqual(bytes);
    expect(decodeMastersheetRomFile(bytes)).toEqual(big);
  });

  it("rejects files it can't trust", () => {
    const bytes = encodeMastersheetRomFile(SHEET);
    expect(() => decodeMastersheetRomFile(Uint8Array.of(1, 2, 3))).toThrow(/isn't a Pokeweb mastersheet/u);
    const newer = bytes.slice();
    writeU16(newer, 4, 2);
    expect(() => decodeMastersheetRomFile(newer)).toThrow(/newer Pokeweb/u);
    expect(() => decodeMastersheetRomFile(bytes.subarray(0, bytes.length - 5))).toThrow(/damaged/u);
  });

  it("is written on export and brought back when the exported ROM is imported", async () => {
    const project = makeProject(romWith([]));
    project.docs!.romTitle = SHEET.romTitle;
    project.docs!.mastersheetMarkdown = SHEET.markdown;
    project.docs!.mastersheetHighlights = SHEET.highlights;
    const exported = await exportModifiedRom(project);
    const rom = new NintendoDSRom(exported);
    expect(decodeMastersheetRomFile(rom.getFileByName(MASTERSHEET_ROM_PATH)).markdown).toBe(SHEET.markdown);

    // Importing it is a fresh project: it takes the ROM's copy, title included.
    const imported = makeProject(exported);
    expect(hydrateMastersheetFromRom(imported, rom)).toEqual({ kind: "loaded" });
    expect(imported.docs).toMatchObject({ romTitle: "Cascade White", mastersheetMarkdown: SHEET.markdown, mastersheetHighlights: SHEET.highlights, mastersheetInRom: true });

    // Exporting the imported ROM again replaces the file instead of adding a second one.
    imported.docs!.mastersheetMarkdown += "### Route 21\n";
    const again = new NintendoDSRom(await exportModifiedRom(imported));
    expect(again.files).toHaveLength(rom.files.length);
    expect(decodeMastersheetRomFile(again.getFileByName(MASTERSHEET_ROM_PATH)).markdown).toContain("### Route 21");
  });

  it("leaves the ROM alone when there's nothing to save, and removes the file when switched off", async () => {
    const empty = makeProject(romWith([]));
    expect(hasAuthoredMastersheet(empty)).toBe(false);
    expect(new NintendoDSRom(await exportModifiedRom(empty)).filenames.idOf(MASTERSHEET_ROM_PATH)).toBeUndefined();

    const source = romWith([{ path: MASTERSHEET_ROM_PATH, bytes: encodeMastersheetRomFile(SHEET) }]);
    const project = makeProject(source);
    hydrateMastersheetFromRom(project, new NintendoDSRom(source));
    setMastersheetSavesInRom(project, false);
    const exported = new NintendoDSRom(await exportModifiedRom(project));
    expect(exported.filenames.idOf(MASTERSHEET_ROM_PATH)).toBeUndefined();

    // Switching it back on undoes the removal.
    setMastersheetSavesInRom(project, true);
    materializeMastersheetRomFile(project, new NintendoDSRom(source));
    expect(Object.keys(project.fileSystem?.tombstones ?? {})).toHaveLength(0);
  });

  it("offers a different ROM copy once, and stops asking after the choice", () => {
    const source = romWith([{ path: MASTERSHEET_ROM_PATH, bytes: encodeMastersheetRomFile(SHEET) }]);
    const rom = new NintendoDSRom(source);
    const project = makeProject(source);
    project.docs!.mastersheetMarkdown = "# Cascade White\n\nMy newer notes\n";

    const result = hydrateMastersheetFromRom(project, rom);
    expect(result.kind).toBe("conflict");
    expect(project.docs?.mastersheetRomPending?.markdown).toBe(SHEET.markdown);

    resolveMastersheetRomConflict(project, "project");
    expect(project.docs?.mastersheetMarkdown).toBe("# Cascade White\n\nMy newer notes\n");
    // Reopening the saved project re-reads the same source ROM: no second prompt.
    expect(hydrateMastersheetFromRom(project, rom)).toEqual({ kind: "same" });
    expect(createProjectDocument(project, false).docs?.mastersheetRomSourceHash).toBe(project.docs?.mastersheetRomSourceHash);

    const other = makeProject(source);
    other.docs!.mastersheetMarkdown = "# Mine\n";
    hydrateMastersheetFromRom(other, rom);
    resolveMastersheetRomConflict(other, "rom");
    expect(other.docs).toMatchObject({ mastersheetMarkdown: SHEET.markdown, mastersheetRomPending: undefined });
  });

  it("reports a damaged ROM copy without touching the project's", () => {
    const source = romWith([{ path: MASTERSHEET_ROM_PATH, bytes: Uint8Array.of(0x50, 0x57, 0x4d, 0x53, 1, 0, 1, 0, 9, 0, 0, 0, 1, 2) }]);
    const project = makeProject(source);
    project.docs!.mastersheetMarkdown = "# Mine\n";
    expect(hydrateMastersheetFromRom(project, new NintendoDSRom(source)).kind).toBe("error");
    expect(project.docs?.mastersheetRomError).toMatch(/damaged/u);
    expect(project.docs?.mastersheetMarkdown).toBe("# Mine\n");
  });
});

function romWith(files: Array<{ path: string; bytes: Uint8Array }>): Uint8Array {
  return new NintendoDSRom(new Uint8Array(0x200)).save({ addedFiles: [{ path: "other/data.bin", bytes: Uint8Array.of(42) }, ...files] });
}

function makeProject(source: Uint8Array): ProjectState {
  return {
    originalRomBytes: source,
    session: { romName: "casc23", generation: "gen5", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "IRDO", fileName: "casc23.nds", size: source.length },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {},
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
    fileSystem: { replacements: {}, additions: {} },
    docs: { romTitle: "casc23", trainerLocations: {}, trainerDiffs: {}, itemLocations: {}, groundItemScriptMap: {} },
  } as unknown as ProjectState;
}
