import { describe,expect,it } from "vitest";
import { mapExploreDestinationPicker } from "../pokeweb/mapExploreDestination";
import { bottomLeftMapTestTile } from "../pokeweb/mapExploreTest";
import { createMapTestWalkRuntime,mapTestProfile } from "../pokeweb/mapTestRuntime";
import { parseRpm } from "../pokeweb/rpm";
import { gen5ImportProject,mapBin,mapPermissions } from "./fixtures/gen5MapImport";
import { loadMap3dZone, parseVMapTerrain } from "../pokeweb/map3dModel";
import { applyMatrixCellEdit, GEN5_MATRIX_EMPTY } from "../pokeweb/matrixModel";
import { setSeasonalAssignment } from "../pokeweb/seasonalMatrixModel";
import type { Map3dSceneData } from "../pokeweb/map3dModel";
describe("map exploration game test",()=>{
  it("chooses the bottom row then leftmost dry walkable tile across chunks",()=>{
    const project=gen5ImportProject(), permissions=parseVMapTerrain(mapPermissions());
    permissions.tiles.forEach(t=>t.flags=1); permissions.tiles[1000].flags=0;permissions.tiles[1001].flags=0;permissions.tiles[1002].flags=2;
    const chunks=[{chunkId:0,matrixX:1,matrixY:0,permissions},{chunkId:1,matrixX:0,matrixY:1,permissions}];
    const scene={zoneId:12,chunks} as Map3dSceneData;
    expect(bottomLeftMapTestTile(project,scene)).toMatchObject({zoneId:12,tileX:8,tileZ:63,facing:"up"});
    expect(()=>bottomLeftMapTestTile(project,{...scene,matrixCell:{}} as Map3dSceneData)).toThrow("Assign");
    permissions.tiles.forEach(t=>t.flags=1);expect(()=>bottomLeftMapTestTile(project,scene)).toThrow("walkable");
  });
  it("uses the opened header and the clicked matrix coordinate, including seasonal chunk replacements", async () => {
    const project = gen5ImportProject();
    setSeasonalAssignment(project, 0, "map", 1, [1, 7, 1, 1]);
    const scene = await loadMap3dZone(project, 0, { season: "summer" });
    expect(scene.chunks.find(chunk => chunk.matrixX === 1)?.chunkId).toBe(7);
    const pick = mapExploreDestinationPicker(project, scene);
    const selection = { matrixX: 1, matrixY: 0, tileX: 7, tileY: 19 };
    const matrices = project.narcs.matrix!.rawFiles.map(bytes => bytes.slice());
    const headers = project.narcs.headers!.rawFiles.map(bytes => bytes.slice());
    expect(pick(selection)).toMatchObject({ zoneId: 0, tileX: 39, tileZ: 19 });
    expect(() => pick({ ...selection, tileX: 32 })).toThrow("Select a tile");
    expect(() => pick({ ...selection, matrixX: 2 })).toThrow("Select a tile");
    expect(project.narcs.matrix!.rawFiles).toEqual(matrices);
    expect(project.narcs.headers!.rawFiles).toEqual(headers);
  });

  it("uses the in-game owner of a selected matrix cell", async () => {
    const project = gen5ImportProject();
    const scene = await loadMap3dZone(project, 0, { matrixCell: { matrixId: 0, x: 1, y: 1 } });
    const pick = mapExploreDestinationPicker(project, { ...scene, zoneId: 0 }); // Graphics-only fallback header.
    expect(pick({ matrixX: 1, matrixY: 1, tileX: 4, tileY: 5 })).toMatchObject({ zoneId: 2, tileX: 36, tileZ: 37 });
  });

  it("translates an unassigned preview to its unique in-game location and rejects ambiguous or missing routes", async () => {
    const project = gen5ImportProject();
    applyMatrixCellEdit(project, 0, [0], { mapId: 3, headerId: GEN5_MATRIX_EMPTY });
    const scene = await loadMap3dZone(project, 0, { matrixCell: { matrixId: 0, x: 0, y: 0 } });
    const selection = { matrixX: 0, matrixY: 0, tileX: 12, tileY: 11 };
    expect(mapExploreDestinationPicker(project, scene)(selection)).toMatchObject({ zoneId: 2, tileX: 44, tileZ: 43 });

    applyMatrixCellEdit(project, 0, [5], { mapId: 3 });
    expect(() => mapExploreDestinationPicker(project, scene)(selection)).toThrow("multiple in-game locations");

    applyMatrixCellEdit(project, 0, [4, 5], { mapId: 4 });
    expect(() => mapExploreDestinationPicker(project, scene)(selection)).toThrow("Assign this map to an in-game header");
  });

  it.each(["B","W","B2","W2"] as const)("builds an always-on, two-hook test-only runtime for %s",version=>{
    const rpm=parseRpm(createMapTestWalkRuntime(version),{allowedMagics:["DLXF"]});
    expect(rpm.metadata.PMCGameID).toBe(version);expect(rpm.bssSize).toBe(0);expect(rpm.relocations).toHaveLength(2);
    expect(rpm.code).toEqual(Uint8Array.from([0,32,6,176,248,189,0,191,0,32,56,189]));
    expect(rpm.relocations.every(r=>r.target.module===(["B","W"].includes(version)?"21":"36"))).toBe(true);
  });
  it("rejects mismatched game identity and unqualified ROM revisions",()=>{
    const project=gen5ImportProject();expect(mapTestProfile(project).version).toBe("W2");
    project.romInfo.idCode="IRDI";expect(()=>mapTestProfile(project)).toThrow("US revision");
    project.romInfo.idCode="IRDO";project.originalRomBytes![0x1e]=1;expect(()=>mapTestProfile(project)).toThrow("US revision");
  });
});
