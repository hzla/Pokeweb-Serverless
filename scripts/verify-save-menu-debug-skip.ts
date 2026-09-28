import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { installSaveMenu } from "../src/pokeweb/saveMenuModel";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Usage: vite-node scripts/verify-save-menu-debug-skip.ts input.nds");
const source = new Uint8Array(await readFile(inputPath));
const rom = new NintendoDSRom(source, { fileData: "view" });
const skipPath = "patches/MainMenuSkip(1).dll";
const originalSkip = rom.getFileByName(skipPath).slice();
const project = await loadProjectFromRomBytes(source, basename(inputPath), { selectedNarcs: [] });
await assert.rejects(installSaveMenu(project), /bypass the save menu/u);
assert.deepEqual(new NintendoDSRom(source, { fileData: "view" }).getFileByName(skipPath), originalSkip);
assert(!project.fileSystem?.additions?.["patches/SaveMenuW2.dll"]);
console.log("Active Main Menu Skip was refused without modifying the ROM or staging the save menu.");
