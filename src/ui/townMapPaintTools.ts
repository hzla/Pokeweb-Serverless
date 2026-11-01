import { readTownMapLayer, TOWN_MAP_LAYERS, type TownMapGraphicFiles } from "../pokeweb/townMapGraphics";
import { prepareTownMapArtworkPatch, townMapArtworkRgba, type TownMapArtworkPatch } from "../pokeweb/townMapArtwork";
import { createTownMapPaintSource, createTownMapPaintPatch, snapTownMapPaintPoint, townMapRouteEndpoint, townMapRouteMetrics,
  type TownMapPaintSource, type TownMapPaintSpec, type TownMapCitySize, type TownMapRoutePaint } from "../pokeweb/townMapPainting";
import type { TownMapPoint } from "../pokeweb/townMapModel";

export function townMapPaintControls(): string {
  return `<div class="tm-paint-controls" hidden><div class="tm-controls"><div class="tm-segmented tm-city-sizes" role="group" aria-label="City size"><button type="button" data-city-size="small" title="8 × 8 city ring">Small</button><button type="button" data-city-size="large" title="12 × 12 city ring">Large</button></div><label><input id="tm-paint-snap" type="checkbox" />Snap 8 px</label></div>
    <div class="tm-route-options" hidden><div class="tm-route-fields"><label>Start X<input type="number" min="0" max="255" step="1" data-route-field="x" /></label><label>Start Y<input type="number" min="0" max="255" step="1" data-route-field="y" /></label><label>Length (px)<input type="number" min="0.01" max="362" step="any" data-route-field="length" /></label><label>Angle (°)<input type="number" step="any" data-route-field="angle" /></label></div><div class="tm-controls"><button class="btn -default" type="button" data-paint-action="place">Place route</button><button class="btn -default" type="button" data-paint-action="cancel">Cancel</button><span class="tm-route-end"></span></div></div><div class="tm-paint-status" role="status" aria-live="polite"></div></div>`;
}
type Options = {
  graphics: () => TownMapGraphicFiles; busy: () => boolean; snap: () => boolean; setSnap: (snap: boolean) => void;
  commit: (graphics: TownMapGraphicFiles) => boolean; update: () => void; status: (text: string, error?: boolean) => void;
};
type Preview = { spec: TownMapPaintSpec; patch?: TownMapArtworkPatch; canvas?: HTMLCanvasElement; graphics?: TownMapGraphicFiles; tiles?: number; error?: string; checking?: boolean };
type Gesture = { id: number; endpoint: "start" | "end"; before?: TownMapRoutePaint };
const FRONT = TOWN_MAP_LAYERS[1];
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Transient previews only; the editor owns the single undoable resource commit. */
export class TownMapPaintTools {
  private kind: "city" | "route" | undefined;
  private size: TownMapCitySize = "large";
  private hover?: TownMapPoint;
  private route?: TownMapRoutePaint;
  private gesture?: Gesture;
  private preview?: Preview;
  private source?: TownMapPaintSource;
  private sourceFiles?: TownMapGraphicFiles;
  private palette?: ReturnType<typeof readTownMapLayer>["indexed"]["palette"];
  private validation?: ReturnType<typeof setTimeout>;
  private fieldError?: string;
  private readonly host: HTMLElement;
  constructor(private readonly root: HTMLElement, private readonly options: Options) {
    this.host = root.querySelector<HTMLElement>(".tm-paint-controls")!;
    this.host.querySelectorAll<HTMLButtonElement>("[data-city-size]").forEach(button => button.addEventListener("click", () => {
      if (options.busy()) return; this.size = button.dataset.citySize as TownMapCitySize; this.requestPreview();
    }));
    this.host.querySelector<HTMLInputElement>("#tm-paint-snap")!.addEventListener("change", event => {
      options.setSnap((event.target as HTMLInputElement).checked);
      if (this.route) { this.route.start = this.snap(this.route.start); this.route.end = this.snap(this.route.end); }
      if (this.hover) this.hover = this.snap(this.hover);
      this.requestPreview();
    });
    this.host.querySelectorAll<HTMLInputElement>("[data-route-field]").forEach(input => {
      input.addEventListener("input", () => this.editField(input)); input.addEventListener("blur", () => this.render());
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); this.place(); }
        if (event.key === "Escape") { event.preventDefault(); this.clear(); }
      });
    });
    this.host.querySelector<HTMLButtonElement>('[data-paint-action="place"]')!.addEventListener("click", () => { this.place(); root.querySelector<HTMLCanvasElement>(".tm-map")!.focus({ preventScroll: true }); });
    this.host.querySelector<HTMLButtonElement>('[data-paint-action="cancel"]')!.addEventListener("click", () => this.clear());
    this.render();
  }
  get pendingRoute(): boolean { return Boolean(this.route); }
  get canNudge(): boolean { return Boolean(this.route || this.hover); }
  get frontPreview(): HTMLCanvasElement | undefined { return this.preview?.canvas; }
  activate(kind: "city" | "route" | undefined): void { this.kind = kind; this.clear(); }
  dispose(): void { this.cancelValidation(); }
  clear(): void {
    this.cancelValidation(); this.route = undefined; this.hover = undefined; this.gesture = undefined; this.preview = undefined; this.fieldError = undefined;
    this.render(); this.options.update();
  }
  invalidate(): void { this.source = undefined; this.sourceFiles = undefined; this.requestPreview(); }
  private snap(point: TownMapPoint) { return snapTownMapPaintPoint(point, this.options.snap()); }
  private cancelValidation() { if (this.validation) clearTimeout(this.validation); this.validation = undefined; }
  private getSource() {
    const graphics = this.options.graphics();
    if (!this.source || this.sourceFiles !== graphics) {
      const image = readTownMapLayer(graphics, FRONT);
      this.source = createTownMapPaintSource(image); this.palette = image.indexed.palette; this.sourceFiles = graphics;
    }
    return this.source;
  }
  private requestPreview() {
    this.cancelValidation(); this.preview = undefined;
    const spec: TownMapPaintSpec | undefined = this.kind === "city" && this.hover ? { kind: "city", size: this.size, center: { ...this.hover } } : this.kind === "route" ? this.route : undefined;
    if (spec && !this.options.busy()) {
      const preview: Preview = { spec: structuredClone(spec) }; this.preview = preview;
      try {
        if (this.fieldError) throw new Error(this.fieldError);
        const source = this.getSource(), patch = createTownMapPaintPatch(source, spec), pixels = source.pixels.slice(); preview.patch = patch;
        for (let row = 0; row < patch.rect.height; row++) pixels.set(patch.pixels.subarray(row * patch.rect.width, (row + 1) * patch.rect.width), (patch.rect.y + row) * 256 + patch.rect.x);
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
        canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(townMapArtworkRgba(pixels, this.palette!)), 256, 256), 0, 0); preview.canvas = canvas;
        preview.checking = true; this.validation = setTimeout(() => { if (this.preview === preview) { this.validate(); this.render(); this.options.update(); } }, 70);
      } catch (error) { preview.error = errorMessage(error); }
    }
    this.render(); this.options.update();
  }
  private validate(): boolean {
    this.cancelValidation(); const preview = this.preview;
    if (!preview?.patch || preview.error || this.options.busy()) return false;
    if (!preview.graphics) {
      try { const prepared = prepareTownMapArtworkPatch(this.options.graphics(), FRONT, preview.patch); preview.graphics = prepared.graphics; preview.tiles = prepared.tiles; }
      catch (error) { preview.error = errorMessage(error); }
    }
    preview.checking = false; return Boolean(preview.graphics && !preview.error);
  }
  private place(): void {
    if (!this.validate()) { this.render(); if (this.preview?.error) this.options.status(this.preview.error, true); return; }
    const graphics = this.preview!.graphics!, city = this.kind === "city" ? this.hover : undefined;
    if (this.options.commit(graphics)) {
      this.clear(); this.source = undefined;
      if (city) { this.hover = city; this.requestPreview(); }
    }
  }
  private editField(input: HTMLInputElement) {
    if (!this.route || this.options.busy()) return;
    const key = input.dataset.routeField!, value = Number(input.value), route = structuredClone(this.route);
    try {
      if (!input.value.trim() || !Number.isFinite(value) || !input.checkValidity()) throw new Error("Enter a valid route coordinate, length or angle.");
      if (key === "x" || key === "y") {
        if (!Number.isInteger(value)) throw new Error("Route coordinates use whole pixels.");
        route.start = this.snap({ ...route.start, [key]: value });
      } else {
        const metrics = townMapRouteMetrics(route);
        route.end = townMapRouteEndpoint(route.start, key === "length" ? value : metrics.length, key === "angle" ? value : metrics.angle, this.options.snap());
      }
      this.fieldError = undefined; this.route = route;
    } catch (error) { this.fieldError = errorMessage(error); }
    this.requestPreview();
  }
  pointerDown(point: TownMapPoint, id: number, canvas: HTMLCanvasElement): boolean {
    if (!this.kind || this.options.busy()) return false;
    point = this.snap(point); this.fieldError = undefined;
    if (this.kind === "city") { this.hover = point; this.requestPreview(); this.place(); return true; }
    const before = this.route ? structuredClone(this.route) : undefined;
    const near = (p: TownMapPoint) => Math.hypot(point.x - p.x, point.y - p.y) <= 4;
    const endpoint = this.route && near(this.route.start) ? "start" : "end";
    if (!this.route || !near(this.route.start) && !near(this.route.end)) this.route = { kind: "route", start: { ...point }, end: { ...point } };
    this.gesture = { id, endpoint, before }; canvas.setPointerCapture(id); this.requestPreview(); return true;
  }
  pointerMove(point: TownMapPoint, id: number): boolean {
    if (!this.kind || this.options.busy()) return false;
    point = this.snap(point);
    if (this.kind === "city") { if (this.hover?.x !== point.x || this.hover.y !== point.y) { this.hover = point; this.requestPreview(); } }
    else if (this.gesture?.id === id && this.route) { this.route[this.gesture.endpoint] = point; this.fieldError = undefined; this.requestPreview(); }
    return true;
  }
  pointerUp(id: number): boolean { if (this.gesture?.id !== id) return false; this.gesture = undefined; this.render(); this.options.update(); return true; }
  pointerCancel(id: number): void {
    if (this.gesture?.id !== id) return;
    this.route = this.gesture.before; this.gesture = undefined; this.fieldError = undefined; this.requestPreview();
  }
  pointerLeave(): void { if (this.kind === "city") { this.hover = undefined; this.requestPreview(); } }
  keyDown(event: KeyboardEvent): boolean {
    if (!this.kind || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key === "Escape") { event.preventDefault(); this.clear(); return true; }
    if (event.key === "Enter") { event.preventDefault(); this.place(); return true; }
    return false;
  }
  nudge(dx: number, dy: number, fast = false): void {
    if (this.options.busy()) return;
    const step = this.options.snap() || fast ? 8 : 1;
    if (this.route) for (const point of [this.route.start, this.route.end]) { point.x += dx * step; point.y += dy * step; }
    else if (this.hover) { this.hover.x += dx * step; this.hover.y += dy * step; }
    this.fieldError = undefined; this.requestPreview();
  }
  render(): void {
    this.host.hidden = !this.kind;
    this.host.querySelector<HTMLElement>(".tm-city-sizes")!.hidden = this.kind !== "city";
    this.host.querySelector<HTMLElement>(".tm-route-options")!.hidden = this.kind !== "route";
    this.host.querySelector<HTMLInputElement>("#tm-paint-snap")!.checked = this.options.snap();
    this.host.querySelectorAll<HTMLButtonElement>("[data-city-size]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.citySize === this.size)));
    const metrics = this.route ? townMapRouteMetrics(this.route) : undefined;
    const values = { x: this.route?.start.x, y: this.route?.start.y, length: metrics ? Number(metrics.length.toFixed(2)) : undefined, angle: metrics ? Number(metrics.angle.toFixed(1)) : undefined };
    this.host.querySelectorAll<HTMLInputElement>("[data-route-field]").forEach(input => {
      input.disabled = !this.route || this.options.busy();
      if (document.activeElement !== input) input.value = String(values[input.dataset.routeField as keyof typeof values] ?? "");
    });
    this.host.querySelector<HTMLButtonElement>('[data-paint-action="place"]')!.disabled = !this.route || !this.preview?.graphics || Boolean(this.preview.error || this.fieldError) || this.options.busy();
    this.host.querySelector<HTMLButtonElement>('[data-paint-action="cancel"]')!.disabled = !this.route || this.options.busy();
    this.host.querySelector<HTMLElement>(".tm-route-end")!.textContent = this.route ? `End ${this.route.end.x}, ${this.route.end.y}` : "";
    const status = this.host.querySelector<HTMLElement>(".tm-paint-status")!, p = this.preview;
    status.textContent = p?.error ?? (p?.checking ? "Checking tiles…" : p?.tiles !== undefined ? `${p.tiles} / ${FRONT.maxTiles} tiles` : this.kind === "city" ? "Click to stamp" : "Drag to draw");
    status.classList.toggle("-error", Boolean(p?.error));
  }
  drawGuides(ctx: CanvasRenderingContext2D): void {
    if (!this.kind || !this.preview) return;
    ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = this.preview.error ? "#ff8888" : "#8be9fd";
    if (this.route) {
      if (this.preview.error) { ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(this.route.start.x, this.route.start.y); ctx.lineTo(this.route.end.x, this.route.end.y); ctx.stroke(); ctx.setLineDash([]); }
      for (const p of [this.route.start, this.route.end]) { ctx.fillStyle = "#18222a"; ctx.fillRect(p.x - 2, p.y - 2, 4, 4); ctx.strokeRect(p.x - 2, p.y - 2, 4, 4); }
    } else if (this.hover) {
      const r = this.preview.patch?.rect ?? { x: this.hover.x - (this.size === "large" ? 6 : 4), y: this.hover.y - (this.size === "large" ? 6 : 4), width: this.size === "large" ? 12 : 8, height: this.size === "large" ? 14 : 10 };
      ctx.setLineDash([2, 2]); ctx.strokeRect(r.x - .5, r.y - .5, r.width + 1, r.height + 1);
    }
    ctx.restore();
  }
}
