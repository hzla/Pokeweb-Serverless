import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compileHgMoveAnimationScript,
  decompileHgMoveAnimation,
  loadHgMoveAnimationRom,
} from "../src/pokeweb/hgMoveAnimationModel";

const repoRoot = resolve("..");
const inputPath = resolve(repoRoot, "cleangold.nds");
const outputPath = resolve(repoRoot, "cleangold_move358_flames_only.nds");
const moveId = 358;

const scriptText = `
.nds
.thumb

.include "armips/include/animscriptcmd.s"

.create "build/move/move_anim/0_358", 0

a010_358:
    loadparticlefromspa 0, 376
    loadparticlefromspa 1, 38
    addparticle 0, 1, 4
    addparticle 0, 2, 4
    addparticle 0, 0, 4
    addparticle 0, 3, 4
    addparticle 1, 0, 4
    addparticle 1, 2, 4
    repeatse 1828, 117, 6, 4
    waitse 1977, 117, 4
    waitse 1977, 117, 8
    waitse 1977, 117, 16
    waitse 1977, 117, 25
    callfunction 36, 5, 2, 0, 1, 8, 264, "NaN", "NaN", "NaN", "NaN", "NaN"
    waitparticle
    unloadparticle 1
    unloadparticle 0
    end

.close
`;

const state = loadHgMoveAnimationRom(new Uint8Array(readFileSync(inputPath)));
const originalLength = state.archives.move.narc.files[moveId].length;
const compiled = compileHgMoveAnimationScript(scriptText, { archiveKind: "move", fileId: moveId });
state.archives.move.narc.files[moveId] = compiled;

const files = new Map<number, Uint8Array>([
  [state.archives.move.fileId, state.archives.move.narc.save()],
  [state.archives.sub.fileId, state.archives.sub.narc.save()],
  [state.archives.spa.fileId, state.archives.spa.narc.save()],
]);

const output = state.rom.save({ files, preserveOriginalLength: true });
writeFileSync(outputPath, output);

const decompiled = decompileHgMoveAnimation(compiled, { archiveKind: "move", fileId: moveId });
console.log(JSON.stringify({
  inputPath,
  outputPath,
  title: state.romInfo.title,
  idCode: state.romInfo.idCode,
  moveId,
  originalLength,
  compiledLength: compiled.length,
  outputLength: output.length,
  hasFistEmitter: decompiled.includes("addparticle 1, 1, 4"),
  hasFlameEmitters: decompiled.includes("addparticle 1, 0, 4") && decompiled.includes("addparticle 1, 2, 4"),
}, null, 2));
