import { readAscii } from "../nds/binary";
import { Folder } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import type { NarcName } from "./constants";
import type { NarcStore, ProjectState } from "./projectStore";

export type FileSystemTreeNode = {
  name: string;
  type: "file" | "folder";
  collapsed?: boolean;
  children?: FileSystemTreeNode[];
  meta?: FileSystemNodeRef;
};

export type FileSystemNodeRef =
  | { kind: "folder"; path: string }
  | { kind: "addedRomFile"; path: string }
  | { kind: "romFile"; fileId: number; path: string }
  | { kind: "narcFile"; parentFileId: number; index: number; path: string; parentPath: string };

export type NarcInsertPosition = "before" | "after" | "append";

export type FileSystemSnapshot = {
  rom: NintendoDSRom;
  roots: FileSystemTreeNode[];
  pathRefs: Map<string, FileSystemNodeRef>;
};

type NamedFile = {
  id: number;
  name: string;
  path: string;
};

export function ensureFileSystemState(project: ProjectState): NonNullable<ProjectState["fileSystem"]> {
  project.fileSystem ??= { replacements: {} };
  project.fileSystem.replacements ??= {};
  project.fileSystem.additions ??= {};
  return project.fileSystem;
}

export function fileSystemReplacementMap(project: ProjectState): Map<number, Uint8Array> {
  const replacements = project.fileSystem?.replacements ?? {};
  return new Map(Object.entries(replacements).map(([id, bytes]) => [Number(id), bytes]));
}

export function fileSystemAddedFiles(project: ProjectState): Array<{ path: string; bytes: Uint8Array }> {
  return Object.entries(project.fileSystem?.additions ?? {})
    .map(([path, bytes]) => ({ path, bytes }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function addRomFile(project: ProjectState, path: string, bytes: Uint8Array): void {
  const normalizedPath = normalizeRomPath(path);
  ensureFileSystemState(project).additions![normalizedPath] = bytes;
}

export function setRomFileReplacement(project: ProjectState, fileId: number, bytes: Uint8Array): void {
  ensureFileSystemState(project).replacements[fileId] = bytes;
}

export function clearRomFileReplacement(project: ProjectState, fileId: number): void {
  if (project.fileSystem?.replacements) delete project.fileSystem.replacements[fileId];
}

export function buildFileSystemSnapshot(project: ProjectState, romBytes: Uint8Array): FileSystemSnapshot {
  const rom = new NintendoDSRom(romBytes);
  const named = listNamedFiles(rom.filenames).sort((a, b) => a.id - b.id);
  const namedIds = new Set(named.map((file) => file.id));
  const roots: FileSystemTreeNode[] = [];
  const pathRefs = new Map<string, FileSystemNodeRef>();

  for (const file of named) addPath(roots, file.path.split("/"), { kind: "romFile", fileId: file.id, path: file.path }, pathRefs);
  for (const file of fileSystemAddedFiles(project)) addPath(roots, file.path.split("/"), { kind: "addedRomFile", path: file.path }, pathRefs);

  const unnamed = rom.files
    .map((_file, fileId) => fileId)
    .filter((fileId) => !namedIds.has(fileId))
    .map((fileId) => ({
      name: `file_${fileId}.bin`,
      type: "file" as const,
      meta: { kind: "romFile" as const, fileId, path: `_unnamed/file_${fileId}.bin` },
    }));
  if (unnamed.length > 0) roots.push({ name: "_unnamed", type: "folder", collapsed: true, children: unnamed, meta: { kind: "folder", path: "_unnamed" } });

  for (const node of walkTree(roots)) {
    if (node.meta) pathRefs.set(node.meta.path, node.meta);
    if (node.meta?.kind !== "romFile") continue;
    const parentMeta = node.meta;
    const bytes = getRomFileBytes(project, rom, parentMeta.fileId);
    const narc = tryParseNarc(bytes);
    if (!narc) continue;
    node.type = "folder";
    node.collapsed = true;
    node.children = narc.files.map((_file, index) => {
      const childName = narcFileName(narc, index, parentMeta.path);
      const childPath = `${parentMeta.path}/${childName}`;
      const meta: FileSystemNodeRef = { kind: "narcFile", parentFileId: parentMeta.fileId, index, path: childPath, parentPath: parentMeta.path };
      pathRefs.set(childPath, meta);
      return { name: childName, type: "file", meta };
    });
  }

  return { rom, roots, pathRefs };
}

export function getNodeBytes(project: ProjectState, rom: NintendoDSRom, ref: FileSystemNodeRef): Uint8Array {
  if (ref.kind === "romFile") return getRomFileBytes(project, rom, ref.fileId);
  if (ref.kind === "addedRomFile") return project.fileSystem?.additions?.[ref.path] ?? new Uint8Array();
  if (ref.kind === "narcFile") return getNarcForRomFile(project, rom, ref.parentFileId).files[ref.index] ?? new Uint8Array();
  return new Uint8Array();
}

export function getRomFileBytes(project: ProjectState, rom: NintendoDSRom, fileId: number): Uint8Array {
  const store = narcStoreForFile(project, fileId);
  if (store) return new NARCWithStore(store).save();
  return project.fileSystem?.replacements?.[fileId] ?? rom.files[fileId] ?? new Uint8Array();
}

export function replaceRomFile(project: ProjectState, rom: NintendoDSRom, fileId: number, bytes: Uint8Array): void {
  const store = narcStoreForFile(project, fileId);
  if (store) {
    let narc: NARC;
    try {
      narc = new NARC(bytes);
    } catch {
      throw new Error("This file is loaded by a Pokeweb editor and must remain a valid NARC.");
    }
    store.rawFiles = narc.files;
    store.fileCount = narc.files.length;
    store.filenames = narc.filenames;
    store.dirty = new Set(narc.files.map((_file, index) => index));
    store.records.clear();
    clearRomFileReplacement(project, fileId);
    return;
  }
  void rom;
  setRomFileReplacement(project, fileId, bytes);
}

export function replaceNarcFile(project: ProjectState, rom: NintendoDSRom, parentFileId: number, index: number, bytes: Uint8Array): void {
  const store = narcStoreForFile(project, parentFileId);
  if (store) {
    if (index < 0 || index >= store.rawFiles.length) throw new Error(`NARC subfile ${index} does not exist.`);
    store.rawFiles[index] = bytes;
    store.fileCount = store.rawFiles.length;
    store.dirty.add(index);
    store.records.delete(index);
    return;
  }

  const narc = getNarcForRomFile(project, rom, parentFileId);
  if (index < 0 || index >= narc.files.length) throw new Error(`NARC subfile ${index} does not exist.`);
  narc.files[index] = bytes;
  setRomFileReplacement(project, parentFileId, narc.save());
}

export function insertNarcFiles(
  project: ProjectState,
  rom: NintendoDSRom,
  parentFileId: number,
  targetIndex: number,
  files: Array<{ name: string; bytes: Uint8Array }>,
  position: NarcInsertPosition,
): void {
  if (files.length === 0) return;
  const store = narcStoreForFile(project, parentFileId);
  const source = store ? new NARCWithStore(store) : getNarcForRomFile(project, rom, parentFileId);
  const insertAt = position === "append" ? source.files.length : Math.max(0, Math.min(source.files.length, targetIndex + (position === "after" ? 1 : 0)));
  source.files.splice(insertAt, 0, ...files.map((file) => file.bytes));
  source.filenames = insertNarcNames(source.filenames, insertAt, files.map((file) => sanitizeFilename(file.name)));

  if (store) {
    store.rawFiles = source.files;
    store.fileCount = source.files.length;
    store.filenames = source.filenames;
    store.records.clear();
    store.dirty = new Set(source.files.map((_file, index) => index));
    return;
  }
  setRomFileReplacement(project, parentFileId, source.save());
}

export function isNarcBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && readAscii(bytes, 0, 4) === "NARC";
}

export function tryParseNarc(bytes: Uint8Array): NARC | undefined {
  if (!isNarcBytes(bytes)) return undefined;
  try {
    return new NARC(bytes);
  } catch {
    return undefined;
  }
}

export function downloadBytes(bytes: Uint8Array, filename: string): void {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function filenameForRef(project: ProjectState, rom: NintendoDSRom, ref: FileSystemNodeRef): string {
  if (ref.kind === "addedRomFile") return basename(ref.path);
  if (ref.kind === "romFile") {
    const name = basename(ref.path);
    return tryParseNarc(getRomFileBytes(project, rom, ref.fileId)) ? withExtension(name, ".narc") : name;
  }
  if (ref.kind === "narcFile") {
    const narc = getNarcForRomFile(project, rom, ref.parentFileId);
    return narcFileName(narc, ref.index, ref.parentPath);
  }
  return "folder.bin";
}

function getNarcForRomFile(project: ProjectState, rom: NintendoDSRom, fileId: number): NARC {
  const store = narcStoreForFile(project, fileId);
  if (store) return new NARCWithStore(store);
  const bytes = project.fileSystem?.replacements?.[fileId] ?? rom.files[fileId];
  if (!bytes) throw new Error(`ROM file ${fileId} does not exist.`);
  return new NARC(bytes);
}

class NARCWithStore extends NARC {
  constructor(store: NarcStore) {
    super();
    this.files = store.rawFiles;
    this.filenames = store.filenames ?? new Folder();
  }
}

function narcStoreForFile(project: ProjectState, fileId: number): NarcStore | undefined {
  return Object.values(project.narcs).find((store) => store?.fileId === fileId);
}

function listNamedFiles(root: Folder, parent = ""): NamedFile[] {
  const files = root.files.map((name, index) => {
    const path = parent ? `${parent}/${name}` : name;
    return { id: root.firstId + index, name, path };
  });
  for (const [name, folder] of root.folders) files.push(...listNamedFiles(folder, parent ? `${parent}/${name}` : name));
  return files;
}

function addPath(roots: FileSystemTreeNode[], parts: string[], meta: FileSystemNodeRef, refs: Map<string, FileSystemNodeRef>): void {
  let children = roots;
  let currentPath = "";
  parts.forEach((part, index) => {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const isFile = index === parts.length - 1;
    let node = children.find((child) => child.name === part && child.type === (isFile ? "file" : "folder"));
    if (!node) {
      node = {
        name: part,
        type: isFile ? "file" : "folder",
        collapsed: isFile ? undefined : true,
        children: isFile ? undefined : [],
        meta: isFile ? meta : { kind: "folder", path: currentPath },
      };
      children.push(node);
      if (node.meta) refs.set(node.meta.path, node.meta);
    }
    if (!isFile) children = node.children ??= [];
  });
}

function* walkTree(nodes: FileSystemTreeNode[]): Generator<FileSystemTreeNode> {
  for (const node of nodes) {
    yield node;
    if (node.children) yield* walkTree(node.children);
  }
}

function narcFileName(narc: NARC, index: number, parentPath: string): string {
  const named = listNamedFiles(narc.filenames).find((file) => file.id === index);
  if (named) return named.path.split("/").join("_");
  return `${basename(parentPath).replace(/\.[^.]+$/u, "")}_${index}.bin`;
}

function insertNarcNames(root: Folder, insertAt: number, names: string[]): Folder {
  const clone = cloneFolder(root);
  const folder = findFolderForInsert(clone, insertAt);
  if (!folder) return clone;
  const localIndex = Math.max(0, Math.min(folder.files.length, insertAt - folder.firstId));
  folder.files.splice(localIndex, 0, ...names);
  shiftFolderFirstIds(clone, insertAt, names.length, folder);
  return clone;
}

function findFolderForInsert(folder: Folder, fileId: number): Folder | undefined {
  if (fileId >= folder.firstId && fileId <= folder.firstId + folder.files.length) return folder;
  for (const [, child] of folder.folders) {
    const match = findFolderForInsert(child, fileId);
    if (match) return match;
  }
  return undefined;
}

function shiftFolderFirstIds(folder: Folder, insertAt: number, count: number, insertedFolder: Folder): void {
  if (folder !== insertedFolder && folder.firstId >= insertAt) folder.firstId += count;
  for (const [, child] of folder.folders) shiftFolderFirstIds(child, insertAt, count, insertedFolder);
}

function cloneFolder(folder: Folder): Folder {
  return new Folder({
    firstId: folder.firstId,
    files: [...folder.files],
    folders: folder.folders.map(([name, child]) => [name, cloneFolder(child)]),
  });
}

function sanitizeFilename(name: string): string {
  return basename(name).replace(/[^\w .-]/gu, "_") || "inserted.bin";
}

function normalizeRomPath(path: string): string {
  const normalized = path
    .replace(/\\/gu, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
  if (!normalized) throw new Error("ROM file path cannot be empty");
  return normalized;
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? "file.bin";
}

function withExtension(name: string, extension: string): string {
  return `${name.replace(/\.[^.]*$/u, "")}${extension}`;
}
