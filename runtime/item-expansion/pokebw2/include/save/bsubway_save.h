#ifndef POKEBW2_SAVE_BSUBWAY_SAVE_H
#define POKEBW2_SAVE_BSUBWAY_SAVE_H

#include "types.h"
#include "gfl/heap.h"
#include "nitro/rtc.h"
#include "struct_decls.h"

// The Battle Subway's save blocks: 0x38 the current play, 0x39 the scores, which include the Battle Points, and 0x3a
#define SAVE_BLOCK_BSUBWAY_PLAY 0x38
#define SAVE_BLOCK_BSUBWAY_SCORE 0x39
#define SAVE_BLOCK_BSUBWAY_3A 0x3a

#define BSUBWAY_WIFI_RANK_MAX 10
#define BSUBWAY_WIFI_ROOM_MAX 200
#define BSUBWAY_WIFI_PLAYER_MAX 7
#define BSUBWAY_WIFI_LEADER_MAX 30
#define BSUBWAY_BATTLE_POINTS_MAX 9999
// The play modes the scores are kept for
#define BSUBWAY_SCORE_MODE_MAX 9

// The values of the current play, which BSubwayPlayData_GetData reads and BSubwayPlayData_SetData sets
enum {
    BSUBWAY_PLAY_MODE,
    BSUBWAY_PLAY_ROUND,
    BSUBWAY_PLAY_WIFI_DOWN,
    BSUBWAY_PLAY_WIFI_TURN,
    BSUBWAY_PLAY_WIFI_DAMAGE,
    BSUBWAY_PLAY_UNK8,
    BSUBWAY_PLAY_UNK28,
    BSUBWAY_PLAY_UNK0_0,
    BSUBWAY_PLAY_UNKC,
    BSUBWAY_PLAY_UNK0_6,
    BSUBWAY_PLAY_UNK0_9,
    BSUBWAY_PLAY_UNK0_10,
};

// What BSubwayScoreData_SetFlag does with a flag of the scores
enum {
    BSUBWAY_FLAG_GET,
    BSUBWAY_FLAG_SET,
    BSUBWAY_FLAG_RESET,
    // Adds 1 to the count of BSubwayScoreData_SetWifiLoseCount
    BSUBWAY_FLAG_INC,
};

// Block 0x38: the play the player saved in the middle of
struct BSubwayPlayData {
    u16 unk0_0 : 1;
    // Whether the play was saved
    u16 saved : 1;
    u16 playMode : 4;
    u16 unk0_6 : 3;
    u16 unk0_9 : 1;
    u16 unk0_10 : 1;
    u16 : 5;
    u8 round;
    // The Wi-Fi train's record: the Pokémon lost, the turns taken and the damage taken
    u8 wifiDown;
    u16 wifiTurn;
    u16 wifiDamage;
    u8 unk8[4];
    u8 unkC[0x1c];
    u8 unk28[0x14];
};

// Block 0x39: the scores
struct BSubwayScoreData {
    u16 battlePoints;
    // How many Wi-Fi plays in a row were lost
    u8 wifiLoseCount;
    u8 wifiRank;
    u32 flags;
    // By play mode: the current streak, the longest one, and a count that starts at 1 once the mode is played
    u16 streaks[BSUBWAY_SCORE_MODE_MAX];
    u16 maxStreaks[BSUBWAY_SCORE_MODE_MAX];
    u16 stages[BSUBWAY_SCORE_MODE_MAX];
    u16 wifiScore;
    u8 unk40[4];
    // Two teams of three BSubwayPokemon
    u8 team1[0xb4];
    u8 team0[0xb4];
};

// A player of the Wi-Fi train, of whom BSubwayWifiData_GetTrainer makes a trainer
typedef struct {
    u8 pokemon[0xb4];
    u16 name[8];
    u8 unkC4[0x11];
    u8 trainerClass;
    u16 message[4];
    u16 winWords[4];
    u16 loseWords[4];
    u8 paddingEE[2];
} BSubwayWifiPlayer;

// A leader of a Wi-Fi room: 0x22 bytes, a name and the rest (overlays 50 and 141 keep their own BSubwayRecord)
typedef struct {
    u16 name[8];
    u8 unk10[4];
    // A 32-bit ID, lowest byte first
    u8 id[4];
    u8 unk18[10];
} BSubwayWifiLeader;

// Block 0x3a: the Wi-Fi train's downloaded data
typedef struct {
    // The day the rooms were cleared on, packed as year, month, day and week bytes
    u32 date;
    // A bit for each room of each rank that was cleared on that day
    u8 roomFlags[BSUBWAY_WIFI_RANK_MAX * BSUBWAY_WIFI_ROOM_MAX / 8];
    u8 hasPlayers;
    u8 hasLeaders;
    u8 playerRoom;
    u8 playerRank;
    u8 leaderRoom;
    u8 leaderRank;
    BSubwayWifiPlayer players[BSUBWAY_WIFI_PLAYER_MAX];
    BSubwayWifiLeader leaders[BSUBWAY_WIFI_LEADER_MAX];
} BSubwayWifiData;

// Block 0x38
u32 BSubwayPlayData_GetSize(void);
void BSubwayPlayData_Init(BSubwayPlayData *data);
void BSubwayPlayData_SetSaveFlag(BSubwayPlayData *data, u32 value);
u32 BSubwayPlayData_GetSaveFlag(BSubwayPlayData *data);
// Reads a value, into the buffer when it is an array
u32 BSubwayPlayData_GetData(BSubwayPlayData *data, u32 id, void *buffer);
void BSubwayPlayData_SetData(BSubwayPlayData *data, u32 id, const void *value);
// Adds to the Wi-Fi train's record
void BSubwayPlayData_AddWifiRecord(BSubwayPlayData *data, u8 down, u8 turn, u16 damage);
void BSubwayPlayData_ResetRound(BSubwayPlayData *data);
void BSubwayPlayData_IncRound(BSubwayPlayData *data);
u16 BSubwayPlayData_GetRound(BSubwayPlayData *data);

// Block 0x39, which GameData_GetBSubwayScoreData also returns. BSubwayScoreData_AddBattlePoints adds Battle Points
u32 BSubwayScoreData_GetSize(void);
void BSubwayScoreData_Init(BSubwayScoreData *score);
void BSubwayScoreData_AddBattlePoints(BSubwayScoreData *score, u16 amount);
// Takes Battle Points, down to 0
void BSubwayScoreData_SubBattlePoints(BSubwayScoreData *score, u16 amount);
u16 BSubwayScoreData_GetBattlePoints(BSubwayScoreData *score);
u16 BSubwayScoreData_GetStreak(BSubwayScoreData *score, u32 mode);
u16 BSubwayScoreData_GetMaxStreak(BSubwayScoreData *score, u32 mode);
// Raises the longest streak
void BSubwayScoreData_UpdateMaxStreak(BSubwayScoreData *score, u32 mode, u32 value);
void BSubwayScoreData_SetStreak(BSubwayScoreData *score, u32 mode, u32 value);
void BSubwayScoreData_ResetStage(BSubwayScoreData *score, u32 mode);
void BSubwayScoreData_StartStage(BSubwayScoreData *score, u32 mode);
BOOL BSubwayScoreData_HasStage(BSubwayScoreData *score, u32 mode);
void BSubwayScoreData_IncStage(BSubwayScoreData *score, u32 mode);
u16 BSubwayScoreData_GetStage(BSubwayScoreData *score, u32 mode);
// Reads, sets or clears one of the 11 flags (a BSUBWAY_FLAG_* operation)
BOOL BSubwayScoreData_SetFlag(BSubwayScoreData *score, int id, u32 op);
void BSubwayScoreData_IncWifiRank(BSubwayScoreData *score);
void BSubwayScoreData_DecWifiRank(BSubwayScoreData *score);
u32 BSubwayScoreData_GetWifiRank(BSubwayScoreData *score);
// Resets or counts the Wi-Fi plays lost in a row (BSUBWAY_FLAG_RESET or BSUBWAY_FLAG_INC), and returns the count
u32 BSubwayScoreData_SetWifiLoseCount(BSubwayScoreData *score, u32 op);
void BSubwayScoreData_SetTeam(BSubwayScoreData *score, u32 flag, const void *team);
void BSubwayScoreData_GetTeam(BSubwayScoreData *score, u32 flag, void *team);
// Scores a Wi-Fi play from its rounds and its record
void BSubwayScoreData_CalcWifiScore(BSubwayScoreData *score, BSubwayPlayData *play);
u16 BSubwayScoreData_GetWifiScore(BSubwayScoreData *score);
u8 BSubwayScoreData_GetWifiScoreRounds(BSubwayScoreData *score);

// Block 0x3a
u32 BSubwayWifiData_GetSize(void);
void BSubwayWifiData_Init(BSubwayWifiData *data);
void BSubwayWifiData_SetRoomFlag(BSubwayWifiData *data, u8 rank, u8 room, const RTCDate *date);
BOOL BSubwayWifiData_GetRoomFlag(BSubwayWifiData *data, u8 rank, u8 room, const RTCDate *today);
u16 BSubwayWifiData_HasPlayers(BSubwayWifiData *data);
u16 BSubwayWifiData_HasLeaders(BSubwayWifiData *data);
void BSubwayWifiData_SetPlayers(BSubwayWifiData *data, const void *players, u8 rank, u8 room);
u16 BSubwayWifiData_GetPlayerRank(BSubwayWifiData *data);
u16 BSubwayWifiData_GetPlayerRoom(BSubwayWifiData *data);
void BSubwayWifiData_GetTrainer(BSubwayWifiData *data, BSubwayTrainer *trainer, u8 round, u16 id);
void BSubwayWifiData_SetLeaders(BSubwayWifiData *data, const void *leaders, u8 rank, u8 room);
u16 BSubwayWifiData_GetLeaderRank(BSubwayWifiData *data);
u16 BSubwayWifiData_GetLeaderRoom(BSubwayWifiData *data);
// Allocates a copy of the block's list of 0x22-byte leaders
void *BSubwayWifiData_AllocLeaders(BSubwayWifiData *data, HeapID heapId);
int BSubwayWifiLeader_CountList(void *list);
u32 BSubwayWifiLeader_GetID(void *entry);

#endif // POKEBW2_SAVE_BSUBWAY_SAVE_H
