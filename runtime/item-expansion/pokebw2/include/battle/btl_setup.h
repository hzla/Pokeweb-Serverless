#ifndef POKEBW2_BATTLE_BTL_SETUP_H
#define POKEBW2_BATTLE_BTL_SETUP_H

#include "types.h"
#include "battle/regulation.h"
#include "gfl/heap.h"
#include "nitro/math.h"
#include "save/config.h"
#include "struct_decls.h"
#include "system/pms_data.h"

// The background, place and time of a battle, which the battle view copies as one struct
typedef struct {
    u32 bgType;
    u32 terrain;
    u8 weather;
    u8 season;
    u16 zoneId;
    u8 hour;
    u8 minute;
} BtlFieldEnv;

// The battle's surroundings, which GetFieldEffectData returns
struct BtlFieldSituation {
    BtlFieldEnv env;
    // The battle's music, and the music of a win
    u16 bgm;
    u16 unk12;
    void *netHandle;
    u8 unk18;
    u8 unk19;
    u8 unk1a;
    u8 unk1b;
};

// A trainer the battle is set up with
struct BtlSetupTrainer {
    u32 trainerId;
    u32 trainerClass;
    u32 aiFlags;
    u16 items[4];
    StrBuf *name;
    PMSData unk18;
    PMSData unk20;
};

// A trainer as a link battle sends it, with the name as characters
typedef struct {
    u32 trainerId;
    u32 trainerClass;
    u32 aiFlags;
    u16 items[4];
    u8 unk14[4];
    PMSData unk18;
    PMSData unk20;
    u16 name[0x20];
    u32 nameLength;
} BtlCommTrainerData;

#if defined(WHITE2) && (defined(W2U_SHARED_BATTLE) || defined(W2U_SHARED_BATTLE_ABI)) && !defined(BLACK2)
enum {
    W2U_BTL_COMPLETION_VERSION = 1,
    W2U_BTL_COMPLETION_RUNNING = 1,
    W2U_BTL_COMPLETION_FAULTED = 2,
    W2U_BTL_COMPLETION_DATA = 1,
    W2U_BTL_COMPLETION_CAPACITY = 2,
    W2U_BTL_COMPLETION_UNCLASSIFIED = 3
};

typedef struct {
    u32 version;
    u32 serial;
    u32 state;
    u32 reason;
} W2UBattleCompletion;

typedef struct {
    BtlSetup *setup;
    u32 serial;
} W2UBattleCompletionKey;
#endif

struct BtlSetup {
    u32 battleType;
    u32 battleStyle;
    BtlFieldSituation fieldSituation;
    // The parties of the four clients
    PokeParty *party[4];
    void *unk34[4];
    u8 unk44[4];
    // The trainers of the four clients
    BtlSetupTrainer *trainers[4];
    // The trainers' names, by client
    StrBuf *trainerNames[4];
    StrBuf *unk68;
    StrBuf *unk6C;
    GameData *gameData;
    Config *config;
    BagSave *bag;
    void *unk7C;
    PokeDexSave *pokedex;
    GameRecords *records;
    void *unk88;
    u16 unk8C;
    u16 unk8E;
    // What func_0200b760 fills in from a regulation, a RegulationUnkAC
    u8 unk90[7];
    u8 unk97;
    // The player's badges
    u8 unk98;
    u8 unk99[3];
    // BtlSetup_SetFlag sets these
    u32 flags;
    u16 unkA0;
    u16 unkA2;
    u32 unkA4;
    u32 unkA8;
    u8 unkAC;
    u8 unkAD;
    u8 unkAE;
    u8 unkAF;
    void *unkB0;
    u32 unkB4;
    // The battle's random state, which the main module copies back
    MATHRandContext32 rand;
    u16 unkD0;
    u8 unkD2;
    u8 unkD3;
    u8 unkD4;
    u8 unkD5;
    u8 unkD6;
    u8 unkD7;
    u8 unkD8;
    u8 unkD9;
    u8 unkDA;
    u8 unkDB;
    u8 unkDC;
    u8 unkDD_0 : 1;
    u8 unkDD_1 : 1;
    u8 unkDD_2 : 1;
    u8 unkDD_3 : 2;
    u8 unkDD_5 : 1;
    u8 unkDD_6 : 1;
    u8 unkDD_7 : 1;
    u8 unkDE_0 : 1;
    u8 unkDE_1 : 7;
    u8 unkDF;
    u8 unkE0;
    u8 unkE1[6];
    // The party slots each client sends out
    u8 unkE7[4][6];
    u8 unkFF;
    // Each client's remaining HP, in percent of its party's total
    u32 unk100[4];
    u8 unk110[0x14];
    u32 unk124;
    u8 unk128;
    u8 unk129;
    u32 unk12C;
    u32 unk130;
    u32 unk134;
    u16 unk138;
    u16 unk13a;
    // Added to the defeated mon's level for the experience it gives
    s8 levelDiff;
#if defined(WHITE2) && (defined(W2U_SHARED_BATTLE) || defined(W2U_SHARED_BATTLE_ABI)) && !defined(BLACK2)
    W2UBattleCompletion w2uCompletion;
#endif
};

BtlSetup *BtlSetup_Create(HeapID heapId);
u32 BtlSetup_CheckFlag(BtlSetup *setup, u32 flag);
void BtlSetup_Reset(BtlSetup *setup);
// Wild battles, against the party, alone or beside the trainer
void BtlSetup_SetWildNormal(BtlSetup *setup, GameData *gameData, PokeParty *party, BtlFieldStatus *status,
                            BOOL doubleBattle, HeapID heapId);
void BtlSetup_SetWildMulti(BtlSetup *setup, GameData *gameData, PokeParty *party, u32 trainerId, BtlFieldStatus *status,
                           HeapID heapId);
void BtlSetup_SetFlag(BtlSetup *setup, u32 flag);
void BtlSetup_Free(BtlSetup *setup);
PokeParty *BtlSetup_GetParty(BtlSetup *setup, u32 index);
void BtlSetup_SetNet1v1Double(BtlSetup *setup, GameData *gameData, NetHandle *handle, u8 a3, HeapID heapId);
void BtlSetup_SetNet1v1Single(BtlSetup *setup, GameData *gameData, NetHandle *handle, u8 a3, HeapID heapId);
void BtlSetup_SetNetRotation(BtlSetup *setup, GameData *gameData, NetHandle *handle, u8 a3, HeapID heapId);
void BtlSetup_SetNetTriple(BtlSetup *setup, GameData *gameData, NetHandle *handle, u8 a3, HeapID heapId);
void BtlSetup_SetNetMultiVsNet(BtlSetup *setup, GameData *gameData, NetHandle *handle, u8 a3, u8 a4, HeapID heapId);
// Battles against trainers, in the surroundings that SaveBtlFieldStatus saved
void BtlSetup_SetTrainer1v1Single(BtlSetup *setup, GameData *gameData, BtlFieldStatus *status, u32 a3, HeapID heapId);
void BtlSetup_SetTrainer1v1Double(BtlSetup *setup, GameData *gameData, BtlFieldStatus *status, u32 a3, HeapID heapId);
void BtlSetup_SetTrainer2v2(BtlSetup *setup, GameData *gameData, BtlFieldStatus *status, u32 a3, u32 a4, u32 a5,
                            HeapID heapId);
void BtlSetup_SetTrainer1v2(BtlSetup *setup, GameData *gameData, BtlFieldStatus *status, u32 trainerId, u32 trainerId2,
                            HeapID heapId);
void BtlSetup_SetTrainer3v3(BtlSetup *setup, GameData *gameData, BtlFieldStatus *status, u32 a3, HeapID heapId);
void BtlSetup_SetTrainerRotation(BtlSetup *setup, GameData *gameData, BtlFieldStatus *status, u32 a3, HeapID heapId);
// A multi battle of two linked players against trainers
void BtlSetup_SetNetMultiVsAI(BtlSetup *setup, GameData *gameData, NetHandle *handle, u8 a3, u8 a4, u32 a5, u32 a6,
                              HeapID heapId);
void BtlSetup_PostProcessTrialHouse(BtlSetup *setup);
// The capture demonstration, between the two parties
void BtlSetup_SetCaptureDemo(BtlSetup *setup, GameData *gameData, PokeParty *party, PokeParty *enemyParty,
                             BtlFieldStatus *status, HeapID heapId);
// Changes the levels of the parties for the challenge mode of the zone, which the keys of Unova Link unlock
void adjustPkmLvForChallengeKeys(BtlSetup *setup, GameData *gameData, u16 zoneId);
// Frees what the setup holds and clears it
void BtlSetup_FreeContents(BtlSetup *setup);
void BtlSetup_SetParty(BtlSetup *setup, PokeParty *party, u32 a2);
void BtlSetup_ApplyRegulation(BtlSetup *setup, Regulation *regulation, HeapID heapId);
// Gives a battle's trainer a name buffer and empty words
BtlSetupTrainer *TrainerBattleSetup_Create(HeapID heapId);
// A field status with the default background
void ResetBtlFieldStatus(BtlFieldStatus *status);
void BtlSetup_InitForRecord(BtlSetup *setup, GameData *gameData, HeapID heapId);
void BtlSetup_FreeForRecord(BtlSetup *setup);
void BtlSetup_AllocRecBuffer(BtlSetup *setup, HeapID heapId);
void BattleRec_Init(HeapID heapId);
void freeVSPlayerBlkClearPtr(void);

#if defined(WHITE2) && defined(W2U_SHARED_BATTLE) && !defined(BLACK2)
// Stops on unexpected completion ownership/invariant failure without following any battle owner.
// This is not the controlled DATA/CAPACITY path and does not promise heap recovery.
void W2U_BtlSetupCompletionFatal(void);
#endif

#if defined(WHITE2) && defined(W2U_SHARED_BATTLE) && !defined(BLACK2)
// Metadata only: keys require a live setup, never a freed or serialized one.
// Outputs use separate typed storage. Rejection leaves outputs unchanged.
// A copy output cannot be the same carrier stored in setup.
BOOL W2U_BtlSetupCompletionBegin(BtlSetup *setup, W2UBattleCompletionKey *key);
BOOL W2U_BtlSetupCompletionRead(const W2UBattleCompletionKey *key, W2UBattleCompletion *copy);
BOOL W2U_BtlSetupCompletionReportFault(const W2UBattleCompletionKey *key, u32 reason);
BOOL W2U_BtlSetupCompletionClear(const W2UBattleCompletionKey *key);
// Copy before native reset/free; only the carrier fields are cleared here.
BOOL W2U_BtlSetupCompletionCopyFaultAndClear(const W2UBattleCompletionKey *key, W2UBattleCompletion *copy);
#endif

#endif // POKEBW2_BATTLE_BTL_SETUP_H
