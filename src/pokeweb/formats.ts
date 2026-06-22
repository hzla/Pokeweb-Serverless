import { isGen4BaseRom, type BaseRom, type NarcName } from "./constants";

export type FieldSpec = [number, string];
export type NarcFormatMap = Partial<Record<NarcName, FieldSpec[]>>;

function range(count: number, make: (index: number) => FieldSpec[]): FieldSpec[] {
  return Array.from({ length: count }, (_, index) => make(index)).flat();
}

export function getNarcFormats(baseRom: BaseRom): NarcFormatMap {
  if (isGen4BaseRom(baseRom)) return getGen4NarcFormats(baseRom);

  const formats: NarcFormatMap = {};

  formats.headers =
    baseRom === "BW2"
      ? [
          [1, "map_type"],
          [1, "unknown_1"],
          [2, "texture_id"],
          [2, "matrix_id"],
          [2, "script_id"],
          [2, "level_script_id"],
          [2, "text_bank_id"],
          [2, "music_spring_id"],
          [2, "music_summer_id"],
          [2, "music_fall_id"],
          [2, "music_winter_id"],
          [1, "encounter_id"],
          [1, "unknown_4"],
          [2, "map_id"],
          [2, "parent_map_id"],
          [1, "location_name_id"],
          [1, "name_style_id"],
          [1, "weather_id"],
          [1, "camera_id"],
          [1, "unknown_2"],
          [1, "flags"],
          [2, "unknown_3"],
          [2, "name_icon"],
          [4, "fly_x"],
          [4, "fly_y"],
          [4, "fly_z"],
        ]
      : [
          [1, "map_type"],
          [1, "unknown_1"],
          [2, "texture_id"],
          [2, "matrix_id"],
          [2, "script_id"],
          [2, "level_script_id"],
          [2, "text_bank_id"],
          [2, "music_spring_id"],
          [2, "music_summer_id"],
          [2, "music_fall_id"],
          [2, "music_winter_id"],
          [2, "encounter_id"],
          [2, "map_id"],
          [2, "parent_map_id"],
          [1, "location_name_id"],
          [1, "name_style_id"],
          [1, "weather_id"],
          [1, "camera_id"],
          [1, "unknown_2"],
          [1, "flags"],
          [2, "unknown_3"],
          [2, "name_icon"],
          [4, "fly_x"],
          [4, "fly_y"],
          [4, "fly_z"],
        ];

  formats.personal = [
    [1, "base_hp"],
    [1, "base_atk"],
    [1, "base_def"],
    [1, "base_speed"],
    [1, "base_spatk"],
    [1, "base_spdef"],
    [1, "type_1"],
    [1, "type_2"],
    [1, "catchrate"],
    [1, "stage"],
    [2, "evs"],
    [2, "item_1"],
    [2, "item_2"],
    [2, "item_3"],
    [1, "gender"],
    [1, "hatch_cycle"],
    [1, "base_happy"],
    [1, "exp_rate"],
    [1, "egg_group_1"],
    [1, "egg_group_2"],
    [1, "ability_1"],
    [1, "ability_2"],
    [1, "ability_3"],
    [1, "flee"],
    [2, "form_id"],
    [2, "form"],
    [1, "num_forms"],
    [1, "color"],
    [2, "base_exp"],
    [2, "height"],
    [2, "weight"],
    [4, "tm_1-32"],
    [4, "tm_33-64"],
    [4, "tm_65-95+hm_1"],
    [4, "hm_2-6"],
    [1, "tutors"],
    ...(baseRom === "BW2"
      ? ([
          [3, "padding"],
          [4, "driftveil_tutor"],
          [4, "lentimas_tutor"],
          [4, "humilau_tutor"],
          [4, "nacrene_tutor"],
        ] as FieldSpec[])
      : []),
  ];

  formats.learnsets = range(25, (n) => [
    [2, `move_id_${n}`],
    [2, `lvl_learned_${n}`],
  ]);

  formats.move_effects_table = range(258, (n) => [
    [4, `move_id_${n}`],
    [4, `address_${n}`],
  ]);

  formats.evolutions = range(7, (n) => [
    [2, `method_${n}`],
    [2, `param_${n}`],
    [2, `target_${n}`],
  ]);

  formats.moves = [
    [1, "type"],
    [1, "effect_category"],
    [1, "category"],
    [1, "power"],
    [1, "accuracy"],
    [1, "pp"],
    [1, "priority"],
    [1, "hits"],
    [2, "result_effect"],
    [1, "effect_chance"],
    [1, "status"],
    [1, "min_turns"],
    [1, "max_turns"],
    [1, "crit"],
    [1, "flinch"],
    [2, "effect"],
    [1, "recoil"],
    [1, "healing"],
    [1, "target"],
    [1, "stat_1"],
    [1, "stat_2"],
    [1, "stat_3"],
    [1, "magnitude_1"],
    [1, "magnitude_2"],
    [1, "magnitude_3"],
    [1, "stat_chance_1"],
    [1, "stat_chance_2"],
    [1, "stat_chance_3"],
    [2, "flag"],
    [2, "properties"],
  ];

  formats.items = [
    [2, "market_value"],
    [1, "battle_flags"],
    [1, "gain_values"],
    [1, "berry_flags"],
    [1, "held_flags"],
    [1, "unknown_flag_1"],
    [1, "nature_gift_power"],
    [2, "type_attribute"],
    [1, "item_group"],
    [1, "battle_item_group"],
    [1, "usability_flag"],
    [1, "item_type"],
    [1, "consumable_flag"],
    [1, "name_order_id"],
    [1, "status_removal_flag"],
    [1, "hp_atk_boost"],
    [1, "def_spatk_boost"],
    [1, "spd_spdef_boost"],
    [1, "acc_crit_pp_boost"],
    [2, "pp_flags"],
    [1, "hp_ev_gain"],
    [1, "atk_ev_gain"],
    [1, "def_ev_gain"],
    [1, "spd_ev_gain"],
    [1, "spatk_ev_gain"],
    [1, "spdef_ev_gain"],
    [1, "hp_gain"],
    [1, "pp_gain"],
    [1, "battle_happiness"],
    [1, "ow_happiness"],
    [1, "hold_happiness"],
    [2, "padding"],
  ];

  formats.trdata = [
    [1, "template"],
    [1, "class"],
    [1, "battle_type_1"],
    [1, "num_pokemon"],
    [2, "item_1"],
    [2, "item_2"],
    [2, "item_3"],
    [2, "item_4"],
    [4, "ai"],
    [1, "heal"],
    [1, "money"],
    [2, "reward_item"],
  ];

  formats.encounters = ["spring", "summer", "fall", "winter"].flatMap((season) => [
    [1, `${season}_grass_rate`],
    [1, `${season}_grass_doubles_rate`],
    [1, `${season}_grass_special_rate`],
    [1, `${season}_surf_rate`],
    [1, `${season}_surf_special_rate`],
    [1, `${season}_super_rod_rate`],
    [1, `${season}_super_rod_special_rate`],
    [1, `${season}_blank`],
    ...["grass", "grass_doubles", "grass_special"].flatMap((kind) =>
      range(12, (n) => [
        [2, `${season}_${kind}_slot_${n}`],
        [1, `${season}_${kind}_slot_${n}_min_level`],
        [1, `${season}_${kind}_slot_${n}_max_level`],
      ]),
    ),
    ...["surf", "surf_special", "super_rod", "super_rod_special"].flatMap((kind) =>
      range(5, (n) => [
        [2, `${season}_${kind}_slot_${n}`],
        [1, `${season}_${kind}_slot_${n}_min_level`],
        [1, `${season}_${kind}_slot_${n}_max_level`],
      ]),
    ),
  ] as FieldSpec[]);

  formats.marts = range(20, (n) => [[2, `item_${n}`]]);

  formats.grottos = ["white", "black"].flatMap((version) =>
    ["rare", "uncommon", "common"].flatMap((rarity) => [
      ...range(4, (n) => [[2, `${version}_${rarity}_pok_${n}`]]),
      ...range(4, (n) => [[1, `${version}_${rarity}_max_lvl_${n}`]]),
      ...range(4, (n) => [[1, `${version}_${rarity}_min_lvl_${n}`]]),
      ...range(4, (n) => [[1, `${version}_${rarity}_gender_${n}`]]),
      ...range(4, (n) => [[1, `${version}_${rarity}_form_${n}`]]),
      [2, `${version}_${rarity}_padding`],
    ] as FieldSpec[]),
  );
  formats.grottos.push(
    ...["normal", "hidden"].flatMap((itemType) =>
      ["superrare", "rare", "uncommon", "common"].flatMap((rarity) => range(4, (n) => [[2, `${itemType}_${rarity}_item_${n}`]])),
    ),
  );

  return formats;
}

function getGen4NarcFormats(baseRom: BaseRom): NarcFormatMap {
  const formats: NarcFormatMap = {};

  formats.personal = [
    [1, "base_hp"],
    [1, "base_atk"],
    [1, "base_def"],
    [1, "base_speed"],
    [1, "base_spatk"],
    [1, "base_spdef"],
    [1, "type_1"],
    [1, "type_2"],
    [1, "catchrate"],
    [1, "base_exp"],
    [2, "evs"],
    [2, "item_1"],
    [2, "item_2"],
    [1, "gender"],
    [1, "hatch_cycle"],
    [1, "base_happy"],
    [1, "exp_rate"],
    [1, "egg_group_1"],
    [1, "egg_group_2"],
    [1, "ability_1"],
    [1, "ability_2"],
    [1, "flee"],
    [1, "color_flip"],
    [2, "padding"],
    [4, "tm_1-32"],
    [4, "tm_33-64"],
    [4, "tm_65-95+hm_1"],
    [4, "hm_2-6"],
  ];

  formats.evolutions = range(7, (n) => [
    [2, `method_${n}`],
    [2, `param_${n}`],
    [2, `target_${n}`],
  ]);

  formats.moves = [
    [2, "effect"],
    [1, "category"],
    [1, "power"],
    [1, "type"],
    [1, "accuracy"],
    [1, "pp"],
    [1, "effect_chance"],
    [2, "target"],
    [1, "priority"],
    [1, "flag"],
    [1, "contest_appeal"],
    [1, "contest_type"],
    [2, "padding"],
  ];

  formats.trdata = [
    [1, "template"],
    [1, "class"],
    [1, "unknown_1"],
    [1, "num_pokemon"],
    [2, "item_1"],
    [2, "item_2"],
    [2, "item_3"],
    [2, "item_4"],
    [4, "ai"],
    [4, "double_battle"],
  ];

  return formats;
}
