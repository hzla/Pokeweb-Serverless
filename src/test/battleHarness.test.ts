import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { configureHarnessRuntime, parseHarnessConfig, patchHarnessExpandedPartyGuard, patchHarnessSave, patchHarnessTrainer } from "../pokeweb/battleHarness";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import type { ProjectState, NarcStore } from "../pokeweb/projectStore";
import { decryptPk5Party, patchTestBattleSavePlayerParty, refreshTestBattlePartyChecksums } from "../pokeweb/testBattleTeam";
import type { NarcName } from "../pokeweb/constants";

function fixture() {
  const formats = getNarcFormats("BW2");
  const row = (format: FieldSpec[], values: Record<string, number>) => {
    const data = new Uint8Array(format.reduce((sum, [size]) => sum + size, 0));
    let offset = 0;
    for (const [size, key] of format) { for (let i = 0; i < size; i++) data[offset + i] = (values[key] ?? 0) >>> (i * 8); offset += size; }
    return data;
  };
  const store = (name: NarcName, files: Uint8Array[]): NarcStore => ({ name, fileId: 1, sourcePath: "fixture", fileCount: files.length, rawFiles: files, records: new Map(), dirty: new Set() });
  const personal = { base_hp: 45, base_atk: 49, base_def: 49, base_speed: 45, base_spatk: 65, base_spdef: 65, exp_rate: 3, ability_1: 1, ability_2: 2, ability_3: 3, gender: 127, num_forms: 1 };
  const project = {
    session: { romName: "fixture", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    arm9: new Uint8Array(), overlays: {}, formats, trpokInfo: [{ template: 0, numPokemon: 1 }, { template: 0, numPokemon: 1 }],
    texts: { banks: { pokedex: ["None", "Bulbasaur", "Ivysaur"], moves: ["None", "Tackle", "Vine Whip"], items: ["None", "Potion"], abilities: ["None", "Overgrow", "Chlorophyll", "Hidden"] } },
    narcs: {
      personal: store("personal", [row(formats.personal!, {}), row(formats.personal!, personal), row(formats.personal!, { ...personal, base_hp: 60 })]),
      moves: store("moves", [row(formats.moves!, {}), row(formats.moves!, { pp: 35 }), row(formats.moves!, { pp: 10 })]),
      trdata: store("trdata", [row(formats.trdata!, { num_pokemon: 1 }), row(formats.trdata!, { num_pokemon: 1, class: 1, ai: 7 })]),
      trpok: store("trpok", [Uint8Array.of(0, 16, 20, 0, 1, 0, 0, 0), Uint8Array.of(0, 16, 20, 0, 1, 0, 0, 0)]),
    },
  } as unknown as ProjectState;
  const save = patchTestBattleSavePlayerParty(new Uint8Array(0x80000), project, "Bulbasaur\nLevel: 50\n- Tackle\n\nIvysaur\nLevel: 40\n- Vine Whip");
  for (const half of [0, 0x26000]) { writeU32(save, half + 0x18e00, 6); refreshTestBattlePartyChecksums(save, half); }
  return { project, save };
}
const mon = (save: Uint8Array, slot = 0, half = 0) => decryptPk5Party(save.subarray(half + 0x18e08 + slot * 220, half + 0x18e08 + (slot + 1) * 220));

describe("automatic battle harness", () => {
  const template = new Uint8Array(readFileSync(new URL("../assets/testbattle/BattleHarnessW2.dll", import.meta.url)));
  it("ships a source-matched, CPU-verified browser template", () => {
    const receipt = JSON.parse(readFileSync(new URL("../assets/testbattle/BattleHarnessW2.json", import.meta.url), "utf8"));
    const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    expect(receipt.dllSha256).toBe(hash(template));
    expect(parseRpm(template, { allowedMagics: ["DLXF"] }).relocations.filter(r => r.target.module !== "base")).toEqual([expect.objectContaining({ target: { module: "167", address: 0x021ce9e4, type: "THUMB_BRANCH_LINK" } }), expect.objectContaining({ target: { module: "12", address: 0x0215a790, type: "FULL_COPY" } })]);
    for (const [name, expected] of Object.entries(receipt.sources)) expect(hash(readFileSync(new URL(`../../runtime/battle-harness/${name}`, import.meta.url)))).toBe(expected);
    expect(receipt.verification).toMatchObject({ cpuChecks: 1400, fixedPayloadBytes: 780, temporaryEventBytes: 68, bootPath: "direct-save-to-battle", openingPresentation: "direct-placement" });
  });
  it.each([[123, 1], [456, 2], [65535, 3], [0, 0]])("configures trainer %i / rule %i without changing executable bytes or relocations", (trainer, rule) => {
    const before = parseRpm(template, { allowedMagics: ["DLXF"] });
    const after = parseRpm(configureHarnessRuntime(template, trainer, rule), { allowedMagics: ["DLXF"] });
    const config = after.symbols.find(symbol => symbol.nameHash === 0xc3592c1b)!;
    expect(readU16(after.code, config.address + 6)).toBe(trainer);
    expect(readU32(after.code, config.address + 8)).toBe(rule);
    const executable = after.code.slice(); executable.set(before.code.subarray(config.address + 6, config.address + 12), config.address + 6);
    expect(executable).toEqual(before.code);
    expect(after.relocations).toEqual(before.relocations);
    expect(after.bssSize).toBe(before.bssSize);
  });
  it("rejects corrupted configuration headers and invalid scenario IDs", () => {
    const corrupt = parseRpm(template, { allowedMagics: ["DLXF"] });
    const config = corrupt.symbols.find(symbol => symbol.nameHash === 0xc3592c1b)!;
    corrupt.code[config.address] ^= 1;
    expect(() => configureHarnessRuntime(writeRpm(corrupt, { ident: "DLXF" }), 123, 0)).toThrow(/integrity/);
    expect(() => configureHarnessRuntime(template, 65536, 0)).toThrow(/trainerId/);
    expect(() => configureHarnessRuntime(template, 123, 4)).toThrow(/battle type/);
  });
  it("adapts only the audited expanded-species startup branch and rejects altered sites", () => {
    const { project } = fixture();
    const original = Uint8Array.of(0xaa, 0xbb, 0x81, 0x42, 0x02, 0xd9, 0xff, 0x20, 0xa0, 0x77, 0xe0, 0x77, 0xcc);
    const overlay = { data: original, ramAddress: 0x021c9ece };
    patchHarnessExpandedPartyGuard(project, overlay);
    const expected = original.slice(); expected[5] = 0xe0;
    expect(project.overlays[36]).toEqual(expected);
    expect(project.patches?.dirtyOverlayIds).toEqual([36]);
    expect(original[5]).toBe(0xd9);
    patchHarnessExpandedPartyGuard(project, overlay);
    expect(project.overlays[36]).toEqual(expected);
    const changed = project.overlays[36]!;
    changed[6] = (changed[6] ?? 0) ^ 1;
    expect(() => patchHarnessExpandedPartyGuard(project, overlay)).toThrow(/signature mismatch/);
  });
  it("preserves every save byte by default", () => {
    const { project, save } = fixture();
    const result = patchHarnessSave(save, project, { trainerId: 1 });
    expect(result).toEqual(save);
    expect(result).not.toBe(save);
    for (const half of [0, 0x26000]) { writeU32(save, half + 0x18e00, 2); refreshTestBattlePartyChecksums(save, half); }
    expect(patchHarnessSave(save, project, { trainerId: 1 })).toEqual(save);
  });
  it("edits HP/status/zero PP on both redundant halves without changing identity or other slots", () => {
    const { project, save } = fixture();
    const original = save.slice();
    const output = patchHarnessSave(save, project, { trainerId: 1, player: { edits: [{ slot: 0, currentHp: 0, status: "paralysis", pp: [0, 0, 0, 0] }] } });
    for (const half of [0, 0x26000]) {
      const before = mon(save, 0, half), after = mon(output, 0, half);
      expect(readU16(after, 0x8e)).toBe(0);
      expect(readU32(after, 0x88)).toBe(64);
      expect(Array.from(after.subarray(0x30, 0x34))).toEqual([0, 0, 0, 0]);
      expect(after.subarray(0, 6)).toEqual(before.subarray(0, 6));
      expect(after.subarray(0x48, 0x88)).toEqual(before.subarray(0x48, 0x88));
      expect(output.subarray(half + 0x18e08 + 220, half + 0x18e08 + 440)).toEqual(save.subarray(half + 0x18e08 + 220, half + 0x18e08 + 440));
      expect(readU16(output, half + 0x19336)).toBe(readU16(output, half + 0x25f34));
    }
    expect(save).toEqual(original);
    expect(patchHarnessSave(output, project, { trainerId: 1 })).toEqual(output); // Valid block and PK5 checksums.
  });
  it("replaces the party with numeric species/move/ability/form and condition settings", () => {
    const { project, save } = fixture();
    const output = patchHarnessSave(save, project, { trainerId: 1, player: { team: [{ speciesId: 2, level: 60, abilityId: 3, abilitySlot: 3, moves: [2, 1], itemId: 1, currentHp: 12, status: "toxic", nature: 13, evs: { atk: 252, spe: 252, hp: 4 }, ivs: { spa: 0 } }] } });
    const data = mon(output);
    expect(output[0x18e04]).toBe(1);
    expect(readU16(data, 8)).toBe(2);
    expect(data[0x8c]).toBe(60);
    expect(data[0x15]).toBe(3);
    expect(data[0x42] & 1).toBe(1);
    expect(readU16(data, 0x8e)).toBe(12);
    expect(readU32(data, 0x88)).toBe(128);
    expect(readU16(data, 0x28)).toBe(2);
    expect(output.subarray(0x18e08 + 220, 0x18e08 + 1320).every(v => v === 0)).toBe(true);
    expect(patchHarnessSave(output, project, { trainerId: 1 })).toEqual(output);
  });
  it("recalculates level/species stats without resetting HP/status or trainer identity", () => {
    const { project, save } = fixture();
    const hurt = patchHarnessSave(save, project, { trainerId: 1, player: { edits: [{ slot: 0, currentHp: 3, status: "burn" }] } });
    const output = patchHarnessSave(hurt, project, { trainerId: 1, player: { edits: [{ slot: 0, speciesId: 2, level: 70, abilitySlot: 2, moves: [2] }] } });
    const data = mon(output);
    expect(readU16(data, 8)).toBe(2);
    expect(readU16(data, 0x8e)).toBe(3);
    expect(readU16(data, 0x90)).toBeGreaterThan(readU16(mon(hurt), 0x90));
    expect(readU32(data, 0x88)).toBe(16);
    expect(data[0x15]).toBe(2);
    expect(readU32(data, 0xc)).toBe(readU32(mon(hurt), 0xc));
  });
  it.each(["Singles", "Doubles", "Triples", "Rotation"] as const)("serializes only the selected trainer's %s team", battleType => {
    const { project } = fixture();
    const before = project.narcs.trdata!.rawFiles[0].slice();
    const team = [0, 1, 2].map(() => ({ speciesId: 2, level: 70, abilitySlot: 2 as const, abilityId: 2, moves: [2], itemId: 1 }));
    const rule = patchHarnessTrainer(project, { trainerId: 1, battleType, trainer: { team, ai: 0x123, trainerClass: 5 } });
    expect(rule).toBe(["Singles", "Doubles", "Triples", "Rotation"].indexOf(battleType));
    materializeProjectEdits(project);
    expect(project.narcs.trdata!.rawFiles[0]).toEqual(before);
    const data = project.narcs.trdata!.rawFiles[1];
    expect(data[0]).toBe(3);
    expect(data[1]).toBe(5);
    expect(data[2]).toBe(rule);
    expect(data[3]).toBe(3);
    const pokemon = project.narcs.trpok!.rawFiles[1];
    expect(pokemon[1] >>> 4).toBe(2);
    expect(readU16(pokemon, 4)).toBe(2);
    expect(readU16(pokemon, 10)).toBe(2);
  });
  it("rejects unknown fields and unsupported/invalid inputs", () => {
    const { project, save } = fixture();
    expect(() => parseHarnessConfig({ trainerId: 1, player: { edits: [{ slot: 0, hp: 3 }] } })).toThrow(/Unknown/);
    expect(() => parseHarnessConfig({ trainerId: 1, player: { edits: [{ slot: 0 }, { slot: 0 }] } })).toThrow(/Duplicate/);
    expect(() => patchHarnessSave(save, project, { trainerId: 1, player: { edits: [{ slot: 0, currentHp: 65535 }] } })).toThrow(/currentHp/);
    expect(() => patchHarnessSave(save, project, { trainerId: 1, player: { team: [{ speciesId: 1, currentHp: 0 }] } })).toThrow(/eligible battler/);
    expect(() => patchHarnessSave(save, project, { trainerId: 1, player: { team: [{ speciesId: 1, form: 2 }] } })).toThrow(/Form 2/);
    expect(() => patchHarnessTrainer(project, { trainerId: 1, trainer: { team: [{ speciesId: 1, abilityId: 99 }] } })).toThrow(/abilityId/);
    const bad = save.slice(); bad[0x18e10] ^= 1; bad[0x26000 + 0x18e10] ^= 1;
    expect(() => patchHarnessSave(bad, project, { trainerId: 1 })).toThrow(/No valid/);
    const badMon = save.slice(); writeU16(badMon, 0x18e08 + 6, 0);
    // A torn block is excluded before a PK5 can be misinterpreted.
    expect(patchHarnessSave(badMon, project, { trainerId: 1 })).toEqual(badMon);
  });
});
