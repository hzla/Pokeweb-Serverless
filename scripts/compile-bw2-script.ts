import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileBw2Script } from "../src/pokeweb/bw2ScriptCompiler";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[1] !== "--out") throw new Error("Usage: npm run scripts:bw2-compile -- source.bws --out script.bin");
  const sourcePath = resolve(args[0]);
  const outputPath = resolve(args[2]);
  const source = await readFile(sourcePath, "utf8");
  const result = compileBw2Script(source);
  // Exclusive creation protects existing binaries and prevents input overwrites.
  await writeFile(outputPath, result.bytes, { flag: "wx" });
  console.log(`Compiled ${result.entries.length} entries and ${result.helpers.length} helpers into ${result.bytes.length} bytes: ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
