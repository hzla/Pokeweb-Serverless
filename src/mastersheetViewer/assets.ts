import type { MastersheetDocument, MsPlacement } from "../pokeweb/mastersheetDocument";
import type { ProjectState } from "../pokeweb/projectStore";
import type { RgbaImageData } from "../pokeweb/pokemonSpriteModel";
import { FieldSnapshotRenderer } from "./sceneRenderer";
import { pokedexIconImage, tmDiscImage, typeIconImage } from "../pokeweb/gen5UiImages";

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
        if (tmType) return png(tmDiscImage(this.project, tmType));
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
        return png(typeIconImage(this.project, numbers[0]!));
      case "ui":
        if (name === "dex-tab.png") return png(pokedexIconImage(this.project, true));
        break;
      case "scenes": {
        const placement = this.placement(numbers[0]!);
        if (!placement) throw new Error("This trainer doesn't stand on the map.");
        return this.cached(key, () => this.renderer.trainerScene(placement, { crop: [74, 55], scale: 2 }));
      }
    }
    throw new Error(`Unknown image ${key}`);
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

function png(image: RgbaImageData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The image couldn't be encoded."))), "image/png"));
}
