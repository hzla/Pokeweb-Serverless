import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Audio as NitroFsAudio, BufferReader } from "nitro-fs";
import { readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { installBundledBgmToggleDll, readBgmRuntimeConfig } from "../pokeweb/pmcModel";
import { invalidateNitroSdatCache, parseNitroSdat } from "../pokeweb/nitroSound";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm } from "../pokeweb/rpm";
import {
  chooseStreamedBgmEncoding,
  detectStreamedBgmStatus,
  createSilentShadowSseq,
  downmixToStereo,
  encodeAdpcmStrm,
  encodePcm16Strm,
  estimateStreamedBgmBytes,
  installNativeStreamReplacement,
  installStreamedBgmInSdat,
  installStreamedBgm,
  listNativeSdatStreams,
  removeNativeStreamReplacement,
  removeStreamedBgm,
  rebuildStreamedBgmMappings,
  removeStreamedBgmFromSdat,
  resampleStereoPcm,
  sdatSequenceFileId,
  sdatStreamCount,
  sdatStreamFileId,
  STREAMED_BGM_SAMPLE_RATE,
  STREAMED_BGM_COMPRESSION_THRESHOLD,
  updateStreamedBgmRuntime,
} from "../pokeweb/streamedBgmModel";

const adpcmIndexTable = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
const adpcmStepTable = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544,
  598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878,
  2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894,
  6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818,
  18500, 20350, 22385, 24623, 27086, 29794, 32767,
];

function decodeAdpcmChannel(strm: Uint8Array, channel: number): Int16Array {
  const sampleCount = readU32(strm, 0x24);
  const blockCount = readU32(strm, 0x2c);
  const fullBlockSize = readU32(strm, 0x30);
  const fullBlockSamples = readU32(strm, 0x34);
  const lastBlockSize = readU32(strm, 0x38);
  const lastBlockSamples = readU32(strm, 0x3c);
  const decoded = new Int16Array(sampleCount);
  let output = 0;
  for (let block = 0; block < blockCount; block += 1) {
    const blockSize = block === blockCount - 1 ? lastBlockSize : fullBlockSize;
    const blockSamples = block === blockCount - 1 ? lastBlockSamples : fullBlockSamples;
    const offset = 0x68 + block * fullBlockSize * 2 + channel * blockSize;
    let sample = (readU16(strm, offset) << 16) >> 16;
    let index = strm[offset + 2]!;
    for (let i = 0; i < blockSamples; i += 1) {
      const packed = strm[offset + 4 + (i >> 1)]!;
      const code = (i & 1) === 0 ? packed & 0x0f : packed >> 4;
      const step = adpcmStepTable[index]!;
      let delta = step >> 3;
      if (code & 4) delta += step;
      if (code & 2) delta += step >> 1;
      if (code & 1) delta += step >> 2;
      sample += code & 8 ? -delta : delta;
      sample = Math.max(-0x8000, Math.min(0x7fff, sample));
      index = Math.max(0, Math.min(88, index + adpcmIndexTable[code]!));
      decoded[output + i] = sample;
    }
    output += blockSamples;
  }
  return decoded;
}

describe("BW2 streamed BGM encoding", () => {
  it("duplicates mono and averages alternating multichannel inputs into stereo", () => {
    const mono = downmixToStereo([Float32Array.of(0.25, -0.5)], STREAMED_BGM_SAMPLE_RATE);
    expect(mono.left).toEqual(Float32Array.of(0.25, -0.5));
    expect(mono.right).toEqual(mono.left);
    const surround = downmixToStereo([
      Float32Array.of(1, 0),
      Float32Array.of(0.5, -0.5),
      Float32Array.of(-1, 1),
    ], STREAMED_BGM_SAMPLE_RATE);
    expect(surround.left).toEqual(Float32Array.of(0, 0.5));
    expect(surround.right).toEqual(Float32Array.of(0.5, -0.5));
  });

  it("resamples stereo independently and rounds the output length", () => {
    const pcm = resampleStereoPcm({
      sampleRate: 16_364,
      left: Float32Array.of(0, 1, 0),
      right: Float32Array.of(0, -1, 0),
    });
    expect(pcm.sampleRate).toBe(STREAMED_BGM_SAMPLE_RATE);
    expect(pcm.left).toHaveLength(6);
    expect(pcm.left[2]).toBeCloseTo(1);
    expect(pcm.right[2]).toBeCloseTo(-1);
  });

  it("encodes clipped stereo PCM16 with sample-aligned custom loops", () => {
    const encoded = encodePcm16Strm({
      sampleRate: STREAMED_BGM_SAMPLE_RATE,
      left: Float32Array.of(-2, -1, 0, 1, 2),
      right: Float32Array.of(2, 1, 0, -1, -2),
    }, 1, 4);
    expect(readAscii(encoded.bytes, 0, 4)).toBe("STRM");
    expect(readU16(encoded.bytes, 0x1c)).toBe(STREAMED_BGM_SAMPLE_RATE);
    expect(readU16(encoded.bytes, 0x1e)).toBe(0x10);
    expect(encoded.bytes[0x18]).toBe(1);
    expect(encoded.bytes[0x19]).toBe(1);
    expect(encoded.bytes[0x1a]).toBe(2);
    expect(readU32(encoded.bytes, 0x20)).toBe(1);
    expect(readU32(encoded.bytes, 0x24)).toBe(4);
    expect(encoded.bytes).toHaveLength(0x68 + 4 * 2 * 2);
    expect(readU16(encoded.bytes, 0x68)).toBe(0x8000);
    expect(readU16(encoded.bytes, 0x68 + 6)).toBe(0x7fff);
    expect(readU16(encoded.bytes, 0x68 + 8)).toBe(0x7fff);
    expect(readU16(encoded.bytes, 0x68 + 8 + 6)).toBe(0x8000);
  });

  it("encodes block-seekable Nitro IMA ADPCM and selects it for larger archives", () => {
    const sampleCount = 2_000;
    const encoded = encodeAdpcmStrm({
      sampleRate: STREAMED_BGM_SAMPLE_RATE,
      left: Float32Array.from({ length: sampleCount }, (_value, index) => Math.sin(index / 20) * 0.5),
      right: Float32Array.from({ length: sampleCount }, (_value, index) => Math.cos(index / 20) * 0.5),
    }, 123, sampleCount);
    expect(encoded.encoding).toBe("adpcm");
    expect(encoded.bytes[0x18]).toBe(2);
    expect(readU32(encoded.bytes, 0x20)).toBe(123);
    expect(readU32(encoded.bytes, 0x24)).toBe(sampleCount);
    expect(readU32(encoded.bytes, 0x2c)).toBe(3);
    expect(readU32(encoded.bytes, 0x30)).toBe(484);
    expect(readU32(encoded.bytes, 0x34)).toBe(960);
    expect(readU32(encoded.bytes, 0x38)).toBe(44);
    expect(readU32(encoded.bytes, 0x3c)).toBe(80);
    expect(encoded.bytes.length).toBe(estimateStreamedBgmBytes("adpcm", sampleCount));
    const decodedLeft = decodeAdpcmChannel(encoded.bytes, 0);
    const decodedRight = decodeAdpcmChannel(encoded.bytes, 1);
    const expectedLeft = Array.from({ length: sampleCount }, (_value, index) => Math.round(Math.sin(index / 20) * 0.5 * 0x7fff));
    const expectedRight = Array.from({ length: sampleCount }, (_value, index) => Math.round(Math.cos(index / 20) * 0.5 * 0x7fff));
    const meanError = (actual: Int16Array, expected: number[]) => actual.reduce((sum, value, index) => sum + Math.abs(value - expected[index]!), 0) / expected.length;
    expect(meanError(decodedLeft, expectedLeft)).toBeLessThan(300);
    expect(meanError(decodedRight, expectedRight)).toBeLessThan(300);
    expect(chooseStreamedBgmEncoding(STREAMED_BGM_COMPRESSION_THRESHOLD - 10_000, sampleCount)).toBe("adpcm");
    expect(chooseStreamedBgmEncoding(1_000_000, sampleCount)).toBe("pcm16");
  });

  it("can emit non-looping native PCM16 and ADPCM streams", () => {
    const pcm = { sampleRate: STREAMED_BGM_SAMPLE_RATE, left: new Float32Array(8), right: new Float32Array(8) };
    for (const encoded of [encodePcm16Strm(pcm, 3, 8, false), encodeAdpcmStrm(pcm, 3, 8, false)]) {
      expect(encoded.bytes[0x19]).toBe(0);
      expect(readU32(encoded.bytes, 0x20)).toBe(0);
      expect(encoded.loopStartSample).toBe(0);
    }
  });

  it("builds a valid silent looping shadow sequence", () => {
    const sseq = createSilentShadowSseq();
    expect(readAscii(sseq, 0, 4)).toBe("SSEQ");
    expect(readAscii(sseq, 0x10, 4)).toBe("DATA");
    expect(readU32(sseq, 8)).toBe(sseq.length);
    expect([...sseq.subarray(0x1c)]).toEqual([0x80, 0xff, 0xff, 0x7f, 0x94, 0, 0, 0]);
  });
});

describe("BW2 streamed BGM SDAT transaction", () => {
  it.each(["B2", "W2"] as const)("updates the %s runtime without changing imported audio, loop points, or shortcut settings", async (version) => {
    const project = makeRuntimeUpdateProject(version);
    const before = structuredClone(project.codeInjection!.streamedBgm!);
    const sdat = project.fileSystem!.replacements[0]!;
    const original = sdat.slice();
    const dll = readFileSync(new URL(`../assets/codeinjection/BgmToggle${version}.dll`, import.meta.url));
    vi.stubGlobal("fetch", async () => new Response(dll));
    try {
      await updateStreamedBgmRuntime(project);
      expect(project.codeInjection!.streamedBgm).toBeUndefined();
      expect(project.codeInjection!.streamedBgms).toEqual([{ ...before, runtimeVersion: 3 }]);
      expect(project.fileSystem!.replacements[0]).toBe(sdat);
      expect(sdat).toEqual(original);
      const runtime = project.fileSystem!.additions![`patches/BgmToggle${version}.dll`]!;
      expect(parseRpm(runtime, { allowedMagics: ["DLXF"] }).metadata.PMCVersion).toBe("3.0.0");
      expect(readBgmRuntimeConfig(runtime)).toMatchObject({
        shortcutEnabled: before.toggleEnabled,
        streamedBgmEnabled: true,
        targetSequenceId: before.targetSequenceId,
        streamId: before.streamId,
        originalSequenceFileId: before.originalSequenceFileId,
        shadowFileId: before.shadowFileId,
        streamFileId: before.streamFileId,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects a runtime update before staging when installed sound references no longer match", async () => {
    const project = makeRuntimeUpdateProject("W2");
    project.codeInjection!.streamedBgm!.shadowFileId += 1;
    const before = structuredClone(project.fileSystem);
    await expect(updateStreamedBgmRuntime(project)).rejects.toThrow(/silent sequence has changed/u);
    expect(project.fileSystem).toEqual(before);
  });

  it.each(["B2", "W2"] as const)("rejects a conflicting %s native stream-buffer hook without changing the project", async (version) => {
    const project = makeRuntimeUpdateProject(version);
    project.arm9[version === "W2" ? 0x6dc84 : 0x6dc58] = 0;
    const beforeFiles = structuredClone(project.fileSystem);
    const beforeConfig = structuredClone(project.codeInjection);
    await expect(updateStreamedBgmRuntime(project)).rejects.toThrow(/background-music hook at 0x206dc.*incompatible/u);
    expect(project.fileSystem).toEqual(beforeFiles);
    expect(project.codeInjection).toEqual(beforeConfig);
  });

  it("appends one private SSEQ and STRM, isolates a shared sequence file, and removes only its verified tail", () => {
    const original = makeSdat();
    const strm = encodePcm16Strm({
      sampleRate: STREAMED_BGM_SAMPLE_RATE,
      left: new Float32Array(32),
      right: new Float32Array(32),
    }).bytes;
    const installed = installStreamedBgmInSdat(original, 1, strm);
    expect(sdatStreamCount(original)).toBe(1);
    expect(sdatStreamCount(installed.bytes)).toBe(2);
    expect(sdatStreamFileId(original, 0)).toBe(1);
    expect(sdatStreamFileId(installed.bytes, 0)).toBe(1);
    expect(sdatStreamFileId(installed.bytes, 1)).toBe(installed.streamFileId);
    expect(sdatSequenceFileId(original, 0)).toBe(0);
    expect(sdatSequenceFileId(installed.bytes, 0)).toBe(0);
    expect(sdatSequenceFileId(installed.bytes, 1)).toBe(installed.shadowFileId);
    expect(installed.originalSequenceFileId).toBe(0);
    expect(installed.streamId).toBe(1);
    expect(installed.shadowFileId).toBe(2);
    expect(installed.streamFileId).toBe(3);
    expect(() => new NitroFsAudio.SDAT(BufferReader.new(installed.bytes.slice().buffer))).not.toThrow();

    const restored = removeStreamedBgmFromSdat(installed.bytes, installed);
    expect(sdatStreamCount(restored)).toBe(1);
    expect(sdatSequenceFileId(restored, 0)).toBe(0);
    expect(sdatSequenceFileId(restored, 1)).toBe(0);
    expect(restored).toEqual(original);
  });

  it("refuses removal after the feature-owned tail is no longer final", () => {
    const original = makeSdat();
    const strm = encodePcm16Strm({ sampleRate: STREAMED_BGM_SAMPLE_RATE, left: new Float32Array(4), right: new Float32Array(4) }).bytes;
    const installed = installStreamedBgmInSdat(original, 0, strm);
    expect(() => removeStreamedBgmFromSdat(installed.bytes, { ...installed, streamFileId: installed.streamFileId - 1 })).toThrow(/final SDAT files/u);
  });
});

describe("multiple streamed BGM replacements", () => {
  const pcm = { sampleRate: STREAMED_BGM_SAMPLE_RATE, left: Float32Array.of(0.1, 0.2, 0.3, 0.4), right: Float32Array.of(-0.1, -0.2, -0.3, -0.4) };
  beforeEach(() => {
    vi.stubGlobal("fetch", async (url: URL) => new Response(readFileSync(new URL(`../assets/codeinjection/${url.pathname.split("/").pop()}`, import.meta.url))));
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["B2", "W2"] as const)("migrates %s single-track state, adds tracks, updates just one, and removes the middle then all", async (version) => {
    const project = makeRuntimeUpdateProject(version);
    const legacy = { ...project.codeInjection!.streamedBgm! };
    const original = parseNitroSdat(project.fileSystem!.replacements[0]!, "original");
    for (const targetSequenceId of [0, 2]) {
      await installStreamedBgm(project, { sourceName: `${targetSequenceId}.wav`, pcm, targetSequenceId, shortcutEnabled: true });
    }
    expect(project.codeInjection!.streamedBgm).toBeUndefined();
    const configs = project.codeInjection!.streamedBgms!;
    expect(configs.map((entry) => entry.targetSequenceId)).toEqual([1, 0, 2]);
    expect(configs[0]!.audioSha256).toBe(legacy.audioSha256);
    const parsed = parseNitroSdat(project.fileSystem!.replacements[0]!, "installed");
    expect(parsed.files[configs[0]!.streamFileId]!.data).toEqual(original.files[legacy.streamFileId]!.data);
    expect(sdatStreamFileId(parsed.bytes, 0)).toBe(1);
    expect(sdatSequenceFileId(parsed.bytes, 3)).toBe(0);
    const otherHashes = [configs[0]!.audioSha256, configs[2]!.audioSha256];
    await installStreamedBgm(project, { sourceName: "updated.wav", pcm, targetSequenceId: 0, loopStartSeconds: 1 / STREAMED_BGM_SAMPLE_RATE, loopEndSeconds: 3 / STREAMED_BGM_SAMPLE_RATE, shortcutEnabled: false });
    expect(project.codeInjection!.streamedBgms).toHaveLength(3);
    expect(project.codeInjection!.streamedBgms![1]).toMatchObject({ sourceName: "updated.wav", loopStartSample: 1, loopEndSample: 3 });
    expect([project.codeInjection!.streamedBgms![0]!.audioSha256, project.codeInjection!.streamedBgms![2]!.audioSha256]).toEqual(otherHashes);
    await installBundledBgmToggleDll(project);
    expect(readBgmRuntimeConfig(project.fileSystem!.additions![`patches/BgmToggle${version}.dll`]!)?.mappings).toHaveLength(3);
    expect(project.codeInjection!.streamedBgms!.every((entry) => entry.toggleEnabled)).toBe(true);
    await removeStreamedBgm(project, 0);
    expect(project.codeInjection!.streamedBgms!.map((entry) => entry.targetSequenceId)).toEqual([1, 2]);
    expect(project.codeInjection!.streamedBgms![1]!.streamId).toBe(2);
    const afterRemoval = project.fileSystem!.replacements[0]!;
    expect(sdatSequenceFileId(afterRemoval, 0)).toBe(0);
    expect(readBgmRuntimeConfig(project.fileSystem!.additions![`patches/BgmToggle${version}.dll`]!)?.mappings?.map((entry) => entry.targetSequenceId)).toEqual([1, 2]);
    await removeStreamedBgm(project);
    expect(project.codeInjection!.streamedBgms).toBeUndefined();
    expect(project.fileSystem!.replacements[0]).toEqual(makeSdat());
    expect(readBgmRuntimeConfig(project.fileSystem!.additions![`patches/BgmToggle${version}.dll`]!)).toMatchObject({ shortcutEnabled: true, mappings: [] });
  });

  it.each(["B2", "W2"] as const)("redetects every %s mapping after ROM export/reimport and can remove any one", async (version) => {
    const project = makeRuntimeUpdateProject(version);
    await installStreamedBgm(project, { sourceName: "new.wav", pcm, targetSequenceId: 0, shortcutEnabled: false });
    const expectedHashes = project.codeInjection!.streamedBgms!.map((entry) => entry.audioSha256);
    const rom = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
    const exported = rom.save({
      arm9: project.arm9,
      files: new Map(Object.entries(project.fileSystem!.replacements).map(([id, bytes]) => [Number(id), bytes])),
      addedFiles: Object.entries(project.fileSystem!.additions!).map(([path, bytes]) => ({ path, bytes })),
    });
    project.originalRomBytes = exported;
    project.fileSystem = undefined;
    delete project.codeInjection!.streamedBgms;
    invalidateNitroSdatCache(project);
    const status = await detectStreamedBgmStatus(project);
    expect(status.installed).toBe(true);
    expect(project.codeInjection!.streamedBgms!.map((entry) => entry.audioSha256)).toEqual(expectedHashes);
    await updateStreamedBgmRuntime(project);
    await removeStreamedBgm(project, 1);
    expect(project.codeInjection!.streamedBgms!.map((entry) => entry.targetSequenceId)).toEqual([0]);
    await removeStreamedBgm(project, 0);
    const exportedRom = new NintendoDSRom(exported, { fileData: "view" });
    const runtimeId = exportedRom.filenames.idOf(`patches/BgmToggle${version}.dll`)!;
    expect(readBgmRuntimeConfig(project.fileSystem!.replacements[runtimeId]!)).toMatchObject({ mappings: [], shortcutEnabled: false });
    expect((await detectStreamedBgmStatus(project)).installed).toBe(false);
  });

  it("honors a separate explicit storage encoding for each target", async () => {
    const project = makeRuntimeUpdateProject("W2");
    await installStreamedBgm(project, {
      sourceName: "wild.mp3", pcm, targetSequenceId: 0, encoding: "adpcm", shortcutEnabled: false,
    });
    await installStreamedBgm(project, {
      sourceName: "trainer.wav", pcm, targetSequenceId: 2, encoding: "pcm16", shortcutEnabled: false,
    });

    const configs = project.codeInjection!.streamedBgms!;
    const adpcm = configs.find((entry) => entry.targetSequenceId === 0)!;
    const pcm16 = configs.find((entry) => entry.targetSequenceId === 2)!;
    const sdat = parseNitroSdat(project.fileSystem!.replacements[0]!, "installed");
    expect(adpcm.encoding).toBe("adpcm");
    expect(pcm16.encoding).toBe("pcm16");
    expect(sdat.files[adpcm.streamFileId]!.data[0x18]).toBe(2);
    expect(sdat.files[pcm16.streamFileId]!.data[0x18]).toBe(1);
    expect(adpcm.encodedBytes).toBeLessThan(pcm16.encodedBytes);
  });

  it("replaces and restores a native stream without disturbing sequence replacements", async () => {
    const project = makeRuntimeUpdateProject("W2");
    const before = project.fileSystem!.replacements[0]!.slice();
    const mappedHash = project.codeInjection!.streamedBgm!.audioSha256;
    expect(listNativeSdatStreams(before).map((stream) => stream.id)).toEqual([0, 1]);

    const installed = await installNativeStreamReplacement(project, {
      sourceName: "title.mp3", pcm, streamId: 0, encoding: "adpcm", loop: false,
    });
    const streams = listNativeSdatStreams(project.fileSystem!.replacements[0]!);
    expect(installed).toMatchObject({ streamId: 0, streamFileId: 1, encoding: "adpcm", loop: false });
    expect(streams[0]).toMatchObject({ id: 0, encoding: "adpcm", loop: false, loopStartSample: 0 });
    expect(project.codeInjection!.streamedBgm!.audioSha256).toBe(mappedHash);
    await expect(installNativeStreamReplacement(project, {
      sourceName: "managed.mp3", pcm, streamId: 1, encoding: "adpcm", loop: true,
    })).rejects.toThrow(/sequence replacement/u);

    await removeNativeStreamReplacement(project, 0);
    expect(project.fileSystem!.replacements[0]).toEqual(before);
    expect(project.codeInjection!.nativeStreamReplacements).toBeUndefined();
    expect(project.codeInjection!.streamedBgm!.audioSha256).toBe(mappedHash);
  });

  it("supports dozens of mappings and restores shared originals with byte-exact uninstall", () => {
    const original = makeSdat(96);
    const bytes = encodePcm16Strm(pcm).bytes;
    const tracks = Array.from({ length: 96 }, (_, targetSequenceId) => ({ targetSequenceId, bytes }));
    const installed = rebuildStreamedBgmMappings(original, [], tracks);
    expect(installed.mappings).toHaveLength(96);
    expect(() => new NitroFsAudio.SDAT(BufferReader.new(installed.bytes.slice().buffer))).not.toThrow();
    const kept = tracks.filter((entry) => entry.targetSequenceId % 3 !== 0);
    const reduced = rebuildStreamedBgmMappings(installed.bytes, installed.mappings, kept);
    expect(reduced.mappings).toHaveLength(64);
    for (let id = 0; id < 96; id += 1) {
      expect(sdatSequenceFileId(reduced.bytes, id)).toBe(id % 3 === 0 ? 0 : reduced.mappings.find((entry) => entry.targetSequenceId === id)!.shadowFileId);
    }
    expect(rebuildStreamedBgmMappings(reduced.bytes, reduced.mappings, []).bytes).toEqual(original);
  });

  it("leaves all project edits unchanged on conversion or runtime-fetch failure", async () => {
    const project = makeRuntimeUpdateProject("W2");
    const before = structuredClone(project);
    await expect(installStreamedBgm(project, { sourceName: "invalid.wav", pcm, targetSequenceId: 0, loopEndSeconds: 100, shortcutEnabled: true })).rejects.toThrow(/Loop/u);
    expect(project).toEqual(before);
    vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
    await expect(installStreamedBgm(project, { sourceName: "valid.wav", pcm, targetSequenceId: 0, shortcutEnabled: true })).rejects.toThrow(/503/u);
    expect(project).toEqual(before);
  });

  it("refuses audio tampering and references from unrelated entries without mutation", async () => {
    const project = makeRuntimeUpdateProject("W2");
    const bytes = project.fileSystem!.replacements[0]!;
    const parts = parseNitroSdat(bytes, "test");
    const config = project.codeInjection!.streamedBgm!;
    const fat = readU32(bytes, 0x20);
    const streamOffset = readU32(bytes, fat + 12 + config.streamFileId * 16);
    bytes[streamOffset + 0x68] ^= 1;
    const before = bytes.slice();
    await expect(removeStreamedBgm(project, 1)).rejects.toThrow(/changed outside/u);
    expect(bytes).toEqual(before);
    const other = makeRuntimeUpdateProject("W2");
    const archive = other.fileSystem!.replacements[0]!;
    const info = readU32(archive, 0x18);
    const table = info + readU32(archive, info + 8);
    const record = info + readU32(archive, table + 4);
    writeU16(archive, record, config.shadowFileId);
    await expect(removeStreamedBgm(other, 1)).rejects.toThrow(/Unrelated sound entries/u);
    expect(parts.files[1]!.data).toEqual(parseNitroSdat(makeSdat(), "clean").files[1]!.data);
  });
});

function makeRuntimeUpdateProject(version: "B2" | "W2"): ProjectState {
  const encoded = encodePcm16Strm({ sampleRate: STREAMED_BGM_SAMPLE_RATE, left: new Float32Array(32), right: new Float32Array(32) }, 8, 24);
  const { bytes: sdat, ...mapping } = installStreamedBgmInSdat(makeSdat(), 1, encoded.bytes);
  const header = new Uint8Array(0x200);
  header.set(new TextEncoder().encode(version === "W2" ? "IRDO" : "IREO"), 12);
  writeU32(header, 0x28, 0x02000000);
  const rom = new NintendoDSRom(header);
  const originalRomBytes = rom.save({ addedFiles: [{ path: "sound.sdat", bytes: sdat }] });
  const arm9 = new Uint8Array(0x70000);
  const hooks = version === "B2"
    ? [[0x5336, "00f06ffc"], [0x5e02, "fff7c9ff"], [0x5e62, "65f0bbff"], [0x5eb0, "65f0d8ff"], [0x5fa2, "65f08dff"], [0x6dc58, "fff740fa"]] as const
    : [[0x5336, "00f06ffc"], [0x5e02, "fff7c9ff"], [0x5e62, "65f0d1ff"], [0x5eb0, "65f0eeff"], [0x5fa2, "65f0a3ff"], [0x6dc84, "fff740fa"]] as const;
  for (const [offset, hex] of hooks) arm9.set(Buffer.from(hex, "hex"), offset);
  return {
    originalRomBytes, arm9,
    session: { romName: "test", baseRom: "BW2", baseVersion: version, fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: rom.idCode, fileName: "test.nds", size: originalRomBytes.length },
    overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    fileSystem: { replacements: { 0: sdat } },
    codeInjection: {
      pmc: { overlayId: 344, overlayPath: "overlay/overlay_0344.bin" },
      streamedBgm: {
        ...mapping, runtimeVersion: 2, sourceName: "test.wav", encoding: "pcm16",
        sampleRate: STREAMED_BGM_SAMPLE_RATE, channels: 2, sampleCount: 24,
        loopStartSample: 8, loopEndSample: 24, encodedBytes: encoded.bytes.length,
        audioSha256: createHash("sha256").update(encoded.bytes).digest("hex"), toggleEnabled: version === "W2",
      },
    },
  };
}

function align(value: number, boundary: number): number {
  return Math.ceil(value / boundary) * boundary;
}

function makeSdat(sequenceCount = 4): Uint8Array {
  const counts = [sequenceCount, 0, 0, 0, 0, 0, 0, 1];
  const infoHeaderSize = 0x28;
  const tableOffsets: number[] = [];
  let cursor = infoHeaderSize;
  for (const count of counts) {
    tableOffsets.push(cursor);
    cursor += 4 + count * 4;
  }
  const sequencesStart = cursor;
  cursor += sequenceCount * 12;
  const stream0 = cursor;
  cursor += 12;
  const info = new Uint8Array(cursor);
  info.set(new TextEncoder().encode("INFO"), 0);
  writeU32(info, 4, info.length);
  tableOffsets.forEach((offset, part) => {
    writeU32(info, 8 + part * 4, offset);
    writeU32(info, offset, counts[part]!);
  });
  for (let id = 0; id < sequenceCount; id += 1) {
    writeU32(info, tableOffsets[0]! + 4 + id * 4, sequencesStart + id * 12);
    writeU16(info, sequencesStart + id * 12, 0);
  }
  writeU32(info, tableOffsets[7]! + 4, stream0);
  writeU16(info, stream0, 1);
  info[stream0 + 4] = 127;
  info[stream0 + 5] = 64;

  const files = [createSilentShadowSseq(), encodePcm16Strm({ sampleRate: STREAMED_BGM_SAMPLE_RATE, left: new Float32Array(8), right: new Float32Array(8) }).bytes];
  const names = Array.from({ length: sequenceCount }, (_, id) => new TextEncoder().encode(`SEQ_BGM_TEST_${id}\0`));
  const namesStart = 0x28 + 4 + sequenceCount * 4 + 4;
  const symb = new Uint8Array(align(namesStart + names.reduce((sum, bytes) => sum + bytes.length, 0), 4));
  symb.set(new TextEncoder().encode("SYMB"));
  writeU32(symb, 4, symb.length);
  writeU32(symb, 8, 0x28);
  writeU32(symb, 0x28, sequenceCount);
  for (let part = 1; part < 8; part += 1) writeU32(symb, 8 + part * 4, namesStart - 4);
  let nameCursor = namesStart;
  names.forEach((name, id) => {
    writeU32(symb, 0x2c + id * 4, nameCursor);
    symb.set(name, nameCursor);
    nameCursor += name.length;
  });
  const infoOffset = 0x40 + symb.length;
  const fatOffset = align(infoOffset + info.length, 4);
  const fatLength = 0x0c + files.length * 0x10;
  const fileOffset = align(fatOffset + fatLength, 4);
  let end = align(fileOffset + 0x0c, 0x80);
  const starts: number[] = [];
  for (const file of files) {
    end = align(end, 0x20);
    starts.push(end);
    end += file.length;
  }
  end = align(end, 0x20);
  const out = new Uint8Array(end);
  out.set(new TextEncoder().encode("SDAT"), 0);
  writeU16(out, 4, 0xfeff);
  writeU16(out, 6, 0x100);
  writeU32(out, 8, out.length);
  writeU16(out, 0x0c, 0x40);
  writeU16(out, 0x0e, 4);
  writeU32(out, 0x10, 0x40);
  writeU32(out, 0x14, symb.length);
  out.set(symb, 0x40);
  writeU32(out, 0x18, infoOffset);
  writeU32(out, 0x1c, info.length);
  writeU32(out, 0x20, fatOffset);
  writeU32(out, 0x24, fatLength);
  writeU32(out, 0x28, fileOffset);
  writeU32(out, 0x2c, out.length - fileOffset);
  out.set(info, infoOffset);
  out.set(new TextEncoder().encode("FAT "), fatOffset);
  writeU32(out, fatOffset + 4, fatLength);
  writeU32(out, fatOffset + 8, files.length);
  files.forEach((file, id) => {
    writeU32(out, fatOffset + 0x0c + id * 0x10, starts[id]!);
    writeU32(out, fatOffset + 0x10 + id * 0x10, file.length);
    out.set(file, starts[id]!);
  });
  out.set(new TextEncoder().encode("FILE"), fileOffset);
  writeU32(out, fileOffset + 4, out.length - fileOffset);
  writeU32(out, fileOffset + 8, files.length);
  return out;
}
