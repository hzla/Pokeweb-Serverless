import { describe, expect, it } from "vitest";
import {
  extractGameFreakContainer,
  buildModelPrimitives,
  packGameFreakContainer,
  parseAreaHeader,
  parseMapMatrix,
  parseChunkBuildings,
  parseNitroRenderOpsForTest,
  parseMapReplaceTable,
  parseNpcRegistry,
  parseVMapTerrain,
  parseZoneEntities,
  updateMap3dAreaMetadata,
  writeAreaHeader,
} from "../pokeweb/map3dModel";
import { writeU16, writeU32 } from "../nds/binary";
import type { ProjectState } from "../pokeweb/projectStore";

describe("map3dModel", () => {
  it("extracts files from a Game Freak container", () => {
    const first = Uint8Array.of(1, 2, 3);
    const second = Uint8Array.of(4, 5);
    const container = makeGameFreakContainer("WB", [first, second]);

    const result = extractGameFreakContainer(container);

    expect(result.signature).toBe("WB");
    expect([...result.files[0]]).toEqual([...first]);
    expect([...result.files[1]]).toEqual([...second]);
  });

  it("packs Game Freak containers after replacing a file", () => {
    const container = makeGameFreakContainer("WB", [Uint8Array.of(1), Uint8Array.of(2, 3)]);
    const extracted = extractGameFreakContainer(container);
    extracted.files[1] = Uint8Array.of(9, 8, 7);

    const repacked = extractGameFreakContainer(packGameFreakContainer(extracted.signature, extracted.files));

    expect(repacked.signature).toBe("WB");
    expect([...repacked.files[0]]).toEqual([1]);
    expect([...repacked.files[1]]).toEqual([9, 8, 7]);
  });

  it("parses map matrices without zone filters", () => {
    const matrix = new Uint8Array(8 + 4 * 4);
    writeU32(matrix, 0, 0);
    writeU16(matrix, 4, 2);
    writeU16(matrix, 6, 2);
    [10, 11, 12, 13].forEach((value, index) => writeU32(matrix, 8 + index * 4, value));

    expect(parseMapMatrix(matrix)).toEqual({
      hasZones: false,
      width: 2,
      height: 2,
      chunkIds: [10, 11, 12, 13],
      zoneIds: [],
    });
  });

  it("parses map matrices with signed empty chunks and zone filters", () => {
    const matrix = new Uint8Array(8 + 4 * 3 + 4 * 3);
    writeU32(matrix, 0, 1);
    writeU16(matrix, 4, 3);
    writeU16(matrix, 6, 1);
    [7, 0xffffffff, 9].forEach((value, index) => writeU32(matrix, 8 + index * 4, value));
    [20, 21, 20].forEach((value, index) => writeU32(matrix, 20 + index * 4, value));

    expect(parseMapMatrix(matrix)).toEqual({
      hasZones: true,
      width: 3,
      height: 1,
      chunkIds: [7, -1, 9],
      zoneIds: [20, 21, 20],
    });
  });

  it("parses area texture ids", () => {
    const table = new Uint8Array(30);
    writeU16(table, 10, 5);
    writeU16(table, 12, 42);
    table[14] = 255;
    table[15] = 7;
    table[16] = 1;

    expect(parseAreaHeader(table, 1)).toEqual({
      buildingsId: 5,
      texturesId: 42,
      srtAnimeIdx: 255,
      patAnimeIdx: 7,
      isExterior: true,
    });
  });

  it("writes and stores edited area metadata", () => {
    const project = { map3dAreaEdits: undefined } as Partial<ProjectState> as ProjectState;
    const edited = updateMap3dAreaMetadata(
      project,
      2,
      { buildingsId: 1, texturesId: 2, srtAnimeIdx: 255, patAnimeIdx: 255, isExterior: true },
      { buildingsId: 18, texturesId: 74, srtAnimeIdx: 4, patAnimeIdx: 5, isExterior: false },
    );
    const table = new Uint8Array(30);
    writeAreaHeader(table, 20, edited);

    expect(project.map3dAreaEdits?.["2"]).toEqual({
      buildingsId: 18,
      texturesId: 74,
      srtAnimeIdx: 4,
      patAnimeIdx: 5,
      isExterior: false,
    });
    expect(parseAreaHeader(table, 2)).toEqual(project.map3dAreaEdits?.["2"]);
  });

  it("parses Gen V terrain collision permissions", () => {
    const bytes = new Uint8Array(4 + 2 * 8);
    writeU16(bytes, 0, 2);
    writeU16(bytes, 2, 1);
    writeU16(bytes, 4, (7 << 2) | 2);
    writeU16(bytes, 6, 33);
    writeU16(bytes, 8, 120);
    writeU16(bytes, 10, 0x8000);
    writeU16(bytes, 12, 1);
    writeU16(bytes, 14, 0);
    writeU16(bytes, 16, 7);
    writeU16(bytes, 18, 0x0020);

    expect(parseVMapTerrain(bytes, 99)).toEqual({
      chunkId: 99,
      width: 2,
      height: 1,
      tiles: [
        { heightType: 2, slope: 7, height: 33, tileClass: 120, flags: 0x8000 },
        { heightType: 1, slope: 0, height: 0, tileClass: 7, flags: 0x0020 },
      ],
    });
  });

  it("parses seasonal map replacement entries", () => {
    const table = new Uint8Array(0x10);
    writeU16(table, 0, 12);
    table[2] = 1;
    table[3] = 0;
    [12, 13, 14, 15, 16].forEach((value, index) => writeU16(table, 4 + index * 2, value));

    expect(parseMapReplaceTable(table)).toEqual([
      {
        matrixId: 12,
        typeIsMatrix: true,
        condition: 0,
        replacements: [12, 13, 14, 15, 16],
      },
    ]);
  });

  it("parses grid-based entity overlays", () => {
    const bytes = new Uint8Array(8 + 0x24 + 0x14 + 0x16);
    writeU32(bytes, 0, bytes.length - 4);
    bytes[5] = 1;
    bytes[6] = 1;
    bytes[7] = 1;
    let offset = 8;
    writeU16(bytes, offset, 9);
    writeU16(bytes, offset + 10, 200);
    writeU16(bytes, offset + 20, 1);
    writeU16(bytes, offset + 22, 2);
    writeU32(bytes, offset + 24, 0);
    writeU16(bytes, offset + 28, 3);
    writeU16(bytes, offset + 30, 4);
    writeU32(bytes, offset + 32, 32 * 4096);
    offset += 0x24;
    writeU16(bytes, offset, 20);
    writeU16(bytes, offset + 2, 1);
    writeU16(bytes, offset + 6, 0);
    writeU16(bytes, offset + 8, 48);
    writeU16(bytes, offset + 10, 0);
    writeU16(bytes, offset + 12, 64);
    writeU16(bytes, offset + 14, 2);
    writeU16(bytes, offset + 16, 1);
    offset += 0x14;
    writeU16(bytes, offset, 77);
    writeU16(bytes, offset + 10, 5);
    writeU16(bytes, offset + 12, 6);
    writeU16(bytes, offset + 14, 3);
    writeU16(bytes, offset + 16, 2);
    writeU16(bytes, offset + 18, 8);

    expect(parseZoneEntities(bytes)).toEqual([
      expect.objectContaining({ kind: "npc", id: 9, label: "NPC 9 / Obj 0 / Script 200", x: 56, y: 32, z: 72, width: 16, depth: 32, centered: true }),
      expect.objectContaining({ kind: "warp", id: 0, label: "Warp 0 -> Zone 20 #1", x: 40, z: 56, width: 32, depth: 16, centered: false }),
      expect.objectContaining({ kind: "trigger", id: 0, label: "Trigger 0 / Script 77", x: 80, y: 8, z: 96, width: 48, depth: 32, centered: false }),
    ]);
  });

  it("parses NPC model registry entries", () => {
    const bytes = new Uint8Array(4 + 0x1c);
    writeU32(bytes, 0, 1);
    writeU16(bytes, 4, 25);
    bytes[11] = 2;
    bytes[13] = 4;
    bytes[15] = 2;
    bytes[16] = 3;
    bytes[17] = 0xfe;
    bytes[18] = 5;
    bytes[19] = 0xfc;
    writeU16(bytes, 20, 100);
    writeU16(bytes, 22, 101);

    expect(parseNpcRegistry(bytes)[0]).toEqual({
      uid: 25,
      billboardSize: 2,
      spriteControllerType: 4,
      width: 2,
      height: 3,
      wPosOffX: -2,
      wPosOffY: 5,
      wPosOffZ: -4,
      resourceIndices: [100, 101, 0, 0, 0],
    });
  });

  it("parses Gen V building placement model ids as big-endian", () => {
    const bytes = new Uint8Array(4 + 16);
    writeU32(bytes, 0, 1);
    writeU32(bytes, 4, fx32(2));
    writeU32(bytes, 8, fx32(3));
    writeU32(bytes, 12, fx32(-1));
    writeU16(bytes, 16, 0xc000);
    bytes[18] = 0x01;
    bytes[19] = 0x46;

    expect(parseChunkBuildings(bytes, [], 12)).toEqual([
      {
        x: 2,
        y: 3,
        z: -1,
        rotationY: 270,
        modelUid: 326,
      },
    ]);
  });

  it("keeps Nitro model geometry after DSPRE building matrix commands", () => {
    const commands = makeGpuCommands([
      { opcodes: [0x40, 0x17, 0x22, 0x23], params: [0, ...identity4x3(), 0, vtx16(0, 0), vtx16(0, 0)] },
      { opcodes: [0x23, 0x23, 0x41, 0], params: [vtx16(1, 0), vtx16(0, 0), vtx16(0, 1), vtx16(0, 0)] },
    ]);
    const warnings: string[] = [];

    const primitives = buildModelPrimitives(
      {
        textures: [],
        palettes: [],
        models: [
          {
            renderOps: [
              { kind: "bindMaterial", material: 0 },
              { kind: "draw", piece: 0 },
            ],
            pieces: [{ commands }],
            materials: [
              {
                name: "building_mat",
                width: 16,
                height: 16,
                diffuse: [1, 1, 1],
                alpha: 1,
                defaultVertexColor: false,
                repeatS: false,
                repeatT: false,
                flipS: false,
                flipT: false,
                textureTransformMode: 0,
                scaleS: 1,
                scaleT: 1,
                transS: 0,
                transT: 0,
              },
            ],
            objects: [],
            upScale: 1,
            downScale: 1,
          },
        ],
      } as never,
      warnings,
    );

    expect(warnings).not.toContain("Unsupported GPU opcode 0x17");
    expect(primitives[0]?.positions.length).toBe(9);
    expect([...Array.from(primitives[0]?.indices ?? [])]).toEqual([0, 1, 2]);
  });

  it("keeps render commands aligned after DSPRE EnvMap SBC commands", () => {
    const ops = parseNitroRenderOpsForTest(Uint8Array.of(0x04, 2, 0x0c, 7, 0x05, 3, 0x01));

    expect(ops).toEqual([
      { kind: "bindMaterial", material: 2 },
      { kind: "draw", piece: 3 },
    ]);
  });

  it("falls back to drawing polygons when NSBMD render ops produce no geometry", () => {
    const commands = makeGpuCommands([
      { opcodes: [0x40, 0x22, 0x23, 0x23], params: [0, 0, vtx16(0, 0), vtx16(0, 0), vtx16(1, 0), vtx16(0, 0)] },
      { opcodes: [0x23, 0x41, 0, 0], params: [vtx16(0, 1), vtx16(0, 0)] },
    ]);
    const warnings: string[] = [];

    const primitives = buildModelPrimitives(
      {
        textures: [],
        palettes: [],
        models: [
          {
            renderOps: [],
            pieces: [{ commands }],
            materials: [
              {
                name: "fallback_mat",
                width: 16,
                height: 16,
                diffuse: [1, 1, 1],
                alpha: 1,
                defaultVertexColor: false,
                repeatS: false,
                repeatT: false,
                flipS: false,
                flipT: false,
                textureTransformMode: 0,
                scaleS: 1,
                scaleT: 1,
                transS: 0,
                transT: 0,
              },
            ],
            objects: [],
            upScale: 1,
            downScale: 1,
          },
        ],
      } as never,
      warnings,
    );

    expect(warnings).toContain("Model render ops produced no geometry; drawing all polygons once.");
    expect(primitives[0]?.positions.length).toBe(9);
    expect([...Array.from(primitives[0]?.indices ?? [])]).toEqual([0, 1, 2]);
  });

  it("recovers polygon pieces that the NSBMD render op pass skips", () => {
    const firstCommands = makeGpuCommands([
      { opcodes: [0x40, 0x22, 0x23, 0x23], params: [0, 0, vtx16(0, 0), vtx16(0, 0), vtx16(1, 0), vtx16(0, 0)] },
      { opcodes: [0x23, 0x41, 0, 0], params: [vtx16(0, 1), vtx16(0, 0)] },
    ]);
    const skippedCommands = makeGpuCommands([
      { opcodes: [0x40, 0x22, 0x23, 0x23], params: [0, 0, vtx16(2, 0), vtx16(0, 0), vtx16(3, 0), vtx16(0, 0)] },
      { opcodes: [0x23, 0x41, 0, 0], params: [vtx16(2, 1), vtx16(0, 0)] },
    ]);
    const warnings: string[] = [];

    const primitives = buildModelPrimitives(
      {
        textures: [],
        palettes: [],
        models: [
          {
            renderOps: [
              { kind: "bindMaterial", material: 0 },
              { kind: "draw", piece: 0 },
            ],
            pieces: [{ commands: firstCommands }, { commands: skippedCommands }],
            materials: [makeTestMaterial("first_mat"), makeTestMaterial("skipped_mat")],
            objects: [],
            upScale: 1,
            downScale: 1,
          },
        ],
      } as never,
      warnings,
      { recoverSkippedPieces: true },
    );

    expect(warnings).toContain("Model render ops skipped 1 polygon piece; drawing unmatched pieces once.");
    expect(primitives).toHaveLength(2);
    expect(primitives[0]?.material.name).toBe("first_mat");
    expect(primitives[1]?.material.name).toBe("skipped_mat");
    expect(primitives[1]?.positions.length).toBe(9);
  });
});

function makeTestMaterial(name: string) {
  return {
    name,
    width: 16,
    height: 16,
    diffuse: [1, 1, 1],
    alpha: 1,
    defaultVertexColor: false,
    repeatS: false,
    repeatT: false,
    flipS: false,
    flipT: false,
    textureTransformMode: 0,
    scaleS: 1,
    scaleT: 1,
    transS: 0,
    transT: 0,
  };
}

function makeGpuCommands(groups: Array<{ opcodes: number[]; params: number[] }>): Uint8Array {
  const wordCount = groups.reduce((sum, group) => sum + 1 + group.params.length, 0);
  const out = new Uint8Array(wordCount * 4);
  let offset = 0;
  for (const group of groups) {
    const opcodes = [...group.opcodes, 0, 0, 0, 0].slice(0, 4);
    out[offset++] = opcodes[0] ?? 0;
    out[offset++] = opcodes[1] ?? 0;
    out[offset++] = opcodes[2] ?? 0;
    out[offset++] = opcodes[3] ?? 0;
    for (const param of group.params) {
      writeU32(out, offset, param);
      offset += 4;
    }
  }
  return out;
}

function identity4x3(): number[] {
  return [fx32(1), 0, 0, 0, fx32(1), 0, 0, 0, fx32(1), 0, 0, 0];
}

function fx32(value: number): number {
  return Math.round(value * 4096) >>> 0;
}

function vtx16(first: number, second: number): number {
  return (Math.round(first * 4096) & 0xffff) | ((Math.round(second * 4096) & 0xffff) << 16);
}

function makeGameFreakContainer(signature: string, files: Uint8Array[]): Uint8Array {
  const headerLength = 4 + (files.length + 1) * 4;
  const totalLength = headerLength + files.reduce((sum, file) => sum + file.length, 0);
  const out = new Uint8Array(totalLength);
  out[0] = signature.charCodeAt(0);
  out[1] = signature.charCodeAt(1);
  writeU16(out, 2, files.length);
  let offset = headerLength;
  files.forEach((file, index) => {
    writeU32(out, 4 + index * 4, offset);
    out.set(file, offset);
    offset += file.length;
  });
  writeU32(out, 4 + files.length * 4, offset);
  return out;
}
