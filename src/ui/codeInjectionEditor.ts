import {renderPmcCapacity,formatPmcKiB} from "./pmcCapacity";
import { attachNaturePaletteInstaller, renderNaturePaletteInstaller } from "./naturePaletteInstaller";
import { naturePalettesSupported } from "../pokeweb/naturePaletteModel";
import {getPmcMemoryEstimate} from "../pokeweb/pmcMemoryModel";
import { typeIconBorderHex, typeIconPreview, DEFAULT_TYPE_ICON_BORDER, DEFAULT_BW1_TYPE_ICON_BORDER } from "../pokeweb/typeIconAppearance";
import { getTrainerFieldConditionsStatus } from "../pokeweb/trainerFieldConditionsModel";
import { frostbiteSnowStatus, installFrostbiteSnowPatch } from "../pokeweb/frostbiteSnowModel";
import { attachTrainerFieldInstaller, renderTrainerFieldInstaller } from "./trainerFieldConditions";
import { getDebugSaveFlagStatus, installDebugSaveFlag, parseDebugSaveFlag } from "../pokeweb/debugSaveFlagModel";
import { renderInlineStatus as renderStatusBadge } from "./inlineStatus";
import { installCodeInjectionPatch, withProjectMutationLock } from "../pokeweb/codeInjectionInstall";
import { getPartyQuickActionsStatus, installPartyQuickActions, disablePartyQuickActions, parsePartyToolbarHideFlag, PARTY_TOOLBAR_SECTIONS } from "../pokeweb/partyQuickActionsModel";
import {
  detectBundledFormEvolutionDll,
  detectBundledDoubleBattleFixDll,
  detectBundledBgmToggleDll,
  detectBundledOverworldWeatherRuntime,
  getPmcInstallStatus,
  getPmcHeapExpansionStatus,
  getFiveBoxPmcStatus,
  setFiveBoxPmcMode,
  expandPmcHeapAllocation,
  getPmcUpdateConfirmationMessage,
  installBundledOverworldWeatherRuntime,
  installBundledBgmToggleDll,
  installBundledPmc,
  listCodeInjectionDlls,
  prepareBw2FormEvolutionCodeInjection,
  stageBundledDoubleBattleFixDll,
  stageCodeInjectionDll,
  type CodeInjectionDllTarget,
} from "../pokeweb/pmcModel";
import {
  canUninstallPwanRuntime,
  getPwanRuntimeStatus,
  installPwanRuntime,
  uninstallPwanRuntime,
} from "../pokeweb/pwanAnimationModel";
import {
  canUninstallTrainerPwanRuntime,
  getTrainerPwanRuntimeStatus,
  installTrainerPwanRuntime,
  uninstallTrainerPwanRuntime,
} from "../pokeweb/trainerPwanAnimationModel";
import { detectTrainerPwanCompatibility } from "../pokeweb/trainerPwanCompatibilityModel";
import {
  canUninstallBattleLog,
  getBattleLogInstallStatus,
  installBattleLog,
  uninstallBattleLog,
} from "../pokeweb/battleLogModel";
import {
  MENU_EVOLUTION_TITLE,
  canUninstallMenuEvolution,
  getMenuEvolutionInstallStatus,
  installMenuEvolution,
  uninstallMenuEvolution,
} from "../pokeweb/menuEvolutionModel";
import {
  getTagBattleStabilizationStatus,
  installTagBattleStabilization,
  uninstallTagBattleStabilization,
} from "../pokeweb/tagBattleStabilizationModel";
import { getRotationBattleAiStatus, stageRotationBattleAi, uninstallRotationBattleAi } from "../pokeweb/rotationBattleAiModel";
import { applyAbilityStorageFix, getAbilityStorageFixStatus } from "../pokeweb/abilityStorageFixModel";
import { getPortaPcStatus, installPortaPc, uninstallPortaPc } from "../pokeweb/portaPcModel";
import { CGEAR_QUICK_ACTIONS_VERSION, getCGearQuickActionsStatus, installCGearQuickActions, disableCGearQuickActions, removeCGearQuickActions } from "../pokeweb/cgearQuickActionsModel";
import { CGEAR_QUICK_ACTIONS_BW1_VERSION } from "../pokeweb/cgearQuickActionsBw1Model";
import { getPokenavStatus, installPokenav, disablePokenav } from "../pokeweb/pokenavModel";
import { getNuzlockeEncountersStatus,installNuzlockeEncounters,disableNuzlockeEncounters } from "../pokeweb/nuzlockeEncountersModel";
import { getLearnsetViewerStatus, installLearnsetViewer, uninstallLearnsetViewer, type LearnsetUpperLayout } from "../pokeweb/learnsetViewerModel";
import { getSummaryStatViewerStatus, installSummaryStatViewer, uninstallSummaryStatViewer, SUMMARY_STAT_VIEWER_VERSION } from "../pokeweb/summaryStatViewerModel";
import { getInfiniteCandyStatus, getInstalledInfiniteCandyItemId, installInfiniteCandy } from "../pokeweb/infiniteCandyModel";
import { getLevelCapsStatus, installLevelCaps } from "../pokeweb/levelCapsModel";
import { getTrainerLevelCapsStatus, installTrainerLevelCaps } from "../pokeweb/trainerLevelCapsModel";
import { getForgettableHmsPmcStatus, stageForgettableHmsPmc } from "../pokeweb/forgettableHmsRuntime";
import { getShinyOddsStatus, SHINY_ODDS_MAX_ROLLS, stageShinyOdds, wildShinyChance } from "../pokeweb/shinyOddsModel";
import { getTrainerCustomizationStatus, installTrainerCustomization } from "../pokeweb/trainerCustomizationModel";
import { applyChallengeModeStatsFix, getChallengeModeStatsStatus } from "../pokeweb/challengeModeStatsModel";
import { getBw2ApFixStatus, setBw2ApFix } from "../pokeweb/bw2ApFixModel";
import { applyEarlyChallengeMode, getEarlyChallengeModeStatus } from "../pokeweb/earlyChallengeModeModel";
import { applyEarlyNationalDex, getEarlyNationalDexStatus } from "../pokeweb/earlyNationalDexModel";
import { getPwtSixPokemonStatus, installPwtSixPokemon } from "../pokeweb/pwtSixPokemonRuntime";
import { getPwtAbilityStatus, installPwtAbilitySelection } from "../pokeweb/pwtAbilityRuntime";
import { getAutorunStatus, stageAutorun, uninstallAutorun } from "../pokeweb/autorunModel";
import { getItemExpansionStatus, isItemExpansionInstalled, stageItemExpansion, uninstallItemExpansion } from "../pokeweb/itemExpansionModel";
import { getTrainingItemsStatus, stageTrainingItems } from "../pokeweb/trainingItemsModel";
import { addFairyTypeSupport, addMoveExpansion, detectFairyTypePatch, detectForgettableHmPatch, makeHmsForgettable, type RomPatchApplyResult } from "../pokeweb/romPatchModel";
import { getCascadePersonalMigrationStatus, migrateCascadePersonalData } from "../pokeweb/cascadeWhitePersonalModel";
import { detectMoveExpansionPatch } from "../pokeweb/moveExpansionPatch";
import moveAnimationCredits from "../assets/data/white2upgradeGen6MoveAnimationsCredits.json";
import { MEGA_CREDITS, canUseMegaEvolutionInstaller, getMegaEvolutionStatus, setMegaEvolutionConfig, stageMegaEvolution, uninstallMegaEvolution, type MegaRoute } from "../pokeweb/megaEvolutionModel";
import { GMAX_MEGAS, MEGA_RING_ITEM, UNIVERSAL_STONES, getMegaContentStatus, installMegaContent, megaSpriteCredits, stageMegaAnimation, stageMegaExtras, stageMegaRing } from "../pokeweb/megaContentModel";
import { REGIONAL_FORMS, getRegionalFormsStatus, installRegionalForms, regionalFamilies } from "../pokeweb/regionalFormsModel";
import { canUseSpeciesExpansionInstaller, getSpeciesExpansionStatus, installSpeciesExpansion, speciesExpansionFamilies } from "../pokeweb/speciesExpansionModel";
import { abilityExpansionRows, canUseAbilityExpansionInstaller, getAbilityExpansionStatus, stageAbilityExpansion } from "../pokeweb/abilityExpansionModel";
import { downloadBytes } from "../pokeweb/fileSystemModel";
import { getIntroSkipStatus, stageIntroSkip, uninstallIntroSkip } from "../pokeweb/introSkipModel";
import { TESTING_PATCHES, getTestingPatchStatus, installTestingPatch, uninstallTestingPatch, type TestingPatchId } from "../pokeweb/testingPatchesModel";
import { getBattleTypeHudStatus, installBattleTypeHud, uninstallBattleTypeHud, getMoveEffectivenessStatus, installMoveEffectiveness, uninstallMoveEffectiveness, DEFAULT_MOVE_HIGHLIGHT_COLORS, moveHighlightRgb555, type MoveHighlightColors, type TypeIconVariant } from "../pokeweb/battleTypeHudModel";
import { getQuickPokeBallStatus, installQuickPokeBall, uninstallQuickPokeBall } from "../pokeweb/quickPokeBallModel";
import { detectAnimStreamsCompatibility } from "../pokeweb/animStreamsModel";
import {
  pwanCompatibilityFailureSummary,
  type PwanCompatibilityCheck,
  type PwanCompatibilityReport,
} from "../pokeweb/pwanCompatibilityModel";
import { loadActiveRomBytes } from "../pokeweb/persistence";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { creditHtml } from "./creditLinks";

/** A card without a badge is ready to install: "Ready" only restated that nothing is installed yet. */
function renderInlineStatus(label: string, options?: Parameters<typeof renderStatusBadge>[1]): string {
  return label === "Ready" ? "" : renderStatusBadge(label, options);
}

const US_GEN5 = "US Black, White, Black 2, and White 2";
const US_BW2 = "US Black 2 and White 2";
const US_GEN5_REV0 = `${US_GEN5} (revision 0)`;
const US_BW2_REV0 = `${US_BW2} (revision 0)`;

function supportedRomsFact(roms: string): string {
  return `<div><span>Supported ROMs</span><strong>${escapeHtml(roms)}</strong></div>`;
}

function renderSupportedRoms(roms: string): string {
  return `<div class="code-injection-facts">${supportedRomsFact(roms)}</div>`;
}

const codeInjectionHydrationProjects = new WeakSet<ProjectState>();
const typeIconSolidPreview = new URL("../assets/codeinjection/type-icons-solid-preview.png", import.meta.url).href;
const typeIconBattlePreviews = {
  letters: {
    singles: new URL("../assets/codeinjection/showcase/type-icons-letters-singles.png", import.meta.url).href,
    triples: new URL("../assets/codeinjection/showcase/type-icons-letters-triples.png", import.meta.url).href,
  },
  circular: {
    singles: new URL("../assets/codeinjection/showcase/type-icons-circular-singles.png", import.meta.url).href,
    triples: new URL("../assets/codeinjection/showcase/type-icons-circular-triples.png", import.meta.url).href,
  },
  solid: {
    singles: new URL("../assets/codeinjection/showcase/type-icons-solid-singles.png", import.meta.url).href,
    triples: new URL("../assets/codeinjection/showcase/type-icons-solid-triples.png", import.meta.url).href,
  },
};
const summaryShowcase = [
  [new URL("../assets/codeinjection/showcase/summary-ivs.png", import.meta.url).href, "White 2 Summary IVs with the six stored individual values", 256, 132],
  [new URL("../assets/codeinjection/showcase/summary-evs.png", import.meta.url).href, "White 2 Summary EVs with the six stored effort values", 256, 132],
] as const;

const patchShowcases = {
  summary: summaryShowcase,
  summaryBw2: [
    ...summaryShowcase,
    [new URL("../assets/codeinjection/showcase/summary-hidden-power.png", import.meta.url).href, "White 2 Summary showing Dark-type Hidden Power with 70 BP", 256, 132],
  ],
  party: [
    [new URL("../assets/codeinjection/showcase/enhanced-menu.png", import.meta.url).href, "White 2 party commands including EVOLVE and RELEARN", 104, 170],
    [new URL("../assets/codeinjection/showcase/party-toolbar.png", import.meta.url).href, "Party Toolbar leveling confirmation and HP, experience, healing, and status controls", 256, 77],
  ],
  learnset: [
    [new URL("../assets/codeinjection/showcase/learnset-info.png", import.meta.url).href, "Learnset Viewer base stats, abilities, evolution family, and evolution requirement", 256, 142],
    [new URL("../assets/codeinjection/showcase/learnset-moves.png", import.meta.url).href, "Learnset Viewer move types, learn levels, and maximum PP", 256, 102],
  ],
  quickPokeBall: [
    [new URL("../assets/codeinjection/showcase/quick-poke-ball-idle.png", import.meta.url).href, "White 2 wild battle with the Quick Poké Ball tab showing 12 Poké Balls", 256, 134],
    [new URL("../assets/codeinjection/showcase/quick-poke-ball-cycling.png", import.meta.url).href, "The tab highlights in blue while cycling balls, with the Master Ball selected", 256, 134],
  ],
  pokenav: [
    [new URL("../assets/codeinjection/showcase/pokenav-info.png", import.meta.url).href, "Pokenav species stats, abilities, and Patrat's combined 50% encounter chance", 250, 133],
    [new URL("../assets/codeinjection/showcase/pokenav-encounters.png", import.meta.url).href, "Pokenav encounter method tabs and Route 19's native Grass encounters", 250, 139],
  ],
} as const;

function renderPatchShowcase(kind: keyof typeof patchShowcases): string {
  return `<div class="code-injection-showcase">${patchShowcases[kind].map(([src, alt, width, height]) =>
    `<img src="${src}" alt="${escapeHtml(alt)}" width="${width}" height="${height}" loading="lazy" decoding="async">`,
  ).join("")}</div>`;
}

const singlesMovePreview = new URL("../assets/codeinjection/showcase/move-effectiveness.png", import.meta.url).href;
const doublesTargetPreview = new URL("../assets/codeinjection/showcase/move-effectiveness-doubles.png", import.meta.url).href;
const moveHighlightOptions = [
  ["superEffective", "Super effective", new URL("../assets/codeinjection/showcase/move-effectiveness-mask-super.png", import.meta.url).href],
  ["notVeryEffective", "Not very effective", new URL("../assets/codeinjection/showcase/move-effectiveness-mask-resisted.png", import.meta.url).href],
  ["immune", "Immune / no damage", new URL("../assets/codeinjection/showcase/move-effectiveness-mask-immune.png", import.meta.url).href],
] as const;

function moveHighlightPreviewColor(color: string): string {
  return typeIconBorderHex(moveHighlightRgb555(color));
}

function renderMoveEffectivenessPreviews(colors: MoveHighlightColors): string {
  return `<div class="code-injection-showcase move-effectiveness-previews">
    <figure>
      <div class="move-effectiveness-preview-image">
        <img src="${singlesMovePreview}" alt="Move names showing super-effective, resisted, immune, and neutral attacks against Gyarados" width="256" height="94" loading="lazy" decoding="async">
        ${moveHighlightOptions.map(([key, , mask]) => `<span aria-hidden="true" data-move-highlight-glyph="${key}" style="--move-glyph-mask: url('${mask}'); background-color: ${moveHighlightPreviewColor(colors[key])}"></span>`).join("")}
      </div>
      <figcaption>Singles move selection</figcaption>
    </figure>
    <figure>
      <img src="${doublesTargetPreview}" alt="Doubles target grid with the selected move shown in a white nameplate at the bottom" width="256" height="192" loading="lazy" decoding="async">
      <figcaption>Doubles target selection</figcaption>
    </figure>
  </div>`;
}

const codeInjectionTabs = [
  { id: "infrastructure", label: "Infrastructure and Dependencies" },
  { id: "graphics", label: "Graphical/UI Enhancements" },
  { id: "quality-of-life", label: "Quality of Life" },
  { id: "major-features", label: "Major Features/Expansions" },
  { id: "add-ons", label: "Minor Features/Add-ons" },
  { id: "debug-helpers", label: "Debug Helpers" },
] as const;
type CodeInjectionTab = (typeof codeInjectionTabs)[number]["id"];
const activeCodeInjectionTabs = new WeakMap<HTMLElement, CodeInjectionTab>();
const showUnsupportedCodeInjectionPatches = new WeakMap<ProjectState, boolean>();

const pendingTypeIcons = new WeakMap<ProjectState, { variant: TypeIconVariant; borderColor: string }>();
const pendingLearnsetLayouts = new WeakMap<ProjectState, LearnsetUpperLayout>();
const learnsetLayouts = [
  { layout: "classic", label: "Classic", bw1: new URL("../assets/codeinjection/showcase/learnset-bw1-classic.png", import.meta.url).href, bw2: new URL("../assets/codeinjection/showcase/learnset-classic.png", import.meta.url).href },
  { layout: "three-cards", label: "Three cards", bw1: new URL("../assets/codeinjection/showcase/learnset-bw1-three-cards.png", import.meta.url).href, bw2: new URL("../assets/codeinjection/showcase/learnset-three-cards.png", import.meta.url).href },
] as const;
const pendingCandyItemIds = new WeakMap<ProjectState, number>();

export function renderCodeInjectionEditor(project: ProjectState, root: HTMLElement, onDirty: () => void): void {
  const activeTab = activeCodeInjectionTabs.get(root) ?? "infrastructure";
  const showUnsupported = showUnsupportedCodeInjectionPatches.get(project) ?? project.session.baseRom !== "BW";
  const patchVisibility = (supported: boolean): string =>
    `data-code-injection-supported="${supported}"${!supported && !showUnsupported ? " hidden" : ""}`;
  const emptyCategoryMessage = `<div class="code-injection-empty" data-code-injection-empty hidden>No supported patches in this category. Enable “Show unsupported patches” in the sidebar to view all patches.</div>`;
  const status = getPmcInstallStatus(project);
  const heapExpansion = getPmcHeapExpansionStatus(project);
  const heapExpansionLabel = heapExpansion.available
    ? `Expand PMC Heap Allocation (+${heapExpansion.targetCapKiB - heapExpansion.capKiB}kb)`
    : "Expand PMC Heap Allocation";
  const fiveBox = getFiveBoxPmcStatus(project);
  const fiveBoxDetail = fiveBox.legacy ? "Update PMC to migrate Pokémon from boxes 6–24."
    : fiveBox.enabled ? "DS-mode export. Saving clears boxes 6–24 after moving any Pokémon that fit into Box 5."
      : "Repurposes PC box 6-24 for more PMC Heap";
  const install = <T>(stage: (candidate: ProjectState) => T | Promise<T>) => installCodeInjectionPatch(project, stage);
  const modules = listCodeInjectionDlls(project);
  const memory=status.installed?getPmcMemoryEstimate(project):undefined;
  const formEvolutionStatus = detectBundledFormEvolutionDll(project);
  const formEvolutionInstalled = formEvolutionStatus === "patched";
  const doubleBattleFixStatus = detectBundledDoubleBattleFixDll(project);
  const doubleBattleFixSupported = status.supported && doubleBattleFixStatus !== "unsupported";
  const bgmToggleStatus = detectBundledBgmToggleDll(project);
  const bgmToggleSupported = bgmToggleStatus !== "unsupported";
  const forgettableHmsStatus = getForgettableHmsPmcStatus(project);
  const shinyOddsStatus = getShinyOddsStatus(project);
  const challengeStats = getChallengeModeStatsStatus(project);
  const bw2ApFix = getBw2ApFixStatus(project);
  const earlyChallengeMode = getEarlyChallengeModeStatus(project);
  const earlyNationalDex = getEarlyNationalDexStatus(project);
  const pwtSixPokemonStatus = getPwtSixPokemonStatus(project);
  const pwtAbilityStatus = getPwtAbilityStatus(project);
  const autorunStatus = getAutorunStatus(project);
  const itemExpansionStatus = getItemExpansionStatus(project);
  const trainingItemsStatus = getTrainingItemsStatus(project);
  const introSkipStatus = getIntroSkipStatus(project);
  const megaStatus = getMegaEvolutionStatus(project);
  const trainerCustomization = getTrainerCustomizationStatus(project);
  const moveExpansionStatus = detectMoveExpansionPatch(project);
  const fairyStatus = detectFairyTypePatch(project);
  const bw1HmStatus = detectForgettableHmPatch(project);
  const cascadeStatus = getCascadePersonalMigrationStatus(project);
  const megaContentStatus = getMegaContentStatus(project);
  const regionalStatus = getRegionalFormsStatus(project);
  const families = regionalStatus.supported ? regionalFamilies(project) : [];
  const speciesStatus = getSpeciesExpansionStatus(project);
  const speciesFamilies = speciesStatus.supported && canUseSpeciesExpansionInstaller() ? speciesExpansionFamilies(project) : [];
  const speciesTotal = speciesFamilies.reduce((sum, family) => sum + family.members.length, 0);
  const abilityStatus = canUseAbilityExpansionInstaller() ? getAbilityExpansionStatus(project) : undefined;
  const abilityRows = abilityStatus?.supported ? abilityExpansionRows(project) : [];
  const megaConfig = project.codeInjection?.megaEvolution;
  // One button: Item Expansion, the PWAN runtime, the Mega runtime, the Mega Pokémon and their stones and routes.
  const megaNeedsUpdate = megaStatus.updateAvailable || megaContentStatus.animationMissing || megaContentStatus.ringMissing || megaContentStatus.universalMissing;
  const gmaxComplete = megaContentStatus.gmaxForms >= GMAX_MEGAS.length;
  const megaInstallEnabled = megaContentStatus.installed ? megaNeedsUpdate : megaContentStatus.ready;
  const forgettableHmsSupported = forgettableHmsStatus !== "unsupported";
  const infiniteCandyStatus = getInfiniteCandyStatus(project, pendingCandyItemIds.get(project));
  const infiniteCandyItemId = infiniteCandyStatus.itemId ?? getInstalledInfiniteCandyItemId(project) ?? 622;
  const levelCapsStatus = getLevelCapsStatus(project);
  const trainerLevelCapsStatus = getTrainerLevelCapsStatus(project);
  const debugFlag = getDebugSaveFlagStatus(project);
  const testingPatchCard = (id: TestingPatchId) => {
    const patch = TESTING_PATCHES[id];
    const state = getTestingPatchStatus(project, id);
    return `<section class="code-injection-panel" ${patchVisibility(state.supported)}>
      <div class="code-injection-panel__header"><div>
        <h2>${escapeHtml(patch.title)}</h2><p>${escapeHtml(patch.description)}</p>
      </div>${renderInlineStatus(state.installed ? "Installed" : state.compatible ? "Ready" : state.supported ? "Incompatible" : "Unsupported", { className: "code-injection-status" })}</div>
      <div class="code-injection-facts">${supportedRomsFact("US White 2 (revision 0)")}<div><span>Version</span><strong>0.1.0 alpha</strong></div></div>
      <p>${escapeHtml(state.message)}</p>
      <div class="code-injection-actions">
        <button class="btn -primary" id="install-${id}-btn" type="button" ${state.compatible && !state.installed ? "" : "disabled"}>${state.installed ? "Installed" : `Install ${escapeHtml(patch.title)}`}</button>
        ${state.canUninstall ? `<button class="btn -default" id="uninstall-${id}-btn" type="button">Remove</button>` : ""}
        <div class="code-injection-note" id="${id}-note" aria-live="polite"></div>
      </div></section>`;
  };
  const trainerFieldStatus = getTrainerFieldConditionsStatus(project);
  const frostbiteSnowCards = (["frostbite", "snow", "modern_status"] as const).map(id => {
    const state = frostbiteSnowStatus(project, id);
    const name = id === "snow" ? "Snow" : id === "frostbite" ? "Frostbite" : "Modern Status Effects";
    const description = id === "snow" ? "Replaces Hail with Snow and gives Ice types 1.5× Defense."
      : id === "frostbite" ? "Replaces Freeze with a status that reduces special damage and chips HP each turn."
      : "Applies Pokémon Champions status rules. Frostbite takes precedence when installed.";
    const action = state.updateAvailable ? `Update ${name}` : `Install ${name}`;
    return `<section class="code-injection-panel" ${patchVisibility(state.supported)}>
      <div class="code-injection-panel__header"><div><h2>${name}</h2><p>${description}</p></div>
        ${renderInlineStatus(state.updateAvailable ? "Update available" : state.installed ? "Installed" : state.supported ? "Ready" : "Unsupported", { className: "code-injection-status" })}</div>
      ${renderSupportedRoms(US_GEN5_REV0)}
      <div class="code-injection-actions"><button class="btn -primary" type="button" data-install-battle-climate="${id}" ${state.supported && (!state.installed || state.updateAvailable) ? "" : "disabled"}>${action}</button>
      <div class="code-injection-note" role="status"></div></div>
    </section>`;
  }).join("");
  const tagBattleStatus = getTagBattleStabilizationStatus(project);
  const rotationBattleAi = getRotationBattleAiStatus(project);
  const abilityStorageFix = getAbilityStorageFixStatus(project);
  const tagBattleCanInstall = tagBattleStatus.supported && tagBattleStatus.compatible && !tagBattleStatus.installed;
  const portaPcStatus = getPortaPcStatus(project);
  const quickActionsStatus = getCGearQuickActionsStatus(project);
  const learnsetStatus = getLearnsetViewerStatus(project);
  const canChooseLearnsetLayout = learnsetStatus.supported;
  const installedLearnsetLayout = learnsetStatus.upperLayout ?? "three-cards";
  let learnsetUpperLayout = pendingLearnsetLayouts.get(project) ?? installedLearnsetLayout;
  const learnsetInstallLabel = () => learnsetStatus.updateAvailable ? "Update" : learnsetStatus.partial ? "Repair"
    : !learnsetStatus.installed ? "Install" : learnsetUpperLayout !== installedLearnsetLayout ? "Apply Layout" : "Reinstall";
  const pokenavStatus = getPokenavStatus(project);
  const nuzlockeStatus = getNuzlockeEncountersStatus(project);
  const summaryStatStatus = getSummaryStatViewerStatus(project);
  const battleHudStatus = getBattleTypeHudStatus(project);
  const typeIconSettings = pendingTypeIcons.get(project) ?? {
    variant: battleHudStatus.iconVariant ?? "letters",
    borderColor: battleHudStatus.borderColor ?? (project.session.baseRom === "BW" ? DEFAULT_BW1_TYPE_ICON_BORDER : DEFAULT_TYPE_ICON_BORDER),
  };
  const moveEffectivenessStatus = getMoveEffectivenessStatus(project);
  const quickPokeBall = getQuickPokeBallStatus(project);
  const moveColors = moveEffectivenessStatus.colors ?? DEFAULT_MOVE_HIGHLIGHT_COLORS;
  const portaPcCanInstall = portaPcStatus.supported && portaPcStatus.compatible
    && (!portaPcStatus.installed || portaPcStatus.updateAvailable);
  const weatherRuntimeStatus = detectBundledOverworldWeatherRuntime(project);
  const weatherRuntimeInstalled = weatherRuntimeStatus === "patched";
  const weatherRuntimeSupported = weatherRuntimeStatus !== "unsupported";
  const pwanRuntimeStatus = getPwanRuntimeStatus(project);
  const pwanRuntimeInstalled = pwanRuntimeStatus.supported && pwanRuntimeStatus.installed;
  const pwanRuntimeCanUninstall = pwanRuntimeInstalled && canUninstallPwanRuntime(project);
  const pwanLegacyInstalled = pwanRuntimeStatus.supported && pwanRuntimeStatus.legacyInstalled;
  const pwanStreaming = pwanRuntimeStatus.supported && Boolean(pwanRuntimeStatus.streaming);
  const pwanUpdateAvailable = pwanRuntimeStatus.supported && Boolean(pwanRuntimeStatus.updateAvailable);
  // Installing always installs the streaming runtime (an update replaces the split PWAN DLLs), so check its hooks.
  const pwanCompatibility = detectAnimStreamsCompatibility(project);
  const pwanCanInstall = pwanRuntimeStatus.supported && pwanCompatibility.compatible;
  const trainerPwanStatus = getTrainerPwanRuntimeStatus(project);
  const trainerPwanCompatibility = ["W2", "B2", "W", "B"].includes(project.session.baseVersion) ? pwanCompatibility : detectTrainerPwanCompatibility(project);
  const trainerPwanInstalled = trainerPwanStatus.supported && trainerPwanStatus.installed;
  const trainerPwanCanInstall = trainerPwanStatus.supported && (trainerPwanCompatibility.compatible || (!project.originalRomBytes && trainerPwanCompatibility.checks.every((check) => check.status === "missing")));
  const trainerPwanCanUninstall = trainerPwanInstalled && canUninstallTrainerPwanRuntime(project);
  const battleLogStatus = getBattleLogInstallStatus(project);
  const battleLogCanInstall = battleLogStatus.supported && battleLogStatus.compatible;
  const battleLogCanUninstall = battleLogStatus.installed && canUninstallBattleLog(project);
  const partyTools = getPartyQuickActionsStatus(project);
  const menuEvolutionStatus = getMenuEvolutionInstallStatus(project);
  const menuEvolutionCanInstall = menuEvolutionStatus.supported
    && menuEvolutionStatus.compatible
    && battleLogStatus.supported && battleLogStatus.compatible;
  const menuEvolutionCanUninstall = menuEvolutionStatus.installed && canUninstallMenuEvolution(project);
  if (status.supported && !project.originalRomBytes && !codeInjectionHydrationProjects.has(project)) {
    void hydrateRomBytesForCodeInjection(project, root, onDirty);
  }
  const battleUiCards = [
    { id: "battle-hud", title: "Type Icons", status: battleHudStatus,
      description: "" },
    { id: "move-effectiveness", title: "Move Effectiveness Preview", status: moveEffectivenessStatus,
      description: "" },
  ].map(card => `
        <section class="code-injection-panel" ${patchVisibility(card.status.supported)}>
          <div class="code-injection-panel__header">
            <div><h2>${card.title}</h2>${card.description ? `<p>${card.description}</p>` : ""}</div>
            ${renderInlineStatus(card.status.legacyCombined ? "Combined Patch Present" : card.status.updateAvailable ? "Update Available" : card.status.installed ? "Installed" : card.status.compatible ? "Ready" : card.status.supported ? "Incompatible" : "Unsupported", { className: "code-injection-status" })}
          </div>
          ${card.id === "move-effectiveness" ? renderMoveEffectivenessPreviews(moveColors) : ""}
          <div class="code-injection-facts">
            ${supportedRomsFact(US_GEN5_REV0)}
            <div><span>Dependency</span><strong>PMC only</strong></div>
          </div>
          ${card.id === "battle-hud" ? `<div class="type-icon-variant-picker">
            <div class="code-injection-facts"><div><span>Graphics profile</span><strong>${battleHudStatus.graphicsProfile === "redux" ? "Redux" : "Original"}</strong></div></div>
            <div class="type-icon-variant-previews" role="group" aria-label="Type icon style">
              ${([['letters', 'Hexagonal letters'], ['circular', 'Circular icons'], ['solid', 'Angular HUD wedges']] as const).map(([variant, label]) => `<button type="button" class="type-icon-variant-preview ${typeIconSettings.variant === variant ? "is-selected" : ""}" data-type-icon-variant-card="${variant}" aria-pressed="${typeIconSettings.variant === variant}">
                <span class="type-icon-variant-caption">${label}</span>
                <img src="${variant === "solid" ? typeIconSolidPreview : typeIconPreview(variant, typeIconSettings.borderColor)}" alt="${variant === "solid" ? "Angular dual-type HUD wedge examples" : `All 18 ${variant === "letters" ? "lettered hexagonal" : "circular symbol"} type icons`}" loading="lazy">
              </button>`).join("")}
            </div>
            <label class="type-icon-border-color" ${typeIconSettings.variant === "solid" ? "hidden" : ""}><span>Border color</span><input id="type-icon-border-color" type="color" value="${escapeHtml(typeIconSettings.borderColor)}" aria-label="Type icon border color"></label>
            <div class="type-icon-battle-previews" role="group" aria-label="Type icons in battle">
              <p>White 2 · Default border</p>
              ${([["singles", "Singles"], ["triples", "Triples"]] as const).map(([format, label]) => `<figure>
                <img data-type-icon-battle-preview="${format}" src="${typeIconBattlePreviews[typeIconSettings.variant][format]}" alt="Type icons beside the HP bars in a ${format} battle" width="256" height="192" loading="lazy" decoding="async">
                <figcaption>${label}</figcaption>
              </figure>`).join("")}
            </div>
          </div>` : ""}
          ${card.id === "move-effectiveness" ? `<div class="code-injection-facts">
            ${moveHighlightOptions.map(([key, label]) => `<label><span>${label}</span>
              <input type="color" data-move-highlight-color="${key}" aria-label="${label} color" value="${escapeHtml(moveColors[key])}">
              <strong data-move-highlight-sample="${key}" style="color:${moveHighlightPreviewColor(moveColors[key])}">${label}</strong>
            </label>`).join("")}
          </div><p class="code-injection-note">Choose colors, then ${card.status.installed ? "reinstall" : "install"} to apply them. Colors are stored with DS color precision. The preview uses current ability/item state, including unrevealed effects.</p>
          <button class="btn -default" type="button" id="reset-move-highlight-colors">Reset colors</button>` : ""}
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-${card.id}-btn" type="button" ${card.status.supported && card.status.compatible ? "" : "disabled"}>${card.status.legacyCombined ? "Replace combined" : card.status.updateAvailable ? "Update" : card.status.installed ? "Reinstall" : "Install"}</button>
            <button class="btn -default" id="uninstall-${card.id}-btn" type="button" ${card.status.canUninstall ? "" : "disabled"} title="${card.id === "move-effectiveness" ? "Remove the standalone preview from the next ROM export." : "Only this project's staged standalone DLL can be removed."}">Uninstall</button>
            <div class="code-injection-note" id="${card.id}-note" aria-live="polite"></div>
          </div>
          ${card.id === "battle-hud" ? `<div class="code-injection-credits" aria-label="Type Icons credits">
            <span>Designed in collaboration with</span>
            <strong>TrustyPeaches</strong>
          </div>` : ""}
        </section>`);
  root.innerHTML = `
    <section class="code-injection-page">
      <aside class="code-injection-sidebar">
        <h1>Code Injection</h1>
        <label class="code-injection-sidebar__filter">
          <input type="checkbox" id="show-unsupported-patches" ${showUnsupported ? "checked" : ""} />
          <span>Show unsupported patches</span>
        </label>
        <section class="code-injection-panel code-injection-sidebar__runtime">
          <div class="code-injection-panel__header">
            <div>
              <h2>PMC Runtime</h2>
              <p>Shared runtime for the patch installers on this page. Required dependencies are installed automatically.</p>
            </div>
            ${renderInlineStatus(status.installed ? "Installed" : "Not Installed", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            <div><span>Version</span><strong>${status.installed && status.version ? escapeHtml(status.version) : "—"}</strong></div>
            ${supportedRomsFact(`${US_GEN5} · Italian White 2`)}
            ${fiveBox.enabled ? `<div><span>PC storage</span><strong>5 boxes · 150 slots</strong></div>` : heapExpansion.expanded ? `<div><span>Heap cap</span><strong>${heapExpansion.capKiB} KiB</strong></div>` : ""}
          </div>
          ${memory?renderPmcCapacity(memory,project.session.baseRom==="BW",fiveBox.enabled):""}
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-pmc-btn" type="button" ${status.supported ? "" : "disabled"}>${status.installed ? "Update PMC" : "Install PMC"}</button>
            ${fiveBox.enabled ? "" : `<button class="btn -default" id="expand-pmc-heap-btn" type="button" ${heapExpansion.available ? "" : "disabled"} title="${escapeHtml(heapExpansion.message)}">${heapExpansionLabel}</button>`}
            ${fiveBox.supported ? `<button class="btn -default" id="five-box-pmc-btn" type="button" aria-describedby="five-box-pmc-detail">${fiveBox.enabled ? "Restore 24 PC Boxes" : "Enable Five-Box Mode (+72kb)"}</button>
            <small id="five-box-pmc-detail">${fiveBoxDetail}</small>` : ""}
            <div class="code-injection-note" id="pmc-install-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-sidebar__modules">
          <h2>Installed DLLs</h2>
          <p>${status.installed ? "DLLs found under patches/ and lib/." : "Add built patch DLLs. PMC is installed automatically if needed."}</p>
          <div class="code-injection-actions">
            <button class="btn -primary" data-dll-target="patches" type="button" ${status.supported ? "" : "disabled"}>Add Patch DLL</button>
            <button class="btn -default" data-dll-target="lib" type="button" ${status.supported ? "" : "disabled"}>Add Library DLL</button>
            <input id="code-injection-dll-input" type="file" accept=".dll" hidden />
            <div class="code-injection-note" id="dll-install-note" aria-live="polite"></div>
          </div>
          <div class="code-injection-module-list">
            ${
              modules.length === 0
                ? `<div class="code-injection-empty">No DLLs found.</div>`
                : modules
                    .map(
                      (module) => `
                        <div class="code-injection-module">
                          <strong>${escapeHtml(module.path)}</strong>
                          ${memory?.modules.find(m=>m.path===module.path)?`<small>${formatPmcKiB(memory.modules.find(m=>m.path===module.path)!.residentAllocationBytes)} retained · ${formatPmcKiB(memory.modules.find(m=>m.path===module.path)!.loadAllocationBytes)} loading</small>`:""}
                        </div>
                      `,
                    )
                    .join("")
            }
          </div>
        </section>
      </aside>
      <main class="code-injection-main">
        <p class="code-injection-ai-notice">The patches in this section were researched, developed, and/or ported from existing patches with AI assistance. Artistic assets are sourced from real artists and credited. No image generation models were used. For questions on how specific patches were implemented or how one could recreate features from the patches here without AI assistance (software engineering basics and C++ familiarity is recommended), you can ask in the discord linked on the top right.</p>
        <div class="code-injection-tabs" role="tablist" aria-label="Patch categories">
          ${codeInjectionTabs.map(tab => `<button class="code-injection-tab ${activeTab === tab.id ? "-active" : ""}" type="button" role="tab" id="code-injection-tab-${tab.id}" aria-controls="code-injection-panel-${tab.id}" aria-selected="${activeTab === tab.id}" tabindex="${activeTab === tab.id ? 0 : -1}" data-code-injection-tab="${tab.id}">${tab.label}</button>`).join("")}
        </div>
        <section class="code-injection-tab-panel" id="code-injection-panel-infrastructure" role="tabpanel" aria-labelledby="code-injection-tab-infrastructure" tabindex="0" ${activeTab === "infrastructure" ? "" : "hidden"}>
        <section class="code-injection-panel" ${patchVisibility(pwanRuntimeStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>PWAN GIF Support</h2>
              <p>Allows for importing Pokemon sprite animations as gifs</p>
            </div>
            ${renderInlineStatus(pwanUpdateAvailable ? "Update" : pwanRuntimeInstalled ? "Installed" : pwanLegacyInstalled ? "Upgrade" : pwanCanInstall ? "Ready" : pwanCompatibility.supportedBase ? "Incompatible" : "Unsupported", { className: "code-injection-status" })}
          </div>
          ${pwanUpdateAvailable ? `<p class="code-injection-note">${escapeHtml(pwanRuntimeStatus.message)}</p>` : ""}
          <div class="code-injection-facts">
            ${supportedRomsFact(US_GEN5)}
            <div><span>Runtime</span><strong>${pwanUpdateAvailable ? "PWAN (split)" : "Streaming"}</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
            <div><span>Compatibility</span><strong>${pwanCompatibility.compatible ? "Passed" : pwanCompatibility.supportedBase ? "Failed" : "Unsupported"}</strong></div>
            <div><span>Hook Checks</span><strong>${pwanCompatibility.passed}/${pwanCompatibility.checks.length}</strong></div>
          </div>
          ${renderPwanCompatibilityDetails(project, pwanCompatibility)}
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-pwan-runtime-btn" type="button" ${pwanCanInstall ? "" : "disabled"}>
              ${pwanUpdateAvailable ? "Update to Streaming Runtime" : pwanRuntimeInstalled ? "Reinstall PWAN GIF Support" : pwanLegacyInstalled ? "Upgrade PWAN GIF Support" : "Install PWAN GIF Support"}
            </button>
            <button class="btn -default" id="uninstall-pwan-runtime-btn" type="button" ${pwanRuntimeCanUninstall ? "" : "disabled"}
              title="${pwanRuntimeInstalled && !pwanRuntimeCanUninstall ? "DLLs already built into the loaded ROM cannot be removed yet." : pwanStreaming ? "Remove the animated sprite runtime and its streams; imported animations stay in the project." : "Remove the staged PWAN runtime DLLs."}">
              Uninstall PWAN GIF Support
            </button>
            <div class="code-injection-note" id="pwan-runtime-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(trainerPwanStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Trainer PWAN GIF Support</h2>
              <p>Allows for importing trainer sprite animations as gifs</p>
            </div>
            ${renderInlineStatus(trainerPwanInstalled ? "Installed" : trainerPwanCanInstall ? "Ready" : trainerPwanStatus.supported ? "Incompatible" : "Unsupported", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            <div><span>Sprites</span><strong>Front trainers</strong></div>
            <div><span>Runtime</span><strong>${pwanStreaming ? "Shared (streaming)" : "Standalone"}</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
            ${supportedRomsFact(US_GEN5)}
            <div><span>Hook Checks</span><strong>${trainerPwanCompatibility.passed}/${trainerPwanCompatibility.checks.length}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-trainer-pwan-runtime-btn" type="button" ${trainerPwanCanInstall ? "" : "disabled"}>
              ${trainerPwanInstalled ? "Reinstall Trainer PWAN Support" : "Install Trainer PWAN Support"}
            </button>
            <button class="btn -default" id="uninstall-trainer-pwan-runtime-btn" type="button" ${trainerPwanCanUninstall ? "" : "disabled"}>Uninstall Trainer PWAN Support</button>
            <div class="code-injection-note" id="trainer-pwan-runtime-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(weatherRuntimeSupported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Overworld Weather Runtime</h2>
              <p>Expands the weather table to 64 entries</p>
            </div>
            ${renderInlineStatus(weatherRuntimeInstalled ? "Installed" : weatherRuntimeSupported ? "Ready" : "Unsupported", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            ${supportedRomsFact("US White 2 (IRDO)")}
            <div><span>Custom Slots</span><strong>49 · IDs 15–63</strong></div>
            <div><span>Registry</span><strong>weather/pwth.bin</strong></div>
            <div><span>Generic Resources</span><strong>NCGR · NCLR · NCER · NANR · 2× BTX0</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
            <div><span>Runtime ABI</span><strong>5 · PWTH v4</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-weather-runtime-btn" type="button" ${weatherRuntimeSupported ? "" : "disabled"}>
              ${weatherRuntimeInstalled ? "Reinstall Weather Runtime" : "Install Weather Runtime"}
            </button>
            <div class="code-injection-note" id="weather-runtime-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(battleLogStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Trainer Battle Log</h2>
              <p>Allows for recording of trainer battle history and per-pokemon ko counts. Repurposes save blocks 29-31 (Palpad/Wifi) and edits pokemon struct data. Will break PKHex compatability.</p>
            </div>
            ${renderInlineStatus(battleLogStatus.updateAvailable
                  ? "Update Available"
                  : battleLogStatus.upToDate
                    ? "Installed"
                    : battleLogCanInstall
                      ? "Ready"
                      : battleLogStatus.supported
                        ? "Incompatible"
                        : "Unsupported", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            ${supportedRomsFact(US_GEN5)}
            <div><span>Capacity</span><strong>600 battles</strong></div>
            <div><span>Save Blocks</span><strong>29–31</strong></div>
            <div><span>Runtime</span><strong>${battleLogStatus.updateAvailable ? `Update to v${battleLogStatus.bundledRuntimeVersion}` : battleLogStatus.upToDate ? `v${battleLogStatus.bundledRuntimeVersion}` : `Bundled v${battleLogStatus.bundledRuntimeVersion}`}</strong></div>
            <div><span>Save Ownership</span><strong>${battleLogStatus.saveGuardInstalled ? "Active" : "Pending"}</strong></div>
            <div><span>Hook Checks</span><strong>${battleLogStatus.checked ? `${battleLogStatus.passed}/${battleLogStatus.checks.length}` : "On install"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-battle-log-btn" type="button" ${battleLogCanInstall ? "" : "disabled"}>
              ${battleLogStatus.updateAvailable ? "Update Battle Log" : battleLogStatus.installed ? "Reinstall Battle Log" : "Install Battle Log"}
            </button>
            <button class="btn -default" id="uninstall-battle-log-btn" type="button" ${battleLogCanUninstall ? "" : "disabled"}
              title="${
                battleLogStatus.installed && menuEvolutionStatus.installed
                  ? `Uninstall ${MENU_EVOLUTION_TITLE} first.`
                  : battleLogStatus.installed && !battleLogCanUninstall
                    ? "DLLs already built into the loaded ROM cannot be removed yet."
                    : "Remove the staged battle-log DLLs."
              }">
              Uninstall Battle Log
            </button>
            <div class="code-injection-note" id="battle-log-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(itemExpansionStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Item Expansion</h2>
              <p>Expands item IDs to 1023. Repurposes the ${project.session.baseRom === "BW" ? "Pal Pad, Wi-Fi friend and trade history" : "Pal Pad, Wi-Fi friend and Unity Tower"} data in the save file.</p>
            </div>
            ${renderInlineStatus(!itemExpansionStatus.supported ? "Unsupported" : itemExpansionStatus.installed ? itemExpansionStatus.updateAvailable ? "Update Available" : "Installed" : itemExpansionStatus.compatible ? "Ready" : "Incompatible", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            ${supportedRomsFact(US_GEN5)}
            <div><span>Item IDs</span><strong>1–1023</strong></div>
            <div><span>New items named</span><strong>${itemExpansionStatus.installed ? itemExpansionStatus.authoredExtraItems : "—"}</strong></div>
            <div><span>Bag</span><strong>1,023 shared slots</strong></div>
            <div><span>Save format</span><strong>${itemExpansionStatus.installed ? "Expanded" : "Retail"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-item-expansion-btn" type="button" ${itemExpansionStatus.compatible && (!itemExpansionStatus.installed || itemExpansionStatus.updateAvailable) ? "" : "disabled"}${itemExpansionStatus.compatible || !itemExpansionStatus.message ? "" : ` title="${escapeHtml(itemExpansionStatus.message)}"`}>
              ${itemExpansionStatus.installed ? itemExpansionStatus.updateAvailable ? "Update Item Expansion" : "Item Expansion Installed" : "Install Item Expansion"}
            </button>
            ${!itemExpansionStatus.installed && trainingItemsStatus === "available" ? `
              <label><input type="checkbox" id="include-training-items" ${itemExpansionStatus.compatible ? "" : "disabled"}> Include Training Items</label>
            ` : ""}
            ${itemExpansionStatus.installed ? `
              <button class="btn -default" id="install-training-items-btn" type="button" ${itemExpansionStatus.compatible && (trainingItemsStatus === "available" || trainingItemsStatus === "update") ? "" : "disabled"}>
                ${trainingItemsStatus === "installed" ? "Training Items Installed" : trainingItemsStatus === "update" ? "Update Training Items" : "Add Training Items"}
              </button>
            ` : ""}
            <button class="btn -default -remove" id="uninstall-item-expansion-btn" type="button" ${itemExpansionStatus.canUninstall ? "" : "disabled"}>Uninstall Item Expansion</button>
            <div class="code-injection-note" id="item-expansion-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(doubleBattleFixStatus !== "unsupported")}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Single-NPC Double Battle Fix</h2>
              <p>Fixes common-script trainers changed from Singles to Doubles. PMC is installed automatically if needed.</p>
            </div>
            ${renderInlineStatus(doubleBattleFixStatus === "patched" ? "Installed" : doubleBattleFixStatus === "unsupported" ? "Unsupported" : "Not Installed", { className: "code-injection-status" })}
          </div>
          ${renderSupportedRoms("US Black, Black 2, and White 2")}
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-double-battle-fix-btn" type="button" ${doubleBattleFixSupported ? "" : "disabled"} title="Install the bundled double battle fix and any missing dependencies.">
              Install Double Battle Fix
            </button>
            <div class="code-injection-note" id="double-battle-fix-note" aria-live="polite"></div>
          </div>
          <div class="code-injection-credits" aria-label="Double Battle Fix credits">
            <span>Implementation credits</span>
            <strong>Sunk</strong>
            <strong>Papaya</strong>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(tagBattleStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Tag Battle Stabilization</h2>
              <p>Runs one trainer’s AI at a time to reduce script memory use in tag battles with large opposing teams.</p>
            </div>
            ${renderInlineStatus(!tagBattleStatus.supported ? "Unsupported" : !tagBattleStatus.compatible ? "Incompatible" : tagBattleStatus.installed ? "Installed" : "Ready", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            ${supportedRomsFact("US Black, White, Black 2, and White 2")}
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
          </div>
          <p>Set team sizes in the Trainer editor.</p>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-tag-battle-stabilization-btn" type="button" ${tagBattleCanInstall ? "" : "disabled"}>
              Install Tag Battle Stabilization
            </button>
            <button class="btn -default" id="uninstall-tag-battle-stabilization-btn" type="button" ${tagBattleStatus.canUninstall ? "" : "disabled"}
              title="${tagBattleStatus.installed && !tagBattleStatus.canUninstall ? "A DLL already built into the loaded ROM cannot be removed yet." : "Remove the staged Tag Battle Stabilization DLL."}">
              Uninstall Tag Battle Stabilization
            </button>
            <div class="code-injection-note" id="tag-battle-stabilization-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(rotationBattleAi.supported)}>
          <div class="code-injection-panel__header">
            <div><h2>Rotation Battle AI</h2><p>Scores all three rotation slots against your current front Pokémon.</p></div>
            ${renderInlineStatus(rotationBattleAi.installed ? "Installed" : rotationBattleAi.compatible ? "Ready" : rotationBattleAi.supported ? "Unavailable" : "Unsupported", { className: "code-injection-status" })}
          </div>
          ${renderSupportedRoms(US_GEN5_REV0)}
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-rotation-battle-ai-btn" type="button"
              ${rotationBattleAi.compatible && !rotationBattleAi.installed ? "" : "disabled"}>Install Rotation Battle AI</button>
            ${rotationBattleAi.canUninstall ? '<button class="btn -default" id="uninstall-rotation-battle-ai-btn" type="button">Remove staged patch</button>' : ""}
            <div class="code-injection-note" id="rotation-battle-ai-note" role="status">${escapeHtml(rotationBattleAi.message)}</div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(abilityStorageFix.state !== "unsupported")}>
          <div class="code-injection-panel__header">
            <div><h2>Ability Storage Fix</h2><p>Keeps revealed abilities tied to the Pokémon that showed them.</p></div>
            ${renderInlineStatus({ unsupported: "Unsupported", unavailable: "Unavailable", ready: "Ready", installed: "Installed" }[abilityStorageFix.state], { className: "code-injection-status" })}
          </div>
          ${renderSupportedRoms(US_GEN5_REV0)}
          <div class="code-injection-actions">
            <button class="btn -primary" id="apply-ability-storage-fix-btn" type="button"
              ${abilityStorageFix.state === "ready" ? "" : "disabled"}>Apply Ability Storage Fix</button>
            <div class="code-injection-note" id="ability-storage-fix-note" role="status">${escapeHtml(abilityStorageFix.message ?? "")}</div>
          </div>
        </section>

        <section class="code-injection-panel" ${patchVisibility(formEvolutionStatus !== "unsupported")}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Added-Form Evolution Support</h2>
              <p>Evolution by form: each form evolves by its own evolution record (Galarian Darumaka into Galarian Darmanitan), and an evolution target can be an added form's record. Retail evolves every form as its base form does.</p>
            </div>
            ${renderInlineStatus(formEvolutionInstalled ? "Installed" : formEvolutionStatus === "unsupported" ? "Unsupported" : "Not Installed", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            ${supportedRomsFact(US_GEN5)}
            ${formEvolutionStatus === "unsupported" ? "" : `<div><span>Runtime</span><strong>FormEvolution${escapeHtml(project.session.baseVersion)}.dll + FormEvolutionCore${escapeHtml(project.session.baseVersion)}.dll</strong></div>`}
            <div><span>Module Path</span><strong>${formEvolutionInstalled ? "patches/" : "Pending"}</strong></div>
            <div><span>Dependencies</span><strong>PMC (${status.installed ? "installed" : "installed with it"})</strong></div>
          </div>
          <div class="code-injection-note">
            ${
              formEvolutionInstalled
                ? "The bundled form-evolution DLL is active in this project and will be included in the exported ROM."
                : formEvolutionStatus === "unpatched" ? "An earlier FormEvolution DLL is updated. PMC is installed automatically if needed." : ""
            }
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-form-evolution-btn" type="button" ${formEvolutionStatus === "unpatched" ? "" : "disabled"}>${formEvolutionInstalled ? "Installed" : "Install Added-Form Evolution Support"}</button>
            <div class="code-injection-note" id="form-evolution-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(trainerCustomization !== "unsupported")}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Trainer Customization</h2>
              <p>Edit trainer Pokémon and roster variations in the Trainer editor.</p>
            </div>
            ${renderInlineStatus(({ installed: "Installed", upgrade: "Upgrade available", unsupported: "Unsupported", unknown: "Unavailable", ready: "Ready" })[trainerCustomization], { className: "code-injection-status" })}
          </div>
          ${renderSupportedRoms(US_BW2_REV0)}
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-trainer-natures-btn" type="button" ${trainerCustomization === "ready" || trainerCustomization === "upgrade" ? "" : "disabled"}>
              ${trainerCustomization === "installed" ? "Installed" : trainerCustomization === "upgrade" ? "Upgrade Trainer Customization" : "Install Trainer Customization"}
            </button>
            <div class="code-injection-note" id="trainer-natures-note" aria-live="polite"></div>
          </div>
        </section>
        ${renderCascadePersonalCard(cascadeStatus)}
        </section>
        <section class="code-injection-tab-panel" id="code-injection-panel-graphics" role="tabpanel" aria-labelledby="code-injection-tab-graphics" tabindex="0" ${activeTab === "graphics" ? "" : "hidden"}>
        <section class="code-injection-panel" ${patchVisibility(naturePalettesSupported(project))}><div class="code-injection-panel__header"><div><h2>Nature Palettes</h2><p>25 normal/shiny palette pairs per form. Edit in the Pokémon sprite editor.</p></div></div>${renderSupportedRoms(US_BW2_REV0)}${renderNaturePaletteInstaller(project)}</section>
        <section class="code-injection-panel" ${patchVisibility(summaryStatStatus.supported)}>
          <div class="code-injection-panel__header"><div>
            <h2>Summary IV/EV Viewer</h2>
            <p>View IVs and optionally EVs on the summary screen.</p>
          </div>${renderInlineStatus(summaryStatStatus.updateAvailable ? "Update Available" : summaryStatStatus.installed ? "Installed" : summaryStatStatus.compatible ? "Ready" : summaryStatStatus.supported ? "Incompatible" : "Unsupported", { className: "code-injection-status" })}</div>
          ${renderPatchShowcase(project.session.baseVersion === "B2" || project.session.baseVersion === "W2" ? "summaryBw2" : "summary")}
          <div class="code-injection-facts">${supportedRomsFact(US_GEN5_REV0)}<div><span>Version</span><strong>${summaryStatStatus.availableVersion ?? SUMMARY_STAT_VIEWER_VERSION}</strong></div></div>
          ${summaryStatStatus.message ? `<p>${escapeHtml(summaryStatStatus.message)}</p>` : ""}
          <label><input type="checkbox" id="summary-stat-evs" ${summaryStatStatus.options.includeEvs ? "checked" : ""} ${summaryStatStatus.compatible ? "" : "disabled"}> Include EV view</label>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-summary-stat-btn" type="button" ${summaryStatStatus.compatible ? "" : "disabled"}>${summaryStatStatus.updateAvailable ? "Update Viewer" : summaryStatStatus.installed ? "Apply Settings" : "Install Summary IV/EV Viewer"}</button>
            <button class="btn -default" id="uninstall-summary-stat-btn" type="button" ${summaryStatStatus.canUninstall ? "" : "disabled"}
              title="${summaryStatStatus.installed && !summaryStatStatus.canUninstall ? "A DLL built into the loaded ROM cannot yet be removed." : "Remove the staged viewer."}">Remove</button>
            <div class="code-injection-note" id="summary-stat-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(menuEvolutionStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>${MENU_EVOLUTION_TITLE}</h2>
              <p>Adds EVOLVE and RELEARN party commands, post-battle KO evolution, and immediate KO-threshold moves. Installs or updates the required Trainer Battle Log automatically.</p>
            </div>
            ${renderInlineStatus(menuEvolutionStatus.updateAvailable
                  ? "Update Available"
                  : menuEvolutionStatus.upToDate
                  ? "Installed"
                  : !menuEvolutionStatus.supported
                    ? "Unsupported"
                    : menuEvolutionCanInstall
                        ? "Ready"
                        : "Incompatible", { className: "code-injection-status" })}
          </div>
          ${renderPatchShowcase("party")}
          <div class="code-injection-facts">
            ${supportedRomsFact(US_GEN5)}
            <div><span>Methods</span><strong>Level, KOs, Battles, Used</strong></div>
            <div><span>KO Moves</span><strong>32 per Pokémon</strong></div>
            <div><span>Relearn</span><strong>Current level + earned KOs</strong></div>
            <div><span>Trainer Battle Log</span><strong>${battleLogStatus.upToDate ? "Installed" : battleLogStatus.compatible ? battleLogStatus.installed ? "Will Update" : "Will Install" : "Incompatible"}</strong></div>
            <div><span>PMC</span><strong>${menuEvolutionStatus.pmcInstalled ? "Installed" : "Will Install"}</strong></div>
            <div><span>Hook Checks</span><strong>${menuEvolutionStatus.checked ? `${menuEvolutionStatus.passed}/${menuEvolutionStatus.checks.length}` : "On install"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-menu-evolution-btn" type="button" ${menuEvolutionCanInstall ? "" : "disabled"}>
              ${menuEvolutionStatus.updateAvailable ? "Update" : menuEvolutionStatus.installed ? "Reinstall" : "Install"}
            </button>
            <button class="btn -default" id="uninstall-menu-evolution-btn" type="button" ${menuEvolutionCanUninstall ? "" : "disabled"}
              title="${menuEvolutionStatus.installed && !menuEvolutionCanUninstall ? "A DLL already built into the loaded ROM cannot be removed yet." : `Remove the staged ${MENU_EVOLUTION_TITLE} DLL.`}">
              Uninstall
            </button>
            <div class="code-injection-note" id="menu-evolution-note" aria-live="polite"></div>
          </div>
          <div class="code-injection-actions party-toolbar-settings" ${partyTools.supported ? "" : "hidden"}>
            <p>Party Toolbar: Leveling, Edging, Pre-dmg, Pre-status, Heal Team<br>Press L to access or use Touch screen</p>
            <div class="party-toolbar-flag">
              <label for="party-tools-hide-flag">Hide toolbar when save flag is set (optional)</label>
              <input id="party-tools-hide-flag" type="text" value="${partyTools.hideFlag === null ? "" : `0x${partyTools.hideFlag.toString(16).toUpperCase().padStart(4, "0")}`}" placeholder="None — always available" spellcheck="false" ${partyTools.compatible ? "" : "disabled"}>
            </div>
            <fieldset class="party-toolbar-section-flags">
              <legend>Hide sections when save flag is set (optional)</legend>
              ${PARTY_TOOLBAR_SECTIONS.map(({ id, label }) => `<div class="party-toolbar-flag">
                <label for="party-tools-${id}-hide-flag">${label}</label>
                <input id="party-tools-${id}-hide-flag" type="text" value="${partyTools.sectionHideFlags[id] === null ? "" : `0x${partyTools.sectionHideFlags[id]!.toString(16).toUpperCase().padStart(4, "0")}`}" placeholder="None — always available" spellcheck="false" ${partyTools.compatible ? "" : "disabled"}>
              </div>`).join("")}
            </fieldset>
            <button class="btn -primary" id="install-party-tools-btn" type="button" ${partyTools.compatible && partyTools.candyCompatible ? "" : "disabled"}>${partyTools.updateAvailable ? "Update Toolbar" : partyTools.installed ? "Enable / Reinstall Toolbar" : "Install Party Toolbar"}</button>
            <button class="btn -default" id="disable-party-tools-btn" type="button" ${partyTools.installed && partyTools.enabled && partyTools.compatible ? "" : "disabled"}>Disable Toolbar</button>
            <div class="party-toolbar-status" id="party-tools-status" aria-live="polite">${escapeHtml(partyTools.message)}</div>
          </div>
        </section>
        ${battleUiCards[0] ?? ""}
        <section class="code-injection-panel" ${patchVisibility(learnsetStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Party Menu Learnset/Dex Viewer</h2>
            </div>
            ${renderInlineStatus(learnsetStatus.partial ? "Incomplete" : learnsetStatus.updateAvailable ? "Update Available" : learnsetStatus.installed ? "Installed" : learnsetStatus.compatible ? "Ready" : learnsetStatus.supported ? "Incompatible" : "Unsupported", { className: "code-injection-status" })}
          </div>
          ${canChooseLearnsetLayout ? `<div class="type-icon-variant-previews learnset-layout-previews" role="group" aria-label="Learnset top screen layout">
            ${learnsetLayouts.map(({ layout, label, bw1, bw2 }) => `<button type="button" class="type-icon-variant-preview ${learnsetUpperLayout === layout ? "is-selected" : ""}" data-learnset-upper-layout="${layout}" aria-pressed="${learnsetUpperLayout === layout}">
              <span class="type-icon-variant-caption">${label}</span>
              <img src="${project.session.baseRom === "BW" ? bw1 : bw2}" alt="" width="256" height="192" loading="lazy" decoding="async">
            </button>`).join("")}
          </div>` : renderPatchShowcase("learnset")}
          <div class="code-injection-facts">
            ${supportedRomsFact(US_GEN5_REV0)}
            <div><span>Dependency</span><strong>PMC only</strong></div>
            <div><span>Full party menu</span><strong>LEARNSET is hidden</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-learnset-viewer-btn" type="button" ${learnsetStatus.supported && learnsetStatus.compatible ? "" : "disabled"}>${learnsetInstallLabel()}</button>
            <button class="btn -default" id="uninstall-learnset-viewer-btn" type="button" ${learnsetStatus.canUninstall ? "" : "disabled"} title="Only staged companions can be removed; built-in ROM files cannot yet be deleted.">Uninstall</button>
            <div class="code-injection-note" id="learnset-viewer-note" aria-live="polite"></div>
          </div>
          <div class="code-injection-credits" aria-label="Party Menu Learnset/Dex Viewer credits">
            <span>Designed in collaboration with</span>
            <strong>TrustyPeaches</strong>
          </div>
        </section>
        ${battleUiCards[1] ?? ""}
        <section class="code-injection-panel" ${patchVisibility(quickActionsStatus.supported)}>
          <div class="code-injection-panel__header"><div>
            <h2>C-Gear Quick Actions</h2>
            <a class="btn -primary" href="#cgearButtons" data-route="cgearButtons">Configure Buttons</a>
            <p>Add QoL shortcuts to C-Gear</p>
          </div>${renderInlineStatus(!quickActionsStatus.supported ? "Unsupported" : !quickActionsStatus.compatible ? "Incompatible" : quickActionsStatus.enabled ? "Enabled" : quickActionsStatus.installed ? "Disabled" : "Ready", { className: "code-injection-status" })}</div>
          <div class="code-injection-facts">${supportedRomsFact(US_GEN5_REV0)}
            <div><span>Dependency</span><strong>PMC only</strong></div>${quickActionsStatus.romProfile === "redux" ? '<div><span>ROM profile</span><strong>Redux</strong></div>' : ""}<div><span>Release</span><strong>${escapeHtml(project.session.baseRom==="BW"?CGEAR_QUICK_ACTIONS_BW1_VERSION:quickActionsStatus.runtimeVersion??CGEAR_QUICK_ACTIONS_VERSION)} development</strong></div></div>
          <img src="${project.session.baseRom==="BW"?new URL("../assets/codeinjection/cgearQuickActionsBw1Preview.png", import.meta.url).href:new URL("../assets/codeinjection/cgearQuickActionsPreview.png", import.meta.url).href}" alt="Editable C-Gear action button layout." width="256" height="192" style="max-width:100%;width:384px;height:auto;image-rendering:pixelated" />
          ${quickActionsStatus.message ? `<p>${escapeHtml(quickActionsStatus.message)}</p>` : ""}
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-cgear-quick-actions-btn" type="button" ${quickActionsStatus.compatible ? "" : "disabled"}>${quickActionsStatus.installed ? "Update / Enable" : "Install"}</button>
            <button class="btn -default" id="disable-cgear-quick-actions-btn" type="button" ${quickActionsStatus.compatible && quickActionsStatus.enabled ? "" : "disabled"}>Disable</button>
            <button class="btn -default" id="remove-cgear-quick-actions-btn" type="button" ${quickActionsStatus.canRemove ? "" : "disabled"} title="Exported installations can be disabled; only newly staged modules can be removed.">Remove staged patch</button>
            <div class="code-injection-note" id="cgear-quick-actions-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(pokenavStatus.supported)}>
          <div class="code-injection-panel__header"><div><h2>Pokenav</h2>
            <p>Browse the current area's seasonal Surf, Rod, and Grass encounters from a custom C-Gear button. The top screen shows species information and the selected Pokémon's combined encounter chance. All species are revealed.</p></div>
            ${renderInlineStatus(pokenavStatus.updateAvailable ? "Update Available" : pokenavStatus.enabled ? "Enabled" : pokenavStatus.installed ? "Disabled" : pokenavStatus.compatible ? "Ready" : "Incompatible", { className: "code-injection-status" })}
          </div>
          ${renderSupportedRoms(US_BW2_REV0)}
          ${renderPatchShowcase("pokenav")}
          <p>${escapeHtml(pokenavStatus.message)}</p>
          <div class="code-injection-actions">
            <a class="btn -default" href="#cgearButtons" data-route="cgearButtons">Configure Buttons</a>
            <button class="btn -primary" id="install-pokenav-btn" type="button" ${pokenavStatus.compatible ? "" : "disabled"}>${pokenavStatus.updateAvailable ? "Update" : pokenavStatus.installed ? "Enable / Reinstall" : "Install"}</button>
            <button class="btn -default" id="disable-pokenav-btn" type="button" ${pokenavStatus.compatible && pokenavStatus.enabled ? "" : "disabled"}>Disable</button>
            <div class="code-injection-note" id="pokenav-note" aria-live="polite"></div>
          </div>
        </section>
        </section>
        <section class="code-injection-tab-panel" id="code-injection-panel-quality-of-life" role="tabpanel" aria-labelledby="code-injection-tab-quality-of-life" tabindex="0" ${activeTab === "quality-of-life" ? "" : "hidden"}>
        <section class="code-injection-panel" ${patchVisibility(quickPokeBall.supported)}>
          <div class="code-injection-panel__header">
            <div><h2>Quick Poké Ball</h2><p>Wild singles only. Tap L to throw. Hold L + D-pad to cycle. Press B while holding L to cancel.</p></div>
            ${renderInlineStatus(!quickPokeBall.supported ? "Unsupported" : !quickPokeBall.compatible ? "Incompatible" : quickPokeBall.updateAvailable ? "Update Available" : quickPokeBall.installed ? "Installed" : "Ready", { className: "code-injection-status" })}
          </div>
          ${renderSupportedRoms(US_GEN5_REV0)}
          ${renderPatchShowcase("quickPokeBall")}
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-quick-poke-ball-btn" type="button" ${quickPokeBall.compatible ? "" : "disabled"}>${quickPokeBall.updateAvailable ? "Update" : quickPokeBall.installed ? "Reinstall" : "Install"}</button>
            <button class="btn -default" id="uninstall-quick-poke-ball-btn" type="button" ${quickPokeBall.canUninstall ? "" : "disabled"}>Remove staged patch</button>
            <div class="code-injection-note" id="quick-poke-ball-note" aria-live="polite"></div>
          </div>
          ${quickPokeBall.message && !quickPokeBall.installed ? `<div class="code-injection-note">${escapeHtml(quickPokeBall.message)}</div>` : ""}
        </section>
        ${testingPatchCard("instant-fast-text")}
        <section class="code-injection-panel" ${patchVisibility(bgmToggleSupported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Background Music Toggle</h2>
              <p>Press L + R + Select to mute or unmute background music in the overworld and battles. Sound effects, cries, and scripted game pauses are unchanged.</p>
            </div>
            ${renderInlineStatus(bgmToggleStatus === "patched" ? "Installed" : bgmToggleStatus === "unsupported" ? "Unsupported" : "Ready", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            ${supportedRomsFact(US_GEN5)}
            <div><span>Shortcut</span><strong>L + R + Select</strong></div>
            <div><span>Scope</span><strong>Overworld + Battles</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-bgm-toggle-btn" type="button" ${bgmToggleSupported ? "" : "disabled"}>
              ${bgmToggleStatus === "patched" ? "Reinstall Music Toggle" : "Install Music Toggle"}
            </button>
            <div class="code-injection-note" id="bgm-toggle-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(shinyOddsStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Shiny Odds</h2>
              <p>Wild Pokémon · Base odds before Shiny Charm and Pass Power</p>
              ${shinyOddsStatus.message ? `<p>${escapeHtml(shinyOddsStatus.message)}</p>` : ""}
            </div>
            ${renderInlineStatus(shinyOddsStatus.rolls !== undefined ? "Installed" : shinyOddsStatus.compatible ? "Ready" : "Unavailable", { className: "code-injection-status" })}
          </div>
          ${renderSupportedRoms(US_GEN5_REV0)}
          <div class="code-injection-actions">
            <label>PID rolls <input id="shiny-odds-rolls" type="number" min="1" max="${SHINY_ODDS_MAX_ROLLS}" step="1" required value="${shinyOddsStatus.rolls ?? 1}" ${shinyOddsStatus.compatible ? "" : "disabled"}></label>
            <output id="shiny-odds-preview" for="shiny-odds-rolls">${formatShinyOdds(shinyOddsStatus.rolls ?? 1)}</output>
            <button class="btn -primary" id="apply-shiny-odds-btn" type="button" disabled>Apply Odds</button>
            <div class="code-injection-note" id="shiny-odds-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(bw2ApFix !== "unsupported")}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Black 2 / White 2 AP Fix</h2>
              <p>Applies the AP fix to the current ROM code on export.</p>
            </div>
            ${renderInlineStatus({ unsupported: "Unsupported", ready: "Off", enabled: "Enabled" }[bw2ApFix], { className: "code-injection-status" })}
          </div>
          ${renderSupportedRoms(US_BW2)}
          <div class="code-injection-actions">
            <button class="btn -primary" id="apply-bw2-ap-fix-btn" type="button" ${bw2ApFix === "unsupported" ? "disabled" : ""}>
              ${bw2ApFix === "enabled" ? "Disable on Export" : "Enable on Export"}
            </button>
            <div class="code-injection-note" id="bw2-ap-fix-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(challengeStats.state !== "unsupported")}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Challenge Mode Stat Fix</h2>
              <p>Recalculates opposing Pokémon’s stats at their adjusted levels in Easy and Challenge Mode.</p>
              ${challengeStats.message ? `<p>${escapeHtml(challengeStats.message)}</p>` : ""}
            </div>
            ${renderInlineStatus({ unsupported: "Unsupported", unavailable: "Unavailable", ready: "Ready", installed: "Installed" }[challengeStats.state], { className: "code-injection-status" })}
          </div>
          ${renderSupportedRoms(US_BW2_REV0)}
          <div class="code-injection-actions">
            <button class="btn -primary" id="apply-challenge-stats-btn" type="button" ${challengeStats.state === "ready" ? "" : "disabled"}>Apply Stat Fix</button>
            <div class="code-injection-note" id="challenge-stats-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(earlyChallengeMode.state !== "unsupported")}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Early Challenge Mode</h2>
              <p>Makes Challenge Mode selectable in Unova Link before starting a new game.</p>
              ${earlyChallengeMode.message ? `<p>${escapeHtml(earlyChallengeMode.message)}</p>` : ""}
            </div>
            ${renderInlineStatus({ unsupported: "Unsupported", unavailable: "Unavailable", ready: "Ready", installed: "Installed" }[earlyChallengeMode.state], { className: "code-injection-status" })}
          </div>
          ${renderSupportedRoms(US_BW2_REV0)}
          <div class="code-injection-actions">
            <button class="btn -primary" id="apply-early-challenge-btn" type="button" ${earlyChallengeMode.state === "ready" ? "" : "disabled"}>Apply Patch</button>
            <div class="code-injection-note" id="early-challenge-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(earlyNationalDex.state !== "unsupported")}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Early National Pokédex</h2>
              <p>Unlocks the National Pokédex and Habitat List when Bianca gives you the Pokédex.</p>
              ${earlyNationalDex.message ? `<p>${escapeHtml(earlyNationalDex.message)}</p>` : ""}
            </div>
            ${renderInlineStatus({ unsupported: "Unsupported", unavailable: "Unavailable", ready: "Ready", installed: "Installed" }[earlyNationalDex.state], { className: "code-injection-status" })}
          </div>
          ${renderSupportedRoms(US_BW2_REV0)}
          <div class="code-injection-actions">
            <button class="btn -primary" id="apply-early-national-dex-btn" type="button" ${earlyNationalDex.state === "ready" ? "" : "disabled"}>Apply Patch</button>
            <div class="code-injection-note" id="early-national-dex-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(forgettableHmsSupported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Forgettable HMs</h2>
              <p>Lets the move deleter, level-up and TM move replacement screens forget HM moves. A small PMC module replaces the HM check at load time; the ROM's ARM9 code is left unchanged. Black / White use the ARM9 patch on the Patches page.</p>
            </div>
            ${renderInlineStatus(forgettableHmsStatus === "patched" ? "Installed" : forgettableHmsStatus === "legacy" ? "Migration Available" : forgettableHmsStatus === "unknown" ? "Signature Unknown" : forgettableHmsStatus === "unsupported" ? "Unsupported" : "Ready", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            ${supportedRomsFact(`${US_BW2} · Italian White 2`)}
            <div><span>Hook</span><strong>PML_MoveIsHM</strong></div>
            <div><span>ARM9</span><strong>${forgettableHmsStatus === "legacy" ? "Inline edit restored" : "Unchanged"}</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-forgettable-hms-btn" type="button" ${forgettableHmsStatus === "unpatched" || forgettableHmsStatus === "legacy" ? "" : "disabled"}${forgettableHmsStatus === "unknown" ? ' title="Could not find the Black 2 / White 2 HM check in ARM9. This ROM may have a different patch or code layout."' : ""}>
              ${forgettableHmsStatus === "patched" ? "Forgettable HMs Installed" : forgettableHmsStatus === "legacy" ? "Migrate to PMC" : "Install Forgettable HMs"}
            </button>
            <div class="code-injection-note" id="forgettable-hms-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(bw1HmStatus !== "unsupported")}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Make HM Moves Forgettable</h2>
              <p>Lets the move deleter and move replacement screens forget HM moves using an ARM9 edit.</p>
            </div>
            ${renderInlineStatus(bw1HmStatus === "patched" ? "Installed" : bw1HmStatus === "unsupported" ? "Unsupported" : bw1HmStatus === "unknown" ? "Signature Unknown" : "Ready", { className: "code-injection-status" })}
          </div>
          ${renderSupportedRoms("Black and White")}
          <div class="code-injection-actions">
            <button class="btn -primary" id="make-hms-forgettable-btn" type="button" ${bw1HmStatus === "unpatched" ? "" : "disabled"}>${bw1HmStatus === "patched" ? "HMs Forgettable" : "Make HMs Forgettable"}</button>
            <div class="code-injection-note" id="bw1-hms-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(autorunStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Autorun</h2>
              <p>Once the player has the Running Shoes, moving runs without holding B; holding B walks (and turns in place). Adds an Autorun On/Off row to the in-game Options screen${project.session.baseRom === "BW2" ? ", below Following Pokémon's row when both are installed" : ""}. Existing saves start with Autorun on.</p>
            </div>
            ${renderInlineStatus(!autorunStatus.supported ? "Unsupported" : autorunStatus.installed ? autorunStatus.updateAvailable ? "Update Available" : "Installed" : autorunStatus.compatible ? "Ready" : "Incompatible", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            ${supportedRomsFact(US_GEN5_REV0)}
            <div><span>Walk</span><strong>Hold B</strong></div>
            <div><span>Options row</span><strong>${autorunStatus.optionsRow ? autorunStatus.sharedWithFollowing ? "With Followers" : "Installed" : "Will Install"}</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-autorun-btn" type="button" ${autorunStatus.compatible && (!autorunStatus.installed || autorunStatus.updateAvailable) ? "" : "disabled"}${autorunStatus.compatible || !autorunStatus.message ? "" : ` title="${escapeHtml(autorunStatus.message)}"`}>
              ${autorunStatus.installed ? autorunStatus.updateAvailable ? "Update Autorun" : "Autorun Installed" : "Install Autorun"}
            </button>
            <button class="btn -default -remove" id="uninstall-autorun-btn" type="button" ${autorunStatus.canUninstall ? "" : "disabled"}>Uninstall Autorun</button>
            <div class="code-injection-note" id="autorun-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(introSkipStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Skip Intro</h2>
              <p>A new game starts in the player's room, in control, right after Professor Juniper's introduction. Skips the Aspertia City flyover, mom's call outside the house and her "I'm home!" scene. Mom waits inside, and the story continues as usual.</p>
            </div>
            ${renderInlineStatus(!introSkipStatus.supported ? "Unsupported" : introSkipStatus.installed ? introSkipStatus.updateAvailable ? "Update Available" : "Installed" : introSkipStatus.compatible ? "Ready" : "Incompatible", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            ${supportedRomsFact(US_BW2_REV0)}
            <div><span>Hooks</span><strong>Overlay 35 new-game events</strong></div>
            <div><span>Saves</span><strong>New games only</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-intro-skip-btn" type="button" ${introSkipStatus.compatible && (!introSkipStatus.installed || introSkipStatus.updateAvailable) ? "" : "disabled"}${introSkipStatus.compatible || !introSkipStatus.message ? "" : ` title="${escapeHtml(introSkipStatus.message)}"`}>
              ${introSkipStatus.installed ? introSkipStatus.updateAvailable ? "Update Skip Intro" : "Skip Intro Installed" : "Install Skip Intro"}
            </button>
            <button class="btn -default -remove" id="uninstall-intro-skip-btn" type="button" ${introSkipStatus.canUninstall ? "" : "disabled"}>Uninstall Skip Intro</button>
            <div class="code-injection-note" id="intro-skip-note" aria-live="polite"></div>
          </div>
        </section>
        </section>
        <section class="code-injection-tab-panel" id="code-injection-panel-major-features" role="tabpanel" aria-labelledby="code-injection-tab-major-features" tabindex="0" ${activeTab === "major-features" ? "" : "hidden"}>
        ${frostbiteSnowCards}
        <section class="code-injection-panel" ${patchVisibility(fairyStatus !== "unsupported")}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Fairy Type Support</h2>
              <p>Adds Fairy as a battle type and updates the supporting battle, move, Pokémon, and text data used by the ROM.</p>
            </div>
            ${renderInlineStatus(fairyStatus === "patched" ? "Installed" : fairyStatus === "unsupported" ? "Unsupported" : "Ready", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            ${supportedRomsFact(US_GEN5)}
            <div><span>Dependencies</span><strong>None</strong></div>
          </div>
          <div class="code-injection-actions">
            <label><input id="fairy-modern-typings-checkbox" type="checkbox" checked> Update Pokémon and move typings</label>
            <button class="btn -primary" id="add-fairy-type-btn" type="button" ${fairyStatus === "unpatched" ? "" : "disabled"}>${fairyStatus === "patched" ? "Fairy Type Installed" : "Add Fairy Type Support"}</button>
            <div class="code-injection-note" id="fairy-type-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(moveExpansionStatus !== "unsupported")}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Move Expansion</h2>
              <p>Expands the ROM to 1,000 move slots, and adds the data for gen 6-9 moves. Only the basic data like base power, accuracy, status effects etc are added, no special move handlers. Fairy Type is installed automatically.</p>
              <p>You can optionally choose to install move animations as well which have been compiled from existing gen 5 romhacks and the community.</p>
            </div>
            ${renderInlineStatus(moveExpansionStatus === "patched" ? "Installed" : moveExpansionStatus === "routing-only" ? "Routing Only" : moveExpansionStatus === "unsupported" ? "Unsupported" : moveExpansionStatus === "unknown" ? "Incompatible" : "Ready", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            ${supportedRomsFact(US_GEN5)}
            <div><span>Move slots</span><strong>1,000</strong></div>
            <div><span>Dependencies</span><strong>Fairy Type Support (${fairyStatus === "patched" ? "installed" : fairyStatus === "unsupported" ? "not available" : "installed with it"})</strong></div>
          </div>
          <div class="code-injection-actions">
            <label><input id="move-expansion-animations-checkbox" type="checkbox" ${project.patches?.applied?.moveExpansionBundledAnimations || project.patches?.applied?.moveExpansionGen6Animations ? "checked" : ""}> Include Gen 6-9 Animations</label>
            <button class="btn -primary" id="install-move-expansion-btn" type="button" ${moveExpansionStatus === "unsupported" || moveExpansionStatus === "unknown" ? "disabled" : ""}>${moveExpansionStatus === "patched" ? "Update Move Expansion" : "Install Move Expansion"}</button>
            <div class="code-injection-note" id="move-expansion-note" aria-live="polite"></div>
          </div>
          <div class="code-injection-credits" aria-label="Move animation credits">
            <span>Move animation credits</span>
            ${moveAnimationCredits.map(({ author, count }) => `<strong>${escapeHtml(author)} (${count})</strong>`).join("")}
          </div>
        </section>
        ${abilityStatus ? `<section class="code-injection-panel" ${patchVisibility(abilityStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Ability Expansion</h2>
              <p>Adds the Gen 6-9 abilities you choose from the ability library as new abilities, with their names, descriptions and effects. Effects are built from the library's ability rules, so some are approximations; you can edit any of them in the Abilities editor afterwards.</p>
            </div>
            ${renderInlineStatus(!abilityStatus.supported ? "Unsupported" : abilityStatus.installed >= abilityRows.length ? "Installed" : abilityStatus.installed ? "Partly Installed" : "Ready", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            ${supportedRomsFact(US_GEN5)}
            <div><span>Abilities</span><strong>${abilityRows.length} in the library</strong></div>
            <div><span>Installed</span><strong>${abilityStatus.installed || "—"}</strong></div>
            <div><span>Free ability IDs</span><strong>${abilityStatus.freeSlots}</strong></div>
            <div><span>Dependencies</span><strong>None</strong></div>
          </div>
          <details class="code-injection-ability-picker" open>
            <summary>Abilities (<span id="ability-expansion-count">0</span> selected)</summary>
            <div class="code-injection-ability-filters" role="group" aria-label="Filter abilities by generation">
              ${["all", "6", "7", "8", "9"].map((gen) => `<button class="btn sm" type="button" data-ability-gen="${gen}" aria-pressed="${gen === "all"}">${gen === "all" ? "All" : `Gen ${gen}`}</button>`).join("")}
            </div>
            <div class="code-injection-ability-table">
              <table>
                <thead><tr><th scope="col"><span class="sr-only">Add</span></th><th scope="col">Ability</th><th scope="col">Gen</th><th scope="col">Description</th><th scope="col">Status</th></tr></thead>
                <tbody>${abilityRows.map((row) => `<tr data-ability-row data-gen="${row.generation}" class="${row.installedAs !== undefined ? "-installed" : ""}">
                  <td><input type="checkbox" data-ability-expansion="${row.id}" aria-label="Add ${escapeHtml(row.name)}" ${row.installedAs !== undefined ? "checked disabled" : ""}></td>
                  <td><strong>${escapeHtml(row.label)}</strong>${row.group ? `<small>${escapeHtml(row.group)}</small>` : ""}</td>
                  <td>${row.generation}</td>
                  <td>${escapeHtml(row.description.replace(/\n/gu, " "))}</td>
                  <td>${row.installedAs !== undefined ? `Installed (#${row.installedAs})` : "Not installed"}</td>
                </tr>`).join("")}</tbody>
              </table>
            </div>
          </details>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-ability-expansion-btn" type="button" disabled>Install Selected Abilities</button>
            <button class="btn -default" id="ability-select-all-btn" type="button">Select All Shown</button>
            <button class="btn -default" id="ability-select-none-btn" type="button">Select None</button>
            <div class="code-injection-note" id="ability-expansion-note" aria-live="polite">${abilityStatus.ready ? "" : escapeHtml(abilityStatus.message)}</div>
          </div>
        </section>` : ""}
        ${canUseMegaEvolutionInstaller() ? `<section class="code-injection-panel" ${patchVisibility(megaStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Mega Evolution</h2>
            </div>
            ${renderInlineStatus(!megaStatus.supported ? "Unsupported" : megaStatus.installed ? megaStatus.updateAvailable ? "Update Available" : "Installed" : megaStatus.compatible ? "Ready" : "Incompatible", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            ${supportedRomsFact(US_GEN5)}
            <div><span>Routes</span><strong>${megaStatus.installed ? megaStatus.routes : "—"}</strong></div>
            <div><span>Turn order</span><strong>Generation 7</strong></div>
            <div><span>Dependencies</span><strong>Item Expansion, PWAN GIF Support, Fairy Type Support, Move Expansion (installed with it)</strong></div>
            <div><span>Mega Pokémon</span><strong>${megaContentStatus.installed ? `${megaContentStatus.forms} installed` : megaContentStatus.ready ? "Ready" : "—"}</strong></div>
            <div><span>Universal stones</span><strong>${UNIVERSAL_STONES.map((stone) => escapeHtml(stone.name)).join(", ")}</strong></div>
            <div><span>Credits</span><strong>${MEGA_CREDITS.map((credit) => `${escapeHtml(credit.name)} (${escapeHtml(credit.role)})`).join("; ")}</strong></div>
          </div>
          ${megaConfig ? `<details class="code-injection-mega-routes">
            <summary>Routes (${megaConfig.routes.length}) and messages</summary>
            <table class="code-injection-table">
              <thead><tr><th>Species ID</th><th>Item / move ID</th><th>Move trigger</th><th>Form</th><th>Mega form</th><th></th></tr></thead>
              <tbody id="mega-route-rows">${megaConfig.routes.map((route, index) => `<tr data-mega-route="${index}">
                <td><input type="number" min="1" max="65535" value="${route.species}" data-field="species" aria-label="Route ${index + 1} species ID"></td>
                <td><input type="number" min="1" max="65535" value="${route.trigger}" data-field="trigger" aria-label="Route ${index + 1} trigger ID"></td>
                <td><input type="checkbox" data-field="moveTrigger" ${route.moveTrigger ? "checked" : ""} aria-label="Route ${index + 1} is triggered by a move"></td>
                <td><input type="number" min="0" max="31" value="${route.sourceForm}" data-field="sourceForm" aria-label="Route ${index + 1} form"></td>
                <td><input type="number" min="1" max="31" value="${route.targetForm}" data-field="targetForm" aria-label="Route ${index + 1} Mega form"></td>
                <td><button class="btn -default -remove" type="button" data-remove-mega-route="${index}">Remove</button></td>
              </tr>`).join("")}</tbody>
            </table>
            <div class="code-injection-facts">
              <label><span>“Reacting” message</span><input id="mega-msg-reacting" type="number" min="0" max="65535" value="${megaConfig.messages.reacting}"></label>
              <label><span>“Mega Evolved” message</span><input id="mega-msg-evolved" type="number" min="0" max="65535" value="${megaConfig.messages.evolved}"></label>
              <label><span>“Fervent wish” message</span><input id="mega-msg-wish" type="number" min="0" max="65535" value="${megaConfig.messages.wish}"></label>
              <label><span>Animation</span><input id="mega-animation" type="number" min="0" max="65535" value="${megaConfig.animationMove}" title="0 plays the native form change"></label>
              <label><span>Trainers Mega Evolve</span><input id="mega-auto-foes" type="checkbox" ${megaConfig.autoFoes ? "checked" : ""}></label>
              <label><span>Key item needed</span><input id="mega-ring-item" type="number" min="0" max="1023" value="${megaConfig.ringItem ?? 0}" title="The player Mega Evolves only with this item in the bag (the Mega Ring, ${MEGA_RING_ITEM}); 0: no item needed"></label>
            </div>
          </details>` : ""}
          ${megaContentStatus.supported ? `<details class="code-injection-mega-credits">
            <summary>Mega sprite credits</summary>
            <table class="code-injection-table">
              <thead><tr><th>Mega</th><th>Front</th><th>Back</th></tr></thead>
              <tbody>${megaSpriteCredits().map((credit) => `<tr><td>${escapeHtml(credit.name)}</td><td>${creditHtml(credit.front)}</td><td>${creditHtml(credit.back)}</td></tr>`).join("")}</tbody>
            </table>
          </details>` : ""}
          <div class="code-injection-actions">
            <label class="code-injection-mega-gmax" title="G-Max artwork as Megas, with the base form's stats, types and abilities: ${GMAX_MEGAS.length} Pokémon, each with its own stone (Venusaurite G, Butterfreeite ...)">
              <input type="checkbox" id="mega-gmax" ${gmaxComplete ? "checked disabled" : ""} ${megaContentStatus.supported ? "" : "disabled"}> Include G-Max Megas${megaContentStatus.gmaxForms ? ` (${megaContentStatus.gmaxForms} installed)` : ""}
            </label>
            <button class="btn -primary" id="install-mega-btn" type="button" ${megaInstallEnabled ? "" : "disabled"}${megaInstallEnabled || !megaContentStatus.message ? "" : ` title="${escapeHtml(megaContentStatus.message)}"`}>
              ${megaContentStatus.installed ? megaNeedsUpdate ? "Update Mega Evolution" : "Mega Evolution Installed" : "Install Mega Evolution"}
            </button>
            <button class="btn -default" id="add-mega-route-btn" type="button" ${megaConfig ? "" : "disabled"}>Add Route</button>
            <button class="btn -default" id="save-mega-routes-btn" type="button" ${megaConfig ? "" : "disabled"}>Save Routes</button>
            <button class="btn -default -remove" id="uninstall-mega-btn" type="button" ${megaStatus.canUninstall ? "" : "disabled"}>Uninstall Mega Evolution</button>
            <div class="code-injection-note" id="mega-evolution-note" aria-live="polite"></div>
          </div>
        </section>
        ` : ""}
        ${canUseMegaEvolutionInstaller() ? `<section class="code-injection-panel" ${patchVisibility(regionalStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Regional Forms</h2>
              <p>Adds regional forms of Gen 1-5 Pokémon as alt forms including: stats, types, abilities, level-up moves, TM and tutor moves, evolutions, animated sprites and icons.</p>
            </div>
            ${renderInlineStatus(!regionalStatus.supported ? "Unsupported" : regionalStatus.installedForms ? regionalStatus.installedForms >= REGIONAL_FORMS.length ? "Installed" : "Partly Installed" : "Ready", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            ${supportedRomsFact(US_GEN5)}
            <div><span>Forms</span><strong>${REGIONAL_FORMS.length} in ${families.length} families</strong></div>
            <div><span>Installed</span><strong>${regionalStatus.installedForms || "—"}</strong></div>
            <div><span>Dependencies</span><strong>Fairy Type Support, Move Expansion, PWAN GIF Support, Added-Form Evolution Support (installed with it)</strong></div>
            <div><span>Sprites</span><strong>PWAN library</strong></div>
          </div>
          <details class="code-injection-regional-families" open>
            <summary>Families (${families.filter((family) => family.installed.length < family.forms.length).length} to install)</summary>
            <p class="code-injection-regional-hint">Uncheck a family you already made your own forms for. Abilities the ability library can't add keep the base form's; moves the ROM doesn't have are left out.</p>
            <div class="code-injection-regional-list">${families.map((family) => {
              const done = family.installed.length === family.forms.length;
              return `<label class="${family.otherForms.length ? "-warning" : ""}"><input type="checkbox" data-regional-family="${family.id}" ${done ? "disabled" : "checked"}>
                <span><strong>${escapeHtml(family.name)}</strong> ${escapeHtml(family.forms.map((form) => form.name).join(", "))}${done ? " (installed)" : family.installed.length ? ` (${family.installed.length} installed)` : ""}${family.otherForms.length ? `<em>Has added forms: ${escapeHtml(family.otherForms.join(", "))}</em>` : ""}</span></label>`;
            }).join("")}</div>
          </details>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-regional-forms-btn" type="button" ${regionalStatus.ready ? "" : "disabled"}>Install Regional Forms</button>
            <button class="btn -default" id="regional-select-all-btn" type="button">Select All</button>
            <button class="btn -default" id="regional-select-none-btn" type="button">Select None</button>
            <div class="code-injection-note" id="regional-forms-note" aria-live="polite">${regionalStatus.ready ? "" : escapeHtml(regionalStatus.message)}</div>
          </div>
        </section>` : ""}
        ${canUseSpeciesExpansionInstaller() ? `<section class="code-injection-panel" ${patchVisibility(speciesStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Species Expansion</h2>
              <p>Adds the Pokémon after Genesect (national 650 onward) as new species including: stats, types, abilities, level-up moves, TM and tutor moves, evolutions, animated sprites, icons and Pokédex entries. Experimental: available only when Pokeweb runs locally.</p>
            </div>
            ${renderInlineStatus(!speciesStatus.supported ? "Unsupported" : !speciesStatus.installed ? "Ready" : speciesStatus.ready ? "Partly Installed" : "Installed", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            ${supportedRomsFact(US_BW2)}
            <div><span>Installed</span><strong>${speciesStatus.installed ? `${speciesStatus.count} of ${speciesTotal} species` : "—"}</strong></div>
            <div><span>Numbering</span><strong>ROM species = national + 37 (Chespin is 687), installed or not; summaries and the PC show national numbers</strong></div>
            <div><span>Dependencies</span><strong>Fairy Type Support, Move Expansion, PWAN GIF Support (installed with it)</strong></div>
            <div><span>Sprites</span><strong>PWAN library</strong></div>
            <div><span>Cries</span><strong>Reused from similar Pokémon</strong></div>
          </div>
          ${speciesFamilies.length ? `<details class="code-injection-species-picker"${speciesStatus.ready ? " open" : ""}>
            <summary>Species (<span id="species-expansion-count">0</span> selected)</summary>
            <p class="code-injection-species-hint">Pick whole evolution lines or single species. Species you leave out can be added later; an evolution into one of them starts working once it's installed. Species can't be removed once installed.</p>
            <div class="code-injection-ability-filters" role="group" aria-label="Filter species by generation">
              ${["all", "6", "7", "8", "9"].map((gen) => `<button class="btn sm" type="button" data-species-gen="${gen}" aria-pressed="${gen === "all"}">${gen === "all" ? "All" : `Gen ${gen}`}</button>`).join("")}
              <input class="code-injection-species-search" id="species-expansion-search" type="search" placeholder="Find a Pokémon" aria-label="Find a Pokémon">
            </div>
            <div class="code-injection-species-list">
              ${speciesFamilies.map((family) => `<div class="code-injection-species-family" data-species-family="${family.family}" data-gen="${family.generation}" data-names="${escapeHtml(family.members.map((member) => member.name.toLowerCase()).join(" "))}">
                <label class="code-injection-species-family__toggle"><input type="checkbox" data-species-family-toggle="${family.family}" ${family.members.every((member) => member.installed) ? "checked disabled" : ""}> <strong>${escapeHtml(family.label)}</strong></label>
                <div class="code-injection-species-members">${family.members.map((member) => `<label class="${member.installed ? "-installed" : ""}"><input type="checkbox" data-species-expansion="${member.national}" ${member.installed ? "checked disabled" : speciesStatus.installed ? "" : "checked"}> <span>#${member.national}</span> ${escapeHtml(member.name)}</label>`).join("")}</div>
              </div>`).join("")}
            </div>
          </details>` : ""}
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-species-expansion-btn" type="button" ${speciesStatus.ready ? "" : "disabled"}>${!speciesStatus.installed ? "Install Selected Species" : speciesStatus.ready ? "Add Selected Species" : "Species Expansion Installed"}</button>
            ${speciesStatus.ready && speciesFamilies.length ? `<button class="btn -default" id="species-select-all-btn" type="button">Select All Shown</button>
            <button class="btn -default" id="species-select-none-btn" type="button">Select None</button>` : ""}
            <div class="code-injection-note" id="species-expansion-note" aria-live="polite">${speciesStatus.ready ? "" : escapeHtml(speciesStatus.message)}</div>
          </div>
        </section>` : ""}
        </section>
        <section class="code-injection-tab-panel" id="code-injection-panel-add-ons" role="tabpanel" aria-labelledby="code-injection-tab-add-ons" tabindex="0" ${activeTab === "add-ons" ? "" : "hidden"}>
        <section class="code-injection-panel" ${patchVisibility(pwtSixPokemonStatus !== "unsupported")}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Six-Pokémon PWT</h2>
              <p>Repeatable built-in tournaments use six Pokémon per side in every battle format.</p>
            </div>
            ${renderInlineStatus(pwtSixPokemonStatus === "installed" ? "Installed" : pwtSixPokemonStatus === "ready" ? "Ready" : "Unsupported", { className: "code-injection-status" })}
          </div>
          ${renderSupportedRoms(US_BW2_REV0)}
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-pwt-six-pokemon-btn" type="button" ${pwtSixPokemonStatus === "ready" ? "" : "disabled"}>Install Six-Pokémon PWT</button>
            <div class="code-injection-note" id="pwt-six-pokemon-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(pwtAbilityStatus !== "unsupported")}>
          <div class="code-injection-panel__header">
            <div><h2>PWT Ability Selection</h2><p>Choose an ability for each trainer and rental set in the PWT editor.</p></div>
            ${renderInlineStatus(pwtAbilityStatus === "installed" ? "Installed" : pwtAbilityStatus === "ready" ? "Ready" : "Unsupported", { className: "code-injection-status" })}
          </div>
          ${renderSupportedRoms(US_BW2_REV0)}
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-pwt-ability-btn" type="button" ${pwtAbilityStatus === "ready" ? "" : "disabled"}>Install PWT Ability Selection</button>
            <div class="code-injection-note" id="pwt-ability-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(infiniteCandyStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Infinite Rare Candy</h2>
              <p>Adds a reusable level-up item to Key Items. Grant the selected item through an event or save editor.</p>
            </div>
            <span id="infinite-candy-status">${renderInlineStatus(infiniteCandyStatus.installed ? "Installed" : infiniteCandyStatus.compatible ? "Ready" : infiniteCandyStatus.supported ? "Incompatible" : "Unsupported", { className: "code-injection-status" })}</span>
          </div>
          <div class="code-injection-facts">
            ${supportedRomsFact(US_GEN5_REV0)}
            <label><span>Item ID</span><input id="infinite-candy-item-id" type="number" min="1" max="638" step="1" value="${infiniteCandyItemId}" aria-label="Infinite Candy item ID" aria-describedby="infinite-candy-note" ${project.session.baseRom === "BW" || infiniteCandyStatus.installed ? "readonly" : ""}></label>
            <div><span>Bag</span><strong>Key Items</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-infinite-candy-btn" type="button" ${infiniteCandyStatus.compatible ? "" : "disabled"}>
              ${infiniteCandyStatus.installed ? "Reinstall Infinite Candy" : "Install Infinite Candy"}
            </button>
            <div class="code-injection-note" id="infinite-candy-note" aria-live="polite">${infiniteCandyStatus.compatible ? "" : escapeHtml(infiniteCandyStatus.message)}</div>
            <div class="code-injection-credits">Item behavior adapted from PW2Code by Dararo.</div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(levelCapsStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Hard Level Caps</h2>
              <p>Caps battle EXP and Day Care growth at the level set by <code>EventWorks.Set(16415, level)</code>. Infinite Candy respects the cap; regular Rare Candy can still reach level 100.</p>
            </div>
            ${renderInlineStatus(levelCapsStatus.updateAvailable ? "Update Available" : levelCapsStatus.installed ? "Installed" : levelCapsStatus.compatible ? "Ready" : levelCapsStatus.supported ? "Incompatible" : "Unsupported", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            ${supportedRomsFact(US_GEN5_REV0)}
            <div><span>Cap variable</span><strong>16415</strong></div>
            <div><span>Default</span><strong>100</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-level-caps-btn" type="button" ${levelCapsStatus.compatible ? "" : "disabled"}>
              ${levelCapsStatus.updateAvailable ? "Update Hard Level Caps" : levelCapsStatus.installed ? "Reinstall Hard Level Caps" : "Install Hard Level Caps"}
            </button>
            <div class="code-injection-note" id="level-caps-note" aria-live="polite"></div>
            <div class="code-injection-credits">Adapted from PW2Code by Dararo.</div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(trainerLevelCapsStatus.supported)}>
          <div class="code-injection-panel__header">
            <div><h2>Trainer Level Caps</h2><p>Hard Level Caps companion. Set “Lvl Cap after Win” in a trainer’s settings to update the cap after victory.</p></div>
            ${renderInlineStatus(trainerLevelCapsStatus.installed ? "Installed" : trainerLevelCapsStatus.compatible ? "Ready" : "Unavailable", { className: "code-injection-status", title: trainerLevelCapsStatus.message })}
          </div>
          ${renderSupportedRoms(US_GEN5_REV0)}
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-trainer-level-caps-btn" type="button" ${trainerLevelCapsStatus.compatible && !trainerLevelCapsStatus.installed ? "" : "disabled"}>${trainerLevelCapsStatus.installed ? "Installed" : "Install Trainer Level Caps"}</button>
            <div class="code-injection-note" id="trainer-level-caps-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(trainerFieldStatus.supported)}>
          <div class="code-injection-panel__header"><div><h2>Trainer Field Conditions</h2>
          </div></div>
          <div class="code-injection-facts">${supportedRomsFact(US_BW2_REV0)}<div><span>Dependency</span><strong>PMC only</strong></div></div>
          ${renderTrainerFieldInstaller(trainerFieldStatus)}
        </section>
        <section class="code-injection-panel" ${patchVisibility(nuzlockeStatus.supported)}>
          <div class="code-injection-panel__header"><div><h2>Nuzlocke Style Encounters</h2>
            <p>Exclude evolution families already registered as caught, including released Pokémon. Remaining slots keep their relative chances. Pokenav shows dupes in gray and adjusts its displayed percentages; Pokenav is optional.</p></div>
            ${renderInlineStatus(nuzlockeStatus.updateAvailable ? "Update Available" : nuzlockeStatus.enabled && nuzlockeStatus.installed ? "Enabled" : nuzlockeStatus.installed ? "Disabled" : nuzlockeStatus.compatible ? "Ready" : "Incompatible", { className: "code-injection-status" })}
          </div>
          <p>${escapeHtml(nuzlockeStatus.message)}</p>
          ${renderSupportedRoms(US_BW2_REV0)}
          <label>If every slot is a dupe <select id="nuzlocke-exhausted-select" ${nuzlockeStatus.supported ? "" : "disabled"}>
            <option value="allow" ${nuzlockeStatus.allowExhausted ? "selected" : ""}>Allow the original encounters</option>
            <option value="prevent" ${!nuzlockeStatus.allowExhausted ? "selected" : ""}>Prevent encounters for that method</option>
          </select></label>
          <p>Settings apply with Install / Update. Export and cold boot the ROM to use them. Static, roaming and scripted Pokémon retain their existing rules.</p>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-nuzlocke-encounters-btn" type="button" ${nuzlockeStatus.compatible ? "" : "disabled"}>${nuzlockeStatus.updateAvailable ? "Update" : nuzlockeStatus.installed ? "Enable / Reinstall" : "Install"}</button>
            <button class="btn -default" id="disable-nuzlocke-encounters-btn" type="button" ${nuzlockeStatus.compatible && nuzlockeStatus.enabled && nuzlockeStatus.installed ? "" : "disabled"}>Disable</button>
            <div class="code-injection-note" id="nuzlocke-encounters-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(portaPcStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Porta PC</h2>
              <p>Press Start while exploring to open the in-game PC and access your Pokemon boxes. Supports grid and rail maps, including Castelia City. Uses the normal PC menu and gives other field events priority.</p>
            </div>
            ${renderInlineStatus(!portaPcStatus.supported ? "Unsupported" : !portaPcStatus.compatible ? "Incompatible" : portaPcStatus.updateAvailable ? "Update Available" : portaPcStatus.installed ? "Installed" : "Ready", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            <div><span>Button</span><strong>Start</strong></div>
            ${supportedRomsFact(US_BW2)}
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-porta-pc-btn" type="button" ${portaPcCanInstall ? "" : "disabled"}>
              ${portaPcStatus.updateAvailable ? "Update Porta PC" : "Install Porta PC"}
            </button>
            <button class="btn -default" id="uninstall-porta-pc-btn" type="button" ${portaPcStatus.canUninstall ? "" : "disabled"}
              title="${portaPcStatus.installed && !portaPcStatus.canUninstall ? "A DLL already built into the loaded ROM cannot be removed yet." : "Remove the staged Porta PC DLL."}">
              Uninstall Porta PC
            </button>
            <div class="code-injection-note" id="porta-pc-note" aria-live="polite"></div>
          </div>
        </section>
        </section>
        <section class="code-injection-tab-panel" id="code-injection-panel-debug-helpers" role="tabpanel" aria-labelledby="code-injection-tab-debug-helpers" tabindex="0" ${activeTab === "debug-helpers" ? "" : "hidden"}>
          <section class="code-injection-panel" ${patchVisibility(debugFlag.supported)}>
            <div class="code-injection-panel-header"><div><h2>Debug Save Flag</h2><p>L + R + Y toggles the configured saved flag once per hold in the neutral overworld. Blank disables the shortcut.</p></div></div>
            ${renderSupportedRoms(US_BW2_REV0)}
            <label>Save flag <input id="debug-save-flag" type="text" value="${debugFlag.flag ? `0x${debugFlag.flag.toString(16).toUpperCase()}` : ""}" placeholder="None" spellcheck="false" ${debugFlag.supported ? "" : "disabled"}></label>
            <p>${escapeHtml(debugFlag.message)}</p>
            <div class="code-injection-actions"><button class="btn -primary" id="install-debug-save-flag-btn" ${debugFlag.compatible ? "" : "disabled"}>${debugFlag.installed ? "Apply Changes" : "Install"}</button><div id="debug-save-flag-note" role="status"></div></div>
          </section>
          ${testingPatchCard("walk-through-walls")}
          ${testingPatchCard("instant-victory")}
        </section>
      </main>
    </section>
  `;

  root.querySelectorAll<HTMLElement>(".code-injection-tab-panel").forEach(panel => {
    panel.insertAdjacentHTML("beforeend", emptyCategoryMessage);
  });
  const applyPatchVisibility = (show: boolean): void => {
    root.querySelectorAll<HTMLElement>("[data-code-injection-supported]").forEach(card => {
      card.hidden = !show && card.dataset.codeInjectionSupported === "false";
    });
    root.querySelectorAll<HTMLElement>(".code-injection-tab-panel").forEach(panel => {
      const message = panel.querySelector<HTMLElement>("[data-code-injection-empty]");
      if (message) {
        message.hidden = Array.from(panel.querySelectorAll<HTMLElement>("[data-code-injection-supported]"))
          .some(card => !card.hidden);
      }
    });
  };
  applyPatchVisibility(showUnsupported);
  root.querySelectorAll<HTMLButtonElement>("[data-install-battle-climate]").forEach(button => {
    button.addEventListener("click", async () => {
      const id = button.dataset.installBattleClimate;
      if (id !== "frostbite" && id !== "snow" && id !== "modern_status") return;
      const note = button.parentElement!.querySelector<HTMLElement>("[role=status]")!;
      button.disabled = true;
      note.textContent = frostbiteSnowStatus(project, id).updateAvailable ? "Updating…" : "Installing…";
      try {
        if (await installFrostbiteSnowPatch(project, id)) onDirty();
        renderCodeInjectionEditor(project, root, onDirty);
      } catch (error) {
        note.textContent = error instanceof Error ? error.message : String(error);
        button.disabled = false;
      }
    });
  });
  const unsupportedToggle = root.querySelector<HTMLInputElement>("#show-unsupported-patches");
  unsupportedToggle?.addEventListener("change", () => {
    showUnsupportedCodeInjectionPatches.set(project, unsupportedToggle.checked);
    applyPatchVisibility(unsupportedToggle.checked);
  });

  const tabButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-code-injection-tab]"));
  const selectTab = (tab: CodeInjectionTab, focus = false): void => {
    activeCodeInjectionTabs.set(root, tab);
    for (const button of tabButtons) {
      const selected = button.dataset.codeInjectionTab === tab;
      button.classList.toggle("-active", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    }
    root.querySelectorAll<HTMLElement>(".code-injection-tab-panel").forEach((panel) => {
      panel.hidden = panel.id !== `code-injection-panel-${tab}`;
    });
  };
  tabButtons.forEach((button, index) => {
    button.addEventListener("click", () => selectTab(codeInjectionTabs[index].id));
    button.addEventListener("keydown", (event) => {
      let nextIndex: number;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabButtons.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabButtons.length - 1;
      else return;
      event.preventDefault();
      selectTab(codeInjectionTabs[nextIndex].id, true);
    });
  });

  attachTrainerFieldInstaller(project, root, () => {
    onDirty?.();
    renderCodeInjectionEditor(project, root, onDirty);
  });
  const shinyRolls = root.querySelector<HTMLInputElement>("#shiny-odds-rolls");
  const shinyApply = root.querySelector<HTMLButtonElement>("#apply-shiny-odds-btn");
  const shinyPreview = root.querySelector<HTMLOutputElement>("#shiny-odds-preview");
  const shinyNote = root.querySelector<HTMLElement>("#shiny-odds-note");
  shinyRolls?.addEventListener("input", () => {
    if (shinyApply) shinyApply.disabled = !shinyRolls.validity.valid || shinyRolls.valueAsNumber === (shinyOddsStatus.rolls ?? 1);
    if (shinyPreview) shinyPreview.value = shinyRolls.validity.valid ? formatShinyOdds(shinyRolls.valueAsNumber) : "";
  });
  shinyApply?.addEventListener("click", async () => {
    if (!shinyRolls?.reportValidity()) return;
    const rolls = shinyRolls.valueAsNumber;
    shinyApply.disabled = true;
    shinyRolls.disabled = true;
    if (shinyNote) shinyNote.textContent = "Applying…";
    try {
      const changed = await install(staged => stageShinyOdds(staged, rolls));
      if (changed) onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const note = root.querySelector<HTMLElement>("#shiny-odds-note");
      if (note) note.textContent = "Export the ROM to apply the new odds.";
    } catch (error) {
      shinyApply.disabled = false;
      shinyRolls.disabled = false;
      if (shinyNote) shinyNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  const button = root.querySelector<HTMLButtonElement>("#install-pmc-btn");
  const note = root.querySelector<HTMLDivElement>("#pmc-install-note");
  const expandHeapButton = root.querySelector<HTMLButtonElement>("#expand-pmc-heap-btn");
  const fiveBoxButton = root.querySelector<HTMLButtonElement>("#five-box-pmc-btn");
  fiveBoxButton?.addEventListener("click", async () => {
    fiveBoxButton.disabled = true;
    if (button) button.disabled = true;
    if (expandHeapButton) expandHeapButton.disabled = true;
    if (note) note.textContent = "Verifying the ROM and installed patches…";
    try {
      await setFiveBoxPmcMode(project, !fiveBox.enabled);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshed = root.querySelector<HTMLDivElement>("#pmc-install-note");
      if (refreshed) refreshed.textContent = fiveBox.enabled ? "24 boxes restored. Export and restart from an in-game save."
        : "Five-Box Mode enabled. Export and restart from an in-game save.";
    } catch (error) {
      fiveBoxButton.disabled = false;
      if (button) button.disabled = !status.supported;
      if (expandHeapButton) expandHeapButton.disabled = !heapExpansion.available;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  expandHeapButton?.addEventListener("click", async () => {
    expandHeapButton.disabled = true;
    if (fiveBoxButton) fiveBoxButton.disabled = true;
    if (button) button.disabled = true;
    if (note) note.textContent = "Verifying PMC and installed patches…";
    try {
      await expandPmcHeapAllocation(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshed = root.querySelector<HTMLDivElement>("#pmc-install-note");
      if (refreshed) refreshed.textContent = "Expanded allocation installed. Export and restart from a normal save.";
    } catch (error) {
      expandHeapButton.disabled = !getPmcHeapExpansionStatus(project).available;
      if (fiveBoxButton) fiveBoxButton.disabled = false;
      if (button) button.disabled = !getPmcInstallStatus(project).supported;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  button?.addEventListener("click", async () => {
    const previousText = button.textContent ?? "Install PMC";
    try {
      if (status.installed) {
        const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
        if (!romBytes) throw new Error("Reload the ROM before updating PMC.");
        const confirmation = getPmcUpdateConfirmationMessage(project, romBytes);
        if (confirmation && !window.confirm(confirmation)) {
          if (note) note.textContent = "PMC update cancelled; the existing installation was left unchanged.";
          return;
        }
      }
      button.disabled = true;
      if (fiveBoxButton) fiveBoxButton.disabled = true;
      if (expandHeapButton) expandHeapButton.disabled = true;
      button.textContent = "Installing...";
      if (note) note.textContent = "Installing the runtime and preparing patch folders...";
      const result = await withProjectMutationLock(project, () => installBundledPmc(project));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#pmc-install-note");
      if (refreshedNote) refreshedNote.textContent = `PMC ${result.version ?? "runtime"} installed.`;
    } catch (error) {
      button.disabled = false;
      if (fiveBoxButton) fiveBoxButton.disabled = false;
      if (expandHeapButton) expandHeapButton.disabled = !getPmcHeapExpansionStatus(project).available;
      button.textContent = previousText;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const weatherRuntimeButton = root.querySelector<HTMLButtonElement>("#install-weather-runtime-btn");
  const weatherRuntimeNote = root.querySelector<HTMLDivElement>("#weather-runtime-note");
  weatherRuntimeButton?.addEventListener("click", async () => {
    const previousText = weatherRuntimeButton.textContent ?? "Install Weather Runtime";
    try {
      weatherRuntimeButton.disabled = true;
      weatherRuntimeButton.textContent = "Installing...";
      if (weatherRuntimeNote) weatherRuntimeNote.textContent = status.installed ? "Staging the weather DLL and PWTH registry." : "Installing PMC, then staging the weather DLL and PWTH registry.";
      const result = await install(candidate => installBundledOverworldWeatherRuntime(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#weather-runtime-note");
      if (refreshedNote) refreshedNote.textContent = `${result.fileName} staged at ${result.path}. The 49 PWTH slots are ready for data-driven clones from Weather Graphics.`;
    } catch (error) {
      weatherRuntimeButton.disabled = false;
      weatherRuntimeButton.textContent = previousText;
      if (weatherRuntimeNote) weatherRuntimeNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const pwanButton = root.querySelector<HTMLButtonElement>("#install-pwan-runtime-btn");
  const pwanNote = root.querySelector<HTMLDivElement>("#pwan-runtime-note");
  pwanButton?.addEventListener("click", async () => {
    const previousText = pwanButton.textContent ?? "Install PWAN GIF Support";
    try {
      const compatibility = detectAnimStreamsCompatibility(project);
      if (!compatibility.compatible) {
        if (pwanNote) pwanNote.textContent = pwanCompatibilityFailureSummary(compatibility);
        return;
      }
      pwanButton.disabled = true;
      pwanButton.textContent = "Installing...";
      if (pwanNote) {
        pwanNote.textContent = status.installed ? "Staging the animated sprite streaming runtime." : "Installing PMC and staging the animated sprite streaming runtime.";
      }
      await install(candidate => installPwanRuntime(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#pwan-runtime-note");
      if (refreshedNote) {
        refreshedNote.textContent = "The streaming runtime is staged. Export the ROM to write the animations as streams (an older PWAN archive is converted and removed).";
      }
    } catch (error) {
      pwanButton.disabled = false;
      pwanButton.textContent = previousText;
      if (pwanNote) pwanNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  attachNaturePaletteInstaller(project, root, () => { onDirty(); renderCodeInjectionEditor(project, root, onDirty); });

  const uninstallPwanButton = root.querySelector<HTMLButtonElement>("#uninstall-pwan-runtime-btn");
  uninstallPwanButton?.addEventListener("click", async () => {
    try {
      uninstallPwanButton.disabled = true;
      await uninstallPwanRuntime(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#pwan-runtime-note");
      if (refreshedNote) refreshedNote.textContent = "Animated sprite runtime removed. Imported animations remain in the project for later reinstallation.";
    } catch (error) {
      uninstallPwanButton.disabled = false;
      const currentNote = root.querySelector<HTMLDivElement>("#pwan-runtime-note") ?? pwanNote;
      if (currentNote) currentNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const trainerPwanButton = root.querySelector<HTMLButtonElement>("#install-trainer-pwan-runtime-btn");
  const trainerPwanNote = root.querySelector<HTMLDivElement>("#trainer-pwan-runtime-note");
  trainerPwanButton?.addEventListener("click", async () => {
    const previousText = trainerPwanButton.textContent ?? "Install Trainer PWAN Support";
    try {
      trainerPwanButton.disabled = true;
      trainerPwanButton.textContent = "Installing...";
      if (trainerPwanNote) trainerPwanNote.textContent = "Installing PMC if needed and staging the trainer PWAN runtime.";
      await install(candidate => installTrainerPwanRuntime(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      trainerPwanButton.disabled = false;
      trainerPwanButton.textContent = previousText;
      if (trainerPwanNote) trainerPwanNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  root.querySelector<HTMLButtonElement>("#uninstall-trainer-pwan-runtime-btn")?.addEventListener("click", () => {
    try {
      uninstallTrainerPwanRuntime(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      if (trainerPwanNote) trainerPwanNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const doubleBattleButton = root.querySelector<HTMLButtonElement>("#install-double-battle-fix-btn");
  const doubleBattleNote = root.querySelector<HTMLDivElement>("#double-battle-fix-note");
  doubleBattleButton?.addEventListener("click", async () => {
    const previousText = doubleBattleButton.textContent ?? "Install Double Battle Fix";
    try {
      doubleBattleButton.disabled = true;
      doubleBattleButton.textContent = "Installing...";
      if (doubleBattleNote) doubleBattleNote.textContent = "Loading and staging the bundled double battle patch DLL.";
      const result = await install(candidate => stageBundledDoubleBattleFixDll(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#double-battle-fix-note");
      if (refreshedNote) refreshedNote.textContent = `${result.fileName} staged at ${result.path}.`;
    } catch (error) {
      doubleBattleButton.disabled = false;
      doubleBattleButton.textContent = previousText;
      if (doubleBattleNote) doubleBattleNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const romPatchButton = (buttonId: string, noteId: string, confirmText: string | undefined, apply: () => Promise<RomPatchApplyResult>) => {
    root.querySelector<HTMLButtonElement>(`#${buttonId}`)?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      if (confirmText && !window.confirm(`${confirmText}\n\nExport the ROM after applying to keep this change.`)) return;
      const previousText = button.textContent ?? "";
      button.disabled = true;
      button.textContent = "Applying...";
      try {
        const result = await apply();
        if (result.status !== "already-applied") onDirty();
        renderCodeInjectionEditor(project, root, onDirty);
        const note = root.querySelector(`#${noteId}`);
        if (note) note.textContent = result.summary ?? (result.status === "already-applied" ? "Already applied." : "Applied. Export the ROM to keep it.");
      } catch (error) {
        button.disabled = false;
        button.textContent = previousText;
        const note = root.querySelector(`#${noteId}`);
        if (note) note.textContent = error instanceof Error ? error.message : String(error);
      }
    });
  };
  romPatchButton("apply-bw2-ap-fix-btn", "bw2-ap-fix-note", undefined,
    () => setBw2ApFix(project, bw2ApFix !== "enabled"));
  romPatchButton("apply-challenge-stats-btn", "challenge-stats-note", undefined, () => applyChallengeModeStatsFix(project));
  romPatchButton("apply-ability-storage-fix-btn", "ability-storage-fix-note", undefined, () => applyAbilityStorageFix(project));
  romPatchButton("apply-early-challenge-btn", "early-challenge-note", undefined, () => applyEarlyChallengeMode(project));
  romPatchButton("apply-early-national-dex-btn", "early-national-dex-note", undefined, () => applyEarlyNationalDex(project));
  romPatchButton("add-fairy-type-btn", "fairy-type-note", "Apply this ROM patch to add Fairy Type Support?",
    () => addFairyTypeSupport(project, { updateModernFairyTypings: root.querySelector<HTMLInputElement>("#fairy-modern-typings-checkbox")?.checked ?? true }));
  romPatchButton("make-hms-forgettable-btn", "bw1-hms-note", "Apply this ARM9 patch to make HM moves forgettable?", () => makeHmsForgettable(project));
  romPatchButton("migrate-cascade-personal-btn", "cascade-personal-note", cascadeStatus.abilitiesMigrated
    ? "Import this ROM’s raw Hidden Ability Chance values into zero-valued fields? Existing AI abilities and nonzero chances will be preserved."
    : "Copy this ROM’s injected AI abilities and raw Hidden Ability Chance values into personal data and enable editing?", () => migrateCascadePersonalData(project));

  root.querySelector<HTMLButtonElement>("#install-move-expansion-btn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const includeBundledAnimations = root.querySelector<HTMLInputElement>("#move-expansion-animations-checkbox")?.checked ?? false;
    if (!window.confirm(`Expand this ROM to 1,000 move slots and install the animation-routing hook${fairyStatus === "unpatched" ? " and Fairy Type Support" : ""}${includeBundledAnimations ? ", Gen 6-9 animation scripts, particles, and backgrounds" : ""}?`)) return;
    const previousText = button.textContent ?? "Install Move Expansion";
    button.disabled = true;
    button.textContent = "Installing...";
    try {
      const result = await addMoveExpansion(project, { includeBundledAnimations });
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const note = root.querySelector("#move-expansion-note");
      if (note && result.summary) note.textContent = result.summary;
    } catch (error) {
      button.disabled = false;
      button.textContent = previousText;
      const note = root.querySelector("#move-expansion-note");
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  root.querySelector<HTMLButtonElement>("#install-trainer-natures-btn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      await installTrainerCustomization(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const note = root.querySelector("#trainer-natures-note");
      if (note) note.textContent = "Export the ROM to apply Trainer Customization.";
    } catch (error) {
      button.disabled = false;
      const note = root.querySelector("#trainer-natures-note");
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  root.querySelector<HTMLButtonElement>("#install-form-evolution-btn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      await install(candidate => prepareBw2FormEvolutionCodeInjection(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      button.disabled = false;
      const note = root.querySelector("#form-evolution-note");
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  root.querySelector<HTMLButtonElement>("#install-debug-save-flag-btn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      const flag = parseDebugSaveFlag(root.querySelector<HTMLInputElement>("#debug-save-flag")?.value ?? "");
      await install(candidate => installDebugSaveFlag(candidate, flag));
      onDirty(); renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      button.disabled = false;
      const note = root.querySelector("#debug-save-flag-note");
      if (note) note.textContent = (error as Error).message;
    }
  });
  for (const id of Object.keys(TESTING_PATCHES) as TestingPatchId[]) {
    const button = root.querySelector<HTMLButtonElement>(`#install-${id}-btn`);
    button?.addEventListener("click", async () => {
      button.disabled = true;
      const note = root.querySelector<HTMLDivElement>(`#${id}-note`);
      if (note) note.textContent = "Checking compatibility and installing...";
      try {
        await install(candidate => installTestingPatch(candidate, id));
        onDirty();
        renderCodeInjectionEditor(project, root, onDirty);
      } catch (error) {
        button.disabled = false;
        if (note) note.textContent = error instanceof Error ? error.message : String(error);
      }
    });
    root.querySelector<HTMLButtonElement>(`#uninstall-${id}-btn`)?.addEventListener("click", () => {
      try {
        uninstallTestingPatch(project, id);
        onDirty();
        renderCodeInjectionEditor(project, root, onDirty);
      } catch (error) {
        const note = root.querySelector<HTMLDivElement>(`#${id}-note`);
        if (note) note.textContent = error instanceof Error ? error.message : String(error);
      }
    });
  }

  const bgmToggleButton = root.querySelector<HTMLButtonElement>("#install-bgm-toggle-btn");
  const bgmToggleNote = root.querySelector<HTMLDivElement>("#bgm-toggle-note");
  bgmToggleButton?.addEventListener("click", async () => {
    const previousText = bgmToggleButton.textContent ?? "Install Music Toggle";
    try {
      bgmToggleButton.disabled = true;
      bgmToggleButton.textContent = "Installing...";
      if (bgmToggleNote) bgmToggleNote.textContent = status.installed ? "Staging the background-music toggle DLL." : "Installing PMC, then staging the background-music toggle DLL.";
      const result = await install(candidate => installBundledBgmToggleDll(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#bgm-toggle-note");
      if (refreshedNote) refreshedNote.textContent = `${result.fileName} staged at ${result.path}. Press L + R + Select in-game to mute or unmute BGM.`;
    } catch (error) {
      bgmToggleButton.disabled = false;
      bgmToggleButton.textContent = previousText;
      if (bgmToggleNote) bgmToggleNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const forgettableHmsButton = root.querySelector<HTMLButtonElement>("#install-forgettable-hms-btn");
  forgettableHmsButton?.addEventListener("click", async () => {
    const note = root.querySelector<HTMLDivElement>("#forgettable-hms-note");
    const previousText = forgettableHmsButton.textContent ?? "Install Forgettable HMs";
    try {
      forgettableHmsButton.disabled = true;
      forgettableHmsButton.textContent = "Installing...";
      if (note) note.textContent = status.installed ? "Locating the HM check and staging the Forgettable HMs DLL." : "Installing PMC, then staging the Forgettable HMs DLL.";
      const result = await install(candidate => stageForgettableHmsPmc(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#forgettable-hms-note");
      if (refreshedNote) refreshedNote.textContent = `${result.summary} Export the ROM to apply it.`;
    } catch (error) {
      forgettableHmsButton.disabled = false;
      forgettableHmsButton.textContent = previousText;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const pwtSixPokemonButton = root.querySelector<HTMLButtonElement>("#install-pwt-six-pokemon-btn");
  pwtSixPokemonButton?.addEventListener("click", async () => {
    const note = root.querySelector<HTMLDivElement>("#pwt-six-pokemon-note");
    pwtSixPokemonButton.disabled = true;
    if (note) note.textContent = "Installing…";
    try {
      await installPwtSixPokemon(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#pwt-six-pokemon-note");
      if (refreshedNote) refreshedNote.textContent = "Export the ROM to apply this patch.";
    } catch (error) {
      pwtSixPokemonButton.disabled = false;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const pwtAbilityButton = root.querySelector<HTMLButtonElement>("#install-pwt-ability-btn");
  pwtAbilityButton?.addEventListener("click", async () => {
    const note = root.querySelector<HTMLDivElement>("#pwt-ability-note");
    pwtAbilityButton.disabled = true;
    if (note) note.textContent = "Installing…";
    try {
      await installPwtAbilitySelection(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      pwtAbilityButton.disabled = false;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const itemExpansionButton = root.querySelector<HTMLButtonElement>("#install-item-expansion-btn");
  const installTrainingItemsButton = root.querySelector<HTMLButtonElement>("#install-training-items-btn");
  const applyItemExpansion = async (button: HTMLButtonElement, withTrainingItems: boolean) => {
    const note = root.querySelector<HTMLDivElement>("#item-expansion-note");
    const previousText = button.textContent;
    try {
      button.disabled = true;
      button.textContent = "Installing...";
      const message = withTrainingItems
        ? `Training Items staged (${(await install(stageTrainingItems)).length} items). Export the ROM to apply them.`
        : `Item expansion staged (${(await install(stageItemExpansion)).addedItemSlots} new item slots). Export the ROM to apply it.`;
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#item-expansion-note");
      if (refreshedNote) refreshedNote.textContent = message;
    } catch (error) {
      button.disabled = false;
      button.textContent = previousText;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  itemExpansionButton?.addEventListener("click", () =>
    applyItemExpansion(itemExpansionButton, root.querySelector<HTMLInputElement>("#include-training-items")?.checked ?? false));
  installTrainingItemsButton?.addEventListener("click", () => applyItemExpansion(installTrainingItemsButton, true));
  root.querySelector<HTMLButtonElement>("#uninstall-item-expansion-btn")?.addEventListener("click", async () => {
    const note = root.querySelector<HTMLDivElement>("#item-expansion-note");
    try {
      uninstallItemExpansion(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const megaNote = () => root.querySelector<HTMLDivElement>("#mega-evolution-note");
  const readMegaRoutes = (): MegaRoute[] => [...root.querySelectorAll<HTMLTableRowElement>("[data-mega-route]")].map((row) => {
    const value = (field: string) => Number(row.querySelector<HTMLInputElement>(`[data-field="${field}"]`)?.value ?? 0);
    return {
      species: value("species"), trigger: value("trigger"), sourceForm: value("sourceForm"), targetForm: value("targetForm"),
      ...(row.querySelector<HTMLInputElement>('[data-field="moveTrigger"]')?.checked ? { moveTrigger: true } : {}),
    };
  });
  const saveMegaConfig = (routes: MegaRoute[]) => {
    const number = (id: string) => Number(root.querySelector<HTMLInputElement>(id)?.value ?? 0);
    setMegaEvolutionConfig(project, {
      routes,
      messages: { reacting: number("#mega-msg-reacting"), evolved: number("#mega-msg-evolved"), wish: number("#mega-msg-wish") },
      animationMove: number("#mega-animation"),
      autoFoes: root.querySelector<HTMLInputElement>("#mega-auto-foes")?.checked ?? true,
      ringItem: number("#mega-ring-item"),
    });
    onDirty();
    renderCodeInjectionEditor(project, root, onDirty);
  };
  const megaButton = root.querySelector<HTMLButtonElement>("#install-mega-btn");
  const gmaxBox = root.querySelector<HTMLInputElement>("#mega-gmax");
  // On an installed project, checking G-Max Megas makes the button add them.
  gmaxBox?.addEventListener("change", () => {
    const contentStatus = getMegaContentStatus(project);
    if (!megaButton || !contentStatus.installed) return;
    const status = getMegaEvolutionStatus(project);
    const needed = status.updateAvailable || contentStatus.animationMissing || contentStatus.ringMissing || contentStatus.universalMissing ||
      (gmaxBox.checked && contentStatus.gmaxForms < GMAX_MEGAS.length);
    megaButton.disabled = !needed;
    megaButton.textContent = needed ? "Update Mega Evolution" : "Mega Evolution Installed";
  });
  megaButton?.addEventListener("click", async () => {
    const previousText = megaButton.textContent ?? "Install Mega Evolution";
    try {
      megaButton.disabled = true;
      megaButton.textContent = "Installing...";
      const contentStatus = getMegaContentStatus(project);
      if (contentStatus.installed) {
        const updated = await install(async (candidate) => {
          const changes: string[] = [];
          if (getMegaEvolutionStatus(candidate).updateAvailable) changes.push(`${(await stageMegaEvolution(candidate)).dll} updated`);
          if (contentStatus.animationMissing) { await stageMegaAnimation(candidate); changes.push("transformation animation added"); }
          if (contentStatus.ringMissing) { await stageMegaRing(candidate); changes.push(`the Mega Ring added (item ${MEGA_RING_ITEM}; the player needs it to Mega Evolve)`); }
          const gmax = Boolean(gmaxBox?.checked) && contentStatus.gmaxForms < GMAX_MEGAS.length;
          if (contentStatus.universalMissing || gmax) {
            const extras = await stageMegaExtras(candidate, { gmax });
            if (extras.universalStones) changes.push(`${UNIVERSAL_STONES.map((stone) => stone.name).join(", ")} added (items ${extras.universalStones[0]}-${extras.universalStones.at(-1)})`);
            if (extras.gmax.length) changes.push(`${extras.gmax.length} G-Max Megas and their stones added`);
          }
          return changes;
        });
        onDirty();
        renderCodeInjectionEditor(project, root, onDirty);
        const refreshed = megaNote();
        if (refreshed) refreshed.textContent = `Mega Evolution: ${updated.join(", ")}.`;
        return;
      }
      const itemsWereInstalled = isItemExpansionInstalled(project);
      const report = await installMegaContent(project, (stage) => install(stage), { gmax: Boolean(gmaxBox?.checked) });
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const skipped = report.skipped;
      const notes = [
        `${report.forms.length} Mega Pokémon, their ${report.stones} Mega Stones, routes and the transformation animation installed.`,
        `The player needs the Mega Ring (Key Items, item ${MEGA_RING_ITEM}) to Mega Evolve; the test-battle saves have it.`,
        report.universalStones ? `Universal stones: ${UNIVERSAL_STONES.map((stone) => stone.name).join(", ")} (items ${report.universalStones[0]}-${report.universalStones.at(-1)}).` : "",
        report.gmax?.length ? `G-Max Megas: ${report.gmax.join(", ")}.` : "",
        report.fairyTypeInstalled ? "Fairy Type Support was installed (the Fairy Megas' type)." : "",
        report.moveExpansion === "installed" ? "Move Expansion was installed (Mega Rayquaza's Dragon Ascent)." : report.moveExpansion === "unavailable" ? "Move Expansion couldn't be installed on this ROM, so Mega Rayquaza was skipped." : "",
        itemsWereInstalled ? "" : "Item Expansion was installed too.",
        report.abilitiesAdded.length ? `Abilities added: ${report.abilitiesAdded.join(", ")}.` : "",
        skipped.length ? `Skipped: ${skipped.map((skip) => `${skip.name} (${skip.reason})`).join("; ")}.` : "",
        report.abilityFallbacks.length ? `Kept the base ability: ${report.abilityFallbacks.join("; ")}.` : "",
        report.typeFallbacks.length ? `Kept the base type: ${report.typeFallbacks.join("; ")}.` : "",
      ].filter(Boolean);
      const refreshed = megaNote();
      if (refreshed) refreshed.textContent = notes.join(" ");
    } catch (error) {
      megaButton.disabled = false;
      megaButton.textContent = previousText;
      const note = megaNote();
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  const abilityButton = root.querySelector<HTMLButtonElement>("#install-ability-expansion-btn");
  const abilityBoxes = () => [...root.querySelectorAll<HTMLInputElement>("[data-ability-expansion]")].filter((box) => !box.disabled);
  const abilityNote = () => root.querySelector<HTMLDivElement>("#ability-expansion-note");
  const refreshAbilitySelection = () => {
    const chosen = abilityBoxes().filter((box) => box.checked).length;
    const free = abilityStatus?.freeSlots ?? 0;
    const count = root.querySelector("#ability-expansion-count");
    if (count) count.textContent = String(chosen);
    if (abilityButton) abilityButton.disabled = !abilityStatus?.ready || !chosen || chosen > free;
    const note = abilityNote();
    if (note && abilityStatus?.ready) note.textContent = chosen > free ? `Only ${free} ability IDs are free: choose ${chosen - free} fewer.` : "";
  };
  root.querySelectorAll<HTMLInputElement>("[data-ability-expansion]").forEach((box) => box.addEventListener("change", refreshAbilitySelection));
  const shownAbilityBoxes = () => abilityBoxes().filter((box) => !box.closest<HTMLElement>("[data-ability-row]")?.hidden);
  root.querySelector("#ability-select-all-btn")?.addEventListener("click", () => { shownAbilityBoxes().forEach((box) => { box.checked = true; }); refreshAbilitySelection(); });
  root.querySelector("#ability-select-none-btn")?.addEventListener("click", () => { abilityBoxes().forEach((box) => { box.checked = false; }); refreshAbilitySelection(); });
  root.querySelectorAll<HTMLButtonElement>("[data-ability-gen]").forEach((button) => button.addEventListener("click", () => {
    const gen = button.dataset.abilityGen!;
    root.querySelectorAll<HTMLButtonElement>("[data-ability-gen]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
    root.querySelectorAll<HTMLElement>("[data-ability-row]").forEach((row) => { row.hidden = gen !== "all" && row.dataset.gen !== gen; });
  }));
  abilityButton?.addEventListener("click", async () => {
    const chosen = abilityBoxes().filter((box) => box.checked).map((box) => Number(box.dataset.abilityExpansion));
    const note = abilityNote();
    if (!chosen.length) { if (note) note.textContent = "Choose at least one ability."; return; }
    const previousText = abilityButton.textContent ?? "Install Selected Abilities";
    try {
      abilityButton.disabled = true;
      abilityButton.textContent = "Installing...";
      const report = await install((staged) => stageAbilityExpansion(staged, chosen));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const notes = [
        report.added.length ? `Abilities added: ${report.added.map((ability) => `${ability.name} (#${ability.id})`).join(", ")}.` : "No abilities added.",
        report.skipped.length ? `Skipped: ${report.skipped.join("; ")}.` : "",
      ].filter(Boolean);
      const refreshed = abilityNote();
      if (refreshed) refreshed.textContent = notes.join(" ");
    } catch (error) {
      abilityButton.disabled = false;
      abilityButton.textContent = previousText;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  const regionalNote = () => root.querySelector<HTMLDivElement>("#regional-forms-note");
  const familyBoxes = () => [...root.querySelectorAll<HTMLInputElement>("[data-regional-family]")].filter((box) => !box.disabled);
  root.querySelector<HTMLButtonElement>("#regional-select-all-btn")?.addEventListener("click", () => familyBoxes().forEach((box) => { box.checked = true; }));
  root.querySelector<HTMLButtonElement>("#regional-select-none-btn")?.addEventListener("click", () => familyBoxes().forEach((box) => { box.checked = false; }));
  const regionalButton = root.querySelector<HTMLButtonElement>("#install-regional-forms-btn");
  regionalButton?.addEventListener("click", async () => {
    const chosen = familyBoxes().filter((box) => box.checked).map((box) => Number(box.dataset.regionalFamily));
    const note = regionalNote();
    if (!chosen.length) { if (note) note.textContent = "Choose at least one family."; return; }
    const previousText = regionalButton.textContent ?? "Install Regional Forms";
    try {
      regionalButton.disabled = true;
      regionalButton.textContent = "Installing...";
      const report = await installRegionalForms(project, (stage) => install(stage), chosen);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const notes = [
        `${report.forms.length} regional forms installed, with evolution by form (FormEvolution${project.session.baseVersion}.dll).`,
        report.zenMode ? `Galarian Darmanitan has Zen Mode (RegionalZenMode${project.session.baseVersion}.dll).` : "",
        report.fairyTypeInstalled ? "Fairy Type Support was installed." : "",
        report.moveExpansion === "installed" ? "Move Expansion was installed (the forms' newer moves)." : report.moveExpansion === "unavailable" ? "Move Expansion couldn't be installed on this ROM." : "",
        report.abilitiesAdded.length ? `Abilities added: ${report.abilitiesAdded.join(", ")}.` : "",
        report.abilityFallbacks.length ? `Kept the base form's ability: ${report.abilityFallbacks.join("; ")}.` : "",
        report.movesLeftOut.length ? `Moves left out: ${report.movesLeftOut.join(", ")}.` : "",
        report.noEvolution.length ? `Don't evolve (their evolution is a newer Pokémon): ${report.noEvolution.join(", ")}.` : "",
        report.skipped.length ? `Skipped: ${report.skipped.map((skip) => `${skip.name} (${skip.reason})`).join("; ")}.` : "",
      ].filter(Boolean);
      const refreshed = regionalNote();
      if (refreshed) refreshed.textContent = notes.join(" ");
    } catch (error) {
      regionalButton.disabled = false;
      regionalButton.textContent = previousText;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  const speciesButton = root.querySelector<HTMLButtonElement>("#install-species-expansion-btn");
  const speciesBoxes = () => [...root.querySelectorAll<HTMLInputElement>("[data-species-expansion]")].filter((box) => !box.disabled);
  const refreshSpeciesSelection = () => {
    const chosen = speciesBoxes().filter((box) => box.checked).length;
    const count = root.querySelector("#species-expansion-count");
    if (count) count.textContent = String(chosen);
    if (speciesButton && speciesStatus.ready) speciesButton.disabled = !chosen;
    root.querySelectorAll<HTMLInputElement>("[data-species-family-toggle]").forEach((toggle) => {
      if (toggle.disabled) return;
      const members = [...root.querySelectorAll<HTMLInputElement>(`[data-species-family="${toggle.dataset.speciesFamilyToggle}"] [data-species-expansion]`)].filter((box) => !box.disabled);
      toggle.checked = members.every((box) => box.checked);
      toggle.indeterminate = !toggle.checked && members.some((box) => box.checked);
    });
  };
  root.querySelectorAll<HTMLInputElement>("[data-species-expansion]").forEach((box) => box.addEventListener("change", refreshSpeciesSelection));
  root.querySelectorAll<HTMLInputElement>("[data-species-family-toggle]").forEach((toggle) => toggle.addEventListener("change", () => {
    root.querySelectorAll<HTMLInputElement>(`[data-species-family="${toggle.dataset.speciesFamilyToggle}"] [data-species-expansion]`)
      .forEach((box) => { if (!box.disabled) box.checked = toggle.checked; });
    refreshSpeciesSelection();
  }));
  const shownSpeciesBoxes = () => speciesBoxes().filter((box) => !box.closest<HTMLElement>("[data-species-family]")?.hidden);
  root.querySelector("#species-select-all-btn")?.addEventListener("click", () => { shownSpeciesBoxes().forEach((box) => { box.checked = true; }); refreshSpeciesSelection(); });
  root.querySelector("#species-select-none-btn")?.addEventListener("click", () => { speciesBoxes().forEach((box) => { box.checked = false; }); refreshSpeciesSelection(); });
  let speciesGen = "all";
  const filterSpecies = () => {
    const query = (root.querySelector<HTMLInputElement>("#species-expansion-search")?.value ?? "").trim().toLowerCase();
    root.querySelectorAll<HTMLElement>("[data-species-family]").forEach((row) => {
      row.hidden = (speciesGen !== "all" && row.dataset.gen !== speciesGen) || (query !== "" && !(row.dataset.names ?? "").includes(query));
    });
  };
  root.querySelectorAll<HTMLButtonElement>("[data-species-gen]").forEach((button) => button.addEventListener("click", () => {
    speciesGen = button.dataset.speciesGen!;
    root.querySelectorAll<HTMLButtonElement>("[data-species-gen]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
    filterSpecies();
  }));
  root.querySelector("#species-expansion-search")?.addEventListener("input", filterSpecies);
  refreshSpeciesSelection();
  speciesButton?.addEventListener("click", async () => {
    const note = root.querySelector<HTMLDivElement>("#species-expansion-note");
    if (!canUseSpeciesExpansionInstaller()) {
      if (note) note.textContent = "Species Expansion can be installed only when Pokeweb runs locally.";
      return;
    }
    const previousText = speciesButton.textContent ?? "Install Species Expansion";
    try {
      speciesButton.disabled = true;
      speciesButton.textContent = "Installing...";
      const chosen = speciesBoxes().filter((box) => box.checked).map((box) => Number(box.dataset.speciesExpansion));
      if (!chosen.length) throw new Error("Choose at least one species.");
      const report = await installSpeciesExpansion(project, (stage) => install(stage), chosen);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const notes = [
        `${report.species} species installed (SpeciesExpansion${project.session.baseVersion}.dll)${report.formsMoved ? `; ${report.formsMoved} form records moved after them` : ""}.`,
        report.fairyTypeInstalled ? "Fairy Type Support was installed." : "",
        report.moveExpansion === "installed" ? "Move Expansion was installed (their newer moves)." : report.moveExpansion === "unavailable" ? "Move Expansion couldn't be installed on this ROM." : "",
        report.abilitiesAdded.length ? `Abilities added: ${report.abilitiesAdded.join(", ")}.` : "",
        report.abilityFallbacks.length ? `Abilities the library can't add (another of theirs is used): ${report.abilityFallbacks.join("; ")}.` : "",
        report.movesLeftOut.length ? `Moves left out: ${report.movesLeftOut.join(", ")}.` : "",
        report.evolutionsLeftOut.length ? `Evolutions left out: ${report.evolutionsLeftOut.join("; ")}.` : "",
        report.evolutionsWaiting?.length ? `Evolutions waiting for species you left out: ${report.evolutionsWaiting.join("; ")}.` : "",
        report.spriteStandIns.length ? `${report.spriteStandIns.join("; ")}.` : "",
      ].filter(Boolean);
      const refreshed = root.querySelector<HTMLDivElement>("#species-expansion-note");
      if (refreshed) refreshed.textContent = notes.join(" ");
    } catch (error) {
      speciesButton.disabled = false;
      speciesButton.textContent = previousText;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  root.querySelector<HTMLButtonElement>("#add-mega-route-btn")?.addEventListener("click", () => {
    try {
      // A new row starts as a copy of the last one so its numbers can be adjusted; saving validates it.
      const routes = readMegaRoutes();
      const last = routes.at(-1);
      project.codeInjection!.megaEvolution!.routes = [...routes, last ? { ...last, targetForm: last.targetForm + 1 } : { species: 6, trigger: 1, sourceForm: 0, targetForm: 1 }];
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      const note = megaNote();
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  root.querySelectorAll<HTMLButtonElement>("[data-remove-mega-route]").forEach((button) => button.addEventListener("click", () => {
    try {
      saveMegaConfig(readMegaRoutes().filter((_, index) => index !== Number(button.dataset.removeMegaRoute)));
    } catch (error) {
      const note = megaNote();
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  }));
  root.querySelector<HTMLButtonElement>("#save-mega-routes-btn")?.addEventListener("click", () => {
    try {
      saveMegaConfig(readMegaRoutes());
      const note = megaNote();
      if (note) note.textContent = "Mega routes saved.";
    } catch (error) {
      const note = megaNote();
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  root.querySelector<HTMLButtonElement>("#uninstall-mega-btn")?.addEventListener("click", () => {
    try {
      uninstallMegaEvolution(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      const note = megaNote();
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const autorunButton = root.querySelector<HTMLButtonElement>("#install-autorun-btn");
  autorunButton?.addEventListener("click", async () => {
    const note = root.querySelector<HTMLDivElement>("#autorun-note");
    const previousText = autorunButton.textContent ?? "Install Autorun";
    try {
      autorunButton.disabled = true;
      autorunButton.textContent = "Installing...";
      if (note) note.textContent = status.installed ? "Staging Autorun and its Options row." : "Installing PMC, then staging Autorun and its Options row.";
      const result = await install(candidate => stageAutorun(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#autorun-note");
      if (refreshedNote) refreshedNote.textContent = `Autorun staged${result.sharedWithFollowing ? " with Following Pokémon's Options row" : ""}. Export the ROM to apply it.`;
    } catch (error) {
      autorunButton.disabled = false;
      autorunButton.textContent = previousText;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  root.querySelector<HTMLButtonElement>("#uninstall-autorun-btn")?.addEventListener("click", async () => {
    const note = root.querySelector<HTMLDivElement>("#autorun-note");
    try {
      await uninstallAutorun(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const introSkipButton = root.querySelector<HTMLButtonElement>("#install-intro-skip-btn");
  introSkipButton?.addEventListener("click", async () => {
    const note = root.querySelector<HTMLDivElement>("#intro-skip-note");
    const previousText = introSkipButton.textContent ?? "Install Skip Intro";
    try {
      introSkipButton.disabled = true;
      introSkipButton.textContent = "Installing...";
      if (note) note.textContent = status.installed ? "Staging Skip Intro." : "Installing PMC, then staging Skip Intro.";
      await install(candidate => stageIntroSkip(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#intro-skip-note");
      if (refreshedNote) refreshedNote.textContent = "Skip Intro staged. Export the ROM and start a new game to see it.";
    } catch (error) {
      introSkipButton.disabled = false;
      introSkipButton.textContent = previousText;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  root.querySelector<HTMLButtonElement>("#uninstall-intro-skip-btn")?.addEventListener("click", async () => {
    const note = root.querySelector<HTMLDivElement>("#intro-skip-note");
    try {
      await uninstallIntroSkip(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const infiniteCandyButton = root.querySelector<HTMLButtonElement>("#install-infinite-candy-btn");
  const candyItemInput = root.querySelector<HTMLInputElement>("#infinite-candy-item-id");
  candyItemInput?.addEventListener("input", () => {
    const itemId = candyItemInput.valueAsNumber;
    if (Number.isInteger(itemId)) pendingCandyItemIds.set(project, itemId);
    const selected = getInfiniteCandyStatus(project, itemId);
    if (infiniteCandyButton) infiniteCandyButton.disabled = !selected.compatible;
    const note = root.querySelector<HTMLDivElement>("#infinite-candy-note");
    if (note) note.textContent = selected.compatible ? "" : selected.message;
    const badge = root.querySelector<HTMLElement>("#infinite-candy-status");
    if (badge) badge.innerHTML = renderInlineStatus(selected.installed ? "Installed" : selected.compatible ? "Ready" : "Incompatible", { className: "code-injection-status" });
  });
  infiniteCandyButton?.addEventListener("click", async () => {
    const note = root.querySelector<HTMLDivElement>("#infinite-candy-note");
    infiniteCandyButton.disabled = true;
    const itemId = candyItemInput?.valueAsNumber ?? infiniteCandyItemId;
    if (candyItemInput) candyItemInput.disabled = true;
    if (note) note.textContent = `Checking item ${itemId} and installing the patch...`;
    try {
      await install(candidate => installInfiniteCandy(candidate, itemId));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      infiniteCandyButton.disabled = false;
      if (candyItemInput) candyItemInput.disabled = false;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const levelCapsButton = root.querySelector<HTMLButtonElement>("#install-level-caps-btn");
  levelCapsButton?.addEventListener("click", async () => {
    const note = root.querySelector<HTMLDivElement>("#level-caps-note");
    levelCapsButton.disabled = true;
    if (note) note.textContent = "Checking battle, Day Care, and item hooks...";
    try {
      await install(candidate => installLevelCaps(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      levelCapsButton.disabled = false;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const trainerLevelCapsButton = root.querySelector<HTMLButtonElement>("#install-trainer-level-caps-btn");
  trainerLevelCapsButton?.addEventListener("click", async () => {
    const note = root.querySelector<HTMLDivElement>("#trainer-level-caps-note");
    trainerLevelCapsButton.disabled = true;
    try {
      await installTrainerLevelCaps(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      trainerLevelCapsButton.disabled = false;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const tagBattleButton = root.querySelector<HTMLButtonElement>("#install-tag-battle-stabilization-btn");
  const tagBattleNote = root.querySelector<HTMLDivElement>("#tag-battle-stabilization-note");
  tagBattleButton?.addEventListener("click", async () => {
    try {
      tagBattleButton.disabled = true;
      tagBattleButton.textContent = "Installing...";
      if (tagBattleNote) tagBattleNote.textContent = "Checking battle AI compatibility and installing Tag Battle Stabilization.";
      await install(candidate => installTagBattleStabilization(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#tag-battle-stabilization-note");
      if (refreshedNote) refreshedNote.textContent = "Tag Battle Stabilization is staged. Export the ROM to apply it.";
    } catch (error) {
      tagBattleButton.disabled = false;
      tagBattleButton.textContent = "Install Tag Battle Stabilization";
      if (tagBattleNote) tagBattleNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const uninstallTagBattleButton = root.querySelector<HTMLButtonElement>("#uninstall-tag-battle-stabilization-btn");
  uninstallTagBattleButton?.addEventListener("click", () => {
    try {
      uninstallTagBattleStabilization(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      if (tagBattleNote) tagBattleNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  for (const [id, action] of [
    ["install", () => install(stageRotationBattleAi)],
    ["uninstall", () => uninstallRotationBattleAi(project)],
  ] as const) {
    root.querySelector<HTMLButtonElement>(`#${id}-rotation-battle-ai-btn`)?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const note = root.querySelector<HTMLDivElement>("#rotation-battle-ai-note");
      button.disabled = true;
      try {
        await action();
        onDirty();
        renderCodeInjectionEditor(project, root, onDirty);
        const refreshedNote = root.querySelector<HTMLDivElement>("#rotation-battle-ai-note");
        if (refreshedNote && id === "install") refreshedNote.textContent = "Staged. Export the ROM to apply the patch.";
      } catch (error) {
        button.disabled = false;
        if (note) note.textContent = error instanceof Error ? error.message : String(error);
      }
    });
  }

  for (const [id, action] of [
    ["install", () => install(candidate => installCGearQuickActions(candidate))],
    ["disable", () => disableCGearQuickActions(project)],
    ["remove", () => removeCGearQuickActions(project)],
  ] as const) {
    root.querySelector<HTMLButtonElement>(`#${id}-cgear-quick-actions-btn`)?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;button.disabled = true;
      const note = root.querySelector<HTMLDivElement>("#cgear-quick-actions-note");
      try {
        if (note) note.textContent = "Checking and staging Quick Actions changes…";
        await action();onDirty();renderCodeInjectionEditor(project, root, onDirty);
        const updated = root.querySelector<HTMLDivElement>("#cgear-quick-actions-note");
        if (updated) updated.textContent = "Changes staged. Export a new ROM to use them.";
      } catch (error) {
        button.disabled = false;if (note) note.textContent = error instanceof Error ? error.message : String(error);
      }
    });
  }
  for (const [id, action] of [["install", installPokenav], ["disable", disablePokenav]] as const) {
    root.querySelector<HTMLButtonElement>(`#${id}-pokenav-btn`)?.addEventListener("click", async event => {
      const button = event.currentTarget as HTMLButtonElement, note = root.querySelector<HTMLDivElement>("#pokenav-note"); button.disabled = true;
      try { if (note) note.textContent = "Checking and staging Pokenav…"; await action(project); onDirty(); renderCodeInjectionEditor(project, root, onDirty); }
      catch (error) { button.disabled = false; if (note) note.textContent = error instanceof Error ? error.message : String(error); }
    });
  }
  for(const id of ["install","disable"] as const){
    root.querySelector<HTMLButtonElement>(`#${id}-nuzlocke-encounters-btn`)?.addEventListener("click",async()=>{
      const note=root.querySelector<HTMLElement>("#nuzlocke-encounters-note");
      try{
        if(note)note.textContent="Checking and staging Nuzlocke Style Encounters…";
        if(id==="install")await installNuzlockeEncounters(project,{allowExhausted:root.querySelector<HTMLSelectElement>("#nuzlocke-exhausted-select")?.value!=="prevent"});
        else await disableNuzlockeEncounters(project);
        onDirty();renderCodeInjectionEditor(project,root,onDirty);
      }catch(error){if(note)note.textContent=error instanceof Error?error.message:String(error);}
    });
  }
  const portaPcButton = root.querySelector<HTMLButtonElement>("#install-porta-pc-btn");
  const portaPcNote = root.querySelector<HTMLDivElement>("#porta-pc-note");
  portaPcButton?.addEventListener("click", async () => {
    const previousText = portaPcButton.textContent;
    try {
      portaPcButton.disabled = true;
      portaPcButton.textContent = "Installing...";
      if (portaPcNote) portaPcNote.textContent = "Checking field compatibility and installing Porta PC.";
      await install(candidate => installPortaPc(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#porta-pc-note");
      if (refreshedNote) refreshedNote.textContent = "Porta PC is staged. Export the ROM, then press Start while exploring to use the PC.";
    } catch (error) {
      portaPcButton.disabled = false;
      portaPcButton.textContent = previousText;
      if (portaPcNote) portaPcNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  root.querySelector<HTMLButtonElement>("#uninstall-porta-pc-btn")?.addEventListener("click", () => {
    try {
      uninstallPortaPc(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      if (portaPcNote) portaPcNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const battleLogButton = root.querySelector<HTMLButtonElement>("#install-battle-log-btn");
  const battleLogNote = root.querySelector<HTMLDivElement>("#battle-log-note");
  battleLogButton?.addEventListener("click", async () => {
    const previousText = battleLogButton.textContent ?? "Install Battle Log";
    const updating = battleLogStatus.updateAvailable;
    const refreshMenuEvolution = updating && menuEvolutionStatus.installed;
    try {
      battleLogButton.disabled = true;
      battleLogButton.textContent = updating ? "Updating..." : "Installing...";
      if (battleLogNote) {
        battleLogNote.textContent = `${updating ? "Updating" : "Installing"} the split battle-log runtimes, checking ROM hooks, retiring Pal Pad save handling, and generating species ancestry.`;
      }
      const result = await install(async candidate => {
        const result = await installBattleLog(candidate);
        if (refreshMenuEvolution) await installMenuEvolution(candidate);
        return result;
      });
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#battle-log-note");
      if (refreshedNote) {
        refreshedNote.textContent = `Battle log ${updating ? "updated" : "staged"}. Ancestry was generated from ${result.evolutionMembers} evolution records.${refreshMenuEvolution ? ` The installed ${MENU_EVOLUTION_TITLE} companion was refreshed for immediate KO events and KO moves.` : ""}`;
      }
    } catch (error) {
      const currentButton = root.querySelector<HTMLButtonElement>("#install-battle-log-btn") ?? battleLogButton;
      const currentNote = root.querySelector<HTMLDivElement>("#battle-log-note") ?? battleLogNote;
      currentButton.disabled = false;
      currentButton.textContent = previousText;
      if (currentNote) currentNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const uninstallBattleLogButton = root.querySelector<HTMLButtonElement>("#uninstall-battle-log-btn");
  uninstallBattleLogButton?.addEventListener("click", () => {
    try {
      uninstallBattleLogButton.disabled = true;
      uninstallBattleLog(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#battle-log-note");
      if (refreshedNote) {
        refreshedNote.textContent = "Battle-log DLLs removed and normal Pal Pad/Wi-Fi save handling restored. Existing battle-log save records remain untouched.";
      }
    } catch (error) {
      uninstallBattleLogButton.disabled = false;
      const currentNote = root.querySelector<HTMLDivElement>("#battle-log-note") ?? battleLogNote;
      if (currentNote) currentNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  root.querySelector<HTMLButtonElement>("#install-party-tools-btn")?.addEventListener("click", async () => {
    const button = root.querySelector<HTMLButtonElement>("#install-party-tools-btn")!;
    button.disabled = true;
    try {
      const hideFlag = parsePartyToolbarHideFlag(root.querySelector<HTMLInputElement>("#party-tools-hide-flag")?.value ?? "", project.session.baseVersion);
      const sectionHideFlags = Object.fromEntries(PARTY_TOOLBAR_SECTIONS.map(({ id, label }) => {
        try { return [id, parsePartyToolbarHideFlag(root.querySelector<HTMLInputElement>(`#party-tools-${id}-hide-flag`)?.value ?? "", project.session.baseVersion)]; }
        catch (error) { throw new Error(`${label}: ${(error as Error).message}`); }
      }));
      await install(candidate => installPartyQuickActions(candidate, { hideFlag, sectionHideFlags })); onDirty(); renderCodeInjectionEditor(project, root, onDirty);
    }
    catch (error) { button.disabled = false; const note = root.querySelector("#party-tools-status"); if (note) note.textContent = error instanceof Error ? error.message : String(error); }
  });
  root.querySelector<HTMLButtonElement>("#disable-party-tools-btn")?.addEventListener("click", () => {
    try { disablePartyQuickActions(project); onDirty(); renderCodeInjectionEditor(project, root, onDirty); }
    catch (error) { const note = root.querySelector("#party-tools-status"); if (note) note.textContent = error instanceof Error ? error.message : String(error); }
  });

  const menuEvolutionButton = root.querySelector<HTMLButtonElement>("#install-menu-evolution-btn");
  const menuEvolutionNote = root.querySelector<HTMLDivElement>("#menu-evolution-note");
  menuEvolutionButton?.addEventListener("click", async () => {
    const previousText = menuEvolutionButton.textContent ?? "Install";
    try {
      menuEvolutionButton.disabled = true;
      menuEvolutionButton.textContent = "Installing...";
      if (menuEvolutionNote) {
        menuEvolutionNote.textContent = "Checking hooks, installing required dependencies, and configuring EVOLVE and RELEARN.";
      }
      const result = await install(candidate => installMenuEvolution(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#menu-evolution-note");
      if (refreshedNote) {
        refreshedNote.textContent = `${MENU_EVOLUTION_TITLE} staged at ${result.dllPath} using message bank ${result.messageBankId}, EVOLVE entry ${result.messageEntryId} and RELEARN entry ${result.relearnMessageEntryId}; ${result.koLearnsetMembers} KO learnset members are available at ${result.koLearnsetPath}.`;
      }
    } catch (error) {
      const currentButton = root.querySelector<HTMLButtonElement>("#install-menu-evolution-btn") ?? menuEvolutionButton;
      const currentNote = root.querySelector<HTMLDivElement>("#menu-evolution-note") ?? menuEvolutionNote;
      currentButton.disabled = false;
      currentButton.textContent = previousText;
      if (currentNote) currentNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const uninstallMenuEvolutionButton = root.querySelector<HTMLButtonElement>("#uninstall-menu-evolution-btn");
  uninstallMenuEvolutionButton?.addEventListener("click", () => {
    try {
      uninstallMenuEvolutionButton.disabled = true;
      uninstallMenuEvolution(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#menu-evolution-note");
      if (refreshedNote) {
        refreshedNote.textContent = `${MENU_EVOLUTION_TITLE} removed. The EVOLVE and RELEARN text entries remain available for a later reinstall.`;
      }
    } catch (error) {
      uninstallMenuEvolutionButton.disabled = false;
      const currentNote = root.querySelector<HTMLDivElement>("#menu-evolution-note") ?? menuEvolutionNote;
      if (currentNote) currentNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const input = root.querySelector<HTMLInputElement>("#code-injection-dll-input");
  for (const [id, installAction, uninstall] of [
    ["battle-hud", installBattleTypeHud, uninstallBattleTypeHud],
    ["move-effectiveness", installMoveEffectiveness, uninstallMoveEffectiveness],
    ["quick-poke-ball", installQuickPokeBall, uninstallQuickPokeBall],
  ] as const) {
    for (const [verb, action] of [["install", installAction], ["uninstall", uninstall]] as const) {
      const button = root.querySelector<HTMLButtonElement>(`#${verb}-${id}-btn`);
      button?.addEventListener("click", async () => {
        const note = root.querySelector<HTMLDivElement>(`#${id}-note`);
        button.disabled = true;
        if (note) note.textContent = "Checking and updating the patch...";
        try {
          if (id === "move-effectiveness" && verb === "install") {
            const colors = Object.fromEntries([...root.querySelectorAll<HTMLInputElement>("[data-move-highlight-color]")]
              .map(input => [input.dataset.moveHighlightColor!, input.value])) as MoveHighlightColors;
            await install(candidate => installMoveEffectiveness(candidate, colors));
          } else if (id === "move-effectiveness" && verb === "uninstall") {
            await withProjectMutationLock(project, () => uninstallMoveEffectiveness(project));
          } else if (id === "battle-hud" && verb === "install") {
            await install(candidate => installBattleTypeHud(candidate, typeIconSettings.variant, typeIconSettings.variant === "solid" ? undefined : typeIconSettings.borderColor));
            pendingTypeIcons.delete(project);
          } else await action(project);
          onDirty(); renderCodeInjectionEditor(project, root, onDirty);
        }
        catch (error) { button.disabled = false; if (note) note.textContent = error instanceof Error ? error.message : String(error); }
      });
    }
  }
  const borderInput = root.querySelector<HTMLInputElement>("#type-icon-border-color");
  const updateTypeIconSelection = () => {
    root.querySelectorAll<HTMLElement>("[data-type-icon-variant-card]").forEach(card => {
      const selected = card.dataset.typeIconVariantCard === typeIconSettings.variant;
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    });
    const picker = root.querySelector<HTMLElement>(".type-icon-border-color");
    if (picker) picker.hidden = typeIconSettings.variant === "solid";
    root.querySelectorAll<HTMLImageElement>("[data-type-icon-battle-preview]").forEach(image => {
      const format = image.dataset.typeIconBattlePreview;
      if (format === "singles" || format === "triples") image.src = typeIconBattlePreviews[typeIconSettings.variant][format];
    });
  };
  root.querySelectorAll<HTMLButtonElement>("[data-type-icon-variant-card]").forEach(card => {
    card.addEventListener("click", () => {
      typeIconSettings.variant = card.dataset.typeIconVariantCard as TypeIconVariant;
      pendingTypeIcons.set(project, typeIconSettings); updateTypeIconSelection();
    });
  });
  borderInput?.addEventListener("input", () => {
    typeIconSettings.borderColor = borderInput.value;
    pendingTypeIcons.set(project, typeIconSettings);
    root.querySelectorAll<HTMLElement>("[data-type-icon-variant-card]").forEach(card => {
      const variant = card.dataset.typeIconVariantCard;
      if (variant === "letters" || variant === "circular") {
        const image = card.querySelector<HTMLImageElement>("img");
        if (image) image.src = typeIconPreview(variant, typeIconSettings.borderColor);
      }
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-move-highlight-color]").forEach(input => {
    input.addEventListener("input", () => {
      const key = input.dataset.moveHighlightColor;
      const color = moveHighlightPreviewColor(input.value);
      const sample = root.querySelector<HTMLElement>(`[data-move-highlight-sample="${key}"]`);
      const glyph = root.querySelector<HTMLElement>(`[data-move-highlight-glyph="${key}"]`);
      if (sample) sample.style.color = color;
      if (glyph) glyph.style.backgroundColor = color;
    });
  });
  root.querySelector<HTMLButtonElement>("#reset-move-highlight-colors")?.addEventListener("click", () => {
    root.querySelectorAll<HTMLInputElement>("[data-move-highlight-color]").forEach(input => {
      input.value = DEFAULT_MOVE_HIGHLIGHT_COLORS[input.dataset.moveHighlightColor as keyof MoveHighlightColors];
      input.dispatchEvent(new Event("input"));
    });
  });
  const learnsetLayoutCards = root.querySelectorAll<HTMLButtonElement>("[data-learnset-upper-layout]");
  learnsetLayoutCards.forEach(card => card.addEventListener("click", () => {
    learnsetUpperLayout = card.dataset.learnsetUpperLayout === "classic" ? "classic" : "three-cards";
    pendingLearnsetLayouts.set(project, learnsetUpperLayout);
    learnsetLayoutCards.forEach(choice => {
      const selected = choice.dataset.learnsetUpperLayout === learnsetUpperLayout;
      choice.classList.toggle("is-selected", selected);
      choice.setAttribute("aria-pressed", String(selected));
    });
    const action = root.querySelector("#install-learnset-viewer-btn");
    if (action) action.textContent = learnsetInstallLabel();
  }));
  for (const [selector, action] of [
    ["#install-learnset-viewer-btn", () => install(candidate => installLearnsetViewer(candidate, {
      upperLayout: canChooseLearnsetLayout ? learnsetUpperLayout : undefined,
    }))],
    ["#uninstall-learnset-viewer-btn", () => uninstallLearnsetViewer(project)],
  ] as const) {
    const button = root.querySelector<HTMLButtonElement>(selector);
    button?.addEventListener("click", async () => {
      button.disabled = true;
      const note = root.querySelector<HTMLDivElement>("#learnset-viewer-note");
      learnsetLayoutCards.forEach(card => { card.disabled = true; });
      if (note) note.textContent = "Checking and updating the LEARNSET companions...";
      try {
        await action();
        pendingLearnsetLayouts.delete(project);
        onDirty();
        renderCodeInjectionEditor(project, root, onDirty);
      } catch (error) {
        button.disabled = false;
        learnsetLayoutCards.forEach(card => { card.disabled = false; });
        if (note) note.textContent = error instanceof Error ? error.message : String(error);
      }
    });
  }
  const dllNote = root.querySelector<HTMLDivElement>("#dll-install-note");
  for (const [selector, action] of [
    ["#install-summary-stat-btn", () => install(candidate => installSummaryStatViewer(candidate, { includeEvs: root.querySelector<HTMLInputElement>("#summary-stat-evs")?.checked ?? true }))],
    ["#uninstall-summary-stat-btn", () => uninstallSummaryStatViewer(project)],
  ] as const) {
    const button = root.querySelector<HTMLButtonElement>(selector);
    button?.addEventListener("click", async () => {
      button.disabled = true;
      const note = root.querySelector<HTMLElement>("#summary-stat-note");
      if (note) note.textContent = "Checking Summary compatibility and staging changes…";
      try {
        await action(); onDirty(); renderCodeInjectionEditor(project, root, onDirty);
        const updated = root.querySelector<HTMLElement>("#summary-stat-note");
        if (updated) updated.textContent = "Changes staged. Export the ROM to use them.";
      } catch (error) {
        button.disabled = false;
        if (note) note.textContent = error instanceof Error ? error.message : String(error);
      }
    });
  }
  let selectedTarget: CodeInjectionDllTarget = "patches";
  root.querySelectorAll<HTMLButtonElement>("[data-dll-target]").forEach((targetButton) => {
    targetButton.addEventListener("click", () => {
      selectedTarget = targetButton.dataset.dllTarget === "lib" ? "lib" : "patches";
      if (input) {
        input.value = "";
        input.click();
      }
    });
  });
  input?.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await install(candidate => stageCodeInjectionDll(candidate, file.name, bytes, selectedTarget));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#dll-install-note");
      if (refreshedNote) refreshedNote.textContent = `${result.fileName} staged at ${result.path}.`;
    } catch (error) {
      if (dllNote) dllNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });
}

function formatShinyOdds(rolls: number): string {
  return `${rolls === 1 ? "" : "≈ "}1 in ${Math.round(1 / wildShinyChance(rolls)).toLocaleString()}`;
}

function renderPwanCompatibilityDetails(project: ProjectState, report: PwanCompatibilityReport): string {
  if (report.compatible) {
    return `<div class="code-injection-compat-ok">All ${report.passed} PWAN hook regions match the stock ${({ B: "Black", W: "White", B2: "Black 2" } as Record<string, string>)[project.session.baseVersion] ?? "White 2"} snapshot.</div>`;
  }
  return `
    <div class="code-injection-compat-list" aria-label="PWAN compatibility failures">
      ${report.checks
        .filter((check) => check.status !== "matched")
        .map(renderPwanCompatibilityRow)
        .join("")}
    </div>
  `;
}

function renderPwanCompatibilityRow(check: PwanCompatibilityCheck): string {
  const address = check.address > 0 ? `0x${check.address.toString(16).padStart(8, "0")}` : "ROM";
  const moduleLabel = check.module === "arm9" ? "ARM9" : `Overlay ${check.overlayId}`;
  return `
    <div class="code-injection-compat-item -${check.status}">
      <div>
        <strong>${escapeHtml(check.group)} / ${escapeHtml(check.label)}</strong>
        <span>${escapeHtml(moduleLabel)} at ${escapeHtml(address)}</span>
      </div>
      <em>${escapeHtml(check.status)}</em>
      <p>${escapeHtml(check.message)}</p>
    </div>
  `;
}

async function hydrateRomBytesForCodeInjection(project: ProjectState, root: HTMLElement, onDirty: () => void): Promise<void> {
  codeInjectionHydrationProjects.add(project);
  try {
    const bytes = await loadActiveRomBytes();
    if (!bytes || project.originalRomBytes) return;
    project.originalRomBytes = bytes;
    if (root.isConnected) renderCodeInjectionEditor(project, root, onDirty);
  } catch {
    // The page can still report the missing regions; export/install paths will surface storage errors separately.
  } finally {
    codeInjectionHydrationProjects.delete(project);
  }
}

/** Cascade White: imports the ROM's injected AI abilities and Hidden Ability chances into the personal editor. */
export function renderCascadePersonalCard(cascadeStatus: ReturnType<typeof getCascadePersonalMigrationStatus>): string {
  if (!cascadeStatus.visible) return "";
  return `
<section class="code-injection-panel">
          <div class="code-injection-panel__header">
            <div>
              <h2>Editable Cascade AI Abilities</h2>
              <p>${escapeHtml(cascadeStatus.message)}</p>
              <p>Imports three AI ability slots and raw Hidden Ability Chance values from this ROM’s injected tables into the Pokémon personal editor. Gameplay use of these personal fields requires a Cascade runtime update.</p>
            </div>
            ${renderInlineStatus(cascadeStatus.installed ? "Migrated" : cascadeStatus.canMigrate ? "Ready" : "Unavailable", { className: "code-injection-status" })}
          </div>
          ${renderSupportedRoms("Cascade White")}
          <div class="code-injection-actions">
            <button class="btn -primary" id="migrate-cascade-personal-btn" type="button" ${cascadeStatus.canMigrate ? "" : "disabled"}>${cascadeStatus.abilitiesMigrated && !cascadeStatus.installed ? "Import Hidden Ability Chances" : "Migrate AI Abilities &amp; Chances"}</button>
            <div class="code-injection-note" id="cascade-personal-note" aria-live="polite"></div>
          </div>
        </section>`;
}
