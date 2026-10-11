import { PwanGifImportSession, type PwanGifImportSource } from "../pokeweb/pwanGifImportSession";
import { pwanFrameRgbaImage, pwanTimeline, type PwanColorPreset, type PwanCompileResult } from "../pokeweb/pwanCompiler";
import { escapeHtml } from "./dom";

export function renderPwanGifImportPreview(key: string, preset: PwanColorPreset = "none"): string {
  return `<div class="pwan-conversion" data-pwan-conversion="${escapeHtml(key)}">
    <label class="pwan-conversion-preset"><span>Color preset</span>
      <select data-conversion-preset aria-label="GIF color preset">
        <option value="none" ${preset === "none" ? "selected" : ""}>Original colors (default)</option>
        <option value="gen5" ${preset === "gen5" ? "selected" : ""}>Gen 5-inspired · saturation +15%, contrast +10%</option>
      </select>
    </label>
    <p class="pwan-conversion-hint">Pixel-preserving resize · 15 visible colors + transparency · no dithering. The preset is optional, not a reconstruction of the original artwork.</p>
    <div class="pwan-conversion-images" data-conversion-images hidden>
      <figure><figcaption>Before · source, pixel-resized</figcaption><canvas width="96" height="96" data-conversion-before aria-label="Original GIF frame"></canvas></figure>
      <figure><figcaption>After · game palette</figcaption><canvas width="96" height="96" data-conversion-after aria-label="Converted 15-color frame"></canvas></figure>
    </div>
    <div class="pwan-conversion-playback" data-conversion-playback hidden>
      <button class="btn -default" data-conversion-play type="button">Pause</button>
      <label>Frame <span data-conversion-frame>1 / 1</span><input data-conversion-slider type="range" min="0" max="0" value="0" aria-label="GIF comparison frame"></label>
    </div>
    <div class="pwan-conversion-status" data-conversion-status role="status" aria-live="polite">Choose a GIF to compare before applying.</div>
    <ul class="pwan-conversion-warnings" data-conversion-warnings hidden></ul>
  </div>`;
}

/** Shared by Pokémon front/back and trainer importers, regardless of ROM backend. */
export function installPwanGifImportPreview(root: HTMLElement, key: string, options: {
  colorPreset?: PwanColorPreset;
  source?: PwanGifImportSource;
  result?: PwanCompileResult;
  onChange?: (session: PwanGifImportSession) => void;
} = {}): PwanGifImportSession {
  const container = root.querySelector<HTMLElement>(`[data-pwan-conversion="${key}"]`);
  if (!container) throw new Error("Missing GIF conversion preview");
  const before = container.querySelector<HTMLCanvasElement>("[data-conversion-before]")!;
  const after = container.querySelector<HTMLCanvasElement>("[data-conversion-after]")!;
  const slider = container.querySelector<HTMLInputElement>("[data-conversion-slider]")!;
  const play = container.querySelector<HTMLButtonElement>("[data-conversion-play]")!;
  let currentFrame = 0;
  let playing = true;
  let raf: number | undefined;
  let startTime: number | undefined;
  let timeline: ReturnType<typeof pwanTimeline> = [];
  const converted = new Map<number, ReturnType<typeof pwanFrameRgbaImage>>();
  const session = new PwanGifImportSession({ ...options, onChange: () => {
    if (!container.isConnected) { stop(); return; }
    render();
    options.onChange?.(session);
  } });

  function stop(): void {
    if (raf !== undefined) cancelAnimationFrame(raf);
    raf = undefined;
    startTime = undefined;
  }

  function draw(): void {
    const result = session.result;
    const source = result?.previewFrames?.[currentFrame];
    const entry = timeline[currentFrame];
    if (!source || !entry || !result) return;
    const image = converted.get(entry.frameIndex) ?? pwanFrameRgbaImage(result.pwanBytes, entry.frameIndex);
    converted.set(entry.frameIndex, image);
    before.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(source.pixels), source.width, source.height), 0, 0);
    after.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
    slider.value = String(currentFrame);
    container!.querySelector<HTMLElement>("[data-conversion-frame]")!.textContent = `${currentFrame + 1} / ${timeline.length}`;
  }

  function tick(time: number): void {
    raf = undefined;
    // Detached editors must not leave playback loops running.
    if (!container!.isConnected || !playing || session.busy || !session.result) return;
    startTime ??= time;
    let elapsed = ((time - startTime) * 60 / 1000) % session.result.totalTicks;
    let index = 0;
    while (index < timeline.length - 1 && elapsed >= timeline[index]!.ticks) elapsed -= timeline[index++]!.ticks;
    if (index !== currentFrame) { currentFrame = index; draw(); }
    raf = requestAnimationFrame(tick);
  }

  function render(): void {
    stop();
    converted.clear();
    timeline = session.result ? pwanTimeline(session.result.pwanBytes) : [];
    // Keep the selected comparison frame while a preset is being recompiled.
    if (timeline.length) currentFrame = Math.min(currentFrame, timeline.length - 1);
    const ready = Boolean(session.ready());
    container!.querySelector<HTMLElement>("[data-conversion-images]")!.hidden = !ready;
    container!.querySelector<HTMLElement>("[data-conversion-playback]")!.hidden = !ready;
    slider.max = String(Math.max(0, timeline.length - 1));
    slider.disabled = timeline.length < 2;
    play.disabled = timeline.length < 2;
    play.textContent = playing ? "Pause" : "Play";
    const status = container!.querySelector<HTMLElement>("[data-conversion-status]")!;
    status.classList.toggle("-error", Boolean(session.error));
    const info = session.result?.conversion;
    status.textContent = session.error ?? (session.busy ? "Preparing comparison…" : info
      ? `${session.source!.fileName}: ${info.sourceColorCount} source colors → ${info.visibleColorCount}/15 game colors · ${info.colorPreset === "gen5" ? "Gen 5-inspired" : "Original colors"}. Preview only until applied.`
      : "Choose a GIF to compare before applying.");
    const warnings = container!.querySelector<HTMLElement>("[data-conversion-warnings]")!;
    warnings.hidden = !session.result?.warnings.length;
    warnings.innerHTML = session.result?.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("") ?? "";
    if (ready) {
      draw();
      if (playing && timeline.length > 1) {
        const offsetTicks = timeline.slice(0, currentFrame).reduce((sum, entry) => sum + entry.ticks, 0);
        startTime = performance.now() - offsetTicks * 1000 / 60;
        raf = requestAnimationFrame(tick);
      }
    }
  }

  container.querySelector<HTMLSelectElement>("[data-conversion-preset]")!.addEventListener("change", (event) => {
    void session.setPreset((event.currentTarget as HTMLSelectElement).value as PwanColorPreset);
  });
  slider.addEventListener("input", () => {
    playing = false;
    stop();
    play.textContent = "Play";
    currentFrame = Number(slider.value);
    draw();
  });
  play.addEventListener("click", () => {
    playing = !playing;
    stop();
    play.textContent = playing ? "Pause" : "Play";
    if (playing) {
      const offsetTicks = timeline.slice(0, currentFrame).reduce((sum, entry) => sum + entry.ticks, 0);
      startTime = performance.now() - offsetTicks * 1000 / 60;
      raf = requestAnimationFrame(tick);
    }
  });
  render();
  return session;
}
