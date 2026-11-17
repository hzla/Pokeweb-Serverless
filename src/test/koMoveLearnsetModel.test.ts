import { describe, expect, it } from "vitest";
import { readU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { recordGenericChange } from "../pokeweb/actionChangelog";
import {
  KO_MOVE_LEARNSET_PATH,
  appendPokemonKoMove,
  copyPokemonKoMoves,
  deletePokemonKoMove,
  ensureKoMoveLearnsetNarc,
  getPokemonKoMoves,
  hydrateKoMoveLearnsetFromRom,
  insertKoMoveLearnsetMembers,
  koMoveMirrorSource,
  syncKoMoveLearnsetWithPersonal,
  updatePokemonKoMoveField,
} from "../pokeweb/koMoveLearnsetModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("KO move learnsets", () => {
  it("creates one terminated retail-shaped member per personal ID", () => {
    const project = makeProject(4);
    const result = ensureKoMoveLearnsetNarc(project);
    const bytes = project.fileSystem?.additions?.[KO_MOVE_LEARNSET_PATH];
    const archive = new NARC(bytes);

    expect(result).toMatchObject({ path: KO_MOVE_LEARNSET_PATH, members: 4 });
    expect(archive.files).toHaveLength(4);
    for (const member of archive.files) {
      expect(member).toHaveLength(4);
      expect(readU16(member, 0)).toBe(0xffff);
      expect(readU16(member, 2)).toBe(0xffff);
    }
  });

  it("round-trips move IDs and u16 KO thresholds through add, edit, copy, and delete", () => {
    const project = makeProject(3);
    ensureKoMoveLearnsetNarc(project);

    appendPokemonKoMove(project, 1);
    updatePokemonKoMoveField(project, 1, "move_id_0", "Tackle");
    updatePokemonKoMoveField(project, 1, "ko_count_0", "65535");
    expect(getPokemonKoMoves(project, 1)).toMatchObject([
      { index: 0, moveId: 1, moveName: "Tackle", koCount: 65535 },
    ]);

    copyPokemonKoMoves(project, 2, 1);
    expect(getPokemonKoMoves(project, 2)).toMatchObject([
      { moveId: 1, koCount: 65535 },
    ]);
    deletePokemonKoMove(project, 2, 0);
    expect(getPokemonKoMoves(project, 2)).toEqual([]);
    expect(() => updatePokemonKoMoveField(project, 1, "ko_count_0", "65536")).toThrow(/0–65535/u);
    expect(() => updatePokemonKoMoveField(project, 1, "ko_count_0", "-1")).toThrow(/0–65535/u);
  });

  it("extends an installed archive when a later custom form adds a personal member", () => {
    const project = makeProject(2);
    ensureKoMoveLearnsetNarc(project);
    project.narcs.personal!.fileCount = 4;

    appendPokemonKoMove(project, 3);
    expect(new NARC(project.fileSystem?.additions?.[KO_MOVE_LEARNSET_PATH]).files).toHaveLength(4);
    expect(getPokemonKoMoves(project, 3)).toHaveLength(1);
  });

  it("keeps imported KO moves editable after autosave releases the original ROM bytes", async () => {
    const { project, source, fileId } = importedProject();
    ensureKoMoveLearnsetNarc(project);
    delete project.originalRomBytes; // The browser's saveActiveProject does this.

    expect(getPokemonKoMoves(project, 1)).toMatchObject([{ moveId: 1, koCount: 5 }]);
    updatePokemonKoMoveField(project, 1, "ko_count_0", "9");
    expect(project.fileSystem?.additions?.[KO_MOVE_LEARNSET_PATH]).toBeUndefined();
    expect(new NARC(project.fileSystem?.replacements?.[fileId]).files[1]).toEqual(
      Uint8Array.of(1, 0, 9, 0, 255, 255, 255, 255),
    );
    project.originalRomBytes = source; // Export obtains these from IndexedDB in the browser.
    const exported = new NintendoDSRom(await exportModifiedRom(project));
    expect(exported.fileId(KO_MOVE_LEARNSET_PATH)).toBe(fileId);
    expect(new NARC(exported.getFileByName(KO_MOVE_LEARNSET_PATH)).files[1]).toEqual(
      Uint8Array.of(1, 0, 9, 0, 255, 255, 255, 255),
    );
  });

  it("recovers a legacy blank duplicate during export without erasing original KO moves", async () => {
    const { project, source, fileId } = importedProject();
    const blank = new NARC();
    blank.files = Array.from({ length: 4 }, () => Uint8Array.of(255, 255, 255, 255));
    project.fileSystem!.additions![KO_MOVE_LEARNSET_PATH] = blank.save();

    const exported = new NintendoDSRom(await exportModifiedRom(project));
    expect(exported.files).toHaveLength(new NintendoDSRom(source).files.length);
    expect(exported.fileId(KO_MOVE_LEARNSET_PATH)).toBe(fileId);
    const archive = new NARC(exported.getFileByName(KO_MOVE_LEARNSET_PATH));
    expect(archive.files).toHaveLength(4);
    expect(archive.files[1]).toEqual(Uint8Array.of(1, 0, 5, 0, 255, 255, 255, 255));
    expect(project.fileSystem?.additions?.[KO_MOVE_LEARNSET_PATH]).toBeUndefined();
  });

  it("keeps explicit edits and deletions when recovering a legacy duplicate", () => {
    const { project, source } = importedProject();
    const duplicate = new NARC();
    duplicate.files = [Uint8Array.of(2, 0, 8, 0, 255, 255, 255, 255), Uint8Array.of(255, 255, 255, 255)];
    project.fileSystem!.additions![KO_MOVE_LEARNSET_PATH] = duplicate.save();
    recordGenericChange(project, "learnsets", "Pokemon 1 KO move slot 1 was removed.", "Pokemon 1 KO Moves", { key: "pokemon:1:ko-learnset" });
    hydrateKoMoveLearnsetFromRom(project, new NintendoDSRom(source));
    expect(getPokemonKoMoves(project, 0)).toMatchObject([{ moveId: 2, koCount: 8 }]);
    expect(getPokemonKoMoves(project, 1)).toEqual([]);
    // Rehydration and structured cloning (Test Battle/persistence) are safe.
    delete project.originalRomBytes;
    const clone = structuredClone(project);
    hydrateKoMoveLearnsetFromRom(clone, new NintendoDSRom(source));
    expect(getPokemonKoMoves(clone, 0)).toMatchObject([{ moveId: 2, koCount: 8 }]);
    expect(getPokemonKoMoves(clone, 1)).toEqual([]);
  });
});

describe("KO move learnsets after forms are added", () => {
  // A personal record: 76 bytes, its first form record at 0x1c (u16) and its form count at 0x20.
  const record = (firstForm = 0, forms = 1) => { const bytes = new Uint8Array(76); bytes[0x1c] = firstForm & 0xff; bytes[0x1d] = firstForm >> 8; bytes[0x20] = forms; return bytes; };
  const koMembers = (project: ProjectState) => new NARC(project.fileSystem!.additions![KO_MOVE_LEARNSET_PATH]!).files.map((member) => readU16(member, 0) === 0xffff ? [] : getEntries(member));
  const getEntries = (member: Uint8Array) => { const out: number[] = []; for (let at = 0; readU16(member, at) !== 0xffff; at += 4) out.push(readU16(member, at)); return out; };

  it("gives a Mega form its base form's KO moves, and other forms added later their own (empty)", () => {
    // Species 1-3; species 2 has two more forms appended after the KO moves were installed (4 members): a regional
    // form (record 4, its form 1) and a Mega (record 5, its form 2).
    const project = makeProject(4);
    project.narcs.personal!.rawFiles = [new Uint8Array(76), record(), record(4, 3), record(), record(), record()];
    project.narcs.personal!.fileCount = 6;
    project.codeInjection = { megaEvolution: { version: 1, routes: [{ species: 2, trigger: 700, sourceForm: 0, targetForm: 2 }],
      messages: { reacting: 0, evolved: 0, wish: 0 }, animationMove: 0, revealFrame: 244, autoFoes: true } };
    const archive = new NARC();
    archive.files = [Uint8Array.of(255, 255, 255, 255), Uint8Array.of(1, 0, 5, 0, 255, 255, 255, 255), Uint8Array.of(2, 0, 3, 0, 255, 255, 255, 255), Uint8Array.of(255, 255, 255, 255)];
    project.fileSystem!.additions![KO_MOVE_LEARNSET_PATH] = archive.save();
    expect(syncKoMoveLearnsetWithPersonal(project)).toBe(true);
    expect(koMembers(project)).toEqual([[], [1], [2], [], [], [2]]);
    expect(syncKoMoveLearnsetWithPersonal(project)).toBe(false); // in step
    expect(koMoveMirrorSource(project, 5)).toBe(2);
    expect(koMoveMirrorSource(project, 4)).toBeUndefined();

    // Editing the base form's KO moves carries over to the Mega; the Mega's own can't be edited.
    appendPokemonKoMove(project, 2);
    expect(koMembers(project)[5]).toEqual([2, 2]);
    expect(getPokemonKoMoves(project, 5).map((move) => move.moveId)).toEqual([2, 2]);
    expect(() => appendPokemonKoMove(project, 5)).toThrow(/base form's KO moves: edit Pokémon 2's/u);
    // The regional form's are its own.
    appendPokemonKoMove(project, 4);
    expect(koMembers(project)[4]).toEqual([1]);
    expect(koMembers(project)[2]).toEqual([2, 2]);
  });

  it("keeps a Mega form in step with its base form on export, from the Mega DLL's table without project routes", () => {
    const project = makeProject(4);
    project.narcs.personal!.rawFiles = [new Uint8Array(76), record(), record(4, 2), record(), record()];
    const archive = new NARC();
    archive.files = [Uint8Array.of(255, 255, 255, 255), Uint8Array.of(255, 255, 255, 255), Uint8Array.of(9, 0, 1, 0, 255, 255, 255, 255), Uint8Array.of(255, 255, 255, 255), Uint8Array.of(255, 255, 255, 255)];
    project.fileSystem!.additions![KO_MOVE_LEARNSET_PATH] = archive.save();
    // A PWMG v2 table with one route (species 2: form 0 -> 1).
    const dll = new Uint8Array(64);
    const view = new DataView(dll.buffer);
    view.setUint32(8, 0x474d5750, true); view.setUint16(12, 2, true); view.setUint16(14, 1, true);
    view.setUint16(8 + 28, 2, true); view.setUint16(8 + 30, 700, true); dll[8 + 33] = 1;
    project.fileSystem!.additions!["patches/PokewebMegaW2.dll"] = dll;
    expect(syncKoMoveLearnsetWithPersonal(project)).toBe(true);
    expect(koMembers(project)[4]).toEqual([9]);
  });

  it("follows the species expansion's moved form records, and repairs an archive it left behind", () => {
    const project = makeProject(0);
    const archive = new NARC();
    archive.files = Array.from({ length: 710 }, (_, id) => (id >= 685 ? Uint8Array.of(id & 0xff, id >> 8, 1, 0, 255, 255, 255, 255) : Uint8Array.of(255, 255, 255, 255)));
    project.fileSystem!.additions![KO_MOVE_LEARNSET_PATH] = archive.save();
    insertKoMoveLearnsetMembers(project, 685, 378);
    const moved = koMembers(project);
    expect(moved).toHaveLength(1088);
    expect(moved[687]).toEqual([]); // Chespin's: none
    expect(moved[685 + 378]).toEqual([685]); // retail's first form record, now 1063
    // Installed before the installer moved them: the export moves them (the configuration says by how much).
    project.fileSystem!.additions![KO_MOVE_LEARNSET_PATH] = archive.save();
    project.codeInjection = { speciesExpansion: { version: 1, count: 374, regionalDexFile: 1087, formShift: 378, sprites: [], cries: [] } };
    project.narcs.personal!.rawFiles = Array.from({ length: 1088 }, () => new Uint8Array(76));
    expect(syncKoMoveLearnsetWithPersonal(project)).toBe(true);
    expect(koMembers(project)).toEqual(moved);
  });
});

function importedProject(): { project: ProjectState; source: Uint8Array; fileId: number } {
  const archive = new NARC();
  archive.files = [Uint8Array.of(255, 255, 255, 255), Uint8Array.of(1, 0, 5, 0, 255, 255, 255, 255)];
  const source = new NintendoDSRom(new Uint8Array(0x200)).save({ addedFiles: [
    { path: "other/data.bin", bytes: Uint8Array.of(42) },
    { path: KO_MOVE_LEARNSET_PATH, bytes: archive.save() },
  ] });
  const project = makeProject(2);
  for (const store of Object.values(project.narcs)) store!.fileId = -1;
  project.originalRomBytes = source;
  return { project, source, fileId: new NintendoDSRom(source).fileId(KO_MOVE_LEARNSET_PATH) };
}

function makeProject(memberCount: number): ProjectState {
  const store = (name: "personal" | "learnsets"): NarcStore => ({
    name,
    sourcePath: name,
    fileId: 0,
    fileCount: memberCount,
    rawFiles: Array.from({ length: memberCount }, () => new Uint8Array()),
    records: new Map(),
    dirty: new Set(),
  });
  return {
    session: {
      romName: "KO move test",
      generation: "gen5",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "IRDO", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: { personal: store("personal"), learnsets: store("learnsets") },
    texts: { banks: { moves: ["", "Tackle", "Growl"] } },
    formats: {},
    trpokInfo: [],
    fileSystem: { replacements: {}, additions: {} },
  };
}
