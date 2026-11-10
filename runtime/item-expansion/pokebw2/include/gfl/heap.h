#ifndef POKEBW2_GFL_HEAP_H
#define POKEBW2_GFL_HEAP_H

// Names, layouts and constants from swan (https://github.com/ds-pokemon-hacking/swan, GPL-3.0)

#include "types.h"
#include "nnsys/fnd.h"

typedef u16 HeapID;

enum {
    HEAPID_SYSTEM = 0x0,
    HEAPID_USER = 0x1,
    HEAPID_GAMESYSTEM = 0x3,
    HEAPID_GAMEEVENT = 0x4,
    HEAPID_TRIAL_HOUSE = 0x5,
    HEAPID_SAVEDATA = 0x7,
    HEAPID_NET = 0x8,
    HEAPID_DEVICE_ALLOC = 0x9,
    HEAPID_STARTMENU = 0xb,
    HEAPID_DLP = 0xc,
    // Not from swan: the bag's heap, overlay 142
    HEAPID_BAG = 0xe,
    // Not from swan: the heap of the Nintendo Wi-Fi Connection settings, overlay 182
    HEAPID_DWC_UTILITY = 0xf,
    // Not from swan: the battle's heap, which overlay 167 allocates its Pokémon and parties from
    HEAPID_BATTLE = 0x12,
    HEAPID_FIELDMAP = 0x15,
    HEAPID_TITLE = 0x16,
    HEAPID_POKELIST = 0x17,
    // Mystery Gift's (not from swan)
    HEAPID_MYSTERY = 0x1d,
    HEAPID_NAMEIN = 0x1e,
    HEAPID_IRC_BATTLE_MENU = 0x1f,
    HEAPID_TRAINER_CARD = 0x26,
    HEAPID_PMS_INPUT_SYS = 0x29,
    HEAPID_PMS_INPUT = 0x2a,
    HEAPID_MUSICAL_EVENT = 0x2c,
    HEAPID_MUSICAL_DRESSUP = 0x2d,
    HEAPID_MUSICAL = 0x2e,
    HEAPID_DEBUG_GENDER_SELECT = 0x39,
    // Not from swan: the compatibility result's, overlay 179
    HEAPID_IRC_COMPAT = 0x3c,
    // The Union Room's, a child of HEAPID_GAMEEVENT (union_comm.c)
    HEAPID_UNION = 0x41,
    // Not from swan: the summary screen's heap
    HEAPID_P_STATUS = 0x42,
    // Not from swan: the Global Trade Station's heap
    HEAPID_WORLDTRADE = 0x48,
    HEAPID_MICTEST = 0x49,
    // Not from swan: the musical photo's heap, overlay 209
    HEAPID_MUSICAL_SHOT = 0x4a,
    HEAPID_BOX2 = 0x4b,
    HEAPID_BOX2_APP = 0x4c,
    HEAPID_FIELD_PARTICLE = 0x50,
    // Not from swan: the phrase select's heap
    HEAPID_PMS_SELECT = 0x51,
    HEAPID_BATTLE_RETURN = 0x52,
    // Not from swan: the heap of the Hall of Fame's save screen and of the lost battle's message, overlay 295
    HEAPID_GAME_CLEAR_SAVE = 0x54,
    // Not from swan: the Battle Recorder's heaps, br_main.c's and the one its screens share
    HEAPID_BATTLE_RECORDER_SYS = 0x59,
    HEAPID_BATTLE_RECORDER = 0x5a,
    // Not from swan: the DS Download Play parent's heap, overlay 181
    HEAPID_MB_PARENT = 0x5d,
    // Not from swan: the Entralink monolith's heap
    HEAPID_MONOLITH = 0x61,
    HEAPID_GAMESYNC = 0x67,
    // The evolution demo's graphics, which it frees while another screen runs
    HEAPID_SHINKA_DEMO_GRAPHIC = 0x68,
    // Not from swan: the Pokédex's heap, overlay 302
    HEAPID_ZUKAN = 0x69,
    // Not from swan: the Pokédex registration's heap, overlay 297
    HEAPID_ZUKAN_TOROKU = 0x6a,
    HEAPID_DEMO3D = 0x6c,
    // Not from swan: the Xtransceiver's heap, and the heap of its camera
    HEAPID_COMM_TVT = 0x6d,
    HEAPID_CTVT_CAMERA = 0x6e,
    HEAPID_INTRO = 0x6f,
    HEAPID_FIELD_MENU = 0x70,
    // Not from swan: the heap of the multi battle's list of both teams (overlay 171)
    HEAPID_VS_MULTI_LIST = 0x71,
    HEAPID_BATTLE_LOAD = 0x76,
    HEAPID_WIFILOGIN = 0x78,
    HEAPID_WIFILOGOUT = 0x79,
    // Not from swan: the Unity Tower's floor select, overlay 311
    HEAPID_UN_SELECT = 0x7a,
    // Not from swan: the Pokédex opening's
    HEAPID_ZUKAN_OPEN = 0x7e,
    HEAPID_CDEMO = 0x7f,
    // Not from swan: the heap of the Battle Subway's records screen (overlay 141)
    HEAPID_BSUBWAY_RECORDS = 0x80,
    HEAPID_SAVEDATA_DELETE = 0x81,
    // Not from swan: the heap of the diplomas, overlays 313 to 315
    HEAPID_AWARD = 0x83,
    HEAPID_PDC = 0x85,
    // Not from swan: the heap of the "THE END" picture (overlay 267) and of the subway map (overlay 317), which never
    // run together
    HEAPID_THE_END = 0x88,
    HEAPID_SUBWAY_MAP = 0x88,
    HEAPID_FIELD_CLACT = 0x89,
    // Not from swan: the C-Gear's help screens' heap, overlay 200
    HEAPID_CG_HELP = 0x8a,
    // Not from swan: the credits' heap, overlay 266
    HEAPID_STAFF_ROLL = 0x8e,
    HEAPID_EGG_DEMO = 0x8f,
    // Not from swan: the trade's, in overlay 194's own memory
    HEAPID_POKEMON_TRADE = 0x91,
    HEAPID_FIELD_WEATHER = 0x92,
    HEAPID_FIELD_PLACE_NAME = 0x93,
    HEAPID_SHINKA_DEMO = 0x94,
    HEAPID_ZUKAN_DETAIL = 0x95,
    HEAPID_FIELD_SCENEAREA = 0x96,
    HEAPID_BOX_SEARCH = 0x98,
    HEAPID_MEDAL_INFO = 0x99,
    // Not from swan: the heap of the Pokéstar Studios movie's opening, overlay 321
    HEAPID_PKWD_COUNT = 0x9a,
    // Unova Link's (not from swan)
    HEAPID_KEY_SYSTEM = 0x9b,
    // Not from swan: the Opelucid City gym's, overlay 99
    HEAPID_GYM_OPELUCID = 0x9c,
    // Not from swan: the heap of the Pokémon World Tournament's win record and downloaded tournaments, overlay 326
    HEAPID_WBT_RECORD = 0x9e,
    // Not from swan: the tournament download's, overlay 327: the process's own and the one of its Wi-Fi download
    HEAPID_WBT_DOWNLOAD = 0xa2,
    HEAPID_WBT_DOWNLOAD_NET = 0xa3,
    // Not from swan: the Marine Tube board's
    HEAPID_MARINE_TUBE_BOARD = 0xa8,
};

// Allocates from the end of the heap instead of the start
#define HEAPID_TAIL_BIT 0x8000
#define HEAPID_TAIL(heapId) ((HeapID)(((heapId) & (HEAPID_TAIL_BIT - 1)) | HEAPID_TAIL_BIT))

// A heap that GFL_MemInit creates from the main arena
typedef struct {
    u32 size;
    u32 unk4;
} HeapDef;

// Creates the root heaps, after reserving reserveSize bytes of the arena, with room for maxHeapIds heap IDs
void GFL_MemInit(const HeapDef *defs, u32 rootCount, u32 maxHeapIds, u32 reserveSize);
void GFL_HeapCreateChild(HeapID parentHeapId, HeapID heapId, u32 size);
// Creates a heap in memory the caller owns
void GFL_HeapCreateRoot(void *memory, u32 size, HeapID heapId);
void GFL_HeapDelete(HeapID heapId);
void *GFL_HeapAllocate(HeapID heapId, u32 size, BOOL clear, const char *file, u16 line);
#if defined(WHITE2) && (defined(W2U_SPRITE_STREAMS) || defined(W2U_EXPANDED_ITEMS) || defined(W2U_SHARED_BATTLE)) &&   \
    !defined(BLACK2)
// Optional presentation storage keeps normal block metadata but may return NULL.
void *GFL_HeapTryAllocate(HeapID heapId, u32 size, BOOL clear, const char *file, u16 line);
#endif
void GFL_HeapFree(void *ptr);
void GFL_HeapCreateAllocator(NNSFndAllocator *allocator, HeapID heapId, int alignment);
// Shrinks or grows a block in place
void GFL_HeapResize(void *ptr, u32 size);
u32 GFL_HeapGetFreeSize(HeapID heapId);
void GFL_HeapCreateRoot(void *memory, u32 size, HeapID heapId);
BOOL GFL_HeapStatusValidate(HeapID heapId);
void GFL_HeapDumpOnFailure(HeapID heapId);
void GFL_HeapDTCMInit(u32 size);
void *GFL_HeapDTCMAllocate(u32 size);
void _freeBlkFromDTCM(void *ptr);

#endif // POKEBW2_GFL_HEAP_H
