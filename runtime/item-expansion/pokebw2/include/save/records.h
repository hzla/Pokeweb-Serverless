#ifndef POKEBW2_SAVE_RECORDS_H
#define POKEBW2_SAVE_RECORDS_H

#include "types.h"
#include "struct_decls.h"

// RecordSave is the block that getRecordBlkAddress returns. The encrypted records that GameData_GetRecords returns
// are GameRecords: the counters of the first 0x47 records are words, and those of the rest halfwords. All but the
// first are encrypted, with the sum of them as the seed

#define RECORD_COUNT_WORD 0x47
#define RECORD_COUNT 0xa7

struct GameRecords {
    u32 words[RECORD_COUNT_WORD];
    u16 halfwords[RECORD_COUNT - RECORD_COUNT_WORD];
    u16 checksum;
    u16 seedHigh;
};

#define BATTLEMATCH_MAC_ADDRESS_SIZE 6
#define LIVEMATCH_COUNT_MAX 0xff
#define LIVEMATCH_OPPONENT_MAX 10

// An opponent of the live competition
typedef struct {
    u8 macAddress[BATTLEMATCH_MAC_ADDRESS_SIZE];
    u8 params[2];
} LiveMatchOpponent;

// The results of the live competition (livematch_savedata.c)
typedef struct {
    // The console the competition was entered on
    u8 macAddress[BATTLEMATCH_MAC_ADDRESS_SIZE];
    // The first is the number of opponents
    u8 counts[4];
    // A ring of the last opponents
    LiveMatchOpponent opponents[LIVEMATCH_OPPONENT_MAX];
} LiveMatchData; // size: 0x5a

// Block 0x3b (battlematch_savedata.c)
struct RecordSave {
    /* 0x00 */ LiveMatchData liveMatch;
    // The results of the random matches and the Wi-Fi competition (rndmatch_savedata.c)
    /* 0x5a */ u16 rndMatch[11][3];
    // The console and the time, in seconds, a match was started at, and whether it is still in progress
    /* 0x9c */ u8 macAddress[BATTLEMATCH_MAC_ADDRESS_SIZE];
    /* 0xa2 */ u8 matchInProgress;
    /* 0xa3 */ u8 unkA3;
    /* 0xa4 */ s64 matchSeconds;
}; // size: 0xac

// The size of the records
u32 GameRecords_GetSize(void);
void initTrainerCardInfoBlk(GameRecords *records);
void EncryptRecordStorage(GameRecords *records, u32 id);
void DecryptRecordStorage(GameRecords *records, u32 id);
u32 GetRecordCounter(GameRecords *records, int id);
u32 SetRecordCounter(GameRecords *records, int id, u32 value);
u32 GetRecordCounterMax(u32 id);
// Sets a record to value, or to its maximum
u32 RecordSet(GameRecords *records, u32 id, u32 value);

// Clears the flag that is set, with the console's MAC address and the time, while a match is in progress
void RecordSave_ClearMatchInProgress(RecordSave *record);
// Sets that flag again, with the console's MAC address and the time
void RecordSave_UpdateMatchSeconds(RecordSave *record);

u32 RecordAddOne(GameRecords *records, u32 id);
u32 RecordGet(GameRecords *records, u32 id);
u32 RecordAdd(GameRecords *records, u32 id, u32 value);
// Sets a record to value if that is higher, up to the record's maximum
u32 RecordSetIfHigher(GameRecords *records, u32 id, u32 value);
// The Trial House's best rank and best points
void RecordSetTrialHouseRank(GameRecords *records, u8 rank);
// The Battle Test rank
u8 RecordGetTrialHouseRank(GameRecords *records);
// Record 0x7c
u32 RecordGetTrialHousePoints(GameRecords *records);
void RecordFinishDay(GameRecords *records);
void RecordSetTrialHousePoints(GameRecords *records, u32 points);
// The block's size and its initial state
u32 RecordSave_GetSize(void);
void RecordSave_Init(RecordSave *record);
// The same as getRecordBlkAddress, which save/save_control.h declares
RecordSave *SaveControl_GetRecordSave(SaveControl *save);
// The results of the random matches
void *RecordSave_GetRndMatchData(RecordSave *record);
void RecordSave_SetMatchInProgress(RecordSave *record);
u8 RecordSave_IsMatchInProgress(RecordSave *record);
u32 RecordSave_IsMacAddressSame(RecordSave *record);
u32 RecordSave_IsMatchTimedOut(RecordSave *record);
void func_0200f37c(RecordSave *record, u32 value);
u8 func_0200f384(RecordSave *record);
// The parts of the record that the Wi-Fi competition's card reads (6-byte results with halfword fields), and the
// live competition's (the record itself, with a byte after each result's 6 bytes)
void *RecordSave_GetRndMatch(RecordSave *record);
void *RecordSave_GetLiveMatch(RecordSave *record);

// livematch_savedata.c, whose other functions app/livebattlematch_flow.h declares. A count of the live competition's
// results
u32 LiveMatchData_GetCount(void *results, u32 index);

// rndmatch_savedata.c
void RndMatchData_Init(void *results);
u16 RndMatchData_GetParam(void *results, u32 index, u32 field);
// Sets a field of a result, from 0 to 0xffff
void RndMatchData_SetParam(void *results, u32 index, u32 field, s32 value);
// Adds 1 to a field of a result, up to 0xffff
void RndMatchData_IncParam(void *results, u32 index, u32 field);

#endif // POKEBW2_SAVE_RECORDS_H
