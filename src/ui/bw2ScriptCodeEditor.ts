import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { EditorState, StateEffect, StateField, Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, drawSelection, highlightActiveLine, keymap, lineNumbers, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { BW2_SCRIPT_COMMANDS, type SourcePosition } from "../pokeweb/bw2ScriptCompiler";
import { bw2CommandByName } from "../pokeweb/bw2ScriptCompiler/commands";

const KEYWORDS = new Set(["script", "work", "def", "do", "end", "if", "elsif", "else", "unless", "while", "until", "case", "when", "break", "next", "return", "call", "true", "false", "preserve_layout", "entry", "block", "data", "label", "jump", "overlay"]);
export type Bw2ScriptHighlight = { from: number; to: number; kind: "keyword" | "symbol" | "number" | "constant" | "command" | "helper" | "comment" | "string" | "operator" };

/** Tolerant lexical highlighting also works while source is incomplete/invalid. */
export function highlightBw2ScriptLine(line: string): Bw2ScriptHighlight[] {
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
    else if (afterDef) kind = "helper";
    else if (/^[A-Z][A-Z_0-9]*$/.test(text)) kind = "constant";
    else if (bw2CommandByName(text, true) || /^cmd_[0-9a-f]{4}$/.test(text)) kind = "command";
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
  for (const range of view.visibleRanges) {
    let line = view.state.doc.lineAt(range.from);
    while (line.from <= range.to) {
      if (!seen.has(line.number)) {
        seen.add(line.number);
        for (const token of highlightBw2ScriptLine(line.text)) {
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
};
export type Bw2ScriptCursor = SourcePosition & { word: string; text: string };

function cursorFor(view: EditorView): Bw2ScriptCursor {
  const offset = view.state.selection.main.head;
  const line = view.state.doc.lineAt(offset);
  const column = offset - line.from;
  const word = [...line.text.matchAll(/[A-Za-z_]\w*/g)].find((match) => match.index! <= column && column <= match.index! + match[0].length)?.[0] ?? "";
  return { line: line.number, column: column + 1, word, text: line.text };
}

export function installBw2ScriptCodeEditor(host: HTMLElement, source: string, onChange: (source: string) => void, onCursor?: (cursor: Bw2ScriptCursor) => void): Bw2ScriptCodeEditor {
  const view = new EditorView({
    parent: host,
    doc: source,
    extensions: [
      lineNumbers(), history(), drawSelection(), highlightActiveLine(), highlighting, errorHighlight,
      EditorState.tabSize.of(2),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.contentAttributes.of({ "aria-label": "Ruby-like BW2 script source", spellcheck: "false" }),
      autocompletion({ override: [(context) => {
        const word = context.matchBefore(/[A-Za-z_]\w*/);
        if (!word || (word.from === word.to && !context.explicit)) return null;
        return { from: word.from, options: [...KEYWORDS].map((label) => ({ label, type: "keyword" })).concat(Object.keys(BW2_SCRIPT_COMMANDS).map((label) => ({ label, type: "function" }))) };
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
  };
}
