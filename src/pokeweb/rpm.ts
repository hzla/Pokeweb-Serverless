import { concatBytes, readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";

export type RpmSymbolType = "NULL" | "VALUE" | "FUNCTION_ARM" | "FUNCTION_THM" | "SECTION";
export type RpmRelocationType =
  | "OFFSET"
  | "THUMB_BRANCH_LINK"
  | "ARM_BRANCH_LINK"
  | "THUMB_BRANCH"
  | "ARM_BRANCH"
  | "FULL_COPY"
  | "THUMB_BRANCH_SAFESTACK"
  | "OFFSET_REL31";

export type RpmSymbol = {
  name: string | null;
  size: number;
  address: number;
  type: RpmSymbolType;
  attributes: number;
  nameHash?: number;
};

export type RpmRelocation = {
  target: {
    module: string;
    address: number;
    type: RpmRelocationType;
  };
  sourceSymbolIndex: number;
};

export type RpmModule = {
  code: Uint8Array;
  bssSize: number;
  baseAddress: number;
  symbols: RpmSymbol[];
  relocations: RpmRelocation[];
  metadata: Record<string, string | number>;
};

const RPM_PROLOG_SIZE = 0x20;
const RPM_PADDING = 0x10;
const REV_CURRENT = 13;
const SYMBOL_TYPES: RpmSymbolType[] = ["NULL", "VALUE", "FUNCTION_ARM", "FUNCTION_THM", "SECTION"];
const RELOCATION_TYPES: RpmRelocationType[] = [
  "OFFSET",
  "THUMB_BRANCH_LINK",
  "ARM_BRANCH_LINK",
  "THUMB_BRANCH",
  "ARM_BRANCH",
  "FULL_COPY",
  "THUMB_BRANCH_SAFESTACK",
  "OFFSET_REL31",
];
const SYMBOL_ATTR_EXPORT = 1 << 0;
const SYMBOL_ATTR_IMPORT = 1 << 1;
const SYMBOL_ATTR_GLOBAL = 1 << 2;

export function parseRpm(bytes: Uint8Array, options: { allowedMagics?: string[] } = {}): RpmModule {
  const allowedMagics = options.allowedMagics ?? ["RPM0"];
  const magic = readAscii(bytes, 0, 4);
  if (!allowedMagics.includes(magic)) throw new Error(`Not a supported RPM module (${magic || "empty"})`);
  const headerStart = readU32(bytes, 8);
  if (readAscii(bytes, headerStart, 4) !== "DLXH") throw new Error("RPM DllExec header is missing");
  const version = readU32(bytes, headerStart + 4);
  if (version < REV_CURRENT) throw new Error(`Unsupported RPM revision ${version}; expected revision ${REV_CURRENT}`);

  const headerOffsetBase = headerStart;
  const infoOffset = headerOffsetBase + readU32(bytes, headerStart + 8);
  const bssSize = readU32(bytes, headerStart + 12);
  if (readAscii(bytes, infoOffset, 4) !== "INFO") throw new Error("RPM INFO section is missing");

  const symbolOffset = readRelativeOffset(bytes, infoOffset + 4, headerOffsetBase);
  const relocationOffset = readRelativeOffset(bytes, infoOffset + 8, headerOffsetBase);
  const stringOffset = readRelativeOffset(bytes, infoOffset + 12, headerOffsetBase);
  const codeOffset = readU32(bytes, infoOffset + 16);
  const codeSize = readU32(bytes, infoOffset + 20);
  const sinitOffset = readRelativeOffset(bytes, infoOffset + 24, headerOffsetBase);
  const sfiniOffset = readRelativeOffset(bytes, infoOffset + 28, headerOffsetBase);
  void sinitOffset;
  void sfiniOffset;
  const metadataOffset = readRelativeOffset(bytes, infoOffset + 32, headerOffsetBase);

  const stringsBase = stringOffset >= 0 ? stringOffset + 4 : -1;
  if (stringOffset >= 0 && readAscii(bytes, stringOffset, 4) !== "STR0") throw new Error("RPM STR section is missing");

  const readStringRef = (offset: number): string | null => {
    const stringRef = readU16(bytes, offset);
    if (stringRef === 0) return null;
    if (stringsBase < 0) throw new Error("RPM string reference found without STR section");
    return readCString(bytes, stringsBase + stringRef);
  };

  const metadata: Record<string, string | number> = {};
  if (metadataOffset >= 0) {
    if (readAscii(bytes, metadataOffset, 4) !== "META") throw new Error("RPM META section is missing");
    let offset = metadataOffset + 8;
    const count = readU32(bytes, metadataOffset + 4);
    for (let i = 0; i < count; i += 1) {
      const name = readStringRef(offset);
      const type = bytes[offset + 2] ?? 0;
      if (name) metadata[name] = type === 0 ? (readStringRef(offset + 4) ?? "") : readU32(bytes, offset + 4);
      offset += 8;
    }
  }

  const symbols: RpmSymbol[] = [];
  if (symbolOffset >= 0) {
    if (readAscii(bytes, symbolOffset, 4) !== "SYM0") throw new Error("RPM SYM section is missing");
    let offset = symbolOffset + 4;
    offset += 4; // external module list, unused by PMC
    const firstExport = readU16(bytes, offset);
    const exportCount = readU16(bytes, offset + 2);
    offset += 8; // first/import counts
    const exportHashOffset = readRelativeOffset(bytes, offset, headerOffsetBase);
    offset += 4;
    const count = readU32(bytes, offset);
    offset += 4;
    for (let i = 0; i < count; i += 1) {
      symbols.push({
        name: readStringRef(offset),
        size: readU16(bytes, offset + 2),
        address: readU32(bytes, offset + 4),
        type: SYMBOL_TYPES[bytes[offset + 8] ?? 0] ?? "NULL",
        attributes: bytes[offset + 9] ?? 0,
      });
      offset += 12;
    }
    if (firstExport !== 0xffff && exportHashOffset >= 0) {
      for (let i = 0; i < exportCount; i += 1) {
        const symbol = symbols[firstExport + i];
        if (symbol) symbol.nameHash = readU32(bytes, exportHashOffset + i * 4);
      }
    }
  }

  let baseAddress = 0;
  const relocations: RpmRelocation[] = [];
  if (relocationOffset >= 0) {
    if (readAscii(bytes, relocationOffset, 4) !== "REL0") throw new Error("RPM REL section is missing");
    baseAddress = readU32(bytes, relocationOffset + 4);
    const internalOffset = readRelativeOffset(bytes, relocationOffset + 8, headerOffsetBase);
    const internalImportOffset = readRelativeOffset(bytes, relocationOffset + 12, headerOffsetBase);
    const externalOffset = readRelativeOffset(bytes, relocationOffset + 16, headerOffsetBase);
    const moduleListOffset = readRelativeOffset(bytes, relocationOffset + 20, headerOffsetBase);
    const moduleNames = moduleListOffset >= 0 ? readExternModuleList(bytes, moduleListOffset, readStringRef) : [];
    readRelocationList(bytes, externalOffset, moduleNames, relocations);
    readRelocationList(bytes, internalImportOffset, moduleNames, relocations);
    readRelocationList(bytes, internalOffset, moduleNames, relocations);
  }

  return {
    code: bytes.slice(codeOffset, codeOffset + codeSize),
    bssSize,
    baseAddress,
    symbols,
    relocations,
    metadata,
  };
}

export function cloneRpm(rpm: RpmModule): RpmModule {
  return {
    code: rpm.code.slice(),
    bssSize: rpm.bssSize,
    baseAddress: rpm.baseAddress,
    symbols: rpm.symbols.map((symbol) => ({ ...symbol })),
    relocations: rpm.relocations.map((relocation) => ({ target: { ...relocation.target }, sourceSymbolIndex: relocation.sourceSymbolIndex })),
    metadata: { ...rpm.metadata },
  };
}

export function createCodeOnlyRpm(rpm: RpmModule): RpmModule {
  return {
    code: rpm.code,
    bssSize: rpm.bssSize,
    baseAddress: rpm.baseAddress,
    symbols: [],
    relocations: [],
    metadata: rpm.metadata,
  };
}

export function createSymbolOnlyRpm(rpm: RpmModule): RpmModule {
  return {
    code: new Uint8Array(),
    bssSize: 0,
    baseAddress: rpm.baseAddress,
    symbols: rpm.symbols.map((symbol) => ({ ...symbol })),
    relocations: rpm.relocations.map((relocation) => ({ target: { ...relocation.target }, sourceSymbolIndex: relocation.sourceSymbolIndex })),
    metadata: rpm.metadata,
  };
}

export function findRpmSymbol(rpm: RpmModule, predicate: (symbol: RpmSymbol) => boolean): RpmSymbol | undefined {
  return rpm.symbols.find(predicate);
}

export function setRpmBaseAddress(rpm: RpmModule, baseAddress: number): void {
  rpm.baseAddress = baseAddress >>> 0;
}

export function updateRpmCodeImageForBase(rpm: RpmModule): Uint8Array {
  const out = rpm.code.slice();
  for (const relocation of rpm.relocations) {
    if (relocation.target.module !== "base") continue;
    writeRelocationDataByType(rpm, relocation, out, rpm.baseAddress + RPM_PROLOG_SIZE + (relocation.target.address & 0xfffffffe), rpmCodeSegmentBase(rpm));
  }
  rpm.code = out;
  return out;
}

export function writeRpm(rpm: RpmModule, options: { writeBss?: boolean; ident?: string } = {}): Uint8Array {
  const ident = options.ident ?? "RPM0";
  const writeBss = options.writeBss ?? false;
  const writer = new BinaryWriter();
  writer.writeAscii(ident);
  const expandSizeOffset = writer.reserveU32();
  const headerOffsetRef = writer.reserveU32();
  writer.writeU32(0);
  writer.writeU32(0);
  writer.writeU32(0);
  writer.writeU32(0);
  writer.writeU32(0);

  const codeOffset = writer.offset;
  writer.writeBytes(rpm.code);
  const codeSize = rpm.code.length;
  if (writeBss) {
    writer.pad(4);
    writer.writeBytes(new Uint8Array(rpm.bssSize));
  }
  writer.pad(RPM_PADDING);

  const headerStart = writer.offset;
  writer.patchU32(headerOffsetRef, headerStart);
  writer.writeAscii("DLXH");
  writer.writeU32(REV_CURRENT);
  const infoOffsetRef = writer.reserveU32();
  writer.writeU32(rpm.bssSize);
  const headerSizeRef = writer.reserveU32();
  const headerSectionStart = headerStart;

  const infoOffset = writer.offset;
  writer.patchU32(infoOffsetRef, infoOffset - headerStart);
  writer.writeAscii("INFO");
  const symbolOffsetRef = writer.reserveU32();
  const relocationOffsetRef = writer.reserveU32();
  const stringOffsetRef = writer.reserveU32();
  writer.writeU32(codeOffset);
  writer.writeU32(codeSize);
  const sinitOffsetRef = writer.reserveU32();
  const sfiniOffsetRef = writer.reserveU32();
  const metadataOffsetRef = writer.reserveU32();

  const stringTable = buildStringTable(rpm);

  if (Object.keys(rpm.metadata).length > 0) {
    writer.patchU32(metadataOffsetRef, writer.offset - headerStart);
    writer.writeAscii("META");
    const entries = Object.entries(rpm.metadata);
    writer.writeU32(entries.length);
    for (const [name, value] of entries) {
      writer.writeU16(stringTable.offsetOf(name));
      if (typeof value === "number") {
        writer.writeU8(1);
        writer.writeU8(0);
        writer.writeU32(value);
      } else {
        writer.writeU8(0);
        writer.writeU8(0);
        writer.writeU16(stringTable.offsetOf(value));
        writer.writeU16(0);
      }
    }
    writer.pad(RPM_PADDING);
  } else {
    writer.patchU32(metadataOffsetRef, 0xffffffff);
  }

  if (stringTable.bytes.length > 1) {
    writer.patchU32(stringOffsetRef, writer.offset - headerStart);
    writer.writeAscii("STR0");
    writer.writeBytes(stringTable.bytes);
    writer.pad(RPM_PADDING);
  } else {
    writer.patchU32(stringOffsetRef, 0xffffffff);
  }

  prepareSymbolsForExport(rpm);
  if (rpm.symbols.length > 0) {
    const firstExport = rpm.symbols.findIndex((symbol) => isExportSymbol(symbol));
    const firstImport = rpm.symbols.findIndex((symbol) => isImportSymbol(symbol));
    const exportCount = firstExport === -1 ? 0 : rpm.symbols.slice(firstExport).findIndex((symbol) => !isExportSymbol(symbol));
    const actualExportCount = firstExport === -1 ? 0 : exportCount === -1 ? rpm.symbols.length - firstExport : exportCount;
    const importCount = firstImport === -1 ? 0 : rpm.symbols.length - firstImport;

    writer.patchU32(symbolOffsetRef, writer.offset - headerStart);
    writer.writeAscii("SYM0");
    writer.writeU32(0);
    writer.writeU16(firstExport === -1 ? 0xffff : firstExport);
    writer.writeU16(actualExportCount);
    writer.writeU16(firstImport === -1 ? 0xffff : firstImport);
    writer.writeU16(importCount);
    const hashOffsetRef = writer.reserveU32();
    writer.writeU32(rpm.symbols.length);
    for (const symbol of rpm.symbols) {
      writer.writeU16(symbol.name ? stringTable.offsetOf(symbol.name) : 0);
      writer.writeU16(symbol.size);
      writer.writeU32(symbol.address);
      writer.writeU8(SYMBOL_TYPES.indexOf(symbol.type));
      writer.writeU8(symbol.attributes);
      writer.writeU16(0);
    }
    writer.pad(4);
    if (firstExport === -1) {
      writer.patchU32(hashOffsetRef, 0xffffffff);
    } else {
      writer.patchU32(hashOffsetRef, writer.offset - headerStart);
      for (let i = 0; i < actualExportCount; i += 1) writer.writeU32(rpm.symbols[firstExport + i]?.nameHash ?? 0);
    }
    writer.pad(RPM_PADDING);
  } else {
    writer.patchU32(symbolOffsetRef, 0xffffffff);
  }

  writer.patchU32(sinitOffsetRef, 0xffffffff);
  writer.patchU32(sfiniOffsetRef, 0xffffffff);
  writer.pad(RPM_PADDING);

  if (rpm.relocations.length > 0 || rpm.baseAddress !== 0) {
    writer.patchU32(relocationOffsetRef, writer.offset - headerStart);
    writer.writeAscii("REL0");
    writer.writeU32(rpm.baseAddress);
    const internalOffsetRef = writer.reserveU32();
    const internalImportOffsetRef = writer.reserveU32();
    const externalOffsetRef = writer.reserveU32();
    const moduleListOffsetRef = writer.reserveU32();
    const externalModules: string[] = [];

    writer.patchU32(externalOffsetRef, writer.offset - headerStart);
    const external = rpm.relocations.filter((relocation) => relocation.target.module !== "base");
    writer.writeU32(external.length);
    for (const relocation of external) writeRelocation(writer, relocation, externalModules);
    writer.pad(4);

    writer.patchU32(moduleListOffsetRef, writer.offset - headerStart);
    writer.writeU16(externalModules.length);
    for (const module of externalModules) writer.writeU16(stringTable.offsetOf(module));
    writer.pad(4);

    writer.patchU32(internalImportOffsetRef, writer.offset - headerStart);
    const internalImports = rpm.relocations.filter((relocation) => relocation.target.module === "base" && isImportSymbol(rpm.symbols[relocation.sourceSymbolIndex]));
    writer.writeU32(internalImports.length);
    for (const relocation of internalImports) writeRelocation(writer, relocation, externalModules);
    writer.pad(4);

    writer.patchU32(internalOffsetRef, writer.offset - headerStart);
    const internal = rpm.relocations.filter((relocation) => relocation.target.module === "base" && !isImportSymbol(rpm.symbols[relocation.sourceSymbolIndex]));
    writer.writeU32(internal.length);
    for (const relocation of internal) writeRelocation(writer, relocation, externalModules);
    writer.pad(RPM_PADDING);
  } else {
    writer.patchU32(relocationOffsetRef, 0xffffffff);
  }

  writer.patchU32(expandSizeOffset, align(writer.offset + (writeBss ? 0 : rpm.bssSize), RPM_PADDING));
  writer.patchU32(headerSizeRef, writer.offset - headerSectionStart);
  return writer.toBytes();
}

export function writeRelocationDataByType(
  rpm: RpmModule,
  relocation: RpmRelocation,
  out: Uint8Array,
  absoluteTargetAddress: number,
  targetBaseAddress: number,
): void {
  const symbol = rpm.symbols[relocation.sourceSymbolIndex];
  if (!symbol || isImportSymbol(symbol)) return;
  const writableAddress = symbolWritableAddress(rpm, symbol);
  switch (relocation.target.type) {
    case "OFFSET":
      writeU32(out, offsetForAbsolute(out, absoluteTargetAddress, targetBaseAddress), writableAddress);
      break;
    case "OFFSET_REL31": {
      const offset = offsetForAbsolute(out, absoluteTargetAddress, targetBaseAddress);
      const highBits = readU32(out, offset) & 0x80000000;
      writeU32(out, offset, ((writableAddress - absoluteTargetAddress) & 0x7fffffff) | highBits);
      break;
    }
    case "THUMB_BRANCH_LINK":
      writeThumbBranchLink(out, offsetForAbsolute(out, absoluteTargetAddress, targetBaseAddress), absoluteTargetAddress, writableAddress);
      break;
    case "ARM_BRANCH_LINK":
      writeArmBranchLink(out, offsetForAbsolute(out, absoluteTargetAddress, targetBaseAddress), absoluteTargetAddress, writableAddress);
      break;
    case "THUMB_BRANCH":
      writeThumbBranch(out, offsetForAbsolute(out, absoluteTargetAddress, targetBaseAddress), absoluteTargetAddress, writableAddress);
      break;
    case "ARM_BRANCH":
      writeArmBranch(out, offsetForAbsolute(out, absoluteTargetAddress, targetBaseAddress), absoluteTargetAddress, writableAddress);
      break;
    case "THUMB_BRANCH_SAFESTACK":
      writeThumbBranchSafestack(out, offsetForAbsolute(out, absoluteTargetAddress, targetBaseAddress), absoluteTargetAddress, writableAddress);
      break;
    case "FULL_COPY":
      writeFullCopy(rpm, relocation, out, absoluteTargetAddress, targetBaseAddress);
      break;
    default:
      throw new Error(`RPM relocation type ${relocation.target.type} is not implemented yet`);
  }
}

export function symbolWritableAddress(rpm: RpmModule, symbol: RpmSymbol): number {
  let address = isGlobalSymbol(symbol) ? symbol.address : rpm.baseAddress + RPM_PROLOG_SIZE + symbol.address;
  if (symbol.type === "FUNCTION_THM") address = (address | 1) >>> 0;
  return address >>> 0;
}

export function rpmCodeSegmentBase(rpm: RpmModule): number {
  return (rpm.baseAddress + RPM_PROLOG_SIZE) >>> 0;
}

function writeFullCopy(rpm: RpmModule, relocation: RpmRelocation, out: Uint8Array, absoluteTargetAddress: number, targetBaseAddress: number): void {
  const symbol = rpm.symbols[relocation.sourceSymbolIndex];
  if (!symbol || symbol.size <= 0) throw new Error(`Cannot FULL_COPY RPM symbol without a size: ${symbol?.name ?? relocation.sourceSymbolIndex}`);
  const source = rpm.code.subarray(symbol.address, symbol.address + symbol.size);
  const targetOffset = offsetForAbsolute(out, absoluteTargetAddress, targetBaseAddress);
  out.set(source, targetOffset);
  const copyStart = symbol.address;
  const copyEnd = symbol.address + symbol.size;
  for (const copyRelocation of rpm.relocations) {
    if (copyRelocation.target.module !== "base" || copyRelocation.target.type === "FULL_COPY") continue;
    const copyAddress = copyRelocation.target.address & 0xfffffffe;
    if (copyAddress < copyStart || copyAddress >= copyEnd) continue;
    writeRelocationDataByType(rpm, copyRelocation, out, absoluteTargetAddress + (copyAddress - copyStart), targetBaseAddress);
  }
}

function offsetForAbsolute(out: Uint8Array, absoluteAddress: number, targetBaseAddress: number): number {
  const offset = absoluteAddress - targetBaseAddress;
  if (offset < 0 || offset >= out.length) throw new Error(`RPM relocation target 0x${absoluteAddress.toString(16)} is outside the target buffer`);
  return offset;
}

function writeThumbBranchLink(out: Uint8Array, offset: number, absoluteAddress: number, targetAddress: number): void {
  let delta = targetAddress - (absoluteAddress + 4);
  if ((targetAddress & 1) === 0 && delta < 0) delta = (delta + 3) & 0xfffffffc;
  if (delta < -0x400000 || delta > 0x3fffff) {
    throw new Error(`Thumb BL target is out of range: 0x${absoluteAddress.toString(16)} -> 0x${targetAddress.toString(16)}`);
  }
  const upper = 0xf000 | ((delta >> 12) & 0x7ff);
  const lowerPrefix = (targetAddress & 1) === 0 ? 0xe800 : 0xf800;
  const lower = lowerPrefix | ((delta >> 1) & 0x7ff);
  writeU16(out, offset, upper);
  writeU16(out, offset + 2, lower);
}

function writeArmBranchLink(out: Uint8Array, offset: number, absoluteAddress: number, targetAddress: number): void {
  const delta = targetAddress - (absoluteAddress + 8);
  if (delta < -0x2000000 || delta > 0x1ffffff) {
    throw new Error(`ARM BL target is out of range: 0x${absoluteAddress.toString(16)} -> 0x${targetAddress.toString(16)}`);
  }
  const instruction =
    (targetAddress & 1) !== 0 ? 0xfa000000 | (((delta & 2) !== 0 ? 1 : 0) << 24) | ((delta >> 2) & 0xffffff) : 0xeb000000 | ((delta >> 2) & 0xffffff);
  writeU32(out, offset, instruction >>> 0);
}

function writeThumbBranch(out: Uint8Array, offset: number, absoluteAddress: number, targetAddress: number): void {
  const delta = targetAddress - (absoluteAddress + 4);
  if (Math.abs(delta) < 2048) {
    writeU16(out, offset, 0xe000 | ((delta >> 1) & 0x7ff));
    return;
  }
  writeU16(out, offset, 0xb500);
  writeThumbBranchLink(out, offset + 2, absoluteAddress + 2, targetAddress);
  writeU16(out, offset + 6, 0xbd00);
}

function writeArmBranch(out: Uint8Array, offset: number, absoluteAddress: number, targetAddress: number): void {
  const delta = targetAddress - (absoluteAddress + 8);
  if (delta < -0x2000000 || delta > 0x1ffffff) {
    throw new Error(`ARM B target is out of range: 0x${absoluteAddress.toString(16)} -> 0x${targetAddress.toString(16)}`);
  }
  writeU32(out, offset, (0xea000000 | ((delta >> 2) & 0xffffff)) >>> 0);
}

function writeThumbBranchSafestack(out: Uint8Array, offset: number, absoluteAddress: number, targetAddress: number): void {
  const literalOffset = align(offset + 5 * 2, 4);
  if (literalOffset + 4 > out.length) throw new Error(`Thumb safestack branch literal is outside the target buffer at 0x${absoluteAddress.toString(16)}`);
  writeU16(out, offset, 0xb410);
  let literalDelta = absoluteAddress + (literalOffset - offset) - (absoluteAddress + 2) - 4;
  if ((literalDelta & 3) !== 0) literalDelta += 2;
  writeU16(out, offset + 2, 0x4800 | (4 << 8) | ((literalDelta >> 2) & 0xff));
  writeU16(out, offset + 4, 0x4600 | (1 << 7) | (4 << 3) | 4);
  writeU16(out, offset + 6, 0xbc10);
  writeU16(out, offset + 8, 0x4700 | (1 << 6) | (4 << 3));
  writeU32(out, literalOffset, targetAddress);
}

function readRelativeOffset(bytes: Uint8Array, offset: number, base: number): number {
  const value = readU32(bytes, offset);
  return value === 0xffffffff ? -1 : base + value;
}

function readCString(bytes: Uint8Array, offset: number): string {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  return readAscii(bytes, offset, end - offset);
}

function readExternModuleList(bytes: Uint8Array, offset: number, readStringRef: (offset: number) => string | null): string[] {
  const count = readU16(bytes, offset);
  const modules: string[] = [];
  for (let i = 0; i < count; i += 1) modules.push(readStringRef(offset + 2 + i * 2) ?? "");
  return modules;
}

function readRelocationList(bytes: Uint8Array, offset: number, moduleNames: string[], out: RpmRelocation[]): void {
  if (offset < 0) return;
  let cursor = offset;
  const count = readU32(bytes, cursor);
  cursor += 4;
  for (let i = 0; i < count; i += 1) {
    const address = readU32(bytes, cursor);
    const moduleIndex = bytes[cursor + 4] ?? 0xff;
    const type = RELOCATION_TYPES[bytes[cursor + 5] ?? 0] ?? "OFFSET";
    const sourceSymbolIndex = readU16(bytes, cursor + 6);
    out.push({
      target: {
        module: moduleIndex === 0xff ? "base" : (moduleNames[moduleIndex] ?? ""),
        address,
        type,
      },
      sourceSymbolIndex,
    });
    cursor += 8;
  }
}

function buildStringTable(rpm: RpmModule): { bytes: Uint8Array; offsetOf: (value: string) => number } {
  const offsets = new Map<string, number>();
  const parts: Uint8Array[] = [Uint8Array.of(0)];
  let cursor = 1;
  const add = (value: string | null | undefined) => {
    if (!value || offsets.has(value)) return;
    offsets.set(value, cursor);
    const bytes = asciiBytes(value);
    parts.push(bytes, Uint8Array.of(0));
    cursor += bytes.length + 1;
  };
  for (const [name, value] of Object.entries(rpm.metadata)) {
    add(name);
    if (typeof value === "string") add(value);
  }
  for (const symbol of rpm.symbols) add(symbol.name);
  for (const relocation of rpm.relocations) if (relocation.target.module !== "base") add(relocation.target.module);
  const bytes = concatBytes(parts);
  return {
    bytes,
    offsetOf: (value: string) => offsets.get(value) ?? 0,
  };
}

function prepareSymbolsForExport(rpm: RpmModule): void {
  const relocationSymbols = rpm.relocations.map((relocation) => rpm.symbols[relocation.sourceSymbolIndex]);
  const internal = rpm.symbols.filter((symbol) => !isImportSymbol(symbol) && !isExportSymbol(symbol));
  const exports = rpm.symbols.filter(isExportSymbol);
  for (const symbol of exports) if (symbol.name) symbol.nameHash = fnv1a32(symbol.name);
  exports.sort((a, b) => unsignedCompare(a.nameHash ?? 0, b.nameHash ?? 0));
  const imports = rpm.symbols.filter(isImportSymbol);
  for (const symbol of imports) if (symbol.name) symbol.nameHash = fnv1a32(symbol.name);
  imports.sort((a, b) => unsignedCompare(a.nameHash ?? 0, b.nameHash ?? 0));
  rpm.symbols = [...internal, ...exports, ...imports];
  const remap = new Map<RpmSymbol | undefined, number>();
  rpm.symbols.forEach((symbol, index) => remap.set(symbol, index));
  rpm.relocations.forEach((relocation, index) => {
    relocation.sourceSymbolIndex = remap.get(relocationSymbols[index]) ?? relocation.sourceSymbolIndex;
  });
}

function writeRelocation(writer: BinaryWriter, relocation: RpmRelocation, externalModules: string[]): void {
  writer.writeU32(relocation.target.address);
  let moduleIndex = 0xff;
  if (relocation.target.module !== "base") {
    moduleIndex = externalModules.indexOf(relocation.target.module);
    if (moduleIndex === -1) {
      moduleIndex = externalModules.length;
      externalModules.push(relocation.target.module);
    }
  }
  writer.writeU8(moduleIndex);
  writer.writeU8(RELOCATION_TYPES.indexOf(relocation.target.type));
  writer.writeU16(relocation.sourceSymbolIndex);
}

function isExportSymbol(symbol: RpmSymbol | undefined): boolean {
  return Boolean(symbol && (symbol.attributes & SYMBOL_ATTR_EXPORT) !== 0);
}

function isImportSymbol(symbol: RpmSymbol | undefined): boolean {
  return Boolean(symbol && (symbol.attributes & SYMBOL_ATTR_IMPORT) !== 0);
}

function isGlobalSymbol(symbol: RpmSymbol): boolean {
  return (symbol.attributes & SYMBOL_ATTR_GLOBAL) !== 0;
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function unsignedCompare(a: number, b: number): number {
  return a >>> 0 < b >>> 0 ? -1 : a >>> 0 > b >>> 0 ? 1 : 0;
}

function asciiBytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) out[i] = value.charCodeAt(i) & 0xff;
  return out;
}

function align(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}

class BinaryWriter {
  private buffer = new Uint8Array(1024);
  offset = 0;

  writeAscii(value: string): void {
    this.writeBytes(asciiBytes(value));
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensure(this.offset + bytes.length);
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  writeU8(value: number): void {
    this.ensure(this.offset + 1);
    this.buffer[this.offset++] = value & 0xff;
  }

  writeU16(value: number): void {
    this.ensure(this.offset + 2);
    writeU16(this.buffer, this.offset, value);
    this.offset += 2;
  }

  writeU32(value: number): void {
    this.ensure(this.offset + 4);
    writeU32(this.buffer, this.offset, value);
    this.offset += 4;
  }

  reserveU32(): number {
    const offset = this.offset;
    this.writeU32(0);
    return offset;
  }

  patchU32(offset: number, value: number): void {
    writeU32(this.buffer, offset, value);
  }

  pad(alignment: number): void {
    const next = align(this.offset, alignment);
    this.ensure(next);
    this.offset = next;
  }

  toBytes(): Uint8Array {
    return this.buffer.slice(0, this.offset);
  }

  private ensure(length: number): void {
    if (length <= this.buffer.length) return;
    let nextLength = this.buffer.length;
    while (nextLength < length) nextLength *= 2;
    const next = new Uint8Array(nextLength);
    next.set(this.buffer);
    this.buffer = next;
  }
}
