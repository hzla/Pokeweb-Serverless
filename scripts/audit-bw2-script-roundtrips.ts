import { readFile } from "node:fs/promises";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { compileBw2Script, decompileBw2Script } from "../src/pokeweb/bw2ScriptCompiler";
import { gen5ScriptEntries } from "../src/pokeweb/gen5ScriptCommands";

async function main(): Promise<void> {
  if (process.argv.length !== 3) throw new Error("Usage: npm run scripts:bw2-audit -- path/to/bw2.nds");
  const rom = new NintendoDSRom(await readFile(process.argv[2]), { fileData: "view" });
  if (!/^IR[DE][A-Z]$/.test(rom.idCode)) throw new Error("Expected a Black 2 or White 2 ROM.");
  const files = new NARC(rom.getFileByName("a/0/5/6")).files;
  const report = { romCode: rom.idCode, members: files.length, emptyOrUnrecognizedTables: 0, verifiedRoundTrips: 0, editable: 0, readOnly: 0, recoveredBlocks: 0, verifiedCodeGrowth: 0, failures: [] as { fileId: number; error: string }[] };
  for (const [fileId, bytes] of files.entries()) {
    if (!gen5ScriptEntries(bytes).length) { report.emptyOrUnrecognizedTables++; continue; }
    try {
      const result = decompileBw2Script(bytes);
      report.verifiedRoundTrips++; report.recoveredBlocks += result.stats.structuredBlocks;
      if (!result.editable) { report.readOnly++; continue; }
      report.editable++;
      // Exercise entry, branch, helper, and data relocation without saving a ROM.
      const edited = result.source.replace(/^(script :\w+, entry: \d+ do)\n/m, "$1\n  nop\n");
      if (edited === result.source) throw new Error("Editable member has no decoded public entry");
      const compiled = compileBw2Script(edited);
      if (compiled.bytes.length !== bytes.length + 2 || !decompileBw2Script(compiled.bytes).editable) throw new Error("Code-growth relocation verification failed");
      report.verifiedCodeGrowth++;
    } catch (error) { report.failures.push({ fileId, error: error instanceof Error ? error.message : String(error) }); }
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.failures.length) process.exitCode = 1;
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
