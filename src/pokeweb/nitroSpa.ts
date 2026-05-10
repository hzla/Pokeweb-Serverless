import { concatBytes, pad4, readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";

const SPA_MAGIC = 0x53504120;
const SPT_MAGIC = 0x53505420;
const RESOURCE_HEADER_SIZE = 88;
const TEXTURE_HEADER_SIZE = 32;
const FRAMES_PER_SECOND = 30;

export type SpaWarning = {
  message: string;
};

export type SpaScaleAnim = {
  start: number;
  mid: number;
  end: number;
  curveIn: number;
  curveOut: number;
  loop: boolean;
};

export type SpaColorAnim = {
  start: [number, number, number];
  end: [number, number, number];
  curveIn: number;
  curvePeak: number;
  curveOut: number;
  randomStartColor: boolean;
  loop: boolean;
  interpolate: boolean;
};

export type SpaAlphaAnim = {
  start: number;
  mid: number;
  end: number;
  randomRange: number;
  curveIn: number;
  curveOut: number;
  loop: boolean;
};

export type SpaTexAnim = {
  textures: number[];
  textureCount: number;
  step: number;
  randomizeInit: boolean;
  loop: boolean;
};

export type SpaChildResource = {
  usesBehaviors: boolean;
  hasScaleAnim: boolean;
  hasAlphaAnim: boolean;
  rotationType: number;
  followEmitter: boolean;
  useChildColor: boolean;
  drawType: number;
  polygonRotAxis: number;
  polygonReferencePlane: number;
  randomInitVelMag: number;
  endScale: number;
  lifeFrames: number;
  velocityRatio: number;
  scaleRatio: number;
  color: [number, number, number];
  emissionCount: number;
  emissionDelay: number;
  emissionIntervalFrames: number;
  textureIndex: number;
  textureTileCountS: number;
  textureTileCountT: number;
  flipTextureS: boolean;
  flipTextureT: boolean;
  dpolFaceEmitter: boolean;
};

export type SpaBehavior =
  | { type: "gravity"; magnitude: [number, number, number] }
  | { type: "random"; magnitude: [number, number, number]; applyIntervalFrames: number }
  | { type: "magnet"; target: [number, number, number]; force: number }
  | { type: "spin"; axis: number; angle: number }
  | { type: "collision"; y: number; elasticity: number; collisionType: number }
  | { type: "convergence"; target: [number, number, number]; force: number };

export type SpaResource = {
  index: number;
  flags: number;
  drawType: number;
  emissionType: number;
  emissionAxis: number;
  emissionCount: number;
  emitterBasePos: [number, number, number];
  radius: number;
  length: number;
  axis: [number, number, number];
  initVelPosAmplifier: number;
  initVelAxisAmplifier: number;
  baseScale: number;
  aspectRatio: number;
  baseAlpha: number;
  airResistance: number;
  emissionIntervalFrames: number;
  textureIndex: number;
  loopFrames: number;
  textureTileCountS: number;
  textureTileCountT: number;
  scaleAnimDir: number;
  flipTextureS: boolean;
  flipTextureT: boolean;
  polygonX: number;
  polygonY: number;
  minRotation: number;
  maxRotation: number;
  initAngle: number;
  variance: {
    baseScale: number;
    lifeTime: number;
    initVel: number;
  };
  emitterLifeFrames: number;
  particleLifeFrames: number;
  startDelayFrames: number;
  color: [number, number, number];
  hasRotation: boolean;
  randomInitAngle: boolean;
  followEmitter: boolean;
  hideParent: boolean;
  randomizeLoopedAnim: boolean;
  scaleAnim?: SpaScaleAnim;
  colorAnim?: SpaColorAnim;
  alphaAnim?: SpaAlphaAnim;
  texAnim?: SpaTexAnim;
  childResource?: SpaChildResource;
  behaviors: SpaBehavior[];
  rawHeader?: Uint8Array;
};

export type SpaTexture = {
  index: number;
  format: number;
  width: number;
  height: number;
  textureSize: number;
  paletteSize: number;
  paletteIndexSize: number;
  resourceSize: number;
  useSharedTexture: boolean;
  sharedTexId: number;
  rgba: Uint8ClampedArray;
  fallback: boolean;
  fallbackReason?: string;
  palColor0Transparent?: boolean;
  rawBytes?: Uint8Array;
  rawParam?: number;
  sourceChanged?: boolean;
};

export type SpaArchive = {
  resourceCount: number;
  textureCount: number;
  resources: SpaResource[];
  textures: SpaTexture[];
  warnings: SpaWarning[];
  rawHeader?: Uint8Array;
};

export function parseSpaArchive(bytes: Uint8Array): SpaArchive {
  const warnings: SpaWarning[] = [];
  if (bytes.length < 32) throw new Error("SPA file is too small");
  const magic = readU32(bytes, 0);
  if (magic !== SPA_MAGIC) throw new Error(`Wrong SPA magic: ${readAscii(bytes, 0, Math.min(4, bytes.length))}`);

  const rawHeader = bytes.slice(0, 32);
  const resourceCount = readU16(bytes, 8);
  const textureCount = readU16(bytes, 10);
  const textureOffset = readU32(bytes, 24);
  const resources: SpaResource[] = [];
  let cursor = 32;
  for (let index = 0; index < resourceCount; index += 1) {
    if (cursor + RESOURCE_HEADER_SIZE > bytes.length) {
      warnings.push({ message: `Resource ${index} is truncated` });
      break;
    }
    const flags = readU32(bytes, cursor);
    const misc0 = readU32(bytes, cursor + 68);
    const misc1 = readU32(bytes, cursor + 72);
    const misc2 = readU32(bytes, cursor + 76);
    const variance = readU32(bytes, cursor + 64);
    const parsedResource: SpaResource = {
      index,
      flags,
      emissionType: flags & 0x0f,
      drawType: (flags >>> 4) & 0x03,
      emissionAxis: (flags >>> 6) & 0x03,
      emissionCount: Math.max(1, Math.round(fx32(bytes, cursor + 16))),
      emitterBasePos: [fx32(bytes, cursor + 4), fx32(bytes, cursor + 8), fx32(bytes, cursor + 12)],
      radius: fx32(bytes, cursor + 20),
      length: fx32(bytes, cursor + 24),
      axis: normalizeOrDefault([fx16(bytes, cursor + 28), fx16(bytes, cursor + 30), fx16(bytes, cursor + 32)]),
      initVelPosAmplifier: fx32(bytes, cursor + 36),
      initVelAxisAmplifier: fx32(bytes, cursor + 40),
      baseScale: fx32(bytes, cursor + 44),
      aspectRatio: fx16(bytes, cursor + 48) || 1,
      color: rgb555(readU16(bytes, cursor + 34)),
      startDelayFrames: readU16(bytes, cursor + 50),
      emitterLifeFrames: readU16(bytes, cursor + 60) || FRAMES_PER_SECOND,
      particleLifeFrames: readU16(bytes, cursor + 62) || FRAMES_PER_SECOND,
      minRotation: angleFromSigned(readI16(bytes, cursor + 52)),
      maxRotation: angleFromSigned(readI16(bytes, cursor + 54)),
      initAngle: angleFromUnsigned(readU16(bytes, cursor + 56)),
      variance: {
        baseScale: (variance & 0xff) / 255,
        lifeTime: ((variance >>> 8) & 0xff) / 255,
        initVel: ((variance >>> 16) & 0xff) / 255,
      },
      airResistance: 0.75 + (((misc0 >>> 16) & 0xff) / 256) * 0.5,
      emissionIntervalFrames: misc0 & 0xff,
      baseAlpha: alphaByteToUnit((misc0 >>> 8) & 0xff),
      textureIndex: misc0 >>> 24,
      loopFrames: misc1 & 0xff,
      textureTileCountS: (misc1 >>> 24) & 0x03,
      textureTileCountT: (misc1 >>> 26) & 0x03,
      scaleAnimDir: (misc1 >>> 28) & 0x07,
      flipTextureS: (misc2 & 0x01) !== 0,
      flipTextureT: (misc2 & 0x02) !== 0,
      polygonX: fx16(bytes, cursor + 80),
      polygonY: fx16(bytes, cursor + 82),
      hasRotation: (flags & (1 << 12)) !== 0,
      randomInitAngle: (flags & (1 << 13)) !== 0,
      followEmitter: (flags & (1 << 15)) !== 0,
      hideParent: (flags & (1 << 22)) !== 0,
      randomizeLoopedAnim: (flags & (1 << 20)) !== 0,
      behaviors: [],
      rawHeader: bytes.slice(cursor, cursor + RESOURCE_HEADER_SIZE),
    };
    resources.push(parseOptionalResourceBlocks(bytes, cursor + RESOURCE_HEADER_SIZE, parsedResource, warnings));
    cursor += RESOURCE_HEADER_SIZE;
    cursor += optionalResourceBytes(flags);
  }

  if (textureOffset >= TEXTURE_HEADER_SIZE && textureOffset + 4 <= bytes.length) cursor = textureOffset;

  const rawTextures: RawSpaTexture[] = [];
  for (let index = 0; index < textureCount && cursor + TEXTURE_HEADER_SIZE <= bytes.length; index += 1) {
    const headerStart = cursor;
    const textureMagic = readU32(bytes, headerStart);
    if (textureMagic !== SPT_MAGIC) {
      warnings.push({ message: `Texture ${index} has invalid SPT magic` });
      break;
    }
    const param = readU32(bytes, headerStart + 4);
    const textureSize = readU32(bytes, headerStart + 8);
    const paletteOffset = readU32(bytes, headerStart + 12);
    const paletteSize = readU32(bytes, headerStart + 16);
    const paletteIndexOffset = readU32(bytes, headerStart + 20);
    const paletteIndexSize = readU32(bytes, headerStart + 24);
    const resourceSize = readU32(bytes, headerStart + 28);
    const format = param & 0x0f;
    const width = 1 << (((param >>> 4) & 0x0f) + 3);
    const height = 1 << (((param >>> 8) & 0x0f) + 3);
    const palColor0Transparent = ((param >>> 16) & 1) !== 0;
    const useSharedTexture = ((param >>> 17) & 1) !== 0;
    const sharedTexId = (param >>> 18) & 0xff;

    rawTextures.push({
      index,
      param,
      format,
      width,
      height,
      textureSize,
      paletteSize,
      paletteIndexSize,
      resourceSize,
      useSharedTexture,
      sharedTexId,
      palColor0Transparent,
      textureData: bytes.subarray(headerStart + TEXTURE_HEADER_SIZE, Math.min(bytes.length, headerStart + TEXTURE_HEADER_SIZE + textureSize)),
      paletteData: bytes.subarray(headerStart + paletteOffset, Math.min(bytes.length, headerStart + paletteOffset + paletteSize)),
      paletteIndexData: bytes.subarray(headerStart + paletteIndexOffset, Math.min(bytes.length, headerStart + paletteIndexOffset + paletteIndexSize)),
      rawBytes: bytes.slice(headerStart, Math.min(bytes.length, headerStart + Math.max(resourceSize, TEXTURE_HEADER_SIZE))),
    });

    cursor = headerStart + Math.max(resourceSize, TEXTURE_HEADER_SIZE);
  }

  const textures = rawTextures.map((texture) => {
    const source = texture.useSharedTexture ? rawTextures[texture.sharedTexId] : texture;
    const decoded = source
      ? decodeSpaTexture(texture.format, texture.width, texture.height, source.textureData, source.paletteData, texture.palColor0Transparent, source.paletteIndexData)
      : { rgba: fallbackTexture(texture.width, texture.height), fallback: true, fallbackReason: `Shared texture ${texture.sharedTexId} is missing` };
    if (decoded.fallback) warnings.push({ message: `Texture ${texture.index} ${decoded.fallbackReason ?? `uses unsupported or truncated format ${texture.format}`}; using fallback texture` });
    return {
      index: texture.index,
      format: texture.format,
      width: texture.width,
      height: texture.height,
      textureSize: texture.textureSize,
      paletteSize: texture.paletteSize,
      paletteIndexSize: texture.paletteIndexSize,
      resourceSize: texture.resourceSize,
      useSharedTexture: texture.useSharedTexture,
      sharedTexId: texture.sharedTexId,
      rgba: decoded.rgba,
      fallback: decoded.fallback,
      fallbackReason: decoded.fallbackReason,
      palColor0Transparent: texture.palColor0Transparent,
      rawBytes: texture.rawBytes,
      rawParam: texture.param,
    };
  });

  if (textures.length < textureCount) warnings.push({ message: `Expected ${textureCount} texture(s), parsed ${textures.length}` });
  return { resourceCount, textureCount, resources, textures, warnings, rawHeader };
}

type RawSpaTexture = {
  index: number;
  param: number;
  format: number;
  width: number;
  height: number;
  textureSize: number;
  paletteSize: number;
  paletteIndexSize: number;
  resourceSize: number;
  useSharedTexture: boolean;
  sharedTexId: number;
  palColor0Transparent: boolean;
  textureData: Uint8Array;
  paletteData: Uint8Array;
  paletteIndexData: Uint8Array;
  rawBytes: Uint8Array;
};

export function serializeSpaArchive(archive: SpaArchive): Uint8Array {
  const resourceParts = archive.resources.map(serializeResource);
  const textureOffset = 32 + resourceParts.reduce((sum, part) => sum + part.length, 0);
  const textureParts = archive.textures.map(serializeTexture);
  const body = concatBytes([new Uint8Array(32), ...resourceParts, ...textureParts]);
  const out = pad4(body);
  out.set(archive.rawHeader?.slice(0, 32) ?? new Uint8Array(32), 0);
  writeU32(out, 0, SPA_MAGIC);
  writeU16(out, 8, archive.resources.length);
  writeU16(out, 10, archive.textures.length);
  writeU32(out, 16, RESOURCE_HEADER_SIZE);
  writeU32(out, 20, TEXTURE_HEADER_SIZE + 24);
  writeU32(out, 24, textureOffset);
  return out;
}

function serializeResource(resource: SpaResource): Uint8Array {
  const flags = resourceFlags(resource);
  const out = new Uint8Array(RESOURCE_HEADER_SIZE);
  out.set(resource.rawHeader?.slice(0, RESOURCE_HEADER_SIZE) ?? new Uint8Array(RESOURCE_HEADER_SIZE));
  writeU32(out, 0, flags);
  writeFx32(out, 4, resource.emitterBasePos[0]);
  writeFx32(out, 8, resource.emitterBasePos[1]);
  writeFx32(out, 12, resource.emitterBasePos[2]);
  writeFx32(out, 16, Math.max(0, resource.emissionCount));
  writeFx32(out, 20, resource.radius);
  writeFx32(out, 24, resource.length);
  writeFx16(out, 28, resource.axis[0]);
  writeFx16(out, 30, resource.axis[1]);
  writeFx16(out, 32, resource.axis[2]);
  writeU16(out, 34, packRgb555(resource.color));
  writeFx32(out, 36, resource.initVelPosAmplifier);
  writeFx32(out, 40, resource.initVelAxisAmplifier);
  writeFx32(out, 44, resource.baseScale);
  writeFx16(out, 48, resource.aspectRatio);
  writeU16(out, 50, clampInt(resource.startDelayFrames, 0, 0xffff));
  writeI16(out, 52, angleToSigned(resource.minRotation));
  writeI16(out, 54, angleToSigned(resource.maxRotation));
  writeU16(out, 56, angleToUnsigned(resource.initAngle));
  writeU16(out, 60, clampInt(resource.emitterLifeFrames, 1, 0xffff));
  writeU16(out, 62, clampInt(resource.particleLifeFrames, 1, 0xffff));
  writeU32(
    out,
    64,
    clampInt(resource.variance.baseScale * 255, 0, 255) |
      (clampInt(resource.variance.lifeTime * 255, 0, 255) << 8) |
      (clampInt(resource.variance.initVel * 255, 0, 255) << 16),
  );
  const airResistance = clampInt(((resource.airResistance - 0.75) / 0.5) * 256, 0, 255);
  writeU32(
    out,
    68,
    clampInt(resource.emissionIntervalFrames, 0, 255) |
      (clampInt(resource.baseAlpha * 255, 0, 255) << 8) |
      (airResistance << 16) |
      (clampInt(resource.textureIndex, 0, 255) << 24),
  );
  const originalMisc1 = resource.rawHeader && resource.rawHeader.length >= 76 ? readU32(resource.rawHeader, 72) : 0;
  writeU32(
    out,
    72,
    (originalMisc1 & 0x00ffff00) |
      clampInt(resource.loopFrames, 0, 255) |
      (clampInt(resource.textureTileCountS, 0, 3) << 24) |
      (clampInt(resource.textureTileCountT, 0, 3) << 26) |
      (clampInt(resource.scaleAnimDir, 0, 7) << 28),
  );
  const originalMisc2 = resource.rawHeader && resource.rawHeader.length >= 80 ? readU32(resource.rawHeader, 76) : 0;
  writeU32(out, 76, (originalMisc2 & ~0x03) | (resource.flipTextureS ? 0x01 : 0) | (resource.flipTextureT ? 0x02 : 0));
  writeFx16(out, 80, resource.polygonX);
  writeFx16(out, 82, resource.polygonY);

  return concatBytes([out, ...serializeOptionalBlocks(resource)]);
}

function resourceFlags(resource: SpaResource): number {
  const knownMask =
    0x0f |
    (0x03 << 4) |
    (0x03 << 6) |
    (1 << 8) |
    (1 << 9) |
    (1 << 10) |
    (1 << 11) |
    (1 << 12) |
    (1 << 13) |
    (1 << 15) |
    (1 << 16) |
    (1 << 20) |
    (1 << 22) |
    (0x3f << 24);
  let flags = resource.flags & ~knownMask;
  flags |= clampInt(resource.emissionType, 0, 15);
  flags |= clampInt(resource.drawType, 0, 3) << 4;
  flags |= clampInt(resource.emissionAxis, 0, 3) << 6;
  if (resource.scaleAnim) flags |= 1 << 8;
  if (resource.colorAnim) flags |= 1 << 9;
  if (resource.alphaAnim) flags |= 1 << 10;
  if (resource.texAnim) flags |= 1 << 11;
  if (resource.hasRotation) flags |= 1 << 12;
  if (resource.randomInitAngle) flags |= 1 << 13;
  if (resource.followEmitter) flags |= 1 << 15;
  if (resource.childResource) flags |= 1 << 16;
  if (resource.randomizeLoopedAnim) flags |= 1 << 20;
  if (resource.hideParent) flags |= 1 << 22;
  for (const behavior of firstBehaviors(resource).values()) flags |= 1 << behaviorFlagBit(behavior.type);
  return flags >>> 0;
}

function serializeOptionalBlocks(resource: SpaResource): Uint8Array[] {
  const parts: Uint8Array[] = [];
  if (resource.scaleAnim) {
    const out = new Uint8Array(12);
    writeFx16(out, 0, resource.scaleAnim.start);
    writeFx16(out, 2, resource.scaleAnim.mid);
    writeFx16(out, 4, resource.scaleAnim.end);
    out[6] = clampInt(resource.scaleAnim.curveIn * 255, 0, 255);
    out[7] = clampInt(resource.scaleAnim.curveOut * 255, 0, 255);
    writeU16(out, 8, resource.scaleAnim.loop ? 1 : 0);
    parts.push(out);
  }
  if (resource.colorAnim) {
    const out = new Uint8Array(12);
    writeU16(out, 0, packRgb555(resource.colorAnim.start));
    writeU16(out, 2, packRgb555(resource.colorAnim.end));
    out[4] = clampInt(resource.colorAnim.curveIn * 255, 0, 255);
    out[5] = clampInt(resource.colorAnim.curvePeak * 255, 0, 255);
    out[6] = clampInt(resource.colorAnim.curveOut * 255, 0, 255);
    writeU16(out, 8, (resource.colorAnim.randomStartColor ? 1 : 0) | (resource.colorAnim.loop ? 2 : 0) | (resource.colorAnim.interpolate ? 4 : 0));
    parts.push(out);
  }
  if (resource.alphaAnim) {
    const out = new Uint8Array(8);
    writeU16(
      out,
      0,
      clampInt(resource.alphaAnim.start * 31, 0, 31) |
        (clampInt(resource.alphaAnim.mid * 31, 0, 31) << 5) |
        (clampInt(resource.alphaAnim.end * 31, 0, 31) << 10),
    );
    writeU16(out, 2, clampInt(resource.alphaAnim.randomRange * 255, 0, 255) | (resource.alphaAnim.loop ? 0x100 : 0));
    out[4] = clampInt(resource.alphaAnim.curveIn * 255, 0, 255);
    out[5] = clampInt(resource.alphaAnim.curveOut * 255, 0, 255);
    parts.push(out);
  }
  if (resource.texAnim) {
    const out = new Uint8Array(12);
    for (let index = 0; index < 8; index += 1) out[index] = clampInt(resource.texAnim.textures[index] ?? resource.textureIndex, 0, 255);
    writeU32(
      out,
      8,
      clampInt(resource.texAnim.textureCount, 1, 8) |
        (clampInt(resource.texAnim.step * 255, 0, 255) << 8) |
        (resource.texAnim.randomizeInit ? 1 << 16 : 0) |
        (resource.texAnim.loop ? 1 << 17 : 0),
    );
    parts.push(out);
  }
  if (resource.childResource) parts.push(serializeChildResource(resource.childResource));
  const behaviors = firstBehaviors(resource);
  for (const type of ["gravity", "random", "magnet", "spin", "collision", "convergence"] as const) {
    const behavior = behaviors.get(type);
    if (behavior) parts.push(serializeBehavior(behavior));
  }
  return parts;
}

function serializeChildResource(child: SpaChildResource): Uint8Array {
  const out = new Uint8Array(20);
  const flags =
    (child.usesBehaviors ? 0x01 : 0) |
    (child.hasScaleAnim ? 0x02 : 0) |
    (child.hasAlphaAnim ? 0x04 : 0) |
    (clampInt(child.rotationType, 0, 3) << 3) |
    (child.followEmitter ? 1 << 5 : 0) |
    (child.useChildColor ? 1 << 6 : 0) |
    (clampInt(child.drawType, 0, 3) << 7) |
    (clampInt(child.polygonRotAxis, 0, 3) << 9) |
    (clampInt(child.polygonReferencePlane, 0, 1) << 11);
  writeU16(out, 0, flags);
  writeFx16(out, 2, child.randomInitVelMag);
  writeFx16(out, 4, child.endScale);
  writeU16(out, 6, clampInt(child.lifeFrames, 1, 0xffff));
  out[8] = clampInt(child.velocityRatio * 255, 0, 255);
  out[9] = clampInt(child.scaleRatio * 64 - 1, 0, 255);
  writeU16(out, 10, packRgb555(child.color));
  writeU32(
    out,
    12,
    clampInt(child.emissionCount, 0, 255) |
      (clampInt(child.emissionDelay * 255, 0, 255) << 8) |
      (clampInt(child.emissionIntervalFrames, 0, 255) << 16) |
      (clampInt(child.textureIndex, 0, 255) << 24),
  );
  writeU32(
    out,
    16,
    clampInt(child.textureTileCountS, 0, 3) |
      (clampInt(child.textureTileCountT, 0, 3) << 2) |
      (child.flipTextureS ? 1 << 4 : 0) |
      (child.flipTextureT ? 1 << 5 : 0) |
      (child.dpolFaceEmitter ? 1 << 6 : 0),
  );
  return out;
}

function serializeBehavior(behavior: SpaBehavior): Uint8Array {
  if (behavior.type === "gravity") {
    const out = new Uint8Array(8);
    writeFx16(out, 0, behavior.magnitude[0]);
    writeFx16(out, 2, behavior.magnitude[1]);
    writeFx16(out, 4, behavior.magnitude[2]);
    return out;
  }
  if (behavior.type === "random") {
    const out = new Uint8Array(8);
    writeFx16(out, 0, behavior.magnitude[0]);
    writeFx16(out, 2, behavior.magnitude[1]);
    writeFx16(out, 4, behavior.magnitude[2]);
    writeU16(out, 6, clampInt(behavior.applyIntervalFrames, 0, 0xffff));
    return out;
  }
  if (behavior.type === "magnet" || behavior.type === "convergence") {
    const out = new Uint8Array(16);
    writeFx32(out, 0, behavior.target[0]);
    writeFx32(out, 4, behavior.target[1]);
    writeFx32(out, 8, behavior.target[2]);
    writeFx16(out, 12, behavior.force);
    return out;
  }
  if (behavior.type === "spin") {
    const out = new Uint8Array(4);
    writeU16(out, 0, angleToUnsigned(behavior.angle));
    writeU16(out, 2, clampInt(behavior.axis, 0, 0xffff));
    return out;
  }
  const out = new Uint8Array(8);
  writeFx32(out, 0, behavior.y);
  writeFx16(out, 4, behavior.elasticity);
  writeU16(out, 6, clampInt(behavior.collisionType, 0, 3));
  return out;
}

function serializeTexture(texture: SpaTexture): Uint8Array {
  if (!texture.sourceChanged && texture.rawBytes && texture.rawBytes.length >= TEXTURE_HEADER_SIZE) return texture.rawBytes.slice();
  if (texture.format !== 7) throw new Error(`Saving edited SPA texture ${texture.index} as format ${texture.format} is not supported yet`);
  validateTextureDimensions(texture);
  const textureData = encodeDirectTexture(texture.rgba, texture.width, texture.height);
  const out = new Uint8Array(TEXTURE_HEADER_SIZE + textureData.length);
  writeU32(out, 0, SPT_MAGIC);
  writeU32(out, 4, 7 | ((Math.log2(texture.width) - 3) << 4) | ((Math.log2(texture.height) - 3) << 8));
  writeU32(out, 8, textureData.length);
  writeU32(out, 12, TEXTURE_HEADER_SIZE + textureData.length);
  writeU32(out, 16, 0);
  writeU32(out, 20, TEXTURE_HEADER_SIZE + textureData.length);
  writeU32(out, 24, 0);
  writeU32(out, 28, out.length);
  out.set(textureData, TEXTURE_HEADER_SIZE);
  texture.textureSize = textureData.length;
  texture.paletteSize = 0;
  texture.paletteIndexSize = 0;
  texture.resourceSize = out.length;
  texture.useSharedTexture = false;
  texture.sharedTexId = 0;
  texture.rawBytes = out.slice();
  texture.rawParam = readU32(out, 4);
  texture.sourceChanged = false;
  return out;
}

function firstBehaviors(resource: SpaResource): Map<SpaBehavior["type"], SpaBehavior> {
  const out = new Map<SpaBehavior["type"], SpaBehavior>();
  for (const behavior of resource.behaviors) if (!out.has(behavior.type)) out.set(behavior.type, behavior);
  return out;
}

function behaviorFlagBit(type: SpaBehavior["type"]): number {
  if (type === "gravity") return 24;
  if (type === "random") return 25;
  if (type === "magnet") return 26;
  if (type === "spin") return 27;
  if (type === "collision") return 28;
  return 29;
}

function optionalResourceBytes(flags: number): number {
  let size = 0;
  if (flags & (1 << 8)) size += 12;
  if (flags & (1 << 9)) size += 12;
  if (flags & (1 << 10)) size += 8;
  if (flags & (1 << 11)) size += 12;
  if (flags & (1 << 16)) size += 20;
  if (flags & (1 << 24)) size += 8;
  if (flags & (1 << 25)) size += 8;
  if (flags & (1 << 26)) size += 16;
  if (flags & (1 << 27)) size += 4;
  if (flags & (1 << 28)) size += 8;
  if (flags & (1 << 29)) size += 16;
  return size;
}

function parseOptionalResourceBlocks(bytes: Uint8Array, start: number, resource: SpaResource, warnings: SpaWarning[]): SpaResource {
  let cursor = start;
  const need = (size: number, label: string) => {
    if (cursor + size <= bytes.length) return true;
    warnings.push({ message: `Resource ${resource.index} ${label} block is truncated` });
    return false;
  };

  if (resource.flags & (1 << 8)) {
    if (need(12, "scale animation")) {
      resource.scaleAnim = {
        start: fx16(bytes, cursor),
        mid: fx16(bytes, cursor + 2),
        end: fx16(bytes, cursor + 4),
        curveIn: (bytes[cursor + 6] ?? 0) / 255,
        curveOut: (bytes[cursor + 7] ?? 255) / 255,
        loop: (readU16(bytes, cursor + 8) & 1) !== 0,
      };
    }
    cursor += 12;
  }

  if (resource.flags & (1 << 9)) {
    if (need(12, "color animation")) {
      const flags = readU16(bytes, cursor + 8);
      resource.colorAnim = {
        start: rgb555(readU16(bytes, cursor)),
        end: rgb555(readU16(bytes, cursor + 2)),
        curveIn: (bytes[cursor + 4] ?? 0) / 255,
        curvePeak: (bytes[cursor + 5] ?? 127) / 255,
        curveOut: (bytes[cursor + 6] ?? 255) / 255,
        randomStartColor: (flags & 1) !== 0,
        loop: (flags & 2) !== 0,
        interpolate: (flags & 4) !== 0,
      };
    }
    cursor += 12;
  }

  if (resource.flags & (1 << 10)) {
    if (need(8, "alpha animation")) {
      const alpha = readU16(bytes, cursor);
      const flags = readU16(bytes, cursor + 2);
      resource.alphaAnim = {
        start: (alpha & 0x1f) / 31,
        mid: ((alpha >>> 5) & 0x1f) / 31,
        end: ((alpha >>> 10) & 0x1f) / 31,
        randomRange: (flags & 0xff) / 255,
        loop: (flags & 0x100) !== 0,
        curveIn: (bytes[cursor + 4] ?? 0) / 255,
        curveOut: (bytes[cursor + 5] ?? 255) / 255,
      };
    }
    cursor += 8;
  }

  if (resource.flags & (1 << 11)) {
    if (need(12, "texture animation")) {
      const param = readU32(bytes, cursor + 8);
      const textureCount = Math.max(1, Math.min(8, param & 0xff));
      resource.texAnim = {
        textures: Array.from(bytes.subarray(cursor, cursor + 8)),
        textureCount,
        step: ((param >>> 8) & 0xff) / 255,
        randomizeInit: (param & (1 << 16)) !== 0,
        loop: (param & (1 << 17)) !== 0,
      };
    }
    cursor += 12;
  }

  if (resource.flags & (1 << 16)) {
    if (need(20, "child resource")) {
      const flags = readU16(bytes, cursor);
      const misc0 = readU32(bytes, cursor + 12);
      const misc1 = readU32(bytes, cursor + 16);
      resource.childResource = {
        usesBehaviors: (flags & 0x01) !== 0,
        hasScaleAnim: (flags & 0x02) !== 0,
        hasAlphaAnim: (flags & 0x04) !== 0,
        rotationType: (flags >>> 3) & 0x03,
        followEmitter: (flags & (1 << 5)) !== 0,
        useChildColor: (flags & (1 << 6)) !== 0,
        drawType: (flags >>> 7) & 0x03,
        polygonRotAxis: (flags >>> 9) & 0x03,
        polygonReferencePlane: (flags >>> 11) & 0x01,
        randomInitVelMag: fx16(bytes, cursor + 2),
        endScale: fx16(bytes, cursor + 4),
        lifeFrames: readU16(bytes, cursor + 6) || FRAMES_PER_SECOND,
        velocityRatio: (bytes[cursor + 8] ?? 0) / 255,
        scaleRatio: ((bytes[cursor + 9] ?? 0) + 1) / 64,
        color: rgb555(readU16(bytes, cursor + 10)),
        emissionCount: misc0 & 0xff,
        emissionDelay: ((misc0 >>> 8) & 0xff) / 255,
        emissionIntervalFrames: (misc0 >>> 16) & 0xff,
        textureIndex: misc0 >>> 24,
        textureTileCountS: misc1 & 0x03,
        textureTileCountT: (misc1 >>> 2) & 0x03,
        flipTextureS: (misc1 & (1 << 4)) !== 0,
        flipTextureT: (misc1 & (1 << 5)) !== 0,
        dpolFaceEmitter: (misc1 & (1 << 6)) !== 0,
      };
    }
    cursor += 20;
  }

  if (resource.flags & (1 << 24)) {
    if (need(8, "gravity behavior")) {
      resource.behaviors.push({ type: "gravity", magnitude: [fx16(bytes, cursor), fx16(bytes, cursor + 2), fx16(bytes, cursor + 4)] });
    }
    cursor += 8;
  }

  if (resource.flags & (1 << 25)) {
    if (need(8, "random behavior")) {
      resource.behaviors.push({ type: "random", magnitude: [fx16(bytes, cursor), fx16(bytes, cursor + 2), fx16(bytes, cursor + 4)], applyIntervalFrames: readU16(bytes, cursor + 6) });
    }
    cursor += 8;
  }

  if (resource.flags & (1 << 26)) {
    if (need(16, "magnet behavior")) {
      resource.behaviors.push({ type: "magnet", target: [fx32(bytes, cursor), fx32(bytes, cursor + 4), fx32(bytes, cursor + 8)], force: fx16(bytes, cursor + 12) });
    }
    cursor += 16;
  }

  if (resource.flags & (1 << 27)) {
    if (need(4, "spin behavior")) {
      resource.behaviors.push({ type: "spin", angle: angleFromUnsigned(readU16(bytes, cursor)), axis: readU16(bytes, cursor + 2) });
    }
    cursor += 4;
  }

  if (resource.flags & (1 << 28)) {
    if (need(8, "collision behavior")) {
      resource.behaviors.push({ type: "collision", y: fx32(bytes, cursor), elasticity: fx16(bytes, cursor + 4), collisionType: readU16(bytes, cursor + 6) & 0x03 });
    }
    cursor += 8;
  }

  if (resource.flags & (1 << 29)) {
    if (need(16, "convergence behavior")) {
      resource.behaviors.push({ type: "convergence", target: [fx32(bytes, cursor), fx32(bytes, cursor + 4), fx32(bytes, cursor + 8)], force: fx16(bytes, cursor + 12) });
    }
    cursor += 16;
  }

  return resource;
}

function decodeSpaTexture(
  format: number,
  width: number,
  height: number,
  textureData: Uint8Array,
  paletteData: Uint8Array,
  palColor0Transparent: boolean,
  paletteIndexData?: Uint8Array,
): { rgba: Uint8ClampedArray; fallback: boolean; fallbackReason?: string } {
  const pixelCount = width * height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  const palette = readPalette(paletteData);
  const fallback = (fallbackReason: string) => ({ rgba: fallbackTexture(width, height), fallback: true, fallbackReason });
  if (format !== 7 && palette.length === 0) return fallback("has no palette data");

  if (format === 2) {
    if (textureData.length < Math.ceil(pixelCount / 4)) return fallback(`format ${format} texture data is truncated`);
    for (let i = 0; i < pixelCount; i += 1) writeIndexedPixel(rgba, i, (textureData[i >> 2] >>> ((i & 3) * 2)) & 0x03, palette, palColor0Transparent);
    return { rgba, fallback: false };
  }

  if (format === 3) {
    if (textureData.length < Math.ceil(pixelCount / 2)) return fallback(`format ${format} texture data is truncated`);
    for (let i = 0; i < pixelCount; i += 1) writeIndexedPixel(rgba, i, (textureData[i >> 1] >>> ((i & 1) * 4)) & 0x0f, palette, palColor0Transparent);
    return { rgba, fallback: false };
  }

  if (format === 4) {
    if (textureData.length < pixelCount) return fallback(`format ${format} texture data is truncated`);
    for (let i = 0; i < pixelCount; i += 1) writeIndexedPixel(rgba, i, textureData[i] ?? 0, palette, palColor0Transparent);
    return { rgba, fallback: false };
  }

  if (format === 1) {
    if (textureData.length < pixelCount) return fallback(`format ${format} texture data is truncated`);
    for (let i = 0; i < pixelCount; i += 1) {
      const packed = textureData[i] ?? 0;
      const color = palette[packed & 0x1f] ?? [255, 255, 255, 255];
      writePixel(rgba, i, color[0], color[1], color[2], ((packed >>> 5) * 255) / 7);
    }
    return { rgba, fallback: false };
  }

  if (format === 6) {
    if (textureData.length < pixelCount) return fallback(`format ${format} texture data is truncated`);
    for (let i = 0; i < pixelCount; i += 1) {
      const packed = textureData[i] ?? 0;
      const color = palette[packed & 0x07] ?? [255, 255, 255, 255];
      writePixel(rgba, i, color[0], color[1], color[2], ((packed >>> 3) * 255) / 31);
    }
    return { rgba, fallback: false };
  }

  if (format === 5) {
    if (textureData.length < pixelCount / 4) return fallback("Comp4x4 texture data is truncated");
    if (!paletteIndexData || paletteIndexData.length < pixelCount / 8) return fallback("Comp4x4 palette index data is missing or truncated");
    decodeComp4x4(rgba, width, height, textureData, palette, paletteIndexData);
    return { rgba, fallback: false };
  }

  if (format === 7) {
    if (textureData.length < pixelCount * 2) return fallback(`format ${format} texture data is truncated`);
    for (let i = 0; i < pixelCount; i += 1) {
      const color = rgb555(readU16(textureData, i * 2));
      writePixel(rgba, i, color[0] * 255, color[1] * 255, color[2] * 255, readU16(textureData, i * 2) & 0x8000 ? 255 : 0);
    }
    return { rgba, fallback: false };
  }

  return fallback(`uses unsupported format ${format}`);
}

function decodeComp4x4(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  textureData: Uint8Array,
  palette: Array<[number, number, number, number]>,
  paletteIndexData: Uint8Array,
): void {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  for (let blockY = 0; blockY < blocksY; blockY += 1) {
    for (let blockX = 0; blockX < blocksX; blockX += 1) {
      const blockIndex = blockY * blocksX + blockX;
      const texelBits = readU32(textureData, blockIndex * 4);
      const paletteInfo = readU16(paletteIndexData, blockIndex * 2);
      const mode = paletteInfo >>> 14;
      const paletteBase = (paletteInfo & 0x3fff) << 1;
      const colors = comp4x4Colors(palette, paletteBase, mode);
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          const px = blockX * 4 + x;
          const py = blockY * 4 + y;
          if (px >= width || py >= height) continue;
          const index = (texelBits >>> ((y * 4 + x) * 2)) & 0x03;
          const color = colors[index] ?? [255, 0, 255, 255];
          writePixel(rgba, py * width + px, color[0], color[1], color[2], color[3]);
        }
      }
    }
  }
}

function comp4x4Colors(palette: Array<[number, number, number, number]>, paletteBase: number, mode: number): Array<[number, number, number, number]> {
  const c0 = palette[paletteBase] ?? [0, 0, 0, 0];
  const c1 = palette[paletteBase + 1] ?? c0;
  const c2 = palette[paletteBase + 2] ?? c1;
  const c3 = palette[paletteBase + 3] ?? c2;
  if (mode === 0) return [c0, c1, c2, [0, 0, 0, 0]];
  if (mode === 1) return [c0, c1, mixColor(c0, c1, 1, 1), [0, 0, 0, 0]];
  if (mode === 2) return [c0, c1, c2, c3];
  return [c0, c1, mixColor(c0, c1, 5, 3), mixColor(c0, c1, 3, 5)];
}

function mixColor(a: [number, number, number, number], b: [number, number, number, number], aw: number, bw: number): [number, number, number, number] {
  const total = aw + bw;
  return [
    (a[0] * aw + b[0] * bw) / total,
    (a[1] * aw + b[1] * bw) / total,
    (a[2] * aw + b[2] * bw) / total,
    (a[3] * aw + b[3] * bw) / total,
  ];
}

function encodeDirectTexture(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const pixelCount = width * height;
  if (rgba.length < pixelCount * 4) throw new Error(`Direct-color texture data is truncated: expected ${pixelCount * 4} RGBA bytes`);
  const out = new Uint8Array(pixelCount * 2);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const r = Math.round((rgba[offset] / 255) * 31);
    const g = Math.round((rgba[offset + 1] / 255) * 31);
    const b = Math.round((rgba[offset + 2] / 255) * 31);
    const a = rgba[offset + 3] >= 128 ? 0x8000 : 0;
    writeU16(out, index * 2, a | (b << 10) | (g << 5) | r);
  }
  return out;
}

function validateTextureDimensions(texture: SpaTexture): void {
  if (!isDsTextureDimension(texture.width) || !isDsTextureDimension(texture.height)) {
    throw new Error(`Texture ${texture.index} must be power-of-two dimensions between 8 and 1024 pixels to save as SPA`);
  }
}

function isDsTextureDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 8 && value <= 1024 && (value & (value - 1)) === 0;
}

function writeIndexedPixel(rgba: Uint8ClampedArray, index: number, colorIndex: number, palette: Array<[number, number, number, number]>, palColor0Transparent: boolean): void {
  const color = palette[colorIndex] ?? [255, 255, 255, 255];
  writePixel(rgba, index, color[0], color[1], color[2], colorIndex === 0 && palColor0Transparent ? 0 : color[3]);
}

function writePixel(rgba: Uint8ClampedArray, index: number, r: number, g: number, b: number, a: number): void {
  const offset = index * 4;
  rgba[offset] = r;
  rgba[offset + 1] = g;
  rgba[offset + 2] = b;
  rgba[offset + 3] = a;
}

function readPalette(bytes: Uint8Array): Array<[number, number, number, number]> {
  const colors: Array<[number, number, number, number]> = [];
  for (let offset = 0; offset + 1 < bytes.length; offset += 2) {
    const [r, g, b] = rgb555(readU16(bytes, offset));
    colors.push([r * 255, g * 255, b * 255, 255]);
  }
  return colors;
}

function fallbackTexture(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const on = ((x >> 3) + (y >> 3)) % 2 === 0;
      writePixel(rgba, y * width + x, on ? 255 : 30, on ? 0 : 30, on ? 255 : 30, 220);
    }
  }
  return rgba;
}

function rgb555(value: number): [number, number, number] {
  return [expand5(value & 0x1f), expand5((value >>> 5) & 0x1f), expand5((value >>> 10) & 0x1f)];
}

function packRgb555(color: [number, number, number]): number {
  return clampInt(color[0] * 31, 0, 31) | (clampInt(color[1] * 31, 0, 31) << 5) | (clampInt(color[2] * 31, 0, 31) << 10);
}

function alphaByteToUnit(value: number): number {
  return value <= 31 ? value / 31 : value / 255;
}

function expand5(value: number): number {
  return ((value << 3) | (value >>> 2)) / 255;
}

function fx32(bytes: Uint8Array, offset: number): number {
  return readI32(bytes, offset) / 4096;
}

function fx16(bytes: Uint8Array, offset: number): number {
  return readI16(bytes, offset) / 4096;
}

function writeFx32(out: Uint8Array, offset: number, value: number): void {
  writeU32(out, offset, Math.round(value * 4096) >>> 0);
}

function writeFx16(out: Uint8Array, offset: number, value: number): void {
  writeU16(out, offset, Math.round(value * 4096) & 0xffff);
}

function readI16(bytes: Uint8Array, offset: number): number {
  const value = readU16(bytes, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

function readI32(bytes: Uint8Array, offset: number): number {
  return readU32(bytes, offset) | 0;
}

function writeI16(out: Uint8Array, offset: number, value: number): void {
  writeU16(out, offset, value & 0xffff);
}

function angleFromUnsigned(value: number): number {
  return (value / 65535) * Math.PI * 2;
}

function angleFromSigned(value: number): number {
  const angle = (value / 65535) * Math.PI * 2;
  return angle > Math.PI ? angle - Math.PI * 2 : angle;
}

function angleToUnsigned(value: number): number {
  const turns = ((value / (Math.PI * 2)) % 1 + 1) % 1;
  return clampInt(turns * 65535, 0, 65535);
}

function angleToSigned(value: number): number {
  let normalized = value;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return Math.max(-0x8000, Math.min(0x7fff, Math.round((normalized / (Math.PI * 2)) * 65535)));
}

function normalizeOrDefault(value: [number, number, number]): [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length < 0.00001) return [0, 1, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value : min)));
}
