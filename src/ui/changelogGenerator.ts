import { CHANGELOG_DOMAIN_TITLES, CHANGELOG_NARCS, type ChangelogResult } from "../pokeweb/changelogModel";
import type { NarcName } from "../pokeweb/constants";
import type { ChangelogDocument } from "../pokeweb/changelogDocument";
import { renderChangelogText } from "../pokeweb/changelogText";
import { downloadTextFile } from "./changelogView";
import { escapeHtml } from "./dom";

const CHANGELOG_CHOICES = CHANGELOG_NARCS.filter((name) => name !== "trpok").map((name) => ({
  key: name === "trdata" ? "trainers" : name,
  title: name === "trdata" ? "Trainers" : CHANGELOG_DOMAIN_TITLES[name],
  narcs: name === "trdata" ? ["trdata", "trpok"] as NarcName[] : [name],
}));

export function selectedChangelogNarcsFromPicker(root: HTMLElement): NarcName[] {
  const selected = new Set([...root.querySelectorAll<HTMLInputElement>(".changelog-narc-input:checked")].map((input) => input.value));
  return CHANGELOG_CHOICES.filter((choice) => selected.has(choice.key)).flatMap((choice) => choice.narcs);
}

export function renderChangelogGenerator(): string {
  return `<div class="upload-panel changelog-generator">
    <div class="changelog-generator__header"><h2>Changelog Generator</h2>
      <p>Compare two ROMs and download PDF or TXT changes for the NARCs you choose. PDFs include extracted Pokemon icons; TXT files use ASCII tables.</p></div>
    <div class="changelog-generator__inputs">
      <label class="changelog-file"><span>Original ROM</span><input id="changelog-before-input" type="file" accept=".nds"></label>
      <label class="changelog-file"><span>Modified ROM</span><input id="changelog-after-input" type="file" accept=".nds"></label>
    </div>
    <label class="upload-options changelog-option"><input id="changelog-fairy-input" type="checkbox"><span>Fairy ROM offsets</span></label>
    <fieldset class="changelog-narc-picker"><legend>NARCs to compare</legend>
      <div class="changelog-narc-picker__header"><p>All supported NARCs are selected by default.</p>
        <div class="changelog-actions"><button class="btn -default" type="button" data-changelog-select="all">Select all</button>
          <button class="btn -default" type="button" data-changelog-select="none">Clear selection</button></div></div>
      <div class="changelog-narc-picker__grid">${CHANGELOG_CHOICES.map((choice) => `<label class="changelog-narc-choice">
        <input class="changelog-narc-input" type="checkbox" value="${choice.key}" checked>
        <span>${escapeHtml(choice.title)}<small>${choice.narcs.join(" + ")}</small></span></label>`).join("")}</div>
    </fieldset>
    <div class="changelog-actions">
      <button class="btn -default" id="generate-changelog-btn" type="button">Generate Changelog</button>
      <button class="btn -default" id="download-changelog-btn" type="button" disabled>Download combined PDF</button>
      <button class="btn -default" id="download-changelog-txt-btn" type="button" disabled>Download combined TXT</button>
    </div>
    <div class="upload-status" id="changelog-status" role="status" aria-live="polite"></div>
    <div id="changelog-tabs" class="changelog-tabs"><div class="changelog-empty">Choose two ROMs and the NARCs to compare. Your document preview will appear here.</div></div>
  </div>`;
}

export function attachChangelogNarcPicker(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-changelog-select]").forEach((button) => {
    button.addEventListener("click", () => {
      root.querySelectorAll<HTMLInputElement>(".changelog-narc-input").forEach((input) => { input.checked = button.dataset.changelogSelect === "all"; });
    });
  });
}

export function renderGeneratedChangelog(root: HTMLElement, result: ChangelogResult): void {
  const container = root.querySelector<HTMLElement>("#changelog-tabs");
  if (!container) return;
  const activeIndex = Math.max(0, result.documents.findIndex((document) => document.changes > 0));
  container.innerHTML = `<div class="changelog-tab-list" role="tablist" aria-label="NARC changelog documents">${result.documents.map((document, index) => `
    <button class="changelog-tab ${index === activeIndex ? "-active" : ""}" id="changelog-tab-${document.domain}" role="tab" type="button"
      aria-controls="changelog-panel-${document.domain}" aria-selected="${index === activeIndex}" tabindex="${index === activeIndex ? 0 : -1}"
      data-document-tab="${index}">${escapeHtml(document.title)} <span>${document.changes}</span></button>`).join("")}</div>
    ${result.documents.map((document, index) => `<section class="changelog-document-panel" id="changelog-panel-${document.domain}" role="tabpanel"
      aria-labelledby="changelog-tab-${document.domain}" tabindex="0" ${index === activeIndex ? "" : "hidden"}>
      <div class="changelog-document-actions">
        <button class="btn -default" type="button" data-download-document="${index}">Download ${document.title} PDF</button>
        <button class="btn -default" type="button" data-download-text-document="${index}">Download ${document.title} TXT</button>
      </div>
      <article class="changelog-document">${document.html}</article></section>`).join("")}`;
  const tabs = [...container.querySelectorAll<HTMLButtonElement>("[data-document-tab]")];
  const select = (index: number) => {
    tabs.forEach((tab, tabIndex) => {
      tab.classList.toggle("-active", index === tabIndex);
      tab.setAttribute("aria-selected", String(index === tabIndex));
      tab.tabIndex = index === tabIndex ? 0 : -1;
    });
    container.querySelectorAll<HTMLElement>(".changelog-document-panel").forEach((panel, panelIndex) => { panel.hidden = index !== panelIndex; });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(index));
    tab.addEventListener("keydown", (event) => {
      const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      select(next);
      tabs[next].focus();
    });
  });
  container.querySelectorAll<HTMLButtonElement>("[data-download-document]").forEach((button) => {
    button.addEventListener("click", () => {
      const document = result.documents[Number(button.dataset.downloadDocument)];
      void exportChangelogPdf(root, [document], document.filename);
    });
  });
  container.querySelectorAll<HTMLButtonElement>("[data-download-text-document]").forEach((button) => {
    button.addEventListener("click", () => {
      const document = result.documents[Number(button.dataset.downloadTextDocument)];
      exportChangelogText(root, [document], `pokeweb-changelog-${document.domain}.txt`);
    });
  });
  const icons = new Map(result.documents.flatMap((document) => document.icons.map((icon) => [icon.key, icon] as const)));
  container.querySelectorAll<HTMLCanvasElement>("[data-changelog-icon]").forEach((canvas) => {
    const icon = icons.get(canvas.dataset.changelogIcon!);
    if (icon) canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(icon.pixels), icon.width, icon.height), 0, 0);
  });
}

export async function exportChangelogPdf(root: HTMLElement, documents: ChangelogDocument[], filename: string): Promise<void> {
  const status = root.querySelector<HTMLElement>("#changelog-status");
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("#generate-changelog-btn, #download-changelog-btn, #download-changelog-txt-btn, [data-download-document], [data-download-text-document]")];
  const disabled = buttons.map((button) => button.disabled);
  buttons.forEach((button) => { button.disabled = true; });
  if (status) status.textContent = "Preparing PDF with embedded Pokemon icons…";
  try {
    const { downloadChangelogPdf } = await import("./changelogPdfDownload");
    await downloadChangelogPdf(documents, filename);
    if (status) status.textContent = `Downloaded ${filename}. Pokemon icons are embedded in the PDF.`;
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    buttons.forEach((button, index) => { button.disabled = disabled[index]; });
  }
}

export function exportChangelogText(root: HTMLElement, documents: ChangelogDocument[], filename: string): void {
  const status = root.querySelector<HTMLElement>("#changelog-status");
  try {
    downloadTextFile(filename, renderChangelogText(documents));
    if (status) status.textContent = `Downloaded ${filename}.`;
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
  }
}
