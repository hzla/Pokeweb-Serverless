import { concatBytes, readU16, readU32, writeU16, writeU32 } from "./binary";

export class Folder {
  folders: Array<[string, Folder]>;
  files: string[];
  firstId: number;

  constructor(options: { folders?: Array<[string, Folder]>; files?: string[]; firstId?: number } = {}) {
    this.folders = options.folders ?? [];
    this.files = options.files ?? [];
    this.firstId = options.firstId ?? 0;
  }

  idOf(path: string): number | undefined {
    const parts = path.split("/").filter(Boolean);
    return this.find(parts);
  }

  get(path: string): number | undefined {
    return this.idOf(path);
  }

  private find(parts: string[]): number | undefined {
    const [head, ...tail] = parts;
    if (!head) return undefined;
    if (tail.length === 0) {
      const index = this.files.indexOf(head);
      return index === -1 ? undefined : this.firstId + index;
    }
    const child = this.folders.find(([name]) => name === head)?.[1];
    return child?.find(tail);
  }
}

export function cloneFolder(folder: Folder): Folder {
  return new Folder({
    firstId: folder.firstId,
    files: [...folder.files],
    folders: folder.folders.map(([name, child]) => [name, cloneFolder(child)]),
  });
}

export function addFilePath(root: Folder, path: string, fileId: number): Folder {
  if (!Number.isInteger(fileId) || fileId < 0) throw new Error(`Invalid file ID: ${fileId}`);
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) throw new Error("ROM file path cannot be empty");
  for (const part of parts) validateFntName(part);

  const clone = cloneFolder(root);
  let folder = clone;
  for (const folderName of parts.slice(0, -1)) {
    let child = folder.folders.find(([name]) => name === folderName)?.[1];
    if (!child) {
      child = new Folder({ firstId: fileId });
      folder.folders.push([folderName, child]);
    }
    folder = child;
  }

  const filename = parts[parts.length - 1];
  if (folder.files.includes(filename)) throw new Error(`ROM file already exists: ${path}`);
  if (folder.files.length === 0) folder.firstId = fileId;
  if (folder.firstId + folder.files.length !== fileId) {
    throw new Error(`Cannot append ${path}: files in an existing folder must remain contiguous at the end of the ROM file table.`);
  }
  folder.files.push(filename);
  return clone;
}

export function loadFnt(data: Uint8Array): Folder {
  const loadFolder = (folderId: number): Folder => {
    const folder = new Folder();
    const folderIndex = folderId & 0x0fff;
    const tableOffset = folderIndex * 8;
    const entriesOffset = readU32(data, tableOffset);
    folder.firstId = readU16(data, tableOffset + 4);

    let offset = entriesOffset;
    while (offset < data.length) {
      const control = data[offset++];
      if (control === 0) break;
      const length = control & 0x7f;
      const isFolder = (control & 0x80) !== 0;
      const name = String.fromCharCode(...data.subarray(offset, offset + length));
      offset += length;
      if (isFolder) {
        const childId = readU16(data, offset);
        offset += 2;
        folder.folders.push([name, loadFolder(childId)]);
      } else {
        folder.files.push(name);
      }
    }
    return folder;
  };

  return loadFolder(0xf000);
}

export function saveFnt(root: Folder): Uint8Array {
  const entries = new Map<number, { firstId: number; parentId: number; table: Uint8Array }>();
  let nextFolderId = 0xf000;

  const encodeName = (name: string): Uint8Array => {
    const out = new Uint8Array(name.length);
    for (let i = 0; i < name.length; i += 1) out[i] = name.charCodeAt(i) & 0xff;
    return out;
  };

  const walk = (folder: Folder, parentId: number): number => {
    const folderId = nextFolderId++;
    const parts: Uint8Array[] = [];
    for (const file of folder.files) {
      const name = encodeName(file);
      if (name.length > 127) throw new Error(`Filename is too long: ${file}`);
      parts.push(Uint8Array.of(name.length), name);
    }
    for (const [name, child] of folder.folders) {
      const childId = walk(child, folderId);
      const encoded = encodeName(name);
      if (encoded.length > 127) throw new Error(`Folder name is too long: ${name}`);
      const idBytes = new Uint8Array(2);
      writeU16(idBytes, 0, childId);
      parts.push(Uint8Array.of(encoded.length | 0x80), encoded, idBytes);
    }
    parts.push(Uint8Array.of(0));
    entries.set(folderId, { firstId: folder.firstId, parentId, table: concatBytes(parts) });
    return folderId;
  };

  walk(root, 0);

  const folderCount = entries.size;
  let tableOffset = folderCount * 8;
  const main = new Uint8Array(tableOffset);
  const tables: Uint8Array[] = [];

  for (const [folderId, entry] of [...entries.entries()].sort(([a], [b]) => a - b)) {
    const offset = (folderId & 0x0fff) * 8;
    writeU32(main, offset, tableOffset);
    writeU16(main, offset + 4, entry.firstId);
    writeU16(main, offset + 6, folderId === 0xf000 ? folderCount : entry.parentId);
    tableOffset += entry.table.length;
    tables.push(entry.table);
  }

  return concatBytes([main, ...tables]);
}

function validateFntName(name: string): void {
  if (name.length === 0) throw new Error("ROM file path contains an empty component");
  if (name.length > 127) throw new Error(`Filename is too long: ${name}`);
  if (/[\\/]/u.test(name)) throw new Error(`Invalid ROM file path component: ${name}`);
}
