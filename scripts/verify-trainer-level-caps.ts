import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import profiles from "../src/assets/codeinjection/trainerLevelCapsManifest.json";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { getLevelCapsStatus, installLevelCaps } from "../src/pokeweb/levelCapsModel";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { createProjectDocument, readProjectDocument } from "../src/pokeweb/projectDocument";
import { addTrainer } from "../src/pokeweb/trainerModel";
import {
  getTrainerLevelCap, getTrainerLevelCapsStatus, installTrainerLevelCaps, updateTrainerLevelCap,
  readTrainerLevelCapTable, TRAINER_LEVEL_CAPS_PATH,
} from "../src/pokeweb/trainerLevelCapsModel";
import { renderTrainerLevelCapSetting } from "../src/ui/trainerLevelCaps";

const paths = process.argv.slice(2);
if (!paths.length) throw new Error("Usage: npm run trainercaps:verify-rom -- <clean US ROM.nds> [...]");
const originalFetch = globalThis.fetch;
globalThis.fetch = (async input => {
  const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
  if (url.protocol !== "file:") throw new Error("This verification only loads local bundled assets.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;

try {
  for (const path of paths) {
    const source = new Uint8Array(await readFile(path));
    const project = await loadProjectFromRomBytes(source, basename(path), { selectedNarcs: ["trdata", "trpok"] });
    const game = project.session.baseVersion;
    assert(Object.hasOwn(profiles, game));
    const overlay = profiles[game as keyof typeof profiles].overlay;
    const trainerId = 2;
    assert(getTrainerLevelCapsStatus(project).supported);
    assert(!getTrainerLevelCapsStatus(project).compatible);
    assert.equal(renderTrainerLevelCapSetting(project, trainerId), "");
    await assert.rejects(() => installTrainerLevelCaps(project), /Install Hard Level Caps first/);
    assert(!getTrainerLevelCapsStatus(project).installed);
    await installLevelCaps(project);
    assert(getTrainerLevelCapsStatus(project).compatible, getTrainerLevelCapsStatus(project).message);
    await installTrainerLevelCaps(project);
    assert(getLevelCapsStatus(project).compatible);
    assert(getTrainerLevelCapsStatus(project).installed);
    updateTrainerLevelCap(project, trainerId, 55);
    assert.equal(getTrainerLevelCap(project, trainerId - 1), 0);
    assert.match(renderTrainerLevelCapSetting(project, trainerId), /Lvl Cap after Win/);
    await installTrainerLevelCaps(project);
    assert.equal(getTrainerLevelCap(project, trainerId), 55);
    const clone = addTrainer(project, trainerId);
    assert.equal(getTrainerLevelCap(project, clone.id), 55);
    const snapshot = readProjectDocument(structuredClone(createProjectDocument(project, true))).document;
    assert.equal(readTrainerLevelCapTable(snapshot.fileSystem!.additions![TRAINER_LEVEL_CAPS_PATH], trainerId), 55);
    const exported = await exportModifiedRom(project, { frostCompatibility: true });
    const output = new NintendoDSRom(exported, { fileData: "view" });
    assert.equal(readTrainerLevelCapTable(output.getFileByName(TRAINER_LEVEL_CAPS_PATH), trainerId), 55);
    const native = new NintendoDSRom(source, { fileData: "view" });
    assert.deepEqual(output.loadArm9Overlays([overlay]).get(overlay)!.data, native.loadArm9Overlays([overlay]).get(overlay)!.data);
    const reloaded = await loadProjectFromRomBytes(exported, `trainer-caps-${game}.nds`, { selectedNarcs: ["trdata", "trpok"] });
    assert(getLevelCapsStatus(reloaded).compatible);
    assert(getTrainerLevelCapsStatus(reloaded).compatible, getTrainerLevelCapsStatus(reloaded).message);
    assert.equal(getTrainerLevelCap(reloaded, clone.id), 55);
    delete reloaded.originalRomBytes;
    assert(getTrainerLevelCapsStatus(reloaded).compatible, getTrainerLevelCapsStatus(reloaded).message);
    updateTrainerLevelCap(reloaded, trainerId, 60);
    assert.equal(getTrainerLevelCap(reloaded, trainerId), 60);
    assert.equal(getTrainerLevelCap(reloaded, clone.id), 55);
    assert.equal(readTrainerLevelCapTable(reloaded.fileSystem!.replacements[output.fileId(TRAINER_LEVEL_CAPS_PATH)], trainerId), 60);
    console.log(`${game}: dependency, install, clone, project snapshot, Frost export, reimport and source-release edits passed`);
  }
} finally { globalThis.fetch = originalFetch; }
