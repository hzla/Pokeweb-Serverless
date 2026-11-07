// Local-only disposable test build. Source ROMs, project state and user saves are not written.
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { loadMap3dZone } from "../src/pokeweb/map3dModel";
import { bottomLeftMapTestTile, buildMapExploreTestDownloads } from "../src/pokeweb/mapExploreTest";
import { getTestBattleConfigForProject, loadTestBattleSave, rawSaveBytesFromDesmumeDsv } from "../src/pokeweb/testBattle";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { gen5ScriptEntries } from "../src/pokeweb/gen5ScriptCommands";
import { readU16 } from "../src/nds/binary";
import { createMapTestWalkRuntime, mapTestProfile } from "../src/pokeweb/mapTestRuntime";
import { generateGen5MapHeights } from "../src/pokeweb/gen5MapHeightGeneration";
import { readGen5MapBin } from "../src/pokeweb/gen5MapImportFormats";
import { prepareMapHeightEdit, applyMapHeightEdit } from "../src/pokeweb/mapHeightEdit";
const [input,output,zoneArg] = process.argv.slice(2);
if (!input || !output) throw new Error("Pass a local US Gen 5 ROM, new external output prefix and optional zone ID.");
globalThis.fetch = (async request => {
  const url = request instanceof URL ? request : new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error("Only local bundled assets are expected.");
  return new Response(new Uint8Array(await fs.readFile(url)));
}) as typeof fetch;
const project = await loadProjectFromRomBytes(new Uint8Array(await fs.readFile(input)),"map-test.nds",{selectedNarcs:["headers","maps"]});
const profile = mapTestProfile(project), save = await loadTestBattleSave(getTestBattleConfigForProject(project));
const scene = await loadMap3dZone(project,zoneArg ? Number(zoneArg) : project.session.baseRom === "BW2" ? 427 : save.zoneId,{season:"spring"});
const heightChecks: object[] = [];
if (process.argv.includes("--generate-heights")) for (const chunk of scene.chunks) {
  const source = project.narcs.maps!.rawFiles[chunk.chunkId], parsed = readGen5MapBin(source);
  const result = generateGen5MapHeights(chunk.primitives,parsed.files[1],parsed.placements===3?parsed.files[2]:undefined,project.session.baseRom as "BW"|"BW2");
  if (!result.equivalent) throw new Error(`Map ${chunk.chunkId} does not reproduce the current walking heights.`);
  applyMapHeightEdit(project,prepareMapHeightEdit(chunk.chunkId,source,result));
  heightChecks.push({map:chunk.chunkId,samples:result.samples,matchingSamples:result.matchingSamples,maxDifference:result.maxDifference});
}
const destination = bottomLeftMapTestTile(project,scene), hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const state = () => JSON.stringify([project.fileSystem,project.codeInjection,Object.values(project.narcs).map(s=>s&&[...s.dirty]),project.actionChangelog]);
const before = state(), result = await buildMapExploreTestDownloads(project,destination);
if (state() !== before) throw new Error("The game test changed the source project.");
if (hash(rawSaveBytesFromDesmumeDsv(result.saveBytes)) !== hash(save.rawSaveBytes)) throw new Error("The launch save differs from the bundled save.");
const rom = new NintendoDSRom(result.romBytes,{fileData:"view"}), scripts = new NARC(rom.getFileByName(project.session.baseRom === "BW" ? "a/0/5/7" : "a/0/5/6")).files[result.trigger.scriptId], entries = gen5ScriptEntries(scripts);
const body = scripts.subarray(entries[result.trigger.entryId-1]), at = body.findIndex((n,i)=>n===0xc2&&body[i+1]===0);
if (at < 0 || JSON.stringify([0,1,2].map(i=>readU16(body,at+2+i*2))) !== JSON.stringify([destination.zoneId,destination.tileX,destination.tileZ])) throw new Error("The exported warp destination differs.");
const runtime = createMapTestWalkRuntime(profile.version);
await fs.writeFile(output+".nds",result.romBytes,{flag:"wx"}); await fs.writeFile(output+".sav",rawSaveBytesFromDesmumeDsv(result.saveBytes),{flag:"wx"}); await fs.writeFile(output+".dll",runtime,{flag:"wx"});
const report = { game:profile.version,destination,trigger:result.trigger,projectUnchanged:true,saveUnchanged:true,temporaryWalkThroughWalls:true,heightChecks,romSha256:hash(result.romBytes) };
await fs.writeFile(output+".json",JSON.stringify(report,null,2),{flag:"wx"}); console.log(JSON.stringify(report));
