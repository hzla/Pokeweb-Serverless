export type Bw2MovementCommand = { name: string; opcode: number; description: string };

// BW2 movement IDs from FrostsGen5Editor's MovementCommands.h. Movement
// records have their own opcode namespace; they are not field instructions.
const commands: Bw2MovementCommand[] = [];
const directions = ["up", "down", "left", "right"];
for (const [start, family] of [
  [0x00, "face"], [0x04, "slowest_walk"], [0x08, "slow_walk"], [0x0c, "walk"],
  [0x10, "fast_walk"], [0x14, "fastest_walk"], [0x18, "slowest_turn"], [0x1c, "slow_turn"],
  [0x20, "turn"], [0x24, "fast_turn"], [0x28, "fastest_turn"], [0x2c, "slow_hop"],
  [0x30, "hop"], [0x34, "jump_1"], [0x38, "jump_2"], [0x4c, "medium_fast_walk"],
  [0x50, "faster_walk"], [0x54, "instant_walk"], [0x58, "run"],
  [0xa3, "run_6f"], [0xa7, "walk_12f"],
] as const) {
  directions.forEach((direction, index) => commands.push({ name: `${family}_${direction}`, opcode: start + index, description: `${family.replaceAll("_", " ")} ${direction}.` }));
}
for (const [index, duration] of [1, 2, 4, 8, 15, 16, 32].entries()) commands.push({ name: `wait_${duration}`, opcode: 0x3c + index, description: `Wait using the ${duration}-unit movement delay.` });
for (const [opcode, name, description] of [
  [0x43, "warp_pad_up", "Warp-pad ascent."], [0x44, "warp_pad_down", "Warp-pad descent."],
  [0x45, "vanish", "Hide the moving actor."], [0x46, "reappear", "Show the moving actor."],
  [0x47, "lock_direction", "Lock facing during movement."], [0x48, "unlock_direction", "Release the facing lock."],
  [0x49, "pause_animation", "Pause the actor's movement animation."], [0x4a, "unpause_animation", "Resume the actor's movement animation."],
  [0x4b, "exclamation", "Show an exclamation reaction."], [0x9f, "question_mark", "Show a question-mark reaction."],
  [0xa0, "music_note", "Show a music-note reaction."], [0xa1, "ellipsis", "Show an ellipsis reaction."],
  [0x64, "animation_0_once", "Play the actor model's animation slot 0 once. This is a model-specific gesture, not a universal turn command."],
  [0x9a, "player_receive_item", "Play the player's item-receiving animation."],
  [0xb5, "animation_0_loop", "Play the actor model's animation slot 0 with its looping behavior."],
  [0xb6, "animation_1_once", "Play the actor model's animation slot 1 once."],
  [0xb7, "animation_1_loop", "Play the actor model's animation slot 1 with its looping behavior. Mom uses this for answering the phone."],
  [0xba, "animation_2_once", "Play the actor model's animation slot 2 once. Mom uses this for hanging up the phone."],
  [0xbb, "animation_2_loop", "Play the actor model's animation slot 2 with its looping behavior."],
] as const) commands.push({ opcode, name, description });

// Additional native BW2 action records. All use the same two-u16 list format.
for (const [start, family, description] of [
  [0x60, "walk_7f", "Walk in the named direction using the 7-frame action"],
  [0x69, "left_wall_walk", "Walk along the left wall in the named direction"],
  [0x6d, "right_wall_walk", "Walk along the right wall in the named direction"],
  [0x71, "ceiling_walk", "Walk along the upper wall in the named direction"],
  [0x75, "jump_3", "Jump three grid squares in the named direction"],
  [0x79, "left_wall_run", "Run along the left wall in the named direction"],
  [0x7d, "right_wall_run", "Run along the right wall in the named direction"],
  [0x81, "ceiling_run", "Run along the upper wall in the named direction"],
  [0x85, "left_wall_jump", "Jump along the left wall in the named direction"],
  [0x89, "right_wall_jump", "Jump along the right wall in the named direction"],
  [0x8d, "ceiling_jump", "Jump along the upper wall in the named direction"],
  [0x91, "ceiling_walk_4f", "Walk along the upper wall using the 4-frame action"],
  [0x95, "ceiling_walk_2f", "Walk along the upper wall using the 2-frame action"],
  [0x9b, "sand_walk", "Play the sand-walking action in the named direction"],
] as const) directions.forEach((direction, index) => commands.push({ opcode: start + index, name: `${family}_${direction}`, description: `${description}: ${direction}.` }));
for (const [opcode, name, description] of [
  [0x5c, "high_jump_left_1", "Player high jump left by one grid square."],
  [0x5d, "high_jump_right_1", "Player high jump right by one grid square."],
  [0x5e, "high_jump_left_3", "Player high jump left by three grid squares."],
  [0x5f, "high_jump_right_3", "Player high jump right by three grid squares."],
  [0x65, "remove_disguise", "Remove the hidden actor's camouflage/disguise."],
  [0x66, "player_hold_out_hands", "Player holds out both hands."],
  [0x67, "rematch_mark", "Show the rematch reaction mark."],
  [0x68, "player_receive_with_hands", "Player's receiving gesture with both hands."],
  [0x99, "exclamation_wait_graphics", "Show an exclamation after its graphics transfer completes."],
  [0xa2, "player_cutin", "Play the player's field-action cut-in gesture."],
  [0xab, "remove_spider_web", "Play the spider actor's web-removal animation."],
  [0xac, "kyurem_roar", "Play Kyurem's roar action."],
  [0xad, "kyurem_fly_left", "Play Kyurem's leftward flight action."],
  [0xae, "kyurem_ascend", "Play Kyurem's ascending flight action."],
  [0xaf, "kyurem_collapse", "Play Kyurem's weakened/collapsed action."],
  [0xb0, "kyurem_turn", "Play Kyurem's turning action."],
  [0xb1, "meloetta_spin", "Meloetta Aria Forme's spin action."],
  [0xb2, "meloetta_spin_pose", "Meloetta Aria Forme's spin and pose action."],
  [0xb3, "meloetta_sway", "Meloetta Aria Forme's vertical swaying action."],
  [0xb4, "kyurem_clear_draw_offset", "Reset Kyurem's visual drawing offset."],
  [0xb8, "ninja_appear", "Play the ninja actor's appearance animation."],
  [0xb9, "ninja_disappear", "Play the ninja actor's disappearance animation."],
  [0xbc, "kyurem_hover", "Play Kyurem's alternate-form hovering action."],
  [0xbd, "exclamation_silent", "Show an exclamation without the reaction sound."],
  [0xbe, "music_note_silent", "Show a music note without the reaction sound."],
  [0xbf, "legendary_roar", "Roar action for the compatible Reshiram, Zekrom and Kyurem actors."],
  [0xc0, "meloetta_dance", "Meloetta Pirouette Forme's dance action."],
] as const) commands.push({ opcode, name, description });

export const BW2_MOVEMENT_COMMANDS: readonly Bw2MovementCommand[] = Object.freeze(commands);
const byName = new Map(commands.map((command) => [command.name, command]));
const byOpcode = new Map(commands.map((command) => [command.opcode, command]));
export const bw2MovementByName = (name: string): Bw2MovementCommand | undefined => byName.get(name);
export const bw2MovementByOpcode = (opcode: number): Bw2MovementCommand | undefined => byOpcode.get(opcode);
