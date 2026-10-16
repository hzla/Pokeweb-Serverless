#include "bw1_stream_core.h"
#include "bw1_native.generated.h"

/* Own the reader and decoder; the game's low-level stream driver owns ARM7
 * commands, alarm delivery and channel reservations. No filesystem work is
 * performed in an alarm callback. All memory has the resident DLL's lifetime. */
extern uint32_t PokewebFindBgmStream(const void *,uint32_t);
__attribute__((used)) uint32_t PokewebBgmConfig[8]={0x53424750,0x00010002,32,0x000a0000,0x00200000,0x32474250,0x811c9dc5,0};

#define SEGMENTS 8
#define FRAMES 1024
#define BUFFER_BYTES (SEGMENTS*FRAMES*4)
#define NONE 0xffff
#define FN(name,result,args) ((result (*)args)(uintptr_t)NATIVE_##name)
#define irqOff() FN(OS_DisableInterrupts,uint32_t,(void))()
#define irqRestore(n) FN(OS_RestoreInterrupts,void,(uint32_t))(n)
#define lock() FN(OS_LockMutex,void,(void*))(mutex)
#define unlock() FN(OS_UnlockMutex,void,(void*))(mutex)

/* The exported diagnostic block is also used by fresh-boot emulator checks.
 * No pointers or diagnostic values are written into the game's save data. */
__attribute__((used)) volatile uint32_t PokewebStreamDiagnostics[16]={0x31575350};
static uint32_t streamObject[32],file[24],thread[128],mutex[16],queue[2];
static uint64_t stack[512];
static uint8_t bufferStorage[BUFFER_BYTES+31];
static int16_t *buffer;
static PwStream decoder;
static uint32_t archiveLength,streamOffset,streamLength;
static uint32_t segmentEnd[SEGMENTS],segmentFrames[SEGMENTS];
static volatile uint32_t pendingMask,readHead,writeHead,queueItems[SEGMENTS],fault,drained,consumed;
static volatile uint32_t requestSerial,requestId=NONE,requestSequence=NONE,requestStandalone;
static uint32_t handledSerial,initialized,opened,channelsOwned,playing,paused,selected=NONE,standalone,completed;
static uint32_t requestedVolume=127,standaloneVolume=127,standalonePaused,muted,comboLatched;
/* Native themes can mute individual instruments (for example seasonal route
 * arrangements). Keep those masks separate from whole-song volume, and retain
 * them for hierarchy players suspended during a battle. */
static uint8_t nativeTrackVolume[16][16],nativeVolume[16];
static uint32_t knownPlayers;
static uint8_t channelNos[2];
static int previousVolume=1;

static uint16_t u16(const uint8_t *p){return p[0]|(uint16_t)p[1]<<8;}
static uint32_t u32(const uint8_t *p){return u16(p)|(uint32_t)u16(p+2)<<16;}
static int readArchive(uint32_t at,void *out,uint32_t n){
    if(at>archiveLength || n>archiveLength-at || at>0x7fffffff)return 0;
    if(!FN(FS_SeekFile,int,(void*,int,int))(file,(int)at,0))return 0;
    return FN(FS_ReadFile,int,(void*,void*,int))(file,out,n)==(int)n;
}
static int readStream(void *unused,uint32_t at,void*out,uint32_t n){
    (void)unused;return at<=streamLength && n<=streamLength-at && readArchive(streamOffset+at,out,n);
}
static int openArchive(uint32_t id){
    uint8_t h[64],b[24];
    FN(FS_InitFile,void,(void*))(file);
    if(!FN(FS_OpenFile,int,(void*,const char*))(file,"rom:/wb_sound_data.sdat"))return 0;
    opened=1;archiveLength=0x7fffffff;
    if(!readArchive(0,h,48)||u32(h)!=0x54414453)return 0;
    archiveLength=u32(h+8);
    uint32_t info=u32(h+24),infoSize=u32(h+28),fat=u32(h+32);
    if(info>archiveLength||infoSize>archiveLength-info||infoSize<40
        ||!readArchive(info,h,40)||u32(h)!=0x4f464e49)return 0;
    uint32_t players=u32(h+32),streams=u32(h+36);
    if(streams>infoSize-4||!readArchive(info+streams,b,4)||id>=u32(b))return 0;
    if(id>(infoSize-streams-4)/4||!readArchive(info+streams+4+id*4,b,4))return 0;
    uint32_t record=u32(b);
    if(!record||record>infoSize-12||!readArchive(info+record,b,12))return 0;
    uint32_t fileId=u32(b),player=b[6];
    if(players>infoSize-4||!readArchive(info+players,b,4)||player>=u32(b))return 0;
    if(player>(infoSize-players-4)/4||!readArchive(info+players+4+player*4,b,4))return 0;
    record=u32(b);
    if(!record||record>infoSize-24||!readArchive(info+record,b,24)||b[0]!=2||b[1]>15||b[2]>15||b[1]==b[2])return 0;
    channelNos[0]=b[1];channelNos[1]=b[2];
    if(!readArchive(fat,b,12)||u32(b)!=0x20544146||fileId>=u32(b+8))return 0;
    if(fileId>(archiveLength-fat-12)/16||!readArchive(fat+12+fileId*16,b,8))return 0;
    streamOffset=u32(b);streamLength=u32(b+4);
    if(streamOffset>archiveLength||streamLength>archiveLength-streamOffset)return 0;
    return PwStreamOpen(&decoder,readStream,0,streamLength);
}

static void fill(uint32_t slot){
    int16_t *left=buffer+slot*FRAMES,*right=buffer+SEGMENTS*FRAMES+slot*FRAMES;
    segmentFrames[slot]=PwStreamReadFrames(&decoder,left,right,FRAMES);
    segmentEnd[slot]=decoder.position;
    FN(DC_FlushRange,void,(void*,uint32_t))(left,FRAMES*2);
    FN(DC_FlushRange,void,(void*,uint32_t))(right,FRAMES*2);
    PokewebStreamDiagnostics[6]++;
    if(decoder.failed)fault=2;
}

static void callback(int status,int channels,void **buffers,uint32_t length,int format,void *arg){
    (void)channels;(void)length;(void)format;(void)arg;
    if(!status||!playing||fault)return;
    uint32_t slot=((int16_t*)buffers[0]-buffer)/FRAMES;
    if(slot>=SEGMENTS || (pendingMask&(1u<<slot)) || writeHead-readHead>=SEGMENTS){fault=1;return;}
    consumed=segmentEnd[slot];
    if(!decoder.loop && segmentFrames[slot]<FRAMES){drained=1;return;}
    pendingMask|=1u<<slot;queueItems[writeHead%SEGMENTS]=slot;writeHead++;
    PokewebStreamDiagnostics[5]++;
    FN(OS_WakeupThread,void,(void*))(queue);
}

static void worker(void *arg){
    (void)arg;
    for(;;){
        uint32_t irq=irqOff();
        if(readHead==writeHead)FN(OS_SleepThread,void,(void*))(queue);
        irqRestore(irq);
        lock();
        if(readHead!=writeHead){
            uint32_t slot=queueItems[readHead%SEGMENTS];
            if(playing&&!fault&&!drained)fill(slot);
            irq=irqOff();pendingMask&=~(1u<<slot);readHead++;irqRestore(irq);
        }
        unlock();
    }
}
static void initialize(void){
    if(initialized)return;
    buffer=(int16_t*)(((uintptr_t)bufferStorage+31)&~(uintptr_t)31);
    FN(OS_InitMutex,void,(void*))(mutex);
    FN(NNS_SndStrmInit,void,(void*))(streamObject);
    FN(OS_CreateThread,void,(void*,void(*)(void*),void*,void*,uint32_t,uint32_t))(thread,worker,0,stack+512,sizeof stack,15);
    initialized=1;
    FN(OS_WakeupThreadDirect,void,(void*))(thread);
}
static void stopHardware(void){
    playing=0;
    FN(NNS_SndStrmStop,void,(void*))(streamObject);
    if(channelsOwned)FN(NNS_SndStrmFreeChannel,void,(void*))(streamObject);
    channelsOwned=0;
    uint32_t irq=irqOff();pendingMask=readHead=writeHead=0;irqRestore(irq);
}
static void closeStream(void){
    stopHardware();
    if(opened)FN(FS_CloseFile,int,(void*))(file);
    opened=0;paused=0;
}
static int startHardware(uint32_t position){
    if(!PwStreamSeek(&decoder,position))return 0;
    fault=drained=0;consumed=position;
    for(uint32_t i=0;i<SEGMENTS;i++)fill(i);
    if(fault)return 0;
    if(!FN(NNS_SndStrmAllocChannel,int,(void*,int,const uint8_t*))(streamObject,2,channelNos))return 0;
    channelsOwned=1;
    if(!FN(NNS_SndStrmSetup,int,(void*,int,void*,uint32_t,int,int,void*,void*))(streamObject,1,buffer,BUFFER_BYTES,decoder.timer,SEGMENTS,callback,0))return 0;
    FN(SendSoundCommand,void,(int,uint32_t,uint32_t,uint32_t,uint32_t))(0x15,1u<<channelNos[0],0,0,0);
    FN(SendSoundCommand,void,(int,uint32_t,uint32_t,uint32_t,uint32_t))(0x15,1u<<channelNos[1],127,0,0);
    /* Begin silent; frame processing applies the native effective volume. */
    FN(NNS_SndStrmSetVolume,void,(void*,int))(streamObject,-32768);
    playing=1;previousVolume=1;
    FN(NNS_SndStrmStart,void,(void*))(streamObject);
    return 1;
}

/* Decibel scale used by the native sequence player: 0 = full volume. */
#include "bw1_volume.generated.h"
static void applyVolume(void){
    int volume=0;
    if(standalone)volume=decibels[standaloneVolume];
    else {
        void **handle=FN(PMSND_GetBGMhandlePointer,void**,(void))();
        if(!handle||!*handle)volume=-32768;
        else volume=*(int16_t*)((uint8_t*)*handle+0x3e)+decibels[requestedVolume];
    }
    if(muted)volume=-32768;
    if(volume< -32768)volume=-32768;
    if(playing&&volume!=previousVolume){FN(NNS_SndStrmSetVolume,void,(void*,int))(streamObject,volume);previousVolume=volume;}
}

static uint32_t nativePlayer(void *handle){
    if(!handle||!*(void**)handle)return NONE;
    uint32_t player=((uint8_t*)*(void**)handle)[0x3c];
    if(player>=16)return NONE;
    if(!(knownPlayers&(1u<<player))){
        nativeVolume[player]=127;
        for(uint32_t t=0;t<16;t++)nativeTrackVolume[player][t]=127;
        knownPlayers|=1u<<player;
    }
    return player;
}
static void applyNativeMute(void *handle){
    uint32_t player=nativePlayer(handle);
    if(player==NONE)return;
    if(muted){FN(NNS_SndPlayerSetTrackVolume,void,(void*,uint32_t,int))(handle,0xffff,0);return;}
    uint32_t done=0;
    for(uint32_t t=0;t<16;t++){
        if(done&(1u<<t))continue;
        uint32_t mask=0,volume=nativeTrackVolume[player][t];
        for(uint32_t other=t;other<16;other++)if(nativeTrackVolume[player][other]==volume)mask|=1u<<other;
        done|=mask;
        FN(NNS_SndPlayerSetTrackVolume,void,(void*,uint32_t,int))(handle,mask,volume);
    }
}
uint32_t PokewebBgmMute(uint32_t toggle){
    if(toggle==1){
        muted^=1;
        void *handle=FN(PMSND_GetBGMhandlePointer,void*,(void))();
        applyNativeMute(handle);
        applyVolume();
    }
    return muted;
}
void Bw1TrackVolume(void*handle,uint32_t mask,int volume){
    if(volume<0)volume=0;
    if(volume>127)volume=127;
    mask&=0xffff;
    uint32_t player=nativePlayer(handle);
    if(player!=NONE){
        for(uint32_t t=0;t<16;t++)if(mask&(1u<<t))nativeTrackVolume[player][t]=volume;
        if(mask==0xffff)nativeVolume[player]=volume;
        requestedVolume=nativeVolume[player];
    }
    FN(NNS_SndPlayerSetTrackVolume,void,(void*,uint32_t,int))(handle,mask,muted?0:volume);
}
int Bw1StartSequence(void*handle,int player,int bank,int priority,int sequence){
    int result=FN(NNS_SndArcPlayerStartSeqEx,int,(void*,int,int,int,int))(handle,player,bank,priority,sequence);
    if(result){
        requestSequence=sequence;requestId=PokewebFindBgmStream(PokewebBgmConfig,sequence);
        requestStandalone=0;requestedVolume=127;requestSerial++;
        uint32_t player=nativePlayer(handle);
        if(player!=NONE){knownPlayers&=~(1u<<player);nativePlayer(handle);}
        if(muted)applyNativeMute(handle);
    }
    return result;
}
void Bw1StopSequence(void*handle,int frames){
    FN(NNS_SndPlayerStopSeq,void,(void*,int))(handle,frames);
    if(!frames){requestId=NONE;requestSequence=NONE;requestStandalone=0;requestSerial++;}
}

/* Standalone ABI. Play requests are applied on the next sound update. A new
 * game BGM request takes ownership back. Position is in source PCM frames. */
int PokewebStreamPlay(uint32_t id){if(id>=NONE)return 0;requestId=id;requestSequence=NONE;requestStandalone=1;standalonePaused=0;standaloneVolume=127;requestSerial++;return 1;}
void PokewebStreamStop(void){requestId=NONE;requestSequence=NONE;requestStandalone=1;requestSerial++;}
void PokewebStreamPause(uint32_t pause){standalonePaused=!!pause;}
void PokewebStreamSetVolume(uint32_t volume){standaloneVolume=volume>127?127:volume;}
uint32_t PokewebStreamPosition(void){return consumed;}

void Bw1SoundUpdate(void){
#ifdef POKEWEB_STREAM_TEST
    extern void Bw1TestUpdate(void);
    Bw1TestUpdate();
#endif
    FN(PMSND_Main,void,(void))();
    /* Battle exit can restore the previous hierarchy player without starting
     * a sequence again. Follow its active ID as well as explicit start hooks. */
    if(!requestStandalone){
        uint32_t sequence=FN(PMSND_GetBGMsoundNo,uint32_t,(void))();
        void **handle=FN(PMSND_GetBGMhandlePointer,void**,(void))();
        if(sequence&&handle&&*handle&&sequence!=requestSequence){
            requestSequence=sequence;requestId=PokewebFindBgmStream(PokewebBgmConfig,sequence);
            uint32_t player=nativePlayer(handle);
            requestedVolume=player==NONE?127:nativeVolume[player];
            applyNativeMute(handle);
            requestSerial++;
        }
    }
    uint32_t combo=(*(volatile uint16_t*)0x04000130&0x304)==0;
    if((PokewebBgmConfig[1]&0x10000)&&combo&&!comboLatched)PokewebBgmMute(1);
    comboLatched=combo;
    if(requestSerial!=handledSerial){
        if(requestId!=NONE)initialize();
        if(initialized){
            lock();closeStream();selected=requestId;standalone=requestStandalone;completed=0;
            handledSerial=requestSerial;
            PokewebStreamDiagnostics[1]=selected;PokewebStreamDiagnostics[2]=requestSequence;
            if(selected!=NONE){
                if(!openArchive(selected)||!startHardware(0)){closeStream();fault=3;completed=1;}
                else PokewebStreamDiagnostics[7]++;
            }
            unlock();
        }else handledSerial=requestSerial;
    }
    if(initialized&&selected!=NONE&&!completed){
        lock();
        void **handle=FN(PMSND_GetBGMhandlePointer,void**,(void))();
        if(fault||drained||(!standalone&&(!handle||!*handle))){
            PokewebStreamDiagnostics[4]=fault;closeStream();completed=1;
        }else{
            uint32_t pause=standalone?standalonePaused:((uint8_t*)*handle)[0x2e];
            if(pause&&!paused){stopHardware();paused=1;}
            else if(!pause&&paused){if(!startHardware(consumed)){closeStream();fault=4;completed=1;}paused=0;}
            applyVolume();
        }
        unlock();
    }
    PokewebStreamDiagnostics[3]=playing;PokewebStreamDiagnostics[8]=consumed;
    PokewebStreamDiagnostics[9]=paused;PokewebStreamDiagnostics[10]=muted;PokewebStreamDiagnostics[11]++;
    PokewebStreamDiagnostics[12]=previousVolume;PokewebStreamDiagnostics[13]=fault;
    PokewebStreamDiagnostics[14]=decoder.position;PokewebStreamDiagnostics[15]=completed;
#ifdef POKEWEB_STREAM_TEST
    extern volatile uint32_t PokewebStreamTest[8];
    void **testHandle=FN(PMSND_GetBGMhandlePointer,void**,(void))();
    PokewebStreamTest[6]=requestedVolume;
    PokewebStreamTest[7]=testHandle?(uint32_t)(uintptr_t)*testHandle:0;
#endif
}
