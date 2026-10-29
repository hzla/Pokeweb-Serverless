// Optional BW2 outline overlays use a reserved OBJ palette bank per panel.
// Native HUD palettes stay unchanged; each panel gets one checked 32x32 OAM piece.
extern "C" { volatile u32 gTypeIconBorderColor = 0x0842; }
namespace {
#ifdef GAME_B2
constexpr u32 BorderContext=0x0214193c, BorderReserve=0x0204d9f5, BorderFree=0x0204bcd1;
#else
constexpr u32 BorderContext=0x0214197c, BorderReserve=0x0204da21, BorderFree=0x0204bcfd;
#endif
struct BorderState { u16 source[16],transfer[16],hardware[16]; u8 bank,id,users,active; u16 paintedTypes; u8 paintedStatus; } borderStates[6];
BorderState& borderFor(const Record& r) { return borderStates[r.pos<2?r.pos:r.pos-2]; }
unsigned borderBytes(const Record& r) { return r.layout>=2?(r.pos&1?3072:2048):(r.pos&1?2048:2304); }
bool borderRange(const void* p,unsigned n) {
    const u32 a=reinterpret_cast<u32>(p);
    return n&&ram(p)&&a+n>a&&ram(reinterpret_cast<void*>((a+n-1)&~3u));
}
void* borderContext() { void* p=*reinterpret_cast<void**>(BorderContext);return borderRange(p,284)?p:nullptr; }
bool borderBanks(unsigned& mask,unsigned except=255) {
    void* ctx=borderContext();if(!ctx)return false;
    void* rows=field<void*>(ctx,272);const unsigned count=field<u16>(ctx,282);
    if(!count||count>128||!borderRange(rows,count*24))return false;
    mask=0;
    for(unsigned i=0;i<count;++i) {
        if(i==except)continue;
        void* row=static_cast<u8*>(rows)+24*i;
        if(field<u32>(row,20)&0x80000000)continue;
        const unsigned at=field<u32>(row,12);if(at==0xffffffff)continue;
        if(at>=512||(at&31))return false;
        mask|=1u<<(at/32);
    }
    return true;
}
bool borderOwner(const Record& r) {
    auto& borderState=borderFor(r);
    void* ctx=borderContext();if(!ctx||borderState.id>=field<u16>(ctx,282))return false;
    void* rows=field<void*>(ctx,272);if(!borderRange(rows,24*(borderState.id+1)))return false;
    void* row=static_cast<u8*>(rows)+24*borderState.id;
    return field<u32>(row,12)==32u*borderState.bank&&field<u32>(row,16)==0xffffffff&&field<u32>(row,20)==32;
}
bool borderAcquire(const Record& r) {
    auto& borderState=borderFor(r);
    unsigned used=0;if(!borderBanks(used,borderState.active?borderState.id:255))return false;
    if(borderState.active) {
        if(!borderOwner(r)||(used&(1u<<borderState.bank)))return false;
    } else {
        unsigned bank=10;for(;bank<16&&(used&(1u<<bank));++bank){}
        if(bank==16)return false;
        void* ctx=borderContext();void* rows=field<void*>(ctx,272);unsigned id=0,count=field<u16>(ctx,282);
        for(;id<count;++id)if(field<u32>(static_cast<u8*>(rows)+24*id,20)&0x80000000)break;
        if(id==count)return false;
        FadeBank* f=fade();if(!f)return false;
        borderState.bank=static_cast<u8>(bank);borderState.id=static_cast<u8>(id);
        for(unsigned i=0;i<16;++i) {
            borderState.source[i]=f->source[16*bank+i];borderState.transfer[i]=f->transfer[16*bank+i];
            borderState.hardware[i]=reinterpret_cast<volatile u16*>(0x05000200)[16*bank+i];
        }
        static constexpr u32 header[10]={0x4e434c52,0x0100feff,72,0x00010010,0x504c5454,56,3,0,32,16};
        volatile u32 nclr[18];for(unsigned i=0;i<18;++i)nclr[i]=i<10?header[i]:0;
        reinterpret_cast<void(*)(void*,u32,void*,u32,u32,u32,u32)>(BorderReserve)
            (static_cast<u8*>(ctx)+0x104,id,const_cast<u32*>(nclr),0,32*bank,0,1);
        if(!borderOwner(r)){reinterpret_cast<void(*)(u32)>(BorderFree)(id);return false;}
        borderState.active=1;
    }
    borderState.users|=static_cast<u8>(1u<<r.pos);return true;
}
u16* borderAttrs(const Record& r) {
    void* cell=field<void*>(panel(r.gauge,r.pos),0);if(!ram(cell))return nullptr;
    void* data=field<void*>(cell,0xa4);if(!ram(data))return nullptr;
    const unsigned nativeCount=(r.pos&1)?(r.layout>=2?3:2):(r.layout>=2?2:3);
    if(field<u16>(data,0)!=nativeCount+1)return nullptr;
    u16* attrs=field<u16*>(data,4);if(!ram(attrs))return nullptr;
    if((attrs[2]&1023)!=borderBytes(r)/64)return nullptr;
    return attrs;
}
void borderHide(const Record& r) { u16* attrs=borderAttrs(r);if(attrs)attrs[0]=0x00c0; }
void borderRelease(const Record& r) {
    auto& borderState=borderFor(r);
    if(!borderState.active)return;
    borderState.users&=static_cast<u8>(~(1u<<r.pos));if(borderState.users)return;
    unsigned used=0;FadeBank* f=fade();
    if(borderOwner(r)) {
        if(f&&borderBanks(used,borderState.id)&&!(used&(1u<<borderState.bank)))for(unsigned i=0;i<16;++i) {
            const unsigned at=16*borderState.bank+i;f->source[at]=borderState.source[i];f->transfer[at]=borderState.transfer[i];
            reinterpret_cast<volatile u16*>(0x05000200)[at]=borderState.hardware[i];
        }
        reinterpret_cast<void(*)(u32)>(BorderFree)(borderState.id);
    }
    borderState.active=borderState.users=0;
}
bool borderPaint(const Record& r) {
    auto& borderState=borderFor(r);
    u16* attrs=borderAttrs(r);if(!attrs||!borderAcquire(r))return false;
    FadeBank* f=fade();if(!f)return false;
    const int evy=currentFade(*f,r.bank);if(evy<0){borderHide(r);return true;}
    const unsigned at=16*borderState.bank+1;const u16 color=static_cast<u16>(gTypeIconBorderColor);
    f->source[at]=color;f->transfer[at]=blend(color,f->target,evy);
    if(reinterpret_cast<volatile u16*>(0x05000200)[at]!=f->transfer[at])
        reinterpret_cast<volatile u16*>(0x05000200)[at]=f->transfer[at];
    volatile u16* image=r.graphics+borderBytes(r)/2;
    attrs[1]=0x8000|448;attrs[2]=static_cast<u16>((((borderState.bank-r.bank)&15)<<12)|(borderBytes(r)/64));
    if(r.status){borderHide(r);borderState.paintedStatus=r.status;return true;}
#ifdef ICON_VARIANT_CIRCULAR
    const unsigned tip=4;
#else
    const unsigned tip=5;
#endif
    const unsigned px=iconLeft(r,0)+tip,py=iconY(r,0)-15;
    const unsigned atTip=((py/8)*4+px/8)*16+(py&7)*2+(px&7)/4,tipShift=(px&3)*4;
    // Reloading the checked NCGR resets the appended image to transparent.
    // Its first outline pixel detects that case without rewriting stable VRAM.
    attrs[0]=255;
    if(borderState.paintedTypes==r.types&&!borderState.paintedStatus&&((image[atTip]>>tipShift)&15)==1)return true;
    for(unsigned i=0;i<256;++i)if(image[i])image[i]=0;
    for(unsigned kind=0;kind<ICON_COUNT(r);++kind)for(unsigned y=0;y<11;++y)for(unsigned x=0;x<12;++x) {
        if(!ICON_INK(r,x,y))continue;
        const unsigned px=iconLeft(r,kind)+x,py=iconY(r,kind)+y-15;
        const unsigned p=((py/8)*4+px/8)*16+(py&7)*2+(px&7)/4,shift=(px&3)*4;
        const unsigned c=expected(r,kind,x,y)==2?1:0;
        image[p]=static_cast<u16>((image[p]&~(15u<<shift))|(c<<shift));
    }
    borderState.paintedTypes=r.types;borderState.paintedStatus=0;
    return true;
}
}
