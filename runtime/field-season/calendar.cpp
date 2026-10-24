// A saved story-calendar override. Unmarked saves keep the retail RTC policy.
using u8=unsigned char;using u16=unsigned short;using u32=unsigned int;
template<class F> F call(u32 address){return reinterpret_cast<F>(address|1);}
extern "C" int THUMB_BRANCH_ARM9_0x2034f58(void *game,u16 *previous,u16 *next){
    const u32 old=call<u32(*)(void*)>(0x20173ac)(game);
    void *work=call<void*(*)(void*)>(0x2017394)(game);
    const u16 value=*call<u16*(*)(void*,u16)>(0x20192c0)(work,0x41ae);
    *previous=static_cast<u16>(old);
    if((value&0xfffc)==0xa7c0){
        const u32 season=value&3;
        call<void(*)(void*,u32)>(0x20173b4)(game,season);
        *previous=*next=static_cast<u16>(season);return 0;
    }
    *next=call<u32(*)(void*)>(0x20175e4)(game)?old:call<u32(*)()>(0x2034f98)();
    return *next!=*previous;
}
