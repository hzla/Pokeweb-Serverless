#ifndef POKEBW2_NITRO_SND_H
#define POKEBW2_NITRO_SND_H

#include "types.h"

// NitroSDK's sound driver interface (SND), which queues commands for the ARM7's sound driver

// A command for the driver: the ID of what to do and its arguments, which are chained in the pool of snd_command.c
// The commands that the interface sends
typedef enum {
    SND_COMMAND_STOP_SEQ = 1,
    SND_COMMAND_PREPARE_SEQ = 2,
    SND_COMMAND_START_PREPARED_SEQ = 3,
    SND_COMMAND_PAUSE_SEQ = 4,
    SND_COMMAND_PLAYER_PARAM = 6,
    SND_COMMAND_TRACK_PARAM = 7,
    SND_COMMAND_MUTE_TRACK = 8,
    SND_COMMAND_ALLOCATABLE_CHANNEL = 9,
    SND_COMMAND_START_TIMER = 0xc,
    SND_COMMAND_STOP_TIMER = 0xd,
    SND_COMMAND_SETUP_CHANNEL_PCM = 0xe,
    SND_COMMAND_SETUP_ALARM = 0x12,
    SND_COMMAND_CHANNEL_TIMER = 0x13,
    SND_COMMAND_CHANNEL_VOLUME = 0x14,
    SND_COMMAND_CHANNEL_PAN = 0x15,
    SND_COMMAND_MASTER_VOLUME = 0x17,
    SND_COMMAND_MASTER_PAN = 0x18,
    SND_COMMAND_OUTPUT_SELECTOR = 0x19,
    SND_COMMAND_LOCK_CHANNEL = 0x1a,
    SND_COMMAND_UNLOCK_CHANNEL = 0x1b,
    SND_COMMAND_SHARED_WORK = 0x1d,
    SND_COMMAND_INVALIDATE_SEQ = 0x1e,
    SND_COMMAND_INVALIDATE_BANK = 0x1f,
    SND_COMMAND_INVALIDATE_WAVE = 0x20,
    SND_COMMAND_READ_DRIVER_INFO = 0x21,
} SNDCommandID;

typedef struct SNDCommand SNDCommand;

struct SNDCommand {
    SNDCommand *next;
    SNDCommandID id;
    u32 arg[4];
};

// The queue of snd_command.c: the pool's free commands, the ready ones that the next flush sends as a packet, the
// packets that the ARM7 has not returned yet, and the tags that tell them apart. The pool's commands are chained, and
// a packet is the chain of the ready commands
#define SND_PXI_FIFO_MESSAGE_BUFSIZE 8

typedef struct SNDCommandQueue {
    SNDCommand *freeHead;  // the pool's commands that nothing uses
    u32 receivedTag;       // the tag of the last packet taken back from the ARM7
    SNDCommand *readyHead; // the commands pushed since the last flush
    SNDCommand *readyTail;
    SNDCommand *freeTail;
    int sentRead;  // where the next packet to come back is in sWaitingCommandListQueue
    int sentWrite; // where the next packet to go is
    int sentCount; // how many packets are on their way
    u32 nextTag;   // the tag of the packet that the ready commands will make
} SNDCommandQueue;

// They are in the .bss of nitro_snd_main.c: the 32-aligned pool and shared work of snd_command.c start after them.
// NitroSDK keeps them as statics of snd_command.c: SNDCommandQueue and SNDi_Queue are our names for the SDK's separate
// statics, and sWaitingCommandListQueue is the SDK's name
extern SNDCommandQueue SNDi_Queue;
extern SNDCommand *sWaitingCommandListQueue[SND_PXI_FIFO_MESSAGE_BUFSIZE + 1];

// What the driver has: players, 16 tracks for each and 16 variables, channels and alarms
#define SND_PLAYER_NUM 16
#define SND_TRACK_NUM_PER_PLAYER 16
#define SND_PLAYER_VARIABLE_MAX 16
#define SND_CHANNEL_NUM 16
#define SND_ALARM_NUM 8

// Channels: SND_SetChannelVolume, SND_SetChannelPan and SND_SetupChannelPcm
typedef enum {
    SND_WAVE_FORMAT_PCM8,
    SND_WAVE_FORMAT_PCM16,
    SND_WAVE_FORMAT_ADPCM,
    SND_WAVE_FORMAT_PSG,
    SND_WAVE_FORMAT_NOISE = SND_WAVE_FORMAT_PSG,
} SNDWaveFormat;

typedef enum {
    SND_CHANNEL_LOOP_MANUAL,
    SND_CHANNEL_LOOP_REPEAT,
    SND_CHANNEL_LOOP_1SHOT,
} SNDChannelLoop;

typedef enum {
    SND_CHANNEL_DATASHIFT_NONE,
    SND_CHANNEL_DATASHIFT_1BIT,
    SND_CHANNEL_DATASHIFT_2BIT,
    SND_CHANNEL_DATASHIFT_4BIT,
} SNDChannelDataShift;

#define SND_CHANNEL_VOLUME_MAX 127
#define SND_CHANNEL_PAN_CENTER 64

void SND_SetChannelVolume(u32 chBitMask, int volume, SNDChannelDataShift shift); // swan's sndSetVolume
void SND_SetChannelPan(u32 chBitMask, int pan);                                  // swan's sndSetPan
// swan's sndQueuePacket_PlaySamples
void SND_SetupChannelPcm(int chNo, SNDWaveFormat format, const void *dataAddr, SNDChannelLoop loop, int loopStart,
                         int loopLen, int volume, SNDChannelDataShift shift, int timer, int pan);

// Timers and alarms: NitroSDK's SND_StartTimer, SND_StopTimer and SND_SetupAlarm, by their code
typedef void (*SNDAlarmHandler)(void *arg);

void SND_StartTimer(u32 chBitMask, u32 capBitMask, u32 alarmBitMask, u32 flags);
void SND_StopTimer(u32 chBitMask, u32 capBitMask, u32 alarmBitMask, u32 flags);
void SND_SetupAlarm(int alarmNo, u32 tick, u32 period, SNDAlarmHandler handler, void *arg);

// The alarms' handlers, which snd_alarm.c keeps: NitroSDK's SND_AlarmInit, SNDi_IncAlarmId, SNDi_SetAlarmHandler, which
// returns the alarm's new ID, and SNDi_CallAlarmHandler, which takes the number and the ID that the ARM7 sends
void SND_AlarmInit(void);
void SNDi_IncAlarmId(int alarmNo);
u8 SNDi_SetAlarmHandler(int alarmNo, SNDAlarmHandler handler, void *arg);
void SNDi_CallAlarmHandler(int data);

// Commands: NitroSDK's SND_FlushCommand and SND_WaitForCommandProc by their code, and SND_GetCurrentCommandTag (swan's
// name noted)
#define SND_COMMAND_BLOCK 1
// Flush: wake the ARM7 up for the packet at once
#define SND_COMMAND_IMMEDIATE 2

BOOL SND_FlushCommand(u32 flags);
void SND_WaitForCommandProc(u32 tag);
u32 SND_GetCurrentCommandTag(void); // swan's sndGetSentPacketCount

// NitroSDK's SND_CalcChannelVolume: a volume in decibels as a channel volume in the low byte and a data shift in the
// high one
#define SND_CHANNEL_VOLUME(v) ((u8)(v))
#define SND_CHANNEL_DATASHIFT(v) ((v) >> 8)

#define SND_VOLUME_DB_MIN (-723)

u16 SND_CalcChannelVolume(int dB);

// Sound data files: a sequence, a bank of instruments and a wave archive, each a binary file with one data block
typedef struct SNDBinaryFileHeader {
    char signature[4];
    u16 byteOrder;
    u16 version;
    u32 fileSize;
    u16 headerSize;
    u16 dataBlocks;
} SNDBinaryFileHeader;

typedef struct SNDBinaryBlockHeader {
    u32 kind;
    u32 size;
} SNDBinaryBlockHeader;

typedef struct SNDSequenceData {
    SNDBinaryFileHeader fileHeader;
    SNDBinaryBlockHeader blockHeader;
    u32 baseOffset;
    u32 data[];
} SNDSequenceData;

typedef struct SNDWaveData SNDWaveData;

typedef struct SNDWaveArc SNDWaveArc;
typedef struct SNDWaveArcLink SNDWaveArcLink;

// A wave archive: its waves' offsets in the file. Loaded in the heap, the table holds the waves' addresses
struct SNDWaveArc {
    SNDBinaryFileHeader fileHeader;
    SNDBinaryBlockHeader blockHeader;
    SNDWaveArcLink *topLink; // the banks that use this archive
    u32 reserved[7];
    u32 waveCount;
    u32 waveOffset[];
};

// A bank's slot for one of its wave archives, chained in the archive's list of users
struct SNDWaveArcLink {
    SNDWaveArc *waveArc;
    SNDWaveArcLink *next;
};

#define SND_BANK_TO_WAVEARC_MAX 4

// A bank: the offset in the file of each of its instruments
typedef struct SNDBankData {
    SNDBinaryFileHeader fileHeader;
    SNDBinaryBlockHeader blockHeader;
    SNDWaveArcLink waveArcLink[SND_BANK_TO_WAVEARC_MAX];
    u32 instCount;
    u32 instOffset[];
} SNDBankData;

// The kinds of program of a bank. A drum set and a key split hold instruments of their own
#define SND_INST_INVALID 0
#define SND_INST_PCM 1
#define SND_INST_PSG 2
#define SND_INST_NOISE 3
#define SND_INST_DIRECTPCM 4
#define SND_INST_NULL 5
#define SND_INST_DRUM_SET 16
#define SND_INST_KEY_SPLIT 17

typedef struct SNDInstParam {
    u16 wave[2];
    u8 original_key;
    u8 attack;
    u8 decay;
    u8 sustain;
    u8 release;
    u8 pan;
} SNDInstParam;

typedef struct SNDInstData {
    u8 type;
    u8 padding_;
    SNDInstParam param;
} SNDInstData;

// The instruments of a drum set, one for each key from min to max
typedef struct SNDDrumSet {
    u8 min;
    u8 max;
    SNDInstData instOffset[];
} SNDDrumSet;

// The instruments of a key split: the highest key of each, and the instruments, until a key of 0
typedef struct SNDKeySplit {
    u8 key[8];
    SNDInstData instOffset[];
} SNDKeySplit;

// Where SND_GetNextInstData goes on from: the program, then the instrument inside a drum set or key split
typedef struct SNDInstPos {
    u32 prgNo;
    u32 index;
} SNDInstPos;

// NitroSDK's SND_InvalidateSeqData, SND_InvalidateBankData and SND_InvalidateWaveData, which stop what plays from the
// range, then SND_AssignWaveArc, SND_DestroyBank, SND_DestroyWaveArc, SND_GetFirstInstDataPos, SND_GetNextInstData,
// SND_GetWaveDataCount, SND_SetWaveDataAddress and SND_GetWaveDataAddress, by their code
void SND_InvalidateSeqData(const void *start, const void *end);
void SND_InvalidateBankData(const void *start, const void *end);
void SND_InvalidateWaveData(const void *start, const void *end);
void SND_AssignWaveArc(SNDBankData *bank, int index, SNDWaveArc *waveArc);
void SND_DestroyBank(SNDBankData *bank);
void SND_DestroyWaveArc(SNDWaveArc *waveArc);
SNDInstPos SND_GetFirstInstDataPos(const SNDBankData *bank);
BOOL SND_GetNextInstData(const SNDBankData *bank, SNDInstData *inst, SNDInstPos *pos);
u32 SND_GetWaveDataCount(const SNDWaveArc *waveArc);
void SND_SetWaveDataAddress(SNDWaveArc *waveArc, int index, const SNDWaveData *address);
const SNDWaveData *SND_GetWaveDataAddress(const SNDWaveArc *waveArc, int index);

// The driver: NitroSDK's SND_Init, SNDi_LockMutex and SNDi_UnlockMutex, which guard the commands of a caller,
// SND_CommandInit, SND_RecvCommandReply, which returns the commands of the next packet the ARM7 is done with or NULL,
// SND_AllocCommand (swan's sndNewPacket) and SND_PushCommand (sndQueuePacket_), and SND_IsFinishedCommandTag, by their
// code
#define SND_COMMAND_NOBLOCK 0

void SND_Init(void);
void SNDi_LockMutex(void);
void SNDi_UnlockMutex(void);
void SND_CommandInit(void);
const SNDCommand *SND_RecvCommandReply(u32 flags);
SNDCommand *SND_AllocCommand(u32 flags);   // swan's sndNewPacket
void SND_PushCommand(SNDCommand *command); // swan's sndQueuePacket_
BOOL SND_IsFinishedCommandTag(u32 tag);

// Sequences on a player: NitroSDK's SND_StopSeq, SND_PrepareSeq, SND_StartPreparedSeq, SND_PauseSeq,
// SND_SetPlayerTempoRatio, SND_SetPlayerVolume and SND_SetPlayerChannelPriority, by their code
void SND_StopSeq(int playerNo);
void SND_PrepareSeq(int playerNo, const void *seqBase, u32 seqOffset, const SNDBankData *bank);
void SND_StartPreparedSeq(int playerNo);
void SND_PauseSeq(int playerNo, BOOL flag);
void SND_SetPlayerTempoRatio(int playerNo, int ratio);
void SND_SetPlayerVolume(int playerNo, int volume);
void SND_SetPlayerChannelPriority(int playerNo, int prio);

// The tracks of a player: NitroSDK's SND_SetTrackVolume, SND_SetTrackPitch, SND_SetTrackPan, SND_SetTrackModDepth and
// SND_SetTrackModSpeed (the depth and speed of the track's LFO), then SND_SetTrackAllocatableChannel, SND_SetTrackMute
// and SND_SetTrackMuteEx, by their code. The types of mute are the values that the first sends for a flag

typedef enum {
    SND_SEQ_MUTE_OFF,
    SND_SEQ_MUTE_NO_STOP,
    SND_SEQ_MUTE_RELEASE,
    SND_SEQ_MUTE_STOP,
} SNDSeqMute;

void SND_SetTrackVolume(int playerNo, u32 trackBitMask, int volume);
void SND_SetTrackPitch(int playerNo, u32 trackBitMask, int pitch);
void SND_SetTrackPan(int playerNo, u32 trackBitMask, int pan);
void SND_SetTrackModDepth(int playerNo, u32 trackBitMask, int depth);
void SND_SetTrackModSpeed(int playerNo, u32 trackBitMask, int speed);
void SND_SetTrackAllocatableChannel(int playerNo, u32 trackBitMask, u32 chBitFlag);
void SND_SetTrackMute(int playerNo, u32 trackBitMask, BOOL flag);
void SND_SetTrackMuteEx(int playerNo, u32 trackBitMask, SNDSeqMute muteType);

// NitroSDK's SND_LockChannel and SND_UnlockChannel, by their code; SND_SetChannelTimer and SND_SetMasterVolume (swan's
// names noted); SND_SetOutputSelector, SND_SetMasterPan and SND_ResetMasterPan by their code
#define SND_CHANNEL_TIMER_MIN 0x10
#define SND_CHANNEL_TIMER_MAX 0xffff
// The channels' timer clock, half the system clock
#define SND_TIMER_CLOCK 16756991

// What the speakers' left and right outputs take, and where channels 1 and 3 go
typedef enum {
    SND_OUTPUT_MIXER,
    SND_OUTPUT_CHANNEL1,
    SND_OUTPUT_CHANNEL3,
    SND_OUTPUT_CHANNEL1_3,
} SNDOutput;

typedef enum {
    SND_CHANNEL_OUT_MIXER,
    SND_CHANNEL_OUT_BYPASS,
} SNDChannelOut;

void SND_LockChannel(u32 chBitMask, u32 flags);
void SND_UnlockChannel(u32 chBitMask, u32 flags);
void SND_SetChannelTimer(u32 chBitMask, int timer); // swan's sndSetRate
void SND_SetMasterVolume(int volume);               // swan's sndSetMasterVolume
void SND_SetOutputSelector(SNDOutput left, SNDOutput right, SNDChannelOut channel1, SNDChannelOut channel3);
void SND_SetMasterPan(int pan);
void SND_ResetMasterPan(void);
#define SND_MASTER_PAN_RESET (-1)

// What the driver reports: NitroSDK's SND_ReadDriverInfo, which copies the driver's state to info,
// SND_GetPlayerStatus and SND_GetChannelStatus, bit masks of the players and channels at work, and SND_ReadTrackInfo
// from a copied state, by their code, and SND_GetPlayerTickCounter

// The work that the driver and the ARM9 share. The driver writes it, and the functions below read it
#define SND_DEFAULT_VARIABLE (-1)

// The ARM7's sound driver writes this memory while the ARM9 reads it, so the fields are volatile, as in NitroSDK
typedef struct SNDSharedPlayer {
    vs16 variable[SND_PLAYER_VARIABLE_MAX];
    vu32 tickCounter;
} SNDSharedPlayer;

typedef struct SNDSharedWork {
    vu32 finishCommandTag;
    vu32 playerStatus;
    vu16 channelStatus;
    vu16 captureStatus;
    vu32 padding[5];
    SNDSharedPlayer player[SND_PLAYER_NUM];
    vs16 globalVariable[SND_PLAYER_VARIABLE_MAX];
} SNDSharedWork;

extern SNDSharedWork *SNDi_SharedWork;

// The driver's state, as SND_ReadDriverInfo copies it. Its pointers are the ARM7's addresses, which the address of
// the state in the ARM7 turns into offsets. Only the fields that SND_ReadTrackInfo reads are named. The number of
// tracks, 20, and the size of a channel, 0x54, are what fill the space between the players and the address when the
// channel holds its link at 0x50: a guess
typedef struct SNDDriverChannel {
    u8 myNo;
    u8 unk_01[0x4f];
    const struct SNDDriverChannel *next;
} SNDDriverChannel;

typedef struct SNDTrack {
    u8 unk_00[2];
    u16 prgNo;
    u8 volume;
    u8 volume2;
    s8 pitch_bend;
    u8 bend_range;
    s8 pan;
    u8 unk_09[0xa];
    s8 transpose;
    u8 unk_14[0x28];
    const SNDDriverChannel *channel_list;
} SNDTrack;

#define SND_INVALID_TRACK_INDEX 0xff

typedef struct SNDPlayer {
    u8 unk_00[8];
    u8 tracks[SND_TRACK_NUM_PER_PLAYER];
    u8 unk_18[0xc];
} SNDPlayer;

typedef struct SNDDriverInfo {
    u8 unk_0000[0x540];
    SNDPlayer player[SND_PLAYER_NUM];
    SNDTrack track[20];
    SNDDriverChannel channel[SND_CHANNEL_NUM];
    u32 workAddress;
    u8 unk_11c4[0x1c];
} SNDDriverInfo;

// A track's state, as NNS_SndPlayerReadDriverTrackInfo reads it
typedef struct SNDTrackInfo {
    u16 prgNo;
    u8 volume;
    u8 volume2;
    s8 pitchBend;
    u8 bendRange;
    u8 pan;
    s8 transpose;
    u8 pad_;
    u8 chCount;
    u8 channel[SND_CHANNEL_NUM];
} SNDTrackInfo;

void SND_ReadDriverInfo(SNDDriverInfo *info);
u32 SND_GetPlayerStatus(void);
u32 SND_GetChannelStatus(void);
u32 SND_GetPlayerTickCounter(int playerNo);
BOOL SND_ReadTrackInfo(const SNDDriverInfo *driverInfo, int playerNo, int trackNo, SNDTrackInfo *trackInfo);
u32 SNDi_GetFinishedCommandTag(void);
void SNDi_InitSharedWork(SNDSharedWork *work);

// The volume in decibels, as a player or track takes it, of each linear volume 0 to 127. NitroSDK's
// SNDi_DecibelTable
extern const s16 SNDi_DecibelTable[128]; // swan's VOLUME_DB_TABLE

#endif // POKEBW2_NITRO_SND_H
