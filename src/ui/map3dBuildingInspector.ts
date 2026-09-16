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
};

export function createMap3dBuildingInspector(host: HTMLElement, actions: InspectorActions) {
  host.innerHTML = `
    <strong>Building Inspector</strong>
    <div class="map3d-building-note" id="map3d-building-count">Load a map to inspect its placed buildings.</div>
    <input class="filter-input" id="map3d-building-search" type="search" aria-label="Search buildings" placeholder="Search model, placement, chunk" disabled />
    <select class="filter-input map3d-building-list" id="map3d-building-list" aria-label="Placed buildings" size="5" disabled></select>
    <div class="map3d-building-actions">
      <button class="ow-tool" id="map3d-building-focus" type="button" disabled>Focus</button>
      <button class="ow-tool" id="map3d-building-clear" type="button" disabled>Clear</button>
    </div>
    ${actions.editable ? `<button class="ow-tool map3d-building-delete" id="map3d-building-delete" type="button" disabled>Delete selected building</button>
    <details class="map3d-building-create" id="map3d-building-create">
      <summary>Add a building</summary>
      <fieldset id="map3d-building-new-fields" disabled>
        <label>Model UID<select id="map3d-building-new-model" aria-label="New building model" required></select></label>
        <label>Map chunk<select id="map3d-building-new-chunk" aria-label="New building chunk" required></select></label>
        ${["X", "Y", "Z"].map((axis) => `<label>World ${axis}${axis === "Y" ? " (height)" : ""}<input id="map3d-building-new-${axis.toLowerCase()}" type="number" aria-label="New building world ${axis}" step="any" required /></label>`).join("")}
        <label>Rotation Y<input id="map3d-building-new-rotation" type="number" aria-label="New building rotation Y" min="0" max="360" step="any" value="0" required /></label>
        <button class="ow-tool" id="map3d-building-add" type="button">Add building</button>
      </fieldset>
      <div class="map3d-building-note">Choose a model and chunk, then position it in game units. Defaults are beside the selection, or at the chunk center. Changes affect every use of this chunk. Collision tiles and warps are edited separately.</div>
      <div id="map3d-building-create-status" class="map3d-building-note" role="status"></div>
    </details>` : ""}
    <label class="map3d-check"><input id="map3d-building-isolate" type="checkbox" disabled /> Isolate selected building</label>
    <label class="map3d-check"><input id="map3d-building-hide-others" type="checkbox" disabled /> Hide other buildings</label>
    <div class="map3d-building-note">Hide other buildings keeps the map visible.</div>
    <div id="map3d-building-details" class="map3d-building-details">Select a building from the list or click it in the map. Turn off the collision overlay to pick buildings.</div>
    <div id="map3d-building-edit-status" class="map3d-building-note" role="status"></div>
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
  let data: Map3dSceneData | undefined;
  let selected: number | undefined;

  function renderList() {
    const query = search.value.trim().toLowerCase();
    const entries = data?.buildings.flatMap((building, index) => {
      const label = buildingLabel(building, index);
      return !query || `${label} uid ${building.uid} source ${building.sourceChunkId}`.toLowerCase().includes(query)
        ? [`<option value="${index}">${escapeHtml(label)}</option>`] : [];
    }) ?? [];
    list.innerHTML = entries.join("");
    list.value = selected === undefined ? "" : String(selected);
    list.disabled = entries.length === 0;
    count.textContent = data
      ? `${data.buildings.length} loaded placements${data.buildingPlacementCount === undefined ? "" : ` / ${data.buildingPlacementCount} total`}${query ? ` · ${entries.length} matches` : ""}`
      : "Load a map to inspect its placed buildings.";
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
    details.innerHTML = building
      ? renderBuildingDetails(building, index!, data!, actions.editable)
      : "Select a building from the list or click it in the map. Turn off the collision overlay to pick buildings.";
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
      status.textContent = "Building deleted. Changes are saved with the project.";
    } catch (error) {
      status.classList.add("map3d-building-error");
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  newChunk?.addEventListener("change", () => setNewPosition());
  host.querySelector("#map3d-building-add")?.addEventListener("click", () => {
    if (!createFields || !newChunk || !newModel || !newX || !newY || !newZ || !newRotation || !createStatus) return;
    try {
      if (![newChunk, newModel, newX, newY, newZ, newRotation].every((input) => input.value.trim() !== "" && input.reportValidity())) throw new Error("Complete each field with a valid value.");
      actions.add({ chunkIndex: Number(newChunk.value), uid: Number(newModel.value), worldX: Number(newX.value), worldY: Number(newY.value), worldZ: Number(newZ.value), rotationY: Number(newRotation.value) });
      host.querySelector<HTMLDetailsElement>("#map3d-building-create")!.open = false;
      createStatus.textContent = "";
      status.classList.remove("map3d-building-error");
      status.textContent = "Building added and selected. Adjust its placement below.";
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
      status.textContent = changed ? "Placement updated. Changes are saved with the project." : "";
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
        newModel.innerHTML = (next?.buildingModels ?? []).map((model) => `<option value="${model.uid}">UID ${model.uid}</option>`).join("");
        newChunk.innerHTML = (next?.chunks ?? []).map((chunk, i) => `<option value="${i}">Chunk ${chunk.chunkId} · Cell ${chunk.matrixX}, ${chunk.matrixY}</option>`).join("");
        createFields.disabled = !next?.buildingModels?.length || !next.chunks.length;
        createStatus.textContent = next && createFields.disabled ? "No building models or editable chunks are available for this map." : "";
      }
      renderList();
      select(undefined);
      if (message) details.textContent = message;
      else if (next && !next.buildings.length) details.textContent = next.buildingModels?.length ? "No buildings are placed here. Use Add a building to place one." : "No building models are available for this map. Check the map diagnostics for missing resources.";
    },
  };
}

function buildingLabel(building: Map3dBuilding, index: number): string {
  const model = building.modelId === undefined ? `UID ${building.uid}` : `Model ${building.modelId}`;
  return `${index + 1}. ${model} · Chunk ${building.chunkId} · Placement ${building.placementIndex ?? "?"}`;
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
  return `<strong>Building ${index + 1}</strong>
    <div class="map3d-building-note">${editable ? "Edit placements to update the preview immediately." : "Read-only placement data; editing supports BW/BW2."} Coordinates use game units (16 per tile); Y is height.${editable ? " Edits affect every use of this chunk. Positions snap to 1/4096 of a unit; rotation uses the game's precision." : ""}</div>
    <dl>${fields.map(([label, value, field]) => {
      let content = escapeHtml(`${typeof value === "number" ? formatNumber(value) : value}${field === "rotationY" ? "°" : ""}`);
      if (editable && field) {
        const attributes = `aria-label="${escapeHtml(label)}" data-building-field="${field}"`;
        content = field === "uid"
          ? `<select ${attributes}>${(data.buildingModels ?? []).map((model) => `<option value="${model.uid}"${model.uid === value ? " selected" : ""}>${model.uid}</option>`).join("")}</select>`
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
