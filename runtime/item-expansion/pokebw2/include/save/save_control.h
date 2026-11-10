#ifndef POKEBW2_SAVE_SAVE_CONTROL_H
#define POKEBW2_SAVE_SAVE_CONTROL_H

#include "types.h"
#include "gfl/heap.h"
#include "nitro/fx.h"
#include "nitro/rtc.h"
#include "save/memory_link_savedata.h"
#include "save/player_savedata.h"
#include "save/playtime.h"
#include "save/timesig_savedata.h"
#include "save/trainer_data_savedata.h"
#include "struct_decls.h"

// The game's save (save_control.c, the ROM's name): the main save with its backup copy, and the extra saves that
// follow it on the card, each loaded on its own. Names from swan (https://github.com/ds-pokemon-hacking/swan,
// GPL-3.0) where the functions have them; the fields' names are ours, except sv_extra, which an assert names

// The main save's blocks. The files that own a block define its ID again, with the same value
#define SAVE_BLOCK_BOX_MAIN 0
// The first of the 24 trays
#define SAVE_BLOCK_BOX_TRAY 1
#define SAVE_BLOCK_BAG 0x19
#define SAVE_BLOCK_PARTY 0x1a
#define SAVE_BLOCK_TRAINER_DATA 0x1b
#define SAVE_BLOCK_PLAYER 0x1c
#define SAVE_BLOCK_UNITY_TOWER_SURVEY 0x1d
#define SAVE_BLOCK_WIFI_LIST 0x1e
#define SAVE_BLOCK_PAL_PAD 0x1f
#define SAVE_BLOCK_CGEAR 0x20
#define SAVE_BLOCK_TIMESIG 0x21
#define SAVE_BLOCK_MYSTERY_GIFT 0x22
#define SAVE_BLOCK_DREAM_WORLD 0x23
#define SAVE_BLOCK_CHATTER 0x24
#define SAVE_BLOCK_ADVENTURE 0x25
#define SAVE_BLOCK_RECORDS 0x26
#define SAVE_BLOCK_PMS 0x27
#define SAVE_BLOCK_MAIL 0x28
#define SAVE_BLOCK_FIELD_ACTORS 0x29
#define SAVE_BLOCK_MUSICAL 0x2a
#define SAVE_BLOCK_RESH_ZEK 0x2b
#define SAVE_BLOCK_TRAINER_LOG 0x2c
#define SAVE_BLOCK_EVENT_WORK 0x2d
#define SAVE_BLOCK_WORLDTRADE 0x2e
#define SAVE_BLOCK_TOURNAMENT 0x2f
#define SAVE_BLOCK_GIMMICK 0x30
#define SAVE_BLOCK_BATTLE_BOX 0x31
#define SAVE_BLOCK_DAY_CARE 0x32
#define SAVE_BLOCK_STRENGTH_ROCKS 0x33
#define SAVE_BLOCK_TRAINER_GAME_INFO 0x34
#define SAVE_BLOCK_HIGH_LINK 0x35
#define SAVE_BLOCK_POKEDEX 0x36
#define SAVE_BLOCK_ENCOUNT 0x37
#define SAVE_BLOCK_BSUBWAY_PLAY 0x38
#define SAVE_BLOCK_BSUBWAY_SCORE 0x39
#define SAVE_BLOCK_BSUBWAY_3A 0x3a
#define SAVE_BLOCK_RECORD 0x3b
#define SAVE_BLOCK_SYMBOL 0x3c
#define SAVE_BLOCK_SURVEY 0x3d
#define SAVE_BLOCK_UNITY_TOWER_FLOOR 0x3e
#define SAVE_BLOCK_TRIAL_HOUSE 0x3f
#define SAVE_BLOCK_40 0x40
#define SAVE_BLOCK_TRADED_POKEMON 0x41
#define SAVE_BLOCK_MISC 0x42
#define SAVE_BLOCK_JOIN_AVENUE 0x43
#define SAVE_BLOCK_MEDAL_BOX 0x44
#define SAVE_BLOCK_KEY_DATA 0x45
#define SAVE_BLOCK_FUNFEST 0x46
#define SAVE_BLOCK_POKEWOOD 0x47
#define SAVE_BLOCK_DREAM_RADAR 0x48
#define SAVE_BLOCK_MAX 0x49

// The extra saves, each of one block. Only the Hall of Fame has a backup copy
typedef enum {
    SAVE_EXTRA_ID_BATTLE_REC_0,
    SAVE_EXTRA_ID_BATTLE_REC_1,
    SAVE_EXTRA_ID_BATTLE_REC_2,
    SAVE_EXTRA_ID_BATTLE_REC_3,
    SAVE_EXTRA_ID_CGEAR_PICTURE,
    SAVE_EXTRA_ID_BATTLE_EXAMINATION,
    SAVE_EXTRA_ID_MUSICAL_DIST,
    SAVE_EXTRA_ID_POKEDEX_SKIN,
    SAVE_EXTRA_ID_HALL_OF_FAME,
    // Eight films
    SAVE_EXTRA_ID_POKEWOOD_0,
    // Three downloaded tournaments
    SAVE_EXTRA_ID_TOURNAMENT_0 = 17,
    SAVE_EXTRA_ID_TOURNAMENT_1,
    SAVE_EXTRA_ID_TOURNAMENT_2,
    // A block of 0xc8 bytes
    SAVE_EXTRA_ID_20,
    SAVE_EXTRA_ID_MAX
} SaveExtraID;

// What SaveControl_GetErrors returns: the main save had a block that only one copy had right, or was broken and has
// been initialized. An extra save that could not be loaded has the bit of its ID above them, and the data outside the
// save the last two
#define SAVE_CONTROL_ERROR_PARTIAL 0x1
#define SAVE_CONTROL_ERROR_BROKEN 0x2
#define SAVE_CONTROL_ERROR_EXTRA(extraId) (1 << ((extraId) + 2))
#define SAVE_CONTROL_ERROR_GIFTS_BROKEN 0x800000
#define SAVE_CONTROL_ERROR_KEYS_BROKEN 0x1000000

struct SaveControl {
    // No save was loaded, so the game starts anew
    u8 newGame;
    // The card holds a save
    u8 dataExists;
    // Cleared when both copies of the save loaded right
    u8 unk2;
    // TrainerDataSave_IsIntroSave at the start of a save, which canceling restores
    u8 wasIntroSave;
    // What SaveOutside told of the data outside the save
    u8 giftsLoaded;
    u8 giftsBroken;
    u8 keysLoaded;
    u8 keysBroken;
    // The next save calls DreamRadar_MarkRead, which marks Dream Radar's data on the card as read
    u8 markDreamRadarRead;
    u32 errors;
    SaveData *sv;
    SaveData *sv_extra[SAVE_EXTRA_ID_MAX];
    MemoryLinkSave *memoryLink;
}; // size: 0x6c

// Loads the save, its extra saves' state and the data outside the save
SaveControl *SaveControl_Create(HeapID heapId);
SaveControl *SaveControl_GetInstance(void);
// Frees the save data and its control
void SaveControl_Free(void);
EncountSave *SaveControl_GetEncountSave(SaveControl *save);
u32 SaveControl_LoadExtraBlock(SaveControl *save, u32 block, HeapID heapId, void *buffer, u32 size);
// The save data Game Sync uploads, and its size
void *SaveControl_GetUploadData(SaveControl *save, u32 *size);
// The sizes of a downloaded C-Gear skin and Pokédex skin, and a Pokédex skin block's valid flag
u32 CGearPictureSave_GetSize(void);
u32 PokedexSkinSave_GetSize(void);
void PokedexSkinSave_SetValid(void *block, u32 valid);
// A Pokédex skin block's characters and palette, and whether it is valid
void *PokedexSkinSave_GetChars(void *block);
void *PokedexSkinSave_GetPalette(void *block);
BOOL PokedexSkinSave_IsValid(void *block);
// Reads the downloaded musical's save block (6) into a new work, its archive and the archive's size, and frees it
void *MusicalDist_Load(GameData *gameData, HeapID heapId);
void MusicalDist_Free(void *work);
void *MusicalDist_GetData(void *work);
u32 MusicalDist_GetDataSize(void *work);
// Imports a downloaded musical, a step a frame until it returns TRUE
void *MusicalDist_StartWrite(GameData *gameData, void *data, u32 size, HeapID heapId);
BOOL MusicalDist_WriteStep(void *work);
void *getAddressOfExtraSaveBlk(SaveControl *save, u32 block, u32 arg2);
void freeIntermediateSaveExtraBlksAfterLoad2(SaveControl *save, u32 block);
u32 SaveControl_GetStatus(SaveControl *save);
void SaveControl_GetChangedSize(SaveControl *save, u32 *changed, u32 *total);
// The bytes written so far of the save in progress, SaveData_GetBytesWritten of the save's SaveData
u32 SaveControl_GetBytesWritten(SaveControl *save);
u32 SaveControl_GetErrors(SaveControl *save);
void SaveControl_InitNewGame(SaveControl *save);
// Loads the save again, returning a SAVE_LOAD_RESULT_*
u32 SaveControl_Reload(SaveControl *save);
TrainerGameInfoSave *getTrainerGameInfoAddress(SaveControl *save);
u16 TrainerGameInfo_GetSurveyRank(TrainerGameInfoSave *info);
void TrainerGameInfo_SetSurveyRank(TrainerGameInfoSave *info, u32 value);
// The name at the end of the C-Gear block, its init and its getter
void CGearName_Init(u16 *name);
void *CGearName_GetFromSave(SaveControl *save);
const u16 *TrainerGameInfo_GetGreeting(TrainerGameInfoSave *info);
void TrainerGameInfo_SetGreeting(TrainerGameInfoSave *info, StrBuf *name);
const u16 *TrainerGameInfo_GetThanks(TrainerGameInfoSave *info);
void TrainerGameInfo_SetThanks(TrainerGameInfoSave *info, StrBuf *name);
void CGearName_Set(void *saveBlock, StrBuf *name);
const u16 *CGearName_Get(void *saveBlock);
u16 TrainerGameInfo_GetSurveyQuestion(TrainerGameInfoSave *info);
u16 TrainerGameInfo_GetSurveyAnswer(TrainerGameInfoSave *info, u8 index);
// Adds to a survey question's count, up to 0xffff
void TrainerGameInfo_AddSurveyCount(TrainerGameInfoSave *info, u8 index, u16 count);
// Poké Transfer's high score, 28 bits
u32 TrainerGameInfo_GetPalParkHighScore(TrainerGameInfoSave *info);
void TrainerGameInfo_SetPalParkHighScore(TrainerGameInfoSave *info, u32 score);
// How the last Poké Transfer session ended, 4 bits, which the Poké Transfer Lab's scripts react to
u8 TrainerGameInfo_GetPalParkResult(TrainerGameInfoSave *info);
void TrainerGameInfo_SetPalParkResult(TrainerGameInfoSave *info, u8 result);
u32 getCash(TrainerGameInfoSave *info);
u32 addCashToTotal(TrainerGameInfoSave *info, u32 amount);
// Stops at 0
u32 subCashFromTotal(TrainerGameInfoSave *info, u32 amount);

// The area NPC data, which keeps the symbol encounters of the Entree Forest, encrypted
AreaNPCSave *getAreaNPCData(SaveControl *save);
void decryptNpcData(AreaNPCSave *npcData);
void SymbolSave_Decrypt(AreaNPCSave *npcData);
u32 SymbolSave_FindFreeSlot(AreaNPCSave *npcData, u32 kind);
u32 SymbolSave_GetKindOfSlot(u32 index);
void SymbolSave_RemoveSlot(AreaNPCSave *npcData, u32 index);
// Whether the Entree Forest Pokémon, packed as EntreeForestPokemon is, is valid, checking its form when check is set
BOOL SymbolSave_HasPokemon(SaveControl *save, u32 *pokemon, HeapID heapId, BOOL check);
void SymbolSave_UpdateDeepestArea(AreaNPCSave *npcData, u16 index);
// Puts a Pokémon from the Dream World in the Entree Forest: its species, a2, sex and form, a5 below 9, and size 2 for
// a big overworld sprite or 3
void SymbolSave_AddPokemon(AreaNPCSave *npcData, u16 species, u16 a2, u8 sex, u8 form, u8 a5, u32 size);

// Returns a pointer to one of the save's blocks
void *SaveControl_GetBlockPtr(SaveControl *save, u32 block);
u32 BattleRec_IsSlotValid(SaveControl *save, HeapID a1, void *a2, u32 a3);
u32 BattleRec_FinishAndSaveSlot(GameData *gameData, HeapID a1, u32 a2, u32 a3, u32 a4, u16 *a5, u16 *a6);
u32 BattleRec_IsVersionSupported(u8 a0);
void BattleRec_LoadToolOverlay(void);
void BattleRec_UnloadToolOverlay(void);

// Save block 0x45, which swan calls the key data. It keeps the Black Tower's and White Treehollow's progress, and the
// Trainers there that have been defeated (CheckTrainerAlreadyDefeated)
KeyDataSave *getKeyDataBlkAddress(SaveControl *save);
void KeyDataSave_ClearRun(KeyDataSave *keyData);
u8 KeyDataSave_GetProgress(KeyDataSave *keyData, u32 a1);
u32 KeyDataSave_GetSeed(KeyDataSave *keyData);
BOOL KeyDataSave_IsTrainerDefeated(KeyDataSave *keyData, u32 a1, u32 bit);
u16 KeyDataSave_CountDefeatedTrainers(KeyDataSave *keyData);
u8 func_020102d0(KeyDataSave *keyData);
u8 KeyDataSave_GetFloorInArea(KeyDataSave *keyData);
u8 KeyDataSave_GetRoom(KeyDataSave *keyData);
void KeyDataSave_SetProgress(KeyDataSave *keyData, u8 value, u32 a2);
void KeyDataSave_SetSeed(KeyDataSave *keyData, u32 value);
void KeyDataSave_SetTrainerDefeated(KeyDataSave *keyData, u32 a1, u32 bit, BOOL set);
void func_02010334(KeyDataSave *keyData, u8 value);
void KeyDataSave_SetFloor(KeyDataSave *keyData, u8 value);
void KeyDataSave_SetRoom(KeyDataSave *keyData, u8 value);
BOOL KeyDataSave_IsFlagSet(KeyDataSave *keyData, u32 bit);
void KeyDataSave_SetFlag(KeyDataSave *keyData, u32 bit, BOOL set);
u8 KeyDataSave_GetArea(KeyDataSave *keyData);
u8 KeyDataSave_GetAreaFirstFloor(int a0);
u8 KeyDataSave_GetAreaFloorCount(u8 a0);
u32 KeyDataSave_GetMoney(KeyDataSave *keyData);
void KeyDataSave_SetMoney(KeyDataSave *keyData, u32 value);

// Save block 0x42, which keeps the rival's name
RivalDataSave *getHollow_RivalData(SaveControl *save);
// Save block 0x42, and setting a byte of it
void *getHollow_RivalBlk(SaveControl *save);
void HollowRivalSave_SetMeetingToday(void *rival, u32 value);
// The rival's hollow data: a value of an index, a flag of an index, and the hollows visited
void HollowRivalSave_SetValue(void *block, u32 index, u16 value);
u16 HollowRivalSave_GetValue(void *block, u16 index);
void HollowRivalSave_SetFlag(void *block, u16 index, u32 value);
void HollowRivalSave_ClearMeeting(void *block);
u16 HollowRivalSave_GetMeeting(void *block);
void HollowRivalSave_SetHasSpecies(void *block, u32 value);
void HollowRivalSave_SetSpecies(void *block, u16 value);
void HollowRivalSave_SetMet(void *block, u32 value);
BOOL func_0200ffd4(void *block, int index);
// The C-Gear's save block (getCGearDataBlkAddress)
// Copies the C-Gear's record at index, 4 u16
void Misc_AddMetTrainer(RivalDataSave *rivalData, u32 id);
void copyRivalNameIntoHollowBlock(RivalDataSave *data, const u16 *name);
const u16 *getPtrToRivalName(RivalDataSave *data);
u32 TrainerGameInfo_GetStartMenuFlags(TrainerGameInfoSave *info);
void TrainerGameInfo_SetStartMenuFlags(TrainerGameInfoSave *info, u32 value);
u32 TrainerGameInfo_GetKeyNotice(TrainerGameInfoSave *info);
void TrainerGameInfo_SetKeyNotice(TrainerGameInfoSave *info, u32 value);
u32 getBadgeCount(TrainerGameInfoSave *info);
// Two bits for each of the start menu's items that are added later: TrainerGameInfo_AddStartMenuItemFlags sets bits,
// and TrainerGameInfo_GetStartMenuItemFlags returns them. 1 marks the item as new
void TrainerGameInfo_AddStartMenuItemFlags(TrainerGameInfoSave *info, u32 item, u32 bits);
u8 TrainerGameInfo_GetStartMenuItemFlags(TrainerGameInfoSave *info, u32 item);
BOOL SaveControl_IsDataAlreadyPresent(SaveControl *save);
// Whether the save is of another game, which the report may not overwrite
BOOL SaveControl_IsNewGameOverSave(SaveControl *save);

// Saving a step at a time: SaveControl_StartSave starts, SaveControl_ContinueSave continues and returns the status, and
// SaveControl_CancelSave cancels
void SaveControl_StartSave(SaveControl *save);
u32 SaveControl_ContinueSave(SaveControl *save);
void SaveControl_CancelSave(SaveControl *save);
// The same for one block: SaveControl_StartExtraSave starts and SaveControl_ContinueExtraSave continues
void SaveControl_StartExtraSave(SaveControl *save, u32 block);
u32 SaveControl_ContinueExtraSave(SaveControl *save, u32 block);
// Four flags of the save control, at 4 to 7
u8 SaveControl_GetGiftsLoaded(SaveControl *save);
void SaveControl_SetGiftsLoaded(SaveControl *save, u32 value);
u8 SaveControl_GetGiftsBroken(SaveControl *save);
void SaveControl_SetGiftsBroken(SaveControl *save, u32 value);
u8 SaveControl_GetKeysLoaded(SaveControl *save);
void SaveControl_SetKeysLoaded(SaveControl *save, u32 value);
u8 SaveControl_GetKeysBroken(SaveControl *save);
void SaveControl_SetKeysBroken(SaveControl *save, u32 value);
// Used to delete the save data: SaveControl_OpenExtraBlock tells whether a block is in the save, and
// SaveControl_ClearExtraBlock clears it
void SaveControl_Erase(SaveControl *save);
u32 SaveControl_OpenExtraBlock(SaveControl *save, u32 block, HeapID heapId);
void SaveControl_InitExtraBlock(SaveControl *save, u32 block, u32 heapId, void *buffer, u32 size);
// Reads one of the two copies of a block from the card
BOOL SaveControl_ReadBlockCopy(SaveControl *save, u32 block, u32 copy, void *dest, u32 size);
void SaveControl_ClearExtraBlock(SaveControl *save, u32 block, HeapID heapId);
void freeIntermediateSaveExtraBlksAfterLoad(SaveControl *save, u32 block);
void DreamRadar_EraseSaveData(HeapID heapId);

DreamRadarSave *GetDreamRadarSaveBlock(SaveControl *save);
JoinAvenueSave *SaveControl_GetJoinAvenue(SaveControl *save);
EventWork *getConstDataBlock(SaveControl *save);
PokeDexSave *getPokedexSaveAddress(SaveControl *save);
PokeParty *SaveControl_GetPokePartySave(SaveControl *save);
WorldTradeData *SaveControl_GetWorldTradeData(SaveControl *save);
DreamWorldSave *getDreamWorldStuffAddress(SaveControl *save);
HighLinkSave *getHighLinkBlockAddress(SaveControl *save);
void *FestRecords_GetFromSave(SaveControl *save);
// The Funfest mission records of FestRecords_GetFromSave's block: missions hosted, joined and completed, the most
// participants and the best score
u16 FestRecords_GetHosted(void *a0);
u16 FestRecords_GetJoined(void *a0);
// Count one more mission hosted and joined, up to 9999, and return the new count
u16 FestRecords_AddHosted(void *records);
u16 FestRecords_AddJoined(void *records);
u16 FestRecords_GetCompleted(void *a0);
u8 FestRecords_GetMostParticipants(void *a0);
u16 FestRecords_GetTopScores(void *a0);
// A Funfest mission's record in FestRecords_GetFromSave's block, by the mission's index, which is 0 for an index past
// the missions: a 14-bit count, another count, the highest level cleared (0 to 4) and whether the mission is new, which
// FestRecords_ClearMissionNew clears
u16 FestRecords_GetMissionCount(void *records, u8 mission);
u16 FestRecords_GetMissionBest(void *records, u8 mission);
u32 FestRecords_GetMissionLevel(void *records, u8 mission);
BOOL FestRecords_IsMissionNew(void *records, u8 mission);
void FestRecords_ClearMissionNew(void *records, u8 mission);
KeyInfoSave *getKeyInfoSaveBlk(SaveControl *save);
// Whether a key system key is unlocked
BOOL KeyInfo_IsKeyUnlocked(KeyInfoSave *keyInfo, u32 key);
RecordSave *getRecordBlkAddress(SaveControl *save);
AdventureSave *getSaveAdventureDataBlk(SaveControl *save);
AdventureTime *getSaveAdventureTimeBlock(SaveControl *save);
TrainerCardSave *getTrainerCardDataBlkAddress(GameData *gameData);
// The same block as GameData_GetRecords
GameRecords *getTrainerCardInfoBlkAddress(SaveControl *save);
UnityTowerSurveySave *getUnityTower_SurveySaveBlkAddrress(SaveControl *save);

#endif // POKEBW2_SAVE_SAVE_CONTROL_H
