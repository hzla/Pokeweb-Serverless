import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadHgMoveAnimationRom, parseHgMoveAnimationBinary, type HgMoveAnimationArchiveKind } from "../src/pokeweb/hgMoveAnimationModel";

type CommandUse = {
  count: number;
  files: Set<string>;
  paramSamples: Map<string, number>;
};

const romPath = resolve(process.argv[2] ?? "../cleangold.nds");
const state = loadHgMoveAnimationRom(readFileSync(romPath));
const uses = new Map<string, CommandUse>();

for (const archiveKind of ["move", "sub"] satisfies HgMoveAnimationArchiveKind[]) {
  const archive = state.archives[archiveKind];
  archive.narc.files.forEach((bytes, fileId) => {
    if (bytes.length === 0) return;
    let commands;
    try {
      commands = parseHgMoveAnimationBinary(bytes);
    } catch {
      return;
    }
    for (const command of commands) {
      const key = command.name;
      const use = uses.get(key) ?? { count: 0, files: new Set<string>(), paramSamples: new Map<string, number>() };
      use.count += 1;
      use.files.add(`${archiveKind}:${fileId}`);
      const params = command.params.join(", ");
      use.paramSamples.set(params, (use.paramSamples.get(params) ?? 0) + 1);
      uses.set(key, use);
    }
  });
}

const commandRows = [...uses.entries()]
  .sort(([left], [right]) => commandOrder(left) - commandOrder(right) || left.localeCompare(right))
  .map(([name, use]) => {
    const samples = [...use.paramSamples.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([params, count]) => (params.length === 0 ? `none (${count})` : `${params} (${count})`))
      .join("; ");
    return {
      name,
      count: use.count,
      fileCount: use.files.size,
      examples: [...use.files].slice(0, 8).join(", "),
      samples,
    };
  });

const callfunctions = collectParamSignature("callfunction", 0);
const cmd36 = collectParamSignature("cmd36", 0);
const cmd37Modes = collectParamSignature("cmd37", 3);
const cmd37Fields = collectParamSignature("cmd37", 5);
const cmd0cVars = collectParamSignature("cmd0C", 0);
const changebgFlags = collectParamSignature("changebg", 1);
const resetbgFlags = collectParamSignature("resetbg", 1);

writeSection("HG/HG-Engine animation command usage audit");
console.log("");
console.log(`ROM: ${romPath}`);
console.log(`Move files: ${state.archives.move.narc.files.length}`);
console.log(`Sub-animation files: ${state.archives.sub.narc.files.length}`);
console.log("");
writeTable(
  ["Command", "Uses", "Files", "Example files", "Common params"],
  commandRows.map((row) => [row.name, String(row.count), String(row.fileCount), row.examples, row.samples]),
);
console.log("");
writeSignatureTable("callfunction ids", callfunctions);
writeSignatureTable("cmd36 function ids", cmd36);
writeSignatureTable("cmd37 position/operator modes", cmd37Modes);
writeSignatureTable("cmd37 field bitsets", cmd37Fields);
writeSignatureTable("cmd0C work variables", cmd0cVars);
writeSignatureTable("changebg flag values", changebgFlags);
writeSignatureTable("resetbg flag values", resetbgFlags);

function collectParamSignature(commandName: string, paramIndex: number): Array<[string, number, number, string]> {
  const grouped = new Map<string, { count: number; files: Set<string> }>();
  for (const archiveKind of ["move", "sub"] satisfies HgMoveAnimationArchiveKind[]) {
    const archive = state.archives[archiveKind];
    archive.narc.files.forEach((bytes, fileId) => {
      if (bytes.length === 0) return;
      let commands;
      try {
        commands = parseHgMoveAnimationBinary(bytes);
      } catch {
        return;
      }
      for (const command of commands) {
        if (command.name !== commandName) continue;
        const value = command.params[paramIndex];
        const key = value === undefined ? "missing" : String(value);
        const entry = grouped.get(key) ?? { count: 0, files: new Set<string>() };
        entry.count += 1;
        entry.files.add(`${archiveKind}:${fileId}`);
        grouped.set(key, entry);
      }
    });
  }
  return [...grouped.entries()]
    .sort(([aKey, a], [bKey, b]) => numericKey(aKey) - numericKey(bKey) || b.count - a.count)
    .map(([key, value]) => [key, value.count, value.files.size, [...value.files].slice(0, 8).join(", ")]);
}

function commandOrder(name: string): number {
  const match = /^cmd([0-9a-f]{2})$/iu.exec(name);
  if (match) return Number.parseInt(match[1], 16);
  const known = new Map<string, number>([
    ["wait", 0],
    ["waitstate", 1],
    ["loop", 2],
    ["doloop", 3],
    ["end", 4],
    ["playse", 5],
    ["call", 10],
    ["return", 11],
    ["changebg", 16],
    ["resetbg", 18],
    ["callfunction", 45],
    ["addparticle", 46],
    ["loadparticle", 47],
    ["unloadparticle", 49],
    ["cmd36", 54],
    ["cmd37", 55],
  ]);
  return known.get(name) ?? 999;
}

function numericKey(value: string): number {
  if (value === "missing") return Number.POSITIVE_INFINITY;
  return Number(value);
}

function writeSection(title: string): void {
  console.log(`# ${title}`);
}

function writeSignatureTable(title: string, rows: Array<[string, number, number, string]>): void {
  console.log(`## ${title}`);
  writeTable(
    ["Value", "Uses", "Files", "Example files"],
    rows.map(([value, count, files, examples]) => [value, String(count), String(files), examples]),
  );
  console.log("");
}

function writeTable(headers: string[], rows: string[][]): void {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.map(escapeCell).join(" | ")} |`);
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}
