// Native field-menu record adapter. Command dispatch and menu ownership stay retail.
using u8 = unsigned char;
using u16 = unsigned short;
using u32 = unsigned int;
#include "addresses.h"
struct Entry {
    u8 type, x, y, iconX, iconY, labelX, labelY, overrideLabel;
    u8 touch[4], neighbors[4];
    u16 text[25], reserved;
};
struct Config { u32 magic; u16 version, size; u32 enabled; Entry buttons[6]; };
static_assert(sizeof(Entry)==68 && sizeof(Config)==420, "UI configuration ABI");
extern "C" { __attribute__((used,section(".ui_screens"))) volatile Config uiScreens = {0x49555750,1,sizeof(Config),0,{}}; }
template<class T> T& at(void* p,u32 offset) { return *reinterpret_cast<T*>(static_cast<u8*>(p)+offset); }
template<class T> T native(u32 address) { return reinterpret_cast<T>(address|1); }
static bool ready() {
    if(uiScreens.magic!=0x49555750 || uiScreens.version!=1 || uiScreens.size!=sizeof(Config) || uiScreens.enabled!=1) return false;
    for(u32 i=0;i<6;i++) {
        const volatile Entry& e=uiScreens.buttons[i];
        if(e.type!=i+1 || e.x<64 || e.x>192 || e.x%8 || e.y<44 || e.y>140 || (e.y-20)%8) return false;
        if(e.iconX<28 || e.iconX>252 || e.iconY<42 || e.iconY>140 || e.labelX>24 || e.labelY<3 || e.labelY>18 || e.overrideLabel>1) return false;
        if(e.touch[0]<24 || e.touch[1]>160 || e.touch[0]>=e.touch[1] || e.touch[2]>=e.touch[3]) return false;
        for(u32 d=0;d<4;d++) if(e.neighbors[d]>7) return false;
    }
    return true;
}
static u32 kind(void* work,u32 slot) { return at<u32>(work,0x3c+slot*28); }
static bool ordinary(void* work) {
    if(at<u8>(work,0x21)!=0) return false;
    for(u32 i=0;i<6;i++) if(kind(work,i)>7) return false;
    return true;
}
static const volatile Entry* entry(u32 type) {
    if(type<1 || type>6) return nullptr;
    const volatile Entry* e=&uiScreens.buttons[type-1];
    return e->type==type ? e : nullptr;
}
extern "C" void UiCreate(void* work,void* record,const u32* parameters) {
    u32 p[8]; for(u32 i=0;i<8;i++) p[i]=parameters[i];
    void* label=nullptr;
    const volatile Entry* e=ready() && at<u8>(work,0x21)==0?entry(p[0]):nullptr;
    if(e) {
        auto* b=reinterpret_cast<u8*>(p);
        b[4]=e->x; b[5]=e->y; b[6]=e->labelX; b[7]=e->labelY; b[8]=e->iconX; b[9]=e->iconY;
        if(e->overrideLabel) {
            u16 text[25]; for(u32 i=0;i<25;i++) text[i]=e->text[i]; text[24]=0xffff;
            label=native<void*(*)(u32,u32)>(STRING_NEW)(25,at<u16>(work,2));
            if(label) { native<void(*)(void*,const u16*)>(STRING_SET)(label,text); p[3]=reinterpret_cast<u32>(label); }
        }
    }
    native<void(*)(void*,void*,const u32*)>(BUTTON_CREATE)(work,record,p);
    if(label) native<void(*)(void*)>(STRING_FREE)(label);
}
extern "C" u32 UiTouch(const u8* original,void* work) {
    u8 rects[32]; for(u32 i=0;i<32;i++) rects[i]=original[i];
    if(ready() && ordinary(work)) for(u32 slot=0;slot<6;slot++) {
        const volatile Entry* e=entry(kind(work,slot));
        if(e) for(u32 j=0;j<4;j++) rects[slot*4+j]=e->touch[j];
    }
    return native<u32(*)(const u8*)>(TOUCH_TEST)(rects);
}
static int absValue(int x) { return x<0?-x:x; }
extern "C" u32 UiNavigate(void* work,u32 direction) {
    if(!ready() || !ordinary(work) || direction>3) return native<u32(*)(void*,u32)>(NAVIGATE)(work,direction);
    u32 source=at<u8>(work,0x1e)+2*at<u8>(work,0x1f);
    if(source>6) return 0;
    const volatile Entry* from=entry(kind(work,source));
    int x=from?from->x:128, y=from?from->y:180;
    u32 wanted=from?from->neighbors[direction]:0;
    int best=-1, score=0x7fffffff;
    for(u32 slot=0;slot<7;slot++) {
        u32 type=kind(work,slot);
        const volatile Entry* to=entry(type);
        if(slot!=6 && (!to || at<u32>(work,0x34+slot*28)!=1)) continue;
        if(wanted && ((slot==6 && wanted==7) || (to && type==wanted))) { best=static_cast<int>(slot); break; }
        if(slot==source) continue;
        int dx=(to?to->x:128)-x, dy=(to?to->y:180)-y;
        int along=direction==0?-dy:direction==1?dy:direction==2?-dx:dx;
        int across=direction<2?absValue(dx):absValue(dy);
        int distance=along+4*across;
        if(along>0 && distance<score) { score=distance; best=static_cast<int>(slot); }
    }
    if(best<0 || static_cast<u32>(best)==source) return 0;
    at<u8>(work,0x1e)=static_cast<u8>(best&1); at<u8>(work,0x1f)=static_cast<u8>(best/2);
    return 1;
}
