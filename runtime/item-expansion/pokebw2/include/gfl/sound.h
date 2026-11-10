#ifndef POKEBW2_GFL_SOUND_H
#define POKEBW2_GFL_SOUND_H

#include "types.h"
#include "gfl/heap.h"
#include "nnsys/snd.h"
#include "struct_decls.h"

void GFL_SndBGMFadeIn(u16 frames);
void GFL_SndBGMFadeOut(u16 frames);
u32 GFL_SndBGMGetID(void);
// Sets the volume of the BGM's tracks in trackMask
void GFL_SndBGMSetVolume(u16 trackMask, s32 volume);
// Sets the tempo ratio of the BGM (256 is normal), and the pitch and pan of its tracks in trackMask, each that is
// not -1
void GFL_SndBGMSetParams(u16 trackMask, s32 tempoRatio, s32 pitch, s32 pan);
// The sound handle that plays the BGM
NNSSndHandle *GFL_SndBGMGetHandle(void);
// The sound heap, which sounds loaded for a while are loaded into above a saved level
NNSSndHeapHandle GFL_SndGetHeap(void);
// The BGM about to play: the next one while the BGM changes with a fade, else the one playing
u32 GFL_SndBGMGetRequestedID(void);
// Whether the sound thread is still loading the next BGM
BOOL GFL_SndIsLoadThreadRunning(void);
// Whether the card's data transfer interrupt is enabled
BOOL GFL_IRQCartDataTransferIsEnabled(void);
// Sets the output to stereo or mono
void GFL_SndSetStereo(BOOL stereo);
void GFL_SndUpdate(void);
BOOL GFL_SndBGMIsFading(void);
// The tick count of the BGM's sequence player
u32 GFL_SndBGMGetTick(void);
BOOL GFL_SndBGMIsPlaying(void);
// Leaves every channel of the sequence enabled
#define SND_CHANNEL_MASK_ALL 0xffff
#define SND_VOLUME_MAX 127
#define SND_PLAYER_MASK_ALL 0x3f

void GFL_SndBGMPlay(u32 bgm, u32 channelMask);
// Plays a BGM on the BGM2 player, over the BGM's (swan's name says otherwise)
void GFL_SndBGMStop(u32 bgm);
// Changes the BGM, fading the one playing out and the next one in over the frames given, while a thread loads it
void GFL_SndBGMRequestChange(u32 bgm, u16 channelMask, s32 fadeOutFrames, s32 fadeInFrames);
void GFL_SndBGMPop(void);
void GFL_SndBGMPush(void);
void GFL_SndBGMSetPaused(BOOL paused);
void GFL_SndDestroyHeap(void);
void GFL_SndInit(void);
// The player that plays a sequence
s32 GFL_SndSeqGetPlayerIndex(u32 seq);
// A sound player's handle
NNSSndHandle *GFL_SndPlayerGetHandle(s32 player);
BOOL GFL_SndPlayerIsActive(s32 player);
BOOL GFL_SndPlayerIsActiveAny(void);
void GFL_SndPlayerStop(s32 player);
void GFL_SndPlayerSetVolume(s32 player, u32 volume);
// Changes each value that is not -1: the tempo ratio, and the pitch and pan of every track
void GFL_SndPlayerSetParams(s32 player, s32 tempoRatio, s32 pitch, s32 pan);
void GFL_SndPlayerSetVolumeEx(u32 volume, u32 playerMask);
void GFL_SndSEPlay(u32 se);
// Plays a sound effect at a volume below 128, or at the sequence's own volume
void GFL_SndSEPlayEx(u32 se, u32 volume);
void GFL_SEPlayKeepVol(u32 se, s32 player);
// Called once with start TRUE for a sequence, then each frame with FALSE until it returns TRUE
BOOL GFL_SndBGMLoadStep(u32 seq, u32 *step, BOOL start);
void GFL_SndBGMStopImmediate(void);
// Sound the musical's stage plays: names unknown
BOOL GFL_SndBGMSetLoadedData(void *seqData, void *bankData, u32 seq);
// Points wave index of the loaded wave archive waveArc at wave srcIndex of srcWaveArc
BOOL GFL_SndReplaceWave(u16 waveArc, u16 index, const SNDWaveArc *srcWaveArc, u16 srcIndex);
void GFL_SndBGMStartSeq(u16 seq);
void GFL_SndBGMStopSeq(void);
void GFL_SndBGMClearLoadedData(void);
// Sets the callback that says whether a sequence may play while the sound thread is loading
void GFL_SndSetSeqVerifyCallback(BOOL (*callback)(u32 seq));
BOOL GFL_SndIsPlaying(u32 seq);
void GFL_SndStop(void);
void GFL_SndSetVolumeControlCallbacks(void);
BOOL GFL_SndIsVolumeControlCallbackSet(void);
// Sets the players in playerMask to full volume when on, else silences them
void GFL_SndPlayerSetMuteStateEx(BOOL on, u32 playerMask);
// The BGM stack (snd_bgm_stack.c): the BGM player's handle and sequence at each level, with the sound heap's levels.
// GFL_SndBGMStack_SetHeap gives it the sound heap, GFL_SndBGMStack_Init resets it for the BGM player.
// GFL_SndGetLastResID is the sequence of the current level, or 0, and GFL_SndBGMStack_GetDepth the level.
// GFL_SndBGMStack_LoadSeq loads a BGM's sequence, bank and waves; GFL_SndBGMStack_SaveSeqLevel and
// GFL_SndBGMStack_SetLoadedSeq record the heap's level after a thread loaded the sequence and bank, and the waves of
// seq. GFL_SndBGMStack_FreeSeq frees the current BGM's files. GFL_SndBGMStack_Push pushes a level, freeing the waves of
// the BGM below, and GFL_SndBGMStack_Pop pops one, loading them again
void GFL_SndBGMStack_SetHeap(NNSSndHeapHandle *heap);
void GFL_SndBGMStack_Init(u16 player);
u32 GFL_SndGetLastResID(void);
s32 GFL_SndBGMStack_GetDepth(void);
NNSSndHandle *GFL_SndBGMStack_GetHandle(void);
BOOL GFL_SndBGMStack_LoadSeq(u32 seq);
void GFL_SndBGMStack_SaveSeqLevel(void);
BOOL GFL_SndBGMStack_SetLoadedSeq(u32 seq);
void GFL_SndBGMStack_FreeSeq(void);
BOOL GFL_SndBGMStack_Push(void);
BOOL GFL_SndBGMStack_Pop(void);
// Loads sound sequences ahead of time, and frees them
u32 GFL_SndBGMStack_Preload(const u32 *seqs, u32 count);
void GFL_SndBGMStack_Unload(u32 handle);

// A stream of music, which the title screen plays
void GFL_SndStreamInit(HeapID heapId);
void GFL_SndStreamFree(void);
void GFL_SndStreamUpdate(void);
// Whether GFL_SndStreamInit has run
BOOL GFL_SndStreamCheckInit(void);
void GFL_SndStreamPlay(u32 stream);
void GFL_SndStreamStop(void);
BOOL GFL_SndStreamIsPlaying(void);
void GFL_SndStreamFadeStop(u32 frames);

// The save's Chatot recording, which a cry of Chatot plays in place of its own
typedef struct {
    void *chatter;
} PokeVoiceChatterInfo;

void PokeVoice_CreateChatterInfo(PokeVoiceChatterInfo *info);

// What PokeVoice_Init is given: the wave archive of a species and form's cry, and the cry's volume with, when the
// cry is not the wave archive's (a Chatot's recording), its samples, their count, sample rate and speed, returning
// TRUE. The game's are getResIDFunc and getWaveInfoFunc
typedef void (*PokeVoiceGetResIDFunc)(u32 species, u32 form, u32 *waveArc);
typedef BOOL (*PokeVoiceGetWaveInfoFunc)(u32 species, u32 form, const PokeVoiceChatterInfo *chatterInfo, void **samples,
                                         u32 *size, u32 *sampleRate, u32 *speed, s8 *volume);

void PokeVoice_Init(u16 a0, PokeVoiceGetResIDFunc getResID, PokeVoiceGetWaveInfoFunc getWaveInfo);
// Releases the handles whose cries have ended; called each frame
void PokeVoice_Update(void);
void getResIDFunc(u32 species, u32 form, u32 *waveArc);
BOOL getWaveInfoFunc(u32 species, u32 form, const PokeVoiceChatterInfo *chatterInfo, void **samples, u32 *size,
                     u32 *sampleRate, u32 *speed, s8 *volume);

// Cries are played through handles. A cry has a pan (64 is the center), and with chorus a second voice whose volume
// and speed are relative to the first's; reverse plays it backwards. PokeVoice_Load only readies the cry
u32 PokeVoice_Load(u32 species, u32 form, u32 pan, u32 chorus, u32 chorusVolume, u32 chorusSpeed, u32 reverse,
                   const PokeVoiceChatterInfo *chatterInfo);
u32 PokeVoice_Play(u32 species, u32 form, u32 pan, u32 chorus, u32 chorusVolume, u32 chorusSpeed, u32 reverse,
                   const PokeVoiceChatterInfo *chatterInfo);
BOOL PokeVoice_StartPlayback(u32 handle);
void PokeVoice_AdjustVolume(u32 handle, s8 volume);
void PokeVoice_AdjustSpeed(u32 handle, s32 speed);
BOOL PokeVoice_IsPlaying(u32 handle);
BOOL PokeVoice_IsPlayingAny(void);
// Room for count cries at once, and its release
void PokeVoice_AllocMulti(int count, HeapID heapId);
void PokeVoice_FreeMulti(void);
void PokeVoice_ReleaseAll(void);
void PokeVoice_Release(u32 handle);
// What a handle plays: its volume, speed, samples, count of samples and sample rate
s8 PokeVoice_GetVolume(u32 handle);
int PokeVoice_GetSpeed(u32 handle);
const s8 *PokeVoice_GetSamples(u32 handle);
u32 PokeVoice_GetSampleCount(u32 handle);
int PokeVoice_GetSampleRate(u32 handle);
void PokeVoice_ResetMasterVolume(void);
void PokeVoice_SetMasterVolume(u32 volume);

// The microphone, which records Chatot's cry: set up, free, and record into a buffer, calling back when done
void setupMic(HeapID heapId);
void ampOffFreeBlocks(void);
void SndMic_AddCount(u32 a0);
BOOL SndMic_IsOverLimit(void);
// 0 once the recording has started
u32 SndMic_StartRecording(void (*callback)(u32 result, u32 *done), u32 *done);
// Saves the recording as the Chatot's
void SndMic_EncodeChatter(void *chatter);

// The BGM info archive: which interactive sound subsystem each BGM uses (ISS_SUBSYSTEM_*), or 0 for none
BGMInfo *BGMInfo_Create(HeapID heapId);
void BGMInfo_Free(BGMInfo *info);
u8 BGMInfo_GetISSSubsystem(BGMInfo *info, u16 bgm);

#endif // POKEBW2_GFL_SOUND_H
