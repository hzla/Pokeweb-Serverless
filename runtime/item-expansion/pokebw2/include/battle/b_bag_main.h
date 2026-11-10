#ifndef POKEBW2_BATTLE_B_BAG_MAIN_H
#define POKEBW2_BATTLE_B_BAG_MAIN_H

#include "types.h"
#include "battle/b_app_tool.h"
#include "gfl/clact.h"
#include "gfl/heap.h"
#include "save/bag.h"
#include "struct_decls.h"
#include "system/printsys.h"

// The battle bag in overlay 286 (b_bag_main.c, the ROM's embedded string, and the other b_bag_*.c files, named
// after it and Diamond and Pearl's): the bag shown during a battle to use or throw an item, the Wonder Launcher,
// and the catching demo. It sets done when it ends. Every name here is ours; swan has none for this overlay.

// What the battle passes to the bag, 0x44 bytes, inside BtlvCore
typedef struct {
    BagSave *bag;              // 0x00
    Font *font;                // 0x04
    u32 mode;                  // 0x08  0 normal, 1 Wonder Launcher, 2 catching demo, 3 opens on the Poké Balls
    HeapID heapId;             // 0x0c
    const u8 *shooterDisabled; // 0x10  ShooterItem_IsEnabled's bit field
    u8 shooterEnergy;          // 0x14
    u8 shooterSpent;           // 0x15
    u16 item;                  // 0x16  out, 0 for none
    u8 cost;                   // 0x18  out, the item's Launcher cost in mode 1, else 0
    u8 done;                   // 0x19
    void *bagCursor;           // 0x1c  the bag's saved cursor
    BOOL quit;                 // 0x20  1 leaves with the fade
    BOOL abort;                // 0x24  1 leaves at once
    u8 ballError;              // 0x28  0, or 1-5: why a Poké Ball can't be thrown
    u8 isWild;                 // 0x29
    u8 pocket;                 // 0x2a  out, 4 on cancel
    u8 *usingKeys;             // 0x2c
    s16 rows[4];               // 0x30  by pocket, the cursor's row on the item page
    s16 pages[4];              // 0x38  by pocket
    BOOL playSound;            // 0x40  1 plays the sound effects
} BBagParam;

#define BBAG_WINDOW_MAX 35

// The first of each kind of actor in BBagWork's actors
enum {
    BBAG_ACTOR_ITEM = 0,    // 0-5 the page's items, 6 the last used or the chosen item
    BBAG_ACTOR_COST = 7,    // 8 per item slot: the cost, then 7 gauge pips (mode 1)
    BBAG_ACTOR_ENERGY = 55, // 8: the energy left and spent
    BBAG_ACTOR_MAX = 63,
};

// The bag's work, 0x5a4 bytes, shared by the overlay's files
struct BBagWork {
    BBagParam *param;                     // 0x000
    TCBExManager *tcbExMgr;               // 0x004
    PaletteFade *paletteFade;             // 0x008
    MsgData *msgData;                     // 0x00c
    WordSet *wordSet;                     // 0x010
    StrBuf *strBuf;                       // 0x014
    PrintQueue *printQueue;               // 0x018
    PrintStream *printStream;             // 0x01c
    BOOL streamAdvanced;                  // 0x020
    BmpWin *msgWin;                       // 0x024
    PrintWindow windows[BBAG_WINDOW_MAX]; // 0x028
    u8 unk140;                            // 0x140  never accessed
    u8 listBuf;                           // 0x141  0: list windows 5-16, 1: 17-28; flipped per draw
    CursorMove *cursorMove;               // 0x144
    BAppCursor *cursor;                   // 0x148
    BtlvFingerCursor *fingerCursor;       // 0x14c  the catching demo's
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    BagItem *items[4];
    u16 itemCapacity[4];
#else
    BagItem items[4][36]; // 0x150  by battle pocket
#endif
    u8 unk390[0x90];                 // 0x390  never accessed, the size of one more pocket
    ClActUnit *actorUnit;            // 0x420
    ClActor *actors[BBAG_ACTOR_MAX]; // 0x424
    BGWinFrame *buttons;             // 0x520
    u8 animSeq;                      // 0x524
    u8 animCount;                    // 0x525
    u8 animButton;                   // 0x526
    u8 animActive;                   // 0x527
    u8 unk528[8];                    // 0x528  never accessed
    u8 seq;                          // 0x530  the state, 20 ends
    u8 nextSeq;                      // 0x531  taken after the button animation or the message
    u8 page;                         // 0x532  0 pockets, 1 a pocket's items, 2 one item
    u8 pocket;                       // 0x533
    s8 pageStep;                     // 0x534  -1 or 1
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    u16 itemCount[4];
#else
    u8 itemCount[4]; // 0x535
#endif
    u8 lastPage[4];      // 0x539
    u8 demoSeq;          // 0x53d
    u8 unk53E[2];        // 0x53e  never accessed
    u16 lastItem;        // 0x540
    u8 lastPocket;       // 0x542
    u32 charRes[9];      // 0x544
    u32 plttRes[9];      // 0x568
    u32 cellRes[3];      // 0x58c
    BOOL cursorVisible;  // 0x598
    const u8 *flushList; // 0x59c  window indices ending in 0xff
    BOOL initialized;    // 0x5a0
}; // 0x5a4

void BBagMain_Start(BBagParam *param);

#endif // POKEBW2_BATTLE_B_BAG_MAIN_H
