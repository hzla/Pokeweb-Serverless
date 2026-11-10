#ifndef POKEBW2_SYSTEM_BMP_MENULIST_H
#define POKEBW2_SYSTEM_BMP_MENULIST_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"
#include "system/bmp_menuwork.h"
#include "system/printsys.h"

// BmpMenuList_Create, BmpMenuList_Update, BmpMenuList_Free, BmpMenuList_Scroll and BmpMenuList_CycleCursor are swan's
// names (https://github.com/ds-pokemon-hacking/swan, GPL-3.0); the others are ours

// Scrolling lists of options in a window, with a cursor (bmp_menulist.c)

// Called as the cursor moves to an option (init is TRUE when the list is made), and to print more of an option at a
// row of the window
typedef void (*BmpMenuListCursorCallback)(BmpMenuList *list, s32 value, u8 init);
typedef void (*BmpMenuListPrintCallback)(BmpMenuList *list, s32 value, u8 y);

// BmpMenuList_Update's results when nothing was chosen and when the menu was cancelled, and the value of a label: an
// option printed at labelX that the cursor skips
#define BMPMENULIST_NULL (-1)
#define BMPMENULIST_CANCEL (-2)
#define BMPMENULIST_LABEL (-3)

// The keys that move the cursor a page
#define BMPMENULIST_SKIP_NONE 0
#define BMPMENULIST_SKIP_LR_KEY 1
#define BMPMENULIST_SKIP_LR_BUTTON 2

#define BMPMENULIST_CURSOR_SHOW 0
#define BMPMENULIST_CURSOR_HIDE 1

typedef struct {
    ListMenuOption *options;
    BmpMenuListCursorCallback cursorCallback;
    BmpMenuListPrintCallback printCallback;
    u16 count;
    // The rows the window shows
    u16 maxShown;
    u8 labelX;
    u8 itemX;
    u8 cursorX;
    // The y of the first row
    u8 y : 4;
    u8 fgColor : 4;
    u8 bgColor : 4;
    u8 shadowColor : 4;
    u16 letterSpacing : 3;
    u16 lineSpacing : 4;
    u16 pageSkip : 2;
    u16 fontId : 6;
    u16 cursorDisplay : 1;
    // For the callbacks, which BmpMenuList_GetWork returns
    void *work;
    u16 fontSizeX;
    u16 fontSizeY;
    MsgData *msgData;
    PrintWindow *printWindow;
    PrintQueue *queue;
    Font *font;
    // Frames before the cursor appears, 2 for 0
    u32 wait;
} BmpMenuListHeader;

// BmpMenuList_GetParam's parameters, in the order of the header's fields from the callbacks on. 4 and 18 give -1
enum {
    BMPMENULIST_PARAM_CURSOR_CALLBACK,
    BMPMENULIST_PARAM_PRINT_CALLBACK,
    BMPMENULIST_PARAM_COUNT,
    BMPMENULIST_PARAM_MAX_SHOWN,
    BMPMENULIST_PARAM_4,
    BMPMENULIST_PARAM_LABEL_X,
    BMPMENULIST_PARAM_ITEM_X,
    BMPMENULIST_PARAM_CURSOR_X,
    BMPMENULIST_PARAM_Y,
    BMPMENULIST_PARAM_ROW_HEIGHT,
    BMPMENULIST_PARAM_FG_COLOR,
    BMPMENULIST_PARAM_BG_COLOR,
    BMPMENULIST_PARAM_SHADOW_COLOR,
    BMPMENULIST_PARAM_LETTER_SPACING,
    BMPMENULIST_PARAM_LINE_SPACING,
    BMPMENULIST_PARAM_PAGE_SKIP,
    BMPMENULIST_PARAM_FONT_ID,
    BMPMENULIST_PARAM_CURSOR_DISPLAY,
    BMPMENULIST_PARAM_18,
    BMPMENULIST_PARAM_WORK,
};

// A list showing the options from listTop, with the cursor on cursorRow of the window
BmpMenuList *BmpMenuList_Create(const BmpMenuListHeader *header, u16 listTop, u16 cursorRow, HeapID heapId);
// Reads the keys and moves the cursor; returns the chosen option's value, BMPMENULIST_CANCEL or BMPMENULIST_NULL
s32 BmpMenuList_Update(BmpMenuList *list);
// Frees the list, giving back where it was
void BmpMenuList_Free(BmpMenuList *list, u16 *listTop, u16 *cursorRow);
void BmpMenuList_Redraw(BmpMenuList *list);
void BmpMenuList_SetColors(BmpMenuList *list, u8 fgColor, u8 bgColor, u8 shadowColor);
// Prints the options in these colors from then on
void BmpMenuList_SetOverrideColors(BmpMenuList *list, u8 fgColor, u8 bgColor, u8 shadowColor);
// The index of the option under the cursor
void BmpMenuList_GetCursorIndex(BmpMenuList *list, u16 *index);
void BmpMenuList_GetPos(BmpMenuList *list, u16 *listTop, u16 *cursorRow);
u16 BmpMenuList_GetCursorY(BmpMenuList *list);
u16 BmpMenuList_GetRowY(BmpMenuList *list, u16 row);
s32 BmpMenuList_GetOptionValue(BmpMenuList *list, u16 index);
// A field of the list's header, or -1
s32 BmpMenuList_GetParam(BmpMenuList *list, u8 param);
// Makes the cursor the ROM's triangle bitmap
void BmpMenuList_LoadCursor(BmpMenuList *list, u32 heapId);
void *BmpMenuList_GetWork(BmpMenuList *list);
// Whether B is ignored
void BmpMenuList_SetCancelDisabled(BmpMenuList *list, u8 disabled);

#endif // POKEBW2_SYSTEM_BMP_MENULIST_H
