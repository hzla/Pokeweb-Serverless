#ifndef POKEBW2_GFL_BG_SYS_H
#define POKEBW2_GFL_BG_SYS_H

#include "types.h"
#include "gfl/heap.h"
#include "nitro/fx.h"
#include "nitro/gx.h"
#include "struct_decls.h"

// The BG system: the eight BGs of the two engines, their screen buffers, and the characters allocated in each
// engine's BG VRAM. BGs 0 to 3 are the main engine's and 4 to 7 the sub engine's. It grew out of Gen 4's BG code,
// pokeplatinum's bg_window.c, without the BgConfig that each function took.

// The BG system's setups. Names and layouts from swan (https://github.com/ds-pokemon-hacking/swan, GPL-3.0)

// BG sizes in pixels
#define BGRES_128x128 0
#define BGRES_256x256 1
#define BGRES_256x512 2
#define BGRES_512x256 3
#define BGRES_512x512 4
#define BGRES_1024x1024 5

// A text BG has a screen of 16-bit map entries. An affine BG has 8-bit entries, and an extended BG is an affine BG
// with 16-bit entries
#define BGMODE_TEXT 0
#define BGMODE_AFFINE 1
#define BGMODE_EXTENDED 2

#define BG_MOVE_SET_X 0
#define BG_MOVE_RIGHT 1
#define BG_MOVE_LEFT 2
#define BG_MOVE_SET_Y 3
#define BG_MOVE_DOWN 4
#define BG_MOVE_UP 5

typedef struct {
    u32 x;
    u32 y;
    u32 screenSize;
    u32 screenOffset;
    u8 resolution;
    u8 colorMode;
    u8 screenBase;
    u8 charBase;
    u32 charSize;
    u8 extPaletteSlot;
    u8 priority;
    u8 areaOverflow;
    u32 mosaic;
} BGSetup;

typedef struct {
    u32 displayMode;
    u32 bgModeMain;
    u32 bgModeSub;
    BOOL bg0Is3D;
} BGSysLCDConfig;

enum {
    BGSYS_ENGINE_MAIN,
    BGSYS_ENGINE_SUB,
};

// The rest are ours

#define BGSYS_BG_COUNT 8
// The first BG of the sub engine
#define BGSYS_BG_SUB 4

// The size of a character in bytes
#define BGSYS_TILE_SIZE_16 0x20
#define BGSYS_TILE_SIZE_256 0x40

// Changes to an affine BG's transform, continuing the BG_MOVE_* values
#define BG_ROTATE_SET 0
#define BG_ROTATE_ADD 1
#define BG_ROTATE_SUB 2
#define BG_SCALE_SET_X 3
#define BG_SCALE_ADD_X 4
#define BG_SCALE_SUB_X 5
#define BG_SCALE_SET_Y 6
#define BG_SCALE_ADD_Y 7
#define BG_SCALE_SUB_Y 8
#define BG_CENTER_SET_X 9
#define BG_CENTER_ADD_X 10
#define BG_CENTER_SUB_X 11
#define BG_CENTER_SET_Y 12
#define BG_CENTER_ADD_Y 13
#define BG_CENTER_SUB_Y 14

// The palette argument of GFL_BGSysFillScrArea, other than a palette number: keep each entry's palette, or take it
// from the tile
#define BGSYS_FILL_KEEP_PALETTE 16
#define BGSYS_FILL_TILE_PALETTE 17

void GFL_BGSysCreate(HeapID heapId);
void GFL_BGSysFree(void);
// Allocates characters of a BG for size bytes, searching from the start or the end of its characters, and returns
// the first character, or AREAMAN_FAIL. GFL_BGSysAllocCharAt marks characters as allocated
u32 GFL_BGSysAllocChar(u32 bg, u32 size, u32 fromEnd);
BOOL GFL_BGSysAllocCharAt(u32 bg, u32 pos, u32 size);
void GFL_BGSysFreeCharMemory(u32 bg, u32 pos, u32 size);
void GFL_BGSysSetLCDConfig(const BGSysLCDConfig *config);
// Sets only the modes of one engine from a config: the display mode, main BG mode and BG 0 of the main engine, or the
// BG mode of the sub engine
void GFL_BGSysSetLCDConfigForEngine(const BGSysLCDConfig *config, u32 engine);
void GFL_BGSysCreateBG(u8 bg, const BGSetup *setup, u8 mode);
void GFL_BGSysReleaseBG(u8 bg);
// Enables BG 0 of the main engine, where the 3D is drawn, and sets its priority
void GFL_BGSysSet3DBGPriority(u16 priority);
void GFL_BGSysSetBGPriority(u8 bg, u8 priority);
void GFL_BGSysSetBGEnabled(u8 bg, u8 enabled);
// Moves a BG now, with a BG_MOVE_* change, or at the next update
void GFL_BGSysMoveBG(u8 bg, u8 op, int value);
void GFL_BGSysMoveBGReq(u8 bg, u32 op, int value);
int GFL_BGSysGetBGOffsetX(u32 bg);
int GFL_BGSysGetBGOffsetY(u32 bg);
// Sets the matrix and center of an affine BG, after moving it
void GFL_BGSysSetBGTransformEx(u8 bg, u32 op, int value, const MtxFx22 *mtx, int centerX, int centerY);
void GFL_BGSysSetBGTransform(u8 bg, const MtxFx22 *mtx, int centerX, int centerY);
// Change an affine BG's transform at the next update, with a BG_ROTATE_*, BG_SCALE_* or BG_CENTER_* change
void GFL_BGSysRotateBGReq(u8 bg, u32 op, u16 value);
void GFL_BGSysScaleBGReq(u8 bg, u32 op, fx32 value);
void GFL_BGSysAdjustBGOriginReq(u8 bg, u32 op, int value);
// Loads a BG's screen buffer to VRAM now, or at the next update
void GFL_BGSysLoadScr(u8 bg);
void GFL_BGSysQueueScrLoad(u8 bg);
// Loads a screen to VRAM at offset map entries. A size of 0 means the data is compressed, and then it goes through
// the BG's screen buffer if it has one
void GFL_BGSysLoadScrCore(u8 bg, const void *src, u32 size, u32 offset);
// Copy a screen to a BG's screen buffer, at offset map entries. A size of 0 means the data is compressed
void GFL_BGSysBufferScrDefault(u8 bg, const void *src, u32 size);
void GFL_BGSysBufferScr(u8 bg, const void *src, u32 size, u32 offset);
// Loads characters to a BG at a character offset, or to characters it allocates, returning the first. A size of 0
// means the data is compressed
void GFL_BGSysLoadChar(u8 bg, const void *src, u32 size, u32 offset);
u32 GFL_BGSysLoadCharDynamic(u32 bg, const void *src, u32 size);
// Clears size bytes of a BG's characters from a byte offset
void GFL_BGSysClearCharCore(u8 bg, u32 size, u32 offset, HeapID heapId);
// Fills tileCount characters from offset of a BG with a color index, and allocates them, or frees them
void GFL_BGSysFillChar(u32 bg, u32 fillIndex, u32 tileCount, u32 offset);
void GFL_BGSysFreeFilledChar(u32 bg, u32 tileCount, u32 offset);
// Loads colors to the standard BG palette of a BG's engine
void GFL_BGSysUploadStdPalette(u8 bg, const void *src, u16 size, u16 offset);
// Sets the backdrop color, the first of a BG's engine's palette
void GFL_BGSysResetStdPalette(u8 bg, GXRgb color);
// Copy a rectangle of map entries to a BG's screen buffer. The source is width by height entries, or srcWidth by
// srcHeight entries from which GFL_BGSysLoadScrArea takes the rectangle at srcX and srcY. GFL_BGSysLoadScrAreaLarge
// takes it from a source of 32x32 blocks, as a screen of a size above 256x256 is stored
void GFL_BGSysLoadScrAreaAll(u8 bg, const void *src, u8 x, u8 y, u8 width, u8 height);
void GFL_BGSysLoadScrArea(u8 bg, u8 x, u8 y, u8 width, u8 height, const void *src, u8 srcX, u8 srcY, u8 srcWidth,
                          u8 srcHeight);
void GFL_BGSysLoadScrAreaLarge(u8 bg, u8 x, u8 y, u8 width, u8 height, const void *src, u8 srcX, u8 srcY, u8 srcWidth,
                               u8 srcHeight);
// Fills a rectangle of a BG's screen buffer with a tile, with a palette or BGSYS_FILL_*
void GFL_BGSysFillScrArea(u8 bg, u16 tile, u8 x, u8 y, u8 width, u8 height, u8 palette);
void GFL_BGSysSetScrPaletteNo(u8 bg, u8 x, u8 y, u8 width, u8 height, u8 palette);
void GFL_BGSysClearBG(u8 bg);
void GFL_BGSysClearChar(u8 bg);
void GFL_BGSysClearScr(u8 bg);
// Fills a BG's whole screen with a map entry, loaded now or at the next update
void GFL_BGSysFillScr(u8 bg, u16 map);
void GFL_BGSysFillScrAsync(u8 bg, u16 map);
void *GFL_BGSysGetBGCharAddress(u8 bg);
// Returns the BG's screen buffer, or NULL
void *GFL_BGSysIsScrHeapExists(u8 bg);
int GFL_BGSysGetBGOffsetX2(u8 bg);
int GFL_BGSysGetBGOffsetY2(u8 bg);
u8 GFL_BGSysGetBGMode(u8 bg);
u8 GFL_BGSysGetBGColorPaletteMode(u8 bg);
u8 GFL_BGSysGetBGBytesPerTile(u8 bg);
u8 GFL_BGSysGetBGPriority(u8 bg);
// Sends the moves and screen loads requested since the last update
void GFL_BGSysUpdate(void);
// Whether the pixel at x and y of a BG has one of the colors of a list: a bit mask of color indexes for 16 colors,
// or a list of indexes that ends with 0xffff for 256 colors, which loops forever unless the first is a match
BOOL GFL_BGSysIsPixelOfColor(u8 bg, u16 x, u16 y, const u16 *colors);
// Sets the map entry of a tile of a BG's screen buffer
void GFL_BGSysSetScrTile(u32 bg, u32 x, u32 y, u16 map);

#endif // POKEBW2_GFL_BG_SYS_H
