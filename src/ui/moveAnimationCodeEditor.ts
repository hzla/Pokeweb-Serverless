import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate, drawSelection, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import commandDocsData from "../assets/data/moveAnimationCommandDocs.json";
import { getMoveAnimationCommandDefinitions } from "../pokeweb/moveAnimationModel";
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

const commandDefinitions = getMoveAnimationCommandDefinitions();
const commandNames = new Set(commandDefinitions.map((command) => command.name));
const commandDocs = new Map<string, MoveAnimationCommandDoc>();
for (const doc of commandDocsData.commands as MoveAnimationCommandDoc[]) {
  commandDocs.set(doc.name.toLowerCase(), doc);
  commandDocs.set(doc.currentPokewebName.toLowerCase(), doc);
}
const colorParamInfo = buildColorParamInfo();

const commandMark = Decoration.mark({ class: "cm-move-command" });
const directiveMark = Decoration.mark({ class: "cm-move-directive" });
const labelMark = Decoration.mark({ class: "cm-move-label" });
const numberMark = Decoration.mark({ class: "cm-move-number" });
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
      moveAnimationInteractions(host, options),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": {
          minHeight: "420px",
          backgroundColor: "#171b26",
          color: "#f3f6ff",
          fontSize: "15px",
        },
        ".cm-cursor": {
          borderLeftColor: "#f8f8f2",
          borderLeftWidth: "2px",
        },
        ".cm-content": {
          caretColor: "#f8f8f2",
          padding: "12px 0",
        },
        ".cm-scroller": {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        },
        ".cm-gutters": {
          backgroundColor: "#11141d",
          color: "#8790a5",
          borderRight: "1px solid #3b4257",
        },
        ".cm-activeLine": {
          backgroundColor: "rgba(79, 209, 197, 0.08)",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "rgba(79, 209, 197, 0.12)",
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
  const commentIndex = text.indexOf("@");
  const codeEnd = commentIndex >= 0 ? commentIndex : text.length;

  const label = /^(\s*[A-Za-z_][A-Za-z0-9_]*:)/u.exec(text);
  if (label) {
    builder.add(lineStart + label[1].search(/\S/u), lineStart + label[1].length, labelMark);
    if (commentIndex >= 0) builder.add(lineStart + commentIndex, lineStart + text.length, commentMark);
    return;
  }

  const directive = /^(\s*\.[A-Za-z_][A-Za-z0-9_]*)/u.exec(text);
  if (directive) {
    builder.add(lineStart + directive[1].search(/\S/u), lineStart + directive[1].length, directiveMark);
  } else {
    const command = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)/u.exec(text.slice(0, codeEnd));
    if (command) {
      const from = lineStart + command[1].length;
      const to = from + command[2].length;
      builder.add(from, to, commandNames.has(command[2]) ? commandMark : unknownCommandMark);
    }
  }

  const numberPattern = /(?<![A-Za-z0-9_])[-+]?(?:0x[0-9a-f]+|\d+)(?![A-Za-z0-9_])/giu;
  for (const match of text.slice(0, codeEnd).matchAll(numberPattern)) {
    if (match.index === undefined) continue;
    builder.add(lineStart + match.index, lineStart + match.index + match[0].length, numberMark);
  }
  if (commentIndex >= 0) builder.add(lineStart + commentIndex, lineStart + text.length, commentMark);
}

function commandTokenAt(view: EditorView, pos: number): CommandToken | undefined {
  const line = view.state.doc.lineAt(pos);
  const commentIndex = line.text.indexOf("@");
  const code = commentIndex >= 0 ? line.text.slice(0, commentIndex) : line.text;
  const match = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)/u.exec(code);
  if (!match || code.trimStart().startsWith(".") || code.trimEnd().endsWith(":")) return undefined;
  const from = line.from + match[1].length;
  const to = from + match[2].length;
  if (pos < from || pos > to || !commandNames.has(match[2])) return undefined;
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

function parseCommandLineText(text: string): { params: number[]; comment: string } {
  const commentIndex = text.indexOf("@");
  const code = commentIndex >= 0 ? text.slice(0, commentIndex) : text;
  const comment = commentIndex >= 0 ? text.slice(commentIndex).trimEnd() : "";
  const rest = /^\s*[A-Za-z_][A-Za-z0-9_]*(?:\s+(.*))?$/u.exec(code)?.[1] ?? "";
  return { params: parseParamText(rest), comment };
}

function parseParamText(input: string): number[] {
  return input
    .trim()
    .split(/\s*,\s*|\s+/u)
    .filter(Boolean)
    .map((value) => {
      const sign = value.startsWith("-") ? -1 : 1;
      const normalized = value.replace(/^[-+]/u, "");
      return sign * (normalized.toLowerCase().startsWith("0x") ? Number.parseInt(normalized.slice(2), 16) : Number.parseInt(normalized, 10));
    })
    .filter((value) => Number.isFinite(value));
}

function colorFromParams(params: number[], info: ColorParamInfo): string {
  if (params.length === 5 && info.red === 4) return rgb5ToHex(params[4] & 0x1f, (params[4] >>> 5) & 0x1f, (params[4] >>> 10) & 0x1f);
  return rgb5ToHex(params[info.red] ?? 31, params[info.green] ?? 31, params[info.blue] ?? 31);
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
    out.set(doc.name.toLowerCase(), info);
    out.set(doc.currentPokewebName.toLowerCase(), info);
  }
  return out;
}
