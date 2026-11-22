import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { Annotation, EditorSelection, EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, ViewPlugin, drawSelection, gutter, highlightActiveLine, keymap, lineNumbers, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SourceRange } from "../../pokeweb/mastersheetEdits";
import type { MastersheetWarning } from "../../pokeweb/mastersheetModel";

/**
 * The template beside the sheet: the source itself, in CodeMirror. Typing here rebuilds the sheet (after a pause);
 * moving the cursor outlines the block it is in. Undo and Redo are the editor's, shared with the forms.
 */

export type TemplateCompletion = { label: string; apply: string; detail?: string };

export type TemplateOptions = {
  source: string;
  onChange(source: string): void;
  onCursor(line: number): void;
  undo(): void;
  redo(): void;
  complete: {
    trainers(query: string): TemplateCompletion[] | undefined;
    tables(query: string): TemplateCompletion[] | undefined;
    zones(query: string): TemplateCompletion[] | undefined;
    items(query: string): TemplateCompletion[];
    species(query: string): TemplateCompletion[];
    colours(): string[];
  };
};

export type TemplatePane = {
  element: HTMLElement;
  /** The source changed elsewhere (a form, Undo): show it, keeping the cursor where it was. */
  sync(source: string): void;
  reveal(range: SourceRange, select?: boolean): void;
  setProblems(warnings: MastersheetWarning[]): void;
  focus(): void;
  destroy(): void;
};

const fromSession = Annotation.define<boolean>();
const setProblemsEffect = StateEffect.define<Map<number, string>>();
const setSelectedEffect = StateEffect.define<SourceRange | undefined>();
const CHANGE_DELAY_MS = 350;

/** Problems by line number (1-based, as the parser reports them). */
const problemsField = StateField.define<Map<number, string>>({
  create: () => new Map(),
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setProblemsEffect)) return effect.value;
    return value;
  },
});

/** The block selected in the sheet, shown as a band of lines. */
const selectedField = StateField.define<SourceRange | undefined>({
  create: () => undefined,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setSelectedEffect)) return effect.value;
    return transaction.docChanged ? undefined : value;
  },
});

class ProblemMarker extends GutterMarker {
  constructor(readonly message: string) {
    super();
  }

  override toDOM(): Node {
    const marker = document.createElement("span");
    marker.className = "mse-cm-problem";
    marker.title = this.message;
    marker.textContent = "!";
    return marker;
  }
}

const problemGutter = gutter({
  class: "mse-cm-problems",
  lineMarker(view, line) {
    const number = view.state.doc.lineAt(line.from).number;
    const message = view.state.field(problemsField).get(number);
    return message ? new ProblemMarker(message) : null;
  },
  lineMarkerChange: (update) => update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(setProblemsEffect))),
});

const LINE_KINDS: Array<[RegExp, string]> = [
  [/^#(?!#)/u, "h1"],
  [/^##(?!#)/u, "h2"],
  [/^###/u, "h3"],
  [/^!trm?(\s|$)/u, "tr"],
  [/^!enc(\s|$)/u, "enc"],
  [/^!(items|gifts)(\s|$)/u, "list"],
  [/^!notif(\s|$)/u, "notif"],
  [/^!(zones|skip)(\s|$)/u, "zones"],
  [/^end\s*$/iu, "end"],
  [/^(desc|description)\s*:/iu, "desc"],
  [/^[-*] /u, "li"],
];

/** Colours by line: headings, directives and their first value, list rows inside `!items`/`!gifts`. */
const highlighter = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.build(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(setProblemsEffect) || effect.is(setSelectedEffect)))) {
      this.decorations = this.build(update.view);
    }
  }

  build(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const { doc } = view.state;
    const problems = view.state.field(problemsField);
    const selected = view.state.field(selectedField);
    for (const { from, to } of view.visibleRanges) {
      let line = doc.lineAt(from);
      // Whether the first visible line sits inside an item or Pokémon list: look back for its opening line.
      let inList = listOpenAt(doc, line.number);
      for (;;) {
        const text = line.text;
        const kind = LINE_KINDS.find(([pattern]) => pattern.test(text))?.[1];
        const classes = [kind ? `mse-cm-${kind}` : inList && text.trim() ? "mse-cm-row" : ""];
        if (problems.has(line.number)) classes.push("mse-cm-has-problem");
        if (selected && line.number - 1 >= selected.start && line.number - 1 < selected.end) classes.push("mse-cm-selected");
        const lineClass = classes.filter(Boolean).join(" ");
        if (lineClass) builder.add(line.from, line.from, Decoration.line({ class: lineClass }));
        const directive = /^(![a-z]+)(\s+\S+)?/u.exec(text);
        if (directive && kind && kind !== "h1" && kind !== "h2" && kind !== "h3") {
          builder.add(line.from, line.from + directive[1]!.length, Decoration.mark({ class: "mse-cm-directive" }));
          if (directive[2] && (kind === "tr" || kind === "enc" || kind === "zones")) builder.add(line.from + directive[1]!.length, line.from + directive[0].length, Decoration.mark({ class: "mse-cm-ref" }));
        } else if (inList && !kind && text.includes(",")) {
          builder.add(line.from, line.from + text.indexOf(","), Decoration.mark({ class: "mse-cm-ref" }));
        } else if (inList && !kind && text.trim()) {
          builder.add(line.from, line.to, Decoration.mark({ class: "mse-cm-ref" }));
        }
        if (kind === "list") inList = true;
        if (kind === "end" || kind === "h1" || kind === "h2") inList = false;
        if (line.to >= to || line.number >= doc.lines) break;
        line = doc.line(line.number + 1);
      }
    }
    return builder.finish();
  }
}, { decorations: (plugin) => plugin.decorations });

function listOpenAt(doc: EditorState["doc"], lineNumber: number): boolean {
  for (let number = lineNumber - 1; number >= 1 && number > lineNumber - 200; number -= 1) {
    const text = doc.line(number).text.trim();
    if (/^end$/iu.test(text) || text.startsWith("#")) return false;
    if (/^!(items|gifts)(\s|$)/u.test(text)) return true;
  }
  return false;
}

export function createTemplatePane(host: HTMLElement, options: TemplateOptions): TemplatePane {
  const element = document.createElement("aside");
  element.className = "mse-code";
  element.setAttribute("aria-label", "Template");
  element.innerHTML = `<div class="mse-code__head"><span>Template</span><span class="mse-code__where"></span></div><div class="mse-code__editor"></div>`;
  host.append(element);
  const where = element.querySelector<HTMLElement>(".mse-code__where")!;
  let changeTimer = 0;
  let cursorTimer = 0;

  const completionSource = (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    // The first value after !tr, !trm and !enc (notes after a trainer are free text); any value after !zones.
    const reference = /^(!trm?|!enc)\s+(\S*)$/u.exec(before) ?? /^(!zones)\s+(?:[\d,\s]*[\s,])?(\S*)$/u.exec(before);
    if (reference) {
      const query = reference[2]!;
      const from = context.pos - query.length;
      const list = reference[1] === "!enc" ? options.complete.tables(query) : reference[1] === "!zones" ? options.complete.zones(query) : options.complete.trainers(query);
      if (!list) return { from, options: [{ label: "Reading the ROM…", apply: query }], filter: false };
      return { from, options: list.slice(0, 40).map(toCompletion), filter: false };
    }
    if (/^!notif\s.*,\s*#?[0-9a-f]*$/iu.test(before) && (before.match(/,/gu)?.length ?? 0) >= 2) {
      const query = /#?[0-9a-f]*$/iu.exec(before)![0];
      return { from: context.pos - query.length, options: options.complete.colours().map((colour) => ({ label: colour, type: "constant" })) };
    }
    if (/^![a-z]*$/u.test(before)) {
      return {
        from: line.from,
        options: [
          ["!tr ", "Trainer"], ["!trm ", "Mandatory trainer"], ["!enc ", "Wild Pokémon"], ["!items ", "Item list"], ["!gifts ", "Pokémon list"],
          ["!notif ", "Notice: title, text, #colour, frame=system (a signpost without it)"], ["!zones ", "Zones this page covers"], ["!skip ", "Fill suggestions not needed here"],
        ].map(([label, detail]) => ({ label: label!.trim(), apply: label!, detail })),
      };
    }
    if (!before.includes(",") && !before.startsWith("!") && !before.startsWith("#") && listOpenAt(context.state.doc, line.number)) {
      const opener = findListOpener(context.state.doc, line.number);
      const query = before.trim();
      if (!query && !context.explicit) return null;
      const list = opener === "gifts" ? options.complete.species(query) : options.complete.items(query);
      return { from: line.from + before.length - before.trimStart().length, options: list.slice(0, 40).map(toCompletion), filter: false };
    }
    return null;
  };

  const view = new EditorView({
    parent: element.querySelector<HTMLElement>(".mse-code__editor")!,
    state: EditorState.create({
      doc: options.source,
      extensions: [
        lineNumbers(),
        problemGutter,
        problemsField,
        selectedField,
        drawSelection(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        highlighter,
        autocompletion({ override: [completionSource], activateOnTyping: true, icons: false }),
        keymap.of([
          { key: "Mod-z", run: () => (options.undo(), true), preventDefault: true },
          { key: "Mod-Shift-z", run: () => (options.redo(), true), preventDefault: true },
          { key: "Mod-y", run: () => (options.redo(), true), preventDefault: true },
          indentWithTab,
          ...defaultKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(fromSession))) {
            window.clearTimeout(changeTimer);
            changeTimer = window.setTimeout(() => options.onChange(view.state.doc.toString()), CHANGE_DELAY_MS);
          }
          if (update.selectionSet || update.docChanged) {
            const line = update.state.doc.lineAt(update.state.selection.main.head).number - 1;
            where.textContent = `Line ${line + 1} of ${update.state.doc.lines.toLocaleString()}`;
            if (update.selectionSet && !update.transactions.some((transaction) => transaction.annotation(fromSession))) {
              window.clearTimeout(cursorTimer);
              cursorTimer = window.setTimeout(() => options.onCursor(line), 120);
            }
          }
        }),
      ],
    }),
  });
  where.textContent = `${view.state.doc.lines.toLocaleString()} lines`;

  return {
    element,
    sync(source) {
      const current = view.state.doc.toString();
      if (source === current) return;
      window.clearTimeout(changeTimer);
      // The smallest change between the two, so the cursor and scroll stay put.
      let start = 0;
      while (start < current.length && start < source.length && current[start] === source[start]) start += 1;
      let endCurrent = current.length;
      let endSource = source.length;
      while (endCurrent > start && endSource > start && current[endCurrent - 1] === source[endSource - 1]) {
        endCurrent -= 1;
        endSource -= 1;
      }
      view.dispatch({ changes: { from: start, to: endCurrent, insert: source.slice(start, endSource) }, annotations: fromSession.of(true) });
    },
    reveal(range, select = true) {
      const doc = view.state.doc;
      const first = doc.line(Math.min(range.start + 1, doc.lines));
      view.dispatch({
        selection: select ? EditorSelection.cursor(first.from) : undefined,
        effects: [setSelectedEffect.of(range), EditorView.scrollIntoView(first.from, { y: "center" })],
        annotations: fromSession.of(true),
      });
    },
    setProblems(warnings) {
      view.dispatch({ effects: setProblemsEffect.of(new Map(warnings.map((warning) => [warning.line, warning.message]))) });
    },
    focus() {
      view.focus();
    },
    destroy() {
      window.clearTimeout(changeTimer);
      window.clearTimeout(cursorTimer);
      view.destroy();
      element.remove();
    },
  };
}

function toCompletion(option: TemplateCompletion): Completion {
  return { label: option.label, apply: option.apply, detail: option.detail };
}

function findListOpener(doc: EditorState["doc"], lineNumber: number): "items" | "gifts" | undefined {
  for (let number = lineNumber - 1; number >= 1 && number > lineNumber - 200; number -= 1) {
    const text = doc.line(number).text.trim();
    if (text.startsWith("!items")) return "items";
    if (text.startsWith("!gifts")) return "gifts";
    if (/^end$/iu.test(text)) return undefined;
  }
  return undefined;
}
