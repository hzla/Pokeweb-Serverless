import { Euler, Vector3 } from "three";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { createCutsceneBillboardModel } from "./cutsceneStaticModel";
import { writeCutsceneNpcMovement } from "./cutsceneActorCompiler";
import { buildNitroTexturePreviews, decodeTexture, readNitroResources, TextureParams } from "./map3dModel";
import { readDictionary } from "./nitroResourceWriter";
import { encodeNitroTexture } from "./nitroTextureWriter";
import { titleCameraFrame, titleNitroBlocks, type TitleScreenDocument } from "./titleScreenModel";
import { resizeTitlePng, type TitlePngImage } from "./titleScreenPng";
import { TITLE_LAST_FRAME } from "./titleScreenScene";

export const TITLE_ART_ASSETS = ["model-01", "model-01-animation", "model-02"] as const;
export const TITLE_ART_WIDTH = 256;
export const TITLE_ART_HEIGHT = 192;
export const TITLE_ART_SIZE = { min: 16, max: 256 };
const DEFAULT_TITLE_ART_PLACEMENT = { x: 128, y: 96, size: 104 };
export type TitleArtPlacement = typeof DEFAULT_TITLE_ART_PLACEMENT;

const LEGACY_TEXTURE_NAME = "pw_title_image";
type ImageSize = Pick<TitlePngImage, "width" | "height">;
const DEPTH = 12;
// The title uses a 60-degree vertical field of view.
const UNITS_PER_PIXEL = 2 * DEPTH * Math.tan(Math.PI / 6) / TITLE_ART_HEIGHT;

function assetBytes(document: TitleScreenDocument, id: string): Uint8Array {
  const bytes = document.assets.find((asset) => asset.id === id)?.bytes;
  if (!bytes) throw new Error(`Missing title asset ${id}.`);
  return bytes;
}

export function prepareTitleArtwork(source: TitlePngImage) {
  const scale = Math.min(1, TITLE_ART_WIDTH / source.width, TITLE_ART_HEIGHT / source.height);
  const width = Math.max(1, Math.round(source.width * scale)), height = Math.max(1, Math.round(source.height * scale));
  const image = resizeTitlePng(source, { width, height }, { mode: "stretch", x: .5, y: .5, zoom: 1 });
  const textureWidth = 2 ** Math.max(3, Math.ceil(Math.log2(width)));
  const textureHeight = 2 ** Math.max(3, Math.ceil(Math.log2(height)));
  const rgba = new Uint8Array(textureWidth * textureHeight * 4);
  let visible = false;
  for (let y = 0; y < height; y++) {
    rgba.set(image.rgba.subarray(y * width * 4, (y + 1) * width * 4), y * textureWidth * 4);
    for (let x = 0; x < width; x++) {
      const alpha = (y * textureWidth + x) * 4 + 3;
      rgba[alpha] = rgba[alpha] < 128 ? 0 : 255;
      visible ||= rgba[alpha] > 0;
    }
  }
  if (!visible) throw new Error("The PNG has no visible pixels after conversion.");
  // The texture name records the dimensions of the artwork inside the padded Nitro texture.
  const texture = encodeNitroTexture({ width: textureWidth, height: textureHeight, rgba, name: `pw_art_${width}_${height}` });
  const decoded = decodeTexture(
    { name: texture.name, params: new TextureParams(texture.params), data1: texture.pixels, data2: new Uint8Array() },
    { name: texture.name, offset: 0, block: texture.palette },
  );
  if (!decoded) throw new Error("Could not decode the converted title image.");
  return { texture, image: cropArtworkTexture(decoded, { width, height }) };
}
type PreparedArtwork = ReturnType<typeof prepareTitleArtwork>;

function cropArtworkTexture(texture: { width: number; height: number; rgba: Uint8Array }, { width, height }: ImageSize) {
  if (texture.width === width && texture.height === height) return { width, height, rgba: texture.rgba };
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const start = y * texture.width * 4;
    rgba.set(texture.rgba.subarray(start, start + width * 4), y * width * 4);
  }
  return { width, height, rgba };
}

export function titleArtworkDisplaySize(image: ImageSize, size: number) {
  const scale = size / Math.max(image.width, image.height);
  return { width: image.width * scale, height: image.height * scale };
}

export function fitTitleArtworkToScreen(image: ImageSize): TitleArtPlacement {
  const scale = Math.min(TITLE_ART_WIDTH / image.width, TITLE_ART_HEIGHT / image.height);
  const size = Math.round(Math.max(image.width, image.height) * scale);
  return { x: TITLE_ART_WIDTH / 2, y: TITLE_ART_HEIGHT / 2, size };
}

export function defaultTitleArtworkPlacement(image: ImageSize): TitleArtPlacement {
  return { ...DEFAULT_TITLE_ART_PLACEMENT, size: Math.max(DEFAULT_TITLE_ART_PLACEMENT.size, image.width, image.height) };
}

function validPlacement({ x, y, size }: TitleArtPlacement): boolean {
  return Number.isInteger(x) && x >= 0 && x <= TITLE_ART_WIDTH
    && Number.isInteger(y) && y >= 0 && y <= TITLE_ART_HEIGHT
    && Number.isInteger(size) && size >= TITLE_ART_SIZE.min && size <= TITLE_ART_SIZE.max;
}

export function readTitleArtwork(document: TitleScreenDocument) {
  const bytes = assetBytes(document, TITLE_ART_ASSETS[0]);
  const tex = titleNitroBlocks(bytes).get("TEX0")!;
  if (readU32(bytes, tex + 4) < 60) return undefined;
  const textures = readDictionary(bytes, tex + readU16(bytes, tex + 14));
  const texture = textures.find(({ name }) => name === LEGACY_TEXTURE_NAME || /^pw_art_\d{1,3}_\d{1,3}$/.test(name));
  if (!texture) return undefined;
  const [, , w, h] = texture.name.split("_");
  const width = texture.name === LEGACY_TEXTURE_NAME ? 128 : Number(w), height = texture.name === LEGACY_TEXTURE_NAME ? 128 : Number(h);
  const resources = readNitroResources(bytes);
  const material = resources.models[0]?.materials.find((candidate) => candidate.textureName === texture.name);
  // The native material name carries the placement through ROMs and title bundles.
  const match = material?.name.match(/^pw1_(\d{3})_(\d{3})_(\d{3})$/);
  if (!match) return undefined;
  const placement = { x: Number(match[1]), y: Number(match[2]), size: Number(match[3]) };
  const image = buildNitroTexturePreviews(resources).find((entry) => entry.name === texture.name)?.image;
  if (!image || !validPlacement(placement) || width < 1 || height < 1
    || width > Math.min(image.width, TITLE_ART_WIDTH) || height > Math.min(image.height, TITLE_ART_HEIGHT)) return undefined;
  return { image: cropArtworkTexture(image, { width, height }), placement };
}

export function compileTitleArtwork(document: TitleScreenDocument, artwork: PreparedArtwork, placement: TitleArtPlacement): Map<string, Uint8Array> {
  if (!validPlacement(placement)) throw new Error("Choose a valid title image position and size.");
  const { x, y, size } = placement;
  const name = `pw1_${[x, y, size].map((number) => String(number).padStart(3, "0")).join("_")}`;
  const { texture, image } = artwork;
  const material = new Uint8Array(44);
  writeU16(material, 2, 44);
  writeU32(material, 4, 0x7fffffff);
  writeU32(material, 12, (31 << 16) | 0xc0); // Opaque and visible from either side.
  writeU32(material, 16, 0x3f1ff8ff);
  writeU32(material, 24, 0xffffffff);
  writeU16(material, 30, 0x1fce);
  writeU16(material, 32, texture.width);
  writeU16(material, 34, texture.height);
  writeU32(material, 36, 4096);
  writeU32(material, 40, 4096);
  const displayed = titleArtworkDisplaySize(image, size);
  const halfWidth = displayed.width * UNITS_PER_PIXEL / 2, halfHeight = displayed.height * UNITS_PER_PIXEL / 2;
  const u = image.width / texture.width, v = image.height / texture.height;
  const model = createCutsceneBillboardModel({
    materialName: name,
    positions: new Float32Array([-halfWidth, -halfHeight, 0, halfWidth, -halfHeight, 0, halfWidth, halfHeight, 0, -halfWidth, halfHeight, 0]),
    uvs: new Float32Array([0, v, u, v, u, 0, 0, 0]),
    colors: new Float32Array(12).fill(1),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  }, { name, bytes: material, textureName: texture.name, paletteName: texture.name }, [texture]);
  const camera = document.camera;
  const local = new Vector3((x - TITLE_ART_WIDTH / 2) * UNITS_PER_PIXEL, (TITLE_ART_HEIGHT / 2 - y) * UNITS_PER_PIXEL, -DEPTH);
  const orientation = new Euler(0, 0, 0, "YXZ"), offset = new Vector3();
  const animation = writeCutsceneNpcMovement(Array.from({ length: Math.max(TITLE_LAST_FRAME + 1, camera.frameCount) }, (_, frame) => {
    const { position, rotation } = titleCameraFrame(camera, Math.min(frame, camera.frameCount - 1));
    const [rx, ry, rz] = rotation!.map((degrees) => degrees * Math.PI / 180);
    offset.copy(local).applyEuler(orientation.set(rx, ry, rz));
    return [position![0] + offset.x, position![1] + offset.y, position![2] + offset.z];
  }));
  return new Map([
    [TITLE_ART_ASSETS[0], model],
    [TITLE_ART_ASSETS[1], animation],
    [TITLE_ART_ASSETS[2], hideReflection(assetBytes(document, TITLE_ART_ASSETS[2]))],
  ]);
}

/** Cull the reflection's faces while keeping its model/animation binding intact. */
function hideReflection(source: Uint8Array): Uint8Array {
  const bytes = Uint8Array.from(source), mdl = titleNitroBlocks(bytes).get("MDL0")!;
  const [model] = readDictionary(bytes, mdl + 8);
  if (!model) throw new Error("The title reflection is missing its model.");
  const base = mdl + readU32(model.data, 0), materials = base + readU32(bytes, base + 8);
  for (const entry of readDictionary(bytes, materials + 4)) {
    const at = materials + readU32(entry.data, 0);
    if (readU16(bytes, at + 2) < 20 || at + 20 > bytes.length) throw new Error("Invalid title reflection material.");
    writeU32(bytes, at + 12, readU32(bytes, at + 12) & ~0xc0);
    writeU32(bytes, at + 16, readU32(bytes, at + 16) | 0xc0);
  }
  return bytes;
}
