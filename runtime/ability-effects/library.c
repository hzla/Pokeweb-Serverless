/* Parameterized recipe effects. Native services and move-class data are supplied
 * by checked bindings; this file imports no expansion engine or ability source. */
#include "move_classes.h"
static u32 libraryMatch(const volatile u8*e){
 u32 filter=e[1],move=VALUE(0x12);s32 x;
 if(!filter)return 1;
 if(filter==1||filter==2||filter==5)return FN(31,u32(*)(u32,u32))(move,filter==1?0:filter==2?7:8);
 if(filter==9)return (variable(0x16,&x)?(u32)x:FN(35,u32(*)(u32,u32))(move,0))==e[4];
 if(filter==10)return FN(17,u32(*)(u32))(move)==e[5];
 if(filter==11)return variable(0x38,&x)&&FN(34,u32(*)(u32))((u32)x)==2;
 u32 bit=filter==3?1:filter==4?2:filter==6?4:filter==7?8:filter==8?16:filter==13?32:filter==12?64:0;
 for(u32 n=0;n<sizeof(abilityMoveClasses)/sizeof(abilityMoveClasses[0]);++n)if(abilityMoveClasses[n][0]==move)return (abilityMoveClasses[n][1]&bit)!=0;
 return 0;
}
static void libraryEffect(void*item,void*f,u8 owner,const volatile u8*e,u32 event){
 u32 kind=e[0],v=half(e+2);
 if(kind==129&&event==0x38&&VALUE(3)==owner||kind==130&&event==0x47&&VALUE(3)==owner||kind==131&&event==0x47&&VALUE(4)==owner){if(libraryMatch(e))MUL(v);return;}
 if(kind==132&&event==0x2d&&VALUE(4)==owner&&libraryMatch(e)){
  if(REWRITE(0x40,1)&&!preview(f)){
   popup(f,2,owner);u8*p=PUSH(f,4,owner);FN(11,void(*)(void*,u32,u32))(p+4,2,210);FN(12,void(*)(void*,u32))(p+4,owner);POP(f,p);popup(f,3,owner);
  }
  return;
 }
 if(kind==133&&event==0x4b&&VALUE(4)==owner&&VALUE(0x46)==0&&VALUE(0x32)>0&&!preview(f)&&STAT(MON(f,owner),13)&&libraryMatch(e)){
  u8 staged[16];for(u32 n=0;n<16;++n)staged[n]=e[n];staged[0]=11;staged[1]=e[8];
  popup(f,2,owner);action(item,f,owner,staged,e[9]?(u8)VALUE(3):owner);popup(f,3,owner);return;
 }
 if(kind==134&&event==0x11&&VALUE(3)==owner&&libraryMatch(e))REWRITE(0x18,(u32)((int8_t)VALUE(0x18)+(s32)v));
}
