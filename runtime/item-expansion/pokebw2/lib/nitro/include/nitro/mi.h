#ifndef POKEBW2_NITRO_MI_H
#define POKEBW2_NITRO_MI_H

#include "types.h"

#define reg_MI_EXMEMCNT (*(vu16 *)0x04000204)
#define REG_MI_EXMEMCNT_EP_MASK 0x8000
#define REG_MI_EXMEMCNT_EP_SHIFT 15

// The shared WRAM's bank control: which processor gets which half of it
#define reg_GX_VRAMCNT_WRAM (*(vu8 *)0x04000247)

// Who gets the shared WRAM's two 16 KiB halves: the ARM7 gets those that the ARM9 doesn't
typedef enum {
    MI_WRAM_ARM9_ALL,
    MI_WRAM_1616_1,
    MI_WRAM_1616_2,
    MI_WRAM_ARM7_ALL,
} MIWram;

// On a DSi, sets up TwlSDK's shared WRAM manager, which is in the LTD autoload (MIi_InitWramManagerCore). OS_Init calls
// it
void func_02078000(void);
void MI_SetWramBank(MIWram bank);
// NitroSDK's MI_Init: gives the shared WRAM to the ARM7, sets up the new DMA on a DSi and stops DMA channel 0. OS_Init
// calls it
void MI_Init(void);

// The DMA channels: three words each, the source and destination addresses and the control word
#define REG_DMA0SAD_ADDR 0x040000b0
#define REG_GXFIFO_ADDR 0x04000400

typedef struct MIDmaRegs {
    vu32 src;
    vu32 dest;
    vu32 cnt;
} MIDmaRegs;

#define MI_DMA_REGS ((MIDmaRegs *)REG_DMA0SAD_ADDR)
// The highest DMA channel number
#define MI_DMA_MAX_NUM 3

// The bits of a DMA control word
#define MI_DMA_ENABLE 0x80000000
#define MI_DMA_IF_ENABLE 0x40000000
#define MI_DMA_TIMING_MASK 0x38000000
#define MI_DMA_TIMING_IMM 0x00000000
#define MI_DMA_TIMING_V_BLANK 0x08000000
#define MI_DMA_TIMING_H_BLANK 0x10000000
#define MI_DMA_TIMING_DISP 0x18000000
#define MI_DMA_TIMING_DISP_MMEM 0x20000000
#define MI_DMA_TIMING_CARD 0x28000000
#define MI_DMA_TIMING_CARTRIDGE 0x30000000
#define MI_DMA_TIMING_GXFIFO 0x38000000
#define MI_DMA_CONTINUOUS_ON 0x02000000
#define MI_DMA_32BIT_BUS 0x04000000
#define MI_DMA_SRC_INC 0x00000000
#define MI_DMA_SRC_DEC 0x00800000
#define MI_DMA_SRC_FIX 0x01000000
#define MI_DMA_DEST_INC 0x00000000
#define MI_DMA_DEST_DEC 0x00200000
#define MI_DMA_DEST_FIX 0x00400000

// What MIi_DmaSetParameters does besides writing the three registers (TwlSDK's name, in ITCM; swan's dma_beginSyncEx):
// - NO_INTR: leaves interrupts as they are, where it would disable them while it writes
// - WAIT: reads DMA0's source register back twice, so that the CPU has waited for a transfer that it started, and
//   unless NO_DMA0_FIX, gives DMA0 a dummy transfer of one word afterwards
// - FILL32 and FILL16: src is the word or the halfword to fill with, which goes to the channel's clear data register
//   (0x040000e0 plus four bytes a channel) in place of the source address
#define MI_DMA_SET_NO_INTR 0x01
#define MI_DMA_SET_WAIT 0x02
#define MI_DMA_SET_NO_DMA0_FIX 0x04
#define MI_DMA_SET_FILL32 0x10
#define MI_DMA_SET_FILL16 0x20

typedef void (*MIDmaCallback)(void *arg);

// Writes a channel's source, destination and control. In ITCM
void MIi_DmaSetParameters(u32 dmaNo, u32 src, u32 dest, u32 ctrl, u32 flags);

// NitroSDK's MIi_DmaFill32, which fills size bytes with a word by DMA, starting it at once if dmaEnable. swan calls it
// dma_fill
void MIi_DmaFill32(u32 dmaNo, void *dest, u32 data, u32 size, BOOL dmaEnable);
// NitroSDK's MIi_DmaCopy32, which copies size bytes by DMA, starting it at once if dmaEnable
void MIi_DmaCopy32(u32 dmaNo, const void *src, void *dest, u32 size, BOOL dmaEnable); // swan's dma_copy
// NitroSDK's MIi_DmaCopy16: the same a halfword at a time
void MIi_DmaCopy16(u32 dmaNo, const void *src, void *dest, u32 size, BOOL dmaEnable);
// NitroSDK's MIi_DmaFill32Async and MIi_DmaCopy32Async: callback is called when the transfer is done, or at once when
// size is 0
// swan's dma_fillEx
void MIi_DmaFill32Async(u32 dmaNo, void *dest, u32 data, u32 size, MIDmaCallback callback, void *arg, BOOL dmaEnable);
// swan's dma_copyEx
void MIi_DmaCopy32Async(u32 dmaNo, const void *src, void *dest, u32 size, MIDmaCallback callback, void *arg,
                        BOOL dmaEnable);
void MI_WaitDma(u32 dmaNo);
// NitroSDK's MI_StopDma and MI_StopAllDma
void MI_StopDma(u32 dmaNo); // swan's dma_end
void MI_StopAllDma(void);   // swan's dma_endAll
// NitroSDK's MIi_CheckAnotherAutoDMA: stops the game if another channel is running with a start event that clashes
// with this one's
void MIi_CheckAnotherAutoDMA(u32 dmaNo, u32 dmaType);
// NitroSDK's MIi_CheckDma0SourceAddress: stops the game if DMA0 would read the I/O registers or the cartridge,
// from src to src plus or minus size depending on dir (MI_DMA_SRC_INC or MI_DMA_SRC_DEC)
void MIi_CheckDma0SourceAddress(u32 dmaNo, u32 src, u32 size, u32 dir); // swan's dma_check_source_valid

// NitroSDK's MIi_CardDmaCopy32, which CARD's table of DMA functions holds: waits for the channel, then sets it up to
// move the card's data to dest
void MIi_CardDmaCopy32(u32 dmaNo, const void *src, void *dest, u32 size);

// NitroSDK's MI_SendGXCommandAsync and MI_SendGXCommandAsyncFast: send a display list to the GX FIFO by DMA. The
// first feeds the FIFO a part at a time when it is half empty; callback is called when it is all in
void MI_SendGXCommandAsync(u32 dmaNo, const void *src, u32 length, MIDmaCallback callback, void *arg);
void MI_SendGXCommandAsyncFast(u32 dmaNo, const void *src, u32 length, MIDmaCallback callback, void *arg);

typedef enum {
    MI_PROCESSOR_ARM9,
    MI_PROCESSOR_ARM7,
} MIProcessor;

// Copy or fill size bytes a halfword or a word at a time: NitroSDK's MIi_CpuCopy16, MIi_CpuClear16, MIi_CpuClear32 and
// MIi_CpuCopy32
void MIi_CpuCopy16(const void *src, void *dest, u32 size); // swan's sys_memcpy16
void MIi_CpuClear16(u16 value, void *dest, u32 size);      // swan's sys_memset16
void MIi_CpuClear32(u32 value, void *dest, u32 size);      // swan's sys_memset32
void MIi_CpuCopy32(const void *src, void *dest, u32 size); // swan's sys_memcpy32
// Copy or fill size bytes in units of bytes: NitroSDK's MI_CpuCopy8 and MI_CpuFill8, MI_CpuComp8,
// which returns the difference of the first bytes that differ, or 0, MI_CpuCopy, which copies by words whatever the
// alignment, MI_CpuMove, which also handles ranges that overlap, and MI_CpuFill, which fills by words
void MI_CpuCopy8(const void *src, void *dest, u32 size); // swan's sys_memcpy
void MI_CpuFill8(void *dest, u8 value, u32 size);        // swan's sys_memset
int MI_CpuComp8(const void *a, const void *b, u32 size); // swan's sys_memcmp
void MI_CpuCopy(const void *src, void *dest, u32 size);  // swan's sys_memcpy_fast
void MI_CpuMove(const void *src, void *dest, u32 size);  // swan's sys_memcpy_ex
void MI_CpuFill(void *dest, u32 value, u32 size);        // swan's sys_memset_fast

// NitroSDK's MI_CpuCopy16, an inline over MIi_CpuCopy16. MWCC evaluates an inline call's arguments
// from the last, so the size is read before a destination that a call gives
static inline void MI_CpuCopy16(const void *src, void *dest, u32 size) {
    MIi_CpuCopy16(src, dest, size);
}

static inline void MI_CpuCopy32(const void *src, void *dest, u32 size) {
    MIi_CpuCopy32(src, dest, size);
}

static inline void MI_CpuFill16(void *dest, u16 data, u32 size) {
    MIi_CpuClear16(data, dest, size);
}

static inline void MI_CpuClear16(void *dest, u32 size) {
    MIi_CpuClear16(0, dest, size);
}

static inline void MI_CpuFill32(void *dest, u32 data, u32 size) {
    MIi_CpuClear32(data, dest, size);
}

static inline void MI_CpuClear32(void *dest, u32 size) {
    MIi_CpuClear32(0, dest, size);
}

// Copies size bytes, a multiple of 4, a word at a time to one address, such as the geometry engine's FIFO: NitroSDK's
// MIi_CpuSend32
void MIi_CpuSend32(const void *src, volatile void *dest, u32 size); // swan's sys_memcpy_volatile

// Fills size bytes, a multiple of 4, 32 bytes at a time where it can: NitroSDK's MIi_CpuClearFast and its inline
// MI_CpuFillFast
void MIi_CpuClearFast(u32 value, void *dest, u32 size); // swan's sys_memset32_fast

static inline void MI_CpuFillFast(void *dest, u32 data, u32 size) {
    MIi_CpuClearFast(data, dest, size);
}

static inline void MI_CpuClearFast(void *dest, u32 size) {
    MIi_CpuClearFast(0, dest, size);
}

// NitroSDK's MIi_CpuCopyFast: copies size bytes, a multiple of 4, 32 bytes at a time where it can
void MIi_CpuCopyFast(const void *src, void *dest, u32 size); // swan's sys_memcpy32_fast

// Copies 32 bytes, a register's table: NitroSDK's MI_Copy32B
void MI_Copy32B(const void *src, void *dest); // swan's gfxUploadFogTable
// Copies 36 bytes, a 3x3 matrix
void MI_Copy36B(const void *src, void *dest);
// Clears 36 bytes, a 3x3 matrix: NitroSDK's MI_Zero36B
void MI_Zero36B(void *dest);
// Swan's MAT43_Copy
void MI_Copy48B(const void *src, void *dest);
// Copies 64 bytes, a 4x4 matrix. Swan's MAT4_Copy
void MI_Copy64B(const void *src, void *dest);

// Which processor has priority on the main memory
static inline void MI_SetMainMemoryPriority(MIProcessor proc) {
    reg_MI_EXMEMCNT = (u16)((reg_MI_EXMEMCNT & ~REG_MI_EXMEMCNT_EP_MASK) | (proc << REG_MI_EXMEMCNT_EP_SHIFT));
}

// NitroSDK's MI_SwapEndian32: the word with its bytes in the other order, as the card's commands go
#define MI_SwapEndian32(x)                                                                                             \
    ((((x) & 0xff000000) >> 24) | (((x) & 0x00ff0000) >> 8) | (((x) & 0x0000ff00) << 8) | ((x) << 24))

// NitroSDK's MI_SwapWord, in assembly: stores the word at the address and returns the one that was there
u32 MI_SwapWord(u32 data, vu32 *destp); // swan's memswap

// NitroSDK's MIUnpackBitsParam: what SVC_UnpackBits widens, srcNum bytes of srcBitNum-bit units into destBitNum-bit
// units, adding destOffset (to the zero units too when destOffset0_on is set)
typedef struct {
    u16 srcNum;
    u16 srcBitNum : 8;
    u16 destBitNum : 8;
    u32 destOffset : 31;
    u32 destOffset0_on : 1;
} MIUnpackBitsParam;

// NitroSDK's MIReadStreamCallbacks: how the BIOS's decompressors that read from a device open, read and close it
typedef s32 (*MIi_InitReadStreamCallback)(const u8 *devicep, void *ramp, const void *paramp);
typedef s32 (*MIi_TerminateReadStreamCallback)(const u8 *devicep);
typedef u8 (*MIi_ReadByteStreamCallback)(const u8 *devicep);
typedef u16 (*MIi_ReadShortStreamCallback)(const u8 *devicep);
typedef u32 (*MIi_ReadWordStreamCallback)(const u8 *devicep);

typedef struct {
    MIi_InitReadStreamCallback initStream;
    MIi_TerminateReadStreamCallback terminateStream;
    MIi_ReadByteStreamCallback readByteStream;
    MIi_ReadShortStreamCallback readShortStream;
    MIi_ReadWordStreamCallback readWordStream;
} MIReadStreamCallbacks;

// Decompresses LZ77 data, which starts with a word holding its decompressed size in its upper 24 bits.
void MI_UncompressLZ8(const void *src, void *dest); // swan's sys_uncomp_lz1x
// Expands an image that was compressed backward in place, given the address of its end: NitroSDK's
// MIi_UncompressBackward (swan's sys_uncomp_blz), which the startup code has and the overlays' loading (fs_overlay.c)
// uses
void MIi_UncompressBackward(void *end);

static inline u32 MI_GetUncompressedSize(const void *src) {
    return *(u32 *)src >> 8;
}

#endif // POKEBW2_NITRO_MI_H
