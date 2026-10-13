import { writeU16, writeU32 } from "../../nds/binary";
import { gen5ScriptCommandSize } from "../gen5ScriptCommands";
import { BW2_COMPARISON_IDS, BW2_SCRIPT_COMMANDS, bw2CommandByName } from "./commands";
import { parseBw2Script } from "./parser";
import { BW2_WORK_OPERANDS } from "./workAliases";
import { bw2MovementByName } from "./movementCommands";
import { bw2ScriptMacroByName } from "./macros";
import { planBw2HelperFrames, type HelperFrames } from "./helperFrames";
import { verifyBw2HelperStack, type ScratchStackAction } from "./helperStack";
import { Bw2ScriptCompileError, type Comparison, type CompiledBw2Script, type Definition, type Expression, type Program, type SourcePosition, type Statement, type Value, type DataBlock, type RelocationKind, type MovementBlock } from "./types";

type Scalar = { kind: "work" | "constant"; value: number };
type Operand = { width: 1 | 2 | 4; value: number } | { width: 4; target: string; kind: Exclude<RelocationKind, "entry"> };
type Instruction = SourcePosition & { kind: "instruction"; opcode: number; operands: Operand[]; dispatchId?: number };
type Item = { kind: "label"; name: string } | { kind: "movementAlignment" } | Instruction | DataBlock;
type Loop = { start: string; end: string };
const INVERT: Record<Comparison, Comparison> = { "<": ">=", "<=": ">", ">": "<=", ">=": "<", "==": "!=", "!=": "==" };
const SWAP: Record<Comparison, Comparison> = { "<": ">", "<=": ">=", ">": "<", ">=": "<=", "==": "==", "!=": "!=" };
const FIRST_POSITION = { line: 1, column: 1 };

class Compiler {
  private bindings = new Map<string, Scalar>();
  private definitions = new Map<string, Definition>();
  private items: Item[] = [];
  private labelCounter = 0;
  private callEdges = new Map<string, { target: string; position: SourcePosition }[]>();
  private helperFrames?: HelperFrames;
  private activeDefinition?: Definition;
  private stackActions = new Map<Instruction, ScratchStackAction>();
  constructor(private program: Program) {}
  private fail(message: string, position: SourcePosition): never { throw new Bw2ScriptCompileError(message, position); }
  private unsigned(value: number, width: number, position: SourcePosition): number {
    if (!Number.isInteger(value) || value < 0 || value > 2 ** (width * 8) - 1) this.fail(`Value ${value} does not fit in an unsigned ${width * 8}-bit operand`, position);
    return value;
  }
  private scalar(value: Value): Scalar {
    if (value.kind === "number") return { kind: "constant", value: this.unsigned(value.value, 2, value) };
    const id = this.helperFrames?.frames.get(this.activeDefinition?.name ?? "")?.bindings.get(value.name);
    const binding = id === undefined ? this.bindings.get(value.name) : { kind: "work" as const, value: id };
    if (!binding) this.fail(`Unknown binding '${value.name}'`, value);
    return binding;
  }
  private scalarExpression(expression: Expression): Scalar {
    if (expression.kind !== "value") this.fail("Comparison operands must be integers, constants, or bound work variables", expression);
    return this.scalar(expression.value);
  }
  private freshLabel(): string { return `$branch${this.labelCounter++}`; }
  private label(name: string): void { this.items.push({ kind: "label", name }); }
  private emit(opcode: number, operands: Operand[], position: SourcePosition, dispatchId?: number): Instruction {
    const size = 2 + operands.reduce((sum, operand) => sum + operand.width, 0);
    if (gen5ScriptCommandSize(opcode, "BW2", dispatchId ?? this.program.overlayId) !== size) this.fail(`BW2 command 0x${opcode.toString(16)} has an inconsistent layout`, position);
    const instruction: Instruction = { ...position, kind: "instruction", opcode, operands, ...(dispatchId !== undefined ? { dispatchId } : {}) };
    this.items.push(instruction); return instruction;
  }
  private words(opcode: number, values: number[], position: SourcePosition): Instruction {
    return this.emit(opcode, values.map((value) => ({ width: 2, value })), position);
  }
  private saveWorks(ids: readonly number[], position: SourcePosition): void {
    for (const id of ids) this.stackActions.set(this.words(0x09, [id], position), { kind: "save", id });
  }
  private restoreWorks(ids: readonly number[], position: SourcePosition): void {
    for (const id of [...ids].reverse()) this.stackActions.set(this.words(0x0a, [id], position), { kind: "restore", id });
  }
  private currentSlots(): number[] { return this.helperFrames?.frames.get(this.activeDefinition?.name ?? "")?.slots ?? []; }
  private finish(opcode: number, position: SourcePosition): void {
    const slots = this.currentSlots();
    if ([0x02, 0x1d].includes(opcode) && slots.length) {
      if (this.activeDefinition?.kind !== "script") this.fail("Helpers with automatic locals/parameters must return to their caller; use return", position);
      this.restoreWorks(slots, position);
    }
    if (opcode === 5 && slots.length && this.activeDefinition?.kind === "script") this.fail("Use return to finish a public script with automatic locals", position);
    this.words(opcode, [], position);
  }
  private command(opcode: number, operands: Operand[], position: SourcePosition, dispatchId?: number): void {
    if ([2, 5, 0x1d].includes(opcode)) { this.finish(opcode, position); return; }
    const slots = this.currentSlots();
    if (opcode === 0x1b && slots.length) this.fail("Asynchronous global scripts cannot share automatic locals; use a synchronous call", position);
    if (opcode === 0x20 && slots.length && "value" in operands[0] && operands[0].value === 0xff) this.fail("Use if/unless around a helper call with automatic locals instead of stack-based call_if", position);
    const preserve = [4, 0x20, 0x1c].includes(opcode) ? slots : [];
    this.saveWorks(preserve, position); this.emit(opcode, operands, position, dispatchId); this.restoreWorks(preserve, position);
  }
  private checkTransfer(target: string, position: SourcePosition, call: boolean): void {
    const owner = this.helperFrames?.owners.get(target), targetSlots = owner ? this.helperFrames?.frames.get(owner.name)?.slots.length : 0;
    if (call && targetSlots) this.fail("Calls into automatic locals/parameters require the named helper invocation and its arguments", position);
    if (!call && owner?.name !== this.activeDefinition?.name && (targetSlots || this.currentSlots().length)) this.fail("Jumps cannot cross routine boundaries with automatic locals/parameters", position);
  }
  private endsPath(statements: Statement[]): boolean {
    const tail = statements.at(-1);
    if (!tail) return false;
    if (tail.kind === "return") return true;
    if (tail.kind === "macro") return [0x02, 0x05, 0x1d].includes(bw2ScriptMacroByName(tail.name)!.sequence.at(-1)!.opcode);
    if (tail.kind === "call" && !tail.helperOnly) return [0x02, 0x05, 0x1d].includes(bw2CommandByName(tail.name, this.program.preserveLayout, this.program.overlayId)?.opcode ?? -1);
    if (tail.kind === "if") return !!tail.hasElse && tail.branches.every((branch) => this.endsPath(branch.body)) && this.endsPath(tail.otherwise);
    if (tail.kind === "case") return tail.cases.every((branch) => this.endsPath(branch.body)) && this.endsPath(tail.otherwise);
    return false;
  }
  private jump(target: string, position: SourcePosition): void { this.emit(0x1e, [{ width: 4, target, kind: "jump" }], position); }
  private movement(block: MovementBlock): void {
    let bytes: number[] = [], name = block.name, finished = false;
    const flush = () => { if (bytes.length) this.items.push({ ...block, kind: "data", name, bytes }); bytes = []; };
    const literal = (value: Value): number => {
      const scalar = this.scalar(value);
      if (value.kind === "symbol" || scalar.kind !== "constant") this.fail("Movement operands require literal integers or constants, not work variables", value);
      return this.unsigned(scalar.value, 2, value);
    };
    const record = (opcode: number, parameter: number) => bytes.push(opcode & 255, opcode >>> 8, parameter & 255, parameter >>> 8);
    if (this.program.movementAlignment || !this.program.preserveLayout) this.items.push({ kind: "movementAlignment" });
    this.label(name);
    for (const step of block.body) {
      if (finished) this.fail("Movement finish must be the last statement", step);
      if (step.kind === "label") { flush(); name = step.target; this.label(name); continue; }
      const command = bw2MovementByName(step.name);
      const raw = step.name === "raw_step", finish = step.name === "finish";
      if (!command && !raw && !finish) this.fail(`Unknown movement command '${step.name}'`, step);
      if (step.args.length !== (raw ? 2 : 1)) this.fail(`'${step.name}' expects ${raw ? 2 : 1} movement arguments`, step);
      const opcode = raw ? literal(step.args[0]) : finish ? 0xfe : command!.opcode;
      if (raw && opcode === 0xfe) this.fail("Use finish PARAMETER to preserve a movement terminator", step);
      record(opcode, literal(step.args[raw ? 1 : 0]));
      finished = finish;
    }
    if (!finished) record(0xfe, 0);
    flush();
  }
  /** Stack expressions evaluate left then right; AND/OR consume normalized booleans. */
  private stackExpression(expression: Expression, negate = false, depth = 0): boolean {
    if (depth > 128) this.fail("Condition nesting exceeds 128 levels", expression);
    if (expression.kind === "not") return this.stackExpression(expression.expression, !negate, depth + 1);
    if (expression.kind === "encoded") this.fail("Encoding wrappers must surround a complete condition", expression);
    if (expression.kind === "value") {
      if (negate) this.fail("Conditions require an explicit comparison; write count != 0", expression);
      const value = this.scalar(expression.value);
      this.words(value.kind === "work" ? 0x09 : 0x08, [value.value], expression);
      return value.kind === "constant" && (value.value === 0 || value.value === 1);
    }
    if (expression.kind === "boolean") {
      this.words(0x08, [Number(negate ? !expression.value : expression.value)], expression); return true;
    }
    if (expression.kind === "flag") {
      const flag = this.scalar(expression.value);
      if (flag.kind !== "constant" || flag.value >= 0x4000) this.fail("flag_set? expects a literal event-flag ID below 0x4000. For work variables, use an integer comparison such as bianca_intro_progress != 0", expression);
      this.words(0x10, [flag.value], expression);
      if (negate) { this.words(0x08, [0], expression); this.words(0x11, [1], expression); }
      return true;
    }
    const logical = expression.operator === "&&" || expression.operator === "||";
    const leftBoolean = this.stackExpression(expression.left, logical && negate, depth + 1);
    const rightBoolean = this.stackExpression(expression.right, logical && negate, depth + 1);
    if (logical && (!leftBoolean || !rightBoolean)) this.fail("Stack AND/OR require Boolean comparisons or flag predicates, not integer truthiness", expression);
    const operator = logical ? (negate ? (expression.operator === "&&" ? "||" : "&&") : expression.operator) : (negate ? INVERT[expression.operator as Comparison] : expression.operator);
    this.words(0x11, [operator === "||" ? 6 : operator === "&&" ? 7 : BW2_COMPARISON_IDS[operator as Comparison]], expression);
    return true;
  }
  private branch(expression: Expression, target: string, whenTrue: boolean, depth = 0, encoding = this.program.conditionEncoding ?? "compare"): void {
    if (depth > 128) this.fail("Condition nesting exceeds 128 levels", expression);
    if (expression.kind === "encoded") { this.branch(expression.expression, target, whenTrue, depth + 1, expression.encoding); return; }
    if (expression.kind === "not") { this.branch(expression.expression, target, !whenTrue, depth + 1, encoding); return; }
    if (encoding === "stack" || expression.kind === "flag") {
      if (expression.kind === "value") this.fail("Conditions require an explicit comparison; write count != 0", expression);
      this.stackExpression(expression, whenTrue);
      this.emit(0x1f, [{ width: 1, value: 0xff }, { width: 4, target, kind: "jump" }], expression);
      return;
    }
    if (expression.kind === "boolean") {
      if (expression.value === whenTrue) this.jump(target, expression);
      return;
    }
    if (expression.kind !== "binary") this.fail("Conditions require a comparison or boolean; write count != 0 rather than if count", expression);
    if (expression.operator === "&&" || expression.operator === "||") {
      const either = expression.operator === "||";
      if (whenTrue === either) {
        this.branch(expression.left, target, whenTrue, depth + 1, encoding);
        this.branch(expression.right, target, whenTrue, depth + 1, encoding);
      } else {
        const skip = this.freshLabel();
        this.branch(expression.left, skip, !whenTrue, depth + 1, encoding);
        this.branch(expression.right, target, whenTrue, depth + 1, encoding);
        this.label(skip);
      }
      return;
    }
    let left = this.scalarExpression(expression.left);
    let right = this.scalarExpression(expression.right);
    let comparison: Comparison = expression.operator;
    if (left.kind === "constant" && right.kind === "constant") {
      const matches = comparison === "==" ? left.value === right.value : comparison === "!=" ? left.value !== right.value
        : comparison === "<" ? left.value < right.value : comparison === "<=" ? left.value <= right.value
          : comparison === ">" ? left.value > right.value : left.value >= right.value;
      if (matches === whenTrue) this.jump(target, expression);
      return;
    }
    if (left.kind === "constant") { [left, right] = [right, left]; comparison = SWAP[comparison]; }
    this.words(right.kind === "work" ? 0x1a : 0x19, [left.value, right.value], expression);
    this.emit(0x1f, [
      { width: 1, value: BW2_COMPARISON_IDS[whenTrue ? comparison : INVERT[comparison]] },
      { width: 4, target, kind: "jump" },
    ], expression);
  }
  private statements(statements: Statement[], definition: Definition, loops: Loop[]): void {
    for (const statement of statements) {
      switch (statement.kind) {
        case "macro": {
          const macro = bw2ScriptMacroByName(statement.name)!;
          const values: Record<string, number> = {};
          for (const parameter of macro.parameters) {
            const arg = statement.keywords[parameter.name];
            if (arg.kind === "symbol") {
              if (!Object.hasOwn(parameter.aliases ?? {}, arg.name)) this.fail(`Unknown '${statement.name}' ${parameter.name} alias ':${arg.name}'`, arg);
              values[parameter.name] = parameter.aliases![arg.name];
            } else {
              const scalar = this.scalar(arg);
              if (parameter.literalOnly && scalar.kind === "work") this.fail(`'${statement.name}' ${parameter.name} requires a literal or constant, not a work variable`, arg);
              if (!parameter.literalOnly && scalar.kind === "constant" && scalar.value >= 0x4000) this.fail(`'${statement.name}' ${parameter.name} literals must be below 0x4000; use a work binding for runtime values`, arg);
              values[parameter.name] = scalar.value;
            }
          }
          for (const command of macro.sequence) this.command(command.opcode, command.args.map((arg) => ({ width: 2, value: typeof arg === "number" ? arg : values[arg] })), statement);
          break;
        }
        case "label":
        case "jump": {
          if (!this.program.preserveLayout) this.fail("Symbolic labels/jumps require preserve_layout", statement);
          if (statement.kind === "label") this.label(statement.target);
          else { this.checkTransfer(statement.target, statement, false); this.jump(statement.target, statement); }
          break;
        }
        case "call": {
          const helper = this.definitions.get(statement.name);
          if (helper) {
            if (helper.kind !== "helper" && !this.program.preserveLayout) this.fail(`'${statement.name}' is a public script; only helpers can be called`, statement);
            const frame = this.helperFrames!.frames.get(helper.name)!;
            if (helper.kind !== "helper" && frame.slots.length) this.fail("A public script with automatic locals cannot be called as a helper", statement);
            if (statement.args.length !== frame.parameters.length) this.fail(`Helper '${helper.name}' expects ${frame.parameters.length} arguments, received ${statement.args.length}`, statement);
            this.callEdges.get(definition.name)!.push({ target: helper.name, position: statement });
            const slots = [...new Set([...this.currentSlots(), ...frame.slots])];
            this.saveWorks(slots, statement);
            // Snapshot every argument before writing any parameter: f(b, a)
            // remains correct even when caller/callee scratch slots coincide.
            for (const arg of statement.args) {
              if (arg.kind === "symbol") this.fail("Helper arguments must be integer values, constants, or variables", arg);
              const value = this.scalar(arg); this.words(value.kind === "work" ? 0x09 : 0x08, [value.value], arg);
            }
            for (const parameter of [...frame.parameters].reverse()) this.words(0x0a, [parameter.id], statement);
            this.emit(0x04, [{ width: 4, target: helper.name, kind: "call" }], statement);
            this.restoreWorks(slots, statement);
          } else {
            if (statement.helperOnly) {
              if (!this.program.preserveLayout) this.fail(`Unknown helper '${statement.name}'`, statement);
              if (statement.args.length) this.fail("Arguments require a named helper definition", statement);
              this.checkTransfer(statement.name, statement, true);
              this.command(0x04, [{ width: 4, target: statement.name, kind: "call" }], statement);
              break;
            }
            const command = bw2CommandByName(statement.name, this.program.preserveLayout, this.program.overlayId);
            if (!command) this.fail(`Unknown command or helper '${statement.name}'`, statement);
            if (statement.args.length !== command.widths.length) this.fail(`'${statement.name}' expects ${command.widths.length} arguments, received ${statement.args.length}`, statement);
            const operands: Operand[] = statement.args.map((arg, index) => {
              const reference = command.relative?.[index];
              if (reference) {
                if (arg.kind !== "symbol" || command.widths[index] !== 4) this.fail("Relative pointers require a symbolic target", arg);
                if (reference === "jump" || reference === "call") {
                  this.checkTransfer(arg.name, arg, reference === "call");
                  const owner = this.helperFrames?.owners.get(arg.name);
                  if (reference === "call" && owner) this.callEdges.get(definition.name)!.push({ target: owner.name, position: statement });
                }
                return { width: 4, target: arg.name, kind: reference };
              }
              const scalar = arg.kind === "number" ? { kind: "constant", value: arg.value } : this.scalar(arg);
              if (scalar.kind === "work" && !(command.workOperands ?? BW2_WORK_OPERANDS[command.opcode])?.includes(index)) this.fail(`'${statement.name}' argument ${index + 1} requires a literal/constant operand`, arg);
              return { width: command.widths[index], value: this.unsigned(scalar.value, command.widths[index], arg) };
            });
            if (command.dispatchId === 60 && ![58, 60].includes(this.program.overlayId ?? -1)) this.fail("Join Avenue shop commands require overlay 58 or 60 context", statement);
            this.command(command.opcode, operands, statement, command.dispatchId);
          }
          break;
        }
        case "assign": {
          const destination = this.scalar({ ...statement, kind: "name", name: statement.name });
          if (!destination || destination.kind !== "work") this.fail(`Assignment requires a bound work variable: '${statement.name}'`, statement);
          const source = this.scalar(statement.value);
          if (statement.operator === "=") this.words(source.kind === "constant" ? 0x28 : 0x29, [destination.value, source.value], statement);
          else {
            // WorkAdd/WorkSub resolve their RHS through the game's work/literal
            // convention. Values >= 0x4000 would be interpreted as work IDs.
            if (source.kind === "constant" && source.value >= 0x4000) this.fail("Arithmetic literals must be below 0x4000; larger operands are interpreted as work IDs", statement.value);
            this.words(statement.operator === "+=" ? 0x26 : 0x27, [destination.value, source.value], statement);
          }
          break;
        }
        case "if": {
          const branch = statement.branches[0];
          if (this.program.preserveLayout && statement.branches.length === 1 && !statement.hasElse && !statement.otherwise.length && branch.body.length === 1 && branch.body[0].kind === "jump") {
            this.branch(branch.condition, branch.body[0].target, true);
            break;
          }
          const end = this.freshLabel();
          for (const [index, branch] of statement.branches.entries()) {
            const next = this.freshLabel();
            this.branch(branch.condition, next, false);
            this.statements(branch.body, definition, loops);
            if ((!this.program.preserveLayout || statement.hasElse || statement.otherwise.length || index < statement.branches.length - 1) && !this.endsPath(branch.body)) this.jump(end, statement);
            this.label(next);
          }
          this.statements(statement.otherwise, definition, loops);
          this.label(end);
          break;
        }
        case "loop": {
          const loop = { start: this.freshLabel(), end: this.freshLabel() };
          this.label(loop.start);
          this.branch(statement.condition, loop.end, false);
          this.statements(statement.body, definition, [...loops, loop]);
          if (!this.endsPath(statement.body)) this.jump(loop.start, statement);
          this.label(loop.end);
          break;
        }
        case "case": {
          this.scalar(statement.subject);
          const seen = new Set<number>();
          const end = this.freshLabel();
          for (const branch of statement.cases) {
            const body = this.freshLabel(), next = this.freshLabel();
            for (const value of branch.values) {
              const scalar = this.scalar(value);
              if (scalar.kind !== "constant") this.fail("when values must be integer constants", value);
              if (seen.has(scalar.value)) this.fail(`Duplicate when value ${scalar.value}`, value);
              seen.add(scalar.value);
              this.branch({ ...statement, kind: "binary", operator: "==", left: { ...statement.subject, kind: "value", value: statement.subject }, right: { ...value, kind: "value", value } }, body, true, 0, "compare");
            }
            this.jump(next, statement);
            this.label(body);
            this.statements(branch.body, definition, loops);
            if (!this.endsPath(branch.body)) this.jump(end, statement);
            this.label(next);
          }
          this.statements(statement.otherwise, definition, loops);
          this.label(end);
          break;
        }
        case "break":
        case "next": {
          const loop = loops.at(-1);
          if (!loop) this.fail(`'${statement.kind}' is only valid inside a loop`, statement);
          this.jump(statement.kind === "break" ? loop.end : loop.start, statement);
          break;
        }
        case "return": this.finish(definition.kind === "script" ? 0x02 : 0x05, statement); break;
      }
    }
  }
  private collect(): Definition[] {
    const names = new Set<string>();
    const workIds = new Set<number>();
    for (const binding of this.program.bindings) {
      if (names.has(binding.name) || bw2CommandByName(binding.name, this.program.preserveLayout, this.program.overlayId)) this.fail(`Duplicate or reserved name '${binding.name}'`, binding);
      names.add(binding.name);
      this.unsigned(binding.value, 2, binding);
      if (binding.kind === "work") {
        if (binding.value < 0x4000) this.fail("Work IDs must be at least 0x4000", binding);
        if (workIds.has(binding.value)) this.fail(`Work ID 0x${binding.value.toString(16)} is already bound`, binding);
        workIds.add(binding.value);
      }
      this.bindings.set(binding.name, { kind: binding.kind, value: binding.value });
    }
    const addName = (name: string, position: SourcePosition) => {
      if (names.has(name) || bw2CommandByName(name, this.program.preserveLayout, this.program.overlayId)) this.fail(`Duplicate or reserved name '${name}'`, position);
      names.add(name);
    };
    const labels = (statements: Statement[]): void => {
      for (const statement of statements) {
        if (statement.kind === "label") addName(statement.target, statement);
        else if (statement.kind === "if") { statement.branches.forEach((branch) => labels(branch.body)); labels(statement.otherwise); }
        else if (statement.kind === "loop") labels(statement.body);
        else if (statement.kind === "case") { statement.cases.forEach((branch) => labels(branch.body)); labels(statement.otherwise); }
      }
    };
    for (const item of this.program.layout ?? this.program.definitions) {
      if (item.kind === "data" || item.kind === "block") {
        if (!this.program.preserveLayout) this.fail("Data/blocks require preserve_layout", item);
      }
      addName(item.name, item);
      if (item.kind === "movement") {
        for (const step of item.body) if (step.kind === "label") addName(step.target, step);
      } else if (item.kind !== "data") labels(item.body);
    }
    if ((this.program.aliases?.length ?? 0) && !this.program.preserveLayout) this.fail("Entry aliases require preserve_layout", this.program.aliases![0]);
    for (const definition of this.program.definitions) {
      this.definitions.set(definition.name, definition);
      this.callEdges.set(definition.name, []);
    }
    const scripts: Definition[] = this.program.definitions.filter((definition) => definition.kind === "script");
    for (const alias of this.program.aliases ?? []) scripts.push({ ...alias, kind: "script", name: alias.target, body: [] });
    scripts.sort((a, b) => a.entry! - b.entry!);
    if (!scripts.length && !(this.program.preserveLayout && !this.program.definitions.length)) this.fail("At least one public script is required", FIRST_POSITION);
    for (const [index, script] of scripts.entries()) {
      if (script.entry !== index + 1 || script.entry > 0xffff) this.fail("Script entry IDs must be unique and contiguous, starting at 1", script);
    }
    return scripts;
  }
  private checkCalls(): void {
    // Iterative DFS avoids a host stack overflow on a large helper graph.
    const states = new Map<string, "active" | "done">();
    for (const name of this.definitions.keys()) {
      if (states.has(name)) continue;
      const stack = [{ name, index: 0 }];
      states.set(name, "active");
      while (stack.length) {
        const frame = stack[stack.length - 1];
        const edge = this.callEdges.get(frame.name)![frame.index++];
        if (!edge) { states.set(frame.name, "done"); stack.pop(); continue; }
        if (states.get(edge.target) === "active") this.fail(`Recursive helper calls are unsupported: ${stack.map((item) => item.name).join(" -> ")} -> ${edge.target}`, edge.position);
        if (!states.has(edge.target)) { states.set(edge.target, "active"); stack.push({ name: edge.target, index: 0 }); }
      }
    }
  }
  compile(): CompiledBw2Script {
    const scripts = this.collect();
    this.helperFrames = planBw2HelperFrames(this.program);
    const layout = this.program.layout ?? this.program.definitions;
    const before = new Map<string, MovementBlock[]>(), layoutNames = new Set(layout.map((item) => item.name));
    for (const item of layout) if (item.kind === "movement" && item.before) {
      if (!this.program.preserveLayout) this.fail("Movement placement requires preserve_layout", item);
      if (!layoutNames.has(item.before)) this.fail(`Unknown movement placement '${item.before}'`, item);
      const group = before.get(item.before) ?? []; group.push(item); before.set(item.before, group);
    }
    const ordered: typeof layout = [], visiting = new Set<string>();
    const place = (item: typeof layout[number], depth = 0): void => {
      if (visiting.has(item.name)) this.fail("Cyclic movement placement", item);
      if (depth > 128) this.fail("Movement placement nesting exceeds 128 levels", item);
      visiting.add(item.name);
      for (const movement of before.get(item.name) ?? []) place(movement, depth + 1);
      visiting.delete(item.name); ordered.push(item);
    };
    for (const item of layout) if (item.kind !== "movement" || !item.before) place(item);
    if (ordered.length !== layout.length) this.fail("Cyclic movement placement", layout.find((item) => item.kind === "movement" && item.before)!);
    const codeNames: { name: string; end: string }[] = [], movementNames: { name: string; end: string }[] = [];
    for (const definition of ordered) {
      this.activeDefinition = undefined;
      if (definition.kind === "movement") { this.movement(definition); const end = this.freshLabel(); this.label(end); movementNames.push({ name: definition.name, end }); continue; }
      if (definition.kind === "data") {
        definition.bytes.forEach((value) => this.unsigned(value, 1, definition));
        this.label(definition.name); this.items.push(definition); continue;
      }
      this.label(definition.name);
      this.activeDefinition = definition;
      const start = this.items.length;
      const frame = this.helperFrames.frames.get(definition.name)!;
      if (definition.kind === "script") this.saveWorks(frame.slots, definition);
      for (const local of frame.locals) this.words(0x28, [local.id, 0], definition);
      this.statements(definition.body, definition, []);
      // Do not append unreachable terminators after a terminating macro or
      // branches that all terminate. Paths that can fall through still need one.
      if ((!this.program.preserveLayout || frame.slots.length) && !this.endsPath(definition.body)) this.finish(definition.kind === "script" ? 0x02 : 0x05, definition);
      if (this.items.slice(start).some((item) => item.kind === "instruction")) { const end = this.freshLabel(); this.label(end); codeNames.push({ name: definition.name, end }); }
    }
    if (!this.program.preserveLayout || this.helperFrames.managed) this.checkCalls();
    const offsets = new Map<string, number>();
    let length = scripts.length * 4 + 2;
    for (const item of this.items) {
      if (item.kind === "label") offsets.set(item.name, length);
      else if (item.kind === "movementAlignment") length += length % 2;
      else if (item.kind === "data") length += item.bytes.length;
      else length += 2 + item.operands.reduce((sum, operand) => sum + operand.width, 0);
    }
    const bytes = new Uint8Array(this.program.preserveLayout ? length : Math.ceil(length / 4) * 4);
    const result: CompiledBw2Script = { bytes, entries: [], helpers: [], instructions: [], relocations: [] };
    if (this.helperFrames.managed) result.scratchWorks = [...this.helperFrames.frames].filter(([, frame]) => frame.slots.length).map(([routine, frame]) => ({ routine, parameters: frame.parameters, locals: frame.locals }));
    const stackActions = new Map<number, ScratchStackAction>();
    result.codeBlocks = codeNames.map(({ name, end }) => ({ name, offset: offsets.get(name)!, endOffset: offsets.get(end)! }));
    result.movementBlocks = movementNames.map(({ name, end }) => ({ name, offset: offsets.get(name)!, endOffset: offsets.get(end)! }));
    if (this.program.preserveLayout) result.preserveLayout = true;
    if (this.program.preserveLayout || this.items.some((item) => item.kind === "data")) result.dataBlocks = [];
    if (this.program.overlayId !== undefined) result.overlayId = this.program.overlayId;
    const relocate = (operandOffset: number, target: string, kind: RelocationKind): number => {
      const targetOffset = offsets.get(target);
      if (targetOffset === undefined) this.fail(`Internal error: undefined relocation '${target}'`, FIRST_POSITION);
      if (targetOffset < scripts.length * 4 + 2 || targetOffset + 2 > length) this.fail(`Invalid relocation target '${target}'`, FIRST_POSITION);
      const delta = targetOffset - (operandOffset + 4);
      if (delta < -0x80000000 || delta > 0x7fffffff) this.fail("Relative offset exceeds signed 32-bit range", FIRST_POSITION);
      if (kind === "entry" && (delta & 0xffff) === 0xfd13) this.fail("Entry offset collides with the script-table terminator; reorder the definitions", FIRST_POSITION);
      writeU32(bytes, operandOffset, delta);
      result.relocations.push({ kind, operandOffset, targetOffset, target });
      return delta;
    };
    for (const [index, script] of scripts.entries()) {
      relocate(index * 4, script.name, "entry");
      result.entries.push({ name: script.name, entry: script.entry!, offset: offsets.get(script.name)! });
    }
    writeU16(bytes, scripts.length * 4, 0xfd13);
    for (const definition of this.program.definitions) {
      if (definition.kind === "helper") result.helpers.push({ name: definition.name, offset: offsets.get(definition.name)! });
    }
    let cursor = scripts.length * 4 + 2;
    for (const item of this.items) {
      if (item.kind === "label") continue;
      if (item.kind === "movementAlignment") { cursor += cursor % 2; continue; }
      if (item.kind === "data") {
        bytes.set(item.bytes, cursor);
        result.dataBlocks!.push({ name: item.name, offset: cursor, bytes: Uint8Array.from(item.bytes) });
        cursor += item.bytes.length; continue;
      }
      const offset = cursor;
      if (this.stackActions.has(item)) stackActions.set(offset, this.stackActions.get(item)!);
      writeU16(bytes, cursor, item.opcode); cursor += 2;
      const operands: number[] = [];
      for (const operand of item.operands) {
        if ("target" in operand) operands.push(relocate(cursor, operand.target, operand.kind));
        else {
          operands.push(operand.value);
          if (operand.width === 1) bytes[cursor] = operand.value;
          else if (operand.width === 2) writeU16(bytes, cursor, operand.value);
          else writeU32(bytes, cursor, operand.value);
        }
        cursor += operand.width;
      }
      result.instructions.push({ offset, opcode: item.opcode, operands, line: item.line, column: item.column, ...(item.dispatchId !== undefined ? { dispatchId: item.dispatchId } : {}) });
    }
    if (this.helperFrames.managed) verifyBw2HelperStack(result, stackActions);
    return result;
  }
}

/** Compile a restricted Ruby-syntax program into one BW2 field-script NARC member. */
export function compileBw2Script(source: string): CompiledBw2Script {
  return new Compiler(parseBw2Script(source)).compile();
}
