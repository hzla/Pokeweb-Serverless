import { describe, expect, it } from "vitest";
import { readU16, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { compileStudioChunk, compileStudioPermissions } from "../pokeweb/mapStudioCompiler";
import { compileStudioBuildings, previewStudioBuildings, readStudioBuildingSource } from "../pokeweb/mapStudioBuildings";
import { convertStudioGen4Permission, readStudioBdhc, readStudioGen4Buildings } from "../pokeweb/mapStudioGen4";
import { saveStudioWorkspace, openStudioWorkspace, studioPerName } from "../pokeweb/mapStudioFormats";
import { buildModelPrimitives, readNitroResources } from "../pokeweb/map3dModel";
import { distances } from "../pokeweb/mapStudioHeightTables";
import { studioFixture } from "./fixtures/mapStudio";
import { mapModel, mapTextures } from "./fixtures/gen5MapImport";

function heights(two = false) {
  const bytes = new Uint8Array(two ? 80 : 56); bytes.set(new TextEncoder().encode("BDHC"));
  writeU16(bytes, 4, 2); writeU16(bytes, 6, 1); writeU16(bytes, 8, two ? 2 : 1); writeU16(bytes, 10, two ? 2 : 1);
  for (const [i, n] of [-16, -16, 16, 16].entries()) writeU32(bytes, 16 + i * 4, n * 65536 >>> 0);
  writeU32(bytes, 36, 4096); writeU32(bytes, 44, -2 * 65536 >>> 0);
  const at = two ? 52 : 48; writeU16(bytes, at + 2, 1);
  if (two) { writeU16(bytes, at + 10, 1); writeU16(bytes, at + 14, 1); }
  return bytes;
}
function fixture(two = false) {
  const ws = studioFixture(); ws.map.game = 3;
  const path = studioPerName(ws, ws.map.chunks[0]); ws.files[path] = new Uint8Array(2048); ws.files[path.replace(/per$/u, "bdhc")] = heights(two);
  ws.files[path][0] = 2; ws.files[path][1] = 0x84; ws.files[path][2] = 16;
  return ws;
}
function buildingFixture() {
  const ws = fixture(), path = studioPerName(ws, ws.map.chunks[0]).replace(/per$/u, "bld"), bld = new Uint8Array(48);
  [-3.5, 2, 4].forEach((n, i) => writeU32(bld, 4 + i * 4, n * 65536 >>> 0)); [28, 32, 36].forEach(at => writeU32(bld, at, 4096)); ws.files[path] = bld;
  const header = new Uint8Array(0x4000); header.set(new TextEncoder().encode("IPKE"), 12); const rom = new NintendoDSRom(header); rom.arm9 = new Uint8Array(64);
  const narc = (files: Uint8Array[]) => { const n = new NARC(); n.files = files; return n.save(); }, area = new Uint8Array(8); area[6] = 1;
  const bytes = rom.save({ addedFiles: [{ path: "a/0/4/2", bytes: narc([area]) }, { path: "a/0/4/0", bytes: narc([mapModel()]) }, { path: "a/1/4/8", bytes: narc([]) }, { path: "a/0/7/0", bytes: narc([mapTextures()]) }] });
  return { ws, bytes, path };
}
describe("Gen 4 Overworld conversion", () => {
  it.each(["BW", "BW2"] as const)("converts collision semantics and authoritative BDHC heights for %s", game => {
    const ws = fixture(), result = compileStudioPermissions(ws, ws.map.chunks[0], -1, game);
    expect(readU16(result, 8)).toBe(4); expect(readU16(result, 10)).toBe(0x25);
    expect(readU16(result, 16)).toBe(61); expect(readU16(result, 18) & 2).toBe(2);
    expect(distances[game === "BW" ? 0 : 1][readU16(result, 6)]).toBeCloseTo(2, 2);
    expect(convertStudioGen4Permission(56, 0)).toMatchObject({ tileClass: 114, flags: 0x100 });
    expect(convertStudioGen4Permission(105, 128)).toMatchObject({ flags: 1, unsupported: 105 });
  });
  it("validates BDHC bounds and signed fractional coordinates rather than truncating heights", () => {
    const b = heights(); writeU32(b, 16, -15.5 * 65536 >>> 0); writeU32(b, 44, -2.5 * 65536 >>> 0);
    expect(readStudioBdhc(b)[0]).toMatchObject({ x0: -15.5, c: 2.5 });
    expect(() => readStudioBdhc(b.slice(0, 32))).toThrow(/Truncated/); writeU16(b, 48, 2); expect(() => readStudioBdhc(b)).toThrow(/missing/);
  });
  it("exports overlapping upper and lower walking surfaces into separate PER members", () => {
    const ws = fixture(true), result = compileStudioChunk(ws, 0, -1, "BW2"); expect(result.secondaryPermissions).toBeDefined();
    expect(distances[1][readU16(result.permissions, 6)]).toBeCloseTo(2, 2); expect(distances[1][readU16(result.secondaryPermissions!, 6)]).toBeCloseTo(0, 2);
  });
  it("requires actual building resources, extracts only referenced models and retains them in saved bundles", () => {
    const { ws, bytes } = buildingFixture(); expect(() => compileStudioBuildings(ws, ws.map.chunks[0])).toThrow(/source ROM/);
    const files = readStudioBuildingSource(ws, bytes); expect(Object.keys(files)).toHaveLength(2); Object.assign(ws.files, files);
    const reopened = openStudioWorkspace({ "saved.zip": saveStudioWorkspace(ws) }); expect(reopened.files["mapstudio-buildings/0/0.nsbmd"]).toEqual(mapModel());
    const input = compileStudioBuildings(reopened, reopened.map.chunks[0])!;
    expect(input.placements).toEqual([{ asset: 0, x: -56, y: 32, z: -64, rotationY: 0 }]);
    const resources = readNitroResources(input.assets[0].model), textures = readNitroResources(input.assets[0].textures); resources.textures.push(...textures.textures); resources.palettes.push(...textures.palettes);
    expect(buildModelPrimitives(resources, [])[0].material.texture).toBeDefined();
    expect(previewStudioBuildings(ws, ws.map.chunks[0])[0].positions[0]).toBeCloseTo(-3.5);
  });
  it("preserves Gen 4 scale, rejects truncated placements and invalid source ROMs", () => {
    const { ws, bytes, path } = buildingFixture(); Object.assign(ws.files, readStudioBuildingSource(ws, bytes));
    writeU32(ws.files[path], 28, 8192); expect(readStudioGen4Buildings(ws.files[path])[0].scale[0]).toBe(2);
    expect(compileStudioBuildings(ws, ws.map.chunks[0])!.assets).toHaveLength(1);
    expect(() => readStudioGen4Buildings(new Uint8Array(47))).toThrow(/Truncated/);
    expect(() => readStudioBuildingSource(ws, new Uint8Array(512))).toThrow(/source ROM/);
  });
});
