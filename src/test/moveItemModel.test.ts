import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { EFFECTS, getMoveAutofills, getItemRecord, getMoveRecord, moveMatchesSearch, updateItemField, updateItemPackedField, updateMoveEffectId, updateMoveField } from "../pokeweb/moveItemModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("moveItemModel", () => {
  it("derives move readable fields including effects, hits, signed magnitudes, and props", () => {
    const project = makeProject();
    const move = getMoveRecord(project, 1);

    expect(move.readable.name).toBe("Tackle");
    expect(move.readable.type).toBe("Normal");
    expect(move.readable.category).toBe("Physical");
    expect(move.readable.effect).toBe("Standard damage (no special AI effect)");
    expect(move.readable.min_hits).toBe(1);
    expect(move.readable.max_hits).toBe(3);
    expect(move.readable.magnitude_1).toBe(-1);
    expect(move.readable.contact).toBe(1);
  });

  it("updates move text fields, numeric fields, hits, and property packing", () => {
    const project = makeProject();

    updateMoveField(project, 1, "type", "Fire");
    updateMoveField(project, 1, "category", "Special");
    updateMoveField(project, 1, "power", "90");
    updateMoveField(project, 1, "min_hits", "2");
    updateMoveField(project, 1, "max_hits", "5");
    updateMoveField(project, 1, "magnitude_1", "-2");
    updateMoveField(project, 1, "sound_move", true);

    const move = getMoveRecord(project, 1);
    expect(move.raw.type).toBe(9);
    expect(move.raw.category).toBe(2);
    expect(move.raw.power).toBe(90);
    expect(move.readable.power).toBe(90);
    expect(move.raw.hits).toBe(0x52);
    expect(move.raw.magnitude_1).toBe(254);
    expect(move.readable.sound_move).toBe(1);
    expect(project.narcs.moves?.dirty.has(1)).toBe(true);
    expect(moveMatchesSearch(move, "tackle", new Set(["special"]), new Set(["fire"]))).toBe(true);
    expect(project.actionChangelog?.entries.some((entry) => entry.domain === "moves" && entry.text.includes("Tackle power changed from 40 to 90."))).toBe(true);
  });

  it("updates move effects by raw effect id", () => {
    const project = makeProject();

    const result = updateMoveEffectId(project, 1, "4");

    const move = getMoveRecord(project, 1);
    expect(result).toEqual({ value: "Damage; may burn the target", rawValue: 4 });
    expect(move.raw.effect).toBe(4);
    expect(move.readable.effect).toBe("Damage; may burn the target");
    expect(project.narcs.moves?.dirty.has(1)).toBe(true);
    expect(() => updateMoveEffectId(project, 1, "-1")).toThrow(/between 0 and/u);
  });

  it("keeps every AI effect description unique under the selector's case-insensitive lookup", () => {
    expect(EFFECTS).toHaveLength(338);
    expect(EFFECTS.every((label) => label.length > 0 && label === label.trim())).toBe(true);
    expect(new Set(EFFECTS.map((label) => label.toLowerCase())).size).toBe(338);
    expect(EFFECTS.some((label) => /^(?:\d+|unknown)$/iu.test(label))).toBe(false);
  });

  it("round-trips all AI IDs through the editable description without changing move behavior fields", () => {
    const project = makeProject();
    const { effect: _initialEffect, ...originalBehavior } = getMoveRecord(project, 1).raw;
    const choices = getMoveAutofills(project).effects;

    for (let id = 0; id < 338; id += 1) {
      updateMoveEffectId(project, 1, String(id));
      const label = String(getMoveRecord(project, 1).readable.effect);
      expect(choices[id]).toBe(label);
      // Start from another ID so this exercises selection rather than a no-op.
      updateMoveEffectId(project, 1, String((id + 1) % 338));
      const selected = updateMoveField(project, 1, "effect", ` ${label.toUpperCase()} `);
      expect(selected.rawValue, `AI description for ID ${id}`).toBe(id);
      const { effect, ...behavior } = getMoveRecord(project, 1).raw;
      expect(effect).toBe(id);
      expect(behavior).toEqual(originalBehavior);
    }
  });

  // IDs and distinguishing behavior checked against swan_export/waza.tab and
  // hand_waza.c. These catch shifted rows and the previous misleading labels.
  it.each([
    [18, /Lower the target's Attack by 1 stage/u],
    [68, /Damage; may lower the target's Attack by 1 stage/u],
    [86, /Disable:.*4 turns/u],
    [90, /Encore:.*3 turns/u],
    [175, /Taunt:.*3 turns/u],
    [199, /Teeter Dance:.*including allies/u],
    [201, /Mud Sport:.*1\/3/u],
    [210, /Water Sport:.*1\/3/u],
    [216, /Miracle Eye:.*Psychic.*Dark/u],
    [217, /Wake-Up Slap:.*sleeping.*wake/u],
    [223, /Feint: damage through Protect\/Detect/u],
    [225, /Tailwind:.*4 turns/u],
    [237, /Wring Out \/ Crush Grip:.*1 to 120/u],
    [262, /Volt Tackle:.*paralyze.*1\/3/u],
    [268, /Judgment \/ Techno Blast:.*Plate \/ Drive/u],
    [271, /Seed Flare:.*may lower.*Sp\. Def by 2/u],
    [282, /special damage using the target's Defense instead of Sp\. Def/u],
    [296, /Acid Spray: damage; lower the target's Sp\. Def by 2/u],
    [300, /After You:.*immediately after the user this turn/u],
    [320, /Final Gambit:.*the user faints/u],
    [329, /Relic Song:.*Meloetta/u],
    [330, /Glaciate:.*Speed by 1/u],
    [333, /Unused AI slot 333/u],
    [337, /Hurricane:.*confuse.*rain.*sun/u],
  ])("describes source AI ID %i accurately", (id, description) => {
    expect(EFFECTS[id]).toMatch(description);
  });

  it("identifies all unassigned vanilla AI slots without claiming they are new effects", () => {
    // All 559 move assignments in swan_export's source table and compiled NARC
    // agree on these gaps; defined legacy stat/healing AI routines still exist.
    const unassignedIds = [12, 13, 14, 15, 21, 22, 55, 56, 61, 63, 64, 74, 96, 110, 131, 133, 134, 141, 157, 163, 264, 333];
    expect(EFFECTS.flatMap((label, id) => /unused/iu.test(label) ? [id] : [])).toEqual(unassignedIds);
  });

  it("updates item numeric fields and rejects out-of-range values", () => {
    const project = makeProject();

    updateItemField(project, 1, "market_value", "500");
    updateItemField(project, 1, "item_type", "12");

    const item = getItemRecord(project, 1);
    expect(item.readable.name).toBe("Potion");
    expect(item.raw.market_value).toBe(500);
    expect(item.raw.item_type).toBe(12);
    expect(project.narcs.items?.dirty.has(1)).toBe(true);
    expect(project.actionChangelog?.entries.some((entry) => entry.domain === "items" && entry.text.includes("Potion market value changed from 300 to 500."))).toBe(true);
    expect(() => updateItemField(project, 1, "market_value", "70000")).toThrow(/between 0 and 65535/u);
  });

  it("updates packed item flag fields without changing neighboring bits", () => {
    const project = makeProject();

    updateItemPackedField(project, 1, "status_removal_flag", "poison", true);
    updateItemPackedField(project, 1, "status_removal_flag", "freeze", true);
    updateItemPackedField(project, 1, "type_attribute", "important_item", true);
    updateItemPackedField(project, 1, "type_attribute", "field_pocket", "7");
    updateItemPackedField(project, 1, "pp_flags", "sp_def_ev", true);
    updateItemPackedField(project, 1, "pp_flags", "friendship_high", true);

    const item = getItemRecord(project, 1);
    expect(item.raw.status_removal_flag).toBe(0b00001010);
    expect(item.raw.type_attribute).toBe((7 << 7) | (1 << 5));
    expect(item.raw.pp_flags).toBe((1 << 8) | (1 << 12));
    expect(() => updateItemPackedField(project, 1, "type_attribute", "field_pocket", "16")).toThrow(/between 0 and 15/u);
  });
});

function makeProject(): ProjectState {
  const formats = getNarcFormats("BW2");
  const moves = packRows(formats.moves!, [
    {},
    { type: 0, category: 1, power: 40, accuracy: 100, pp: 35, effect: 0, result_effect: 0, status: 0, target: 0, stat_1: 1, magnitude_1: 255, hits: 0x31, properties: 1 },
  ]);
  const items = packRows(formats.items!, [{}, { market_value: 300, item_type: 1 }]);

  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { moves: 1, items: 2 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: moves.length },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      moves: makeStore("moves", moves, 2),
      items: makeStore("items", items, 2),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: {
      banks: {
        moves: ["None", "Tackle"],
        items: ["None", "Potion"],
      },
    },
    formats,
    trpokInfo: [],
  };
}

function makeStore(name: NarcName, data: Uint8Array, count: number): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: count,
    rawFiles: splitRows(data, count),
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

function splitRows(data: Uint8Array, count: number): Uint8Array[] {
  const size = Math.floor(data.length / count);
  return Array.from({ length: count }, (_, index) => data.slice(index * size, (index + 1) * size));
}

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  for (let i = 0; i < size; i += 1) out[offset + i] = Math.floor(value / 2 ** (8 * i)) & 0xff;
}
