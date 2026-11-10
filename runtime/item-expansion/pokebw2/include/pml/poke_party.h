#ifndef POKEBW2_PML_POKE_PARTY_H
#define POKEBW2_PML_POKE_PARTY_H

#include "types.h"
#include "gfl/heap.h"
#include "gfl/msg.h"
#include "nitro/rtc.h"
#include "pml/mail.h"
#include "struct_decls.h"

// A Pokémon's data, encrypted unless decrypted for a series of reads and writes. Names from swan
typedef struct {
    u8 rawData[32];
} PkmBufferChunk;

typedef struct {
    PkmBufferChunk chunks[4];
} PkmBuffer;

struct BoxPkm {
    u32 pid;
    u16 partyDecrypted : 1;
    u16 boxDecrypted : 1;
    u16 badEgg : 1;
    u16 unk4_3 : 13;
    u16 checksum;
    PkmBuffer contentBuffer;
};

struct PartyPkm {
    BoxPkm base;
    u32 statusCond;
    u8 level;
    u8 unk8D;
    u16 nowHP;
    u16 maxHP;
    u16 atk;
    u16 def;
    u16 spe;
    u16 spa;
    u16 spd;
    MailData mail;
    u32 unkD4;
    u32 unkD8;
};

// The party: its Pokémon, and a flag of each slot
#define PARTY_SIZE 6

struct PokeParty {
    s32 capacity;
    s32 count;
    PartyPkm pkms[PARTY_SIZE];
    u8 slotExists;
};

// The four blocks of a Pokémon's data, which PML_PkmGetParamBlockCore finds
typedef struct {
    u16 species;
    u16 item;
    u32 id;
    u32 exp;
    u8 friendship;
    u8 ability;
    u8 markings;
    u8 language;
    u8 hpEV;
    u8 atkEV;
    u8 defEV;
    u8 speEV;
    u8 spaEV;
    u8 spdEV;
    u8 contest[6];
    u32 ribbons;
} PkmBlockA;

typedef struct {
    u16 moves[4];
    u8 pp[4];
    u8 ppUps[4];
    u32 hpIV : 5;
    u32 atkIV : 5;
    u32 defIV : 5;
    u32 speIV : 5;
    u32 spaIV : 5;
    u32 spdIV : 5;
    u32 isEgg : 1;
    u32 isNicknamed : 1;
    u32 ribbons;
    u8 fatefulEncounter : 1;
    u8 gender : 2;
    u8 form : 5;
    u8 nature;
    u16 hiddenAbility : 1;
    u16 nPoke : 1;
    u16 unk1A_2 : 14;
    u32 unk1C;
} PkmBlockB;

typedef struct {
    u16 nickname[11];
    u8 unk16;
    u8 originGame;
    u64 ribbons;
} PkmBlockC;

typedef struct {
    u16 otName[8];
    u8 eggDate[3];
    u8 metDate[3];
    u16 eggLocation;
    u16 metLocation;
    u8 pokerus;
    u8 ball;
    u8 metLevel : 7;
    u8 otGender : 1;
    u8 unk1D;
    u8 unk1E;
    u8 pokestarFame;
} PkmBlockD;

PokeParty *PokeParty_Create(HeapID heapId);
void PokeParty_CreateTempPkm(PartyPkm *pkm, u16 species, u16 level, u64 id);
u32 PokeParty_GetSaveDataSize(void);
u32 PML_GenPID(u32 seed, u16 species, u16 form, u32 sex, u32 ability, u32 a5);
// Whether the personality is shiny for the trainer ID
BOOL PML_UtilPIDIsRare(u32 id, u32 pid);
u32 makeSpecialPID(u32 id, u16 species, u16 form, u8 sex, u8 a4, BOOL a5);
// Whether the gender ratio leaves no choice of sex
BOOL isGenderlessOrSetGender(u32 genderRatio);
// The trainer ID and the PID are 64-bit so that they can hold these values beside any 32-bit one. The trainer ID is
// random, or one with which the PID isn't shiny; the PID is random, or the trainer ID's value. ivs packs six 5-bit
// IVs, or is PKM_IVS_RANDOM
#define PKM_ID_RANDOM 0xffffffffffffffffULL
#define PKM_ID_NOT_SHINY 0xffffffff00000000ULL
#define PKM_PID_RANDOM 0xffffffff00000000ULL
#define PKM_PID_FROM_ID 0xffffffff00000001ULL
#define PKM_IVS_RANDOM -1
void PokeParty_CreatePkm(PartyPkm *pkm, u16 species, u16 level, u64 trainerId, s32 ivs, u64 pid);
void PokeParty_SetHiddenAbil(PartyPkm *pkm, u32 species, u32 form);
void PokeParty_SetDefaultMoves(PartyPkm *pkm);
void FriendshipManagerCalc(PartyPkm *pkm, u32 reason, u16 zoneId, u16 heapId);
void FriendshipManagerCalcItem(PartyPkm *pkm, u16 item, u16 zoneId, HeapID heapId);
// Whether a move's PP is below its maximum, and restoring amount of it
u8 PokeParty_CheckPPNeedsReplenish(PartyPkm *pkm, u32 slot);
BOOL PokeParty_AddPP(PartyPkm *pkm, u32 slot, u32 amount);
void FriendshipManagerCalcParty(PokeParty *party, u16 zoneId, HeapID heapId);
// Read and write a field of a Pokémon, PKM_PARAM_*. Fields that are not numbers go through the buffer
// A field of a Pokémon, PKM_PARAM_*. The functions take it as an enum, swan's PkmField, and MWCC doesn't share a sum
// that makes one between two calls, as it would an integer
typedef enum {
    PKM_PARAM_COUNT = 0xb4,
} PkmField;

u32 PokeParty_GetParam(const PartyPkm *pkm, PkmField param, void *buffer);
u32 PokeParty_GetNature(PartyPkm *pkm);
// A field that is not a number takes a pointer to its value
void PokeParty_SetParam(PartyPkm *pkm, PkmField param, u32 value);
u32 GetStatusCond(PartyPkm *pkm);
void PokeParty_SetStatusCond(PartyPkm *pkm, u32 status);
u8 PokeParty_GetSex(PartyPkm *pkm);
BOOL PokeParty_CheckAnyRibbon(PartyPkm *pkm);
// Whether the Pokémon can learn the move at moveIndex of a move tutor's list, by its species and form
BOOL PokeParty_CheckMoveTutorPaid(PartyPkm *pkm, u32 moveIndex, u32 tutor);
BOOL PokeParty_IsRare(PartyPkm *pkm);
// Decrypt a Pokémon for a series of reads and writes, and return whether it was encrypted, which is what the
// encryption afterwards takes
BOOL PokeParty_DecryptPkm(PartyPkm *pkm);
BOOL PokeParty_EncryptPkm(PartyPkm *pkm, BOOL wasEncrypted);
u32 PML_PkmGetParam(BoxPkm *pkm, u32 param, void *buffer);
BOOL PML_PkmDecrypt(BoxPkm *pkm);
// Encrypts or decrypts size bytes of data with key: a Pokémon's blocks with their checksum, its party fields with its
// PID
void PML_CryptoRun(void *data, u32 size, u32 key);
u16 PML_CryptoGenKey(void *data, u32 size);
// Block 0 to 3 of a Pokémon's data, PkmBlockA to PkmBlockD, wherever its PID puts it
void *PML_PkmGetParamBlockCore(BoxPkm *pkm, u32 pid, u32 block);
u32 PML_PkmGetLevel(BoxPkm *pkm);
// Whether the Pokémon's original trainer is someone other than the player
BOOL PML_UtilCheckForeignOT(BoxPkm *pkm, PlayerInfo *playerInfo);
// Returns whether the form changed
BOOL PML_PkmChangeForme(BoxPkm *pkm, u32 forme);
BOOL hasPokemonChangedForm(BoxPkm *pkm);
BOOL PML_PkmReEncrypt(BoxPkm *pkm, BOOL wasEncrypted);
BOOL PML_PkmIsRare(BoxPkm *pkm);
// Whether the species and form are a fused Kyurem
BOOL isKyuremTransformed(u16 species, u8 form);
u32 PML_PkmGetNature(BoxPkm *pkm);
u8 PML_PkmGetSex(BoxPkm *pkm);
// Whether the Pokémon has Pokérus that hasn't run its course
BOOL doesPokerusHaveDuration(BoxPkm *pkm);
// Whether the Pokémon has had Pokérus
BOOL doesPokeHavePokerus(BoxPkm *pkm);
// The same two for a Pokémon of the party
BOOL pokerusDuration(PartyPkm *pkm);
BOOL pokeHasPkrs(PartyPkm *pkm);
BoxPkm *PokeParty_GetBoxPkm(PartyPkm *pkm);
// Puts a move in a slot with its full PP and no PP Ups
void PML_PkmSetMove(BoxPkm *pkm, u16 move, u8 slot);
// How a nature changes a stat, in the order attack, defense, special attack, special defense and speed from 1:
// 1 raised, -1 lowered, 0 neither
s8 statAffectedByNature(u8 nature, unsigned int stat);
// Allocates a party Pokémon made from a boxed one
void PML_PkmSetParam(BoxPkm *pkm, u32 param, u32 value);
// The size of a Pokémon's data
u32 PokeParty_GetPkmRawSize(void);
// The size of a boxed Pokémon's data
u32 PML_GetPkmRawSize(void);
void PML_PkmInit(BoxPkm *pkm);
// Opens the personal archives and empties the cache of the species data read last
void PML_PersonalInit(HeapID heapId);
// Which of its species' abilities the Pokémon has: 0, 1, or 2 for the hidden one
u8 getParentAbilSlotNumber(PartyPkm *pkm);
// Restore the PP of the Pokémon's moves
void PokeParty_PPRecover(PartyPkm *pkm);
void PML_PkmPPRecover(BoxPkm *pkm);
// The level a Pokémon of the species has with the experience
u32 CalcLevelByExp(u16 species, u16 form, u32 exp);
// Whether the Pokémon can learn the move at moveIndex of the list of the tutors that teach for free
BOOL PokeParty_CheckMoveTutorNormal(PartyPkm *pkm, u32 moveIndex);
void PML_CreateTempPkm(BoxPkm *pkm, u16 species, u16 level, u64 id);
void copyPartyPkm(const PartyPkm *src, PartyPkm *dest);
// Resets the nickname to the species' name
void setNicknameToNick(PartyPkm *pkm);
u8 PML_UtilDerivePkmSex(u16 species, u16 form, u32 pid);
void copyPkmIntoPartyBlk(PokeParty *party, u32 index, PartyPkm *pkm);
// Changes a Pokémon into another species, as evolution does
void setChangedPkmSpecies(PartyPkm *pkm, u16 species);
// Hatches an egg, recording where and by whom
void hatchEgg(PartyPkm *pkm, PlayerInfo *playerInfo, u16 placeName, HeapID heapId);
void PokeParty_Init(PokeParty *party);
void PokeParty_Copy(const PokeParty *src, PokeParty *dest);
void PokeParty_InitCore(PokeParty *party, u32 capacity);
void PokeParty_ClearPkm(PartyPkm *pkm);
// Restores a Pokémon's HP and PP and cures its status
void PokeParty_Recover(PartyPkm *pkm);
void PokeParty_RecalcStats(PartyPkm *pkm);
u32 PokeParty_GetLevel(PartyPkm *pkm);
// The experience the Pokémon's level starts at
u32 getExpForPkm_Wrapper(PartyPkm *pkm);
// Whether a Pokémon can learn the TM or HM of the number PML_ItemGetTMBitMask gives
BOOL canPkmLearnTM_Wrapper(PartyPkm *pkm, u8 tm);
void setLevel(PartyPkm *pkm, u32 level);
// Gives a Pokémon of the party Pokérus at random
void pokerusHandler(PokeParty *party);
// Counts down the Pokérus of the party's Pokémon by days
void pokerusDecay(PokeParty *party, s32 days);
// Spreads Pokérus from the party's Pokémon to their neighbours at random
void pokerusSpread(PokeParty *party);
void PokeParty_SetNature(PartyPkm *pkm, u32 nature);
void setPkmBattleData(PartyPkm *pkm, u32 param, u32 value);
// A Pokémon's icon in ARCID_POKEICON: its characters' file and its palette
u32 PokeIcon_GetFileOfPkm(BoxPkm *pkm);
u8 PokeIcon_GetPaletteOfPkm(BoxPkm *pkm);
// The files of the icons' palette, cells and animations in ARCID_POKEICON
u32 PokeIcon_GetAltPaletteFile(void);
u32 PokeIcon_GetCellFile_Main(void);
u32 getOBJTileMapping_MainEng(void);
// A species with its form and sex in one u16
// The icons' palette and cell files, for the OBJ mapping in use
u32 PokeIcon_GetPaletteFile(void);
u32 PokeIcon_GetCellFile_Sub(void);
u16 PokeIcon_PackSpecies(u32 species, u32 form, u32 sex);
// A Pokémon icon's character file in its archive, and its palette
u32 PokeParty_GetIconIndex(u32 species, u32 form, u32 sex, BOOL egg);
u8 PokeIcon_GetPalette(u32 species, u32 form, u32 sex, BOOL egg);
// The level, 0 to 4, of a Pokémon's Pokéstar fame
int PML_GetPokestarFameLevel(u8 fame);
PartyPkm *PokeParty_GetPkm(PokeParty *party, u32 index);
// A flag of each slot, kept in the party
BOOL PokeParty_GetSlotExists(PokeParty *party, u32 slot);
void PokeParty_SetSlotExists(PokeParty *party, u32 slot, BOOL exists);
BoxPkm *PokeParty_ToBoxPkm(PartyPkm *pkm);
// A new party Pokémon made from a box Pokémon, with its stats calculated
PartyPkm *boxPkmRegenToPartyPkm(BoxPkm *pkm, HeapID heapId);
int PokeParty_GetPkmCount(PokeParty *party);
u32 PokeParty_GetFirstBattleReady(PokeParty *party);
u32 isEggInParty(PokeParty *party);
int howManyPartyPokesAreNotEggs(PokeParty *party);
int howManyPokesAreAbleToFight(PokeParty *party);
int countAllEggsInParty(PokeParty *party);
int countSanityEggsInParty(PokeParty *party);
int PokeParty_GetCapacity(PokeParty *party);
BOOL PokeParty_AddPkm(PokeParty *party, PartyPkm *pkm);
// Both return a constant: TRUE for the removal, FALSE for the swap
BOOL PokeParty_RemovePkm(PokeParty *party, u32 index);
BOOL PokeParty_SwapPkms(PokeParty *party, u32 indexA, u32 indexB, HeapID heapId);
// Reorders the party: order[i] is the index of the Pokémon that goes to position i
void PokeParty_Reorder(PokeParty *party, u32 *order, HeapID heapId);
void PokeParty_RecoverAll(PokeParty *party);
// A Pokémon's icon in archive 7: its file, and the palette of the file PokeIcon_GetPaletteFile returns that it uses.
// The cells and animations depend on the sub engine's OBJ VRAM mapping: PokeIcon_GetCellFile_Sub and
// getOBJTileMapping_SubEng return them
u32 PokeParty_GetIconIndex(u32 species, u32 form, u32 sex, BOOL egg);
u8 PokeIcon_GetPalette(u32 species, u32 form, u32 sex, BOOL egg);
u32 PokeIcon_GetPaletteFile(void);
u32 PokeIcon_GetCellFile_Sub(void);
u32 getOBJTileMapping_SubEng(void);
// Returns whether the form changed
BOOL PokeParty_ChangeForme(PartyPkm *pkm, u16 forme);
// The form of Arceus for a plate, and of Genesect for a drive
u16 _getTypeForPlate(u16 item);
u32 PML_ItemGetGenesectDriveForme(u16 item);
// The form, or 0 if the species has fewer forms. Species 650 counts as having two
u8 PML_PkmSanitizeForme(u16 species, u8 form);
// The form a sprite shows: 0 for the four species whose forms share one sprite
u8 PML_PkmGetSpriteForme(u16 species, u8 form);
// Teaches a move, and returns 0xffff when all four slots are full
u16 PokeParty_LearnMove(PartyPkm *pkm, u16 move);
// Replaces the last move
void PokeParty_SetLastMove(PartyPkm *pkm, u16 move);
// Changes a Rotom's form and its form's move, which replaces the move of moveSlot when no slot is free. Returns
// whether the Pokémon is a Rotom
BOOL PML_PkmChangeRotomForme(PartyPkm *pkm, u32 forme, u32 moveSlot);
void PokeParty_SetMove(PartyPkm *pkm, u16 move, u8 slot);
// Learn a move, and set a move in a slot, as the move tutors teach them
u16 PokeParty_LearnMoveTutor(PartyPkm *pkm, u16 move);
void PokeParty_SetMoveKeepPP(PartyPkm *pkm, u16 move, u8 slot);
u16 *PokeParty_GetRememberableMoves(PartyPkm *pkm, HeapID heapId);
BOOL doesPkmHaveLevelMoveToLearn(const u16 *moves);
// The next move that a Pokémon learns at its level, going on from *index: 0 once there are none left, 0xfffe for one
// it already knows, and the move with 0x8000 set when it has no free slot for it
u16 PokeParty_LearnNextLevelMove(PartyPkm *pkm, u32 *index, HeapID heapId);
#define LEARN_MOVE_KNOWN 0xfffe
#define LEARN_MOVE_NO_SLOT 0x8000
// Allocates a Pokémon that is not in a party, with random IVs and PID, through PokeParty_CreateTempPkm. trainerId
// is a 32-bit ID or one of the PKM_ID_ values
PartyPkm *PokeParty_NewTempPkm(u16 species, u16 level, u64 trainerId, HeapID heapId);
PartyPkm *boxPkmRegenToPartyPkm(BoxPkm *pkm, HeapID heapId);
// Whether the species is a legendary Pokémon of the national Pokédex
BOOL PML_PkmIsLegendNational(u16 species);
// Sets the nickname to the species name
void setNicknameToNick(PartyPkm *pkm);
// Whether the Pokémon is in a form that it changed into, which it would lose in a box
BOOL hasPokemonChangedForm(BoxPkm *pkm);
// The number of Pokémon in the party that can battle: not fainted and not eggs
int countActivePkms(PokeParty *party);
BOOL CheckSpeciesInParty(PokeParty *party, u32 species);
PartyPkm *PokeParty_NewPkm(u16 species, u16 level, u64 trainerId, s32 ivs, u64 pid, HeapID heapId);
void TransformVsPokePartyBySeason(GameData *gameData, PokeParty *party, u8 season);

BOOL IsTrainerOT(PartyPkm *pkm, PlayerInfo *player);
// Whether a Pokémon's nature raises (1) or lowers (-1) a stat
s8 doesNatureAffectStat(PartyPkm *pkm, u32 stat);

u8 getHiddenPowerType(PartyPkm *pkm);
u32 getHiddenPowerBasePwr(PartyPkm *pkm);

#if defined(WHITE2) && defined(W2U_SHARED_BATTLE) && !defined(BLACK2)
// Value-only, atomic scalar read from a caller-proven current owned Box.
// Only friendship, the six IV fields and egg eligibility are accepted.
// Does not issue ownership/lifetime authority or alter the source record.
// Output must be separate caller-owned scalar storage, never part of source.
BOOL W2U_PMLBoxReadQueryScalar(const BoxPkm *source, PkmField field, u32 *value);

// Pure native Hidden Power type mapping from an already-copied six-bit parity.
// No record/ownership access or IO. Parity >63 or NULL refuses atomically.
BOOL W2U_PMLHiddenPowerTypeFromParity(u32 parity, u8 *type);
#endif

#endif // POKEBW2_PML_POKE_PARTY_H
