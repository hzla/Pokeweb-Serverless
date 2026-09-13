import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { strict as assert } from "node:assert";
import { NintendoDSRom } from "../src/nds/rom";
import { readU32 } from "../src/nds/binary";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import type { Folder } from "../src/nds/fnt";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: vite-node scripts/verify-frost-export.ts input.nds new-output.nds");
const source = new Uint8Array(readFileSync(input));
const project = await loadProjectFromRomBytes(source, basename(input));
const normal = new NintendoDSRom(await exportModifiedRom(project));
const bytes = await exportModifiedRom(project, { frostCompatibility: true });
const frost = new NintendoDSRom(bytes);
assert.equal(frost.filenames.firstId, frost.arm9OverlayTable.length / 32);
assert.deepEqual(frost.arm9, normal.arm9);
const verify = (folder: Folder, prefix = ""): void => {
  for (const name of folder.files) assert.deepEqual(frost.getFileByName(prefix + name), normal.getFileByName(prefix + name), prefix + name);
  for (const [name, child] of folder.folders) verify(child, `${prefix}${name}/`);
};
verify(normal.filenames);
for (let offset = 0; offset < frost.arm9OverlayTable.length; offset += 32) {
  assert.equal(readU32(frost.arm9OverlayTable, offset + 24), offset / 32);
}
const reloaded = await loadProjectFromRomBytes(bytes, basename(output));
assert.equal(reloaded.codeInjection?.modules?.length, project.codeInjection?.modules?.length);
writeFileSync(output, bytes, { flag: "wx" });
console.log(`Verified all named files, ARM9 and overlay mappings; reloaded ${reloaded.codeInjection?.modules?.length ?? 0} DLLs. Exported ${output}`);
