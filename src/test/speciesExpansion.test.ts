import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ExpansionSpecies } from "../pokeweb/speciesExpansionModel";
import { patchFieldSpeciesGuardCode } from "../pokeweb/speciesExpansionModel";
import {
  expansionSpeciesOf, expansionSpriteOf, firstAppendedFormRecord, isAddedSpecies, nationalNumberOf, readSpeciesExpansionTable,
  storedSpeciesId,
} from "../pokeweb/speciesExpansionIds";
import type { ProjectState } from "../pokeweb/projectStore";
import type { PwanLibraryManifest } from "../pokeweb/pwanLibraryModel";

const content = JSON.parse(readFileSync(new URL("../assets/data/speciesExpansion.json", import.meta.url), "utf8")) as
  { format: string; species: ExpansionSpecies[] };
const manifest = JSON.parse(readFileSync(new URL("../assets/codeinjection/speciesExpansionManifest.json", import.meta.url), "utf8")) as {
  games: Record<"W2" | "B2", Record<"core" | "summary" | "box", { fileName: string; configOffset?: number; targets: Array<{ kind: string; address: string }> }>>;
};
const library = JSON.parse(readFileSync(new URL("../assets/pwan/library/manifest.json", import.meta.url), "utf8")) as PwanLibraryManifest;
const installed = (count: number) => ({
  codeInjection: { speciesExpansion: { version: 1, count, regionalDexFile: 1087, formShift: 378, sprites: Array.from({ length: count }, (_, i) => 754 + i), cries: [] } },
  session: { baseRom: "BW2" },
}) as unknown as Pick<ProjectState, "codeInjection" | "session">;

describe("Species expansion package", () => {
  it("has national 650-1023 in order, each with its data", () => {
    expect(content.format).toBe("pokeweb-species-expansion-v1");
    expect(content.species.map((entry) => entry.national)).toEqual(Array.from({ length: 374 }, (_, i) => 650 + i));
    for (const entry of content.species) {
      expect(entry.name.length).toBeLessThanOrEqual(10); // the game's name length
      expect(entry.personal.stats).toHaveLength(6);
      expect(entry.personal.tm).toHaveLength(4);
      expect(entry.abilities).toHaveLength(3);
      expect(entry.learnset.length).toBeGreaterThan(0);
      expect(entry.learnset.length).toBeLessThanOrEqual(25);
      expect(entry.cry).toBeGreaterThanOrEqual(1);
      expect(entry.cry).toBeLessThanOrEqual(649); // a retail cry
      for (const row of entry.evolutions) expect(row.species).toBeGreaterThanOrEqual(650);
    }
    const restricted = content.species.filter((entry) => entry.restricted).map((entry) => entry.name);
    expect(restricted).toHaveLength(44);
    expect(restricted).toEqual(expect.arrayContaining(["Xerneas", "Magearna", "Zacian", "Koraidon"]));
    expect(restricted).not.toEqual(expect.arrayContaining(["Nihilego", "Great Tusk"])); // Ultra Beasts, Paradox
    const chespin = content.species[0]!;
    expect(chespin).toMatchObject({ name: "Chespin", family: 650, personal: { stats: [56, 61, 65, 38, 48, 45] } });
    expect(chespin.evolutions).toEqual([expect.objectContaining({ method: 4, param: 16, species: 651 })]);
  });

  it("takes sprites from PWAN library entries of the species", () => {
    const entries = new Map(library.entries.map((entry) => [entry.id, entry]));
    for (const entry of content.species) {
      if (!entry.library) continue;
      const sprite = entries.get(entry.library);
      expect(sprite, entry.name).toBeTruthy();
      expect(sprite!.speciesId).toBe(entry.spriteStandIn ?? entry.national);
    }
  });
});

describe("Species expansion numbering", () => {
  it("numbers the added species national + 37, after retail's sentinels", () => {
    expect(expansionSpeciesOf(649)).toBe(649);
    expect(expansionSpeciesOf(650)).toBe(687);
    expect(expansionSpeciesOf(1025)).toBe(1062);
    const project = installed(374);
    expect(isAddedSpecies(project, 686)).toBe(false);
    expect(isAddedSpecies(project, 687)).toBe(true);
    expect(isAddedSpecies(project, 1060)).toBe(true);
    expect(isAddedSpecies(project, 1061)).toBe(false);
    expect(nationalNumberOf(project, 687)).toBe(650);
    expect(nationalNumberOf(project, 650)).toBe(650); // the Egg
    expect(expansionSpriteOf(project, 688)).toBe(755);
    expect(firstAppendedFormRecord(project)).toBe(1088);
    expect(firstAppendedFormRecord({ session: { baseRom: "BW2" } } as never)).toBe(710);
    expect(storedSpeciesId(project, 1060)).toBe(1060);
    expect(storedSpeciesId({} as never, 1060)).toBe(36); // without the expansion: 10 bits
  });

  it("reads the numbering back from a core DLL's table", () => {
    for (const game of ["W2", "B2"] as const) {
      const entry = manifest.games[game].core;
      const bytes = new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${entry.fileName}`, import.meta.url)));
      expect(String.fromCharCode(...bytes.subarray(entry.configOffset!, entry.configOffset! + 4))).toBe("PWSX");
      expect(readSpeciesExpansionTable(bytes)).toBeUndefined(); // the bundled table is empty
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      view.setUint16(entry.configOffset! + 6, 2, true);
      view.setUint16(entry.configOffset! + 8, 1087, true);
      view.setUint16(entry.configOffset! + 12, 754, true);
      view.setUint16(entry.configOffset! + 14, 252, true);
      view.setUint16(entry.configOffset! + 16, 755, true);
      view.setUint16(entry.configOffset! + 18, 253 | 0x8000, true); // restricted
      expect(readSpeciesExpansionTable(bytes)).toEqual({ version: 1, count: 2, regionalDexFile: 1087, formShift: 378, sprites: [754, 755], cries: [252, 253], restricted: [688], mythical: [] });
    }
  });

  it("replaces the functions that take stack arguments with the stack-preserving branch", () => {
    for (const game of ["W2", "B2"] as const) {
      const kinds = manifest.games[game].core.targets.map((target) => target.kind);
      // GetPokemonDataIDBase, getWaveInfoFunc, addToDex, PokeDex_GetShownSexRareForm, PokeDex_HasSeenVariant
      expect(kinds.filter((kind) => kind === "THUMB_BRANCH_SAFESTACK")).toHaveLength(5);
      expect(kinds.filter((kind) => kind === "THUMB_BRANCH")).toHaveLength(18);
    }
  });
});

describe("Field species check", () => {
  const retail = Uint8Array.from([0x00, 0x00, 0x38, 0x1c, 0x05, 0x90, 0x65, 0x30, 0x00, 0x26, 0x05, 0x90, 0x03, 0x98]);
  it("raises retail's limit (649) to the last added species", () => {
    const patched = patchFieldSpeciesGuardCode(retail, 1060);
    // movs r0, #132 / lsls r0, r0, #3 / adds r0, #4: 1060
    expect([...patched.subarray(2, 8)]).toEqual([132, 0x20, 0xc0, 0x00, 4, 0x30]);
    expect([...patched.subarray(8)]).toEqual([...retail.subarray(8)]);
    expect([...patchFieldSpeciesGuardCode(patched, 1062).subarray(2, 8)]).toEqual([132, 0x20, 0xc0, 0x00, 6, 0x30]); // again
    expect(() => patchFieldSpeciesGuardCode(Uint8Array.of(0, 1, 2, 3), 1060)).toThrow(/not found/u);
  });
});
