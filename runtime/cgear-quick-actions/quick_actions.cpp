#include "runtime.h"
#include "../pokenav/logic.h"
#include "../nuzlocke-encounters/runtime.h"
#include "pc.generated.h"
#include "dial.generated.h"

namespace {
struct ButtonConfig {u16 id;u8 action,flagMode;u16 item,alternate,flag;u8 x,y,check,pad[3];};
static_assert(sizeof(ButtonConfig)==16);
struct Session {
    u32 magic;Subscreen* sub;void* unit;void* actors[8];void* task;void* graphics[8];
    u32 chars[8],palette,animation;Point positions[8];
    volatile u8 desired[8],uploaded[8];u8 available[8],visible;
    u8 pending,pressed,drag,held,active,attempted;u32 frame;u16 colours[128];u8 rings[8][4];void* patterns;void* uploadBuffer;
    u16 uploadColours[128];u8 dim,shown[8];u8 count,resetHeld,error;u16 resetFrames;ButtonConfig buttons[8];
    u16 skinIds[64],skinMembers[64];u32 skinHashes[64];
    u16 currentSkin,wantedSkin,defaultSkin;u8 skinCount,skinCaptured,skinRequest,skinUpload;
    void* skinOriginal;void* skinBuffer;u8 hideCommunication,saveControl,networkMoved,skinFeedback;
    u8 muteControl,muteState;
    u8 dialControl,dialCaptured,markerUploaded,skinSound,preparedSound,appliedSound;
    u16 dialAngle; s16 dialAccum,markerX,markerY;u16 preparedSkin,dialTarget;
    void* marker;u32 markerChars;
} session;
static_assert(__builtin_offsetof(Session,hideCommunication)==1400);
static_assert(__builtin_offsetof(Session,skinFeedback)==1403);
// Archive state is also read on the no-C-Gear initialization path: encounter
// hooks must not depend on whether the touch-screen sprites are visible.
bool enabled,repelPresent,pokenavEnabled;
MapRequest* ownedMap;
void* radarWork;

u32 clamp(u32 n,u32 lo,u32 hi) { return n<lo?lo:n>hi?hi:n; }
void clear(void* p,u32 n) { for(u32 i=0;i<n;i++) at<u8>(p,i)=0; }
void* game(Subscreen* s) { return s?at<void*>(s->field,8):nullptr; }
void* system(Subscreen* s) { return s?at<void*>(s->field,4):nullptr; }
void* save(void* g) { return api<void*(*)(void*)>(0x2017934)(g); }
u16* options(void* g) { return api<u16*(*)(void*)>(0x2008ddc)(save(g)); }
void* cgearSave(void* g) { return api<void*(*)(void*)>(0x2009918)(save(g)); }
void* party(void* g) { return api<void*(*)(void*)>(0x201735c)(g); }
u32 count(void* g) { return api<u32(*)(void*)>(0x201fe24)(party(g)); }
bool repel(void* g) { return enabled && repelPresent && (*options(g)&0x1000); }
bool cycling(void* g) {
    return api<u32(*)(void*)>(0x20175a4)(api<void*(*)(void*)>(0x20171f4)(g))==1;
}
bool item(void* g,u32 id,u16 heap) {
    return api<u32(*)(void*,u32,u32,u32)>(0x2008474)(api<void*(*)(void*)>(0x2017354)(g),id,1,heap);
}
bool show(u32 i,Subscreen* s) {
    void* g=game(s);const auto& b=session.buttons[i];
    if(b.item && !item(g,b.item,s->heap) && (!b.alternate || !item(g,b.alternate,s->heap))) return false;
    if(b.flagMode) {
        bool set=api<u32(*)(void*,u16)>(0x20191d8)(api<void*(*)(void*)>(0x2017394)(g),b.flag);
        if(set != (b.flagMode==1)) return false;
    }
    return true;
}
void* radarEncounter(Subscreen* s) {
    void* enc=ov<void*(*)(void*)>(0x2180564)(s->field);
    if(!enc || at<void*>(enc,0)!=s->field || !at<void*>(enc,12) || !at<void*>(enc,16)) return nullptr;
    if(!ov<u32(*)(void*,u32)>(0x21a16e8)(enc,2)) return nullptr;
    if(ov<u32(*)(void*)>(0x2180578)(s->field)!=0) return nullptr;
    if(!api<u32(*)(void*,u32)>(0x200c97c)(api<void*(*)(void*)>(0x2017974)(game(s)),0)) return nullptr;
    void* state=api<void*(*)(void*)>(0x20174a4)(game(s));
    // Never replace an existing phenomenon or its native task.
    if(!state || (at<u8>(state,0x25)&15)) return nullptr;
    return enc;
}
void pokeradar(Subscreen* s) {
    void* enc=radarEncounter(s);if(!enc) return;
    void* state=api<void*(*)(void*)>(0x20174a4)(game(s));
    radarWork=at<void*>(enc,16);
    // Retail searches a random half of the nearby block and can reject an
    // occupied candidate. Retry a bounded number of times in this press.
    // The native routine retains badge, grid, zone and terrain restrictions.
    for(u32 tries=0;tries<32 && !(at<u8>(state,0x25)&15);tries++)
        ov<void(*)(void*)>(0x21a20ac)(enc);
    radarWork=nullptr;
}
bool canUse(u32 i,Subscreen* s) {
    const auto& b=session.buttons[i];
    if(!show(i,s)) return false;
    if(b.check!=255 && ov<u32(*)(u32,void*,void*)>(0x215eff4)(b.check,system(s),s->field)!=0) return false;
    if(((b.action>=12 && b.action<=14) || b.action==16) && !count(game(s))) return false;
    if(b.action==17 && !radarEncounter(s)) return false;
    if(b.action==18 && !pokenavEnabled)return false;
    return true;
}
int flyMember(void* field,void* g) {
    FlyCheck check;
    ov<void(*)(void*,FlyCheck*)>(0x2159270)(field,&check);
    if(ov<u32(*)(FlyCheck*)>(0x21596c4)(&check)) return -1;
    void* p=party(g);u32 n=count(g);
    for(u32 i=0;i<n;i++) {
        void* mon=api<void*(*)(void*,u32)>(0x201ff34)(p,i);
        auto get=api<u32(*)(void*,u32)>(0x201cd24);
        if(get(mon,0x4c)) continue;
        for(u32 m=0x36;m<0x3a;m++) if(get(mon,m)==19) return static_cast<int>(i);
    }
    return -1;
}
void* archive(u16 heap,const char* path="rom:/quick-actions/ui.narc") {
    // Native ARCHANDLE contains FSFile (72 bytes), archive offset and counts.
    void* h=api<void*(*)(u32,u32,u32,const char*,u32)>(0x203a228)(heap,80,1,"quick-actions",0);
    if(!h) return nullptr;
    api<void(*)(void*)>(0x2070ca8)(h);
    if(!api<u32(*)(void*,const char*)>(0x2070ecc)(h,path)) {
        api<void(*)(void*)>(0x203a278)(h);return nullptr;
    }
    api<void(*)(void*)>(0x204aac8)(h);return h;
}
void closeArchive(void* h) { if(h) api<void(*)(void*)>(0x204ab38)(h); }
void* read(void* h,u32 member,u16 heap,u32 size) {
    if(api<u32(*)(void*,u32)>(0x204ac38)(h,member)!=size) return nullptr;
    return api<void*(*)(void*,u32,u32)>(0x204ab48)(h,member,heap);
}
u16 crc(const u8* p,u32 n) {
    u16 c=0xffff;for(u32 i=0;i<n;i++){c^=p[i];for(u32 j=0;j<8;j++)c=(c>>1)^((c&1)?0xa001:0);}return c;
}
u32 fingerprint(const u8* p,u32 n,u32 h=0x811c9dc5){for(u32 i=0;i<n;i++)h=(h^p[i])*0x1000193;return h;}
bool config(void* h,u16 heap) {
    session.count=0;repelPresent=false;session.hideCommunication=session.saveControl=session.muteControl=session.dialControl=0;
    void* m=read(h,0,heap,160);if(!m) return false;
    bool ok=at<u32>(m,0)==0x41475143 && (at<u16>(m,4)==6||at<u16>(m,4)==7) && at<u16>(m,6)==160
        && at<u32>(m,8)==1 && at<u32>(m,12)==0x41475142 && at<u8>(m,20)<=8;
    u32 hash=fingerprint(static_cast<u8*>(m),28);hash=fingerprint(static_cast<u8*>(m)+32,128,hash);
    if(hash!=at<u32>(m,28)) ok=false;
    if(ok) {
        session.saveControl=at<u16>(m,4)==7;session.hideCommunication=session.saveControl?at<u8>(m,45):0;
        session.dialControl=session.saveControl&&at<u8>(m,47)==1;
        session.muteControl=session.saveControl?at<u8>(m,46):0;
        if(session.muteControl>1)ok=false;
        if(session.hideCommunication>1)ok=false;
        session.skinCount=at<u8>(m,21);session.defaultSkin=at<u16>(m,22);
        if(session.skinCount>64)ok=false;
        void* catalog=ok?read(h,15,heap,16+session.skinCount*8):nullptr;
        if(!catalog)ok=false;
        if(catalog){
            if(at<u32>(catalog,0)!=0x534e4b53||at<u16>(catalog,4)!=1||at<u16>(catalog,6)!=session.skinCount)ok=false;
            bool found=session.defaultSkin==0;
            for(u32 i=0;i<session.skinCount;i++){
                session.skinIds[i]=at<u16>(catalog,16+i*8);session.skinMembers[i]=at<u16>(catalog,18+i*8);session.skinHashes[i]=at<u32>(catalog,20+i*8);
                if(!session.skinIds[i]||session.skinIds[i]>4095||session.skinMembers[i]!=16+i)ok=false;
                if(session.skinIds[i]==session.defaultSkin)found=true;
                for(u32 j=0;j<i;j++)if(session.skinIds[i]==session.skinIds[j])ok=false;
            }
            if(!found)ok=false;
            api<void(*)(void*)>(0x203a278)(catalog);
        }
        session.count=at<u8>(m,20);
        for(u32 i=0;i<8;i++) {
            for(u32 n=0;n<16;n++)at<u8>(&session.buttons[i],n)=at<u8>(m,32+i*16+n);
            const auto& b=session.buttons[i];
            if(i<session.count) {
                if(!b.id || b.action<1 || b.action>18 || b.flagMode>2 || (b.flagMode && (!b.flag||b.flag>3059))
                    || b.x<16 || b.x>240 || b.y<16 || b.y>176 || (b.check!=255 && b.check>11)) ok=false;
                for(u32 j=0;j<i;j++)if(session.buttons[j].id==b.id)ok=false;
                if(b.action==1)repelPresent=true;
            }
            for(u32 c=0;c<4;c++)session.rings[i][c]=c==3?9:c+1;
        }
    }
    api<void(*)(void*)>(0x203a278)(m);if(!ok){session.count=0;session.skinCount=0;repelPresent=false;}return ok;
}
void loadPositions(void* g) {
    const u8* p=static_cast<u8*>(cgearSave(g))+16;
    u16 marker=at<u16>(const_cast<u8*>(p),0);
    bool current=(marker==0x3251 || (marker&0xf000)==0xa000) && crc(p,34)==at<u16>(const_cast<u8*>(p),34);
    session.currentSkin=session.defaultSkin;
    if(current && (marker&0xf000)==0xa000){u16 id=marker&4095;bool found=id==0;for(u32 i=0;i<session.skinCount;i++)if(session.skinIds[i]==id)found=true;if(found)session.currentSkin=id;}
    session.wantedSkin=session.currentSkin;session.skinRequest=session.currentSkin!=0;
    u8 sum=0x9b;for(u32 i=0;i<13;i++)sum^=p[i];
    bool legacy=at<u32>(const_cast<u8*>(p),0)==0x31504151 && p[4]==1 && p[13]==sum;
    for(u32 i=0;i<session.count;i++) {
        const auto& b=session.buttons[i];Point v={b.x,b.y};
        if(current)for(u32 j=0;j<8;j++)if(at<u16>(const_cast<u8*>(p),2+j*4)==b.id)v={p[4+j*4],p[5+j*4]};
        if(legacy && b.id<=4)v={p[5+(b.id-1)*2],p[6+(b.id-1)*2]};
        session.positions[i]=(v.x>=16&&v.x<=240&&v.y>=16&&v.y<=176)?v:Point{b.x,b.y};
    }
}
void savePositions(void* g) {
    // The checked save block is 52 bytes: retain native bytes 0..15 and use
    // only its 36-byte reserved tail. Stable IDs detach positions from order.
    u8* p=static_cast<u8*>(cgearSave(g))+16;clear(p,36);at<u16>(p,0)=0xa000|session.currentSkin;
    for(u32 i=0;i<session.count;i++){at<u16>(p,2+i*4)=session.buttons[i].id;p[4+i*4]=session.positions[i].x;p[5+i*4]=session.positions[i].y;}
    at<u16>(p,34)=crc(p,34);
}
void visible(void* actor,bool on) { if(actor) api<void(*)(void*,u32)>(0x204c150)(actor,on); }
void place(u32 i) {
    s16 xy[2]={session.positions[i].x,session.positions[i].y};
    api<void(*)(void*,const s16*,u32)>(0x204c16c)(session.actors[i],xy,0);
}
void placeActor(void* actor,s16 x,s16 y){s16 p[2]={x,y};if(actor)api<void(*)(void*,const s16*,u32)>(0x204c16c)(actor,p,0);}
int absolute(int v){return v<0?-v:v;}
u32 divide(u32 n,u32 d){u32 q=0,b=1;while(d<=n/2){d<<=1;b<<=1;}for(;b;b>>=1,d>>=1)if(n>=d){n-=d;q|=b;}return q;}
int ratio(int n,u32 d){return n<0?-int(divide(-n,d)):int(divide(n,d));}
int angleAt(int x,int y){
    x-=dial::centerX;y-=dial::centerY;int ax=absolute(x),ay=absolute(y),hi=ax>ay?ax:ay,lo=ax<ay?ax:ay;
    if(!hi)return 0;
    int a=dial::angles[divide(lo*128+hi/2,hi)],first=ax>=ay?a:9000-a;
    return y>=0?(x>=0?first:18000-first):(x<0?18000+first:(first?36000-first:0));
}
bool onDial(int x,int y){int dx=x-dial::centerX,dy=y-dial::centerY,d=dx*dx+dy*dy;return d>=dial::innerRadius*dial::innerRadius&&d<=dial::outerRadius*dial::outerRadius;}
void moveMarker(int x,int y){
    int dx=x-dial::centerX,dy=y-dial::centerY,d=dx*dx+dy*dy,r=1;
    while((r+1)*(r+1)<=d)++r;
    session.markerX=dial::centerX+ratio(dx*dial::markerRadius,r);session.markerY=dial::centerY+ratio(dy*dial::markerRadius,r);
    placeActor(session.marker,session.markerX,session.markerY);
}
void cancelDial(){
    if(session.dialCaptured){session.held=1;session.wantedSkin=session.skinUpload?session.preparedSkin:session.currentSkin;session.skinRequest=session.skinSound=0;}
    session.dialCaptured=0;visible(session.marker,false);
}
void stepSkin(int direction){
    int i=-1;for(u32 n=0;n<session.skinCount;n++)if(session.skinIds[n]==session.dialTarget)i=n;
    i+=direction;if(i>=int(session.skinCount))i=-1;if(i< -1)i=session.skinCount-1;
    session.dialTarget=i<0?0:session.skinIds[i];session.wantedSkin=session.dialTarget;session.skinRequest=1;session.skinSound=1;
}
void dispose() {
    if(!session.sub && !session.unit) return;
    if(session.networkMoved)api<void(*)(u32,u32)>(0x2042f58)(200,10);
    session.networkMoved=0;session.skinFeedback=0;session.visible=0;session.pending=0;session.drag=0xff;
    session.dialCaptured=session.skinSound=session.preparedSound=session.appliedSound=session.markerUploaded=0;
    if(session.task) api<void(*)(void*)>(0x203a6d4)(session.task);
    session.task=nullptr;
    if(session.marker)api<void(*)(void*)>(0x204c134)(session.marker);
    session.marker=nullptr;
    if(session.markerChars!=INVALID)api<void(*)(u32)>(0x204b9b8)(session.markerChars);
    session.markerChars=INVALID;
    // Stop uploads, remove owned actors from the native unit, then free banks.
    for(u32 i=0;i<session.count;i++) if(session.actors[i]) api<void(*)(void*)>(0x204c134)(session.actors[i]);
    session.unit=nullptr;
    for(u32 i=0;i<session.count;i++) {
        session.actors[i]=nullptr;
        if(session.chars[i]!=INVALID) api<void(*)(u32)>(0x204b9b8)(session.chars[i]);
        session.chars[i]=INVALID;
        if(session.graphics[i]) api<void(*)(void*)>(0x203a278)(session.graphics[i]);
        session.graphics[i]=nullptr;
    }
    if(session.animation!=INVALID) api<void(*)(u32)>(0x204be90)(session.animation);
    if(session.palette!=INVALID) api<void(*)(u32)>(0x204bcfc)(session.palette);
    session.animation=session.palette=INVALID;session.sub=nullptr;
    if(session.patterns) api<void(*)(void*)>(0x203a278)(session.patterns);
    session.patterns=nullptr;
    if(session.uploadBuffer) api<void(*)(void*)>(0x203a278)(session.uploadBuffer);
    session.uploadBuffer=nullptr;
    if(session.skinOriginal)api<void(*)(void*)>(0x203a278)(session.skinOriginal);
    if(session.skinBuffer)api<void(*)(void*)>(0x203a278)(session.skinBuffer);
    session.skinOriginal=session.skinBuffer=nullptr;session.skinCaptured=session.skinRequest=session.skinUpload=0;
}
void prepareSkin(){
    if(!session.skinRequest||!session.skinCaptured||session.skinUpload)return;
    session.skinRequest=0;
    session.preparedSkin=session.wantedSkin;session.preparedSound=session.skinSound;session.skinSound=0;
    if(session.dialControl&&session.preparedSound&&session.preparedSkin==session.currentSkin){session.preparedSound=0;return;}
    if(session.skinBuffer)api<void(*)(void*)>(0x203a278)(session.skinBuffer);
    session.skinBuffer=nullptr;
    if(session.wantedSkin){
        u32 i=0;while(i<session.skinCount && session.skinIds[i]!=session.wantedSkin)i++;
        void* h=i<session.skinCount?archive(session.sub->heap):nullptr;
        void* b=h?read(h,session.skinMembers[i],session.sub->heap,0x2600):nullptr;closeArchive(h);
        bool good=b && fingerprint(static_cast<u8*>(b),0x2600)==session.skinHashes[i];
        if(good){for(u32 n=0;n<16;n++)if(at<u16>(b,0x1fe0+n*2)&0x8000)good=false;for(u32 n=0;n<768;n++)if((at<u16>(b,0x2000+n*2)&1023)>=255 || (at<u16>(b,0x2000+n*2)&0xf000))good=false;}
        if(!good){if(b)api<void(*)(void*)>(0x203a278)(b);session.wantedSkin=session.dialTarget=session.currentSkin;session.preparedSound=0;return;}
        session.skinBuffer=b;
    }
    session.skinUpload=1;
}
bool freeResources() {
    void* sys=*reinterpret_cast<void**>(nativeAddress(0x214197c));if(!sys) return false;
    void* chars=at<void*>(sys,0x10c);void* anim=at<void*>(sys,0x114);
    u32 free=0;u16 n=at<u16>(sys,0x118);
    for(u32 i=0;i<n;i++) if(at<u32>(chars,i*64+60)&0x80000000) free++;
    if(free<session.count+(session.dialControl&&session.skinCount?1u:0u)) return false;
    void* palettes=at<void*>(sys,0x110);n=at<u16>(sys,0x11a);bool freePalette=false;
    for(u32 i=0;i<n;i++) if(at<u32>(palettes,i*24+20)&0x80000000) freePalette=true;
    if(!freePalette) return false;
    n=at<u16>(sys,0x11c);
    for(u32 i=0;i<n;i++) if(at<u32>(anim,i*20+16)) return true;
    return false;
}
void upload(void*,void*) {
    struct Character {u16 height,width;u32 format,mapping,character,size;void* data;};
    if(session.visible && session.skinOriginal && !session.skinCaptured){
        // Snapshot the native picture after its scheduled initialization.
        // These are checked BG1 VRAM regions, not replacements of display control.
        for(u32 i=0;i<0x1fe0;i+=2)at<u16>(session.skinOriginal,i)=*reinterpret_cast<volatile u16*>(0x06204000+i);
        void* fade=at<void*>(session.sub->work,0x100);
        void* base=fade?at<void*>(fade,20):nullptr;
        // Preserve the native palette before an initialization fade changes
        // physical VRAM. FADE_SUB_BG is the second 20-byte native record.
        for(u32 i=0;i<32;i+=2)at<u16>(session.skinOriginal,0x1fe0+i)=base?at<u16>(base,416+i):*reinterpret_cast<volatile u16*>(0x050003a0+i);
        for(u32 i=0;i<0x600;i+=2)at<u16>(session.skinOriginal,0x2000+i)=*reinterpret_cast<volatile u16*>(0x06207800+i)&0x0fff;
        session.skinCaptured=1;
    }
    if(session.visible && session.skinUpload){
        void* b=session.preparedSkin?session.skinBuffer:session.skinOriginal;
        if(b){
            api<void(*)(u32,const void*,u32,u32)>(0x20450ac)(5,b,0x1fe0,0);
            void* colors=static_cast<u8*>(b)+0x1fe0;
            api<void(*)(void*,const void*,u32,u32,u32)>(0x2026e90)(at<void*>(session.sub->work,0x100),colors,1,208,32);
            api<void(*)(u32,const void*,u32,u32)>(0x204534c)(5,colors,32,416);
            api<void(*)(u32,const void*,u32)>(0x2045080)(5,static_cast<u8*>(b)+0x2000,0x600);
            api<void(*)(u32,u32,u32,u32,u32,u32)>(0x2045698)(5,0,0,32,24,13);
            api<void(*)(u32)>(0x2044fbc)(5);
            ov<void(*)(void*)>(0x21eb730)(session.sub->work);
            bool changed=session.currentSkin!=session.preparedSkin;session.currentSkin=session.preparedSkin;savePositions(game(session.sub));
            if(changed&&session.preparedSound)session.appliedSound=1;
        }
        session.skinUpload=0;
        session.preparedSound=0;
    }
    // Native C-Gear initialization is asynchronous and first uploads a full
    // palette bank. Restore our unused slots after that upload, through the
    // same native scheduling system. The additional transfer is 256 bytes.
    if(session.visible && session.palette!=INVALID) {
        u16 target=at<u8>(session.sub->work,0x30a)?0x0423:0x0441;
        for(u32 i=0;i<128;i++) {
            u16 c=session.colours[i];
            if(session.dim) c=(((c&31)+(target&31))>>1)
                |(((((c>>5)&31)+((target>>5)&31))>>1)<<5)
                |(((((c>>10)&31)+((target>>10)&31))>>1)<<10);
            session.uploadColours[i]=c;
        }
        struct Palette {u32 format,extended,size;void* data;} p={3,0,256,session.uploadColours};
        // Retail C-Gear fades retransmit OBJ banks 0–13 every VBlank. Keep
        // its retained buffers in sync for owned banks 7–13; bank 14 is
        // outside that allocation and travels through the resource upload.
        api<void(*)(void*,const void*,u32,u32,u32)>(0x2026e90)(at<void*>(session.sub->work,0x100),session.uploadColours,3,112,224);
        api<void(*)(u32,const void*,u32)>(0x204bd3c)(session.palette,&p,8);
    }
    for(u32 i=0;i<session.count;i++) if(session.actors[i]) {
        u8 pose=session.desired[i];
        if(pose!=session.uploaded[i]) {
            auto* composed=static_cast<u8*>(session.uploadBuffer)+i*512;
            auto* art=static_cast<u8*>(session.graphics[i])+(pose>>4)*512;
            auto* pattern=static_cast<u8*>(session.patterns)+(pose&15)*512;
            // Compose immutable pattern and caption data only inside the
            // scheduled upload. DMA sources must live in main RAM: a stack
            // buffer can be in DTCM, which the DS DMA engine cannot read.
            for(u32 n=0;n<512;n++) {
                u8 a=art[n],p=pattern[n];
                u8 lo=a&15,hi=a>>4;
                if(lo==9) lo=(p&15)==13?13:9;
                if(hi==9) hi=(p>>4)==13?13:9;
                composed[n]=lo|(hi<<4);
            }
            Character c={0xffff,0xffff,3,16,0,512,composed};
            api<void(*)(u32,const void*)>(0x204ba6c)(session.chars[i],&c);
            session.uploaded[i]=pose;
        }
        visible(session.actors[i],session.visible && session.shown[i]);
    }
    if(session.marker){
        if(!session.markerUploaded){
            auto* pixels=static_cast<u8*>(session.uploadBuffer)+4096;clear(pixels,128);
            for(int y=0;y<8;y++)for(int x=0;x<8;x++){int d=absolute(x-3)+absolute(y-3);u8 ink=d>3?0:d==3?12:11;pixels[y*4+x/2]|=ink<<((x&1)*4);}
            Character c={0xffff,0xffff,3,16,0,128,pixels};api<void(*)(u32,const void*)>(0x204ba6c)(session.markerChars,&c);session.markerUploaded=1;
        }
        visible(session.marker,session.visible&&session.dialCaptured);
    }
}
void attach(Subscreen* s) {
    dispose();session.error=1;session.magic=0x53415143;session.sub=s;session.drag=0xff;session.pressed=0xff;session.frame=0;session.held=0;session.dim=0;
    session.animation=session.palette=session.markerChars=INVALID;
    for(u32 i=0;i<8;i++) session.chars[i]=INVALID;
    void* h=archive(s->heap);enabled=h && config(h,s->heap);
    if(!enabled || !freeResources() || api<u32(*)(u32)>(0x2039f8c)(s->heap)<65536
        || api<u32(*)(u32)>(0x2039fbc)(s->heap)<16384) {closeArchive(h);dispose();return;}
    session.error=2;loadPositions(game(s));savePositions(game(s));
    void* palette=read(h,1,s->heap,296);
    if(!palette) {closeArchive(h);dispose();return;}
    for(u32 i=0;i<128;i++) session.colours[i]=at<u16>(palette,40+i*2);
    api<void(*)(void*)>(0x203a278)(palette);
    session.error=3;session.patterns=read(h,12,s->heap,5120);
    if(!session.patterns) {closeArchive(h);dispose();return;}
    session.error=4;session.uploadBuffer=api<void*(*)(u32,u32,u32,const char*,u32)>(0x203a228)(s->heap,session.dialControl?4224:4096,1,"quick-actions",0);
    if(!session.uploadBuffer) {closeArchive(h);dispose();return;}
    session.error=5;session.palette=api<u32(*)(void*,u32,u32,u32,u32)>(0x204bbcc)(h,1,1,224,s->heap);
    session.animation=api<u32(*)(void*,u32,u32,u32)>(0x204be0c)(h,2,3,s->heap);
    if(session.palette==INVALID || session.animation==INVALID) {closeArchive(h);dispose();return;}
    session.error=6;session.unit=at<void*>(s->work,0x34);
    if(!session.unit) {closeArchive(h);dispose();return;}
    // Native owns the render unit. Add up to eight buttons plus a dial marker,
    // leaving its original 84 slots available. Remove ours before native exit.
    void* actors=at<void*>(session.unit,0);u32 freeActors=0;
    for(u32 i=0;i<at<u16>(session.unit,12);i++) if(!at<u32>(actors,i*228)) freeActors++;
    if(freeActors<session.count+(session.dialControl&&session.skinCount?1u:0u)) {closeArchive(h);dispose();return;}
    for(u32 reverse=session.count;reverse>0;reverse--) {
        u32 i=reverse-1;
        session.error=8+i;session.graphics[i]=read(h,i+4,s->heap,2048);
        session.error=16+i;session.chars[i]=api<u32(*)(u32,u32,u32)>(0x204b8e8)(512,1,s->heap);
        if(!session.graphics[i] || session.chars[i]==INVALID) {closeArchive(h);dispose();return;}
        void* sys=*reinterpret_cast<void**>(nativeAddress(0x214197c));
        void* resource=static_cast<u8*>(at<void*>(sys,0x10c))+session.chars[i]*64;
        session.error=24+i;if(api<u32(*)(void*)>(0x203cb14)(static_cast<u8*>(resource)+0x34)) {closeArchive(h);dispose();return;}
        struct ActorData {s16 x,y;u16 sequence;u8 priority,bg;} data={session.positions[i].x,session.positions[i].y,static_cast<u16>(i),0,0};
        session.error=32+i;session.actors[i]=api<void*(*)(void*,u32,u32,u32,const void*,u32,u32)>(0x204c06c)(
            session.unit,session.chars[i],session.palette,session.animation,&data,0,s->heap);
        if(!session.actors[i]) {closeArchive(h);dispose();return;}
        api<void(*)(void*,u32)>(0x204c54c)(session.actors[i],1);
        visible(session.actors[i],false);session.uploaded[i]=0xff;session.desired[i]=0;
    }
    if(session.dialControl&&session.skinCount){
        session.markerChars=api<u32(*)(u32,u32,u32)>(0x204b8e8)(128,1,s->heap);
        if(session.markerChars==INVALID){closeArchive(h);dispose();return;}
        void* sys=*reinterpret_cast<void**>(nativeAddress(0x214197c));void* resource=static_cast<u8*>(at<void*>(sys,0x10c))+session.markerChars*64;
        if(api<u32(*)(void*)>(0x203cb14)(static_cast<u8*>(resource)+0x34)){closeArchive(h);dispose();return;}
        struct MarkerData{s16 x,y;u16 sequence;u8 priority,bg;} data={dial::decalX,dial::decalY,8,0,0};
        session.marker=api<void*(*)(void*,u32,u32,u32,const void*,u32,u32)>(0x204c06c)(session.unit,session.markerChars,session.palette,session.animation,&data,0,s->heap);
        if(!session.marker){closeArchive(h);dispose();return;}
        api<void(*)(void*,u32)>(0x204c54c)(session.marker,1);visible(session.marker,false);
    }
    closeArchive(h);
    if(session.skinCount){session.skinOriginal=api<void*(*)(u32,u32,u32,const char*,u32)>(0x203a228)(s->heap,0x2600,1,"quick-actions-skin",0);if(!session.skinOriginal){dispose();return;}}
    session.error=40;session.task=api<void*(*)(void*,void*,u32)>(0x20056fc)(reinterpret_cast<void*>(upload),nullptr,2);
    if(!session.task) dispose();else session.error=0;
}
bool drawable(Subscreen* s) {
    if(!s||s!=session.sub||!session.unit||s->state||s->mode!=0) return false;
    void* w=s->work;
    return w && !api<u32(*)(void*)>(0x20175e4)(game(s)) && at<u32>(w,0)==(overlayAddress(0x21ec9cc)|1)
        && ov<u32(*)(Subscreen*,void*,void*)>(0x21983ec)(s,system(s),game(s))==13;
}
bool safe(Subscreen* s) {
    return drawable(s) && !ov<u32(*)(void*)>(0x21ed2e0)(s->work) && !at<u32>(s->work,0x108)
        && !ov<u32(*)(void*)>(0x218130c)(s->field);
}
int hit(u32 x,u32 y) {
    int wx=static_cast<int>(x)-228,wy=static_cast<int>(y)-144;
    int sx=static_cast<int>(x)-208,sy=static_cast<int>(y)-18;
    int px=static_cast<int>(x)-200,py=static_cast<int>(y)-180;
    if((session.saveControl&&px*px+py*py<=100) || wx*wx+wy*wy<=100 || (x>=104&&x<=152&&y<=24) || (!session.dialControl&&session.skinCount && sx*sx+sy*sy<=256))return -1;
    for(u32 n=session.count;n>0;n--) {
        u32 i=n-1;
        if(!session.shown[i]) continue;
        int dx=static_cast<int>(x)-session.positions[i].x,dy=static_cast<int>(y)-session.positions[i].y;
        if(dx*dx+dy*dy<=256) return static_cast<int>(i);
    }
    return -1;
}
void refresh(Subscreen* s,u32 active) {
    // Native field events temporarily disable input while retaining C-Gear.
    // Keep the overlay on that screen during Bike and PC dialogs; hiding it
    // belongs to the display lifecycle, independently of input permission.
    session.active=active;session.visible=drawable(s);
    if(!active || !safe(s)) {cancelDial();session.pending=0;session.pressed=0xff;session.drag=0xff;session.skinFeedback=0;}
    bool moveNetwork=session.visible&&session.saveControl&&(session.skinCount||session.dialControl);
    if(moveNetwork!=!!session.networkMoved){api<void(*)(u32,u32)>(0x2042f58)(moveNetwork?256:200,moveNetwork?192:10);session.networkMoved=moveNetwork;}
    if(!session.unit) return;
    void* g=game(s);bool edit=at<u8>(s->work,0x2fe);
    if(edit || !session.visible)session.skinFeedback=0;
    if(edit)cancelDial();
    if(session.dialControl){
        // Four time digits, the clock's circular backing, and the old selector.
        // Native updates may show these again, so hide them before each render.
        for(u32 i=0;i<6;i++)visible(at<void*>(s->work,0x6c+i*4),false);
    }
    if(session.visible && session.skinCount && !session.dialControl){
        // The retained ACT_NETWORK_BG has two frames in native sequence 5.
        // Override its network-status frame after native update; use the owned
        // pressed glyph briefly even when the stylus has already been released.
        void* selector=at<void*>(s->work,0x80);
        if(selector){
            api<void(*)(void*,u16)>(0x204c530)(selector,(session.dialControl?session.dialCaptured:session.skinFeedback)?1:0);
        }
        if(session.skinFeedback)session.skinFeedback--;
    }
    if(session.visible) {
        for(u32 i=0;i<session.count;i++) session.shown[i]=show(i,s);
        // Follow native sleep dimming after its delayed palette update.
        // Short Bike events finish before that update, avoiding a flash.
        if(!at<u8>(s->work,0x310)) session.dim=ov<u32(*)(void*)>(0x21ed2e0)(s->work);
        // Match the user's middle C-Gear ring, including native pink themes
        // and colour edits. These offsets are independently pinned per game.
        u32 col=at<u8>(s->work,0x306);if(col>=6) col=0;
        for(u32 i=0;i<session.count;i++) for(u32 c=0;c<3;c++)
            session.colours[i*16+session.rings[i][c]]=at<u16>(s->work,0x18c+col*18+6+c*2);
        for(u32 i=0;i<session.count;i++)session.available[i]=canUse(i,s);
        session.frame++;
        // Retail hides ACT_CUSTOM with wireless off. Its actor is retained;
        // restore only that actor, without changing any communication flag.
        visible(at<void*>(s->work,0x90),true);
        if(session.hideCommunication){visible(at<void*>(s->work,0x6c+10*4),false);for(u32 i=13;i<=19;i++)visible(at<void*>(s->work,0x6c+i*4),false);}
        if(session.saveControl)visible(at<void*>(s->work,0x6c+7*4),true);
        if(session.muteControl){
            session.muteState=PokewebBgmMute(0);
            void* music=at<void*>(s->work,0x6c+8*4);
            visible(music,true);
            if(music){
                // Help has a single normal frame; choose the appropriate
                // sequence and freeze its first cell instead of frame 1.
                api<void(*)(void*,u16)>(0x204c4e4)(music,session.muteState?9:8);
                api<void(*)(void*,u32)>(0x204c54c)(music,1);
                api<void(*)(void*,u16)>(0x204c530)(music,0);
            }
        }
    }
    u32 keys=api<u32(*)()>(0x203df4c)();
    if(edit && (keys&0x300)==0x300) {
        // The field subscreen update runs at 30 Hz in both retail profiles.
        if(!session.resetHeld && ++session.resetFrames>=30) {
            session.resetHeld=1;session.pending=0;session.drag=0xff;
            for(u32 i=0;i<session.count;i++){session.positions[i]={session.buttons[i].x,session.buttons[i].y};place(i);}
            savePositions(g);
        }
    }else{session.resetFrames=0;session.resetHeld=0;}
    for(u32 i=0;i<session.count;i++) {
        bool on=(session.buttons[i].action==1 && repel(g))||(session.buttons[i].action==3 && cycling(g));
        u32 pose=session.pressed==i?2:edit?1:!session.available[i]?3:on?1:0;
        u32 design=at<u8>(s->work,0x300),sex=at<u8>(s->work,0x30a);
        if(design>=5) design=0;
        if(sex>1) sex=0;
        session.desired[i]=(pose<<4)|(sex*5+design);
    }
}
// Native report state owns its allocations and ordinary yes/no/save flow.
// Our event owns the 32-byte request and waits for subscreen reconstruction.
struct SaveWork {void* control;void* sys;void* field;void* message;u16 heap,pad;void* result;u32 returnMode;void* local;Subscreen* sub;u32 reportSequence,finished;};
static_assert(__builtin_offsetof(SaveWork,sub)==32);
int saveEvent(void* event,u32*) {
    auto* w=api<SaveWork*(*)(void*)>(0x2016edc)(event);
    if(!w->finished){
        u32 before=w->reportSequence;
        int result=ov<int(*)(void*,u32*)>(0x2163b78)(w,&w->reportSequence);
        // Retail cancel requests the main menu. Replace the pending request
        // in the same event tick, before either screen begins uploading.
        if(before==17)ov<void(*)(Subscreen*,u32)>(0x21984ac)(w->sub,w->returnMode);
        if(result!=2)w->finished=1;
    }
    return w->finished&&ov<u32(*)(Subscreen*)>(0x21983dc)(w->sub);
}
struct FlyWork {MapRequest map;u32 member,action,item;};
struct NavWork {MapRequest map;pokenav::Launch request;};
int navEvent(void* event,u32* sequence){
    auto* w=api<NavWork*(*)(void*)>(0x2016edc)(event);
    if(!*sequence){
        void* sys=api<void*(*)(void*)>(0x2016ed8)(event);void* field=api<void*(*)(void*)>(0x2016af0)(sys);
        if(!field)return 1;
        w->map.system=sys;w->map.field=field;w->map.call=0;w->map.data=&w->request;
        void* child=ov<void*(*)(MapRequest*,u32)>(0x215b4c8)(&w->map,ov<u32(*)(void*)>(0x2180500)(field));
        if(!child)return 1;
        api<void(*)(void*,void*)>(0x2016d68)(event,child);*sequence=1;return 0;
    }
    return 1;
}
bool navConfigured(u16 heap){
    pokenavEnabled=false;bool present=false;for(u32 i=0;i<session.count;++i)if(session.buttons[i].action==18)present=true;
    if(!present)return false;
    void* h=archive(heap,"rom:/pokenav/ui.narc");if(!h)return false;
    void* b=read(h,0,heap,16);bool ok=b&&at<u32>(b,0)==pokenav::Magic&&at<u16>(b,4)==1&&at<u16>(b,6)==16&&at<u32>(b,8)==1&&at<u32>(b,12)==0xfffffffe;
    if(b){api<void(*)(void*)>(0x203a278)(b);}
    closeArchive(h);return ok;
}
void* navLaunch(Subscreen* s){
    void* event=api<void*(*)(void*,void*,void*,u32)>(0x2016cb4)(system(s),nullptr,reinterpret_cast<void*>(navEvent),sizeof(NavWork));if(!event)return nullptr;
    auto* w=api<NavWork*(*)(void*)>(0x2016edc)(event);clear(w,sizeof(*w));auto* r=&w->request;r->magic=pokenav::Magic;r->version=pokenav::Abi;r->size=sizeof(*r);
    r->zone=ov<u32(*)(void*)>(0x2180518)(s->field);
    void* enc=ov<void*(*)(void*)>(0x2180564)(s->field);const u8* data=enc&&at<void*>(enc,0)==s->field?at<const u8*>(enc,12):nullptr;
    if(data&&(data[7]&128)){r->valid=1;for(u32 i=0;i<232;++i)r->tables[i]=data[i];}
    u8 excluded[nuzlocke::MaskBytes];
    if(r->valid&&nuzlocke::snapshot(game(s),excluded)){
        r->reserved=1|(nuzlocke::preventAll()?2:0);u32 physical=0;
        for(u32 method=0;method<7;++method)for(u32 slot=0;slot<(method<3?12u:5u);++slot,++physical){
            const u32 at=(method<3?8+method*48:152+(method-3)*20)+slot*4;
            if(nuzlocke::bit(excluded,nuzlocke::half(r->tables+at)&2047))r->dupes[physical>>3]|=u8(1u<<(physical&7));
        }
    }
    void* headers=archive(s->heap,"rom:/a/0/1/2");if(headers){const u32 size=api<u32(*)(void*,u32)>(0x204ac38)(headers,0);u8 row[48];const u32 at=u32(r->zone)*48;
        if(at<=size&&48<=size-at){api<void(*)(void*,u32,u32,u32,void*)>(0x204ac84)(headers,0,at,48,row);r->placeName=row[26]|((row[27]&3)<<8);}closeArchive(headers);}
    api<void(*)(u32)>(0x2006254)(1356);return event;
}

void* storageEvent(void* sys,u16 heap) {
    void* event=ov<void*(*)(void*,u32,void*,u32)>(0x21536ac)(sys,10090,nullptr,heap);
    if(!event) return nullptr;
    // The native constructor has already created an independently allocated
    // script and VM. Change only this invocation's entry code; its native
    // event retains ownership and frees the script, VM and windows normally.
    void* work=api<void*(*)(void*)>(0x2016edc)(event);
    void* scripts=at<void*>(work,4);
    void* vm=at<void*>(scripts,4);
    auto* code=at<u8*>(vm,56);
    if(code && at<u8*>(vm,32)==code+30 && fingerprint(code,PC_SCRIPT_SIZE)==PC_SCRIPT_HASH) {
        // Field start, initialize logout state, call the unchanged storage
        // choice loop, quick PC shutdown, then ordinary field-event cleanup.
        static constexpr u16 entry[]={0x2e,0x28,0x8020,0,0x28,0x8021,1,
            0x04,0x2bc,0,0x132,0x8021,0x30,0x2f,0x02};
        for(u32 i=0;i<sizeof(entry)/2;i++) at<u16>(code,30+i*2)=entry[i];
        api<void(*)(u32)>(0x2006254)(1372);
    }
    return event;
}
int flyEvent(void* event,u32* sequence) {
    auto* w=api<FlyWork*(*)(void*)>(0x2016edc)(event);
    void* sys=api<void*(*)(void*)>(0x2016ed8)(event);
    void* field=api<void*(*)(void*)>(0x2016af0)(sys);
    void* g=api<void*(*)(void*)>(0x2016ad8)(sys);
    if(*sequence==0) {
        if(!field) return 1;
        u32 action=w->action,itemId=w->item;
        int member=action==4?flyMember(field,g):-1;
        clear(w,sizeof(*w));w->member=member;w->action=action;w->item=itemId;
        bool formItem=action>=12 && action<=14;
        w->map.system=sys;w->map.field=field;w->map.call=action==8?12:action==9?9:action==10?13:action==11?14:action==15?2:(formItem||action==16)?0:8;w->map.user=w;
        w->map.data=reinterpret_cast<void*>(formItem?itemId:0xffffffff);
        ownedMap=&w->map;
        void* child=ov<void*(*)(MapRequest*,u32)>(0x215b4c8)(&w->map,ov<u32(*)(void*)>(0x2180500)(field));
        if(!child) {ownedMap=nullptr;return 1;}
        // The child's initial application is already Town Map. PARTY origin
        // selects the native Fly map and native Fly return result, bypassing
        // an unnecessary party menu. Request storage belongs to this event.
        if(member>=0) {
            w->map.call=0;
            at<u8>(api<void*(*)(void*)>(0x2016edc)(child),0x68)=member;
        }
        api<void(*)(void*,void*)>(0x2016d68)(event,child);*sequence=1;return 0;
    }
    ownedMap=nullptr;
    if(*sequence==1 && (w->action==4 || w->action==15 || w->action==16) && w->map.result==2 && field) {
        FlyCheck check;ov<void(*)(void*,FlyCheck*)>(0x2159270)(field,&check);
        u32 skill=w->action==4?4:w->map.selection;
        if(w->action==4 && (w->member==INVALID || ov<u32(*)(FlyCheck*)>(0x21596c4)(&check))) return 1;
        UseHeader header={static_cast<u16>(w->action==4?w->member:w->map.pokemon),static_cast<u16>(skill),w->map.zone};
        void* child=ov<void*(*)(u32,UseHeader*,FlyCheck*)>(0x2159460)(skill,&header,&check);
        if(child) {api<void(*)(void*,void*)>(0x2016d68)(event,child);*sequence=2;return 0;}
    }
    if(*sequence==1 && (w->action==15 || w->action==16) && w->map.result==3 && field) {
        void* child=ov<void*(*)(u32,void*,void*)>(0x215f024)(w->map.selection,sys,field);
        if(child) {api<void(*)(void*,void*)>(0x2016d68)(event,child);*sequence=2;return 0;}
    }
    return 1;
}
}
extern "C" void QaCGearInit(Subscreen* s) {
    dispose();session.sub=s;session.attempted=0;session.held=0;session.pending=0;
    session.palette=session.animation=session.markerChars=INVALID;
    for(u32 i=0;i<8;i++) session.chars[i]=INVALID;
    void* h=archive(s->heap);enabled=h && config(h,s->heap);closeArchive(h);pokenavEnabled=enabled&&navConfigured(s->heap);
    ov<void(*)(Subscreen*)>(0x2198564)(s);
}
extern "C" void* QaGearUnit(u32 count,u32 priority,u32 heap) {
    return api<void*(*)(u32,u32,u32)>(0x204bf48)(count+(enabled?session.count+(session.dialControl&&session.skinCount?1:0):0),priority,heap);
}
extern "C" void QaGearEnd(void* work) {
    // Native applications can rebuild C-Gear without changing its subscreen
    // object. Release our resources before the inner native teardown too.
    Subscreen* s=session.sub;
    if(s && s->work==work) {dispose();session.sub=s;session.attempted=0;}
    ov<void(*)(void*)>(0x21ec808)(work);
}
extern "C" void QaCGearExit(Subscreen* s) {
    dispose();ov<void(*)(Subscreen*)>(0x219863c)(s);
}
extern "C" void QaNoGearInit(Subscreen* s) {
    void* h=archive(s->heap);enabled=h && config(h,s->heap);closeArchive(h);pokenavEnabled=enabled&&navConfigured(s->heap);
    ov<void(*)(Subscreen*)>(0x21986c0)(s);
}
extern "C" void QaCGearUpdate(Subscreen* s,u32 active) {
    session.active=active;ov<void(*)(Subscreen*,u32)>(0x219865c)(s,active);
    // Let all native graphics finish allocating before taking spare capacity.
    // A failed attempt remains invisible and is never retried every frame.
    if(enabled && !session.attempted && s==session.sub && s->work
        && at<u32>(s->work,0)==(overlayAddress(0x21ec9cc)|1)) {
        session.attempted=1;attach(s);
    }
    refresh(s,active);
    if(session.appliedSound){session.appliedSound=0;api<void(*)(u32)>(0x2006254)(1356);}
    if(active && safe(s))prepareSkin();
}
extern "C" void QaInput(void* w) {
    Subscreen* s=session.sub;
    if(!session.active||!safe(s)||s->work!=w) {cancelDial();session.pending=0;ov<void(*)(void*)>(0x21eb894)(w);return;}
    u32 x=0,y=0;bool down=api<u32(*)(u32*,u32*)>(0x203dab0)(&x,&y);
    if(session.dialCaptured){
        if(!down){session.dialCaptured=session.held=0;visible(session.marker,false);return;}
        if(at<u8>(w,0x2fe)){cancelDial();return;}
        int angle=angleAt(x,y),delta=angle-session.dialAngle;
        if(delta>18000)delta-=36000;
        if(delta< -18000)delta+=36000;
        session.dialAngle=angle;
        int dx=int(x)-dial::centerX,dy=int(y)-dial::centerY;
        if(dx*dx+dy*dy>=6400&&absolute(delta)<=9000){
            int movement=session.dialAccum+delta;
            while(movement>=dial::step){stepSkin(1);movement-=dial::step;}
            while(movement<=-dial::step){stepSkin(-1);movement+=dial::step;}
            session.dialAccum=movement;moveMarker(x,y);
        }
        return;
    }
    if(session.drag<session.count) {
        if(down) {
            auto& p=session.positions[session.drag];p.x=clamp(x,16,240);p.y=clamp(y,16,176);place(session.drag);
        } else {savePositions(game(s));session.drag=0xff;session.pressed=0xff;}
        return;
    }
    if(session.held) {if(!down) {session.held=0;session.pressed=0xff;}return;}
    if(api<u32(*)()>(0x203da74)()) {
        int mx=static_cast<int>(x)-215,my=static_cast<int>(y)-163;
        if(session.muteControl&&mx*mx+my*my<=100){session.held=1;session.pending=at<u8>(w,0x2fe)?0:254;return;}
        int px=static_cast<int>(x)-200,py=static_cast<int>(y)-180;
        if(session.saveControl&&px*px+py*py<=100){session.held=1;session.pending=at<u8>(w,0x2fe)?0:255;return;}
        int sx=static_cast<int>(x)-208,sy=static_cast<int>(y)-18;
        if(!session.dialControl&&session.skinCount && !at<u8>(w,0x2fe) && sx*sx+sy*sy<=256){
            session.held=1;session.pending=0;
            if(!session.skinRequest && !session.skinUpload){
                u32 i=0;while(i<session.skinCount&&session.skinIds[i]!=session.currentSkin)i++;
                session.wantedSkin=session.currentSkin==0?session.skinIds[0]:i+1<session.skinCount?session.skinIds[i+1]:0;
                session.skinRequest=1;
                session.skinFeedback=6; // Six 30 Hz updates: a 200 ms pressed flash.
                api<void(*)(u32)>(0x2006254)(1356);
            }
            return;
        }
        // Keep the fixed wrench reachable even if a saved/custom button is
        // positioned over it. Native editing/exit always owns this region.
        int dx=static_cast<int>(x)-228,dy=static_cast<int>(y)-144;
        int i=dx*dx+dy*dy<=100?-1:hit(x,y);
        if(i>=0) {
            session.held=1;session.pressed=i;
            if(at<u8>(w,0x2fe)) session.drag=i;
            else if(session.available[i]) session.pending=i+1;
            return; // Disabled buttons also own their circular touch.
        }
        int mx0=int(x)-215,my0=int(y)-163,px0=int(x)-200,py0=int(y)-180;
        bool reserved=dx*dx+dy*dy<=100||(x>=104&&x<=152&&y<=24)||(!session.dialControl&&x>=31&&x<=65&&y<=35)
            ||(session.muteControl&&mx0*mx0+my0*my0<=100)||(session.saveControl&&px0*px0+py0*py0<=100);
        if(session.dialControl&&session.skinCount&&!at<u8>(w,0x2fe)&&!reserved&&onDial(x,y)&&QaButtonHit(w)<0){
            session.pending=0;session.held=1;session.dialCaptured=1;session.dialAngle=angleAt(x,y);session.dialAccum=0;
            session.dialTarget=session.skinRequest?session.wantedSkin:session.skinUpload?session.preparedSkin:session.currentSkin;
            moveMarker(x,y);visible(session.marker,true);return;
        }
    }
    ov<void(*)(void*)>(0x21eb894)(w);
}
extern "C" int QaButtonHit(void* w) {
    if(enabled&&session.dialCaptured)return -1;
    // Input only: allow the wrench, pattern toggle and panel drags with wireless off.
    // Never make the C-Gear state machine believe wireless has been enabled.
    u8 power=at<u8>(w,0x30b);bool edit=at<u8>(w,0x2fe);u32 x=0,y=0;
    api<u32(*)(u32*,u32*)>(0x203dab0)(&x,&y);
    int dx=static_cast<int>(x)-228,dy=static_cast<int>(y)-144;
    bool wrench=dx*dx+dy*dy<=100;
    bool logo=x>=104 && x<=152 && y<=24;
    if(enabled && (edit||wrench||logo)) at<u8>(w,0x30b)=1;
    int result=ov<int(*)(void*)>(0x21eb748)(w);at<u8>(w,0x30b)=power;
    if(enabled&&session.dialControl&&(result==3||result==4))return -1;
    if(enabled&&session.saveControl&&result==5)return -1;
    if(enabled&&session.muteControl&&result==6)return -1;
    if(enabled&&session.hideCommunication&&((result>=0&&result<=2)||result==8))return -1;
    return result;
}
extern "C" void* QaCGearEvent(Subscreen* s,u32 available) {
    void* native=ov<void*(*)(Subscreen*,u32)>(0x21986b4)(s,available);
    u32 action=session.pending;session.pending=0;
    if(native||!available||!action||!safe(s)||at<u8>(s->work,0x2fe)) return native;
    if(action==254&&session.muteControl){session.muteState=PokewebBgmMute(1);api<void(*)(u32)>(0x2006254)(1356);return nullptr;}
    if(action==255&&session.saveControl){
        void* event=api<void*(*)(void*,void*,void*,u32)>(0x2016cb4)(system(s),nullptr,reinterpret_cast<void*>(saveEvent),sizeof(SaveWork));
        if(event){auto* w=api<SaveWork*(*)(void*)>(0x2016edc)(event);clear(w,sizeof(*w));w->control=save(game(s));w->sys=system(s);w->field=s->field;w->message=ov<void*(*)(void*)>(0x21804d0)(s->field);w->heap=s->heap;w->returnMode=s->mode;w->sub=s;}
        return event;
    }
    if(action>session.count||!show(action-1,s))return nullptr;
    void* g=game(s);void* sys=system(s);
    const auto& button=session.buttons[action-1];action=button.action;
    if(!canUse(static_cast<u32>(&button-session.buttons),s))return nullptr;
    if(action==1) {
        u16* p=options(g);*p^=0x1000;
        if(*p&0x1000) api<void(*)(u32)>(0x2006254)(1996);
        return nullptr;
    }
    if(action==18)return navLaunch(s);
    if(action==2) return storageEvent(sys,s->heap);
    if(action==17) {api<void(*)(u32)>(0x2006254)(1356);pokeradar(s);return nullptr;}
    if(action==3||action==6||action==7) return ov<void*(*)(u32,void*,void*)>(0x215f024)(action==3?0:action==6?5:4,sys,s->field);
    void* event=api<void*(*)(void*,void*,void*,u32)>(0x2016cb4)(sys,nullptr,reinterpret_cast<void*>(flyEvent),sizeof(FlyWork));
    if(event) {
        auto* w=api<FlyWork*(*)(void*)>(0x2016edc)(event);clear(w,sizeof(*w));w->action=action;
        w->item=button.alternate && item(g,button.alternate,s->heap)?button.alternate:button.item;
        if(action==4 || action==5 || action==15 || action==16) api<void(*)(u32)>(0x2006254)(1356);
    }
    return event;
}
extern "C" int QaTownMapReturn(void* work,void* param) {
    if(ownedMap && at<void*>(work,0x18)==ownedMap && at<u32>(param,4)!=2) {
        auto* w=static_cast<FlyWork*>(ownedMap->user);
        if(w->action==4 || w->action==5) return 1;
    }
    return ov<int(*)(void*,void*)>(0x215c038)(work,param);
}
extern "C" u32 QaRepelStep(void* encounter,void* g) {
    if(repel(g)) return 0;
    return api<u32(*)(void*)>(0x200ddb8)(encounter);
}
extern "C" u32 QaRepelDepleted(void* encounter,void* g) {
    if(repel(g) && count(g)) return 0;
    return api<u32(*)(void*)>(0x200dde0)(encounter);
}
extern "C" u32 QaPhenomenonInterval(void* state,void* effect) {
    if(radarWork && radarWork==effect) return 1;
    return ov<u32(*)(void*,void*)>(0x21a24ac)(state,effect);
}
extern "C" u32 QaPhenomenonChance(u32 chance) {
    // Called only at the native spawn-probability site. Other RNG stays native.
    return radarWork?100:api<u32(*)(u32)>(0x2013878)(chance);
}
