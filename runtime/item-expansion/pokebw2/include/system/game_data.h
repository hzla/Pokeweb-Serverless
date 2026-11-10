#ifndef POKEBW2_SYSTEM_GAME_DATA_H
#define POKEBW2_SYSTEM_GAME_DATA_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"

// The city of the player's version, which a key from Unova Link can switch
#define CITY_BLACK_CITY 0
#define CITY_WHITE_FOREST 1

// What GameData_MakeBoxPkm makes a Pokémon from
struct BoxPkmCreateParams {
    u16 heapId;
    u16 pad;
    u32 species;
    u32 form;
    u32 level;
    u32 item;
    s32 ability;
    s32 sex;
    s32 param1C;
    u32 ball;
    BOOL hiddenAbility;
};

struct CityState {
    u16 initialized;
    u16 city;
};

void SetAllowVersionSpecificZone(u32 side, u32 allow);
void CityState_ApplyVersionZones(CityState *state);
void CityState_Init(CityState *state);
BOOL func_ov012_0215cd98(s32 value);

GameData *GameData_Create(HeapID heapId);
void GameData_Free(GameData *gameData);
BOOL GameData_CheckPairFlag(GameData *gameData);
BagSave *GameData_GetBag(GameData *gameData);
BGMInfo *GameData_GetBGMInfo(GameData *gameData);
void *GameData_GetBagCursor(GameData *gameData);
BoxSaveAccessor *GameData_GetBoxSaveAccessor(GameData *gameData);
ZoneSpawnInfo *GameData_GetEntralinkParentSpawnInfo(GameData *gameData);
ZoneSpawnInfo *GameData_GetEscapeRopeZone(GameData *gameData);
EventData *GameData_GetEventData(GameData *gameData);
EventWork *GameData_GetEventWork(GameData *gameData);
// The Royal Unova's cruise while the player is aboard, or NULL
PleasureBoat **GameData_GetPleasureBoatPtr(GameData *gameData);
FieldSound *GameData_GetFieldSoundSystem(GameData *gameData);
FieldStatus *GameData_GetFieldStatus(GameData *gameData);
GimmickState *GameData_GetGimmickState(GameData *gameData);
JoinAvenuePersonList **GameData_GetJoinAvenuePersonListPtr(GameData *gameData);
u32 GameData_GetLastSubscreen(GameData *gameData);
MMSys *GameData_GetMMSys(GameData *gameData);
CityState *GameData_GetMyCityState(GameData *gameData);
// Adds seconds to the play time
void GameData_UpdateTime(GameData *gameData, u32 seconds);
// The levels that unlock the pass powers, which PassPowerLevel_GetWhite and PassPowerLevel_GetBlack read
void *GameData_GetMyPassPowerLevels(GameData *gameData);
u16 GameData_GetMyCity(GameData *gameData);
// The C-Gear power request, which GameData_SaveCGearPowerRequest puts aside
u8 GameData_GetCGearPowerRequest(GameData *gameData);
void GameData_SetCGearPowerRequest(GameData *gameData, u8 value);
// The field menu item selected last
u8 GameData_GetFieldMenuItem(GameData *gameData);
// Save block 0x39, the Battle Subway's scores
BSubwayScoreData *GameData_GetBSubwayScoreData(GameData *gameData);
BSubwayScrWork *GameData_GetBSubwayScrWork(GameData *gameData);
u8 GameData_GetCounter(GameData *gameData);
// Adds one to a counter of the game data, to at most 99
void GameData_IncCounter(GameData *gameData);
void GameData_ResetCounter(GameData *gameData);
void GameData_CancelSave(GameData *gameData);
// Starts saving, and runs the save, returning 2 once it ends
void GameData_StartSave(GameData *gameData);
int GameData_UpdateSave(GameData *gameData);
void *getChatterDataAddress(GameData *gameData);
MusicalSave *getMusicalInfoBlkAddress(GameData *gameData);
ZoneSpawnInfo *GameData_GetNextZone(GameData *gameData);
PokeParty *GameData_GetParty(GameData *gameData);
PlayerState *GameData_GetPlayerState(GameData *gameData);
void *getTimeSigSaveBlock(GameData *gameData);
PlayerState *GameData_GetPlayerStateByNetID(GameData *gameData, s32 index);
PokeDexSave *GameData_GetPokedex(GameData *gameData);
PalPadFriendList *GameData_GetPalPadFriendList(GameData *gameData);
// Whether the key item is registered to Y, and registers it or not
BOOL GameData_IsShortcutRegistered(GameData *gameData, u32 item);
void GameData_SetKeyItemRegistration(GameData *gameData, u32 item, BOOL registered);
GameRecords *GameData_GetRecords(GameData *gameData);
BOOL GameData_AddBoxPkm(GameData *gameData, BoxPkmCreateParams *params);
BOOL addPkmToParty(GameData *gameData, BoxPkmCreateParams *params);
PartyPkm *GameData_MakeBoxPkm(GameData *gameData, BoxPkmCreateParams *params);
// Whether a full day has passed since the last check
BOOL checkForMidnight(GameData *gameData);
SaveControl *GameData_GetSaveControl(GameData *gameData);
void *GameData_GetShortcutMenuPos(GameData *gameData);
// The support another player gave over communication (system/comm_player_support.h)
CommPlayerSupport *GameData_GetCommPlayerSupport(GameData *gameData);
// Save block 0x41, the Pokémon traded in game, which save/traded_pokemon.h reads
void *GetTradedPokemonBlock(GameData *gameData);
SaveControl *GameData_GetSaveControl_(GameData *gameData);
BeaconStatus *GameData_GetBeaconStatus(GameData *gameData);
DreamWorldSave *GameData_GetDreamWorldSave(GameData *gameData);
u8 GameData_GetSeason(GameData *gameData);
void GameData_SetSeason(GameData *gameData, u8 season);
u8 GameData_GetEntreeForestArea(GameData *gameData);
// Sets the area of the Entree Forest the player is in, which GameData_GetEntreeForestArea returns
void GameData_SetEntreeForestArea(GameData *gameData, u8 area);
u16 GameData_GetDayPeriod(GameData *gameData);
u32 GameData_GetMonth(GameData *gameData);
u32 GameData_GetDay(GameData *gameData);
u32 getCurrentDayOfWeek(GameData *gameData);
u32 getCurrentHour(GameData *gameData);
u32 getCurrentMinute(GameData *gameData);
WifiList *GameData_GetWifiList(GameData *gameData);
void GameData_InitEncountTerrain(GameData *gameData, Field *field);
EncountState *GameData_GetEncountState(GameData *gameData);
BOOL GameData_IsForceSeasonSync(GameData *gameData);
BOOL GameData_IsLensFlareRequested(GameData *gameData);
void GameData_RestoreCGearPowerRequest(GameData *gameData);
void GameData_SaveCGearPowerRequest(GameData *gameData);
void GameData_SetEntralinkParentSpawnInfo(GameData *gameData, ZoneSpawnInfo *spawn);
void GameData_SetEscapeRopeZone(GameData *gameData, ZoneSpawnInfo *spawn);
void GameData_SetForceSeasonSync(GameData *gameData, BOOL force);
void GameData_SetLastSubscreen(GameData *gameData, u8 subscreen);
void GameData_SetLastBtlResult(GameData *gameData, u32 result);
u32 GameData_GetLastBtlResult(GameData *gameData);
void GameData_SetLensFlareRequested(GameData *gameData, BOOL requested);
// Whether a Funfest mission is running, which plays its BGM everywhere (a guess from that use)
BOOL GameData_IsFunfestMission(GameData *gameData);
// Sets whether a Funfest mission is running
void GameData_SetFunfestMission(GameData *gameData, BOOL flag);
u32 GameData_GetLensFlareEntryIdx(GameData *gameData);
void GameData_SetFieldMenuItem(GameData *gameData, u8 value);
void GameData_SetLensFlareEntryIdx(GameData *gameData, u32 index);
void GameData_SetNextZone(GameData *gameData, ZoneSpawnInfo *spawn);
ZoneSpawnInfo *GetGameDataNowSpawnZone(GameData *gameData);
PlayerInfo *GetGameDataPlayerInfo(GameData *gameData);
MapMatrix *GetMapMatrixSystem(GameData *gameData);
ZoneSpawnInfo *GetOutboundWarpRememberSpawnInfo(GameData *gameData);
void SetGameDataOutboundWarpRememberInfo(GameData *gameData, ZoneSpawnInfo *spawn);
u16 GetReturnLocationIdx(GameData *gameData);
void SetCurrentTeleportOrDeathZone(GameData *gameData, u16 respawnLocation);
void SetGameDataNowSpawnZone(GameData *gameData, ZoneSpawnInfo *spawn);
PlayerInfo *GameData_GetPlayerInfoByNetID(GameData *gameData, u32 netId);
// The player's net ID
u8 GameData_GetNetID(GameData *gameData);
// The number of players
u8 GameData_GetPlayerCount(GameData *gameData);
// The net ID of the player whose beacon is shown
u8 GameData_GetBeaconNetID(GameData *gameData);
// The player's Entralink levels, as GameData_GetMyPassPowerLevels returns for the player's own
void *GameData_GetPassPowerLevels(GameData *gameData, u32 netId);
void GameData_SetPlayerCount(GameData *gameData, u32 a1);
void GameData_SetNetID(GameData *gameData, u32 a1);
void GameData_SetBeaconNetID(GameData *gameData, u32 a1);
// Whether the game shows other players' beacons
BOOL GameData_IsCGearOn(GameData *gameData);
void GameData_StartSaveBlock(GameData *gameData, u32 block);
u32 GameData_UpdateSaveBlock(GameData *gameData, u32 block);
void GameData_SetBSubwayScrWork(GameData *gameData, BSubwayScrWork *bsw);
// Where Pokéstar Studios keeps its PokewoodSystem while the player makes a movie
PokewoodSystem **GameData_GetPokewoodSystemPtr(GameData *gameData);
// Where the Pokémon World Tournament keeps its WbtSystem while the player is at the tournament
WbtSystem **GameData_GetWbtSystemPtr(GameData *gameData);
// The Pokémon World Tournament's save data
void *GameData_GetWbtSave(GameData *gameData);
// The save's play time
PlayTime *GameData_GetPlayTime(GameData *gameData);
void GameData_SetJoinAvenueSeason(GameData *gameData, u8 a1);
ResortWork *GameData_GetResortWork(GameData *gameData);
u32 GetScrPluginNo(GameData *gameData);
void SetScrPluginNo(GameData *gameData, u32 pluginNo);

Calendar *GetCalendar(GameData *gameData);
void SetNowWeather(GameData *gameData, u8 weather);
u32 GetNowWeather(GameData *gameData);
BOOL GameData_CheckEventsPaused(GameData *gameData);
// The Battle Subway's save data
void *GameData_GetBSubwayWifiData(GameData *gameData);
// Where the Trial House work is kept
TrialHouseWork **GetTrialHouseWkPPtr(GameData *gameData);
// The follower of field/pair_sys.h
FieldFollowWk *GetFieldFollowerCfg(GameData *gameData);
void GameData_ResetSkipFrame(GameData *gameData);
void GameData_Set30FPSMode(GameData *gameData, BOOL enable);
u8 GameData_Is30FPSSkipFrame(GameData *gameData);
BOOL GameData_Is30FPSMode(GameData *gameData);
u32 getCurrentStepTotal(GameData *gameData);
void setCurrentStepTotal(GameData *gameData, u32 stepTotal);
// Set by the battle input when the player uses the keys, kept between battles
void GameData_SetBattleKeyCursorFlag(GameData *gameData, u8 value);
u8 GameData_GetBattleKeyCursorFlag(GameData *gameData);
// Sets the option that GameData_IsCGearOn returns
void GameData_SetCGearOn(GameData *gameData, BOOL flag);
// Save block 0x40, the Hall of Fame team
void *GameData_GetHallOfFameTeam(GameData *gameData);
// Draws three different zones of fifteen that the secret calls can be made from, and whether a zone is one of them
void GameData_DrawSecretCallZones(GameData *gameData);
BOOL GameData_IsSecretCallZone(GameData *gameData, u32 value);
// The medal under the Medal Box cursor, 0xff at first, and the season of the Join Avenue areas
void GameData_SetMedalBoxCursorMedal(GameData *gameData, u8 value);
u8 GameData_GetMedalBoxCursorMedal(GameData *gameData);
u8 GameData_GetJoinAvenueSeason(GameData *gameData);
CityState *GameData_GetCityState(GameData *gameData, u32 index);

#endif // POKEBW2_SYSTEM_GAME_DATA_H
