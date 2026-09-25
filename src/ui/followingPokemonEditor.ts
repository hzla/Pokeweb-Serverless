import { unzipSync, zipSync } from "fflate";
import { decodeRecord, type ProjectState } from "../pokeweb/projectStore";
import { NARC } from "../nds/narc";
import { downloadBytes, getRomFileBytes } from "../pokeweb/fileSystemModel";
import { checkFollowerCompatibility, installFollowerAlpha, removeFollowerAlpha, readFollowerAlphaInstall, setFollowerAlphaEnabled, followerRom, prepareFollowerWorkspace, readFollowerAsset, readFollowerWorkspace, replaceFollowerAssets, followerArtworkPending, followerRuntimeVersion, readFollowerDialogueRules, writeFollowerDialogueRules, readFollowerItemRules, writeFollowerItemRules, FOLLOWER_RUNTIME_REGISTRY_PATH, type FollowerAssetWorkspace, type FollowerRom, type FollowerAlphaInstall } from "../pokeweb/followingPokemonProject";
import { typeNamesForProject } from "../pokeweb/constants";
import { getPokemonPersonalIds } from "../pokeweb/pokemonModel";
import { findPokemonBaseSpeciesId, findPokemonPersonalFormOwner, pokemonSpeciesLabel } from "../pokeweb/pokemonLabels";
import type { FollowerDialogueRule } from "../pokeweb/followingPokemonDialogues";
import type { FollowerItemRule } from "../pokeweb/followingPokemonItems";
import { FOLLOWER_DIRECTIONS, decodeFollowerRegistry, encodeFollowerFrames, followerFramesFromSheet, followerKey, followerPreview, followerSheetFromFrames, type FollowerAssetEntry, type FollowerFrame } from "../pokeweb/followingPokemonModel";
import { parseHeaders } from "../pokeweb/headerModel";
import { escapeHtml } from "./dom";

const templates = {
  32: new URL("../assets/following/template-32-8.btx", import.meta.url),
  64: new URL("../assets/following/template-64-8.btx", import.meta.url),
};
export const FOLLOWER_SPRITE_CREDITS = "Smogon Sprite Project, TraviS, LennyBitao, MyMarshlands, DarkusShadow, CarmaNekko, kiriaura, Gnomowladny, Krune, n-kin, JaegerLucciano23, joshr691, Jefelin, MultiDiegoDani, onigin_pixelart, Prodigal96, zerudez, leparagon, arinoelle, diegotoon20, gardow, greyenna, conyjams, kingofthe-x-roads, RayquazaFlygon, metalflygon08 on DeviantArt, and MaMe, maple, Layell, SelenaFF, Sopita Yorita, zlolxd - Pokémon Sprites";
const FOLLOWER_OVERWORLD_CREDITS: Array<[string, string]> = [
  ["Gen 1-5 Pokemon Overworlds", "MissingLukey, help-14, Kymoyonian, cSc-A7X, 2and2makes5, Pokegirl4ever, Fernandojl, Silver-Skies, TyranitarDark, Getsuei-H, Kid1513, Milomilotic11, Kyt666, kdiamo11, Chocosrawlooid, Syledude, Gallanty, Gizamimi-Pichu, 2and2makes5, Zyon17,LarryTurbo, spritesstealer, LarryTurbo"],
  ["Gen 6+ Berry Tree Overworlds", "Anarlaurendil"],
  ["Gen 6 Pokemon Overworlds", "princess-pheonix, LunarDusk, Wolfang62, TintjeMadelintje101, piphybuilder88"],
  ["Gen 7 Pokemon Overworlds", "Larry Turbo, princess-pheonix"],
  ["Gen 8 Pokemon Overworlds", "SageDeoxys, Wolfang62, LarryTurbo, tammyclaydon"],
  ["PLA Pokemon Overworlds", "Boonzeet, DarkusShadow, princess-phoenix, Ezeart, WolfPP"],
  ["Gen 9 Pokemon Overworlds", "Azria, DarkusShadow, EduarPokeN, Carmanekko, StarWolff, Caruban"],
  ["PLZA Pokemon Overworlds", "DarkusShadow"],
];
const hpConditions: Array<[number, string]> = [[1, "Full HP"], [2, "75–99% HP"], [3, "50–74% HP"], [4, "25–49% HP"], [5, "Below 25% HP"]];
const friendshipConditions: Array<[number, string]> = [[1, "Maximum (255)"], [2, "Very high (200–254)"], [3, "High (150–199)"], [4, "Friendly (90–149)"], [5, "Neutral (60–89)"], [6, "Low (30–59)"], [7, "Very low (1–29)"], [8, "Minimum (0)"], [9, "90 or higher"], [10, "Below 60"]];
const statusConditions: Array<[number, string]> = [[1, "Healthy"], [2, "Burned"], [3, "Frozen"], [4, "Paralyzed"], [5, "Poisoned"], [7, "Any status condition"], [8, "Asleep"]];
const facingConditions: Array<[number, string]> = [[1, "Facing right"], [2, "Facing left"], [3, "Facing up"], [4, "Facing down"]];
const conditionOptions = (value: number | undefined, choices: Array<[number, string]>) =>
  `<option value="">Any</option>${choices.map(([id, label]) => `<option value="${id}"${value === id ? " selected" : ""}>${label}</option>`).join("")}`;
const referencedId = (value: string): number | undefined => {
  const text = value.trim(), direct = /^\d+$/u.exec(text), suffix = /#(\d+)\s*$/u.exec(text);
  return direct ? Number(direct[0]) : suffix ? Number(suffix[1]) : undefined;
};
const normalizedName = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "");
function speciesDisplayValue(project: ProjectState, id: number): string { return `${pokemonSpeciesLabel(project, id)} #${id}`; }
function itemDisplayValue(project: ProjectState, id: number): string { return `${project.texts.banks.items?.[id] ?? `Item ${id}`} #${id}`; }
export function followerZoneLabel(project: ProjectState, zone: number): string {
  if (zone === 0) return "Any zone";
  if (!project.headers && project.narcs.headers && project.formats.headers) {
    try { project.headers = parseHeaders(project); } catch { /* Zone ID remains useful when header data is unavailable. */ }
  }
  const row = project.headers?.rows[zone + 1] ?? Object.values(project.headers?.rows ?? {}).find(value => value.index === zone);
  const name = row?.location_name?.trim();
  return name && name !== "Unknown Location" ? `${name} · Zone ${zone}` : `Zone ${zone}`;
}
export function followerRuleAppliesToSpecies(rule: FollowerDialogueRule | FollowerItemRule, species: number, speciesTypes: ReadonlySet<number>): boolean {
  return (rule.species === undefined || rule.species === species) && (rule.type === undefined || speciesTypes.has(rule.type));
}
function parseSpeciesValue(project: ProjectState, value: string): number {
  const id = referencedId(value);
  return id === undefined ? findPokemonBaseSpeciesId(project, value.trim(), 1023) : id;
}
function parseItemValue(project: ProjectState, value: string): number {
  const id = referencedId(value);
  if (id !== undefined) return id;
  const wanted = normalizedName(value), matches = (project.texts.banks.items ?? []).flatMap((name, itemId) => normalizedName(name) === wanted ? [itemId] : []);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Multiple items are named ${value.trim()}; choose the suggestion containing its #ID.`);
  throw new Error(`Unknown item: ${value.trim()}`);
}
async function pngFrame(file: File): Promise<FollowerFrame> {
  const image = await createImageBitmap(file);
  try {
    if (![64, 128].includes(image.width) || image.height !== image.width * 2) throw new Error("PNG must use the four-direction template (64×128 or 128×256).");
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas is unavailable.");
    context.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, rgba: new Uint8Array(context.getImageData(0, 0, image.width, image.height).data) };
  } finally { image.close(); }
}
function pngDownload(image: FollowerFrame, name: string): void {
  const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
  canvas.toBlob(async blob => { if (blob) downloadBytes(new Uint8Array(await blob.arrayBuffer()), name); }, "image/png");
}
function beginSaveFeedback(button: HTMLButtonElement): void {
  button.disabled = true;
  button.classList.remove("following-save-confirmed");
  button.textContent = "Saving…";
}
function finishSaveFeedback(button: HTMLButtonElement, normalLabel: string): void {
  button.textContent = "Saved!";
  button.classList.add("following-save-confirmed");
  window.setTimeout(() => {
    if (!button.isConnected) return;
    button.textContent = normalLabel;
    button.classList.remove("following-save-confirmed");
    button.disabled = false;
  }, 1600);
}
function cancelSaveFeedback(button: HTMLButtonElement, normalLabel: string): void {
  button.textContent = normalLabel;
  button.classList.remove("following-save-confirmed");
  button.disabled = false;
}
/** Walking alpha and its editable appearance catalog. */
export function renderFollowingPokemonEditor(project: ProjectState, root: HTMLElement, onDirty: () => void): void {
  const aggregateSpeciesIds = getPokemonPersonalIds(project).filter(id => id > 0 && id <= 1023 && !findPokemonPersonalFormOwner(project, id));
  const aggregateSpeciesOptions = aggregateSpeciesIds.map(id => `<option value="${escapeHtml(speciesDisplayValue(project, id))}"></option>`).join("");
  const panel = document.createElement("section"); panel.className = "code-injection-card following-pokemon-editor";
  panel.innerHTML = `<header class="following-editor-hero"><div><span class="following-editor-kicker">Field feature</span><h2>Following Pokémon</h2></div></header>
    <p class="following-mount-help" data-fw-land-help hidden>While stopped outdoors, hold A or B and press the other button to ride the selected visible follower; repeat to dismount. The Pokémon’s Personal base Speed sets travel pace, regardless of level or nature. Holding B while moving speeds up both the Pokémon’s two-frame animation and the trainer’s three-frame riding animation. A mount that knows Surf can carry you onto water. Riding ends at doors, battles, and party changes, and is not saved.</p>
    <div class="following-editor-runtime-actions code-injection-actions"><button class="btn -primary" data-fw-prepare disabled>Prepare asset workspace</button>
    <button class="btn" data-fw-install disabled>Install follower alpha</button><button class="btn" data-fw-toggle hidden>Disable following</button><button class="btn" data-fw-remove hidden>Remove runtime</button></div>
    <section class="following-interaction-workspace"><div class="following-aggregate-toolbar"><label><span>View rules for Pokémon</span><input type="text" list="follower-overview-species" placeholder="Choose a Pokémon" autocomplete="off" data-fw-aggregate-species disabled></label>
      <datalist id="follower-overview-species">${aggregateSpeciesOptions}</datalist><p>Choose a Pokémon to see all global, species, form, and type rules that can apply to it.</p></div>
    <div class="following-interaction-tabs" role="tablist" aria-label="Follower interactions">
      <button type="button" role="tab" aria-selected="true" aria-controls="following-dialogue-panel" id="following-dialogue-tab" class="following-interaction-tab is-active" data-fw-tab="dialogue">Dialogue</button>
      <button type="button" role="tab" aria-selected="false" aria-controls="following-gift-panel" id="following-gift-tab" class="following-interaction-tab" data-fw-tab="gifts" tabindex="-1">Gifts</button>
      <button type="button" role="tab" aria-selected="false" aria-controls="following-overview-panel" id="following-overview-tab" class="following-interaction-tab" data-fw-tab="overview" tabindex="-1">Pokémon overview</button>
    </div><div id="following-dialogue-panel" role="tabpanel" aria-labelledby="following-dialogue-tab" data-fw-dialogues></div>
    <div id="following-gift-panel" role="tabpanel" aria-labelledby="following-gift-tab" data-fw-items hidden></div>
    <div id="following-overview-panel" role="tabpanel" aria-labelledby="following-overview-tab" data-fw-overview hidden></div></section>
    <div data-fw-assets></div><p data-fw-error role="alert"></p>
    <footer class="following-sprite-credits" aria-label="Follower sprite credits"><span>Sprite credits</span><p>${escapeHtml(FOLLOWER_SPRITE_CREDITS)}</p>
      ${FOLLOWER_OVERWORLD_CREDITS.map(([category, creators]) => `<p><strong>${escapeHtml(category)}</strong> — ${escapeHtml(creators)}</p>`).join("")}</footer>`;
  root.append(panel);
  let rom: FollowerRom | undefined, workspace: FollowerAssetWorkspace | undefined, previewWorkspace: FollowerAssetWorkspace | undefined, selected = "", stock: Uint8Array[] | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const error = panel.querySelector<HTMLElement>("[data-fw-error]")!;
  const landHelp = panel.querySelector<HTMLElement>("[data-fw-land-help]")!;
  const prepare = panel.querySelector<HTMLButtonElement>("[data-fw-prepare]")!;
  const install = panel.querySelector<HTMLButtonElement>("[data-fw-install]")!;
  const toggle = panel.querySelector<HTMLButtonElement>("[data-fw-toggle]")!;
  const remove = panel.querySelector<HTMLButtonElement>("[data-fw-remove]")!;
  let enabled = false;
  const assets = panel.querySelector<HTMLElement>("[data-fw-assets]")!;
  const dialogues = panel.querySelector<HTMLElement>("[data-fw-dialogues]")!;
  const items = panel.querySelector<HTMLElement>("[data-fw-items]")!;
  const overview = panel.querySelector<HTMLElement>("[data-fw-overview]")!;
  const aggregateSpecies = panel.querySelector<HTMLInputElement>("[data-fw-aggregate-species]")!;
  let dialogueDraft: FollowerDialogueRule[] | undefined;
  let itemDraft: FollowerItemRule[] | undefined;
  let selectedAggregateSpecies: number | undefined;
  let decodeDialogueRules: (() => FollowerDialogueRule[]) | undefined;
  let decodeItemRules: (() => FollowerItemRule[]) | undefined;
  const refreshAggregateAvailability = () => { aggregateSpecies.disabled = dialogueDraft === undefined || itemDraft === undefined; };
  const fail = (reason: unknown) => { error.textContent = reason instanceof Error ? reason.message : String(reason); };
  const setInteractionTab = (tab: "dialogue" | "gifts" | "overview") => {
    if (tab === "overview") {
      try {
        if (decodeDialogueRules) dialogueDraft = decodeDialogueRules();
        if (decodeItemRules) itemDraft = decodeItemRules();
      } catch (reason) { fail(reason); }
      renderOverview();
    }
    panel.querySelectorAll<HTMLButtonElement>("[data-fw-tab]").forEach(button => {
      const active = button.dataset.fwTab === tab; button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active)); button.tabIndex = active ? 0 : -1;
    });
    dialogues.hidden = tab !== "dialogue"; items.hidden = tab !== "gifts"; overview.hidden = tab !== "overview";
  };
  const tabButtons = Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-fw-tab]"));
  tabButtons.forEach((button, index) => {
    button.addEventListener("click", () => setInteractionTab(button.dataset.fwTab as "dialogue" | "gifts" | "overview"));
    button.addEventListener("keydown", event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const next = tabButtons[(index + (event.key === "ArrowRight" ? 1 : -1) + tabButtons.length) % tabButtons.length];
      setInteractionTab(next.dataset.fwTab as "dialogue" | "gifts" | "overview"); next.focus();
    });
  });
  const getAsset = (entry: FollowerAssetEntry) => {
    const catalog = workspace ?? previewWorkspace;
    if (!rom || !catalog) throw new Error("Follower artwork is not loaded.");
    if (!stock) { const id = rom.filenames.idOf("a/0/4/8"); if (id === undefined) throw new Error("Missing model archive."); stock = new NARC(getRomFileBytes(project, rom, id)).files; }
    return readFollowerAsset(project, rom, catalog, entry, stock);
  };
  const previewEntry = (species?: number, form?: number) => {
    if (!species) return undefined;
    const entries = (workspace ?? previewWorkspace)?.registry.entries ?? [];
    const matching = entries.filter(entry => entry.key.species === species && !entry.key.shiny && entry.key.form === (form ?? 0));
    return matching.find(entry => entry.key.gender === 0) ?? matching.find(entry => entry.key.gender === 2) ?? matching[0]
      ?? entries.find(entry => entry.key.species === species && !entry.key.shiny && entry.key.form === 0);
  };
  const drawRuleSprite = (root: Element, species?: number, form?: number) => {
    const holder = root.querySelector<HTMLElement>("[data-fw-rule-sprite]"); if (!holder) return;
    const canvas = holder.querySelector<HTMLCanvasElement>("canvas")!, fallback = holder.querySelector<HTMLElement>("span")!;
    const label = species ? speciesDisplayValue(project, species) : "Any Pokémon";
    const entry = previewEntry(species, form); holder.title = label; holder.setAttribute("aria-label", label);
    if (!entry) { canvas.hidden = true; fallback.hidden = false; fallback.textContent = species ? "?" : "Any"; return; }
    try {
      const frame = followerPreview(getAsset(entry), entry.animationProfile, "down", 0, false);
      canvas.width = frame.width; canvas.height = frame.height; canvas.hidden = false; fallback.hidden = true;
      canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
    } catch { canvas.hidden = true; fallback.hidden = false; fallback.textContent = "?"; }
  };
  const ruleSummary = (primary: string, zone: number, species?: number) => `<summary class="following-rule-summary">
    <span class="following-rule-sprite" data-fw-rule-sprite role="img" aria-label="${escapeHtml(species ? speciesDisplayValue(project, species) : "Any Pokémon")}"><canvas width="64" height="64" hidden></canvas><span>Any</span></span>
    <span class="following-rule-summary-copy"><span class="following-rule-preview-primary" data-fw-rule-primary>${escapeHtml(primary)}</span><span class="following-rule-preview-zone" data-fw-zone-preview>${escapeHtml(followerZoneLabel(project, zone))}</span></span>
    <span class="following-rule-chevron" aria-hidden="true"></span></summary>`;
  const ruleQualifier = (rule: FollowerDialogueRule | FollowerItemRule, types: string[]) => {
    const qualifiers = [rule.species === undefined ? "Any species" : pokemonSpeciesLabel(project, rule.species)];
    if (rule.form !== undefined) qualifiers.push(`Form ${rule.form}`);
    if (rule.type !== undefined) qualifiers.push(types[rule.type] || `Type ${rule.type}`);
    return qualifiers.join(" · ");
  };
  function renderOverview(): void {
    if (selectedAggregateSpecies === undefined) {
      overview.innerHTML = `<section class="following-editor-section following-aggregate-empty"><h3>Pokémon overview</h3><p>Choose a Pokémon above to collect all of its applicable dialogue and gift rules in one view.</p></section>`;
      return;
    }
    const species = selectedAggregateSpecies, types = typeNamesForProject(project);
    let speciesTypes = new Set<number>();
    try {
      const base = decodeRecord(project, "personal", species).raw;
      const formCount = Math.max(1, Number(base?.num_forms ?? 1)), firstFormId = Number(base?.form_id ?? 0);
      const personalIds = [species, ...(firstFormId > 0 ? Array.from({ length: formCount - 1 }, (_, index) => firstFormId + index) : [])];
      speciesTypes = new Set(personalIds.flatMap(id => {
        const raw = id === species ? base : decodeRecord(project, "personal", id).raw;
        return [Number(raw?.type_1), Number(raw?.type_2)].filter(Number.isInteger);
      }));
    } catch { /* Species-only aggregation still works without personal data. */ }
    const matchingDialogues = (dialogueDraft ?? []).map((rule, index) => ({ rule, index })).filter(({ rule }) => followerRuleAppliesToSpecies(rule, species, speciesTypes));
    const matchingItems = (itemDraft ?? []).map((rule, index) => ({ rule, index })).filter(({ rule }) => followerRuleAppliesToSpecies(rule, species, speciesTypes));
    const entry = (kind: "dialogue" | "gifts", index: number, primary: string, rule: FollowerDialogueRule | FollowerItemRule, detail: string) =>
      `<button type="button" class="following-aggregate-entry" data-fw-overview-open="${kind}" data-fw-overview-index="${index}"><span class="following-aggregate-primary">${escapeHtml(primary)}</span><span>${escapeHtml(followerZoneLabel(project, rule.zone))}</span><small>${escapeHtml(ruleQualifier(rule, types))}${detail ? ` · ${escapeHtml(detail)}` : ""}</small></button>`;
    const typeLabel = [...speciesTypes].map(type => types[type] || `Type ${type}`).join(" / ");
    overview.innerHTML = `<section class="following-editor-section"><div class="following-aggregate-heading"><span class="following-rule-sprite" data-fw-rule-sprite role="img"><canvas width="64" height="64" hidden></canvas><span>?</span></span><div><span class="following-editor-kicker">Applicable interaction rules</span><h3>${escapeHtml(pokemonSpeciesLabel(project, species))}</h3><p>${escapeHtml(typeLabel || "Type data unavailable")}</p></div></div>
      <div class="following-aggregate-columns"><section><h4>Dialogue</h4><div class="following-aggregate-list">${matchingDialogues.length ? matchingDialogues.map(({ rule, index }) => entry("dialogue", index, rule.text, rule, `Rule ${index + 1}`)).join("") : `<p class="following-aggregate-none">No matching dialogue rules.</p>`}</div></section>
      <section><h4>Gifts</h4><div class="following-aggregate-list">${matchingItems.length ? matchingItems.map(({ rule, index }) => entry("gifts", index, `${project.texts.banks.items?.[rule.itemId] ?? rule.itemName}${rule.quantity > 1 ? ` ×${rule.quantity}` : ""}`, rule, `Claim slot ${rule.slot}`)).join("") : `<p class="following-aggregate-none">No matching gift rules.</p>`}</div></section></div></section>`;
    drawRuleSprite(overview, species);
    overview.querySelectorAll<HTMLButtonElement>("[data-fw-overview-open]").forEach(button => button.addEventListener("click", () => {
      const kind = button.dataset.fwOverviewOpen as "dialogue" | "gifts", index = Number(button.dataset.fwOverviewIndex);
      setInteractionTab(kind);
      const target = (kind === "dialogue" ? dialogues : items).querySelector<HTMLDetailsElement>(kind === "dialogue" ? `[data-fw-dialogue-rule="${index}"]` : `[data-fw-item-rule="${index}"]`);
      if (target) { target.open = true; target.scrollIntoView({ behavior: "smooth", block: "center" }); }
    }));
  }
  aggregateSpecies.addEventListener("change", () => {
    if (!aggregateSpecies.value.trim()) { selectedAggregateSpecies = undefined; renderOverview(); return; }
    try {
      selectedAggregateSpecies = parseSpeciesValue(project, aggregateSpecies.value);
      aggregateSpecies.value = speciesDisplayValue(project, selectedAggregateSpecies); error.textContent = "";
      setInteractionTab("overview");
    } catch (reason) { fail(reason); }
  });
  async function renderDialogues(): Promise<void> {
    const rules = dialogueDraft ?? await readFollowerDialogueRules(project, rom), types = typeNamesForProject(project);
    dialogueDraft = rules;
    const typeOptions = `<option value="">Any type</option>${types.map((name, id) => `<option value="${id}">${escapeHtml(name || `Type ${id}`)}</option>`).join("")}`;
    const speciesIds = getPokemonPersonalIds(project).filter(id => id > 0 && id <= 1023 && !findPokemonPersonalFormOwner(project, id));
    const speciesOptions = speciesIds.map(id => `<option value="${escapeHtml(speciesDisplayValue(project, id))}"></option>`).join("");
    const row = (rule: FollowerDialogueRule, index: number) => `<details class="following-rule-card following-dialogue-rule" data-fw-dialogue-rule="${index}">${ruleSummary(rule.text, rule.zone, rule.species)}
      <div class="following-rule-editor"><div class="following-rule-grid">
        <p class="following-rule-subtitle following-span-full">Location and Pokémon</p>
        <label class="following-field"><span>Zone ID</span><input data-d-zone type="number" min="0" max="65535" value="${rule.zone}" required><small data-fw-zone-help>${escapeHtml(followerZoneLabel(project, rule.zone))}</small></label>
        <label class="following-field"><span>Species</span><input data-d-species type="text" list="follower-dialogue-species" value="${rule.species === undefined ? "" : escapeHtml(speciesDisplayValue(project, rule.species))}" placeholder="Any species" autocomplete="off"></label>
        <label class="following-field"><span>Form</span><input data-d-form type="number" min="0" max="255" value="${rule.form ?? ""}" placeholder="Any form"></label>
        <label class="following-field"><span>Type</span><select data-d-type>${typeOptions}</select></label>
        <p class="following-rule-subtitle following-span-full">Optional conditions</p>
        <label class="following-field"><span>HP</span><select data-d-hp>${conditionOptions(rule.hp, hpConditions)}</select></label>
        <label class="following-field"><span>Friendship</span><select data-d-friendship>${conditionOptions(rule.friendship, friendshipConditions)}</select></label>
        <label class="following-field"><span>Status</span><select data-d-status>${conditionOptions(rule.status, statusConditions)}</select></label>
        <label class="following-field"><span>Direction</span><select data-d-facing>${conditionOptions(rule.facing, facingConditions)}</select></label>
        <label class="following-field"><span>Trigger chance</span><div class="following-input-suffix"><input data-d-chance type="number" min="1" max="100" value="${rule.chance ?? 100}"><span>%</span></div></label>
        <label class="following-field following-span-full"><span>Dialogue text</span><textarea data-d-text rows="3" maxlength="191">${escapeHtml(rule.text)}</textarea><small>Tokens: {nickname}, {player}, {location}</small></label>
      </div><div class="following-rule-footer"><span>Dialogue rule ${index + 1} · Rules are checked from top to bottom.</span><button class="btn following-remove-button" type="button" data-d-remove>Remove rule</button></div></div></details>`;
    dialogues.innerHTML = `<section class="following-editor-section"><div class="following-section-heading"><div><h3>Conditional dialogue</h3><p>Show special dialogue in a location or for a matching Pokémon. If no rule matches, the normal HGSS-style reaction is used.</p></div></div><datalist id="follower-dialogue-species">${speciesOptions}</datalist><div class="following-rule-list" data-d-rules>${rules.map(row).join("")}</div><div class="following-section-actions code-injection-actions"><button type="button" class="btn" data-d-add>Add dialogue rule</button><button type="button" class="btn -primary" data-d-save>Save dialogue</button></div><p class="following-save-status" data-d-status role="status"></p></section>`;
    const selectType = (root: Element, value?: number) => { const select = root.querySelector<HTMLSelectElement>("[data-d-type]")!; select.value = value === undefined ? "" : String(value); };
    dialogues.querySelectorAll<HTMLElement>("[data-fw-dialogue-rule]").forEach((root, index) => {
      selectType(root, rules[index].type);
      const species = root.querySelector<HTMLInputElement>("[data-d-species]")!;
      const form = root.querySelector<HTMLInputElement>("[data-d-form]")!;
      const zone = root.querySelector<HTMLInputElement>("[data-d-zone]")!;
      const text = root.querySelector<HTMLTextAreaElement>("[data-d-text]")!;
      drawRuleSprite(root, rules[index].species, rules[index].form);
      const refreshSprite = () => { try { drawRuleSprite(root, species.value.trim() ? parseSpeciesValue(project, species.value) : undefined, form.value.trim() ? Number(form.value) : undefined); } catch { drawRuleSprite(root); } };
      zone.addEventListener("input", () => { const label = followerZoneLabel(project, Number(zone.value) || 0); root.querySelector<HTMLElement>("[data-fw-zone-preview]")!.textContent = label; root.querySelector<HTMLElement>("[data-fw-zone-help]")!.textContent = label; });
      text.addEventListener("input", () => { root.querySelector<HTMLElement>("[data-fw-rule-primary]")!.textContent = text.value || "Empty dialogue"; });
      form.addEventListener("input", refreshSprite);
      species.addEventListener("change", () => {
        if (!species.value.trim()) { refreshSprite(); return; }
        try { species.value = speciesDisplayValue(project, parseSpeciesValue(project, species.value)); refreshSprite(); error.textContent = ""; }
        catch (reason) { fail(reason); }
      });
    });
    decodeDialogueRules = (): FollowerDialogueRule[] => Array.from(dialogues.querySelectorAll<HTMLElement>("[data-fw-dialogue-rule]")).map(root => {
      const num = (selector: string) => { const value = root.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!.value.trim(); return value ? Number(value) : undefined; };
      const typeValue = root.querySelector<HTMLSelectElement>("[data-d-type]")!.value;
      const species = root.querySelector<HTMLInputElement>("[data-d-species]")!.value.trim();
      return { zone: Number(root.querySelector<HTMLInputElement>("[data-d-zone]")!.value), ...(species ? { species: parseSpeciesValue(project, species) } : {}), ...(num("[data-d-form]") !== undefined ? { form: num("[data-d-form]") } : {}), ...(typeValue ? { type: Number(typeValue) } : {}), ...(num("[data-d-hp]") !== undefined ? { hp: num("[data-d-hp]") } : {}), ...(num("[data-d-friendship]") !== undefined ? { friendship: num("[data-d-friendship]") } : {}), ...(num("[data-d-status]") !== undefined ? { status: num("[data-d-status]") } : {}), ...(num("[data-d-facing]") !== undefined ? { facing: num("[data-d-facing]") } : {}), chance: Number(root.querySelector<HTMLInputElement>("[data-d-chance]")!.value), text: root.querySelector<HTMLTextAreaElement>("[data-d-text]")!.value };
    });
    const decode = decodeDialogueRules;
    dialogues.querySelector("[data-d-add]")!.addEventListener("click", () => { try { dialogueDraft = decode(); dialogueDraft.push({ zone: 0, text: "{nickname} is looking around." }); error.textContent = ""; void renderDialogues(); } catch (reason) { fail(reason); } });
    dialogues.querySelectorAll("[data-d-remove]").forEach((button, index) => button.addEventListener("click", () => { try { dialogueDraft = decode(); dialogueDraft.splice(index, 1); error.textContent = ""; void renderDialogues(); } catch (reason) { fail(reason); } }));
    dialogues.querySelector("[data-d-save]")!.addEventListener("click", async event => {
      const button = event.currentTarget as HTMLButtonElement;
      const status = dialogues.querySelector<HTMLElement>("[data-d-status]")!;
      beginSaveFeedback(button);
      try { const edited = decode(); await writeFollowerDialogueRules(project, edited, rom); dialogueDraft = edited; onDirty(); status.textContent = `Saved ${edited.length} conditional dialogue ${edited.length === 1 ? "rule" : "rules"}. Export and restart the game.`; finishSaveFeedback(button, "Save dialogue"); }
      catch (reason) { cancelSaveFeedback(button, "Save dialogue"); fail(reason); status.textContent = reason instanceof Error ? reason.message : String(reason); }
    });
    refreshAggregateAvailability();
  }
  async function renderItems(): Promise<void> {
    const rules = itemDraft ?? await readFollowerItemRules(project, rom), types = typeNamesForProject(project);
    itemDraft = rules;
    const typesHtml = `<option value="">Any type</option>${types.map((name, id) => `<option value="${id}">${escapeHtml(name || `Type ${id}`)}</option>`).join("")}`;
    const speciesIds = getPokemonPersonalIds(project).filter(id => id > 0 && id <= 1023 && !findPokemonPersonalFormOwner(project, id));
    const speciesOptions = speciesIds.map(id => `<option value="${escapeHtml(speciesDisplayValue(project, id))}"></option>`).join("");
    const row = (rule: FollowerItemRule, i: number) => `<details class="following-rule-card" data-fw-item-rule="${i}">${ruleSummary(project.texts.banks.items?.[rule.itemId] ?? rule.itemName, rule.zone, rule.species)}
      <div class="following-rule-editor"><div class="following-rule-grid">
        <p class="following-rule-subtitle following-span-full">Reward</p>
        <label class="following-field"><span>Claim slot</span><select data-i-slot>${Array.from({length:10},(_,n)=>`<option value="${n}"${rule.slot===n?" selected":""}>Slot ${n}</option>`).join("")}</select><small>Each slot can be claimed once per Pokémon</small></label>
        <label class="following-field following-field-wide"><span>Item</span><input data-i-item list="follower-items" value="${escapeHtml(itemDisplayValue(project, rule.itemId))}" required autocomplete="off"><small>Search by item name or enter its ID</small></label>
        <label class="following-field"><span>Quantity</span><input data-i-quantity type="number" min="1" max="99" value="${rule.quantity}" required></label>
        <label class="following-field following-field-wide"><span>Name shown in dialogue</span><input data-i-name maxlength="191" value="${escapeHtml(rule.itemName)}" required></label>
        <p class="following-rule-subtitle following-span-full">When this gift applies</p>
        <label class="following-field"><span>Zone ID</span><input data-i-zone type="number" min="0" max="65535" value="${rule.zone}" required><small data-fw-zone-help>${escapeHtml(followerZoneLabel(project, rule.zone))}</small></label>
        <label class="following-field"><span>Species</span><input data-i-species type="text" list="follower-gift-species" value="${rule.species === undefined ? "" : escapeHtml(speciesDisplayValue(project, rule.species))}" placeholder="Any species" autocomplete="off"></label>
        <label class="following-field"><span>Form</span><input data-i-form type="number" min="0" max="255" value="${rule.form ?? ""}" placeholder="Any form"></label>
        <label class="following-field"><span>Type</span><select data-i-type>${typesHtml}</select></label>
        <label class="following-field"><span>HP</span><select data-i-hp>${conditionOptions(rule.hp, hpConditions)}</select></label>
        <label class="following-field"><span>Friendship</span><select data-i-friendship>${conditionOptions(rule.friendship, friendshipConditions)}</select></label>
        <label class="following-field"><span>Status</span><select data-i-status>${conditionOptions(rule.status, statusConditions)}</select></label>
        <label class="following-field"><span>Direction</span><select data-i-facing>${conditionOptions(rule.facing, facingConditions)}</select></label>
        <label class="following-field following-span-full"><span>Success message</span><textarea data-i-text rows="3" maxlength="191">${escapeHtml(rule.text)}</textarea><small>Tokens: {nickname}, {player}, {location}, {item}</small></label>
      </div><div class="following-rule-footer"><span>Gift rule ${i + 1} · Claim slot ${rule.slot} · The first matching unclaimed gift wins.</span><button type="button" class="btn following-remove-button" data-i-remove>Remove gift</button></div></div></details>`;
    items.innerHTML = `<section class="following-editor-section"><div class="following-section-heading"><div><h3>Follower gifts</h3><p>Create one-time rewards given when the player talks to a matching follower. Each Pokémon remembers ten claim slots. Add as many ordered location and Pokémon rules as fit in the compact archive, and reuse slots across rules.</p></div></div><datalist id="follower-gift-species">${speciesOptions}</datalist><datalist id="follower-items">${Array.from({length: Math.max(project.narcs.items?.fileCount ?? 0, project.texts.banks.items?.length ?? 0)}, (_, id) => id > 0 ? `<option value="${escapeHtml(itemDisplayValue(project, id))}"></option>` : "").join("")}</datalist><div class="following-rule-list" data-i-rules>${rules.map(row).join("")}</div><div class="following-section-actions code-injection-actions"><button type="button" class="btn" data-i-add>Add gift rule</button><button type="button" class="btn -primary" data-i-save>Save gifts</button></div><p class="following-save-status" data-i-status role="status"></p></section>`;
    items.querySelectorAll<HTMLElement>("[data-fw-item-rule]").forEach((root, i) => {
      root.querySelector<HTMLSelectElement>("[data-i-type]")!.value = rules[i].type === undefined ? "" : String(rules[i].type);
      const species = root.querySelector<HTMLInputElement>("[data-i-species]")!;
      const form = root.querySelector<HTMLInputElement>("[data-i-form]")!;
      const zone = root.querySelector<HTMLInputElement>("[data-i-zone]")!;
      drawRuleSprite(root, rules[i].species, rules[i].form);
      const refreshSprite = () => { try { drawRuleSprite(root, species.value.trim() ? parseSpeciesValue(project, species.value) : undefined, form.value.trim() ? Number(form.value) : undefined); } catch { drawRuleSprite(root); } };
      zone.addEventListener("input", () => { const label = followerZoneLabel(project, Number(zone.value) || 0); root.querySelector<HTMLElement>("[data-fw-zone-preview]")!.textContent = label; root.querySelector<HTMLElement>("[data-fw-zone-help]")!.textContent = label; });
      form.addEventListener("input", refreshSprite);
      species.addEventListener("change", () => {
        if (!species.value.trim()) { refreshSprite(); return; }
        try { species.value = speciesDisplayValue(project, parseSpeciesValue(project, species.value)); refreshSprite(); error.textContent = ""; }
        catch (reason) { fail(reason); }
      });
      const item = root.querySelector<HTMLInputElement>("[data-i-item]")!, itemName = root.querySelector<HTMLInputElement>("[data-i-name]")!;
      item.addEventListener("change", () => {
        try {
          const id = parseItemValue(project, item.value), resolvedName = project.texts.banks.items?.[id] ?? `Item ${id}`;
          item.value = itemDisplayValue(project, id);
          if (!itemName.value.trim() || itemName.value === "Item" || /^Item \d+$/u.test(itemName.value)) itemName.value = resolvedName;
          root.querySelector<HTMLElement>("[data-fw-rule-primary]")!.textContent = resolvedName;
          error.textContent = "";
        } catch (reason) { fail(reason); }
      });
    });
    decodeItemRules = (): FollowerItemRule[] => Array.from(items.querySelectorAll<HTMLElement>("[data-fw-item-rule]")).map(root => {
      const optional = (selector: string) => { const value = root.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!.value.trim(); return value ? Number(value) : undefined; };
      const type = root.querySelector<HTMLSelectElement>("[data-i-type]")!.value;
      const species = root.querySelector<HTMLInputElement>("[data-i-species]")!.value.trim();
      return { slot: Number(root.querySelector<HTMLSelectElement>("[data-i-slot]")!.value), itemId: parseItemValue(project, root.querySelector<HTMLInputElement>("[data-i-item]")!.value), quantity: Number(root.querySelector<HTMLInputElement>("[data-i-quantity]")!.value), itemName: root.querySelector<HTMLInputElement>("[data-i-name]")!.value, text: root.querySelector<HTMLTextAreaElement>("[data-i-text]")!.value, zone: Number(root.querySelector<HTMLInputElement>("[data-i-zone]")!.value), ...(species ? {species: parseSpeciesValue(project, species)} : {}), ...(optional("[data-i-form]") !== undefined ? {form: optional("[data-i-form]")} : {}), ...(type ? {type:Number(type)} : {}), ...(optional("[data-i-hp]") !== undefined ? {hp:optional("[data-i-hp]")} : {}), ...(optional("[data-i-friendship]") !== undefined ? {friendship:optional("[data-i-friendship]")} : {}), ...(optional("[data-i-status]") !== undefined ? {status:optional("[data-i-status]")} : {}), ...(optional("[data-i-facing]") !== undefined ? {facing:optional("[data-i-facing]")} : {}) };
    });
    const decode = decodeItemRules;
    items.querySelector("[data-i-add]")!.addEventListener("click", () => { try { itemDraft = decode(); itemDraft.push({slot: 0, itemId:1, quantity:1, itemName:project.texts.banks.items?.[1] ?? "Item", zone:0, text:"{nickname} found a {item}!"}); error.textContent = ""; void renderItems(); } catch (reason) { fail(reason); } });
    items.querySelectorAll("[data-i-remove]").forEach((button, i) => button.addEventListener("click", () => { try { itemDraft = decode(); itemDraft.splice(i, 1); error.textContent = ""; void renderItems(); } catch (reason) { fail(reason); } }));
    items.querySelector("[data-i-save]")!.addEventListener("click", async event => {
      const button = event.currentTarget as HTMLButtonElement, status=items.querySelector<HTMLElement>("[data-i-status]")!;
      beginSaveFeedback(button);
      try { const edited=decode(); await writeFollowerItemRules(project,edited,rom); itemDraft = edited; onDirty(); status.textContent=`Saved ${edited.length} one-time follower ${edited.length===1?"gift":"gifts"}. Export and restart the game.`; finishSaveFeedback(button, "Save gifts"); }
      catch(reason) { cancelSaveFeedback(button, "Save gifts"); fail(reason); status.textContent=reason instanceof Error?reason.message:String(reason); }
    });
    refreshAggregateAvailability();
  }
  const current = () => workspace?.registry.entries.find(e => followerKey(e.key) === selected);
  function renderAssets(): void {
    if (!workspace) return;
    prepare.textContent = "Asset workspace prepared"; prepare.disabled = true;
    const count = workspace.registry.entries.filter(e => e.placeholder).length;
    assets.innerHTML = `<p>Editable catalog (bundled art is installed; custom replacements are not yet used by the runtime): ${workspace.registry.entries.length} appearances · ${count} placeholders · ${Object.keys(workspace.imports).length} replacements</p>
      <label>Species number <input data-fw-filter type="number" min="1" max="1023" placeholder="All species" style="width:8rem"></label>
      <label><input data-fw-missing type="checkbox"> Placeholders only</label>
      <select data-fw-select aria-label="Follower appearance" style="display:block;max-width:100%;margin:0.75rem 0"></select>
      <p data-fw-detail></p><div data-fw-preview style="display:flex;gap:1rem;flex-wrap:wrap"></div>
      <label><input type="checkbox" data-fw-walking checked> Walk animation</label>
      <p>PNG layout: rows up, down, left, right; columns idle and step. Use 64×128 for 32-pixel frames or 128×256 for 64-pixel frames. Maximum 15 opaque DS colors plus transparency.</p>
      <div class="code-injection-actions"><button class="btn" data-fw-import>Replace selected PNG</button><button class="btn" data-fw-export>Export selected PNG</button>
      <button class="btn" data-fw-pack-export>Export asset pack</button><button class="btn" data-fw-pack-import>Import asset pack</button></div>
      <input type="file" data-fw-png hidden accept="image/png"><input type="file" data-fw-zip hidden accept=".zip">`;
    const select = assets.querySelector<HTMLSelectElement>("[data-fw-select]")!;
    const filter = assets.querySelector<HTMLInputElement>("[data-fw-filter]")!;
    const missing = assets.querySelector<HTMLInputElement>("[data-fw-missing]")!;
    function options(): void {
      const entries = workspace!.registry.entries.filter(e => (!filter.value || e.key.species === Number(filter.value)) && (!missing.checked || e.placeholder));
      select.innerHTML = entries.map(e => `<option value="${followerKey(e.key)}">#${e.key.species} · form ${e.key.form} · ${["male", "female", "genderless"][e.key.gender]} · ${e.key.shiny ? "shiny" : "normal"}${e.placeholder ? " · placeholder" : ""}</option>`).join("");
      if (entries.some(e => followerKey(e.key) === selected)) select.value = selected;
      selected = select.value; preview();
    }
    function preview(): void {
      if (timer) clearInterval(timer);
      const entry = current(), previewRoot = assets.querySelector<HTMLElement>("[data-fw-preview]")!;
      previewRoot.innerHTML = "";
      const detail = assets.querySelector<HTMLElement>("[data-fw-detail]")!;
      if (!entry) { detail.textContent = "No matching appearances."; return; }
      detail.textContent = entry.placeholder ? entry.placeholderReason ?? "Placeholder" : `${entry.sourceLabel ?? entry.source} · ${entry.size}-pixel frames`;
      try {
        const bytes = getAsset(entry), frames = FOLLOWER_DIRECTIONS.map(direction => [0, 5, 10, 15].map(tick => followerPreview(bytes, entry.animationProfile, direction, tick)));
        const canvases = FOLLOWER_DIRECTIONS.map(direction => {
          const figure = document.createElement("figure"); figure.style.margin = "0";
          figure.innerHTML = `<canvas width="${entry.size}" height="${entry.size}" style="image-rendering:pixelated;width:128px;height:128px;background:#39434d" aria-label="${direction} follower preview"></canvas><figcaption>${escapeHtml(direction)}</figcaption>`;
          previewRoot.append(figure); return figure.querySelector("canvas")!;
        });
        let tick = 0;
        const draw = () => {
          if (!panel.isConnected) { if (timer) clearInterval(timer); return; }
          const walking = assets.querySelector<HTMLInputElement>("[data-fw-walking]")?.checked;
          canvases.forEach((canvas, i) => { const frame = frames[i][walking ? Math.floor(tick / 5) % 4 : 0]; canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0); });
          tick += 5;
        };
        draw(); timer = setInterval(draw, 1000 / 12);
      } catch (reason) { fail(reason); }
    }
    filter.addEventListener("input", options); missing.addEventListener("change", options);
    select.addEventListener("change", () => { selected = select.value; preview(); }); options();
    const png = assets.querySelector<HTMLInputElement>("[data-fw-png]")!;
    assets.querySelector("[data-fw-import]")!.addEventListener("click", () => { png.value = ""; png.click(); });
    png.addEventListener("change", async () => {
      const file = png.files?.[0], entry = current(); if (!file || !entry || !rom) return;
      try {
        const frames = followerFramesFromSheet(await pngFrame(file));
        const response = await fetch(templates[frames[0].width as 32 | 64]); if (!response.ok) throw new Error("Missing billboard template.");
        const bytes = encodeFollowerFrames(frames, new Uint8Array(await response.arrayBuffer()));
        workspace = replaceFollowerAssets(project, rom, [{ key: entry.key, bytes, profile: "pokemon-asymmetric", source: "png", label: file.name }]);
        error.textContent = ""; onDirty(); renderAssets(); await refreshRuntime(await readFollowerAlphaInstall(project, rom));
      } catch (reason) { fail(reason); }
    });
    assets.querySelector("[data-fw-export]")!.addEventListener("click", () => {
      const entry = current(); if (!entry) return;
      try { const bytes = getAsset(entry); const frames = FOLLOWER_DIRECTIONS.flatMap(direction => [0, 10].map(tick => followerPreview(bytes, entry.animationProfile, direction, tick)));
        pngDownload(followerSheetFromFrames(frames), `follower-${followerKey(entry.key).replaceAll(":", "-")}.png`);
      } catch (reason) { fail(reason); }
    });
    assets.querySelector("[data-fw-pack-export]")!.addEventListener("click", () => {
      try {
        const files: Record<string, Uint8Array> = {};
        const entries = workspace!.registry.entries.map(entry => {
          const path = `assets/${followerKey(entry.key).replaceAll(":", "-")}.btx`; files[path] = getAsset(entry);
          return { key: entry.key, path, profile: entry.animationProfile, source: entry.source, placeholder: entry.placeholder, placeholderReason: entry.placeholderReason };
        });
        files["manifest.json"] = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, entries }, null, 2));
        downloadBytes(zipSync(files, { level: 6 }), "following-assets.zip");
      } catch (reason) { fail(reason); }
    });
    const zip = assets.querySelector<HTMLInputElement>("[data-fw-zip]")!;
    assets.querySelector("[data-fw-pack-import]")!.addEventListener("click", () => { zip.value = ""; zip.click(); });
    zip.addEventListener("change", async () => {
      const file = zip.files?.[0]; if (!file || !rom) return;
      try {
        if (file.size > 64 * 1024 * 1024) throw new Error("Asset pack exceeds 64 MiB.");
        let total = 0;
        const files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: entry => { total += entry.originalSize;
          if (entry.originalSize > 2 * 1024 * 1024 || total > 128 * 1024 * 1024) throw new Error("Asset pack expands beyond supported limits."); return true; } });
        if (!files["manifest.json"]) throw new Error("Asset pack needs manifest.json.");
        const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
        if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries) || manifest.entries.length > 6144) throw new Error("Unsupported asset pack manifest.");
        const updates = manifest.entries.map((e: { key: FollowerAssetEntry["key"]; path: string; profile: FollowerAssetEntry["animationProfile"]; source?: FollowerAssetEntry["source"]; placeholder: boolean; placeholderReason?: string }) => {
          if (typeof e.path !== "string" || !files[e.path]) throw new Error("Asset pack resource is missing.");
          return { key: e.key, bytes: files[e.path], profile: e.profile, source: e.source ?? "png", label: file.name, placeholder: e.placeholder, placeholderReason: e.placeholderReason };
        });
        workspace = replaceFollowerAssets(project, rom, updates); error.textContent = ""; onDirty(); renderAssets(); await refreshRuntime(await readFollowerAlphaInstall(project, rom));
      } catch (reason) { fail(reason); }
    });
  }
  function loadRuntimePreviewWorkspace(): void {
    if (!rom || workspace) { previewWorkspace = workspace; return; }
    try {
      const fileId = rom.filenames.idOf(FOLLOWER_RUNTIME_REGISTRY_PATH);
      const bytes = fileId === undefined
        ? project.fileSystem?.additions?.[FOLLOWER_RUNTIME_REGISTRY_PATH]
        : getRomFileBytes(project, rom, fileId);
      previewWorkspace = bytes ? { schemaVersion: 1, targetSha256: "", registry: decodeFollowerRegistry(bytes), imports: {} } : undefined;
    } catch {
      previewWorkspace = undefined;
    }
  }
  async function refreshRuntime(state: FollowerAlphaInstall | undefined): Promise<boolean> {
    if (!state) return false;
    landHelp.hidden = !state.landRiderSha256 || !!state.removed;
    const runtimeVersion = await followerRuntimeVersion(project, rom);
    enabled = state.enabled;
    const importedArtwork = state.profile === "stock" && !!rom && followerArtworkPending(project, rom);
    install.disabled = state.version === runtimeVersion && !state.removed && !importedArtwork;
    install.textContent = state.removed ? "Reinstall follower alpha" : importedArtwork && state.version === runtimeVersion ? "Apply follower artwork" : install.disabled ? `Installed ${state.version}` : `Update ${state.version} to ${runtimeVersion}`;
    toggle.hidden = !!state.removed; remove.hidden = !!state.removed; toggle.textContent = enabled ? "Disable following" : "Enable following";
    loadRuntimePreviewWorkspace();
    await renderDialogues(); await renderItems();
    return true;
  }
  install.addEventListener("click", async () => {
    install.disabled = true;
    try { const state = await installFollowerAlpha(project, rom); onDirty(); stock = undefined; await refreshRuntime(state); }
    catch (reason) { fail(reason); install.disabled = false; }
  });
  remove.addEventListener("click", async () => {
    remove.disabled = true;
    try { await removeFollowerAlpha(project, rom); onDirty(); await refreshRuntime(await readFollowerAlphaInstall(project, rom)); }
    catch (reason) { fail(reason); }
    finally { remove.disabled = false; }
  });
  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    try { const state = await setFollowerAlphaEnabled(project, !enabled, rom); onDirty(); await refreshRuntime(state); }
    catch (reason) { fail(reason); }
    finally { toggle.disabled = false; }
  });
  prepare.addEventListener("click", async () => {
    prepare.disabled = true;
    try {
      workspace = await prepareFollowerWorkspace(project, rom); previewWorkspace = workspace; rom ??= await followerRom(project);
      onDirty(); renderAssets(); await renderDialogues(); await renderItems();
    }
    catch (reason) { fail(reason); prepare.disabled = false; }
  });
  void (async () => {
    try {
      rom = await followerRom(project); workspace = readFollowerWorkspace(project, rom);
      loadRuntimePreviewWorkspace();
      if (!panel.isConnected) return;
      if (workspace) renderAssets();
      const report = await checkFollowerCompatibility(project, rom);
      if (!panel.isConnected) return;
      prepare.disabled = !!workspace || !report.compatible;
      if (!await refreshRuntime(report.installation)) { install.disabled = !report.compatible; await renderDialogues(); await renderItems(); }
    } catch (reason) { fail(reason); }
  })();
}
