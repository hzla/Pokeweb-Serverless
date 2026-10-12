export type SourcePosition = { line: number; column: number };

export class Bw2ScriptCompileError extends Error {
  readonly position: SourcePosition;
  constructor(message: string, position: SourcePosition) {
    super(`${message} (line ${position.line}, column ${position.column})`);
    this.name = "Bw2ScriptCompileError";
    this.position = { line: position.line, column: position.column };
  }
}

export type Value = SourcePosition & (
  | { kind: "number"; value: number }
  | { kind: "name" | "symbol"; name: string }
);
export type Comparison = "==" | "!=" | "<" | "<=" | ">" | ">=";
export type Expression = SourcePosition & (
  | { kind: "value"; value: Value }
  | { kind: "boolean"; value: boolean }
  | { kind: "not"; expression: Expression }
  | { kind: "binary"; operator: Comparison | "&&" | "||"; left: Expression; right: Expression }
);
export type Statement = SourcePosition & (
  | { kind: "call"; name: string; args: Value[]; helperOnly?: boolean }
  | { kind: "assign"; name: string; operator: "=" | "+=" | "-="; value: Value }
  | { kind: "if"; branches: { condition: Expression; body: Statement[] }[]; otherwise: Statement[]; hasElse?: boolean }
  | { kind: "loop"; condition: Expression; body: Statement[] }
  | { kind: "case"; subject: Value; cases: { values: Value[]; body: Statement[] }[]; otherwise: Statement[] }
  | { kind: "break" | "next" | "return" }
  | { kind: "label" | "jump"; target: string }
);
export type Definition = SourcePosition & {
  kind: "script" | "helper" | "block";
  name: string;
  entry?: number;
  endLine?: number;
  body: Statement[];
};
export type Program = {
  bindings: (SourcePosition & { kind: "work" | "constant"; name: string; value: number })[];
  definitions: Definition[];
  preserveLayout?: boolean;
  overlayId?: number;
  aliases?: (SourcePosition & { entry: number; target: string })[];
  layout?: (Definition | DataBlock)[];
};
export type DataBlock = SourcePosition & { kind: "data"; name: string; bytes: number[] };
export type RelocationKind = "entry" | "jump" | "call" | "movement" | "data";

export type CompiledBw2Script = {
  bytes: Uint8Array;
  /** Public entry IDs are one-based; their binary table indices are entry - 1. */
  entries: { name: string; entry: number; offset: number }[];
  helpers: { name: string; offset: number }[];
  instructions: (SourcePosition & { offset: number; opcode: number; operands: number[] })[];
  relocations: {
    kind: RelocationKind;
    operandOffset: number;
    targetOffset: number;
    target: string;
  }[];
  preserveLayout?: boolean;
  overlayId?: number;
  dataBlocks?: { name: string; offset: number; bytes: Uint8Array }[];
  roundTrip?: { verified: true; editable: boolean; warnings: string[] };
};
