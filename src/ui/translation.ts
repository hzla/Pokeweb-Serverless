import { translateGen5Rom, translationRomFilename } from "../pokeweb/translationModel";
import { TRANSLATION_LOCALES, TRANSLATION_VERSION, type TranslationLocaleId } from "../pokeweb/translationProfile";
import type { TranslationReport } from "../pokeweb/translationModel";
import type { TranslationGraphicsCatalog, TranslationPreviewRom, TranslationGraphicImage } from "../pokeweb/translationGraphics";
import { isTranslationNativeRecord } from "../pokeweb/translationTransfer";

const escape = (text: string) => text.replace(/[&<>"']/gu, value => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!);

export function renderUntransferredDifferences(report: TranslationReport): string {
  const rows = report.records.filter(item => item.action !== "imported" || item.scope === "member" && item.output?.sha256 !== item.donor.sha256);
  if (!rows.length) return "";
  const edits = rows.filter(item => item.change !== "regional");
  const native = edits.filter(isTranslationNativeRecord);
  return `<details class="translation-differences" ${edits.length ? "open" : ""}>
    <summary>Donor differences not transferred · ${edits.length} donor edits · ${rows.length - edits.length} regional differences</summary>
    ${native.length ? `<p class="translation-error">${native.length} native sections or overlays differ from the clean regional baseline. Imported data may depend on these donor changes.</p>` : ""}
    <div class="translation-assets-scroll"><table class="translation-assets-table"><thead><tr><th scope="col">File / member</th><th scope="col">Difference</th><th scope="col">Reason</th></tr></thead><tbody>${[...edits, ...rows.filter(item => item.change === "regional")].map(item => `<tr><th scope="row">${escape(item.path)}${item.member === undefined ? "" : ` · ${item.member}`}</th><td>${item.change === "regional" ? "Regional" : "Changed from regional baseline"}${item.action === "imported" ? " · partially imported" : ""}</td><td>${escape(item.omittedEntries ? `${item.omittedEntries} extra regional entries omitted to retain US message IDs.` : item.reason ?? "US data retained.")}</td></tr>`).join("")}</tbody></table></div>
  </details>`;
}

export function renderTranslationScriptAudit(report: TranslationReport): string {
  const scripts = report.scripts;
  if (!scripts?.audits.length) return "";
  const blocked = scripts.audits.some(audit => audit.diagnostics.some(item => item.severity === "blocked"));
  const position = (offset?: number, opcode?: number) => [offset === undefined ? "" : `Byte ${offset}`, opcode === undefined ? "" : `0x${opcode.toString(16).toUpperCase()}`].filter(Boolean).join(" · ");
  return `<details class="translation-script-audit" ${blocked ? "open" : ""}>
    <summary>Script compatibility · ${scripts.imported} imported · ${scripts.adapted} adapted · ${scripts.retained} retained</summary>
    ${scripts.audits.map(audit => `<details class="translation-script-member"><summary>a/0/5/6 · ${audit.member} · ${audit.status} · ${audit.diagnostics.length} diagnostics</summary>
      <p>${audit.mapLocations?.length ? audit.mapLocations.map(location => `${escape(location.locationName ?? `Place name ${location.placeNameId}`)} · header row ${location.headerRow} · map ${location.map}`).join("<br>") : `Shared/unbound script · text banks ${[...new Set(audit.contexts.map(context => context.bank).filter(bank => bank !== undefined))].join(", ") || "unresolved"}`}</p>
      ${audit.diagnostics.length ? `<div class="translation-assets-scroll"><table class="translation-assets-table"><thead><tr><th>Check</th><th>Position / dependency</th><th>Reason</th></tr></thead><tbody>${audit.diagnostics.map(item => `<tr${item.severity === "blocked" ? ' class="translation-error"' : ""}><th scope="row">${escape(item.code)} · ${item.severity}</th><td>${escape(position(item.offset, item.opcode))}${item.dependency ? `<br>${escape(item.dependency)}` : ""}${item.bank === undefined ? "" : `<br>Bank ${item.bank}`}${item.messageId === undefined ? "" : ` · entry ${item.messageId}`}${item.variable === undefined ? "" : `<br>Variable 0x${item.variable.toString(16).toUpperCase()}`}</td><td>${escape(item.reason)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${audit.references.length ? `<details><summary>Text references · ${audit.references.length}</summary><div class="translation-assets-scroll"><table class="translation-assets-table"><thead><tr><th>Reference</th><th>US text</th><th>Donor text</th><th>Output text</th></tr></thead><tbody>${audit.references.map(item => `<tr><th scope="row">${escape(position(item.offset, item.opcode))}<br>${item.bank === undefined ? "Dynamic bank" : `Bank ${item.bank}`} · ${item.messageId === undefined ? "dynamic entry" : `entry ${item.messageId}`}<br>${item.status}</th><td>${escape(item.sourceText ?? "—")}</td><td>${escape(item.donorText ?? "—")}</td><td>${escape(item.outputText ?? "—")}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
      ${audit.rewrites.length ? `<ul>${audit.rewrites.map(item => `<li>Byte ${item.offset}: ${item.before} → ${item.after}. ${escape(item.reason)}</li>`).join("")}</ul>` : ""}
    </details>`).join("")}
  </details>`;
}

export function renderTranslationCard(): string {
  return `<section class="upload-panel translation-tool" aria-labelledby="translation-title">
    <h2 id="translation-title">Translation</h2>
    <label class="changelog-file"><span>Language</span>
      <select id="translation-language" aria-label="Translation language"><option value="">Auto-detect</option>${TRANSLATION_LOCALES.map(locale => `<option value="${locale.id}">${locale.language}</option>`).join("")}</select>
    </label>
    <label class="changelog-file"><span>Clean US Black 2 / White 2 ROM</span>
      <input id="translation-source" type="file" accept=".nds" />
    </label>
    <label class="changelog-file"><span>Foreign Black 2 / White 2 ROM</span>
      <input id="translation-donor" type="file" accept=".nds" />
    </label>
    <div class="changelog-actions">
      <button class="btn -default" id="translation-download" type="button" disabled>Download Translated ROM</button>
      <button class="btn -default" id="translation-report" type="button" hidden>Download Translation Report</button>
    </div>
    <div id="translation-status" class="upload-status" role="status" aria-live="polite"></div>
    <div id="translation-differences"></div>
  </section>
  <details class="translation-assets">
    <summary id="translation-assets-title">Typical transferred assets</summary>
    <section class="translation-graphics" aria-labelledby="translation-graphics-title">
      <div class="translation-graphics-heading"><h3 id="translation-graphics-title">Graphics differences</h3><button class="btn -default" id="translation-preview" type="button" disabled>Preview graphics</button></div>
      <div id="translation-preview-status" role="status" aria-live="polite"></div>
      <div id="translation-preview-controls" hidden>
        <label>Graphic <select id="translation-graphic" aria-label="Graphic difference"></select></label>
        <div id="translation-palette-controls" hidden><label>Palette <select id="translation-palette" aria-label="Tile sheet palette"></select></label><label>Bank <input id="translation-palette-bank" type="number" min="0" max="15" value="0" aria-label="Tile sheet palette bank" /></label></div>
        <div id="translation-preview-caption"></div>
        <div class="translation-graphics-pair"><figure><figcaption>US ROM</figcaption><div id="translation-preview-us" class="translation-graphic-image"></div></figure><figure><figcaption id="translation-preview-donor-label">Donor ROM</figcaption><div id="translation-preview-donor" class="translation-graphic-image"></div></figure></div>
        <div id="translation-preview-warnings"></div>
      </div>
      <details id="translation-preview-issues" hidden><summary>Preview limitations</summary><ul></ul></details>
    </section>
    <div class="translation-assets-scroll" role="region" aria-labelledby="translation-assets-title" tabindex="0">
      <table class="translation-assets-table">
        <thead><tr><th scope="col">Asset</th><th scope="col">Typical files</th><th scope="col">Transferred content</th></tr></thead>
        <tbody>
          <tr><th scope="row">Text and dialogue</th><td><code>a/0/0/2</code><br><code>a/0/0/3</code></td><td>Messages, names, descriptions and story dialogue.</td></tr>
          <tr><th scope="row">Musical text</th><td><code>a/1/1/2</code>–<code>a/1/1/5</code></td><td>Additional text banks used by Pokémon Musicals.</td></tr>
          <tr><th scope="row">Battle UI</th><td><code>a/0/1/1</code></td><td>Graphical labels and battle-screen layouts.</td></tr>
          <tr><th scope="row">Summary screen</th><td><code>a/0/7/7</code></td><td>Regional artwork and screen layouts.</td></tr>
          <tr><th scope="row">Main menu</th><td><code>a/0/3/4</code></td><td>Compatible regional menu graphics.</td></tr>
          <tr><th scope="row">Fonts</th><td><code>a/0/2/3</code></td><td>Regional numeric glyphs are adapted to the US font layout so HP and level numbers remain readable.</td></tr>
          <tr><th scope="row">Other 2D artwork</th><td>Various graphics archives</td><td>Bitmap lettering, palettes, sprites, layouts and animations.</td></tr>
          <tr><th scope="row">Musical labels</th><td><code>a/0/4/5</code></td><td>Localized “new” lettering used when dressing up Pokémon.</td></tr>
          <tr><th scope="row">Battle and Entralink cut-ins</th><td><code>a/1/1/6</code><br><code>a/1/7/8</code></td><td>Regional trainer and link-battle VS artwork with its matching models and animations, plus Entralink “Time’s up!” lettering.</td></tr>
          <tr><th scope="row">Poké Transfer prompts</th><td><code>a/1/4/2</code></td><td>Ready, start, time-up, finish and high-score textures.</td></tr>
          <tr><th scope="row">Outdoor building textures</th><td><code>a/1/7/4</code></td><td>Localized artwork on the Musical Theater building.</td></tr>
          <tr><th scope="row">PWT stadium graphics</th><td><code>a/2/6/3</code></td><td>Regional geometry for the stadium’s VS display.</td></tr>
          <tr><th scope="row">Item data</th><td><code>a/0/2/4</code></td><td>Localized item-name ordering and compatible donor item edits.</td></tr>
          <tr><th scope="row">Pokéstar Studios recording</th><td><code>a/2/6/9</code></td><td>Actor names and language fields in the preset recording, plus Riolu’s Korean nickname and the updated checksum.</td></tr>
          <tr><th scope="row">Other resources and data</th><td>Additional donor archives</td><td>Compatible changed members; the exact set depends on the donor ROM.</td></tr>
          <tr><th scope="row">ROM hack data edits</th><td>Personal, moves, learnsets, evolutions, encounters and trainers</td><td>Compatible edits from a modified donor ROM, recorded in the translation report.</td></tr>
        </tbody>
      </table>
    </div>
  </details>`;
}

export function attachTranslationCard(root: HTMLElement, download: (bytes: Uint8Array, filename: string) => void): void {
  const source = root.querySelector<HTMLInputElement>("#translation-source"), donor = root.querySelector<HTMLInputElement>("#translation-donor");
  const button = root.querySelector<HTMLButtonElement>("#translation-download"), reportButton = root.querySelector<HTMLButtonElement>("#translation-report");
  const status = root.querySelector<HTMLElement>("#translation-status");
  const language = root.querySelector<HTMLSelectElement>("#translation-language");
  if (!source || !donor || !button || !reportButton || !status || !language) return;
  const differences = root.querySelector<HTMLElement>("#translation-differences")!;
  const previewButton = root.querySelector<HTMLButtonElement>("#translation-preview")!;
  const previewStatus = root.querySelector<HTMLElement>("#translation-preview-status")!;
  const previewControls = root.querySelector<HTMLElement>("#translation-preview-controls")!;
  const graphicSelect = root.querySelector<HTMLSelectElement>("#translation-graphic")!;
  const paletteSelect = root.querySelector<HTMLSelectElement>("#translation-palette")!;
  const paletteBank = root.querySelector<HTMLInputElement>("#translation-palette-bank")!;
  const paletteControls = root.querySelector<HTMLElement>("#translation-palette-controls")!;
  const previewUs = root.querySelector<HTMLElement>("#translation-preview-us")!;
  const previewDonor = root.querySelector<HTMLElement>("#translation-preview-donor")!;
  const previewCaption = root.querySelector<HTMLElement>("#translation-preview-caption")!;
  const previewWarnings = root.querySelector<HTMLElement>("#translation-preview-warnings")!;
  const previewIssues = root.querySelector<HTMLDetailsElement>("#translation-preview-issues")!;
  let busy: "translation" | "preview" | undefined, report: Uint8Array | undefined;
  let catalog: TranslationGraphicsCatalog | undefined, previewRoms: [TranslationPreviewRom, TranslationPreviewRom] | undefined;
  let reportLanguage = "White2", reportGame = "White2";
  const sync = () => {
    button.disabled = previewButton.disabled = Boolean(busy) || !source.files?.[0] || !donor.files?.[0];
    source.disabled = donor.disabled = language.disabled = graphicSelect.disabled = paletteSelect.disabled = paletteBank.disabled = Boolean(busy);
    button.textContent = busy === "translation" ? "Translating…" : "Download Translated ROM";
    previewButton.textContent = busy === "preview" ? "Reading graphics…" : "Preview graphics";
    status.setAttribute("aria-busy", String(busy === "translation"));
    previewStatus.setAttribute("aria-busy", String(busy === "preview"));
  };
  for (const input of [source, donor, language]) input.addEventListener("change", () => {
    report = undefined; reportButton.hidden = true; status.textContent = ""; status.classList.remove("translation-error"); differences.replaceChildren();
    catalog = undefined; previewRoms = undefined; previewControls.hidden = previewIssues.hidden = true;
    graphicSelect.replaceChildren(); paletteSelect.replaceChildren(); previewUs.replaceChildren(); previewDonor.replaceChildren();
    previewIssues.querySelector("ul")!.replaceChildren(); previewStatus.textContent = ""; previewStatus.classList.remove("translation-error"); sync();
  });
  button.addEventListener("click", async () => {
    const a = source.files?.[0], b = donor.files?.[0];
    if (busy || !a || !b) return;
    busy = "translation"; report = undefined; reportButton.hidden = true; differences.replaceChildren(); sync(); status.classList.remove("translation-error");
    const progress = async (message: string) => {
      status.textContent = message;
      await new Promise<void>(resolve => window.setTimeout(resolve, 20));
    };
    try {
      if (![a, b].every(file => /\.nds$/iu.test(file.name))) throw new Error("Choose two .nds ROM files.");
      await progress("Reading the US ROM and foreign donor…");
      const sourceBytes = new Uint8Array(await a.arrayBuffer()), donorBytes = new Uint8Array(await b.arrayBuffer());
      const result = await translateGen5Rom(sourceBytes, donorBytes, (language.value || undefined) as TranslationLocaleId | undefined, progress);
      download(result.bytes, translationRomFilename(a.name, result.report.language));
      report = new TextEncoder().encode(JSON.stringify(result.report, null, 2) + "\n"); reportButton.hidden = false;
      reportLanguage = result.report.language;
      reportGame = result.report.gameCode === "IREO" ? "Black2" : "White2";
      differences.innerHTML = renderUntransferredDifferences(result.report) + renderTranslationScriptAudit(result.report);
      status.textContent = `${result.report.language} ${reportGame === "Black2" ? "Black 2" : "White 2"} ROM downloaded. ${result.report.replacedFiles} files imported; ${result.report.skippedDonorEdits} donor edits skipped.`;
    } catch (error) {
      status.classList.add("translation-error");
      status.textContent = `Translation failed. ${error instanceof Error ? error.message : String(error)}`;
    } finally { busy = undefined; sync(); }
  });
  reportButton.addEventListener("click", () => {
    if (report) download(report, `${reportGame}-${reportLanguage}-${TRANSLATION_VERSION}-translation.json`);
  });
  const draw = (parent: HTMLElement, image: TranslationGraphicImage | undefined, crop?: { x: number; y: number; width: number; height: number }) => {
    parent.replaceChildren();
    if (!image) { parent.textContent = "No matching image"; return; }
    const canvas = document.createElement("canvas");
    canvas.width = crop?.width ?? image.width; canvas.height = crop?.height ?? image.height;
    canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", `${graphicSelect.selectedOptions[0]?.textContent ?? "ROM graphic"} · ${image.width} × ${image.height}`);
    canvas.style.width = `${Math.min(canvas.width * 2, 512)}px`;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), -(crop?.x ?? 0), -(crop?.y ?? 0));
    parent.append(canvas);
  };
  const showGraphic = async (resetPalette = false) => {
    const graphic = catalog?.graphics[Number(graphicSelect.value)];
    if (!graphic || !previewRoms) return;
    paletteControls.hidden = graphic.kind !== "tiles";
    if (resetPalette) {
      paletteSelect.replaceChildren(new Option("Grayscale indices", ""), ...graphic.palettes.map(member => new Option(`Member ${member}`, String(member))));
      paletteSelect.value = graphic.palette === undefined ? "" : String(graphic.palette); paletteBank.value = "0";
    }
    previewCaption.textContent = `${graphic.kind === "tiles" ? "Tile sheet" : graphic.kind === "cell" ? "Sprite cell" : graphic.kind === "texture" ? "Texture" : "Assembled background"} · ${graphic.path} · member ${graphic.member}${graphic.retainedReason ? ` · ${graphic.retainedReason}` : ""}`;
    previewCaption.classList.toggle("translation-error", Boolean(graphic.retainedReason));
    previewUs.replaceChildren(); previewDonor.replaceChildren(); previewWarnings.textContent = "";
    const { renderTranslationGraphic } = await import("../pokeweb/translationGraphics");
    const palette = graphic.kind === "tiles" ? paletteSelect.value ? Number(paletteSelect.value) : null : graphic.palette;
    const images = await Promise.all(previewRoms.map(rom => renderTranslationGraphic(rom, graphic, palette, Math.max(0, Math.min(15, Number(paletteBank.value) || 0)))));
    let crop: { x: number; y: number; width: number; height: number } | undefined;
    if (graphic.kind === "background" || graphic.kind === "cell") {
      let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
      for (const image of images) if (image) for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (image.rgba[(y * image.width + x) * 4 + 3]) {
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      if (maxX >= minX) { crop = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }; previewCaption.textContent += " · cropped to artwork"; }
    }
    draw(previewUs, images[0], crop); draw(previewDonor, images[1], crop);
    previewWarnings.textContent = [...new Set(images.flatMap(image => image?.warnings ?? []))].join(" ");
  };
  previewButton.addEventListener("click", async () => {
    const a = source.files?.[0], b = donor.files?.[0];
    if (busy || !a || !b) return;
    busy = "preview"; sync(); catalog = undefined; previewRoms = undefined; previewControls.hidden = previewIssues.hidden = true;
    previewUs.replaceChildren(); previewDonor.replaceChildren(); previewStatus.classList.remove("translation-error");
    try {
      const { openTranslationPreviewRom, compareTranslationGraphics } = await import("../pokeweb/translationGraphics");
      previewRoms = await Promise.all([openTranslationPreviewRom(a), openTranslationPreviewRom(b)]);
      catalog = await compareTranslationGraphics(...previewRoms, (language.value || undefined) as TranslationLocaleId | undefined, async message => {
        previewStatus.textContent = message; await new Promise(resolve => window.setTimeout(resolve, 0));
      });
      graphicSelect.replaceChildren(...catalog.graphics.map((graphic, index) => new Option(graphic.label, String(index))));
      root.querySelector<HTMLElement>("#translation-preview-donor-label")!.textContent = `${catalog.language} donor`;
      previewStatus.textContent = `${catalog.graphics.length} graphics previews · ${catalog.archivesCompared} archives compared.`;
      previewControls.hidden = !catalog.graphics.length;
      previewIssues.hidden = !catalog.issues.length;
      previewIssues.querySelector("summary")!.textContent = `Preview limitations · ${catalog.issues.length}`;
      previewIssues.querySelector("ul")!.replaceChildren(...catalog.issues.map(issue => { const li = document.createElement("li"); li.textContent = issue; return li; }));
      await showGraphic(true);
    } catch (error) {
      previewStatus.classList.add("translation-error"); previewStatus.textContent = `Graphics preview failed. ${error instanceof Error ? error.message : String(error)}`;
    } finally { busy = undefined; sync(); }
  });
  for (const control of [graphicSelect, paletteSelect, paletteBank]) control.addEventListener("change", async () => {
    if (busy) return;
    busy = "preview"; sync();
    try { await showGraphic(control === graphicSelect); }
    catch (error) { previewWarnings.textContent = error instanceof Error ? error.message : String(error); }
    finally { busy = undefined; sync(); }
  });
  sync();
}
