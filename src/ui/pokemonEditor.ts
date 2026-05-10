import { TYPES } from "../pokeweb/constants";
import {
  BASE_STAT_FIELDS,
  EV_YIELD_FIELDS,
  MISC_INTEGER_FIELDS,
  PERSONAL_TEXT_FIELDS,
  getPokemonAutofills,
  getPokemonCount,
  getPokemonRecord,
  getPokemonSummaryRecord,
  type EvolutionSlot,
  type LearnsetMove,
  type PokemonEditorRecord,
  type PokemonSummaryRecord,
  type TmCompatibilitySlot,
} from "../pokeweb/pokemonModel";
import type { ProjectState, ReadableRecord } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { attachPokemonInteractions } from "./pokemonInteractions";
import evoIcon from "../assets/svgs/evo.svg?raw";
import miscDataIcon from "../assets/svgs/misc_data.svg?raw";
import movesIcon from "../assets/svgs/moves.svg?raw";
import paintIcon from "../assets/svgs/paint.svg?raw";
import tmsIcon from "../assets/svgs/tms.svg?raw";
import { publicAsset } from "../assetUrl";

const ICONS: Record<string, string> = {
  learnset: movesIcon,
  tms: tmsIcon,
  evos: evoIcon,
  personal: miscDataIcon,
};

export function renderPokemonEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void, onOpenSprites?: (speciesId: number) => void): void {
  root.innerHTML = `
    <div class="pokemon-filter pokemon-filter-personal">
      <div class="filter-title">Search Text</div>
      <input class="filter-input" id="search-text"/>
      <button class="btn -default" id="search-text-btn" type="button">Search</button>
      <div class="filter-title">Generation</div>
      <div class="small-filters gen-filters">
        ${[1, 2, 3, 4, 5].map((gen) => `<button class="btn -default btn-5" data-gen="${gen}" type="button">${gen}</button>`).join("")}
      </div>
      <div class="small-filters type-filters">
        ${TYPES.map((type) => `<button class="btn -default btn-5 -${type.toLowerCase()}" data-ptype="${type.toLowerCase()}" type="button">${type.toUpperCase().slice(0, 3)}</button>`).join("")}
      </div>
      <br>
      <div class="small-filters">Tip: You can right click a value to apply to all</div>
    </div>
    <div class="pokemon-list" id="personals">
      ${renderPokemonCards(project)}
    </div>
  `;

  attachPokemonInteractions(root, project, {
    onDirty,
    onOpenSprites,
    renderExpanded: (speciesId) => renderPokemonExpandedSections(project, speciesId),
    autofills: getPokemonAutofills(project),
  });
}

export function renderPokemonExpandedSections(project: ProjectState, speciesId: number): string {
  return renderExpanded(getPokemonRecord(project, speciesId));
}

function renderPokemonCards(project: ProjectState): string {
  const count = getPokemonCount(project);
  const cards: string[] = [];
  for (let id = 0; id < count; id += 1) {
    cards.push(renderPokemonCard(getPokemonSummaryRecord(project, id)));
  }
  return cards.join("");
}

function renderPokemonCard(record: PokemonSummaryRecord): string {
  const pok = record.personal;
  const name = String(pok.name ?? `Pokemon ${record.id}`);
  const type1 = String(pok.type_1 ?? "");
  const type2 = String(pok.type_2 ?? "");
  return `
    <div class="pokemon-card filterable" data-gen="${record.gen}" data-index="${record.id}">
      <div class="pokemon-card__info">
        <div class="pokemon-card__header">
          <div class="pokemon-card__img">
            <img src="${publicAsset(`images/pokesprite/${spriteSlug(name)}.png`)}" alt="" onerror="this.style.display='none'">
          </div>
        </div>
        <div class="pokemon-card__name">#${record.id} ${escapeHtml(titleize(name))}</div>
        <div class="pokemon-types">
          ${editable("personal", "type_1", type1, `pokemon-type -${typeClass(type1)}`, { autofill: "types" })}
          ${editable("personal", "type_2", type2, `pokemon-type -${typeClass(type2)}`, { autofill: "types" })}
        </div>
        <div class="pokemon-card__abilities">
          ${editable("personal", "ability_1", titleizeValue(pok.ability_1), "pokemon-card__ability", { autofill: "abilities" })}
          ${editable("personal", "ability_2", titleizeValue(pok.ability_2), "pokemon-card__ability", { autofill: "abilities" })}
          ${editable("personal", "ability_3", titleizeValue(pok.ability_3), "pokemon-card__ability", { autofill: "abilities" })}
        </div>
      </div>
      <table class="pokemon-card__table" cellspacing="0">
        <tbody>
          ${BASE_STAT_FIELDS.map(([label, field]) => renderBaseStat(label, field, pok[field])).join("")}
        </tbody>
      </table>
      <div class="personal-icons">
        ${icon("learnset", "Learnset")}
        ${icon("tms", "TMs")}
        ${icon("evos", "Evolutions")}
        ${icon("personal", "Personal")}
        ${spriteIcon()}
      </div>
    </div>
  `;
}

function renderExpanded(record: PokemonEditorRecord): string {
  return `
    <div class="expanded-card-content expanded-personal">
      <div class="expanded-left">
        ${MISC_INTEGER_FIELDS.map(([label, field, max]) => expandedField(label, editable("personal", field, record.personal[field], "expanded-field-value", { type: `int-${max}` }))).join("")}
      </div>
      <div class="expanded-mid">
        ${PERSONAL_TEXT_FIELDS.map(([label, field, autofill]) => expandedField(label, editable("personal", field, record.personal[field], "expanded-field-value", { autofill }))).join("")}
      </div>
      <div class="expanded-right">
        ${EV_YIELD_FIELDS.map(([label, field]) => expandedField(`${label} EVs`, editable("personal", field, record.personal[field], "expanded-field-value ev-field", { type: "int-3" }))).join("")}
      </div>
    </div>
    <div class="expanded-card-content expanded-learnset">
      <div class="expanded-left">
        ${record.learnset.slice(0, 13).map((move) => renderLearnsetMove(move)).join("")}
      </div>
      <div class="expanded-left">
        ${record.learnset.slice(13).map((move) => renderLearnsetMove(move)).join("")}
      </div>
    </div>
    <div class="expanded-card-content expanded-tms">
      ${record.tmCompatibility.map((slot) => renderTmCompatibility(slot)).join("")}
    </div>
    <div class="expanded-card-content expanded-evos">
      ${[[0, 1, 2], [3, 4, 5], [6]].map((indexes) => renderEvolutionColumn(record.evolutions.filter((slot) => indexes.includes(slot.index)))).join("")}
    </div>
  `;
}

function renderBaseStat(label: string, field: string, value: unknown): string {
  const numeric = Number(value) || 0;
  return `
    <tr>
      <td><strong>${label}</strong></td>
      <td data-narc="personal" data-type="int-255" data-field-name="${field}" contenteditable="true">${numeric}</td>
      <td>
        <div class="pokemon-card__graph-wrapper">
          <div class="pokemon-card__graph -medium" style="width: calc(100% * (${numeric} / 255));"></div>
        </div>
      </td>
    </tr>
  `;
}

function renderLearnsetMove(move: LearnsetMove): string {
  return `
    <div class="expanded-field multi">
      <div data-require="move-name" data-narc="learnset" data-field-name="lvl_learned_${move.index}" data-type="int-100" class="move-level" contenteditable="true">${move.level}</div>
      ${editable("learnset", `move_id_${move.index}`, move.moveName, "move-name", { autofill: "move_names", require: "move-level" })}
      <div class="move-type"><button class="btn -${typeClass(move.type)} -active" type="button">${escapeHtml(String(move.type).toUpperCase().slice(0, 3))}</button></div>
      <div class="move-cat">${escapeHtml(String(move.category).slice(0, 3))}</div>
      <div class="move-power">${escapeHtml(String(move.power))}</div>
      <div class="move-accuracy">${escapeHtml(String(move.accuracy))}</div>
    </div>
  `;
}

function renderEvolutionColumn(slots: EvolutionSlot[]): string {
  return `
    <div class="expanded-left">
      ${slots
        .map(
          (slot) => `
            ${expandedField("Method", editable("evolution", `method_${slot.index}`, slot.method, "evo-value", { autofill: "evo_methods" }))}
            ${expandedField("Parameter", editable("evolution", `param_${slot.index}`, slot.param, "evo-value", { type: "int-65535" }))}
            ${expandedField("Evolves to", editable("evolution", `target_${slot.index}`, slot.target, "evo-value", { autofill: "pokemon_names" }))}
          `,
        )
        .join("")}
    </div>
  `;
}

function renderTmCompatibility(slot: TmCompatibilitySlot): string {
  return `
    <div class="cell tm ${slot.enabled ? "-active" : ""}" data-field-name="tms" data-narc="personal" data-kind="${slot.kind}" data-index="${slot.index}">
      ${escapeHtml(slot.label)}<br>
      ${escapeHtml(slot.moveName)}
    </div>
  `;
}

function expandedField(label: string, value: string): string {
  return `
    <div class="expanded-field">
      <div class="expanded-field-name">${escapeHtml(label)}</div>
      ${value}
    </div>
  `;
}

function editable(
  narc: "personal" | "learnset" | "evolution",
  field: string,
  value: unknown,
  className: string,
  options: { autofill?: string; type?: string; require?: string } = {},
): string {
  const autofill = options.autofill ? ` data-autocomplete-spy data-autofill="${options.autofill}"` : "";
  const type = options.type ? ` data-type="${options.type}"` : "";
  const require = options.require ? ` data-require="${options.require}"` : "";
  return `<div autocorrect="off" data-narc="${narc}" data-field-name="${field}" class="${className}" contenteditable="true"${autofill}${type}${require}>${escapeHtml(String(value ?? ""))}</div>`;
}

function icon(expand: string, label: string): string {
  return `<div class="expand-card exp-${expand} card-icon expand-action" data-expand="${expand}" title="${label}">${ICONS[expand]}</div>`;
}

function spriteIcon(): string {
  return `<div class="expand-card card-icon sprite-editor-action paintbrush-icon" title="Sprite Editor">${paintIcon}</div>`;
}

function typeClass(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9_-]+/gu, "");
}

function titleize(value: string): string {
  return value
    .split(/\s+/u)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(" ");
}

function titleizeValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return titleize(value);
}

function spriteSlug(name: string): string {
  return name.replace(". ", "-").toLowerCase();
}
