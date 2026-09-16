import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeU16, writeU32 } from "../nds/binary";
import { packGameFreakContainer, readNitroModelNames } from "../pokeweb/map3dModel";
import { buildingLibraryScene, indexBuildingBundles, loadBuildingLibrary } from "../pokeweb/buildingLibraryModel";
import type { ProjectState } from "../pokeweb/projectStore";

function namedModel(name: string) {
  const bytes = new Uint8Array(80);
  bytes.set(new TextEncoder().encode("BMD0"));
  writeU16(bytes, 14, 1); writeU32(bytes, 16, 20);
  bytes.set(new TextEncoder().encode("MDL0"), 20);
  bytes[29] = 1; writeU16(bytes, 44, 4); writeU32(bytes, 48, 64);
  bytes.set(new TextEncoder().encode(name), 52);
  return bytes;
}

describe("building library index", () => {
  it("lists each bundle variant and reads UIDs little-endian without decoding geometry", () => {
    const metadata = Uint8Array.of(2, 1);
    const first = packGameFreakContainer("AB", [metadata, namedModel("town_house")]);
    const second = packGameFreakContainer("AB", [metadata, namedModel("snow_house")]);
    const warnings: string[] = [];
    const entries = indexBuildingBundles("exterior", [first, second], warnings);
    expect(entries.map((entry) => [entry.id, entry.uid, entry.name])).toEqual([
      ["exterior:0:0", 258, "town_house"], ["exterior:1:0", 258, "snow_house"],
    ]);
    expect(indexBuildingBundles("interior", [first])[0].id).toBe("interior:0:0");
    expect(warnings).toEqual([]);
  });

  it("reports malformed bundles while continuing to index valid resources", () => {
    const warnings: string[] = [];
    const entries = indexBuildingBundles("interior", [Uint8Array.of(1),
      packGameFreakContainer("AB", [Uint8Array.of(1, 0), namedModel("desk")]),
      packGameFreakContainer("AB", [Uint8Array.of(1, 0)]),
    ], warnings);
    expect(entries.map((entry) => entry.name)).toEqual(["desk"]);
    expect(warnings).toHaveLength(2);
    expect(readNitroModelNames(Uint8Array.of(1))).toEqual([]);
  });
});

const romPath = resolve(process.cwd(), "../cleanwhite2.nds");
describe.skipIf(!existsSync(romPath))("local BW2 building library", () => {
  it("indexes both archives and decodes exterior and interior models with their own textures", async () => {
    const project = { session: { baseRom: "BW2" }, originalRomBytes: new Uint8Array(readFileSync(romPath)) } as ProjectState;
    const library = await loadBuildingLibrary(project);
    expect(library.entries.length).toBeGreaterThan(100);
    expect(await loadBuildingLibrary(project)).toBe(library);
    for (const [kind, bundleId, uid] of [["exterior", 52, 1], ["interior", 66, 2]] as const) {
      const entry = library.entries.find((entry) => entry.kind === kind && entry.bundleId === bundleId && entry.uid === uid)!;
      expect(entry).toBeDefined();
      const asset = library.load(entry.id);
      expect(asset.primitives.length).toBeGreaterThan(0);
      expect(asset.primitives.some((p) => p.material.texture)).toBe(true);
      expect(asset.primitives.every((p) => p.positions.every(Number.isFinite))).toBe(true);
      expect(buildingLibraryScene(asset).buildings[0].primitives).toBe(asset.primitives);
      expect(buildingLibraryScene(asset).chunks).toEqual([]);
    }
  });
});
