#ifndef POKEBW2_SAVE_JOIN_AVENUE_H
#define POKEBW2_SAVE_JOIN_AVENUE_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"

// The Join Avenue's saved data (resonance_resort_data.c). Names from swan (https://github.com/ds-pokemon-hacking/swan,
// GPL-3.0): JoinAvenuePerson_IsEmpty, joinAveTextHandler, JoinAvenuePerson_SetParam, JoinAvenuePersonList_Create,
// JoinAvenuePersonList_Free, JoinAvenuePersonList_GetCount, JoinAvenuePersonList_Get, JoinAvenue_GetParam,
// JoinAvenue_GetInfo, JoinAvenue_GetPersonList, getAddressOfBeginningOfOccupants and setImportantJABlockAddresses.
// The rest, and the fields, are ours

// The extra data a person brings: the adventure, two sets of the records of ResortWork_Get, the player's own values,
// the recent activities and two messages
#define JOIN_AVE_DATA_COUNT 7
// The people who run the avenue's shops, the records of those who left, and the recent activities
#define JOIN_AVE_OCCUPANT_COUNT 8
#define JOIN_AVE_RECORD_COUNT 4
#define JOIN_AVE_RECENT_COUNT 4
// The trainer IDs of the visitors the info remembers, so that a visitor is added once a day
#define JOIN_AVE_VISITOR_ID_COUNT 32

// A field of a person, which joinAveTextHandler reads and JoinAvenuePerson_SetParam writes, as overlay 137's people
// do through their data. Entries and records have some of them
typedef enum {
    JOIN_AVE_PARAM_SLOT = 0,
    JOIN_AVE_PARAM_ROW = 1,
    JOIN_AVE_PARAM_GENDER = 2,
    JOIN_AVE_PARAM_TRAINER_TYPE = 3,
    JOIN_AVE_PARAM_NAME = 4,
    JOIN_AVE_PARAM_GREETING = 5,
    JOIN_AVE_PARAM_UNK_6 = 6,
    JOIN_AVE_PARAM_SEED = 7,
    JOIN_AVE_PARAM_COUNTRY = 8,
    JOIN_AVE_PARAM_AREA = 9,
    JOIN_AVE_PARAM_PLAY_HOURS = 10,
    JOIN_AVE_PARAM_PLAY_MINUTES = 11,
    JOIN_AVE_PARAM_JOB = 12,
    JOIN_AVE_PARAM_HOBBY = 13,
    JOIN_AVE_PARAM_TRAINER_ID = 14,
    JOIN_AVE_PARAM_VERSION = 15,
    JOIN_AVE_PARAM_LANGUAGE = 16,
    JOIN_AVE_PARAM_RANK = 17,
    JOIN_AVE_PARAM_UNK_18 = 18,
    JOIN_AVE_PARAM_SHOP_ID = 19,
    JOIN_AVE_PARAM_UNK_20 = 20,
    // When the person arrived
    JOIN_AVE_PARAM_YEAR = 21,
    JOIN_AVE_PARAM_MONTH = 22,
    JOIN_AVE_PARAM_DAY = 23,
    JOIN_AVE_PARAM_HOUR = 24,
    JOIN_AVE_PARAM_MINUTE = 25,
    JOIN_AVE_PARAM_UNK_26 = 26,
    JOIN_AVE_PARAM_UNK_27 = 27,
    // How the person last came: 1 replacing another, 2 into an empty place, 3 changed and 4 the same; setting it keeps
    // the lowest
    JOIN_AVE_PARAM_STATUS = 28,
    JOIN_AVE_PARAM_UNK_29 = 29,
    JOIN_AVE_PARAM_UNK_30 = 30,
    // Column 0 of the person's shop
    JOIN_AVE_PARAM_SHOP_KIND = 31,
    JOIN_AVE_PARAM_UNK_32 = 32,
    // A bit for each extra data received, their number, and setting one bit
    JOIN_AVE_PARAM_DATA_MASK = 33,
    JOIN_AVE_PARAM_DATA_COUNT = 34,
    JOIN_AVE_PARAM_DATA_RECEIVED = 35,
    JOIN_AVE_PARAM_UNK_36 = 36,
    JOIN_AVE_PARAM_UNK_37 = 37,
    JOIN_AVE_PARAM_UNK_38 = 38,
    JOIN_AVE_PARAM_UNK_39 = 39,
    // Extra data 0: the adventure
    JOIN_AVE_PARAM_MEDAL_RANK = 40,
    JOIN_AVE_PARAM_LAST_MEDAL = 41,
    JOIN_AVE_PARAM_MEDAL_DATE = 42,
    JOIN_AVE_PARAM_MEDAL_COUNT = 43,
    JOIN_AVE_PARAM_START_DATE = 44,
    JOIN_AVE_PARAM_HALL_OF_FAME_DATE = 45,
    JOIN_AVE_PARAM_DEX_CAUGHT = 46,
    JOIN_AVE_PARAM_SPECIES = 47,
    // Eight, by shop kind
    JOIN_AVE_PARAM_SHOP_COUNT = 48,
    // Extra data 1 to 4: four, four, sixteen, and four of each
    JOIN_AVE_PARAM_RECORD1 = 56,
    JOIN_AVE_PARAM_RECORD2 = 60,
    JOIN_AVE_PARAM_VALUE = 64,
    JOIN_AVE_PARAM_RECENT_ID = 80,
    JOIN_AVE_PARAM_RECENT_DATE = 84,
    // Extra data 5 and 6: read into the buffer, or a default text if empty, and set from a pointer
    JOIN_AVE_PARAM_MESSAGE1 = 88,
    JOIN_AVE_PARAM_MESSAGE2 = 89,
    // The same, read raw into the buffer if it isn't NULL, returning the address
    JOIN_AVE_PARAM_MESSAGE1_RAW = 90,
    JOIN_AVE_PARAM_MESSAGE2_RAW = 91,
    // An entry's species
    JOIN_AVE_PARAM_ENTRY_SPECIES = 92,
} JoinAvenuePersonParam;

// A message of up to 8 characters
typedef struct {
    u16 str[8];
} JoinAvenueMessage;

// Who a person is, from the player's own data or a beacon
typedef struct {
    u16 name[7];
    u8 country;
    u8 region;
    u16 greeting[8];
    u8 version;
    u8 language;
    u8 : 4;
    u8 gender : 4;
    u16 trainerId;
    // The survey's answers 26 and 25
    u8 job;
    u8 hobby;
    u16 playHours : 10;
    u16 playMinutes : 6;
    u16 trainerType;
} JoinAvenueProfile;

// The avenue's rank where the person comes from, and the shop the person would like to run
typedef struct {
    u8 unk0 : 1;
    u8 rank : 7;
    u16 shopId;
} JoinAvenueShopChoice;

// The state of the shop a person runs
typedef struct {
    u8 unk0;
    // Column 2 of the shop
    u8 level;
    u16 unk2;
    // A bit for each of the shop's goods
    u32 flags;
    // 0xffff when none
    u16 id;
} JoinAvenueShop;

// Extra data 0. Dates are packed as 7 bits of year, 4 of month and 5 of day
typedef struct {
    // The occupants who run a shop of each kind
    u32 shopCount0 : 4;
    u32 shopCount1 : 4;
    u32 shopCount2 : 4;
    u32 shopCount3 : 4;
    u32 shopCount4 : 4;
    u32 shopCount5 : 4;
    u32 shopCount6 : 4;
    u32 shopCount7 : 4;
    u32 dexCaught : 10;
    // The first of the party
    u32 species : 10;
    u32 medalRank : 8;
    u32 : 4;
    // 0xff when none
    u8 lastMedal;
    u8 medalCount;
    u16 medalDate;
    u16 startDate;
    u16 hallOfFameDate;
} JoinAvenueAdventure;

// One of the extra data of a person
typedef union {
    JoinAvenueAdventure adventure;
    u32 records[4];
    u8 values[16];
    struct {
        u8 ids[JOIN_AVE_RECENT_COUNT];
        u16 dates[JOIN_AVE_RECENT_COUNT];
    } recent;
    JoinAvenueMessage message;
} JoinAvenueData;

// What the beacon of a visitor carries besides the profile
typedef struct {
    JoinAvenueShopChoice choice;
    JoinAvenueData data;
} JoinAvenueBeaconPayload;

struct JoinAvenuePerson {
    JoinAvenueProfile profile;
    JoinAvenueShopChoice choice;
    JoinAvenueData data[JOIN_AVE_DATA_COUNT];
    u16 unkA0;
    u8 unkA2;
    u8 year;
    u8 month;
    u8 day;
    u8 hour;
    u8 minute;
    u8 unkA8;
    u8 unkA9_0 : 1;
    // Never leaves
    u8 unkA9_1 : 1;
    u8 unkA9_2 : 1;
    u8 : 4;
    u8 unkA9_7 : 1;
    u8 unkAA_0 : 1;
    u8 unkAB;
    JoinAvenueShop shop;
    u32 unkB8;
    u32 dataMask : 9;
    u32 unkBC_9 : 1;
    u32 status : 3;
    u32 slot : 8;
    u32 row : 7;
    u32 shopKind : 4;
    u32 seed;
};

// A person who has left the avenue
struct JoinAvenueRecord {
    JoinAvenueProfile profile;
    u8 row;
    u8 slot;
    u8 shopKind;
    u8 unk2F;
    u8 year;
    u8 month;
    u8 day;
    u8 unk33;
    JoinAvenueMessage message1;
    JoinAvenueMessage message2;
    u32 seed;
};

// A person to come, from overlay 137's entries
struct JoinAvenueEntry {
    JoinAvenueProfile profile;
    JoinAvenueMessage message1;
    JoinAvenueMessage message2;
    u8 unk4C[2];
    // 0 or 1 by the type it was made with, or 2 to 4
    u8 unk4E;
    u8 unk4F;
    u16 species;
    u16 unk52;
    u8 row;
    u8 slot;
    // 6 or 7
    u8 unk56;
    u8 year;
    u8 month;
    u8 day;
    u16 shopId;
    u32 seed;
};

struct JoinAvenueEntryList {
    u32 count;
    JoinAvenueEntry entries[];
};

struct JoinAvenuePersonList {
    u32 count;
    // Merging and adding fail while it is set
    u32 locked;
    JoinAvenuePerson people[];
};

// A visitor from a beacon, or the player sending one: a person with one extra data
struct JoinAvenueVisitor {
    JoinAvenueProfile profile;
    JoinAvenueShopChoice choice;
    JoinAvenueData data;
    // Which extra data it is, or JOIN_AVE_DATA_COUNT for none
    s32 dataIndex;
    u32 unk44;
};

struct JoinAvenueOccupants {
    JoinAvenuePerson people[JOIN_AVE_OCCUPANT_COUNT];
    JoinAvenueRecord records[JOIN_AVE_RECORD_COUNT];
    JoinAvenuePerson player;
    // Merging fails while it is set
    u32 locked;
};

struct JoinAvenueInfo {
    u16 name[21];
    u16 name2[21];
    u32 visitorIds[JOIN_AVE_VISITOR_ID_COUNT];
    u32 unkD4;
    u16 rank;
    u16 unkDA;
    u32 unkDC_0 : 1;
    u32 unkDC_1 : 1;
    u32 unkDC_2 : 1;
    u32 unkDC_3 : 1;
    u32 unkDC_4 : 1;
    u32 unkDC_5 : 1;
    u32 unkDC_6 : 1;
    u32 unkDC_7 : 1;
    u32 unkDC_8 : 1;
    u32 unkDC_9 : 1;
    u32 unkDC_10 : 1;
    u32 unkDC_11 : 1;
    u32 unkDC_12 : 1;
    u32 unkDC_13 : 1;
    u32 unkDC_14 : 1;
    u32 unkDC_15 : 1;
    u32 unkDC_16 : 1;
    u32 unkDC_17 : 1;
    u32 unkDC_18 : 1;
    u32 unkDC_19 : 1;
    u16 visitorIdCount;
    u16 visitorIdIndex;
    u32 seed;
    u16 unkE8;
    u16 unkEA;
};

// Save block 0x43 (join_avenue_savedata.c, a descriptive name): the people met, the entries, the occupants and the
// info. Clearing the block leaves the rest of it
#define JOIN_AVE_PERSON_COUNT 8
#define JOIN_AVE_ENTRY_COUNT 12

struct JoinAvenueSave {
    u8 personList[sizeof(JoinAvenuePersonList) + JOIN_AVE_PERSON_COUNT * sizeof(JoinAvenuePerson)];
    u8 entryList[sizeof(JoinAvenueEntryList) + JOIN_AVE_ENTRY_COUNT * sizeof(JoinAvenueEntry)];
    JoinAvenueOccupants occupants;
    JoinAvenueInfo info;
    u8 unk13E0[0x2c8];
};

// What a person is added from, the kind that JoinAvenueOccupants_Merge takes
typedef enum {
    JOIN_AVE_SOURCE_VISITOR = 0,
    JOIN_AVE_SOURCE_PERSON = 1,
    JOIN_AVE_SOURCE_ENTRY = 2,
} JoinAvenueSourceKind;

// The block's size and its initial state
u32 JoinAvenueSave_GetSize(void);
void JoinAvenueSave_Init(JoinAvenueSave *joinAvenue);

JoinAvenuePersonList *JoinAvenuePersonList_Create(HeapID heapId, u32 count);
void JoinAvenuePersonList_Free(JoinAvenuePersonList *list);
void JoinAvenuePersonList_Init(JoinAvenuePersonList *list, u32 count);
JoinAvenuePerson *JoinAvenuePersonList_Get(JoinAvenuePersonList *list, u32 index);
u32 JoinAvenuePersonList_GetCount(JoinAvenuePersonList *list);
// The number of people in the list
u32 JoinAvenuePersonList_CountUsed(JoinAvenuePersonList *list);
// Merges into the person of the list who matches, returning 1 when merged, 2 when it can't, and 0 if none matches
u32 JoinAvenuePersonList_MergeVisitor(JoinAvenuePersonList *list, const JoinAvenueVisitor *visitor);
u32 JoinAvenuePersonList_MergePerson(JoinAvenuePersonList *list, const JoinAvenuePerson *src);
u32 JoinAvenuePersonList_MergeEntry(JoinAvenuePersonList *list, const JoinAvenueEntry *entry);
// Adds to an empty place or in place of a person whose stay is over: 1 when added, 2 when it can't, and 0 if there's
// no room or the visitor came today
u32 JoinAvenuePersonList_AddVisitor(JoinAvenuePersonList *list, const JoinAvenueVisitor *visitor);
u32 JoinAvenuePersonList_AddPerson(JoinAvenuePersonList *list, const JoinAvenuePerson *src);
BOOL JoinAvenuePerson_IsEmpty(JoinAvenuePerson *person);
void JoinAvenuePerson_SetParam(JoinAvenuePerson *person, JoinAvenuePersonParam param, u32 value);
JoinAvenueInfo *JoinAvenue_GetInfo(JoinAvenueSave *joinAvenue);
void JoinAvenueInfo_Init(JoinAvenueInfo *info);
// A field of the info, which reads into the buffer for the avenue's names
u32 JoinAvenue_GetParam(JoinAvenueInfo *info, u32 param, void *buffer);
JoinAvenuePersonList *JoinAvenue_GetPersonList(JoinAvenueSave *joinAvenue);
// Records an activity of the player's, the latest of the four recent ones
void JoinAvenue_RecordActivity(u32 id);
// Sets a field of the info
void JoinAvenueInfo_SetParam(JoinAvenueInfo *info, u32 param, u32 value);
void JoinAvenueInfo_ResetDaily(JoinAvenueInfo *info, BOOL fullDay);
// Where the info and occupants of the save are, for the functions that don't take them
void setImportantJABlockAddresses(SaveControl *save);

// A person's fields. joinAveTextHandler reads one, into the buffer for a name
u32 joinAveTextHandler(const JoinAvenuePerson *person, JoinAvenuePersonParam param, void *buffer);
// Allocates a person, frees one and clears one
JoinAvenuePerson *JoinAvenuePerson_Create(HeapID heapId);
void JoinAvenuePerson_Free(JoinAvenuePerson *person);
void JoinAvenuePerson_Clear(JoinAvenuePerson *person);
// Fills the player's own person
void JoinAvenuePerson_InitPlayer(JoinAvenuePerson *person, GameData *gameData);
// Whether the person's data are all valid
BOOL JoinAvenuePerson_IsValid(JoinAvenuePerson *person);
// A random number from the person's seed, of the count-th step: below max, or any if max is 0
u32 JoinAvenuePerson_Random(JoinAvenuePerson *person, int count, u32 max);
// The entries, twelve from 4 bytes into the Join Avenue's save at 0x628, with the same functions as a person's
JoinAvenueEntryList *JoinAvenue_GetEntryList(JoinAvenueSave *joinAvenue);
void JoinAvenueEntryList_Init(JoinAvenueEntryList *list, u32 count);
// Adds an entry to an empty place: 1 when added, 2 when it isn't valid and 0 if there's no room
u32 JoinAvenueEntryList_Add(JoinAvenueEntryList *list, JoinAvenueEntry *entry);
JoinAvenueEntry *JoinAvenueEntryList_Get(JoinAvenueEntryList *list, u32 index);
// The number of entries, and the number that aren't empty
u32 JoinAvenueEntryList_GetCount(JoinAvenueEntryList *list);
u32 JoinAvenueEntryList_CountUsed(JoinAvenueEntryList *list);
// Whether one matches, and merging an entry into the one that matches
BOOL JoinAvenueEntryList_HasVisitor(JoinAvenueEntryList *list, const JoinAvenueVisitor *visitor);
BOOL JoinAvenueEntryList_HasPerson(JoinAvenueEntryList *list, const JoinAvenuePerson *person);
BOOL JoinAvenueEntryList_MergeEntry(JoinAvenueEntryList *list, const JoinAvenueEntry *entry);
// Called with an entry by overlay 137, which counts a result of 2 and stops at 0
u32 JoinAvenue_Add(JoinAvenueSave *joinAvenue, GameData *gameData, void *entry, u32 a3);
void JoinAvenue_ResetAddStep(JoinAvenueSave *joinAvenue);
BOOL JoinAvenue_AddStepwise(JoinAvenueSave *joinAvenue, GameData *gameData, void *work, u32 a3, u32 *out);
// The visitor of a beacon
JoinAvenueVisitor *JoinAvenueVisitor_Create(HeapID heapId);
void JoinAvenueVisitor_Free(JoinAvenueVisitor *visitor);
// Fills the visitor with the player's data and the extra data of the index, and puts the extra data in the beacon
void JoinAvenueVisitor_InitPlayer(JoinAvenueVisitor *visitor, int index, GameData *gameData);
void JoinAvenueVisitor_StoreInBeacon(JoinAvenueVisitor *visitor, GameBeacon *beacon);
void JoinAvenueVisitor_InitFromBeacon(JoinAvenueVisitor *visitor, const GameBeacon *beacon, u32 a2);
BOOL JoinAvenueVisitor_IsValid(JoinAvenueVisitor *visitor);
JoinAvenueEntry *JoinAvenueEntry_Create(HeapID heapId);
void JoinAvenueEntry_Free(JoinAvenueEntry *entry);
void JoinAvenueEntry_Init(JoinAvenueEntry *entry, PlayerInfo *playerInfo, u16 species, u32 type);
void JoinAvenueEntry_Clear(JoinAvenueEntry *entry);
BOOL JoinAvenueEntry_IsEmpty(JoinAvenueEntry *entry);
BOOL JoinAvenueEntry_IsValid(JoinAvenueEntry *entry);
u32 JoinAvenueEntry_GetParam(JoinAvenueEntry *entry, JoinAvenuePersonParam param, void *buffer);
void JoinAvenueEntry_SetParam(JoinAvenueEntry *entry, JoinAvenuePersonParam param, u32 value);
u32 JoinAvenueEntry_Random(JoinAvenueEntry *entry, int count, u32 max);
// Whether the person has the extra data of the index
BOOL JoinAvenuePerson_HasExtraData(JoinAvenuePerson *person, u32 index);
JoinAvenueShop *JoinAvenuePerson_GetShop(JoinAvenuePerson *person);
// The shop the player would run: the player's own choice, or the default one of the player's ID and version
u32 JoinAvenuePerson_GetShopId(JoinAvenuePerson *person, PlayerInfo *playerInfo);
// The fields of a person's shop: 0 the ID, 1 the level, 2 and 3 the flags
u32 JoinAvenueShop_GetField(JoinAvenueShop *shop, u32 which);
void JoinAvenueShop_SetField(JoinAvenueShop *shop, u32 which, u32 value);
BOOL JoinAvenueShop_GetFlag(JoinAvenueShop *shop, u32 bit);
void JoinAvenueShop_SetFlag(JoinAvenueShop *shop, u32 bit, BOOL set);
// Makes the person a copy of src, or of the entry, at the slot and row, with the shop set up
void JoinAvenuePerson_InitFromPerson(JoinAvenuePerson *person, const JoinAvenuePerson *src, ResortShopData *shops,
                                     u32 slot, u16 row);
void JoinAvenuePerson_InitFromEntry(JoinAvenuePerson *person, const JoinAvenueEntry *entry, ResortShopData *shops,
                                    u32 slot, u16 row);

// The avenue's people: 8 of 0xc4 bytes, then 4 of 0x58 bytes, and the player's own entry at 0x780
JoinAvenueOccupants *getAddressOfBeginningOfOccupants(JoinAvenueSave *joinAvenue);
void JoinAvenueOccupants_Init(JoinAvenueOccupants *occupants);
JoinAvenuePerson *JoinAvenueOccupants_GetPerson(JoinAvenueOccupants *occupants, u32 index);
// The number of the eight people who are there
u32 JoinAvenueOccupants_CountPeople(JoinAvenueOccupants *occupants);
JoinAvenueRecord *JoinAvenueOccupants_GetRecord(JoinAvenueOccupants *occupants, u32 index);
// The number of the four records that are not empty
u32 JoinAvenueOccupants_CountRecords(JoinAvenueOccupants *occupants);
// The first empty record, or NULL
JoinAvenueRecord *JoinAvenueOccupants_GetEmptyRecord(JoinAvenueOccupants *occupants);
// Merges a visitor (kind 0), a person (1) or an entry (2) into the occupant or record who matches
u32 JoinAvenueOccupants_Merge(JoinAvenueOccupants *occupants, const void *source, u32 kind);
void JoinAvenueOccupants_SetLocked(JoinAvenueOccupants *occupants, u32 locked);
void JoinAvenueOccupants_ResetDaily(JoinAvenueOccupants *occupants, BOOL fullDay);
JoinAvenuePerson *JoinAvenueOccupants_GetPlayerPerson(JoinAvenueOccupants *occupants);
// The records: allocated, freed and cleared as a person is
JoinAvenueRecord *JoinAvenueRecord_Create(HeapID heapId);
void JoinAvenueRecord_Free(JoinAvenueRecord *record);
void JoinAvenueRecord_Clear(JoinAvenueRecord *record);
BOOL JoinAvenueRecord_IsEmpty(JoinAvenueRecord *record);
// A field of a record, which reads into the buffer for a name, as joinAveTextHandler does for a person
u32 JoinAvenueRecord_GetParam(JoinAvenueRecord *record, JoinAvenuePersonParam param, void *buffer);
void JoinAvenueRecord_SetParam(JoinAvenueRecord *record, JoinAvenuePersonParam param, u32 value);
// Makes the record of a person, or of an entry, at the slot and row
void JoinAvenueRecord_InitFromPerson(JoinAvenueRecord *record, const JoinAvenuePerson *person, u32 slot, u32 row,
                                     u16 shopKind);
void JoinAvenueRecord_InitFromEntry(JoinAvenueRecord *record, const JoinAvenueEntry *entry, u32 slot, u32 row,
                                    u16 shopKind);
u32 JoinAvenueRecord_Random(JoinAvenueRecord *record, int count, u32 max);

// The shop a person runs: the shop of the ID, or the default one of the trainer ID and version when there is none or
// it may not be run
u16 JoinAvenue_ChooseShop(u16 shopId, u16 trainerId, u16 version, BOOL unk18, JoinAvenueInfo *info,
                          ResortShopData *shops);
// A random number of the count-th step of the generator from the seed: below max, or any if max is 0
u32 JoinAvenue_RandomFromSeed(u32 seed, int count, u32 max);
u32 JoinAvenueInfo_Random(JoinAvenueInfo *info, int count, u32 max);

#endif // POKEBW2_SAVE_JOIN_AVENUE_H
