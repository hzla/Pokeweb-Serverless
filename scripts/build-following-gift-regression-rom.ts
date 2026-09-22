import { copyFile, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { installFollowerAlpha, writeFollowerItemRules } from "../src/pokeweb/followingPokemonProject";

const [input, output, save] = process.argv.slice(2);
if (!input || !output || !save) throw new Error("Expected input ROM, output ROM, and source save paths.");
globalThis.fetch = (async (value: RequestInfo | URL) => {
  const url = new URL(value instanceof Request ? value.url : String(value));
  if (url.protocol !== "file:") throw new Error(`Expected local asset ${url}`);
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;

const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(input)), basename(input), { selectedNarcs: [] });
await installFollowerAlpha(project);
await writeFollowerItemRules(project, [{
  slot: 0,
  itemId: 1,
  quantity: 1,
  itemName: "Master Ball",
  text: "{nickname} found a {item}!",
  zone: 427,
  species: 151,
}]);
project.narcs = {};
const outputPath = resolve(output);
await writeFile(outputPath, await exportModifiedRom(project));
await copyFile(resolve(save), outputPath.replace(/\.nds$/i, ".sav"));
console.log(`Gift regression ROM: ${outputPath}`);
