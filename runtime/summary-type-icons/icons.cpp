#include "profiles.generated.h"
using u8=unsigned char;using u16=unsigned short;using u32=unsigned int;using s16=short;
#include "colors.generated.h"
template<class T> T& at(void* p,u32 n){return *reinterpret_cast<T*>(static_cast<u8*>(p)+n);}
template<class F> F api(u32 a){return reinterpret_cast<F>(nativeAddress(a)|1);}
template<class F> F ov(u32 a){return reinterpret_cast<F>(overlayAddress(a)|1);}
namespace {
constexpr u32 INVALID=0xffffffff;
struct Session{u32 magic;void* work;void* unit;void* actors[2];u32 chars[2],palette,cells;
    u32 banks[12];alignas(4) u16 palettes[2][16];alignas(4) u8 tiles[2][512];
    u32 pending,types[2],dirty,active;} session;
void reset(){session.magic=0x49545953;session.work=session.unit=nullptr;
    session.actors[0]=session.actors[1]=nullptr;session.chars[0]=session.chars[1]=INVALID;
    session.palette=session.cells=INVALID;session.pending=session.types[0]=session.types[1]=17;
    session.dirty=session.active=0;}
void dispose(){session.active=0;
    for(u32 i=0;i<2;i++)if(session.actors[i])api<void(*)(void*)>(0x204c134)(session.actors[i]);
    if(session.unit)api<void(*)(void*)>(0x204bfc4)(session.unit);
    for(u32 i=0;i<2;i++)if(session.chars[i]!=INVALID)api<void(*)(u32)>(0x204b9b8)(session.chars[i]);
    if(session.palette!=INVALID)api<void(*)(u32)>(0x204bcfc)(session.palette);
    if(session.cells!=INVALID)api<void(*)(u32)>(0x204be90)(session.cells);
    reset();}
const u32* banks(const u32* source){for(u32 i=0;i<12;i++)session.banks[i]=source[i];
    session.banks[5]=64;return session.banks;}
void* open(u32 heap){
    void* h=api<void*(*)(u32,u32,u32,const char*,u32)>(0x203a228)(heap,80,1,"summary-types",0);
    if(!h)return nullptr;
    api<void(*)(void*)>(0x2070ca8)(h);
    if(!api<u32(*)(void*,const char*)>(0x2070ecc)(h,"rom:/summary-type-icons/ui.narc")){
        api<void(*)(void*)>(0x203a278)(h);return nullptr;}
    api<void(*)(void*)>(0x204aac8)(h);return h;
}
u32 slot(void* native){if(!session.active||!session.work)return 2;
    for(u32 i=0;i<2;i++)if(at<void*>(session.work,0x198+i*4)==native)return i;
    return 2;}
void attach(void* work){
    const u32 heap=at<u16>(work,0);void* h=open(heap);if(!h)return;
    session.palette=api<u32(*)(void*,u32,u32,u32,u32,u32,u32)>(0x204bbe4)(h,0,0,512,0,0,heap);
    session.cells=api<u32(*)(void*,u32,u32,u32)>(0x204be0c)(h,1,2,heap);
    session.unit=api<void*(*)(u32,u32,u32)>(0x204bf48)(2,0,heap);
    bool ok=session.palette!=INVALID&&session.cells!=INVALID&&session.unit;
    for(u32 i=0;i<2&&ok;i++){
        session.chars[i]=api<u32(*)(void*,u32,u32,u32,u32)>(0x204b848)(h,3,0,0,heap);
        if(session.chars[i]==INVALID){ok=false;break;}
        struct ActorData{u16 x,y,sequence;u8 priority,bg;} pose={static_cast<u16>(96+i*34),16,0,10,1};
        session.actors[i]=api<void*(*)(void*,u32,u32,u32,const void*,u32,u32)>(0x204c06c)(
            session.unit,session.chars[i],session.palette,session.cells,&pose,0,heap);
        if(!session.actors[i]){ok=false;break;}
        api<void(*)(void*,u32)>(0x204c150)(session.actors[i],0);
    }
    api<void(*)(void*)>(0x204ab38)(h);
    if(!ok){dispose();return;}session.work=work;session.active=1;
}
}
extern "C" void IconBanks(const u32* config){reset();api<void(*)(const u32*)>(0x2046c6c)(banks(config));}
extern "C" void IconSystem(const void* setup,const u32* config,u32 heap){
    api<void(*)(const void*,const u32*,u32)>(0x204b6d4)(setup,banks(config),heap);}
extern "C" void IconResources(void* work){ov<void(*)(void*)>(0x21b36e4)(work);attach(work);}
extern "C" void IconGetProxy(u32 id,void* proxy){
    api<void(*)(u32,void*)>(0x204bb84)(id,proxy);session.pending=17;
    if(session.active)for(u32 i=0;i<17;i++)if(at<u32>(session.work,0x130+i*4)==id){session.pending=i;break;}
}
extern "C" void IconPalette(void* actor,u32 original,u32 mode){
    // Keep the hidden native actor's character and palette state unchanged.
    api<void(*)(void*,u32,u32)>(0x204c3a4)(actor,original,mode);
    const u32 i=slot(actor);if(i==2||session.pending>=17)return;
    volatile u32& ime=*reinterpret_cast<volatile u32*>(0x04000208);const u32 before=ime;ime=0;
    if(session.types[i]!=session.pending){
        const u32 type=session.pending;session.types[i]=type;
        for(u32 n=0;n<16;n++)session.palettes[i][n]=iconColors[type][n];
        for(u32 n=0;n<256;n++){const u8 p=iconTiles[type][n];session.tiles[i][n*2]=p&15;session.tiles[i][n*2+1]=p>>4;}
        session.dirty|=1u<<i;
    }
    api<void(*)(void*,u32,u32)>(0x204c3a4)(session.actors[i],i,1);
    session.pending=17;ime=before;
}
extern "C" void IconVisible(void* actor,u32 on){
    const u32 i=slot(actor);
    if(i<2){api<void(*)(void*,u32)>(0x204c150)(actor,0);
        api<void(*)(void*,u32)>(0x204c150)(session.actors[i],on);}
    else api<void(*)(void*,u32)>(0x204c150)(actor,on);
}
extern "C" void IconInfoPosition(void* actor,const s16* pos,u32 surface){
    const s16 moved[2]={pos[0],16};api<void(*)(void*,const s16*,u32)>(0x204c16c)(actor,moved,surface);
    const u32 i=slot(actor);if(i<2)api<void(*)(void*,const s16*,u32)>(0x204c16c)(session.actors[i],moved,surface);
}
extern "C" void IconVblank(void* task,void* data){
    if(session.active){const u32 dirty=session.dirty;session.dirty=0;
        for(u32 i=0;i<2;i++)if(dirty&(1u<<i)){
            api<void(*)(u32,const void*,u32,u32,u32)>(0x204bae4)(session.chars[i],session.tiles[i],512,0,0);
            struct Palette{u32 format,extended,size;const void* data;} p={4,1,32,session.palettes[i]};
            u32 proxy[5]={4,1,INVALID,INVALID,INVALID};
            api<void(*)(const void*,u32,u32,void*)>(0x2060f50)(&p,i*512,1,proxy);
        }}
    api<void(*)(void*,void*)>(0x204b7f4)(task,data);
}
extern "C" void IconEnd(void* work){dispose();ov<void(*)(void*)>(0x21b3664)(work);api<void(*)(u32)>(0x2076820)(0);}
