// Move names use the input screen's existing 256x96 4bpp bitmap, palette 13.
// No strings, message archives, sprites, or graphics allocations are added.
struct MoveHudState {
    void* input;
    void* disguise;
    u16 disguiseTypes, selectedMove;
    u8 attributes[4];
    u8 selectedSlot, label, paletteInstalled, failure;
};
extern "C" { MoveHudState gBattleMoveHud; }
static_assert(sizeof(MoveHudState)==20, "standalone move state budget");
// Dedicated immutable-at-runtime RGB555 table. Volatile prevents the compiler
// from folding colors into instructions; installers may edit exactly six bytes.
extern "C" const volatile u16 gMovePreviewColors[3]={0x2b5e,0x62b3,0x211f};

namespace {
void fail(unsigned why) { if(!gBattleMoveHud.failure) gBattleMoveHud.failure=static_cast<u8>(why); }
constexpr unsigned MoveWhite=1, MoveYellow=11, MoveBlue=12, MoveRed=13;
struct Bitmap { u8* pixels; u16 width,height,format,owner; };
Bitmap* moveBitmap(void* biw) {
    if(!ram(biw)) return nullptr;
    auto* bmp=field<Bitmap*>(biw,0x2b0);
    void* win=field<void*>(biw,0x2ac);
    if(!ram(win)||!ram(bmp)||!ram(bmp->pixels) || bmp->width!=256 || bmp->height!=96
       ||bmp->format!=32||field<void*>(win,12)!=bmp) {fail(7);return nullptr;}
    return bmp;
}
unsigned moveOffset(unsigned x,unsigned y) {
    return ((y/8)*32+x/8)*32+(y&7)*4+(x&7)/2;
}
unsigned movePixel(const Bitmap& b,unsigned x,unsigned y) {
    return (b.pixels[moveOffset(x,y)]>>((x&1)*4))&15;
}
void movePixel(Bitmap& b,unsigned x,unsigned y,unsigned c) {
    u8& v=b.pixels[moveOffset(x,y)];const unsigned s=(x&1)*4;
    v=static_cast<u8>((v&~(15u<<s))|(c<<s)); // bitmap is RAM, flushed by native halfword copy
}
FadeBank* moveFade(void* biw) {
    void* p=field<void*>(biw,0x64);
    if(!ram(p)) return nullptr;
    auto* f=static_cast<FadeBank*>(p)+1; // FADE_SUB_BG
    return ram(f->source)&&ram(f->transfer)&&f->bytes>=444?f:nullptr;
}
bool movePalette(void* biw,bool undo=false) {
    FadeBank* f=moveFade(biw);if(!f) return false;
    const int evy=currentFade(*f,13);if(evy<0) return false;
    for(unsigned i=0;i<3;++i) {
        const unsigned at=13*16+11+i;
        const u16 color=undo?0x7c1f:gMovePreviewColors[i];
        const u16 shown=blend(color,f->target,evy);
        f->source[at]=color;f->transfer[at]=shown;
        reinterpret_cast<volatile u16*>(0x05000400)[at]=shown;
    }
    gBattleMoveHud.paletteInstalled=!undo;
    return true;
}
bool moveBind(void* biw) {
    if(!moveBitmap(biw)) return false;
    auto& s=gBattleMoveHud;
    if(s.input!=biw) {s.input=biw;s.disguise=nullptr;s.label=0;s.paletteInstalled=0;}
    if(!s.paletteInstalled) {
        FadeBank* f=moveFade(biw);if(!f) return false;
        // The native font leaves all three entries magenta and never uses them.
        if(f->source[219]!=0x7c1f||f->source[220]!=0x7c1f||f->source[221]!=0x7c1f) {fail(8);return false;}
    }
    return true;
}
void* moveTarget(unsigned viewPos) {
    void* main=reinterpret_cast<void*(*)()>(NativeGetMainModule)();
    if(!ram(main)) return nullptr;
    void* core=field<void*>(main,4);
    if(!ram(core)||field<void*>(core,0)!=main) return nullptr;
    void* con=field<void*>(core,8);
    if(!ram(con)||field<void*>(con,0)!=main) return nullptr;
    const unsigned pos=reinterpret_cast<unsigned(*)(void*,unsigned)>(NativeViewToBattle)(main,viewPos);
    if(pos>=6) return nullptr;
    void* bpp=reinterpret_cast<void*(*)(void*,unsigned)>(NativeFrontBattler)(con,pos);
    return ram(bpp)?bpp:nullptr;
}
bool moveTypes(void* target,u16& pair) {
    if(!target) return false;
    void* view=reinterpret_cast<void*(*)(void*)>(NativeViewSrc)(target);
    auto& s=gBattleMoveHud;
    if(view&&view!=field<void*>(target,0)) {
        if(!ram(view)) return false;
        if(s.disguise!=view) {
            auto get=reinterpret_cast<unsigned(*)(void*,unsigned,void*)>(NativePPGet);
            unsigned a=get(view,174,nullptr),b=get(view,175,nullptr);
            if(a>17||b>17) return false;
            s.disguiseTypes=static_cast<u16>((a<<8)|b);s.disguise=view;
        }
        pair=s.disguiseTypes;
    } else {
        s.disguise=nullptr;
        pair=static_cast<u16>(reinterpret_cast<unsigned(*)(void*)>(NativeEffectiveTypes)(target));
    }
    return (pair>>8)<=17&&(pair&255)<=17;
}
bool fixedDamage(unsigned move) {
    static constexpr u16 ids[]={12,32,49,68,69,82,90,101,149,162,243,283,329,368};
    for(auto id:ids) if(move==id) return true;
    return false;
}
}
#include "move_immunity.h"
namespace {
unsigned moveColor(void* biw,unsigned move,unsigned attr,void* target) {
    u16 pair;
    if(!(attr&128)||!moveTypes(target,pair)) return MoveWhite;
    const unsigned type=attr&31;
    if(type>17) return MoveWhite;
    const int aff=moveAffinity(biw,move,attr,target,pair);
    if(aff==-8) return MoveRed;
    if(aff==8) return MoveWhite;
    if(attr&64) return MoveWhite;
    if(aff>0) return MoveYellow;
    if(aff<0) return MoveBlue;
    return MoveWhite;
}
bool tintMove(Bitmap& bmp,unsigned x,unsigned y,unsigned color) {
    bool changed=false;
    for(unsigned yy=y;yy<y+16;++yy) for(unsigned xx=x;xx<x+128;++xx) {
        const unsigned old=movePixel(bmp,xx,yy);
        if((old==MoveWhite||old==MoveYellow||old==MoveBlue||old==MoveRed)&&old!=color) {
            movePixel(bmp,xx,yy,color);changed=true;
        }
    }
    return changed;
}
void moveUpdate(void* biw,const u16* moves,int selectedTarget=-1) {
    if(!moveBind(biw)) return;
    Bitmap& bmp=*moveBitmap(biw);
    const unsigned rule=field<u32>(biw,0x50), screen=field<u32>(biw,0x58);
    bool changed=false;
    if(moves) {
        void* target=(rule==0||rule==3)?moveTarget(rule==0?1:3):nullptr;
        for(unsigned i=0;i<4;++i)
            changed|=tintMove(bmp,(i&1)*128,10+(i/2)*48,moveColor(biw,moves[i],gBattleMoveHud.attributes[i],target));
    } else if(screen==3&&gBattleMoveHud.label) {
        void* target=(selectedTarget>=0&&selectedTarget<6&&(selectedTarget&1))?moveTarget(selectedTarget+2):nullptr;
        changed=tintMove(bmp,64,0,moveColor(biw,gBattleMoveHud.selectedMove,
                  gBattleMoveHud.attributes[gBattleMoveHud.selectedSlot&3],target));
    }
    // Palette refresh has no resource loads; no bitmap transfer on unchanged frames.
    if(!gBattleMoveHud.paletteInstalled) movePalette(biw);
    if(changed) reinterpret_cast<void(*)(void*)>(NativeFlushBitmap)(field<void*>(biw,0x2ac));
}
}
static void HudMoveDraw(void* biw,const u16* param) {
    reinterpret_cast<void(*)(void*,const u16*)>(NativeMoveDraw)(biw,param);
    if(!moveBind(biw)) return;
    auto get=reinterpret_cast<unsigned(*)(unsigned,unsigned)>(NativeMoveParam);
    void* attacker=nullptr;
    if(field<u32>(biw,0x50)==3) {
        const unsigned slot=(field<u32>(biw,0x68)>>19)&3;
        if(slot<3) attacker=field<void*>(biw,0x330+slot*4);
    } else attacker=moveTarget(reinterpret_cast<const u32*>(param)[4]);
    const bool normalize=abilityOf(attacker)==96;
    // Lower two bits hold the selected move slot, upper bits the attacker's
    // creation-time view position. Rotation reads its current native slot.
    gBattleMoveHud.selectedSlot=static_cast<u8>(reinterpret_cast<const u32*>(param)[4]<<2);
    gBattleMoveHud.label=0;
    for(unsigned i=0;i<4;++i) {
        const unsigned move=param[i];
        // Native drawing has already populated the move-data cache for these moves.
        unsigned type=move?get(move,0):0;
        bool damaging=move&&get(move,2);
        if(move==237) {
            void* pp=ram(attacker)?field<void*>(attacker,0):nullptr;
            if(ram(pp)) type=reinterpret_cast<unsigned(*)(void*)>(NativeHiddenPower)(pp);
            else damaging=false;
        }
        if(normalize) type=0;
        // Struggle ignores the type chart. Item/weather-dependent types need
        // event context: leave those names neutral instead of guessing a type.
        if(move==165||move==311||move==363||move==449||move==546) damaging=false;
        const bool sound=move&&reinterpret_cast<unsigned(*)(unsigned,unsigned)>(NativeMoveFlag)(move,8);
        gBattleMoveHud.attributes[i]=static_cast<u8>(type|(sound?32:0)|(damaging?128:0)|(fixedDamage(move)?64:0));
    }
    moveUpdate(biw,param);
}
static void HudMoveClear(void* biw,unsigned nextScreen) {
    // This call site still holds CreateScreen's type in r1. The native clear
    // consumes only r0. Copy 2bpp glyphs on the stack across that synchronous call.
    u8 glyph[512];
    auto& s=gBattleMoveHud;
    Bitmap* b=moveBitmap(biw);
    const unsigned active=field<u32>(biw,0x300);
    const unsigned slot=active<3?field<u8>(biw,0x2c8+active*8):255;
    const bool keep=b&&s.input==biw&&nextScreen==3&&field<u32>(biw,0x58)==2&&slot<4;
    if(keep) {
        s.selectedSlot=static_cast<u8>((s.selectedSlot&~3u)|slot);s.selectedMove=field<u16>(biw,0x2f0+slot*2);
        for(unsigned y=0;y<16;++y) for(unsigned x=0;x<128;x+=4) {
            unsigned packed=0;
            for(unsigned n=0;n<4;++n) {
                unsigned c=movePixel(*b,(slot&1)*128+x+n,10+(slot/2)*48+y);
                if(c==MoveYellow||c==MoveBlue||c==MoveRed) c=MoveWhite;
                packed|=(c<=2?c:0)<<(2*n);
            }
            glyph[y*32+x/4]=static_cast<u8>(packed);
        }
    }
    if(s.input==biw&&s.paletteInstalled) movePalette(biw,true);
    reinterpret_cast<void(*)(void*)>(NativeMoveClear)(biw);
    s.label=keep;
    if(keep) {
        for(unsigned y=0;y<16;++y) for(unsigned x=0;x<128;++x)
            movePixel(*b,64+x,y,(glyph[y*32+x/4]>>((x&3)*2))&3);
        reinterpret_cast<void(*)(void*)>(NativeFlushBitmap)(field<void*>(biw,0x2ac));
    }
}
static int HudMoveKey(void* biw,void* tp,const signed char* keys,const void* moveTable,int hit,unsigned transformed) {
    const int result=reinterpret_cast<int(*)(void*,void*,const signed char*,const void*,int,unsigned)>(NativeMoveKey)
        (biw,tp,keys,moveTable,hit,transformed);
    const unsigned screen=field<u32>(biw,0x58);
    if(screen==2||screen==5) moveUpdate(biw,reinterpret_cast<u16*>(static_cast<u8*>(biw)+0x2f0));
    else if(screen==3) {
        const unsigned cursor=(field<u32>(biw,0x68)>>5)&15;
        // a_button is the actual native target-card index; cursor_pos is a
        // move-specific key-table index, NOT a Pokémon position.
        int target=hit>=0?hit:keys[cursor*12+10];
        unsigned count=0;
        for(unsigned i=0;i<6;++i) if(keys[cursor*12+i]>=0) ++count;
        if(hit<0&&count!=1) target=-1; // spread/field confirmation has no single target
        moveUpdate(biw,nullptr,target);
    }
    return result;
}
