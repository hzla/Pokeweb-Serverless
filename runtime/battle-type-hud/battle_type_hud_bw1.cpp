// BW1 candidate: separate icon pieces retain the native gauge's art/palette.
#include "hud_common.h"
#ifdef ICON_VARIANT_CIRCULAR
#include "assets-circular.h"
#elif defined(ICON_VARIANT_SOLID)
#include "assets-solid.h"
#else
#include "assets.h"
#endif

namespace {
struct Record {
    void *gauge, *battler, *cell;
    volatile u16 *graphics;
    u16 *attrs;
    u32 charId;
    u16 originalSource[16], originalTransfer[16], originalHardware[16];
    u16 types;
    u8 pos, layout, id, status, bank, nativeBank, nativeCount, valid, paletteId;
};
}
struct HudState { Record records[6]; u8 failure, bindings; u16 redraws; };
extern "C" { HudState gBattleTypeHud; }
static_assert(sizeof(Record)==132, "BW1 record budget");
static_assert(sizeof(HudState)==796, "BW1 writable state budget");

namespace {
enum Failure { BadPointer=1, BadLayout, BadGraphics, BadPalette, PaletteConflict, BadTypes };
void fail(unsigned why) { if(!gBattleTypeHud.failure) gBattleTypeHud.failure=why; }
void* panel(void* g,unsigned p) { return static_cast<u8*>(g)+0x40+0x80*p; }
Record* record(unsigned p) {
    // BW1 uses 2/3 for the central triple/rotation panels and 0/1 for
    // singles/doubles. These pairs never occupy a gauge simultaneously.
    if(p<4) return &gBattleTypeHud.records[p&1];
    return p>=4&&p<8 ? &gBattleTypeHud.records[p-2] : nullptr;
}
unsigned charBytes(const Record& r) { return r.layout>=2&&(r.pos&1)?2304:2048; }
bool range(const void* p,unsigned bytes) {
    const u32 n=reinterpret_cast<u32>(p);
    return bytes&&ram(p)&&n+bytes>n&&ram(reinterpret_cast<void*>((n+bytes-1)&~3u));
}
FadeBank* fade() {
    void* p=reinterpret_cast<void*(*)()>(NativeGetPfd)();
    if(!range(p,60)) return nullptr;
    auto* f=static_cast<FadeBank*>(p)+2;
    return f->bytes>=512&&range(f->source,512)&&range(f->transfer,512)?f:nullptr;
}
bool usedBanks(unsigned& mask,unsigned except=255) {
    void* ctx=*reinterpret_cast<void**>(NativeSpriteContextSlot);
    if(!range(ctx,284)) return false;
    void* records=field<void*>(ctx,272);
    unsigned count=field<u16>(ctx,282);
    if(count>128||!count||!range(records,count*24)) return false;
    mask=0;
    for(unsigned i=0;i<count;++i) {
        if(i==except) continue;
        void* p=static_cast<u8*>(records)+24*i;
        if(field<u32>(p,20)&0x80000000) continue;
        const unsigned at=field<u32>(p,12); // main-engine OBJ palette proxy
        if(at==0xffffffff) continue; // sub-only resource
        if(at>=512||(at&31)) return false; // unsupported extended/offset palette
        mask|=1u<<(at/32);
    }
    // Native loaders record the remaining NCLR extent, while the gauge's
    // cell and fade upload use one 32-byte bank at the proxy's base.
    return true;
}
bool paletteOwner(const Record& r) {
    void* ctx=*reinterpret_cast<void**>(NativeSpriteContextSlot);
    if(!range(ctx,284)||r.paletteId>=field<u16>(ctx,282)) return false;
    void* records=field<void*>(ctx,272);
    if(!range(records,24*(r.paletteId+1))) return false;
    void* p=static_cast<u8*>(records)+24*r.paletteId;
    return field<u32>(p,12)==32u*r.bank && field<u32>(p,16)==0xffffffff
        &&field<u32>(p,20)==32;
}
bool reservePalette(Record& r) {
    void* ctx=*reinterpret_cast<void**>(NativeSpriteContextSlot);
    void* records=field<void*>(ctx,272);
    const unsigned count=field<u16>(ctx,282);
    unsigned id=0;
    for(;id<count;++id)
        if(field<u32>(static_cast<u8*>(records)+24*id,20)&0x80000000) break;
    if(id==count) return false;
    // A valid retail-layout NCLR containing one blank 16-color palette.
    // Use the native reservation core directly: no file read or temporary
    // heap allocation is needed for these private colors.
    static constexpr u32 header[10]={0x4e434c52,0x0100feff,72,0x00010010,
                                     0x504c5454,56,3,0,32,16};
    volatile u32 nclr[18];
    for(unsigned i=0;i<18;++i) nclr[i]=i<10?header[i]:0;
    reinterpret_cast<void(*)(void*,u32,void*,u32,u32,u32,u32)>(NativePaletteReserveCore)
        (static_cast<u8*>(ctx)+0x104,id,const_cast<u32*>(nclr),0,32*r.bank,0,1);
    r.paletteId=static_cast<u8>(id);
    if(paletteOwner(r)) return true;
    reinterpret_cast<void(*)(u32)>(NativePalFree)(id);
    return false;
}
bool identity(const Record& r) {
    if(!range(r.gauge,0x440)||!range(r.battler,0x200)) return false;
    void* p=panel(r.gauge,r.pos);
    if(field<void*>(p,0)!=r.cell||field<u32>(p,24)!=r.charId||!range(r.cell,0xa8)) return false;
    u32 proxy[9];
    reinterpret_cast<void(*)(void*,void*)>(NativeGetProxy)(r.cell,proxy);
    void* data=field<void*>(r.cell,0xa4);
    return reinterpret_cast<u32>(r.graphics)==0x06400000+proxy[1]
        &&range(data,8)&&field<u16>(data,0)==r.nativeCount+2
        &&field<void*>(data,4)==r.attrs&&range(r.attrs,6*(r.nativeCount+2));
}
void clearImage(Record& r) {
    // Only the appended 256-byte image is writable. No native pixel changes.
    volatile u16* dst=r.graphics+charBytes(r)/2;
    for(unsigned i=0;i<128;++i) dst[i]=0;
    for(unsigned i=0;i<2;++i) r.attrs[3*i]=0x00c0; // offscreen until repainted
}
u16 color(const Record& r,unsigned index) {
    if(index==1) return 0x7fff;
    if(index==2) return 0x1084; // BW1's native dark outline
    if(index==4) return Colors[r.types>>8];
    if(index==6) return Colors[r.types&255];
#ifdef ICON_VARIANT_SOLID
    if(index==5) return BorderColors[r.types>>8];
    if(index==7) return BorderColors[r.types&255];
#endif
    return 0;
}
bool ownPalette(const Record& r,const FadeBank& f) {
    if((r.types>>8)>17||(r.types&255)>17) return false;
    for(unsigned i=0;i<16;++i) if(f.source[16*r.bank+i]!=color(r,i)) return false;
    return true;
}
void forget(Record& r) {
    if(r.valid) {
        if(identity(r)) clearImage(r);
        FadeBank* f=fade();unsigned used=0;
        // Preserve a bank claimed or overwritten by another runtime.
        if(f&&paletteOwner(r)&&usedBanks(used,r.paletteId)&&!(used&(1u<<r.bank))&&ownPalette(r,*f)) {
            for(unsigned i=0;i<16;++i) {
                f->source[16*r.bank+i]=r.originalSource[i];
                f->transfer[16*r.bank+i]=r.originalTransfer[i];
                reinterpret_cast<volatile u16*>(0x05000200)[16*r.bank+i]=r.originalHardware[i];
            }
        }
        if(paletteOwner(r)) reinterpret_cast<void(*)(u32)>(NativePalFree)(r.paletteId);
    }
    r.gauge=nullptr;r.valid=0;
}
bool attach(Record& r) {
    void* p=panel(r.gauge,r.pos);r.cell=field<void*>(p,0);r.charId=field<u32>(p,24);
    if(!range(r.cell,0xa8)) {fail(BadPointer);return false;}
    void* data=field<void*>(r.cell,0xa4);
    r.nativeCount=static_cast<u8>(r.layout>=2&&(r.pos&1)?3:2);
    if(!range(data,8)||field<u16>(data,0)!=r.nativeCount+2) {fail(BadLayout);return false;}
    r.attrs=field<u16*>(data,4);
    if(!range(r.attrs,6*(r.nativeCount+2))) {fail(BadPointer);return false;}
    const unsigned tile=charBytes(r)/64;
    if((r.attrs[2]&1023)!=tile||(r.attrs[5]&1023)!=tile+2) {fail(BadLayout);return false;}
    static constexpr u16 expected[9]={0x40f0,0xc1c0,0,0x40f0,0xc000,16,0x80f0,0x8040,32};
    for(unsigned i=0;i<3*r.nativeCount;++i)
        if(r.attrs[6+i]!=expected[i]) {fail(BadLayout);return false;}
    u32 proxy[9];reinterpret_cast<void(*)(void*,void*)>(NativeGetProxy)(r.cell,proxy);
    const u32 mode=*reinterpret_cast<volatile u32*>(0x04000000);
    if((mode&0x00300010)!=0x00100010||
       (*reinterpret_cast<volatile u8*>(0x04000244)&0x87)!=0x82||
       (proxy[1]&31)||proxy[1]>0x10000-charBytes(r)-256) {fail(BadGraphics);return false;}
    r.graphics=reinterpret_cast<volatile u16*>(0x06400000+proxy[1]);
    const unsigned pi=r.pos<2?r.pos:r.pos-2;
    const unsigned palId=field<u32>(r.gauge,0x18+4*pi);
    const unsigned at=reinterpret_cast<u32(*)(u32,u32)>(NativePalAddr)(palId,0);
    if(at>=512||(at&31)) {fail(BadPalette);return false;}
    r.nativeBank=static_cast<u8>(at/32);
    FadeBank* f=fade();unsigned used=0;
    if(!f||!usedBanks(used)) {fail(BadPalette);return false;}
    for(auto& other:gBattleTypeHud.records) if(&other!=&r&&other.valid) used|=1u<<other.bank;
    unsigned bank=10;
    for(;bank<16&&(used&(1u<<bank));++bank) {}
    if(bank==16) {fail(PaletteConflict);return false;}
    r.bank=static_cast<u8>(bank);
    for(unsigned i=0;i<16;++i) {
        r.originalSource[i]=f->source[16*bank+i];
        r.originalTransfer[i]=f->transfer[16*bank+i];
        r.originalHardware[i]=reinterpret_cast<volatile u16*>(0x05000200)[16*bank+i];
    }
    // Reserve a native palette resource ID as well as the visible bank.
    // The source palette's unused tail is uninitialized in retail BW1.
    // A blank-color test would wrongly reject all six free banks.
    if(!reservePalette(r)) {fail(PaletteConflict);return false;}
    r.valid=1;clearImage(r);return true;
}
bool types(Record& r,u16& pair) {
    void* view=reinterpret_cast<void*(*)(void*)>(NativeViewSrc)(r.battler);
    void* real=field<void*>(r.battler,0);
    if(view&&view!=real) {
        if(!range(view,220)) {fail(BadPointer);return false;}
        auto get=reinterpret_cast<u32(*)(void*,u32,void*)>(NativePPGet);
        const unsigned a=get(view,174,nullptr),b=get(view,175,nullptr);
        if(a>17||b>17) {fail(BadTypes);return false;}
        pair=static_cast<u16>((a<<8)|b);
    } else pair=static_cast<u16>(reinterpret_cast<u32(*)(void*)>(NativeEffectiveTypes)(r.battler));
    if((pair>>8)>17||(pair&255)>17) {fail(BadTypes);return false;}
    return true;
}
unsigned left(const Record& r) {
    // The enemy's visible left edge follows the verified native resting
    // anchors (table x + native 16-pixel entry offset).
    if(!(r.pos&1)) return 0;
    const unsigned anchor=r.pos<4?60:70-2*r.pos;
    return 65-anchor;
}
void pixel(volatile u16* dst,unsigned x,unsigned y,unsigned c) {
    const unsigned at=((y/8)*2+x/8)*16+(y&7)*2+(x&7)/4;
    const unsigned shift=(x&3)*4;
    dst[at]=static_cast<u16>((dst[at]&~(15u<<shift))|(c<<shift));
}
void paint(Record& r) {
    const bool mono=(r.types>>8)==(r.types&255);
    const unsigned tile=charBytes(r)/64;
    const unsigned relative=(r.bank-r.nativeBank)&15;
    for(unsigned kind=0;kind<2;++kind) {
        volatile u16* image=r.graphics+charBytes(r)/2+64*kind;
        for(unsigned i=0;i<64;++i) image[i]=0;
        unsigned x=left(r)+(mono?2:5*kind),y=15+(mono?2:6*kind);
#ifdef ICON_VARIANT_SOLID
        x=(r.pos&1)?left(r):9;y=kind?22:17;
        // BW1 has three white HP-face rows. The lower native gray face has
        // seven rows only for a regular player and two rows for compact HUDs.
        const unsigned height=kind&&!(r.pos&1)&&r.layout<2?7:kind?2:3;
        for(unsigned row=0;row<height;++row) {
            const unsigned start=kind?height-row-1:2-row;
            for(unsigned col=start;col<start+6;++col)
                pixel(image,col,row,col==start||col==start+5?(kind?7:5):(kind?6:4));
        }
#else
        if(kind&&mono) {r.attrs[3*kind]=0x00c0;continue;}
        const unsigned type=kind?(r.types&255):(r.types>>8);
        for(unsigned row=0;row<11;++row) for(unsigned col=0;col<12;++col) {
            const unsigned mask=2048u>>col;
            if(!(Outline[row]&mask)) continue;
            const unsigned c=!(Fill[row]&mask)?2:(Symbols[type][row]&mask)?1:kind?6:4;
            pixel(image,col,row,c);
        }
#endif
        r.attrs[3*kind]=static_cast<u16>((y-16)&255);
        r.attrs[3*kind+1]=static_cast<u16>(0x4000|((x-64)&511));
        r.attrs[3*kind+2]=static_cast<u16>((relative<<12)|(tile+2*kind));
    }
}
void update(Record& r) {
    if(!r.gauge) return;
    if(!range(r.gauge,0x44c)||!range(r.battler,0x200)) {fail(BadPointer);forget(r);return;}
    void* p=panel(r.gauge,r.pos);
    if(!(field<u32>(p,112)&8)||field<u8>(r.battler,0x19)!=r.id) {forget(r);return;}
    if(r.valid&&!identity(r)) {forget(r);return;}
    if(!r.valid&&!attach(r)) {r.gauge=nullptr;return;}
    FadeBank* f=fade();unsigned used=0;
    if(!f||!paletteOwner(r)||!usedBanks(used,r.paletteId)) {fail(BadPalette);forget(r);return;}
    if(used&(1u<<r.bank)) {fail(PaletteConflict);forget(r);return;}
    // Permit a native full-palette reload's blank padding. Any other source
    // change indicates that the bank is no longer ours.
    bool blank=true;for(unsigned i=0;i<16;++i) if(f->source[16*r.bank+i]) blank=false;
    if(r.types!=0xffff&&!blank&&!ownPalette(r,*f)) {fail(PaletteConflict);forget(r);return;}
    u16 pair=0;
    if(!types(r,pair)) {clearImage(r);return;}
    r.types=pair;
    const int evy=currentFade(*f,r.nativeBank);
    if(evy<0) {clearImage(r);return;}
    for(unsigned i=0;i<16;++i) {
        const u16 c=color(r,i),shown=blend(c,f->target,evy);
        f->source[16*r.bank+i]=c;f->transfer[16*r.bank+i]=shown;
        reinterpret_cast<volatile u16*>(0x05000200)[16*r.bank+i]=shown;
    }
    // BW1's gauge does not retain the BW2 status byte. Read the current
    // nonvolatile conditions through the verified native battler getter.
    // The status sprite remains owned and drawn by the native gauge.
    r.status=0;
    for(unsigned sick=1;sick<=5;++sick) {
        if(reinterpret_cast<u32(*)(void*,u32)>(NativeCheckSick)(r.battler,sick)) {
            r.status=static_cast<u8>(sick);break;
        }
    }
    if(r.status) clearImage(r);else paint(r);
    ++gBattleTypeHud.redraws;
}
void clear(void* g,unsigned p) { Record* r=record(p);if(r&&r->gauge==g&&r->pos==p) forget(*r); }
}
static void HudAdd(void* g,void* m,void* b,unsigned t,unsigned p) {
    clear(g,p);
    reinterpret_cast<void(*)(void*,void*,void*,unsigned,unsigned)>(NativeAdd)(g,m,b,t,p);
    Record* r=record(p);if(!r||t>3) return;
    if(!range(g,0x44c)||!range(b,0x200)) {fail(BadPointer);return;}
    r->gauge=g;r->battler=b;r->pos=static_cast<u8>(p);r->layout=static_cast<u8>(t);
    r->id=field<u8>(b,0x19);r->types=0xffff;r->valid=0;
    ++gBattleTypeHud.bindings;update(*r);
}
static void HudAddPP(void* g,void* m,void* b,unsigned t,unsigned p) {
    clear(g,p);reinterpret_cast<void(*)(void*,void*,void*,unsigned,unsigned)>(NativeAddPP)(g,m,b,t,p);
}
static void HudMain(void* g) {
    reinterpret_cast<void(*)(void*)>(NativeMain)(g);
    for(auto& r:gBattleTypeHud.records) if(r.gauge==g) update(r);
}
static void HudDel(void* g,unsigned p) {clear(g,p);reinterpret_cast<void(*)(void*,unsigned)>(NativeDel)(g,p);}
static void HudRelease(void* g) {
    for(auto& r:gBattleTypeHud.records) if(r.gauge==g) forget(r);
    reinterpret_cast<void(*)(void*)>(NativeRelease)(g);
}
static void HudStatus(void* g,unsigned s,unsigned p) {
    reinterpret_cast<void(*)(void*,unsigned,unsigned)>(NativeStatus)(g,s,p);
    Record* r=record(p);if(r&&r->gauge==g) update(*r);
}
static void HudNameDraw(void* g,void* p,void* pp) {reinterpret_cast<void(*)(void*,void*,void*)>(NativeNameDraw)(g,p,pp);}
static void HudSexDraw(void* g,void* p) {reinterpret_cast<void(*)(void*,void*)>(NativeSexDraw)(g,p);}
static void HudLevelDraw(void* g,void* p) {reinterpret_cast<void(*)(void*,void*)>(NativeLevelDraw)(g,p);}
#ifdef GAME_B
#include "build/hooks-TypeIcons-B.h"
#else
#include "build/hooks-TypeIcons-W.h"
#endif
