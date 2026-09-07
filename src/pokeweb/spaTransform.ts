import {
  parseSpaArchive,
  serializeSpaArchive,
  type SpaAlphaAnim,
  type SpaArchive,
  type SpaBehavior,
  type SpaChildResource,
  type SpaColorAnim,
  type SpaResource,
  type SpaScaleAnim,
  type SpaTexture,
  type SpaTextureImportFormat,
} from "./nitroSpa";

export type SpaDonorFieldMode = "preserve" | "scrub" | "replace";

export type SpaResourceClonePolicy = {
  color: SpaDonorFieldMode;
  alpha: SpaDonorFieldMode;
  scale: SpaDonorFieldMode;
  texture: SpaDonorFieldMode;
  child: SpaDonorFieldMode;
  startDelay: SpaDonorFieldMode;
  behaviors: SpaDonorFieldMode;
  replacements?: {
    color?: [number, number, number];
    colorAnim?: SpaColorAnim;
    baseAlpha?: number;
    alphaAnim?: SpaAlphaAnim;
    baseScale?: number;
    aspectRatio?: number;
    scaleAnim?: SpaScaleAnim;
    textureIndex?: number;
    texAnim?: SpaResource["texAnim"];
    childResource?: SpaChildResource;
    startDelayFrames?: number;
    behaviors?: SpaBehavior[];
  };
};

export type SpaExtractionResult = {
  archive: SpaArchive;
  resourceMap: Map<number, number>;
  textureMap: Map<number, number>;
};

export type SpaTextureTransform = {
  rotate?: 0 | 90 | 180 | 270;
  flipX?: boolean;
  flipY?: boolean;
};

export type SpaTextureOrientationPolicy = "preserve-resource-flips" | "clear-resource-flips" | "compose-resource-flips";

export type SpaTextureQuantizationReport = {
  requestedFormat: Exclude<SpaTextureImportFormat, "preserve">;
  format: number;
  width: number;
  height: number;
  sourceColors: number;
  encodedColors: number;
  sourceAlphaLevels: number;
  encodedAlphaLevels: number;
  meanAbsoluteError: number;
  maxAbsoluteError: number;
};

export function cloneSpaResource(resource: SpaResource, policy: SpaResourceClonePolicy): SpaResource {
  const clone = structuredClone(resource);
  const replacement = policy.replacements ?? {};

  applyMode(policy.color, "color", () => {
    clone.color = [1, 1, 1];
    clone.colorAnim = undefined;
  }, () => {
    if (!replacement.color) throw replacementError("color", "color");
    clone.color = [...replacement.color];
    clone.colorAnim = replacement.colorAnim ? structuredClone(replacement.colorAnim) : undefined;
  });
  applyMode(policy.alpha, "alpha", () => {
    clone.baseAlpha = 1;
    clone.alphaAnim = undefined;
  }, () => {
    if (replacement.baseAlpha === undefined) throw replacementError("alpha", "baseAlpha");
    clone.baseAlpha = replacement.baseAlpha;
    clone.alphaAnim = replacement.alphaAnim ? structuredClone(replacement.alphaAnim) : undefined;
  });
  applyMode(policy.scale, "scale", () => {
    clone.baseScale = 1;
    clone.aspectRatio = 1;
    clone.scaleAnim = undefined;
  }, () => {
    if (replacement.baseScale === undefined || replacement.aspectRatio === undefined) throw replacementError("scale", "baseScale and aspectRatio");
    clone.baseScale = replacement.baseScale;
    clone.aspectRatio = replacement.aspectRatio;
    clone.scaleAnim = replacement.scaleAnim ? structuredClone(replacement.scaleAnim) : undefined;
  });
  applyMode(policy.texture, "texture", () => {
    clone.textureIndex = 0;
    clone.texAnim = undefined;
    clone.textureTileCountS = 0;
    clone.textureTileCountT = 0;
    clone.flipTextureS = false;
    clone.flipTextureT = false;
  }, () => {
    if (replacement.textureIndex === undefined) throw replacementError("texture", "textureIndex");
    clone.textureIndex = replacement.textureIndex;
    clone.texAnim = replacement.texAnim ? structuredClone(replacement.texAnim) : undefined;
  });
  applyMode(policy.child, "child", () => {
    clone.childResource = undefined;
    clone.drawChildFirst = false;
    clone.hideParent = false;
  }, () => {
    if (!replacement.childResource) throw replacementError("child", "childResource");
    clone.childResource = structuredClone(replacement.childResource);
  });
  applyMode(policy.startDelay, "startDelay", () => {
    clone.startDelayFrames = 0;
  }, () => {
    if (replacement.startDelayFrames === undefined) throw replacementError("startDelay", "startDelayFrames");
    clone.startDelayFrames = replacement.startDelayFrames;
  });
  applyMode(policy.behaviors, "behaviors", () => {
    clone.behaviors = [];
  }, () => {
    if (!replacement.behaviors) throw replacementError("behaviors", "behaviors");
    clone.behaviors = structuredClone(replacement.behaviors);
  });

  return clone;
}

export function extractSpaResources(
  donor: SpaArchive,
  resourceIndices: number[],
  policyForResource: (resource: SpaResource) => SpaResourceClonePolicy,
): SpaExtractionResult {
  const selected = [...new Set(resourceIndices)];
  if (selected.length === 0) throw new Error("At least one SPA resource must be selected.");
  const resources = selected.map((index) => {
    const resource = donor.resources[index];
    if (!resource) throw new Error(`SPA resource ${index} does not exist.`);
    return cloneSpaResource(resource, policyForResource(resource));
  });
  const textureIds = collectTextureClosure(donor, resources);
  const textureMap = new Map(textureIds.map((source, index) => [source, index]));
  const textures = textureIds.map((source, index) => {
    const texture = donor.textures[source];
    if (!texture) throw new Error(`SPA texture ${source} does not exist.`);
    const clone = structuredClone(texture);
    clone.index = index;
    if (clone.useSharedTexture) {
      const remapped = textureMap.get(clone.sharedTexId);
      if (remapped === undefined) throw new Error(`Shared texture ${clone.sharedTexId} was not included in the compact extraction.`);
      clone.sharedTexId = remapped;
      clone.rawBytes = undefined;
      clone.sourceChanged = true;
    }
    return clone;
  });
  const remapTexture = (source: number): number => {
    const target = textureMap.get(source);
    if (target === undefined) throw new Error(`Resource references texture ${source}, which was not extracted.`);
    return target;
  };
  resources.forEach((resource, index) => {
    resource.index = index;
    resource.textureIndex = remapTexture(resource.textureIndex);
    if (resource.texAnim) resource.texAnim.textures = resource.texAnim.textures.slice(0, resource.texAnim.textureCount).map(remapTexture);
    if (resource.childResource) resource.childResource.textureIndex = remapTexture(resource.childResource.textureIndex);
  });
  return {
    archive: {
      resourceCount: resources.length,
      textureCount: textures.length,
      resources,
      textures,
      warnings: [],
      rawHeader: donor.rawHeader?.slice(),
    },
    resourceMap: new Map(selected.map((source, index) => [source, index])),
    textureMap,
  };
}

export function normalizeSpaTextureTint(texture: SpaTexture): void {
  mapSpaTexturePixels(texture, (red, green, blue, alpha) => {
    const luminance = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
    return [luminance, luminance, luminance, alpha];
  });
}

export function hueShiftSpaTexture(texture: SpaTexture, degrees: number): void {
  mapSpaTexturePixels(texture, (red, green, blue, alpha) => {
    const [hue, saturation, value] = rgbToHsv(red / 255, green / 255, blue / 255);
    const [nextRed, nextGreen, nextBlue] = hsvToRgb((hue + degrees / 360 + 1) % 1, saturation, value);
    return [nextRed * 255, nextGreen * 255, nextBlue * 255, alpha];
  });
}

export function mapSpaTexturePalette(
  texture: SpaTexture,
  mapper: (rgba: [number, number, number, number], pixelIndex: number) => [number, number, number, number],
): void {
  mapSpaTexturePixels(texture, (red, green, blue, alpha, pixelIndex) => mapper([red, green, blue, alpha], pixelIndex));
}

export function applySpaResourceColor(
  resource: SpaResource,
  colors: Array<[number, number, number]>,
  options: { randomSpectrum?: boolean; child?: boolean } = {},
): void {
  if (colors.length === 0) throw new Error("At least one resource color is required.");
  resource.color = [...colors[0]!];
  if (colors.length === 1) resource.colorAnim = undefined;
  else {
    resource.colorAnim = {
      start: [...colors[Math.min(1, colors.length - 1)]!],
      end: [...colors[colors.length - 1]!],
      curveIn: 0,
      curvePeak: 0.5,
      curveOut: 1,
      randomStartColor: options.randomSpectrum ?? true,
      loop: true,
      interpolate: true,
    };
  }
  if (options.child && resource.childResource) {
    resource.childResource.color = [...colors[Math.min(1, colors.length - 1)]!];
    resource.childResource.useChildColor = true;
  }
}

export function transformSpaTexture(texture: SpaTexture, transform: SpaTextureTransform): void {
  const rotation = transform.rotate ?? 0;
  let width = texture.width;
  let height = texture.height;
  let pixels = texture.rgba.slice();
  if (rotation === 90 || rotation === 270) {
    const rotated = new Uint8ClampedArray(pixels.length);
    const nextWidth = height;
    const nextHeight = width;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const nextX = rotation === 90 ? height - 1 - y : y;
        const nextY = rotation === 90 ? x : width - 1 - x;
        copyPixel(pixels, y * width + x, rotated, nextY * nextWidth + nextX);
      }
    }
    pixels = rotated;
    width = nextWidth;
    height = nextHeight;
  } else if (rotation === 180) {
    const rotated = new Uint8ClampedArray(pixels.length);
    for (let index = 0; index < width * height; index += 1) copyPixel(pixels, index, rotated, width * height - 1 - index);
    pixels = rotated;
  }
  if (transform.flipX || transform.flipY) {
    const flipped = new Uint8ClampedArray(pixels.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const nextX = transform.flipX ? width - 1 - x : x;
        const nextY = transform.flipY ? height - 1 - y : y;
        copyPixel(pixels, y * width + x, flipped, nextY * width + nextX);
      }
    }
    pixels = flipped;
  }
  texture.width = width;
  texture.height = height;
  texture.rgba = pixels;
  markTextureChanged(texture);
}

export function transformSpaArchiveTexture(
  archive: SpaArchive,
  textureIndex: number,
  transform: SpaTextureTransform,
  orientationPolicy: SpaTextureOrientationPolicy,
): void {
  const texture = archive.textures[textureIndex];
  if (!texture) throw new Error(`SPA texture ${textureIndex} does not exist.`);
  transformSpaTexture(texture, transform);
  const usesTexture = (candidate: number): boolean => candidate === textureIndex || Boolean(archive.textures[candidate]?.useSharedTexture && archive.textures[candidate]?.sharedTexId === textureIndex);
  for (const resource of archive.resources) {
    const parentUsesTexture = usesTexture(resource.textureIndex) || Boolean(resource.texAnim?.textures.slice(0, resource.texAnim.textureCount).some(usesTexture));
    if (parentUsesTexture) {
      [resource.flipTextureS, resource.flipTextureT] = orientedFlips(resource.flipTextureS, resource.flipTextureT, transform, orientationPolicy);
    }
    if (resource.childResource && usesTexture(resource.childResource.textureIndex)) {
      [resource.childResource.flipTextureS, resource.childResource.flipTextureT] = orientedFlips(resource.childResource.flipTextureS, resource.childResource.flipTextureT, transform, orientationPolicy);
    }
  }
}

export function replaceSpaTextureRgba(
  archive: SpaArchive,
  textureIndex: number,
  image: { width: number; height: number; rgba: Uint8ClampedArray },
  requestedFormat: SpaTextureImportFormat,
): SpaTextureQuantizationReport {
  const texture = archive.textures[textureIndex];
  if (!texture) throw new Error(`SPA texture ${textureIndex} does not exist.`);
  validateTextureSize(image.width, image.height, image.rgba.length);
  const format = formatForImport(requestedFormat, texture.format);
  const effectiveRequest = requestedFormat === "preserve" ? requestForFormat(format) : requestedFormat;
  const trial = structuredClone(archive);
  applyTextureReplacement(trial.textures[textureIndex]!, image, format);
  const decoded = parseSpaArchive(serializeSpaArchive(trial)).textures[textureIndex];
  if (!decoded) throw new Error(`SPA texture ${textureIndex} disappeared during quantization.`);
  const report = compareTextureQuantization(image.rgba, decoded.rgba, image.width, image.height, effectiveRequest, format);
  applyTextureReplacement(texture, image, format);
  return report;
}

function applyMode(mode: SpaDonorFieldMode, field: string, scrub: () => void, replace: () => void): void {
  if (mode === "preserve") return;
  if (mode === "scrub") scrub();
  else if (mode === "replace") replace();
  else throw new Error(`Unknown ${field} donor policy: ${String(mode)}`);
}

function orientedFlips(
  flipS: boolean,
  flipT: boolean,
  transform: SpaTextureTransform,
  policy: SpaTextureOrientationPolicy,
): [boolean, boolean] {
  if (policy === "preserve-resource-flips") return [flipS, flipT];
  if (policy === "clear-resource-flips") return [false, false];
  if (policy === "compose-resource-flips") return [transform.flipX ? !flipS : flipS, transform.flipY ? !flipT : flipT];
  throw new Error(`Unknown texture orientation policy: ${String(policy)}`);
}

function replacementError(field: string, replacement: string): Error {
  return new Error(`${field} policy is replace, but replacements.${replacement} was not supplied.`);
}

function collectTextureClosure(donor: SpaArchive, resources: SpaResource[]): number[] {
  const wanted = new Set<number>();
  const add = (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= donor.textures.length) throw new Error(`SPA texture ${index} does not exist.`);
    if (wanted.has(index)) return;
    wanted.add(index);
    const texture = donor.textures[index]!;
    if (texture.useSharedTexture) add(texture.sharedTexId);
  };
  for (const resource of resources) {
    add(resource.textureIndex);
    for (const index of resource.texAnim?.textures.slice(0, resource.texAnim.textureCount) ?? []) add(index);
    if (resource.childResource) add(resource.childResource.textureIndex);
  }
  return [...wanted].sort((left, right) => left - right);
}

function mapSpaTexturePixels(
  texture: SpaTexture,
  mapper: (red: number, green: number, blue: number, alpha: number, pixelIndex: number) => [number, number, number, number],
): void {
  const output = texture.rgba.slice();
  for (let pixelIndex = 0; pixelIndex < texture.width * texture.height; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    const mapped = mapper(output[offset] ?? 0, output[offset + 1] ?? 0, output[offset + 2] ?? 0, output[offset + 3] ?? 0, pixelIndex);
    output[offset] = clampByte(mapped[0]);
    output[offset + 1] = clampByte(mapped[1]);
    output[offset + 2] = clampByte(mapped[2]);
    output[offset + 3] = clampByte(mapped[3]);
  }
  texture.rgba = output;
  markTextureChanged(texture);
}

function markTextureChanged(texture: SpaTexture): void {
  texture.sourceChanged = true;
  texture.rawBytes = undefined;
  texture.rawParam = undefined;
  texture.useSharedTexture = false;
  texture.sharedTexId = 0;
}

function applyTextureReplacement(texture: SpaTexture, image: { width: number; height: number; rgba: Uint8ClampedArray }, format: number): void {
  texture.width = image.width;
  texture.height = image.height;
  texture.rgba = image.rgba.slice();
  texture.format = format;
  texture.palColor0Transparent = true;
  markTextureChanged(texture);
}

function formatForImport(requested: SpaTextureImportFormat, current: number): number {
  if (requested === "direct") return 7;
  if (requested === "a5i3") return 6;
  if (requested === "a3i5") return 1;
  return current === 1 || current === 6 || current === 7 ? current : 7;
}

function requestForFormat(format: number): Exclude<SpaTextureImportFormat, "preserve"> {
  if (format === 1) return "a3i5";
  if (format === 6) return "a5i3";
  return "direct";
}

function compareTextureQuantization(
  source: Uint8ClampedArray,
  encoded: Uint8ClampedArray,
  width: number,
  height: number,
  requestedFormat: Exclude<SpaTextureImportFormat, "preserve">,
  format: number,
): SpaTextureQuantizationReport {
  let totalError = 0;
  let maxAbsoluteError = 0;
  for (let index = 0; index < source.length; index += 1) {
    const error = Math.abs((source[index] ?? 0) - (encoded[index] ?? 0));
    totalError += error;
    maxAbsoluteError = Math.max(maxAbsoluteError, error);
  }
  return {
    requestedFormat,
    format,
    width,
    height,
    sourceColors: uniqueChannels(source, false),
    encodedColors: uniqueChannels(encoded, false),
    sourceAlphaLevels: uniqueChannels(source, true),
    encodedAlphaLevels: uniqueChannels(encoded, true),
    meanAbsoluteError: totalError / Math.max(1, source.length),
    maxAbsoluteError,
  };
}

function uniqueChannels(rgba: Uint8ClampedArray, alphaOnly: boolean): number {
  const values = new Set<string>();
  for (let index = 0; index < rgba.length; index += 4) {
    values.add(alphaOnly ? String(rgba[index + 3] ?? 0) : `${rgba[index] ?? 0},${rgba[index + 1] ?? 0},${rgba[index + 2] ?? 0}`);
  }
  return values.size;
}

function validateTextureSize(width: number, height: number, rgbaLength: number): void {
  const valid = (value: number) => Number.isInteger(value) && value >= 8 && value <= 1024 && (value & (value - 1)) === 0;
  if (!valid(width) || !valid(height)) throw new Error("SPA texture dimensions must be powers of two from 8 through 1024.");
  if (rgbaLength !== width * height * 4) throw new Error(`Expected ${width * height * 4} RGBA bytes, received ${rgbaLength}.`);
}

function copyPixel(source: Uint8ClampedArray, sourceIndex: number, target: Uint8ClampedArray, targetIndex: number): void {
  const sourceOffset = sourceIndex * 4;
  const targetOffset = targetIndex * 4;
  target.set(source.subarray(sourceOffset, sourceOffset + 4), targetOffset);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToHsv(red: number, green: number, blue: number): [number, number, number] {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  return [hue, max === 0 ? 0 : delta / max, max];
}

function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
  const sector = Math.floor(hue * 6);
  const fraction = hue * 6 - sector;
  const p = value * (1 - saturation);
  const q = value * (1 - fraction * saturation);
  const t = value * (1 - (1 - fraction) * saturation);
  switch (sector % 6) {
    case 0: return [value, t, p];
    case 1: return [q, value, p];
    case 2: return [p, value, t];
    case 3: return [p, q, value];
    case 4: return [t, p, value];
    default: return [value, p, q];
  }
}
