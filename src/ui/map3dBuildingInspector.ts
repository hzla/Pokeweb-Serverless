import * as THREE from "three";
import type { Map3dBuilding, Map3dBuildingField, Map3dNewBuilding, Map3dSceneData } from "../pokeweb/map3dModel";
import { escapeHtml } from "./dom";

type InspectorActions = {
  select: (index: number | undefined) => void;
  focus: () => void;
  isolate: (enabled: boolean) => void;
  hideOthers: (enabled: boolean) => void;
  editable: boolean;
  edit: (field: Map3dBuildingField, value: number) => boolean;
  add: (input: Map3dNewBuilding) => void;
  remove: () => void;
  /** Start (or, with false, stop) waiting for a click on the map to place a new building of this model. */
  place?: (uid: number | undefined) => void;
};

export function createMap3dBuildingInspector(host: HTMLElement, actions: InspectorActions) {
  host.innerHTML = `
    <div class="mx-block">
      <div class="mx-group-head">
        <span class="mx-group-title" id="map3d-building-count">Load a map to see its buildings.</span>
        ${actions.editable ? '<button class="btn sm -primary" id="map3d-building-place" type="button" aria-pressed="false" disabled title="Choose a model, then click the map where it goes">+ Building</button>' : ""}
      </div>
      <input class="mx-input mx-search" id="map3d-building-search" type="search" aria-label="Search buildings" placeholder="Search by model, name or chunk" disabled />
      <select class="mx-select map3d-building-list" id="map3d-building-list" aria-label="Placed buildings" size="7" disabled></select>
      ${actions.editable ? `<div class="mx-row -place" id="map3d-building-place-row">
        <label class="mx-label" for="map3d-building-new-model">New model</label>
        <select class="mx-select" id="map3d-building-new-model" aria-label="New building model"></select>
      </div>` : ""}
    </div>
    <div class="mx-block" id="map3d-building-selected" hidden>
      <div class="mx-group-head">
        <span class="mx-group-title" id="map3d-building-heading">Building</span>
        <span class="mx-actions -tight">
          <button class="btn sm -ghost" id="map3d-building-focus" type="button" disabled>Focus</button>
          <button class="btn sm -ghost" id="map3d-building-clear" type="button" disabled>Deselect</button>
        </span>
      </div>
      <div class="mx-flags">
        <label class="mx-flag"><input id="map3d-building-isolate" type="checkbox" disabled /><span>Isolate</span></label>
        <label class="mx-flag" title="Hide the other buildings but keep the terrain"><input id="map3d-building-hide-others" type="checkbox" disabled /><span>Hide others</span></label>
      </div>
      <div id="map3d-building-details" class="map3d-building-details"></div>
      <div id="map3d-building-edit-status" class="mx-note" role="status"></div>
      ${actions.editable ? '<div class="mx-actions"><button class="btn sm -remove map3d-building-delete" id="map3d-building-delete" type="button" disabled>Delete building</button></div>' : ""}
    </div>
    <p class="mx-note" id="map3d-building-hint">Click a building on the map, or pick one from the list.</p>
    ${actions.editable ? `<details class="mx-block mx-advanced map3d-building-create" id="map3d-building-create">
      <summary>Add at exact coordinates</summary>
      <fieldset class="mx-grid" id="map3d-building-new-fields" disabled>
        <label class="mx-row"><span class="mx-label">Map chunk</span><select class="mx-select" id="map3d-building-new-chunk" aria-label="New building chunk" required></select></label>
        ${["X", "Y", "Z"].map((axis) => `<label class="mx-row"><span class="mx-label">World ${axis}${axis === "Y" ? " (height)" : ""}</span><input class="mx-input" id="map3d-building-new-${axis.toLowerCase()}" type="number" aria-label="New building world ${axis}" step="any" required /></label>`).join("")}
        <label class="mx-row"><span class="mx-label">Rotation Y</span><input class="mx-input" id="map3d-building-new-rotation" type="number" aria-label="New building rotation Y" min="0" max="360" step="any" value="0" required /></label>
        <div class="mx-actions"><button class="btn sm -primary" id="map3d-building-add" type="button">+ Add building</button></div>
      </fieldset>
      <p class="mx-note">Uses the New model above. Positions are in game units (16 per tile). Changes affect every use of this chunk; collision tiles and warps are edited separately.</p>
      <div id="map3d-building-create-status" class="mx-note" role="status"></div>
    </details>` : ""}
  `;
  const list = host.querySelector<HTMLSelectElement>("#map3d-building-list")!;
  const search = host.querySelector<HTMLInputElement>("#map3d-building-search")!;
  const count = host.querySelector<HTMLElement>("#map3d-building-count")!;
  const details = host.querySelector<HTMLElement>("#map3d-building-details")!;
  const focus = host.querySelector<HTMLButtonElement>("#map3d-building-focus")!;
  const clear = host.querySelector<HTMLButtonElement>("#map3d-building-clear")!;
  const isolate = host.querySelector<HTMLInputElement>("#map3d-building-isolate")!;
  const hideOthers = host.querySelector<HTMLInputElement>("#map3d-building-hide-others")!;
  const status = host.querySelector<HTMLElement>("#map3d-building-edit-status")!;
  const remove = host.querySelector<HTMLButtonElement>("#map3d-building-delete");
  const createFields = host.querySelector<HTMLFieldSetElement>("#map3d-building-new-fields");
  const newModel = host.querySelector<HTMLSelectElement>("#map3d-building-new-model");
  const newChunk = host.querySelector<HTMLSelectElement>("#map3d-building-new-chunk");
  const createStatus = host.querySelector<HTMLElement>("#map3d-building-create-status");
  const newX = host.querySelector<HTMLInputElement>("#map3d-building-new-x");
  const newY = host.querySelector<HTMLInputElement>("#map3d-building-new-y");
  const newZ = host.querySelector<HTMLInputElement>("#map3d-building-new-z");
  const newRotation = host.querySelector<HTMLInputElement>("#map3d-building-new-rotation");
  const place = host.querySelector<HTMLButtonElement>("#map3d-building-place");
  const selectedBlock = host.querySelector<HTMLElement>("#map3d-building-selected")!;
  const heading = host.querySelector<HTMLElement>("#map3d-building-heading")!;
  const hint = host.querySelector<HTMLElement>("#map3d-building-hint")!;
  let placing = false;
  let data: Map3dSceneData | undefined;
  let selected: number | undefined;

  function renderList() {
    const query = search.value.trim().toLowerCase();
    const entries = data?.buildings.flatMap((building, index) => {
      const label = buildingLabel(building, index, data);
      return !query || `${label} uid ${building.uid} source ${building.sourceChunkId}`.toLowerCase().includes(query)
        ? [`<option value="${index}">${escapeHtml(label)}</option>`] : [];
    }) ?? [];
    list.innerHTML = entries.join("");
    list.value = selected === undefined ? "" : String(selected);
    list.disabled = entries.length === 0;
    count.textContent = data
      ? `${data.buildings.length} building${data.buildings.length === 1 ? "" : "s"}${data.buildingPlacementCount !== undefined && data.buildingPlacementCount !== data.buildings.length ? ` of ${data.buildingPlacementCount} placed` : ""}${query ? ` · ${entries.length} match${entries.length === 1 ? "" : "es"}` : ""}`
      : "Load a map to see its buildings.";
  }

  function select(index: number | undefined) {
    const building = index === undefined ? undefined : data?.buildings[index];
    selected = building ? index : undefined;
    // A viewport pick should reveal its matching list entry even after a search.
    if (building && !Array.from(list.options).some((option) => option.value === String(index))) {
      search.value = "";
      renderList();
    }
    list.value = selected === undefined ? "" : String(selected);
    focus.disabled = clear.disabled = isolate.disabled = hideOthers.disabled = !building;
    if (remove) remove.disabled = !building || building.placementIndex === undefined || !building.chunkOrigin;
    if (!building) isolate.checked = hideOthers.checked = false;
    status.textContent = "";
    selectedBlock.hidden = !building;
    hint.hidden = Boolean(building);
    heading.textContent = building ? buildingLabel(building, index!, data) : "Building";
    details.innerHTML = building ? renderBuildingDetails(building, index!, data!, actions.editable) : "";
    setNewPosition(building);
  }

  function setNewPosition(building?: Map3dBuilding) {
    if (!data || !newChunk || !newModel || !newX || !newY || !newZ || !newRotation) return;
    if (building) {
      const chunkIndex = data.chunks.findIndex((chunk) => chunk.chunkId === building.chunkId && chunk.matrixX === building.chunkOrigin?.matrixX && chunk.matrixY === building.chunkOrigin?.matrixY);
      if (chunkIndex >= 0) newChunk.value = String(chunkIndex);
      newModel.value = String(building.uid);
    }
    const chunk = data.chunks[Number(newChunk.value)];
    newX.value = String(building ? building.worldX + 16 : chunk?.worldX ?? 0);
    newY.value = String(building?.worldY ?? chunk?.worldY ?? 0);
    newZ.value = String(building?.worldZ ?? chunk?.worldZ ?? 0);
    newRotation.value = String(building?.rotationY ?? 0);
  }

  remove?.addEventListener("click", () => {
    try {
      actions.remove();
      status.classList.remove("map3d-building-error");
      status.textContent = "";
    } catch (error) {
      status.classList.add("map3d-building-error");
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  newChunk?.addEventListener("change", () => setNewPosition());
  place?.addEventListener("click", () => {
    if (placing) { actions.place?.(undefined); return; }
    if (!newModel?.value) return;
    actions.place?.(Number(newModel.value));
  });
  host.querySelector("#map3d-building-add")?.addEventListener("click", () => {
    if (!createFields || !newChunk || !newModel || !newX || !newY || !newZ || !newRotation || !createStatus) return;
    try {
      if (![newChunk, newModel, newX, newY, newZ, newRotation].every((input) => input.value.trim() !== "" && input.reportValidity())) throw new Error("Complete each field with a valid value.");
      actions.add({ chunkIndex: Number(newChunk.value), uid: Number(newModel.value), worldX: Number(newX.value), worldY: Number(newY.value), worldZ: Number(newZ.value), rotationY: Number(newRotation.value) });
      createStatus.textContent = "";
      status.classList.remove("map3d-building-error");
      status.textContent = "Building added. Adjust its placement below.";
    } catch (error) {
      createStatus.classList.add("map3d-building-error");
      createStatus.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  search.addEventListener("input", renderList);
  list.addEventListener("change", () => actions.select(list.value === "" ? undefined : Number(list.value)));
  list.addEventListener("dblclick", () => { if (list.value !== "") actions.focus(); });
  focus.addEventListener("click", actions.focus);
  clear.addEventListener("click", () => actions.select(undefined));
  isolate.addEventListener("change", () => actions.isolate(isolate.checked));
  hideOthers.addEventListener("change", () => actions.hideOthers(hideOthers.checked));

  // Refresh dependent values without replacing the input being typed into.
  function refresh(skip?: Element) {
    if (selected === undefined || !data) return;
    const template = document.createElement("div");
    template.innerHTML = renderBuildingDetails(data.buildings[selected], selected, data, actions.editable);
    const values = template.querySelectorAll("dd");
    details.querySelectorAll("dd").forEach((cell, i) => {
      if (!skip || !cell.contains(skip)) cell.innerHTML = values[i].innerHTML;
    });
    const materials = details.querySelector("details");
    if (materials) materials.innerHTML = template.querySelector("details")!.innerHTML;
    renderList();
  }
  function edit(event: Event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement) || !input.dataset.buildingField) return;
    if (input instanceof HTMLSelectElement && event.type !== "change") return;
    try {
      if (input.value.trim() === "" || !input.validity.valid) throw new Error("Enter a valid number in the allowed range.");
      const changed = actions.edit(input.dataset.buildingField as Map3dBuildingField, Number(input.value));
      input.removeAttribute("aria-invalid");
      status.classList.remove("map3d-building-error");
      status.textContent = changed ? "Saved." : "";
      refresh(input);
    } catch (error) {
      input.setAttribute("aria-invalid", "true");
      status.classList.add("map3d-building-error");
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  }
  details.addEventListener("input", edit);
  details.addEventListener("change", (event) => { if (event.target instanceof HTMLSelectElement) edit(event); });
  details.addEventListener("focusout", (event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.dataset.buildingField && !input.hasAttribute("aria-invalid") && data && selected !== undefined) {
      const template = document.createElement("div");
      template.innerHTML = renderBuildingDetails(data.buildings[selected], selected, data, actions.editable);
      input.value = template.querySelector<HTMLInputElement>(`[data-building-field="${input.dataset.buildingField}"]`)!.value;
    }
  });
  return {
    select,
    refreshPlacements(index: number | undefined) {
      search.value = "";
      search.disabled = !data?.buildings.length;
      renderList();
      select(index);
    },
    setData(next: Map3dSceneData | undefined, message?: string) {
      data = next;
      selected = undefined;
      search.value = "";
      search.disabled = !next?.buildings.length;
      if (newModel && newChunk && createFields && createStatus) {
        newModel.innerHTML = (next?.buildingModels ?? []).map((model) => `<option value="${model.uid}">${escapeHtml(modelLabel(model.uid, next))}</option>`).join("");
        newChunk.innerHTML = (next?.chunks ?? []).map((chunk, i) => `<option value="${i}">Chunk ${chunk.chunkId} · Cell ${chunk.matrixX}, ${chunk.matrixY}</option>`).join("");
        createFields.disabled = !next?.buildingModels?.length || !next.chunks.length;
        createStatus.textContent = next && createFields.disabled ? "No building models or editable chunks are available for this map." : "";
        if (place) place.disabled = createFields.disabled;
      }
      renderList();
      select(undefined);
      if (message) hint.textContent = message;
      else if (next && !next.buildings.length) hint.textContent = next.buildingModels?.length ? (actions.editable ? "No buildings are placed here. Use + Building to place one." : "No buildings are placed here.") : "No building models are available for this map. Check the warnings below the map.";
      else hint.textContent = "Click a building on the map, or pick one from the list.";
    },
    /** Show whether the map is waiting for a click to place a building. */
    setPlacing(active: boolean) {
      placing = active;
      if (!place) return;
      place.setAttribute("aria-pressed", String(active));
      place.textContent = active ? "Click the map… (Esc)" : "+ Building";
    },
  };
}

function modelLabel(uid: number, data: Pick<Map3dSceneData, "buildingModels"> | undefined): string {
  const name = data?.buildingModels?.find((model) => model.uid === uid)?.name;
  return name ? `${name} (${uid})` : `Model ${uid}`;
}

function buildingLabel(building: Map3dBuilding, index: number, data?: Pick<Map3dSceneData, "buildingModels">): string {
  const model = building.modelId === undefined ? modelLabel(building.uid, data) : `Model ${building.modelId}`;
  return `${index + 1}. ${model} · Chunk ${building.chunkId}`;
}

export function renderBuildingDetails(building: Map3dBuilding, index: number, data: Pick<Map3dSceneData, "chunks" | "buildingsId" | "buildingModels">, editable = false): string {
  editable = editable && Boolean(building.chunkOrigin) && building.placementIndex !== undefined;
  const fields: [string, string | number, Map3dBuildingField?][] = [
    [building.modelId === undefined ? "Model UID" : "Model ID", building.modelId ?? building.uid, "uid"], ["Placement index", building.placementIndex ?? "Unavailable"],
    ["Chunk ID", building.chunkId], ["Source chunk ID", building.sourceChunkId], ["Building bundle", data.buildingsId],
    ["World X", building.worldX, "worldX"], ["World Y (height)", building.worldY, "worldY"], ["World Z", building.worldZ, "worldZ"],
    ["Rotation Y", building.rotationY, "rotationY"],
  ];
  if (building.modelId !== undefined && building.modelId !== building.uid) fields.splice(2, 0, ["UID", building.uid]);
  const chunks = data.chunks.filter((chunk) => chunk.chunkId === building.chunkId && chunk.sourceChunkId === building.sourceChunkId);
  const origin = building.chunkOrigin ?? (chunks.length === 1 ? { x: chunks[0].worldX, y: chunks[0].worldY ?? 0, z: chunks[0].worldZ, matrixX: chunks[0].matrixX, matrixY: chunks[0].matrixY } : undefined);
  if (origin) {
    fields.push(["Matrix cell", `${origin.matrixX}, ${origin.matrixY}`],
      ["Chunk-relative X", building.worldX - origin.x, "localX"],
      ["Chunk-relative Y", building.worldY - origin.y, "localY"],
      ["Chunk-relative Z", building.worldZ - origin.z, "localZ"]);
  }
  fields.push(["Triangles", building.triangleCount ?? building.primitives.reduce((sum, primitive) => sum + primitive.indices.length / 3, 0)]);
  const materials = [...new Set(building.primitives.map((primitive) => primitive.material.name))];
  const textures = [...new Set(building.primitives.flatMap((primitive) => {
    const texture = primitive.material.texture;
    return texture ? [`${texture.name} (${texture.width} × ${texture.height})`] : [];
  }))];
  return `<div class="map3d-building-note">${editable ? "Edits save as you type and affect every use of this chunk." : "Read-only placement data; editing supports BW and BW2."} 16 units per tile; Y is height.</div>
    <dl>${fields.map(([label, value, field]) => {
      let content = escapeHtml(`${typeof value === "number" ? formatNumber(value) : value}${field === "rotationY" ? "°" : ""}`);
      if (editable && field) {
        const attributes = `aria-label="${escapeHtml(label)}" data-building-field="${field}"`;
        content = field === "uid"
          ? `<select ${attributes}>${(data.buildingModels ?? []).map((model) => `<option value="${model.uid}"${model.uid === value ? " selected" : ""}>${escapeHtml(modelLabel(model.uid, data))}</option>`).join("")}</select>`
          : `<input type="number" ${attributes} value="${value}" step="any"${field === "rotationY" ? ' min="0" max="360"' : ""} />`;
      }
      return `<dt>${escapeHtml(label)}</dt><dd>${content}</dd>`;
    }).join("")}</dl>
    <details><summary>Materials (${materials.length}) / textures (${textures.length})</summary>
      <strong>Materials</strong><ul>${materials.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>
      <strong>Textures</strong>${textures.length ? `<ul>${textures.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>` : "<div>No decoded textures</div>"}
    </details>`;
}

function formatNumber(value: number): string {
  return String(value);
}

/** Pick visible geometry only, honoring terrain occlusion and hidden instances. */
export function pickMap3dBuilding(raycaster: THREE.Raycaster, buildings: THREE.Group, terrain: THREE.Group): number | undefined {
  const targets: THREE.Object3D[] = [];
  for (const group of [buildings, terrain]) {
    group.traverseVisible((object) => { if (object instanceof THREE.Mesh) targets.push(object); });
  }
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit) return undefined;
  let object: THREE.Object3D | null = hit.object;
  while (object && object !== buildings && object !== terrain) {
    const index: unknown = object.userData.map3dBuildingIndex;
    if (Number.isInteger(index)) return index as number;
    object = object.parent;
  }
  return undefined;
}
