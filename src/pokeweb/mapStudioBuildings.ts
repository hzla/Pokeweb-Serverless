import { readAscii, readU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import type { Gen5MapImportInput } from "./gen5MapImport";
import { buildModelPrimitives, decodeTexture, readNitroResources, type Map3dPrimitive } from "./map3dModel";
import { studioAssert, studioSidecar, type StudioChunk, type StudioWorkspace } from "./mapStudioFormats";
import { readStudioGen4Buildings } from "./mapStudioGen4";
import { emptyTextures } from "./mapStudioNative";
import { writeStaticNitroModel } from "./nitroModelWriter";
import { materialRecords, replaceMaterialRecords } from "./nitroResourceWriter";
import { appendNitroTextures, encodeNitroTexture } from "./nitroTextureWriter";

const root = "mapstudio-buildings/";
const modelPath = (area: number, model: number) => `${root}${area}/${model}.nsbmd`;
const texturePath = (area: number) => `${root}${area}/textures.nsbtx`;

/** Extract only referenced resources. The ROM itself is never saved in the project. */
export function readStudioBuildingSource(workspace: StudioWorkspace, bytes: Uint8Array): Record<string, Uint8Array> {
  const code = readAscii(bytes, 12, 3), hgss = ["IPK", "IPG"].includes(code), dp = ["ADA", "APA", "CPU"].includes(code);
  studioAssert(hgss || dp, "Choose the Gen 4 source ROM that contains this project's buildings.");
  const rom = new NintendoDSRom(bytes, { fileData: "view" });
  const areas = new NARC(rom.getFileByName(hgss ? "a/0/4/2" : "fielddata/areadata/area_data.narc")).files;
  const exterior = new NARC(rom.getFileByName(hgss ? "a/0/4/0" : "fielddata/build_model/build_model.narc")).files;
  const interior = hgss ? new NARC(rom.getFileByName("a/1/4/8")).files : exterior;
  const textures = new NARC(rom.getFileByName(hgss ? "a/0/7/0" : "fielddata/areadata/area_build_model/areabm_texset.narc")).files;
  const files: Record<string, Uint8Array> = Object.create(null);
  for (const chunk of workspace.map.chunks) {
    const bld = studioSidecar(workspace, chunk, "bld"); if (!bld?.length) continue;
    const area = areas[chunk.area]; studioAssert(area && area.length >= 8, `Source ROM is missing area ${chunk.area}.`);
    const models = hgss && area[6] === 0 ? interior : exterior;
    const pack = textures[readU16(area, 0)]; studioAssert(pack, `Source ROM is missing building textures for area ${chunk.area}.`);
    files[texturePath(chunk.area)] = pack.slice();
    for (const placement of readStudioGen4Buildings(bld)) {
      const model = models[placement.model]; studioAssert(model && readAscii(model, 0, 4) === "BMD0", `Source ROM is missing building ${placement.model} in area ${chunk.area}.`);
      files[modelPath(chunk.area, placement.model)] = model.slice();
    }
  }
  studioAssert(Object.keys(files).length, "This project has no Gen 4 building placements.");
  return files;
}

export function compileStudioBuildings(workspace: StudioWorkspace, chunk: StudioChunk): Gen5MapImportInput["buildings"] {
  const bld = studioSidecar(workspace, chunk, "bld"); if (!bld) return undefined;
  // Gen 5 BLD exports use their native counted 16-byte records. Do not reinterpret them as Gen 4.
  if (workspace.map.game >= 5 && studioSidecar(workspace, chunk, "per")?.length !== 2048) return undefined;
  const source = readStudioGen4Buildings(bld), assets: NonNullable<Gen5MapImportInput["buildings"]>["assets"] = [];
  const keys = new Map<string, number>();
  const placements = source.map(placement => {
    const key = `${placement.model}:${placement.scale.join(",")}`;
    if (!keys.has(key)) {
      let model = workspace.files[modelPath(chunk.area, placement.model)];
      studioAssert(model, `Load the Gen 4 building source ROM before inserting building ${placement.model}.`);
      const resources = readNitroResources(model), pack = workspace.files[texturePath(chunk.area)];
      if (pack) { const external = readNitroResources(pack); resources.textures.push(...external.textures); resources.palettes.push(...external.palettes); }
      const images = [], records = materialRecords(model);
      // Encode only bound images: unused Gen 4 area textures must not consume Gen 5 VRAM.
      const imageKeys = new Map<string, string>();
      for (const record of records) {
        if (!record.textureName) continue;
        const pair = `${record.textureName}:${record.paletteName ?? ""}`;
        let name = imageKeys.get(pair);
        if (!name) {
          const texture = resources.textures.find(t => t.name === record.textureName), palette = resources.palettes.find(p => p.name === record.paletteName);
          const image = texture && decodeTexture(texture, palette);
          studioAssert(image, `Building ${placement.model} is missing texture ${record.textureName} in source area ${chunk.area}.`);
          name = `ms_b_${imageKeys.size}`; imageKeys.set(pair, name);
          images.push(encodeNitroTexture({ name, width: image.width, height: image.height, rgba: image.rgba }));
        }
        record.textureName = name; record.paletteName = name;
      }
      if (placement.scale.some(n => n !== 1)) {
        studioAssert(placement.scale.every(n => Number.isFinite(n) && n > 0), "Building scale must be positive.");
        const warnings: string[] = [], primitives = buildModelPrimitives(resources, warnings, { includeHiddenMaterials: true });
        studioAssert(!warnings.length, `Building ${placement.model}: ${warnings.join("; ")}`);
        model = writeStaticNitroModel(model, primitives.map(p => ({ ...p, uvs: p.uvs ?? new Float32Array(p.positions.length / 3 * 2), materialName: p.material.name, positions: p.positions.map((v, i) => v * placement.scale[i % 3]) })));
      }
      model = replaceMaterialRecords(model, records);
      keys.set(key, assets.length); assets.push({ model, textures: appendNitroTextures(emptyTextures(), images) });
    }
    // Both formats use 16 game units per tile; Gen 5 stores the map's Z axis inverted.
    return { asset: keys.get(key)!, x: placement.x * 16, y: placement.y * 16, z: -placement.z * 16, rotationY: 0 };
  });
  return { assets, placements };
}

export function previewStudioBuildings(workspace: StudioWorkspace, chunk: StudioChunk): Map3dPrimitive[] {
  const bld = studioSidecar(workspace, chunk, "bld"); if (!bld) return [];
  if (workspace.map.game >= 5 && studioSidecar(workspace, chunk, "per")?.length !== 2048) return [];
  const result: Map3dPrimitive[] = [], cache = new Map<number, Map3dPrimitive[]>();
  for (const placement of readStudioGen4Buildings(bld)) {
    const bytes = workspace.files[modelPath(chunk.area, placement.model)]; if (!bytes) continue;
    if (!cache.has(placement.model)) {
      const resources = readNitroResources(bytes), textures = workspace.files[texturePath(chunk.area)];
      if (textures) { const external = readNitroResources(textures); resources.textures.push(...external.textures); resources.palettes.push(...external.palettes); }
      const warnings: string[] = [], primitives = buildModelPrimitives(resources, warnings); studioAssert(!warnings.length, warnings.join("; ")); cache.set(placement.model, primitives);
    }
    const offset = [placement.x, placement.y, placement.z];
    for (const p of cache.get(placement.model)!) result.push({ ...p, positions: p.positions.map((v, i) => v / 16 * placement.scale[i % 3] + offset[i % 3]) });
  }
  return result;
}
