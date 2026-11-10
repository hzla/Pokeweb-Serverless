#ifndef POKEBW2_TWL_MI_H
#define POKEBW2_TWL_MI_H

#include "types.h"

// TwlSDK's memory functions for the DSi's hardware: the shared WRAM B and C, which the DSP needs, and the new DMA
// channels. They are in the LTD autoload. The functions and types have the names of the TWL-SDK Function Reference
// Manual (the public ones: MIWramPos, MINDmaConfig, MI_GetWramBankMaster, MI_GetWramMapStart, MI_AllocWramSlot and the
// NDMA functions), or of libntr's reconstruction of TwlSDK's headers (sharedWram.h, dma.h and the private mi_ndma.h:
// MIi_SetWramBankMaster, MIi_SetWramBankEnable, MI_InitNDma, MIi_NDmaAsync_withConfig_Dev), where the code shows
// them; the ones still named by address are not known.

typedef enum {
    MI_WRAM_A,
    MI_WRAM_B,
    MI_WRAM_C,
} MIWramPos;

typedef enum {
    MI_WRAM_ARM9,
    MI_WRAM_ARM7,
    MI_WRAM_DSP,
} MIWramProc;

typedef enum {
    MI_WRAM_DISABLE = FALSE,
    MI_WRAM_ENABLE = TRUE,
} MIWramEnable;

// A run of banks, in 32 KB units: a bank of WRAM A takes two
typedef enum {
    MI_WRAM_SIZE_0KB,
    MI_WRAM_SIZE_32KB,
    MI_WRAM_SIZE_64KB,
    MI_WRAM_SIZE_96KB,
    MI_WRAM_SIZE_128KB,
    MI_WRAM_SIZE_160KB,
    MI_WRAM_SIZE_192KB,
    MI_WRAM_SIZE_224KB,
    MI_WRAM_SIZE_256KB,
} MIWramSize;

// mi_sharedWram_twl.c: the DSi part of the shared WRAM manager

// The setup of the shared WRAM's manager, which NitroSDK's MI_Init (mi_sharedWram.c's func_02078000) calls on a DSi
void MIi_InitWramManagerCore(void);
// The banks' registers: the processor that each bank is given to and whether it is enabled, by WRAM and for each
void MIi_SetWramBankMaster_A(int bank, MIWramProc proc);
void MIi_SetWramBankMaster_B(int bank, MIWramProc proc);
void MIi_SetWramBankMaster_C(int bank, MIWramProc proc);
void MIi_SetWramBankMaster(MIWramPos wram, int bank, MIWramProc proc);
void MIi_SetWramBankEnable_A(int bank, MIWramEnable enable);
void MIi_SetWramBankEnable_B(int bank, MIWramEnable enable);
void MIi_SetWramBankEnable_C(int bank, MIWramEnable enable);
void MIi_SetWramBankEnable(MIWramPos wram, int bank, MIWramEnable enable);
MIWramProc MI_GetWramBankMaster_A(int bank);
MIWramProc MI_GetWramBankMaster_B(int bank);
MIWramProc MI_GetWramBankMaster_C(int bank);
// The processor that the hardware gives the bank to
MIWramProc MI_GetWramBankMaster(MIWramPos wram, int bank);
// Where each WRAM is in the ARM9's memory, and any of them
u32 MI_GetWramMapStart_A(void);
u32 MI_GetWramMapStart_B(void);
u32 MI_GetWramMapStart_C(void);
u32 MI_GetWramMapStart(MIWramPos wram);
// Frees every bank that proc has, and cancels proc's reservations; each returns how many banks it changed
int MI_FreeWram(MIWramPos wram, MIWramProc proc);
int MI_CancelWram(MIWramPos wram, MIWramProc proc);

// mi_ndma.c: the DSi's four new DMA channels

typedef void (*MINDmaCallback)(void *arg);

// The settings of a channel's transfers: the interval between blocks and its prescaler, the words of a block, and the
// words that a start moves (-1: the whole transfer at once)
typedef struct MINDmaConfig {
    u32 intervalTimer;
    u32 prescaler;
    u32 blockWord;
    u32 wordCount;
} MINDmaConfig;

#define MI_NDMA_MAX_NUM 3

// A register of a channel: the source, the destination, the words of the transfer and of each start, the interval
// between blocks, the data of a fill and the control. The channels' registers are 0x1c bytes apart
#define MI_NDMA_REG(ndmaNo, offset) (*(vu32 *)(0x04004104 + (ndmaNo) * 0x1c + (offset)))
#define MI_NDMA_SAD 0x0
#define MI_NDMA_DAD 0x4
#define MI_NDMA_TCNT 0x8
#define MI_NDMA_WCNT 0xc
#define MI_NDMA_BCNT 0x10
#define MI_NDMA_FDATA 0x14
#define MI_NDMA_CNT 0x18
// The bits of a channel's control
#define MI_NDMA_DEST_FIX (2 << 10)
#define MI_NDMA_DEST_RELOAD (1 << 12)
#define MI_NDMA_SRC_FIX (2 << 13)
#define MI_NDMA_SRC_FILLDATA (3 << 13)
#define MI_NDMA_BWORD_16 (4 << 16)
#define MI_NDMA_TIMING_MASK (0xf << 24)
#define MI_NDMA_TIMING_CARD (4 << 24)
#define MI_NDMA_TIMING_DISP (8 << 24)
#define MI_NDMA_TIMING_DISP_MMEM (9 << 24)
#define MI_NDMA_TIMING_CAMERA (0xb << 24)
#define MI_NDMA_IMM (0x10 << 24)
#define MI_NDMA_CONTINUOUS (1 << 29)
#define MI_NDMA_IF_ENABLE (1 << 30)
#define MI_NDMA_ENABLE (1u << 31)
#define MI_NDMA_ROUND_ROBIN (1u << 31)

// Each channel's settings
extern MINDmaConfig MIi_NDmaConfig[MI_NDMA_MAX_NUM + 1];

// Sets the arbitration between the channels and the default settings of each, which NitroSDK's MI_Init (mi_init.c)
// calls on a DSi
void MI_InitNDma(void);
// The NDMA fills and copies, each without a callback and then with one and its argument, and the wait for a channel to
// be done, which GX's loaders use for the DSi's channels; the linker reaches them through veneers
void MI_NDmaFill(u32 ndmaNo, void *dest, u32 data, u32 size);
void MI_NDmaCopy(u32 ndmaNo, const void *src, void *dest, u32 size);
void MI_NDmaFillAsync(u32 ndmaNo, void *dest, u32 data, u32 size, MINDmaCallback callback, void *arg);
void MI_NDmaCopyAsync(u32 ndmaNo, const void *src, void *dest, u32 size, MINDmaCallback callback, void *arg);
BOOL MI_IsNDmaBusy(u32 ndmaNo);
void MI_WaitNDma(u32 ndmaNo);
void MI_StopNDma(u32 ndmaNo);
// Stops the four channels, which OS_ResetSystem, the card's pull-out and PM_ForceToPowerOff do on a DSi
void MI_StopAllNDma(void);
void MI_SetNDmaArbitrament(u32 mode, u32 cycle);
void MI_InitNDmaConfig(void);
void MI_GetNDmaConfig(u32 ndmaNo, MINDmaConfig *config);
// The kinds of transfer, which give the address modes (mi_ndma.c's MIi_GetNDmaModeBits)
typedef enum {
    MIi_NDMA_TYPE_FILL = 0,
    MIi_NDMA_TYPE_COPY = 1,
    MIi_NDMA_TYPE_SEND = 2,
    MIi_NDMA_TYPE_RECV = 3,
    MIi_NDMA_TYPE_PIPE = 4,
    MIi_NDMA_TYPE_HBLANK = 5,
    MIi_NDMA_TYPE_HBLANK_IF = 6,
    MIi_NDMA_TYPE_MMCOPY = 7,
    MIi_NDMA_TYPE_GXCOPY = 8,
    MIi_NDMA_TYPE_GXCOPY_IF = 9,
    MIi_NDMA_TYPE_CAMERACONT = 10,
} MIiNDmaType;

// The start of a transfer: the MI_NDMA_TIMING_* bits, or -1 for at once
typedef u32 MINDmaDevice;

// The transfer under all of the asynchronous NDMA functions, which mi_ndma_gxcommand.c also calls: a fill of data or a
// copy, by the address modes of ndmaType, started at dev with the channel's settings in config
void MIi_NDmaAsync_withConfig_Dev(MIiNDmaType ndmaType, u32 ndmaNo, const void *src, void *dest, u32 data, u32 size,
                                  MINDmaCallback callback, void *arg, const MINDmaConfig *config, MINDmaDevice dev,
                                  u32 enable);

// The transfer started at once with the channel's own settings
static inline void MIi_NDmaAsync(MIiNDmaType ndmaType, u32 ndmaNo, const void *src, void *dest, u32 data, u32 size,
                                 MINDmaCallback callback, void *arg, u32 enable) {
    MIi_NDmaAsync_withConfig_Dev(ndmaType, ndmaNo, src, dest, data, size, callback, arg, &MIi_NDmaConfig[ndmaNo],
                                 (u32)-1, enable);
}
// The card's reads by NDMA: one word at each request of the card, from its data register, until the card's transfer
// ends. The second is the one that CARDi_NdmaInterface gives the card library
void MIi_StartCardNDma(u32 ndmaNo, const void *src, void *dest);
void MI_Card_NDmaCopy(u32 ndmaNo, const void *src, void *dest, u32 size);
// Receives a camera frame by NDMA, CAMERA_DmaRecvAsync's body: unitWords words at each request of the camera, again
// and again if continuous
void MI_Camera_NDmaRecvAsync(u32 ndmaNo, void *dest, u32 unitWords, u32 length, BOOL continuous,
                             MINDmaCallback callback, void *arg);

// NitroSDK's MI_SendGXCommandAsync and MI_SendGXCommandAsyncFast for the new DMA channels, which NitroSystem G3D's
// NNS_G3dGeSendDL uses for GX's channels above 3, by the names of the manual (MI_SendNDmaGXCommand) and libntr's dma.h
void MI_SendNDmaGXCommandAsync(u32 ndmaNo, const void *src, u32 length, MINDmaCallback callback, void *arg);
void MI_SendNDmaGXCommandAsyncFast(u32 ndmaNo, const void *src, u32 length, MINDmaCallback callback, void *arg);

// The banks of the shared WRAM A, B and C go from one processor to another by their slots. One byte per bank of WRAM
// A: its master, and the slot it has in the master's memory. WRAM B's and C's follow
#define reg_MBK_A ((vu8 *)0x04004040)
#define reg_MBK_B ((vu8 *)0x04004044)
#define reg_MBK_C ((vu8 *)0x0400404c)
// Whether the manager has given the bank to a processor
BOOL MI_IsWramSlotUsed(MIWramPos wram, int slot);
// Gives the count banks from slot to proc if they are free, and returns their address (0 if not)
u32 MI_AllocWramSlot(MIWramPos wram, int slot, MIWramSize size, MIWramProc proc);
// Takes the banks back from proc, and returns how many it had
int MI_FreeWramSlot(MIWramPos wram, int slot, MIWramSize size, MIWramProc proc);

#endif // POKEBW2_TWL_MI_H
