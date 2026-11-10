#ifndef POKEBW2_SYSTEM_GAME_BEACON_H
#define POKEBW2_SYSTEM_GAME_BEACON_H

#include "types.h"
#include "gfl/heap.h"
#include "save/join_avenue.h"
#include "struct_decls.h"

// Names from swan (https://github.com/ds-pokemon-hacking/swan, GPL-3.0), except the GameBeaconSys_*, GameBeacon_* and
// GameBeaconSendSlot_* names and the types' names, which are ours. The global GameBeaconSys is named after the ROM's
// assertion "GameBeaconSys == NULL"; swan calls it g_GameBeaconSys

// The game's beacons (game_beacon.c): the beacon this game sends, which tells other games what the player is doing,
// and a log of the beacons received from them

// How many received beacons the log keeps
#define GAME_BEACON_LOG_MAX 30
// The characters of a beacon's free text
#define GAME_BEACON_TEXT_LEN 10
// The beacon types are below this
#define GAME_BEACON_TYPE_MAX 0x68
// A beacon's passPower when no Pass Power is active
#define GAME_BEACON_PASS_POWER_NONE 0x30
// A beacon's recentKind when it has no recent event
#define GAME_BEACON_RECENT_NONE 5

// What a beacon's type sends
typedef union {
    // A value (an item, a move, a Pass Power, a number of hours)
    u16 value;
    // Free text, such as a nickname
    u16 text[GAME_BEACON_TEXT_LEN];
    // Type 0x18: a message to one trainer
    struct {
        u16 text[9];
        u16 trainerId;
    } message;
    // Types 0x19, 0x1a, 0x1b and 0x32: a distribution, which key identifies
    struct {
        u16 species;
        u16 item;
        u16 passPower;
        u16 unk06;
        u32 key;
    } gift;
    // Types 0x3c to 0x67: the Funfest mission's data (LinkFestival_FillMissionInfo), and for type 0x67 a text
    struct {
        u32 unk00;
        u16 text[8];
    } mission;
    // A Join Avenue visitor's shop choice and extra data, of the type's argument (JoinAvenueVisitor_StoreInBeacon)
    JoinAvenueBeaconPayload avenue;
    // The other views overlay 12's game_beacon_set.c fills its messages through
    u32 value32;
    u8 value8;
    struct {
        u8 a;
        u8 b;
    } pair;
    struct {
        u16 value;
        u8 extra;
    } withExtra;
    struct {
        u16 name[9];
        u16 value;
    } named;
    struct {
        u16 name[9];
        u8 value;
    } namedByte;
} GameBeaconPayload;

struct GameBeacon {
    // A bit for each game version that may receive it, (version - VERSION_WHITE)
    u8 targetVersions;
    u8 country;
    u8 region;
    u8 passPower : 7;
    u8 gender : 1;
    // The sender's passerby count (TrainerCard_GetPasserbyCount)
    u32 passerbyCount : 17;
    u32 zoneId : 10;
    u32 language : 5;
    // The sender's thanked count (TrainerCard_GetThankedCount)
    u32 thankedCount : 17;
    // Incremented each time the beacon changes, so that receivers tell a new beacon from one already seen
    u32 serial : 5;
    u32 parentZoneId : 10;
    u32 version : 6;
    u32 trainerView : 3;
    u32 surveyRank : 3;
    u32 favoriteColor : 4;
    u32 playHours : 10;
    u32 playMinutes : 6;
    u16 trainerId;
    u16 name[7];
    u16 greeting[8];
    u16 type;
    union {
        u16 value;
        struct {
            u16 missionId : 14;
            u16 unk : 2;
        } mission;
    } arg;
    GameBeaconPayload payload;
    // The last notable event: a species (kinds 0 and 1), a trainer (kinds 2 to 4), or GAME_BEACON_RECENT_NONE
    u16 recentKind : 8;
    u16 cgear0 : 3;
    u16 cgear1 : 5;
    u16 cgear2;
    u16 cgear3;
    u16 recentValue;
    u8 surveyAnswers[10];
    u8 medalCount;
    // The sender's favorite medal, 0xff for none
    u8 favoriteMedal;
    u32 missionWord;
};

// When a received beacon arrived; copied as one halfword
typedef union {
    u16 raw;
    struct {
        u8 minute;
        u8 hour : 7;
        // Whether the sender's survey answers were counted
        u8 surveyCounted : 1;
    };
} GameBeaconTime;

typedef struct {
    GameBeacon beacon;
    // Frames since it was received, up to 0xffff
    u16 age;
    GameBeaconTime time;
} GameBeaconLogEntry;

// The beacon this game sends
typedef struct {
    GameBeacon beacon;
    // Frames in the current type, which reverts to 0 after its lifetime
    s16 timer;
    // Set by every change; GameBeaconSys_SendIfUpdated sends the beacon and clears it
    u8 updated;
} GameBeaconSendSlot;

struct GameBeaconSystem {
    GameSystem *gsys;
    GameData *gameData;
    GameBeaconSendSlot mine;
    GameBeaconLogEntry log[GAME_BEACON_LOG_MAX];
    // A bit for each log entry not yet shown
    u32 newMask;
    u32 recvCount;
    s8 logOldest;
    s8 logNewest;
    s8 logCount;
    u8 surveyUpdated;
    u16 playHours;
    u8 enabled;
    // The Join Avenue advertisement that the beacon sends next, 0 to 6
    u8 avenueAdIndex;
    JoinAvenuePersonList *avenuePeople;
    u8 avenueAdTimer;
    u8 avenueAdRequest;
    u8 noticeFlags;
    u8 avenueVisitorPending;
    // Whether the beacon is sent to Black 2 and White 2 only
    BOOL b2w2Only;
    StrBuf *nameBuf;
    void *avenueWork;
};

extern GameBeaconSystem *GameBeaconSys;

void GameBeaconSys_Create(HeapID heapId);
void GameBeaconSys_SetGameSystem(GameSystem *gsys);
// Called once a frame
void GameBeaconSys_Update(void);
// Builds the game's beacon from the save
void GameBeaconSys_SetGameData(GameData *gameData);
// Copies the game's beacon as it is sent
void GameBeaconSys_GetSendBeacon(GameBeacon *dest);
void GameBeaconSys_ToggleB2W2Only(void);
void GameBeaconSys_SendIfUpdated(void);
void GameBeaconSys_SetNotice(u32 bit);
void GameBeaconSys_ClearNotice(u32 bit);
BOOL GameBeaconSys_CheckNotice(u32 bit);
// Logs a received beacon; FALSE if it was rejected or already seen
BOOL GameBeaconSys_Receive(const GameBeacon *beacon);
// The log's entry at index, and when it was received
GameBeacon *GameBeaconSys_GetLog(int index, GameBeaconTime *time);
// The beacon received n-th, counting from the first
GameBeacon *GameBeaconSys_GetRecent(u32 n);
u32 GameBeaconSys_GetReceiveCount(void);
// The first log entry at or after *index not yet shown, which it advances past that entry, or 30 when there is none
int GameBeaconSys_GetNextNew(int *index);
void GameBeaconSys_ClearNew(int index);
// Marks the log's entry from beacon's sender as not yet shown
BOOL GameBeaconSys_MarkNew(const GameBeacon *beacon);
// The age of the logged beacon of a trainer, or 0xffff
u16 GameBeaconSys_GetAge(u16 trainerId);
// Refresh the beacon's header for a new type, sent to all versions or to Black 2 and White 2 only
void GameBeaconSendSlot_Reset(GameBeaconSendSlot *slot);
void GameBeaconSendSlot_ResetB2W2Only(GameBeaconSendSlot *slot);
// Set a Funfest mission beacon of type, if its priority allows; for type 0x67, value is a StrBuf
void GameBeaconSendSlot_SetMission(GameBeaconSendSlot *slot, u16 type, u32 value);
void GameBeaconSendSlot_SetMissionEx(GameBeaconSendSlot *slot, u16 type, u32 value, u32 extra);
// Whether the beacon's type is a Funfest mission's, 0x3c to 0x67
BOOL GameBeacon_IsMissionType(const GameBeacon *beacon);
// Whether the beacon's type is 0x3c to 0x66
BOOL GameBeacon_HasMissionInfo(const GameBeacon *beacon);
// 1 + LinkFestival_AddMissionScore's result while a Funfest mission is on, else 0
u32 GameBeaconSys_AddMissionScore(u32 a0, u16 a1);
// Whether a beacon of type may replace the current one, by their priorities
BOOL GameBeaconSys_CanSendType(u16 type);
// Whether species is one of the special Pokémon (legendaries and such)
BOOL GameBeacon_IsSpecialSpecies(u16 species);
void GameBeacon_StoreText(const StrBuf *str, u16 *dest);
// Whether a received beacon changed the survey's results since the last call
u8 GameBeaconSys_PopSurveyUpdated(void);
void GameBeaconSys_SetSurveyAnswers(const void *answers);
void GameBeaconSys_SetCountryRegion(u8 country, u8 region);
void GameBeaconSys_SetSurveyRank(u8 rank);
// Sets the C-Gear record, a sentence (CGearPhrases_Get)
void GameBeaconSys_SetCGearRecord(const PMSData *record);
void GameBeaconSys_SetTrainerView(u32 trainerView);
// Sets the greeting from the save, after the player changed it
void GameBeaconSys_UpdateGreeting(void);
// Sets the medal count that the game's beacon sends
void GameBeaconSys_SetMedalCount(u8 count);
void GameBeaconSys_SetFavoriteMedal(u32 value);
// Sends that the player caught species, of a wild battle of the kinds a1 and a2
void GameBeaconSys_SendCapture(u16 species, BOOL a1, BOOL a2);
// Sends a Funfest mission beacon for a defeated species, of a wild battle of the kinds a1 and a2
void GameBeaconSys_SendDefeatMission(u16 species, BOOL a1, BOOL a2);
// Sends a beacon of type 0x10 with a battle Pokémon's nickname
void GameBeaconSys_SendNickname(const StrBuf *nickname);
void GameBeaconSys_SendEvolution(u16 species, const StrBuf *nickname);
// Sends a beacon of type 0x23 with an item, or the Funfest mission's
void GameBeaconSys_SendItemUse(u16 item);
void GameBeacon_SetZone(u16 zoneId, GameData *gameData);
// Set the beacon's recent event, of kinds 0 to 4
void GameBeacon_SetRecentKind0(GameBeacon *beacon, u16 species);
void GameBeacon_SetRecentKind1(GameBeacon *beacon, u16 species);
void GameBeacon_SetRecentKind2(GameBeacon *beacon, u16 item);
void GameBeacon_SetRecentKind3(GameBeacon *beacon, u16 item);
void GameBeacon_SetRecentKind4(GameBeacon *beacon, u16 item);
void GameBeacon_ClearRecent(GameBeacon *beacon);
// Sends the Funfest mission beacon of type 0x3c
void GameBeaconSys_SendMission(void);
void GameBeaconSys_SetAvenuePeople(JoinAvenuePersonList *list);
// Checks overlay 338; when the check fails, the received beacons are hidden every HBlank
void GameBeaconSys_CheckGenuineCard(void);

// game_beacon_accessor.c: tables of received beacons and the readers of a beacon's fields

// A table of beacons with the times they were received at. It is used either as a list, filled from the front
// (GameBeaconInfoTable_TakeNew to GameBeaconInfoTable_MarkAllNew), or as a ring that head is the newest entry of
// (GameBeaconInfoTable_RingIndex to GameBeaconInfoTable_GetCount). BeaconStatus starts with one, the ring of the
// beacons that the game keeps
typedef struct {
    GameBeacon beacons[GAME_BEACON_LOG_MAX];
    // GameBeaconTime's minute and hour
    u16 times[GAME_BEACON_LOG_MAX];
    u8 head;
    u8 count;
} GameBeaconInfoTable;

// A type's entry of the table that GameBeacon_GetTypeFormat and GameBeacon_GetTypeIcon read
typedef struct {
    // What the type's message shows and its payload holds, the index of the checks and of GameBeacon_SetMessageWords's
    // cases
    u8 format;
    // The icon of the type's panel in the beacon view
    u8 icon;
} GameBeaconTypeFormat;

// Moves GameBeaconSys's beacons not yet shown into the list, until it is full, and returns how many
int GameBeaconInfoTable_TakeNew(GameBeaconInfoTable *table);
// Takes the list's first beacon; FALSE when the list is empty
BOOL GameBeaconInfoTable_PopFront(GameBeaconInfoTable *table, GameBeacon *dest, u16 *time);
// Marks the list's beacons as not yet shown in GameBeaconSys again
void GameBeaconInfoTable_MarkAllNew(GameBeaconInfoTable *table);
// The ring's entry at offset from the newest
int GameBeaconInfoTable_RingIndex(GameBeaconInfoTable *table, int offset);
// Stores a beacon in the ring, over the one of the same trainer, whose offset it returns, or as the newest. isNew,
// which may be NULL, gets whether the trainer was not in the ring
int GameBeaconInfoTable_RingAdd(GameBeaconInfoTable *table, const GameBeacon *beacon, u16 time, BOOL *isNew);
// Copies the ring's beacon at offset from the newest into dest and its time into time, and returns whether there is
// one
BOOL GameBeaconInfoTable_RingGet(GameBeaconInfoTable *table, GameBeacon *dest, u16 *time, int offset);
// How many beacons the ring holds
u8 GameBeaconInfoTable_GetCount(GameBeaconInfoTable *table);
// Allocates a beacon, cleared
GameBeacon *GameBeacon_Alloc(HeapID heapId);
// Allocates a table, cleared
GameBeaconInfoTable *GameBeaconInfoTable_Alloc(HeapID heapId);
// Whether a received beacon is invalid
BOOL GameBeacon_IsInvalid(const GameBeacon *beacon);
// Whether the beacon's type is one of a distribution, 0x19, 0x1a, 0x1b or 0x32
BOOL GameBeacon_IsGiftType(const GameBeacon *beacon);
// Loads the beacon's trainer name into a StrBuf
void GameBeacon_GetName(const GameBeacon *beacon, StrBuf *dest);
// The game version of the beacon's sender
u32 GameBeacon_GetVersion(const GameBeacon *beacon);
u32 GameBeacon_GetLanguage(const GameBeacon *beacon);
u32 GameBeacon_GetCountry(const GameBeacon *beacon);
u8 GameBeacon_GetRegion(const GameBeacon *beacon);
// The sender's answers to the survey's questions 0x1a and 0x19, or 0xff for none
u8 GameBeacon_GetJob(GameBeacon *beacon);
u8 GameBeacon_GetHobby(GameBeacon *beacon);
// The sender's C-Gear record
void GameBeacon_GetCGearRecord(const GameBeacon *beacon, PMSData *dest);
u8 GameBeacon_GetSurveyRank(const GameBeacon *beacon);
// The color of OS_GetFavoriteColorTable's table that the sender's favorite color is shown in
void GameBeacon_GetFavoriteColorRGB(u16 *dest, const GameBeacon *beacon);
u8 GameBeacon_GetFavoriteColor(const GameBeacon *beacon);
u16 GameBeacon_GetTrainerId(const GameBeacon *beacon);
// The sender's trainer view, plus 8 for a female trainer
u8 GameBeacon_GetTrainerViewWithGender(const GameBeacon *beacon);
u32 GameBeacon_GetGender(const GameBeacon *beacon);
void GameBeacon_GetPlayTime(const GameBeacon *beacon, u16 *hours, u16 *minutes);
u32 GameBeacon_GetPassPower(const GameBeacon *beacon);
u16 GameBeacon_GetZone(const GameBeacon *beacon);
u16 GameBeacon_GetParentZone(const GameBeacon *beacon);
u32 GameBeacon_GetThankedCount(const GameBeacon *beacon);
u32 GameBeacon_GetPasserbyCount(const GameBeacon *beacon);
// The beacon's sender's favorite medal, or 0xff, and how many medals it has
u8 GameBeacon_GetFavoriteMedal(const GameBeacon *beacon);
u8 GameBeacon_GetMedalCount(const GameBeacon *beacon);
void GameBeacon_GetGreeting(const GameBeacon *beacon, StrBuf *dest);
// The message of a beacon of type 0x18 and the text of one of type 0x31; empty for other types
void GameBeacon_GetMessage(const GameBeacon *beacon, StrBuf *dest);
void GameBeacon_GetTextMessage(const GameBeacon *beacon, StrBuf *dest);
// The beacon's recent event: its kind, GAME_BEACON_RECENT_NONE when invalid, its trainer (kinds 2 to 4) and its
// species (kinds 0 and 1)
u32 GameBeacon_GetRecentKind(const GameBeacon *beacon);
u16 GameBeacon_GetRecentTrainer(const GameBeacon *beacon);
u16 GameBeacon_GetRecentSpecies(const GameBeacon *beacon);
// The beacon's type, or 1 for a type of 0 or of GAME_BEACON_TYPE_MAX or more
u16 GameBeacon_GetType(const GameBeacon *beacon);
// The Pass Power of a distribution of type 0x32, else 0
u16 GameBeacon_GetGiftPassPower(const GameBeacon *beacon);
u8 GameBeacon_GetTypeIcon(int type);
// Sets the words of the beacon's message: the sender's name as word 0 and what the type's format shows from word 1
void GameBeacon_SetMessageWords(const GameBeacon *beacon, WordSet *wordSet, HeapID heapId);

#endif // POKEBW2_SYSTEM_GAME_BEACON_H
