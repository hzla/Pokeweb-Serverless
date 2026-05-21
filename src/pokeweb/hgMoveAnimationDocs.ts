export type HgColorParameterGroup =
  | {
      kind: "rgb555Triplet";
      label: string;
      indices: readonly [number, number, number];
    }
  | {
      kind: "rgb555Packed";
      label: string;
      index: number;
    };

export type HgMoveAnimationHelperDefinition = {
  name: string;
  params: string[];
  description: string;
  expandsTo: string;
  colorParams?: HgColorParameterGroup[];
};

export type HgCallFunctionDefinition = {
  id: number;
  name: string;
  description: string;
  colorParams?: HgColorParameterGroup[];
};

export type HgPrimitiveCommandParameterNote = {
  name: string;
  description: string;
};

export type HgPrimitiveCommandNote = {
  name: string;
  inferredName: string;
  description: string;
  params?: HgPrimitiveCommandParameterNote[];
  source: string;
};

export const HG_MOVE_ANIMATION_HELPER_DEFINITIONS: HgMoveAnimationHelperDefinition[] = [
  {
    name: "loadparticlefromspa",
    params: ["slot", "spaFile"],
    description: "Loads SPA file resources from /a/0/2/9 into a particle slot.",
    expandsTo: "sprite resource setup + loadparticle + waitstate",
  },
  {
    name: "shadeattackingmon",
    params: ["red", "green", "blue"],
    description: "Tints the attacking Pokemon toward an RGB555 color.",
    expandsTo: "callfunction 34",
    colorParams: [{ kind: "rgb555Triplet", label: "Tint color", indices: [0, 1, 2] }],
  },
  {
    name: "shadetargetmon",
    params: ["red", "green", "blue"],
    description: "Tints the target Pokemon toward an RGB555 color.",
    expandsTo: "callfunction 34",
    colorParams: [{ kind: "rgb555Triplet", label: "Tint color", indices: [0, 1, 2] }],
  },
  {
    name: "flashscreencolor",
    params: ["red", "green", "blue"],
    description: "Flashes the whole screen with an RGB555 color.",
    expandsTo: "callfunction 33",
    colorParams: [{ kind: "rgb555Triplet", label: "Flash color", indices: [0, 1, 2] }],
  },
  {
    name: "shaketargetmon",
    params: ["times", "magnitude"],
    description: "Shakes the target Pokemon the requested number of times by the requested magnitude.",
    expandsTo: "callfunction 36",
  },
  {
    name: "shaketargetside",
    params: ["times", "magnitude"],
    description: "Shakes both target-side Pokemon sprite slots.",
    expandsTo: "callfunction 36 twice",
  },
  {
    name: "shakeallbutuser",
    params: ["times", "magnitude"],
    description: "Shakes all visible Pokemon except the user.",
    expandsTo: "callfunction 36",
  },
  {
    name: "slideattackingmon",
    params: ["x", "y"],
    description: "Slides the attacking Pokemon by the requested pixel delta.",
    expandsTo: "callfunction 57",
  },
  {
    name: "shakescreen",
    params: [],
    description: "Applies a short screen shake.",
    expandsTo: "callfunction 68",
  },
  {
    name: "rotateattackerincircle",
    params: [],
    description: "Sets up sprite resources and runs the attacker circle helper.",
    expandsTo: "sprite resources + callfunction 8",
  },
  {
    name: "moveaxistotarget",
    params: ["slot", "emitter"],
    description: "Moves a particle axis toward the target so location 17 emitters travel target-relative.",
    expandsTo: "cmd37",
  },
  {
    name: "particle_operator",
    params: ["priority", "target", "position", "axis", "field", "camera"],
    description:
      "Readable alias for the primary particle operator record: priority, target mode, position mode, axis mode, field-effect bit mask, and camera mode.",
    expandsTo: "cmd37 6",
  },
  {
    name: "particle_operator_offset",
    params: ["exMode", "x", "y", "z"],
    description: "Readable alias for a particle operator offset record.",
    expandsTo: "cmd37 4",
  },
  {
    name: "particle_field_data",
    params: ["fieldMode", "reverse", "arg0", "arg1", "arg2"],
    description: "Generic readable alias for a particle field-effect detail record when the active field bit is not known from context.",
    expandsTo: "cmd37 5",
  },
  {
    name: "particle_gravity_magnitude",
    params: ["fieldMode", "reverse", "x", "y", "z"],
    description: "Gravity field detail. Values are the gravity vector components.",
    expandsTo: "cmd37 5",
  },
  {
    name: "particle_random_magnitude",
    params: ["fieldMode", "reverse", "x", "y", "z"],
    description: "Random field detail. Values control random velocity or position magnitude.",
    expandsTo: "cmd37 5",
  },
  {
    name: "particle_random_interval",
    params: ["fieldMode", "reverse", "frames", "arg1", "arg2"],
    description: "Random interval detail. The first payload value is the random update interval.",
    expandsTo: "cmd37 5",
  },
  {
    name: "particle_magnet_target",
    params: ["fieldMode", "reverse", "x", "y", "z"],
    description: "Magnet target detail. The payload is a target position for magnet behavior.",
    expandsTo: "cmd37 5",
  },
  {
    name: "particle_magnet_force",
    params: ["fieldMode", "reverse", "x", "y", "z"],
    description: "Magnet force detail. Values control pull magnitude.",
    expandsTo: "cmd37 5",
  },
  {
    name: "particle_spin_radius",
    params: ["fieldMode", "reverse", "arg0", "arg1", "arg2"],
    description: "Spin radius detail. Rendering support is still partial.",
    expandsTo: "cmd37 5",
  },
  {
    name: "particle_spin_axis",
    params: ["fieldMode", "reverse", "arg0", "arg1", "arg2"],
    description: "Spin axis detail. Rendering support is still partial.",
    expandsTo: "cmd37 5",
  },
  {
    name: "particle_collision_y",
    params: ["fieldMode", "reverse", "arg0", "arg1", "arg2"],
    description: "Collision height detail. Rendering support is still partial.",
    expandsTo: "cmd37 5",
  },
  {
    name: "particle_collision_callback",
    params: ["fieldMode", "reverse", "arg0", "arg1", "arg2"],
    description: "Collision callback detail. Rendering support is still partial.",
    expandsTo: "cmd37 5",
  },
  {
    name: "particle_collision_event",
    params: ["fieldMode", "reverse", "arg0", "arg1", "arg2"],
    description: "Collision event detail. Rendering support is still partial.",
    expandsTo: "cmd37 5",
  },
  {
    name: "particle_collision_global",
    params: ["fieldMode", "reverse", "arg0", "arg1", "arg2"],
    description: "Global collision detail. Rendering support is still partial.",
    expandsTo: "cmd37 5",
  },
  {
    name: "particle_convergence_target",
    params: ["fieldMode", "reverse", "x", "y", "z"],
    description: "Convergence target detail. The payload is the target position.",
    expandsTo: "cmd37 5",
  },
  {
    name: "particle_convergence_force",
    params: ["fieldMode", "reverse", "ratio", "arg1", "arg2"],
    description: "Convergence force detail. The first payload value controls convergence strength.",
    expandsTo: "cmd37 5",
  },
  {
    name: "shadescreencolor",
    params: ["red", "green", "blue", "alpha0", "alpha1"],
    description: "Starts a transition between alpha values using the supplied RGB555 screen tint color.",
    expandsTo: "callfunction 33",
    colorParams: [{ kind: "rgb555Triplet", label: "Tint color", indices: [0, 1, 2] }],
  },
  {
    name: "screen_tint",
    params: ["count", "num0", "num1", "num2", "num3", "color", "num5", "num6", "num7", "num8", "num9"],
    description: "Readable alias for callfunction 33. The first parameter is the HG variable count; the remaining parameters are the raw function arguments.",
    expandsTo: "callfunction 33",
    colorParams: [{ kind: "rgb555Packed", label: "Screen color", index: 5 }],
  },
  {
    name: "pokemon_tint",
    params: ["count", "num0", "num1", "num2", "color", "num4", "num5", "num6", "num7", "num8", "num9"],
    description: "Readable alias for callfunction 34. The first parameter is the variable count; the remaining parameters are the raw function arguments.",
    expandsTo: "callfunction 34",
    colorParams: [{ kind: "rgb555Packed", label: "Pokemon color", index: 4 }],
  },
  {
    name: "actor_shake",
    params: ["count", "target", "unused", "axis", "magnitude", "flags", "num5", "num6", "num7", "num8", "num9"],
    description: "Readable alias for callfunction 36, the actor shake helper.",
    expandsTo: "callfunction 36",
  },
  {
    name: "actor_slide",
    params: ["count", "target", "x", "y", "flags", "num4", "num5", "num6", "num7", "num8", "num9"],
    description: "Readable alias for callfunction 57, the actor slide or movement helper.",
    expandsTo: "callfunction 57",
  },
  {
    name: "battler_sprite_vanish",
    params: ["count", "targetFlags", "vanish", "num2", "num3", "num4", "num5", "num6", "num7", "num8", "num9"],
    description:
      "Readable alias for callfunction 40, the WEST_SP_WE_SSP_POKE_VANISH helper. It sets the vanish flag on selected battler soft-sprites; 0 shows and 1 hides.",
    expandsTo: "callfunction 40",
  },
  {
    name: "battler_sprite_scale_updown",
    params: ["count", "targetFlags", "startScaleX", "endScaleX", "startScaleY", "endScaleY", "baseScale", "waitAndRepeat", "scaleFrames", "num8", "num9"],
    description:
      "Readable alias for callfunction 42, the WEST_SP_WE_SSP_POKE_SCALE_UPDOWN helper. It scales the selected battler soft-sprite from start X/Y scale to end X/Y scale, waits, then scales back; waitAndRepeat packs wait frames in the high 16 bits and repeat count in the low 16 bits, while scaleFrames packs scale-up frames high and scale-down frames low.",
    expandsTo: "callfunction 42",
  },
  {
    name: "battler_sprite_slide_x",
    params: ["count", "wait", "offsetX", "targetFlags", "num3", "num4", "num5", "num6", "num7", "num8", "num9"],
    description:
      "Readable alias for callfunction 52, the WEST_SP_WE_T05 helper. It moves the selected battler soft-sprite horizontally by offsetX over wait frames; targetFlags usually combine WE_TOOL_M1/E1/E2 with WE_TOOL_SSP.",
    expandsTo: "callfunction 52",
  },
  {
    name: "screen_shake",
    params: ["count", "num0", "num1", "num2", "num3", "num4", "num5", "num6", "num7", "num8", "num9"],
    description: "Readable alias for callfunction 68, the screen shake helper.",
    expandsTo: "callfunction 68",
  },
  {
    name: "particle_emitter_straight",
    params: ["count", "emitter", "offsetX", "offsetY", "delay", "duration", "height", "target", "loopWindow", "wave", "num9"],
    description:
      "Readable alias for callfunction 65, the WEST_SP_EMIT_STRAIGHT helper. It moves a particle emitter linearly between attacker and defender anchors, with optional end offset, delay, target reversal, packed loop-window/start-skip data, and sine wobble.",
    expandsTo: "callfunction 65",
  },
  {
    name: "particle_emitter_rotation",
    params: ["count", "emitter", "startAngleX", "endAngleX", "startAngleY", "endAngleY", "radiusX", "radiusY", "wait", "target", "particleSlot"],
    description:
      "Readable alias for callfunction 72, the WEST_SP_EMIT_ROTATION helper. It moves a particle emitter around the attacker or defender using X/Y angle ranges, radii, duration, target side, and particle slot.",
    expandsTo: "callfunction 72",
  },
  {
    name: "battle_palette_grayscale",
    params: ["count", "mode", "num1", "num2", "num3", "num4", "num5", "num6", "num7", "num8", "num9"],
    description:
      "Readable alias for callfunction 74, the WEST_SP_PALCOL_CHANGE helper. Nonzero mode switches battle palettes to grayscale; 0 restores normal palettes.",
    expandsTo: "callfunction 74",
  },
  {
    name: "pokemon_oam_view",
    params: ["count", "captureId", "wait", "bgType", "softPriority", "dropTarget", "callback", "targetSide", "num7", "num8", "num9"],
    description:
      "Readable alias for callfunction 75, the WEST_SP_POKE_OAM_VIEW helper. It displays a captured Pokemon OAM/CATS object for wait frames with optional BG priority, soft priority, drop-target priority adjustment, and callback/window behavior.",
    expandsTo: "callfunction 75",
  },
  {
    name: "particle_resource_setup",
    params: ["count", "num0", "num1", "num2", "num3", "num4", "num5", "num6", "num7", "num8", "num9"],
    description: "Readable alias for callfunction 78, used by the particle loading helper sequence.",
    expandsTo: "callfunction 78",
  },
  {
    name: "rotate_attacker_helper",
    params: ["count", "num0", "num1", "num2", "num3", "num4", "num5", "num6", "num7", "num8", "num9"],
    description: "Readable alias for callfunction 8, the low-level rotate-attacker-in-circle helper.",
    expandsTo: "callfunction 8",
  },
  {
    name: "particle_metadata",
    params: ["cmd37Count", "slot", "emitter", "mode", "arg0", "arg1", "arg2", "arg3", "arg4"],
    description: "Fallback readable alias for unusual cmd37 records that do not match the known particle operator shapes.",
    expandsTo: "cmd37",
  },
];

export const HG_CALLFUNCTION_DEFINITIONS: HgCallFunctionDefinition[] = [
  {
    id: 8,
    name: "rotate attacker helper",
    description: "Function 8: attacker circle helper used by rotateattackerincircle.",
  },
  {
    id: 33,
    name: "screen tint/fade",
    description: "Function 33: screen tint or fade helper. Arguments 3 and 4 are alpha values; argument 5 is a packed RGB555 color.",
    colorParams: [{ kind: "rgb555Packed", label: "Screen color", index: 6 }],
  },
  {
    id: 34,
    name: "Pokemon tint",
    description: "Function 34: Pokemon sprite tint helper. Argument 3 is a packed RGB555 color.",
    colorParams: [{ kind: "rgb555Packed", label: "Pokemon color", index: 5 }],
  },
  {
    id: 36,
    name: "actor shake",
    description: "Function 36: actor shake helper.",
  },
  {
    id: 40,
    name: "battler sprite vanish",
    description: "Function 40: WEST_SP_WE_SSP_POKE_VANISH. Sets the vanish flag on selected battler soft-sprites; 0 shows and 1 hides.",
  },
  {
    id: 42,
    name: "battler sprite scale up/down",
    description:
      "Function 42: WEST_SP_WE_SSP_POKE_SCALE_UPDOWN. Scales the selected battler soft-sprite from start X/Y scale to end X/Y scale, waits, then scales back; argument 6 packs wait frames and repeat count, and argument 7 packs scale-up and scale-down frame counts.",
  },
  {
    id: 52,
    name: "battler sprite horizontal slide",
    description:
      "Function 52: WEST_SP_WE_T05. Moves the selected battler soft-sprite horizontally from its current X to current X plus offset over the requested wait duration.",
  },
  {
    id: 57,
    name: "actor slide",
    description: "Function 57: actor slide or movement helper.",
  },
  {
    id: 65,
    name: "straight particle emitter",
    description:
      "Function 65: WEST_SP_EMIT_STRAIGHT. Moves the selected particle emitter in a straight line between attacker and defender particle anchors, optionally reversed, delayed, pre-advanced, frozen, or given a small sine wobble.",
  },
  {
    id: 66,
    name: "parabolic particle emitter",
    description: "Function 66: moves the most recent matching particle emitter along an arcing path, usually from user toward target.",
  },
  {
    id: 68,
    name: "screen shake",
    description: "Function 68: screen shake helper.",
  },
  {
    id: 72,
    name: "particle emitter rotation",
    description:
      "Function 72: WEST_SP_EMIT_ROTATION. Moves a particle emitter around the attacker or defender using X/Y start/end angles, X/Y radii, wait duration, target side, and particle slot.",
  },
  {
    id: 74,
    name: "battle palette grayscale",
    description: "Function 74: WEST_SP_PALCOL_CHANGE. Nonzero mode switches battle palettes to grayscale; 0 restores normal palettes.",
  },
  {
    id: 75,
    name: "Pokemon OAM view",
    description:
      "Function 75: WEST_SP_POKE_OAM_VIEW. Displays a captured Pokemon OAM/CATS object for the requested duration, with optional BG priority, soft priority, drop-target priority adjustment, and callback/window behavior.",
  },
  {
    id: 78,
    name: "particle resource setup",
    description: "Function 78: particle resource setup helper used by loadparticlefromspa.",
  },
];

export const HG_PRIMITIVE_COMMAND_NOTES: HgPrimitiveCommandNote[] = [
  {
    name: "cmd1F",
    inferredName: "copy battler to BG2",
    description:
      "Copies the selected Pokemon's character tiles, palette, and screen data onto BG layer 2, then positions that BG copy over the Pokemon sprite. HG scripts usually pair this with cmd20 to clear the copy after the effect.",
    params: [
      {
        name: "battler",
        description: "Battler selector resolved through the retail animation target helper; 0 is attacker/user and 1 is defender/target in common move scripts.",
      },
      {
        name: "track",
        description: "When set to 1, starts a task that keeps the BG copy tracking the Pokemon's current sprite position. 0 makes a static copy.",
      },
    ],
    source: "pokeheartgold overlay_07 ov07_0221D5B0; validated against cleangold overlay 7 dispatch table.",
  },
  {
    name: "cmd20",
    inferredName: "clear BG2 battler copy",
    description: "Clears the BG2 character data used by cmd1F and destroys the optional tracking task. The single script parameter is skipped by retail code and appears unused.",
    params: [{ name: "unused", description: "Skipped by the command handler; 0 is normally used." }],
    source: "pokeheartgold overlay_07 ov07_0221D718.",
  },
  {
    name: "cmd28",
    inferredName: "no-op",
    description: "Retail handler is an empty stub.",
    source: "pokeheartgold overlay_07 ov07_0221DD0C.",
  },
  {
    name: "cmd29",
    inferredName: "no-op",
    description: "Retail handler is an empty stub.",
    source: "pokeheartgold overlay_07 ov07_0221DD10.",
  },
  {
    name: "cmd2A",
    inferredName: "no-op",
    description: "Retail handler is an empty stub.",
    source: "pokeheartgold overlay_07 ov07_0221F090.",
  },
  {
    name: "cmd2B",
    inferredName: "no-op",
    description: "Retail handler is an empty stub.",
    source: "pokeheartgold overlay_07 ov07_0221F094.",
  },
  {
    name: "cmd3E",
    inferredName: "set sprite-state byte A",
    description: "Writes a byte into one of the animation engine's small per-sprite state arrays. Scripts use this as a low-level reset/visibility helper before sprite effects.",
    params: [
      { name: "slot", description: "Byte slot offset inside the state array." },
      { name: "value", description: "Byte value to store." },
    ],
    source: "pokeheartgold overlay_07 ov07_0221DCD4.",
  },
  {
    name: "cmd37",
    inferredName: "particle axis/position metadata",
    description:
      "Variable-length particle metadata command, usually placed immediately before particle spawns to steer emitter axes or seed per-particle offsets.",
    params: [
      { name: "count", description: "Number of following metadata words to emit, up to 8." },
      { name: "slot", description: "Particle or metadata slot." },
      { name: "emitter", description: "Emitter index inside the loaded SPA." },
      { name: "mode", description: "Position or axis mode. Mode 6 is used by moveaxistotarget." },
      { name: "arg0", description: "Mode-specific value, often a target/axis selector." },
      { name: "arg1", description: "Mode-specific value, often an X or packed offset." },
      { name: "arg2", description: "Mode-specific value, often a Y/Z/flag value." },
      { name: "arg3", description: "Mode-specific value." },
      { name: "arg4", description: "Mode-specific value." },
    ],
    source: "clean HG dispatch table maps opcode 0x37 to ov07_0221F814/GF_AssertFail; HG-engine animscriptcmd.s uses cmd37 and moveaxistotarget for particle axis control.",
  },
  {
    name: "cmd43",
    inferredName: "clear scratch params",
    description: "Clears the ten-word scratch parameter area used by several later helper calls and conditional/effect commands.",
    source: "pokeheartgold overlay_07 ov07_0221C74C.",
  },
  {
    name: "cmd52",
    inferredName: "start managed sprite draw task",
    description:
      "Binds an existing managed sprite into a battler-aware draw/update slot, hides or reprioritizes it based on the selected battler and battle side, then starts a draw task. Used by helper sequences such as rotateattackerincircle.",
    params: [
      { name: "battler", description: "Battler selector resolved through the same target helper used by cmd1F." },
      { name: "slot", description: "Internal managed-sprite task slot." },
      { name: "sourceSprite", description: "Existing managed sprite/resource slot to bind." },
    ],
    source: "pokeheartgold overlay_07 ov07_0221DAF4.",
  },
  {
    name: "cmd53",
    inferredName: "stop managed sprite draw task",
    description: "Disables the managed-sprite draw/update slot started by cmd52.",
    params: [{ name: "slot", description: "Internal managed-sprite task slot to disable." }],
    source: "pokeheartgold overlay_07 ov07_0221DCA8.",
  },
  {
    name: "cmd54",
    inferredName: "wait for input gate",
    description: "Sets the script wait flag until a specific input condition is satisfied. This appears to be a debug or synchronization gate and is rarely used in move scripts.",
    source: "pokeheartgold overlay_07 ov07_0221C6B4.",
  },
  {
    name: "cmd55",
    inferredName: "screen brightness pulse",
    description: "Initializes screen brightness data and starts a fade-out/fade-in brightness pulse task.",
    params: [{ name: "screen", description: "Low-byte screen or brightness target selector passed to StartBrightnessTransition." }],
    source: "pokeheartgold overlay_07 ov07_0221D374.",
  },
  {
    name: "cmd56",
    inferredName: "animated BG/effect offset task",
    description:
      "Starts the same background/effect task family used by HG background transitions, with packed timing and axis-offset controls. The third parameter's low half selects the offset mode; its high half is the signed offset amount.",
    params: [
      { name: "effect", description: "Background/effect id passed into the transition task." },
      { name: "packedTiming", description: "Packed low/high halfwords consumed as timing or blend fields." },
      { name: "packedOffset", description: "Low halfword selects offset mode 1-6; high halfword is the signed delta." },
    ],
    source: "pokeheartgold overlay_07 ov07_0221ED94.",
  },
  {
    name: "cmd57",
    inferredName: "conditional branch on battle flag",
    description: "Branches by the supplied relative offset when a battle-context flag at the animation state is set; otherwise it skips the offset word.",
    params: [{ name: "relativeOffset", description: "Raw relative branch word offset, using the standard HG script branch formula." }],
    source: "pokeheartgold overlay_07 ov07_0221D23C.",
  },
];

export const HG_MOVE_ANIMATION_HELPER_BY_NAME = new Map(HG_MOVE_ANIMATION_HELPER_DEFINITIONS.map((definition) => [definition.name.toLowerCase(), definition]));
export const HG_CALLFUNCTION_BY_ID = new Map(HG_CALLFUNCTION_DEFINITIONS.map((definition) => [definition.id, definition]));
export const HG_PRIMITIVE_COMMAND_BY_NAME = new Map(HG_PRIMITIVE_COMMAND_NOTES.map((definition) => [definition.name.toLowerCase(), definition]));
