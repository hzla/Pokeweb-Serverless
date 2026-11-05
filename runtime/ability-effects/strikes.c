/* Scoped to the native damage-move invocation, including nested/called moves. */
PUBLIC const volatile u32 AbilityStrikeApi[3]={0};
#define STX(i,t) ((t)(uintptr_t)AbilityStrikeApi[i])
typedef struct {void *flow,*hit;u32 owner,ratio;} StrikeScope;
static StrikeScope strikeScopes[8];
static u32 strikeDepth;
static void strikeInit(void){strikeDepth=0;}
static u32 strikeExcluded(u32 move){
 switch(move){
 case 12:case 32:case 90:case 120:case 153:case 165:case 205:
 case 248:case 253:case 283:case 301:case 329:case 353:case 374:case 515:return 1;
 default:return 0;
 }
}
/* The hit-count call is made with the caller's parameter in r4 and targets in
 * r7 in all checked profiles. Keep the native count and accuracy decisions. */
PUBLIC void AbilityStrikeCount(void*f,void*mon,u32 move,u8*hit,const u8*param,void*targets){
 STX(0,void(*)(void*,void*,u32,void*))(f,mon,move,hit);
 u32 depth=strikeDepth++;if(depth>=8)return;
 StrikeScope*s=&strikeScopes[depth];s->flow=f;s->hit=hit;s->owner=31;s->ratio=0;
 if(hit[3]||!*(const u32*)(param+8))return;
 u32 ability=STAT(mon,17);const volatile u8*r=record(ability);if(!r)return;
 const volatile u8*e=effects(r),*selected=0;
 for(u32 n=0;n<r[0];++n,e+=16)if(e[0]==171){selected=e;break;}
 if(!selected||preview(f)||strikeExcluded(move)||FN(31,u32(*)(u32,u32))(move,1)||STX(2,u32(*)(void*))(targets)!=1)return;
 u32 target=*(const u32*)(param+12);if(target==6||target==7||target>=10&&target<=12)return;
 s->owner=FN(15,u32(*)(void*))(mon);
 /* Conditions see the resolved move type and category, even though the native
  * hit-count event has already popped its temporary event-variable frame. */
 RX(7,void(*)(u32))(0x501);RX(9,void(*)(u32,u32))(0x12,move);RX(9,void(*)(u32,u32))(0x16,param[6]);RX(9,void(*)(u32,u32))(0x1a,*(const u32*)(param+8));
 u32 enabled=active(r,f,mon);RX(8,void(*)(u32))(0x501);
 if(!enabled)return;
 hit[0]=2;hit[2]=0;hit[3]=1;s->ratio=half(selected+2);
}
PUBLIC __attribute__((naked)) void AbilityStrikeCountSite(void){
 __asm__ volatile(".syntax unified\n push {r4, lr}\n sub sp, #8\n str r4, [sp]\n str r7, [sp, #4]\n bl AbilityStrikeCount\n add sp, #8\n pop {r4, pc}\n .syntax divided\n");
}
PUBLIC void AbilityStrikeEnd(void*f,void*param,void*mon,void*damaged,u32 damage,u32 flag){
 STX(1,void(*)(void*,void*,void*,void*,u32,u32))(f,param,mon,damaged,damage,flag);
 if(strikeDepth)--strikeDepth;
}
PUBLIC __attribute__((naked)) void AbilityStrikeEndSite(void){
 __asm__ volatile(".syntax unified\n push {r4, lr}\n sub sp, #8\n ldr r4, [sp, #16]\n str r4, [sp]\n ldr r4, [sp, #20]\n str r4, [sp, #4]\n bl AbilityStrikeEnd\n add sp, #8\n pop {r4, pc}\n .syntax divided\n");
}
static void strikeAfterHandlers(void*f,u32 event){
 if(event!=0x47||!strikeDepth||strikeDepth>8)return;
 StrikeScope*s=&strikeScopes[strikeDepth-1];
 if(s->flow==f&&s->ratio&&((u8*)s->hit)[1]==1&&!preview(f)&&VALUE(3)==s->owner)MUL(s->ratio);
}
