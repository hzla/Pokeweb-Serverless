import { publicAsset } from "../assetUrl";
import { BATTLE_TYPES } from "../pokeweb/constants";
import { overworldSpriteIds, spriteDirectionOffset, spriteSlugForOverworldSprite } from "../pokeweb/overworldModel";
import {
  addItemBallNpc,
  addTrainerNpcs,
  buildTrainerOverworldIndex,
  checkItemFlag,
  checkTrainerScript,
  inItemFlagBlock,
  DEFAULT_TRAINER_SIGHT,
  ITEM_BALL_SPRITE,
  readGroundItemScripts,
  suggestItemFlag,
  usedEventFlags,
  MAX_SHORTCUT_TRAINER_ID,
  suggestedTrainerSprite,
  TRAINER_PAIR_SCRIPT_BASE,
  TRAINER_SCRIPT_BASE,
  type TrainerOverworldIndex,
} from "../pokeweb/overworldShortcutModel";
import { getPokemonIconImage } from "../pokeweb/pokemonSpriteModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { getTrainerCount, getTrainerRecord, type TrainerRecord } from "../pokeweb/trainerModel";
import { escapeHtml } from "./dom";
import { renderPartyIcon, trainerDisplayName } from "./trainerDetail";
import { installPicker } from "./trainerInteractions";

const FACINGS = [
  { value: 0, label: "Up" },
  { value: 1, label: "Down" },
  { value: 2, label: "Left" },
  { value: 3, label: "Right" },
] as const;

/** Opens a modal dialog inside host (so the editor's scoped styles reach it) and removes it once closed. */
function openDialog(host: HTMLElement, className: string, title: string, body: string): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = `ow-dialog ${className}`;
  dialog.setAttribute("aria-label", title);
  dialog.innerHTML = `
    <header class="ow-dialog-head">
      <h2>${escapeHtml(title)}</h2>
      <button class="btn sm -ghost" type="button" data-dialog-close aria-label="Close">&times;</button>
    </header>
    ${body}`;
  dialog.querySelectorAll<HTMLButtonElement>("[data-dialog-close]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  // Inside the editor, so its scoped styles reach the dialog; showModal still lifts it above the page.
  (host.closest("#overworld-editor") ?? host.querySelector("#overworld-editor") ?? host).append(dialog);
  dialog.showModal();
  return dialog;
}

// ---------- Sprites ----------

/** An overworld sprite's down-facing frame, cut from its sheet once the image loads. */
export function spriteFrameHtml(spriteId: number, className = ""): string {
  const src = publicAsset(`images/overworlds/${spriteSlugForOverworldSprite(spriteId)}.png`);
  return `<span class="ow-sprite-frame ${className}"><img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" data-sprite-frame onerror="this.hidden=true;this.parentElement?.classList.add('-missing')"></span>`;
}

/** Positions each sheet in [data-sprite-frame] on its down-facing frame. Frames are square: as tall as the sheet is wide. */
export function fitSpriteFrames(root: ParentNode): void {
  root.querySelectorAll<HTMLImageElement>("img[data-sprite-frame]").forEach((image) => {
    const apply = () => {
      const frameCount = Math.max(1, Math.round(image.naturalHeight / Math.max(1, image.naturalWidth)));
      const offset = spriteDirectionOffset(frameCount, 1);
      const frame = offset === "f" ? 0 : offset;
      image.style.top = `${-frame * 100}%`;
    };
    if (image.complete && image.naturalHeight > 0) apply();
    else image.addEventListener("load", apply, { once: true });
  });
}

export type SpritePickerOptions = {
  current: number;
  /** Names to show beside a sprite id, such as the trainer class that wears it. */
  labels?: Map<number, string>;
  onPick: (spriteId: number) => void;
};

/** A grid of every overworld sprite, facing down; clicking one picks it. */
export function openSpritePicker(host: HTMLElement, options: SpritePickerOptions): void {
  const ids = overworldSpriteIds();
  const label = (id: number) => options.labels?.get(id);
  const dialog = openDialog(
    host,
    "-sprites",
    "Choose a sprite",
    `<div class="ow-dialog-tools">
      <input class="ow-input" type="search" data-sprite-search placeholder="Search by id or trainer class" aria-label="Search sprites" autocomplete="off" spellcheck="false">
      <span class="ow-muted" data-sprite-count></span>
    </div>
    <div class="ow-sprite-grid" role="listbox" aria-label="Sprites">
      ${ids
        .map((id) => {
          const name = label(id);
          const title = name ? `${id}: ${name}` : String(id);
          return `<button class="ow-sprite-cell${id === options.current ? " is-current" : ""}" type="button" role="option" aria-selected="${id === options.current}" data-sprite-id="${id}" data-search="${escapeHtml(`${id} ${name ?? ""}`.toLowerCase())}" title="${escapeHtml(title)}">${spriteFrameHtml(id)}<span class="ow-sprite-id">${id}</span></button>`;
        })
        .join("")}
    </div>`,
  );
  fitSpriteFrames(dialog);
  const search = dialog.querySelector<HTMLInputElement>("[data-sprite-search]")!;
  const count = dialog.querySelector<HTMLElement>("[data-sprite-count]")!;
  const cells = [...dialog.querySelectorAll<HTMLButtonElement>(".ow-sprite-cell")];
  const filter = () => {
    const query = search.value.trim().toLowerCase();
    let shown = 0;
    for (const cell of cells) {
      const id = cell.dataset.spriteId ?? "";
      const match = !query || (/^\d+$/u.test(query) ? id.startsWith(query) : (cell.dataset.search ?? "").includes(query));
      cell.hidden = !match;
      if (match) shown += 1;
    }
    count.textContent = `${shown} sprite${shown === 1 ? "" : "s"}`;
  };
  search.addEventListener("input", filter);
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const first = cells.find((cell) => !cell.hidden);
    first?.click();
  });
  dialog.querySelector(".ow-sprite-grid")?.addEventListener("click", (event) => {
    const cell = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-sprite-id]");
    if (!cell) return;
    options.onPick(Number(cell.dataset.spriteId));
    dialog.close();
  });
  filter();
  dialog.querySelector(".is-current")?.scrollIntoView({ block: "center" });
  search.focus();
}

/** Trainer class names by the sprite they wear on the maps, for the sprite grid's labels and search. */
export function spriteClassLabels(project: ProjectState, index: TrainerOverworldIndex): Map<number, string> {
  const classNames = project.texts.banks.tr_classes ?? [];
  const labels = new Map<number, string[]>();
  for (const [trainerClass, sprite] of index.spriteByClass) {
    const name = String(classNames[trainerClass] ?? "").trim();
    if (!name) continue;
    labels.set(sprite, [...(labels.get(sprite) ?? []), name]);
  }
  return new Map([...labels].map(([sprite, names]) => [sprite, [...new Set(names)].join(", ")]));
}

// ---------- Trainers ----------

export type TrainerShortcutOptions = {
  overworldId: number;
  position: { x: number; y: number };
  /** Overworld labels by id, to say where a trainer already stands. */
  overworldLabel: (overworldId: number) => string;
  onPlaced: (npcIndexes: number[]) => void;
};

/** "+ Trainer": pick a trainer, check its party, and place it as an NPC that battles on sight. */
export function openTrainerShortcut(host: HTMLElement, project: ProjectState, options: TrainerShortcutOptions): void {
  const index = buildTrainerOverworldIndex(project);
  const count = Math.min(getTrainerCount(project), MAX_SHORTCUT_TRAINER_ID + 1);
  const trainers: TrainerRecord[] = [];
  for (let id = 1; id < count; id += 1) {
    try {
      trainers.push(getTrainerRecord(project, id, { includeTexts: false }));
    } catch {
      // A damaged trainer record can't be placed; leave it out of the list.
    }
  }
  const optionLabel = (trainer: TrainerRecord) => `${String(trainer.readable.class ?? "").trim()} ${trainerDisplayName(trainer)}`.trim();
  const pickerValues = trainers.map((trainer) => `${optionLabel(trainer)} (${trainer.id})`);
  const byId = new Map(trainers.map((trainer) => [trainer.id, trainer]));

  const state = { trainer: undefined as TrainerRecord | undefined, sprite: 1, partnerSprite: 1, direction: 1, sight: DEFAULT_TRAINER_SIGHT, pair: false };

  const dialog = openDialog(
    host,
    "-trainer",
    "Place a trainer",
    `<form class="ow-dialog-body" method="dialog">
      <div class="ow-row">
        <span class="ow-label">Trainer</span>
        <div class="ow-file-picker"><div contenteditable="true" spellcheck="false" data-trainer-picker aria-label="Trainer"></div></div>
      </div>
      <div class="ow-trainer-card" data-trainer-card hidden></div>
      <div class="ow-dialog-grid">
        <label class="ow-row">
          <span class="ow-label">Facing</span>
          <select class="ow-input" data-trainer-facing>${FACINGS.map((facing) => `<option value="${facing.value}" ${facing.value === state.direction ? "selected" : ""}>${facing.label}</option>`).join("")}</select>
        </label>
        <label class="ow-row">
          <span class="ow-label">Sight range</span>
          <input class="ow-input" data-trainer-sight type="number" min="0" max="15" step="1" value="${state.sight}">
        </label>
      </div>
      <fieldset class="ow-trainer-pair" data-trainer-pair hidden>
        <legend class="ow-label">Doubles battle</legend>
        <label><input type="radio" name="ow-trainer-pair" value="single" checked> One NPC</label>
        <label><input type="radio" name="ow-trainer-pair" value="pair"> A pair of NPCs</label>
        <span class="ow-trainer-partner" data-trainer-partner hidden>
          <span class="ow-muted">Partner</span>
          <button class="ow-sprite-button" type="button" data-pick-sprite="partner" title="Choose the partner's sprite" aria-label="Choose the partner's sprite"></button>
        </span>
      </fieldset>
      <p class="ow-muted ow-dialog-note" data-trainer-note></p>
      <footer class="ow-dialog-actions">
        <button class="btn sm -ghost" type="button" data-dialog-close>Cancel</button>
        <button class="btn sm -default" type="submit" data-trainer-place disabled>Place trainer</button>
      </footer>
    </form>`,
  );

  const picker = dialog.querySelector<HTMLElement>("[data-trainer-picker]")!;
  const card = dialog.querySelector<HTMLElement>("[data-trainer-card]")!;
  const facing = dialog.querySelector<HTMLSelectElement>("[data-trainer-facing]")!;
  const sight = dialog.querySelector<HTMLInputElement>("[data-trainer-sight]")!;
  const pairBox = dialog.querySelector<HTMLFieldSetElement>("[data-trainer-pair]")!;
  const partner = dialog.querySelector<HTMLElement>("[data-trainer-partner]")!;
  const partnerButton = partner.querySelector<HTMLButtonElement>("[data-pick-sprite]")!;
  const note = dialog.querySelector<HTMLElement>("[data-trainer-note]")!;
  const place = dialog.querySelector<HTMLButtonElement>("[data-trainer-place]")!;
  const labels = spriteClassLabels(project, index);

  const pickSprite = (which: "trainer" | "partner") =>
    openSpritePicker(host, {
      current: which === "trainer" ? state.sprite : state.partnerSprite,
      labels,
      onPick: (spriteId) => {
        if (which === "trainer") {
          if (state.partnerSprite === state.sprite) state.partnerSprite = spriteId;
          state.sprite = spriteId;
        } else {
          state.partnerSprite = spriteId;
        }
        render();
      },
    });

  const render = () => {
    const trainer = state.trainer;
    place.disabled = !trainer;
    card.hidden = !trainer;
    const doubles = Number(trainer?.raw.battle_type_1 ?? 0) === 1;
    pairBox.hidden = !doubles;
    if (!doubles) state.pair = false;
    partner.hidden = !state.pair;
    partnerButton.innerHTML = spriteFrameHtml(state.partnerSprite);
    if (!trainer) {
      note.textContent = "Type a trainer's name, class or id.";
      return;
    }
    const battle = BATTLE_TYPES[Number(trainer.raw.battle_type_1 ?? 0)] ?? "Singles";
    const placed = index.placements.get(trainer.id) ?? [];
    const placedText = placed.length
      ? `Already on ${[...new Set(placed.map((placement) => options.overworldLabel(placement.overworldId)))].slice(0, 3).join(", ")}${placed.length > 3 ? "…" : ""}.`
      : "";
    card.innerHTML = `
      <button class="ow-sprite-button -large" type="button" data-pick-sprite="trainer" title="Choose a sprite" aria-label="Choose a sprite">${spriteFrameHtml(state.sprite)}</button>
      <div class="ow-trainer-main">
        <div class="ow-trainer-name">${escapeHtml(optionLabel(trainer))} <span class="ow-muted">#${trainer.id}</span></div>
        <div class="ow-muted">${escapeHtml(battle)} · sprite ${state.sprite}</div>
        <div class="ow-trainer-party trainer-poks">${
          trainer.party.length
            ? trainer.party.map((pok) => `<span class="ow-trainer-mon">${renderPartyIcon(project, pok, "ow-trainer-icon")}<span>Lv ${pok.level}</span></span>`).join("")
            : `<span class="ow-muted">No Pokémon</span>`
        }</div>
        ${placedText ? `<div class="ow-trainer-placed">${escapeHtml(placedText)}</div>` : ""}
      </div>`;
    card.querySelector<HTMLButtonElement>("[data-pick-sprite]")?.addEventListener("click", () => pickSprite("trainer"));
    fitSpriteFrames(dialog);
    hydratePartyIcons(project, card);
    const scriptCheck = checkTrainerScript(project, trainer.id);
    if (!scriptCheck.ok) {
      place.disabled = true;
      note.textContent = scriptCheck.reason;
      return;
    }
    const where = `at ${options.position.x}, ${options.position.y}`;
    const expands = scriptCheck.expands ? " The trainer script table is expanded to include this trainer." : "";
    note.textContent = state.pair
      ? `Places two NPCs ${where} that battle the player together on sight, with scripts ${TRAINER_SCRIPT_BASE + trainer.id} and ${TRAINER_PAIR_SCRIPT_BASE + trainer.id}.${expands}`
      : `Places an NPC ${where} that battles the player on sight, with script ${TRAINER_SCRIPT_BASE + trainer.id}.${expands}`;
  };

  const chooseTrainer = (trainer: TrainerRecord | undefined) => {
    state.trainer = trainer;
    if (trainer) {
      picker.textContent = optionLabel(trainer);
      const sprite = suggestedTrainerSprite(project, index, Number(trainer.raw.class ?? 0));
      if (sprite !== undefined) {
        state.sprite = sprite;
        state.partnerSprite = sprite;
      }
    }
    render();
  };

  const trainerPicker = installPicker(picker, pickerValues);
  picker.addEventListener("focus", () => {
    window.setTimeout(() => {
      if (document.activeElement !== picker) return;
      const range = document.createRange();
      range.selectNodeContents(picker);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }, 0);
    trainerPicker?.open();
  });
  picker.addEventListener("keydown", (event) => {
    if (trainerPicker?.handleKey(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      picker.blur();
    }
  });
  picker.addEventListener("blur", () => {
    trainerPicker?.close();
    const raw = (picker.dataset.commitValue ?? picker.textContent ?? "").trim();
    delete picker.dataset.commitValue;
    delete picker.dataset.commitLabel;
    const id = /\((\d+)\)$/u.exec(raw)?.[1] ?? /^#?(\d+)$/u.exec(raw)?.[1];
    const trainer = id !== undefined ? byId.get(Number(id)) : trainers.find((entry) => optionLabel(entry).toLowerCase() === raw.toLowerCase());
    if (trainer) chooseTrainer(trainer);
    else if (state.trainer) picker.textContent = optionLabel(state.trainer);
  });

  facing.addEventListener("change", () => {
    state.direction = Number(facing.value);
  });
  sight.addEventListener("change", () => {
    state.sight = Math.max(0, Math.min(15, Math.trunc(Number(sight.value) || 0)));
    sight.value = String(state.sight);
  });
  pairBox.addEventListener("change", () => {
    state.pair = pairBox.querySelector<HTMLInputElement>("input[value='pair']")?.checked ?? false;
    render();
  });
  partnerButton.addEventListener("click", () => pickSprite("partner"));
  dialog.querySelector("form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.trainer) return;
    try {
      const indexes = addTrainerNpcs(project, options.overworldId, {
        trainerId: state.trainer.id,
        sprite: state.sprite,
        direction: state.direction,
        sight: state.sight,
        x: options.position.x,
        y: options.position.y,
        pair: state.pair ? { sprite: state.partnerSprite } : undefined,
      });
      dialog.close();
      options.onPlaced(indexes);
    } catch (error) {
      note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  render();
  picker.focus();
}

// ---------- Items ----------

export type ItemShortcutOptions = {
  overworldId: number;
  position: { x: number; y: number };
  onPlaced: (npcIndex: number) => void;
};

function itemIconSrc(itemName: string): string {
  return publicAsset(`images/item_sprites/${itemName.normalize("NFKD").replace(/[^a-zA-Z0-9]/gu, "").toLowerCase()}.png`);
}

/** "+ Item": pick an item and place a ball that gives it once, with its own event flag. */
export function openItemShortcut(host: HTMLElement, project: ProjectState, options: ItemShortcutOptions): void {
  const itemNames = project.texts.banks.items ?? [];
  const items = itemNames
    .map((name, id) => ({ id, name: String(name ?? "").trim() }))
    .filter((item) => item.id > 0 && item.name && item.name !== "???" && item.name !== "-----");
  const byId = new Map(items.map((item) => [item.id, item]));
  const scriptFile = readGroundItemScripts(project);
  const used = usedEventFlags(project);
  const suggested = suggestItemFlag(project, used);
  const state = { item: undefined as { id: number; name: string } | undefined, quantity: 1, flag: suggested ?? 0, sprite: ITEM_BALL_SPRITE };

  const dialog = openDialog(
    host,
    "-item",
    "Place an item ball",
    `<form class="ow-dialog-body" method="dialog">
      <div class="ow-row">
        <span class="ow-label">Item</span>
        <div class="ow-file-picker"><div contenteditable="true" spellcheck="false" data-item-picker aria-label="Item"></div></div>
      </div>
      <div class="ow-item-card">
        <button class="ow-sprite-button -large" type="button" data-pick-sprite title="Choose the ball's sprite" aria-label="Choose the ball's sprite"></button>
        <img class="ow-item-icon" data-item-icon alt="" hidden>
        <div class="ow-trainer-main">
          <div class="ow-trainer-name" data-item-name>No item chosen</div>
          <div class="ow-muted" data-item-script></div>
        </div>
      </div>
      <div class="ow-dialog-grid">
        <label class="ow-row">
          <span class="ow-label">Quantity</span>
          <input class="ow-input" data-item-quantity type="number" min="1" max="999" step="1" value="1">
        </label>
        <label class="ow-row">
          <span class="ow-label">Event flag</span>
          <input class="ow-input" data-item-flag type="number" min="1" max="16383" step="1" value="${state.flag || ""}">
        </label>
      </div>
      <p class="ow-dialog-note" data-item-flag-note></p>
      <footer class="ow-dialog-actions">
        <button class="btn sm -ghost" type="button" data-dialog-close>Cancel</button>
        <button class="btn sm -default" type="submit" data-item-place disabled>Place item</button>
      </footer>
    </form>`,
  );

  const picker = dialog.querySelector<HTMLElement>("[data-item-picker]")!;
  const icon = dialog.querySelector<HTMLImageElement>("[data-item-icon]")!;
  const name = dialog.querySelector<HTMLElement>("[data-item-name]")!;
  const scriptLine = dialog.querySelector<HTMLElement>("[data-item-script]")!;
  const quantity = dialog.querySelector<HTMLInputElement>("[data-item-quantity]")!;
  const flag = dialog.querySelector<HTMLInputElement>("[data-item-flag]")!;
  const flagNote = dialog.querySelector<HTMLElement>("[data-item-flag-note]")!;
  const place = dialog.querySelector<HTMLButtonElement>("[data-item-place]")!;
  const spriteButton = dialog.querySelector<HTMLButtonElement>("[data-pick-sprite]")!;
  icon.addEventListener("error", () => {
    icon.hidden = true;
  });

  const render = () => {
    spriteButton.innerHTML = spriteFrameHtml(state.sprite);
    fitSpriteFrames(spriteButton);
    const item = state.item;
    name.textContent = item ? `${item.name}${state.quantity > 1 ? ` ×${state.quantity}` : ""}` : "No item chosen";
    if (item) {
      icon.hidden = false;
      icon.src = itemIconSrc(item.name);
    } else {
      icon.hidden = true;
    }
    let scriptOk = Boolean(scriptFile);
    if (!scriptFile) {
      scriptLine.textContent = "The item ball script file isn't in the usual format, so items can't be placed here.";
    } else if (item) {
      const shared = scriptFile.entries.filter((entry) => entry.itemId === item.id && entry.quantity === state.quantity);
      if (shared.length) {
        scriptLine.textContent = `Uses item ball script ${shared[0]!.scriptId}.`;
      } else if (scriptFile.freeSlots > 0) {
        scriptLine.textContent = `Adds item ball script ${7000 + 800 - scriptFile.freeSlots} (${scriptFile.freeSlots} free).`;
      } else {
        scriptLine.textContent = "The item ball scripts are full (7000-7799). Pick an item and quantity that already has one.";
        scriptOk = false;
      }
    } else {
      scriptLine.textContent = "Type an item's name or id.";
    }
    const check = checkItemFlag(project, state.flag, used);
    if (!state.flag) flagNote.textContent = "Every flag the item could use is taken. Enter one yourself.";
    else if (!check.ok) flagNote.textContent = check.reason ?? "";
    else flagNote.textContent = inItemFlagBlock(project, state.flag)
      ? `Flag ${state.flag} is free: no script, NPC or patch uses it, and it's in the block the game's own item balls use. Picking up the item sets it, which keeps the ball hidden.`
      : `Flag ${state.flag} is free: no script, NPC or patch uses it. It's outside the item ball block, so check the Flag reference if you've added events that set flags from code.`;
    flagNote.classList.toggle("-bad", Boolean(state.flag) && !check.ok);
    place.disabled = !item || !scriptOk || !check.ok;
  };

  const itemPicker = installPicker(picker, items.map((item) => `${item.name} (${item.id})`));
  picker.addEventListener("focus", () => {
    window.setTimeout(() => {
      if (document.activeElement !== picker) return;
      const range = document.createRange();
      range.selectNodeContents(picker);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }, 0);
    itemPicker?.open();
  });
  picker.addEventListener("keydown", (event) => {
    if (itemPicker?.handleKey(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      picker.blur();
    }
  });
  picker.addEventListener("blur", () => {
    itemPicker?.close();
    const raw = (picker.dataset.commitValue ?? picker.textContent ?? "").trim();
    delete picker.dataset.commitValue;
    delete picker.dataset.commitLabel;
    const id = /\((\d+)\)$/u.exec(raw)?.[1] ?? /^#?(\d+)$/u.exec(raw)?.[1];
    const item = id !== undefined ? byId.get(Number(id)) : items.find((entry) => entry.name.toLowerCase() === raw.toLowerCase());
    if (item) state.item = item;
    picker.textContent = state.item?.name ?? "";
    render();
  });
  quantity.addEventListener("input", () => {
    state.quantity = Math.max(1, Math.min(999, Math.trunc(Number(quantity.value) || 1)));
    render();
  });
  quantity.addEventListener("change", () => {
    quantity.value = String(state.quantity);
  });
  flag.addEventListener("input", () => {
    state.flag = Math.trunc(Number(flag.value) || 0);
    render();
  });
  spriteButton.addEventListener("click", () =>
    openSpritePicker(host, {
      current: state.sprite,
      onPick: (spriteId) => {
        state.sprite = spriteId;
        render();
      },
    }),
  );
  dialog.querySelector("form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.item) return;
    try {
      const result = addItemBallNpc(project, options.overworldId, {
        itemId: state.item.id,
        quantity: state.quantity,
        flag: state.flag,
        sprite: state.sprite,
        x: options.position.x,
        y: options.position.y,
      });
      dialog.close();
      options.onPlaced(result.npcIndex);
    } catch (error) {
      flagNote.textContent = error instanceof Error ? error.message : String(error);
      flagNote.classList.add("-bad");
    }
  });

  render();
  picker.focus();
}

/** Draws party icons from the ROM, or the bundled image when the ROM has none. */
function hydratePartyIcons(project: ProjectState, root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(".wild").forEach((preview) => {
    const canvas = preview.querySelector<HTMLCanvasElement>("canvas.trainer-pokemon-rom-icon");
    const fallback = () => {
      const image = preview.querySelector<HTMLImageElement>("img[data-trainer-image-src]");
      if (!image) return;
      image.src = image.dataset.trainerImageSrc!;
      delete image.dataset.trainerImageSrc;
    };
    const spriteId = Number(canvas?.dataset.trainerPokemonSpriteId);
    const variant = canvas?.dataset.trainerPokemonIconVariant;
    if (!canvas || !Number.isInteger(spriteId) || (variant !== "male" && variant !== "female")) {
      fallback();
      return;
    }
    void Promise.resolve()
      .then(() => getPokemonIconImage(project, spriteId, variant))
      .then((image) => {
        if (!image || !canvas.isConnected) {
          fallback();
          return;
        }
        const frameHeight = Math.min(image.width, image.height);
        canvas.width = image.width;
        canvas.height = frameHeight;
        canvas.getContext("2d")?.putImageData(new ImageData(image.pixels.slice(0, image.width * frameHeight * 4), image.width, frameHeight), 0, 0);
        canvas.hidden = false;
        canvas.classList.add("-loaded");
        preview.querySelector<HTMLImageElement>("img[data-trainer-image-src]")?.remove();
      })
      .catch(() => fallback());
  });
}
