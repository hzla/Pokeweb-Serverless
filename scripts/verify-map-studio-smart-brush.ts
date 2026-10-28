import { readFileSync } from "node:fs";
import { attachStudioTileset, openStudioTilesetPack } from "../src/pokeweb/mapStudioTilesets";
import { openStudioWorkspace, saveStudioWorkspace, studioAssert } from "../src/pokeweb/mapStudioFormats";
import { StudioHistory } from "../src/pokeweb/mapStudioModel";
import { paintStudioSmart, studioSmartBrushIssue } from "../src/pokeweb/mapStudioSmartBrush";
import { compileStudioModel } from "../src/pokeweb/mapStudioCompiler";
import { validateMapNitro } from "../src/pokeweb/gen5MapImportFormats";

studioAssert(process.argv.length > 2, "Usage: vite-node scripts/verify-map-studio-smart-brush.ts <tileset.zip> [...tileset.zip]");
for (const [index,path] of process.argv.slice(2).entries()) {
  const pack = openStudioTilesetPack({ "pack.zip": new Uint8Array(readFileSync(path)) });
  const { workspace: ws } = attachStudioTileset(undefined,pack,`pack-${index}`);
  const eligible = ws.layouts!.filter(g => !studioSmartBrushIssue(ws,g));
  const unavailable: Record<string, number> = {}; for (const g of ws.layouts!) { const issue = studioSmartBrushIssue(ws,g); if (issue) unavailable[issue] = (unavailable[issue] || 0) + 1; }
  const samples = [/sand.?path/iu,/lake.?water/iu,/cliff/iu].map(pattern => eligible.find(g => pattern.test(g.name) && g.extras?.every(id => id >= 0))).filter((g): g is NonNullable<typeof g> => !!g);
  studioAssert(eligible.length > 0 && samples.length > 0, "The supplied pack has no compatible terrain brush examples.");
  const results: unknown[] = [];
  for (const layout of new Set(samples)) {
    ws.map.chunks[0].tiles.forEach(grid => grid.fill(-1)); ws.map.chunks[0].heights.forEach(grid => grid.fill(0)); if (ws.smart) ws.smart.cells = Object.create(null);
    const history = new StudioHistory(ws);
    for (let x = 4; x < 10; x++) paintStudioSmart(history,layout,0,0,x,4,0);
    for (let y = 5; y < 9; y++) paintStudioSmart(history,layout,0,0,9,y,0);
    for (let y = 12; y < 17; y++) for (let x = 12; x < 17; x++) paintStudioSmart(history,layout,0,0,x,y,0);
    history.finish(); paintStudioSmart(history,layout,0,0,14,14,0,true); history.finish();
    const model = compileStudioModel(ws,ws.map.chunks[0]); validateMapNitro(model.model,"BMD0"); validateMapNitro(model.textures,"BTX0");
    const reopened = openStudioWorkspace({ "saved.zip": saveStudioWorkspace(ws) });
    studioAssert(JSON.stringify(reopened.map) === JSON.stringify(ws.map) && JSON.stringify(reopened.smart) === JSON.stringify(ws.smart), "Smart brush save/reopen changed terrain or brush ownership.");
    history.undo(); studioAssert(ws.map.chunks[0].tiles[0][14*32+14] >= 0,"Undo failed to restore the erased cell."); history.redo(); studioAssert(ws.map.chunks[0].tiles[0][14*32+14] === -1,"Redo failed to restore the hole.");
    results.push({ layout: layout.name, nativeModel: true, narrowBend: true, erasedHole: true, undoRedo: true, saveReopen: true });
  }
  console.log(JSON.stringify({ pack: pack.name, compatibleLayouts: eligible.length, totalLayouts: ws.layouts!.length, unavailable, examples: results }));
}
