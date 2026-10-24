import fs from "node:fs/promises";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { loadNativeCutsceneLibrary } from "../src/pokeweb/nativeCutsceneModel";
import { createAspertiaCutsceneClone } from "../src/pokeweb/nativeCutsceneClone";
import { buildNativeCutsceneTestDownloads } from "../src/pokeweb/nativeCutsceneTest";

const [input, output] = process.argv.slice(2);
if (!input || !output || !output.endsWith(".nds")) throw new Error("Usage: vite-node scripts/build-native-cutscene-test.ts INPUT.nds OUTPUT.nds");
globalThis.fetch = (async request => {
  const url = request instanceof URL ? request : new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error("Only bundled local runtime assets are expected.");
  return new Response(new Uint8Array(await fs.readFile(url)));
}) as typeof fetch;
const project = await loadProjectFromRomBytes(new Uint8Array(await fs.readFile(input)), "cutscene-test.nds", { selectedNarcs: ["headers"] });
const library = await loadNativeCutsceneLibrary(project);
if (!library.definitions.some(d => d.id === 27)) createAspertiaCutsceneClone(project, library);
const result = await buildNativeCutsceneTestDownloads(project), base = output.slice(0, -4);
await fs.writeFile(output, result.romBytes, { flag: "wx" });
await fs.writeFile(`${base}.sav`, result.saveBytes, { flag: "wx" });
await fs.writeFile(`${base}.trigger.json`, JSON.stringify(result.trigger, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, save: `${base}.sav`, ...result.trigger, instructions: "Load the matching save in melonDS, then walk one tile down to play sequence 27. Step off and back onto that tile to replay." }));
