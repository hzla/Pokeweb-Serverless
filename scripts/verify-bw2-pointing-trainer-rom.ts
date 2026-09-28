import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { decompressNitro, parsePokemonMultiCells, parseRigCells } from "../src/pokeweb/pokemonSpriteModel";
import { decodeTrainerSpriteAnimation } from "../src/pokeweb/trainerSpriteModel";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const [sourceArg, patchedArg, previousArg] = process.argv.slice(2);
const sourcePath = path.resolve(sourceArg ?? path.join(workspace, "cleanwhite2.nds"));
const patchedPath = path.resolve(patchedArg ?? path.join(workspace, "cleanwhite2-pointing-trainer-v3.nds"));
const source = new NintendoDSRom(await readFile(sourcePath), { fileData: "view" });
const patched = new NintendoDSRom(await readFile(patchedPath), { fileData: "view" });
assert.equal(source.idCode, patched.idCode);
assert.ok(source.idCode.startsWith("IRD"), "Expected White 2");
assert.equal(source.files.length, patched.files.length);
assert.deepEqual(source.arm9, patched.arm9);
assert.deepEqual(source.arm7, patched.arm7);
assert.deepEqual(source.arm9OverlayTable, patched.arm9OverlayTable);
assert.deepEqual(source.arm7OverlayTable, patched.arm7OverlayTable);

const archiveId = source.fileId("a/0/7/2");
assert.equal(archiveId, patched.fileId("a/0/7/2"));
for (let i = 0; i < source.files.length; i += 1) {
  if (i !== archiveId) assert.deepEqual(source.files[i], patched.files[i], `ROM file ${i} changed`);
}
const original = new NARC(source.files[archiveId]);
const edited = new NARC(patched.files[archiveId]);
assert.equal(original.files.length, edited.files.length);
if (previousArg) {
  const previous = new NintendoDSRom(await readFile(path.resolve(previousArg)), { fileData: "view" });
  const previousArchive = new NARC(previous.files[previous.fileId("a/0/7/2")]);
  assert.equal(previousArchive.files.length, edited.files.length);
  for (let i = 0; i < edited.files.length; i += 1) {
    if (i === 1) assert.notDeepEqual(previousArchive.files[i], edited.files[i], "Nate's rig graphic did not change");
    else assert.deepEqual(previousArchive.files[i], edited.files[i], `Archive file ${i} changed since previous build`);
  }
  console.log("Confirmed only Nate's rig graphic changed since the previous build");
}
const changed = new Set([1, 4, 5, 6, 9, 12, 13, 14]);
for (let i = 0; i < original.files.length; i += 1) {
  if (!changed.has(i)) assert.deepEqual(original.files[i], edited.files[i], `Archive file ${i} changed`);
  else assert.notDeepEqual(original.files[i], edited.files[i], `Archive file ${i} did not change`);
}

for (const [appearance, name] of ["Nate", "Rosa"].entries()) {
  const at = appearance * 8;
  const originalFiles = original.files.slice(at, at + 8);
  const editedFiles = edited.files.slice(at, at + 8);
  const idleRig = parsePokemonMultiCells(originalFiles[4][0] === 0x11 ? decompressNitro(originalFiles[4]) : originalFiles[4]).cells[0];
  const editedRig = parsePokemonMultiCells(editedFiles[4][0] === 0x11 ? decompressNitro(editedFiles[4]) : editedFiles[4]).cells[4];
  assert.equal(editedRig.nodes.length, 3, `${name} should render three rig nodes`);
  assert.equal(editedRig.cellAnimationCount, 3);
  assert.equal(editedRig.nodes[0].cellAnimationIndex, 2);
  assert.equal(editedRig.nodes[0].sequenceNumber, appearance === 0 ? 5 : 6);
  assert.deepEqual(editedRig.nodes.slice(1), idleRig.nodes, `${name} should retain both native resting nodes`);
  const pointCell = parseRigCells(editedFiles[6][0] === 0x11 ? decompressNitro(editedFiles[6]) : editedFiles[6]).cells[appearance === 0 ? 5 : 6];
  assert.equal(pointCell.width, 48);
  assert.equal(pointCell.height, 36);
  const idle = decodeTrainerSpriteAnimation(originalFiles, 0).frames[0];
  const pose = decodeTrainerSpriteAnimation(editedFiles, 1);
  assert.equal(pose.totalTicks, 100);
  assert.equal(pose.outerKeyFrameCount, 2);
  for (let tick = 0; tick < 20; tick += 1) assert.deepEqual(pose.frames[tick].rgba, idle.rgba, `${name} tick ${tick} should rest`);
  assert.notDeepEqual(pose.frames[20].rgba, idle.rgba, `${name} tick 20 should point`);
  for (let y = 0; y < idle.height; y += 1) {
    for (let x = 0; x < idle.width; x += 1) {
      if (idle.rgba[(y * idle.width + x) * 4 + 3] === 0) continue;
      const pointX = idle.x + x - pose.frames[20].x;
      const pointY = idle.y + y - pose.frames[20].y;
      assert.ok(pointX >= 0 && pointY >= 0 && pointX < pose.frames[20].width && pointY < pose.frames[20].height);
      assert.ok(pose.frames[20].rgba[(pointY * pose.frames[20].width + pointX) * 4 + 3] > 0, `${name} resting rig pixel lost`);
    }
  }
  for (let tick = 21; tick < 100; tick += 1) assert.deepEqual(pose.frames[tick].rgba, pose.frames[20].rgba, `${name} tick ${tick} should point`);
  console.log(`${name}: native rest 0-19; pointing 20-99; ${pose.totalTicks} ticks`);
}
console.log(`Verified ${patchedPath}: only the two trainer rig graphics and their animations changed`);
