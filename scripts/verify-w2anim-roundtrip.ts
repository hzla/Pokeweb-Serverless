import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { findPwanOverrideForSpecies, listPwanSpeciesTargets, upsertPwanOverride } from "../src/pokeweb/pwanAnimationModel";
import { findTrainerPwanOverride, upsertTrainerPwanOverride } from "../src/pokeweb/trainerPwanAnimationModel";
import type { Folder } from "../src/nds/fnt";
import { parsePwanHeader } from "../src/pokeweb/pwanCompiler";
import { decompressNitro } from "../src/pokeweb/pokemonSpriteModel";
import { decodeW2AnimFrame, parseW2Anim, W2ANIM_PATH } from "../src/pokeweb/w2animCodec";
import { w2animEditorToLinear, w2animLinearToEditor } from "../src/pokeweb/w2animAnimationModel";

const input = process.argv[2];
if (!input) throw new Error("Usage: vite-node scripts/verify-w2anim-roundtrip.ts INPUT_ROM");
const check = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((value, n) => value === b[n]);
const bytes = new Uint8Array(readFileSync(input));
const rom = new NintendoDSRom(bytes, { fileData: "view" });
const sourceId = rom.filenames.idOf(W2ANIM_PATH);
check(sourceId !== undefined, "ROM does not use w2anim");
const source = parseW2Anim(rom.files[sourceId!]!);
const project = await loadProjectFromRomBytes(bytes, basename(input), { selectedNarcs: ["personal", "pokemon_sprites", "trainer_sprites"] });
const unchanged = new NintendoDSRom(await exportModifiedRom(project), { fileData: "view" });
check(equal(unchanged.files[unchanged.fileId(W2ANIM_PATH)]!, source.bytes), "Untouched streams changed during ROM export");

const target = listPwanSpeciesTargets(project).find(target => source.entries.some(e => e.arc === 4 && e.sheetFile === target.assetIndex * 20 + 2));
check(target, "No editable Pokemon stream");
const side = findPwanOverrideForSpecies(project, target!.speciesId, target!.formIndex)!.front!;
const header = parsePwanHeader(side.pwanBytes);
side.pwanBytes[header.frameOffset + 500] = side.pwanBytes[header.frameOffset + 500]! ^ 1;
project.pwanAnimations!.dirty = true;
const newPokemon = listPwanSpeciesTargets(project).find(candidate => candidate.formIndex === 0 &&
  !source.entries.some(entry => entry.arc === 4 && entry.sheetFile === candidate.assetIndex * 20 + 2));
check(newPokemon, "No native-only Pokemon target for authoring coverage");
upsertPwanOverride(project, { speciesId: newPokemon!.speciesId, formIndex: 0, assetIndex: newPokemon!.assetIndex,
  front: structuredClone(side), nativePaletteSource: "front", carrierTemplate: "w2u-gen6-placeholder" });
const trainer = source.entries.find(e => e.arc === 71);
const graphic = trainer ? (trainer.sheetFile - 1) / 8 : 0;
let trainerSide = findTrainerPwanOverride(project, graphic)?.animation;
if (!trainerSide) {
  trainerSide = structuredClone(side);
  const header = parsePwanHeader(trainerSide.pwanBytes);
  for (let n = 0; n < header.frameCount; n++) {
    const at = header.frameOffset + n * 4608;
    const frame = w2animEditorToLinear(trainerSide.pwanBytes.subarray(at, at + 4608));
    frame.fill(0, 0, 8 * 48); trainerSide.pwanBytes.set(w2animLinearToEditor(frame), at);
  }
  upsertTrainerPwanOverride(project, { graphicIndex: graphic, animation: trainerSide });
}
const th = parsePwanHeader(trainerSide.pwanBytes);
const linear = w2animEditorToLinear(trainerSide.pwanBytes.subarray(th.frameOffset, th.frameOffset + 4608));
linear[8 * 48 + 10] = linear[8 * 48 + 10]! ^ 1;
trainerSide.pwanBytes.set(w2animLinearToEditor(linear), th.frameOffset);
project.trainerPwanAnimations!.dirty = true;
const editedRom = new NintendoDSRom(await exportModifiedRom(project), { fileData: "view" });
const edited = parseW2Anim(editedRom.files[editedRom.fileId(W2ANIM_PATH)]!);
const changedSheets = new Set([target!.assetIndex * 20 + 2, target!.assetIndex * 20 + 3]);
let untouched = 0, decoded = 0;
for (const entry of source.entries) {
  const after = edited.entries.find(e => e.arc === entry.arc && e.sheetFile === entry.sheetFile)!;
  check(after && after.flags === entry.flags && after.shinyNclrFile === entry.shinyNclrFile, "Native mapping changed");
  const a = source.manis.get(entry.maniOffset)!, b = edited.manis.get(after.maniOffset)!;
  if (!((entry.arc === 4 && changedSheets.has(entry.sheetFile)) || (entry.arc === 71 && entry.sheetFile === graphic * 8 + 1))) {
    check(equal(source.bytes.subarray(a.offset, a.end), edited.bytes.subarray(b.offset, b.end)), "Untouched MANI payload changed"); untouched++;
  } else for (let frame = 0; frame < b.frames.length; frame++) {
    const blob = b.frames[frame]!;
    check(edited.bytes[blob.offset] === 0x10, "Edited stream did not use LZ10");
    check(equal(decompressNitro(edited.bytes.subarray(blob.offset, blob.offset + blob.size)), decodeW2AnimFrame(edited, b, frame)), "Independent decoder disagrees"); decoded++;
  }
}
const scan = (folder: Folder): void => { for (const name of folder.files) check(!/PokewebPwan.*\.dll$/i.test(name), "Export staged a PWAN runtime"); for (const [, child] of folder.folders) scan(child); };
scan(editedRom.filenames);
const trainerOutput = edited.entries.find(entry => entry.arc === 71 && entry.sheetFile === graphic * 8 + 1);
check(trainerOutput && trainerOutput.flags === 1, "Trainer authoring did not create a w2anim carrier stream");
const pokemonOutput = edited.entries.find(entry => entry.arc === 4 && entry.sheetFile === newPokemon!.assetIndex * 20 + 2);
check(pokemonOutput && pokemonOutput.flags === 0, "Native-only Pokemon authoring did not create a stream");
for (const entry of [trainerOutput!, pokemonOutput!]) {
  const mani = edited.manis.get(entry.maniOffset)!;
  for (let frame = 0; frame < mani.frames.length; frame++) {
    const blob = mani.frames[frame]!;
    check(equal(decompressNitro(edited.bytes.subarray(blob.offset, blob.offset + blob.size)), decodeW2AnimFrame(edited, mani, frame)), "New stream independent decoder disagrees");
    decoded++;
  }
}
console.log(JSON.stringify({ passed: true, entries: source.entries.length, untouchedEntries: untouched, independentlyDecodedEditedFrames: decoded,
  untouchedRomStreamsByteIdentical: true, pokemonTarget: { species: target!.speciesId, form: target!.formIndex }, newPokemonTarget: newPokemon!.speciesId,
  trainerGraphic: graphic, trainerWasAlreadyPresent: Boolean(trainer), backend: "w2anim" }));
