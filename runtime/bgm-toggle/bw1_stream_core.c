#include "bw1_stream_core.h"

static uint16_t u16(const uint8_t *p) { return p[0] | (uint16_t)p[1] << 8; }
static uint32_t u32(const uint8_t *p) { return u16(p) | (uint32_t)u16(p+2) << 16; }
static uint32_t minimum(uint32_t a,uint32_t b) { return a < b ? a : b; }
static int bounded(PwStream *s,uint32_t at,void *out,uint32_t n) {
    if (at>s->length || n>s->length-at || !s->read(s->context,at,out,n)) {
        s->failed=1; return 0;
    }
    return 1;
}

int PwStreamOpen(PwStream *s,PwStreamRead read,void *context,uint32_t length) {
    uint8_t h[104];
    s->read=read;s->context=context;s->length=length;s->failed=0;s->position=0;s->cachedBlock=UINT32_MAX;
    if (!bounded(s,0,h,sizeof h) || u32(h)!=0x4d525453 || u32(h+8)!=length
        || u16(h+4)!=0xfeff || u32(h+16)!=0x44414548 || u32(h+96)!=0x41544144) return 0;
    s->format=h[24];s->loop=h[25];s->channels=h[26];s->rate=u16(h+28);s->timer=u16(h+30);
    s->loopStart=u32(h+32);s->samples=u32(h+36);s->data=u32(h+40);s->blocks=u32(h+44);
    s->blockBytes=u32(h+48);s->blockSamples=u32(h+52);s->lastBytes=u32(h+56);s->lastSamples=u32(h+60);
    if ((s->format!=1 && s->format!=2) || s->channels!=2 || s->loop>1
        || s->rate!=32728 || s->timer!=16 || !s->samples || !s->blocks || !s->blockSamples
        || !s->lastSamples || s->lastSamples>s->blockSamples || s->loopStart>=s->samples
        || s->data<104 || s->data>length || !s->blockBytes || !s->lastBytes) return 0;
    /* Check multiplication using division, before calculating file offsets. */
    if (s->blocks-1>(UINT32_MAX-s->lastSamples)/s->blockSamples
        || (s->blocks-1)*s->blockSamples+s->lastSamples!=s->samples
        || s->lastBytes>(length-s->data)/2
        || s->blocks-1>((length-s->data)/2-s->lastBytes)/s->blockBytes) return 0;
    if (s->format==1) {
        if (s->blockSamples>s->blockBytes/2 || s->lastSamples>s->lastBytes/2) return 0;
    } else if (s->blockSamples>960 || s->blockBytes>484 || s->lastBytes>484
        || s->blockBytes<4+(s->blockSamples+1)/2 || s->lastBytes<4+(s->lastSamples+1)/2) return 0;
    return 1;
}

int PwStreamSeek(PwStream *s,uint32_t sample) {
    if (sample>s->samples) return 0;
    s->position=sample;s->cachedBlock=UINT32_MAX;return 1;
}

static const int16_t steps[89]={
    7,8,9,10,11,12,13,14,16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,80,88,97,107,118,130,
    143,157,173,190,209,230,253,279,307,337,371,408,449,494,544,598,658,724,796,876,963,1060,1166,
    1282,1411,1552,1707,1878,2066,2272,2499,2749,3024,3327,3660,4026,4428,4871,5358,5894,6484,
    7132,7845,8630,9493,10442,11487,12635,13899,15289,16818,18500,20350,22385,24623,27086,29794,32767};
static const int8_t changes[8]={-1,-1,-1,-1,2,4,6,8};

static int decode(PwStream *s,uint32_t block,uint32_t at,uint32_t bytes,uint32_t samples) {
    for (unsigned channel=0;channel<2;channel++) {
        if (!bounded(s,at+channel*bytes,s->encoded,bytes)) return 0;
        int sample=(int16_t)u16(s->encoded),index=s->encoded[2]&127;
        if (index>88) { s->failed=1;return 0; }
        for (uint32_t i=0;i<samples;i++) {
            unsigned code=(s->encoded[4+i/2]>>((i&1)*4))&15;
            int step=steps[index],delta=step/8;
            if(code&1)delta+=step/4;
            if(code&2)delta+=step/2;
            if(code&4)delta+=step;
            sample+=(code&8)?-delta:delta;
            if(sample>32767)sample=32767;
            if(sample< -32768)sample= -32768;
            index+=changes[code&7];if(index<0)index=0;if(index>88)index=88;
            s->decoded[channel][i]=(int16_t)sample;
        }
    }
    s->cachedBlock=block;return 1;
}

uint32_t PwStreamReadFrames(PwStream *s,int16_t *left,int16_t *right,uint32_t count) {
    uint32_t done=0;
    while(done<count && !s->failed) {
        if(s->position==s->samples) { if(!s->loop)break;s->position=s->loopStart; }
        uint32_t block=s->position/s->blockSamples,offset=s->position%s->blockSamples;
        uint32_t samples=block==s->blocks-1?s->lastSamples:s->blockSamples;
        uint32_t bytes=block==s->blocks-1?s->lastBytes:s->blockBytes;
        uint32_t n=minimum(count-done,samples-offset),at=s->data+block*s->blockBytes*2;
        if(s->format==1) {
            if(!bounded(s,at+offset*2,left+done,n*2) || !bounded(s,at+bytes+offset*2,right+done,n*2))break;
        } else {
            if(s->cachedBlock!=block && !decode(s,block,at,bytes,samples))break;
            for(uint32_t i=0;i<n;i++) {left[done+i]=s->decoded[0][offset+i];right[done+i]=s->decoded[1][offset+i];}
        }
        done+=n;s->position+=n;
    }
    for(uint32_t i=done;i<count;i++){left[i]=0;right[i]=0;}
    return done;
}
