import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readAscii, readU16, readU32 } from "../src/nds/binary";
import { buildPokemonFlipbookRigFromGif, defaultPokemonFlipbookImportConfig } from "../src/pokeweb/pokemonFlipbookRig";
import { decompressNitro, parsePokemonAnimation, parsePokemonCellBank } from "../src/pokeweb/pokemonSpriteModel";
import { buildPokemonAnimationFile, buildPokemonMultiCellsFileFromCells, parsePokemonAnimationBundle } from "../src/pokeweb/pokemonSpriteWriters";

const [gifPath = "/path/to/Docs/740.gif", vanillaDirArg = "analysis/nmcr-max-groups", outDirArg = "analysis/crashing-grouped-macro"] = process.argv.slice(2);
const outDir = path.resolve(outDirArg);
const vanillaDir = path.resolve(vanillaDirArg);
await mkdir(outDir, { recursive: true });

const safeResult = buildPokemonFlipbookRigFromGif(new Uint8Array(await readFile(gifPath)), {
  ...defaultPokemonFlipbookImportConfig("front"),
  packingMode: "macro-blocks",
  strategy: "loop-rest",
});
const safeBundle = parsePokemonAnimationBundle(safeResult.bundle);
const safeNcer = safeBundle.files[4]!;
const safeNanr = decompressNitro(safeBundle.files[5]!);
const safeNmcr = safeBundle.files[6]!;
const safeNmar = safeBundle.files[7]!;
const safeNcec = safeBundle.files[8]!;

const safeCellBank = parsePokemonCellBank(safeNcer);
const safeAnimation = parsePokemonAnimation(safeNanr);
const safeMultiAnimation = parsePokemonAnimation(safeNmar, "front", "RAMN");
const timelineLength = Math.max(0, ...safeAnimation.sequences.map((sequence) => sequence.frames.length));
const loopDuration = safeMultiAnimation.sequences[0]?.frames[0]?.duration
  ?? safeAnimation.sequences[0]?.frames.reduce((sum, frame) => sum + frame.duration, 0)
  ?? 1;

const crashNanr = buildPokemonAnimationFile({
  targetType: 1,
  frames: Array.from({ length: Math.max(0, safeCellBank.cells.length - 1) }, (_, index) => [{
    duration: loopDuration,
    cellIndex: index + 1,
    x: 0,
    y: 0,
    rotation: 0,
    xScale: 1,
    yScale: 1,
  }]),
});
const poseGroups = reconstructPoseGroups(safeAnimation, timelineLength);
const crashNmcr = buildPokemonMultiCellsFileFromCells(poseGroups.groups);
const crashNmar = buildPokemonAnimationFile({
  targetType: 2,
  frames: [
    poseGroups.timeline.map((groupIndex, frameIndex) => ({
      duration: safeAnimation.sequences[0]?.frames[frameIndex]?.duration ?? 1,
      cellIndex: groupIndex,
      x: 0,
      y: 0,
      rotation: 0,
      xScale: 1,
      yScale: 1,
    })),
  ],
});

await writeFile(path.join(outDir, "740-safe-file4-ncer.bin"), safeNcer);
await writeFile(path.join(outDir, "740-safe-file5-nanr.raw.bin"), safeNanr);
await writeFile(path.join(outDir, "740-safe-file6-nmcr.bin"), safeNmcr);
await writeFile(path.join(outDir, "740-safe-file7-nmar.bin"), safeNmar);
await writeFile(path.join(outDir, "740-safe-file8-ncec.bin"), safeNcec);
await writeFile(path.join(outDir, "740-crash-file4-ncer.bin"), safeNcer);
await writeFile(path.join(outDir, "740-crash-file5-nanr.raw.bin"), crashNanr);
await writeFile(path.join(outDir, "740-crash-file6-nmcr.bin"), crashNmcr);
await writeFile(path.join(outDir, "740-crash-file7-nmar.bin"), crashNmar);
await writeFile(path.join(outDir, "740-crash-file8-ncec.bin"), safeNcec);

const vanillaFront = await readVanillaSet("sprite-597-front");
const vanillaBack = await readVanillaSet("sprite-597-back");
const report = [
  "# Grouped Macro Crash Comparison",
  "",
  `gif=${path.resolve(gifPath)}`,
  `outDir=${outDir}`,
  "",
  "## Safe Current 740 Macro",
  `report=${JSON.stringify(safeResult.report)}`,
  formatNmcr("safe 740 NMCR", safeNmcr),
  formatNanr("safe 740 NANR", safeNanr),
  formatNanr("safe 740 NMAR", safeNmar),
  "",
  "## Reconstructed Previous Crashing Grouped 740 Macro",
  `poseGroups=${poseGroups.groups.length} groupNodeCounts=${poseGroups.groups.map((group) => group.length).join("/")}`,
  `timelineGroupIndexes=${poseGroups.timeline.join(",")}`,
  formatNmcr("crash 740 NMCR", crashNmcr),
  formatNanr("crash 740 NANR", crashNanr),
  formatNanr("crash 740 NMAR", crashNmar),
  "",
  "## Vanilla Max-Group Sprite 597 Front",
  formatNmcr("vanilla 597 front NMCR", vanillaFront.nmcr),
  formatNanr("vanilla 597 front NANR", decompressMaybe(vanillaFront.nanr)),
  formatNanr("vanilla 597 front NMAR", decompressMaybe(vanillaFront.nmar)),
  "",
  "## Vanilla Max-Group Sprite 597 Back",
  formatNmcr("vanilla 597 back NMCR", vanillaBack.nmcr),
  formatNanr("vanilla 597 back NANR", decompressMaybe(vanillaBack.nanr)),
  formatNanr("vanilla 597 back NMAR", decompressMaybe(vanillaBack.nmar)),
  "",
  "## Byte-Level Finding",
  "- Vanilla multi-group NMCR is real: sprite 597 uses 6 groups and NMAR indexes 0..5.",
  "- The reconstructed crash variant differs structurally from vanilla in how NMCR nodes point at cell-animation sequence numbers: vanilla 597 groups are one-node groups over a small matching NANR sequence set, while grouped macro creates many nodes per group that reference static chunk sequences.",
  "- If the engine allocates or advances per-cell animation controllers from each group record, this grouped macro layout combines high group switching with many node/sequence references per group. The safe macro layout keeps two duplicated groups and puts the time-varying swaps in cell NANR instead.",
].join("\n");
await writeFile(path.join(outDir, "comparison.md"), `${report}\n`);
console.log(report);

function reconstructPoseGroups(animation: ReturnType<typeof parsePokemonAnimation>, frameCount: number): {
  groups: Array<Array<{ sequenceNumber: number; cellAnimationIndex: number; x: number; y: number }>>;
  timeline: number[];
} {
  const groupIndexes = new Map<string, number>();
  const groups: Array<Array<{ sequenceNumber: number; cellAnimationIndex: number; x: number; y: number }>> = [];
  const timeline: number[] = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const cells = animation.sequences
      .map((sequence, slotIndex) => ({ slotIndex, cellIndex: sequence.frames[frameIndex]?.cellIndex ?? 0 }))
      .filter((entry) => entry.cellIndex > 0);
    const key = cells.map((entry) => entry.cellIndex).join(",");
    let groupIndex = groupIndexes.get(key);
    if (groupIndex === undefined) {
      groupIndex = groups.length;
      groupIndexes.set(key, groupIndex);
      groups.push(cells.map((entry, nodeIndex) => ({
        sequenceNumber: Math.max(0, entry.cellIndex - 1),
        cellAnimationIndex: nodeIndex,
        x: 0,
        y: 0,
      })));
    }
    timeline.push(groupIndex);
  }
  return { groups, timeline };
}

async function readVanillaSet(name: string): Promise<{ nanr: Uint8Array; nmcr: Uint8Array; nmar: Uint8Array }> {
  const dir = path.join(vanillaDir, name);
  const side = name.endsWith("front") ? "front" : "back";
  const nanrIndex = side === "front" ? 5 : 14;
  const nmcrIndex = side === "front" ? 6 : 15;
  const nmarIndex = side === "front" ? 7 : 16;
  return {
    nanr: new Uint8Array(await readFile(path.join(dir, `file${nanrIndex}-nanr.bin`))),
    nmcr: new Uint8Array(await readFile(path.join(dir, `file${nmcrIndex}-nmcr.bin`))),
    nmar: new Uint8Array(await readFile(path.join(dir, `file${nmarIndex}-nmar.bin`))),
  };
}

function decompressMaybe(bytes: Uint8Array): Uint8Array {
  return bytes[0] === 0x11 ? decompressNitro(bytes) : bytes;
}

function formatNmcr(label: string, bytes: Uint8Array): string {
  const mcbk = blockPayload(bytes, "MCBK");
  if (!mcbk) return `### ${label}\nmissing MCBK`;
  const count = readU16(bytes, mcbk.offset);
  const multiCellOffset = readU32(bytes, mcbk.offset + 4);
  const hierarchyOffset = readU32(bytes, mcbk.offset + 8);
  const stringBankOffset = readU32(bytes, mcbk.offset + 0x0c);
  const extendedOffset = readU32(bytes, mcbk.offset + 0x10);
  const lines = [
    `### ${label}`,
    `len=${bytes.length} groups=${count} pad=0x${readU16(bytes, mcbk.offset + 2).toString(16)} multiOff=0x${hex(multiCellOffset)} hierOff=0x${hex(hierarchyOffset)} stringOff=0x${hex(stringBankOffset)} extOff=0x${hex(extendedOffset)}`,
  ];
  const multiBase = mcbk.offset + multiCellOffset;
  const hierarchyBase = mcbk.offset + hierarchyOffset;
  for (let index = 0; index < count; index += 1) {
    const record = multiBase + index * 8;
    const nodeCount = readU16(bytes, record);
    const cellAnimationCount = readU16(bytes, record + 2);
    const nodeOffset = readU32(bytes, record + 4);
    lines.push(`group[${index}] raw=${hexBytes(bytes, record, 8)} nodes=${nodeCount} cellAnim=${cellAnimationCount} hierarchyOffset=0x${hex(nodeOffset)}`);
    for (let nodeIndex = 0; nodeIndex < Math.min(nodeCount, 12); nodeIndex += 1) {
      const node = hierarchyBase + nodeOffset + nodeIndex * 8;
      const attr = readU16(bytes, node + 6);
      lines.push(`  node[${nodeIndex}] raw=${hexBytes(bytes, node, 8)} seq=${readU16(bytes, node)} x=${readS16(bytes, node + 2)} y=${readS16(bytes, node + 4)} attr=0x${attr.toString(16).padStart(4, "0")} cellAnim=${(attr >>> 8) & 0xff} visible=${((attr >>> 5) & 1) === 1}`);
    }
    if (nodeCount > 12) lines.push(`  ... ${nodeCount - 12} more nodes`);
  }
  return lines.join("\n");
}

function formatNanr(label: string, bytes: Uint8Array): string {
  const abnk = blockPayload(bytes, "ABNK");
  if (!abnk) return `### ${label}\nmissing ABNK`;
  const sequenceCount = readU16(bytes, abnk.offset);
  const frameCount = readU16(bytes, abnk.offset + 2);
  const sequenceArrayOffset = readU32(bytes, abnk.offset + 4);
  const frameArrayOffset = readU32(bytes, abnk.offset + 8);
  const valueOffset = readU32(bytes, abnk.offset + 0x0c);
  const lines = [
    `### ${label}`,
    `len=${bytes.length} seq=${sequenceCount} totalFrames=${frameCount} seqOff=0x${hex(sequenceArrayOffset)} frameOff=0x${hex(frameArrayOffset)} valueOff=0x${hex(valueOffset)}`,
  ];
  for (let index = 0; index < sequenceCount; index += 1) {
    const sequence = abnk.offset + sequenceArrayOffset + index * 0x10;
    const nFrames = readU16(bytes, sequence);
    const startFrameIndex = readU16(bytes, sequence + 2);
    const type = readU32(bytes, sequence + 4);
    const mode = readU32(bytes, sequence + 8);
    const sequenceFrameOffset = readU32(bytes, sequence + 0x0c);
    const motionType = type & 0xffff;
    lines.push(`seq[${index}] raw=${hexBytes(bytes, sequence, 0x10)} frames=${nFrames} start=${startFrameIndex} motion=${motionType} target=${type >>> 16} mode=${mode} frameDataOff=0x${hex(sequenceFrameOffset)}`);
    for (let frameIndex = 0; frameIndex < Math.min(nFrames, 10); frameIndex += 1) {
      const frameRecord = abnk.offset + frameArrayOffset + sequenceFrameOffset + frameIndex * 8;
      const animValueOffset = readU32(bytes, frameRecord);
      const duration = readU16(bytes, frameRecord + 4);
      const value = abnk.offset + valueOffset + animValueOffset;
      lines.push(`  frame[${frameIndex}] frameRaw=${hexBytes(bytes, frameRecord, 8)} valueRaw=${hexBytes(bytes, value, animationValueSize(motionType))} valueOff=0x${hex(animValueOffset)} duration=${duration} ${formatAnimationValue(bytes, motionType, value)}`);
    }
    if (nFrames > 10) lines.push(`  ... ${nFrames - 10} more frames`);
  }
  return lines.join("\n");
}

function animationValueSize(motionType: number): number {
  if (motionType === 1) return 16;
  if (motionType === 2) return 8;
  return 2;
}

function formatAnimationValue(bytes: Uint8Array, motionType: number, value: number): string {
  if (motionType === 1) {
    return [
      `index=${readU16(bytes, value)}`,
      `rot=0x${hex(readU16(bytes, value + 2))}`,
      `sx=0x${hex32(readU32(bytes, value + 4))}`,
      `sy=0x${hex32(readU32(bytes, value + 8))}`,
      `px=${readS16(bytes, value + 0x0c)}`,
      `py=${readS16(bytes, value + 0x0e)}`,
    ].join(" ");
  }
  if (motionType === 2) {
    return [
      `index=${readU16(bytes, value)}`,
      `pad=0x${hex(readU16(bytes, value + 2))}`,
      `px=${readS16(bytes, value + 4)}`,
      `py=${readS16(bytes, value + 6)}`,
    ].join(" ");
  }
  return `index=${readU16(bytes, value)}`;
}

function blockPayload(bytes: Uint8Array, signature: string): { offset: number; size: number } | undefined {
  const blockCount = readU16(bytes, 0x0e);
  let offset = readU16(bytes, 0x0c);
  for (let index = 0; index < blockCount; index += 1) {
    const sig = readAscii(bytes, offset, 4).split("").reverse().join("");
    const size = readU32(bytes, offset + 4);
    if (sig === signature) return { offset: offset + 8, size: size - 8 };
    offset += size;
  }
  return undefined;
}

function readS16(bytes: Uint8Array, offset: number): number {
  const value = readU16(bytes, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

function hex(value: number): string {
  return value.toString(16).padStart(4, "0");
}

function hex32(value: number): string {
  return value.toString(16).padStart(8, "0");
}

function hexBytes(bytes: Uint8Array, offset: number, length: number): string {
  return Array.from(bytes.slice(offset, offset + length), (byte) => byte.toString(16).padStart(2, "0")).join(" ");
}
