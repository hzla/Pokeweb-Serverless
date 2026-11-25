import { equalBytes, readU16, writeU16 } from "../nds/binary";
import { sha256Hex } from "../nds/sha256";
import { recordFieldChange } from "./actionChangelog";
import type { ProjectState } from "./projectStore";

export const GROTTO_REFILL_LIMITS = {
  steps: { min: 1, max: 256 },
  chance: { min: 0, max: 100 },
} as const;

export type GrottoRefillSettings = { steps: number; chance: number };

const FIELD_OVERLAY = 36;
const REFILL_OFFSET = 0x2ee0;
const STEP_GATE_OFFSET = 0x1a;
const CHANCE_OFFSET = 0x2a;
const VANILLA_STEPS = 256;
const DIVISION_LENGTH = 0x1e4;
const DIVISION_SHA256 = "3b0403581ea03e86bdfc0cde00ea2ca13f522291aec399b93ecdf2fef57944eb";

// English US retail signatures. Both games use the same overlay-relative
// layout, but have different addresses for the field overlay and ARM9 helper.
const profiles = {
  IREO: {
    stock: "f8b5041c95f626fa051c201c94f6ceff041c281c8df6fef8061ce20f2106891a1820c141501819d1002505272906301c090e8df6b3f900280dd1381c91f6c0f9041c642083f610f9a04204d22906301c090e46f07ffb6d1c142de7dbf8bd",
    divisionOffset: 0x89868,
    divisionCallEnd: 0xe9b2,
  },
  IRDO: {
    stock: "f8b5041c95f606fa051c201c94f6aeff041c281c8df6def8061ce20f2106891a1820c141501819d1002505272906301c090e8df693f900280dd1381c91f6a0f9041c642083f6f0f8a04204d22906301c090e46f07bfb6d1c142de7dbf8bd",
    divisionOffset: 0x89894,
    divisionCallEnd: 0xe9a8,
  },
} as const;

type RefillProfile = (typeof profiles)[keyof typeof profiles];

function profileFor(project: ProjectState): RefillProfile | undefined {
  const game = project.romInfo.idCode;
  if (project.session.baseRom !== "BW2" || (game !== "IRDO" && game !== "IREO")) return undefined;
  return profiles[game];
}

function encodeRefillRoutine(profile: RefillProfile, { steps, chance }: GrottoRefillSettings): Uint8Array {
  const body = Uint8Array.from(profile.stock.match(/../gu)!, byte => Number.parseInt(byte, 16));
  if (steps !== VANILLA_STEPS) {
    // Replace the inline % 256 with a call to the native unsigned divider.
    // Inputs: step total in r0, divisor in r1. The remainder is in r1.
    // Keep the native conditional branch and the empty-grotto loop intact.
    const gate = [
      0x1c20,          // adds r0, r4, #0
      0x2100 | steps,  // movs r1, #steps
      0x46c0,          // align the BLX on a word boundary
      0xf70b, profile.divisionCallEnd,
      0x2900,          // cmp r1, #0
    ];
    gate.forEach((word, index) => writeU16(body, STEP_GATE_OFFSET + index * 2, word));
  }
  body[CHANCE_OFFSET] = chance;
  return body;
}

export function getGrottoRefillSettings(project: ProjectState): GrottoRefillSettings | undefined {
  const profile = profileFor(project);
  const overlay = project.overlays[FIELD_OVERLAY];
  if (!profile || !overlay) return undefined;
  const code = overlay.subarray(REFILL_OFFSET, REFILL_OFFSET + profile.stock.length / 2);
  const steps = readU16(code, STEP_GATE_OFFSET) === 0x1c20 ? code[STEP_GATE_OFFSET + 2] : VANILLA_STEPS;
  const chance = code[CHANCE_OFFSET];
  if (!steps || chance === undefined || chance > GROTTO_REFILL_LIMITS.chance.max) return undefined;
  const settings = { steps, chance };
  if (!equalBytes(code, encodeRefillRoutine(profile, settings))) return undefined;
  const division = project.arm9.subarray(profile.divisionOffset, profile.divisionOffset + DIVISION_LENGTH);
  return sha256Hex(division) === DIVISION_SHA256 ? settings : undefined;
}

export function updateGrottoRefillSettings(project: ProjectState, settings: GrottoRefillSettings): boolean {
  const { steps, chance } = settings;
  const limits = GROTTO_REFILL_LIMITS;
  if (!Number.isInteger(steps) || steps < limits.steps.min || steps > limits.steps.max) {
    throw new Error(`Enter a whole number of steps from ${limits.steps.min} to ${limits.steps.max}.`);
  }
  if (!Number.isInteger(chance) || chance < limits.chance.min || chance > limits.chance.max) {
    throw new Error(`Enter a whole percent from ${limits.chance.min} to ${limits.chance.max}.`);
  }
  const profile = profileFor(project);
  const current = getGrottoRefillSettings(project);
  if (!profile || !current) throw new Error("Could not verify this ROM’s Hidden Grotto refill code.");
  if (current.steps === steps && current.chance === chance) return false;

  const overlay = project.overlays[FIELD_OVERLAY]!.slice();
  overlay.set(encodeRefillRoutine(profile, settings), REFILL_OFFSET);
  project.overlays[FIELD_OVERLAY] = overlay;
  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  if (!project.patches.dirtyOverlayIds.includes(FIELD_OVERLAY)) project.patches.dirtyOverlayIds.push(FIELD_OVERLAY);
  recordFieldChange(project, "grottos", undefined, "Steps between grotto refill checks", current.steps, steps, { key: "grotto-refill:steps" });
  recordFieldChange(project, "grottos", undefined, "Grotto refill chance", `${current.chance}%`, `${chance}%`, { key: "grotto-refill:chance" });
  return true;
}
