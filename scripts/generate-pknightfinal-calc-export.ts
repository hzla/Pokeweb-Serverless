import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";
import { generateCalcDownload } from "../src/pokeweb/docGeneratorModel";

const romPath = process.argv[2] ?? process.env.PKNIGHTFINAL_ROM;
const outputPath = process.argv[3] ?? process.env.PKNIGHTFINAL_CALC_OUTPUT;
if (!romPath || !outputPath) {
  throw new Error("Usage: vite-node scripts/generate-pknightfinal-calc-export.ts <rom.nds> <output.json>");
}

const project = await loadProjectFromRomFile(new File([new Uint8Array(await readFile(romPath))], path.basename(romPath)), {
  selectedNarcs: ["personal", "learnsets", "moves", "items", "trdata", "trpok", "headers", "overworlds", "scripts"],
});

const calcFile = generateCalcDownload(project, "pknightfinal");
const payload = JSON.parse(calcFile.contents.replace(/^backup_data = /u, "").replace(/;\n$/u, ""));
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(payload));
console.log(`Wrote ${outputPath}`);
console.log(`Pokemon: ${Object.keys(payload.poks || {}).length}`);
console.log(`Moves: ${Object.keys(payload.moves || {}).length}`);
console.log(`Trainer species buckets: ${Object.keys(payload.formatted_sets || {}).length}`);
