import { writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import type { NintendoDSRom } from "../nds/rom";
import { parseBtx } from "./btxModel";
import { getRomFileBytes } from "./fileSystemModel";
import { buildFollowerCatalog, decodeFollowerRegistry, readFollowerStockAppearances, validateFollowerResource,
  type FollowerAnimationProfile, type FollowerRegistry } from "./followingPokemonModel";
import type { ProjectState } from "./projectStore";

export const SAVE_MENU_SPIN_INDEX_PATH = "ui/save-menu/spin-index.bin";
export const SAVE_MENU_SPIN_ART_PATH = "ui/save-menu/spin-art.narc";

function file(project: ProjectState, rom: NintendoDSRom, path: string): Uint8Array | undefined {
  const staged = Object.entries(project.fileSystem?.additions ?? {}).find(([name]) => name.toLowerCase() === path.toLowerCase());
  if (staged) return staged[1];
  const id = rom.filenames.idOf(path);
  return id === undefined ? undefined : getRomFileBytes(project, rom, id);
}

function registry(project: ProjectState, rom: NintendoDSRom, resources: readonly Uint8Array[]): FollowerRegistry {
  const installed = file(project, rom, "following/runtime-registry.bin");
  if (installed) {
    const catalog = decodeFollowerRegistry(installed);
    if (catalog.resourceCount !== resources.length) throw new Error("Follower artwork and its catalog differ. Update Following Pokémon before installing the save menu.");
    return catalog;
  }
  const personal = file(project, rom, "a/0/1/6"), appearances = file(project, rom, "a/2/0/8");
  const descriptors = file(project, rom, "a/0/4/7");
  if (!personal || !appearances || !descriptors) throw new Error("The ROM lacks native directional Pokémon artwork data.");
  return buildFollowerCatalog(new NARC(personal).files, readFollowerStockAppearances(appearances),
    new NARC(descriptors).files[0], resources);
}

function tilePose(resource: Uint8Array, sourceOffset: number, size: 32 | 64, mirrored: boolean): Uint8Array {
  const output = new Uint8Array(512), scale = size / 32;
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
    const sourceX = (mirrored ? 31 - x : x) * scale, sourceY = y * scale;
    const pixel = sourceY * size + sourceX;
    const packed = resource[sourceOffset + (pixel >>> 1)];
    const color = (packed >>> ((pixel & 1) * 4)) & 15;
    const target = ((y >>> 3) * 4 + (x >>> 3)) * 32 + (y & 7) * 4 + ((x & 7) >>> 1);
    output[target] |= color << ((x & 1) * 4);
  }
  return output;
}

function spinMember(resource: Uint8Array, profile: FollowerAnimationProfile): Uint8Array {
  const { size } = validateFollowerResource(resource, profile), btx = parseBtx(resource);
  const palette = btx.palettes[0];
  const paletteOffset = btx.paletteDataOffset + palette.paletteOffsetBytes;
  if (paletteOffset + 32 > resource.length) throw new Error("The follower palette is truncated.");
  const member = new Uint8Array(32 + 8 * 512);
  member.set(resource.subarray(paletteOffset, paletteOffset + 32));
  for (let direction = 0; direction < 4; direction += 1) for (let phase = 0; phase < 2; phase += 1) {
    const mirrored = direction === 3 && profile === "pokemon-mirrored";
    const sourceDirection = mirrored ? 2 : direction;
    const texture = btx.textures[sourceDirection * 2 + phase];
    const offset = btx.textureDataOffset + texture.imageOffsetBytes;
    if (offset + size * size / 2 > resource.length) throw new Error("The follower pose is truncated.");
    member.set(tilePose(resource, offset, size, mirrored), 32 + (direction * 2 + phase) * 512);
  }
  return member;
}

/** Snapshot native follower directions into ROM files; the menu reads one 512-byte pose at a time. */
export function buildSaveMenuSpinAssets(project: ProjectState, rom: NintendoDSRom): { index: Uint8Array; art: Uint8Array } {
  const source = file(project, rom, "a/0/4/8");
  if (!source) throw new Error("The ROM lacks the native overworld sprite archive.");
  const resources = new NARC(source).files, catalog = registry(project, rom, resources);
  if (resources.length > 0xfffe || catalog.entries.length > 16384) throw new Error("The follower artwork catalog is too large for the save menu.");
  const art = new NARC();
  art.files = Array.from({ length: resources.length }, () => new Uint8Array());
  const profiles = new Map<number, FollowerAnimationProfile>();
  for (const entry of catalog.entries) if (!entry.placeholder) {
    const previous = profiles.get(entry.resourceId);
    if (previous && previous !== entry.animationProfile) throw new Error("The follower artwork has conflicting animation profiles.");
    profiles.set(entry.resourceId, entry.animationProfile);
  }
  for (const [id, profile] of profiles) art.files[id] = spinMember(resources[id], profile);
  const index = new Uint8Array(16 + catalog.entries.length * 8);
  index.set([0x53, 0x50, 0x49, 0x4e], 0); // SPIN
  writeU16(index, 4, 1); writeU16(index, 6, 8);
  writeU32(index, 8, catalog.entries.length); writeU32(index, 12, resources.length);
  catalog.entries.forEach((entry, i) => {
    const at = 16 + i * 8, key = (entry.key.species << 11) | (entry.key.form << 3)
      | (entry.key.gender << 1) | Number(entry.key.shiny);
    writeU32(index, at, key);
    writeU16(index, at + 4, entry.placeholder ? 0xffff : entry.resourceId);
    writeU16(index, at + 6, 0);
  });
  const bytes = art.save();
  if (bytes.length > 16 * 1024 * 1024) throw new Error("Directional Pokémon artwork exceeds the save-menu ROM asset limit.");
  return { index, art: bytes };
}
