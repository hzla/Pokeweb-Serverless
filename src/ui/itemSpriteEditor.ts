import { loadActiveRomBytes } from "../pokeweb/persistence";
import type { ProjectState } from "../pokeweb/projectStore";
import type { RgbaImageData } from "../pokeweb/pokemonSpriteModel";

export function renderItemSpriteEditor(): string {
  return `<div class="it-sprite-editor"><div class="section-bar">Item sprite</div>
    <div class="it-sprite-layout"><canvas data-item-sprite-preview width="32" height="32" aria-label="Item sprite preview"></canvas>
    <div class="it-sprite-controls"><label>Import image <input data-item-sprite-file type="file" accept="image/png,image/webp,image/gif,image/jpeg"></label>
      <div class="it-sprite-position"><label>X <input data-item-sprite-x type="number" min="-32" max="32" value="0"></label><label>Y <input data-item-sprite-y type="number" min="-32" max="32" value="0"></label></div>
      <label><input data-item-sprite-key type="checkbox"> Transparent top-left color</label>
      <button type="button" class="btn -default" data-item-sprite-apply disabled>Apply sprite</button>
      <div data-item-sprite-status role="status"></div></div></div></div>`;
}

/** Heavy ROM and image codecs are loaded only when this tab is opened. */
export function installItemSpriteEditor(root: HTMLElement, project: ProjectState, itemId: number, onDirty?: () => void): void {
  const canvas = root.querySelector<HTMLCanvasElement>("[data-item-sprite-preview]"); if (!canvas) return;
  const file = root.querySelector<HTMLInputElement>("[data-item-sprite-file]")!, x = root.querySelector<HTMLInputElement>("[data-item-sprite-x]")!, y = root.querySelector<HTMLInputElement>("[data-item-sprite-y]")!, key = root.querySelector<HTMLInputElement>("[data-item-sprite-key]")!, apply = root.querySelector<HTMLButtonElement>("[data-item-sprite-apply]")!, status = root.querySelector<HTMLElement>("[data-item-sprite-status]")!;
  let source: RgbaImageData | undefined;
  const draw = (image: RgbaImageData) => { const ctx = canvas.getContext("2d"); if (!ctx) throw Error("Canvas is unavailable."); const data = ctx.createImageData(image.width, image.height); data.data.set(image.pixels); ctx.putImageData(data, 0, 0); };
  const bytes = async () => { const result = project.originalRomBytes ?? await loadActiveRomBytes(); if (!result) throw Error("Reload the ROM to edit item sprites."); return result; };
  const error = (e: unknown) => { status.textContent = e instanceof Error ? e.message : String(e); };
  const update = async () => { if (!source) return; try { const model = await import("../pokeweb/itemSpriteModel"); if (!canvas.isConnected) return; draw(model.prepareItemSprite(source, Number(x.value), Number(y.value), key.checked).image); status.textContent = ""; } catch (e) { error(e); } };
  void (async () => { try { const model = await import("../pokeweb/itemSpriteModel"), rom = await bytes(); if (!canvas.isConnected || source) return; draw(model.readItemSprite(project, rom, itemId)); } catch (e) { error(e); } })();
  file.addEventListener("change", () => { void (async () => { try {
    const input = file.files?.[0]; if (!input) return; const bitmap = await createImageBitmap(input);
    try {
      const scale = Math.min(1, 32 / bitmap.width, 32 / bitmap.height), width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
      const scratch = document.createElement("canvas"); scratch.width = width; scratch.height = height; const ctx = scratch.getContext("2d"); if (!ctx) throw Error("Canvas is unavailable."); ctx.imageSmoothingEnabled = false; ctx.drawImage(bitmap, 0, 0, width, height);
      const img = ctx.getImageData(0, 0, width, height); source = { width, height, pixels: img.data }; x.value = String(Math.floor((32 - width) / 2)); y.value = String(Math.floor((32 - height) / 2));
      key.checked = !Array.from({ length: width * height }, (_, i) => img.data[i * 4 + 3]).some(alpha => alpha < 128); apply.disabled = false; await update();
    } finally { bitmap.close(); }
  } catch (e) { apply.disabled = true; error(e); } })(); });
  for (const input of [x, y, key]) input.addEventListener("input", () => { void update(); });
  apply.addEventListener("click", () => { void (async () => { if (!source) return; try { apply.disabled = true; const model = await import("../pokeweb/itemSpriteModel"); model.writeItemSprite(project, await bytes(), itemId, source, Number(x.value), Number(y.value), key.checked); onDirty?.(); status.textContent = "Sprite applied."; } catch (e) { error(e); } finally { apply.disabled = false; } })(); });
}
