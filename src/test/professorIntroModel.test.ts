import { describe, expect, it } from "vitest";
import { readU32, writeU32 } from "../nds/binary";
import { applyProfessorIntroPokemon, getProfessorIntroPokemonState, loadProfessorIntroPokemon } from "../pokeweb/professorIntroModel";
import { createProjectDocument } from "../pokeweb/projectDocument";
import { openProjectSession } from "../pokeweb/projectSession";
import { makeEditProject } from "./fixtures/editProject";

function fixture(idCode = "IRDO") {
  const project = makeEditProject();
  project.romInfo.idCode = idCode;
  const intro = new Uint8Array(0x3220).fill(0xa5), start = new Uint8Array(0x4cc0).fill(0xa5);
  const cryOffset = idCode === "IREO" ? 0x32f0 : 0x3328;
  const words = (at: number, values: number[]) => values.forEach((value, i) => writeU32(intro, at + i * 4, value));
  words(0x2a64, [23, 1, 573, 0xffffb000, 0xfffff800, 1, 24, 1, 0, 0, 0, 0]);
  words(0x2f5c, [33, 573, 0, 0, 0, 0, 30, 8, 0, 1, 0, 0]);
  const call = idCode === "IREO" ? "66f686fc" : "66f64afc";
  start.set(Buffer.from(`00210091019102911048039140220023${call}6065a16d2161e16d61610121a161216be1612062`, "hex"), cryOffset - 0x4c);
  writeU32(start, cryOffset, 573);
  project.overlays = { 162: start, 294: intro };
  project.patches = { dirtyOverlayIds: [36], applied: {} };
  return { project, intro, start, cryOffset };
}

describe("BW2 professor intro Pokémon", () => {
  it.each(["IRDO", "IREO"])("updates the %s sprite, appearance operand and actual cry together without touching other bytes", async idCode => {
    const { project, intro, start, cryOffset } = fixture(idCode);
    expect(await loadProfessorIntroPokemon(project)).toEqual({ speciesId: 573, crySpeciesId: 573, warnings: [] });
    applyProfessorIntroPokemon(project, 25);
    expect(getProfessorIntroPokemonState(project)).toEqual({ speciesId: 25, crySpeciesId: 25, warnings: [] });
    expect(readU32(project.overlays[294]!, 0x2a6c)).toBe(25);
    expect(readU32(project.overlays[294]!, 0x2f60)).toBe(25);
    expect(readU32(project.overlays[162]!, cryOffset)).toBe(25);
    const restoredIntro = project.overlays[294]!.slice(), restoredStart = project.overlays[162]!.slice();
    for (const offset of [0x2a6c, 0x2f60]) restoredIntro.set(intro.subarray(offset, offset + 4), offset);
    restoredStart.set(start.subarray(cryOffset, cryOffset + 4), cryOffset);
    expect(restoredIntro).toEqual(intro);
    expect(restoredStart).toEqual(start);
    expect(project.patches!.dirtyOverlayIds).toEqual([36, 162, 294]);
    applyProfessorIntroPokemon(project, 649);
    expect(getProfessorIntroPokemonState(project).speciesId).toBe(649);
    expect(project.patches!.dirtyOverlayIds).toEqual([36, 162, 294]);
  });

  it("keeps an unchanged selection byte-identical and clean", () => {
    const { project, start, intro } = fixture();
    applyProfessorIntroPokemon(project, 573);
    expect(project.overlays[162]).toBe(start);
    expect(project.overlays[294]).toBe(intro);
    expect(project.patches!.dirtyOverlayIds).toEqual([36]);
    expect(project.actionChangelog).toBeUndefined();
  });

  it("repairs independently modified sprite/sound references", () => {
    const { project, cryOffset } = fixture();
    writeU32(project.overlays[162]!, cryOffset, 133);
    writeU32(project.overlays[294]!, 0x2f60, 1);
    expect(getProfessorIntroPokemonState(project).warnings).toHaveLength(1);
    expect(applyProfessorIntroPokemon(project, 573).warnings).toEqual([]);
    expect(readU32(project.overlays[162]!, cryOffset)).toBe(573);
    expect(readU32(project.overlays[294]!, 0x2f60)).toBe(573);
    expect(project.actionChangelog?.entries).toHaveLength(1);
  });

  it.each([0, 650, -1, 25.5, NaN, Infinity])("rejects unsupported species %s before changing either overlay", species => {
    const { project, start, intro } = fixture();
    expect(() => applyProfessorIntroPokemon(project, species)).toThrow(/1 through 649/);
    expect(project.overlays[162]).toBe(start);
    expect(project.overlays[294]).toBe(intro);
    expect(project.patches!.dirtyOverlayIds).toEqual([36]);
  });

  it.each([[294, 0x2a64], [294, 0x2f5c], [162, 0x32dc]])("rejects changed native readers atomically (overlay %s)", (id, offset) => {
    const { project, start, intro } = fixture();
    project.overlays[id]![offset] ^= 1;
    expect(() => applyProfessorIntroPokemon(project, 25)).toThrow(/modified|unsupported/);
    expect(project.overlays[162]).toBe(start);
    expect(project.overlays[294]).toBe(intro);
    expect(project.patches!.dirtyOverlayIds).toEqual([36]);
  });

  it("rejects unsupported games, missing/truncated overlays and invalid existing IDs", () => {
    const { project } = fixture();
    project.romInfo.idCode = "IRDJ";
    expect(() => getProfessorIntroPokemonState(project)).toThrow(/US Black 2 and White 2/);
    project.romInfo.idCode = "IRDO";
    project.session.baseRom = "BW";
    expect(() => getProfessorIntroPokemonState(project)).toThrow(/US Black 2 and White 2/);
    project.session.baseRom = "BW2";
    writeU32(project.overlays[294]!, 0x2a6c, 650);
    expect(() => getProfessorIntroPokemonState(project)).toThrow(/species ID/);
    project.overlays[294] = new Uint8Array(12);
    expect(() => getProfessorIntroPokemonState(project)).toThrow(/layout/);
    const truncated = fixture();
    truncated.project.overlays[162] = truncated.start.slice(0, truncated.cryOffset + 2);
    expect(() => applyProfessorIntroPokemon(truncated.project, 25)).toThrow(/truncated/);
    expect(truncated.project.overlays[294]).toBe(truncated.intro);
    delete project.overlays[294];
    expect(() => getProfessorIntroPokemonState(project)).toThrow(/not loaded/);
  });

  it("retains both edited overlays and dirty flags through compact project autosave", () => {
    const { project } = fixture();
    applyProfessorIntroPokemon(project, 133);
    const document = structuredClone(createProjectDocument(project, true));
    const reopened = openProjectSession(document);
    expect(getProfessorIntroPokemonState(reopened)).toEqual({ speciesId: 133, crySpeciesId: 133, warnings: [] });
    expect(reopened.patches!.dirtyOverlayIds).toEqual([36, 162, 294]);
    expect(reopened.actionChangelog?.entries.length).toBeGreaterThan(0);
  });
});
