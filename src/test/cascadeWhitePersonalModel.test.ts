import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { Folder } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { CASCADE_WHITE_AI_DLL_PATH, cascadeWhiteTrainerAbilityName } from "../pokeweb/cascadeWhiteModel";
import {
  CASCADE_PERSONAL_MARKER_PATH, getCascadePersonalMigrationStatus, hasCascadePersonalData,
  migrateCascadePersonalData, readCascadeAiAbilityTable,
} from "../pokeweb/cascadeWhitePersonalModel";
import { getNarcFormats } from "../pokeweb/formats";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import { decodeRecord, type ProjectState } from "../pokeweb/projectStore";
import { copyPokemonTutorCompatibility, getPokemonSummaryRecord, updatePokemonField, updatePokemonTutorCompatibility } from "../pokeweb/pokemonModel";
import { writeRpm } from "../pokeweb/rpm";
import { renderPatchesEditor } from "../ui/patchesEditor";
import { renderCascadeAbilitySlots, renderPokemonExpandedSections } from "../ui/pokemonEditor";

const DLL_PATH = "patches/A9_DamageCalc.dll";

describe("Cascade personal migration", () => {
  it.each([1, 2, 4])("reads a variant's actual %i-byte ability IDs from its injected table", (width) => {
    const rows = abilityRows();
    rows[25] = [201, 0, 255];
    expect(readCascadeAiAbilityTable(makeDll(rows, width))).toEqual(rows);
    expect(readCascadeAiAbilityTable(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });

  it("rejects ambiguous, truncated, and out-of-range ability tables", () => {
    const rows = abilityRows();
    expect(readCascadeAiAbilityTable(makeDll([...rows, ...rows]))).toBeUndefined();
    expect(readCascadeAiAbilityTable(makeDll(rows.slice(0, 10)))).toBeUndefined();
    rows[25][0] = 256;
    expect(readCascadeAiAbilityTable(makeDll(rows, 4))).toBeUndefined();
  });

  it("gates the UI and writes on Cascade detection and usable injection data", async () => {
    const project = makeProject();
    expect(getCascadePersonalMigrationStatus(project)).toMatchObject({ visible: true, canMigrate: true });
    expect(patchesHtml(project)).toContain('id="migrate-cascade-personal-btn"');
    expect(renderCascadeAbilitySlots(project, 1)).toContain("-readonly");
    expect(() => updatePokemonField(project, 1, "personal", "ability_4", "22")).toThrow(/Migrate/u);
    expect(() => updatePokemonField(project, 1, "personal", "hidden_ability_chance", "22")).toThrow(/Migrate/u);

    delete project.fileSystem!.additions![DLL_PATH];
    expect(getCascadePersonalMigrationStatus(project).canMigrate).toBe(false);
    expect(patchesHtml(project)).not.toContain('id="migrate-cascade-personal-btn"');
    await expect(migrateCascadePersonalData(project)).rejects.toThrow(/unique AI ability table/u);
    project.codeInjection = undefined;
    expect(getCascadePersonalMigrationStatus(project).visible).toBe(false);
    expect(patchesHtml(project)).not.toContain('id="migrate-cascade-personal-btn"');
    expect(renderCascadeAbilitySlots(project, 1)).toBe("");
    await expect(migrateCascadePersonalData(project)).rejects.toThrow(/requires a Cascade/u);
  });

  it("changes only the requested bytes, inherits form abilities, and preserves unsaved edits and the Dex table", async () => {
    const project = makeProject();
    const store = project.narcs.personal!;
    const original = store.rawFiles.map((bytes) => bytes.slice());
    updatePokemonField(project, 1, "personal", "base_hp", "123");
    const result = await migrateCascadePersonalData(project);
    expect(result.status).toBe("applied");
    expect(store.dirty.has(654)).toBe(false); // Regional Dex table.
    expect(getPokemonSummaryRecord(project, 1).rawPersonal).toMatchObject({ base_hp: 123, ability_4: 70, ability_5: 34, ability_6: 122, hidden_ability_chance: 0 });
    expect(getPokemonSummaryRecord(project, 651).rawPersonal.ability_4).toBe(70); // Form of species 1.
    expect(getPokemonSummaryRecord(project, 653).rawPersonal.ability_4).toBe(0); // No source row or form owner.
    materializeProjectEdits(project);
    for (let id = 0; id < store.rawFiles.length; id += 1) {
      const bytes = store.rawFiles[id];
      expect(bytes.length).toBe(original[id].length);
      for (let offset = 0; offset < bytes.length; offset += 1) {
        if ([0x39, 0x3a, 0x3b].includes(offset) && id !== 654) continue;
        if (id === 1 && offset === 0) { expect(bytes[offset]).toBe(123); continue; }
        expect(bytes[offset]).toBe(original[id][offset]);
      }
    }
    expect([...store.rawFiles[25].slice(0x39, 0x3c)]).toEqual([201, 0, 255]);
    expect(project.fileSystem!.additions![CASCADE_PERSONAL_MARKER_PATH]).toBeDefined();
  });

  it.each([0x39, 0x3a, 0x3b, 0x3e])("refuses occupied byte 0x%s atomically", async (offset) => {
    const project = makeProject();
    project.narcs.personal!.rawFiles[649][offset] = 17;
    expect(getCascadePersonalMigrationStatus(project)).toMatchObject({ installed: false, canMigrate: false });
    await expect(migrateCascadePersonalData(project)).rejects.toThrow(/already has data/u);
    expect(project.narcs.personal!.dirty.size).toBe(0);
    expect(project.patches?.applied?.cascadePersonalData).not.toBe(true);
    expect(project.fileSystem!.additions![CASCADE_PERSONAL_MARKER_PATH]).toBeUndefined();
    expect(project.narcs.personal!.rawFiles[1][0x39]).toBe(0);
  });

  it("keeps custom fields editable and preserves them through tutor toggles/copies, materialization, and a ROM round trip", async () => {
    const project = makeProject();
    await migrateCascadePersonalData(project);
    expect(renderCascadeAbilitySlots(project, 1)).toContain('data-field-name="ability_4"');
    expect(renderCascadeAbilitySlots(project, 1)).not.toContain("-readonly");
    expect(renderPokemonExpandedSections(project, 1)).toContain('data-field-name="hidden_ability_chance"');
    updatePokemonField(project, 1, "personal", "ability_4", "Custom Ability");
    updatePokemonField(project, 1, "personal", "ability_5", "0");
    updatePokemonField(project, 1, "personal", "ability_6", "255");
    updatePokemonField(project, 1, "personal", "hidden_ability_chance", "173");
    updatePokemonField(project, 651, "personal", "ability_4", "255");
    expect(cascadeWhiteTrainerAbilityName(project, 1, 4)).toBe("Custom Ability");
    expect(cascadeWhiteTrainerAbilityName(project, 1, 4, 1)).toBe("Ability 255");
    for (const field of ["ability_4", "ability_5", "ability_6", "hidden_ability_chance"]) {
      for (const value of ["-1", "256", "1.5"]) expect(() => updatePokemonField(project, 1, "personal", field, value)).toThrow();
    }
    updatePokemonTutorCompatibility(project, 1, "tutors", 6, false);
    updatePokemonTutorCompatibility(project, 1, "driftveil_tutor", 14, false);
    materializeProjectEdits(project);
    expect(project.narcs.personal!.rawFiles[1][0x38]).toBe(0x3f);
    expect(project.narcs.personal!.rawFiles[1][0x3d]).toBe(0x3f);
    copyPokemonTutorCompatibility(project, 1, 2);
    materializeProjectEdits(project);
    expect([...project.narcs.personal!.rawFiles[1].slice(0x39, 0x40)]).toEqual([201, 0, 255, 0xff, 0x7f, 173, 0xa5]);
    expect((await migrateCascadePersonalData(project)).status).toBe("already-applied");

    const reopened = await reopenRom(project);
    expect(hasCascadePersonalData(reopened)).toBe(true);
    expect(getPokemonSummaryRecord(reopened, 1).rawPersonal).toMatchObject({ ability_4: 201, ability_5: 0, ability_6: 255, hidden_ability_chance: 173 });
    expect(patchesHtml(reopened)).toContain("Migrated");
    expect((await migrateCascadePersonalData(reopened)).status).toBe("already-applied");
    updatePokemonField(reopened, 1, "personal", "ability_4", "0");
    materializeProjectEdits(reopened);
    expect(reopened.narcs.personal!.rawFiles[1][0x39]).toBe(0);
  });

  it("recognizes complete migrated bytes without metadata and persists detection when values are edited", async () => {
    const project = makeProject();
    const rows = abilityRows();
    rows.forEach((row, id) => project.narcs.personal!.rawFiles[id].set(row, 0x39));
    expect(hasCascadePersonalData(project)).toBe(true);
    updatePokemonField(project, 1, "personal", "ability_4", "0");
    expect(project.fileSystem!.additions![CASCADE_PERSONAL_MARKER_PATH]).toBeDefined();
    const reopened = await reopenRom(project);
    expect(hasCascadePersonalData(reopened)).toBe(true);
    expect(decodeRecord(reopened, "personal", 1).raw!.ability_4).toBe(0);
  });
});

function abilityRows(): number[][] {
  const rows = Array.from({ length: 651 }, (_, id) => [id % 256, (id + 1) % 256, (id + 2) % 256]);
  for (let id = 1; id <= 3; id += 1) rows[id] = [70, 34, 122];
  for (let id = 4; id <= 6; id += 1) rows[id] = [70, 22, 163];
  rows[25] = [201, 0, 255];
  return rows;
}

function makeDll(rows = abilityRows(), width = 1): Uint8Array {
  const code = new Uint8Array(16 + rows.length * 3 * width);
  rows.flat().forEach((value, index) => {
    const offset = 16 + index * width;
    if (width === 1) code[offset] = value;
    else if (width === 2) writeU16(code, offset, value);
    else writeU32(code, offset, value);
  });
  return writeRpm({ code, bssSize: 0, baseAddress: 0, symbols: [], relocations: [], metadata: {} }, { ident: "DLXF" });
}

function makeProject(): ProjectState {
  const files = Array.from({ length: 654 }, () => {
    const bytes = new Uint8Array(0x4c);
    bytes[0x38] = 0x7f;
    writeU32(bytes, 0x3c, 0xa5007fff);
    return bytes;
  });
  writeU16(files[1], 0x1c, 651);
  files[1][0x20] = 3;
  files.push(new Uint8Array(1370).fill(0xee));
  return {
    session: { romName: "Cascade", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "Cascade", idCode: "IRDO", fileName: "cascade.nds", size: 0 },
    arm9: new Uint8Array(), overlays: {}, formats: getNarcFormats("BW2"), trpokInfo: [],
    codeInjection: { modules: [{ path: CASCADE_WHITE_AI_DLL_PATH, fileName: "A2_AIChanges.dll", target: "patches" }] },
    fileSystem: { replacements: {}, additions: { [DLL_PATH]: makeDll() } },
    texts: { banks: { abilities: Array.from({ length: 256 }, (_, id) => id === 201 ? "Custom Ability" : `Ability ${id}`) } },
    narcs: { personal: { name: "personal", sourcePath: "a/0/1/6", fileId: 0, fileCount: files.length, rawFiles: files, records: new Map(), dirty: new Set() } },
  };
}

function patchesHtml(project: ProjectState): string {
  const root = { innerHTML: "", querySelector: () => null };
  renderPatchesEditor(project, root as unknown as HTMLElement);
  return root.innerHTML;
}

async function reopenRom(project: ProjectState): Promise<ProjectState> {
  materializeProjectEdits(project);
  const narc = new NARC();
  narc.files = project.narcs.personal!.rawFiles;
  const rom = new NintendoDSRom(new Uint8Array(0x200));
  rom.filenames = new Folder();
  project.originalRomBytes = rom.save({ addedFiles: [
    { path: "a/0/1/6", bytes: narc.save() },
    { path: CASCADE_WHITE_AI_DLL_PATH, bytes: makeDll([]) },
    { path: DLL_PATH, bytes: project.fileSystem!.additions![DLL_PATH] },
  ] });
  const romBytes = await exportModifiedRom(project);
  const parsed = new NintendoDSRom(romBytes);
  expect(parsed.files[parsed.filenames.idOf(DLL_PATH)!]).toEqual(project.fileSystem!.additions![DLL_PATH]);
  expect(parsed.files[parsed.filenames.idOf(CASCADE_PERSONAL_MARKER_PATH)!]).toEqual(project.fileSystem!.additions![CASCADE_PERSONAL_MARKER_PATH]);
  const reopened = makeProject();
  reopened.originalRomBytes = romBytes;
  reopened.codeInjection = undefined;
  reopened.fileSystem = undefined;
  reopened.narcs.personal!.fileId = parsed.filenames.idOf("a/0/1/6")!;
  reopened.narcs.personal!.rawFiles = new NARC(parsed.files[reopened.narcs.personal!.fileId]).files;
  return reopened;
}
