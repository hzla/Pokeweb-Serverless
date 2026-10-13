import { bw2CommandByName } from "./bw2ScriptCompiler/commands";
import { parseBw2Script } from "./bw2ScriptCompiler/parser";
import { bw2ScriptMacroByName } from "./bw2ScriptCompiler/macros";
import type { Definition, Statement, SourcePosition } from "./bw2ScriptCompiler/types";
import { parseHeaders, type HeaderRow } from "./headerModel";
import type { ProjectState } from "./projectStore";
import type { OverworldEntitySelection, OverworldScene } from "./overworldModel";
import type { Bw2ScriptCall } from "./bw2ScriptTextModel";

export type Bw2ScriptMapChoice = { headerRowId: number; zoneId: number; overworldId: number; label: string; header: HeaderRow };
export type Bw2ScriptFocus = { name: string; kind: Definition["kind"] | "movement"; entries: number[]; line: number; endLine: number };
type Section = { name: string; kind: Bw2ScriptFocus["kind"]; line: number; endLine: number; entry?: number; labels: string[]; targets: string[] };

export function bw2ScriptMapChoices(project: ProjectState, fileId: number): Bw2ScriptMapChoice[] {
  if (!project.headers && project.narcs.headers && project.formats.headers) project.headers = parseHeaders(project);
  return Object.entries(project.headers?.rows ?? {}).filter(([, row]) => Number(row.script_id) === fileId).map(([id, header]) => ({
    headerRowId: Number(id), zoneId: header.index, overworldId: Number(header.overworlds_id ?? header.map_id),
    label: `${header.location_name} · Zone ${header.index} · Events ${header.overworlds_id ?? header.map_id}`, header,
  }));
}

/** Map work is read-only: entity script IDs are one-based local entry slots. */
export function bw2ScriptAssignedEntities(scene: OverworldScene, entries: readonly number[]): OverworldEntitySelection[] {
  const selected = new Set(entries);
  return [
    ...scene.npcs.filter((npc) => selected.has(Number(scene.raw[`npc_${npc.index}_script_id`]))).map((npc) => ({ kind: "npc" as const, index: npc.index })),
    ...scene.furniture.filter((item) => selected.has(item.script)).map((item) => ({ kind: "furniture" as const, index: item.index })),
    ...scene.triggers.filter((item) => selected.has(item.script)).map((item) => ({ kind: "trigger" as const, index: item.index })),
  ];
}

export function bw2ScriptNpcCommandTarget(project: ProjectState, sourceLine: string, scene: OverworldScene, overlayId?: number, constants?: ReadonlyMap<string, number>): OverworldEntitySelection | undefined {
  const match = /^\s*([a-zA-Z_]\w*)\s*\(?\s*([^,\s)]+)/.exec(sourceLine);
  if (!match) return;
  const command = bw2CommandByName(match[1], true, overlayId);
  // Commands whose first operand is a local actor ID, never a script/work destination.
  if (!command || ![0x64, 0x6b, 0x6c, 0x6d].includes(command.opcode)) return;
  const id = /^(0x[\da-f]+|\d+)$/i.test(match[2]) ? Number(match[2]) : constants?.get(match[2]);
  // Work/literal operands at 0x4000+ read runtime storage, not an actor ID.
  if (id === undefined || !Number.isInteger(id) || id < 0 || id >= 0x4000) return;
  const npc = scene.npcs.find((npc) => npc.overworldId === id);
  return npc ? { kind: "npc", index: npc.index } : undefined;
}

/** Only the symbolic movement operand is a navigation target, never comments
 * or another symbol elsewhere on the line. Works during incomplete edits. */
export function bw2ScriptMovementReferenceAt(sourceLine: string, column: number, overlayId?: number): string | undefined {
  const text = sourceLine.replace(/#.*$/, "");
  const match = /^\s*([A-Za-z_]\w*)\s*\(?\s*[^,\s)]+\s*,\s*(:([A-Za-z_]\w*))/.exec(text);
  if (!match || bw2CommandByName(match[1], true, overlayId)?.opcode !== 0x64) return;
  const from = match[0].length - match[2].length;
  return column - 1 >= from && column - 1 <= from + match[2].length ? match[3] : undefined;
}

/** Parse once per edit; selection changes query a small immutable call graph. */
export function buildBw2ScriptSourceContext(source: string): { definitions: Bw2ScriptFocus[]; workBindings: ReadonlyMap<string, number>; constantBindings: ReadonlyMap<string, number>; callAt: (line: number) => Bw2ScriptCall | undefined; callsBefore: (line: number) => Bw2ScriptCall[]; movementDefinition: (name: string) => SourcePosition | undefined; focusAt: (line: number) => Bw2ScriptFocus | undefined } {
  let sections: Section[] = [];
  let aliases: { entry: number; target: string }[] = [];
  const workBindings = new Map<string, number>();
  const constantBindings = new Map<string, number>();
  const movements = new Map<string, SourcePosition>();
  const calls: Bw2ScriptCall[] = [];
  const indexMacro = (statement: Extract<Statement, { kind: "macro" }>, lineOffset = 0): void => {
    const macro = bw2ScriptMacroByName(statement.name)!;
    // Preserve the visible invocation for help, with arguments in registry
    // order rather than source keyword order. Text lookup can inspect its
    // verified message expansion without adding local call-graph edges.
    calls.push({ kind: "call", name: statement.name, line: statement.line + lineOffset, column: statement.column,
      args: macro.parameters.map((parameter) => ({ ...statement.keywords[parameter.name], line: statement.keywords[parameter.name].line + lineOffset })) });
  };
  try {
    const program = parseBw2Script(source);
    for (const binding of program.bindings) (binding.kind === "work" ? workBindings : constantBindings).set(binding.name, binding.value);
    aliases = program.aliases ?? [];
    const names = new Set(program.definitions.map((definition) => definition.name));
    const collect = (statements: Statement[], section: Section): void => {
      for (const statement of statements) {
        if (statement.kind === "label") section.labels.push(statement.target);
        else if (statement.kind === "jump") section.targets.push(statement.target);
        else if (statement.kind === "macro") {
          indexMacro(statement);
        }
        else if (statement.kind === "call") {
          calls.push({ ...statement, helperOnly: statement.helperOnly || names.has(statement.name) });
          if (statement.helperOnly || names.has(statement.name)) section.targets.push(statement.name);
          else {
            const command = bw2CommandByName(statement.name, program.preserveLayout, program.overlayId);
            for (const [index, kind] of Object.entries(command?.relative ?? {})) {
              const arg = statement.args[Number(index)];
              if ((kind === "call" || kind === "jump" || kind === "movement") && arg?.kind === "symbol") section.targets.push(arg.name);
            }
          }
        } else if (statement.kind === "if") { statement.branches.forEach((branch) => collect(branch.body, section)); collect(statement.otherwise, section); }
        else if (statement.kind === "loop") collect(statement.body, section);
        else if (statement.kind === "case") { statement.cases.forEach((branch) => collect(branch.body, section)); collect(statement.otherwise, section); }
      }
    };
    sections = program.definitions.map((definition) => {
      const section: Section = { ...definition, endLine: definition.endLine ?? definition.line, labels: [], targets: [] };
      collect(definition.body, section); return section;
    });
    for (const block of program.layout ?? []) if (block.kind === "movement") {
      sections.push({ ...block, labels: block.body.filter((step) => step.kind === "label").map((step) => step.target), targets: [] });
      movements.set(block.name, { line: block.line, column: block.column });
      for (const step of block.body) if (step.kind === "label") movements.set(step.target, { line: step.line, column: step.column });
    }
    sections.sort((a, b) => a.line - b.line);
  } catch {
    // While an argument is incomplete, keep navigation usable without trusting stale compiled code.
    const lines = source.split(/\r?\n/);
    workBindings.clear();
    constantBindings.clear(); movements.clear();
    calls.length = 0;
    let section: Section | undefined, depth = 0;
    for (const [index, full] of lines.entries()) {
      const text = full.replace(/#.*$/, "").trim();
      const binding = /^work\s+:(\w+),\s*(0x[\da-f]+|\d+)\s*$/i.exec(text);
      if (binding) workBindings.set(binding[1], Number(binding[2]));
      const constant = /^([A-Z][A-Z_0-9]*)\s*=\s*(0[xX][\da-fA-F]+|\d+)\s*$/.exec(text);
      if (constant) constantBindings.set(constant[1], Number(constant[2]));
      const start = /^(script|block|movement)\s+:(\w+)(?:,\s*(?:entry:\s*(\d+)|before:\s*:\w+))?\s+do\b/.exec(text) ?? /^(def)\s+(\w+)/.exec(text);
      if (start) {
        if (section) section.endLine = index;
        section = { name: start[2], kind: start[1] === "def" ? "helper" : start[1] as Section["kind"], line: index + 1, endLine: lines.length, entry: start[3] ? Number(start[3]) : undefined, labels: [], targets: [] };
        sections.push(section);
        if (section.kind === "movement") movements.set(section.name, { line: section.line, column: 1 });
        depth = 1; continue;
      }
      const alias = /^entry\s+(\d+),\s*:(\w+)/.exec(text);
      if (alias) aliases.push({ entry: Number(alias[1]), target: alias[2] });
      if (!section) continue;
      if (section.kind !== "movement") {
        const call = /^([A-Za-z_]\w*)\s*(?:\(([^()]*)\)|([^()]*))$/.exec(text);
        const operands = (call?.[2] ?? call?.[3] ?? "").trim();
        if (call && bw2ScriptMacroByName(call[1])) {
          // A complete single-line macro remains navigable while another
          // part of the draft is incomplete. Reuse the keyword parser so
          // missing/duplicate arguments never become guessed text IDs.
          try {
            const first = parseBw2Script(`script :cursor_context, entry: 1 do\n${text}\nend\n`).definitions[0].body[0];
            const statement = first?.kind === "if" ? first.branches[0]?.body[0] : first;
            if (statement?.kind === "macro") indexMacro(statement, index - 1);
          } catch { /* Keep incomplete macro arguments unresolved. */ }
        } else if (call && operands && operands.split(",").every((arg) => /^\s*(?:0x[\da-f]+|\d+|[A-Za-z_]\w*)\s*$/i.test(arg))) {
          calls.push({ kind: "call", name: call[1], line: index + 1, column: 1, args: operands.split(",").map((arg) => /^(?:0x[\da-f]+|\d+)$/i.test(arg.trim()) ? { kind: "number", value: Number(arg.trim()), line: index + 1, column: 1 } : { kind: "name", name: arg.trim(), line: index + 1, column: 1 }) });
        }
      }
      if (/^(if|unless|while|until|case)\b/.test(text)) depth++;
      if (/^end\b/.test(text) && --depth <= 0) { section.endLine = index + 1; section = undefined; continue; }
      const label = /^label\s+:(\w+)/.exec(text);
      if (label) section.labels.push(label[1]);
      if (section.kind === "movement" && label) movements.set(label[1], { line: index + 1, column: full.length - full.trimStart().length + 1 });
      const target = /^(?:call|jump)\s*\(?\s*:(\w+)/.exec(text);
      if (target) section.targets.push(target[1]);
      else {
        const call = /^(\w+)\s*(?:\(|$|if\b|unless\b)/.exec(text);
        if (call) section.targets.push(call[1]);
        const lowLevel = /^(?:jump_if|call_if|cmd_0004|cmd_001e|cmd_001f|cmd_0020|cmd_0064|apply_movement|vm_call|vm_jump)\b.*?:(\w+)/.exec(text);
        if (lowLevel) section.targets.push(lowLevel[1]);
      }
    }
  }
  const owners = new Map<string, Section>();
  for (const section of sections) for (const name of [section.name, ...section.labels]) owners.set(name, section);
  const roots = sections.flatMap((section) => section.entry !== undefined ? [{ entry: section.entry, target: section.name }] : []).concat(aliases);
  const entryOwners = new Map<Section, Set<number>>();
  for (const root of roots) {
    const pending = [owners.get(root.target)], seen = new Set<Section>();
    while (pending.length) {
      const section = pending.pop();
      if (!section || seen.has(section)) continue;
      seen.add(section);
      const entries = entryOwners.get(section) ?? new Set<number>();
      entries.add(root.entry); entryOwners.set(section, entries);
      section.targets.forEach((target) => pending.push(owners.get(target)));
    }
  }
  const focusFor = (section: Section): Bw2ScriptFocus => ({ name: section.name, kind: section.kind, line: section.line, endLine: section.endLine, entries: [...(entryOwners.get(section) ?? [])].sort((a, b) => a - b) });
  return { definitions: sections.map(focusFor), workBindings, constantBindings, callAt: (line) => calls.find((call) => call.line <= line && line <= Math.max(call.line, ...call.args.map((arg) => arg.line))), callsBefore: (line) => { const section = sections.find((section) => section.line <= line && line <= section.endLine); return section ? calls.filter((call) => section.line <= call.line && call.line < line) : []; }, movementDefinition: (name) => movements.get(name), focusAt: (line) => {
    const section = sections.find((section) => section.line <= line && line <= section.endLine);
    return section ? focusFor(section) : undefined;
  } };
}
