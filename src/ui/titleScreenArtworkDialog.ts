import {
  compileTitleArtwork, fitTitleArtworkToScreen, prepareTitleArtwork, titleArtworkDisplaySize, TITLE_ART_HEIGHT, TITLE_ART_SIZE, TITLE_ART_WIDTH,
  type TitleArtPlacement,
} from "../pokeweb/titleScreenArtwork";
import type { TitleScreenDocument } from "../pokeweb/titleScreenModel";
import { compileTitleScene, TITLE_IDLE_START } from "../pokeweb/titleScreenScene";
import { mountTitleSceneRenderer } from "./titleSceneRenderer";

export function openTitleArtworkDialog(
  title: TitleScreenDocument,
  artwork: ReturnType<typeof prepareTitleArtwork>,
  initialPlacement: TitleArtPlacement,
  credits: HTMLCanvasElement,
) {
  const placement = { ...initialPlacement };
  const dialog = document.createElement("dialog");
  dialog.className = "title-png-dialog title-art-dialog";
  dialog.setAttribute("aria-labelledby", "title-art-heading");
  dialog.innerHTML = `<form method="dialog">
    <div class="title-section-header">
      <h2 id="title-art-heading">Static title image</h2>
      <button class="btn -default" value="cancel" aria-label="Close title image editor">✕</button>
    </div>
    <div class="title-art-screen">
      <div class="title-art-backdrop" aria-hidden="true"></div>
      <canvas width="${TITLE_ART_WIDTH}" height="${TITLE_ART_HEIGHT}" aria-label="Converted preview. Drag to position artwork."></canvas>
    </div>
    <div class="title-png-crop-controls">
      <label><span>Horizontal <output for="title-art-x"></output></span><input id="title-art-x" type="range" min="0" max="${TITLE_ART_WIDTH}"></label>
      <label><span>Vertical <output for="title-art-y"></output></span><input id="title-art-y" type="range" min="0" max="${TITLE_ART_HEIGHT}"></label>
      <label><span>Size <output for="title-art-size"></output></span><input id="title-art-size" type="range" min="${TITLE_ART_SIZE.min}" max="${TITLE_ART_SIZE.max}"></label>
    </div>
    ${artwork.texture.quantized ? '<p class="title-muted">Colors reduced to fit the DS palette.</p>' : ""}
    <p class="title-art-error" role="alert" hidden></p>
    <div class="title-toolbar title-png-actions">
      <button class="btn -default" type="button" id="title-art-fit">Fit screen</button>
      <button class="btn -default" value="cancel">Cancel</button>
      <button class="btn -primary" value="apply">Apply image</button>
    </div>
  </form>`;
  const screen = dialog.querySelector<HTMLCanvasElement>(".title-art-screen > canvas")!;
  const source = document.createElement("canvas");
  source.width = artwork.image.width;
  source.height = artwork.image.height;
  const sourceContext = source.getContext("2d"), context = screen.getContext("2d");
  if (!sourceContext || !context) throw new Error("PNG preview requires canvas support.");
  sourceContext.putImageData(new ImageData(new Uint8ClampedArray(artwork.image.rgba), source.width, source.height), 0, 0);
  const controls = (["x", "y", "size"] as const).map((key) => ({
    key,
    input: dialog.querySelector<HTMLInputElement>(`#title-art-${key}`)!,
    output: dialog.querySelector<HTMLOutputElement>(`output[for="title-art-${key}"]`)!,
  }));
  const draw = () => {
    for (const { input, output, key } of controls) {
      input.value = String(placement[key]);
      output.value = `${placement[key]} px`;
    }
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, screen.width, screen.height);
    const { x, y, size } = placement;
    const { width, height } = titleArtworkDisplaySize(source, size);
    context.drawImage(source, x - width / 2, y - height / 2, width, height);
    context.drawImage(credits, 0, 0);
  };
  for (const { input, key } of controls) {
    input.addEventListener("input", () => { placement[key] = input.valueAsNumber; draw(); });
  }
  dialog.querySelector("#title-art-fit")!.addEventListener("click", () => {
    Object.assign(placement, fitTitleArtworkToScreen(source));
    draw();
  });
  let drag: { id: number; clientX: number; clientY: number; x: number; y: number } | undefined;
  screen.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    drag = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: placement.x, y: placement.y };
    screen.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  screen.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const { width, height } = screen.getBoundingClientRect();
    placement.x = Math.max(0, Math.min(screen.width, Math.round(drag.x + (event.clientX - drag.clientX) * screen.width / width)));
    placement.y = Math.max(0, Math.min(screen.height, Math.round(drag.y + (event.clientY - drag.clientY) * screen.height / height)));
    draw();
  });
  screen.addEventListener("lostpointercapture", (event) => { if (drag?.id === event.pointerId) drag = undefined; });

  let imports: Map<string, Uint8Array> | undefined;
  let backdrop: ReturnType<typeof mountTitleSceneRenderer> | undefined;
  const result = new Promise<typeof imports>((resolve) => {
    dialog.addEventListener("close", () => {
      backdrop?.dispose();
      dialog.remove();
      resolve(dialog.returnValue === "apply" ? imports : undefined);
    }, { once: true });
  });
  dialog.addEventListener("submit", (event) => {
    if ((event as SubmitEvent).submitter?.getAttribute("value") !== "apply") return;
    try {
      imports = compileTitleArtwork(title, artwork, placement);
    } catch (error) {
      event.preventDefault();
      const report = dialog.querySelector<HTMLElement>(".title-art-error")!;
      report.textContent = error instanceof Error ? error.message : String(error);
      report.hidden = false;
    }
  });
  document.body.append(dialog);
  dialog.showModal();
  try {
    const scene = compileTitleScene(title);
    backdrop = mountTitleSceneRenderer(dialog.querySelector<HTMLElement>(".title-art-backdrop")!, scene, title.camera, { environmentOnly: true });
    backdrop.draw(Math.min(scene.frameCount - 1, TITLE_IDLE_START));
  } catch {
    // The converted artwork is still editable when WebGL or native scene preview is unavailable.
    backdrop?.dispose();
    dialog.querySelector(".title-art-backdrop")!.replaceChildren();
    backdrop = undefined;
  }
  draw();
  return { result, close: () => { if (dialog.open) dialog.close("cancel"); } };
}
