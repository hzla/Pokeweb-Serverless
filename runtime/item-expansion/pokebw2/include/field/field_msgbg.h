#ifndef POKEBW2_FIELD_FIELD_MSGBG_H
#define POKEBW2_FIELD_FIELD_MSGBG_H

#include "types.h"
#include "gfl/g3d.h"
#include "gfl/heap.h"
#include "nitro/fx.h"
#include "struct_decls.h"
#include "system/bmp_menulist.h"
#include "system/printsys.h"

// The field's message BG (field_msgbg.c, overlay 36): the two BGs the field prints its messages on, and the windows,
// list menus, message balloons over actors and wait-for-input cursors on them. The talk windows of talkmsgwin.h draw
// the balloons and the windows framed like them. Existing names are from swan
// (https://github.com/ds-pokemon-hacking/swan, GPL-3.0); the CheckerMsgWin API names
// are our descriptive guesses.

// A list menu's layout. ListMenuRequest_Set completes it with the number of options, the position and the size, which
// CalcListMenuWidth and CalcListMenuHeight give in tiles. The fields up to rowHeight are BmpMenuListHeader's
typedef struct {
    u16 count;
    u16 maxShown;
    u8 labelX;
    u8 itemX;
    u8 cursorX;
    u8 listY : 4;
    u8 fgColor : 4;
    u8 bgColor : 4;
    u8 shadowColor : 4;
    u16 letterSpacing : 3;
    u16 lineSpacing : 4;
    u16 unk0A_7 : 9;
    s32 pageSkip : 2;
    u16 fontSizeX;
    // The height of a row, in pixels
    u16 rowHeight;
    u16 x;
    u16 y;
    u16 width;
    u16 height;
    BmpMenuListPrintCallback printCallback;
} ListMenuRequest;

// A row of a list menu that func_ov036_02187f0c makes: its message, and the value the menu returns when it is chosen.
// The Union Room's menus return the rows of the menu that a row opens
typedef struct ListMenuRow {
    u32 messageId;
    union {
        s32 value;
        const struct ListMenuRow *sub;
    };
} ListMenuRow;

// What func_ov036_0218816c returns for the yes/no menu: the answer, which is no when the menu is cancelled, or WAITING
enum {
    MSGBG_YES_NO_YES,
    MSGBG_YES_NO_NO,
    MSGBG_YES_NO_WAITING,
};

// The message balloons over actors, which ActorMsgWin_CheckAndCreate takes as its type: across the top or the bottom
// of the screen, or where the actor leaves room. Each is the talk window of its index
enum {
    ACTOR_MSG_WIN_TOP,
    ACTOR_MSG_WIN_BOTTOM,
    ACTOR_MSG_WIN_AUTO,
    ACTOR_MSG_WIN_COUNT,
};

// Creates the system, sets up its BGs, either with the talk windows' textures or loading them in a VBlank task, loads
// the frames' characters and palettes to a BG, all at once or one step at a time, and frees the system
FieldMsgBG *CreateFieldMsgBGSystem(HeapID heapId, G3DCamera *camera);
void func_ov036_02187760(FieldMsgBG *sys);
void func_ov036_0218776c(FieldMsgBG *sys);
void func_ov036_02187794(u32 bg, HeapID heapId);
void func_ov036_0218779c(FieldMsgBG *sys, u32 step);
void func_ov036_021877ac(FieldMsgBG *sys);
// Frees the talk windows and the first BG while an app uses the screen, releases the second BG (returning whether it
// had one), and sets up the first again, with the textures loaded in a VBlank task, and whether that task has finished
void func_ov036_02187834(FieldMsgBG *sys);
BOOL func_ov036_02187868(FieldMsgBG *sys);
void func_ov036_02187888(FieldMsgBG *sys);
BOOL func_ov036_021878bc(FieldMsgBG *sys);
// Once a frame: prints the queued messages and runs the windows; then draws the talk windows
void func_ov036_021878d0(FieldMsgBG *sys);
void func_ov036_0218796c(FieldMsgBG *sys);
// Clears the print queue, whether it has printed everything, the queue, and the font
void func_ov036_02187980(FieldMsgBG *sys);
BOOL func_ov036_0218798c(FieldMsgBG *sys);
PrintQueue *func_ov036_02187998(FieldMsgBG *sys);
Font *func_ov036_0218799c(FieldMsgBG *sys);
// Loads a file of the system messages, and frees it
MsgData *func_ov036_021879a0(FieldMsgBG *sys, u32 fileId);
void func_ov036_021879b8(MsgData *msgData);
// Sets up the second BG again before the next window on it
void func_ov036_021879c0(FieldMsgBG *sys);
// Whether the messages advance on their own, without the A or B button
void func_ov036_021879cc(FieldMsgBG *sys, BOOL enable);

// The money window, framed on the second BG: create, free, print a message of its message data, a string, or a string
// in a color and a font, whether it has printed, clear all or an area, and its bitmap window
MoneyWin *FieldMsgBG_CreateMoneyWin(FieldMsgBG *sys, MsgData *msgData, u16 x, u16 y, u16 width, u16 height);
void func_ov036_02187c1c(MoneyWin *win);
void func_ov036_02187c34(MoneyWin *win, u16 x, u16 y, u32 messageId);
void func_ov036_02187c4c(MoneyWin *win, u16 x, u16 y, StrBuf *strbuf);
void func_ov036_02187c58(MoneyWin *win, u16 x, u16 y, StrBuf *strbuf, u16 color, Font *font);
BOOL func_ov036_02187c70(MoneyWin *win);
void func_ov036_02187c7c(MoneyWin *win);
void func_ov036_02187c88(MoneyWin *win, u32 x, u32 y, u32 width, u32 height);
BmpWin *func_ov036_02187c9c(MoneyWin *win);
// The list window, with the frame of the system message window: create, free, print a string, and clear
MoneyWin *func_ov036_02187ca0(FieldMsgBG *sys, MsgData *msgData, u16 x, u16 y, u16 width, u16 height);
void func_ov036_02187d10(MoneyWin *win);
void func_ov036_02187d28(MoneyWin *win, u16 x, u16 y, StrBuf *strbuf);
void func_ov036_02187d38(MoneyWin *win);

// A list menu on the second BG: create, with a callback that prints each option or with the request's, or one that
// can't be cancelled, free it with its options, update (BMPMENULIST_NULL until an option is chosen or the menu is
// cancelled), and redraw
ListMenuUI *func_ov036_02187e1c(FieldMsgBG *sys, const ListMenuRequest *request, ListMenuOption *options, u16 listTop,
                                u16 cursorRow, BmpMenuListCursorCallback cursorCallback,
                                BmpMenuListPrintCallback printCallback, void *work);
ListMenuUI *func_ov036_02187e60(FieldMsgBG *sys, const ListMenuRequest *request, ListMenuOption *options);
ListMenuUI *ListMenuUI_Create(FieldMsgBG *sys, ListMenuRequest *request, ListMenuOption *options,
                              BmpMenuListCursorCallback callback, void *work, u16 listTop, u16 cursorRow,
                              u32 cancelable);
void func_ov036_02187ea0(ListMenuUI *menu);
s32 ListMenuUI_Update(ListMenuUI *menu);
void func_ov036_02187ef8(ListMenuUI *menu);
// The menu's options: allocate them, add the rows' messages, add a string, free the strings, and count them
ListMenuOption *InitListMenuOptionHeap(u32 count, HeapID heapId);
ListMenuOption *func_ov036_02187f0c(const ListMenuRow *rows, s32 count, MsgData *msgData, HeapID heapId);
void AppendListMenuOption(ListMenuOption *options, StrBuf *text, u32 value, HeapID heapId);
void func_ov036_02187f50(ListMenuOption *options);
u32 ListMenuCore_GetOptionCount(ListMenuOption *options);
// The width and the height in tiles of a menu of the options
u32 CalcListMenuWidth(FieldMsgBG *sys, ListMenuOption *options, u32 fontSizeX, u32 letterSpacing);
u32 CalcListMenuHeight(u32 rows, u32 rowHeight, u32 lineSpacing, BOOL scrolls);
void ListMenuRequest_Set(ListMenuRequest *request, u16 count, u16 x, u16 y, u16 width, u16 height);
// Draws the frame of the system message window around the menu
void func_ov036_02188008(ListMenuUI *menu);
// The yes/no menu, with the cursor on a row, and its answer (MSGBG_YES_NO_)
ListMenuUI *func_ov036_021880d4(FieldMsgBG *sys, u32 cursorRow);
u32 func_ov036_0218816c(ListMenuUI *menu);

// The talk window across the bottom of the screen, on the second BG: free, print a message of its message data or a
// string a character at a time, update it (TRUE once printed), create, clear, and its bitmap window
void func_ov036_02188338(FieldMsgWin *win);
void func_ov036_0218836c(FieldMsgWin *win, u16 x, u16 y, u32 messageId);
void func_ov036_021883b0(FieldMsgWin *win, u16 x, u16 y, StrBuf *strbuf);
BOOL func_ov036_021883e8(FieldMsgWin *win);
FieldMsgWin *func_ov036_0218845c(FieldMsgBG *sys, MsgData *msgData);
void func_ov036_02188474(FieldMsgWin *win);
BmpWin *func_ov036_02188494(FieldMsgWin *win);
// The system message window at a row of the screen, with the list window's frame: create, free, print a message or a
// string a character at a time, update it (TRUE once printed), draw the wait-for-input cursor, clear, print a string at
// once, and its bitmap window
FieldMsgWin *func_ov036_02188498(FieldMsgBG *sys, MsgData *msgData, u32 y);
void func_ov036_02188504(FieldMsgWin *win);
void func_ov036_02188538(FieldMsgWin *win, u16 x, u16 y, u32 messageId);
void func_ov036_02188580(FieldMsgWin *win, u16 x, u16 y, StrBuf *strbuf);
BOOL func_ov036_021885bc(FieldMsgWin *win);
void func_ov036_02188630(FieldMsgWin *win);
void func_ov036_02188660(FieldMsgWin *win);
void func_ov036_02188680(FieldMsgWin *win, u16 x, u16 y, StrBuf *strbuf);
BmpWin *func_ov036_021886b0(FieldMsgWin *win);

// A message balloon over an actor at pos, of an ACTOR_MSG_WIN_ type: create it, or NULL when that one is in use, close
// it, whether it has closed, free it at once, print another string in it, update it (TRUE once printed), and draw the
// wait-for-input cursor. A frameType is a TALKMSG_WIN_FRAME_ style; the spiky one shakes as it opens
ActorMsgWin *ActorMsgWin_CheckAndCreate(FieldMsgBG *sys, s32 type, const VecFx32 *pos, StrBuf *strbuf, u32 frameType,
                                        u32 tailBase);
void func_ov036_021887d4(ActorMsgWin *win);
BOOL func_ov036_021887f4(ActorMsgWin *win);
void func_ov036_02188818(ActorMsgWin *win);
void func_ov036_02188844(ActorMsgWin *actorWin, StrBuf *strbuf);
BOOL func_ov036_02188884(ActorMsgWin *actorWin);
void func_ov036_021889c8(ActorMsgWin *actorWin);

// The info window, framed like the talk windows: create, free, clear, clear its frame, print a message of its message
// data, a string or a string in a color at once, or a string a character at a time, update it (TRUE once printed), draw
// the wait-for-input cursor, and its print stream's state (PRINT_STREAM_), which fld_faceup.c moves a mouth with
InfoMsgWin *func_ov036_02188a54(FieldMsgBG *sys, MsgData *msgData, u32 frameType, u16 x, u16 y, u16 width, u16 height);
void func_ov036_02188ab0(InfoMsgWin *win);
void func_ov036_02188ae8(InfoMsgWin *win);
void func_ov036_02188b08(InfoMsgWin *win);
void func_ov036_02188b18(InfoMsgWin *win, u16 x, u16 y, u32 messageId);
void func_ov036_02188b44(InfoMsgWin *win, u16 x, u16 y, StrBuf *strbuf);
void func_ov036_02188b70(InfoMsgWin *win, u16 x, u16 y, StrBuf *strbuf, u16 color);
void func_ov036_02188ba4(InfoMsgWin *win, u16 x, u16 y, StrBuf *strbuf);
BOOL func_ov036_02188bdc(InfoMsgWin *win);
void func_ov036_02188c90(InfoMsgWin *win);
u32 func_ov036_02188cbc(InfoMsgWin *win);

// The size in tiles of a window for a message
void CalcMsgWindowDimensions(FieldMsgBG *sys, StrBuf *str, u8 *width, u8 *height);
// The numbered talk windows, up to eight, each with a user's ID: create one with a message or a string, the latter in
// a frame style (TALKMSG_WIN_FRAME_), close the user's, close all, and whether any is open
void func_ov036_02188d6c(FieldMsgBG *sys, MsgData *msgData, u32 msgId, u16 userId, u8 x, u8 y, u8 width, u8 height);
void func_ov036_02188ddc(FieldMsgBG *sys, StrBuf *strbuf, u16 userId, u8 x, u8 y, u8 width, u8 height);
void func_ov036_02188dfc(FieldMsgBG *sys, StrBuf *strbuf, u16 userId, u8 x, u8 y, u8 width, u8 height, u32 frameType);
void func_ov036_02188e90(FieldMsgBG *sys, u16 userId);
void func_ov036_02188e9c(FieldMsgBG *sys);
BOOL func_ov036_02188ed0(FieldMsgBG *sys);

// The sign window in one of four styles, which scrolls in from below: create it with the system's font or another,
// free it, and print, which returns TRUE once the player has read every page
SignMsgWin *func_ov036_02188f28(FieldMsgBG *sys, u16 style);
SignMsgWin *func_ov036_02188f34(FieldMsgBG *sys, u16 style, Font *font);
void func_ov036_0218903c(SignMsgWin *win);
BOOL func_ov036_02189110(SignMsgWin *win, StrBuf *text);

// The checker window draws its frame in its own bitmap. Position and dimensions are in tiles;
// style is retained by the interface but does not change the frame.
CheckerMsgWin *CheckerMsgWin_Create(FieldMsgBG *sys, u16 style, u16 x, u16 y, u16 width, u16 height);
void CheckerMsgWin_Free(CheckerMsgWin *win);
// Prints every line immediately at pixel coordinates.
void CheckerMsgWin_PrintStrBuf(CheckerMsgWin *win, u16 x, u16 y, StrBuf *text);
// Returns TRUE for newly pressed A/B; otherwise advances the wait-for-input cursor.
BOOL CheckerMsgWin_Update(CheckerMsgWin *win);
// Returns the required width or height in tiles; margin is in pixels on each side.
u32 CheckerMsgWin_CalcWidth(FieldMsgBG *sys, StrBuf *str, u32 margin);
u32 CheckerMsgWin_CalcHeight(FieldMsgBG *sys, StrBuf *str, u32 margin);

// A wait-for-input cursor: create, free, and draw its next frame in a bitmap over the color
MsgBGCursor *func_ov036_02189cb0(FieldMsgBG *sys);
void func_ov036_02189cd8(MsgBGCursor *cursor);
void func_ov036_02189de8(MsgBGCursor *cursor, GFLBitmap *bitmap, u32 color);

// Blends the second BG over the others when on is TRUE
void setAlphaBlend_wrapper(BOOL on);
// Loads the first BG's frames again, and the talk windows'
void func_ov036_0218a5a0(FieldMsgBG *sys);

#endif // POKEBW2_FIELD_FIELD_MSGBG_H
