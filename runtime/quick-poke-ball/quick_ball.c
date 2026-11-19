#include "bindings.h"

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef int s32;
typedef signed short s16;
typedef s32 (*SelectAction)(void *, s32 *);

#define FIELD(type, pointer, offset) (*(type *)((u8 *)(pointer) + (offset)))
#define INVALID 0xffffffffu
#define TAB_PALETTE_VRAM ((volatile u16 *)(0x05000200 + PaletteBank * PaletteBytes))

enum {
    CoreMain = 0, CoreClient = 4, ClientMon = 8, ClientAction = 12,
    ScdProcedure = 0x20, ScdProcedureCount = 0x60,
#ifdef PW_BW1
    CoreSubDisplay = 0x180, CoreHeap = 0x184,
    ClientActionIndex = 0x11d, ClientFirstAction = 0x11f, ClientType = 0x1a7, ClientBagMode = 0x1aa,
    ScdResult = 0x98, ScdInput = 0xb0, CaptureBlocked = 0x40,
#else
    CoreSubDisplay = 0x1c4, CoreHeap = 0x1c8,
    ClientActionIndex = 0x125, ClientFirstAction = 0x127, ClientType = 0x1af, ClientBagMode = 0x1b2,
    ScdResult = 0xa4, ScdInput = 0xbc, CaptureBlocked = 0x10040,
#endif
    InputScreen = 0x58, InputPressedButton = 0x70,
    B = 2, Right = 0x10, Left = 0x20, Up = 0x40, Down = 0x80, L = 0x200,
    Pokeball = 4, BallBattlePocket = 2, MainDisplay = 0,
    BattleFunctionParam = 7, BallBattleFunction = 1,
    TileBytes = 1024, PaletteBytes = 32, FirstBallMember = 3,
    PaletteBank = 15, MainObjFade = 2
};

typedef struct {
    s16 x, y;
    u16 sequence;
    u8 priority, bgPriority;
} ActorSetup;

typedef struct {
    u32 format, extended, size;
    void *data;
} PaletteData;

typedef struct {
    u8 tiles[TileBytes];
    u16 palettes[2][16];
} TabArt;

extern u32 GCTX_HIDGetHeldKeys(void), GCTX_HIDGetPressedKeys(void);
extern u32 BtlvCore_WaitCommandSelect(void *);
extern void BtlvCore_StopCommandSelect(void *), BtlvCore_Delete(void *);
extern s32 BtlvCore_IsScreenIdle(void *);
extern u32 BtlSetup_GetBattleType(void *), BtlSetup_GetBattleStyle(void *), GetStudioMode(void *);
extern s32 BtlSetup_IsBattleType(void *, u32);
extern s32 IsPokeBallTargetHiding(void *), CheckCondition(void *, u32);
extern void *BtlvCore_GetMonAtViewPos(void *, u32);
extern s32 IsFainted(void *);
extern void *GetBagSave(void *), *GetBagCursor(void *);
extern u16 BagSave_GetItemCountByID(void *, u16, u16);
extern s32 GetItemParam(u16, u32, u16);
extern void *BagCursor_Create(u16);
extern u16 BagCursor_GetBattleLastItem(void *);
extern void BagCursor_SetBattleLastItem(void *, u16, u8);
extern void BattleAction_SetItemParam(void *, u16, u16, u32);
extern void shooterWork_SetCost(void *, u8, u8), selItemWork_Reserve(void *, u8, u16);
extern void BattleClient_SetSelActProc(void *, SelectAction);
extern s32 BattleClient_ActionSelectAutoRest(void *, s32 *);
extern void BtlvInput_PlayCursorSE(void *), BtlvInput_PlayDecideSE(void *), BtlvInput_PlayCancelSE(void *);

extern u32 GFL_HeapGetFreeSizeCore(u16), GFL_HeapGetHighestAllocatableSize(u16);
extern void *GFL_HeapAllocateCore(u16, u32);
extern void GFL_HeapFree(void *);
extern void FS_InitFile(void *);
extern s32 FS_OpenFile(void *, const char *);
extern void GFL_ArcToolInit(void *), GFL_ArcToolFree(void *);
extern u32 GFL_ArcToolGetDataMax(void *), GFL_ArcToolGetDataLength(void *, u32);
extern void GFL_ArcToolRead(void *, u32, void *);
extern u32 ClActSys_AllocChars(u32, u32, u16), ClActSys_GetCharVramAddr(u32, s32);
extern void ClActSys_WriteCharData(u32, void *, u32, u32, u32), ClActSys_FreeChars(u32);
extern u32 ClActSys_LoadPlttRange(void *, u32, u32, u16, u16, u16, u16);
extern void ClActSys_FreePltt(u32), ClActSys_ReplacePlttData(u32, const PaletteData *, u32);
extern u32 ClActSys_LoadCellAnims(void *, u32, u32, u16);
extern void ClActSys_FreeCellAnims(u32);
extern void *ClActUnit_Create(u16, u8, u16);
extern void ClActUnit_Delete(void *);
extern void *ClActor_Create(void *, u32, u32, u32, const ActorSetup *, u16, u16);
extern void ClActor_SetAutoAnim(void *, s32);
extern void *BtlvEffect_GetPaletteFade(void);
extern u16 *PaletteFade_GetUnfadedBuffer(void *, u32), *PaletteFade_GetFadedBuffer(void *, u32);
extern void PaletteFade_LoadFromVRAM(void *, u32, u16, u32);

static const u16 ballIds[] = {BALL_IDS};
enum { BallCount = sizeof(ballIds) / sizeof(ballIds[0]) };

// The ARM9 session hook keeps this module in RAM between battle overlays.
static u16 sessionBall;

typedef enum { Idle, Armed, Cycled, Cancelled } Gesture;
static struct {
    void *core;
    void *arc;
    void *unit;
    u32 chars, palette, anim;
    u16 selected;
    u16 shownQuantity;
    u16 shownBall;
    u16 quantity;
    u16 savedVram[16], savedUnfaded[16], savedFaded[16];
    u16 *unfaded, *faded;
    u8 inventoryChecked;
    u8 shownHeld;
    u8 artFailed;
    Gesture gesture;
} tab;
static TabArt artwork;

static void closeTab(void) {
    tab.inventoryChecked = 0;
    if (tab.arc == 0)
        return;
    if (tab.unit)
        ClActUnit_Delete(tab.unit);
    if (tab.anim != INVALID)
        ClActSys_FreeCellAnims(tab.anim);
    if (tab.palette != INVALID) {
        for (u32 i = 0; i < 16; i++) {
            TAB_PALETTE_VRAM[i] = tab.savedVram[i];
            tab.unfaded[i] = tab.savedUnfaded[i];
            tab.faded[i] = tab.savedFaded[i];
        }
        ClActSys_FreePltt(tab.palette);
    }
    if (tab.chars != INVALID)
        ClActSys_FreeChars(tab.chars);
    GFL_ArcToolFree(tab.arc);
    tab.arc = 0;
    tab.unit = 0;
    tab.shownBall = 0;
}

static s32 hasActorCapacity(void) {
    void *sys = *(void **)ACTOR_SYSTEM_POINTER;
    if (!sys)
        return 0;
    void *characters = FIELD(void *, sys, 0x10c);
    void *palettes = FIELD(void *, sys, 0x110);
    void *animations = FIELD(void *, sys, 0x114);
    u32 freePalette = 0, freeChars = 0, freeAnim = 0;
    for (u32 i = 0; i < FIELD(u16, sys, 0x118); i++)
        freeChars |= FIELD(u32, characters, i * 64 + 60) >> 31;
    for (u32 i = 0; i < FIELD(u16, sys, 0x11a); i++)
        freePalette |= FIELD(u32, palettes, i * 24 + 20) >> 31;
    for (u32 i = 0; i < FIELD(u16, sys, 0x11c); i++)
        freeAnim |= FIELD(u32, animations, i * 20 + 16);
    return freePalette && freeChars && freeAnim;
}

static s32 paletteIsVisible(void) {
    // Retail gauge palettes load all 16 banks, but their actors use 0–9.
    // The remaining native effects use 10–13. Check live OAM too, in case
    // an installed companion uses bank 15 or draws with a shared 8bpp palette.
    const volatile u16 *oam = (const volatile u16 *)0x07000000;
    for (u32 i = 0; i < 128; i++) {
        u16 attr0 = oam[i * 4];
        if ((attr0 & 0x0300) == 0x0200 || (attr0 & 0x0c00) == 0x0c00)
            continue;
        if ((attr0 & 0x2000) || oam[i * 4 + 2] >> 12 == PaletteBank)
            return 1;
    }
    return 0;
}

static s32 openTab(u16 heap) {
    if (!hasActorCapacity() || paletteIsVisible() || GFL_HeapGetFreeSizeCore(heap) < 12288 ||
        GFL_HeapGetHighestAllocatableSize(heap) < 4096)
        return 0;
    void *fade = BtlvEffect_GetPaletteFade();
    if (!fade)
        return 0;
    u16 *unfaded = PaletteFade_GetUnfadedBuffer(fade, MainObjFade);
    u16 *faded = PaletteFade_GetFadedBuffer(fade, MainObjFade);
    if (!unfaded || !faded)
        return 0;
    tab.unfaded = unfaded + PaletteBank * 16;
    tab.faded = faded + PaletteBank * 16;

    void *arc = GFL_HeapAllocateCore(heap, 80);
    if (!arc)
        return 0;
    FS_InitFile(arc);
    if (!FS_OpenFile(arc, "rom:/quick-poke-ball/tab.narc")) {
        GFL_HeapFree(arc);
        return 0;
    }
    GFL_ArcToolInit(arc);
    tab.arc = arc;
    tab.chars = tab.palette = tab.anim = INVALID;
    if (GFL_ArcToolGetDataMax(arc) != FirstBallMember + BallCount)
        goto failure;
    tab.chars = ClActSys_AllocChars(TileBytes, MainDisplay, heap);
    if (tab.chars == INVALID || ClActSys_GetCharVramAddr(tab.chars, 0) == INVALID)
        goto failure;
    for (u32 i = 0; i < 16; i++) {
        tab.savedVram[i] = TAB_PALETTE_VRAM[i];
        tab.savedUnfaded[i] = tab.unfaded[i];
        tab.savedFaded[i] = tab.faded[i];
    }
    tab.palette = ClActSys_LoadPlttRange(arc, 0, MainDisplay, PaletteBank * PaletteBytes, 0, 1, heap);
    if (tab.palette == INVALID)
        goto failure;
    tab.anim = ClActSys_LoadCellAnims(arc, 1, 2, heap);
    if (tab.anim == INVALID)
        goto failure;
    tab.unit = ClActUnit_Create(1, 0, heap);
    if (tab.unit) {
        const ActorSetup setup = {0, 57, 0, 0, 0};
        void *actor = ClActor_Create(tab.unit, tab.chars, tab.palette, tab.anim, &setup, MainDisplay, heap);
        if (actor) {
            ClActor_SetAutoAnim(actor, 0);
            return 1;
        }
    }
failure:
    closeTab();
    return 0;
}

static void digit(u32 x, u16 bits) {
    for (u32 y = 0; y < 5; y++) {
        for (u32 dx = 0; dx < 3; dx++, bits >>= 1) {
            if (bits & 1) {
                u32 px = x + dx, py = 31 + y;
                u32 index = ((py / 8) * 4 + px / 8) * 32 + (py % 8) * 4 + px % 8 / 2;
                u32 shift = (px & 1) * 4;
                artwork.tiles[index] = (artwork.tiles[index] & ~(15 << shift)) | (5 << shift);
            }
        }
    }
}

static s32 drawTab(u32 index, u16 quantity, s32 held) {
    if (tab.shownBall == ballIds[index] && tab.shownQuantity == quantity && tab.shownHeld == held)
        return 1;
    u32 member = FirstBallMember + index;
    if (GFL_ArcToolGetDataLength(tab.arc, member) != sizeof(artwork))
        return 0;
    GFL_ArcToolRead(tab.arc, member, &artwork);
    // Rows are stored as groups of three bits, left pixel first at bit zero.
    static const u16 numbers[] = {0x7b6f, 0x749a, 0x73e7, 0x79a7, 0x49ed,
                                  0x79cf, 0x7bcf, 0x24a7, 0x7bef, 0x79ef};
    u32 x = quantity >= 100 ? 7 : quantity >= 10 ? 9 : 11;
    digit(x, 0x0aa8); // ×
    x += 4;
    if (quantity >= 100) {
        digit(x, numbers[quantity / 100]);
        x += 4;
    }
    if (quantity >= 10) {
        digit(x, numbers[quantity / 10 % 10]);
        x += 4;
    }
    digit(x, numbers[quantity % 10]);

    PaletteData palette = {3, 0, PaletteBytes, artwork.palettes[held]};
    ClActSys_WriteCharData(tab.chars, artwork.tiles, TileBytes, 0, MainDisplay);
    ClActSys_ReplacePlttData(tab.palette, &palette, 1);
    PaletteFade_LoadFromVRAM(BtlvEffect_GetPaletteFade(), MainObjFade, PaletteBank * 16, PaletteBytes);
    tab.shownBall = ballIds[index];
    tab.shownQuantity = quantity;
    tab.shownHeld = held;
    return 1;
}

static s32 ballIndex(u16 item) {
    for (u32 i = 0; i < BallCount; i++)
        if (ballIds[i] == item)
            return i;
    return -1;
}

static u16 stock(void *bag, u16 heap, u16 ball) {
    u16 quantity = BagSave_GetItemCountByID(bag, ball, heap);
    // Respect edits that repurpose one of the retail Poké Ball item slots.
    return quantity && GetItemParam(ball, BattleFunctionParam, heap) == BallBattleFunction ? quantity : 0;
}

static s32 stockedBall(void *bag, u16 heap, s32 index, s32 direction) {
    for (u32 i = 0; i < BallCount; i++) {
        index += direction;
        if (index < 0)
            index = BallCount - 1;
        else if (index >= BallCount)
            index = 0;
        u16 quantity = stock(bag, heap, ballIds[index]);
        if (quantity) {
            tab.selected = ballIds[index];
            tab.quantity = quantity;
            return index;
        }
    }
    return -1;
}

static void *eligibleInput(void *core, void *client, void *main) {
    void *command = FIELD(void *, core, CoreSubDisplay);
    void *input = FIELD(void *, command, ScdInput);
    if (FIELD(u32, command, ScdProcedureCount) != 1 ||
        FIELD(u32, command, ScdProcedure) != 0 ||
        FIELD(u32, command, ScdProcedure + 4) != COMMAND_MAIN ||
        FIELD(u32, command, ScdResult) != 0 ||
        FIELD(u32, input, InputScreen) != 1 || FIELD(s32, input, InputPressedButton) != -1 ||
        !BtlvCore_IsScreenIdle(core))
        return 0;
    if (BtlSetup_GetBattleType(main) != 0 || BtlSetup_GetBattleStyle(main) != 0 ||
        FIELD(u8, client, ClientType) != 0 || FIELD(u8, client, ClientBagMode) != 0 ||
        FIELD(u8, client, ClientActionIndex) != FIELD(u8, client, ClientFirstAction) ||
#ifndef PW_BW1
        GetStudioMode(main) ||
#endif
        BtlSetup_IsBattleType(main, CaptureBlocked) ||
        CheckCondition(FIELD(void *, client, ClientMon), 0x21) || IsPokeBallTargetHiding(client))
        return 0;
    void *opponent = BtlvCore_GetMonAtViewPos(core, 1);
    return opponent && !IsFainted(opponent) ? input : 0;
}

static void throwBall(void *core, void *client, void *main, void *input) {
    sessionBall = tab.selected;
    u8 index = FIELD(u8, client, ClientActionIndex);
    BtlvInput_PlayDecideSE(input);
    BtlvCore_StopCommandSelect(core);
    // Match the native Bag's successful Ball selection. The game's reservation
    // and server still own the debit, action dispatch, animation, and result.
    shooterWork_SetCost(client, index, 0);
    BattleAction_SetItemParam(FIELD(void *, client, ClientAction), tab.selected, 0, 0);
    void *cursor = GetBagCursor(main);
    if (cursor)
        BagCursor_SetBattleLastItem(cursor, tab.selected, BallBattlePocket);
    selItemWork_Reserve(client, index, tab.selected);
    BattleClient_SetSelActProc(client, BattleClient_ActionSelectAutoRest);
}

u32 HOOK_POLL(void *core) {
    if (tab.core != core) {
        closeTab();
        tab.core = core;
        tab.selected = 0;
        tab.gesture = Idle;
        tab.artFailed = 0;
    }
    void *client = FIELD(void *, core, CoreClient);
    void *main = FIELD(void *, core, CoreMain);
    void *input = eligibleInput(core, client, main);
    if (!input || tab.artFailed)
        goto native;

    u16 heap = FIELD(u16, core, CoreHeap);
    void *bag = GetBagSave(main);
    if (!bag)
        goto native;

    if (!tab.inventoryChecked) {
        tab.inventoryChecked = 1;
        if (!tab.selected) {
            tab.selected = sessionBall;
            if (!tab.selected || !stock(bag, heap, tab.selected)) {
                void *cursor = GetBagCursor(main);
                u16 last = cursor ? BagCursor_GetBattleLastItem(cursor) : 0;
                tab.selected = ballIndex(last) >= 0 && stock(bag, heap, last) ? last : Pokeball;
            }
        }
        tab.quantity = stock(bag, heap, tab.selected);
        if (!tab.quantity)
            stockedBall(bag, heap, ballIndex(tab.selected), 1);
    }
    if (!tab.quantity) {
        u32 choice = BtlvCore_WaitCommandSelect(core);
        if (choice)
            closeTab();
        return choice;
    }
    s32 index = ballIndex(tab.selected);
    if (!tab.arc && !openTab(heap))
        goto graphicsFailed;

    u32 held = GCTX_HIDGetHeldKeys(), pressed = GCTX_HIDGetPressedKeys();
    if (tab.gesture == Idle && (held & L) && (pressed & L))
        tab.gesture = Armed;
    if (tab.gesture != Idle) {
        Gesture previous = tab.gesture;
        if ((held | pressed) & B) {
            tab.gesture = Cancelled;
            if (previous != Cancelled)
                BtlvInput_PlayCancelSE(input);
        } else if ((held & L) && tab.gesture != Cancelled && (pressed & (Left | Right | Up | Down))) {
            s32 next = stockedBall(bag, heap, index, pressed & (Right | Down) ? 1 : -1);
            tab.gesture = Cycled;
            if (next >= 0 && next != index) {
                index = next;
                sessionBall = tab.selected;
                BtlvInput_PlayCursorSE(input);
            }
        }
        if (!(held & L)) {
            s32 throwSelected = tab.gesture == Armed;
            tab.gesture = Idle;
            if (throwSelected) {
                closeTab();
                if (stock(bag, heap, tab.selected))
                    throwBall(core, client, main, input);
                return 0;
            }
            if (!drawTab(index, tab.quantity > 999 ? 999 : tab.quantity, 0))
                goto graphicsFailed;
            return 0;
        }
        if (!drawTab(index, tab.quantity > 999 ? 999 : tab.quantity, tab.gesture != Cancelled))
            goto graphicsFailed;
        return 0;
    }
    if (!drawTab(index, tab.quantity > 999 ? 999 : tab.quantity, 0))
        goto graphicsFailed;
    u32 choice = BtlvCore_WaitCommandSelect(core);
    if (choice)
        closeTab();
    return choice;

graphicsFailed:
    tab.artFailed = 1;
native:
    closeTab();
    tab.gesture = Idle;
    return BtlvCore_WaitCommandSelect(core);
}

void HOOK_STOP(void *core) {
    closeTab();
    tab.gesture = Idle;
    BtlvCore_StopCommandSelect(core);
}

void HOOK_DELETE(void *core) {
    closeTab();
    tab.core = 0;
    BtlvCore_Delete(core);
}

void HOOK_DELETE_SKIP(void *core) {
    HOOK_DELETE(core);
}

void *HOOK_NEW_SESSION(u16 heap) {
    sessionBall = 0;
    return BagCursor_Create(heap);
}
