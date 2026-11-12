import type { MastersheetDocument, MsPlacement } from "../pokeweb/mastersheetDocument";
import type { ProjectState } from "../pokeweb/projectStore";
import type { RgbaImageData } from "../pokeweb/pokemonSpriteModel";
import { FieldSnapshotRenderer } from "./sceneRenderer";
import { NARC } from "../nds/narc";
import { writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { getRomFileBytes } from "../pokeweb/fileSystemModel";
import { parseNitroCellEffect } from "../pokeweb/nitroCell";
import { typeIconPalettes } from "../pokeweb/typeIconPalettes";
import { decompressNitro } from "../pokeweb/pokemonSpriteModel";

/**
 * Every image the viewer shows has a fixed key, which doubles as its file name in a future static export:
 *   pokemon/<species>-<form>.png   front sprite
 *   icons/<species>-<form>.png     party icon
 *   items/<id>.png                 bag icon
 *   items/tm-<type>.png            TM disc in a type's colour
 *   trainers/<class>.png           battle sprite
 *   maps/zone-<id>.webp            top-down map
 *   scenes/trainer-<id>.webp       trainer standing on the map
 *   types/<type>.png               the game's type icon (32 × 16), by type index
 *   ui/dex-tab.png                 the field menu's Pokédex icon, mirrored, for the dex tab
 *
 * The live provider draws them from the ROM. Map and scene renders are kept in IndexedDB between visits when the
 * viewer opened a ROM file (keyed by the ROM's SHA-256); sprites are quick and stay in memory.
 */
export type AssetKey = string;

export interface AssetProvider {
  url(key: AssetKey): Promise<string>;
}

export const assetKeys = {
  pokemon: (species: number, form: number) => `pokemon/${species}-${form}.png`,
  icon: (species: number, form: number) => `icons/${species}-${form}.png`,
  item: (id: number) => `items/${id}.png`,
  tm: (type: string) => `items/tm-${type.toLowerCase()}.png`,
  trainer: (classId: number) => `trainers/${classId}.png`,
  map: (zoneId: number) => `maps/zone-${zoneId}.webp`,
  scene: (trainerId: number) => `scenes/trainer-${trainerId}.webp`,
  type: (typeIndex: number) => `types/${typeIndex}.png`,
  dexTab: "ui/dex-tab.png",
};

/**
 * Bump when renders change so cached images are redrawn.
 * 3: trainer scenes cropped to 74 × 55 at 2×, the trainer card's first column.
 * 4: map thumbnails show the zone's NPCs.
 */
const RENDER_VERSION = 4;

export class RomAssetProvider implements AssetProvider {
  private urls = new Map<AssetKey, Promise<string>>();
  private renderer: FieldSnapshotRenderer;
  private trainerSpritesReady?: Promise<boolean>;
  private menuFiles?: Uint8Array[];

  constructor(private project: ProjectState, private document: MastersheetDocument, private cache?: ImageCache) {
    this.renderer = new FieldSnapshotRenderer(project);
  }

  url(key: AssetKey): Promise<string> {
    let url = this.urls.get(key);
    if (!url) {
      url = this.create(key).then((blob) => URL.createObjectURL(blob));
      this.urls.set(key, url);
      url.catch(() => this.urls.delete(key));
    }
    return url;
  }

  private async create(key: AssetKey): Promise<Blob> {
    const [kind, name] = key.split("/") as [string, string];
    const numbers = name.match(/\d+/gu)?.map(Number) ?? [];
    switch (kind) {
      case "pokemon":
        return png(trim(await this.sprite(() => import("../pokeweb/pokemonSpriteModel").then((m) => m.getPokemonSpriteImage(this.project, m.resolvePokemonSpriteId(this.project, numbers[0]!, numbers[1] ?? 0), { kind: "sprite", side: "front", gender: "male" }, "normal")))));
      case "icons":
        return png(firstFrame(await this.sprite(() => import("../pokeweb/pokemonSpriteModel").then((m) => m.getPokemonIconImage(this.project, m.resolvePokemonSpriteId(this.project, numbers[0]!, numbers[1] ?? 0), "male")))));
      case "items": {
        const { readItemSprite } = await import("../pokeweb/itemSpriteModel");
        if (!this.project.originalRomBytes) throw new Error("The ROM isn't loaded.");
        const tmType = /^tm-([a-z]+)\.png$/u.exec(name)?.[1];
        if (tmType) {
          const { tmTypePalette } = await import("../pokeweb/tmModel");
          const palette = tmTypePalette(tmType);
          if (palette === undefined) throw new Error(`No TM colour for ${tmType}.`);
          return png(trim(readItemSprite(this.project, this.project.originalRomBytes, 328, palette)));
        }
        return png(trim(readItemSprite(this.project, this.project.originalRomBytes, numbers[0]!)));
      }
      case "trainers": {
        const sprites = await import("../pokeweb/trainerSpriteModel");
        this.trainerSpritesReady ??= sprites.ensureTrainerSpriteStore(this.project);
        await this.trainerSpritesReady;
        return png(trim(sprites.getTrainerClassSpriteImage(this.project, numbers[0]!)));
      }
      case "maps":
        return this.cached(key, () => this.renderer.zoneTopDown(numbers[0]!));
      case "types":
        return png(this.typeIcon(numbers[0]!));
      case "ui":
        if (name === "dex-tab.png") return png(mirror(this.dexIcon()));
        break;
      case "scenes": {
        const placement = this.placement(numbers[0]!);
        if (!placement) throw new Error("This trainer doesn't stand on the map.");
        return this.cached(key, () => this.renderer.trainerScene(placement, { crop: [74, 55], scale: 2 }));
      }
    }
    throw new Error(`Unknown image ${key}`);
  }

  /**
   * The type icon the game's menus draw (app menu archive a/0/8/2): graphics 0x22 + type, palette file 0x21 with
   * a palette per type from the ROM's own table (so a hack's Fairy icon gets its colour), cell 0x3c and animation 0x3f.
   * The same decode as Pokeweb's custom UI (src/customUi/romAssets.ts).
   */
  private typeIcon(type: number): RgbaImageData {
    const PALETTE_OF_TYPE = typeIconPalettes(this.project.arm9);
    if (!(type >= 0 && type < PALETTE_OF_TYPE.length)) throw new Error(`No icon for type ${type}.`);
    if (!this.project.originalRomBytes) throw new Error("The ROM isn't loaded.");
    if (!this.menuFiles) {
      const rom = new NintendoDSRom(this.project.originalRomBytes);
      const id = rom.filenames.idOf("a/0/8/2");
      if (id === undefined) throw new Error("The ROM has no menu graphics archive.");
      this.menuFiles = new NARC(getRomFileBytes(this.project, rom, id)).files;
    }
    const files = this.menuFiles;
    const char = files[0x22 + type], palette = files[0x21], cell = files[0x3c], animation = files[0x3f];
    const paletteId = PALETTE_OF_TYPE[type]!;
    if (!char || !palette || !cell || !animation || 40 + 32 * (paletteId + 1) > palette.length) throw new Error(`The ROM has no icon for type ${type}.`);
    const colors = palette.slice();
    colors.set(palette.subarray(40 + paletteId * 32, 72 + paletteId * 32), 40);
    const mappedCell = cell.slice();
    // BW2 loads these under GX_OBJVRAMMODE_CHAR_1D_32K; the NCER's mapping hint is zero.
    writeU32(mappedCell, 32, 0x10);
    const frame = parseNitroCellEffect("mastersheet-type", 0, 0, 0, 0, char, colors, mappedCell, animation, { originCentered: false }).sequences[0]?.frames[0];
    if (!frame) throw new Error(`The ROM's icon for type ${type} couldn't be read.`);
    return trim({ width: frame.width, height: frame.height, pixels: new Uint8ClampedArray(frame.rgba) });
  }

  /**
   * The Pokédex icon of the touch-screen field menu (a/0/7/0, ARCID_FIELD_MENU): the pink variant, graphics 0x0e,
   * cell 0x1e, animation 0x29, palette file 2 (field_menu.c's FIELD_MENU_ICON_FILES and LoadResources).
   */
  private dexIcon(): RgbaImageData {
    if (!this.project.originalRomBytes) throw new Error("The ROM isn't loaded.");
    const rom = new NintendoDSRom(this.project.originalRomBytes);
    const id = rom.filenames.idOf("a/0/7/0");
    if (id === undefined) throw new Error("The ROM has no field menu archive.");
    const files = new NARC(getRomFileBytes(this.project, rom, id)).files.map(expandNitro);
    const char = files[0x0e], palette = files[2], cell = files[0x1e], animation = files[0x29];
    if (!char || !palette || !cell || !animation) throw new Error("The ROM's Pokédex icon is missing.");
    const mappedCell = cell.slice();
    writeU32(mappedCell, 32, 0x10);
    const frame = parseNitroCellEffect("mastersheet-dex-tab", 0, 0, 0, 0, char, palette, mappedCell, animation, { originCentered: false }).sequences[0]?.frames[0];
    if (!frame) throw new Error("The ROM's Pokédex icon couldn't be read.");
    return trim({ width: frame.width, height: frame.height, pixels: new Uint8ClampedArray(frame.rgba) });
  }

  private placement(trainerId: number): MsPlacement | undefined {
    return this.document.trainers[trainerId]?.placements[0];
  }

  private async sprite(load: () => Promise<RgbaImageData>): Promise<RgbaImageData> {
    return load();
  }

  private async cached(key: AssetKey, render: () => Promise<Blob>): Promise<Blob> {
    const cacheKey = `${RENDER_VERSION}:${key}`;
    const hit = await this.cache?.get(cacheKey);
    if (hit) return hit;
    const blob = await render();
    void this.cache?.put(cacheKey, blob);
    return blob;
  }

  dispose(): void {
    this.renderer.dispose();
    for (const url of this.urls.values()) url.then(URL.revokeObjectURL, () => undefined);
    this.urls.clear();
  }
}

/** Blobs kept per ROM in IndexedDB. Failures (private windows, quota) just mean no cache. */
export class ImageCache {
  private db?: Promise<IDBDatabase | undefined>;

  constructor(readonly romKey: string) {}

  static async forRom(bytes: Uint8Array): Promise<ImageCache> {
    return new ImageCache(await ImageCache.keyForRom(bytes));
  }

  /** The first 12 bytes of the ROM's SHA-256, so renders are shared by every copy of the same ROM. */
  static async keyForRom(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
    return [...new Uint8Array(digest).subarray(0, 12)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  private open(): Promise<IDBDatabase | undefined> {
    this.db ??= new Promise((resolve) => {
      try {
        const request = indexedDB.open("pokeweb-mastersheet-images", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("images");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
    return this.db;
  }

  async get(key: string): Promise<Blob | undefined> {
    const db = await this.open();
    if (!db) return undefined;
    return new Promise((resolve) => {
      try {
        const request = db.transaction("images").objectStore("images").get(`${this.romKey}:${key}`);
        request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : undefined);
        request.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  async put(key: string, blob: Blob): Promise<void> {
    const db = await this.open();
    if (!db) return;
    try {
      db.transaction("images", "readwrite").objectStore("images").put(blob, `${this.romKey}:${key}`);
    } catch {
      // No cache this time.
    }
  }
}

function firstFrame(image: RgbaImageData): RgbaImageData {
  const size = Math.min(image.width, image.height);
  return { width: image.width, height: size, pixels: image.pixels.slice(0, image.width * size * 4) };
}

/** Crops transparent margins so small sprites line up by their visible pixels. */
function trim(image: RgbaImageData): RgbaImageData {
  const { width, height, pixels } = image;
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3]! > 0) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return image;
  const w = right - left + 1, h = bottom - top + 1;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) out.set(pixels.subarray(((top + y) * width + left) * 4, ((top + y) * width + left + w) * 4), y * w * 4);
  return { width: w, height: h, pixels: out };
}

/** Flip left to right. */
function mirror(image: RgbaImageData): RgbaImageData {
  const { width, height, pixels } = image;
  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) out.set(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), (y * width + width - 1 - x) * 4);
  }
  return { width, height, pixels: out };
}

/** Field menu files are LZ-compressed; the menu archive's type icons aren't. */
function expandNitro(bytes: Uint8Array): Uint8Array {
  return bytes[0] === 0x10 || bytes[0] === 0x11 ? decompressNitro(bytes) : bytes;
}

function png(image: RgbaImageData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The image couldn't be encoded."))), "image/png"));
}
