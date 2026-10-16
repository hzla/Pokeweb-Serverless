#include <stdint.h>
/* Test builds only. Invoke the game's ordinary sound controls on its normal
 * update thread, so emulator tests can exercise fades and pause deterministically.
 * This file and its command mailbox are excluded from distributed DLLs. */
volatile uint32_t PokewebStreamTest[8]={0x43545750};
extern int PokewebStreamPlay(uint32_t);
extern void PokewebStreamStop(void),PokewebStreamPause(uint32_t),PokewebStreamSetVolume(uint32_t);
#define API(at,type) ((type)(uintptr_t)(at))
void Bw1TestUpdate(void){
    uint32_t cmd=PokewebStreamTest[1],a=PokewebStreamTest[2],b=PokewebStreamTest[3];
    if(!cmd)return;
    PokewebStreamTest[1]=0;
    switch(cmd){
    case 1: API(0x02005d35,int(*)(uint32_t,uint32_t))(a,0xffff);break;
    case 2: API(0x02005de5,void(*)(uint32_t))(a);break;
    case 3: API(0x02005e31,void(*)(uint32_t))(a);break;
    case 4: API(0x02005e05,void(*)(uint32_t,uint32_t))(a,b);break;
    case 5: API(0x02005f25,void(*)(uint32_t,uint32_t))(0xffff,a);break;
    case 6: PokewebStreamPlay(a);break;
    case 7: PokewebStreamStop();break;
    case 8: PokewebStreamPause(a);break;
    case 9: PokewebStreamSetVolume(a);break;
    case 11: API(0x02005d15,void(*)(void))();break;
    }
    PokewebStreamTest[4]++;PokewebStreamTest[5]=cmd;
}
