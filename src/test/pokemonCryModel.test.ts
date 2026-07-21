import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAscii } from "../nds/binary";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import { getPokemonCryInfo, importPokemonCryArchive, replaceSdatFile, validatePokemonCryArchive } from "../pokeweb/pokemonCryModel";
import { loadNitroSdatFromProject, parseNitroSdat, renderNitroWaveArchivePcm } from "../pokeweb/nitroSound";

describe("pokemonCryModel", () => {
  it("resolves and decodes indexed cry archives in clean BW and BW2 ROMs", async () => {
    const fixtures = [
      { fileName: "white.nds", baseRom: "BW", sdatFileId: 241 },
      { fileName: "cleanwhite2.nds", baseRom: "BW2", sdatFileId: 346 },
    ] as const;

    for (const fixture of fixtures) {
      const romUrl = new URL(`../../../${fixture.fileName}`, import.meta.url);
      if (!existsSync(romUrl)) continue;
      const project = await loadProjectFromRomBytes(new Uint8Array(readFileSync(romUrl)), fixture.fileName, { selectedNarcs: [] });
      const bulbasaur = await getPokemonCryInfo(project, 1);
      const oshawott = await getPokemonCryInfo(project, 501);

      expect(project.session.baseRom).toBe(fixture.baseRom);
      expect(bulbasaur).toMatchObject({ cryId: 1, archiveId: 1, sdatFileId: fixture.sdatFileId, waveCount: 1 });
      expect(oshawott).toMatchObject({ cryId: 501, archiveId: 501, sdatFileId: fixture.sdatFileId, waveCount: 1 });
      expect(readAscii(bulbasaur.bytes, 0, 4)).toBe("SWAR");
      expect(bulbasaur.sampleRate).toBeGreaterThan(0);
      expect(bulbasaur.duration).toBeGreaterThan(0);

      const pcm = renderNitroWaveArchivePcm(bulbasaur.bytes);
      expect(pcm.length).toBeGreaterThan(100);
      expect(pcm.duration).toBeCloseTo(bulbasaur.duration, 5);
      expect(pcm.left.some((sample) => sample !== 0)).toBe(true);
    }
  });

  it("imports a different-sized SWAR and reparses the resized SDAT", async () => {
    const romUrl = new URL("../../../white.nds", import.meta.url);
    if (!existsSync(romUrl)) return;
    const project = await loadProjectFromRomBytes(new Uint8Array(readFileSync(romUrl)), "white.nds", { selectedNarcs: [] });
    const bulbasaur = await getPokemonCryInfo(project, 1);
    const ivysaur = await getPokemonCryInfo(project, 2);
    const originalSdatLength = (await loadNitroSdatFromProject(project)).bytes.length;
    expect(ivysaur.bytes.length).not.toBe(bulbasaur.bytes.length);

    const imported = await importPokemonCryArchive(project, 1, ivysaur.bytes);
    const replacement = project.fileSystem?.replacements?.[bulbasaur.sdatFileId];

    expect(replacement).toBeDefined();
    expect(imported.bytes).toEqual(ivysaur.bytes);
    expect(imported.cryId).toBe(1);
    expect(replacement!.length).toBe(originalSdatLength + ivysaur.bytes.length - bulbasaur.bytes.length);
    expect(parseNitroSdat(replacement!).files[bulbasaur.archiveFileId].data).toEqual(ivysaur.bytes);
  });

  it("updates SDAT FAT offsets and block lengths when a file changes size", () => {
    const sdat = makeSdat([Uint8Array.of(1, 2, 3, 4), Uint8Array.of(5, 6, 7, 8)]);
    const replacement = Uint8Array.of(9, 10, 11, 12, 13, 14, 15, 16);
    const next = replaceSdatFile(sdat, 0, replacement);
    const parsed = parseNitroSdat(next);

    expect(parsed.files[0].data).toEqual(replacement);
    expect(parsed.files[1].data).toEqual(Uint8Array.of(5, 6, 7, 8));
    expect(parsed.files[1].dataOffset).toBe(parsed.files[0].dataOffset + replacement.length);
    expect(new DataView(next.buffer).getUint32(0x08, true)).toBe(next.length);
  });

  it("rejects files that are not complete SWAR archives", () => {
    expect(() => validatePokemonCryArchive(Uint8Array.of(1, 2, 3, 4))).toThrow(/SWAR/u);
  });
});

function makeSdat(files: Uint8Array[]): Uint8Array {
  const symbOffset = 0x40;
  const symbLength = 0x30;
  const infoOffset = symbOffset + symbLength;
  const infoLength = 0x40;
  const fatOffset = infoOffset + infoLength;
  const fatLength = 12 + files.length * 16;
  const fileOffset = fatOffset + fatLength;
  const fileLength = 12 + files.reduce((sum, file) => sum + file.length, 0);
  const out = new Uint8Array(fileOffset + fileLength);
  const view = new DataView(out.buffer);
  writeAscii(out, 0, "SDAT");
  view.setUint32(0x08, out.length, true);
  view.setUint16(0x0c, 0x40, true);
  view.setUint16(0x0e, 4, true);
  view.setUint32(0x10, symbOffset, true);
  view.setUint32(0x14, symbLength, true);
  view.setUint32(0x18, infoOffset, true);
  view.setUint32(0x1c, infoLength, true);
  view.setUint32(0x20, fatOffset, true);
  view.setUint32(0x24, fatLength, true);
  view.setUint32(0x28, fileOffset, true);
  view.setUint32(0x2c, fileLength, true);
  writeAscii(out, symbOffset, "SYMB");
  view.setUint32(symbOffset + 4, symbLength, true);
  writeAscii(out, infoOffset, "INFO");
  view.setUint32(infoOffset + 4, infoLength, true);
  writeAscii(out, fatOffset, "FAT ");
  view.setUint32(fatOffset + 4, fatLength, true);
  view.setUint32(fatOffset + 8, files.length, true);
  writeAscii(out, fileOffset, "FILE");
  view.setUint32(fileOffset + 4, fileLength, true);
  view.setUint32(fileOffset + 8, files.length, true);
  let cursor = fileOffset + 12;
  files.forEach((file, fileId) => {
    view.setUint32(fatOffset + 12 + fileId * 16, cursor, true);
    view.setUint32(fatOffset + 16 + fileId * 16, file.length, true);
    out.set(file, cursor);
    cursor += file.length;
  });
  return out;
}

function writeAscii(out: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) out[offset + index] = value.charCodeAt(index);
}
