import { DIALOGUE_WIDTH, DIALOGUE_HEIGHT, loadBw2DialogueAssets, layoutBw2Dialogue, renderBw2DialoguePage, type DialogueAssets, type DialogueLayout, type DialogueVariables } from "../pokeweb/bw2DialoguePreview";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

export type Bw2DialoguePreview = { refresh: () => void; show: () => void; destroy: () => void };
export function installBw2DialoguePreview(project: ProjectState, root: HTMLElement, text: () => string, variables: () => DialogueVariables, options: { zoom?: 1 | 2 } = {}): Bw2DialoguePreview {
  let stopped = false, started = false, page = 0;
  let assets: DialogueAssets | undefined, layout: DialogueLayout | undefined;
  root.innerHTML = `<div class="bw2-dialogue-navigation"><button type="button" data-bw2-dialogue-previous aria-label="Previous dialogue page">‹</button><select data-bw2-dialogue-page aria-label="Dialogue page"></select><button type="button" data-bw2-dialogue-next aria-label="Next dialogue page">›</button><select data-bw2-dialogue-zoom aria-label="Dialogue preview zoom"><option value="1">1×</option><option value="2">2×</option></select></div><div class="bw2-dialogue-stage"><canvas data-bw2-dialogue-canvas width="256" height="48" aria-label="Game-font dialogue preview"></canvas></div><p data-bw2-dialogue-metrics class="bw2-text-context"></p><div data-bw2-dialogue-notice class="bw2-text-context" role="status">Loading the ROM's dialogue graphics…</div>`;
  const canvas = root.querySelector<HTMLCanvasElement>("[data-bw2-dialogue-canvas]");
  const select = root.querySelector<HTMLSelectElement>("[data-bw2-dialogue-page]");
  const previous = root.querySelector<HTMLButtonElement>("[data-bw2-dialogue-previous]"), next = root.querySelector<HTMLButtonElement>("[data-bw2-dialogue-next]");
  const metrics = root.querySelector<HTMLElement>("[data-bw2-dialogue-metrics]"), notice = root.querySelector<HTMLElement>("[data-bw2-dialogue-notice]");
  const zoom = root.querySelector<HTMLSelectElement>("[data-bw2-dialogue-zoom]");
  if (zoom) zoom.value = String(options.zoom ?? 1);
  if (canvas) canvas.style.width = `${DIALOGUE_WIDTH * (options.zoom ?? 1)}px`;
  function paint(): void {
    if (stopped || !assets || !layout || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const current = layout.pages[page];
    const image = context.createImageData(DIALOGUE_WIDTH, DIALOGUE_HEIGHT);
    image.data.set(renderBw2DialoguePage(assets, current)); context.putImageData(image, 0, 0);
    current.widths.slice(0, 2).forEach((width, line) => { if (width > 232) { context.fillStyle = "#ff2424"; context.fillRect(246, 8 + line * 16, 2, 16); } });
    if (previous) previous.disabled = page === 0;
    if (next) next.disabled = page === layout.pages.length - 1;
    if (select) select.value = String(page);
    if (metrics) metrics.textContent = `${current.widths.slice(0, 2).map((width, row) => `Line ${row + 1}: ${width}/232px`).join(" · ")} · ${current.end}`;
    if (notice) notice.innerHTML = `${layout.variables.length ? `<p>${layout.variables.map((variable) => `Slot ${variable.slot}: ${escapeHtml(variable.label)} · W × ${variable.length}`).join("<br>")}</p>` : ""}${layout.warnings.length ? `<p class="-error">${layout.warnings.map(escapeHtml).join("<br>")}</p>` : ""}<p>${layout.variables.length ? "Maximum-length placeholders use the font's widest advance. " : ""}Preview shows the normal two-line box; actor tails and print timing are not simulated.</p>`;
  }
  function refresh(): void {
    if (stopped || !assets) return;
    try {
      layout = layoutBw2Dialogue(text(), assets.font, variables());
      page = Math.min(page, layout.pages.length - 1);
      if (select) select.innerHTML = layout.pages.map((_, index) => `<option value="${index}">Page ${index + 1} / ${layout!.pages.length}</option>`).join("");
      paint();
    } catch (error) { layout = undefined; canvas?.getContext("2d")?.clearRect(0, 0, DIALOGUE_WIDTH, DIALOGUE_HEIGHT); if (notice) notice.textContent = error instanceof Error ? error.message : String(error); }
  }
  select?.addEventListener("change", () => { page = Number(select.value); paint(); });
  previous?.addEventListener("click", () => { page = Math.max(0, page - 1); paint(); });
  next?.addEventListener("click", () => { page = Math.min((layout?.pages.length ?? 1) - 1, page + 1); paint(); });
  root.querySelector<HTMLSelectElement>("[data-bw2-dialogue-zoom]")?.addEventListener("change", (event) => { if (canvas) canvas.style.width = `${DIALOGUE_WIDTH * Number((event.target as HTMLSelectElement).value)}px`; });
  return { refresh, show: () => {
    if (stopped || started) { refresh(); return; }
    started = true;
    void loadBw2DialogueAssets(project).then((loaded) => { if (!stopped) { assets = loaded; refresh(); } }).catch((error) => { if (!stopped && notice) { notice.textContent = error instanceof Error ? error.message : String(error); started = false; } });
  }, destroy: () => { stopped = true; } };
}
