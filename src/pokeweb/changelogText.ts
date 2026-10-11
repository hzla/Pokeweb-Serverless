import { teamFields, type ChangelogDocument, type DocumentComparison } from "./changelogDocument";

const MAX_CELL_WIDTH = 38;
const TABLE_GAP = "    ";
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Plain text uses the same grouped records as the preview and PDF. */
export function renderChangelogText(documents: ChangelogDocument[]): string {
  return documents.map((document) => {
    const title = `${document.title} changelog`;
    const lines = [title, "=".repeat(textWidth(title)),
      `NARCs: ${document.narcs.join(" + ")}`, `Game: ${document.version}`,
      `Changes: ${document.changes}`, `Original ROM: ${plain(document.original)}`, `Modified ROM: ${plain(document.modified)}`, ""];
    if (!document.subjects.length) lines.push(document.emptyMessage);
    for (const subject of document.subjects) {
      lines.push(subject.title, "-".repeat(textWidth(subject.title)));
      if (subject.pokemon.length) lines.push(`Team: ${subject.pokemon.map((pokemon) => pokemon.name).join(", ")}`, "");
      if (subject.fields.length) lines.push(...table(["Field", "Original", "Updated"], subject.fields.map((field) => [field.label, field.before, updatedValue(field.before, field.after)])), "");
      if (subject.notes.length) lines.push(...subject.notes.map((note) => `- ${plain(note)}`), "");
      for (const comparison of subject.comparisons) {
        lines.push(comparison.title.replace(/ · /gu, " / "));
        if (comparison.layout === "fields") {
          lines.push(...table(["Slot", "Field", "Original", "Updated"], teamFields(comparison).map((field) => [String(field.slot), field.label, field.before, updatedValue(field.before, field.after)])));
        } else lines.push(...pairedTables(comparison));
        lines.push("");
      }
      lines.push("");
    }
    return lines.join("\n").trimEnd();
  }).join(`\n\n${"=".repeat(80)}\n\n`) + "\n";
}

function table(columns: string[], rows: string[][]): string[] {
  const widths = columnWidths(columns, rows);
  const border = tableBorder(widths);
  return [border, ...tableRow(columns, widths), border,
    ...rows.flatMap((row) => [...tableRow(row, widths), border])];
}

function pairedTables(comparison: DocumentComparison): string[] {
  const { columns, before, after, rate } = comparison;
  const updatedRows = after.map((row, index) => row.map((value, column) => updatedValue(before[index]?.[column], value)));
  const widths = columnWidths(columns, [...before, ...updatedRows, ["None"], ["NONE"]]);
  const border = tableBorder(widths);
  const pair = (left: string, right: string) => `${pad(left, border.length)}${TABLE_GAP}${right}`;
  const lines = [pair("Original", "Updated")];
  if (rate) lines.push(pair(`Encounter rate: ${rate.before}`, `Encounter rate: ${updatedValue(rate.before, rate.after)}`));
  lines.push(pair(border, border));
  const header = tableRow(columns, widths);
  lines.push(...header.map((line) => pair(line, line)), pair(border, border));
  for (let index = 0; index < Math.max(before.length, after.length, 1); index++) {
    const original = wrapRow(before[index] ?? ["None"], widths);
    const updated = wrapRow(updatedRows[index] ?? [before[index] ? "NONE" : "None"], widths);
    const height = Math.max(...original.map((cell) => cell.length), ...updated.map((cell) => cell.length));
    for (let line = 0; line < height; line++) lines.push(pair(rowLine(original, widths, line), rowLine(updated, widths, line)));
    lines.push(pair(border, border));
  }
  return lines;
}

function updatedValue(before: string | undefined, after: string): string {
  return before === after ? after : after.toUpperCase();
}

function columnWidths(columns: string[], rows: string[][]): number[] {
  return columns.map((column, index) => Math.min(MAX_CELL_WIDTH,
    Math.max(textWidth(column), ...rows.map((row) => Math.max(...plain(row[index] ?? "").split("\n").map(textWidth))))));
}

function tableBorder(widths: number[]): string {
  return `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`;
}

function tableRow(row: string[], widths: number[]): string[] {
  const cells = wrapRow(row, widths);
  return Array.from({ length: Math.max(...cells.map((cell) => cell.length)) }, (_, line) => rowLine(cells, widths, line));
}

function wrapRow(row: string[], widths: number[]): string[][] {
  return widths.map((width, index) => wrap(row[index] ?? "", width));
}

function rowLine(cells: string[][], widths: number[], line: number): string {
  return `| ${cells.map((cell, index) => pad(cell[line] ?? "", widths[index])).join(" | ")} |`;
}

function wrap(value: string, width: number): string[] {
  return plain(value).split("\n").flatMap((paragraph) => {
    const remaining = [...graphemes.segment(paragraph)].map(({ segment }) => segment);
    const lines: string[] = [];
    while (remaining.length) {
      let length = 0;
      let end = 0;
      while (end < remaining.length && length + textWidth(remaining[end]) <= width) length += textWidth(remaining[end++]);
      end = Math.max(1, end);
      if (end < remaining.length) {
        const space = remaining.slice(0, end + 1).lastIndexOf(" ");
        if (space > 0) end = space;
      }
      lines.push(remaining.splice(0, end).join("").trimEnd());
      while (remaining[0] === " ") remaining.shift();
    }
    return lines.length ? lines : [""];
  });
}

function pad(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - textWidth(value)));
}

function plain(value: string): string {
  return value.replace(/\r\n?/gu, "\n").replace(/\t/gu, "    ").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/gu, "");
}

// Keep accented names, gender symbols, and wide ROM text aligned in monospace.
function textWidth(value: string): number {
  let width = 0;
  for (const { segment } of graphemes.segment(value)) {
    if (/^[\p{Mark}\u200d\ufe0f]+$/u.test(segment)) continue;
    const code = segment.codePointAt(0)!;
    const emoji = /\p{Extended_Pictographic}/u.test(segment) && (code >= 0x1f000 || segment.includes("\ufe0f"));
    width += emoji || code >= 0x1100 && (
      code <= 0x115f || code === 0x2329 || code === 0x232a || code >= 0x2e80 && code <= 0xa4cf ||
      code >= 0xac00 && code <= 0xd7a3 || code >= 0xf900 && code <= 0xfaff || code >= 0xfe10 && code <= 0xfe19 ||
      code >= 0xfe30 && code <= 0xfe6f || code >= 0xff01 && code <= 0xff60 || code >= 0xffe0 && code <= 0xffe6 || code >= 0x20000
    ) ? 2 : 1;
  }
  return width;
}
