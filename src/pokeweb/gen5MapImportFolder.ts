import type { Gen5MapImportInput } from "./gen5MapImport";
import { readAscii } from "../nds/binary";
import { hasGen5MapBinSignature, readGen5MapBin, validateMapNitro } from "./gen5MapImportFormats";

export type MapImportComponent = "bin" | "model" | "textures" | "permissions" | "secondaryPermissions";
export type MapImportFile = Pick<File, "name" | "size" | "arrayBuffer"> & { webkitRelativePath?: string; slice?: File["slice"] };
export type MapImportFiles = Partial<Record<MapImportComponent, MapImportFile>>;
export type MapFolderChoice = { label: string; files: MapImportFiles; metadata?: MapImportFile; notes: string[] };
export const mapImportFilePath = (file: MapImportFile) => (file.webkitRelativePath || file.name).replace(/\\/gu, "/");
const directory = (file: MapImportFile) => mapImportFilePath(file).split("/").slice(0, -1).join("/").toLowerCase();
const stem = (file: MapImportFile) => file.name.replace(/\.[^.]+$/u, "").toLowerCase();
const projectStem = (name: string) => name.replace(/_\d+_\d+$/u, "");
const limit = 64 * 1024 * 1024;

export async function readMapImportFile(file: MapImportFile): Promise<Uint8Array> {
  if (file.size > limit) throw new Error("Choose component files smaller than 64 MB.");
  return new Uint8Array(await file.arrayBuffer());
}
async function prefix(file: MapImportFile, length: number) {
  return file.slice ? new Uint8Array(await file.slice(0, length).arrayBuffer()) : (await readMapImportFile(file)).subarray(0, length);
}

/** Discover exports from names only; ignore authoring geometry/images and never fetch assets. */
export async function findMapFolderImports(selected: MapImportFile[]): Promise<MapFolderChoice[]> {
  const files = selected.filter(f => /\.(bin|nsbmd|nsbtx|per|pdsmap)$/iu.test(f.name) && !mapImportFilePath(f).split("/").some(p => p.startsWith(".") || p === "__MACOSX"));
  const paths = files.map(f => mapImportFilePath(f).toLowerCase());
  if (new Set(paths).size !== paths.length) throw new Error("The folder contains duplicate file names differing only in case. Choose files individually.");
  const extension = (ext: string) => files.filter(f => f.name.toLowerCase().endsWith(ext));
  const bins: MapImportFile[] = [];
  for (const file of extension(".bin")) if (hasGen5MapBinSignature(await prefix(file, 4))) bins.push(file);
  const models = extension(".nsbmd"), permissions = extension(".per"), metadata = extension(".pdsmap"), choices: MapFolderChoice[] = [];
  const match = (list: MapImportFile[], anchor: MapImportFile, names: string[]) => list.filter(f => directory(f) === directory(anchor) && names.includes(stem(f)));
  const sourceMap = (anchor: MapImportFile, per?: MapImportFile) => {
    const found = match(metadata, anchor, [projectStem(stem(anchor)), ...(per ? [projectStem(stem(per))] : [])]);
    return found.length === 1 ? found[0] : undefined;
  };
  for (const bin of bins) choices.push({ label: mapImportFilePath(bin), files: { bin }, metadata: sourceMap(bin), notes: [] });
  for (const model of models) {
    if (match(bins, model, [stem(model)]).length) continue;
    const sameFolder = permissions.filter(f => directory(f) === directory(model));
    // PDSMS writes Name_XX_YY.per and Name2_XX_YY.per for the two walking layers.
    const primary = sameFolder.filter(f => stem(f) === stem(model) || projectStem(stem(f)) === stem(model));
    const isSecond = (file: MapImportFile) => sameFolder.some(p => secondaryStem(stem(p)) === stem(file));
    const fallback = sameFolder.filter(f => !isSecond(f));
    const matched = primary.length ? primary : models.filter(f => directory(f) === directory(model)).length === 1 && fallback.length === 1 ? fallback : [];
    for (const per of matched.length ? matched : [undefined]) {
      const secondary = per && match(permissions, per, [secondaryStem(stem(per))]);
      const notes: string[] = [];
      if (!per && sameFolder.length) notes.push("No unambiguous collision file matches this export. Choose Collision / heights individually.");
      choices.push({ label: mapImportFilePath(model) + (per && matched.length > 1 ? ` · ${per.name}` : ""), files: { model, ...(per ? { permissions: per } : {}), ...(secondary?.length === 1 ? { secondaryPermissions: secondary[0] } : {}) }, metadata: sourceMap(model, per), notes });
    }
  }
  if (!choices.length) throw new Error("No native Gen 5 map export found. Choose a folder containing an NSBMD or Gen 5 map BIN; PDSMAP/OBJ/IMD files need a native export first.");
  return choices.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}
function secondaryStem(name: string) {
  const coords = /^(.*?)(_\d+_\d+)$/u.exec(name);
  return coords ? coords[1] + "2" + coords[2] : name + "2";
}

/** Inspect just the chosen model/project; do not load every export in a large folder. */
export async function resolveMapFolderImport(choice: MapFolderChoice, selected: MapImportFile[]) {
  const files: MapImportFiles = { ...choice.files }, anchor = files.model || files.bin!, notes = [...choice.notes];
  let embeddedTextures = false, game: Gen5MapImportInput["game"] | undefined;
  const model = files.model ? await readMapImportFile(files.model) : readGen5MapBin(await readMapImportFile(files.bin!)).files[0];
  embeddedTextures = validateMapNitro(model, "BMD0").some(b => readAscii(b, 0, 4) === "TEX0");
  const textures = selected.filter(f => f.name.toLowerCase().endsWith(".nsbtx") && directory(f) === directory(anchor) && !f.name.startsWith("."));
  const names = [stem(anchor), projectStem(stem(anchor)), ...(files.permissions ? [projectStem(stem(files.permissions))] : [])];
  const exact = textures.filter(f => names.includes(stem(f)));
  if (exact.length === 1) files.textures = exact[0];
  else if (!exact.length && !embeddedTextures && textures.length === 1) files.textures = textures[0];
  else if (exact.length > 1 || !embeddedTextures && textures.length > 1) notes.push("Several texture files match. Choose Textures individually.");
  if (choice.metadata) {
    const text = new TextDecoder().decode(await prefix(choice.metadata, 4096)).replace(/^\uFEFF/u, "");
    const value = /^gameindex\s*\r?\n\s*(\d+)\s*$/mu.exec(text)?.[1];
    if (value !== undefined) {
      const index = Number(value);
      if (index <= 4) throw new Error("This is a Gen 4 project. Export or convert it to Gen 5 before using the native map importer.");
      if (index <= 8) game = index < 7 ? "BW" : "BW2";
    }
  }
  // A complete folder export without a second PER must not inherit stale walking surfaces.
  return { files, game, embeddedTextures, removeSecond: !!files.permissions && !files.secondaryPermissions && !files.bin, notes };
}
