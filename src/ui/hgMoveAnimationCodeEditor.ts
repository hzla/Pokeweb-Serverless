import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate, drawSelection, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { HG_MOVE_ANIMATION_HELPER_BY_NAME, type HgMoveAnimationHelperDefinition } from "../pokeweb/hgMoveAnimationDocs";
import { getHgMoveAnimationCommandDefinitions, getHgMoveAnimationReadableCommandAliases, type HgMoveAnimationCommandDefinition } from "../pokeweb/hgMoveAnimationModel";

export type HgMoveAnimationCodeEditor = {
  destroy: () => void;
  getValue: () => string;
  replaceCommandParams: (reference: HgCommandReference, params: string[]) => void;
};

export type HgCommandReference = {
  name: string;
  definition?: HgMoveAnimationCommandDefinition;
  helper?: HgHelperDefinition;
  params: string[];
  lineText: string;
  lineFrom: number;
  lineTo: number;
};

export type HgHelperDefinition = HgMoveAnimationHelperDefinition;

type HgMoveAnimationCodeEditorOptions = {
  onChange: (text: string) => void;
  onCommandSelected: (reference?: HgCommandReference) => void;
  readOnly?: boolean;
  commandDefinitions?: HgMoveAnimationCommandDefinition[];
  readableCommandAliases?: Array<{ alias: string; command: string }>;
  helperByName?: Map<string, HgHelperDefinition>;
  constants?: Set<string>;
};

type CommandToken = { name: string; from: number; to: number; lineText: string; lineFrom: number; lineTo: number };
type HighlightRange = { from: number; to: number; mark: Decoration };
type EditorContext = {
  primitiveByName: Map<string, HgMoveAnimationCommandDefinition>;
  readablePrimitiveByName: Map<string, HgMoveAnimationCommandDefinition>;
  helperByName: Map<string, HgHelperDefinition>;
  constants: Set<string>;
};

const defaultConstants = new Set(["PAN_LEFT", "PAN_RIGHT", "PAN_CENTER", "ANIM_TARGET_USER", "ANIM_TARGET_DEFENDER", "ANIM_TARGET_MISC", "ANIM_TARGET_DEFENDER_SIDE"]);

const commandMark = Decoration.mark({ class: "cm-hg-command", attributes: { style: "color:#8be9c1;font-weight:650" } });
const helperMark = Decoration.mark({ class: "cm-hg-helper", attributes: { style: "color:#f7d774;font-weight:650" } });
const directiveMark = Decoration.mark({ class: "cm-hg-directive", attributes: { style: "color:#c792ea" } });
const labelMark = Decoration.mark({ class: "cm-hg-label", attributes: { style: "color:#82aaff;font-weight:650" } });
const numberMark = Decoration.mark({ class: "cm-hg-number", attributes: { style: "color:#ffb86c" } });
const constantMark = Decoration.mark({ class: "cm-hg-constant", attributes: { style: "color:#89ddff" } });
const commentMark = Decoration.mark({ class: "cm-hg-comment", attributes: { style: "color:#7f8496;font-style:italic" } });
const stringMark = Decoration.mark({ class: "cm-hg-string", attributes: { style: "color:#f1fa8c" } });
const unknownCommandMark = Decoration.mark({ class: "cm-hg-unknown-command", attributes: { style: "color:#ff8080;text-decoration:underline wavy rgba(255,128,128,.7)" } });

export function installHgMoveAnimationCodeEditor(host: HTMLElement, script: string, options: HgMoveAnimationCodeEditorOptions): HgMoveAnimationCodeEditor {
  const context = createEditorContext(options);
  const view = new EditorView({
    parent: host,
    doc: script,
    extensions: [
      lineNumbers(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorState.readOnly.of(options.readOnly ?? false),
      EditorView.editable.of(!(options.readOnly ?? false)),
      createHgMoveAnimationHighlighting(context),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) options.onChange(update.state.doc.toString());
        if (update.docChanged || update.selectionSet) options.onCommandSelected(commandReferenceAtSelection(update.view, context));
      }),
      EditorView.theme({
        "&": {
          backgroundColor: "#181a23",
          color: "#f4f4f6",
          fontSize: "13px",
          height: "100%",
        },
        ".cm-scroller": {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          overflow: "auto",
        },
        ".cm-content": {
          caretColor: "#f8f8f2",
          minHeight: "100%",
          padding: "14px 0",
        },
        ".cm-cursor": {
          borderLeftColor: "#f8f8f2",
          borderLeftWidth: "2px",
        },
        ".cm-gutters": {
          backgroundColor: "#13151d",
          borderRight: "1px solid #343748",
          color: "#8f95aa",
        },
        ".cm-activeLine": {
          backgroundColor: "rgba(88, 168, 143, 0.09)",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "rgba(88, 168, 143, 0.14)",
        },
        ".cm-hg-command": {
          color: "#8be9c1",
          fontWeight: "650",
        },
        ".cm-hg-helper": {
          color: "#f7d774",
          fontWeight: "650",
        },
        ".cm-hg-directive": {
          color: "#c792ea",
        },
        ".cm-hg-label": {
          color: "#82aaff",
          fontWeight: "650",
        },
        ".cm-hg-number": {
          color: "#ffb86c",
        },
        ".cm-hg-constant": {
          color: "#89ddff",
        },
        ".cm-hg-string": {
          color: "#f1fa8c",
        },
        ".cm-hg-comment": {
          color: "#7f8496",
          fontStyle: "italic",
        },
        ".cm-hg-unknown-command": {
          color: "#ff8080",
          textDecoration: "underline wavy rgba(255, 128, 128, 0.7)",
        },
      }),
    ],
  });
  options.onCommandSelected(commandReferenceAtSelection(view, context));
  return {
    destroy: () => view.destroy(),
    getValue: () => view.state.doc.toString(),
    replaceCommandParams: (reference, params) => replaceCommandParams(view, reference, params),
  };
}

function createEditorContext(options: HgMoveAnimationCodeEditorOptions): EditorContext {
  const primitiveDefinitions = options.commandDefinitions ?? getHgMoveAnimationCommandDefinitions();
  const primitiveByName = new Map(primitiveDefinitions.map((definition) => [definition.name.toLowerCase(), definition]));
  const readableAliases = options.readableCommandAliases ?? getHgMoveAnimationReadableCommandAliases();
  const readablePrimitiveByName = new Map(
    readableAliases.flatMap((entry) => {
      const definition = primitiveByName.get(entry.command.toLowerCase());
      return definition ? [[entry.alias.toLowerCase(), definition] as const] : [];
    }),
  );
  return {
    primitiveByName,
    readablePrimitiveByName,
    helperByName: options.helperByName ?? HG_MOVE_ANIMATION_HELPER_BY_NAME,
    constants: options.constants ?? defaultConstants,
  };
}

function createHgMoveAnimationHighlighting(context: EditorContext) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, context);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) this.decorations = buildDecorations(update.view, context);
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}

function buildDecorations(view: EditorView, context: EditorContext): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      addLineDecorations(builder, line.from, line.text, context);
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

function addLineDecorations(builder: RangeSetBuilder<Decoration>, lineStart: number, text: string, context: EditorContext): void {
  const ranges: HighlightRange[] = [];
  const commentIndex = firstCommentIndex(text);
  const codeEnd = commentIndex >= 0 ? commentIndex : text.length;
  const code = text.slice(0, codeEnd);
  const label = /^(\s*[A-Za-z_][A-Za-z0-9_]*:)/u.exec(code);
  if (label) {
    ranges.push({ from: lineStart + label[1].search(/\S/u), to: lineStart + label[1].length, mark: labelMark });
  } else {
    const directive = /^(\s*\.[A-Za-z_][A-Za-z0-9_]*)/u.exec(code);
    if (directive) {
      ranges.push({ from: lineStart + directive[1].search(/\S/u), to: lineStart + directive[1].length, mark: directiveMark });
    } else {
      const command = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)/u.exec(code);
      if (command) {
        const from = lineStart + command[1].length;
        const to = from + command[2].length;
        const lower = command[2].toLowerCase();
        ranges.push({ from, to, mark: context.primitiveByName.has(lower) ? commandMark : context.readablePrimitiveByName.has(lower) || context.helperByName.has(lower) ? helperMark : unknownCommandMark });
      }
    }
  }

  const stringRanges: Array<{ from: number; to: number }> = [];
  for (const match of code.matchAll(/"[^"]*"|'[^']*'/gu)) {
    if (match.index === undefined) continue;
    const from = lineStart + match.index;
    const to = from + match[0].length;
    stringRanges.push({ from, to });
    ranges.push({ from, to, mark: stringMark });
  }
  for (const match of code.matchAll(/(?<![A-Za-z0-9_])[-+]?(?:0x[0-9a-f]+|\d+)(?![A-Za-z0-9_])/giu)) {
    if (match.index === undefined) continue;
    const from = lineStart + match.index;
    const to = from + match[0].length;
    if (!rangeIntersectsAny(from, to, stringRanges)) ranges.push({ from, to, mark: numberMark });
  }
  for (const match of code.matchAll(/[A-Z][A-Z0-9_]+/gu)) {
    if (match.index === undefined || !context.constants.has(match[0])) continue;
    const from = lineStart + match.index;
    const to = from + match[0].length;
    if (!rangeIntersectsAny(from, to, stringRanges)) ranges.push({ from, to, mark: constantMark });
  }
  if (commentIndex >= 0) ranges.push({ from: lineStart + commentIndex, to: lineStart + text.length, mark: commentMark });
  ranges
    .filter((range) => range.to > range.from)
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .forEach((range) => builder.add(range.from, range.to, range.mark));
}

function rangeIntersectsAny(from: number, to: number, ranges: Array<{ from: number; to: number }>): boolean {
  return ranges.some((range) => from < range.to && to > range.from);
}

function commandReferenceAtSelection(view: EditorView, context: EditorContext): HgCommandReference | undefined {
  const token = commandTokenAt(view, view.state.selection.main.head);
  if (!token) return undefined;
  const params = parseParamText(token.lineText);
  const lower = token.name.toLowerCase();
  return {
    name: token.name,
    definition: context.primitiveByName.get(lower) ?? context.readablePrimitiveByName.get(lower),
    helper: context.helperByName.get(lower),
    params,
    lineText: token.lineText,
    lineFrom: token.lineFrom,
    lineTo: token.lineTo,
  };
}

function commandTokenAt(view: EditorView, pos: number): CommandToken | undefined {
  const line = view.state.doc.lineAt(pos);
  const commentIndex = firstCommentIndex(line.text);
  const code = commentIndex >= 0 ? line.text.slice(0, commentIndex) : line.text;
  const match = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)/u.exec(code);
  if (!match || code.trimStart().startsWith(".") || /^\s*[A-Za-z_][A-Za-z0-9_]*:/u.test(code)) return undefined;
  const from = line.from + match[1].length;
  const to = from + match[2].length;
  return { name: match[2], from, to, lineText: line.text, lineFrom: line.from, lineTo: line.to };
}

function parseParamText(text: string): string[] {
  const commentIndex = firstCommentIndex(text);
  const code = commentIndex >= 0 ? text.slice(0, commentIndex) : text;
  const rest = /^\s*[A-Za-z_][A-Za-z0-9_]*(?:\s+(.*))?$/u.exec(code)?.[1] ?? "";
  return rest
    .split(/\s*,\s*|\s+/u)
    .map((param) => param.trim())
    .filter(Boolean);
}

function firstCommentIndex(text: string): number {
  let quote: string | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? undefined : char;
      continue;
    }
    if (quote) continue;
    if (char === "/" && text[index + 1] === "/") return index;
    if (char === "@" || char === ";") return index;
  }
  return -1;
}

function replaceCommandParams(view: EditorView, reference: HgCommandReference, params: string[]): void {
  const line = view.state.doc.lineAt(Math.min(reference.lineFrom, view.state.doc.length));
  const commentIndex = firstCommentIndex(line.text);
  const code = commentIndex >= 0 ? line.text.slice(0, commentIndex) : line.text;
  const comment = commentIndex >= 0 ? line.text.slice(commentIndex).trimStart() : "";
  const command = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)/u.exec(code);
  if (!command) return;
  const nextCode = `${command[1]}${command[2]}${params.length ? ` ${params.join(", ")}` : ""}`;
  const nextLine = `${nextCode.trimEnd()}${comment ? ` ${comment}` : ""}`;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: nextLine },
    selection: { anchor: line.from + Math.min(nextLine.length, nextCode.length) },
  });
}
