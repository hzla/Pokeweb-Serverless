import commandMacros from "../assets/data/B2W2_MOVSCRCMD.s?raw";
import commandDocsData from "../assets/data/moveAnimationCommandDocs.json";
import {
  getMoveAnimationCommandAliases,
  getMoveAnimationDisplayCommandName,
  getMoveAnimationGenericCommandAliases,
} from "./moveAnimationCommandNames";
import { getMoveAnimationParamSemanticHelp, type MoveAnimationEnumValue, type MoveAnimationFx32Unit } from "./moveAnimationParamSemantics";

export type MoveAnimationVmStateDomain = "camera" | "particle" | "sprite" | "trainer" | "background" | "object" | "audio" | "flow" | "projection" | "window" | "gauge";
export type MoveAnimationVmPreviewSupport = "supported" | "marker" | "unsupported";
export type MoveAnimationVmCompletion = "immediate" | "task" | "wait" | "control" | "terminates";

export type MoveAnimationVmParamSchema = {
  index: number;
  name: string;
  description: string;
  signedness: "signed32";
  kind: "integer" | "enum" | "fx32";
  fx32Unit?: MoveAnimationFx32Unit;
  enumGroup?: string;
  enumValues?: MoveAnimationEnumValue[];
};

export type MoveAnimationVmCommandSchema = {
  opcode: number;
  name: string;
  displayName: string;
  aliases: string[];
  argumentCount: number;
  params: MoveAnimationVmParamSchema[];
  category: string;
  description: string;
  state: {
    reads: MoveAnimationVmStateDomain[];
    writes: MoveAnimationVmStateDomain[];
  };
  taskGroup?: number;
  completion: MoveAnimationVmCompletion;
  preview: MoveAnimationVmPreviewSupport;
};

type CommandDoc = {
  opcode: number;
  name: string;
  currentPokewebName: string;
  category: string;
  description: string;
  params: Array<{ index: number; name: string; currentArg: string; description: string }>;
};

// Semantics include BW1 observations. Validate against the target BW2 ROM
// before treating the schema or browser preview as BW2-conformant.
const TERMINATING_COMMANDS = new Set(["CallMoveAnimation", "TerminateMoveScript"]);

const docs = commandDocsData.commands as CommandDoc[];
const docsByOpcode = new Map(docs.map((doc) => [doc.opcode, doc]));

export const MOVE_ANIMATION_VM_SCHEMA: MoveAnimationVmCommandSchema[] = parseCommandMacros(commandMacros).map((definition) => {
  const doc = docsByOpcode.get(definition.opcode);
  const displayName = getMoveAnimationDisplayCommandName(definition.name);
  const state = stateMetadata(definition.opcode);
  const params = definition.params.map((fallbackName, index) => {
    const documented = doc?.params[index];
    const semantic = getMoveAnimationParamSemanticHelp(definition.name, index);
    return {
      index,
      name: documented?.name || documented?.currentArg || fallbackName,
      description: documented?.description ?? "Raw signed VM parameter.",
      signedness: "signed32" as const,
      kind: semantic?.kind ?? ("integer" as const),
      fx32Unit: semantic?.kind === "fx32" ? semantic.unit : undefined,
      enumGroup: semantic?.kind === "enum" ? semantic.group : undefined,
      enumValues: semantic?.kind === "enum" ? semantic.values : undefined,
    };
  });
  return {
    opcode: definition.opcode,
    name: definition.name,
    displayName,
    aliases: unique([definition.name, displayName, ...getMoveAnimationCommandAliases(definition.name), ...getMoveAnimationGenericCommandAliases(definition.opcode)]),
    argumentCount: definition.params.length,
    params,
    category: doc?.category ?? categoryForOpcode(definition.opcode),
    description: doc?.description ?? `${displayName} move-animation VM command.`,
    state,
    taskGroup: taskGroupForOpcode(definition.opcode),
    completion: completionForOpcode(definition.opcode, definition.ends),
    preview: previewSupport(definition.name),
  };
});

const SCHEMA_BY_OPCODE = new Map(MOVE_ANIMATION_VM_SCHEMA.map((command) => [command.opcode, command]));
const SCHEMA_BY_NAME = new Map(MOVE_ANIMATION_VM_SCHEMA.flatMap((command) => command.aliases.map((alias) => [alias.toLowerCase(), command] as const)));

export function getMoveAnimationVmSchema(): MoveAnimationVmCommandSchema[] {
  return MOVE_ANIMATION_VM_SCHEMA.map(cloneCommandSchema);
}

export function getMoveAnimationVmCommandSchema(command: string | number): MoveAnimationVmCommandSchema | undefined {
  const schema = typeof command === "number" ? SCHEMA_BY_OPCODE.get(command) : SCHEMA_BY_NAME.get(command.toLowerCase());
  return schema ? cloneCommandSchema(schema) : undefined;
}

export function getMoveAnimationVmEnumFixtures(): Array<{ command: MoveAnimationVmCommandSchema; param: MoveAnimationVmParamSchema; value: MoveAnimationEnumValue }> {
  return MOVE_ANIMATION_VM_SCHEMA.flatMap((command) => command.params.flatMap((param) => (param.enumValues ?? []).map((value) => ({ command, param, value }))));
}

function cloneCommandSchema(command: MoveAnimationVmCommandSchema): MoveAnimationVmCommandSchema {
  return {
    ...command,
    aliases: command.aliases.slice(),
    params: command.params.map((param) => ({ ...param, enumValues: param.enumValues?.map((value) => ({ ...value, aliases: value.aliases?.slice() })) })),
    state: { reads: command.state.reads.slice(), writes: command.state.writes.slice() },
  };
}

function stateMetadata(opcode: number): MoveAnimationVmCommandSchema["state"] {
  if (opcode <= 3 || opcode === 5) return { reads: ["camera"], writes: ["camera"] };
  if (opcode === 4) return { reads: ["camera", "projection"], writes: ["camera", "projection"] };
  if (opcode >= 6 && opcode <= 17) return { reads: ["particle", "camera", "sprite"], writes: ["particle"] };
  if (opcode >= 18 && opcode <= 31) return { reads: ["sprite"], writes: ["sprite"] };
  if (opcode >= 32 && opcode <= 35) return { reads: ["trainer"], writes: ["trainer"] };
  if (opcode >= 36 && opcode <= 43) return { reads: ["background"], writes: ["background"] };
  if (opcode === 44) return { reads: ["window"], writes: ["window"] };
  if (opcode >= 45 && opcode <= 50) return { reads: ["object"], writes: ["object"] };
  if (opcode === 51) return { reads: ["gauge"], writes: ["gauge"] };
  if (opcode >= 52 && opcode <= 55) return { reads: ["audio"], writes: ["audio"] };
  return { reads: ["flow"], writes: ["flow"] };
}

function categoryForOpcode(opcode: number): string {
  if (opcode <= 5) return "Camera";
  if (opcode <= 17) return "Particles";
  if (opcode <= 31) return "Sprite";
  if (opcode <= 35) return "Trainer";
  if (opcode <= 43) return "Background";
  if (opcode === 44) return "Window";
  if (opcode <= 50) return "Object";
  if (opcode === 51) return "Gauge";
  if (opcode <= 55) return "Sound";
  if (opcode <= 58) return "Timing";
  return "Flow";
}

function taskGroupForOpcode(opcode: number): number | undefined {
  if (opcode <= 5) return 1;
  if (opcode >= 6 && opcode <= 17) return 2;
  if (opcode >= 18 && opcode <= 35) return 3;
  if (opcode >= 36 && opcode <= 43) return 5;
  if (opcode === 44) return 17;
  if (opcode >= 52 && opcode <= 55) return 10;
  return undefined;
}

function completionForOpcode(opcode: number, ends: boolean): MoveAnimationVmCompletion {
  if (ends) return "terminates";
  if (opcode === 56 || opcode === 57 || opcode === 75) return "wait";
  if (opcode >= 58 && opcode <= 76) return "control";
  if (taskGroupForOpcode(opcode) !== undefined && ![5, 6, 11, 26, 34, 36, 40, 43, 48, 50, 53].includes(opcode)) return "task";
  return "immediate";
}

function previewSupport(command: string): MoveAnimationVmPreviewSupport {
  if (["FreezeSprite", "PokemonBlinkFlag", "CallMoveAnimation", "TerminateMoveScript", "DistortBackground", "BackgroundPaletteAnimation", "BackgroundPriority"].includes(command)) return "marker";
  if ([
    "Wait", "LetCMDsFinish", "LoadSPA", "LoadBackground",
    "DoSPAAnimation", "DoSPAScreenAnimation", "DoSPAAnimation2", "DoSPAProjectileAnimation", "DoSPAProjectileAnimation2", "DoSPAProjectileAnimation3", "DoSPACircleAnimation",
    "MoveBackground", "BackgroundAlpha", "ChangeBackgroundColor", "ApplyBackground",
    "MoveCamera", "AdjustCamera", "CameraMoveAngle", "CameraProjection", "CameraPosPush", "ShakeScreen",
    "ShakeSprite", "MoveSprite", "PokemonSineMove", "DistortSprite", "TiltSprite", "SpriteOpacity", "PokemonMosaic", "ChangeColor", "ChangeVisibility", "PokemonShadowVanish", "PokemonShadowScale", "DeletePokemon",
  ].includes(command)) return "supported";
  return "unsupported";
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function parseCommandMacros(source: string): Array<{ opcode: number; name: string; params: string[]; ends: boolean }> {
  const lines = source.split(/\r?\n/u);
  const commands: Array<{ opcode: number; name: string; params: string[]; ends: boolean }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const macro = /^\.macro\s+([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/u.exec(lines[index]!.trim());
    if (!macro) continue;
    const name = macro[1]!;
    const params = macro[2]!.trim() ? macro[2]!.trim().split(/\s+/u) : [];
    let opcode: number | undefined;
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      const text = lines[scan]!.trim();
      const opcodeMatch = /^\.hword\s+(\d+)$/u.exec(text);
      if (opcodeMatch) {
        opcode = Number(opcodeMatch[1]);
        break;
      }
      if (text === ".endm") break;
    }
    if (opcode !== undefined) commands.push({ opcode, name, params, ends: TERMINATING_COMMANDS.has(name) });
  }
  return commands;
}
