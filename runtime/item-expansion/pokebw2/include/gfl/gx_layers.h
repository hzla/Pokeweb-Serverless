#ifndef POKEBW2_GFL_GX_LAYERS_H
#define POKEBW2_GFL_GX_LAYERS_H

#include "types.h"

// The display layer: the VRAM banks, which BGs and OBJs of each engine are shown, and which engine drives which
// screen. The game names none of its files, so it is named after pokeplatinum's gx_layers.c, the same code in Gen 4

// The VRAM banks of each kind of data. Layout from swan (https://github.com/ds-pokemon-hacking/swan, GPL-3.0)
typedef struct {
    u32 bgMain;
    u32 bgExtPaletteMain;
    u32 bgSub;
    u32 bgExtPaletteSub;
    u32 objMain;
    u32 objExtPaletteMain;
    u32 objSub;
    u32 objExtPaletteSub;
    u32 texture;
    u32 texturePalette;
    u32 objMappingMain;
    u32 objMappingSub;
} BGSysVRAMConfig;

// Clears VRAM other than the given banks, and the OAM and palettes of both engines
void GFL_BGSysInitVRAM(u32 banks);
void GFL_BGSysSetVRAMBanks(const BGSysVRAMConfig *config);
// Hide the BGs, the OBJs or both of the main engine, at the next change of the planes shown
void GFL_BGSysDisableBGsA(void);
void GFL_BGSysDisableOBJA(void);
void GFL_BGSysDisableAllA(void);
// Shows or hides the planes of GX_PLANEMASK on the main engine, or sets which are shown
void GFL_BGSysSetBGEnabledA(u32 planes, BOOL enabled);
void GFL_BGSysSetEnabledBGsA(u32 enabled);
// The same for the sub engine
void GFL_BGSysDisableBGsB(void);
void GFL_BGSysDisableOBJB(void);
void GFL_BGSysDisableAllB(void);
void GFL_BGSysSetBGEnabledB(u32 planes, BOOL enabled);
void GFL_BGSysSetEnabledBGsB(u32 enabled);
// Turns on the output of both engines
void GFL_BGSysEnableEngines(void);
// Sets which engine drives the top screen, GX_DISP_SELECT_*
void GFL_BGSysSetDisplayLayout(u32 layout);
u32 GFL_BGSysGetEnabledBGsA(void);
u32 GFL_BGSysGetEnabledBGsB(void);

#endif // POKEBW2_GFL_GX_LAYERS_H
