import { describe, expect, it, vi } from "vitest";
import { getNarcFormats } from "../pokeweb/formats";
import { replaceNarcFile } from "../pokeweb/fileSystemModel";
import type { NintendoDSRom } from "../nds/rom";
import { writeU16 } from "../nds/binary";
import { findPokemonPersonalFormOwner, pokemonPersonalDisplayIds, pokemonSpeciesLabel } from "../pokeweb/pokemonLabels";
import { decodeRecord, markDirty, type ProjectState } from "../pokeweb/projectStore";

function makeProject(): ProjectState {
  const formats = getNarcFormats("BW2");
  const length = formats.personal!.reduce((sum, [size]) => sum + size, 0);
  const rawFiles = Array.from({ length: 1000 }, () => new Uint8Array(length));
  rawFiles[709] = new Uint8Array(2048);
  return {
    session: { baseRom: "BW2", baseVersion: "W2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { idCode: "IRDO" }, arm9: new Uint8Array(), overlays: {}, formats,
    narcs: { personal: { name: "personal", fileId: 1, rawFiles, fileCount: rawFiles.length, records: new Map(), dirty: new Set() } },
    texts: { banks: { pokedex: Array.from({ length: 1000 }, (_, id) => `Pokemon ${id}`) } },
  } as unknown as ProjectState;
}

function setForms(project: ProjectState, speciesId: number, first: number, count: number, spriteOffset = 0): void {
  Object.assign(decodeRecord(project, "personal", speciesId).raw!, { form_id: first, num_forms: count, form: spriteOffset });
  markDirty(project, "personal", speciesId);
}

describe("personal form-owner index", () => {
  it("keeps first-pointer precedence, range matches, and the regional-Dex hole", () => {
    const project = makeProject();
    setForms(project, 1, 650, 5, 12);
    setForms(project, 2, 651, 2, 34);
    setForms(project, 3, 650, 2, 56);
    setForms(project, 4, 709, 3);
    expect(findPokemonPersonalFormOwner(project, 650)).toEqual({ speciesId: 1, formIndex: 1, formSpriteOffset: 12 });
    expect(findPokemonPersonalFormOwner(project, 651)).toEqual({ speciesId: 2, formIndex: 1, formSpriteOffset: 34 });
    expect(findPokemonPersonalFormOwner(project, 652)).toEqual({ speciesId: 1, formIndex: 3, formSpriteOffset: 12 });
    expect(findPokemonPersonalFormOwner(project, 709)).toBeUndefined();
    expect(findPokemonPersonalFormOwner(project, 710)?.formIndex).toBe(2);
    expect(findPokemonPersonalFormOwner(project, 1)).toBeUndefined();
    const ids = pokemonPersonalDisplayIds(project);
    expect(ids.slice(ids.indexOf(1), ids.indexOf(1) + 4)).toEqual([1, 650, 652, 653]);
    expect(ids).not.toContain(709);
  });

  it("reuses the index for owned forms and expanded species without owners", () => {
    const project = makeProject();
    setForms(project, 1, 650, 2);
    findPokemonPersonalFormOwner(project, 650);
    const reads = vi.spyOn(project.narcs.personal!.records, "get");
    for (let id = 650; id < 1000; id += 1) {
      findPokemonPersonalFormOwner(project, id);
      pokemonSpeciesLabel(project, id);
    }
    expect(reads).not.toHaveBeenCalled();
  });

  it("refreshes after edits and undo-style changes to form metadata", () => {
    const project = makeProject();
    setForms(project, 1, 650, 2, 10);
    expect(findPokemonPersonalFormOwner(project, 650)?.formSpriteOffset).toBe(10);
    setForms(project, 1, 900, 3, 20);
    expect(findPokemonPersonalFormOwner(project, 650)).toBeUndefined();
    expect(findPokemonPersonalFormOwner(project, 901)).toEqual({ speciesId: 1, formIndex: 2, formSpriteOffset: 20 });
    setForms(project, 1, 650, 2, 10);
    expect(findPokemonPersonalFormOwner(project, 901)).toBeUndefined();
    expect(findPokemonPersonalFormOwner(project, 650)?.speciesId).toBe(1);
  });

  it("refreshes when files are appended, removed, or restored into the same store", () => {
    const project = makeProject();
    const store = project.narcs.personal!;
    setForms(project, 1, 999, 3);
    expect(findPokemonPersonalFormOwner(project, 999)?.formIndex).toBe(1);
    store.rawFiles.push(store.rawFiles[998].slice());
    store.fileCount += 1;
    expect(findPokemonPersonalFormOwner(project, 1000)?.formIndex).toBe(2);
    store.rawFiles.pop();
    store.fileCount -= 1;
    expect(findPokemonPersonalFormOwner(project, 1000)).toBeUndefined();
    store.rawFiles = store.rawFiles.map((bytes) => bytes.slice());
    store.records.clear();
    expect(findPokemonPersonalFormOwner(project, 999)).toBeUndefined();
  });

  it("does not treat a malformed self-pointer as its own form owner", () => {
    const project = makeProject();
    setForms(project, 650, 650, 3);
    expect(findPokemonPersonalFormOwner(project, 650)).toBeUndefined();
    expect(findPokemonPersonalFormOwner(project, 651)?.speciesId).toBe(650);
  });

  it("refreshes after a personal subfile is imported through the file-system editor", () => {
    const project = makeProject();
    setForms(project, 1, 650, 2);
    expect(findPokemonPersonalFormOwner(project, 650)?.speciesId).toBe(1);
    const replacement = project.narcs.personal!.rawFiles[1].slice();
    writeU16(replacement, 28, 900);
    replacement[32] = 2;
    replaceNarcFile(project, {} as NintendoDSRom, 1, 1, replacement);
    expect(findPokemonPersonalFormOwner(project, 650)).toBeUndefined();
    expect(findPokemonPersonalFormOwner(project, 900)?.speciesId).toBe(1);
  });
});
