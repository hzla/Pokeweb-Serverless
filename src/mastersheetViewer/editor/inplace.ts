import type { BlockDraft } from "../../pokeweb/mastersheetEdits";
import { tableName, type EditorHost } from "./pickers";
import { CARET, esc, hatch } from "./ui";

/**
 * Editing a block where it stands. The viewer draws the block as always; this turns the drawn block into its own
 * editor: text becomes editable where it is (`data-edit` fields), what is picked from the ROM (a trainer, a wild
 * table, an item's icon, a Pokémon) becomes a button that opens a picker, and lists get a tile to add to. Fields are
 * filled from the block's source, so links keep their addresses as written.
 */

const EMPTY_TRAINER_NOTE = "The trainer's scene and team show here once you pick one.";
const EMPTY_TABLE_NOTE = "The table and its map show here once you pick one.";

/** Turns the element the viewer drew for a block into its editor; returns the element (replaced for a missing trainer or table). */
export function decorateBlock(element: HTMLElement, draft: BlockDraft, host: EditorHost): HTMLElement {
  element.classList.add("mse-editing");
  switch (draft.kind) {
    case "text":
      field(element, "text", inlineHtml(draft.text), "Write something", true);
      return element;
    case "list":
      field(element, "items", (draft.items.length ? draft.items : [""]).map((item) => `<li>${inlineHtml(item)}</li>`).join(""), "", true);
      return element;
    case "heading": {
      const target = element.querySelector<HTMLElement>(":scope > span") ?? element;
      field(target, "text", esc(draft.text), "Section title");
      return element;
    }
    case "notice": {
      const title = element.querySelector<HTMLElement>(":scope > strong");
      let text = element.querySelector<HTMLElement>(":scope > p");
      if (!text) {
        text = document.createElement("p");
        element.append(text);
      }
      if (title) field(title, "title", esc(draft.title), "Title");
      field(text, "text", esc(draft.text), "What it says");
      return element;
    }
    case "items":
    case "gifts":
      decorateList(element, draft);
      return element;
    case "trainer":
      return decorateTrainer(element, draft);
    case "encounter":
      return decorateEncounter(element, draft, host);
  }
}

function field(element: HTMLElement, name: string, html: string, placeholder: string, rich = false): void {
  element.innerHTML = html;
  element.dataset.edit = name;
  if (rich) element.dataset.rich = "true";
  element.contentEditable = "true";
  element.spellcheck = true;
  if (placeholder) element.dataset.placeholder = placeholder;
  element.setAttribute("role", "textbox");
  element.setAttribute("aria-label", placeholder || name);
}

/** Mandatory or not, as two chips in the trainer's title bar. */
function roleChips(mandatory: boolean): string {
  return `<span class="mse-seg" role="group" aria-label="Role">
    <button type="button" class="mse-seg__chip" data-role="mandatory" aria-pressed="${mandatory}">Mandatory</button>
    <button type="button" class="mse-seg__chip" data-role="optional" aria-pressed="${!mandatory}">Optional</button>
  </span>`;
}

function pickButton(kind: "trainer" | "table", label: string, placeholder = false): string {
  return `<button type="button" class="mse-pick" data-pick-open="${kind}" title="${kind === "trainer" ? "Choose another trainer" : "Choose another wild area"}">${placeholder ? `<span class="mse-placeholder">${esc(label)}</span>` : label}${CARET}</button>`;
}

function decorateTrainer(element: HTMLElement, draft: Extract<BlockDraft, { kind: "trainer" }>): HTMLElement {
  if (!element.matches("article.msv-trainer")) {
    const card = trainerCard(draft.mandatory, `Trainer ${draft.ref} isn't in this ROM.`);
    card.dataset.block = element.dataset.block ?? "";
    card.classList.add("mse-editing");
    element.replaceWith(card);
    return card;
  }
  const heading = element.querySelector<HTMLElement>("header h3");
  if (heading) heading.innerHTML = pickButton("trainer", heading.innerHTML);
  const tags = element.querySelector<HTMLElement>(".msv-trainer__tags");
  if (tags) {
    // The role becomes a choice; a battle type (Doubles) stays as it is.
    tags.querySelectorAll(".msv-tag.-mandatory, .msv-tag.-optional, .msv-tag.-rematch").forEach((tag) => tag.remove());
    tags.insertAdjacentHTML("afterbegin", roleChips(draft.mandatory));
  }
  const info = element.querySelector<HTMLElement>(".msv-trainer__info");
  let notes = element.querySelector<HTMLElement>(".msv-trainer__notes");
  if (!notes && info) {
    notes = document.createElement("p");
    notes.className = "msv-trainer__notes";
    info.append(notes);
  }
  if (notes) field(notes, "notes", inlineHtml(draft.notes), "Add a note", true);
  return element;
}

/** A trainer card before one is picked (a new block, or one whose trainer isn't in the ROM). */
export function trainerCard(mandatory: boolean, note = EMPTY_TRAINER_NOTE): HTMLElement {
  const card = document.createElement("article");
  card.className = "msv-trainer mse-newcard";
  card.innerHTML = `
    <header class="msv-titlebar -fight"><h3>${pickButton("trainer", "Choose a trainer", true)}</h3><p class="msv-trainer__tags">${roleChips(mandatory)}</p>${hatch()}</header>
    <div class="mse-newcard__body">${esc(note)}</div>`;
  return card;
}

function decorateEncounter(element: HTMLElement, draft: Extract<BlockDraft, { kind: "encounter" }>, host: EditorHost): HTMLElement {
  const tableId = Number(draft.ref);
  const table = Number.isInteger(tableId) ? host.catalog().encounter(tableId) : undefined;
  if (!element.matches("section.msv-wild") || !table) {
    const card = tableCard(`Encounter table ${draft.ref} isn't in this ROM.`);
    card.dataset.block = element.dataset.block ?? "";
    card.classList.add("mse-editing");
    element.replaceWith(card);
    return card;
  }
  decorateTableBand(element, tableId, host);
  return element;
}

/** The picker in the wild table's band; drawn again when the viewer redraws the table for a method or season tab. */
export function decorateTableBand(element: HTMLElement, tableId: number, host: EditorHost): void {
  const band = element.querySelector<HTMLElement>(".msv-wild__data > .msv-band");
  if (!band || band.querySelector("[data-pick-open]")) return;
  const table = host.catalog().encounter(tableId);
  const label = `${esc(tableName((table?.zones ?? []).map((zone) => zone.name), tableId))} <span class="mse-pick__id">table ${tableId}</span>`;
  band.querySelector(":scope > span")?.insertAdjacentHTML("afterend", pickButton("table", label));
}

export function tableCard(note = EMPTY_TABLE_NOTE): HTMLElement {
  const card = document.createElement("section");
  card.className = "msv-wild mse-newcard";
  card.innerHTML = `
    <h3 class="msv-band -mon"><span>Wild Pokémon</span>${pickButton("table", "Choose a wild area", true)}${hatch()}</h3>
    <div class="mse-newcard__body">${esc(note)}</div>`;
  return card;
}

/** Items and Pokémon lists: the title and the line under it, each entry's note, its icon or Pokémon, and an add tile. */
function decorateList(element: HTMLElement, draft: Extract<BlockDraft, { kind: "items" | "gifts" }>): void {
  const items = draft.kind === "items";
  const band = element.querySelector<HTMLElement>(":scope > .msv-band");
  const title = band?.querySelector<HTMLElement>(":scope > span");
  if (title) field(title, "title", esc(draft.title), items ? "Items" : "Gift Pokémon");
  let lead = element.querySelector<HTMLElement>(":scope > .msv-pickups__lead");
  if (!lead) {
    lead = document.createElement("p");
    lead.className = "msv-pickups__lead";
    band?.after(lead);
  }
  field(lead, "description", esc(draft.description), "Add a line under the title");
  if (items) {
    const grid = element.querySelector<HTMLElement>(".msv-bag-grid");
    [...element.querySelectorAll<HTMLElement>(".msv-bag")].forEach((tile, index) => {
      const entry = draft.entries[index];
      if (!entry) return;
      tile.dataset.entryAt = String(index);
      const plate = tile.querySelector<HTMLElement>(".msv-bag__plate");
      if (plate) {
        plate.dataset.entryIcon = String(index);
        plate.draggable = true;
        plate.title = "Change the icon, or drag to reorder";
        plate.setAttribute("role", "button");
      }
      const desc = tile.querySelector<HTMLElement>(".msv-bag__desc");
      if (desc) {
        field(desc, "note", esc(entry.note), entry.name || "Text shown");
        desc.dataset.entry = String(index);
      }
    });
    grid?.insertAdjacentHTML("beforeend", `<li class="mse-addtile"><button type="button" data-add-entry>+ Add an item</button></li>`);
    return;
  }
  const cards = [...element.querySelectorAll<HTMLElement>(".msv-mon.-gift")];
  cards.forEach((card, index) => {
    const entry = draft.entries[index];
    if (!entry) return;
    card.dataset.entryAt = String(index);
    const sprite = card.querySelector<HTMLElement>(".msv-mon__sprite");
    if (sprite) {
      sprite.removeAttribute("data-open");
      sprite.dataset.entrySpecies = String(index);
      sprite.draggable = true;
      sprite.title = "Change the Pokémon, or drag to reorder";
      if (sprite.tagName !== "BUTTON") sprite.setAttribute("role", "button");
    }
    const name = card.querySelector<HTMLElement>(".msv-mon__name");
    if (name) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "msv-mon__name mse-pick";
      button.dataset.entrySpecies = String(index);
      button.title = "Change the Pokémon";
      button.innerHTML = `${esc(name.textContent ?? entry.name)}${CARET}`;
      name.replaceWith(button);
    }
    let note = card.querySelector<HTMLElement>(".msv-gift__note");
    if (!note) {
      note = document.createElement("p");
      note.className = "msv-gift__note";
      card.append(note);
    }
    field(note, "note", esc(entry.note), "Add a note");
    note.dataset.entry = String(index);
  });
  let party = [...element.querySelectorAll<HTMLElement>(".msv-party.-gifts")].at(-1);
  if (!party || party.children.length >= 6) {
    const next = document.createElement("ol");
    next.className = "msv-party -gifts";
    element.append(next);
    party = next;
  }
  party.insertAdjacentHTML("beforeend", `<li class="mse-addcard"><button type="button" data-add-entry><b>+</b>Add a Pokémon</button></li>`);
}

// ---------- Reading fields back ----------

/** Updates the draft from one edited field. */
export function readField(draft: BlockDraft, element: HTMLElement): void {
  const name = element.dataset.edit;
  const entry = element.dataset.entry === undefined ? undefined : Number(element.dataset.entry);
  switch (draft.kind) {
    case "text":
      draft.text = inlineMarkdown(element);
      return;
    case "list":
      draft.items = [...element.children].map((item) => inlineMarkdown(item));
      return;
    case "heading":
      draft.text = plainText(element);
      return;
    case "notice":
      if (name === "title") draft.title = plainText(element);
      if (name === "text") draft.text = plainText(element);
      return;
    case "trainer":
      if (name === "notes") draft.notes = inlineMarkdown(element);
      return;
    case "items":
    case "gifts":
      if (name === "title") draft.title = plainText(element);
      if (name === "description") draft.description = plainText(element);
      if (name === "note" && entry !== undefined && draft.entries[entry]) draft.entries[entry]!.note = plainText(element);
      return;
    case "encounter":
      return;
  }
}

/** A draft with nothing left to show: a cleared paragraph, list or heading. */
export function isEmptyDraft(draft: BlockDraft): boolean {
  if (draft.kind === "text" || draft.kind === "heading") return !draft.text.trim();
  if (draft.kind === "list") return draft.items.every((item) => !item.trim());
  return false;
}

export function plainText(element: Node): string {
  return (element.textContent ?? "").replace(/ /gu, " ").replace(/\s*\n\s*/gu, " ");
}

/** `[text](address)` links as links, the rest as text. The address is kept as written in `data-href`. */
export function inlineHtml(markdown: string): string {
  let html = "";
  let at = 0;
  const pattern = /\[([^\]]*)\]\(([^)\s]*)\)/gu;
  for (let match = pattern.exec(markdown); match; match = pattern.exec(markdown)) {
    html += esc(markdown.slice(at, match.index));
    html += linkHtml(match[1]!, match[2]!);
    at = match.index + match[0].length;
  }
  return html + esc(markdown.slice(at));
}

export function linkHtml(text: string, href: string): string {
  return `<a href="${esc(/^(https?:|mailto:|#)/iu.test(href) ? href : "#")}" data-href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
}

/** The markdown of an edited field: text as typed, links back as `[text](address)`. */
export function inlineMarkdown(node: Node): string {
  let out = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? "";
    else if (child instanceof HTMLAnchorElement) {
      const text = plainText(child).trim();
      const href = child.dataset.href ?? child.getAttribute("href") ?? "";
      out += text && href ? `[${text}](${href})` : text;
    } else if (child instanceof HTMLBRElement) out += " ";
    else out += inlineMarkdown(child);
  });
  return out.replace(/ /gu, " ").replace(/\s*\n\s*/gu, " ");
}
