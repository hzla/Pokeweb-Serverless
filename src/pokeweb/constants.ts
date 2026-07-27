export type Generation = "gen4" | "gen5";
export type Gen4Version = "D" | "P" | "Pt" | "HG" | "SS";
export type Gen5Version = "B" | "W" | "B2" | "W2";
export type BaseVersion = Gen4Version | Gen5Version;
export type Gen4BaseRom = "DP" | "Pt" | "HGSS";
export type Gen5BaseRom = "BW" | "BW2";
export type BaseRom = Gen4BaseRom | Gen5BaseRom;
export type VersionInfo = { generation: Generation; baseVersion: BaseVersion; baseRom: BaseRom };

export type NarcName =
  | "headers"
  | "message_texts"
  | "story_texts"
  | "scripts"
  | "personal"
  | "move_spas"
  | "maps"
  | "area_data"
  | "map_textures"
  | "building_textures"
  | "exterior_building_models"
  | "interior_building_models"
  | "matrix"
  | "overworlds"
  | "ow_sprites"
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
  | "trainer_sprites"
  | "encounters"
  | "habitats"
  | "marts"
  | "mart_counts"
  | "grottos"
  | "grotto_odds"
  | "move_effects_table"
  | "tutor_moves"
  | "type_chart"
  | "starter_sprites"
  | "ingame_trades"
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
  | "pwt_tr6"
  | "regulations"
  | "wbt_sets"
  | "wbt_trainers"
  | "wbt_area_pools";

export type NarcDefinition = {
  path: string;
  name: NarcName;
  container?: "narc" | "file";
  required?: boolean;
};

export const VERSION_BY_ARM9_SAMPLE: Record<number, VersionInfo> = {
  15395: { generation: "gen5", baseVersion: "B2", baseRom: "BW2" },
  63038: { generation: "gen5", baseVersion: "W2", baseRom: "BW2" },
  43676: { generation: "gen5", baseVersion: "B", baseRom: "BW" },
  4581: { generation: "gen5", baseVersion: "W", baseRom: "BW" },
};

export const VERSION_BY_ID_CODE_PREFIX: Record<string, VersionInfo> = {
  ADA: { generation: "gen4", baseVersion: "D", baseRom: "DP" },
  APA: { generation: "gen4", baseVersion: "P", baseRom: "DP" },
  CPU: { generation: "gen4", baseVersion: "Pt", baseRom: "Pt" },
  IPK: { generation: "gen4", baseVersion: "HG", baseRom: "HGSS" },
  IPG: { generation: "gen4", baseVersion: "SS", baseRom: "HGSS" },
  IRA: { generation: "gen5", baseVersion: "W", baseRom: "BW" },
  IRB: { generation: "gen5", baseVersion: "B", baseRom: "BW" },
  IRD: { generation: "gen5", baseVersion: "W2", baseRom: "BW2" },
  IRE: { generation: "gen5", baseVersion: "B2", baseRom: "BW2" },
};

export const VERSION_BY_ID_CODE_EXACT: Record<string, VersionInfo> = {
  JAK7: { generation: "gen4", baseVersion: "Pt", baseRom: "Pt" },
};

export const DEFAULT_VERSION_INFO: VersionInfo = { generation: "gen5", baseVersion: "W2", baseRom: "BW2" };

export function detectVersionInfo(arm9Sample: number, idCode: string): VersionInfo {
  const normalizedIdCode = idCode.toUpperCase();
  return VERSION_BY_ARM9_SAMPLE[arm9Sample] ?? VERSION_BY_ID_CODE_EXACT[normalizedIdCode] ?? VERSION_BY_ID_CODE_PREFIX[normalizedIdCode.slice(0, 3)] ?? DEFAULT_VERSION_INFO;
}

export function isGen4BaseRom(baseRom: BaseRom): baseRom is Gen4BaseRom {
  return baseRom === "DP" || baseRom === "Pt" || baseRom === "HGSS";
}

export function isGen5BaseRom(baseRom: BaseRom): baseRom is Gen5BaseRom {
  return baseRom === "BW" || baseRom === "BW2";
}

export function generationForBaseRom(baseRom: BaseRom): Generation {
  return isGen4BaseRom(baseRom) ? "gen4" : "gen5";
}

export function projectGeneration(session: { generation?: Generation; baseRom: BaseRom }): Generation {
  return session.generation ?? generationForBaseRom(session.baseRom);
}

export function isGen4Project(project: { session: { generation?: Generation; baseRom: BaseRom } }): boolean {
  return projectGeneration(project.session) === "gen4";
}

export function isGen5Project(project: { session: { generation?: Generation; baseRom: BaseRom } }): boolean {
  return projectGeneration(project.session) === "gen5";
}

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
  { path: "a/0/7/2", name: "trainer_sprites" },
  { path: "a/1/2/6", name: "encounters" },
  { path: "a/1/6/5", name: "ingame_trades" },
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
  { path: "a/0/7/1", name: "trainer_sprites" },
  { path: "a/1/2/7", name: "encounters" },
  { path: "a/1/6/3", name: "ingame_trades" },
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
  { path: "a/1/0/6", name: "regulations" },
  { path: "a/2/6/1", name: "wbt_sets" },
  { path: "a/2/6/2", name: "wbt_trainers" },
  { path: "a/2/6/9", name: "wbt_area_pools" },
];

export const GEN4_NARCS_BY_VERSION: Record<Gen4Version, NarcDefinition[]> = {
  D: [
    { path: "msgdata/msg.narc", name: "message_texts", required: true },
    { path: "poketool/personal/personal.narc", name: "personal" },
    { path: "poketool/personal/wotbl.narc", name: "learnsets" },
    { path: "poketool/personal/evo.narc", name: "evolutions" },
    { path: "poketool/waza/waza_tbl.narc", name: "moves" },
    { path: "itemtool/itemdata/item_data.narc", name: "items" },
    { path: "poketool/trainer/trdata.narc", name: "trdata" },
    { path: "poketool/trainer/trpoke.narc", name: "trpok" },
    { path: "poketool/trmsg/trtbl.narc", name: "trtext_table" },
    { path: "poketool/trmsg/trtblofs.narc", name: "trtext_offsets" },
    { path: "fielddata/encountdata/d_enc_data.narc", name: "encounters" },
    { path: "fielddata/script/scr_seq_release.narc", name: "scripts" },
    { path: "fielddata/eventdata/zone_event_release.narc", name: "overworlds" },
    { path: "data/mmodel/mmodel.narc", name: "ow_sprites" },
    { path: "fielddata/land_data/land_data_release.narc", name: "maps" },
    { path: "fielddata/areadata/area_data.narc", name: "area_data" },
    { path: "fielddata/areadata/area_map_tex/map_tex_set.narc", name: "map_textures" },
    { path: "fielddata/areadata/area_build_model/areabm_texset.narc", name: "building_textures" },
    { path: "fielddata/build_model/build_model.narc", name: "exterior_building_models" },
    { path: "fielddata/mapmatrix/map_matrix.narc", name: "matrix" },
    { path: "fielddata/maptable/mapname.bin", name: "headers", container: "file" },
  ],
  P: [
    { path: "msgdata/msg.narc", name: "message_texts", required: true },
    { path: "poketool/personal/personal_pearl.narc", name: "personal" },
    { path: "poketool/personal/wotbl.narc", name: "learnsets" },
    { path: "poketool/personal/evo.narc", name: "evolutions" },
    { path: "poketool/waza/waza_tbl.narc", name: "moves" },
    { path: "itemtool/itemdata/item_data.narc", name: "items" },
    { path: "poketool/trainer/trdata.narc", name: "trdata" },
    { path: "poketool/trainer/trpoke.narc", name: "trpok" },
    { path: "poketool/trmsg/trtbl.narc", name: "trtext_table" },
    { path: "poketool/trmsg/trtblofs.narc", name: "trtext_offsets" },
    { path: "fielddata/encountdata/p_enc_data.narc", name: "encounters" },
    { path: "fielddata/script/scr_seq_release.narc", name: "scripts" },
    { path: "fielddata/eventdata/zone_event_release.narc", name: "overworlds" },
    { path: "data/mmodel/mmodel.narc", name: "ow_sprites" },
    { path: "fielddata/land_data/land_data_release.narc", name: "maps" },
    { path: "fielddata/areadata/area_data.narc", name: "area_data" },
    { path: "fielddata/areadata/area_map_tex/map_tex_set.narc", name: "map_textures" },
    { path: "fielddata/areadata/area_build_model/areabm_texset.narc", name: "building_textures" },
    { path: "fielddata/build_model/build_model.narc", name: "exterior_building_models" },
    { path: "fielddata/mapmatrix/map_matrix.narc", name: "matrix" },
    { path: "fielddata/maptable/mapname.bin", name: "headers", container: "file" },
  ],
  Pt: [
    { path: "msgdata/pl_msg.narc", name: "message_texts", required: true },
    { path: "poketool/personal/pl_personal.narc", name: "personal" },
    { path: "poketool/personal/wotbl.narc", name: "learnsets" },
    { path: "poketool/personal/evo.narc", name: "evolutions" },
    { path: "poketool/waza/pl_waza_tbl.narc", name: "moves" },
    { path: "itemtool/itemdata/pl_item_data.narc", name: "items" },
    { path: "poketool/trainer/trdata.narc", name: "trdata" },
    { path: "poketool/trainer/trpoke.narc", name: "trpok" },
    { path: "poketool/trmsg/trtbl.narc", name: "trtext_table" },
    { path: "poketool/trmsg/trtblofs.narc", name: "trtext_offsets" },
    { path: "fielddata/encountdata/pl_enc_data.narc", name: "encounters" },
    { path: "fielddata/script/scr_seq.narc", name: "scripts" },
    { path: "fielddata/eventdata/zone_event.narc", name: "overworlds" },
    { path: "data/mmodel/mmodel.narc", name: "ow_sprites" },
    { path: "fielddata/land_data/land_data.narc", name: "maps" },
    { path: "fielddata/areadata/area_data.narc", name: "area_data" },
    { path: "fielddata/areadata/area_map_tex/map_tex_set.narc", name: "map_textures" },
    { path: "fielddata/areadata/area_build_model/areabm_texset.narc", name: "building_textures" },
    { path: "fielddata/build_model/build_model.narc", name: "exterior_building_models" },
    { path: "fielddata/mapmatrix/map_matrix.narc", name: "matrix" },
    { path: "fielddata/maptable/mapname.bin", name: "headers", container: "file" },
  ],
  HG: [
    { path: "a/0/2/7", name: "message_texts", required: true },
    { path: "a/0/0/2", name: "personal" },
    { path: "a/0/3/3", name: "learnsets" },
    { path: "a/0/3/4", name: "evolutions" },
    { path: "a/0/1/1", name: "moves" },
    { path: "a/0/1/7", name: "items" },
    { path: "a/0/5/5", name: "trdata" },
    { path: "a/0/5/6", name: "trpok" },
    { path: "a/0/5/7", name: "trtext_table" },
    { path: "a/1/3/1", name: "trtext_offsets" },
    { path: "a/0/3/7", name: "encounters" },
    { path: "a/0/1/2", name: "scripts" },
    { path: "a/0/3/2", name: "overworlds" },
    { path: "a/0/8/1", name: "ow_sprites" },
    { path: "a/0/6/5", name: "maps" },
    { path: "a/0/4/2", name: "area_data" },
    { path: "a/0/4/4", name: "map_textures" },
    { path: "a/0/7/0", name: "building_textures" },
    { path: "a/0/4/0", name: "exterior_building_models" },
    { path: "a/1/4/8", name: "interior_building_models" },
    { path: "a/0/4/1", name: "matrix" },
    { path: "fielddata/maptable/mapname.bin", name: "headers", container: "file" },
    { path: "a/2/2/9", name: "egg_moves" },
  ],
  SS: [
    { path: "a/0/2/7", name: "message_texts", required: true },
    { path: "a/0/0/2", name: "personal" },
    { path: "a/0/3/3", name: "learnsets" },
    { path: "a/0/3/4", name: "evolutions" },
    { path: "a/0/1/1", name: "moves" },
    { path: "a/0/1/7", name: "items" },
    { path: "a/0/5/5", name: "trdata" },
    { path: "a/0/5/6", name: "trpok" },
    { path: "a/0/5/7", name: "trtext_table" },
    { path: "a/1/3/1", name: "trtext_offsets" },
    { path: "a/1/3/6", name: "encounters" },
    { path: "a/0/1/2", name: "scripts" },
    { path: "a/0/3/2", name: "overworlds" },
    { path: "a/0/8/1", name: "ow_sprites" },
    { path: "a/0/6/5", name: "maps" },
    { path: "a/0/4/2", name: "area_data" },
    { path: "a/0/4/4", name: "map_textures" },
    { path: "a/0/7/0", name: "building_textures" },
    { path: "a/0/4/0", name: "exterior_building_models" },
    { path: "a/1/4/8", name: "interior_building_models" },
    { path: "a/0/4/1", name: "matrix" },
    { path: "fielddata/maptable/mapname.bin", name: "headers", container: "file" },
    { path: "a/2/2/9", name: "egg_moves" },
  ],
};

export function gen4NarcDefinitions(version: VersionInfo): NarcDefinition[] {
  if (!isGen4BaseRom(version.baseRom)) return [];
  return GEN4_NARCS_BY_VERSION[version.baseVersion as Gen4Version] ?? [];
}

const ALL_NARC_DEFINITIONS = [...HEADER_NARCS, ...BW_NARCS, ...BW2_NARCS, ...Object.values(GEN4_NARCS_BY_VERSION).flat()];

export const MANDATORY_NARCS = Array.from(new Set(ALL_NARC_DEFINITIONS.filter((definition) => definition.required).map((definition) => definition.name)));

export const SELECTABLE_NARCS = Array.from(
  new Map(ALL_NARC_DEFINITIONS.map((definition) => [definition.name, definition])).values(),
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

export type TextBankSource = number | readonly number[];

export const GEN4_MESSAGE_BANKS: Record<Gen4Version, ReadonlyArray<readonly [TextBankSource, string]>> = {
  D: [
    [588, "moves"],
    [552, "abilities"],
    [[362, 363], "pokedex"],
    [560, "tr_classes"],
    [559, "tr_names"],
    [382, "locations"],
    [344, "items"],
    [565, "types"],
  ],
  P: [
    [588, "moves"],
    [552, "abilities"],
    [[362, 363], "pokedex"],
    [560, "tr_classes"],
    [559, "tr_names"],
    [382, "locations"],
    [344, "items"],
    [565, "types"],
  ],
  Pt: [
    [647, "moves"],
    [610, "abilities"],
    [[412, 413, 712, 713, 714, 715, 716], "pokedex"],
    [619, "tr_classes"],
    [618, "tr_names"],
    [433, "locations"],
    [392, "items"],
    [624, "types"],
  ],
  HG: [
    [750, "moves"],
    [720, "abilities"],
    [[237, 238, 817, 818, 819, 820, 821], "pokedex"],
    [730, "tr_classes"],
    [729, "tr_names"],
    [279, "locations"],
    [222, "items"],
    [735, "types"],
  ],
  SS: [
    [750, "moves"],
    [720, "abilities"],
    [[237, 238, 817, 818, 819, 820, 821], "pokedex"],
    [730, "tr_classes"],
    [729, "tr_names"],
    [279, "locations"],
    [222, "items"],
    [735, "types"],
  ],
};

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

export const GEN4_TYPES = [
  "Normal",
  "Fighting",
  "Flying",
  "Poison",
  "Ground",
  "Rock",
  "Bug",
  "Ghost",
  "Steel",
  "???",
  "Fire",
  "Water",
  "Grass",
  "Electric",
  "Psychic",
  "Ice",
  "Dragon",
  "Dark",
];

export const CATEGORIES = ["Status", "Physical", "Special"];
export const GEN4_CATEGORIES = ["Physical", "Special", "Status"];

export function typeNamesForProject(project: { session: { generation?: Generation; baseRom: BaseRom }; texts?: { banks?: Partial<Record<string, string[]>> } }): string[] {
  const textTypes = project.texts?.banks?.types?.filter((type) => type.trim().length > 0);
  if (textTypes && textTypes.length > 0) return textTypes;
  return isGen4Project(project) ? GEN4_TYPES : TYPES;
}

export function moveCategoryNamesForProject(project: { session: { generation?: Generation; baseRom: BaseRom } }): string[] {
  return isGen4Project(project) ? GEN4_CATEGORIES : CATEGORIES;
}

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
export const TRAINER_GENDERS = ["Default", "Male", "Female"];
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
