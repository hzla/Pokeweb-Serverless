import { readU32, writeU16, writeU32 } from '../nds/binary';
import { readDictionary, nitroBlocks, writeDictionary, replaceMaterialRecords, writeNitroFile, type NativeMaterialRecord } from './nitroResourceWriter';
import { appendNitroTextures, type EncodedTexture, type EncodedPalette } from './nitroTextureWriter';
import { writeStaticNitroModel, type StaticModelMesh } from './nitroModelWriter';
/** A minimal identity model, constructed from the documented resource layout. */
function emptyModel() {
  const dictionary = (name: string, offset = 0) => {
    const data = new Uint8Array(4);
    writeU32(data, 0, offset);
    return writeDictionary([{ name, data }], 4);
  };
  const node = dictionary('root', 40), material = dictionary('material', 76), empty = writeDictionary([], 4);
  const mats = new Uint8Array(120);
  writeU16(mats, 0, 44);
  writeU16(mats, 2, 60);
  mats.set(material, 4);
  mats.set(empty, 44);
  mats.set(empty, 60);
  writeU16(mats, 78, 44);
  const sbc = [2, 0, 1, 6, 0, 0, 0, 11, 1], mat = 120, shape = mat + mats.length;
  const model = new Uint8Array(shape + empty.length + 84);
  writeU32(model, 0, model.length);
  writeU32(model, 4, 108);
  writeU32(model, 8, mat);
  writeU32(model, 12, shape);
  writeU32(model, 16, shape + empty.length);
  model[23] = model[24] = model[26] = 1;
  writeU32(model, 28, 4096);
  writeU32(model, 32, 4096);
  model.set(node, 64);
  writeU16(model, 104, 7);
  model.set(sbc, 108);
  model.set(mats, mat);
  model.set(empty, shape);
  const dict = dictionary('stage', 48), mdl = new Uint8Array(8 + dict.length + model.length);
  mdl.set(new TextEncoder().encode('MDL0'));
  writeU32(mdl, 4, mdl.length);
  mdl.set(dict, 8);
  mdl.set(model, 48);
  const header = new Uint8Array(16);
  header.set(new TextEncoder().encode('BMD0'));
  writeU16(header, 4, 0xfeff);
  writeU16(header, 6, 2);
  writeU16(header, 12, 16);
  const tex = new Uint8Array(96);
  tex.set(new TextEncoder().encode('TEX0'));
  writeU32(tex, 4, 96);
  writeU16(tex, 14, 60);
  writeU16(tex, 30, 60);
  writeU32(tex, 52, 76);
  for (const at of [20, 36, 40, 56])
    writeU32(tex, at, 96);
  tex.set(empty, 60);
  tex.set(empty, 76);
  return writeNitroFile(header, [mdl, tex]);
}
export function createCutsceneStaticModel(meshes: StaticModelMesh[], materials: NativeMaterialRecord[], textures: EncodedTexture[],palettes:EncodedPalette[] = []) {
  const template = appendNitroTextures(replaceMaterialRecords(emptyModel(), materials), textures,palettes);
  return writeStaticNitroModel(template, meshes);
}

/** One root joint followed by a native full-camera billboard, anchored at its feet. */
export function createCutsceneBillboardModel(mesh: StaticModelMesh, material: NativeMaterialRecord, textures: EncodedTexture[]) {
  const file = createCutsceneStaticModel([mesh], [material], textures), blocks = nitroBlocks(file), mdl = blocks[0];
  const base = readU32(readDictionary(mdl,8)[0].data,0), sbc = base + readU32(mdl,base+4), insert = sbc+7;
  if (![2,0,1,6,0,0,0,11].every((n,i)=>mdl[sbc+i]===n)) throw new Error('Unsupported actor model command layout.');
  const output = new Uint8Array(mdl.length+4); output.set(mdl.subarray(0,insert)); output.set([7,0,0,0],insert); output.set(mdl.subarray(insert),insert+4);
  for (const at of [4,base,base+8,base+12,base+16]) writeU32(output,at,readU32(mdl,at)+4);
  blocks[0] = output; return writeNitroFile(file,blocks);
}
