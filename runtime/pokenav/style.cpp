#include "style.h"
#include "../learnset-viewer/info_logic.h"
#include "pokenav_style.generated.h"
namespace pokenav::ui {
namespace {
constexpr u32 Bytes=256*192,MaskBytes=Bytes/4;
struct Frame {alignas(4) u8 pixels[Bytes],mask[MaskBytes];};
struct Glyph {u32 key;u16 count;u8 advance,foreground;u8 positions[256];};
struct Session {Frame frames[2];Glyph glyphs[128];u8 glyphAge[64];u16 palette[256],control[2],brightness[2];void* task;void* smallFont;Frame* base[2];u8 dirty,phase,grid,band,gridTicks,bandTicks;bool enabled,land,baseReady[2],ready,presented;};
static_assert(sizeof(Session)==157284,"Bounded dual-screen surfaces and native glyph cache");
Session* session;
constexpr u16 rgb(u32 r,u32 g,u32 b){return (r>>3)|((g>>3)<<5)|((b>>3)<<10);}
constexpr u16 colors[32]={
    rgb(17,26,34),rgb(17,26,34),rgb(31,44,54),rgb(46,60,72),rgb(39,56,69),
    rgb(37,46,53),rgb(40,49,57),rgb(44,53,61),rgb(42,52,60),
    rgb(43,53,62),rgb(53,70,79),rgb(109,124,136),rgb(135,148,157),rgb(9,15,21),
    rgb(32,44,53),rgb(100,182,212),rgb(119,187,133),rgb(161,211,228),rgb(176,212,173),
    rgb(38,50,59),rgb(86,99,110),rgb(146,160,170),rgb(58,76,86),rgb(20,33,42),
    rgb(23,36,45),rgb(82,103,115),rgb(177,139,209),rgb(52,72,83),0,0,0,0
};
constexpr u16 textColors[16]={0,rgb(160,160,168),rgb(23,33,42),rgb(168,188,196),rgb(216,224,224),rgb(120,136,144),rgb(136,96,160),rgb(248,248,248),rgb(219,229,235),rgb(168,181,190),
    rgb(105,116,124),rgb(211,235,201),rgb(206,166,231),rgb(212,234,246),rgb(203,216,222),rgb(240,246,247)};
void fill(u8* p,u32 n,u8 value){
    const u32 word=u32(value)*0x01010101;
    while(n&&reinterpret_cast<u32>(p)&3){*p++=value;--n;}
    while(n>=4){*reinterpret_cast<u32*>(p)=word;p+=4;n-=4;}
    while(n--)*p++=value;
}
u32 offset(u32 x,u32 y){return ((y>>3)*32+(x>>3))*64+(y&7)*8+(x&7);}
void grid(Frame& frame){
    const u32 shift=session->grid,band=session->band;
    u32 columns[64],masks[64],minor[64],bands[160];
    for(u32 group=0;group<64;++group){u32 color=0,mask=0,low=0;
        for(u32 i=0;i<4;++i){const u32 x=group*4+i;const u8 ink=((x-shift)&31)==0?u8(Major):((x-shift)&7)==0?u8(Minor):0;
            color|=u32(ink)<<(i*8);if(ink)mask|=255u<<(i*8);low|=u32(ink==Major?Major:Minor)<<(i*8);}
        columns[group]=color;masks[group]=mask;minor[group]=low;
    }
    for(u32 p=0;p<160;++p){u32 color=0;for(u32 i=0;i<4;++i){u32 v=p+i;if(v>=160)v-=160;color|=u32(v<64?Band:Grid)<<(i*8);}bands[p]=color;}
    for(u32 y=0;y<192;++y){
        const u8 row=((y-shift)&31)==0?u8(Major):((y-shift)&7)==0?u8(Minor):0;
        const u32 base=(y>>3)*2048+(y&7)*8;u32 phase=352-band-y;while(phase>=160)phase-=160;
        for(u32 group=0;group<64;++group){const u32 at=base+(group>>1)*64+(group&1)*4;const u8 mask=frame.mask[at>>2];
            if(mask){const u32 pattern=row==Major?0x03030303:row?minor[group]:(bands[phase]&~masks[group])|columns[group];
                if(mask==0x55||mask==0xaa)*reinterpret_cast<u32*>(frame.pixels+at)=pattern+(mask==0xaa?0x04040404:0);
                else for(u32 i=0;i<4;++i){const u8 m=u8((mask>>(i*2))&3);if(m)frame.pixels[at+i]=u8((pattern>>(i*8))+(m==2?4:0));}
            }
            phase+=4;if(phase>=160)phase-=160;
        }
    }
}
void upload(void*,void*){
    if(!session||!session->enabled)return;
    // Native initialization and its opening fade can run across many VBlanks.
    // Do not reinterpret the tutor's 4-bit tiles as our 8-bit surfaces while
    // only one screen has finished rendering. Hold both screens dark until
    // the native input state and both complete buffers are ready.
    if(!session->presented&&(!session->ready||session->dirty!=3)){
        *reinterpret_cast<volatile u16*>(0x0400006c)=0x8010;
        *reinterpret_cast<volatile u16*>(0x0400106c)=0x8010;
        return;
    }
    for(u32 screen=0;screen<2;++screen){
        const u32 io=screen?0x04001000:0x04000000;
        // Mode-0 text BG2, 256 colors, char base 0, map at 0xf800. The
        // application owns both banks; 48 KiB characters precede the map.
        *reinterpret_cast<volatile u16*>(io+12)=0x1f82;
        *reinterpret_cast<volatile u16*>(io+24)=0;
        *reinterpret_cast<volatile u16*>(io+26)=0;
        volatile u16* palette=reinterpret_cast<volatile u16*>(screen?0x05000400:0x05000000);
        for(u32 i=0;i<256;++i)palette[i]=session->palette[i];
        if(!(session->dirty&(1<<screen)))continue;
        volatile u32* dest=reinterpret_cast<volatile u32*>(screen?0x06200000:0x06000000);
        const u32* source=reinterpret_cast<const u32*>(session->frames[screen].pixels);
        for(u32 i=0;i<Bytes/4;++i)dest[i]=source[i];
        volatile u16* map=reinterpret_cast<volatile u16*>((screen?0x06200000:0x06000000)+0xf800);
        for(u32 i=0;i<768;++i)map[i]=u16(i);
        session->dirty&=u8(~(1<<screen));
    }
    if(!session->presented){
        session->presented=true;
        *reinterpret_cast<volatile u16*>(0x0400006c)=0;
        *reinterpret_cast<volatile u16*>(0x0400106c)=0;
    }
}
int divide(int value,int divisor){
    const bool negative=(value<0)!=(divisor<0);u32 a=value<0?u32(-value):u32(value),b=divisor<0?u32(-divisor):u32(divisor),q=0;
    if(!b)return 0;
    u32 bit=1;while(b<=(a>>1)){b<<=1;bit<<=1;}
    while(bit){if(a>=b){a-=b;q|=bit;}bit>>=1;b>>=1;}
    return negative?-int(q):int(q);
}
}
bool available(){return session&&session->enabled;}
void present(){if(available())session->ready=true;}
bool create(const u16* iconPalettes){
    // Parent application heap outlives the tutor's heap-79 destruction. Queued
    // source buffers stay retained through the native application End call.
    session=static_cast<Session*>(alloc(1,sizeof(Session)));if(!session)return false;
    *session={};for(u32 i=0;i<32;++i)session->palette[i]=colors[i];
    for(u32 i=0;i<16;++i)session->palette[224+i]=textColors[i];
    for(u32 i=0;i<16;++i){session->palette[32+i]=PokenavFooterColors[i];session->palette[64+i]=PokenavControlColors[i];}
    if(iconPalettes)for(u32 i=0;i<48;++i){const u16 c=iconPalettes[i];session->palette[160+i]=c;
        const u32 gray=(((c&31)*77+((c>>5)&31)*150+((c>>10)&31)*29)>>8)*3/4;
        session->palette[80+i]=u16(gray|(gray<<5)|(gray<<10));
    }
    session->control[0]=*reinterpret_cast<volatile u16*>(0x0400000c);session->control[1]=*reinterpret_cast<volatile u16*>(0x0400100c);
    session->brightness[0]=*reinterpret_cast<volatile u16*>(0x0400006c);session->brightness[1]=*reinterpret_cast<volatile u16*>(0x0400106c);
    session->task=native<void*(*)(void*,void*,u32)>(0x20056fd,0x20056fd)(reinterpret_cast<void*>(upload),nullptr,2);
    if(!session->task){release(session);session=nullptr;return false;}
    *reinterpret_cast<volatile u16*>(0x0400006c)=0x8010;*reinterpret_cast<volatile u16*>(0x0400106c)=0x8010;
    // Native compact font, same archive as the tutor/Summary large font.
    // A missing optional font retains the existing native large-font path.
    session->smallFont=native<void*(*)(u32,u32,u32,u32,u32)>(0x2022d85,0x2022d59)(23,1,0,0,1);
    for(auto& base:session->base)base=static_cast<Frame*>(alloc(1,sizeof(Frame)));
    session->enabled=true;return true;
}
void stop(){
    if(!session||!session->enabled)return;
    session->enabled=false;
    if(session->task)native<void(*)(void*)>(0x203a6d5,0x203a6a9)(session->task);
    session->task=nullptr;
    if(session->smallFont)native<void(*)(void*)>(0x2022dd5,0x2022da9)(session->smallFont);
    session->smallFont=nullptr;
    for(auto& base:session->base){release(base);base=nullptr;}
    *reinterpret_cast<volatile u16*>(0x0400000c)=session->control[0];*reinterpret_cast<volatile u16*>(0x0400100c)=session->control[1];
    if(!session->presented){*reinterpret_cast<volatile u16*>(0x0400006c)=session->brightness[0];*reinterpret_cast<volatile u16*>(0x0400106c)=session->brightness[1];}
}
void destroy(){stop();release(session);session=nullptr;}
void tick(){tick(true);}
void tick(bool animate){
    if(!available())return;
    session->palette[Cursor]=PokenavPulse[session->phase++&63];
    if(session->gridTicks<8)++session->gridTicks;
    if(animate&&session->gridTicks==8){session->gridTicks=0;session->grid=u8((session->grid+1)&31);
        if(++session->bandTicks==5){session->bandTicks=0;if(++session->band==160)session->band=0;}
        for(u32 i=0;i<2;++i){session->dirty&=u8(~(1<<i));grid(session->frames[i]);session->dirty|=1<<i;}
    }
}
void accent(bool land){if(session)session->land=land;}
Surface begin(void* work,void* bitmap,u8 screen){
    if(!available())return {};
    session->dirty&=u8(~(1<<screen));auto& f=session->frames[screen];
    fill(f.pixels,Bytes,Grid);fill(f.mask,MaskBytes,0x55);
    auto* scratch=native<u8*(*)(void*)>(0x2046f21,0x2046ef5)(bitmap);fill(scratch,Bytes/2,0);
    return {f.pixels,f.mask,scratch,work,bitmap,screen};
}
Surface edit(void* work,u8 screen){
    if(!available())return {};
    session->dirty&=u8(~(1<<screen));auto& f=session->frames[screen];return {f.pixels,f.mask,nullptr,work,nullptr,screen};
}
void commit(Surface& s){if(s.pixels)session->dirty|=1<<s.screen;}
bool restoreBase(Surface& s,bool land){
    if(!session->base[land]||!session->baseReady[land])return false;
    auto* dest=reinterpret_cast<u32*>(&session->frames[s.screen]);const auto* source=reinterpret_cast<const u32*>(session->base[land]);
    for(u32 i=0;i<sizeof(Frame)/4;++i)dest[i]=source[i];
    return true;
}
bool needsBase(bool land){return session->base[land]&&!session->baseReady[land];}
void saveBase(Surface& s,bool land){
    if(!session->base[land])return;
    auto* dest=reinterpret_cast<u32*>(session->base[land]);const auto* source=reinterpret_cast<const u32*>(&session->frames[s.screen]);
    for(u32 i=0;i<sizeof(Frame)/4;++i)dest[i]=source[i];
    session->baseReady[land]=true;
}
void pixel(Surface& s,int x,int y,u8 color,u8 mask){
    if(!s.pixels||x<0||y<0||x>=256||y>=192)return;
    const u32 at=offset(u32(x),u32(y)),shift=(at&3)*2;s.pixels[at]=color;
    s.mask[at>>2]=u8((s.mask[at>>2]&~(3<<shift))|(mask<<shift));
}
void rect(Surface& s,int x,int y,int w,int h,u8 color,u8 mask){
    if(!s.pixels)return;
    int right=x+w,bottom=y+h;if(x<0)x=0;if(y<0)y=0;if(right>256)right=256;if(bottom>192)bottom=192;
    const u32 word=u32(color)*0x01010101;
    for(int j=y;j<bottom;++j)for(int i=x;i<right;){
        const u32 at=offset(u32(i),u32(j));
        if(!(i&3)&&i+4<=right){*reinterpret_cast<u32*>(s.pixels+at)=word;s.mask[at>>2]=u8(mask*0x55);i+=4;}
        else{pixel(s,i,j,color,mask);++i;}
    }
}
void polygon(Surface& s,const Point* points,u32 count,u8 color,u8 mask){
    if(!count)return;
    int first=192,last=-1;
    for(u32 i=0;i<count;++i){if(points[i].y<first)first=points[i].y;if(points[i].y>last)last=points[i].y;}
    if(first<0)first=0;
    if(last>192)last=192;
    for(int y=first;y<last;++y){int left=256,right=-1;
        for(u32 i=0;i<count;++i){const auto a=points[i],b=points[i+1==count?0:i+1];
            if((y>=a.y&&y<b.y)||(y>=b.y&&y<a.y)){const int x=a.x+divide((y-a.y)*(b.x-a.x),b.y-a.y);if(x<left)left=x;if(x>right)right=x;}}
        if(right>=left)rect(s,left,y,right-left,1,color,mask);
    }
}
void outline(Surface& s,int x,int y,int w,int h,u8 color){rect(s,x,y,w,1,color);rect(s,x,y+h-1,w,1,color);rect(s,x,y+1,1,h-2,color);rect(s,x+w-1,y+1,1,h-2,color);}
void restoreOutline(Surface& s,int x,int y,int w,int h){
    auto paint=[&](int px,int py){const u32 gx=u32(px)-session->grid,gy=u32(py)-session->grid;u32 phase=u32(px+352-py)-session->band;while(phase>=160)phase-=160;
        const u8 color=(gx&31)==0||(gy&31)==0?u8(Major):(gx&7)==0||(gy&7)==0?u8(Minor):phase<64?u8(Band):u8(Grid);
        pixel(s,px,py,u8(color+4),2);
    };
    for(int i=0;i<w;++i){paint(x+i,y);paint(x+i,y+h-1);}for(int i=1;i<h-1;++i){paint(x,y+i);paint(x+w-1,y+i);}
}
void plate(Surface& s,int x,int y,int w,int h,u8 color){
    const int r=x+w-1,b=y+h-1;
    Point points[]={{x,y+5},{x+5,y},{r-5,y},{r,y+5},{r,b-4},{r-4,b},{x+4,b},{x,b-4}};
    Point shadow[8];for(u32 i=0;i<8;++i)shadow[i]={points[i].x+2,points[i].y+2};polygon(s,shadow,8,Shadow);polygon(s,points,8,Bevel);
    const Point inner[]={{x+1,y+5},{x+6,y+1},{r-6,y+1},{r-1,y+5},{r-1,b-4},{r-5,b-1},{x+5,b-1},{x+1,b-4}};
    polygon(s,inner,8,color);rect(s,x+6,y+1,w-13,1,Light);rect(s,x+5,b-1,w-10,1,Edge);
}
void flap(Surface& s,int x,int y,int w,const char* title,u8 color){
    const Point rim[]={{x,y+6},{x+5,y+1},{x+w-9,y+1},{x+w-1,y+9},{x+w-1,y+15},{x,y+15}};
    const Point face[]={{x+1,y+6},{x+6,y+2},{x+w-10,y+2},{x+w-2,y+9},{x+w-2,y+15},{x+1,y+15}};
    polygon(s,rim,6,Bevel);polygon(s,face,6,Header);rect(s,x+6,y+2,w-17,1,color);smallLabel(s,title,x+7,y+5);
}
Glyph& glyph(Surface& s,u16 code,bool small=false){
    small=small&&session->smallFont;const u32 key=u32(code)|(small?0x10000:0);
    const u32 bucket=code&63;auto* choices=session->glyphs+bucket*2;
    if(choices[0].key==key)return choices[0];
    if(choices[1].key==key)return choices[1];
    auto& g=choices[!choices[0].key?0:!choices[1].key?1:session->glyphAge[bucket]++&1];
    auto* scratch=native<u8*(*)(void*)>(0x2046f21,0x2046ef5)(s.bitmap);
    // The pinned native font cell is 12x15. Keep sparse coordinates in a
    // 16x16 cell, including bearings and shadow, independent of text color.
    for(u32 y=0;y<16;++y)for(u32 x=0;x<16;x+=8)*reinterpret_cast<u32*>(scratch+offset(x,y)/2)=0;
    const u16 value[]={code,End};void* buffer=at<void*>(s.work,0x4c);stringSet(buffer,value);
    void* font=small?session->smallFont:at<void*>(s.work,0x60);
    g.advance=u8(native<u32(*)(void*,void*,u32)>(0x20228b5,0x2022889)(buffer,font,0));
    native<void(*)(void*,int,int,void*,void*,u32)>(0x2021d55,0x2021d29)(s.bitmap,0,0,buffer,font,(15<<10)|(2<<5));
    g.count=0;
    for(u32 pass=0;pass<2;++pass){for(u32 y=0;y<16;++y)for(u32 x=0;x<16;++x){const u32 at=offset(x,y);const u8 ink=u8((scratch[at/2]>>((at&1)*4))&15);
            if(pass?(ink&&ink!=15):ink==15)g.positions[g.count++]=u8(y*16+x);
        }if(!pass)g.foreground=u8(g.count);
    }
    g.key=key;return g;
}
bool nativeText(const u16* value){for(u32 i=0;value[i]&&value[i]!=End;++i)if(value[i]>=0xff00)return true;return false;}
u32 measure(Surface& s,const u16* value){
    if(nativeText(value)){stringSet(at<void*>(s.work,0x4c),value);return native<u32(*)(void*,void*,u32)>(0x20228b5,0x2022889)(at<void*>(s.work,0x4c),at<void*>(s.work,0x60),0);}
    u32 width=0;for(u32 i=0;value[i]&&value[i]!=End;++i)width+=glyph(s,value[i]).advance;return width;
}
u32 measureFont(void* work,void* bitmap,const u16* value){Surface s={nullptr,nullptr,nullptr,work,bitmap,0};return measure(s,value);}
void fit(Surface& s,u16* value,u32 width){u32 n=0;while(value[n]&&value[n]!=End)++n;if(measure(s,value)<=width)return;n=n>3?n-3:0;do{value[n]='.';value[n+1]='.';value[n+2]='.';value[n+3]=End;if(measure(s,value)<=width||!n)return;--n;}while(true);}
void text(Surface& s,const u16* value,int x,int y,u8 color){
    if(!s.pixels)return;
    const u8 shadow=color==SummaryWhite?SummaryShadow:color==BodyText?BodyShadow:color==HiddenText&&s.screen==0?HiddenShadow:TextShadow;
    if(nativeText(value)){
        auto* scratch=native<u8*(*)(void*)>(0x2046f21,0x2046ef5)(s.bitmap);fill(scratch,Bytes/2,0);stringSet(at<void*>(s.work,0x4c),value);
        native<void(*)(void*,int,int,void*,void*,u32)>(0x2021d55,0x2021d29)(s.bitmap,x,y,at<void*>(s.work,0x4c),at<void*>(s.work,0x60),((color&15)<<10)|((shadow&15)<<5));
        for(u32 i=0;i<Bytes;++i){const u8 ink=u8((scratch[i/2]>>((i&1)*4))&15);if(ink){s.pixels[i]=u8(224+ink);s.mask[i>>2]&=u8(~(3<<((i&3)*2)));}}
        return;
    }
    for(u32 c=0;value[c]&&value[c]!=End;++c){const auto& g=glyph(s,value[c]);
        for(u32 i=0;i<g.count;++i){const u8 p=g.positions[i];pixel(s,x+(p&15),y+(p>>4),i<g.foreground?color:shadow);}
        x+=g.advance;
    }
}
void label(Surface& s,const char* value,int x,int y,u8 color){u16 buffer[96];asciiText(buffer,96,value);text(s,buffer,x,y,color);}
void smallText(Surface& s,const u16* value,int x,int y,u8 color){
    if(!s.pixels)return;
    if(nativeText(value)){text(s,value,x,y,color);return;}
    for(u32 c=0;value[c]&&value[c]!=End;++c){const auto& g=glyph(s,value[c],true);
        for(u32 i=0;i<g.count;++i){const u8 p=g.positions[i];pixel(s,x+(p&15),y+(p>>4),i<g.foreground?color:u8(TextShadow));}
        x+=g.advance;
    }
}
void smallLabel(Surface& s,const char* value,int x,int y,u8 color){u16 buffer[96];asciiText(buffer,96,value);smallText(s,buffer,x,y,color);}
void icon(Surface& s,const u8* tiles,u8 palette,int x,int y,bool muted){
    if(!tiles||palette>=3)return;
    const u32 base=(muted?80:160)+palette*16;const bool aligned=!(x&3)&&x>=0&&x+32<=256&&y>=0&&y+32<=192;
    for(u32 iy=0;iy<32;++iy)for(u32 ix=0;ix<32;ix+=4){const u32 at=((iy>>3)*4+(ix>>3))*32+(iy&7)*4+((ix&7)>>1);const u32 inks=tiles[at]|u32(tiles[at+1])<<8;if(!inks)continue;
        if(aligned&&(inks&15)&&(inks&240)&&(inks&3840)&&(inks&61440)){
            const u32 dest=offset(u32(x)+ix,u32(y)+iy);*reinterpret_cast<u32*>(s.pixels+dest)=(base+(inks&15))|((base+((inks>>4)&15))<<8)|((base+((inks>>8)&15))<<16)|((base+(inks>>12))<<24);s.mask[dest>>2]=0;
        }else for(u32 i=0;i<4;++i){const u8 ink=u8((inks>>(i*4))&15);if(ink)pixel(s,x+int(ix+i),y+int(iy),u8(base+ink));}
    }
}
void footer(Surface& s){
    for(u32 y=0;y<16;++y)for(u32 x=0;x<256;++x){const u32 at=(y>>3)*32+(y&7)*4+((x&7)>>1);const u8 ink=u8((PokenavFooterStrip[at]>>((x&1)*4))&15);pixel(s,int(x),176+int(y),u8(32+ink));}
    for(u32 button=0;button<2;++button)for(u32 y=0;y<32;++y)for(u32 x=0;x<32;++x){const u32 at=button*512+((y>>3)*4+(x>>3))*32+(y&7)*4+((x&7)>>1);const u8 ink=u8((PokenavFooterIcons[at]>>((x&1)*4))&15);if(ink)pixel(s,195+int(button)*32+int(x),173+int(y),u8(64+ink));}
}
void finish(Surface& s){
    if(!s.pixels)return;
    grid(session->frames[s.screen]);session->dirty|=1<<s.screen;
}
}
