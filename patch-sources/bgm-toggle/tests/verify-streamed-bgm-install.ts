import { readFileSync } from "node:fs";
import { NintendoDSRom } from "../src/nds/rom";
import { parseNitroSdat } from "../src/pokeweb/nitroSound";
import {
  encodeAdpcmStrm,
  installStreamedBgmInSdat,
  removeStreamedBgmFromSdat,
  rebuildStreamedBgmMappings,
  sdatSequenceFileId,
  sdatStreamCount,
  sdatStreamFileId,
  STREAMED_BGM_SAMPLE_RATE,
} from "../src/pokeweb/streamedBgmModel";

const paths = process.argv.slice(2);
if (paths.length === 0) throw new Error("Pass one or more US Black 2 / White 2 ROM paths.");

for (const path of paths) {
  const rom = new NintendoDSRom(readFileSync(path), { fileData: "view" });
  if (rom.idCode !== "IREO" && rom.idCode !== "IRDO") throw new Error(`${path}: expected IREO or IRDO, found ${rom.idCode}.`);
  const sdatId = rom.filenames.idOf("swan_sound_data.sdat");
  if (sdatId === undefined) throw new Error(`${path}: sound archive is missing.`);
  const original = rom.files[sdatId]!;
  const parsed = parseNitroSdat(original, path);
  const target = parsed.sequenceInfos.find((entry) => entry && entry.fileId !== 0xffff)?.id;
  if (target === undefined) throw new Error(`${path}: no usable sequence was found.`);
  const originalFileId = sdatSequenceFileId(original, target);
  const titleStreamFileId = sdatStreamFileId(original, 0);
  const sampleCount = 2_000;
  const stream = encodeAdpcmStrm({
    sampleRate: STREAMED_BGM_SAMPLE_RATE,
    left: Float32Array.from({ length: sampleCount }, (_value, index) => Math.sin(index / 20) * 0.5),
    right: Float32Array.from({ length: sampleCount }, (_value, index) => Math.cos(index / 20) * 0.5),
  });
  const installed = installStreamedBgmInSdat(original, target, stream.bytes);
  const installedParsed = parseNitroSdat(installed.bytes, path);
  if (installedParsed.files.length !== parsed.files.length + 2) throw new Error(`${path}: appended file count is wrong.`);
  if (sdatStreamCount(installed.bytes) !== sdatStreamCount(original) + 1) throw new Error(`${path}: appended stream count is wrong.`);
  if (sdatStreamFileId(installed.bytes, 0) !== titleStreamFileId) throw new Error(`${path}: title stream 0 changed.`);
  if (sdatSequenceFileId(installed.bytes, target) !== installed.shadowFileId) throw new Error(`${path}: target sequence was not isolated.`);
  for (const file of parsed.files) {
    const rebuilt = installedParsed.files[file.id];
    if (!rebuilt || !Buffer.from(rebuilt.data).equals(Buffer.from(file.data))) throw new Error(`${path}: unrelated SDAT file ${file.id} changed.`);
  }
  for (const sequence of parsed.sequenceInfos) {
    if (!sequence || sequence.id === target) continue;
    if (installedParsed.sequenceInfos[sequence.id]?.fileId !== sequence.fileId) throw new Error(`${path}: unrelated sequence ${sequence.id} changed.`);
  }
  const restored = removeStreamedBgmFromSdat(installed.bytes, installed);
  if (sdatSequenceFileId(restored, target) !== originalFileId || sdatStreamCount(restored) !== sdatStreamCount(original)) {
    throw new Error(`${path}: uninstall did not restore the original references.`);
  }
  console.log(`${rom.idCode}: verified ${parsed.sequenceInfos.length} sequences, ${parsed.files.length} files, ${stream.encoding} stream ${installed.streamId}, and byte-exact uninstall=${Buffer.from(restored).equals(Buffer.from(original))}.`);
  const targets = parsed.sequenceInfos.filter((entry) => entry && (entry.symbol ?? parsed.sequenceSymbols[entry.id])?.startsWith("SEQ_BGM_")).map((entry) => entry!.id);
  const many = rebuildStreamedBgmMappings(original, [], targets.map((targetSequenceId) => ({ targetSequenceId, bytes: stream.bytes })));
  const manyParsed = parseNitroSdat(many.bytes, path);
  for (const file of parsed.files) {
    if (!Buffer.from(manyParsed.files[file.id]!.data).equals(Buffer.from(file.data))) throw new Error(`${rom.idCode}: multi-install changed original file ${file.id}.`);
  }
  if (sdatStreamFileId(many.bytes, 0) !== titleStreamFileId) throw new Error(`${rom.idCode}: multi-install changed title stream.`);
  const survivors = targets.filter((_id, index) => index % 3 !== 1);
  const partial = rebuildStreamedBgmMappings(many.bytes, many.mappings, survivors.map((targetSequenceId) => ({ targetSequenceId, bytes: stream.bytes })));
  for (const id of targets) {
    const expected = partial.mappings.find((mapping) => mapping.targetSequenceId === id)?.shadowFileId ?? parsed.sequenceInfos[id]!.fileId;
    if (sdatSequenceFileId(partial.bytes, id) !== expected) throw new Error(`${rom.idCode}: partial removal lost target ${id}.`);
  }
  const fullyRestored = rebuildStreamedBgmMappings(partial.bytes, partial.mappings, []).bytes;
  if (!Buffer.from(fullyRestored).equals(Buffer.from(original))) throw new Error(`${rom.idCode}: multi-uninstall was not byte-exact.`);
  console.log(`${rom.idCode}: verified ${targets.length} simultaneous BGM mappings, partial removal to ${survivors.length}, title preservation, and byte-exact uninstall (no emulator).`);
}
