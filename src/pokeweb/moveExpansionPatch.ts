import white2UpgradeMoveExpansionJson from "../assets/data/white2upgradeMoveExpansion.json";
import white2UpgradeMoveAnimationsUrl from "../assets/data/white2upgradeGen6MoveAnimations.zip?url";
import { unzipSync } from "fflate";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { BW2_NARCS, BW_NARCS, HEADER_NARCS, isGen5BaseRom, type Gen5BaseRom, type NarcName } from "./constants";
import { loadActiveRomBytes } from "./persistence";
import { commitTextBank, getTextBank, parseTextEntryId } from "./textModel";
import { createNarcStore, markDirty, type NarcStore, type ProjectState } from "./projectStore";
import { getRomFileBytes, replaceRomFile } from "./fileSystemModel";

export const MOVE_EXPANSION_TARGET_COUNT = 1000;
export const MOVE_EXPANSION_FIRST_USABLE_ID = 680;

export type MoveExpansionInstallOptions = {
  includeBundledAnimations?: boolean;
  animationBundleBytes?: Uint8Array;
  /** Legacy aliases retained for callers saved before the Gen 7 bundle was added. */
  includeGen6Animations?: boolean;
  gen6AnimationBundleBytes?: Uint8Array;
};

export type MoveExpansionPatchState = "patched" | "routing-only" | "unpatched" | "unsupported" | "unknown";
export type MoveExpansionRoutingState = "patched" | "unpatched" | "unknown";

export type MoveExpansionInstallResult = {
  changed: boolean;
  routingChanged: boolean;
  overlayId: number;
  helperOffset?: number;
  movesAdded: number;
  animationsAdded: number;
  textEntriesAdded: number;
  importedMovesAdded: number;
  fairyMovesMappedToNormal: number;
  bundledAnimationsIncluded: boolean;
  bundledAnimationsInstalled: number;
  particleFilesInstalled: number;
  particleReferencesRemapped: number;
  backgroundFilesInstalled: number;
  overlayLoadSizeRepaired: boolean;
};

export type MoveExpansionRoutingPatchResult = {
  status: "applied" | "already-applied";
  overlay: Uint8Array;
  helperOffset?: number;
  commandHelperAddress?: number;
  globalAddress?: number;
};

type ExpansionMove = {
  sourceId: number;
  name: string;
  uppercaseName: string;
  description: string;
  data: number[];
};

type ExpansionAsset = {
  source: string;
  fields: string[];
  firstSourceMoveId: number;
  firstTargetMoveId: number;
  targetMoveCount: number;
  moves: ExpansionMove[];
};

export type MoveExpansionBundledParticle = {
  sourceParticleId: number;
  bytes: Uint8Array;
};

export type MoveExpansionParticleAllocation = {
  particleIdMap: Map<number, number>;
  addedIds: number[];
};

export type MoveExpansionBundledBackground = { sourceBackgroundId: number; files: Uint8Array[] };

type MoveExpansionAnimationBundle = {
  completeAssets: boolean;
  moves: Array<{
    sourceMoveId: number;
    targetMoveId: number;
    particleIds: number[];
    backgroundIds: number[];
    bytes: Uint8Array;
  }>;
  particles: MoveExpansionBundledParticle[];
  backgrounds: MoveExpansionBundledBackground[];
};

type MoveTextBankConfig = {
  battle: number;
  description: number;
  name: number;
  uppercase: number;
};

type RoutingLayout = {
  loaderOverlayId: number;
  commandOverlayId: number;
  legacyCallerOffset: number;
  commandHookOffset: number;
  secondaryLoaderHookOffset?: number;
};

type MoveExpansionRoutingCacheEntry = {
  baseRom: ProjectState["session"]["baseRom"];
  originalRomBytes: Uint8Array | undefined;
  loadedLoaderOverlay: Uint8Array | undefined;
  loadedCommandOverlay: Uint8Array | undefined;
  state: MoveExpansionRoutingState;
};

type RoutingOverlay = {
  data: Uint8Array;
  ramAddress: number;
  bssSize: number;
  ramSize: number;
};

const EXPANSION_ASSET = white2UpgradeMoveExpansionJson as ExpansionAsset;
const EXPANSION_MOVES = EXPANSION_ASSET.moves;
const EXPANSION_MOVE_BY_TARGET = new Map(
  EXPANSION_MOVES.map((move, index) => [EXPANSION_ASSET.firstTargetMoveId + index, move] as const),
);
const MOVE_FIELD_INDEX = new Map(EXPANSION_ASSET.fields.map((field, index) => [field, index] as const));
const MOVE_FIELD_WIDTH: Record<string, 1 | 2> = {
  type: 1,
  effect_category: 1,
  category: 1,
  power: 1,
  accuracy: 1,
  pp: 1,
  priority: 1,
  hits: 1,
  result_effect: 2,
  effect_chance: 1,
  status: 1,
  min_turns: 1,
  max_turns: 1,
  crit: 1,
  flinch: 1,
  effect: 2,
  recoil: 1,
  healing: 1,
  target: 1,
  stat_1: 1,
  stat_2: 1,
  stat_3: 1,
  magnitude_1: 1,
  magnitude_2: 1,
  magnitude_3: 1,
  stat_chance_1: 1,
  stat_chance_2: 1,
  stat_chance_3: 1,
  flag: 2,
  properties: 2,
};

const ROUTING_LAYOUTS: Record<Gen5BaseRom, RoutingLayout> = {
  BW: {
    loaderOverlayId: 94,
    commandOverlayId: 93,
    legacyCallerOffset: 0x3046,
    commandHookOffset: 0x33fcc,
  },
  BW2: {
    loaderOverlayId: 168,
    commandOverlayId: 167,
    legacyCallerOffset: 0x3536,
    commandHookOffset: 0x363cc,
    secondaryLoaderHookOffset: 0x6456,
  },
};
const ORIGINAL_ROUTING_CALLER = [
  0x96, 0x20, 0x80, 0x00, 0x21, 0x5a, 0x27, 0x38, 0x88, 0x4b, 0x81, 0x42, 0x38, 0xd2,
] as const;
const FROST_ROUTING_SIGNATURE = [0x00, 0x00, 0x00, 0x00, 0x88, 0x4b, 0x01, 0x28, 0x38, 0xd0] as const;
const ORIGINAL_COMMAND_HOOK = [0x33, 0x1c, 0x01, 0x90] as const;
const ORIGINAL_SECONDARY_LOADER_HOOK = [0x84, 0x42, 0x10, 0x4b] as const;
const ORIGINAL_BW_VISUAL_HOOK = [0x31, 0x1c, 0x1a, 0x40] as const;
const MOVE_ANIMATION_ARCHIVE_OFFSET = 115;
const FIRST_ROUTED_MOVE_ANIMATION_ID = MOVE_EXPANSION_FIRST_USABLE_ID + MOVE_ANIMATION_ARCHIVE_OFFSET;

// Battle-view commands use IDs 561..675 for fixed lifecycle animations. New
// moves therefore travel as moveId+115 and are converted back only inside the
// two animation-file loaders. Passing raw IDs such as 741 into these loaders
// makes lifecycle commands repeatedly open the Pound placeholder.
const BW2_COMMAND_HELPER = Uint8Array.of(
  0x01, 0x90, 0x33, 0x00, 0x02, 0x48, 0x83, 0x42, 0x00, 0xd3, 0x73, 0x33, 0x70, 0x47, 0x00, 0x00,
  0xa8, 0x02, 0x00, 0x00,
);
const BW2_PRIMARY_LOADER_HELPER = Uint8Array.of(
  0x00, 0xb5, 0x06, 0x4b, 0x81, 0x42, 0x05, 0xdb, 0x05, 0x48, 0x81, 0x42, 0x01, 0xda, 0x01, 0x21,
  0x01, 0xe0, 0x73, 0x3e, 0x00, 0x21, 0x01, 0x20, 0x81, 0x42, 0x00, 0xbd, 0xff, 0x7f, 0x00, 0x00,
  FIRST_ROUTED_MOVE_ANIMATION_ID & 0xff, (FIRST_ROUTED_MOVE_ANIMATION_ID >> 8) & 0xff, 0x00, 0x00,
);
const BW2_SECONDARY_LOADER_HELPER = Uint8Array.of(
  0xc0, 0xb5, 0x06, 0x4b, 0x84, 0x42, 0x05, 0xdb, 0x05, 0x48, 0x84, 0x42, 0x01, 0xda, 0x01, 0x26,
  0x01, 0xe0, 0x73, 0x3c, 0x00, 0x26, 0x01, 0x27, 0xbe, 0x42, 0xc0, 0xbd, 0xff, 0x7f, 0x00, 0x00,
  FIRST_ROUTED_MOVE_ANIMATION_ID & 0xff, (FIRST_ROUTED_MOVE_ANIMATION_ID >> 8) & 0xff, 0x00, 0x00,
);
const BW_COMMAND_HELPER_TEMPLATE = Uint8Array.of(
  0x01, 0x90, 0x33, 0x00, 0x05, 0x48, 0x83, 0x42, 0x03, 0xd3, 0x05, 0x48, 0x03, 0x80, 0x01, 0x23,
  0x70, 0x47, 0x00, 0x23, 0x02, 0x48, 0x03, 0x80, 0x33, 0x00, 0x70, 0x47, 0xa8, 0x02, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
);
const BW_COMMAND_GLOBAL_LITERAL_OFFSET = 0x20;
const BW_COMMAND_GLOBAL_OFFSET = BW_COMMAND_HELPER_TEMPLATE.length;
const BW_VISUAL_HELPER_TEMPLATE = Uint8Array.of(
  0x03, 0x49, 0x09, 0x88, 0x00, 0x29, 0x00, 0xd1, 0x31, 0x00, 0x1a, 0x40, 0x70, 0x47, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
);
const BW_VISUAL_GLOBAL_LITERAL_OFFSET = 0x10;

const MOVE_TEXT_BANKS: Record<Gen5BaseRom, MoveTextBankConfig> = {
  BW: { battle: 13, description: 202, name: 203, uppercase: 286 },
  BW2: { battle: 16, description: 402, name: 403, uppercase: 488 },
};
const FIRST_RESERVED_MOVE_ID = 560;
const FIRST_BW2_ONLY_MOVE_PARTICLE_ID = 733;
const FAIRY_TYPE_ID = 17;
const NORMAL_TYPE_ID = 0;
const EFFECT_FIELD = requiredMoveFieldIndex("effect");
const TYPE_FIELD = requiredMoveFieldIndex("type");
let animationBundlePromise: Promise<MoveExpansionAnimationBundle> | undefined;
const moveExpansionRoutingCache = new WeakMap<ProjectState, MoveExpansionRoutingCacheEntry>();

export async function installMoveExpansion(
  project: ProjectState,
  options: MoveExpansionInstallOptions = {},
): Promise<MoveExpansionInstallResult> {
  if (!isGen5BaseRom(project.session.baseRom)) throw new Error("Move Expansion is currently available for Black / White and Black 2 / White 2 only.");

  const includeBundledAnimations = options.includeBundledAnimations ?? options.includeGen6Animations ?? false;
  const animationBundleBytes = options.animationBundleBytes ?? options.gen6AnimationBundleBytes;
  const animationBundle = includeBundledAnimations
    ? animationBundleBytes
      ? parseMoveExpansionAnimationBundle(animationBundleBytes)
      : await loadMoveExpansionAnimationBundle()
    : undefined;
  if (animationBundle && !animationBundle.completeAssets && project.session.baseRom === "BW") {
    throw new Error("BW1 needs the current animation bundle with complete particle and background dependencies.");
  }

  const layout = ROUTING_LAYOUTS[project.session.baseRom];
  const routingOverlay = await ensureRoutingOverlay(project, layout.loaderOverlayId);
  const commandOverlay = await ensureRoutingOverlay(project, layout.commandOverlayId);
  const plan = planMoveExpansionRouting(routingOverlay, commandOverlay, project.session.baseRom);
  if (!plan) {
    throw new Error(`Could not safely install move-animation routing in overlays ${layout.commandOverlayId}/${layout.loaderOverlayId}. This ROM has a conflicting battle-animation code or memory-layout change.`);
  }
  const routingPatch = plan.loader;
  const commandPatch = plan.command;

  const stores = await ensureExpansionStores(project, Boolean(animationBundle));
  const originalMoveCount = stores.moves.rawFiles.length;
  const moveSummary = expandMoveData(project, stores.moves);
  const animationSummary = expandMoveAnimations(project, stores.moves, stores.moveAnimations, moveSummary.seededIds);
  const bundledAnimationSummary =
    animationBundle && stores.moveSpas
      ? await installBundledMoveAnimations(project, stores.moveAnimations, stores.moveSpas, animationBundle)
      : { animationsChanged: 0, particlesAdded: 0, backgroundFilesAdded: 0, referencesRemapped: 0 };
  const textEntriesAdded = expandMoveText(project, originalMoveCount, moveSummary.seededIds);

  if (commandPatch.status === "applied") {
    project.overlays[layout.commandOverlayId] = commandPatch.overlay;
    markPatchOverlayDirty(project, layout.commandOverlayId);
  }
  const overlayLoadSizeRepaired = routingOverlay.ramSize !== routingPatch.overlay.length || routingOverlay.bssSize !== 0;
  if (routingPatch.status === "applied" || overlayLoadSizeRepaired) {
    project.overlays[layout.loaderOverlayId] = routingPatch.overlay;
    markPatchOverlayDirty(project, layout.loaderOverlayId);
  }
  if (overlayLoadSizeRepaired) {
    const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
    if (!romBytes) throw new Error("Reload the ROM before updating its overlay table.");
    updateRoutingOverlayTable(project, new NintendoDSRom(romBytes, { fileData: "view" }).arm9OverlayTable, layout.loaderOverlayId, routingPatch.overlay.length);
  }

  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  project.patches.applied ??= {};
  project.patches.applied.moveExpansion = true;
  if (animationBundle) project.patches.applied.moveExpansionBundledAnimations = true;

  const changed =
    overlayLoadSizeRepaired ||
    commandPatch.status === "applied" ||
    routingPatch.status === "applied" ||
    moveSummary.changed > 0 ||
    animationSummary.changed > 0 ||
    bundledAnimationSummary.animationsChanged > 0 ||
    bundledAnimationSummary.particlesAdded > 0 ||
    bundledAnimationSummary.backgroundFilesAdded > 0 ||
    textEntriesAdded > 0;
  if (changed) {
    const animationDetail = animationBundle
      ? ` Included ${animationBundle.moves.length} White2Upgrade Gen 6-7 animation scripts and their particle and background dependencies.`
      : "";
    recordGenericChange(
      project,
      "patches",
      `Expanded the move tables to ${MOVE_EXPANSION_TARGET_COUNT} entries and installed Frost-compatible animation routing.${animationDetail}`,
      "Move Expansion",
      { key: "patch:moveExpansion" },
    );
  }

  return {
    changed,
    routingChanged: commandPatch.status === "applied" || routingPatch.status === "applied",
    overlayId: layout.loaderOverlayId,
    helperOffset: routingPatch.helperOffset,
    movesAdded: moveSummary.added,
    animationsAdded: animationSummary.added,
    textEntriesAdded,
    importedMovesAdded: moveSummary.imported,
    fairyMovesMappedToNormal: moveSummary.fairyMovesMappedToNormal,
    bundledAnimationsIncluded: Boolean(animationBundle),
    bundledAnimationsInstalled: animationBundle?.moves.length ?? 0,
    particleFilesInstalled: bundledAnimationSummary.particlesAdded,
    particleReferencesRemapped: bundledAnimationSummary.referencesRemapped,
    backgroundFilesInstalled: bundledAnimationSummary.backgroundFilesAdded,
    overlayLoadSizeRepaired,
  };
}

export function detectMoveExpansionPatch(project: ProjectState): MoveExpansionPatchState {
  if (!isGen5BaseRom(project.session.baseRom)) return "unsupported";
  const routing = detectProjectMoveExpansionRouting(project);
  if (routing === "unknown") return project.patches?.applied?.moveExpansion ? "patched" : "unknown";
  if (routing === "unpatched") return "unpatched";
  return hasExpandedMoveData(project) ? "patched" : "routing-only";
}

export function usesFrostMoveExpansionLayout(project: ProjectState): boolean {
  if (!isGen5BaseRom(project.session.baseRom)) return false;
  if (project.patches?.applied?.moveExpansion) return true;
  return detectProjectMoveExpansionRouting(project) === "patched";
}

export function detectMoveExpansionRoutingHook(
  overlay: Uint8Array,
  baseRom: Gen5BaseRom,
): MoveExpansionRoutingState {
  const layout = ROUTING_LAYOUTS[baseRom];
  if (isCompactRoutingLoader(overlay, baseRom)) return "patched";
  const legacy = isLegacyMoveExpansionRoutingHook(overlay, layout);
  if (baseRom === "BW2") {
    const primaryHookOffset = layout.legacyCallerOffset + 8;
    const primaryHelperOffset = thumbBlTargetOffset(overlay, primaryHookOffset);
    if (
      primaryHelperOffset !== undefined &&
      matchesSequence(overlay, BW2_PRIMARY_LOADER_HELPER, primaryHelperOffset) &&
      layout.secondaryLoaderHookOffset !== undefined &&
      isRecognizedThumbHelper(overlay, layout.secondaryLoaderHookOffset, BW2_SECONDARY_LOADER_HELPER) &&
      matchesSequence(
        overlay,
        BW2_COMMAND_HELPER,
        primaryHelperOffset + BW2_PRIMARY_LOADER_HELPER.length + BW2_SECONDARY_LOADER_HELPER.length,
      )
    ) {
      return "patched";
    }
    if (
      (matchesSequence(overlay, ORIGINAL_ROUTING_CALLER, layout.legacyCallerOffset) || legacy) &&
      layout.secondaryLoaderHookOffset !== undefined &&
      matchesSequence(overlay, ORIGINAL_SECONDARY_LOADER_HOOK, layout.secondaryLoaderHookOffset)
    ) {
      return "unpatched";
    }
    return "unknown";
  }

  const visualHookOffset = layout.legacyCallerOffset + 0x18;
  const visualHelperOffset = thumbBlTargetOffset(overlay, visualHookOffset);
  if (
    visualHelperOffset !== undefined &&
    matchesSequenceIgnoringRange(overlay, BW_VISUAL_HELPER_TEMPLATE, visualHelperOffset, BW_VISUAL_GLOBAL_LITERAL_OFFSET, 4) &&
    matchesSequenceIgnoringRange(
      overlay,
      BW_COMMAND_HELPER_TEMPLATE,
      visualHelperOffset + BW_VISUAL_HELPER_TEMPLATE.length,
      BW_COMMAND_GLOBAL_LITERAL_OFFSET,
      4,
    )
  ) {
    return "patched";
  }
  if (
    (matchesSequence(overlay, ORIGINAL_ROUTING_CALLER, layout.legacyCallerOffset) || legacy) &&
    matchesSequence(overlay, ORIGINAL_BW_VISUAL_HOOK, visualHookOffset)
  ) {
    return "unpatched";
  }
  return "unknown";
}

export function applyMoveExpansionCommandHookToOverlay(
  overlay: Uint8Array,
  baseRom: Gen5BaseRom,
  ramAddress: number,
  _bssSize = 0,
  commandHelperAddress?: number,
): MoveExpansionRoutingPatchResult | undefined {
  const hookOffset = findCommandHookOffset(overlay, baseRom);
  if (hookOffset === undefined) return undefined;
  const existingTarget = decodeThumbBlTarget(overlay, hookOffset, ramAddress + hookOffset);
  if (existingTarget !== undefined) {
    return commandHelperAddress === undefined || existingTarget !== commandHelperAddress
      ? undefined
      : { status: "already-applied", overlay, commandHelperAddress };
  }
  if (!matchesSequence(overlay, ORIGINAL_COMMAND_HOOK, hookOffset) || commandHelperAddress === undefined) return undefined;

  const out = overlay.slice();
  writeThumbBl(out, hookOffset, ramAddress + hookOffset, commandHelperAddress);
  return { status: "applied", overlay: out, commandHelperAddress };
}

// Frost's BW1 Fairy patch prepends code to overlay 93 and lowers its RAM base.
// Locate the original instruction context rather than patching its old file offset.
function findCommandHookOffset(overlay: Uint8Array, baseRom: Gen5BaseRom): number | undefined {
  const originalOffset = ROUTING_LAYOUTS[baseRom].commandHookOffset;
  const isHook = (offset: number) =>
    matchesSequence(overlay, [0x08, 0x98, 0x39, 0x1c, 0x00, 0x90, 0x09, 0x98], offset - 8) &&
    matchesSequence(overlay, [0x08, 0xa8, 0x00, 0x7a, 0x02, 0x90], offset + 4) &&
    (matchesSequence(overlay, ORIGINAL_COMMAND_HOOK, offset) || isThumbBl(overlay, offset));
  if (isHook(originalOffset)) return originalOffset;
  const matches: number[] = [];
  for (let offset = 8; offset + 10 <= overlay.length; offset += 2) {
    if (isHook(offset)) matches.push(offset);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

// Legacy appended format, retained for recognizing/migrating imported ROMs and
// constructing compatibility fixtures. New installs must use the paired planner.
export function applyMoveExpansionRoutingHookToOverlay(
  overlay: Uint8Array,
  baseRom: Gen5BaseRom,
  ramAddress: number,
  bssSize = 0,
): MoveExpansionRoutingPatchResult | undefined {
  const state = detectMoveExpansionRoutingHook(overlay, baseRom);
  if (state === "unknown") return undefined;
  if (state === "patched") {
    const layout = ROUTING_LAYOUTS[baseRom];
    const firstHookOffset = baseRom === "BW2" ? layout.legacyCallerOffset + 8 : layout.legacyCallerOffset + 0x18;
    const firstHelperAddress = decodeThumbBlTarget(overlay, firstHookOffset, ramAddress + firstHookOffset);
    if (firstHelperAddress === undefined) return undefined;
    const firstHelperOffset = firstHelperAddress - ramAddress;
    if (baseRom === "BW2") {
      const commandHelperAddress = ramAddress + firstHelperOffset + BW2_PRIMARY_LOADER_HELPER.length + BW2_SECONDARY_LOADER_HELPER.length;
      return { status: "already-applied", overlay, helperOffset: firstHelperOffset, commandHelperAddress };
    }
    const commandHelperAddress = ramAddress + firstHelperOffset + BW_VISUAL_HELPER_TEMPLATE.length;
    const globalAddress = commandHelperAddress + BW_COMMAND_GLOBAL_OFFSET;
    if (
      readU32(overlay, firstHelperOffset + BW_VISUAL_GLOBAL_LITERAL_OFFSET) !== globalAddress ||
      readU32(overlay, commandHelperAddress - ramAddress + BW_COMMAND_GLOBAL_LITERAL_OFFSET) !== globalAddress ||
      globalAddress - ramAddress + 4 > overlay.length
    ) return undefined;
    if (isLegacyMoveExpansionRoutingHook(overlay, layout)) {
      const out = overlay.slice();
      out.set(ORIGINAL_ROUTING_CALLER, layout.legacyCallerOffset);
      return { status: "applied", overlay: out, helperOffset: firstHelperOffset, commandHelperAddress, globalAddress };
    }
    if (!matchesSequence(overlay, ORIGINAL_ROUTING_CALLER, layout.legacyCallerOffset)) return undefined;
    return { status: "already-applied", overlay, helperOffset: firstHelperOffset, commandHelperAddress, globalAddress };
  }

  // Materialize the original BSS as zero-filled static data before appending
  // code. This keeps every compiled BSS address valid when the overlay's
  // static RAM size is increased by the exporter.
  const layout = ROUTING_LAYOUTS[baseRom];
  const helperOffset = align(overlay.length + bssSize, 4);
  if (baseRom === "BW2") {
    const secondaryHookOffset = layout.secondaryLoaderHookOffset;
    if (secondaryHookOffset === undefined) return undefined;
    const secondaryHelperOffset = helperOffset + BW2_PRIMARY_LOADER_HELPER.length;
    const commandHelperOffset = secondaryHelperOffset + BW2_SECONDARY_LOADER_HELPER.length;
    const out = new Uint8Array(commandHelperOffset + BW2_COMMAND_HELPER.length);
    out.set(overlay);
    out.set(BW2_PRIMARY_LOADER_HELPER, helperOffset);
    out.set(BW2_SECONDARY_LOADER_HELPER, secondaryHelperOffset);
    out.set(BW2_COMMAND_HELPER, commandHelperOffset);
    // Remove Pokeweb's legacy one-loader hook if this ROM already had it.
    out.set(ORIGINAL_ROUTING_CALLER, layout.legacyCallerOffset);
    const primaryHookOffset = layout.legacyCallerOffset + 8;
    writeThumbBl(out, primaryHookOffset, ramAddress + primaryHookOffset, ramAddress + helperOffset);
    writeThumbBl(out, secondaryHookOffset, ramAddress + secondaryHookOffset, ramAddress + secondaryHelperOffset);
    return { status: "applied", overlay: out, helperOffset, commandHelperAddress: ramAddress + commandHelperOffset };
  }

  const commandHelperOffset = helperOffset + BW_VISUAL_HELPER_TEMPLATE.length;
  const globalOffset = commandHelperOffset + BW_COMMAND_GLOBAL_OFFSET;
  const globalAddress = ramAddress + globalOffset;
  const visualHelper = BW_VISUAL_HELPER_TEMPLATE.slice();
  const commandHelper = BW_COMMAND_HELPER_TEMPLATE.slice();
  writeU32(visualHelper, BW_VISUAL_GLOBAL_LITERAL_OFFSET, globalAddress);
  writeU32(commandHelper, BW_COMMAND_GLOBAL_LITERAL_OFFSET, globalAddress);
  const out = new Uint8Array(globalOffset + 4);
  out.set(overlay);
  out.set(visualHelper, helperOffset);
  out.set(commandHelper, commandHelperOffset);
  out.set(ORIGINAL_ROUTING_CALLER, layout.legacyCallerOffset);
  const visualHookOffset = layout.legacyCallerOffset + 0x18;
  writeThumbBl(out, visualHookOffset, ramAddress + visualHookOffset, ramAddress + helperOffset);
  return { status: "applied", overlay: out, helperOffset, commandHelperAddress: ramAddress + commandHelperOffset, globalAddress };
}

// The loader ends in one pointer plus 28 bytes of BSS alignment padding.
// Materialize those 32 bytes and set BSS size to zero: increasing the native
// footprint would collide with party-selection overlays during battle.
// BW1 stores the real expanded ID separately; the command carries placeholder 1.
const COMPACT_BW_VISUAL = Uint8Array.of(0x09, 0x49, 0x00, 0x29, 0x00, 0xd1, 0x31, 0x00, 0x1a, 0x40, 0x70, 0x47);
const COMPACT_BW_COMMAND = Uint8Array.of(
  0x01, 0x90, 0x05, 0x48, 0xf3, 0x08, 0x55, 0x2b, 0x02, 0xd3, 0x06, 0x80, 0x01, 0x23, 0x70, 0x47,
  0x00, 0x23, 0x03, 0x80, 0x33, 0x00, 0x70, 0x47, 0, 0, 0, 0,
);
// BW2 carries moveId+115. Both loaders return Z=1 only for lifecycle IDs
// 561..794, and Z=0 for normal/expanded move files; their callers branch on EQ.
const COMPACT_BW2_COMMAND = Uint8Array.of(0x01, 0x90, 0x33, 0x00, 0xf0, 0x08, 0x55, 0x28, 0x00, 0xd3, 0x73, 0x33, 0x70, 0x47);
const COMPACT_BW2_PRIMARY = Uint8Array.of(0x0b, 0x4b, 0x81, 0x42, 0x03, 0xdb, 0x09, 0x48, 0x81, 0x42, 0x01, 0xdb, 0x73, 0x3e, 0x70, 0x47, 0x9b, 0x42, 0x70, 0x47);
const COMPACT_BW2_SECONDARY = Uint8Array.of(0x05, 0x4b, 0x84, 0x42, 0x03, 0xdb, 0x03, 0x48, 0x84, 0x42, 0x01, 0xdb, 0x73, 0x3c, 0x70, 0x47, 0x9b, 0x42, 0x70, 0x47);

function nativeRoutingEnd(data: Uint8Array, marker: string): number | undefined {
  const bytes = new TextEncoder().encode(`${marker}\0`);
  let found: number | undefined;
  for (let offset = 0; offset + bytes.length <= data.length; offset++) {
    if (!matchesSequence(data, bytes, offset)) continue;
    if (found !== undefined) return undefined;
    found = align(offset + bytes.length, 32);
  }
  return found !== undefined && found <= data.length ? found : undefined;
}

function isCompactRoutingLoader(data: Uint8Array, baseRom: Gen5BaseRom): boolean {
  const end = nativeRoutingEnd(data, "btlv_finger_cursor.c");
  if (end === undefined || data.length !== end + 32 || readU32(data, end) !== 0) return false;
  const layout = ROUTING_LAYOUTS[baseRom];
  if (baseRom === "BW") {
    return matchesSequence(data, ORIGINAL_ROUTING_CALLER, layout.legacyCallerOffset) &&
      thumbBlTargetOffset(data, layout.legacyCallerOffset + 0x18) === end - 12 &&
      matchesSequence(data, COMPACT_BW_VISUAL, end - 12) && data.slice(end, end + 32).every((byte) => byte === 0);
  }
  return matchesSequence(data, ORIGINAL_ROUTING_CALLER.slice(0, 8), layout.legacyCallerOffset) &&
    thumbBlTargetOffset(data, layout.legacyCallerOffset + 8) === end - 20 &&
    matchesSequence(data, [0x38, 0xd0], layout.legacyCallerOffset + 12) &&
    thumbBlTargetOffset(data, layout.secondaryLoaderHookOffset!) === end + 4 &&
    matchesSequence(data, [0x02, 0xd0], layout.secondaryLoaderHookOffset! + 4) &&
    matchesSequence(data, COMPACT_BW2_PRIMARY, end - 20) &&
    matchesSequence(data, COMPACT_BW2_SECONDARY, end + 4) &&
    readU32(data, end + 24) === FIRST_ROUTED_MOVE_ANIMATION_ID && readU32(data, end + 28) === 0x7fff;
}

/** Plan both overlays together; never truncate unrecognized appended code. */
export function planMoveExpansionRouting(loader: RoutingOverlay, command: RoutingOverlay, baseRom: Gen5BaseRom): {
  loader: MoveExpansionRoutingPatchResult; command: MoveExpansionRoutingPatchResult;
} | undefined {
  const layout = ROUTING_LAYOUTS[baseRom];
  const end = nativeRoutingEnd(loader.data, "btlv_finger_cursor.c");
  const commandEnd = nativeRoutingEnd(command.data, baseRom === "BW" ? "btl_field.c" : "pokewood_cutin.c");
  const hook = findCommandHookOffset(command.data, baseRom);
  if (end === undefined || commandEnd !== command.data.length || hook === undefined) return undefined;
  const compact = isCompactRoutingLoader(loader.data, baseRom);
  const state = detectMoveExpansionRoutingHook(loader.data, baseRom);
  if (state === "unknown" || (compact ? loader.bssSize !== 0 && loader.bssSize !== 32 : loader.bssSize !== 32)) return undefined;
  let oldCommandAddress: number | undefined;
  if (!compact && state === "patched") {
    const old = applyMoveExpansionRoutingHookToOverlay(loader.data, baseRom, loader.ramAddress, loader.bssSize);
    const oldTailLength = baseRom === "BW" ? 60 : 92;
    if (!old || old.helperOffset !== end + 32 || loader.data.length !== end + 32 + oldTailLength ||
        !loader.data.slice(end, end + 32).every((byte) => byte === 0)) return undefined;
    // A vanilla primary caller (or the known Frost caller) and native branch
    // instructions are required in addition to matching the appended helpers.
    if (baseRom === "BW2" && (!matchesSequence(loader.data, ORIGINAL_ROUTING_CALLER.slice(0, 8), layout.legacyCallerOffset) ||
        !matchesSequence(loader.data, [0x38, 0xd2], layout.legacyCallerOffset + 12) ||
        !matchesSequence(loader.data, [0x02, 0xda], layout.secondaryLoaderHookOffset! + 4))) return undefined;
    if (baseRom === "BW" && readU32(loader.data, loader.data.length - 4) !== 0) return undefined;
    if (baseRom === "BW2" && (thumbBlTargetOffset(loader.data, layout.secondaryLoaderHookOffset!) !== end + 32 + BW2_PRIMARY_LOADER_HELPER.length ||
        !matchesSequence(loader.data, BW2_SECONDARY_LOADER_HELPER, end + 32 + BW2_PRIMARY_LOADER_HELPER.length))) return undefined;
    oldCommandAddress = old.commandHelperAddress;
  } else if (!compact && (loader.data.length !== end || loader.ramSize !== end)) return undefined;

  const commandTemplate = baseRom === "BW" ? COMPACT_BW_COMMAND.slice() : COMPACT_BW2_COMMAND.slice();
  const commandOffset = commandEnd - commandTemplate.length;
  const visualOffset = end - (baseRom === "BW" ? 12 : 20);
  if (baseRom === "BW") writeU32(commandTemplate, 24, loader.ramAddress + end + 28);
  const commandAddress = command.ramAddress + commandOffset;
  const existingCommandAddress = decodeThumbBlTarget(command.data, hook, command.ramAddress + hook);
  if (command.data[commandOffset - 1] !== 0 || loader.data[visualOffset - 1] !== 0) return undefined;
  if (compact) {
    if (existingCommandAddress !== commandAddress || !matchesSequence(command.data, commandTemplate, commandOffset)) return undefined;
  } else {
    if (!command.data.slice(commandOffset).every((byte) => byte === 0) ||
        !loader.data.slice(visualOffset, end).every((byte) => byte === 0)) return undefined;
    if (oldCommandAddress !== undefined ? existingCommandAddress !== oldCommandAddress : !matchesSequence(command.data, ORIGINAL_COMMAND_HOOK, hook)) return undefined;
    if (baseRom === "BW2" && !matchesSequence(loader.data, [0x02, 0xda], layout.secondaryLoaderHookOffset! + 4)) return undefined;
    // Reject ROMs using the padding as additional globals. The native pointer
    // at end is retained, including its zero initialization and all references.
    for (let offset = 0; offset + 4 <= end; offset += 4) {
      const address = readU32(loader.data, offset);
      if (address >= loader.ramAddress + end + 4 && address < loader.ramAddress + end + 32) return undefined;
    }
  }

  const out = new Uint8Array(end + 32);
  out.set(loader.data.subarray(0, end));
  out.set(ORIGINAL_ROUTING_CALLER, layout.legacyCallerOffset);
  if (baseRom === "BW") {
    out.set(COMPACT_BW_VISUAL, visualOffset);
    writeThumbBl(out, layout.legacyCallerOffset + 0x18, loader.ramAddress + layout.legacyCallerOffset + 0x18, loader.ramAddress + visualOffset);
  } else {
    out.set(COMPACT_BW2_PRIMARY, visualOffset);
    out.set(COMPACT_BW2_SECONDARY, end + 4);
    writeU32(out, end + 24, FIRST_ROUTED_MOVE_ANIMATION_ID);
    writeU32(out, end + 28, 0x7fff);
    writeThumbBl(out, layout.legacyCallerOffset + 8, loader.ramAddress + layout.legacyCallerOffset + 8, loader.ramAddress + visualOffset);
    out.set([0x38, 0xd0], layout.legacyCallerOffset + 12);
    writeThumbBl(out, layout.secondaryLoaderHookOffset!, loader.ramAddress + layout.secondaryLoaderHookOffset!, loader.ramAddress + end + 4);
    out.set([0x02, 0xd0], layout.secondaryLoaderHookOffset! + 4);
  }
  const commandOut = command.data.slice();
  commandOut.set(commandTemplate, commandOffset);
  writeThumbBl(commandOut, hook, command.ramAddress + hook, commandAddress);
  return {
    loader: { status: bytesEqual(loader.data, out) ? "already-applied" : "applied", overlay: out },
    command: { status: bytesEqual(command.data, commandOut) ? "already-applied" : "applied", overlay: commandOut, commandHelperAddress: commandAddress },
  };
}

function expandMoveData(
  project: ProjectState,
  store: NarcStore,
): { added: number; changed: number; imported: number; fairyMovesMappedToNormal: number; seededIds: Set<number> } {
  const start = store.rawFiles.length;
  const blank = (store.rawFiles[0] ?? store.rawFiles[1] ?? new Uint8Array(34)).slice();
  const pound = store.rawFiles[1];
  const config = MOVE_TEXT_BANKS[project.session.baseRom as Gen5BaseRom];
  const nameBank = getTextBank(project, "message_texts", config.name);
  const poundName = textAtEntry(nameBank, 1) || "Pound";
  const seededIds = new Set<number>();

  for (let moveId = start; moveId < MOVE_EXPANSION_TARGET_COUNT; moveId += 1) {
    const source = EXPANSION_MOVE_BY_TARGET.get(moveId);
    const bytes = source ? encodeExpansionMove(source, project.session.fairy) : blank.slice();
    store.rawFiles.push(bytes);
    store.fileCount = store.rawFiles.length;
    store.records.delete(moveId);
    markDirty(project, "moves", moveId);
    seededIds.add(moveId);
  }

  // Frost's own expansion fills every new record with Pound. Upgrade only
  // untouched Pound placeholders; custom expanded records remain intact.
  if (pound) {
    for (let moveId = MOVE_EXPANSION_FIRST_USABLE_ID; moveId < Math.min(start, MOVE_EXPANSION_TARGET_COUNT); moveId += 1) {
      const existing = store.rawFiles[moveId];
      const currentName = textAtEntry(nameBank, moveId);
      if (!existing || !isUntouchedExpansionPlaceholder(existing, pound, currentName, poundName, moveId)) continue;
      const source = EXPANSION_MOVE_BY_TARGET.get(moveId);
      store.rawFiles[moveId] = source ? encodeExpansionMove(source, project.session.fairy) : blank.slice();
      store.records.delete(moveId);
      markDirty(project, "moves", moveId);
      seededIds.add(moveId);
    }
  }

  const imported = [...seededIds].filter((moveId) => EXPANSION_MOVE_BY_TARGET.has(moveId)).length;
  const fairyMovesMappedToNormal = project.session.fairy
    ? 0
    : [...seededIds].filter((moveId) => EXPANSION_MOVE_BY_TARGET.get(moveId)?.data[TYPE_FIELD] === FAIRY_TYPE_ID).length;
  return {
    added: Math.max(0, MOVE_EXPANSION_TARGET_COUNT - start),
    changed: seededIds.size,
    imported,
    fairyMovesMappedToNormal,
    seededIds,
  };
}

function expandMoveAnimations(
  project: ProjectState,
  moveStore: NarcStore,
  animationStore: NarcStore,
  seededIds: Set<number>,
): { added: number; changed: number } {
  const start = animationStore.rawFiles.length;
  let replaced = 0;
  for (let moveId = start; moveId < MOVE_EXPANSION_TARGET_COUNT; moveId += 1) {
    const source = EXPANSION_MOVE_BY_TARGET.get(moveId);
    const donorId = source ? chooseVanillaAnimationDonor(source, moveStore, animationStore, project.session.fairy) : 1;
    const donor = animationStore.rawFiles[donorId] ?? animationStore.rawFiles[1] ?? animationStore.rawFiles[0];
    if (!donor) throw new Error("The move animation NARC does not contain a usable vanilla animation.");
    animationStore.rawFiles.push(donor.slice());
    animationStore.fileCount = animationStore.rawFiles.length;
    animationStore.records.delete(moveId);
    markDirty(project, "move_animations", moveId);
  }

  const poundAnimation = animationStore.rawFiles[1];
  if (poundAnimation) {
    for (const moveId of seededIds) {
      if (moveId >= start) continue;
      const source = EXPANSION_MOVE_BY_TARGET.get(moveId);
      const existing = animationStore.rawFiles[moveId];
      if (!source || !existing || !bytesEqual(existing, poundAnimation)) continue;
      const donorId = chooseVanillaAnimationDonor(source, moveStore, animationStore, project.session.fairy);
      const donor = animationStore.rawFiles[donorId] ?? poundAnimation;
      if (bytesEqual(existing, donor)) continue;
      animationStore.rawFiles[moveId] = donor.slice();
      animationStore.records.delete(moveId);
      markDirty(project, "move_animations", moveId);
      replaced += 1;
    }
  }
  const added = Math.max(0, MOVE_EXPANSION_TARGET_COUNT - start);
  return { added, changed: added + replaced };
}

function chooseVanillaAnimationDonor(
  source: ExpansionMove,
  moveStore: NarcStore,
  animationStore: NarcStore,
  fairyInstalled: boolean,
): number {
  const hinted = source.data[EFFECT_FIELD] ?? 0;
  if (hinted > 0 && hinted <= 559 && animationStore.rawFiles[hinted]) return hinted;

  const sourceType = !fairyInstalled && source.data[TYPE_FIELD] === FAIRY_TYPE_ID ? NORMAL_TYPE_ID : source.data[TYPE_FIELD];
  const sourceCategory = source.data[requiredMoveFieldIndex("category")] ?? 0;
  const sourcePower = source.data[requiredMoveFieldIndex("power")] ?? 0;
  let bestId = animationStore.rawFiles[1] ? 1 : 0;
  let bestScore = Number.POSITIVE_INFINITY;
  const candidateCount = Math.min(560, moveStore.rawFiles.length, animationStore.rawFiles.length);
  for (let moveId = 1; moveId < candidateCount; moveId += 1) {
    const bytes = moveStore.rawFiles[moveId];
    if (!bytes || !animationStore.rawFiles[moveId]) continue;
    const typePenalty = bytes[0] === sourceType ? 0 : 1000;
    const categoryPenalty = bytes[2] === sourceCategory ? 0 : 400;
    const powerPenalty = sourceCategory === 0 ? Math.abs(bytes[3]) : Math.abs(bytes[3] - sourcePower);
    const score = typePenalty + categoryPenalty + powerPenalty;
    if (score >= bestScore) continue;
    bestScore = score;
    bestId = moveId;
  }
  return bestId;
}

function encodeExpansionMove(source: ExpansionMove, fairyInstalled: boolean): Uint8Array {
  const values = source.data.slice();
  // AISeqNo values above the Gen-5 table are unsafe without W2U's runtime.
  // Expanded moves use the generic AI path and do not install event handlers.
  values[EFFECT_FIELD] = 0;
  if (!fairyInstalled && values[TYPE_FIELD] === FAIRY_TYPE_ID) values[TYPE_FIELD] = NORMAL_TYPE_ID;

  const length = EXPANSION_ASSET.fields.reduce((sum, field) => sum + MOVE_FIELD_WIDTH[field], 0);
  const out = new Uint8Array(length);
  let offset = 0;
  EXPANSION_ASSET.fields.forEach((field, index) => {
    const width = MOVE_FIELD_WIDTH[field];
    const value = values[index] ?? 0;
    if (width === 1) out[offset] = value & 0xff;
    else writeU16(out, offset, value);
    offset += width;
  });
  return out;
}

function expandMoveText(project: ProjectState, originalMoveCount: number, seededIds: Set<number>): number {
  const config = MOVE_TEXT_BANKS[project.session.baseRom as Gen5BaseRom];
  const roles = [config.name, config.uppercase, config.description, config.battle];
  const banks = new Map(roles.map((bankId) => [bankId, getTextBank(project, "message_texts", bankId)] as const));
  for (const [bankId, bank] of banks) {
    if (bank.length === 0) throw new Error(`Move Expansion requires message text bank ${bankId}.`);
  }

  const nameBank = banks.get(config.name)!;
  const uppercaseBank = banks.get(config.uppercase)!;
  const descriptionBank = banks.get(config.description)!;
  const battleBank = banks.get(config.battle)!;
  const beforeCounts = new Map<number, number>([
    [config.name, textBankEntryCount(nameBank)],
    [config.uppercase, textBankEntryCount(uppercaseBank)],
    [config.description, textBankEntryCount(descriptionBank)],
    [config.battle, textBankEntryCount(battleBank)],
  ]);
  const poundName = textAtEntry(nameBank, 1) || "Pound";
  const battleTemplates = [0, 1, 2].map((offset) => textAtEntry(battleBank, 3 + offset));

  let added = 0;
  added += ensureTextEntryCount(nameBank, MOVE_EXPANSION_TARGET_COUNT);
  added += ensureTextEntryCount(uppercaseBank, MOVE_EXPANSION_TARGET_COUNT);
  added += ensureTextEntryCount(descriptionBank, MOVE_EXPANSION_TARGET_COUNT);
  added += ensureTextEntryCount(battleBank, MOVE_EXPANSION_TARGET_COUNT * 3);

  for (let moveId = FIRST_RESERVED_MOVE_ID; moveId < MOVE_EXPANSION_TARGET_COUNT; moveId += 1) {
    const source = EXPANSION_MOVE_BY_TARGET.get(moveId);
    const name = source?.name ?? (moveId < MOVE_EXPANSION_FIRST_USABLE_ID ? "DontUse" : `Expanded Move ${moveId}`);
    const uppercase = source?.uppercaseName ?? name.toUpperCase();
    const description = source?.description ?? "";
    const force = seededIds.has(moveId);
    setSeedText(nameBank, moveId, beforeCounts.get(config.name)!, name, force);
    setSeedText(uppercaseBank, moveId, beforeCounts.get(config.uppercase)!, uppercase, force);
    setSeedText(descriptionBank, moveId, beforeCounts.get(config.description)!, description, force);
    for (let offset = 0; offset < 3; offset += 1) {
      const template = battleTemplates[offset] || `${poundName}!`;
      setSeedText(
        battleBank,
        moveId * 3 + offset,
        beforeCounts.get(config.battle)!,
        template.split(poundName).join(name),
        force,
      );
    }
  }

  if (added > 0 || seededIds.size > 0 || originalMoveCount < MOVE_EXPANSION_TARGET_COUNT) {
    for (const bankId of roles) commitTextBank(project, "message_texts", bankId);
  }
  return added;
}

function ensureTextEntryCount(bank: ReturnType<typeof getTextBank>, required: number): number {
  const current = textBankEntryCount(bank);
  if (current >= required) return 0;
  const blocks = [...new Set(bank.map((entry) => parseTextEntryId(entry[0]).block))].sort((a, b) => a - b);
  for (let entry = current; entry < required; entry += 1) {
    for (const block of blocks) bank.push([`${block}_${entry}`, "", 0]);
  }
  bank.sort((left, right) => {
    const a = parseTextEntryId(left[0]);
    const b = parseTextEntryId(right[0]);
    return a.block - b.block || a.entry - b.entry;
  });
  return required - current;
}

function textBankEntryCount(bank: ReturnType<typeof getTextBank>): number {
  return Math.max(0, ...bank.map((entry) => parseTextEntryId(entry[0]).entry + 1));
}

function textAtEntry(bank: ReturnType<typeof getTextBank>, entryIndex: number): string {
  return bank.find((entry) => {
    const id = parseTextEntryId(entry[0]);
    return id.block === 0 && id.entry === entryIndex;
  })?.[1] ?? "";
}

function setSeedText(
  bank: ReturnType<typeof getTextBank>,
  entryIndex: number,
  originalCount: number,
  value: string,
  force: boolean,
): void {
  if (entryIndex < originalCount && !force) return;
  for (const entry of bank) {
    if (parseTextEntryId(entry[0]).entry === entryIndex) entry[1] = value;
  }
}

async function loadMoveExpansionAnimationBundle(): Promise<MoveExpansionAnimationBundle> {
  animationBundlePromise ??= fetch(white2UpgradeMoveAnimationsUrl)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Could not load the bundled Gen 6-7 move animations (${response.status}).`);
      return parseMoveExpansionAnimationBundle(new Uint8Array(await response.arrayBuffer()));
    })
    .catch((error) => {
      animationBundlePromise = undefined;
      throw error;
    });
  return animationBundlePromise;
}

export function parseMoveExpansionAnimationBundle(bytes: Uint8Array): MoveExpansionAnimationBundle {
  const entries = unzipSync(bytes);
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new Error("The move-expansion animation bundle is missing manifest.json.");
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
    format?: unknown;
    version?: unknown;
    generation?: unknown;
    generations?: unknown;
    moves?: unknown;
    particles?: unknown;
    backgrounds?: unknown;
  };
  const legacyGen6 = manifest.version === 1 && manifest.generation === 6;
  const currentGen6Gen7 =
    (manifest.version === 2 || manifest.version === 3) &&
    Array.isArray(manifest.generations) &&
    manifest.generations.length === 2 &&
    manifest.generations[0] === 6 &&
    manifest.generations[1] === 7;
  if (manifest.format !== "pokeweb-move-expansion-animations" || (!legacyGen6 && !currentGen6Gen7)) {
    throw new Error("The move-expansion animation bundle has an unsupported format or version.");
  }
  if (!Array.isArray(manifest.moves) || !Array.isArray(manifest.particles)) {
    throw new Error("The move-expansion animation bundle manifest is incomplete.");
  }
  const completeAssets = manifest.version === 3;
  if (completeAssets && !Array.isArray(manifest.backgrounds)) throw new Error("The animation bundle is missing background dependencies.");

  const moves = manifest.moves.map((value) => {
    const entry = value as Record<string, unknown>;
    const sourceMoveId = requiredBundleInteger(entry.sourceMoveId, "source move ID");
    const targetMoveId = requiredBundleInteger(entry.targetMoveId, `target move ID for source move ${sourceMoveId}`);
    const animation = requiredBundlePath(entry.animation, `animation path for source move ${sourceMoveId}`);
    const particleIds = requiredBundleIntegerArray(entry.particleIds, `particle IDs for source move ${sourceMoveId}`);
    const backgroundIds = completeAssets ? requiredBundleIntegerArray(entry.backgroundIds, `background IDs for source move ${sourceMoveId}`) : [];
    const animationBytes = entries[animation];
    if (!animationBytes) throw new Error(`The move-expansion animation bundle is missing ${animation}.`);
    const expectedTarget = targetMoveIdForSource(sourceMoveId);
    if (expectedTarget !== targetMoveId) {
      throw new Error(`The move-expansion animation bundle maps source move ${sourceMoveId} to ${targetMoveId}; expected ${expectedTarget}.`);
    }
    return { sourceMoveId, targetMoveId, particleIds, backgroundIds, bytes: animationBytes };
  });

  const particles = manifest.particles.map((value) => {
    const entry = value as Record<string, unknown>;
    const sourceParticleId = requiredBundleInteger(entry.sourceParticleId, "source particle ID");
    const particle = requiredBundlePath(entry.particle, `particle path for SPA ${sourceParticleId}`);
    const particleBytes = entries[particle];
    if (!particleBytes) throw new Error(`The move-expansion animation bundle is missing ${particle}.`);
    return { sourceParticleId, bytes: particleBytes };
  });
  const backgrounds = ((manifest.backgrounds ?? []) as unknown[]).map((value) => {
    const entry = value as Record<string, unknown>;
    const sourceBackgroundId = requiredBundleInteger(entry.sourceBackgroundId, "source background ID");
    if (!Array.isArray(entry.files) || entry.files.length !== 3) throw new Error(`Background ${sourceBackgroundId} needs three files.`);
    const files = entry.files.map((value) => {
      const path = requiredBundlePath(value, `background ${sourceBackgroundId} file`);
      if (!entries[path]) throw new Error(`The move-expansion animation bundle is missing ${path}.`);
      return entries[path];
    });
    return { sourceBackgroundId, files };
  });
  const bundledParticleIds = new Set(particles.map((particle) => particle.sourceParticleId));
  const bundledBackgroundIds = new Set(backgrounds.map((background) => background.sourceBackgroundId));
  for (const move of moves) {
    for (const particleId of move.particleIds) {
      if ((completeAssets || particleId >= FIRST_BW2_ONLY_MOVE_PARTICLE_ID) && !bundledParticleIds.has(particleId)) {
        throw new Error(`Bundled animation ${move.sourceMoveId} requires particle file ${particleId}, which is not bundled.`);
      }
    }
    for (const backgroundId of move.backgroundIds) {
      if (!bundledBackgroundIds.has(backgroundId)) throw new Error(`Bundled animation ${move.sourceMoveId} requires background ${backgroundId}, which is not bundled.`);
    }
  }
  return { completeAssets, moves, particles, backgrounds };
}

export function allocateMoveExpansionParticleAssets(
  store: NarcStore,
  particles: readonly MoveExpansionBundledParticle[],
): MoveExpansionParticleAllocation {
  const particleIdMap = new Map<number, number>();
  const addedIds: number[] = [];
  for (const particle of [...particles].sort((left, right) => left.sourceParticleId - right.sourceParticleId)) {
    let targetId = store.rawFiles.findIndex((existing) => bytesEqual(existing, particle.bytes));
    if (targetId < 0) {
      targetId = store.rawFiles.length;
      store.rawFiles.push(particle.bytes.slice());
      store.fileCount = store.rawFiles.length;
      store.records.delete(targetId);
      addedIds.push(targetId);
    }
    particleIdMap.set(particle.sourceParticleId, targetId);
  }
  return { particleIdMap, addedIds };
}

async function installBundledMoveAnimations(
  project: ProjectState,
  animationStore: NarcStore,
  particleStore: NarcStore,
  bundle: MoveExpansionAnimationBundle,
): Promise<{ animationsChanged: number; particlesAdded: number; backgroundFilesAdded: number; referencesRemapped: number }> {
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the ROM before installing animation assets.");
  const rom = new NintendoDSRom(romBytes, { fileData: "view" });
  const backgroundFileId = rom.fileId(moveBackgroundArchivePath(project.session.baseRom as Gen5BaseRom));
  const backgroundArchive = new NARC(getRomFileBytes(project, rom, backgroundFileId));
  const backgrounds = allocateMoveExpansionBackgroundAssets(backgroundArchive.files, bundle.backgrounds);

  const { remapMoveAnimationAssets } = await import("./moveAnimationModel");
  const allocation = allocateMoveExpansionParticleAssets(particleStore, bundle.particles);
  for (const particleId of allocation.addedIds) markDirty(project, "move_spas", particleId);
  if (backgrounds.filesAdded > 0) replaceRomFile(project, rom, backgroundFileId, backgroundArchive.save());
  let animationsChanged = 0;
  let referencesRemapped = 0;
  for (const move of bundle.moves) {
    const remapped = remapMoveAnimationAssets(move.bytes, allocation.particleIdMap, backgrounds.backgroundIdMap, project.session.baseRom as Gen5BaseRom);
    referencesRemapped += remapped.particleReferencesChanged;
    const existing = animationStore.rawFiles[move.targetMoveId];
    if (existing && bytesEqual(existing, remapped.bytes)) continue;
    animationStore.rawFiles[move.targetMoveId] = remapped.bytes;
    animationStore.fileCount = animationStore.rawFiles.length;
    animationStore.records.delete(move.targetMoveId);
    markDirty(project, "move_animations", move.targetMoveId);
    animationsChanged += 1;
  }
  if (allocation.addedIds.length > 0 || backgrounds.filesAdded > 0) {
    const { invalidateMoveBackgroundCache, invalidateMoveSpaArchiveCache } = await import("./moveAnimationPreviewModel");
    invalidateMoveBackgroundCache(project);
    invalidateMoveSpaArchiveCache(project);
  }
  return { animationsChanged, particlesAdded: allocation.addedIds.length, backgroundFilesAdded: backgrounds.filesAdded, referencesRemapped };
}

export function moveBackgroundArchivePath(baseRom: Gen5BaseRom): string {
  return baseRom === "BW" ? "a/0/9/5" : "a/0/9/4";
}

export function allocateMoveExpansionBackgroundAssets(files: Uint8Array[], backgrounds: readonly MoveExpansionBundledBackground[]) {
  const backgroundIdMap = new Map<number, number>();
  const originalLength = files.length;
  for (const background of [...backgrounds].sort((a, b) => a.sourceBackgroundId - b.sourceBackgroundId)) {
    if (background.files.length !== 3) throw new Error("Move backgrounds require a screen, characters, and palette triplet.");
    let targetId = files.findIndex((_file, index) => background.files.every((bytes, part) => files[index + part] && bytesEqual(files[index + part], bytes)));
    if (targetId < 0) {
      targetId = files.length;
      files.push(...background.files.map((bytes) => bytes.slice()));
    }
    backgroundIdMap.set(background.sourceBackgroundId, targetId);
  }
  return { backgroundIdMap, filesAdded: files.length - originalLength };
}

function requiredBundleInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`The move-expansion animation bundle has an invalid ${label}.`);
  return value as number;
}

function requiredBundleIntegerArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) throw new Error(`The move-expansion animation bundle has invalid ${label}.`);
  return value.map((entry) => requiredBundleInteger(entry, label));
}

function requiredBundlePath(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.includes("..")) {
    throw new Error(`The move-expansion animation bundle has an invalid ${label}.`);
  }
  return value;
}

function targetMoveIdForSource(sourceMoveId: number): number | undefined {
  const index = EXPANSION_MOVES.findIndex((move) => move.sourceId === sourceMoveId);
  return index < 0 ? undefined : EXPANSION_ASSET.firstTargetMoveId + index;
}

async function ensureExpansionStores(
  project: ProjectState,
  includeMoveSpas: boolean,
): Promise<{ moves: NarcStore; moveAnimations: NarcStore; moveSpas?: NarcStore }> {
  const [moves, moveAnimations, , moveSpas] = await Promise.all([
    ensureNarcStore(project, "moves"),
    ensureNarcStore(project, "move_animations"),
    ensureNarcStore(project, "message_texts"),
    includeMoveSpas ? ensureNarcStore(project, "move_spas") : Promise.resolve(undefined),
  ]);
  return { moves, moveAnimations, moveSpas };
}

async function ensureNarcStore(
  project: ProjectState,
  name: Extract<NarcName, "moves" | "move_animations" | "message_texts" | "move_spas">,
): Promise<NarcStore> {
  const existing = project.narcs[name];
  if (existing) return existing;
  const definitions = name === "message_texts" ? HEADER_NARCS : project.session.baseRom === "BW" ? BW_NARCS : BW2_NARCS;
  const definition = definitions.find((entry) => entry.name === name);
  if (!definition) throw new Error(`Missing NARC definition for ${name}.`);
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the ROM before installing Move Expansion.");
  const rom = new NintendoDSRom(romBytes);
  const fileId = rom.fileId(definition.path);
  const sourceBytes = project.fileSystem?.replacements[fileId] ?? rom.files[fileId];
  const store = createNarcStore(name, definition.path, fileId, new NARC(sourceBytes));
  project.session.fileIds[name] = fileId;
  project.narcs[name] = store;
  project.session.blacklist = project.session.blacklist.filter((entry) => entry !== name);
  return store;
}

async function ensureRoutingOverlay(project: ProjectState, overlayId: number): Promise<RoutingOverlay> {
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the ROM before installing Move Expansion.");
  const rom = new NintendoDSRom(romBytes);
  const table = project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable;
  const metadata = findOverlayMetadata(table, overlayId);
  if (!metadata) throw new Error(`Could not find overlay ${overlayId} in the ARM9 overlay table.`);
  const existing = project.overlays[overlayId];
  if (existing?.length) return { data: existing, ...metadata };
  const overlay = rom.loadArm9Overlays([overlayId]).get(overlayId);
  if (!overlay) throw new Error(`Could not load overlay ${overlayId} from this ROM.`);
  project.overlays[overlayId] = overlay.data;
  return { data: overlay.data, ...metadata };
}

function findOverlayMetadata(table: Uint8Array, overlayId: number): { ramAddress: number; ramSize: number; bssSize: number } | undefined {
  for (let offset = 0; offset + 32 <= table.length; offset += 32) {
    if (readU32(table, offset) !== overlayId) continue;
    return { ramAddress: readU32(table, offset + 4), ramSize: readU32(table, offset + 8), bssSize: readU32(table, offset + 12) };
  }
  return undefined;
}

function detectProjectMoveExpansionRouting(project: ProjectState): MoveExpansionRoutingState {
  const baseRom = project.session.baseRom;
  if (!isGen5BaseRom(baseRom)) return "unknown";
  const layout = ROUTING_LAYOUTS[baseRom];
  const loadedLoaderOverlay = project.overlays[layout.loaderOverlayId];
  const loadedCommandOverlay = project.overlays[layout.commandOverlayId];
  const originalRomBytes = project.originalRomBytes;
  const cached = moveExpansionRoutingCache.get(project);
  if (
    cached?.baseRom === baseRom &&
    cached.originalRomBytes === originalRomBytes &&
    cached.loadedLoaderOverlay === loadedLoaderOverlay &&
    cached.loadedCommandOverlay === loadedCommandOverlay
  ) {
    return cached.state;
  }

  let state: MoveExpansionRoutingState = "unknown";
  if (loadedLoaderOverlay?.length && loadedCommandOverlay?.length) {
    state = detectCompleteMoveExpansionRouting(loadedLoaderOverlay, loadedCommandOverlay, baseRom);
  } else if (originalRomBytes) {
    try {
      const overlays = new NintendoDSRom(originalRomBytes).loadArm9Overlays([layout.loaderOverlayId, layout.commandOverlayId]);
      const loaderOverlay = loadedLoaderOverlay ?? overlays.get(layout.loaderOverlayId)?.data;
      const commandOverlay = loadedCommandOverlay ?? overlays.get(layout.commandOverlayId)?.data;
      state = loaderOverlay && commandOverlay
        ? detectCompleteMoveExpansionRouting(loaderOverlay, commandOverlay, baseRom)
        : "unknown";
    } catch {
      state = "unknown";
    }
  }

  moveExpansionRoutingCache.set(project, {
    baseRom,
    originalRomBytes,
    loadedLoaderOverlay,
    loadedCommandOverlay,
    state,
  });
  return state;
}

function detectCompleteMoveExpansionRouting(
  loaderOverlay: Uint8Array,
  commandOverlay: Uint8Array,
  baseRom: Gen5BaseRom,
): MoveExpansionRoutingState {
  const loaderState = detectMoveExpansionRoutingHook(loaderOverlay, baseRom);
  if (loaderState !== "patched") return loaderState;
  const hookOffset = findCommandHookOffset(commandOverlay, baseRom);
  return hookOffset !== undefined && isThumbBl(commandOverlay, hookOffset) ? "patched" : "unpatched";
}

/** Migrate recognized appended helpers without expanding the native RAM footprint.
 * Runs on ordinary export too, including ROMs whose old helpers already load.
 */
export function repairMoveExpansionOverlayLoadSize(project: ProjectState, rom: NintendoDSRom): boolean {
  const baseRom = project.session.baseRom;
  if (!isGen5BaseRom(baseRom)) return false;
  const layout = ROUTING_LAYOUTS[baseRom];
  const table = project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable;
  const loader = findOverlayMetadata(table, layout.loaderOverlayId);
  const command = findOverlayMetadata(table, layout.commandOverlayId);
  if (!loader || !command) return false;
  const overlays = rom.loadArm9Overlays([layout.loaderOverlayId, layout.commandOverlayId]);
  const loaderBytes = project.overlays[layout.loaderOverlayId] ?? overlays.get(layout.loaderOverlayId)?.data;
  const commandBytes = project.overlays[layout.commandOverlayId] ?? overlays.get(layout.commandOverlayId)?.data;
  if (!loaderBytes || !commandBytes || detectMoveExpansionRoutingHook(loaderBytes, baseRom) !== "patched") return false;
  const plan = planMoveExpansionRouting({ ...loader, data: loaderBytes }, { ...command, data: commandBytes }, baseRom);
  if (!plan) return false;
  const metadataChanged = loader.ramSize !== plan.loader.overlay.length || loader.bssSize !== 0;
  if (plan.command.status === "applied") {
    project.overlays[layout.commandOverlayId] = plan.command.overlay;
    markPatchOverlayDirty(project, layout.commandOverlayId);
  }
  if (plan.loader.status === "applied" || metadataChanged) {
    project.overlays[layout.loaderOverlayId] = plan.loader.overlay;
    markPatchOverlayDirty(project, layout.loaderOverlayId);
  }
  if (metadataChanged) updateRoutingOverlayTable(project, rom.arm9OverlayTable, layout.loaderOverlayId, plan.loader.overlay.length);
  return metadataChanged || plan.loader.status === "applied" || plan.command.status === "applied";
}

function updateRoutingOverlayTable(project: ProjectState, originalTable: Uint8Array, overlayId: number, ramSize: number): void {
  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  const table = (project.patches.arm9OverlayTable ?? originalTable).slice();
  for (let offset = 0; offset + 32 <= table.length; offset += 32) {
    if (readU32(table, offset) !== overlayId) continue;
    writeU32(table, offset + 8, ramSize);
    writeU32(table, offset + 12, 0);
    project.patches.arm9OverlayTable = table;
    return;
  }
  throw new Error(`Missing move-animation overlay ${overlayId}.`);
}

function hasExpandedMoveData(project: ProjectState): boolean {
  return (
    (project.narcs.moves?.rawFiles.length ?? 0) >= MOVE_EXPANSION_TARGET_COUNT &&
    (project.narcs.move_animations?.rawFiles.length ?? 0) >= MOVE_EXPANSION_TARGET_COUNT &&
    (project.texts.banks.moves?.length ?? 0) >= MOVE_EXPANSION_TARGET_COUNT &&
    project.texts.banks.moves?.[MOVE_EXPANSION_FIRST_USABLE_ID] === EXPANSION_MOVES[0]?.name &&
    project.texts.banks.moves?.[MOVE_EXPANSION_FIRST_USABLE_ID + EXPANSION_MOVES.length - 1] === EXPANSION_MOVES.at(-1)?.name
  );
}

function isUntouchedExpansionPlaceholder(
  bytes: Uint8Array,
  pound: Uint8Array,
  currentName: string,
  poundName: string,
  moveId: number,
): boolean {
  if (!bytesEqual(bytes, pound)) return false;
  const normalized = currentName.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === poundName.trim().toLowerCase() ||
    normalized === "dontuse" ||
    normalized === `expanded move ${moveId}`
  );
}

function markPatchOverlayDirty(project: ProjectState, overlayId: number): void {
  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  if (!project.patches.dirtyOverlayIds.includes(overlayId)) project.patches.dirtyOverlayIds.push(overlayId);
}

function requiredMoveFieldIndex(field: string): number {
  const index = MOVE_FIELD_INDEX.get(field);
  if (index === undefined) throw new Error(`White2Upgrade move expansion data is missing field ${field}.`);
  return index;
}

function writeThumbBl(data: Uint8Array, offset: number, fromAddress: number, toAddress: number): void {
  const delta = toAddress - (fromAddress + 4);
  if (delta % 2 !== 0 || delta < -0x400000 || delta > 0x3ffffe) throw new Error("Move Expansion routing helper is out of Thumb BL range.");
  writeU16(data, offset, 0xf000 | ((delta >> 12) & 0x7ff));
  writeU16(data, offset + 2, 0xf800 | ((delta >> 1) & 0x7ff));
}

function decodeThumbBlTarget(data: Uint8Array, offset: number, fromAddress: number): number | undefined {
  if (!isThumbBl(data, offset)) return undefined;
  const high = readU16(data, offset);
  const low = readU16(data, offset + 2);
  let delta = ((high & 0x7ff) << 12) | ((low & 0x7ff) << 1);
  if ((delta & 0x400000) !== 0) delta |= ~0x7fffff;
  return fromAddress + 4 + delta;
}

function isLegacyMoveExpansionRoutingHook(overlay: Uint8Array, layout: RoutingLayout): boolean {
  return (
    isThumbBl(overlay, layout.legacyCallerOffset) &&
    matchesSequence(overlay, FROST_ROUTING_SIGNATURE, layout.legacyCallerOffset + 4)
  );
}

function isRecognizedThumbHelper(
  overlay: Uint8Array,
  hookOffset: number,
  helper: Uint8Array,
): boolean {
  const helperOffset = thumbBlTargetOffset(overlay, hookOffset);
  return helperOffset !== undefined && matchesSequence(overlay, helper, helperOffset);
}

function thumbBlTargetOffset(overlay: Uint8Array, hookOffset: number): number | undefined {
  if (!isThumbBl(overlay, hookOffset)) return undefined;
  const high = readU16(overlay, hookOffset);
  const low = readU16(overlay, hookOffset + 2);
  let delta = ((high & 0x7ff) << 12) | ((low & 0x7ff) << 1);
  if ((delta & 0x400000) !== 0) delta |= ~0x7fffff;
  return hookOffset + 4 + delta;
}

function isThumbBl(data: Uint8Array, offset: number): boolean {
  if (offset < 0 || offset + 4 > data.length) return false;
  return (readU16(data, offset) & 0xf800) === 0xf000 && (readU16(data, offset + 2) & 0xf800) === 0xf800;
}

function matchesSequence(data: Uint8Array, sequence: ArrayLike<number>, offset: number): boolean {
  if (offset < 0 || offset + sequence.length > data.length) return false;
  for (let index = 0; index < sequence.length; index += 1) if (data[offset + index] !== sequence[index]) return false;
  return true;
}

function matchesSequenceIgnoringRange(
  data: Uint8Array,
  sequence: ArrayLike<number>,
  offset: number,
  ignoredOffset: number,
  ignoredLength: number,
): boolean {
  if (offset < 0 || offset + sequence.length > data.length) return false;
  for (let index = 0; index < sequence.length; index += 1) {
    if (index >= ignoredOffset && index < ignoredOffset + ignoredLength) continue;
    if (data[offset + index] !== sequence[index]) return false;
  }
  return true;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
