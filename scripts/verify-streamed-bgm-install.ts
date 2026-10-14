import { readFileSync } from "node:fs";
import { NintendoDSRom } from "../src/nds/rom";
import { parseNitroSdat } from "../src/pokeweb/nitroSound";
import type { ProjectState } from "../src/pokeweb/projectStore";
import {
  appendStandaloneSdatStream,
  encodeAdpcmStrm,
  installStreamedBgmInSdat,
  installStandaloneStream,
  removeLastStandaloneStream,
  removeFinalStandaloneSdatStream,
  removeStreamedBgmFromSdat,
  rebuildStreamedBgmMappings,
  sdatSequenceFileId,
  sdatStreamCount,
  sdatStreamFileId,
  STREAMED_BGM_SAMPLE_RATE,
} from "../src/pokeweb/streamedBgmModel";

const paths = process.argv.slice(2);
if (paths.length === 0) throw new Error("Pass one or more US Black / White / Black 2 / White 2 ROM paths.");

for (const path of paths) {
  const romBytes = readFileSync(path);
  const rom = new NintendoDSRom(romBytes, { fileData: "view" });
  if (!["IRBO", "IRAO", "IREO", "IRDO"].includes(rom.idCode)) throw new Error(`${path}: expected a US BW or BW2 ROM, found ${rom.idCode}.`);
  const namedSdatId = rom.filenames.idOf("swan_sound_data.sdat");
  const sdatId = namedSdatId ?? rom.files.findIndex((file) => file.length >= 4 && String.fromCharCode(...file.subarray(0, 4)) === "SDAT");
  if (sdatId < 0) throw new Error(`${path}: sound archive is missing.`);
  const original = rom.files[sdatId]!;
  const parsed = parseNitroSdat(original, path);
  const target = parsed.sequenceInfos.find((entry) => entry && entry.fileId !== 0xffff)?.id;
  if (target === undefined) throw new Error(`${path}: no usable sequence was found.`);
  const originalFileId = sdatSequenceFileId(original, target);
  const originalStreamCount = sdatStreamCount(original);
  const firstNativeStreamFileId = originalStreamCount ? sdatStreamFileId(original, 0) : undefined;
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
  if (firstNativeStreamFileId !== undefined && sdatStreamFileId(installed.bytes, 0) !== firstNativeStreamFileId) throw new Error(`${path}: original stream 0 changed.`);
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
  if (!Buffer.from(restored).equals(Buffer.from(original))) {
    const firstDifference = original.findIndex((byte, index) => byte !== restored[index]);
    throw new Error(`${path}: single replacement uninstall was not byte-exact (original ${original.length}, restored ${restored.length}, first difference 0x${firstDifference.toString(16)}).`);
  }
  console.log(`${rom.idCode}: verified ${parsed.sequenceInfos.length} sequences, ${parsed.files.length} files, ${stream.encoding} stream ${installed.streamId}, and byte-exact single uninstall.`);
  const standalone = appendStandaloneSdatStream(original, stream.bytes);
  if (standalone.streamId !== originalStreamCount) throw new Error(`${path}: standalone stream ID did not follow native streams.`);
  const removedStandalone = removeFinalStandaloneSdatStream(standalone.bytes, standalone.streamId, standalone.streamFileId);
  if (!Buffer.from(removedStandalone).equals(Buffer.from(original))) throw new Error(`${path}: standalone uninstall was not byte-exact.`);
  if (rom.idCode === "IRBO" || rom.idCode === "IRAO") {
    const version = rom.idCode === "IRBO" ? "B" : "W";
    const project = {
      originalRomBytes: romBytes,
      session: { romName: `Verify ${version}`, baseRom: "BW", baseVersion: version },
      romInfo: { idCode: rom.idCode },
      arm9: new Uint8Array(), overlays: {}, narcs: {}, fileSystem: { replacements: {} }, codeInjection: {},
    } as unknown as ProjectState;
    const installedTrack = await installStandaloneStream(project, {
      name: "Verification song", sourceName: "generated.wav", pcm: {
        sampleRate: STREAMED_BGM_SAMPLE_RATE,
        left: new Float32Array(2_000), right: new Float32Array(2_000),
      }, encoding: "adpcm", loop: true,
    });
    if (installedTrack.streamId !== 0) throw new Error(`${path}: first managed standalone stream should use ID 0.`);
    await removeLastStandaloneStream(project);
    if (!Buffer.from(project.fileSystem!.replacements[sdatId]!).equals(Buffer.from(original))) {
      throw new Error(`${path}: project-level standalone removal did not restore SDAT bytes.`);
    }
  }
  const targets = parsed.sequenceInfos.filter((entry) => entry && (entry.symbol ?? parsed.sequenceSymbols[entry.id])?.startsWith("SEQ_BGM_")).map((entry) => entry!.id);
  const many = rebuildStreamedBgmMappings(original, [], targets.map((targetSequenceId) => ({ targetSequenceId, bytes: stream.bytes })));
  const manyParsed = parseNitroSdat(many.bytes, path);
  for (const file of parsed.files) {
    if (!Buffer.from(manyParsed.files[file.id]!.data).equals(Buffer.from(file.data))) throw new Error(`${rom.idCode}: multi-install changed original file ${file.id}.`);
  }
  if (firstNativeStreamFileId !== undefined && sdatStreamFileId(many.bytes, 0) !== firstNativeStreamFileId) throw new Error(`${rom.idCode}: multi-install changed original stream 0.`);
  const survivors = targets.filter((_id, index) => index % 3 !== 1);
  const partial = rebuildStreamedBgmMappings(many.bytes, many.mappings, survivors.map((targetSequenceId) => ({ targetSequenceId, bytes: stream.bytes })));
  for (const id of targets) {
    const expected = partial.mappings.find((mapping) => mapping.targetSequenceId === id)?.shadowFileId ?? parsed.sequenceInfos[id]!.fileId;
    if (sdatSequenceFileId(partial.bytes, id) !== expected) throw new Error(`${rom.idCode}: partial removal lost target ${id}.`);
  }
  const fullyRestored = rebuildStreamedBgmMappings(partial.bytes, partial.mappings, []).bytes;
  if (!Buffer.from(fullyRestored).equals(Buffer.from(original))) throw new Error(`${rom.idCode}: multi-uninstall was not byte-exact.`);
  console.log(`${rom.idCode}: verified ${targets.length} simultaneous BGM mappings, partial removal to ${survivors.length}, standalone round-trip, and byte-exact uninstall (no emulator).`);
}
