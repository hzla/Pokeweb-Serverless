#include "native.h"
#include "resident_events.h"
#define API __attribute__((visibility("default")))
/* ARM9 hooks remain callable in battle. They retain no pointer into a field
 * overlay after the event module unbinds or unloads. */
static FwrEvents active;
/* PC and menu transitions outlive the field/event overlays. These small
 * tokens are the only follower state retained by the battle-resident core. */
static struct {
 uint8_t restore[FWRE_RESTORE_BYTES],mount[FWRE_MOUNT_BYTES];
 unsigned valid;
} tokens;
static uint8_t *token(unsigned kind,unsigned size,unsigned *flag){
 if(kind==FWRE_RESTORE_TOKEN&&size==FWRE_RESTORE_BYTES){*flag=1;return tokens.restore;}
 if(kind==FWRE_MOUNT_TOKEN&&size==FWRE_MOUNT_BYTES){*flag=2;return tokens.mount;}
 return 0;
}
API int FollowingResidentTokenStore(unsigned kind,const void *source,unsigned size){
 unsigned flag=0;uint8_t *destination=token(kind,size,&flag);
 if(!destination||!source)return 0;
 const uint8_t *bytes=(const uint8_t*)source;
 for(unsigned i=0;i<size;++i)destination[i]=bytes[i];
 tokens.valid|=flag;return 1;
}
API int FollowingResidentTokenConsume(unsigned kind,void *destination,unsigned size){
 unsigned flag=0;uint8_t *source=token(kind,size,&flag);
 if(!source||!destination||!(tokens.valid&flag))return 0;
 uint8_t *bytes=(uint8_t*)destination;
 for(unsigned i=0;i<size;++i)bytes[i]=source[i];
 tokens.valid&=~flag;return 1;
}
API void FollowingResidentTokenDiscard(unsigned kind){
 if(kind==FWRE_RESTORE_TOKEN)tokens.valid&=~1u;
 else if(kind==FWRE_MOUNT_TOKEN)tokens.valid&=~2u;
}
API int FollowingResidentEventBind(const FwrEvents *hooks){
 FollowingResidentEventClear();
 if(!hooks||hooks->abi!=FWRE_ABI||hooks->size!=sizeof(FwrEvents)||
    !hooks->opcode||!hooks->callback||!hooks->freeEvent||!hooks->freeVm)return 0;
 active=*hooks;return 1;
}
API void FollowingResidentEventClear(void){
 active.opcode=0;active.callback=0;active.freeEvent=0;active.freeVm=0;
}
API unsigned FollowingResidentOpcode(void *vm){
 return active.opcode?active.opcode(vm):CALL(0x020159e9,unsigned(*)(void*))(vm);
}
API int FollowingResidentCallback(void *event){
 if(active.callback)return active.callback(event);
 int (*callback)(void*,void*,void*)=PTR(event,4);
 return callback(event,(uint8_t*)event+8,PTR(event,12));
}
extern void FollowingResidentOriginalEventFree(void*);
API void FollowingResidentFree(void *event){
 if(active.freeEvent)active.freeEvent(event);
 else FollowingResidentOriginalEventFree(event);
}
API void FollowingResidentVmFree(void *vm){
 if(active.freeVm)active.freeVm(vm);
 else CALL(0x0203a279,void(*)(void*))(vm);
}
