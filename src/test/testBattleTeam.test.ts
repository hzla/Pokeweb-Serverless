import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import { decryptPk5Party, encryptPk5Party, parseShowdownTeam, patchTestBattleSavePlayerParty } from "../pokeweb/testBattleTeam";

describe("testBattleTeam", () => {
  it("parses Showdown imports with defaults and name resolution", () => {
    const project = makeProject();
    const team = parseShowdownTeam(
      project,
      `
Bulby (Bulbasaur) (M) @ Potion
Ability: Chlorophyll
Level: 50
EVs: 4 HP / 252 Atk / 252 Spe
IVs: 0 SpA
Jolly Nature
- Tackle
- Vine Whip

Ivysaur
- Razor Leaf
`,
    );

    expect(team).toHaveLength(2);
    expect(team[0]).toMatchObject({
      speciesId: 1,
      itemId: 1,
      abilitySlot: 2,
      abilityId: 2,
      level: 50,
      nature: 13,
      gender: 0,
      moves: [1, 2],
    });
    expect(team[0]?.evs).toMatchObject({ hp: 4, atk: 252, spe: 252, spa: 0 });
    expect(team[0]?.ivs).toMatchObject({ hp: 31, atk: 31, spa: 0 });
    expect(team[1]).toMatchObject({ speciesId: 2, itemId: 0, abilitySlot: 1, level: 100, nature: 0 });
  });

  it("throws for unknown specified names", () => {
    const project = makeProject();
    expect(() => parseShowdownTeam(project, "Bulbasaur\n- Fake Move")).toThrow(/Unknown move: Fake Move/u);
    expect(() => parseShowdownTeam(project, "Bulbasaur\nAbility: Fake Ability")).toThrow(/Unknown ability: Fake Ability/u);
    expect(() => parseShowdownTeam(project, "Missingno")).toThrow(/Unknown Pokemon: Missingno/u);
  });

  it("allows abilities outside the species personal ability slots", () => {
    const project = makeProject();
    const [named] = parseShowdownTeam(project, "Bulbasaur\nAbility: Huge Power");
    const [numeric] = parseShowdownTeam(project, "Bulbasaur\nAbility: 42");

    expect(named).toMatchObject({ abilitySlot: 1, abilityId: 4 });
    expect(numeric).toMatchObject({ abilitySlot: 1, abilityId: 42 });
  });

  it("roundtrips PK5 party encryption", () => {
    const decrypted = new Uint8Array(220);
    writeLe32(decrypted, 0, 0x12345678);
    writeLe16(decrypted, 0x08, 1);
    writeLe16(decrypted, 0x0a, 1);
    writeLe32(decrypted, 0x10, 125000);
    decrypted[0x15] = 1;
    decrypted[0x41] = 13;
    writeLe16(decrypted, 0x90, 121);

    const encrypted = encryptPk5Party(decrypted);
    const roundtrip = decryptPk5Party(encrypted);

    expect(readLe32(roundtrip, 0)).toBe(0x12345678);
    expect(readLe16(roundtrip, 0x08)).toBe(1);
    expect(readLe16(roundtrip, 0x0a)).toBe(1);
    expect(readLe32(roundtrip, 0x10)).toBe(125000);
    expect(readLe16(roundtrip, 0x90)).toBe(121);
    expect(encryptPk5Party(roundtrip)).toEqual(encrypted);
  });

  it("writes a Showdown team into both BW2 save party halves with live stats and checksums", () => {
    const project = makeProject();
    const save = makeSaveWithTemplateParty();

    const patched = patchTestBattleSavePlayerParty(
      save,
      project,
      `
Bulby (Bulbasaur) @ Potion
Ability: Chlorophyll
Level: 50
EVs: 4 HP / 252 Atk / 252 Spe
IVs: 0 SpA
Jolly Nature
- Tackle
- Vine Whip
`,
    );

    for (const half of [0, 0x26000]) {
      const party = half + 0x18e00;
      expect(patched[party]).toBe(1);
      expect(patched[party + 4]).toBe(1);
      expect(readLe16(patched, half + 0x19336)).toBe(crc16Ccitt(patched.subarray(party, party + 0x534)));
      expect(readLe16(patched, half + 0x25f34)).toBe(readLe16(patched, half + 0x19336));
      expect(readLe16(patched, half + 0x25fa2)).toBe(crc16Ccitt(patched.subarray(half + 0x25f00, half + 0x25f00 + 0x94)));

      const first = decryptPk5Party(patched.subarray(party + 8, party + 8 + 220));
      expect(readLe16(first, 0x08)).toBe(1);
      expect(readLe16(first, 0x0a)).toBe(1);
      expect(readLe32(first, 0x0c)).toBe(0x9abc5678);
      expect(first[0x17]).toBe(2);
      expect(first[0x15]).toBe(2);
      expect(first[0x41]).toBe(13);
      expect(first[0x5f]).toBe(22);
      expect([...first.subarray(0x68, 0x78)]).toEqual([...patched.subarray(half + 0x19404, half + 0x19414)]);
      expect(first[0x84] >> 7).toBe(1);
      expect(readLe16(first, 0x28)).toBe(1);
      expect(readLe16(first, 0x2a)).toBe(2);
      expect(first[0x30]).toBe(35);
      expect(first[0x31]).toBe(10);
      expect(first[0x8c]).toBe(50);
      expect(readLe16(first, 0x8e)).toBe(121);
      expect(readLe16(first, 0x90)).toBe(121);
      expect(readLe16(first, 0x92)).toBe(101);
      expect(readLe16(first, 0x94)).toBe(69);
      expect(readLe16(first, 0x96)).toBe(106);
      expect(readLe16(first, 0x98)).toBe(63);
      expect(readLe16(first, 0x9a)).toBe(85);

      const second = decryptPk5Party(patched.subarray(party + 8 + 220, party + 8 + 440));
      expect(readLe16(second, 0x08)).toBe(0);
    }
  });

  it("keeps the save unchanged for an empty import", () => {
    const project = makeProject();
    const save = makeSaveWithTemplateParty();
    expect(patchTestBattleSavePlayerParty(save, project, " \n")).toEqual(save);
  });
});

function makeProject(): ProjectState {
  const formats = getNarcFormats("BW2");
  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { personal: 1, moves: 2, items: 3 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      personal: makeStore("personal", [
        new Uint8Array(personalRowLength(formats.personal!)),
        packRows(formats.personal!, [{ base_hp: 45, base_atk: 49, base_def: 49, base_speed: 45, base_spatk: 65, base_spdef: 65, exp_rate: 3, base_happy: 70, ability_1: 1, ability_2: 2, ability_3: 3, gender: 127 }]),
        packRows(formats.personal!, [{ base_hp: 60, base_atk: 62, base_def: 63, base_speed: 60, base_spatk: 80, base_spdef: 80, exp_rate: 3, base_happy: 70, ability_1: 1, ability_2: 2, ability_3: 3, gender: 127 }]),
      ]),
      moves: makeStore("moves", [
        new Uint8Array(moveRowLength(formats.moves!)),
        packRows(formats.moves!, [{ pp: 35 }]),
        packRows(formats.moves!, [{ pp: 10 }]),
        packRows(formats.moves!, [{ pp: 25 }]),
      ]),
      items: makeStore("items", [new Uint8Array(1), new Uint8Array(1)]),
    },
    texts: {
      banks: {
        pokedex: ["None", "Bulbasaur", "Ivysaur"],
        abilities: ["None", "Overgrow", "Chlorophyll", "Hidden", "Huge Power"],
        items: ["None", "Potion"],
        moves: ["None", "Tackle", "Vine Whip", "Razor Leaf"],
      },
    },
    formats,
    trpokInfo: [],
  };
}

function makeSaveWithTemplateParty(): Uint8Array {
  const save = new Uint8Array(0x80000);
  for (const half of [0, 0x26000]) {
    const player = half + 0x19400;
    save.set(Uint8Array.from([0x41, 0, 0x4e, 0, 0x44, 0, 0x59, 0, 0xff, 0xff, 0, 0, 0, 0, 0, 0]), player + 0x04);
    writeLe32(save, player + 0x14, 0x9abc5678);
    save[player + 0x1e] = 2;
    save[player + 0x1f] = 22;
    save[player + 0x21] = 1;
    const party = half + 0x18e00;
    save[party] = 1;
    save[party + 4] = 1;
    save.set(makeTemplatePokemon(), party + 8);
  }
  return save;
}

function makeTemplatePokemon(): Uint8Array {
  const decrypted = new Uint8Array(220);
  writeLe32(decrypted, 0, 0x11112222);
  writeLe16(decrypted, 0x08, 1);
  writeLe16(decrypted, 0x0c, 12345);
  writeLe16(decrypted, 0x0e, 54321);
  decrypted[0x17] = 1;
  decrypted[0x5f] = 21;
  decrypted.set(Uint8Array.from([0x54, 0, 0x52, 0, 0x41, 0, 0x44, 0, 0x45, 0, 0xff, 0xff, 0, 0, 0, 0]), 0x68);
  return encryptPk5Party(decrypted);
}

function makeStore(name: NarcName, rawFiles: Uint8Array[]): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: rawFiles.length,
    rawFiles,
    records: new Map(),
    dirty: new Set(),
  };
}

function packRows(format: FieldSpec[], rows: Array<Record<string, number>>): Uint8Array {
  const rowLength = format.reduce((sum, [size]) => sum + size, 0);
  const out = new Uint8Array(rowLength * rows.length);
  rows.forEach((row, rowIndex) => {
    let offset = rowIndex * rowLength;
    for (const [size, field] of format) {
      writeInt(out, offset, size, row[field] ?? 0);
      offset += size;
    }
  });
  return out;
}

function personalRowLength(format: FieldSpec[]): number {
  return format.reduce((sum, [size]) => sum + size, 0);
}

function moveRowLength(format: FieldSpec[]): number {
  return format.reduce((sum, [size]) => sum + size, 0);
}

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  for (let index = 0; index < size; index += 1) out[offset + index] = Math.floor(value / 2 ** (8 * index)) & 0xff;
}

function crc16Ccitt(data: Uint8Array): number {
  let top = 0xff;
  let bottom = 0xff;
  for (const byte of data) {
    let value = byte ^ top;
    value ^= value >> 4;
    top = (bottom ^ (value >> 3) ^ (value << 4)) & 0xff;
    bottom = (value ^ (value << 5)) & 0xff;
  }
  return ((top << 8) | bottom) & 0xffff;
}

function readLe16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function writeLe16(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
}

function readLe32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)) >>> 0;
}

function writeLe32(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}
