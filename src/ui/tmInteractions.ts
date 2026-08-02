import { typeNamesForProject } from "../pokeweb/constants";
import { getPokemonMachineCompatibilityRoster, updatePokemonTmCompatibility } from "../pokeweb/pokemonModel";
import { pokemonSpeciesLabel } from "../pokeweb/pokemonLabels";
import { getPokemonIconImage, resolvePokemonSpriteId, type RgbaImageData } from "../pokeweb/pokemonSpriteModel";
import { getTmEntries, syncAllTmIcons, tmMatchesSearch, updateTmMove, type TmEntry } from "../pokeweb/tmModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { pokemonSpriteSlug } from "../pokeweb/spriteSlug";
import { publicAsset } from "../assetUrl";
import { escapeHtml, selectText } from "./dom";
import { stripeRows } from "./legacyInteractions";

type TmOptions = {
  onDirty?: () => void;
  autofills: Record<string, string[]>;
  renderRow: (entry: TmEntry) => string;
};

const tmInteractionInstallations = new WeakMap<HTMLElement, { controller: AbortController; disconnectIcons: () => void }>();

export function attachTmInteractions(root: HTMLElement, project: ProjectState, options: TmOptions): void {
  const previous = tmInteractionInstallations.get(root);
  previous?.controller.abort();
  previous?.disconnectIcons();
  const controller = new AbortController();
  const iconRenderer = createTmCompatibilityIconRenderer(project);
  tmInteractionInstallations.set(root, { controller, disconnectIcons: iconRenderer.disconnect });
  const activeCategories = new Set<string>();
  const activeTypes = new Set<string>();
  const searchInput = root.querySelector<HTMLInputElement>("#search-text");
  const searchButton = root.querySelector<HTMLButtonElement>("#search-text-btn");
  const syncButton = root.querySelector<HTMLButtonElement>("#sync-tm-icons-btn");
  const syncStatus = root.querySelector<HTMLElement>("#tm-sync-status");

  const runFilter = () => {
    filterTms(root, project, searchInput?.value ?? "", activeCategories, activeTypes);
    stripeRows(root);
  };

  searchButton?.addEventListener("click", runFilter);
  searchInput?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") runFilter();
  });

  syncButton?.addEventListener("click", () => {
    try {
      const changed = syncAllTmIcons(project);
      if (syncStatus) {
        syncStatus.textContent = changed > 0 ? `Synced ${changed} icon${changed === 1 ? "" : "s"}` : "Icons already synced";
        syncStatus.classList.remove("-error");
      }
      if (changed > 0) options.onDirty?.();
    } catch (error) {
      if (syncStatus) {
        syncStatus.textContent = error instanceof Error ? error.message : String(error);
        syncStatus.classList.add("-error");
      }
    }
  });

  root.querySelectorAll<HTMLButtonElement>(".cat-filters [data-mcat]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleSet(activeCategories, button.dataset.mcat ?? "");
      button.classList.toggle("-active", activeCategories.has(button.dataset.mcat ?? ""));
      button.setAttribute("aria-pressed", String(activeCategories.has(button.dataset.mcat ?? "")));
      runFilter();
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".type-filters [data-ptype]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleSet(activeTypes, button.dataset.ptype ?? "");
      button.classList.toggle("-active", activeTypes.has(button.dataset.ptype ?? ""));
      button.setAttribute("aria-pressed", String(activeTypes.has(button.dataset.ptype ?? "")));
      runFilter();
    });
  });

  root.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    const expandButton = event.target.closest<HTMLButtonElement>("[data-tm-compatibility-expand]");
    if (expandButton) {
      const card = expandButton.closest<HTMLElement>(".tm-card");
      const host = card?.querySelector<HTMLElement>(".tm-pokemon-compatibility-host");
      const entry = getTmEntries(project).find((candidate) => candidate.field === card?.dataset.tmField);
      if (!card || !host || !entry) return;
      const opening = host.hidden;
      if (opening && host.dataset.rendered !== "true") {
        host.innerHTML = renderTmPokemonCompatibilityPanel(project, entry);
        host.dataset.rendered = "true";
      }
      host.hidden = !opening;
      card.classList.toggle("-compatibility-open", opening);
      expandButton.classList.toggle("-active", opening);
      expandButton.setAttribute("aria-expanded", String(opening));
      if (opening) iconRenderer.observe(host);
      return;
    }

    const typeFilter = event.target.closest<HTMLButtonElement>(".tm-pokemon-type-filter");
    if (typeFilter) {
      const panel = typeFilter.closest<HTMLElement>(".tm-pokemon-compatibility-panel");
      if (!panel) return;
      const active = !typeFilter.classList.contains("-active");
      typeFilter.classList.toggle("-active", active);
      typeFilter.setAttribute("aria-pressed", String(active));
      applyTmPokemonTypeFilter(panel);
      return;
    }

    const pokemonCard = event.target.closest<HTMLButtonElement>(".tm-pokemon-compatibility-card");
    if (pokemonCard) {
      const panel = pokemonCard.closest<HTMLElement>(".tm-pokemon-compatibility-panel");
      const speciesId = Number(pokemonCard.dataset.speciesId);
      const kind = panel?.dataset.kind as "tm" | "hm" | undefined;
      const index = Number(panel?.dataset.index);
      if (!panel || !Number.isInteger(speciesId) || (kind !== "tm" && kind !== "hm") || !Number.isInteger(index)) return;
      const enabled = pokemonCard.dataset.compatible !== "true";
      updatePokemonTmCompatibility(project, speciesId, kind, index, enabled);
      pokemonCard.dataset.compatible = String(enabled);
      pokemonCard.classList.toggle("-enabled", enabled);
      pokemonCard.classList.toggle("-disabled", !enabled);
      pokemonCard.setAttribute("aria-pressed", String(enabled));
      const name = pokemonCard.querySelector<HTMLElement>(".tm-pokemon-compatibility-name")?.textContent?.trim() ?? `Pokemon ${speciesId}`;
      const state = enabled ? "Compatible" : "Not compatible";
      pokemonCard.title = `#${speciesId} ${name} · ${state}`;
      pokemonCard.setAttribute("aria-label", `#${speciesId} ${name}. ${state}`);
      applyTmPokemonTypeFilter(panel);
      options.onDirty?.();
    }
  }, { signal: controller.signal });

  installEditableFields(root, project, options);
  runFilter();
}

function renderTmPokemonCompatibilityPanel(project: ProjectState, entry: TmEntry): string {
  if (!project.narcs.personal) {
    return `<div class="tm-pokemon-compatibility-unavailable">Load Personal Data to view Pokemon compatibility.</div>`;
  }
  const roster = getPokemonMachineCompatibilityRoster(project, entry.kind, entry.number);
  return `
    <section class="tm-pokemon-compatibility-panel" data-kind="${entry.kind}" data-index="${entry.number}" aria-label="${escapeHtml(`${entry.kind.toUpperCase()}${entry.number} ${entry.moveName} Pokemon compatibility`)}">
      <div class="tm-pokemon-compatibility-toolbar">
        <div>
          <strong>${escapeHtml(`${entry.kind.toUpperCase()}${entry.number} · ${entry.moveName}`)}</strong>
        </div>
        <div class="tm-pokemon-type-filter-wrap">
          <div class="tm-pokemon-type-filters type-filters">
            ${typeNamesForProject(project)
              .map((type) => `<button class="btn btn-5 -default -${typeClass(type)} tm-pokemon-type-filter" data-pokemon-type="${escapeHtml(type.toLowerCase())}" type="button" aria-pressed="false">${escapeHtml(type.toUpperCase().slice(0, 3))}</button>`)
              .join("")}
          </div>
        </div>
      </div>
      <div class="tm-pokemon-compatibility-grid">
        ${roster.map((pokemon) => renderTmPokemonCompatibilityCard(project, pokemon)).join("")}
      </div>
    </section>
  `;
}

function renderTmPokemonCompatibilityCard(
  project: ProjectState,
  pokemon: ReturnType<typeof getPokemonMachineCompatibilityRoster>[number],
): string {
  const name = pokemonSpeciesLabel(project, pokemon.speciesId);
  const types = [...new Set([pokemon.type1, pokemon.type2].filter(Boolean).map((type) => type.toLowerCase()))];
  const state = pokemon.enabled ? "Compatible" : "Not compatible";
  return `
    <button
      class="tm-pokemon-compatibility-card ${pokemon.enabled ? "-enabled" : "-disabled"}"
      data-species-id="${pokemon.speciesId}"
      data-pokemon-types="${escapeHtml(types.join(" "))}"
      data-compatible="${pokemon.enabled}"
      type="button"
      aria-pressed="${pokemon.enabled}"
      title="${escapeHtml(`#${pokemon.speciesId} ${name} · ${state}`)}"
      aria-label="${escapeHtml(`#${pokemon.speciesId} ${name}. ${state}`)}"
    >
      <div class="tm-pokemon-compatibility-icon">${renderTmPokemonIcon(project, pokemon.speciesId, name)}</div>
      <span class="tm-pokemon-compatibility-name">${escapeHtml(name)}</span>
    </button>
  `;
}

function renderTmPokemonIcon(project: ProjectState, speciesId: number, name: string): string {
  const fallback = publicAsset(`images/pokesprite/${pokemonSpriteSlug(name)}.png`);
  if (project.narcs.pokemon_icons) {
    try {
      const spriteId = resolvePokemonSpriteId(project, speciesId, 0);
      return `<canvas class="tm-pokemon-rom-icon" data-pokemon-sprite-id="${spriteId}" data-fallback-src="${escapeHtml(fallback)}" width="32" height="32" aria-hidden="true"></canvas>`;
    } catch {
      // Use the static icon fallback below when a generated form has no resolvable icon entry.
    }
  }
  return `<img class="tm-pokemon-static-icon" src="${escapeHtml(fallback)}" loading="lazy" alt="">`;
}

function applyTmPokemonTypeFilter(panel: HTMLElement): void {
  const activeTypes = new Set(
    [...panel.querySelectorAll<HTMLButtonElement>(".tm-pokemon-type-filter.-active")]
      .map((button) => button.dataset.pokemonType ?? "")
      .filter(Boolean),
  );
  const cards = [...panel.querySelectorAll<HTMLElement>(".tm-pokemon-compatibility-card")];
  for (const card of cards) {
    const pokemonTypes = new Set((card.dataset.pokemonTypes ?? "").split(/\s+/u).filter(Boolean));
    const show = activeTypes.size === 0 || [...activeTypes].some((type) => pokemonTypes.has(type));
    card.hidden = !show;
  }
}

function createTmCompatibilityIconRenderer(project: ProjectState): {
  observe: (host: HTMLElement) => void;
  disconnect: () => void;
} {
  const imageCache = new Map<number, Promise<RgbaImageData | undefined>>();
  const loadImage = (spriteId: number): Promise<RgbaImageData | undefined> => {
    let cached = imageCache.get(spriteId);
    if (!cached) {
      cached = Promise.resolve()
        .then(() => getPokemonIconImage(project, spriteId, "male"))
        .catch(() => undefined);
      imageCache.set(spriteId, cached);
    }
    return cached;
  };

  const renderCanvas = async (canvas: HTMLCanvasElement): Promise<void> => {
    if (canvas.dataset.rendered === "true" || canvas.dataset.rendered === "loading") return;
    const spriteId = Number(canvas.dataset.pokemonSpriteId);
    if (!Number.isInteger(spriteId)) return;
    canvas.dataset.rendered = "loading";
    const image = await loadImage(spriteId);
    if (!canvas.isConnected) return;
    if (!image) {
      replaceTmPokemonCanvasWithFallback(canvas);
      return;
    }
    const frameHeight = Math.min(image.width, image.height);
    const pixels = image.pixels.slice(0, image.width * frameHeight * 4);
    canvas.width = image.width;
    canvas.height = frameHeight;
    canvas.getContext("2d")?.putImageData(new ImageData(pixels, image.width, frameHeight), 0, 0);
    canvas.dataset.rendered = "true";
  };

  const observer = typeof IntersectionObserver === "undefined"
    ? undefined
    : new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const canvas = entry.target as HTMLCanvasElement;
          observer?.unobserve(canvas);
          void renderCanvas(canvas);
        }
      }, { rootMargin: "160px" });

  return {
    observe: (host) => {
      host.querySelectorAll<HTMLCanvasElement>("canvas.tm-pokemon-rom-icon").forEach((canvas) => {
        if (canvas.dataset.observed === "true") return;
        canvas.dataset.observed = "true";
        if (observer) observer.observe(canvas);
        else void renderCanvas(canvas);
      });
    },
    disconnect: () => observer?.disconnect(),
  };
}

function replaceTmPokemonCanvasWithFallback(canvas: HTMLCanvasElement): void {
  const image = document.createElement("img");
  image.className = "tm-pokemon-static-icon";
  image.loading = "lazy";
  image.alt = "";
  image.src = canvas.dataset.fallbackSrc ?? publicAsset("images/pokesprite/-.png");
  canvas.replaceWith(image);
}

function typeClass(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9_-]+/gu, "");
}

function filterTms(root: HTMLElement, project: ProjectState, searchText: string, categories: Set<string>, types: Set<string>): HTMLElement[] {
  const byField = new Map(getTmEntries(project).map((entry) => [entry.field, entry]));
  const visible: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>("#moves .tm-card").forEach((card) => {
    const entry = byField.get(card.dataset.tmField ?? "");
    const show = entry ? tmMatchesSearch(entry, searchText, categories, types) : false;
    card.style.display = show ? "" : "none";
    if (show) visible.push(card);
  });
  return visible;
}

function installEditableFields(root: HTMLElement, project: ProjectState, options: TmOptions): void {
  root.querySelectorAll<HTMLElement>("[contenteditable='true'][data-narc='tm']").forEach((field) => {
    if (field.dataset.tmEditInstalled === "true") return;
    field.dataset.tmEditInstalled = "true";
    let initialValue = field.textContent?.trim() ?? "";
    installAutocomplete(field, options.autofills);
    field.addEventListener("mousedown", () => {
      initialValue = field.textContent?.trim() ?? "";
    });
    field.addEventListener("click", () => selectText(field));
    field.addEventListener("keypress", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        field.blur();
      }
    });
    field.addEventListener("focusout", () => {
      const card = field.closest<HTMLElement>(".tm-card");
      const fieldName = field.dataset.fieldName;
      const nextValue = field.textContent?.trim() ?? "";
      field.textContent = nextValue;
      if (!card || !fieldName || nextValue === initialValue) return;
      try {
        updateTmMove(project, fieldName, nextValue);
        const entry = getTmEntries(project).find((candidate) => candidate.field === fieldName);
        if (entry) {
          const replacement = htmlToElement(options.renderRow(entry));
          card.replaceWith(replacement);
          installEditableFields(replacement, project, options);
        }
        stripeRows(root);
        field.classList.remove("invalid");
        options.onDirty?.();
      } catch {
        field.textContent = initialValue;
        field.classList.add("invalid");
        field.style.border = "1px solid red";
      }
    });
  });
}

function installAutocomplete(field: HTMLElement, autofills: Record<string, string[]>): void {
  const key = field.dataset.autofill;
  if (!key || field.parentElement?.hasAttribute("data-autocomplete")) return;
  const values = autofills[key] ?? [];
  if (values.length === 0) return;
  const host = document.createElement("span");
  host.setAttribute("data-autocomplete", "");
  field.before(host);
  host.append(field);
  const suggestions = document.createElement("div");
  suggestions.className = "suggestions";
  suggestions.hidden = true;
  host.append(suggestions);
  const render = () => {
    const query = field.textContent?.trim().toLowerCase() ?? "";
    if (!query) {
      suggestions.hidden = true;
      return;
    }
    const matches = values.filter((value) => value.toLowerCase().includes(query)).slice(0, 12);
    suggestions.innerHTML = matches.map((value) => `<div>${escapeHtml(value)}</div>`).join("");
    suggestions.hidden = matches.length === 0;
  };
  field.addEventListener("input", render);
  field.addEventListener("focus", render);
  field.addEventListener("blur", () => window.setTimeout(() => (suggestions.hidden = true), 150));
  suggestions.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement;
    if (!target || target.parentElement !== suggestions) return;
    event.preventDefault();
    field.textContent = target.textContent ?? "";
    suggestions.hidden = true;
    field.blur();
  });
}

function htmlToElement(html: string): HTMLElement {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild as HTMLElement;
}

function toggleSet<T>(set: Set<T>, value: T): void {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}
