import { readAscii, readU32, writeU32 } from "../nds/binary";
import { recordGenericChange } from "./actionChangelog";
import { setRomFileReplacement } from "./fileSystemModel";
import { findPokemonPersonalFormOwner, pokemonSpeciesLabel } from "./pokemonLabels";
import {
  getNitroWaveArchiveMetadata,
  invalidateNitroSdatCache,
  loadNitroSdatFromProject,
  renderNitroWaveArchivePcm,
  type NitroRenderedPcm,
  type NitroSdat,
  type NitroWaveArchiveMetadata,
} from "./nitroSound";
import type { ProjectState } from "./projectStore";

const MAX_CRY_ARCHIVE_BYTES = 32 * 1024 * 1024;

export type PokemonCryInfo = NitroWaveArchiveMetadata & {
  requestedPersonalId: number;
  cryId: number;
  archiveId: number;
  archiveFileId: number;
  sdatFileId: number;
  sdatPath: string;
  bytes: Uint8Array;
};

export async function getPokemonCryInfo(project: ProjectState, requestedPersonalId: number): Promise<PokemonCryInfo> {
  if (project.session.generation !== "gen5") throw new Error("Pokemon cry editing is currently available for Black, White, Black 2, and White 2 ROMs.");
  const sdat = await loadNitroSdatFromProject(project);
  if (sdat.sourceFileId === undefined) throw new Error("The ROM's SDAT file could not be associated with a NitroFS file ID.");
  const cryId = resolvePokemonCryId(project, sdat, requestedPersonalId);
  const archive = sdat.waveArchiveInfos[cryId];
  const entry = archive && sdat.files[archive.fileId];
  if (!archive || !entry) throw new Error(`Cry archive ${cryId} is missing from the ROM's SDAT.`);
  const metadata = getNitroWaveArchiveMetadata(entry.data);
  return {
    requestedPersonalId,
    cryId,
    archiveId: archive.id,
    archiveFileId: archive.fileId,
    sdatFileId: sdat.sourceFileId,
    sdatPath: sdat.sourcePath ?? `ROM file ${sdat.sourceFileId}`,
    bytes: entry.data,
    ...metadata,
  };
}

export async function renderPokemonCryPcm(project: ProjectState, requestedPersonalId: number): Promise<NitroRenderedPcm> {
  return renderNitroWaveArchivePcm((await getPokemonCryInfo(project, requestedPersonalId)).bytes);
}

export async function importPokemonCryArchive(project: ProjectState, requestedPersonalId: number, bytes: Uint8Array): Promise<PokemonCryInfo> {
  validatePokemonCryArchive(bytes);
  const before = await getPokemonCryInfo(project, requestedPersonalId);
  const sdat = await loadNitroSdatFromProject(project);
  const nextSdat = replaceSdatFile(sdat.bytes, before.archiveFileId, bytes);
  setRomFileReplacement(project, before.sdatFileId, nextSdat);
  invalidateNitroSdatCache(project);
  const subject = pokemonSpeciesLabel(project, requestedPersonalId);
  recordGenericChange(project, "pokemon_cries", `${subject}'s cry archive was imported.`, subject, {
    key: `pokemon-cry:${before.cryId}`,
  });
  return getPokemonCryInfo(project, requestedPersonalId);
}

export function validatePokemonCryArchive(bytes: Uint8Array): NitroWaveArchiveMetadata {
  if (bytes.length > MAX_CRY_ARCHIVE_BYTES) throw new Error("The imported cry archive is larger than 32 MB.");
  if (bytes.length < 0x40 || readAscii(bytes, 0, 4) !== "SWAR" || readAscii(bytes, 0x10, 4) !== "DATA") {
    throw new Error("Choose a Nintendo DS SWAR sound archive exported by this editor.");
  }
  const declaredLength = readU32(bytes, 0x08);
  if (declaredLength !== bytes.length) throw new Error(`The SWAR header declares ${declaredLength} bytes, but the file contains ${bytes.length}.`);
  const dataLength = readU32(bytes, 0x14);
  if (dataLength + 0x10 !== bytes.length) throw new Error("The SWAR DATA block size does not match the file length.");
  if (bytes.length % 4 !== 0) throw new Error("The SWAR file length must be aligned to four bytes.");
  return getNitroWaveArchiveMetadata(bytes);
}

export function replaceSdatFile(sdatBytes: Uint8Array, fileId: number, replacement: Uint8Array): Uint8Array {
  if (readAscii(sdatBytes, 0, 4) !== "SDAT") throw new Error("The source sound archive is not a valid SDAT.");
  const fatOffset = readU32(sdatBytes, 0x20);
  const fileOffset = readU32(sdatBytes, 0x28);
  if (readAscii(sdatBytes, fatOffset, 4) !== "FAT " || readAscii(sdatBytes, fileOffset, 4) !== "FILE") {
    throw new Error("The SDAT FAT or FILE block is missing.");
  }
  const fileCount = readU32(sdatBytes, fatOffset + 8);
  if (!Number.isInteger(fileId) || fileId < 0 || fileId >= fileCount) throw new Error(`SDAT file ${fileId} is out of range.`);
  const targetFatOffset = fatOffset + 12 + fileId * 16;
  const oldOffset = readU32(sdatBytes, targetFatOffset);
  const oldLength = readU32(sdatBytes, targetFatOffset + 4);
  if (oldOffset < fileOffset || oldOffset + oldLength > sdatBytes.length) throw new Error(`SDAT file ${fileId} has invalid bounds.`);
  const delta = replacement.length - oldLength;
  const out = new Uint8Array(sdatBytes.length + delta);
  out.set(sdatBytes.subarray(0, oldOffset));
  out.set(replacement, oldOffset);
  out.set(sdatBytes.subarray(oldOffset + oldLength), oldOffset + replacement.length);

  for (let currentId = 0; currentId < fileCount; currentId += 1) {
    const entryOffset = fatOffset + 12 + currentId * 16;
    const dataOffset = readU32(sdatBytes, entryOffset);
    if (currentId === fileId) writeU32(out, entryOffset + 4, replacement.length);
    else if (dataOffset > oldOffset) writeU32(out, entryOffset, dataOffset + delta);
  }
  writeU32(out, 0x08, out.length);
  writeU32(out, 0x2c, readU32(sdatBytes, 0x2c) + delta);
  writeU32(out, fileOffset + 4, readU32(sdatBytes, fileOffset + 4) + delta);
  return out;
}

function resolvePokemonCryId(project: ProjectState, sdat: NitroSdat, requestedPersonalId: number): number {
  if (hasCryArchive(sdat, requestedPersonalId)) return requestedPersonalId;
  const baseSpeciesId = findPokemonPersonalFormOwner(project, requestedPersonalId)?.speciesId;
  if (baseSpeciesId !== undefined && hasCryArchive(sdat, baseSpeciesId)) return baseSpeciesId;
  throw new Error(`No cry archive was found for Pokemon personal entry ${requestedPersonalId}.`);
}

function hasCryArchive(sdat: NitroSdat, cryId: number): boolean {
  const archive = sdat.waveArchiveInfos[cryId];
  const entry = archive && sdat.files[archive.fileId];
  return Boolean(entry && readAscii(entry.data, 0, 4) === "SWAR");
}
