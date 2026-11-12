// Move buttons use the stock bitmap. Target selection gets a BG6 nameplate.
struct MoveHudState {
    void* input;
    void* disguise;
    u16 disguiseTypes;
    u8 attributes[4];
    u8 attackerView, paletteColors, failure;
    void* labelWindow;
#if defined(BW1_MOVE_PROFILE)
    u16 moves[4]; // Native rotation menus do not populate the normal move array.
#endif
#if defined(BW1_MOVE_TRACE)
    u32 targetTrace[4]; // Private diagnostic build; never bundled.
    volatile u8 targetKeyRow[12];
#endif
#if defined(MOVE_LABEL_TUNE)
    signed char tuneDx, tuneDy;
    u8 tuneWidth, tuneDirections;
#endif
};
extern "C" { MoveHudState gBattleMoveHud; }
static_assert(sizeof(MoveHudState)==
#if defined(BW1_MOVE_TRACE)
    60,
#elif defined(BW1_MOVE_PROFILE)
    32,
#elif defined(MOVE_LABEL_TUNE)
    28,
#else
    24,
#endif
    "standalone move state budget");
// Dedicated immutable-at-runtime RGB555 table. Volatile prevents the compiler
// from folding colors into instructions; installers may edit exactly six bytes.
extern "C" const volatile u16 gMovePreviewColors[3]={0x2b5e,0x62b3,0x211f};

namespace {
void fail(unsigned why) { if(!gBattleMoveHud.failure) gBattleMoveHud.failure=static_cast<u8>(why); }
constexpr unsigned MoveWhite=1, MoveYellow=11, MoveBlue=12, MoveRed=13;
constexpr unsigned LabelBg=6, LabelScreenY=172, LabelWidth=136, LabelCanvasHeight=24;
constexpr unsigned LabelHeight=17, LabelLeft=1, LabelMinWidth=86, LabelPadding=14, GlyphHeight=16;
constexpr unsigned LabelMaxTextWidth=102, FooterTileY=22;
#if defined(BW1_MOVE_PROFILE)
constexpr unsigned LabelCap=0;
#else
constexpr unsigned LabelCap=1;
#endif
constexpr unsigned UpperLabelX=6, UpperLabelY=159-LabelCap;
constexpr unsigned TextPalette=13, LabelPalette=14, PreviewColors=3, LabelColors=15;
constexpr unsigned LabelWhite=7, LabelShadow=14;
constexpr u16 UnusedColor=0x7c1f;
struct Bitmap { u8* pixels; u16 width,height,format,owner; };
Bitmap* moveBitmap(void* biw) {
    if(!ram(biw)) return nullptr;
    auto* bmp=field<Bitmap*>(biw,MoveBitmap);
    void* win=field<void*>(biw,MoveWindow);
    if(!ram(win)||!ram(bmp)||!ram(bmp->pixels) || bmp->width!=256 || bmp->height!=96
       ||bmp->format!=32||field<void*>(win,12)!=bmp) {fail(7);return nullptr;}
    return bmp;
}
unsigned moveOffset(const Bitmap& b,unsigned x,unsigned y) {
    return ((y/8)*(b.width/8)+x/8)*32+(y&7)*4+(x&7)/2;
}
unsigned movePixel(const Bitmap& b,unsigned x,unsigned y) {
    return (b.pixels[moveOffset(b,x,y)]>>((x&1)*4))&15;
}
void movePixel(Bitmap& b,unsigned x,unsigned y,unsigned c) {
    u8& v=b.pixels[moveOffset(b,x,y)];const unsigned s=(x&1)*4;
    v=static_cast<u8>((v&~(15u<<s))|(c<<s)); // bitmap is RAM, flushed by native halfword copy
}
FadeBank* moveFade(void* biw) {
    void* p=field<void*>(biw,MovePfd);
    if(!ram(p)) return nullptr;
    auto* f=static_cast<FadeBank*>(p)+1; // FADE_SUB_BG
    return ram(f->source)&&ram(f->transfer)&&f->bytes>=444?f:nullptr;
}
bool movePalette(void* biw,const volatile u16* colors,unsigned count) {
    FadeBank* f=moveFade(biw);
    const bool label=count==LabelColors;
    const unsigned first=label?LabelPalette*16+1:TextPalette*16+MoveYellow;
    if(!f||f->bytes<(first+count)*2) return false;
    const int evy=currentFade(*f,TextPalette);if(evy<0) return false;
    for(unsigned i=0;i<count;++i) {
        const unsigned at=first+i;
        const u16 color=colors?colors[i]:label?0:UnusedColor;
        const u16 shown=blend(color,f->target,evy);
        f->source[at]=color;f->transfer[at]=shown;
        reinterpret_cast<volatile u16*>(0x05000400)[at]=shown;
    }
    gBattleMoveHud.paletteColors=colors?count:0;
    return true;
}
bool moveBind(void* biw) {
    if(!moveBitmap(biw)) return false;
    auto& s=gBattleMoveHud;
    if(s.input!=biw) {
        if(s.labelWindow) return false;
        s.input=biw;s.disguise=nullptr;s.paletteColors=0;
    }
    if(s.paletteColors==LabelColors&&!movePalette(biw,nullptr,LabelColors)) return false;
    if(!s.paletteColors) {
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
bool tintMove(Bitmap& bmp,unsigned x,unsigned y,unsigned width,unsigned color) {
    bool changed=false;
    for(unsigned yy=y;yy<y+GlyphHeight;++yy) for(unsigned xx=x;xx<x+width;++xx) {
        const unsigned old=movePixel(bmp,xx,yy);
        if((old==MoveWhite||old==MoveYellow||old==MoveBlue||old==MoveRed)&&old!=color) {
            movePixel(bmp,xx,yy,color);changed=true;
        }
    }
    return changed;
}
void moveUpdate(void* biw,const u16* moves) {
    if(!moveBind(biw)) return;
    auto& s=gBattleMoveHud;
    const unsigned rule=field<u32>(biw,MoveRule);
    Bitmap& bmp=*field<Bitmap*>(biw,MoveBitmap);
    void* target=(rule==0||rule==3)?moveTarget(rule==0?1:3):nullptr;
    bool changed=false;
    for(unsigned i=0;i<4;++i)
        changed|=tintMove(bmp,(i&1)*128,10+(i/2)*48,128,moveColor(biw,moves[i],s.attributes[i],target));
    // Palette refresh has no resource loads; no bitmap transfer on unchanged frames.
    if(!s.paletteColors) movePalette(biw,gMovePreviewColors,PreviewColors);
    if(changed) reinterpret_cast<void(*)(void*)>(NativeFlushBitmap)(field<void*>(biw,MoveWindow));
}
void* labelFooter(void* biw) {
    void* footer=field<void*>(biw,MoveBitmap+4);
    if(!ram(footer)||field<u8>(footer,2)!=LabelBg||field<u8>(footer,3)!=3||field<u8>(footer,4)!=FooterTileY||
       field<u8>(footer,5)!=3||field<u8>(footer,6)!=2||field<u8>(footer,9)!=TextPalette) return nullptr;
    return footer;
}
bool labelFooterIsBlank(void* biw) {
    void* footer=labelFooter(biw);
    if(!footer) return false;
    auto* bitmap=field<Bitmap*>(footer,12);
    if(!ram(bitmap)||bitmap->width!=24||bitmap->height!=16||bitmap->format!=32||!ram(bitmap->pixels)) return false;
    for(unsigned i=0;i<24*16/2;++i) if(bitmap->pixels[i]) return false;
    return true;
}
void closeLabel() {
    auto& s=gBattleMoveHud;
    if(!s.labelWindow) return;
    reinterpret_cast<void(*)(void*)>(NativeMoveWindowUnmap)(s.labelWindow);
    // The native footer's bitmap remains intact while the label covers its tiles.
    if(field<u8>(s.labelWindow,4)+field<u8>(s.labelWindow,6)>FooterTileY)
        if(void* footer=labelFooter(s.input)) reinterpret_cast<void(*)(void*)>(NativeMoveWindowMap)(footer);
#if defined(MOVE_LABEL_TUNE)
    s.tuneWidth=0;
    s.tuneDirections=0;
#endif
    reinterpret_cast<void(*)(unsigned)>(NativeMoveBgCommit)(LabelBg);
    reinterpret_cast<void(*)(void*)>(NativeMoveWindowDelete)(s.labelWindow);
    s.labelWindow=nullptr;
}
struct LabelGlyphs {
    u8 pixels[512];
    unsigned left=128,right=0,top=GlyphHeight,bottom=0;
};
#if defined(MOVE_LABEL_TUNE)
constexpr unsigned TuneTileY=18, TuneWidth=144, TuneHeight=48;
constexpr unsigned TuneTop=LabelScreenY-8*TuneTileY;
int clampTune(int position,int last) {
    return position<0?0:position>last?last:position;
}
bool tuneLabelInput(void* biw,int hit) {
    auto& s=gBattleMoveHud;
    if(s.input!=biw||!s.tuneWidth||field<u32>(biw,MoveScreen)!=3) return false;
    constexpr unsigned Right=0x10, Left=0x20, Up=0x40, Down=0x80, ShoulderL=0x200;
    const unsigned held=~*reinterpret_cast<const volatile u16*>(0x04000130);
    const bool tuning=(held&ShoulderL)!=0;
    const unsigned directions=tuning?held&(Right|Left|Up|Down):0;
    const unsigned pressed=directions&~s.tuneDirections;
    s.tuneDirections=static_cast<u8>(directions);
    if(pressed) {
        const int x=static_cast<int>(LabelLeft)+s.tuneDx, y=static_cast<int>(TuneTop)+s.tuneDy;
        const int nextX=clampTune(x+((pressed&Right)!=0)-((pressed&Left)!=0),TuneWidth-s.tuneWidth);
        const int nextY=static_cast<int>(LabelCap)+clampTune(
            y+((pressed&Down)!=0)-((pressed&Up)!=0)-static_cast<int>(LabelCap),TuneHeight-LabelHeight-2*LabelCap);
        if(nextX!=x||nextY!=y) {
            Bitmap& bmp=*field<Bitmap*>(s.labelWindow,12);
            // Copy away from the direction of overlap so the pixels can move in place.
            constexpr unsigned height=LabelHeight+2*LabelCap;
            for(unsigned row=0;row<height;++row) {
                const int j=static_cast<int>(nextY>y?height-1-row:row)-static_cast<int>(LabelCap);
                for(unsigned col=0;col<s.tuneWidth;++col) {
                    const unsigned i=nextX>x?s.tuneWidth-1-col:col;
                    const unsigned pixel=movePixel(bmp,x+i,y+j);
                    movePixel(bmp,x+i,y+j,0);
                    movePixel(bmp,nextX+i,nextY+j,pixel);
                }
            }
            s.tuneDx=static_cast<signed char>(nextX-static_cast<int>(LabelLeft));
            s.tuneDy=static_cast<signed char>(nextY-static_cast<int>(TuneTop));
            reinterpret_cast<void(*)(void*)>(NativeFlushBitmap)(s.labelWindow);
        }
    }
    // Keep the target cursor stationary while tuning. Touch still works.
    return tuning&&hit<0;
}
#endif
// Keep the native cap rows and sample the diagonals on each side of the bend.
// Insets shorten the spans between corners while retaining their pixel steps.
constexpr unsigned FrameEdgeWidth=16;
#if defined(BW1_MOVE_PROFILE)
constexpr unsigned GridPeriod=5, GridTop=3, GridBottom=14;
constexpr u8 FrameRows[LabelHeight]={0,3,5,6,9,12,16,19,23,27,29,32,35,39,41,44,47};
constexpr u8 FrameInsets[LabelHeight]={12,9,7,6,5,4,3,2,0,2,3,4,5,6,7,9,12};
bool frameGrid(unsigned pixel) { return pixel>=1&&pixel<=6; }
#else
constexpr unsigned GridPeriod=3, GridTop=3, GridBottom=14;
// Trim the straight runs and keep the native steps through the bends.
constexpr u8 FrameRows[LabelHeight]={3,4,5,6,7,8,14,15,16,17,18,39,40,41,42,43,44};
constexpr u8 FrameInsets[LabelHeight]={6,5,4,3,2,1,0,0,0,0,0,1,1,2,2,3,3};
bool frameGrid(unsigned pixel) { return pixel==3||pixel==5; }
#endif
struct LabelFrameRow {
    u8 sides[2][FrameEdgeWidth], lengths[2], grid[GridPeriod];
};
struct LabelFrame {
    LabelFrameRow rows[LabelHeight];
#if !defined(BW1_MOVE_PROFILE)
    u8 caps[2][2][FrameEdgeWidth];
#endif
    u16 colors[16];
};
unsigned stockFramePixel(unsigned slot,unsigned x,unsigned row) {
    // BG5's stock move page spans the right-hand screen blocks of its 512x512
    // map. Read the tile index and flips before the native screen transition.
    const unsigned y=224+(slot/2)*48+row;
    x+=(slot&1)*128;
    const auto* map=reinterpret_cast<const volatile u16*>(0x06202800+(y/256)*0x1000);
    const unsigned entry=map[((y&255)/8)*32+x/8];
    if((entry>>12)!=9+slot) return 0;
    const unsigned tx=(x&7)^((entry&0x400)?7:0), ty=(y&7)^((entry&0x800)?7:0);
    const auto* tiles=reinterpret_cast<const volatile u16*>(0x06210000);
    return (tiles[(entry&1023)*16+ty*2+tx/4]>>((tx&3)*4))&15;
}
unsigned frameSideRow(unsigned y,unsigned side) {
#if defined(BW1_MOVE_PROFILE)
    (void)side;
    return y;
#else
    return side?LabelHeight-1-y:y;
#endif
}
bool captureLabelFrame(FadeBank& fade,unsigned slot,LabelFrame& frame) {
    if((*reinterpret_cast<const volatile u16*>(0x0400100a)&0xfffc)!=0xc410) return false;
    const u16* palette=fade.source+(9+slot)*16;
    for(unsigned i=1;i<16;++i) frame.colors[i]=palette[i];
    frame.colors[LabelWhite]=fade.source[TextPalette*16+MoveWhite];
    frame.colors[LabelShadow]=fade.source[TextPalette*16+2];
#if !defined(BW1_MOVE_PROFILE)
    unsigned gridRow=6;
#endif
    for(unsigned y=0;y<LabelHeight;++y) {
        auto& row=frame.rows[y];
        const bool interior=y>=GridTop&&y<GridBottom;
        for(unsigned side=0;side<2;++side) {
            const unsigned sample=FrameRows[frameSideRow(y,side)];
#if defined(BW1_MOVE_PROFILE)
            const unsigned sourceRow=sample;
#else
            const unsigned sourceRow=side?47-sample:sample;
#endif
            unsigned start=0;
            for(;start<64;++start) if(stockFramePixel(slot,side?127-start:start,sourceRow)) break;
            if(start==64) return false;
#if !defined(BW1_MOVE_PROFILE)
            if(y==0||y==LabelHeight-1) {
                // The first and last native rows contain only the two raised corners.
                const unsigned cap=y!=0;
                for(unsigned i=0;i<FrameEdgeWidth;++i) {
                    const unsigned x=start+i;
                    const unsigned pixel=stockFramePixel(slot,side?127-x:x,cap?45:2);
                    if(pixel==LabelWhite||pixel==LabelShadow) return false;
                    frame.caps[cap][side][i]=static_cast<u8>(pixel);
                }
            }
#endif
            unsigned i=0;
            for(;i<FrameEdgeWidth;++i) {
                const unsigned x=start+i;
                const unsigned pixel=stockFramePixel(slot,side?127-x:x,sourceRow);
                if(interior&&frameGrid(pixel)) break;
                if(pixel==LabelWhite||pixel==LabelShadow) return false;
                row.sides[side][i]=static_cast<u8>(pixel);
            }
            row.lengths[side]=static_cast<u8>(i);
        }
        for(unsigned x=0;x<GridPeriod;++x) {
#if defined(BW1_MOVE_PROFILE)
            const unsigned pixel=y==0||y==16?15:y==1?8:y==15?10:stockFramePixel(slot,56+x,FrameRows[y]);
#else
            const unsigned sourceRow=interior?gridRow:FrameRows[y];
            const unsigned pixel=stockFramePixel(slot,56+x,sourceRow);
#endif
            if(pixel==LabelWhite||pixel==LabelShadow) return false;
            row.grid[x]=static_cast<u8>(pixel);
        }
#if !defined(BW1_MOVE_PROFILE)
        if(interior&&++gridRow==6+GridPeriod) gridRow=6;
#endif
    }
    return true;
}
void showLabel(void* biw,const LabelGlyphs& glyph,const LabelFrame& frame) {
    FadeBank* f=moveFade(biw);
    if(!f||f->bytes<(LabelPalette+1)*32) return;
    for(unsigned i=0;i<16;++i) if(f->source[LabelPalette*16+i]) return;
    const bool footerBlank=labelFooterIsBlank(biw);
    // Leave the native footer visible on builds that put text in it here.
    const unsigned screenY=footerBlank?LabelScreenY:UpperLabelY;
    unsigned tileY=screenY/8, canvasWidth=LabelWidth, canvasHeight=LabelCanvasHeight;
    unsigned labelX=footerBlank?LabelLeft:UpperLabelX, labelY=screenY&7;
#if defined(MOVE_LABEL_TUNE)
    auto& s=gBattleMoveHud;
    const bool tuning=footerBlank&&field<u32>(biw,MoveRule)==1;
    if(tuning) {
        tileY=TuneTileY;canvasWidth=TuneWidth;canvasHeight=TuneHeight;
    }
#endif
    auto create=reinterpret_cast<void*(*)(unsigned,unsigned,unsigned,unsigned,unsigned,unsigned,unsigned)>(NativeMoveWindowCreate);
    void* window=create(LabelBg,0,tileY,canvasWidth/8,canvasHeight/8,LabelPalette,1);
    if(!window) return;
    if(!movePalette(biw,frame.colors+1,LabelColors)) {
        reinterpret_cast<void(*)(void*)>(NativeMoveWindowDelete)(window);
        return;
    }
    Bitmap& bmp=*field<Bitmap*>(window,12);
    const unsigned width=glyph.right-glyph.left, height=glyph.bottom-glyph.top;
    const unsigned visibleWidth=width>LabelMaxTextWidth?LabelMaxTextWidth:width;
    const unsigned visibleHeight=height>13?13:height;
    const unsigned plateWidth=visibleWidth+2*LabelPadding<LabelMinWidth?LabelMinWidth:visibleWidth+2*LabelPadding;
#if defined(MOVE_LABEL_TUNE)
    if(tuning) {
        labelX=clampTune(static_cast<int>(LabelLeft)+s.tuneDx,TuneWidth-plateWidth);
        labelY=LabelCap+clampTune(static_cast<int>(TuneTop-LabelCap)+s.tuneDy,
                                 TuneHeight-LabelHeight-2*LabelCap);
    }
#endif
    const unsigned sourceX=glyph.left+(width-visibleWidth)/2;
    const unsigned sourceY=glyph.top+(height-visibleHeight)/2;
    const unsigned targetX=labelX+(plateWidth-visibleWidth)/2;
    const unsigned targetY=labelY+(LabelHeight-visibleHeight)/2;
    for(unsigned i=0;i<canvasWidth*canvasHeight/2;++i) bmp.pixels[i]=0;
    for(unsigned y=0;y<LabelHeight;++y) {
        const auto& row=frame.rows[y];
        const unsigned left=FrameInsets[y], right=FrameInsets[frameSideRow(y,1)];
        unsigned phase=left;
        while(phase>=GridPeriod) phase-=GridPeriod;
        for(unsigned x=left;x<plateWidth-right;++x) {
            unsigned color=row.grid[phase];
            const unsigned fromLeft=x-left, fromRight=plateWidth-right-1-x;
            if(fromLeft<row.lengths[0]) color=row.sides[0][fromLeft];
            if(fromRight<row.lengths[1]) color=row.sides[1][fromRight];
            movePixel(bmp,labelX+x,labelY+y,color);
            if(++phase==GridPeriod) phase=0;
        }
    }
#if !defined(BW1_MOVE_PROFILE)
    for(unsigned cap=0;cap<2;++cap) {
        const unsigned edgeY=cap?LabelHeight-1:0;
        const unsigned y=cap?labelY+LabelHeight:labelY-1;
        for(unsigned i=0;i<FrameEdgeWidth;++i) {
            movePixel(bmp,labelX+FrameInsets[edgeY]+i,y,frame.caps[cap][0][i]);
            movePixel(bmp,labelX+plateWidth-1-FrameInsets[frameSideRow(edgeY,1)]-i,y,frame.caps[cap][1][i]);
        }
    }
#endif
    for(unsigned y=0;y<visibleHeight;++y) for(unsigned x=0;x<visibleWidth;++x) {
        const unsigned source=sourceX+x;
        const unsigned color=(glyph.pixels[(sourceY+y)*32+source/4]>>((source&3)*2))&3;
        if(color) movePixel(bmp,targetX+x,targetY+y,color==1?LabelWhite:LabelShadow);
    }
    reinterpret_cast<void(*)(void*)>(NativeFlushBitmap)(window);
    reinterpret_cast<void(*)(void*)>(NativeMoveWindowMap)(window);
    reinterpret_cast<void(*)(unsigned)>(NativeMoveBgCommit)(LabelBg);
    gBattleMoveHud.labelWindow=window;
#if defined(MOVE_LABEL_TUNE)
    if(tuning) {
        s.tuneWidth=static_cast<u8>(plateWidth);
        s.tuneDx=static_cast<signed char>(static_cast<int>(labelX)-static_cast<int>(LabelLeft));
        s.tuneDy=static_cast<signed char>(static_cast<int>(labelY)-static_cast<int>(TuneTop));
    }
#endif
}
}
static void HudMoveDraw(void* biw,const u16* param) {
    reinterpret_cast<void(*)(void*,const u16*)>(NativeMoveDraw)(biw,param);
    if(!moveBind(biw)) return;
    auto get=reinterpret_cast<unsigned(*)(unsigned,unsigned)>(NativeMoveParam);
    void* attacker=nullptr;
    if(field<u32>(biw,MoveRule)==3) {
        const unsigned slot=(field<u32>(biw,MoveState)>>19)&3;
        if(slot<3) attacker=field<void*>(biw,MoveRotationMons+slot*4);
    } else attacker=moveTarget(reinterpret_cast<const u32*>(param)[4]);
    const bool normalize=abilityOf(attacker)==96;
    // Rotation reads its current native slot instead of this view position.
    gBattleMoveHud.attackerView=static_cast<u8>(reinterpret_cast<const u32*>(param)[4]);
    for(unsigned i=0;i<4;++i) {
        const unsigned move=param[i];
#if defined(BW1_MOVE_PROFILE)
        gBattleMoveHud.moves[i]=static_cast<u16>(move);
#endif
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
    LabelGlyphs glyph;
    LabelFrame frame;
    auto& s=gBattleMoveHud;
    Bitmap* b=moveBitmap(biw);
    const unsigned active=field<u32>(biw,MoveSelectedActive);
    const unsigned slot=active<3?field<u8>(biw,MoveSelectedSlots+active*8):255;
    auto* fade=b&&s.input==biw&&nextScreen==3&&field<u32>(biw,MoveScreen)==2&&slot<4?moveFade(biw):nullptr;
    const bool keep=fade&&captureLabelFrame(*fade,slot,frame);
    if(keep) {
        for(unsigned y=0;y<GlyphHeight;++y) for(unsigned x=0;x<128;x+=4) {
            unsigned packed=0;
            for(unsigned n=0;n<4;++n) {
                unsigned c=movePixel(*b,(slot&1)*128+x+n,10+(slot/2)*48+y);
                if(c==MoveYellow||c==MoveBlue||c==MoveRed) c=MoveWhite;
                if(c>2) c=0;
                if(c) {
                    if(x+n<glyph.left) glyph.left=x+n;
                    if(x+n+1>glyph.right) glyph.right=x+n+1;
                    if(y<glyph.top) glyph.top=y;
                    glyph.bottom=y+1;
                }
                packed|=c<<(2*n);
            }
            glyph.pixels[y*32+x/4]=static_cast<u8>(packed);
        }
    }
    if(s.input==biw) {
        closeLabel();
        if(s.paletteColors) movePalette(biw,nullptr,s.paletteColors);
    }
    reinterpret_cast<void(*)(void*)>(NativeMoveClear)(biw);
    if(keep&&glyph.left<glyph.right) showLabel(biw,glyph,frame);
}
static void HudMoveDestroy(void* biw) {
    auto& s=gBattleMoveHud;
    if(s.input==biw) {
        closeLabel();
        if(s.paletteColors) movePalette(biw,nullptr,s.paletteColors);
        s.input=nullptr;
    }
    reinterpret_cast<void(*)(void*)>(NativeMoveDestroy)(biw);
}
static int HudMoveKey(void* biw,void* tp,const signed char* keys,const void* moveTable,int hit,unsigned transformed) {
#if defined(MOVE_LABEL_TUNE)
    if(tuneLabelInput(biw,hit)) return -1;
#endif
    const int result=reinterpret_cast<int(*)(void*,void*,const signed char*,const void*,int,unsigned)>(NativeMoveKey)
        (biw,tp,keys,moveTable,hit,transformed);
    const unsigned screen=field<u32>(biw,MoveScreen);
    if(screen==2||screen==5) moveUpdate(biw,
#if defined(BW1_MOVE_PROFILE)
        gBattleMoveHud.moves);
#else
        reinterpret_cast<u16*>(static_cast<u8*>(biw)+MoveMoveArray));
#endif
#if defined(BW1_MOVE_TRACE)
    else if(screen==3) {
        const unsigned cursor=(field<u32>(biw,MoveState)>>5)&15;
        // a_button is the actual native target-card index; cursor_pos is a
        // move-specific key-table index, NOT a Pokémon position.
        int target=hit>=0?hit:keys[cursor*12+10];
        unsigned count=0;
        for(unsigned i=0;i<6;++i) if(keys[cursor*12+i]>=0) {
            // Retail BW1 repeats a single target ID across several entries.
            // Four copies of one ID still describe one opponent, not a spread.
            bool duplicate=false;
            for(unsigned j=0;j<i;++j)if(keys[cursor*12+j]==keys[cursor*12+i])duplicate=true;
            if(duplicate)continue;
            ++count;
        }
        if(hit<0&&count!=1) target=-1; // spread/field confirmation has no single target
        gBattleMoveHud.targetTrace[0]=static_cast<u32>(hit);
        gBattleMoveHud.targetTrace[1]=static_cast<u32>(result);
        gBattleMoveHud.targetTrace[2]=reinterpret_cast<u32>(keys);
        gBattleMoveHud.targetTrace[3]=cursor|(static_cast<u8>(keys[cursor*12+10])<<8)
            |(count<<16)|(static_cast<u8>(target)<<24);
        for(unsigned i=0;i<12;++i)gBattleMoveHud.targetKeyRow[i]=static_cast<u8>(keys[cursor*12+i]);
    }
#endif
    return result;
}
