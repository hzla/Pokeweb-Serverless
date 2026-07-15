import { readAscii } from "../nds/binary";
import {
  buildModelPrimitives,
  buildNitroTexturePreviews,
  readNitroResources,
  type Map3dBounds,
  type Map3dPrimitive,
  type NitroTexturePreview,
} from "./map3dModel";

export type BattleModelScene = {
  resourceId: number;
  primitives: Map3dPrimitive[];
  bounds: Map3dBounds;
  primitiveCount: number;
  triangleCount: number;
  textureCount: number;
  textures: NitroTexturePreview[];
  materialTextureNames: string[];
  warnings: string[];
};

export function decodeBattleModelScene(bytes: Uint8Array, resourceId: number): BattleModelScene {
  if (readAscii(bytes, 0, Math.min(4, bytes.length)) !== "BMD0") {
    throw new Error(`Battle graphics resource ${resourceId} is not an NSBMD model.`);
  }
  const warnings: string[] = [];
  const resources = readNitroResources(bytes);
  const primitives = buildModelPrimitives(resources, warnings, { recoverSkippedPieces: true });
  const textures = buildNitroTexturePreviews(resources);
  if (primitives.length === 0) throw new Error(`Battle graphics resource ${resourceId} contains no renderable model geometry.`);
  return buildBattleModelScene(
    resourceId,
    primitives,
    textures,
    resources.models.flatMap((model) =>
      model.materials.map((material) => material.textureName).filter((name): name is string => Boolean(name)),
    ),
    warnings,
  );
}

export function buildBattleModelScene(
  resourceId: number,
  primitives: Map3dPrimitive[],
  textures: NitroTexturePreview[],
  materialTextureNames: string[],
  warnings: string[] = [],
): BattleModelScene {
  return {
    resourceId,
    primitives,
    bounds: primitiveBounds(primitives),
    primitiveCount: primitives.length,
    triangleCount: primitives.reduce((sum, primitive) => sum + primitive.indices.length / 3, 0),
    textureCount: textures.length,
    textures,
    materialTextureNames,
    warnings,
  };
}

function primitiveBounds(primitives: Map3dPrimitive[]): Map3dBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const primitive of primitives) {
    for (let index = 0; index + 2 < primitive.positions.length; index += 3) {
      const x = primitive.positions[index] ?? 0;
      const y = primitive.positions[index + 1] ?? 0;
      const z = primitive.positions[index + 2] ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}
