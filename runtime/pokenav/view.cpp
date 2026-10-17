#include "view.h"
#include "../learnset-viewer/info.h"
#include "../learnset-viewer/info_logic.h"
#include "style.h"
namespace {
pokenav::Launch* launch;
pokenav::State navigation;
Request request;
alignas(4) u8 shellPokemon[220];
struct Icons {u8 pixels[56][512],bank[56],slots[7][12];bool valid[56];};
Icons* icons;
bool held,revealed,previewPending;u32 windowIndex;
u16 iconPalettes[48];bool palettesReady;
u16 location[64];
void* window(void* work){return at<void*>(work,8);}
void* bitmap(void* work){return native<void*(*)(void*)>(0x2048521,0x20484f5)(window(work));}
void text(void* work,const u16* value,int x,int y,u32 ink=0x3c40){
    void* buffer=at<void*>(work,0x4c);stringSet(buffer,value);
    native<void(*)(void*,int,int,void*,void*,u32)>(0x2021d55,0x2021d29)(bitmap(work),x,y,buffer,at<void*>(work,0x60),ink);
}
void label(void* work,const char* value,int x,int y,u32 ink=0x3c40){u16 str[64];asciiText(str,64,value);text(work,str,x,y,ink);}
void flush(void* work){
    void* win=window(work);native<void(*)(void*)>(0x2048271,0x2048245)(win);native<void(*)(void*)>(0x2048299,0x204826d)(win);
    native<void(*)(u32)>(0x2045ba9,0x2045b7d)(6);
}
void reloadIcons(){
    if(!icons)return;
    *icons={};ViewIdentity keys[56];u32 count=0;
    for(u32 method=0;method<7;++method){const auto& t=navigation.tables[method];
        for(u32 i=0;i<t.count;++i){const auto& e=t.entries[i];u32 slot=0;
            while(slot<count&&(keys[slot].species!=e.species||keys[slot].form!=e.form))++slot;
            if(slot==count)keys[count++]={e.species,e.form};
            icons->slots[method][i]=u8(slot);
        }
    }
    infoIcons(keys,count,icons->pixels[0],icons->bank,icons->valid);
}
void top(void* work){
    const auto* e=navigation.entry();
    if(!e){request.view.identity={};infoEmpty(work);return;}
    InfoContext context={{e->species,e->form},e->chance,navigation.section};request.view.identity=context.identity;
    infoReload(work,&request,&context);
}
constexpr int WaterTop=17,WaterBottom=74,LandTop=78,LandBottom=174;
const char* names[]={"Grass","Grass Doubles","Grass Special","Surf","Surf Special","Rod","Rod Special"};
struct Tab {int x,width;u8 method;};
constexpr Tab waterTabs[]={{5,42,3},{49,81,4},{132,37,5},{171,80,6}},landTabs[]={{5,51,0},{58,94,1},{154,97,2}};
int iconX(u32 section,u32 i){return section?12+pokenav::columnOf(u8(i),6)*40:24+int(i)*44;}
int iconY(u32 section,u32 i){return section?104+(i>=6?35:0):40;}
void body(pokenav::ui::Surface& s,int top,int bottom){
    using namespace pokenav::ui;
    const int y=top+17;
    const Point shadow[]={{6,y+2},{253,y+2},{253,bottom-2},{249,bottom+2},{10,bottom+2},{6,bottom-2}};
    const Point rim[]={{4,y},{251,y},{251,bottom-4},{247,bottom},{8,bottom},{4,bottom-4}};
    const Point inside[]={{5,y+1},{250,y+1},{250,bottom-4},{246,bottom-1},{9,bottom-1},{5,bottom-4}};
    polygon(s,shadow,6,Shadow);polygon(s,rim,6,Bevel);polygon(s,inside,6,Body,2);
    rect(s,6,y+1,243,1,Light);rect(s,7,bottom-2,239,1,Edge);
}
void tab(pokenav::ui::Surface& s,const Tab& t,u32 section,int top,int underline,bool active){
    using namespace pokenav::ui;
    const bool available=navigation.tables[t.method].count,focused=navigation.section==section&&navigation.header&&active;
    const int x=t.x,r=x+t.width-1,y=top+(active?0:3),base=underline-1;
    const Point rim[]={{x,y+6},{x+5,y+1},{r-7,y+1},{r,y+8},{r,base},{x,base}};
    const Point face[]={{x+1,y+6},{x+6,y+2},{r-8,y+2},{r-1,y+8},{r-1,base},{x+1,base}};
    polygon(s,rim,6,focused?Cursor:active?ActiveEdge:InactiveEdge);polygon(s,face,6,active?Header:Inactive);
    if(active){rect(s,x+6,y+2,t.width-15,1,section?Grass:Water);const Point shine[]={{x+2,y+8},{x+9,y+3},{x+19,y+3},{x+34,base},{x+2,base}};polygon(s,shine,5,Diagonal);}
    u16 value[32];asciiText(value,32,names[t.method]);const int width=int(measure(s,value));
    pokenav::ui::text(s,value,x+(t.width-width)/2,y+2,!available?DisabledText:active?(section?GrassText:WaterText):InactiveText);
    if(focused)rect(s,x+1,base,t.width-2,1,Cursor);
}
void clearSelector(pokenav::ui::Surface& s,const pokenav::State& old,u32 section){
    if(old.header||old.section!=section)return;
    using namespace pokenav::ui;
    const u32 i=old.table().selected;const int x=iconX(section,i)-1,y=iconY(section,i)-1;
    restoreOutline(s,x,y,34,34);
}
void draw(void* work,const pokenav::State* before=nullptr){
    using namespace pokenav::ui;
    if(!available()){
        auto* data=native<u8*(*)(void*)>(0x2046f21,0x2046ef5)(bitmap(work));if(!data)return;
        auto* pal=reinterpret_cast<volatile u16*>(0x05000400);pal[225]=0x18c6;pal[239]=0x7fff;
        infoRect(data,0,0,256,192,1);label(work,"Pokenav unavailable",8,8);label(work,"B: Back",8,176);flush(work);return;
    }
    auto s=before?edit(work,1):begin(work,bitmap(work),1);s.bitmap=bitmap(work);bool rebuilt=!before;
    for(u32 section=0;section<2;++section){
        const int y=section?LandTop:WaterTop,bottom=section?LandBottom:WaterBottom,underline=y+19;
        const u32 method=section?navigation.land:navigation.water;const auto& t=navigation.tables[method];
        const bool header=navigation.header&&navigation.section==section;
        if(before&&method==(section?before->land:before->water)&&header==(before->header&&before->section==section)){
            clearSelector(s,*before,section);
            if(navigation.section==section&&!navigation.header){const int x=iconX(section,t.selected),iy=iconY(section,t.selected);outline(s,x-1,iy-1,34,34,Cursor);}
            continue;
        }
        if(before)rect(s,0,y,256,bottom+2-y,Grid,1);
        rebuilt=true;
        body(s,y,bottom);
        const Tab* tabs=section?landTabs:waterTabs;const u32 count=section?3:4;
        for(u32 i=0;i<count;++i)if(tabs[i].method!=method)tab(s,tabs[i],section,y,underline,false);
        for(u32 i=0;i<count;++i)if(tabs[i].method==method)tab(s,tabs[i],section,y,underline,true);
        rect(s,7,underline,239,1,section?Grass:Water);rect(s,7,underline+1,239,1,Dark);
        if(!t.count)pokenav::ui::label(s,"No encounters",72,iconY(section,0)+7,MutedText);
        for(u32 i=0;i<t.count;++i){const int x=iconX(section,i),iy=iconY(section,i);const u32 slot=icons?icons->slots[method][i]:0;
            if(icons&&icons->valid[slot])icon(s,icons->pixels[slot],icons->bank[slot],x,iy,t.entries[i].dupe);
            else pokenav::ui::label(s,"?",x+12,iy+8);
            if(section==navigation.section&&!navigation.header&&i==t.selected)outline(s,x-1,iy-1,34,34,Cursor);
        }
    }
    if(!before){rect(s,0,0,256,14,Edge);rect(s,0,14,256,1,Light);rect(s,0,15,256,1,Shadow);
        u16 name[64];copyText(name,64,location);fit(s,name,240);pokenav::ui::text(s,name,7,0,MutedText);footer(s);}
    if(rebuilt)finish(s);else commit(s);
}
}
bool pokenavActive(){return launch!=nullptr;}
bool pokenavBegin(void* data,Request** output){
    auto* candidate=static_cast<pokenav::Launch*>(data);
    if(!pokenav::validLaunch(candidate))return false;
    const bool filtered=candidate->version==pokenav::Abi&&(candidate->reserved&1);
    launch=candidate;launch->started=1;launch->finished=0;navigation=pokenav::decode(launch->tables,launch->valid!=0,filtered?launch->dupes:nullptr,(launch->reserved&2)!=0);held=true;revealed=previewPending=false;windowIndex=0;icons=nullptr;palettesReady=false;
    for(u32 i=0;i<sizeof(shellPokemon);++i)shellPokemon[i]=0;
    // The native tutor preloads a hidden species icon before our renderer runs.
    // Supply a private, already-decrypted PK5 shell; never borrow a party slot.
    shellPokemon[4]=3;shellPokemon[6]=1;shellPokemon[8]=1;
    request={};request.tutor.pokemon=shellPokemon;request.magic=RequestMagic;request.version=RequestVersion;request.size=sizeof(Request);request.tutor.mode=1;request.tutor.moves=request.ids;request.ids[0]=1;request.ids[1]=End;
    request.list.status=Status::Empty;request.nextSlot=0xff;*output=&request;return true;
}
void pokenavInit(void* work){
    // Keep the tutor shell's resource ownership, suppress its interactive actors.
    for(u32 offset=0x104;offset<=0x138;offset+=4)if(at<void*>(work,offset))native<void(*)(void*,u32)>(0x204c151,0x204c125)(at<void*>(work,offset),0);
    for(u32 frame=4;frame<8;++frame)if(frame!=6)native<void(*)(u32,u32)>(0x2044cc5,0x2044c99)(frame,0);
    icons=static_cast<Icons*>(alloc(1,sizeof(Icons)));reloadIcons();
    palettesReady=infoIconPalettes(iconPalettes);pokenav::ui::create(palettesReady?iconPalettes:nullptr);
    infoName(109,launch->placeName,location,64);top(work);draw(work);
}
void pokenavFrame(void* work){
    if(!revealed){
        // The tutor creates the shared connection actor after FixedText.
        // Its native release clears the owner pointer for normal cleanup;
        // the field recreates its own actor when C-Gear resumes.
        native<void(*)()>(0x203e809,0x203e7dd)();
        draw(work);pokenav::ui::present();revealed=true;
    }
    u32 x=0,y=0;const bool touched=native<u32(*)(u32*,u32*)>(0x203dab1,0x203da85)(&x,&y)!=0;
    const bool busy=previewPending||native<u32(*)()>(0x203df29,0x203defd)()!=0||(touched&&!held);
    pokenav::ui::tick(!busy);
}
bool pokenavInput(void* work){
    const u32 keys=native<u32(*)()>(0x203df29,0x203defd)();if(keys&2)return true;
    const auto before=navigation;bool changed=false,methods=false;
    if((keys&0x300)==0x100)changed=navigation.switchMethod(true);
    else if((keys&0x300)==0x200)changed=navigation.switchMethod(false);
    else if(keys&0x10)changed=navigation.horizontal(true);else if(keys&0x20)changed=navigation.horizontal(false);
    else if(keys&0x40)changed=navigation.vertical(false);else if(keys&0x80)changed=navigation.vertical(true);
    u32 x=0,y=0;const bool down=native<u32(*)(u32*,u32*)>(0x203dab1,0x203da85)(&x,&y)!=0;
    if(down&&!held){
        if(y>=176&&x>=192){held=down;return true;}
        for(u8 section=0;section<2;++section){
            const int header=section?LandTop:WaterTop;
            if(int(y)>=header&&int(y)<header+21){
                const Tab* tabs=section?landTabs:waterTabs;
                bool populated=false;for(u32 i=0;i<(section?3u:4u);++i)populated|=navigation.tables[tabs[i].method].count!=0;
                for(u32 i=0;i<(section?3u:4u);++i)if(int(x)>=tabs[i].x&&int(x)<tabs[i].x+tabs[i].width&&(navigation.tables[tabs[i].method].count||(!populated&&tabs[i].method==(section?navigation.land:navigation.water)))){
                    navigation.section=section;navigation.header=true;(section?navigation.land:navigation.water)=tabs[i].method;changed=true;
                }
            }else{const auto& t=navigation.tables[section?navigation.land:navigation.water];
                for(u8 i=0;i<t.count;++i){const int ix=iconX(section,i),iy=iconY(section,i);if(int(x)>=ix&&int(x)<ix+32&&int(y)>=iy&&int(y)<iy+32){navigation.select(section,i);changed=true;}}
            }
        }
    }
    held=down;methods=before.water!=navigation.water||before.land!=navigation.land;
    changed=changed&&(methods||before.section!=navigation.section||before.header!=navigation.header||before.table().selected!=navigation.table().selected);
    if(changed){draw(work,&before);previewPending=true;native<void(*)(u32)>(0x2006255,0x2006255)(1356);}
    else{
        // Present input feedback before building the preview. Consecutive
        // inputs coalesce to the latest encounter; B never waits for a load.
        if(previewPending){top(work);previewPending=false;}
        if(navigation.entry())infoInput(work);
    }
    return false;
}
void pokenavStop(){pokenav::ui::stop();release(icons);icons=nullptr;}
void pokenavEnd(){pokenav::ui::destroy();release(icons);icons=nullptr;if(launch){launch->finished=1;launch->started=0;}launch=nullptr;}
void* pokenavWindow(u32 frame,u32 x,u32 y,u32 width,u32 height,u32 palette,u32 direction){
    const u32 index=windowIndex++;
    if(frame==2&&width>1){if(y==0){x=y=0;width=32;height=24;palette=14;}else{x=0;y=24;width=height=1;}}
    if(frame==6&&index==1){x=y=0;width=32;height=24;palette=14;direction=0;}
    // Drawing hooks bypass these tutor controls. Retain handles for native
    // cleanup without exceeding the lower BG's 1,024-character tile pool.
    else if(frame==6){x=0;y=24;width=height=1;}
    void* result=native<void*(*)(u32,u32,u32,u32,u32,u32,u32)>(0x20480ed,0x20480c1)(frame,x,y,width,height,palette,direction);
    return result;
}
