#include "runtime.h"

namespace {
struct Session {
    u32 magic;Subscreen* sub;void* unit;void* actors[4];void* task;void* graphics[4];
    u32 chars[4],palette,animation;Point positions[4];
    volatile u8 desired[4],uploaded[4];u8 available[4],visible;
    u8 pending,pressed,drag,held,active,attempted;u32 frame;u16 colours[64];u8 rings[4][4];void* patterns;void* uploadBuffer;
    u16 uploadColours[64];u8 dim,shown[4];u16 pcHideFlag;
} session;
// Archive state is also read on the no-C-Gear initialization path: encounter
// hooks must not depend on whether the touch-screen sprites are visible.
bool enabled;
MapRequest* ownedMap;
const Point defaults[4]={{60,116},{196,116},{88,152},{172,152}};
u32 clamp(u32 n,u32 lo,u32 hi) { return n<lo?lo:n>hi?hi:n; }
void clear(void* p,u32 n) { for(u32 i=0;i<n;i++) at<u8>(p,i)=0; }
void* game(Subscreen* s) { return s?at<void*>(s->field,8):nullptr; }
void* system(Subscreen* s) { return s?at<void*>(s->field,4):nullptr; }
void* save(void* g) { return api<void*(*)(void*)>(0x2017934)(g); }
u16* options(void* g) { return api<u16*(*)(void*)>(0x2008ddc)(save(g)); }
void* cgearSave(void* g) { return api<void*(*)(void*)>(0x2009918)(save(g)); }
void* party(void* g) { return api<void*(*)(void*)>(0x201735c)(g); }
u32 count(void* g) { return api<u32(*)(void*)>(0x201fe24)(party(g)); }
bool repel(void* g) { return enabled && (*options(g)&0x1000); }
bool cycling(void* g) {
    return api<u32(*)(void*)>(0x20175a4)(api<void*(*)(void*)>(0x20171f4)(g))==1;
}
bool item(void* g,u32 id,u16 heap) {
    return api<u32(*)(void*,u32,u32,u32)>(0x2008474)(api<void*(*)(void*)>(0x2017354)(g),id,1,heap);
}
bool show(u32 i,Subscreen* s) {
    void* g=game(s);
    if(i==1) return !api<u32(*)(void*,u16)>(0x20191d8)(api<void*(*)(void*)>(0x2017394)(g),session.pcHideFlag);
    if(i==2) return item(g,450,s->heap);
    if(i==3) return item(g,442,s->heap);
    return true;
}
bool canBike(Subscreen* s) {
    void* g=game(s);
    if(!item(g,450,s->heap)) return false;
    return ov<u32(*)(u32,void*,void*)>(0x215eff4)(0,system(s),s->field)==0;
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
void* archive(u16 heap) {
    // Native ARCHANDLE contains FSFile (72 bytes), archive offset and counts.
    void* h=api<void*(*)(u32,u32,u32,const char*,u32)>(0x203a228)(heap,80,1,"quick-actions",0);
    if(!h) return nullptr;
    api<void(*)(void*)>(0x2070ca8)(h);
    if(!api<u32(*)(void*,const char*)>(0x2070ecc)(h,"rom:/quick-actions/ui.narc")) {
        api<void(*)(void*)>(0x203a278)(h);return nullptr;
    }
    api<void(*)(void*)>(0x204aac8)(h);return h;
}
void closeArchive(void* h) { if(h) api<void(*)(void*)>(0x204ab38)(h); }
void* read(void* h,u32 member,u16 heap,u32 size) {
    if(api<u32(*)(void*,u32)>(0x204ac38)(h,member)!=size) return nullptr;
    return api<void*(*)(void*,u32,u32)>(0x204ab48)(h,member,heap);
}
bool config(void* h,u16 heap) {
    void* m=read(h,0,heap,40);if(!m) return false;
    bool ok=at<u32>(m,0)==0x41475143 && at<u16>(m,4)==4 && at<u16>(m,6)==40
        && at<u32>(m,8)==1 && at<u32>(m,12)==0x41475142;
    session.pcHideFlag=at<u16>(m,36);
    if(!session.pcHideFlag || session.pcHideFlag>3059 || at<u16>(m,38)) ok=false;
    for(u32 i=0;i<4;i++) for(u32 c=0;c<4;c++) {
        session.rings[i][c]=at<u8>(m,16+i*4+c);
        if(session.rings[i][c]>=16) ok=false;
    }
    api<void(*)(void*)>(0x203a278)(m);return ok;
}
void loadPositions(void* g) {
    u8* p=static_cast<u8*>(cgearSave(g))+16;u8 check=0x9b;
    for(u32 i=0;i<13;i++) check^=p[i];
    bool good=at<u32>(p,0)==0x31504151 && p[4]==1 && p[13]==check;
    for(u32 i=0;i<4;i++) {
        Point v={p[5+i*2],p[6+i*2]};
        if(v.x<16||v.x>240||v.y<16||v.y>176) good=false;
    }
    for(u32 i=0;i<4;i++) session.positions[i]=good?Point{p[5+i*2],p[6+i*2]}:defaults[i];
}
void savePositions(void* g) {
    // First 16 bytes of the verified 36-byte reserved C-Gear region. Never
    // alter native panel positions, colours, power flags or picture CRC.
    u8* p=static_cast<u8*>(cgearSave(g))+16;at<u32>(p,0)=0x31504151;p[4]=1;
    for(u32 i=0;i<4;i++) {p[5+i*2]=session.positions[i].x;p[6+i*2]=session.positions[i].y;}
    u8 check=0x9b;for(u32 i=0;i<13;i++) check^=p[i];p[13]=check;
}
void visible(void* actor,bool on) { if(actor) api<void(*)(void*,u32)>(0x204c150)(actor,on); }
void place(u32 i) {
    s16 xy[2]={session.positions[i].x,session.positions[i].y};
    api<void(*)(void*,const s16*,u32)>(0x204c16c)(session.actors[i],xy,0);
}
void dispose() {
    if(!session.sub && !session.unit) return;
    session.visible=0;session.pending=0;session.drag=0xff;
    if(session.task) api<void(*)(void*)>(0x203a6d4)(session.task);
    session.task=nullptr;
    // Stop uploads, remove owned actors from the native unit, then free banks.
    for(u32 i=0;i<4;i++) if(session.actors[i]) api<void(*)(void*)>(0x204c134)(session.actors[i]);
    session.unit=nullptr;
    for(u32 i=0;i<4;i++) {
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
}
bool freeResources() {
    void* sys=*reinterpret_cast<void**>(nativeAddress(0x214197c));if(!sys) return false;
    void* chars=at<void*>(sys,0x10c);void* anim=at<void*>(sys,0x114);
    u32 free=0;u16 n=at<u16>(sys,0x118);
    for(u32 i=0;i<n;i++) if(at<u32>(chars,i*64+60)&0x80000000) free++;
    if(free<4) return false;
    void* palettes=at<void*>(sys,0x110);n=at<u16>(sys,0x11a);bool freePalette=false;
    for(u32 i=0;i<n;i++) if(at<u32>(palettes,i*24+20)&0x80000000) freePalette=true;
    if(!freePalette) return false;
    n=at<u16>(sys,0x11c);
    for(u32 i=0;i<n;i++) if(at<u32>(anim,i*20+16)) return true;
    return false;
}
void upload(void*,void*) {
    struct Character {u16 height,width;u32 format,mapping,character,size;void* data;};
    // Native C-Gear initialization is asynchronous and first uploads a full
    // palette bank. Restore our unused slots after that upload, through the
    // same native scheduling system. The additional transfer is 128 bytes.
    if(session.visible && session.palette!=INVALID) {
        u16 target=at<u8>(session.sub->work,0x30a)?0x0423:0x0441;
        for(u32 i=0;i<64;i++) {
            u16 c=session.colours[i];
            if(session.dim) c=(((c&31)+(target&31))>>1)
                |(((((c>>5)&31)+((target>>5)&31))>>1)<<5)
                |(((((c>>10)&31)+((target>>10)&31))>>1)<<10);
            session.uploadColours[i]=c;
        }
        struct Palette {u32 format,extended,size;void* data;} p={3,0,128,session.uploadColours};
        api<void(*)(u32,const void*,u32)>(0x204bd3c)(session.palette,&p,4);
    }
    for(u32 i=0;i<4;i++) if(session.actors[i]) {
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
}
void attach(Subscreen* s) {
    dispose();session.magic=0x53415143;session.sub=s;session.drag=0xff;session.pressed=0xff;session.frame=0;session.held=0;session.dim=0;
    session.animation=session.palette=INVALID;
    for(u32 i=0;i<4;i++) session.chars[i]=INVALID;
    void* h=archive(s->heap);enabled=h && config(h,s->heap);
    if(!enabled || !freeResources() || api<u32(*)(u32)>(0x2039f8c)(s->heap)<32768
        || api<u32(*)(u32)>(0x2039fbc)(s->heap)<8192) {closeArchive(h);dispose();return;}
    loadPositions(game(s));
    void* palette=read(h,1,s->heap,168);
    if(!palette) {closeArchive(h);dispose();return;}
    for(u32 i=0;i<64;i++) session.colours[i]=at<u16>(palette,40+i*2);
    api<void(*)(void*)>(0x203a278)(palette);
    session.patterns=read(h,8,s->heap,5120);
    if(!session.patterns) {closeArchive(h);dispose();return;}
    session.uploadBuffer=api<void*(*)(u32,u32,u32,const char*,u32)>(0x203a228)(s->heap,2048,1,"quick-actions",0);
    if(!session.uploadBuffer) {closeArchive(h);dispose();return;}
    session.palette=api<u32(*)(void*,u32,u32,u32,u32)>(0x204bbcc)(h,1,1,224,s->heap);
    session.animation=api<u32(*)(void*,u32,u32,u32)>(0x204be0c)(h,2,3,s->heap);
    if(session.palette==INVALID || session.animation==INVALID) {closeArchive(h);dispose();return;}
    session.unit=at<void*>(s->work,0x34);
    if(!session.unit) {closeArchive(h);dispose();return;}
    // Native owns the render unit. The creation hook adds four slots, leaving
    // its original 84 slots available. Remove our actors before native exit.
    void* actors=at<void*>(session.unit,0);u32 freeActors=0;
    for(u32 i=0;i<at<u16>(session.unit,12);i++) if(!at<u32>(actors,i*228)) freeActors++;
    if(freeActors<4) {closeArchive(h);dispose();return;}
    for(u32 i=0;i<4;i++) {
        session.graphics[i]=read(h,i+4,s->heap,2048);
        session.chars[i]=api<u32(*)(u32,u32,u32)>(0x204b8e8)(512,1,s->heap);
        if(!session.graphics[i] || session.chars[i]==INVALID) {closeArchive(h);dispose();return;}
        void* sys=*reinterpret_cast<void**>(nativeAddress(0x214197c));
        void* resource=static_cast<u8*>(at<void*>(sys,0x10c))+session.chars[i]*64;
        if(api<u32(*)(void*)>(0x203cb14)(static_cast<u8*>(resource)+0x34)) {closeArchive(h);dispose();return;}
        struct ActorData {s16 x,y;u16 sequence;u8 priority,bg;} data={session.positions[i].x,session.positions[i].y,static_cast<u16>(i),0,0};
        session.actors[i]=api<void*(*)(void*,u32,u32,u32,const void*,u32,u32)>(0x204c06c)(
            session.unit,session.chars[i],session.palette,session.animation,&data,0,s->heap);
        if(!session.actors[i]) {closeArchive(h);dispose();return;}
        api<void(*)(void*,u32)>(0x204c54c)(session.actors[i],1);
        visible(session.actors[i],false);session.uploaded[i]=0xff;session.desired[i]=0;
    }
    closeArchive(h);
    session.task=api<void*(*)(void*,void*,u32)>(0x20056fc)(reinterpret_cast<void*>(upload),nullptr,2);
    if(!session.task) dispose();
}
bool drawable(Subscreen* s) {
    if(!s||s!=session.sub||!session.unit||s->state||s->mode!=0) return false;
    void* w=s->work;
    return w && at<u32>(w,0)==(overlayAddress(0x21ec9cc)|1)
        && ov<u32(*)(Subscreen*,void*,void*)>(0x21983ec)(s,system(s),game(s))==13;
}
bool safe(Subscreen* s) {
    return drawable(s) && !ov<u32(*)(void*)>(0x21ed2e0)(s->work) && !at<u32>(s->work,0x108)
        && !ov<u32(*)(void*)>(0x218130c)(s->field);
}
int hit(u32 x,u32 y) {
    for(u32 i=0;i<4;i++) {
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
    if(!active || !safe(s)) {session.pending=0;session.pressed=0xff;session.drag=0xff;}
    if(!session.unit) return;
    void* g=game(s);bool edit=at<u8>(s->work,0x2fe);
    if(session.visible) {
        for(u32 i=0;i<4;i++) session.shown[i]=show(i,s);
        // Follow native sleep dimming after its delayed palette update.
        // Short Bike events finish before that update, avoiding a flash.
        if(!at<u8>(s->work,0x310)) session.dim=ov<u32(*)(void*)>(0x21ed2e0)(s->work);
        // Match the user's middle C-Gear ring, including native pink themes
        // and colour edits. These offsets are independently pinned per game.
        u32 col=at<u8>(s->work,0x306);if(col>=6) col=0;
        for(u32 i=0;i<4;i++) for(u32 c=0;c<3;c++)
            session.colours[i*16+session.rings[i][c]]=at<u16>(s->work,0x18c+col*18+6+c*2);
        session.available[0]=1;session.available[1]=1;
        session.available[2]=canBike(s);
        session.frame++;session.available[3]=1;
        // Retail hides ACT_CUSTOM with wireless off. Its actor is retained;
        // restore only that actor, without changing any communication flag.
        visible(at<void*>(s->work,0x90),true);
    }
    for(u32 i=0;i<4;i++) {
        bool on=(i==0 && repel(g))||(i==2 && cycling(g));
        u32 pose=session.pressed==i?2:edit?1:!session.available[i]?3:on?1:0;
        u32 design=at<u8>(s->work,0x300),sex=at<u8>(s->work,0x30a);
        if(design>=5) design=0;
        if(sex>1) sex=0;
        session.desired[i]=(pose<<4)|(sex*5+design);
    }
}
struct FlyWork {MapRequest map;u32 member;};
int flyEvent(void* event,u32* sequence) {
    auto* w=api<FlyWork*(*)(void*)>(0x2016edc)(event);
    void* sys=api<void*(*)(void*)>(0x2016ed8)(event);
    void* field=api<void*(*)(void*)>(0x2016af0)(sys);
    void* g=api<void*(*)(void*)>(0x2016ad8)(sys);
    if(*sequence==0) {
        if(!field) return 1;
        int member=flyMember(field,g);
        clear(w,sizeof(*w));w->member=member;
        w->map.system=sys;w->map.field=field;w->map.call=8;w->map.user=w;
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
    if(*sequence==1 && w->member!=INVALID && w->map.result==2 && field) {
        FlyCheck check;ov<void(*)(void*,FlyCheck*)>(0x2159270)(field,&check);
        if(ov<u32(*)(FlyCheck*)>(0x21596c4)(&check)) return 1;
        UseHeader header={static_cast<u16>(w->member),4,w->map.zone};
        void* child=ov<void*(*)(u32,UseHeader*,FlyCheck*)>(0x2159460)(4,&header,&check);
        if(child) {api<void(*)(void*,void*)>(0x2016d68)(event,child);*sequence=2;return 0;}
    }
    return 1;
}
}
extern "C" void QaCGearInit(Subscreen* s) {
    dispose();session.sub=s;session.attempted=0;session.held=0;session.pending=0;
    session.palette=session.animation=INVALID;
    for(u32 i=0;i<4;i++) session.chars[i]=INVALID;
    void* h=archive(s->heap);enabled=h && config(h,s->heap);closeArchive(h);
    ov<void(*)(Subscreen*)>(0x2198564)(s);
}
extern "C" void* QaGearUnit(u32 count,u32 priority,u32 heap) {
    return api<void*(*)(u32,u32,u32)>(0x204bf48)(count+(enabled?4:0),priority,heap);
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
    void* h=archive(s->heap);enabled=h && config(h,s->heap);closeArchive(h);
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
}
extern "C" void QaInput(void* w) {
    Subscreen* s=session.sub;
    if(!session.active||!safe(s)||s->work!=w) {session.pending=0;ov<void(*)(void*)>(0x21eb894)(w);return;}
    u32 x=0,y=0;bool down=api<u32(*)(u32*,u32*)>(0x203dab0)(&x,&y);
    if(session.drag<4) {
        if(down) {
            auto& p=session.positions[session.drag];p.x=clamp(x,16,240);p.y=clamp(y,16,176);place(session.drag);
        } else {savePositions(game(s));session.drag=0xff;session.pressed=0xff;}
        return;
    }
    if(session.held) {if(!down) {session.held=0;session.pressed=0xff;}return;}
    if(api<u32(*)()>(0x203da74)()) {
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
    }
    ov<void(*)(void*)>(0x21eb894)(w);
}
extern "C" int QaButtonHit(void* w) {
    // Input only: allow the wrench, pattern toggle and panel drags with wireless off.
    // Never make the C-Gear state machine believe wireless has been enabled.
    u8 power=at<u8>(w,0x30b);bool edit=at<u8>(w,0x2fe);u32 x=0,y=0;
    api<u32(*)(u32*,u32*)>(0x203dab0)(&x,&y);
    int dx=static_cast<int>(x)-228,dy=static_cast<int>(y)-144;
    bool wrench=dx*dx+dy*dy<=100;
    bool logo=x>=104 && x<=152 && y<=24;
    if(enabled && (edit||wrench||logo)) at<u8>(w,0x30b)=1;
    int result=ov<int(*)(void*)>(0x21eb748)(w);at<u8>(w,0x30b)=power;return result;
}
extern "C" void* QaCGearEvent(Subscreen* s,u32 available) {
    void* native=ov<void*(*)(Subscreen*,u32)>(0x21986b4)(s,available);
    u32 action=session.pending;session.pending=0;
    if(native||!available||!action||!safe(s)||at<u8>(s->work,0x2fe)||!show(action-1,s)) return native;
    void* g=game(s);void* sys=system(s);
    if(action==1) {
        u16* p=options(g);*p^=0x1000;
        if(*p&0x1000) api<void(*)(u32)>(0x2006254)(1996);
        return nullptr;
    }
    if(action==2) return ov<void*(*)(void*,u32,void*,u32)>(0x21536ac)(sys,10090,nullptr,s->heap);
    if(action==3 && canBike(s)) return ov<void*(*)(u32,void*,void*)>(0x215f024)(0,sys,s->field);
    if(action==4) {
        return api<void*(*)(void*,void*,void*,u32)>(0x2016cb4)(sys,nullptr,reinterpret_cast<void*>(flyEvent),sizeof(FlyWork));
    }
    return nullptr;
}
extern "C" int QaTownMapReturn(void* work,void* param) {
    if(ownedMap && at<void*>(work,0x18)==ownedMap && at<u32>(param,4)!=2) return 1;
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
