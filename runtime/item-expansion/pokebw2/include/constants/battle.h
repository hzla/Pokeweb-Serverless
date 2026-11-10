#ifndef POKEBW2_CONSTANTS_BATTLE_H
#define POKEBW2_CONSTANTS_BATTLE_H

// Battle styles, from BtlSetup_GetBattleStyle
#define BTL_STYLE_SINGLE 0
#define BTL_STYLE_DOUBLE 1
#define BTL_STYLE_TRIPLE 2
#define BTL_STYLE_ROTATION 3

// Type effectiveness, which multiplies the power by 0, 1/4, 1/2, 1, 2 or 4
#define TYPE_EFFECTIVENESS_IMMUNE 0
#define TYPE_EFFECTIVENESS_QUARTER 1
#define TYPE_EFFECTIVENESS_HALF 2
#define TYPE_EFFECTIVENESS_NORMAL 3
#define TYPE_EFFECTIVENESS_DOUBLE 4
#define TYPE_EFFECTIVENESS_QUADRUPLE 5

// Values for GetBattleMonStat. The stat stages go from 0 to 12, and are 6 when unchanged. The AI scripts tell which
// stage is which
#define BATTLEMON_ATTACK_STAGE 1
#define BATTLEMON_DEFENSE_STAGE 2
#define BATTLEMON_SP_ATTACK_STAGE 3
#define BATTLEMON_SP_DEFENSE_STAGE 4
#define BATTLEMON_SPEED_STAGE 5
#define BATTLEMON_ACCURACY_STAGE 6
#define BATTLEMON_EVASION_STAGE 7
#define BATTLEMON_ATTACK 8
#define BATTLEMON_DEFENSE 9
#define BATTLEMON_SP_ATTACK 10
#define BATTLEMON_SP_DEFENSE 11
#define BATTLEMON_HP 13
#define BATTLEMON_LEVEL 15
#define BATTLEMON_ABILITY 16
#define BATTLEMON_EFFECTIVE_ABILITY 17
#define BATTLEMON_GENDER 18
#define BATTLEMON_FORM 19

#define BATTLEMON_STAT_STAGE_NEUTRAL 6

// Weather, from GetFieldWeather. The AI scripts tell which is which
#define BTL_WEATHER_SUN 1
#define BTL_WEATHER_RAIN 2
#define BTL_WEATHER_HAIL 3
#define BTL_WEATHER_SANDSTORM 4

// Conditions of a side of the battle. The AI scripts tell which is which, and overlay 169's side_handlers.c the rest
#define SIDE_CONDITION_REFLECT 0
#define SIDE_CONDITION_LIGHT_SCREEN 1
#define SIDE_CONDITION_SAFEGUARD 2
#define SIDE_CONDITION_MIST 3
#define SIDE_CONDITION_TAILWIND 4
#define SIDE_CONDITION_LUCKY_CHANT 5
#define SIDE_CONDITION_SPIKES 6
#define SIDE_CONDITION_TOXIC_SPIKES 7
#define SIDE_CONDITION_STEALTH_ROCK 8
#define SIDE_CONDITION_WIDE_GUARD 9
#define SIDE_CONDITION_QUICK_GUARD 10
#define SIDE_CONDITION_RAINBOW 11
#define SIDE_CONDITION_SEA_OF_FIRE 12
#define SIDE_CONDITION_SWAMP 13
#define SIDE_CONDITION_AURORA_VEIL 14

// Conditions of the whole field. The AI scripts tell which is which, and overlay 169's field_handlers.c the rest
#define FIELD_CONDITION_WEATHER 0
#define FIELD_CONDITION_TRICK_ROOM 1
#define FIELD_CONDITION_GRAVITY 2
#define FIELD_CONDITION_IMPRISON 3
#define FIELD_CONDITION_WATER_SPORT 4
#define FIELD_CONDITION_MUD_SPORT 5
#define FIELD_CONDITION_WONDER_ROOM 6
#define FIELD_CONDITION_MAGIC_ROOM 7

// Move categories, the category of the move data (MOVE_PARAM_CATEGORY)
#define MOVE_CATEGORY_STATUS 0
#define MOVE_CATEGORY_PHYSICAL 1
#define MOVE_CATEGORY_SPECIAL 2

// Which Pokémon a move targets, the target of the move data. Named after the moves that have each
#define MOVE_TARGET_SELECTED 0      // One adjacent Pokémon the user picks, as Pound
#define MOVE_TARGET_USER_OR_ALLY 1  // Acupressure
#define MOVE_TARGET_ALLY 2          // Helping Hand
#define MOVE_TARGET_FOE 3           // One foe, as Me First
#define MOVE_TARGET_ALL_ADJACENT 4  // Every adjacent Pokémon but the user, as Surf and Earthquake
#define MOVE_TARGET_ADJACENT_FOES 5 // Every adjacent foe, as Growl and Rock Slide
#define MOVE_TARGET_USER_PARTY 6    // The user's party, as Heal Bell
#define MOVE_TARGET_USER 7          // As Swords Dance
#define MOVE_TARGET_ALL 8           // Every Pokémon in battle, as Perish Song
#define MOVE_TARGET_RANDOM_FOE 9    // As Thrash and Outrage
#define MOVE_TARGET_FIELD 10        // The whole field, as Rain Dance and Trick Room
#define MOVE_TARGET_FOE_SIDE 11     // The foes' side, as Spikes
#define MOVE_TARGET_USER_SIDE 12    // The user's side, as Reflect
#define MOVE_TARGET_DEPENDS 13      // Decided by the move, as Counter and Curse

// The class of a move's effect, the quality of the move data, which the battle's move handling branches on. Named
// after the moves that have each
#define MOVE_QUALITY_DAMAGE 0                    // Only damage
#define MOVE_QUALITY_INFLICT 1                   // Inflicts a condition, as Thunder Wave
#define MOVE_QUALITY_STAT_CHANGE 2               // Changes stats, as Swords Dance and Growl
#define MOVE_QUALITY_HEAL 3                      // As Recover
#define MOVE_QUALITY_DAMAGE_INFLICT 4            // Damage and maybe a condition, as Thunderbolt
#define MOVE_QUALITY_INFLICT_STAT_CHANGE 5       // A condition and a stat change, as Swagger
#define MOVE_QUALITY_DAMAGE_LOWER_TARGET_STATS 6 // Damage and maybe lowers the target's stats, as Psychic
#define MOVE_QUALITY_DAMAGE_USER_STAT_CHANGE 7   // Damage and changes the user's stats, as Superpower and Charge Beam
#define MOVE_QUALITY_DAMAGE_DRAIN 8              // As Giga Drain
#define MOVE_QUALITY_OHKO 9                      // As Fissure
#define MOVE_QUALITY_FIELD 10                    // An effect on the whole field, as Rain Dance
#define MOVE_QUALITY_SIDE 11                     // An effect on one side, as Reflect and Spikes
#define MOVE_QUALITY_FORCE_SWITCH 12             // As Roar
#define MOVE_QUALITY_SPECIAL 13                  // An effect of its own, as Substitute and Metronome

// The flags of the move data. Named after the moves that have each
#define MOVE_FLAG_CONTACT (1 << 0)
#define MOVE_FLAG_CHARGE (1 << 1)      // Takes a turn to charge, as Solar Beam and Fly
#define MOVE_FLAG_RECHARGE (1 << 2)    // Needs a turn to recharge, as Hyper Beam
#define MOVE_FLAG_PROTECT (1 << 3)     // Protect blocks it
#define MOVE_FLAG_REFLECTABLE (1 << 4) // Magic Coat reflects it
#define MOVE_FLAG_SNATCH (1 << 5)      // Snatch steals it
#define MOVE_FLAG_MIRROR_MOVE (1 << 6) // Mirror Move copies it
#define MOVE_FLAG_PUNCH (1 << 7)       // Iron Fist boosts it
#define MOVE_FLAG_SOUND (1 << 8)
#define MOVE_FLAG_GRAVITY (1 << 9)            // Gravity prevents it, as Fly and Splash
#define MOVE_FLAG_DEFROST (1 << 10)           // Thaws the user, as Flame Wheel and Scald
#define MOVE_FLAG_DISTANT (1 << 11)           // Reaches any Pokémon in a Triple Battle, as Fly and Aura Sphere
#define MOVE_FLAG_HEAL (1 << 12)              // Heal Block prevents it
#define MOVE_FLAG_BYPASS_SUBSTITUTE (1 << 13) // Hits through a Substitute, as Roar and Perish Song
// White 2 Upgrade's flags of later generations, which no retail move has. Its data also has bit 15 on 53 moves: X and
// Y's flag of unknown purpose, carried over with their flag word on the same moves, which nothing reads
#define MOVE_FLAG_POWDER (1 << 14)           // Grass types and Overcoat ignore it, as Spore
#define MOVE_FLAG_WIND (1 << 16)             // Wind Rider and Wind Power react to it, as Gust
#define MOVE_FLAG_SHARP (1 << 17)            // Sharpness boosts it, as Slash
#define MOVE_FLAG_HEALING_PROPERTY (1 << 18) // Triage gives it priority; only on moves White 2 adds
#define MOVE_FLAG_DANCE (1 << 19)            // Dancer copies it, as Swords Dance
#define MOVE_FLAG_BULLET (1 << 20)           // Bulletproof blocks it, as Sludge Bomb
#define MOVE_FLAG_BITE (1 << 21)             // Strong Jaw boosts it, as Crunch
#define MOVE_FLAG_PULSE (1 << 22)            // Mega Launcher boosts it, as Dark Pulse

// Conditions of a battle Pokemon, which include the major status conditions. Named after the moves that inflict them
// in the move data, or from how the AI checks for them
#define CONDITION_NONE 0
#define CONDITION_PARALYSIS 1
#define CONDITION_SLEEP 2
#define CONDITION_FREEZE 3
#define CONDITION_BURN 4
#define CONDITION_POISON 5
#define CONDITION_CONFUSION 6
#define CONDITION_ATTRACT 7
#define CONDITION_BIND 8
#define CONDITION_NIGHTMARE 9
#define CONDITION_CURSE 10
#define CONDITION_TAUNT 11
#define CONDITION_TORMENT 12
#define CONDITION_DISABLE 13
#define CONDITION_YAWN 14
#define CONDITION_HEAL_BLOCK 15
// GuessAbility treats a Pokemon with this condition as having no ability
#define CONDITION_GASTRO_ACID 16
#define CONDITION_FORESIGHT 17
#define CONDITION_LEECH_SEED 18
#define CONDITION_EMBARGO 19
#define CONDITION_PERISH_SONG 20
#define CONDITION_INGRAIN 21
#define CONDITION_MEAN_LOOK 22
// The Choice items' native shared move lock.
#define CONDITION_CHOICE_LOCK 27

#endif // POKEBW2_CONSTANTS_BATTLE_H
