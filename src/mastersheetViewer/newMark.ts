import { ensureGen5RomBytes, gen5RomArchive } from "../pokeweb/gen5UiImages";
import { parseNitroCellEffect } from "../pokeweb/nitroCell";
import type { ProjectState } from "../pokeweb/projectStore";

/**
 * The red "NEW!" that hops beside new items on the game's start menu (ov162 startmenu.c: ARCID_STARTMENU, a/0/3/4,
 * characters 10, palette 11, cells 12, animation 13, auto-animated). The viewer uses it for anything new in a hack.
 * Its frames go into one strip, and a generated keyframe animation steps through them with the game's own timing
 * (frames of 1/60 s).
 */

const ARCHIVE = "a/0/3/4";
const FRAME_RATE = 60;

let installed: Promise<boolean> | undefined;

export function installNewMark(project: ProjectState, host: HTMLElement): Promise<boolean> {
  installed ??= (async () => {
    try {
      if (project.session.baseRom !== "BW2" || !(await ensureGen5RomBytes(project))) return false;
      const files = gen5RomArchive(project, ARCHIVE);
      const effect = parseNitroCellEffect("start-menu-new", 10, 11, 12, 13, files[10]!, files[11]!, files[12]!, files[13]!, { originCentered: false });
      const frames = (effect.sequences[0]?.frames ?? []).filter((frame) => frame.duration > 0);
      if (!frames.length) return false;
      const { width, height } = effect;
      const canvas = document.createElement("canvas");
      canvas.width = width * frames.length;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      frames.forEach((frame, index) => context.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), index * width, 0));
      const url = await new Promise<string>((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("Couldn't draw NEW!."))), "image/png"),
      );
      const total = frames.reduce((sum, frame) => sum + frame.duration, 0);
      let elapsed = 0;
      const steps = frames.map((frame, index) => {
        const at = (elapsed / total) * 100;
        elapsed += frame.duration;
        return `${at.toFixed(3)}% { background-position-x: calc(${-index} * var(--msv-new-w)); }`;
      });
      const style = document.createElement("style");
      style.textContent = `@keyframes msv-new-hop { ${steps.join(" ")} }`;
      document.head.append(style);
      host.style.setProperty("--msv-new-strip", `url("${url}")`);
      host.style.setProperty("--msv-new-frames", String(frames.length));
      host.style.setProperty("--msv-new-px-w", String(width));
      host.style.setProperty("--msv-new-px-h", String(height));
      host.style.setProperty("--msv-new-duration", `${(total / FRAME_RATE).toFixed(3)}s`);
      host.classList.add("-new-mark");
      return true;
    } catch (error) {
      console.warn("The start menu's NEW! couldn't be drawn from the ROM; the viewer writes it instead.", error);
      return false;
    }
  })();
  return installed;
}
