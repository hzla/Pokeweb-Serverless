import {
  addOverworldNpc,
  deleteOverworldNpc,
  getOverworldScene,
  mapPermissionColor,
  moveOverworldNpc,
  NPC_FIELDS,
  updateMapTile,
  updateOverworldField,
  type OverworldMapScene,
  type OverworldNpc,
  type OverworldScene,
} from "../pokeweb/overworldModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml, selectText } from "./dom";
import { publicAsset } from "../assetUrl";

const TILE_SIZE = 32;

export function renderOverworldEditor(
  project: ProjectState,
  root: HTMLElement,
  overworldId: number,
  onDirty?: () => void,
  onBack?: () => void,
): void {
  let scene = getOverworldScene(project, overworldId);
  let selectedNpc: number | undefined = scene.npcs[0]?.index;
  let selectedTile: { mapId: number; index: number; layer2: number; layer3: number } | undefined;

  root.innerHTML = `
    <div class="pokemon-filter overworld-bar">
      <div class="overworld-info filterable" data-index="${overworldId}">
        <div class="filter-title">${escapeHtml(scene.locationName)}</div>
        <div class="overworld-subtitle">Overworld ${overworldId} / Matrix ${scene.matrixId}</div>
        ${NPC_FIELDS.map((field) => sidebarRow(field)).join("")}
      </div>
      <div class="sidebar-btns">
        <button class="ow-btn" id="add-npc" type="button">Add NPC</button>
        <button class="ow-btn" id="del-npc" type="button">Del Selected NPC</button>
      </div>
      <div class="sidebar-btns">
        <button class="ow-btn" id="back-headers" type="button">Back to Headers</button>
      </div>
      <div class="popup-editor field-holder" id="tile-editor">
        <div class="popup-field-row">
          <div class="popup-field-label">Flag</div>
          <div class="popup-field" data-layer="2" id="tile-flag" contenteditable="true" data-type="int-65535">0</div>
        </div>
        <div class="popup-field-row">
          <div class="popup-field-label">Movement</div>
          <div class="popup-field" data-layer="3" id="tile-mov" contenteditable="true" data-type="int-65535">0</div>
        </div>
      </div>
    </div>
    <div class="pokemon-list" id="overworld">
      <div class="overworld-toolbar">
        <button class="ow-tool" id="zoom-out" type="button">-</button>
        <button class="ow-tool" id="zoom-reset" type="button">100%</button>
        <button class="ow-tool" id="zoom-in" type="button">+</button>
      </div>
      <div class="overworld-stage">
        <canvas class="overworld-map" id="overworld-canvas"></canvas>
        <div class="overworld-entities" id="overworld-entities"></div>
      </div>
    </div>
  `;

  const stage = root.querySelector<HTMLDivElement>(".overworld-stage");
  const canvas = root.querySelector<HTMLCanvasElement>("#overworld-canvas");
  const entities = root.querySelector<HTMLDivElement>("#overworld-entities");
  const tileEditor = root.querySelector<HTMLDivElement>("#tile-editor");
  const zoomLabel = root.querySelector<HTMLButtonElement>("#zoom-reset");
  if (!stage || !canvas || !entities) return;
  const entityLayer = entities;

  const state = {
    zoom: 1,
    panX: 24,
    panY: 24,
    framed: false,
    draggingMap: false,
    dragStartX: 0,
    dragStartY: 0,
    dragPanX: 0,
    dragPanY: 0,
  };

  const reloadScene = () => {
    scene = getOverworldScene(project, overworldId);
    if (selectedNpc !== undefined && !scene.npcs.some((npc) => npc.index === selectedNpc)) selectedNpc = scene.npcs[0]?.index;
    renderNpcOverlay();
    fillSidebar();
    draw();
  };

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * scale));
    canvas.height = Math.max(1, Math.floor(rect.height * scale));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    if (!state.framed && rect.width > 1 && rect.height > 1) frameScene(rect);
    draw();
  };

  const frameScene = (rect = stage.getBoundingClientRect()) => {
    const npc = scene.npcs.find((entry) => entry.index === selectedNpc) ?? scene.npcs[0];
    const bounds = sceneBounds(scene, npc);
    const fitZoom = Math.min(1, Math.max(0.35, Math.min(rect.width / Math.max(1, bounds.width * TILE_SIZE), rect.height / Math.max(1, bounds.height * TILE_SIZE)) * 0.85));
    state.zoom = npc ? Math.max(0.5, fitZoom) : fitZoom;
    const centerX = npc ? npc.x + 0.5 : bounds.x + bounds.width / 2;
    const centerY = npc ? npc.y + 0.5 : bounds.y + bounds.height / 2;
    state.panX = rect.width / 2 - centerX * TILE_SIZE * state.zoom;
    state.panY = rect.height / 2 - centerY * TILE_SIZE * state.zoom;
    state.framed = true;
    updateZoomLabel();
  };

  const setZoom = (nextZoom: number, anchorX?: number, anchorY?: number) => {
    const rect = stage.getBoundingClientRect();
    const screenX = anchorX ?? rect.width / 2;
    const screenY = anchorY ?? rect.height / 2;
    const worldX = (screenX - state.panX) / (TILE_SIZE * state.zoom);
    const worldY = (screenY - state.panY) / (TILE_SIZE * state.zoom);
    state.zoom = Math.min(3, Math.max(0.35, nextZoom));
    state.panX = screenX - worldX * TILE_SIZE * state.zoom;
    state.panY = screenY - worldY * TILE_SIZE * state.zoom;
    updateZoomLabel();
    draw();
  };

  const updateZoomLabel = () => {
    if (zoomLabel) zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  };

  const worldToScreen = (x: number, y: number) => ({
    x: state.panX + x * TILE_SIZE * state.zoom,
    y: state.panY + y * TILE_SIZE * state.zoom,
    size: TILE_SIZE * state.zoom,
  });

  const screenToWorld = (clientX: number, clientY: number) => {
    const rect = stage.getBoundingClientRect();
    return {
      x: (clientX - rect.left - state.panX) / (TILE_SIZE * state.zoom),
      y: (clientY - rect.top - state.panY) / (TILE_SIZE * state.zoom),
    };
  };

  const draw = () => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scale = window.devicePixelRatio || 1;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, canvas.width / scale, canvas.height / scale);
    ctx.imageSmoothingEnabled = false;
    for (const map of scene.maps) drawMap(ctx, map, state.zoom, state.panX, state.panY);
    renderNpcOverlay();
  };

  function renderNpcOverlay(): void {
    entityLayer.innerHTML = scene.npcs.map((npc) => renderNpc(npc, worldToScreen, npc.index === selectedNpc)).join("");
    adjustSpriteDirections(entityLayer);
    entityLayer.querySelectorAll<HTMLDivElement>(".overworld-item").forEach((item) => {
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        selectedNpc = Number(item.dataset.npcIndex);
        renderNpcOverlay();
        fillSidebar();
      });
      item.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectedNpc = Number(item.dataset.npcIndex);
        item.setPointerCapture(event.pointerId);
        const npc = scene.npcs.find((entry) => entry.index === selectedNpc);
        if (!npc) return;
        const start = screenToWorld(event.clientX, event.clientY);
        const startX = npc.x;
        const startY = npc.y;
        const move = (moveEvent: PointerEvent) => {
          const next = screenToWorld(moveEvent.clientX, moveEvent.clientY);
          const dx = Math.round(next.x - start.x);
          const dy = Math.round(next.y - start.y);
          const x = Math.max(0, startX + dx);
          const y = Math.max(0, startY + dy);
          moveOverworldNpc(project, overworldId, npc.index, x, y, npc.z);
          scene = getOverworldScene(project, overworldId);
          renderNpcOverlay();
          fillSidebar();
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          onDirty?.();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
    });
  }

  const fillSidebar = () => {
    const npc = scene.npcs.find((entry) => entry.index === selectedNpc);
    root.querySelectorAll<HTMLElement>(".sidebar-val[data-field-name]").forEach((field) => {
      if (!npc) {
        field.textContent = "";
        return;
      }
      const name = field.dataset.baseField ?? "";
      const fullName = `npc_${npc.index}_${name}`;
      field.dataset.fieldName = fullName;
      field.textContent = String(scene.raw[fullName] ?? "");
    });
    const deleteButton = root.querySelector<HTMLButtonElement>("#del-npc");
    if (deleteButton) deleteButton.disabled = !npc;
  };

  root.querySelector<HTMLButtonElement>("#back-headers")?.addEventListener("click", () => onBack?.());
  root.querySelector<HTMLButtonElement>("#add-npc")?.addEventListener("click", () => {
    selectedNpc = addOverworldNpc(project, overworldId);
    reloadScene();
    onDirty?.();
  });
  root.querySelector<HTMLButtonElement>("#del-npc")?.addEventListener("click", () => {
    if (selectedNpc === undefined) return;
    deleteOverworldNpc(project, overworldId, selectedNpc);
    selectedNpc = undefined;
    reloadScene();
    onDirty?.();
  });

  root.querySelectorAll<HTMLElement>(".sidebar-val[contenteditable='true']").forEach((field) => {
    let initial = "";
    field.addEventListener("focus", () => {
      initial = field.textContent?.trim() ?? "";
      selectText(field);
    });
    field.addEventListener("keypress", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        field.blur();
      }
    });
    field.addEventListener("focusout", () => {
      const name = field.dataset.fieldName;
      if (!name) return;
      const next = field.textContent?.trim() ?? "";
      if (next === initial) return;
      try {
        const value = updateOverworldField(project, overworldId, name, next);
        field.textContent = String(value);
        reloadScene();
        onDirty?.();
      } catch {
        field.textContent = initial;
        field.classList.add("invalid");
        window.setTimeout(() => field.classList.remove("invalid"), 800);
      }
    });
  });

  root.querySelectorAll<HTMLElement>(".popup-field[contenteditable='true']").forEach((field) => {
    let initial = "";
    field.addEventListener("focus", () => {
      initial = field.textContent?.trim() ?? "";
      selectText(field);
    });
    field.addEventListener("keypress", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        field.blur();
      }
    });
    field.addEventListener("focusout", () => {
      if (!selectedTile) return;
      const layer = Number(field.dataset.layer) as 2 | 3;
      const next = field.textContent?.trim() ?? "";
      if (next === initial) return;
      try {
        const value = updateMapTile(project, selectedTile.mapId, selectedTile.index, layer, next);
        field.textContent = String(value);
        reloadScene();
        selectedTile = { ...selectedTile, [layer === 2 ? "layer2" : "layer3"]: value };
        onDirty?.();
      } catch {
        field.textContent = initial;
      }
    });
  });

  canvas.addEventListener("pointerdown", (event) => {
    state.draggingMap = true;
    state.dragStartX = event.clientX;
    state.dragStartY = event.clientY;
    state.dragPanX = state.panX;
    state.dragPanY = state.panY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!state.draggingMap) return;
    state.panX = state.dragPanX + event.clientX - state.dragStartX;
    state.panY = state.dragPanY + event.clientY - state.dragStartY;
    draw();
  });
  canvas.addEventListener("pointerup", (event) => {
    const moved = Math.abs(event.clientX - state.dragStartX) + Math.abs(event.clientY - state.dragStartY);
    state.draggingMap = false;
    if (moved < 4) {
      selectedTile = tileAt(scene, screenToWorld(event.clientX, event.clientY));
      if (selectedTile && tileEditor) {
        tileEditor.style.display = "block";
        root.querySelector<HTMLElement>("#tile-flag")!.textContent = String(selectedTile.layer2);
        root.querySelector<HTMLElement>("#tile-mov")!.textContent = String(selectedTile.layer3);
      }
    }
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      setZoom(state.zoom + (event.deltaY < 0 ? 0.1 : -0.1), event.clientX - rect.left, event.clientY - rect.top);
    },
    { passive: false },
  );

  root.querySelector<HTMLButtonElement>("#zoom-in")?.addEventListener("click", () => {
    setZoom(state.zoom + 0.1);
  });
  root.querySelector<HTMLButtonElement>("#zoom-out")?.addEventListener("click", () => {
    setZoom(state.zoom - 0.1);
  });
  root.querySelector<HTMLButtonElement>("#zoom-reset")?.addEventListener("click", () => {
    state.framed = false;
    frameScene();
    draw();
  });

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  window.addEventListener("resize", resize, { once: false });
  fillSidebar();
  resize();
  window.requestAnimationFrame(resize);
}

function sidebarRow(field: string): string {
  const editable = field === "overworld_id" ? "false" : "true";
  return `
    <div class="sidebar-row">
      <div class="sidebar-label">${escapeHtml(field)}</div>
      <div class="sidebar-val" data-base-field="${escapeHtml(field)}" data-narc="overworld" contenteditable="${editable}" data-field-name="" data-type="int-65535"></div>
    </div>
  `;
}

function drawMap(context: CanvasRenderingContext2D, map: OverworldMapScene, zoom: number, panX: number, panY: number): void {
  const size = TILE_SIZE * zoom;
  const startX = panX + map.x * size;
  const startY = panY + map.y * size;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const index = y * map.width + x;
      const permission = map.layer2[index] ?? 0;
      context.fillStyle = mapPermissionColor(permission).color;
      context.fillRect(startX + x * size, startY + y * size, Math.ceil(size), Math.ceil(size));
      context.strokeStyle = "rgba(40, 42, 54, 0.35)";
      context.strokeRect(startX + x * size, startY + y * size, size, size);
    }
  }
  context.strokeStyle = "#bd93f9";
  context.lineWidth = 2;
  context.strokeRect(startX, startY, map.width * size, map.height * size);
}

function renderNpc(
  npc: OverworldNpc,
  worldToScreen: (x: number, y: number) => { x: number; y: number; size: number },
  selected: boolean,
): string {
  const position = worldToScreen(npc.x, npc.y);
  return `
    <div class="overworld-item ${selected ? "selected" : ""}" data-npc-index="${npc.index}" data-dir="${npc.direction}" title="npc-${npc.index}"
      style="left:${position.x}px;top:${position.y}px;width:${position.size}px;height:${position.size}px">
      <img class="overworld-sprite" src="${publicAsset(`images/overworlds/${npc.spriteSlug}.png`)}" alt="" onerror="this.hidden=true;this.parentElement?.classList.add('missing-sprite')" />
      <span>${npc.overworldId}</span>
    </div>
  `;
}

function adjustSpriteDirections(root: HTMLElement): void {
  root.querySelectorAll<HTMLImageElement>(".overworld-sprite").forEach((image) => {
    const apply = () => {
      const frameCount = Math.round(image.naturalHeight / 32);
      const direction = Number(image.parentElement?.dataset.dir ?? 0);
      const frameSize = image.parentElement?.getBoundingClientRect().width ?? 32;
      const offset = spriteDirectionOffset(frameCount, direction);
      image.style.transform = "";
      if (offset === "f") {
        image.style.top = `${-5 * frameSize}px`;
        image.style.transform = "scaleX(-1)";
      } else {
        image.style.top = `${-offset * frameSize}px`;
      }
    };
    if (image.complete && image.naturalHeight > 0) apply();
    else image.addEventListener("load", apply, { once: true });
  });
}

function spriteDirectionOffset(frameCount: number, direction: number): number | "f" {
  let offsets: Array<number | "f"> = [0, 0, 0, 0];
  if (frameCount >= 12) offsets = [0, 3, 6, 9];
  if (frameCount === 16) offsets = [0, 4, 8, 12];
  if (frameCount === 2) offsets = [0, 4, 8, 12];
  if (frameCount === 6 || frameCount === 7 || frameCount === 9) offsets = [0, 3, 5, "f"];
  return offsets[Math.min(Math.max(direction, 0), offsets.length - 1)] ?? 0;
}

function tileAt(scene: OverworldScene, point: { x: number; y: number }): { mapId: number; index: number; layer2: number; layer3: number } | undefined {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  for (const map of scene.maps) {
    const localX = x - map.x;
    const localY = y - map.y;
    if (localX < 0 || localY < 0 || localX >= map.width || localY >= map.height) continue;
    const index = localY * map.width + localX;
    return {
      mapId: map.id,
      index,
      layer2: map.layer2[index] ?? 0,
      layer3: map.layer3[index] ?? 0,
    };
  }
  return undefined;
}

function sceneBounds(scene: OverworldScene, focusNpc?: OverworldNpc): { x: number; y: number; width: number; height: number } {
  const xs = scene.maps.flatMap((map) => [map.x, map.x + map.width]);
  const ys = scene.maps.flatMap((map) => [map.y, map.y + map.height]);
  if (focusNpc) {
    xs.push(focusNpc.x - 8, focusNpc.x + 8);
    ys.push(focusNpc.y - 8, focusNpc.y + 8);
  }
  if (xs.length === 0 || ys.length === 0) return { x: 0, y: 0, width: 32, height: 32 };
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, Math.max(...xs) - minX),
    height: Math.max(1, Math.max(...ys) - minY),
  };
}
