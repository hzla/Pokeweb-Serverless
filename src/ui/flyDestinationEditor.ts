import { applyFlyDestinationEdit, getFlyDestinations, getFlyDestinationStatus, resolveFlyLandingZone,
  type FlyDestination, type FlyDestinationEdit } from "../pokeweb/flyDestinationModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { installBw2MapPreview, type Bw2MapPreview } from "./bw2MapPreview";

let dispose: (() => void) | undefined;
export function stopFlyDestinationEditor(): void { dispose?.(); dispose = undefined; }

export function renderFlyDestinationEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  stopFlyDestinationEditor();
  let mapPreview: Bw2MapPreview | undefined, stopped = false;
  dispose = () => { stopped = true; mapPreview?.destroy(); };
  let destinations: FlyDestination[];
  try { destinations = getFlyDestinations(project); }
  catch (error) {
    root.innerHTML = `<div class="fly-editor"><h1>Fly Destinations</h1><p>${escapeHtml(error instanceof Error ? error.message : "Fly destinations could not be loaded.")}</p></div>`;
    return;
  }
  let selectedIndex = destinations.find(entry => entry.enabled)?.index ?? 0;
  const status = getFlyDestinationStatus(project);
  const drafts = new Map<number, FlyDestinationEdit>();
  let search = "", filter = "all", busy = false;
  root.innerHTML = `<section class="fly-editor">
    <header><a href="#headers" data-route="headers">Headers &amp; Overworlds</a><h1>Fly Destinations</h1><p>Enable existing routes and areas, choose their visit flags, and set where Fly lands.</p></header>
    <p class="fly-support" role="status">${escapeHtml(status.message)}</p>
    <div class="fly-editor-layout">
      <aside class="fly-area-list">
        <label for="fly-search">Find an area</label>
        <input class="filter-input" id="fly-search" type="search" placeholder="Area name or ID" />
        <label for="fly-filter">Show</label>
        <select class="filter-input" id="fly-filter"><option value="all">All areas</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select>
        <div id="fly-areas" role="list" aria-label="Existing Fly areas"></div>
      </aside>
      <div id="fly-detail" class="fly-detail"></div>
    </div>
  </section>`;

  function renderList(): void {
    const list = root.querySelector<HTMLElement>("#fly-areas")!;
    const entries = destinations.filter(entry => `${entry.name} ${entry.zone}`.toLowerCase().includes(search.toLowerCase())
      && (filter === "all" || entry.enabled === (filter === "enabled")));
    list.innerHTML = entries.length ? entries.map(entry => `<button type="button" class="fly-area-button ${entry.index === selectedIndex ? "-selected" : ""}"
      data-fly-area="${entry.index}" aria-pressed="${entry.index === selectedIndex}" ${busy ? "disabled" : ""}>
      <span>${escapeHtml(entry.name)} <small>Area ${entry.zone}</small></span><span class="fly-area-enabled">${entry.enabled ? "Enabled" : "Disabled"}</span>
    </button>`).join("") : `<p>No areas match.</p>`;
    list.querySelectorAll<HTMLButtonElement>("[data-fly-area]").forEach(button => button.addEventListener("click", () => {
      rememberDraft(); selectedIndex = Number(button.dataset.flyArea); renderList(); renderDetail();
    }));
  }

  function rememberDraft(): void {
    try { drafts.set(selectedIndex, readForm()); } catch { /* Keep incomplete input local until it is valid. */ }
  }

  function renderDetail(): void {
    mapPreview?.destroy(); mapPreview = undefined;
    const entry = destinations[selectedIndex];
    const draft = drafts.get(selectedIndex) ?? { ...entry.landing, enabled: entry.enabled, visitFlag: entry.visitFlag };
    const rail = entry.coordinateKind === "rail";
    root.querySelector<HTMLElement>("#fly-detail")!.innerHTML = `<form id="fly-form">
      <h2>${escapeHtml(entry.name)}</h2>
      <p class="fly-area-identity">Area ${entry.zone} · Lands in map ${entry.landingZone}</p>
      <label class="fly-checkbox"><input id="fly-enabled" type="checkbox" ${draft.enabled ? "checked" : ""} /> Enable Fly to this area</label>
      <label for="fly-visit-flag">Visit flag</label>
      <div class="fly-flag-input"><input class="filter-input" id="fly-visit-flag" type="text" inputmode="numeric" value="${draft.visitFlag === 65535 ? "65535" : `0x${draft.visitFlag.toString(16).toUpperCase()}`}" required />
        ${entry.suggestedVisitFlag !== undefined ? `<button class="btn -default" id="fly-use-visit" type="button">Use area flag (0x${entry.suggestedVisitFlag.toString(16).toUpperCase()})</button>` : ""}</div>
      <p class="fly-help">The player can Fly here after this flag is set. Decimal and hexadecimal are accepted. Use an existing visit flag or one set by your map scripts. 65535 means no flag and cannot unlock an enabled destination.</p>
      <fieldset><legend>${rail ? "Rail landing position" : "Landing coordinates"}</legend>
        <div class="fly-coordinates">${(["x", "y", "z"] as const).map((axis, index) => `<label for="fly-${axis}">${rail ? ["Rail component", "Position along rail", "Side offset"][index] : ["X", "Y (height)", "Z"][index]}
          <input class="filter-input" id="fly-${axis}" type="number" step="1" min="${rail && axis !== "z" ? 0 : -32768}" max="${rail && axis !== "z" ? 65535 : 32767}" value="${draft[axis]}" required /></label>`).join("")}</div>
      </fieldset>
      <p class="fly-help">${rail ? "Use the destination map's rail component and position." : "Use grid coordinates across the destination's map matrix. X and Z are horizontal; Y is height."} These settings change Fly arrivals and keep other default spawn positions intact.</p>
      <section id="fly-map-preview" class="bw2-script-map fly-map-preview" aria-label="Fly destination map preview"></section>
      ${entry.zone === 326 || entry.zone === 490 ? `<p class="fly-note">Route 4 and Join Avenue have separate Fly settings and landing coordinates. Changing one here leaves the other unchanged.</p>` : ""}
      ${entry.hiddenFlag !== 65535 ? `<p class="fly-help">This area also has visibility condition ${entry.hiddenFlag}; its existing visibility rules still apply.</p>` : ""}
      <button class="btn -default" id="fly-apply" type="submit" ${!status.compatible || busy ? "disabled" : ""}>${busy ? "Applying…" : "Apply destination"}</button>
      <p id="fly-status" class="fly-result" role="status" aria-live="polite"></p>
    </form>`;
    const zoneId = resolveFlyLandingZone(project, entry.landingZone), header = project.headers?.rows[zoneId + 1];
    mapPreview = installBw2MapPreview(project, root.querySelector<HTMLElement>("#fly-map-preview")!, {
      choices: header ? [{ headerRowId: zoneId + 1, zoneId, overworldId: Number(header.overworlds_id ?? header.map_id),
        label: `${header.location_name} · Map ${zoneId}`, header }] : [],
      emptyMessage: `Destination map ${zoneId} has no matching header.`,
      landing: { coordinates: rail ? undefined : draft, message: landingMessage(draft, rail) },
    });
    function updatePreview(): void {
      try {
        const landing = readLanding();
        for (const axis of ["x", "y", "z"] as const) {
          const min = rail && axis !== "z" ? 0 : -32768, max = rail && axis !== "z" ? 65535 : 32767;
          if (landing[axis] < min || landing[axis] > max) throw new Error("Enter landing coordinates within the allowed range to preview the tile.");
        }
        mapPreview?.setLanding(rail ? undefined : landing, landingMessage(landing, rail));
      } catch (error) {
        mapPreview?.setLanding(undefined, error instanceof Error ? error.message : "Enter valid landing coordinates to preview the tile.");
      }
    }
    for (const axis of ["x", "y", "z"]) root.querySelector<HTMLInputElement>(`#fly-${axis}`)!.addEventListener("input", updatePreview);
    root.querySelector<HTMLButtonElement>("#fly-use-visit")?.addEventListener("click", () => {
      root.querySelector<HTMLInputElement>("#fly-visit-flag")!.value = `0x${entry.suggestedVisitFlag!.toString(16).toUpperCase()}`;
    });
    root.querySelector<HTMLInputElement>("#fly-enabled")!.addEventListener("change", () => {
      const input = root.querySelector<HTMLInputElement>("#fly-visit-flag")!;
      if (root.querySelector<HTMLInputElement>("#fly-enabled")!.checked && Number(input.value) === 65535 && entry.suggestedVisitFlag !== undefined)
        input.value = `0x${entry.suggestedVisitFlag.toString(16).toUpperCase()}`;
    });
    root.querySelector<HTMLFormElement>("#fly-form")!.addEventListener("submit", async event => {
      event.preventDefault();
      const result = root.querySelector<HTMLElement>("#fly-status")!;
      try {
        const edit = readForm();
        busy = true;
        root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select").forEach(input => input.disabled = true);
        result.textContent = "Applying Fly destination…";
        await applyFlyDestinationEdit(project, selectedIndex, edit);
        onDirty?.();
        if (stopped) return;
        destinations = getFlyDestinations(project); drafts.delete(selectedIndex);
        const support = root.querySelector<HTMLElement>(".fly-support");
        if (support) support.textContent = getFlyDestinationStatus(project).message;
        result.textContent = "Applied. Export the ROM to use these Fly settings.";
        result.classList.remove("-error");
      } catch (error) {
        if (stopped) return;
        result.textContent = error instanceof Error ? error.message : "Fly destination could not be applied.";
        result.classList.add("-error");
      } finally {
        if (stopped) return;
        busy = false;
        root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select").forEach(input => input.disabled = false);
        root.querySelector<HTMLButtonElement>("#fly-apply")!.disabled = !status.compatible;
        updatePreview();
        renderList();
      }
    });
  }

  function readForm(): FlyDestinationEdit {
    return { enabled: root.querySelector<HTMLInputElement>("#fly-enabled")!.checked,
      visitFlag: parseInteger(root.querySelector<HTMLInputElement>("#fly-visit-flag")!.value, "Visit flag"),
      ...readLanding() };
  }

  function readLanding() {
    return {
      x: parseInteger(root.querySelector<HTMLInputElement>("#fly-x")!.value, "X"),
      y: parseInteger(root.querySelector<HTMLInputElement>("#fly-y")!.value, "Y"),
      z: parseInteger(root.querySelector<HTMLInputElement>("#fly-z")!.value, "Z") };
  }

  root.querySelector<HTMLInputElement>("#fly-search")!.addEventListener("input", event => { search = (event.target as HTMLInputElement).value; renderList(); });
  root.querySelector<HTMLSelectElement>("#fly-filter")!.addEventListener("change", event => { filter = (event.target as HTMLSelectElement).value; renderList(); });
  renderList(); renderDetail();
}

function landingMessage(landing: { x: number; y: number; z: number }, rail: boolean): string {
  return rail
    ? `Rail component ${landing.x} · position ${landing.y} · side offset ${landing.z}. Rail coordinates cannot yet be plotted on this preview.`
    : `Fly landing: X ${landing.x} · Y (height) ${landing.y} · Z ${landing.z}. Changes update the marker before you apply.`;
}

function parseInteger(value: string, label: string): number {
  const trimmed = value.trim();
  if (!/^(?:-?\d+|0x[0-9a-f]+)$/iu.test(trimmed)) throw new Error(`${label} must be a whole number.`);
  const result = Number(trimmed);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} is outside the supported range.`);
  return result;
}
