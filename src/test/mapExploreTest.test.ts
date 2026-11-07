import { describe,expect,it } from "vitest";
import { bottomLeftMapTestTile } from "../pokeweb/mapExploreTest";
import { createMapTestWalkRuntime,mapTestProfile } from "../pokeweb/mapTestRuntime";
import { parseRpm } from "../pokeweb/rpm";
import { gen5ImportProject,mapBin,mapPermissions } from "./fixtures/gen5MapImport";
import { parseVMapTerrain } from "../pokeweb/map3dModel";
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
