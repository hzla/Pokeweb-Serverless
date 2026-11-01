import type { ProjectState } from "../pokeweb/projectStore";
import type { DescriptionKind } from "../pokeweb/descriptionPreview";
import "../styles/descriptionPreview.css";

export const descriptionPreviewMarkup = `<details class="description-preview" data-description-preview><summary>In-game preview</summary><div data-description-preview-body></div></details>`;

/** No renderer import, ROM resource reads or canvas until the disclosure opens. */
export function installLazyDescriptionPreview(project: ProjectState, root: HTMLDetailsElement, kind: DescriptionKind, text: () => string, name: () => string = () => "") {
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, serial = 0;
  const host = root.querySelector<HTMLElement>("[data-description-preview-body]")!;
  async function paint() {
    if (stopped || !root.open || !root.isConnected) return;
    const current = ++serial;
    if (!host.children.length) host.textContent = "Loading the ROM’s font and Summary graphics…";
    try {
      const model = await import("../pokeweb/descriptionPreview");
      if (stopped || !root.open || !root.isConnected || current !== serial) return;
      const assets = await model.loadDescriptionAssets(project);
      if (stopped || !root.open || !root.isConnected || current !== serial) return;
      const result = model.renderDescriptionPreview(assets, kind, text(), name());
      let canvas = host.querySelector("canvas");
      if (!canvas) {
        host.replaceChildren();
        canvas = document.createElement("canvas");
        canvas.setAttribute("aria-label", `${kind === "move" ? "Move" : "Ability"} description in the ROM’s game font`);
        canvas.setAttribute("role", "img");
        const status = document.createElement("p"); status.className = "description-preview-warnings"; status.setAttribute("role", "status");
        host.append(canvas, status);
      }
      canvas.width = result.width; canvas.height = result.height; canvas.style.width = `${result.width * 2}px`;
      const context = canvas.getContext("2d");
      if (!context) throw Error("Canvas rendering is unavailable.");
      const image = context.createImageData(result.width, result.height); image.data.set(result.rgba); context.putImageData(image, 0, 0);
      host.querySelector("p")!.textContent = result.warnings.join(" ");
    } catch (error) {
      if (!stopped && root.open && root.isConnected && current === serial) host.textContent = error instanceof Error ? error.message : String(error);
    }
  }
  const refresh = () => {
    if (timer) clearTimeout(timer);
    ++serial;
    if (!stopped && root.open && root.isConnected) timer = setTimeout(() => { timer = undefined; void paint(); }, 100);
  };
  const toggle = () => { if (root.open) void paint(); else { ++serial; if (timer) clearTimeout(timer); } };
  root.addEventListener("toggle", toggle);
  if (root.open) void paint();
  return { refresh, destroy: () => { stopped = true; ++serial; if (timer) clearTimeout(timer); root.removeEventListener("toggle", toggle); } };
}
