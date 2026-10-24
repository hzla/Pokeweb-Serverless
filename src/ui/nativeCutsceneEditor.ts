import { createAspertiaCutsceneClone } from "../pokeweb/nativeCutsceneClone";
import { buildNativeCutsceneTestDownloads } from "../pokeweb/nativeCutsceneTest";
import { downloadBytes } from "../pokeweb/fileSystemModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { compileNativeCutscene, encodeNativeSceneCues, loadNativeCutsceneLibrary, nativeCutsceneDirty, nativeCutsceneName, nativeSceneGroups, NATIVE_CUE_NAMES, openNativeCutscene, saveNativeCutsceneCamera, type NativeCutsceneDocument, type NativeSceneCue } from "../pokeweb/nativeCutsceneModel";
import { cameraTrackEqual, interpolateNativeCamera, nativeCameraPose, readNativeCameraTrack, writeNativeCameraPose } from "../pokeweb/nativeCameraTrack";
import { readNativeObject, stageNativeObjectTransforms, nativeJointEuler, nativeJointRotation, interpolateNativeJoint, type NativeJointChange, type NativeJointChannel } from "../pokeweb/nativeObjectMovement";
import { readNitroModelNames } from "../pokeweb/map3dModel";
import type { NitroVec3 } from "../pokeweb/nitroAnimation";
import { mountNativeCutsceneRenderer } from "./nativeCutsceneRenderer";

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const cueLabels: Record<number, string[]> = {
  1: ["Sound ID", "Volume", "Pan", "Pitch change", "Channel"], 2: ["Sound ID", "Channel"],
  3: ["Sound ID", "Start volume", "End volume", "Duration (frames)", "Channel"], 4: ["Sound ID", "Start pan", "End pan", "Duration (frames)", "Channel"], 5: ["Sound ID", "Start pitch", "End pitch", "Duration (frames)", "Channel"],
  6: ["Music ID"], 8: ["Fade out (1) / in (0)", "Duration (frames)"], 9: ["Music ID", "Fade-out frames", "Fade-in frames", "Change type"],
  10: ["Screen mask: 1 top, 2 bottom, 3 both", "Duration (frames)", "From brightness (-16…16)", "To brightness (-16…16)"],
  11: ["Screen mask: 1 top, 2 bottom, 3 both", "Start brightness", "Peak brightness", "End brightness", "Fade-out frames", "Fade-in frames"],
  12: ["Light ID", "Red", "Green", "Blue"], 13: ["Light ID", "X", "Y", "Z"],
  14: ["Text bank", "Message ID", "Variant message increment", "Duration", "X", "Y", "Width", "Height"],
  15: ["Game flag", "Palette ID", "Graphics ID", "Screen ID", "Fade-in frames", "Hold frames", "Fade-out frames"],
  16: ["Top intensity", "Bottom intensity"], 18: ["Horizontal FOV (degrees)", "Vertical FOV (degrees)", "Top screen offset", "Bottom screen offset"],
};
type Snapshot = { camera: Uint8Array; cues: NativeSceneCue[]; assets: Map<number, Uint8Array>; startFade: NativeCutsceneDocument["definition"]["startFade"]; endFade: NativeCutsceneDocument["definition"]["endFade"] };
type Draft = { doc: NativeCutsceneDocument; frame: number; undo: Snapshot[]; redo: Snapshot[]; originals: Map<number, Uint8Array> };

export async function renderNativeCutsceneEditor(project: ProjectState, root: HTMLElement, onDirty: () => void, routeOptions: { sequenceId?: number; onSequenceChange?: (id: number) => void } = {}): Promise<void> {
  root.innerHTML = `<div class="cutscene-editor"><p role="status">Loading White 2 sequences…</p></div>`;
  const loading = root.firstElementChild, library = await loadNativeCutsceneLibrary(project);
  if (!loading?.isConnected || root.firstElementChild !== loading) return;
  const requested = routeOptions.sequenceId ?? Number(location.hash.split("/")[1]), first = library.definitions.some(d => d.id === requested) ? requested : 5;
  root.innerHTML = `<div class="cutscene-editor"><aside class="cutscene-sidebar">
    <header><span class="cutscene-eyebrow">WHITE 2 · NATIVE CUTSCENES</span><label>Sequence<select name="sequence">${library.definitions.map(d => `<option value="${d.id}">${d.id} · ${escape(nativeCutsceneName(d.id))}</option>`).join("")}</select></label><div class="cutscene-actions"><button data-action="create-clone" ${library.definitions.some(d => d.id === 27) ? "disabled" : ""}>Create Aspertia clone (27)</button><button data-action="test-clone" ${library.definitions.some(d => d.id === 27) ? "" : "disabled"}>Download 27 test</button></div><h1 data-title></h1><p data-description></p></header>
    <details class="cutscene-variants"><summary>Preview variants</summary><div class="cutscene-seasons" role="group" aria-label="Preview season">${["Spring", "Summer", "Autumn", "Winter"].map((s, i) => `<button data-season="${i}" aria-pressed="${i === 0}">${s}</button>`).join("")}</div><label>Time of day<select name="day">${["Morning", "Day", "Evening", "Night", "Late night"].map((s, i) => `<option value="${i}">${s}</option>`).join("")}</select></label><label>Player model<select name="gender"><option value="0">Male</option><option value="1">Female</option></select></label><label data-parameter-label>Scene actor<select name="parameter"></select></label></details>
    <div class="cutscene-tabs" role="tablist" aria-label="Cutscene controls">${["Camera", "Objects", "Cues"].map((s, i) => `<button role="tab" id="cutscene-tab-${s.toLowerCase()}" aria-controls="cutscene-panel-${s.toLowerCase()}" aria-selected="${i === 0}" data-tab="${s.toLowerCase()}">${s}</button>`).join("")}</div>
    <div data-panel="camera" id="cutscene-panel-camera" role="tabpanel" aria-labelledby="cutscene-tab-camera">
      <div class="cutscene-view-switch" role="group" aria-label="Camera view"><button data-action="native" aria-pressed="true">Scene camera</button><button data-action="free" aria-pressed="false">Camera path</button></div>
      <section><h2>Camera at frame <span data-current-frame>0</span></h2><p>Scene units · angles in degrees</p><div class="cutscene-vector">${["X", "Y", "Z"].map((s, i) => `<label>${s}<input type="number" step="any" name="position-${i}" aria-label="Camera position ${s}" required></label>`).join("")}</div><div class="cutscene-vector">${["Pitch", "Yaw", "Roll"].map((s, i) => `<label>${s}<input type="number" step="any" name="rotation-${i}" aria-label="Camera ${s.toLowerCase()}" required></label>`).join("")}</div><div class="cutscene-actions"><button data-action="apply">Apply frame</button><button data-action="capture" disabled>Use free-view camera</button></div></section>
      <section><h2>Animate a range</h2><p>Edit both endpoint frames, then fill between them.</p><div class="cutscene-range"><label>Start<input name="start" type="number" min="0" step="1" value="0"></label><button data-action="start">Set here</button><button data-action="go-start">Go</button><label>End<input name="end" type="number" min="0" step="1"></label><button data-action="end">Set here</button><button data-action="go-end">Go</button></div><label>Interpolation<select name="easing"><option value="smooth">Ease in / out</option><option value="linear">Linear</option></select></label><button data-action="interpolate">Fill camera range</button></section>
    </div>
    <div data-panel="objects" id="cutscene-panel-objects" role="tabpanel" aria-labelledby="cutscene-tab-objects" hidden><h2>Animated objects</h2><p>Characters, petals, vehicles and other animated geometry. Edit local translation, rotation and scale on a root or child joint, including joints currently using their bind pose. The cyan marker identifies the selection.</p><label>Object<select name="object"></select></label><label>Joint / piece<select name="joint"></select></label><p data-object-info></p>${[["object", "Translation"], ["joint-rotation", "Rotation (degrees · XYZ)"], ["joint-scale", "Scale"]].map(([prefix, label]) => `<h3>${label}</h3><div class="cutscene-vector">${["X", "Y", "Z"].map((axis, i) => `<label>${axis}<input type="number" step="any" name="${prefix}-${i}" aria-label="Joint ${prefix === "object" ? "translation" : prefix === "joint-rotation" ? "rotation" : "scale"} ${axis}" required></label>`).join("")}</div>`).join("")}<button data-action="object-apply">Apply joint transform</button><section><h2>Movement range</h2><p>Local joint coordinates. Choose the channels to fill between edited endpoints. Rotations follow the shortest arc; other joints and unselected channels are preserved.</p><div class="cutscene-range"><label>Start<input name="object-start" type="number" min="0" step="1" value="0"></label><button data-action="object-start">Set here</button><button data-action="object-go-start">Go</button><label>End<input name="object-end" type="number" min="0" step="1"></label><button data-action="object-end">Set here</button><button data-action="object-go-end">Go</button></div><label>Interpolation<select name="object-easing"><option value="smooth">Ease in / out</option><option value="linear">Linear</option></select></label><label>Channels<select name="object-channel"><option value="all">Translation, rotation and scale</option><option value="translation">Translation only</option><option value="rotation">Rotation only</option><option value="scale">Scale only</option></select></label><button data-action="object-fill">Fill joint range</button></section></div>
    <div data-panel="cues" id="cutscene-panel-cues" role="tabpanel" aria-labelledby="cutscene-tab-cues" hidden><h2>Music, fades & timed commands</h2><section><h2>Opening / closing fades</h2><label>Opening color<select name="opening-color"><option value="black">Black</option><option value="white">White</option></select></label><label>Opening duration<input name="opening-duration" type="number" step="1" min="0" max="255" required></label><label>Closing color<select name="closing-color"><option value="black">Black</option><option value="white">White</option></select></label><label>Closing duration<input name="closing-duration" type="number" step="1" min="0" max="255" required></label><button data-action="fades-apply">Apply opening / closing fades</button></section><p>Edit existing native cue slots. Use No operation to disable a cue or repurpose a disabled slot. Frame -1 runs before playback. Sound IDs are native game IDs; audio is silent in this preview.</p><label>Cue<select name="cue" size="6"></select></label><div data-cue-form></div><div class="cutscene-actions"><button data-action="cue-seek">Go to cue</button><button data-action="cue-apply">Apply cue</button></div><p>Screen fades and projection cues update the preview. Other commands are saved for the game. Cue count and end commands stay fixed.</p></div>
    <footer class="cutscene-save"><div class="cutscene-actions"><button data-action="undo" disabled>Undo</button><button data-action="redo" disabled>Redo</button></div><div class="cutscene-actions"><button data-action="save" class="cutscene-primary" disabled>Save changes to project</button><button data-action="revert" disabled>Revert unsaved</button></div><p class="cutscene-status" role="status">Ready.</p></footer>
  </aside><main class="cutscene-stage"><div class="cutscene-viewport"></div><div class="cutscene-view-help"></div><div class="cutscene-preview-scope">Approximate lighting / reflections · Silent preview · 2D overlays omitted</div><div class="cutscene-transport"><div class="cutscene-actions"><button data-action="restart" aria-label="Restart cutscene">↶</button><button data-action="previous" aria-label="Previous frame">‹</button><button data-action="play">Play</button><button data-action="next" aria-label="Next frame">›</button><label class="cutscene-loop"><input name="loop" type="checkbox" checked> Loop</label><select name="speed" aria-label="Playback speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div><input name="timeline" type="range" min="0" step="1" value="0" aria-label="Cutscene timeline"><div class="cutscene-time"><label>Frame<input name="frame" aria-label="Frame" type="number" min="0" step="1" value="0"><button data-action="seek" aria-label="Go to frame">Go</button></label><output data-time></output><span data-duration></span></div></div></main></div>`;
  const editor = root.querySelector<HTMLElement>(".cutscene-editor")!, viewport = root.querySelector<HTMLElement>(".cutscene-viewport")!;
  const input = (name: string) => root.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  const select = (name: string) => root.querySelector<HTMLSelectElement>(`[name="${name}"]`)!;
  const button = (action: string) => root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
  const text = (selector: string, value: string) => { root.querySelector<HTMLElement>(selector)!.textContent = value; };
  const listeners = new AbortController(), options = { signal: listeners.signal }, drafts = new Map<number, Draft>();
  let active: Draft, doc: NativeCutsceneDocument, frame = 0, playing = false, season = 0, day = 0, gender = 0, parameter = 0, free = false, tab = "camera", lastTime = 0, accumulator = 0;
  let preview: ReturnType<typeof mountNativeCutsceneRenderer> | undefined, object: ReturnType<typeof readNativeObject> | undefined, objectResource = 0, modelId = -1, animationId = -1;
  function report(message: string, error = false) { text(".cutscene-status", message); root.querySelector(".cutscene-status")!.classList.toggle("error", error); }
  function run(action: () => void) { try { action(); } catch (e) { report(e instanceof Error ? e.message : String(e), true); } }
  function pause() { playing = false; button("play").textContent = "Play"; }
  function snapshot(): Snapshot { return { camera: doc.camera.bytes.slice(), cues: structuredClone(doc.definition.cues), assets: new Map([...doc.assets ?? []].map(([id, edit]) => [id, edit.bytes.slice()])), startFade: { ...doc.definition.startFade }, endFade: { ...doc.definition.endFade } }; }
  function restore(s: Snapshot) {
    doc.camera = readNativeCameraTrack(s.camera.slice()); doc.definition.cues = structuredClone(s.cues);
    doc.definition.startFade = { ...s.startFade }; doc.definition.endFade = { ...s.endFade };
    for (const [id, edit] of doc.assets ?? []) { edit.bytes = new Uint8Array(s.assets.get(id) ?? active.originals.get(id) ?? edit.baseline); doc.files[id] = edit.bytes; }
    for (const [id, bytes] of s.assets) if (!doc.assets!.has(id)) { const baseline = active.originals.get(id) ?? doc.files[id]; doc.assets!.set(id, { baseline, bytes: bytes.slice() }); doc.files[id] = bytes.slice(); }
  }
  function changed() { return nativeCutsceneDirty(doc); }
  function objectFrame() { return !object ? 0 : object.animation.frameCount < doc.camera.frameCount ? frame % object.animation.frameCount : Math.min(frame, object.animation.frameCount - 1); }
  function refreshObjectFields() {
    const node = Number(select("joint").value), canEdit = Boolean(object?.bases[node]);
    button("object-apply").disabled = button("object-fill").disabled = !canEdit;
    const pose = object?.animation.sample(objectFrame())[node];
    for (const [prefix, values] of [["object", pose?.translation], ["joint-rotation", pose && nativeJointEuler(pose.rotation)], ["joint-scale", pose?.scale]] as const) for (let i = 0; i < 3; i++) { input(`${prefix}-${i}`).disabled = !canEdit; input(`${prefix}-${i}`).value = values ? String(values[i]) : ""; }
    if (object) text("[data-object-info]", `Object frame ${objectFrame()} / ${object.animation.frameCount - 1}. Local joint coordinates; Euler XYZ rotation in degrees. Scale must stay nonzero. Edits affect every scene/variant using resource ${animationId}.`);
    else text("[data-object-info]", "This object has no skeletal animation resource. Select an object with an existing clip.");
    preview?.selectJoint(tab === "objects" && object ? objectResource : undefined, node);
  }
  function refreshObject(reset = false) {
    const ids = nativeSceneGroups(doc, season, day, gender, parameter)[Number(select("object").value) || 0]; objectResource = Number(select("object").value) || 0;
    const find = (stamp: string) => ids.find(id => String.fromCharCode(...doc.files[id].subarray(0, 4)) === stamp);
    modelId = find("BMD0") ?? -1; animationId = find("BCA0") ?? -1;
    const old = reset ? 0 : Number(select("joint").value);
    object = modelId >= 0 && animationId >= 0 ? readNativeObject(doc.files[modelId], doc.files[animationId]) : undefined;
    select("joint").innerHTML = object ? object.nodes.map((name, i) => `<option value="${i}">${i} · ${escape(name)}${object!.animatedNodes.has(i) ? "" : " (bind pose)"}</option>`).join("") : `<option>No animated joints</option>`;
    select("joint").value = String(object?.nodes[old] ? old : 0);
    for (const name of ["object-start", "object-end"]) input(name).max = String((object?.animation.frameCount ?? 1) - 1);
    if (reset || !input("object-end").value) input("object-end").value = String((object?.animation.frameCount ?? 1) - 1);
    refreshObjectFields();
  }
  function refreshCue() {
    const cue = doc.definition.cues[Number(select("cue").value)];
    root.querySelector<HTMLElement>("[data-cue-form]")!.innerHTML = cue ? `<label>Command<select name="cue-op">${NATIVE_CUE_NAMES.map((s, i) => `<option value="${i}" ${i === cue.opcode ? "selected" : ""}>${s}</option>`).join("")}</select></label><label>Start frame<input name="cue-frame" type="number" step="1" min="-1" max="65535" value="${cue.frame}" required></label><div data-cue-args></div>` : `<p>No playback commands in this sequence.</p>`;
    button("cue-apply").disabled = button("cue-seek").disabled = !cue;
    if (cue) renderCueArguments(cue.args);
  }
  function renderCueArguments(values?: number[]) {
    const cue = doc.definition.cues[Number(select("cue").value)], opcode = Number(select("cue-op").value), labels = cueLabels[opcode] ?? [];
    const args = values ?? cue.args;
    root.querySelector<HTMLElement>("[data-cue-args]")!.innerHTML = Array.from({ length: 8 }, (_, i) => `<label ${i >= labels.length ? 'class="cutscene-reserved"' : ""}>${escape(labels[i] ?? `Reserved argument ${i + 1}`)}<input name="cue-arg-${i}" type="number" step="${opcode === 18 && i < 4 ? "any" : "1"}" value="${opcode === 18 && i < 4 ? args[i] / 4096 : args[i]}" required></label>`).join("");
  }
  function refreshCues() {
    const selected = Number(select("cue").value) || 0;
    select("cue").innerHTML = doc.definition.cues.map((c, i) => `<option value="${i}">${c.frame < 0 ? "Before start" : `Frame ${c.frame}`} · ${NATIVE_CUE_NAMES[c.opcode]}</option>`).join(""); select("cue").value = String(Math.min(selected, doc.definition.cues.length - 1)); refreshCue();
    for (const [key, fade] of [["opening", doc.definition.startFade], ["closing", doc.definition.endFade]] as const) { input(`${key}-duration`).value = String(fade.duration); select(`${key}-color`).value = fade.white ? "white" : "black"; }
  }
  function update() {
    active.frame = frame;
    const pose = nativeCameraPose(doc.camera, frame);
    for (const key of ["position", "rotation"] as const) pose[key].forEach((n, i) => { input(`${key}-${i}`).value = String(n); });
    input("timeline").value = input("frame").value = String(frame); text("[data-current-frame]", String(frame));
    text("[data-time]", `${(frame / doc.definition.fps).toFixed(2)} / ${((doc.camera.frameCount - 1) / doc.definition.fps).toFixed(2)} s`);
    button("save").disabled = button("revert").disabled = !changed(); button("undo").disabled = !active.undo.length; button("redo").disabled = !active.redo.length;
    preview?.draw(frame); if (tab === "objects") refreshObjectFields();
  }
  function seek(next: number) { if (!Number.isInteger(next) || next < 0 || next >= doc.camera.frameCount) throw new Error("Choose a frame within the native timeline."); pause(); frame = next; update(); }
  function viewHelp() { text(".cutscene-view-help", free ? "Drag to orbit · right-drag to pan · wheel to zoom · click the gold path to seek" : `Native scene camera · ${doc.definition.dualScreen ? "top + bottom screens" : "4:3"}`); }
  function rebuild(resetObject = false) {
    pause(); const compiled = compileNativeCutscene(doc, season, day, gender, parameter);
    preview?.dispose(); preview = mountNativeCutsceneRenderer(viewport, doc, compiled, seek); preview.draw(frame); preview.setSceneCamera(!free);
    const oldObject = Number(select("object").value) || 0;
    select("object").innerHTML = nativeSceneGroups(doc, season, day, gender, parameter).map((ids, i) => { const id = ids.find(id => String.fromCharCode(...doc.files[id].subarray(0, 4)) === "BMD0"); return `<option value="${i}">${escape(id === undefined ? `Object ${i}` : readNitroModelNames(doc.files[id])[0] ?? `Object ${i}`)}</option>`; }).join("");
    select("object").value = String(resetObject ? 0 : Math.min(oldObject, doc.definition.resources.length - 1)); refreshObject(resetObject); viewHelp();
  }
  function mutate(action: () => void, geometry = false) {
    pause(); const before = snapshot();
    try { action(); if (geometry) rebuild(); } catch (e) { restore(before); throw e; }
    active.undo.push(before); if (active.undo.length > 40) active.undo.shift(); active.redo.length = 0;
    preview?.updatePath(); refreshCues(); update(); report(changed() ? "Unsaved edits retained for this sequence. Save changes, then export the ROM." : "Sequence matches project.");
  }
  function chooseSequence(id: number) {
    pause(); let candidate = drafts.get(id);
    if (!candidate || !nativeCutsceneDirty(candidate.doc)) {
      const fresh = openNativeCutscene(project, library, id), prior = candidate?.doc;
      // A different sequence can save a shared camera or animation while this tab is inactive.
      const sameSource = prior && cameraTrackEqual(prior.baseline, fresh.baseline) && cameraTrackEqual(prior.cueBaseline!, fresh.cueBaseline!) && cameraTrackEqual(prior.fadeBaseline!, fresh.fadeBaseline!) && prior.files.length === fresh.files.length && prior.files.every((bytes, i) => cameraTrackEqual(bytes, fresh.files[i]));
      if (!sameSource) candidate = { doc: fresh, frame: candidate?.frame ?? ([11, 12].includes(id) ? Math.min(7300, fresh.camera.frameCount - 1) : Math.min(60, fresh.camera.frameCount - 1)), undo: [], redo: [], originals: new Map() };
    }
    if (!candidate) throw new Error("Could not open the native sequence.");
    compileNativeCutscene(candidate.doc, season, day, gender, 0); // Validate before replacing the active workspace.
    active = candidate; doc = active.doc; frame = active.frame; parameter = 0; drafts.set(id, active); select("sequence").value = String(id);
    if (routeOptions.onSequenceChange) routeOptions.onSequenceChange(id);
    else history.replaceState(history.state, "", `#cutscenes/${id}`);
    text("[data-title]", nativeCutsceneName(id));
    const shared = library.definitions.filter(d => d.cameraId === doc.definition.cameraId).map(d => d.id);
    text("[data-description]", `Sequence ${id} · Zone ${doc.definition.zoneId}${shared.length > 1 ? ` · Camera shared with sequences ${shared.join(", ")}` : ""}`);
    const variants = Math.max(1, ...doc.definition.resources.filter(r => r.selection === 2).map(r => r.bundles.length));
    select("parameter").innerHTML = Array.from({ length: variants }, (_, i) => `<option value="${i}">Actor variant ${i}</option>`).join(""); root.querySelector<HTMLElement>("[data-parameter-label]")!.hidden = variants === 1;
    select("gender").disabled = !doc.definition.resources.some(r => r.selection === 1);
    for (const name of ["frame", "timeline", "start", "end"]) input(name).max = String(doc.camera.frameCount - 1);
    input("start").value = "0"; input("end").value = String(doc.camera.frameCount - 1);
    text("[data-duration]", `${doc.camera.frameCount} frames · ${doc.definition.fps} fps`);
    rebuild(true); refreshCues(); update(); report(changed() ? "Restored this sequence's unsaved draft." : "Ready. Switch sequences freely; unsaved applied edits are retained until you leave this page.");
  }
  function numbers(prefix: string): NitroVec3 { return [0, 1, 2].map(i => { const field = input(`${prefix}-${i}`); if (!field.value.trim() || !field.checkValidity()) throw new Error("Enter finite joint or camera values."); return Number(field.value); }) as NitroVec3; }
  function changeTab(next: string) {
    tab = next; root.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab))); root.querySelectorAll<HTMLElement>("[data-panel]").forEach(p => { p.hidden = p.dataset.panel !== tab; }); refreshObjectFields();
  }
  root.addEventListener("click", e => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>("button"); if (!target || !editor.contains(target) || target.disabled) return;
    if (target.dataset.action === "test-clone") {
      run(() => { if ([...drafts.values()].some(d => nativeCutsceneDirty(d.doc))) throw new Error("Save or revert applied drafts before building the test ROM."); });
      if ([...drafts.values()].some(d => nativeCutsceneDirty(d.doc))) return;
      pause(); target.disabled = true; report("Building sequence 27 test ROM and unchanged fixture save…");
      void buildNativeCutsceneTestDownloads(project).then(result => {
        const base = `White2-Cutscene27-${Date.now()}`;
        downloadBytes(result.romBytes, `${base}.nds`); downloadBytes(result.saveBytes, `${base}.sav`);
        report(`Test exported. Use the matching save in melonDS, then walk down to tile ${result.trigger.gridX}, ${result.trigger.gridZ}.`);
      }).catch(error => report(error instanceof Error ? error.message : String(error), true)).finally(() => { target.disabled = false; });
      return;
    }
    run(() => {
      if (target.dataset.action === "create-clone") {
        createAspertiaCutsceneClone(project, library);
        select("sequence").innerHTML = library.definitions.map(d => `<option value="${d.id}">${d.id} · ${escape(nativeCutsceneName(d.id))}</option>`).join("");
        button("create-clone").disabled = true; button("test-clone").disabled = false; onDirty(); chooseSequence(27);
        report("Created independent sequence 27 with private camera, assets and events. Download 27 test to play it in-game."); return;
      }
      if (target.dataset.tab) { changeTab(target.dataset.tab); return; }
      if (target.dataset.season !== undefined) { const old = season; season = Number(target.dataset.season); try { rebuild(true); } catch (e) { season = old; throw e; } root.querySelectorAll<HTMLButtonElement>("[data-season]").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.season) === season))); update(); return; }
      switch (target.dataset.action) {
        case "play": if (playing) pause(); else { if (frame === doc.camera.frameCount - 1) frame = 0; playing = true; accumulator = 0; lastTime = performance.now(); button("play").textContent = "Pause"; } break;
        case "previous": seek(Math.max(0, frame - 1)); break; case "next": seek(Math.min(doc.camera.frameCount - 1, frame + 1)); break; case "restart": seek(0); break; case "seek": seek(Number(input("frame").value)); break;
        case "native": case "free": free = target.dataset.action === "free"; preview?.setSceneCamera(!free); button("capture").disabled = !free; button("native").setAttribute("aria-pressed", String(!free)); button("free").setAttribute("aria-pressed", String(free)); viewHelp(); break;
        case "apply": mutate(() => writeNativeCameraPose(doc.camera, frame, { position: numbers("position"), rotation: numbers("rotation") })); break;
        case "capture": mutate(() => writeNativeCameraPose(doc.camera, frame, preview!.capture())); break;
        case "start": input("start").value = String(frame); break; case "end": input("end").value = String(frame); break;
        case "go-start": seek(Number(input("start").value)); break; case "go-end": seek(Number(input("end").value)); break;
        case "interpolate": mutate(() => interpolateNativeCamera(doc.camera, Number(input("start").value), Number(input("end").value), select("easing").value as "smooth" | "linear")); break;
        case "object-apply": mutate(() => {
          if (!object) return;
          const node = Number(select("joint").value), pose = object.animation.sample(objectFrame())[node], change: NativeJointChange = {};
          const translation = numbers("object"), rotation = numbers("joint-rotation"), scale = numbers("joint-scale");
          const different = (a: number[], b: number[]) => a.some((n, i) => Math.abs(n - b[i]) > 1e-10);
          if (different(translation, pose.translation)) change.translation = translation;
          if (different(rotation, nativeJointEuler(pose.rotation))) change.rotation = nativeJointRotation(rotation);
          if (different(scale, pose.scale)) change.scale = scale;
          if (!active.originals.has(animationId)) active.originals.set(animationId, doc.files[animationId].slice());
          stageNativeObjectTransforms(doc, modelId, animationId, node, new Map([[objectFrame(), change]]));
        }, true); break;
        case "object-start": input("object-start").value = String(objectFrame()); break; case "object-end": input("object-end").value = String(objectFrame()); break;
        case "object-go-start": seek(Math.min(doc.camera.frameCount - 1, Number(input("object-start").value))); break; case "object-go-end": seek(Math.min(doc.camera.frameCount - 1, Number(input("object-end").value))); break;
        case "object-fill": mutate(() => {
          if (!object) return; const start = Number(input("object-start").value), end = Number(input("object-end").value), node = Number(select("joint").value);
          if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end >= object.animation.frameCount) throw new Error("Choose a valid object movement range.");
          const a = object.animation.sample(start)[node], b = object.animation.sample(end)[node], changes = new Map<number, NativeJointChange>(), channel = select("object-channel").value as NativeJointChannel;
          for (let f = start + 1; f < end; f++) { let t = (f - start) / (end - start); if (select("object-easing").value === "smooth") t = t * t * (3 - 2 * t); changes.set(f, interpolateNativeJoint(a, b, t, channel)); }
          if (!active.originals.has(animationId)) active.originals.set(animationId, doc.files[animationId].slice()); stageNativeObjectTransforms(doc, modelId, animationId, node, changes);
        }, true); break;
        case "cue-seek": seek(Math.min(doc.camera.frameCount - 1, Math.max(0, doc.definition.cues[Number(select("cue").value)].frame))); break;
        case "cue-apply": mutate(() => { const cue = doc.definition.cues[Number(select("cue").value)], opcode = Number(select("cue-op").value), start = input("cue-frame"); if (!start.value.trim() || !start.checkValidity()) throw new Error("Enter a cue frame from -1 through 65535."); const args = Array.from({ length: 8 }, (_, i) => { const f = input(`cue-arg-${i}`); if (!f.value.trim() || !f.checkValidity()) throw new Error("Enter valid native cue arguments."); const n = Number(f.value); return opcode === 18 && i < 4 ? Math.round(n * 4096) : n; }); const next = { opcode, frame: Number(start.value), args }; const copy = doc.definition.cues.map(c => c === cue ? next : c); encodeNativeSceneCues(copy, doc.cueBaseline!); doc.definition.cues = copy; }); break;
        case "fades-apply": mutate(() => {
          for (const [key, property] of [["opening", "startFade"], ["closing", "endFade"]] as const) { const field = input(`${key}-duration`); if (!field.value.trim() || !field.checkValidity()) throw new Error("Fade durations must be 0 through 255 frames."); doc.definition[property] = { duration: Number(field.value), white: select(`${key}-color`).value === "white" }; }
        }); break;
        case "undo": case "redo": { pause(); const back = target.dataset.action === "undo" ? active.undo : active.redo, forward = back === active.undo ? active.redo : active.undo; if (back.length) { forward.push(snapshot()); restore(back.pop()!); rebuild(); preview?.updatePath(); refreshCues(); update(); report("Edit history updated."); } break; }
        case "revert": mutate(() => { doc.camera = readNativeCameraTrack(doc.baseline.slice()); const original = openNativeCutscene(project, library, doc.definition.id); doc.definition.cues = original.definition.cues; doc.definition.startFade = original.definition.startFade; doc.definition.endFade = original.definition.endFade; for (const [id, edit] of doc.assets ?? []) { edit.bytes = edit.baseline.slice(); doc.files[id] = edit.bytes; } }, true); break;
        case "save": saveNativeCutsceneCamera(project, doc); onDirty(); update(); report("Camera, skeletal animation and cue edits saved. Export ROM from the main menu to use them in White 2."); break;
      }
    });
  }, options);
  root.addEventListener("change", e => { const name = (e.target as HTMLInputElement).name; run(() => {
    if (name === "sequence") { const id = Number(select("sequence").value); try { chooseSequence(id); } catch (e) { select("sequence").value = String(doc.definition.id); throw e; } }
    else if (["day", "gender", "parameter"].includes(name)) { const before = [day, gender, parameter]; [day, gender, parameter] = [Number(select("day").value), Number(select("gender").value), Number(select("parameter").value)]; try { rebuild(true); } catch (e) { [day, gender, parameter] = before; select("day").value = String(day); select("gender").value = String(gender); select("parameter").value = String(parameter); throw e; } update(); }
    else if (name === "object") refreshObject(true); else if (name === "joint") refreshObjectFields(); else if (name === "cue") refreshCue(); else if (name === "cue-op") { const old = doc.definition.cues[Number(select("cue").value)]; renderCueArguments(old.args); } else if (name === "frame") seek(Number(input("frame").value));
  }); }, options);
  input("timeline").addEventListener("input", () => run(() => seek(Number(input("timeline").value))), options);
  root.addEventListener("focusin", e => { if ((e.target as HTMLElement).matches("input[type=number]")) pause(); }, options);
  input("frame").addEventListener("keydown", e => { if (e.key === "Enter") button("seek").click(); }, options);
  viewport.addEventListener("keydown", e => { if (e.code === "Space") { e.preventDefault(); button("play").click(); } else if (["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); seek(Math.max(0, Math.min(doc.camera.frameCount - 1, frame + (e.key === "ArrowLeft" ? -1 : 1)))); } }, options);
  chooseSequence(first);
  function tick(time: number) {
    if (!editor.isConnected) { listeners.abort(); preview?.dispose(); return; }
    if (playing) { accumulator += Math.min(time - lastTime, 250) / 1000 * doc.definition.fps * Number(select("speed").value); const advance = Math.floor(accumulator); accumulator -= advance; if (advance > 0) { const next = frame + advance; frame = next >= doc.camera.frameCount ? input("loop").checked ? next % doc.camera.frameCount : doc.camera.frameCount - 1 : next; if (next >= doc.camera.frameCount && !input("loop").checked) pause(); update(); } }
    lastTime = time; requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
