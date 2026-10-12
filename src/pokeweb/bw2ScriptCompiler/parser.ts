import { Bw2ScriptCompileError, type Definition, type Expression, type Program, type SourcePosition, type Statement, type Value } from "./types";
import { BW2_OVERLAY_LAYOUTS } from "./commandLayouts";

type Token = SourcePosition & { kind: "word" | "number" | "punctuation" | "newline" | "eof"; text: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0, line = 1, column = 1;
  while (offset < source.length) {
    const position = { line, column };
    const character = source[offset];
    if (character === "#") {
      while (offset < source.length && source[offset] !== "\n") { offset++; column++; }
      continue;
    }
    if (character === "\n" || character === ";") {
      tokens.push({ ...position, kind: "newline", text: "\n" });
      offset++;
      if (character === "\n") { line++; column = 1; } else column++;
      continue;
    }
    if (/\s/.test(character)) { offset++; column++; continue; }
    const remaining = source.slice(offset);
    const word = /^[A-Za-z_][A-Za-z_0-9]*(?:\?|!(?!=))?/.exec(remaining)?.[0];
    const number = /^(?:0[xX][0-9a-fA-F]+|[0-9]+)/.exec(remaining)?.[0];
    const punctuation = /^(?:==|!=|<=|>=|&&|\|\||\+=|-=|[():,=<>!+-])/.exec(remaining)?.[0];
    const text = word ?? number ?? punctuation;
    if (!text) {
      const message = character === '"' || character === "'"
        ? "Text literals are not supported yet; use existing message IDs"
        : `Unsupported character '${character}'`;
      throw new Bw2ScriptCompileError(message, position);
    }
    tokens.push({ ...position, kind: word ? "word" : number ? "number" : "punctuation", text });
    offset += text.length;
    column += text.length;
  }
  tokens.push({ kind: "eof", text: "", line, column });
  return tokens;
}

const PRECEDENCE: Readonly<Record<string, number>> = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4 };
const RESERVED = new Set(["script", "def", "work", "if", "elsif", "else", "unless", "while", "until", "case", "when", "do", "end", "break", "next", "return", "true", "false", "call", "preserve_layout", "entry", "data", "block", "label", "jump", "overlay", "condition_encoding", "vm_compare", "stack_condition", "flag_set?"]);

class Parser {
  private index = 0;
  private depth = 0;
  constructor(private tokens: Token[]) {}
  private get token(): Token { return this.tokens[this.index]; }
  private take(): Token { return this.tokens[this.index++]; }
  private at(text: string): boolean { return this.token.text === text; }
  private accept(text: string): boolean { if (!this.at(text)) return false; this.take(); return true; }
  private expect(text: string): Token {
    if (!this.at(text)) this.fail(`Expected '${text}', found '${this.token.text || "end of file"}'`);
    return this.take();
  }
  private fail(message: string, position: SourcePosition = this.token): never { throw new Bw2ScriptCompileError(message, position); }
  private newlines(): void { while (this.token.kind === "newline") this.take(); }
  private lineEnd(): void {
    if (this.token.kind !== "newline" && this.token.kind !== "eof") this.fail("Expected a newline or ';'");
    this.newlines();
  }
  private name(): string {
    if (this.token.kind !== "word" || RESERVED.has(this.token.text)) this.fail("Expected a non-keyword name");
    return this.take().text;
  }
  private nested<T>(parse: () => T): T {
    if (++this.depth > 128) this.fail("Syntax nesting exceeds 128 levels");
    try { return parse(); } finally { this.depth--; }
  }
  private number(): number {
    const sign = this.accept("-") ? -1 : this.accept("+") ? 1 : 1;
    if (this.token.kind !== "number") this.fail("Expected an integer literal");
    const token = this.take();
    const value = sign * Number(token.text);
    if (!Number.isSafeInteger(value)) this.fail("Integer is outside the safe numeric range", token);
    return value;
  }
  private value(): Value {
    const position = this.token;
    if (this.accept(":")) return { ...position, kind: "symbol", name: this.name() };
    if (this.token.kind === "number" || this.at("-") || this.at("+")) return { ...position, kind: "number", value: this.number() };
    if (this.token.kind === "word" && !RESERVED.has(this.token.text)) return { ...position, kind: "name", name: this.name() };
    this.fail("Expected an integer, constant, or bound work variable");
  }
  private expression(minimum = 1): Expression {
    return this.nested(() => {
      const position = this.token;
      let left: Expression;
      if (this.accept("!")) left = { ...position, kind: "not", expression: this.expression(5) };
      else if (this.accept("(")) { this.newlines(); left = this.expression(); this.newlines(); this.expect(")"); }
      else if (this.at("true") || this.at("false")) left = { ...position, kind: "boolean", value: this.take().text === "true" };
      else if (this.at("vm_compare") || this.at("stack_condition")) {
        const encoding = this.take().text === "vm_compare" ? "compare" : "stack";
        this.expect("("); this.newlines(); const expression = this.expression(); this.newlines(); this.expect(")");
        left = { ...position, kind: "encoded", encoding, expression };
      } else if (this.accept("flag_set?")) {
        this.expect("("); const value = this.value(); this.expect(")");
        left = { ...position, kind: "flag", value };
      }
      else left = { ...position, kind: "value", value: this.value() };
      while ((PRECEDENCE[this.token.text] ?? 0) >= minimum) {
        const operator = this.take().text as Extract<Expression, { kind: "binary" }>["operator"];
        const right = this.expression(PRECEDENCE[operator] + 1);
        left = { ...position, kind: "binary", operator, left, right };
      }
      return left;
    });
  }
  private body(stops: string[]): Statement[] {
    return this.nested(() => {
      const statements: Statement[] = [];
      this.newlines();
      while (this.token.kind !== "eof" && !stops.includes(this.token.text)) statements.push(this.statement());
      return statements;
    });
  }
  private arguments(): Value[] {
    const values: Value[] = [];
    const parenthesized = this.accept("(");
    if (parenthesized) this.newlines();
    if (!(parenthesized ? this.at(")") : this.token.kind === "newline" || this.token.kind === "eof" || this.at("if") || this.at("unless"))) {
      do {
        if (parenthesized) this.newlines();
        values.push(this.value());
        if (parenthesized) this.newlines();
      } while (this.accept(","));
    }
    if (parenthesized) this.expect(")");
    return values;
  }
  private statement(): Statement {
    const position = this.token;
    let statement: Statement;
    if (this.at("if") || this.at("unless")) {
      const inverted = this.take().text === "unless";
      const expression = this.expression();
      this.lineEnd();
      const branches = [{ condition: inverted ? { ...position, kind: "not" as const, expression } : expression, body: this.body(["elsif", "else", "end"]) }];
      while (this.accept("elsif")) {
        if (inverted) this.fail("Use 'else' with unless; elsif is only supported with if");
        const condition = this.expression();
        this.lineEnd();
        branches.push({ condition, body: this.body(["elsif", "else", "end"]) });
      }
      let otherwise: Statement[] = [];
      const hasElse = this.accept("else");
      if (hasElse) { this.lineEnd(); otherwise = this.body(["end"]); }
      this.expect("end"); this.lineEnd();
      return { ...position, kind: "if", branches, otherwise, hasElse };
    }
    if (this.at("while") || this.at("until")) {
      const inverted = this.take().text === "until";
      const expression = this.expression();
      this.accept("do"); this.lineEnd();
      const body = this.body(["end"]);
      this.expect("end"); this.lineEnd();
      return { ...position, kind: "loop", condition: inverted ? { ...position, kind: "not", expression } : expression, body };
    }
    if (this.accept("case")) {
      const subject = this.value();
      this.lineEnd();
      const cases: Extract<Statement, { kind: "case" }>["cases"] = [];
      while (this.accept("when")) {
        const values: Value[] = [];
        do { values.push(this.value()); } while (this.accept(","));
        this.lineEnd();
        cases.push({ values, body: this.body(["when", "else", "end"]) });
      }
      if (!cases.length) this.fail("case requires at least one when branch", position);
      let otherwise: Statement[] = [];
      if (this.accept("else")) { this.lineEnd(); otherwise = this.body(["end"]); }
      this.expect("end"); this.lineEnd();
      return { ...position, kind: "case", subject, cases, otherwise };
    }
    if (this.at("break") || this.at("next") || this.at("return")) {
      statement = { ...position, kind: this.take().text as "break" | "next" | "return" };
    } else if (this.at("label") || this.at("jump")) {
      const kind = this.take().text as "label" | "jump";
      this.expect(":");
      statement = { ...position, kind, target: this.name() };
    } else if (this.accept("call")) {
      const args = this.arguments();
      if (args.length !== 1 || args[0].kind !== "symbol") this.fail("Use call :helper_name", position);
      statement = { ...position, kind: "call", name: args[0].name, args: [], helperOnly: true };
    } else {
      const name = this.name();
      if (this.at("=") || this.at("+=") || this.at("-=")) {
        const operator = this.take().text as "=" | "+=" | "-=";
        statement = { ...position, kind: "assign", name, operator, value: this.value() };
      } else statement = { ...position, kind: "call", name, args: this.arguments() };
    }
    if (this.at("if") || this.at("unless")) {
      const modifier = this.take();
      const expression = this.expression();
      const condition: Expression = modifier.text === "unless" ? { ...modifier, kind: "not", expression } : expression;
      statement = { ...position, kind: "if", branches: [{ condition, body: [statement] }], otherwise: [] };
    }
    this.lineEnd();
    return statement;
  }
  parse(): Program {
    const bindings: Program["bindings"] = [];
    const definitions: Definition[] = [];
    const layout: NonNullable<Program["layout"]> = [];
    const aliases: NonNullable<Program["aliases"]> = [];
    let preserveLayout = false;
    let overlayId: number | undefined;
    let conditionEncoding: Program["conditionEncoding"];
    this.newlines();
    while (this.token.kind !== "eof") {
      const position = this.token;
      if (this.accept("preserve_layout")) {
        if (preserveLayout || definitions.length || layout.length || aliases.length) this.fail("preserve_layout must appear once before all code", position);
        preserveLayout = true; this.lineEnd();
      } else if (this.accept("overlay")) {
        if (!preserveLayout || overlayId !== undefined || layout.length) this.fail("overlay requires preserve_layout and must appear once before code", position);
        overlayId = this.number();
        if (!Object.hasOwn(BW2_OVERLAY_LAYOUTS, overlayId)) this.fail("Unsupported BW2 command overlay", position);
        this.lineEnd();
      } else if (this.accept("condition_encoding")) {
        if (conditionEncoding || layout.length) this.fail("condition_encoding must appear once before code", position);
        this.expect(":"); const encoding = this.take();
        if (encoding.text !== "stack" && encoding.text !== "compare") this.fail("Expected :stack or :compare condition encoding", encoding);
        conditionEncoding = encoding.text; this.lineEnd();
      } else if (this.accept("entry")) {
        const entry = this.number(); this.expect(","); this.expect(":");
        aliases.push({ ...position, entry, target: this.name() }); this.lineEnd();
      } else if (this.accept("data")) {
        this.expect(":"); const name = this.name(); this.expect(",");
        const bytes: number[] = [];
        do { bytes.push(this.number()); } while (this.accept(","));
        layout.push({ ...position, kind: "data", name, bytes }); this.lineEnd();
      } else if (this.accept("block")) {
        this.expect(":"); const name = this.name(); this.expect("do"); this.lineEnd();
        const body = this.body(["end"]); const endLine = this.token.line; this.expect("end"); this.lineEnd();
        const definition: Definition = { ...position, kind: "block", name, body, endLine };
        definitions.push(definition); layout.push(definition);
      } else if (this.accept("work")) {
        this.expect(":"); const name = this.name(); this.expect(",");
        bindings.push({ ...position, kind: "work", name, value: this.number() });
        this.lineEnd();
      } else if (this.at("script")) {
        this.take(); this.expect(":"); const name = this.name(); this.expect(","); this.expect("entry"); this.expect(":");
        const entry = this.number(); this.expect("do"); this.lineEnd();
        const body = this.body(["end"]); const endLine = this.token.line; this.expect("end"); this.lineEnd();
        const definition: Definition = { ...position, kind: "script", name, entry, body, endLine };
        definitions.push(definition); layout.push(definition);
      } else if (this.accept("def")) {
        const name = this.name();
        if (this.accept("(")) this.expect(")");
        this.lineEnd();
        const body = this.body(["end"]); const endLine = this.token.line; this.expect("end"); this.lineEnd();
        const definition: Definition = { ...position, kind: "helper", name, body, endLine };
        definitions.push(definition); layout.push(definition);
      } else if (this.token.kind === "word" && /^[A-Z][A-Z_0-9]*$/.test(this.token.text)) {
        const name = this.take().text; this.expect("=");
        bindings.push({ ...position, kind: "constant", name, value: this.number() });
        this.lineEnd();
      } else this.fail("Expected work :name, ID, CONSTANT = integer, script :name, entry: N do, or def helper");
    }
    return { bindings, definitions, preserveLayout, overlayId, conditionEncoding, aliases, layout };
  }
}

export function parseBw2Script(source: string): Program {
  if (source.length > 1_000_000) throw new Bw2ScriptCompileError("Source exceeds the one-million-character limit", { line: 1, column: 1 });
  return new Parser(tokenize(source)).parse();
}
