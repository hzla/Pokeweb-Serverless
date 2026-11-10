#ifndef POKEBW2_SAVE_HIGH_LINK_H
#define POKEBW2_SAVE_HIGH_LINK_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"

// Block 0x35, the Entralink's save (high_link_savedata.c, a guessed name; the block's name is swan's)

#define HIGH_LINK_POWER_MAX 3
#define HIGH_LINK_POWER_NONE 0x30

// What GameData_GetMyPassPowerLevels returns: the Entralink's two levels, White then Black
typedef struct {
    u8 unk00[0xc];
    u16 level1;
    u16 level2;
} PassPowerLevel;

struct HighLinkSave {
    PassPowerLevel levels;
    u8 unk10[0x190];
    // The pass power in each of the three slots, or HIGH_LINK_POWER_NONE
    u8 powers[HIGH_LINK_POWER_MAX];
    u8 padding1A3;
    // A bit for each special pass power received, numbered by PassPower_GetSPowerBaseID
    u8 specialFlags[2];
    u8 unk1A6[6];
    // The play time counted by HighLinkSave_CountPlaySeconds
    u64 seconds;
};

// The block's size and its initial state; swan's names for them are misnomers
u32 getSizeofProbabilityTable(void);
void probability(HighLinkSave *save);
void setupProbabilityTable(PassPowerLevel *levels);
// Add to the White and the Black level, up to 999, and return how much was added
int HighLinkSave_AddWhiteLevel(PassPowerLevel *levels, int add);
int HighLinkSave_AddBlackLevel(PassPowerLevel *levels, int add);
// Copies the levels into the save, and out of it
void HighLinkSave_SetLevels(SaveControl *save, const PassPowerLevel *levels);
void HighLinkSave_GetLevels(SaveControl *save, PassPowerLevel *levels);
// Puts a pass power in one of the three slots
void HighLinkSave_SetPassPower(HighLinkSave *save, u32 passPower, int index);
// The pass power in a slot, or HIGH_LINK_POWER_NONE; a slot with an invalid one is cleared
u32 HighLinkSave_GetPassPower(HighLinkSave *save, int index);
// Sets the flag of a special pass power
void HighLinkSave_SetSpecialPowerFlag(HighLinkSave *save, u32 id);
// Copies the two bytes of the special pass powers' flags into dest
void HighLinkSave_GetSpecialFlags(HighLinkSave *save, u8 *dest, u32 a2);
// Counts play time in seconds: mode 0 starts the count, 1 adds the time since the start to the save's total and
// 2 returns the total as it would be. Returns the total
u64 HighLinkSave_CountPlaySeconds(HighLinkSave *save, PlayTime *playTime, u32 mode);
// The pass powers in effect (pass_power.c, a guessed name; the functions' names are swan's)

// The pass powers are numbered to PASS_POWER_MAX, without 0x2e and 0x2f. Those from PASS_POWER_NONE on are new in
// Black 2 and White 2, and PASS_POWER_SPECIAL_FIRST to PASS_POWER_SPECIAL_LAST are the special ones
#define PASS_POWER_SPECIAL_FIRST 0x21
#define PASS_POWER_SPECIAL_LAST 0x26
#define PASS_POWER_BW1_MAX 0x2e
#define PASS_POWER_NONE HIGH_LINK_POWER_NONE
#define PASS_POWER_MAX 0x40

// What a pass power does. One pass power of each effect runs at a time
typedef enum {
    PASS_POWER_EFFECT_ENCOUNTER_UP,
    PASS_POWER_EFFECT_ENCOUNTER_DOWN,
    PASS_POWER_EFFECT_HATCH,
    PASS_POWER_EFFECT_BEFRIEND,
    PASS_POWER_EFFECT_BARGAIN,
    PASS_POWER_EFFECT_HP_RESTORE,
    PASS_POWER_EFFECT_PP_RESTORE,
    PASS_POWER_EFFECT_EXP_UP,
    PASS_POWER_EFFECT_EXP_DOWN,
    PASS_POWER_EFFECT_PRIZE_MONEY,
    PASS_POWER_EFFECT_CAPTURE,
    PASS_POWER_EFFECT_11,
    PASS_POWER_EFFECT_12,
    PASS_POWER_EFFECT_EXPLORING,
    PASS_POWER_EFFECT_GROTTO,
    PASS_POWER_EFFECT_LUCKY,
    PASS_POWER_EFFECT_COUNT,
} PassPowerEffect;

// A pass power of the table that PassPowerData_Create reads: the two levels it is unlocked by, White then Black,
// its name in message file 263 and its description in message file 264
typedef struct {
    u8 level1;
    u8 level2;
    // The price in Pass Orbs, which the description shows
    u16 unk02;
    u16 name;
    u16 info;
    // The strength of the effect: a percentage, an amount or a level
    u16 value;
    // PASS_POWER_EFFECT_*
    u8 effect;
    // How long it lasts, in minutes
    u8 minutes;
} PassPowerData;

void PassPower_Init(void);
// Counts the pass powers' time down, once a frame
void PassPower_Update(void);
// Whether a number is neither a pass power nor PASS_POWER_NONE, and whether it is a pass power
BOOL PassPower_IsIDInvalid(int passPower);
BOOL PassPower_IsIDValid(int passPower);
// Whether Black and White know the pass power
BOOL PassPower_IsBW1Compatible(int passPower);
// The bit of a special pass power in the two bytes of HighLinkSave_GetSpecialFlags, or 0xff
u8 PassPower_GetSPowerBaseID(int passPower);
// Starts a pass power, bought with Pass Orbs when paid is set. It ends the pass power of the opposite effect
void PassPower_Activate(u32 passPower, const void *data, BOOL paid);
// The pass power that runs with the effect of the given one, and with a given effect, or PASS_POWER_NONE
u32 PassPower_GetUsedIDByPassPower(u32 passPower, void *data);
u32 PassPower_GetUsedIDByEffect(int effect);
// The time an effect has left, at least 1 while it runs
u32 PassPower_GetRemainingSeconds(int effect);
// A pass power whose time is up, or PASS_POWER_NONE. It runs on until it is ended
u32 PassPower_GetDepletedID(void);
// Ends the pass power that runs with the effect of the given one
void PassPower_Deactivate(u32 passPower, void *data);
// The pass powers' table, read from its archive
void *PassPowerData_Create(HeapID heapId);
void PassPowerData_Free(void *data);
// A pass power's effect and its price in Pass Orbs, from the table of PassPowerData_Create
u8 PassPowerData_GetEffect(void *data, u32 passPower);
u16 PassPowerData_GetPrice(void *data, u32 passPower);
// The pass powers on wild encounters: the encounter rate, the rolls for a shiny and the row of the slots' odds
u32 PassPower_ApplyEncounter(u32 rate);
// An egg's steps, and the friendship a Pokémon gains
u32 PassPower_ApplyHatch(u32 steps);
int PassPower_ApplyBefriend(int friendship);
u32 PassPower_ApplyBargain(u32 price);
// The pass powers that act at once: they restore the HP or PP of the first Pokémon able to battle, and return its
// place in the party (0 when the whole party was healed), or 0xff without the pass power
u32 PassPower_ApplyHPRestore(PokeParty *party);
u32 PassPower_ApplyPPRestore(PokeParty *party);
u32 PassPower_ApplyEXP(u32 exp);
u32 PassPower_ApplyPrizeMoney(u32 money);
u32 PassPower_ApplyCapture(s32 rate);
// The steps between phenomena, and the chance of one, in percent
u32 PassPower_ApplyExploring(u32 steps);
u32 PassPower_ApplyExploringChance(u32 chance);
// The chance that a Hidden Grotto fills, in percent, and a number of the Hidden Grottoes that it adds 2 to
u32 PassPower_ApplyGrotto(u32 chance);
u32 PassPower_ApplyGrottoVolume(u32 volume);
u32 PassPower_ApplyLuckyEncProb(u32 row);
u32 PassPower_ApplyLuckyShiny(u32 rolls);

// Two levels of what GameData_GetMyPassPowerLevels returns, which the pass powers need
u16 PassPowerLevel_GetWhite(void *levels);
u16 PassPowerLevel_GetBlack(void *levels);
// Overlay 12's pass_power_check.c: whether a pass power is unlocked (0), nearly (1) or not (2), and how many are
u32 CheckPassPowerUnlocked(void *data, int index, void *levels, u8 *flags);
u32 GetUnlockedPassPowerCount(void *data, void *levels, u8 *flags);

#endif // POKEBW2_SAVE_HIGH_LINK_H
