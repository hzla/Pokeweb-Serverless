import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { translateGen5Rom } from "../src/pokeweb/translationModel";

const [sourcePath, donorPath, outputPath, reportPath] = process.argv.slice(2);
if (!reportPath) throw new Error("Usage: build-white2-italian-translation.ts US.nds FOREIGN.nds OUTPUT.nds REPORT.json");
assert.equal(new Set([sourcePath, donorPath, outputPath, reportPath].map(path => resolve(path))).size, 4, "Use separate output files.");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const [sourceBytes, donorBytes] = await Promise.all([sourcePath, donorPath].map(async path => new Uint8Array(await readFile(path))));
const result = await translateGen5Rom(sourceBytes, donorBytes, undefined, message => { console.log(message); });
const source = new NintendoDSRom(sourceBytes, { fileData: "view" }), output = new NintendoDSRom(result.bytes, { fileData: "view" });
const executableHashes = Object.fromEntries((["arm9", "arm7", "arm9OverlayTable", "arm7OverlayTable", "fntData", "banner"] as const).map(key => {
  assert.equal(sha(source[key]), sha(output[key]), key);
  return [key, sha(output[key])];
}));
await writeFile(outputPath, result.bytes, { flag: "wx" });
await writeFile(reportPath, JSON.stringify({ ...result.report, outputSha256: sha(result.bytes), executableHashes }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ outputPath, outputBytes: result.bytes.length, language: result.report.language, replacedFiles: result.report.replacedFiles, replacedMembers: result.report.replacedMembers, importedHackMembers: result.report.importedHackMembers, skippedDonorEdits: result.report.skippedDonorEdits, outputSha256: sha(result.bytes) }));
