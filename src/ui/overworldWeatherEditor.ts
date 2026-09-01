import type { ProjectState } from "../pokeweb/projectStore";
import {
  assignWeatherToArea,
  assignWeatherToAreas,
  getAssignableWeatherEffects,
  getHeaderWeatherId,
  getWeatherEffects,
  installOverworldWeatherBundle,
  loadOverworldWeatherCalendar,
  loadOverworldWeatherPreview,
  nitroCellEffectFrameAt,
  parseOverworldWeatherBundle,
  weatherCalendarDate,
  weatherCalendarUsageCounts,
  weatherUsageCounts,
  type OverworldWeatherCalendar,
  type OverworldWeatherPreview,
  type WeatherCalendarRange,
  type WeatherCalendarZone,
  type WeatherEffectDefinition,
  type WeatherPreviewBehavior,
} from "../pokeweb/overworldWeatherModel";
import type { WeatherLightingRecord } from "../pokeweb/overworldWeatherLightingModel";
import { normalizeWeatherCloneRuntime, previewFogStrength, type WeatherCloneRuntime } from "../pokeweb/overworldWeatherRuntimeModel";
import { escapeHtml } from "./dom";
import { renderWeatherResourceFootprint } from "./weatherResourceFootprint";

let activeWeatherEditorStop: (() => void) | undefined;

export function stopOverworldWeatherEditorPreview(): void {
  activeWeatherEditorStop?.();
  activeWeatherEditorStop = undefined;
}

export function renderOverworldWeatherEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): () => void {
  stopOverworldWeatherEditorPreview();
  if (!project.headers) throw new Error("Header data has not been parsed");
  let selectedEffectId = 0;
  let searchText = "";
  let weatherFilter = "all";
  const selectedRows = new Set<number>();
  let stopPreview = () => {};
  let previewRequest = 0;
  let calendar: OverworldWeatherCalendar | undefined;
  let calendarError = "";
  let disposed = false;

  const renderPage = (message = "", isError = false): void => {
    stopPreview();
    const effects = getWeatherEffects(project);
    const assignable = getAssignableWeatherEffects(project);
    const headerCounts = weatherUsageCounts(project);
    const calendarCounts = calendar ? weatherCalendarUsageCounts(calendar) : new Map<number, number>();
    const selectedEffect = effects.find((effect) => effect.id === selectedEffectId) ?? effects[0];
    selectedEffectId = selectedEffect?.id ?? 0;
    root.innerHTML = `
      <div class="overworld-weather-page">
        <aside class="overworld-weather-sidebar">
          <div>
            <div class="filter-title">Overworld Weather</div>
            <p class="weather-help">Edit each zone header's fallback effect. When the save season matches the RTC season, BW2's daily calendar schedule takes precedence; event, birthday, moving-Pokémon, and special-area weather can override both.</p>
          </div>
          ${renderWeatherResourceFootprint([
            { access: "write", target: project.narcs.headers?.sourcePath ?? "a/0/1/2", description: "Zone header weather IDs" },
            { access: "read", target: "a/0/9/6", description: "366-day calendar schedules" },
            { access: "read", target: "a/0/5/5", description: "Particle resources used by previews" },
            { access: "runtime", target: "overlay 36", description: "Field weather selection and dispatch; not rewritten here" },
            { access: "runtime", target: "overlays 74–78", description: "Retail effect families; executed, not rewritten here" },
          ], `To transplant area assignments, copy ${project.narcs.headers?.sourcePath ?? "a/0/1/2"}. The calendar and preview NARCs are read-only here. Imported bundles may declare additional files in their manifests.`)}
          <label class="weather-field-label" for="weather-preview-effect">Effect preview</label>
          <select class="filter-input" id="weather-preview-effect">
            ${effects.map((effect) => `<option value="${effect.id}" ${effect.id === selectedEffectId ? "selected" : ""}>${effect.id}: ${escapeHtml(effect.name)}</option>`).join("")}
          </select>
          <div id="weather-preview-detail">${selectedEffect ? renderEffectDetail(selectedEffect, headerCounts.get(selectedEffect.id) ?? 0, calendarCounts.get(selectedEffect.id) ?? 0) : ""}</div>
          <div class="weather-preview-frame" id="weather-preview-frame">
            <canvas id="weather-preview-canvas" width="256" height="192" aria-label="Animated overworld weather preview"></canvas>
            <div class="weather-preview-label">Approximate 256 × 192 field preview</div>
          </div>
          <div class="weather-preview-warning" id="weather-preview-warning"></div>
          <button class="btn -default" id="weather-import-button" type="button">Import .pwwweather bundle</button>
          <input id="weather-import-input" type="file" accept=".pwwweather,.zip,application/zip" hidden />
          <p class="weather-help weather-import-help">Custom IDs 15–63 require runtime support. Install the one-time White 2 PWTH expansion in Code Injection, then create registry-backed clones in Weather Graphics; imported bundles may also provide their own runtime.</p>
          <div class="weather-status ${isError ? "-error" : ""}" id="weather-status" role="status">${escapeHtml(message)}</div>
        </aside>

        <main class="overworld-weather-areas">
          <div class="weather-calendar-notice ${calendarError ? "-error" : calendar ? "-loaded" : "-loading"}">
            ${calendarError
              ? `<strong>Calendar schedules unavailable.</strong> ${escapeHtml(calendarError)} Filters currently use header defaults only.`
              : calendar
                ? `<strong>${calendar.zones.size} calendar-managed areas loaded.</strong> Effect filters include both header defaults and the ROM's daily schedules. Open a schedule to see its exact Gen V season and date ranges.`
                : `<strong>Loading calendar schedules…</strong> Header defaults are visible now; effective weather filters will update automatically.`}
          </div>
          <div class="weather-area-toolbar">
            <input class="filter-input" id="weather-area-search" type="search" value="${escapeHtml(searchText)}" placeholder="Search area name or ID" />
            <select class="filter-input" id="weather-area-filter">
              <option value="all">All effective effects</option>
              ${effects.map((effect) => `<option value="${effect.id}" ${weatherFilter === String(effect.id) ? "selected" : ""}>${effect.id}: ${escapeHtml(effect.name)}</option>`).join("")}
            </select>
            <button class="btn -default" id="weather-select-visible" type="button">Select visible</button>
            <button class="btn -default" id="weather-clear-selection" type="button">Clear</button>
          </div>
          <div class="weather-bulk-bar">
            <strong><span id="weather-selection-count">${selectedRows.size}</span> selected</strong>
            <select class="filter-input" id="weather-bulk-effect">${assignable.map((effect) => `<option value="${effect.id}">${effect.id}: ${escapeHtml(effect.name)}</option>`).join("")}</select>
            <button class="btn -default" id="weather-apply-selected" type="button" ${selectedRows.size ? "" : "disabled"}>Apply to selected</button>
          </div>
          <div class="weather-area-table">
            <div class="weather-area-row -header">
              <div></div><div>Area ID</div><div>Matrix ID</div><div>Location</div><div>Header default</div><div>Effective calendar schedule</div><div>Preview</div>
            </div>
            ${Object.entries(project.headers!.rows).map(([rowIdText, row]) => {
              const rowId = Number(rowIdText);
              const weatherId = getHeaderWeatherId(row);
              const effect = effects.find((candidate) => candidate.id === weatherId);
              const calendarZone = calendar?.zones.get(Number(row.index));
              const effectiveWeatherIds = [...new Set([weatherId, ...(calendarZone?.weatherIds ?? [])])].sort((a, b) => a - b);
              return `
                <div class="weather-area-row" data-weather-row="${rowId}" data-weather-ids="${effectiveWeatherIds.join(" ")}" data-search="${escapeHtml(`${row.index} ${rowId} ${row.matrix_id} ${row.location_name}`.toLowerCase())}">
                  <label class="weather-row-check"><input type="checkbox" data-weather-select="${rowId}" ${selectedRows.has(rowId) ? "checked" : ""} /><span class="sr-only">Select ${escapeHtml(String(row.location_name))}</span></label>
                  <div class="weather-area-id">${row.index}</div>
                  <div class="weather-matrix-id">${escapeHtml(String(row.matrix_id))}</div>
                  <div class="weather-area-name">${escapeHtml(String(row.location_name))}</div>
                  <select class="filter-input weather-area-select" data-weather-assignment="${rowId}">${assignmentOptions(assignable, weatherId, effect)}</select>
                  <div class="weather-calendar-cell">${renderCalendarSchedule(calendarZone, effects, Boolean(calendar), calendarError)}</div>
                  <button class="weather-preview-link" type="button" data-preview-weather="${weatherId}" title="Preview this effect">Preview</button>
                </div>`;
            }).join("")}
          </div>
          <div class="weather-no-rows" id="weather-no-rows" hidden>No areas match the current filters.</div>
        </main>
      </div>`;

    const previewSelect = root.querySelector<HTMLSelectElement>("#weather-preview-effect");
    previewSelect?.addEventListener("change", () => {
      selectedEffectId = Number(previewSelect.value);
      void refreshPreview();
    });
    root.querySelectorAll<HTMLButtonElement>("[data-preview-weather]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedEffectId = Number(button.dataset.previewWeather);
        if (previewSelect) previewSelect.value = String(selectedEffectId);
        void refreshPreview();
      });
    });

    const search = root.querySelector<HTMLInputElement>("#weather-area-search");
    const filter = root.querySelector<HTMLSelectElement>("#weather-area-filter");
    search?.addEventListener("input", () => {
      searchText = search.value;
      applyFilters(root, searchText, weatherFilter);
    });
    filter?.addEventListener("change", () => {
      weatherFilter = filter.value;
      applyFilters(root, searchText, weatherFilter);
      if (weatherFilter !== "all") {
        selectedEffectId = Number(weatherFilter);
        if (previewSelect) previewSelect.value = weatherFilter;
        void refreshPreview();
      }
    });
    root.querySelectorAll<HTMLInputElement>("[data-weather-select]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const rowId = Number(checkbox.dataset.weatherSelect);
        if (checkbox.checked) selectedRows.add(rowId);
        else selectedRows.delete(rowId);
        updateSelectionControls(root, selectedRows.size);
      });
    });
    root.querySelector<HTMLButtonElement>("#weather-select-visible")?.addEventListener("click", () => {
      root.querySelectorAll<HTMLElement>("[data-weather-row]").forEach((row) => {
        if (row.hidden) return;
        const rowId = Number(row.dataset.weatherRow);
        selectedRows.add(rowId);
        const checkbox = row.querySelector<HTMLInputElement>("[data-weather-select]");
        if (checkbox) checkbox.checked = true;
      });
      updateSelectionControls(root, selectedRows.size);
    });
    root.querySelector<HTMLButtonElement>("#weather-clear-selection")?.addEventListener("click", () => {
      selectedRows.clear();
      root.querySelectorAll<HTMLInputElement>("[data-weather-select]").forEach((checkbox) => { checkbox.checked = false; });
      updateSelectionControls(root, 0);
    });
    root.querySelector<HTMLButtonElement>("#weather-apply-selected")?.addEventListener("click", () => {
      const weatherId = Number(root.querySelector<HTMLSelectElement>("#weather-bulk-effect")?.value ?? 0);
      const changed = assignWeatherToAreas(project, selectedRows, weatherId);
      selectedEffectId = weatherId;
      if (changed) onDirty?.();
      renderPage(changed ? `Applied weather ${weatherId} to ${changed} area${changed === 1 ? "" : "s"}.` : "The selected areas already use that weather.");
      applyFilters(root, searchText, weatherFilter);
    });
    root.querySelectorAll<HTMLSelectElement>("[data-weather-assignment]").forEach((select) => {
      select.addEventListener("change", () => {
        try {
          const rowId = Number(select.dataset.weatherAssignment);
          const weatherId = Number(select.value);
          assignWeatherToArea(project, rowId, weatherId);
          selectedEffectId = weatherId;
          onDirty?.();
          renderPage(`Updated area ${project.headers!.rows[rowId]?.index ?? rowId}.`);
          applyFilters(root, searchText, weatherFilter);
        } catch (error) {
          renderPage(error instanceof Error ? error.message : String(error), true);
        }
      });
    });

    const importInput = root.querySelector<HTMLInputElement>("#weather-import-input");
    root.querySelector<HTMLButtonElement>("#weather-import-button")?.addEventListener("click", () => importInput?.click());
    importInput?.addEventListener("change", async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      const button = root.querySelector<HTMLButtonElement>("#weather-import-button");
      if (button) { button.disabled = true; button.textContent = "Importing…"; }
      try {
        const parsed = parseOverworldWeatherBundle(new Uint8Array(await file.arrayBuffer()), file.name, project.session.baseVersion);
        const existing = project.overworldWeather?.customEffects.find((effect) => effect.id === parsed.manifest.id);
        const replaceExisting = existing ? window.confirm(`Replace installed weather ${existing.id}: ${existing.name}?`) : false;
        if (existing && !replaceExisting) {
          renderPage("Import cancelled.");
          return;
        }
        const installed = await installOverworldWeatherBundle(project, parsed, { replaceExisting });
        selectedEffectId = installed.id;
        onDirty?.();
        renderPage(`Imported weather ${installed.id}: ${installed.name}. It is now available for area assignment.`);
      } catch (error) {
        renderPage(error instanceof Error ? error.message : String(error), true);
      }
    });
    applyFilters(root, searchText, weatherFilter);
    queueMicrotask(() => { void refreshPreview(); });
  };

  const refreshPreview = async (): Promise<void> => {
    const request = ++previewRequest;
    stopPreview();
    const effect = getWeatherEffects(project).find((candidate) => candidate.id === selectedEffectId);
    const detail = root.querySelector<HTMLElement>("#weather-preview-detail");
    if (detail && effect) {
      detail.innerHTML = renderEffectDetail(
        effect,
        weatherUsageCounts(project).get(effect.id) ?? 0,
        calendar ? weatherCalendarUsageCounts(calendar).get(effect.id) ?? 0 : 0,
      );
    }
    const warning = root.querySelector<HTMLElement>("#weather-preview-warning");
    if (warning) warning.textContent = "Loading preview graphics…";
    const preview = await loadOverworldWeatherPreview(project, selectedEffectId);
    if (request !== previewRequest || !root.isConnected) return;
    stopPreview = mountWeatherPreview(root, preview);
  };

  renderPage();
  void loadOverworldWeatherCalendar(project).then((loaded) => {
    if (disposed) return;
    calendar = loaded;
    renderPage();
  }).catch((error: unknown) => {
    if (disposed) return;
    calendarError = error instanceof Error ? error.message : String(error);
    renderPage();
  });
  const stop = () => { disposed = true; previewRequest += 1; stopPreview(); };
  activeWeatherEditorStop = stop;
  return stop;
}

function renderEffectDetail(effect: WeatherEffectDefinition, headerCount: number, calendarCount: number): string {
  const badge = effect.status === "stock" ? "Retail" : effect.status === "dormant" ? "Dormant / patch required" : "Imported custom";
  return `
    <div class="weather-effect-detail">
      <div class="weather-effect-title"><strong>${escapeHtml(effect.name)}</strong><span class="weather-badge -${effect.status}">${badge}</span></div>
      <p>${escapeHtml(effect.description)}</p>
      <div class="weather-effect-meta">ID ${effect.id} · ${headerCount} header default${headerCount === 1 ? "" : "s"} · ${calendarCount} calendar schedule${calendarCount === 1 ? "" : "s"}${effect.channels.length ? ` · ${escapeHtml(effect.channels.join(", "))}` : ""}</div>
    </div>`;
}

function renderCalendarSchedule(zone: WeatherCalendarZone | undefined, effects: WeatherEffectDefinition[], calendarLoaded: boolean, calendarError: string): string {
  if (calendarError) return `<span class="weather-calendar-placeholder -error">Unavailable</span>`;
  if (!calendarLoaded) return `<span class="weather-calendar-placeholder">Loading…</span>`;
  if (!zone) return `<span class="weather-calendar-placeholder">Header default · year-round</span>`;
  const effectById = new Map(effects.map((effect) => [effect.id, effect]));
  const names = zone.weatherIds.map((weatherId) => effectById.get(weatherId)?.name ?? `Weather ${weatherId}`);
  return `
    <details class="weather-calendar-details">
      <summary><span class="weather-calendar-source">Calendar</span><span class="weather-calendar-effects">${escapeHtml(names.join(" · "))}</span></summary>
      <div class="weather-calendar-groups">
        ${zone.weatherIds.map((weatherId) => {
          const effect = effectById.get(weatherId);
          const ranges = zone.ranges.filter((range) => range.weatherId === weatherId);
          return `
            <div class="weather-calendar-group" data-calendar-weather="${weatherId}">
              <strong>${weatherId}: ${escapeHtml(effect?.name ?? "Unregistered weather")}</strong>
              <span>${ranges.map(weatherCalendarRangeLabel).join(", ")}</span>
            </div>`;
        }).join("")}
      </div>
    </details>`;
}

function weatherCalendarRangeLabel(range: WeatherCalendarRange): string {
  const start = weatherCalendarDate(range.startDayIndex);
  const end = weatherCalendarDate(range.endDayIndex);
  const startLabel = calendarDateLabel(start.month, start.day);
  const endLabel = start.month === end.month ? String(end.day) : calendarDateLabel(end.month, end.day);
  const dateRange = range.startDayIndex === range.endDayIndex ? startLabel : `${startLabel}–${endLabel}`;
  const season = start.season === end.season ? start.season : `${start.season}→${end.season}`;
  return `<span class="weather-calendar-range" title="${escapeHtml(`${season} in the Gen V seasonal cycle`)}">${escapeHtml(dateRange)} <em>${escapeHtml(season)}</em></span>`;
}

function calendarDateLabel(month: number, day: number): string {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${monthNames[month - 1] ?? month} ${day}`;
}

function assignmentOptions(assignable: WeatherEffectDefinition[], currentId: number, current: WeatherEffectDefinition | undefined): string {
  const options = assignable.map((effect) => `<option value="${effect.id}" ${effect.id === currentId ? "selected" : ""}>${effect.id}: ${escapeHtml(effect.name)}</option>`);
  if (!assignable.some((effect) => effect.id === currentId)) options.unshift(`<option value="${currentId}" selected disabled>${currentId}: ${escapeHtml(current?.name ?? "Unregistered / unsafe")}</option>`);
  return options.join("");
}

function applyFilters(root: HTMLElement, searchText: string, weatherFilter: string): void {
  const search = searchText.trim().toLowerCase();
  let visible = 0;
  root.querySelectorAll<HTMLElement>("[data-weather-row]").forEach((row) => {
    const matchesSearch = !search || (row.dataset.search ?? "").includes(search);
    const effectiveWeatherIds = (row.dataset.weatherIds ?? "").split(/\s+/u).filter(Boolean);
    const matchesWeather = weatherFilter === "all" || effectiveWeatherIds.includes(weatherFilter);
    row.hidden = !(matchesSearch && matchesWeather);
    if (!row.hidden) visible += 1;
    const details = row.querySelector<HTMLDetailsElement>(".weather-calendar-details");
    row.querySelectorAll<HTMLElement>("[data-calendar-weather]").forEach((group) => {
      group.hidden = weatherFilter !== "all" && group.dataset.calendarWeather !== weatherFilter;
    });
    if (details && weatherFilter !== "all" && effectiveWeatherIds.includes(weatherFilter)) {
      if (details.querySelector(`[data-calendar-weather="${weatherFilter}"]`)) {
        details.open = true;
        details.dataset.filterOpened = "true";
      }
    } else if (details?.dataset.filterOpened) {
      details.open = false;
      delete details.dataset.filterOpened;
    }
  });
  const empty = root.querySelector<HTMLElement>("#weather-no-rows");
  if (empty) empty.hidden = visible !== 0;
}

function updateSelectionControls(root: HTMLElement, count: number): void {
  const label = root.querySelector<HTMLElement>("#weather-selection-count");
  const button = root.querySelector<HTMLButtonElement>("#weather-apply-selected");
  if (label) label.textContent = String(count);
  if (button) button.disabled = count === 0;
}

export function mountWeatherPreview(
  root: HTMLElement,
  preview: OverworldWeatherPreview,
  lighting?: WeatherLightingRecord,
): () => void {
  const canvas = root.querySelector<HTMLCanvasElement>("#weather-preview-canvas");
  const warning = root.querySelector<HTMLElement>("#weather-preview-warning");
  if (warning) warning.textContent = preview.warnings.join(" ");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return () => {};
  if (preview.customImageBytes) return mountCustomImage(context, canvas, preview.customImageBytes, preview.customImageMime);

  const particleCanvases = new Map<number, HTMLCanvasElement>();
  preview.particle?.frames.forEach((frame, index) => {
    const frameCanvas = document.createElement("canvas");
    frameCanvas.width = frame.width;
    frameCanvas.height = frame.height;
    const rgba = new Uint8ClampedArray(frame.rgba.length);
    rgba.set(frame.rgba);
    frameCanvas.getContext("2d")?.putImageData(new ImageData(rgba, frame.width, frame.height), 0, 0);
    particleCanvases.set(index, frameCanvas);
  });
  const baseParticleCount = preview.effect.behavior === "clear" || preview.effect.behavior === "fog" ? 0 : 26;
  const particles = Array.from({ length: Math.round(baseParticleCount * (preview.runtime?.particleDensity ?? 1)) }, (_unused, index) => ({
    x: (index * 73 + 19) % 310 - 30,
    y: (index * 47 + 11) % 230 - 30,
    speed: 0.55 + ((index * 17) % 11) / 8,
    phase: (index * 23) % 120,
  }));
  let requestId = 0;
  const started = performance.now();
  const render = (now: number): void => {
    const tick = (now - started) / (1000 / 60);
    drawTestScene(context, preview.effect, lighting);
    drawWeatherLayer(context, preview.effect, tick, preview.runtime, lighting?.fogColor ?? preview.runtime?.fogColor);
    const frame = preview.particle ? nitroCellEffectFrameAt(preview.particle, tick / 2) : undefined;
    const sprite = frame ? particleCanvases.get(frame.index) : undefined;
    for (const particle of particles) {
      const position = particlePosition(preview.effect.behavior, particle.x, particle.y, particle.speed, particle.phase, tick * (preview.runtime?.movementSpeed ?? 1));
      if (sprite && frame) {
        const scale = preview.effect.behavior === "hail" ? 0.65 : 0.8;
        context.globalAlpha = preview.effect.behavior === "diamond" ? 0.75 : 0.9;
        context.drawImage(sprite, position.x - frame.width * scale / 2, position.y - frame.height * scale / 2, frame.width * scale, frame.height * scale);
      } else drawFallbackParticle(context, preview.effect.behavior, position.x, position.y);
    }
    context.globalAlpha = 1;
    if (preview.effect.id === 6 && Math.floor(tick) % 260 > 248) {
      context.fillStyle = "rgba(245,248,255,.34)";
      context.fillRect(0, 0, 256, 192);
    }
    requestId = requestAnimationFrame(render);
  };
  requestId = requestAnimationFrame(render);
  return () => cancelAnimationFrame(requestId);
}

function mountCustomImage(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, bytes: Uint8Array, mime = "image/png"): () => void {
  const copy = bytes.slice();
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: mime }));
  const image = new Image();
  image.onload = () => {
    context.fillStyle = "#111820";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  };
  image.src = url;
  return () => { image.onload = null; URL.revokeObjectURL(url); };
}

function drawTestScene(context: CanvasRenderingContext2D, effect: WeatherEffectDefinition, lighting?: WeatherLightingRecord): void {
  context.fillStyle = lighting?.backgroundColor ?? "#7aa8bb";
  context.fillRect(0, 0, 256, 80);
  context.fillStyle = "#547e42";
  context.fillRect(0, 80, 256, 112);
  context.fillStyle = "#88a85d";
  for (let y = 80; y < 192; y += 16) for (let x = (y / 16 % 2) * -8; x < 256; x += 16) context.fillRect(x, y, 8, 8);
  context.fillStyle = "#bcaa77";
  context.fillRect(92, 80, 72, 112);
  context.fillStyle = "#727d87";
  context.fillRect(28, 45, 54, 54);
  context.fillStyle = "#9aa5ae";
  context.fillRect(34, 51, 42, 48);
  context.fillStyle = "#32422d";
  context.fillRect(193, 53, 12, 49);
  context.fillStyle = "#416839";
  context.beginPath(); context.arc(199, 45, 28, 0, Math.PI * 2); context.fill();
  if (effect.tint) {
    context.fillStyle = hexAlpha(effect.tint, effect.status === "stock" ? 0.2 : 0.14);
    context.fillRect(0, 0, 256, 192);
  }
  if (lighting) applyLightingPreview(context, lighting);
}

function applyLightingPreview(context: CanvasRenderingContext2D, lighting: WeatherLightingRecord): void {
  context.save();
  context.globalCompositeOperation = "multiply";
  context.globalAlpha = 0.34;
  context.fillStyle = lighting.ambient;
  context.fillRect(0, 0, 256, 192);

  const enabled = lighting.lights.filter((light) => light.enabled);
  const lightColor = mixHexColors([lighting.diffuse, ...enabled.map((light) => light.color)]);
  const primary = enabled[0];
  const centerX = 128 - (primary?.vector.x ?? 0) * 74;
  const centerY = 96 + (primary?.vector.y ?? -1) * 52;
  context.globalCompositeOperation = "screen";
  context.globalAlpha = enabled.length ? 0.3 : 0.16;
  const gradient = context.createRadialGradient(centerX, centerY, 4, centerX, centerY, 190);
  gradient.addColorStop(0, lightColor);
  gradient.addColorStop(1, "#000000");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 192);
  context.globalAlpha = 0.13;
  context.fillStyle = lighting.emission;
  context.fillRect(0, 0, 256, 192);
  context.restore();
}

function mixHexColors(colors: string[]): string {
  const channels = colors.map((color) => /^#[0-9a-f]{6}$/iu.test(color) ? [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ] : [255, 255, 255]);
  return `#${[0, 1, 2].map((channel) => Math.round(channels.reduce((sum, color) => sum + color[channel], 0) / Math.max(1, channels.length)).toString(16).padStart(2, "0")).join("")}`;
}

function drawWeatherLayer(context: CanvasRenderingContext2D, effect: WeatherEffectDefinition, tick: number, runtime?: WeatherCloneRuntime, fogColor?: string): void {
  if (effect.behavior === "fog" || effect.behavior === "mirage" || effect.channels.includes("fog")) {
    const tint = fogColor ?? effect.tint ?? "#dbe3e4";
    const gradient = context.createLinearGradient(0, 25, 0, 192);
    if (runtime) {
      const fog = normalizeWeatherCloneRuntime(runtime);
      const strength = previewFogStrength(fog);
      const fade = previewFogFade(fog, tick);
      const slopeCurve = 2 ** ((9 - fog.fogSlope) / 6);
      fog.fogTable.forEach((density, index) => {
        const position = (index / 31) ** slopeCurve;
        gradient.addColorStop(position, hexAlpha(tint, Math.min(1, density / 127 * .32 * strength * fade)));
      });
    } else {
      gradient.addColorStop(0, hexAlpha(tint, effect.id === 11 || effect.id === 14 ? 0.12 : 0.02));
      gradient.addColorStop(1, hexAlpha(tint, effect.id === 13 || effect.id === 14 ? 0.72 : 0.26));
    }
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 192);
  }
  if (effect.behavior === "mirage") {
    context.strokeStyle = "rgba(255,241,185,.26)";
    for (let y = 45; y < 192; y += 7) {
      context.beginPath();
      for (let x = 0; x <= 256; x += 8) {
        const waveY = y + Math.sin((x + tick * 1.4 + y) / 17) * 2.5;
        if (x === 0) context.moveTo(x, waveY); else context.lineTo(x, waveY);
      }
      context.stroke();
    }
  }
}

function previewFogFade(runtime: WeatherCloneRuntime, tick: number): number {
  const fadeInEnd = runtime.fogFadeInFrames;
  const holdEnd = fadeInEnd + 120;
  const fadeOutEnd = holdEnd + runtime.fogFadeOutFrames;
  const phase = tick % (fadeOutEnd + 45);
  if (phase < fadeInEnd) return phase / fadeInEnd;
  if (phase < holdEnd) return 1;
  if (phase < fadeOutEnd) return 1 - (phase - holdEnd) / runtime.fogFadeOutFrames;
  return 0;
}

function particlePosition(behavior: WeatherPreviewBehavior, x: number, y: number, speed: number, phase: number, tick: number): { x: number; y: number } {
  if (behavior === "rain") return { x: ((x + tick * speed * 1.8 + 60) % 316) - 30, y: ((y + tick * speed * 4 + 40) % 242) - 25 };
  if (behavior === "sand") return { x: ((x + tick * speed * 3.4 + 50) % 306) - 25, y: ((y + tick * speed * 0.65 + 30) % 222) - 15 };
  if (behavior === "hail") return { x, y: ((y + tick * speed * 2.6 + 30) % 222) - 15 };
  return { x: x + Math.sin((tick + phase) / 23) * 11, y: ((y + tick * speed * (behavior === "diamond" ? 0.35 : 0.75) + 30) % 222) - 15 };
}

function drawFallbackParticle(context: CanvasRenderingContext2D, behavior: WeatherPreviewBehavior, x: number, y: number): void {
  context.globalAlpha = behavior === "diamond" ? 0.7 : 0.85;
  context.strokeStyle = behavior === "sand" ? "#dcc184" : "#ecf7ff";
  context.fillStyle = context.strokeStyle;
  context.lineWidth = behavior === "rain" ? 1 : 2;
  if (behavior === "rain" || behavior === "sand") {
    context.beginPath(); context.moveTo(x, y); context.lineTo(x + (behavior === "sand" ? 8 : 3), y + (behavior === "rain" ? 13 : 3)); context.stroke();
  } else { context.beginPath(); context.arc(x, y, behavior === "hail" ? 2 : 1.4, 0, Math.PI * 2); context.fill(); }
}

function hexAlpha(hex: string, alpha: number): string {
  const clean = /^#[0-9a-f]{6}$/iu.test(hex) ? hex.slice(1) : "dbe3e4";
  const red = Number.parseInt(clean.slice(0, 2), 16);
  const green = Number.parseInt(clean.slice(2, 4), 16);
  const blue = Number.parseInt(clean.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}
