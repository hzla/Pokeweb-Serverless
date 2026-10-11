import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { translateWhite2 } from "../src/pokeweb/translationModel";

const [sourcePath, donorPath, outputFolder] = process.argv.slice(2);
if (!outputFolder) throw new Error("Usage: verify-white2-donor-transplant.ts US.nds ITALIAN.nds OUTPUT_FOLDER");
const source = new Uint8Array(await readFile(sourcePath)), original = new NintendoDSRom(new Uint8Array(await readFile(donorPath)), { fileData: "view" });
const replacements = new Map<number, Uint8Array>();
for (const [path, member, byte, value] of [["a/0/1/6", 25, 0, 55], ["a/0/2/1", 33, 3, 70]] as const) {
  const archive = new NARC(original.getFileByName(path)); archive.files[member][byte] = value;
  replacements.set(original.fileId(path), archive.save());
}
const donorBytes = original.save({ files: replacements });
await writeFile(join(outputFolder, "edited-italian-donor.nds"), donorBytes, { flag: "wx" });
const result = await translateWhite2(source, donorBytes);
assert.equal(result.report.donorKind, "edited"); assert.equal(result.report.importedHackMembers, 2); assert.equal(result.report.skippedDonorEdits, 0);
const output = new NintendoDSRom(result.bytes, { fileData: "view" });
assert.equal(new NARC(output.getFileByName("a/0/1/6")).files[25][0], 55);
assert.equal(new NARC(output.getFileByName("a/0/2/1")).files[33][3], 70);
for (const [path, member, field] of [["a/0/1/6", 25, "base_hp"], ["a/0/2/1", 33, "power"]] as const) {
  const record = result.report.records.find(item => item.scope === "member" && item.path === path && item.member === member);
  assert(record?.change === "hack" && record.action === "imported"); assert(record.fields?.some(item => item.field === field));
}
await writeFile(join(outputFolder, "edited-italian-transplant.nds"), result.bytes, { flag: "wx" });
await writeFile(join(outputFolder, "edited-italian-transplant.json"), JSON.stringify(result.report, null, 2) + "\n", { flag: "wx" });
console.log("Edited Italian donor accepted; Pikachu HP=55 and Tackle power=70 transplanted and logged; US code verified.");
