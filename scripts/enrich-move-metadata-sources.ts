import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildMoveMetadataEntries } from "../src/pokeweb/docGeneratorModel";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";
import { enrichMoveMetadataSource } from "../src/pokeweb/moveMetadataSourceEnrichment";

const args = parseArgs(process.argv.slice(2));
if (!args.rom || args.sources.length === 0) {
  throw new Error(
    "Usage: npm run moves:enrich-sources -- --rom <rom.nds> --source <calc-or-ddex.js> [--source <other.js>] [--check] [--allow-missing]",
  );
}

const romPath = path.resolve(args.rom);
const project = await loadProjectFromRomFile(
  new File([new Uint8Array(await readFile(romPath))], path.basename(romPath)),
  { selectedNarcs: ["moves"] },
);
const metadataEntries = buildMoveMetadataEntries(project);
const metadata = Object.fromEntries(metadataEntries.map((entry) => [entry.name, entry.metadata]));
const moveNumbers = Object.fromEntries(metadataEntries.map((entry) => [entry.name, entry.id - 1]));
const outputs = await Promise.all(
  args.sources.map(async (sourceArgument) => {
    const sourcePath = path.resolve(sourceArgument);
    const original = await readFile(sourcePath, "utf8");
    return { sourcePath, original, result: enrichMoveMetadataSource(original, metadata, moveNumbers) };
  }),
);

const unmatched = new Set(outputs.flatMap(({ result }) => result.unmatchedMoves));
if (unmatched.size > 0 && !args.allowMissing) {
  throw new Error(`Moves with ROM metadata were not found in every source: ${Array.from(unmatched).join(", ")}`);
}

const changed = outputs.filter(({ original, result }) => original !== result.source);
if (!args.check) {
  await Promise.all(changed.map(({ sourcePath, result }) => writeFile(sourcePath, result.source)));
}

console.log(`ROM: ${romPath}`);
console.log(`SHA-256: ${project.romInfo.sourceSha256}`);
console.log(`Moves with non-zero metadata: ${Object.keys(metadata).length}`);
for (const { sourcePath, result } of outputs) {
  console.log(
    `${args.check ? "Checked" : "Updated"} ${sourcePath}: ${result.modifiedMoves.length} changed, ` +
      `${result.unchangedMoves.length} already current, ${result.unmatchedMoves.length} unmatched`,
  );
  if (result.unmatchedMoves.length > 0) console.log(`  Unmatched: ${result.unmatchedMoves.join(", ")}`);
}

if (args.check && changed.length > 0) process.exitCode = 1;

function parseArgs(values: string[]): {
  rom?: string;
  sources: string[];
  check: boolean;
  allowMissing: boolean;
} {
  const parsed: { rom?: string; sources: string[]; check: boolean; allowMissing: boolean } = {
    sources: [],
    check: false,
    allowMissing: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--rom") parsed.rom = requiredValue(values, ++index, value);
    else if (value === "--source") parsed.sources.push(requiredValue(values, ++index, value));
    else if (value === "--check") parsed.check = true;
    else if (value === "--allow-missing") parsed.allowMissing = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return parsed;
}

function requiredValue(values: string[], index: number, option: string): string {
  const value = values[index];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}
