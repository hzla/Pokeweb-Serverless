import { jsPDF } from "jspdf";
import { autoTable, type CellInput, type RowInput, type UserOptions } from "jspdf-autotable";
import { teamFields, type ChangelogDocument, type ChangelogField, type DocumentComparison } from "./changelogDocument";
import type { ChangelogIcon } from "./changelogIcons";
import { changelogIconPng } from "./changelogIconPng";

export type ChangelogPdfFonts = { regular: string; bold: string };
const PURPLE: [number, number, number] = [73, 61, 111];
const GREEN: [number, number, number] = [224, 245, 229];
const INK: [number, number, number] = [38, 42, 54];

export function buildChangelogPdf(documents: ChangelogDocument[], fonts?: ChangelogPdfFonts): jsPDF {
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const font = fonts ? "ChangelogSans" : "helvetica";
  if (fonts) {
    pdf.addFileToVFS("ChangelogSans-Regular.ttf", fonts.regular);
    pdf.addFont("ChangelogSans-Regular.ttf", font, "normal");
    pdf.addFileToVFS("ChangelogSans-Bold.ttf", fonts.bold);
    pdf.addFont("ChangelogSans-Bold.ttf", font, "bold");
  }
  pdf.setProperties({ title: documents.length === 1 ? `${documents[0].title} changelog` : "ROM changelog", creator: "Pokeweb", subject: "Original and modified ROM comparison" });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = width - margin * 2;
  const pageTitles = new Map<number, string>();
  const iconPngs = new Map<string, Uint8Array>();
  let section = "Changelog";
  let subjectTitle = "";
  let y = 24;
  const pageNumber = () => pdf.getCurrentPageInfo().pageNumber;
  const addPage = () => { pdf.addPage(); y = 24; pageTitles.set(pageNumber(), section); };
  const ensureSpace = (space: number) => { if (y + space > height - 15) addPage(); };
  const text = (value: string, size = 10, bold = false, indent = 0) => {
    pdf.setFont(font, bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...INK);
    const lines: string[] = pdf.splitTextToSize(value, contentWidth - indent);
    for (const line of lines) {
      ensureSpace(size * 0.45 + 2);
      pdf.text(line, margin + indent, y);
      y += size * 0.45;
    }
    y += 2;
  };
  const drawIcon = (icon: ChangelogIcon, x: number, top: number, size = 8) => {
    let png = iconPngs.get(icon.key);
    if (!png) { png = changelogIconPng(icon); iconPngs.set(icon.key, png); }
    pdf.addImage(png, "PNG", x, top, size, size, icon.key, "FAST");
  };
  const table = (options: UserOptions, icons = new Map<string, ChangelogIcon>()) => {
    autoTable(pdf, {
      theme: "grid", startY: y, margin: { top: 22, bottom: 15, left: margin, right: margin }, tableWidth: contentWidth,
      rowPageBreak: "avoid", showHead: "everyPage",
      styles: { font, fontSize: 9, cellPadding: 2, textColor: INK, lineColor: [207, 211, 220], lineWidth: 0.15, valign: "middle", overflow: "linebreak" },
      headStyles: { fillColor: PURPLE, textColor: [255, 255, 255], fontStyle: "bold" },
      ...options,
      didDrawPage: () => { pageTitles.set(pageNumber(), `${section}${subjectTitle ? ` / ${subjectTitle}` : ""}`); },
      didDrawCell: (data) => {
        if (data.section !== "body") return;
        const icon = icons.get(`${data.row.index}:${data.column.index}`);
        if (icon) drawIcon(icon, data.cell.x + 1.5, data.cell.y + (data.cell.height - 8) / 2);
      },
    });
    const last = (pdf as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable;
    y = (last?.finalY ?? y) + 6;
  };
  function cell(value: string, changed = false, icon?: ChangelogIcon): CellInput {
    return { content: value, styles: {
      fillColor: changed ? GREEN : [255, 255, 255], fontStyle: changed ? "bold" : "normal",
      ...(icon ? { cellPadding: { top: 2, right: 2, bottom: 2, left: 11 }, minCellHeight: 10 } : {}),
    } };
  }
  const fieldsTable = (fields: Array<ChangelogField & { slot?: number }>, team = false) => {
    const icons = new Map<string, ChangelogIcon>();
    const beforeColumn = team ? 2 : 1;
    const afterColumn = beforeColumn + 1;
    const body: RowInput[] = fields.map((field, index) => {
      if (field.beforeIcon) icons.set(`${index}:${beforeColumn}`, field.beforeIcon);
      if (field.afterIcon) icons.set(`${index}:${afterColumn}`, field.afterIcon);
      return [
        ...(team ? [String(field.slot)] : []), field.label,
        cell(field.before, false, field.beforeIcon), cell(field.after, field.before !== field.after, field.afterIcon),
      ];
    });
    table({
      head: [team ? ["Slot", "Field", "Original", "Updated"] : ["Field", "Original", "Updated"]], body,
      columnStyles: team ? { 0: { cellWidth: 12 }, 1: { cellWidth: 43 }, 2: { cellWidth: (contentWidth - 55) / 2 }, 3: { cellWidth: (contentWidth - 55) / 2 } }
        : { 0: { cellWidth: 65 }, 1: { cellWidth: (contentWidth - 65) / 2 }, 2: { cellWidth: (contentWidth - 65) / 2 } },
    }, icons);
  };
  const pairedTable = (comparison: DocumentComparison) => {
    const count = comparison.columns.length;
    const gap = 4;
    const half = (contentWidth - gap) / 2;
    const columnStyles: NonNullable<UserOptions["columnStyles"]> = { [count]: { cellWidth: gap, fillColor: [255, 255, 255], lineWidth: 0 } };
    const sizes = count === 3 ? [12, 17, half - 29] : [10, half - 66, 12, 22, 22];
    for (let index = 0; index < count; index += 1) {
      columnStyles[index] = { cellWidth: sizes[index] ?? half / count };
      columnStyles[count + 1 + index] = { cellWidth: sizes[index] ?? half / count };
    }
    const icons = new Map<string, ChangelogIcon>();
    const body: RowInput[] = Array.from({ length: Math.max(comparison.before.length, comparison.after.length, 1) }, (_, row) => {
      const oldRow = comparison.before[row];
      const newRow = comparison.after[row];
      const changed = JSON.stringify(oldRow) !== JSON.stringify(newRow);
      return [
        ...comparison.columns.map((label, column) => {
          const icon = label === "Pokemon" ? comparison.beforeIcons[row] : undefined;
          if (icon) icons.set(`${row}:${column}`, icon);
          return cell(oldRow?.[column] ?? (column === 0 ? "None" : ""), false, icon);
        }), "",
        ...comparison.columns.map((label, column) => {
          const icon = label === "Pokemon" ? comparison.afterIcons[row] : undefined;
          if (icon) icons.set(`${row}:${count + 1 + column}`, icon);
          return cell(newRow?.[column] ?? (column === 0 ? "None" : ""), changed, icon);
        }),
      ];
    });
    const rate = comparison.rate;
    const beforeTitle = `Original${rate ? ` - encounter rate: ${rate.before}` : ""}`;
    const afterTitle = `Updated${rate ? ` - encounter rate: ${rate.after}` : ""}`;
    table({
      head: [[{ content: beforeTitle, colSpan: count }, "", { content: afterTitle, colSpan: count, styles: rate && rate.before !== rate.after ? { fillColor: GREEN, textColor: INK } : {} }], [...comparison.columns, "", ...comparison.columns]], body, columnStyles,
    }, icons);
  };
  for (const [index, document] of documents.entries()) {
    section = `${document.title} - ${document.narcs.join(" + ")}`;
    subjectTitle = "";
    if (index > 0) addPage();
    pageTitles.set(pageNumber(), section);
    pdf.outline.add(null, document.title, { pageNumber: pageNumber() });
    text(`${document.title} changelog`, 21, true);
    text(`${document.narcs.join(" + ")}  |  ${document.version}  |  ${document.changes} change${document.changes === 1 ? "" : "s"}`, 10);
    text(`Original: ${document.original}`, 9);
    text(`Modified: ${document.modified}`, 9);
    if (document.iconWarning) text(document.iconWarning, 9);
    y += 2;
    if (!document.subjects.length) text(document.emptyMessage);
    for (const subject of document.subjects) {
      subjectTitle = subject.title;
      ensureSpace(32);
      if (subject.icon) drawIcon(subject.icon, margin, y - 6);
      text(subject.title, 14, true, subject.icon ? 10 : 0);
      if (subject.pokemon.length) text("Team", 11, true);
      for (const pokemon of subject.pokemon) {
        ensureSpace(12);
        if (pokemon.icon) drawIcon(pokemon.icon, margin, y - 6);
        text(pokemon.name, 10, false, pokemon.icon ? 10 : 0);
        y += 2;
      }
      if (subject.fields.length) fieldsTable(subject.fields);
      for (const note of subject.notes) text(`• ${note}`, 10, false, 2);
      for (const comparison of subject.comparisons) {
        ensureSpace(30);
        text(comparison.title, 11, true);
        if (comparison.layout === "fields") fieldsTable(teamFields(comparison), true);
        else pairedTable(comparison);
      }
      y += 3;
    }
  }
  for (let page = 1; page <= pdf.getNumberOfPages(); page += 1) {
    pdf.setPage(page);
    pdf.setFont(font, "normal"); pdf.setFontSize(8); pdf.setTextColor(100, 105, 118);
    pdf.text("POKEWEB / ROM CHANGELOG", margin, 11);
    pdf.text(pageTitles.get(page) ?? section, width - margin, 11, { align: "right", maxWidth: contentWidth - 65 });
    pdf.setDrawColor(213, 215, 222); pdf.setLineWidth(0.2); pdf.line(margin, 15, width - margin, 15);
    pdf.text(`${page} / ${pdf.getNumberOfPages()}`, width - margin, height - 7, { align: "right" });
  }
  return pdf;
}
