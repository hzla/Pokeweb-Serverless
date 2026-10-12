import {
  compileTitlePng, prepareTitlePngSource, resizeTitlePng, titlePngPlacement, titlePngTarget,
  type TitlePngFit, type TitlePngImage, type TitlePngImport, type TitlePngLayer,
} from "../pokeweb/titleScreenPng";
import type { TitleScreenDocument } from "../pokeweb/titleScreenModel";

const labels: Record<TitlePngLayer, string> = { logo: "Logo", background: "Scrolling background", credits: "Game Freak credits", prompt: "Press Start" };

/** Decode with the browser so indexed, RGB, RGBA, and interlaced PNGs all work. */
export async function readTitlePng(file: File): Promise<TitlePngImage> {
  if (file.size > 16 * 1024 * 1024) throw new Error("PNG imports are limited to 16 MiB.");
  const header = new Uint8Array(await file.slice(0, 33).arrayBuffer()), view = new DataView(header.buffer);
  if (header.length < 33 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a || view.getUint32(12) !== 0x49484452) throw new Error("Choose a valid PNG image.");
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16 * 1024 * 1024) throw new Error("PNG images are limited to 8192 pixels per side and 16 megapixels.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG import requires canvas support.");
    context.drawImage(bitmap, 0, 0);
    return { width, height, rgba: context.getImageData(0, 0, width, height).data };
  } finally { bitmap.close(); }
}

export function openTitlePngImport(document: TitleScreenDocument, layer: TitlePngLayer, originalSource: TitlePngImage): { result: Promise<TitlePngImport | undefined>; close: () => void } {
  const source = prepareTitlePngSource(document, layer, originalSource);
  const fit: TitlePngFit = { mode: "fit", x: .5, y: .5, zoom: 1 };
  let fullLogo = layer === "logo" && source.width === 256 && source.height === 256;
  let candidate: TitlePngImport | undefined, pending = 0, closed = false;
  const dialog = window.document.createElement("dialog"); dialog.className = "title-png-dialog";
  dialog.setAttribute("aria-labelledby", "title-png-heading");
  dialog.innerHTML = `<form method="dialog">
    <div class="title-section-header"><div><h2 id="title-png-heading">Import PNG · ${labels[layer]}</h2><p>${originalSource.width} × ${originalSource.height} source · Review the converted image before importing.</p></div><button class="btn -default" value="cancel" aria-label="Close PNG importer">✕</button></div>
    <div class="title-png-controls">
      <label>Resize mode<select id="title-png-mode"><option value="fit">Fit entire image</option><option value="stretch">Scale to fill</option><option value="crop">Crop to fill</option></select></label>
      ${layer === "logo" && titlePngTarget(document, layer, true).height > 192 ? `<label>Destination<select id="title-png-destination"><option value="screen" ${fullLogo ? "" : "selected"}>Visible screen · 256 × 192</option><option value="full" ${fullLogo ? "selected" : ""}>Full layer · 256 × 256</option></select></label>` : ""}
      <span class="title-muted" id="title-png-size"></span>
    </div>
    <div class="title-png-crop-controls" hidden><label>Horizontal crop<input id="title-png-x" type="range" min="0" max="100" value="50"></label><label>Vertical crop<input id="title-png-y" type="range" min="0" max="100" value="50"></label><label>Zoom<input id="title-png-zoom" type="range" min="1" max="4" step=".01" value="1"></label></div>
    <div class="title-png-previews"><figure><figcaption>Resize / crop preview</figcaption><canvas id="title-png-fit" aria-label="Resized PNG preview; drag to move crop"></canvas></figure><figure><figcaption>Converted game layer</figcaption><canvas id="title-png-native" aria-label="Converted title layer preview"></canvas></figure></div>
    <p class="title-muted" id="title-png-help">Fit keeps the image's proportions and adds transparent padding. Scale to fill uses the entire canvas. Crop to fill lets you drag the preview or adjust the crop sliders.</p>
    <p class="title-muted">${layer === "logo" || layer === "background" ? "The other shared layer keeps its existing colors and artwork. " : layer === "prompt" ? "The existing sprite positions and blink timing are preserved. " : ""}Colors are converted to the DS palette. Alpha below 50% becomes transparent; other pixels become opaque.</p>
    <p id="title-png-report" role="status" aria-live="polite"></p>
    <div class="title-toolbar title-png-actions"><button class="btn -default" value="cancel">Cancel</button><button class="btn -primary" id="title-png-apply" value="import" disabled>Import PNG</button></div>
  </form>`;
  window.document.body.append(dialog);
  const query = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const result = new Promise<TitlePngImport | undefined>((resolve) => {
    dialog.addEventListener("close", () => { closed = true; clearTimeout(pending); resolve(dialog.returnValue === "import" ? candidate : undefined); dialog.remove(); }, { once: true });
  });
  const target = () => titlePngTarget(document, layer, fullLogo);
  const draw = (selector: string, image: TitlePngImage) => {
    const canvas = query<HTMLCanvasElement>(selector); canvas.width = image.width; canvas.height = image.height;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
  };
  const update = () => {
    if (closed) return;
    candidate = undefined; query<HTMLButtonElement>("#title-png-apply").disabled = true;
    query<HTMLElement>(".title-png-crop-controls").hidden = fit.mode !== "crop";
    query<HTMLCanvasElement>("#title-png-fit").classList.toggle("-cropping", fit.mode === "crop");
    try {
      const dimensions = target(), resized = resizeTitlePng(source, dimensions, fit);
      query<HTMLElement>("#title-png-size").textContent = `${dimensions.width} × ${dimensions.height} output`;
      draw("#title-png-fit", resized);
      candidate = compileTitlePng(document, layer, resized); draw("#title-png-native", candidate.image);
      const notes = [`${candidate.colors} palette entries used · ${candidate.colorLimit}-color format · ${candidate.tiles} tiles`];
      if (candidate.quantized) notes.push("Colors reduced to fit the available palette.");
      if (candidate.approximatedTiles) notes.push(`Tile detail reduced in ${candidate.approximatedTiles} tiles to fit the graphics allocation. Review the converted preview.`);
      query<HTMLElement>("#title-png-report").textContent = notes.join(" ");
      query<HTMLElement>("#title-png-report").classList.remove("-error");
      query<HTMLButtonElement>("#title-png-apply").disabled = false;
    } catch (error) {
      const canvas = query<HTMLCanvasElement>("#title-png-native"); canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      query<HTMLElement>("#title-png-report").textContent = error instanceof Error ? error.message : String(error);
      query<HTMLElement>("#title-png-report").classList.add("-error");
    }
  };
  const schedule = () => {
    // A stale preview must never be applied while a crop is being adjusted.
    candidate = undefined; query<HTMLButtonElement>("#title-png-apply").disabled = true;
    clearTimeout(pending); pending = window.setTimeout(update, 100);
  };
  query<HTMLSelectElement>("#title-png-mode").addEventListener("change", (event) => { fit.mode = (event.target as HTMLSelectElement).value as TitlePngFit["mode"]; update(); });
  query<HTMLSelectElement>("#title-png-destination")?.addEventListener("change", (event) => { fullLogo = (event.target as HTMLSelectElement).value === "full"; update(); });
  for (const key of ["x", "y", "zoom"] as const) query<HTMLInputElement>(`#title-png-${key}`).addEventListener("input", (event) => { fit[key] = Number((event.target as HTMLInputElement).value) / (key === "zoom" ? 1 : 100); schedule(); });
  const canvas = query<HTMLCanvasElement>("#title-png-fit");
  let drag: { x: number; y: number; fx: number; fy: number } | undefined;
  canvas.addEventListener("pointerdown", (event) => {
    if (fit.mode !== "crop") return;
    drag = { x: event.clientX, y: event.clientY, fx: fit.x, fy: fit.y }; canvas.setPointerCapture(event.pointerId); event.preventDefault();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const p = titlePngPlacement(source, target(), fit), rect = canvas.getBoundingClientRect();
    fit.x = Math.max(0, Math.min(1, drag.fx - (event.clientX - drag.x) / rect.width * p.sw / Math.max(.001, source.width - p.sw)));
    fit.y = Math.max(0, Math.min(1, drag.fy - (event.clientY - drag.y) / rect.height * p.sh / Math.max(.001, source.height - p.sh)));
    query<HTMLInputElement>("#title-png-x").value = String(fit.x * 100); query<HTMLInputElement>("#title-png-y").value = String(fit.y * 100); schedule();
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(event, () => { if (drag) { drag = undefined; clearTimeout(pending); update(); } });
  dialog.addEventListener("submit", (event) => {
    // Enter in a select must not close the dialog without choosing an action.
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    if (!submitter || (submitter.value === "import" && !candidate)) event.preventDefault();
  });
  dialog.showModal(); update();
  return { result, close: () => { if (!closed) dialog.close("cancel"); } };
}
