import addIcon from "../assets/svgs/add.svg?raw";
import miscDataIcon from "../assets/svgs/misc_data.svg?raw";
import { publicAsset } from "../assetUrl";
import { TRAINER_AIS } from "../pokeweb/constants";
import {
  getTrainerAutofills,
  getTrainerCount,
  getTrainerRecord,
  type TrainerPokemonSlot,
  type TrainerRecord,
} from "../pokeweb/trainerModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { attachTrainerInteractions } from "./trainerInteractions";

export function renderTrainerEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  root.innerHTML = `
    <div class="pokemon-filter trainer-filter">
      <div class="filter-title">Search</div>
      <input class="filter-input" id="search-text"/>
      <button class="btn -default" id="search-text-btn" type="button">Search</button>
      <button class="btn -default trainer-add-button" id="add-trainer-btn" type="button" title="Clone the selected trainer, party, name slot, and dialogue table rows">
        <span class="svg">${addIcon}</span>
        Add Trainer
      </button>
    </div>
    <div class="pokemon-list spreadsheet" id="trainers">
      <div class="expanded-field field-header">
        <div class="expanded-field-main">
          <div class="trainer-id">ID</div>
          <div class="trainer-name">Name</div>
          <div class="trainer-class">Class</div>
          <div class="trainer-btype">Battle Type</div>
          <div class="trainer-moves">Moves</div>
          <div class="trainer-items">Items</div>
          <div class="trainer-poks">Pokemon</div>
        </div>
      </div>
      ${renderTrainerRows(project)}
    </div>
  `;

  attachTrainerInteractions(root, project, {
    onDirty,
    autofills: getTrainerAutofills(project),
    renderRow: (trainerId) => renderTrainerRow(project, trainerId),
  });
}

export function renderTrainerRow(project: ProjectState, trainerId: number): string {
  return renderTrainerCard(getTrainerRecord(project, trainerId));
}

function renderTrainerRows(project: ProjectState): string {
  const rows: string[] = [];
  for (let trainerId = 0; trainerId < getTrainerCount(project); trainerId += 1) rows.push(renderTrainerRow(project, trainerId));
  return rows.join("");
}

function renderTrainerCard(trainer: TrainerRecord): string {
  return `
    <div class="expanded-field filterable trainer-card" data-index="${trainer.id}">
      <div class="expanded-field-main">
        <div class="trainer-id">${trainer.id}</div>
        <div class="move-info expand-action expand-trainer svg no-fill" data-expand="trainer">${miscDataIcon}</div>
        <div class="trainer-name">
          <img src="${trainer.spritePath}" alt="" onerror="this.style.display='none'">
          ${escapeHtml(String(trainer.readable.name ?? `Trainer ${trainer.id}`))}
        </div>
        ${editable("trdata", "class", `${trainer.readable.class ?? ""} (${trainer.readable.class_id ?? trainer.raw.class ?? 0})`, "trainer-class", { autofill: "class_names" })}
        ${editable("trdata", "battle_type_1", trainer.readable.battle_type_1, "trainer-btype", { autofill: "battle_types" })}
        <div class="trainer-moves">${checkbox("has_moves", trainer.hasMoves)}</div>
        <div class="trainer-items">
          <div class="add-trpok svg" data-narc="trpok" title="Add Pokemon">${addIcon}</div>
          ${checkbox("has_items", trainer.hasItems)}
        </div>
        <div class="trainer-poks">
          ${trainer.party.map((pok) => renderPartyPreview(pok)).join("")}
        </div>
      </div>
      ${renderExpandedTrainer(trainer)}
      ${trainer.party.map((pok) => renderTrainerPokemon(trainer, pok)).join("")}
    </div>
  `;
}

function renderExpandedTrainer(trainer: TrainerRecord): string {
  return `
    <div class="expanded-card-content expanded-trainer">
      <div class="expanded-left">
        ${[1, 2, 3, 4]
          .map((n) => expandedField(`Item ${n}`, editable("trdata", `item_${n}`, trainer.readable[`item_${n}`], "tr-item", { autofill: "items" })))
          .join("")}
        ${trainer.texts.length ? `<div class="show-bottom">Texts</div>` : ""}
      </div>
      <div class="expanded-left">
        ${expandedField("Money", editable("trdata", "money", trainer.readable.money, "tr-item", { type: "int-255" }))}
        ${expandedField("Reward", editable("trdata", "reward_item", trainer.readable.reward_item, "tr-item", { autofill: "items" }))}
        ${expandedField("Heal?", editable("trdata", "heal", trainer.readable.heal, "tr-item", { type: "int-1" }))}
      </div>
      <div class="expanded-right trainer-ai" data-narc="trdata">
        ${TRAINER_AIS.map((ai) => `<div class="choosable-text choosable-prop ${Number(trainer.readable[ai]) > 0 ? "-active" : ""}" data-field-name="${escapeHtml(ai)}" title="Right click to set for all trainers">${escapeHtml(ai)}</div>`).join("")}
      </div>
      ${renderTrainerTexts(trainer)}
    </div>
  `;
}

function renderTrainerTexts(trainer: TrainerRecord): string {
  if (trainer.texts.length === 0) return "";
  return `
    <div class="expanded-bottom trainer-texts">
      ${trainer.texts
        .map(
          (line) => `
            <div class="expanded-field">
              <div class="expanded-field-main">
                <div class="msg-id">${escapeHtml(line.label)}</div>
                ${editable("trtext", `text_${line.typeId}_entry_${line.entryIndex}`, line.value, `log-text no-validate empty-text ${line.exists ? "" : "-empty"}`)}
              </div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderTrainerPokemon(trainer: TrainerRecord, pok: TrainerPokemonSlot): string {
  return `
    <div data-sub-index="${pok.slot}" class="expanded-card-subcontent expanded-pok expanded-pok-${pok.slot}">
      <div class="expanded-left">
        ${expandedField("Species", editable("trpok", `species_id_${pok.slot}`, pok.speciesName, "tr-item trpok-name", { autofill: "pokemon_names" }))}
        ${expandedField("Level", editable("trpok", `level_${pok.slot}`, pok.level, "tr-item trpok-lvl", { type: "int-100" }))}
        ${expandedField(`Ability Slot (${pok.abilityName})`, editable("trpok", `ability_${pok.slot}`, pok.abilitySlot, "tr-item", { type: "int-3" }))}
        ${expandedField("Gender", editable("trpok", `gender_${pok.slot}`, pok.gender, "tr-item", { autofill: "genders" }))}
        ${expandedField(`IVs: (${pok.nature})`, editable("trpok", `ivs_${pok.slot}`, pok.ivs, "tr-item", { type: "int-255" }), "iv-label")}
        ${expandedField("Form", editable("trpok", `form_${pok.slot}`, pok.form, "tr-item", { type: "int-255" }))}
      </div>
      <div class="expanded-left">
        ${expandedField("Held Item", editable("trpok", `item_id_${pok.slot}`, trainer.hasItems ? pok.itemName : "", "tr-item", { autofill: "items", check: "has-items" }))}
        ${[1, 2, 3, 4].map((move) => expandedField(`Move ${move}`, editable("trpok", `move_${move}_${pok.slot}`, trainer.hasMoves ? pok.moves[move - 1] : "", "tr-item trpok-mov", { autofill: "move_names", check: "has-moves" }))).join("")}
        <div class="expanded-field btn-field-right multi">
          <div class="autofill-btn field-btn disabled" data-narc="trpok">Autofill Moves</div>
          <div class="delete-trpok del-btn field-btn" data-narc="trpok">Delete</div>
        </div>
      </div>
    </div>
  `;
}

function renderPartyPreview(pok: TrainerPokemonSlot): string {
  const missingSprite = publicAsset("images/pokesprite/-.png");
  return `
    <div class="wild">
      <img src="${publicAsset(`images/pokesprite/${pok.spriteSlug}.png`)}" alt="" data-show="pok-${pok.slot}" onerror="this.src='${missingSprite}'">
    </div>
  `;
}

function expandedField(label: string, value: string, labelClass = "expanded-trlabel"): string {
  return `
    <div class="expanded-field">
      <div class="${labelClass}">${escapeHtml(label)}</div>
      ${value}
    </div>
  `;
}

function editable(
  narc: "trdata" | "trpok" | "trtext",
  field: string,
  value: unknown,
  className: string,
  options: { autofill?: string; type?: string; check?: string } = {},
): string {
  const autofill = options.autofill ? ` data-autocomplete-spy data-autofill="${options.autofill}"` : "";
  const type = options.type ? ` data-type="${options.type}"` : "";
  const check = options.check ? ` data-check="${options.check}"` : "";
  return `<div autocorrect="off" data-narc="${narc}" data-field-name="${field}" class="${className}" contenteditable="true"${autofill}${type}${check}>${escapeHtml(String(value ?? ""))}</div>`;
}

function checkbox(field: string, checked: boolean): string {
  return `
    <label class="container" data-narc="trdata">
      <input class="trainer-tmp-flag ${field.replace("_", "-")} choosable-prop ${checked ? "-active" : ""}" data-field-name="${field}" type="checkbox" ${checked ? "checked" : ""}>
      <span class="checkmark"></span>
    </label>
  `;
}
