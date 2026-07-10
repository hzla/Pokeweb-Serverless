import { resolveMoveAnimationCommandName } from "./moveAnimationCommandNames";
import { formatMoveAnimationParam, parseMoveAnimationEditorParam } from "./moveAnimationParamSemantics";

const FX32_ONE = 4096;

export function summarizeMoveAnimationCommandLine(commandName: string, lineText: string): string | undefined {
  const internalName = resolveMoveAnimationCommandName(commandName);
  const params = parseCommandParams(internalName, lineText);
  if (!params) return undefined;

  switch (internalName) {
    case "DoSPAAnimation":
      return summarizeEmit(params);
    case "DoSPAScreenAnimation":
      return summarizeEmitFromCoordinates(params);
    case "DoSPAAnimation2":
      return summarizeEmitOrtho(params);
    case "DoSPAAllAnimations":
      return summarizeEmitAll(params);
    case "DoSPAProjectileAnimation":
      return summarizeProjectile(params, "DoSPAProjectileAnimation", "projectile");
    case "DoSPAProjectileAnimation2":
      return summarizeProjectileFromCoordinates(params, "DoSPAProjectileAnimation2", "projectile");
    case "DoSPAProjectileAnimation3":
      return summarizeProjectile(params, "DoSPAProjectileAnimation3", "orthographic projectile");
    case "DoSPAProjectileAnimationOrthoCoordinate":
      return summarizeOrthoProjectileFromCoordinates(params);
    case "DoSPACircleAnimation":
      return summarizeCircle(params, "DoSPACircleAnimation", "circular emitter");
    case "DoSPAOrthoCircleAnimation":
      return summarizeCircle(params, "DoSPAOrthoCircleAnimation", "orthographic circular emitter");
    default:
      return undefined;
  }
}

function summarizeEmit(params: number[]): string | undefined {
  if (params.length < 11) return undefined;
  return joinSentence([
    `Emits SPA ID ${params[0]}, resource ${params[1]}`,
    `from ${particlePosition("DoSPAAnimation", 2, params[2])} toward ${particlePosition("DoSPAAnimation", 3, params[3])}`,
    verticalOffset(params[4]),
    `direction angle ${params[5]}`,
    `radius ${worldUnits(params[7])}`,
    `at ${multiplier(params[8])} life`,
    `at ${multiplier(params[9])} scale`,
    `at ${multiplier(params[10])} speed`,
    params[6] ? `dummy ${params[6]}` : undefined,
  ]);
}

function summarizeEmitFromCoordinates(params: number[]): string | undefined {
  if (params.length < 15) return undefined;
  return joinSentence([
    `Emits SPA ID ${params[0]}, resource ${params[1]}`,
    `from coordinates ${coordinateTriplet(params[2], params[3], params[4])}`,
    `toward coordinates ${coordinateTriplet(params[5], params[6], params[7])}`,
    verticalOffset(params[8]),
    `direction angle ${params[9]}`,
    `radius ${worldUnits(params[11])}`,
    `at ${multiplier(params[12])} life`,
    `at ${multiplier(params[13])} scale`,
    `at ${multiplier(params[14])} speed`,
    params[10] ? `dummy ${params[10]}` : undefined,
  ]);
}

function summarizeEmitOrtho(params: number[]): string | undefined {
  if (params.length < 11) return undefined;
  return joinSentence([
    `Emits orthographic SPA ID ${params[0]}, resource ${params[1]}`,
    `from ${particlePosition("DoSPAAnimation2", 2, params[2])} toward ${particlePosition("DoSPAAnimation2", 3, params[3])}`,
    `offset ${coordinateTriplet(params[4], params[5], params[6])}`,
    `radius ${worldUnits(params[7])}`,
    `at ${multiplier(params[8])} life`,
    `at ${multiplier(params[9])} scale`,
    `at ${multiplier(params[10])} speed`,
  ]);
}

function summarizeEmitAll(params: number[]): string | undefined {
  if (params.length < 10) return undefined;
  return joinSentence([
    `Emits all resources in SPA ID ${params[0]}`,
    `from ${particlePosition("DoSPAAllAnimations", 1, params[1])} toward ${particlePosition("DoSPAAllAnimations", 2, params[2])}`,
    verticalOffset(params[3]),
    `direction angle ${params[4]}`,
    `projection ${params[5]}`,
    `radius ${worldUnits(params[6])}`,
    `at ${multiplier(params[7])} life`,
    `at ${multiplier(params[8])} scale`,
    `at ${multiplier(params[9])} speed`,
  ]);
}

function summarizeProjectile(params: number[], commandName: string, noun: string): string | undefined {
  if (params.length < 11) return undefined;
  return joinSentence([
    `Emits ${noun} using SPA ID ${params[0]}, resource ${params[1]}`,
    `${moveType(params[2])} from ${particlePosition(commandName, 3, params[3])} to ${particlePosition(commandName, 4, params[4])}`,
    `lasting ${frames(params[6])}`,
    verticalOffset(params[5]),
    `arc height ${signedWorldUnits(params[7])}`,
    `at ${multiplier(params[8])} life`,
    `at ${multiplier(params[9])} speed`,
    `${params[10]} wave`,
  ]);
}

function summarizeProjectileFromCoordinates(params: number[], commandName: string, noun: string): string | undefined {
  if (params.length < 13) return undefined;
  return joinSentence([
    `Emits ${noun} using SPA ID ${params[0]}, resource ${params[1]}`,
    `${moveType(params[2])} from coordinates ${coordinateTriplet(params[3], params[4], params[5])}`,
    `to ${particlePosition(commandName, 6, params[6])}`,
    `lasting ${frames(params[8])}`,
    verticalOffset(params[7]),
    `arc height ${signedWorldUnits(params[9])}`,
    `at ${multiplier(params[10])} life`,
    `at ${multiplier(params[11])} speed`,
    `${params[12]} wave`,
  ]);
}

function summarizeOrthoProjectileFromCoordinates(params: number[]): string | undefined {
  if (params.length < 13) return undefined;
  return joinSentence([
    `Emits orthographic projectile using SPA ID ${params[0]}, resource ${params[1]}`,
    `${moveType(params[2])} from coordinates ${coordinateTriplet(params[3], params[4], params[5])}`,
    `to ${particlePosition("DoSPAProjectileAnimationOrthoCoordinate", 6, params[6])}`,
    `lasting ${frames(params[8])}`,
    verticalOffset(params[7]),
    `arc height ${signedWorldUnits(params[9])}`,
    `at ${multiplier(params[10])} life`,
    `at ${multiplier(params[11])} speed`,
    `at ${multiplier(params[12])} scale`,
  ]);
}

function summarizeCircle(params: number[], commandName: string, noun: string): string | undefined {
  if (params.length < 10) return undefined;
  return joinSentence([
    `Emits ${noun} using SPA ID ${params[0]}, resource ${params[1]}`,
    `around ${circlePosition(params[2])}`,
    `horizontal radius ${worldUnits(params[3])}`,
    `vertical radius ${worldUnits(params[4])}`,
    verticalOffset(params[5]),
    `lasting ${plainFrames(params[6])}`,
    `after ${plainFrames(params[7])} wait`,
    `${params[8]} emit count`,
    `${params[9]} rotate-after-wait`,
    commandName === "DoSPAOrthoCircleAnimation" ? "using orthographic projection" : undefined,
  ]);
}

function parseCommandParams(commandName: string, lineText: string): number[] | undefined {
  const code = lineText.split("@", 1)[0]?.trim() ?? "";
  const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.*))?$/u.exec(code);
  if (!match) return undefined;
  const rawParamText = match[2]?.trim();
  if (!rawParamText) return [];
  const rawParams = rawParamText.split(",").map((part) => part.trim());
  const parsed: number[] = [];
  for (let index = 0; index < rawParams.length; index++) {
    const value = parseMoveAnimationEditorParam(commandName, index, rawParams[index]);
    if (value === undefined) return undefined;
    parsed.push(value);
  }
  return parsed;
}

function particlePosition(commandName: string, paramIndex: number, value: number): string {
  const formatted = formatMoveAnimationParam(commandName, paramIndex, value);
  const known: Record<string, string> = {
    ATTACKER: "attacker side",
    DEFENDER: "defender side",
    ATTACKER_MINUS: "attacker side minus one slot",
    DEFENDER_MINUS: "defender side minus one slot",
    ATTACKER_OFFSET: "attacker side with offset",
    NONE: "no side target",
    AA: "position AA",
    BB: "position BB",
    A: "position A",
    B: "position B",
    C: "position C",
    D: "position D",
    E: "position E",
    F: "position F",
    SIDE_ATTACKER: "attacker side",
    SIDE_DEFENDER: "defender side",
    SIDE_ATTACKER_MINUS: "attacker side minus one slot",
    SIDE_DEFENDER_MINUS: "defender side minus one slot",
    SIDE_ATTACKER_OFFSET: "attacker side with offset",
    SIDE_NONE: "no side target",
    POS_AA: "position AA",
    POS_BB: "position BB",
    POS_A: "position A",
    POS_B: "position B",
    POS_C: "position C",
    POS_D: "position D",
    POS_E: "position E",
    POS_F: "position F",
  };
  return known[formatted] ?? formatted.toLowerCase().replace(/_/gu, " ");
}

function circlePosition(value: number): string {
  const known: Record<number, string> = {
    0: "attacker, rotating left",
    1: "attacker, rotating right",
    2: "defender, rotating left",
    3: "defender, rotating right",
    4: "center, rotating left",
    5: "center, rotating right",
  };
  return known[value] ?? `circle mode ${value}`;
}

function moveType(value: number): string {
  const known: Record<number, string> = {
    0: "without movement",
    1: "in a straight line",
    2: "via a curve",
    3: "via a half curve",
    4: "using offset movement",
    5: "using a vertical wave",
    6: "using a horizontal wave",
  };
  return known[value] ?? `using movement type ${value}`;
}

function coordinateTriplet(x: number, y: number, z: number): string {
  return `x ${signedWorldUnits(x)}, y ${signedWorldUnits(y)}, z ${signedWorldUnits(z)}`;
}

function verticalOffset(value: number): string {
  const units = fx32ToNumber(value);
  if (units === 0) return "no vertical offset";
  if (units > 0) return `adjusted up by ${formatSignedNumber(units)} units`;
  return `adjusted down by ${formatNumber(Math.abs(units))} units`;
}

function signedWorldUnits(value: number): string {
  return `${formatSignedNumber(fx32ToNumber(value))} units`;
}

function worldUnits(value: number): string {
  return `${formatNumber(fx32ToNumber(value))} units`;
}

function multiplier(value: number): string {
  return `${formatNumber(fx32ToNumber(value))}x`;
}

function frames(value: number): string {
  return `${formatNumber(fx32ToNumber(value))} ${plural(fx32ToNumber(value), "frame")}`;
}

function plainFrames(value: number): string {
  return `${formatNumber(value)} ${plural(value, "frame")}`;
}

function fx32ToNumber(value: number): number {
  return value / FX32_ONE;
}

function formatSignedNumber(value: number): string {
  if (value > 0) return `+${formatNumber(value)}`;
  if (value < 0) return `-${formatNumber(Math.abs(value))}`;
  return "0";
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
}

function plural(value: number, word: string): string {
  return Math.abs(value) === 1 ? word : `${word}s`;
}

function joinSentence(parts: Array<string | undefined>): string {
  return `${parts.filter(Boolean).join(", ")}.`;
}
