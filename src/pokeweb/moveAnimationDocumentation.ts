import commandDocsData from "../assets/data/moveAnimationCommandDocs.json";
import {
  getMoveAnimationCommandAliases,
  getMoveAnimationDisplayCommandName,
  getMoveAnimationGenericCommandAliases,
  resolveMoveAnimationCommandName,
} from "./moveAnimationCommandNames";
import { getMoveAnimationCommandDefinitions, type MoveAnimationCommandDefinition } from "./moveAnimationModel";

export type MoveAnimationCommandDocParam = {
  index: number;
  name: string;
  currentArg: string;
  description: string;
};

export type MoveAnimationCommandDoc = {
  name: string;
  opcode: number;
  hex: string;
  category: string;
  handlerMacro: string;
  description: string;
  currentPokewebName: string;
  params: MoveAnimationCommandDocParam[];
  notes: string[];
};

export type MoveAnimationWorkflowGuide = {
  id: string;
  title: string;
  level: "Beginner" | "Intermediate" | "Advanced";
  summary: string;
  pureScript: string[];
  requiresSpa: string[];
  checklist: string[];
};

export type SpaFieldReference = {
  key: string;
  title: string;
  group: "Emitter" | "Particle" | "Curves" | "Texture" | "Child" | "Behavior" | "Archive";
  description: string;
  scriptBoundary: string;
  donorNotes: string[];
  vanillaExamples: string[];
};

export type ScriptSpaBoundaryReference = {
  topic: string;
  pureScript: string;
  requiresSpa: string;
  examples: string[];
};

export type FutureMoveAnimationToolingNote = {
  title: string;
  description: string;
};

export const MOVE_ANIMATION_COMMAND_DOCS = commandDocsData.commands as MoveAnimationCommandDoc[];

export function getDocumentedMoveAnimationCommands(): MoveAnimationCommandDoc[] {
  return MOVE_ANIMATION_COMMAND_DOCS.map((doc) => ({ ...doc, params: doc.params.map((param) => ({ ...param })), notes: doc.notes.slice() }));
}

export function getMoveAnimationCommandDoc(name: string): MoveAnimationCommandDoc | undefined {
  const normalized = resolveMoveAnimationCommandName(name).toLowerCase();
  return MOVE_ANIMATION_COMMAND_DOCS.find((doc) => doc.name.toLowerCase() === normalized || doc.currentPokewebName.toLowerCase() === normalized);
}

export function getMoveAnimationCommandDocsByCategory(): Array<{ category: string; commands: MoveAnimationCommandDoc[] }> {
  const categories = new Map<string, MoveAnimationCommandDoc[]>();
  for (const doc of MOVE_ANIMATION_COMMAND_DOCS) {
    const bucket = categories.get(doc.category) ?? [];
    bucket.push(doc);
    categories.set(doc.category, bucket);
  }
  return [...categories.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, commands]) => ({ category, commands: commands.slice().sort((a, b) => a.opcode - b.opcode) }));
}

export function getMoveAnimationCommandDocumentationGaps(
  definitions: MoveAnimationCommandDefinition[] = getMoveAnimationCommandDefinitions(),
): Array<{ command: string; issue: string }> {
  const docsByName = new Map<string, MoveAnimationCommandDoc>();
  const docsByOpcode = new Map<number, MoveAnimationCommandDoc>();
  for (const doc of MOVE_ANIMATION_COMMAND_DOCS) {
    docsByOpcode.set(doc.opcode, doc);
    for (const alias of [doc.name, doc.currentPokewebName, getMoveAnimationDisplayCommandName(doc.name), ...getMoveAnimationCommandAliases(doc.name), ...getMoveAnimationGenericCommandAliases(doc.opcode)]) {
      docsByName.set(alias.toLowerCase(), doc);
    }
  }

  const gaps: Array<{ command: string; issue: string }> = [];
  for (const definition of definitions) {
    const doc = docsByName.get(definition.name.toLowerCase()) ?? docsByOpcode.get(definition.opcode);
    if (!doc) {
      gaps.push({ command: getMoveAnimationDisplayCommandName(definition.name), issue: "missing command documentation" });
      continue;
    }
    const displayName = getMoveAnimationDisplayCommandName(definition.name);
    if (!doc.description.trim()) gaps.push({ command: displayName, issue: "missing description" });
    if (!doc.category.trim()) gaps.push({ command: displayName, issue: "missing category" });
    if (doc.params.length !== expectedDocumentedParamCount(definition)) {
      gaps.push({ command: displayName, issue: `documents ${doc.params.length} params, command definition has ${definition.params.length}` });
    }
    for (let index = 0; index < doc.params.length; index += 1) {
      const param = doc.params[index];
      if (!param || !param.name.trim() || !param.description.trim()) gaps.push({ command: displayName, issue: `param ${index} is missing name or description` });
    }
  }
  return gaps;
}

function expectedDocumentedParamCount(definition: MoveAnimationCommandDefinition): number {
  // DistortBackground accepts the current 6-arg macro, but older Pokeweb scripts
  // may decompile with the 4-arg shorthand. The command docs intentionally cover
  // the stable user-facing args and the parser pads the legacy form.
  if (definition.name === "DistortBackground") return 4;
  return definition.params.length;
}

export const MOVE_ANIMATION_WORKFLOW_GUIDES: MoveAnimationWorkflowGuide[] = [
  {
    id: "quick-start",
    title: "Quick Start: Copy And Preview A Donor Move",
    level: "Beginner",
    summary: "Start from a vanilla move script, preview it, and identify which pieces are script commands versus SPA particles before editing.",
    pureScript: ["Copy or import a move animation binary.", "Remove waits, sounds, camera moves, or background commands you do not want.", "Use Preview and Audio tabs to verify timing before touching particle archives."],
    requiresSpa: ["Any texture swap, emitter recolor, particle size curve, child particle, or behavior change requires SPA inspection."],
    checklist: ["Record donor move ID, actual animation member, SPA IDs, resource IDs, texture IDs, backgrounds, and sounds.", "Preview the unedited donor first.", "Change one layer at a time."],
  },
  {
    id: "recoloring",
    title: "Simple Recoloring And Hue Shifts",
    level: "Beginner",
    summary: "Recoloring can live in script commands, SPA resource color, texture pixels, or animation curves depending on what created the color.",
    pureScript: ["Use ChangeSpriteColor, ChangeBackgroundColor, BackgroundPaletteAnimation, or ObjectPaletteFade when the donor color is controlled by VM commands."],
    requiresSpa: ["Edit resource.color, childResource.color, colorAnim, alphaAnim, texture RGBA/palette data, or texture animation frames when particle color comes from a SPA."],
    checklist: ["Search the script for color and palette commands.", "Inspect every referenced SPA resource for colorAnim before assuming a base color change is enough.", "Replace donor color curves when asking for a new color with variation."],
  },
  {
    id: "splicing",
    title: "Splicing Multiple Donor Animations",
    level: "Intermediate",
    summary: "Combine script sections and cloned SPA resources while avoiding global donor edits and stale IDs.",
    pureScript: ["Script can sequence donor commands, waits, camera moves, sounds, backgrounds, and sprite actions."],
    requiresSpa: ["Clone donor SPAs when you need custom textures, colors, scale curves, spawn volumes, behavior cleanup, or resource offsets."],
    checklist: ["Give each custom SPA a reserved ID.", "Repoint LoadSPA and DoSPA commands together.", "Remove donor sounds/backgrounds unless explicitly requested.", "Use LetCMDsFinish or waits only after checking how long the donor particles persist."],
  },
  {
    id: "projectiles",
    title: "Projectiles: Size, Trajectory, Position, And Speed",
    level: "Intermediate",
    summary: "Projectile commands establish the path, but emitter data can still control size, aspect ratio, lifetime, rotation, and behavior.",
    pureScript: ["EmitProjectile variants set SPA ID, resource ID, anchor selectors, offsets, and travel timing.", "MoveCamera and waits control when the projectile is visible relative to camera motion."],
    requiresSpa: ["Change baseScale, aspectRatio, scaleAnim, emitterBasePos, drawType, init angle, texture, and collision behaviors when the projectile shape itself is wrong."],
    checklist: ["Check whether X/Y/Z offsets move in screen, battle, or orthographic space.", "Remove donor collision/bounce for effects that should stick or vanish.", "If script scale seems ignored, inspect SPA scaleAnim and baseScale first."],
  },
  {
    id: "sprite-motion",
    title: "User And Target Sprite Movement",
    level: "Intermediate",
    summary: "Sprite commands can shake, move, tint, freeze, hide, distort, or delete battler sprites while particles play around them.",
    pureScript: ["Use selectors such as user sprite 14 and target sprite 16 for ShakeSprite, ToggleFreezeSprite, MoveSprite, AdjustSpriteOpacity, ScaleSprite, and related commands."],
    requiresSpa: ["SPA edits are only needed when particles must follow, cover, reveal, or layer around the moved sprite."],
    checklist: ["Do not confuse sprite selectors with camera selectors.", "Keep reveal timing in the VM script whenever possible.", "Avoid C-side visual effects for move animation choreography."],
  },
  {
    id: "backgrounds",
    title: "Backgrounds And Screen Treatment",
    level: "Intermediate",
    summary: "Background commands load, move, fade, distort, prioritize, and show or hide battle backgrounds independently of particle SPAs.",
    pureScript: ["LoadBackground, ApplyBackground, MoveBackground, DistortBackground, BackgroundAlpha, BackgroundPriority, and ChangeBackgroundColor are VM-scripted."],
    requiresSpa: ["SPA edits are not required for background animation unless particles need to match the background palette or motion."],
    checklist: ["Copy only the donor background commands you need.", "Remove donor sprite silhouette/freeze commands when borrowing a fade or flash.", "Preview background ID and palette changes separately."],
  },
  {
    id: "sounds",
    title: "Sounds",
    level: "Beginner",
    summary: "Move scripts can play, stop, pan, and adjust existing sound effects, but they do not create new sound banks.",
    pureScript: ["Use PlaySound, StopSound, SwitchAudioSide, AdjustSound, AudioContainer, PlayPokemonCry, and waits to stage repeated effects."],
    requiresSpa: ["SPA edits are not involved unless sound timing depends on emitter timing or texture animation timing."],
    checklist: ["Remove donor sound effects unless requested.", "Stagger repeated PlaySound commands for volleys or impacts.", "Test with the Audio tab before emulator testing."],
  },
  {
    id: "textures",
    title: "Texture Import, Export, And Formats",
    level: "Advanced",
    summary: "Textures live inside SPA files and use DS texture formats with palette and alpha constraints.",
    pureScript: ["Script commands can choose which SPA resource to spawn, but cannot replace or add textures."],
    requiresSpa: ["Use the SPA editor to import, export, replace, add, remove, or reassign textures. Choose Direct Color, A5I3, or A3I5 deliberately."],
    checklist: ["Use A5I3 for small high-alpha sprites and glow particles.", "Use direct color when color fidelity matters more than size.", "After removing a texture, verify resource/child/texAnim references because later texture indices shift."],
  },
];

export const SPA_FIELD_REFERENCE_DOCS: SpaFieldReference[] = [
  {
    key: "resource.color",
    title: "Resource Color",
    group: "Particle",
    description: "Multiplies the particle texture by an RGB tint. White preserves the texture closest to original color.",
    scriptBoundary: "Requires SPA edit. Script color commands do not override this tint.",
    donorNotes: ["Donor tints can make imported textures look too dark or orange.", "Check childResource.color separately."],
    vanillaExamples: ["Spark uses colored circular particles and glow layers.", "Mega animation donors showed that resource tint plus texture color can compound unexpectedly."],
  },
  {
    key: "resource.colorAnim",
    title: "Color Animation",
    group: "Curves",
    description: "Interpolates particle color over its lifetime and can randomize the starting color.",
    scriptBoundary: "Requires SPA edit. This is the most common cause of recolors drifting back to donor colors.",
    donorNotes: ["Remove or replace donor color curves when copying particles into a new palette.", "Preserve color curves only when the prompt asks for variation."],
    vanillaExamples: ["Aurora Beam alternates/ranges through multiple colors.", "Thousand Waves needed a green variation curve, not the original pink/rainbow curve."],
  },
  {
    key: "resource.alphaAnim",
    title: "Alpha Animation",
    group: "Curves",
    description: "Controls opacity over particle lifetime with start, mid, end, random range, and curve values.",
    scriptBoundary: "Requires SPA edit unless the script is fading a separate sprite/background layer.",
    donorNotes: ["A donor alpha curve can create flicker or make imported solid textures look transparent.", "For stable color, scrub alpha curves before debugging texture colors."],
    vanillaExamples: ["Shock Wave and glow particles commonly use alpha falloff.", "Mega sphere testing exposed opacity/color interactions."],
  },
  {
    key: "resource.scaleAnim",
    title: "Scale Animation",
    group: "Curves",
    description: "Changes particle size over its lifetime on top of baseScale and script projectile scaling.",
    scriptBoundary: "Requires SPA edit when size changes do not respond to script parameters.",
    donorNotes: ["Scale curves can cap or overwhelm projectile size changes.", "Check baseScale, aspectRatio, and scaleAnim together."],
    vanillaExamples: ["Spark expands small circles.", "Dragon Ascent projectile work showed donor scale data can hide script-side size changes."],
  },
  {
    key: "resource.texAnim",
    title: "Texture Animation",
    group: "Texture",
    description: "Cycles through texture indices over particle lifetime.",
    scriptBoundary: "Requires SPA edit. Script can spawn the resource but cannot alter frame texture indices.",
    donorNotes: ["After adding or deleting textures, verify every texture animation frame.", "A stale frame can briefly show the wrong donor particle."],
    vanillaExamples: ["Portal and ring effects often cycle texture frames.", "Mega sphere flicker debugging required watching texture swaps and lifetimes."],
  },
  {
    key: "resource.childResource",
    title: "Child Resource",
    group: "Child",
    description: "Optional secondary particles emitted by the parent particle.",
    scriptBoundary: "Requires SPA edit. Script spawns the parent resource; the child behavior is nested in the SPA.",
    donorNotes: ["Child particles can create unexpected duplicate circles or extra glows.", "Check child texture, child color, emission count, and child alpha/scale flags."],
    vanillaExamples: ["Layered glow effects often use child resources.", "Mega sphere prototyping found donor child emitters could spawn many off-center circles."],
  },
  {
    key: "resource.behaviors",
    title: "Behaviors",
    group: "Behavior",
    description: "Optional forces such as gravity, random push, magnet, spin, collision, and convergence.",
    scriptBoundary: "Requires SPA edit. Behaviors run inside the particle simulation after the script spawns the emitter.",
    donorNotes: ["Collision elasticity can make rocks bounce when arrows should stick.", "Spin/convergence can move projectiles away from scripted paths."],
    vanillaExamples: ["Rock Slide-style falling objects may carry collision behavior.", "Leaf Tornado-style motion uses behavior/orientation data that should be copied intentionally."],
  },
  {
    key: "texture.format",
    title: "Texture Format",
    group: "Texture",
    description: "DS texture encoding: Direct Color, A5I3, A3I5, and indexed/compressed legacy formats have different alpha/color limits.",
    scriptBoundary: "Requires SPA edit. Script cannot change texture encoding.",
    donorNotes: ["Use import format deliberately; preserving an unsupported format falls back to direct color in the editor.", "A5I3 gives useful alpha for glow-style particles."],
    vanillaExamples: ["Mega sphere textures used custom imported images.", "Portal/ring edits rely on preserving transparent pixels cleanly."],
  },
  {
    key: "resource.emitterBasePos",
    title: "Emitter Base Position",
    group: "Emitter",
    description: "Offsets the emitter source relative to the script spawn point before particles are emitted.",
    scriptBoundary: "SPA edit when every script-side spawn appears consistently offset or when multiple cloned resources need baked offsets.",
    donorNotes: ["Do not assume script X/Y offsets are the right coordinate space.", "Bake offsets into cloned resources when donor commands cannot place them correctly."],
    vanillaExamples: ["Hyperspace Fury target portal placement used baked SPA offsets.", "Draco Meteor donors often land around the target rather than directly on it."],
  },
  {
    key: "resource.baseScale",
    title: "Base Scale",
    group: "Particle",
    description: "The default particle size before scale animation, aspect ratio, and script placement effects.",
    scriptBoundary: "Requires SPA edit when the texture itself is too large/small across all script spawns.",
    donorNotes: ["Large donor baseScale can make dense wind layers opaque.", "Small baseScale can make arrow textures look one pixel wide even when the source PNG is larger."],
    vanillaExamples: ["Thousand Arrows needed falling particles to keep the same visible dimensions as launched arrows.", "Mega V1 wind blades needed emitter scale tuning."],
  },
];

export const SCRIPT_SPA_BOUNDARY_REFERENCES: ScriptSpaBoundaryReference[] = [
  {
    topic: "Color",
    pureScript: "Background fades, object palette fades, sprite tinting, and some screen color commands.",
    requiresSpa: "Particle texture pixels, resource/child tint, color animation curves, and alpha-driven perceived color.",
    examples: ["SolarBeam donor sprite flash can be changed in script.", "Mega sphere particle color issues required scrubbing SPA color curves."],
  },
  {
    topic: "Particle Shape",
    pureScript: "Which SPA and resource to spawn, rough anchor/offset, and sequencing.",
    requiresSpa: "Texture image, draw type, child emitters, base scale, aspect ratio, spawn volume, and behaviors.",
    examples: ["Thousand Arrows arrow texture required SPA texture replacement.", "Aurora Beam rings became green hexagons through SPA texture/resource edits."],
  },
  {
    topic: "Timing",
    pureScript: "Waits, LetCMDsFinish, sound timing, camera timing, and command order.",
    requiresSpa: "Emitter life, particle life, start delay, emission interval, texture/alpha/scale/color curve timing.",
    examples: ["Mega sphere reveal timing used script waits plus SPA lifetime tuning.", "Explosion beams needed both script timing and emitter duration."],
  },
  {
    topic: "Movement",
    pureScript: "Sprite movement, camera movement, projectile command endpoints, background scrolling, screen shake.",
    requiresSpa: "Particle velocities, gravity/spin/magnet/collision behavior, emitter base position, axis, random variation.",
    examples: ["Hyperspace Hole/Fury needed target camera selector 11 but sprite selector 16 for sprite commands.", "Rock Slide donor bounce must be removed in SPA for stuck arrows."],
  },
];

export const FUTURE_MOVE_ANIMATION_TOOLING: FutureMoveAnimationToolingNote[] = [
  { title: "Hue Shift / Tint All", description: "Find resource colors, child colors, color curves, and editable texture pixels, then shift them toward a target color with a strength slider." },
  { title: "Donor Scrub Presets", description: "One-click read/write presets that remove donor color, alpha, scale, texture animation, child resources, behaviors, delays, or randomization before custom editing." },
  { title: "Projectile Scale Helper", description: "Coordinate baseScale, aspectRatio, scaleAnim, and projectile command timing so size edits do not fight donor SPA data." },
  { title: "Script Section Copier", description: "Copy a donor command range with referenced LoadSPA, background, and sound dependencies summarized before insertion." },
  { title: "Texture Format Advisor", description: "Warn when imported texture dimensions, alpha, palette needs, or direct-color usage do not match the intended effect." },
];
