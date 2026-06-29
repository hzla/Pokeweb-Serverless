import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate, drawSelection, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import commandDocsData from "../assets/data/moveAnimationCommandDocs.json";
import {
  getMoveAnimationCommandAliases,
  getMoveAnimationDisplayCommandName,
  getMoveAnimationGenericCommandAliases,
} from "../pokeweb/moveAnimationCommandNames";
import { getMoveAnimationCommandDefinitions } from "../pokeweb/moveAnimationModel";
import {
  getMoveAnimationEnumCompletions,
  isMoveAnimationEnumToken,
  isMoveAnimationFx32Token,
  parseMoveAnimationEditorParam,
} from "../pokeweb/moveAnimationParamSemantics";
import { escapeHtml } from "./dom";

export type MoveAnimationCodeEditor = {
  getValue: () => string;
  setValue: (value: string) => void;
  setInvalid: (invalid: boolean) => void;
  destroy: () => void;
};

export type MoveAnimationCommandDoc = {
  name: string;
  opcode: number;
  hex: string;
  category: string;
  handlerMacro: string;
  description: string;
  currentPokewebName: string;
  params: Array<{ index: number; name: string; currentArg: string; description: string }>;
  notes: string[];
};

export type MoveAnimationCommandReference = {
  clickedName: string;
  doc: MoveAnimationCommandDoc;
  lineText: string;
};

type MoveAnimationCodeEditorOptions = {
  onCommandSelected?: (reference: MoveAnimationCommandReference) => void;
};

type CommandToken = { name: string; from: number; to: number; lineFrom: number; lineTo: number; lineText: string };
type ColorParamInfo = { red: number; green: number; blue: number };
type ParamToken = { text: string; from: number; to: number; index: number };
type CodeDecorationRange = { from: number; to: number; decoration: Decoration; priority: number };

const commandDefinitions = getMoveAnimationCommandDefinitions();
const commandNamesLower = new Set<string>();
const commandDefinitionsByName = new Map<string, (typeof commandDefinitions)[number]>();
for (const definition of commandDefinitions) {
  for (const alias of commandAliasesForDefinition(definition)) {
    commandNamesLower.add(alias.toLowerCase());
    commandDefinitionsByName.set(alias.toLowerCase(), definition);
  }
}
const commandDocs = new Map<string, MoveAnimationCommandDoc>();
for (const doc of commandDocsData.commands as MoveAnimationCommandDoc[]) {
  for (const alias of [doc.name, doc.currentPokewebName, getMoveAnimationDisplayCommandName(doc.name), ...getMoveAnimationCommandAliases(doc.name), ...getMoveAnimationGenericCommandAliases(doc.opcode)]) {
    commandDocs.set(alias.toLowerCase(), doc);
  }
}
const colorParamInfo = buildColorParamInfo();

const commandMark = Decoration.mark({ class: "cm-move-command" });
const directiveMark = Decoration.mark({ class: "cm-move-directive" });
const labelMark = Decoration.mark({ class: "cm-move-label" });
const numberMark = Decoration.mark({ class: "cm-move-number" });
const enumMark = Decoration.mark({ class: "cm-move-enum" });
const fx32Mark = Decoration.mark({ class: "cm-move-fx32" });
const commentMark = Decoration.mark({ class: "cm-move-comment" });
const unknownCommandMark = Decoration.mark({ class: "cm-move-unknown-command" });

export function installMoveAnimationCodeEditor(host: HTMLElement, script: string, options: MoveAnimationCodeEditorOptions = {}): MoveAnimationCodeEditor {
  const view = new EditorView({
    parent: host,
    doc: script,
    extensions: [
      lineNumbers(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      moveAnimationHighlighting,
      createMoveAnimationAutocomplete(),
      moveAnimationInteractions(host, options),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": {
          minHeight: "420px",
          backgroundColor: "#272822",
          color: "#f8f8f2",
          fontSize: "15px",
        },
        ".cm-cursor": {
          borderLeftColor: "#f8f8f2",
          borderLeftWidth: "2px",
        },
        ".cm-content": {
          caretColor: "#f8f8f2",
          cursor: "text",
          padding: "12px 0",
        },
        ".cm-scroller": {
          cursor: "text",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        },
        ".cm-gutters": {
          backgroundColor: "#1f201b",
          color: "#75715e",
          borderRight: "1px solid #3e3d32",
        },
        ".cm-activeLine": {
          backgroundColor: "#3e3d32",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "#3e3d32",
        },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
          backgroundColor: "rgba(73, 156, 216, 0.42)",
        },
        ".cm-content ::selection": {
          backgroundColor: "rgba(73, 156, 216, 0.42)",
        },
        "& .cm-move-command": {
          color: "#66d9ef",
          cursor: "text",
          fontWeight: "700",
          textDecoration: "underline",
          textDecorationColor: "rgba(102, 217, 239, 0.35)",
          textUnderlineOffset: "3px",
        },
        "& .cm-move-command:hover": {
          backgroundColor: "rgba(102, 217, 239, 0.14)",
        },
        "& .cm-move-unknown-command": {
          color: "#f92672",
          cursor: "text",
          fontWeight: "700",
        },
        "& .cm-move-directive": {
          color: "#f92672",
          cursor: "text",
          fontWeight: "700",
        },
        "& .cm-move-label": {
          color: "#a6e22e",
          cursor: "text",
          fontWeight: "700",
        },
        "& .cm-move-number": {
          color: "#fd971f",
          cursor: "text",
        },
        "& .cm-move-enum": {
          color: "#ae81ff",
          cursor: "text",
          fontWeight: "650",
        },
        "& .cm-move-fx32": {
          color: "#e6db74",
          cursor: "text",
          fontWeight: "650",
        },
        "& .cm-move-color-param": {
          backgroundColor: "color-mix(in srgb, var(--move-param-color, #ffffff) 28%, transparent)",
          borderBottom: "2px solid var(--move-param-color, #ffffff)",
          borderRadius: "2px",
          color: "#f8f8f2",
          cursor: "text",
        },
        "& .cm-move-comment": {
          color: "#75715e",
          cursor: "text",
          fontStyle: "italic",
        },
      }),
    ],
  });

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (value: string) => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    },
    setInvalid: (invalid: boolean) => {
      host.classList.toggle("invalid", invalid);
    },
    destroy: () => view.destroy(),
  };
}

const moveAnimationHighlighting = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) this.decorations = buildDecorations(update.view);
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

function createMoveAnimationAutocomplete() {
  return autocompletion({
    override: [moveAnimationCompletions],
  });
}

function moveAnimationCompletions(completionContext: CompletionContext): CompletionResult | null {
  const line = completionContext.state.doc.lineAt(completionContext.pos);
  const offset = completionContext.pos - line.from;
  const commentIndex = line.text.indexOf("@");
  if (commentIndex >= 0 && offset > commentIndex) return null;

  const codeEnd = commentIndex >= 0 ? commentIndex : line.text.length;
  const codeToCursor = line.text.slice(0, Math.min(offset, codeEnd));
  if (/^\s*\./u.test(line.text) || /^\s*[A-Za-z_][A-Za-z0-9_]*:/u.test(line.text)) return null;

  const word = completionContext.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/u);
  if (!word && !completionContext.explicit) return null;

  if (/^\s*[A-Za-z_][A-Za-z0-9_]*$/u.test(codeToCursor) || /^\s*$/u.test(codeToCursor)) {
    return {
      from: word?.from ?? completionContext.pos,
      options: buildMoveAnimationCommandCompletions(),
      validFor: /^[A-Za-z_][A-Za-z0-9_]*$/u,
    };
  }

  const paramContext = parameterContextAtOffset(line.text, offset);
  if (paramContext) {
    const semanticOptions = buildMoveAnimationSemanticCompletions(paramContext.commandName, paramContext.paramIndex);
    if (semanticOptions.length) {
      return {
        from: word?.from ?? completionContext.pos,
        options: semanticOptions,
        validFor: /^[A-Za-z_][A-Za-z0-9_]*$/u,
      };
    }
  }

  const options = buildMoveAnimationLabelCompletions(completionContext.state.doc.toString());
  if (!options.length) return null;
  return {
    from: word?.from ?? completionContext.pos,
    options,
    validFor: /^[A-Za-z_][A-Za-z0-9_]*$/u,
  };
}

function buildMoveAnimationSemanticCompletions(commandName: string, paramIndex: number): Completion[] {
  return getMoveAnimationEnumCompletions(commandName, paramIndex).map((value) => ({
    label: value.name,
    type: "constant",
    detail: `${value.value}${value.source ? ` / ${value.source}` : ""}`,
    info: value.description,
  }));
}

function buildMoveAnimationCommandCompletions(): Completion[] {
  const options = new Map<string, Completion>();
  for (const definition of commandDefinitions) {
    const doc = commandDocs.get(definition.name.toLowerCase());
    const params = doc?.params.map((param) => param.name) ?? definition.params;
    const signature = params.length ? ` ${params.join(", ")}` : "";
    const displayName = getMoveAnimationDisplayCommandName(definition.name);
    options.set(displayName.toLowerCase(), {
      label: displayName,
      type: "command",
      detail: `opcode ${definition.opcode}${definition.name !== displayName ? ` / ${definition.name}` : ""}${signature}`,
      info: doc ? `${doc.category}: ${doc.description}` : undefined,
      apply: `${displayName}${definition.params.length ? " " : ""}`,
    });
  }
  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function commandAliasesForDefinition(definition: (typeof commandDefinitions)[number]): string[] {
  return [definition.name, getMoveAnimationDisplayCommandName(definition.name), ...getMoveAnimationCommandAliases(definition.name), ...getMoveAnimationGenericCommandAliases(definition.opcode)];
}

function buildMoveAnimationLabelCompletions(text: string): Completion[] {
  const labels = new Set<string>();
  for (const match of text.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*):/gmu)) labels.add(match[1]);
  return [...labels].sort((a, b) => a.localeCompare(b)).map((label) => ({ label, type: "variable", detail: "label" }));
}

function moveAnimationInteractions(host: HTMLElement, options: MoveAnimationCodeEditorOptions): ReturnType<typeof EditorView.domEventHandlers> {
  let tooltip: HTMLButtonElement | undefined;
  let tooltipToken: CommandToken | undefined;
  let hideTimer = 0;

  const hideTooltip = () => {
    window.clearTimeout(hideTimer);
    tooltip?.remove();
    tooltip = undefined;
    tooltipToken = undefined;
  };

  const scheduleHide = () => {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hideTooltip, 160);
  };

  const showTooltip = (view: EditorView, token: CommandToken) => {
    if (!colorParamInfo.has(token.name.toLowerCase())) return;
    if (tooltip && tooltipToken?.from === token.from && tooltipToken?.to === token.to) return;
    hideTooltip();
    const coords = view.coordsAtPos(token.to);
    if (!coords) return;
    tooltipToken = token;
    tooltip = document.createElement("button");
    tooltip.className = "move-command-color-tooltip";
    tooltip.type = "button";
    tooltip.textContent = "Choose Color";
    tooltip.style.left = `${coords.right + 8}px`;
    tooltip.style.top = `${coords.top - 4}px`;
    tooltip.addEventListener("mouseenter", () => window.clearTimeout(hideTimer));
    tooltip.addEventListener("mouseleave", scheduleHide);
    tooltip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideTooltip();
      openColorPicker(view, token);
    });
    document.body.append(tooltip);
  };

  host.addEventListener("mouseleave", scheduleHide);

  return EditorView.domEventHandlers({
    click: (event, view) => {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      const token = commandTokenAt(view, pos);
      if (!token) return false;
      const doc = commandDocs.get(token.name.toLowerCase());
      if (!doc) return false;
      options.onCommandSelected?.({ clickedName: token.name, doc, lineText: token.lineText });
      return true;
    },
    mousemove: (event, view) => {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const token = pos === null ? undefined : commandTokenAt(view, pos);
      if (!token || !colorParamInfo.has(token.name.toLowerCase())) {
        scheduleHide();
        return false;
      }
      showTooltip(view, token);
      return false;
    },
    mouseleave: () => {
      scheduleHide();
      return false;
    },
  });
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      addLineDecorations(builder, line.from, line.text);
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

function addLineDecorations(builder: RangeSetBuilder<Decoration>, lineStart: number, text: string): void {
  const ranges: CodeDecorationRange[] = [];
  const add = (from: number, to: number, decoration: Decoration, priority = 0): void => {
    if (to > from) ranges.push({ from, to, decoration, priority });
  };
  const flush = (): void => {
    ranges
      .sort((a, b) => a.from - b.from || a.priority - b.priority || a.to - b.to)
      .forEach((range) => builder.add(range.from, range.to, range.decoration));
  };
  const commentIndex = text.indexOf("@");
  const codeEnd = commentIndex >= 0 ? commentIndex : text.length;

  const label = /^(\s*[A-Za-z_][A-Za-z0-9_]*:)/u.exec(text);
  if (label) {
    add(lineStart + label[1].search(/\S/u), lineStart + label[1].length, labelMark);
    if (commentIndex >= 0) add(lineStart + commentIndex, lineStart + text.length, commentMark);
    flush();
    return;
  }

  const directive = /^(\s*\.[A-Za-z_][A-Za-z0-9_]*)/u.exec(text);
  if (directive) {
    add(lineStart + directive[1].search(/\S/u), lineStart + directive[1].length, directiveMark);
  } else {
    const command = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)/u.exec(text.slice(0, codeEnd));
    if (command) {
      const from = lineStart + command[1].length;
      const to = from + command[2].length;
      add(from, to, commandNamesLower.has(command[2].toLowerCase()) ? commandMark : unknownCommandMark);
    }
  }

  const parsedCommand = parseCommandLineHeader(text.slice(0, codeEnd));
  const tokens = parsedCommand ? paramTokensFromLine(text.slice(0, codeEnd), parsedCommand.paramsFrom, parsedCommand.commandName) : [];
  const semanticTokenRanges: Array<{ from: number; to: number }> = [];
  for (const token of tokens) {
    if (isMoveAnimationEnumToken(token.text)) {
      semanticTokenRanges.push({ from: token.from, to: token.to });
      add(lineStart + token.from, lineStart + token.to, enumMark);
    }
    if (isMoveAnimationFx32Token(token.text)) {
      semanticTokenRanges.push({ from: token.from, to: token.to });
      add(lineStart + token.from, lineStart + token.to, fx32Mark);
    }
  }
  const colorMark = parsedCommand ? colorDecorationForLine(parsedCommand.commandName, tokens) : undefined;
  const colorTokenRanges = new Set<string>();
  if (colorMark) {
    for (const token of colorMark.tokens) {
      colorTokenRanges.add(`${token.from}:${token.to}`);
      add(lineStart + token.from, lineStart + token.to, colorMark.decoration, 1);
    }
  }

  const numberPattern = /(?<![A-Za-z0-9_])[-+]?(?:0x[0-9a-f]+|\d+)(?![A-Za-z0-9_])/giu;
  for (const match of text.slice(0, codeEnd).matchAll(numberPattern)) {
    if (match.index === undefined) continue;
    const from = match.index;
    const to = match.index + match[0].length;
    if (colorTokenRanges.has(`${from}:${to}`)) continue;
    if (semanticTokenRanges.some((range) => rangesOverlap(from, to, range.from, range.to))) continue;
    add(lineStart + from, lineStart + to, numberMark);
  }
  if (commentIndex >= 0) add(lineStart + commentIndex, lineStart + text.length, commentMark);
  flush();
}

function rangesOverlap(leftFrom: number, leftTo: number, rightFrom: number, rightTo: number): boolean {
  return leftFrom < rightTo && rightFrom < leftTo;
}

function commandTokenAt(view: EditorView, pos: number): CommandToken | undefined {
  const line = view.state.doc.lineAt(pos);
  const commentIndex = line.text.indexOf("@");
  const code = commentIndex >= 0 ? line.text.slice(0, commentIndex) : line.text;
  const match = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)/u.exec(code);
  if (!match || code.trimStart().startsWith(".") || code.trimEnd().endsWith(":")) return undefined;
  const from = line.from + match[1].length;
  const to = from + match[2].length;
  if (pos < from || pos > to || !commandNamesLower.has(match[2].toLowerCase())) return undefined;
  return { name: match[2], from, to, lineFrom: line.from, lineTo: line.to, lineText: line.text };
}

function openColorPicker(view: EditorView, token: CommandToken): void {
  const info = colorParamInfo.get(token.name.toLowerCase());
  if (!info) return;
  document.querySelector<HTMLElement>(".move-command-color-popover")?.remove();
  const parsed = parseCommandLineText(token.lineText);
  const initial = colorFromParams(parsed.params, info);
  const popover = document.createElement("div");
  popover.className = "move-command-color-popover";
  popover.innerHTML = `
    <label>
      <span>Choose Color</span>
      <input class="move-command-color-input" type="color" value="${escapeHtml(initial)}">
    </label>
    <div class="move-command-color-actions">
      <button class="move-command-color-apply" type="button">Apply</button>
      <button class="move-command-color-cancel" type="button">Cancel</button>
    </div>
  `;
  const coords = view.coordsAtPos(token.to);
  popover.style.left = `${Math.max(12, coords?.left ?? 12)}px`;
  popover.style.top = `${(coords?.bottom ?? 0) + 8}px`;
  const close = () => {
    document.removeEventListener("keydown", onKeydown);
    popover.remove();
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  popover.querySelector<HTMLButtonElement>(".move-command-color-cancel")?.addEventListener("click", close);
  popover.querySelector<HTMLButtonElement>(".move-command-color-apply")?.addEventListener("click", () => {
    const value = popover.querySelector<HTMLInputElement>(".move-command-color-input")?.value ?? initial;
    applyColorToCommandLine(view, token, info, value);
    close();
  });
  document.addEventListener("keydown", onKeydown);
  document.body.append(popover);
  popover.querySelector<HTMLInputElement>(".move-command-color-input")?.focus();
}

export function getMoveAnimationCommandLineColor(text: string): string | undefined {
  const parsed = parseCommandLineText(text);
  const info = colorParamInfo.get(parsed.commandName.toLowerCase());
  if (!info) return undefined;
  return colorFromParams(parsed.params, info);
}

function applyColorToCommandLine(view: EditorView, token: CommandToken, info: ColorParamInfo, value: string): void {
  const parsed = parseCommandLineText(token.lineText);
  const params = parsed.params.slice();
  const [r, g, b] = hexToRgb5(value);
  const maxIndex = Math.max(info.red, info.green, info.blue);
  while (params.length <= maxIndex) params.push(0);
  params[info.red] = r;
  params[info.green] = g;
  params[info.blue] = b;
  const indent = /^\s*/u.exec(token.lineText)?.[0] ?? "";
  const comment = parsed.comment ? ` ${parsed.comment}` : "";
  const nextLine = `${indent}${token.name} ${params.join(", ")}${comment}`;
  view.dispatch({ changes: { from: token.lineFrom, to: token.lineTo, insert: nextLine } });
}

function parseCommandLineText(text: string): { commandName: string; params: number[]; comment: string } {
  const commentIndex = text.indexOf("@");
  const code = commentIndex >= 0 ? text.slice(0, commentIndex) : text;
  const comment = commentIndex >= 0 ? text.slice(commentIndex).trimEnd() : "";
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.*))?$/u.exec(code);
  const commandName = match?.[1] ?? "";
  return { commandName, params: parseParamText(match?.[2] ?? "", commandName), comment };
}

function parseParamText(input: string, commandName: string): number[] {
  return input
    .trim()
    .split(/\s*,\s*|\s+/u)
    .filter(Boolean)
    .map((value, index) => parseMoveAnimationEditorParam(commandName, index, value))
    .filter((value): value is number => Number.isFinite(value));
}

function colorFromParams(params: number[], info: ColorParamInfo): string {
  if (params.length === 5 && info.red === 4) return rgb5ToHex(params[4] & 0x1f, (params[4] >>> 5) & 0x1f, (params[4] >>> 10) & 0x1f);
  return rgb5ToHex(params[info.red] ?? 31, params[info.green] ?? 31, params[info.blue] ?? 31);
}

function parameterContextAtOffset(text: string, offset: number): { commandName: string; paramIndex: number } | undefined {
  const commentIndex = text.indexOf("@");
  const codeEnd = commentIndex >= 0 ? commentIndex : text.length;
  if (offset > codeEnd) return undefined;
  const parsed = parseCommandLineHeader(text.slice(0, codeEnd));
  if (!parsed) return undefined;
  const command = commandDefinitionsByName.get(parsed.commandName.toLowerCase());
  if (!command) return undefined;
  if (offset <= parsed.commandEnd) return undefined;
  const tokens = paramTokensFromLine(text.slice(0, codeEnd), parsed.paramsFrom, parsed.commandName);
  const active = tokens.find((token) => offset >= token.from && offset <= token.to);
  if (active) return { commandName: command.name, paramIndex: active.index };
  return { commandName: command.name, paramIndex: tokens.filter((token) => token.to <= offset).length };
}

function parseCommandLineHeader(code: string): { commandName: string; commandEnd: number; paramsFrom: number } | undefined {
  const match = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*)/u.exec(code);
  if (!match || code.trimStart().startsWith(".") || code.trimEnd().endsWith(":")) return undefined;
  const commandName = match[2];
  if (!commandNamesLower.has(commandName.toLowerCase())) return undefined;
  const commandEnd = match[1].length + commandName.length;
  return { commandName, commandEnd, paramsFrom: commandEnd + match[3].length };
}

function paramTokensFromLine(code: string, paramsFrom: number, commandName: string): ParamToken[] {
  const tokens: ParamToken[] = [];
  const rest = code.slice(paramsFrom);
  const pattern = /[^\s,]+/gu;
  for (const match of rest.matchAll(pattern)) {
    if (match.index === undefined) continue;
    tokens.push({ text: match[0], from: paramsFrom + match.index, to: paramsFrom + match.index + match[0].length, index: tokens.length });
  }
  const definition = commandDefinitionsByName.get(commandName.toLowerCase());
  return definition ? tokens.slice(0, definition.params.length) : tokens;
}

function colorDecorationForLine(commandName: string, tokens: ParamToken[]): { decoration: Decoration; tokens: ParamToken[] } | undefined {
  const info = colorParamInfo.get(commandName.toLowerCase());
  if (!info) return undefined;
  const params = tokens.map((token) => parseMoveAnimationEditorParam(commandName, token.index, token.text)).filter((value): value is number => Number.isFinite(value));
  const color = colorFromParams(params, info);
  const colorTokens = [tokens[info.red], tokens[info.green], tokens[info.blue]].filter((token): token is ParamToken => Boolean(token));
  if (!colorTokens.length) return undefined;
  return {
    decoration: Decoration.mark({
      class: "cm-move-color-param",
      attributes: { style: `--move-param-color: ${color};` },
    }),
    tokens: colorTokens,
  };
}

function hexToRgb5(value: string): [number, number, number] {
  const hex = /^#?([0-9a-f]{6})$/iu.exec(value)?.[1] ?? "ffffff";
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return [Math.round((r / 255) * 31), Math.round((g / 255) * 31), Math.round((b / 255) * 31)];
}

function rgb5ToHex(r: number, g: number, b: number): string {
  const toHex = (value: number) => (((Math.max(0, Math.min(31, Math.round(value))) << 3) | (Math.max(0, Math.min(31, Math.round(value))) >>> 2)).toString(16).padStart(2, "0"));
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function buildColorParamInfo(): Map<string, ColorParamInfo> {
  const out = new Map<string, ColorParamInfo>();
  for (const doc of commandDocsData.commands as MoveAnimationCommandDoc[]) {
    const red = doc.params.find((param) => param.name.toLowerCase() === "r");
    const green = doc.params.find((param) => param.name.toLowerCase() === "g");
    const blue = doc.params.find((param) => param.name.toLowerCase() === "b");
    if (!red || !green || !blue) continue;
    const info = { red: red.index, green: green.index, blue: blue.index };
    for (const alias of [doc.name, doc.currentPokewebName, getMoveAnimationDisplayCommandName(doc.name), ...getMoveAnimationCommandAliases(doc.name), ...getMoveAnimationGenericCommandAliases(doc.opcode)]) {
      out.set(alias.toLowerCase(), info);
    }
  }
  return out;
}
