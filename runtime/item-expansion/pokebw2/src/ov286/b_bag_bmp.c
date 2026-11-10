#include "types.h"
#include "battle/b_app_tool.h"
#include "battle/b_bag_bmp.h"
#include "battle/b_bag_main.h"
#include "constants/items.h"
#include "gfl/bg_sys.h"
#include "gfl/bmp.h"
#include "gfl/bmpwin.h"
#include "gfl/msg.h"
#include "gfl/str.h"
#include "pml/item.h"
#include "system/bmp_winframe.h"
#include "system/gf_font.h"
#include "system/printsys.h"
#include "system/str_tool.h"
#include "system/text_speed.h"
#include "system/wordset.h"

// The battle bag's windows and text (overlay 286). The ROM doesn't name this file: b_bag_bmp.c is a guess after the
// ROM's b_bag_main.c and the b_bag_bmp.c of Diamond and Pearl. None of these functions has a name yet.

#define BBAG_COLOR PRINT_COLOR(15, 2, 0)

typedef struct {
    u8 bg;
    u8 x;
    u8 y;
    u8 width;
    u8 height;
    u8 palette;
} BBagWinData;

static void BBagBmp_CreateWindows(BBagWork *work, u8 page);
static void BBagBmp_FreeWindows(BBagWork *work);
static void BBagBmp_PrintCentered(BBagWork *work, u32 winIdx, u32 msgId, u32 y, u16 color);
static void BBagBmp_DrawPocketPage(BBagWork *work);
static void BBagBmp_PrintSlotName(BBagWork *work, u32 index, u32 slot, u32 winIdx, u32 x, u32 y);
static void BBagBmp_PrintSlotCount(BBagWork *work, u32 index, u32 slot, u32 winIdx, u32 x, u32 y, u32 unused);
static void BBagBmp_DrawSlot(BBagWork *work, u32 slot);
static void BBagBmp_PrintPocketName(BBagWork *work);
static void BBagBmp_DrawItemPage(BBagWork *work);
static void BBagBmp_PrintChosenName(BBagWork *work, u32 index);
static void BBagBmp_PrintDescription(BBagWork *work, u32 index);
static void BBagBmp_DrawChosenItemPage(BBagWork *work);
static void BBagBmp_StartMessageStream(BBagWork *work);

static const u8 data_ov286_021f6d54[] = { 31, 32, 33, 34, 0xff };
static const u8 data_ov286_021f6d59[] = { 0, 1, 2, 3, 4, 0xff };
static const u8 data_ov286_021f6d65[] = { 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 0xff };
static const u8 data_ov286_021f6d74[] = { 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 29, 30, 0xff };

// By slot, the messages of the item's name and of its count
static const u32 data_ov286_021f6d84[6][2] = {
    { 9, 10 }, { 11, 12 }, { 13, 14 }, { 15, 16 }, { 17, 18 }, { 19, 20 },
};

static const BBagWinData data_ov286_021f6db4[BBAG_WINDOW_MAX] = {
    { 4, 2, 4, 12, 4, 12 },  { 4, 2, 13, 12, 4, 12 },  { 4, 18, 5, 12, 2, 12 }, { 4, 18, 14, 12, 2, 12 },
    { 4, 6, 21, 18, 2, 12 }, { 5, 1, 1, 14, 3, 12 },   { 5, 8, 4, 5, 3, 12 },   { 5, 17, 1, 14, 3, 12 },
    { 5, 24, 4, 5, 3, 12 },  { 5, 1, 7, 14, 3, 12 },   { 5, 8, 10, 5, 3, 12 },  { 5, 17, 7, 14, 3, 12 },
    { 5, 24, 10, 5, 3, 12 }, { 5, 1, 13, 14, 3, 12 },  { 5, 8, 16, 5, 3, 12 },  { 5, 17, 13, 14, 3, 12 },
    { 5, 24, 16, 5, 3, 12 }, { 5, 1, 1, 14, 3, 12 },   { 5, 8, 4, 5, 3, 12 },   { 5, 17, 1, 14, 3, 12 },
    { 5, 24, 4, 5, 3, 12 },  { 5, 1, 7, 14, 3, 12 },   { 5, 8, 10, 5, 3, 12 },  { 5, 17, 7, 14, 3, 12 },
    { 5, 24, 10, 5, 3, 12 }, { 5, 1, 13, 14, 3, 12 },  { 5, 8, 16, 5, 3, 12 },  { 5, 17, 13, 14, 3, 12 },
    { 5, 24, 16, 5, 3, 12 }, { 5, 11, 19, 10, 5, 12 },
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    { 5, 20, 20, 7, 3, 12 },
#else
    { 5, 21, 20, 5, 3, 12 },
#endif
    { 5, 7, 4, 12, 2, 12 },  { 5, 20, 4, 5, 2, 12 },   { 5, 2, 9, 28, 6, 12 },  { 5, 8, 21, 11, 2, 12 },
};

// The message window. Declared after the window table for MWCC's sort to lay the data out in the ROM's order
static const BBagWinData data_ov286_021f6d5f = { 4, 1, 19, 30, 4, 12 };

void BBagBmp_Init(BBagWork *work) {
    work->msgWin =
        BmpWin_CreateDynamic(data_ov286_021f6d5f.bg, data_ov286_021f6d5f.x, data_ov286_021f6d5f.y,
                             data_ov286_021f6d5f.width, data_ov286_021f6d5f.height, data_ov286_021f6d5f.palette, TRUE);
    BBagBmp_CreateWindows(work, work->page);
}

// page isn't used: every window is created at once
static void BBagBmp_CreateWindows(BBagWork *work, u8 page) {
    const BBagWinData *data = data_ov286_021f6db4;
    u32 i;

    for (i = 0; i < BBAG_WINDOW_MAX; i++) {
        work->windows[i].window =
            BmpWin_CreateDynamic(data->bg, data->x, data->y, data->width, data->height, data->palette, TRUE);
        data++;
    }
}

static void BBagBmp_FreeWindows(BBagWork *work) {
    u32 i;

    for (i = 0; i < BBAG_WINDOW_MAX; i++) {
        BmpWin_Free(work->windows[i].window);
    }
}

void BBagBmp_Exit(BBagWork *work) {
    BBagBmp_FreeWindows(work);
    BmpWin_Free(work->msgWin);
}

void BBagBmp_DrawPage(BBagWork *work, u8 page) {
    switch (page) {
    case 0:
        BBagBmp_DrawPocketPage(work);
        break;
    case 1:
        BBagBmp_DrawItemPage(work);
        break;
    case 2:
        BBagBmp_DrawChosenItemPage(work);
        break;
    }
}

static void BBagBmp_PrintCentered(BBagWork *work, u32 winIdx, u32 msgId, u32 y, u16 color) {
    BmpWin *win = work->windows[winIdx].window;
    StrBuf *str = GFL_MsgDataLoadStrbufNew(work->msgData, msgId);
    u32 width = GFL_FontGetBlockWidth(str, work->param->font, 0);
    u32 x = (BmpWin_GetSizeX(win) * 8 - width) / 2;

    PrintWindow_Print(&work->windows[winIdx], work->printQueue, x, y, str, work->param->font, color);
    GFL_StrBufFree(str);
}

static void BBagBmp_DrawPocketPage(BBagWork *work) {
    u32 i;

    for (i = 0; i <= 4; i++) {
        GFL_BitmapFill(BmpWin_GetBitmap(work->windows[i].window), 0);
    }
    BBagBmp_PrintCentered(work, 0, 0, 0, BBAG_COLOR);
    BBagBmp_PrintCentered(work, 0, 1, 16, BBAG_COLOR);
    BBagBmp_PrintCentered(work, 1, 2, 0, BBAG_COLOR);
    BBagBmp_PrintCentered(work, 1, 3, 16, BBAG_COLOR);
    BBagBmp_PrintCentered(work, 2, 7, 0, BBAG_COLOR);
    BBagBmp_PrintCentered(work, 3, 6, 0, BBAG_COLOR);

    if (work->lastItem != ITEM_NONE) {
        StrBuf *str = GFL_MsgDataLoadStrbufNew(work->msgData, 8);

        PrintWindow_Print(&work->windows[4], work->printQueue, 0, 0, str, work->param->font, BBAG_COLOR);
        GFL_StrBufFree(str);
    } else {
        BmpWin_FlushChar(work->windows[4].window);
    }
    work->flushList = data_ov286_021f6d59;
}

// x and y aren't used: the name is centred at y 7
static void BBagBmp_PrintSlotName(BBagWork *work, u32 index, u32 slot, u32 winIdx, u32 x, u32 y) {
    BmpWin *win = work->windows[winIdx].window;
    StrBuf *tmpl;
    u32 width;
    u32 nameX;

    GFL_BitmapFill(BmpWin_GetBitmap(win), 0);
    if (work->items[work->pocket][index].item != ITEM_NONE) {
        tmpl = GFL_MsgDataLoadStrbufNew(work->msgData, data_ov286_021f6d84[slot][0]);
        loadItemNameToStrbuf(work->wordSet, 0, work->items[work->pocket][index].item);
        GFL_WordSetFormatStrbuf(work->wordSet, work->strBuf, tmpl);
        width = GFL_FontGetBlockWidth(work->strBuf, work->param->font, 0);
        nameX = (BmpWin_GetSizeX(win) * 8 - width) / 2;
        PrintWindow_Print(&work->windows[winIdx], work->printQueue, nameX, 7, work->strBuf, work->param->font,
                          BBAG_COLOR);
        GFL_StrBufFree(tmpl);
    } else {
        BmpWin_FlushChar(win);
    }
}

// x and the last argument aren't used: the count is printed at x 0
static void BBagBmp_PrintSlotCount(BBagWork *work, u32 index, u32 slot, u32 winIdx, u32 x, u32 y, u32 unused) {
    BmpWin *win = work->windows[winIdx].window;
    StrBuf *tmpl;

    GFL_BitmapFill(BmpWin_GetBitmap(win), 0);
    if (work->items[work->pocket][index].count != 0 && work->param->mode != 1) {
        tmpl = GFL_MsgDataLoadStrbufNew(work->msgData, data_ov286_021f6d84[slot][1]);
        WordSetNumber(work->wordSet, 0, work->items[work->pocket][index].count, 3, NUM_PAD_NONE, TRUE);
        GFL_WordSetFormatStrbuf(work->wordSet, work->strBuf, tmpl);
        PrintWindow_Print(&work->windows[winIdx], work->printQueue, 0, y, work->strBuf, work->param->font, BBAG_COLOR);
        GFL_StrBufFree(tmpl);
    } else {
        BmpWin_FlushChar(win);
    }
}

static void BBagBmp_DrawSlot(BBagWork *work, u32 slot) {
    u32 index = work->param->pages[work->pocket] * 6;
    u32 winIdx = 5;

    if (work->listBuf != 0) {
        winIdx = 17;
    }
    BBagBmp_PrintSlotName(work, slot + index, slot, winIdx + slot * 2, 0, 0);
    BBagBmp_PrintSlotCount(work, slot + index, slot, winIdx + 1 + slot * 2, 0, 4, 0);
}

void BBagBmp_DrawSlots(BBagWork *work) {
    u16 i;

    GFL_BGSysFillScrArea(5, 0, 0, 0, 32, 19, 17);
    for (i = 0; i < 6; i++) {
        BBagBmp_DrawSlot(work, i);
    }
    if (work->listBuf == 0) {
        work->flushList = data_ov286_021f6d74;
    } else {
        work->flushList = data_ov286_021f6d65;
    }
    work->listBuf ^= 1;
}

void BBagBmp_PrintPageNumber(BBagWork *work) {
    BmpWin *win = work->windows[30].window;
    GFLBitmap *bitmap = BmpWin_GetBitmap(win);
    StrBuf *str;
    u32 slashWidth;
    u32 x;
    u32 pageWidth;

    GFL_BitmapFill(bitmap, 0);
    str = GFL_MsgDataLoadStrbufNew(work->msgData, 28);
    slashWidth = GFL_FontGetBlockWidth(str, work->param->font, 0);
    x = (BmpWin_GetSizeX(win) * 8 - slashWidth) / 2;
    PrintQueue_PrintColor(work->printQueue, bitmap, x, 4, str, work->param->font, BBAG_COLOR);
    GFL_StrBufFree(str);

    str = GFL_MsgDataLoadStrbufNew(work->msgData, 29);
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    WordSetNumber(work->wordSet, 0, work->lastPage[work->pocket] + 1, 3, NUM_PAD_NONE, TRUE);
#else
    WordSetNumber(work->wordSet, 0, work->lastPage[work->pocket] + 1, 2, NUM_PAD_NONE, TRUE);
#endif
    GFL_WordSetFormatStrbuf(work->wordSet, work->strBuf, str);
    PrintQueue_PrintColor(work->printQueue, bitmap, x + slashWidth, 4, work->strBuf, work->param->font, BBAG_COLOR);
    GFL_StrBufFree(str);

    str = GFL_MsgDataLoadStrbufNew(work->msgData, 30);
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    WordSetNumber(work->wordSet, 0, work->param->pages[work->pocket] + 1, 3, NUM_PAD_NONE, TRUE);
#else
    WordSetNumber(work->wordSet, 0, work->param->pages[work->pocket] + 1, 2, NUM_PAD_NONE, TRUE);
#endif
    GFL_WordSetFormatStrbuf(work->wordSet, work->strBuf, str);
    pageWidth = GFL_FontGetBlockWidth(work->strBuf, work->param->font, 0);
    PrintWindow_Print(&work->windows[30], work->printQueue, x - pageWidth, 4, work->strBuf, work->param->font,
                      BBAG_COLOR);
    GFL_StrBufFree(str);
}

static void BBagBmp_PrintPocketName(BBagWork *work) {
    GFL_BitmapFill(BmpWin_GetBitmap(work->windows[29].window), 0);
    if (work->param->mode != 1) {
        switch (work->pocket) {
        case 0:
            BBagBmp_PrintCentered(work, 29, 22, 4, BBAG_COLOR);
            BBagBmp_PrintCentered(work, 29, 23, 20, BBAG_COLOR);
            break;
        case 1:
            BBagBmp_PrintCentered(work, 29, 24, 4, BBAG_COLOR);
            BBagBmp_PrintCentered(work, 29, 25, 20, BBAG_COLOR);
            break;
        case 2:
            BBagBmp_PrintCentered(work, 29, 26, 12, BBAG_COLOR);
            break;
        case 3:
            BBagBmp_PrintCentered(work, 29, 27, 12, BBAG_COLOR);
            break;
        }
    } else {
        BmpWin_FlushChar(work->windows[29].window);
    }
}

static void BBagBmp_DrawItemPage(BBagWork *work) {
    BBagBmp_DrawSlots(work);
    BBagBmp_PrintPocketName(work);
    BBagBmp_PrintPageNumber(work);
}

static void BBagBmp_PrintChosenName(BBagWork *work, u32 index) {
    BmpWin *win = work->windows[31].window;
    StrBuf *tmpl = GFL_MsgDataLoadStrbufNew(work->msgData, 9);

    loadItemNameToStrbuf(work->wordSet, 0, work->items[work->pocket][index].item);
    GFL_WordSetFormatStrbuf(work->wordSet, work->strBuf, tmpl);
    GFL_BitmapFill(BmpWin_GetBitmap(win), 0);
    PrintWindow_Print(&work->windows[31], work->printQueue, 0, 0, work->strBuf, work->param->font, BBAG_COLOR);
    GFL_StrBufFree(tmpl);
}

static void BBagBmp_PrintDescription(BBagWork *work, u32 index) {
    StrBuf *str = GFL_StrBufCreate(130, work->param->heapId);

    setItemDescriptionTextToStrbuf(str, work->items[work->pocket][index].item, work->param->heapId);
    PrintWindow_Print(&work->windows[33], work->printQueue, 4, 0, str, work->param->font, BBAG_COLOR);
    GFL_StrBufFree(str);
}

static void BBagBmp_DrawChosenItemPage(BBagWork *work) {
    u32 i;
    s16 row;
    s16 page;

    for (i = 31; i <= 34; i++) {
        GFL_BitmapFill(BmpWin_GetBitmap(work->windows[i].window), 0);
    }
    row = work->param->rows[work->pocket];
    page = work->param->pages[work->pocket];
    BBagBmp_PrintChosenName(work, row + page * 6);
    BBagBmp_PrintSlotCount(work, row + page * 6, 0, 32, 0, 0, 0);
    BBagBmp_PrintDescription(work, row + page * 6);
    BBagBmp_PrintCentered(work, 34, 31, 0, BBAG_COLOR);
    work->flushList = data_ov286_021f6d54;
}

void BBagBmp_OpenMessage(BBagWork *work) {
    BmpWin_DrawFrame(work->msgWin, WINFRAME_TRANSFER_NONE, 1, 11);
    GFL_BitmapFill(BmpWin_GetBitmap(work->msgWin), 15);
    BBagBmp_StartMessageStream(work);
}

static void BBagBmp_StartMessageStream(BBagWork *work) {
    GFL_TextRndUpdateColorIndexLUT(1, 2, 0);
    work->printStream = PrintStream_Create(work->msgWin, 0, 0, work->strBuf, work->param->font,
                                           TextSpeed_GetCurrentWait(), work->tcbExMgr, 10, work->param->heapId, 15);
    BmpWin_Transfer(work->msgWin);
}

void BBagBmp_FlushWindows(BBagWork *work) {
    BAppTool_FlushPrintWindows(work->windows, work->printQueue, BBAG_WINDOW_MAX);
}

void BBagBmp_TransferPage(BBagWork *work) {
    BAppTool_QueueWindowScreens(work->windows, work->flushList);
}
