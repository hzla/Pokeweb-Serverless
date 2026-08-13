import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import type { NarcName } from "../pokeweb/constants";
import { scanGen5ScriptPokemonCommands } from "../pokeweb/gen5ScriptPokemonScanner";
import { GEN5_INGAME_TRADE_FIELDS } from "../pokeweb/ingameTradeModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import {
  applyGen5ScriptPokemonGroup,
  GEN5_WILD_BATTLE_FLAGS,
  GEN5_WILD_BATTLE_KNOWN_FLAG_MASK,
  scanGen5ScriptPokemon,
} from "../pokeweb/scriptPokemonModel";

describe("gen5ScriptPokemonScanner", () => {
  it("discovers every supported BW2 acquisition layout at arbitrary offsets", () => {
    const body = bytes(
      0xff,
      ...words(0x10c, 0x8010, 1, 0, 5),
      ...words(0x10e, 0x8010, 2, 1, 10, 1, 2, 1, 50, 4),
      ...words(0x10f, 0x8010, 3, 2),
      ...words(0x122, 0x8010, 4, 0, 15),
      ...words(0x123, 0x8010, 5, 3, 20, 2, 1, 2, 75, 5),
      ...words(0x2ea, 0x8010, 6, 25, 4, 1, 2),
      ...words(0x174, 7, 30, 0xffff),
      ...words(0x297, 8, 35, 4, 0x8000),
      ...words(0x1b4, 0, 2),
      ...words(0x1b5, 0x8010, 0, 2),
    );
    const scan = scanGen5ScriptPokemonCommands(makeScriptFile(body), "BW2");

    expect(scan.commands.map((command) => command.type)).toEqual([
      "party_gift", "party_gift_ex", "egg", "box_gift", "box_gift_ex", "n_gift",
      "wild_battle", "wild_battle_ex", "trade_start", "trade_check",
    ]);
    expect(scan.commands[0]!.commandOffset % 2).toBe(1);
    expect(scan.commands[1]!.fields.ball?.value).toBe(4);
    expect(scan.commands[5]!.fields.nature?.value).toBe(4);
    expect(scan.commands[6]!.fields.battleFlags?.value).toBe(0xffff);
  });

  it("uses pointer-table entry provenance and locks multiply-assigned variables", () => {
    const first = bytes(...words(0x28, 0x4000, 25, 0x28, 0x4000, 26, 0x10c, 0x8010, 0x4000, 0, 5));
    const second = bytes(...words(0x28, 0x4001, 133, 0x10f, 0x8010, 0x4001, 1));
    const scan = scanGen5ScriptPokemonCommands(makeMultiEntryScript(first, second), "BW2");

    expect(scan.commands).toHaveLength(2);
    expect(scan.commands[0]!.entryIndex).toBe(0);
    expect(scan.commands[0]!.fields.species).toMatchObject({ writable: false, variableId: 0x4000 });
    expect(scan.commands[1]!.entryIndex).toBe(1);
    expect(scan.commands[1]!.fields.species).toMatchObject({ writable: true, value: 133, variableId: 0x4001 });
    expect(scan.diagnostics.some((diagnostic) => diagnostic.code === "ambiguous_value")).toBe(true);
  });

  it("uses the BW-specific wild and trade command IDs", () => {
    const scan = scanGen5ScriptPokemonCommands(makeScriptFile(bytes(
      ...words(0x178, 25, 20, 1),
      ...words(0x1be, 3, 0),
      ...words(0x1bf, 0x8010, 3, 0),
      ...words(0x2ea, 0x8010, 4, 5, 0, 0, 0),
    )), "BW");
    expect(scan.commands.map((command) => command.type)).toEqual(["wild_battle", "trade_start", "trade_check"]);
  });

  it("retains unique WorkSetConst provenance for every extended gift operand", () => {
    const assignments = [25, 2, 50, 1, 2, 1, 100, 4]
      .flatMap((value, index) => words(0x28, 0x4000 + index, value));
    const command = words(0x10e, 0x8010, 0x4000, 0x4001, 0x4002, 0x4003, 0x4004, 0x4005, 0x4006, 0x4007);
    const scan = scanGen5ScriptPokemonCommands(makeScriptFile(bytes(...assignments, ...command)), "BW2");
    const fields = Object.values(scan.commands[0]!.fields);
    expect(fields.map((field) => field?.value)).toEqual([25, 2, 50, 1, 2, 1, 100, 4]);
    expect(fields.every((field) => field?.writable && field.sourceOffset !== field.operandOffset)).toBe(true);
  });

  it("reports a corrupt pointer table instead of scanning arbitrary bytes", () => {
    const scan = scanGen5ScriptPokemonCommands(bytes(4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), "BW2");
    expect(scan.commands).toEqual([]);
    expect(scan.diagnostics.some((diagnostic) => diagnostic.code === "malformed_pointer_table")).toBe(true);
  });

  it("ignores auxiliary script-archive records that are not command pointer tables", () => {
    for (const auxiliary of [
      bytes(0, 0, 0, 0),
      bytes(2, 0, 1, 0, 0, 0, 0, 0),
      bytes(4, 0, 0x8b, 0x29, 0, 0, 4, 0, 0x9b, 0x28, 0),
    ]) {
      const scan = scanGen5ScriptPokemonCommands(auxiliary, "BW2");
      expect(scan.commands).toEqual([]);
      expect(scan.diagnostics).toEqual([]);
    }
  });
});

describe("scriptPokemonModel", () => {
  it("labels source-defined gift enums and decomposes the wild battle flag mask", () => {
    const project = makeProject({
      scripts: [makeScriptFile(bytes(
        ...words(0x10e, 0x8010, 25, 0, 5, 2, 2, 2, 0, 4),
        ...words(0x2ea, 0x8010, 509, 7, 10, 2, 0),
        ...words(0x174, 150, 70, 0x010b),
      ))],
      trades: [],
    });
    const acquisitions = scanGen5ScriptPokemon(project).groups[0]!.entries[0]!.acquisitions;
    const gift = acquisitions.find((acquisition) => acquisition.kind === "party_gift_ex")!;
    expect(gift.fields.find((field) => field.name === "ability")?.options).toEqual([
      { value: 0, label: "Ability 1" },
      { value: 1, label: "Ability 2" },
      { value: 2, label: "Either / random" },
    ]);
    expect(gift.fields.find((field) => field.name === "gender")?.options?.map((option) => option.label)).toEqual([
      "Male", "Female", "Either / random",
    ]);
    expect(gift.fields.find((field) => field.name === "shiny")?.options?.map((option) => option.label)).toEqual([
      "Force non-shiny", "Force shiny", "Either / random",
    ]);

    const nGift = acquisitions.find((acquisition) => acquisition.kind === "n_gift")!;
    expect(nGift.fields.find((field) => field.name === "ability")?.options?.[2]?.label).toBe("Hidden ability");
    expect(nGift.fields.find((field) => field.name === "gender")?.options?.[2]?.label).toBe("Genderless / unknown");

    const battleFlags = acquisitions.find((acquisition) => acquisition.kind === "wild_battle")!
      .fields.find((field) => field.name === "battleFlags")!;
    expect(battleFlags.control).toBe("bit_flags");
    expect(battleFlags.bitFlags).toBe(GEN5_WILD_BATTLE_FLAGS);
    expect(GEN5_WILD_BATTLE_KNOWN_FLAG_MASK).toBe(0x01ff);
  });

  it("groups acquisitions by relocated script file and current header ownership", () => {
    const project = makeProject({
      scripts: Array.from({ length: 43 }, (_unused, fileId) => fileId === 42
        ? makeScriptFile(bytes(...words(0x122, 0x8010, 25, 0, 5)))
        : makeScriptFile(bytes(0))),
      trades: [],
    });
    project.headers = {
      count: 3,
      rows: {
        1: { index: 1, location_name: "Dreamyard", script_id: 42, level_script_id: 7 },
        2: { index: 2, location_name: "Dreamyard Basement", script_id: 9, level_script_id: 42 },
        3: { index: 3, location_name: "Duplicate", script_id: 42, level_script_id: 42 },
      },
    };

    const group = scanGen5ScriptPokemon(project).groups.find((candidate) => candidate.scriptFileId === 42)!;
    expect(group.locations.map((location) => [location.locationName, location.referenceType])).toEqual([
      ["Dreamyard", "script"],
      ["Dreamyard Basement", "level_script"],
      ["Duplicate", "script"],
      ["Duplicate", "level_script"],
    ]);
    expect(group.entries[0]!.entryIndex).toBe(0);
  });

  it("rejects conflicting edits to one shared WorkSetConst without mutating the project", () => {
    const script = makeScriptFile(bytes(...words(
      0x28, 0x4000, 25,
      0x10c, 0x8010, 0x4000, 0, 5,
      0x10c, 0x8010, 0x4000, 0, 10,
    )));
    const project = makeProject({ scripts: [script], trades: [] });
    const group = scanGen5ScriptPokemon(project).groups[0]!;
    const shared = group.entries.flatMap((entry) => entry.acquisitions)
      .flatMap((acquisition) => acquisition.fields)
      .filter((field) => field.name === "species");
    const before = new Uint8Array(project.narcs.scripts!.rawFiles[0]!);

    expect(() => applyGen5ScriptPokemonGroup(project, group.key, [
      { key: shared[0]!.key, value: 133 },
      { key: shared[1]!.key, value: 150 },
    ])).toThrow(/Conflicting edits/);
    expect(project.narcs.scripts!.rawFiles[0]).toEqual(before);
    expect(project.narcs.scripts!.dirty.size).toBe(0);
  });

  it("atomically patches script fields and an unambiguous WordSet companion", () => {
    const script = makeScriptFile(bytes(
      ...words(0x122, 0x8010, 25, 0, 5),
      ...words(0x57), 0, ...words(25),
    ));
    const project = makeProject({ scripts: [script], trades: [] });
    const group = scanGen5ScriptPokemon(project).groups[0]!;
    const species = group.entries[0]!.acquisitions[0]!.fields.find((field) => field.name === "species")!;
    const level = group.entries[0]!.acquisitions[0]!.fields.find((field) => field.name === "level")!;
    const result = applyGen5ScriptPokemonGroup(project, group.key, [
      { key: species.key, value: 133 },
      { key: level.key, value: 30 },
    ]);

    expect(result.fieldsChanged).toBe(2);
    expect(readU16(project.narcs.scripts!.rawFiles[0]!, species.source!.offset)).toBe(133);
    expect(readU16(project.narcs.scripts!.rawFiles[0]!, level.source!.offset)).toBe(30);
    expect(readU16(project.narcs.scripts!.rawFiles[0]!, 8 + 10 + 3)).toBe(133);
    expect(project.narcs.scripts!.dirty.has(0)).toBe(true);
    expect(project.narcs.ingame_trades!.dirty.size).toBe(0);
    expect(project.actionChangelog?.entries).toHaveLength(2);
  });

  it("links trade commands, exposes all 27 fields, and patches the whole record", () => {
    const script = makeScriptFile(bytes(
      ...words(0x1b4, 0, 1),
      ...words(0x57), 0, ...words(25),
      ...words(0x57), 0, ...words(133),
    ));
    const trade = makeTrade(25, 133);
    const project = makeProject({ scripts: [script], trades: [trade, makeTrade(4, 7)] });
    const scan = scanGen5ScriptPokemon(project);
    const group = scan.groups.find((candidate) => candidate.key === "script:0")!;
    const acquisition = group.entries[0]!.acquisitions.find((candidate) => candidate.kind === "trade")!;
    expect(acquisition.fields).toHaveLength(27);
    expect(acquisition.fields.find((field) => field.name === "abilityChoice")?.options?.[2]?.label).toBe("Hidden ability");
    expect(acquisition.fields.find((field) => field.name === "requestedGender")?.options?.[2]?.label).toBe("Any gender");
    expect(acquisition.fields.find((field) => field.name === "worldCode")?.options?.map((option) => option.value)).toEqual([1, 2, 3, 4, 5, 7, 8]);
    expect(acquisition.fields.find((field) => field.name === "rawMetadata")).toMatchObject({ label: "Sheen", min: 0, max: 255, advanced: false });
    expect(scan.groups.find((candidate) => candidate.key === "unmapped-trades")?.acquisitionCount).toBe(1);

    const edits = acquisition.fields.map((field, index) => ({
      key: field.key,
      value: field.name === "givenSpeciesId" ? 150
        : field.name === "requestedSpeciesId" ? 151
          : Math.min(field.max, Math.max(field.min, index + 1)),
    }));
    const result = applyGen5ScriptPokemonGroup(project, group.key, edits);

    const patched = project.narcs.ingame_trades!.rawFiles[0]!;
    expect(result.tradesChanged).toEqual([0]);
    expect(GEN5_INGAME_TRADE_FIELDS.every((spec, index) => {
      const expected = edits[index]!.value;
      return readU32(patched, spec.offset) === expected;
    })).toBe(true);
    expect(readU16(project.narcs.scripts!.rawFiles[0]!, 8 + 6 + 3)).toBe(150);
    expect(readU16(project.narcs.scripts!.rawFiles[0]!, 8 + 6 + 5 + 3)).toBe(151);
    expect(project.narcs.ingame_trades!.records.size).toBe(0);
  });

  it("validates a whole trade draft before committing any field", () => {
    const project = makeProject({
      scripts: [makeScriptFile(bytes(...words(0x1b4, 0, 1)))],
      trades: [makeTrade(25, 133)],
    });
    const group = scanGen5ScriptPokemon(project).groups.find((candidate) => candidate.key === "script:0")!;
    const fields = group.entries[0]!.acquisitions[0]!.fields;
    const species = fields.find((field) => field.name === "givenSpeciesId")!;
    const level = fields.find((field) => field.name === "level")!;
    const before = new Uint8Array(project.narcs.ingame_trades!.rawFiles[0]!);

    expect(() => applyGen5ScriptPokemonGroup(project, group.key, [
      { key: species.key, value: 150 },
      { key: level.key, value: 101 },
    ])).toThrow(/Level must be between 1 and 100/);
    expect(project.narcs.ingame_trades!.rawFiles[0]).toEqual(before);
    expect(project.narcs.ingame_trades!.dirty.size).toBe(0);
  });

  it("keeps gifts visible when the optional trade archive is absent", () => {
    const project = makeProject({ scripts: [makeScriptFile(bytes(...words(0x122, 0x8010, 25, 0, 5), ...words(0x1b4, 0, 1)))], trades: undefined });
    const scan = scanGen5ScriptPokemon(project);
    const acquisitions = scan.groups[0]!.entries.flatMap((entry) => entry.acquisitions);
    expect(acquisitions.some((acquisition) => acquisition.kind === "box_gift")).toBe(true);
    expect(acquisitions.find((acquisition) => acquisition.kind === "trade")?.tradeRecordMissing).toBe(true);
    expect(scan.diagnostics.some((diagnostic) => diagnostic.message.includes("In-game Trades is not loaded"))).toBe(true);
  });

  it("does not duplicate level-five starter selection gifts", () => {
    const project = makeProject({ scripts: [makeScriptFile(bytes(
      ...words(0x10c, 0x8010, 495, 0, 5),
      ...words(0x10c, 0x8010, 498, 0, 5),
      ...words(0x10c, 0x8010, 501, 0, 5),
      ...words(0x122, 0x8010, 25, 0, 10),
    ))], trades: [] });
    const scan = scanGen5ScriptPokemon(project);
    const acquisitions = scan.groups.flatMap((group) => group.entries).flatMap((entry) => entry.acquisitions);
    expect(acquisitions.map((acquisition) => acquisition.kind)).toEqual(["box_gift"]);
    expect(scan.diagnostics.filter((diagnostic) => diagnostic.message.includes("managed by the starter editor"))).toHaveLength(1);
  });
});

function makeProject(options: { scripts: Uint8Array[]; trades: Uint8Array[] | undefined }): ProjectState {
  return {
    session: { romName: "script-test", generation: "gen5", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "IRDO", fileName: "test.nds", size: 1 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      personal: makeStore("personal", Array.from({ length: 700 }, () => new Uint8Array(76))),
      scripts: makeStore("scripts", options.scripts),
      ...(options.trades === undefined ? {} : { ingame_trades: makeStore("ingame_trades", options.trades) }),
    },
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}

function makeTrade(given: number, requested: number): Uint8Array {
  const out = new Uint8Array(0x6c);
  writeU32(out, 0x04, given);
  writeU32(out, 0x0c, 5);
  writeU32(out, 0x5c, requested);
  return out;
}

function makeStore(name: NarcName, rawFiles: Uint8Array[]): NarcStore {
  return { name, sourcePath: "test", fileId: 1, fileCount: rawFiles.length, rawFiles, records: new Map(), dirty: new Set() };
}

function makeScriptFile(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  writeU32(out, 0, 4);
  writeU16(out, 4, 0xfd13);
  out.set(body, 8);
  return out;
}

function makeMultiEntryScript(first: Uint8Array, second: Uint8Array): Uint8Array {
  const firstStart = 12;
  const secondStart = firstStart + first.length;
  const out = new Uint8Array(secondStart + second.length);
  writeU32(out, 0, firstStart - 4);
  writeU32(out, 4, secondStart - 8);
  writeU16(out, 8, 0xfd13);
  out.set(first, firstStart);
  out.set(second, secondStart);
  return out;
}

function words(...values: number[]): number[] {
  return values.flatMap((value) => [value & 0xff, (value >>> 8) & 0xff]);
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}
