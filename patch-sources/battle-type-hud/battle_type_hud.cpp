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
    void *gauge, *battler, *fake;
    volatile u16* graphics;
    u32 charId, hash;
    u8 background[24]; // icon backup, 24-bit header checksum, spare byte, shifts
    u16 original[2], types, fakeTypes;
    u8 pos:3, status:3, painted:1, valid:1;
    // Battler IDs identify client/party members, not the six visible positions.
    // Enemy IDs include 12; preserve the full native byte without truncation.
    u8 bank, id;
    u8 layout:2, nameX:6; // shifted header-name origin used for validation
};
static_assert(sizeof(Record)==60, "record budget");
}
// Visible in the debug DLL: sticky failure code, repaint count, binding count.
// These counters describe this module only, never the game's heap or state.
struct HudState { Record enemies[6]; u8 failure, bindings; u16 redraws; };
extern "C" { HudState gBattleTypeHud; }
static_assert(sizeof(HudState)==364, "maximum writable state is 384 bytes");

namespace {
enum Failure { BadPointer=1, BadLayout, BadGraphics, BadPalette, SharedPalette, BadTypes };
void fail(unsigned why) { if (!gBattleTypeHud.failure) gBattleTypeHud.failure=why; }
void* panel(void* g, unsigned p) { return static_cast<u8*>(g)+0x40+0x84*p; }
Record* record(unsigned p) {
    if(p<8) return &gBattleTypeHud.enemies[p<2?p:p-2];
    return nullptr;
}
bool besideName(const Record& r) { return r.layout==0 && !(r.pos&1); }
unsigned words(const Record& r) { return (r.layout>=2 ? (r.pos&1) : !(r.pos&1)) ? 1152 : 1024; }
unsigned offset(unsigned x,unsigned y) {
    return ((y/8)*8+x/8)*16+(y&7)*2+(x&7)/4;
}
unsigned iconOffset(const Record& r,unsigned x,unsigned y) {
    (void)r;
    return offset(x,y);
}
unsigned pixel(const Record& r,unsigned x,unsigned y) {
    return (r.graphics[iconOffset(r,x,y)]>>((x&3)*4))&15;
}
void pixel(Record& r,unsigned x,unsigned y,unsigned color) {
    // DS VRAM ignores byte stores. Every pixel write is a halfword RMW.
    volatile u16* dst=r.graphics+iconOffset(r,x,y);
    const unsigned shift=(x&3)*4;
    *dst=static_cast<u16>((*dst&~(15u<<shift))|(color<<shift));
}
bool mono(const Record& r) { return (r.types>>8)==(r.types&255); }
#ifdef ICON_VARIANT_SOLID
// The regular player face is 11 pixels tall. Enemy and triple-player faces are
// seven pixels tall. Only their native light pixels are replaced; their black
// outer borders and shadows remain untouched.
bool solidCompact(const Record& r) { return (r.pos&1)||r.layout>=2; }
#define ICON_COUNT(r) 1u
#define ICON_HEIGHT(r) (solidCompact(r)?7u:11u)
#else
// Two 12x11 rhombuses use a five-pixel right and six-pixel down step.
// y=15..31 stays inside the native 128x32 HUD pieces. A monotype is centered
// horizontally and raised one pixel from the vertical center of the stack.
#define ICON_COUNT(r) (mono(r)?1u:2u)
#define ICON_HEIGHT(r) 11u
#endif
unsigned iconY(const Record& r,unsigned kind) {
#ifdef ICON_VARIANT_SOLID
    (void)r;(void)kind;return 18;
#else
    return 15+(mono(r)?2:6*kind);
#endif
}
unsigned panelBack(const Record& r,unsigned x,unsigned y) {
    const unsigned i=(y-15)*26+x;
    return (PanelBackground[(r.layout>=2?2:0)+(r.pos&1)][i/2]>>((i&1)*4))&15;
}
unsigned nativeBack(const Record& r,unsigned x,unsigned y) {
    return panelBack(r,x,y);
}
#ifndef ICON_VARIANT_SOLID
unsigned stackLeft(const Record& r) {
    if(!(r.pos&1)) return 0;
    // Resting enemy anchors are 60/64/60/56. Keep the leftmost painted pixel
    // at screen x=1 even for the far-left singles and triple positions.
    const unsigned anchor=r.pos==1?60:70-2*r.pos;
    return 65-anchor;
}
#endif
unsigned iconLeft(const Record& r,unsigned kind) {
#ifdef ICON_VARIANT_SOLID
    (void)kind;
    if(!(r.pos&1)) return r.layout>=2?9:7;
    return r.layout>=2?12:11;
#else
    return stackLeft(r)+(mono(r)?2:5*kind);
#endif
}
unsigned nameOrigin(const Record& r) {
    // Native short/long names have different indents. Read the rendered name
    // without changing its position; reserve two clear pixels before its ink.
    for(unsigned x=8;x<24;++x) for(unsigned y=5;y<16;++y)
        if((r.graphics[offset(x,y)]>>((x&3)*4))&15) return (x>18?18:x)-7;
    return 9; // native short-name indent before the first name draw
}
// The two native 64x32 pieces display a 128-pixel-wide header. Keep its
// pixels in their existing tiles; no enemy sprite/graphics expansion needed.
unsigned headerOffset(unsigned x,unsigned y) { return offset(x&63,y+(x>=64?32:0)); }
unsigned headerPixel(const Record& r,unsigned x,unsigned y) {
    return (r.graphics[headerOffset(x,y)]>>((x&3)*4))&15;
}
void headerPixel(Record& r,unsigned x,unsigned y,unsigned c) {
    auto* p=r.graphics+headerOffset(x,y);const unsigned s=(x&3)*4;
    const u16 v=static_cast<u16>((*p&~(15u<<s))|(c<<s));
    if(v!=*p) *p=v;
}
void moveHeader(Record& r,unsigned nameShift,unsigned infoShift,bool undo) {
    // One 64-byte row on the stack prevents overlap between the translated
    // name and gender/level fields. All video writes remain halfword-safe.
    u16 row[32];
    const unsigned start=(r.pos&1)?16:8, split=(r.pos&1)?80:72;
    for(unsigned y=0;y<16;++y) {
        for(unsigned x=0;x<128;x+=4) row[x/4]=r.graphics[headerOffset(x,y)];
        for(unsigned x=start;x<128;++x) {
            unsigned from=128;
            if(undo) {
                if(x>=split) from=x+infoShift;
                else if(x+nameShift<split+infoShift) from=x+nameShift;
            } else {
                if(x>=split+infoShift) from=x-infoShift;
                else if(x>=start+nameShift && x<split+nameShift) from=x-nameShift;
            }
            headerPixel(r,x,y,from<128?(row[from/4]>>((from&3)*4))&15:0);
        }
    }
}
void undoHeader(Record& r) {
    if(((r.pos&1)||besideName(r)) && (r.background[22]&128)) {
        moveHeader(r,r.background[22]&15,r.background[23],true);
        r.background[22]=r.background[23]=0;
    }
}
u32 nativeHeaderHash(const Record& r) {
    u32 hash=2166136261u;
    for(unsigned y=0;y<16;++y) for(unsigned x=(r.pos&1)?16:8;x<128;++x) {
        unsigned c=headerPixel(r,x,y);if(c==4||c==15) c=2;
        hash=(hash^c)*16777619u;
    }
    return hash;
}
u32 savedHeaderHash(const Record& r) {
    return static_cast<u32>(r.background[18])|(static_cast<u32>(r.background[19])<<8)
        |(static_cast<u32>(r.background[20])<<16);
}
void saveHeaderHash(Record& r,u32 hash) {
    r.background[18]=static_cast<u8>(hash);r.background[19]=static_cast<u8>(hash>>8);
    r.background[20]=static_cast<u8>(hash>>16);
}
bool prepareHeader(Record& r) {
    const bool player=besideName(r);
    if((!(r.pos&1)&&!player)||(r.background[22]&128)) return true;
    const unsigned start=player?8:16,split=player?72:80;
    unsigned first=split,last=start,infoFirst=128,infoLast=split;
    for(unsigned y=0;y<16;++y) for(unsigned x=start;x<128;++x) {
        if(!headerPixel(r,x,y)) continue;
        if(x<split) {if(x<first) first=x;if(x>last) last=x;}
        else {if(x<infoFirst) infoFirst=x;if(x>infoLast) infoLast=x;}
    }
    if(first==split) first=last=player?16:24;
    // Verified resting anchors: singles 60; doubles 64/60; triples 64/60/56.
    // Name starts at screen x>=23, leaving one screen-edge pixel, the
    // 17-pixel diagonal stack, and clear space before the name ink.
    const unsigned anchor=r.pos==1?60:70-2*r.pos;
    const unsigned minimum=87-anchor;
    const unsigned ns=player?12:first<minimum?minimum-first:0;
    const unsigned is=player?8:last+ns+2>infoFirst?last+ns+2-infoFirst:0;
    if(ns>15||is>15||infoLast+is>=(player?120u:128u)||
       (player?last+ns+2>infoFirst+is:first+ns<22||first+ns-22>43)) {
        fail(BadLayout);return false;
    }
    // Enemy x=8..15 is the native caught-marker slot. Header translation
    // starts at x=16, so leave that 8x8 art untouched and validate only the
    // genuinely unused pixels before it. Player headers have no such slot.
    const unsigned clearEnd=(r.pos&1)?8:start;
    for(unsigned y=0;y<16;++y) for(unsigned x=0;x<clearEnd;++x)
        if(headerPixel(r,x,y)) {fail(BadLayout);return false;}
    // Header icon backups are all transparent, leaving room to recognize an
    // in-place native graphics reload before trying to erase our old pixels.
    saveHeaderHash(r,nativeHeaderHash(r));
    r.nameX=static_cast<u8>(player?nameOrigin(r):first+ns-22);
    moveHeader(r,ns,is,false);
    r.background[22]=static_cast<u8>(128|ns);r.background[23]=static_cast<u8>(is);
    return true;
}
#ifdef ICON_VARIANT_SOLID
bool ink(const Record& r,unsigned x,unsigned y) {
    return (solidCompact(r)?SolidCompactMask[y]:SolidTallMask[y])&(2048u>>x);
}
bool backedInk(const Record& r,unsigned x,unsigned y) { return ink(r,x,y); }
#define ICON_INK(r,x,y) ink(r,x,y)
#define ICON_BACKED_INK(r,x,y) backedInk(r,x,y)
#else
bool ink(unsigned x,unsigned y) { return Outline[y]&(2048u>>x); }
bool backedInk(unsigned x,unsigned y) {
#ifdef ICON_VARIANT_CIRCULAR
    // Four symmetric tip pixels restore from the exact native table, leaving
    // the same 72 one-bit backups per icon as the lettered variant.
    return ink(x,y) && !((y==0||y==9)&&(x==4||x==7));
#else
    // The added center row and four shoulder pixels restore from the exact
    // PanelBackground table, so the existing 18-byte dual backup remains
    // sufficient for the other 72 pixels per rhombus.
    return ink(x,y) && y!=6 && !((y==1||y==9)&&(x==3||x==8));
#endif
}
#define ICON_INK(r,x,y) ink(x,y)
#define ICON_BACKED_INK(r,x,y) backedInk(x,y)
#endif
unsigned backIndex(const Record& r,unsigned kind,unsigned x,unsigned y) {
    // Only the native gray checker phase can vary, so one bit per backed pixel
    // is sufficient.
#ifdef ICON_VARIANT_SOLID
    static constexpr u8 tall[11]={0,7,14,21,28,35,42,49,56,63,70};
    static constexpr u8 compact[7]={0,7,14,21,28,35,42};
    const u8* starts=solidCompact(r)?compact:tall;
#elif defined(ICON_VARIANT_CIRCULAR)
    (void)r;
    static constexpr u8 starts[11]={0,2,8,16,26,36,46,56,64,70,72};
#else
    (void)r;
    static constexpr u8 starts[11]={0,2,6,14,24,36,48,48,58,66,70};
#endif
    unsigned before=0;
    for(unsigned i=0;i<x;++i) before+=ICON_BACKED_INK(r,i,y)?1:0;
    const unsigned n=starts[y]+before;
    return kind*72+n;
}
unsigned back(const Record& r,unsigned kind,unsigned x,unsigned y) {
    const unsigned i=backIndex(r,kind,x,y);
    const unsigned c=nativeBack(r,iconLeft(r,kind)+x,iconY(r,kind)+y);
    if(!ICON_BACKED_INK(r,x,y)) return c;
    const unsigned bits=(r.background[i/8]>>(i&7))&1;
    return c==3||c==13 ? (bits?13:3) : c;
}
bool snapshot(Record& r) {
#ifdef ICON_VARIANT_SOLID
    // Ten bytes hold the 77-pixel maximum backup. Keep the rest available for
    // header identity and translation state.
    for(unsigned i=0;i<12;++i) r.background[i]=0;
#else
    for(unsigned i=0;i<18;++i) r.background[i]=0;
#endif
    for(unsigned kind=0;kind<ICON_COUNT(r);++kind)
        for(unsigned y=0;y<ICON_HEIGHT(r);++y) for(unsigned x=0;x<12;++x) {
            if(!ICON_INK(r,x,y)) continue;
            const unsigned c=pixel(r,iconLeft(r,kind)+x,iconY(r,kind)+y);
            const unsigned want=nativeBack(r,iconLeft(r,kind)+x,iconY(r,kind)+y);
            unsigned bits=0;
            if(want==3||want==13) {
                if(c!=3&&c!=13) {fail(BadLayout);return false;}
                bits=c==13;
            } else if(c!=want) {fail(BadLayout);return false;}
            if(ICON_BACKED_INK(r,x,y)) {
                const unsigned i=backIndex(r,kind,x,y);
                r.background[i/8]|=static_cast<u8>(bits<<(i&7));
            }
        }
    return true;
}
unsigned expected(const Record& r,unsigned kind,unsigned x,unsigned y) {
    const unsigned mask=2048u>>x;
#ifdef ICON_VARIANT_SOLID
    (void)kind;
    const bool compact=solidCompact(r);
    const u16 primary=compact?SolidCompactPrimary[y]:SolidTallPrimary[y];
    const u16 secondary=compact?SolidCompactSecondary[y]:SolidTallSecondary[y];
    const u16 primaryShade=compact?SolidCompactPrimaryShade[y]:SolidTallPrimaryShade[y];
    const u16 secondaryShade=compact?SolidCompactSecondaryShade[y]:SolidTallSecondaryShade[y];
    const u16 monotype=compact?SolidCompactMono[y]:SolidTallMono[y];
    const u16 monoShade=compact?SolidCompactMonoShade[y]:SolidTallMonoShade[y];
    if(mono(r) && (monotype&mask)) return 4;
    // A monotype can use the otherwise-free secondary icon entry for its
    // exact dark summary-label shade. Dual types need both reclaimed entries
    // for their bright fills, so alternate the matching fill with black at
    // transition pixels. This darkens the edge without touching the native
    // HP green/yellow/red palette entries 5..12.
    if(mono(r) && (monoShade&mask)) return 15;
    if(primary&mask) return 4;
    if(secondary&mask) return 15;
    if(primaryShade&mask) return ((x+y)&1)?4:2;
    if(secondaryShade&mask) return ((x+y)&1)?15:2;
    return 2;
#else
    if(!(Fill[y]&mask)) return 2;
    const unsigned type=kind?(r.types&255):(r.types>>8);
    return (Symbols[type][y]&mask)?1:kind?15:4;
#endif
}
void restore(Record& r) {
    if(!r.valid||!r.painted) return;
    for(unsigned kind=0;kind<ICON_COUNT(r);++kind)
        for(unsigned y=0;y<ICON_HEIGHT(r);++y) for(unsigned x=0;x<12;++x) {
            if(!ICON_INK(r,x,y)) continue;
            const unsigned left=iconLeft(r,kind);
            // Preserve native writes since the previous repaint.
            if(pixel(r,left+x,iconY(r,kind)+y)==expected(r,kind,x,y))
                pixel(r,left+x,iconY(r,kind)+y,back(r,kind,x,y));
        }
    r.painted=0;
}
u32 checksum(const Record& r) {
    u32 h=2166136261u;
    for(unsigned i=0;i<words(r);++i) h=(h^r.graphics[i])*16777619u;
    return h;
}
void reclaim(Record& r) {
    for(unsigned i=0;i<words(r);++i) {
        const u16 old=r.graphics[i]; u16 v=old;
        for(unsigned shift=0;shift<16;shift+=4) {
            const unsigned c=(old>>shift)&15;
            if(c==4 || c==15) v=static_cast<u16>((v&~(15u<<shift))|(2u<<shift));
        }
        if(v!=old) r.graphics[i]=v;
    }
}
u16 slashShadow(u16 value) {
    for(unsigned shift=0;shift<16;shift+=4)
        if(((value>>shift)&15)==4) value=static_cast<u16>((value&~(15u<<shift))|(2u<<shift));
    return value;
}
bool protectHpNumbers(const Record& r) {
    if(r.pos&1) return true; // only player panels display HP numbers
    // HP numbers have a separate OBJ image but reuse this panel's palette.
    // Tile 3 is the permanent slash; native HP updates replace tiles 0..2/4..6.
    // Check its exact shape before moving only its dark shadow from 4 to 2.
    static constexpr u16 slash[16]={0,0,0x2000,0x22,0x2000,0x21,0xe200,0x2e,
                                  0x1200,0x2,0xee20,0x2,0x2120,0,0x2220,0};
    void* cell=field<void*>(panel(r.gauge,r.pos),4);
    if(!ram(cell)) {fail(BadPointer);return false;}
    u32 proxy[9];
    reinterpret_cast<void(*)(void*,void*)>(NativeGetProxy)(cell,proxy);
    if((proxy[1]&31)||proxy[1]>0x10000-256) {fail(BadGraphics);return false;}
    auto* data=reinterpret_cast<volatile u16*>(0x06400000+proxy[1]+3*32);
    for(unsigned i=0;i<16;++i)
        if(slashShadow(data[i])!=slash[i]) {fail(BadLayout);return false;}
    for(unsigned i=0;i<16;++i)
        if(data[i]!=slash[i]) data[i]=slash[i]; // halfword stores only
    return true;
}
FadeBank* fade() {
    void* p=reinterpret_cast<void*(*)()>(NativeGetPfd)();
    if(!ram(p)) return nullptr;
    auto* f=static_cast<FadeBank*>(p)+2; // FADE_MAIN_OBJ
    if(!ram(f->source)||!ram(f->transfer)||f->bytes<512) return nullptr;
    return f;
}
bool palette(Record& r,bool undo=false) {
    FadeBank* f=fade();
    if(!f) { fail(BadPalette); return false; }
    const int evy=currentFade(*f,r.bank);
    if(evy<0) return false;
#ifdef ICON_VARIANT_SOLID
    const unsigned indices[2]={4,15};
    for(unsigned i=0;i<2;++i) {
        const unsigned at=r.bank*16+indices[i];
        const unsigned type=i&1 ? (r.types&255) : (r.types>>8);
        const u16 c=undo?r.original[i]:i&&mono(r)?BorderColors[type]:Colors[type];
        f->source[at]=c;
        const u16 shown=blend(c,f->target,evy);
        f->transfer[at]=shown;
        reinterpret_cast<volatile u16*>(0x05000200)[at]=shown;
    }
#else
    const unsigned indices[2]={4,15};
    for(unsigned i=0;i<2;++i) {
        const unsigned at=r.bank*16+indices[i];
        const u16 c=undo?r.original[i]:Colors[i ? (r.types&255) : (r.types>>8)];
        f->source[at]=c;
        const u16 shown=blend(c,f->target,evy);
        f->transfer[at]=shown;
        reinterpret_cast<volatile u16*>(0x05000200)[at]=shown;
    }
#endif
    return true;
}
bool expandedPanel(void* cell);
bool enemyPanel(void* cell,unsigned layout) {
    void* data=field<void*>(cell,0xa4);
    const unsigned count=layout<2?2:3;
    if(!ram(data)||field<u16>(data,0)!=count||field<u16>(data,2)!=(count==2?17:21)) return false;
    void* attrs=field<void*>(data,4);if(!ram(attrs)) return false;
    static constexpr u16 expected[9]={0x40f0,0xc1c0,0,0x40f0,0xc000,16,0x80f0,0x8040,32};
    for(unsigned i=0;i<count*3;++i) if(field<u16>(attrs,2*i)!=expected[i]) return false;
    return true;
}
bool identity(Record& r) {
    if(!ram(r.gauge)||!ram(r.battler)) return false;
    void* p=panel(r.gauge,r.pos);
    void* cell=field<void*>(p,0);
    if(field<u32>(p,24)!=r.charId || !ram(cell)) return false;
    u32 proxy[9];
    reinterpret_cast<void(*)(void*,void*)>(NativeGetProxy)(cell,proxy);
    return reinterpret_cast<u32>(r.graphics)==0x06400000+proxy[1]
        && ((r.pos&1)?enemyPanel(cell,r.layout):r.layout>=2||expandedPanel(cell));
}
bool expandedPanel(void* cell) {
    // CLWK's current cell is inside its NNS cell animation. Check the complete
    // installed cell before touching any appended graphics. A DLL installed
    // without its matching NCGR/NCER patch therefore fails closed.
    void* data=field<void*>(cell,0xa4);
    if(!ram(data)||field<u16>(data,0)!=3||field<u16>(data,2)!=21) return false;
    void* attrs=field<void*>(data,4);
    if(!ram(attrs)) return false;
    static constexpr u16 expected[9]={0x40f0,0xc1c0,0,0x40f0,0xc000,16,0x40f4,0x81bc,32};
    for(unsigned i=0;i<9;++i) if(field<u16>(attrs,2*i)!=expected[i]) return false;
    return true;
}
void forget(Record& r) {
    // Never touch a freed/reallocated image. All normal teardown hooks arrive
    // before invalidation and therefore restore both pixels and palette.
    if(r.gauge && r.valid && identity(r)) { restore(r);undoHeader(r);palette(r,true); }
    r.gauge=nullptr; r.valid=0; r.painted=0;
}
bool types(Record& r,u16& pair) {
    void* view=reinterpret_cast<void*(*)(void*)>(NativeViewSrc)(r.battler);
    void* real=field<void*>(r.battler,0);
    if(view && view!=real) {
        if(!ram(view)) { fail(BadPointer); return false; }
        if(view!=r.fake) {
            auto get=reinterpret_cast<u32(*)(void*,u32,void*)>(NativePPGet);
            const unsigned a=get(view,174,nullptr),b=get(view,175,nullptr);
            if(a>17||b>17) {fail(BadTypes);return false;}
            r.fakeTypes=static_cast<u16>((a<<8)|b);r.fake=view;
        }
        pair=r.fakeTypes;
    } else {
        r.fake=nullptr;
        pair=static_cast<u16>(reinterpret_cast<u32(*)(void*)>(NativeEffectiveTypes)(r.battler));
    }
    if((pair>>8)>17 || (pair&255)>17) {fail(BadTypes);return false;}
    return true;
}
bool layoutBackground(const Record& r) {
    if(besideName(r)) {
        for(unsigned i=1024;i<1152;++i) if(r.graphics[i]) return false;
    }
    if(r.status) return true; // the native label legitimately occupies this region
#ifdef ICON_VARIANT_SOLID
    // Validate only the native light face that this style replaces. The mask
    // never includes the panel's black outer edge, bottom shadow or background.
    for(unsigned y=0;y<ICON_HEIGHT(r);++y) for(unsigned x=0;x<12;++x) {
        if(!ICON_INK(r,x,y)) continue;
        unsigned c=pixel(r,iconLeft(r,0)+x,iconY(r,0)+y);
        if(c==4||c==15) c=2;
        if(c!=nativeBack(r,iconLeft(r,0)+x,iconY(r,0)+y)) return false;
    }
#else
    // Validate both dual-type locations and the centered monotype location
    // before reclaiming palette entries. Checking the exact three masks keeps
    // an unknown panel variant from receiving even a partially painted icon.
    for(unsigned kind=0;kind<3;++kind)
        for(unsigned y=0;y<11;++y) for(unsigned x=0;x<12;++x) {
            if(!ICON_INK(r,x,y)) continue;
            const unsigned left=stackLeft(r)+(kind==2?2:5*kind);
            const unsigned top=kind==2?17:15+6*kind;
            unsigned c=pixel(r,left+x,top+y);
            if(c==4||c==15) c=2;
            if(c!=nativeBack(r,left+x,top+y)) return false;
        }
#endif
    return true;
}
bool attach(Record& r) {
    void* p=panel(r.gauge,r.pos);
    void* cell=field<void*>(p,0);r.charId=field<u32>(p,24);
    if(!ram(cell)) {fail(BadPointer);return false;}
    if((r.pos&1)&&!enemyPanel(cell,r.layout)) {fail(BadLayout);return false;}
    if(!(r.pos&1)&&r.layout<2&&!expandedPanel(cell)) {fail(BadLayout);return false;}
    u32 proxy[9];
    reinterpret_cast<void(*)(void*,void*)>(NativeGetProxy)(cell,proxy);
    // This profile uses main-engine OBJ, 1D 64K mapping and bank E.
    const u32 mode=*reinterpret_cast<volatile u32*>(0x04000000);
    if((mode&0x00300010)!=0x00100010 ||
       (*reinterpret_cast<volatile u8*>(0x04000244)&0x87)!=0x82 ||
       (proxy[1]&31) || proxy[1]>0x10000-words(r)*2) {fail(BadGraphics);return false;}
    r.graphics=reinterpret_cast<volatile u16*>(0x06400000+proxy[1]);
    if(!layoutBackground(r)) {fail(BadLayout);return false;}
    const unsigned pi=r.pos<2?r.pos:r.pos-2;
    const u32 id=field<u32>(r.gauge,0x18+pi*4);
    const u32 addr=reinterpret_cast<u32(*)(u32,u32)>(NativePalAddr)(id,0);
    if(addr>=512 || (addr&31)) {fail(BadPalette);return false;}
    const unsigned previousBank=r.bank;
    r.bank=static_cast<u8>(addr/32);
    for(auto& other:gBattleTypeHud.enemies)
        if(&other!=&r && other.valid && (other.bank==r.bank || other.graphics==r.graphics)) {fail(SharedPalette);return false;}
    FadeBank* f=fade(); if(!f) {fail(BadPalette);return false;}
    // A relocated image may retain its existing palette. Do not mistake our
    // own installed colors for the palette entries to restore at teardown.
    bool ours=previousBank==r.bank && (r.types>>8)<18 && (r.types&255)<18
        && f->source[r.bank*16+4]==Colors[r.types>>8]
        && f->source[r.bank*16+15]==
#ifdef ICON_VARIANT_SOLID
            (mono(r)?BorderColors[r.types&255]:Colors[r.types&255]);
#else
            Colors[r.types&255];
#endif
    if(!ours) {r.original[0]=f->source[r.bank*16+4];r.original[1]=f->source[r.bank*16+15];}
    if(!protectHpNumbers(r)) return false;
    reclaim(r);r.valid=1;r.hash=0;r.background[21]=0;
    r.background[22]=r.background[23]=0;
    return true;
}
void update(Record& r) {
    if(!r.gauge) return;
    if(!ram(r.gauge)||!ram(r.battler)) {fail(BadPointer);forget(r);return;}
    void* p=panel(r.gauge,r.pos);
    if(!(field<u32>(p,112)&8) || field<u8>(r.battler,0x19)!=r.id) {forget(r);return;}
    if(r.valid && !identity(r)) {r.valid=0;r.painted=0;r.fake=nullptr;}
    if(!r.valid && !attach(r)) {r.gauge=nullptr;return;}
    // The number image can reload independently while the panel hash stays
    // unchanged. Inspect only the 32-byte slash, never the HP digit tiles.
    if(!protectHpNumbers(r)) {forget(r);return;}
    u16 pair=0;
    if(!types(r,pair)) {restore(r);return;}
    FadeBank* f=fade(); if(!f) {restore(r);return;}
    bool paletteDirty=f->source[r.bank*16+4]!=Colors[pair>>8]
        ||f->source[r.bank*16+15]!=Colors[pair&255];
#ifdef ICON_VARIANT_SOLID
    paletteDirty=f->source[r.bank*16+4]!=Colors[pair>>8]
        ||f->source[r.bank*16+15]!=(pair>>8==(pair&255)?BorderColors[pair&255]:Colors[pair&255]);
#endif
    const u32 hash=checksum(r);
    if(pair==r.types && hash==r.hash && r.painted==!r.status && (r.status || !paletteDirty)) return;
    if(((r.pos&1)||besideName(r))&&(r.background[22]&128)&&
       (nativeHeaderHash(r)&0xffffff)==savedHeaderHash(r)) {
        // A header-only reload can leave the icon pixels intact, while a full
        // image reload can erase some or all of them. Conditional restoration
        // handles both: it replaces only pixels that still match our paint.
        restore(r);
        r.painted=0;r.background[22]=r.background[23]=0;
    }
    restore(r);reclaim(r);
    r.types=pair;
    if(!prepareHeader(r)) {forget(r);return;}
    if(!r.status&&!snapshot(r)) {palette(r,true);r.gauge=nullptr;r.valid=0;return;}
    if(!r.status && palette(r)) {
        r.painted=1;
        for(unsigned kind=0;kind<ICON_COUNT(r);++kind)
            for(unsigned y=0;y<ICON_HEIGHT(r);++y) for(unsigned x=0;x<12;++x) {
                if(!ICON_INK(r,x,y)) continue;
                const unsigned left=iconLeft(r,kind),top=iconY(r,kind);
                const unsigned c=expected(r,kind,x,y);
                // Compare against the live pixel so overlapping icon styles
                // still repaint when a desired color matches native graphics.
                if(c!=pixel(r,left+x,top+y)) pixel(r,left+x,top+y,c);
            }
    }
    r.hash=checksum(r);++gBattleTypeHud.redraws;
}
void clear(void* g,unsigned p) {
    Record* r=record(p); if(r && r->gauge==g && r->pos==p) forget(*r);
}
}

// Use native function pointers rather than ARM9/167 external relocations: PMC
// unloads this module with overlay 168. Five Add arguments obey the Thumb ABI.
static void HudAdd(void* g,void* m,void* b,unsigned t,unsigned p) {
    Record* r=record(p); if(r && r->gauge) forget(*r);
    reinterpret_cast<void(*)(void*,void*,void*,unsigned,unsigned)>(NativeAdd)(g,m,b,t,p);
    if(!r || t>2) return;
    if(!ram(g)||!ram(b)) {fail(BadPointer);return;}
    if(((field<u32>(g,0x460)>>24)&3)==2) return; // Pokéstar uses a different system
    r->gauge=g;r->battler=b;r->pos=static_cast<u8>(p);r->layout=static_cast<u8>(t);
    r->id=field<u8>(b,0x19);r->fake=nullptr;r->types=0xffff;r->valid=0;r->painted=0;
    r->status=field<u8>(panel(g,p),110);++gBattleTypeHud.bindings;
    update(*r);
}
static void HudAddPP(void* g,void* m,void* b,unsigned t,unsigned p) {
    clear(g,p);
    reinterpret_cast<void(*)(void*,void*,void*,unsigned,unsigned)>(NativeAddPP)(g,m,b,t,p);
}
static void HudMain(void* g) {
    reinterpret_cast<void(*)(void*)>(NativeMain)(g);
    for(auto& r:gBattleTypeHud.enemies) if(r.gauge==g) update(r);
}
static void HudDel(void* g,unsigned p) {
    clear(g,p);
    reinterpret_cast<void(*)(void*,unsigned)>(NativeDel)(g,p);
}
static void HudRelease(void* g) {
    for(auto& r:gBattleTypeHud.enemies) if(r.gauge==g) forget(r);
    reinterpret_cast<void(*)(void*)>(NativeRelease)(g);
}
static void HudStatus(void* g,unsigned s,unsigned p) {
    Record* r=record(p);
    if(r && r->gauge==g && r->pos==p && r->valid && identity(*r)) restore(*r);
    reinterpret_cast<void(*)(void*,unsigned,unsigned)>(NativeStatus)(g,s,p);
    if(r && r->gauge==g && r->pos==p) {r->status=static_cast<u8>(s);r->hash=0;update(*r);}
}
static Record* beforeText(void* g,void* p) {
    Record* bound=nullptr;
    for(auto& r:gBattleTypeHud.enemies)
        if(r.gauge==g && panel(g,r.pos)==p) {bound=&r;break;}
    if(bound && bound->valid && identity(*bound)) {restore(*bound);undoHeader(*bound);}
    return bound;
}
static void afterText(Record* bound) {if(bound) {bound->hash=0;update(*bound);}}
static void HudNameDraw(void* g,void* p,void* pp) {
    Record* bound=beforeText(g,p);
    reinterpret_cast<void(*)(void*,void*,void*)>(NativeNameDraw)(g,p,pp);
    afterText(bound);
}
static void HudSexDraw(void* g,void* p) {
    Record* bound=beforeText(g,p);
    reinterpret_cast<void(*)(void*,void*)>(NativeSexDraw)(g,p);
    afterText(bound);
}
static void HudLevelDraw(void* g,void* p) {
    Record* bound=beforeText(g,p);
    reinterpret_cast<void(*)(void*,void*)>(NativeLevelDraw)(g,p);
    afterText(bound);
}
#ifdef GAME_B2
#include "build/hooks-TypeIcons-B2.h"
#else
#include "build/hooks-TypeIcons-W2.h"
#endif
