#ifndef POKEBW2_NNSYS_SND_H
#define POKEBW2_NNSYS_SND_H

#include "types.h"
#include "nitro/fs.h"
#include "nitro/snd.h"

// NitroSystem's sound library (NNS_Snd). The names are NitroSystem's, as ntrtwl's reconstruction of NitroSystem has
// them, where the code shows them, and ours elsewhere, as for what is newer than that reconstruction; swan's names are
// noted where they differ. The sources' names have a snd_ prefix that NitroSystem's lack (main.c, heap.c, sndarc.c and
// so on), since dsd needs file names that are unique in a module, and the game's main.c and heap.c are in this one;
// NitroSDK's snd_main.c is nitro_snd_main.c for the same reason

// The sound players

// Sets a sound player's volume, 0 to 127
void NNS_SndPlayerSetPlayerVolume(int playerNo, int volume);
// Sets the master volume, 0 to 127, through SND_SetMasterVolume
void NNS_SndSetMasterVolume(int volume);

// A handle to a sound player, which plays one sequence
typedef struct NNSSndHandle {
    struct NNSSndSeqPlayer *player;
} NNSSndHandle;

// A sound heap (snd_heap.c, below), which the players' sequences load into
typedef struct NNSSndHeap *NNSSndHeapHandle;

// Sets a sound player's volume, 0 to 127
void NNS_SndPlayerSetVolume(NNSSndHandle *handle, int volume);
// Sets the pitch of the tracks in trackBitMask, in 64ths of a semitone
void NNS_SndPlayerSetTrackPitch(NNSSndHandle *handle, u16 trackBitMask, int pitch);
// Set a value of the tracks in trackBitMask, as NNS_SndPlayerSetTrackPitch does the pitch
void NNS_SndPlayerSetTrackModDepth(NNSSndHandle *handle, u16 trackBitMask, int value);
void NNS_SndPlayerSetTrackModSpeed(NNSSndHandle *handle, u16 trackBitMask, int value);

// The library's setup and its work each frame (snd_main.c): NNS_SndInit, which swan names sndInit, sets up the driver
// once; NNS_SndMain, swan's sndSync, runs the players, the capture and the streams and sends the commands queued.
// NNS_SndSetMonoFlag puts every channel in the center. NNS_SndUpdateDriverInfo asks the ARM7 for a copy of its state,
// and returns whether a copy asked for earlier has arrived
void NNS_SndInit(void);
void NNS_SndMain(void);
void NNS_SndSetMonoFlag(BOOL flag);
BOOL NNS_SndUpdateDriverInfo(void);

// The players by number (snd_player.c): how many sequences a player plays at once, the channels its sequences may take,
// and a heap made of size bytes of heap for each sequence it plays at once to load into. NNS_SndPlayerCreateHeap
// returns whether there was room for it
void NNS_SndPlayerSetPlayableSeqCount(int playerNo, int seqCount);
void NNS_SndPlayerSetAllocatableChannel(int playerNo, u32 chBitFlag);
BOOL NNS_SndPlayerCreateHeap(int playerNo, NNSSndHeapHandle heap, u32 size);
int NNS_SndPlayerCountPlayingSeqByPlayerNo(int playerNo);
int NNS_SndPlayerCountPlayingSeqBySeqNo(int seqNo);

// A handle starts unbound; NNS_SndHandleReleaseSeq unbinds it, leaving the sequence playing. NNS_SndPlayerStopSeq
// fades the sequence out over fadeFrame frames, or stops it now with 0. NNS_SndPlayerMoveVolume moves the sequence's
// volume to targetVolume over frames frames
void NNS_SndHandleInit(NNSSndHandle *handle);
void NNS_SndHandleReleaseSeq(NNSSndHandle *handle);
void NNS_SndPlayerStopSeq(NNSSndHandle *handle, int fadeFrame);
void NNS_SndPlayerPause(NNSSndHandle *handle, BOOL flag);
void NNS_SndPlayerSetInitialVolume(NNSSndHandle *handle, int volume);
void NNS_SndPlayerMoveVolume(NNSSndHandle *handle, int targetVolume, int frames);
void NNS_SndPlayerSetChannelPriority(NNSSndHandle *handle, int prio);
typedef enum {
    NNS_SND_SEQ_MUTE_OFF = SND_SEQ_MUTE_OFF,
    NNS_SND_SEQ_MUTE_NO_STOP = SND_SEQ_MUTE_NO_STOP,
    NNS_SND_SEQ_MUTE_RELEASE = SND_SEQ_MUTE_RELEASE,
    NNS_SND_SEQ_MUTE_STOP = SND_SEQ_MUTE_STOP,
} NNSSndSeqMute;

void NNS_SndPlayerSetTrackMute(NNSSndHandle *handle, u16 trackBitMask, BOOL flag);
void NNS_SndPlayerSetTrackMuteEx(NNSSndHandle *handle, u16 trackBitMask, NNSSndSeqMute muteType);
void NNS_SndPlayerSetTrackVolume(NNSSndHandle *handle, u16 trackBitMask, int volume);
void NNS_SndPlayerSetTrackPan(NNSSndHandle *handle, u16 trackBitMask, int pan);
void NNS_SndPlayerSetTempoRatio(NNSSndHandle *handle, int ratio);
// The ticks the sequence has played, 0 before it starts
u32 NNS_SndPlayerGetTick(NNSSndHandle *handle);
BOOL NNS_SndPlayerReadDriverTrackInfo(NNSSndHandle *handle, int trackNo, SNDTrackInfo *trackInfo);

// NitroSystem's wave output (snd_waveout.c), which plays raw samples on a channel of its own. swan calls
// NNS_SndWaveOutAllocChannel, NNS_SndWaveOutFreeChannel, NNS_SndWaveOutStart, NNS_SndWaveOutStop and
// NNS_SndWaveOutIsPlaying sndLockChannel, sndReleaseChannel, sndPlaySamples, sndStopChannel and sndIsChannelPlaying

typedef struct NNSSndWaveOut *NNSSndWaveOutHandle;

typedef enum {
    NNS_SND_WAVE_FORMAT_PCM8,
    NNS_SND_WAVE_FORMAT_PCM16,
} NNSSndWaveFormat;

NNSSndWaveOutHandle NNS_SndWaveOutAllocChannel(int channel);
void NNS_SndWaveOutFreeChannel(NNSSndWaveOutHandle handle);
BOOL NNS_SndWaveOutStart(NNSSndWaveOutHandle handle, NNSSndWaveFormat format, const void *data, BOOL loop,
                         int loopStart, int samples, int rate, int volume, int speed, int pan);
void NNS_SndWaveOutStop(NNSSndWaveOutHandle handle);
BOOL NNS_SndWaveOutIsPlaying(NNSSndWaveOutHandle handle);
// NNS_SndWaveOutSetVolume and NNS_SndWaveOutSetSpeed, which swan names sndSetChannelVolume and sndSetChannelSpeed,
// change what plays; speed is a ratio to the sample rate, 0x8000 for 1. NNS_SndWaveOutWaitForChannelStop waits until
// the channel is silent
void NNS_SndWaveOutSetVolume(NNSSndWaveOutHandle handle, int volume);
void NNS_SndWaveOutSetSpeed(NNSSndWaveOutHandle handle, int speed);
void NNS_SndWaveOutWaitForChannelStop(NNSSndWaveOutHandle handle);

// NitroSystem's resource manager (snd_resource_mgr.c): NNS_SndLockChannel, which fails when a channel is locked
// already, and NNS_SndUnlockChannel, which swan names sndEnableChannels and sndDisableChannels, and NNS_SndAllocAlarm,
// which returns -1 when no alarm is free, and NNS_SndFreeAlarm
BOOL NNS_SndLockChannel(u32 chBitMask);
void NNS_SndUnlockChannel(u32 chBitMask);
int NNS_SndAllocAlarm(void);
void NNS_SndFreeAlarm(int alarmNo);
// Frees capture channels locked for the capture
void NNS_SndUnlockCapture(u32 capBitFlag);

// NitroSystem's sound archive (NNS_SndArc): the info of a sequence, a bank and a wave archive by number, and the
// address of a file of the archive if it is loaded, else NULL

#define NNS_SND_ARC_BANK_TO_WAVEARC_NUM 4
#define NNS_SND_ARC_INVALID_WAVEARC_NO 0xffff

typedef struct NNSSndSeqParam {
    u16 bankNo;
    u8 volume;
    u8 channelPrio;
    u8 playerPrio;
    u8 playerNo;
    u16 reserved;
} NNSSndSeqParam;

typedef struct NNSSndArcSeqInfo {
    u32 fileId;
    NNSSndSeqParam param;
} NNSSndArcSeqInfo;

typedef struct NNSSndArcBankInfo {
    u32 fileId;
    u16 waveArcNo[NNS_SND_ARC_BANK_TO_WAVEARC_NUM];
} NNSSndArcBankInfo;

typedef struct NNSSndArcWaveArcInfo {
    u32 fileId : 24;
    u32 flags : 8;
} NNSSndArcWaveArcInfo;

const NNSSndArcSeqInfo *NNS_SndArcGetSeqInfo(int seqNo);
const NNSSndArcBankInfo *NNS_SndArcGetBankInfo(int bankNo);
const NNSSndArcWaveArcInfo *NNS_SndArcGetWaveArcInfo(int waveArcNo);
void *NNS_SndArcGetFileAddress(u32 fileId);

// The rest of the archive's info (snd_arc.c): a sequence archive's, a stream's, a sequence player's, a stream player's
// and a group's, by number; NULL when the number is out of the table or the entry is empty
#define NNS_SND_STRM_CHANNEL_MAX 16

typedef struct NNSSndArcSeqArcInfo {
    u32 fileId;
} NNSSndArcSeqArcInfo;

typedef struct NNSSndArcStrmInfo {
    u32 fileId;
    u8 volume;
    u8 playerPrio;
    u8 playerNo;
    // NNS_SND_ARC_STRM_FORCE_STEREO plays a mono stream on two channels (snd_arc_stream.c)
    u8 flags;
    u8 reserved[4];
} NNSSndArcStrmInfo;

#define NNS_SND_ARC_STRM_FORCE_STEREO (1 << 0)

typedef struct NNSSndArcPlayerInfo {
    u8 seqMax;
    u8 padding;
    u16 allocChBitFlag;
    u32 heapSize;
} NNSSndArcPlayerInfo;

typedef struct NNSSndArcStrmPlayerInfo {
    u8 numChannels;
    u8 chNoList[NNS_SND_STRM_CHANNEL_MAX];
    u8 reserved[7];
} NNSSndArcStrmPlayerInfo;

typedef struct NNSSndArcGroupItem {
    u8 type;
    u8 loadFlag;
    u16 padding;
    u32 index;
} NNSSndArcGroupItem;

typedef struct NNSSndArcGroupInfo {
    u32 count;
    NNSSndArcGroupItem item[];
} NNSSndArcGroupInfo;

const NNSSndSeqParam *NNS_SndArcGetSeqParam(int seqNo);
const NNSSndArcSeqArcInfo *NNS_SndArcGetSeqArcInfo(int seqArcNo);
const NNSSndArcStrmInfo *NNS_SndArcGetStrmInfo(int strmNo);
const NNSSndArcPlayerInfo *NNS_SndArcGetPlayerInfo(int playerNo);
const NNSSndArcStrmPlayerInfo *NNS_SndArcGetStrmPlayerInfo(int playerNo);
const NNSSndArcGroupInfo *NNS_SndArcGetGroupInfo(int groupNo);

// A file of the archive: where it is in the archive, its size, reading part of it (returning the bytes read, or -1)
// and recording where it was loaded. NNS_SndArcSetLoadBlockSize sets how much NNS_SndArcReadFile reads at a time, 0
// for all at once
u32 NNS_SndArcGetFileOffset(u32 fileId);
u32 NNS_SndArcGetFileSize(u32 fileId);
s32 NNS_SndArcReadFile(u32 fileId, void *buffer, s32 size, s32 offset);
void NNS_SndArcSetFileAddress(u32 fileId, void *address);
void NNS_SndArcSetLoadBlockSize(s32 size);

// The current sound archive. NNS_SndArcInit opens one by path and makes it current, loading its info and file table,
// and its symbols if symbolLoadFlag, into heap; NNS_SndArcInitOnMemory makes current one that is wholly in memory.
// NNS_SndArcSetCurrent returns the archive that was current. The archive is the caller's, so its layout is here: its
// header, the open file, and its info, file table and symbols when loaded. filePath is read by snd_arc_stream.c to open
// a stream's file again by path; nothing in snd_arc.c sets it
typedef struct NNSSndArcHeader {
    SNDBinaryFileHeader fileHeader;
    u32 symbolDataOffset;
    u32 symbolDataSize;
    u32 infoOffset;
    u32 infoSize;
    u32 fatOffset;
    u32 fatSize;
    u32 fileImageOffset;
    u32 fileImageSize;
} NNSSndArcHeader;

typedef struct NNSSndArc {
    NNSSndArcHeader header;
    BOOL file_open;
    FSFile file;
    FSFileID fileId;
    const char *filePath;
    struct NNSSndArcFat *fat;
    struct NNSSndArcSymbol *symbol;
    struct NNSSndArcInfo *info;
    s32 loadBlockSize;
} NNSSndArc;

// NitroSystem's sound heap (snd_heap.c), a frame heap for sound data: NNS_SndHeapSaveState returns the level saved,
// NNS_SndHeapLoadState frees what was loaded after a level, calling each block's dispose callback first. swan names
// NNS_SndHeapCreate NNS_FrmHeapCreate
#define NNS_SND_HEAP_INVALID_HANDLE NULL

// Called with a block's memory and size and the two values it was allocated with, before the block is freed
typedef void (*NNSSndHeapDisposeCallback)(void *mem, u32 size, u32 data1, u32 data2);

NNSSndHeapHandle NNS_SndHeapCreate(void *startAddress, u32 size);
void NNS_SndHeapDestroy(NNSSndHeapHandle heap);
void NNS_SndHeapClear(NNSSndHeapHandle heap);
void *NNS_SndHeapAlloc(NNSSndHeapHandle heap, u32 size, NNSSndHeapDisposeCallback callback, u32 data1, u32 data2);
int NNS_SndHeapSaveState(NNSSndHeapHandle heap);
void NNS_SndHeapLoadState(NNSSndHeapHandle heap, int level);
int NNS_SndHeapGetCurrentLevel(NNSSndHeapHandle heap);

// The current sound archive (snd_arc.c, declared here for the heap handle)
BOOL NNS_SndArcInit(NNSSndArc *arc, const char *filePath, NNSSndHeapHandle heap, BOOL symbolLoadFlag);
void NNS_SndArcInitOnMemory(NNSSndArc *arc, void *data);
NNSSndArc *NNS_SndArcSetCurrent(NNSSndArc *arc);
NNSSndArc *NNS_SndArcGetCurrent(void);

// NitroSystem's streams (snd_stream.c): PCM played from a ring buffer on locked channels, one alarm per stream calling
// callback for the next part of the buffer, which it fills. NNS_SndStrmSetup returns FALSE when no alarm is free
typedef enum NNSSndStrmFormat {
    NNS_SND_STRM_FORMAT_PCM8,
    NNS_SND_STRM_FORMAT_PCM16,
} NNSSndStrmFormat;

typedef enum NNSSndStrmCallbackStatus {
    NNS_SND_STRM_CALLBACK_SETUP,
    NNS_SND_STRM_CALLBACK_INTERVAL,
} NNSSndStrmCallbackStatus;

typedef void (*NNSSndStrmCallback)(NNSSndStrmCallbackStatus status, int numChannels, void *buffer[], u32 len,
                                   NNSSndStrmFormat format, void *arg);

typedef struct NNSSndStrm NNSSndStrm;

void NNS_SndStrmInit(NNSSndStrm *stream);
BOOL NNS_SndStrmAllocChannel(NNSSndStrm *stream, int numChannels, const u8 chNoList[]);
void NNS_SndStrmFreeChannel(NNSSndStrm *stream);
BOOL NNS_SndStrmSetup(NNSSndStrm *stream, NNSSndStrmFormat format, void *buffer, u32 len, int timer, int interval,
                      NNSSndStrmCallback callback, void *arg);
void NNS_SndStrmStart(NNSSndStrm *stream);
void NNS_SndStrmStop(NNSSndStrm *stream);
void NNS_SndStrmSetVolume(NNSSndStrm *stream, int volume);
void NNS_SndStrmSetChannelPan(NNSSndStrm *stream, int index, int pan);

// Loading the sound archive's files into a sound heap (snd_arc_loader.c): a group of files, a sequence with its bank
// and wave archives, or a wave archive. NNS_SndArcLoadSeqEx loads only the kinds of file in loadFlag. Each returns
// whether everything loaded
#define NNS_SND_ARC_LOAD_SEQ (1 << 0)
#define NNS_SND_ARC_LOAD_BANK (1 << 1)
#define NNS_SND_ARC_LOAD_WAVE (1 << 2)
#define NNS_SND_ARC_LOAD_SEQARC (1 << 3)

BOOL NNS_SndArcLoadGroup(int groupNo, NNSSndHeapHandle heap);
BOOL NNS_SndArcLoadSeq(int seqNo, NNSSndHeapHandle heap);
BOOL NNS_SndArcLoadWaveArc(int waveArcNo, NNSSndHeapHandle heap);
BOOL NNS_SndArcLoadSeqEx(int seqNo, u32 loadFlag, NNSSndHeapHandle heap);

// Starting a sequence of the sound archive on its player, with the player, bank and player priority its info gives
// or, in NNS_SndArcPlayerStartSeqEx, with those that aren't negative (snd_arc_player.c). NNS_SndArcPlayerSetup sets
// the players up from the archive's player info, giving each sequence its heap from heap
BOOL NNS_SndArcPlayerSetup(NNSSndHeapHandle heap);
BOOL NNS_SndArcPlayerStartSeq(NNSSndHandle *handle, int seqNo);
BOOL NNS_SndArcPlayerStartSeqEx(NNSSndHandle *handle, int playerNo, int bankNo, int playerPrio, int seqNo);
BOOL NNS_SndArcPlayerStartSeqArc(NNSSndHandle *handle, int seqArcNo, int index);

// The sound archive's stream players (snd_arc_stream.c): a stream of the archive played on the stream player its info
// gives, read and decoded by a thread at threadPrio. NNS_SndArcStrmPrepare reads the first block, from offset
// milliseconds in, and NNS_SndArcStrmStartPrepared starts it once read; NNS_SndArcStrmStart does both.
// NNS_SndArcStrmStop fades out over fadeFrames frames, stopping at once with 0. NNSi_SndArcStrmMain runs once a frame
// from NNS_SndMain. swan names NNS_SndArcStrmInit NNS_SndStreamInit
typedef struct NNSSndStrmPlayer NNSSndStrmPlayer;

typedef struct NNSSndStrmHandle {
    NNSSndStrmPlayer *player;
} NNSSndStrmHandle;

// Called when a stream's data ends, with the stream to play next in param, which it may change; returns whether to
// play it
typedef enum NNSSndArcStrmCallbackStatus {
    NNS_SND_ARC_STRM_CALLBACK_DATA_END,
} NNSSndArcStrmCallbackStatus;

typedef struct NNSSndArcStrmCallbackInfo {
    int playerNo;
    int strmNo;
} NNSSndArcStrmCallbackInfo;

typedef struct NNSSndArcStrmCallbackParam {
    int strmNo;
    u32 offset;
} NNSSndArcStrmCallbackParam;

typedef BOOL (*NNSSndArcStrmCallback)(NNSSndArcStrmCallbackStatus status, const NNSSndArcStrmCallbackInfo *info,
                                      NNSSndArcStrmCallbackParam *param, void *arg);

void NNS_SndArcStrmInit(u32 threadPrio, NNSSndHeapHandle heap);
BOOL NNS_SndArcStrmPrepare(NNSSndStrmHandle *handle, int strmNo, u32 offset);
void NNS_SndArcStrmStartPrepared(NNSSndStrmHandle *handle);
BOOL NNS_SndArcStrmStart(NNSSndStrmHandle *handle, int strmNo, u32 offset);
void NNS_SndArcStrmStop(NNSSndStrmHandle *handle, int fadeFrames);
void NNS_SndStrmHandleInit(NNSSndStrmHandle *handle);
void NNS_SndStrmHandleRelease(NNSSndStrmHandle *handle);
// In milliseconds
u32 NNS_SndArcStrmGetCurrentPlayingPos(NNSSndStrmHandle *handle);
// Locks or frees a stream player's channels while it doesn't play
BOOL NNS_SndArcStrmAllocChannel(int playerNo);
void NNS_SndArcStrmFreeChannel(int playerNo);

#endif // POKEBW2_NNSYS_SND_H
