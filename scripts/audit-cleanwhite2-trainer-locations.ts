import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { enrichTrainerLocations } from "../src/pokeweb/docGeneratorModel";
import { indirectTrainerContext } from "../src/pokeweb/trainerLocationModel";
import { getTrainerRecord } from "../src/pokeweb/trainerModel";

const romPath = resolve(process.argv[2] ?? "../cleanwhite2.nds");
const outputPath = process.argv[3] ? resolve(process.argv[3]) : undefined;
const bytes = new Uint8Array(await readFile(romPath));
const project = await loadProjectFromRomBytes(bytes, basename(romPath), {
  selectedNarcs: ["scripts", "overworlds", "trdata", "trpok"],
});
const result = enrichTrainerLocations(project);
const context = indirectTrainerContext(project);
const rows = Array.from({ length: project.narcs.trdata?.fileCount ?? 0 }, (_, id) => {
  const trainer = getTrainerRecord(project, id, { includeTexts: false });
  return {
    id,
    name: trainer.readable.name,
    class: trainer.readable.class,
    locations: project.docs?.trainerLocations[String(id)] ?? [],
    sources: project.docs?.trainerLocationSources?.[String(id)] ?? [],
  };
});
const report = {
  result,
  totals: {
    trainers: rows.length,
    resolved: rows.filter((row) => row.locations.length > 0).length,
    unresolved: rows.filter((row) => row.id > 0 && row.locations.length === 0).length,
  },
  runtime: {
    globals: context.field?.globals.length ?? 0,
    zoneOverlays: Object.keys(context.field?.zoneOverlays ?? {}).length,
    wheel: context.field?.wheel ?? [],
    wheelScriptFileIds: context.field?.wheelScriptFileIds ?? [],
    dungeon: context.dungeon,
    funfest: context.funfest,
    overlayMaps: Object.entries(context.field?.zoneOverlays ?? {}).map(([zone, overlay]) => {
      const row = project.headers?.rows[Number(zone) + 1];
      return {
        zone: Number(zone),
        overlay,
        location: row?.location_name,
        scriptId: row?.script_id,
        overworldId: row?.overworlds_id ?? row?.map_id,
      };
    }),
  },
  unresolved: rows.filter((row) => row.id > 0 && row.locations.length === 0),
  rows,
};
const json = JSON.stringify(report, null, 2);
if (outputPath) await writeFile(outputPath, json);
console.log(json);
