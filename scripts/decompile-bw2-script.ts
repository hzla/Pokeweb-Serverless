import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decompileBw2Script } from "../src/pokeweb/bw2ScriptCompiler";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if ((args.length !== 3 && args.length !== 5) || args[1] !== "--out" || (args.length === 5 && args[3] !== "--overlay")) throw new Error("Usage: npm run scripts:bw2-decompile -- script.bin --out source.bws [--overlay ID]");
  const result = decompileBw2Script(await readFile(resolve(args[0])), { overlayId: args.length === 5 ? Number(args[4]) : undefined });
  await writeFile(resolve(args[2]), result.source, { flag: "wx" });
  console.log(`Byte-identical round trip verified: ${result.stats.entries} entries, ${result.stats.structuredBlocks} recovered blocks; ${result.editable ? "editable" : "read-only"}.`);
  for (const warning of result.warnings) console.warn(warning);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
