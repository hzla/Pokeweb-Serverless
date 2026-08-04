import { publicAsset } from "../assetUrl";
import { typeNamesForProject } from "../pokeweb/constants";
import { getPokemonSummaryRecord, pokemonMatchesSearch } from "../pokeweb/pokemonModel";
import { pokemonSpeciesLabel } from "../pokeweb/pokemonLabels";
import { getPokemonIconImage, resolvePokemonSpriteId, type RgbaImageData } from "../pokeweb/pokemonSpriteModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { pokemonSpriteSlug } from "../pokeweb/spriteSlug";
import { escapeHtml } from "./dom";

export type PokemonCompatibilityRosterEntry = {
  speciesId: number;
  type1: string;
  type2: string;
  enabled: boolean;
};

type PokemonCompatibilityPanelOptions = {
  title: string;
  ariaLabel: string;
  data: Record<string, string | number>;
  roster: PokemonCompatibilityRosterEntry[];
};

export type PokemonCompatibilityIconRenderer = {
  observe: (host: HTMLElement) => void;
  disconnect: () => void;
};

export function renderPokemonCompatibilityPanel(project: ProjectState, options: PokemonCompatibilityPanelOptions): string {
  if (!project.narcs.personal) {
    return `<div class="tm-pokemon-compatibility-unavailable">Load Personal Data to view Pokemon compatibility.</div>`;
  }
  const dataAttributes = Object.entries(options.data)
    .map(([name, value]) => `data-${name}="${escapeHtml(String(value))}"`)
    .join(" ");
  return `
    <section class="tm-pokemon-compatibility-panel" ${dataAttributes} aria-label="${escapeHtml(options.ariaLabel)}">
      <div class="tm-pokemon-compatibility-toolbar">
        <div>
          <strong>${escapeHtml(options.title)}</strong>
        </div>
        <div class="tm-pokemon-type-filter-wrap">
          <input
            class="filter-input tm-pokemon-search-input"
            type="search"
            placeholder="Search Pokemon"
            aria-label="Search Pokemon"
            autocomplete="off"
            spellcheck="false"
          >
          <div class="tm-pokemon-type-filters type-filters">
            ${typeNamesForProject(project)
              .map((type) => `<button class="btn btn-5 -default -${typeClass(type)} tm-pokemon-type-filter" data-pokemon-type="${escapeHtml(type.toLowerCase())}" type="button" aria-pressed="false">${escapeHtml(type.toUpperCase().slice(0, 3))}</button>`)
              .join("")}
          </div>
        </div>
      </div>
      <div class="tm-pokemon-compatibility-grid">
        ${options.roster.map((pokemon) => renderPokemonCompatibilityCard(project, pokemon)).join("")}
      </div>
    </section>
  `;
}

export function applyPokemonCompatibilityFilter(panel: HTMLElement, project: ProjectState): void {
  const activeTypes = new Set(
    [...panel.querySelectorAll<HTMLButtonElement>(".tm-pokemon-type-filter.-active")]
      .map((button) => button.dataset.pokemonType ?? "")
      .filter(Boolean),
  );
  const searchText = panel.querySelector<HTMLInputElement>(".tm-pokemon-search-input")?.value ?? "";
  const generations = new Set<number>();
  for (const card of panel.querySelectorAll<HTMLElement>(".tm-pokemon-compatibility-card")) {
    const speciesId = Number(card.dataset.speciesId);
    const show = Number.isInteger(speciesId)
      ? pokemonMatchesSearch(getPokemonSummaryRecord(project, speciesId), searchText, generations, activeTypes)
      : false;
    card.hidden = !show;
  }
}

export function syncPokemonCompatibilityCard(card: HTMLElement, enabled: boolean): void {
  const speciesId = Number(card.dataset.speciesId);
  card.dataset.compatible = String(enabled);
  card.classList.toggle("-enabled", enabled);
  card.classList.toggle("-disabled", !enabled);
  card.setAttribute("aria-pressed", String(enabled));
  const name = card.querySelector<HTMLElement>(".tm-pokemon-compatibility-name")?.textContent?.trim() ?? `Pokemon ${speciesId}`;
  const state = enabled ? "Compatible" : "Not compatible";
  card.title = `#${speciesId} ${name} · ${state}`;
  card.setAttribute("aria-label", `#${speciesId} ${name}. ${state}`);
}

export function createPokemonCompatibilityIconRenderer(project: ProjectState): PokemonCompatibilityIconRenderer {
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
      replacePokemonCanvasWithFallback(canvas);
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

function renderPokemonCompatibilityCard(project: ProjectState, pokemon: PokemonCompatibilityRosterEntry): string {
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
      <div class="tm-pokemon-compatibility-icon">${renderPokemonIcon(project, pokemon.speciesId, name)}</div>
      <span class="tm-pokemon-compatibility-name">${escapeHtml(name)}</span>
    </button>
  `;
}

function renderPokemonIcon(project: ProjectState, speciesId: number, name: string): string {
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

function replacePokemonCanvasWithFallback(canvas: HTMLCanvasElement): void {
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
