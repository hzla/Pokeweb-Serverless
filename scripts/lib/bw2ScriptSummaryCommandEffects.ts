import { bw2CommandByOpcode } from "../../src/pokeweb/bw2ScriptCompiler/commands";
import { bw2CommandFactByName, bw2CommandFactByOpcode } from "../../src/pokeweb/bw2ScriptCompiler/commandFacts";

type Command = { opcode: number; name: string; dispatchId?: number };
export type AliasSummaryEffect = { text: string; query?: boolean; important?: boolean; generic?: boolean };
export const canonicalSummaryCommandName = (command: Command): string =>
  bw2CommandByOpcode(command.opcode, command.dispatchId)?.name ?? command.name;

// Short effects describe established command roles, not particular story events
// or unconditional success. Query results and branch-dependent actions remain
// distinct so a check is never described as awarding an item or changing a flag.
const EFFECTS: Readonly<Record<string, AliasSummaryEffect>> = {
  survey_set_answer: { text: "record a player-profile survey answer", important: true },
  start_survey: { text: "start a survey interaction" },
  survey_finish: { text: "finish the survey interaction" },
  survey_check_request_complete: { text: "check survey-request completion", query: true },
  survey_rank_up: { text: "advance the survey rank" },
  get_survey_team_rank: { text: "read the survey team's rank", query: true },
  disp_survey_team_info: { text: "display survey-team information" },
  wireless_beacon_set_request: { text: "configure the wireless beacon request" },
  reboot_beacon_search: { text: "restart the wireless beacon search" },
  show_item_cutin: { text: "show an item's field cut-in when available" },
  open_information_board: { text: "open the information board" },
  player_check_special_actor: { text: "check the player's special field-model state", query: true },
  npc_state_set: { text: "record an NPC interaction-state value" },
  black_city_white_forest_get_progress: { text: "read saved Black City/White Forest challenge progress", query: true },
  pwt_get_trainer_flag: { text: "read a Pokémon World Tournament trainer's saved status", query: true },
  battle_subway_work_create: { text: "create the Battle Subway's working state" },
  battle_subway_work_clear: { text: "clear the Battle Subway's working state" },
  battle_subway_work_release: { text: "release the Battle Subway's working state" },
  battle_subway_tool: { text: "perform a Battle Subway operation and return its result when applicable" },
  pwt_system_start: { text: "start the Pokémon World Tournament interaction" },
  pwt_system_end: { text: "finish the Pokémon World Tournament interaction" },
  pwt_trainer_battle: { text: "run a Pokémon World Tournament trainer battle", important: true },
  pwt_get_lobby_trainer_id: { text: "read the trainer ID for a PWT lobby position", query: true },
  pwt_get_lobby_m_mdl_code: { text: "read the PWT lobby actor models", query: true },
  pwt_mix_get_selected_name: { text: "prepare the selected PWT trainer's name for dialogue" },
  pwt_set_enemy_name: { text: "prepare the opposing PWT trainer's name for dialogue" },
  pwt_set_tournament_name: { text: "prepare the tournament name for dialogue" },
  pwt_setup_battle_box: { text: "prepare the PWT Battle Box" },
  pwt_setup_mix_party: { text: "prepare the PWT mix-battle party" },
  pwt_setup_rental_party: { text: "prepare the PWT rental party" },
  pwt_setup_enemy_party: { text: "prepare the opposing PWT party" },
  pwt_select_pokemon: { text: "select Pokémon for the tournament" },
  pwt_btl_util_party_select: { text: "select the tournament battle party" },
  pwt_announce: { text: "show the tournament announcement" },
  pwt_trainer_msg: { text: "show a PWT trainer's dialogue" },
  pwt_show_tornament_list: { text: "show the available tournaments" },
  join_avenue_shop_menu: { text: "open the Join Avenue service menu and return the chosen service and price", important: true },
  join_avenue_talk_start: { text: "start a Join Avenue conversation" },
  join_avenue_talk_end: { text: "finish the Join Avenue conversation" },
  join_avenue_add_exp_shop: { text: "add experience to a Join Avenue shop" },
  join_avenue_add_exp_city: { text: "add experience to Join Avenue" },
  join_avenue_add_people: { text: "add a Join Avenue visitor" },
  join_avenue_delete_people: { text: "remove a Join Avenue visitor" },
  join_avenue_job_change: { text: "change a Join Avenue resident's job" },
  join_avenue_add_kindly: { text: "provide a friendship-increasing Join Avenue service" },
  join_avenue_add_lv: { text: "provide a level-increasing Join Avenue service" },
  join_avenue_add_effort: { text: "provide a training-value Join Avenue service" },
  join_avenue_hatch: { text: "provide Join Avenue's Egg-hatching service" },
  join_avenue_call_input_name: { text: "open Join Avenue name entry" },
  call_medal_info: { text: "show medal information" },
  update_medal_info: { text: "update medal information" },
  get_last_achieve_medal_id: { text: "read the most recently achieved medal", query: true },
  random_match_add_bp: { text: "award Battle Points for Random Matchup" },
  black_tower_white_tree_battle_trainer: { text: "run a Black Tower/White Treehollow trainer battle" },
  black_tower_white_tree_warp: { text: "warp within Black Tower/White Treehollow" },
  black_tower_white_tree_floor_move: { text: "move between Black Tower/White Treehollow floors" },
  black_tower_white_tree_open_elevator: { text: "open the Black Tower/White Treehollow elevator" },
  black_tower_white_tree_open_gate: { text: "open a Black Tower/White Treehollow gate" },
  pokestar_rec: { text: "start a Pokéstar Studios movie recording", important: true },
  pokestar_show: { text: "show a Pokéstar Studios movie", important: true },
  pokestar_save_movie: { text: "save a Pokéstar Studios movie" },
  pokestar_select_movie: { text: "open the Pokéstar movie selection" },
  pokestar_select_scenario: { text: "select a Pokéstar movie scenario" },
  pokestar_select_pokemon: { text: "select a Pokémon for the movie" },
  pokestar_show_tutorial: { text: "show the Pokéstar Studios tutorial" },
  pl_boat_start: { text: "start the Royal Unova boat interaction" },
  pl_boat_get_room_info: { text: "read Royal Unova room information", query: true },
  palpark_transfer: { text: "start the Poké Transfer interaction" },
  musical_call: { text: "start a Pokémon Musical interaction" },
  musical_fitting_call: { text: "open the Pokémon Musical dress-up interaction" },
  add_musical_goods: { text: "add Pokémon Musical accessories" },
  call_game_manual: { text: "open the game-help screen" },
  set_evt_lock: { text: "set the event-lock state" },
  get_evt_lock: { text: "read the event-lock state", query: true },
  set_soft_reset: { text: "configure soft-reset behavior" },
  h06_gmk_init: { text: "initialize the map's scenery setup" },
  sea_temple_start: { text: "start the Abyssal Ruins map handler" },
};

const DOMAINS: readonly [RegExp, string][] = [
  [/^black_tower_white_tree_/, "Black Tower/White Treehollow"],
  [/^(?:pwt_|pwte_|pwtgmk_)/, "Pokémon World Tournament"],
  [/^join_avenue_/, "Join Avenue"],
  [/^pokestar_/, "Pokéstar Studios"],
  [/^memory_link_/, "Memory Link"],
  [/^random_match_/, "Random Matchup"],
  [/^(?:musical_|get_musical_)/, "Pokémon Musical"],
  [/^(?:survey_|get_survey_|start_survey|disp_survey_)/, "survey"],
  [/^hide_hole_/, "Hidden Grotto"],
  [/^(?:wifi_|th_)/, "wireless communication"],
  [/^pl_boat_/, "Royal Unova"],
];

/** Legacy numeric spellings resolve by opcode/table before semantic lookup. */
export function aliasSummaryEffect(command: Command): AliasSummaryEffect | undefined {
  const name = canonicalSummaryCommandName(command);
  if (EFFECTS[name]) return EFFECTS[name];
  const fact = bw2CommandFactByOpcode(command.opcode, command.dispatchId) ?? bw2CommandFactByName(command.name);
  if (!fact) return;
  if (EFFECTS[fact.name]) return EFFECTS[fact.name];
  const query = /(?:^|_)(?:get|check|is)(?:_|$)/.test(fact.name);
  const domain = DOMAINS.find(([pattern]) => pattern.test(fact.name))?.[1];
  if (domain) return { text: query ? `check ${domain} settings and event data` : `manage the ${domain} interaction and its event state`, query, generic: true };
  if (/^gym_/.test(fact.name)) return { text: "control the Gym puzzle and scenery" };
  if (/^(?:four_kings_|champion_)/.test(fact.name)) return { text: "stage the Elite Four or Champion room scenery" };
  if (/^(?:gianthole_|leg_|start_leg_|c12_|ending_)/.test(fact.name)) return { text: "stage map-specific scene effects" };
  if (/^(?:regi_|kerudhio_|mero_)/.test(fact.name)) return { text: `${query ? "check" : "manage"} legendary-Pokémon event effects`, query };
  // A detailed description is useful; repeating an English spelling of the C
  // name is not a purpose explanation. Uncovered roles remain explicitly partial.
  if (fact.description.toLowerCase().replace(/[. ]+$/, "") !== fact.name.replace(/_/g, " ")) return { text: fact.description[0].toLowerCase() + fact.description.slice(1).replace(/\.$/, ""), query };
}
