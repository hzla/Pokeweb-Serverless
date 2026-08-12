import white2UpgradeMoveExpansionJson from "../assets/data/white2upgradeMoveExpansion.json";
import white2UpgradeGen6MoveAnimationsUrl from "../assets/data/white2upgradeGen6MoveAnimations.zip?url";
import { unzipSync } from "fflate";
import { readU16, readU32, writeU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { BW2_NARCS, BW_NARCS, HEADER_NARCS, isGen5BaseRom, type Gen5BaseRom, type NarcName } from "./constants";
import { loadActiveRomBytes } from "./persistence";
import { commitTextBank, getTextBank, parseTextEntryId } from "./textModel";
import { createNarcStore, markDirty, type NarcStore, type ProjectState } from "./projectStore";

export const MOVE_EXPANSION_TARGET_COUNT = 1000;
export const MOVE_EXPANSION_FIRST_USABLE_ID = 680;

export type MoveExpansionInstallOptions = {
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
  gen6AnimationsIncluded: boolean;
  gen6AnimationsInstalled: number;
  particleFilesInstalled: number;
  particleReferencesRemapped: number;
};

export type MoveExpansionRoutingPatchResult = {
  status: "applied" | "already-applied";
  overlay: Uint8Array;
  helperOffset?: number;
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

type Gen6AnimationBundle = {
  moves: Array<{
    sourceMoveId: number;
    targetMoveId: number;
    particleIds: number[];
    bytes: Uint8Array;
  }>;
  particles: MoveExpansionBundledParticle[];
};

type MoveTextBankConfig = {
  battle: number;
  description: number;
  name: number;
  uppercase: number;
};

type RoutingLayout = {
  overlayId: number;
  callerOffset: number;
};

type MoveExpansionRoutingCacheEntry = {
  baseRom: ProjectState["session"]["baseRom"];
  originalRomBytes: Uint8Array | undefined;
  loadedOverlay: Uint8Array | undefined;
  state: MoveExpansionRoutingState;
};

type RoutingOverlay = {
  data: Uint8Array;
  ramAddress: number;
  bssSize: number;
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
  BW: { overlayId: 94, callerOffset: 0x3046 },
  BW2: { overlayId: 168, callerOffset: 0x3536 },
};
const ORIGINAL_ROUTING_CALLER = [
  0x96, 0x20, 0x80, 0x00, 0x21, 0x5a, 0x27, 0x38, 0x88, 0x4b, 0x81, 0x42, 0x38, 0xd2,
] as const;
const FROST_ROUTING_SIGNATURE = [0x00, 0x00, 0x00, 0x00, 0x88, 0x4b, 0x01, 0x28, 0x38, 0xd0] as const;
const ROUTING_HELPER = Uint8Array.of(
  0x00, 0xb5,
  0x96, 0x20,
  0x80, 0x00,
  0x21, 0x5a,
  0x05, 0x48,
  0x88, 0x42,
  0x04, 0xd2,
  0x78, 0x30,
  0x81, 0x42,
  0x01, 0xda,
  0x01, 0x20,
  0x00, 0xe0,
  0x00, 0x20,
  0x00, 0xbd,
  0x00, 0x00,
  0x30, 0x02, 0x00, 0x00,
);

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
let gen6AnimationBundlePromise: Promise<Gen6AnimationBundle> | undefined;
const moveExpansionRoutingCache = new WeakMap<ProjectState, MoveExpansionRoutingCacheEntry>();

export async function installMoveExpansion(
  project: ProjectState,
  options: MoveExpansionInstallOptions = {},
): Promise<MoveExpansionInstallResult> {
  if (!isGen5BaseRom(project.session.baseRom)) throw new Error("Move Expansion is currently available for Black / White and Black 2 / White 2 only.");

  const gen6AnimationBundle = options.includeGen6Animations
    ? options.gen6AnimationBundleBytes
      ? parseGen6AnimationBundle(options.gen6AnimationBundleBytes)
      : await loadGen6AnimationBundle()
    : undefined;

  const layout = ROUTING_LAYOUTS[project.session.baseRom];
  const routingOverlay = await ensureRoutingOverlay(project, layout.overlayId);
  const routingPatch = applyMoveExpansionRoutingHookToOverlay(
    routingOverlay.data,
    project.session.baseRom,
    routingOverlay.ramAddress,
    routingOverlay.bssSize,
  );
  if (!routingPatch) {
    throw new Error(
      `Could not find the vanilla or Frost move-animation routing signature in overlay ${layout.overlayId}. This ROM has a conflicting battle-animation code change.`,
    );
  }

  const stores = await ensureExpansionStores(project, Boolean(gen6AnimationBundle));
  const originalMoveCount = stores.moves.rawFiles.length;
  const moveSummary = expandMoveData(project, stores.moves);
  const animationSummary = expandMoveAnimations(project, stores.moves, stores.moveAnimations, moveSummary.seededIds);
  const gen6AnimationSummary =
    gen6AnimationBundle && stores.moveSpas
      ? await installBundledGen6Animations(project, stores.moveAnimations, stores.moveSpas, gen6AnimationBundle)
      : { animationsChanged: 0, particlesAdded: 0, referencesRemapped: 0 };
  const textEntriesAdded = expandMoveText(project, originalMoveCount, moveSummary.seededIds);

  if (routingPatch.status === "applied") {
    project.overlays[layout.overlayId] = routingPatch.overlay;
    markPatchOverlayDirty(project, layout.overlayId);
  }

  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  project.patches.applied ??= {};
  project.patches.applied.moveExpansion = true;
  if (gen6AnimationBundle) project.patches.applied.moveExpansionGen6Animations = true;

  const changed =
    routingPatch.status === "applied" ||
    moveSummary.changed > 0 ||
    animationSummary.changed > 0 ||
    gen6AnimationSummary.animationsChanged > 0 ||
    gen6AnimationSummary.particlesAdded > 0 ||
    textEntriesAdded > 0;
  if (changed) {
    const animationDetail = gen6AnimationBundle
      ? ` Included ${gen6AnimationBundle.moves.length} White2Upgrade Gen 6 animation scripts and their prerequisite particle files.`
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
    routingChanged: routingPatch.status === "applied",
    overlayId: layout.overlayId,
    helperOffset: routingPatch.helperOffset,
    movesAdded: moveSummary.added,
    animationsAdded: animationSummary.added,
    textEntriesAdded,
    importedMovesAdded: moveSummary.imported,
    fairyMovesMappedToNormal: moveSummary.fairyMovesMappedToNormal,
    gen6AnimationsIncluded: Boolean(gen6AnimationBundle),
    gen6AnimationsInstalled: gen6AnimationBundle?.moves.length ?? 0,
    particleFilesInstalled: gen6AnimationSummary.particlesAdded,
    particleReferencesRemapped: gen6AnimationSummary.referencesRemapped,
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
  const { callerOffset } = ROUTING_LAYOUTS[baseRom];
  if (matchesSequence(overlay, ORIGINAL_ROUTING_CALLER, callerOffset)) return "unpatched";
  if (
    matchesSequence(overlay, FROST_ROUTING_SIGNATURE, callerOffset + 4) &&
    isThumbBl(overlay, callerOffset)
  ) {
    return "patched";
  }
  return "unknown";
}

export function applyMoveExpansionRoutingHookToOverlay(
  overlay: Uint8Array,
  baseRom: Gen5BaseRom,
  ramAddress: number,
  bssSize = 0,
): MoveExpansionRoutingPatchResult | undefined {
  const state = detectMoveExpansionRoutingHook(overlay, baseRom);
  if (state === "unknown") return undefined;
  if (state === "patched") return { status: "already-applied", overlay };

  // Materialize the original BSS as zero-filled static data before appending
  // code. This keeps every compiled BSS address valid when the overlay's
  // static RAM size is increased by the exporter.
  const helperOffset = align(overlay.length + bssSize, 4);
  const out = new Uint8Array(helperOffset + ROUTING_HELPER.length);
  out.set(overlay);
  out.set(ROUTING_HELPER, helperOffset);

  const { callerOffset } = ROUTING_LAYOUTS[baseRom];
  writeThumbBl(out, callerOffset, ramAddress + callerOffset, ramAddress + helperOffset);
  out.set(FROST_ROUTING_SIGNATURE, callerOffset + 4);
  return { status: "applied", overlay: out, helperOffset };
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

async function loadGen6AnimationBundle(): Promise<Gen6AnimationBundle> {
  gen6AnimationBundlePromise ??= fetch(white2UpgradeGen6MoveAnimationsUrl)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Could not load the bundled Gen 6 move animations (${response.status}).`);
      return parseGen6AnimationBundle(new Uint8Array(await response.arrayBuffer()));
    })
    .catch((error) => {
      gen6AnimationBundlePromise = undefined;
      throw error;
    });
  return gen6AnimationBundlePromise;
}

export function parseGen6AnimationBundle(bytes: Uint8Array): Gen6AnimationBundle {
  const entries = unzipSync(bytes);
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new Error("The Gen 6 animation bundle is missing manifest.json.");
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
    format?: unknown;
    version?: unknown;
    generation?: unknown;
    moves?: unknown;
    particles?: unknown;
  };
  if (manifest.format !== "pokeweb-move-expansion-animations" || manifest.version !== 1 || manifest.generation !== 6) {
    throw new Error("The Gen 6 animation bundle has an unsupported format or version.");
  }
  if (!Array.isArray(manifest.moves) || !Array.isArray(manifest.particles)) {
    throw new Error("The Gen 6 animation bundle manifest is incomplete.");
  }

  const moves = manifest.moves.map((value) => {
    const entry = value as Record<string, unknown>;
    const sourceMoveId = requiredBundleInteger(entry.sourceMoveId, "source move ID");
    const targetMoveId = requiredBundleInteger(entry.targetMoveId, `target move ID for source move ${sourceMoveId}`);
    const animation = requiredBundlePath(entry.animation, `animation path for source move ${sourceMoveId}`);
    const particleIds = requiredBundleIntegerArray(entry.particleIds, `particle IDs for source move ${sourceMoveId}`);
    const animationBytes = entries[animation];
    if (!animationBytes) throw new Error(`The Gen 6 animation bundle is missing ${animation}.`);
    const expectedTarget = targetMoveIdForSource(sourceMoveId);
    if (expectedTarget !== targetMoveId) {
      throw new Error(`The Gen 6 animation bundle maps source move ${sourceMoveId} to ${targetMoveId}; expected ${expectedTarget}.`);
    }
    return { sourceMoveId, targetMoveId, particleIds, bytes: animationBytes };
  });

  const particles = manifest.particles.map((value) => {
    const entry = value as Record<string, unknown>;
    const sourceParticleId = requiredBundleInteger(entry.sourceParticleId, "source particle ID");
    const particle = requiredBundlePath(entry.particle, `particle path for SPA ${sourceParticleId}`);
    const particleBytes = entries[particle];
    if (!particleBytes) throw new Error(`The Gen 6 animation bundle is missing ${particle}.`);
    return { sourceParticleId, bytes: particleBytes };
  });
  const bundledParticleIds = new Set(particles.map((particle) => particle.sourceParticleId));
  for (const move of moves) {
    for (const particleId of move.particleIds) {
      if (particleId >= FIRST_BW2_ONLY_MOVE_PARTICLE_ID && !bundledParticleIds.has(particleId)) {
        throw new Error(`Gen 6 animation ${move.sourceMoveId} requires particle file ${particleId}, which is not bundled.`);
      }
    }
  }
  return { moves, particles };
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

async function installBundledGen6Animations(
  project: ProjectState,
  animationStore: NarcStore,
  particleStore: NarcStore,
  bundle: Gen6AnimationBundle,
): Promise<{ animationsChanged: number; particlesAdded: number; referencesRemapped: number }> {
  const allocation = allocateMoveExpansionParticleAssets(particleStore, bundle.particles);
  for (const particleId of allocation.addedIds) markDirty(project, "move_spas", particleId);

  const { remapMoveAnimationParticleIds } = await import("./moveAnimationModel");
  let animationsChanged = 0;
  let referencesRemapped = 0;
  for (const move of bundle.moves) {
    const remapped = remapMoveAnimationParticleIds(move.bytes, allocation.particleIdMap);
    referencesRemapped += remapped.referencesChanged;
    const existing = animationStore.rawFiles[move.targetMoveId];
    if (existing && bytesEqual(existing, remapped.bytes)) continue;
    animationStore.rawFiles[move.targetMoveId] = remapped.bytes;
    animationStore.fileCount = animationStore.rawFiles.length;
    animationStore.records.delete(move.targetMoveId);
    markDirty(project, "move_animations", move.targetMoveId);
    animationsChanged += 1;
  }
  return { animationsChanged, particlesAdded: allocation.addedIds.length, referencesRemapped };
}

function requiredBundleInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`The Gen 6 animation bundle has an invalid ${label}.`);
  return value as number;
}

function requiredBundleIntegerArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) throw new Error(`The Gen 6 animation bundle has invalid ${label}.`);
  return value.map((entry) => requiredBundleInteger(entry, label));
}

function requiredBundlePath(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.includes("..")) {
    throw new Error(`The Gen 6 animation bundle has an invalid ${label}.`);
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
  if (existing?.length) return { data: existing, ramAddress: metadata.ramAddress, bssSize: metadata.bssSize };
  const overlay = rom.loadArm9Overlays([overlayId]).get(overlayId);
  if (!overlay) throw new Error(`Could not load overlay ${overlayId} from this ROM.`);
  project.overlays[overlayId] = overlay.data;
  return { data: overlay.data, ramAddress: metadata.ramAddress, bssSize: metadata.bssSize };
}

function findOverlayMetadata(table: Uint8Array, overlayId: number): { ramAddress: number; bssSize: number } | undefined {
  for (let offset = 0; offset + 32 <= table.length; offset += 32) {
    if (readU32(table, offset) !== overlayId) continue;
    return { ramAddress: readU32(table, offset + 4), bssSize: readU32(table, offset + 12) };
  }
  return undefined;
}

function detectProjectMoveExpansionRouting(project: ProjectState): MoveExpansionRoutingState {
  const baseRom = project.session.baseRom;
  if (!isGen5BaseRom(baseRom)) return "unknown";
  const layout = ROUTING_LAYOUTS[baseRom];
  const loaded = project.overlays[layout.overlayId];
  const originalRomBytes = project.originalRomBytes;
  const cached = moveExpansionRoutingCache.get(project);
  if (
    cached?.baseRom === baseRom &&
    cached.originalRomBytes === originalRomBytes &&
    cached.loadedOverlay === loaded
  ) {
    return cached.state;
  }

  let state: MoveExpansionRoutingState = "unknown";
  if (loaded?.length) {
    state = detectMoveExpansionRoutingHook(loaded, baseRom);
  } else if (originalRomBytes) {
    try {
      const overlay = new NintendoDSRom(originalRomBytes).loadArm9Overlays([layout.overlayId]).get(layout.overlayId);
      state = overlay ? detectMoveExpansionRoutingHook(overlay.data, baseRom) : "unknown";
    } catch {
      state = "unknown";
    }
  }

  moveExpansionRoutingCache.set(project, { baseRom, originalRomBytes, loadedOverlay: loaded, state });
  return state;
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

function isThumbBl(data: Uint8Array, offset: number): boolean {
  if (offset < 0 || offset + 4 > data.length) return false;
  return (readU16(data, offset) & 0xf800) === 0xf000 && (readU16(data, offset + 2) & 0xf800) === 0xf800;
}

function matchesSequence(data: Uint8Array, sequence: ArrayLike<number>, offset: number): boolean {
  if (offset < 0 || offset + sequence.length > data.length) return false;
  for (let index = 0; index < sequence.length; index += 1) if (data[offset + index] !== sequence[index]) return false;
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
