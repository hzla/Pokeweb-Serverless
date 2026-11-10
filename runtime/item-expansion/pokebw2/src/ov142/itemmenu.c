#include "types.h"
#if defined(WHITE2) && (defined(W2U_MEGA) || defined(W2U_EXPANDED_ITEMS)) && !defined(BLACK2)
#include "w2u/resident/mega_roster.h"
#endif
#include "app/bag.h"
#include "app/bag_item.h"
#include "app/itemmenu.h"
#include "app/itemmenu_disp.h"
#include "constants/arc.h"
#include "constants/items.h"
#include "constants/sound.h"
#include "constants/text_banks.h"
#include "field/player_action.h"
#include "gfl/arc.h"
#include "gfl/bg_sys.h"
#include "gfl/bmpwin.h"
#include "gfl/button_man.h"
#include "gfl/clact.h"
#include "gfl/graphics.h"
#include "gfl/heap.h"
#include "gfl/key.h"
#include "gfl/msg.h"
#include "gfl/net.h"
#include "gfl/proc.h"
#include "gfl/sound.h"
#include "gfl/std.h"
#include "gfl/str.h"
#include "gfl/tcb.h"
#include "gfl/tcbl.h"
#include "gfl/touchpanel.h"
#include "gfl/ui.h"
#include "nitro/math.h"
#include "pml/item.h"
#include "save/bag.h"
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
#define ITEMMENU_ITEM_CAPACITY(work) ((work)->itemCapacity)
#define ITEMMENU_ITEM_BYTES(work) ((work)->itemCapacity * sizeof(BagItem))
#define ITEMMENU_ALLOCATE GFL_HeapTryAllocate
#else
#define ITEMMENU_ITEM_CAPACITY(work) NELEMS((work)->items)
#define ITEMMENU_ITEM_BYTES(work) sizeof((work)->items)
#define ITEMMENU_ALLOCATE GFL_HeapAllocate
#endif
#include "save/encounter.h"
#include "save/save_control.h"
#include "system/app_keycursor.h"
#include "system/app_taskmenu.h"
#include "system/blink_palanm.h"
#include "system/bmp_winframe.h"
#include "system/game_beacon.h"
#include "system/game_data.h"
#include "system/gf_font.h"
#include "system/palanm.h"
#include "system/printsys.h"
#include "system/scroll_bar.h"
#include "system/shortcut_util.h"
#include "system/wipe.h"
#include "system/wordset.h"
#include "text/system/btl_main.h"

// The bag (itemmenu.c): its proc, the item list and its menus

// The key items that are used from the bag, and what using them does
typedef struct {
    u16 item;
    u16 count;
    BOOL (*use)(ItemMenuWork *work);
} ItemMenuFieldUse;

// An item of a pocket and what it is sorted by
typedef struct {
    BagItem item;
    u64 key;
} ItemMenuSortEntry;

static void ItemMenu_SetState(ItemMenuWork *work, ItemMenuState state);
static void ItemMenu_RedrawList(ItemMenuWork *work);
static void ItemMenu_UpdateList(ItemMenuWork *work);
static void ItemMenu_SetItemText(ItemMenuWork *work, u32 index, u32 item, BOOL plural, BOOL a4);
static void ItemMenu_SwapItems(ItemMenuWork *work, s32 a, s32 b);
static void ItemMenu_MoveItem(ItemMenuWork *work, s32 from, s32 to);
static void ItemMenu_ChangePocket(ItemMenuWork *work, u32 oldPocket, u32 newPocket);
static BOOL ItemMenu_CursorDown(ItemMenuWork *work, s32 count, BOOL wrap);
static BOOL ItemMenu_CursorUp(ItemMenuWork *work, s32 count, BOOL wrap);
static BOOL ItemMenu_TouchScrollBar(ItemMenuWork *work);
static BOOL ItemMenu_MoveItemByKeys(ItemMenuWork *work);
static BOOL ItemMenu_MoveCursorByKeys(ItemMenuWork *work);
static BOOL ItemMenu_MoveItemByTouch(ItemMenuWork *work);
static BOOL ItemMenu_IsMoveDoneTouched(void);
static void ItemMenu_EndMoveItem(ItemMenuWork *work);
static void ItemMenu_StateMoveItem(ItemMenuWork *work);
static BOOL ItemMenu_IsRepel(u16 item);
static u32 ItemMenu_GetFieldEffect(u16 item);
static void ItemMenu_StateUseRepel(ItemMenuWork *work);
static void ItemMenu_StateWaitMessage(ItemMenuWork *work);
static void ItemMenu_StateUseLightStone(ItemMenuWork *work);
static void ItemMenu_StateShowMessage(ItemMenuWork *work);
static void ItemMenu_ShowItemMessage(ItemMenuWork *work, u32 msgId);
static BOOL ItemMenu_UseInField(ItemMenuWork *work, u32 action, u32 result, BOOL consume);
static BOOL ItemMenu_UseBicycle(ItemMenuWork *work);
static BOOL ItemMenu_UseTownMap(ItemMenuWork *work);
static BOOL ItemMenu_UsePalPad(ItemMenuWork *work);
static BOOL ItemMenu_UseVsRecorder(ItemMenuWork *work);
static BOOL ItemMenu_UseHoney(ItemMenuWork *work);
static BOOL ItemMenu_UseSuperRod(ItemMenuWork *work);
static BOOL ItemMenu_UseDowsingMchn(ItemMenuWork *work);
static BOOL ItemMenu_UseEscapeRope(ItemMenuWork *work);
static BOOL ItemMenu_UseXtransceiver(ItemMenuWork *work);
static BOOL ItemMenu_UseMedalBox(ItemMenuWork *work);
static s32 ItemMenu_FindFieldUse(u16 item);
static void ItemMenu_StateItemMenu(ItemMenuWork *work);
static void ItemMenu_StateSelectItem(ItemMenuWork *work);
static void ItemMenu_StateList(ItemMenuWork *work);
static void ItemMenu_StateTMBootUp(ItemMenuWork *work);
static void ItemMenu_StateTMAskBootUp(ItemMenuWork *work);
static void ItemMenu_StateTMShowMove(ItemMenuWork *work);
static void ItemMenu_StateTMBootUpSound(ItemMenuWork *work);
static void ItemMenu_StateUseTM(ItemMenuWork *work);
static void ItemMenu_StateReturnToList(ItemMenuWork *work);
static void ItemMenu_StateWaitTossMessage(ItemMenuWork *work);
static void ItemMenu_StateTossConfirm(ItemMenuWork *work);
static void ItemMenu_StateTossAsk(ItemMenuWork *work);
static void ItemMenu_StateToss(ItemMenuWork *work);
static void ItemMenu_StateTossQuantity(ItemMenuWork *work);
static void ItemMenu_StateSell(ItemMenuWork *work);
static void ItemMenu_StateSellQuantity(ItemMenuWork *work);
static void ItemMenu_StateSellAsk(ItemMenuWork *work);
static void ItemMenu_StateSellConfirm(ItemMenuWork *work);
static void ItemMenu_StateSellWaitMessage(ItemMenuWork *work);
static void ItemMenu_StateSellEnd(ItemMenuWork *work);
static void ItemMenu_SubItem(ItemMenuWork *work, u32 count);
static void ItemMenu_FixCursorAfterRemove(ItemMenuWork *work);
static void ItemMenu_ShowQuantity(ItemMenuWork *work, u32 mode);
static void ItemMenu_HideQuantity(ItemMenuWork *work);
static BOOL ItemMenu_UpdateQuantity(ItemMenuWork *work);
static void ItemMenu_StateMoveFreeSpace(ItemMenuWork *work);
static void ItemMenu_StateFreeSpaceWaitMessage(ItemMenuWork *work);
static s32 ItemMenu_CompareSortKey(void *a, void *b);
static void ItemMenu_SortByType(ItemMenuWork *work);
static void ItemMenu_SortByName(ItemMenuWork *work);
static void ItemMenu_SortByNumber(ItemMenuWork *work);
static void ItemMenu_SortByUses(ItemMenuWork *work, BOOL mostUsedFirst);
static void ItemMenu_PressSortButton(ItemMenuWork *work);
static void ItemMenu_Sort(ItemMenuWork *work, u32 sortType);
static void ItemMenu_ChangeFreeSpaceFilter(ItemMenuWork *work, u32 filter);
static void ItemMenu_SetFreeSpaceFilter(ItemMenuWork *work, u32 filter);
static void ItemMenu_ResetFreeSpaceFilter(ItemMenuWork *work);
static BOOL ItemMenu_ToggleItemRegistration(ItemMenuWork *work, s32 row);
static u32 ItemMenu_GetPocketShortcut(s32 pocket);
static void ItemMenu_TogglePocketRegistration(ItemMenuWork *work);
static void ItemMenu_UpdatePocketRegistration(ItemMenuWork *work);
static void ItemMenu_SetUseAction(ItemMenuWork *work, void *data, BagItem *slot, u8 *actions);
static void ItemMenu_GetItemActions(ItemMenuWork *work, u8 *actions);
static void ItemMenu_OpenItemMenu(ItemMenuWork *work);
static BOOL ItemMenu_IsDowsingOn(ItemMenuWork *work);
static void ItemMenu_ButtonCallback(u32 button, u32 event, void *data);
static void ItemMenu_VBlank(TCB *tcb, void *data);
static void ItemMenu_StateFadeIn(ItemMenuWork *work);
static void ItemMenu_StateWaitFadeIn(ItemMenuWork *work);
static BOOL ItemMenuProc_Init(GameProc *proc, u32 *state, void *param, void *data);
static BOOL ItemMenuProc_Main(GameProc *proc, u32 *state, void *param, void *data);
static BOOL ItemMenuProc_Exit(GameProc *proc, u32 *state, void *param, void *data);
static void ItemMenu_SetKeyMode(ItemMenuWork *work, BOOL a1);
static void ItemMenu_ReturnToList(ItemMenuWork *work);
static void ItemMenu_StartMoveItem(ItemMenuWork *work);
static void ItemMenu_CreatePaletteAnim(ItemMenuWork *work);
static void ItemMenu_FreePaletteAnim(ItemMenuWork *work);
static void ItemMenu_StateFlashCursor(ItemMenuWork *work);
static void ItemMenu_PressButton(ItemMenuWork *work, u32 button, ItemMenuState next);
static void ItemMenu_StateWaitButton(ItemMenuWork *work);
static s32 ItemMenu_GetQuantityButton(void);
static void ItemMenu_StateTossCancel(ItemMenuWork *work);
static void ItemMenu_StateSellCancel(ItemMenuWork *work);
static void ItemMenu_PressPocketArrow(ItemMenuWork *work, s32 oldPocket, BOOL right, ItemMenuState next);
static void ItemMenu_StateWaitPocketArrow(ItemMenuWork *work);
static void ItemMenu_StateOpenSortMenu(ItemMenuWork *work);
static void ItemMenu_OpenSortMenu(ItemMenuWork *work);
static void ItemMenu_GetSortActions(ItemMenuWork *work, u8 *actions);
static void ItemMenu_StateSortMenu(ItemMenuWork *work);
static void ItemMenu_StateSortDone(ItemMenuWork *work);
static void ItemMenu_StateFilterDone(ItemMenuWork *work);
static void ItemMenu_CreatePaletteFade(ItemMenuWork *work);
static void ItemMenu_FreePaletteFade(ItemMenuWork *work);
static void ItemMenu_StateOpenFilterMenu(ItemMenuWork *work);
static void ItemMenu_OpenFilterMenu(ItemMenuWork *work);
static void ItemMenu_GetFilterActions(ItemMenuWork *work, u8 *actions);
static void ItemMenu_StateFilterMenu(ItemMenuWork *work);
static void ItemMenu_StateSortWaitMessage(ItemMenuWork *work);
static BOOL ItemMenu_CanUseInMode(ItemMenuWork *work, u8 fieldPocket);
static void ItemMenu_StatePocketArrowDone(ItemMenuWork *work);
static void ItemMenu_SaveFreeSpaceFilter(void *cursor, u32 mode, u32 result, u32 freeSpaceFilter);

const GameProcFunctions BAG_PROC_FUNCTIONS = { ItemMenuProc_Init, ItemMenuProc_Main, ItemMenuProc_Exit };

static const ItemMenuFieldUse sItemMenuFieldUses[] = {
    { ITEM_BICYCLE, 1, ItemMenu_UseBicycle },
    { ITEM_TOWN_MAP, 1, ItemMenu_UseTownMap },
    { ITEM_PAL_PAD, 1, ItemMenu_UsePalPad },
    { ITEM_HONEY, 1, ItemMenu_UseHoney },
    { ITEM_SUPER_ROD, 1, ItemMenu_UseSuperRod },
    { ITEM_VS_RECORDER, 1, ItemMenu_UseVsRecorder },
    { ITEM_DOWSING_MCHN, 1, ItemMenu_UseDowsingMchn },
    { ITEM_ESCAPE_ROPE, 1, ItemMenu_UseEscapeRope },
    { ITEM_XTRANSCEIVER_MALE, 1, ItemMenu_UseXtransceiver },
    { ITEM_XTRANSCEIVER_FEMALE, 1, ItemMenu_UseXtransceiver },
    { ITEM_MEDAL_BOX, 1, ItemMenu_UseMedalBox },
};

static void ItemMenu_SetState(ItemMenuWork *work, ItemMenuState state) {
    work->state = state;
    setKeypressFramecounts(work->savedRepeatWait, work->savedRepeatStart);
}

static void ItemMenu_RedrawList(ItemMenuWork *work) {
    work->drawnScroll = 0xffff;
    ItemMenu_UpdateList(work);
}

static void ItemMenu_UpdateList(ItemMenuWork *work) {
    if (GCTX_HIDIsUsingTouch() == FALSE) {
        ItemMenuDisp_DrawItemInfo(work);
    } else {
        ItemMenuDisp_HideItemInfo(work);
    }
    ItemMenuDisp_DrawList(work);
    ItemMenu_UpdatePocketRegistration(work);
    work->listDirty = TRUE;
}

BagItem *ItemMenu_GetSlot(ItemMenuWork *work, u32 index) {
    if (work->movingItem) {
        return &work->items[index];
    }
    return BagItemList_GetItem(&work->itemList, work->pocket, index);
}

s32 ItemMenu_GetSellPrice(u32 item, s32 count, HeapID heapId) {
    s32 price = GetItemParam(item, ITEM_PARAM_PRICE, heapId);

    return price / 2 * count;
}

s32 ItemMenu_GetCursorIndex(ItemMenuWork *work) {
    return work->cursorRow + work->scroll + 1;
}

s32 ItemMenu_GetItemCount(ItemMenuWork *work) {
    if (work->movingItem) {
        return BagSave_GetUniqueItemCount(work->items, ITEMMENU_ITEM_CAPACITY(work));
    }
    return BagItemList_CountShown(&work->itemList, work->pocket);
}

void ItemMenu_SetItemName(ItemMenuWork *work, u32 index, u32 item) {
    loadItemNameToStrbuf(work->wordSet, index, item);
}

void ItemMenu_SetPocketName(ItemMenuWork *work, u32 index, u32 pocket) {
    loadBagPocketNameToStrbuf(work->wordSet, index, pocket);
}

static void ItemMenu_SetItemText(ItemMenuWork *work, u32 index, u32 item, BOOL plural, BOOL a4) {
    loadItemText(work->wordSet, index, item, plural, a4);
}

static void ItemMenu_SwapItems(ItemMenuWork *work, s32 a, s32 b) {
    BagItem temp;

    MI_CpuCopy8(&work->items[a], &temp, sizeof(BagItem));
    MI_CpuCopy8(&work->items[b], &work->items[a], sizeof(BagItem));
    MI_CpuCopy8(&temp, &work->items[b], sizeof(BagItem));
}

static void ItemMenu_MoveItem(ItemMenuWork *work, s32 from, s32 to) {
    if (from == to) {
        return;
    }
    if (from < to) {
        for (; from < to; from++) {
            ItemMenu_SwapItems(work, from, from + 1);
        }
    } else {
        for (; from > to; from--) {
            ItemMenu_SwapItems(work, from, from - 1);
        }
    }
}

static void ItemMenu_ChangePocket(ItemMenuWork *work, u32 oldPocket, u32 newPocket) {
    s16 row;
    s16 scroll;

    BagCursor_SetPocket(work->cursor, oldPocket);
    BagCursor_SetPocketPosition(work->cursor, oldPocket, work->cursorRow, work->scroll + 1);
    BagCursor_GetPocketPosition(work->cursor, newPocket, &row, &scroll);
    work->cursorRow = row;
    work->scroll = scroll - 1;
    ItemMenuDisp_UpdateScrollBar(work);
    ItemMenuDisp_DrawPocketName(work, newPocket);
    ItemMenuDisp_SetPocketTab(work, newPocket);
    ItemMenuDisp_LoadPocketFrame(work, newPocket);
}

static BOOL ItemMenu_CursorDown(ItemMenuWork *work, s32 count, BOOL wrap) {
    s32 row;
    s32 scroll;

    if (count == 0) {
        return FALSE;
    }
    row = work->cursorRow;
    scroll = work->scroll;
    if (row == ITEMMENU_LIST_ROWS - 1 && scroll + ITEMMENU_LIST_ROWS + 1 < count) {
        work->scroll++;
    } else if (row != ITEMMENU_LIST_ROWS - 1 && row + 1 < count) {
        work->cursorRow++;
    } else if (wrap == TRUE) {
        work->scroll = -1;
        work->cursorRow = 0;
    }
    if (row != work->cursorRow || scroll != work->scroll) {
        return TRUE;
    }
    return FALSE;
}

static BOOL ItemMenu_CursorUp(ItemMenuWork *work, s32 count, BOOL wrap) {
    s32 row;
    s32 scroll;

    if (count == 0) {
        return FALSE;
    }
    row = work->cursorRow;
    scroll = work->scroll;
    if (row == 0 && scroll != -1) {
        work->scroll--;
    } else if (row != 0) {
        work->cursorRow--;
    } else if (wrap == TRUE) {
        work->scroll = count - (ITEMMENU_LIST_ROWS + 1);
        if (work->scroll < -1) {
            work->scroll = -1;
        }
        work->cursorRow = ITEMMENU_LIST_ROWS - 1;
        if (work->cursorRow >= count) {
            work->cursorRow = count - 1;
        }
    }
    if (row != work->cursorRow || scroll != work->scroll) {
        return TRUE;
    }
    return FALSE;
}

// Scrolls the list with the scroll bar
static BOOL ItemMenu_TouchScrollBar(ItemMenuWork *work) {
    u32 x;
    u32 y;
    s32 count;
    s32 scroll;

    count = ItemMenu_GetItemCount(work);
    if (count >= ITEMMENU_LIST_ROWS + 1 && GFL_HIDGetTouchHeldPoint(&x, &y) == TRUE) {
        if (x >= 256 || x < 224) {
            return FALSE;
        }
        if (work->touchHeld == FALSE) {
            if (GFL_HIDIsTouchPressed() == TRUE) {
                if (y < 16 || y >= 152) {
                    return FALSE;
                }
                work->touchHeld = TRUE;
            } else {
                return FALSE;
            }
        }
        ItemMenu_SetKeyMode(work, FALSE);
        scroll = work->scroll;
        work->scroll = ScrollBar_GetValue(count - ITEMMENU_LIST_ROWS, y, 26, 142, 0) - 1;
        ItemMenuDisp_TouchScrollBar(work);
        if (work->scroll != scroll) {
            GFL_SndSEPlay(SEQ_SE_SELECT1);
            return TRUE;
        }
    }
    return FALSE;
}

// Moves the item being moved with the keys
static BOOL ItemMenu_MoveItemByKeys(ItemMenuWork *work) {
    BOOL moved = FALSE;
    s32 from;
    s32 count;
    u32 i;

    from = ItemMenu_GetCursorIndex(work);
    count = ItemMenu_GetItemCount(work);
    if (GCTX_HIDGetTypedKeys() & PAD_KEY_DOWN) {
        moved = ItemMenu_CursorDown(work, count, TRUE);
    } else if (GCTX_HIDGetTypedKeys() & PAD_KEY_UP) {
        moved = ItemMenu_CursorUp(work, count, TRUE);
    } else if (GCTX_HIDGetTypedKeys() & PAD_BUTTON_R) {
        for (i = 0; i < ITEMMENU_LIST_ROWS; i++) {
            if (!ItemMenu_CursorDown(work, count, FALSE)) {
                break;
            }
        }
        if (i != 0) {
            moved = TRUE;
        }
    } else if (GCTX_HIDGetTypedKeys() & PAD_BUTTON_L) {
        for (i = 0; i < ITEMMENU_LIST_ROWS; i++) {
            if (!ItemMenu_CursorUp(work, count, FALSE)) {
                break;
            }
        }
        if (i != 0) {
            moved = TRUE;
        }
    }
    if (moved) {
        s32 to = ItemMenu_GetCursorIndex(work);

        GFL_SndSEPlay(SEQ_SE_SELECT1);
        ItemMenu_MoveItem(work, from, to);
    }
    return moved;
}

// Moves the cursor with the keys
static BOOL ItemMenu_MoveCursorByKeys(ItemMenuWork *work) {
    BOOL moved = FALSE;
    s32 count;
    u32 i;

    count = ItemMenu_GetItemCount(work);
    if (GCTX_HIDGetTypedKeys() & PAD_KEY_DOWN) {
        moved = ItemMenu_CursorDown(work, count, TRUE);
    } else if (GCTX_HIDGetTypedKeys() & PAD_KEY_UP) {
        moved = ItemMenu_CursorUp(work, count, TRUE);
    } else if (GCTX_HIDGetTypedKeys() & PAD_BUTTON_R) {
        for (i = 0; i < ITEMMENU_LIST_ROWS; i++) {
            if (!ItemMenu_CursorDown(work, count, FALSE)) {
                break;
            }
        }
        if (i != 0) {
            moved = TRUE;
        }
    } else if (GCTX_HIDGetTypedKeys() & PAD_BUTTON_L) {
        for (i = 0; i < ITEMMENU_LIST_ROWS; i++) {
            if (!ItemMenu_CursorUp(work, count, FALSE)) {
                break;
            }
        }
        if (i != 0) {
            moved = TRUE;
        }
    }
    return moved;
}

// Drags the item being moved to the touched row
static BOOL ItemMenu_MoveItemByTouch(ItemMenuWork *work) {
    u32 x;
    u32 y;
    s32 from;
    u32 row;
    s32 count;
    u32 steps;
    u32 i;

    if (GFL_HIDGetTouchHeldPoint(&x, &y) == TRUE) {
        if (x < 144 || x > 231 || y < 12 || y > 155) {
            return FALSE;
        }
        row = (y - 12) / 24;
        if (work->cursorRow == row) {
            return FALSE;
        }
        count = ItemMenu_GetItemCount(work);
        from = ItemMenu_GetCursorIndex(work);
        steps = MATH_ABS(work->cursorRow - (s32)row);
        if (work->cursorRow < row) {
            for (i = 0; i < steps; i++) {
                if (!ItemMenu_CursorDown(work, count, FALSE)) {
                    break;
                }
            }
        } else if (work->cursorRow > row) {
            for (i = 0; i < steps; i++) {
                if (!ItemMenu_CursorUp(work, count, FALSE)) {
                    break;
                }
            }
        }
        if (i == 0) {
            return FALSE;
        }
        ItemMenu_MoveItem(work, from, ItemMenu_GetCursorIndex(work));
        ItemMenu_SetKeyMode(work, FALSE);
        return TRUE;
    }
    return FALSE;
}

// Whether the button that ends moving an item is touched
static BOOL ItemMenu_IsMoveDoneTouched(void) {
    u32 x;
    u32 y;

    if (GFL_HIDGetTouchPressedPoint(&x, &y) == TRUE && x >= 224 && x <= 247 && y >= 168 && y <= 191) {
        return TRUE;
    }
    return FALSE;
}

static void ItemMenu_EndMoveItem(ItemMenuWork *work) {
    ItemMenuDisp_SetMoveButtons(work, TRUE);
    ItemMenu_ReturnToList(work);
}

// Moving an item
static void ItemMenu_StateMoveItem(ItemMenuWork *work) {
    s32 from;

    BlinkPalAnm_Main(work->paletteAnim);
    if (PrintQueue_IsEmpty(work->printQueue) == FALSE) {
        return;
    }
    from = ItemMenu_GetCursorIndex(work);
    if (ItemMenu_TouchScrollBar(work)) {
        ItemMenu_MoveItem(work, from, ItemMenu_GetCursorIndex(work));
        work->drawnScroll = 0xffff;
        ItemMenu_UpdateList(work);
        return;
    }
    if (GFL_HIDIsTouchHeld() == FALSE) {
        work->touchHeld = FALSE;
        if (work->touchMoved == TRUE) {
            GFL_SndSEPlay(SEQ_SE_DECIDE1);
            work->touchMoved = FALSE;
            BagSave_CopyPocket(work->bag, work->items, work->pocket, FALSE);
            ClActor_SetSequence(work->listCursor, 1);
            ItemMenuDisp_SetMoveButtons(work, TRUE);
            work->movingItem = FALSE;
            ItemMenu_SetKeyMode(work, FALSE);
            ItemMenu_ReturnToList(work);
            return;
        }
    }
    if (work->touchHeld == TRUE) {
        return;
    }
    if (GCTX_HIDGetPressedKeys() & (PAD_BUTTON_A | PAD_BUTTON_SELECT)) {
        GFL_SndSEPlay(SEQ_SE_DECIDE1);
        BagSave_CopyPocket(work->bag, work->items, work->pocket, FALSE);
        ClActor_SetSequence(work->listCursor, 1);
        ItemMenuDisp_SetMoveButtons(work, TRUE);
        work->movingItem = FALSE;
        ItemMenu_SetKeyMode(work, TRUE);
        ItemMenu_ReturnToList(work);
        return;
    }
    if (GCTX_HIDGetPressedKeys() & PAD_BUTTON_B) {
        GFL_SndSEPlay(SEQ_SE_CANCEL1);
        ClActor_SetSequence(work->listCursor, 1);
        work->movingItem = FALSE;
        ItemMenu_SetKeyMode(work, TRUE);
        work->drawnScroll = 0xffff;
        ItemMenu_UpdateList(work);
        ItemMenu_PressButton(work, 4, ItemMenu_EndMoveItem);
        return;
    }
    if (ItemMenu_IsMoveDoneTouched() == TRUE) {
        GFL_SndSEPlay(SEQ_SE_CANCEL1);
        ClActor_SetSequence(work->listCursor, 1);
        work->movingItem = FALSE;
        ItemMenu_SetKeyMode(work, FALSE);
        work->drawnScroll = 0xffff;
        ItemMenu_UpdateList(work);
        ItemMenu_PressButton(work, 4, ItemMenu_EndMoveItem);
        return;
    }
    if (ItemMenu_MoveItemByTouch(work)) {
        work->touchMoved = TRUE;
        ItemMenuDisp_UpdateScrollBar(work);
        GFL_SndSEPlay(SEQ_SE_SELECT1);
        work->drawnScroll = 0xffff;
        ItemMenu_UpdateList(work);
        return;
    }
    if (ItemMenu_MoveItemByKeys(work)) {
        ItemMenuDisp_UpdateScrollBar(work);
        GFL_SndSEPlay(SEQ_SE_SELECT1);
        work->drawnScroll = 0xffff;
        ItemMenu_UpdateList(work);
    }
}

static BOOL ItemMenu_IsRepel(u16 item) {
    return item == ITEM_SUPER_REPEL || item == ITEM_MAX_REPEL || item == ITEM_REPEL;
}

static u32 ItemMenu_GetFieldEffect(u16 item) {
    if (ItemMenu_IsRepel(item)) {
        return 1;
    }
    if (item == ITEM_LIGHT_STONE || item == ITEM_DARK_STONE) {
        return 2;
    }
    return 0;
}

static void ItemMenu_StateUseRepel(ItemMenuWork *work) {
    EncountSave *encount;

    if (ItemMenu_IsRepel(work->item)) {
        encount = SaveControl_GetEncountSave(GameData_GetSaveControl(work->gameData));
        if (EncountSave_IsRepelDepleted(encount)) {
            u8 steps = GetItemParam(work->item, ITEM_PARAM_HOLD_PARAM, work->heapId);

            EncountSave_SetRepelSteps(encount, steps);
            EncountSave_SetUsedRepelItemID(encount, work->item);
            ItemMenu_SubItem(work, 1);
            GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_Used, work->strbuf);
            copyVarForText(work->wordSet, 0, work->playerInfo);
            ItemMenu_SetItemName(work, 1, work->item);
            GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
            ItemMenuDisp_ShowMessage(work, TRUE);
            GFL_SndSEPlay(SEQ_SE_SYS_92);
        } else {
            GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_SinceRepelsEffectsStill, work->strbuf);
            GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
            ItemMenuDisp_ShowMessage(work, TRUE);
        }
        ItemMenu_SetState(work, ItemMenu_StateWaitMessage);
    }
}

// Waits for a message to be read
static void ItemMenu_StateWaitMessage(ItemMenuWork *work) {
    if (ItemMenuDisp_IsMessageDone(work) &&
        ((GCTX_HIDGetPressedKeys() & (PAD_BUTTON_A | PAD_BUTTON_B)) || GFL_HIDIsTouchPressed())) {
        GFL_BGSysClearScr(3);
        work->drawnScroll = 0xffff;
        ItemMenu_UpdateList(work);
        work->listDirty = TRUE;
        ItemMenuDisp_UpdateScrollBar(work);
        ClActor_SetAutoAnim(work->scrollBar, TRUE);
        ItemMenuDisp_SetButtonsActive(work, TRUE);
        ItemMenu_ReturnToList(work);
    }
}

static void ItemMenu_StateUseLightStone(ItemMenuWork *work) {
    if (work->item == ITEM_LIGHT_STONE || work->item == ITEM_DARK_STONE) {
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_JunipersWordsEchoedTheres, work->strbuf);
        copyVarForText(work->wordSet, 0, work->playerInfo);
        GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
        ItemMenuDisp_ShowMessage(work, TRUE);
        ItemMenu_SetState(work, ItemMenu_StateWaitMessage);
    }
}

static void ItemMenu_StateShowMessage(ItemMenuWork *work) {
    ItemMenuDisp_ShowMessage(work, TRUE);
    ItemMenu_SetState(work, ItemMenu_StateWaitMessage);
}

// Shows a message about the item
static void ItemMenu_ShowItemMessage(ItemMenuWork *work, u32 msgId) {
    GFL_MsgDataLoadStrbuf(work->msgData, msgId, work->strbuf);
    copyVarForText(work->wordSet, 0, work->playerInfo);
    loadItemNameToStrbuf(work->wordSet, 1, work->item);
    GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
    ItemMenu_SetState(work, ItemMenu_StateShowMessage);
}

// Leaves the bag to use an item, if the player may
static BOOL ItemMenu_UseInField(ItemMenuWork *work, u32 action, u32 result, BOOL consume) {
    if (PlayerActionPerms_IsActionBlocked(work->perms, action) == FALSE) {
        if (consume) {
            ItemMenu_SubItem(work, 1);
        }
        work->result = result;
        ItemMenu_SetState(work, NULL);
        return TRUE;
    }
    ItemMenu_ShowItemMessage(work, 58);
    return FALSE;
}

static BOOL ItemMenu_UseBicycle(ItemMenuWork *work) {
    u8 blocked = PlayerActionPerms_IsActionBlocked(work->perms, 0);

    if (work->menuAction == 0) {
        if (blocked == FALSE) {
            work->result = 10;
            ItemMenu_SetState(work, NULL);
            return TRUE;
        }
        if (blocked == 1) {
            ItemMenu_ShowItemMessage(work, 119);
        } else {
            ItemMenu_ShowItemMessage(work, 58);
        }
        return FALSE;
    }
    if (work->menuAction == 1) {
        if (blocked == FALSE) {
            work->result = 11;
            ItemMenu_SetState(work, NULL);
            return TRUE;
        }
        ItemMenu_ShowItemMessage(work, 57);
        return FALSE;
    }
    return FALSE;
}

static BOOL ItemMenu_UseTownMap(ItemMenuWork *work) {
    return ItemMenu_UseInField(work, 1, 7, FALSE);
}

static BOOL ItemMenu_UsePalPad(ItemMenuWork *work) {
    return ItemMenu_UseInField(work, 2, 8, FALSE);
}

static BOOL ItemMenu_UseVsRecorder(ItemMenuWork *work) {
    return ItemMenu_UseInField(work, 6, 17, FALSE);
}

static BOOL ItemMenu_UseHoney(ItemMenuWork *work) {
    return ItemMenu_UseInField(work, 4, 15, TRUE);
}

static BOOL ItemMenu_UseSuperRod(ItemMenuWork *work) {
    u8 blocked = PlayerActionPerms_IsActionBlocked(work->perms, 5);

    if (blocked == FALSE) {
        work->result = 16;
        ItemMenu_SetState(work, NULL);
        return TRUE;
    }
    if (blocked == 1) {
        ItemMenu_ShowItemMessage(work, 119);
    } else {
        ItemMenu_ShowItemMessage(work, 58);
    }
    return FALSE;
}

static BOOL ItemMenu_UseDowsingMchn(ItemMenuWork *work) {
    if (work->menuAction == 0) {
        return ItemMenu_UseInField(work, 9, 20, FALSE);
    }
    return FALSE;
}

static BOOL ItemMenu_UseEscapeRope(ItemMenuWork *work) {
    if (work->menuAction == 0) {
        return ItemMenu_UseInField(work, 3, 14, TRUE);
    }
    return FALSE;
}

static BOOL ItemMenu_UseXtransceiver(ItemMenuWork *work) {
    return ItemMenu_UseInField(work, 10, 21, FALSE);
}

static BOOL ItemMenu_UseMedalBox(ItemMenuWork *work) {
    return ItemMenu_UseInField(work, 11, 22, FALSE);
}

// The entry of the key items an item uses, or -1
static s32 ItemMenu_FindFieldUse(u16 item) {
    u32 i;

    for (i = 0; i < NELEMS(sItemMenuFieldUses); i++) {
        const ItemMenuFieldUse *use = &sItemMenuFieldUses[i];

        if (item >= use->item && item < use->item + use->count) {
            return i;
        }
    }
    return -1;
}

// The item menu, once the player picked from it
static void ItemMenu_StateItemMenu(ItemMenuWork *work) {
    BOOL done = FALSE;
    u32 pocket;
    u32 fieldUse;

    if (ItemMenuDisp_IsMessageDone(work) == FALSE) {
        return;
    }
    if (AppTaskMenu_IsFlashFinished(work->taskMenu)) {
        work->menuAction = work->itemMenuActions[AppTaskMenu_GetCursorPos(work->taskMenu)];
        switch (work->menuAction) {
        case 0:
            pocket = BagSave_GetExistingItemPocket(work->bag, work->item);
            ItemMenuDisp_SetBackButtonActive(work, FALSE);
            if (pocket != BAG_POCKET_FREE_SPACE) {
                if (pocket != BAG_POCKET_KEY_ITEMS) {
                    GameBeaconSys_SendItemUse(work->item);
                }
            } else if (GetItemParam(work->item, ITEM_PARAM_IMPORTANT, work->heapId) == 0) {
                GameBeaconSys_SendItemUse(work->item);
            }
            if (pocket == BAG_POCKET_TMS_HMS) {
                ItemMenu_SetState(work, ItemMenu_StateUseTM);
            } else if (GetItemParam(work->item, ITEM_PARAM_EVOLVE, work->heapId) == TRUE) {
                work->result = 12;
                ItemMenu_SetState(work, NULL);
            } else if (ItemMenu_FindFieldUse(work->item) >= 0) {
                sItemMenuFieldUses[ItemMenu_FindFieldUse(work->item)].use(work);
            } else {
                fieldUse = ItemMenu_GetFieldEffect(work->item);
                if (fieldUse == 1) {
                    ItemMenu_SetState(work, ItemMenu_StateUseRepel);
                } else if (fieldUse == 2) {
                    ItemMenu_SetState(work, ItemMenu_StateUseLightStone);
                } else {
                    work->result = 5;
                    ItemMenu_SetState(work, NULL);
                }
            }
            break;
        case 1:
            ItemMenuDisp_SetBackButtonActive(work, FALSE);
            if (PlayerActionPerms_IsActionBlocked(work->perms, 0) == FALSE) {
                work->result = 11;
                ItemMenu_SetState(work, NULL);
            } else {
                GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_CantDismountBikeHere, work->strbuf);
                copyVarForText(work->wordSet, 0, work->playerInfo);
                GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
                ItemMenu_SetState(work, ItemMenu_StateShowMessage);
            }
            break;
        case 3:
            ItemMenu_SetState(work, ItemMenu_StateToss);
            break;
        case 8:
        case 9:
            ItemMenu_SetState(work, ItemMenu_StateMoveFreeSpace);
            break;
        case 4:
        case 5:
            if (ItemMenu_CanRegister(work) == TRUE) {
                ItemMenu_ToggleItemRegistration(work, work->cursorRow);
                ItemMenu_UpdateList(work);
                ItemMenuDisp_SetButtonsActive(work, TRUE);
                ClActor_SetAutoAnim(work->scrollBar, TRUE);
                ItemMenu_ReturnToList(work);
            }
            break;
        case 2:
            ItemMenuDisp_SetBackButtonActive(work, FALSE);
            if (work->item >= ITEM_GREET_MAIL && work->item <= ITEM_BRIDGE_MAIL_M) {
                work->result = 19;
                ItemMenu_SetState(work, NULL);
            }
            break;
        case 10:
            if (GCTX_HIDIsUsingTouch() == TRUE) {
                ItemMenuDisp_HideItemInfo(work);
            } else {
                ItemMenuDisp_DrawItemInfo(work);
            }
            ItemMenu_SetKeyMode(work, GCTX_HIDIsUsingTouch() ? FALSE : TRUE);
            ItemMenuDisp_SetButtonsActive(work, TRUE);
            ClActor_SetAutoAnim(work->scrollBar, TRUE);
            ItemMenu_ReturnToList(work);
            break;
        case 11:
            work->result = 1;
            ItemMenu_SetState(work, NULL);
            break;
        case 6:
            work->result = 2;
            ItemMenuDisp_SetBackButtonActive(work, FALSE);
            ItemMenu_SetState(work, NULL);
            break;
        case 7:
            break;
        }
        done = TRUE;
    }
    if (done) {
        ItemMenuDisp_ClearMsgWindow(work);
        AppTaskMenu_Free(work->taskMenu);
        work->taskMenu = NULL;
    }
}

// The item under the cursor was picked
static void ItemMenu_StateSelectItem(ItemMenuWork *work) {
    BagItem *slot = ItemMenu_GetSlot(work, ItemMenu_GetCursorIndex(work));

    work->item = ITEM_NONE;
    if (slot != NULL) {
        work->item = slot->item;
    }
    if (work->mode == 2) {
        if (GetItemParam(work->item, ITEM_PARAM_IMPORTANT, work->heapId) == 0 &&
            PML_ItemIsNotSpecialMonsball(work->item) == TRUE) {
            if (PML_ItemIsMail(work->item)) {
                work->result = 18;
            } else {
                work->result = 3;
            }
            ItemMenu_SetState(work, NULL);
            return;
        }
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_CantHeld, work->strbuf);
        ItemMenu_SetItemName(work, 0, work->item);
        GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
        ItemMenuDisp_ShowMessageNow(work);
        ItemMenuDisp_SetButtonsActive(work, FALSE);
        ItemMenuDisp_SetBackButtonActive(work, FALSE);
        ItemMenu_SetState(work, ItemMenu_StateReturnToList);
    } else if (work->mode == 5) {
        work->result = 1;
        ItemMenu_SetState(work, NULL);
    } else if (work->mode == 4) {
        ItemMenu_SetState(work, ItemMenu_StateSell);
    } else {
        ItemMenu_OpenItemMenu(work);
        ItemMenuDisp_SetItemMenuMessage(work, work->item);
        ItemMenuDisp_ShowMessageNow(work);
        ClActor_SetAutoAnim(work->scrollBar, FALSE);
        ItemMenu_SetState(work, ItemMenu_StateItemMenu);
    }
}

// The list
static void ItemMenu_StateList(ItemMenuWork *work) {
    u32 keys;
    s32 pocket;

    if (PrintQueue_IsEmpty(work->printQueue) == FALSE) {
        return;
    }
    if (GFL_HIDIsTouchHeld() == FALSE) {
        work->touchHeld = FALSE;
    }
    GFL_BMN_Main(work->buttonMan);
    BlinkPalAnm_Main(work->paletteAnim);
    if (work->state != ItemMenu_StateList) {
        return;
    }
    if (ItemMenu_TouchScrollBar(work)) {
        work->drawnScroll = 0xffff;
        ItemMenu_UpdateList(work);
        return;
    }
    if (work->touchHeld == TRUE) {
        return;
    }
    if (GCTX_HIDIsUsingTouch() == TRUE) {
        keys = GCTX_HIDGetPressedKeys();
        if (keys == 0) {
            return;
        }
        if (ItemMenu_GetItemCount(work) != 0) {
            if (!(keys & (PAD_BUTTON_B | PAD_BUTTON_START | PAD_BUTTON_X | PAD_BUTTON_Y))) {
                GFL_SndSEPlay(SEQ_SE_SELECT1);
                ItemMenuDisp_DrawItemInfo(work);
                ItemMenu_SetKeyMode(work, TRUE);
                return;
            }
        } else {
            ItemMenu_SetKeyMode(work, TRUE);
            if (keys & (PAD_BUTTON_A | PAD_BUTTON_SELECT | PAD_BUTTON_START | PAD_KEY_UP | PAD_KEY_DOWN)) {
                return;
            }
        }
    }
    if (GCTX_HIDGetPressedKeys() & PAD_BUTTON_B) {
        work->result = 1;
        work->item = ITEM_NONE;
        GCTX_HIDSetUsingTouch(FALSE);
        ItemMenu_PressButton(work, 4, NULL);
        return;
    }
    if (GCTX_HIDGetPressedKeys() & PAD_BUTTON_X) {
        if (work->mode == 2) {
            return;
        }
        work->result = 0;
        work->item = ITEM_NONE;
        GCTX_HIDSetUsingTouch(FALSE);
        ItemMenu_PressButton(work, 3, NULL);
        return;
    }
    if (GCTX_HIDGetPressedKeys() & PAD_BUTTON_Y) {
        if (ItemMenu_CanRegister(work) == TRUE) {
            if (ItemMenu_ToggleItemRegistration(work, work->cursorRow) == TRUE) {
                ItemMenu_UpdateList(work);
            } else {
                ItemMenu_TogglePocketRegistration(work);
            }
            if (GCTX_HIDIsUsingTouch() == TRUE) {
                ItemMenuDisp_DrawItemInfo(work);
                ItemMenu_SetKeyMode(work, TRUE);
            }
        }
        return;
    }
    if (GCTX_HIDGetPressedKeys() & PAD_BUTTON_START) {
        if (work->pocket != BAG_POCKET_FREE_SPACE) {
            if (ItemMenu_GetItemCount(work) > 1) {
                ItemMenu_PressSortButton(work);
                ItemMenu_SetKeyMode(work, TRUE);
                ItemMenuDisp_SetBackButtonActive(work, FALSE);
                work->drawnScroll = 0xffff;
                ItemMenu_UpdateList(work);
                ItemMenu_SetState(work, ItemMenu_StateOpenSortMenu);
                return;
            }
        } else if (ItemMenu_CountFilterActions(work) > 2) {
            ItemMenu_PressSortButton(work);
            ItemMenu_SetKeyMode(work, TRUE);
            ItemMenuDisp_SetBackButtonActive(work, FALSE);
            work->drawnScroll = 0xffff;
            ItemMenu_UpdateList(work);
            ItemMenu_SetState(work, ItemMenu_StateOpenFilterMenu);
            return;
        }
    }
    if (GCTX_HIDGetPressedKeys() & PAD_BUTTON_A) {
        if (ItemMenu_GetItemCount(work) > 0) {
            ItemMenu_SetState(work, ItemMenu_StateFlashCursor);
            return;
        }
    } else if (GCTX_HIDGetPressedKeys() & PAD_BUTTON_SELECT) {
        if (work->pocket == BAG_POCKET_FREE_SPACE) {
            return;
        }
        if (ItemMenu_GetItemCount(work) <= 1) {
            return;
        }
        MI_CpuFill8(work->items, 0, ITEMMENU_ITEM_BYTES(work));
        BagSave_CopyPocket(work->bag, work->items, work->pocket, TRUE);
        ClActor_SetSequence(work->listCursor, 2);
        ItemMenuDisp_SetMoveButtons(work, FALSE);
        work->movingItem = TRUE;
        ItemMenu_StartMoveItem(work);
        return;
    } else if (ItemMenu_MoveCursorByKeys(work)) {
        ItemMenuDisp_UpdateScrollBar(work);
        GFL_SndSEPlay(SEQ_SE_SELECT1);
        ItemMenu_UpdateList(work);
        return;
    }
    if (GCTX_HIDGetTypedKeys() & PAD_KEY_RIGHT) {
        pocket = work->pocket;
        if (++work->pocket >= 6) {
            work->pocket = 0;
        }
        GCTX_HIDSetUsingTouch(FALSE);
        ItemMenu_PressPocketArrow(work, pocket, TRUE, ItemMenu_StatePocketArrowDone);
    } else if (GCTX_HIDGetTypedKeys() & PAD_KEY_LEFT) {
        pocket = work->pocket;
        if (--work->pocket < 0) {
            work->pocket = 5;
        }
        GCTX_HIDSetUsingTouch(FALSE);
        ItemMenu_PressPocketArrow(work, pocket, FALSE, ItemMenu_StatePocketArrowDone);
    }
}

// Whether to boot up the TM
static void ItemMenu_StateTMBootUp(ItemMenuWork *work) {
    if (AppTaskMenu_IsFlashFinished(work->taskMenu)) {
        if (AppTaskMenu_GetCursorPos(work->taskMenu) == 0) {
            ItemMenuDisp_ClearMsgWindow(work);
            work->result = 6;
            ItemMenu_SetState(work, NULL);
        } else {
            ItemMenuDisp_ClearMsgWindow(work);
            GFL_BGSysClearScr(3);
            ClActor_SetAutoAnim(work->scrollBar, TRUE);
            ItemMenuDisp_SetButtonsActive(work, TRUE);
            if (GCTX_HIDIsUsingTouch() == TRUE) {
                ItemMenuDisp_HideItemInfo(work);
                ItemMenu_SetKeyMode(work, FALSE);
            } else {
                ItemMenu_SetKeyMode(work, TRUE);
            }
            ItemMenu_ReturnToList(work);
        }
        ItemMenuDisp_CloseMenu(work);
    }
}

static void ItemMenu_StateTMAskBootUp(ItemMenuWork *work) {
    if (ItemMenuDisp_IsMessageDone(work)) {
        ItemMenuDisp_OpenYesNoMenu(work);
        ItemMenu_SetState(work, ItemMenu_StateTMBootUp);
    }
}

// Asks whether to teach the TM's move
static void ItemMenu_StateTMShowMove(ItemMenuWork *work) {
    if (GFL_SndPlayerIsActiveAny() != TRUE &&
        ((GCTX_HIDGetPressedKeys() & (PAD_BUTTON_A | PAD_BUTTON_B)) || GFL_HIDIsTouchPressed())) {
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_ContainedTeachPokemon, work->strbuf);
        loadMoveNameToStrbuf(work->wordSet, 0, PML_ItemGetTMWazaID(work->item));
        GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
        ItemMenuDisp_ShowMessage(work, TRUE);
        ItemMenu_SetState(work, ItemMenu_StateTMAskBootUp);
    }
}

static void ItemMenu_StateTMBootUpSound(ItemMenuWork *work) {
    if (ItemMenuDisp_IsMessageDone(work)) {
        GFL_SndSEPlay(SEQ_SE_PC_LOGIN);
        ItemMenu_SetState(work, ItemMenu_StateTMShowMove);
    }
}

// Boots up a TM or HM
static void ItemMenu_StateUseTM(ItemMenuWork *work) {
    if (PML_ItemGetHMID(work->item) == 0xff) {
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_BootedUpTm, work->expandBuf);
    } else {
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_BootedUpHm, work->expandBuf);
    }
    ItemMenuDisp_ShowMessage(work, TRUE);
    ItemMenu_SetState(work, ItemMenu_StateTMBootUpSound);
}

// Waits for a message to be read, then goes back to the list
static void ItemMenu_StateReturnToList(ItemMenuWork *work) {
    if ((GCTX_HIDGetPressedKeys() & (PAD_BUTTON_A | PAD_BUTTON_B)) || GFL_HIDIsTouchPressed()) {
        GFL_BGSysClearScr(3);
        work->drawnScroll = 0xffff;
        ItemMenu_UpdateList(work);
        work->listDirty = TRUE;
        ItemMenuDisp_UpdateScrollBar(work);
        ClActor_SetAutoAnim(work->scrollBar, TRUE);
        ItemMenuDisp_SetButtonsActive(work, TRUE);
        ItemMenu_ReturnToList(work);
    }
}

static void ItemMenu_StateWaitTossMessage(ItemMenuWork *work) {
    if (ItemMenuDisp_IsMessageDone(work)) {
        ItemMenu_SetState(work, ItemMenu_StateReturnToList);
    }
}

// Whether to toss the items
static void ItemMenu_StateTossConfirm(ItemMenuWork *work) {
    u32 pos;

    if (AppTaskMenu_IsFlashFinished(work->taskMenu)) {
        pos = AppTaskMenu_GetCursorPos(work->taskMenu);
        ItemMenuDisp_CloseMenu(work);
        GFL_BGSysClearScr(3);
        if (pos == 0) {
            GFL_SndSEPlay(SEQ_SE_SYS_08);
            ItemMenu_SubItem(work, work->quantity);
            GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_ThrewAway, work->strbuf);
            ItemMenu_SetItemText(work, 0, work->item, work->quantity > 1, FALSE);
            WordSetNumber(work->wordSet, 1, work->quantity, 3, 0, TRUE);
            GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
            ItemMenuDisp_ShowMessageNow(work);
            ItemMenu_SetState(work, ItemMenu_StateWaitTossMessage);
        } else {
            ClActor_SetAutoAnim(work->scrollBar, TRUE);
            ItemMenuDisp_SetButtonsActive(work, TRUE);
            ItemMenu_SetKeyMode(work, GCTX_HIDIsUsingTouch() ? FALSE : TRUE);
            ItemMenu_ReturnToList(work);
        }
    }
}

static void ItemMenu_StateTossAsk(ItemMenuWork *work) {
    if (ItemMenuDisp_IsMessageDone(work)) {
        ItemMenuDisp_OpenYesNoMenu(work);
        ItemMenu_SetState(work, ItemMenu_StateTossConfirm);
    }
}

// Tossing an item: asks how many
static void ItemMenu_StateToss(ItemMenuWork *work) {
    work->quantity = 1;
    ItemMenu_ShowQuantity(work, 1);
    GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_ThrowAwayHowMany, work->strbuf);
    ItemMenu_SetItemText(work, 0, work->item, TRUE, FALSE);
    GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
    ItemMenuDisp_ShowMessageNow(work);
    ItemMenu_SetState(work, ItemMenu_StateTossQuantity);
}

// The number of items to toss
static void ItemMenu_StateTossQuantity(ItemMenuWork *work) {
    s32 result;

    if (ItemMenuDisp_IsMessageDone(work) && ItemMenu_UpdateQuantity(work) != TRUE) {
        result = ItemMenu_GetQuantityButton();
        if (result == -1) {
            if (GCTX_HIDGetPressedKeys() & PAD_BUTTON_A) {
                result = 0;
                GCTX_HIDSetUsingTouch(FALSE);
            } else if (GCTX_HIDGetPressedKeys() & PAD_BUTTON_B) {
                GCTX_HIDSetUsingTouch(FALSE);
                result = 1;
            }
        }
        if (result == 0) {
            GFL_SndSEPlay(SEQ_SE_DECIDE1);
            ItemMenu_HideQuantity(work);
            GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_OkThrowAway, work->strbuf);
            ItemMenu_SetItemText(work, 0, work->item, work->quantity > 1, FALSE);
            WordSetNumber(work->wordSet, 1, work->quantity, 3, 0, TRUE);
            GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
            ItemMenuDisp_ShowMessageNow(work);
            ItemMenu_SetState(work, ItemMenu_StateTossAsk);
        } else if (result == 1) {
            GFL_SndSEPlay(SEQ_SE_CANCEL1);
            ItemMenu_PressButton(work, 4, ItemMenu_StateTossCancel);
        }
    }
}

// Selling an item
static void ItemMenu_StateSell(ItemMenuWork *work) {
    s32 price;
    u32 important;

    ClActor_SetAutoAnim(work->scrollBar, FALSE);
    price = GetItemParam(work->item, ITEM_PARAM_PRICE, work->heapId);
    important = GetItemParam(work->item, ITEM_PARAM_IMPORTANT, work->heapId);
    if (price == 0 || important != 0) {
        ItemMenuDisp_SetButtonsActive(work, FALSE);
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_OhNoCantBuy, work->strbuf);
        ItemMenu_SetItemName(work, 0, work->item);
        GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
        ItemMenuDisp_ShowMessageNow(work);
        ItemMenuDisp_SetBackButtonActive(work, FALSE);
        ItemMenu_SetState(work, ItemMenu_StateSellWaitMessage);
        return;
    }
    work->quantity = 1;
    ItemMenuDisp_ShowMoney(work);
    ItemMenuDisp_SetButtonsActive(work, FALSE);
    if (ItemMenu_GetSlot(work, ItemMenu_GetCursorIndex(work))->count == 1) {
        ItemMenu_SetState(work, ItemMenu_StateSellAsk);
        return;
    }
    ItemMenu_ShowQuantity(work, 2);
    GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_HowManyWillSell, work->strbuf);
    ItemMenu_SetItemName(work, 0, work->item);
    GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
    ItemMenuDisp_ShowMessageNow(work);
    ItemMenu_SetState(work, ItemMenu_StateSellQuantity);
}

// The number of items to sell
static void ItemMenu_StateSellQuantity(ItemMenuWork *work) {
    s32 result;

    if (ItemMenuDisp_IsMessageDone(work) && ItemMenu_UpdateQuantity(work) != TRUE) {
        result = ItemMenu_GetQuantityButton();
        if (result == -1) {
            if (GCTX_HIDGetPressedKeys() & PAD_BUTTON_A) {
                result = 0;
                GCTX_HIDSetUsingTouch(FALSE);
            } else if (GCTX_HIDGetPressedKeys() & PAD_BUTTON_B) {
                GCTX_HIDSetUsingTouch(FALSE);
                result = 1;
            }
        }
        if (result == 0) {
            GFL_SndSEPlay(SEQ_SE_DECIDE1);
            ItemMenu_HideQuantity(work);
            ItemMenu_SetState(work, ItemMenu_StateSellAsk);
        } else if (result == 1) {
            GFL_SndSEPlay(SEQ_SE_CANCEL1);
            ItemMenu_PressButton(work, 4, ItemMenu_StateSellCancel);
        }
    }
}

// Asks whether to sell the items for their price
static void ItemMenu_StateSellAsk(ItemMenuWork *work) {
    s32 price;

    ItemMenuDisp_OpenYesNoMenu(work);
    price = ItemMenu_GetSellPrice(work->item, work->quantity, work->heapId);
    GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_CanPayWouldOk, work->strbuf);
    WordSetNumber(work->wordSet, 0, price, 7, 0, TRUE);
    GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
    ItemMenuDisp_ShowMessageNow(work);
    ItemMenu_SetState(work, ItemMenu_StateSellConfirm);
}

// Whether to sell the items
static void ItemMenu_StateSellConfirm(ItemMenuWork *work) {
    u32 pos;
    s32 price;

    if (ItemMenuDisp_IsMessageDone(work) && AppTaskMenu_IsFlashFinished(work->taskMenu)) {
        pos = AppTaskMenu_GetCursorPos(work->taskMenu);
        ItemMenuDisp_CloseMenu(work);
        switch (pos) {
        case 0:
            price = ItemMenu_GetSellPrice(work->item, work->quantity, work->heapId);
            ItemMenu_SubItem(work, work->quantity);
            addCashToTotal(getTrainerCardDataBlkAddress(work->gameData), price);
            GFL_SndSEPlay(SEQ_SE_SYS_22);
            ItemMenuDisp_DrawMoney(work);
            GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_TurnedOverReceived, work->strbuf);
            ItemMenu_SetItemText(work, 0, work->item, work->quantity > 1, FALSE);
            WordSetNumber(work->wordSet, 1, price, 7, 0, TRUE);
            GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
            ItemMenuDisp_ShowMessageNow(work);
            ItemMenu_SetState(work, ItemMenu_StateSellWaitMessage);
            break;
        case 1:
            ItemMenu_SetKeyMode(work, GCTX_HIDIsUsingTouch() ? FALSE : TRUE);
            ItemMenu_SetState(work, ItemMenu_StateSellEnd);
            break;
        }
    }
}

static void ItemMenu_StateSellWaitMessage(ItemMenuWork *work) {
    if (ItemMenuDisp_IsMessageDone(work)) {
        if (GCTX_HIDGetPressedKeys() & (PAD_BUTTON_A | PAD_BUTTON_B)) {
            ItemMenu_SetKeyMode(work, TRUE);
            ItemMenu_SetState(work, ItemMenu_StateSellEnd);
        } else if (GFL_HIDIsTouchPressed()) {
            ItemMenu_SetKeyMode(work, FALSE);
            ItemMenu_SetState(work, ItemMenu_StateSellEnd);
        }
    }
}

// Goes back to the list after selling
static void ItemMenu_StateSellEnd(ItemMenuWork *work) {
    GFL_BGSysClearScr(3);
    work->drawnScroll = 0xffff;
    ItemMenu_UpdateList(work);
    work->listDirty = TRUE;
    ItemMenuDisp_UpdateScrollBar(work);
    ItemMenuDisp_HideMoney(work);
    ClActor_SetAutoAnim(work->scrollBar, TRUE);
    ItemMenuDisp_SetButtonsActive(work, TRUE);
    ItemMenu_ReturnToList(work);
}

// Takes a count of the item under the cursor out of the bag
static void ItemMenu_SubItem(ItemMenuWork *work, u32 count) {
    // The slot isn't used, but the original looks it up
    BagItem *slot = ItemMenu_GetSlot(work, ItemMenu_GetCursorIndex(work));
    BOOL inFreeSpace = BagSave_IsItemInFreeSpace(work->bag, work->item);

    BagSave_SubItem(work->bag, work->item, count, work->heapId);
    if (BagSave_GetItemCountByID(work->bag, work->item, work->heapId) == 0) {
        if (inFreeSpace == TRUE) {
            BagItemList_Remove(&work->itemList, ItemMenu_GetCursorIndex(work), FALSE);
        }
        ItemMenu_FixCursorAfterRemove(work);
    }
}

// Moves the cursor up after the list got shorter
static void ItemMenu_FixCursorAfterRemove(ItemMenuWork *work) {
    s32 pos = ItemMenu_GetCursorIndex(work);
    s32 count = ItemMenu_GetItemCount(work) + 1;
    BOOL atEnd = FALSE;
    BOOL atScrollEnd = FALSE;
    s32 scroll;
    s32 next;

    if (count == pos + 1) {
        atEnd = TRUE;
    }
    scroll = work->scroll;
    if (scroll == count - (ITEMMENU_LIST_ROWS + 1)) {
        atScrollEnd = TRUE;
    }
    if (count < ITEMMENU_LIST_ROWS + 1) {
        if (atEnd == TRUE) {
            next = work->cursorRow - 1;
            if (next <= 0) {
                next = 0;
            }
            work->cursorRow = next;
        }
    } else if (atScrollEnd) {
        if (atEnd == FALSE) {
            work->cursorRow++;
            next = work->scroll - 1;
            if (next < -1) {
                next = -1;
            }
            work->scroll = next;
        } else {
            next = scroll - 1;
            if (next < -1) {
                next = -1;
            }
            work->scroll = next;
        }
    }
}

// Shows the quantity
static void ItemMenu_ShowQuantity(ItemMenuWork *work, u32 mode) {
    work->quantityMode = mode;
    ItemMenuDisp_DrawQuantityFrame(work);
    ItemMenuDisp_DrawQuantity(work, work->quantity);
    ClActor_SetVisible(work->buttons[5], TRUE);
    ClActor_SetVisible(work->buttons[6], TRUE);
}

static void ItemMenu_HideQuantity(ItemMenuWork *work) {
    GFL_BGSysClearScr(3);
    ClActor_SetVisible(work->buttons[5], FALSE);
    ClActor_SetVisible(work->buttons[6], FALSE);
}

// Changes the quantity with the keys or the arrows. Returns whether it was changed
static BOOL ItemMenu_UpdateQuantity(ItemMenuWork *work) {
    s32 old = work->quantity;
    BOOL changed = FALSE;
    BagItem *slot = ItemMenu_GetSlot(work, ItemMenu_GetCursorIndex(work));
    // The right edge of the arrows, the screen's, doesn't fit in a u8
    TouchRect rects[] = {
        { 92, 116, 234, 0 },
        { 116, 140, 234, 0 },
        { TOUCH_RECT_END, 0, 0, 0 },
    };
    s32 hit = GFL_HIDGetTouchHeldRect(rects);
    u32 down;

    if (hit != TOUCH_RECT_NONE) {
        work->quantityRepeat++;
        changed = TRUE;
    } else {
        work->quantityRepeat = 0;
    }
    if (work->quantityRepeat == 1 || work->quantityRepeat > 30) {
        switch (hit) {
        case 0:
            if (work->quantityRepeat > 120) {
                work->quantity += 10;
            } else {
                work->quantity += 1;
            }
            down = FALSE;
            break;
        case 1:
            if (work->quantityRepeat > 120) {
                work->quantity -= 10;
            } else {
                work->quantity -= 1;
            }
            down = TRUE;
            break;
        }
    }
    if (hit == TOUCH_RECT_NONE) {
        if (GCTX_HIDGetTypedKeys() & PAD_KEY_UP) {
            work->quantity += 1;
            down = FALSE;
            changed = TRUE;
        } else if (GCTX_HIDGetTypedKeys() & PAD_KEY_DOWN) {
            work->quantity -= 1;
            down = TRUE;
            changed = TRUE;
        } else if (GCTX_HIDGetTypedKeys() & PAD_KEY_RIGHT) {
            work->quantity += 10;
            down = FALSE;
            changed = TRUE;
        } else if (GCTX_HIDGetTypedKeys() & PAD_KEY_LEFT) {
            work->quantity -= 10;
            down = TRUE;
            changed = TRUE;
        }
    }
    if (slot->count < work->quantity) {
        work->quantity = 1;
    } else if (work->quantity < 1) {
        work->quantity = slot->count;
    }
    if (work->quantity != old) {
        GFL_SndSEPlay(SEQ_SE_SELECT1);
        if (down == FALSE) {
            ClActor_SetSequence(work->buttons[5], 11);
        } else {
            ClActor_SetSequence(work->buttons[6], 10);
        }
        ItemMenuDisp_DrawQuantity(work, work->quantity);
    }
    return changed;
}

// Moves the item under the cursor to the Free Space, or back to its pocket
static void ItemMenu_StateMoveFreeSpace(ItemMenuWork *work) {
    BOOL inFreeSpace = BagSave_IsItemInFreeSpace(work->bag, work->item);
    u32 pocket = BagSave_GetExistingItemPocket(work->bag, work->item);
    BOOL plural = ItemMenu_GetSlot(work, ItemMenu_GetCursorIndex(work))->count == 1 ? FALSE : TRUE;

    if (inFreeSpace == FALSE) {
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_Moved, work->strbuf);
        ItemMenu_SetItemText(work, 1, work->item, plural, FALSE);
        ItemMenu_SetPocketName(work, 0, BAG_POCKET_FREE_SPACE);
        BagItemList_Add(&work->itemList, work->item, pocket);
    } else {
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_Returned, work->strbuf);
        ItemMenu_SetItemText(work, 1, work->item, plural, FALSE);
        ItemMenu_SetPocketName(work, 0, pocket);
        BagItemList_Remove(&work->itemList, ItemMenu_GetCursorIndex(work), TRUE);
    }
    GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
    ItemMenuDisp_ShowMessage(work, FALSE);
    GFL_SndSEPlay(SEQ_SE_SYS_36);
    ItemMenuDisp_SetBackButtonActive(work, FALSE);
    ItemMenu_FixCursorAfterRemove(work);
    ItemMenu_SetState(work, ItemMenu_StateFreeSpaceWaitMessage);
}

static void ItemMenu_StateFreeSpaceWaitMessage(ItemMenuWork *work) {
    if (GCTX_HIDGetPressedKeys() & (PAD_BUTTON_A | PAD_BUTTON_B)) {
        ItemMenu_SetKeyMode(work, TRUE);
    } else if (GFL_HIDIsTouchPressed()) {
        ItemMenu_SetKeyMode(work, FALSE);
    } else {
        return;
    }
    GFL_BGSysClearScr(3);
    work->drawnScroll = 0xffff;
    ItemMenu_UpdateList(work);
    work->listDirty = TRUE;
    ItemMenuDisp_UpdateScrollBar(work);
    ItemMenuDisp_ClearMsgWindow(work);
    ClActor_SetAutoAnim(work->scrollBar, TRUE);
    ItemMenuDisp_SetButtonsActive(work, TRUE);
    ItemMenuDisp_SetBackButtonActive(work, TRUE);
    ItemMenu_ReturnToList(work);
}

static s32 ItemMenu_CompareSortKey(void *a, void *b) {
    ItemMenuSortEntry *entryA = a;
    ItemMenuSortEntry *entryB = b;

    if (entryA->key == entryB->key) {
        return 0;
    }
    if (entryA->key > entryB->key) {
        return 1;
    }
    return -1;
}

// Sorts the pocket by the items' kinds
static void ItemMenu_SortByType(ItemMenuWork *work) {
    void *data;
    ItemMenuSortEntry *sort;
    s32 count;
    ArcTool *arc;
    BagItem *item;
    s32 i = 0;
    BagItem *items;

    sort = ITEMMENU_ALLOCATE(work->heapId, sizeof(ItemMenuSortEntry) * ITEMMENU_ITEM_CAPACITY(work), FALSE,
                             "itemmenu.c", 3088);
    items = ITEMMENU_ALLOCATE(work->heapId, sizeof(BagItem) * ITEMMENU_ITEM_CAPACITY(work), FALSE, "itemmenu.c", 3089);
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    if (sort == NULL || items == NULL) {
        if (sort != NULL)
            GFL_HeapFree(sort);
        if (items != NULL)
            GFL_HeapFree(items);
        return;
    }
#endif
    BagSave_CopyPocketRaw(work->bag, items, work->pocket, TRUE);
    count = BagSave_GetPocketItemCountCore(work->bag, work->pocket, TRUE);
    arc = PML_ItemArcHandleCreate(work->heapId);
    for (; i < count; i++) {
        item = &items[i];
        data = PML_ItemArcHandleReadFile(arc, item->item, work->heapId);
        sort[i].key = (PML_ItemGetParam(data, ITEM_PARAM_KIND) << 28) +
                      (PML_ItemGetParam(data, ITEM_PARAM_SORT_INDEX) << 16) + item->item;
        sort[i].item.item = item->item;
        sort[i].item.count = item->count;
        GFL_HeapFree(data);
    }
    GFL_ArcToolFree(arc);
    MATH_QSort(sort, count, sizeof(ItemMenuSortEntry), ItemMenu_CompareSortKey, NULL);
    for (i = 0; i < count; i++) {
        items[i] = sort[i].item;
    }
    BagSave_CopyPocketRaw(work->bag, items, work->pocket, FALSE);
    GFL_HeapFree(items);
    GFL_HeapFree(sort);
}

// Each item's place in alphabetical order
// clang-format off
static const u16 sItemNameOrder[ITEM_LAST + 1] = {
    0, 263, 466, 184, 329, 400, 288, 117, 287, 381, 460, 255, 344, 134, 198, 353,
    55, 334, 7, 46, 211, 12, 308, 171, 266, 208, 449, 169, 388, 268, 167, 426,
    234, 279, 141, 142, 199, 387, 146, 265, 140, 264, 230, 18, 399, 207, 349, 216,
    48, 47, 360, 343, 516, 342, 299, 195, 114, 488, 492, 504, 484, 500, 496, 330,
    163, 33, 511, 369, 27, 477, 413, 414, 373, 36, 513, 186, 450, 267, 145, 382,
    448, 281, 158, 458, 473, 232, 461, 21, 313, 23, 439, 441, 292, 201, 206, 193,
    79, 438, 178, 394, 63, 204, 120, 297, 10, 421, 359, 412, 135, 110, 303, 296,
    190, 0, 0, 0, 121, 415, 45, 58, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 452, 3, 254, 187, 154, 397, 456, 214, 243, 383,
    40, 38, 41, 42, 39, 54, 56, 315, 361, 11, 235, 301, 317, 251, 420, 156,
    481, 261, 4, 209, 364, 37, 286, 476, 320, 333, 226, 352, 205, 188, 454, 73,
    262, 356, 290, 431, 305, 474, 133, 17, 294, 310, 471, 389, 510, 62, 225, 416,
    67, 312, 455, 53, 224, 196, 69, 14, 57, 238, 173, 401, 318, 8, 229, 440,
    143, 276, 78, 221, 396, 43, 478, 257, 151, 354, 428, 272, 59, 227, 418, 6,
    64, 429, 112, 111, 424, 147, 165, 249, 402, 273, 233, 126, 240, 427, 197, 278,
    28, 26, 260, 285, 408, 327, 289, 430, 465, 52, 124, 417, 468, 410, 403, 231,
    250, 274, 457, 443, 372, 35, 321, 185, 512, 480, 282, 482, 149, 241, 239, 339,
    463, 160, 355, 166, 517, 275, 217, 228, 113, 29, 213, 425, 202, 80, 189, 60,
    444, 338, 337, 340, 336, 335, 341, 409, 24, 61, 161, 432, 515, 269, 212, 159,
    464, 136, 422, 277, 215, 445, 433, 123, 128, 218, 295, 392, 170, 475, 395, 248,
    351, 348, 138, 258, 132, 365, 362, 363, 557, 532, 570, 526, 577, 609, 555, 524,
    612, 556, 598, 602, 559, 522, 558, 561, 567, 572, 603, 583, 551, 593, 591, 606,
    605, 535, 576, 529, 568, 586, 523, 531, 573, 590, 544, 589, 584, 542, 581, 519,
    608, 540, 543, 574, 521, 604, 562, 582, 536, 563, 520, 549, 538, 541, 585, 547,
    527, 588, 560, 571, 616, 518, 537, 539, 587, 564, 575, 552, 578, 545, 594, 613,
    607, 554, 601, 596, 569, 525, 550, 579, 618, 533, 617, 566, 534, 553, 600, 565,
    611, 597, 546, 610, 528, 548, 599, 595, 614, 530, 0, 0, 150, 245, 398, 331,
    326, 223, 405, 152, 404, 304, 483, 298, 172, 368, 462, 470, 68, 300, 177, 451,
    435, 325, 20, 447, 293, 252, 271, 13, 437, 72, 259, 306, 74, 75, 76, 446,
    407, 469, 179, 406, 9, 467, 19, 122, 32, 423, 65, 49, 16, 436, 371, 246,
    309, 256, 419, 358, 284, 366, 31, 514, 191, 324, 479, 30, 153, 236, 253, 203,
    247, 168, 280, 434, 307, 319, 174, 459, 357, 83, 84, 85, 86, 87, 88, 89,
    90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105,
    106, 107, 108, 109, 222, 244, 370, 34, 144, 346, 148, 162, 393, 5, 367, 390,
    25, 2, 51, 137, 157, 472, 139, 183, 210, 155, 328, 192, 164, 350, 44, 391,
    176, 125, 81, 442, 291, 200, 283, 385, 175, 66, 453, 345, 77, 323, 237, 311,
    129, 332, 347, 127, 15, 22, 314, 71, 375, 378, 377, 380, 374, 379, 376, 50,
    115, 505, 501, 497, 493, 489, 485, 506, 502, 498, 494, 490, 486, 507, 503, 499,
    495, 491, 487, 1, 219, 220, 384, 116, 242, 82, 615, 580, 592, 508, 0, 180,
    181, 182, 509, 270, 118, 119, 316, 302, 411, 322, 194, 70, 130, 131, 386,
};

// clang-format on

// Sorts the pocket by the items' names
static void ItemMenu_SortByName(ItemMenuWork *work) {
    ItemMenuSortEntry *sort;
    BagItem *items;
    BagItem *item;
    s32 count;
    s32 i = 0;

    sort = ITEMMENU_ALLOCATE(work->heapId, sizeof(ItemMenuSortEntry) * ITEMMENU_ITEM_CAPACITY(work), FALSE,
                             "itemmenu.c", 3141);
    items = ITEMMENU_ALLOCATE(work->heapId, sizeof(BagItem) * ITEMMENU_ITEM_CAPACITY(work), FALSE, "itemmenu.c", 3142);
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    if (sort == NULL || items == NULL) {
        if (sort != NULL)
            GFL_HeapFree(sort);
        if (items != NULL)
            GFL_HeapFree(items);
        return;
    }
#endif
    BagSave_CopyPocketRaw(work->bag, items, work->pocket, TRUE);
    count = BagSave_GetPocketItemCountCore(work->bag, work->pocket, TRUE);
    for (; i < count; i++) {
        item = &items[i];
#if defined(WHITE2) && (defined(W2U_MEGA) || defined(W2U_EXPANDED_ITEMS)) && !defined(BLACK2)
        {
            u16 order;
#if defined(W2U_EXPANDED_ITEMS)
            order = W2U_ItemSortRank(item->item);
#else
            order = item->item <= ITEM_LAST ? sItemNameOrder[item->item] : item->item;
#endif

            sort[i].key = ((u32)order << 16) + item->item;
        }
#else
        sort[i].key = (sItemNameOrder[item->item] << 16) + item->item;
#endif
        sort[i].item.item = item->item;
        sort[i].item.count = item->count;
    }
    MATH_QSort(sort, count, sizeof(ItemMenuSortEntry), ItemMenu_CompareSortKey, NULL);
    for (i = 0; i < count; i++) {
        items[i] = sort[i].item;
    }
    BagSave_CopyPocketRaw(work->bag, items, work->pocket, FALSE);
    GFL_HeapFree(items);
    GFL_HeapFree(sort);
}

// Sorts the TMs and HMs by their numbers
static void ItemMenu_SortByNumber(ItemMenuWork *work) {
    if (work->pocket == BAG_POCKET_TMS_HMS) {
        ItemMenuSortEntry *sort;
        s32 count;
        BagItem *item;
        s32 i = 0;
        BagItem *items;

        sort = ITEMMENU_ALLOCATE(work->heapId, sizeof(ItemMenuSortEntry) * ITEMMENU_ITEM_CAPACITY(work), FALSE,
                                 "itemmenu.c", 3194);
        items =
            ITEMMENU_ALLOCATE(work->heapId, sizeof(BagItem) * ITEMMENU_ITEM_CAPACITY(work), FALSE, "itemmenu.c", 3195);
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
        if (sort == NULL || items == NULL) {
            if (sort != NULL)
                GFL_HeapFree(sort);
            if (items != NULL)
                GFL_HeapFree(items);
            return;
        }
#endif
        BagSave_CopyPocketRaw(work->bag, items, work->pocket, TRUE);
        count = BagSave_GetPocketItemCountCore(work->bag, work->pocket, TRUE);
        for (; i < count; i++) {
            item = &items[i];
            sort[i].key = PML_ItemGetTMBitMask(item->item);
            sort[i].item.item = item->item;
            sort[i].item.count = item->count;
        }
        MATH_QSort(sort, count, sizeof(ItemMenuSortEntry), ItemMenu_CompareSortKey, NULL);
        for (i = 0; i < count; i++) {
            items[i] = sort[i].item;
        }
        BagSave_CopyPocketRaw(work->bag, items, work->pocket, FALSE);
        GFL_HeapFree(items);
        GFL_HeapFree(sort);
    }
}

// Sorts the pocket by how often the items were used, most used first or last
static void ItemMenu_SortByUses(ItemMenuWork *work, BOOL mostUsedFirst) {
    BagItem *item;
    s32 count;
    ItemMenuSortEntry *sort;
    BagItem *items;
    ArcTool *arc;
    void *data;
    u32 uses;
    s32 i = 0;

    sort = ITEMMENU_ALLOCATE(work->heapId, sizeof(ItemMenuSortEntry) * ITEMMENU_ITEM_CAPACITY(work), FALSE,
                             "itemmenu.c", 3241);
    items = ITEMMENU_ALLOCATE(work->heapId, sizeof(BagItem) * ITEMMENU_ITEM_CAPACITY(work), FALSE, "itemmenu.c", 3242);
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    if (sort == NULL || items == NULL) {
        if (sort != NULL)
            GFL_HeapFree(sort);
        if (items != NULL)
            GFL_HeapFree(items);
        return;
    }
#endif
    BagSave_CopyPocketRaw(work->bag, items, work->pocket, TRUE);
    count = BagSave_GetPocketItemCountCore(work->bag, work->pocket, TRUE);
    arc = PML_ItemArcHandleCreate(work->heapId);
    for (; i < count; i++) {
        item = &items[i];
        data = PML_ItemArcHandleReadFile(arc, item->item, work->heapId);
        uses = BagSave_GetExistingItemCount(work->bag, item->item);
        if (mostUsedFirst == TRUE) {
            sort[i].key = ((u64)(999 - uses) << 40) + (PML_ItemGetParam(data, ITEM_PARAM_KIND) << 28) +
                          (PML_ItemGetParam(data, ITEM_PARAM_SORT_INDEX) << 16) + item->item;
        } else {
            sort[i].key = ((u64)uses << 40) + (PML_ItemGetParam(data, ITEM_PARAM_KIND) << 28) +
                          (PML_ItemGetParam(data, ITEM_PARAM_SORT_INDEX) << 16) + item->item;
        }
        sort[i].item = *item;
        GFL_HeapFree(data);
    }
    GFL_ArcToolFree(arc);
    MATH_QSort(sort, count, sizeof(ItemMenuSortEntry), ItemMenu_CompareSortKey, NULL);
    for (i = 0; i < count; i++) {
        items[i] = sort[i].item;
    }
    BagSave_CopyPocketRaw(work->bag, items, work->pocket, FALSE);
    GFL_HeapFree(items);
    GFL_HeapFree(sort);
}

static void ItemMenu_PressSortButton(ItemMenuWork *work) {
    GFL_SndSEPlay(SEQ_SE_DECIDE1);
    if (work->pocket != BAG_POCKET_FREE_SPACE) {
        ClActor_SetSequence(work->sortButton, 2);
    } else {
        ClActor_SetSequence(work->filterButton, 1);
    }
}

// Sorts the pocket
static void ItemMenu_Sort(ItemMenuWork *work, u32 sortType) {
    work->sortType = sortType;
    switch (sortType) {
    case 0:
        ItemMenu_SortByType(work);
        break;
    case 1:
        ItemMenu_SortByNumber(work);
        break;
    case 2:
        ItemMenu_SortByName(work);
        break;
    case 3:
        ItemMenu_SortByUses(work, TRUE);
        break;
    case 4:
        ItemMenu_SortByUses(work, FALSE);
        break;
    }
    work->drawnScroll = 0xffff;
}

// Changes the Free Space's filter
static void ItemMenu_ChangeFreeSpaceFilter(ItemMenuWork *work, u32 filter) {
    if (work->freeSpaceFilter != filter) {
        ItemMenu_SetFreeSpaceFilter(work, filter);
        work->cursorRow = 0;
        work->scroll = -1;
        work->drawnScroll = 0xffff;
        work->listDirty = TRUE;
        ItemMenuDisp_UpdateScrollBar(work);
    }
}

static void ItemMenu_SetFreeSpaceFilter(ItemMenuWork *work, u32 filter) {
    work->freeSpaceFilter = filter;
    BagItemList_SetFilter(&work->itemList, filter);
}

static void ItemMenu_ResetFreeSpaceFilter(ItemMenuWork *work) {
    if (work->pocket == BAG_POCKET_FREE_SPACE) {
        ItemMenu_SetFreeSpaceFilter(work, BAG_ITEM_FILTER_ALL);
    }
    ItemMenuDisp_UpdateSortButton(work);
}

// Shows the list's cursor for the keys, or hides it for the touch screen
static void ItemMenu_SetKeyMode(ItemMenuWork *work, BOOL keys) {
    if (work->movingItem == TRUE) {
        keys = TRUE;
    }
    if (keys) {
        GCTX_HIDSetUsingTouch(FALSE);
    } else {
        GCTX_HIDSetUsingTouch(TRUE);
    }
    if (ItemMenu_GetItemCount(work) == 0) {
        keys = FALSE;
    }
    if (keys == FALSE) {
        ItemMenuDisp_SetListCursorPalette(work, FALSE);
    } else {
        ItemMenuDisp_SetListCursorPalette(work, TRUE);
        BlinkPalAnm_InitAnime(work->paletteAnim);
    }
    ItemMenuDisp_ShowTMIcons(work, keys);
}

// Whether the bag's mode lets items be registered
BOOL ItemMenu_CanRegister(ItemMenuWork *work) {
    if (work->mode == 0 || work->mode == 1 || work->mode == 3) {
        return TRUE;
    }
    return FALSE;
}

// Registers the item on a row for the Y button, or unregisters it
static BOOL ItemMenu_ToggleItemRegistration(ItemMenuWork *work, s32 row) {
    BagItem *slot;
    u32 shortcut;

    row += work->scroll + 1;
    if (ItemMenu_GetItemCount(work) <= row) {
        return FALSE;
    }
    slot = ItemMenu_GetSlot(work, row);
    shortcut = ShortcutUtil_GetItemShortcut(slot->item);
    if (shortcut == 0xff) {
        return FALSE;
    }
    if (ItemMenu_IsItemRegistered(work, slot->item) == TRUE) {
        GameData_SetKeyItemRegistration(work->gameData, shortcut, FALSE);
    } else {
        GameData_SetKeyItemRegistration(work->gameData, shortcut, TRUE);
    }
    GFL_SndSEPlay(SEQ_SE_SYS_07);
    work->drawnScroll = 0xffff;
    return TRUE;
}

static u32 ItemMenu_GetPocketShortcut(s32 pocket) {
    return ItemMenuDisp_GetPocketShortcut(pocket);
}

// Registers the pocket for the Y button, or unregisters it
static void ItemMenu_TogglePocketRegistration(ItemMenuWork *work) {
    u32 shortcut = ItemMenu_GetPocketShortcut(work->pocket);

    GameData_SetKeyItemRegistration(work->gameData, shortcut,
                                    GameData_IsShortcutRegistered(work->gameData, shortcut) ^ TRUE);
    GFL_SndSEPlay(SEQ_SE_SYS_07);
    ItemMenu_UpdatePocketRegistration(work);
}

// Shows whether the pocket is registered
static void ItemMenu_UpdatePocketRegistration(ItemMenuWork *work) {
    if (work->movingItem != TRUE) {
        ClActor_SetSequence(work->buttons[2],
                            GameData_IsShortcutRegistered(work->gameData, ItemMenu_GetPocketShortcut(work->pocket)) +
                                6);
    }
}

// What the item menu's first action is: use, ride or read
static void ItemMenu_SetUseAction(ItemMenuWork *work, void *data, BagItem *slot, u8 *actions) {
    if (PML_ItemGetParam(data, ITEM_PARAM_FIELD_FUNC)) {
        if (PML_ItemIsMail(slot->item) == TRUE) {
            actions[0] = 2;
        } else if (slot->item == ITEM_BICYCLE && work->isCycling == TRUE) {
            actions[0] = 1;
        } else {
            actions[0] = 0;
        }
    }
    if (slot->item == ITEM_LIGHT_STONE || slot->item == ITEM_DARK_STONE) {
        actions[0] = 0;
    }
}

// The actions of the item menu for the item under the cursor
static void ItemMenu_GetItemActions(ItemMenuWork *work, u8 *actions) {
    BagItem *slot = ItemMenu_GetSlot(work, ItemMenu_GetCursorIndex(work));
    void *data;
    u8 fieldPocket;

    if (slot != NULL && slot->item != ITEM_NONE) {
        data = PML_ItemReadDataFile(slot->item, 0, work->heapId);
        fieldPocket = PML_ItemGetParam(data, ITEM_PARAM_FIELD_POCKET);
        ItemMenu_SetUseAction(work, data, slot, actions);
        if (ItemMenu_CanUseInMode(work, fieldPocket) == FALSE && actions[0] != 2) {
            actions[0] = 0xff;
        }
        if (PML_ItemGetParam(data, ITEM_PARAM_IMPORTANT) == 0) {
            if (PML_ItemIsNotSpecialMonsball(slot->item) == TRUE) {
                actions[1] = 6;
            }
            if (fieldPocket != BAG_POCKET_TMS_HMS) {
                actions[2] = 3;
            }
        }
        if (PML_ItemGetParam(data, ITEM_PARAM_REGISTRABLE)) {
            if (ItemMenu_IsItemRegistered(work, slot->item) == TRUE) {
                actions[2] = 5;
            } else {
                actions[2] = 4;
            }
        }
        if (work->pocket != BAG_POCKET_FREE_SPACE) {
            actions[3] = 8;
        } else {
            actions[3] = 9;
        }
        actions[4] = 10;
        GFL_HeapFree(data);
    }
}

// Opens the item menu
static void ItemMenu_OpenItemMenu(ItemMenuWork *work) {
    u32 msgIds[] = { 0, 6, 16, 1, 2, 18, 3, 5, 145, 146, 8, 87, 0 };
    u32 menuMsgIds[5];
    u8 actions[5] = { 0xff, 0xff, 0xff, 0xff, 0xff };
    s32 i;
    s32 count;

    ItemMenu_GetItemActions(work, actions);
    for (i = 0, count = 0; i < 5; i++) {
        if (actions[i] != 0xff) {
            work->itemMenuActions[count] = actions[i];
            menuMsgIds[count] = msgIds[actions[i]];
            count++;
        }
    }
    if (ItemMenu_IsDowsingOn(work)) {
        for (i = 0; i < 5; i++) {
            if (work->itemMenuActions[i] == 0) {
                menuMsgIds[i] = 160;
                break;
            }
        }
    }
    ItemMenuDisp_OpenItemMenu(work, menuMsgIds, count);
}

// Whether the item under the cursor is the Dowsing MCHN while it is on
static BOOL ItemMenu_IsDowsingOn(ItemMenuWork *work) {
    BagItem *slot = ItemMenu_GetSlot(work, ItemMenu_GetCursorIndex(work));

    if (slot == NULL) {
        return FALSE;
    }
    if (slot->item == ITEM_NONE) {
        return FALSE;
    }
    if (slot->item == ITEM_DOWSING_MCHN) {
        return work->dowsingActive;
    }
    return FALSE;
}

BOOL ItemMenu_IsItemRegistered(ItemMenuWork *work, u32 item) {
    return GameData_IsShortcutRegistered(work->gameData, ShortcutUtil_GetItemShortcut(item));
}

// The buttons of the touch screen
static void ItemMenu_ButtonCallback(u32 button, u32 event, void *data) {
    ItemMenuWork *work = data;
    s32 newPocket = -1;
    s32 count = ItemMenu_GetItemCount(work);
    s32 pocket;
    s32 row;
    s32 from;

    if (event != 0) {
        return;
    }
    if (button < 6) {
        s32 pockets[] = {
            BAG_POCKET_MEDICINE,  BAG_POCKET_TMS_HMS,    BAG_POCKET_BERRIES,
            BAG_POCKET_KEY_ITEMS, BAG_POCKET_FREE_SPACE, BAG_POCKET_ITEMS,
        };

        if (work->pocket != pockets[button]) {
            newPocket = pockets[button];
            ItemMenu_SetKeyMode(work, FALSE);
        }
    } else if (button == 6) {
        ItemMenu_SetKeyMode(work, FALSE);
        pocket = work->pocket;
        if (--work->pocket < 0) {
            work->pocket = 5;
        }
        ItemMenu_PressPocketArrow(work, pocket, FALSE, ItemMenu_StatePocketArrowDone);
        return;
    } else if (button == 7) {
        ItemMenu_SetKeyMode(work, FALSE);
        pocket = work->pocket;
        if (++work->pocket >= 6) {
            work->pocket = 0;
        }
        ItemMenu_PressPocketArrow(work, pocket, TRUE, ItemMenu_StatePocketArrowDone);
        return;
    } else if (button == 8) {
        if (work->pocket != BAG_POCKET_FREE_SPACE) {
            if (ItemMenu_GetItemCount(work) > 1) {
                ItemMenu_PressSortButton(work);
                ItemMenu_SetKeyMode(work, FALSE);
                ItemMenuDisp_SetBackButtonActive(work, FALSE);
                work->drawnScroll = 0xffff;
                ItemMenu_UpdateList(work);
                ItemMenu_SetState(work, ItemMenu_StateOpenSortMenu);
                return;
            }
        } else if (ItemMenu_CountFilterActions(work) > 2) {
            ItemMenu_PressSortButton(work);
            ItemMenu_SetKeyMode(work, FALSE);
            ItemMenuDisp_SetBackButtonActive(work, FALSE);
            work->drawnScroll = 0xffff;
            ItemMenu_UpdateList(work);
            ItemMenu_SetState(work, ItemMenu_StateOpenFilterMenu);
            return;
        }
    } else if (button == 9) {
        if (ItemMenu_CanRegister(work) == TRUE) {
            ItemMenu_TogglePocketRegistration(work);
            ItemMenu_SetKeyMode(work, FALSE);
            work->drawnScroll = 0xffff;
            ItemMenu_UpdateList(work);
        }
    } else if (button == 10) {
        if (work->mode != 2) {
            work->result = 0;
            work->item = ITEM_NONE;
            ItemMenu_PressButton(work, 3, NULL);
            GCTX_HIDSetUsingTouch(TRUE);
        }
    } else if (button == 11) {
        work->result = 1;
        work->item = ITEM_NONE;
        ItemMenu_PressButton(work, 4, NULL);
        GCTX_HIDSetUsingTouch(TRUE);
    } else if (button >= 12 && button < 18) {
        if (work->state != ItemMenu_StateList) {
            return;
        }
        row = work->cursorRow;
        from = ItemMenu_GetCursorIndex(work);
        if (ItemMenu_GetItemCount(work) == 0) {
            return;
        }
        if (work->cursorRow != button - 12) {
            work->cursorRow = button - 12;
            if (count <= ItemMenu_GetCursorIndex(work)) {
                work->cursorRow = row;
                return;
            }
        }
        ItemMenu_MoveItem(work, from, ItemMenu_GetCursorIndex(work));
        ItemMenu_SetKeyMode(work, FALSE);
        work->drawnScroll = 0xffff;
        ItemMenu_UpdateList(work);
        ItemMenuDisp_DrawItemInfo(work);
        ItemMenu_SetState(work, ItemMenu_StateFlashCursor);
        return;
    } else if (button >= 18) {
        if (ItemMenu_CanRegister(work) == TRUE && ItemMenu_ToggleItemRegistration(work, button - 18) == TRUE) {
            ItemMenu_SetKeyMode(work, FALSE);
            ItemMenu_UpdateList(work);
        }
    }
    if (newPocket != -1) {
        pocket = work->pocket;
        work->pocket = newPocket;
        GFL_SndSEPlay(SEQ_SE_SYS_99);
        ItemMenu_ChangePocket(work, pocket, work->pocket);
        ItemMenu_ResetFreeSpaceFilter(work);
        ItemMenu_SetKeyMode(work, FALSE);
        work->drawnScroll = 0xffff;
        ItemMenu_UpdateList(work);
    }
}

static void ItemMenu_VBlank(TCB *tcb, void *data) {
    ItemMenuWork *work = data;

    if (work->tmInfoRequest == 1) {
        ItemMenuDisp_ShowTMInfoBGs(work, TRUE);
        work->tmInfoRequest = 0;
    } else if (work->tmInfoRequest == 2) {
        ItemMenuDisp_ShowTMInfoBGs(work, FALSE);
        work->tmInfoRequest = 0;
    }
    PaletteFade_Transfer(work->paletteFade);
    ClActSys_VBlank();
}

// Fades the bag in
static void ItemMenu_StateFadeIn(ItemMenuWork *work) {
    if (PrintQueue_IsEmpty(work->printQueue)) {
        GFL_WipeSet(0, 1, 1, 0, 6, 1, work->heapId);
        GFL_SndSEPlay(SEQ_SE_SYS_90);
        ItemMenu_SetState(work, ItemMenu_StateWaitFadeIn);
    }
}

static void ItemMenu_StateWaitFadeIn(ItemMenuWork *work) {
    BOOL finished = GFL_WipeIsFinished();
    BOOL busy = ItemMenuDisp_SlidePocketTabs(work);

    if (finished == TRUE && busy == FALSE) {
        ClActor_SetAutoAnim(work->scrollBar, TRUE);
        ItemMenu_ReturnToList(work);
    }
}

// The buttons of the touch screen: the pockets, the arrows, sorting, registering, the exits, then the list's rows and
// their registration marks
// clang-format off
static const TouchRect sButtonRects[] = {
    { 102, 143, 0, 39 },
    { 112, 155, 36, 71 },
    { 109, 143, 68, 107 },
    { 72, 108, 59, 109 },
    { 8, 75, 50, 95 },
    { 36, 101, 0, 50 },
    { 168, 191, 0, 23 },
    { 168, 191, 120, 143 },
    { 168, 191, 152, 175 },
    { 168, 191, 176, 191 },
    { 168, 191, 192, 215 },
    { 168, 191, 224, 247 },
    { 12, 35, 144, 223 },
    { 36, 59, 144, 223 },
    { 60, 83, 144, 223 },
    { 84, 107, 144, 223 },
    { 108, 131, 144, 223 },
    { 132, 155, 144, 223 },
    { 12, 35, 120, 143 },
    { 36, 59, 120, 143 },
    { 60, 83, 120, 143 },
    { 84, 107, 120, 143 },
    { 108, 131, 120, 143 },
    { 132, 155, 120, 143 },
    { TOUCH_RECT_END, 0, 0, 0 },
};

// clang-format on

static BOOL ItemMenuProc_Init(GameProc *proc, u32 *state, void *param, void *data) {
    BagProcessData *bag = param;
    ItemMenuWork *work;
    u16 pocket;
    s16 row;
    s16 scroll;
    u16 count;

    GFL_HeapCreateChild(HEAPID_USER, HEAPID_BAG, 0x34000);
    work = GFL_ProcInitSubsystem(proc, sizeof(ItemMenuWork), HEAPID_BAG);
    MI_CpuFill8(work, 0, sizeof(ItemMenuWork));
    GCTX_HIDGetRepeat(&work->savedRepeatWait, &work->savedRepeatStart);
    work->heapId = HEAPID_BAG;
    work->buttonsActive = TRUE;
    work->gameData = bag->gameData;
    work->playerInfo = bag->playerInfo;
    work->trainerData = bag->trainerData;
    work->cursor = bag->cursor;
    work->bag = bag->bag;
    work->perms = &bag->perms;
    work->mode = bag->mode;
    work->isCycling = bag->isCycling;
    work->dowsingActive = bag->dowsingActive;
    work->freeSpaceFilter = bag->freeSpaceFilter;
    sortItemBlocks(work->bag);
    BagItemList_Init(&work->itemList, bag->bag, work->freeSpaceFilter, work->heapId);
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    work->itemCapacity = work->itemList.capacity;
    if (work->itemCapacity != 0) {
        work->items = GFL_HeapTryAllocate(work->heapId, ITEMMENU_ITEM_BYTES(work), TRUE, __FILE__, __LINE__);
    }
    if (work->itemList.entries == NULL || work->items == NULL) {
        work->allocationFailed = TRUE;
        return TRUE;
    }
#endif
    work->pocket = BagCursor_GetPocket(work->cursor);
    for (pocket = 0; pocket < 6; pocket++) {
        BagCursor_GetPocketPosition(work->cursor, pocket, &row, &scroll);
        count = BagItemList_CountShown(&work->itemList, pocket);
        while (TRUE) {
            if (row == 0 && scroll == 0) {
                break;
            }
            if (scroll + ITEMMENU_LIST_ROWS - 1 >= count && scroll != 0) {
                scroll--;
            } else if (row + scroll >= count) {
                if (scroll != 0) {
                    scroll--;
                } else {
                    row--;
                }
            } else {
                break;
            }
        }
        if (pocket == work->pocket) {
            work->cursorRow = row;
            work->scroll = scroll - 1;
        }
        BagCursor_SetPocketPosition(work->cursor, pocket, row, scroll);
    }
    work->msgData = GFL_MsgSysLoadData(FALSE, ARCID_SYSTEM_MESSAGE, TEXT_BANK_BTL_MAIN, work->heapId);
    work->strbuf = GFL_StrBufCreate(200, work->heapId);
    work->expandBuf = GFL_StrBufCreate(200, work->heapId);
    work->tempBuf = GFL_StrBufCreate(64, work->heapId);
    work->wordSet = GFL_WordSetSystemCreateDefault(work->heapId);
    work->printQueue = PrintQueue_Create(0x1000, work->heapId);
    work->keyCursor = KeyCursor_Create(15, TRUE, TRUE, work->heapId);
    work->font = GFL_FontCreate(23, 0, 0, FALSE, work->heapId);
    ItemMenuDisp_Init(work);
    ItemMenuDisp_CreateWindows(work);
    ItemMenuDisp_LoadListRes(work);
    ItemMenuDisp_CreatePocketTabs(work);
    ItemMenu_RedrawList(work);
    ItemMenuDisp_CreateListActors(work);
    work->buttonMan = GFL_BMN_Create(sButtonRects, ItemMenu_ButtonCallback, work, work->heapId);
    ItemMenu_CreatePaletteAnim(work);
    ItemMenu_CreatePaletteFade(work);
    work->vblankTask = GFL_VBlankTCBAdd(ItemMenu_VBlank, work, 0);
    work->tcbManager = GFL_TCBExMgrCreate(work->heapId, work->heapId, 1, 0);
    ItemMenuDisp_CreatePocketWindows(work);
    work->taskMenuRes = AppTaskMenuRes_Create(3, 9, work->font, work->printQueue, work->heapId);
    GFL_NetSetIconScreen(TRUE, work->heapId);
    ItemMenu_SetKeyMode(work, GCTX_HIDIsUsingTouch() ? FALSE : TRUE);
    ItemMenuDisp_ShowBGs();
    ItemMenu_SetState(work, ItemMenu_StateFadeIn);
    return TRUE;
}

static BOOL ItemMenuProc_Main(GameProc *proc, u32 *state, void *param, void *data) {
    ItemMenuWork *work = data;

#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    if (work->allocationFailed) {
        return TRUE;
    }
#endif
    if (work->state == NULL) {
        GFL_WipeSet(0, 0, 0, 0, 6, 1, work->heapId);
        return TRUE;
    }
    work->drawnScroll = work->scroll;
    work->state(work);
    if (work->listDirty) {
        ItemMenuDisp_UpdateListCursor(work);
        work->listDirty = FALSE;
    }
    if (work->iconsDirty) {
        ItemMenuDisp_UpdateListRows(work);
        work->iconsDirty = FALSE;
    }
    ItemMenuDisp_Update(work);
    ItemMenuDisp_FlushWindows(work);
    GFL_TCBExMgrUpdate(work->tcbManager);
    return FALSE;
}

static BOOL ItemMenuProc_Exit(GameProc *proc, u32 *state, void *param, void *data) {
    BagProcessData *bag = param;
    ItemMenuWork *work = data;

#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    if (work->allocationFailed) {
        BagItemList_Exit(&work->itemList);
        if (work->items != NULL) {
            GFL_HeapFree(work->items);
        }
        bag->result = 0;
        bag->item = ITEM_NONE;
        GFL_ProcReleaseSubsystem(proc);
        GFL_HeapDelete(HEAPID_BAG);
        return TRUE;
    }
#endif
    if (GFL_WipeIsFinished() != TRUE) {
        return FALSE;
    }
    if (PrintQueue_IsEmpty(work->printQueue) == FALSE) {
        return FALSE;
    }
    GFL_TCBRemove(work->vblankTask);
    BagItemList_Exit(&work->itemList);
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    GFL_HeapFree(work->items);
#endif
    BagCursor_SetPocket(work->cursor, work->pocket);
    BagCursor_SetPocketPosition(work->cursor, work->pocket, work->cursorRow, work->scroll + 1);
    AppTaskMenuRes_Free(work->taskMenuRes);
    ItemMenuDisp_Exit(work);
    ItemMenuDisp_FreeBGChars(work);
    GFL_TCBExMgrFree(work->tcbManager);
    GFL_MsgDataFree(work->msgData);
    GFL_StrBufFree(work->strbuf);
    GFL_StrBufFree(work->expandBuf);
    GFL_StrBufFree(work->tempBuf);
    GFL_WordSetSystemFree(work->wordSet);
    ItemMenuDisp_FreePocketWindows(work);
    if (work->msgWindow.window != NULL) {
        GFL_BGSysFreeCharMemory(3, CHAR_POS(work->cursorImageChars), CHAR_SIZE(work->cursorImageChars));
        BmpWin_Free(work->msgWindow.window);
    }
    GFL_BGSysFreeFilledChar(3, 1, 0);
    GFL_FontFree(work->font);
    KeyCursor_Free(work->keyCursor);
    PrintQueue_Clear(work->printQueue);
    PrintQueue_Free(work->printQueue);
    ItemMenu_FreePaletteFade(work);
    ItemMenu_FreePaletteAnim(work);
    GFL_BMN_Delete(work->buttonMan);
    BmpWin_FreeAllocator();
    GFL_BGSysFree();
    bag->result = work->result;
    bag->item = work->item;
    ItemMenu_SaveFreeSpaceFilter(work->cursor, bag->mode, bag->result, work->freeSpaceFilter);
    setKeypressFramecounts(work->savedRepeatWait, work->savedRepeatStart);
    GFL_ProcReleaseSubsystem(proc);
    GFL_HeapDelete(HEAPID_BAG);
    return TRUE;
}

static void ItemMenu_ReturnToList(ItemMenuWork *work) {
    ItemMenu_SetState(work, ItemMenu_StateList);
    setKeypressFramecounts(3, 6);
}

static void ItemMenu_StartMoveItem(ItemMenuWork *work) {
    ItemMenu_SetState(work, ItemMenu_StateMoveItem);
    setKeypressFramecounts(3, 6);
}

static void ItemMenu_CreatePaletteAnim(ItemMenuWork *work) {
    ArcTool *arc;

    work->paletteAnim = BlinkPalAnm_Create(16, 16, 0xfffe, work->heapId);
    arc = GFL_ArcSysCreateFileHandle(ARCID_ITEMMENU, work->heapId);
    BlinkPalAnm_SetPalBufferArcTool(work->paletteAnim, arc, 21, 16, 32);
    GFL_ArcToolFree(arc);
}

static void ItemMenu_FreePaletteAnim(ItemMenuWork *work) {
    BlinkPalAnm_Free(work->paletteAnim);
}

// Flashes the cursor on the picked item, then opens the item's menu
static void ItemMenu_StateFlashCursor(ItemMenuWork *work) {
    switch (work->buttonAnim) {
    case 0:
        GFL_SndSEPlay(SEQ_SE_DECIDE1);
        // fallthrough
    case 3:
        ItemMenuDisp_SetListCursorPalette(work, 0);
        work->buttonAnim++;
        break;
    case 1:
    case 4:
    case 6:
        work->buttonAnimTimer++;
        if (work->buttonAnimTimer == 4) {
            work->buttonAnimTimer = 0;
            work->buttonAnim++;
        }
        break;
    case 2:
    case 5:
        ItemMenuDisp_SetListCursorPalette(work, 2);
        work->buttonAnim++;
        break;
    case 7:
        work->buttonAnim = 0;
        ItemMenuDisp_SetListCursorPalette(work, 1);
        BlinkPalAnm_InitAnime(work->paletteAnim);
        BlinkPalAnm_Main(work->paletteAnim);
        ItemMenu_SetState(work, ItemMenu_StateSelectItem);
        break;
    }
}

// Presses a button of the lower screen, then goes on to next
static void ItemMenu_PressButton(ItemMenuWork *work, u32 button, ItemMenuState next) {
    u32 anim;

    if (button == 4) {
        GFL_SndSEPlay(SEQ_SE_CANCEL1);
        anim = 9;
    } else if (button == 3) {
        GFL_SndSEPlay(SEQ_SE_CLOSE1);
        anim = 8;
    } else if (button == 1) {
        GFL_SndSEPlay(SEQ_SE_SYS_99);
        anim = 13;
    } else if (button == 0) {
        GFL_SndSEPlay(SEQ_SE_SYS_99);
        anim = 12;
    }
    work->buttonAnim = button;
    ClActor_SetAnimTime(work->buttons[work->buttonAnim], 0);
    ClActor_SetSequence(work->buttons[work->buttonAnim], anim);
    ClActor_SetAutoAnim(work->buttons[work->buttonAnim], TRUE);
    work->buttonAnimNext = next;
    ItemMenu_SetState(work, ItemMenu_StateWaitButton);
}

static void ItemMenu_StateWaitButton(ItemMenuWork *work) {
    if (ClActor_IsAnimActive(work->buttons[work->buttonAnim]) == FALSE) {
        work->buttonAnim = 0;
        ItemMenu_SetState(work, work->buttonAnimNext);
    }
}

// Changes to the next pocket, or the previous one
static void ItemMenu_PressPocketArrow(ItemMenuWork *work, s32 oldPocket, BOOL right, ItemMenuState next) {
    u32 anim;

    ItemMenu_ChangePocket(work, oldPocket, work->pocket);
    ItemMenu_ResetFreeSpaceFilter(work);
    ItemMenu_UpdatePocketRegistration(work);
    work->drawnScroll = 0xffff;
    ItemMenu_UpdateList(work);
    if (right == TRUE) {
        GFL_SndSEPlay(SEQ_SE_SYS_99);
        anim = 13;
    } else if (right == FALSE) {
        GFL_SndSEPlay(SEQ_SE_SYS_99);
        anim = 12;
    }
    work->buttonAnim = right;
    work->buttonAnimTimer = 6;
    ClActor_SetAnimTime(work->buttons[work->buttonAnim], 0);
    ClActor_SetSequence(work->buttons[work->buttonAnim], anim);
    ClActor_SetAutoAnim(work->buttons[work->buttonAnim], TRUE);
    work->buttonAnimNext = next;
    ItemMenu_SetState(work, ItemMenu_StateWaitPocketArrow);
}

static void ItemMenu_StateWaitPocketArrow(ItemMenuWork *work) {
    if (work->buttonAnimTimer == 0) {
        work->buttonAnim = 0;
        ItemMenu_SetState(work, work->buttonAnimNext);
    } else {
        work->buttonAnimTimer--;
    }
}

// The quantity's confirm and cancel buttons
static const TouchRect sQuantityButtonRects[] = {
    { 96, 143, 128, 231 },
    { 168, 191, 224, 247 },
    { TOUCH_RECT_END, 0, 0, 0 },
};

// The quantity's buttons: confirm and cancel
static s32 ItemMenu_GetQuantityButton(void) {
    s32 hit = GFL_HIDGetTouchPressedRect(sQuantityButtonRects);

    if (hit != TOUCH_RECT_NONE) {
        GCTX_HIDSetUsingTouch(TRUE);
    }
    return hit;
}

static void ItemMenu_StateTossCancel(ItemMenuWork *work) {
    ItemMenu_HideQuantity(work);
    ClActor_SetAutoAnim(work->scrollBar, TRUE);
    ItemMenuDisp_SetButtonsActive(work, TRUE);
    ItemMenu_SetKeyMode(work, GCTX_HIDIsUsingTouch() ? FALSE : TRUE);
    ItemMenu_ReturnToList(work);
}

static void ItemMenu_StateSellCancel(ItemMenuWork *work) {
    ItemMenu_HideQuantity(work);
    ClActor_SetAutoAnim(work->scrollBar, TRUE);
    ItemMenuDisp_SetButtonsActive(work, TRUE);
    ItemMenu_SetKeyMode(work, GCTX_HIDIsUsingTouch() ? FALSE : TRUE);
    ItemMenu_SetState(work, ItemMenu_StateSellEnd);
}

static void ItemMenu_CreatePaletteFade(ItemMenuWork *work) {
    work->paletteFade = PaletteFade_Create(work->heapId);
    PaletteFade_AllocBuffer(work->paletteFade, 2, 0x200, work->heapId);
    PaletteFade_AllocBuffer(work->paletteFade, 0, 0x20, work->heapId);
    PaletteFade_LoadFromVRAM(work->paletteFade, 0, 0, 0x20);
}

static void ItemMenu_FreePaletteFade(ItemMenuWork *work) {
    PaletteFade_FreeBuffer(work->paletteFade, 0);
    PaletteFade_FreeBuffer(work->paletteFade, 2);
    PaletteFade_Free(work->paletteFade);
}

// Opens the sort menu once its button is up
static void ItemMenu_StateOpenSortMenu(ItemMenuWork *work) {
    if (ClActor_IsAnimActive(work->sortButton) == FALSE) {
        ClActor_SetSequence(work->sortButton, 0);
        ClActor_SetAutoAnim(work->scrollBar, FALSE);
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_HowWantSortItems, work->expandBuf);
        ItemMenuDisp_ShowMessage(work, FALSE);
        ItemMenuDisp_SetButtonsActive(work, FALSE);
        ItemMenu_OpenSortMenu(work);
        ItemMenu_SetState(work, ItemMenu_StateSortMenu);
    }
}

static void ItemMenu_OpenSortMenu(ItemMenuWork *work) {
    u32 msgIds[] = { 152, 156, 153, 154, 155, 8 };
    u32 menuMsgIds[5];
    u8 actions[5] = { 0xff, 0xff, 0xff, 0xff, 0xff };
    s32 i;
    s32 count;

    ItemMenu_GetSortActions(work, actions);
    for (i = 0, count = 0; i < 5; i++) {
        if (actions[i] != 0xff) {
            work->sortMenuActions[count] = actions[i];
            menuMsgIds[count] = msgIds[actions[i]];
            count++;
        }
    }
    ItemMenuDisp_OpenSortMenu(work, menuMsgIds, count);
}

// The sorts a pocket offers
static void ItemMenu_GetSortActions(ItemMenuWork *work, u8 *actions) {
    if (work->pocket == BAG_POCKET_ITEMS || work->pocket == BAG_POCKET_MEDICINE || work->pocket == BAG_POCKET_BERRIES ||
        work->pocket == BAG_POCKET_KEY_ITEMS) {
        actions[0] = 0;
    } else {
        actions[0] = 1;
    }
    if (work->pocket == BAG_POCKET_ITEMS || work->pocket == BAG_POCKET_MEDICINE || work->pocket == BAG_POCKET_BERRIES) {
        actions[2] = 3;
        actions[3] = 4;
    }
    actions[1] = 2;
    actions[4] = 5;
}

// The sort menu, once the player picked from it
static void ItemMenu_StateSortMenu(ItemMenuWork *work) {
    BOOL done = FALSE;

    if (ItemMenuDisp_IsMessageDone(work)) {
        if (AppTaskMenu_IsFlashFinished(work->taskMenu)) {
            work->menuAction = work->sortMenuActions[AppTaskMenu_GetCursorPos(work->taskMenu)];
            switch (work->menuAction) {
            case 0:
                GFL_SndSEPlay(SEQ_SE_SYS_36);
                ItemMenu_Sort(work, 0);
                ItemMenu_SetState(work, ItemMenu_StateSortDone);
                done = TRUE;
                break;
            case 1:
                GFL_SndSEPlay(SEQ_SE_SYS_36);
                ItemMenu_Sort(work, 1);
                ItemMenu_SetState(work, ItemMenu_StateSortDone);
                done = TRUE;
                break;
            case 2:
                GFL_SndSEPlay(SEQ_SE_SYS_36);
                ItemMenu_Sort(work, 2);
                ItemMenu_SetState(work, ItemMenu_StateSortDone);
                done = TRUE;
                break;
            case 3:
                GFL_SndSEPlay(SEQ_SE_SYS_36);
                ItemMenu_Sort(work, 3);
                ItemMenu_SetState(work, ItemMenu_StateSortDone);
                done = TRUE;
                break;
            case 4:
                GFL_SndSEPlay(SEQ_SE_SYS_36);
                ItemMenu_Sort(work, 4);
                ItemMenu_SetState(work, ItemMenu_StateSortDone);
                done = TRUE;
                break;
            case 5:
                if (GCTX_HIDIsUsingTouch() == TRUE) {
                    ItemMenuDisp_HideItemInfo(work);
                } else {
                    ItemMenuDisp_DrawItemInfo(work);
                }
                ItemMenu_SetKeyMode(work, GCTX_HIDIsUsingTouch() ? FALSE : TRUE);
                ItemMenuDisp_SetButtonsActive(work, TRUE);
                done = TRUE;
                ClActor_SetAutoAnim(work->scrollBar, TRUE);
                ItemMenu_ReturnToList(work);
                break;
            }
        }
        if (done) {
            ItemMenuDisp_ClearMsgWindow(work);
            AppTaskMenu_Free(work->taskMenu);
            work->taskMenu = NULL;
        }
    }
}

// Says how the pocket was sorted
static void ItemMenu_StateSortDone(ItemMenuWork *work) {
    switch (work->sortType) {
    case 0:
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_SortedItemsByType, work->expandBuf);
        break;
    case 1:
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_SortedItemsByNumber, work->expandBuf);
        break;
    case 2:
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_SortedItemsByName, work->expandBuf);
        break;
    case 3:
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_SortedItemsFromMost, work->expandBuf);
        break;
    case 4:
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_SortedItemsFromFewest, work->expandBuf);
        break;
    default:
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_HowWantSortItems, work->expandBuf);
        break;
    }
    ItemMenuDisp_ShowMessage(work, FALSE);
    ItemMenu_SetState(work, ItemMenu_StateSortWaitMessage);
}

// Says what the Free Space shows
static void ItemMenu_StateFilterDone(ItemMenuWork *work) {
    switch (work->freeSpaceFilter) {
    case BAG_ITEM_FILTER_ALL:
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_NumberItemTypesFound_2, work->strbuf);
        WordSetNumber(work->wordSet, 1, ItemMenu_GetItemCount(work), 3, 0, TRUE);
        GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
        break;
    case BAG_ITEM_FILTER_ITEMS:
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_NumberItemTypesFound, work->strbuf);
        WordSetNumber(work->wordSet, 1, ItemMenu_GetItemCount(work), 3, 0, TRUE);
        ItemMenu_SetPocketName(work, 0, BAG_POCKET_ITEMS);
        GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
        break;
    case BAG_ITEM_FILTER_MEDICINE:
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_NumberItemTypesFound, work->strbuf);
        WordSetNumber(work->wordSet, 1, ItemMenu_GetItemCount(work), 3, 0, TRUE);
        ItemMenu_SetPocketName(work, 0, BAG_POCKET_MEDICINE);
        GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
        break;
    case BAG_ITEM_FILTER_TMS_HMS:
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_NumberItemTypesFound, work->strbuf);
        WordSetNumber(work->wordSet, 1, ItemMenu_GetItemCount(work), 3, 0, TRUE);
        ItemMenu_SetPocketName(work, 0, BAG_POCKET_TMS_HMS);
        GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
        break;
    case BAG_ITEM_FILTER_BERRIES:
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_NumberItemTypesFound, work->strbuf);
        WordSetNumber(work->wordSet, 1, ItemMenu_GetItemCount(work), 3, 0, TRUE);
        ItemMenu_SetPocketName(work, 0, BAG_POCKET_BERRIES);
        GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
        break;
    case BAG_ITEM_FILTER_KEY_ITEMS:
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_NumberItemTypesFound, work->strbuf);
        WordSetNumber(work->wordSet, 1, ItemMenu_GetItemCount(work), 3, 0, TRUE);
        ItemMenu_SetPocketName(work, 0, BAG_POCKET_KEY_ITEMS);
        GFL_WordSetFormatStrbuf(work->wordSet, work->expandBuf, work->strbuf);
        break;
    default:
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_HowWantSortItems, work->expandBuf);
        break;
    }
    ItemMenuDisp_ShowMessage(work, FALSE);
    ItemMenu_SetState(work, ItemMenu_StateSortWaitMessage);
}

// Opens the Free Space's filter menu once its button is up
static void ItemMenu_StateOpenFilterMenu(ItemMenuWork *work) {
    if (ClActor_IsAnimActive(work->filterButton) == FALSE) {
        ClActor_SetSequence(work->filterButton, 2);
        ClActor_SetAutoAnim(work->scrollBar, FALSE);
        GFL_MsgDataLoadStrbuf(work->msgData, BtlMain_Text_SelectTypeItemWant, work->expandBuf);
        ItemMenuDisp_ShowMessage(work, FALSE);
        ItemMenuDisp_SetButtonsActive(work, FALSE);
        ItemMenu_OpenFilterMenu(work);
        ItemMenu_SetState(work, ItemMenu_StateFilterMenu);
    }
}

static void ItemMenu_OpenFilterMenu(ItemMenuWork *work) {
    u8 actions[7] = { 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff };
    BmpWin *window;
    s32 i;
    s32 count;

    ItemMenu_GetFilterActions(work, actions);
    for (i = 0, count = 0; i < 7; i++) {
        if (actions[i] != 0xff) {
            work->freeSpaceMenuActions[count] = actions[i];
            count++;
        }
    }
    window = work->menuTitleWindow.window;
    BmpWin_ClearScreen(window);
    GFL_BGSysLoadScr(BmpWin_GetBGIndex(window));
    ItemMenuDisp_OpenFilterMenu(work, count);
}

// The filters the Free Space offers: those of the pockets it holds items of, but not the current one
static void ItemMenu_GetFilterActions(ItemMenuWork *work, u8 *actions) {
    if (work->freeSpaceFilter != BAG_ITEM_FILTER_ALL) {
        actions[0] = 5;
    }
    if (work->freeSpaceFilter != BAG_ITEM_FILTER_ITEMS &&
        BagItemList_CountInPocket(&work->itemList, BAG_POCKET_ITEMS) > 0) {
        actions[1] = 0;
    }
    if (work->freeSpaceFilter != BAG_ITEM_FILTER_MEDICINE &&
        BagItemList_CountInPocket(&work->itemList, BAG_POCKET_MEDICINE) > 0) {
        actions[2] = 1;
    }
    if (work->freeSpaceFilter != BAG_ITEM_FILTER_TMS_HMS &&
        BagItemList_CountInPocket(&work->itemList, BAG_POCKET_TMS_HMS) > 0) {
        actions[3] = 2;
    }
    if (work->freeSpaceFilter != BAG_ITEM_FILTER_BERRIES &&
        BagItemList_CountInPocket(&work->itemList, BAG_POCKET_BERRIES) > 0) {
        actions[4] = 3;
    }
    if (work->freeSpaceFilter != BAG_ITEM_FILTER_KEY_ITEMS &&
        BagItemList_CountInPocket(&work->itemList, BAG_POCKET_KEY_ITEMS) > 0) {
        actions[5] = 4;
    }
    actions[6] = 6;
}

// The number of entries of the Free Space's filter menu
s32 ItemMenu_CountFilterActions(ItemMenuWork *work) {
    s32 count = 1;

    if (work->freeSpaceFilter != BAG_ITEM_FILTER_ALL) {
        count++;
    }
    if (work->freeSpaceFilter != BAG_ITEM_FILTER_ITEMS &&
        BagItemList_CountInPocket(&work->itemList, BAG_POCKET_ITEMS) > 0) {
        count++;
    }
    if (work->freeSpaceFilter != BAG_ITEM_FILTER_MEDICINE &&
        BagItemList_CountInPocket(&work->itemList, BAG_POCKET_MEDICINE) > 0) {
        count++;
    }
    if (work->freeSpaceFilter != BAG_ITEM_FILTER_TMS_HMS &&
        BagItemList_CountInPocket(&work->itemList, BAG_POCKET_TMS_HMS) > 0) {
        count++;
    }
    if (work->freeSpaceFilter != BAG_ITEM_FILTER_BERRIES &&
        BagItemList_CountInPocket(&work->itemList, BAG_POCKET_BERRIES) > 0) {
        count++;
    }
    if (work->freeSpaceFilter != BAG_ITEM_FILTER_KEY_ITEMS &&
        BagItemList_CountInPocket(&work->itemList, BAG_POCKET_KEY_ITEMS) > 0) {
        count++;
    }
    return count;
}

// The Free Space's filter menu, once the player picked from it
static void ItemMenu_StateFilterMenu(ItemMenuWork *work) {
    BOOL done = FALSE;

    if (ItemMenuDisp_IsMessageDone(work)) {
        if (AppTaskMenu_IsFlashFinished(work->taskMenu)) {
            work->menuAction = work->freeSpaceMenuActions[AppTaskMenu_GetCursorPos(work->taskMenu)];
            switch (work->menuAction) {
            case 5:
                GFL_SndSEPlay(SEQ_SE_SYS_36);
                ItemMenu_ChangeFreeSpaceFilter(work, BAG_ITEM_FILTER_ALL);
                ItemMenu_SetState(work, ItemMenu_StateFilterDone);
                done = TRUE;
                break;
            case 0:
                GFL_SndSEPlay(SEQ_SE_SYS_36);
                ItemMenu_ChangeFreeSpaceFilter(work, BAG_ITEM_FILTER_ITEMS);
                ItemMenu_SetState(work, ItemMenu_StateFilterDone);
                done = TRUE;
                break;
            case 1:
                GFL_SndSEPlay(SEQ_SE_SYS_36);
                ItemMenu_ChangeFreeSpaceFilter(work, BAG_ITEM_FILTER_MEDICINE);
                ItemMenu_SetState(work, ItemMenu_StateFilterDone);
                done = TRUE;
                break;
            case 2:
                GFL_SndSEPlay(SEQ_SE_SYS_36);
                ItemMenu_ChangeFreeSpaceFilter(work, BAG_ITEM_FILTER_TMS_HMS);
                ItemMenu_SetState(work, ItemMenu_StateFilterDone);
                done = TRUE;
                break;
            case 3:
                GFL_SndSEPlay(SEQ_SE_SYS_36);
                ItemMenu_ChangeFreeSpaceFilter(work, BAG_ITEM_FILTER_BERRIES);
                ItemMenu_SetState(work, ItemMenu_StateFilterDone);
                done = TRUE;
                break;
            case 4:
                GFL_SndSEPlay(SEQ_SE_SYS_36);
                ItemMenu_ChangeFreeSpaceFilter(work, BAG_ITEM_FILTER_KEY_ITEMS);
                ItemMenu_SetState(work, ItemMenu_StateFilterDone);
                done = TRUE;
                break;
            case 6:
                if (GCTX_HIDIsUsingTouch() == TRUE) {
                    ItemMenuDisp_HideItemInfo(work);
                } else {
                    ItemMenuDisp_DrawItemInfo(work);
                }
                ItemMenu_SetKeyMode(work, GCTX_HIDIsUsingTouch() ? FALSE : TRUE);
                ItemMenuDisp_SetButtonsActive(work, TRUE);
                done = TRUE;
                ClActor_SetAutoAnim(work->scrollBar, TRUE);
                ItemMenu_ReturnToList(work);
                break;
            }
        }
        if (done) {
            ItemMenuDisp_ClearMsgWindow(work);
            AppTaskMenu_Free(work->taskMenu);
            work->taskMenu = NULL;
        }
    }
}

// Waits for the sort's message to be read
static void ItemMenu_StateSortWaitMessage(ItemMenuWork *work) {
    if (GCTX_HIDGetPressedKeys() & (PAD_BUTTON_A | PAD_BUTTON_B)) {
        ItemMenu_SetKeyMode(work, TRUE);
    } else if (GFL_HIDIsTouchPressed()) {
        ItemMenu_SetKeyMode(work, FALSE);
    } else {
        return;
    }
    work->drawnScroll = 0xffff;
    ItemMenuDisp_UpdateScrollBar(work);
    ItemMenu_UpdateList(work);
    ItemMenuDisp_ClearMsgWindow(work);
    ClActor_SetAutoAnim(work->scrollBar, TRUE);
    ItemMenuDisp_SetButtonsActive(work, TRUE);
    ItemMenu_ReturnToList(work);
}

// Whether an item of a field pocket can be used in the bag's mode
static BOOL ItemMenu_CanUseInMode(ItemMenuWork *work, u8 fieldPocket) {
    if (work->mode == 3 || work->mode == 1) {
        return FALSE;
    }
    if (GameData_IsForceSeasonSync(work->gameData) == TRUE && fieldPocket == BAG_POCKET_KEY_ITEMS) {
        return FALSE;
    }
    return TRUE;
}

static void ItemMenu_StatePocketArrowDone(ItemMenuWork *work) {
    ItemMenu_ReturnToList(work);
}

// Whether the Free Space keeps its filter after the bag closes, by the bag's mode and the result
static void ItemMenu_SaveFreeSpaceFilter(void *cursor, u32 mode, u32 result, u32 freeSpaceFilter) {
    u8 keepFilter[6][23] = {
        { 1, 1, 2, 2, 0, 2, 2, 2, 2, 0, 1, 1, 2, 0, 1, 1, 1, 2, 2, 2, 1, 2, 2 },
        { 1, 1, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0 },
        { 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0 },
        { 1, 1, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0 },
        { 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
        { 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
    };

    switch (keepFilter[mode][result]) {
    case 0:
        break;
    case 1:
        BagCursor_SetFreeSpaceFilter(cursor, BAG_ITEM_FILTER_ALL);
        break;
    case 2:
        BagCursor_SetFreeSpaceFilter(cursor, freeSpaceFilter);
        break;
    }
}
