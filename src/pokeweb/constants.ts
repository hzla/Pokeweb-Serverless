export type BaseVersion = "B" | "W" | "B2" | "W2";
export type BaseRom = "BW" | "BW2";

export type NarcName =
  | "headers"
  | "message_texts"
  | "story_texts"
  | "scripts"
  | "personal"
  | "move_spas"
  | "maps"
  | "matrix"
  | "overworlds"
  | "learnsets"
  | "evolutions"
  | "egg_moves"
  | "moves"
  | "move_animations"
  | "battle_animations"
  | "items"
  | "trtext_table"
  | "trtext_offsets"
  | "trdata"
  | "trpok"
  | "encounters"
  | "habitats"
  | "marts"
  | "mart_counts"
  | "grottos"
  | "grotto_odds"
  | "move_effects_table"
  | "type_chart"
  | "starter_sprites"
  | "pokemon_sprites"
  | "pokemon_icons"
  | "subway_sets"
  | "subway_trainers"
  | "pwt_sets_0"
  | "pwt_sets_3"
  | "pwt_sets_6"
  | "pwt_sets_7"
  | "pwt_map_1"
  | "pwt_map_2"
  | "pwt_tr1"
  | "pwt_tr6";

export type NarcDefinition = {
  path: string;
  name: NarcName;
  required?: boolean;
};

export const VERSION_BY_ARM9_SAMPLE: Record<number, { baseVersion: BaseVersion; baseRom: BaseRom }> = {
  15395: { baseVersion: "B2", baseRom: "BW2" },
  63038: { baseVersion: "W2", baseRom: "BW2" },
  43676: { baseVersion: "B", baseRom: "BW" },
  4581: { baseVersion: "W", baseRom: "BW" },
};

export const HEADER_NARCS: NarcDefinition[] = [
  { path: "a/0/1/2", name: "headers", required: true },
  { path: "a/0/0/2", name: "message_texts", required: true },
  { path: "a/0/0/3", name: "story_texts", required: true },
  { path: "a/0/5/6", name: "scripts" },
];

export const BW_NARCS: NarcDefinition[] = [
  { path: "a/0/0/4", name: "pokemon_sprites" },
  { path: "a/0/0/7", name: "pokemon_icons" },
  { path: "a/0/1/6", name: "personal" },
  { path: "a/0/0/6", name: "move_spas" },
  { path: "a/0/0/8", name: "maps" },
  { path: "a/0/0/9", name: "matrix" },
  { path: "a/1/2/5", name: "overworlds" },
  { path: "a/0/1/8", name: "learnsets" },
  { path: "a/0/1/9", name: "evolutions" },
  { path: "a/1/2/3", name: "egg_moves" },
  { path: "a/0/2/1", name: "moves" },
  { path: "a/0/6/6", name: "move_animations" },
  { path: "a/0/6/7", name: "battle_animations" },
  { path: "a/0/2/4", name: "items" },
  { path: "a/0/9/0", name: "trtext_table" },
  { path: "a/0/9/1", name: "trtext_offsets" },
  { path: "a/0/9/2", name: "trdata" },
  { path: "a/0/9/3", name: "trpok" },
  { path: "a/1/2/6", name: "encounters" },
  { path: "a/2/0/5", name: "starter_sprites" },
];

export const BW2_NARCS: NarcDefinition[] = [
  { path: "a/0/0/4", name: "pokemon_sprites" },
  { path: "a/0/0/7", name: "pokemon_icons" },
  { path: "a/0/1/6", name: "personal" },
  { path: "a/0/0/6", name: "move_spas" },
  { path: "a/0/0/8", name: "maps" },
  { path: "a/0/0/9", name: "matrix" },
  { path: "a/1/2/6", name: "overworlds" },
  { path: "a/0/1/8", name: "learnsets" },
  { path: "a/0/1/9", name: "evolutions" },
  { path: "a/1/2/4", name: "egg_moves" },
  { path: "a/0/2/1", name: "moves" },
  { path: "a/0/2/4", name: "items" },
  { path: "a/0/8/9", name: "trtext_table" },
  { path: "a/0/9/0", name: "trtext_offsets" },
  { path: "a/0/9/1", name: "trdata" },
  { path: "a/0/9/2", name: "trpok" },
  { path: "a/1/2/7", name: "encounters" },
  { path: "a/2/9/6", name: "habitats" },
  { path: "a/2/8/2", name: "marts" },
  { path: "a/2/8/3", name: "mart_counts" },
  { path: "a/2/7/3", name: "grottos" },
  { path: "a/0/6/5", name: "move_animations" },
  { path: "a/0/6/6", name: "battle_animations" },
  { path: "a/2/0/2", name: "starter_sprites" },
  { path: "a/2/1/1", name: "subway_sets" },
  { path: "a/2/1/2", name: "subway_trainers" },
  { path: "a/2/5/0", name: "pwt_sets_0" },
  { path: "a/2/5/1", name: "pwt_map_1" },
  { path: "a/2/5/2", name: "pwt_map_2" },
  { path: "a/2/5/3", name: "pwt_sets_3" },
  { path: "a/2/5/4", name: "pwt_tr1" },
  { path: "a/2/5/5", name: "pwt_tr6" },
  { path: "a/2/5/6", name: "pwt_sets_6" },
  { path: "a/2/5/7", name: "pwt_sets_7" },
];

export const MANDATORY_NARCS = HEADER_NARCS.filter((definition) => definition.required).map((definition) => definition.name);

export const SELECTABLE_NARCS = Array.from(
  new Map([...HEADER_NARCS, ...BW_NARCS, ...BW2_NARCS].map((definition) => [definition.name, definition])).values(),
);

export const BW_MESSAGE_BANKS = [
  [286, "moves"],
  [285, "abilities"],
  [284, "pokedex"],
  [191, "tr_classes"],
  [190, "tr_names"],
  [89, "locations"],
  [54, "items"],
] as const;

export const BW2_MESSAGE_BANKS = [
  [403, "moves"],
  [487, "abilities"],
  [90, "pokedex"],
  [383, "tr_classes"],
  [382, "tr_names"],
  [109, "locations"],
  [64, "items"],
] as const;

export const TYPES = [
  "Normal",
  "Fighting",
  "Flying",
  "Poison",
  "Ground",
  "Rock",
  "Bug",
  "Ghost",
  "Steel",
  "Fire",
  "Water",
  "Grass",
  "Electric",
  "Psychic",
  "Ice",
  "Dragon",
  "Dark",
  "Fairy",
];

export const CATEGORIES = ["Status", "Physical", "Special"];
export const EFFECT_CATEGORIES = [
  "No Special Effect",
  "Status Inflicting",
  "Target Stat Changing",
  "Healing",
  "Chance to Inflict Status",
  "Raising Target's Stat along Attack",
  "Lowering Target's Stat along Attack",
  "Raise user stats",
  "Lifesteal",
  "OHKO",
  "Weather",
  "Safeguard",
  "Force Switch Out",
  "Unique Effect",
];
export const STATUSES = ["None", "Visible", "Temporary", "Infatuation", "Trapped"];
export const TARGETS = [
  "Any adjacent",
  "Random (User/ Adjacent ally)",
  "Random adjacent ally",
  "Any adjacent opponent",
  "All excluding user",
  "All adjacent opponents",
  "User's party",
  "User",
  "Entire Field",
  "Random adjacent opponent",
  "Field Itself",
  "Opponent's side of field",
  "User's side of field",
  "User (Selects target automatically)",
];
export const STATS = ["None", "Attack", "Defense", "Special Attack", "Special Defense", "Speed", "Accuracy", "Evasion", "All"];
export const GROWTHS = ["Medium Fast", "Erratic", "Fluctuating", "Medium Slow", "Fast", "Slow", "Medium Fast", "Medium Fast"];
export const EGG_GROUPS = ["~", "Monster", "Water 1", "Bug", "Flying", "Field", "Fairy", "Grass", "Human-Like", "Water 3", "Mineral", "Amorphous", "Water 2", "Ditto", "Dragon", "Undiscovered"];
export const BATTLE_TYPES = ["Singles", "Doubles", "Triples", "Rotation"];
export const TRAINER_GENDERS = ["Default", "Female", "Male"];
export const TRAINER_TEMPLATE_FLAGS = ["has_moves", "has_items"];
export const ENCOUNTER_SEASONS = ["spring", "summer", "fall", "winter"] as const;
export const ENCOUNTER_GRASS_FIELDS = ["grass", "grass_doubles", "grass_special"] as const;
export const ENCOUNTER_WATER_FIELDS = ["surf", "surf_special", "super_rod", "super_rod_special"] as const;
export const ENCOUNTER_GRASS_PERCENTAGES = [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1] as const;
export const ENCOUNTER_WATER_PERCENTAGES = [60, 30, 5, 4, 1] as const;
export const TRAINER_AIS = [
  "Prioritize Effectiveness",
  "Evaluate Attacks",
  "Expert",
  "Prioritize Status",
  "Risky Attacks",
  "Prioritize Damage",
  "Partner",
  "Double Battle",
  "Prioritize Healing",
  "Utilize Weather",
  "Harassment",
  "Roaming Pokemon",
  "Safari Zone",
  "Catching Demo",
];
export const NATURES = [
  "Hardy",
  "Lonely",
  "Brave",
  "Adamant",
  "Naughty",
  "Bold",
  "Docile",
  "Relaxed",
  "Impish",
  "Lax",
  "Timid",
  "Hasty",
  "Serious",
  "Jolly",
  "Naive",
  "Modest",
  "Mild",
  "Quiet",
  "Bashful",
  "Rash",
  "Calm",
  "Gentle",
  "Sassy",
  "Careful",
  "Quirky",
];
export const EVO_METHODS = [
  "None",
  "Max Happiness",
  "Level During Day",
  "Level During Night",
  "Level Requirement",
  "Trading",
  "Trade with Held Item",
  "Karrablast/Shelmet Trade",
  "Item Use",
  "Level Requirement + Atk Stat Greater Than Def",
  "Level Requirement + Atk Stat Equal To Def",
  "Level Requirement + Atk Stat Less Than Def",
  "Level Requirement + PID Greater Than 5",
  "Level Requirement + PID Less Than 5",
  "Level Requirement (Ninjask)",
  "Level Requirement + Empty Party Slot/Pokeball",
  "Max Beauty",
  "Item Use + Male",
  "Item Use + Female",
  "Level with Item + Day",
  "Level with Item + Night",
  "After Learning Specific Move",
  "Level With Party Member",
  "Level Requirement + Male",
  "Level Requirement + Female",
  "Level Up in Mt. Coronet",
  "Level Up in Eterna Forest",
  "Level Up in Route 217",
  "Level Up near Moss Rock",
];

export const PROPERTIES = [
  "contact",
  "requires_charge",
  "recharge_turn",
  "blocked_by_protect",
  "reflected_by_magic_coat",
  "stolen_by_snatch",
  "copied_by_mirror_move",
  "punch_move",
  "sound_move",
  "grounded_by_gravity",
  "defrosts_targets",
  "hits_non-adjacent_opponents",
  "healing_move",
  "hits_through_substitute",
];
