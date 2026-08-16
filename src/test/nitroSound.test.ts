import { describe, expect, it } from "vitest";
import { concatBytes, writeU16, writeU32 } from "../nds/binary";
import { compileMoveAnimation } from "../pokeweb/moveAnimationModel";
import {
  convertNitroPcm16,
  convertNitroPcm8,
  decodeNitroAdpcm,
  encodeNitroPcmWav,
  extractNitroSequenceAssets,
  extractMoveSoundEvents,
  parseNitroSdat,
  renderNitroSequenceLoopPcm,
  renderNitroSequencePcm,
} from "../pokeweb/nitroSound";
import type { NarcName } from "../pokeweb/constants";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("nitroSound", () => {
  it("parses synthetic SDAT sequence, bank, wave archive, and symbols", () => {
    const sdat = parseNitroSdat(makeSyntheticSdat(), "sound_data.sdat");

    expect(sdat.sourcePath).toBe("sound_data.sdat");
    expect(sdat.sequenceInfos[0]).toMatchObject({ fileId: 0, bankId: 0, symbol: "SE_TEST" });
    expect(sdat.bankInfos[0]).toMatchObject({ fileId: 1, swarIds: [0, 0xffff, 0xffff, 0xffff], symbol: "BANK_TEST" });
    expect(sdat.waveArchiveInfos[0]).toMatchObject({ fileId: 2, symbol: "WAVE_TEST" });
    expect(sdat.files.map((file) => file.data.length)).toEqual([makeSyntheticSseq().length, makeSyntheticSbnk().length, makeSyntheticSwar().length]);
    expect(sdat.files.every((file) => file.data.buffer === sdat.bytes.buffer)).toBe(true);
  });

  it("extracts the native files referenced by a sequence", () => {
    const sdat = parseNitroSdat(makeSyntheticSdat());
    const assets = extractNitroSequenceAssets(sdat, 0);

    expect(assets.sequence).toMatchObject({ id: 0, fileId: 0, symbol: "SE_TEST" });
    expect(assets.bank).toMatchObject({ id: 0, fileId: 1, symbol: "BANK_TEST" });
    expect(assets.waveArchives).toHaveLength(1);
    expect(assets.waveArchives[0]).toMatchObject({ id: 0, fileId: 2, symbol: "WAVE_TEST" });
    expect(assets.sequence.bytes).toBe(sdat.files[0].data);
  });

  it("converts PCM8, PCM16, and ADPCM samples", () => {
    expect(Array.from(convertNitroPcm8(Uint8Array.of(0, 0x80, 0x7f)))).toEqual([0, -1, 127 / 128]);
    expect(Array.from(convertNitroPcm16(Uint8Array.of(0, 0, 0, 0x80, 0xff, 0x7f)))).toEqual([0, -1, 32767 / 32768]);
    expect(Array.from(decodeNitroAdpcm(Uint8Array.of(0, 0, 0, 0, 0x11)))).toEqual([1, 2]);
  });

  it("extracts PlaySound events through waits and called move animations", () => {
    const project = makeProject();
    project.narcs.move_animations!.rawFiles[7] = compileMoveAnimation(
      project,
      7,
      makeScript(`
     Wait 3
     PlaySound 6, 0, 64, 0, 0, 127, 0, 0, 0
     TerminateMoveScript
`),
    );

    const events = extractMoveSoundEvents(
      project,
      1,
      makeScript(`
     Wait 2
     PlaySound 5, 0, 64, 0, 0, 127, 0, 0, 0
     CallMoveAnimation 7
`),
    );

    expect(events.map((event) => [event.frame, event.soundId, event.sourceMoveId])).toEqual([
      [2, 5, 1],
      [5, 6, 7],
    ]);
    expect(events[0].params).toEqual([5, 0, 64, 0, 0, 127, 0, 0, 0]);
  });

  it("renders a minimal synthetic sequence to non-silent stereo PCM", async () => {
    const sdat = parseNitroSdat(makeSyntheticSdat());
    const pcm = await renderNitroSequencePcm(sdat, 0, { maxSeconds: 0.6, sampleRate: 22_050 });

    expect(pcm.numberOfChannels).toBe(2);
    expect(pcm.length).toBeGreaterThan(1000);
    expect(maxAbs(pcm.left)).toBeGreaterThan(0.001);
    expect(maxAbs(pcm.right)).toBeGreaterThan(0.001);
  });

  it("supports uncached one-off renders without changing cached defaults", async () => {
    const sdat = parseNitroSdat(makeSyntheticSdat());
    const cachedA = renderNitroSequencePcm(sdat, 0, { maxSeconds: 0.1, sampleRate: 8_000 });
    const cachedB = renderNitroSequencePcm(sdat, 0, { maxSeconds: 0.1, sampleRate: 8_000 });
    const uncachedA = renderNitroSequencePcm(sdat, 0, { maxSeconds: 0.1, sampleRate: 8_000, cache: false });
    const uncachedB = renderNitroSequencePcm(sdat, 0, { maxSeconds: 0.1, sampleRate: 8_000, cache: false });

    expect(cachedA).toBe(cachedB);
    expect(uncachedA).not.toBe(uncachedB);
    await Promise.all([cachedA, uncachedA, uncachedB]);
  });

  it("renders the intro followed by one complete SSEQ loop", async () => {
    const sdat = parseNitroSdat(makeSyntheticSdat(makeLoopingSyntheticSseq()));
    const pcm = await renderNitroSequenceLoopPcm(sdat, 0, { sampleRate: 8_000, maxSeconds: 2 });

    expect(pcm.capped).toBe(false);
    expect(pcm.loop).toBeDefined();
    expect(pcm.loop!.startSample).toBeGreaterThan(0);
    expect(pcm.loop!.endSample).toBe(pcm.length);
    expect(pcm.loop!.durationSeconds).toBeGreaterThan(0);
    expect(pcm.duration).toBeGreaterThan(pcm.loop!.durationSeconds);
    expect(maxAbs(pcm.left)).toBeGreaterThan(0.001);
  });

  it("renders a non-looping sequence through its natural end", async () => {
    const sdat = parseNitroSdat(makeSyntheticSdat());
    const pcm = await renderNitroSequenceLoopPcm(sdat, 0, { sampleRate: 8_000, maxSeconds: 20 });

    expect(pcm.capped).toBe(false);
    expect(pcm.loop).toBeUndefined();
    expect(pcm.duration).toBeLessThan(20);
    expect(maxAbs(pcm.right)).toBeGreaterThan(0.001);
  });

  it("rejects an unresolved sequence instead of exporting a partial loop", async () => {
    const sdat = parseNitroSdat(makeSyntheticSdat(makeLongSyntheticSseq()));
    await expect(renderNitroSequenceLoopPcm(sdat, 0, { sampleRate: 8_000, maxSeconds: 0.1 })).rejects.toThrow(
      "No partial WAV was exported",
    );
  });

  it("encodes stereo PCM as a valid little-endian PCM16 WAV", () => {
    const bytes = encodeNitroPcmWav({
      sampleRate: 8_000,
      length: 3,
      duration: 3 / 8_000,
      numberOfChannels: 2,
      left: Float32Array.of(-1, 0, 1),
      right: Float32Array.of(0.5, -0.5, Number.NaN),
      capped: false,
    });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(8_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(12);
    expect(Array.from({ length: 6 }, (_unused, index) => view.getInt16(44 + index * 2, true))).toEqual([-32768, 16384, 0, -16384, 32767, 0]);
  });

  it("reports a readable error for missing SDAT sequence ids", async () => {
    const sdat = parseNitroSdat(makeSyntheticSdat());
    await expect(renderNitroSequencePcm(sdat, 99)).rejects.toThrow("SDAT sequence 99 is missing");
  });
});

function makeSyntheticSdat(sseq = makeSyntheticSseq()): Uint8Array {
  const sbnk = makeSyntheticSbnk();
  const swar = makeSyntheticSwar();
  const symb = makeSymbBlock();
  const info = makeInfoBlock();
  const fatLength = 12 + 3 * 16;
  const headerLength = 0x40;
  const symbOffset = headerLength;
  const infoOffset = symbOffset + symb.length;
  const fatOffset = infoOffset + info.length;
  const fileOffset = fatOffset + fatLength;
  const files = [sseq, sbnk, swar];
  const fat = makeFatBlock(files, fileOffset);
  const fileLength = files.reduce((sum, file) => sum + file.length, 0);
  const fileSize = fileOffset + fileLength;
  const header = makeNitroHeader("SDAT", fileSize, 4, headerLength);
  writeU32(header, 0x10, symbOffset);
  writeU32(header, 0x14, symb.length);
  writeU32(header, 0x18, infoOffset);
  writeU32(header, 0x1c, info.length);
  writeU32(header, 0x20, fatOffset);
  writeU32(header, 0x24, fat.length);
  writeU32(header, 0x28, fileOffset);
  writeU32(header, 0x2c, fileLength);
  return concatBytes([header, symb, info, fat, ...files]);
}

function makeSyntheticSseq(): Uint8Array {
  const commands = Uint8Array.of(0x81, 0x00, 60, 100, 36, 0x80, 12, 0xff);
  const fileSize = 0x1c + commands.length;
  const header = makeNitroHeader("SSEQ", fileSize);
  const dataHeader = new Uint8Array(12);
  writeAscii(dataHeader, 0, "DATA");
  writeU32(dataHeader, 4, fileSize - 0x10);
  writeU32(dataHeader, 8, 0x1c);
  return concatBytes([header, dataHeader, commands]);
}

function makeLoopingSyntheticSseq(): Uint8Array {
  const commands = Uint8Array.of(
    0x81, 0x00,
    0x80, 0x04,
    60, 100, 0x04,
    0x80, 0x04,
    0x94, 0x04, 0x00, 0x00,
    0xff,
  );
  return makeSyntheticSseqWithCommands(commands);
}

function makeLongSyntheticSseq(): Uint8Array {
  return makeSyntheticSseqWithCommands(Uint8Array.of(0x80, 0x87, 0x68, 0xff));
}

function makeSyntheticSseqWithCommands(commands: Uint8Array): Uint8Array {
  const fileSize = 0x1c + commands.length;
  const header = makeNitroHeader("SSEQ", fileSize);
  const dataHeader = new Uint8Array(12);
  writeAscii(dataHeader, 0, "DATA");
  writeU32(dataHeader, 4, fileSize - 0x10);
  writeU32(dataHeader, 8, 0x1c);
  return concatBytes([header, dataHeader, commands]);
}

function makeSyntheticSbnk(): Uint8Array {
  const fileSize = 0x40 + 10;
  const bytes = new Uint8Array(fileSize);
  bytes.set(makeNitroHeader("SBNK", fileSize));
  bytes.set(makeDataBlockHeader(fileSize - 0x10), 0x10);
  writeU32(bytes, 0x38, 1);
  bytes[0x3c] = 1;
  writeU16(bytes, 0x3d, 0x40);
  writeU16(bytes, 0x40, 0);
  writeU16(bytes, 0x42, 0);
  bytes[0x44] = 60;
  bytes[0x45] = 0x7f;
  bytes[0x46] = 0;
  bytes[0x47] = 0x7f;
  bytes[0x48] = 0x20;
  bytes[0x49] = 0x40;
  return bytes;
}

function makeSyntheticSwar(): Uint8Array {
  const sampleCount = 256;
  const samples = new Uint8Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = Math.round(Math.sin((index / sampleCount) * Math.PI * 2) * 90) & 0xff;
  }
  const fileSize = 0x40 + 12 + samples.length;
  const bytes = new Uint8Array(fileSize);
  bytes.set(makeNitroHeader("SWAR", fileSize));
  bytes.set(makeDataBlockHeader(fileSize - 0x10), 0x10);
  writeU32(bytes, 0x38, 1);
  writeU32(bytes, 0x3c, 0x40);
  bytes[0x40] = 0;
  bytes[0x41] = 1;
  writeU16(bytes, 0x42, 16_384);
  writeU16(bytes, 0x44, Math.round(33_513_982 / 16_384));
  writeU16(bytes, 0x46, 0);
  writeU32(bytes, 0x48, sampleCount / 4);
  bytes.set(samples, 0x4c);
  return bytes;
}

function makeSymbBlock(): Uint8Array {
  const header = new Uint8Array(64);
  writeAscii(header, 0, "SYMB");
  const parts: Uint8Array[] = [header];
  let cursor = 64;
  const addRecord = (names: string[]): number => {
    const recordOffset = cursor;
    const tableLength = 4 + names.length * 4;
    const strings = names.map((name) => concatBytes([ascii(name), Uint8Array.of(0)]));
    const record = new Uint8Array(tableLength);
    writeU32(record, 0, names.length);
    let stringOffset = recordOffset + tableLength;
    for (let index = 0; index < names.length; index += 1) {
      writeU32(record, 4 + index * 4, stringOffset);
      stringOffset += strings[index].length;
    }
    const bytes = concatBytes([record, ...strings]);
    parts.push(bytes);
    cursor += bytes.length;
    return recordOffset;
  };
  const records = [["SE_TEST"], [], ["BANK_TEST"], ["WAVE_TEST"], [], [], [], []];
  records.forEach((names, index) => {
    writeU32(header, 8 + index * 4, addRecord(names));
  });
  const block = concatBytes(parts);
  writeU32(block, 4, block.length);
  return block;
}

function makeInfoBlock(): Uint8Array {
  const header = new Uint8Array(64);
  writeAscii(header, 0, "INFO");
  const parts: Uint8Array[] = [header];
  let cursor = 64;
  const addRecord = (entries: Uint8Array[]): number => {
    const recordOffset = cursor;
    const tableLength = 4 + entries.length * 4;
    const record = new Uint8Array(tableLength);
    writeU32(record, 0, entries.length);
    let entryOffset = recordOffset + tableLength;
    for (let index = 0; index < entries.length; index += 1) {
      writeU32(record, 4 + index * 4, entryOffset);
      entryOffset += entries[index].length;
    }
    const bytes = concatBytes([record, ...entries]);
    parts.push(bytes);
    cursor += bytes.length;
    return recordOffset;
  };

  const sequenceEntry = new Uint8Array(12);
  writeU16(sequenceEntry, 0, 0);
  writeU16(sequenceEntry, 4, 0);
  sequenceEntry[6] = 0x7f;
  const bankEntry = new Uint8Array(12);
  writeU16(bankEntry, 0, 1);
  writeU16(bankEntry, 4, 0);
  writeU16(bankEntry, 6, 0xffff);
  writeU16(bankEntry, 8, 0xffff);
  writeU16(bankEntry, 10, 0xffff);
  const waveEntry = new Uint8Array(4);
  writeU16(waveEntry, 0, 2);

  const records = [[sequenceEntry], [], [bankEntry], [waveEntry], [], [], [], []];
  records.forEach((entries, index) => {
    writeU32(header, 8 + index * 4, addRecord(entries));
  });
  const block = concatBytes(parts);
  writeU32(block, 4, block.length);
  return block;
}

function makeFatBlock(files: Uint8Array[], fileOffset: number): Uint8Array {
  const bytes = new Uint8Array(12 + files.length * 16);
  writeAscii(bytes, 0, "FAT ");
  writeU32(bytes, 4, bytes.length);
  writeU32(bytes, 8, files.length);
  let cursor = fileOffset;
  for (let index = 0; index < files.length; index += 1) {
    const offset = 12 + index * 16;
    writeU32(bytes, offset, cursor);
    writeU32(bytes, offset + 4, files[index].length);
    cursor += files[index].length;
  }
  return bytes;
}

function makeNitroHeader(magic: string, fileSize: number, blockCount = 1, headerSize = 0x10): Uint8Array {
  const bytes = new Uint8Array(headerSize);
  writeAscii(bytes, 0, magic);
  writeU16(bytes, 4, 0xfeff);
  writeU16(bytes, 6, 0x0100);
  writeU32(bytes, 8, fileSize);
  writeU16(bytes, 12, headerSize);
  writeU16(bytes, 14, blockCount);
  return bytes;
}

function makeDataBlockHeader(blockSize: number): Uint8Array {
  const bytes = new Uint8Array(40);
  writeAscii(bytes, 0, "DATA");
  writeU32(bytes, 4, blockSize);
  return bytes;
}

function makeProject(): ProjectState {
  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { move_animations: 1 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      move_animations: makeStore("move_animations", Array.from({ length: 16 }, () => new Uint8Array())),
    },
    texts: { banks: { moves: [] } },
    formats: {},
    trpokInfo: [],
  };
}

function makeStore(name: NarcName, rawFiles: Uint8Array[]): NarcStore {
  return {
    name,
    sourcePath: name,
    fileId: 0,
    fileCount: rawFiles.length,
    rawFiles,
    records: new Map(),
    dirty: new Set(),
  };
}

function makeScript(body: string): string {
  return `
.include "B2W2_MOVSCRCMD.s"
.align 4

.word 1 @ Count
${Array.from({ length: 14 }, () => ".word SCRIPT_A").join("\n")}

SCRIPT_A:
${body.trimEnd()}
`;
}

function maxAbs(values: Float32Array): number {
  return values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
}

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  writeAscii(bytes, 0, text);
  return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index) & 0xff;
}
