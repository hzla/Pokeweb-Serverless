import { compileBw2Script, type SourcePosition } from "./bw2ScriptCompiler";
import { parseBw2Script } from "./bw2ScriptCompiler/parser";

export type Bw2ScriptStructureEdit = { source: string; position: SourcePosition; mapping?: number[]; entry?: number; name: string };
const validName = (name: string) => { if (!/^[a-zA-Z_]\w*$/.test(name)) throw new Error("Use a script name containing letters, digits and underscores."); return name; };
const lines = (source: string) => source.split("\n");
const unique = (source: string, base: string) => { let name = base, n = 2; while (new RegExp(`\\b${name}\\b`).test(source)) name = `${base}_${n++}`; return name; };
const imported = (source: string) => { const program = parseBw2Script(source); if (!program.preserveLayout) throw new Error("Decompile from ROM before changing script entries."); return program; };

export function addBw2ScriptEntry(source: string, requestedName?: string): Bw2ScriptStructureEdit {
  imported(source);
  const compiled = compileBw2Script(source), entry = compiled.entries.length + 1;
  const name = validName(requestedName ?? unique(source, `script_${entry}`));
  const offset = /^\s*movement\s+:/m.exec(source)?.index ?? source.length;
  const prefix = source.slice(0, offset), separator = prefix.endsWith("\n") ? "\n" : "\n\n";
  const next = prefix + separator + `script :${name}, entry: ${entry} do\n  halt\nend\n\n` + source.slice(offset);
  compileBw2Script(next);
  return { source: next, name, entry, position: { line: (prefix + separator).split("\n").length, column: 1 }, mapping: compiled.entries.map((item) => item.entry) };
}

/** Remove the public slot. Code reached by local calls/jumps/shared slots or
 * fallthrough stays as a block; unreferenced code becomes an empty anchor. */
export function removeBw2ScriptEntry(source: string, entry: number, redirect = 0): Bw2ScriptStructureEdit {
  const program = imported(source), compiled = compileBw2Script(source), count = compiled.entries.length;
  if (!Number.isInteger(entry) || entry < 1 || entry > count) throw new Error("Select an existing entry to remove.");
  if (!Number.isInteger(redirect) || redirect < 0 || redirect > count || redirect === entry) throw new Error("Choose another entry as the replacement, or 0 to detach event assignments.");
  const selected = compiled.entries[entry - 1], mapping = compiled.entries.map((item) => {
    const destination = item.entry === entry ? redirect : item.entry;
    return destination > entry ? destination - 1 : destination;
  });
  if (count === 1) return { source: `# Empty BW2 script entry table.\npreserve_layout\n${program.overlayId !== undefined ? `overlay ${program.overlayId}\n` : ""}`, name: selected.name, position: { line: 2, column: 1 }, mapping };
  const text = lines(source), definition = program.definitions.find((item) => item.kind === "script" && item.entry === entry);
  const alias = program.aliases?.find((item) => item.entry === entry);
  for (const item of [...program.definitions.filter((item) => item.kind === "script"), ...program.aliases ?? []]) {
    if (item.entry! > entry) text[item.line - 1] = text[item.line - 1].replace("kind" in item && item.kind === "script" ? /(entry:\s*)(?:0[xX][\da-fA-F]+|\d+)/ : /^(\s*entry\s+)(?:0[xX][\da-fA-F]+|\d+)/, (_match, prefix: string) => prefix + (item.entry! - 1));
  }
  if (definition) {
    const block = compiled.codeBlocks?.find((item) => item.name === definition.name) ?? { offset: selected.offset, endOffset: selected.offset };
    const shared = compiled.entries.some((item) => item.entry !== entry && item.offset >= block.offset && item.offset < block.endOffset);
    const incoming = compiled.relocations.some((ref) => (ref.kind === "call" || ref.kind === "jump") && ref.targetOffset >= block.offset && ref.targetOffset < block.endOffset && (ref.operandOffset < block.offset || ref.operandOffset >= block.endOffset));
    const previous = compiled.instructions.filter((item) => item.offset < block.offset).at(-1);
    const fallthrough = previous && ![2, 5, 0x1d, 0x1e].includes(previous.opcode);
    const replacement = shared || incoming || fallthrough ? [text[definition.line - 1].replace(/^\s*script\s+:(\w+),\s*entry:\s*(?:0[xX][\da-fA-F]+|\d+)\s+do/, "block :$1 do"), ...text.slice(definition.line, definition.endLine)] : [`block :${definition.name} do`, "end"];
    text.splice(definition.line - 1, definition.endLine! - definition.line + 1, ...replacement);
  } else if (alias) text.splice(alias.line - 1, 1);
  const next = text.join("\n"); compileBw2Script(next);
  return { source: next, name: selected.name, mapping, position: { line: Math.min(definition?.line ?? alias!.line, text.length), column: 1 } };
}

export function clearBw2ScriptEntry(source: string, entry: number): Bw2ScriptStructureEdit {
  const program = imported(source), compiled = compileBw2Script(source), text = lines(source);
  if (!compiled.entries.some((item) => item.entry === entry)) throw new Error("Select an existing entry to clear.");
  const definition = program.definitions.find((item) => item.kind === "script" && item.entry === entry), alias = program.aliases?.find((item) => item.entry === entry);
  if (definition) text[definition.line - 1] = text[definition.line - 1].replace(/^\s*script\s+:(\w+),\s*entry:\s*(?:0[xX][\da-fA-F]+|\d+)\s+do/, "block :$1 do");
  else text.splice(alias!.line - 1, 1);
  const name = unique(source, `cleared_entry_${entry}`), retained = text.join("\n");
  const offset = /^\s*movement\s+:/m.exec(retained)?.index ?? retained.length;
  const prefix = retained.slice(0, offset) + "\n";
  const next = prefix + `script :${name}, entry: ${entry} do\n  halt\nend\n\n` + retained.slice(offset); compileBw2Script(next);
  return { source: next, entry, name, mapping: compiled.entries.map((item) => item.entry), position: { line: prefix.split("\n").length, column: 1 } };
}

export function addBw2ScriptMovement(source: string, requestedName?: string): Bw2ScriptStructureEdit {
  const program = imported(source);
  if (!program.movementAlignment) source = source.replace(/^(\s*preserve_layout\s*)$/m, "$1\nmovement_alignment 2");
  const name = validName(requestedName ?? unique(source, "new_movement")), prefix = source + (source.endsWith("\n") ? "\n" : "\n\n");
  const next = prefix + `movement :${name} do\n  face_up 1\nend\n`; compileBw2Script(next);
  return { source: next, name, position: { line: prefix.split("\n").length, column: 1 } };
}

export function removeBw2ScriptMovement(source: string, name: string): Bw2ScriptStructureEdit {
  const program = imported(source), compiled = compileBw2Script(source), block = program.layout?.find((item) => item.kind === "movement" && item.name === name);
  if (!block || block.kind !== "movement") throw new Error("Select a movement definition to remove.");
  const range = compiled.movementBlocks!.find((item) => item.name === name)!;
  if (compiled.relocations.some((ref) => ref.kind === "movement" && ref.targetOffset >= range.offset && ref.targetOffset < range.endOffset)) throw new Error("This movement or a shared tail is still used by apply_movement. Remove or change those calls first.");
  const text = lines(source); text.splice(block.line - 1, block.endLine - block.line + 1); const next = text.join("\n"); compileBw2Script(next);
  return { source: next, name, position: { line: Math.min(block.line, text.length), column: 1 } };
}
