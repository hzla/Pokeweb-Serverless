import { bw2CommandByName } from "./commands";
import { Bw2ScriptCompileError, type Definition, type Program, type SourcePosition, type Statement } from "./types";

// A conservative event-work pool below the 0x8054 ceiling used by the Gen V
// PokeScript backend. Engine/common parameter and result slots are excluded.
export const BW2_SCRATCH_WORK_FIRST = 0x8020;
export const BW2_SCRATCH_WORK_END = 0x8054;
export type HelperFrame = { parameters: { name: string; id: number }[]; locals: { name: string; id: number }[]; slots: number[]; bindings: Map<string, number> };
export type HelperFrames = { frames: Map<string, HelperFrame>; owners: Map<string, Definition>; managed: boolean };

export function visitBw2Statements(statements: readonly Statement[], visit: (statement: Statement) => void): void {
  for (const statement of statements) {
    visit(statement);
    if (statement.kind === "if") { statement.branches.forEach((branch) => visitBw2Statements(branch.body, visit)); visitBw2Statements(statement.otherwise, visit); }
    else if (statement.kind === "case") { statement.cases.forEach((branch) => visitBw2Statements(branch.body, visit)); visitBw2Statements(statement.otherwise, visit); }
    else if (statement.kind === "loop") visitBw2Statements(statement.body, visit);
  }
}

/** Every routine has a lexical scope. Slots can be reused between routines,
 * because calls snapshot arguments and preserve both caller and callee slots. */
export function planBw2HelperFrames(program: Program): HelperFrames {
  const globals = new Map(program.bindings.map((binding) => [binding.name, binding]));
  const unavailable = new Set<number>();
  // Reserve all explicit numeric references conservatively, including constants
  // and preserved data. A number resembling a work ID is never allocated over.
  const scan = (node: unknown): void => {
    if (typeof node === "number") { if (node >= BW2_SCRATCH_WORK_FIRST && node < BW2_SCRATCH_WORK_END) unavailable.add(node); }
    else if (Array.isArray(node)) node.forEach(scan);
    else if (node && typeof node === "object") for (const [key, value] of Object.entries(node)) if (key !== "line" && key !== "column" && key !== "endLine") scan(value);
  };
  scan(program);
  // Raw data encodes words as individual bytes rather than number operands.
  for (const block of program.layout ?? []) if (block.kind === "data") {
    for (let p = 0; p + 1 < block.bytes.length; p++) scan(block.bytes[p] | block.bytes[p + 1] << 8);
  }
  const available = Array.from({ length: BW2_SCRATCH_WORK_END - BW2_SCRATCH_WORK_FIRST }, (_, n) => BW2_SCRATCH_WORK_FIRST + n).filter((id) => !unavailable.has(id));
  const frames = new Map<string, HelperFrame>(), owners = new Map<string, Definition>();
  const fail = (message: string, position: SourcePosition): never => { throw new Bw2ScriptCompileError(message, position); };
  for (const definition of program.definitions) {
    owners.set(definition.name, definition);
    const parameters: HelperFrame["parameters"] = [], locals: HelperFrame["locals"] = [], bindings = new Map<string, number>();
    const allocate = (name: string, position: SourcePosition): number => {
      if (!/^[a-z_][A-Za-z_0-9]*$/.test(name)) fail("Local variable and parameter names must begin with a lowercase letter or underscore", position);
      if (bw2CommandByName(name, program.preserveLayout, program.overlayId) || program.definitions.some((other) => other.name === name)) fail(`Reserved local variable name '${name}'`, position);
      const id = available[bindings.size];
      if (id === undefined) fail(`No free scratch Works remain for '${definition.name}' (pool 0x8020–0x8053)`, position);
      bindings.set(name, id); return id;
    };
    for (const parameter of definition.parameters ?? []) {
      if (bindings.has(parameter.name)) fail(`Duplicate helper parameter '${parameter.name}'`, parameter);
      parameters.push({ name: parameter.name, id: allocate(parameter.name, parameter) });
    }
    visitBw2Statements(definition.body, (statement) => {
      if (statement.kind === "label") owners.set(statement.target, definition);
      if (statement.kind === "assign" && !bindings.has(statement.name) && !globals.has(statement.name)) locals.push({ name: statement.name, id: allocate(statement.name, statement) });
    });
    if (definition.kind === "block" && bindings.size) fail("Automatic locals require a script or helper, not a shared layout block", definition);
    frames.set(definition.name, { parameters, locals, slots: [...bindings.values()], bindings });
  }
  const managed = [...frames.values()].some((frame) => frame.slots.length > 0);
  if (managed) for (const alias of program.aliases ?? []) {
    const owner = owners.get(alias.target);
    if (owner && frames.get(owner.name)!.slots.length && (owner.kind === "helper" || alias.target !== owner.name)) fail("Entry aliases cannot bypass automatic local/parameter setup", alias);
  }
  return { frames, owners, managed };
}
