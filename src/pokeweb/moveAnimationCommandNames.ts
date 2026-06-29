const DISPLAY_NAMES: Record<string, string> = {
  DoSPAAnimation: "Emit",
  DoSPAScreenAnimation: "EmitFromCoordinates",
  DoSPAAnimation2: "EmitOrtho",
  DoSPAAllAnimations: "EmitAll",
  DeleteSPA: "DeleteParticle",
  DoSPAProjectileAnimation: "EmitProjectile",
  DoSPAProjectileAnimation2: "EmitProjectileFromCoordinates",
  DoSPAProjectileAnimation3: "EmitOrthoProjectile",
  DoSPAProjectileAnimationOrthoCoordinate: "EmitOrthoProjectileFromCoordinates",
  DoSPACircleAnimation: "EmitCircle",
  DoSPAOrthoCircleAnimation: "EmitOrthoCircle",
  PokemonSineMove: "MoveSpriteSine",
  DistortSprite: "ScaleSprite",
  TiltSprite: "RotateSprite",
  SpriteOpacity: "AdjustSpriteOpacity",
  PokemonMosaic: "ApplySpriteMosaic",
  PokemonBlinkFlag: "ToggleSpriteBlink",
  FreezeSprite: "ToggleFreezeSprite",
  ChangeColor: "ChangeSpriteColor",
  ChangeVisibility: "ToggleSpriteVisibility",
  PokemonShadowVanish: "ToggleSpriteShadow",
  PokemonShadowScale: "ScaleSpriteShadow",
  SetTrainer: "SetTrainerSprite",
  MoveTrainer: "MoveTrainerSprite",
  SetTrainerAnimation: "SetTrainerSpriteAnimation",
  DeleteTrainer: "DeleteTrainerSprite",
  WindowMove: "MoveWindow",
  SetObject: "CreateBattleObject",
  MoveObject: "MoveBattleObject",
  ScaleObject: "ScaleBattleObject",
  SetObjectAnimation: "SetBattleObjectAnimation",
  DeleteObject: "DeleteBattleObject",
  GaugeVanish: "ToggleHUD",
};

const MANUAL_ALIASES: Record<string, string> = {
  EmitFromCordinates: "DoSPAScreenAnimation",
  EmitOrthoProjectileFromCordinates: "DoSPAProjectileAnimationOrthoCoordinate",
  PokemonScale: "DistortSprite",
  PokemonRotate: "TiltSprite",
  PokemonPaletteFade: "ChangeColor",
  PokemonVanish: "ChangeVisibility",
  FreezePokemon: "FreezeSprite",
  FreezeSprite: "FreezeSprite",
  SpriteVisibility: "ChangeVisibility",
  SpriteShadowVanish: "PokemonShadowVanish",
  SpriteShadowScale: "PokemonShadowScale",
};

const ALIAS_TO_INTERNAL = new Map<string, string>();
const INTERNAL_TO_ALIASES = new Map<string, string[]>();

for (const [internal, display] of Object.entries(DISPLAY_NAMES)) {
  registerAlias(internal, internal);
  registerAlias(display, internal);
}

for (const [alias, internal] of Object.entries(MANUAL_ALIASES)) registerAlias(alias, internal);

function registerAlias(alias: string, internal: string): void {
  ALIAS_TO_INTERNAL.set(alias.toLowerCase(), internal);
  const aliases = INTERNAL_TO_ALIASES.get(internal) ?? [];
  if (!aliases.some((existing) => existing.toLowerCase() === alias.toLowerCase())) aliases.push(alias);
  INTERNAL_TO_ALIASES.set(internal, aliases);
}

export function getMoveAnimationDisplayCommandName(commandName: string): string {
  const internal = resolveMoveAnimationCommandName(commandName);
  return DISPLAY_NAMES[internal] ?? internal;
}

export function resolveMoveAnimationCommandName(commandName: string): string {
  return ALIAS_TO_INTERNAL.get(commandName.toLowerCase()) ?? commandName;
}

export function getMoveAnimationCommandAliases(commandName: string): string[] {
  const internal = resolveMoveAnimationCommandName(commandName);
  const aliases = INTERNAL_TO_ALIASES.get(internal) ?? [internal];
  return aliases.slice();
}

export function getMoveAnimationCommandNameSearchTerms(commandName: string): string[] {
  const internal = resolveMoveAnimationCommandName(commandName);
  return [...new Set([internal, getMoveAnimationDisplayCommandName(internal), ...getMoveAnimationCommandAliases(internal)])];
}

export function getMoveAnimationGenericCommandAliases(opcode: number): string[] {
  const hex = opcode.toString(16);
  return [`CMD_${hex}`, `CMD_${hex.padStart(2, "0")}`, `CMD_0x${hex}`];
}
