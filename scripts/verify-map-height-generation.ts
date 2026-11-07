// Read-only comparison against native ROM walking heights. No ROMs or saves are written.
import { readFile, writeFile } from "node:fs/promises";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { readGen5MapBin } from "../src/pokeweb/gen5MapImportFormats";
import { buildModelPrimitives, readNitroResources } from "../src/pokeweb/map3dModel";
import { generateGen5MapHeights } from "../src/pokeweb/gen5MapHeightGeneration";
const path = process.argv[2], output = process.argv[3];
if (!path) throw new Error("Pass a local Gen 5 ROM and optional external JSON output path.");
const rom = new NintendoDSRom(new Uint8Array(await readFile(path)), { fileData: "view" });
const game = /^IR[AB]/u.test(rom.idCode) ? "BW" : /^IR[DE]/u.test(rom.idCode) ? "BW2" : undefined;
if (!game) throw new Error("Choose a Black/White or Black 2/White 2 ROM.");
const maps = new NARC(rom.getFileByName("a/0/0/8")).files, rows: object[] = [];
let equivalent = 0, applicable = 0, errors = 0, samples = 0, matching = 0;
for (let map = 0; map < maps.length; map++) {
  try {
    const parsed = readGen5MapBin(maps[map]), warnings: string[] = [], meshes = buildModelPrimitives(readNitroResources(parsed.files[0]), warnings);
    const r = generateGen5MapHeights(meshes, parsed.files[1], parsed.placements === 3 ? parsed.files[2] : undefined, game);
    if (r.equivalent) equivalent++; if (r.canApply) applicable++; samples += r.samples; matching += r.matchingSamples;
    rows.push({ map, equivalent: r.equivalent, applicable: r.canApply, walkable: r.walkable, plates: r.plates.length, missing: r.missing.length, unsupported: r.unsupported.length, extraSurfaces: r.extraSurfaces.length, changedTiles: r.changedTiles.length, samples: r.samples, matchingSamples: r.matchingSamples, maxDifference: Number.isFinite(r.maxDifference) ? r.maxDifference : null, warnings });
  } catch (error) { errors++; rows.push({ map, error: error instanceof Error ? error.message : String(error) }); }
}
const summary = { game, maps: maps.length, equivalent, applicable, errors, samples, matchingSamples: matching };
if (output) await writeFile(output, JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary));
