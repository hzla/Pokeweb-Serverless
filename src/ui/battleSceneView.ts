import { BATTLE_IDLE_CAMERA_EFFECTS, battlePhaseCamera, buildBattleIdleCameraFrames, type BattleSceneCameraMode, type BattleCameraPrograms } from "../pokeweb/battleSceneCamera";
import type { BattleCameraPose, BattleCameraPreset } from "../pokeweb/battleCameraModel";
import type { BattleBackgroundRenderer } from "./battleBackgroundRenderer";

const MODES: Array<[BattleSceneCameraMode, string]> = [["placement", "Placement"], ["sendout", "Send-out"], ["selection", "Move selection"], ["idle", "Idle camera"], ["free", "Free roam"]];

export class BattleSceneView {
  private mode: BattleSceneCameraMode = "placement";
  private host?: HTMLElement;
  private shot = 0;
  private frame = 0;
  private frames?: BattleCameraPose[];
  private playing = false;
  private animation?: number;
  private lastTime?: number;
  private remainder = 0;
  private freePose?: BattleCameraPose;

  constructor(private renderer: () => BattleBackgroundRenderer | undefined, private placement: () => BattleCameraPose,
    private defaults: () => BattleCameraPose, private presets: () => BattleCameraPreset[], private programs: () => BattleCameraPrograms,
    private rule: () => number) {}

  mount(host: HTMLElement): void {
    this.host = host;
    host.innerHTML = `<div class="battle-scene-views" role="group" aria-label="Battle camera view">${MODES.map(([id, label]) => `<button type="button" class="btn -default" data-scene-view="${id}" aria-pressed="${id === this.mode}">${label}</button>`).join("")}</div>
      <div class="battle-scene-idle" data-scene-idle ${this.mode === "idle" ? "" : "hidden"}>
        <select class="filter-input" aria-label="Idle camera shot" data-scene-shot>${BATTLE_IDLE_CAMERA_EFFECTS.map((_, i) => `<option value="${i}" ${i === this.shot ? "selected" : ""}>Shot ${i + 1}</option>`).join("")}</select>
        <button type="button" class="btn -default" data-scene-play>${this.playing ? "Pause" : "Play"}</button>
        <input type="range" min="0" max="1" value="0" aria-label="Idle camera frame" data-scene-frame><span data-scene-time></span>
      </div>
      <div class="battle-scene-free-hint" data-scene-free-hint ${this.mode === "free" ? "" : "hidden"}>Drag: orbit · Shift / right-drag: pan · Scroll: zoom · WASD / arrows: move · Q/E: down/up</div>
      <div class="battle-scene-camera-readout" data-scene-readout></div><div class="battle-environment-status" data-scene-error role="status"></div>`;
    for (const button of host.querySelectorAll<HTMLButtonElement>("[data-scene-view]")) button.addEventListener("click", () => this.select(button.dataset.sceneView as BattleSceneCameraMode));
    host.querySelector("[data-scene-play]")?.addEventListener("click", () => { this.playing = !this.playing; this.lastTime = undefined; this.sync(); this.animate(); });
    host.querySelector("[data-scene-shot]")?.addEventListener("change", event => {
      this.shot = Number((event.target as HTMLSelectElement).value); this.frame = 0; this.frames = undefined; this.apply();
    });
    host.querySelector("[data-scene-frame]")?.addEventListener("input", event => {
      this.playing = false; this.frame = Number((event.target as HTMLInputElement).value); this.apply();
    });
    this.apply();
  }

  usePlacement(): void { this.select("placement"); }

  free(): void {
    this.mode = "free"; this.playing = false; this.sync();
    this.freePose = this.renderer()?.getCameraPose();
  }

  beforeSceneChange(): void { if (this.mode === "free") this.freePose = this.renderer()?.getCameraPose() ?? this.freePose; }
  refresh(): void { this.frames = undefined; this.apply(); }
  moved(pose: BattleCameraPose): void { if (this.mode === "free") { this.freePose = pose; this.readout(pose); } }

  private readout(pose: BattleCameraPose): void {
    const host = this.host?.querySelector<HTMLElement>("[data-scene-readout]");
    const point = (p: BattleCameraPose["position"]) => [p.x, p.y, p.z].map(n => Number(n.toFixed(3))).join(", ");
    if (host) host.textContent = `Position ${point(pose.position)} · Look at ${point(pose.target)}`;
  }

  private select(mode: BattleSceneCameraMode): void {
    if (mode === "free") { this.free(); return; }
    this.mode = mode; this.frame = 0; this.frames = undefined; this.playing = mode === "idle"; this.lastTime = undefined;
    this.apply();
  }

  private apply(): void {
    if (!this.host) return;
    const error = this.host.querySelector<HTMLElement>("[data-scene-error]")!;
    try {
      let pose: BattleCameraPose;
      if (this.mode === "placement") pose = this.placement();
      else if (this.mode === "sendout" || this.mode === "selection") pose = battlePhaseCamera(this.programs(), this.mode, this.defaults(), this.rule());
      else if (this.mode === "free") pose = this.freePose ?? this.placement();
      else {
        const commands = this.programs().get(BATTLE_IDLE_CAMERA_EFFECTS[this.shot]);
        if (!commands) throw new Error("This ROM's idle camera shot is unavailable.");
        this.frames ??= buildBattleIdleCameraFrames(commands, battlePhaseCamera(this.programs(), "selection", this.defaults(), this.rule()), this.defaults(), this.presets(), this.rule());
        this.frame = Math.min(this.frame, this.frames.length - 1); pose = this.frames[this.frame];
      }
      this.renderer()?.setBattleCamera(pose);
      this.readout(pose);
      error.textContent = "";
    } catch (cause) { this.playing = false; error.textContent = cause instanceof Error ? cause.message : String(cause); }
    this.sync(); this.animate();
  }

  private sync(): void {
    if (!this.host) return;
    for (const button of this.host.querySelectorAll<HTMLButtonElement>("[data-scene-view]")) button.setAttribute("aria-pressed", String(button.dataset.sceneView === this.mode));
    this.host.querySelector<HTMLElement>("[data-scene-idle]")!.hidden = this.mode !== "idle";
    this.host.querySelector<HTMLElement>("[data-scene-free-hint]")!.hidden = this.mode !== "free";
    this.host.querySelector<HTMLElement>("[data-scene-play]")!.textContent = this.playing ? "Pause" : "Play";
    const slider = this.host.querySelector<HTMLInputElement>("[data-scene-frame]")!;
    slider.max = String(Math.max(0, (this.frames?.length ?? 1) - 1)); slider.value = String(this.frame);
    this.host.querySelector<HTMLElement>("[data-scene-time]")!.textContent = `Frame ${this.frame} / ${slider.max}`;
    this.host.querySelector<HTMLSelectElement>("[data-scene-shot]")!.value = String(this.shot);
  }

  private animate(): void {
    if (this.animation !== undefined || !this.playing || this.mode !== "idle") return;
    this.animation = requestAnimationFrame(time => {
      this.animation = undefined;
      if (!this.host?.isConnected || !this.playing || this.mode !== "idle") { this.lastTime = undefined; return; }
      this.remainder += this.lastTime === undefined ? 0 : Math.min(100, time - this.lastTime) * 60 / 1000;
      this.lastTime = time;
      const steps = Math.floor(this.remainder); this.remainder -= steps; this.frame += steps;
      if (this.frames && this.frame >= this.frames.length) { this.shot = (this.shot + 1) % BATTLE_IDLE_CAMERA_EFFECTS.length; this.frame = 0; this.frames = undefined; }
      this.apply();
    });
  }
}
