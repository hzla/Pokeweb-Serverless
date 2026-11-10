#ifndef POKEBW2_SYSTEM_APP_TASKMENU_H
#define POKEBW2_SYSTEM_APP_TASKMENU_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"
#include "system/printsys.h"

// The menus' task menus (app_taskmenu.c): a column of buttons, one window each, picked with the keys or the touch
// screen, and single buttons of the same look. The cursor's button pulses in color, and a picked button flashes.
//
// AppTaskMenuRes holds what the buttons share: the BG, the two palettes from `palette` (the cursor's, then the other
// buttons'), the frame's characters, the font and the print queue.

// An item of a task menu. type 0 is a plain button; the others draw that icon at the right end of the frame, and
// APP_TASKMENU_ITEM_RETURN, the return arrow, plays the cancel sound when picked
typedef struct {
    StrBuf *str;
    u16 color;
    u32 type;
} AppTaskMenuItem;

#define APP_TASKMENU_ITEM_RETURN 1

// The most items a task menu can have
#define APP_TASKMENU_ITEM_MAX 8

// Where a task menu's x and y put it: its top left corner, or its bottom right
#define APP_TASKMENU_POS_TOP_LEFT 0
#define APP_TASKMENU_POS_BOTTOM_RIGHT 1

// A task menu's settings. A width or height of 0 gets the default, 13 by 3 tiles
typedef struct {
    u32 heapId;
    u8 itemCount;
    AppTaskMenuItem *items;
    u32 posType;
    u8 x;
    u8 y;
    u8 width;
    u8 height;
} AppTaskMenuInit;

AppTaskMenu *AppTaskMenu_Create(AppTaskMenuInit *init, AppTaskMenuRes *res);
// AppTaskMenu_Create with a picked item flashing twice as fast
AppTaskMenu *AppTaskMenu_CreateFastFlash(AppTaskMenuInit *init, AppTaskMenuRes *res);
void AppTaskMenu_Free(AppTaskMenu *menu);
// Shows the windows once their text is printed. AppTaskMenu_Update calls it
void AppTaskMenu_UpdateText(AppTaskMenu *menu);
// Reads the keys and the touch screen until an item is picked, then flashes it
void AppTaskMenu_Update(AppTaskMenu *menu);
BOOL AppTaskMenu_IsFlashFinished(AppTaskMenu *menu);
u8 AppTaskMenu_GetCursorPos(AppTaskMenu *menu);
// Shows the cursor's button as the cursor's, or as the others
void AppTaskMenu_SetCursorActive(AppTaskMenu *menu, BOOL active);
BOOL AppTaskMenu_IsDecided(AppTaskMenu *menu);
// While locked, the keys do nothing. Locking it hides the cursor
void AppTaskMenu_SetLocked(AppTaskMenu *menu, BOOL locked);
void AppTaskMenu_SetCursorPos(AppTaskMenu *menu, u32 pos);

AppTaskMenuRes *AppTaskMenuRes_Create(u8 bg, u8 palette, Font *font, PrintQueue *queue, HeapID heapId);
void AppTaskMenuRes_Free(AppTaskMenuRes *res);

// A single button at x and y, width tiles wide and 3 tall
AppTaskMenuWin *AppTaskMenuWin_Create(AppTaskMenuRes *res, const AppTaskMenuItem *item, u8 x, u8 y, u8 width,
                                      HeapID heapId);
// A single button with the text centered if `centered`; fastFlash makes it flash twice as fast
AppTaskMenuWin *AppTaskMenuWin_CreateEx(AppTaskMenuRes *res, const AppTaskMenuItem *item, u8 x, u8 y, u8 width,
                                        u8 height, u32 fastFlash, BOOL centered, HeapID heapId);
// AppTaskMenuWin_CreateEx that only puts the window on the screen, its characters loaded later
AppTaskMenuWin *AppTaskMenuWin_CreateExNoChar(AppTaskMenuRes *res, const AppTaskMenuItem *item, u8 x, u8 y, u8 width,
                                              u8 height, u32 fastFlash, BOOL centered, HeapID heapId);
// Frees the button and clears it from the screen, or leaves it there
void AppTaskMenuWin_Free(AppTaskMenuWin *win);
void AppTaskMenuWin_FreeKeepScreen(AppTaskMenuWin *win);
void AppTaskMenuWin_Update(AppTaskMenuWin *win);
void AppTaskMenuWin_SetActive(AppTaskMenuWin *win, BOOL active);
void AppTaskMenuWin_SetFlashing(AppTaskMenuWin *win, BOOL flashing);
BOOL AppTaskMenuWin_IsFlashing(AppTaskMenuWin *win);
BOOL AppTaskMenuWin_IsFlashFinished(AppTaskMenuWin *win);
// Whether the button was touched this frame
BOOL AppTaskMenuWin_IsTouched(AppTaskMenuWin *win);
void AppTaskMenuWin_ResetFlash(AppTaskMenuWin *win);
// Moves the buttons of res to another pair of palettes, and sets the colors the button pulses between
void AppTaskMenuWin_SetPalette(AppTaskMenuWin *win, AppTaskMenuRes *res, u16 palette, u16 color1, u16 color2);
void AppTaskMenuWin_ClearScreen(AppTaskMenuWin *win);
void AppTaskMenuWin_FlushMap(AppTaskMenuWin *win);
BOOL AppTaskMenuWin_IsUpdatingText(AppTaskMenuWin *win);

#endif // POKEBW2_SYSTEM_APP_TASKMENU_H
