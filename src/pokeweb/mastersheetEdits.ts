import { parseMastersheetBlockList, type MastersheetSourceRange } from "./mastersheetModel";

/**
 * Edits to a mastersheet's source, for the viewer's editor. The source stays the master copy: every change here
 * rewrites the lines of one block, page or split and leaves the rest of the text exactly as the author wrote it.
 *
 * Lines are 0-based and ranges end before `end`, as `MsBlock.src`, `MsPage.src` and `MsSplit.src` give them. Each
 * operation returns the new source and where the changed block now sits, so the editor can keep it selected.
 */

export type SourceRange = MastersheetSourceRange;
export type SourceChange = { source: string; range: SourceRange };

/** A block as its form edits it. Text, lists and headings keep their own markup (links as `[text](url)`). */
export type BlockDraft =
  | { kind: "text"; text: string }
  | { kind: "heading"; level: 3 | 4; text: string }
  | { kind: "list"; items: string[] }
  /** `ref` is the trainer as written: an ID, or a name reference (`Cheren/Snivy/15`) kept until another is picked. */
  | { kind: "trainer"; ref: string; mandatory: boolean; notes: string }
  | { kind: "encounter"; ref: string }
  | { kind: "items"; title: string; description: string; entries: ListEntry[] }
  | { kind: "gifts"; title: string; description: string; entries: ListEntry[] }
  /** `frame` is "" when the line doesn't name one (a signpost). */
  | { kind: "notice"; title: string; text: string; color: string; frame: "" | "sign" | "system" };

export type BlockKind = BlockDraft["kind"];
export type ListEntry = { name: string; note: string };

export function sourceLines(source: string): string[] {
  return source.replace(/\r\n?/gu, "\n").split("\n");
}

function joinLines(lines: string[]): string {
  return lines.join("\n");
}

const isBlank = (line: string | undefined) => line === undefined || line.trim() === "";

/** A notice colour as the sheet reads one: #rgb, #rrggbb or a colour's name. */
export const NOTICE_COLOUR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]+)$/iu;

// ---------- Printing and reading blocks ----------

export function printBlock(draft: BlockDraft): string[] {
  switch (draft.kind) {
    case "text":
      return oneLineEach(draft.text);
    case "heading":
      return [`${draft.level === 3 ? "###" : "####"} ${singleLine(draft.text)}`];
    case "list":
      return draft.items.map((item) => singleLine(item)).filter(Boolean).map((item) => `- ${item}`);
    case "trainer": {
      const notes = singleLine(draft.notes);
      return [`${draft.mandatory ? "!trm" : "!tr"} ${draft.ref.trim() || "0"}${notes ? ` ${notes}` : ""}`];
    }
    case "encounter":
      return [`!enc ${draft.ref.trim() || "0"}`];
    case "items":
    case "gifts": {
      const title = singleLine(draft.title);
      const lines = [`${draft.kind === "items" ? "!items" : "!gifts"}${title ? ` ${title}` : ""}`];
      const description = singleLine(draft.description);
      if (description) lines.push(`desc: ${description}`);
      for (const entry of draft.entries) {
        // A name can't hold a comma: the first comma starts the note.
        const name = singleLine(entry.name).replace(/,/gu, " ").trim();
        if (!name) continue;
        const note = singleLine(entry.note);
        lines.push(note ? `${name}, ${note}` : name);
      }
      lines.push("end");
      return lines;
    }
    case "notice": {
      const parts = [singleLine(draft.title), singleLine(draft.text)];
      // Only a colour the sheet can read is written; anything else would read back as part of the text.
      const color = draft.color.trim();
      return [`!notif ${parts.join(", ")}${NOTICE_COLOUR.test(color) ? `, ${color}` : ""}${draft.frame ? `, frame=${draft.frame}` : ""}`];
    }
  }
}

/** What a block's form starts from: its source lines read back. */
export function readBlock(lines: string[]): BlockDraft | undefined {
  const first = (lines[0] ?? "").trim();
  if (/^!trm?(\s|$)/u.test(first)) {
    const [command = "", ref = "", ...notes] = first.split(/\s+/u);
    return { kind: "trainer", ref, mandatory: command === "!trm", notes: notes.join(" ") };
  }
  if (/^!enc(\s|$)/u.test(first)) return { kind: "encounter", ref: first.slice(4).trim() };
  if (first.startsWith("!items") || first.startsWith("!gifts")) {
    const kind = first.startsWith("!items") ? "items" : "gifts";
    const list = parseMastersheetBlockList(lines, 1);
    return {
      kind,
      title: first.slice(6).trim(),
      description: list.description,
      entries: list.names.map((name, index) => ({ name, note: list.descriptions[index] ?? "" })),
    };
  }
  if (first.startsWith("!notif")) {
    // Title up to the first comma, then `frame=` and the colour from the end (when they are there), the text in
    // between exactly as written.
    let payload = first.slice(6).trim();
    let frame: "" | "sign" | "system" = "";
    const option = /,\s*frame\s*=\s*(sign|system)\s*$/iu.exec(payload);
    if (option) {
      frame = option[1]!.toLowerCase() as "sign" | "system";
      payload = payload.slice(0, option.index);
    }
    const firstComma = payload.indexOf(",");
    if (firstComma < 0) return { kind: "notice", title: payload, text: "", color: "", frame };
    const lastComma = payload.lastIndexOf(",");
    const last = payload.slice(lastComma + 1).trim();
    const hasColor = lastComma > firstComma && NOTICE_COLOUR.test(last);
    return {
      kind: "notice",
      title: payload.slice(0, firstComma).trim(),
      text: payload.slice(firstComma + 1, hasColor ? lastComma : undefined).trim(),
      color: hasColor ? last : "",
      frame,
    };
  }
  if (/^#### /u.test(first)) return { kind: "heading", level: 4, text: first.slice(5) };
  if (/^### /u.test(first)) return { kind: "heading", level: 3, text: first.slice(4) };
  if (/^[-*] /u.test(first)) return { kind: "list", items: lines.filter((line) => /^\s*[-*] /u.test(line)).map((line) => line.trim().slice(2)) };
  if (first.startsWith("#") || /^!(zones|skip|tr|trm|enc|items|gifts|notif)(\s|$)/u.test(first) || first.toLowerCase() === "<br>") return undefined;
  return { kind: "text", text: lines.join("\n") };
}

/** A new, empty block of a kind, as the Add menu inserts it. */
export function emptyBlock(kind: BlockKind): BlockDraft {
  switch (kind) {
    case "text":
      return { kind, text: "New text" };
    case "heading":
      return { kind, level: 3, text: "New section" };
    case "list":
      return { kind, items: ["New item"] };
    case "trainer":
      return { kind, ref: "0", mandatory: false, notes: "" };
    case "encounter":
      return { kind, ref: "0" };
    case "items":
      return { kind, title: "Items", description: "", entries: [] };
    case "gifts":
      return { kind, title: "Gift Pokémon", description: "", entries: [] };
    case "notice":
      return { kind, title: "Note", text: "", color: "", frame: "" };
  }
}

function singleLine(text: string): string {
  return text.replace(/\s*\n\s*/gu, " ").trim();
}

function oneLineEach(text: string): string[] {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n").map((line) => line.trimEnd());
  while (lines.length > 1 && !lines.at(-1)) lines.pop();
  return lines.length ? lines : [""];
}

// ---------- Line operations ----------

export function replaceRange(source: string, range: SourceRange, lines: string[]): SourceChange {
  const all = sourceLines(source);
  all.splice(range.start, range.end - range.start, ...lines);
  return { source: joinLines(all), range: { start: range.start, end: range.start + lines.length } };
}

/**
 * Inserts lines before `at` (0 to the line count), with a blank line on each side where its neighbours have text,
 * so the new block stays its own paragraph and doesn't join a list next to it.
 */
export function insertBlockLines(source: string, at: number, lines: string[]): SourceChange {
  const all = sourceLines(source);
  const position = Math.max(0, Math.min(at, all.length));
  const before = isBlank(all[position - 1]) || position === 0 ? [] : [""];
  const after = isBlank(all[position]) ? [] : [""];
  all.splice(position, 0, ...before, ...lines, ...after);
  const start = position + before.length;
  return { source: joinLines(all), range: { start, end: start + lines.length } };
}

/** Removes a block's lines. A blank line left on both sides of the gap closes up to one. */
export function removeRange(source: string, range: SourceRange): SourceChange {
  const all = sourceLines(source);
  all.splice(range.start, range.end - range.start);
  const previous = all[range.start - 1];
  const next = all[range.start];
  // Two blank lines meet: keep one. A heading and a blank line meet: the next block moves up under the heading.
  const closeUp = range.start < all.length && isBlank(next) && (range.start === 0 || isBlank(previous) || previous!.trimStart().startsWith("#"));
  if (closeUp) all.splice(range.start, 1);
  return { source: joinLines(all), range: { start: range.start, end: range.start } };
}

/**
 * Swaps two blocks that don't overlap, keeping whatever lies between them (blank lines, a `<br>`) where it was.
 * Returns where `a` now sits.
 */
export function swapRanges(source: string, a: SourceRange, b: SourceRange): SourceChange {
  const [first, second] = a.start < b.start ? [a, b] : [b, a];
  const all = sourceLines(source);
  const firstLines = all.slice(first.start, first.end);
  const between = all.slice(first.end, second.start);
  const secondLines = all.slice(second.start, second.end);
  const rebuilt = [...all.slice(0, first.start), ...secondLines, ...between, ...firstLines, ...all.slice(second.end)];
  const movedFirstStart = first.start + secondLines.length + between.length;
  const aRange = a === first
    ? { start: movedFirstStart, end: movedFirstStart + firstLines.length }
    : { start: first.start, end: first.start + secondLines.length };
  return { source: joinLines(rebuilt), range: aRange };
}

/** Moves a range so it starts where line `to` (in the current source, outside the range) starts now. */
export function moveRange(source: string, range: SourceRange, to: number, padBlank = true): SourceChange {
  if (to >= range.start && to <= range.end) return { source, range };
  const all = sourceLines(source);
  const moving = all.slice(range.start, range.end);
  const removed = removeRange(source, range);
  const removedCount = sourceLines(source).length - sourceLines(removed.source).length;
  const target = to > range.start ? to - removedCount : to;
  if (!padBlank) {
    const rest = sourceLines(removed.source);
    rest.splice(target, 0, ...moving);
    return { source: joinLines(rest), range: { start: target, end: target + moving.length } };
  }
  return insertBlockLines(removed.source, target, moving);
}

export function duplicateRange(source: string, range: SourceRange): SourceChange {
  const lines = sourceLines(source).slice(range.start, range.end);
  return insertBlockLines(source, range.end, lines);
}

// ---------- Pages and splits ----------

/** "Cheren Split" and "Level Cap 15" → "# Cheren Split (Level Cap 15)". */
export function splitHeading(name: string, detail: string): string {
  const title = singleLine(name) || "New split";
  const extra = singleLine(detail);
  return `# ${title}${extra ? ` (${extra})` : ""}`;
}

export function areaHeading(name: string): string {
  return `## ${singleLine(name) || "New area"}`;
}

/** Renames the page or split whose heading is on `line`, keeping its level. */
export function replaceHeading(source: string, line: number, heading: string): SourceChange {
  return replaceRange(source, { start: line, end: line + 1 }, [heading]);
}

/**
 * Adds a heading (a new area or split) before line `at`, separated from what comes before by a blank line.
 * Returns the heading's line.
 */
export function insertHeading(source: string, at: number, heading: string): SourceChange {
  const all = sourceLines(source);
  const position = Math.max(0, Math.min(at, all.length));
  // Trailing blank lines at the very end stay after the new section.
  const before = position === 0 || isBlank(all[position - 1]) ? [] : [""];
  const after = position < all.length && !isBlank(all[position]) ? [""] : [];
  all.splice(position, 0, ...before, heading, ...after);
  const start = position + before.length;
  return { source: joinLines(all), range: { start, end: start + 1 } };
}

/** Sets a page's `!zones` line: replaced where it is, added under the heading, or removed when there are none. */
export function setPageZones(source: string, page: { headingLine?: number; zonesLine?: number }, zones: number[]): SourceChange {
  const line = zones.length ? `!zones ${zones.join(", ")}` : undefined;
  if (page.zonesLine !== undefined) {
    if (!line) return removeRange(source, { start: page.zonesLine, end: page.zonesLine + 1 });
    return replaceRange(source, { start: page.zonesLine, end: page.zonesLine + 1 }, [line]);
  }
  if (!line) return { source, range: { start: page.headingLine ?? 0, end: page.headingLine ?? 0 } };
  const at = (page.headingLine ?? -1) + 1;
  const all = sourceLines(source);
  all.splice(at, 0, line);
  return { source: joinLines(all), range: { start: at, end: at + 1 } };
}

/**
 * Sets a page's `!skip` line (Fill suggestions marked not needed): replaced where it is, added under the heading and
 * its `!zones` line, or removed when there are none. Keys are "tr 180", "enc 44", "item 417".
 */
export function setPageSkips(source: string, page: { headingLine?: number; zonesLine?: number; skipLine?: number }, keys: string[]): SourceChange {
  const line = keys.length ? `!skip ${[...new Set(keys)].join(", ")}` : undefined;
  if (page.skipLine !== undefined) {
    if (!line) return removeRange(source, { start: page.skipLine, end: page.skipLine + 1 });
    return replaceRange(source, { start: page.skipLine, end: page.skipLine + 1 }, [line]);
  }
  const at = (page.zonesLine ?? page.headingLine ?? -1) + 1;
  if (!line) return { source, range: { start: at, end: at } };
  const all = sourceLines(source);
  all.splice(at, 0, line);
  return { source: joinLines(all), range: { start: at, end: at + 1 } };
}

/**
 * Moves a whole page or split (`range`) so it starts at line `to`. Pages carry their trailing blank lines with them;
 * a page moved to the end of the sheet gets a blank line in front.
 */
export function moveSection(source: string, range: SourceRange, to: number): SourceChange {
  if (to >= range.start && to <= range.end) return { source, range };
  const all = sourceLines(source);
  let moving = all.slice(range.start, range.end);
  // Keep a section's own trailing blank line so sections stay apart wherever they go.
  if (!moving.length || !isBlank(moving.at(-1))) moving = [...moving, ""];
  const rest = [...all.slice(0, range.start), ...all.slice(range.end)];
  const target = to > range.start ? to - (range.end - range.start) : to;
  let prefix = 0;
  if (target > 0 && !isBlank(rest[target - 1])) {
    moving = ["", ...moving];
    prefix = 1;
  }
  rest.splice(target, 0, ...moving);
  const start = target + prefix;
  return { source: joinLines(rest), range: { start, end: start + (range.end - range.start) } };
}

/** The lines in a range. */
export function linesOf(source: string, range: SourceRange): string[] {
  return sourceLines(source).slice(range.start, range.end);
}
