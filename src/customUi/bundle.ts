import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { NARC } from "../nds/narc";
import type { Compilation, Tiles } from "./compiler";
import type { Project } from "./document";
import { decodePng } from "./assets";
import { parseDocument } from "./validate";

export const ARCHIVE_PATH = "pokeweb/custom-ui.narc";
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
export function exportBundle(project: Project): Uint8Array {
  parseDocument(project.document);
  const files: Record<string, Uint8Array> = { "project.json": strToU8(JSON.stringify(project.document, null, 2)) };
  for (const a of project.document.assets) {
    const bytes = project.files[a.path]; if (!bytes) throw new Error(`Missing imported PNG: ${a.name}`);
    files[a.path] = bytes;
  }
  // ZIP timestamps must not change the content digest or produce spurious updates.
  return zipSync(files, { level: 6, mtime: new Date(2000, 0, 1) });
}
export function importBundle(bytes: Uint8Array): Project {
  if (bytes.length > MAX_BUNDLE_BYTES) throw new Error("Custom UI bundle exceeds 32 MiB.");
  let total = 0, count = 0; const names = new Set<string>();
  const files = unzipSync(bytes, { filter(file) {
    if (++count > 129 || !/^(project\.json|assets\/[a-zA-Z0-9_-]+\.png)$/.test(file.name)) throw new Error("Bundle contains unsupported files or paths.");
    if (names.has(file.name)) throw new Error("Bundle contains duplicate filenames."); names.add(file.name);
    total += file.originalSize; if (total > MAX_BUNDLE_BYTES || file.originalSize < 0) throw new Error("Expanded bundle exceeds 32 MiB.");
    return true;
  } });
  if (!files["project.json"] || files["project.json"].length > 1024 * 1024) throw new Error("Bundle must contain project.json (at most 1 MiB).");
  const document = parseDocument(JSON.parse(strFromU8(files["project.json"])));
  delete files["project.json"];
  const paths = new Set(document.assets.map(a => a.path));
  if (Object.keys(files).some(path => !paths.has(path))) throw new Error("Bundle contains unreferenced assets.");
  for (const a of document.assets) {
    const file = files[a.path]; if (!file) throw new Error(`Missing PNG: ${a.path}`);
    const image = decodePng(file); if (image.width !== a.width || image.height !== a.height) throw new Error(`PNG dimensions disagree with metadata: ${a.path}`);
  }
  return { document, files };
}

/** Retain old asset bytes so undo across a bundle import restores the old design. */
export function mergeImportedBundle(target: Project, imported: Project): Project["document"] {
  const document = structuredClone(imported.document);
  for (const asset of document.assets) {
    const bytes = imported.files[asset.path], prior = target.files[asset.path];
    if (prior && (prior.length !== bytes.length || prior.some((byte, i) => byte !== bytes[i]))) {
      let index = 1; while (target.files[`assets/import-${index}.png`]) index++;
      asset.path = `assets/import-${index}.png`;
    }
    target.files[asset.path] = bytes.slice();
  }
  return document;
}
export function encodeTileResource(tile: Tiles): Uint8Array {
  const bytes = new Uint8Array(16 + tile.palette.byteLength + tile.map.byteLength + tile.tiles.length), v = new DataView(bytes.buffer);
  bytes.set(strToU8("PWUT")); v.setUint16(4, tile.width, true); v.setUint16(6, tile.height, true);
  v.setUint16(8, tile.palette.length, true); v.setUint16(10, tile.map.length, true); v.setUint32(12, tile.tiles.length, true);
  let at = 16; for (const color of tile.palette) { v.setUint16(at, color, true); at += 2; }
  for (const index of tile.map) { v.setUint16(at, index, true); at += 2; } bytes.set(tile.tiles, at); return bytes;
}
export function archive(project: Project, compiled?: Compilation, native?: Uint8Array): Uint8Array {
  if (compiled && !compiled.valid) throw new Error("Cannot package a failed compilation.");
  const narc = new NARC(), source = exportBundle(project);
  // Match retail BW2's beginning-header byte order. FAT/image fields remain LE.
  narc.endiannessOfBeginning = ">";
  // Member zero is the ownership header; one is authoring-only. Runtime starts at two.
  narc.files = [new Uint8Array(), source, native ?? new Uint8Array()];
  const screens = compiled?.screens.map(screen => {
    const resources: Record<string, number> = {};
    for (const [name, resource] of Object.entries({ "background:top": screen.background.top, "background:bottom": screen.background.bottom, ...screen.resources })) {
      resources[name] = narc.files.length; narc.files.push(encodeTileResource(resource));
    }
    return { id: screen.id, elements: screen.elements, resources, budgets: screen.budgets, ...(screen.nativeLearnset ? { nativeLearnset: screen.nativeLearnset } : {}), ...(screen.nativeSummary ? { nativeSummary: screen.nativeSummary } : {}) };
  }) ?? [];
  const index = narc.files.length;
  narc.files.push(strToU8(JSON.stringify({ version: 1, launchers: project.document.launchers, screens })));
  narc.files[0] = strToU8(JSON.stringify({ format: "pokeweb.custom-ui.archive", version: 1, source: 1, index, enabled: project.installation?.enabled ?? false, installation: project.installation }));
  return narc.save();
}
export function recoverArchive(bytes: Uint8Array): Project {
  if (bytes.length > MAX_BUNDLE_BYTES * 2) throw new Error("Custom UI archive exceeds its size limit.");
  validateArchiveBounds(bytes);
  const narc = new NARC(bytes), header = JSON.parse(strFromU8(narc.files[0]));
  if (header.format !== "pokeweb.custom-ui.archive" || header.version !== 1 || header.source !== 1) throw new Error("Unsupported Custom UI archive.");
  const project = importBundle(narc.files[1]);
  if (header.installation && header.installation.version === 1 && typeof header.installation.enabled === "boolean" && typeof header.installation.digest === "string") project.installation = header.installation;
  return project;
}

function validateArchiveBounds(bytes: Uint8Array): void {
  const bad = () => { throw new Error("Truncated or invalid Custom UI archive."); };
  if (bytes.length < 60) bad();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), tag = (at: number, name: string) => at + 8 <= bytes.length && [...name].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  if (!tag(0, "NARC") || v.getUint32(8, true) !== bytes.length || !tag(16, "BTAF")) bad();
  const fat = v.getUint32(20, true), count = v.getUint32(24, true);
  if (count < 3 || count > 4096 || fat !== 12 + count * 8 || fat > bytes.length - 16) bad();
  const names = 16 + fat; if (!tag(names, "BTNF")) bad();
  const size = v.getUint32(names + 4, true); if (size < 8 || size > bytes.length - names) bad();
  const image = names + size; if (!tag(image, "GMIF") || v.getUint32(image + 4, true) !== bytes.length - image) bad();
  for (let i = 0; i < count; i++) {
    const start = v.getUint32(28 + i * 8, true), end = v.getUint32(32 + i * 8, true);
    if (start > end || end > bytes.length - image - 8) bad();
  }
}

/** Keep the applied runtime intact while storing later editable draft changes. */
export function updateArchiveSource(bytes: Uint8Array, project: Project): Uint8Array {
  recoverArchive(bytes);
  const narc = new NARC(bytes), header = JSON.parse(strFromU8(narc.files[0]));
  narc.files[1] = exportBundle(project); header.installation = project.installation; header.enabled = project.installation?.enabled ?? false;
  narc.files[0] = strToU8(JSON.stringify(header)); return narc.save();
}
