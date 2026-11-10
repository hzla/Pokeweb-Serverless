#ifndef POKEBW2_BATTLE_REGULATION_H
#define POKEBW2_BATTLE_REGULATION_H

#include "types.h"
#include "gfl/heap.h"
#include "gfl/str.h"
#include "struct_decls.h"

// The parameters of a regulation, for Regulation_GetParam, Regulation_SetParam and Regulation_CheckParamBit
enum {
    // The message of the regulation's name in the regulations' text bank
    REGULATION_PARAM_NAME,
    REGULATION_PARAM_1,
    REGULATION_PARAM_MIN_COUNT,
    REGULATION_PARAM_MAX_COUNT,
    REGULATION_PARAM_LEVEL,
    REGULATION_PARAM_LEVEL_MODE,
    REGULATION_PARAM_MAX_LEVEL_TOTAL,
    REGULATION_PARAM_ALLOW_SAME_SPECIES,
    REGULATION_PARAM_ALLOW_SAME_ITEM,
    // Bit arrays, which only Regulation_CheckParamBit reads
    REGULATION_PARAM_BANNED_SPECIES,
    REGULATION_PARAM_BANNED_ITEMS,
    REGULATION_PARAM_REQUIRED_SPECIES,
    REGULATION_PARAM_REQUIRED_FORM,
    REGULATION_PARAM_LAUNCHER,
    // A bit array as well
    REGULATION_PARAM_BITS_AC,
    REGULATION_PARAM_15,
    REGULATION_PARAM_16,
    REGULATION_PARAM_ALLOW_NICKNAMES,
    REGULATION_PARAM_18,
    REGULATION_PARAM_SHOW_PARTNERS,
    REGULATION_PARAM_TIME_LIMIT,
    REGULATION_PARAM_BATTLE_TYPE,
    REGULATION_PARAM_MAX_BATTLES
};

struct Regulation {
    u8 name;
    u8 unk1;
    // How many Pokémon may be entered
    u8 minCount;
    u8 maxCount;
    // The level, and how it applies: 0 not, 1 a minimum, 2 a maximum, 3 a cap, 4 the level of all, 5 a raise to it
    u8 level;
    u8 levelMode;
    // The most that the levels of the team may add up to
    u16 maxLevelTotal;
    // Whether two Pokémon of a species, and two of a held item, may be entered
    u8 allowSameSpecies;
    u8 allowSameItem;
    // A bit for each species and each item that is banned
    u8 bannedSpecies[0x52];
    u8 bannedItems[0x4c];
    // The Pokémon that the team must have
    u16 requiredSpecies;
    u8 requiredForm;
    // The Wonder Launcher: 2 leaves it to the players
    u8 launcher;
    u8 unkAC[0x7];
    u8 unkB3;
    u8 unkB4;
    // Whether nicknames are kept
    u8 allowNicknames;
    u8 unkB6;
    u8 unkB7;
    // Whether the partners' teams are shown in the selection, and its time limit
    u8 showPartners;
    u8 timeLimit;
    u8 battleType;
    // How many battles may be played
    u8 maxBattles;
}; // size: 0xbc

// What func_0200b760 fills in from a regulation
typedef struct {
    u8 unk0[0x7];
    u8 launcher;
} RegulationUnkAC;

// The rules of a battle, such as the level cap
Regulation *Regulation_Create(HeapID heapId);
void Regulation_Copy(const Regulation *src, Regulation *dest);
// The regulation's name
StrBuf *makeStrbufLoadBattleTypeText(Regulation *regulation, HeapID heapId);
// A parameter of the regulation, which is 0 for the bit arrays
u32 Regulation_GetParam(Regulation *regulation, u32 param);
// Whether a bit of one of the regulation's bit arrays is set
BOOL Regulation_CheckParamBit(Regulation *regulation, u32 param, int index);
void func_0200b760(Regulation *regulation, RegulationUnkAC *out);
// poke_regulation.c, which the ROM names: checks of Pokémon and parties against a regulation. Names are not swan's

// What a party fails a regulation by, which PokeRegulation_CheckPicked, PokeRegulation_CheckPartyCanEnter and
// PokeRegulation_CheckParty return
enum {
    REGULATION_RESULT_OK,
    // The levels of the Pokémon add up to more than the regulation allows
    REGULATION_RESULT_LEVEL_TOTAL,
    REGULATION_RESULT_SAME_SPECIES,
    REGULATION_RESULT_SAME_ITEM,
    // Too few Pokémon
    REGULATION_RESULT_COUNT,
    // A Pokémon the regulation doesn't allow
    REGULATION_RESULT_POKEMON,
    REGULATION_RESULT_6,
    // The Pokémon the regulation asks for is missing
    REGULATION_RESULT_REQUIRED
};

// Every reason a Pokémon or a party fails a regulation, as bits
enum {
    REGULATION_FAIL_COUNT = 1 << 0,
    REGULATION_FAIL_LEVEL = 1 << 1,
    REGULATION_FAIL_SPECIES = 1 << 2,
    REGULATION_FAIL_SAME_SPECIES = 1 << 3,
    REGULATION_FAIL_SAME_ITEM = 1 << 4,
    REGULATION_FAIL_EGG = 1 << 5,
    REGULATION_FAIL_ITEM = 1 << 6,
    REGULATION_FAIL_REQUIRED = 1 << 7,
    REGULATION_FAIL_LEVEL_TOTAL = 1 << 8,
    REGULATION_FAIL_MOVE = 1 << 9,
    REGULATION_FAIL_TYPE = 1 << 10
};

// A rule on top of a regulation, for PokeRegulation_CheckPokemonExtraRule
typedef struct {
    // The type a Pokémon must have, or TYPE_NULL
    u8 type;
    // Whether Metronome, Torment and Transform are banned
    u8 banMoves;
    // A banned move, or MOVE_NONE
    u16 move;
} RegulationExtraRule;

// The rules of a regulation as text: the message data and, for each of the six rules, its name and its value
typedef struct {
    MsgData *msgData;
    StrBuf *rule[6];
    StrBuf *value[6];
    // Whether the Wonder Launcher is on
    u8 launcher;
} RegulationPrintMsg;

// Checks a Pokémon against the regulation and the extra rule, returning the REGULATION_FAIL_* bits, 0 if it may join
u32 PokeRegulation_CheckPokemonExtraRule(Regulation *regulation, RegulationExtraRule *rule, PartyPkm *pkm);
// Checks the Pokémon picked from a party, by their slots from 1, against the regulation
u32 PokeRegulation_CheckPicked(Regulation *regulation, PokeParty *party, const u8 *picked);
// Whether a team that the regulation allows can be picked from the party: REGULATION_RESULT_OK,
// REGULATION_RESULT_COUNT or REGULATION_RESULT_LEVEL_TOTAL
u32 PokeRegulation_CheckPartyCanEnter(Regulation *regulation, PokeParty *party);
// Checks a whole party against the regulation, setting the REGULATION_FAIL_* bits of every reason it fails by
u32 PokeRegulation_CheckParty(Regulation *regulation, PokeParty *party, u32 *flags);
// Sets the level of the party's Pokémon that the regulation changes the level of
void PokeRegulation_ApplyLevelToParty(Regulation *regulation, PokeParty *party);
// Gives the party's Pokémon their species' names unless the regulation allows nicknames
void PokeRegulation_ApplyNicknamesToParty(Regulation *regulation, PokeParty *party, HeapID heapId);
// Whether the party has an egg
BOOL PokeRegulation_PartyHasEgg(Regulation *regulation, PokeParty *party);
// Allocates a regulation read from arc 106
Regulation *PokeRegulation_LoadNew(u32 fileId, HeapID heapId);
// Reads a regulation from arc 106
void PokeRegulation_Load(u32 fileId, Regulation *regulation);
// The regulation's rules as text (a RegulationPrintMsg). launcher is used when the regulation leaves the Wonder
// Launcher to the players
void *PokeRegulation_CreatePrintMsg(Regulation *regulation, WordSet *wordset, HeapID heapId, BOOL launcher);
void PokeRegulation_FreePrintMsg(void *printMsg);
// Picks Pokémon of a party that the regulation allows, by their slots from 1, and returns whether it found a team
BOOL PokeRegulation_PickTeam(Regulation *regulation, PokeParty *party, u8 *picked);
// Values out of the parameter's range are ignored
void Regulation_SetParam(Regulation *regulation, u32 param, int value);

#endif // POKEBW2_BATTLE_REGULATION_H
