#include "runtime.h"
#include "graphics.generated.h"

extern "C" { __attribute__((used,section(".summary_config"))) volatile Configuration summaryStatConfiguration = {
    {'S','S','V','C','F','G','1',0},1,sizeof(Configuration),1,0x53535630
}; }
namespace {
struct Session {
    void* work;
    void* actor;
    void* unit;
    u32 cgr[3];
    u32 variant; // Native page stays 1: 0=Stats, 1=IVs, 2=EVs.
    u32 compact;
    u32 proxy[9];
    u8 hit[40];
} session;
bool evs() { return summaryStatConfiguration.version==1 && summaryStatConfiguration.size==20
    && summaryStatConfiguration.flags<=1 && summaryStatConfiguration.check==(summaryStatConfiguration.flags^0x53535631)
    && summaryStatConfiguration.flags==1; }
bool eligible(void* work) { return work && !at<u32>(work,0x38) && at<u8>(at<void*>(work,8),0xd)!=2; }
bool custom() { return session.work && session.actor && session.variant && eligible(session.work); }
void sequence(void* a,u32 n) { api<void(*)(void*,u32)>(0x204c4b4)(a,n); }
void visible(void* a,bool on) { api<void(*)(void*,u32)>(0x204c150)(a,on); }
void position(void* a,u16 x) { s16 xy[2]={static_cast<s16>(x),168}; api<void(*)(void*,const s16*)>(0x204c23c)(a,xy); }
void proxy(void* a,u32 cgr) {
    api<void(*)(u32,void*)>(0x204bb84)(cgr,session.proxy);
    api<void(*)(void*,const void*)>(0x204c410)(a,session.proxy);
}
void footer() {
    void* w=session.work;
    if (!w || !session.actor) return;
    const bool allowed=eligible(w);
    const u32 compact=allowed && at<u32>(w,0x40);
    if (compact!=session.compact) {
        for (u32 i=0;i<3;i++) {
            void* a=at<void*>(w,0x178+i*4);
            proxy(a,compact?session.cgr[0]:at<u32>(w,0xc8));
            position(a,static_cast<u16>(i==2?(compact?90:80):(compact?i*30:i*40)));
        }
        proxy(session.actor,session.cgr[compact?2:1]);
        position(session.actor,compact?60:80);
        session.compact=compact;
    }
    const bool stats=at<u32>(w,0x58)==1;
    sequence(session.actor,stats && session.variant?5:2);
    if (stats && session.variant) sequence(at<void*>(w,0x17c),1);
    // Native wait/transition states continue to own visibility of all pages.
    visible(session.actor,allowed && at<u32>(w,0x44)==1);
}
void dispose() {
    if (session.actor) api<void(*)(void*)>(0x204c134)(session.actor);
    if (session.unit) api<void(*)(void*)>(0x204bfc4)(session.unit);
    for (u32 i=0;i<3;i++) if (session.cgr[i]!=0xffffffff) api<void(*)(u32)>(0x204b9b8)(session.cgr[i]);
    session.actor=nullptr;session.unit=nullptr;session.work=nullptr;session.variant=0;
    for (u32 i=0;i<3;i++) session.cgr[i]=0xffffffff;
}
void attach(void* w) {
    u16 heap=at<u16>(w,0);
    const u8* banks[3]={compactTabs,statTabs,compactStatTabs};
    for (u32 i=0;i<3;i++) {
        session.cgr[i]=api<u32(*)(u32,u32,u32)>(0x204b8e8)(2304,0,heap);
        if (session.cgr[i]==0xffffffff) { dispose();return; }
        // Prepare complete immutable resources during native initialization,
        // before its fade-in. Later updates change only actor proxies.
        api<void(*)(u32,const void*,u32,u32,u32)>(0x204bae4)(session.cgr[i],banks[i],2304,0,0);
    }
    session.unit=api<void*(*)(u32,u32,u32)>(0x204bf48)(1,0,heap);
    if (!session.unit) {dispose();return;}
    struct ActorData { u16 x,y,sequence;u8 priority,bg; } data={80,168,2,10,0};
    session.actor=api<void*(*)(void*,u32,u32,u32,const void*,u32,u32)>(0x204c06c)(
        session.unit,session.cgr[1],at<u32>(w,0x98),at<u32>(w,0xfc),&data,0,heap);
    if (!session.actor) {dispose();return;}
    api<void(*)(void*,u32)>(0x204c54c)(session.actor,1);
    session.compact=0xffffffff;
    footer();
}
void change(void* w,u32 page,u32 variant,bool touch) {
    session.variant=variant;
    at<u32>(w,0x58)=page;
    overlay<void(*)(void*)>(0x21b4a10)(w);
    api<void(*)(u32)>(0x2006254)(1637);
    at<u8>(w,0x1c)=touch?1:0;
}
}
extern "C" int SummaryInit(void* w) {
    session.work=w;session.variant=0;session.actor=nullptr;session.unit=nullptr;
    for (u32 i=0;i<3;i++) session.cgr[i]=0xffffffff;
    int result=overlay<int(*)(void*)>(0x21b2fc0)(w);
    if (result==1) attach(w);
    return result;
}
extern "C" int SummaryEnd(void* w) {
    // Remove the private actor/unit before native animation banks are released.
    dispose();
    return overlay<int(*)(void*)>(0x21b3198)(w);
}
extern "C" void SummaryTick(void* queue) {
    api<void(*)(void*)>(0x2021a68)(queue);
    footer();
}
extern "C" int SummaryKeys(void* w) {
    u32 keys=api<u32(*)()>(0x203df70)();
    u32 page=at<u32>(w,0x58);
    if (!session.actor || !eligible(w) || page>2 || (keys&0xc0)) return overlay<int(*)(void*)>(0x21b404c)(w);
    if (keys&0x10) {
        if (page==0) session.variant=0;
        else if (page==1) {
            if (!session.variant) change(w,1,1,false);
            else if (session.variant==1 && evs()) change(w,1,2,false);
            else if (at<u32>(w,0x40)) change(w,2,session.variant,false);
            return 1;
        } else return 1;
    } else if (keys&0x20) {
        if (page==2) {change(w,1,evs()?2:1,false);return 1;}
        if (page==1 && session.variant) {change(w,1,session.variant-1,false);return 1;}
    }
    return overlay<int(*)(void*)>(0x21b404c)(w);
}
extern "C" int SummaryTouch(void* w) {
    u32 hit=at<u32>(w,0x24);
    if (session.actor && eligible(w)) {
        if (hit==8) {change(w,1,1,true);return 1;}
        if (hit==1 && session.variant && at<u32>(w,0x58)==1) {change(w,1,0,true);return 1;}
        if (hit==0 || hit==1) session.variant=0;
    }
    return overlay<int(*)(void*)>(0x21b4220)(w);
}
extern "C" int SummaryHit(const u8* table) {
    if (!session.actor) return api<int(*)(const u8*)>(0x203da38)(table);
    for (u32 i=0;i<32;i++) session.hit[i]=table[i];
    // Native rectangle order is y-min,y-max,x-min,x-max, inclusive.
    u32 width=session.compact?30:40;
    for (u32 i=0;i<3;i++) {
        session.hit[i*4+2]=i==2?(session.compact?90:80):i*width;
        session.hit[i*4+3]=session.hit[i*4+2]+width-1;
    }
    if (!session.compact) session.hit[8]=0xfd; // Native disabled-hit sentinel.
    for (u32 i=0;i<4;i++) session.hit[32+i]=table[4+i];
    session.hit[34]=session.compact?60:80;
    session.hit[35]=session.hit[34]+width-1;
    for (u32 i=0;i<4;i++) session.hit[36+i]=table[32+i];
    return api<int(*)(const u8*)>(0x203da38)(session.hit);
}
extern "C" u32 SummaryValue(void* pp,u32 field,void* out) {
    if (custom()) {
        // Native storage order has Speed before Sp. Atk / Sp. Def.
        if (field==160) field=session.variant==1?70:13;
        else if (field>=162 && field<=166) field=(session.variant==1?71:14)+field-162;
    }
    return api<u32(*)(void*,u32,void*)>(0x201cd24)(pp,field,out);
}
extern "C" void SummarySlash(void* w,void* window,u32 id,u32 x,u32 y,u32 color) {
    if (!custom()) overlay<void(*)(void*,void*,u32,u32,u32,u32)>(0x21b4f04)(w,window,id,x,y,color);
}
extern "C" void SummaryHp(void* w,void* window,void* words,u32 id,u32 x,u32 y,u32 color) {
    // Native Attack through Speed use a right edge of 105 in these windows.
    if (custom()) x=105;
    overlay<void(*)(void*,void*,void*,u32,u32,u32,u32)>(0x21b5080)(w,window,words,id,x,y,color);
}
extern "C" void SummaryMaxHp(void* w,void* window,void* words,u32 id,u32 x,u32 y,u32 color) {
    if (!custom()) overlay<void(*)(void*,void*,void*,u32,u32,u32,u32)>(0x21b5080)(w,window,words,id,x,y,color);
}
extern "C" u32 SummaryTitleChars(void* arc,u32 member,u32 frame,u32 offset,u32 length,u32 compressed,u32 heap) {
    u32 result=api<u32(*)(void*,u32,u32,u32,u32,u32,u32)>(0x204add4)(arc,member,frame,offset,length,compressed,heap);
    // Verified unused tiles 64..83 belong to BG5's existing character bank.
    api<void(*)(u32,const void*,u32,u32)>(0x20450ac)(5,titleGlyphs,sizeof(titleGlyphs),64);
    return result;
}
extern "C" void SummaryTitle(u32 frame,u32 x,u32 y,u32 width,u32 height,const u16* map,u32 sx,u32 sy,u32 sw,u32 sh) {
    if (custom()) map=session.variant==1?ivTitle:evTitle;
    api<void(*)(u32,u32,u32,u32,u32,const void*,u32,u32,u32,u32)>(0x2045500)(frame,x,y,width,height,map,sx,sy,sw,sh);
}
