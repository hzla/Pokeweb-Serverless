import type { jsPDF } from "jspdf";
import type { ChangelogDocument } from "./changelogDocument";

export type ChangelogPdfDestination = { pageNumber: number; top: number };
type ContentsEntry = {
  title: string;
  section: boolean;
  destination?: ChangelogPdfDestination;
  page: number;
  x: number;
  y: number;
  lines: string[];
  height: number;
};

/** Reserve contents pages before rendering records so all destinations stay final. */
export function prepareChangelogPdfNavigation(pdf: jsPDF, documents: ChangelogDocument[], font: string, margin: number) {
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const columnWidth = (width - margin * 2 - 12) / 2;
  const sections = documents.map((document) => ({
    heading: entry(document.title, true),
    subjects: document.subjects.map((subject) => entry(subject.title, false)),
  }));
  let page = 1;
  let column = 0;
  let y = 43;
  const advance = () => {
    if (column === 0) column = 1;
    else { column = 0; page++; pdf.addPage(); }
    y = 43;
  };
  for (const section of sections) {
    for (const [index, item] of [section.heading, ...section.subjects].entries()) {
      // Keep a section heading with its first record when a column fills up.
      const needed = item.height + (index === 0 ? section.subjects[0]?.height ?? 0 : 0);
      if (y + needed > height - 17) advance();
      item.page = page;
      item.x = margin + column * (columnWidth + 12);
      item.y = y;
      y += item.height;
    }
    y += 3;
  }
  const contentsPages = sections.length ? page : 0;
  if (contentsPages) {
    pdf.outline.add(null, "Contents", { pageNumber: 1 });
    pdf.setDisplayMode("fullwidth", "continuous", "UseOutlines");
    pdf.addPage();
  }
  return { sections, contentsPages, draw };

  function entry(title: string, section: boolean): ContentsEntry {
    pdf.setFont(font, section ? "bold" : "normal");
    pdf.setFontSize(section ? 11 : 9);
    const lines: string[] = pdf.splitTextToSize(title, columnWidth - (section ? 0 : 6) - 15);
    return { title, section, lines, height: Math.max(1, lines.length) * 4.2 + (section ? 3 : 1), page: 0, x: 0, y: 0 };
  }

  function draw(): void {
    for (let number = 1; number <= contentsPages; number++) {
      pdf.setPage(number);
      pdf.setFont(font, "bold"); pdf.setFontSize(21); pdf.setTextColor(38, 42, 54);
      pdf.text(number === 1 ? "Table of contents" : "Table of contents (continued)", margin, 26);
      pdf.setFont(font, "normal"); pdf.setFontSize(9);
      pdf.text("Click an entry to jump to its changes. Entries also appear in the PDF's document outline.", margin, 34);
    }
    for (const item of sections.flatMap((section) => [section.heading, ...section.subjects])) {
      if (!item.destination) continue;
      pdf.setPage(item.page);
      pdf.setFont(font, item.section ? "bold" : "normal");
      pdf.setFontSize(item.section ? 11 : 9);
      pdf.setTextColor(73, 61, 111);
      item.lines.forEach((line, index) => pdf.text(line, item.x + (item.section ? 0 : 6), item.y + index * 4.2));
      pdf.text(String(item.destination.pageNumber), item.x + columnWidth, item.y, { align: "right" });
      pdf.link(item.x, item.y - 3.5, columnWidth, item.height, { ...item.destination, zoom: 0 });
    }
  }
}
