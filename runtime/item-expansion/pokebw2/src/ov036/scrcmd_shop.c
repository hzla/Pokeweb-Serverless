// The shops: the command that opens a shop's menu over the field, and the menu, which sells items for money (Poké
// Marts), Battle Points (the BP shop) or shards (the move tutors, whose moves the menu lists). The name is the ROM's
// own, from GFL_HeapAllocate's file argument. Function names from swan
// (https://github.com/ds-pokemon-hacking/swan, GPL-3.0)
// Additional helper and table names are our descriptive guesses.
#include "types.h"
#include "constants/arc.h"
#include "constants/field_script.h"
#include "constants/items.h"
#include "constants/moves.h"
#include "constants/script_text_banks.h"
#include "constants/sound.h"
#include "constants/text_banks.h"
#include "field/event_poke_status.h"
#include "field/field.h"
#include "field/field_camera.h"
#include "field/field_msgbg.h"
#include "field/field_script.h"
#include "field/game_beacon_set.h"
#include "field/musical.h"
#include "field/scrcmd_shop.h"
#include "gfl/arc.h"
#include "gfl/arc_util.h"
#include "gfl/bg_sys.h"
#include "gfl/bmp.h"
#include "gfl/bmpwin.h"
#include "gfl/clact.h"
#include "gfl/heap.h"
#include "gfl/key.h"
#include "gfl/msg.h"
#include "gfl/overlay.h"
#include "gfl/sound.h"
#include "gfl/str.h"
#include "gfl/tcbl.h"
#include "nitro/gx.h"
#include "pml/item.h"
#include "pml/poke_party.h"
#include "save/bag.h"
#include "save/bsubway_save.h"
#include "save/event_work.h"
#include "save/high_link.h"
#include "save/records.h"
#include "save/save_control.h"
#include "system/bmp_menu.h"
#include "system/bmp_menulist.h"
#include "system/bmp_menuwork.h"
#include "system/bmp_winframe.h"
#include "system/game_data.h"
#include "system/game_event.h"
#include "system/game_system.h"
#include "system/printsys.h"
#include "system/str_tool.h"
#include "system/text_speed.h"
#include "system/vm.h"
#include "system/wordset.h"
#include "text/script/scrcmd_shop.h"

// The command's shop IDs past the Poké Marts', whose items are in file ID + 6 of ARCID_SHOP_ITEMS. The special marts'
// stock grows with a level that KeyDataSave_GetProgress keeps in the key system's data, its value 0 for 0xf7 to 0xfa
// and 1 for 0xef to 0xf2
#define SHOP_ID_SPECIAL_MART_1_FIRST 0xef
#define SHOP_ID_SPECIAL_MART_1_LAST 0xf2
#define SHOP_ID_MOVE_TUTOR_NACRENE 0xf3
#define SHOP_ID_MOVE_TUTOR_HUMILAU 0xf4
#define SHOP_ID_MOVE_TUTOR_LENTIMAS 0xf5
#define SHOP_ID_MOVE_TUTOR_DRIFTVEIL 0xf6
#define SHOP_ID_SPECIAL_MART_0_FIRST 0xf7
#define SHOP_ID_SPECIAL_MART_0_LAST 0xfa
#define SHOP_ID_BP_TMS 0xfd
#define SHOP_ID_BP_ITEMS 0xfe
// The Poké Mart whose items grow with the badges
#define SHOP_ID_BADGE_MART 0xff

// What the menu lists: items, TMs with their numbers and moves, or a move tutor's moves
#define SHOP_LIST_ITEMS 0
#define SHOP_LIST_TMS 1
#define SHOP_LIST_MOVES 2

// What the menu sells for: money, Battle Points or a move tutor's shards
#define SHOP_CURRENCY_MONEY 0
#define SHOP_CURRENCY_BP 1
#define SHOP_CURRENCY_SHARDS 2

// The variables the move tutor's script reads once a move was bought: 0 if no Pokémon was chosen, 2 if the chosen one
// can learn the move and 1 if it can't, then the move, the slot of the Pokémon that learns it and the price
#define SHOP_VAR_RESULT (VARS_START + 12)
#define SHOP_VAR_MOVE (VARS_START + 13)
#define SHOP_VAR_SLOT (VARS_START + 14)
#define SHOP_VAR_PRICE (VARS_START + 15)

// The archives of the Poké Marts' item lists, and of the number of items in each list
#define ARCID_SHOP_ITEMS 282
#define ARCID_SHOP_ITEM_COUNTS 283

typedef struct {
    u16 item;
    u32 price;
} ShopItem;

typedef struct {
    ShopItem item;
    // The move's place in the tutor's list, where the menu shows it
    u16 index;
} MoveTutorShopItem;

typedef struct {
    u16 shopId;
    // The file of the items for each level
    u8 fileIds[6];
} SpecialPokeMartHeader;

typedef struct {
    u32 bg;
    u8 x;
    u8 y;
    u8 width;
    u8 height;
    u16 palette;
    u16 baseTile;
} ShopWindowSetup;

typedef struct {
    u32 x;
    u32 y;
    u32 width;
    u32 height;
} ShopRect;

// Cell actor resources, as the ClActSys_LoadChars family returns them
typedef struct {
    u32 palette;
    u32 chars;
    u32 cellAnims;
} ShopClActRes;

// The arguments of overlay 20's party list, where the player chooses who learns a tutor's move
typedef struct {
    u16 *chosen;
    u16 *slot;
    // A bit for each Pokémon that can learn the move
    u8 learnable;
    u16 move;
} ShopMoveTutorListArgs;

typedef struct {
    u8 state;
    // The state after a message
    u8 nextState;
    u16 unk2;
    HeapID heapId;
    Font *font;
    TrainerCardSave *trainerCard;
    BagSave *bag;
    GameRecords *records;
    BSubwayScoreData *bsubwayScore;
    KeyDataSave *keyData;
    ShopItem entries[45];
    u16 entryCount;
    u8 listMode;
    u8 currency;
    BmpWin *windows[7];
    ListMenuOption *options;
    BmpMenu *confirmDialog;
    MsgData *msgData;
    MsgData *itemInfoMsgData;
    WordSet *wordSet;
    StrBuf *priceFormat;
    StrBuf *message;
    StrBuf *moveLabelFormat;
    StrBuf *ownedLabel;
    BmpMenuList *list;
    PrintWindow printWindow;
    PrintQueue *printQueue;
    TCBExManager *tcbManager;
    PrintStream *printStream;
    ClActUnit *clactUnit;
    ClActor *actors[5];
    ShopClActRes res[3];
    ArcTool *iconArc;
    u16 item;
    u32 price;
    u32 maxAmount;
    s16 amount;
    u16 listShown;
    u32 tutorIndex;
    MsgData *moveInfoMsgData;
    BOOL boughtMove;
    u16 move;
    // Each entry's place in the tutor's list
    u16 tutorMoveIndices[45];
    u16 tutorMoveIndex;
} ShopUIWork;

typedef struct {
    u8 state;
    u8 unk1;
    u8 shopId;
    // The Poké Marts' list, the shop ID itself
    u8 subId;
    BOOL useBoundary;
    ShopUIWork work;
    // What overlay 20's party list returns
    u16 chosen;
    u16 slot;
} ShopScriptWork;

static void StartShopCameraAnime(ShopScriptWork *shop, Field *field, FieldCamera *camera);
static BOOL ScriptNative_UpdateShopUI(VM *vm, void *env);
static void ShopUI_Init(GameSystem *gsys, ShopUIWork *wk, u32 shopId, u32 subId);
static void ShopUI_LoadCurrencyDispMsg(ShopUIWork *wk, u8 currency);
static u32 ShopUI_GetBalance(ShopUIWork *wk);
static void ShopUI_TryBuyItem(ShopUIWork *wk);
static void ShopUI_TryBuyMove(ShopUIWork *wk);
static void ShopUI_UpdateItemBrowse(ShopUIWork *wk);
static u8 ShopUI_WaitAB(ShopUIWork *wk);
static void ShopUI_SpendMoney(ShopUIWork *wk, u32 amount);
static BOOL ShopUI_Update(GameSystem *gsys, ShopUIWork *wk, u32 shopId, u32 subId);
static BOOL ShopUI_CheckSellingTMHM(ShopItem *items, int count);
static void ShopUI_AppendOption(ShopUIWork *wk, u32 index, u8 mode, u32 item, MsgData *msgData);
static void ShopUI_LoadPokeMartItems(ShopUIWork *wk, u32 shopId, u32 fileId, u32 badges);
static void ShopUI_LoadBPShopItems(ShopUIWork *wk, u32 index);
static void ShopUI_LoadSpecialPokeMartItems(ShopUIWork *wk, int shopId);
static void ShopUI_LoadMoveTutorItems(ShopUIWork *wk, u32 tutor);
static void ShopUI_FreeListMenu(ShopUIWork *wk);
static u32 ShopUI_LoadMsgData(ShopUIWork *wk, u32 shopId);
static void ShopUI_FreeText(ShopUIWork *wk);
static void ShopUI_LoadG2D(ShopUIWork *wk);
static void ShopUI_FreeBG(ShopUIWork *wk);
static void ShopUI_CreateCellActors(ShopUIWork *wk);
static void ShopUI_LoadItemIconResources(ShopUIWork *wk);
static void ShopUI_LoadItemSprite(ShopUIWork *wk, u16 item);
static void ShopUI_CreateActors(ShopUIWork *wk);
static void ShopUI_SetupSprites(ShopUIWork *wk);
static void ShopUI_FreeClActResources(ShopUIWork *wk);
static void ShopUI_SetupBmpWin(ShopUIWork *wk);
static void ShopUI_FreeSprites(ShopUIWork *wk);
static void ShopUI_UpdateMoneyDisp(ShopUIWork *wk);
static void ShopUI_PrintBagCount(ShopUIWork *wk, u16 item);
static void ShopUI_PrintDescription(ShopUIWork *wk, u16 item);
static void ShopUI_UpdateItemAmountDisp(ShopUIWork *wk, u16 amount, u32 price);
static void ShopUI_SetupMenuList(ShopUIWork *wk);
static void ShopUI_PrintToRow(PrintQueue *queue, GFLBitmap *bitmap, int x, int y, const StrBuf *strbuf, Font *font,
                              u16 color);
static void ShopUI_PrintPrice(BmpMenuList *list, s32 value, u8 y);
static void ShopUI_PrintTMPrice(BmpMenuList *list, s32 value, u8 y);
static void ShopUI_CursorCallback(BmpMenuList *list, s32 value, u8 init);
static void ShopUI_FreeMenuList(ShopUIWork *wk);
static BOOL func_ov036_021ad6e0(u32 event);
static void ShopUI_SetStatusDialogue(ShopUIWork *wk, u32 msgId, u16 item, BOOL plural);
static void ShopUI_SetBuyConfirmMessage(ShopUIWork *wk, u8 listMode);
static void ShopUI_DrawMessageFrame(BmpWin *window);
static void ShopUI_PrintMessageInFrame(ShopUIWork *wk, u32 msgId);
static void ShopUI_PrintItemBuyMessage(ShopUIWork *wk, u32 msgId, u16 item, u32 price, u16 amount);
static void ShopUI_PrintTMBuyMessage(ShopUIWork *wk, u32 msgId, u16 item, u32 price);
static void ShopUI_SetupMoveBuyMsg(ShopUIWork *wk, u32 msgId, u16 move, u32 price);
static u32 ShopUI_ChangeItemAmount(s16 *amount, u16 max, s32 delta);
static u8 ShopUI_UpdateInput(ShopUIWork *wk);
static void ShopUI_ClearListScreen(u32 index);
static void GetMoveTutorShopSortimentBits(GameSystem *gsys, u32 moveIndex, u32 tutor, u8 *learnable);

static const u8 BP_SHOP_ITEM_COUNTS[] = { 42, 18 };

static const u8 MOVE_TUTOR_SHOP_ITEM_COUNTS[] = { 15, 17, 13, 15 };

static const ConfirmDialogSetup sConfirmDialogSetup = { 1, 24, 13, 11, 25 };

// The price's format for money and for Battle Points
static const u32 SHOP_UI_CURRENCY_MSGIDS[] = { ScrcmdShop_Text_Empty_10, ScrcmdShop_Text_Bp_3 };

static const u16 MOVE_TUTOR_CURRENCY_ITEMS[] = { ITEM_RED_SHARD, ITEM_BLUE_SHARD, ITEM_YELLOW_SHARD, ITEM_GREEN_SHARD };

// The list file of the badge Poké Mart for each number of badges
static const u8 BADGE_SHOP_DAT_IDS[] = { 0, 1, 1, 2, 2, 3, 3, 4, 5 };

static const ShopWindowSetup sWindowShards = { 1, 5, 2, 5, 2, 11, 38 };

static const ShopWindowSetup sWindowBP = { 1, 2, 2, 8, 2, 11, 38 };

static const ShopWindowSetup sWindowList = { 1, 12, 1, 19, 16, 2, 54 };

static const ShopWindowSetup sWindowInfo = { 1, 5, 18, 27, 6, 11, 469 };

static const ShopWindowSetup sWindowTitle = { 1, 1, 1, 9, 2, 11, 20 };

static const ShopWindowSetup sWindowMoney = { 1, 1, 3, 9, 2, 11, 38 };

static const ShopWindowSetup sWindowInBag = { 1, 1, 15, 15, 2, 11, 415 };

static const ShopWindowSetup sWindowAmount = { 1, 18, 15, 13, 2, 11, 447 };

static const ShopWindowSetup sWindowMoveInfo = { 1, 1, 18, 30, 6, 11, 469 };

static const ShopWindowSetup sWindowMessage = { 1, 1, 19, 30, 4, 11, 631 };

// The level of a special mart for each value of KeyDataSave_GetProgress
static const int sSpecialMartLevels[] = { 0, 2, 4, 6, 8, 10 };

// The areas of BG 1 that the list's windows cover: all of them, and those of the amount
static const ShopRect sListRects[] = {
    { 0, 12, 32, 12 },
    { 0, 12, 32, 6 },
};

// clang-format off
static const ClActorSetup sActorSetups[] = {
    { 172, 22, 0, 0, 1 },
    { 172, 92, 0, 0, 0 },
    { 172, 132, 1, 0, 0 },
    { 224, 128, 2, 0, 0 },
    { 21, 172, 0, 0, 1 },
};

// clang-format on

// Where the camera looks while the shop is open, from the target, for each way the player faces
static const VecFx32 sCameraTargetOffsets[] = {
    { FX32_CONST(64), 0, FX32_CONST(-16) },
    { FX32_CONST(64), FX32_CONST(-32), 0 },
    { FX32_CONST(64), 0, 0 },
    { FX32_CONST(80), FX32_CONST(-16), 0 },
};

// clang-format off
static const SpecialPokeMartHeader SPECIAL_POKE_MART_HEADERS[] = {
    { 0xf7, { 26, 27, 28, 29, 30, 31 } },
    { 0xf8, { 32, 33, 34, 35, 36, 37 } },
    { 0xf9, { 38, 39, 40, 41, 42, 43 } },
    { 0xfa, { 44, 45, 46, 47, 48, 49 } },
    { 0xef, { 50, 51, 52, 53, 54, 55 } },
    { 0xf0, { 56, 57, 58, 59, 60, 61 } },
    { 0xf1, { 62, 63, 64, 65, 66, 67 } },
    { 0xf2, { 68, 69, 70, 71, 72, 73 } },
};

// clang-format on

// clang-format off
static const ShopItem BP_SHOP_ITEMS_TMS[] = {
    { ITEM_TM17, 6 },
    { ITEM_TM20, 6 },
    { ITEM_TM32, 6 },
    { ITEM_TM59, 6 },
    { ITEM_TM31, 12 },
    { ITEM_TM79, 12 },
    { ITEM_TM89, 12 },
    { ITEM_TM10, 18 },
    { ITEM_TM23, 18 },
    { ITEM_TM48, 18 },
    { ITEM_TM75, 18 },
    { ITEM_TM87, 18 },
    { ITEM_TM88, 18 },
    { ITEM_TM34, 24 },
    { ITEM_TM51, 24 },
    { ITEM_TM60, 24 },
    { ITEM_TM64, 24 },
    { ITEM_TM77, 24 },
};

// clang-format on

// clang-format off
static const MoveTutorShopItem MOVE_TUTOR_ITEMS_HUMILAU_CITY[] = {
    { { MOVE_BIND, 2 }, 0 },
    { { MOVE_SNORE, 2 }, 1 },
    { { MOVE_KNOCK_OFF, 4 }, 3 },
    { { MOVE_SYNTHESIS, 6 }, 4 },
    { { MOVE_HEAT_WAVE, 10 }, 8 },
    { { MOVE_ROLE_PLAY, 8 }, 7 },
    { { MOVE_HEAL_BELL, 4 }, 2 },
    { { MOVE_TAILWIND, 10 }, 12 },
    { { MOVE_SKY_ATTACK, 8 }, 6 },
    { { MOVE_PAIN_SPLIT, 10 }, 11 },
    { { MOVE_GIGA_DRAIN, 10 }, 9 },
    { { MOVE_DRAIN_PUNCH, 10 }, 10 },
    { { MOVE_ROOST, 6 }, 5 },
};

// clang-format on

// clang-format off
static const MoveTutorShopItem MOVE_TUTOR_ITEMS_DRIFTVEIL_CITY[] = {
    { { MOVE_BUG_BITE, 2 }, 1 },
    { { MOVE_COVET, 2 }, 0 },
    { { MOVE_SUPER_FANG, 6 }, 6 },
    { { MOVE_DUAL_CHOP, 6 }, 9 },
    { { MOVE_SIGNAL_BEAM, 4 }, 4 },
    { { MOVE_IRON_HEAD, 4 }, 5 },
    { { MOVE_SEED_BOMB, 6 }, 8 },
    { { MOVE_DRILL_RUN, 4 }, 2 },
    { { MOVE_BOUNCE, 4 }, 3 },
    { { MOVE_LOW_KICK, 8 }, 10 },
    { { MOVE_GUNK_SHOT, 8 }, 11 },
    { { MOVE_UPROAR, 6 }, 7 },
    { { MOVE_THUNDER_PUNCH, 10 }, 13 },
    { { MOVE_FIRE_PUNCH, 10 }, 12 },
    { { MOVE_ICE_PUNCH, 10 }, 14 },
};

// clang-format on

// clang-format off
static const MoveTutorShopItem MOVE_TUTOR_ITEMS_NACRENE_CITY[] = {
    { { MOVE_GASTRO_ACID, 6 }, 1 },
    { { MOVE_WORRY_SEED, 6 }, 0 },
    { { MOVE_SPITE, 8 }, 6 },
    { { MOVE_AFTER_YOU, 8 }, 3 },
    { { MOVE_HELPING_HAND, 8 }, 2 },
    { { MOVE_TRICK, 10 }, 8 },
    { { MOVE_MAGIC_ROOM, 8 }, 4 },
    { { MOVE_WONDER_ROOM, 8 }, 5 },
    { { MOVE_ENDEAVOR, 12 }, 11 },
    { { MOVE_OUTRAGE, 10 }, 10 },
    { { MOVE_RECYCLE, 10 }, 7 },
    { { MOVE_SNATCH, 12 }, 14 },
    { { MOVE_STEALTH_ROCK, 10 }, 9 },
    { { MOVE_SLEEP_TALK, 12 }, 12 },
    { { MOVE_SKILL_SWAP, 12 }, 13 },
};

// clang-format on

// clang-format off
static const MoveTutorShopItem MOVE_TUTOR_ITEMS_LENTIMAS_TOWN[] = {
    { { MOVE_MAGIC_COAT, 4 }, 3 },
    { { MOVE_BLOCK, 6 }, 4 },
    { { MOVE_EARTH_POWER, 8 }, 10 },
    { { MOVE_FOUL_PLAY, 8 }, 12 },
    { { MOVE_GRAVITY, 10 }, 14 },
    { { MOVE_MAGNET_RISE, 4 }, 2 },
    { { MOVE_IRON_DEFENSE, 2 }, 1 },
    { { MOVE_LAST_RESORT, 2 }, 0 },
    { { MOVE_SUPERPOWER, 10 }, 13 },
    { { MOVE_ELECTROWEB, 6 }, 6 },
    { { MOVE_ICY_WIND, 6 }, 7 },
    { { MOVE_AQUA_TAIL, 8 }, 9 },
    { { MOVE_DARK_PULSE, 10 }, 16 },
    { { MOVE_ZEN_HEADBUTT, 8 }, 11 },
    { { MOVE_DRAGON_PULSE, 10 }, 15 },
    { { MOVE_HYPER_VOICE, 6 }, 5 },
    { { MOVE_IRON_TAIL, 6 }, 8 },
};

// clang-format on

// clang-format off
static const ShopItem BP_SHOP_ITEMS_NORMAL[] = {
    { ITEM_PROTEIN, 1 },
    { ITEM_CALCIUM, 1 },
    { ITEM_IRON, 1 },
    { ITEM_ZINC, 1 },
    { ITEM_CARBOS, 1 },
    { ITEM_HP_UP, 1 },
    { ITEM_FIRE_STONE, 3 },
    { ITEM_THUNDERSTONE, 3 },
    { ITEM_WATER_STONE, 3 },
    { ITEM_LEAF_STONE, 3 },
    { ITEM_SCOPE_LENS, 8 },
    { ITEM_WIDE_LENS, 8 },
    { ITEM_MUSCLE_BAND, 8 },
    { ITEM_WISE_GLASSES, 8 },
    { ITEM_RAZOR_CLAW, 8 },
    { ITEM_RAZOR_FANG, 8 },
    { ITEM_BINDING_BAND, 8 },
    { ITEM_BRIGHT_POWDER, 12 },
    { ITEM_FOCUS_BAND, 12 },
    { ITEM_ZOOM_LENS, 12 },
    { ITEM_IRON_BALL, 12 },
    { ITEM_AIR_BALLOON, 12 },
    { ITEM_POWER_BRACER, 16 },
    { ITEM_POWER_BELT, 16 },
    { ITEM_POWER_LENS, 16 },
    { ITEM_POWER_BAND, 16 },
    { ITEM_POWER_ANKLET, 16 },
    { ITEM_POWER_WEIGHT, 16 },
    { ITEM_TOXIC_ORB, 16 },
    { ITEM_FLAME_ORB, 16 },
    { ITEM_WHITE_HERB, 16 },
    { ITEM_POWER_HERB, 16 },
    { ITEM_ABSORB_BULB, 16 },
    { ITEM_CELL_BATTERY, 16 },
    { ITEM_RED_CARD, 16 },
    { ITEM_EJECT_BUTTON, 16 },
    { ITEM_CHOICE_BAND, 24 },
    { ITEM_CHOICE_SPECS, 24 },
    { ITEM_CHOICE_SCARF, 24 },
    { ITEM_FOCUS_SASH, 24 },
    { ITEM_LIFE_ORB, 24 },
    { ITEM_RARE_CANDY, 24 },
};

// clang-format on

static const ShopItem *BP_SHOP_ITEMS[] = { BP_SHOP_ITEMS_NORMAL, BP_SHOP_ITEMS_TMS };

static const MoveTutorShopItem *MOVE_TUTOR_SHOP_ITEMS[] = {
    MOVE_TUTOR_ITEMS_DRIFTVEIL_CITY,
    MOVE_TUTOR_ITEMS_LENTIMAS_TOWN,
    MOVE_TUTOR_ITEMS_HUMILAU_CITY,
    MOVE_TUTOR_ITEMS_NACRENE_CITY,
};

// The windows: the title, the balance, the list, how many the bag holds, the amount, the description and messages
static const ShopWindowSetup *sBPShopWindows[] = {
    &sWindowTitle, &sWindowBP, &sWindowList, &sWindowInBag, &sWindowAmount, &sWindowInfo, &sWindowMessage,
};

static const ShopWindowSetup *sMoveTutorWindows[] = {
    &sWindowTitle, &sWindowShards, &sWindowList, &sWindowInBag, &sWindowAmount, &sWindowMoveInfo, &sWindowMessage,
};

static const ShopWindowSetup *sMartWindows[] = {
    &sWindowTitle, &sWindowMoney, &sWindowList, &sWindowInBag, &sWindowAmount, &sWindowInfo, &sWindowMessage,
};

BOOL s0149_CallFriendlyShopBuy(VM *vm, FieldScriptEnv *env) {
    u16 shopId = ScriptReadAny(vm, env);
    GameSystem *gsys;
    GameData *gameData;
    Field *field;
    void **heapPtr;
    void *msgBGSys;
    ShopScriptWork *shop;

    ScriptReadVar(vm, env);
    gsys = FieldScriptEnv_GetGameSystem(env);
    gameData = GSYS_GetGameData(gsys);
    field = GSYS_GetField(gsys);
    heapPtr = ScriptWork_GetUserHeapPtr(FieldScriptEnv_GetScriptWork(env));
    msgBGSys = Field_GetMsgBGSys(field);
    shop = GFL_HeapAllocate(HEAPID_GAMEEVENT, sizeof(ShopScriptWork), TRUE, "scrcmd_shop.c", 293);
    *heapPtr = shop;
    shop->work.font = func_ov036_0218799c(msgBGSys);
    shop->work.trainerCard = getTrainerCardDataBlkAddress(gameData);
    shop->work.heapId = HEAPID_FIELDMAP;
    shop->work.bag = GameData_GetBag(gameData);
    shop->work.bsubwayScore = SaveControl_GetBlockPtr(GameData_GetSaveControl(gameData), SAVE_BLOCK_BSUBWAY_SCORE);
    shop->work.records = GameData_GetRecords(gameData);
    shop->work.keyData = getKeyDataBlkAddress(GameData_GetSaveControl(gameData));
    switch (shopId) {
    case SHOP_ID_BADGE_MART:
        shop->shopId = shopId;
        break;
    case SHOP_ID_BP_ITEMS:
        shop->shopId = shopId;
        break;
    case SHOP_ID_BP_TMS:
        shop->shopId = shopId;
        break;
    case 0xef:
    case 0xf0:
    case 0xf1:
    case 0xf2:
    case 0xf7:
    case 0xf8:
    case 0xf9:
    case 0xfa:
        shop->shopId = shopId;
        break;
    case SHOP_ID_MOVE_TUTOR_NACRENE:
    case SHOP_ID_MOVE_TUTOR_HUMILAU:
    case SHOP_ID_MOVE_TUTOR_LENTIMAS:
    case SHOP_ID_MOVE_TUTOR_DRIFTVEIL:
        shop->work.tutorIndex = 0;
        shop->shopId = shopId;
        break;
    default:
        // A Poké Mart's list
        shop->shopId = (u8)shopId;
        shop->subId = (u8)shopId;
        break;
    }
    switch (shopId) {
    case SHOP_ID_MOVE_TUTOR_DRIFTVEIL:
        shop->work.tutorIndex = 0;
        break;
    case SHOP_ID_MOVE_TUTOR_LENTIMAS:
        shop->work.tutorIndex = 1;
        break;
    case SHOP_ID_MOVE_TUTOR_HUMILAU:
        shop->work.tutorIndex = 2;
        break;
    case SHOP_ID_MOVE_TUTOR_NACRENE:
        shop->work.tutorIndex = 3;
        break;
    default:
        shop->work.tutorIndex = 0;
        break;
    }
    VM_SetNativeCallback(vm, ScriptNative_UpdateShopUI);
    if (shopId != SHOP_ID_BP_ITEMS && shopId != SHOP_ID_BP_TMS && shopId != SHOP_ID_MOVE_TUTOR_DRIFTVEIL &&
        shopId != SHOP_ID_MOVE_TUTOR_LENTIMAS && shopId != SHOP_ID_MOVE_TUTOR_HUMILAU &&
        shopId != SHOP_ID_MOVE_TUTOR_NACRENE) {
        GameBeacon_BroadcastShopping();
    }
    return TRUE;
}

// Turns the camera toward the counter, from the way the player faces
static void StartShopCameraAnime(ShopScriptWork *shop, Field *field, FieldCamera *camera) {
    FieldEvCameraAnimationSetup setup;
    u32 dir;

    shop->useBoundary = FieldCamera_IsUseBoundaryEnable(camera);
    FieldCamera_SetUseBoundaryEnable(camera, FALSE);
    FieldCameraAnm_EnsureInitDone(camera);
    dir = FieldPlayer_GetFaceDir(Field_GetPlayer(field));
    FieldCamera_CoordsGetEye(camera, &setup.targetCoords.cameraPos);
    FieldCamera_CoordsGetTarget(camera, &setup.targetCoords.targetPos);
    FieldCamera_ClearBind(camera);
    setup.targetCoords.targetPos.x += sCameraTargetOffsets[dir].x;
    setup.targetCoords.targetPos.y += sCameraTargetOffsets[dir].y;
    setup.targetCoords.targetPos.z += sCameraTargetOffsets[dir].z;
    setup.flags.animateExtraTranslation = FALSE;
    setup.flags.animatePitch = FALSE;
    setup.flags.animateYaw = FALSE;
    setup.flags.animateTargetDistance = FALSE;
    setup.flags.animateFOV = FALSE;
    setup.flags.animateTargetPos = TRUE;
    FieldCameraAnm_SetAnimationRealTime(camera, &setup, 10);
}

static BOOL ScriptNative_UpdateShopUI(VM *vm, void *env) {
    ScriptWork *scriptWork = FieldScriptEnv_GetScriptWork(env);
    void **heapPtr = ScriptWork_GetUserHeapPtr(scriptWork);
    ShopScriptWork *shop = *heapPtr;
    GameSystem *gsys = FieldScriptEnv_GetGameSystem(env);
    Field *field = GSYS_GetField(gsys);
    FieldCamera *camera = Field_GetCameraSystem(field);

    switch (shop->state) {
    case 0:
        FieldCamera_FinishDelay(camera);
        shop->state++;
        break;
    case 1:
        if (!FieldCamera_IsDelayActive(camera)) {
            shop->state++;
        }
        break;
    case 2:
        StartShopCameraAnime(shop, field, camera);
        shop->state++;
        break;
    case 3:
        if (!FieldCamera_IsAnimating(camera)) {
            shop->state++;
            shop->work.state = 0;
            setAlphaBlend_wrapper(FALSE);
        }
        break;
    case 4:
        if (ShopUI_Update(gsys, &shop->work, shop->shopId, shop->subId)) {
            if (shop->work.boughtMove == TRUE) {
                shop->state = 8;
            } else {
                shop->state++;
            }
        }
        break;
    case 5: {
        FieldEvCameraAnimationFlags flags = { FALSE, FALSE, FALSE, FALSE, FALSE, TRUE };

        FieldCameraAnm_SetReturnAnimation(camera, &flags, 8);
        shop->state++;
        shop->unk1 = 0;
        break;
    }
    case 6:
        if (!FieldCamera_IsAnimating(camera)) {
            FieldCamera_ResetBind(camera);
            FieldCamera_SetUseBoundaryEnable(camera, shop->useBoundary);
            FieldCamera_EnableDelay(camera);
            FieldCameraAnm_EVCameraEnd(camera);
            setAlphaBlend_wrapper(TRUE);
            shop->state++;
        }
        break;
    case 7:
        GFL_HeapFree(*heapPtr);
        return TRUE;
    case 8: {
        GameEvent *event = ScriptWork_GetEvent(scriptWork);
        ShopMoveTutorListArgs args;

        args.chosen = &shop->chosen;
        args.slot = &shop->slot;
        GetMoveTutorShopSortimentBits(gsys, shop->work.tutorMoveIndex, shop->work.tutorIndex, &args.learnable);
        args.move = shop->work.move;
        GameEvent_ChainNext(event, GameEvent_CreateOverlayDelegate(gsys, OVERLAY_EVENT_POKE_STATUS,
                                                                   EventMoveTutorPokeSelect_Create, &args));
        shop->state++;
        break;
    }
    case 9: {
        EventWork *eventWork = GameData_GetEventWork(GSYS_GetGameData(gsys));
        u16 *result = EventWork_GetWkPtr(eventWork, SHOP_VAR_RESULT);
        u16 *move = EventWork_GetWkPtr(eventWork, SHOP_VAR_MOVE);
        u16 *slot = EventWork_GetWkPtr(eventWork, SHOP_VAR_SLOT);
        u16 *price = EventWork_GetWkPtr(eventWork, SHOP_VAR_PRICE);
        u8 learnable;

        *move = shop->work.move;
        *slot = shop->slot;
        *price = shop->work.price;
        if (shop->chosen != 0) {
            GetMoveTutorShopSortimentBits(gsys, shop->work.tutorMoveIndex, shop->work.tutorIndex, &learnable);
            if (learnable & (1 << shop->slot)) {
                *result = 2;
            } else {
                *result = 1;
            }
        } else {
            *result = 0;
        }
        shop->state = 7;
        break;
    }
    }
    return FALSE;
}

static void ShopUI_Init(GameSystem *gsys, ShopUIWork *wk, u32 shopId, u32 subId) {
    GameData *gameData = GSYS_GetGameData(gsys);

    // The player's info goes unused
    GetGameDataPlayerInfo(gameData);
    wk->listMode = SHOP_LIST_ITEMS;
    shopId = ShopUI_LoadMsgData(wk, shopId);
    switch (shopId) {
    case SHOP_ID_BADGE_MART:
        ShopUI_LoadPokeMartItems(wk, shopId, subId, getBadgeCount(getTrainerCardDataBlkAddress(gameData)));
        break;
    case SHOP_ID_BP_ITEMS:
        ShopUI_LoadBPShopItems(wk, 0);
        wk->currency = SHOP_CURRENCY_BP;
        break;
    case SHOP_ID_BP_TMS:
        wk->currency = SHOP_CURRENCY_BP;
        wk->listMode = SHOP_LIST_TMS;
        ShopUI_LoadBPShopItems(wk, 1);
        break;
    case 0xef:
    case 0xf0:
    case 0xf1:
    case 0xf2:
    case 0xf7:
    case 0xf8:
    case 0xf9:
    case 0xfa:
        ShopUI_LoadSpecialPokeMartItems(wk, shopId);
        break;
    case SHOP_ID_MOVE_TUTOR_NACRENE:
    case SHOP_ID_MOVE_TUTOR_HUMILAU:
    case SHOP_ID_MOVE_TUTOR_LENTIMAS:
    case SHOP_ID_MOVE_TUTOR_DRIFTVEIL:
        wk->currency = SHOP_CURRENCY_SHARDS;
        wk->listMode = SHOP_LIST_MOVES;
        ShopUI_LoadMoveTutorItems(wk, wk->tutorIndex);
        break;
    default:
        ShopUI_LoadPokeMartItems(wk, shopId, subId, 0);
        break;
    }
    ShopUI_LoadCurrencyDispMsg(wk, wk->currency);
    ShopUI_LoadG2D(wk);
    ShopUI_SetupBmpWin(wk);
    ShopUI_SetupSprites(wk);
    ShopUI_UpdateMoneyDisp(wk);
    ShopUI_SetupMenuList(wk);
    if (wk->listMode == SHOP_LIST_MOVES) {
        ShopUI_LoadItemSprite(wk, MOVE_TUTOR_CURRENCY_ITEMS[wk->tutorIndex]);
    }
}

static void ShopUI_LoadCurrencyDispMsg(ShopUIWork *wk, u8 currency) {
    if (currency == SHOP_CURRENCY_SHARDS) {
        wk->priceFormat = GFL_MsgDataLoadStrbufNew(wk->msgData, ScrcmdShop_Text_Shards);
    } else if (currency == SHOP_CURRENCY_BP) {
        wk->priceFormat = GFL_MsgDataLoadStrbufNew(wk->msgData, ScrcmdShop_Text_Bp);
    } else {
        wk->priceFormat = GFL_MsgDataLoadStrbufNew(wk->msgData, ScrcmdShop_Text_Empty_4);
    }
    wk->ownedLabel = GFL_MsgDataLoadStrbufNew(wk->msgData, ScrcmdShop_Text_Empty_5);
}

static u32 ShopUI_GetBalance(ShopUIWork *wk) {
    if (wk->currency == SHOP_CURRENCY_SHARDS) {
        return BagSave_GetItemCountByID(wk->bag, MOVE_TUTOR_CURRENCY_ITEMS[wk->tutorIndex], wk->heapId);
    }
    if (wk->currency == SHOP_CURRENCY_BP) {
        return BSubwayScoreData_GetBattlePoints(wk->bsubwayScore);
    }
    return getCash(wk->trainerCard);
}

// Chooses an item: says why it can't be bought, or asks for the amount, or asks whether to buy one
static void ShopUI_TryBuyItem(ShopUIWork *wk) {
    u32 balance = ShopUI_GetBalance(wk);
    u16 owned = BagSave_GetItemCountByID(wk->bag, wk->item, wk->heapId);

    if (!BagSave_CheckAvailItemSpace(wk->bag, wk->item, 1, wk->heapId)) {
        ShopUI_SetStatusDialogue(wk, ScrcmdShop_Text_CantTakeAnyMore, wk->item, FALSE);
        wk->state = 12;
        wk->nextState = 4;
        return;
    }
    if (balance < wk->price) {
        if (wk->currency == SHOP_CURRENCY_MONEY) {
            ShopUI_SetStatusDialogue(wk, ScrcmdShop_Text_DontHaveEnoughMoney, wk->item, FALSE);
        } else {
            ShopUI_SetStatusDialogue(wk, ScrcmdShop_Text_DontHaveEnoughBp, wk->item, FALSE);
        }
        wk->state = 12;
        wk->nextState = 4;
        return;
    }
    if (balance >= wk->price && balance < wk->price * 2) {
        ShopUI_SetBuyConfirmMessage(wk, wk->listMode);
        wk->state = 12;
        wk->nextState = 5;
        return;
    }
    if (wk->listMode == SHOP_LIST_ITEMS) {
        ShopUI_SetStatusDialogue(wk, ScrcmdShop_Text_CertainlyHowManyWould, wk->item, FALSE);
        wk->state = 12;
        wk->nextState = 2;
        wk->maxAmount = balance / wk->price;
        if (wk->maxAmount > 99) {
            wk->maxAmount = 99;
        }
        if (wk->maxAmount + owned > PML_ItemGetMaxStorageCount(wk->item)) {
            wk->maxAmount = PML_ItemGetMaxStorageCount(wk->item) - owned;
        }
    } else {
        ShopUI_SetBuyConfirmMessage(wk, wk->listMode);
        wk->state = 12;
        wk->nextState = 6;
    }
}

// The same for a move
static void ShopUI_TryBuyMove(ShopUIWork *wk) {
    if (ShopUI_GetBalance(wk) < wk->price) {
        ShopUI_SetStatusDialogue(wk, ScrcmdShop_Text_DontHaveEnough, MOVE_TUTOR_CURRENCY_ITEMS[wk->tutorIndex], TRUE);
        wk->state = 12;
        wk->nextState = 4;
        return;
    }
    ShopUI_SetBuyConfirmMessage(wk, wk->listMode);
    wk->state = 12;
    wk->nextState = 6;
}

static void ShopUI_UpdateItemBrowse(ShopUIWork *wk) {
    s32 index;

    if (!PrintQueue_IsEmpty(wk->printQueue)) {
        return;
    }
    if (wk->listShown == 0) {
        BmpWin_TransferNow(wk->windows[2]);
        wk->listShown++;
    }
    index = BmpMenuList_Update(wk->list);
    if (index == BMPMENULIST_NULL) {
        return;
    }
    if (index == BMPMENULIST_CANCEL) {
        wk->state = 13;
        return;
    }
    wk->item = wk->entries[index].item;
    wk->price = wk->entries[index].price;
    wk->tutorMoveIndex = wk->tutorMoveIndices[index];
    wk->amount = 1;
    if (wk->currency == SHOP_CURRENCY_SHARDS) {
        ShopUI_TryBuyMove(wk);
    } else {
        ShopUI_TryBuyItem(wk);
    }
}

static u8 ShopUI_WaitAB(ShopUIWork *wk) {
    u32 state = PrintStream_GetState(wk->printStream);

    if (state == PRINT_STREAM_DONE) {
        PrintStream_Delete(wk->printStream);
        return wk->nextState;
    } else if (state == PRINT_STREAM_RUNNING) {
        if ((GCTX_HIDGetHeldKeys() & PAD_BUTTON_A) || (GCTX_HIDGetHeldKeys() & PAD_BUTTON_B)) {
            PrintStream_SkipWait(wk->printStream, 0);
        }
    } else if (state == PRINT_STREAM_PAUSED) {
        if ((GCTX_HIDGetPressedKeys() & PAD_BUTTON_A) || (GCTX_HIDGetPressedKeys() & PAD_BUTTON_B)) {
            PrintStream_Continue(wk->printStream);
            GFL_SndSEPlay(SEQ_SE_MESSAGE);
        }
    }
    return wk->state;
}

static void ShopUI_SpendMoney(ShopUIWork *wk, u32 amount) {
    if (wk->currency == SHOP_CURRENCY_MONEY) {
        subCashFromTotal(wk->trainerCard, amount);
        RecordAdd(wk->records, 22, amount);
    } else {
        BSubwayScoreData_SubBattlePoints(wk->bsubwayScore, amount);
        RecordAdd(wk->records, 34, amount);
    }
    RecordAddOne(wk->records, 21);
}

static BOOL ShopUI_Update(GameSystem *gsys, ShopUIWork *wk, u32 shopId, u32 subId) {
    // Six unused bytes retained with the shop menu resources.
    static const u8 sUnk021d091e[6] = { 0 };

    u32 result;

    switch (wk->state) {
    case 0:
        ShopUI_Init(gsys, wk, shopId, subId);
        wk->state++;
        break;
    case 1:
        ShopUI_UpdateItemBrowse(wk);
        break;
    case 2:
        ShopUI_PrintBagCount(wk, wk->item);
        ShopUI_UpdateItemAmountDisp(wk, wk->amount, wk->price);
        ClActor_SetVisible(wk->actors[3], TRUE);
        wk->state = 3;
        break;
    case 3:
        wk->state = ShopUI_UpdateInput(wk);
        break;
    case 4:
        ShopUI_ClearListScreen(0);
        BmpWin_FlushMap(wk->windows[2]);
        BmpWin_FlushMap(wk->windows[5]);
        GFL_BGSysQueueScrLoad(1);
        ClActor_SetVisible(wk->actors[3], FALSE);
        BmpMenuList_Redraw(wk->list);
        wk->state = 1;
        break;
    case 5:
        ShopUI_ClearListScreen(1);
        BmpWin_FlushMap(wk->windows[2]);
        ClActor_SetVisible(wk->actors[3], FALSE);
        wk->confirmDialog = ShopUI_CreateConfirmDialog(&sConfirmDialogSetup, 1, 9, 0, wk->heapId);
        if (wk->listMode != SHOP_LIST_TMS) {
            ShopUI_PrintBagCount(wk, wk->item);
        }
        wk->state = 7;
        break;
    case 6:
        ShopUI_ClearListScreen(1);
        BmpWin_FlushMap(wk->windows[2]);
        ClActor_SetVisible(wk->actors[3], FALSE);
        wk->confirmDialog = ShopUI_CreateConfirmDialog(&sConfirmDialogSetup, 1, 9, 0, wk->heapId);
        wk->state = 7;
        break;
    case 7:
        result = ConfirmDialog_Update(wk->confirmDialog);
        if (result == BMPMENU_NULL) {
            break;
        }
        if (result == 0) {
            if (wk->listMode == SHOP_LIST_MOVES) {
                wk->state = 9;
            } else {
                wk->state = 8;
            }
            ShopUI_ClearListScreen(1);
            BmpMenuList_Redraw(wk->list);
            BmpWin_FlushMap(wk->windows[2]);
            GFL_BGSysQueueScrLoad(1);
        } else if (result == BMPMENU_CANCEL) {
            wk->state = 4;
        }
        break;
    case 8:
        GFL_SndSEPlay(SEQ_SE_SYS_22);
        ShopUI_SetStatusDialogue(wk, ScrcmdShop_Text_HereThankPutAway, wk->item, wk->amount > 1);
        ShopUI_SpendMoney(wk, wk->price * wk->amount);
        ShopUI_UpdateMoneyDisp(wk);
        BagSave_AddItem(wk->bag, wk->item, wk->amount, wk->heapId);
        wk->state = 12;
        wk->nextState = 11;
        break;
    case 9:
        ShopUI_SetStatusDialogue(wk, ScrcmdShop_Text_PickPokemonWantLearn, wk->item, FALSE);
        wk->state = 12;
        wk->nextState = 10;
        break;
    case 10:
        wk->boughtMove = TRUE;
        wk->move = wk->item;
        wk->state = 13;
        break;
    case 11:
        // A Premier Ball for ten Poké Balls
        if (wk->item == ITEM_POKE_BALL && wk->amount >= 10) {
            ShopUI_SetStatusDialogue(wk, ScrcmdShop_Text_AlsoGetPremierBall, wk->item, FALSE);
            BagSave_AddItem(wk->bag, ITEM_PREMIER_BALL, 1, wk->heapId);
            RecordAddOne(wk->records, 31);
            wk->state = 12;
            wk->nextState = 4;
        } else {
            wk->state = 4;
        }
        break;
    case 12:
        wk->state = ShopUI_WaitAB(wk);
        break;
    case 13:
        ShopUI_FreeMenuList(wk);
        ShopUI_FreeClActResources(wk);
        ShopUI_FreeSprites(wk);
        ShopUI_FreeBG(wk);
        ShopUI_FreeListMenu(wk);
        ShopUI_FreeText(wk);
        return TRUE;
    }
    PrintQueue_Main(wk->printQueue);
    PrintWindow_Flush(&wk->printWindow, wk->printQueue);
    GFL_TCBExMgrUpdate(wk->tcbManager);
    GFL_TCBExMgrUpdate(wk->tcbManager);
    return FALSE;
}

static BOOL ShopUI_CheckSellingTMHM(ShopItem *items, int count) {
    BOOL tmhm = PML_ItemIsTMHM(items[0].item);
    int i;

    // Each item's result is dropped: a check that a list doesn't mix TMs with other items, without its assert
    for (i = 0; i < count; i++) {
        PML_ItemIsTMHM(items[i].item);
    }
    return tmhm;
}

static void ShopUI_AppendOption(ShopUIWork *wk, u32 index, u8 mode, u32 item, MsgData *msgData) {
    if (mode == SHOP_LIST_MOVES) {
        loadMoveNameToStrbuf(wk->wordSet, 1, item);
        GFL_WordSetFormatStrbuf(wk->wordSet, wk->message, wk->moveLabelFormat);
        ListMenuCore_AppendStrBufOption(&wk->options[index], wk->message, index, wk->heapId);
    } else if (mode == SHOP_LIST_TMS) {
        WordSetNumber(wk->wordSet, 0, item - ITEM_TM01 + 1, 2, NUM_PAD_ZERO, 1);
        loadMoveNameToStrbuf(wk->wordSet, 1, PML_ItemGetTMWazaID(item));
        GFL_WordSetFormatStrbuf(wk->wordSet, wk->message, wk->moveLabelFormat);
        ListMenuCore_AppendStrBufOption(&wk->options[index], wk->message, index, wk->heapId);
    } else {
        ListMenuCore_AppendMsgOption(&wk->options[index], msgData, item, index, wk->heapId);
    }
}

static void ShopUI_LoadPokeMartItems(ShopUIWork *wk, u32 shopId, u32 fileId, u32 badges) {
    int count;
    MsgData *msgData;
    u8 *counts;
    u16 *items;
    u32 file;
    int i;

    msgData = GFL_MsgSysLoadData(FALSE, ARCID_SYSTEM_MESSAGE, TEXT_BANK_ITEM_NAMES, wk->heapId);
    counts = GFL_ArcSysReadHeapNew(ARCID_SHOP_ITEM_COUNTS, 0, HEAPID_TAIL(wk->heapId));
    if (shopId == SHOP_ID_BADGE_MART) {
        file = BADGE_SHOP_DAT_IDS[badges];
    } else {
        file = fileId + 6;
    }
    items = GFL_ArcSysReadHeapNew(ARCID_SHOP_ITEMS, file, HEAPID_TAIL(wk->heapId));
    if (PML_ItemIsTMHM(items[0])) {
        wk->listMode = SHOP_LIST_TMS;
    }
    count = counts[file];
    wk->options = ListMenuCore_CreateOptionList(count + 1, wk->heapId);
    for (i = 0; i < count; i++) {
        u16 item = items[i];

        ShopUI_AppendOption(wk, i, wk->listMode, item, msgData);
        wk->entries[i].item = item;
        wk->entries[i].price = PassPower_ApplyBargain(GetItemParam(item, ITEM_PARAM_PRICE, wk->heapId));
    }
    wk->entryCount = i;
    ShopUI_CheckSellingTMHM(wk->entries, wk->entryCount);
    ListMenuCore_AppendMsgOption(&wk->options[i], wk->msgData, ScrcmdShop_Text_Cancel, BMPMENULIST_CANCEL, wk->heapId);
    GFL_HeapFree(items);
    GFL_HeapFree(counts);
    GFL_MsgDataFree(msgData);
}

static void ShopUI_LoadBPShopItems(ShopUIWork *wk, u32 index) {
    int count;
    int i = 0;
    MsgData *msgData = GFL_MsgSysLoadData(FALSE, ARCID_SYSTEM_MESSAGE, TEXT_BANK_ITEM_NAMES, wk->heapId);
    const ShopItem *items = BP_SHOP_ITEMS[index];

    count = BP_SHOP_ITEM_COUNTS[index];
    wk->options = ListMenuCore_CreateOptionList(count + 1, wk->heapId);
    for (; i < count; i++) {
        ShopUI_AppendOption(wk, i, wk->listMode, items[i].item, msgData);
        wk->entries[i].item = items[i].item;
        wk->entries[i].price = items[i].price;
    }
    wk->entryCount = i;
    ListMenuCore_AppendMsgOption(&wk->options[i], wk->msgData, ScrcmdShop_Text_Cancel, BMPMENULIST_CANCEL, wk->heapId);
    GFL_MsgDataFree(msgData);
}

static void ShopUI_LoadSpecialPokeMartItems(ShopUIWork *wk, int shopId) {
    u32 fileId = 0;
    u32 level = 0;
    int value;
    u32 i;

    if (shopId >= SHOP_ID_SPECIAL_MART_0_FIRST && shopId <= SHOP_ID_SPECIAL_MART_0_LAST) {
        value = KeyDataSave_GetProgress(wk->keyData, 0);
    } else {
        value = KeyDataSave_GetProgress(wk->keyData, 1);
    }
    for (i = 0; i < NELEMS(sSpecialMartLevels); i++) {
        if (value >= sSpecialMartLevels[i]) {
            level = i;
        }
    }
    for (i = 0; i < NELEMS(SPECIAL_POKE_MART_HEADERS); i++) {
        if (shopId == SPECIAL_POKE_MART_HEADERS[i].shopId) {
            fileId = SPECIAL_POKE_MART_HEADERS[i].fileIds[level];
            break;
        }
    }
    ShopUI_LoadPokeMartItems(wk, shopId, fileId, 8);
}

static void ShopUI_LoadMoveTutorItems(ShopUIWork *wk, u32 tutor) {
    int i = 0;
    MsgData *msgData = GFL_MsgSysLoadData(FALSE, ARCID_SYSTEM_MESSAGE, TEXT_BANK_ITEM_NAMES, wk->heapId);
    const MoveTutorShopItem *items = MOVE_TUTOR_SHOP_ITEMS[tutor];
    int count = MOVE_TUTOR_SHOP_ITEM_COUNTS[tutor];

    wk->options = ListMenuCore_CreateOptionList(count + 1, wk->heapId);
    for (; i < count; i++) {
        ShopItem item = items[i].item;
        u16 index = items[i].index;

        ShopUI_AppendOption(wk, index, wk->listMode, item.item, msgData);
        wk->entries[index].item = item.item;
        wk->entries[index].price = item.price;
        wk->tutorMoveIndices[index] = i;
    }
    wk->entryCount = i;
    ListMenuCore_AppendMsgOption(&wk->options[i], wk->msgData, ScrcmdShop_Text_Cancel, BMPMENULIST_CANCEL, wk->heapId);
    GFL_MsgDataFree(msgData);
}

static void ShopUI_FreeListMenu(ShopUIWork *wk) {
    ListMenuCore_FreeOptionList(wk->options);
}

static u32 ShopUI_LoadMsgData(ShopUIWork *wk, u32 shopId) {
    wk->msgData = GFL_MsgSysLoadData(FALSE, ARCID_SCRIPT_MESSAGE, SCRIPT_TEXT_SCRCMD_SHOP, wk->heapId);
    wk->itemInfoMsgData = GFL_MsgSysLoadData(FALSE, ARCID_SYSTEM_MESSAGE, TEXT_BANK_ITEM_DESCRIPTIONS, wk->heapId);
    wk->moveInfoMsgData = GFL_MsgSysLoadData(FALSE, ARCID_SYSTEM_MESSAGE, TEXT_BANK_BTL_MAIN_13, wk->heapId);
    wk->wordSet = GFL_WordSetSystemCreateDefault(wk->heapId);
    wk->message = GFL_StrBufCreate(200, wk->heapId);
    wk->tcbManager = GFL_TCBExMgrCreate(wk->heapId, wk->heapId, 32, 32);
    wk->moveLabelFormat = GFL_MsgDataLoadStrbufNew(wk->msgData, ScrcmdShop_Text_Empty_13);
    return shopId;
}

static void ShopUI_FreeText(ShopUIWork *wk) {
    GFL_TCBExMgrFree(wk->tcbManager);
    GFL_WordSetSystemFree(wk->wordSet);
    GFL_StrBufFree(wk->moveLabelFormat);
    GFL_StrBufFree(wk->message);
    GFL_StrBufFree(wk->ownedLabel);
    GFL_StrBufFree(wk->priceFormat);
    GFL_MsgDataFree(wk->msgData);
    GFL_MsgDataFree(wk->itemInfoMsgData);
    GFL_MsgDataFree(wk->moveInfoMsgData);
}

static void ShopUI_LoadG2D(ShopUIWork *wk) {
    ArcTool *arc;

    G2_BlendNone();
    arc = GFL_ArcSysCreateFileHandle(ARCID_SCRCMD_SHOP, wk->heapId);
    GFL_G2DIOLoadArcNCLRDefault(arc, 1, 0, 0, 0x60, wk->heapId);
    GFL_BGSysLoadArcNCGRStatic(arc, 0, 2, 100, 0, FALSE, wk->heapId);
    if (wk->listMode == SHOP_LIST_MOVES) {
        GFL_G2DIOLoadNSCRSync(arc, 4, 2, 0, 100, 0, FALSE, wk->heapId);
    } else {
        GFL_G2DIOLoadNSCRSync(arc, 2, 2, 0, 100, 0, FALSE, wk->heapId);
    }
    GFL_ArcToolFree(arc);
    LoadSysMsgBox(1, 228, 9, 0, wk->heapId);
    GFL_BGSysClearScr(1);
    GFL_BGSysSetBGPriority(2, 1);
}

static void ShopUI_FreeBG(ShopUIWork *wk) {
    GFL_BGSysClearScr(1);
    GFL_BGSysClearScr(2);
    GFL_BGSysSetBGPriority(2, 0);
    setAlphaBlend_wrapper(TRUE);
}

static void ShopUI_CreateCellActors(ShopUIWork *wk) {
    ArcTool *arc = GFL_ArcSysCreateFileHandle(ARCID_SCRCMD_SHOP, wk->heapId);

    wk->res[0].palette = ClActSys_LoadPlttRange(arc, 11, 0, 0, 0, 1, wk->heapId);
    wk->res[0].chars = ClActSys_LoadChars(arc, 8, 0, 0, wk->heapId);
    wk->res[1].chars = ClActSys_LoadChars(arc, 5, 0, 0, wk->heapId);
    wk->res[0].cellAnims = ClActSys_LoadCellAnims(arc, 9, 10, wk->heapId);
    wk->res[1].cellAnims = ClActSys_LoadCellAnims(arc, 6, 7, wk->heapId);
    GFL_ArcToolFree(arc);
}

static void ShopUI_LoadItemIconResources(ShopUIWork *wk) {
    wk->res[2].palette =
        ClActSys_LoadPlttRange(wk->iconArc, GetItemGraphicsDatID(ITEM_MASTER_BALL, 2), 0, 32, 0, 1, wk->heapId);
    wk->res[2].chars = ClActSys_LoadChars(wk->iconArc, GetItemGraphicsDatID(ITEM_MASTER_BALL, 1), 0, 0, wk->heapId);
    wk->res[2].cellAnims = ClActSys_LoadCellAnims(wk->iconArc, 1, 0, wk->heapId);
}

// Shows an item's icon, or hides it for anything past the last item. The move tutors show their shard's
static void ShopUI_LoadItemSprite(ShopUIWork *wk, u16 item) {
    NNSG2dCharacterData *character;
    NNSG2dPaletteData *palette;
    void *nclr;
    void *ncgr;

#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    if (W2U_ItemIsAuthored(item)) {
#else
    if (item <= ITEM_LAST) {
#endif
        nclr = GFL_G2DIOReadNCLRArc(wk->iconArc, GetItemGraphicsDatID(item, 2), &palette, wk->heapId);
        ncgr = GFL_G2DIOReadOBJNCGRArc(wk->iconArc, GetItemGraphicsDatID(item, 1), FALSE, &character, wk->heapId);
        ClActSys_ReplacePlttData(wk->res[2].palette, palette, 1);
        ClActSys_ReplaceCharData(wk->res[2].chars, character);
        GFL_HeapFree(nclr);
        GFL_HeapFree(ncgr);
        ClActor_SetVisible(wk->actors[4], TRUE);
    } else {
        ClActor_SetVisible(wk->actors[4], FALSE);
    }
    if (wk->listMode == SHOP_LIST_MOVES) {
        ClActorPos pos;

        pos.x = 22;
        pos.y = 28;
        ClActor_SetVisible(wk->actors[4], TRUE);
        ClActor_SetSurfacePos(wk->actors[4], &pos, 0);
    }
}

static void ShopUI_CreateActors(ShopUIWork *wk) {
    wk->actors[0] = ClActor_Create(wk->clactUnit, wk->res[0].chars, wk->res[0].palette, wk->res[0].cellAnims,
                                   &sActorSetups[0], 0, wk->heapId);
    wk->actors[1] = ClActor_Create(wk->clactUnit, wk->res[1].chars, wk->res[0].palette, wk->res[1].cellAnims,
                                   &sActorSetups[1], 0, wk->heapId);
    wk->actors[2] = ClActor_Create(wk->clactUnit, wk->res[1].chars, wk->res[0].palette, wk->res[1].cellAnims,
                                   &sActorSetups[2], 0, wk->heapId);
    wk->actors[3] = ClActor_Create(wk->clactUnit, wk->res[1].chars, wk->res[0].palette, wk->res[1].cellAnims,
                                   &sActorSetups[3], 0, wk->heapId);
    ClActor_SetAutoAnim(wk->actors[3], TRUE);
    wk->actors[4] = ClActor_Create(wk->clactUnit, wk->res[2].chars, wk->res[2].palette, wk->res[2].cellAnims,
                                   &sActorSetups[4], 0, wk->heapId);
    ClActor_SetVisible(wk->actors[1], FALSE);
    ClActor_SetVisible(wk->actors[2], FALSE);
    ClActor_SetVisible(wk->actors[3], FALSE);
}

static void ShopUI_SetupSprites(ShopUIWork *wk) {
    wk->clactUnit = ClActUnit_Create(5, 1, wk->heapId);
    ClActUnit_SetActive(wk->clactUnit, TRUE);
    ShopUI_CreateCellActors(wk);
    wk->iconArc = GFL_ArcSysCreateFileHandle(ARCID_ITEMGRA, wk->heapId);
    ShopUI_LoadItemIconResources(wk);
    ShopUI_CreateActors(wk);
}

static void ShopUI_FreeClActResources(ShopUIWork *wk) {
    ClActSys_FreeCellAnims(wk->res[2].cellAnims);
    ClActSys_FreeCellAnims(wk->res[1].cellAnims);
    ClActSys_FreeCellAnims(wk->res[0].cellAnims);
    ClActSys_FreeChars(wk->res[2].chars);
    ClActSys_FreeChars(wk->res[1].chars);
    ClActSys_FreeChars(wk->res[0].chars);
    ClActSys_FreePltt(wk->res[2].palette);
    ClActSys_FreePltt(wk->res[0].palette);
    GFL_ArcToolFree(wk->iconArc);
    ClActUnit_Delete(wk->clactUnit);
}

static void ShopUI_SetupBmpWin(ShopUIWork *wk) {
    const ShopWindowSetup **setups;
    StrBuf *strbuf;
    int i;

    if (wk->currency == SHOP_CURRENCY_SHARDS) {
        setups = sMoveTutorWindows;
    } else if (wk->currency == SHOP_CURRENCY_BP) {
        setups = sBPShopWindows;
    } else {
        setups = sMartWindows;
    }
    for (i = 0; i < 7; i++) {
        const ShopWindowSetup *setup = setups[i];

        wk->windows[i] =
            BmpWin_CreateDynamic(setup->bg, setup->x, setup->y, setup->width, setup->height, setup->palette, 1);
    }
    strbuf = GFL_MsgDataLoadStrbufNew(wk->msgData, ScrcmdShop_Text_Money);
    GFL_TextRendererDrawToBitmapEx(BmpWin_GetBitmap(wk->windows[0]), 0, 0, strbuf, wk->font, PRINT_COLOR(15, 2, 15));
    GFL_StrBufFree(strbuf);
    PrintWindow_Init(&wk->printWindow, wk->windows[2]);
    wk->printQueue = PrintQueue_CreateDefault(wk->heapId);
    if (wk->currency == SHOP_CURRENCY_BP || wk->currency == SHOP_CURRENCY_SHARDS) {
        BmpWin_TransferNow(wk->windows[1]);
    } else {
        BmpWin_TransferNow(wk->windows[0]);
        BmpWin_TransferNow(wk->windows[1]);
    }
}

static void ShopUI_FreeSprites(ShopUIWork *wk) {
    int i;

    PrintQueue_Clear(wk->printQueue);
    PrintQueue_Free(wk->printQueue);
    for (i = 0; i < 7; i++) {
        BmpWin_Free(wk->windows[i]);
    }
}

static void ShopUI_UpdateMoneyDisp(ShopUIWork *wk) {
    StrBuf *format;
    StrBuf *strbuf;
    GFLBitmap *bitmap;

    if (wk->currency == SHOP_CURRENCY_SHARDS) {
        format = GFL_MsgDataLoadStrbufNew(wk->msgData, ScrcmdShop_Text_X_2);
        strbuf = GFL_StrBufCreate(10, wk->heapId);
        WordSetNumber(wk->wordSet, 0,
                      BagSave_GetItemCountByID(wk->bag, MOVE_TUTOR_CURRENCY_ITEMS[wk->tutorIndex], wk->heapId), 3,
                      NUM_PAD_SPACE, 1);
    } else if (wk->currency == SHOP_CURRENCY_BP) {
        format = GFL_MsgDataLoadStrbufNew(wk->msgData, ScrcmdShop_Text_Bp_2);
        strbuf = GFL_StrBufCreate(10, wk->heapId);
        WordSetNumber(wk->wordSet, 0, BSubwayScoreData_GetBattlePoints(wk->bsubwayScore), 4, NUM_PAD_SPACE, 1);
    } else {
        format = GFL_MsgDataLoadStrbufNew(wk->msgData, ScrcmdShop_Text_Empty_9);
        strbuf = GFL_StrBufCreate(10, wk->heapId);
        WordSetNumber(wk->wordSet, 0, getCash(wk->trainerCard), 7, NUM_PAD_SPACE, 1);
    }
    GFL_WordSetFormatStrbuf(wk->wordSet, strbuf, format);
    bitmap = BmpWin_GetBitmap(wk->windows[1]);
    GFL_BitmapFill(bitmap, 0);
    GFL_TextRendererDrawToBitmapEx(bitmap, 0, 0, strbuf, wk->font, PRINT_COLOR(15, 2, 15));
    BmpWin_TransferNow(wk->windows[1]);
    GFL_StrBufFree(strbuf);
    GFL_StrBufFree(format);
}

// How many of the item the bag holds
static void ShopUI_PrintBagCount(ShopUIWork *wk, u16 item) {
    StrBuf *format = GFL_MsgDataLoadStrbufNew(wk->msgData, ScrcmdShop_Text_Bag);
    StrBuf *strbuf = GFL_StrBufCreate(20, wk->heapId);
    GFLBitmap *bitmap;

    BmpWin_DrawFrame(wk->windows[3], WINFRAME_TRANSFER_NONE, 228, 9);
    WordSetNumber(wk->wordSet, 0, BagSave_GetItemCountByID(wk->bag, item, wk->heapId), 3, NUM_PAD_NONE, 1);
    GFL_WordSetFormatStrbuf(wk->wordSet, strbuf, format);
    bitmap = BmpWin_GetBitmap(wk->windows[3]);
    GFL_BitmapFill(bitmap, 15);
    GFL_TextRendererDrawToBitmapEx(bitmap, 0, 0, strbuf, wk->font, PRINT_COLOR(1, 2, 15));
    BmpWin_TransferNow(wk->windows[3]);
    GFL_StrBufFree(strbuf);
    GFL_StrBufFree(format);
}

// The description of the item or move at the cursor
static void ShopUI_PrintDescription(ShopUIWork *wk, u16 item) {
    GFLBitmap *bitmap = BmpWin_GetBitmap(wk->windows[5]);

    GFL_BitmapFill(bitmap, 0);
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    if ((wk->listMode == SHOP_LIST_MOVES && item < GFL_MsgDataGetLineCount(wk->moveInfoMsgData)) ||
        (wk->listMode != SHOP_LIST_MOVES && W2U_ItemIsAuthored(item))) {
#else
    if (item <= ITEM_LAST) {
#endif
        StrBuf *strbuf;

        if (wk->listMode == SHOP_LIST_MOVES) {
            strbuf = GFL_MsgDataLoadStrbufNew(wk->moveInfoMsgData, item);
        } else {
            strbuf = GFL_MsgDataLoadStrbufNew(wk->itemInfoMsgData, item);
        }
        GFL_TextRendererDrawToBitmapEx(bitmap, 0, 0, strbuf, wk->font, PRINT_COLOR(15, 2, 0));
        GFL_StrBufFree(strbuf);
    }
    BmpWin_TransferNow(wk->windows[5]);
}

static void ShopUI_UpdateItemAmountDisp(ShopUIWork *wk, u16 amount, u32 price) {
    StrBuf *amountFormat = GFL_MsgDataLoadStrbufNew(wk->msgData, ScrcmdShop_Text_X);
    StrBuf *priceFormat = GFL_MsgDataLoadStrbufNew(wk->msgData, SHOP_UI_CURRENCY_MSGIDS[wk->currency]);
    StrBuf *strbuf = GFL_StrBufCreate(20, wk->heapId);
    GFLBitmap *bitmap = BmpWin_GetBitmap(wk->windows[4]);

    GFL_BitmapFill(bitmap, 15);
    BmpWin_DrawFrame(wk->windows[4], WINFRAME_TRANSFER_NONE, 228, 9);
    WordSetNumber(wk->wordSet, 0, amount, 2, NUM_PAD_NONE, 1);
    GFL_WordSetFormatStrbuf(wk->wordSet, strbuf, amountFormat);
    GFL_TextRendererDrawToBitmapEx(bitmap, 0, 0, strbuf, wk->font, PRINT_COLOR(1, 2, 15));
    WordSetNumber(wk->wordSet, 0, amount * price, 7, NUM_PAD_SPACE, 1);
    GFL_WordSetFormatStrbuf(wk->wordSet, strbuf, priceFormat);
    if (wk->currency == SHOP_CURRENCY_MONEY) {
        GFL_TextRendererDrawToBitmapEx(bitmap, 35, 0, strbuf, wk->font, PRINT_COLOR(1, 2, 15));
    } else {
        GFL_TextRendererDrawToBitmapEx(bitmap, 29, 0, strbuf, wk->font, PRINT_COLOR(1, 2, 15));
    }
    BmpWin_TransferNow(wk->windows[4]);
    GFL_StrBufFree(strbuf);
    GFL_StrBufFree(priceFormat);
    GFL_StrBufFree(amountFormat);
}

static void ShopUI_SetupMenuList(ShopUIWork *wk) {
    BmpMenuListHeader header;

    header.options = wk->options;
    header.cursorCallback = ShopUI_CursorCallback;
    if (wk->listMode == SHOP_LIST_ITEMS || wk->listMode == SHOP_LIST_MOVES) {
        header.printCallback = ShopUI_PrintPrice;
    } else {
        header.printCallback = ShopUI_PrintTMPrice;
    }
    header.count = ListMenuCore_GetFirstFreeIndex(wk->options);
    header.maxShown = 7;
    header.labelX = 0;
    header.itemX = 0;
    header.cursorX = 0;
    header.y = 8;
    header.fgColor = 12;
    header.bgColor = 0;
    header.shadowColor = 13;
    header.letterSpacing = 0;
    header.lineSpacing = 0;
    header.pageSkip = BMPMENULIST_SKIP_LR_KEY;
    header.fontId = 0;
    header.cursorDisplay = BMPMENULIST_CURSOR_HIDE;
    header.work = wk;
    header.fontSizeX = 12;
    header.fontSizeY = 16;
    header.msgData = NULL;
    header.printWindow = &wk->printWindow;
    header.queue = wk->printQueue;
    header.font = wk->font;
    header.wait = 0;
    wk->list = BmpMenuList_Create(&header, 0, 0, wk->heapId);
}

// Prints straight to the bitmap in the first row, and through the print queue below it
static void ShopUI_PrintToRow(PrintQueue *queue, GFLBitmap *bitmap, int x, int y, const StrBuf *strbuf, Font *font,
                              u16 color) {
    if (y <= 8) {
        GFL_TextRendererDrawToBitmapEx(bitmap, x, y, strbuf, font, color);
    } else {
        PrintQueue_PrintColor(queue, bitmap, x, y, strbuf, font, color);
    }
}

// Prints an item's price at the right of its row
static void ShopUI_PrintPrice(BmpMenuList *list, s32 value, u8 y) {
    ShopUIWork *wk = BmpMenuList_GetWork(list);
    s32 width;
    u32 windowWidth;

    if (value == BMPMENULIST_CANCEL) {
        return;
    }
    WordSetNumber(wk->wordSet, 1, wk->entries[value].price, 5, NUM_PAD_NONE, 1);
    GFL_WordSetFormatStrbuf(wk->wordSet, wk->message, wk->priceFormat);
    width = GFL_FontGetBlockWidth(wk->message, wk->font, 0);
    windowWidth = GFL_BitmapGetWidth(BmpWin_GetBitmap(wk->windows[2]));
    ShopUI_PrintToRow(wk->printQueue, BmpWin_GetBitmap(wk->windows[2]), windowWidth - width, y, wk->message, wk->font,
                      PRINT_COLOR(12, 13, 0));
}

// The same for a TM, or that the bag holds it
static void ShopUI_PrintTMPrice(BmpMenuList *list, s32 value, u8 y) {
    ShopUIWork *wk = BmpMenuList_GetWork(list);
    s32 width;
    u32 windowWidth;

    if (value == BMPMENULIST_CANCEL) {
        return;
    }
    if (BagSave_CheckAmount(wk->bag, wk->entries[value].item, 1, wk->heapId)) {
        width = GFL_FontGetBlockWidth(wk->ownedLabel, wk->font, 0);
        windowWidth = GFL_BitmapGetWidth(BmpWin_GetBitmap(wk->windows[2]));
        ShopUI_PrintToRow(wk->printQueue, BmpWin_GetBitmap(wk->windows[2]), windowWidth - width, y, wk->ownedLabel,
                          wk->font, PRINT_COLOR(12, 13, 0));
        return;
    }
    WordSetNumber(wk->wordSet, 1, wk->entries[value].price, 5, NUM_PAD_SPACE, 1);
    GFL_WordSetFormatStrbuf(wk->wordSet, wk->message, wk->priceFormat);
    width = GFL_FontGetBlockWidth(wk->message, wk->font, 0);
    windowWidth = GFL_BitmapGetWidth(BmpWin_GetBitmap(wk->windows[2]));
    ShopUI_PrintToRow(wk->printQueue, BmpWin_GetBitmap(wk->windows[2]), windowWidth - width, y, wk->message, wk->font,
                      PRINT_COLOR(12, 13, 0));
}

// Moves the cursor's arrow, and shows the description and icon of the entry at the cursor
static void ShopUI_CursorCallback(BmpMenuList *list, s32 value, u8 init) {
    ShopUIWork *wk = BmpMenuList_GetWork(list);
    ClActorPos pos;
    u16 listTop;
    u16 cursorRow;

    BmpMenuList_GetPos(list, &listTop, &cursorRow);
    pos.x = 172;
    pos.y = cursorRow * 16 + 22;
    ClActor_SetSurfacePos(wk->actors[0], &pos, 0);
    if (value < NELEMS(wk->entries)) {
        ShopUI_PrintDescription(wk, wk->entries[value].item);
        if (wk->listMode != SHOP_LIST_MOVES) {
            ShopUI_LoadItemSprite(wk, wk->entries[value].item);
        }
    } else {
        ShopUI_PrintDescription(wk, 0xffff);
        if (wk->listMode != SHOP_LIST_MOVES) {
            ShopUI_LoadItemSprite(wk, 0xffff);
        }
    }
}

static void ShopUI_FreeMenuList(ShopUIWork *wk) {
    u16 listTop;
    u16 cursorRow;

    BmpMenuList_Free(wk->list, &listTop, &cursorRow);
}

static BOOL func_ov036_021ad6e0(u32 event) {
    return FALSE;
}

// Puts an item's name and pocket in the word set, and prints a message in a new frame
static void ShopUI_SetStatusDialogue(ShopUIWork *wk, u32 msgId, u16 item, BOOL plural) {
    u32 pocket = BagSave_GetActualItemPocket(wk->bag, item);
    StrBuf *strbuf;

    GFL_BitmapFill(BmpWin_GetBitmap(wk->windows[6]), 15);
    BmpWin_DrawFrame(wk->windows[6], WINFRAME_TRANSFER_NOW, 228, 9);
    loadItemText(wk->wordSet, 0, item, plural, FALSE);
    loadBagPocketNameToStrbuf(wk->wordSet, 1, pocket);
    strbuf = GFL_MsgDataLoadStrbufNew(wk->msgData, msgId);
    GFL_WordSetFormatStrbuf(wk->wordSet, wk->message, strbuf);
    GFL_StrBufFree(strbuf);
    wk->printStream =
        PrintStream_CreateWithCallback(wk->windows[6], 0, 0, wk->message, wk->font, TextSpeed_GetCurrentWait(),
                                       wk->tcbManager, 0, wk->heapId, 0xffff, func_ov036_021ad6e0);
    BmpWin_TransferNow(wk->windows[6]);
}

// Asks whether to buy the item, the TM or the move. The callers pass the list mode, which the menu's own replaces
static void ShopUI_SetBuyConfirmMessage(ShopUIWork *wk, u8 listMode) {
    if (wk->listMode == SHOP_LIST_MOVES) {
        ShopUI_SetupMoveBuyMsg(wk, ScrcmdShop_Text_GotWillOk, wk->item, wk->price);
    } else if (wk->listMode == SHOP_LIST_TMS) {
        if (wk->currency == SHOP_CURRENCY_BP) {
            ShopUI_PrintTMBuyMessage(wk, ScrcmdShop_Text_NoWillBpOk, wk->item, wk->price);
        } else {
            ShopUI_PrintTMBuyMessage(wk, ScrcmdShop_Text_NoWillOk, wk->item, wk->price);
        }
    } else {
        if (wk->currency == SHOP_CURRENCY_BP) {
            ShopUI_PrintItemBuyMessage(wk, ScrcmdShop_Text_WillCostBpOk, wk->item, wk->price, wk->amount);
        } else {
            ShopUI_PrintItemBuyMessage(wk, ScrcmdShop_Text_WantWillOk, wk->item, wk->price, wk->amount);
        }
    }
}

static void ShopUI_DrawMessageFrame(BmpWin *window) {
    GFL_BitmapFill(BmpWin_GetBitmap(window), 15);
    BmpWin_DrawFrame(window, WINFRAME_TRANSFER_NOW, 228, 9);
}

// Prints a message in the frame that is there already
static void ShopUI_PrintMessageInFrame(ShopUIWork *wk, u32 msgId) {
    StrBuf *strbuf = GFL_MsgDataLoadStrbufNew(wk->msgData, msgId);

    GFL_WordSetFormatStrbuf(wk->wordSet, wk->message, strbuf);
    GFL_StrBufFree(strbuf);
    wk->printStream =
        PrintStream_CreateWithCallback(wk->windows[6], 0, 0, wk->message, wk->font, TextSpeed_GetCurrentWait(),
                                       wk->tcbManager, 0, wk->heapId, 0xffff, NULL);
    BmpWin_TransferNow(wk->windows[6]);
}

// Asks whether to buy an amount of an item
static void ShopUI_PrintItemBuyMessage(ShopUIWork *wk, u32 msgId, u16 item, u32 price, u16 amount) {
    ShopUI_DrawMessageFrame(wk->windows[6]);
    loadItemText(wk->wordSet, 0, item, FALSE, FALSE);
    WordSetNumber(wk->wordSet, 1, amount, 2, NUM_PAD_NONE, 1);
    WordSetNumber(wk->wordSet, 2, (u32)amount * price, 7, NUM_PAD_NONE, 1);
    ShopUI_PrintMessageInFrame(wk, msgId);
}

// Asks whether to buy a TM
static void ShopUI_PrintTMBuyMessage(ShopUIWork *wk, u32 msgId, u16 item, u32 price) {
    ShopUI_DrawMessageFrame(wk->windows[6]);
    WordSetNumber(wk->wordSet, 0, item - ITEM_TM01 + 1, 2, NUM_PAD_ZERO, 1);
    loadMoveNameToStrbuf(wk->wordSet, 1, PML_ItemGetTMWazaID(item));
    WordSetNumber(wk->wordSet, 2, price, 5, NUM_PAD_NONE, 1);
    ShopUI_PrintMessageInFrame(wk, msgId);
}

static void ShopUI_SetupMoveBuyMsg(ShopUIWork *wk, u32 msgId, u16 move, u32 price) {
    ShopUI_DrawMessageFrame(wk->windows[6]);
    loadMoveNameToStrbuf(wk->wordSet, 0, move);
    loadItemText(wk->wordSet, 1, MOVE_TUTOR_CURRENCY_ITEMS[wk->tutorIndex], price != 1, FALSE);
    WordSetNumber(wk->wordSet, 2, price, 2, NUM_PAD_NONE, 1);
    ShopUI_PrintMessageInFrame(wk, msgId);
}

// Changes the amount by delta, wrapping around by one and stopping at the ends by ten. Returns 1 for more, 2 for less
// and 0 if it didn't change
static u32 ShopUI_ChangeItemAmount(s16 *amount, u16 max, s32 delta) {
    s16 old = *amount;

    switch (delta) {
    case -1:
        *amount = old - 1;
        if (*amount <= 0) {
            *amount = max;
        }
        if (*amount == old) {
            return 0;
        }
        return 2;
    case -10:
        *amount = old - 10;
        if (*amount <= 0) {
            *amount = 1;
        }
        if (*amount == old) {
            return 0;
        }
        return 2;
    case 1:
        *amount = old + 1;
        if (*amount > max) {
            *amount = 1;
        }
        if (*amount == old) {
            return 0;
        }
        return 1;
    case 10:
        *amount = old + 10;
        if (*amount > max) {
            *amount = max;
        }
        if (*amount == old) {
            return 0;
        }
        return 1;
    }
    return 0;
}

static u8 ShopUI_UpdateInput(ShopUIWork *wk) {
    if (GCTX_HIDGetTypedKeys() & PAD_KEY_UP) {
        if (ShopUI_ChangeItemAmount(&wk->amount, wk->maxAmount, 1)) {
            GFL_SndSEPlay(SEQ_SE_SELECT1);
            ShopUI_UpdateItemAmountDisp(wk, wk->amount, wk->price);
        }
    } else if (GCTX_HIDGetTypedKeys() & PAD_KEY_DOWN) {
        if (ShopUI_ChangeItemAmount(&wk->amount, wk->maxAmount, -1)) {
            GFL_SndSEPlay(SEQ_SE_SELECT1);
            ShopUI_UpdateItemAmountDisp(wk, wk->amount, wk->price);
        }
    } else if (GCTX_HIDGetTypedKeys() & PAD_KEY_LEFT) {
        if (ShopUI_ChangeItemAmount(&wk->amount, wk->maxAmount, -10)) {
            GFL_SndSEPlay(SEQ_SE_SELECT1);
            ShopUI_UpdateItemAmountDisp(wk, wk->amount, wk->price);
        }
    } else if (GCTX_HIDGetTypedKeys() & PAD_KEY_RIGHT) {
        if (ShopUI_ChangeItemAmount(&wk->amount, wk->maxAmount, 10)) {
            GFL_SndSEPlay(SEQ_SE_SELECT1);
            ShopUI_UpdateItemAmountDisp(wk, wk->amount, wk->price);
        }
    }
    if (GCTX_HIDGetPressedKeys() & PAD_BUTTON_A) {
        GFL_SndSEPlay(SEQ_SE_DECIDE1);
        ShopUI_SetBuyConfirmMessage(wk, wk->listMode);
        wk->nextState = 6;
        return 12;
    }
    if (GCTX_HIDGetPressedKeys() & PAD_BUTTON_B) {
        GFL_SndSEPlay(SEQ_SE_CANCEL1);
        return 4;
    }
    return 3;
}

static void ShopUI_ClearListScreen(u32 index) {
    GFL_BGSysFillScrArea(1, 0, sListRects[index].x, sListRects[index].y, sListRects[index].width,
                         sListRects[index].height, 0);
}

static void GetMoveTutorShopSortimentBits(GameSystem *gsys, u32 moveIndex, u32 tutor, u8 *learnable) {
    PokeParty *party = GameData_GetParty(GSYS_GetGameData(gsys));
    int count = PokeParty_GetPkmCount(party);
    int i;

    *learnable = 0;
    for (i = 0; i < count; i++) {
        if (PokeParty_CheckMoveTutorPaid(PokeParty_GetPkm(party, i), moveIndex, tutor) == TRUE) {
            *learnable |= 1 << i;
        }
    }
}
