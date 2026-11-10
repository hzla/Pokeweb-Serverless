#ifndef POKEBW2_SYSTEM_BMP_MENU_H
#define POKEBW2_SYSTEM_BMP_MENU_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"
#include "system/bmp_cursor.h"
#include "system/bmp_menuwork.h"
#include "system/printsys.h"

// ShopUI_CreateConfirmDialog is swan's name (https://github.com/ds-pokemon-hacking/swan, GPL-3.0); the others are
// ours

// Menus of options laid out in columns in a window, with a cursor that moves between them (bmp_menu.c). The ROM only
// has its yes/no menu, which ShopUI_CreateConfirmDialog makes

// The results of a menu's update while nothing is chosen and when it is cancelled, and the value of an option the
// cursor skips
#define BMPMENU_NULL (-1)
#define BMPMENU_CANCEL (-2)
#define BMPMENU_DUMMY (-3)

typedef struct {
    ListMenuOption *options;
    // Frames before the cursor appears, which the yes/no menu shortens to 2 for 0
    u8 wait;
    u8 xCount;
    u8 yCount;
    u8 lineSpacing : 4;
    // BMPMENU_CURSOR_SHOW or BMPMENU_CURSOR_HIDE
    u8 cursorDisplay : 2;
    // Whether the cursor wraps around at the edges
    u8 loop : 2;
    u16 fontSizeX;
    u16 fontSizeY;
    u32 unkC;
    PrintWindow *printWindow;
    PrintQueue *queue;
    Font *font;
    // Set once the options are printed and the window's characters are copied
    BOOL printed;
} BmpMenuHeader;

#define BMPMENU_CURSOR_SHOW 0
#define BMPMENU_CURSOR_HIDE 1

// The directions the cursor moves in
enum {
    BMPMENU_MOVE_UP,
    BMPMENU_MOVE_DOWN,
    BMPMENU_MOVE_LEFT,
    BMPMENU_MOVE_RIGHT,
};

struct BmpMenu {
    BmpMenuHeader header;
    BmpCursor *cursor;
    // The keys that cancel the menu
    u32 cancelKeys;
    u8 unk28;
    u8 cursorPos;
    // The width of the widest option
    u8 maxWidth;
    u8 x;
    u8 y;
    u8 fontSizeX;
    u8 fontSizeY;
    // The direction the cursor last moved, plus 1, or 0 if it didn't
    u8 moveDir;
    HeapID heapId;
    // Frames until the cursor is drawn
    u8 wait;
};

typedef struct {
    u8 bg;
    u8 x;
    u8 y;
    u8 palette;
    u16 unk4;
} ConfirmDialogSetup;

// A yes/no menu in a window of its own, with the frame at frameChar and framePalette and the cursor on cursorPos
BmpMenu *ShopUI_CreateConfirmDialog(const ConfirmDialogSetup *setup, u16 frameChar, u8 framePalette, u8 cursorPos,
                                    HeapID heapId);
// Returns 0 for yes and BMPMENU_CANCEL for no or B, freeing the menu, and BMPMENU_NULL until then
u32 ConfirmDialog_Update(BmpMenu *menu);
// Whether the options are printed, copying the window's characters once they are
BOOL ConfirmDialog_IsPrinted(BmpMenu *menu);
void ConfirmDialog_Free(BmpMenu *menu);

#endif // POKEBW2_SYSTEM_BMP_MENU_H
