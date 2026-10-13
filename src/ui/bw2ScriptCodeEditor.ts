import { BW2_COMMAND_FACTS } from "../pokeweb/bw2ScriptCompiler/commandFacts";
import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { EditorState, StateEffect, StateField, Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, drawSelection, highlightActiveLine, keymap, lineNumbers, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { BW2_SCRIPT_COMMANDS, BW2_MOVEMENT_COMMANDS, BW2_SCRIPT_MACROS, bw2MovementByName, type SourcePosition } from "../pokeweb/bw2ScriptCompiler";
import { bw2CommandByName, BW2_OVERLAY_COMMAND_ALIASES } from "../pokeweb/bw2ScriptCompiler/commands";
import { BW2_WORK_ALIASES, bw2WorkAlias } from "../pokeweb/bw2ScriptCompiler/workAliases";
import { parseBw2Script } from "../pokeweb/bw2ScriptCompiler/parser";
import { visitBw2Statements } from "../pokeweb/bw2ScriptCompiler/helperFrames";

const KEYWORDS = new Set(["script", "work", "def", "do", "end", "if", "elsif", "else", "unless", "while", "until", "case", "when", "break", "next", "return", "call", "true", "false", "preserve_layout", "entry", "block", "data", "movement", "movement_alignment", "finish", "raw_step", "label", "jump", "overlay", "condition_encoding", "vm_compare", "stack_condition", "flag_set?"]);
const WORK_NAMES = new Set(BW2_WORK_ALIASES.map((work) => work.name));
const RESEARCHED_NAMES = new Set(BW2_COMMAND_FACTS.map((fact) => fact.name));
const OVERLAY_NAMES = new Set(Object.values(BW2_OVERLAY_COMMAND_ALIASES).flatMap(Object.keys));
const MACRO_PARAMETERS = new Set(Object.values(BW2_SCRIPT_MACROS).flatMap((macro) => macro.parameters.map((parameter) => parameter.name)));
export type Bw2ScriptHighlight = { from: number; to: number; kind: "keyword" | "symbol" | "number" | "constant" | "command" | "helper" | "work" | "comment" | "string" | "operator" };
type EditorSymbols = { helpers: Map<string, string[]>; scopes: { from: number; to: number; variables: Set<string> }[] };

/** Local document lines retain their coordinates when definitions are shown in
 * a separate tab. Global bindings come from the joined source when available. */
export function bw2ScriptEditorSymbols(source: string, bindingSource = source): EditorSymbols {
  const helpers = new Map<string, string[]>(), scopes: EditorSymbols["scopes"] = [];
  const globals = new Set([...bindingSource.matchAll(/^\s*(?:work\s+:(\w+),|([A-Z][A-Z_0-9]*)\s*=)/gm)].map((match) => match[1] ?? match[2]));
  try {
    const program = parseBw2Script(source);
    for (const definition of program.definitions) {
      const parameters = definition.parameters?.map(({ name }) => name) ?? [], variables = new Set(parameters);
      if (definition.kind === "helper") helpers.set(definition.name, parameters);
      visitBw2Statements(definition.body, (statement) => { if (statement.kind === "assign" && !globals.has(statement.name)) variables.add(statement.name); });
      scopes.push({ from: definition.line, to: definition.endLine ?? definition.line, variables });
    }
  } catch {
    // Keep declarations useful during incomplete edits, without assigning slots.
    let current: EditorSymbols["scopes"][number] | undefined;
    const lines = source.split(/\r?\n/);
    for (const [index, full] of lines.entries()) {
      const line = full.replace(/#.*$/, ""), helper = /^\s*def\s+(\w+)\s*(?:\(([^)]*)\)?)?/.exec(line);
      if (helper || /^\s*(?:script|block)\s+:/.test(line)) {
        if (current) current.to = index;
        const parameters = helper?.[2]?.split(",").map((name) => name.trim()).filter((name) => /^[a-z_]\w*$/.test(name)) ?? [];
        if (helper) helpers.set(helper[1], parameters);
        current = { from: index + 1, to: lines.length, variables: new Set(parameters) }; scopes.push(current);
      }
      const assignment = /^\s*([a-z_]\w*)\s*(?:=|\+=|-=)/.exec(line);
      if (assignment && !globals.has(assignment[1])) current?.variables.add(assignment[1]);
    }
  }
  return { helpers, scopes };
}

/** Tolerant lexical highlighting also works while source is incomplete/invalid. */
export function highlightBw2ScriptLine(line: string, symbols?: { helpers: ReadonlyMap<string, string[]>; variables?: ReadonlySet<string> }): Bw2ScriptHighlight[] {
  const ranges: Bw2ScriptHighlight[] = [];
  const tokens = /#[^\r\n]*|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|:[A-Za-z_]\w*[?!]?|\b0[xX][\da-fA-F]+\b|\b\d+\b|[A-Za-z_]\w*(?:\?|!(?!=))?|==|!=|<=|>=|&&|\|\||\+=|-=|[=<>!+\-]/g;
  let afterDef = false;
  for (const match of line.matchAll(tokens)) {
    const text = match[0];
    let kind: Bw2ScriptHighlight["kind"] | undefined;
    if (text.startsWith("#")) kind = "comment";
    else if (/^["']/.test(text)) kind = "string";
    else if (text.startsWith(":")) kind = "symbol";
    else if (/^\d/.test(text)) kind = "number";
    else if (KEYWORDS.has(text)) kind = "keyword";
    else if (MACRO_PARAMETERS.has(text) && /^\s*:/.test(line.slice(match.index! + text.length))) kind = "keyword";
    else if (afterDef) kind = "helper";
    else if (symbols?.variables?.has(text)) kind = "work";
    else if (symbols?.helpers.has(text)) kind = "helper";
    else if (/^[A-Z][A-Z_0-9]*$/.test(text)) kind = "constant";
    else if (bw2CommandByName(text, true) || Object.hasOwn(BW2_SCRIPT_MACROS, text) || OVERLAY_NAMES.has(text) || RESEARCHED_NAMES.has(text) || bw2MovementByName(text) || /^cmd_[0-9a-f]{4}$/.test(text)) kind = "command";
    else if (WORK_NAMES.has(text)) kind = "work";
    else if (/^[=<>!&|+\-]/.test(text)) kind = "operator";
    if (kind) ranges.push({ from: match.index!, to: match.index! + text.length, kind });
    afterDef = text === "def";
  }
  return ranges;
}

export function bw2ScriptSourceOffset(document: Text, position: SourcePosition): number {
  const line = document.line(Math.max(1, Math.min(document.lines, position.line)));
  return line.from + Math.max(0, Math.min(line.length, position.column - 1));
}

const setError = StateEffect.define<SourcePosition | undefined>();
const errorHighlight = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    if (transaction.docChanged) decorations = Decoration.none;
    for (const effect of transaction.effects) {
      if (!effect.is(setError)) continue;
      if (!effect.value) { decorations = Decoration.none; continue; }
      const from = bw2ScriptSourceOffset(transaction.state.doc, effect.value);
      const line = transaction.state.doc.lineAt(from);
      const marks = [Decoration.line({ class: "cm-bw2-error-line" }).range(line.from)];
      if (from < line.to) marks.push(Decoration.mark({ class: "cm-bw2-error-token" }).range(from, from + 1));
      decorations = Decoration.set(marks, true);
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function decorationsFor(view: EditorView): DecorationSet {
  const marks: ReturnType<Decoration["range"]>[] = [];
  const seen = new Set<number>();
  const symbols = bw2ScriptEditorSymbols(view.state.doc.toString());
  for (const range of view.visibleRanges) {
    let line = view.state.doc.lineAt(range.from);
    while (line.from <= range.to) {
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const scope = symbols.scopes.find((scope) => line.number >= scope.from && line.number <= scope.to);
        for (const token of highlightBw2ScriptLine(line.text, { helpers: symbols.helpers, variables: scope?.variables })) {
          marks.push(Decoration.mark({ class: `cm-bw2-${token.kind}` }).range(line.from + token.from, line.from + token.to));
        }
      }
      if (line.number === view.state.doc.lines) break;
      line = view.state.doc.line(line.number + 1);
    }
  }
  return Decoration.set(marks, true);
}

const highlighting = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = decorationsFor(view); }
  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) this.decorations = decorationsFor(update.view);
  }
}, { decorations: (plugin) => plugin.decorations });

export type Bw2ScriptCodeEditor = {
  getValue: () => string;
  setValue: (source: string) => void;
  setError: (position?: SourcePosition) => void;
  focusError: (position: SourcePosition) => void;
  destroy: () => void;
  getCursor: () => Bw2ScriptCursor;
  refreshLayout?: () => void;
};
export type Bw2ScriptCursor = SourcePosition & { word: string; text: string };

function cursorFor(view: EditorView, offset = view.state.selection.main.head): Bw2ScriptCursor {
  const line = view.state.doc.lineAt(offset);
  const column = offset - line.from;
  const word = [...line.text.matchAll(/[A-Za-z_]\w*(?:\?|!(?!=))?/g)].find((match) => match.index! <= column && column <= match.index! + match[0].length)?.[0] ?? "";
  return { line: line.number, column: column + 1, word, text: line.text };
}

export function installBw2ScriptCodeEditor(host: HTMLElement, source: string, onChange: (source: string) => void, onCursor?: (cursor: Bw2ScriptCursor) => void, options: { bindingSource?: () => string; label?: string; onNavigate?: (cursor: Bw2ScriptCursor) => boolean } = {}): Bw2ScriptCodeEditor {
  const view = new EditorView({
    parent: host,
    doc: source,
    extensions: [
      lineNumbers(), history(), drawSelection(), highlightActiveLine(), highlighting, errorHighlight,
      EditorState.tabSize.of(2),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.domEventHandlers({
        click: (event, view) => {
          if (event.button !== 0) return false;
          const offset = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (offset !== null) onCursor?.(cursorFor(view, offset));
          return false;
        },
        dblclick: (event, view) => {
          if (event.button !== 0) return false;
          const offset = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (offset === null || !options.onNavigate?.(cursorFor(view, offset))) return false;
          event.preventDefault(); return true;
        },
      }),
      EditorView.contentAttributes.of({ "aria-label": options.label ?? "Ruby-like BW2 script source", spellcheck: "false" }),
      autocompletion({ override: [(context) => {
        const word = context.matchBefore(/[A-Za-z_]\w*[?]?/);
        if (!word || (word.from === word.to && !context.explicit)) return null;
        const bindings = [...(options.bindingSource?.() ?? context.state.doc.toString()).matchAll(/^\s*work\s+:(\w+),\s*(0x[\da-f]+|\d+)\b/gim)].map((match) => ({ label: match[1], type: "variable", info: bw2WorkAlias(Number(match[2])).description }));
        const symbols = bw2ScriptEditorSymbols(context.state.doc.toString(), options.bindingSource?.()), line = context.state.doc.lineAt(context.pos).number;
        const locals = [...(symbols.scopes.find((scope) => line >= scope.from && line <= scope.to)?.variables ?? [])].map((label) => ({ label, type: "variable", info: "Routine-local integer variable or parameter." }));
        const helpers = [...symbols.helpers].map(([label, parameters]) => ({ label, type: "function", info: `def ${label}(${parameters.join(", ")})` }));
        return { from: word.from, options: [...KEYWORDS].map((label) => ({ label, type: "keyword" })).concat([...new Set([...Object.keys(BW2_SCRIPT_COMMANDS), ...Object.keys(BW2_SCRIPT_MACROS), ...OVERLAY_NAMES, ...RESEARCHED_NAMES])].map((label) => ({ label, type: "function" }))).concat(BW2_MOVEMENT_COMMANDS.map(({ name: label }) => ({ label, type: "function" }))).concat(helpers).concat(bindings).concat(locals) };
      }] }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
        if (update.docChanged || update.selectionSet) onCursor?.(cursorFor(update.view));
      }),
      EditorView.theme({
        "&": { backgroundColor: "#181a23", color: "#f4f4f6", fontSize: "14px", height: "100%" },
        ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", overflow: "auto" },
        ".cm-content": { caretColor: "#f8f8f2", padding: "14px 0" },
        ".cm-cursor": { borderLeftColor: "#f8f8f2" },
        ".cm-gutters": { backgroundColor: "#13151d", color: "#8f95aa", borderRight: "1px solid #343748" },
        ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "#ffffff09" },
        ".cm-keyword, .cm-bw2-keyword": { color: "#c792ea" },
        ".cm-bw2-command": { color: "#8be9c1" },
        ".cm-bw2-helper": { color: "#f7d774" },
        ".cm-bw2-symbol": { color: "#82aaff" },
        ".cm-bw2-number": { color: "#ffb86c" },
        ".cm-bw2-constant": { color: "#89ddff" },
        ".cm-bw2-work": { color: "#89ddff" },
        ".cm-bw2-string": { color: "#f1fa8c" },
        ".cm-bw2-comment": { color: "#8b91a5", fontStyle: "italic" },
        ".cm-bw2-operator": { color: "#ff92be" },
        ".cm-bw2-error-line": { backgroundColor: "#ff55551c" },
        ".cm-bw2-error-token": { textDecoration: "underline wavy #ff7b7b" },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "#44688c66" },
      }, { dark: true }),
    ],
  });
  return {
    getValue: () => view.state.doc.toString(),
    setValue: (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    setError: (position) => view.dispatch({ effects: setError.of(position) }),
    focusError: (position) => {
      const anchor = bw2ScriptSourceOffset(view.state.doc, position);
      view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
      view.focus();
    },
    destroy: () => view.destroy(),
    getCursor: () => cursorFor(view),
    refreshLayout: () => view.requestMeasure(),
  };
}
