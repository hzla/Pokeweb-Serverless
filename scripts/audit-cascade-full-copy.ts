import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Folder } from "../src/nds/fnt";
import { NintendoDSRom } from "../src/nds/rom";
import { parseRpm } from "../src/pokeweb/rpm";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Pass a ROM or directory path.");
const enumerate = (folder: Folder, parent = ""): Array<{ id: number; path: string }> => [
  ...folder.files.map((name, index) => ({ id: folder.firstId + index, path: parent ? `${parent}/${name}` : name })),
  ...folder.folders.flatMap(([name, child]) => enumerate(child, parent ? `${parent}/${name}` : name)),
];
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const walk = async (directory: string): Promise<string[]> => {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (entry.isFile() && path.toLowerCase().endsWith(".dll")) result.push(path);
  }
  return result;
};
const inputIsDirectory = (await stat(inputPath)).isDirectory();
const candidates: Array<{ fileId?: number; path: string; bytes: Uint8Array }> = [];
if (inputIsDirectory) {
  for (const path of await walk(inputPath)) candidates.push({ path: relative(inputPath, path), bytes: new Uint8Array(await readFile(path)) });
} else {
  const rom = new NintendoDSRom(new Uint8Array(await readFile(inputPath)));
  for (const file of enumerate(rom.filenames).filter(({ path }) => path.toLowerCase().endsWith(".dll"))) {
    candidates.push({ fileId: file.id, path: file.path, bytes: rom.files[file.id]! });
  }
}
const records = [];
for (const file of candidates) {
  const bytes = file.bytes;
  try {
    const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    for (const relocation of rpm.relocations) {
      if (relocation.target.type !== "FULL_COPY") continue;
      const symbol = rpm.symbols[relocation.sourceSymbolIndex];
      if (!symbol || (symbol.size % 2 === 0 && relocation.target.address % 2 === 0)) continue;
      records.push({
        fileId: file.fileId,
        path: file.path,
        hash: sha256(bytes),
        priority: rpm.metadata.PMCModulePriority,
        targetModule: relocation.target.module,
        targetAddress: `0x${relocation.target.address.toString(16)}`,
        symbolName: symbol.name,
        size: symbol.size,
        sourceAddress: `0x${symbol.address.toString(16)}`,
        data: Array.from(rpm.code.slice(symbol.address, symbol.address + symbol.size)),
        sourceWindow: Array.from(rpm.code.slice(Math.max(0, symbol.address - 4), Math.min(rpm.code.length, symbol.address + 12))),
      });
    }
  } catch {
    // Ignore non-RPM DLLs.
  }
}
console.log(JSON.stringify(records, null, 2));
