import { bw2WorkAlias } from "../../src/pokeweb/bw2ScriptCompiler/workAliases";
import { bw2MovementByName } from "../../src/pokeweb/bw2ScriptCompiler/movementCommands";
import { aliasSummaryEffect, canonicalSummaryCommandName } from "./bw2ScriptSummaryCommandEffects";
import type { Bw2RoutineSummary } from "../../src/pokeweb/bw2ScriptSummaryTypes";

export type SummaryCommand = { offset: number; next: number; opcode: number; name: string; dispatchId?: number; operands: number[]; targets: { kind: string; to: number }[] };
export type SummaryRoutine = { name: string; kind: "script" | "helper" | "block"; offset: number; end: number; entries: number[]; commands: SummaryCommand[] };
export type SummaryMap = { zone: number; name: string; script: number; auxiliary: number; events: number; bank: number; matrix: number; overlay: number | null };
export type SummaryRole = { entry: number; zone: number; when: string };
export type SummaryContext = {
  file: number; routines: SummaryRoutine[]; maps: SummaryMap[]; roles: SummaryRole[];
  banks: number[]; texts: Map<number, Map<number, string>>; items: Map<number, string>;
  shared: { start: number; end: number; member: number; bank: number }[];
  entryReachableOffsets?: ReadonlySet<number>;
};
const unique = <T>(values: T[]) => [...new Set(values)];
const hex = (n: number) => `0x${n.toString(16).padStart(4, "0")}`;
const join = (parts: string[]) => parts.length < 3 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
const limit = (parts: string[], n: number) => join(parts.slice(0, n)) + (parts.length > n ? ` (${parts.length - n} more)` : "");

/** Follow actual local jumps, fallthrough and calls, stopping at VM terminators.
 * Unknown holes stop the analysis; they never acquire guessed command widths. */
export function reachableSummaryCommands(routine: SummaryRoutine, routines: SummaryRoutine[]): { commands: SummaryCommand[]; incomplete: boolean } {
  const all = new Map(routines.flatMap((r) => r.commands).map((c) => [c.offset, c]));
  const pending = [{ offset: routine.offset, returns: [] as number[] }], seen = new Set<string>(), commands = new Map<number, SummaryCommand>();
  let incomplete = false;
  while (pending.length) {
    const { offset, returns } = pending.pop()!, key = `${offset}:${returns.join(",")}`;
    if (seen.has(key)) continue; seen.add(key);
    if (seen.size > 100_000) { incomplete = true; break; }
    const command = all.get(offset);
    if (!command) { incomplete = true; continue; }
    commands.set(offset, { ...command, name: canonicalSummaryCommandName(command) });
    const enqueue = (next: number, stack = returns) => pending.push({ offset: next, returns: stack });
    if ([2, 0x1d].includes(command.opcode)) continue;
    if (command.opcode === 5) { if (returns.length) enqueue(returns.at(-1)!, returns.slice(0, -1)); continue; }
    if (command.opcode === 4 || command.opcode === 0x20) {
      if (returns.length >= 64) incomplete = true;
      else for (const target of command.targets.filter((t) => t.kind === "call")) enqueue(target.to, [...returns, command.next]);
      if (command.opcode === 0x20) enqueue(command.next);
    } else {
      for (const target of command.targets.filter((t) => t.kind === "jump")) enqueue(target.to);
      if (command.opcode !== 0x1e) enqueue(command.next);
    }
  }
  return { commands: [...commands.values()].sort((a, b) => a.offset - b.offset), incomplete };
}

export function summaryEntryReachability(routines: SummaryRoutine[]): ReadonlySet<number> {
  return new Set(routines.filter((r) => r.entries.length).flatMap((r) => reachableSummaryCommands(r, routines).commands.map((c) => c.offset)));
}

const reviewed: Record<string, string> = {
  "854:script_6": "Set up Aspertia's characters when the map loads. Reposition Hugh, Bianca, Mom, and other actors according to bianca_intro_progress, aspertia_gym_opening_progress, and lake_guardians_cave_of_being_event_progress; this does not advance those saved stages.",
  "854:script_22": "Hugh stops following the player at the end of the opening walk. Show his parting dialogue, restore him as a normal map actor, move him away, and update the opening-event progress.",
  "854:helper_3eb": "Bianca introduces herself and asks about becoming a Pokémon Trainer. Move her into place and advance bianca_intro_progress so the starter selection can follow.",
  "854:helper_538": "Let the player choose Snivy, Tepig, or Oshawott as their starter. Add the chosen Pokémon, record the choice in the player-profile survey, and continue Bianca's introductory dialogue.",
  "854:helper_6c6": "Offer to nickname the new starter and confirm the choice. This helper handles the naming dialogue before returning to Bianca's introduction.",
  "854:helper_b1a": "Run the first battle against Hugh using the starter matchup. Handle the win or loss, restore the party when needed, and continue the opening dialogue and progress updates.",
  "854:script_4": "Mom and Hugh's sister see the player off after the first battle. Enable the Running Shoes, give the Town Map, and finish this stage of the Aspertia departure event.",
  "854:script_23": "After the first Gym battle, Bianca gives TM27 (Return). Register Cheren, Bianca, and Professor Juniper in the Xtransceiver, play the call, and offer the C-Gear setup.",
  "854:helper_1406": "Offer to turn on the C-Gear and explain its communication warning. Store the player's response and show the appropriate follow-up dialogue.",
  "854:script_30": "Play Mom's outdoor phone-call scene during the opening. Animate her conversation and return into the house, then fade out to continue the introduction.",
  "854:script_32": "Stage the return to Aspertia during the ending. Set up the actors and camera, play the reunion movement, and continue the closing sequence.",
  "1275:script_1": "Start a following companion using the shared parameter slots. If a companion is already active, return without creating another one.",
  "1275:script_2": "Stop the active companion from following and restore its normal interaction script and movement setting. Return immediately if no companion is active.",
  "1275:script_3": "Show Hugh's companion dialogue, choosing the message from the current map. Close the conversation and release the player.",
  "1275:script_4": "Show Bianca's Reversal Mountain companion dialogue. Advance reversal_mountain_bianca_partner_dialogue until its final repeatable response.",
  "1275:script_5": "Show Hugh's Aspertia companion dialogue. Advance aspertia_hugh_partner_dialogue until its final repeatable response.",
  "1275:script_6": "Show Hugh's Castelia Sewers companion dialogue. Advance castelia_sewers_hugh_partner_dialogue until its final repeatable response.",
  "1240:script_401": "Handle a hidden-item pickup using the item and quantity supplied by its caller. Check Bag space, mark and remove the collected item only on success, and show the pickup or Bag-full message.",
  "1239:script_816": "Handle talking to a trainer, including trainers already defeated. Check the trainer's battle state and party requirements, then choose the battle or post-battle interaction.",
};

export function routineSummary(routine: SummaryRoutine, context: SummaryContext): Bw2RoutineSummary {
  const manual = reviewed[`${context.file}:${routine.name}`];
  const detachedStores = routine.kind === "block" && !routine.entries.length && routine.commands.length > 0 &&
    routine.commands.every((c) => c.opcode === 0x28 && c.operands[0] >= 0x8020 && c.operands[0] <= 0x80ff && c.operands[1] === 0) &&
    !context.routines.some((r) => r.commands.some((c) => c.targets.some((t) => t.to === routine.offset) || (![2, 5, 0x1d, 0x1e].includes(c.opcode) && c.next === routine.offset && c.offset < routine.offset)));
  if (detachedStores) return { offset: routine.offset, kind: routine.kind, entries: routine.entries,
    summary: "Detached work-initialization fragment. Clear the temporary work slots listed below. No decoded entry, jump, or local call targets this fragment; its runtime use is not established.", confidence: "partial" };
  const { commands: commands, incomplete } = reachableSummaryCommands(routine, context.routines);
  const detached = !routine.entries.length && !(context.entryReachableOffsets ?? summaryEntryReachability(context.routines)).has(routine.offset);
  const names = new Set(commands.map((c) => c.name)), has = (...values: string[]) => values.some((v) => names.has(v));
  const roles = unique(context.roles.filter((r) => routine.entries.includes(r.entry)).map((r) => r.when));
  const location = unique(context.maps.map((m) => m.name).filter(Boolean));
  const when = roles.length ? `${limit(roles, 2)}${location.length ? ` in ${limit(location, 2)}` : ""}. `
    : detached ? "Recovered code with no decoded path from a public entry. Its runtime use is not established. "
    : routine.kind === "helper" ? "Local helper used by other routines in this file. "
    : routine.kind === "block" ? "Code block reached by a jump or by continuing from the preceding code. "
    : context.shared.length ? "Shared routine called by other scripts. " : "Entry point with no direct vanilla map trigger found. ";
  const unknown = unique(commands.filter((c) => /^cmd_/.test(c.name)).map((c) => c.name));
  let partial = incomplete || unknown.length > 0 || detached;
  const caveat = incomplete ? " Some execution paths reach undecoded bytes; only the known effects are summarized."
    : unknown.length ? ` Also uses undocumented commands (${limit(unknown, 2)}); their effects are not explained here.` : "";
  if (manual) return { offset: routine.offset, kind: routine.kind, entries: routine.entries, summary: manual + caveat, confidence: partial ? "partial" : "reviewed" };
  if (!incomplete && commands.every((c) => [0, 1, 2, 5, 0x1d].includes(c.opcode))) return { offset: routine.offset, kind: routine.kind, entries: routine.entries, summary: when + (commands.some((c) => c.opcode === 2) ? "Stop the whole script, with no other gameplay effect." : commands.some((c) => c.opcode === 0x1d) ? "Finish the shared script immediately and release its waiting caller." : "Return immediately to the caller without changing game state."), confidence: partial ? "partial" : "inferred" };

  // Recognize literal caller parameters without assuming branch-dependent work values.
  const own = routine.commands;
  const pickup = context.file === 1240 && routine.entries.some((e) => e <= 400) && own.find((c) => c.opcode === 0x28 && c.operands[0] === 0x800c);
  if (pickup) {
    const quantity = own.find((c) => c.opcode === 0x28 && c.operands[0] === 0x800d)?.operands[1];
    return { offset: routine.offset, kind: routine.kind, entries: routine.entries, summary: `Hidden-item pickup: ${context.items.get(pickup.operands[1]) ?? `item ${pickup.operands[1]}`} (${quantity ?? "caller-selected"}). Use the shared pickup handler to check Bag space, award the item, and mark it collected only on success.`, confidence: "reviewed" };
  }
  const effects: string[] = [];
  if (has("call_trainer_battle", "call_trainer_battle_multi")) effects.push("run a trainer battle and its follow-up");
  if (has("call_wild_battle")) effects.push("start a wild Pokémon battle");
  if (has("poke_party_recover_all")) effects.push("heal the party");
  if (has("player_enable_running_shoes")) effects.push("enable the Running Shoes");
  if (has("poke_party_add")) effects.push("add a Pokémon to the party");
  if (has("call_poke3_select")) effects.push("open the starter selection");
  if (has("call_poke_name_input")) effects.push("offer Pokémon nicknaming");
  if (has("call_shop", "call_shop_ex")) effects.push("open a shop");
  if (has("actor_pair_set")) effects.push("start a following companion");
  if (has("actor_pair_end")) effects.push("stop a following companion");
  if (has("item_add")) effects.push("add items to the Bag");
  if (has("item_sub")) effects.push("remove items from the Bag");
  if (has("money_sub")) effects.push("spend money");
  if (has("money_add")) effects.push("give money");
  if (has("trainer_card_badge_set", "trainer_card_set_badge")) effects.push("award a Gym Badge");
  if (has("map_change_core", "map_change_warp", "map_change_warp_pad", "map_change_quicksand")) effects.push("warp the player to another map");
  if (has("medal_give")) effects.push("award medals");
  if (has("call_poke_select")) effects.push("open a party selection menu");
  if (has("call_move_reminder", "call_move_teacher")) effects.push("open a move-learning menu");
  if (has("c_gear_power_on")) effects.push("set up the C-Gear");
  if (has("call3_d_demo")) effects.push("play a cinematic");
  if (has("castelia_rush_init")) effects.push("initialize Castelia's walking crowds");
  if (has("gym0601_fan_ambience_start")) effects.push("start the Gym fan ambience");
  if (has("call_place_name_disp")) effects.push("display the map's location name");
  if (has("join_avenue_store_start")) effects.push("select the Join Avenue shop command table");
  if (has("join_avenue_store_end")) effects.push("restore the Join Avenue common command table");
  const aliasEffects = commands.map(aliasSummaryEffect).filter((effect) => effect && !effect.query)
    .sort((a, b) => Number(Boolean(b!.important)) - Number(Boolean(a!.important)) || Number(Boolean(a!.generic)) - Number(Boolean(b!.generic)));
  effects.unshift(...unique(aliasEffects.filter((effect) => effect!.important).map((effect) => effect!.text)));
  effects.push(...unique(aliasEffects.filter((effect) => !effect!.important).map((effect) => effect!.text)));
  if (has("hm_call_waterfall")) effects.push("start the Waterfall field action");
  if (has("player_play_leaf_pile_stuck")) effects.push("play the player's leaf-pile reaction");
  if (has("entree_forest_spawn_all_pkm")) effects.push("populate the Entree Forest Pokémon");
  if (has("map_replace_set_event")) effects.push("change the map's event variant");
  if (has("funfest_actor_delete")) effects.push("remove a Funfest event actor");
  if (has("trainer_eye_say_message")) effects.push("show the trainer's battle-state dialogue");
  if (has("ev_camera_move_to_default", "ev_camera_end")) effects.push("restore the normal field camera");
  if (has("ev_camera_init", "ev_camera_unbind")) effects.push("prepare the event camera");
  if (has("player_set_special_sequence")) effects.push("select the player's special field sequence");
  if (has("list_menu_show") && !commands.some((c) => c.name.startsWith("msg_"))) effects.push("build and display a selection menu");
  if (has("msg_place_sign")) effects.push("show sign text");

  const globals = unique(commands.filter((c) => c.opcode === 0x1b || c.opcode === 0x1c).map((c) => c.operands[0]));
  for (const id of globals) {
    if ([2801, 2805].includes(id)) {
      const call = own.findIndex((c) => c.opcode === 0x1c && c.operands[0] === id), args = own.slice(Math.max(0, call - 2), call);
      const item = args.find((c) => [0x28, 0x2a].includes(c.opcode) && c.operands[0] === 0x8000 && c.operands[1] < 0x4000)?.operands[1];
      const quantity = args.find((c) => [0x28, 0x2a].includes(c.opcode) && c.operands[0] === 0x8001 && c.operands[1] < 0x4000)?.operands[1];
      effects.push(item !== undefined ? `offer ${context.items.get(item) ?? `item ${item}`}${quantity !== undefined ? ` (${quantity})` : ""} through the shared item handler` : "use the shared item-giving handler");
    } else if (id === 10535) effects.push("start a following companion");
    else if (id === 10536) effects.push("stop a following companion");
  }
  const messages = commands.filter((c) => /^(?:msg_actor_ex|msg_actor|message_actor|msg_actor_gendered|msg_actor_versioned|msg_system|msg_info|msg_place_sign)$/.test(c.name));
  if (messages.length && !has("msg_place_sign")) effects.push(has("yes_no_win", "list_menu_show", "msg_multi") ? "show dialogue and handle a menu choice" : "show dialogue");
  if (has("actor_walk_route", "apply_movement")) effects.push("move or animate the player and map actors");
  else if (has("actor_set_g_pos")) effects.push("set map actors' positions and facing");
  if (has("actor_add", "actor_new", "actor_delete")) effects.push("change which map actors are present");
  if (has("ev_camera_move_to")) effects.push("stage the scene camera");
  const saved = unique(commands.filter((c) => [0x26, 0x27, 0x28, 0x29, 0x2a, 0x0a].includes(c.opcode) && c.operands[0] >= 0x4020 && c.operands[0] < 0x8000).map((c) => bw2WorkAlias(c.operands[0]).name));
  const flags = has("set_flag", "clear_flag", "trainer_flag_set");
  let state = saved.length ? ` Update saved ${limit(saved, 3)}${flags ? " and event flags" : ""}.` : flags ? " Update event flags that record the event's state." : "";
  const reads = unique(commands.filter((c) => [9, 0x19, 0x1a].includes(c.opcode) && c.operands[0] >= 0x4020 && c.operands[0] < 0x8000).map((c) => bw2WorkAlias(c.operands[0]).name));
  if (!state && reads.length) state = ` Choose behavior using saved ${limit(reads, 2)}.`;
  // A small topic anchor identifies simple NPC/sign routines; dialogue is not an action claim.
  let topic = "";
  if (effects.length <= 2 && messages.length) {
    const message = messages.find((c) => (c.name.startsWith("msg_actor") || c.name === "message_actor" ? c.operands[1] : c.operands[0]) < 0x4000);
    if (message) {
      const actor = message.name.startsWith("msg_actor") || message.name === "message_actor";
      const entry = message.operands[actor ? 1 : 0], bank = actor && message.operands[0] !== 0x400 ? [message.operands[0]] : context.banks;
      const values = unique(bank.map((b) => context.texts.get(b)?.get(entry)).filter((t): t is string => Boolean(t)));
      if (values.length === 1) {
        const topics = ["Pokémon Center", "Pokédex", "Poké Ball", "C-Gear", "Bianca", "Hugh", "Team Plasma", "Gym", "badge", "Battle Subway", "Pokémon World Tournament", "Musical", "Day Care", "Hidden Grotto", "Bicycle", "Running Shoes", "Town Map", "Move Reminder", "Move Deleter", "Medal", "Pokéstar Studios", "fishing", "evolution", "Entralink"];
        const found = topics.filter((t) => values[0].toLowerCase().includes(t.toLowerCase()));
        if (found.length) topic = ` The original text mentions ${limit(found, 2)}.`;
      }
    }
  }
  if (!effects.length) {
    const stores = commands.filter((c) => [0x28, 0x29, 0x2a].includes(c.opcode));
    if (commands.some((c) => aliasSummaryEffect(c)?.query)) effects.push(...unique(commands.map(aliasSummaryEffect).filter((effect) => effect?.query).map((effect) => effect!.text)));
    else if (stores.length && stores.length === commands.filter((c) => ![0, 1, 2, 5, 0x1d].includes(c.opcode)).length) effects.push("initialize work variables for the next code path");
    else if (globals.length) effects.push(`delegate to shared script${globals.length > 1 ? "s" : ""} ${limit(globals.map(String), 3)}`);
    else if (has("play_sound", "me_play", "bgm_play")) effects.push("play event audio");
    else if (commands.some((c) => c.targets.some((t) => t.kind === "jump" || t.kind === "call"))) effects.push("select another code path based on runtime conditions");
    else if (has("set_flag", "clear_flag", "trainer_flag_set")) effects.push("set or clear event-state flags");
    else if (has("player_turn_by_trigger")) effects.push("turn the player for this map trigger");
    else if (has("trainer_eye_get_message_types")) effects.push("choose the trainer's greeting and battle messages");
    else if (has("poke_dex_get_evaluation_params")) effects.push("prepare the Pokédex evaluation counts");
    else if (has("day_care_get_pkm_count", "day_care_check_spawn_flag")) effects.push("check the Day Care's Pokémon and event state");
    else if (has("game_get_version")) effects.push("read whether the game is Black 2 or White 2");
    else if (has("poke_party_get_member_by_type", "poke_party_get_count")) effects.push("check the player's party");
    else if (has("fade_in_black", "fade_in_black_q", "fade_ex")) effects.push("fade the field display");
    else if (has("work_add", "work_get", "work_set_const", "work_set")) effects.push("prepare work-variable values for the caller or next code path");
    else if (unknown.length) effects.push("run the undocumented command sequence below; its gameplay purpose is not established");
    else if (commands.every((c) => [0, 1, 2, 5, 0x1d, 0x2e, 0x2f, 0x30, 0x31, 0x32].includes(c.opcode))) effects.push("wait or manage the field's interaction lock");
    else { effects.push("run the field commands below; the specific gameplay purpose is not established"); partial = true; }
  }
  const conditional = commands.some((c) => c.opcode === 0x1f || c.opcode === 0x20);
  const operation = conditional ? `Depending on the branch, ${limit(unique(effects), 4)}.` : `${effects[0][0].toUpperCase()}${limit(unique(effects), 4).slice(1)}.`;
  if (conditional && state.startsWith(" Update")) state = state.replace(" Update", " Some paths update");
  const summary = when + operation + state + topic + caveat;
  return { offset: routine.offset, kind: routine.kind, entries: routine.entries, summary, confidence: partial ? "partial" : "inferred" };
}

export function movementSummary(offset: number, body: { kind: string; name?: string; args?: unknown[] }[], referenced = true): Bw2RoutineSummary {
  const actions = unique(body.filter((s) => s.kind === "action" && s.name !== "finish").map((s) => s.name!));
  const unknown = actions.some((name) => !bw2MovementByName(name));
  const descriptions = actions.slice(0, 4).map((name) => bw2MovementByName(name)?.description.replace(/\.$/, "").toLowerCase() ?? "an undocumented movement record");
  return { offset, kind: "movement", summary: `Actor movement/animation list: ${join(descriptions) || "end immediately"}${actions.length > 4 ? ` (${actions.length - 4} other actions)` : ""}. ${referenced ? "The caller chooses the actor; parameters belong to the individual actions." : "No decoded script command references this list; its runtime use is not established."}`, confidence: unknown || !referenced ? "partial" : "inferred" };
}
