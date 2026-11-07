import { publicAsset } from "../assetUrl";
import { loadActiveRomBytes } from "../pokeweb/persistence";
import type { ProjectState } from "../pokeweb/projectStore";
import type { RgbaImageData } from "../pokeweb/pokemonSpriteModel";
import type { ItemSpriteLibrary } from "../pokeweb/itemSpriteLibrary";

export function renderItemSpriteEditor(): string {
  return `<div class="it-sprite-editor"><div class="section-bar">Item sprite</div>
    <div class="it-sprite-layout"><canvas data-item-sprite-preview width="32" height="32" aria-label="Item sprite preview"></canvas>
    <div class="it-sprite-controls"><label>Import image <input data-item-sprite-file type="file" accept="image/png,image/webp,image/gif,image/jpeg"></label>
      <button type="button" class="btn -default" data-item-sprite-library-load>Load sprite library</button>
      <div class="it-sprite-position"><label>X <input data-item-sprite-x type="number" min="-32" max="32" value="0"></label><label>Y <input data-item-sprite-y type="number" min="-32" max="32" value="0"></label></div>
      <label><input data-item-sprite-key type="checkbox"> Transparent top-left color</label>
      <button type="button" class="btn -default" data-item-sprite-apply disabled>Apply sprite</button>
      <div data-item-sprite-status role="status"></div></div></div>
    <section data-item-sprite-library hidden aria-label="Sprite library">
      <div class="it-sprite-library-filters"><input type="search" data-item-sprite-search aria-label="Search sprites" placeholder="Search sprites">
        <select data-item-sprite-source aria-label="Sprite source"><option value="all">All sources</option><option value="emerald">pokeemerald-expansion</option><option value="hg">hg-engine</option></select></div>
      <div class="it-sprite-library-grid" data-item-sprite-grid></div>
      <div class="it-sprite-library-pages"><button type="button" class="btn -default" data-item-sprite-prev>Previous</button><span data-item-sprite-page></span><button type="button" class="btn -default" data-item-sprite-next>Next</button></div>
    </section>
    <p class="it-sprite-credits">Sprite credits: <a href="https://github.com/rh-hideout/pokeemerald-expansion/blob/master/CREDITS.md" target="_blank" rel="noopener noreferrer">pokeemerald-expansion</a> · <a href="${publicAsset("data/item-sprite-hg-credits.txt")}" target="_blank" rel="noopener noreferrer">hg-engine</a> (<a href="https://github.com/BluRosie/hg-engine/blob/main/README.md#disclaimer" target="_blank" rel="noopener noreferrer">noncommercial use terms</a>)</p></div>`;
}

/** Heavy ROM and image codecs are loaded only when this tab is opened. */
export function installItemSpriteEditor(root: HTMLElement, project: ProjectState, itemId: number, onDirty?: () => void): void {
  const canvas = root.querySelector<HTMLCanvasElement>("[data-item-sprite-preview]"); if (!canvas) return;
  const file = root.querySelector<HTMLInputElement>("[data-item-sprite-file]")!, x = root.querySelector<HTMLInputElement>("[data-item-sprite-x]")!, y = root.querySelector<HTMLInputElement>("[data-item-sprite-y]")!, key = root.querySelector<HTMLInputElement>("[data-item-sprite-key]")!, apply = root.querySelector<HTMLButtonElement>("[data-item-sprite-apply]")!, status = root.querySelector<HTMLElement>("[data-item-sprite-status]")!;
  const loadButton = root.querySelector<HTMLButtonElement>("[data-item-sprite-library-load]")!, librarySection = root.querySelector<HTMLElement>("[data-item-sprite-library]")!, search = root.querySelector<HTMLInputElement>("[data-item-sprite-search]")!, sourceFilter = root.querySelector<HTMLSelectElement>("[data-item-sprite-source]")!, grid = root.querySelector<HTMLElement>("[data-item-sprite-grid]")!, prev = root.querySelector<HTMLButtonElement>("[data-item-sprite-prev]")!, next = root.querySelector<HTMLButtonElement>("[data-item-sprite-next]")!, pageLabel = root.querySelector<HTMLElement>("[data-item-sprite-page]")!;
  let source: RgbaImageData | undefined, library: ItemSpriteLibrary | undefined, page = 0, imageRequest = 0;
  const draw = (image: RgbaImageData) => { const ctx = canvas.getContext("2d"); if (!ctx) throw Error("Canvas is unavailable."); const data = ctx.createImageData(image.width, image.height); data.data.set(image.pixels); ctx.putImageData(data, 0, 0); };
  const bytes = async () => { const result = project.originalRomBytes ?? await loadActiveRomBytes(); if (!result) throw Error("Reload the ROM to edit item sprites."); return result; };
  const error = (e: unknown) => { status.textContent = e instanceof Error ? e.message : String(e); };
  const update = async () => { if (!source) return; try { const model = await import("../pokeweb/itemSpriteModel"); if (!canvas.isConnected) return; draw(model.prepareItemSprite(source, Number(x.value), Number(y.value), key.checked).image); status.textContent = ""; } catch (e) { error(e); } };
  const selectImage = async (input: Blob) => {
    const request = ++imageRequest, bitmap = await createImageBitmap(input);
    try {
      if (request !== imageRequest || !canvas.isConnected) return;
      const scale = Math.min(1, 32 / bitmap.width, 32 / bitmap.height), width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
      const scratch = document.createElement("canvas"); scratch.width = width; scratch.height = height; const ctx = scratch.getContext("2d"); if (!ctx) throw Error("Canvas is unavailable."); ctx.imageSmoothingEnabled = false; ctx.drawImage(bitmap, 0, 0, width, height);
      const img = ctx.getImageData(0, 0, width, height); source = { width, height, pixels: img.data }; x.value = String(Math.floor((32 - width) / 2)); y.value = String(Math.floor((32 - height) / 2));
      key.checked = !Array.from({ length: width * height }, (_, i) => img.data[i * 4 + 3]).some(alpha => alpha < 128); apply.disabled = false; await update();
    } finally { bitmap.close(); }
  };
  const drawLibrary = () => {
    if (!library) return;
    grid.replaceChildren();
    const normalize = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/gu, "");
    const query = normalize(search.value), matching = library.entries.filter(entry => (sourceFilter.value === "all" || entry.source === sourceFilter.value) && normalize(entry.name).includes(query));
    const pages = Math.max(1, Math.ceil(matching.length / 48)); page = Math.max(0, Math.min(page, pages - 1));
    prev.disabled = page === 0; next.disabled = page >= pages - 1; pageLabel.textContent = `${matching.length} sprites · ${page + 1} / ${pages}`;
    for (const entry of matching.slice(page * 48, page * 48 + 48)) {
      const data = library.files[entry.path], blob = new Blob([new Uint8Array(data)], { type: "image/png" });
      const button = document.createElement("button"), img = document.createElement("img"), name = document.createElement("span");
      button.type = "button"; button.className = "it-sprite-library-item"; button.title = `${entry.name} · ${entry.source === "hg" ? "hg-engine" : "pokeemerald-expansion"}`; button.setAttribute("aria-label", button.title);
      img.src = `data:image/png;base64,${btoa(Array.from(data, byte => String.fromCharCode(byte)).join(""))}`; img.alt = ""; img.loading = "lazy"; name.textContent = entry.name; button.append(img, name);
      button.addEventListener("click", () => { void selectImage(blob).catch(error); }); grid.append(button);
    }
  };
  void (async () => { try { const model = await import("../pokeweb/itemSpriteModel"), rom = await bytes(); if (!canvas.isConnected || source) return; draw(model.readItemSprite(project, rom, itemId)); } catch (e) { error(e); } })();
  file.addEventListener("change", () => { const input = file.files?.[0]; if (input) void selectImage(input).catch(error); });
  loadButton.addEventListener("click", () => { void (async () => { try { loadButton.disabled = true; const module = await import("../pokeweb/itemSpriteLibrary"); library = await module.loadItemSpriteLibrary(); if (!canvas.isConnected) return; librarySection.hidden = false; loadButton.remove(); drawLibrary(); } catch (e) { error(e); } finally { loadButton.disabled = false; } })(); });
  for (const input of [search, sourceFilter]) input.addEventListener("input", () => { page = 0; drawLibrary(); });
  prev.addEventListener("click", () => { page--; drawLibrary(); }); next.addEventListener("click", () => { page++; drawLibrary(); });
  for (const input of [x, y, key]) input.addEventListener("input", () => { void update(); });
  apply.addEventListener("click", () => { void (async () => { if (!source) return; try { apply.disabled = true; const model = await import("../pokeweb/itemSpriteModel"); model.writeItemSprite(project, await bytes(), itemId, source, Number(x.value), Number(y.value), key.checked); onDirty?.(); status.textContent = "Sprite applied."; } catch (e) { error(e); } finally { apply.disabled = false; } })(); });
}
