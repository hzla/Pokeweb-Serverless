#include <stdint.h>
using u8=uint8_t;using u16=uint16_t;using u32=uint32_t;
#include "assets.generated.h"
extern "C" u32 OriginalSaveMenuMain(void*,void*,void*,void*);
namespace {
template<class F> F native(u32 address){return reinterpret_cast<F>(address);}
template<class T> T& field(void* p,u32 at){return *reinterpret_cast<T*>(static_cast<u8*>(p)+at);}
u16 load16(const u8* p){return u16(p[0])|u16(p[1])<<8;}
u32 load32(const u8* p){return u32(load16(p))|u32(load16(p+2))<<16;}
volatile u16* const upper=reinterpret_cast<volatile u16*>(0x06000000);
volatile u16* const lower=reinterpret_cast<volatile u16*>(0x06200000);
volatile u32* const topDisplay=reinterpret_cast<volatile u32*>(0x04000000);
volatile u32* const bottomDisplay=reinterpret_cast<volatile u32*>(0x04001000);
volatile u16* const mainBrightness=reinterpret_cast<volatile u16*>(0x0400006c);
volatile u16* const subBrightness=reinterpret_cast<volatile u16*>(0x0400106c);
volatile u16* const scanline=reinterpret_cast<volatile u16*>(0x04000006);
constexpr u16 Black=0x8000|3|(3<<5)|(3<<10);
constexpr u16 Body=0x8000|6|(6<<5)|(6<<10);
constexpr u16 Grid=0x8000|9|(9<<5)|(9<<10);
constexpr u16 Slate=0x8000|12|(12<<5)|(12<<10);
constexpr u16 White=0x8000|31|(31<<5)|(31<<10);
constexpr u16 Shadow=0x8000|7|(7<<5)|(7<<10);
constexpr u16 Blue=0x8000|27|(19<<5)|(6<<10);
constexpr u16 Cyan=0x8000|29|(23<<5)|(7<<10);
constexpr u16 Red=0x8000|30|(5<<5)|(5<<10);
constexpr u16 CaseRim=0x8000|11|(11<<5)|(11<<10);
constexpr u16 CaseGroove=0x8000|4|(4<<5)|(4<<10);
constexpr u16 CaseGoldDark=0x8000|12|(10<<5)|(4<<10);
constexpr u16 CaseGold=0x8000|29|(23<<5)|(5<<10);
constexpr int PartyTop=96;
constexpr u8 ZoomSteps[]={254,248,238,226,211,195,178,160,142,125,109,94,82,72,66,64};
struct Icon{u8 poses[1024];u16 palette[16];bool valid;};
Icon icons[6];
u8 partySize=0,sex=0,page=0,lastPage=255,zoomFrame=0;
u16 location=0xffff,trainer[16],place[40];
u32 badgeMask=0,timeHours=0,timeMinutes=0,ticks=0;
u8 markerTicker=47;
bool initialized=false,hasSave=false,noGraphics=false,navLatch=false,zooming=false;
bool continueHandoff=false;
u8* markerFrames=nullptr;
u8* badgePixels=nullptr;
u16* markerUnderlay=nullptr;
u16* cardCanvas=nullptr;
u16* titleUnderlay=nullptr;
int markerX=0,markerY=0;
u8 markerFrame=255;
constexpr u32 MarkerWidth=50,MarkerHeight=46,MarkerFramePixels=MarkerWidth*MarkerHeight;
struct VramRun{u16 value,count;};
VramRun *savedUpper=nullptr,*savedLower=nullptr;
u16 upperRuns=0,lowerRuns=0;
struct DisplayState{u32 control,bg2,affineA,affineB,originX,originY;};
DisplayState mainBefore,subBefore;
void captureDisplay(volatile u32* display,DisplayState& state){
    state.control=display[0];state.bg2=display[3];
    state.affineA=display[8];state.affineB=display[9];
    state.originX=display[10];state.originY=display[11];
}
void restoreDisplay(volatile u32* display,const DisplayState& state){
    display[3]=state.bg2;display[8]=state.affineA;display[9]=state.affineB;
    display[10]=state.originX;display[11]=state.originY;display[0]=state.control;
}
bool captureRuns(volatile u16* source,VramRun* out,u16 capacity,u16& used){
    used=0;
    for(int i=0;i<256*192;){
        const u16 value=source[i];u16 count=1;
        while(i+count<256*192&&count<65535&&source[i+count]==value)++count;
        if(used==capacity)return false;
        out[used++]={value,count};i+=count;
    }
    return true;
}
void restoreRuns(volatile u16* target,const VramRun* runs,u16 used){
    int at=0;
    for(u16 i=0;i<used;++i)for(u16 j=0;j<runs[i].count;++j)target[at++]=runs[i].value;
}
bool captureGraphics(){
    captureDisplay(topDisplay,mainBefore);captureDisplay(bottomDisplay,subBefore);
    savedUpper=static_cast<VramRun*>(native<void*(*)(u32,u32)>(0x02039dc9)(11,(8192+4096)*sizeof(VramRun)));
    if(!savedUpper)return false;
    savedLower=savedUpper+8192;
    if(captureRuns(upper,savedUpper,8192,upperRuns)&&captureRuns(lower,savedLower,4096,lowerRuns))return true;
    native<void(*)(void*)>(0x0203a279)(savedUpper);savedUpper=savedLower=nullptr;return false;
}
void restoreGraphics(){
    restoreRuns(upper,savedUpper,upperRuns);restoreRuns(lower,savedLower,lowerRuns);
    restoreDisplay(topDisplay,mainBefore);restoreDisplay(bottomDisplay,subBefore);
    native<void(*)(void*)>(0x0203a279)(savedUpper);savedUpper=savedLower=nullptr;
}
void fill(volatile u16* dst,int x0,int y0,int x1,int y1,u16 color){
    if(x0<0)x0=0;
    if(y0<0)y0=0;
    if(x1>256)x1=256;
    if(y1>192)y1=192;
    for(int y=y0;y<y1;++y)for(int x=x0;x<x1;++x)dst[y*256+x]=color;
}
void outline(volatile u16* p,int x0,int y0,int x1,int y1,u16 c){
    fill(p,x0,y0,x1,y0+1,c);fill(p,x0,y1-1,x1,y1,c);
    fill(p,x0,y0,x0+1,y1,c);fill(p,x1-1,y0,x1,y1,c);
}
void grid(volatile u16* p){
    for(int y=0;y<192;++y)for(int x=0;x<256;++x)p[y*256+x]=(x%8==0||y%8==0)?Grid:Body;
}
int nativeTopGlyph(volatile u16* dst,int cursor,int top,u16 code){
    const u8 index=code<127?MapFontLookup[code]:code==233?MapFontAccent[0]:MapFontLookup['?'];
    if(index==255)return 6;
    if(!dst)return MapFontAdvance[index];
    for(int y=0;y<15;++y){
        const int py=top+y;
        if(py<0||py>=192)continue;
        const u16 row=MapFontRows[index*15+y];
        for(int x=0;x<8;++x){
            const int px=cursor+x;
            if(px<0||px>=229)continue;
            if(row&(1<<x))dst[py*256+px]=White;
            else if(row&(1<<(x+8)))dst[py*256+px]=Shadow;
        }
    }
    return MapFontAdvance[index];
}
int nativeTrainerText(volatile u16* dst,int x,int y,const u16* str){
    for(int i=0;i<15&&str[i]&&str[i]!=0xffff&&x<229;++i)
        x+=nativeTopGlyph(dst,x,y,str[i]);
    return x;
}
int nativeTopText(volatile u16* dst,int x,int y,const char* str){
    while(*str&&x<229)x+=nativeTopGlyph(dst,x,y,u8(*str++));
    return x;
}
char* number(char* out,u32 value){
    char reverse[11];int n=0;
    do{
        u32 quotient=0,remainder=0;
        for(int bit=31;bit>=0;--bit){
            remainder=(remainder<<1)|((value>>bit)&1);
            if(remainder>=10){remainder-=10;quotient|=1u<<bit;}
        }
        reverse[n++]=char('0'+remainder);value=quotient;
    }while(value&&n<10);
    while(n)*out++=reverse[--n];
    return out;
}
void setup(volatile u32* display){
    volatile u16* regs=reinterpret_cast<volatile u16*>(display);
    regs[6]=0x4084;regs[16]=0x100;regs[17]=0;regs[18]=0;regs[19]=0x100;
    display[10]=0;display[11]=0;*display=0x10405;
}
void waitVBlankStart(){
    while(*scanline>=192){}
    while(*scanline<192){}
}
void zoomLower(u8 frame){
    const int step=ZoomSteps[frame];
    int x=(markerX+26)*256-128*step;
    int y=(markerY+29)*256-96*step;
    const int maxX=65536-256*step;
    int maxY=43008-192*step;
    if(maxY<0)maxY=0;
    if(x<0)x=0;else if(x>maxX)x=maxX;
    if(y<0)y=0;else if(y>maxY)y=maxY;
    waitVBlankStart();
    volatile u16* regs=reinterpret_cast<volatile u16*>(bottomDisplay);
    regs[16]=u16(step);regs[19]=u16(step);
    bottomDisplay[10]=u32(x);bottomDisplay[11]=u32(y);
}
void coverTransition(){*mainBrightness=0x8010;*subBrightness=0x8010;}
void revealMenu(){
    // The first render can span several video frames. Show it only after both
    // framebuffers and display registers are complete, at the next VBlank.
    while(*scanline<192){}
    *mainBrightness=0;*subBrightness=0;
}
void* allocate(u32 bytes){return native<void*(*)(u32,u32)>(0x02039dc9)(11,bytes);}
void release(void* pointer){if(pointer)native<void(*)(void*)>(0x0203a279)(pointer);}
bool decodeLz(const u8* source,u32 size,u32 expected,volatile u16* colors,const u16* palette,u8* bytes){
    if(size<4||source[0]!=0x10||((u32(source[1])|u32(source[2])<<8|u32(source[3])<<16)!=expected))return false;
    u8* history=static_cast<u8*>(allocate(4096));
    if(!history)return false;
    u32 cursor=4,at=0;bool okay=true;
    while(at<expected&&okay){
        if(cursor>=size){okay=false;break;}
        const u8 flags=source[cursor++];
        for(int bit=7;bit>=0&&at<expected;--bit){
            u32 count=1,distance=0;u8 value=0;
            if(flags&(1<<bit)){
                if(cursor+2>size){okay=false;break;}
                const u8 a=source[cursor++],b=source[cursor++];
                count=(a>>4)+3;distance=((u32(a)&15)<<8|b)+1;
                if(distance>at){okay=false;break;}
            }else{
                if(cursor>=size){okay=false;break;}
                value=source[cursor++];
            }
            while(count--&&at<expected){
                if(distance)value=history[(at-distance)&4095];
                history[at&4095]=value;
                if(colors)colors[at]=palette[value];else bytes[at]=value;
                ++at;
            }
        }
    }
    release(history);
    return okay&&at==expected;
}
bool drawMap(){return decodeLz(UnovaMapLz,sizeof(UnovaMapLz),256*168,lower,UnovaPalette,nullptr);}
void nativeMapText(){
    int cursor=16;
    for(int i=0;i<39&&place[i]&&cursor<143;++i){
        const u16 code=place[i];
        const u8 glyph=code<127?MapFontLookup[code]:code==233?MapFontAccent[0]:255;
        if(glyph==255){cursor+=6;continue;}
        for(int y=0;y<15;++y){
            const u16 row=MapFontRows[glyph*15+y];
            for(int x=0;x<8;++x){
                const int px=cursor+x,py=6+y;
                if(px>=152||py>=24)continue;
                if(row&(1<<x))lower[py*256+px]=MapFontPalette[0];
                else if(row&(1<<(x+8)))lower[py*256+px]=MapFontPalette[1];
            }
        }
        cursor+=MapFontAdvance[glyph];
    }
}
void nativeMapTitle(){
    if(!place[0])return;
    const u8* source=MapTitleRle;
    u32 x=0,y=2;
    for(u32 at=0;at<152*22;){
        const u8 token=*source++;
        const u32 count=(token&127)+1;
        if(token&128){
            const u16 color=MapTitlePalette[*source++];
            for(u32 i=0;i<count;++i,++at){lower[y*256+x]=color;if(++x==152){x=0;++y;}}
        }else for(u32 i=0;i<count;++i,++at){
            lower[y*256+x]=MapTitlePalette[*source++];if(++x==152){x=0;++y;}
        }
    }
    nativeMapText();
}
u8 markerPhase(u8 phase){
    if(phase<4)return 0;
    if(phase<10)return 1;
    if(phase<16)return 2;
    if(phase<22)return 3;
    if(phase<28)return 4;
    if(phase<36)return 5;
    if(phase<42)return 6;
    return 7;
}
void drawMarkerFrame(u8 phase){
    if(!markerFrames||!markerUnderlay)return;
    const u8* sprite=markerFrames+phase*MarkerFramePixels;
    for(int y=0;y<int(MarkerHeight);++y)for(int x=0;x<int(MarkerWidth);++x){
        const int px=markerX+x,py=markerY+y;
        if(px<0||px>=256||py<0||py>=168)continue;
        const u32 at=y*MarkerWidth+x;
        const u8 color=sprite[at];
        lower[py*256+px]=color?MapMarkerPalette[color]:markerUnderlay[at];
    }
    markerFrame=phase;
    if(!zooming&&markerY<24&&markerY+int(MarkerHeight)>2&&markerX<152&&markerX+int(MarkerWidth)>0&&place[0])
        nativeMapTitle();
}
void prepareMarker(){
    markerFrame=255;
    for(u32 i=0;i<sizeof(MapPoints)/sizeof(MapPoints[0]);i+=3)if(MapPoints[i]==location){
        markerX=int(MapPoints[i+1])-26;markerY=int(MapPoints[i+2])-29;
        if(!markerFrames){
            markerFrames=static_cast<u8*>(allocate(8*MarkerFramePixels));
            if(!markerFrames||!decodeLz(MapMarkerLz,sizeof(MapMarkerLz),8*MarkerFramePixels,nullptr,nullptr,markerFrames)){
                release(markerFrames);markerFrames=nullptr;return;
            }
        }
        if(!markerUnderlay)markerUnderlay=static_cast<u16*>(allocate(MarkerFramePixels*sizeof(u16)));
        if(!markerUnderlay)return;
        for(int y=0;y<int(MarkerHeight);++y)for(int x=0;x<int(MarkerWidth);++x){
            const int px=markerX+x,py=markerY+y;
            markerUnderlay[y*MarkerWidth+x]=(px>=0&&px<256&&py>=0&&py<168)?lower[py*256+px]:0;
        }
        drawMarkerFrame(markerPhase(markerTicker));
        return;
    }
}
void blit4(volatile u16* dst,const u8* pixels,const u16* palette,int x,int y){
    for(int py=0;py<32;++py)for(int px=0;px<32;++px){
        const int tile=(py/8)*4+px/8;
        const u8 packed=pixels[tile*32+(py%8)*4+(px%8)/2];
        const u8 idx=(packed>>((px&1)*4))&15;
        if(idx&&x+px>=0&&x+px<256&&y+py>=0&&y+py<192)dst[(y+py)*256+x+px]=palette[idx]|0x8000;
    }
}
void drawPlayerGround(volatile u16* dst,int stride,int x0,int y0){
    constexpr u8 widths[]={6,9,11,9,6};
    for(int y=0;y<5;++y)for(int x=-widths[y];x<=widths[y];++x)
        dst[(y0+24+y)*stride+x0+16+x]=Body;
}
void stageSprite(u16* dst,const u8* pixels,const u16* palette,u16 background=Body){
    for(int i=0;i<32*32;++i)dst[i]=background==Body?Black:background;
    if(background==Body)drawPlayerGround(dst,32,0,0);
    if(!pixels)return;
    for(int py=0;py<32;++py)for(int px=0;px<32;++px){
        const int tile=(py/8)*4+px/8;
        const u8 packed=pixels[tile*32+(py%8)*4+(px%8)/2];
        const u8 index=(packed>>((px&1)*4))&15;
        if(index)dst[py*32+px]=palette[index]|0x8000;
    }
}
void drawEmptyPokeball(volatile u16* dst,int stride,int x0,int y0){
    constexpr u8 edge[18]={7,5,4,3,2,2,1,1,0,0,1,1,2,2,3,4,5,7};
    constexpr u16 upperGray=0x8000|21|(21<<5)|(21<<10);
    constexpr u16 lowerGray=0x8000|19|(19<<5)|(19<<10);
    for(int y=0;y<18;++y)for(int x=edge[y];x<18-edge[y];++x){
        const int dx=2*x-17,dy=2*y-17;
        const int radius=dx*dx+dy*dy;
        u16 color=y<9?upperGray:lowerGray;
        if(y==8||y==9||radius<=81)color=Shadow;
        if(radius<=25)color=upperGray;
        dst[(y0+y)*stride+x0+x]=color;
    }
}
void copySprite(const u16* src,int x,int y){
    for(int py=0;py<32;++py)for(int px=0;px<32;++px)upper[(y+py)*256+x+px]=src[py*32+px];
}
struct Archive{
    u32 fs[20]={};u32 size=0,image=0,imageSize=0,count=0;bool opened=false;
    bool read(u32 offset,void* out,u32 length){
        return opened&&offset<=size&&length<=size-offset
            &&native<u32(*)(void*,u32,u32)>(0x02070e55)(fs,offset,0)
            &&native<int(*)(void*,void*,u32)>(0x02070e6d)(fs,out,length)==int(length);
    }
    bool open(const char* path){
        native<void(*)(void*)>(0x02070ca9)(fs);
        opened=native<u32(*)(void*,const char*)>(0x02070ecd)(fs,path)!=0;
        if(!opened)return false;
        size=native<u32(*)(void*)>(0x02070ded)(fs);
        u8 h[16];if(!read(0,h,16)||load32(h)!=0x4352414e||load32(h+8)!=size)return false;
        if(!read(16,h,12)||load32(h)!=0x46415442)return false;
        const u32 fat=load32(h+4);count=load16(h+8);
        if(fat<12+count*8||fat>size-16)return false;
        u32 offset=16+fat;
        if(!read(offset,h,8)||load32(h)!=0x464e5442)return false;
        const u32 names=load32(h+4);if(names<8||names>size-offset)return false;
        offset+=names;
        if(!read(offset,h,8)||load32(h)!=0x46494d47||load32(h+4)<8)return false;
        image=offset+8;imageSize=size-image;return true;
    }
    u32 member(u32 id,void* out,u32 capacity){
        u8 h[8];if(!image||id>=count||!read(28+8*id,h,8))return 0;
        const u32 first=load32(h),end=load32(h+4);
        if(first>=end||end>imageSize||end-first>capacity)return 0;
        return read(image+first,out,end-first)?end-first:0;
    }
    ~Archive(){if(opened)native<u32(*)(void*)>(0x02070de1)(fs);}
};
__attribute__((unused)) void loadIcons(void* save){
    partySize=0;for(auto& icon:icons)icon.valid=false;
    if(!save)return;
    void* party=native<void*(*)(void*)>(0x020201b9)(save);
    if(!party)return;
    u32 count=native<u32(*)(void*)>(0x0201fe25)(party);
    partySize=u8(count>6?6:count);
    Archive archive;if(!archive.open("a/0/0/7"))return;
    u8 pal[256];if(archive.member(0,pal,sizeof(pal))<136)return;
    for(u32 i=0;i<partySize;++i){
        void* pokemon=native<void*(*)(void*,u32)>(0x0201ff35)(party,i);
        if(!pokemon)continue;
        auto get=native<u32(*)(void*,u32,void*)>(0x0201cd25);
        const u32 species=get(pokemon,5,nullptr),form=get(pokemon,0x6f,nullptr),gender=get(pokemon,0x6e,nullptr);
        const u32 member=native<u32(*)(u32,u32,u32,u32)>(0x02020fc1)(species,form,gender,0);
        const u32 palette=native<u32(*)(u32,u32,u32,u32)>(0x02021061)(species,form,gender,0);
        u8 data[1072];
        if(archive.member(member,data,sizeof(data))!=sizeof(data)||load32(data)!=0x4e434752
            ||load32(data+16)!=0x43484152||palette>=3||40+(palette+1)*32>sizeof(pal))continue;
        for(u32 j=0;j<1024;++j)icons[i].poses[j]=data[48+j];
        // This added icon's second source pose contains four detached pixels
        // in row zero. The native 32x32 icon area makes them look wrapped.
        if(member==2034)for(int x=13;x<=16;++x){
            const int at=512+(x/8)*32+(x%8)/2;
            icons[i].poses[at]&=u8((x&1)?0x0f:0xf0);
        }
        for(u32 j=0;j<16;++j)icons[i].palette[j]=load16(pal+40+palette*32+j*2)|0x8000;
        icons[i].valid=true;
    }
}
void readSave(void* work){
    void* save=field<void*>(work,0);
    void* info=field<void*>(work,4);
    sex=info?u8(native<u32(*)(void*)>(0x02008bf1)(info)&1):0;
    for(int i=0;i<15;++i){trainer[i]=info?reinterpret_cast<u16*>(info)[i]:0xffff;if(trainer[i]==0xffff){trainer[i]=0;break;}}
    trainer[15]=0;
    void* card=field<void*>(work,8);badgeMask=card?field<u32>(card,4):0;
    void* play=save?native<void*(*)(void*)>(0x02008de9)(save):nullptr;
    timeHours=play?*reinterpret_cast<u16*>(play):0;
    timeMinutes=play?field<u8>(play,2):0;
    location=0xffff;place[0]=0;
    if(save){u8 data[28]={};native<void(*)(void*,void*)>(0x02008fb9)(save,data);location=load16(data);}
    if(location<615&&MapLocationNames[location]<154){
        const u16 name=MapLocationNames[location];
        const u8* src=LocationNameChars+LocationNameOffsets[name];
        int i=0;while(src[i]&&i<39){place[i]=src[i];++i;}place[i]=0;
    }
    loadIcons(save);
}
void drawCardAnimation(){
    const u8* pose=(sex?Player1Pose0:Player0Pose0);
    const u32 animation=(ticks/8)%4;
    if(animation==1)pose=sex?Player1Pose1:Player0Pose1;
    if(animation==3)pose=sex?Player1Pose2:Player0Pose2;
    if(cardCanvas){
        stageSprite(cardCanvas,pose,sex?Player1Palette:Player0Palette);
        for(int i=0;i<6;++i){
            u16* slot=cardCanvas+(i+1)*32*32;
            if(i<partySize&&icons[i].valid)
                stageSprite(slot,icons[i].poses+((ticks/8)&1)*512,icons[i].palette,Black);
            else{
                stageSprite(slot,nullptr,nullptr,Black);
                drawEmptyPokeball(slot,32,7,7);
            }
        }
        if(ticks>1&&lastPage==page)waitVBlankStart();
        copySprite(cardCanvas,42,49);
        for(int i=0;i<6;++i)copySprite(cardCanvas+(i+1)*32*32,28+i*34,PartyTop);
    }else{
        if(ticks>1&&lastPage==page)waitVBlankStart();
        fill(upper,42,49,74,81,Black);drawPlayerGround(upper,256,42,49);
        blit4(upper,pose,sex?Player1Palette:Player0Palette,42,49);
        for(int i=0;i<6;++i){
            const int x=28+i*34;fill(upper,x,PartyTop,x+32,PartyTop+32,Black);
            if(i<partySize&&icons[i].valid)blit4(upper,icons[i].poses+((ticks/8)&1)*512,icons[i].palette,x,PartyTop);
            else drawEmptyPokeball(upper,256,x+7,PartyTop+7);
        }
    }
}
void drawBadges(){
    if(!badgePixels)return;
    for(int badge=0;badge<8;++badge)for(int y=0;y<34;++y)for(int x=0;x<16;++x){
        const int at=y*128+badge*16+x;
        const u8 index=badgePixels[at];
        if(!index)continue;
        u16 color=BadgePalette[index];
        if(!(badgeMask&(1u<<badge))){
            const bool edge=x==0||x==15||y==0||y==33||
                !badgePixels[at-1]||!badgePixels[at+1]||
                !badgePixels[at-128]||!badgePixels[at+128];
            color=edge?CaseRim:Body;
        }
        upper[(140+y)*256+30+badge*25+x]=color;
    }
}
void drawBadgeCase(){
    fill(upper,27,135,229,179,Shadow);
    outline(upper,27,135,229,179,CaseRim);
    fill(upper,28,136,228,137,Body);
    fill(upper,28,177,228,178,Body);
    fill(upper,125,136,126,178,CaseGroove);
    fill(upper,126,136,127,178,Body);
    fill(upper,27,179,229,180,CaseGoldDark);
    fill(upper,27,180,229,181,CaseGold);
    fill(upper,27,181,229,182,CaseGoldDark);
}
void drawNextArrow(){
    for(int y=66;y<=112;++y){
        const int reach=y<=89?y-66:112-y;
        const int tip=239+((reach*9+8)>>4);
        for(int x=239;x<=tip;++x)
            upper[y*256+x]=(x==239||x==tip)?White:Black;
    }
}
void drawCard(){
    grid(upper);fill(upper,21,23,235,184,Black);outline(upper,21,23,235,184,White);
    fill(upper,25,27,231,38,Slate);fill(upper,27,41,229,180,Black);
    fill(upper,31,29,47,35,Grid);fill(upper,50,29,59,35,Grid);
    nativeTrainerText(upper,222-nativeTrainerText(nullptr,0,54,trainer),54,trainer);
    constexpr u8 dividerRuns[]={98,99,102,107,110,218,221,226,229,230};
    for(int run=0;run<10;run+=2)for(int x=dividerRuns[run];x<dividerRuns[run+1];++x)
        upper[71*256+x]=Grid;
    char clock[24];char* p=clock;p=number(p,timeHours);*p++='h';*p++=' ';if(timeMinutes<10)*p++='0';p=number(p,timeMinutes);*p++='m';*p=0;
    const int clockTextX=222-nativeTopText(nullptr,0,75,clock);
    const int clockX=clockTextX-16;
    for(int dy=-6;dy<=6;++dy)for(int dx=-6;dx<=6;++dx){
        const int radius=dx*dx+dy*dy;
        if(radius>=25&&radius<=40)upper[(81+dy)*256+clockX+dx]=White;
    }
    fill(upper,clockX-1,77,clockX+1,82,White);fill(upper,clockX,80,clockX+4,82,White);
    nativeTopText(upper,clockTextX,75,clock);
    fill(upper,31,132,225,133,Grid);
    drawBadgeCase();
    drawBadges();
    drawNextArrow();
    drawCardAnimation();
}
void drawNoSave(){
    grid(upper);fill(upper,30,43,226,132,Black);outline(upper,30,43,226,132,White);
    fill(upper,58,62,98,108,Blue);fill(upper,73,69,83,101,Cyan);fill(upper,63,80,93,90,Cyan);
    nativeTopText(upper,105,80,"NEW GAME");
}
void drawNewGamePage(){
    grid(upper);
    fill(upper,48,76,208,116,Black);
    outline(upper,48,76,208,116,White);
    nativeTopText(upper,105,87,"NEW GAME");
}
void drawLower(){
    if(!hasSave){grid(lower);return;}
    if(page){grid(lower);return;}
    fill(lower,0,0,256,192,0x8000);
    if(!drawMap()){grid(lower);return;}
    for(int y=0;y<8;++y)for(int x=0;x<8;++x)lower[(149+y)*256+10+x]=MapStartNode[y*8+x];
    if(!titleUnderlay)titleUnderlay=static_cast<u16*>(allocate(152*22*sizeof(u16)));
    if(titleUnderlay)for(int y=0;y<22;++y)for(int x=0;x<152;++x)
        titleUnderlay[y*152+x]=lower[(y+2)*256+x];
    prepareMarker();
    nativeMapTitle();
}
void reset(){
    release(markerFrames);markerFrames=nullptr;
    release(badgePixels);badgePixels=nullptr;
    release(markerUnderlay);markerUnderlay=nullptr;
    release(cardCanvas);cardCanvas=nullptr;
    release(titleUnderlay);titleUnderlay=nullptr;
    markerFrame=255;
    initialized=false;noGraphics=false;navLatch=false;zooming=false;zoomFrame=0;lastPage=255;page=0;ticks=0;markerTicker=47;
}
}
extern "C" u32 SaveMenuMain(void* a,void* b,void* c,void* work){
    if(!work)return OriginalSaveMenuMain(a,b,c,work);
    const u32 state=field<u32>(work,0x190);
    if(state!=5&&state!=6){
        if(continueHandoff)coverTransition();
        if(initialized)restoreGraphics();
        reset();
        const u32 result=OriginalSaveMenuMain(a,b,c,work);
        const u32 nextState=field<u32>(work,0x190);
        if(continueHandoff||nextState==2)coverTransition();
        if(continueHandoff&&nextState==2)continueHandoff=false;
        return result;
    }
    if(noGraphics)return OriginalSaveMenuMain(a,b,c,work);
    if(state==6&&!initialized)return OriginalSaveMenuMain(a,b,c,work);
    if(!initialized){
        continueHandoff=false;
        coverTransition();
        if(!captureGraphics()){
            noGraphics=true;*mainBrightness=0;*subBrightness=0;
            return OriginalSaveMenuMain(a,b,c,work);
        }
        hasSave=field<u8>(work,0x170)==0;
        if(hasSave){
            readSave(work);
            cardCanvas=static_cast<u16*>(allocate(7*32*32*sizeof(u16)));
            badgePixels=static_cast<u8*>(allocate(128*34));
            if(badgePixels&&!decodeLz(BadgeLz,sizeof(BadgeLz),128*34,nullptr,nullptr,badgePixels)){
                release(badgePixels);badgePixels=nullptr;
            }
        }
        initialized=true;
    }
    const u32 pressed=native<u32(*)()>(0x0203df29)();
    u32* keyRoot=*reinterpret_cast<u32**>(0x021418c4);
    u8* keyData=keyRoot?reinterpret_cast<u8*>(*keyRoot):nullptr;
    u32* keyPressed=keyData?reinterpret_cast<u32*>(keyData+(field<u8>(keyRoot,0x3d)==0x1e?0x28:0x1c)):nullptr;
    const u32 originalPressed=keyPressed?*keyPressed:0;
    u32 filtered=originalPressed;
    bool skipNative=false;
    if(navLatch){
        if(originalPressed&(0x10|0x20|0x80|0x2))skipNative=true;
        else navLatch=false;
    }
    u8* touch=*reinterpret_cast<u8**>(0x021418cc);
    const bool tapped=touch&&field<u16>(touch,0x60)==1;
    const int tx=tapped?field<u16>(touch,0x5c):0;
    const int ty=tapped?field<u16>(touch,0x5e):0;
    if(!zooming&&hasSave){
        if(page==0&&(pressed&(0x10|0x80))){page=1;field<u8>(work,0x179)=1;navLatch=skipNative=true;}
        else if(page==1&&(pressed&(0x20|0x2))){page=0;field<u8>(work,0x179)=0;navLatch=skipNative=true;}
        if(tapped){
            if(!page&&ty>=168){
                if(tx>=128){page=1;field<u8>(work,0x179)=1;skipNative=true;}
                else{page=0;field<u8>(work,0x179)=0;filtered|=1;}
            }else if(page){
                field<u8>(work,0x179)=1;filtered|=1;
            }
        }
    }else if(!zooming&&tapped){filtered|=1;}
    if(hasSave&&page){
        field<u8>(work,0x179)=1;
        if(originalPressed&(0x10|0x20|0x40|0x80))skipNative=true;
    }
    int zoomStep=-1;
    bool zoomCommit=false;
    if(zooming){
        skipNative=true;
        if(zoomFrame<sizeof(ZoomSteps)){zoomStep=zoomFrame++;}
        else if(zoomFrame<sizeof(ZoomSteps)+2){++zoomFrame;}
        else{zooming=false;filtered=1;skipNative=false;zoomCommit=true;}
    }else if(hasSave&&!page&&!skipNative&&(filtered&1)&&markerFrame!=255){
        const bool titleConflict=markerX+26<184&&markerY+29<48;
        if(!titleConflict||titleUnderlay){
            zooming=true;zoomFrame=0;skipNative=true;
            if(titleConflict){
                waitVBlankStart();
                for(int y=0;y<22;++y)for(int x=0;x<152;++x)
                    lower[(y+2)*256+x]=titleUnderlay[y*152+x];
                drawMarkerFrame(markerPhase(markerTicker));
            }
        }
    }
    if(keyPressed)*keyPressed=filtered;
    u32 result=skipNative?0:OriginalSaveMenuMain(a,b,c,work);
    if(keyPressed)*keyPressed=originalPressed;
    if(hasSave)field<u8>(work,0x179)=page?1:0;
    const u32 nextState=field<u32>(work,0x190);
    if(nextState!=5&&nextState!=6){
        const bool loadingSave=hasSave&&!page&&nextState==3;
        if(loadingSave)coverTransition();
        restoreGraphics();reset();continueHandoff=loadingSave;
        return result;
    }
    if(zoomCommit){
        setup(bottomDisplay);
        if(markerX+26<184&&markerY+29<48)nativeMapTitle();
    }
    ++ticks;markerTicker=markerTicker==47?0:u8(markerTicker+1);
    const bool changedPage=lastPage!=page;
    if(changedPage&&ticks>1)coverTransition();
    if(changedPage||(!page&&hasSave&&ticks%8==0)){
        if(!hasSave)drawNoSave();else if(page)drawNewGamePage();else if(lastPage!=page)drawCard();
        else drawCardAnimation();
        if(changedPage)drawLower();
        lastPage=page;
    }
    if(changedPage&&ticks>1)revealMenu();
    if(hasSave&&!page&&markerFrame!=255){
        const u8 next=markerPhase(markerTicker);
        if(next!=markerFrame){waitVBlankStart();drawMarkerFrame(next);}
    }
    if(zoomStep>=0)zoomLower(u8(zoomStep));
    if(ticks==1){setup(topDisplay);setup(bottomDisplay);revealMenu();}
    return result;
}
