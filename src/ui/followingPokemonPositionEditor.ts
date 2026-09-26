import { readU16, readU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { decodeBtxImage, type BtxImage } from "../pokeweb/btxModel";
import { FOLLOWER_DIRECTIONS, FOLLOWER_MAX_DIRECTIONAL_GAP, followerDefaultDirectionalGaps, followerKey, followerLandAnchorDefaults, followerPreview, type FollowerAssetEntry } from "../pokeweb/followingPokemonModel";
import { followerSurfKey, type FollowerRiderAdjustments } from "../pokeweb/followingPokemonPositioning";
import { followerProfile, readFollowingFile, updateFollowerPositioning, type FollowerAssetWorkspace, type FollowerRom } from "../pokeweb/followingPokemonProject";
import type { ProjectState } from "../pokeweb/projectStore";
import { pokemonSpeciesLabel } from "../pokeweb/pokemonLabels";
import { escapeHtml } from "./dom";

const landRiderUrl = new URL("../assets/following/land-riders.narc", import.meta.url);
const surfUrls = {
  registry: new URL("../assets/following/surf-registry.bin", import.meta.url),
  artwork: new URL("../assets/following/surf-mounts.narc", import.meta.url),
  upgradeRegistry: new URL("../assets/following/white2upgrade/surf-registry.bin", import.meta.url),
  upgradeArtwork: new URL("../assets/following/white2upgrade/surf-mounts.narc", import.meta.url),
};
type Mode = "walking" | "land" | "surf";
type Nudge = "up" | "down" | "left" | "right";
type SurfEntry = { key: string; species: number; form: number; gender: number; shiny: number; member: number };
type PreviewFrame = { image: HTMLCanvasElement; width: number; height: number };
const zeroRider = (): FollowerRiderAdjustments => [[0, 0], [0, 0], [0, 0], [0, 0]];
function frameCanvas(frame: BtxImage): PreviewFrame {
  const image = document.createElement("canvas"); image.width = frame.width; image.height = frame.height;
  image.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
  return { image, width: frame.width, height: frame.height };
}
function paint(ctx: CanvasRenderingContext2D, frame: PreviewFrame, x: number, y: number): void {
  ctx.drawImage(frame.image, Math.round(x - frame.width / 2), Math.round(y - frame.height / 2));
}
/** Read one NARC member without allocating copies of the full Surf catalog. */
function memberAt(narc: Uint8Array, index: number): Uint8Array {
  if (narc.length < 52 || String.fromCharCode(...narc.subarray(0, 4)) !== "NARC") throw new Error("Invalid Surf archive.");
  const count = readU32(narc, 0x18), fnt = 0x10 + readU32(narc, 0x14);
  if (index < 0 || index >= count || fnt + 8 > narc.length) throw new Error("Surf frame is outside the archive.");
  const raw = fnt + readU32(narc, fnt + 4) + 8, start = readU32(narc, 0x1c + index * 8), end = readU32(narc, 0x20 + index * 8);
  if (end < start || raw + end > narc.length) throw new Error("Invalid Surf frame bounds.");
  return narc.subarray(raw + start, raw + end);
}
function listSurf(registry: Uint8Array): SurfEntry[] {
  if (registry.length < 16 || readU32(registry, 0) !== 0x4d535746 || readU16(registry, 4) !== 2 ||
      registry.length !== 16 + readU16(registry, 8) * 8) throw new Error("Invalid Surf appearance list.");
  return Array.from({ length: readU16(registry, 8) }, (_, i) => {
    const at = 16 + i * 8, species = readU16(registry, at), form = registry[at + 2], gender = registry[at + 3], shiny = registry[at + 4];
    return { key: followerSurfKey(species, form, gender, shiny), species, form, gender, shiny, member: readU16(registry, at + 6) };
  });
}

export function createFollowerPositionEditor(args: {
  root: HTMLElement; project: ProjectState; rom: FollowerRom;
  allowRiding: boolean;
  workspace: () => FollowerAssetWorkspace; entry: () => FollowerAssetEntry | undefined;
  followerResource: (entry: FollowerAssetEntry) => Uint8Array;
  playerResource: (member: number) => Uint8Array;
  navigateFollower: (step: -1 | 1) => void;
  changed: (workspace: FollowerAssetWorkspace) => void;
}): { refresh: () => void; destroy: () => void } {
  const { root, project, rom } = args;
  let mode: Mode = "walking", gender: 0 | 1 = 0, tick = 0, surfEntries: SurfEntry[] = [], surfArt: Uint8Array | undefined;
  let surfKey = "", surfFilter = "", currentLand = "", error = "";
  let gaps: [number, number, number, number] = [0, 0, 0, 0], landOffsets = zeroRider(), surfOffsets = zeroRider();
  let followerFrames: PreviewFrame[][] = [], walkerFrames: PreviewFrame[][] = [], seatedFrames: PreviewFrame[][] = [];
  let landRiderFrames: PreviewFrame[][] = [], surfFrames: PreviewFrame[][] = [];
  let landDefault: number[] = [], timer: ReturnType<typeof setInterval> | undefined;
  const section = document.createElement("section"); section.className = "following-position-editor";
  section.innerHTML = `<header><div><span class="following-editor-kicker">Appearance positioning</span><h3>${args.allowRiding ? "Walking gap &amp; rider placement" : "Walking gap"}</h3>
    <p>Edit one appearance at a time. The four previews animate together as values change; the game camera may show a slightly different pixel scale.</p></div>
    <div class="following-position-nav"><span data-position-current></span><div>
      <button class="btn" type="button" data-position-prev>← Previous</button>
      <button class="btn" type="button" data-position-next>Next →</button>
    </div></div></header>
    <div class="following-position-modes" role="tablist" aria-label="Position preview">
      <button type="button" class="btn is-active" data-position-mode="walking" aria-selected="true">Walking follower</button>
      <button type="button" class="btn" data-position-mode="land" aria-selected="false">Land mount</button>
      <button type="button" class="btn" data-position-mode="surf" aria-selected="false">Surf mount</button></div>
    <div class="following-position-options"><label data-position-surf-select hidden>Surf appearance <select></select></label>
      <label data-position-surf-filter hidden>Filter species # <input type="number" min="1" max="1023" placeholder="All"></label>
      <label data-position-gender>Player <select><option value="0">Male</option><option value="1">Female</option></select></label></div>
    <div class="following-position-preview" data-position-canvases></div>
    <div class="following-position-fields" data-position-fields></div>
    <div class="following-position-actions"><button class="btn -primary" type="button" data-position-save>Save positioning</button>
      <span data-position-status role="status"></span></div>`;
  root.append(section);
  if (!args.allowRiding) {
    section.querySelector<HTMLElement>('[data-position-mode="land"]')!.hidden = true;
    section.querySelector<HTMLElement>('[data-position-mode="surf"]')!.hidden = true;
  }
  const canvases = section.querySelector<HTMLElement>("[data-position-canvases]")!;
  const fields = section.querySelector<HTMLElement>("[data-position-fields]")!;
  const status = section.querySelector<HTMLElement>("[data-position-status]")!;
  const surfSelect = section.querySelector<HTMLSelectElement>("[data-position-surf-select] select")!;
  const surfFilterInput = section.querySelector<HTMLInputElement>("[data-position-surf-filter] input")!;
  const save = section.querySelector<HTMLButtonElement>("[data-position-save]")!;
  const navTitle = section.querySelector<HTMLElement>("[data-position-current]")!;
  const previous = section.querySelector<HTMLButtonElement>("[data-position-prev]")!;
  const next = section.querySelector<HTMLButtonElement>("[data-position-next]")!;
  const previews = FOLLOWER_DIRECTIONS.map((direction, index) => {
    const figure = document.createElement("figure");
    figure.innerHTML = `<div class="following-position-frame">
      <button type="button" data-position-nudge="${index}:up">↑</button>
      <button type="button" data-position-nudge="${index}:left">←</button>
      <canvas width="160" height="152" aria-label="${direction} position preview"></canvas>
      <button type="button" data-position-nudge="${index}:right">→</button>
      <button type="button" data-position-nudge="${index}:down">↓</button>
      </div><figcaption>${direction}</figcaption>`;
    canvases.append(figure); return figure.querySelector("canvas")!;
  });
  function walkingNudge(direction: number, arrow: Nudge): number {
    return direction === 0 ? arrow === "down" ? 1 : arrow === "up" ? -1 : 0
      : direction === 1 ? arrow === "up" ? 1 : arrow === "down" ? -1 : 0
      : direction === 2 ? arrow === "right" ? 1 : arrow === "left" ? -1 : 0
      : arrow === "left" ? 1 : arrow === "right" ? -1 : 0;
  }
  function updateNudgeControls(): void {
    section.querySelectorAll<HTMLButtonElement>("[data-position-nudge]").forEach(button => {
      const [indexText, arrowText] = button.dataset.positionNudge!.split(":");
      const index = Number(indexText), arrow = arrowText as Nudge;
      const delta = walkingNudge(index, arrow);
      button.hidden = mode === "walking" && !delta;
      const value = mode === "walking" ? gaps[index] : (mode === "land" ? landOffsets : surfOffsets)[index][arrow === "left" || arrow === "right" ? 0 : 1];
      const step = mode === "walking" ? delta : arrow === "left" || arrow === "up" ? -1 : 1;
      button.disabled = value + step < (mode === "walking" ? 0 : -32) || value + step > (mode === "walking" ? FOLLOWER_MAX_DIRECTIONAL_GAP : 32);
      button.setAttribute("aria-label", mode === "walking"
        ? `${step > 0 ? "Increase" : "Decrease"} ${FOLLOWER_DIRECTIONS[index]} follower gap`
        : `Move ${FOLLOWER_DIRECTIONS[index]} rider ${arrow} one unit`);
      button.title = button.getAttribute("aria-label")!;
    });
  }
  function loadPlayer(): void {
    if (walkerFrames.length) return;
    walkerFrames = [209, 218].map(member => FOLLOWER_DIRECTIONS.map((_, direction) =>
      [0, 1, 2].map(pose => frameCanvas(decodeBtxImage(args.playerResource(member), direction * 3 + pose, 0, "linear")))).flat());
    seatedFrames = [211, 220].map(member => FOLLOWER_DIRECTIONS.map((_, direction) =>
      frameCanvas(decodeBtxImage(args.playerResource(member), direction, 0, "linear"))));
  }
  async function loadLandRider(): Promise<void> {
    if (landRiderFrames.length) return;
    const response = await fetch(landRiderUrl); if (!response.ok) throw new Error("Land rider artwork is unavailable.");
    const frames = new NARC(new Uint8Array(await response.arrayBuffer())).files;
    landRiderFrames = [0, 1].map(sex => Array.from({ length: 12 }, (_, i) => frameCanvas(decodeBtxImage(frames[sex * 12 + i], 0, 0, "linear"))));
  }
  async function loadSurf(): Promise<void> {
    if (surfArt) return;
    const upgrade = await followerProfile(project, rom) === "white2upgrade";
    const installedRegistry = readFollowingFile(project, rom, "following/surf-registry.bin");
    const installedArt = readFollowingFile(project, rom, "following/surf-mounts.narc");
    const registry = installedRegistry ?? new Uint8Array(await (await fetch(upgrade ? surfUrls.upgradeRegistry : surfUrls.registry)).arrayBuffer());
    surfArt = installedArt ?? new Uint8Array(await (await fetch(upgrade ? surfUrls.upgradeArtwork : surfUrls.artwork)).arrayBuffer());
    surfEntries = listSurf(registry);
    surfKey = surfEntries[0]?.key ?? "";
    surfOptions();
    refreshSurf();
  }
  function surfOptions(): void {
    const matches = surfEntries.filter(entry => !surfFilter || entry.species === Number(surfFilter));
    surfSelect.innerHTML = matches.map(entry => `<option value="${escapeHtml(entry.key)}">${escapeHtml(pokemonSpeciesLabel(project, entry.species))} #${entry.species} · form ${entry.form} · ${entry.gender === 255 ? "any gender" : entry.gender === 1 ? "female" : "male"} · ${entry.shiny ? "shiny" : "normal"}</option>`).join("");
    if (matches.some(entry => entry.key === surfKey)) surfSelect.value = surfKey;
    else surfKey = surfSelect.value;
    updateNavigation();
  }
  function updateNavigation(): void {
    const surfEntry = mode === "surf" ? surfEntries.find(candidate => candidate.key === surfKey) : undefined;
    const landEntry = mode === "surf" ? undefined : args.entry();
    const species = surfEntry?.species ?? landEntry?.key.species;
    const noun = mode === "surf" ? "Surf" : "Follower";
    const form = surfEntry?.form ?? landEntry?.key.form ?? 0;
    const gender = surfEntry?.gender ?? landEntry?.key.gender;
    const shiny = surfEntry?.shiny ?? Number(landEntry?.key.shiny ?? false);
    const variant = [form ? `form ${form}` : "", gender === 1 ? "female" : "", shiny ? "shiny" : ""].filter(Boolean).join(" · ");
    navTitle.textContent = species === undefined ? `No ${noun.toLowerCase()} appearance selected` :
      `${noun}: ${pokemonSpeciesLabel(project, species)} #${species}${variant ? ` · ${variant}` : ""}`;
    previous.disabled = next.disabled = mode === "surf" ? !surfSelect.options.length : species === undefined;
    previous.setAttribute("aria-label", `Previous ${noun.toLowerCase()} appearance`);
    next.setAttribute("aria-label", `Next ${noun.toLowerCase()} appearance`);
  }
  function refreshSurf(): void {
    const entry = surfEntries.find(candidate => candidate.key === surfKey);
    if (!entry || !surfArt) { surfFrames = []; updateNavigation(); return; }
    surfOffsets = structuredClone(args.workspace().surfAdjustments?.[surfKey] ?? zeroRider());
    surfFrames = FOLLOWER_DIRECTIONS.map((_, direction) => [0, 1, 2, 3].map(pose =>
      frameCanvas(decodeBtxImage(memberAt(surfArt!, entry.member + direction * 4 + pose), 0, 0, "linear"))));
    renderFields(); draw(); updateNavigation();
  }
  function refreshLand(): void {
    const entry = args.entry();
    if (!entry) { followerFrames = []; updateNavigation(); return; }
    const key = followerKey(entry.key);
    if (key !== currentLand) {
      currentLand = key;
      const bytes = args.followerResource(entry);
      followerFrames = FOLLOWER_DIRECTIONS.map(direction => [0, 10].map(tick => frameCanvas(followerPreview(bytes, entry.animationProfile, direction, tick))));
      landDefault = followerLandAnchorDefaults(entry, bytes);
      gaps = [...(entry.directionalGaps ?? followerDefaultDirectionalGaps(entry))] as typeof gaps;
      landOffsets = structuredClone(entry.riderAdjustments ?? zeroRider());
    }
    renderFields(); draw(); updateNavigation();
  }
  function renderFields(): void {
    fields.classList.toggle("is-walking", mode === "walking");
    const walkingRows = [
      { label: "Up", index: 0, value: String(gaps[0]), placeholder: "" },
      { label: "Down", index: 1, value: String(gaps[1]), placeholder: "" },
      { label: "Left / Right", index: 2, value: gaps[2] === gaps[3] ? String(gaps[2]) : "",
        placeholder: gaps[2] === gaps[3] ? "" : `Left ${gaps[2]} · Right ${gaps[3]}` },
    ];
    fields.innerHTML = `<div class="following-position-field-heading"><span>Direction</span>${mode === "walking" ? "<span>Extra gap</span>" : "<span>Rider left / right</span><span>Rider up / down</span>"}</div>` +
      (mode === "walking"
        ? walkingRows.map(row => `<label class="following-position-field-row"><span>${row.label}</span>
          <input type="number" min="0" max="${FOLLOWER_MAX_DIRECTIONAL_GAP}" step="1" value="${row.value}" placeholder="${row.placeholder}"
            data-position-value="${row.index === 2 ? "gap-both" : "gap"}:${row.index}" aria-label="${row.label} extra gap"></label>`).join("")
        : FOLLOWER_DIRECTIONS.map((direction, index) => `<label class="following-position-field-row"><span>${direction}</span>
          <input type="number" min="-32" max="32" step="1" value="${(mode === "land" ? landOffsets : surfOffsets)[index][0]}" data-position-value="x:${index}" aria-label="${direction} rider horizontal adjustment">
          <input type="number" min="-32" max="32" step="1" value="${(mode === "land" ? landOffsets : surfOffsets)[index][1]}" data-position-value="y:${index}" aria-label="${direction} rider vertical adjustment"></label>`).join("")) +
      `<p>${mode === "walking" ? "Extra world units beyond the usual one-tile trail; 0–12. Automatic Left / Right spacing includes six extra units; editing this field sets both directions." : "Signed screen-oriented adjustments from the calculated seat: negative X is left; negative Y is up."}</p>`;
    updateNudgeControls();
  }
  function draw(): void {
    if (!section.isConnected) { if (timer) clearInterval(timer); return; }
    const phase = Math.floor(tick / 5);
    previews.forEach((canvas, direction) => {
      const ctx = canvas.getContext("2d")!;ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#303941";ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#434b54";ctx.fillRect(0, 112, canvas.width, 40);
      ctx.strokeStyle = "#5b636c";for(let x=0;x<160;x+=16){ctx.beginPath();ctx.moveTo(x,112);ctx.lineTo(x,152);ctx.stroke();}
      const px = 80, py = 88;
      if (mode === "walking") {
        if (!followerFrames[direction] || !walkerFrames[gender]) return;
        const gap = 16 + gaps[direction], fx = px + (direction === 2 ? gap : direction === 3 ? -gap : 0);
        const fy = py + (direction === 0 ? gap : direction === 1 ? -gap : 0);
        const follower = followerFrames[direction][phase % 2], player = walkerFrames[gender][direction * 3 + phase % 3];
        if (direction === 0) { paint(ctx, player, px, py); paint(ctx, follower, fx, fy); }
        else { paint(ctx, follower, fx, fy); paint(ctx, player, px, py); }
      } else if (mode === "land") {
        if (!followerFrames[direction] || !landRiderFrames[gender]) return;
        const mount = followerFrames[direction][phase % 2], rider = landRiderFrames[gender][direction * 3 + phase % 3];
        const riderX = px + landDefault[direction * 2] + landOffsets[direction][0];
        const riderY = py + landDefault[direction * 2 + 1] + landOffsets[direction][1];
        if (direction === 1) { paint(ctx, rider, riderX, riderY); paint(ctx, mount, px, py); }
        else { paint(ctx, mount, px, py); paint(ctx, rider, riderX, riderY); }
      } else {
        if (!surfFrames[direction] || !seatedFrames[gender]) return;
        const mount = surfFrames[direction][phase % 4], rider = seatedFrames[gender][direction];
        const riderX = px + surfOffsets[direction][0], riderY = py - 10 + surfOffsets[direction][1];
        if (direction === 1) { paint(ctx, rider, riderX, riderY); paint(ctx, mount, px, py); }
        else { paint(ctx, mount, px, py); paint(ctx, rider, riderX, riderY); }
      }
    });
  }
  async function setMode(next: Mode): Promise<void> {
    mode = next;
    section.querySelectorAll<HTMLButtonElement>("[data-position-mode]").forEach(button => {
      const selected = button.dataset.positionMode === mode; button.classList.toggle("is-active", selected);button.setAttribute("aria-selected", String(selected));
    });
    section.querySelector<HTMLElement>("[data-position-surf-select]")!.hidden = mode !== "surf";
    section.querySelector<HTMLElement>("[data-position-surf-filter]")!.hidden = mode !== "surf";
    status.textContent = "";
    try { if (mode === "surf") await loadSurf(); else if (mode === "land") await loadLandRider();
      if (mode !== "surf") refreshLand(); else { renderFields(); draw(); updateNavigation(); } }
    catch (reason) { status.textContent = reason instanceof Error ? reason.message : String(reason); }
  }
  section.querySelectorAll<HTMLButtonElement>("[data-position-mode]").forEach(button => button.addEventListener("click", () => { void setMode(button.dataset.positionMode as Mode); }));
  const navigate = (step: -1 | 1) => {
    if (mode === "surf") {
      const count = surfSelect.options.length;
      if (!count) return;
      surfSelect.selectedIndex = (surfSelect.selectedIndex + step + count) % count;
      surfKey = surfSelect.value;
      try { refreshSurf(); status.textContent = ""; } catch (reason) { status.textContent = String(reason); }
    } else args.navigateFollower(step);
  };
  previous.addEventListener("click", () => navigate(-1));
  next.addEventListener("click", () => navigate(1));
  section.querySelector<HTMLSelectElement>("[data-position-gender] select")!.addEventListener("change", event => { gender = Number((event.target as HTMLSelectElement).value) as 0 | 1; draw(); });
  surfSelect.addEventListener("change", () => { surfKey = surfSelect.value; try { refreshSurf(); } catch (reason) { status.textContent = String(reason); } });
  surfFilterInput.addEventListener("input", () => { surfFilter = surfFilterInput.value; surfOptions(); try { refreshSurf(); } catch (reason) { status.textContent = String(reason); } });
  fields.addEventListener("input", event => {
    const input = event.target as HTMLInputElement, [field, indexText] = (input.dataset.positionValue ?? "").split(":");
    if (input.value === "") {
      input.setCustomValidity("Enter a value before saving.");
      status.textContent = "Enter a value in the shown range.";
      return;
    }
    const index = Number(indexText), value = Number(input.value);
    if (!Number.isInteger(index) || index < 0 || index > 3 || !Number.isInteger(value) ||
        value < (field.startsWith("gap") ? 0 : -32) || value > (field.startsWith("gap") ? FOLLOWER_MAX_DIRECTIONAL_GAP : 32)) { status.textContent = "Enter a value in the shown range."; return; }
    input.setCustomValidity("");
    status.textContent = "Unsaved preview";
    if (field === "gap") gaps[index] = value;
    else if (field === "gap-both") gaps[2] = gaps[3] = value;
    else (mode === "land" ? landOffsets : surfOffsets)[index][field === "x" ? 0 : 1] = value;
    updateNudgeControls(); draw();
  });
  canvases.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-position-nudge]");
    if (!button || button.disabled) return;
    const [indexText, arrowText] = button.dataset.positionNudge!.split(":");
    const index = Number(indexText), arrow = arrowText as Nudge;
    if (mode === "walking") {
      const next = gaps[index] + walkingNudge(index, arrow);
      if (index >= 2) gaps[2] = gaps[3] = next;
      else gaps[index] = next;
    } else {
      const pair = (mode === "land" ? landOffsets : surfOffsets)[index];
      const axis = arrow === "left" || arrow === "right" ? 0 : 1;
      pair[axis] += arrow === "left" || arrow === "up" ? -1 : 1;
    }
    renderFields(); draw(); status.textContent = "Unsaved preview";
  });
  save.addEventListener("click", async () => {
    if (!fields.querySelectorAll("input:invalid").length) {
      save.disabled = true; status.textContent = "Saving…";
      try {
        const workspace = mode === "surf"
          ? await updateFollowerPositioning(project, rom, { surfKey, rider: surfOffsets })
          : await updateFollowerPositioning(project, rom, { landKey: currentLand, gaps, rider: landOffsets });
        args.changed(workspace); status.textContent = "Saved! Export the ROM and restart the game to apply it.";
      } catch (reason) { error = reason instanceof Error ? reason.message : String(reason);status.textContent = error; }
      finally { save.disabled = false; }
    } else status.textContent = "Correct the highlighted values before saving.";
  });
  try { loadPlayer(); refreshLand(); } catch (reason) { status.textContent = reason instanceof Error ? reason.message : String(reason); }
  timer = setInterval(() => { tick++; draw(); }, 100);
  return { refresh: refreshLand, destroy: () => { if (timer) clearInterval(timer); section.remove(); } };
}
