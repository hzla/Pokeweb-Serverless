import {
  defaultRandomizerSettings,
  randomizeProject,
  randomizerProjectCounts,
  type RandomizerResult,
  type RandomizerSettings,
} from "../pokeweb/randomizerModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

const SETTINGS_KEY = "pokeweb-gen5-randomizer-settings-v1";

export function renderRandomizerEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  const settings = loadSettings();
  const counts = randomizerProjectCounts(project);
  const gen5 = project.session.generation !== "gen4";
  const hasEggMoves = Boolean(project.narcs.egg_moves);
  const hasTrainers = Boolean(project.narcs.trdata && project.narcs.trpok);
  const hasEncounters = Boolean(project.narcs.encounters);
  const hasGrottos = Boolean(project.narcs.grottos);
  const hasMarts = Boolean(project.narcs.marts);
  const hasStarterScripts = Boolean(project.narcs.scripts && counts.starters === 3);
  const hasGiftScripts = Boolean(project.narcs.scripts && counts.gifts + counts.giftEggs > 0);
  const hasInGameTrades = Boolean(project.narcs.ingame_trades && counts.inGameTrades > 0);

  root.innerHTML = `
    <div class="randomizer-page">
      <aside class="randomizer-sidebar">
        <div class="randomizer-kicker">Gen 5 tools</div>
        <h1>Randomizer</h1>
        <p>Seeded, data-driven randomization using the records currently loaded from this ROM.</p>

        <label class="randomizer-control -seed">
          <span>Seed</span>
          <div class="randomizer-seed-row">
            <input id="randomizer-seed" name="seed" type="text" value="${escapeHtml(settings.seed)}" autocomplete="off" spellcheck="false" />
            <button class="btn -default" id="randomizer-new-seed" type="button" title="Generate a new seed">New</button>
          </div>
        </label>

        <div class="randomizer-data-summary" aria-label="Loaded randomizer data">
          ${dataCount("Pokémon", counts.pokemon, Boolean(project.narcs.personal))}
          ${dataCount("Moves", counts.moves, Boolean(project.narcs.moves))}
          ${dataCount("Starters", counts.starters, hasStarterScripts)}
          ${dataCount("Gifts / eggs", counts.gifts + counts.giftEggs, hasGiftScripts)}
          ${dataCount("In-game trades", counts.inGameTrades, hasInGameTrades)}
          ${dataCount("Trainers", counts.trainers, hasTrainers)}
          ${dataCount("Encounters", counts.encounters, hasEncounters)}
          ${dataCount("Grottoes", counts.grottos, hasGrottos)}
          ${dataCount("BW2 shops", counts.shops, hasMarts)}
        </div>

        <div class="randomizer-sidebar-actions">
          <button class="btn -default randomizer-run" id="run-randomizer" type="submit" form="randomizer-settings" ${gen5 ? "" : "disabled"}>Randomize Project</button>
          <button class="randomizer-reset" id="reset-randomizer-settings" type="button">Reset settings</button>
        </div>
        <p class="randomizer-direct-note">Changes are applied directly to the loaded project. Export the ROM when you are ready.</p>
        <div class="randomizer-status" id="randomizer-status" role="status" aria-live="polite"></div>
      </aside>

      <form class="randomizer-settings" id="randomizer-settings">
        ${gen5 ? "" : `<div class="randomizer-alert -error">This first randomizer pass supports Black, White, Black 2, and White 2 projects only.</div>`}
        ${renderPokemonData(settings)}
        ${renderEvolutions(settings, Boolean(project.narcs.evolutions))}
        ${renderMovesets(settings, Boolean(project.narcs.learnsets && project.narcs.moves), hasEggMoves)}
        ${renderMoveData(settings, Boolean(project.narcs.moves))}
        ${renderTmCompatibility(settings, Boolean(project.narcs.personal && project.narcs.moves))}
        ${renderStarters(settings, hasStarterScripts)}
        ${renderGiftPokemon(settings, hasGiftScripts, counts.gifts, counts.giftEggs)}
        ${renderInGameTrades(settings, hasInGameTrades)}
        ${renderTrainers(settings, hasTrainers)}
        ${renderWild(settings, hasEncounters)}
        ${renderGrottos(settings, hasGrottos)}
        ${renderShops(settings, hasMarts && project.session.baseRom === "BW2")}
      </form>
    </div>
  `;

  const form = root.querySelector<HTMLFormElement>("#randomizer-settings");
  const seedInput = root.querySelector<HTMLInputElement>("#randomizer-seed");
  if (!form || !seedInput) return;

  const persist = (): void => saveSettings(readSettings(form, seedInput));
  form.addEventListener("change", persist);
  seedInput.addEventListener("change", persist);

  root.querySelector<HTMLButtonElement>("#randomizer-new-seed")?.addEventListener("click", () => {
    seedInput.value = generateSeed();
    persist();
  });

  root.querySelector<HTMLButtonElement>("#reset-randomizer-settings")?.addEventListener("click", () => {
    window.localStorage.removeItem(SETTINGS_KEY);
    renderRandomizerEditor(project, root, onDirty);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = readSettings(form, seedInput);
    saveSettings(next);
    const enabledGroups = selectedGroupNames(next);
    if (enabledGroups.length === 0) {
      setStatus(root, "Choose at least one randomization setting first.", "warn");
      return;
    }
    if (!window.confirm(`Randomize ${enabledGroups.join(", ")} with seed “${next.seed || "pokeweb"}”? Changes apply immediately.`)) return;

    const button = root.querySelector<HTMLButtonElement>("#run-randomizer");
    if (button) {
      button.disabled = true;
      button.textContent = "Randomizing…";
    }
    setStatus(root, "Applying seeded randomization…");
    try {
      const result = randomizeProject(project, next);
      onDirty?.();
      setStatus(root, resultText(result), "ok");
    } catch (error) {
      setStatus(root, error instanceof Error ? error.message : String(error), "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Randomize Project";
      }
    }
  });
}

function renderPokemonData(settings: RandomizerSettings): string {
  return section(
    "Pokémon data",
    "Base stats, types, abilities, growth curves, and wild held items. Every valid personal record in the loaded archive is used.",
    `
      <div class="randomizer-grid">
        ${selectControl("Base stats", "pokemon.baseStats", settings.pokemon.baseStats, [
          ["unchanged", "Unchanged"], ["shuffle", "Shuffle stats"], ["random", "Random (preserve BST)"],
          ["random-bst", "Completely random"], ["buff-nerf", "Random buff / nerf"],
        ])}
        ${numberControl("Max BST variance", "pokemon.bstVariancePercent", settings.pokemon.bstVariancePercent, 0, 100, "%", "Used by Random buff / nerf.")}
        ${selectControl("Pokémon types", "pokemon.types", settings.pokemon.types, [
          ["unchanged", "Unchanged"], ["random-follow-evolutions", "Random — follow evolutions"], ["completely-random", "Completely random"],
        ])}
        ${selectControl("Abilities", "pokemon.abilities", settings.pokemon.abilities, [["unchanged", "Unchanged"], ["random", "Random"]])}
        ${selectControl("EXP curve", "pokemon.expCurve", settings.pokemon.expCurve, [
          ["unchanged", "Unchanged"], ["medium-fast", "Medium Fast"], ["erratic", "Erratic"], ["fluctuating", "Fluctuating"],
          ["medium-slow", "Medium Slow"], ["fast", "Fast"], ["slow", "Slow"],
        ])}
        ${selectControl("Held items", "pokemon.heldItems", settings.pokemon.heldItems, [["unchanged", "Unchanged"], ["random", "Random"]])}
      </div>
      <div class="randomizer-options">
        ${checkControl("Stats follow evolutions", "pokemon.statsFollowEvolutions", settings.pokemon.statsFollowEvolutions)}
        ${checkControl("Dual types only", "pokemon.dualTypeOnly", settings.pokemon.dualTypeOnly)}
        ${checkControl("Abilities follow evolutions", "pokemon.abilitiesFollowEvolutions", settings.pokemon.abilitiesFollowEvolutions)}
        ${checkControl("Allow Wonder Guard", "pokemon.allowWonderGuard", settings.pokemon.allowWonderGuard)}
        ${checkControl("Ban negative abilities", "pokemon.banNegativeAbilities", settings.pokemon.banNegativeAbilities)}
        ${checkControl("Ensure two abilities", "pokemon.ensureTwoAbilities", settings.pokemon.ensureTwoAbilities)}
      </div>
    `,
    true,
  );
}

function renderEvolutions(settings: RandomizerSettings, enabled: boolean): string {
  return section(
    "Evolutions",
    "Randomize existing evolution targets or give every eligible personal record a level-one evolution.",
    `
      <div class="randomizer-grid">
        ${selectControl("Evolution mode", "evolutions.mode", settings.evolutions.mode, [["unchanged", "Unchanged"], ["random", "Random"], ["random-every-level", "Random every level"]])}
        ${numberControl("Make easier at level", "evolutions.easierLevel", settings.evolutions.easierLevel ?? 0, 0, 100, "", "0 leaves levels unchanged.")}
      </div>
      <div class="randomizer-options">
        ${checkControl("Similar strength", "evolutions.similarStrength", settings.evolutions.similarStrength)}
        ${checkControl("Same typing", "evolutions.sameType", settings.evolutions.sameType)}
        ${checkControl("Limit to three stages", "evolutions.maxThreeStages", settings.evolutions.maxThreeStages)}
        ${checkControl("Force change", "evolutions.forceChange", settings.evolutions.forceChange)}
        ${checkControl("Force BST growth", "evolutions.forceGrowth", settings.evolutions.forceGrowth)}
        ${checkControl("No convergence", "evolutions.noConvergence", settings.evolutions.noConvergence)}
        ${checkControl("Change impossible evolutions", "evolutions.changeImpossible", settings.evolutions.changeImpossible)}
        ${checkControl("Remove time-based evolutions", "evolutions.removeTimeBased", settings.evolutions.removeTimeBased)}
      </div>
    `,
    enabled,
    "Evolution data is not loaded.",
  );
}

function renderMovesets(settings: RandomizerSettings, enabled: boolean, eggMovesEnabled: boolean): string {
  return section(
    "Movesets & egg moves",
    "Uses the current move archive as the pool and preserves each species’ existing learn levels and list sizes.",
    `
      <div class="randomizer-grid">
        ${selectControl("Moveset mode", "movesets.mode", settings.movesets.mode, [
          ["unchanged", "Unchanged"], ["prefer-same-type", "Random — prefer same type"], ["completely-random", "Completely random"], ["metronome-only", "Metronome only"],
        ])}
        ${numberControl("Guaranteed starting moves", "movesets.guaranteedStartingMoves", settings.movesets.guaranteedStartingMoves, 0, 4)}
        ${numberControl("Good damaging moves", "movesets.goodDamagingPercent", settings.movesets.goodDamagingPercent, 0, 100, "%")}
      </div>
      <div class="randomizer-options">
        ${checkControl("Randomize egg moves", "movesets.randomizeEggMoves", settings.movesets.randomizeEggMoves, !eggMovesEnabled, eggMovesEnabled ? "" : "Egg move data is not loaded")}
        ${checkControl("Reorder damaging moves", "movesets.reorderDamagingMoves", settings.movesets.reorderDamagingMoves)}
        ${checkControl("Force good damaging moves", "movesets.forceGoodDamaging", settings.movesets.forceGoodDamaging)}
        ${checkControl("Block broken moves", "movesets.blockBrokenMoves", settings.movesets.blockBrokenMoves)}
        ${checkControl("Evolution move for all", "movesets.evolutionMoveForAll", settings.movesets.evolutionMoveForAll)}
      </div>
    `,
    enabled,
    "Learnset or move data is not loaded.",
  );
}

function renderMoveData(settings: RandomizerSettings, enabled: boolean): string {
  return section(
    "Move data",
    "Randomizes attributes on every usable move record, including appended moves in expanded hacks.",
    `<div class="randomizer-options -large">
      ${checkControl("Power", "moveData.powers", settings.moveData.powers)}
      ${checkControl("Accuracy", "moveData.accuracies", settings.moveData.accuracies)}
      ${checkControl("PP", "moveData.pps", settings.moveData.pps)}
      ${checkControl("Type", "moveData.types", settings.moveData.types)}
      ${checkControl("Category", "moveData.categories", settings.moveData.categories)}
    </div>`,
    enabled,
    "Move data is not loaded.",
  );
}

function renderTmCompatibility(settings: RandomizerSettings, enabled: boolean): string {
  return section(
    "TM / HM compatibility",
    "Randomizes compatibility bits in personal data while leaving the ROM’s current TM move list intact.",
    `
      <div class="randomizer-grid">
        ${selectControl("Compatibility", "tmCompatibility.mode", settings.tmCompatibility.mode, [
          ["unchanged", "Unchanged"], ["prefer-type", "Random — prefer same type"], ["completely-random", "Completely random"], ["full", "Full compatibility"],
        ])}
      </div>
      <div class="randomizer-options">
        ${checkControl("Full HM compatibility", "tmCompatibility.fullHmCompatibility", settings.tmCompatibility.fullHmCompatibility)}
        ${checkControl("Level-up move sanity", "tmCompatibility.levelUpMoveSanity", settings.tmCompatibility.levelUpMoveSanity)}
        ${checkControl("Follow evolutions", "tmCompatibility.followEvolutions", settings.tmCompatibility.followEvolutions)}
      </div>
    `,
    enabled,
    "Personal or move data is not loaded.",
  );
}

function renderStarters(settings: RandomizerSettings, enabled: boolean): string {
  return section(
    "Starter Pokémon",
    "Finds the level-five starter gift pattern in the loaded script archive, so relocated scripts do not need retail file offsets.",
    `
      <div class="randomizer-grid">
        ${selectControl("Starter mode", "starters.mode", settings.starters.mode, [
          ["unchanged", "Unchanged"], ["random", "Completely random"], ["random-basic", "Random basic Pokémon"],
          ["random-two-evolutions", "Random with two evolutions"],
        ])}
      </div>
      <div class="randomizer-options">
        ${checkControl("Unique starters", "starters.unique", settings.starters.unique)}
        ${checkControl("Block legendaries", "starters.blockLegendaries", settings.starters.blockLegendaries)}
      </div>
    `,
    enabled,
    "A semantic starter pattern was not found in the loaded scripts.",
  );
}

function renderGiftPokemon(settings: RandomizerSettings, enabled: boolean, gifts: number, eggs: number): string {
  return section(
    "Gift Pokémon & eggs",
    `Randomizes semantic PokePartyAdd commands across every loaded script file (${gifts} gifts and ${eggs} eggs found), excluding the starter selection script.`,
    `
      <div class="randomizer-grid">
        ${selectControl("Gift mode", "gifts.mode", settings.gifts.mode, [
          ["unchanged", "Unchanged"], ["random", "Completely random"], ["similar-strength", "Random — similar strength"],
        ])}
      </div>
      <div class="randomizer-options">
        ${checkControl("Gift Pokémon", "gifts.randomizeGiftPokemon", settings.gifts.randomizeGiftPokemon)}
        ${checkControl("Gift eggs", "gifts.randomizeEggs", settings.gifts.randomizeEggs)}
        ${checkControl("Block legendaries", "gifts.blockLegendaries", settings.gifts.blockLegendaries)}
      </div>
    `,
    enabled,
    "No semantic gift Pokémon or egg commands were found in the loaded scripts.",
  );
}

function renderInGameTrades(settings: RandomizerSettings, enabled: boolean): string {
  return section(
    "In-game trades",
    "Uses every structurally valid trade record in the loaded archive and synchronizes matching script command pairs without retail script offsets.",
    `
      <div class="randomizer-grid">
        ${selectControl("Trade mode", "inGameTrades.mode", settings.inGameTrades.mode, [
          ["unchanged", "Unchanged"], ["random-given", "Randomize given Pokémon"],
          ["random-given-requested", "Randomize given & requested"],
        ])}
      </div>
      <div class="randomizer-options">
        ${checkControl("Block legendaries", "inGameTrades.blockLegendaries", settings.inGameTrades.blockLegendaries)}
        ${checkControl("Random IVs", "inGameTrades.randomizeIvs", settings.inGameTrades.randomizeIvs)}
        ${checkControl("Random held items", "inGameTrades.randomizeHeldItems", settings.inGameTrades.randomizeHeldItems)}
      </div>
    `,
    enabled,
    "In-game trade data is not loaded or contains no recognized records.",
  );
}

function renderTrainers(settings: RandomizerSettings, enabled: boolean): string {
  return section(
    "Trainer Pokémon",
    "Randomizes existing party slots without relying on retail trainer IDs or changing party record sizes.",
    `
      <div class="randomizer-grid">
        ${selectControl("Trainer mode", "trainers.mode", settings.trainers.mode, [
          ["unchanged", "Unchanged"], ["random", "Random"], ["distributed", "Distributed"], ["type-themed", "Type themed"], ["keep-themed", "Keep existing theme"],
        ])}
        ${numberControl("Level modifier", "trainers.levelModifierPercent", settings.trainers.levelModifierPercent, -100, 155, "%")}
      </div>
      <div class="randomizer-options">
        ${checkControl("Similar strength", "trainers.similarStrength", settings.trainers.similarStrength)}
        ${checkControl("Avoid duplicates", "trainers.avoidDuplicates", settings.trainers.avoidDuplicates)}
        ${checkControl("Block legendaries", "trainers.blockLegendaries", settings.trainers.blockLegendaries)}
        ${checkControl("Evolve at appropriate levels", "trainers.evolvePokemon", settings.trainers.evolvePokemon)}
        ${checkControl("Better movesets", "trainers.betterMovesets", settings.trainers.betterMovesets)}
        ${checkControl("Random held items", "trainers.randomHeldItems", settings.trainers.randomHeldItems)}
      </div>
    `,
    enabled,
    "Trainer data is not loaded.",
  );
}

function renderWild(settings: RandomizerSettings, enabled: boolean): string {
  return section(
    "Wild encounters",
    "Randomizes species in the existing encounter slots and preserves each archive’s discovered record count.",
    `
      <div class="randomizer-grid">
        ${selectControl("Replacement scope", "wild.scope", settings.wild.scope, [
          ["unchanged", "Unchanged"], ["slot", "Each slot"], ["encounter", "Per encounter file"], ["game", "Whole-game mapping"],
        ])}
        ${numberControl("Level modifier", "wild.levelModifierPercent", settings.wild.levelModifierPercent, -100, 155, "%")}
        ${numberControl("Minimum catch rate", "wild.minimumCatchRate", settings.wild.minimumCatchRate, 0, 255, "", "0 leaves catch rates unchanged.")}
      </div>
      <div class="randomizer-options">
        ${checkControl("Similar strength", "wild.similarStrength", settings.wild.similarStrength)}
        ${checkControl("Catch ’em all", "wild.catchEmAll", settings.wild.catchEmAll)}
        ${checkControl("Block legendaries", "wild.blockLegendaries", settings.wild.blockLegendaries)}
        ${checkControl("Keep primary type", "wild.keepPrimaryType", settings.wild.keepPrimaryType)}
        ${checkControl("Use seasonal encounters", "wild.useTimeBasedEncounters", settings.wild.useTimeBasedEncounters)}
      </div>
    `,
    enabled,
    "Encounter data is not loaded.",
  );
}

function renderGrottos(settings: RandomizerSettings, enabled: boolean): string {
  return section(
    "BW2 hidden grottoes",
    "Randomizes the Pokémon and item slots already present in each hidden-grotto record.",
    `
      <div class="randomizer-grid">
        ${numberControl("Level modifier", "grottos.levelModifierPercent", settings.grottos.levelModifierPercent, -100, 155, "%")}
      </div>
      <div class="randomizer-options">
        ${checkControl("Randomize Pokémon", "grottos.randomizePokemon", settings.grottos.randomizePokemon)}
        ${checkControl("Randomize items", "grottos.randomizeItems", settings.grottos.randomizeItems)}
      </div>
    `,
    enabled,
    "Hidden grotto data is not loaded or this is a BW project.",
  );
}

function renderShops(settings: RandomizerSettings, enabled: boolean): string {
  return section(
    "BW2 shops",
    "Shuffles or replaces existing inventory slots. Guarantee options place matching items in the first shop.",
    `
      <div class="randomizer-grid">
        ${selectControl("Shop inventory", "shops.mode", settings.shops.mode, [["unchanged", "Unchanged"], ["shuffle", "Shuffle existing items"], ["random", "Random"]])}
      </div>
      <div class="randomizer-options">
        ${checkControl("Ban bad items", "shops.banBadItems", settings.shops.banBadItems)}
        ${checkControl("Ban regular shop items", "shops.banRegularShopItems", settings.shops.banRegularShopItems)}
        ${checkControl("Ban overpowered items", "shops.banOverpoweredItems", settings.shops.banOverpoweredItems)}
        ${checkControl("Guarantee evolution items", "shops.guaranteeEvolutionItems", settings.shops.guaranteeEvolutionItems)}
        ${checkControl("Guarantee X items", "shops.guaranteeXItems", settings.shops.guaranteeXItems)}
        ${checkControl("Add cheap Rare Candy", "shops.addCheapRareCandy", settings.shops.addCheapRareCandy)}
      </div>
    `,
    enabled,
    "BW2 mart data is not loaded.",
  );
}

function section(title: string, description: string, body: string, enabled: boolean, missing = ""): string {
  return `
    <fieldset class="randomizer-card ${enabled ? "" : "-disabled"}" ${enabled ? "" : "disabled"}>
      <legend>${escapeHtml(title)}</legend>
      <p>${escapeHtml(description)}</p>
      ${enabled ? "" : `<div class="randomizer-unavailable">${escapeHtml(missing)}</div>`}
      ${body}
    </fieldset>
  `;
}

function selectControl(label: string, name: string, value: string, options: Array<[string, string]>): string {
  return `<label class="randomizer-control"><span>${escapeHtml(label)}</span><select name="${name}">${options.map(([option, text]) => `<option value="${option}" ${option === value ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></label>`;
}

function numberControl(label: string, name: string, value: number, min: number, max: number, suffix = "", help = ""): string {
  return `<label class="randomizer-control"><span>${escapeHtml(label)}</span><div class="randomizer-number"><input name="${name}" type="number" min="${min}" max="${max}" value="${value}" />${suffix ? `<em>${escapeHtml(suffix)}</em>` : ""}</div>${help ? `<small>${escapeHtml(help)}</small>` : ""}</label>`;
}

function checkControl(label: string, name: string, checked: boolean, disabled = false, title = ""): string {
  return `<label class="randomizer-check" ${title ? `title="${escapeHtml(title)}"` : ""}><input name="${name}" type="checkbox" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} /><span>${escapeHtml(label)}</span></label>`;
}

function dataCount(label: string, count: number, loaded: boolean): string {
  return `<div><span>${escapeHtml(label)}</span><strong class="${loaded ? "" : "-missing"}">${loaded ? count.toLocaleString() : "Not loaded"}</strong></div>`;
}

function readSettings(form: HTMLFormElement, seedInput: HTMLInputElement): RandomizerSettings {
  const data = new FormData(form);
  const defaults = defaultRandomizerSettings(seedInput.value.trim() || "pokeweb");
  const text = (name: string, fallback: string): string => String(data.get(name) ?? fallback);
  const number = (name: string, fallback: number, min: number, max: number): number => clamp(Number(data.get(name) ?? fallback), min, max);
  const checked = (name: string): boolean => data.get(name) === "on";
  const easier = number("evolutions.easierLevel", 0, 0, 100);
  return {
    seed: seedInput.value.trim() || "pokeweb",
    pokemon: {
      baseStats: text("pokemon.baseStats", defaults.pokemon.baseStats) as RandomizerSettings["pokemon"]["baseStats"],
      bstVariancePercent: number("pokemon.bstVariancePercent", defaults.pokemon.bstVariancePercent, 0, 100),
      statsFollowEvolutions: checked("pokemon.statsFollowEvolutions"),
      types: text("pokemon.types", defaults.pokemon.types) as RandomizerSettings["pokemon"]["types"],
      dualTypeOnly: checked("pokemon.dualTypeOnly"),
      abilities: text("pokemon.abilities", defaults.pokemon.abilities) as RandomizerSettings["pokemon"]["abilities"],
      abilitiesFollowEvolutions: checked("pokemon.abilitiesFollowEvolutions"),
      allowWonderGuard: checked("pokemon.allowWonderGuard"),
      banNegativeAbilities: checked("pokemon.banNegativeAbilities"),
      ensureTwoAbilities: checked("pokemon.ensureTwoAbilities"),
      expCurve: text("pokemon.expCurve", defaults.pokemon.expCurve) as RandomizerSettings["pokemon"]["expCurve"],
      heldItems: text("pokemon.heldItems", defaults.pokemon.heldItems) as RandomizerSettings["pokemon"]["heldItems"],
    },
    evolutions: {
      mode: text("evolutions.mode", defaults.evolutions.mode) as RandomizerSettings["evolutions"]["mode"],
      similarStrength: checked("evolutions.similarStrength"), sameType: checked("evolutions.sameType"),
      maxThreeStages: checked("evolutions.maxThreeStages"), forceChange: checked("evolutions.forceChange"),
      forceGrowth: checked("evolutions.forceGrowth"), noConvergence: checked("evolutions.noConvergence"),
      changeImpossible: checked("evolutions.changeImpossible"), easierLevel: easier > 0 ? easier : null,
      removeTimeBased: checked("evolutions.removeTimeBased"),
    },
    movesets: {
      mode: text("movesets.mode", defaults.movesets.mode) as RandomizerSettings["movesets"]["mode"],
      randomizeEggMoves: checked("movesets.randomizeEggMoves"),
      guaranteedStartingMoves: number("movesets.guaranteedStartingMoves", 0, 0, 4),
      reorderDamagingMoves: checked("movesets.reorderDamagingMoves"), forceGoodDamaging: checked("movesets.forceGoodDamaging"),
      goodDamagingPercent: number("movesets.goodDamagingPercent", 50, 0, 100), blockBrokenMoves: checked("movesets.blockBrokenMoves"),
      evolutionMoveForAll: checked("movesets.evolutionMoveForAll"),
    },
    moveData: {
      powers: checked("moveData.powers"), accuracies: checked("moveData.accuracies"), pps: checked("moveData.pps"),
      types: checked("moveData.types"), categories: checked("moveData.categories"),
    },
    tmCompatibility: {
      mode: text("tmCompatibility.mode", defaults.tmCompatibility.mode) as RandomizerSettings["tmCompatibility"]["mode"],
      fullHmCompatibility: checked("tmCompatibility.fullHmCompatibility"), levelUpMoveSanity: checked("tmCompatibility.levelUpMoveSanity"),
      followEvolutions: checked("tmCompatibility.followEvolutions"),
    },
    starters: {
      mode: text("starters.mode", defaults.starters.mode) as RandomizerSettings["starters"]["mode"],
      unique: checked("starters.unique"), blockLegendaries: checked("starters.blockLegendaries"),
    },
    gifts: {
      mode: text("gifts.mode", defaults.gifts.mode) as RandomizerSettings["gifts"]["mode"],
      randomizeGiftPokemon: checked("gifts.randomizeGiftPokemon"), randomizeEggs: checked("gifts.randomizeEggs"),
      blockLegendaries: checked("gifts.blockLegendaries"),
    },
    inGameTrades: {
      mode: text("inGameTrades.mode", defaults.inGameTrades.mode) as RandomizerSettings["inGameTrades"]["mode"],
      blockLegendaries: checked("inGameTrades.blockLegendaries"), randomizeIvs: checked("inGameTrades.randomizeIvs"),
      randomizeHeldItems: checked("inGameTrades.randomizeHeldItems"),
    },
    trainers: {
      mode: text("trainers.mode", defaults.trainers.mode) as RandomizerSettings["trainers"]["mode"],
      similarStrength: checked("trainers.similarStrength"), avoidDuplicates: checked("trainers.avoidDuplicates"),
      blockLegendaries: checked("trainers.blockLegendaries"), evolvePokemon: checked("trainers.evolvePokemon"),
      levelModifierPercent: number("trainers.levelModifierPercent", 0, -100, 155), betterMovesets: checked("trainers.betterMovesets"),
      randomHeldItems: checked("trainers.randomHeldItems"),
    },
    wild: {
      scope: text("wild.scope", defaults.wild.scope) as RandomizerSettings["wild"]["scope"],
      similarStrength: checked("wild.similarStrength"), catchEmAll: checked("wild.catchEmAll"),
      blockLegendaries: checked("wild.blockLegendaries"), keepPrimaryType: checked("wild.keepPrimaryType"),
      useTimeBasedEncounters: checked("wild.useTimeBasedEncounters"), levelModifierPercent: number("wild.levelModifierPercent", 0, -100, 155),
      minimumCatchRate: number("wild.minimumCatchRate", 0, 0, 255),
    },
    grottos: {
      randomizePokemon: checked("grottos.randomizePokemon"), randomizeItems: checked("grottos.randomizeItems"),
      levelModifierPercent: number("grottos.levelModifierPercent", 0, -100, 155),
    },
    shops: {
      mode: text("shops.mode", defaults.shops.mode) as RandomizerSettings["shops"]["mode"],
      banBadItems: checked("shops.banBadItems"), banRegularShopItems: checked("shops.banRegularShopItems"),
      banOverpoweredItems: checked("shops.banOverpoweredItems"), guaranteeEvolutionItems: checked("shops.guaranteeEvolutionItems"),
      guaranteeXItems: checked("shops.guaranteeXItems"), addCheapRareCandy: checked("shops.addCheapRareCandy"),
    },
  };
}

function loadSettings(): RandomizerSettings {
  const defaults = defaultRandomizerSettings();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<RandomizerSettings> | null;
    if (!parsed) return defaults;
    return {
      ...defaults,
      ...parsed,
      pokemon: { ...defaults.pokemon, ...parsed.pokemon }, evolutions: { ...defaults.evolutions, ...parsed.evolutions },
      movesets: { ...defaults.movesets, ...parsed.movesets }, moveData: { ...defaults.moveData, ...parsed.moveData },
      tmCompatibility: { ...defaults.tmCompatibility, ...parsed.tmCompatibility }, starters: { ...defaults.starters, ...parsed.starters },
      gifts: { ...defaults.gifts, ...parsed.gifts }, inGameTrades: { ...defaults.inGameTrades, ...parsed.inGameTrades }, trainers: { ...defaults.trainers, ...parsed.trainers },
      wild: { ...defaults.wild, ...parsed.wild }, grottos: { ...defaults.grottos, ...parsed.grottos }, shops: { ...defaults.shops, ...parsed.shops },
    };
  } catch {
    return defaults;
  }
}

function saveSettings(settings: RandomizerSettings): void {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function selectedGroupNames(settings: RandomizerSettings): string[] {
  const groups: string[] = [];
  if (settings.pokemon.baseStats !== "unchanged" || settings.pokemon.types !== "unchanged" || settings.pokemon.abilities !== "unchanged" || settings.pokemon.expCurve !== "unchanged" || settings.pokemon.heldItems !== "unchanged") groups.push("Pokémon data");
  if (settings.evolutions.mode !== "unchanged" || settings.evolutions.changeImpossible || settings.evolutions.easierLevel !== null || settings.evolutions.removeTimeBased) groups.push("evolutions");
  if (settings.movesets.mode !== "unchanged" || settings.movesets.reorderDamagingMoves || settings.movesets.guaranteedStartingMoves > 0 || settings.movesets.evolutionMoveForAll) groups.push("movesets");
  if (Object.values(settings.moveData).some(Boolean)) groups.push("move data");
  if (settings.tmCompatibility.mode !== "unchanged" || settings.tmCompatibility.fullHmCompatibility || settings.tmCompatibility.levelUpMoveSanity || settings.tmCompatibility.followEvolutions) groups.push("TM/HM compatibility");
  if (settings.starters.mode !== "unchanged") groups.push("starters");
  if (settings.gifts.mode !== "unchanged" && (settings.gifts.randomizeGiftPokemon || settings.gifts.randomizeEggs)) groups.push("gift Pokémon / eggs");
  if (settings.inGameTrades.mode !== "unchanged") groups.push("in-game trades");
  if (settings.trainers.mode !== "unchanged" || settings.trainers.levelModifierPercent !== 0 || settings.trainers.evolvePokemon || settings.trainers.betterMovesets || settings.trainers.randomHeldItems) groups.push("trainers");
  if (settings.wild.scope !== "unchanged" || settings.wild.levelModifierPercent !== 0 || settings.wild.minimumCatchRate > 0) groups.push("wild encounters");
  if (settings.grottos.randomizePokemon || settings.grottos.randomizeItems || settings.grottos.levelModifierPercent !== 0) groups.push("grottoes");
  if (settings.shops.mode !== "unchanged" || settings.shops.guaranteeEvolutionItems || settings.shops.guaranteeXItems || settings.shops.addCheapRareCandy) groups.push("shops");
  return groups;
}

function resultText(result: RandomizerResult): string {
  const labels: Record<string, string> = { pokemon: "Pokémon records", evolutions: "evolutions", learnsets: "learnsets", eggMoves: "egg-move lists", moves: "moves", tmCompatibility: "TM/HM records", starters: "starters", gifts: "gift Pokémon", giftEggs: "gift eggs", inGameTrades: "in-game trades", trainers: "trainers", encounters: "encounter files", grottos: "grottoes", shops: "shops" };
  const summary = Object.entries(result.changes).filter(([, count]) => Boolean(count)).map(([key, count]) => `${count} ${labels[key] ?? key}`).join(", ");
  const warnings = result.warnings.length > 0 ? ` ${result.warnings.join(" ")}` : "";
  return `Seed ${result.seed} applied: ${summary || "no records changed"}.${warnings}`;
}

function setStatus(root: HTMLElement, text: string, kind: "ok" | "warn" | "error" | "" = ""): void {
  const status = root.querySelector<HTMLElement>("#randomizer-status");
  if (!status) return;
  status.className = `randomizer-status ${kind ? `-${kind}` : ""}`;
  status.textContent = text;
}

function generateSeed(): string {
  const values = new Uint32Array(2);
  window.crypto.getRandomValues(values);
  return `${values[0]!.toString(36)}-${values[1]!.toString(36)}`;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
