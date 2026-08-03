import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { buildBattleModelScene } from "../pokeweb/battleModelScene";
import { BATTLE_PLATFORM_RECORD_BYTES, parseBattlePlatformVariants } from "../pokeweb/battlePlatformModel";

function nitro(stamp: string): Uint8Array {
  return new Uint8Array([...stamp].map((character) => character.charCodeAt(0)));
}

function stageRecord(): Uint8Array {
  const record = new Uint8Array(BATTLE_PLATFORM_RECORD_BYTES);
  record.fill(0xff);
  return record;
}

function writeResource(record: Uint8Array, resourceRow: number, season: number, value: number): void {
  writeU32(record, 4 + (resourceRow * 4 + season) * 4, value);
}

describe("battle platform catalog", () => {
  it("parses complete 68-byte records, edge color, and animation resources", () => {
    const table = stageRecord();
    writeU16(table, 0, 0x421f);
    writeResource(table, 0, 0, (5 << 16) | 4);
    writeResource(table, 1, 0, (7 << 16) | 6);
    writeResource(table, 2, 0, (9 << 16) | 8);
    writeResource(table, 3, 0, (11 << 16) | 10);
    const graphics = Array.from({ length: 12 }, () => nitro("XXXX"));
    graphics[4] = nitro("BMD0");
    graphics[5] = nitro("BMD0");
    graphics[6] = nitro("BCA0");
    graphics[7] = nitro("BCA0");
    graphics[8] = nitro("BTA0");
    graphics[9] = nitro("BTA0");
    graphics[10] = nitro("BMA0");
    graphics[11] = nitro("BMA0");

    expect(parseBattlePlatformVariants(table, graphics, "IRDO")).toEqual([
      {
        tableIndex: 0,
        seasonIndex: 0,
        seasonName: "Spring",
        resourceId: 5,
        nsbcaResourceId: 7,
        nsbtaResourceId: 9,
        nsbmaResourceId: 11,
        edgeColor: 0x421f,
        variantCount: 1,
        modelFallback: false,
      },
    ]);
  });

  it("chooses the low half of paired platform and animation IDs for Black 2", () => {
    const table = stageRecord();
    writeResource(table, 0, 0, (5 << 16) | 4);
    writeResource(table, 1, 0, (7 << 16) | 6);
    const graphics = Array.from({ length: 8 }, () => nitro("XXXX"));
    graphics[4] = nitro("BMD0");
    graphics[5] = nitro("BMD0");
    graphics[6] = nitro("BCA0");
    graphics[7] = nitro("BCA0");

    expect(parseBattlePlatformVariants(table, graphics, "IREO")).toEqual([
      expect.objectContaining({ resourceId: 4, nsbcaResourceId: 6 }),
    ]);
  });

  it("falls back to Spring for seasonal animation-only slots and deduplicates repeated model variants", () => {
    const table = stageRecord();
    writeResource(table, 0, 0, 0);
    writeResource(table, 0, 2, 0);
    writeResource(table, 1, 3, 1);
    const graphics = [nitro("BMD0"), nitro("BCA0")];

    expect(parseBattlePlatformVariants(table, graphics, "IRDO")).toEqual([
      {
        tableIndex: 0,
        seasonIndex: 0,
        seasonName: "Spring",
        resourceId: 0,
        nsbcaResourceId: undefined,
        nsbtaResourceId: undefined,
        nsbmaResourceId: undefined,
        edgeColor: 0xffff,
        variantCount: 2,
        modelFallback: false,
      },
      {
        tableIndex: 0,
        seasonIndex: 3,
        seasonName: "Winter",
        resourceId: 0,
        nsbcaResourceId: 1,
        nsbtaResourceId: undefined,
        nsbmaResourceId: undefined,
        edgeColor: 0xffff,
        variantCount: 2,
        modelFallback: true,
      },
    ]);
  });

  it("rejects data that does not contain one complete stage record", () => {
    expect(parseBattlePlatformVariants(new Uint8Array(BATTLE_PLATFORM_RECORD_BYTES - 1), [nitro("BMD0")], "IRDO")).toEqual([]);
  });

  it("keeps complete stage records when the table has a trailing partial record", () => {
    const table = new Uint8Array(BATTLE_PLATFORM_RECORD_BYTES + 5);
    table.fill(0xff);
    writeResource(table, 0, 0, 0);

    expect(parseBattlePlatformVariants(table, [nitro("BMD0")], "IRDO")).toEqual([
      expect.objectContaining({ tableIndex: 0, resourceId: 0 }),
    ]);
  });

  it("keeps decoded platform texture, palette, and material-binding metadata in the scene", () => {
    const texture = {
      index: 2,
      name: "batt_stage_floor",
      width: 32,
      height: 16,
      format: 3,
      byteLength: 256,
      image: { name: "batt_stage_floor", width: 32, height: 16, rgba: new Uint8Array(32 * 16 * 4) },
      palettes: [{ index: 1, name: "stage_palette" }],
      bindings: [{ modelIndex: 0, materialIndex: 3, materialName: "stage_material", paletteName: "stage_palette" }],
    };
    const primitive = {
      material: { name: "stage_material", diffuse: [1, 1, 1] as [number, number, number], alpha: 1 },
      positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 1, 3]),
      indices: new Uint16Array([0, 1, 2]),
    };

    const scene = buildBattleModelScene(42, [primitive], [texture], [texture.name]);

    expect(scene).toEqual(expect.objectContaining({ resourceId: 42, primitiveCount: 1, triangleCount: 1, textureCount: 1 }));
    expect(scene.bounds).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 1, maxZ: 3 });
    expect(scene.textures[0]).toEqual(expect.objectContaining({ name: "batt_stage_floor", palettes: texture.palettes, bindings: texture.bindings }));
  });
});
